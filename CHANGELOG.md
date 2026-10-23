# Changelog

本文件记录对外可见的变化。版本遵循语义化版本；1.x 内的兼容承诺见 README「兼容性与边界」。

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
