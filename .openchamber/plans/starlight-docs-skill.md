# starlight-docs 通用 skill 计划

> 状态：**已对齐，只出计划，不落 skill**（2026-11-03 定稿 v1 范围）。本文件落到仓库 `.openchamber/plans/`，作为 shared plan 进项目知识面板；等开工时按 §13 执行。
> 本 skill 是**通用产物**：任何需要 GitHub Pages 文档站的 GitHub 仓库都能用，不绑定 `opencode-skill-management`。
> 安装位置（实施时）：`.opencode/skills/starlight-docs/`，**只放本仓库**，打磨完成前不进全局目录、也不复制到别处。

## Steps

- [x] 修 `.gitignore`：删第 22 行 `.opencode`，让 skill 能入库（`docs-sync` 两个文件一并提交）
- [x] 建分支 `feat/starlight-docs-skill`
- [x] 写 `scripts/lib/detect.mjs`：Node / 包管理器 / astro 配置 / starlight 依赖 / git remote 检测
- [x] 写 `scripts/lib/check.mjs`：core 六项（路由集合、`base`、死链、`lang`、无语言嗅探、parity）+ `--profile landing`（缺类名只报 `info`），**只依赖 node 内置模块**（供 `emit-check` 内联）
- [x] 写 `scripts/lib/scaffold.mjs`：`--dry-run` 文件清单 + `--apply` 落盘（`astro.config.mjs`、`site/package.json`、内容骨架、组件、预设、workflow、`site/.gitignore`）
- [x] 写 `scripts/lib/audit.mjs`：框架识别 + 复用 `check` + 非 Starlight 只报告（不写文件）
- [x] 写 `scripts/lib/emit-check.mjs`：把 `check.mjs` 渲染成值内联的自包含脚本（不复制判断逻辑）
- [x] 写 `scripts/lib/report.mjs`：`schemaVersion: 1` 的 JSON / Markdown 输出 + `next` 映射 + `--fail-on` 退出码
- [x] 写 `scripts/site.mjs`：参数解析、action 分发（detect / scaffold / check / audit / emit-check）、`unknown_action` 报错
- [x] 写 `assets/custom.css`：裁剪版 `sd-*` 预设（≤200 行，含 §10 的修法）
- [x] 写 `assets/menu.css`：ThemeSelect/LanguageSelect 的控件样式（不覆盖 Starlight 配色）
- [x] 写 `assets/components/ThemeSelect.astro`（总是生成）与 `LanguageSelect.astro`（仅多语言）
- [x] 写 `assets/pages.yml`：`npm ci --prefix site` + build + `upload-pages-artifact`（`site/dist`）
- [x] 写 `SKILL.md`（≤150 行）：触发、决策树、唯一入口、`next` 处理、硬边界
- [x] 写 `references/{new-site,audit,i18n,pitfalls}.md`
- [x] `skill_validate` + `skill_parse` 通过
- [x] 临时仓库 smoke：`scaffold --apply` → `npm install` → `check` core 全绿（Node 22.12+）
- [x] `emit-check` 产物在**没有 skill** 的临时仓库跑通，结论与 skill 内 `check` 一致
- [x] `--profile landing` 在缺 `.sd-*` 类时只报 `info`，不报 `error`
- [x] 删临时仓库；`node tools/verify.mjs` 仍全绿（本仓库无回归）
- [x] 小步提交，合并 `main`，push

## 实施记录（2026-11-03）

计划没写死的点，执行时的判断：

- `emit-check` 是唯一**默认写盘**的动作（`--dry-run` 才预览）：`--out` 已给出唯一路径，再要求 `--apply` 没有信息增益。
- scaffold 默认 `--search none`：Pagefind 在 Windows 可能缺二进制；要全文搜索显式传 `pagefind`。
- Pages workflow 生成在**仓库根** `.github/workflows/pages.yml`——GitHub 不读 `site/.github/`。
- 额外生成 `public/favicon.svg`：Starlight 总会链接 `/favicon.svg`，缺了就是全线死链（smoke 实跑发现）。
- 本地安装/构建以站点目录为 cwd；`npm install --prefix site` 实测不装（ENOENT），而 `npm ci --prefix site` / `npm run build --prefix site` 可用，所以 CI 模板仍按计划用 `--prefix`。
- 构建/安装辅助函数放在 `scaffold.mjs`（`ensureDeps` / `buildSite` / `runStep`），不新增第 7 个 lib 文件，保持 §4 的结构。
- root 模式下已有 `.gitignore` 不改写，只报 `GITIGNORE_MANUAL`；已有根 `package.json` 不改依赖，报 `ROOT_PACKAGE_JSON_CONFLICT`。
- `--default-locale` 在 v1 只支持 `root`，其它值报 `DEFAULT_LOCALE_IGNORED`（warn）。
- `--site-url` 被接受但 v1 未参与断言（canonical 只查是否存在，不比对域名）。
- `--baseline` / `--browser-report` 只在 `audit` 生效（计划把它们归在 audit/check 一组）。

验证记录：

- `skill_validate` valid；`skill_parse` 的 name/description 正常；`SKILL.md` 125 行。
- 主仓库：`check` 24 路由（12 + 12 镜像）、652 链接、0 findings，与 `site/scripts/check-dist.mjs` 结论一致。
- 临时仓库 smoke（site 模式 + root 模式、`root,zh-cn`、`developer-dark`）：`scaffold --apply` → install → build → `check --profile landing`，0 findings。
- `emit-check` 产物在**没有 skill 的**临时仓库可用：正常 dist 输出 ok；删页后报 `ROUTE_MIRROR_MISMATCH` / `DEAD_LINK` / `SWITCHER_MISSING`，退出码 1。
- `--node 20`：`detect` 报 `NODE_UNSUPPORTED`、`check` 报 `node_unsupported`，都退出 1。
- `node tools/verify.mjs` 333 项全绿；`npm run docs:build` 24 页；`npm run docs:check` 5 项全绿。

未验证：

- `--check-links all` 的外部 HEAD 检查（本次未联网实测）。
- Linux CI 上的导出物行为（纯 Node，风险低，未实测）。
- 浏览器视觉验收（本机无浏览器工具，未验证）。

## 0. 术语

- **skill 家**：本仓库的 `.opencode/skills/starlight-docs/`。开发期 skill 只住在这里。
- **被操作仓库**（target repo）：`--repo <path>` 指向的那个项目，例如 `/path/to/my-plugin`。skill 读写的是它，不是自己。
- **参考实现**：本仓库已有的 `site/`（`site/src/styles/custom.css`、`site/scripts/check-dist.mjs`、`site/astro.config.mjs`）——它证明这套做法跑得通，但**不随 skill 发布**，也不是 skill 的一部分。

## 1. 已锁定决策

**范围与形态**

- 两条路径：`new-site` 从零建站；`audit-site` 对已有站做体检/改版。
- 只把 **GitHub Pages** 做完整；其他 host 只留迁移要点。v1 只交付 workflow 模板，**启用 Pages 与线上验证在第二期**（见 §8）。
- 默认单语言；双语（root + 其他 locale）是显式可选配方。
- 默认 Starlight 原生主题；另附可选裁剪版 CSS 预设（`sd-*` 前缀），不自动启用。
- 交付 `SKILL.md` + `assets/` 模板；不做自动 scaffolder 之外的 CLI 包装。
- 有代码的仓库放 `site/`；纯文档仓库可以放根目录，由脚本检测后选择。
- Skill 正文中文，命令/路径/标识符保持英文。
- Skill 默认出现在技能清单（不设 `autoinvoke: false`），不加 command。

**驻留与路径**

- **skill 只驻留本仓库**：开发期不写全局目录、不往别处复制。等 v1 完全可用后，才由人决定是否复制到全局。
- 所有内部路径（`assets/`、`references/`）一律从 `import.meta.url` 推导，**禁止 `process.cwd()` 作为资源定位**。`--repo` 只决定「改哪个仓库」。
  理由：以后复制出去就靠这条，路径假设是「出门即废」的唯一原因。

**依赖落地**

- 站点依赖写在 **`site/package.json`**（site-local）：Astro/Starlight 装在被操作仓库的 `site/` 下，CI 走 `npm ci --prefix site`。
- **不改被操作仓库根 `package.json` 的依赖和 lockfile**，也不碰根 `files`/`exports`。
- 本仓库现在的「根装依赖 + `--root site`」（`package.json:35-42`）只写进 `references/pitfalls.md` 当历史对照，不作为默认做法。

**检查器只有一份**

- 检查逻辑只存在于 skill 内（`scripts/lib/`），**不往被操作仓库写检查器**，也不维护第二份实现。
- 被操作仓库的 CI 需要检查时，用显式 `--emit-check <path>` **单向导出**一份自包含脚本：值（`base`、locales、dist 路径）在导出时内联，导出物不依赖配置文件、不需要 skill 在场。
- 导出物是**一次性快照**：skill 升级不会自动同步，要重跑导出。文件头带「由 starlight-docs 生成，勿手改」标记。

**断言分层**

- `core`（默认）：框架中立不变量 —— 路由集合、`base` 越界、站内死链、`lang` 属性、禁止 `navigator.language` / `accept-language` 跳转、语言切换器映射到同一 slug。
- `--profile landing`（显式开启）：`data-has-hero`、`h1#_top`、`.sd-section`、landing 不应有 sidebar。**缺类名只报 `info`，不报 `error`**。只有 scaffold 生成了那套布局时才建议开启。
- 双语 parity 属于 `core` 的轻量项：页面集合镜像、frontmatter 必填键、标题数量；不做全文语义比对。

**内容与版本**

- scaffold **只出骨架**（首页 + 1 个占位页 + 配置 + 可选组件/预设），不臆造正文。
- `--from-readme` **不进 v1**，只在 `references/new-site.md` 留手工搬运做法。
- sidebar：scaffold 扫现有页面生成**一次显式列表**写进 `astro.config.mjs`；之后由 `audit` 负责查「有页面但没进 sidebar」「sidebar 指向不存在的页」。不用 `autogenerate`。
- Node 优先级：`--node` 显式指定 > CI 构建 Node（默认 22）> 本地 node。被操作仓库的 `engines.node` **不参与版本选择**，只在报告里作为参考信息列出。
- **Astro 版本地板（已实测，见 §10）**：Node `>=22.12.0`。低于它就报明确错误并建议「升 Node」或「钉旧版 Astro」，v1 **不做自动降级**。

**视觉产物**

- 预设 CSS 裁剪到 ~150–200 行（token + §10 记录的修法），统一用 `sd-*` 前缀。
- 因此**预设的视觉效果 ≠ 本仓库现在这个站**。这是有意的：本仓库那份 819 行的 `custom.css` 是参考实现，不随 skill 发布。
- 组件：`ThemeSelect.astro` **总是生成**（原生 `<select>` 弹层控不了，单语言站也需要）；`LanguageSelect.astro` **只在 `--locales` 多于一个时生成**。

**分期**

- **v1**：`detect` / `scaffold` / `check` / `audit` —— 纯本地，只读，或只写 `--repo` 指定的仓库。
- **第二期（deferred）**：`fix` / `pages`（`gh api` 改 GitHub 设置、联网、不可逆），v1 不实现、不写 flags。

**验证**

- 确定性检查 + 临时仓库端到端 smoke（允许真装依赖）；不跑完整 with/without benchmark。

## 2. 会话扫描证据

> 历史依据，不可复核。新结论一律以代码与实跑输出为准。

- `opencode-go-model-picker` 的 Pages 是 `main` / `docs` 分支构建的静态 HTML，不是 Astro/Starlight；审计发现了 Node 前置、canonical/OG/theme-color、robots/sitemap、footer 链接、双语文案漂移等问题。因此 `audit-site` 必须先识别框架与 Pages 构建方式，不能假设 Actions + Starlight。
- `docs-sync` 会话确认：项目级 `.opencode/skills/` 可被宿主识别；`metadata.opencode/autoinvoke: false` 只隐藏清单、不阻止按 ID 加载；薄 command 可以点名加载长 skill。本 skill 选择默认可见，不加 command。
- 多次 “Mirror README/CONTRIBUTING to Chinese” 证明双语文档漂移是跨仓库重复摩擦；i18n 配方必须带轻量 parity 检查。
- 本仓库的 `site/` 是把这些坑逐个修过一遍的产物，因此作为**参考实现**（见 §0），不从零重推。

## 3. 设计原则

1. **按需加载**：`SKILL.md` 只放触发、决策树、唯一入口命令、输出处理和硬边界；细节放 `references/`，只在脚本输出 `next` 指向时读取。
2. **脚本优先**：确定性的检测、生成、构建、路由/链接检查全部进脚本；Markdown 只保留判断、取舍和人工验收清单。
3. **单一入口**：模型只调用 `scripts/site.mjs` 这一个入口；可以有 `scripts/lib/*.mjs` 内部模块，但不再有第二个被模型直接调用的脚本。
4. **参数化而非多脚本**：一个 `site.mjs`，用 `--action` 加 flags 覆盖 detect/scaffold/audit/check/emit-check；输出 JSON，模型读 JSON 决策。
5. **只读优先**：`detect` / `audit` / `check` 永不写文件；v1 只有 `scaffold` 会写盘，且默认 `--dry-run`，必须显式 `--apply` 才落盘。
6. **不碰全局**：不写用户全局配置、不 `git push`、不自动改 GitHub 仓库设置；写入范围严格限制在 `--repo` 指向的目录内。
7. **路径无关**：资源一律 `import.meta.url`，不依赖 cwd、不假设 skill 装在哪个仓库里。

## 4. Skill 结构

```text
.opencode/skills/starlight-docs/
  SKILL.md                     # 约 100–150 行，只做路由与边界
  scripts/
    site.mjs                   # 唯一入口
    lib/
      detect.mjs               # 仓库 / Node / Astro / Pages 检测
      scaffold.mjs             # 生成 site 结构、内容骨架、配置、组件
      audit.mjs                # 构建产物、路由、链接、i18n 体检
      check.mjs                # core + landing profile 断言（单一实现）
      emit-check.mjs           # 把 check 的内联快照导出给被操作仓库的 CI
      report.mjs               # JSON / Markdown 输出
  assets/
    pages.yml                  # GitHub Actions Pages 模板
    custom.css                 # 可选裁剪版 sd-* 预设（配色 + 排版）
    menu.css                   # 控件样式；只要生成 ThemeSelect/LanguageSelect 就必须带（否则菜单是裸的）
    components/
      ThemeSelect.astro        # 总是生成
      LanguageSelect.astro     # 仅多语言时生成
  references/
    new-site.md                # 仅在 scaffold 复杂决策时读
    audit.md                   # 非确定性审计清单（线上、视觉、可访问性）
    i18n.md                    # 双语配方 + parity 规则
    pitfalls.md                # Starlight/Pages 已知坑与修法
```

- `scripts/lib/check.mjs` 是断言的**唯一实现**；`emit-check.mjs` 只负责把同一套断言渲染成自包含脚本，不复制判断逻辑。
- `assets/` 里没有 `check-dist.mjs`：本仓库的 `site/scripts/check-dist.mjs` 是本站自己的 CI 检查（写死 `/opencode-skill-management`），属于仓库、不属于 skill，保持原样。

## 5. 唯一入口 CLI 契约

```text
node .opencode/skills/starlight-docs/scripts/site.mjs \
  --action <detect|scaffold|audit|check|emit-check> \
  --repo <被操作仓库> [flags...]
```

第二期才有 `fix` / `pages`，v1 的 `--action` 不认识它们（遇到就报 `unknown_action` 并列出可用值）。

### 通用 flags

| flag | 含义 |
|---|---|
| `--repo <path>` | 被操作仓库根；默认 cwd |
| `--json` / `--md` | 输出格式，默认 JSON |
| `--dry-run` / `--apply` | 写操作预览 / 真正落盘；默认 dry-run |
| `--force` | 覆盖已有文件（仍会先备份/报告） |
| `--verbose` | 打印执行的命令与耗时 |
| `--timeout <ms>` | 子进程超时 |
| `--no-install` | 跳过依赖安装 |
| `--no-build` | 跳过构建 |
| `--report <path>` | 把报告写到文件 |
| `--fail-on <error|warn|info>` | 退出码阈值 |

### scaffold flags

`--mode <site|root>`、`--dir <path>`、`--owner <gh-owner>`、`--name <repo>`、`--site <https://owner.github.io>`、`--base </repo>`、`--locales <root,zh-cn>`、`--default-locale <root>`、`--preset <none|developer-dark>`、`--components <auto|theme|theme+lang|none>`、`--search <pagefind|none>`、`--pages <workflow|none>`、`--node <version>`、`--astro <version>`、`--starlight <version>`、`--package-manager <npm|pnpm|yarn|bun>`。

### audit / check flags

`--dist <path>`、`--site-url <url>`、`--locales <...>`、`--i18n <auto|off>`、`--check-links <all|internal|off>`、`--max-links <n>`、`--profile <core|landing>`、`--baseline <path>`、`--browser-report <path>`（人工截图/浏览器结果由外部写入，脚本只消费）。

### emit-check flags

`--action emit-check --out <path>`、`--dist <path>`、`--base </repo>`、`--locales <...>`、`--profile <core|landing>`。导出物是普通 ESM 脚本，零依赖，只需要 Node；`--out` 缺省时报 `missing_out`，不猜路径。

### 输出 JSON（稳定契约）

```json
{
  "schemaVersion": 1,
  "ok": true,
  "action": "audit",
  "repo": "/abs/path",
  "framework": "starlight | astro | static-html | unknown",
  "profile": "core",
  "pages": { "enabled": true, "buildType": "workflow", "htmlUrl": "..." },
  "findings": [
    { "code": "CJK_LINE_HEIGHT", "severity": "warn", "path": "site/src/styles/custom.css", "line": 120, "message": "..." }
  ],
  "artifacts": [],
  "next": [{ "ref": "references/pitfalls.md", "reason": "CJK_LINE_HEIGHT" }]
}
```

`next` 是按需加载的唯一开关：没有指向的 reference 不读。`schemaVersion` 与 `skill_management` 的输出习惯对齐。

## 6. new-site 流程

1. `detect`：Node、包管理器、现有 `src/`、是否已有 Astro、Git remote、Pages 状态。
2. 选版本：按 §1 的 Node 优先级定构建 Node，再选兼容的 Astro/Starlight；记录实际解析到的版本到 `site/package.json` 与报告。Node < 22.12 时直接报 `node_unsupported` 并给升级建议，不自动降级。
3. 选布局：有代码 → `site/`；纯文档 → 根目录。
4. `scaffold --dry-run` 输出将创建/修改的文件；`--apply` 落盘。
5. 生成：`astro.config.mjs`（site/base/locales/sidebar/components）、`site/package.json`（含 `build`/`check` scripts）、内容骨架、`site/.gitignore`（`dist/`、`.astro/`）、Pages workflow、可选组件与 CSS 预设。
6. `check`：在被操作仓库装依赖、构建、跑 `core` 断言（路由集合、`base`、死链、`lang`、无语言跳转、i18n parity）；开了 landing 布局时再跑 `--profile landing`。
7. 可选 `emit-check`：把检查导出到 `<repo>/<dir>/scripts/check-dist.mjs`，并（仅在被要求时）把 workflow 的检查步接上。
8. 人工视觉验收：桌面 + 移动，亮/暗，菜单 hover/selected。
9. v1 **不做** Pages 启用（见 §8，第二期）；部署验证交给 `workflow` 模板 + 人工 push。

## 7. audit-site 流程

1. `detect` 框架与 Pages：`astro.config.*` + `@astrojs/starlight` 依赖；`gh api repos/{owner}/{repo}/pages` 的 `build_type` / `source` / `html_url` / `https_enforced`。
2. 非 Starlight：`framework: static-html|other`，只跑**通用 Pages 体检**（构建方式、`https_enforced`、404、robots/sitemap 是否存在）+ 迁移要点，**不写任何目标文件**，不给逐页迁移清单。
3. Starlight：构建、`core` 断言全套、404、search/Pagefind、canonical/OG/theme-color、robots/sitemap、Node 前置、footer 链接。
4. 视觉与交互（记入 `references/audit.md` 的人工清单，不自动判定）：标题锚点、亮色选中背景、默认主题/Auto 持久化、卡片对齐、CJK 行距、菜单 hover/selected。
5. 输出 findings + `next`；v1 不提供 `fix`，只给人工步骤。

## 8. GitHub Pages 规则（第二期，v1 不实现）

> 本节保留完整规格，但 v1 不实现 `pages` 动作，也不生成 `--enable-pages` 相关逻辑。v1 只提供 workflow 模板（`assets/pages.yml`）。

- 新站默认 Actions：`actions/upload-pages-artifact` + `actions/deploy-pages`，`pages: write`、`id-token: write`，Node 22。
- 现有站先读 `gh api .../pages`：`build_type: workflow` 与 legacy `source: {branch, path}` 是两种不同部署；不要假设。
- 启用 Pages 只允许显式 `--enable-pages`：`POST /pages -f build_type=workflow`（已启用则 `PATCH`），失败原样报告，不重试超过一次。
- 线上验证带 cache-bust 参数：状态码、语言、canonical、sitemap/robots、切页后的 theme 持久化。

## 9. i18n 配方（可选）

- locale key 是 URL 段（如 `zh-cn`），sidebar 的 `translations` 用 BCP-47（如 `zh-CN`）；root locale 用 `root`。
- 首次访问默认 root 语言，禁止 `navigator.language` 跳转；语言切换器必须映射到同一 slug。
- `check` 的轻量 parity（`core` 的一部分）：页面集合镜像、frontmatter 必填键、标题数量；不做全文翻译一致性。
- 语言切换器从 `<select>` 改成链接时，检查脚本必须同步更新（不要只改页面）。v1 直接生成链接式组件（`LanguageSelect.astro`），不再走 `<select>`。

## 10. 必须写死的坑

### Node 与版本（2026-11-03 实测）

- `astro@6.4.8` 的 `engines`：`node >=22.12.0`、`npm >=9.6.5`、`pnpm >=7.1.0`。
- `@astrojs/starlight@0.40.0` **没有 `engines`**，只有 `peerDependencies.astro: ^6.4.5`；地板由 astro 决定。
- 传递依赖：`vite@7.3.7` 是 `^20.19.0 || >=22.12.0`，`@astrojs/mdx@6.0.3` 是 `>=22.12.0`。
- 低于地板是**硬失败**，不是警告：Node 20.20.2 跑 `astro --version` →
  `Node.js v20.20.2 is not supported by Astro! Please upgrade Node.js to a supported version: ">=22.12.0"`，退出码 1。
- Node 22.12.0（正好卡线）实测：`build` 出 24 页（12 en + 12 zh），`check-dist.mjs` 5 项全绿。
- 结论：**v1 断言 Node >= 22.12.0**，错误信息直接复用 Astro 原文；不写死「Astro 6/7」，版本地板随安装结果读 `engines`。

### 主题与文字

- 默认深色只能通过 `localStorage['starlight-theme'] === null` 种入；**空字符串是 Auto**，不是“没选过”。否则用户选浅色后换页会被写回深色。
- 亮色主题的 `::selection` 必须是浅色底 + 深色字；不要复用深色主题的深橄榄色。
- 中文大标题 `line-height` ≥ 1.15；否则两行会贴住。
- Starlight 标题锚点默认 inline 在标题文字后，CJK/长标题会被链条图标压住；隐藏或移到左侧空白。
- 以上具体取值见参考实现 `site/src/styles/custom.css`；预设是裁剪版（`sd-*`），不是它的逐字副本。

### 布局

- Splash hero 无图也会保留 `7fr 4fr` 图片列；无图时覆盖为单列。
- 正文 `* + *` 的 `margin-top` 会把网格里第 2 个及之后的卡片顶下去；卡片要 `margin: 0`。
- 移动端代码块要换行或可横向滚动；不要让长命令撑破容器。
- `.md` 裸 HTML 里的 Markdown 不会渲染；要渲染的示例用 aside/组件/MDX，并保留边框面板。

### 控件

- 原生 `<select>` 的弹层 hover 由浏览器/系统绘制，CSS 控不了；主题化文档站用自定义菜单（`ThemeSelect.astro`）。
- 菜单的“当前选中”和“悬停”要分开：当前值由触发器文字表示；列表静止态同色，只有 hover 变强调色。
- 菜单在移动端要收进可访问的导航，不要把 header 撑爆。

### 构建与部署

- `base` 下的站内链接、hero action、裸 HTML 链接不会自动加前缀；逐条验。
- Pagefind 在 Windows 可能没有二进制；小站可 `pagefind: false`。
- 自定义 404 与 Starlight `404` 路由可能冲突；用 `disable404Route` 或接受官方 404。
- site-local 依赖时，CI 要用 `npm ci --prefix site`，构建用 `npm run build --prefix site`；不要假设依赖在根。
- 本仓库的历史做法（依赖在根 + `astro build --root site`）会让根 `package.json` 的 `files` 必须排除 `site/`（`package.json:9-12` 只含 `src`、`CHANGELOG.md`）。这是参考实现的做法，不是默认。

### skill 自身

- **不要用 `process.cwd()` 定位 `assets/` / `references/`**：skill 会被复制到别的仓库或全局目录，cwd 与 skill 家无关。一律 `fileURLToPath(new URL('../assets/...', import.meta.url))`。
- **不要在 skill 目录下拆出第二个 `.js` 入口给模型调用**：模型只认 `site.mjs`；`lib/` 只被 import。
- `--emit-check` 导出物是快照：不读 skill、不读配置文件；改 skill 后必须重导。

## 11. 安装与 gitignore

- 目标：`.opencode/skills/starlight-docs/`；**只放本仓库**，先不放全局。
- 当前 `.gitignore` 第 22 行忽略 `.opencode`；实施时删除该行，让 skill 进入版本库。
- 删除后现有的 `.opencode/skills/docs-sync` 与 `.opencode/command/docs-sync.md` 会变成未跟踪；**一并提交**，避免仓库里出现半忽略状态。
- 取消忽略 `.opencode` 不影响其它规则：`site/dist/`、`site/.astro/`、`node_modules/`、`.openchamber/screenshots/` 仍然被忽略。
- Skill 目录名必须与 frontmatter `name` 一致；`metadata.opencode/autoinvoke` 不设，即默认可见。

## 12. 验证计划

1. `skill_validate` + `skill_parse`：frontmatter、name、description、正文长度。
2. 静态：`--action detect` 在三个临时仓库（有代码 / 纯文档 / 非 Starlight）上输出正确 JSON。
3. smoke：临时空仓库，`scaffold --apply` → `check --apply`，必须 `build` 通过、`core` 断言全绿、路由镜像、链接全通。
   - **允许真装依赖**（`npm install`），最多跑 2 次、失败不重试超过 1 次；需要网络是已知限制。
4. `emit-check` 自包含性：把导出物放进**没有 skill 的**第四个临时仓库，只给它 `dist/` 跑一遍，必须与 skill 内 `check` 结论一致。
5. 回归：用带 CJK 标题、亮色选中、卡片网格、菜单的最小页面，检查三个历史 bug 的 CSS/JS 规则存在；`--profile landing` 在缺 `.sd-*` 类时只报 `info`。
6. 人工视觉：桌面 + 移动，亮/暗，菜单 hover/selected；没有浏览器工具时明确标“未验证”。
7. 不做完整 benchmark。

## 13. 实施顺序（审批后）

> 执行时以文首 `## Steps` 为准，逐条打勾；本节说明的是顺序与依赖关系。

**v1（本次实施）**

0. 删除 `.gitignore` 第 22 行；`docs-sync` 两个文件一并提交。
1. 分支 `feat/starlight-docs-skill`。
2. 先写 `scripts/site.mjs` + `lib/`（`detect` → `scaffold` → `check` → `audit` → `emit-check`），用临时仓库跑通。
3. 再写 `SKILL.md`（只保留入口、决策树、`next` 处理、硬边界）。
4. 写 `references/`（new-site/audit/i18n/pitfalls）与 `assets/`（`pages.yml`、裁剪版 `custom.css`、`menu.css`、`ThemeSelect.astro`、`LanguageSelect.astro`）。
5. `skill_validate`，临时仓库 smoke + `emit-check` 自包含性验证，修到 build/check/视觉都过。
6. 小步提交；合并 main；**不自动 push 任何被操作仓库、不改全局配置**。
7. v1 完全可用后，才由人决定是否复制到全局 skill 目录。

**第二期（deferred，另开计划）**

- `fix`（幂等安全的文本修复）与 `pages`（`gh api` 启用 Pages、线上验证）。
- 届时补：`--enable-pages` 的确认流程、失败回滚、cache-bust 线上验证。

## 14. 风险与待定

- Astro/Starlight API 会漂移；`site.mjs` 必须把版本检测和错误信息放在最前面（读安装后的 `engines`，不写死版本号），不能把旧版本写法写死。
- `site.mjs` 可能超过单文件舒适长度；允许 `scripts/lib/` 拆分，但模型仍只调用 `site.mjs`。
- 临时仓库装依赖需要网络且慢；失败时降到「只做静态断言 + 明确标未验证」，不要假装通过。
- `--emit-check` 产物只在 Windows 本机验证过，**Linux CI 上的行为未验证**（导出物是纯 Node，风险低但未实测）。
- skill 复制出本仓库后，路径假设（`import.meta.url`）与 `assets/` 完整性是唯一的失败点；复制后必须在新位置跑一次 `detect`。
- 第二期才涉及 `gh` 未登录、Pages 未启用；届时 `audit`/`pages` 要降级为“未验证”，不能猜。
- 非 Starlight 站点的迁移只能给建议，不自动改；避免把用户现有 Pages 构建方式弄坏。
- 浏览器视觉验收无法完全脚本化；脚本负责生成清单和截图路径，人工/宿主浏览器负责确认。
