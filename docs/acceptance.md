# §7 验收记录（本机 OpenCode 2.0.32，真实宿主）

> 全部在本机真实环境执行。写真实全局配置的项（4/5/6/7）经用户确认后执行，结束后配置**逐字节**还原。
> 复核命令都是现成的，可直接重跑。

基线（执行前 / 执行后一致）：

```
C:\Users\suyue\.config\opencode\opencode.jsonc
  sha256 = 7D16F8A36D02D5E40945BA29F39A9FCF71F5FF59A60BF6EE7AA32FC2355AD1B7
  bytes  = 15014      （无 permissions 键）
```

---

## (1) 插件放在 `<config>/plugins/`，新会话里按名字可调用

**通过。**

```pwsh
opencode plugin list --builtin
# ID                  VERSION  SOURCE
# skill_management    local    C:\Users\suyue\.config\opencode\plugins\skill_management.js
```

新会话实测（`opencode run --standalone --format json`）中出现 `tool_use` 名为 `skill_management`，
`status=completed`。**注意**：`options:{codemode:false}` 的工具**不在 Code Mode 目录里**，
若模型跑进 `execute` 用 `search()`/`tools.*` 去找会误判「工具不存在」（已实际观察到一次）；
提示模型「不要走 execute，直接按名字调用」即可。

## (2) `input` schema 被接受

**通过。** `tool.input` 就是原生 JSON Schema（`{type:"object", properties:{…}, required:["action"], additionalProperties:true}`）；
工具能注册且能被调用即为实证。另有两条独立证据见 `docs/preflight.md` 的 (b)。

## (3) `list` 覆盖全部已注册 skill，来源/路径标注正确

**通过。** 实测 29 个 skill，来源分布 `config` / `plugin` / `claude` / `agents` / `catalog` / `embedded` 均正确归类。
输出**从不包含**正文（验收脚本用哨兵字符串断言）；`description` 只取首行并截断；末尾有统计行
（`发现 29 个、已禁用 N 个、ask K 个`）与目标配置文件路径。

## (4) `disable` → 新会话不可见 + 加载被拒；`enable` 完全还原

**通过。** 用 `grill-me` 做的完整往返：

| 步骤 | 证据 |
|---|---|
| `disable grill-me` | ✅ 回读校验通过（轮询 3 次）；配置 15014 → **15126** bytes |
| 与备份的差异 | **恰好** `permissions` 3 行块 + 上一行补的 1 个逗号（`Compare-Object` 输出可核对） |
| 未重启的运行中 service | `debug agents` 里 13/13 个 agent 出现 `{"action":"skill","resource":"grill-me","effect":"deny"}` |
| 新会话 `skill {id:"grill-me"}` | `status=error` → `{"error":{"type":"permission.rejected","message":"Permission denied: skill"}}` |
| 对照：同会话 `skill {id:"windows-shell"}` | `status=completed` → 正常返回 `<skill_content name="windows-shell">`（证明不是整个 skill 工具被禁） |
| 模型可见 `<skill>` 列表 | **含** `grilling`，**不含** `grill-me`（`list` 里该行 `state=disabled`） |
| `debug config` | 目标文件在"已加载文档"列表里 |
| `enable grill-me` | ✅ 删规则 + 清理（本工具新建的）空块 + 回读校验通过 |
| 还原结果 | sha256 回到 `7D16F8A3…`，15014 bytes，`byte-identical: true` |

## (5) `dryRun: true` 零文件改动

**通过。** 真实宿主实测：`7D16F8A3…` → `7D16F8A3…`，15014 → 15014 bytes，未生成 sidecar；
输出了"实际将落盘的新增/改动行"预览。

## (6) 手工删掉配置里的规则 → 显示可用 + sidecar 不一致告警

**通过。** 先 `disable windows-shell`（sidecar 写入记录），再用基线字节手工覆盖配置（等价于用户手删那条规则），
然后 `list`：

```
| windows-shell | windows-shell |  | config | user | available | …\skills\windows-shell\SKILL.md | … |
发现 29 个、已禁用 0 个、ask 0 个。
⚠️ sidecar 与配置不一致：sidecar 记录了 `windows-shell`，但配置 `…\opencode.jsonc` 里已无对应规则（未自动重放）。这些 skill 已按实际规则集显示为可用。
```

## (7) 热加载行为已注明

**通过 → 热生效，不需要重启。** 详见 `docs/preflight.md` 的 (c)。
关键：重载是**异步**的，回读必须**轮询**（一次 `ctx.agent.reload()` 就立刻读会读到旧规则集）。

---

## 附带：§6 硬边界自查

| 边界 | 证据 |
|---|---|
| 不创建/删除/移动/改写任何 skill 文件 | 全部写盘调用只有 4 处：目标配置（写 + 回滚）、sidecar、备份目录；`rg` 可核对 |
| 不改 frontmatter | 8 处 `frontmatter`/`disable-model-invocation` 出现全是只读（注释 / 读取函数 / inspect 输出） |
| 不写 `policies` / `experimental.policies` | 源码里 `policies` 只出现在 description 文本里 |
| 不写系统级配置、不碰非 OpenCode 文件 | 目标文件解析限定在 `<config>` 内，并显式排除托管的 `opencode.managed.json` |
| 结论来自实际读取，不猜 | 取不到注册表/规则集时输出「未验证」；`resolveId` 命中多个时报候选而不猜 |

## 补充验证：两条首轮遗漏的 objective 要求路径

### A. `list` 的 `id` 列在注册表项**没有 `id`** 时按 §3.5 反推

**通过**（验收脚本 F 组，12 项断言）。用不带 `id` 的注册表项实测：

| 注册表项 | 反推出的 `id` |
|---|---|
| `{ path: "<root>/foo.md" }` | `foo` |
| `{ path: "<root>/bar/SKILL.md" }` | `bar` |
| `{ path: "<root>/a/b/SKILL.md" }` | `b` |
| `{ location: "<root>/loc.md" }`（`location` 是字符串） | `loc` |
| `{ name, description }`（既无 `id` 也无路径） | `(unknown)`（不猜） |

- `list` 在统计行下补一句"其中 4 个 id 由路径反推（注册表项未提供 `id`）"；注册表自带 `id` 时**不显示**该句。
- `inspect` 明确报告**反推过程**：来源（注册表直接给出 / 由路径反推）、推导规则原文、`dirname`/`basename` 规则输入、实际使用的路径字段（`path` 或 `location`）。
- 反推得到的 `id` 参与权限求值（不是 `unknown`）。

### B. `enable` 的定位判据（v5 放宽）

**通过**（验收脚本 G 段 + F 段）。判据从「sidecar 必须有记录」改为「能否唯一定位挡路的那一条精确全局规则」：

| 场景 | 行为 |
|---|---|
| 标记注释命中（sidecar 有无都不影响） | ✅ 精确删除，来源标注「本工具写入（同行标记注释）」 |
| 无标记，sidecar 有记录且恰好一条完全相同 | ✅ 删除并 `⚠️` 告警 |
| **sidecar 丢失、标记还在** | ✅ **仍然删除成功**（旧行为会拒绝；这是 v5 的主要动机） |
| 标记与 sidecar 都没有 | ❌ 拒绝，并列出该 id 相关规则原文 |
| 同一 id 两条精确规则（歧义） | ❌ 拒绝，列出全部候选 |
| 挡路的是 `resource:"*"` / agent 级 `permissions` / `policies` | ❌ 只报告不代改，指出调用者 agent 与命中规则 |
| 删除后仍被更宽规则压成 `deny` | ✅ 仍报删除成功，但写明「删除后的生效效果 = deny」及挡路规则 |

> 成功路径统一输出「被删规则的来源」与「删除后的生效效果」，不把「已删除」当成「已可用」。

### 写入策略（v5）

- 原子写：同目录 `.tmp` + `renameSync`，验收断言写入后无 `.tmp` 残留。
- 备份滚动只保留 **1 份**（配置文件含 MCP 凭据，副本越少越好）；多次写入后断言仍为 1 份。

### C. npm / git spec 分发与运行时加载（v5 · 2026-10-19/20）

| 步骤 | 结果 |
|---|---|
| `npm publish --tag next`（本机手工，rc.0） | ✅ `opencode-skill-management@0.1.0-rc.0` |
| `opencode plugin add opencode-skill-management@0.1.0-rc.0` | ✅ 写入全局配置 `plugins` |
| `opencode plugin add github:sogeisetsu/opencode-skill-management` | ✅ 写入配置；source 显示 `github:…`，版本为 commit hash |
| `opencode plugin list` | ✅ `skill_management 0.1.0-rc.0 opencode-skill-management@0.1.0-rc.0` |
| 新进程 `run --standalone` | ✅ 工具可调用、`status=completed` |
| `plugin check` | ✅ current |
| `plugin update`（无 target） | ✅ `No plugin updates available` |
| `plugin update <target>` | ⚠️ 宿主 2.0.32 的 CLI bug：即使配置里的 spec 完全一致也报 `Plugin is not configured: <target>`（带版本时直接抛栈）；与本插件无关 |
| `plugin remove` | ✅ 移除成功；配置随后逐字节还原（`7D16F8A3…` / 15014 bytes） |
| 正式 `0.1.0` 包运行时 | ✅ 安装后在**新进程**里调用 `skill_management` → `status=completed` |
| Trusted Publisher | ✅ `sogeisetsu/opencode-skill-management` · `publish.yml` · `npm publish` + `npm dist-tag`；状态 Valid |
| `v0.1.0-rc.1` CI 发布 | ✅ `publish.yml` 成功；`next` → `0.1.0-rc.1`；SLSA provenance 已生成 |
| `v0.1.0` CI 发布 | ✅ `latest` → `0.1.0`；SLSA provenance 已生成 |

只带包根（`exports["."]`）的包运行时加载正常，**不需要** `./server` 子路径。

> npm 首发细节：未发布的包无法先配 trusted publisher（npm/cli#8544），所以 rc.0 由本机手工发布建包；首次发布会先出现 `0.0.0-stage` 临时占位，且 `latest` 也会被指向该版本。后续版本改由 CI 的 trusted publishing 发布。

### D. `list` 的 state 列按调用者 agent 求值（v5 修复 · 2026-10-20）

真实故障：另一次会话里 `list` 报告「装了 29 个，只有 `simplify` 可用，其余全是 disabled（被全局权限规则挡了）」，而同一时刻 `inspect` 说 `plan`/`build` 对 `grill-me` 是 allow、实际加载也成功、配置里根本没有 `permissions` 段。

根因（两处）：

| # | 位置 | 问题 |
|---|---|---|
| 1 | `src/skill_management.js` `actList`（旧 866 行） | 把所有 agent 的 `permissions` `flatMap` 拍平去重后求值。宿主 `findLast` 取最后一条命中，于是子 agent（`explorer`/`librarian`/`designer`/`fixer`/`observer`，以及内部 `title`/`summary` 的 `{*,*,deny}`）的 deny 被算到调用者头上。`simplify` 显示可用同样是巧合（`oracle` 里有一条同 id 的 allow 排在 deny 之后）。 |
| 2 | `tools/verify.mjs` `agentItems()` | 夹具先 `...a` 再赋 `permissions:`，把 `withTitleDeny` 注入的 `{*,*,deny}` 覆盖掉了。所以「别的 agent 全 deny 不影响调用者」那条回归用例**一直是空跑的**，CI 抓不到上面的 bug。 |

修复后：

- `actList` 与 `inspect`/`disable`/`enable` 同源：`pickAgent(agents, ctx.__agentId)` → 该 agent 自己的 `permissions` 求值（规范 §3.6）；
- 输出新增 `调用者 agent：` 行；`context.agent` 缺失或不在注册表时显式告警，不再静默用别的 agent 顶替；
- 新增 `另有 K 个 skill 在其它 agent 下状态不同` 提示（仅 K > 0）；
- 夹具保留 agent 自有规则并排在全局规则之后（与真实宿主一致）。

证据：

| 检查 | 结果 |
|---|---|
| `node tools/verify.mjs` | ✅ 248 项全过（v5 时 175 项；1.0.0 新增 N1–N14） |
| 反向验证：把 `callerRules` 换回「合并去重」实现 | ✅ 新断言如期失败 3 项（`172 通过 / 3 失败`）：`别的 agent 全 deny 不影响调用者：统计仍是 0 disabled`、`…state 列仍全是 available`、`只有别的 agent deny 某个 id 时，调用者仍是 available` |
| 真实宿主 e2e（`opencode run --standalone --auto --format json`，v2.0.32，新进程） | ✅ `发现 29 个、已禁用 0 个、ask 0 个。` / `调用者 agent：\`orchestrator\`` / `ℹ️ 另有 29 个 skill 在其它 agent 下状态不同`；29 行全是 `available` |
| 与 `inspect` 的一致性 | ✅ 同一 id 的 `list` state 与 `inspect` 的结论一致（修复前二者互相矛盾） |

> 「另有 29 个」不是异常：本机子 agent 集体 `skill:*` deny，所以对主 agent 可见的每个 skill 在子 agent 下都不同。用子 agent 调 `list` 时相应 skill 会显示 `disabled`，那也是对的。

### 真实宿主回归（v5 构建 · 2026-10-20）

| 步骤 | 结果 |
|---|---|
| `disable grill-me` | ✅ 回读校验通过（轮询 3 次）；`7D16F8A3…` → 15126 bytes |
| 新进程 `skill {id:"grill-me"}` | ✅ `permission.rejected` / `Permission denied: skill` |
| `enable grill-me` | ✅ `定位方式：标记注释命中（文件内自证）`；来源=本工具；删除后 `orchestrator` = allow；列出 8 个自有规则覆盖的 agent |
| 还原 | ✅ **逐字节一致** 回到 `7D16F8A3…` / 15014 bytes；空 `permissions` 块已清理；sidecar 回到空规则集 |

## 1.0.0 验收（2026-10-23 · 修 ask 校验空转 + 全面测试）

基线（执行前）：

```
C:\Users\suyue\.config\opencode\opencode.jsonc
  sha256 = 7AE5B60A457D8BCB297EC55CBBC3A71F477AD94967979A810A12C4AA01EA6750
  bytes  = 15373      （无 permissions 键；含 plugins 数组）
```

### 修复项与实证

| # | 内容 | 证据 |
|---|---|---|
| C1 | `ask` 回读校验不再判「不是 deny」 | N1 在改前**跑红 4 项**（宿主没读进规则也报「✅ 已写入并校验通过」，并留下文件改动）；改成「调用者规则集里该三元组条数增加」后转绿。N3 证明「规则写入成功但被 agent 自有 allow 覆盖」时会写明实际效果 |
| — | 顺手发现的 2 个 bug | ① `insertRule` 在单行数组 `{"permissions":[{…}]}` 上把逗号插到新项之后，产出非法 JSONC（N8 暴露）；② `loadSidecar` 把未知 `version` 当有效记录（N7 暴露） |
| C2/C3 | 删死代码、去重取值、`list` 只解析一次 | 行为断言未变（175 项旧断言语义全部保留） |
| C4/C5 | glob 快路径 + 有界缓存、`strictValidate` 按 token 拼接 | 同一夹具 60 次中位数：**3.72 ms → 2.24 ms**（1.66×，−1.48 ms；13.6 KB 配置、29 skills × 12 agents × 10 rules） |

### L1 单进程（Windows）

```pwsh
node tools/verify.mjs     # 全部通过：248 项（A–I）
```

### L3 真实宿主（新进程，`opencode run --standalone --auto --format json`，v2.0.32）

| 步骤 | 结果 |
|---|---|
| (a) `list` vs 系统提示 `available_skills` | `list` 32 个、全部 `available`、调用者 `orchestrator`；系统提示 31 个。**差集恰好是 `grill-me`**（`autoinvoke=off` → 宿主不注入模型可见列表），其余名字逐一相同 |
| (b1) `disable grill-me`（先 `dryRun` 预览，零写入） | ✅ `15373 → 15485` bytes（+112）；输出含 `精确规则数 0→1` —— 证明跑的是 1.0.0 代码（本机同时装了 npm `0.2.0`，输出里没有这个字段） |
| (b2) 新进程 `skill {id:"grill-me"}` | `status=error` → `{"error":{"type":"permission.rejected","message":"Permission denied: skill"}}` |
| (b3) 同进程对照 `skill {id:"grilling"}` | `status=completed` —— 拒载是个别 skill，不是整个 `skill` 工具被禁 |
| (b4) 新进程 `list` | `grill-me = disabled`、`grilling = available`；`发现 32 个、已禁用 1 个、ask 0 个` |
| (c) `enable grill-me` | `定位方式：标记注释命中（文件内自证）`；空的 `permissions` 块一并清理；`删除后的生效效果：orchestrator = allow`；`ℹ️ 另有 7 个 agent 结果不同`（title/summary/explorer/oracle/designer/fixer/observer） |
| (c) 还原 | sha256 回到 `7AE5B60A…`、`15373` bytes（逐字节一致）；sidecar `rules: []` |

### 发布闸门

| 检查 | 结果 |
|---|---|
| `npm pack --dry-run` 内容 | 只含 `package.json` / `README.md` / `LICENSE` / `CHANGELOG.md` / `src/**` |
| `exports["."]` 按包名 self-reference 解析 | ✅ 解析出的入口注册了四个动作（`list`/`inspect`/`disable`/`enable`） |
| `node tools/install.mjs` 副本 | ✅ 与 `src` 逐字节一致；重复执行为幂等（`已是最新`） |

### L2 跨平台（Linux，WSL Debian）

```bash
bash tools/linux-verify.sh
# == 3) 全部通过：248 项
# == 4) skill_management  local  …/plugins/skill_management.js
# == 5) 真实家目录与跑前一致
```

首轮跑红暴露的是**验收脚本自己的隔离缺陷**（不是插件问题）：`opencode --version` 也会在 `$HOME` 下建
`~/.config/opencode` 与 `~/.local/share/opencode/log/opencode.log`，而脚本到第 4 步才切临时 `HOME`，
于是在干净机器上第 5 步必然报「真实配置目录被改动了」。已把 `export HOME/XDG_*` 提前到第 0 步，复跑通过。

CI（`ubuntu-latest` + `windows-latest`）跑同一套 248 项断言。

### 发布结果（2026-10-23）

| 步骤 | 结果 |
|---|---|
| `git push origin main --tags` | `4dff757..4b566be  main` + `* [new tag] v1.0.0` |
| CI `verify`（`ubuntu-latest` + `windows-latest`，run 39941791353） | ✅ 两个 job 都 success（同一套 248 项） |
| CI `publish`（tag 触发，run 39941791346） | ✅ `+ opencode-skill-management@1.0.0`，dist-tag `latest`，SLSA provenance 已生成 |
| 打包内容（CI 日志） | `CHANGELOG.md` / `LICENSE` / `README.md` / `package.json` / `src/skill_management.js`，5 files / 27.6 kB |
| `npm view opencode-skill-management version dist-tags --prefer-online` | `1.0.0` / `{ latest: '1.0.0' }` |
| `npm view …@1.0.0 dist.integrity` | `sha512-bO4h9dbHG5hzj…RO054XDRt7ymA==`（与 publish 日志一致） |
| 本地 `node tools/install.mjs` | 安装副本与 `src` 同哈希 `2488834B…` |

> 注：`npm view` 首次查询会被本地 npm 缓存回成 `0.2.0`，加 `--prefer-online` 或直接查 `registry.npmjs.org` 才是最新值（已用两种方式交叉核对）。

## 1.1.0 验收（2026-10-30 · JSON 输出 + output schema）

目标：四个动作从 Markdown 改为结构化 JSON，并且是宿主能校验的真正 `output`，不是把 Markdown 包进一段 JSON 字符串。

| 检查 | 结果 |
|---|---|
| 工具声明 `output` JSON Schema | ✅ 宿主接受（没有 schema 转换错误） |
| 新进程 `list`（真实注册表，零写入） | ✅ `status=completed`；content 可 `JSON.parse`，`"schemaVersion":1`、`"action":"list"`、`"ok":true`；本机 33 个 skill |
| 新进程 `inspect` 不存在的 id | ✅ `status=completed`；`ok:false`、`error.code="skill_not_found"` —— **错误分支同样通过 output 校验** |
| `node tools/verify.mjs` | ✅ 260 项全过（248 → 260；E 段改为解析 JSON 断言） |
| `npm run docs:build` / `npm run docs:check` | ✅ 20 路由（10 en + 10 zh 镜像）、内部链接与语言切换全过 |
| `node tools/install.mjs` | ✅ 安装副本与 `src` 同哈希 `42443121FC5234C5…`（75756 bytes） |

实测命令（新进程；提示词明确要求不要走 Code Mode）：

```pwsh
opencode run --standalone --auto --format json '调用原生工具 skill_management，参数 action 为 list。不要使用 execute / Code Mode 工具，直接按名字调用。'
# tool_use status=completed
# content/output 以 {"schemaVersion":1,"action":"list","ok":true,... 开头
# warnings: 另有 33 个 skill 在其它 agent 下状态不同（逐 agent 明细见 inspect）

opencode run --standalone --auto --format json '调用原生工具 skill_management，参数 action 为 inspect、id 为 definitely-not-a-skill。不要使用 execute / Code Mode 工具。'
# tool_use status=completed
# {"schemaVersion":1,"action":"inspect","ok":false,"warnings":[],"near":[],"error":{"code":"skill_not_found",...}}
```

宿主为什么能接受这些形态、以及 `output` / `content` 的运行时规则，见 `docs/preflight.md` §7。

## 复跑方式

```pwsh
node tools/verify.mjs        # 260 项断言，跑在临时配置目录，不触碰真实配置
node tools/install.mjs       # 幂等安装到 <config>/plugins/
```

对真实配置的往返（会短暂修改全局配置，自动备份 + 回读校验 + 失败回滚）：

```pwsh
opencode run --standalone --auto --format json 'Do NOT use the execute/code-mode tool. Call skill_management directly once with: action disable, id <某 skill>. Echo its raw output verbatim.'
# 验证后
opencode run --standalone --auto --format json 'Do NOT use the execute/code-mode tool. Call skill_management directly once with: action enable, id <同一个 skill>. Echo its raw output verbatim.'
```

## 已知副作用（需要你知情）

1. **备份会复制配置文件**：每次写前备份到 `<config>/skill_management.backups/opencode.jsonc.<时间戳>.bak`（滚动只保留 **1 份**）。
   配置文件里含 MCP 凭据（如 `Authorization: Bearer …`），所以备份仍然是一份凭据副本；v5 已把副本数从 10 降到 1。
   不想要的话可以把 `MAX_BACKUPS` 调成 0 / 改成只读不备份 —— 说一声我改。
2. **`codemode:false` 的取舍**：工具进原生表（模型可直接按名字调用，已实测），但不在 Code Mode 目录里，
   Code-Mode 倾向的模型可能误判"工具不存在"。改成 `codemode:true` 可以规避，代价是受 Code Mode 目录大小限制。
3. 每次读注册表会注册并立即 dispose 一个 `transform` hook（不留残留），这是宿主 2.0.32 上拿到注册表数组的唯一途径。
