/**
 * starlight-docs — core assertions over a built documentation site.
 *
 * Two rules keep this file usable in three places (skill, `audit`, exported CI
 * snapshot):
 *   1. node builtins only — no third-party imports, no relative imports;
 *   2. no top-level side effects — everything hangs off exported functions.
 *
 * `scripts/lib/emit-check.mjs` renders this exact source into a standalone
 * script by stripping the `export` keywords, so the assertions are never
 * copied or reimplemented.
 */
import fs from 'node:fs'
import path from 'node:path'

export const CHECK_VERSION = 1
export const DEFAULT_MAX_LINKS = 4000
export const SEVERITY_RANK = { info: 0, warn: 1, error: 2 }

const SNIFF_NEEDLES = [
  'navigator.language',
  'navigator.languages',
  'accept-language',
  'Accept-Language',
]

function add(findings, code, severity, message, extra) {
  const entry = { code, severity, message }
  if (extra) {
    for (const key of Object.keys(extra)) {
      if (extra[key] !== undefined && extra[key] !== null) entry[key] = extra[key]
    }
  }
  findings.push(entry)
}

export function normalizeBase(base) {
  if (!base || base === '/' || base === '.') return ''
  let value = String(base).trim()
  if (!value) return ''
  if (!value.startsWith('/')) value = `/${value}`
  while (value.endsWith('/')) value = value.slice(0, -1)
  return value
}

export function normalizeLocales(locales, defaultLocale) {
  const list = Array.isArray(locales)
    ? locales
    : String(locales || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
  const cleaned = []
  for (const item of list) if (!cleaned.includes(item)) cleaned.push(item)
  if (cleaned.length === 0) return ['root']
  const primary = defaultLocale || cleaned[0]
  if (!cleaned.includes(primary)) cleaned.unshift(primary)
  return cleaned
}

function normalizeOptions(options) {
  const locales = normalizeLocales(options.locales, options.defaultLocale)
  const profile = options.profile === 'landing' ? 'landing' : 'core'
  const checkLinks = ['all', 'internal', 'off'].includes(options.checkLinks)
    ? options.checkLinks
    : 'internal'
  const maxLinks =
    Number.isFinite(Number(options.maxLinks)) && Number(options.maxLinks) > 0
      ? Number(options.maxLinks)
      : DEFAULT_MAX_LINKS
  return {
    dist: options.dist ? path.resolve(options.dist) : null,
    base: normalizeBase(options.base),
    locales,
    defaultLocale: options.defaultLocale || locales[0],
    profile,
    checkLinks,
    maxLinks,
    timeout: Number.isFinite(Number(options.timeout)) ? Number(options.timeout) : 8000,
  }
}

function walkFiles(dir, predicate, out) {
  if (!fs.existsSync(dir)) return out
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, predicate, out)
    else if (predicate(entry.name)) out.push(full)
  }
  return out
}

function toPosix(value) {
  return value.split(path.sep).join('/')
}

export function listHtml(dist) {
  return walkFiles(dist, (name) => name.endsWith('.html'), [])
    .map((full) => toPosix(path.relative(dist, full)))
    .sort()
}

export function routesFromHtmlFiles(files) {
  const routes = []
  for (const rel of files) {
    if (rel === 'index.html') routes.push('/')
    else if (rel.endsWith('/index.html')) routes.push(`/${rel.slice(0, -'index.html'.length)}`)
  }
  return routes.sort()
}

function localeOfRoute(route, locales) {
  for (const key of locales) {
    if (key === 'root') continue
    if (route === `/${key}/` || route.startsWith(`/${key}/`)) return key
  }
  return 'root'
}

function mirroredRoute(route, from, to) {
  const prefix = from === 'root' ? '' : `/${from}`
  let rest = route
  if (prefix) rest = route === `${prefix}/` ? '/' : route.slice(prefix.length)
  if (to === 'root') return rest
  return rest === '/' ? `/${to}/` : `/${to}${rest}`
}

function readText(file) {
  return fs.readFileSync(file, 'utf8')
}

function htmlInfo(html) {
  const lang = /<html\b[^>]*\blang="([^"]*)"/i.exec(html)
  return {
    lang: lang ? lang[1] : null,
    h1: (html.match(/<h1\b/gi) || []).length,
    hasHero: /\bdata-has-hero\b/.test(html),
    heroTitle: /<h1[^>]*\bid="_top"/.test(html),
    hasSidebar: /\bdata-has-sidebar\b/.test(html),
    hasDescription: /<meta[^>]+name="description"/i.test(html),
    hasCanonical: /<link[^>]+rel="canonical"/i.test(html),
  }
}

function resolvesUnderBase(clean, base) {
  if (!base) return true
  return clean === base || clean.startsWith(`${base}/`)
}

function resolveTarget(clean, pageRoute, base) {
  if (clean.startsWith('/')) {
    if (!resolvesUnderBase(clean, base)) return { escapes: true }
    return { target: clean.slice(base.length).replace(/^\//, '') }
  }
  let resolved
  try {
    resolved = new URL(clean, `https://example.invalid${base}${pageRoute}`)
  } catch {
    return { target: null }
  }
  if (!resolvesUnderBase(resolved.pathname, base)) return { escapes: true }
  return { target: resolved.pathname.slice(base.length).replace(/^\//, '') }
}

function diskTarget(dist, target) {
  const decoded = (() => {
    try {
      return decodeURIComponent(target)
    } catch {
      return target
    }
  })()
  if (decoded === '' || decoded.endsWith('/')) return path.join(dist, decoded, 'index.html')
  const direct = path.join(dist, decoded)
  if (fs.existsSync(direct)) return direct
  if (!path.extname(decoded)) return path.join(dist, decoded, 'index.html')
  return direct
}

function emptyStats() {
  return { htmlFiles: 0, routes: 0, linksChecked: 0, perLocale: {} }
}

/**
 * Core + landing assertions. Synchronous and deterministic: no network.
 */
export function checkDist(options) {
  const opts = normalizeOptions(options || {})
  const findings = []
  const stats = emptyStats()

  if (!opts.dist) {
    add(findings, 'MISSING_DIST', 'error', 'no dist path was given; build the site first')
    return { findings, stats, routes: [], locales: opts.locales, base: opts.base }
  }
  if (!fs.existsSync(opts.dist)) {
    add(findings, 'MISSING_DIST', 'error', `missing build output: ${opts.dist}`, { path: opts.dist })
    return { findings, stats, routes: [], locales: opts.locales, base: opts.base }
  }

  const htmlFiles = listHtml(opts.dist)
  stats.htmlFiles = htmlFiles.length
  if (htmlFiles.length === 0) {
    add(findings, 'NO_HTML', 'error', `no .html files under ${opts.dist}`, { path: opts.dist })
    return { findings, stats, routes: [], locales: opts.locales, base: opts.base }
  }

  const routes = routesFromHtmlFiles(htmlFiles)
  stats.routes = routes.length
  for (const route of routes) {
    const key = localeOfRoute(route, opts.locales)
    stats.perLocale[key] = (stats.perLocale[key] || 0) + 1
  }

  const cache = new Map()
  const info = (rel) => {
    if (!cache.has(rel)) cache.set(rel, htmlInfo(readText(path.join(opts.dist, rel))))
    return cache.get(rel)
  }
  const relOfRoute = (route) => (route === '/' ? 'index.html' : `${route.slice(1)}index.html`)

  // ── locale routes mirror each other ────────────────────────────────────
  if (opts.locales.length > 1) {
    const byLocale = new Map(opts.locales.map((key) => [key, []]))
    for (const route of routes) {
      const key = localeOfRoute(route, opts.locales)
      if (!byLocale.has(key)) byLocale.set(key, [])
      byLocale.get(key).push(route)
    }
    const reference = byLocale.get(opts.defaultLocale) || []
    for (const key of opts.locales) {
      if (key === opts.defaultLocale) continue
      const actual = byLocale.get(key) || []
      const expected = reference.map((route) => mirroredRoute(route, opts.defaultLocale, key)).sort()
      if (JSON.stringify(expected) !== JSON.stringify(actual.slice().sort())) {
        add(
          findings,
          'ROUTE_MIRROR_MISMATCH',
          'error',
          `route sets are not mirrors for "${key}"\n  expected: ${expected.join(' ') || '(none)'}\n  actual: ${actual.join(' ') || '(none)'}`,
        )
      }
    }
    for (const key of opts.locales) {
      const home = key === opts.defaultLocale ? '/' : `/${key}/`
      if (!routes.includes(home)) add(findings, 'LOCALE_HOME_MISSING', 'error', `missing locale home page ${home}`)
    }
  }

  // ── html lang, one h1, description ─────────────────────────────────────
  const expectedLang = new Map()
  for (const key of opts.locales) {
    const home = key === opts.defaultLocale ? '/' : `/${key}/`
    if (!routes.includes(home)) continue
    const lang = info(relOfRoute(home)).lang
    if (lang) expectedLang.set(key, lang)
  }
  const homeRoutes = new Set(opts.locales.map((key) => (key === opts.defaultLocale ? '/' : `/${key}/`)))
  for (const route of routes) {
    const rel = relOfRoute(route)
    const page = info(rel)
    if (!page.lang) add(findings, 'LANG_MISSING', 'error', `<html> has no lang attribute`, { path: rel })
    else {
      const key = localeOfRoute(route, opts.locales)
      const expected = expectedLang.get(key)
      if (expected && page.lang !== expected) {
        add(findings, 'LANG_MISMATCH', 'warn', `lang="${page.lang}" but the ${key} home page declares "${expected}"`, {
          path: rel,
        })
      }
    }
    if (page.h1 === 0) add(findings, 'H1_MISSING', 'error', 'page has no <h1>', { path: rel })
    else if (page.h1 > 1) add(findings, 'H1_MULTIPLE', 'warn', `page has ${page.h1} <h1> elements`, { path: rel })
    if (!homeRoutes.has(route) && !page.hasDescription) {
      add(findings, 'DESCRIPTION_MISSING', 'warn', 'page has no meta description (frontmatter description)', {
        path: rel,
      })
    }
  }

  // ── landing profile (info only: the layout is optional) ────────────────
  if (opts.profile === 'landing') {
    for (const key of opts.locales) {
      const home = key === opts.defaultLocale ? '/' : `/${key}/`
      if (!routes.includes(home)) continue
      const rel = relOfRoute(home)
      const page = info(rel)
      if (!page.hasHero) {
        add(findings, 'LANDING_HERO_MISSING', 'info', 'home page is not a splash page (data-has-hero missing)', {
          path: rel,
        })
      }
      if (!page.heroTitle) {
        add(findings, 'LANDING_TITLE_MISSING', 'info', 'home page has no hero title (h1#_top)', { path: rel })
      }
      const html = readText(path.join(opts.dist, rel))
      if (!/class="[^"]*\bsd-section\b/.test(html)) {
        add(findings, 'LANDING_SECTION_MISSING', 'info', 'home page has no .sd-section block', { path: rel })
      }
      if (page.hasSidebar || /\bdata-has-sidebar\b/.test(html)) {
        add(findings, 'LANDING_HAS_SIDEBAR', 'info', 'home page renders a sidebar', { path: rel })
      }
    }
  }

  // ── no language sniffing / redirect in the build ───────────────────────
  const scriptFiles = walkFiles(opts.dist, (name) => /\.(?:js|mjs)$/.test(name), []).map((full) =>
    toPosix(path.relative(opts.dist, full)),
  )
  for (const rel of [...htmlFiles, ...scriptFiles]) {
    const text = readText(path.join(opts.dist, rel))
    for (const needle of SNIFF_NEEDLES) {
      if (text.includes(needle)) {
        add(findings, 'LANGUAGE_SNIFFING', 'error', `build contains ${needle}`, { path: rel })
        break
      }
    }
  }

  // ── internal links and assets stay under base and resolve ─────────────
  if (opts.checkLinks !== 'off') {
    const external = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i
    let checked = 0
    let exhausted = false
    for (const rel of htmlFiles) {
      const html = readText(path.join(opts.dist, rel))
      const pageRoute =
        rel === 'index.html'
          ? '/'
          : rel.endsWith('/index.html')
            ? `/${rel.slice(0, -'index.html'.length)}`
            : `/${rel}`
      // Index routes already end with '/', which is what `new URL` needs to
      // resolve relative links against the page directory.
      const normalizedPage = pageRoute
      const seenHere = new Set()
      for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        if (checked >= opts.maxLinks) {
          exhausted = true
          break
        }
        const raw = match[1].replace(/&amp;/g, '&').trim()
        if (!raw || external.test(raw)) continue
        if (seenHere.has(raw)) continue
        seenHere.add(raw)
        const clean = raw.split('#')[0].split('?')[0]
        if (!clean) continue
        checked += 1
        const resolved = resolveTarget(clean, normalizedPage, opts.base)
        if (resolved.escapes) {
          add(findings, 'BASE_ESCAPE', 'error', `${raw} escapes base ${opts.base || '/'}`, { path: rel })
          continue
        }
        if (resolved.target === null) continue
        const disk = diskTarget(opts.dist, resolved.target)
        if (!fs.existsSync(disk)) {
          add(findings, 'DEAD_LINK', 'error', `${raw} -> missing ${toPosix(path.relative(opts.dist, disk))}`, {
            path: rel,
          })
        }
      }
      if (exhausted) break
    }
    stats.linksChecked = checked
    if (exhausted) {
      add(findings, 'LINK_LIMIT', 'warn', `link checking stopped at the --max-links limit (${opts.maxLinks})`)
    }
  }

  // ── language switcher maps to the same slug ────────────────────────────
  if (opts.locales.length > 1) {
    for (const route of routes) {
      const from = localeOfRoute(route, opts.locales)
      const rel = relOfRoute(route)
      const html = readText(path.join(opts.dist, rel))
      for (const to of opts.locales) {
        if (to === from) continue
        const mirror = mirroredRoute(route, from, to)
        const target = `${opts.base}${mirror}`
        if (!html.includes(`href="${target}"`) && !html.includes(`value="${target}"`)) {
          add(findings, 'SWITCHER_MISSING', 'error', `language switcher does not offer ${target}`, { path: rel })
        }
      }
    }
  }

  return { findings, stats, routes, locales: opts.locales, base: opts.base, dist: opts.dist }
}

/**
 * External links are only reached with `--check-links all`, never in the
 * deterministic core run.
 */
export function collectExternalLinks(dist, limit) {
  const external = /^https?:\/\//i
  const found = []
  const seen = new Set()
  for (const rel of listHtml(dist)) {
    const html = readText(path.join(dist, rel))
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const raw = match[1].replace(/&amp;/g, '&').trim()
      if (!external.test(raw)) continue
      const url = raw.split('#')[0]
      if (seen.has(url)) continue
      seen.add(url)
      found.push({ url, page: rel })
      if (limit && found.length >= limit) return found
    }
  }
  return found
}

export async function checkExternalLinks(options) {
  const opts = normalizeOptions(options || {})
  const findings = []
  if (!opts.dist || !fs.existsSync(opts.dist)) return findings
  const links = collectExternalLinks(opts.dist, opts.maxLinks)
  await Promise.all(
    links.map(async (link) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), opts.timeout)
      try {
        let response = await fetch(link.url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' })
        if (response.status === 405 || response.status === 403) {
          response = await fetch(link.url, { method: 'GET', signal: controller.signal, redirect: 'follow' })
        }
        if (response.status >= 400) {
          add(findings, 'EXTERNAL_LINK_UNREACHABLE', 'warn', `${link.url} -> HTTP ${response.status}`, {
            path: link.page,
          })
        }
      } catch (error) {
        add(findings, 'EXTERNAL_LINK_UNREACHABLE', 'warn', `${link.url} -> ${error.name || 'error'}`, {
          path: link.page,
        })
      } finally {
        clearTimeout(timer)
      }
    }),
  )
  return findings
}

export function formatFindingsText(findings) {
  if (!findings || findings.length === 0) return 'ok: no findings'
  return findings
    .map((item) => {
      const where = item.path ? `${item.path}: ` : ''
      return `${item.severity.toUpperCase()} ${item.code} ${where}${item.message}`
    })
    .join('\n')
}
