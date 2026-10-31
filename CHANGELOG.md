# Changelog

本文件记录对外可见的变化。版本遵循语义化版本；1.x 内的兼容承诺见 README「兼容性与边界」。

## 1.2.1 — 2026-11-01

### 修复

- 写路径串行化：宿主会把同一个 step 里的多个工具调用并发执行，两个 `disable` / `enable`
  同时改一个文件时，「读 → 改 → 回读校验 → 记录」互相交错，后一个的回滚会把前一个刚写入的
  规则写回去，文件里最后留下一条本不该存在的规则（实机复现）。现在写动作排进进程内队列，
  后到的调用等前一个（含回读轮询）走完再开始；队列只覆盖单个宿主进程。

### 验收

- 新增 N22 / N23：并发 `disable + enable` 后配置逐字节还原且 sidecar 无残留；并发
  `disable + disable` 只写一条规则、只有一个 `changed:true`。这两组用例在去掉互斥后会变红
  （已实测：4 项失败）。总计 333 项。

## 1.2.0 — 2026-11-01

### 修复

- `list` 的 `summary.diverged` 与「另有 N 个 skill 状态不同」提示只统计**可见** agent。
  内部 agent（`title` / `summary`）自带 `{*,*,deny}`，此前让真机每次 `list` 都报「N 个状态不同」
  的噪音；`inspect.agents[]` 仍列全部 agent，明细不丢。
- frontmatter 的布尔值不再被 `Boolean()` 强转：`disable-model-invocation: "false"` 是字符串，
  `Boolean("false") === true`，导致同一份 frontmatter 在 `list` 的 `autoinvoke` 与 `inspect` 的
  `frontmatter.disableModelInvocation` 上结论相反。现在按 `true/yes/on/1` 与 `false/no/off/0`
  （含引号形态）归一，两处输出共用同一套判断。
- `disable` / `enable` 的 sidecar 落盘失败不再把整次调用降级成 `internal_error`：配置已经写入
  并通过回读校验，返回 `ok: true` + `changed: true`，保留 `diff`，`sidecar` 为 `null`，
  `warnings` 说明原因（`disable` 仍可靠同行标记注释被 `enable` 定位）。配置不回滚。
- `enable` 的 `config_unparsable` 硬拒绝只在**目标配置文件**无法解析时触发。sidecar 记录过的
  其它配置文件语法坏掉，只进 `warnings` 并点名文件，不再阻断对目标文件的恢复。

### 变更

- `tools/install.mjs` 改为**先检测再写**：`opencode.json(c)` 的 `plugins` 里已有本包、或同一批被扫描
  目录里已有第二份副本时，拒绝写入并返回退出码 `2`（一个字节都不动）。原因是宿主对同一 plugin id
  只加载一份，双来源会报 `Duplicate plugin ID` 并让其中一份显示为加载失败。
- 安装器新增 `--check` / `--dry-run`（只报告）、`--uninstall`（只删本插件那一个文件）、
  `--npm`（断言走 npm 渠道、永不写文件）、`--force`（逃生口）、`--json`；未知参数退出 `3`。
- `<config>` 解析改为与宿主一致：`$OPENCODE_CONFIG_DIR` 优先，其次 `$XDG_CONFIG_HOME/opencode`，
  再 `~/.config/opencode`。
- `--check` 会报告副本版本与仓库版本的差距、以及本机 npm 缓存里是否已有更新的版本（纯本地判断，
  不联网、不写配置）。
- 插件源码新增 `export const PLUGIN_VERSION`，与 `package.json` 的 `version` 由 `verify.mjs` 断言一致。
- 验收脚本新增 J 段（19 项）：冲突检测、自排除、`--force` / `--uninstall` / `--json`、坏 JSONC 不误判、
  项目级声明只警告；并新增按 `OUTPUT_SCHEMA` 对每个动作 `output` 的逐字段校验（含 `error.code` /
  `error.message`）与 `content` / `output` 同一性断言。总计 326 项。
- README 精简到 56 行：字段表、动作细节、安装 flags、npm 包内容、用法与验收分别落到文档站的
  `actions/*`、`installation`、`overview`、`development`。
- 文档站新增 `design-decisions`（设计取舍）与 `development`（开发与验收）两页；`permissions` 的
  Effects 一节扩写成 `deny` vs `ask` 的对比表加三个真实用途例子。
- README 与文档站安装页改写：单文件通道不跟 npm 更新，两条通道的升级路径分开写；「不要装两份」
  一节按实测症状重写（原来写的“后加载覆盖前者”是错的）。

## 1.1.0 — 2026-10-30

**破坏性变更**：四个动作的输出从 Markdown 改为单个 JSON 对象。动作、入参、写入的规则形状、
行尾标记与单文件结构都没变；这是 1.1.0 唯一的破坏性变更。

> **SemVer 偏差（已接受）**：破坏性变更落在 minor 上，严格说不符合 SemVer。1.1.0 已经发布，
> 不回收、不改版本号；影响与迁移方式是「升级后把解析正文的调用方改成读 JSON 字段」（成败看 `ok`，
> 原因看 `error.code`）。同一说明写在 README 开头与文档站 Compatibility 页。

### 变更

- 工具现在声明 `output` JSON Schema，并同时返回 `output` 与缩进后的 JSON `content`。宿主
  2.0.32 实测：声明 `output` 后不返回它会被判 `Tool did not return its declared output`；
  没声明却返回会被判 `Tool result declared output without an output schema`；声明后不返回
  `content` 时宿主把 `content` 设为 `JSON.stringify(output)`。
- 所有结果共用信封 `{ schemaVersion: 1, action, ok, warnings }`；失败另带
  `error: { code, message }`，不再靠正文里的 ❌/✅ 判断成败。
- `list` 返回 `callerAgent` / `summary` / `skills[]` / `config` / `sidecar` / `consistency`。
  `description` 仍只取首行，但不再截断到 60 字符。
- `inspect` 返回 `skill` / `idDerivation` / `agents[]` / `caller` / `conclusion`；找不到与
  重名分别用 `skill_not_found` / `name_ambiguous` 表示，近似 id 在 `near`，候选在 `candidates`。
- `disable` / `enable` 返回 `changed` / `reason` / `before` / `diff` / `verification` /
  `backup` / `sidecar`。`enable` 另有 `location`（`marker` / `sidecar`）、`rule`、
  `candidates`、`relatedRules`；拒绝原因改用错误码（`unverifiable_origin` /
  `ambiguous_rule` / `no_matching_rule` / `config_unparsable`）。
- `enable` 在目标配置无法解析、又没有候选规则时，改为 `ok:false` + `config_unparsable`，
  不再把「读不到」说成「无需修改」。
- `disable` 的 `already_disabled` / `covered_by_broader_rule` 从正文改为 `reason` 字段；
  `dryRun` 用 `dryRun: true` / `planned: true` / `diff[]` 表达，`message` 保留一句说明。

### 测试

- 断言 248 → **260**。E 段改为解析 `content` 后按字段断言，并新增：`content` 是合法 JSON、
  与 `output` 是同一份数据、信封字段齐全、没有 Markdown 表格分隔行、未知动作也返回 JSON。
- 原「未声明 output 时结果不含 output」改为「声明 output 后结果必须带 output」。

## 1.0.0 — 2026-10-23

首个正式版。四个动作的入参与输出语义自此冻结（见 README「1.0.0 兼容承诺」）。

### 修复

- **`disable --effect ask` 的回读校验形同虚设。** 旧判据是「调用者求值不是 `deny`」，而宿主对**无规则命中**的 skill 回退 `ask`，agent 自有规则又可能把全局 `ask` 覆盖成 `allow` —— 两者都不是 `deny`。结果是宿主根本没把规则读进注册表时，也输出「✅ 已写入并校验通过」，并把 `actual` 打印成 `allow`。现在 `ask` 的判据与 `enable` 同源：调用者规则集里该 `{skill, id, ask}` 规则的**条数确实增加**（输出里带 `精确规则数 0→1`）。`deny` 判据不变。
- 回读失败回滚时，补一句「调用者规则集里实际命中的是哪条规则」，用于解释 agent 自有规则顶掉全局规则的情形。
- 写入成功但对调用者**不产生**该效果时（agent 自有规则排在全局之后），输出写明「实际效果是 …」，不再把"已写入"说成"已生效"。
- `insertRule` 在**单行数组**（`{"permissions":[{…}]}`）上会把逗号插到新项之后，产出非法 JSONC。已修（两个编辑落在同一偏移时合并为一次插入）。
- `loadSidecar` 现在把**未知 `version`** 也判为读不到（此前会当作有效记录），`list` 对损坏的 sidecar 会给出提示而不是静默忽略。

### 变更

- `list` 只解析目标配置一次（`resolveTargetConfig` 带出已解析文档），不再二次读盘。
- `globMatch` 加无通配快路径与有界正则缓存（上限 256），`strictValidate` 改为按 token 偏移拼接。
- 删除死代码 `findBroaderDenyInRules`，去掉 `disable` / `enable` / `list` 里的重复取值与 O(n²) 去重。

### 测试

- 断言数 175 → **245**，新增 N1–N14：ask 校验回归（改前跑红）、ask 正向、agent 覆盖 ask 的边界、deny 不回归、单行改动逐字节、BOM+CRLF+中文注释往返、sidecar 损坏、配置极端形状、marker 干扰、幂等、写入失败路径、性能闸门、`npm pack` 内容与 `exports` 可解析、安装副本逐字节一致。
- 新增 H 段（性能闸门：29 skills × 12 agents × 10 rules 下 `list` < 25 ms）与 I 段（发布闸门）。

### 性能

同一台机器、同一夹具（13.6 KB 配置，29 skills × 12 agents × 10 rules，取 60 次中位数）：`list` **3.72 ms → 2.24 ms**（1.66×，−1.48 ms）。

## 0.2.0 — 2026-10-20

- `list` 的 `state` 列改为按**调用者 agent** 求值（此前合并所有 agent 的规则，会把子 agent 的 `deny` 泄漏给调用者，本机曾把 29 个里的 28 个误报成 disabled）。
- `enable` 的定位判据放宽：标记注释即可，不再要求 sidecar 有记录。
- 备份降到 1 份（配置文件含凭据），写入改为原子写。

## 0.1.0 — 2026-10-19

- 首个发布版本：`list` / `inspect` / `disable` / `enable`（含 `ask` 软停用与 `dryRun`）。
