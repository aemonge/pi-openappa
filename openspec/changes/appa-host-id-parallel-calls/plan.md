# Plan: Host ids and call ids on the `appa hook` wire

> Estimate: 1–2 h · confidence high (root cause reproduced live; field names
> to be confirmed by probe)
> Evidence: second concurrent PreToolUse is denied with the host-id reason on
> appa 0.31.1 while solo calls pass; `appa hook --help` has no host-id flag,
> so the field lives in the payload JSON.
> Parent idea: appa-host-id-parallel-calls (this change)
> Human wait: restart a Pi session with the fixed extension and issue parallel
> tool calls; both must pass.

## Acceptance

- Probe of the live runtime records the exact accepted host-id field (and
  whether a per-call id is accepted) in docs/wire-notes.md.
- Two overlapping PreToolUse payloads carrying the host id are both allowed;
  a payload without it still reproduces the one-outstanding rule.
- Adapter unit tests cover host id and tool-call id in Pre/Post payloads.
- `just check` passes (tests + typecheck + strict lint + policy gates).
- A fresh session running the fixed extension completes parallel tool calls
  with zero host-id denials (Human-verified).

## Scope

- src/adapter.ts — payload builders gain host id + tool call id.
- extensions/index.ts — pass toolCallId.
- test/ — payload unit tests updated/added.
- docs/wire-notes.md — new verified facts section.
- CHANGELOG.md — Unreleased entry.

(Status-line publication landed as its own change: publish-companion-status.)

## Exclusions

- No runtime-side changes (appa is external; version 0.31.1 as-is).
- No change to byte-exact echo bookkeeping beyond carrying the call id.
- No new CLI flags or env vars beyond what the probe proves necessary.
