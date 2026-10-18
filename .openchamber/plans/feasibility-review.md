# 可行性评测：`skill_management`

评测对象：`C:/Users/suyue/.opencode/plan/skill_management-spec.md`
评测日期：2026-10-18 · 评测人：OpenCode 会话（本机）
证据基线：OpenCode **2.0.32**（计划里写的是 2.0.28）+ V2 配置 JSON Schema + `@opencode-ai/sdk` 类型 + `@opencode-ai/plugin` 类型 + 本机已装 `opencode-skill-creator@0.3.5`

## 结论

**可行，且不需要改设计方向。** 唯一写操作（往全局配置的 `permissions` 数组加一条 `{action:"skill", resource:"<id>", effect:"deny"}`）在源码层面已被证实既能隐藏 skill、又能拒绝加载；载体、调用方式、配置形状也都有实证。

需要在 4 处收紧、1 处改写实现思路：

| # | 问题 | 严重度 | 处理 |
|---|---|---|---|
| 1 | 「插件目录 `~/.config/opencode/plugins/*.js` 自动发现」只有文档依据，本次未实证 | 中 | 改为主推「配置 `plugins` 数组写绝对路径」（已实证），目录发现降为备选 |
| 2 | 「自己合并全局/项目/agent 三层求值」多余且易错 | 中 | 直接用 `ctx.agent.list()`：V2 启动时已把配置里的 `permissions` 追加进每个 agent，读到的就是最终规则 |
| 3 | skill 发现规则写得不全（漏 `<cfg>/skill` 单数目录、漏 `<name>.md` 单文件布局；远端 catalog 的 `path` 是缓存目录不是 URL） | 中 | 改写 §3.1；`list` 改用 `ctx.skill.list()` 取注册表，不再自己扫盘 |
| 4 | sidecar 状态文件 | 低 | V2 插件自带 `ctx.storage`（get/set/remove/scan），可替代手写文件；也可保留文件（更可审计）。二选一 |
| 5 | `inspect` 的 agent 级覆盖 | 低 | 是 `agents.<id>.permissions`（不是 `permission`）；另有 `policies` 的 `integration.use` 可把 skill 从注册表整体移除，属另一机制，建议只读报告不代写 |

## 逐条核实

| 主张 | 结论 | 证据 |
|---|---|---|
| V2 没有 tools 目录约定，V1 的 `~/.config/opencode/tools/<name>.ts` 无效 | 未直接证实，但无相反证据 | 二进制内工具注册全部经 `tool.transform`；插件来源类型只有 `builtin / package / local / sdk`。保留最低成本实证（见新计划 §1 preflight） |
| 载体=本地插件，`export default { id, setup(ctx) }`，`ctx.tool.transform(editor => editor.add({...}))` | **已证实** | 二进制内 `Plugin = { id, setup }`；`opencode-skill-creator@0.3.5` 的 v2 分支即 `await ctx.tool.transform(e => e.add({name, description, input, execute}))`，其工具在本机会话里可按名字直接调用 |
| `ctx.location.directory` 可用 | **已证实** | 同上插件 v2 分支读取 `ctx.location?.directory`；运行时 ctx 还暴露 `location / tool / skill / permission / agent / storage / session / event` 等 |
| 本地插件目录自动发现 | **未证实** | 本机 `~/.config/opencode/plugins/` 存在但为空；`opencode plugin list` 只列出 npm 包与一条 `local` 插件（路径来自配置）。本次实测无法隔离（该 CLI 默认连正在运行的服务） |
| 配置 `plugins` 可写本地绝对路径 | **已证实** | 本机 `opencode.managed.json` 用 `"plugins": ["C:\\Users\\...\\openchamber-agent-tool"]` 注入插件，`opencode plugin list` 显示 `openchamber-agent-tool local C:\...\index.js` |
| V2 顶层 `permissions: [{action, resource, effect}]` | **已证实** | 配置 schema 顶层有 `permissions` → `Permission.Ruleset`；`Permission.Rule = {action:string, resource:string, effect:"allow"\|"deny"\|"ask"}`；`permission`（单数、对象式）已被标记 deprecated |
| 求值 = last-match-wins，作用在 agent 规则上 | **已证实** | 求值函数：`findLast(r => glob(action, r.action) && glob(resource, r.resource))`，候选 = `agent.permissions ++ session.permissions`（+ 本会话已批准的 always 规则）。无命中时兜底 `{action, resource:"*", effect:"ask"}`；内置默认首条是 `{action:"*", resource:"*", effect:"allow"}` |
| 全局配置的 `permissions` 能覆盖 agent 默认 | **已证实** | `opencode.config.agent` 把配置文档里的 `permissions` `push` 进**每个** agent 的规则数组（`for (Q of T.list()) T.update(Q.id, C => C.permissions.push(...O))`），追加在后 → `findLast` 命中配置规则 |
| `deny` = 从模型可见列表隐藏 + 拒绝加载 | **已证实** | ① 可用 skill 列表过滤：`skills.filter(i => eval("skill", i.id, rules).effect !== "deny")` ② `skill` 工具执行前 `permission.assert({action:"skill", resources:[skill.id], save:[skill.id]})`，deny 抛错 |
| `action:"skill"`、`resource:"<skill id>"` | **已证实** | 上述两处均以字面量 `"skill"` 为 action、以 skill 的 `id` 为 resource；匹配走 glob，因此 `internal-*` 这类通配可行 |
| `disable` 只需写全局一条规则 | **已证实** | 配置 `permissions` 会追加进所有 agent，无需逐 agent 写 |
| `enable` 需精确区分「本工具写的规则」与「用户手写的规则」 | 设计成立 | 无宿主 API 支持，必须靠 sidecar 或注释标记；建议二者结合（见新计划 §4.3） |
| `options: { codemode: false }` 必须加 | **已证实** | 内置 `skill` 工具注册为 `options:{codemode:!1}`，`patch`/`edit` 为 `options:{codemode:!1, permission:"edit"}` |
| 接口用原生 JSON Schema | **未证实** | 内置工具传的是 effect Schema，skill-creator 传的是 zod→JSON Schema 的转换结果。需在 preflight 实测原生 JSON Schema 是否被接受 |
| 全局配置路径按 XDG 解析、不写死 | **已证实** | `opencode debug paths` 给出 `config` / `data` / `cache` / `state`；Windows 下 `config = ~/.config/opencode`。设 `XDG_CONFIG_HOME` 后 `config` 随之变化 |
| 只写全局配置，不碰系统级配置 | 成立且正确 | 同上，系统级路径未被使用 |
| skill 来源：`~/.config/opencode/skills`、`~/.claude/skills`、`~/.agents/skills`、项目 `.opencode/skills`、配置 `skills` 条目（含 URL）、内置 | **已证实，但要多写两条** | 见下「发现规则修正」 |
| 配置改动热加载、无需重启 | 未验证 | 二进制内 skill/agent/config 都挂了 watcher 并订阅 `config.updated`；仍需按新计划 §7 用新会话证实 |
| 跨平台：纯 `node:fs/path/os`、不调 shell | 成立，保留 | 与宿主无关，无额外风险 |
| 工具返回 Markdown、绝不返回 SKILL.md 正文 | 成立，保留 | `ctx.skill.list()` 会返回 `content`，实现时只取 name/description/路径，不要回显 content |

## 发现规则修正（原计划 §3.1 需要改的地方）

V2 实际的 skill 来源（源码级）：

1. 对**每个配置目录**扫描 `<dir>/skill` **和** `<dir>/skills` —— 单数 `skill/` 也算。
2. 配置文档里的 `skills.paths`：支持 `~/` 展开，相对路径按当前会话目录解析。
3. 配置文档里的 `skills.urls`：http/https 远端目录，读该目录的 `index.json`，下载到 `<cache>/skills/<hash>/<name>/`。所以 catalog 来源的「路径」是**本地缓存目录**，不是 URL。
4. compatibility 目录：`~/.claude/skills`、`~/.agents/skills`（`opencode.config.compatibility`）。
5. 扫描 glob 是 `{*.md,**/SKILL.md}`：`<root>/foo.md` 和 `<root>/foo/SKILL.md` 都是合法布局。
6. id 派生：`<root>/foo.md` → `foo`；`<root>/foo/SKILL.md` → `foo`；`<root>/a/b/SKILL.md` → `b`。再经宿主 ID 归一。
7. 同名冲突：后加载者覆盖（`Map.set(id, skill)`），来源顺序即覆盖优先级。
8. frontmatter 除 `name` / `description` / `metadata` 外还有 `disable-model-invocation`（等价 `metadata["opencode/autoinvoke"] = false`）。这是官方「不自动注入、但仍可显式加载」的开关 —— 与本工具的 permission 方案是两条不同路径，本工具**只报告、不代改**。

## 本轮未验证、必须由实现 preflight 收口的三项

1. `~/.config/opencode/plugins/*.js` 是否被自动加载（不通过就走配置 `plugins` 绝对路径）。
2. `editor.add({ input })` 是否接受原生 JSON Schema 对象。
3. 写 `permissions` 后是否热生效，或需新会话/重启。

（`ctx.skill.list()`、`ctx.agent.list()` 的返回形状已从 SDK 类型确认；`skill.list` 单项为 `{name, description?, location, content}`，**没有 id**，id 需按上面第 6 条从 `location` 反推。）
