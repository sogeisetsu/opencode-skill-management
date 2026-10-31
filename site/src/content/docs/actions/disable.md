---
title: disable
description: Write one exact global permission rule so a skill is hidden and rejected at load — JSON result, dry run, soft disable, verified rollback.
---

`disable` appends one exact rule to the **global** config:

```jsonc
{ "action": "skill", "resource": "<id>", "effect": "deny" } // skill_management
```

With `deny`, the skill disappears from the model-visible list and the built-in `skill` tool
refuses to load it. With `effect: "ask"`, it stays listed and asks for confirmation.

It never edits, moves or deletes a skill file.

## Parameters

| Name | Type | Required | Meaning |
|---|---|---|---|
| `action` | `"disable"` | yes | Selects this action. |
| `id` | string | one of `id` / `name` | Skill id to disable. |
| `name` | string | one of `id` / `name` | Alias, used only when it matches exactly one skill. |
| `effect` | `"deny"` \| `"ask"` | no | Default `deny`. `ask` is a soft disable. |
| `dryRun` | boolean | no | Default `false`. `true` reports the exact changed lines and writes nothing. |

`id` wins over `name`. An ambiguous name returns the candidates instead of picking one; an
unknown id returns near matches. Both are errors, not writes.

```text
skill_management({ action: "disable", id: "windows-shell" })
skill_management({ action: "disable", id: "windows-shell", dryRun: true })
skill_management({ action: "disable", id: "windows-shell", effect: "ask" })
```

## What happens, in order

1. **Resolve the target** through the skill registry (id, or a unique name).
2. **Read the caller's current effect.** If it is already `deny`, nothing is written. If a
   broader rule (for example `resource: "*"`) is responsible, the result quotes it and says
   that a new rule for this id is unnecessary.
3. **Resolve the global config file.** The plugin reads the candidate files, prefers
   `opencode.jsonc` over `opencode.json`, and never writes `opencode.managed.json`. See
   [Permissions & evaluation](../../permissions/) for the full order.
4. **Apply a minimal text edit.** The rule is inserted into the existing `permissions` array
   (created if absent), preserving indentation, key order, line endings (CRLF/LF) and BOM. The
   file is parsed and validated before writing.
5. **Write atomically.** A temp file in the same directory is renamed over the target. If the
   target existed, one backup is kept in `<config>/skill_management.backups/`. The backup is a
   byte-for-byte copy of a file that often contains MCP credentials; treat it as secret.
6. **Reload and verify.** The plugin calls the host's agent reload and polls the caller's rule
   set for up to 6 seconds (`SKILL_MGMT_VERIFY_TIMEOUT_MS` overrides this).
   - For `deny`, the criterion is that the caller's effective effect is `deny`.
   - For `ask`, the criterion is that the number of exact `{skill, id, ask}` rules increased.
     "Not deny" is not accepted: the host's no-match fallback is also `ask`.
7. **Roll back on failure.** If verification fails, the original bytes are restored and the
   result says so. A half-written config is never left behind.
8. **Record provenance.** On success, `<config>/skill_management.state.json` records the id,
   effect, file and timestamp. This sidecar helps `enable` find a rule whose marker comment was
   stripped by another tool.

## What it returns

The usual envelope (`schemaVersion`, `action`, `ok`, `warnings`) plus:

| Field | Type | Meaning |
|---|---|---|
| `id`, `effect`, `dryRun` | string, string, boolean | Echo of the resolved request. `effect` is `deny` unless `ask` was passed. |
| `callerAgent` | string \| null | Agent whose rule set was used. |
| `before` | object | `index` and `rule` before the change; `rule` is `null` when nothing matched. |
| `targetFile` | string | Global config file. |
| `configNotes` | string[] | Why that file was chosen. |
| `changed` | boolean | `true` only when the config was actually modified. |
| `reason` | string | Present when `changed` is `false`: `already_disabled` or `covered_by_broader_rule`. |
| `message` | string | The human-readable explanation for a no-op or a `dryRun`. |
| `planned` | boolean | `true` for `dryRun`. |
| `createdBlock` | boolean | Whether a new `permissions` block was created. |
| `diff` | string[] | The exact changed lines that were (or would be) written. |
| `backup` | string \| null | Backup path, when the target existed. |
| `sidecar` | string \| null | Sidecar path written on success; `null` when the sidecar could not be written (the config change still stands and `warnings` explains it). |
| `verification` | object | `ok`, `via`, `caller`, `expected`, `actual`, `beforeCount`, `count`, `diverged`. |

`verification.via` names the reload/poll path and includes the exact-rule count transition
(for example `精确规则数 0→1`), so a rule that the host never read cannot look like success.

When the rule is written and read back but the **caller's** actual effect is still different
(that agent has its own later rule), `verification.actual` differs from `expected` and
`warnings` says the change is not effective for that caller. Divergent agents are listed the
same way. Neither is reported as "applied".

## Example output

```json
{
  "schemaVersion": 1,
  "action": "disable",
  "ok": true,
  "warnings": [],
  "id": "windows-shell",
  "effect": "deny",
  "dryRun": false,
  "callerAgent": "build",
  "before": { "index": 0, "rule": { "action": "*", "resource": "*", "effect": "allow" } },
  "targetFile": "<config>\\opencode.jsonc",
  "configNotes": ["目标文件含现有 permissions，直接在其数组中追加/删除"],
  "changed": true,
  "createdBlock": false,
  "diff": ["    { \"action\": \"skill\", \"resource\": \"windows-shell\", \"effect\": \"deny\" } // skill_management"],
  "backup": "<config>\\skill_management.backups\\opencode.jsonc.2026-10-30T01-02-03-456Z.bak",
  "sidecar": "<config>\\skill_management.state.json",
  "verification": {
    "ok": true,
    "via": "ctx.agent.reload() + ctx.agent.list()（轮询 1 次；精确规则数 0→1）",
    "caller": "build",
    "expected": "deny",
    "actual": "deny",
    "beforeCount": 0,
    "count": 1,
    "diverged": []
  }
}
```

## Errors

| `error.code` | When | File touched |
|---|---|---|
| `verification_failed` | The host did not read the rule back in time. `rolledBack: true`; original bytes restored. | Reverted |
| `skill_not_found` | No id matched. `near` lists similar ids. | No |
| `name_ambiguous` | The name matched several skills. `candidates` lists ids. | No |
| `missing_param` | Neither `id` nor `name` was given. | No |

```json
{
  "schemaVersion": 1,
  "action": "disable",
  "ok": false,
  "warnings": [],
  "error": { "code": "verification_failed", "message": "回读校验失败（期望 deny，实际 allow）；已回滚，文件未留下半成品。" },
  "id": "windows-shell",
  "effect": "deny",
  "changed": false,
  "rolledBack": true
}
```

## Soft disable

`effect: "ask"` keeps the skill in the model-visible list. Every load asks for confirmation.
It is useful when you want the skill available but not silently invoked.

If the caller is already `deny`, `disable` returns `ok: true`, `changed: false`,
`reason: "already_disabled"` and writes nothing — it does not downgrade a deny to `ask`. Run
[`enable`](../enable/) first, then `disable` with `effect: "ask"`. Each successful call appends
one rule; the newest rule for the same id wins.

## Writes configuration?

Yes, unless `dryRun: true`. Only the global config's `permissions` array is edited. Project
config, agent-level permissions and policies are out of scope.

Next: [`enable`](../enable/) reverses it.
