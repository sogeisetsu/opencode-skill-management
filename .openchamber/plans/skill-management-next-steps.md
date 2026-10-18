# `skill_management` 下一步计划

> 状态基线：实现已完成并通过验收（Windows / OpenCode 2.0.32），已提交推送（`585fec5`）。
> 设计权威：`.openchamber/plans/skill-management-spec.md`（v4）· 宿主实测：`docs/preflight.md` · 验收证据：`docs/acceptance.md`
> 本文件只讲**接下来做什么**，不重复已完成的事。

---

## 一、现状与缺口（都是实测，不是推测）

| 项 | 现状 | 缺口 |
|---|---|---|
| 插件本体 / 四动作 / 验收脚本 | 已完成，136 项断言全绿 | — |
| 真实宿主验收（§7 全项） | 已完成，配置逐字节还原 | — |
| 跨平台 | **只有 Windows** 跑过 | §4.5 要求 Windows + Linux |
| 分发 | 只能"放文件 / 配置里写绝对路径" | 不能 `opencode plugin add`；`package.json` 仍是 `private: true` |
| CI | **无** | 改动没有人替我们回归 |
| `LICENSE` 文件 | **不存在**（`package.json` 却写了 `"license": "MIT"`） | 发布前必须补 |
| 备份 | 会复制整份 `opencode.jsonc` | 该文件含 MCP 凭据，备份等于复制凭据（本机 6 份备份各含 1 处 `Bearer`） |
| 模型可发现性 | `codemode:false`，可直接按名字调用 | 但不能在 Code Mode 里被找到，模型可能误判"工具不存在" |

本机可用资源（已核实）：`npm` 10.9.8 **未登录** · 包名 `opencode-skill-management` 在 npm **未被占用**（404）·
`gh` 2.100.0 **已登录**（账号 `sogeisetsu`，scope 含 `workflow`）· **WSL Debian 2 可用但没装 Linux node**（只有从 Windows 泄漏的 npm）· 无 docker。

---

## 二、推荐顺序

| 优先级 | 事项 | 价值 | 成本 | 依赖 |
|---|---|---|---|---|
| **P1** | 文档与实测保持一致 | 防止后续 session 按错结论干活 | 极小 | 无（本轮已修 1 处） |
| **P2** | Linux 逻辑层验收 | 真正闭上 §4.5 的缺口 | 小（本机可做完） | 无 |
| **P3** | CI（Windows + Linux 双跑 harness） | 把 P2 变成持续回归 | 小 | P2 验证过 Linux 能跑 |
| **P4** | 发布到 npm，打通 `plugin add` | 从"本机自用"变成"别人能装" | 中 | **你登录 npm**；1 个未证点 |
| **P5** | 备份策略（凭据重复） | 消除一个我引入的副作用 | 极小 | **你决定策略** |
| **P6** | 模型可发现性硬化 | 减少真实使用中的误判 | 小 | 观察数据 |

**如果只能做一件：P4**（那是你最早提的方向）。**如果想先零风险积累：P2 + P3**（半天内可完成，且 P3 之后 P4 的每次改动都有回归保护）。
建议：**P2 → P3 → P4 并行推进 P5/P6 的决定**。

---

## 三、各项执行细则

### P1 文档与实测一致（本轮已做）

- 已修正规范 3 处：早先写"必须加薄 `server` 壳才能被 `plugin add` 收下"——**实测推翻**（见下）。
  宿主判入口用 `kE()` → `n(["server",""])`：先试 `<pkg>/server`，失败**回退到包根**。
  用宿主同一解析器（`Bun.resolveSync`）复现：只有 `exports:{".":"./index.js"}` 的包，`l.server` 仍解析成功 → 门禁通过。
  → **不需要 `server` 壳**，也就不必牵扯 v1 的 `Hooks` API。
- 收尾动作：以后凡是"宿主行为"结论，都按规范文头的真源规则（二进制 + `opencode debug *`）取证后再写进文档。

### P2 Linux 逻辑层验收

目标：证明插件与验收脚本没有 Windows-only 假设（路径、EOL、BOM、JSONC 编辑、来源/scope 归类）。

1. 在 WSL Debian 里装 Linux Node，**不用 sudo**（避免动 root 状态）：
   ```bash
   mkdir -p ~/.local/node && cd /tmp
   curl -fsSLO https://nodejs.org/dist/v22.23.1/node-v22.23.1-linux-x64.tar.xz
   tar -xJf node-v22.23.1-linux-x64.tar.xz -C ~/.local/node --strip-components=1
   export PATH="$HOME/.local/node/bin:$PATH" && node --version
   ```
   （版本与 Windows 侧对齐，目前是 22.23.1。）
2. 跑验收：
   ```bash
   cd "/mnt/e/opencode agents/Skill Management" && node tools/verify.mjs
   ```
3. **验收标准**：136/136。失败则用 `--section A`…`F` 逐段定位，修掉平台假设后补断言。
4. 预期风险（先知道再看结果）：
   - `/mnt/e` 是 9p 文件系统，权限位语义与 ext4 不同（`chmod` 基本无效）。当前 harness 没有依赖权限位的断言，理论上不受影响。
   - `path.sep` 差异：harness 的夹具全用 `path.join`，且 `source`/`scope` 归类是按 `path.relative` 判断，应该通得过 —— 这正是要验的东西。
5. **局限（必须写清楚）**：这验证的是**逻辑层**跨平台。**真实宿主（OpenCode Linux 端）的跨平台仍未证** —— 本机没有 Linux 的 OpenCode 安装，除非你愿意在 WSL 里装一个。

### P3 CI（gh 已就绪，scope 含 `workflow`）

1. 新增 `.github/workflows/verify.yml`：
   - 触发：`push` 到 `main` + `pull_request`
   - matrix：`ubuntu-latest`、`windows-latest`
   - 步骤：`actions/checkout@v4` → `actions/setup-node@v4`（node 22）→ `node tools/verify.mjs`
2. 关键点：harness 全程跑在**临时** `<config>` 下（`XDG_CONFIG_HOME` 指向 mkdtemp），**不读也不写任何真实配置**，所以 CI 里可以安全直跑，无需任何 secret 或服务。
3. 验收：两个平台都绿；本地用 `gh workflow run` / `gh run watch` 也能触发查看。
4. 可选（不建议现在做）：发布自动化（`npm publish` on tag）。发布涉及凭据，手动更稳。

### P4 发布到 npm —— 打通 `opencode plugin add`

**前置（代码/仓库侧）**
1. 补 `LICENSE`（MIT 全文；年份 + 作者名按你的意愿）。
2. `package.json`：去掉 `"private": true`；`version` 定 `0.1.0`；补 `repository` / `bugs` / `homepage` / `keywords`；`files` 确认只含 `src`（`exports` 目前是 `"." -> ./src/skill_management.js`，保持不变）。
3. README 安装段落改序：**优先 `opencode plugin add`**，兜底才是"放进 `<config>/plugins/`"。

**唯一的未证点（必须先验）**
> 今天只证了"`plugin add` 的 CLI 门禁会收下只带包根的包"。**运行时**是否由 server 端加载器正常加载 `{id, setup}` 仍未证。

验证方式（任选，推荐第一个）：
- **发一个预发布版**：`npm publish --tag next` 发 `0.1.0-rc.0` → `opencode plugin add opencode-skill-management@0.1.0-rc.0` → **新进程**里 `opencode run --standalone --auto --format json '...action list...'` 看是否被调用成功。
- 退路（已证实会被优先采用）：加 `exports["./server"]` 指向同一个文件。加了它，`l.server` 走第一条分支，运行时也走这个入口。

**发布（需要你手动一次）**
```pwsh
npm login          # 交互式，只能你来
npm publish --access public
```
包名未被占用（已核实 404），无需改 scoped 名。

**发布后验收**
- `opencode plugin add opencode-skill-management` 写进全局配置 `plugins` 数组；
- 新会话里 `skill_management({action:"list"})` 可用；
- `opencode plugin list` 显示 source 为包名；`opencode plugin update` / `remove` 生命周期可用；
- 更新 `docs/preflight.md`：把"`plugin add` 这条留待发布阶段"改成实测结论。

**注意**：`plugin add` 是**先安装、后校验入口**，入口不合规的包会被装进缓存后报错（配置不写、但安装已发生）。

### P5 备份策略（需要你选一个）

现状：每次写前备份整份 `<config>/opencode.jsonc` 到 `<config>/skill_management.backups/`，滚动保留 10 份。
该文件含 MCP 凭据 → 备份把凭据多复制了几份（本机实测 6 份备份各含 1 处 `Bearer`）。

| 选项 | 效果 |
|---|---|
| **A. 只留 1 份滚动备份**（推荐） | 仍有"写坏能回滚"的保障，凭据副本从 10 份降到 1 份 |
| B. 完全关闭备份 | 最干净，但失去文件级兜底（内存里仍有原文用于回滚） |
| C. 保持现状 | 不改代码 |

选 A 的话我改 `MAX_BACKUPS` 并补一条断言，然后重跑 harness。

### P6 模型可发现性（低成本先做）

问题：`codemode:false` 让工具进原生表（**已实测**模型能直接按名字调用），但它**不在 Code Mode 目录里** —— 模型若习惯性地在 `execute` 里用 `search()` / `tools.*` 去找，会得出"工具不存在"并放弃（真实发生过一次）。

建议分两步，别一上来就改 `codemode`：
1. **先硬化 description**：加一句明确"这是原生工具，直接按名字调用即可，不要用 Code Mode 的 `search()`/`execute` 去找它"。
2. 观察仍被误判，再考虑 `options.codemode` 改为 `true`（代价：受 Code Mode 目录大小限制，本机另一个大型插件的注释记录过"工具因目录截断而掉出去"的经历）。

---

## 四、需要你决定的三件事

1. **npm 发布**：走 npm 公开发布（名字可用、需要你 `npm login`），还是只发 Git spec / 干脆只在本机用？
2. **备份策略**：P5 的 A / B / C。
3. **`codemode`**：先只改 description，还是直接改成 `true`？

---

## 五、明确不做（避免范围蔓延）

- **Linux 真实宿主验证**：本机无 Linux 的 OpenCode 安装；P2 只覆盖逻辑层。要真做需要你在 WSL 里装一个 OpenCode。
- **`ask` 的独立动作**：`disable` 的 `effect` 参数已覆盖该能力，不必再加动作。
- **项目级 `.opencode/plugins` 支持**：已定"只做全局"，不回头改。
- **`policies` / `experimental.policies` 写入**：属硬边界，永久不做。
- **`effect: "allow"`**：会遮蔽更宽的规则，越出"只增删自己那一条"的边界，不做。
