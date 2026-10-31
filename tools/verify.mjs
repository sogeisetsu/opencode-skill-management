#!/usr/bin/env node
/**
 * skill_management 验收脚本（可重复跑）
 *
 *   node tools/verify.mjs            # 全部测试
 *   node tools/verify.mjs --keep     # 不删除临时目录（排查用）
 *   node tools/verify.mjs --section E  # 只跑某一段（A–J，按标题前缀匹配）
 *
 * 覆盖：
 *  A 模块形状 / 纯度（无第三方依赖、无 shell）
 *  B glob 与权限求值（findLast + 无命中回退 ask）
 *  C id 推导 / 来源与 scope 归类
 *  D JSONC 最小文本编辑（新增/删除/新建块/CRLF/BOM/严格校验）+ 极端形状 + 失败路径
 *  D2 §4.1 目标文件解析（XDG / 家目录 / 双目录冲突）
 *  E 端到端：在临时配置目录上跑 disable / dryRun / enable，含备份、sidecar、回读校验、拒绝分支
 *  F 反推 id（§3.5）与 enable 归属边界
 *  G §11 变更（备份 1 份 + 原子写 + description）
 *  H 性能闸门（29 skills × 12 agents × 10 rules 下 list < 25 ms，软阈值）
 *  I 发布闸门（npm pack 内容 / exports 可解析 / install.mjs 副本逐字节一致）
 *  J install.mjs 冲突检测（npm 渠道 / 同目录副本 / --force / --uninstall / 版本落后）
 *
 * 本脚本**不触碰**真实全局配置：整个 E 组跑在临时 <config>/opencode 下，
 * install.mjs 那一步也把 XDG_CONFIG_HOME 指到临时目录。
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync, execSync } from "node:child_process"

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

  // ── N8：配置极端形状（解析边界） ──
  {
    const oneLine = '{"permissions":[{"action":"skill","resource":"x","effect":"deny"}]}\n'
    const insOne = mod.insertRule(oneLine, "y", "deny")
    mod.strictValidate(insOne.text)
    ok("N8 单行数组：插入后仍合法", (() => { try { mod.strictValidate(insOne.text); return true } catch { return false } })())
    ok("N8 单行数组：两条规则都在", parseStrict(insOne.text).permissions.length === 2, insOne.text)
    ok("N8 单行数组：跳过带标记的规则", Boolean(insOne.text.match(/\/\/ skill_management/)))
    ok("N8 单行数组：仍能精确列出目标 id", mod.findAllExactItems(insOne.text, "x").length === 1)

    const withComment =
      '{\n' +
      '  "permissions": [\n' +
      '    { "action": "skill", "resource": "x", "effect": "deny" } // 手工写的一行\n' +
      '  ]\n' +
      '}\n'
    ok("N8 项带行尾注释：仍能被精确列出", mod.findAllExactItems(withComment, "x").length === 1)
    ok("N8 项带行尾注释：注释不含标记 → 不认作本工具写入", mod.findMarkedItem(withComment, "x") === undefined)

    // 重复 permissions 键：宿主/JSON.parse 取最后一个；本工具必须与之一致
    const dup =
      '{\n  "permissions": [],\n  "permissions": [\n    { "action": "bash", "resource": "*", "effect": "allow" }\n  ]\n}\n'
    const insDup = mod.insertRule(dup, "y", "deny")
    mod.strictValidate(insDup.text)
    ok("N8 重复 permissions 键：追加进最后一个数组（与 JSON.parse 同语义）", parseStrict(insDup.text).permissions.length === 2, insDup.text)
    ok("N8 重复 permissions 键：第一个空数组原样不动", insDup.text.includes('"permissions": [],'))

    // 尾逗号：宽容解析看不出来，严格校验必须拒绝
    ok("N8 尾逗号被严格校验拒绝", (() => { try { mod.strictValidate('{\n  "permissions": [],\n}\n'); return false } catch { return true } })())
    ok("N8 非对象根：findAllExactItems 返回空而不是抛错", mod.findAllExactItems("[1,2]", "x").length === 0)
    const nonObj = path.join(tmpRoot, "n8-nonobject.json")
    fs.writeFileSync(nonObj, "[1,2]\n", "utf8")
    ok("N8 非对象根：readConfigRules 返回空数组（不是 null）", JSON.stringify(mod.readConfigRules(nonObj)) === "[]")
    ok("N8 读不到的文件：readConfigRules 返回 null（不猜）", mod.readConfigRules(path.join(tmpRoot, "n8-missing.json")) === null)
  }

  // ── N9：marker 干扰（归属判定只看"该项自己那一行"的行尾注释） ──
  {
    const cfg =
      '{\n' +
      '  "permissions": [\n' +
      '    { "action": "skill", "resource": "a", "effect": "deny" }, // 手工加的一行\n' +
      '    { "action": "skill", "resource": "b", "effect": "deny" }, // 确认过：skill_management 写的\n' +
      '    { "action": "skill", "resource": "c", "effect": "deny" }\n' +
      '  ]\n' +
      '}\n'
    const ia = mod.findAllExactItems(cfg, "a")[0]
    const ib = mod.findAllExactItems(cfg, "b")[0]
    const ic = mod.findAllExactItems(cfg, "c")[0]
    ok("N9 同一行只有别的注释 → 不算本工具写入", mod.itemHasMarker(cfg, ia) === false)
    ok("N9 同一行注释里含 marker 字样 → 认作本工具写入（§4.3 同行标记）", mod.itemHasMarker(cfg, ib) === true)
    ok("N9 无注释的项不算本工具写入", mod.itemHasMarker(cfg, ic) === false)
    ok("N9 标记不会串到相邻项", mod.findMarkedItem(cfg, "a") === undefined && mod.findMarkedItem(cfg, "c") === undefined)
    ok("N9 findMarkedItem 命中带标记的那一条", mod.findMarkedItem(cfg, "b")?.start === ib.start)
  }

  // ── N6：BOM + 中文注释 + CRLF 的往返（读写原语层，逐字节） ──
  {
    const file = path.join(tmpRoot, "roundtrip.jsonc")
    const text =
      '{\r\n' +
      '  // 中文注释：这一行必须逐字保留\r\n' +
      '  "$schema": "https://opencode.ai/config.json",\r\n' +
      '  "permissions": [\r\n' +
      '    { "action": "bash", "resource": "*", "effect": "allow" } // 手工注释\r\n' +
      '  ],\r\n' +
      '  "shell": "pwsh"\r\n' +
      '}\r\n'
    const originalBuf = Buffer.from("\ufeff" + text, "utf8")
    fs.writeFileSync(file, originalBuf)
    const r = mod.readTextFile(file)
    ok("N6 读回识别 BOM 且正文不含 BOM", r.bom === true && r.text.startsWith("{\r\n"))
    const ins = mod.insertRule(r.text, "windows-shell", "deny")
    mod.strictValidate(ins.text)
    mod.writeTextFile(file, ins.text, r.bom)
    const r2 = mod.readTextFile(file)
    const item = mod.findMarkedItem(r2.text, "windows-shell")
    ok("N6 往返：插入后仍能定位带标记的项", Boolean(item))
    const removed = mod.removeRuleByLine(r2.text, item)
    const cleaned = mod.removePermissionsBlockIfEmpty(removed)
    mod.writeTextFile(file, cleaned ?? removed, r2.bom)
    const back = fs.readFileSync(file)
    ok("N6 disable→enable 后与原文件逐字节一致（BOM + CRLF + 中文注释）", back.equals(originalBuf), JSON.stringify(back.toString("utf8")))
    ok("N6 往返后 BOM 仍在", back[0] === 0xef && back[1] === 0xbb && back[2] === 0xbf)
    ok("N6 往返后仍是全 CRLF", !/[^\r]\n/.test(back.toString("utf8").slice(1)))
  }

  // ── N11：writeTextFile 失败路径（抛错、不留 .tmp、不静默） ──
  {
    const dir = path.join(tmpRoot, "n11")
    fs.mkdirSync(dir, { recursive: true })
    const dest = path.join(dir, "opencode.jsonc")
    fs.mkdirSync(dest) // 让 rename(tmp, dest) 失败（目标是目录）
    let threw = false
    try {
      mod.writeTextFile(dest, "{}\n", false)
    } catch {
      threw = true
    }
    ok("N11 writeTextFile 失败时抛错（不静默）", threw)
    ok("N11 失败后不留 .tmp", !fs.existsSync(`${dest}.tmp`))
    ok("N11 失败后目标未被替换", fs.statSync(dest).isDirectory())
  }
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
  const agents = opts.agents
    ? opts.agents.map((a) => ({ ...a }))
    : [
        { id: "build", hidden: false, permissions: [] },
        { id: "plan", hidden: false, permissions: [] },
      ]
  if (!opts.agents && opts.withTitleDeny) agents.push({ id: "title", hidden: true, permissions: [{ action: "*", resource: "*", effect: "deny" }] })
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
  // 工具返回 { output, content }：output 供宿主按 schema 校验，content 是模型读到的 JSON 文本
  return { text: res.content, json: res.output, res, ctx }
}

async function call(action, args = {}) {
  return callWith({}, action, args)
}

{
  // 工具注册形态
  const { ctx: _c } = await callWith({}, "list")
  const tool = _c.__tools.find((t) => t.name === "skill_management")
  ok("工具已注册且名为 skill_management", Boolean(tool))
  ok("options.codemode === false", tool.options && tool.options.codemode === false, JSON.stringify(tool.options))
  ok("input 是原生 JSON Schema（含 type:object）", tool.input && tool.input.type === "object")
  ok("input 不是 zod/函数（确实传了原生 JSON Schema）", typeof tool.input !== "function")
  ok(
    "声明了 output JSON Schema（不声明就不能返回 output）",
    tool.output && tool.output.type === "object" && Array.isArray(tool.output.required) && tool.output.required.includes("schemaVersion"),
    JSON.stringify(tool.output?.required),
  )
  ok("description 非空", typeof tool.description === "string" && tool.description.length > 40)
  ok("description 声明返回 JSON、不是 Markdown", /JSON object/i.test(tool.description) && /not Markdown/i.test(tool.description), tool.description)
  ok("读取注册表后会 dispose 掉 transform 注册（不留 hook）", _c.__stats.disposed >= 2, `disposed=${_c.__stats.disposed}`)

  // 返回形态：content 必须是可解析的 JSON，且与 output 一致
  {
    const r = await call("list")
    let parsed = null
    try {
      parsed = JSON.parse(r.text)
    } catch {
      parsed = null
    }
    ok("content 是合法 JSON（不再是 Markdown）", parsed !== null, r.text.slice(0, 200))
    ok("content 与 output 是同一份数据", parsed !== null && JSON.stringify(parsed) === JSON.stringify(r.json))
    ok(
      "每个结果都带 schemaVersion/action/ok/warnings",
      parsed && parsed.schemaVersion === 1 && parsed.action === "list" && parsed.ok === true && Array.isArray(parsed.warnings),
      JSON.stringify(parsed && Object.keys(parsed)),
    )
    ok("JSON 里没有 Markdown 表格分隔行", !r.text.includes("| ---") && !r.text.includes("|---"))
  }

  // 未知动作与内部错误也必须是合法 JSON（声明 output 后，字符串返回值会变成宿主错误）
  {
    const r = await call("nope")
    ok("未知动作返回 ok:false + error.code", r.json.ok === false && r.json.error.code === "unknown_action", r.text)
    ok("未知动作仍是合法 JSON", JSON.parse(r.text).action === "nope")
  }

  // 宿主形状兼容：只有 list() 信封 / 只有 list() 数组 / transform 可用
  {
    const env = await callWith({ envelopeOnly: true }, "list")
    ok("transform 不可用时，回退读 list() 的 { location, data } 信封", env.json.skills.some((s) => s.id === "grill-me") && env.json.ok === true)
    const arr = await callWith({ arrayOnly: true }, "list")
    ok("list() 直接返回数组时也能读", arr.json.skills.some((s) => s.id === "grill-me"))
  }

  // list
  const listRes = await call("list")
  const list = listRes.json
  const ids = list.skills.map((s) => s.id)
  ok(
    "list 每个条目都带 id/name/autoinvoke/source/scope/state/path/description",
    list.skills.every((s) => ["id", "name", "autoinvoke", "source", "scope", "state", "path", "description"].every((k) => k in s)),
    JSON.stringify(list.skills[0]),
  )
  ok("list 覆盖全部 5 个 skill", ["grill-me", "windows-shell", "agents-skill", "cached-skill", "builtin-one"].every((id) => ids.includes(id)))
  ok(
    "list 正确标出来源（claude / config / agents / catalog / embedded）",
    ["claude", "config", "agents", "catalog", "embedded"].every((s) => list.skills.some((x) => x.source === s)),
    JSON.stringify(list.skills.map((s) => `${s.id}=${s.source}`)),
  )
  ok("list 绝不输出正文", !listRes.text.includes(SENTINEL))
  ok("list description 只取首行", list.skills.find((s) => s.id === "grill-me").description === "Stress-test a plan")
  ok("list 带统计", list.summary.total === 5 && list.summary.disabled === 0 && list.summary.ask === 0, JSON.stringify(list.summary))
  ok("list 打印目标配置文件路径", list.config.file === CFG)
  ok("list 标明调用者 agent（state 的作用域）", list.callerAgent.id === "build" && list.callerAgent.verified === true, JSON.stringify(list.callerAgent))

  // 回归：list 的 state 只看调用者 agent 的规则集（规范 §3.6），不得合并所有 agent
  {
    const { json: t, ctx: c } = await callWith({ withTitleDeny: true }, "list")
    const items = (await c.agent.list()).data
    const title = items.find((a) => a.id === "title")
    const own = title && Array.isArray(title.permissions) ? title.permissions : []
    ok(
      "夹具：title 的 {*,*,deny} 真的进了注册表（旧夹具会覆盖掉它，回归用例等于空跑）",
      Boolean(title) && own.length > 0 && own[own.length - 1].effect === "deny",
      JSON.stringify(own),
    )
    ok("别的 agent 全 deny 不影响调用者：统计仍是 0 disabled", t.summary.disabled === 0, JSON.stringify(t.summary))
    ok("别的 agent 全 deny 时 state 仍全是 available", t.skills.every((s) => s.state === "available"), JSON.stringify(t.skills.map((s) => s.state)))
    ok(
      "提示其它 agent 下的差异",
      t.summary.diverged === 5 && t.warnings.some((w) => w.includes("另有 5 个 skill 在其它 agent 下状态不同")),
      JSON.stringify(t.summary),
    )
  }
  {
    // 本机真实 bug 的最小复现：只有别的 agent（plan）deny，调用者（build）不该看到 disabled
    const t = (await callWith({ agentRules: { plan: [{ action: "skill", resource: "grill-me", effect: "deny" }] } }, "list")).json
    ok(
      "只有别的 agent deny 某个 id 时，调用者仍是 available",
      t.summary.disabled === 0 && t.skills.find((s) => s.id === "grill-me").state !== "disabled",
      JSON.stringify(t.summary),
    )
  }
  {
    // 调用者自己的 deny 仍然算数
    const t = (await callWith({ agentRules: { build: [{ action: "skill", resource: "grill-me", effect: "deny" }] } }, "list")).json
    ok(
      "调用者自己的 deny 仍然生效",
      t.summary.disabled === 1 && t.skills.find((s) => s.id === "grill-me").state === "disabled",
      JSON.stringify(t.summary),
    )
  }
  {
    const t = (await callWith({ callerAgentId: "ghost" }, "list")).json
    ok(
      "拿不到调用者 agent 时显式告警（不静默顶替）",
      t.callerAgent.verified === false && t.warnings.some((w) => w.includes("未能确认调用者 agent")),
      JSON.stringify(t.warnings),
    )
  }

  // inspect
  const inspRes = await call("inspect", { id: "grill-me" })
  const insp = inspRes.json
  ok("inspect 报告 id/path/source/scope", insp.skill.id === "grill-me" && insp.skill.path.includes("SKILL.md") && insp.skill.source === "claude")
  ok("inspect 给出命中规则与逐 agent 结果", insp.caller.rule !== null && insp.agents.some((a) => a.id === "build"))
  ok("inspect 给出一句话结论", insp.conclusion.state === "available" && insp.conclusion.message.includes("当前可用"), insp.conclusion.message)
  ok("inspect 不输出正文", !inspRes.text.includes(SENTINEL))
  const inspByName = (await call("inspect", { name: "windows-shell" })).json
  ok("inspect 支持 name 别名", inspByName.matchedBy === "name")
  {
    const missing = (await call("inspect", { id: "no-such-skill" })).json
    ok("inspect 找不到时 ok:false + skill_not_found", missing.ok === false && missing.error.code === "skill_not_found", JSON.stringify(missing))
  }

  // dryRun 不得改文件
  const before = fs.readFileSync(CFG)
  const dry = (await call("disable", { id: "grill-me", dryRun: true })).json
  ok("dryRun 输出计划且不写入", dry.dryRun === true && dry.changed === false && dry.message.includes("未写入任何文件"), JSON.stringify(dry))
  ok(
    "dryRun 预览与实际将插入的内容一致",
    dry.diff.join("\n").includes(`"permissions": [`) &&
      dry.diff.join("\n").includes(`{ "action": "skill", "resource": "grill-me", "effect": "deny" } // skill_management`),
    JSON.stringify(dry.diff),
  )
  ok("dryRun 零字节变化", fs.readFileSync(CFG).equals(before))
  ok("dryRun 不产生 sidecar", !fs.existsSync(path.join(tmpConfigDir, "skill_management.state.json")))

  // disable
  const dis = (await call("disable", { id: "grill-me" })).json
  ok("disable 成功", dis.ok === true && dis.changed === true, JSON.stringify(dis.error))
  ok("disable 报告结构化 verification 与 diff", dis.verification.ok === true && dis.verification.caller === "build" && dis.diff.length > 0)
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
  const dis2 = (await call("disable", { id: "grill-me" })).json
  ok(
    "重复 disable 不重复写",
    dis2.ok === true && dis2.changed === false && dis2.reason === "already_disabled" && fs.readFileSync(CFG).toString("utf8") === afterDisable,
    JSON.stringify(dis2),
  )

  // list 现在应显示 disabled
  const list2 = (await call("list")).json
  ok("list 显示 disabled 计数", list2.summary.disabled === 1, JSON.stringify(list2.summary))
  ok(
    "list 的 state 用 available/disabled（不是 allow/deny）",
    list2.skills.find((s) => s.id === "grill-me").state === "disabled" && list2.skills.find((s) => s.id === "windows-shell").state === "available",
  )

  // enable
  const en = (await call("enable", { id: "grill-me" })).json
  ok("enable 成功", en.ok === true && en.changed === true, JSON.stringify(en.error))
  ok("enable 后逐字节还原", fs.readFileSync(CFG).equals(Buffer.from(ORIGINAL, "utf8")))
  const side2 = JSON.parse(fs.readFileSync(path.join(tmpConfigDir, "skill_management.state.json"), "utf8"))
  ok("enable 后 sidecar 记录被移除", side2.rules.length === 0)

  // 回归：别的 agent（如内部 title）全 deny，不得因此拒绝给调用者写规则
  {
    cfgsWrite(ORIGINAL)
    const r = await callWith({ withTitleDeny: true }, "disable", { id: "windows-shell" })
    ok("不同 agent 的全 deny 不影响调用者（不会被误判为'已被更宽规则覆盖'）", r.json.ok === true && r.json.changed === true, r.text)
    mod.strictValidate(fs.readFileSync(CFG).toString("utf8"))
    // 清理：撤销
    const back = await callWith({ withTitleDeny: true }, "enable", { id: "windows-shell" })
    ok("清理后还原", back.json.ok === true && fs.readFileSync(CFG).equals(Buffer.from(ORIGINAL, "utf8")), back.text)
  }

  // 调用者自己确实被更宽规则覆盖为 deny → 报覆盖、不写入
  {
    cfgsWrite('{\n  "permissions": [\n    { "action": "skill", "resource": "*", "effect": "deny" }\n  ]\n}\n')
    const r = await call("disable", { id: "windows-shell" })
    ok(
      "调用者自己被更宽规则覆盖时报告覆盖，不写入",
      r.json.ok === true && r.json.changed === false && r.json.reason === "covered_by_broader_rule" && r.json.message.includes("已被更宽的规则覆盖"),
      r.text,
    )
    ok("该情形下文件未变", fs.readFileSync(CFG).toString("utf8").includes('"resource": "*"'))
  }

  // N4 回滚路径：写后生效校验拿不到期望效果 → 必须回滚且文件字节不变
  {
    process.env.SKILL_MGMT_VERIFY_TIMEOUT_MS = "400"
    cfgsWrite(ORIGINAL)
    const before = fs.readFileSync(CFG)
    const r = await callWith({ staleAgents: true }, "disable", { id: "windows-shell" })
    ok(
      "N4 deny 生效校验失败时报告失败并回滚",
      r.json.ok === false && r.json.error.code === "verification_failed" && r.json.rolledBack === true && r.json.error.message.includes("已回滚"),
      r.text,
    )
    ok("N4 回滚后文件逐字节不变", fs.readFileSync(CFG).equals(before))
    ok(
      "N4 回滚后不写 sidecar 记录",
      !JSON.parse(fs.readFileSync(path.join(tmpConfigDir, "skill_management.state.json"), "utf8")).rules.some((r) => r.id === "windows-shell"),
    )
    ok(
      "N4 回滚时说明调用者规则集里实际命中的是哪一条",
      r.json.warnings.join("\n").includes("的规则集 rules[") || r.json.warnings.join("\n").includes("没有命中规则"),
      JSON.stringify(r.json.warnings),
    )
    delete process.env.SKILL_MGMT_VERIFY_TIMEOUT_MS
  }

  // N1（回归 · bug 实证）：ask 的回读校验不得空转。
  // 宿主对「没有规则命中」的 skill 回退 ask，夹具 staleAgents 下调用者是 allow —— 两者都不是 deny，
  // 旧判据 `caller !== "deny"` 于是恒为真：规则根本没被读进注册表也报「✅ 已写入并校验通过」。
  {
    process.env.SKILL_MGMT_VERIFY_TIMEOUT_MS = "400"
    cfgsWrite(ORIGINAL)
    mod.saveSidecar(tmpConfigDir, { rules: [] })
    const before = fs.readFileSync(CFG)
    const r = await callWith({ staleAgents: true }, "disable", { id: "windows-shell", effect: "ask" })
    ok(
      "N1 ask 回读校验不得空转（宿主没读进规则时必须失败）",
      r.json.ok === false && r.json.error.code === "verification_failed" && r.json.error.message.includes("已回滚"),
      r.text,
    )
    ok("N1 ask 失败时不谎报成功", r.json.ok === false, r.text)
    ok("N1 ask 失败后文件逐字节不变", fs.readFileSync(CFG).equals(before))
    ok(
      "N1 ask 失败后不写 sidecar 记录",
      !JSON.parse(fs.readFileSync(path.join(tmpConfigDir, "skill_management.state.json"), "utf8")).rules.some((r) => r.id === "windows-shell"),
    )
    delete process.env.SKILL_MGMT_VERIFY_TIMEOUT_MS
  }

  // N2 ask 正向：写入成功 + 配置里确实写 ask + sidecar 记 ask + 输出能自证条数 0→1
  {
    cfgsWrite(ORIGINAL)
    mod.saveSidecar(tmpConfigDir, { rules: [] })
    const r = await call("disable", { id: "windows-shell", effect: "ask" })
    ok("N2 ask 成功", r.json.ok === true && r.json.changed === true, r.text)
    const written = fs.readFileSync(CFG, "utf8")
    ok("N2 配置里写入的是 effect: \"ask\"", written.includes('"resource": "windows-shell", "effect": "ask"'), written)
    const st = JSON.parse(fs.readFileSync(path.join(tmpConfigDir, "skill_management.state.json"), "utf8"))
    ok("N2 sidecar 记的是 ask", st.rules.find((x) => x.id === "windows-shell")?.effect === "ask", JSON.stringify(st))
    ok("N2 输出含精确规则数 0→1（能自证读入）", r.json.verification.via.includes("精确规则数 0→1"), JSON.stringify(r.json.verification))
    const l = (await call("list")).json
    ok("N2 list 把该 skill 显示为 ask", l.skills.find((s) => s.id === "windows-shell").state === "ask", JSON.stringify(l.skills.find((s) => s.id === "windows-shell")))
    const e = await call("enable", { id: "windows-shell" })
    ok("N2 清理：enable 能删掉 ask 规则并逐字节还原", e.json.ok === true && fs.readFileSync(CFG).equals(Buffer.from(ORIGINAL, "utf8")), e.text)
  }

  // N3 ask 但该 agent 有自己的后置 allow 规则：规则确实写入，输出必须写明实际生效是 allow
  {
    cfgsWrite(ORIGINAL)
    mod.saveSidecar(tmpConfigDir, { rules: [] })
    const r = await callWith(
      { agentRules: { build: [{ action: "skill", resource: "windows-shell", effect: "allow" }] } },
      "disable",
      { id: "windows-shell", effect: "ask" },
    )
    ok("N3 规则确实写入了配置", fs.readFileSync(CFG, "utf8").includes('"resource": "windows-shell", "effect": "ask"'), fs.readFileSync(CFG, "utf8"))
    ok("N3 仍报写入成功（回读确认条数增加）", r.json.ok === true && r.json.verification.via.includes("精确规则数 0→1"), r.text)
    ok("N3 必须显式说明实际效果是 allow（不谎报已生效）", r.json.warnings.join("\n").includes("实际效果是 allow"), JSON.stringify(r.json.warnings))
    ok("N3 不得再说「对该 agent 优先级最高」", !r.json.warnings.join("\n").includes("对该 agent 优先级最高"), JSON.stringify(r.json.warnings))
    cfgsWrite(ORIGINAL)
    mod.saveSidecar(tmpConfigDir, { rules: [] })
  }

  // N5 单条 disable 只改 1 行；注释/缩进/键序/BOM/EOL 逐字节不变
  {
    const text =
      '{\r\n' +
      '  // 中文注释：这一行必须逐字保留\r\n' +
      '  "$schema": "https://opencode.ai/config.json",\r\n' +
      '  "permissions": [\r\n' +
      '    { "action": "bash", "resource": "*", "effect": "allow" }\r\n' +
      '  ],\r\n' +
      '  "shell": "pwsh",\r\n' +
      '  "plugins": ["a", "b"]\r\n' +
      '}\r\n'
    const originalBuf = Buffer.from("\ufeff" + text, "utf8")
    fs.writeFileSync(CFG, originalBuf)
    mod.saveSidecar(tmpConfigDir, { rules: [] })
    const r = await call("disable", { id: "windows-shell" })
    ok("N5 前置：disable 成功", r.json.ok === true, r.text)
    const expected =
      "\ufeff" +
      text.replace(
        '    { "action": "bash", "resource": "*", "effect": "allow" }\r\n',
        '    { "action": "bash", "resource": "*", "effect": "allow" },\r\n' +
          '    { "action": "skill", "resource": "windows-shell", "effect": "deny" } // skill_management\r\n',
      )
    const actual = fs.readFileSync(CFG)
    ok("N5 除新增的 1 行（+1 个逗号）外逐字节不变", actual.equals(Buffer.from(expected, "utf8")), `实际：\n${actual.toString("utf8")}`)
    ok("N5 BOM 仍在", actual[0] === 0xef && actual[1] === 0xbb && actual[2] === 0xbf)
    ok("N5 仍是全 CRLF", !/[^\r]\n/.test(actual.toString("utf8").slice(1)))
    const e = await call("enable", { id: "windows-shell" })
    ok("N5 复原：enable 后逐字节回到原文件", e.json.ok === true && fs.readFileSync(CFG).equals(originalBuf), e.text)
  }

  // N7 sidecar 损坏（非法 JSON / rules 非数组 / 未知 version）→ ok=false，list 不崩且给提示
  {
    cfgsWrite(ORIGINAL)
    const sideFile = path.join(tmpConfigDir, "skill_management.state.json")
    const cases = [
      ["非法 JSON", "{ not json"],
      ["rules 不是数组", '{"version":1,"rules":{}}'],
      ["未知 version", '{"version":99,"rules":[]}'],
      ["根不是对象", "[1,2]"],
    ]
    for (const [name, body] of cases) {
      fs.writeFileSync(sideFile, body, "utf8")
      const s = mod.loadSidecar(tmpConfigDir)
      ok(`N7 sidecar ${name} → ok=false（不猜）`, s.ok === false && s.rules.length === 0, JSON.stringify({ ok: s.ok, err: s.error }))
      const l = (await call("list")).json
      const w = l.warnings.join("\n")
      ok(`N7 sidecar ${name} → list 不崩且给出提示`, l.ok === true && w.includes("sidecar") && w.includes("读取失败"), JSON.stringify(l.warnings))
    }
    mod.saveSidecar(tmpConfigDir, { rules: [] })
  }

  // N10 幂等：disable→disable→enable→enable，最终文件与 sidecar 完全复原
  {
    cfgsWrite(ORIGINAL)
    mod.saveSidecar(tmpConfigDir, { rules: [] })
    const sideFile = path.join(tmpConfigDir, "skill_management.state.json")
    const sideBefore = fs.readFileSync(sideFile)
    const d1 = await call("disable", { id: "windows-shell" })
    const fileAfterD1 = fs.readFileSync(CFG)
    const d2 = await call("disable", { id: "windows-shell" })
    ok("N10 重复 disable 是空操作（文件不动）", d2.json.changed === false && fs.readFileSync(CFG).equals(fileAfterD1), d2.text)
    const e1 = await call("enable", { id: "windows-shell" })
    ok("N10 第一次 enable 逐字节复原", fs.readFileSync(CFG).equals(Buffer.from(ORIGINAL, "utf8")), e1.text)
    const e2 = await call("enable", { id: "windows-shell" })
    ok(
      "N10 重复 enable 是空操作",
      fs.readFileSync(CFG).equals(Buffer.from(ORIGINAL, "utf8")) && e2.json.changed === false && e2.json.reason === "nothing_to_enable",
      e2.text,
    )
    ok("N10 sidecar 逐字节复原", fs.readFileSync(sideFile).equals(sideBefore), fs.readFileSync(sideFile, "utf8"))
    ok("N10 前置：四步里的写操作都成功", d1.json.ok === true && e1.json.ok === true, `${d1.text}\n---\n${e1.text}`)
  }

  // N8 配置极端形状里的一条：目标文档语法坏了 → enable 既不猜也不崩，并明确说"无法解析"
  {
    cfgsWrite('{\n  "permissions": [\n    { "action": "skill", "resource": "windows-shell", "effect": "deny" }\n  \n}\n')
    const before = fs.readFileSync(CFG)
    const r = await call("enable", { id: "windows-shell" })
    ok("N8 目标文件语法错误：enable 不崩、不报成功", r.json.ok === false && r.json.error.code !== "internal_error", r.text)
    ok("N8 目标文件语法错误：明确提示无法解析", r.json.warnings.join("\n").includes("无法解析"), JSON.stringify(r.json.warnings))
    ok("N8 目标文件语法错误：文件未被改动", fs.readFileSync(CFG).equals(before))
    cfgsWrite(ORIGINAL)
  }

  // §3.1/§4.4 一致性：sidecar 有记录但配置里已无对应规则 → 必须告警，且该 skill 显示为可用
  {
    cfgsWrite(ORIGINAL)
    mod.saveSidecar(tmpConfigDir, {
      rules: [{ id: "windows-shell", effect: "deny", file: CFG, insertedAt: new Date().toISOString(), createdBlock: true }],
    })
    const l = (await call("list")).json
    const w = l.warnings.join("\n")
    ok("sidecar 与配置不一致时必须告警", w.includes("⚠️ sidecar 与配置不一致"), w)
    ok("告警里点名了那个 skill", /sidecar 与配置不一致[\s\S]{0,300}windows-shell/.test(w))
    ok("该 skill 仍按实际规则集显示为 available", l.skills.find((s) => s.id === "windows-shell").state === "available")
    ok("注册表漂移（情况 3）不再误报", !w.includes("已不在注册表里"))
    mod.saveSidecar(tmpConfigDir, { rules: [] })
  }

  // 反向漂移：配置里有 skill 规则但 sidecar 无记录 → 给提示
  {
    cfgsWrite('{\n  "permissions": [\n    { "action": "skill", "resource": "windows-shell", "effect": "deny" }\n  ]\n}\n')
    const l = (await call("list")).json
    ok("配置有规则而 sidecar 无记录时给出提示", l.warnings.join("\n").includes("sidecar 里没有记录"), JSON.stringify(l.warnings))
    cfgsWrite(ORIGINAL)
  }

  // 恢复一份干净配置，供后续拒绝分支测试
  cfgsWrite('{\n  "permissions": []\n}\n')

  // 拒绝分支：注册表里存在、但规则是用户手写的（无标记、无 sidecar 记录）
  const handWritten = cfgsWrite(
    '{\n  "permissions": [\n    { "action": "skill", "resource": "windows-shell", "effect": "deny" }\n  ]\n}\n',
  )
  const refuse = (await call("enable", { id: "windows-shell" })).json
  ok("拒绝删除用户手写的规则", refuse.ok === false && refuse.error.code === "unverifiable_origin", JSON.stringify(refuse))
  ok("拒绝时给出待删规则原文", refuse.rule.text.includes('"resource": "windows-shell"'), JSON.stringify(refuse.rule))
  ok("拒绝时未改文件", fs.readFileSync(CFG).toString("utf8") === handWritten)

  // sidecar 有记录但标记被外部剥掉 → 删除并告警
  fs.writeFileSync(CFG, '{\n  "permissions": [\n    { "action": "skill", "resource": "grill-me", "effect": "deny" }\n  ]\n}\n', "utf8")
  mod.saveSidecar(tmpConfigDir, { rules: [{ id: "grill-me", effect: "deny", file: CFG, insertedAt: new Date().toISOString() }] })
  const en2 = (await call("enable", { id: "grill-me" })).json
  ok("标记缺失时按 sidecar 删除", en2.ok === true)
  ok("标记缺失时给出告警", en2.warnings.some((w) => w.includes("⚠️")), JSON.stringify(en2.warnings))
  mod.strictValidate(fs.readFileSync(CFG).toString("utf8"))

  // 声明 output 后：结果必须带 output，且字段满足声明的必需项
  {
    const ctx = makeCtx()
    await mod.default.setup(ctx)
    const tool = ctx.__tools.find((t) => t.name === "skill_management")
    const res = await tool.execute({ action: "list" }, { agent: "build" })
    ok("声明了 output 时结果必须带 output（宿主规则）", "output" in res && res.output && typeof res.output === "object")
    ok("output 满足声明的必需字段", ["schemaVersion", "action", "ok", "warnings"].every((k) => k in res.output), JSON.stringify(Object.keys(res.output)))
    ok("content 是同一份 JSON", JSON.parse(res.content).schemaVersion === res.output.schemaVersion)
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
  const l = (await callWith({ skills: noId }, "list")).json
  const lIds = l.skills.map((s) => s.id)
  ok("§3.5 反推：<root>/foo.md → foo", lIds.includes("foo"), JSON.stringify(lIds))
  ok("§3.5 反推：<root>/bar/SKILL.md → bar", lIds.includes("bar"))
  ok("§3.5 反推：<root>/a/b/SKILL.md → b", lIds.includes("b"))
  ok("location 字段（字符串）也被当作路径使用 → loc", lIds.includes("loc"))
  ok("既无 id 也无路径 → id 为 null", l.skills.some((s) => s.id === null), JSON.stringify(lIds))
  ok(
    "list 说明有几个 id 是反推来的",
    l.summary.derivedIds === 4 && l.warnings.some((w) => w.includes("其中 4 个 id 由路径反推")),
    JSON.stringify(l.summary),
  )
  ok("反推得到的 id 也能查状态（不是 unknown）", ["available", "disabled", "ask"].includes(l.skills.find((s) => s.id === "foo").state))

  // inspect 要报告"反推过程"
  const insp = (await callWith({ skills: noId }, "inspect", { id: "b" })).json
  ok("inspect：报告 id 来源为「由路径反推」", insp.idDerivation.idSource === "derived" && insp.idDerivation.explained.includes("由路径反推"), JSON.stringify(insp.idDerivation))
  ok("inspect：给出推导规则原文（SKILL.md → 取所在目录名）", insp.idDerivation.rule.includes("取 SKILL.md 所在目录名"), insp.idDerivation.rule)
  ok("inspect：给出规则输入 dirname/basename", Boolean(insp.idDerivation.dir) && insp.idDerivation.base === "SKILL.md", JSON.stringify(insp.idDerivation))
  const inspLoc = (await callWith({ skills: noId }, "inspect", { id: "loc" })).json
  ok("inspect：报告使用的路径字段是 location", inspLoc.idDerivation.pathField === "location", JSON.stringify(inspLoc.idDerivation))

  // 注册表自带 id 时不出现在"反推"计数里
  const l2 = (await call("list")).json
  ok("注册表自带 id 时不显示反推计数", l2.summary.derivedIds === 0 && !l2.warnings.join("\n").includes("由路径反推"), JSON.stringify(l2.summary))

  // §11.1：sidecar 丢失但标记还在 → **应当删除成功**（标记是文件内自证，优先于 sidecar）
  {
    cfgsWrite(ORIGINAL)
    const d = await call("disable", { id: "windows-shell" })
    ok("前置：disable 成功（带标记）", d.json.ok === true, d.text)
    mod.saveSidecar(tmpConfigDir, { rules: [] }) // 模拟 sidecar 丢失
    const e = await call("enable", { id: "windows-shell" })
    ok("sidecar 无记录但标记命中 → 删除成功（§11.1 新行为）", e.json.ok === true, e.text)
    ok("定位方式报告为标记注释", e.json.location.how === "marker" && e.json.location.origin.includes("标记注释"), JSON.stringify(e.json.location))
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
  ok("G 前置：disable 成功", d1.json.ok === true && d1.json.changed === true, d1.text)
  ok("G 原子写不留下 .tmp 文件", !fs.existsSync(`${CFG}.tmp`), `${CFG}.tmp`)
  const e1 = await call("enable", { id: "windows-shell" })
  ok("G(a) 标记命中即删除", e1.json.ok === true && fs.readFileSync(CFG).equals(Buffer.from(ORIGINAL, "utf8")), e1.text)
  ok("G(a) 报告被删规则的来源", e1.json.location.origin.includes("本工具写入"), JSON.stringify(e1.json.location))
  ok(
    "G(a) 报告删除后的生效效果（调用者 agent）",
    e1.json.verification.caller === "build" && e1.json.verification.effect === "allow",
    JSON.stringify(e1.json.verification),
  )
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
    ok("G(c) 无标记且无 sidecar → 拒绝执行", r.json.ok === false && r.json.error.code === "unverifiable_origin", r.text)
    ok("G(c) 拒绝理由点明两者都没有", r.json.error.message.includes("既没有本工具标记注释") && r.json.error.message.includes("sidecar"), r.json.error.message)
    ok("G(c) 给出该 id 规则原文", r.json.rule.text.includes('"resource": "windows-shell"'), JSON.stringify(r.json.rule))
    ok("G(c) 拒绝时不动文件", fs.readFileSync(CFG).equals(before))
  }

  // (b) 无标记但 sidecar 有记录且恰好一条完全相同 → 删除并告警
  {
    cfgsWrite('{\n  "permissions": [\n    { "action": "skill", "resource": "windows-shell", "effect": "deny" }\n  ]\n}\n')
    mod.saveSidecar(tmpConfigDir, {
      rules: [{ id: "windows-shell", effect: "deny", file: CFG, insertedAt: new Date().toISOString(), createdBlock: true }],
    })
    const r = await call("enable", { id: "windows-shell" })
    ok("G(b) 无标记 + sidecar 唯一匹配 → 删除成功", r.json.ok === true && r.json.changed === true, r.text)
    ok("G(b) 删除时告警", r.json.warnings.some((w) => w.includes("⚠️")), JSON.stringify(r.json.warnings))
    ok("G(b) 来源标注为 sidecar 记录", r.json.location.how === "sidecar" && r.json.location.origin.includes("sidecar 记录"), JSON.stringify(r.json.location))
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
    ok("G 歧义（同 id 两条）→ 拒绝执行", r.json.ok === false && r.json.error.code === "ambiguous_rule" && r.json.error.message.includes("无法唯一定位"), r.text)
    ok(
      "G 歧义 → 列出全部候选（两条原文）",
      Array.isArray(r.json.candidates) && r.json.candidates.length === 2 && r.json.candidates.every((c) => c.text.includes('"resource": "windows-shell"')),
      JSON.stringify(r.json.candidates),
    )
    ok("G 歧义 → 不动文件", fs.readFileSync(CFG).equals(before))
  }

  // 挡路的是通配规则 → 拒绝，报告出处
  {
    cfgsWrite('{\n  "permissions": [\n    { "action": "skill", "resource": "*", "effect": "deny" }\n  ]\n}\n')
    mod.saveSidecar(tmpConfigDir, { rules: [] })
    const r = await call("enable", { id: "windows-shell" })
    ok("G 通配 deny → 拒绝删除", r.json.ok === false && r.json.error.code === "no_matching_rule", r.text)
    ok("G 通配 deny → 指出命中的规则原文", r.json.relatedRules.some((x) => x.text.includes('"resource": "*"')), JSON.stringify(r.json.relatedRules))
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
    ok("G agent 级 deny → 拒绝删除", r.json.ok === false && r.json.error.code === "no_matching_rule", r.text)
    ok("G agent 级 deny → 指出调用者与规则", r.json.callerHit.includes("`build`") && /"resource"\s*:\s*"windows-shell"/.test(r.json.callerHit), r.json.callerHit)
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
    ok("G 删除成功但仍是 deny：仍报告成功", r.json.ok === true && r.json.changed === true, r.text)
    ok(
      "G 删除成功但仍是 deny：写明仍为 deny 及原因",
      r.json.verification.effect === "deny" && r.json.warnings.some((w) => w.includes("仍为 deny") && /"resource"\s*:\s*"\*"/.test(w)),
      JSON.stringify(r.json.warnings),
    )
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

// ─────────────────────────────────────────────────────────────
// H. 性能闸门（软阈值）
// ─────────────────────────────────────────────────────────────
section("H 性能闸门（软阈值，防回退）")
{
  const perfSkills = Array.from({ length: 29 }, (_, i) => ({
    id: `perf-skill-${i}`,
    name: `perf-skill-${i}`,
    description: `perf fixture ${i}`,
    path: path.join(REAL_HOME, ".claude", "skills", `perf-skill-${i}`, "SKILL.md"),
  }))
  // 12 agents × 10 rules：与 §2 假设的规模一致（规则数线性放大，这里是量级验证）
  const perfAgents = Array.from({ length: 12 }, (_, i) => ({
    id: `agent-${i}`,
    hidden: i % 4 === 0,
    permissions: Array.from({ length: 10 }, (_, j) => ({
      action: j % 3 === 0 ? "*" : "skill",
      resource: j % 3 === 0 ? "*" : j % 5 === 0 ? "perf-skill-*" : `perf-skill-${j}`,
      effect: j % 4 === 0 ? "deny" : "allow",
    })),
  }))

  const ctx = makeCtx({ skills: perfSkills, agents: perfAgents })
  await mod.default.setup(ctx)
  const tool = ctx.__tools.find((t) => t.name === "skill_management")
  const runs = []
  let first = null
  for (let i = 0; i < 5; i++) {
    const t0 = process.hrtime.bigint()
    const res = await tool.execute({ action: "list" }, { agent: "agent-1" })
    runs.push(Number(process.hrtime.bigint() - t0) / 1e6)
    if (i === 0) first = res.output
  }
  ok("N12 合成注册表下 list 正常返回", first.ok === true && first.skills.length === 29, JSON.stringify(first.summary))
  ok("N12 list 覆盖全部 29 个合成 skill", first.skills.filter((s) => /^perf-skill-\d+$/.test(s.id)).length === 29)
  const best = Math.min(...runs)
  // 实测基线约 3.5–4 ms（改造前 5.96 ms）；阈值放到 25 ms，避免 CI 抖动误报。
  ok(
    "N12 list 最少耗时 < 25 ms（29 skills × 12 agents × 10 rules）",
    best < 25,
    `${best.toFixed(2)} ms（各次：${runs.map((r) => r.toFixed(2)).join(", ")}）`,
  )
}

// ─────────────────────────────────────────────────────────────
// I. 发布闸门：打包内容 / exports 可解析 / 安装副本逐字节一致
// ─────────────────────────────────────────────────────────────
section("I 发布闸门（打包 / exports / 安装副本）")
{
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"))

  // N13-1：npm pack --dry-run 的实际内容
  let pack = null
  try {
    const out = execSync("npm pack --dry-run --json", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180000,
    })
    pack = JSON.parse(out)[0]
  } catch (err) {
    ok("N13 npm pack --dry-run 可执行", false, String((err && err.message) || err))
  }
  if (pack) {
    const names = (pack.files ?? []).map((f) => f.path).sort()
    ok("N13 打包含入口文件 src/skill_management.js", names.includes("src/skill_management.js"), names.join(", "))
    ok(
      "N13 打包内容只含 package.json / README / LICENSE / CHANGELOG / src/**",
      names.every((n) => ["package.json", "README.md", "LICENSE", "CHANGELOG.md"].includes(n) || n.startsWith("src/")),
      names.join(", "),
    )
    ok("N13 打包不含仓库内工具 / 文档 / agent 说明", !names.some((n) => n.startsWith("tools/") || n.startsWith("docs/") || n === "AGENTS.md" || n.startsWith(".github/")), names.join(", "))
  }

  // N13-2：exports 能按包名解析（Node 的 self-reference），且入口注册的工具给出四个动作
  ok(
    "N13 exports['.'] 指向存在的入口文件",
    typeof pkg.exports?.["."] === "string" && fs.existsSync(path.join(repoRoot, pkg.exports["."])),
    JSON.stringify(pkg.exports),
  )
  let entry = null
  try {
    entry = await import(pkg.name)
  } catch (err) {
    ok("N13 入口可按包名（self-reference）解析", false, String((err && err.message) || err))
  }
  if (entry) {
    ok("N13 入口可按包名（self-reference）解析", typeof entry.default?.setup === "function")
    const c = makeCtx()
    await entry.default.setup(c)
    const t = c.__tools.find((x) => x.name === "skill_management")
    const actions = (t?.input?.properties?.action?.oneOf ?? []).map((o) => o.const).sort()
    ok("N13 解析出的入口注册了四个动作", JSON.stringify(actions) === JSON.stringify(["disable", "enable", "inspect", "list"]), JSON.stringify(actions))
  }

  // N14：install.mjs 装出来的副本与 src 逐字节一致（防"手改安装副本"与"源不一致"）
  // 落点用临时 XDG_CONFIG_HOME，绝不碰真实 <config>。
  const installRoot = path.join(tmpRoot, "installcfg")
  const installed = path.join(installRoot, "opencode", "plugins", "skill_management.js")
  // 真实环境里 OPENCODE_CONFIG / OPENCODE_CONFIG_DIR 可能指向正在运行的实例（含 npm 渠道），
  // 那会让安装器判定"已有 npm 渠道"而拒绝写入。这一段测的是单文件通道本身，所以清干净。
  const installEnv = { ...process.env, XDG_CONFIG_HOME: installRoot }
  delete installEnv.OPENCODE_CONFIG
  delete installEnv.OPENCODE_CONFIG_DIR
  let ran = false
  try {
    execFileSync(process.execPath, [path.join(repoRoot, "tools", "install.mjs")], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: installEnv,
      timeout: 60000,
    })
    ran = true
  } catch (err) {
    ok("N14 install.mjs 可执行", false, String((err && err.message) || err))
  }
  if (ran) {
    ok("N14 install.mjs 落在临时 <config> 下（没写真实配置）", installed.startsWith(tmpRoot), installed)
    ok("N14 安装副本与 src 逐字节一致", fs.existsSync(installed) && fs.readFileSync(installed).equals(fs.readFileSync(srcFile)))
    const run2 = execFileSync(process.execPath, [path.join(repoRoot, "tools", "install.mjs")], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: installEnv,
      timeout: 60000,
    })
    ok("N14 重复安装是幂等的（内容相同即跳过）", /已是最新/.test(run2) && fs.readFileSync(installed).equals(fs.readFileSync(srcFile)), run2)
  }
}

// ─────────────────────────────────────────────────────────────
// J. install.mjs 冲突检测
// ─────────────────────────────────────────────────────────────
section("J install.mjs 冲突检测")
{
  const { main, decide, resolveConfigDir } = await import(new URL("../tools/install.mjs", import.meta.url))
  const jRoot = path.join(tmpRoot, "J")

  const mk = (name, opts = {}) => {
    const base = path.join(jRoot, name)
    const configRoot = path.join(base, "config")
    const configDir = path.join(configRoot, "opencode")
    fs.mkdirSync(path.join(configDir, "plugins"), { recursive: true })
    const logs = []
    const ctx = {
      env: { XDG_CONFIG_HOME: configRoot, ...(opts.env ?? {}) },
      home: path.join(base, "home"),
      cwd: opts.cwd ?? base,
      log: (line) => logs.push(String(line)),
    }
    return { base, configRoot, configDir, dest: path.join(configDir, "plugins", "skill_management.js"), ctx, logs }
  }
  const run = (t, argv) => {
    t.logs.length = 0
    const code = main(argv, t.ctx)
    return { code, text: t.logs.join("\n") }
  }
  const srcBytes = fs.readFileSync(srcFile)
  const writeJsonc = (file, plugins) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `{\n  // 测试夹具\n  "plugins": [${plugins.map((p) => JSON.stringify(p)).join(", ")}],\n}\n`)
  }

  // J1 空配置 → 安装
  const t1 = mk("empty")
  const r1 = run(t1, [])
  ok("J1 空配置 → 写入副本", r1.code === 0 && fs.existsSync(t1.dest) && fs.readFileSync(t1.dest).equals(srcBytes), `code=${r1.code} ${r1.text}`)

  // J2 幂等，且不因自己的目标文件而自撞
  const r2 = run(t1, [])
  ok("J2 重复安装幂等，不自撞（目标文件被排除）", r2.code === 0 && /已是最新/.test(r2.text) && fs.readFileSync(t1.dest).equals(srcBytes), `code=${r2.code} ${r2.text}`)

  // J3 --check 不写文件
  const t3 = mk("check")
  const r3 = run(t3, ["--check"])
  ok("J3 --check 零写入", r3.code === 0 && !fs.existsSync(t3.dest) && /\[dry-run\]/.test(r3.text), `code=${r3.code} ${r3.text}`)

  // J4 只有 npm 渠道 → 不写文件
  const t4 = mk("npm-only")
  writeJsonc(path.join(t4.configDir, "opencode.jsonc"), ["opencode-skill-management@1.1.0"])
  const r4 = run(t4, [])
  ok("J4 已装 npm 渠道 → 不写副本、退出 0", r4.code === 0 && !fs.existsSync(t4.dest) && /npm 渠道已装/.test(r4.text), `code=${r4.code} ${r4.text}`)

  // J5 npm + 副本 → 冲突，一个字节都不动
  const t5 = mk("conflict")
  run(t5, [])
  writeJsonc(path.join(t5.configDir, "opencode.jsonc"), ["opencode-skill-management@1.1.0"])
  const stamp = fs.statSync(t5.dest).mtimeMs
  const r5 = run(t5, [])
  ok("J5 npm + 副本 → 冲突退出 2，不写不改", r5.code === 2 && /检测到冲突/.test(r5.text) && fs.statSync(t5.dest).mtimeMs === stamp, `code=${r5.code}`)

  // J6 --force 逃生口
  const r6 = run(t5, ["--force"])
  ok("J6 --force 绕过冲突（退出 0）", r6.code === 0, `code=${r6.code} ${r6.text}`)

  // J7 --npm 断言
  const t7a = mk("npm-flag")
  writeJsonc(path.join(t7a.configDir, "opencode.jsonc"), ["opencode-skill-management@1.1.0"])
  const r7a = run(t7a, ["--npm"])
  const t7 = mk("npm-missing")
  const r7b = run(t7, ["--npm"])
  ok("J7 --npm 有渠道=0 / 无渠道=1", r7a.code === 0 && r7b.code === 1 && /没有找到 npm 渠道/.test(r7b.text), `${r7a.code}/${r7b.code}`)

  // J8 opencode.json（非 jsonc）里的 spec 同样检出
  const t8 = mk("json")
  writeJsonc(path.join(t8.configDir, "opencode.json"), ["opencode-skill-management"])
  const r8 = run(t8, [])
  ok("J8 opencode.json 里的 spec 同样被检出", r8.code === 0 && !fs.existsSync(t8.dest) && /npm 渠道已装/.test(r8.text), `code=${r8.code}`)

  // J9 坏的 OPENCODE_CONFIG 不误判成"无冲突"，也不拦路
  const t9 = mk("bad-doc")
  const bad = path.join(t9.base, "managed.json")
  fs.writeFileSync(bad, "{ this is not json ]")
  t9.ctx.env.OPENCODE_CONFIG = bad
  const r9 = run(t9, [])
  ok("J9 无法解析的配置文档 → 记警告，不当作无冲突也不拦路", r9.code === 0 && /未验证/.test(r9.text), `code=${r9.code} ${r9.text}`)

  // J10 OPENCODE_CONFIG_DIR 优先（与宿主一致）
  const t10 = mk("config-dir")
  const custom = path.join(t10.base, "custom-config")
  t10.ctx.env.OPENCODE_CONFIG_DIR = custom
  const r10 = run(t10, [])
  const customDest = path.join(custom, "plugins", "skill_management.js")
  ok("J10 OPENCODE_CONFIG_DIR 生效（副本落在该目录）", resolveConfigDir(t10.ctx.env, t10.ctx.home) === path.resolve(custom) && r10.code === 0 && fs.existsSync(customDest), `code=${r10.code} ${customDest}`)

  // J11 项目级声明只提示，不拦全局安装
  const t11 = mk("project")
  writeJsonc(path.join(t11.base, "opencode.jsonc"), ["opencode-skill-management"])
  const r11 = run(t11, [])
  ok("J11 项目级声明只警告、不阻断", r11.code === 0 && /项目级配置/.test(r11.text) && fs.existsSync(t11.dest), `code=${r11.code}`)

  // J12 同目录另一份副本 → 冲突；内容不像本插件 → 不误报
  const t12 = mk("sibling")
  const sibling = path.join(t12.configDir, "plugins", "helper.js")
  fs.writeFileSync(sibling, 'export default { id: "skill_management", setup() {} }\n')
  const r12a = run(t12, [])
  fs.writeFileSync(sibling, 'export default { id: "something_else", setup() {} }\n')
  const r12b = run(t12, [])
  ok("J12 同目录另一份副本被检出，别家插件不误报", r12a.code === 2 && /另有一份副本/.test(r12a.text) && r12b.code === 0, `${r12a.code}/${r12b.code}`)

  // J13 --uninstall 只删自己的那一个文件
  const t13 = mk("uninstall")
  run(t13, [])
  fs.writeFileSync(path.join(t13.configDir, "skill_management.state.json"), "{}\n")
  const r13 = run(t13, ["--uninstall"])
  ok("J13 --uninstall 只删副本，保留 sidecar", r13.code === 0 && !fs.existsSync(t13.dest) && fs.existsSync(path.join(t13.configDir, "skill_management.state.json")), `code=${r13.code}`)

  // J14 内容不像本插件时拒绝删除
  const t14 = mk("uninstall-refuse")
  fs.writeFileSync(t14.dest, "console.log('not us')\n")
  const r14 = run(t14, ["--uninstall"])
  ok("J14 --uninstall 拒绝删非本插件文件", r14.code === 1 && fs.existsSync(t14.dest), `code=${r14.code}`)

  // J15 写入失败退出 1
  const t15 = mk("write-fail")
  fs.rmSync(path.join(t15.configDir, "plugins"), { recursive: true, force: true })
  fs.writeFileSync(path.join(t15.configDir, "plugins"), "占位文件，挡住目录创建\n")
  const r15 = run(t15, [])
  ok("J15 写入失败退出 1", r15.code === 1 && /写入失败/.test(r15.text), `code=${r15.code} ${r15.text}`)

  // J16 --json 形状
  const t16 = mk("json-out")
  run(t16, [])
  const r16 = run(t16, ["--json"])
  let shape = null
  try {
    shape = JSON.parse(r16.text)
  } catch {
    shape = null
  }
  ok(
    "J16 --json 输出稳定形状",
    shape && shape.schemaVersion === 1 && typeof shape.action === "string" && typeof shape.code === "number" && Array.isArray(shape.warnings),
    r16.text,
  )

  // J17 PLUGIN_VERSION 与 package.json 一致
  const pkgJ = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"))
  ok("J17 PLUGIN_VERSION === package.json.version", mod.PLUGIN_VERSION === pkgJ.version, `${mod.PLUGIN_VERSION} vs ${pkgJ.version}`)

  // J18 副本落后时给出提示
  const t18 = mk("lag")
  run(t18, [])
  fs.writeFileSync(t18.dest, fs.readFileSync(srcFile, "utf8").replace('PLUGIN_VERSION = "1.1.0"', 'PLUGIN_VERSION = "0.9.0"'))
  const r18 = run(t18, ["--check"])
  ok("J18 副本落后仓库时提示升级", r18.code === 0 && /落后仓库/.test(r18.text), `code=${r18.code} ${r18.text}`)

  // J19 decide 是纯函数
  const d = decide({ npmSpecs: [{ spec: "x" }], dirCopies: [], destExists: true, identical: false, flags: {} })
  const d2 = decide({ npmSpecs: [{ spec: "x" }], dirCopies: [], destExists: false, identical: false, flags: {} })
  ok("J19 decide 纯函数：npm+副本=冲突 / npm 独占=0", d.action === "conflict" && d.code === 2 && d2.action === "npm-active" && d2.code === 0, JSON.stringify({ d, d2 }))
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
