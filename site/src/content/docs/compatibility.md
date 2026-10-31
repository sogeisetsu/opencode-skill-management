---
title: Compatibility & 1.x
description: Host and runtime support, what 1.x promises not to break, and what is explicitly out of scope.
---

## Support matrix

| Surface | Status |
|---|---|
| OpenCode V2 | Supported. 1.1.0 was accepted on host **2.0.32**. |
| OpenCode V1 | Not targeted; not tested. |
| Windows | Verified, including new-process end-to-end runs. |
| Linux | Verified, including new-process end-to-end runs. |
| Node.js | **18 or newer** (the plugin runs inside the host). |
| Runtime dependencies | None. Pure Node built-ins. |
| Shell commands | None. |
| Plugin structure | One file. |

## The 1.x compatibility promise

Within 1.x, the following do not change in a breaking way:

1. The four actions (`list`, `inspect`, `disable`, `enable`) and their input fields.
2. The **JSON result envelope**: `schemaVersion`, `action`, `ok`, `warnings`, and the action
   fields documented for 1.1.0. New fields may be added; existing ones are not removed or
   repurposed.
3. The shape of the written rule:
   `{ "action": "skill", "resource": <id>, "effect": "deny" | "ask" }`.
4. The same-line marker comment format (`// skill_management`). `enable` uses it to establish
   provenance after a sidecar loss.
5. The single-file plugin structure.

**1.1.0 is a breaking release.** It replaced the 1.0.0 Markdown output with one JSON object per
call. That is the only breaking change since 1.0.0: the actions, input fields, rule shape,
marker format and file layout are unchanged.

Message wording is not part of the contract. In 1.1.0 the human-readable strings inside
`warnings`, `message`, `conclusion.message` and `error.message` are Chinese. The stable part is
the envelope, the field names, and the literal values (ids, effects, rule JSON, paths).

## What "supported" does not mean

- **Project-level config is out of scope.** A project can contain its own permissions. This
  plugin reads and writes only the global config, and reports the global target file in
  `config.file`.
- **`policies` are out of scope.** The plugin context has no `config` domain, so it cannot read
  policy documents. If a policy blocks a skill, `enable` reports that and stops.
- **Agent-level rules are read, not edited.** They appear in `inspect.agents[]`, and they can
  override a global rule for one agent. That is reported honestly, not "fixed".
- **Host registry internals are internal.** The plugin reads `ctx.skill` / `ctx.agent` through
  the host's transform API and consumes `{ location, data }` envelopes where required. A host
  change to those shapes is a compatibility event, not something the plugin can paper over.
- **No network access.** The plugin never calls out, and the docs site has no analytics, no
  cookies, and no language-based redirect.

## How this release was verified

- `node tools/verify.mjs`: **326 assertions** in sections A–J, run entirely against a temporary
  config directory (no real user config touched). Section E parses every result and validates it
  against the declared `output` contract.
- The same harness runs on `ubuntu-latest` and `windows-latest` in CI.
- End-to-end checks run in a **new process**, because plugins load at host startup.
- Section H is a performance gate: `list` under 25 ms at 29 skills × 12 agents × 10 rules.
- Section I is a release gate: pack contents, resolvable `exports`, and byte-identical installed
  copy.

Full details, plus the Linux/WSL acceptance script, are on
[Development & verification](../development/).

Those checks are about the plugin. The documentation site is built separately with Astro and
Starlight and deployed to GitHub Pages.

## Upgrading

- Patch releases fix behavior without changing the interfaces above.
- Minor releases may add output fields, but not remove or repurpose existing ones. 1.1.0 is the
  documented exception: the Markdown output was replaced by JSON.
- If a host upgrade changes registry or reload behavior, the plugin will report "unverified"
  rather than invent a conclusion. Check the issue tracker before assuming silence means
  support.

## Version

The current release is **1.1.0**. The npm package is `opencode-skill-management`; the
repository is [sogeisetsu/opencode-skill-management](https://github.com/sogeisetsu/opencode-skill-management).
Licensed MIT.
