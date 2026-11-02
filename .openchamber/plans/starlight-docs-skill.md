# starlight-docs 通用 skill 计划

> 状态：**只出计划，不落 skill**。本文件落到仓库 `.openchamber/plans/`，作为 shared plan 进项目知识面板；等确认后再实施。
> 目标仓库：任意需要 GitHub Pages 文档站的 GitHub 仓库，不绑定 `opencode-skill-management`。
> 安装位置（实施时）：`.opencode/skills/starlight-docs/`，项目级，暂不放全局。

## 1. 已锁定决策

- 两条路径：`new-site` 从零建站；`audit-site` 对已有站做体检/改版。
- 只把 **GitHub Pages** 做完整；其他 host 只留迁移要点。
- 默认单语言；双语（root + 其他 locale）是显式可选配方。
- 默认 Starlight 原生主题；另附可选 “developer dark” CSS 预设，不自动启用。
- 交付 `SKILL.md` + `assets/` 模板；不做自动 scaffolder 之外的 CLI 包装。
- 有代码的仓库放 `site/`；纯文档仓库可以放根目录，由脚本检测后选择。
- 先读 Node engine，再选兼容的 Astro/Starlight；不写死 Astro 6/7。
- Skill 正文中文，命令/路径/标识符保持英文。
- 验证：确定性检查 + 一个临时仓库的端到端 smoke；不跑完整 with/without benchmark。
- 双语只做轻量一致性检查：页面集合、frontmatter 必填键、标题数量；不做全文语义比对。
- Skill 默认出现在技能清单（不设 `autoinvoke: false`），不加 command。

## 2. 会话扫描证据

- `opencode-go-model-picker` 的 Pages 是 `main` / `docs` 分支构建的静态 HTML，不是 Astro/Starlight；审计发现了 Node 前置、canonical/OG/theme-color、robots/sitemap、footer 链接、双语文案漂移等问题。因此 `audit-site` 必须先识别框架与 Pages 构建方式，不能假设 Actions + Starlight。
- `docs-sync` 会话确认：项目级 `.opencode/skills/` 可被宿主识别；`metadata.opencode/autoinvoke: false` 只隐藏清单、不阻止按 ID 加载；薄 command 可以点名加载长 skill。本 skill 选择默认可见，不加 command。
- 多次 “Mirror README/CONTRIBUTING to Chinese” 证明双语文档漂移是跨仓库重复摩擦；i18n 配方必须带轻量 parity 检查。

## 3. 设计原则

1. **按需加载**：`SKILL.md` 只放触发、决策树、唯一入口命令、输出处理和硬边界；细节放 `references/`，只在脚本输出 `next` 指向时读取。
2. **脚本优先**：确定性的检测、生成、构建、路由/链接检查全部进脚本；Markdown 只保留判断、取舍和人工验收清单。
3. **单一入口**：模型只调用 `scripts/site.mjs` 这一个入口；可以有 `scripts/lib/*.mjs` 内部模块，但不再有第二个被模型直接调用的脚本。
4. **参数化而非多脚本**：一个 `site.mjs`，用 `--action` 加大量 flags 覆盖 detect/scaffold/audit/check/fix/pages；输出 JSON，模型读 JSON 决策。
5. **只读优先**：`detect` / `audit` / `check` 永不写文件；`scaffold` / `fix` / `pages` 才写，且默认 `--dry-run`，必须显式 `--apply` 才落盘。
6. **不碰全局**：不写用户全局配置、不 `git push`、不自动改 GitHub 仓库设置；启用 Pages 只在显式 `--enable-pages` 时通过 `gh api` 执行。

## 4. Skill 结构

```text
.opencode/skills/starlight-docs/
  SKILL.md                     # 约 100–150 行，只做路由与边界
  scripts/
    site.mjs                   # 唯一入口
    lib/
      detect.mjs               # repo / Node / Astro / Pages 检测
      scaffold.mjs             # 生成 site 结构、内容骨架、配置
      audit.mjs                # 构建产物、路由、链接、i18n、Pages 体检
      fix.mjs                  # 安全的幂等修复
      pages.mjs                # workflow / gh api / 线上验证
      report.mjs               # JSON / Markdown 输出
  assets/
    pages.yml                  # GitHub Actions Pages 模板
    custom.css                 # 可选 developer dark 预设
    check-dist.mjs             # 复制到目标仓库供 CI 跑的模板（不由 skill 直接调用）
  references/
    new-site.md                # 仅在 scaffold 复杂决策时读
    audit.md                   # 非确定性审计清单（线上、视觉、可访问性）
    i18n.md                    # 双语配方 + parity 规则
    pitfalls.md                # Starlight/Pages 已知坑与修法
```

`assets/check-dist.mjs` 是**目标仓库的 CI 模板**，不是 skill 的第二个入口；skill 只调用 `site.mjs`，由它决定是否把模板写入目标仓库。

## 5. 唯一入口 CLI 契约

```text
node .opencode/skills/starlight-docs/scripts/site.mjs \
  --action <detect|scaffold|audit|check|fix|pages> \
  [flags...]
```

### 通用 flags

| flag | 含义 |
|---|---|
| `--repo <path>` | 目标仓库根；默认 cwd |
| `--json` / `--md` | 输出格式，默认 JSON |
| `--dry-run` / `--apply` | 写操作预览 / 真正落盘；默认 dry-run |
| `--force` | 覆盖已有文件（仍会先备份/报告） |
| `--verbose` | 打印执行的命令与耗时 |
| `--timeout <ms>` | 子进程超时 |
| `--no-install` | 跳过依赖安装 |
| `--no-build` | 跳过构建 |
| `--report <path>` | 把报告写到文件 |
| `--fail-on <error|warn>` | 退出码阈值 |

### scaffold flags

`--mode <site|root>`、`--dir <path>`、`--owner <gh-owner>`、`--name <repo>`、`--site <https://owner.github.io>`、`--base </repo>`、`--locales <root,zh-cn>`、`--default-locale <root>`、`--preset <none|developer-dark>`、`--search <pagefind|none>`、`--pages <workflow|legacy|none>`、`--node <version>`、`--astro <version>`、`--starlight <version>`、`--package-manager <npm|pnpm|yarn|bun>`。

### audit / check flags

`--dist <path>`、`--site-url <url>`、`--locales <...>`、`--i18n <auto|off>`、`--pages-api <auto|off>`、`--check-links <all|internal|off>`、`--max-links <n>`、`--baseline <path>`、`--browser-report <path>`（人工截图/浏览器结果由外部写入，脚本只消费）。

### pages flags

`--build-type <workflow|legacy>`、`--branch <main>`、`--docs-dir <docs>`、`--enable-pages`、`--wait`、`--cache-bust`。

### fix flags

`--fix <gitignore|scripts|workflow|canonical|all>`，可重复。只做幂等、可回滚的文本修复。

### 输出 JSON（稳定契约）

```json
{
  "ok": true,
  "action": "audit",
  "repo": "/abs/path",
  "framework": "starlight | astro | static-html | unknown",
  "pages": { "enabled": true, "buildType": "workflow", "htmlUrl": "..." },
  "findings": [
    { "code": "CJK_LINE_HEIGHT", "severity": "warn", "path": "site/src/styles/custom.css", "line": 120, "message": "..." }
  ],
  "artifacts": [],
  "next": [{ "ref": "references/pitfalls.md", "reason": "CJK_LINE_HEIGHT" }]
}
```

`next` 是按需加载的唯一开关：没有指向的 reference 不读。

## 6. new-site 流程

1. `detect`：Node、包管理器、现有 `src/`、是否已有 Astro、Git remote、Pages 状态。
2. 选版本：读 Node engine，选兼容的 Astro/Starlight；记录实际版本到 `site/package.json` 与报告。
3. 选布局：有代码 → `site/`；纯文档 → 根目录。
4. `scaffold --dry-run` 输出将创建/修改的文件；`--apply` 落盘。
5. 生成：`astro.config.mjs`（site/base/locales/sidebar/components）、内容骨架、`package.json` scripts、`.gitignore`、Pages workflow、可选 CSS。
6. `check`：安装、构建、路由/链接/base、无语言跳转、i18n parity。
7. 人工视觉验收：桌面 + 移动，亮/暗，菜单 hover/selected。
8. `pages --enable-pages --wait`（显式）后用 `curl` / 浏览器复验线上。

## 7. audit-site 流程

1. `detect` 框架与 Pages：`astro.config.*` + `@astrojs/starlight` 依赖；`gh api repos/{owner}/{repo}/pages` 的 `build_type` / `source` / `html_url` / `https_enforced`。
2. 非 Starlight：`framework: static-html|other`，只跑通用 Pages 体检 + 迁移建议，不自动迁移、不写目标文件。
3. Starlight：构建、路由镜像、站内链接、`base`、语言跳转、i18n parity、404、search/Pagefind、canonical/OG/theme-color、robots/sitemap、Node 前置、footer 链接。
4. 视觉与交互：标题锚点、亮色选中背景、默认主题/Auto 持久化、卡片对齐、CJK 行距、菜单 hover/selected。
5. 输出 findings + `next`；`fix` 只修安全项，其余给人工步骤。

## 8. GitHub Pages 规则

- 新站默认 Actions：`actions/upload-pages-artifact` + `actions/deploy-pages`，`pages: write`、`id-token: write`，Node 22。
- 现有站先读 `gh api .../pages`：`build_type: workflow` 与 legacy `source: {branch, path}` 是两种不同部署；不要假设。
- 启用 Pages 只允许显式 `--enable-pages`：`POST /pages -f build_type=workflow`（已启用则 `PATCH`），失败原样报告，不重试超过一次。
- 线上验证带 cache-bust 参数：状态码、语言、canonical、sitemap/robots、切页后的 theme 持久化。

## 9. i18n 配方（可选）

- locale key 是 URL 段（如 `zh-cn`），sidebar 的 `translations` 用 BCP-47（如 `zh-CN`）；root locale 用 `root`。
- 首次访问默认 root 语言，禁止 `navigator.language` 跳转；语言切换器必须映射到同一 slug。
- `check` 的轻量 parity：页面集合镜像、frontmatter 必填键、标题数量；不做全文翻译一致性。
- 语言切换器从 `<select>` 改成链接时，检查脚本必须同步更新（不要只改页面）。

## 10. 必须写死的坑

### 主题与文字

- 默认深色只能通过 `localStorage['starlight-theme'] === null` 种入；**空字符串是 Auto**，不是“没选过”。否则用户选浅色后换页会被写回深色。
- 亮色主题的 `::selection` 必须是浅色底 + 深色字；不要复用深色主题的深橄榄色。
- 中文大标题 `line-height` ≥ 1.15；否则两行会贴住。
- Starlight 标题锚点默认 inline 在标题文字后，CJK/长标题会被链条图标压住；隐藏或移到左侧空白。

### 布局

- Splash hero 无图也会保留 `7fr 4fr` 图片列；无图时覆盖为单列。
- 正文 `* + *` 的 `margin-top` 会把网格里第 2 个及之后的卡片顶下去；卡片要 `margin: 0`。
- 移动端代码块要换行或可横向滚动；不要让长命令撑破容器。
- `.md` 裸 HTML 里的 Markdown 不会渲染；要渲染的示例用 aside/组件/MDX，并保留边框面板。

### 控件

- 原生 `<select>` 的弹层 hover 由浏览器/系统绘制，CSS 控不了；主题化文档站用自定义菜单。
- 菜单的“当前选中”和“悬停”要分开：当前值由触发器文字表示；列表静止态同色，只有 hover 变橙。
- 菜单在移动端要收进可访问的导航，不要把 header 撑爆。

### 构建与部署

- 先查 Node engine，再选 Astro/Starlight；不要先装最新版再报 engine 错。
- `base` 下的站内链接、hero action、裸 HTML 链接不会自动加前缀；逐条验。
- Pagefind 在 Windows 可能没有二进制；小站可 `pagefind: false`。
- 自定义 404 与 Starlight `404` 路由可能冲突；用 `disable404Route` 或接受官方 404。
- `package.json` 的 `files` 只含运行时文件；`site/` 不应进 npm pack。
- `assets/check-dist.mjs` 只做静态检查；视觉验收必须用宿主浏览器，不能拿 build 绿代替。

## 11. 安装与 gitignore

- 目标：`.opencode/skills/starlight-docs/`；项目级，先不放全局。
- 当前 `.gitignore` 第 22 行忽略 `.opencode`；实施时删除该行，让 skill 进入版本库。
- 删除后现有的 `.opencode/skills/docs-sync` 与 `.opencode/command/docs-sync.md` 会变成未跟踪；实施时一并决定是否纳入（默认一起提交，避免仓库里出现半忽略状态）。
- Skill 目录名必须与 frontmatter `name` 一致；`metadata.opencode/autoinvoke` 不设，即默认可见。

## 12. 验证计划

1. `skill_validate` + `skill_parse`：frontmatter、name、description、正文长度。
2. 静态：`--action detect` 在三个临时仓库（有代码 / 纯文档 / 非 Starlight）上输出正确 JSON。
3. smoke：临时空仓库，`scaffold --apply` → `check --apply`，必须 `docs:build` 通过、路由镜像、链接全通。
4. 回归：用带 CJK 标题、亮色选中、卡片网格、菜单的最小页面，检查三个历史 bug 的 CSS/JS 规则存在。
5. 人工视觉：桌面 + 移动，亮/暗，菜单 hover/selected；没有浏览器工具时明确标“未验证”。
6. 不做完整 benchmark（per 决策 Q13）。

## 13. 实施顺序（审批后）

0. 删除 `.gitignore` 的 `.opencode`；决定 docs-sync 是否一并提交。
1. 分支 `feat/starlight-docs-skill`。
2. 先写 `scripts/site.mjs` + `lib/`（detect → scaffold → check），用临时仓库跑通。
3. 再写 `SKILL.md`（只保留入口、决策树、`next` 处理、硬边界）。
4. 写 `references/`（new-site/audit/i18n/pitfalls）与 `assets/`（pages.yml/custom.css/check-dist.mjs）。
5. `skill_validate`，临时仓库 smoke，修到 build/check/视觉都过。
6. 小步提交；合并 main；**不自动 push 目标仓库、不改全局配置**。
7. 完全可用后，在另一个会话里复制到全局 skill 目录。

## 14. 风险与待定

- Astro/Starlight API 会漂移；`site.mjs` 必须把版本检测和错误信息放在最前面，不能把旧版本写法写死。
- `site.mjs` 可能超过单文件舒适长度；允许 `scripts/lib/` 拆分，但模型仍只调用 `site.mjs`。
- `gh` 未登录或 Pages 未启用时，`audit`/`pages` 要降级为“未验证”，不能猜。
- 非 Starlight 站点的迁移只能给建议，不自动改；避免把用户现有 Pages 构建方式弄坏。
- 浏览器视觉验收无法完全脚本化；脚本负责生成清单和截图路径，人工/宿主浏览器负责确认。
