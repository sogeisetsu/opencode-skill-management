---
title: Overview
description: What opencode-skill-management does, why it uses permission rules, and what it deliberately refuses to touch.
---

`opencode-skill-management` is a single-file OpenCode V2 plugin. It adds one native tool,
`skill_management`, with four actions: `list`, `inspect`, `disable` and `enable`.

It does not install, delete, move or rewrite skills. It reads the host's live registries and,
when you ask it to change something, writes **one exact permission rule** to the global OpenCode
config.

## The problems it solves

**The skill list becomes noise.** Every installed skill contributes a name and description to
the model's context. Once the list is long, the useful entries are harder to find and every
turn pays for the rest.

**A broken skill is opaque.** A skill can be registered and still be refused at load time. The
interesting question is not "is it installed?" but "which rule matched, for this agent, right
now?" — and that answer usually requires reading three config layers.

**Turning one off is disproportionate.** Renaming a directory or editing `SKILL.md` works, but
it is a real file change that you have to remember to undo. A permission rule is smaller,
inspectable and reversible.

## The model

OpenCode evaluates skill permissions as a list of rules, last match wins, with glob matching.
The plugin treats a rule as the only state it owns:

```jsonc
{ "action": "skill", "resource": "windows-shell", "effect": "deny" } // skill_management
```

- `disable` appends exactly this rule to the global config.
- `enable` removes exactly this rule.
- Both verify the result by asking the host to reload and then re-reading the caller agent's
  effective rule set. A write that the host did not pick up is rolled back, not reported as
  success.

The rest of the design follows from that:

| Property | Consequence |
|---|---|
| No skill file is touched | Nothing to restore if you change your mind |
| Rules are evaluated per agent | `list` reports the caller's state, not a merged global view |
| No match means `ask` | An `ask` state may mean "explicitly soft-disabled" or "no rule matched"; `inspect` distinguishes them |
| Global config only | Project-level config, `policies` and agent-level rules are reported, never edited |

:::note[Output format]
Every action returns one JSON object: `schemaVersion`, `action`, `ok`, `warnings`, plus the
action-specific fields described on these pages. Human-readable strings inside `warnings`,
`message`, `conclusion.message` and `error.message` are Chinese in 1.1.0; field names and
literal values are stable.
:::

## A first session

These are **tool calls**, not shell commands: each line is the argument object passed to the
native `skill_management` tool.

```text title="tool calls"
skill_management({ action: "list" })
skill_management({ action: "inspect", id: "windows-shell" })
skill_management({ action: "disable", id: "windows-shell", dryRun: true })
skill_management({ action: "disable", id: "windows-shell" })
skill_management({ action: "enable",  id: "windows-shell" })
```

`list` is read-only and safe to run at any time. `dryRun` on either write action returns the
exact lines in `diff` and writes nothing.

## What it will not do

- Edit, move, delete or reinstall a skill, or touch `SKILL.md` frontmatter.
- Write project-level configuration.
- Write `policies` or `experimental.policies`.
- Edit agent-level `agents.<id>.permissions`.
- Write `opencode.managed.json` (the second global config used by OpenChamber).
- Delete a rule it cannot uniquely identify. It prints the candidate and stops.
- Claim a rule "took effect" when an agent-level rule still overrides it.

## Next

- [Install it](../installation/) through one of three channels.
- Learn each action: [list](../actions/list/), [inspect](../actions/inspect/),
  [disable](../actions/disable/), [enable](../actions/enable/).
- Read the [permission evaluation model](../permissions/) before editing rules by hand.
