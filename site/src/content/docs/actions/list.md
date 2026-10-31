---
title: list
description: Every registered skill, its effective state for the calling agent, and config consistency notes. Read-only, JSON output.
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

One JSON object. Every action starts with the same envelope:

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | number | `1` in 1.1.0. |
| `action` | string | `"list"`. |
| `ok` | boolean | `true` when the registry and config were read. |
| `warnings` | string[] | Human-readable notes (Chinese in 1.1.0); empty when there is nothing to report. |

`list` adds:

| Field | Type | Meaning |
|---|---|---|
| `callerAgent.id` | string \| null | Agent whose rule set was evaluated. |
| `callerAgent.verified` | boolean | `false` when `context.agent` was missing or not in the registry; the result falls back to a visible agent and `warnings` says so. |
| `summary.total` | number | Registered skills. |
| `summary.disabled` | number | Skills whose caller effect is `deny`. |
| `summary.ask` | number | Skills whose caller effect is `ask` (explicit or host fallback). |
| `summary.diverged` | number | Skills whose effect differs under at least one other **visible** agent. `hidden` internal agents (`title`, `summary`, …) are excluded; their detail is still in `inspect.agents[]`. |
| `summary.derivedIds` | number | Ids derived from paths because the registry supplied none. |
| `skills[]` | object[] | One entry per skill, sorted by id. |
| `skills[].id` | string \| null | Registry id, or derived from the path. `null` when neither exists. |
| `skills[].name` | string \| null | Registry name (`frontmatter.name` when it differs). |
| `skills[].autoinvoke` | boolean \| null | `false` means the registry turned auto-invocation off; `null` when the registry did not provide it. |
| `skills[].source` | string | `embedded`, `config`, `claude`, `agents`, `catalog`, `project`, `plugin` or `unknown`. |
| `skills[].scope` | string | `user` or `project`, relative to the home directory. |
| `skills[].state` | string | `available`, `disabled`, `ask` or `unknown`. Evaluated for the **calling agent only**. |
| `skills[].path` | string \| null | Absolute path as reported by the registry. |
| `skills[].description` | string \| null | First line of the description; not truncated further. |
| `config.file` | string | Global config file that writes would target. |
| `config.configDir` | string | Resolved `<config>` directory. |
| `config.configDirs` | string[] | Candidate directories considered. |
| `config.hadPermissions` | boolean | Whether the target document already had a `permissions` array. |
| `config.notes` | string[] | Why that file was chosen. |
| `sidecar.file` | string | `<config>/skill_management.state.json`. |
| `sidecar.ok` | boolean | Whether the sidecar could be read. |
| `sidecar.error` | string \| null | Read error, without guessing at its meaning. |
| `consistency.staleSidecarIds` | string[] | Sidecar records with no matching rule in the config. |
| `consistency.unrecordedRules` | object[] | Config `skill` rules the sidecar does not know: `resource`, `effect`. |
| `consistency.missingFromRegistry` | string[] | Recorded ids that are no longer registered. |

Skill bodies are never included. Messages inside `warnings` are Chinese in 1.1.0; field names and
values above are the stable part.

## Reading `state`

- `available` — the caller's last matching rule is `allow`, or an earlier rule allows it and
  nothing overrides it.
- `disabled` — the last matching rule is `deny`. The skill is hidden from the model-visible list
  and loading it is rejected.
- `ask` — the last matching rule is `ask`, **or no rule matched at all** (the host falls back to
  `ask`). `list` cannot tell those two cases apart; use [`inspect`](../inspect/).

State is computed per agent on purpose. Merging all agents' rules would leak a sub-agent's
`deny` into the caller's view, which is a bug this project has already had to fix.

## Example output

```json
{
  "schemaVersion": 1,
  "action": "list",
  "ok": true,
  "warnings": ["另有 2 个 skill 在其它可见 agent 下状态不同（逐 agent 明细见 inspect）。"],
  "callerAgent": { "id": "build", "verified": true },
  "summary": { "total": 29, "disabled": 1, "ask": 0, "diverged": 2, "derivedIds": 0 },
  "skills": [
    {
      "id": "windows-shell",
      "name": "windows-shell",
      "autoinvoke": null,
      "source": "config",
      "scope": "user",
      "state": "available",
      "path": "<config>\\skills\\windows-shell\\SKILL.md",
      "description": "Windows shell conventions…"
    },
    {
      "id": "pdf-tools",
      "name": "pdf-tools",
      "autoinvoke": null,
      "source": "catalog",
      "scope": "user",
      "state": "disabled",
      "path": "<cache>\\skills\\pdf-tools\\SKILL.md",
      "description": "Read and extract from PDF files."
    }
  ],
  "config": {
    "file": "<config>\\opencode.jsonc",
    "configDir": "<config>",
    "configDirs": ["<config>"],
    "hadPermissions": true,
    "notes": ["目标文件含现有 permissions，直接在其数组中追加/删除"]
  },
  "sidecar": { "file": "<config>\\skill_management.state.json", "ok": true, "error": null },
  "consistency": { "staleSidecarIds": [], "unrecordedRules": [], "missingFromRegistry": [] }
}
```

Use it before a bulk cleanup, and again after `disable` to confirm the state actually changed.

Next: [`inspect`](../inspect/) when a row surprises you.
