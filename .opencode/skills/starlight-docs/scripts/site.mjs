#!/usr/bin/env node
/**
 * starlight-docs — the only entry point the model calls.
 *
 *   node <skill>/scripts/site.mjs --action <detect|scaffold|check|audit|emit-check> \
 *     --repo <path> [flags...]
 *
 * Output is JSON by default (`--md` for Markdown). Only `scaffold --apply` and
 * `emit-check` write files, and only below `--repo` (plus the explicit `--out`).
 */
import fs from 'node:fs'
import path from 'node:path'

import { NODE_FLOOR, compareVersions, detectRepo, normalizeNodeVersion, parseAstroConfig } from './lib/detect.mjs'
import {
  applyPlan,
  buildSite,
  detectDist,
  ensureDeps,
  planScaffold,
  summarizePlan,
  tail,
} from './lib/scaffold.mjs'
import { runAudit, diffBaseline } from './lib/audit.mjs'
import { checkDist, checkExternalLinks } from './lib/check.mjs'
import { emitCheck } from './lib/emit-check.mjs'
import { finalizeResult, serialize, shouldFail } from './lib/report.mjs'

const ACTIONS = ['detect', 'scaffold', 'check', 'audit', 'emit-check']

const STRING_FLAGS = new Set([
  'action',
  'repo',
  'report',
  'fail-on',
  'mode',
  'dir',
  'owner',
  'name',
  'site',
  'base',
  'locales',
  'default-locale',
  'preset',
  'components',
  'search',
  'pages',
  'node',
  'astro',
  'starlight',
  'package-manager',
  'dist',
  'site-url',
  'i18n',
  'check-links',
  'max-links',
  'profile',
  'baseline',
  'browser-report',
  'out',
  'timeout',
])

const BOOLEAN_FLAGS = new Set([
  'json',
  'md',
  'dry-run',
  'apply',
  'force',
  'verbose',
  'no-install',
  'no-build',
  'help',
  'h',
])

function parseArgs(argv) {
  const args = {}
  const unknown = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      unknown.push(token)
      continue
    }
    const body = token.slice(2)
    const equals = body.indexOf('=')
    const key = equals === -1 ? body : body.slice(0, equals)
    const inline = equals === -1 ? undefined : body.slice(equals + 1)
    if (STRING_FLAGS.has(key)) {
      if (inline !== undefined) args[key] = inline
      else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')) {
        args[key] = argv[index + 1]
        index += 1
      } else args[key] = true
    } else if (BOOLEAN_FLAGS.has(key)) {
      args[key] = inline === undefined ? true : inline !== 'false'
    } else {
      unknown.push(token)
      if (argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')) index += 1
    }
  }
  return { args, unknown }
}

function numberFlag(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function usage() {
  return [
    'starlight-docs — GitHub Pages documentation sites',
    '',
    'Usage:',
    '  node site.mjs --action <detect|scaffold|check|audit|emit-check> --repo <path> [flags]',
    '',
    'Actions:',
    '  detect       read-only: framework, Node, package manager, git remote, Pages',
    '  scaffold     write a Starlight skeleton (dry run unless --apply)',
    '  check        install (optional), build (optional) and assert the dist',
    '  audit        detect the framework, then check + Pages/SEO findings',
    '  emit-check   export the assertions as a standalone script (--out <path>)',
    '',
    'Common flags:',
    '  --repo <path>            target repository (default: cwd)',
    '  --json | --md            output format (default: json)',
    '  --dry-run | --apply      scaffold preview (default) or write',
    '  --force                  overwrite existing files (scaffold)',
    '  --verbose                print commands and timings to stderr',
    '  --timeout <ms>           subprocess timeout',
    '  --no-install/--no-build  skip dependency install / site build',
    '  --report <path>          also write the report to a file',
    '  --fail-on <error|warn|info|off>  exit-code threshold (default: error)',
    '',
    'scaffold: --mode <site|root> --dir <path> --owner <gh-owner> --name <repo>',
    '          --site <url> --base </repo> --locales <root,zh-cn> --default-locale <root>',
    '          --preset <none|developer-dark> --components <auto|theme|theme+lang|none>',
    '          --search <pagefind|none> --pages <workflow|none> --node <version>',
    '          --astro <version> --starlight <version> --package-manager <npm|pnpm|yarn|bun>',
    'check/audit: --dist <path> --site-url <url> --locales <...> --i18n <auto|off>',
    '          --check-links <all|internal|off> --max-links <n> --profile <core|landing>',
    '          --baseline <report.json> --browser-report <report.json>',
    'emit-check: --out <path> [--dist <path>] [--base </repo>] [--locales <...>]',
    '          [--profile <core|landing>]',
  ].join('\n')
}

function failure(action, repo, code, message) {
  return {
    schemaVersion: 1,
    ok: false,
    action,
    repo,
    error: { code, message },
    findings: [],
    counts: { error: 0, warn: 0, info: 0 },
    next: [],
  }
}

function nodeError(detected) {
  const node = detected.node
  if (node.ok) return null
  return {
    code: 'node_unsupported',
    message: `Node.js v${node.effective} is not supported by Astro! Please upgrade Node.js to a supported version: ">=${NODE_FLOOR}" (or pin an older Astro; this skill does not downgrade automatically)`,
  }
}

function configOptions(detected, argv) {
  const config = detected.layout.config ? parseAstroConfig(detected.layout.config) : null
  const base = argv.base !== undefined ? argv.base : config && config.base !== null ? config.base : ''
  let locales =
    argv.locales !== undefined
      ? String(argv.locales)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : config
        ? config.locales
        : ['root']
  if (argv.i18n === 'off') locales = ['root']
  return {
    base,
    locales,
    defaultLocale: config ? config.defaultLocale : 'root',
    siteUrl: argv['site-url'] || (config ? config.site : null),
    profile: argv.profile === 'landing' ? 'landing' : 'core',
    checkLinks: ['all', 'internal', 'off'].includes(argv['check-links']) ? argv['check-links'] : 'internal',
    maxLinks: numberFlag(argv['max-links'], 4000),
  }
}

function notesToFindings(notes) {
  const findings = []
  for (const note of notes || []) {
    const match = /^([A-Z][A-Z0-9_]+):\s*(.*)$/.exec(note)
    if (!match) {
      findings.push({ code: 'NOTE', severity: 'info', message: note })
      continue
    }
    const severity =
      match[1] === 'DEFAULT_LOCALE_IGNORED' || match[1] === 'ROOT_PACKAGE_JSON_CONFLICT' ? 'warn' : 'info'
    findings.push({ code: match[1], severity, message: match[2] })
  }
  return findings
}

function dedupe(findings) {
  const seen = new Set()
  const out = []
  for (const finding of findings) {
    const key = `${finding.code}|${finding.path || ''}|${finding.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(finding)
  }
  return out
}

/** Installs and builds when the project has an Astro toolchain. */
function prepareDist({ detected, argv, repo, timeout, verbose }) {
  const findings = []
  const artifacts = []
  const dist = detectDist(detected.layout, argv.dist)
  const canBuild = detected.framework === 'starlight' || detected.framework === 'astro'

  if (canBuild && !argv['no-install']) {
    const install = ensureDeps({ layout: detected.layout, packageManager: detected.packageManager, timeout, verbose })
    artifacts.push({ kind: 'install', command: install.command, ok: install.ok, skipped: Boolean(install.skipped) })
    if (!install.ok) {
      findings.push({
        code: 'INSTALL_FAILED',
        severity: 'error',
        message: `${install.command} failed\n${tail(install.stderr || install.error || '')}`,
      })
      return { dist, findings, artifacts, built: false }
    }
  }

  if (canBuild && !argv['no-build']) {
    const build = buildSite({ layout: detected.layout, packageManager: detected.packageManager, timeout, verbose })
    artifacts.push({ kind: 'build', command: build.command, ok: build.ok, elapsed: build.elapsed })
    if (!build.ok) {
      findings.push({
        code: 'BUILD_FAILED',
        severity: 'error',
        message: `${build.command} failed\n${tail(build.stderr || build.error || '')}`,
      })
      return { dist, findings, artifacts, built: false }
    }
    return { dist, findings, artifacts, built: true }
  }

  if (argv['no-build'] && !fs.existsSync(dist)) {
    findings.push({
      code: 'MISSING_DIST',
      severity: 'error',
      message: `--no-build was given but ${dist} does not exist`,
      path: dist,
    })
  }
  return { dist, findings, artifacts, built: false }
}

async function actionDetect({ argv, repo, timeout }) {
  const detected = detectRepo({ repo, node: argv.node, timeout })
  const result = finalizeResult({
    action: 'detect',
    repo,
    framework: detected.framework,
    mode: detected.mode,
    suggestedMode: detected.suggestedMode,
    packageManager: detected.packageManager,
    node: detected.node,
    git: detected.git,
    pages: detected.pages,
    layout: detected.layout,
    starlight: detected.starlight,
    astro: detected.astro,
    rootPackage: detected.rootPackage,
    sitePackage: detected.sitePackage,
    artifacts: [],
    findings: detected.findings,
  })
  return { result, exit: shouldFail(result.findings, argv['fail-on'] || 'error') ? 1 : 0 }
}

function actionScaffold({ argv, repo, detected, timeout }) {
  const gate = nodeError(detected)
  if (gate) {
    return { result: failure('scaffold', repo, gate.code, gate.message), exit: 1 }
  }
  const locales =
    argv.locales !== undefined
      ? String(argv.locales)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : ['root']
  const owner = argv.owner || detected.git.owner || null
  const name = argv.name || detected.git.repo || (detected.rootPackage && detected.rootPackage.name) || path.basename(repo)
  const plan = planScaffold({
    repo,
    mode: argv.mode === 'root' ? 'root' : argv.mode === 'site' ? 'site' : detected.suggestedMode,
    dir: argv.dir,
    owner,
    name,
    site: argv.site,
    base: argv.base,
    locales,
    defaultLocale: argv['default-locale'],
    preset: argv.preset === 'developer-dark' ? 'developer-dark' : 'none',
    components: argv.components || 'auto',
    search: argv.search === 'pagefind' ? 'pagefind' : 'none',
    pages: argv.pages === 'none' ? 'none' : 'workflow',
    node: argv.node,
    astro: argv.astro,
    starlight: argv.starlight,
    packageManager: argv['package-manager'] || detected.packageManager,
  })

  const actions = summarizePlan(plan)
  const apply = Boolean(argv.apply) && !argv['dry-run']
  let applied = null
  if (apply) {
    applied = applyPlan(plan, { force: Boolean(argv.force) })
  }
  const files = plan.files.map((file, index) => ({
    path: file.path,
    action: actions[index].action,
    reason: actions[index].reason || file.reason || null,
    written: applied ? applied.written.some((entry) => entry.path === file.path) : false,
  }))
  const findings = notesToFindings(plan.notes)
  if (!owner) {
    findings.push({
      code: 'NOTE',
      severity: 'info',
      message: 'no GitHub owner was detected; pass --owner/--name or the site URL and base stay placeholders',
    })
  }

  const result = finalizeResult({
    action: 'scaffold',
    repo,
    ok: true,
    mode: plan.layout.mode,
    dir: plan.layout.dir,
    siteDir: plan.layout.siteDir,
    site: plan.siteUrl,
    base: plan.base,
    locales: plan.locales,
    defaultLocale: plan.defaultLocale,
    preset: plan.preset,
    components: plan.components,
    search: plan.search,
    pages: plan.pages,
    node: { ...detected.node, target: plan.node },
    applied: apply,
    files,
    backups: applied ? applied.backups : [],
    skipped: applied ? applied.skipped : [],
    warnings: plan.warnings,
    notes: plan.notes,
    artifacts: [],
    findings,
  })
  return { result, exit: shouldFail(result.findings, argv['fail-on'] || 'error') ? 1 : 0 }
}

async function actionCheck({ argv, repo, detected, timeout, verbose }) {
  const gate = nodeError(detected)
  if (gate) {
    return { result: failure('check', repo, gate.code, gate.message), exit: 1 }
  }
  const prepared = prepareDist({ detected, argv, repo, timeout, verbose })
  const opts = configOptions(detected, argv)
  const check = checkDist({
    dist: prepared.dist,
    base: opts.base,
    locales: opts.locales,
    defaultLocale: opts.defaultLocale,
    profile: opts.profile,
    checkLinks: opts.checkLinks,
    maxLinks: opts.maxLinks,
    timeout,
  })
  const findings = [...prepared.findings, ...check.findings]
  if (opts.checkLinks === 'all' && fs.existsSync(prepared.dist)) {
    findings.push(
      ...(await checkExternalLinks({
        dist: prepared.dist,
        locales: opts.locales,
        maxLinks: opts.maxLinks,
        timeout,
      })),
    )
  }

  const result = finalizeResult({
    action: 'check',
    repo,
    framework: detected.framework,
    mode: detected.mode,
    dist: prepared.dist,
    base: opts.base,
    locales: opts.locales,
    profile: opts.profile,
    routes: check.routes,
    stats: check.stats,
    built: prepared.built,
    artifacts: prepared.artifacts,
    findings: dedupe(findings),
  })
  return { result, exit: shouldFail(result.findings, argv['fail-on'] || 'error') ? 1 : 0 }
}

async function actionAudit({ argv, repo, detected, timeout, verbose }) {
  const gate = nodeError(detected)
  if (gate) {
    return { result: failure('audit', repo, gate.code, gate.message), exit: 1 }
  }
  const prepared = prepareDist({ detected, argv, repo, timeout, verbose })
  const opts = configOptions(detected, argv)
  const audit = await runAudit({
    detected,
    dist: prepared.dist,
    options: {
      ...opts,
      locales: opts.locales,
      browserReport: argv['browser-report'],
      timeout,
    },
  })
  let findings = dedupe([...prepared.findings, ...audit.findings])
  let regressions = []
  let baselineWarning = null
  if (argv.baseline) {
    const diff = diffBaseline(findings, path.resolve(argv.baseline))
    regressions = diff.regressions
    baselineWarning = diff.warning
    if (diff.warning) {
      findings = dedupe([
        ...findings,
        { code: 'BASELINE_UNREADABLE', severity: 'warn', message: diff.warning },
      ])
    }
  }

  const result = finalizeResult({
    action: 'audit',
    repo,
    framework: audit.framework,
    mode: detected.mode,
    dist: prepared.dist,
    base: opts.base,
    locales: opts.locales,
    profile: opts.profile,
    pages: detected.pages,
    stats: audit.stats,
    built: prepared.built,
    artifacts: prepared.artifacts,
    regressions,
    findings,
  })
  if (baselineWarning) result.baselineWarning = baselineWarning
  return { result, exit: shouldFail(result.findings, argv['fail-on'] || 'error') ? 1 : 0 }
}

function actionEmitCheck({ argv, repo, detected }) {
  if (!argv.out || argv.out === true) {
    return {
      result: failure(
        'emit-check',
        repo,
        'missing_out',
        'emit-check needs an explicit --out <path>; no path is guessed',
      ),
      exit: 1,
    }
  }
  const opts = configOptions(detected, argv)
  const distAbs = detectDist(detected.layout, argv.dist)
  const relative = path.relative(repo, distAbs).split(path.sep).join('/')
  const dist = relative && !relative.startsWith('..') ? relative : distAbs
  const dryRun = Boolean(argv['dry-run'])
  const emitted = emitCheck({
    out: argv.out,
    dryRun,
    options: {
      dist,
      base: opts.base,
      locales: opts.locales,
      defaultLocale: opts.defaultLocale,
      profile: opts.profile,
      checkLinks: 'internal',
      maxLinks: opts.maxLinks,
    },
  })
  const result = finalizeResult({
    action: 'emit-check',
    repo,
    ok: true,
    out: emitted.path,
    bytes: emitted.bytes,
    dryRun: emitted.dryRun,
    dist,
    base: opts.base,
    locales: opts.locales,
    profile: opts.profile,
    artifacts: dryRun ? [] : [emitted.path],
    findings: [],
  })
  return { result, exit: 0 }
}

async function main() {
  const { args: argv, unknown } = parseArgs(process.argv.slice(2))
  if (argv.help || argv.h) {
    process.stdout.write(`${usage()}\n`)
    return 0
  }
  const action = typeof argv.action === 'string' ? argv.action : null
  const repo = path.resolve(argv.repo && argv.repo !== true ? argv.repo : process.cwd())

  if (!action || !ACTIONS.includes(action)) {
    const result = failure(
      action,
      repo,
      'unknown_action',
      action ? `unknown action "${action}"` : 'no --action was given',
    )
    result.available = ACTIONS
    process.stdout.write(serialize(result, argv.md ? 'md' : 'json'))
    return 1
  }
  if (!fs.existsSync(repo)) {
    const result = failure(action, repo, 'missing_repo', `repository path does not exist: ${repo}`)
    process.stdout.write(serialize(result, argv.md ? 'md' : 'json'))
    return 1
  }

  const verbose = Boolean(argv.verbose)
  const timeout = numberFlag(argv.timeout, 300000)
  const detected = detectRepo({ repo, node: argv.node, timeout: Math.min(timeout, 30000) })

  let outcome
  if (action === 'detect') outcome = await actionDetect({ argv, repo, timeout })
  else if (action === 'scaffold') outcome = actionScaffold({ argv, repo, detected, timeout })
  else if (action === 'check') outcome = await actionCheck({ argv, repo, detected, timeout, verbose })
  else if (action === 'audit') outcome = await actionAudit({ argv, repo, detected, timeout, verbose })
  else outcome = actionEmitCheck({ argv, repo, detected })

  const format = argv.md ? 'md' : 'json'
  const text = serialize(outcome.result, format)
  process.stdout.write(text)
  if (argv.report && argv.report !== true) {
    const target = path.resolve(argv.report)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text, 'utf8')
  }
  if (unknown.length > 0 && verbose) process.stderr.write(`ignored arguments: ${unknown.join(' ')}\n`)
  return outcome.exit
}

const code = await main()
process.exitCode = code

export { main, parseArgs, ACTIONS, compareVersions, normalizeNodeVersion }
