---
title: inspect
description: One skill in detail — conclusion, matched rule, per-agent differences and where the id came from. Read-only, JSON output.
---

`inspect` is the diagnostic action. It answers three questions about one skill: is it usable
right now, which rule decided that, and why does that rule apply to this id?

It is read-only.

## Parameters

| Name | Type | Required | Meaning |
|---|---|---|---|
| `action` | `"inspect"` | yes | Selects this action. |
| `id` | string | one of `id` / `name` | Skill id. Exact match. |
| `name` | string | one of `id` / `name` | Alias. Used only when `id` does not match, and only if it hits exactly one skill. |

`id` wins when both are supplied. A `name` that matches several skills does not guess: it
returns the candidate ids.

```text
skill_management({ action: "inspect", id: "windows-shell" })
skill_management({ action: "inspect", name: "windows-shell" })
```

## What it returns

The same envelope as every action (`schemaVersion`, `action`, `ok`, `warnings`), plus:

| Field | Type | Meaning |
|---|---|---|
| `matchedBy` | string | `id` or `name`. |
| `skill.id` | string \| null | Resolved skill id. |
| `skill.name` | string \| null | Registry name. |
| `skill.nameDiffersFromId` | boolean | Whether `frontmatter.name` overrides the id. |
| `skill.path` | string \| null | Path from the registry. |
| `skill.source` / `skill.scope` | string | Same values as `list`. |
| `skill.description` | string \| null | First line of the registry description. |
| `skill.autoinvoke` | boolean \| null | Registry value, or `null` when not provided. |
| `skill.frontmatter` | object | `name` and `disableModelInvocation`, each string/boolean or `null` when unreadable. |
| `idDerivation.idSource` | string | `registry`, `derived` or `none`. |
| `idDerivation.explained` | string | Which rule produced the id, in prose. |
| `idDerivation.rule` | string \| null | The derivation rule text. |
| `idDerivation.pathField` | string \| null | Which registry field was used as the path (`path` or `location`). |
| `idDerivation.dir` / `idDerivation.base` | string \| null | Inputs to the derivation. |
| `agents[]` | object[] | Per-agent evaluation: `id`, `effect`, `index`, `rule` (`null` when no rule matched). |
| `divergentAgents[]` | object[] | Agents whose effect differs from the caller's: `id`, `effect`. |
| `caller` | object | `id`, `effect`, `index`, `rule`, `coveredByBroaderRule`, `broaderRule`. |
| `conclusion.state` | string | `available`, `disabled` or `ask`. |
| `conclusion.message` | string | The same conclusion as one human-readable sentence. |

`index` is the position of the last matching rule in that agent's rule set; `-1` means no rule
matched and the host fell back to `ask`. Missing values are `null`, never invented.

### id derivation

If the registry supplied an `id`, `idSource` is `registry` and the path is included for
cross-checking. If it did not, the id was derived from the path:

- `<dir>/SKILL.md` → the directory name.
- `<dir>/<name>.md` → the file name without `.md`.

If neither an id nor a usable path exists, `idSource` is `none`, `rule` is `null`, and the id is
treated as empty.

### Per-agent evaluation

`agents` is the per-agent answer that `list` points to when it says other agents disagree. It is
not merged: each entry is evaluated against that agent's own final rule set.

### The conclusion

- `disabled` — effect `deny`; the skill is hidden from the model-visible list and loading is
  rejected.
- `ask` — effect `ask`; still listed, confirmation on load.
- `available` — any non-blocking effect.

When the caller is denied by a wildcard or other broader rule (the matched `resource` is not this
skill's id), `caller.coveredByBroaderRule` is `true` and `caller.broaderRule` holds that rule:
the skill is blocked, but adding a rule for this id would not be the fix.

## Errors

| `error.code` | When |
|---|---|
| `skill_not_found` | No id matched. `near` lists similar ids from the registry. |
| `name_ambiguous` | The name matched several skills. `candidates` lists their ids. |

```json
{
  "schemaVersion": 1,
  "action": "inspect",
  "ok": false,
  "warnings": [],
  "error": { "code": "skill_not_found", "message": "未找到 skill `no-such-skill`。（结论来自实际读到的注册表，未做猜测）" },
  "near": ["windows-shell"]
}
```

## Example output

```json
{
  "schemaVersion": 1,
  "action": "inspect",
  "ok": true,
  "warnings": [],
  "matchedBy": "id",
  "skill": {
    "id": "windows-shell",
    "name": "windows-shell",
    "nameDiffersFromId": false,
    "path": "<config>\\skills\\windows-shell\\SKILL.md",
    "source": "config",
    "scope": "user",
    "description": "Windows shell conventions…",
    "autoinvoke": null,
    "frontmatter": { "name": "windows-shell", "disableModelInvocation": null }
  },
  "idDerivation": {
    "idSource": "registry",
    "pathField": "path",
    "dir": "<config>\\skills\\windows-shell",
    "base": "SKILL.md",
    "rule": "<dir>/SKILL.md → 取 SKILL.md 所在目录名",
    "explained": "注册表直接给出（本工具不反推，仅列出对应规则供核对）"
  },
  "agents": [
    { "id": "build", "effect": "deny", "index": 3, "rule": { "action": "skill", "resource": "windows-shell", "effect": "deny" } },
    { "id": "explorer", "effect": "allow", "index": 0, "rule": { "action": "skill", "resource": "*", "effect": "allow" } }
  ],
  "divergentAgents": [{ "id": "explorer", "effect": "allow" }],
  "caller": {
    "id": "build",
    "effect": "deny",
    "index": 3,
    "rule": { "action": "skill", "resource": "windows-shell", "effect": "deny" },
    "coveredByBroaderRule": false,
    "broaderRule": null
  },
  "conclusion": {
    "state": "disabled",
    "message": "`windows-shell` 对调用者 agent `build` 当前不可用：权限效果为 deny（命中 rules[3] = {\"action\":\"skill\",\"resource\":\"windows-shell\",\"effect\":\"deny\"}），模型可见列表会隐藏它、且 skill 工具加载会被拒。"
  }
}
```

## When to use it

- `list` shows `ask` and you need to know whether a rule says `ask` or nothing matched.
- A skill is installed but the model cannot load it.
- `disable` reported that the rule was written but the caller still sees a different effect.
- Before `enable`, to confirm which rule is actually blocking.

Next: [`disable`](../disable/) to act on what you found.
