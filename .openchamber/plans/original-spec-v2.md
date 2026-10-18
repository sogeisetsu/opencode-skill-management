# skill_management 工具规范

> 状态：待实现（plan 阶段产出）
> 适用范围：**跨平台**，Windows / macOS / Linux 通用；只依赖 OpenCode V2 本身（见 §10、§11）。
> 本机环境：Windows + PowerShell 7 + OpenCode **v2.0.28**（二进制 `C:\Users\suyue\AppData\Local\Programs\@openchamberelectron\resources\opencode-cli\opencode.exe`，仅作定位用，不构成依赖）。
> 本文取代此前的 `pasted-context-1.txt` 规范。改动理由见文末「与前版规范的差异」。

---

## 0. 定位与边界

一个 tool，四个动作：`list` / `inspect` / `disable` / `enable`。

- 唯一写操作是**改配置里该 skill 的 permission 规则**。
- **不装、不删、不移动、不改动任何 skill 文件**（含 SKILL.md frontmatter）。
- 不动配置里非本工具写入的内容。

---

## 1. 载体（V2 现实）

V2 没有「工具文件」形态，已核实：

- 源码 `packages/core/src/config/plugin/` 覆盖 agent、command、mcp、skill、shell、provider……**没有 tool.ts**，即不存在 tools 目录发现。
- V2 文档原话：*"There is no separate tool file convention — tools are registered programmatically."*
- V1 的 `~/.config/opencode/tools/<name>.ts`（文件名即工具名）在 V2 不生效。

**落地方式**：本地插件文件

```
C:\Users\suyue\.config\opencode\plugins\skill_management.js
```

- 全局插件目录自动发现，**不需要**改 `opencode.jsonc` 的 `plugins` 数组。
- 文件名沿用 `skill_management`（保留 V1 习惯），但**工具名的唯一来源是注册时的 `name`**，与文件名无关。
- 注册入口与内置 read/edit 完全相同（`Tool.Service.transform` → `editor.add`），不是外挂：

```js
export default {
  id: "skill_management",
  async setup(ctx) {
    await ctx.tool.transform((editor) =>
      editor.add({
        name: "skill_management",
        options: { codemode: false },   // 进原生工具表，像 read/edit 一样按名字直接调
        description: "...",             // 见 §5
        input: { /* JSON Schema，见 §2 */ },
        async execute(input) { /* ... */ },
      }),
    )
  },
}
```

- 纯 Node 内置模块，**不引入任何第三方依赖**。
- **实现第 0 步（实证）**：在 `C:\Users\suyue\.config\opencode\tools\skill_management.ts` 放一个最小工具，确认 2.0.28 是否识别。预期不识别；若识别，改用该路径（更省事且完全符合原规范的文件名约定）。

---

## 2. 接口

单一工具，入参：

```jsonc
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": ["list", "inspect", "disable", "enable"],
      "description": "list = 列出所有 skill 及状态；inspect = 查单个 skill 详情与不可用原因；disable = 停用；enable = 恢复"
    },
    "name": {
      "type": "string",
      "description": "skill id。inspect / disable / enable 必填"
    },
    "scope": {
      "type": "string",
      "enum": ["user", "project", "all"],
      "default": "all",
      "description": "扫描范围。默认 all"
    },
    "dryRun": {
      "type": "boolean",
      "default": false,
      "description": "写操作只预览将要做的改动，不落盘"
    }
  },
  "required": ["action"],
  "additionalProperties": false
}
```

调用形态：

```
skill_management({ action: "list" })
skill_management({ action: "inspect", name: "grill-me" })
skill_management({ action: "disable", name: "grill-me" })
skill_management({ action: "enable",  name: "grill-me" })
skill_management({ action: "disable", name: "grill-me", dryRun: true })
```

返回值：Markdown 文本（表格 + 一行结论）。不返回 JSON 包装，不返回 skill 正文。

---

## 3. 动作规格

### 3.1 `list`

扫描全部来源，逐条输出一行：

| 字段 | 说明 |
|---|---|
| `id` | skill id（路径派生） |
| `source` | `built-in` / `user` / `user-claude` / `user-agents` / `project` / `plugin-managed` / `catalog(url)` |
| `scope` | `user` 或 `project` |
| `state` | `available` / `disabled` / `ask` / `denied-for-agent` |
| `path` | SKILL.md 路径（catalog 来源则为 URL） |

- **只输出 name / description（首行，截断）/ path，绝不输出 SKILL.md 正文。**
- 扫描面：`~/.config/opencode/skills`、`~/.claude/skills`、`~/.agents/skills`、项目 `.opencode/skills` / `.claude/skills` / `.agents/skills`、配置里的 `skills` 条目（含远端 `urls`，标 `catalog`）、内置 skill。
- 末尾附一行统计：发现 N 个、其中已禁用 M 个、当前生效的 skill 规则 K 条。
- 一致性检查：若 sidecar 记录了某条规则而配置里不存在，输出一行 `⚠️ sidecar 与配置不一致` 提示。

### 3.2 `inspect`

单个 skill 的完整诊断：

- 命中的文件路径、来源层、scope。
- 同名冲突：所有定义同一 id 的来源 + 优先级顺序 + 最终胜者。
- frontmatter 关键字段（`name` / `description` / `metadata.opencode/*`）。
- **有效 permission 结论**：按 last-match-wins 求值，明确指出「被哪一层、哪一条规则、判定为什么」。
- agent 级覆盖差异（如本机 `explorer` / `librarian` / `oracle` 对 skill 是 deny）。
- 一句话结论：为什么它当前不可用（或可用）。

### 3.3 `disable`

1. 解析该 id 的当前有效状态；已是 deny 则直接返回「已经是停用状态」，不重复写。
2. 若该 id 已被更宽的规则（如 `internal-*`）覆盖为 deny，提示「已被 `<规则>` 覆盖，无需新增」。
3. 目标写入：全局配置的 skill 规则集，新增一条

   ```jsonc
   { "action": "skill", "resource": "<id>", "effect": "deny" }
   ```

4. 写前：备份目标文件；`dryRun` 时只打印将插入的片段并结束。
5. 写后：回读校验该 id 现在解析为 `deny`；校验失败 → 回滚到备份并报错，不留半成品。
6. 成功后写入 sidecar（§4.3）。

### 3.4 `enable`

1. 依 sidecar 精确定位**本工具写入的**、针对该 id 的规则并删除。
2. 若该 id 的 deny 规则不是本工具写的（sidecar 无记录）→ **拒绝执行**并说明原因，不擅自删用户的规则。
3. 删完若规则集为空，把空块一并清理干净。
4. 同样的备份 + `dryRun` + 回读校验。

---

## 4. 配置写入规约

### 4.1 目标文件

全局配置目录**按 OpenCode 自身规则解析，不写死路径**：

1. `$XDG_CONFIG_HOME/opencode`，未设置时回退 `~/.config/opencode`；
2. 探测 `opencode.jsonc`，不存在则 `opencode.json`；两者都不存在时以 `.jsonc` 新建。

- 系统级配置（Windows `%ProgramData%\opencode\opencode.jsonc`、macOS `/Library/Application Support/opencode`、Linux `/etc/opencode`）需要管理员权限，不使用。
- 同一条规则覆盖三平台：OpenCode 在 Linux / macOS / Windows 都读 `~/.config/opencode`（XDG 未设置时的回退），所以不需要按 OS 分支。
- 本机命中 `C:\Users\suyue\.config\opencode\opencode.jsonc`（仅示例，实现不写死）。

### 4.2 形状与写法

- 优先写 V2 原生形状：顶层 `permissions: [{ action, resource, effect }]` 数组。
- **实现第 1 步实测确认**：写一条 → 观察该 skill 是否从模型可见列表消失 → 撤销；若不认则退回 V1 形状 `permission: { skill: ... }`，并回来更新本节。
- 文件是 JSONC（含注释）：
  - 用**最小文本编辑**插入/删除条目，保留注释、缩进、键顺序。
  - **禁止** parse → 对象 → 序列化 → 回写。
- 目标键不存在 → 在顶层追加整块；已存在 → 在其数组末尾插入条目。

### 4.3 sidecar 状态文件

```
C:\Users\suyue\.config\opencode\skill-management.state.json
```

```jsonc
{
  "version": 1,
  "rules": [
    { "id": "grill-me", "effect": "deny", "file": "...opencode.jsonc", "insertedAt": "2026-10-18T..." }
  ]
}
```

用途：`enable` 的精确定位——区分「本工具写入的规则」与「用户手写的规则」，前者可删，后者不擅自删。状态判定本身始终以**配置文件内容**为准，sidecar 只作辅助。

### 4.4 写入一致性

- 写前记录目标文件哈希；写完若实际内容与预期不符（并发改写）→ **停止并报告，不静默重试**。
- 写后回读校验：确认该 id 现在解析为预期效果；不符则回滚到备份。
- `list` 若发现 sidecar 有记录而配置里已无对应规则，附一行提示（不自动重放）。

---

## 5. 工具 description（给模型看的那段）

> List, inspect, enable or disable installed OpenCode skills. `list` shows every discovered skill with its effective state (available / disabled / ask / denied-for-agent). `disable` hides a skill from the model and rejects loading it by writing a skill permission rule — it never touches skill files. `enable` removes that rule. Use when the user asks which skills are installed, why one is not available, or wants one turned off or on.

语义必须写清楚（避免模型误用）：

- `deny` = 从模型可见列表隐藏 **且** 拒绝 `skill` 工具加载。
- 想要「藏起来但仍可显式加载」→ 用 `effect: "ask"`；本工具的 `disable` 固定写 `deny`。
- agent 级 `agents.<id>.permissions` 可覆盖全局规则。本工具**只报告**，不代改 agent 配置。
- 生效时机：配置目录受 watch，理论上热加载；由新会话验证，若需要重启会明确告知。

---

## 6. 不做（硬边界）

- 不安装 / 下载 / 卸载 skill；不删除、不移动、不改写任何 skill 文件。
- 不改 SKILL.md frontmatter。
- 不动全局配置以外的配置；不写系统级配置；不动任何非 OpenCode 的文件。
- 不猜测：任何状态结论必须来自实际读到的文件或配置；取不到就写「未验证」。

---

## 7. 验收

1. **载体实证**：`~/.config/opencode/tools/skill_management.ts` 是否被 2.0.28 识别（预期否）。
2. **形状实证**：V2 `permissions` 数组能否让 skill 从模型可见列表消失（预期能）。
3. 新会话中按名字**直接**调用 `skill_management({ action: "list" })` 成功，输出覆盖本机全局 skill 与内置 skill。
4. `{ action: "disable", name: "grill-me" }` → 新会话该 skill 从模型可见列表消失、`skill` 工具加载被拒、`list` 显示 `disabled`；`enable` 后完全还原；`opencode.jsonc` 前后只差这一条规则。
5. `dryRun: true` 不产生任何文件改动（前后哈希一致）。
6. 一致性：手动删掉配置里那条规则后，`list` 以配置为准正确显示该 skill 已恢复可用，并给出一行 sidecar 不一致提示。

---

## 8. 假设与待实测清单

| 项 | 依据 | 状态 |
|---|---|---|
| V2 无 tools 目录发现 | 源码 `packages/core/src/config/plugin/` 无 tool.ts；V2 文档明文 | 已核实 |
| 本地插件 = `~/.config/opencode/plugins/*.js` 自动发现 | V2 插件文档 | 已核实（文档） |
| `ctx.tool.transform` + `editor.add` 在 2.0.28 可用 | 本机 `opencode-skill-creator@0.3.5` 走的就是这条 v2 分支 | 已核实（本机） |
| `options: { codemode: false }` 对内联 tool 可见 | `packages/schema/src/tool.ts` 的 `Options`；内置 read/edit/skill 均如此 | 已核实（源码） |
| `ctx.location.directory` 可用 | 同插件 v2 分支直接读取 | 已核实（本机） |
| 2.0.28 接受原生 `permissions` 数组 | V2 迁移文档；本机配置目前无 permission 键 | **待实测（实现第 1 步）** |
| 配置改动热加载、无需重启 | 用户实测确认；V2 插件文档亦述 watched config directories reload automatically | 已确认（用户） |
| 全局配置文件名可能是 `opencode.json` | V2 配置文档列出两种扩展名 | 已知；解析与写入需同时兼容 |
| 不依赖任何宿主 | §10 | 设计约束 |
| 跨平台可用（Linux / macOS / Windows） | 纯 Node 内置模块、不调用 shell；三平台配置目录规则一致 | 设计约束，见 §11 |
| 全局 skill 目录中哪些是插件/市场托管 | 需逐个比对来源 | **待实现时确认** |

---

## 9. 与前版规范（`pasted-context-1.txt`）的差异

**采纳**：四个动作（`list` / `disable` / `enable` / `inspect`）、`disable` 走 permission `deny`、硬边界「不装不删不移动」、工具名 `skill_management`。

**修正**：

1. **载体**：前版假设「文件名即工具名」，那是 V1 约定，在 2.0.28 会静默不加载。改为本地插件注册，文件名保留但名称来源改为注册时的 `name`。
2. **可调用性**：补 `options: { codemode: false }`，否则工具会落进 Code Mode 目录、无法按名字直接调用。
3. **写入安全**：补备份、`dryRun`、写后回读校验、并发哈希检测、sidecar——因为目标配置是含注释的 JSONC，且要能精确撤销自己写过的东西。
4. **状态求解**：补「合并全局 / 项目 / agent 三层配置、last-match-wins 求值」与 agent 级覆盖的报告，这是 `list` / `inspect` 正确性的核心。
5. **语义澄清**：写明 `deny` 与 `ask` 的区别，以及 `deny` 比「仅隐藏」更硬。

---

## 10. 不依赖宿主

只面向 OpenCode V2 设计，不为任何外层应用（桌面壳、编辑器、marketplace）做定制：

| 组成 | 归属 |
|---|---|
| 插件加载 | OpenCode：`~/.config/opencode/plugins/` |
| 配置读写 | OpenCode：全局 `opencode.json(c)` |
| skill 发现 | OpenCode：`~/.config/opencode/skills` 等 |
| 会话上下文 | OpenCode：`ctx.location.directory` |

实现约束：

- 不引用外层应用的安装路径，不读它的私有文件；
- 不假定配置目录是某个具体绝对路径（见 §4.1）；
- 任何「额外保护」都必须对纯 OpenCode 环境同样成立，不以某个外层应用的存在为前提。

---

## 11. 跨平台实现约束

工具本体与操作系统、与 shell 都无关——**不调用任何 shell**（不用 PowerShell、bash、cmd），全部文件操作走 Node 内置模块 `node:fs` / `node:path` / `node:os`。所以「PowerShell 7」只出现在本机环境标注和实现时的验收命令里，不进代码。

具体规则：

- **家目录**一律 `os.homedir()`；不把 `%USERPROFILE%`、`~` 当路径用。
- **路径**一律 `path.join` / `path.resolve`，禁止手写 `\` 或 `/` 拼接；文件比较用规范化后的绝对路径。
- **换行符**：读入时探测文件现有风格（CRLF / LF），写入时保持原样；新建文件用 LF。
- **BOM**：读入时剥离，写入时不添加；解析 JSONC 前统一去 BOM。
- **写入方式**：先备份再原文件覆盖；不依赖「重命名原子替换」这类跨平台行为不一致的操作。
- **大小写**：Linux 上路径与 skill id 区分大小写，匹配一律精确匹配，不做大小写不敏感归一。
- **系统级配置**：`%ProgramData%\opencode`（Windows）、`/etc/opencode`（Linux）、`/Library/Application Support/opencode`（macOS）一律不碰。
- **验收**：§7 的核心两条（`list` 正确、`disable` → 消失 → `enable` 还原）需在 Windows 与 Linux（或 WSL）各跑一遍。
