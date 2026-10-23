---
title: list
description: Every registered skill, its effective state for the calling agent, and config consistency notes. Read-only.
---

`list` answers "what is installed right now, and which of it is actually available to me?"

It is read-only. It writes no files and changes no configuration.

## Parameters

| Name | Type | Required | Meaning |
|---|---|---|---|
| `action` | `"list"` | yes | Selects this action. |
| other fields | — | no | Ignored by `list`. `id`, `name`, `effect` and `dryRun` are not used. |

```text
skill_management({ action: "list" })
```

## What it returns

A Markdown table with one row per registered skill, sorted by id:

| Column | Values |
|---|---|
| `id` | Skill id from the host registry, or derived from the path when the registry entry has none. |
| `name` | Registry name (`frontmatter.name` when it differs). |
| `autoinvoke` | `off` when the registry says `autoinvoke: false`, otherwise empty. |
| `source` | `embedded`, `config`, `claude`, `agents`, `catalog`, `project`, `plugin` or `unknown`. |
| `scope` | `user` or `project`, relative to the home directory. |
| `state` | `available`, `disabled` or `ask`. Evaluated for the **calling agent only**. |
| `path` | Absolute path as reported by the registry. |
| `description` | First line of the description, truncated to 60 characters. |

Below the table:

- `发现 N 个、已禁用 M 个、ask K 个。` — totals for the caller.
- `调用者 agent：\`<id>\`` — the agent whose rule set was used. If the caller cannot be resolved,
  the line is followed by a warning and the fallback agent is named.
- An `ℹ️` line when some skills differ under other agents (the per-agent breakdown is in
  `inspect`).
- A note when some ids were derived from paths rather than supplied by the registry.
- Sidecar checks: a recorded rule that is no longer in the config, a config rule the sidecar
  does not know about, or a recorded id that is no longer registered.
- The resolved target config file and why that file was chosen.

The tool's messages are Chinese in 1.0.0; the table structure and values above are the stable
part.

## Reading the state column

- `available` — the caller's last matching rule is `allow`, or an earlier rule allows it and
  nothing overrides it.
- `disabled` — the last matching rule is `deny`. The skill is hidden from the model-visible list
  and loading it is rejected.
- `ask` — the last matching rule is `ask`, **or no rule matched at all** (the host falls back to
  `ask`). `list` cannot tell those two cases apart; use [`inspect`](../inspect/).

State is computed per agent on purpose. Merging all agents' rules would leak a sub-agent's
`deny` into the caller's view, which is a bug this project has already had to fix.

## Abridged output

The tool returns Markdown; this is the rendered form, with columns abridged.

**skills (N)**

| id | source | state | path |
|---|---|---|---|
| windows-shell | config | available | `<config>\skills\windows-shell\SKILL.md` |
| pdf-tools | catalog | disabled | `<cache>\skills\pdf-tools\SKILL.md` |

The full table also has `name`, `autoinvoke`, `scope` and `description` columns.

发现 N 个、已禁用 1 个、ask 0 个。

调用者 agent：`build`（state 列按该 agent 的有效规则集求值，见规范 §3.6）

ℹ️ 另有 2 个 skill 在其它 agent 下状态不同（详见 `inspect` 的逐 agent 表）。

目标配置文件：`<config>\opencode.jsonc`

- 目标文件含现有 permissions，直接在其数组中追加/删除

Use it before a bulk cleanup, and again after `disable` to confirm the state actually changed.

Next: [`inspect`](../inspect/) when a row surprises you.
