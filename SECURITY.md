# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities **privately**, via
[GitHub security advisories](https://github.com/aemonge/pi-openappa/security/advisories/new)
("Report a vulnerability"). If that is not possible, email the repository
owner at the address on the commits.

Do **not** open a public issue for anything exploitable.

## Scope

- The extension wiring (`extensions/`, `src/`) and the starter policy
  (`templates/appa.toml`).
- Policy bypasses that a malicious tool result, prompt injection, or a
  crafted argument could reach — including selector gaps (a spelling the
  credential selectors miss) and over-permissive defaults.

## Out of scope

- Vulnerabilities in the [OpenAPPA](https://openappa.com) runtime itself —
  report those upstream.
- Anything a gated session already blocks by design (fail-closed is the
  contract, not a bug).

## Expectations

- You will get an acknowledgement within a few days.
- Fixes for accepted reports ship in a patch release and are credited in the
  [changelog](CHANGELOG.md) unless you prefer otherwise.
