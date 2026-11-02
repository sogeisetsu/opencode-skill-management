# starlight-docs

An OpenCode skill that builds, audits and repairs an **Astro Starlight** documentation site on **GitHub Pages**.

It is deliberately narrow: every judgement comes from reading the build output and the repository's own config, not from memory, and it never edits anything outside the repository you point it at.

## What it does

| Action | What happens |
|---|---|
| `detect` | Read-only: framework, layout (`site/` vs repo root), Node version, package manager, git remote, GitHub Pages state |
| `scaffold` | Write a Starlight skeleton — config, site-local `package.json`, content stubs, optional components/CSS preset, Pages workflow. Dry run by default |
| `check` | Install (if needed), build, then assert the built HTML: route set, mirrors, `base`, dead links, `lang`, no language sniffing, language switcher, one `<h1>` per page |
| `audit` | Identify the framework first, then run `check` plus 404 / search / canonical / OG / sitemap / sidebar consistency. Non-Starlight sites get a read-only Pages report |
| `emit-check` | Export the assertions as a standalone, dependency-free script for the target repository's CI |

`fix` and `pages` are out of scope for this version and report `unknown_action`.

## Requirements

- **Node.js >= 22.12.0** for building. Astro 6.4 enforces this in `engines`; below it the build is a hard failure, not a warning. The skill reports `node_unsupported` and does not downgrade automatically.
- A Git repository. A GitHub remote is only needed for the Pages part of `detect`; without `gh` or a remote the report says **unverified** rather than guessing.
- Network access only for dependency install and for the optional `--check-links all`.

## Quick start

```pwsh
# 0. facts first
node .opencode/skills/starlight-docs/scripts/site.mjs --action detect --repo .

# 1. preview the skeleton, then write it
node .opencode/skills/starlight-docs/scripts/site.mjs --action scaffold --repo . --owner <gh-owner> --locales root,zh-cn
node .opencode/skills/starlight-docs/scripts/site.mjs --action scaffold --repo . --owner <gh-owner> --locales root,zh-cn --apply

# 2. install, build and assert
node .opencode/skills/starlight-docs/scripts/site.mjs --action check --repo . --profile landing

# 3. audit an existing site
node .opencode/skills/starlight-docs/scripts/site.mjs --action audit --repo . --profile landing

# 4. gate the target repo's CI on the same assertions
node .opencode/skills/starlight-docs/scripts/site.mjs --action emit-check --repo . --out site/scripts/check-dist.mjs
```

Only `scripts/site.mjs` is meant to be called. `scripts/lib/*.mjs` are internal modules and are not a second API.

## Output

JSON by default (`--md` for Markdown). Stable top-level shape:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "action": "audit",
  "repo": "/abs/path",
  "framework": "starlight",
  "profile": "core",
  "pages": { "status": "verified", "buildType": "workflow" },
  "findings": [{ "code": "DEAD_LINK", "severity": "error", "path": "index.html", "message": "..." }],
  "artifacts": [],
  "next": [{ "ref": "references/pitfalls.md", "reason": "DEAD_LINK" }]
}
```

- `findings[].severity`: `error` fails the run, `warn` needs a judgement, `info` is a note (for example a missing optional landing class).
- `next` is the only switch for loading detail: read only the referenced file.
- Exit code: `--fail-on error` by default; `--fail-on warn|info|off` changes the threshold.

## Safety

- `detect`, `check` and `audit` never write to the target repository.
- `scaffold` is a dry run unless `--apply`; existing files are skipped unless `--force` (which backs them up to the system temp directory first).
- `emit-check` is the one action that writes by default, because `--out` already names the exact file; use `--dry-run` to preview.
- Nothing is written to the global OpenCode config, no `git push`, no GitHub settings are changed.

## Layout

```text
starlight-docs/
├── SKILL.md                     # model entry: triggers, routing, sole entry, next, hard limits
├── README.md                    # English guide (for humans)
├── README-ZH.md                 # Chinese guide (for humans)
├── LICENSE                      # MIT
├── scripts/
│   ├── site.mjs                 # sole entry: arg parsing, 5 actions, structured errors
│   └── lib/
│       ├── detect.mjs           # repo/layout/Node/package manager/Astro/Starlight/Pages
│       ├── scaffold.mjs         # layout, file plan, dry-run/apply, install + build helpers
│       ├── check.mjs            # single assertion implementation (core + landing), builtins only
│       ├── audit.mjs            # framework detection + check + 404/SEO/sidebar findings
│       ├── emit-check.mjs       # renders check.mjs into a dependency-free script
│       └── report.mjs           # JSON/Markdown, `next` map, --fail-on exit codes
├── assets/
│   ├── pages.yml                # GitHub Pages workflow template (placeholders)
│   ├── custom.css               # optional sd-* preset (~200 lines, documented fixes)
│   ├── menu.css                 # theme/language menu styles (incl. mobile splash fix)
│   ├── favicon.svg              # Starlight always links /favicon.svg
│   └── components/
│       ├── ThemeSelect.astro    # always generated; native select popups cannot be themed
│       └── LanguageSelect.astro  # only for multiple locales; link-based switcher
└── references/                  # read only when `next` points here
    ├── new-site.md              # scaffold decisions, generated files, README migration
    ├── audit.md                 # non-deterministic audit (live, visual, a11y, migration)
    ├── i18n.md                  # bilingual recipe, locale key vs BCP-47, parity rules
    └── pitfalls.md              # Node/base/theme/CJK/cards/menus/CI pitfalls and fixes
```

## Limitations

- Visual rendering and interaction cannot be asserted by the script. `audit --browser-report <json>` consumes an externally written checklist; the manual list lives in `references/audit.md`.
- `--check-links all` depends on the runtime's network path. Node's `fetch` ignores `HTTP(S)_PROXY` unless `NODE_USE_ENV_PROXY=1`; failures are graded (blocked / unverified / unreachable) and should never gate CI.
- The exported checker is a one-way snapshot. Re-export after upgrading this skill.
- GitHub Pages enablement and live-site verification are deferred; this version only ships the workflow template.

## License

MIT — see [LICENSE](./LICENSE).
