# Preflight 结果（OpenCode 2.0.32 本机实测）

> 环境：本机 **OpenCode v2.0.32**（`opencode --version`）
> 二进制（内嵌源码，`rg -a` 可抽）：`C:\Users\suyue\AppData\Local\Programs\@openchamberelectron\resources\opencode-cli\opencode.exe`
> 复核方式：任何一条升级后都必须重跑本文列出的命令重新判定，不要沿用旧结论。

---

## (a) `<config>/plugins/*.js` 是否被自动加载

**结论：通过。**

实证：

```pwsh
opencode plugin list --builtin
# ID                  VERSION  SOURCE
# skill_management    local    C:\Users\suyue\.config\opencode\plugins\skill_management.js
```

- 插件文件放在 `<config>/plugins/skill_management.js` 即被宿主发现并加载，**无需**在配置里登记。
- 宿主源码逐字：`var ih=["plugin","plugins"]` —— 目录名 **`plugin` 与 `plugins` 两种拼写都会扫**；命中条件是 `.ts`/`.js` 文件**或目录**。
  → 推论（重要）：**不能把辅助代码拆成同目录下的第二个 `.js` 文件**，它会被当作插件加载而校验失败。所以 `skill_management.js` 必须是单文件。
- 模块形状由宿主显式校验（2.0.32）：
  - server 端接受两支：`{ id, effect(fn) }` 或 `{ id, setup(fn) }`，失败文案 `Plugin must export a default definition with an id and an effect or setup function.`
  - TUI 端只认 `{ id, setup(fn) }`，失败文案 `Invalid V2 TUI plugin module: <target>`

失败退路（未触发，已备）：把插件的**绝对路径或目录**写进全局配置的 `plugins` 数组（宿主 `plugin` / `plugins` 两个键都读）。本机现成例子见 `C:\Users\suyue\.config\openchamber\opencode.managed.json`。

---

## (b) `editor.add({ input })` 是否接受原生 JSON Schema

**结论：通过。**

三条独立证据：

1. **宿主自己的内置 MCP 桥**就是这么传的（二进制内嵌源码）：
   `add({ name: O.name, options:{…}, description, input: O.inputSchema ?? {type:"object",properties:{}}, output: O.outputSchema ?? {} })`
   —— `inputSchema` 是 MCP 协议里的 JSON Schema。
2. **本机另一个能跑的本地插件**（`opencode-agent-tool`）用纯手写 JSON Schema：
   `input: { type:"object", properties:{…}, required:["action"], additionalProperties:true }`
3. **本插件注册后实测可调用**（见 §7(1) 证据）：`run --standalone` 里 `skill_management` 按名字被直接调用并返回结果。

失败退路（未触发，已备）：改用 `@opencode-ai/plugin` 的 `tool.schema`（zod）派生。
⚠️ 但注意该包在本机是 **1.18.18**，与宿主 2.0.32 已漂移（其 `v2/promise/context.d.ts` 甚至没有 `ctx.tool` 域），所以退路本身也有风险；宁可用原生 JSON Schema。

---

## (c) 写 `permissions` 后是否热生效

**结论：通过 —— 是热生效的（不需要重启）。**

实测（本机真实全局配置，全程有备份，最终逐字节还原）：

| 步骤 | 结果 |
|---|---|
| `disable grill-me` 写入规则 | ✅ 回读校验通过（`ctx.agent.reload()` + `ctx.agent.list()`，轮询 3 次） |
| **未重启**运行中的 service → `opencode debug agents` | 13/13 个 agent 的规则集里都出现了 `{"action":"skill","resource":"grill-me","effect":"deny"}` |
| 新会话调用 `skill {id:"grill-me"}` | `status=error`，`{"error":{"type":"permission.rejected","message":"Permission denied: skill"}}` |
| 对照：同一会话调用 `skill {id:"windows-shell"}`（未停用） | `status=completed`，正常返回 `<skill_content name="windows-shell">` |
| `grill-me` 是否还在模型可见的 `<skill>` 列表里 | **不在**（模型报告 No，列表里只有另一个 skill `grilling`） |
| `enable grill-me` | ✅ 删除规则 + 清理空块 + 回读校验通过；配置**逐字节**回到写入前 |
| `debug config` | 目标文件 `C:\Users\suyue\.config\opencode\opencode.jsonc` 确实在"已加载文档"列表里 |

### 关键教训：重载是**异步**的，必须轮询

`ctx.agent.reload()` 会在配置文件被宿主重新读入**之前**就返回。实现初期只调一次 reload 就立刻读，得到的是旧规则集，于是 `disable` 误判为"校验失败"并回滚（真实踩到过一次）。现在的做法是**每 200ms 轮询、最多 6s**，并可用环境变量 `SKILL_MGMT_VERIFY_TIMEOUT_MS` 覆盖（验收脚本用它构造"超时→回滚"的用例）。

### 关键教训：全局规则 vs agent 规则的顺序**不是恒定的**

实测写入后，本机 13 个 agent 里有 12 个把全局规则排在规则集**最后**（`last=true`，因此生效）；`fast-responder` 却排在 index 4（后面还有 16 条自己的规则）。所以：

- 回读校验的判据必须是**调用者 agent 是否达到期望效果**，而不是"所有 agent 都达到"。
- 若有 agent 用自己的后续规则覆盖了全局规则，应当**报告**而不是判失败（实现里会输出一行 `ℹ️ 另有 N 个 agent 结果不同…`）。

### 关键教训：`ask` 的回读校验不能判「不是 deny」（1.0.0 修）

两条宿主事实叠在一起会让「不是 deny」恒真：

1. **无任何规则命中时宿主回退 `ask`**（`stateOf` 复制了这条语义）；
2. agent 自有规则可能排在**全局规则之后**，把刚写入的 `ask` 覆盖成 `allow`。

于是「宿主根本没读进这条规则」时，调用者仍然是 `ask`（规则 1）或 `allow`（规则 2）—— 两者都不是 `deny`，旧判据直接报「✅ 已写入并校验通过」，甚至把 `actual=allow` 打印出来。

现在的判据与 `enable` 同源：**调用者规则集里该 `{skill, id, ask}` 三元组的条数增加**（`countExactRules` 的 `beforeCount → afterCount`）。`deny` 仍用「调用者求值为 deny」（已证有效）。若条数增加但实际效果不是 `ask`（规则 2），输出会写明「实际效果是 allow」。

回归用例：`tools/verify.mjs` 的 N1（`staleAgents + effect:"ask"`，改前 4 项全红）与 N3（规则写入成功但被 agent 自有 allow 覆盖）。

### 观察到的拒绝形态（与规范原文不同）

规范原先写"加载失败信息为 `Unable to load skill <id>`"。实测拒载时得到的是**权限拒绝**：

```json
{"error":{"type":"permission.rejected","message":"Permission denied: skill"}}
```

`Unable to load skill <id>` 只在**该 id 根本不存在**时出现（宿主源码里是先 `get(id)`、后 `assert`）。两者要区分开。

### 退路（未触发，已备）

若将来某版本变成"不热生效"：在工具输出里明确"需新会话/重启生效"，并同步进规范 §5 的工具 description。

---

## 附带发现（实现期间从宿主实测得到，规范 v4 未涵盖）

### 1. `ctx.skill.list()` / `ctx.agent.list()` 返回的是**信封**，不是数组

```js
await ctx.skill.list()   // { location: { directory: "..." }, data: [ … ] }
await ctx.agent.list()   // { location: { directory: "..." }, data: [ … ] }
```

拿**真正的注册表数组**要用 `transform` 的 draft：

```js
let skills
const reg = await ctx.skill.transform((draft) => { skills = draft.list() })   // → 数组
await reg.dispose()                                                            // 用完释放注册
```

实测形状：

| 域 | draft.list() 返回 | 项字段 |
|---|---|---|
| `ctx.skill` | 数组（本机 29 项） | `{ id, name, description?, autoinvoke?, path, content }` |
| `ctx.agent` | 数组（本机 13 项） | `{ id, name, request, mode, hidden, permissions, description?, system? }` |

> 这解释了实现初期那个报错 `The "path" property must be of type string, got object`：信封对象的 `location` 是 `{directory}` 对象，被误当成 skill 的路径传进了 `path.resolve`。
> 本插件两者都支持：优先 `transform`，失败再退回读 `list()` 的 `.data`（并已 dispose 注册，不留 hook）。

### 2. 调用者 agent 很关键，不能"看所有 agent"

本机 13 个 agent 的规则集差异极大：

- `build` / `plan` / `compaction` / `fast-responder`：`{*,*,allow}` → 对任何 skill 都是 allow
- `title` / `summary`：`{*,*,deny}`（全 deny，内部 agent）
- `explorer` / `librarian` / `oracle` / `designer`：`{action:"skill", resource:"*", effect:"deny"}`
- `orchestrator`：`{action:"skill", resource:"*", effect:"allow"}`

**教训**：判断"是否已被更宽的规则覆盖为 deny"必须只看**调用者自己**的规则集。实现初期因为遍历了所有 agent，撞上 `title` 的全 deny，导致对 `build`/`orchestrator` 的 `disable` 被错误拒绝（0 写入）。这条已写进验收脚本作为回归测试。

### 3. `options.codemode:false` 的副作用

`codemode:false` 让工具进**原生工具表**（与内置 `skill`/`read`/`edit` 一致），但因此它**不在 Code Mode 里**：模型若在 `execute` 里用 `search()` 或 `tools.<name>` 去找，会得出"工具不存在"的错误结论（本轮真的观察到一次：模型跳过直接调用、在 Code Mode 里探测后放弃）。

- 现状：按规范 §1 取 `codemode:false`（与内置工具一致，模型可直接按名字调用 —— 已实测成功）。
- 若实际使用中模型频繁误判，候选改动是把 `options.codemode` 改为 `true`（代价：受 Code Mode 目录大小限制，本机另一个大型插件的注释记录了"工具因目录截断而从目录里掉出去"的经历）。

### 4. 两个已知的输出形态陷阱

- **不声明 `output` 就绝不能返回 `output` 字段**：宿主会报 `Tool result declared output without an output schema`。本插件只返回 `{ content }`。
- 工具执行期上下文是 `{ …ctx, signal, progress(cb) }`，**没有 `directory`/`worktree`**（活样板注释原文："OpenCode 2 no longer hands a tool its session directory"）。

### 5. v5 实现变更（2026-10-19）

- **`enable` 判据放宽**：先看同行标记注释（文件内自证），再看 sidecar 记录，两者都没有才拒绝。回读校验的判据改为「调用者规则集里该三元组的条数确实减少」，因此删完仍被更宽规则压成 `deny` 时**不判失败**，而是照常报告实际效果与挡路规则。
- **写入原子化**：同目录 `<file>.tmp` → `fs.renameSync` 覆盖（Windows / Linux 均由 Node 的 `rename` 提供替换语义）；备份滚动只保留 **1 份**。
- 以上均由 `tools/verify.mjs` 的 G 段断言覆盖（167 项全绿）。
- **真实宿主新进程回归（2026-10-20）**：`disable grill-me` → 新进程 `skill {id:"grill-me"}` 返回 `permission.rejected`；`enable grill-me` → `定位方式：标记注释命中（文件内自证）`，报告「被删规则的来源：本工具写入」与「删除后的生效效果：orchestrator = allow」，并列出 8 个自有规则覆盖结果的 agent；配置**逐字节还原**（`7D16F8A3…` / 15014 bytes）。

### 6. npm 包（只带包根）的运行时加载 —— 已证实（2026-10-19）

```pwsh
opencode plugin add opencode-skill-management@0.1.0-rc.0
# Plugin "opencode-skill-management@0.1.0-rc.0" installed and added to ...\opencode.jsonc

opencode plugin list
# skill_management   0.1.0-rc.0   opencode-skill-management@0.1.0-rc.0
```

新进程 `opencode run --standalone` 里直接调用 `skill_management({action:"list"})` → `status=completed`。
`package.json` 只有 `exports["."]`、**没有** `./server`，因此 §1.1 的退路（补 `./server`）**不需要**。
`plugin check` 正常列出；`plugin remove` 正常移除（会在文件末尾多留一个换行，还原配置时要去掉）。

> 宿主 2.0.32 的 CLI 小坑：`opencode plugin update <target>` 即使配置里的 spec 完全一致也会报 `Plugin is not configured: <target>`（target 带版本时直接抛栈）；不带 target 的 `opencode plugin update` 正常（`No plugin updates available`）。这是宿主行为，与本插件无关。

**git spec 同样已实测（2026-10-20）**：

```pwsh
opencode plugin add github:sogeisetsu/opencode-skill-management
# Plugin "github:sogeisetsu/opencode-skill-management" installed and added to ...\opencode.jsonc
opencode plugin list
# skill_management   9cb02f7   github:sogeisetsu/opencode-skill-management
```

新进程 `run --standalone` 调用 `skill_management` 成功；`plugin remove github:sogeisetsu/opencode-skill-management` 正常，配置逐字节还原。

---

## Linux 真实宿主核验（WSL2 · Debian 13.5 · 2026-10-20）

> 环境：WSL2 `Debian 13.5`（x86_64、glibc）、宿主 `opencode v2.0.32`（`@opencode/cli-linux-x64@2.0.32`，与 Windows 侧同版本）、`node v22.23.3`。
> 隔离方式：全部装在临时 `$HOME/.skmgmt-verify`，用临时 `HOME` + 四个 `XDG_*` 指向该目录，跑完 `rm -rf`；跑前跑后都确认过真实 `~/.config/opencode`、`~/.local/share/opencode`、`~/.cache/opencode`、`~/.local/state/opencode` 不存在（零残留）。全程无 `sudo`、无 `apt`。**不要用 `/tmp` 做隔离目录**，原因见本节末尾。

### (d) 逻辑层在 Linux 上是否同样通过 —— 通过（已证实）

```bash
node tools/verify.mjs
# 全部通过：167 项
```

与 CI 的 `ubuntu-latest` job 同源同结果（harness 全程 `mkdtemp` 临时 `<config>`，不读真实配置）。

### (e) 插件在 Linux 宿主里是否被加载 —— 加载成功，但 `plugin list` 默认看不见（已证实）

```bash
opencode plugin list
# No plugins found

opencode plugin list --builtin
# …
# skill_management   local   /home/suyue/.skmgmt-verify/home/.config/opencode/plugins/skill_management.js
```

- 本地目录插件**只出现在 `--builtin` 的输出里**；不带该 flag 时是 `No plugins found`，很容易被误判成"没装上"。所有核查一律带 `--builtin`。
- `debug paths` 确认 data / config / cache / state / log / db 全部落在临时 `HOME` 下。

### (f) Linux 上的 disable → 拒载 → enable 全链路 —— 通过（已证实）

新进程 `opencode run --standalone --auto --format json`（消息是位置参数；`run` 会读 stdin，**脚本里必须 `< /dev/null`**，否则管道里剩下的脚本会被当成用户输入，实测出现过模型顺着脚本文本自己去跑 shell）。

| 步骤 | 结果 |
|---|---|
| `skill_management {action:"disable", id:"probe"}` | ✅ 写入 `{ "action": "skill", "resource": "probe", "effect": "deny" } // skill_management`，并生成 `skill_management.state.json` |
| 模型可见的 skill 列表里是否还有 `probe` | **没有**（模型答：no） |
| 新进程调用 `skill {id:"probe"}` | `status=error`，`Permission denied: skill` |
| `skill_management {action:"enable", id:"probe"}` | ✅ `定位方式：标记注释命中（文件内自证）`；「被删规则的来源：本工具写入」；「删除后的生效效果：build = allow」；`ℹ️ 另有 3 个 agent 结果不同：explore / title / summary = deny`；变空的 `permissions` 块一并清理 |
| 再次调用 `skill {id:"probe"}` | `status=completed`，返回 `<skill_content name="probe">` |

**待复核**：本次 `--format json` 的 `tool_use` 事件里错误形如 `{"status":"error","error":"Permission denied: skill"}`，没有出现 §(c) 记录的 `{"error":{"type":"permission.rejected",…}}` 外层结构。文案与宿主版本都和 Windows 侧一致，差异多半来自 `--format json` 事件的裁剪，但**不要据此改写 §(c) 的结论**，升级时一并复核。

### 环境坑（与插件无关，但会误导核验）

- **`/tmp` 在 `wsl.exe` 两次调用之间不保留**：写入的探针文件下次调用即消失，而 `uptime` 仍然连续（不是 VM 重启）。临时隔离目录放 `$HOME` 下、结束时删除，别指望 `/tmp`。
- WSL 的 `PATH` 里有 `/mnt/c/.../npm`，`opencode` 会解析到 **Windows 的 v1**；Linux 核验必须用绝对路径调用 Linux 版二进制。
- Debian 13.5 minimal 只有 `script` / `sudo`：没有 `xz`（Node 官方 `.tar.xz` 解不开，改用 `.tar.gz`）、没有 `git` / `python3` / `tmux` / `expect`。
- **冷启动的临时 `HOME` 里，前两次 `plugin list --builtin` 会返回 `No plugins found`，第三次才列出全部（含 `skill_management`）**。重试即可，别据此判定"插件没加载"。
- **`opencode --version` 也会在 `$HOME` 下建目录**（`~/.config/opencode`、`~/.local/share/opencode/log/opencode.log`）。所以隔离必须在**第一次调用 opencode 之前**就切好 `HOME`/`XDG_*`；否则"没写真实家目录"的检查在干净机器上必然报错（1.0.0 验收时实测踩到，`tools/linux-verify.sh` 已把 `export HOME=…` 提前到第 0 步）。以上五条都已固化进 `tools/linux-verify.sh`。

**固化后的复跑方式（已证实）**：

```bash
bash tools/linux-verify.sh        # 自带 Node + opencode 安装、临时 HOME、跑完自清；全程无 sudo
# == 3) 全部通过：248 项
# == 4) skill_management  local  …/plugins/skill_management.js
# == 5) 真实家目录与跑前一致
```

---

## 7. 工具 `output` schema：声明、校验与 content 回退（1.1.0，已证实）

宿主 2.0.32 的工具运行时（从 `opencode.exe` 的内联代码读到，并用下面两条真实调用复验）：

```js
// 注册：input 与 output 都按 JSON Schema 转成内部 schema
{ type: "tool", name, description, inputSchema: Wu(e.input),
  ...(e.output === void 0 ? {} : { outputSchema: Ku(e.output) }) }

// 执行：声明了 output 就必须返回它；没声明就不能返回
if (e.output === void 0) {
  if ("output" in a) fail("Tool result declared output without an output schema")
  return { content: On(a.content) }
}
if (!("output" in a)) fail("Tool did not return its declared output")
const output = Ju(e.output, a.output)          // 按 output schema 校验
return { output, content: On(a.content, output) }

// On(content, output)：content 是字符串就用它；否则回退到 JSON.stringify(output)
```

结论：

- `output` 与 `input` 一样是原生 JSON Schema。声明后，**每一条**返回路径（包括错误）都必须带
  `output`，否则整次调用变成宿主错误而不是工具结果 —— 这正是 1.1.0 把错误也改成
  `{ ok:false, error:{code,message} }` 的原因。
- 不返回 `content` 时宿主会把 `content` 设为 `JSON.stringify(output)`（单行）。插件显式返回缩进
  2 空格的 JSON 作为 `content`，与 `output` 是同一份数据（E 段有断言）。
- schema 只声明跨动作的契约（`schemaVersion` / `action` / `ok` / `warnings` / `error.code`），
  不用 `oneOf` / `$ref` / `nullable`：宿主的 JSON Schema 转换对深嵌套形态没有实测过，而校验
  失败会让调用直接失败。动作字段在文档站与 README 里定义。

真实宿主复验（本机 2.0.32，`--standalone` 新进程，读真实注册表，零写入）：

```pwsh
opencode run --standalone --auto --format json '调用原生工具 skill_management，参数 action 为 list。不要使用 execute / Code Mode 工具，直接按名字调用。'
# tool_use status=completed
# output/content 均以 {"schemaVersion":1,"action":"list","ok":true,... 开头，可 JSON.parse
# 本机 33 个 skill，警告行：另有 33 个 skill 在其它 agent 下状态不同

opencode run --standalone --auto --format json '调用原生工具 skill_management，参数 action 为 inspect、id 为 definitely-not-a-skill。…'
# tool_use status=completed
# {"schemaVersion":1,"action":"inspect","ok":false,"error":{"code":"skill_not_found",…}}
```

第二条尤其关键：**错误分支也通过了 output 校验**，没有被宿主的 schema 校验拦下。
