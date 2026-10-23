---
title: enable
description: Delete the one exact global rule that blocks a skill — or refuse and show why it cannot be uniquely identified.
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
3. **Neither.** It refuses, prints the exact rule text from the config, and leaves the file
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
   rule still denies it, the output says so instead of implying success.

## Reading the result

A successful run names the file, whether a `permissions` block was cleaned up, where the deleted
rule came from (marker, sidecar), and the effect after deletion. `dryRun` ends with
`dryRun：未写入任何文件。`

Example outcomes:

| Situation | Result |
|---|---|
| Rule written by this tool, marker intact | Deleted; origin = marker comment. |
| Marker stripped, sidecar matches one rule | Deleted with a warning to check the config. |
| Two identical rules for the same id | Refused; candidates printed. |
| Blocked by `resource: "*"` | Refused; broad rule printed. |
| Blocked only in one agent's own rules | Refused; agent-level rule printed. |
| No rule and not blocked | Reports that nothing needed changing. |

## Writes configuration?

Yes, unless `dryRun: true`, and only when a unique exact rule is found. A refusal writes
nothing.

Next: read [Permissions & evaluation](../../permissions/) to understand what happens after the
rule is gone.
