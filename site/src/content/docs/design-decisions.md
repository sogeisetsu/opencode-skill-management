---
title: Design decisions
description: Why the plugin writes permission rules instead of policies, why there is no "allow", why it edits text instead of rewriting JSON, and what each choice costs.
---

`skill_management` is deliberately small: four actions, one rule shape, one file it may write.
This page records the choices behind that surface, the evidence for them, and — for each one —
what the alternative would have bought and what this choice gives up.

## Why a `permissions` rule, not a `policies` entry

OpenCode has two ways to stop a skill from being used:

| Mechanism | What it removes | Granularity | Writable by this plugin |
|---|---|---|---|
| `permissions` rule with `effect: "deny"` | The skill from the model-visible list, and loading is rejected | One skill id, **per agent** | Yes |
| `policies` (`integration.use` deny) | The skill from the registry itself | One integration id, globally | No |

A permission rule is used because it is the only mechanism that expresses all three states this
tool needs to distinguish: `allow`, `deny` and `ask`. `ask` is a native `Permission.Effect`, not a
workaround — the host keeps the skill listed and asks at load time. Rules are also evaluated
against each agent's own rule set, so the tool can answer a per-agent question ("is this available
to *me*?") instead of a global one.

**The cost.** A `policies` deny is more thorough: it takes the skill out of the registry
(`s.remove(id)`), so it disappears for every agent and even from tools that read the registry
directly. This plugin cannot match that, and cannot read policy documents either: the plugin
context has no `config` domain. If a policy is what blocked a skill, `enable` reports it and stops.

Choose a policy when the skill must not exist at all for anyone. Choose a permission rule when you
want a switch that is visible, per-agent and reversible.

## Why there is no `allow`

`disable` only ever appends `deny` or `ask`; `enable` only deletes a rule with one of those
effects.

An appended `allow` would take priority over every earlier rule for that id, including a broader
`deny` that someone wrote on purpose. That silently widens the blast radius: the tool would be
"fixing" one skill by overriding a decision it never made. It would also break the ownership
model: `enable` recognises the rules it wrote by effect and marker, so a self-written `allow`
would be a rule nobody ever reclaims.

**The cost.** Re-enabling is always a deletion, never an override. When an agent-level rule or a
wildcard `deny` still blocks the skill afterwards, the tool reports it and leaves it alone; you
edit that rule yourself.

## Why only the global config

There is exactly one write target, resolved in a documented order (see
[Permissions & evaluation](../permissions/#which-config-file-is-written)). Project configs,
`agents.<id>.permissions` and `policies` are read or reported, never edited.

One target means the tool can be honest about what it changed: `config.file` names it, a backup is
taken from it, and `enable` looks for the rule there first. It also means no surprise edits in a
repository you happen to be in.

**The cost.** You cannot disable a skill for one project only, and you cannot disable it for one
agent only. Both are real use cases; both are out of scope.

## Why minimal text edits, with a same-line marker

The global config is usually hand-maintained JSONC: comments, key order, indentation, CRLF/LF and
sometimes a BOM. Parsing it into an object and serialising it back would destroy all of that, so
the plugin inserts or removes the single item as text, then validates the result before writing.

The `// skill_management` trailing comment is provenance that lives *inside* the file. It survives
a lost or corrupt sidecar, and it is the first thing `enable` looks for. Its format is part of the
1.x compatibility promise, because deleting a rule after a sidecar loss depends on it.

**The cost.** The writer must keep producing that exact marker forever. And if another tool strips
comments from your config, the marker is gone — `enable` then falls back to the sidecar record, or
refuses rather than guessing.

## Why the sidecar is only an audit trail

`<config>/skill_management.state.json` records id, effect, file and timestamp for rules this tool
wrote. It is never replayed: when it disagrees with the config, `list` reports the mismatch and the
config wins.

**The cost.** If both the marker and the sidecar record are lost, `enable` cannot prove the rule is
the tool's, and it prints the rule instead of deleting it. Writing the sidecar is best-effort too:
if it cannot be saved, the config change still counts as done, and the result says so in `warnings`
with `sidecar: null`.

## Choosing the mechanism for your case

| What you want | Use |
|---|---|
| The skill gone for everyone, as if it were never installed | `policies` (`integration.use` deny) |
| Hidden from the model and refused at load, per agent | `disable` (a `permissions` rule with `effect: "deny"`) |
| Listed, but every load asks for confirmation | `disable` with `effect: "ask"` |
| Never injected into context, but still loadable by name | `disable-model-invocation` in `SKILL.md` — frontmatter, not a permission; this tool only reports it |

Next: [Development & verification](../development/) for how these behaviours are tested.
