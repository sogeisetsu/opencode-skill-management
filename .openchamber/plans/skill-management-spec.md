# `skill_management` 工具规范（v4 · 基于 2.0.32 源码实证）

> 状态：待实现（plan 阶段产出）
> 基准宿主：本机 **OpenCode v2.0.32**（`opencode --version` 实跑）
> **真源规则（硬性）**：一切接口结论以 **(a) 宿主二进制内嵌源码** 与 **(b) 实跑 `opencode debug *`** 为唯一真源。
> `<config>/node_modules/@opencode-ai/*` 下的类型定义**只作参考，不得作为结论依据** —— 本机装的是 `@opencode-ai/plugin@1.18.18` / `@opencode-ai/sdk@1.18.18`，与宿主 2.0.32 已漂移（§1.3 有三处实证）。
> 复核方式：结论旁内联标注出处与 **已证实 / 待实测**；宿主升级后按 §9 重新核对，不沿用旧结论。
> 文末 §10 是相对上一版（v3）的改动清单。

---

## Steps

- [ ] preflight 两项：写 `permissions` 是否热生效；`opencode plugin add <git spec>` 是否收下本包（§9）
- [ ] 实现只读动作：`list` + `inspect`
- [ ] 实现写动作：`disable` + `enable`（标记注释 · 备份 · dryRun · 回读校验 · 回滚 · sidecar 审计）
- [ ] 按 §7 跑脚本化验收（本机 Windows + Linux 各一遍）

---

## 0. 定位与边界

一个 tool，四个动作：`list` / `inspect` / `disable` / `enable`。

- 唯一写操作是**在全局配置里增删一条 skill permission 规则**。
- 不装、不删、不移动、不改动任何 skill 文件（含 SKILL.md frontmatter）。
- 不动配置里非本工具写入的内容。
- `effect` 只写 `deny` 与 `ask`。**不写 `allow`**（见 §3.3）。
- 作用域**只做全局**：不写项目级配置，不装到项目级 `.opencode/plugins/`。（`list` 仍会列出注册表里所有来源的 skill —— 这是"读"，不是"写"。）

---

## 1. 载体

### 1.1 形态

仓库发布为 **npm 包**；V2 加载的入口是 **`{ id, setup(ctx) }`**，另带一个**不含逻辑的极薄 `server` 壳**，只为满足 `opencode plugin add` 的入口校验。

真实范本（本机已装的发布包，`oh-my-opencode-slim@3.0.4`）：

```jsonc
// package.json
"main": "dist/index.js",
"exports": {
  ".":        { "import": "./dist/index.js" },          // v1 入口
  "./server": { "import": "./dist/server/index.js" },    // v2 server 入口
  "./tui":    { "import": "./dist/tui2.js" }             // v2 tui 入口
}
```

宿主解析入口的方式（已证实）：`kE(manifest)` 用 `Bun.resolveSync` 依次解析 **`<pkg>/server`、`<pkg>`（即 `"."`）、`<pkg>/tui`、`<pkg>/rpc`**，因此**走的是 `exports` 映射**（解析失败的白名单里含 `ERR_PACKAGE_PATH_NOT_EXPORTED`），而不是硬编码文件名。`opencode plugin add` 只要求 `server` **或** `tui` 存在，其中 `server` 存在即按 server 插件收下并写进全局配置。
```js
// 它的 v2 server 入口末尾（已证实）：一个 default export 同时带两种入口
var src_default = { id: "oh-my-opencode-slim", server: OhMyOpenCodeLite, setup: createV2Setup() };
export { ..., src_default as default };
```

本机另一个**本地插件**活样板（`C:\Users\suyue\.config\openchamber\agent-tool\openchamber-agent-tool\index.js`，它的 `openchamber` 工具当前可用）：

```js
export default {
  id: "openchamber-agent-tool",
  setup: async (ctx) => {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: "openchamber",
        description: "...",
        options: { codemode: true },
        input: { type: "object", properties: { /* 原生 JSON Schema */ }, required: ["action"], additionalProperties: true },
        async execute(input, context) { return { content, metadata } },
      })
    })
  },
}
```

本工具对应骨架：

```js
// index.js —— 纯 ESM，Node 内置模块 + 宿主 ctx。不引入第三方依赖（zod 仅在需要时按需，见 §2.4）
export default {
  id: "skill_management",
  async setup(ctx) {
    await ctx.tool.transform((tools) =>
      tools.add({
        name: "skill_management",
        options: { codemode: false },        // 与所有内置原生工具一致；待 §7 第 1 项确认
        description: /* §5 */,
        input: /* §2 的原生 JSON Schema 对象 */,
        async execute(input, context) {
          return { content: /* Markdown 文本 */ }   // 不声明 output，就绝不返回 output 字段（§2.5）
        },
      }),
    )
    return () => {}                          // setup 返回 cleanup（§1.4）
  },
}
```

### 1.2 发现路径（已证实）

`PluginSourceDirectory.discover` 逐字读的是：

```js
var ih = ["plugin", "plugins"];
// 对每个根 a：readDirectoryEntries(join(a,"plugin")) 与 join(a,"plugins")
// 命中条件：`${target}.ts` 或 `.js` 的文件，以及目录
```

插件目录集合由 `YB()` 计算：`<config>/plugins`（`<config>/plugin` 同样命中）加上配置链上每个根 `.opencode/plugins`。

- **本工具只依赖 `<config>/plugins`（含 `plugin` 拼写）**。项目级路径不在范围内（§0）。
- **配置键也是双拼写**（已证实）：`NH(e.plugin, _M, ["plugin"], …)` 与 `NH(e.plugins, rde, ["plugins"], …)` 都读，合并进同一个 `plugins` 列表；`opencode plugin add` 只写复数 `plugins`。
- 本机现状：`C:\Users\suyue\.config\opencode\plugins\` **存在但为空**。
- 兜底安装（已证实可用）：全局配置里用绝对路径引用。本机实例在 `C:\Users\suyue\.config\openchamber\opencode.managed.json`：
  `"plugins": ["-opencode.browser", "C:\\Users\\suyue\\.config\\openchamber\\agent-tool\\openchamber-agent-tool"]`
- ⚠️ 本地路径插件**只能靠配置直写**：`opencode plugin add` 的 spec 门禁会拒绝一切 `file:` 与相对路径（见 §9）。

### 1.3 ⚠️ 类型漂移（三处实证；这是"不 import 已发布类型"的真正理由）

`<config>/node_modules/@opencode-ai/*` 是 **1.18.18**，宿主是 **2.0.32**：

| 已发布类型（1.18.18） | 宿主实际（2.0.32 二进制） |
|---|---|
| `v2/promise/context.d.ts` 的 `PluginContext` **没有 `tool` 域** | `ctx.tool = { list, transform, reload, hook }` 确实存在（内置工具全靠它注册） |
| `SkillDraft = { source(source), list(): SkillV2Source[] }` | draft 是 `{ list, get, add, update, remove }`，项是解析后的 skill，不是 source |
| `ToolContext = { sessionID, messageID, agent, directory, worktree, abort, metadata(), ask() }` | 执行期上下文是 `{ ...ctx, signal, progress(cb) }`；无 `directory`/`worktree`（活样板注释原文：*"OpenCode 2 no longer hands a tool its session directory"*） |
| `sdk` 的 `SkillV2Info = { name, description?, slash?, location, content }` | 路由 `GET /api/skill` 的 success schema 是 `Skill.Info = { id, name, description?, autoinvoke?, path, content }` |

**写法结论**：用 `.js`（纯 ESM），或写 TS 但**自带 V2 类型**（或依赖 `@opencode/plugin@2.x`，见下）。**不要从 `@opencode-ai/plugin` 的 v2 子路径取类型**——那会让类型检查和运行时不一致。

`oh-my-opencode-slim@3.0.4` 的做法可直接借鉴：它的 `devDependencies` 里有 **`@opencode/plugin: 2.0.18`**（注意不是 `@opencode-ai/plugin`），并且它另外手写了 `./v2/types` 供自己的 `.d.ts` 使用。**待实测**：`@opencode/plugin@2.0.18` 是否就是宿主 2.0.32 配套的 V2 类型包（本机未装，需 npm 查证）。

### 1.4 其它已证实要点

- 插件模块形状由宿主**显式校验**，且 **server 端与 TUI 端接受的形状不同**（已证实）：
  - **server 端**（本工具所在侧）接受两支：`{ id, effect(fn) }` **或** `{ id, setup(fn) }`。
    逐字：`RC=o({default:P([o({id:t,effect:Po((e)=>typeof e==="function")}),o({id:t,setup:Po((e)=>typeof e==="function")})])})`；
    失败文案：`"Plugin must export a default definition with an id and an effect or setup function."`。
  - **TUI 端**只认 `setup`：`iDt(t) = typeof t==="object" && "id" in t && typeof t.id==="string" && t.id.length>0 && "setup" in t && typeof t.setup==="function"`，失败文案 `Invalid V2 TUI plugin module: <target>`。
  - 两种都要求 `export default …`（宿主检查模块上的 `default` 键）。
- `setup` 返回 cleanup：发布范本的 `.d.ts` 写的是 `setup: (ctx: V2Context) => Promise<V2Cleanup>`。
- 文件名与工具名无关，工具名唯一来源是 `add({ name })`。
- 运行时依赖：Node 内置模块（`node:fs` / `node:path` / `node:os`）；不调用 shell。

---

## 2. 接口

单一工具，入参（**原生 JSON Schema**，已证实被接受 —— 内置 MCP 桥就是 `input: O.inputSchema ?? {type:"object",properties:{}}`）：

```jsonc
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "oneOf": [
        { "const": "list",    "description": "列出所有已注册 skill 及其有效状态" },
        { "const": "inspect", "description": "查单个 skill 的详情与不可用原因；需要 id" },
        { "const": "disable", "description": "停用；需要 id" },
        { "const": "enable",  "description": "恢复本工具此前停用的 skill；需要 id" }
      ],
      "description": "要执行的动作"
    },
    "id": {
      "type": "string",
      "description": "skill id。inspect / disable / enable 必填。为避免模型混淆，也接受 name 作为别名"
    },
    "effect": {
      "type": "string",
      "enum": ["deny", "ask"],
      "description": "disable 写入的效果，默认 deny。ask = 仍在列表里、加载时确认"
    },
    "dryRun": {
      "type": "boolean",
      "default": false,
      "description": "写操作只预览将要做的改动，不落盘"
    }
  },
  "required": ["action"],
  "additionalProperties": true
}
```

### 2.1 为什么 `additionalProperties: true`（**已证实，与 v3 相反**）

本机活样板的注释原文：

> *"Models routinely put the inputs next to the action instead of inside the parameters object, and dropping them there produced a `url is required` error for a call that plainly carried a url. Both shapes are accepted; an explicit parameters object wins on a conflict."*

它的 schema 用 `additionalProperties: true`，并在 `execute` 里把平铺字段合并回参数对象。规范照做：`execute` 先 `{ ...平铺字段, ...(parameters ?? {}) }`，显式对象优先。

### 2.2 为什么动作用 `oneOf:[{const, description}]` 而非 `enum`

活样板用 `oneOf` + 每项 `const`/`description`，使**每个动作的说明直接进 schema 给模型看**（`enum` 只能给候选值，不能带说明）。照做。

### 2.3 `id` 与 `name`

宿主里 skill 标识一律叫 **`id`**（内置 `skill` 工具的入参就是 `{ id }`，其 schema 描述为 *"The ID of an available skill…"*）。

- `id` 是主键；`disable`/`enable`/`inspect` 以它为准。
- `name` 作**别名**：先从注册表按 `id` 精确匹配；未命中再按 `name` 精确匹配；命中多个 → 报候选列表，**不猜**。
- `name` 与 `id` 可以不同（宿主规则：`name = frontmatter.name ?? id`），输出里两个都显示。

### 2.4 依赖

不引入第三方依赖。若实现期确需 schema 校验，只能用宿主已装的东西（`<config>/node_modules/zod` 存在），且**先说明再引入**。

### 2.5 返回值形状（**已证实，易踩**）

活样板注释原文：

> *"No output schema is declared, so a result must never carry an output field: OpenCode rejects that with `Tool result declared output without an output schema`. The envelope travels as text content."*

即：

- **不声明 `output`** → 只返回 `{ content, metadata? }`，**绝不能带 `output`**。
- 若确实要结构化返回，则必须同时声明 `output` schema 并返回 `output` 字段。

本工具取前者：Markdown 文本装在 `content`。工具执行期上下文用 `context.progress(...)` 上报进度（宿主把 `progress` 注入 `execute` 的第二参数：`s.execute(e, {...a, signal, progress})`，已证实）。

---

## 3. 动作规格

### 3.1 `list`

数据源：`ctx.skill.list()`（宿主注册表，**不自己扫盘**）。

项形状（**已证实**，与 v3 不同）：宿主 `Skill.Info` schema 为

```js
eF = o({ id: kp, name: Jb, description: t.pipe(y), autoinvoke: k.pipe(y), path: Ce, content: t })
```

即 **`{ id, name, description?, autoinvoke?, path, content }`** —— `id`/`name`/`path`/`content` 必有，`description`/`autoinvoke` 可选。路由 `GET /api/skill` 的 handler 直接返回它：`e.handle("skill.list", () => ht(XI.use((a) => a.list())))`。

> ⚠️ **实测修正（2.0.32，实现期发现）**：`ctx.skill.list()` / `ctx.agent.list()` 返回的是**信封**，**不是数组**：
> ```js
> await ctx.skill.list()   // { location: { directory }, data: [ … ] }
> await ctx.agent.list()   // { location: { directory }, data: [ … ] }
> ```
> 拿到真正的注册表数组要用 `transform` 的 draft：
> ```js
> let skills
> const reg = await ctx.skill.transform((draft) => { skills = draft.list() })  // → 数组（本机 29 项）
> await reg.dispose()                                                          // 用完释放注册，不留 hook
> ```
> `ctx.agent.transform((d) => d.list())` 同理（本机 13 项，项含 `permissions`）。
> 插件要**两者都支持**：优先 `transform`，失败时退回读 `list()` 的 `.data`。
> 若误把信封当项，`location`（`{directory}` 对象）会被当作路径 → 宿主抛 `The "path" property must be of type string, got object`。详见 `docs/preflight.md`。

> ⚠️ **不要用 `location`**：`location` 只出现在**旧的** `@opencode-ai/sdk` 类型里（§1.3）。真实字段是 **`path`**。

每行输出：

| 字段 | 说明 |
|---|---|
| `id` | 直接用宿主给的 `id`。**不需要反推**（§3.5） |
| `name` | 与 `id` 不同时并列显示 |
| `autoinvoke` | `false` = 不会自动进上下文（frontmatter 控制，本工具只报告） |
| `source` | `config` / `project` / `claude` / `agents` / `catalog` / `embedded` / `plugin`，按 **`path`** 前缀归类 |
| `scope` | `user`（家目录下）或 `project`（当前目录树内） |
| `state` | `available` / `disabled` / `ask`（§3.6 求值） |
| `path` | 宿主给的 `path`；catalog 来源显示**本地缓存目录**（不是 URL） |

- 只输出 `id` / `name` / `description`（首行、截断）/ `path`，**绝不输出 `content`**（`ctx.skill.list()` 会带正文，取字段时显式丢弃）。
- 末尾附统计：发现 N 个、已禁用 M 个、`ask` K 个。
- 一致性：若 sidecar（§4.3）记录了某条规则而配置里已不存在，输出一行 `⚠️ sidecar 与配置不一致` 提示，不自动重放。

来源归类规则（按 `path`）：

- `<config>/skill`、`<config>/skills` → `config`
- 当前项目树下的 `<dir>/skill`、`<dir>/skills` → `project`
- `~/.claude/skills` → `claude`；`~/.agents/skills` → `agents`
- `<cache>/skills/<hash>/...` → `catalog`（远端 `skills.urls` 拉下来的缓存）
- `path` 为 `/builtin/...` 或以 `embedded` source 注入 → `embedded`（宿主的 OpenCode/Report 技能就是 `path: "/builtin/opencode.md"`）
- 由其它插件注入、`path` 不落在任何已知根下 → `plugin`

发现根（**已证实**，与 v3 一致）：每个配置项下 `<dir>/skill` 与 `<dir>/skills`；`~/.claude` 与 `~/.agents` 各加 `/skills`；`skills.paths`；`skills.urls` → `<cache>/skills/<hash>`。compat 层用 `scan("{*.md,**/SKILL.md}")` 扫 `~/.claude/skills` 与 `~/.agents/skills`。

### 3.2 `inspect`

单个 skill 的完整诊断：

- 命中的 `path`、来源层、scope、`id`。
- frontmatter 只读字段：`name` / `description` / `disable-model-invocation`（等价 `metadata["opencode/autoinvoke"] = false`）。宿主解析出的 `autoinvoke` 已在注册表项里，直接报告。**只报告，不代改**。
- **有效判定结论**：按 §3.6 求值，明确指出「被哪一层、哪一条规则、判定为什么」。
- agent 级差异：遍历 `ctx.agent.list()`（**已证实存在**：`ctx.agent = { get, list, transform, reload }`），标出哪些 agent 的 `permissions` 对该 id 给出与默认不同的结果。
  ⚠️ **必须只看"调用者自己"的规则集**（调用者来自工具执行上下文的 `context.agent`）。本机 13 个 agent 里 `title`/`summary` 是 `{*,*,deny}`、`explorer` 等是 `{action:"skill",resource:"*",effect:"deny"}`，若遍历所有 agent 去找"更宽的 deny"，会把内部 agent 的全 deny 误判成"调用者已被覆盖"，从而**错误地拒绝**本可执行的 `disable`（实现期已踩，验收脚本里有回归测试）。
- 若该 id 被更宽的规则（如 `resource: "*"`）覆盖为 deny，明确指出是那条规则生效、无需新增。
- 可用 `opencode debug agents` 的输出做对照（同为本机真源，见 §7）。
- 一句话结论：为什么它当前不可用（或可用）。

### 3.3 `disable`

1. 求值该 id 的当前状态；已是 `deny` → 直接返回「已经是停用状态」，不重复写。
2. 若已被更宽规则覆盖为 deny → 提示「已被 `<规则>` 覆盖，无需新增」。
3. 目标写入：全局配置的 `permissions` 数组末尾追加，并**带一条本工具标记注释**（§4.3）：

   ```jsonc
   // skill_management
   { "action": "skill", "resource": "<id>", "effect": "deny" }
   ```
   规则形状取自官方 schema（`opencode.ai/config.json`）：顶层 `permissions` = `Permission.Ruleset`，`Permission.Rule = { action, resource, effect }`，三者**必填**、`additionalProperties: false`；顶层 `permission`（单数）已 `deprecated: true`。

4. `effect` 参数：默认 `deny`；传 `ask` 时写 `"effect": "ask"`（软停用：仍在模型可见列表里，加载时确认）。**不接受 `allow`** —— 追加在数组末尾的 `allow` 会遮蔽更宽的 `deny`，越出本工具「只增删自己那一条」的边界。
5. `dryRun` 时只打印将插入的片段与目标文件路径并结束。
6. 写前备份目标文件；写后调 **`ctx.agent.reload()`**（已证实存在：`agent = { …, reload }`）再读 `ctx.agent.list()` 做**进程内回读校验**；校验失败 → 回滚到备份并报错，不留半成品。
7. 成功后写 sidecar（审计，§4.3）。

### 3.4 `enable`

1. **前置条件：sidecar 里必须有该 id 的记录**，否则一律拒绝执行（fail-closed）。在此前提下按序定位：

   a. sidecar 有记录 **且** 命中本工具标记注释 → 精确删除那一条（标记的作用是在该 id 可能存在多条同类规则时，指出"本工具写的是哪一条"）。
   b. sidecar 有记录，但标记被外部写者剥掉 → 若配置里存在**恰好一条**完全相同的三元组，删除并**告警**；找不到唯一匹配则拒绝（不猜）。
   c. sidecar 无记录 → **拒绝执行**，即使规则带本工具的标记注释也一样拒绝（标记可能是巧合或被人抄过去的）。输出该 id 相关规则的原文，让用户自己确认处理。
2. 删完若 `permissions` 数组为空，把空块一并清理干净。
3. 同样的备份 + `dryRun` + `agent.reload()` 回读校验 + 失败回滚。

### 3.5 `id` 与 `name` 的来源（实证）

**宿主已经给出 `id`，本工具不做反推。** 只有当注册表项**没有 `id`** 时才按下面的规则从路径字段反推（此时 `inspect` 会明确写出"由路径反推"+ 规则输入；`list` 会在统计行下面补一句"其中 N 个 id 由路径反推"）。可由 `path` 或 `location`（字符串）反推 —— 信封对象里那个 `location` 是 `{directory}`，不是字符串，绝不当路径用。

```
<root>/foo.md            → foo
<root>/foo/SKILL.md      → foo
<root>/a/b/SKILL.md      → b        # 取 SKILL.md 所在目录名
```

宿主源码逐字（`opencode.config.skill` 插件内）：

```js
let s = zl.dirname(a) === e && zl.basename(a) !== "SKILL.md"
      ? zl.basename(a, ".md")
      : zl.basename(zl.dirname(a));
// name = frontmatter.name ?? s
return { _tag:"Parsed", skill:{ id: ob.make(s), name: J9.make(h.name ?? s), ..., path: Ce.make(a), content: r.content } }
```

若 `inspect` 发现 frontmatter `name` 与 `id` 不同，两个都显示（`id` 才是 `disable`/`enable` 要用的参数）。

### 3.6 有效状态求值（**已证实**）

```
rules = [...agent.permissions, ...sessionPermissions]          // 顺序即优先级
hit   = rules.findLast(r => glob("skill", r.action) && glob(id, r.resource))
state = hit?.effect ?? "ask"                                    // ⚠️ 无命中时宿主回退 ask，不是 allow
```

求值器逐字（宿主源码）：

```js
function j8(e, r, ...i) { … findLast((s) => ab(e, s.action) && ab(r, s.resource)) ?? { action: e, resource: "*", effect: "ask" } }
```

直接证据（宿主源码）：

```js
// 模型可见 skill 列表的过滤
vE = (e, r) => e.filter((i) => j8("skill", i.id, r).effect !== "deny")
// 内置 skill 工具的权限断言
yield* r.assert({ action: Iw /* "skill" */, resources: [_.id], save: [_.id], ... })
```

- `deny` → 从模型可见 skill 列表隐藏 **且** 加载被拒。
  实测（2.0.32）拒载时返回的是**权限拒绝**：`{"error":{"type":"permission.rejected","message":"Permission denied: skill"}}`；而 `Unable to load skill <id>` 只在**该 id 根本不存在**时出现（宿主源码里先 `get(id)` 后 `assert`）。两者要区分。
- `ask` → 仍在列表里，加载时弹确认。
- 回退值是 `ask` 而非 `allow`：**只有当整个规则集里没有任何规则命中该 (action, resource) 时**才会走到 `ask`。
- 而实际 agent 规则集的**首条**是 `{ "action": "*", "resource": "*", "effect": "allow" }`（`opencode debug agents` 实跑输出可见），所以常见路径下未命中会命中这条 → 结果为 `allow`。两者不矛盾，实现时按上面的 `findLast` + `?? "ask"` 复算即可。
- 断言接口用的是**复数** `resources`（`assert({action:"skill", resources:[id], save:[id]})`），而规则匹配用的是**单数** `resource`。别混。
- glob 只支持 `*`（零或多字符）与 `?`（单字符）。

**不要自己解析 JSONC 去合并全局/项目/agent 三层**：宿主归一化时已经是

```js
let Re = [...xx(e.tools, r), ...Px(e.permission, r), ...NH(e.permissions, fZ, ["permissions"], r, Tt)];
```

（`tools` → 旧的 `permission` → `permissions` 数组，数组在最后 = 优先级最高），`ctx.agent.list()` 读到的就是最终规则集。

> 「隐藏但不自动进上下文、仍可显式加载」不是 permission 的语义，而是 frontmatter 的 `disable-model-invocation` / `metadata["opencode/autoinvoke"]`（注册表项里的 `autoinvoke` 字段）。本工具不碰 frontmatter。

---

## 4. 配置写入规约

### 4.1 目标文件

**先定规则，再由 §7 的脚本用 `debug config` 硬断言。**

已证实的解析链：

1. `<config>` = `$XDG_CONFIG_HOME/opencode`，未设置时回退 `~/.config/opencode`。
   逐字：`y = process.env.XDG_CONFIG_HOME || (n ? path.join(n, ".config") : void 0)`，`config = join(y, "opencode")`，`n = os.homedir()`。
2. 全局配置文档的候选与选取，宿主里有**两套不一致的规则**——本工具按 `Config.update` 那套（它是宿主的"改配置"路径，与我们的行为最同构）：
   - `Config.update`：`["opencode.json","opencode.jsonc"]` → 取**最后一个已存在**的；都不存在则建 `<config>/opencode.jsonc`。
     逐字：`rs=["opencode.json","opencode.jsonc"]`，`ot=(yield* rm(qe, r.isFile)).at(-1) ?? join(we,"opencode.jsonc")`。
   - `opencode plugin add` / `mcp add`（`eP()`）：`[opencode.json, opencode.jsonc, .opencode/opencode.json, .opencode/opencode.jsonc]` → 取**第一个已存在**的；都不存在则 `opencode.json`。
3. **禁止写托管文档。** 本机 `opencode debug config` 实跑显示实际加载的文档不止一个：

   ```
   "path": "C:\\Users\\suyue\\.config\\opencode\\opencode.jsonc",
   "path": "C:\\Users\\suyue\\.config\\openchamber\\opencode.managed.json",
   ```

   `opencode.managed.json` 由 OpenChamber 托管、题注为 managed；**永远不写它**。系统级配置（Windows `%ProgramData%\opencode`、macOS `/Library/Application Support/opencode`、Linux `/etc/opencode`）也不碰。

> ⚠️ **限定：以下只对 server 端成立。** server 端插件 ctx（`Z`）里**没有 `config` 域、也没有 `client`** —— 域清单为 `app, location, options, agent, aisdk, command, credential, event, experimental, generate, model, provider, integration, mcp, permission, plugin, reference, rpc, skill, storage, tool, vcs, websearch, worktree, session, shell`（已证实）。
> （对照：**TUI 端**插件 ctx 是另一个对象，**确实有 `client`**，但它的 `storage` 是 `store/memory`、且没有 `agent`/`skill`/`tool` 域。本工具在 server 端，不受此影响。）
>
> 因此插件本体无法直接读"宿主实际加载了哪些文档"。落实方式：**"以 `debug config` 实测为准"放在验收脚本层**（§7 硬断言"我们写的文件在已加载文档列表里"）；插件本体按第 2 条选目标，并**把目标路径打进输出**，供人/脚本核对。
> 若脚本断言失败 → 判定为环境不符，停止并报告，不静默继续。

### 4.2 形状与写法

- 写 V2 原生形状：顶层 `permissions: [{ action, resource, effect }]`（官方 schema：三者必填、`additionalProperties:false`）。
- 目标键不存在 → 顶层追加整块；已存在 → 在其数组末尾插入条目。
- 文件是 JSONC（含注释）：用**最小文本编辑**插入/删除，保留注释、缩进、键顺序。**禁止** parse → 对象 → 序列化 → 回写。
  **宿主自己就是这么做的**（已证实，三条路径全是文本编辑）：
  ```js
  // plugin add / mcp add
  let i = ym(r, bm(r, ["plugins"], [...t ?? [], n], { formattingOptions: { tabSize: 2, insertSpaces: !0 } }));
  // Config.update
  let T = ym(Ne, bm(Ne, ["shell"], xe.shell ?? void 0, { formattingOptions: { tabSize: 2, insertSpaces: !0 } }));
  ```
  → 写盘保留 `bm`/`ym` 这类"构造编辑 + 应用编辑"的思路，能天然保住注释。
- 落盘用 `tmp` + `rename` 是**宿主的做法**（`let s = e + ".tmp"; await k(s, i…); …rename`）。本工具可采用同样方式，但**必须先备份原文件**，并在失败时回滚。
- 只操作 `permissions` 数组里属于本工具的条目。

> 补充实证：宿主**并非处处**用文本编辑 —— `cli.json` 的旧 `tui.json`+`kv.json` 迁移用的是 `JSON.stringify` 回写，另有多处 `JSON.stringify({$schema:…}, null, 2)` 仅作为"文件不存在时的初始内容"。但**全局 opencode 配置**的四条写路径（`plugin add` / `plugin remove` / `mcp add` / `Config.update`）**全部**是 `bm`/`ym` 文本编辑，本工具只关心这条。

### 4.3 归属标记与 sidecar

**机制：JSONC 标记注释（唯一真源）。**

```jsonc
"permissions": [
  { "action": "shell", "resource": "*", "effect": "allow" },
  // skill_management
  { "action": "skill", "resource": "grill-me", "effect": "deny" }
]
```

为什么可行（**已证实**）：宿主所有写配置的路径都是 `bm`/`ym` 文本编辑，**不丢注释**；JSONC 数组允许注释，`ZA(r, l, { allowTrailingComma: true })` 解析时容忍。

**sidecar 降级为审计日志 + 次选定位**，不再作为状态真源：

```
<config>/skill_management.state.json
```

```jsonc
{
  "version": 1,
  "rules": [
    { "id": "grill-me", "effect": "deny", "file": "...opencode.jsonc", "insertedAt": "2026-10-18T..." }
  ]
}
```

用途只剩两件：`list` 的一致性提示（§3.1），以及 `enable` 的次选定位（§3.4 步骤 1b）。**状态判定始终以实际读到的规则集为准**（§3.6）。

> 备选：V2 插件有 `ctx.storage`（**已证实**：`{ get, set, remove, scan }`）。不用它是因为 sidecar 可审计、可手工修复、与插件生命周期解耦。

### 4.4 写入一致性

- 写前记录目标文件哈希；写完若实际内容与预期不符（并发改写）→ 停止并报告，不静默重试。
- 写后 `ctx.agent.reload()` + 回读校验：确认该 id 现在解析为预期效果；不符则回滚到备份。
- `list` 若发现 sidecar 有记录而配置里已无对应规则，附一行提示（不自动重放）。

### 4.5 跨平台

发布到 npm，所以要跨平台。

- 家目录一律 `os.homedir()`；路径一律 `path.join` / `path.resolve`，禁止手写分隔符；比较用规范化后的绝对路径。
- 读入时探测换行风格（CRLF/LF）并在写入时保持；新建文件用 LF。
- 读入时剥离 BOM，写入不加；解析 JSONC 前统一去 BOM。
- Linux 上路径与 skill id 区分大小写，一律精确匹配，不做大小写不敏感归一。
- Windows 路径反斜杠在 JSONC 里要正确转义（同机宿主自己写的就是 `C:\\Users\\...` 形式）。

---

## 5. 工具 description（给模型看的那段）

> List, inspect, enable or disable installed OpenCode skills. `list` shows every registered skill with its effective state (available / disabled / ask). `disable` hides a skill from the model and rejects loading it by adding one permission rule to the **global** config — it never touches skill files. `enable` removes the rule this tool added. Use when the user asks which skills are installed, why one is not available, or wants one turned off or on.

语义必须写清楚（避免模型误用）：

- `deny` = 从模型可见列表隐藏 **且** 拒绝 `skill` 工具加载（粒度 = skill id）。
- `ask` = 仍在列表里、加载时确认；`disable` 默认写 `deny`，可通过 `effect` 显式选 `ask`。
- agent 级 `agents.<id>.permissions` 与 `policies` 可覆盖/移除 skill；本工具**只报告**，不代改。
- `enable` 只删**本工具写入的**那一条；用户手写的规则一律不动。
- 生效时机：写后本工具会主动调 `ctx.agent.reload()` 并在进程内复核；但**其它**正在运行会话的可见列表何时刷新仍需实测（§9 第 1 项），必要时会明确告知需新会话。

---

## 6. 不做（硬边界）

- 不安装 / 下载 / 卸载 skill；不删除、不移动、不改写任何 skill 文件。
- 不改 SKILL.md frontmatter（`disable-model-invocation` / `autoinvoke` 只在 `inspect` 里报告）。
- 不写 `policies` / `experimental.policies`。`policies` 的 action 枚举只有 `provider.use` / `tool.use` / `integration.use`（已证实）；其中 integration policy 会把 skill 从注册表**整体摘掉**（`s.remove(A.id)`），比 deny 更硬 —— 只报告不代写。
- 不写项目级配置；不写系统级配置；**不写 `opencode.managed.json`**（托管文档）。
- 不写 `effect: "allow"`（§3.3 第 4 点）。
- 不动态注入 agent 级 `permissions`。注：技术上可行（`ctx.agent.transform` 的 draft 上 `update(id, fn)` 能改 `AgentV2Info.permissions`，且 `AgentV2Info.permissions` 就是 `PermissionV2Ruleset`），但那是**进程内、不落盘、随插件生命周期消失**的机制，与本工具「改全局配置、可审计」的定位冲突。**只记录，不实现。**
- 不猜测：任何状态结论必须来自实际读到的注册表或规则集；取不到就写「未验证」。

---

## 7. 验收（脚本化 · headless）

本机 CLI 已确认可脚本化：`opencode run [--standalone] [--format json] [--auto] [--prompt]`、`opencode api <operation|method path> [-d] [--param]`、`opencode plugin list|add|check|update|remove`、`opencode debug agents|config|paths`、`opencode reload`、`opencode session list|export`。

脚本放进本仓库（例如 `tools/verify.mjs` + `pnpm`/`node` 直跑），每项都要有**机器可判定的断言**：

1. **载体**：最小插件就位后（`<config>/plugins/` 或配置路径引用），`opencode plugin list` 出现本插件；`opencode run --format json --prompt 'call skill_management with action list'` 能按名字**直接**调用成功。→ 同时验证 `options:{codemode:false}` 的选择（若失败，改用活样板验证过的取值并记录）。
2. **schema**：`add({ input })` 接受手写原生 JSON Schema（已由内置 MCP 桥与本机活样板证实）；脚本断言"模型把参数平铺在 action 旁边"时仍能正确执行（§2.1）。
3. **`list` 覆盖**：输出覆盖本机全局 skill 与 builtin/plugin 注入 skill，来源与 `path` 正确；`id` 与宿主 `GET /api/skill` 返回的 `id` 集合一致（`opencode api skill.list`）。
4. **`disable` 硬断言**：`{ action:"disable", id:"<X>" }` 之后
   - `opencode debug agents` 里**每个** agent 的 `permissions` 末尾出现 `{"action":"skill","resource":"<X>","effect":"deny"}`（本机 `debug agents` 已确认会输出该数组）；
   - `opencode debug config` 显示的实际加载文档**包含**我们写的那个文件（§4.1 的目标文件规则）；
   - `opencode run --format json` 让模型加载 `<X>` → 输出出现 `Unable to load skill <X>`；
   - 目标文件 diff **只有**新增的那一行规则 + 标记注释，其余字节不变。
5. **`enable` 还原**：`enable` 后同一组断言反向成立；前后 diff 干净；`opencode.jsonc` 恢复原状。
6. **`ask`**：`{ action:"disable", id:"<X>", effect:"ask" }` → `debug agents` 里是 `"effect":"ask"`，且模型可见列表**仍包含** `<X>`（与 `deny` 的行为差异）。
7. **`dryRun: true`** 不产生任何文件改动（前后哈希一致）。
8. **归属**：手工把标记注释删掉后再 `enable` → 走 §3.4 步骤 1b，删除并告警；再把 sidecar 也删掉后 `enable` → **拒绝执行**并给出规则原文。
9. **一致性**：手动删掉配置里那条规则后，`list` 以实际规则集为准正确显示已恢复可用，并给出一行 sidecar 不一致提示。
10. **热加载**：写规则后**不重启**，另开一次 `opencode run --format json` 观察是否即时生效；结论写进输出（这是 §9 第 1 项）。
11. **安装路径**：`opencode plugin add <git spec>`（未发 npm 前用 Git spec 即可，spec 语法已证实支持 `github:`/`gitlab:`/`git+https://`/`git+ssh://` 等）→ 断言包被收下、写进全局配置 `plugins`、且 V2 下 `setup` 生效。**未实测，标为 preflight。**
12. **平台**：Windows 与 Linux 各跑一遍第 4–6 项。

---

## 8. 实现步骤

1. preflight（§9 两项，先测后写；不通过就走备选路径并在文档里更新结论）。
2. 只读动作：`list` + `inspect`（`ctx.skill.list()` + `ctx.agent.list()` 求值）。
3. 写动作：`disable` / `enable`（标记注释、备份、`dryRun`、最小文本编辑、`agent.reload()` 回读校验、回滚、sidecar 审计）。
4. 打包与发布：`package.json` 的 `exports`（`"."` 给 `{id, setup}`，另加薄 `server`）、README、npm 发布流程。
5. 按 §7 跑脚本化验收，含安装路径与两平台。

---

## 9. Preflight

实现期实测结果见 **`docs/preflight.md`**（含原始命令与证据片段）。当前状态：

| 项 | 状态 | 结论 / 退路 |
|---|---|---|
| `<config>/plugins/*.js` 是否被自动加载 | **已证实：是** | `opencode plugin list --builtin` 列出 `skill_management  local  <config>/plugins/skill_management.js`；且 `plugin` 与 `plugins` 两种拼写都扫。退路（未触发）：把绝对路径写进全局配置 `plugins` 数组 |
| `editor.add({ input })` 是否接受原生 JSON Schema | **已证实：是** | 三条独立证据：宿主内置 MCP 桥、本机另一个活插件、本插件注册后实测可调用。退路（未触发、且有风险）：zod `tool.schema` |
| 写 `permissions` 后是否热生效 | **已证实：是（无需重启）** | 未重启的运行中 service 在 `debug agents` 里立刻看到新规则（13/13 agent）；新会话里该 skill 从可见列表消失且加载被拒，同会话其它 skill 正常加载。**注意重载是异步的，回读必须轮询**；判据用"调用者 agent 达到期望"，不是"所有 agent"。退路（未触发）：明确告知「需新会话/重启」 |

`opencode plugin add <spec>` 这条留给发布阶段（**已证实**：`plugin add` 先安装、再检查入口；`file:`/相对路径会被拒；所以本包必须带 `server` 或 `tui` 入口 —— 这也是 §1.1 保留薄 `server` 壳的直接原因）。

已有可用的只读核查命令（本机）：

```pwsh
opencode debug paths          # home / data / cache / state / config 的实际解析结果
opencode debug config         # 列出实际加载的配置文档（含绝对路径）及解析结果
opencode debug agents         # 每个 agent 的最终 permissions 数组（硬断言面）
opencode plugin list --builtin  # 已加载插件与 source（local / package / builtin）
```

**实现期新发现的坑（已回写 §3.1 / §3.2，详见 `docs/preflight.md`）**：

- `ctx.skill.list()` / `ctx.agent.list()` 返回 `{ location, data }` **信封**，不是数组；注册表数组要用 `ctx.<domain>.transform(d => d.list())`（并 dispose 注册）。
- `options: { codemode: false }` 使工具进原生表，但**不在 Code Mode 目录里**：模型若在 `execute` 里用 `search()`/`tools.*` 去找，会误判「工具不存在」（已实际观察到一次）。
- 判断「是否被更宽的规则覆盖」必须只用**调用者自己**的规则集（`context.agent`）。

**升级复核**：宿主版本变化后，§1.3 的每一行与上表都要重新实测（类型漂移与 ctx 信封形状是本规范最容易失效的地方）。

---

## 10. 本版改动（v4 相对 v3）

**保留**：四动作、`disable` 走 permission 规则、硬边界「不装不删不移动」、工具名 `skill_management`、JSONC 最小编辑、备份 + dryRun + 回读校验、`setup` 返回 cleanup。

**修正（均由 2.0.32 实证推翻或收紧）**：

1. **§3.1 数据模型**：注册表项是 `{ id, name, description?, autoinvoke?, path, content }` —— **有 `id`**，字段是 **`path` 不是 `location`**。v3 的「没有 id」「location」两处均错。
2. **§3.5 整节降级**：宿主已直接给 `id`，反推规则只作解释与核对，不再是必需步骤。
3. **§2 接口**：`additionalProperties` 从 `false` 改为 **`true`**，并补「参数平铺」兼容（本机活样板的注释明确说 `false` 会拒掉模型的真实调用习惯）；动作枚举从 `enum` 改为 **`oneOf:[{const,description}]`**；主键 `name` → **`id`**（`name` 作别名）。
4. **§2.5 新增**：不声明 `output` 就绝不能返回 `output` 字段（活样板注释里的宿主报错原文）。
5. **§3.3 / §3.6 补 `ask`**：`effect` 可选 `deny`/`ask`；明确不提供 `allow` 并给出理由。§3.6 补上求值的直接证据（`vE` 过滤器 + `skill` 工具的 `assert({action:"skill", resources:[id]})`）。
6. **§4.3 归属机制换掉**：从「sidecar 为真源」改为 **JSONC 标记注释为真源**，sidecar 降级为审计 + 次选定位；`enable` 给出三级判定顺序与"拒绝执行"兜底。依据：宿主三条写配置路径全是保注释文本编辑（`bm`/`ym`）。
7. **§4.1 目标文件**：给出宿主两套不一致的候选规则（`Config.update` vs `eP`），本工具取 `Config.update` 那套；**新增「禁止写 `opencode.managed.json`」**（本机 `debug config` 实测存在第二个被加载的托管文档）；并明确"以 `debug config` 为准"落实在验收脚本层，因为插件 ctx 没有 `config` 域/`client`。
8. **§1 改写**：载体从"本地插件文件"改为**可发布 npm 包**，给出真实范本的 `exports` 约定（`"."` / `"./server"` / `"./tui"`）与「一个 default export 同时带 `{id,setup}` 和薄 `server`」；§1.2 补上发现路径的逐字证据（`ih=["plugin","plugins"]`）与「只做全局」的范围决定。
9. **§1.3 新增**：类型漂移表（"不能用 TS"的结论改为"必须自带 V2 类型 / 用 `@opencode/plugin@2.x`，不得用 `@opencode-ai/plugin` 的 v2 类型"），并把**真源规则**（二进制 + `debug *` 为唯一真源）写进文头作为硬性约定。
10. **§6 补一条**：agent 级 `permissions` 可被插件在 `setup` 里注入（技术上可行）但本工具不实现，并说明理由。
11. **§7 重写为脚本化验收**：11 项机器可判定断言，含 `debug agents` 硬断言、`debug config` 目标文件断言、`run --format json` 端到端"加载被拒"、`ask` 行为差异、归属三级判定、安装路径、两平台。
12. **§9 preflight 从 3 项缩到 2 项**：`editor.add({input})` 接受原生 JSON Schema 已被内置 MCP 桥与本机活样板双重证实，不再列为不确定项。
13. **§4.5 保留并补一条**：Windows 路径反斜杠在 JSONC 里的转义（宿主自己写的就是 `C:\\Users\\...`）。

**v4 定稿前的独立复核（对上述主张逐条重取证据，10/10 成立，另修正 5 处）**：

14. **§1.4 补正**：server 端模块 schema 接受 `{id, effect}` **或** `{id, setup}`（TUI 端只认 `setup`）；并补上失败文案与"必须有 `export default`"。
15. **§3.6 更正**：求值回退值是 **`ask` 而非 `allow`**（`j8` 的 `?? {…effect:"ask"}`）；同时保留"agent 规则集首条通常为 `{*,*,allow}`"的说明，两者不矛盾。另补 `resources`（复数，断言用）vs `resource`（单数，匹配用）。
16. **§4.1 限定**：`没有 client` 只对 **server 端** ctx 成立；TUI 端 ctx **有 `client`**（但 `storage` 是 `store/memory`、无 `agent`/`skill`/`tool`）。
17. **§1.1 / §1.2 补正**：入口解析走 `exports` 映射并依次尝试 `server`/`""`/`tui`/**`rpc`**；配置键同样有 `plugin`/`plugins` 双拼写；本地路径插件只能靠配置直写。
18. **§4.2 / §9 补正**：`plugin add` 是**先安装后校验入口**（不合规的包已被装进缓存才报错）；`cli.json` 迁移是宿主里唯一的 stringify 回写，但与本工具相关的四条全局配置写路径全是文本编辑。

**v4 实现期修正（写代码时在真实宿主上跑出来的，已回写 §3.1 / §3.2 / §9）**：

19. **§3.1 数据源更正（最重要）**：`ctx.skill.list()` / `ctx.agent.list()` 返回 **`{ location, data }` 信封，不是数组**；注册表数组必须走 `ctx.<domain>.transform(draft => draft.list())`，且用完要 `dispose()` 释放注册。误把信封当项会让 `location`（对象）被当作路径，宿主抛 `The "path" property must be of type string, got object`。实现里两者都支持（transform 优先，退回 `.data`）。
20. **§3.2 收紧**：`inspect`/`disable` 判断「是否被更宽的规则覆盖」**必须只用调用者自己的规则集**（来自执行上下文的 `context.agent`）。本机 13 个 agent 中 `title`/`summary` 是 `{*,*,deny}`、`explorer`/`librarian`/`oracle`/`designer`/`fixer`/`observer` 是 `{action:"skill",resource:"*",effect:"deny"}`；遍历所有 agent 会把它们误判成调用者被覆盖，从而**错误拒绝**本可执行的 `disable`（实现期真实踩到，验收脚本已加回归测试）。
21. **§3.1 输出列更正**：`state` 列取值按规范语义输出 **`available` / `disabled` / `ask`**（映射自求值结果的 `allow` / `deny` / `ask`），而不是直接输出原始 effect。
22. **§4.2 dryRun 预览收紧**：预览改为输出"实际将落盘的 新增/改动行区间"（公共前缀/后缀裁剪），不再手拼一段可能与真实写入不一致的片段。
23. **§9 preflight 收敛为 3 条状态表**：(a)(b)(c) **全部已证实通过**；`plugin add` 那条移到发布阶段。实现期新发现的四个坑（ctx 信封 / `codemode:false` 不在 Code Mode 目录里 / 调用者 agent 视角 / 重载是异步的）全部记入 `docs/preflight.md`。

**写真实全局配置的验收（用户确认后执行，已在本机跑完，配置逐字节还原）**：

24. **§9 (c) 热加载 = 是（无需重启）**：未重启的运行中 service 立刻看到新规则（`debug agents` 13/13）；新会话里 `grill-me` 从可见列表消失、`skill {id:"grill-me"}` 被 `permission.rejected` 拒绝，而同一会话 `skill {id:"windows-shell"}` 正常加载（对照实验）。`enable` 后配置**逐字节**回到写入前（`7D16F8A3…`，15014 bytes，无 `permissions` 键）。
25. **§3.3 回读校验更正**：`ctx.agent.reload()` 会在配置文件被重新读入**之前**返回 —— 必须**轮询**（实现取 200ms × 最多 6s，可用 `SKILL_MGMT_VERIFY_TIMEOUT_MS` 覆盖）。判据改为**调用者 agent 是否达到期望**；若有 agent 用自己的后续规则覆盖全局规则，**报告**而不判失败（实测本机 12/13 个 agent 把全局规则排在最后，`fast-responder` 排在 index 4）。
26. **§7(4)/(6) 通过**：`disable` 后配置与备份的差异**恰好**是 3 行权限块 + 上一行补的 1 个逗号；`enable` 逐字节还原；手工删掉配置里那条规则后，`list` 把该 skill 显示为 `available` 并输出 `⚠️ sidecar 与配置不一致`。修正：一致性判据必须是「**配置里已无对应规则**」，而不是早期的「id 不在注册表里」（后者会漏报 —— 实现期踩到并修）。
27. **§3.6 / §7 拒绝形态更正**：拒载返回 `{"error":{"type":"permission.rejected","message":"Permission denied: skill"}}`；`Unable to load skill <id>` 只在 id 不存在时出现。
