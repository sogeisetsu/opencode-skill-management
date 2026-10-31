---
title: enable
description: Delete the one exact global rule that blocks a skill — or refuse with a JSON error code and show why it cannot be uniquely identified.
---

`enable` removes the blocking rule from the global config. It does not add an `allow` rule: once
the exact `deny`/`ask` entry is gone, the skill returns to normal evaluation (and, if nothing
else matches, to the host's `ask` fallback).

The rule does not have to have been written by this tool. It does have to be uniquely
identifiable.

## Parameters

| Name | Type | Required | Meaning |
|---|---|---|---|
| `action` | `"enable"` | yes | Selects this action. |
| `id` | string | one of `id` / `name` | Skill to restore. |
| `name` | string | one of `id` / `name` | Alias; only when it matches exactly one skill. |
| `dryRun` | boolean | no | Default `false`. `true` shows what would be deleted and writes nothing. |

```text
skill_management({ action: "enable", id: "windows-shell" })
skill_management({ action: "enable", id: "windows-shell", dryRun: true })
```

## Which rules are candidates

Only rules that:

- have `resource` exactly equal to the skill id,
- have `effect` `deny` or `ask`,
- have an `action` that glob-matches `skill`.

`allow` rules are not blockers and are never deleted. Wildcard resources, agent-level
`permissions` and policies are not candidates either; they are reported only.

## How the rule is identified

1. **Same-line marker comment.** A rule ending in `// skill_management` is self-identifying,
   even if the sidecar is gone. This is the normal path.
2. **Sidecar record, no marker.** If `<config>/skill_management.state.json` records the id and
   the config contains exactly one identical rule, that rule is deleted with a warning that the
   marker was stripped.
3. **Neither.** It refuses, returns the exact rule text from the config, and leaves the file
   alone. It does not guess which of several similar rules you meant.

It also refuses when the config cannot be parsed, because locating and safely deleting a rule
from malformed JSONC is not possible.

## When it cannot help

If the caller is blocked but there is no exact rule for the id, `enable` explains that the
blocker is not "this line":

- a wildcard or otherwise broader `skill` rule,
- an agent-level rule in `agents.<id>.permissions`,
- `policies` / `experimental.policies`, which the plugin cannot read (its context has no
  `config` domain).

Those cases are reported with the matched rule, never edited. Fix them by hand.

## What happens, in order

1. Resolve the skill and the caller's current effect.
2. Read the target config plus any file recorded in the sidecar.
3. Locate the candidate exact rule(s) and choose a unique one as described above.
4. Remove the item — and the `permissions` block if this edit made it empty.
5. Write atomically, preserving indentation, key order, EOL and BOM; keep one backup.
6. Reload and poll until the caller's exact-rule count decreases, or time out
   (`SKILL_MGMT_VERIFY_TIMEOUT_MS`, default 6 s). On timeout, restore the original bytes.
7. Report the rule's origin and the caller's **post-deletion** effective effect. If a broader
   rule still denies it, the result says so instead of implying success.

## What it returns

The usual envelope (`schemaVersion`, `action`, `ok`, `warnings`) plus:

| Field | Type | Meaning |
|---|---|---|
| `id`, `dryRun` | string, boolean | Echo of the resolved request. |
| `callerAgent` | string \| null | Agent whose rule set was used. |
| `before` | object | `index` and `rule` before deletion; `rule` is `null` when nothing matched. |
| `targetFiles` | string[] | Files considered (target config plus any sidecar-recorded file). |
| `changed` | boolean | `true` only when a rule was actually deleted. |
| `reason` | string | Present when `changed` is `false`: `nothing_to_enable`. |
| `message` | string | The human-readable explanation for a no-op or a `dryRun`. |
| `location` | object | `how` = `marker` or `sidecar`; `origin` is the prose explanation. |
| `rule` | object | `file` and the exact `text` of the deleted (or deletable) rule. |
| `diff` | string[] | The removed line, for `dryRun`. |
| `backup` | string | Backup path for the file that was edited. |
| `sidecar` | string \| null | Sidecar path written after success; `null` when the sidecar could not be written (the deletion still stands and `warnings` explains the stale record). |
| `verification` | object | `ok`, `via`, `caller`, and `effect` after deletion. |

A successful run also reports whether a now-empty `permissions` block was cleaned up, and if the
caller is still `deny` because of a broader rule, that rule is quoted in `warnings`.

## Errors

| `error.code` | When | Extra fields |
|---|---|---|
| `unverifiable_origin` | Neither marker nor sidecar confirms the rule. | `rule`: the exact line |
| `ambiguous_rule` | Several exact rules for the same id. | `candidates[]`: `file`, `text` |
| `no_matching_rule` | No exact rule; the blocker is broader. | `relatedRules[]`, `callerHit` |
| `config_unparsable` | The target config has a JSONC syntax error. | `warnings` |
| `verification_failed` | The host did not drop the rule in time. | `rolledBack: true` |
| `skill_not_found` / `name_ambiguous` / `missing_param` | Target resolution failed. | `near` / `candidates` |

```json
{
  "schemaVersion": 1,
  "action": "enable",
  "ok": false,
  "warnings": [],
  "error": {
    "code": "ambiguous_rule",
    "message": "拒绝执行：配置里有 2 条精确命中 `windows-shell` 的规则，无法唯一定位（宿主求值是最后一条命中算数）。"
  },
  "id": "windows-shell",
  "changed": false,
  "candidates": [
    { "file": "<config>\\opencode.jsonc", "text": "{ \"action\": \"skill\", \"resource\": \"windows-shell\", \"effect\": \"deny\" } // skill_management" },
    { "file": "<config>\\opencode.jsonc", "text": "{ \"action\": \"skill\", \"resource\": \"windows-shell\", \"effect\": \"deny\" }" }
  ]
}
```

## Outcome at a glance

| Situation | Result |
|---|---|
| Rule written by this tool, marker intact | `ok: true`, `location.how = "marker"`. |
| Marker stripped, sidecar matches one rule | `ok: true`, `location.how = "sidecar"`, warning to check the config. |
| Two identical rules for the same id | `ok: false`, `ambiguous_rule`, candidates printed. |
| Blocked by `resource: "*"` | `ok: false`, `no_matching_rule`, broad rule in `relatedRules`. |
| Blocked only in one agent's own rules | `ok: false`, `no_matching_rule`, `callerHit` names the agent. |
| No rule and not blocked | `ok: true`, `changed: false`, `reason: "nothing_to_enable"`. |

## Writes configuration?

Yes, unless `dryRun: true`, and only when a unique exact rule is found. A refusal writes
nothing.

Next: read [Permissions & evaluation](../../permissions/) to understand what happens after the
rule is gone.
