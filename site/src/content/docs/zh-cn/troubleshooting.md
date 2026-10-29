---
title: 故障排查与 FAQ
description: 诊断插件不出现、意外的 ask 状态、被覆盖的规则、enable 拒绝与配置不一致。
---

先做只观察不改动的动作：`list`，然后对看起来不对的 skill 跑 `inspect`。下面几乎所有问题，
答案都在 `inspect` 贴出的那条规则里。

## 插件不出现

**`opencode plugin list --builtin` 显示 `No plugins found`。** 加 `--builtin`：不带它时，
本地加载的插件不会列出。全新的配置目录里，前两次调用也可能为空，再跑一次。

**刚装上但没生效。** 插件在进程启动时加载。重启 OpenCode（或开新进程）再查。

**用的是通道三。** 确认目标存在：`<config>/plugins/skill_management.js`。`<config>` 在设置了
`$XDG_CONFIG_HOME` 时是它下面的 `opencode`，否则是 `~/.config/opencode`。
`node tools/install.mjs --dry-run` 会打印确切路径。

**`plugins/` 里多了第二个文件。** 该目录下每个 `.js`/`.ts` 都会被当成插件加载。辅助模块或
第二份副本会被一起加载并可能校验失败。让 `skill_management` 保持单文件。

## 模型找不到这个工具

`skill_management` 是原生工具，`codemode: false`。它刻意不在 Code Mode 的
`search()` / `execute()` 目录里。只查那个目录的模型会得出「工具不存在」的结论然后放弃。
让它直接按名字调用。

## skill 装了却加载不了

运行：

```text
skill_management({ action: "inspect", id: "<id>" })
```

结论会写明效果和命中的确切规则。常见原因：

- 该 id 有一条 `deny` 规则，可能是之前写的。
- 更靠后的宽规则（`resource: "*"`）拒绝了比你预期更多的 skill。
- `agents.<id>.permissions` 里的 agent 级规则，对调用者覆盖了全局配置。
- id 写错了：未知 id 报 `Unable to load skill <id>`，这不是权限错误。

## `list` 显示 `ask`，是停用了吗？

不一定。`ask` 有两个来源：显式 `effect: "ask"` 的规则，或者**一条规则都没命中**（宿主回退
`ask`）。`inspect` 能区分：

- `命中 rules[i] = {...}` → 显式规则。
- `无规则命中 → 回退 ask` → 根本没有规则。

想让 skill 完全隐藏，用 `effect: "deny"`，不要用 `"ask"`。

## `disable` 说写了规则，但 skill 仍然可用

读校验段落。插件区分三种结果：

1. **写入且对调用者有效。** 调用者效果为 `deny`。
2. **写入成功，但调用者仍被覆盖。** 输出报告实际效果，通常因为该 agent 自己有更靠后的规则。
   其它 agent 可能已经看到新规则。
3. **校验失败。** 原文件已恢复，输出会说明回滚。

第 2 种不是写入 bug，而是规则顺序的事实。`inspect.agents[]` 有逐 agent 结果。覆盖规则需要你自己删除或
修改 —— 插件不编辑 agent 级权限。

## `disable` 什么都没改，说已经是停用状态

这是预期的 no-op。如果是宽规则造成的，输出会贴出那条规则，并说明给这个 id 再加一条是多余的。

## `enable` 拒绝执行

数一下原因：

- **没有该 id 的精确规则。** 挡路的是更宽的规则（`resource: "*"`）、agent 级规则或 policy。
  输出会贴出来。请手工修改。
- **候选多条。** 同一个 id 有两条规则，或两行带标记。工具不会替你挑。
- **既无标记也无 sidecar 记录。** 手写规则若 sidecar 不认识，会原样打印。确认是它再手工删除。
- **配置无法解析。** 先修 JSONC 语法。工具不会编辑一个连条目都定位不了的文档。
- **sidecar 与配置不一致。** `list` 会报告差异。用 `inspect` 看实际生效的是什么。

## 规则已经在文件里，但宿主没读进去

配置重载是异步的。`disable` 与 `enable` 已轮询最多 6 秒。机器更慢时，在启动 OpenCode 前设置
`SKILL_MGMT_VERIFY_TIMEOUT_MS`（毫秒）。超时会触发回滚，所以文件不会停在「半校验」状态。

## 改的是哪个文件？

输出会打印解析出的目标文件及选择理由。简版：`opencode.jsonc` 优先于 `opencode.json`，
`<config>` 受 XDG 影响；`~/.config/opencode` 下还有第二份 `permissions` 数组时会告警并优先
那一份。`opencode.managed.json` 永不写入。详见[权限规则与求值模型](../permissions/)。

## 能撤销停用吗？

能，用同一个 id 执行 `enable`，它会删掉那条精确规则。
`<config>/skill_management.backups/` 里的那一份备份用于写入事故恢复，不是版本历史。

## 它会删除或修改 skill 吗？

不会。它不碰 skill 文件、`SKILL.md` frontmatter、目录、项目配置、`policies` 或 agent 级权限。
它读注册表，只改全局 `permissions` 数组。

## 备份能分享吗？

不能。它是配置文件的逐字节副本，而该配置通常含 MCP 凭据。不要提交、不要作为附件贴进 issue、
不要粘进聊天。报告问题时只引用相关规则原文 —— `inspect` 的输出已经做到了这一点。

## `name` 命中了多个 skill

用 id。重名会返回候选 id，不会挑一个。`disable` 与 `enable` 同理。

## 未知动作

四个动作是 `list`、`inspect`、`disable`、`enable`。其它值会返回列出这四个动作的错误。
`action` 字段必填。

## `list` 的数量和模型看到的不一致

`list` 统计所有已注册 skill。模型可见列表按 agent 过滤，并排除对该 agent 为 deny 的 skill。
`list` 里的 `deny` 行本来就不该出现在模型视野里 —— 这正是停用的目的。

## Windows 上路径或 id 看起来不对

注册表给了 id 就直接用；没给才按路径反推：`<dir>/SKILL.md` → 目录名，
`<dir>/<name>.md` → 去掉 `.md` 的文件名。`inspect` 会打印推导过程和实际使用的路径。
`source` 与 `scope` 也按该路径归类，所以不常见的符号链接或盘符映射可能改变标签，但不改变 id。
