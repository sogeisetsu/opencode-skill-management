---
title: 安装
description: 三条加载通道（git spec、npm、单文件）以及如何确认插件已加载。
---

插件是一个 JavaScript 文件，没有第三方运行时依赖。任选一条通道，落到磁盘上的都是同一份代码。

## 环境要求

- OpenCode **V2**。1.1.0 在宿主 2.0.32 上完成验收，覆盖 Windows 与 Linux，包含新进程端到端。
- 运行 OpenCode 的环境需要 Node.js **18 或更新版本**。
- 不需要 token、注册表账号或构建步骤。

## 通道一 —— git spec（推荐）

```pwsh
opencode plugin add github:sogeisetsu/opencode-skill-management
```

OpenCode 直接拉取仓库，不经过 npm 注册表，也没有发布环节。

## 通道二 —— npm

```pwsh
opencode plugin add opencode-skill-management
```

npm 包只导出一个入口：`./src/skill_management.js`。运行时依赖：无。

## 通道三 —— 直接复制单文件

离线机器或自建分发更适合这条通道：

```pwsh
node tools/install.mjs          # 复制到 <config>/plugins/skill_management.js
node tools/install.mjs --dry-run
```

安装器是幂等的：目标文件内容逐字节相同就什么都不做。`<config>` 在设置了
`$XDG_CONFIG_HOME` 时是 `$XDG_CONFIG_HOME/opencode`，否则是 `~/.config/opencode`
（Windows 上是 `C:\Users\<你>\.config\opencode`）。

OpenCode 会加载 `<config>/plugins/` 下的每个 `.js`、`.ts` 文件以及子目录。不需要在
`opencode.jsonc` 里登记。

:::caution[插件目录必须保持单文件]
`plugins/` 下的每个文件都会被当成插件加载。不要把 `skill_management` 拆成辅助模块，也不要
在旁边放第二份副本。分发形态刻意保持单文件，原因就在这里。
:::

## 确认已加载

```pwsh
opencode plugin list --builtin
```

`--builtin` 不能省。不带它时，本地目录加载的插件不会出现在列表里，可能显示
`No plugins found`。

输出里应出现 `skill_management`，source 为 `local`（通道一、二显示包来源）。全新的配置
目录里，前两次调用可能为空，再跑一次即可。

然后让模型调用工具，或自己调用：

```text
skill_management({ action: "list" })
```

`list` 返回里的 `config.file` 与 `skills[]`，足以确认插件读到了宿主注册表。

## 加载说明

- 插件在 OpenCode 进程启动时加载。新装的插件出现在下一个进程里，不会出现在已经运行的进程里。
- `skill_management` 注册为**原生工具**，`codemode: false`。直接按名字调用；它不在 Code Mode
  的 `search()` / `execute()` 目录里，「那里找不到」不等于没装上。
- 工具只写全局配置，绝不写项目配置。

装好后继续看[概览](../overview/)，或直接进入 [`list`](../actions/list/)。
