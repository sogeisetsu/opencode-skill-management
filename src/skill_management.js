/**
 * skill_management — OpenCode V2 plugin
 *
 * 一个工具，四个动作：list / inspect / disable / enable。
 * 唯一的写操作是：在全局配置里增删一条 skill permission 规则。
 * 不装、不删、不移动、不改写任何 skill 文件；不碰 SKILL.md frontmatter。
 *
 * 约束（与规范 §1 / §4 对齐）：
 *  - 只用 Node 内置模块；不引入第三方依赖；不调用 shell。
 *  - 单文件。`<config>/plugins/` 下的任何 `.js` 文件都会被宿主当作插件加载，
 *    所以辅助代码不能拆成同目录的第二个文件（会被当成插件而校验失败）。
 *  - 写 JSONC 用最小文本编辑，保留注释、缩进、键顺序；保留 BOM 与换行风格。
 *  - 工具名唯一来源是 add({ name })；文件名叫什么无关。
 */

import fs from "node:fs"
import path from "node:path"
import os from "node:os"

// ─────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────

const TOOL_NAME = "skill_management"
const PLUGIN_ID = "skill_management"
const MARKER = "skill_management" // 归属标记（same-line trailing comment）
const SIDECAR_BASENAME = "skill_management.state.json"
const BACKUP_DIRNAME = "skill_management.backups"
// §11.2：只留 1 份。备份是目标文件的逐字节副本，而该文件常含 MCP 凭据，副本越少越好；
// 「跨会话后悔药」由原子写 + 进程内失败回滚覆盖。
const MAX_BACKUPS = 1
const SIDECAR_VERSION = 1
const PERMISSION_ACTION = "skill" // 宿主对 skill 的权限 action 字面量

// ─────────────────────────────────────────────────────────────
// glob（只支持 * 与 ?，与宿主一致）
// ─────────────────────────────────────────────────────────────

function globToRegExp(pattern) {
  let out = "^"
  for (const ch of String(pattern)) {
    if (ch === "*") out += "[\\s\\S]*"
    else if (ch === "?") out += "[\\s\\S]"
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(out + "$")
}

// C4：无通配时 globToRegExp 就是对整串字面转义，因此「字面比较」是严格等价的快路径（零正则）。
// 有通配时按模式缓存编译结果 —— list 一轮要做上万次匹配，重复编译纯属浪费。
// 缓存设上界：插件常驻宿主进程，配置反复变更时不能让 Map 无界增长。
const GLOB_CACHE_CAP = 256
const globCache = new Map()

export function globMatch(pattern, value) {
  // 参数顺序与宿主一致：matching(值, 模式)
  const p = String(pattern)
  const v = String(value)
  if (!p.includes("*") && !p.includes("?")) return p === v
  let re = globCache.get(p)
  if (re === undefined) {
    if (globCache.size >= GLOB_CACHE_CAP) globCache.clear()
    re = globToRegExp(p)
    globCache.set(p, re)
  }
  return re.test(v)
}

// ─────────────────────────────────────────────────────────────
// JSONC：带偏移的 tokenizer + parser
// ─────────────────────────────────────────────────────────────

function isJsoncSpace(c) {
  return c === " " || c === "\t" || c === "\n" || c === "\r"
}

export function tokenizeJsonc(text) {
  const tokens = []
  const n = text.length
  let i = 0
  while (i < n) {
    const c = text[i]
    if (isJsoncSpace(c)) {
      i++
      continue
    }
    if (c === "/" && text[i + 1] === "/") {
      const s = i
      while (i < n && text[i] !== "\n") i++
      tokens.push({ t: "comment", v: text.slice(s, i), s, e: i })
      continue
    }
    if (c === "/" && text[i + 1] === "*") {
      const s = i
      i += 2
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++
      i = Math.min(n, i + 2)
      tokens.push({ t: "comment", v: text.slice(s, i), s, e: i })
      continue
    }
    if (c === '"') {
      const s = i
      i++
      while (i < n) {
        if (text[i] === "\\") {
          i += 2
          continue
        }
        if (text[i] === '"') {
          i++
          break
        }
        i++
      }
      let v
      try {
        v = JSON.parse(text.slice(s, i))
      } catch {
        v = text.slice(s + 1, Math.max(s + 1, i - 1))
      }
      tokens.push({ t: "string", v, s, e: i })
      continue
    }
    if ("{}[],:".includes(c)) {
      tokens.push({ t: "punct", v: c, s: i, e: i + 1 })
      i++
      continue
    }
    const s = i
    while (i < n && !",:{}[]".includes(text[i]) && !isJsoncSpace(text[i]) && text[i] !== "/") i++
    if (i === s) {
      i++
      continue
    }
    const raw = text.slice(s, i)
    if (raw === "true") tokens.push({ t: "literal", v: true, s, e: i })
    else if (raw === "false") tokens.push({ t: "literal", v: false, s, e: i })
    else if (raw === "null") tokens.push({ t: "literal", v: null, s, e: i })
    else tokens.push({ t: "number", v: Number(raw), s, e: i, raw })
  }
  return tokens
}

/**
 * 解析 JSONC，返回带偏移的 AST。
 * 节点形状：
 *   { type:"object", start, end, props:[{key, keyStart, keyEnd, value}] }
 *   { type:"array",  start, end, items:[node] }
 *   { type:"string"|"number"|"literal", start, end, value }
 */
export function parseJsonc(text) {
  const toks = tokenizeJsonc(text).filter((t) => t.t !== "comment")
  let p = 0

  function peek() {
    return toks[p]
  }
  function next() {
    return toks[p++]
  }

  function parseValue() {
    const tk = peek()
    if (!tk) throw new Error("JSONC 解析失败：输入意外结束")
    if (tk.t === "punct" && tk.v === "{") return parseObject()
    if (tk.t === "punct" && tk.v === "[") return parseArray()
    next()
    return { type: tk.t, start: tk.s, end: tk.e, value: tk.v }
  }

  function parseObject() {
    const open = next()
    const node = { type: "object", start: open.s, end: open.e, props: [] }
    for (;;) {
      const tk = peek()
      if (!tk) throw new Error("JSONC 解析失败：对象未闭合")
      if (tk.t === "punct" && tk.v === "}") {
        node.end = next().e
        return node
      }
      if (tk.t === "punct" && tk.v === ",") {
        next()
        continue
      }
      if (tk.t !== "string") throw new Error(`JSONC 解析失败：期望键字符串，实际 ${JSON.stringify(tk.v)}`)
      const key = next()
      const colon = next()
      if (!colon || colon.t !== "punct" || colon.v !== ":") throw new Error("JSONC 解析失败：期望 ':'")
      const value = parseValue()
      node.props.push({ key: key.v, keyStart: key.s, keyEnd: key.e, value })
    }
  }

  function parseArray() {
    const open = next()
    const node = { type: "array", start: open.s, end: open.e, items: [] }
    for (;;) {
      const tk = peek()
      if (!tk) throw new Error("JSONC 解析失败：数组未闭合")
      if (tk.t === "punct" && tk.v === "]") {
        node.end = next().e
        return node
      }
      if (tk.t === "punct" && tk.v === ",") {
        next()
        continue
      }
      node.items.push(parseValue())
    }
  }

  const root = parseValue()
  if (p !== toks.length) throw new Error("JSONC 解析失败：根值之后仍有内容")
  return root
}

/** 去掉注释后按严格 JSON 校验（用于捕获尾逗号这类"宽容解析看不出来"的问题） */
export function strictValidate(text) {
  // C5：按 token 偏移拼接，注释区间替换成**等长**空白（保留 CRLF）。
  // 旧写法把整份配置展开成字符数组（60 KB 配置约 2.6 ms），写路径最多调用 3 次。
  const toks = tokenizeJsonc(text)
  let out = ""
  let last = 0
  for (const t of toks) {
    if (t.t !== "comment") continue
    out += text.slice(last, t.s) + t.v.replace(/[^\r\n]/g, " ")
    last = t.e
  }
  JSON.parse(out + text.slice(last))
}

export function findTopLevelProp(root, key) {
  if (!root || root.type !== "object") return undefined
  for (let i = root.props.length - 1; i >= 0; i--) if (root.props[i].key === key) return root.props[i]
  return undefined
}

/** 顶层 permissions 数组项；没有该键或不是数组时返回 null（不猜） */
function permissionsItems(root) {
  const perm = findTopLevelProp(root, "permissions")
  return perm && perm.value.type === "array" ? perm.value.items : null
}

// ─────────────────────────────────────────────────────────────
// 文本编辑原语
// ─────────────────────────────────────────────────────────────

export function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end)
  let out = text
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}

export function detectEol(text) {
  const i = text.indexOf("\n")
  return i > 0 && text[i - 1] === "\r" ? "\r\n" : "\n"
}

/** 只返回"从行首到 pos 全是空白"时的这段空白，否则 null */
export function lineIndentAt(text, pos) {
  const ls = text.lastIndexOf("\n", pos - 1) + 1
  const lead = text.slice(ls, pos)
  return /^[ \t]*$/.test(lead) ? lead : null
}

function lineBounds(text, pos) {
  const ls = text.lastIndexOf("\n", pos - 1) + 1
  let le = text.indexOf("\n", pos)
  const eolLen = le === -1 ? 0 : text[le - 1] === "\r" ? 2 : 1
  if (le === -1) le = text.length
  else if (eolLen === 2) le -= 1
  return { ls, le, eolLen: le === text.length ? 0 : eolLen }
}

export function ruleText(id, effect) {
  return `{ "action": ${JSON.stringify(PERMISSION_ACTION)}, "resource": ${JSON.stringify(id)}, "effect": ${JSON.stringify(effect)} }`
}

/** 返回 b 相对 a 的"新增/改动"行区间（去掉公共前缀与公共后缀） */
export function changedRegion(a, b) {
  const al = a.split(/\r?\n/)
  const bl = b.split(/\r?\n/)
  let i = 0
  while (i < al.length && i < bl.length && al[i] === bl[i]) i++
  let j = 0
  while (j < al.length - i && j < bl.length - i && al[al.length - 1 - j] === bl[bl.length - 1 - j]) j++
  return bl.slice(i, bl.length - j)
}

/**
 * 在顶层 permissions 数组末尾追加一条规则（带归属标记；标记写在同行尾注释，便于按行精确删除）。
 * 返回 { text, createdBlock }
 */
export function insertRule(text, id, effect, opts = {}) {
  const indentUnit = opts.indentUnit ?? "  "
  const eol = detectEol(text)
  const root = parseJsonc(text)
  if (root.type !== "object") throw new Error("目标配置的根不是对象，已中止")
  const perm = findTopLevelProp(root, "permissions")
  const item = ruleText(id, effect)

  if (perm) {
    if (perm.value.type !== "array") throw new Error("顶层 permissions 不是数组，已中止（不代改非本工具写入的形状）")
    const arr = perm.value
    const closeIdx = arr.end - 1
    if (arr.items.length === 0) {
      const bracketIndent = lineIndentAt(text, closeIdx) ?? ""
      const itemIndent = bracketIndent + indentUnit
      const ins = `${eol}${itemIndent}${item} // ${MARKER}${eol}${bracketIndent}`
      return { text: applyEdits(text, [{ start: closeIdx, end: closeIdx, text: ins }]), createdBlock: false }
    }
    const last = arr.items[arr.items.length - 1]
    const itemIndent = lineIndentAt(text, last.start) ?? indentUnit
    // 逗号插在上一项结尾（必须在它的行尾注释之前），新项插在上一项所在行的行尾之后。
    // 否则会把上一项的 // skill_management 标记推到新行的行尾。
    const { le: lastLe } = lineBounds(text, last.start)
    const tail = text.slice(last.end, lastLe)
    const canUseLineEnd = !tail.includes("]")
    if (canUseLineEnd) {
      // 关键：当上一项没有行尾注释时 last.end === lastLe，两个编辑落在同一偏移上会互相错位，
      // 因此必须合并成一次插入（逗号 + 换行 + 新项）。
      if (tail.length === 0) {
        const ins = `,${eol}${itemIndent}${item} // ${MARKER}`
        return { text: applyEdits(text, [{ start: last.end, end: last.end, text: ins }]), createdBlock: false }
      }
      // 上一项带行尾注释（例如本工具此前写入的标记）：逗号必须插在注释之前，新项插在注释之后的行尾
      const edits = [
        { start: last.end, end: last.end, text: "," },
        { start: lastLe, end: lastLe, text: `${eol}${itemIndent}${item} // ${MARKER}` },
      ]
      return { text: applyEdits(text, edits), createdBlock: false }
    }
    // 退化情形（数组与项在同一行）：插在 ] 之前
    const bracketIndent = lineIndentAt(text, closeIdx) ?? itemIndent
    // `]` 紧跟最后一项时两个编辑落在同一偏移（closeIdx === last.end），分开应用会把逗号插到
    // 新项之后 → 得到 `...,\n  {新项}\n  ,]}` 这种非法结果。必须合并成一次插入。
    if (closeIdx === last.end) {
      const ins = `,${eol}${itemIndent}${item} // ${MARKER}${eol}${bracketIndent}`
      return { text: applyEdits(text, [{ start: last.end, end: last.end, text: ins }]), createdBlock: false }
    }
    const edits = [
      { start: last.end, end: last.end, text: "," },
      { start: closeIdx, end: closeIdx, text: `${eol}${itemIndent}${item} // ${MARKER}${eol}${bracketIndent}` },
    ]
    return { text: applyEdits(text, edits), createdBlock: false }
  }

  // 顶层没有 permissions：整块新建
  const closeBrace = root.end - 1
  const keyIndent = root.props.length > 0 ? (lineIndentAt(text, root.props[0].keyStart) ?? indentUnit) : indentUnit
  const itemIndent = keyIndent + indentUnit
  const block =
    `"permissions": [` +
    `${eol}${itemIndent}${item} // ${MARKER}` +
    `${eol}${keyIndent}]`
  if (root.props.length === 0) {
    const ins = `${eol}${keyIndent}${block}${eol}${lineIndentAt(text, closeBrace) ?? ""}`
    return { text: applyEdits(text, [{ start: closeBrace, end: closeBrace, text: ins }]), createdBlock: true }
  }
  const lastProp = root.props[root.props.length - 1]
  const ins = `,${eol}${keyIndent}${block}`
  return { text: applyEdits(text, [{ start: lastProp.value.end, end: lastProp.value.end, text: ins }]), createdBlock: true }
}

/**
 * 若顶层 permissions 数组已为空，则把整个属性块删掉（只在确实是我们新建的块时调用）。
 * 返回新文本；无法得到合法结果时返回 null。
 */
export function removePermissionsBlockIfEmpty(text) {
  const root = parseJsonc(text)
  const perm = findTopLevelProp(root, "permissions")
  if (!perm || perm.value.type !== "array" || perm.value.items.length !== 0) return null

  const ls = text.lastIndexOf("\n", perm.keyStart - 1) + 1
  const { le: vLe, eolLen: vEol } = lineBounds(text, perm.value.end - 1)
  const endOfBlock = vLe + vEol
  let line = null
  try {
    line = lineIndentAt(text, perm.keyStart)
  } catch {
    line = null
  }
  if (line === null) return null

  const base = text.slice(0, ls) + text.slice(endOfBlock)
  const candidates = [base]

  // 前面可能还留着逗号（本属性原本不是最后一个键）
  const toks = tokenizeJsonc(text)
  let commaIdx = -1
  for (let i = toks.length - 1; i >= 0; i--) {
    const t = toks[i]
    if (t.e <= ls) {
      if (t.t === "comment") continue
      if (t.t === "punct" && t.v === ",") commaIdx = t.s
      break
    }
  }
  if (commaIdx >= 0) candidates.push(base.slice(0, commaIdx) + base.slice(commaIdx + 1))

  for (const c of candidates) {
    try {
      strictValidate(c)
      parseJsonc(c)
      return c
    } catch {
      /* 试下一个 */
    }
  }
  return null
}

/** 找到携带本工具标记、且 resource === id 的数组项 */
export function findMarkedItem(text, id) {
  for (const item of findAllExactItems(text, id)) if (itemHasMarker(text, item)) return item
  return undefined
}

/** 列出配置里所有"精确命中该 id 的全局规则"（action 匹配 skill）—— 歧义判据用 */
export function exactItems(root, id) {
  const items = permissionsItems(root)
  if (!items) return []
  const hits = []
  for (const item of items) {
    if (item.type !== "object") continue
    const a = findTopLevelProp(item, "action")
    const r = findTopLevelProp(item, "resource")
    if (!a || !r) continue
    if (typeof a.value.value === "string" && globMatch(a.value.value, PERMISSION_ACTION) && r.value.value === id) hits.push(item)
  }
  return hits
}

/** 薄包装：从文本解析后再取。已有 root 的调用方（enable）直接用 exactItems，避免重复 parse */
export function findAllExactItems(text, id) {
  return exactItems(parseJsonc(text), id)
}

/** 该数组项是否带本工具标记（§4.3：标记写在规则所在行的行尾） */
export function itemHasMarker(text, item) {
  const { le } = lineBounds(text, item.start)
  return text.slice(item.end, le).includes(MARKER)
}

export function itemTriple(item) {
  const g = (k) => findTopLevelProp(item, k)?.value.value
  return { action: g("action"), resource: g("resource"), effect: g("effect") }
}

/**
 * 删除一条规则所在的整行；若结果非法（悬空逗号等）再尝试删掉前面那个逗号。
 * 只在结果通过严格校验时才返回；否则抛错（调用方回滚）。
 */
export function removeRuleByLine(text, item) {
  const { ls, le, eolLen } = lineBounds(text, item.start)
  const endOfLine = le + eolLen
  const withoutLine = text.slice(0, ls) + text.slice(endOfLine)

  const candidates = [withoutLine]

  // 悬空逗号：删掉该行之前最近的一个逗号字符（只删 1 个字符，绝不吞注释）
  const toks = tokenizeJsonc(text)
  let commaIdx = -1
  for (let i = toks.length - 1; i >= 0; i--) {
    const t = toks[i]
    if (t.e <= ls) {
      if (t.t === "comment") continue
      if (t.t === "punct" && t.v === ",") commaIdx = t.s
      break
    }
  }
  if (commaIdx >= 0) candidates.push(withoutLine.slice(0, commaIdx) + withoutLine.slice(commaIdx + 1))

  for (const c of candidates) {
    try {
      strictValidate(c)
      parseJsonc(c)
      return c
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error("删除后无法得到合法 JSONC，已中止（文件未被修改）")
}

// ─────────────────────────────────────────────────────────────
// 文件读写：保留 BOM 与换行风格
// ─────────────────────────────────────────────────────────────

export function readTextFile(file) {
  const buf = fs.readFileSync(file)
  let text = buf.toString("utf8")
  let bom = false
  if (text.charCodeAt(0) === 0xfeff) {
    bom = true
    text = text.slice(1)
  }
  return { text, bom, eol: detectEol(text) }
}

export function writeTextFile(file, text, bom) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // §11.2：原子写 —— 同目录先写 <file>.tmp，再 rename 覆盖。
  // rename 在同一文件系统内是原子的，因此不会出现「写到一半被截断」的中间状态；
  // 这也是把备份降到 1 份的前提（与宿主的配置写入方式一致）。
  const tmp = `${file}.tmp`
  try {
    fs.writeFileSync(tmp, (bom ? "\ufeff" : "") + text, "utf8")
    fs.renameSync(tmp, file)
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* 清理临时文件失败不覆盖原始错误 */
    }
    throw err
  }
}

// ─────────────────────────────────────────────────────────────
// 配置目录与目标文件解析
// ─────────────────────────────────────────────────────────────

export function resolveConfigDir(env = process.env, home = os.homedir()) {
  const xdg = env.XDG_CONFIG_HOME
  const base = xdg && xdg.trim() ? xdg : path.join(home, ".config")
  return path.join(base, "opencode")
}

/** 把 permissions 数组项映射成 { action, resource, effect } 三元组（读不出的字段留 undefined） */
function itemsToRules(items) {
  return (items ?? [])
    .map((it) => {
      const g = (k) => {
        const p = findTopLevelProp(it, k)
        return p ? p.value.value : undefined
      }
      return { action: g("action"), resource: g("resource"), effect: g("effect") }
    })
    .filter((r) => r && r.resource)
}

/** 读取目标配置文件里实际的 permissions 规则集；读不到返回 null（不猜） */
export function readConfigRules(file) {
  try {
    const { text } = readTextFile(file)
    return itemsToRules(permissionsItems(parseJsonc(text)))
  } catch {
    return null
  }
}

/**
 * C3：一次读盘 + 一次解析，同时带出「是否有 permissions 数组」与已解析文档。
 * resolveTargetConfig 为判断"哪个文件含 permissions"本来就要读一遍，结果却丢掉、后面再读一遍。
 * 读不到 / 解析失败 → null（调用方按"该文件不含权限配置"处理，与旧 fileHasPermissions 一致）。
 */
function readPermissionsDoc(file) {
  try {
    const { text, bom, eol } = readTextFile(file)
    const root = parseJsonc(text)
    const items = permissionsItems(root)
    return { file, text, bom, eol, root, items }
  } catch {
    return null
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * 目标文件解析。规则（按序，全部写进输出，便于人/脚本核对）：
 *  1. 候选目录：XDG 解析出的 <config>，以及 ~/.config/opencode（两者相同时去重）。
 *  2. 若只有一处存在"含 permissions 的配置"→ 用它（同目录内 jsonc 优先于 json）。
 *  3. 若两处都有 → 按规范 §4.1 的实测提醒，选 ~/.config/opencode 下的文件（优先 jsonc，其次 json），
 *     并在输出里标注"两个目录都有权限配置"。
 *  4. 都不存在 → 在 XDG 解析出的 <config> 下新建 opencode.jsonc。
 */
export function resolveTargetConfig(env = process.env, home = os.homedir()) {
  const configDir = resolveConfigDir(env, home)
  const homeConfigDir = path.join(home, ".config", "opencode")
  const dirs = configDir === homeConfigDir ? [configDir] : [configDir, homeConfigDir]
  const names = ["opencode.json", "opencode.jsonc"] // jsonc 优先 → 取最后一个命中

  // 候选文件只读一次：已解析文档随返回值带出（doc），调用方不必二次读盘解析。
  const docs = new Map()
  const withPerms = []
  for (const d of dirs) {
    for (const n of names) {
      const f = path.join(d, n)
      if (!isFile(f)) continue
      const doc = readPermissionsDoc(f)
      if (!doc) continue // 读不到 / 解析失败 → 与旧 fileHasPermissions 一致：视作不含权限配置
      docs.set(f, doc)
      if (doc.items !== null) withPerms.push(f)
    }
  }
  const docFor = (f) => docs.get(f) ?? readPermissionsDoc(f) ?? undefined

  const notes = []
  if (withPerms.length === 0) {
    const existing = names.map((n) => path.join(configDir, n)).filter(isFile)
    const file = existing.length > 0 ? existing[existing.length - 1] : path.join(configDir, "opencode.jsonc")
    notes.push(existing.length === 0 ? "未找到现有配置，将新建 opencode.jsonc" : "没有文档含 permissions，按候选顺序选最后一个已存在的文档")
    return { file, configDir, configDirs: dirs, hadPermissions: false, notes, doc: docFor(file) }
  }

  const inConfig = withPerms.filter((f) => path.dirname(f) === configDir)
  const inHome = withPerms.filter((f) => path.dirname(f) === homeConfigDir)

  if (inConfig.length > 0 && inHome.length > 0 && configDir !== homeConfigDir) {
    const pick = path.join(homeConfigDir, "opencode.jsonc")
    notes.push(
      `⚠️ ${configDir} 与 ${homeConfigDir} 都含权限配置；按规范 §4.1 取其一的实测提醒，写入 ~/.config/opencode 下的文件`,
    )
    const file = isFile(pick) ? pick : path.join(homeConfigDir, "opencode.json")
    return {
      file,
      configDir,
      configDirs: dirs,
      hadPermissions: true,
      notes,
      doc: docFor(file),
    }
  }

  const pool = inConfig.length > 0 ? inConfig : inHome
  const file = pool[pool.length - 1]
  notes.push("目标文件含现有 permissions，直接在其数组中追加/删除")
  return { file, configDir, configDirs: dirs, hadPermissions: true, notes, doc: docFor(file) }
}

// ─────────────────────────────────────────────────────────────
// sidecar
// ─────────────────────────────────────────────────────────────

export function sidecarPath(configDir) {
  return path.join(configDir, SIDECAR_BASENAME)
}

export function loadSidecar(configDir) {
  const file = sidecarPath(configDir)
  try {
    const { text } = readTextFile(file)
    const data = JSON.parse(text)
    if (!data || typeof data !== "object" || !Array.isArray(data.rules)) throw new Error("结构不符：期望 { version, rules: [] }")
    // 未知版本 = 别的/更晚的工具写的记录 → 不猜它的语义，按"读不到"处理（只报告，不重建）。
    if (data.version !== undefined && data.version !== SIDECAR_VERSION) throw new Error(`不支持的 version：${JSON.stringify(data.version)}`)
    return { file, version: data.version ?? SIDECAR_VERSION, rules: data.rules, ok: true }
  } catch (err) {
    return { file, version: SIDECAR_VERSION, rules: [], ok: !fs.existsSync(file), error: String(err && err.message) }
  }
}

export function saveSidecar(configDir, state) {
  const file = sidecarPath(configDir)
  const payload = { version: SIDECAR_VERSION, rules: state.rules }
  writeTextFile(file, JSON.stringify(payload, null, 2) + "\n", false)
  return file
}

// ─────────────────────────────────────────────────────────────
// 备份
// ─────────────────────────────────────────────────────────────

export function backupFile(file, configDir, stamp = new Date().toISOString().replace(/[:.]/g, "-")) {
  const dir = path.join(configDir, BACKUP_DIRNAME)
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, `${path.basename(file)}.${stamp}.bak`)
  const buf = fs.readFileSync(file)
  fs.writeFileSync(target, buf)
  try {
    const entries = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith(path.basename(file) + "."))
      .sort()
    for (const n of entries.slice(0, Math.max(0, entries.length - MAX_BACKUPS))) fs.rmSync(path.join(dir, n), { force: true })
  } catch {
    /* 清理失败不影响主流程 */
  }
  return target
}

// ─────────────────────────────────────────────────────────────
// 注册表：id / 来源 / scope / frontmatter
// ─────────────────────────────────────────────────────────────

/** 宿主侧的 id 推导规则（本工具只作兜底与解释用；正常情况下注册表已直接给 id） */
export function deriveId(filePath, rootDir) {
  const dir = path.dirname(filePath)
  const base = path.basename(filePath)
  if (path.resolve(dir) === path.resolve(rootDir) && base !== "SKILL.md") return path.basename(filePath, ".md")
  return path.basename(dir)
}

export function classifySource(p, env = process.env, home = os.homedir()) {
  if (!p || typeof p !== "string") return "unknown"
  // 宿主的 builtin 技能用的是 POSIX 字面量 path（如 /builtin/opencode.md），
  // 先按原始值判断，避免 path.resolve 在 Windows 上把它变成 <盘符>:\builtin\...
  if (String(p).startsWith("/builtin/")) return "embedded"
  const abs = path.resolve(p)
  const configDir = resolveConfigDir(env, home)
  const cacheDir = path.join(env.XDG_CACHE_HOME && env.XDG_CACHE_HOME.trim() ? env.XDG_CACHE_HOME : path.join(home, ".cache"), "opencode")
  const under = (parent) => {
    const rel = path.relative(path.resolve(parent), abs)
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
  }
  if (under(path.join(configDir, "skill")) || under(path.join(configDir, "skills"))) return "config"
  if (under(path.join(home, ".claude", "skills"))) return "claude"
  if (under(path.join(home, ".agents", "skills"))) return "agents"
  if (under(path.join(cacheDir, "skills"))) return "catalog"
  const rel = path.relative(process.cwd(), abs)
  if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) return "project"
  return "plugin"
}

export function classifyScope(p, home = os.homedir()) {
  if (!p || typeof p !== "string") return "unknown"
  const abs = path.resolve(p)
  const rel = path.relative(path.resolve(home), abs)
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel) ? "user" : "project"
}

function parseScalar(raw) {
  let v = raw.trim()
  if (v === "") return undefined
  const quoted = /^"(.*)"$/.exec(v) ?? /^'(.*)'$/.exec(v)
  if (quoted) return quoted[1]
  // 去掉行尾注释
  const hash = v.indexOf(" #")
  if (hash >= 0) v = v.slice(0, hash).trim()
  if (/^(true|yes|on)$/i.test(v)) return true
  if (/^(false|no|off)$/i.test(v)) return false
  return v
}

/** 极简 frontmatter 读取：只取本工具需要的字段，取不到就返回 undefined（不猜） */
export function readFrontmatter(content) {
  const out = { name: undefined, description: undefined, disableModelInvocation: undefined, autoinvoke: undefined }
  if (typeof content !== "string") return out
  const m = /^(?:\ufeff)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!m) return out
  const lines = m[1].split(/\r?\n/)
  let inMetadata = false
  let metadataIndent = 0
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue
    const indent = line.length - line.trimStart().length
    const body = line.trim()
    const idx = body.indexOf(":")
    if (idx < 0) continue
    const key = body.slice(0, idx).trim()
    const val = body.slice(idx + 1)
    if (inMetadata && indent <= metadataIndent && key !== "opencode/autoinvoke") inMetadata = key === "metadata"
    if (indent > metadataIndent && inMetadata) {
      if (key === "opencode/autoinvoke") out.autoinvoke = parseScalar(val)
      continue
    }
    if (key === "metadata") {
      if (val.trim() === "") {
        inMetadata = true
        metadataIndent = indent
      }
      continue
    }
    if (key === "name") out.name = parseScalar(val)
    else if (key === "description") out.description = parseScalar(val)
    else if (key === "disable-model-invocation") out.disableModelInvocation = parseScalar(val)
  }
  if (out.autoinvoke === undefined && out.disableModelInvocation !== undefined) {
    out.autoinvoke = out.disableModelInvocation === false ? false : undefined
  }
  return out
}

function normalizeSkill(item, roots) {
  if (!item || typeof item !== "object") {
    return { id: undefined, idSource: "none", name: undefined, path: undefined, pathField: undefined }
  }
  // path 必须是字符串；信封对象里的 location 是 {directory:...}，绝不能当路径用
  let pathField
  let rawPath
  if (typeof item.path === "string") {
    pathField = "path"
    rawPath = item.path
  } else if (typeof item.location === "string") {
    pathField = "location"
    rawPath = item.location
  }
  let id
  let idSource
  if (typeof item.id === "string" && item.id) {
    id = item.id
    idSource = "registry"
  } else if (rawPath) {
    // §3.5：注册表项没给 id 时按宿主规则从路径反推
    id = deriveId(rawPath, roots?.dir ?? path.dirname(rawPath))
    idSource = "derived"
  } else {
    idSource = "none"
  }
  return {
    id,
    idSource,
    name: typeof item.name === "string" ? item.name : id,
    description: typeof item.description === "string" ? item.description : undefined,
    autoinvoke: item.autoinvoke,
    path: rawPath,
    pathField,
    content: typeof item.content === "string" ? item.content : undefined,
  }
}

// ─────────────────────────────────────────────────────────────
// 规则求值（与宿主一致：findLast + glob，无命中回退 ask）
// ─────────────────────────────────────────────────────────────

export function evaluateRule(rules, action, resource) {
  const list = Array.isArray(rules) ? rules : []
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i]
    if (!r) continue
    if (globMatch(r.action, action) && globMatch(r.resource, resource)) return { rule: r, index: i }
  }
  return { rule: { action, resource: "*", effect: "ask" }, index: -1 }
}

export function stateOf(rules, id) {
  const { rule, index } = evaluateRule(rules, PERMISSION_ACTION, id)
  return { effect: rule.effect, rule, index }
}

function pickAgent(agents, agentId) {
  if (!Array.isArray(agents) || agents.length === 0) return undefined
  return agents.find((a) => a.id === agentId) ?? agents.find((a) => !a.hidden) ?? agents[0]
}

// ─────────────────────────────────────────────────────────────
// 输出格式化
// ─────────────────────────────────────────────────────────────

function mdTable(headers, rows) {
  const esc = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
  const line = (cells) => "| " + cells.map(esc).join(" | ") + " |"
  return [line(headers), "|" + headers.map(() => "---").join("|") + "|", ...rows.map(line)].join("\n")
}

function truncate(s, n = 80) {
  if (!s) return ""
  const first = String(s).split(/\r?\n/)[0]
  return first.length > n ? first.slice(0, n - 1) + "…" : first
}

function ensureArray(v) {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]
}

// ─────────────────────────────────────────────────────────────
// 动作实现
// ─────────────────────────────────────────────────────────────

async function readDomainList(ctx, domain) {
  const d = ctx?.[domain]
  if (!d) return []
  // 首选：transform 的 draft.list() —— 返回真正的数组（宿主的内部注册表接口，已实测）
  if (typeof d.transform === "function") {
    let captured
    let reg
    try {
      reg = await d.transform((draft) => {
        captured = draft.list()
      })
    } catch {
      captured = undefined
    }
    try {
      if (reg && typeof reg.dispose === "function") await reg.dispose()
    } catch {
      /* dispose 失败不影响读取 */
    }
    if (Array.isArray(captured)) return captured
  }
  // 退回：list() 返回的是 { location, data } 信封，不是数组
  if (typeof d.list === "function") {
    try {
      const res = await d.list()
      if (Array.isArray(res)) return res
      if (res && Array.isArray(res.data)) return res.data
    } catch {
      /* 读不到就返回空 */
    }
  }
  return []
}

async function readContext(ctx) {
  const skills = await readDomainList(ctx, "skill")
  const agents = await readDomainList(ctx, "agent")
  return { skills, agents }
}

async function actList(ctx) {
  const { skills, agents } = await readContext(ctx)
  const home = os.homedir()
  const target = resolveTargetConfig()
  const side = loadSidecar(target.configDir)

  const rows = []
  let disabled = 0
  let ask = 0
  const all = skills.map((raw) => normalizeSkill(raw))
  // 规范 §3.6：有效状态按**单个 agent** 的规则集求值。绝不能把所有 agent 的规则合并去重——
  // 那会把子 agent（explorer / title …）的 deny 泄漏给调用者（v5 的 bug：29 个里 28 个假 disabled）。
  const callerAgent = pickAgent(agents, ctx.__agentId)
  const callerRules = ensureArray(callerAgent?.permissions)
  const callerId = callerAgent?.id ?? "(未知)"
  let diverged = 0
  for (const s of all) {
    const st = s.id ? stateOf(callerRules, s.id) : { effect: "unknown" }
    if (st.effect === "deny") disabled++
    else if (st.effect === "ask") ask++
    if (s.id && agents.length > 1) {
      if (agents.some((a) => stateOf(ensureArray(a.permissions), s.id).effect !== st.effect)) diverged++
    }
    rows.push([
      s.id ?? "(unknown)",
      s.name ?? "",
      s.autoinvoke === false ? "off" : "",
      classifySource(s.path),
      classifyScope(s.path, home),
      st.effect === "allow" ? "available" : st.effect === "deny" ? "disabled" : st.effect,
      s.path ?? "",
      truncate(s.description, 60),
    ])
  }
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  const derivedCount = all.filter((s) => s.idSource === "derived").length

  const lines = []
  lines.push(`# skills (${rows.length})`)
  lines.push("")
  lines.push(
    mdTable(["id", "name", "autoinvoke", "source", "scope", "state", "path", "description"], rows),
  )
  lines.push("")
  lines.push(`发现 ${rows.length} 个、已禁用 ${disabled} 个、ask ${ask} 个。`)
  lines.push(`调用者 agent：\`${callerId}\`（state 列按该 agent 的有效规则集求值，见规范 §3.6）`)
  if (!ctx.__agentId || !agents.some((a) => a.id === ctx.__agentId)) {
    lines.push(
      `⚠️ 未能确认调用者 agent（context.agent = ${JSON.stringify(ctx.__agentId ?? null)}），state 列按 \`${callerId}\` 计算，可能不代表你的实际权限。`,
    )
  }
  if (diverged > 0) {
    lines.push(`ℹ️ 另有 ${diverged} 个 skill 在其它 agent 下状态不同（详见 \`inspect\` 的逐 agent 表）。`)
  }
  if (derivedCount > 0) {
    lines.push(`注：其中 ${derivedCount} 个 id 由路径反推（注册表项未提供 \`id\`；推导规则见 \`inspect\`）。`)
  }

  const recorded = side.rules.map((r) => r.id)
  // C3：resolveTargetConfig 已把目标文件读盘并解析过，直接用其中的 items；
  // 只有拿不到文档（文件不存在 / 读不了，例如准备新建）时才回退 readConfigRules（保留其 null 语义）。
  const configRules = target.doc ? itemsToRules(target.doc.items) : readConfigRules(target.file)

  if (!side.ok) {
    lines.push("")
    lines.push(
      `⚠️ sidecar \`${side.file}\` 读取失败（${side.error ?? "未知原因"}）：本次忽略它的记录，结论只来自实际规则集；\`enable\` 仍可靠行尾标记注释定位。`,
    )
  }

  // (1) sidecar 记录了某条规则，但配置里已无对应规则 → 不一致（规范 §3.1 / §4.4 要求的那条）
  if (side.ok && configRules !== null && side.rules.length > 0) {
    const stale = side.rules.filter(
      (r) => !configRules.some((c) => c.action === PERMISSION_ACTION && c.resource === r.id && c.effect === (r.effect ?? "deny")),
    )
    if (stale.length > 0) {
      lines.push("")
      lines.push(
        `⚠️ sidecar 与配置不一致：sidecar 记录了 ${stale.map((s) => `\`${s.id}\``).join("、")}，但配置 \`${target.file}\` 里已无对应规则（未自动重放）。这些 skill 已按实际规则集显示为可用。`,
      )
    }
  }

  // (2) 配置里有本工具形状的规则，但 sidecar 无记录 → 可能是手工添加或注释被剥离过
  if (side.ok && configRules !== null) {
    const unrecorded = configRules.filter(
      (c) => c.action === PERMISSION_ACTION && !side.rules.some((r) => r.id === c.resource),
    )
    if (unrecorded.length > 0) {
      lines.push("")
      lines.push(
        `ℹ️ 配置里有 ${unrecorded.length} 条 \`skill\` 规则在 sidecar 里没有记录：${unrecorded.map((u) => `\`${u.resource}\`(${u.effect})`).join("、")}（可能为手工添加；\`enable\` 需要标记注释或 sidecar 记录才能唯一确认要删的那一条）`,
      )
    }
  }

  // (3) sidecar 记的 id 已不在注册表里
  const missing = recorded.filter((id) => !all.some((s) => s.id === id))
  if (missing.length > 0) {
    lines.push("")
    lines.push(`⚠️ sidecar 记的 ${missing.map((m) => `\`${m}\``).join("、")} 已不在注册表里（未自动重放）`)
  }
  lines.push("")
  lines.push(`目标配置文件：\`${target.file}\``)
  for (const n of target.notes) lines.push(`- ${n}`)
  return lines.join("\n")
}

async function actInspect(ctx, idRaw, nameRaw) {
  const { skills, agents } = await readContext(ctx)
  const home = os.homedir()
  const all = skills.map((s) => normalizeSkill(s))

  let target = all.find((s) => s.id === idRaw)
  let via = "id"
  if (!target && nameRaw) {
    const byName = all.filter((s) => s.name === nameRaw)
    if (byName.length === 1) {
      target = byName[0]
      via = "name"
    } else if (byName.length > 1) {
      return `名称 \`${nameRaw}\` 命中多个 skill，请改用 id：${byName.map((s) => `\`${s.id}\``).join("、")}`
    }
  }
  if (!target) {
    const needle = idRaw ?? nameRaw
    const near = all.filter((s) => String(s.id).includes(String(needle)) || String(s.name).includes(String(needle)))
    return [
      `未找到 skill \`${needle}\`。`,
      near.length > 0 ? `近似：${near.map((s) => `\`${s.id}\``).join("、")}` : "注册表里没有相近的 id。",
      "（结论来自实际读到的注册表，未做猜测）",
    ].join("\n")
  }

  const fm = readFrontmatter(target.content)
  const lines = []
  lines.push(`# inspect: ${target.id}`)
  lines.push("")
  lines.push(mdTable(["字段", "值"], [
    ["id", target.id],
    ["name", target.name ?? ""],
    ["name ≠ id", target.name && target.id && target.name !== target.id ? "是（frontmatter.name 覆盖了 id）" : "否"],
    ["匹配方式", via === "id" ? "按 id 精确匹配" : "按 name 别名匹配"],
    ["path", target.path ?? ""],
    ["source", classifySource(target.path)],
    ["scope", classifyScope(target.path, home)],
    ["description", truncate(target.description, 120)],
    ["frontmatter.name", fm.name ?? "(未读到)"],
    ["frontmatter.disable-model-invocation", fm.disableModelInvocation === undefined ? "(未读到)" : String(fm.disableModelInvocation)],
    ["autoinvoke（注册表）", target.autoinvoke === undefined ? "(未提供)" : String(target.autoinvoke)],
  ]))
  lines.push("")
  lines.push("## id 推导")
  lines.push("")
  if (target.path) {
    const dir = path.dirname(target.path)
    const base = path.basename(target.path)
    const rule =
      base === "SKILL.md"
        ? "`<dir>/SKILL.md` → 取 SKILL.md 所在目录名"
        : "`<dir>/<name>.md` → 取文件名（去掉 .md）"
    lines.push(`- \`id\`：\`${target.id}\``)
    lines.push(
      `- 来源：${
        target.idSource === "derived"
          ? "**由路径反推**（注册表项未提供 `id`，按 §3.5 规则推导）"
          : "**注册表直接给出**（本工具不反推，仅列出对应规则供核对）"
      }`,
    )
    lines.push(`- 推导规则：${rule}`)
    lines.push(`- 输入路径字段：\`${target.pathField ?? "path"}\``)
    lines.push(`- 路径：\`${target.path}\``)
    lines.push(`- 规则输入：\`dirname = ${dir}\`，\`basename = ${base}\``)
  } else {
    lines.push("- 注册表项既没有 `id` 也没有可用的路径字段 → `id` 无法确定。")
    lines.push("- 本工具不会猜：下面的有效判定按 `id` 为空处理。")
  }
  if (target.name && target.id && target.name !== target.id) {
    lines.push(`- frontmatter 的 name（\`${target.name}\`）与 id 不同：\`disable\`/\`enable\` 用 id，两者都会显示。`)
  }

  lines.push("")
  lines.push("## 有效判定")
  lines.push("")
  const details = []
  for (const a of agents) {
    const rules = ensureArray(a.permissions)
    const st = stateOf(rules, target.id)
    const src = st.index >= 0 ? `rules[${st.index}] = ${JSON.stringify(st.rule)}` : "无规则命中 → 回退 ask"
    details.push([a.id, st.effect, src])
  }
  const diffs = details.filter((d) => d[1] !== details[0]?.[1])
  lines.push(
    mdTable(["agent", "effect", "命中规则"], details.slice(0, 30)),
  )
  lines.push("")
  if (details.length > 1) {
    lines.push(
      diffs.length === 0
        ? "各 agent 结果一致，无 agent 级差异。"
        : `agent 级差异：${diffs.map((d) => `\`${d[0]}\` = ${d[1]}`).join("、")}`,
    )
  }
  lines.push("")

  const callerAgent = pickAgent(agents, ctx.__agentId)
  const callerRules = ensureArray(callerAgent?.permissions)
  const callerState = stateOf(callerRules, target.id)
  const callerEffect = callerState.effect
  const callerName = callerAgent?.id ?? "(未知)"
  const broad = callerEffect === "deny" && callerState.rule?.resource !== target.id ? callerState.rule : undefined
  if (broad) {
    lines.push(`- 调用者 agent \`${callerName}\` 下，该 id 被更宽的规则覆盖为 deny：\`${JSON.stringify(broad)}\`，无需新增规则。`)
  }
  const hitText =
    callerState.index >= 0
      ? `命中 rules[${callerState.index}] = ${JSON.stringify(callerState.rule)}`
      : "无规则命中 → 回退 ask"
  lines.push(
    callerEffect === "deny"
      ? `**结论**：\`${target.id}\` 对调用者 agent \`${callerName}\` 当前**不可用** —— 权限效果为 deny（${hitText}），模型可见列表会隐藏它、且 \`skill\` 工具加载会被拒。`
      : callerEffect === "ask"
        ? `**结论**：\`${target.id}\` 对调用者 agent \`${callerName}\` 当前**可用但需确认** —— 权限效果为 ask（${hitText}）：仍在模型可见列表里，加载时询问。`
        : `**结论**：\`${target.id}\` 对调用者 agent \`${callerName}\` 当前**可用** —— 权限效果为 ${callerEffect}（${hitText}）。`,
  )
  return lines.join("\n")
}

async function actDisable(ctx, idRaw, nameRaw, effectRaw, dryRun) {
  const { skills, agents } = await readContext(ctx)
  const all = skills.map((s) => normalizeSkill(s))
  const resolved = resolveId(all, idRaw, nameRaw)
  if (resolved.error) return resolved.error
  const id = resolved.id
  const effect = effectRaw === "ask" ? "ask" : "deny"

  const target = resolveTargetConfig()
  const out = []
  const agentId = ctx.__agentId

  const caller = pickAgent(agents, agentId)
  const callerRules = ensureArray(caller?.permissions)
  const current = stateOf(callerRules, id)
  out.push(`调用者 agent：\`${caller?.id ?? "(未知)"}\``)
  out.push(`目标：\`${id}\`（当前效果：${current.effect}）`)

  if (current.effect === "deny") {
    // 区分"本工具/精确规则已停用"与"被更宽的规则覆盖"
    const broad = current.index >= 0 && current.rule?.resource !== id ? current.rule : undefined
    if (broad) {
      out.push(`已被更宽的规则覆盖为 deny，无需新增：\`${JSON.stringify(broad)}\`（agent 规则集 rules[${current.index}]）。未做任何修改。`)
    } else {
      out.push("已经是停用状态，未做任何修改。")
      out.push(`命中：${current.index >= 0 ? `rules[${current.index}] = ${JSON.stringify(current.rule)}` : "（无规则命中 → 回退 ask）"}`)
    }
    return out.join("\n")
  }

  if (!fs.existsSync(target.file)) {
    // 允许新建：dryRun 时只描述
  }
  const { text, bom } = fs.existsSync(target.file) ? readTextFile(target.file) : { text: "{}\n", bom: false }
  const { text: nextText, createdBlock } = insertRule(text, id, effect)
  strictValidate(nextText)

  out.push(`目标文件：\`${target.file}\``)
  for (const n of target.notes) out.push(`- ${n}`)
  out.push("")
  out.push("将写入（新增/改动的行，逐字来自实际将落盘的内容）：")
  out.push("```jsonc")
  for (const line of changedRegion(text, nextText)) out.push(line)
  out.push("```")

  if (dryRun) {
    out.push("")
    out.push("dryRun：未写入任何文件。")
    return out.join("\n")
  }

  if (fs.existsSync(target.file)) backupFile(target.file, target.configDir)
  writeTextFile(target.file, nextText, bom)

  // 回读校验：优先走宿主 reload，再复核生效规则集（会轮询等待异步重载）。
  // C1：ask 的判据是「调用者规则集里该 {skill,id,ask} 三元组条数确实增加」——
  // 与 verifyRuleRemoved 同一判据。旧判据 `caller !== "deny"` 恒为真（无规则命中回退 ask、
  // agent 自有 allow 都不是 deny），于是宿主没读进规则也报「✅ 已写入并校验通过」。
  const beforeCount = countExactRules(callerRules, id, effect)
  const verified = await verifyEffect(ctx, id, effect, caller?.id, beforeCount)
  if (!verified.ok) {
    writeTextFile(target.file, text, bom)
    out.push("")
    out.push(`❌ 回读校验失败（期望 ${effect}，实际 ${verified.actual}）；已回滚，文件未留下半成品。`)
    // 回滚后配置已复原，写入前的注册表快照又是准确的了 —— 顺手说明是谁挡的路
    // （fast-responder 这类 agent 自有规则排在全局规则之后的典型情形）。
    out.push(describeCallerHit(agents, agentId, id).text)
    return out.join("\n")
  }

  const side = loadSidecar(target.configDir)
  side.rules = side.rules.filter((r) => r.id !== id)
  side.rules.push({ id, effect, file: target.file, insertedAt: new Date().toISOString(), createdBlock: Boolean(createdBlock) })
  const sideFile = saveSidecar(target.configDir, side)

  out.push("")
  out.push(`✅ 已写入并校验通过：调用者 agent \`${verified.caller}\` = ${verified.actual}（${verified.via}）。sidecar：\`${sideFile}\``)
  if (verified.actual !== effect) {
    // N3：规则写入是真的（精确规则数增加了），但对调用者不产生该效果 —— 不许把它写成"已生效"。
    out.push(
      `ℹ️ 注意：规则确实已写入并被宿主读入（精确规则数 ${beforeCount}→${verified.count}），但对调用者 agent \`${verified.caller}\` 的**实际效果是 ${verified.actual}** —— 该 agent 自己的规则排在全局规则之后，覆盖了它；换其它 agent 调用时 ${effect} 才生效。`,
    )
  } else {
    out.push(`规则集顺序：追加在末尾 → 对该 agent 优先级最高。`)
  }
  if (verified.diverged && verified.diverged.length > 0) {
    out.push(
      `ℹ️ 另有 ${verified.diverged.length} 个 agent 结果不同（它们用自己的后续规则覆盖了全局规则）：${verified.diverged.map((d) => `\`${d.id}\`=${d.effect}`).join("、")}`,
    )
  }
  return out.join("\n")
}

function countExactRules(rules, id, effect) {
  return ensureArray(rules).filter(
    (r) =>
      r &&
      r.resource === id &&
      (effect === undefined || r.effect === effect) &&
      typeof r.action === "string" &&
      globMatch(r.action, PERMISSION_ACTION),
  ).length
}

/**
 * §11.1：删除一条精确规则后的回读校验。
 * 判据不是「调用者现在不是 deny」（删完仍可能被更宽的规则挡住，那是要**报告**的结果），
 * 而是「调用者的规则集里该三元组的条数确实减少了」—— 说明宿主已重新读入这次删除。
 */
async function verifyRuleRemoved(ctx, id, effect, beforeCount, callerAgentId) {
  const timeoutMs = Number(process.env.SKILL_MGMT_VERIFY_TIMEOUT_MS ?? 6000)
  const deadline = Date.now() + (Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 6000)
  let polls = 0
  let per = []
  for (;;) {
    polls++
    try {
      if (typeof ctx.agent?.reload === "function") await ctx.agent.reload()
    } catch {
      /* reload 不可用就只靠轮询等待 */
    }
    let agents = []
    try {
      agents = await readDomainList(ctx, "agent")
    } catch {
      agents = []
    }
    if (agents.length > 0) {
      per = agents.map((a) => {
        const rules = ensureArray(a.permissions)
        return {
          id: a.id,
          count: countExactRules(rules, id, effect),
          effect: stateOf(rules, id).effect,
        }
      })
      const picked = per.find((p) => p.id === callerAgentId) ?? per.find((p) => !p.hidden) ?? per[0]
      if (picked && picked.count < beforeCount) {
        return {
          ok: true,
          caller: picked.id,
          postEffect: picked.effect,
          diverged: per.filter((p) => p.effect !== picked.effect),
          via: `ctx.agent.reload() + ctx.agent.list()（轮询 ${polls} 次）`,
          polls,
        }
      }
    }
    if (Date.now() >= deadline) {
      return {
        ok: false,
        actual: per.length > 0 ? per.map((p) => `${p.id}=${p.effect}×${p.count}`).join(", ") : "未验证（拿不到 agent 规则集）",
        via: `ctx.agent.reload() + ctx.agent.list()（轮询 ${polls} 次后超时）`,
        polls,
      }
    }
    await sleep(200)
  }
}

/** 拒绝时用：指出调用者规则集里实际命中的规则（谁挡的路） */
function describeCallerHit(agents, callerAgentId, id) {
  const caller = pickAgent(agents, callerAgentId)
  const rules = ensureArray(caller?.permissions)
  const hit = stateOf(rules, id)
  if (hit.index < 0) {
    return { caller: caller?.id ?? "(未知)", text: "调用者规则集里没有命中规则（宿主会回退 ask）。" }
  }
  const kind =
    hit.rule.resource === id
      ? "精确命中该 id（来自 agent 级 `permissions` 或未写入本工具目标文件的规则）"
      : "更宽的规则（通配 `resource`，或 agent 级 `permissions` / `policies`）"
  return {
    caller: caller?.id ?? "(未知)",
    text: `调用者 agent \`${caller?.id ?? "(未知)"}\` 的规则集 rules[${hit.index}] = \`${JSON.stringify(hit.rule)}\` —— ${kind}。本工具只报告，不代改。`,
  }
}

async function actEnable(ctx, idRaw, nameRaw, dryRun) {
  const { skills, agents } = await readContext(ctx)
  const agentId = ctx.__agentId
  const all = skills.map((s) => normalizeSkill(s))
  const resolved = resolveId(all, idRaw, nameRaw)
  if (resolved.error) return resolved.error
  const id = resolved.id

  const callerAgent = pickAgent(agents, agentId)
  const callerName = callerAgent?.id ?? "(未知)"
  const callerRules = ensureArray(callerAgent?.permissions)
  const before = stateOf(callerRules, id)

  const target = resolveTargetConfig()
  const side = loadSidecar(target.configDir)
  const record = side.rules.find((r) => r.id === id)

  // 候选文件：解析出的目标配置 + sidecar 记录的文件（去重）。
  const files = [...new Set([target.file, record?.file && isFile(record.file) ? record.file : null].filter(Boolean))]
  const docs = []
  for (const f of files) {
    let doc
    try {
      const { text, bom } = readTextFile(f)
      doc = { file: f, text, bom }
    } catch {
      continue // 读不到的文件跳过；结论只来自实际读到的内容
    }
    try {
      doc.root = parseJsonc(doc.text)
    } catch {
      doc.root = null // 解析不了的文档既不能定位也不能安全删除 → 按"没有规则"处理
    }
    docs.push(doc)
  }

  const out = []
  out.push(`目标：\`${id}\``)
  out.push(`调用者 agent：\`${callerName}\`（当前效果：${before.effect}）`)
  out.push(`目标文件：${files.map((f) => `\`${f}\``).join("、")}`)
  const unparsable = docs.filter((d) => !d.root).map((d) => d.file)
  if (unparsable.length > 0) {
    // "结论只来自实际读到的内容"：解析不了的文档既不定位也不删，但必须说清，否则会读成"没有规则"。
    out.push(
      `⚠️ 无法解析（JSONC 语法错误？）的配置文件：${unparsable.map((f) => `\`${f}\``).join("、")} —— 未从中定位任何规则，请先修好语法。`,
    )
  }

  // 候选项 = 精确命中该 id、且效果为 deny/ask 的规则（allow 不是「挡路的规则」，不删）。
  const candidates = []
  for (const d of docs) {
    for (const item of exactItems(d.root, id)) {
      const triple = itemTriple(item)
      if (triple.effect === "deny" || triple.effect === "ask") candidates.push({ ...d, item, triple })
    }
  }

  if (candidates.length === 0) {
    out.push("")
    if (before.effect === "deny") {
      // §11.1 第 2 类：挡路的不是「这一行」，只报告不代改。
      out.push("❌ 拒绝执行：配置里没有精确命中该 id 的全局规则 —— 挡路的不是这一行，删无可删。")
      out.push(describeCallerHit(agents, agentId, id).text)
      out.push("若命中的是 `policies` / `experimental.policies`，本工具无法读取（插件 ctx 没有 `config` 域），请手工核对。")
      // 相关规则 = action 匹配 skill 且 resource 的 glob 能匹配该 id（精确命中的是它的子集）。
      // 复用已解析的 root，用 file+偏移 的 Set 去重（旧实现是 related.some(...) 的 O(n²) + 二次 parse）。
      const related = []
      const seen = new Set()
      for (const d of docs) {
        for (const item of permissionsItems(d.root) ?? []) {
          if (item.type !== "object") continue
          const key = `${d.file}\u0000${item.start}`
          if (seen.has(key)) continue
          const t = itemTriple(item)
          if (typeof t.action === "string" && globMatch(t.action, PERMISSION_ACTION) && typeof t.resource === "string" && globMatch(t.resource, id)) {
            seen.add(key)
            related.push({ file: d.file, text: d.text, item })
          }
        }
      }
      if (related.length > 0) {
        out.push("")
        out.push("配置里与该 id 相关的规则（原文）：")
        for (const r of related) {
          const { ls, le } = lineBounds(r.text, r.item.start)
          out.push(`- \`${r.file}\``)
          out.push("```jsonc")
          out.push(r.text.slice(ls, le).trim())
          out.push("```")
        }
      }
    } else {
      out.push(`配置里没有精确命中该 id 的 deny/ask 规则，无需修改（当前效果：${before.effect}）。`)
    }
    return out.join("\n")
  }

  if (candidates.length > 1) {
    // §11.1 第 2 类：歧义。宿主按 findLast 求值，删错那条会「看起来成功但行为没变」。
    out.push("")
    out.push(`❌ 拒绝执行：配置里有 ${candidates.length} 条精确命中 \`${id}\` 的规则，无法唯一定位（宿主求值是最后一条命中算数）。`)
    out.push("候选（请自行确认后手工处理）：")
    for (const c of candidates) {
      const { ls, le } = lineBounds(c.text, c.item.start)
      out.push(`- \`${c.file}\``)
      out.push("```jsonc")
      out.push(c.text.slice(ls, le).trim())
      out.push("```")
    }
    return out.join("\n")
  }

  const hit = candidates[0]
  const marked = itemHasMarker(hit.text, hit.item)
  let how
  let origin
  let warn = false
  if (marked) {
    // (a) 标记注释是文件内自证，优先级最高 —— 即使 sidecar 丢失也认。
    how = "标记注释命中（文件内自证）"
    origin = "本工具写入（同行标记注释）"
  } else if (record && (record.effect ?? "deny") === hit.triple.effect) {
    // (b) 无标记，但 sidecar 有该 id 的记录且配置里恰好一条完全相同的三元组。
    how = `sidecar 有 \`${id}\` 的记录，且配置里恰好一条完全相同的规则（${hit.triple.effect}）`
    origin = "本工具写入（sidecar 记录；标记已缺失）"
    warn = true
  } else {
    // (c) 两者都没有 → 拒绝，并给出原文。
    out.push("")
    out.push(`❌ 拒绝执行：既没有本工具标记注释，也没有 sidecar 记录能确认这条规则。`)
    out.push(`配置 \`${hit.file}\` 里精确命中该 id 的规则（原文，请自行确认后手工处理）：`)
    const { ls, le } = lineBounds(hit.text, hit.item.start)
    out.push("```jsonc")
    out.push(hit.text.slice(ls, le).trim())
    out.push("```")
    return out.join("\n")
  }

  const { ls, le } = lineBounds(hit.text, hit.item.start)
  out.push(`定位方式：${how}`)
  out.push("")
  out.push("将删除：")
  out.push("```jsonc")
  out.push(hit.text.slice(ls, le).trim())
  out.push("```")

  if (dryRun) {
    out.push("")
    out.push("dryRun：未写入任何文件。")
    return out.join("\n")
  }

  let nextText = removeRuleByLine(hit.text, hit.item)
  let cleanedEmptyBlock = false
  const cleaned = removePermissionsBlockIfEmpty(nextText)
  if (cleaned !== null) {
    nextText = cleaned
    cleanedEmptyBlock = true
  }
  backupFile(hit.file, target.configDir)
  writeTextFile(hit.file, nextText, hit.bom)

  const beforeCount = countExactRules(callerRules, id, hit.triple.effect)
  const verified = await verifyRuleRemoved(ctx, id, hit.triple.effect, beforeCount, callerAgent.id)
  if (!verified.ok) {
    writeTextFile(hit.file, hit.text, hit.bom)
    return out.join("\n") + `\n\n❌ 回读校验失败（调用者规则集里该规则未减少：${verified.actual}）；已回滚。`
  }

  side.rules = side.rules.filter((r) => r.id !== id)
  const sideFile = saveSidecar(target.configDir, side)

  out.push("")
  if (warn)
    out.push(
      `⚠️ 该规则没有本工具标记（可能被外部写者剥掉过注释），已按 sidecar 记录删除；建议核对一次配置。`,
    )
  if (cleanedEmptyBlock) out.push("已把因此变空的 `permissions` 块一并清理。")
  out.push(`✅ 已删除并校验通过（${verified.via}）。sidecar：\`${sideFile}\``)
  out.push(`- 被删规则的来源：${origin}`)
  out.push(`- **删除后的生效效果**：调用者 agent \`${verified.caller}\` = **${verified.postEffect}**`)
  if (verified.postEffect === "deny") {
    let fresh = []
    try {
      fresh = await readDomainList(ctx, "agent")
    } catch {
      fresh = []
    }
    out.push(
      `  - 仍为 deny：挡路的不是被删的这一行 —— ${describeCallerHit(fresh.length > 0 ? fresh : agents, agentId, id).text}`,
    )
  }
  if (verified.diverged && verified.diverged.length > 0) {
    out.push(
      `ℹ️ 另有 ${verified.diverged.length} 个 agent 结果不同（它们用自己的后续规则覆盖了全局规则）：${verified.diverged.map((d) => `\`${d.id}\`=${d.effect}`).join("、")}`,
    )
  }
  return out.join("\n")
}

function resolveId(all, idRaw, nameRaw) {
  if (!idRaw && !nameRaw) return { error: "缺少参数：请提供 `id`（或 `name` 别名）。" }
  if (idRaw && all.some((s) => s.id === idRaw)) return { id: idRaw }
  if (nameRaw) {
    const byName = all.filter((s) => s.name === nameRaw)
    if (byName.length === 1) return { id: byName[0].id }
    if (byName.length > 1) return { error: `名称 \`${nameRaw}\` 命中多个 skill：${byName.map((s) => `\`${s.id}\``).join("、")}。请改用 id。` }
  }
  if (idRaw) {
    const byName = all.filter((s) => s.name === idRaw)
    if (byName.length === 1) return { id: byName[0].id }
    const near = all.filter((s) => String(s.id).includes(String(idRaw)))
    return {
      error: [
        `注册表里没有 id \`${idRaw}\`。`,
        near.length > 0 ? `相近：${near.map((s) => `\`${s.id}\``).join("、")}` : "没有相近的 id。",
        "（结论来自实际读到的注册表，未做猜测）",
      ].join("\n"),
    }
  }
  return { error: `注册表里没有 \`${idRaw ?? nameRaw}\`。` }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 回读校验：宿主对配置文件的重新读入是**异步**的（文件 watch + 防抖），
 * 一次 reload 之后立刻读很可能还没生效 —— 实测踩过。所以这里轮询等待。
 * 判据以**调用者 agent** 为准（有些 agent 可能用自己的后续规则覆盖全局规则，那不该算失败，只报告）。
 *
 * 判据（C1）：
 *  - deny：调用者规则集求值为 deny（已证有效，不动）。
 *  - ask ：调用者规则集里该 `{skill, id, ask}` 三元组的**条数增加**（beforeCount → 更多）。
 *    不能用「不是 deny」—— 宿主对无规则命中的 skill 回退 ask，agent 自有 allow 也不是 deny，
 *    两者都会让校验恒真，连"宿主根本没读进规则"都报成功。
 */
async function verifyEffect(ctx, id, expected, callerAgentId, beforeCount = 0) {
  const timeoutMs = Number(process.env.SKILL_MGMT_VERIFY_TIMEOUT_MS ?? 6000)
  const deadline = Date.now() + (Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 6000)
  let per = []
  let pickedCount = beforeCount
  let polls = 0
  for (;;) {
    polls++
    try {
      if (typeof ctx.agent?.reload === "function") await ctx.agent.reload()
    } catch {
      /* reload 不可用就只靠 wait */
    }
    let agents = []
    try {
      agents = await readDomainList(ctx, "agent")
    } catch {
      agents = []
    }
    if (agents.length > 0) {
      per = agents.map((a) => {
        const rules = ensureArray(a.permissions)
        return {
          id: a.id,
          hidden: a.hidden,
          effect: stateOf(rules, id).effect,
          count: countExactRules(rules, id, expected),
        }
      })
      const picked = per.find((p) => p.id === callerAgentId) ?? per.find((p) => !p.hidden) ?? per[0]
      const caller = picked?.effect
      pickedCount = picked ? picked.count : beforeCount
      const ok = expected === "deny" ? caller === "deny" : Boolean(picked) && picked.count > beforeCount
      if (ok) {
        return {
          ok: true,
          actual: caller,
          caller: picked?.id,
          count: picked.count,
          beforeCount,
          diverged: per.filter((p) => p.effect !== caller),
          via: `ctx.agent.reload() + ctx.agent.list()（轮询 ${polls} 次；精确规则数 ${beforeCount}→${picked.count}）`,
          polls,
        }
      }
    }
    if (Date.now() >= deadline) {
      return {
        ok: false,
        actual: per.length > 0 ? per.map((p) => `${p.id}=${p.effect}×${p.count}`).join(", ") : "未验证（拿不到 agent 规则集）",
        caller: per.find((p) => p.id === callerAgentId)?.id,
        count: pickedCount,
        beforeCount,
        diverged: [],
        via: `ctx.agent.reload() + ctx.agent.list()（轮询 ${polls} 次后超时）`,
        polls,
      }
    }
    await sleep(200)
  }
}

// ─────────────────────────────────────────────────────────────
// 工具描述与 schema
// ─────────────────────────────────────────────────────────────

const DESCRIPTION = [
  "List, inspect, enable or disable installed OpenCode skills.",
  "`list` shows every registered skill with its effective state (available / disabled / ask).",
  "`disable` adds one permission rule to the GLOBAL config so the skill is hidden from the model and its loading is rejected — it never touches skill files.",
  "`enable` removes the blocking global rule for that skill, whoever wrote it.",
  "",
  "Semantics: deny = hidden from the model-visible skill list AND loading via the `skill` tool is rejected (granularity = skill id). ask = stays listed, asks for confirmation when loaded. disable writes deny by default; pass effect:\"ask\" for a soft disable.",
  "`enable` deletes the one exact global rule for that id. It refuses when the rule cannot be uniquely identified (several matching rules) or when the blocker is a wildcard rule / an agent-level `agents.<id>.permissions` / a policy — those are only reported, never edited.",
  "Use when the user asks which skills are installed, why one is not available, or wants one turned off or on.",
  "",
  "This is a **native tool**: call it directly by name; do not look for it with Code Mode `search()` / `execute`.",
].join("\n")

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      oneOf: [
        { const: "list", description: "列出所有已注册 skill 及其有效状态；不需要其它参数" },
        { const: "inspect", description: "查单个 skill 的详情与不可用原因；需要 id（或 name）" },
        { const: "disable", description: "停用：写一条全局权限规则，使其对模型隐藏且拒绝加载；需要 id（或 name）" },
        { const: "enable", description: "恢复：删除挡路的那一条精确全局规则（不要求是本工具写的）；需要 id（或 name）" },
      ],
      description: "要执行的动作",
    },
    id: {
      type: "string",
      description: "skill id。inspect / disable / enable 必填。也可以传 name 作为别名（重名时会报候选而不猜）",
    },
    name: {
      type: "string",
      description: "skill 名称别名，等价于 id；仅当它唯一命中一个 skill 时生效",
    },
    effect: {
      type: "string",
      enum: ["deny", "ask"],
      description: "disable 写入的效果，默认 deny。ask = 仍在模型可见列表里、加载时确认",
    },
    dryRun: {
      type: "boolean",
      default: false,
      description: "写操作只预览将要做的改动，不落盘",
    },
  },
  required: ["action"],
  additionalProperties: true,
}

// ─────────────────────────────────────────────────────────────
// 插件入口
// ─────────────────────────────────────────────────────────────

export default {
  id: PLUGIN_ID,
  async setup(ctx) {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: TOOL_NAME,
        options: { codemode: false },
        description: DESCRIPTION,
        input: INPUT_SCHEMA,
        async execute(raw, context) {
          const input = raw && typeof raw === "object" ? raw : {}
          const action = input.action
          const id = input.id ?? (typeof input.skill === "string" ? input.skill : undefined)
          const name = input.name
          const effect = input.effect
          const dryRun = input.dryRun === true
          const scoped = Object.assign(Object.create(ctx), { __agentId: context?.agent })
          try {
            switch (action) {
              case "list":
                return { content: await actList(scoped) }
              case "inspect":
                return { content: await actInspect(scoped, id, name) }
              case "disable":
                return { content: await actDisable(scoped, id, name, effect, dryRun) }
              case "enable":
                return { content: await actEnable(scoped, id, name, dryRun) }
              default:
                return {
                  content: `未知动作 \`${action ?? "(缺失)"}\`。可用：list / inspect / disable / enable。`,
                }
            }
          } catch (err) {
            return { content: `❌ ${PLUGIN_ID} 执行失败：${err && err.message ? err.message : String(err)}` }
          }
        },
      })
    })
    return () => {}
  },
}
