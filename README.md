# opencode-skill-management

OpenCode V2 的 `skill_management` 工具：**列出 / 诊断 / 停用 / 恢复**已安装的 skill。

停用的实现方式是往全局配置的 `permissions` 数组写一条 `skill` 规则（`effect: "deny"`），
它会让该 skill 从模型可见列表里消失、并拒绝加载 —— **不动任何 skill 文件**。

> 当前状态：**设计阶段**。本仓库目前只有规范，尚未实现。

## 目录

```
.openchamber/plans/skill-management-spec.md   实现规范（唯一权威）
```

`.openchamber/plans/` 是 OpenChamber 的「仓库计划」目录，所以这份规范同时出现在 OpenChamber 的计划面板里。

## 关键事实（来自本机 OpenCode 2.0.32 源码）

- 规则形状：`{ "action": "skill", "resource": "<skill id>", "effect": "deny" }`，写在全局配置顶层 `permissions` 数组里。
- 求值：`findLast` + glob 匹配，agent 规则集里配置写入的规则排在默认值之后 → 全局 deny 生效。
- 效果：既从注入给模型的可用 skill 列表里过滤掉，也让内置 `skill` 工具的权限断言抛错。
- 载体：本地插件 `{ id, setup(ctx) }`，在 `setup` 里用 `ctx.tool.transform(editor => editor.add({...}))` 注册工具。
