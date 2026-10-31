---
title: disable
description: 写一条精确的全局权限规则，让 skill 从列表隐藏并在加载时被拒 —— JSON 结果、dryRun、软停用与校验失败回滚。
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
| `dryRun` | boolean | 否 | 默认 `false`；`true` 只返回会变的行，不落盘。 |

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
   `resource: "*"`）造成的，结果里会给出那条规则，并说明给这个 id 新增规则是多余的。
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
7. **失败回滚。** 校验不通过就恢复原字节，并在结果里说明。不会留下半成品配置。
8. **记录来源。** 成功后向 `<config>/skill_management.state.json` 写入 id、效果、文件与时间戳。
   这份 sidecar 用于在标记注释被别的工具剥掉后，帮助 `enable` 找到规则。

## 返回什么

通用信封（`schemaVersion`、`action`、`ok`、`warnings`）之外：

| 字段 | 类型 | 含义 |
|---|---|---|
| `id`、`effect`、`dryRun` | string、string、boolean | 解析后的请求回显。未传 `ask` 时 `effect` 为 `deny`。 |
| `callerAgent` | string \| null | 用的是哪个 agent 的规则集。 |
| `before` | object | 改动前的 `index` 与 `rule`；无命中时 `rule` 为 `null`。 |
| `targetFile` | string | 全局配置文件。 |
| `configNotes` | string[] | 为什么选这个文件。 |
| `changed` | boolean | 只有真的改了配置才是 `true`。 |
| `reason` | string | `changed` 为 `false` 时出现：`already_disabled` 或 `covered_by_broader_rule`。 |
| `message` | string | 空操作或 `dryRun` 的人类可读说明。 |
| `planned` | boolean | `dryRun` 时为 `true`。 |
| `createdBlock` | boolean | 是否新建了 `permissions` 块。 |
| `diff` | string[] | 实际写入（或将要写入）的变动行原文。 |
| `backup` | string \| null | 目标原本存在时的备份路径。 |
| `sidecar` | string \| null | 成功后写入的 sidecar 路径；写不进去时为 `null`（配置改动仍然成立，`warnings` 说明原因）。 |
| `verification` | object | `ok`、`via`、`caller`、`expected`、`actual`、`beforeCount`、`count`、`diverged`。 |

`verification.via` 写明重载/轮询路径，并带精确规则条数的变化（例如 `精确规则数 0→1`）——
宿主没读进规则就不可能被写成成功。

规则确实写入并被宿主读入、但**调用者**的实际效果仍是别的值（该 agent 自己的规则排在后面
覆盖了它）时，`verification.actual` 会与 `expected` 不同，`warnings` 会说明这对该调用者
并未生效；其它 agent 的差异同样列出。两者都不会被说成「已生效」。

## 输出示例

```json
{
  "schemaVersion": 1,
  "action": "disable",
  "ok": true,
  "warnings": [],
  "id": "windows-shell",
  "effect": "deny",
  "dryRun": false,
  "callerAgent": "build",
  "before": { "index": 0, "rule": { "action": "*", "resource": "*", "effect": "allow" } },
  "targetFile": "<config>\\opencode.jsonc",
  "configNotes": ["目标文件含现有 permissions，直接在其数组中追加/删除"],
  "changed": true,
  "createdBlock": false,
  "diff": ["    { \"action\": \"skill\", \"resource\": \"windows-shell\", \"effect\": \"deny\" } // skill_management"],
  "backup": "<config>\\skill_management.backups\\opencode.jsonc.2026-10-30T01-02-03-456Z.bak",
  "sidecar": "<config>\\skill_management.state.json",
  "verification": {
    "ok": true,
    "via": "ctx.agent.reload() + ctx.agent.list()（轮询 1 次；精确规则数 0→1）",
    "caller": "build",
    "expected": "deny",
    "actual": "deny",
    "beforeCount": 0,
    "count": 1,
    "diverged": []
  }
}
```

## 错误

| `error.code` | 何时 | 是否动文件 |
|---|---|---|
| `verification_failed` | 宿主没有及时回读到该规则。`rolledBack: true`，原字节已恢复。 | 已回滚 |
| `skill_not_found` | 没有 id 命中。`near` 列出相近 id。 | 否 |
| `name_ambiguous` | 名称命中多个 skill。`candidates` 列出 id。 | 否 |
| `missing_param` | `id` 与 `name` 都没给。 | 否 |

```json
{
  "schemaVersion": 1,
  "action": "disable",
  "ok": false,
  "warnings": [],
  "error": { "code": "verification_failed", "message": "回读校验失败（期望 deny，实际 allow）；已回滚，文件未留下半成品。" },
  "id": "windows-shell",
  "effect": "deny",
  "changed": false,
  "rolledBack": true
}
```

## 软停用

`effect: "ask"` 让 skill 保留在模型可见列表里，每次加载都要确认。适合「不想让它被静默调用，
但仍要可用」的场景。

如果调用者已经是 `deny`，`disable` 会返回 `ok: true`、`changed: false`、
`reason: "already_disabled"` 并且不做修改 —— 它不会把 deny 降级成 `ask`。先执行
[`enable`](../enable/)，再用 `effect: "ask"` 执行 `disable`。每次成功调用追加一条规则；
同一 id 以最后一条为准。

## 写不写配置？

写，除非 `dryRun: true`。只改全局配置的 `permissions` 数组；项目配置、agent 级权限与
policies 都不在范围内。

下一步：[`enable`](../enable/) 把它撤回来。
