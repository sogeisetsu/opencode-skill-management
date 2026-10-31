---
title: Installation
description: Three ways to load the plugin (git spec, npm, single file) and how to verify it loaded.
---

The plugin is one JavaScript file with no third-party runtime dependencies. Pick whichever
channel fits your setup; all three result in the same code.

## Requirements

- OpenCode **V2**. 1.1.0 was accepted on host 2.0.32 on Windows and Linux; 1.2.0 was re-checked on
  host 2.2.0, including a new-process end-to-end run.
- Node.js **18 or newer** in the environment that runs OpenCode.
- No token, registry account or build step is needed.

## Channel 1 — git spec (recommended)

```pwsh
opencode plugin add github:sogeisetsu/opencode-skill-management
```

OpenCode fetches the repository directly. No npm registry and no publish step are involved.

## Channel 2 — npm

```pwsh
opencode plugin add opencode-skill-management
```

The npm package exports exactly one entry point: `./src/skill_management.js`. Runtime
dependencies: none.

## Channel 3 — copy the single file (no npm updates)

Use this when neither network channel fits (offline machine, vendored setup):

```pwsh
node tools/install.mjs          # copies to <config>/plugins/skill_management.js
node tools/install.mjs --check  # report only: path, version, conflicts
```

This channel is **pinned**: the file you install stays until you run the installer again. It does
not follow npm releases, and upgrading means re-running `node tools/install.mjs`. If you want
updates to arrive on their own, use channel 1 or 2 — `opencode plugin check` and
`opencode plugin update` handle those.

`<config>` resolves the way the host resolves it: `$OPENCODE_CONFIG_DIR`, then
`$XDG_CONFIG_HOME/opencode`, then `~/.config/opencode` (on Windows,
`C:\Users\<you>\.config\opencode`).

Before writing anything the installer looks for a second source. If `opencode.json(c)` already
lists this package in `plugins`, or another copy sits in `plugins/`, it refuses to write and exits
with code `2`, leaving every file untouched.

| Flag | Effect |
|---|---|
| `--check` / `--dry-run` | Report only, never write |
| `--uninstall` | Delete `<config>/plugins/skill_management.js` and nothing else (refuses if the file is not this plugin) |
| `--npm` | Assert the npm channel is installed; never write; exits `1` when it is missing |
| `--force` | Write anyway (creates two copies; the host reports `Duplicate plugin ID` for one of them) |
| `--json` | Machine-readable output |

OpenCode loads every `.js` and `.ts` file in `<config>/plugins/`, plus subdirectories. You do
not register the file in `opencode.jsonc`.

:::caution[Keep the plugin directory single-file]
Because every file in `plugins/` is loaded as a plugin, do not split `skill_management` into
helper modules or drop a second copy beside it. The distributed plugin is intentionally one
file for this reason.
:::

:::caution[One plugin, one channel]
A plugin id can only be loaded once. With both the npm entry and
`<config>/plugins/skill_management.js` present, the host reports
`Duplicate plugin ID: skill_management` and one of them shows as failed — the two do not simply
coexist. Moving to npm: run `node tools/install.mjs --uninstall` first. Moving back to the single
file: run `opencode plugin remove opencode-skill-management` first. `node tools/install.mjs --check`
lists both sources and the exact command to run.
:::

## Verify that it loaded

```pwsh
opencode plugin list --builtin
```

`--builtin` matters. Without it, plugins loaded from the local directory are not listed and you
may see `No plugins found`.

The output should contain a `skill_management` entry with source `local` (or the package source
for channels 1 and 2). In a brand-new config directory, the first one or two calls can be
empty; run it again.

Then ask the model to call the tool, or call it yourself:

```text
skill_management({ action: "list" })
```

The `list` result — `config.file` and the `skills[]` array — is enough to confirm that the
plugin is reading the host registries.

## Notes on loading

- Plugins load when the OpenCode process starts. A newly added plugin appears in the next
  process, not in an already running one.
- `skill_management` is registered as a **native tool** with `codemode: false`. Call it by name.
  It is not present in the Code Mode `search()` / `execute()` catalog, and "not found there" does
  not mean it failed to install.
- The tool writes only to the global config. It never writes project configuration.

Once installed, continue with the [overview](../overview/) or go straight to the
[`list` action](../actions/list/).
