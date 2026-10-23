# Plan

## Estimate

2.5–4.5 h assistant execution · confidence 0.7 — the one material unknown
is the `denyExtensions` × required-extension conflict test (Slice 2).

## Skills

bare — no registry skill covers pi extension seam integration; the work
leans on the spec schema templates, pi-subagents docs (extension-api.md /
agents.md, via Context7, 2026-10-23), `docs/wire-notes.md` constraints,
and the repo's `just check` gates.

## Workflow

**Alternative 2** — required-child-extensions plus a `denyExtensions`-only
default ceiling, conditional on the conflict test. Alternative 1 lost
because refined AC2 requires clamping — without a ceiling, gaps 3–4 stay
open. Alternative 3 lost because block-all-by-default breaks default-on
delegation and the guard's no-lockout principle (an unconfigured guard
must not lock you out of your own machine).

## Slices

### Slice 1 — Claim the required-child-extensions seam (fail closed at admission)

Conventional commit planned: `feat(gate): require the guard in every subagent child`

- [ ] Task 1 — add `src/seams.ts`: `registerRequiredChildExtensionSeam(deps)` —
      eager registration at `session_start` when `gate.gated`; self-path via
      `fileURLToPath(import.meta.url)`; `sessionId` from `ctx.sessionManager`
- [ ] Task 2 — wire `extensions/index.ts`: dynamic import in `try/catch`
      (absent ⇒ silent no-op); dispose on unprotected fallback, `/appa off`,
      `session_shutdown`; dispose-before-register on `/appa on`
- [ ] Task 3 — tests with DI'd fake registrar: eager-when-gated,
      no-op-when-absent, dispose lifecycle, idempotent double-dispose,
      toggle cycle
- [ ] Task 4 — `just check` green
- [ ] Human validation — from a protected session, attempt a launch whose
      runner cannot load the guard; VALID: rejected before spawn, reason
      names the seam

### Slice 2 — Clamp child capability with the session ceiling

Conventional commit planned: `feat(gate): session-scoped capability ceiling for subagent children`

- [ ] Task 1 — pin the peer floor: read the installed pi-subagents version,
      verify both seam subpaths resolve, set the `peerDependencies` range
      and devDependency
- [ ] Task 2 — ceiling registration (`source: "pi-openappa"`):
      `denyExtensions`-only default; `settings.json` `subagentCeiling` +
      env override (env beats settings); `restriction.update()` for
      mid-session changes; one-time warn when seam subpaths are missing
- [ ] Task 3 — conflict test: `denyExtensions: true` coexists with required
      pi-openappa; if it rejects, drop `denyExtensions` from the default
      and record surfaced debt
- [ ] Task 4 — clamp tests: non-allowlisted agent fails before spawn and
      stays visible non-executable in `{action:"list"}`; explicit `[]`
      blocks all; omitted unrestricted; `structured_output` untouched
- [ ] Task 5 — `just check` green
- [ ] Human validation — attempt a non-allowlisted agent launch; VALID:
      fails before spawn, remains visible as non-executable

### Slice 3 — Document and surface gated delegation

Conventional commit planned: `docs(gate): gated delegation — README, CHANGELOG, /appa status seam state`

- [ ] Task 1 — README section: delegation semantics under protection, the
      ceiling surface, warn-not-block for seam-less installs; CHANGELOG
      entry
- [ ] Task 2 — `/appa status` gains the seam line (registered · ceiling
      on · no-op · conflicted); status-line text keeps healthy fragments
      free of degraded words unless actually degraded
- [ ] Task 3 — `just check` green
- [ ] Human validation — run `/appa status`; VALID: seam line present and
      truthful, README renders

## Verification

Deterministic, per Slice: `just check` — tests + typecheck + strict lint +
the three policy gates. Then the Human Validation Process from the refined
Requirements (unchanged from drafted): from a live protected session with
the APPA runtime answering, the operator attempts one launch per gap —
non-native runner, remote machine, non-allowlisted agent, non-allowlisted
tool. The one human-only act is observing each attempt; VALID when every
attempt is either guarded in the child or rejected before spawn with the
seam named, and `just check` is green. Tasks runs it per-Slice
post-commit; the final Slice's validation judges the claim.

## History

evidence-as-of 2026-10-23 — Research's dated evidence (pi-subagents docs
via Context7; full read of `extensions/index.ts`; seam-absence verified).
No commits yet; subjects and hashes accrue in Tasks.
