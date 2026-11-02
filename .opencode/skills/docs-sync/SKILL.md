---
name: docs-sync
description: 本仓库（opencode-skill-management）文档与代码事实核对：只读采集 → 逐项比对 → 只改文档 → 跑门禁 → 分支小步提交（不 push）。由 /docs-sync 命令点名加载。
metadata:
  opencode/autoinvoke: false
---

# docs-sync

核对这个仓库里**文档描述的事实**与**代码/配置里的实际状态**是否一致，把偏差改在文档里。
不要顺手改代码：这份流程的产出是文档修正 + 一个可复核的提交。

## 适用前提

- 只适用于本仓库（`opencode-skill-management`）。当前目录不是这个仓库（`package.json` 的 `name`
  对不上）就停下说明，别套用。
- 用户消息里可能还带了额外要求（例如「只核对 site/」「只出报告别改文件」）：**以那条为准**，
  它优先于本流程的默认行为。没有额外要求就做全量核对。

## 硬边界（不可越）

- **停在 commit，不 push**：不做 `git push`、不推 tag、不建 Release。
- 不改 `src/`、`tools/`、`.github/`。发现代码与文档不一致时，改文档；除非文档描述的是**契约**
  （例如 README 的兼容承诺），那就只报告，不动任何一方。
- 不写 `<config>/opencode.jsonc`，绝不写 `opencode.managed.json`。
- 不碰任何 skill 文件（不移动、不删、不改 `SKILL.md` frontmatter），包括本 skill。
- 不新增依赖、不改部署配置（`base`、`site/scripts/check-dist.mjs` 的校验口径）。

## 一、只读采集事实

逐项读，不要凭记忆：

1. `package.json`：`name`、`version`、`files`、`exports`、`scripts`、`engines`、有无 `dependencies`。
2. `src/skill_management.js`：`PLUGIN_VERSION`、`TOOL_NAME`、`OUTPUT_SCHEMA_VERSION`、
   `OUTPUT_SCHEMA.required` 与 `properties`、`INPUT_SCHEMA.properties.action.oneOf` 的四个动作、
   所有 `error.code` 字面量（`failResult(action, code, ...)` 的第二个参数）、`DESCRIPTION` 里给出的承诺。
3. `tools/verify.mjs`：`section("...")` 的段标题（A–? 实际有哪几段）、跑一遍
   `node tools/verify.mjs` 拿**当前断言总数**与是否全绿。
4. `tools/install.mjs`：支持的 flags（`--check` / `--dry-run` / `--uninstall` / `--npm` / `--force`
   / `--json`）、退出码、`<config>` 解析顺序。
5. `CHANGELOG.md`：最新版本号与「未发布」段是否为空；最新 `docs/releases/*.zh-CN.md` 是否与
   实际发的版本对得上。
6. `README.md`：行数、提到的断言数/段范围/版本号。
7. `site/astro.config.mjs` 的 `sidebar` 与 `site/src/content/docs/**`：
   en 与 zh-cn 是否成对、sidebar 是否漏挂页面、注释里的页数是否正确。

## 二、逐项比对

至少覆盖这些**易漂移**的点（每项都要落到具体文件与行）：

- 断言总数、段范围（A–J）在 README / CHANGELOG / site 各页是否一致。
- 版本号在 `package.json`、`PLUGIN_VERSION`、README、site 的 compatibility 页是否一致。
- 四个动作的入参、输出字段、`error.code` 与 `site/.../actions/*.md`（英中两份）是否一致。
- `OUTPUT_SCHEMA` 声明了但文档没写、或文档写了但 schema 没有的字段。
- `npm pack` 内容描述与实际 `files`/`exports` 是否一致。
- 安装 flags、退出码、`<config>` 解析顺序是否与 `tools/install.mjs` 一致。
- 新增/删除页面后：sidebar 条目、`site/astro.config.mjs` 里的页数注释、
  以及 README 里指向文档站的链接是否仍然有效。
- 「未发布」段里写的事情是否真的已经在代码里（写过就算，不要求发版）。

## 三、输出偏差清单

先给一张表，再动文件：

```text
文件:行 | 现状 | 应改成什么 | 依据（哪个文件/命令的输出）
```

「依据」必须是**实际读到的内容或命令输出**，不能是推断。拿不到证据的条目标「未验证」，不要改。

## 四、只改文档

允许改：`README.md`、`CHANGELOG.md`、`site/**`、`docs/**`、`.openchamber/plans/**` 里**描述性**的
文字。不允许改代码、CI、依赖、部署配置。

- 中英两份要同步改；新增页面还要进 `astro.config.mjs` 的 sidebar，并更新页数注释。
- 不改已发布版本的 CHANGELOG 条目（历史记录），除非是补一条明确的「更正」说明。
- 文档里的命令要能直接复制运行，路径用仓库相对路径。

## 五、跑门禁

```pwsh
node tools/verify.mjs        # 全绿，记录断言总数
npm run docs:build
npm run docs:check           # 路由镜像 / 死链 / 语言切换
node tools/install.mjs --check
```

任何一项红了就先修文档（不要靠放宽断言或删页面变绿），仍红则停下报告完整输出。

## 六、分支与小步提交

```pwsh
git branch --show-current    # 若在 main，先切分支
git switch -c docs/sync-<YYYY-MM-DD>
```

按主题拆成小提交（例如「断言数同步」「安装 flags 同步」「新增页进 sidebar」），每条消息写清
改了哪个事实、依据是什么。**提交完即停**：把 `git log --oneline` 与偏差清单一起报告，等用户决定是否 push。

## 报告格式

四段都要有，缺段等于没做完：

1. 偏差清单（表；没偏差就写「无」）。
2. 实际改动（文件列表 + 每个文件一句话）。
3. 门禁的真实输出摘要（断言总数、`docs:check` 的路由数、`install --check` 的结论）。
4. 未验证项与建议（例如需要真机才能确认的行为）。
