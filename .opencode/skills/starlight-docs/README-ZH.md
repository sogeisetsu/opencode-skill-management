# starlight-docs

一个 OpenCode skill：为 **GitHub Pages** 上的 **Astro Starlight** 文档站做搭建、体检与修复。

它的边界很窄：所有判断都来自实际读到的构建产物与仓库配置，不靠记忆；并且不修改 `--repo` 指向的仓库以外的任何东西。

## 能做什么

| 动作 | 行为 |
|---|---|
| `detect` | 只读：框架、布局（`site/` 还是仓库根）、Node 版本、包管理器、git remote、GitHub Pages 状态 |
| `scaffold` | 生成 Starlight 骨架：配置、站点私有 `package.json`、内容占位页、可选组件/CSS 预设、Pages workflow。默认 dry-run |
| `check` | 按需装依赖、构建，然后断言构建产物：路由集合、多语言镜像、`base`、死链、`lang`、无语言嗅探、语言切换器、每页一个 `<h1>` |
| `audit` | 先识别框架，再跑 `check` 加 404 / 搜索 / canonical / OG / sitemap / sidebar 一致性；非 Starlight 站点只给只读 Pages 报告 |
| `emit-check` | 把同一套断言导出成零依赖脚本，交给目标仓库的 CI |

`fix` 与 `pages` 不在本版本范围内，调用会返回 `unknown_action`。

## 环境要求

- **Node.js >= 22.12.0**。Astro 6.4 在 `engines` 里硬性要求；低于它是构建硬失败，不是警告。skill 会报 `node_unsupported`，不会自动降级。
- 一个 Git 仓库。GitHub remote 只在 `detect` 的 Pages 部分需要；没有 `gh` 或没有 remote 时报告写 **未验证**，不猜。
- 只有在装依赖和显式 `--check-links all` 时才需要网络。

## 快速开始

```pwsh
# 0. 先看事实
node .opencode/skills/starlight-docs/scripts/site.mjs --action detect --repo .

# 1. 预览骨架，再落盘
node .opencode/skills/starlight-docs/scripts/site.mjs --action scaffold --repo . --owner <gh-owner> --locales root,zh-cn
node .opencode/skills/starlight-docs/scripts/site.mjs --action scaffold --repo . --owner <gh-owner> --locales root,zh-cn --apply

# 2. 装依赖、构建、断言
node .opencode/skills/starlight-docs/scripts/site.mjs --action check --repo . --profile landing

# 3. 体检已有站点
node .opencode/skills/starlight-docs/scripts/site.mjs --action audit --repo . --profile landing

# 4. 把同一套断言接进目标仓库 CI
node .opencode/skills/starlight-docs/scripts/site.mjs --action emit-check --repo . --out site/scripts/check-dist.mjs
```

对模型来说只有 `scripts/site.mjs` 这一个入口；`scripts/lib/*.mjs` 是内部模块，不是第二套 API。

## 输出

默认 JSON（`--md` 出 Markdown）。顶层形状稳定：

```json
{
  "schemaVersion": 1,
  "ok": true,
  "action": "audit",
  "repo": "/abs/path",
  "framework": "starlight",
  "profile": "core",
  "pages": { "status": "verified", "buildType": "workflow" },
  "findings": [{ "code": "DEAD_LINK", "severity": "error", "path": "index.html", "message": "..." }],
  "artifacts": [],
  "next": [{ "ref": "references/pitfalls.md", "reason": "DEAD_LINK" }]
}
```

- `findings[].severity`：`error` 让本次运行失败，`warn` 需要人工判断，`info` 是提示（例如缺少可选的 landing 类名）。
- `next` 是按需加载的唯一开关：只读它列出的 reference。
- 退出码：默认 `--fail-on error`；`--fail-on warn|info|off` 可改阈值。

## 安全边界

- `detect`、`check`、`audit` 不写目标仓库。
- `scaffold` 默认 dry-run；只有 `--apply` 才落盘。已有文件默认跳过，`--force` 才覆盖，并且覆盖前先备份到系统临时目录。
- `emit-check` 是唯一默认写盘的动作（`--out` 已经指定了唯一文件）；要预览用 `--dry-run`。
- 不写用户全局配置、不 `git push`、不修改 GitHub 仓库设置。

## 目录结构

```text
starlight-docs/
├── SKILL.md                     # 模型入口：触发、决策树、唯一入口、next、硬边界
├── README.md                    # 英文说明（给人看）
├── README-ZH.md                 # 中文说明（给人看）
├── LICENSE                      # MIT
├── scripts/
│   ├── site.mjs                 # 唯一入口：参数解析、5 个 action 分发、结构化报错
│   └── lib/
│       ├── detect.mjs           # 仓库/布局/Node/包管理器/Astro/Starlight/Pages 检测
│       ├── scaffold.mjs         # 布局、文件清单、dry-run/apply、安装与构建辅助
│       ├── check.mjs            # 断言唯一实现（core + landing），只用 node 内置模块
│       ├── audit.mjs            # 框架识别 + 复用 check + 404/SEO/sidebar 检查
│       ├── emit-check.mjs       # 把 check.mjs 渲染成零依赖的自包含脚本
│       └── report.mjs           # JSON/Markdown、next 映射、--fail-on 退出码
├── assets/
│   ├── pages.yml                # GitHub Pages workflow 模板（占位变量）
│   ├── custom.css               # 可选 sd-* 预设（约 200 行，含 pitfalls 的修法）
│   ├── menu.css                 # 主题/语言菜单样式（含手机端 splash 修复）
│   ├── favicon.svg              # Starlight 总会链接 /favicon.svg，缺了就是死链
│   └── components/
│       ├── ThemeSelect.astro    # 总是生成；原生 select 弹层控不了
│       └── LanguageSelect.astro  # 仅多语言时生成；链接式切换器
└── references/                  # 只在 next 指向时读
    ├── new-site.md              # scaffold 取舍、生成物、README 搬运、落地验收
    ├── audit.md                 # 非确定性审计（线上/视觉/可访问性/非 Starlight 迁移）
    ├── i18n.md                  # 双语配方、locale key 与 BCP-47、parity 规则
    └── pitfalls.md              # 版本/Node/base/主题/CJK/卡片/菜单/CI 的坑与修法
```

## 已知限制

- 视觉与交互无法由脚本断言。`audit --browser-report <json>` 只消费外部写入的清单；人工清单在 `references/audit.md`。
- `--check-links all` 依赖运行时网络路径。Node 的 `fetch` 不读 `HTTP(S)_PROXY`（除非 `NODE_USE_ENV_PROXY=1`）；失败按 blocked / unverified / unreachable 分级，不应作为 CI 门禁。
- 导出的检查器是一次性快照；升级本 skill 后必须重导。
- GitHub Pages 的启用与线上验证留到后续版本；本版本只提供 workflow 模板。

## 许可证

MIT，见 [LICENSE](./LICENSE)。
