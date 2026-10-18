#!/usr/bin/env node
/**
 * 把插件装到 <config>/plugins/skill_management.js。
 * 只用 Node 内置模块。幂等：内容相同则不重写。
 *
 *   node tools/install.mjs [--dry-run]
 */
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const src = path.join(repoRoot, "src", "skill_management.js")

export function resolveConfigDir(env = process.env, home = os.homedir()) {
  const xdg = env.XDG_CONFIG_HOME
  const base = xdg && xdg.trim() ? xdg : path.join(home, ".config")
  return path.join(base, "opencode")
}

const dryRun = process.argv.includes("--dry-run")
const configDir = resolveConfigDir()
const pluginsDir = path.join(configDir, "plugins")
const dest = path.join(pluginsDir, "skill_management.js")

if (!fs.existsSync(src)) {
  console.error(`源文件不存在：${src}`)
  process.exit(1)
}

const content = fs.readFileSync(src)
let current = null
try {
  current = fs.readFileSync(dest)
} catch {
  current = null
}

if (current && current.equals(content)) {
  console.log(`已是最新，无需写入：${dest}`)
  process.exit(0)
}

if (dryRun) {
  console.log(`[dry-run] 将写入：${dest}（${content.length} bytes）`)
  process.exit(0)
}

fs.mkdirSync(pluginsDir, { recursive: true })
fs.writeFileSync(dest, content)

const check = fs.readFileSync(dest)
if (!check.equals(content)) {
  console.error(`写入后校验失败：${dest}`)
  process.exit(1)
}

console.log(`已安装：${dest}（${content.length} bytes）`)
console.log(`插件目录另含 ${fs.readdirSync(pluginsDir).filter((n) => n !== path.basename(dest)).length} 个其它条目`)
