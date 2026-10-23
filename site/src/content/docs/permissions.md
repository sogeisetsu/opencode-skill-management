---
title: Permissions & evaluation
description: The rule shape, last-match-wins evaluation, the ask fallback, agent-level overrides, and which file the plugin is allowed to write.
---

Everything `skill_management` changes is a permission rule. Reading this page is enough to
predict what the tool will report before you run it.

## The rule

```jsonc
{ "action": "skill", "resource": "windows-shell", "effect": "deny" } // skill_management
```

| Field | Meaning |
|---|---|
| `action` | The permission action. Skill permissions use the literal `skill`. |
| `resource` | The skill id. Exact id, or a glob pattern. |
| `effect` | `allow`, `deny` or `ask`. |

Rules live in the **top-level `permissions` array** of the global config. This is the V2 form:

```jsonc
{
  "permissions": [
    { "action": "skill", "resource": "windows-shell", "effect": "deny" }
  ]
}
```

:::caution[`permissions` vs `permission`]
The plural `permissions` (an array) is the V2 field used by this plugin. The singular
`permission` (an object) is deprecated. If you only have the singular field, this plugin will not
find or edit it.
:::

## Evaluation

The host evaluates the caller agent's rule set from the **end to the beginning** and takes the
first match. Equivalently: the **last matching rule wins**. Both `action` and `resource` are
matched as globs (`*` and `?`).

```text
rules[0] { action: "skill", resource: "*",             effect: "allow" }
rules[1] { action: "skill", resource: "windows-shell", effect: "deny"  }

→ windows-shell is denied (rules[1] is later)
```

Consequences:

- **Order is part of the semantics.** Appending a rule gives it priority over earlier rules in
  the same array. `disable` appends.
- **A broad rule can beat a specific one** if it comes later. `inspect` calls this out; adding
  another rule for the same id would not fix it.
- **There is no implicit allow.** When nothing matches, the host falls back to **`ask`**, not
  `allow`.

```text
no matching rule  →  ask
```

That fallback is why `ask` is ambiguous:

| What you see | Possible cause |
|---|---|
| `ask` | An explicit `{ action: "skill", resource: "<id>", effect: "ask" }` rule matched. |
| `ask` | No rule matched at all; the host fell back to `ask`. |

`list` shows `ask` for both. [`inspect`](../actions/inspect/) distinguishes them by reporting
`命中 rules[i]` or `无规则命中 → 回退 ask`.

## Effects

| Effect | Model-visible skill list | Loading through the `skill` tool |
|---|---|---|
| `allow` | Listed | Allowed |
| `ask` | Listed | Asks for confirmation |
| `deny` | Hidden | Rejected (`permission.rejected`) |

The granularity is the skill **id**, not an individual file or invocation. A skill whose id does
not exist fails with `Unable to load skill <id>`, which is a different error from a permission
rejection.

## Whose rules are evaluated

Each agent has its own effective rule set. The plugin evaluates only the **calling agent**; it
never merges every agent's rules into one list. Merging is wrong because sub-agents
(`explorer`, `title`, …) carry their own `deny` rules that do not apply to the caller.

A typical divergence: the global config denies a skill, but one agent has its own later `allow`
or vice versa. In that case:

- `list` shows the caller's state and says other agents differ.
- `inspect` prints the per-agent table.
- `disable` reports that the rule was written but the caller's actual effect is still different,
  instead of claiming success.

Rules set in `agents.<id>.permissions` are not edited by this tool. They are only reported.

## Which config file is written

The plugin resolves the global config in this order:

1. `<config>` is `$XDG_CONFIG_HOME/opencode` if `XDG_CONFIG_HOME` is set, else
   `~/.config/opencode` (`C:\Users\<you>\.config\opencode` on Windows).
2. Candidates are `opencode.json` and `opencode.jsonc` in `<config>`, plus the same names in
   `~/.config/opencode` when that is a different directory. `opencode.jsonc` is preferred over
   `opencode.json`.
3. If both locations contain a `permissions` array, the plugin picks the `~/.config/opencode`
   file and adds a warning to its output.
4. If no candidate has `permissions`, it uses the last existing candidate, or creates
   `<config>/opencode.jsonc` if none exists.

`opencode.managed.json` is **never** written. That is OpenChamber's second, managed global
config; editing it would fight the host.

## Minimal text edits

The config is not parsed into an object and re-serialized. The plugin inserts or removes the
specific item as text, so comments, indentation, key order, trailing commas and the file's own
CRLF/LF and BOM survive. The result is parsed and validated before it is written.

Writes are atomic: a temp file in the same directory is renamed into place. Before writing, one
backup is saved under `<config>/skill_management.backups/`.

:::danger[Backups contain secrets]
The global config often contains MCP credentials. The backup is a byte-for-byte copy. Do not
paste it into an issue, commit it, or treat it as harmless evidence.
:::

## The sidecar

`<config>/skill_management.state.json` records which rules this tool wrote (id, effect, file,
timestamp). It is a hint, not the source of truth:

- `enable` prefers the in-file marker comment and only falls back to the sidecar.
- If the sidecar and config disagree, `list` reports the mismatch and does not "replay" anything.

The same-line marker is deliberate: it is the only provenance that survives a lost sidecar, and
its format is part of the 1.x compatibility promise.

## Patterns

| Pattern | Matches |
|---|---|
| `windows-shell` | Exactly that id |
| `*` | Every skill |
| `pdf-*` | Ids starting with `pdf-` |
| `?` | Exactly one character |

Prefer exact ids. A wildcard `deny` is reported by `enable` and never deleted automatically,
because deleting it would change more than the one skill you named.

## Hand-written examples

```jsonc
{
  "permissions": [
    // hide one skill completely
    { "action": "skill", "resource": "windows-shell", "effect": "deny" },

    // keep it listed, ask on load
    { "action": "skill", "resource": "pdf-tools", "effect": "ask" }
  ]
}
```

A hand-written rule without the marker can still be removed by `enable` if the sidecar has a
matching record and the rule is unique. Otherwise `enable` prints it for you to remove yourself.

Next: [Troubleshooting & FAQ](../troubleshooting/) for the failure modes in practice.
