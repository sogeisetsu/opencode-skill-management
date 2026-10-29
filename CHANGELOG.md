# Changelog

本文件记录对外可见的变化。版本遵循语义化版本；1.x 内的兼容承诺见 README「兼容性与边界」。

## 1.1.0 — 2026-10-30

**破坏性变更**：四个动作的输出从 Markdown 改为单个 JSON 对象。动作、入参、写入的规则形状、
行尾标记与单文件结构都没变；这是 1.1.0 唯一的破坏性变更。

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
