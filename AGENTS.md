# AGENTS.md

本仓库实现 OpenCode V2 的 `skill_management` 插件（一个工具，四动作 `list`/`inspect`/`disable`/`enable`）。
权威文档：`.openchamber/plans/skill-management-spec.md`（规范）· `docs/preflight.md`（宿主实测）· `docs/acceptance.md`（验收证据）。

## 命令

```pwsh
node tools/verify.mjs                # 167 项断言；跑在临时 <config> 下，不碰真实配置
node tools/verify.mjs --section G    # 只跑一段（A–G，按标题前缀匹配，大小写不敏感）
node tools/install.mjs               # 幂等安装到 <config>/plugins/skill_management.js
```

- 仓库里的 `src/skill_management.js` 是**唯一源**；`<config>/plugins/` 下那份是安装产物，**别直接改**（改完必须重跑上面两条）。
- 没有测试框架 / lint / CI —— 验收就是 `tools/verify.mjs`。
- 端到端必须在**新进程**里验（插件在宿主进程启动时加载）：
  `opencode run --standalone --auto --format json '<消息>'` —— 消息是**位置参数**，没有 `--prompt`。

## 最容易踩的坑

- **插件目录里不能放第二个 `.js`**：宿主会把 `plugin` / `plugins` 目录下的每个 `.js` / `.ts` 文件**和子目录**都当插件加载，辅助代码拆出去会直接被当成插件而校验失败。所以插件是单文件。
- **`ctx.skill.list()` / `ctx.agent.list()` 返回 `{location, data}` 信封，不是数组。** 拿注册表要用 `ctx.<域>.transform(draft => draft.list())`，并 `dispose()` 掉返回的注册（否则每次调用都留一个 hook）。
- **唯一真源是宿主二进制 + `opencode debug *`，不是 npm 类型包。** 本机 `@opencode-ai/plugin` 是 1.18.18 而宿主是 2.0.32：其 v2 类型**没有 `ctx.tool`**，`SkillV2Info` 用的是 `location`（真实字段是 `path`），`ToolContext` 也没有真实的 `progress`。按那些类型写会直接错。
- **重载是异步的**：`ctx.agent.reload()` 会在配置文件被重新读入**之前**返回。回读校验必须**轮询**（见 `verifyEffect`，200ms × 最多 6s，可用 `SKILL_MGMT_VERIFY_TIMEOUT_MS` 覆盖）。
- **别用「所有 agent 都 deny」当判据**：`title` / `summary` 是 `{*,*,deny}`（内部 agent），而且 agent 自有规则**可能排在全局规则之后**（本机 `fast-responder` 就是这样）。判断"是否被更宽规则覆盖"只看**调用者 agent**（执行上下文里的 `context.agent`）。
- 命名近似别混：顶层 `permissions`（数组，V2 用）vs `permission`（单数对象，已 deprecated）；断言入参是 **`resources`（复数）**，规则匹配是 **`resource`（单数）**。
- 求值无命中时宿主回退 **`ask`**，不是 `allow`。拒载返回 `permission.rejected`；`Unable to load skill <id>` 只在 id **不存在**时出现。
- 注册表项自带 `id` 时直接用；**没有 `id`** 时才按 §3.5 从 `path` / `location` 反推，并把反推过程写进 `inspect`。信封里的 `location` 是 `{directory}` 对象，**不是字符串，绝不当路径用**。

## 涉及真实全局配置时

- `list` / `inspect` 只读；`dryRun: true` 零写入 —— 优先用它们。
- 只有 `disable` / `enable` 会写 `<config>/opencode.jsonc`：写前备份、写后回读校验、失败回滚。
- **绝不要写 `opencode.managed.json`** —— OpenChamber 托管的第二份被加载的全局配置。
- 备份目录 `<config>/skill_management.backups/` 里是 `opencode.jsonc` 的**完整副本**，而该文件含 MCP 凭据：**别把它复制进仓库、也别当证据贴出来**。
- 跑真实端到端时，提示词要写明"**不要用 execute / Code Mode 工具**"：`codemode:false` 的工具不在 Code Mode 目录里，模型会误判成"工具不存在"并放弃调用（真实发生过）。

## 硬约束（改代码前先看）

- 只改全局配置里的 skill permission 规则；不装 / 不删 / 不移动 / 不改写任何 skill 文件；不碰 SKILL.md frontmatter；不写 `policies` / `experimental.policies`；不写系统级配置。
- 写配置只能**最小文本编辑**（保留注释、缩进、键顺序，以及**目标文件自己的** EOL / BOM），禁止 parse → 序列化 → 回写。注意：仓库 `.gitattributes` 强制 LF，但这是两回事 —— 插件写用户配置时必须保留用户文件的 EOL/BOM。
- 纯 Node 内置模块，无第三方依赖，不调用 shell。
- 状态结论必须来自实际读到的注册表 / 规则集；取不到就写「未验证」，不猜。

## 文档约定

- 中文正文；代码 / 命令 / 路径 / 标识符保持原文。
- 关键结论标注 **已证实 / 待实测** 并给出出处（二进制片段、实跑命令）。没有证据的结论不写进规范。
- 宿主版本升级后，`docs/preflight.md` 每条都要重测；规范 §1.3 的类型漂移表与 §9 状态表最容易失效。
- 别把密钥 / token / 本机私有配置内容写进仓库。

## 只读核查命令

```pwsh
opencode debug paths            # home / config / data / cache / state 的实际解析
opencode debug config           # 实际加载的配置文档（含绝对路径）
opencode debug agents           # 每个 agent 的最终 permissions 数组（硬断言面）
opencode plugin list --builtin  # 已加载插件与 source（local / package / builtin）
```

这些默认连的是**正在运行的**服务，不是新进程；要"新进程 / 新会话"用 `opencode run --standalone`。
