# Contributing

Thanks for helping harden Pi sessions. The bar for every change: a gated
session stays fast, an unconfigured machine stays usable, and a policy
refusal always carries a reason.

## Development loop

```sh
npm install          # dev dependencies
just check           # everything a change must pass:
                     #   tests (mock-driven, no APPA runtime needed)
                     #   typecheck
                     #   policy-check   — templates/appa.toml loads
                     #   policy-test    — replay the usage-day traces
                     #   policy-coverage— every known Pi tool declared
```

The `appa` CLI (not the runtime) must be on `PATH` for the three policy
gates: `curl -fsSL https://openappa.com/install.sh | sh`.

## Ground rules

- **Code style**: strict TypeScript (`tsc --noEmit`) and strict Biome
  (`just lint` — zero findings is the bar; `noExplicitAny`,
  `noNonNullAssertion`, `noConsole` are errors everywhere, tests included;
  no `biome-ignore` suppressions). Run `just lint-fix` for auto-fixes and
  review the diff. No runtime dependencies; Node ≥ 22.18. The adapter
  (`src/adapter.ts`) stays Pi-free; the wiring (`extensions/index.ts`) owns
  everything host-aware.
- **Commits**: `feat(pi-openappa): …` / `step(pi-openappa): …`, lowercase,
  imperative; one logical change each.
- **New tools in Pi's toolset**: declare them in `templates/appa.toml`
  under their verbatim Pi name **and** add them to `pi_tools` in the
  `justfile` (coverage fails otherwise). Custom tools pass through
  unmapped; built-ins map to Claude-Code names (`bash`→`Bash`).
- **Policy changes must move the fences, then prove it**: add or adjust a
  case in `traces/*.appa` (one file = one trajectory; taint accumulates
  across calls in order). A policy change without a trace showing both the
  new refusal and the still-flowing clean path will not merge.

## Releasing

One command, from the maintainer's terminal (the history operations are
intentionally not agent-runnable):

```sh
# 1. bump "version" in package.json and add the CHANGELOG entry
# 2. commit, then:
just release    # gates (incl. live tier) → npm publish → tag v<version> → push
```

Versions are immutable on npm: a release that ships wrong content is
bumped and superseded (see 0.3.0 → 0.3.1 in the changelog). Inside a
/devbox where `package-lock.json` is pinned read-only, do **not** use `just
deploy` — sync the lockfile outside instead; `just release` never touches
it.

## Reporting problems

Bugs and feature ideas: issues, using the templates. Anything exploitable:
see [SECURITY.md](SECURITY.md) — private report, never a public issue.
