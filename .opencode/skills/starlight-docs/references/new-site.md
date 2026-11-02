# 新建文档站（scaffold）

只覆盖 `scaffold` 的取舍与落地验收。检查口径见 `SKILL.md` 与 `pitfalls.md`。

## 1. 先跑 detect，别先选布局

`detect` 给出 `suggestedMode`：

- 仓库有代码（`src/`、`exports`/`bin`、非空 `files`）→ `site/`，文档与包产物互不干扰。
- 纯文档仓库（只有 README / docs）→ 根目录，`base` 通常是 `/<repo>`。
- 已有 `site/` 或根 `astro.config` → 沿用现有布局，别另起一套。

要覆盖就显式传 `--mode site|root`；`--dir` 只在需要非 `site/` 目录时用。

## 2. 版本

- **Node 地板 22.12.0** 来自 `astro` 的 `engines`，`@astrojs/starlight` 自身没有 `engines`，只有 `peerDependencies.astro`。
- `--node` 只决定 **CI 的 `node-version`** 与报告里的目标版本；本地构建用的仍是当前 `node`。本地低于地板时脚本直接报 `node_unsupported`，v1 不自动降级。
- `--astro` / `--starlight` 写进站点 `package.json` 的 `devDependencies`；装完后可以用 `node -p "require('./site/node_modules/astro/package.json').engines"` 核对实际地板。

## 3. 生成物

| 路径 | 说明 |
|---|---|
| `<site>/astro.config.mjs` | `site`/`base`/`locales`/`components`/`sidebar`，显式列表 |
| `<site>/package.json` | 站点私有依赖（`private: true`），`dev`/`build`/`check`/`preview` |
| `<site>/src/content.config.ts` | Starlight `docsLoader` + `docsSchema` |
| `<site>/src/content/docs/index.mdx` | splash 首页骨架（`sd-section`/`sd-grid`/`sd-card`） |
| `<site>/src/content/docs/overview.md` | 占位正文 |
| `<site>/src/content/docs/<locale>/**` | 多语言时按 locale 镜像同样两页 |
| `<site>/public/favicon.svg` | Starlight 总会链接 `/favicon.svg`，缺了就是死链 |
| `<site>/.gitignore` | `dist/`、`.astro/`、`node_modules/` |
| `<repo>/.github/workflows/pages.yml` | GitHub 只读仓库根的 workflow，**不会**读 `site/.github/` |
| `<site>/src/styles/menu.css` | 生成任一菜单组件就必须带 |
| `<site>/src/components/ThemeSelect.astro` | 总是生成（`--components none` 除外） |
| `<site>/src/components/LanguageSelect.astro` | 仅多语言 |
| `<site>/src/styles/custom.css` | 仅 `--preset developer-dark` |

`package.json` 的 `check` 脚本指向 `<site>/scripts/check-dist.mjs`；那个文件由 `emit-check` 生成，scaffold 不会替你写。所以在 `emit-check` 之前不要把它接进 CI 门禁。

## 4. 默认值与理由

- `--search none`：Pagefind 在部分 Windows 环境没有可用二进制；小站靠 sidebar 就够。需要全文搜索再显式 `pagefind`。
- `--preset none`：默认 Starlight 原生主题。`developer-dark` 是**裁剪版**（`sd-*`，约 200 行），不是任何现成站点的逐字副本。
- `--components auto`：`ThemeSelect` 总是有，因为原生 `<select>` 的弹层 hover 由系统绘制，CSS 控不了；多语言才加 `LanguageSelect`。
- `--pages workflow`：只生成 workflow，**不**启用 Pages、不调 `gh`。启用与线上验证属于第二期。

## 5. sidebar 是一次性显式列表

scaffold 扫现有内容页，把 `{ label, link }` 写进 `astro.config.mjs`。**不用 `autogenerate`**：显式列表能被人看见、被 `audit` 对照。新增页面后两件事必须同时做：

1. 在内容目录建页；
2. 在 `sidebar` 里加一条。

漏了第 2 步，`audit` 会报 `SIDEBAR_MISSING_PAGE`；sidebar 指向不存在的页会报 `SIDEBAR_DEAD_LINK`。

## 6. 从 README 搬运（v1 没有 `--from-readme`）

手工搬运的做法，比自动拆页可靠：

1. 把 README 的「是什么 / 为什么」压成首页 hero 的 tagline + 一段 `sd-lede`。
2. 按读者任务拆页（安装、用法、参考、排错），每页一个 `<h1>`（Starlight 用 frontmatter `title` 渲染，正文不要再写 `#`）。
3. 每页补 `description`（frontmatter），否则 `check` 会报 `DESCRIPTION_MISSING`。
4. 命令块用 ```` ```pwsh ```` / ```` ```bash ````，带 `title=` 更易读；长命令靠自己换行，移动端才会换行显示。
5. 把 README 里指向旧路径的链接改成站内绝对路径（含 `base` 前缀）。

## 7. 落地后验收

```pwsh
node <skill>/scripts/site.mjs --action check --repo <repo> --profile landing
```

按顺序确认：

- `ok: true`，`counts.error === 0`；
- `routes` 是预期的页面集合，多语言时两组完全镜像；
- `stats.linksChecked` 不是 0（0 说明链接扫描没生效）；
- `findings` 里 `DEAD_LINK`/`BASE_ESCAPE` 为空；
- GitHub Actions 首次运行前，`<site>/package-lock.json` 已提交（workflow 用 frozen install）。

再补两件脚本管不了的事：

1. `emit-check --out <site>/scripts/check-dist.mjs`，把 `check` 接进门禁；
2. 人工视觉验收（桌面 + 移动、亮 + 暗、菜单 hover/selected），清单见 `audit.md`。
