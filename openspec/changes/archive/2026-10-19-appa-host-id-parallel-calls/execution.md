# Execution: Host ids and call ids on the `appa hook` wire

> Estimate: 1–2 h · confidence high, from live repro Human wait: none
> Parents: idea in this change.

## Skills

bare — the change is a small, well-bounded payload/adapter edit; the repo's
own wire-notes probe method (docs/wire-notes.md) is the load-bearing
technique and is followed directly.

## Workflow

> Probe first, then code to the observed contract — the wire notes' own rule:
> facts are probed live, never assumed.

## Steps

1. Probe the live runtime (127.0.0.1:8787, appa 0.31.1): reproduce the
   one-outstanding-unidentified-call rule, then discover the accepted
   host-id payload field (and per-call id acceptance) by sending candidate
   payloads; close every opened call with byte-exact PostToolUse.
2. Record the verified facts in docs/wire-notes.md.
3. Add host id + tool call id to Pre/PostToolUse payload builders in
   src/adapter.ts; thread session host id and toolCallId from
   extensions/index.ts.
4. Update/add adapter unit tests in test/.
5. Run `just check`; fix fallout.
6. CHANGELOG.md Unreleased entry; graphify update.

(Status-line publication executed as its own change: publish-companion-status.)

## Verification

`just check` green; probe transcript shows concurrent identified calls both
allowed; fresh-session parallel-call check left to Human validation.
