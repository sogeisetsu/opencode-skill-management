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

### B. `enable` 的归属门是 fail-closed

**通过。** 需求原文是 "if sidecar has no record, refuses execution"。实测（验收脚本 + 真实宿主）：

| 场景 | 行为 |
|---|---|
| sidecar 有记录 + 命中本工具标记注释 | ✅ 精确删除（真实宿主输出：`定位方式：sidecar 有记录 + 命中本工具标记注释`） |
| sidecar 有记录，标记被剥掉，且恰好一条完全匹配 | ✅ 删除并 `⚠️` 告警 |
| **sidecar 无记录**（即使规则带本工具标记） | ❌ **拒绝执行**，并列出该 id 相关规则原文 |
| sidecar 无记录 且 配置里也没有该 id 的规则 | ❌ 拒绝，并说明"无事可做" |

> 取舍说明：把 sidecar 记录作为前置条件（而不是"有标记就删"）意味着 **sidecar 丢失时工具会拒绝撤销自己的改动**，需要用户手工处理。
> 这是需求明确要求的行为，也是更保守的一侧（宁可拒绝，不可误删）。真实宿主回归已确认正常路径不受影响。

### 真实宿主回归（新构建）

| 步骤 | 结果 |
|---|---|
| `disable grill-me` | ✅ 回读校验通过（轮询 3 次）；`7D16F8A3…` → `B1F5BA17…` |
| `enable grill-me` | ✅ `定位方式：sidecar 有记录 + 命中本工具标记注释`；清空空块；回读校验通过 |
| 还原 | **逐字节一致** 回到 `7D16F8A3…`；sidecar 回到 `{"version":1,"rules":[]}` |

## 复跑方式

```pwsh
node tools/verify.mjs        # 136 项断言，跑在临时配置目录，不触碰真实配置
node tools/install.mjs       # 幂等安装到 <config>/plugins/
```

对真实配置的往返（会短暂修改全局配置，自动备份 + 回读校验 + 失败回滚）：

```pwsh
opencode run --standalone --auto --format json 'Do NOT use the execute/code-mode tool. Call skill_management directly once with: action disable, id <某 skill>. Echo its raw output verbatim.'
# 验证后
opencode run --standalone --auto --format json 'Do NOT use the execute/code-mode tool. Call skill_management directly once with: action enable, id <同一个 skill>. Echo its raw output verbatim.'
```

## 已知副作用（需要你知情）

1. **备份会复制配置文件**：每次写前备份到 `<config>/skill_management.backups/opencode.jsonc.<时间戳>.bak`（滚动保留 10 份）。
   配置文件里含 MCP 凭据（如 `Authorization: Bearer …`），所以**这些备份等于把凭据多复制了几份**。
   不想要的话可以把 `MAX_BACKUPS` 调小 / 改成只读不备份 —— 说一声我改。
2. **`codemode:false` 的取舍**：工具进原生表（模型可直接按名字调用，已实测），但不在 Code Mode 目录里，
   Code-Mode 倾向的模型可能误判"工具不存在"。改成 `codemode:true` 可以规避，代价是受 Code Mode 目录大小限制。
3. 每次读注册表会注册并立即 dispose 一个 `transform` hook（不留残留），这是宿主 2.0.32 上拿到注册表数组的唯一途径。
