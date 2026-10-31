---
title: 兼容性与 1.x 承诺
description: 宿主与运行时支持范围、1.x 内不破坏什么，以及明确不在范围内的部分。
---

## 支持矩阵

| 面 | 状态 |
|---|---|
| OpenCode V2 | 支持。1.1.0 在宿主 **2.0.32** 上完成验收。 |
| OpenCode V1 | 不针对，未测试。 |
| Windows | 已验证，包含新进程端到端。 |
| Linux | 已验证，包含新进程端到端。 |
| Node.js | **18 或更新**（插件运行在宿主进程内）。 |
| 运行时依赖 | 无。纯 Node 内置模块。 |
| shell 调用 | 无。 |
| 插件结构 | 单文件。 |

## 1.x 兼容承诺

在 1.x 内，以下内容不会以破坏性方式改变：

1. 四个动作（`list`、`inspect`、`disable`、`enable`）及其入参字段。
2. **JSON 结果信封**：`schemaVersion`、`action`、`ok`、`warnings`，以及 1.1.0 文档里写明的
   各动作字段。可以新增字段，但不会删除或改变已有字段的含义。
3. 写入的规则形状：
   `{ "action": "skill", "resource": <id>, "effect": "deny" | "ask" }`。
4. 行尾标记注释格式（`// skill_management`）。sidecar 丢失后，`enable` 靠它确认来源。
5. 单文件插件结构。

**1.1.0 是破坏性版本。** 它把 1.0.0 的 Markdown 输出换成了每次调用一个 JSON 对象。这是自
1.0.0 以来唯一的破坏性变更：动作、入参、规则形状、标记格式与文件结构都没变。

消息措辞不属于契约。1.1.0 中 `warnings`、`message`、`conclusion.message`、`error.message`
里的人类可读文字是中文；稳定的是信封、字段名与字面量（id、效果、规则 JSON、路径）。

## 「支持」不意味着

- **项目级配置不在范围内。** 项目可以有自己的 permissions。本插件只读写全局配置，并在
  `config.file` 里报告全局目标文件。
- **`policies` 不在范围内。** 插件上下文没有 `config` 域，读不到 policy 文档。policy 挡住某个
  skill 时，`enable` 只报告然后停下。
- **agent 级规则只读不写。** 它们出现在 `inspect.agents[]` 里，也可能对某个 agent 覆盖全局
  规则。工具会如实报告，而不是「顺手修好」。
- **宿主注册表内部接口属于内部实现。** 插件通过宿主的 transform API 读取 `ctx.skill` /
  `ctx.agent`，必要时消费 `{ location, data }` 信封。宿主改变这些形状属于兼容性事件，
  插件无法单方面抹平。
- **无网络访问。** 插件不向外请求；文档站也没有分析、cookie 或按语言跳转。

## 这一版是怎么验的

- `node tools/verify.mjs`：A–J 共 **326 项断言**，全部跑在临时配置目录（不碰真实用户配置）。
  E 段把每个结果都解析出来，并按声明的 `output` 契约校验。
- 同一套断言在 CI 的 `ubuntu-latest` 与 `windows-latest` 上运行。
- 端到端在**新进程**里跑，因为插件在宿主启动时加载。
- H 段是性能闸门：29 skills × 12 agents × 10 rules 下 `list` < 25 ms。
- I 段是发布闸门：打包内容、`exports` 可解析、安装副本逐字节一致。

细节与 Linux/WSL 验收脚本见[开发与验收](../development/)。

这些检查针对插件。文档站用 Astro + Starlight 单独构建，部署到 GitHub Pages。

## 升级

- patch 版本修行为，不改上面的接口。
- minor 版本可以增加输出字段，但不会删除或改变已有字段的含义。1.1.0 是文档里写明的例外：
  Markdown 输出被 JSON 取代。
- 宿主升级导致注册表或重载行为变化时，插件会写「未验证」，而不是编一个结论。不要用「没有报错」
  推断「已支持」。

## 版本

当前版本 **1.1.0**。npm 包名 `opencode-skill-management`，仓库
[sogeisetsu/opencode-skill-management](https://github.com/sogeisetsu/opencode-skill-management)。
MIT 许可。
