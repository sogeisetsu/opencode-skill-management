---
title: disable
description: 写一条精确的全局权限规则，让 skill 从列表隐藏并在加载时被拒 —— 支持 dryRun、软停用与校验失败回滚。
---

`disable` 在**全局**配置里追加一条精确规则：

```jsonc
{ "action": "skill", "resource": "<id>", "effect": "deny" } // skill_management
```

`deny` 会让 skill 从模型可见列表消失，内置 `skill` 工具加载时被权限拒绝。
`effect: "ask"` 是软停用：仍然列出，加载时确认。

它绝不编辑、移动或删除 skill 文件。

## 参数

| 名称 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `action` | `"disable"` | 是 | 选择动作。 |
| `id` | string | `id` / `name` 二选一 | 要停用的 skill id。 |
| `name` | string | `id` / `name` 二选一 | 别名，仅在唯一命中时使用。 |
| `effect` | `"deny"` \| `"ask"` | 否 | 默认 `deny`；`ask` 为软停用。 |
| `dryRun` | boolean | 否 | 默认 `false`；`true` 只打印会变的行，不落盘。 |

`id` 优先于 `name`。重名会返回候选而不是替你挑一个；未知 id 返回相近项。两者都是错误，
不会产生写入。

```text
skill_management({ action: "disable", id: "windows-shell" })
skill_management({ action: "disable", id: "windows-shell", dryRun: true })
skill_management({ action: "disable", id: "windows-shell", effect: "ask" })
```

## 执行顺序

1. **解析目标**：按注册表匹配 id，或唯一名称。
2. **读调用者当前效果。** 已经是 `deny` 就不写任何东西；如果是更宽的规则（例如
   `resource: "*"`）造成的，输出会贴出那条规则，并说明给这个 id 新增规则是多余的。
3. **解析全局配置文件。** 读取候选文件，`opencode.jsonc` 优先于 `opencode.json`，
   **绝不写** `opencode.managed.json`。完整顺序见[权限规则与求值模型](../../permissions/)。
4. **最小文本编辑。** 把规则插入已有的 `permissions` 数组（没有则创建），保留缩进、键顺序、
   行尾风格（CRLF/LF）与 BOM。写前解析并校验整份文档。
5. **原子写入。** 同目录临时文件 `rename` 覆盖目标。目标原本存在时，在
   `<config>/skill_management.backups/` 保留**一份**备份。备份是目标文件的逐字节副本，
   而该文件常含 MCP 凭据，按机密对待。
6. **重载并校验。** 调用宿主的 agent reload，然后轮询调用者的规则集，最多 6 秒
   （`SKILL_MGMT_VERIFY_TIMEOUT_MS` 可覆盖）。
   - `deny` 的判据是调用者有效效果确实为 `deny`。
   - `ask` 的判据是精确的 `{skill, id, ask}` 规则**条数增加**。「不是 deny」不算数：
     宿主对无命中的回退也是 `ask`。
7. **失败回滚。** 校验不通过就恢复原字节，并在输出里说明。不会留下半成品配置。
8. **记录来源。** 成功后向 `<config>/skill_management.state.json` 写入 id、效果、文件与时间戳。
   这份 sidecar 用于在标记注释被别的工具剥掉后，帮助 `enable` 找到规则。

## 怎么读结果

输出会写明调用者 agent、当前效果、目标文件及选择理由，然后给出实际变化的 JSONC 原文。
`dryRun` 模式以 `dryRun：未写入任何文件。` 结尾。

成功写入以校验行结束。两种「诚实的分支」值得注意：

- 规则确实写入并被宿主读入，但**调用者**的实际效果仍是别的值（因为该 agent 自己的规则排在
  后面覆盖了它），输出会说明文件里已有规则，并报告实际效果，不会把它说成对该调用者已生效。
- 其它 agent 结果不同时，会列出它们的 id 与效果。

## 软停用

`effect: "ask"` 让 skill 保留在模型可见列表里，每次加载都要确认。适合「不想让它被静默调用，
但仍要可用」的场景。

如果调用者已经是 `deny`，`disable` 会报告「已经是停用状态」并不做修改 —— 它不会把 deny 降级成
`ask`。先执行 [`enable`](../enable/)，再用 `effect: "ask"` 执行 `disable`。每次成功调用追加一条
规则；同一 id 以最后一条为准。

## 写不写配置？

写，除非 `dryRun: true`。只改全局配置的 `permissions` 数组；项目配置、agent 级权限与
policies 都不在范围内。

下一步：[`enable`](../enable/) 把它撤回来。
