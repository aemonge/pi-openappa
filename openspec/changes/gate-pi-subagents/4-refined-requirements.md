# Requirements — refined: every subagent launch from a protected session is guarded in the child or rejected at admission, by the seams' own verified semantics

## Acceptance Criteria

1. From a protected session, a launch whose runner cannot load the guard
   (non-native runner, remote machine) is rejected **before spawn** with a
   reason naming the required-extension seam. Status and watch paths are
   unaffected — they never query the registry.
2. Child capability is clamped by a session-scoped ceiling: non-allowlisted
   agents/tools fail before spawn and remain visible as non-executable in
   `{action:"list"}`. Mid-session ceiling changes go through
   `restriction.update()` — never re-registration. `structured_output`
   remains package-internal and is never clamped.
3. Protection-state changes — the no-policy unprotected fallback, `/appa
   off`, `/appa on`, `session_shutdown` — register and dispose both seams
   idempotently, dispose-before-register on toggle cycles (Seam A allows
   one live registration per session).
4. Sessions without pi-subagents behave byte-identically to today: a
   failed dynamic import of either seam module counts as absent — silent
   no-op. An installed pi-subagents that predates the seams produces a
   one-time warning, never a block.
5. **Final (human-verified):** from a live protected session, the operator
   attempts one launch per gap (non-native runner, remote machine,
   non-allowlisted agent, non-allowlisted tool) and observes each either
   guarded in the child or rejected at admission, with `just check` green.

## Deltas from Drafted

- **Sharpened**
  - AC1: added the status/watch non-goal (registry never queried there).
  - AC2: added list visibility, the `update()`-not-re-register rule, and
    the `structured_output` exemption.
  - AC3: added dispose-before-register for `/appa` toggle cycles.
  - AC4: added import-failure ≡ absent, and warn-not-block for seam-less
    installs.
- **Added** (Guardrails only): a `denyExtensions` default ships only after
  a test proves it coexists with required extensions; the peer-dependency
  floor is pinned at Plan.
- **Removed**: none.
- **Relaxed**: none.

Questions this pass retires or sharpens: **Q4** (admission-level
guardability exists and is verified — the required-extension seam with
`requireForAllRunners`), **Q5** (clamping without policy logic —
settings/env surface; `appa.toml` and hardcoding rejected), **Q6** (absent
→ silent no-op; seam-less install → warn, not block).

## Human Validation Process

unchanged from drafted
