/**
 * starlight-docs — repository, toolchain, Astro/Starlight and Pages detection.
 *
 * Read-only. Every command runs with a timeout and a non-interactive stdio, so
 * a missing or unauthenticated `gh` degrades to "unverified" instead of
 * blocking the run.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

/** Astro 6.4.x requires this; @astrojs/starlight inherits the floor from astro. */
export const NODE_FLOOR = '22.12.0'
export const DEFAULT_CI_NODE = '22'

const ASTRO_CONFIG_NAMES = [
  'astro.config.mjs',
  'astro.config.js',
  'astro.config.mts',
  'astro.config.ts',
  'astro.config.cjs',
]

export function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options && options.cwd ? options.cwd : undefined,
    encoding: 'utf8',
    timeout: options && options.timeout ? options.timeout : 15000,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    error: result.error ? String(result.error.message || result.error) : null,
  }
}

export function compareVersions(a, b) {
  const parse = (value) =>
    String(value || '')
      .replace(/^v/, '')
      .split('-')[0]
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

export function normalizeNodeVersion(value) {
  const parts = String(value || '')
    .replace(/^v/, '')
    .split('.')
  while (parts.length < 3) parts.push('0')
  return parts.slice(0, 3).join('.')
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function readPackageJson(dir) {
  return readJson(path.join(dir, 'package.json'))
}

export function detectPackageManager(repo) {
  const candidates = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
    ['package-lock.json', 'npm'],
  ]
  const dirs = [repo, path.join(repo, 'site')]
  for (const dir of dirs) {
    for (const [file, manager] of candidates) {
      if (fs.existsSync(path.join(dir, file))) return { manager, evidence: path.join(dir, file) }
    }
  }
  return { manager: 'npm', evidence: null }
}

export function findAstroConfig(dir) {
  for (const name of ASTRO_CONFIG_NAMES) {
    const file = path.join(dir, name)
    if (fs.existsSync(file)) return file
  }
  return null
}

/**
 * Regex-level read of the few astro.config values the checker needs. It is
 * deliberately shallow: configs that compute values at runtime fall back to the
 * CLI flags, and `check` never depends on this succeeding.
 */
export function parseAstroConfig(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const pick = (pattern) => {
    const match = pattern.exec(text)
    return match ? match[1] : null
  }
  const base = pick(/\bbase:\s*['"]([^'"]*)['"]/)
  const site = pick(/\bsite:\s*['"]([^'"]+)['"]/)
  const defaultLocale = pick(/\bdefaultLocale:\s*['"]([^'"]+)['"]/)
  const locales = []
  const block = /\blocales:\s*\{([\s\S]*?)\n\s{0,10}\}/.exec(text)
  if (block) {
    for (const match of block[1].matchAll(/(?:^|\n)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z][\w-]*))\s*:\s*\{/g)) {
      const key = match[1] || match[2] || match[3]
      if (key && !locales.includes(key)) locales.push(key)
    }
  }
  return {
    base,
    site,
    defaultLocale: defaultLocale || 'root',
    locales: locales.length > 0 ? locales : ['root'],
    pagefind: !/\bpagefind:\s*false/.test(text),
    disable404Route: /\bdisable404Route:\s*true/.test(text),
  }
}

function dependencyVersion(pkg, name) {
  if (!pkg) return null
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const table = pkg[field]
    if (table && typeof table[name] === 'string') return { spec: table[name], field }
  }
  return null
}

export function detectSiteLayout({ repo, mode, dir }) {
  if (dir) {
    const siteDir = path.resolve(repo, dir)
    return { mode: mode || 'site', dir: path.relative(repo, siteDir).split(path.sep).join('/') || '.', siteDir }
  }
  const siteCandidate = path.join(repo, 'site')
  const hasSite =
    Boolean(findAstroConfig(siteCandidate)) ||
    fs.existsSync(path.join(siteCandidate, 'src', 'content')) ||
    fs.existsSync(path.join(siteCandidate, 'package.json'))
  if (mode === 'root') return { mode: 'root', dir: '.', siteDir: repo }
  if (mode === 'site') return { mode: 'site', dir: 'site', siteDir: siteCandidate }
  if (hasSite) return { mode: 'site', dir: 'site', siteDir: siteCandidate }
  if (findAstroConfig(repo) || fs.existsSync(path.join(repo, 'src', 'content'))) {
    return { mode: 'root', dir: '.', siteDir: repo }
  }
  if (fs.existsSync(path.join(repo, 'dist'))) return { mode: 'root', dir: '.', siteDir: repo }
  return { mode: 'site', dir: 'site', siteDir: siteCandidate }
}

export function looksLikeCodeRepo(repo) {
  const pkg = readPackageJson(repo)
  if (pkg) {
    // A published package or an app entry point means "this repo ships code".
    if (pkg.main || pkg.exports || pkg.bin) return true
    if (Array.isArray(pkg.files) && pkg.files.length > 0) return true
  }
  for (const candidate of ['src', 'lib', 'tools']) {
    const dir = path.join(repo, candidate)
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) return true
  }
  return false
}

export function parseGitRemote(url) {
  if (!url) return null
  const cleaned = url.replace(/\.git$/, '')
  const ssh = /^git@([^:]+):([^/]+)\/(.+)$/.exec(cleaned)
  if (ssh) return { host: ssh[1], owner: ssh[2], repo: ssh[3] }
  const https = /^https?:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(cleaned)
  if (https) return { host: https[1], owner: https[2], repo: https[3] }
  return null
}

export function detectGit(repo, timeout) {
  const result = run('git', ['remote', 'get-url', 'origin'], { cwd: repo, timeout })
  if (!result.ok || !result.stdout) return { remote: null, owner: null, repo: null }
  const parsed = parseGitRemote(result.stdout.split('\n')[0].trim())
  return { remote: result.stdout.split('\n')[0].trim(), ...(parsed || {}), name: parsed ? parsed.repo : null }
}

export function detectPages({ owner, repo, timeout }) {
  if (!owner || !repo) {
    return { status: 'unverified', reason: 'no GitHub remote on origin' }
  }
  const result = run('gh', ['api', `repos/${owner}/${repo}/pages`], { timeout })
  if (!result.ok) {
    const reason = (result.stderr || result.error || 'gh api failed').split('\n')[0]
    return { status: 'unverified', reason }
  }
  const data = (() => {
    try {
      return JSON.parse(result.stdout)
    } catch {
      return null
    }
  })()
  if (!data) return { status: 'unverified', reason: 'gh returned non-JSON output' }
  return {
    status: 'verified',
    enabled: true,
    buildType: data.build_type || null,
    source: data.source || null,
    htmlUrl: data.html_url || null,
    httpsEnforced: Boolean(data.https_enforced),
  }
}

export function detectFramework({ layout, repo }) {
  const config =
    findAstroConfig(layout.siteDir) || (layout.siteDir === repo ? null : findAstroConfig(repo)) || null
  const pkgDirs = [layout.siteDir, repo].filter((dir, index, all) => all.indexOf(dir) === index)
  let starlight = null
  let astro = null
  for (const dir of pkgDirs) {
    const pkg = readPackageJson(dir)
    starlight = starlight || dependencyVersion(pkg, '@astrojs/starlight')
    astro = astro || dependencyVersion(pkg, 'astro')
  }
  let installed = null
  let astroEngines = null
  for (const dir of pkgDirs) {
    const installedPkg = readJson(path.join(dir, 'node_modules', '@astrojs', 'starlight', 'package.json'))
    if (!installed && installedPkg && installedPkg.version) installed = installedPkg.version
    const astroPkg = readJson(path.join(dir, 'node_modules', 'astro', 'package.json'))
    if (!astroEngines && astroPkg) astroEngines = astroPkg.engines || null
  }

  const distDir = path.join(layout.siteDir, 'dist')
  const hasDist = fs.existsSync(distDir)
  let framework = 'unknown'
  if (starlight) framework = 'starlight'
  else if (astro || config) framework = 'astro'
  else if (hasDist && fs.existsSync(path.join(distDir, '_astro'))) framework = 'astro'
  else if (hasDist) framework = 'static-html'

  return {
    framework,
    config,
    distDir,
    hasDist,
    starlight: starlight ? { spec: starlight.spec, installed } : null,
    astro: astro ? { spec: astro.spec, engines: astroEngines } : null,
  }
}

export function detectRepo({ repo, node, timeout, pages = true }) {
  const resolved = path.resolve(repo || process.cwd())
  const packageManager = detectPackageManager(resolved)
  const layout = detectSiteLayout({ repo: resolved })
  const framework = detectFramework({ layout, repo: resolved })
  const git = detectGit(resolved, timeout)
  const localNode = process.version.replace(/^v/, '')
  const targetNode = node ? normalizeNodeVersion(node) : DEFAULT_CI_NODE
  const effectiveNode = node ? normalizeNodeVersion(node) : localNode
  const pkg = readPackageJson(resolved)
  const sitePkg = readPackageJson(layout.siteDir)

  const nodeInfo = {
    local: localNode,
    target: targetNode,
    effective: effectiveNode,
    floor: NODE_FLOOR,
    ok: compareVersions(effectiveNode, NODE_FLOOR) >= 0,
    astroEngines: framework.astro && framework.astro.engines ? framework.astro.engines.node || null : null,
  }

  const findings = []
  if (!nodeInfo.ok) {
    findings.push({
      code: 'NODE_UNSUPPORTED',
      severity: 'error',
      message: `Node.js v${effectiveNode} is not supported by Astro! Please upgrade Node.js to a supported version: ">=${NODE_FLOOR}" (or pin an older Astro; this skill does not downgrade automatically)`,
    })
  }
  const pagesInfo = pages
    ? detectPages({ owner: git.owner, repo: git.repo, timeout })
    : { status: 'skipped' }
  if (pagesInfo.status === 'unverified') {
    findings.push({
      code: 'PAGES_UNVERIFIED',
      severity: 'info',
      message: `GitHub Pages state could not be read: ${pagesInfo.reason}`,
    })
  }

  return {
    repo: resolved,
    framework: framework.framework,
    mode: layout.mode,
    hasCode: looksLikeCodeRepo(resolved),
    // Existing site config wins; otherwise code repos get site/, docs-only
    // repositories get the root so the docs stay next to the README.
    suggestedMode:
      framework.config || fs.existsSync(path.join(layout.siteDir, 'src', 'content'))
        ? layout.mode
        : looksLikeCodeRepo(resolved)
          ? 'site'
          : 'root',
    packageManager: packageManager.manager,
    packageManagerEvidence: packageManager.evidence,
    node: nodeInfo,
    git: {
      remote: git.remote || null,
      owner: git.owner || null,
      repo: git.repo || null,
    },
    pages: pagesInfo,
    layout: {
      mode: layout.mode,
      dir: layout.dir,
      repo: resolved,
      siteDir: layout.siteDir,
      config: framework.config,
      distDir: framework.distDir,
      hasDist: framework.hasDist,
    },
    starlight: framework.starlight,
    astro: framework.astro,
    rootPackage: pkg ? { name: pkg.name || null, engines: pkg.engines || null } : null,
    sitePackage: sitePkg ? { name: sitePkg.name || null, engines: sitePkg.engines || null } : null,
    findings,
  }
}
