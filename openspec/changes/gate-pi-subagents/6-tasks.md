# Tasks

State legend: `[ ]` Pending, `[-]` Running/interrupted/failed, `[x]` Complete.
A Slice = one conventional commit + one post-commit Human validation. Tasks are quick checkpoints inside a Slice.

Counters: Slices 0/3 · Tasks 0/12 · Commits 0/3 · Validations 0/3

## Slice 1 — Claim the required-child-extensions seam (fail closed at admission)

> Spec: gate-pi-subagents

- [ ] Task 1 — add `src/seams.ts`: `registerRequiredChildExtensionSeam(deps)` — eager registration at `session_start` when `gate.gated`; self-path via `fileURLToPath(import.meta.url)`; `sessionId` from `ctx.sessionManager`
      started_at: — pending · ended_at: — pending · total: — pending · check: — pending
      paths: — pending (planned: src/seams.ts)
- [ ] Task 2 — wire `extensions/index.ts`: dynamic import in `try/catch` (absent ⇒ silent no-op); dispose on unprotected fallback, `/appa off`, `session_shutdown`; dispose-before-register on `/appa on`
      started_at: — pending · ended_at: — pending · total: — pending · check: — pending
      paths: — pending (planned: extensions/index.ts)
- [ ] Task 3 — tests with DI'd fake registrar: eager-when-gated, no-op-when-absent, dispose lifecycle, idempotent double-dispose, toggle cycle
      started_at: — pending · ended_at: — pending · total: — pending · check: — pending
      paths: — pending (planned: test/)
- [ ] Task 4 — `just check` green
      started_at: — pending · ended_at: — pending · total: — pending · check: just check
      paths: — pending
- [ ] Commit — feat(gate): require the guard in every subagent child
      message: `feat(gate): require the guard in every subagent child`
      hash: — pending Slice commit
- [ ] Human validation — from a protected session, attempt a launch whose runner cannot load the guard
      response: — pending · outcome: — pending · at: — pending
      surfaced: — pending

## Slice 2 — Clamp child capability with the session ceiling

> Spec: gate-pi-subagents

- [ ] Task 1 — pin the peer floor: read installed pi-subagents version, verify both seam subpaths resolve, set `peerDependencies` range + devDependency
      started_at: — pending · ended_at: — pending · total: — pending · check: — pending
      paths: — pending (planned: package.json)
- [ ] Task 2 — ceiling registration (`source: "pi-openappa"`): `denyExtensions`-only default; `settings.json` `subagentCeiling` + env override; `restriction.update()` for mid-session changes; one-time warn when seam subpaths missing
      started_at: — pending · ended_at: — pending · total: — pending · check: — pending
      paths: — pending (planned: src/seams.ts, src/gate.ts)
- [ ] Task 3 — conflict test: `denyExtensions: true` coexists with required pi-openappa; if it rejects, drop from default and record surfaced debt
      started_at: — pending · ended_at: — pending · total: — pending · check: — pending
      paths: — pending (planned: test/)
- [ ] Task 4 — clamp tests: non-allowlisted agent fails before spawn and stays visible non-executable; explicit `[]` blocks all; omitted unrestricted; `structured_output` untouched
      started_at: — pending · ended_at: — pending · total: — pending · check: — pending
      paths: — pending (planned: test/)
- [ ] Task 5 — `just check` green
      started_at: — pending · ended_at: — pending · total: — pending · check: just check
      paths: — pending
- [ ] Commit — feat(gate): session-scoped capability ceiling for subagent children
      message: `feat(gate): session-scoped capability ceiling for subagent children`
      hash: — pending Slice commit
- [ ] Human validation — attempt a non-allowlisted agent launch
      response: — pending · outcome: — pending · at: — pending
      surfaced: — pending

## Slice 3 — Document and surface gated delegation

> Spec: gate-pi-subagents

- [ ] Task 1 — README section: delegation semantics under protection, ceiling surface, warn-not-block for seam-less installs; CHANGELOG entry
      started_at: — pending · ended_at: — pending · total: — pending · check: — pending
      paths: — pending (planned: README.md, CHANGELOG.md)
- [ ] Task 2 — `/appa status` gains the seam line (registered · ceiling on · no-op · conflicted); status-line text keeps healthy fragments clean
      started_at: — pending · ended_at: — pending · total: — pending · check: — pending
      paths: — pending (planned: extensions/index.ts)
- [ ] Task 3 — `just check` green
      started_at: — pending · ended_at: — pending · total: — pending · check: just check
      paths: — pending
- [ ] Commit — docs(gate): gated delegation — README, CHANGELOG, /appa status seam state
      message: `docs(gate): gated delegation — README, CHANGELOG, /appa status seam state`
      hash: — pending Slice commit
- [ ] Human validation — run `/appa status`
      response: — pending · outcome: — pending · at: — pending
      surfaced: — pending
