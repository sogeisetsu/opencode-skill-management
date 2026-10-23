---
title: 权限规则与求值模型
description: 规则形状、后匹配者胜、ask 回退、agent 级覆盖，以及插件被允许写哪个文件。
---

`skill_management` 改动的全部内容就是一条权限规则。读完这一页，你就能在运行工具之前
预测它会报告什么。

## 规则

```jsonc
{ "action": "skill", "resource": "windows-shell", "effect": "deny" } // skill_management
```

| 字段 | 含义 |
|---|---|
| `action` | 权限动作。skill 权限使用字面量 `skill`。 |
| `resource` | skill id。可以精确，也可以是 glob。 |
| `effect` | `allow`、`deny` 或 `ask`。 |

规则位于全局配置的**顶层 `permissions` 数组**。这是 V2 形态：

```jsonc
{
  "permissions": [
    { "action": "skill", "resource": "windows-shell", "effect": "deny" }
  ]
}
```

:::caution[`permissions` 与 `permission`]
复数的 `permissions`（数组）是本插件使用的 V2 字段。单数的 `permission`（对象）已废弃。
只有单数字段时，本插件既找不到也不会编辑它。
:::

## 求值

宿主对调用者 agent 的规则集**从后往前**遍历，取第一个命中。等价说法：**后匹配的规则胜出**。
`action` 与 `resource` 都按 glob 匹配（`*` 与 `?`）。

```text
rules[0] { action: "skill", resource: "*",             effect: "allow" }
rules[1] { action: "skill", resource: "windows-shell", effect: "deny"  }

→ windows-shell 被 deny（rules[1] 更靠后）
```

由此得到：

- **顺序是语义的一部分。** 追加规则会让它在同一数组里优先于更早的规则。`disable` 采用追加。
- **宽规则可能压过精确规则**，只要它更靠后。`inspect` 会点名这种情况；再给同一个 id 加一条
  规则并不能解决问题。
- **没有隐式 allow。** 一条规则都不命中时，宿主回退到 **`ask`**，不是 `allow`。

```text
没有任何规则命中  →  ask
```

这就是 `ask` 有歧义的原因：

| 你看到的 | 可能原因 |
|---|---|
| `ask` | 命中了显式的 `{ action: "skill", resource: "<id>", effect: "ask" }` 规则。 |
| `ask` | 没有任何规则命中，宿主回退到 `ask`。 |

`list` 对两者都显示 `ask`。[`inspect`](../actions/inspect/) 通过报告
`命中 rules[i]` 或 `无规则命中 → 回退 ask` 来区分。

## 效果

| 效果 | 模型可见列表 | 通过 `skill` 工具加载 |
|---|---|---|
| `allow` | 列出 | 允许 |
| `ask` | 列出 | 询问确认 |
| `deny` | 隐藏 | 拒绝（`permission.rejected`） |

粒度是 skill **id**，不是某个文件或某次调用。id 不存在时报
`Unable to load skill <id>`，这与权限拒绝是两个不同的错误。

## 求值的是谁的规则

每个 agent 都有自己的有效规则集。插件只对**调用者 agent** 求值，绝不把所有 agent 的规则
合并成一张表。合并是错的：子 agent（`explorer`、`title`……）带着自己的 `deny` 规则，
它们不适用于调用者。

典型分歧：全局配置 deny 了某个 skill，但某个 agent 自己有更靠后的 `allow`，或反过来。此时：

- `list` 显示调用者的状态，并提示其它 agent 不同。
- `inspect` 打印逐 agent 表。
- `disable` 会说明规则确实写入、但调用者实际效果仍不同，而不是谎称成功。

写在 `agents.<id>.permissions` 里的规则，本工具不编辑，只报告。

## 写哪个配置文件

全局配置按以下顺序解析：

1. `<config>`：设置了 `$XDG_CONFIG_HOME` 时是 `$XDG_CONFIG_HOME/opencode`，否则是
   `~/.config/opencode`（Windows 上 `C:\Users\<你>\.config\opencode`）。
2. 候选是 `<config>` 下的 `opencode.json`、`opencode.jsonc`；当 `~/.config/opencode`
   是另一个目录时，再加上那里的同名文件。`opencode.jsonc` 优先于 `opencode.json`。
3. 两个位置都含 `permissions` 数组时，选 `~/.config/opencode` 下的文件，并在输出里加警告。
4. 没有任何候选含 `permissions` 时，取最后一个已存在的候选；一个都不存在就新建
   `<config>/opencode.jsonc`。

**绝不写** `opencode.managed.json`。那是 OpenChamber 托管的第二份全局配置，写它会和宿主打架。

## 最小文本编辑

配置不会被解析成对象再序列化回去。插件按文本插入或删除特定条目，因此注释、缩进、键顺序、
尾逗号，以及文件自己的 CRLF/LF 与 BOM 都会保留。写前会解析并校验结果。

写入是原子的：同目录临时文件 `rename` 就位。写之前，在
`<config>/skill_management.backups/` 保存一份备份。

:::danger[备份含凭据]
全局配置常含 MCP 凭据，备份是逐字节副本。不要把它贴进 issue、提交到仓库，或当作无害证据。
:::

## sidecar

`<config>/skill_management.state.json` 记录本工具写过哪些规则（id、效果、文件、时间戳）。
它只是提示，不是真源：

- `enable` 优先认文件内的标记注释，只有找不到时才退回 sidecar。
- sidecar 与配置不一致时，`list` 报告差异，不「重放」任何东西。

行尾标记是刻意的：它是 sidecar 丢失后唯一还能存活的来源信息，其格式属于 1.x 兼容承诺。

## 模式

| 模式 | 匹配 |
|---|---|
| `windows-shell` | 恰好这个 id |
| `*` | 所有 skill |
| `pdf-*` | 以 `pdf-` 开头的 id |
| `?` | 恰好一个字符 |

优先用精确 id。通配的 `deny` 会被 `enable` 报告且不会自动删除 —— 删掉它影响的范围
远大于你点名的那一个 skill。

## 手写示例

```jsonc
{
  "permissions": [
    // 完全隐藏一个 skill
    { "action": "skill", "resource": "windows-shell", "effect": "deny" },

    // 保留在列表里，加载时询问
    { "action": "skill", "resource": "pdf-tools", "effect": "ask" }
  ]
}
```

手写规则没有标记时，只要 sidecar 有对应记录且规则唯一，`enable` 仍能删除。否则
`enable` 会把规则原文打印出来，由你手工处理。

下一步：[故障排查与 FAQ](../troubleshooting/)，看实践中的失败模式。
