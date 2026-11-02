---
name: starlight-docs
description: "Build, audit and repair an Astro Starlight documentation site on GitHub Pages: detect the repo's framework/Node/Pages state, scaffold a site/ (or root) skeleton with site-local dependencies, assert routes/base/dead links/lang/i18n parity on the built HTML, emit the checker into the target repo's CI, and report what only a human can verify. Use for new docs sites, existing-site audits, bilingual root + locale docs, dead-link or route-mirror failures, and GitHub Pages workflow setup."
---

# starlight-docs

把「给一个 GitHub 仓库建/体检 Starlight 文档站」变成一条确定性命令。所有判断都来自脚本实际读到的构建产物与配置，不靠记忆，也不改被操作仓库之外的任何东西。

## 适用前提

- 目标是一个 **GitHub 仓库**（本地路径即可）；部署目标默认 GitHub Pages。
- 站点用 **Astro + @astrojs/starlight**；其它框架只做只读体检与迁移建议，不改文件。
- 构建 Node 必须 **>= 22.12.0**（Astro 6.4 的 `engines`，低于它是硬失败，不是警告）。
- 用户消息里有额外要求（只出报告、只改某目录、别装依赖）：**以那条为准**。

## 唯一入口

```pwsh
node <skill>/scripts/site.mjs --action <detect|scaffold|check|audit|emit-check> --repo <被操作仓库> [flags]
```

`<skill>` 是这个 skill 所在目录。**只调用这一个脚本**；`scripts/lib/*.mjs` 是内部模块，不要直接跑。
不假定 cwd：`--repo` 决定改哪个仓库，资源路径都从 `import.meta.url` 推导。

## 先分清两条路

| 情形 | 动作顺序 |
|---|---|
| 仓库还没有文档站 | `detect` →（按需）`references/new-site.md` → `scaffold --dry-run` → `scaffold --apply` → `check` |
| 已有文档站，要体检/改版 | `audit` → 按 `next` 读对应 reference → 人工修，再 `check` 复核 |
| 只想确认检查口径 | `check`（默认 `core`；有 landing 布局才加 `--profile landing`） |
| 要把它接进目标仓库 CI | `emit-check --out <repo>/<dir>/scripts/check-dist.mjs`，再按需接 workflow |

`fix` / `pages` 属于第二期，v1 不认识；传了会得到 `unknown_action` 与可用动作列表。

## detect：先读事实，别猜

```pwsh
node <skill>/scripts/site.mjs --action detect --repo <repo>
```

读 `framework`、`mode`/`suggestedMode`、`node.ok`、`packageManager`、`git.owner`、`pages.status`：

- `pages.status: "unverified"` 是**未验证**，不是「没启用」。`gh` 未登录、无 remote、无网络都会这样，不要据此下结论。
- `node.ok: false` 时先解决 Node（升 Node 或钉旧版 Astro），v1 不做自动降级。
- `suggestedMode` 已经按「有代码 → `site/`；纯文档 → 根目录」判过；要覆盖用 `--mode`。

## scaffold：默认 dry-run

```pwsh
node <skill>/scripts/site.mjs --action scaffold --repo <repo> --apply `
  [--mode site|root] [--dir site] [--owner <gh-owner>] [--name <repo>] `
  [--site https://owner.github.io] [--base /repo] [--locales root,zh-cn] `
  [--preset none|developer-dark] [--components auto|theme|theme+lang|none] `
  [--search pagefind|none] [--pages workflow|none] [--node 22] `
  [--astro ^6.4.8] [--starlight ^0.40.0] [--package-manager npm|pnpm|yarn|bun]
```

- 只写 `--repo` 内的文件；**从不**改根 `package.json` 的依赖、lockfile、`files`/`exports`。
- 已有文件默认 `skip`；要覆盖必须显式 `--force`（覆盖前写一份到系统临时目录的备份，路径见 `backups`）。
- 生成的是**骨架**：首页 + `overview` 占位页（按 locale 镜像）、`astro.config.mjs`、站点 `package.json`、`public/favicon.svg`、`.gitignore`、Pages workflow，可选组件/CSS 预设。不臆造正文。
- `--search` 默认 `none`：Pagefind 在 Windows 上可能没有二进制，小站不需要搜索。要全文搜索显式传 `pagefind`。
- `--components` 默认 `auto`：总是生成 `ThemeSelect`（原生 `<select>` 弹层控不了），多语言时再加 `LanguageSelect`。
- `--preset` 默认 `none`（Starlight 原生主题）；`developer-dark` 才会带裁剪版 `sd-*` CSS 与「默认深色」seed 脚本。
- `scaffold` **不装依赖、不构建**；失败/缺 lockfile 之类会在 `notes`/`findings` 里写出来。

## check：core 断言

```pwsh
node <skill>/scripts/site.mjs --action check --repo <repo> [--profile landing] `
  [--dist <path>] [--base /repo] [--locales root,zh-cn] [--i18n auto|off] `
  [--check-links all|internal|off] [--max-links <n>] [--no-install] [--no-build]
```

- 会先装依赖（缺 `node_modules` 时）再构建，然后断言：路由集合、多语言镜像、`<html lang>`、每页一个 `<h1>`、站内死链、`base` 越界、`navigator.language`/`accept-language` 跳转、语言切换器映射到同一 slug、frontmatter description。
- 默认**不联网**。`--check-links all` 才 HEAD 外部链接（有超时，失败只记 `warn`）。
- `--profile landing` 只对 splash 首页生效，**缺 `.sd-*` 类名只报 `info`**：只有 scaffold 生成的那套布局才值得开。
- `--base`/`--locales` 缺省从 `astro.config` 读；读不到就是 `''` / `root`，会在 `next` 里指出来。

## audit：先识别框架

```pwsh
node <skill>/scripts/site.mjs --action audit --repo <repo> [--profile core|landing] `
  [--browser-report <report.json>] [--baseline <report.json>]
```

- `starlight`：构建 + `core` 全套 + 404 / search / canonical / OG / theme-color / robots / sitemap / sidebar 一致性。
- `astro`（无 Starlight）/ `static-html`：**只报告**通用 Pages 体检（构建方式、`https_enforced`、404、robots/sitemap）+ 迁移要点；不写任何目标文件。
- 视觉/交互（hover、selected、CJK 行距、卡片对齐）脚本判不了：`--browser-report` 只消费外部写入的 JSON，人工清单见 `references/audit.md`。
- `--baseline` 会输出 `regressions`：相对上一份报告新增的项。

## emit-check：单向导出检查器

```pwsh
node <skill>/scripts/site.mjs --action emit-check --repo <repo> --out <repo>/site/scripts/check-dist.mjs [--dry-run]
```

- 导出物是**同一份断言源码**渲染成的自包含脚本：零依赖、只需要 Node、不读 skill、不读配置；`base`/locales/dist 在导出时内联。
- 它是**一次性快照**：skill 升级后必须重导；文件头有「勿手改」标记。
- 缺 `--out` 直接报 `missing_out`，不猜路径。这是唯一默认写盘的动作（`--dry-run` 预览）。

## 怎么读输出

- 先看 `ok` 与 `counts`（error / warn / info），再看 `findings`：每条有 `code`、`severity`、`message`，尽量带 `path`。
- **`next` 是按需加载的唯一开关**：只有列出的 reference 才读，`reason` 是触发它的 `code`。没列出就别读。
- `error` 必须修；`warn` 要判断（例如 `DESCRIPTION_MISSING` 可能是有意的）；`info` 是提示，不等于缺陷。
- `--md` 出 Markdown 表；`--report <path>` 同时落盘；`--fail-on <error|warn|info|off>` 决定退出码（默认 `error`）。

## 硬边界（不可越）

- 不写用户全局配置，不 `git push`，不改 GitHub 仓库设置（启用 Pages 是第二期）。
- 写入范围严格限制在 `--repo` 内（`emit-check` 只写 `--out`）。
- 不删、不移动目标仓库的文件；覆盖必须先 `--force`。
- 检查逻辑只有一份（`scripts/lib/check.mjs`）；不往目标仓库复制第二份实现，CI 用 `emit-check` 单向导出。
- 状态结论必须来自实际读到的构建产物/配置；取不到就写「未验证」，不猜。

## references（按 `next` 读）

| 文件 | 什么时候读 |
|---|---|
| `references/new-site.md` | scaffold 的取舍、生成物清单、从 README 手工搬运、落地后验收 |
| `references/audit.md` | 非确定性审计（线上、视觉、可访问性、非 Starlight 迁移） |
| `references/i18n.md` | 双语配方、locale key 与 BCP-47、切换器、parity 规则 |
| `references/pitfalls.md` | 版本/Node/base/主题/CJK/卡片/菜单/CI 的已知坑与修法 |
