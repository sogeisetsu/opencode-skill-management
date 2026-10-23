---
title: Compatibility & 1.x
description: Host and runtime support, what 1.x promises not to break, and what is explicitly out of scope.
---

## Support matrix

| Surface | Status |
|---|---|
| OpenCode V2 | Supported. 1.0.0 was accepted on host **2.0.32**. |
| OpenCode V1 | Not targeted; not tested. |
| Windows | Verified, including new-process end-to-end runs. |
| Linux | Verified, including new-process end-to-end runs. |
| Node.js | **18 or newer** (the plugin runs inside the host). |
| Runtime dependencies | None. Pure Node built-ins. |
| Shell commands | None. |
| Plugin structure | One file. |

## The 1.0.0 compatibility promise

Within 1.x, the following do not change in a breaking way:

1. The four actions (`list`, `inspect`, `disable`, `enable`) and their input/output semantics.
2. The shape of the written rule:
   `{ "action": "skill", "resource": <id>, "effect": "deny" | "ask" }`.
3. The same-line marker comment format (`// skill_management`). `enable` uses it to establish
   provenance after a sidecar loss.
4. The single-file plugin structure.

Message wording is not part of the contract. In 1.0.0 the tool's messages are Chinese; the
stable part is the structure and the literal values (ids, effects, rule JSON, paths).

## What "supported" does not mean

- **Project-level config is out of scope.** A project can contain its own permissions. This
  plugin reads and writes only the global config, and reports the global target file in its
  output.
- **`policies` are out of scope.** The plugin context has no `config` domain, so it cannot read
  policy documents. If a policy blocks a skill, `enable` reports that and stops.
- **Agent-level rules are read, not edited.** They appear in `inspect`, and they can override a
  global rule for one agent. That is reported honestly, not "fixed".
- **Host registry internals are internal.** The plugin reads `ctx.skill` / `ctx.agent` through
  the host's transform API and consumes `{ location, data }` envelopes where required. A host
  change to those shapes is a compatibility event, not something the plugin can paper over.
- **No network access.** The plugin never calls out, and the docs site has no analytics, no
  cookies, and no language-based redirect.

## How 1.0.0 was verified

- `node tools/verify.mjs`: 248 assertions in sections A–I, run entirely against a temporary
  config directory (no real user config touched).
- The same harness runs on `ubuntu-latest` and `windows-latest` in CI.
- End-to-end checks run in a **new process**, because plugins load at host startup.
- Section H is a performance gate: `list` under 25 ms at 29 skills × 12 agents × 10 rules.
- Section I is a release gate: pack contents, resolvable `exports`, and byte-identical installed
  copy.

Those checks are about the plugin. The documentation site is built separately with Astro and
Starlight and deployed to GitHub Pages.

## Upgrading

- Patch releases fix behavior without changing the four interfaces above.
- Minor releases may add output detail, but not remove or repurpose existing fields.
- If a host upgrade changes registry or reload behavior, the plugin will report "unverified"
  rather than invent a conclusion. Check the issue tracker before assuming silence means
  support.

## Version

The current release is **1.0.0**. The npm package is `opencode-skill-management`; the
repository is [sogeisetsu/opencode-skill-management](https://github.com/sogeisetsu/opencode-skill-management).
Licensed MIT.
