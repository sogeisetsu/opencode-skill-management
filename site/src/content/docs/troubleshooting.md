---
title: Troubleshooting & FAQ
description: Diagnose missing plugins, unexpected ask states, overridden rules, refused enable operations and config mismatches.
---

Start with the action that observes rather than changes: `list`, then `inspect` for the skill
that looks wrong. Almost every question below is answered by the rule quoted in `inspect`.

## The plugin does not appear

**`opencode plugin list --builtin` says `No plugins found`.** Add `--builtin`; without it,
locally loaded plugins are not listed. In a fresh config directory the first one or two calls
can also be empty — run it again.

**The plugin was just installed but is not active.** Plugins load at process start. Restart
OpenCode (or start a new process) and check again.

**Channel 3 was used.** Confirm the destination exists:
`<config>/plugins/skill_management.js`. `<config>` is `$XDG_CONFIG_HOME/opencode` when set,
otherwise `~/.config/opencode`. `node tools/install.mjs --dry-run` prints the exact path.

**A second file was added to `plugins/`.** Every `.js`/`.ts` file in that directory is loaded as
a plugin. A helper module or a second copy will be loaded too and can fail validation. Keep
`skill_management` as the single file.

## The tool cannot be found by the model

`skill_management` is a native tool with `codemode: false`. It is intentionally absent from the
Code Mode `search()` / `execute()` catalog. A model that checks only that catalog will conclude
"the tool does not exist" and give up. Ask it to call the tool directly by name.

## A skill is installed but cannot be loaded

Run:

```text
skill_management({ action: "inspect", id: "<id>" })
```

The conclusion names the effect and the exact matched rule. Common causes:

- A `deny` rule for the id, possibly written earlier.
- A later broad rule (`resource: "*"`) that denies more than you expected.
- An agent-level rule in `agents.<id>.permissions` that overrides the global config for the
  calling agent.
- The id is wrong: an unknown id produces `Unable to load skill <id>`, which is not a permission
  error.

## `list` says `ask` — is it disabled?

Not necessarily. `ask` has two causes: an explicit rule with `effect: "ask"`, or **no matching
rule**, because the host falls back to `ask`. `inspect` tells them apart:

- `命中 rules[i] = {...}` → an explicit rule.
- `无规则命中 → 回退 ask` → no rule at all.

If you want a skill fully hidden, use `effect: "deny"`, not `"ask"`.

## `disable` said it wrote the rule, but the skill is still available

Read the verification paragraph. The plugin distinguishes three outcomes:

1. **Written and effective for the caller.** The caller's effect is `deny`.
2. **Written, but the caller is still overridden.** The output reports the actual effect,
   usually because that agent has its own later rule. Other agents may see the new rule.
3. **Verification failed.** The original file was restored and the output says it rolled back.

Case 2 is not a bug in the write; it is a rule-order fact. `inspect` shows the per-agent table.
Remove or change the overriding agent rule yourself — the plugin does not edit agent-level
permissions.

## `disable` changes nothing and says it is already disabled

That is the intended no-op. If a broad rule caused it, the output quotes that rule and explains
that a new per-id rule would be redundant.

## `enable` refuses

Count the reasons:

- **No exact rule for the id.** The blocker is broader (`resource: "*"`), agent-level, or a
  policy. The output quotes it. Edit it by hand.
- **Several candidates.** Two rules for the same id, or two lines carrying the marker. The tool
  will not choose.
- **Neither marker nor sidecar record.** A hand-written rule that the sidecar does not know is
  printed verbatim. Delete it yourself if it is the one you mean.
- **The config cannot be parsed.** Fix the JSONC syntax first. The tool will not edit a document
  it cannot locate items in.
- **The sidecar says one thing, the config another.** `list` reports the mismatch. Run `inspect`
  to see what is actually effective.

## The rule is in the file, but the host did not pick it up

Config reload is asynchronous. `disable` and `enable` already poll for up to six seconds. If
your machine is slower, set `SKILL_MGMT_VERIFY_TIMEOUT_MS` (milliseconds) before starting
OpenCode. A timeout triggers a rollback, so the file will not be left in a half-verified state.

## Which file was edited?

The output prints the resolved target file and the reason it was chosen. The short version:
`opencode.jsonc` beats `opencode.json`, `<config>` is XDG-aware, and a second `permissions`
array under `~/.config/opencode` triggers a warning and that file is preferred.
`opencode.managed.json` is never written. See
[Permissions & evaluation](../permissions/).

## Can I undo a disable?

Yes — `enable` with the same id. It deletes the exact rule. The one backup in
`<config>/skill_management.backups/` is for recovery after a bad write, not a version history.

## Does it delete or modify skills?

No. It does not touch skill files, `SKILL.md` frontmatter, directories, project config,
`policies`, or agent-level permissions. It reads the registries and edits the global
`permissions` array.

## Is the backup safe to share?

No. It is a byte-for-byte copy of a config that commonly contains MCP credentials. Do not commit
it, attach it to an issue, or paste it into chat. When reporting a problem, quote only the
relevant rule (the output of `inspect` already does that).

## `name` matches more than one skill

Use the id. A duplicate name returns the candidate ids rather than picking one. The same applies
to `disable` and `enable`.

## Unknown action

The four actions are `list`, `inspect`, `disable`, `enable`. Anything else returns an error
listing them. The `action` field is required.

## The `list` count differs from what the model sees

`list` counts every registered skill. The model-visible list is filtered per agent and excludes
skills denied for that agent. A `deny` row in `list` is expected to be absent from the model's
view; that is the point of disabling it.

## A path or id looks wrong on Windows

Ids are taken from the registry when present. When absent, they are derived from the path:
`<dir>/SKILL.md` → the directory name, `<dir>/<name>.md` → the file name without `.md`.
`inspect` prints the derivation and the exact path it used. `source` and `scope` are classified
from that path, so unusual symlinks or drive mappings can change the label without changing the
id.
