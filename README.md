# opencode-skill-management

OpenCode V2 的 `skill_management` 工具：**列出 / 诊断 / 停用 / 恢复**已安装的 skill。

停用的实现方式是往全局配置的 `permissions` 数组写一条 `skill` 规则（`effect: "deny"`），
它会让该 skill 从模型可见列表里消失、并拒绝加载 —— **不动任何 skill 文件**。

> 当前状态：**设计阶段**。本仓库目前只有规范与可行性评测，尚未实现。

## 目录

```
.openchamber/plans/
  skill-management-spec.md     实现规范（最可行版本）
  feasibility-review.md        对原始设计稿的逐条可行性评测与证据
  original-spec-v2.md          原始设计稿（未改动，留档）
```

计划同时以 OpenChamber 计划面板的形式呈现（本仓库的 `.openchamber/plans/` 即面板的「仓库计划」目录）。

## 读法

- 想知道「这东西到底能不能做、依据是什么」→ 先看 `feasibility-review.md`。
- 想动手实现 → 看 `skill-management-spec.md`，其中 `[待实测]` 的项是必须先跑通的两三个 preflight。

## 关键事实（来自本机 OpenCode 2.0.32 源码）

- 规则形状：`{ "action": "skill", "resource": "<skill id>", "effect": "deny" }`，写在全局配置顶层 `permissions` 数组里。
- 求值：`findLast` + glob 匹配，agent 规则集里配置写入的规则排在默认值之后 → 全局 deny 生效。
- 效果：既从注入给模型的可用 skill 列表里过滤掉，也让内置 `skill` 工具的权限断言抛错。
- 载体：本地插件 `{ id, setup(ctx) }`，在 `setup` 里用 `ctx.tool.transform(editor => editor.add({...}))` 注册工具。

细节与出处全部记在 `feasibility-review.md`。
