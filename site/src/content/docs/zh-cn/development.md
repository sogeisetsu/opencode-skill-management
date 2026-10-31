---
title: 开发与验收
description: 验收脚本的分段与闸门、CI 矩阵、npm 包里有什么，以及为什么两份插件不能并存。
---

仓库没有测试框架，也没有构建步骤。整套验收就是一个 Node 脚本，跑在临时配置目录上。

## 跑验收

```pwsh
node tools/verify.mjs                # 全量，333 项断言
node tools/verify.mjs --section E    # 只跑一段（A–J，按标题前缀匹配，大小写不敏感）
node tools/verify.mjs --keep         # 不删除临时目录（排查用）
```

每次运行都会新建 `mkdtemp` 目录并把 `XDG_CONFIG_HOME` 指过去，所以真实全局配置既不被读也
不被写。安装器那一步也有自己的临时 `XDG_CONFIG_HOME`，并且清掉 `OPENCODE_CONFIG` /
`OPENCODE_CONFIG_DIR`，避免把正在运行的实例的 npm 渠道误判成本机已装。

## 分段

| 段 | 覆盖 |
|---|---|
| A | 模块形状与纯度：default export、四个动作、只 import `node:`、无第三方依赖、不调用 shell / `eval` |
| B | `globMatch` 与权限求值：后匹配者胜，无命中回退 `ask` |
| C | 从路径反推 id、来源归类、`user` / `project` 作用域 |
| D | JSONC 文本编辑：插入、删除、新建块、CRLF、BOM、保留注释、严格校验、失败路径 |
| D2 | 用假 `env` / `home` 测目标文件解析：XDG、家目录、两个候选、两个目录 |
| E | 临时配置上的端到端：`list`、`inspect`、`dryRun`、`disable`、`enable`、备份、sidecar、回读校验、拒绝分支、同一文件的并发写，以及按 `OUTPUT_SCHEMA` 校验每个动作的 `output` |
| F | 从注册表反推 id（§3.5）与 `enable` 的归属边界 |
| G | 回读判据、只留一份备份、原子写、description 硬化 |
| H | 性能闸门 |
| I | 发布闸门 |
| J | 安装器冲突检测 |

E 段会把每个结果解析出来，按声明的 `output` schema 校验：必需字段、属性类型、`error.code` /
`error.message`，并断言 `content` 与 `output` 是同一份数据。它的负向用例保证校验器不是空转：
声明为 string 的位置塞 `null`、声明为 boolean 的位置塞字符串，都必须被报出来。

## Linux / WSL

```bash
bash tools/linux-verify.sh      # KEEP=1 保留临时目录
```

这是真宿主验收，不是单元测试。脚本自己下载 Node 与 `@opencode/cli`（版本由 `NODE_VERSION` /
`OPENCODE_VERSION` 固定），在仓库副本上跑验收，然后在临时 `HOME` 里加载插件并检查
`opencode plugin list --builtin`。需要 `curl`、`tar`、`gzip`，不需要 `sudo`，退出时删掉临时
目录。它还会在跑前跑后各拍一次真实 `~/.config/opencode` 与 `~/.local/share/opencode` 的快照，
被改过就报失败。

## CI

`.github/workflows/verify.yml` 在 `ubuntu-latest` 与 `windows-latest` 上用 Node 22 跑
`node tools/verify.mjs`。不需要任何 secret：全程不碰真实配置。
`.github/workflows/pages.yml` 构建文档站并跑 `npm run docs:check` —— 少路由、en/zh 路由不镜像、
站内死链、超出 base 的链接、语言切换不指向镜像页，都会让它失败。

## 两个闸门

**H —— 性能。** 29 skills × 12 agents × 10 rules，`list` 五次取最快，必须低于 25 ms。阈值刻意
放宽，避免 CI 抖动误报；它的作用是抓住意外的 O(n²) 或「每个 skill 重解析一次配置」。

**I —— 发布。** `npm pack --dry-run` 必须包含入口文件，且不含 `tools/`、`docs/`、CI 或仓库文档；
`exports["."]` 必须能按包名解析；安装出来的单文件副本必须与 `src/skill_management.js` 逐字节一致。

## npm 包里有什么

只有 5 个文件：

```text
package.json
README.md
CHANGELOG.md
LICENSE
src/skill_management.js
```

`package.json` 写了 `files: ["src", "CHANGELOG.md"]`，npm 再补 `package.json`、`README.md`、
`LICENSE`。测试、文档站、CI 与设计规范都留在仓库里。

## 为什么插件是单文件

宿主会把 `<config>/plugins/` 下的每个 `.js` / `.ts` 文件（含子目录）都当插件加载。把辅助模块
拆出去会变成第二个插件，校验直接失败。所以发布形态就是单文件，`tools/install.mjs` 复制的也
是这一份。

同理，两份不能并存：npm 条目与 `<config>/plugins/skill_management.js` 同时存在时，宿主报
`Duplicate plugin ID: skill_management`，其中一份显示为加载失败 —— 不是「两份都能用、只是忽略
一份」。切渠道用 `node tools/install.mjs --uninstall`（切到 npm）或
`opencode plugin remove opencode-skill-management`（切回单文件），改之前先跑
`node tools/install.mjs --check` 看清两处来源。

下一步：[设计取舍](../design-decisions/)，看这些行为为什么值得被这样测。
