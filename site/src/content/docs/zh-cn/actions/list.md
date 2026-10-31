---
title: list
description: 所有已注册 skill、它们对调用者 agent 的有效状态，以及配置一致性提示。只读，输出 JSON。
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

一个 JSON 对象。四个动作共用同一层「信封」：

| 字段 | 类型 | 含义 |
|---|---|---|
| `schemaVersion` | number | 1.2.x 中为 `1`。 |
| `action` | string | `"list"`。 |
| `ok` | boolean | 注册表与配置都读到了就是 `true`。 |
| `warnings` | string[] | 人类可读的提示（1.2.x 为中文）；没有可提示的内容时为空数组。 |

`list` 另有：

| 字段 | 类型 | 含义 |
|---|---|---|
| `callerAgent.id` | string \| null | 按哪个 agent 的规则集求值。 |
| `callerAgent.verified` | boolean | `context.agent` 缺失或不在注册表里时为 `false`；会退回一个可见 agent，并在 `warnings` 里说明。 |
| `summary.total` | number | 已注册 skill 数。 |
| `summary.disabled` | number | 调用者效果为 `deny` 的数量。 |
| `summary.ask` | number | 调用者效果为 `ask` 的数量（显式规则或宿主回退）。 |
| `summary.diverged` | number | 在至少一个其它**可见** agent 下效果不同的数量。`hidden` 的内部 agent（`title`、`summary`……）不计入；它们的明细仍在 `inspect.agents[]` 里。 |
| `summary.derivedIds` | number | 注册表未给 id、由路径反推的数量。 |
| `skills[]` | object[] | 每个 skill 一项，按 id 排序。 |
| `skills[].id` | string \| null | 注册表 id，或由路径反推；两者都没有时为 `null`。 |
| `skills[].name` | string \| null | 注册表名称（不同时是 `frontmatter.name`）。 |
| `skills[].autoinvoke` | boolean \| null | `false` 表示注册表关闭了自动调用；注册表未提供时为 `null`。 |
| `skills[].source` | string | `embedded`、`config`、`claude`、`agents`、`catalog`、`project`、`plugin` 或 `unknown`。 |
| `skills[].scope` | string | `user` 或 `project`（相对 home 目录）。 |
| `skills[].state` | string | `available`、`disabled`、`ask` 或 `unknown`。**只按调用者 agent** 求值。 |
| `skills[].path` | string \| null | 注册表报告的绝对路径。 |
| `skills[].description` | string \| null | 描述第一行，不再额外截断。 |
| `config.file` | string | 写入会落到的全局配置文件。 |
| `config.configDir` | string | 解析出的 `<config>` 目录。 |
| `config.configDirs` | string[] | 参与判断的候选目录。 |
| `config.hadPermissions` | boolean | 目标文档原本是否已有 `permissions` 数组。 |
| `config.notes` | string[] | 为什么选这个文件。 |
| `sidecar.file` | string | `<config>/skill_management.state.json`。 |
| `sidecar.ok` | boolean | sidecar 是否读到。 |
| `sidecar.error` | string \| null | 读取失败原因；不猜它的语义。 |
| `consistency.staleSidecarIds` | string[] | sidecar 记录了、但配置里已无对应规则的 id。 |
| `consistency.unrecordedRules` | object[] | 配置里有、sidecar 不认识的 `skill` 规则：`resource`、`effect`。 |
| `consistency.missingFromRegistry` | string[] | sidecar 记录、但已不在注册表里的 id。 |

绝不包含 skill 正文。`warnings` 里的消息在 1.2.x 是中文；上面的字段名与取值才是稳定契约。

## 怎么读 `state`

- `available` —— 调用者最后命中的是 `allow`，或更早的 allow 没有被覆盖。
- `disabled` —— 最后命中的是 `deny`。该 skill 从模型可见列表隐藏，加载会被拒。
- `ask` —— 最后命中的是 `ask`，**或者一条规则都没命中**（宿主回退 `ask`）。`list` 分不清
  这两种情况，用 [`inspect`](../inspect/)。

状态刻意按单个 agent 求值。把所有 agent 的规则合在一起，会把子 agent 的 `deny` 泄漏到
调用者视图 —— 这个 bug 本项目已经修过一次。

## 输出示例

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

批量清理前跑一次，`disable` 之后再跑一次，确认状态真的变了。

某一行看起来不对时，下一步看 [`inspect`](../inspect/)。
