import fs from 'node:fs'
import path from 'node:path'

const BASE = '/opencode-skill-management'
const DIST = path.resolve('site/dist')

if (!fs.existsSync(DIST)) {
  console.error(`missing build output: ${DIST}`)
  process.exit(1)
}

const problems = []
const htmlFiles = []

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.html')) htmlFiles.push(full)
  }
}
walk(DIST)

const relFiles = htmlFiles.map((f) => path.relative(DIST, f).split(path.sep).join('/'))
const routes = relFiles
  .filter((f) => f.endsWith('index.html'))
  .map((f) => (f === 'index.html' ? '/' : `/${f.slice(0, -'index.html'.length)}`))
  .sort()

const en = routes.filter((r) => !r.startsWith('/zh-cn/'))
const zh = routes.filter((r) => r.startsWith('/zh-cn/'))
const zhAsEn = zh.map((r) => (r === '/zh-cn/' ? '/' : r.slice('/zh-cn'.length)))

if (JSON.stringify(en) !== JSON.stringify(zhAsEn)) {
  problems.push(`route sets are not mirrors\n  en: ${en.join(' ')}\n  zh: ${zhAsEn.join(' ')}`)
}
if (!en.includes('/') || !zh.includes('/zh-cn/')) problems.push('missing locale home pages')

const read = (rel) => fs.readFileSync(path.join(DIST, rel), 'utf8')

for (const [rel, lang] of [
  ['index.html', 'en'],
  ['zh-cn/index.html', 'zh-CN'],
]) {
  const html = read(rel)
  if (!new RegExp(`<html[^>]*lang="${lang}"`).test(html)) problems.push(`${rel}: missing lang="${lang}"`)
  if (!/<html[^>]*data-has-hero/.test(html)) problems.push(`${rel}: not a splash landing page`)
  if (!/<h1[^>]*id="_top"/.test(html)) problems.push(`${rel}: missing hero title`)
  if (!/class="[^"]*oc-section/.test(html)) problems.push(`${rel}: missing landing sections`)
  if (html.includes('data-has-sidebar')) problems.push(`${rel}: landing page unexpectedly has a sidebar`)
}

// No language sniffing or redirect anywhere in the build.
for (const file of [...relFiles.map((r) => path.join(DIST, r))]) {
  const text = fs.readFileSync(file, 'utf8')
  for (const needle of ['navigator.language', 'navigator.languages', 'accept-language', 'Accept-Language']) {
    if (text.includes(needle)) problems.push(`${path.relative(DIST, file)}: contains ${needle}`)
  }
}
const assetDir = path.join(DIST, '_astro')
if (fs.existsSync(assetDir)) {
  for (const name of fs.readdirSync(assetDir)) {
    if (!name.endsWith('.js')) continue
    const text = fs.readFileSync(path.join(assetDir, name), 'utf8')
    for (const needle of ['navigator.language', 'navigator.languages']) {
      if (text.includes(needle)) problems.push(`_astro/${name}: contains ${needle}`)
    }
  }
}

// Every internal link and asset must resolve inside dist and stay under the base.
const external = /^(?:[a-z]+:|\/\/|#)/i
for (const rel of relFiles) {
  const html = read(rel)
  const pageUrl = `/` + (rel === 'index.html' ? '' : rel.slice(0, -'index.html'.length))
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const raw = match[1]
    if (!raw || external.test(raw)) continue
    const clean = raw.split('#')[0].split('?')[0]
    if (!clean) continue
    let target
    if (clean.startsWith('/')) {
      if (clean !== BASE && !clean.startsWith(`${BASE}/`)) {
        problems.push(`${rel}: ${clean} escapes base ${BASE}`)
        continue
      }
      target = clean.slice(BASE.length).replace(/^\//, '')
    } else {
      const resolved = new URL(clean, `https://example.invalid${BASE}${pageUrl}`)
      if (!resolved.pathname.startsWith(`${BASE}/`)) {
        problems.push(`${rel}: ${raw} escapes base`)
        continue
      }
      target = resolved.pathname.slice(BASE.length).replace(/^\//, '')
    }
    target = decodeURIComponent(target)
    const disk = target === '' || target.endsWith('/') ? path.join(DIST, target, 'index.html') : path.join(DIST, target)
    if (!fs.existsSync(disk)) problems.push(`${rel}: ${raw} -> missing ${path.relative(DIST, disk)}`)
  }
}

// Language switcher must point at the same page in the other locale.
for (const route of en) {
  const rel = route === '/' ? 'index.html' : `${route.slice(1)}index.html`
  const html = read(rel)
  const zhTarget = route === '/' ? `${BASE}/zh-cn/` : `${BASE}/zh-cn${route}`
  if (!html.includes(`value="${zhTarget}"`)) problems.push(`${rel}: switcher does not offer ${zhTarget}`)
}

if (problems.length > 0) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'))
  process.exit(1)
}

console.log(`✓ ${routes.length} routes (${en.length} en + ${zh.length} zh), exact mirrors`)
console.log(`✓ landing pages: / and /zh-cn/ (splash, no sidebar)`)
console.log('✓ no navigator.language / accept-language redirect in the build')
console.log('✓ every internal link and asset resolves under the base')
console.log('✓ language switcher points at the mirrored page')
