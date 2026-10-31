---
title: enable
description: 删除挡路的那一条精确全局规则 —— 无法唯一定位时返回 JSON 错误码并说明原因。
---

`enable` 从全局配置里删除挡路的规则。它**不**新增 `allow`：精确的 `deny`/`ask` 条目消失后，
skill 回到正常求值（如果再无规则命中，就是宿主的 `ask` 回退）。

规则不必是本工具写的，但必须能被唯一定位。

## 参数

| 名称 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `action` | `"enable"` | 是 | 选择动作。 |
| `id` | string | `id` / `name` 二选一 | 要恢复的 skill。 |
| `name` | string | `id` / `name` 二选一 | 别名，仅在唯一命中时使用。 |
| `dryRun` | boolean | 否 | 默认 `false`；`true` 只显示会删什么，不落盘。 |

```text
skill_management({ action: "enable", id: "windows-shell" })
skill_management({ action: "enable", id: "windows-shell", dryRun: true })
```

## 哪些规则算候选

同时满足：

- `resource` **精确等于**该 skill id；
- `effect` 为 `deny` 或 `ask`；
- `action` 经 glob 匹配 `skill`。

`allow` 不是挡路的规则，永远不会被删。通配 resource、agent 级 `permissions` 与 policies
也不是候选，只报告。

## 归属判定

1. **行尾标记注释。** 以 `// skill_management` 结尾的规则可以自证来源，即使 sidecar 丢失也认。
   这是正常路径。
2. **sidecar 记录，没有标记。** `<config>/skill_management.state.json` 里有该 id 的记录，且配置里
   恰好一条完全相同的规则时，删除并警告标记已被剥离。
3. **两者都没有。** 拒绝执行，返回配置里该规则的原文，文件保持原样。不会在多条相似规则里猜。

配置无法解析时同样拒绝：在语法错误的 JSONC 里定位并安全删除规则是不可能的。

## 它帮不上的情况

调用者确实被挡，但配置里没有该 id 的精确规则时，`enable` 会说明「挡路的不是这一行」：

- 通配或更宽的 `skill` 规则；
- `agents.<id>.permissions` 里的 agent 级规则；
- `policies` / `experimental.policies`（插件的上下文没有 `config` 域，读不到）。

这些情况只报告命中的规则，不代改。请手工处理。

## 执行顺序

1. 解析 skill 与调用者当前效果。
2. 读取目标配置，以及 sidecar 记录过的文件。
3. 定位候选精确规则，按上面的优先级选出唯一一条。
4. 删除该项；如果这次编辑让 `permissions` 块变空，一并清理。
5. 原子写入，保留缩进、键顺序、行尾与 BOM；保留一份备份。
6. 重载并轮询，直到调用者的精确规则条数减少，或超时
   （`SKILL_MGMT_VERIFY_TIMEOUT_MS`，默认 6 秒）。超时则恢复原字节。
7. 报告规则来源，以及**删除后**调用者的实际生效效果。如果仍被更宽的规则压成 deny，
   结果会明说，而不是暗示成功。

## 返回什么

通用信封（`schemaVersion`、`action`、`ok`、`warnings`）之外：

| 字段 | 类型 | 含义 |
|---|---|---|
| `id`、`dryRun` | string、boolean | 解析后的请求回显。 |
| `callerAgent` | string \| null | 用的是哪个 agent 的规则集。 |
| `before` | object | 删除前的 `index` 与 `rule`；无命中时 `rule` 为 `null`。 |
| `targetFiles` | string[] | 参与判断的文件（目标配置 + sidecar 记录过的文件）。 |
| `changed` | boolean | 只有真的删掉规则才是 `true`。 |
| `reason` | string | `changed` 为 `false` 时出现：`nothing_to_enable`。 |
| `message` | string | 空操作或 `dryRun` 的人类可读说明。 |
| `location` | object | `how` 为 `marker` 或 `sidecar`；`origin` 是文字说明。 |
| `rule` | object | `file` 与被删（或可删）规则的原文 `text`。 |
| `diff` | string[] | `dryRun` 时将被删除的那一行。 |
| `backup` | string | 被编辑文件的备份路径。 |
| `sidecar` | string \| null | 成功后写入的 sidecar 路径；写不进去时为 `null`（删除仍然成立，`warnings` 说明记录已过期）。 |
| `verification` | object | `ok`、`via`、`caller`，以及删除后的 `effect`。 |

成功时还会说明是否顺手清理了变空的 `permissions` 块；如果调用者仍因更宽的规则而为 `deny`，
`warnings` 里会给出那条规则。

## 错误

| `error.code` | 何时 | 附带字段 |
|---|---|---|
| `unverifiable_origin` | 既无标记也无 sidecar 记录能确认该规则。 | `rule`：规则原文 |
| `ambiguous_rule` | 同一 id 有多条精确规则。 | `candidates[]`：`file`、`text` |
| `no_matching_rule` | 没有精确规则；挡路的是更宽的规则。 | `relatedRules[]`、`callerHit` |
| `config_unparsable` | 目标配置有 JSONC 语法错误。 | `warnings` |
| `verification_failed` | 宿主没有及时丢掉该规则。 | `rolledBack: true` |
| `skill_not_found` / `name_ambiguous` / `missing_param` | 目标解析失败。 | `near` / `candidates` |

```json
{
  "schemaVersion": 1,
  "action": "enable",
  "ok": false,
  "warnings": [],
  "error": {
    "code": "ambiguous_rule",
    "message": "拒绝执行：配置里有 2 条精确命中 `windows-shell` 的规则，无法唯一定位（宿主求值是最后一条命中算数）。"
  },
  "id": "windows-shell",
  "changed": false,
  "candidates": [
    { "file": "<config>\\opencode.jsonc", "text": "{ \"action\": \"skill\", \"resource\": \"windows-shell\", \"effect\": \"deny\" } // skill_management" },
    { "file": "<config>\\opencode.jsonc", "text": "{ \"action\": \"skill\", \"resource\": \"windows-shell\", \"effect\": \"deny\" }" }
  ]
}
```

## 常见结果

| 情况 | 结果 |
|---|---|
| 本工具写入、标记完整 | `ok: true`，`location.how = "marker"`。 |
| 标记被剥离，sidecar 恰好一条 | `ok: true`，`location.how = "sidecar"`，并警告核对配置。 |
| 同一 id 有两条相同规则 | `ok: false`，`ambiguous_rule`，打印候选。 |
| 被 `resource: "*"` 挡住 | `ok: false`，`no_matching_rule`，`relatedRules` 给出宽规则。 |
| 只在某个 agent 自己的规则里被挡 | `ok: false`，`no_matching_rule`，`callerHit` 点名该 agent。 |
| 没有规则，也没被挡 | `ok: true`，`changed: false`，`reason: "nothing_to_enable"`。 |

## 写不写配置？

写，除非 `dryRun: true`，并且只在找到唯一精确规则时写。拒绝执行时零写入。

下一步：读[权限规则与求值模型](../../permissions/)，理解规则删掉之后会发生什么。
