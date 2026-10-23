---
title: inspect
description: One skill in detail — conclusion, matched rule, per-agent differences and where the id came from. Read-only.
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

**The metadata table.** `id`, `name`, whether `name` differs from `id`, whether matching was by
id or alias, `path`, `source`, `scope`, a truncated `description`, the raw
`frontmatter.name`, `frontmatter.disable-model-invocation`, and the registry's `autoinvoke`
value. Missing values are shown as `(未读到)` / `(未提供)`, never invented.

**`## id 推导` — where the id came from.** If the registry supplied an `id`, it says so and
shows the path for cross-checking. If it did not, the id was derived from the path and the
derivation is printed:

- `<dir>/SKILL.md` → the directory name.
- `<dir>/<name>.md` → the file name without `.md`.

If neither an id nor a usable path exists, it says the id cannot be determined and treats the
id as empty.

**`## 有效判定` — per-agent evaluation.** A table of `agent`, `effect`, `命中规则` (up to 30
agents), followed by either "all agents agree" or a list of the agents whose effect differs.
This is the table `list` points to when it says other agents disagree.

**The conclusion for the caller.** One of:

- `不可用` — effect `deny`; the skill is hidden from the model-visible list and loading is
  rejected.
- `可用但需确认` — effect `ask`; still listed, confirmation on load.
- `可用` — effect `allow` (or another non-blocking effect).

The matched rule is quoted as `rules[<index>] = {...}`. When no rule matched, it says
`无规则命中 → 回退 ask` — the host's fallback, not an explicit rule.

If the caller is denied by a wildcard or other broader rule (the matched `resource` is not this
skill's id), `inspect` says so explicitly: the skill is blocked, but adding a rule for this id
would not be the fix.

## Abridged output

```text
# inspect: windows-shell

| 字段 | 值 |
|---|---|
| id | windows-shell |
| name | windows-shell |
| name ≠ id | 否 |
| 匹配方式 | 按 id 精确匹配 |
| source | config |
| scope | user |
| description | Windows shell conventions… |
| frontmatter.disable-model-invocation | (未读到) |

## id 推导

- `id`：`windows-shell`
- 来源：**注册表直接给出**（本工具不反推，仅列出对应规则供核对）
- 路径：`<config>\skills\windows-shell\SKILL.md`

## 有效判定

| agent | effect | 命中规则 |
|---|---|---|
| build | deny | rules[3] = {"action":"skill","resource":"windows-shell","effect":"deny"} |
| explorer | allow | rules[0] = {"action":"skill","resource":"*","effect":"allow"} |

**结论**：`windows-shell` 对调用者 agent `build` 当前**不可用** —— 权限效果为 deny（命中 rules[3] = {...}），模型可见列表会隐藏它、且 `skill` 工具加载会被拒。
```

## When to use it

- `list` shows `ask` and you need to know whether a rule says `ask` or nothing matched.
- A skill is installed but the model cannot load it.
- `disable` reported that the rule was written but the caller still sees a different effect.
- Before `enable`, to confirm which rule is actually blocking.

If the id itself is unknown, `inspect` returns near matches from the registry rather than a
guess.

Next: [`disable`](../disable/) to act on what you found.
