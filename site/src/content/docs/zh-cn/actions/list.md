---
title: list
description: 所有已注册 skill、它们对调用者 agent 的有效状态，以及配置一致性提示。只读。
---

`list` 回答的是：「现在到底装了什么，其中哪些对我真的可用？」

它只读：不写文件，不改配置。

## 参数

| 名称 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `action` | `"list"` | 是 | 选择动作。 |
| 其它字段 | — | 否 | `list` 会忽略。`id`、`name`、`effect`、`dryRun` 都不参与。 |

```text
skill_management({ action: "list" })
```

## 返回什么

一张 Markdown 表，每个已注册 skill 一行，按 id 排序：

| 列 | 取值 |
|---|---|
| `id` | 宿主注册表给的 id；注册表项没有 id 时由路径反推。 |
| `name` | 注册表里的名称（不同时显示 `frontmatter.name`）。 |
| `autoinvoke` | 注册表为 `autoinvoke: false` 时显示 `off`，否则为空。 |
| `source` | `embedded`、`config`、`claude`、`agents`、`catalog`、`project`、`plugin` 或 `unknown`。 |
| `scope` | `user` 或 `project`（相对 home 目录）。 |
| `state` | `available`、`disabled` 或 `ask`。**只按调用者 agent** 求值。 |
| `path` | 注册表报告的绝对路径。 |
| `description` | 描述第一行，截断到 60 字符。 |

表后依次是：

- `发现 N 个、已禁用 M 个、ask K 个。` —— 调用者视角的合计。
- `调用者 agent：\`<id>\`` —— 用的是哪个 agent 的规则集。无法确认调用者时会额外警告，
  并说明退回用了哪个 agent。
- 其它 agent 下状态不同的数量提示（逐 agent 明细在 `inspect`）。
- 有些 id 是反推而来时的说明。
- sidecar 检查：记录了但配置里已不存在的规则、配置里有但 sidecar 不认识的规则、
  以及 sidecar 记录但注册表里已消失的 id。
- 解析出的目标配置文件，以及为什么选它。

## 怎么读 state 列

- `available` —— 调用者最后命中的是 `allow`，或更早的 allow 没有被覆盖。
- `disabled` —— 最后命中的是 `deny`。该 skill 从模型可见列表隐藏，加载会被拒。
- `ask` —— 最后命中的是 `ask`，**或者一条规则都没命中**（宿主回退 `ask`）。`list` 分不清
  这两种情况，用 [`inspect`](../inspect/)。

状态刻意按单个 agent 求值。把所有 agent 的规则合在一起，会把子 agent 的 `deny` 泄漏到
调用者视图 —— 这个 bug 本项目已经修过一次。

## 输出摘录

```text
# skills (N)

| id | name | autoinvoke | source | scope | state | path | description |
|---|---|---|---|---|---|---|---|
| windows-shell | windows-shell |  | config | user | available | <config>\skills\windows-shell\SKILL.md | Windows shell conventions… |
| pdf-tools | pdf-tools |  | catalog | user | disabled | <cache>\skills\pdf-tools\SKILL.md | Read and extract PDF content… |

发现 N 个、已禁用 1 个、ask 0 个。
调用者 agent：`build`（state 列按该 agent 的有效规则集求值，见规范 §3.6）
ℹ️ 另有 2 个 skill 在其它 agent 下状态不同（详见 `inspect` 的逐 agent 表）。

目标配置文件：`<config>\opencode.jsonc`
- 目标文件含现有 permissions，直接在其数组中追加/删除
```

批量清理前跑一次，`disable` 之后再跑一次，确认状态真的变了。

某一行看起来不对时，下一步看 [`inspect`](../inspect/)。
