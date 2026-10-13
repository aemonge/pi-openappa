# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[SemVer](https://semver.org/).

## [0.3.2] — 2026-10-09

### Fixed

- Repository, homepage, and bugs URLs in package metadata now point at the
  real repository (`aemonge/pi-openappa`; earlier releases linked a
  non-existent `aemonge-dev` path). Node engine floor declared (`>=22.18`,
  where TS type-stripping needs no flags).

### Changed

- **Starter policy: narrowing deltas stripped — they blocked live work.**
  The new integration tier (real runtime, real `appa hook`, no mocks)
  proved the live runtime confirmation-gates EVERY label narrowing,
  waiting for `appa/execute_remedy_plan` (an MCP tool Claude Code mounts
  and Pi does not): as shipped, web research and fetches were refused, and
  no fence could ever arm. The source deltas are removed (deny-undeclared
  remains live); the requires-trusted sink rules stay, armed and inert,
  with the full 0.4 fence map documented in the template. Traces and the
  integration suite now pin today's live truth deliberately.
- Community standards: CI (node matrix + a policy job running the gates,
  replays, coverage, and the live integration tier), CHANGELOG (shipped in
  the tarball), SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, issue/PR
  templates, dependabot, README badges.

### Added

- Strict lint tier: Biome with `noExplicitAny`, `noNonNullAssertion`,
  `noConsole`, unused-everything as errors — production and tests alike,
  zero suppressions; `just lint` / `just lint-fix`, wired into `just check`
  and CI. The mock's wire output moved from `console.*` to raw stdio
  writes (its bytes are the protocol under test). Dev dependency on the
  peer package exact-pinned to 1.0.4 after a transient `--no-package-lock`
  install drifted to 1.2.0 and changed event types mid-task.
- `just release`: one command — full gates including the live tier, npm
  publish, annotated `v<version>` tag, push; refuses existing tags and
  dirty trees.
- `just test-integration` / `APPA_INTEGRATION=1`: boots a real `appa
  runtime` with the starter policy and drives the extension end-to-end —
  the tier that caught the remedy-gating above (and two test-tier bugs:
  trajectories bleed across shared session ids; every allowed PreToolUse
  must be closed by its PostToolUse before the next opens).

## [0.3.1] — 2026-10-09

### Fixed

- The 0.3.0 tarball on npm was built before the default-on merge landed, so
  it shipped opt-in gating without the auto-installer. 0.3.1 is the merge
  described below.

## [0.3.0] — 2026-10-09

### Added

- Pi-native starter policy (`templates/appa.toml`): static rules only — no
  host-coupled annotators (they are unreachable under Pi), selectors spelled
  with Pi argument names (`path`, `command`), deny-undeclared, flow fences
  (web sources suspicious; edits, execution-later writes, publishing, and
  memory writes trusted-only; docs as the research landing zone;
  `redact-secrets` masking for credential reads).
- `/appa init [project] [--force]`: writes the starter policy (and
  `settings.json`) without clobbering; subcommand autocomplete for
  `on|off|init|init project|status`.
- Settings file `~/.config/pi-openappa/settings.json` (`config`,
  `runtimeUrl`, `hookBin`, `hookTimeoutMs`); env > project marker > settings.
- Background hook lane: `session_start` never awaits `--ensure-runtime` or
  the auto-install; ordering to the first `PreToolUse` is preserved.
- Policy-as-code gates: `just policy-check`, `just policy-coverage` (session
  toolset coverage, refusals fail), `just policy-test` (`appa replay` over
  `traces/*.appa` usage-day fixtures); all in `just check`.

## [0.2.0] — 2026-10-07

### Added

- Protection **on by default**, with opt-outs: `APPA_GATE=0`,
  `<project>/.pi/no-openappa`, and `/appa off` (global marker
  `~/.config/pi-openappa/off`); `/appa on` clears it (and the legacy
  always-on marker).
- Auto-install: a missing default `appa` binary is self-provisioned once via
  the official install script (`APPA_INSTALL_CMD`/`APPA_INSTALL_TIMEOUT_MS`
  to pin a mirror or timeout); custom `APPA_HOOK_BIN` is never auto-installed.
- First-run downgrade: with no policy anywhere and no runtime answering, the
  session runs unprotected with one warning instead of fail-closing an
  unconfigured machine.

## [0.1.0] — 2026-10-06

### Added

- Initial published extension: opt-in gating (`APPA_GATE=1`,
  `<project>/.pi/openappa`, `/appa on`), the Claude-Code codec adapter, the
  hook client, fail-closed enforcement with reasons to the model, and the
  verified wire notes (`docs/wire-notes.md`).
