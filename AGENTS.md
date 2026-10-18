# AGENTS.md

本仓库是 OpenCode V2 `skill_management` 工具的**设计仓库**（规范 + 可行性评测），实现尚未开始。

## 职责边界（硬约束）

- 本工具**只**改全局配置里的一条 skill permission 规则；不装、不删、不移动、不改写任何 skill 文件，不碰 SKILL.md frontmatter。
- 只读报告、不代改的旁路机制：agent 级 `agents.<id>.permissions`、`policies` / `experimental.policies` 的 `integration.use`。
- 写配置必须：先备份 → 最小文本编辑（保留注释/缩进/键顺序）→ 回读校验 → 失败回滚。禁止 parse → 序列化 → 回写。
- 工具本体纯 Node 内置模块，不引入第三方依赖，不调用 shell。

## 仓库结构

```
.openchamber/plans/skill-management-spec.md   实现规范（唯一权威）
```

`.openchamber/plans/` 是 OpenChamber 的「仓库计划」目录（面板里 source = shared）。改规范就是改这里的文件。

规范里每条关键结论都内联标注了出处与 **已证实 / 待实测**；**没有证据的结论不要写进规范**，标 `[待实测]` 并给退路。

## 环境基线

- OpenCode V2（本机 **2.0.32**）。规范里的结论都基于该版本，升级后需重新核对。
- Windows + PowerShell 7。命令示例用 pwsh。

## 有用的只读核查命令

```pwsh
opencode debug paths     # home / config / data / cache / state 的实际解析
opencode debug config    # 全部配置文档及解析结果
opencode plugin list     # 已加载插件与 source（local / package）
```

注意：这些子命令默认连的是**正在运行的 opencode/OpenChamber 服务**，不是新进程。

## 写文档的约定

- 中文正文，代码/命令/路径/标识符保持原文。
- 每条关键结论标注 **已证实 / 未证实**，并给出出处（源码位置、类型定义、实跑命令）。
- 别把密钥、token、本机私有配置内容写进仓库。
