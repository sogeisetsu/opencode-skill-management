---
title: inspect
description: 单个 skill 的详情 —— 结论、命中规则、逐 agent 差异、id 来源。只读，输出 JSON。
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

与四个动作相同的信封（`schemaVersion`、`action`、`ok`、`warnings`），另有：

| 字段 | 类型 | 含义 |
|---|---|---|
| `matchedBy` | string | `id` 或 `name`。 |
| `skill.id` | string \| null | 解析出的 skill id。 |
| `skill.name` | string \| null | 注册表名称。 |
| `skill.nameDiffersFromId` | boolean | `frontmatter.name` 是否覆盖了 id。 |
| `skill.path` | string \| null | 注册表里的路径。 |
| `skill.source` / `skill.scope` | string | 与 `list` 相同。 |
| `skill.description` | string \| null | 注册表描述的第一行。 |
| `skill.autoinvoke` | boolean \| null | 注册表的值；未提供时为 `null`。 |
| `skill.frontmatter` | object | `name` 与 `disableModelInvocation`，读不到时为 `null`。 |
| `idDerivation.idSource` | string | `registry`、`derived` 或 `none`。 |
| `idDerivation.explained` | string | 用一句话说明 id 是怎么来的。 |
| `idDerivation.rule` | string \| null | 推导规则的原文。 |
| `idDerivation.pathField` | string \| null | 用作路径的注册表字段（`path` 或 `location`）。 |
| `idDerivation.dir` / `idDerivation.base` | string \| null | 推导的输入。 |
| `agents[]` | object[] | 逐 agent 求值：`id`、`effect`、`index`、`rule`（无命中时为 `null`）。 |
| `divergentAgents[]` | object[] | 与调用者结果不同的 agent：`id`、`effect`。 |
| `caller` | object | `id`、`effect`、`index`、`rule`、`coveredByBroaderRule`、`broaderRule`。 |
| `conclusion.state` | string | `available`、`disabled` 或 `ask`。 |
| `conclusion.message` | string | 同一结论的完整句子。 |

`index` 是该 agent 规则集里最后一条命中规则的下标；`-1` 表示没有规则命中、由宿主回退
`ask`。读不到的值一律为 `null`，不编造。

### id 推导

注册表直接给了 `id` 时 `idSource` 为 `registry`，同时列出路径供核对；没给则按路径反推：

- `<dir>/SKILL.md` → 取所在目录名。
- `<dir>/<name>.md` → 取文件名去掉 `.md`。

既没有 id 也没有可用路径时 `idSource` 为 `none`、`rule` 为 `null`，并按空 id 处理。

### 逐 agent 求值

`agents` 就是 `list` 提示「其它 agent 不同」时指向的数据。它不是合并结果：每一项都按那个
agent 自己的最终规则集求值。

### 结论

- `disabled` —— 效果为 `deny`，模型可见列表会隐藏它，加载被拒。
- `ask` —— 效果为 `ask`，仍在列表里，加载时询问。
- `available` —— 其它不阻塞的效果。

如果调用者是被通配或更宽的规则挡住（命中的 `resource` 不是这个 skill 的 id），
`caller.coveredByBroaderRule` 为 `true`，`caller.broaderRule` 就是那条规则：skill 确实被挡，
但给这个 id 再加一条规则不是解决办法。

## 错误

| `error.code` | 何时 |
|---|---|
| `skill_not_found` | 没有 id 命中。`near` 列出注册表里的相近 id。 |
| `name_ambiguous` | 名称命中多个 skill。`candidates` 列出它们的 id。 |

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

## 输出示例

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

## 什么时候用

- `list` 显示 `ask`，需要确认是规则写了 `ask`，还是根本没命中。
- skill 装了却加载不了。
- `disable` 说规则写进去了，但调用者看到的效果不同。
- 执行 `enable` 前，确认到底哪条规则在挡路。

id 本身找不到时，`inspect` 返回注册表里的相近 id，而不是猜一个。

下一步：[`disable`](../disable/) 处理你看到的问题。
