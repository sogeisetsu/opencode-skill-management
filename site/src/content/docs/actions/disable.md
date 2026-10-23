---
title: disable
description: Write one exact global permission rule so a skill is hidden and rejected at load — with dry run, soft disable, and verified rollback.
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
| `dryRun` | boolean | no | Default `false`. `true` prints the exact changed lines and writes nothing. |

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
   broader rule (for example `resource: "*"`) is responsible, the output quotes it and says
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
   output says so. A half-written config is never left behind.
8. **Record provenance.** On success, `<config>/skill_management.state.json` records the id,
   effect, file and timestamp. This sidecar helps `enable` find a rule whose marker comment was
   stripped by another tool.

## Reading the result

The output names the caller agent, the current effect, the target file and why it was chosen,
then the exact JSONC lines that changed. In `dryRun` mode it ends with
`dryRun：未写入任何文件。`

A successful write ends with a verification line. Two honest variations matter:

- If the rule was written and read back, but the **caller's** actual effect is still different
  because that agent has its own later rule, the output says the rule is in the file and reports
  the actual effect. It does not call the change effective for that caller.
- If other agents diverge, their ids and effects are listed.

## Soft disable

`effect: "ask"` keeps the skill in the model-visible list. Every load asks for confirmation.
It is useful when you want the skill available but not silently invoked.

If the caller is already `deny`, `disable` reports `已经是停用状态` and writes nothing — it does
not downgrade a deny to `ask`. Run [`enable`](../enable/) first, then `disable` with
`effect: "ask"`. Each successful call appends one rule; the newest rule for the same id wins.

## Writes configuration?

Yes, unless `dryRun: true`. Only the global config's `permissions` array is edited. Project
config, agent-level permissions and policies are out of scope.

Next: [`enable`](../enable/) reverses it.
