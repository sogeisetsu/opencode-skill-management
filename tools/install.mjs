#!/usr/bin/env node
/**
 * 单文件通道的安装器：把 src/skill_management.js 复制到 <config>/plugins/。
 *
 *   node tools/install.mjs              # 安装 / 升级副本
 *   node tools/install.mjs --check      # 只报告，不写入（同 --dry-run）
 *   node tools/install.mjs --uninstall  # 只删本插件那一个文件
 *   node tools/install.mjs --npm        # 断言走 npm 渠道，永不写文件
 *   node tools/install.mjs --force      # 无视冲突照写（有风险，自己确认）
 *   node tools/install.mjs --json       # 机器可读输出
 *
 * 为什么要有冲突检测：宿主对同一个 plugin id 只接受一份。npm 渠道
 * （opencode.json(c) 的 plugins 数组）与本文件的落点同时存在时，宿主会拒绝后加载的那份，
 * 报 `Duplicate plugin ID: skill_management`，界面上表现为"插件加载失败"。
 * 所以这里宁可拒绝，也不制造第二份。
 *
 * 退出码：0 成功/已装好；1 失败；2 冲突（什么都没写）；3 参数错误。
 *
 * 约束：只用 Node 内置模块，不调 shell，不交互，不写任何配置文件。
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const srcFile = path.join(repoRoot, "src", "skill_management.js")

const PKG_NAME = "opencode-skill-management"
const PLUGIN_ID = "skill_management"
const DEST_BASENAME = "skill_management.js"
const MAX_WALK = 12
const CONTENT_PROBE_BYTES = 64 * 1024

const EXIT_OK = 0
const EXIT_FAIL = 1
const EXIT_CONFLICT = 2
const EXIT_USAGE = 3

// ─────────────────────────────────────────────────────────────
// 路径解析（与宿主一致：OPENCODE_CONFIG_DIR 优先）
// ─────────────────────────────────────────────────────────────

export function resolveConfigDir(env = process.env, home = os.homedir()) {
  const explicit = env.OPENCODE_CONFIG_DIR
  if (explicit && explicit.trim()) return path.resolve(explicit.trim())
  const xdg = env.XDG_CONFIG_HOME
  const base = xdg && xdg.trim() ? xdg.trim() : path.join(home, ".config")
  return path.join(base, "opencode")
}

// ─────────────────────────────────────────────────────────────
// JSONC 解析（够用即可：注释 + 尾逗号）
// ─────────────────────────────────────────────────────────────

function parseJsonc(text) {
  let out = ""
  let inString = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const n = text[i + 1]
    if (inLine) {
      if (c === "\n") {
        inLine = false
        out += c
      }
      continue
    }
    if (inBlock) {
      if (c === "*" && n === "/") {
        inBlock = false
        i++
      }
      continue
    }
    if (inString) {
      out += c
      if (c === "\\") {
        out += text[i + 1] ?? ""
        i++
      } else if (c === '"') {
        inString = false
      }
      continue
    }
    if (c === '"') {
      inString = true
      out += c
      continue
    }
    if (c === "/" && n === "/") {
      inLine = true
      i++
      continue
    }
    if (c === "/" && n === "*") {
      inBlock = true
      i++
      continue
    }
    out += c
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"))
}

// ─────────────────────────────────────────────────────────────
// 扫描：谁已经装了这个插件
// ─────────────────────────────────────────────────────────────

function isOwnSpec(spec) {
  const s = String(spec).replace(/\\/g, "/").trim()
  if (!s) return false
  if (s.includes("://") || s.startsWith("github:") || s.startsWith("git@")) return s.includes(PKG_NAME)
  return new RegExp(`(^|/)(${PKG_NAME}(@|/|#|$)|${PLUGIN_ID}(/|\\.(js|ts)$|$))`).test(s)
}

function readPluginsDoc(file) {
  let text
  try {
    text = fs.readFileSync(file, "utf8")
  } catch {
    return { file, exists: false, ok: true, plugins: [] }
  }
  try {
    const doc = parseJsonc(text)
    const plugins = Array.isArray(doc?.plugins) ? doc.plugins.filter((x) => typeof x === "string") : []
    return { file, exists: true, ok: true, plugins }
  } catch (err) {
    return { file, exists: true, ok: false, error: String((err && err.message) || err), plugins: [] }
  }
}

/** 文档里指向本插件的 spec；解析失败时记成"未验证"，不当作无冲突。 */
function collectSpecs(configDir, env) {
  const docs = [path.join(configDir, "opencode.jsonc"), path.join(configDir, "opencode.json")]
  const managed = env.OPENCODE_CONFIG
  if (managed && managed.trim()) docs.push(path.resolve(managed.trim()))

  const specs = []
  const notes = []
  for (const file of docs) {
    const doc = readPluginsDoc(file)
    if (!doc.ok) {
      notes.push(`未验证：${file} 不是有效 JSONC（${doc.error}）`)
      continue
    }
    for (const spec of doc.plugins) {
      if (isOwnSpec(spec)) specs.push({ file, spec, scope: "global" })
    }
  }
  return { specs, notes }
}

/** 项目级（cwd 及祖先）只是提示：在别人的仓库里跑安装器不该被拦住。 */
function collectProjectSpecs(cwd) {
  const specs = []
  const notes = []
  let dir = path.resolve(cwd)
  for (let i = 0; i < MAX_WALK; i++) {
    const candidates = [
      path.join(dir, "opencode.jsonc"),
      path.join(dir, "opencode.json"),
      path.join(dir, ".opencode", "opencode.jsonc"),
      path.join(dir, ".opencode", "opencode.json"),
    ]
    for (const file of candidates) {
      const doc = readPluginsDoc(file)
      if (!doc.ok) {
        notes.push(`未验证：${file} 不是有效 JSONC`)
        continue
      }
      for (const spec of doc.plugins) {
        if (isOwnSpec(spec)) specs.push({ file, spec, scope: "project" })
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return { specs, notes }
}

// 本插件的文件标记：默认导出写成 `id: PLUGIN_ID`，常量声明是 `const PLUGIN_ID = "skill_management"`。
const OWN_CONTENT = /(?:id\s*:\s*["']skill_management["']|PLUGIN_ID\s*=\s*["']skill_management["'])/

function looksLikeCopy(entryPath, isDir) {
  if (isDir) return path.basename(entryPath).includes(PLUGIN_ID)
  if (!/\.(js|ts|mjs|cjs)$/.test(entryPath)) return false
  if (path.basename(entryPath).includes(PLUGIN_ID)) return true
  try {
    const fd = fs.openSync(entryPath, "r")
    try {
      const buf = Buffer.alloc(CONTENT_PROBE_BYTES)
      const n = fs.readSync(fd, buf, 0, CONTENT_PROBE_BYTES, 0)
      return OWN_CONTENT.test(buf.subarray(0, n).toString("utf8"))
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return false
  }
}

/** 同一批被扫描目录里，除目标文件外的其它副本（真的会撞 id）。 */
function collectDirCopies(configDir, dest) {
  const dirs = [path.join(configDir, "plugins"), path.join(configDir, "plugin")]
  const copies = []
  for (const dir of dirs) {
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (path.resolve(full) === path.resolve(dest)) continue
      if (looksLikeCopy(full, entry.isDirectory())) copies.push({ file: full, kind: entry.isDirectory() ? "directory" : "file" })
    }
  }
  return copies
}

function collectOtherInstallHints(configDir, home) {
  const warnings = []
  const defaultConfig = path.join(home, ".config", "opencode")
  if (path.resolve(configDir) !== path.resolve(defaultConfig)) {
    const stale = collectDirCopies(defaultConfig, path.join(defaultConfig, "plugins", DEST_BASENAME))
    for (const copy of stale) warnings.push(`另一处配置目录里也有副本：${copy.file}（宿主不会扫它，但别让它变成僵尸）`)
  }
  const pkgFile = path.join(configDir, "package.json")
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"))
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    if (deps[PKG_NAME]) warnings.push(`${pkgFile} 的依赖里有 ${PKG_NAME}；依赖本身不会被当插件加载，真正生效的是 plugins 数组`)
  } catch {
    /* 没有或不可解析都不影响判断 */
  }
  return warnings
}

/** 本机 npm 缓存里出现过的包版本（纯本地信息，不联网）。 */
function collectCachedNpmVersions(home, env) {
  const roots = [path.join(home, ".cache", "opencode", "npm")]
  const xdgCache = env.XDG_CACHE_HOME
  if (xdgCache && xdgCache.trim()) roots.push(path.join(xdgCache.trim(), "opencode", "npm"))
  const versions = []
  for (const root of roots) {
    let entries = []
    try {
      entries = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const m = /^opencode-skill-management@(.+)$/.exec(entry.name)
      if (m && !versions.includes(m[1])) versions.push(m[1])
    }
  }
  return versions.sort(compareVersions)
}

function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x))
  const pb = String(b).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i]
    const y = pb[i]
    if (x === y) continue
    if (typeof x === "number" && typeof y === "number") return x < y ? -1 : 1
    if (typeof x === "number") return -1
    if (typeof y === "number") return 1
    return String(x) < String(y) ? -1 : 1
  }
  return 0
}

function readRepoVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version ?? null
  } catch {
    return null
  }
}

function readFileVersion(file) {
  try {
    const text = fs.readFileSync(file, "utf8")
    const m = /PLUGIN_VERSION\s*=\s*["']([^"']+)["']/.exec(text)
    return m ? m[1] : null
  } catch {
    return null
  }
}

function readNpmSpecVersion(spec) {
  const m = new RegExp(`${PKG_NAME}(?:@([^/#]+))?`).exec(String(spec))
  return m && m[1] ? m[1] : null
}

// ─────────────────────────────────────────────────────────────
// 决策（纯函数，便于测试）
// ─────────────────────────────────────────────────────────────

export function decide({ npmSpecs, dirCopies, destExists, identical, flags }) {
  if (flags.npm) {
    if (npmSpecs.length === 0) return { action: "npm-missing", code: EXIT_FAIL }
    return { action: destExists ? "conflict" : "npm-active", code: destExists ? EXIT_CONFLICT : EXIT_OK }
  }
  if (dirCopies.length > 0 && !flags.force) return { action: "conflict", code: EXIT_CONFLICT }
  if (npmSpecs.length > 0 && !flags.force) {
    return destExists ? { action: "conflict", code: EXIT_CONFLICT } : { action: "npm-active", code: EXIT_OK }
  }
  if (destExists) return { action: identical ? "unchanged" : "updated", code: EXIT_OK }
  return { action: "installed", code: EXIT_OK }
}

// ─────────────────────────────────────────────────────────────
// 输出
// ─────────────────────────────────────────────────────────────

function describe(result, ctx, out) {
  const { action, code, configDir, dest, repoVersion, destVersion, npmSpecs, dirCopies, warnings, changed } = result
  if (ctx.json) {
    out(
      JSON.stringify(
        {
          schemaVersion: 1,
          action,
          ok: code === EXIT_OK,
          code,
          changed,
          configDir,
          dest,
          version: { repo: repoVersion, copy: destVersion, npm: npmSpecs.map((s) => ({ spec: s.spec, version: readNpmSpecVersion(s.spec), file: s.file })) },
          conflicts: { npmSpecs, dirCopies },
          warnings,
        },
        null,
        2,
      ),
    )
    return
  }

  const head = {
    installed: `已安装：${dest}`,
    updated: `已更新：${dest}`,
    unchanged: `已是最新，无需写入：${dest}`,
    "npm-active": `npm 渠道已装（${npmSpecs.map((s) => s.spec).join(", ")}），未写入文件`,
    conflict: "检测到冲突，什么都没写",
    "npm-missing": "没有找到 npm 渠道的安装记录",
    uninstalled: "已删除单文件副本",
    "uninstall-refused": "拒绝删除：文件内容不像本插件",
  }[action]
  out(`${ctx.dryRun ? "[dry-run] " : ""}${head ?? action}`)

  if (action === "conflict") {
    if (npmSpecs.length) out(`  npm 渠道：${npmSpecs.map((s) => `${s.spec}  ← ${s.file}`).join("\n            ")}`)
    if (dirCopies.length) out(`  另有一份副本：${dirCopies.map((c) => `${c.file}${c.kind === "directory" ? "（目录）" : ""}`).join("\n                ")}`)
    out("")
    out("同一个 plugin id 只能有一份，宿主会给后加载的那份报 `Duplicate plugin ID`。二选一：")
    if (dirCopies.length) out("  · 删掉多余那份：node tools/install.mjs --uninstall")
    if (npmSpecs.length) out("  · 想继续用单文件：先在配置里去掉 npm 条目（opencode plugin remove opencode-skill-management），再重跑本脚本")
    out("  · 确认要两份都在：node tools/install.mjs --force")
  }

  if (action === "npm-active") {
    out(`  升级走宿主：opencode plugin check && opencode plugin update`)
    out(`  单文件副本不是必须的；本脚本不会再往 <config>/plugins/ 里写东西`)
  }

  if (repoVersion || destVersion) {
    out(`  版本：仓库 ${repoVersion ?? "?"} / 副本 ${destVersion ?? "未知"}`)
  }
  for (const w of warnings) out(`  ! ${w}`)

  if (changed) {
    try {
      const others = fs
        .readdirSync(path.dirname(dest))
        .filter((n) => n !== DEST_BASENAME)
      if (others.length) out(`  插件目录另含 ${others.length} 个其它条目：${others.slice(0, 8).join(", ")}${others.length > 8 ? " …" : ""}`)
    } catch {
      /* 目录刚创建，忽略 */
    }
  }
  out("")
  out("新进程复核：opencode plugin list --builtin   # 应出现 skill_management")
}

// ─────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const flags = { dryRun: false, json: false, force: false, npm: false, uninstall: false, help: false }
  for (const arg of argv) {
    if (arg === "--dry-run" || arg === "--check") flags.dryRun = true
    else if (arg === "--json") flags.json = true
    else if (arg === "--force") flags.force = true
    else if (arg === "--npm") flags.npm = true
    else if (arg === "--uninstall") flags.uninstall = true
    else if (arg === "--help" || arg === "-h") flags.help = true
    else return { flags, unknown: arg }
  }
  return { flags, unknown: null }
}

export function main(argv = process.argv.slice(2), ctx = {}) {
  const env = ctx.env ?? process.env
  const home = ctx.home ?? os.homedir()
  const cwd = ctx.cwd ?? process.cwd()
  const out = ctx.log ?? ((line) => console.log(line))
  const state = { env, home, cwd, log: out, json: false }

  const { flags, unknown } = parseArgs(argv)
  if (unknown) {
    out(`未知参数：${unknown}`)
    out("用法：node tools/install.mjs [--check|--dry-run] [--uninstall] [--npm] [--force] [--json]")
    return EXIT_USAGE
  }
  state.json = flags.json
  state.dryRun = flags.dryRun
  if (flags.help) {
    out("用法：node tools/install.mjs [--check|--dry-run] [--uninstall] [--npm] [--force] [--json]")
    out("")
    out("  --check / --dry-run  只报告现状与冲突，不写任何文件")
    out("  --uninstall          删除 <config>/plugins/skill_management.js（仅此一个文件）")
    out("  --npm                断言 npm 渠道已装，永不写文件")
    out("  --force              无视冲突照写（会制造两份，宿主会给其中一份报 Duplicate plugin ID）")
    out("  --json               机器可读输出")
    return EXIT_OK
  }

  if (!fs.existsSync(srcFile)) {
    out(`源文件不存在：${srcFile}`)
    return EXIT_FAIL
  }

  const configDir = resolveConfigDir(env, home)
  const pluginsDir = path.join(configDir, "plugins")
  const dest = path.join(pluginsDir, DEST_BASENAME)
  const repoVersion = readRepoVersion()
  const content = fs.readFileSync(srcFile)

  let current = null
  try {
    current = fs.readFileSync(dest)
  } catch {
    current = null
  }
  const destExists = current !== null
  const identical = destExists && current.equals(content)

  if (flags.uninstall) {
    if (!destExists) {
      describe({ action: "uninstalled", code: EXIT_OK, configDir, dest, repoVersion, destVersion: null, npmSpecs: [], dirCopies: [], warnings: ["目标文件不存在，无需删除"], changed: false }, state, out)
      return EXIT_OK
    }
    if (!OWN_CONTENT.test(current.toString("utf8"))) {
      describe({ action: "uninstall-refused", code: EXIT_FAIL, configDir, dest, repoVersion, destVersion: null, npmSpecs: [], dirCopies: [], warnings: [`${dest} 里没有 ${PLUGIN_ID} 的标记，没有删`], changed: false }, state, out)
      return EXIT_FAIL
    }
    fs.rmSync(dest, { force: true })
    describe({ action: "uninstalled", code: EXIT_OK, configDir, dest, repoVersion, destVersion: null, npmSpecs: [], dirCopies: [], warnings: flags.dryRun ? ["dry-run：实际没有删除"] : [], changed: !flags.dryRun }, state, out)
    return EXIT_OK
  }

  const { specs: npmSpecs, notes } = collectSpecs(configDir, env)
  const project = collectProjectSpecs(cwd)
  const dirCopies = collectDirCopies(configDir, dest)
  const warnings = [...notes, ...project.notes]
  for (const s of project.specs) warnings.push(`项目级配置也声明了本插件：${s.spec} ← ${s.file}（在该项目里会撞 id）`)

  const destVersion = readFileVersion(dest)
  const cached = collectCachedNpmVersions(home, env)
  if (destVersion && repoVersion && compareVersions(destVersion, repoVersion) < 0) {
    warnings.push(`副本 v${destVersion} 落后仓库 v${repoVersion}，重跑 \`node tools/install.mjs\` 升级（单文件通道不会自动更新）`)
  } else if (destVersion && repoVersion && compareVersions(destVersion, repoVersion) > 0) {
    warnings.push(`副本 v${destVersion} 比仓库 v${repoVersion} 新，可能来自更新的 npm 包；以你想要的渠道为准`)
  } else if (destExists && !destVersion) {
    warnings.push("副本里没有 PLUGIN_VERSION（1.1.0 及更早的版本没有这个常量），只能按字节比对判断是否最新")
  }
  const newestCached = cached.filter((v) => !repoVersion || compareVersions(v, repoVersion) > 0)
  if (newestCached.length) {
    warnings.push(`本机 npm 缓存里已有 v${newestCached[newestCached.length - 1]}（比仓库新）；想跟着 npm 更新就改用 npm 渠道`)
  }
  warnings.push(...collectOtherInstallHints(configDir, home))

  const decision = decide({ npmSpecs, dirCopies, destExists, identical, flags })

  if (flags.dryRun) {
    describe({ ...decision, configDir, dest, repoVersion, destVersion, npmSpecs, dirCopies, warnings, changed: false }, state, out)
    return decision.code
  }

  if (decision.code !== EXIT_OK) {
    describe({ ...decision, configDir, dest, repoVersion, destVersion, npmSpecs, dirCopies, warnings, changed: false }, state, out)
    return decision.code
  }

  if (decision.action === "unchanged" || decision.action === "npm-active") {
    describe({ ...decision, configDir, dest, repoVersion, destVersion, npmSpecs, dirCopies, warnings, changed: false }, state, out)
    return EXIT_OK
  }

  try {
    fs.mkdirSync(pluginsDir, { recursive: true })
    fs.writeFileSync(dest, content)
    const check = fs.readFileSync(dest)
    if (!check.equals(content)) {
      out(`写入后校验失败：${dest}`)
      return EXIT_FAIL
    }
  } catch (err) {
    out(`写入失败：${dest} — ${String((err && err.message) || err)}`)
    return EXIT_FAIL
  }

  describe({ ...decision, configDir, dest, repoVersion, destVersion: readFileVersion(dest), npmSpecs, dirCopies, warnings, changed: true }, state, out)
  return EXIT_OK
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (invokedDirectly) process.exit(main(process.argv.slice(2)))
