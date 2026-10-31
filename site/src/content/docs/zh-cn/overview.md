---
title: 概览
description: opencode-skill-management 做什么、为什么用权限规则承载状态，以及它刻意不碰什么。
---

`opencode-skill-management` 是一个单文件的 OpenCode V2 插件。它注册一个原生工具
`skill_management`，包含四个动作：`list`、`inspect`、`disable`、`enable`。

它不安装、不删除、不移动、不改写任何 skill。它读取宿主当前的注册表；当你要求改动时，
只向全局 OpenCode 配置写入**一条精确的权限规则**。

## 它解决什么问题

**skill 列表变成噪音。** 每个已安装 skill 都会把名称和描述注入模型上下文。列表一长，
真正有用的条目更难被看见，而每一轮都要为其余部分付出代价。

**加载失败是个黑盒。** 一个 skill 可以已注册却在加载时被拒。此时关键问题不是「装没装」，
而是「哪条规则、对哪个 agent、在当前这一刻命中了」—— 答案通常要翻三层配置。

**停用一个 skill 的成本过高。** 改目录名或编辑 `SKILL.md` 当然有效，但那是真实的文件改动，
撤回时还得凭记忆。权限规则更小、可读、可逆。

## 模型

OpenCode 把 skill 权限当作规则列表求值，后匹配者胜，支持 glob。插件把这个规则当作它
唯一拥有的状态：

```jsonc
{ "action": "skill", "resource": "windows-shell", "effect": "deny" } // skill_management
```

- `disable` 在全局配置中追加这一条规则。
- `enable` 删除这一条规则。
- 两者都会让宿主重载，然后重新读取调用者 agent 的有效规则集来校验。宿主没有读入的写入
  会回滚，不会被报告成成功。

其余设计都由这一点推出：

| 性质 | 后果 |
|---|---|
| 不碰 skill 文件 | 改主意时没有东西需要恢复 |
| 规则按 agent 求值 | `list` 报告调用者的状态，而不是合并后的全局视图 |
| 无命中回退 `ask` | `ask` 可能是「显式软停用」，也可能是「一条规则都没命中」；`inspect` 会区分 |
| 只写全局配置 | 项目级配置、`policies`、agent 级规则只报告，不修改 |

:::note[输出格式]
每个动作返回一个 JSON 对象：`schemaVersion`、`action`、`ok`、`warnings`，加上本系列页面写明
的动作字段。1.2.x 中 `warnings`、`message`、`conclusion.message`、`error.message` 里的人类
可读文字是中文；字段名与字面量是稳定契约。
:::

## 第一次使用

下面几行是**工具调用**，不是 shell 命令：每一行都是传给原生工具 `skill_management` 的参数对象。

```text title="工具调用"
skill_management({ action: "list" })
skill_management({ action: "inspect", id: "windows-shell" })
skill_management({ action: "disable", id: "windows-shell", dryRun: true })
skill_management({ action: "disable", id: "windows-shell" })
skill_management({ action: "enable",  id: "windows-shell" })
```

`list` 只读，任何时刻都可以跑。两个写动作加 `dryRun` 时只在 `diff` 里返回将要增删的原文，不落盘。

## 它不会做什么

- 编辑、移动、删除、重装 skill，或改 `SKILL.md` frontmatter。
- 写项目级配置。
- 写 `policies` 或 `experimental.policies`。
- 编辑 agent 级 `agents.<id>.permissions`。
- 写 `opencode.managed.json`（OpenChamber 托管的第二份全局配置）。
- 删除一条无法唯一定位的规则。它会贴出候选然后停下。
- 当 agent 级规则仍然覆盖时，把规则说成「已生效」。

## 下一步

- 从三条通道中选一条[安装](../installation/)。
- 逐个看动作：[list](../actions/list/)、[inspect](../actions/inspect/)、
  [disable](../actions/disable/)、[enable](../actions/enable/)。
- 手工改规则前，先读[权限求值模型](../permissions/)。
