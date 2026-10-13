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
