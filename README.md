# opencode-skill-management

OpenCode V2 的 `skill_management` 工具：**列出 / 诊断 / 停用 / 恢复**已安装的 skill。

停用的实现方式是往全局配置的 `permissions` 数组写一条 `skill` 规则（`effect: "deny"`），
它会让该 skill 从模型可见列表里消失、并拒绝加载 —— **不动任何 skill 文件**。

> 状态：**已实现并已在本机 OpenCode 2.0.32 上完整验收通过**（含写真实全局配置的 §7(4)(5)(6)(7)，配置已逐字节还原）。

## 目录

```
src/skill_management.js                       插件本体（单文件，纯 Node 内置模块）
tools/install.mjs                             安装到 <config>/plugins/
tools/verify.mjs                              可重复跑的验收脚本（136 项断言）
docs/preflight.md                             preflight 实测结果 + 实现期发现的宿主坑
.openchamber/plans/skill-management-spec.md   实现规范（唯一权威，v4）
```

## 安装

```pwsh
node tools/install.mjs          # 复制到 <config>/plugins/skill_management.js
node tools/install.mjs --dry-run
```

宿主会自动加载 `<config>/plugins/*.js`（`plugin` 与 `plugins` 两种目录名都扫，已实测）。
确认：

```pwsh
opencode plugin list --builtin
# skill_management    local    C:\Users\suyue\.config\opencode\plugins\skill_management.js
```

## 验收

```pwsh
node tools/verify.mjs           # 136 项断言，全部跑在临时配置目录，不触碰真实全局配置
node tools/verify.mjs --keep    # 保留临时目录（排查用）
```

覆盖：模块形状与纯度 · glob/权限求值 · id 推导与来源归类 · JSONC 最小文本编辑（含 CRLF/BOM/严格校验）·
端到端 disable/dryRun/enable（含备份、sidecar、回读校验、拒绝分支、空块清理、跨 agent 回归）。

## 工具用法

```
skill_management({ action: "list" })
skill_management({ action: "inspect", id: "windows-shell" })
skill_management({ action: "disable", id: "windows-shell" })
skill_management({ action: "disable", id: "windows-shell", dryRun: true })
skill_management({ action: "disable", id: "windows-shell", effect: "ask" })   # 软停用
skill_management({ action: "enable",  id: "windows-shell" })
```

`id` 是主键（宿主注册表直接给），`name` 可作别名；重名时返回候选而不猜。

## 关键事实（来自本机 OpenCode 2.0.32 源码 / 实测）

- 规则形状：`{ "action": "skill", "resource": "<skill id>", "effect": "deny" }`，写在全局配置顶层 `permissions` 数组里。
- 求值：`findLast` + glob 匹配（`*` / `?`），**无命中时宿主回退 `ask`（不是 `allow`）**。
- 效果：既从注入给模型的可用 skill 列表里过滤掉，也让内置 `skill` 工具的权限断言抛错。
- 载体：本地插件 `{ id, setup(ctx) }`，在 `setup` 里用 `ctx.tool.transform(editor => editor.add({...}))` 注册工具。
- **`ctx.skill.list()` / `ctx.agent.list()` 返回 `{ location, data }` 信封，不是数组**；真正的注册表数组要走
  `ctx.<domain>.transform(draft => draft.list())`。详见 `docs/preflight.md`。
- 归属判定：`enable` **要求 sidecar 里有该 id 的记录**（否则一律拒绝，fail-closed）；sidecar 有记录时用同行尾标记注释
  `// skill_management` 精确定位本工具写的那一条（标记被剥掉时才退回"唯一完全匹配"并告警），绝不删用户手写的规则。
- 注册表项自带 `id` 时直接用；**没有 `id` 时**按 §3.5 从 `path`/`location` 反推，`inspect` 会写出反推过程，`list` 会在统计行下注明数量。
