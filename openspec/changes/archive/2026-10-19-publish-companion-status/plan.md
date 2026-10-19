# Plan: Publish openappa status to the footer/deck

> Estimate: 30–45 m · confidence high (contract fully traced; setStatus API
> present in @earendil-works/pi-coding-agent 1.0.4, types.d.ts:84)
> Evidence: pi-stardeck deck.ts:431/446-472 — key appa|openappa, severity
> word-matched, absence = red; bridge relays footer statuses verbatim.
> Parent idea: publish-companion-status (this change)
> Human wait: reload a session with the extension and see the shield chip go
> blue ("openappa ok · gated") in the stardeck deck.

## Acceptance

- A gated session publishes under key `openappa` from session start:
  `openappa starting` immediately, then a settled state.
- Settled states: `openappa ok · gated` (blue); `openappa off · protection
  opted out` (blue); `openappa unreachable · <url>` / `· hook timeout` /
  `openappa failing · appa binary missing` / `· hook exited N` (red);
  `openappa needs attention · no policy, session unprotected` (yellow).
- A policy denial (exit 2 block / exit-0 deny JSON) is an ANSWER: status
  stays ok — only transport-level failures degrade.
- No text contains a severity fragment by accident; no empty strings;
  deduped (no setStatus spam); hasUI-guarded.
- `/appa status` refreshes the published status from its health check.
- Unit tests cover off / ok / unreachable / failing / deny-stays-ok.
- `just check` green.
- Human sees a blue chip in a healthy session.

## Scope

- extensions/index.ts — publishStatus helper, statusFromOutcome, publish
  points (session_start, boot settle, tool_call, tool_result,
  before_agent_start, turn_end, /appa status).
- test/extension.test.ts — fake-UI setStatus recorder + tests.
- README.md — status-line bullet.
- CHANGELOG.md — Unreleased → Added.

## Exclusions

- No polling/health loop (footer re-reads statuses every render).
- No change to gate semantics, hook payloads, or policy behavior.
- No pi-stardeck changes (its contract is consumed, not extended).
