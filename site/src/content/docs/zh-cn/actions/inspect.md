---
title: inspect
description: 单个 skill 的详情 —— 结论、命中规则、逐 agent 差异、id 来源。只读。
---

`inspect` 是诊断动作。它回答三个问题：这个 skill 现在能不能用、是哪条规则决定的、
为什么那条规则会作用到这个 id 上。

它只读。

## 参数

| 名称 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `action` | `"inspect"` | 是 | 选择动作。 |
| `id` | string | `id` / `name` 二选一 | skill id，精确匹配。 |
| `name` | string | `id` / `name` 二选一 | 别名。仅在 `id` 未命中时使用，且必须唯一命中一个 skill。 |

两者都给时 `id` 优先。`name` 命中多个 skill 时不猜，直接返回候选 id。

```text
skill_management({ action: "inspect", id: "windows-shell" })
skill_management({ action: "inspect", name: "windows-shell" })
```

## 返回什么

**元数据表。** 包含 `id`、`name`、`name` 与 `id` 是否不同、匹配方式（按 id 还是别名）、
`path`、`source`、`scope`、截断后的 `description`、原始 `frontmatter.name`、
`frontmatter.disable-model-invocation`，以及注册表的 `autoinvoke`。读不到的值写成
`(未读到)` / `(未提供)`，不编造。

**`## id 推导` —— id 从哪来。** 注册表直接给了 `id` 就写明，并列出路径供核对；没给则按路径
反推，并打印推导过程：

- `<dir>/SKILL.md` → 取所在目录名。
- `<dir>/<name>.md` → 取文件名去掉 `.md`。

既没有 id 也没有可用路径时，它会说 id 无法确定，并按空 id 处理。

**`## 有效判定` —— 逐 agent 求值。** 一张 `agent` / `effect` / `命中规则` 的表（最多 30 个
agent），后面要么写「各 agent 结果一致」，要么列出结果不同的 agent。`list` 提示「其它 agent
不同」时，指的就是这张表。

**调用者结论。** 三种之一：

- `不可用` —— 效果为 `deny`，模型可见列表会隐藏它，加载被拒。
- `可用但需确认` —— 效果为 `ask`，仍在列表里，加载时询问。
- `可用` —— 效果为 `allow`（或其它不阻塞的效果）。

命中的规则以 `rules[<index>] = {...}` 原文给出。没有规则命中时写
`无规则命中 → 回退 ask` —— 这是宿主的回退，不是某条显式规则。

如果调用者是被通配或更宽的规则挡住（命中的 `resource` 不是这个 skill 的 id），`inspect`
会明确指出：skill 确实被挡，但给这个 id 再加一条规则不是解决办法。

## 输出摘录

工具返回的是 Markdown，下面是渲染后的形态。

:::note[渲染后的输出]

**元数据**

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

**id 推导**

- `id`：`windows-shell`
- 来源：**注册表直接给出**（本工具不反推，仅列出对应规则供核对）
- 路径：`<config>\skills\windows-shell\SKILL.md`

**有效判定**

| agent | effect | 命中规则 |
|---|---|---|
| build | deny | `rules[3] = {"action":"skill","resource":"windows-shell","effect":"deny"}` |
| explorer | allow | `rules[0] = {"action":"skill","resource":"*","effect":"allow"}` |

> **结论**：`windows-shell` 对调用者 agent `build` 当前**不可用** —— 权限效果为 deny（命中
> `rules[3] = {...}`），模型可见列表会隐藏它、且 `skill` 工具加载会被拒。

:::

## 什么时候用

- `list` 显示 `ask`，需要确认是规则写了 `ask`，还是根本没命中。
- skill 装了却加载不了。
- `disable` 说规则写进去了，但调用者看到的效果不同。
- 执行 `enable` 前，确认到底哪条规则在挡路。

id 本身找不到时，`inspect` 返回注册表里的相近 id，而不是猜一个。

下一步：[`disable`](../disable/) 处理你看到的问题。
