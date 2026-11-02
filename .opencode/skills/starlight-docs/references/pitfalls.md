# 已知坑与修法

每条都对应 `check`/`audit` 的一个 `code`，或是一处实测过的行为。修法默认已经是 scaffold 生成的形态；手工改站时按这里对齐。

## 版本与 Node

- **Astro 6.4.x 的 `engines` 是 `node >=22.12.0`**；`@astrojs/starlight` 没有 `engines`，地板由 astro 决定。传递依赖（`vite@7`、`@astrojs/mdx@6`）也是 22.12。
- 低于地板是**硬失败**：`astro --version` 直接报 `Node.js v20.x is not supported by Astro!`，退出码 1。`check` 在构建前就报 `NODE_UNSUPPORTED`，不要靠「再跑一次」绕过。
- `--node` 只影响 CI 的 `node-version` 与目标版本记录；本地仍然用当前 `node`。

## 依赖与 CI

- 站点依赖放 `<site>/package.json`，**不改仓库根 `package.json` 的依赖和 lockfile**。
- CI 用 `npm ci --prefix site` + `npm run build --prefix site`（实测可用）；但**本地**不要用 `npm install --prefix site`——它不会装到 `site/node_modules`（ENOENT）。本地要么 `cd site && npm install`，要么交给 `site.mjs`（它用站点目录作为 cwd）。
- 首次推 CI 前要提交 `site/package-lock.json`：workflow 用的是 frozen install。
- workflow 必须在**仓库根**的 `.github/workflows/`；`site/.github/` 不会被 GitHub 读取。
- 注意 `.gitignore` 是否忽略了 `dist/`、`.astro/`；根目录建站时不要覆盖已有的 `.gitignore`，只补缺失项。

## base 与链接

- `base: '/repo'` 下，**手写 HTML 里的绝对链接不会自动加前缀**：hero action、footer、MDX 里裸 `<a href="/overview/">` 都要写成 `/<repo>/overview/`。
- 相对链接按页面路径解析；构建后 `check` 会逐条验证目标文件存在（`DEAD_LINK`）以及没越出 `base`（`BASE_ESCAPE`）。
- Starlight 总会链接 `/favicon.svg`；`public/favicon.svg` 不存在就是全线死链。scaffold 会生成一个。
- 外链默认不检查；`--check-links all` 才发请求（HEAD，405/403 再降级 GET）。结果分四级：
  - `EXTERNAL_LINK_UNREACHABLE`（**warn**）：对方返回 4xx/5xx，且不是「拒绝机器人」的状态；
  - `EXTERNAL_LINK_BLOCKED`（info）：401/403/405/429——对方不让自动请求，不代表链接坏了；
  - `EXTERNAL_LINK_UNVERIFIED`（info）：超时、DNS、连接失败；
  - `EXTERNAL_LINKS_UNAVAILABLE`（info）：所有外链都没走到 HTTP，只出一条，不逐条刷屏。
- 外链检查**依赖运行时的网络路径，不要当门禁**。2026-11-03 同一台机器实测：先一次 23/23 全超时（8s），几分钟后同一批链接全部 200。排查时先看 `curl -I <url>`：本机 `curl` 走系统代理正常，而 Node 22 的全局 `fetch` **不读** `HTTP(S)_PROXY`（设 `NODE_USE_ENV_PROXY=1` 才走，且带 `UNDICI-EHPA` experimental 警告）。因此「全红」通常是代理/分流，不是站点坏了。

## 主题与文字

- **默认深色只能这样种**：`localStorage.getItem('starlight-theme') === null` 时写入 `'dark'`。空字符串 `''` 是 Starlight 的 **Auto**，不是「没选过」；写成 `!value` 会把 Auto 顶回深色。
- 亮色主题的 `::selection` 要浅底深字；复用深色主题的橄榄底会看不清。
- **CJK 大标题 `line-height` ≥ 1.15**，否则两行会贴住；hero 标题用 1.16。
- Starlight 的标题锚点默认 inline 在标题文字后，CJK/长标题会被链条图标压住。修法：隐藏 `.sl-anchor-link` 并去掉标题右侧 padding（导航仍由 sidebar 和 on-this-page 负责）。

## 布局

- Splash hero 即使没有图片也保留 `7fr 4fr` 的图片列；无图时必须覆盖成 `grid-template-columns: minmax(0, 1fr)`。
- 正文 `* + *` 的 `margin-top` 会把网格里第 2 张及之后的卡片顶下去；卡片要 `margin: 0`（预设里是 `margin: 0 !important`）。
- 移动端长命令要么换行要么可横向滚动；`.expressive-code .ec-line .code` 设 `white-space: pre-wrap` + `overflow-wrap: anywhere`。
- `.md` 里的裸 HTML 内的 Markdown 不会渲染；要渲染的示例用 MDX/组件/`aside`，并自己保留边框面板。

## 控件

- 原生 `<select>` 的弹层与 hover 行由系统/浏览器绘制，CSS 控不了；所以主题/语言菜单是自定义列表（`ThemeSelect` / `LanguageSelect`）。
- 列表的「当前值」和「hover」要分开：当前值由触发器文字表达；列表静止态同色，只有 hover 变强调色。
- 移动端把菜单收进 header 的图标 + caret，别让长语言名撑爆导航。
- **splash 页面没有移动菜单**：Starlight 的 header 右组是 `sl-hidden md:sl-flex`，手机上默认整组消失；docs 页有汉堡菜单（菜单里包含主题/语言），splash 页没有，于是主题/语言在手机上不可达。修法（`menu.css` 已带）：仅在**没有** `starlight-menu-button` 的页面把右组放回来，并用 icon-only 触发器。注意菜单按钮在 `nav.sidebar` 里、**不在 header 内**，所以判据挂在 `body` 上：
  `body:not(:has(starlight-menu-button)) header.header .right-group { display: flex; }`
- 组件依赖 `menu.css`；只拷 `.astro` 不拷 CSS，菜单就是裸列表。

## 构建与搜索

- Pagefind 在部分 Windows 环境没有可用二进制；小站直接 `pagefind: false`，`audit` 会记 `PAGEFIND_DISABLED`（info）。
- 自定义 `404` 与 Starlight 的 404 路由可能冲突；要么 `disable404Route: true` 接受没有 404 页，要么自己接管。`audit` 会报 `NOT_FOUND_MISSING`（info）。
- `trailingSlash: 'always'` 让路由集合稳定；改这个值要同步所有手写链接。

## skill 自身

- **不要用 `process.cwd()` 定位 `assets/` / `references/`**：skill 会被复制到别的仓库或全局目录。一律 `fileURLToPath(new URL('../assets/...', import.meta.url))`。
- **不要在 skill 目录下拆第二个给模型调用的 `.js` 入口**：模型只认 `scripts/site.mjs`，`lib/` 只被 import。
- `emit-check` 产物是**一次性快照**：不读 skill、不读配置；改完 skill 必须重导。文件头有「勿手改」标记。
- `check.mjs` 必须只依赖 Node 内置模块、不 import 相对路径，否则 `emit-check` 无法把它渲染成自包含脚本。
- 复制 skill 到新位置后，先在新位置跑一次 `detect`：路径假设与 `assets/` 完整性是唯一的失败点。
