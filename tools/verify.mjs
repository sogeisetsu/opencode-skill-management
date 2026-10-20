#!/usr/bin/env node
/**
 * skill_management 验收脚本（可重复跑）
 *
 *   node tools/verify.mjs            # 全部测试
 *   node tools/verify.mjs --keep     # 不删除临时目录（排查用）
 *
 * 覆盖：
 *  A 模块形状 / 纯度（无第三方依赖、无 shell）
 *  B glob 与权限求值（findLast + 无命中回退 ask）
 *  C id 推导 / 来源与 scope 归类
 *  D JSONC 最小文本编辑（新增/删除/新建块/CRLF/BOM/严格校验）
 *  E 端到端：在临时配置目录上跑 disable / dryRun / enable，含备份、sidecar、回读校验、拒绝分支
 *
 * 本脚本**不触碰**真实全局配置：整个 E 组跑在临时 <config>/opencode 下。
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const srcFile = path.join(repoRoot, "src", "skill_management.js")

const mod = await import(new URL("../src/skill_management.js", import.meta.url))

let pass = 0
const failures = []

// 只跑某一段：node tools/verify.mjs --section F   （按段落标题做前缀匹配，大小写不敏感）
const onlySection = (() => {
  const i = process.argv.indexOf("--section")
  if (i < 0) return null
  const v = String(process.argv[i + 1] ?? "").trim().toUpperCase()
  return v === "" ? null : v
})()
let active = onlySection === null

function ok(name, cond, detail) {
  if (!active) return
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`)
  }
}
function section(title) {
  if (onlySection) active = title.trim().toUpperCase().startsWith(onlySection)
  console.log(`\n${title}${onlySection && !active ? "   (skipped by --section)" : ""}`)
}

/** 严格 JSON 解析（先剥掉行注释与块注释） */
function parseStrict(text) {
  const chars = [...text]
  const re = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g
  let m
  while ((m = re.exec(text))) {
    for (let i = m.index; i < m.index + m[0].length; i++) if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " "
  }
  return JSON.parse(chars.join(""))
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sm-verify-"))
const keep = process.argv.includes("--keep")

// 让插件把临时目录当成 <config>：插件内部用默认参数读 process.env
process.env.XDG_CONFIG_HOME = path.join(tmpRoot, "xdg")
const tmpConfigDir = path.join(tmpRoot, "xdg", "opencode")
fs.mkdirSync(tmpConfigDir, { recursive: true })

// ─────────────────────────────────────────────────────────────
// A. 模块形状 / 纯度
// ─────────────────────────────────────────────────────────────
section("A 模块形状 / 纯度")
{
  const d = mod.default
  ok("default export 有 id", d && d.id === "skill_management", `实际 ${d && d.id}`)
  ok("default export 有 setup 函数", d && typeof d.setup === "function")

  const source = fs.readFileSync(srcFile, "utf8")
  const imports = [...source.matchAll(/^\s*import\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1])
  ok("只 import node: 内置模块", imports.every((i) => i.startsWith("node:")), imports.join(", "))
  ok("不引用 child_process / worker_threads", !/child_process|worker_threads/.test(source))
  ok("不调用 shell / eval", !/\bexecSync\b|\bspawnSync\b|\bspawn\(|\beval\s*\(|new Function\s*\(/.test(source))
  ok("不引入第三方依赖（package.json 无 dependencies）", (() => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"))
    return !pkg.dependencies || Object.keys(pkg.dependencies).length === 0
  })())
}

// ─────────────────────────────────────────────────────────────
// B. glob 与权限求值
// ─────────────────────────────────────────────────────────────
section("B glob 与权限求值")
{
  ok("glob * 匹配任意", mod.globMatch("*", "anything") && mod.globMatch("*", ""))
  ok("glob 前缀通配", mod.globMatch("grill*", "grill-me") && !mod.globMatch("grill*", "me-grill"))
  ok("glob ? 单字符", mod.globMatch("a?c", "abc") && !mod.globMatch("a?c", "ac"))
  ok("glob 对正则元字符转义", mod.globMatch("a.b", "a.b") && !mod.globMatch("a.b", "axb"))

  const base = [{ action: "*", resource: "*", effect: "allow" }]
  ok("无规则命中回退 ask（不是 allow）", mod.stateOf([], "x").effect === "ask")
  ok("规则集首条 allow → 结果为 allow", mod.stateOf(base, "x").effect === "allow")
  ok(
    "追加的 deny 覆盖更早的 allow（findLast）",
    mod.stateOf([...base, { action: "skill", resource: "grill-me", effect: "deny" }], "grill-me").effect === "deny",
  )
  ok(
    "只影响目标 id",
    mod.stateOf([...base, { action: "skill", resource: "grill-me", effect: "deny" }], "other").effect === "allow",
  )
  ok(
    "更宽的 deny 也能覆盖（resource:*）",
    mod.stateOf([...base, { action: "skill", resource: "*", effect: "deny" }], "anything").effect === "deny",
  )
  ok(
    "ask 可被求值",
    mod.stateOf([...base, { action: "skill", resource: "x", effect: "ask" }], "x").effect === "ask",
  )
}

// ─────────────────────────────────────────────────────────────
// C. id 推导 / 来源与 scope 归类
// ─────────────────────────────────────────────────────────────
section("C id 推导 / 来源与 scope 归类")
{
  const root = path.join(tmpRoot, "roots")
  ok("root/foo.md → foo", mod.deriveId(path.join(root, "foo.md"), root) === "foo")
  ok("root/foo/SKILL.md → foo", mod.deriveId(path.join(root, "foo", "SKILL.md"), root) === "foo")
  ok("root/a/b/SKILL.md → b", mod.deriveId(path.join(root, "a", "b", "SKILL.md"), root) === "b")

  const home = path.join(tmpRoot, "home")
  const env = { XDG_CONFIG_HOME: path.join(home, ".config") }
  ok(
    "config 来源：<config>/skills/...",
    mod.classifySource(path.join(home, ".config", "opencode", "skills", "x", "SKILL.md"), env, home) === "config",
  )
  ok(
    "claude 来源：~/.claude/skills/...",
    mod.classifySource(path.join(home, ".claude", "skills", "x", "SKILL.md"), env, home) === "claude",
  )
  ok(
    "agents 来源：~/.agents/skills/...",
    mod.classifySource(path.join(home, ".agents", "skills", "x", "SKILL.md"), env, home) === "agents",
  )
  ok(
    "catalog 来源：<cache>/skills/<hash>/...",
    mod.classifySource(path.join(home, ".cache", "opencode", "skills", "abc123", "SKILL.md"), env, home) === "catalog",
  )
  ok("embedded 来源：/builtin/...", mod.classifySource("/builtin/report.md", env, home) === "embedded")
  ok(
    "scope=user 在家目录下",
    mod.classifyScope(path.join(home, ".config", "opencode", "skills", "x", "SKILL.md"), home) === "user",
  )
  ok("scope=project 在家目录外", mod.classifyScope(path.join(tmpRoot, "elsewhere", "SKILL.md"), home) === "project")
}

// ─────────────────────────────────────────────────────────────
// D. JSONC 最小文本编辑
// ─────────────────────────────────────────────────────────────
section("D JSONC 最小文本编辑")
{
  const WITH_ARRAY =
    '{\n' +
    '  // 顶层注释，必须保留\n' +
    '  "$schema": "https://opencode.ai/config.json",\n' +
    '  "shell": "pwsh",\n' +
    '  "permissions": [\n' +
    '    { "action": "bash", "resource": "*", "effect": "allow" }\n' +
    '  ]\n' +
    '}\n'

  const r1 = mod.insertRule(WITH_ARRAY, "grill-me", "deny")
  ok("追加：结果严格合法", (() => { try { mod.strictValidate(r1.text); return true } catch { return false } })())
  ok("追加：未新建块", r1.createdBlock === false)
  ok("追加：保留注释", r1.text.includes("// 顶层注释，必须保留"))
  ok("追加：保留既有规则", r1.text.includes('{ "action": "bash", "resource": "*", "effect": "allow" }'))
  ok("追加：带归属标记", r1.text.includes(`{ "action": "skill", "resource": "grill-me", "effect": "deny" } // skill_management`))
  const origLines = WITH_ARRAY.split("\n")
  const newLines = r1.text.split("\n")
  ok("追加：只多出 1 行", newLines.length === origLines.length + 1, `行数 ${newLines.length} vs ${origLines.length}`)
  // 去掉新增的那一行后，应与原文件只在一行上不同（上一项末尾多了逗号）
  const insertedIdx = newLines.findIndex((l) => l.includes("// skill_management") && l.includes("grill-me"))
  const restored = [...newLines]
  if (insertedIdx >= 0) restored.splice(insertedIdx, 1)
  const commonDiffs = restored.map((l, i) => [origLines[i], l]).filter(([a, b]) => a !== b)
  ok("追加：能识别新增行", insertedIdx >= 0)
  ok("追加：去掉新增行后长度还原", restored.length === origLines.length)
  ok("追加：原有行里恰好一行被改动", commonDiffs.length === 1, JSON.stringify(commonDiffs))
  ok("追加：那一行只是末尾加了一个逗号", commonDiffs.length === 1 && commonDiffs[0][1] === commonDiffs[0][0] + ",", JSON.stringify(commonDiffs[0]))

  const r2 = mod.insertRule(r1.text, "other-skill", "ask")
  mod.strictValidate(r2.text)
  ok("第二条追加：合法且两条都在", r2.text.includes('"resource": "grill-me"') && r2.text.includes('"resource": "other-skill"'))
  ok("第二条追加：第一条标记仍在", (r2.text.match(/\/\/ skill_management/g) || []).length === 2)

  const noPerm = '{\n  "$schema": "https://opencode.ai/config.json",\n  "shell": "pwsh"\n}\n'
  const r3 = mod.insertRule(noPerm, "grill-me", "deny")
  mod.strictValidate(r3.text)
  ok("新建块：报告 createdBlock", r3.createdBlock === true)
  ok("新建块：含 permissions 键", /"permissions": \[/.test(r3.text))
  ok("新建块：保留原有键", r3.text.includes('"shell": "pwsh"'))

  const emptyArray = '{\n  "permissions": []\n}\n'
  const r4 = mod.insertRule(emptyArray, "grill-me", "deny")
  mod.strictValidate(r4.text)
  ok("空数组：插入后合法且只有一条", JSON.parse(r4.text.replace(/\/\/[^\n]*/g, "")).permissions.length === 1)

  // 删除：末条（无自己的逗号）、中间条、以及标记保留
  const three = mod.insertRule(mod.insertRule(WITH_ARRAY, "a-skill", "deny").text, "b-skill", "deny").text
  const itemB = mod.findMarkedItem(three, "b-skill")
  ok("删除：能定位带标记的项", Boolean(itemB))
  const delB = mod.removeRuleByLine(three, itemB)
  mod.strictValidate(delB)
  ok("删除末条：目标消失", !delB.includes('"b-skill"'))
  ok("删除末条：前一条在", delB.includes('"a-skill"'))
  ok("删除末条：前一条的标记保留且只出现一次", (delB.match(/\/\/ skill_management/g) || []).length === 1)
  ok(
    "删除末条：前一条的标记仍挂在它自己那一行",
    delB.split("\n").some((l) => l.includes('"a-skill"') && l.includes("// skill_management")),
    JSON.stringify(delB),
  )
  ok("删除末条：无悬空逗号（严格校验通过）", (() => { try { mod.strictValidate(delB); return true } catch { return false } })())

  const itemA = mod.findMarkedItem(delB, "a-skill")
  const delA = mod.removeRuleByLine(delB, itemA)
  mod.strictValidate(delA)
  ok("删除中间条：合法且仅剩原规则", !delA.includes("a-skill") && delA.includes('"action": "bash"'))

  // CRLF / BOM 保留
  const crlf = WITH_ARRAY.replace(/\n/g, "\r\n")
  const rCrlf = mod.insertRule(crlf, "x", "deny")
  ok("CRLF：插入后仍是全 CRLF", !/[^\r]\n/.test(rCrlf.text), "发现了裸 LF")

  const bomFile = path.join(tmpRoot, "bom.jsonc")
  mod.writeTextFile(bomFile, WITH_ARRAY, true)
  const read = mod.readTextFile(bomFile)
  ok("BOM：读回识别", read.bom === true && !read.text.startsWith("\ufeff"))
  mod.writeTextFile(bomFile, read.text + "", read.bom)
  ok("BOM：写回保留", fs.readFileSync(bomFile)[0] === 0xef)

  // 非法输入必须中止而不是乱写
  ok("根不是对象 → 抛错", (() => { try { mod.insertRule("[1,2]", "x", "deny"); return false } catch { return true } })())
  ok("permissions 不是数组 → 抛错", (() => { try { mod.insertRule('{\n  "permissions": {}\n}', "x", "deny"); return false } catch { return true } })())
}

// ─────────────────────────────────────────────────────────────
// D2. §4.1 目标文件解析（纯函数，用假 env/home，不碰真实目录）
// ─────────────────────────────────────────────────────────────
section("D2 §4.1 目标文件解析")
{
  const fakeHome = path.join(tmpRoot, "fakehome")
  const xdgConfig = path.join(tmpRoot, "xdgcfg", "opencode")
  const homeConfig = path.join(fakeHome, ".config", "opencode")
  const env = { XDG_CONFIG_HOME: path.join(tmpRoot, "xdgcfg") }
  fs.mkdirSync(xdgConfig, { recursive: true })
  fs.mkdirSync(homeConfig, { recursive: true })
  const mk = (f, withPerms) =>
    fs.writeFileSync(
      f,
      withPerms
        ? '{\n  "permissions": [\n    { "action": "bash", "resource": "*", "effect": "allow" }\n  ]\n}\n'
        : '{\n  "shell": "pwsh"\n}\n',
      "utf8",
    )

  // 1) 都不存在 → 新建 <config>/opencode.jsonc
  {
    const r = mod.resolveTargetConfig(env, fakeHome)
    ok("§4.1 无任何配置 → 目标为 <config>/opencode.jsonc", r.file === path.join(xdgConfig, "opencode.jsonc"), r.file)
    ok("§4.1 无任何配置 → 标记为将新建", r.notes.join(" ").includes("将新建"))
  }

  // 2) 只有 json → 选 json
  mk(path.join(xdgConfig, "opencode.json"), false)
  {
    const r = mod.resolveTargetConfig(env, fakeHome)
    ok("§4.1 只有 opencode.json → 选它", r.file === path.join(xdgConfig, "opencode.json"), r.file)
  }

  // 3) json + jsonc 都在 → jsonc 优先（取最后一个已存在的）
  mk(path.join(xdgConfig, "opencode.jsonc"), false)
  {
    const r = mod.resolveTargetConfig(env, fakeHome)
    ok("§4.1 json 与 jsonc 都在 → 选 jsonc", r.file === path.join(xdgConfig, "opencode.jsonc"), r.file)
  }

  // 4) 只有 ~/.config/opencode 那侧含 permissions → 选它（即使 XDG 侧也有文件）
  mk(path.join(homeConfig, "opencode.jsonc"), true)
  {
    const r = mod.resolveTargetConfig(env, fakeHome)
    ok(
      "§4.1 只有家目录侧含 permissions → 选含权限那份",
      r.file === path.join(homeConfig, "opencode.jsonc"),
      r.file,
    )
    ok("§4.1 该情形标记 hadPermissions", r.hadPermissions === true)
  }

  // 5) 两侧都含 permissions → 写 ~/.config/opencode 下的（规范 §4.1 的实测提醒）并给出说明
  mk(path.join(xdgConfig, "opencode.jsonc"), true)
  {
    const r = mod.resolveTargetConfig(env, fakeHome)
    ok("§4.1 两侧都有权限配置 → 取 ~/.config/opencode 那份", r.file === path.join(homeConfig, "opencode.jsonc"), r.file)
    ok("§4.1 两侧都有时输出说明", r.notes.join(" ").includes("都含权限配置"), r.notes.join(" | "))
  }

  // 6) XDG 与家目录相同时不重复考虑
  {
    const sameEnv = { XDG_CONFIG_HOME: path.join(fakeHome, ".config") }
    const r = mod.resolveTargetConfig(sameEnv, fakeHome)
    ok("§4.1 家目录=XDG 时不重复列出目录", r.configDirs.length === 1, JSON.stringify(r.configDirs))
  }
}

// ─────────────────────────────────────────────────────────────
// E. 端到端：disable / dryRun / enable（临时配置目录）
// ─────────────────────────────────────────────────────────────
section("E 端到端（临时配置目录，不触碰真实配置）")

const CFG = path.join(tmpConfigDir, "opencode.jsonc")
const ORIGINAL =
  '{\n' +
  '  // 本文件由 verify.mjs 的夹具创建\n' +
  '  "$schema": "https://opencode.ai/config.json",\n' +
  '  "shell": "pwsh"\n' +
  '}\n'
fs.writeFileSync(CFG, ORIGINAL, "utf8")

const SENTINEL = "SENTINEL-BODY-MUST-NOT-LEAK"
// 注意：插件的 classifySource / classifyScope 用的是真实 env 与 os.homedir()，
// 所以这里用"真实家目录下的路径字符串"做夹具（只需路径匹配，文件不必存在）。
const REAL_HOME = os.homedir()
const skills = [
  { id: "grill-me", name: "grill-me", description: "Stress-test a plan\nsecond line", path: path.join(REAL_HOME, ".claude", "skills", "grill-me", "SKILL.md"), content: SENTINEL },
  { id: "windows-shell", name: "windows-shell", description: "Windows shell rules", path: path.join(tmpConfigDir, "skills", "windows-shell", "SKILL.md"), content: SENTINEL },
  { id: "agents-skill", name: "agents-skill", description: "from ~/.agents", path: path.join(REAL_HOME, ".agents", "skills", "agents-skill", "SKILL.md"), content: SENTINEL },
  { id: "cached-skill", name: "cached-skill", description: "from catalog cache", path: path.join(REAL_HOME, ".cache", "opencode", "skills", "deadbeef", "cached-skill", "SKILL.md"), content: SENTINEL },
  { id: "builtin-one", name: "OpenCode", description: "built in", path: "/builtin/opencode.md", content: SENTINEL },
]

function makeCtx(opts = {}) {
  const agents = [
    { id: "build", hidden: false, permissions: [] },
    { id: "plan", hidden: false, permissions: [] },
  ]
  if (opts.withTitleDeny) agents.push({ id: "title", hidden: true, permissions: [{ action: "*", resource: "*", effect: "deny" }] })
  const readRules = () => {
    try {
      const { text } = mod.readTextFile(CFG)
      const root = mod.parseJsonc(text)
      const perm = mod.findTopLevelProp(root, "permissions")
      if (!perm || perm.value.type !== "array") return []
      return perm.value.items
        .map((it) => {
          const g = (k) => mod.findTopLevelProp(it, k)?.value.value
          return { action: g("action"), resource: g("resource"), effect: g("effect") }
        })
        .filter((r) => r.action && r.resource && r.effect)
    } catch {
      return []
    }
  }
  const agentItems = () =>
    agents.map((a) => {
      // 真实宿主里 agent 的 permissions = [默认 allow, ...全局规则, ...agent 自有规则]，
      // agent 自有规则可能排在全局规则之后（本机 title/summary 的 {*,*,deny} 就是这样）。
      // 夹具必须保留 a.permissions，否则「别的 agent 全 deny」根本进不了注册表，回归用例会空跑。
      const own = Array.isArray(a.permissions) ? a.permissions : []
      return {
        ...a,
        permissions: [
          { action: "*", resource: "*", effect: "allow" },
          ...(opts.staleAgents ? [] : readRules()),
          ...own,
          ...(opts.agentRules?.[a.id] ?? []),
        ],
      }
    })

  const stats = { disposed: 0 }
  // 复刻真实宿主形状：transform 的 draft.list() 返回数组；list() 返回 { location, data } 信封
  const mkDomain = (itemsFn) => ({
    async transform(fn) {
      const draft = {
        list: () => (opts.envelopeOnly ? undefined : itemsFn()),
        get: () => undefined,
        add() {},
        update() {},
        remove() {},
      }
      await fn(draft)
      return {
        async dispose() {
          stats.disposed++
        },
      }
    },
    async list() {
      if (opts.arrayOnly) return itemsFn()
      return { location: { directory: process.cwd() }, data: itemsFn() }
    },
  })

  const skillItems = () => opts.skills ?? skills
  const ctx = {
    skill: mkDomain(skillItems),
    agent: mkDomain(agentItems),
    tool: {
      async transform(fn) {
        const tools = []
        fn({
          add: (t) => tools.push(t), list: () => tools, get: () => undefined,
          update: () => {}, remove: () => {}, namespace: () => {},
        })
        ctx.__tools = tools
      },
    },
    __stats: stats,
  }
  return ctx
}

async function callWith(opts, action, args = {}) {
  const ctx = makeCtx(opts)
  await mod.default.setup(ctx)
  const tool = ctx.__tools.find((t) => t.name === "skill_management")
  const res = await tool.execute({ action, ...args }, { agent: opts.callerAgentId ?? "build", sessionID: "test" })
  return { text: res.content, ctx }
}

async function call(action, args = {}) {
  return callWith({}, action, args)
}

{
  // 工具注册形态
  const { text: _t, ctx: _c } = await callWith({}, "list")
  const tool = _c.__tools.find((t) => t.name === "skill_management")
  ok("工具已注册且名为 skill_management", Boolean(tool))
  ok("options.codemode === false", tool.options && tool.options.codemode === false, JSON.stringify(tool.options))
  ok("input 是原生 JSON Schema（含 type:object）", tool.input && tool.input.type === "object")
  ok("input 不是 zod/函数（确实传了原生 JSON Schema）", typeof tool.input !== "function")
  ok("description 非空", typeof tool.description === "string" && tool.description.length > 40)
  ok("读取注册表后会 dispose 掉 transform 注册（不留 hook）", _c.__stats.disposed >= 2, `disposed=${_c.__stats.disposed}`)

  // 宿主形状兼容：只有 list() 信封 / 只有 list() 数组 / transform 可用
  {
    const env = await callWith({ envelopeOnly: true }, "list")
    ok("transform 不可用时，回退读 list() 的 { location, data } 信封", env.text.includes("grill-me") && !env.text.includes("❌"))
    const arr = await callWith({ arrayOnly: true }, "list")
    ok("list() 直接返回数组时也能读", arr.text.includes("grill-me"))
  }

  // list
  const list = (await call("list")).text
  ok("list 含表头列 id/source/scope/state/path", /id/.test(list) && /source/.test(list) && /scope/.test(list) && /state/.test(list) && /path/.test(list))
  ok("list 覆盖全部 5 个 skill", ["grill-me", "windows-shell", "agents-skill", "cached-skill", "builtin-one"].every((id) => list.includes(id)))
  ok(
    "list 正确标出来源（claude / config / agents / catalog / embedded）",
    ["claude", "config", "agents", "catalog", "embedded"].every((s) => list.includes(`| ${s} |`)),
    list,
  )
  ok("list 绝不输出正文", !list.includes(SENTINEL))
  ok("list description 只取首行", list.includes("Stress-test a plan") && !list.includes("second line"))
  ok("list 带统计行", /发现 5 个、已禁用 0 个、ask 0 个/.test(list))
  ok("list 打印目标配置文件路径", list.includes(CFG))
  ok("list 标明调用者 agent（state 列的作用域）", list.includes("调用者 agent：`build`"), list)

  // 回归：list 的 state 列只看调用者 agent 的规则集（规范 §3.6），不得合并所有 agent
  {
    const { text: t, ctx: c } = await callWith({ withTitleDeny: true }, "list")
    const items = (await c.agent.list()).data
    const title = items.find((a) => a.id === "title")
    const own = title && Array.isArray(title.permissions) ? title.permissions : []
    ok(
      "夹具：title 的 {*,*,deny} 真的进了注册表（旧夹具会覆盖掉它，回归用例等于空跑）",
      Boolean(title) && own.length > 0 && own[own.length - 1].effect === "deny",
      JSON.stringify(own),
    )
    ok("别的 agent 全 deny 不影响调用者：统计仍是 0 disabled", /发现 5 个、已禁用 0 个、ask 0 个/.test(t), t)
    ok("别的 agent 全 deny 时 state 列仍全是 available", (t.match(/\| available \|/g) ?? []).length === 5, t)
    ok("提示其它 agent 下的差异", t.includes("另有 5 个 skill 在其它 agent 下状态不同"), t)
  }
  {
    // 本机真实 bug 的最小复现：只有别的 agent（plan）deny，调用者（build）不该看到 disabled
    const t = (await callWith({ agentRules: { plan: [{ action: "skill", resource: "grill-me", effect: "deny" }] } }, "list")).text
    ok("只有别的 agent deny 某个 id 时，调用者仍是 available", /已禁用 0 个/.test(t) && !/\| grill-me \|[^\n]*\| disabled \|/.test(t), t)
  }
  {
    // 调用者自己的 deny 仍然算数
    const t = (await callWith({ agentRules: { build: [{ action: "skill", resource: "grill-me", effect: "deny" }] } }, "list")).text
    ok("调用者自己的 deny 仍然生效", /已禁用 1 个/.test(t) && /\| grill-me \|[^\n]*\| disabled \|/.test(t), t)
  }
  {
    const t = (await callWith({ callerAgentId: "ghost" }, "list")).text
    ok("拿不到调用者 agent 时显式告警（不静默顶替）", t.includes("未能确认调用者 agent"), t)
  }

  // inspect
  const insp = (await call("inspect", { id: "grill-me" })).text
  ok("inspect 报告 id/path/source/scope", insp.includes("grill-me") && insp.includes("SKILL.md") && insp.includes("claude"))
  ok("inspect 给出命中规则与逐 agent 结果", insp.includes("命中规则") && insp.includes("build"))
  ok("inspect 给出一句话结论", /\*\*结论\*\*/.test(insp))
  ok("inspect 不输出正文", !insp.includes(SENTINEL))
  const inspByName = (await call("inspect", { name: "windows-shell" })).text
  ok("inspect 支持 name 别名", inspByName.includes("按 name 别名匹配"))

  // dryRun 不得改文件
  const before = fs.readFileSync(CFG)
  const dry = (await call("disable", { id: "grill-me", dryRun: true })).text
  ok("dryRun 输出计划", dry.includes("dryRun：未写入任何文件"))
  ok(
    "dryRun 预览与实际将插入的内容一致",
    dry.includes(`"permissions": [`) && dry.includes(`{ "action": "skill", "resource": "grill-me", "effect": "deny" } // skill_management`),
    dry,
  )
  ok("dryRun 零字节变化", fs.readFileSync(CFG).equals(before))
  ok("dryRun 不产生 sidecar", !fs.existsSync(path.join(tmpConfigDir, "skill_management.state.json")))

  // disable
  const dis = (await call("disable", { id: "grill-me" })).text
  ok("disable 成功", dis.includes("✅"))
  const afterDisable = fs.readFileSync(CFG).toString("utf8")
  mod.strictValidate(afterDisable)
  ok("disable 后规则在文件里", afterDisable.includes('"resource": "grill-me", "effect": "deny"'))
  ok("disable 后带标记注释", afterDisable.includes("// skill_management"))
  ok(
    "disable 在原本没有 permissions 的配置上新建了块（新增 3 行）",
    /"permissions": \[/.test(afterDisable) && afterDisable.split("\n").length === ORIGINAL.split("\n").length + 3,
    `行数 ${afterDisable.split("\n").length} vs ${ORIGINAL.split("\n").length}`,
  )
  ok("disable 保留原有注释与键", afterDisable.includes("必须保留") === false && afterDisable.includes("夹具创建"))
  ok("disable 写了备份", fs.readdirSync(path.join(tmpConfigDir, "skill_management.backups")).length === 1)
  const side = JSON.parse(fs.readFileSync(path.join(tmpConfigDir, "skill_management.state.json"), "utf8"))
  ok("sidecar 结构 { version, rules[...] }", side.version === 1 && Array.isArray(side.rules) && side.rules[0].id === "grill-me")
  ok("sidecar 记录 id/effect/file/insertedAt", side.rules[0].effect === "deny" && path.resolve(side.rules[0].file) === path.resolve(CFG) && Boolean(side.rules[0].insertedAt))
  ok("disable 后被求值为 deny", mod.stateOf([{ action: "*", resource: "*", effect: "allow" }, { action: "skill", resource: "grill-me", effect: "deny" }], "grill-me").effect === "deny")

  // 重复 disable
  const dis2 = (await call("disable", { id: "grill-me" })).text
  ok("重复 disable 不重复写", dis2.includes("已经是停用状态") && fs.readFileSync(CFG).toString("utf8") === afterDisable)

  // list 现在应显示 disabled
  const list2 = (await call("list")).text
  ok("list 显示 disabled 计数", /已禁用 1 个/.test(list2))
  ok("list 的 state 列用 available/disabled（不是 allow/deny）", /\| disabled \|/.test(list2) && /\| available \|/.test(list2), list2)

  // enable
  const en = (await call("enable", { id: "grill-me" })).text
  ok("enable 成功", en.includes("✅"))
  ok("enable 后逐字节还原", fs.readFileSync(CFG).equals(Buffer.from(ORIGINAL, "utf8")))
  const side2 = JSON.parse(fs.readFileSync(path.join(tmpConfigDir, "skill_management.state.json"), "utf8"))
  ok("enable 后 sidecar 记录被移除", side2.rules.length === 0)

  // 回归：别的 agent（如内部 title）全 deny，不得因此拒绝给调用者写规则
  {
    cfgsWrite(ORIGINAL)
    const r = await callWith({ withTitleDeny: true }, "disable", { id: "windows-shell" })
    ok("不同 agent 的全 deny 不影响调用者（不会被误判为'已被更宽规则覆盖'）", r.text.includes("✅"), r.text)
    mod.strictValidate(fs.readFileSync(CFG).toString("utf8"))
    // 清理：撤销
    const back = await callWith({ withTitleDeny: true }, "enable", { id: "windows-shell" })
    ok("清理后还原", back.text.includes("✅") && fs.readFileSync(CFG).equals(Buffer.from(ORIGINAL, "utf8")))
  }

  // 调用者自己确实被更宽规则覆盖为 deny → 报覆盖、不写入
  {
    cfgsWrite('{\n  "permissions": [\n    { "action": "skill", "resource": "*", "effect": "deny" }\n  ]\n}\n')
    const r = await call("disable", { id: "windows-shell" })
    ok("调用者自己被更宽规则覆盖时报告覆盖，不写入", r.text.includes("已被更宽的规则覆盖"), r.text)
    ok("该情形下文件未变", fs.readFileSync(CFG).toString("utf8").includes('"resource": "*"'))
  }

  // 回滚路径：写后生效校验拿不到期望效果 → 必须回滚且文件字节不变
  {
    process.env.SKILL_MGMT_VERIFY_TIMEOUT_MS = "400"
    cfgsWrite(ORIGINAL)
    const before = fs.readFileSync(CFG)
    const r = await callWith({ staleAgents: true }, "disable", { id: "windows-shell" })
    ok("生效校验失败时报告失败并回滚", r.text.includes("回读校验失败") && r.text.includes("已回滚"), r.text)
    ok("回滚后文件逐字节不变", fs.readFileSync(CFG).equals(before))
    ok(
      "回滚后不写 sidecar 记录",
      !JSON.parse(fs.readFileSync(path.join(tmpConfigDir, "skill_management.state.json"), "utf8")).rules.some((r) => r.id === "windows-shell"),
    )
    delete process.env.SKILL_MGMT_VERIFY_TIMEOUT_MS
  }

  // §3.1/§4.4 一致性：sidecar 有记录但配置里已无对应规则 → 必须告警，且该 skill 显示为可用
  {
    cfgsWrite(ORIGINAL)
    mod.saveSidecar(tmpConfigDir, {
      rules: [{ id: "windows-shell", effect: "deny", file: CFG, insertedAt: new Date().toISOString(), createdBlock: true }],
    })
    const l = (await call("list")).text
    ok("sidecar 与配置不一致时必须告警", l.includes("⚠️ sidecar 与配置不一致"), l)
    ok("告警里点名了那个 skill", /sidecar 与配置不一致[\s\S]{0,300}windows-shell/.test(l))
    ok("该 skill 仍按实际规则集显示为 available", /\| windows-shell \|[^\n]*\| available \|/.test(l), l)
    ok("注册表漂移（情况 3）不再误报", !l.includes("已不在注册表里"))
    mod.saveSidecar(tmpConfigDir, { rules: [] })
  }

  // 反向漂移：配置里有 skill 规则但 sidecar 无记录 → 给提示
  {
    cfgsWrite('{\n  "permissions": [\n    { "action": "skill", "resource": "windows-shell", "effect": "deny" }\n  ]\n}\n')
    const l = (await call("list")).text
    ok("配置有规则而 sidecar 无记录时给出提示", l.includes("sidecar 里没有记录"), l)
    cfgsWrite(ORIGINAL)
  }

  // 恢复一份干净配置，供后续拒绝分支测试
  cfgsWrite('{\n  "permissions": []\n}\n')

  // 拒绝分支：注册表里存在、但规则是用户手写的（无标记、无 sidecar 记录）
  const handWritten = cfgsWrite(
    '{\n  "permissions": [\n    { "action": "skill", "resource": "windows-shell", "effect": "deny" }\n  ]\n}\n',
  )
  const refuse = (await call("enable", { id: "windows-shell" })).text
  ok("拒绝删除用户手写的规则", refuse.includes("拒绝执行"), refuse)
  ok("拒绝时给出待删规则原文", refuse.includes('"resource": "windows-shell"'))
  ok("拒绝时未改文件", fs.readFileSync(CFG).toString("utf8") === handWritten)

  // sidecar 有记录但标记被外部剥掉 → 删除并告警
  fs.writeFileSync(CFG, '{\n  "permissions": [\n    { "action": "skill", "resource": "grill-me", "effect": "deny" }\n  ]\n}\n', "utf8")
  mod.saveSidecar(tmpConfigDir, { rules: [{ id: "grill-me", effect: "deny", file: CFG, insertedAt: new Date().toISOString() }] })
  const en2 = (await call("enable", { id: "grill-me" })).text
  ok("标记缺失时按 sidecar 删除", en2.includes("✅"))
  ok("标记缺失时给出告警", en2.includes("⚠️"))
  mod.strictValidate(fs.readFileSync(CFG).toString("utf8"))

  // 未声明 output：结果对象里不能出现 output 键
  {
    const ctx = makeCtx()
    await mod.default.setup(ctx)
    const tool = ctx.__tools.find((t) => t.name === "skill_management")
    const res = await tool.execute({ action: "list" }, { agent: "build" })
    ok("返回对象只含 content/metadata，不含 output", !("output" in res))
  }
}

// 工具函数：写夹具并返回内容
function cfgsWrite(text) {
  fs.writeFileSync(CFG, text, "utf8")
  return text
}

// ─────────────────────────────────────────────────────────────
// F. 反推 id（注册表项无 id）与 enable 的归属边界 —— objective 明确要求的路径
// ─────────────────────────────────────────────────────────────
section("F 反推 id（§3.5）与 enable 归属边界")
{
  const root = path.join(tmpRoot, "froots")
  const noId = [
    { name: "foo-a", path: path.join(root, "foo.md"), description: "case A" },
    { name: "bar-b", path: path.join(root, "bar", "SKILL.md"), description: "case B" },
    { name: "baz-c", path: path.join(root, "a", "b", "SKILL.md"), description: "case C" },
    { name: "loc-d", location: path.join(root, "loc.md"), description: "location 字段" },
    { name: "noID-noPath", description: "既无 id 也无路径" },
  ]

  // 直接对 normalizeSkill 的等价物做断言：用 list 的输出来看
  const l = (await callWith({ skills: noId }, "list")).text
  ok("§3.5 反推：<root>/foo.md → foo", /\| foo \|/.test(l), l)
  ok("§3.5 反推：<root>/bar/SKILL.md → bar", /\| bar \|/.test(l))
  ok("§3.5 反推：<root>/a/b/SKILL.md → b", /\| b \|/.test(l))
  ok("location 字段（字符串）也被当作路径使用 → loc", /\| loc \|/.test(l))
  ok("既无 id 也无路径 → 显示为 (unknown)", /\| \(unknown\) \|/.test(l))
  ok("list 说明有几个 id 是反推来的", /其中 4 个 id 由路径反推/.test(l), l)
  ok("反推得到的 id 也能查状态（不是 unknown）", /\| foo \|[^\n]*\| available \|/.test(l) || /\| foo \|[^\n]*\| disabled \|/.test(l), l)

  // inspect 要报告"反推过程"
  const insp = (await callWith({ skills: noId }, "inspect", { id: "b" })).text
  ok("inspect：报告 id 来源为「由路径反推」", insp.includes("由路径反推"), insp.slice(0, 1200))
  ok("inspect：给出推导规则原文（SKILL.md → 取所在目录名）", insp.includes("取 SKILL.md 所在目录名"))
  ok("inspect：给出规则输入 dirname/basename", insp.includes("规则输入") && insp.includes("SKILL.md"))
  const inspLoc = (await callWith({ skills: noId }, "inspect", { id: "loc" })).text
  ok("inspect：报告使用的路径字段是 location", inspLoc.includes("`location`"))

  // 注册表自带 id 时不出现在"反推"计数里
  const l2 = (await call("list")).text
  ok("注册表自带 id 时不显示反推计数", !l2.includes("由路径反推"), l2)

  // §11.1：sidecar 丢失但标记还在 → **应当删除成功**（标记是文件内自证，优先于 sidecar）
  {
    cfgsWrite(ORIGINAL)
    const d = await call("disable", { id: "windows-shell" })
    ok("前置：disable 成功（带标记）", d.text.includes("✅"), d.text)
    mod.saveSidecar(tmpConfigDir, { rules: [] }) // 模拟 sidecar 丢失
    const e = await call("enable", { id: "windows-shell" })
    ok("sidecar 无记录但标记命中 → 删除成功（§11.1 新行为）", e.text.includes("✅"), e.text)
    ok("定位方式报告为标记注释", e.text.includes("标记注释"), e.text)
    ok("删除后逐字节还原", fs.readFileSync(CFG).equals(Buffer.from(ORIGINAL, "utf8")), fs.readFileSync(CFG).toString("utf8"))
    mod.saveSidecar(tmpConfigDir, { rules: [] })
  }
}

// ─────────────────────────────────────────────────────────────
// G. §11 变更：enable 判据放宽 / 备份 1 份 + 原子写 / description 硬化
// ─────────────────────────────────────────────────────────────
section("G §11 变更（enable 放宽 · 备份 1 份 + 原子写 · description）")
{
  const backupsDir = path.join(tmpConfigDir, "skill_management.backups")
  const backupCount = () => (fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).length : 0)

  // (a) 标记命中 → 删；成功输出必须报告来源与删除后的生效效果
  cfgsWrite(ORIGINAL)
  const d1 = await call("disable", { id: "windows-shell" })
  ok("G 前置：disable 成功", d1.text.includes("✅"), d1.text)
  ok("G 原子写不留下 .tmp 文件", !fs.existsSync(`${CFG}.tmp`), `${CFG}.tmp`)
  const e1 = await call("enable", { id: "windows-shell" })
  ok("G(a) 标记命中即删除", e1.text.includes("✅") && fs.readFileSync(CFG).equals(Buffer.from(ORIGINAL, "utf8")), e1.text)
  ok("G(a) 报告被删规则的来源", /被删规则的来源：本工具写入/.test(e1.text), e1.text)
  ok("G(a) 报告删除后的生效效果（调用者 agent）", /删除后的生效效果[\s\S]*`build`[\s\S]*allow/.test(e1.text), e1.text)
  ok("G 备份只保留 1 份（MAX_BACKUPS=1）", backupCount() === 1, `实际 ${backupCount()} 份：${fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).join(", ") : "(无)"}`)

  // 再写两次，备份仍只 1 份
  await call("disable", { id: "windows-shell" })
  await call("enable", { id: "windows-shell" })
  ok("G 多次写入后备份仍只有 1 份", backupCount() === 1, `实际 ${backupCount()} 份`)
  ok("G 多次写入后仍无 .tmp 残留", !fs.existsSync(`${CFG}.tmp`))

  // (c) 标记与 sidecar 都没有 → 拒绝并给出原文
  {
    cfgsWrite('{\n  "permissions": [\n    { "action": "skill", "resource": "windows-shell", "effect": "deny" }\n  ]\n}\n')
    mod.saveSidecar(tmpConfigDir, { rules: [] })
    const before = fs.readFileSync(CFG)
    const r = await call("enable", { id: "windows-shell" })
    ok("G(c) 无标记且无 sidecar → 拒绝执行", r.text.includes("拒绝执行"), r.text)
    ok("G(c) 拒绝理由点明两者都没有", r.text.includes("既没有本工具标记注释") && r.text.includes("sidecar"), r.text)
    ok("G(c) 给出该 id 规则原文", r.text.includes('"resource": "windows-shell"'), r.text)
    ok("G(c) 拒绝时不动文件", fs.readFileSync(CFG).equals(before))
  }

  // (b) 无标记但 sidecar 有记录且恰好一条完全相同 → 删除并告警
  {
    cfgsWrite('{\n  "permissions": [\n    { "action": "skill", "resource": "windows-shell", "effect": "deny" }\n  ]\n}\n')
    mod.saveSidecar(tmpConfigDir, {
      rules: [{ id: "windows-shell", effect: "deny", file: CFG, insertedAt: new Date().toISOString(), createdBlock: true }],
    })
    const r = await call("enable", { id: "windows-shell" })
    ok("G(b) 无标记 + sidecar 唯一匹配 → 删除成功", r.text.includes("✅"), r.text)
    ok("G(b) 删除时告警", r.text.includes("⚠️"), r.text)
    ok("G(b) 来源标注为 sidecar 记录", r.text.includes("sidecar 记录"), r.text)
  }

  // 歧义：同一 id 两条精确规则 → 拒绝并列出全部候选
  {
    cfgsWrite(
      '{\n  "permissions": [\n' +
        '    { "action": "skill", "resource": "windows-shell", "effect": "deny" } // skill_management\n' +
        '    ,{ "action": "skill", "resource": "windows-shell", "effect": "deny" }\n' +
        '  ]\n}\n',
    )
    mod.saveSidecar(tmpConfigDir, { rules: [{ id: "windows-shell", effect: "deny", file: CFG, insertedAt: new Date().toISOString() }] })
    const before = fs.readFileSync(CFG)
    const r = await call("enable", { id: "windows-shell" })
    ok("G 歧义（同 id 两条）→ 拒绝执行", r.text.includes("拒绝执行") && r.text.includes("无法唯一定位"), r.text)
    ok("G 歧义 → 列出全部候选（两条原文）", (r.text.match(/"resource": "windows-shell"/g) || []).length === 2, r.text)
    ok("G 歧义 → 不动文件", fs.readFileSync(CFG).equals(before))
  }

  // 挡路的是通配规则 → 拒绝，报告出处
  {
    cfgsWrite('{\n  "permissions": [\n    { "action": "skill", "resource": "*", "effect": "deny" }\n  ]\n}\n')
    mod.saveSidecar(tmpConfigDir, { rules: [] })
    const r = await call("enable", { id: "windows-shell" })
    ok("G 通配 deny → 拒绝删除", r.text.includes("拒绝执行") && r.text.includes("挡路的不是这一行"), r.text)
    ok("G 通配 deny → 指出命中的规则原文", r.text.includes('"resource": "*"'), r.text)
    ok("G 通配 deny → 不动文件", fs.readFileSync(CFG).toString("utf8").includes('"resource": "*"'))
  }

  // 挡路的是 agent 级 permissions（配置里没有该规则）→ 拒绝，报告出处
  {
    cfgsWrite(ORIGINAL)
    mod.saveSidecar(tmpConfigDir, { rules: [] })
    const r = await callWith(
      { agentRules: { build: [{ action: "skill", resource: "windows-shell", effect: "deny" }] } },
      "enable",
      { id: "windows-shell" },
    )
    ok("G agent 级 deny → 拒绝删除", r.text.includes("拒绝执行") && r.text.includes("挡路的不是这一行"), r.text)
    ok("G agent 级 deny → 指出调用者与规则", r.text.includes("`build`") && /"resource"\s*:\s*"windows-shell"/.test(r.text), r.text)
    ok("G agent 级 deny → 不动文件", fs.readFileSync(CFG).equals(Buffer.from(ORIGINAL, "utf8")))
  }

  // 删除后仍被更宽的规则压成 deny → 必须写明，不能只报「已删除」
  {
    cfgsWrite(
      '{\n  "permissions": [\n' +
        '    { "action": "skill", "resource": "*", "effect": "deny" },\n' +
        '    { "action": "skill", "resource": "windows-shell", "effect": "deny" } // skill_management\n' +
        '  ]\n}\n',
    )
    mod.saveSidecar(tmpConfigDir, { rules: [] })
    const r = await call("enable", { id: "windows-shell" })
    ok("G 删除成功但仍是 deny：仍报告 ✅ 删除", r.text.includes("✅"), r.text)
    ok("G 删除成功但仍是 deny：写明仍为 deny 及原因", /删除后的生效效果[\s\S]*deny[\s\S]*仍为 deny[\s\S]*"resource"\s*:\s*"\*"/.test(r.text), r.text)
    ok("G 删除成功但仍是 deny：目标规则确实被删", !fs.readFileSync(CFG).toString("utf8").includes('"resource": "windows-shell"'))
  }

  // §11.3 description 硬化
  {
    const ctx = makeCtx()
    await mod.default.setup(ctx)
    const tool = ctx.__tools.find((t) => t.name === "skill_management")
    ok("G description 声明为原生工具、直接按名字调用", /native tool/i.test(tool.description) && /by name/i.test(tool.description), tool.description)
    ok("G description 明确不要在 Code Mode 里找它", /Code Mode/.test(tool.description) && /search\(\)/.test(tool.description), tool.description)
    ok("G description 说明 enable 不要求是本工具写的", /whoever wrote it/.test(tool.description), tool.description)
    ok("G codemode 维持 false", tool.options && tool.options.codemode === false)
  }

  cfgsWrite(ORIGINAL)
  mod.saveSidecar(tmpConfigDir, { rules: [] })
}

console.log(`\n${"─".repeat(60)}`)
if (failures.length === 0) {
  console.log(`全部通过：${pass} 项`)
} else {
  console.log(`通过 ${pass} 项，失败 ${failures.length} 项：`)
  for (const f of failures) console.log(`  ✗ ${f}`)
}
if (keep) console.log(`\n临时目录保留：${tmpRoot}`)
else fs.rmSync(tmpRoot, { recursive: true, force: true })
process.exit(failures.length === 0 ? 0 : 1)
