# 体检与改版（audit）

`audit` 的目标不是「给一个分数」，而是把**能脚本判的**和**只能人看的**分开。

## 1. 脚本能判的（findings）

| 类别 | finding codes |
|---|---|
| 框架与 Pages | `FRAMEWORK_NOT_STARLIGHT`、`FRAMEWORK_UNKNOWN`、`PAGES_BUILD_TYPE`、`PAGES_HTTPS_NOT_ENFORCED`、`PAGES_UNVERIFIED` |
| 路由与链接 | `ROUTE_MIRROR_MISMATCH`、`LOCALE_HOME_MISSING`、`DEAD_LINK`、`BASE_ESCAPE`、`LINK_LIMIT` |
| 语言 | `LANG_MISSING`、`LANG_MISMATCH`、`LANGUAGE_SNIFFING`、`SWITCHER_MISSING` |
| SEO / 交付 | `CANONICAL_MISSING`、`OG_MISSING`、`THEME_COLOR_MISSING`、`ROBOTS_MISSING`、`SITEMAP_MISSING` |
| 结构与导航 | `SIDEBAR_MISSING_PAGE`、`SIDEBAR_DEAD_LINK`、`H1_MISSING`、`H1_MULTIPLE`、`DESCRIPTION_MISSING` |
| 404 与搜索 | `NOT_FOUND_MISSING`、`PAGEFIND_DISABLED` |

`PAGES_UNVERIFIED` 表示**没读到**，不是「没启用」。`gh` 未登录或无 remote 时会这样，报告里要照实写「未验证」。

## 2. 非 Starlight 站点

`framework` 为 `astro` / `static-html` / `unknown` 时：

- 只跑通用 Pages 体检：构建方式（`build_type`）、`https_enforced`、404、robots/sitemap；
- **不写任何目标文件**，不给逐页迁移清单；
- 迁移建议只写在报告里，由人决定。

常见迁移路径：

1. 保留现有部署分支/路径，先在一个分支上把 Astro 站建起来（`scaffold --mode site`）；
2. 用 `check` 在新构建上跑通，再切 workflow；
3. 旧站内容按「读者任务」重排，不要机械复制 HTML。

## 3. 线上与浏览器：外部写入，脚本只消费

v1 不做联网验证、不改 Pages 设置。需要浏览器证据时，由外部（人或浏览器工具）写一份 JSON：

```json
[
  { "id": "menu-hover", "ok": false, "note": "hover 行没有高亮" },
  { "id": "theme-persist", "ok": true }
]
```

然后：

```pwsh
node <skill>/scripts/site.mjs --action audit --repo <repo> \
  --browser-report <report.json> --baseline <last-audit.json>
```

- `ok: false` / `status: "fail"` 会变成 `VISUAL_REGRESSION`（warn）；
- 文件缺失或不是 JSON 会变成 `BROWSER_REPORT_UNREADABLE`（warn），**不会**假装通过；
- `--baseline` 输出 `regressions`：相对上一份报告新增的项。

## 4. 人工清单（脚本不判定）

桌面 + 移动两个宽度，亮/暗各一次：

- **标题锚点**：CJK 或长标题上，链条图标是否压住最后一个字；压住就隐藏锚点（见 pitfalls）。
- **亮色选中**：`::selection` 是否是浅底深字；深色主题的橄榄色不能复用。
- **默认主题持久化**：选浅色后翻页是否被写回深色；`Auto` 是否还在。
- **卡片对齐**：网格里第 2 张及之后的卡片是否被 prose 的 `* + *` 上边距顶下去。
- **CJK 行距**：两行大标题是否贴住（`line-height` < 1.15 会贴）。
- **菜单**：hover 行是否只有一行高亮；当前值是否由触发器文字表达，而不是列表里多一种底色。
- **移动端**：长命令是否换行/可横向滚动；`scrollWidth === clientWidth`（无横向滚动）；菜单是否把 header 撑爆；**splash 页在手机上是否仍能切主题/语言**（docs 页在汉堡菜单里，splash 页没有菜单，需要把右组放回 header）。
- **可访问性**：菜单能否用键盘打开/关闭，`aria-expanded` 是否跟随，Escape 是否关闭。
- **首屏**：无图 hero 是否仍留出 `7fr 4fr` 的图片列（右侧空白）。

任一项没条件验证，就在报告里写「未验证」，不要描述成通过。

## 5. 改版顺序（建议）

1. 先修 `error`：死链、base 越界、路由不镜像、语言嗅探；
2. 再修 `warn`：canonical/OG/sitemap、description、sidebar 漂移；
3. 最后处理 `info` 与人工清单；
4. 每一步之后重跑 `check`（不重建时加 `--no-build --no-install`），把 `regressions` 归零。
