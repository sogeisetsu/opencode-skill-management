/**
 * starlight-docs — site layout, scaffold planning/applying, dependency install
 * and build. `scaffold` only writes below the target repository; the dry run
 * is the default and lists every path before anything touches disk.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { DEFAULT_CI_NODE, NODE_FLOOR, readPackageJson, run } from './detect.mjs'

/** Assets and references resolve from the skill location, never from cwd. */
export const SKILL_ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const ASSETS_DIR = path.join(SKILL_ROOT, 'assets')
export const REFERENCES_DIR = path.join(SKILL_ROOT, 'references')

export const ASTRO_VERSION = '^6.4.8'
export const STARLIGHT_VERSION = '^0.40.0'

/** display label + BCP-47 lang for the locale keys people actually use. */
export const LOCALE_META = {
  root: { label: 'English', lang: 'en' },
  en: { label: 'English', lang: 'en' },
  'zh-cn': { label: '简体中文', lang: 'zh-CN' },
  'zh-tw': { label: '繁體中文', lang: 'zh-TW' },
  ja: { label: '日本語', lang: 'ja' },
  ko: { label: '한국어', lang: 'ko' },
  fr: { label: 'Français', lang: 'fr' },
  de: { label: 'Deutsch', lang: 'de' },
  es: { label: 'Español', lang: 'es' },
  ru: { label: 'Русский', lang: 'ru' },
  pt: { label: 'Português', lang: 'pt' },
  it: { label: 'Italiano', lang: 'it' },
}

export function readAsset(relative) {
  return fs.readFileSync(path.join(ASSETS_DIR, relative), 'utf8')
}

export function fillTemplate(source, values) {
  let output = source
  // Values may themselves contain placeholders (SETUP embeds @@NODE@@), so
  // substitute until nothing changes instead of relying on key order.
  for (let pass = 0; pass < 5; pass += 1) {
    const before = output
    for (const [key, value] of Object.entries(values)) {
      output = output.split(`@@${key}@@`).join(String(value))
    }
    if (output === before) break
  }
  return output
}

function toPosix(value) {
  return value.split(path.sep).join('/')
}

export function resolveLayout({ repo, mode, dir }) {
  const resolved = path.resolve(repo)
  if (dir) {
    const siteDir = path.resolve(resolved, dir)
    return { repo: resolved, mode: mode || 'site', dir: toPosix(path.relative(resolved, siteDir)) || '.', siteDir }
  }
  if (mode === 'root') return { repo: resolved, mode: 'root', dir: '.', siteDir: resolved }
  const siteDir = path.join(resolved, 'site')
  return { repo: resolved, mode: mode || 'site', dir: toPosix(path.relative(resolved, siteDir)), siteDir }
}

export function listFiles(dir, predicate, out, base) {
  const root = base || dir
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.astro') continue
      listFiles(full, predicate, out, root)
    } else if (predicate(entry.name)) {
      out.push(toPosix(path.relative(root, full)))
    }
  }
  return out
}

function frontmatterValue(text, key) {
  const match = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(text)
  if (!match) return null
  return match[1].replace(/^['"]|['"]$/g, '').trim()
}

function humanize(value) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim()
}

/** Pages that already exist in the content directory, locale-neutral routes. */
export function scanContentPages({ contentDir, locales }) {
  const files = listFiles(contentDir, (name) => /\.(?:md|mdx)$/.test(name), [])
  const localeKeys = locales.filter((key) => key !== 'root')
  const pages = []
  for (const rel of files) {
    const segments = rel.split('/')
    const locale = localeKeys.includes(segments[0]) ? segments.shift() : 'root'
    const name = segments.pop()
    const route = name.startsWith('index.') ? `/${segments.length ? `${segments.join('/')}/` : ''}` : `/${[...segments, name.replace(/\.(?:md|mdx)$/, '')].join('/')}/`
    const file = path.join(contentDir, rel)
    const text = fs.readFileSync(file, 'utf8')
    const title = frontmatterValue(text, 'title') || humanize(segments.length ? segments[segments.length - 1] : name.replace(/\.(?:md|mdx)$/, ''))
    pages.push({ file, rel, locale, route, title, isHome: route === '/' })
  }
  return pages
}

function localeLabel(key, custom) {
  if (custom && typeof custom === 'object' && custom.label) return custom.label
  return LOCALE_META[key] ? LOCALE_META[key].label : key
}

function localeLang(key) {
  return LOCALE_META[key] ? LOCALE_META[key].lang : key
}

function quote(value) {
  return `'${String(value).replace(/'/g, "\\'")}'`
}

function sidebarSource({ pages, locales }) {
  const seen = new Set()
  const items = []
  for (const page of pages) {
    if (page.locale !== 'root' || page.isHome) continue
    if (seen.has(page.route)) continue
    seen.add(page.route)
    items.push(`          { label: ${quote(page.title)}, link: ${quote(page.route)} },`)
  }
  if (items.length === 0) items.push(`          { label: 'Overview', link: '/overview/' },`)
  return [
    '      sidebar: [',
    '        {',
    `          label: 'Documentation',`,
    '          items: [',
    ...items,
    '          ],',
    '        },',
    '      ],',
  ].join('\n')
}

export function astroConfigSource(ctx) {
  const localeEntries = ctx.locales.map((key) => {
    const label = localeLabel(key, ctx.localeMeta && ctx.localeMeta[key])
    return `        ${key === 'root' ? 'root' : quote(key)}: { label: ${quote(label)}, lang: ${quote(localeLang(key))} },`
  })
  const customCss = ctx.customCss
  const componentEntries = []
  if (ctx.components !== 'none') {
    componentEntries.push(`        ThemeSelect: './src/components/ThemeSelect.astro',`)
    if (ctx.locales.length > 1 && ctx.components === 'theme+lang') {
      componentEntries.push(`        LanguageSelect: './src/components/LanguageSelect.astro',`)
    }
  }
  const lines = [
    "import { defineConfig } from 'astro/config'",
    "import starlight from '@astrojs/starlight'",
    '',
    '// Generated by starlight-docs (`--action scaffold`). Replace the placeholder',
    '// title, description and social links, then keep this file in version control.',
    'export default defineConfig({',
    `  site: ${quote(ctx.site)},`,
    ctx.base ? `  base: ${quote(ctx.base)},` : '  // base is empty: this is a user/organisation Pages site',
    "  trailingSlash: 'always',",
    '  integrations: [',
    '    starlight({',
    `      title: ${quote(ctx.title)},`,
    `      description: ${quote(ctx.description)},`,
    '      defaultLocale: \'root\',',
    '      locales: {',
    ...localeEntries,
    '      },',
  ]
  if (customCss.length > 0) lines.push(`      customCss: [${customCss.map(quote).join(', ')}],`)
  if (componentEntries.length > 0) {
    lines.push('      components: {', ...componentEntries, '      },')
  }
  lines.push(`      pagefind: ${ctx.search === 'pagefind' ? 'true' : 'false'},`)
  lines.push('      disable404Route: true, // keeps the route set an exact mirror')
  if (ctx.preset === 'developer-dark') {
    lines.push(
      '      head: [',
      '        {',
      "          tag: 'script',",
      '          // Dark by default. `null` means "never chose"; \'\' is Starlight\'s',
      '          // stored value for Auto and must not be overwritten.',
      '          content:',
      `            "try{if(localStorage.getItem('starlight-theme')===null)localStorage.setItem('starlight-theme','dark')}catch(e){}",`,
      '        },',
      '      ],',
    )
  }
  if (ctx.owner && ctx.name) {
    lines.push(
      `      social: [`,
      `        { icon: 'github', label: 'GitHub', href: 'https://github.com/${ctx.owner}/${ctx.name}' },`,
      `      ],`,
    )
    if (ctx.siteDirName) {
      lines.push(
        '      editLink: {',
        `        baseUrl: 'https://github.com/${ctx.owner}/${ctx.name}/edit/main/${ctx.siteDirName}/',`,
        '      },',
      )
    }
  }
  lines.push(sidebarSource({ pages: ctx.pages, locales: ctx.locales }), '    }),', '  ],', '})', '')
  return lines.join('\n')
}

function landingSource(ctx) {
  const locale = ctx.locale
  const base = ctx.base
  const href = (route) => `${base}${route}`
  const isRoot = locale === 'root'
  const title = ctx.title
  const tagline = isRoot
    ? 'One paragraph on what this project does and who it is for. Replace this line.'
    : '用一段话说明这个项目做什么、给谁用。替换这一行。'
  const kicker = isRoot ? 'Overview' : '概览'
  const heading = isRoot ? 'A short, concrete promise.' : '一句具体、可验证的话。'
  const lede = isRoot
    ? 'Two or three sentences of context. Delete the placeholder cards below and describe the parts that matter.'
    : '两三句背景说明。删掉下面的占位卡片，换成真正重要的部分。'
  const cards = isRoot
    ? [
        ['See it work', 'A command, an API call, or a screenshot — something the reader can run in a minute.'],
        ['Why it exists', 'The problem this replaces, stated in the reader\'s words.'],
        ['What it refuses', 'The deliberate limits. Readers trust a tool that says no.'],
        ['Where to go next', 'One link to installation and one to the reference.'],
      ]
    : [
        ['看到效果', '一条命令、一个 API 调用或一张截图——读者一分钟内能跑起来的东西。'],
        ['为什么需要它', '用读者的语言说清它替代了什么麻烦。'],
        ['它不做什么', '明确写出的边界。说不的工具更容易被信任。'],
        ['下一步', '一个指向安装的链接，一个指向参考的链接。'],
      ]
  const lines = [
    '---',
    `title: ${quote(title)}`,
    `description: ${quote(isRoot ? `${title} documentation` : `${title} 文档`)}`,
    'template: splash',
    'editUrl: false',
    'hero:',
    `  tagline: ${quote(tagline)}`,
    '  actions:',
    `    - text: ${quote(isRoot ? 'Get started' : '开始使用')}`,
    `      link: ${quote(href('/overview/'))}`,
    '      icon: right-arrow',
    `    - text: ${quote(isRoot ? 'How it works' : '工作原理')}`,
    `      link: ${quote(href('/overview/'))}`,
    '      variant: minimal',
    '---',
    '',
    '<div class="sd-section">',
    `  <p class="sd-kicker">${kicker}</p>`,
    `  <h2>${heading}</h2>`,
    `  <p class="sd-lede">${lede}</p>`,
    '',
    '  <div class="sd-grid">',
  ]
  for (const [cardTitle, cardText] of cards) {
    lines.push('    <div class="sd-card">', `      <h3>${cardTitle}</h3>`, `      <p>${cardText}</p>`, '    </div>')
  }
  lines.push('  </div>', '</div>', '')
  return lines.join('\n')
}

function overviewSource(ctx) {
  const isRoot = ctx.locale === 'root'
  const title = isRoot ? 'Overview' : '概览'
  return [
    '---',
    `title: ${title}`,
    `description: ${quote(isRoot ? 'What this project does and how to read these docs.' : '这个项目做什么，以及怎么读这套文档。')}`,
    '---',
    '',
    isRoot
      ? 'Replace this page with the first real explanation of the project: the problem, one working example, and a link to installation.'
      : '把这个页面换成项目的第一段真实说明：它解决什么问题、一个能跑的例子、以及指向安装页的链接。',
    '',
    isRoot ? '## Next' : '## 下一步',
    '',
    isRoot
      ? '- Add pages under `src/content/docs/`, then list them in the `sidebar` of `astro.config.mjs`.'
      : '- 在 `src/content/docs/` 下新增页面，然后写进 `astro.config.mjs` 的 `sidebar`。',
    isRoot
      ? '- Run `node <skill>/scripts/site.mjs --action check --repo <repo>` to verify routes and links.'
      : '- 跑 `node <skill>/scripts/site.mjs --action check --repo <repo>` 校验路由与链接。',
    '',
  ].join('\n')
}

function sitePackageSource(ctx) {
  const pkg = {
    name: `${ctx.name || 'docs'}-docs`,
    private: true,
    type: 'module',
    engines: { node: `>=${NODE_FLOOR}` },
    scripts: {
      dev: 'astro dev',
      build: 'astro build',
      check: 'node scripts/check-dist.mjs',
      preview: 'astro preview',
    },
    devDependencies: {
      '@astrojs/starlight': ctx.starlight || STARLIGHT_VERSION,
      astro: ctx.astro || ASTRO_VERSION,
    },
  }
  return `${JSON.stringify(pkg, null, 2)}\n`
}

function workflowSource(ctx) {
  const siteMode = ctx.mode === 'site'
  const dir = ctx.siteDirName
  const pm = ctx.packageManager
  const commands = {
    npm: {
      install: `npm ci${siteMode ? ` --prefix ${dir}` : ''}`,
      build: `npm run build${siteMode ? ` --prefix ${dir}` : ''}`,
      lockfile: siteMode ? `${dir}/package-lock.json` : 'package-lock.json',
    },
    pnpm: {
      install: `pnpm${siteMode ? ` --dir ${dir}` : ''} install --frozen-lockfile`,
      build: `pnpm${siteMode ? ` --dir ${dir}` : ''} run build`,
      lockfile: siteMode ? `${dir}/pnpm-lock.yaml` : 'pnpm-lock.yaml',
    },
    yarn: {
      install: `yarn${siteMode ? ` --cwd ${dir}` : ''} install`,
      build: `yarn${siteMode ? ` --cwd ${dir}` : ''} run build`,
      lockfile: siteMode ? `${dir}/yarn.lock` : 'yarn.lock',
    },
    bun: {
      install: `bun install${siteMode ? ` --cwd ${dir}` : ''}`,
      build: `bun run${siteMode ? ` --cwd ${dir}` : ''} build`,
      lockfile: siteMode ? `${dir}/bun.lockb` : 'bun.lockb',
    },
  }
  const selected = commands[pm] || commands.npm
  const setup =
    pm === 'npm'
      ? [
          '      - uses: actions/checkout@v4',
          '      - uses: actions/setup-node@v4',
          '        with:',
          '          node-version: @@NODE@@',
          '          cache: npm',
          '          cache-dependency-path: @@LOCKFILE@@',
        ]
      : [
          '      - uses: actions/checkout@v4',
          '      - uses: actions/setup-node@v4',
          '        with:',
          '          node-version: @@NODE@@',
          '      - run: corepack enable # adjust if the repo pins its package manager',
        ]
  return fillTemplate(readAsset('pages.yml'), {
    NODE: ctx.node,
    SETUP: setup.join('\n'),
    INSTALL: selected.install,
    BUILD: selected.build,
    LOCKFILE: selected.lockfile,
    DIST: siteMode ? `${dir}/dist` : 'dist',
    CHECK_PATH: siteMode ? `${dir}/scripts/check-dist.mjs` : 'scripts/check-dist.mjs',
  })
}

function normalizeComponents(value, locales) {
  const allowed = ['auto', 'theme', 'theme+lang', 'none']
  const chosen = allowed.includes(value) ? value : 'auto'
  if (chosen === 'auto') return locales.length > 1 ? 'theme+lang' : 'theme'
  if (chosen === 'theme+lang' && locales.length < 2) return 'theme'
  return chosen
}

export function planScaffold(options) {
  const {
    repo,
    mode,
    dir,
    owner,
    name,
    site,
    base,
    locales: rawLocales,
    defaultLocale,
    preset,
    components,
    search,
    pages,
    node,
    astro,
    starlight,
    packageManager,
  } = options

  const layout = resolveLayout({ repo, mode, dir })
  const locales = rawLocales && rawLocales.length > 0 ? rawLocales : ['root']
  const effectiveComponents = normalizeComponents(components, locales)
  const repoName =
    name ||
    (readPackageJson(layout.repo) && readPackageJson(layout.repo).name) ||
    path.basename(layout.repo)
  const ghOwner = owner || null
  const inferredBase =
    base !== undefined && base !== null
      ? base
      : ghOwner && repoName === `${ghOwner}.github.io`
        ? ''
        : `/${repoName}`
  const siteUrl = site || (ghOwner ? `https://${ghOwner}.github.io` : 'https://example.github.io')
  const title = repoName
  const description = `${repoName} documentation`
  const targetNode = node ? String(node) : DEFAULT_CI_NODE

  const contentDir = path.join(layout.siteDir, 'src', 'content', 'docs')
  const existingPages = scanContentPages({ contentDir, locales })

  const files = []
  const notes = []
  const warnings = []

  const push = (relative, content, options_) => {
    const absolute = path.join(layout.siteDir, relative)
    files.push({
      path: toPosix(path.relative(layout.repo, absolute)),
      absolute,
      content,
      reason: options_ && options_.reason ? options_.reason : null,
    })
  }

  // astro.config.mjs
  const configName = 'astro.config.mjs'
  const generatedPages = locales.map((locale) => ({
    locale,
    route: '/overview/',
    title: locale === 'root' ? 'Overview' : '概览',
    isHome: false,
  }))
  const plannedPages = [...existingPages]
  for (const page of generatedPages) {
    if (!plannedPages.some((entry) => entry.locale === page.locale && entry.route === page.route)) {
      plannedPages.push(page)
    }
  }
  push(
    configName,
    astroConfigSource({
      site: siteUrl,
      base: inferredBase,
      title,
      description,
      locales,
      localeMeta: options.localeMeta,
      customCss: [
        ...(preset === 'developer-dark' ? ['./src/styles/custom.css'] : []),
        ...(effectiveComponents !== 'none' ? ['./src/styles/menu.css'] : []),
      ],
      components: effectiveComponents,
      search: search || 'none',
      preset: preset || 'none',
      owner: ghOwner,
      name: repoName,
      siteDirName: layout.mode === 'site' ? layout.dir : null,
      pages: plannedPages,
    }),
  )

  // content.config.ts
  push(
    path.join('src', 'content.config.ts'),
    [
      "import { defineCollection } from 'astro:content'",
      "import { docsLoader } from '@astrojs/starlight/loaders'",
      "import { docsSchema } from '@astrojs/starlight/schema'",
      '',
      'export const collections = {',
      '  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),',
      '}',
      '',
    ].join('\n'),
  )

  // landing + placeholder per locale (mirror routes from the first build)
  for (const locale of locales) {
    const prefix = locale === 'root' ? '' : `${locale}/`
    const landingRel = path.join('src', 'content', 'docs', `${prefix}index.mdx`)
    const overviewRel = path.join('src', 'content', 'docs', `${prefix}overview.md`)
    push(landingRel, landingSource({ title, base: inferredBase, locale }))
    push(overviewRel, overviewSource({ locale }))
  }

  if (preset === 'developer-dark') {
    push(path.join('src', 'styles', 'custom.css'), readAsset('custom.css'))
  }
  // Starlight always links /favicon.svg; without the file every page has a
  // dead asset link.
  push(path.join('public', 'favicon.svg'), readAsset('favicon.svg'))
  if (effectiveComponents !== 'none') {
    push(path.join('src', 'styles', 'menu.css'), readAsset('menu.css'))
    push(path.join('src', 'components', 'ThemeSelect.astro'), readAsset('components/ThemeSelect.astro'))
    if (locales.length > 1 && effectiveComponents === 'theme+lang') {
      push(path.join('src', 'components', 'LanguageSelect.astro'), readAsset('components/LanguageSelect.astro'))
    }
  }

  // site package.json — never merge into an existing one
  const packageRel = 'package.json'
  const absolutePackage = path.join(layout.siteDir, packageRel)
  if (fs.existsSync(absolutePackage)) {
    files.push({
      path: toPosix(path.relative(layout.repo, absolutePackage)),
      absolute: absolutePackage,
      content: null,
      reason: 'existing package.json is left untouched; add the astro deps yourself',
    })
    warnings.push('package.json already exists: dependencies were not modified (add astro and @astrojs/starlight by hand)')
    if (layout.mode === 'root') {
      notes.push('ROOT_PACKAGE_JSON_CONFLICT: root mode found an existing package.json; use --mode site if it owns runtime deps')
    }
  } else {
    push(
      packageRel,
      sitePackageSource({ name: repoName, astro, starlight }),
      { reason: 'site-local dependencies so the repository root stays untouched' },
    )
  }

  // .gitignore: site-local build output. In root mode the repository already
  // owns a .gitignore — report what is missing instead of rewriting it.
  const gitignoreRel = '.gitignore'
  const absoluteGitignore = path.join(layout.siteDir, gitignoreRel)
  if (layout.mode === 'root' && fs.existsSync(absoluteGitignore)) {
    const current = fs.readFileSync(absoluteGitignore, 'utf8')
    const missing = ['dist/', '.astro/', 'node_modules/'].filter((entry) => !current.includes(entry))
    if (missing.length > 0) {
      notes.push(`GITIGNORE_MANUAL: add ${missing.join(', ')} to the existing .gitignore`)
    }
  } else {
    push(gitignoreRel, ['dist/', '.astro/', 'node_modules/', ''].join('\n'), {
      reason: 'build output stays out of git',
    })
  }

  // GitHub only reads workflows from the repository root, never from site/.
  if ((pages || 'workflow') === 'workflow') {
    const workflowAbs = path.join(layout.repo, '.github', 'workflows', 'pages.yml')
    files.push({
      path: toPosix(path.relative(layout.repo, workflowAbs)),
      absolute: workflowAbs,
      content: workflowSource({
        mode: layout.mode,
        siteDirName: layout.dir,
        node: targetNode,
        packageManager: packageManager || 'npm',
      }),
      reason: 'GitHub Pages deploy on push to main',
    })
  }

  if (packageManager && packageManager !== 'npm') {
    warnings.push(
      `the generated workflow uses ${packageManager} with corepack; confirm the setup step before the first run`,
    )
  }

  if ((pages || 'workflow') === 'workflow') {
    notes.push('CHECK_SCRIPT_PENDING: run --action emit-check --out <site>/scripts/check-dist.mjs before relying on `npm run check`')
  }
  notes.push(
    `LOCKFILE_PENDING: run a package install in ${layout.dir === '.' ? 'the repository root' : layout.dir} and commit its lockfile; the generated workflow uses a frozen install`,
  )

  const plan = {
    layout,
    locales,
    defaultLocale: defaultLocale || 'root',
    repoName,
    siteUrl,
    base: inferredBase,
    title,
    description,
    preset: preset === 'developer-dark' ? 'developer-dark' : 'none',
    components: effectiveComponents,
    search: search === 'pagefind' ? 'pagefind' : 'none',
    pages: pages || 'workflow',
    node: targetNode,
    packageManager: packageManager || 'npm',
    files,
    notes,
    warnings,
  }

  if (defaultLocale && defaultLocale !== 'root') {
    plan.notes.push(
      `DEFAULT_LOCALE_IGNORED: v1 always scaffolds the root locale as default; "${defaultLocale}" was ignored`,
    )
  }
  if (node && node !== DEFAULT_CI_NODE) {
    plan.notes.push(`NODE_TARGET: workflow pins Node ${node}; the local build still uses the installed Node`)
  }
  return plan
}

export function summarizePlan(plan) {
  const actions = []
  for (const file of plan.files) {
    if (file.content === null) {
      actions.push({ path: file.path, action: 'skip', reason: file.reason })
    } else if (fs.existsSync(file.absolute)) {
      actions.push({ path: file.path, action: 'overwrite', reason: file.reason })
    } else {
      actions.push({ path: file.path, action: 'create', reason: file.reason })
    }
  }
  return actions
}

function backupDir(repo) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(os.tmpdir(), 'starlight-docs-backup', `${path.basename(repo)}-${stamp}`)
}

/** Writes only files whose action is create/overwrite; skips everything else. */
export function applyPlan(plan, { force, backup = true }) {
  const actions = summarizePlan(plan)
  const backupRoot = backup && force ? backupDir(plan.layout.repo) : null
  const written = []
  const skipped = []
  const backups = []
  for (let index = 0; index < plan.files.length; index += 1) {
    const file = plan.files[index]
    const action = actions[index]
    if (file.content === null) {
      skipped.push({ path: file.path, reason: file.reason })
      continue
    }
    if (action.action === 'overwrite' && !force) {
      skipped.push({ path: file.path, reason: 'exists; pass --force to overwrite' })
      continue
    }
    if (action.action === 'overwrite' && backupRoot) {
      const target = path.join(backupRoot, file.path)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(file.absolute, target)
      backups.push(target)
    }
    fs.mkdirSync(path.dirname(file.absolute), { recursive: true })
    fs.writeFileSync(file.absolute, file.content, 'utf8')
    written.push({ path: file.path, action: action.action })
  }
  return { written, skipped, backups, backupRoot }
}

function packageManagerInvocation(packageManager, args) {
  // Windows: .cmd shims cannot be spawned directly (EINVAL since the
  // child_process hardening), and going through a shell breaks paths with
  // spaces. npm ships a JS entry point next to the running node binary, so
  // prefer that; fall back to a shell for pnpm/yarn/bun.
  if (process.platform !== 'win32') return { command: packageManager, args, shell: false }
  if (packageManager === 'npm') {
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (fs.existsSync(cli)) return { command: process.execPath, args: [cli, ...args], shell: false }
  }
  if (packageManager === 'bun') return { command: 'bun.exe', args, shell: false }
  return {
    command: `${packageManager}.cmd`,
    args: args.map((value) => (/\s/.test(value) ? `"${value}"` : value)),
    shell: true,
  }
}

export function siteCwd(layout) {
  if (layout.mode === 'site') return layout.siteDir
  return layout.repo || layout.siteDir
}

export function installCommand({ packageManager, layout }) {
  switch (packageManager) {
    case 'pnpm':
      return { command: packageManager, args: ['install'] }
    case 'yarn':
      return { command: packageManager, args: ['install'] }
    case 'bun':
      return { command: packageManager, args: ['install'] }
    default: {
      // `npm ci` needs a lockfile; a fresh scaffold has none yet. The command
      // runs with the site directory as cwd — `npm install --prefix` does not
      // install (ENOENT), even though `npm ci --prefix` does.
      const hasLockfile = fs.existsSync(path.join(layout.siteDir, 'package-lock.json'))
      return { command: packageManager, args: [hasLockfile ? 'ci' : 'install'] }
    }
  }
}

export function buildCommand({ packageManager, layout }) {
  switch (packageManager) {
    case 'pnpm':
    case 'yarn':
    case 'bun':
      return { command: packageManager, args: ['run', 'build'] }
    default:
      return { command: packageManager, args: ['run', 'build'] }
  }
}

export function runStep({ packageManager, args, cwd, timeout, verbose }) {
  const invocation = packageManagerInvocation(packageManager, args)
  const label = `${packageManager} ${args.join(' ')}`
  if (verbose) process.stderr.write(`$ ${label}  (cwd: ${cwd})\n`)
  const started = Date.now()
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: 'utf8',
    timeout: timeout || 300000,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: invocation.shell,
    windowsHide: true,
  })
  const elapsed = Date.now() - started
  if (verbose) process.stderr.write(`  exit ${result.status} in ${elapsed}ms\n`)
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    command: label,
    elapsed,
    error: result.error ? String(result.error.message || result.error) : null,
  }
}

export function ensureDeps({ layout, packageManager, timeout, verbose }) {
  const installed = path.join(layout.siteDir, 'node_modules', 'astro', 'package.json')
  if (fs.existsSync(installed)) {
    return { ok: true, skipped: true, command: '(dependencies already installed)', stdout: '', stderr: '' }
  }
  const spec = installCommand({ packageManager, layout })
  const result = runStep({ ...spec, packageManager, cwd: siteCwd(layout), timeout, verbose })
  return result
}

export function buildSite({ layout, packageManager, timeout, verbose }) {
  const spec = buildCommand({ packageManager, layout })
  const result = runStep({ ...spec, packageManager, cwd: siteCwd(layout), timeout, verbose })
  return result
}

export function tail(text, max) {
  const limit = max || 1200
  if (!text) return ''
  return text.length <= limit ? text : `…${text.slice(text.length - limit)}`
}

export function detectDist(layout, explicit) {
  if (explicit) return path.resolve(explicit)
  return path.join(layout.siteDir, 'dist')
}

export { run }
