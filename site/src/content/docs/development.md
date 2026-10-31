---
title: Development & verification
description: The acceptance harness, its sections and gates, the CI matrix, what goes into the npm package, and why two copies of the plugin cannot coexist.
---

There is no test framework and no build step. The whole acceptance suite is one Node script that
runs against a temporary config directory.

## Run the harness

```pwsh
node tools/verify.mjs                # all sections, 326 assertions
node tools/verify.mjs --section E    # one section (A–J, by title prefix, case-insensitive)
node tools/verify.mjs --keep         # keep the temporary directory for inspection
```

Every run creates a fresh `mkdtemp` directory and points `XDG_CONFIG_HOME` at it, so the real
global config is never read or written. The installer step gets its own temporary
`XDG_CONFIG_HOME` as well, and `OPENCODE_CONFIG` / `OPENCODE_CONFIG_DIR` are cleared for it so a
running instance's npm channel cannot be mistaken for an installed one.

## Sections

| Section | Covers |
|---|---|
| A | Module shape and purity: default export, four actions, only `node:` imports, no third-party dependencies, no shell or `eval` |
| B | `globMatch` and permission evaluation: last match wins, `ask` fallback on no match |
| C | Id derivation from paths, source classification, `user` / `project` scope |
| D | JSONC text edits: insert, remove, create the block, CRLF, BOM, comments preserved, strict validation, failure paths |
| D2 | Target config resolution under a fake `env` / `home`: XDG, home, two candidates, two directories |
| E | End-to-end on a temporary config: `list`, `inspect`, `dryRun`, `disable`, `enable`, backup, sidecar, read-back verification, refusal branches, and `OUTPUT_SCHEMA` validation of every action's `output` |
| F | Id derivation from the registry (§3.5) and the ownership boundary of `enable` |
| G | Read-back criteria, one backup, atomic write, description hardening |
| H | Performance gate |
| I | Release gate |
| J | Installer conflict detection |

Section E parses every result and checks it against the declared `output` schema — required
fields, property types, `error.code` / `error.message` — and asserts that `content` is the same
data as `output`. Its negative cases keep that validator honest: a `null` where a string is
declared, or a string where a boolean is declared, must be reported.

## Linux / WSL

```bash
bash tools/linux-verify.sh      # KEEP=1 to keep the scratch directory
```

This script is a real-host acceptance, not a unit run. It downloads its own Node and
`@opencode/cli` (pinned by `NODE_VERSION` / `OPENCODE_VERSION`), runs the harness on a copy of the
repository, then loads the plugin in a temporary `HOME` and checks `opencode plugin list
--builtin`. It needs `curl`, `tar` and `gzip`, uses no `sudo`, and deletes its scratch directory on
exit. It also snapshots the real `~/.config/opencode` and `~/.local/share/opencode` before and
after, and fails if they changed.

## CI

`.github/workflows/verify.yml` runs `node tools/verify.mjs` on `ubuntu-latest` and
`windows-latest` with Node 22. The suite needs no secrets: it never touches a real config.
`.github/workflows/pages.yml` builds the documentation site and runs `npm run docs:check`, which
fails on a missing route, an en/zh route mismatch, a dead internal link, a link outside the base
path, or a language switcher that does not point at the mirrored page.

## The two gates

**H — performance.** 29 skills × 12 agents × 10 rules, best of five `list` calls must stay under
25 ms. The threshold is deliberately loose so CI jitter does not produce false failures; it exists
to catch an accidental O(n²) or a re-parse per skill.

**I — release.** `npm pack --dry-run` must contain the entry file, the pack must not contain
`tools/`, `docs/`, CI or repository docs, `exports["."]` must resolve through the package name, and
an installed single-file copy must be byte-identical to `src/skill_management.js`.

## What is in the npm package

Five files, nothing else:

```text
package.json
README.md
CHANGELOG.md
LICENSE
src/skill_management.js
```

`package.json` lists `files: ["src", "CHANGELOG.md"]`; npm adds `package.json`, `README.md` and
`LICENSE`. Tests, the docs site, CI and the design specification stay in the repository.

## Why the plugin is one file

The host loads every `.js` and `.ts` file in `<config>/plugins/`, including subdirectories, as a
plugin. Splitting helper modules out of `skill_management.js` would create a second plugin whose
validation fails. The distributed plugin therefore stays a single file, and
`tools/install.mjs` copies that exact file.

For the same reason, two copies cannot coexist. With both an npm entry and
`<config>/plugins/skill_management.js`, the host reports `Duplicate plugin ID: skill_management`
and one of them shows as failed — it is not "both work, one is ignored". Move between channels with
`node tools/install.mjs --uninstall` (to npm) or `opencode plugin remove
opencode-skill-management` (back to the single file), and use `node tools/install.mjs --check` to
see both sources before changing anything.

Next: [Design decisions](../design-decisions/) for why these behaviours are the ones being tested.
