/**
 * starlight-docs — `audit` action: identify the framework first, then reuse the
 * same assertions as `check`. Non-Starlight sites only get a read-only Pages
 * report and migration pointers; nothing is written.
 */
import fs from 'node:fs'
import path from 'node:path'

import { checkDist, checkExternalLinks } from './check.mjs'
import { scanContentPages } from './scaffold.mjs'

function add(findings, code, severity, message, extra) {
  const entry = { code, severity, message }
  if (extra) {
    for (const key of Object.keys(extra)) {
      if (extra[key] !== undefined && extra[key] !== null) entry[key] = extra[key]
    }
  }
  findings.push(entry)
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function homeHtml(dist, locales) {
  const targets = []
  for (const locale of locales) {
    const rel = locale === 'root' ? 'index.html' : path.join(locale, 'index.html')
    const full = path.join(dist, rel)
    if (fs.existsSync(full)) targets.push({ rel: rel.split(path.sep).join('/'), full })
  }
  return targets
}

function sidebarLinks(configText) {
  if (!configText) return null
  if (/autogenerate\s*:/.test(configText)) return null
  const links = []
  for (const match of configText.matchAll(/link:\s*'([^']+)'/g)) links.push(match[1])
  for (const match of configText.matchAll(/link:\s*"([^"]+)"/g)) links.push(match[1])
  return links
}

function normalizeRoute(value) {
  let route = value
  if (!route.startsWith('/')) route = `/${route}`
  if (!route.endsWith('/') && !path.extname(route)) route = `${route}/`
  return route
}

function distChecks({ dist, locales, findings, full }) {
  const homes = homeHtml(dist, locales)
  const has = (rel) => fs.existsSync(path.join(dist, rel))

  if (!has('404.html') && !has(path.join('404', 'index.html'))) {
    add(findings, 'NOT_FOUND_MISSING', 'info', 'no 404 page in the build (Starlight disable404Route removes it)')
  }

  if (homes.length === 0) {
    add(findings, 'NO_HTML', 'error', `no locale home page under ${dist}`)
    return
  }

  const home = readIfExists(homes[0].full) || ''

  if (full) {
    const pagefind = fs.existsSync(path.join(dist, 'pagefind'))
    if (!pagefind && !/pagefind/i.test(home)) {
      add(findings, 'PAGEFIND_DISABLED', 'info', 'search is not in the build (pagefind: false or no Pagefind binary)')
    }
    if (!/<link[^>]+rel="canonical"/i.test(home)) {
      add(findings, 'CANONICAL_MISSING', 'warn', 'home page has no rel="canonical" (set `site` in astro.config)', {
        path: homes[0].rel,
      })
    }
    if (!/property="og:title"/i.test(home)) {
      add(findings, 'OG_MISSING', 'warn', 'home page has no og:title meta tag', { path: homes[0].rel })
    }
    if (!/name="theme-color"/i.test(home)) {
      add(findings, 'THEME_COLOR_MISSING', 'info', 'no theme-color meta tag', { path: homes[0].rel })
    }
    if (!/<footer[\s\S]*?<\/footer>/i.test(home)) {
      add(findings, 'FOOTER_LINKS_MISSING', 'info', 'home page has no footer block')
    }
  }

  if (!has('robots.txt') && !/<meta[^>]+name="robots"/i.test(home)) {
    add(findings, 'ROBOTS_MISSING', 'info', 'no robots.txt and no robots meta tag')
  }
  const sitemap = ['sitemap-index.xml', 'sitemap-0.xml', 'sitemap.xml'].some((file) => has(file))
  if (!sitemap) {
    add(findings, 'SITEMAP_MISSING', 'warn', 'no sitemap in the build (Starlight emits one when `site` is set)')
  }
}

function pagesChecks({ pages, findings }) {
  if (!pages || pages.status !== 'verified') return
  const buildType = pages.buildType || 'unknown'
  add(findings, 'PAGES_BUILD_TYPE', 'info', `GitHub Pages build type: ${buildType}`, {
    path: null,
  })
  if (pages.httpsEnforced === false) {
    add(findings, 'PAGES_HTTPS_NOT_ENFORCED', 'warn', 'GitHub Pages does not enforce HTTPS')
  }
}

function sidebarChecks({ config, layout, locales, findings }) {
  const configText = readIfExists(config || '')
  const links = sidebarLinks(configText)
  if (!links) return
  const contentDir = path.join(layout.siteDir, 'src', 'content', 'docs')
  if (!fs.existsSync(contentDir)) return
  const pages = scanContentPages({ contentDir, locales })
  const normalized = new Set(links.map((link) => normalizeRoute(link)))
  const localeNeutral = pages.filter((page) => page.locale === 'root' || locales.includes(page.locale))
  for (const page of localeNeutral) {
    const route = normalizeRoute(page.route)
    if (!normalized.has(route) && page.locale === 'root' && !page.isHome) {
      add(findings, 'SIDEBAR_MISSING_PAGE', 'warn', `${route} exists but is not in the sidebar`, {
        path: page.rel,
      })
    }
  }
  const known = new Set(localeNeutral.map((page) => normalizeRoute(page.route)))
  for (const link of normalized) {
    if (!known.has(link)) {
      add(findings, 'SIDEBAR_DEAD_LINK', 'warn', `sidebar points at ${link}, which has no page`, {
        path: config ? path.relative(layout.repo, config).split(path.sep).join('/') : undefined,
      })
    }
  }
}

function readBrowserReport(file, findings) {
  if (!file) return
  const text = readIfExists(file)
  if (!text) {
    add(findings, 'BROWSER_REPORT_UNREADABLE', 'warn', `browser report not found: ${file}`)
    return
  }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    add(findings, 'BROWSER_REPORT_UNREADABLE', 'warn', `browser report is not JSON: ${file}`)
    return
  }
  const items = Array.isArray(data) ? data : Array.isArray(data.checks) ? data.checks : []
  for (const item of items) {
    if (item.ok === false || item.status === 'fail') {
      add(findings, 'VISUAL_REGRESSION', 'warn', `${item.id || 'visual'}: ${item.note || 'failed in the browser report'}`, {
        path: file,
      })
    }
  }
}

/** Findings present now but not in the baseline report (code+path/message). */
export function diffBaseline(findings, baselinePath) {
  const text = readIfExists(baselinePath)
  if (!text) return { regressions: [], warning: `baseline not found: ${baselinePath}` }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { regressions: [], warning: `baseline is not JSON: ${baselinePath}` }
  }
  const previous = new Set(
    (Array.isArray(data.findings) ? data.findings : []).map((item) => `${item.code}|${item.path || ''}`),
  )
  const regressions = findings
    .filter((item) => !previous.has(`${item.code}|${item.path || ''}`))
    .map((item) => `${item.code}${item.path ? ` @ ${item.path}` : ''}`)
  return { regressions: [...new Set(regressions)], warning: null }
}

export async function runAudit({ detected, dist, options }) {
  const findings = [...(detected.findings || [])]
  const framework = detected.framework
  const locales = options.locales && options.locales.length > 0 ? options.locales : ['root']
  const artifacts = []
  let stats = null

  if (framework === 'starlight') {
    const core = checkDist({
      dist,
      base: options.base,
      locales,
      defaultLocale: options.defaultLocale,
      profile: options.profile || 'core',
      checkLinks: options.checkLinks || 'internal',
      maxLinks: options.maxLinks,
      timeout: options.timeout,
    })
    findings.push(...core.findings)
    stats = core.stats
    distChecks({ dist, locales, findings, full: true })
    sidebarChecks({ config: detected.layout.config, layout: detected.layout, locales, findings })
    if (options.checkLinks === 'all') {
      findings.push(...(await checkExternalLinks({ dist, locales, maxLinks: options.maxLinks, timeout: options.timeout })))
    }
  } else if (framework === 'astro') {
    add(
      findings,
      'FRAMEWORK_NOT_STARLIGHT',
      'info',
      'Astro site without @astrojs/starlight: only the generic Pages report runs; see the migration notes',
    )
  } else if (framework === 'static-html') {
    add(
      findings,
      'FRAMEWORK_NOT_STARLIGHT',
      'info',
      'pre-built or hand-written HTML: nothing here is rewritten; only the generic Pages report runs',
    )
    distChecks({ dist, locales, findings, full: false })
  } else {
    add(findings, 'FRAMEWORK_UNKNOWN', 'info', 'no Astro config, Starlight dependency or build output was found')
  }

  pagesChecks({ pages: detected.pages, findings })
  readBrowserReport(options.browserReport, findings)

  return { findings, framework, artifacts, stats }
}
