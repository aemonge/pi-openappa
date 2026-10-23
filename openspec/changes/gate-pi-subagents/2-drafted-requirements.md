# Requirements — drafted: every subagent launch from a protected session is guarded or rejected at admission

## Draft Acceptance Criteria

1. From a protected session, a launch whose runner cannot load the guard
   (non-native runner, remote machine) is rejected **before spawn**, with a
   reason naming the seam. *(retires Idea Q1 for the unguardable paths)*
2. From a protected session, child capability is clamped by a session-scoped
   ceiling: non-allowlisted agents/tools fail before spawn and remain
   visible as non-executable in `{action:"list"}`.
3. Protection-state changes — the no-policy unprotected fallback, `/appa
   off`, `/appa on`, `session_shutdown` — register and dispose both seams
   idempotently; no double-registration error escapes to the session.
4. Sessions without pi-subagents behave byte-identically to today: no
   import failure, no status change, no behavior change. *(retires Idea Q6
   for the absent case)*
5. **Final (human-verified):** from a live protected session, the operator
   attempts one launch per gap (non-native runner, remote machine,
   non-allowlisted agent, non-allowlisted tool) and observes each either
   guarded in the child or rejected at admission. *(answers Idea Q2)*

## Scope

- `extensions/index.ts`: seam registration and dispose lifecycle at
  `session_start` / fallback / `/appa` toggles / `session_shutdown`.
- `package.json`: `pi-subagents` as optional peer dependency + dev
  dependency; dynamic import with silent no-op when absent.
- Ceiling surface: `settings.json` field + env override (structure only —
  no policy parsing).
- Tests for the seams' failure paths (missing seam, non-loadable child,
  clamped launch, absent pi-subagents), DI-injected registrars.
- README/CHANGELOG notes for the new behavior.

## Out of Scope

- `appa.toml` policy format or runtime changes — APPA owns decisions.
- Gating non-subagent delegation surfaces (external CLI agent profiles,
  MCP providers). *(Idea Q3: explicitly out)*
- Remote runtime topology / remote guard deployment.
- pi-openappa wire-protocol (`appa hook`) changes.
- Enforcing against a pi-subagents older than the seams (surfaced, warned —
  not blocked; see Research).

## Guardrails

- **Thin guard:** no policy logic in the extension; the ceiling is
  structural (children must be guardable), never a mirror of `appa.toml`.
- **Fail-closed preserved:** a child that cannot prove it loads the guard
  is not launched; silence never means yes.
- **Hard limit:** source mutations wait for the `execute` grant on Tasks or
  the human's declared work — attribution is not approval.
- Grants, approvals, and the verdict line are human acts; never
  assistant-invoked.

## Human Validation Process

From a live protected session (APPA runtime answering at its loopback URL),
the operator attempts one launch per gap — non-native-runner child,
remote-machine child, non-allowlisted agent, non-allowlisted tool — and
inspects each outcome plus `just check` (tests, typecheck, lint, policy
gates). **VALID** when every attempt is either guarded in the child or
rejected before spawn with the seam named, and the suite is green.
