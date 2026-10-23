---
title: Installation
description: Three ways to load the plugin (git spec, npm, single file) and how to verify it loaded.
---

The plugin is one JavaScript file with no third-party runtime dependencies. Pick whichever
channel fits your setup; all three result in the same code.

## Requirements

- OpenCode **V2**. Version 1.0.0 was accepted on host 2.0.32 on Windows and Linux, including
  new-process end-to-end runs.
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

## Channel 3 — copy the single file

If neither channel fits (offline machine, vendored setup), copy the file into the plugins
directory yourself:

```pwsh
node tools/install.mjs          # copies to <config>/plugins/skill_management.js
node tools/install.mjs --dry-run
```

The installer is idempotent: if the destination already has identical bytes, it does nothing.
`<config>` is `$XDG_CONFIG_HOME/opencode` when that variable is set, otherwise
`~/.config/opencode` (on Windows, `C:\Users\<you>\.config\opencode`).

OpenCode loads every `.js` and `.ts` file in `<config>/plugins/`, plus subdirectories. You do
not register the file in `opencode.jsonc`.

:::caution[Keep the plugin directory single-file]
Because every file in `plugins/` is loaded as a plugin, do not split `skill_management` into
helper modules or drop a second copy beside it. The distributed plugin is intentionally one
file for this reason.
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

The `list` header and the target config path at the end are enough to confirm that the plugin is
reading the host registries.

## Notes on loading

- Plugins load when the OpenCode process starts. A newly added plugin appears in the next
  process, not in an already running one.
- `skill_management` is registered as a **native tool** with `codemode: false`. Call it by name.
  It is not present in the Code Mode `search()` / `execute()` catalog, and "not found there" does
  not mean it failed to install.
- The tool writes only to the global config. It never writes project configuration.

Once installed, continue with the [overview](../overview/) or go straight to the
[`list` action](../actions/list/).
