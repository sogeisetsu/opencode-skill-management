/**
 * starlight-docs — stable JSON/Markdown output, the `next` pointer map and
 * `--fail-on` exit codes.
 *
 * `next` is the only switch that tells the model which reference file to read;
 * everything else stays out of context until needed.
 */
export const SCHEMA_VERSION = 1

export const SEVERITY_RANK = { info: 0, warn: 1, error: 2 }

/** finding code -> reference doc that explains how to fix it. */
export const NEXT_BY_CODE = {
  // i18n: routes, lang, switcher, frontmatter parity
  ROUTE_MIRROR_MISMATCH: 'references/i18n.md',
  LOCALE_HOME_MISSING: 'references/i18n.md',
  LANG_MISSING: 'references/i18n.md',
  LANG_MISMATCH: 'references/i18n.md',
  LANGUAGE_SNIFFING: 'references/i18n.md',
  SWITCHER_MISSING: 'references/i18n.md',
  DESCRIPTION_MISSING: 'references/i18n.md',

  // build / deploy / links
  MISSING_DIST: 'references/pitfalls.md',
  NO_HTML: 'references/pitfalls.md',
  BASE_ESCAPE: 'references/pitfalls.md',
  DEAD_LINK: 'references/pitfalls.md',
  LINK_LIMIT: 'references/pitfalls.md',
  EXTERNAL_LINK_UNREACHABLE: 'references/pitfalls.md',
  NODE_UNSUPPORTED: 'references/pitfalls.md',
  INSTALL_FAILED: 'references/pitfalls.md',
  BUILD_FAILED: 'references/pitfalls.md',

  // scaffold / structure
  H1_MISSING: 'references/new-site.md',
  H1_MULTIPLE: 'references/new-site.md',
  LANDING_HERO_MISSING: 'references/new-site.md',
  LANDING_TITLE_MISSING: 'references/new-site.md',
  LANDING_SECTION_MISSING: 'references/new-site.md',
  LANDING_HAS_SIDEBAR: 'references/new-site.md',
  SIDEBAR_MISSING_PAGE: 'references/new-site.md',
  SIDEBAR_DEAD_LINK: 'references/new-site.md',
  CHECK_SCRIPT_PENDING: 'references/new-site.md',
  ROOT_PACKAGE_JSON_CONFLICT: 'references/new-site.md',
  DEFAULT_LOCALE_IGNORED: 'references/i18n.md',

  // audit-only
  FRAMEWORK_NOT_STARLIGHT: 'references/audit.md',
  FRAMEWORK_UNKNOWN: 'references/audit.md',
  PAGEFIND_DISABLED: 'references/audit.md',
  CANONICAL_MISSING: 'references/audit.md',
  OG_MISSING: 'references/audit.md',
  THEME_COLOR_MISSING: 'references/audit.md',
  ROBOTS_MISSING: 'references/audit.md',
  SITEMAP_MISSING: 'references/audit.md',
  NOT_FOUND_MISSING: 'references/audit.md',
  FOOTER_LINKS_MISSING: 'references/audit.md',
  PAGES_BUILD_TYPE: 'references/audit.md',
  PAGES_HTTPS_NOT_ENFORCED: 'references/audit.md',
  PAGES_UNVERIFIED: 'references/audit.md',
  VISUAL_REGRESSION: 'references/audit.md',
  BASELINE_UNREADABLE: 'references/audit.md',
  BROWSER_REPORT_UNREADABLE: 'references/audit.md',
  LOCKFILE_PENDING: 'references/pitfalls.md',
  GITIGNORE_MANUAL: 'references/pitfalls.md',
}

export function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 0
}

export function countBySeverity(findings) {
  const counts = { error: 0, warn: 0, info: 0 }
  for (const finding of findings || []) {
    const key = finding.severity in counts ? finding.severity : 'info'
    counts[key] += 1
  }
  return counts
}

export function isOk(findings) {
  return (findings || []).every((finding) => finding.severity !== 'error')
}

/** Deduplicated, ordered list of references the model should load. */
export function buildNext(findings) {
  const seen = new Map()
  for (const finding of findings || []) {
    const ref = NEXT_BY_CODE[finding.code]
    if (!ref) continue
    if (!seen.has(ref)) seen.set(ref, [])
    if (!seen.get(ref).includes(finding.code)) seen.get(ref).push(finding.code)
  }
  return [...seen.entries()].map(([ref, codes]) => ({ ref, reason: codes.join(', ') }))
}

export function shouldFail(findings, failOn) {
  if (!failOn || failOn === 'off') return false
  const threshold = SEVERITY_RANK[failOn]
  if (threshold === undefined) return isOk(findings) === false
  return (findings || []).some((finding) => severityRank(finding.severity) >= threshold)
}

/** Adds `ok` (errors present) and `next`, and normalises finding order. */
export function finalizeResult(result) {
  const findings = (result.findings || []).slice().sort((a, b) => {
    const bySeverity = severityRank(b.severity) - severityRank(a.severity)
    if (bySeverity !== 0) return bySeverity
    return String(a.code).localeCompare(String(b.code))
  })
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: result.ok !== undefined ? result.ok : isOk(findings),
    ...result,
    findings,
    counts: countBySeverity(findings),
    next: result.next && result.next.length > 0 ? result.next : buildNext(findings),
  }
}

const SEVERITY_TAG = { error: 'error', warn: 'warn', info: 'info' }

export function formatMarkdown(result) {
  const lines = []
  lines.push(`# starlight-docs ${result.action || ''}`.trim())
  lines.push('')
  lines.push(`- ok: ${result.ok ? 'yes' : 'no'}`)
  if (result.repo) lines.push(`- repo: \`${result.repo}\``)
  if (result.framework) lines.push(`- framework: ${result.framework}`)
  if (result.profile) lines.push(`- profile: ${result.profile}`)
  if (result.dist) lines.push(`- dist: \`${result.dist}\``)
  if (result.mode) lines.push(`- mode: ${result.mode}`)
  if (result.node) {
    const node = result.node
    lines.push(`- node: local ${node.local}, build ${node.effective}, floor ${node.floor}`)
  }
  if (result.counts) {
    lines.push(`- findings: ${result.counts.error} error, ${result.counts.warn} warn, ${result.counts.info} info`)
  }
  for (const key of ['warnings', 'notes']) {
    const value = result[key]
    if (!Array.isArray(value) || value.length === 0) continue
    lines.push('')
    lines.push(`## ${key}`)
    for (const item of value) lines.push(`- ${typeof item === 'string' ? item : JSON.stringify(item)}`)
  }
  if (Array.isArray(result.files) && result.files.length > 0) {
    lines.push('')
    lines.push(`## files (${result.applied ? 'applied' : 'dry-run'})`)
    lines.push('')
    lines.push('| action | path |')
    lines.push('| --- | --- |')
    for (const file of result.files) lines.push(`| ${file.action} | \`${file.path}\` |`)
  }
  const findings = result.findings || []
  lines.push('')
  lines.push(`## findings (${findings.length})`)
  if (findings.length === 0) {
    lines.push('')
    lines.push('None.')
  } else {
    lines.push('')
    lines.push('| severity | code | path | message |')
    lines.push('| --- | --- | --- | --- |')
    for (const finding of findings) {
      const message = String(finding.message || '').replace(/\|/g, '\\|').replace(/\n+/g, ' ')
      lines.push(
        `| ${SEVERITY_TAG[finding.severity] || 'info'} | ${finding.code} | ${finding.path ? `\`${finding.path}\`` : ''} | ${message} |`,
      )
    }
  }
  if (Array.isArray(result.regressions) && result.regressions.length > 0) {
    lines.push('')
    lines.push('## new since baseline')
    for (const item of result.regressions) lines.push(`- ${item}`)
  }
  if (Array.isArray(result.next) && result.next.length > 0) {
    lines.push('')
    lines.push('## next')
    for (const item of result.next) lines.push(`- \`${item.ref}\` — ${item.reason}`)
  }
  return `${lines.join('\n')}\n`
}

export function serialize(result, format) {
  return format === 'md' ? formatMarkdown(result) : `${JSON.stringify(result, null, 2)}\n`
}
