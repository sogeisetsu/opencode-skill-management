# `skill_management` 工具规范（v3 · 最可行版本）

> 状态：待实现（plan 阶段产出）
> 基线：本机 **OpenCode v2.0.32**
> 证据：结论取自本机 2.0.32 的二进制内嵌源码、`@opencode-ai/plugin` / `@opencode-ai/sdk` 类型定义与 `https://opencode.ai/config.json`，出处内联在各节。本文只保留**有证据**的写法；三处未证实项集中在 §9 preflight，先测后写。
> 文末 §10 是相对上一版设计稿的改动清单。

---

## Steps

- [ ] preflight 三项未证实前提（plugins 目录自动加载 / `input` schema 形式 / 写规则后是否热生效）
- [ ] 实现只读动作：`list` + `inspect`
- [ ] 实现写动作：`disable` + `enable`（备份 · dryRun · 回读校验 · 回滚 · sidecar）
- [ ] 按 §7 跑验收：新会话端到端 + Windows/Linux 各一遍

---

## 0. 定位与边界

一个 tool，四个动作：`list` / `inspect` / `disable` / `enable`。

- 唯一写操作是**在全局配置里增删一条 skill permission 规则**。
- 不装、不删、不移动、不改动任何 skill 文件（含 SKILL.md frontmatter）。
- 不动配置里非本工具写入的内容。

---

## 1. 载体

V2 没有「工具文件」形态；工具必须由插件注册。载体为**本地插件**：

```
<config>/plugins/skill_management.js        # <config> 见 §4.1
```

模块形状（V2，已实证）：

```js
export default {
  id: "skill_management",
  async setup(ctx) {
    await ctx.tool.transform((editor) =>
      editor.add({
        name: "skill_management",
        options: { codemode: false },        // 必加：进原生工具表，可按名字直接调用
        description: /* §5 */,
        input: /* §2 的 JSON Schema */,
        async execute(raw, toolCtx) {
          return { content: /* Markdown 文本 */ }
        },
      }),
    )
    return () => {}                            // setup 可返回 dispose
  },
}
```

要点（全部有实证）：

- **写 `.js`，不要写 `.ts`。** `ctx.tool` 未出现在已发布的 V2 类型定义里（`@opencode-ai/plugin/dist/v2/promise/context.d.ts` 只有 agent/catalog/command/integration/plugin/reference/skill），写成依赖这些类型的 `.ts` 会被类型检查直接挡住。用纯 ESM `.js`。
- `options: { codemode: false }` 必需 —— 内置 `skill` 工具就是 `options:{codemode:!1}`。
- 文件名与工具名无关，工具名唯一来源是 `editor.add({ name })`。
- 纯 Node 内置模块（`node:fs` / `node:path` / `node:os`），**不引入任何第三方依赖**，不调用 shell。

**备选载体**（若 preflight 发现 plugins 目录不自动加载）：在本机配置文件里加一条绝对路径，宿主同样按 `local` 插件加载（已实证）：

```jsonc
{ "plugins": ["C:\\Users\\suyue\\.config\\opencode\\plugins"] }
```

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
      "description": "list = 列出所有 skill 及有效状态；inspect = 查单个 skill 详情与不可用原因；disable = 停用；enable = 恢复"
    },
    "name": {
      "type": "string",
      "description": "skill id。inspect / disable / enable 必填"
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

返回值：Markdown 文本（表格 + 一行结论）。不返回 JSON 包装，**不返回 skill 正文**（`ctx.skill.list()` 会带 `content`，只取 name/description/路径，永不回显）。

> `scope` 不作为入参：V2 的 skill 注册表已涵盖全部来源，scope 只作为输出列出现。

---

## 3. 动作规格

### 3.1 `list`

数据源：`ctx.skill.list()`（宿主注册表，**不自己扫盘**）。单项形状为 `{ name, description?, location, content }`，**没有 id**，需从 `location` 反推（§3.5）。

每行输出：

| 字段 | 说明 |
|---|---|
| `id` | 由 `location` 反推（§3.5） |
| `source` | `config` / `project` / `claude` / `agents` / `catalog` / `embedded` / `plugin`，按 `location` 前缀归类 |
| `scope` | `user`（家目录下）或 `project`（当前目录树内） |
| `state` | `available` / `disabled` / `ask`（§3.6 求值） |
| `path` | `location`；catalog 来源显示**本地缓存目录**（不是 URL） |

- 只输出 `name` / `description`（首行、截断）/ `path`，绝不输出 SKILL.md 正文。
- 末尾附统计：发现 N 个、已禁用 M 个、`ask` K 个。
- 一致性：若 sidecar（§4.3）记录了某条规则而配置里已不存在，输出一行 `⚠️ sidecar 与配置不一致` 提示，不自动重放。

来源归类规则：

- `<config>/skill`、`<config>/skills` → `config`
- 当前项目树下的 `<dir>/skill`、`<dir>/skills` → `project`
- `~/.claude/skills` → `claude`；`~/.agents/skills` → `agents`
- `<cache>/skills/<hash>/...` → `catalog`（远端 `skills.urls` 拉下来的缓存）
- 由其它插件 `ctx.skill.transform` 注入、`location` 不落在任何已知根下 → `plugin`

### 3.2 `inspect`

单个 skill 的完整诊断：

- 命中的 `location`、来源层、scope、id 反推过程。
- frontmatter 只读字段：`name` / `description` / `disable-model-invocation`（等价 `metadata["opencode/autoinvoke"] = false`）。**只报告，不代改**。
- **有效判定结论**：按 §3.6 求值，明确指出「被哪一层、哪一条规则、判定为什么」。
- agent 级差异：遍历 `ctx.agent.list()`，标出哪些 agent 的 `permissions` 对该 id 给出与默认不同的结果（如 deny）。
- 若该 id 被更宽的规则（如 `resource: "internal-*"`）覆盖为 deny，明确指出是那条规则生效、无需新增。
- 一句话结论：为什么它当前不可用（或可用）。

### 3.3 `disable`

1. 求值该 id 的当前状态；已是 `deny` → 直接返回「已经是停用状态」，不重复写。
2. 若已被更宽规则覆盖为 deny → 提示「已被 `<规则>` 覆盖，无需新增」。
3. 目标写入：全局配置的 `permissions` 数组末尾追加

   ```jsonc
   { "action": "skill", "resource": "<id>", "effect": "deny" }
   ```

4. `dryRun` 时只打印将插入的片段并结束。
5. 写前备份目标文件；写后回读校验该 id 现在解析为 `deny`；校验失败 → 回滚到备份并报错，不留半成品。
6. 成功后写 sidecar。

### 3.4 `enable`

1. 依 sidecar 精确定位**本工具写入的**、针对该 id 的规则并删除。
2. 该 id 的 deny 规则不是本工具写的（sidecar 无记录）→ **拒绝执行**并说明原因，不擅自删用户的规则。
3. 删完若规则集为空，把空块一并清理干净。
4. 同样的备份 + `dryRun` + 回读校验 + 失败回滚。

### 3.5 id 反推（实证规则）

```
<root>/foo.md            → foo
<root>/foo/SKILL.md      → foo
<root>/a/b/SKILL.md      → b      # 取 SKILL.md 所在目录名
```

反推后再与注册表 `name` 比对：若 frontmatter `name` 与反推 id 不同，两个都显示（`id` 才是 `disable` 要用的参数）。

### 3.6 有效状态求值（实证）

```
rules = [...agent.permissions, ...sessionPermissions]          // 顺序即优先级
hit   = rules.findLast(r => glob("skill", r.action) && glob(id, r.resource))
state = hit?.effect ?? "allow"                                  // 默认首条是 {*, *, allow}
```

- `deny` → 从模型可见 skill 列表隐藏 **且** 加载被拒（`skill` 工具执行前 `permission.assert({action:"skill", resources:[id]})`）。
- `ask` → 仍在列表里，加载时弹确认。
- glob 只支持 `*`（零或多字符）与 `?`（单字符）。

**不要自己解析 JSONC 去合并全局/项目/agent 三层**：V2 启动时已把配置文档里的 `permissions` 追加进**每个** agent 的 `permissions` 数组，`ctx.agent.list()` 读到的就是最终规则集。

> 「隐藏但不自动进上下文、仍可显式加载」不是 permission 的语义（常见误判），而是 frontmatter 的 `disable-model-invocation` / `metadata["opencode/autoinvoke"]`。本工具不碰 frontmatter。

---

## 4. 配置写入规约

### 4.1 目标文件

按宿主自身规则解析，不写死路径：

1. `<config>` = `$XDG_CONFIG_HOME/opencode`，未设置时回退 `~/.config/opencode`（用 `os.homedir()`，不把 `~` / `%USERPROFILE%` 当路径用）。
2. 候选文件按序：`<config>/opencode.jsonc` → `<config>/opencode.json` → `~/.config/opencode/opencode.jsonc` → `~/.config/opencode/opencode.json`；取第一个已存在的；都不存在则新建 `<config>/opencode.jsonc`。
3. 系统级配置（Windows `%ProgramData%\opencode`、macOS `/Library/Application Support/opencode`、Linux `/etc/opencode`）需要管理员权限，不碰。

> ⚠️ 实测：设了 `XDG_CONFIG_HOME` 后 `opencode debug paths` 的 `config` 会跟着变，但 `opencode debug config` 仍列出 `~/.config/opencode/opencode.jsonc` —— 说明两个目录都可能被当配置文档加载。因此写入前**先用候选顺序确定目标文件，写完回读校验**；如果本机两个文件同时存在且都含 `permissions`，写 `~/.config/opencode/opencode.jsonc` 并在输出里说明。

### 4.2 形状与写法

- 写 V2 原生形状：顶层 `permissions: [{ action, resource, effect }]`（配置 schema 中 `permission` 单数对象式已标记 deprecated）。
- 目标键不存在 → 顶层追加整块；已存在 → 在其数组末尾插入条目。
- 文件是 JSONC（含注释）：用**最小文本编辑**插入/删除，保留注释、缩进、键顺序。**禁止** parse → 对象 → 序列化 → 回写。
- 只操作 `permissions` 数组里属于本工具的条目。

### 4.3 sidecar 状态文件

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

用途：`enable` 的精确定位 —— 区分「本工具写入的规则」与「用户手写的规则」。状态判定本身始终以实际读到的规则集为准，sidecar 只作辅助。

> 备选：V2 插件自带 `ctx.storage`（`get/set/remove/scan`），可省掉自己管文件。选文件是因为它可审计、可手工修复、与插件生命周期解耦；若实现时发现文件方案别扭，可换成 `ctx.storage`。

### 4.4 写入一致性

- 写前记录目标文件哈希；写完若实际内容与预期不符（并发改写）→ 停止并报告，不静默重试。
- 写后回读校验：确认该 id 现在解析为预期效果；不符则回滚到备份。
- `list` 若发现 sidecar 有记录而配置里已无对应规则，附一行提示（不自动重放）。

### 4.5 跨平台

- 家目录一律 `os.homedir()`；路径一律 `path.join` / `path.resolve`，禁止手写分隔符；比较用规范化后的绝对路径。
- 读入时探测换行风格（CRLF/LF）并在写入时保持；新建文件用 LF。
- 读入时剥离 BOM，写入不加；解析 JSONC 前统一去 BOM。
- 先备份再原文件覆盖，不依赖「重命名原子替换」这类跨平台行为不一致的操作。
- Linux 上路径与 skill id 区分大小写，一律精确匹配，不做大小写不敏感归一。

---

## 5. 工具 description（给模型看的那段）

> List, inspect, enable or disable installed OpenCode skills. `list` shows every registered skill with its effective state (available / disabled / ask). `disable` hides a skill from the model and rejects loading it by adding one permission rule to the global config — it never touches skill files. `enable` removes that rule. Use when the user asks which skills are installed, why one is not available, or wants one turned off or on.

语义必须写清楚（避免模型误用）：

- `deny` = 从模型可见列表隐藏 **且** 拒绝 `skill` 工具加载（粒度 = skill id）。
- 想要「仍在列表里、加载时确认」→ 用 `effect: "ask"`；本工具的 `disable` 固定写 `deny`。
- agent 级 `agents.<id>.permissions` 与 `policies` 可覆盖/移除 skill；本工具**只报告**，不代改。
- 生效时机：配置目录受 watch，理论上热加载；由新会话验证，若需要重启会明确告知。

---

## 6. 不做（硬边界）

- 不安装 / 下载 / 卸载 skill；不删除、不移动、不改写任何 skill 文件。
- 不改 SKILL.md frontmatter（`disable-model-invocation` / `autoinvoke` 只在 `inspect` 里报告）。
- 不写 `policies` / `experimental.policies`（`integration.use` + `skill:<id>` 会把 skill 从注册表整体移除，比 deny 更硬；只报告不代写）。
- 不动全局配置以外的配置；不写系统级配置；不动任何非 OpenCode 的文件。
- 不猜测：任何状态结论必须来自实际读到的注册表或规则集；取不到就写「未验证」。

---

## 7. 验收

1. **载体实证**：最小插件放入 `<config>/plugins/` 后，新会话中按名字**直接**调用 `skill_management({ action: "list" })` 成功。（不通过 → 切换 §1 备选载体，记录结论。）
2. **schema 实证**：`editor.add({ input })` 接受手写 JSON Schema；否则退回 `@opencode-ai/plugin` 的 `tool.schema`（宿主已装，不属新依赖）。
3. `list` 输出覆盖本机全局 skill 与内置/插件注入 skill，并正确标出来源与路径。
4. `{ action: "disable", name: "grill-me" }` → **新会话**该 skill 从模型可见列表消失、`skill` 工具加载被拒、`list` 显示 `disabled`；`enable` 后完全还原；`opencode.jsonc` 前后只差这一条规则。
5. `dryRun: true` 不产生任何文件改动（前后哈希一致）。
6. 一致性：手动删掉配置里那条规则后，`list` 以实际规则集为准正确显示该 skill 已恢复可用，并给出一行 sidecar 不一致提示。
7. 热加载：若改动无需重启即生效，在输出里注明；否则明确告知需重启/新会话。

---

## 8. 实现步骤

1. preflight（§9 三项，先测后写；不通过就走备选路径并在文档里更新结论）。
2. 只读动作：`list` + `inspect`（`ctx.skill.list()` + `ctx.agent.list()` 求值）。
3. 写动作：`disable` / `enable`（备份、`dryRun`、最小文本编辑、回读校验、回滚、sidecar）。
4. 按 §7 跑完整验收，含新会话端到端与 Windows/Linux 各一遍。

---

## 9. Preflight（三项未证实，先测后写）

| 项 | 预期 | 不通过时的退路 |
|---|---|---|
| `<config>/plugins/*.js` 是否被自动加载 | 是（官方文档如此，但本机未隔离验证成功） | 在本机配置里加 `"plugins": ["<绝对路径>"]`（已实证可行） |
| `editor.add({ input })` 是否接受原生 JSON Schema 对象 | 是 | 用 `@opencode-ai/plugin` 的 `tool.schema`（zod）派生 |
| 写 `permissions` 后是否热生效 | 是 | 输出里明确「需新会话/重启生效」 |

已有可用的只读核查命令（本机）：

```pwsh
opencode debug paths          # 家目录/config/data/cache/state 的实际解析结果
opencode debug config         # 列出全部配置文档及其解析后内容
opencode plugin list          # 列出已加载插件及 source（local / package）
```

---

## 10. 本版改动（相对上一版设计稿）

**保留**：四动作、`disable` 走 permission `deny`、硬边界「不装不删不移动」、工具名 `skill_management`、JSONC 最小编辑、备份 + dryRun + 回读校验 + sidecar、`options:{codemode:false}`。

**修正**：

1. 载体文件名沿用 `plugins/skill_management.js`，但**明确不能用 TS 写**（`ctx.tool` 不在已发布 V2 类型里）。
2. skill 枚举从「自己扫盘」改为 `ctx.skill.list()` 注册表；发现规则补全为 `<dir>/skill` **与** `<dir>/skills`、glob `{*.md,**/SKILL.md}`、catalog 落在 `<cache>/skills/<hash>/`。
3. 状态求值从「自己合并三层配置」改为读 `ctx.agent.list()` 的最终 `permissions`，并按 win 规则 `findLast(glob(action) && glob(resource))` 复算，缺省 `allow`。
4. 删掉「`ask` = 藏起来但仍可显式加载」的误述；`ask` 仍在列表里，只是加载时确认；真正的「不自动进上下文」是 frontmatter 的 `disable-model-invocation`（只报告）。
5. 接口去掉 `scope` 入参（注册表已覆盖全部来源）。
6. 补上两条「只报告不代写」的旁路机制：agent 级 `agents.<id>.permissions`、`policies` / `experimental.policies` 的 `integration.use`。
7. 补上实测提醒：`XDG_CONFIG_HOME` 与 `~/.config/opencode` 两个配置目录都可能被加载，写前定目标、写后回读。
8. 未证实的三项集中到 §9 preflight，不再散落在假设表里。
