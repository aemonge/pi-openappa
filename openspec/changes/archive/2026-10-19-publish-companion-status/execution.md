# Execution: Publish openappa status to the footer/deck

> Estimate: 30–45 m · confidence high Human wait: chip color check
> Parents: idea in this change.

## Skills

bare — small, well-bounded UI-hook edit; the load-bearing input is the
traced pi-stardeck contract (word-matched severity, absence = red) and pi's
ExtensionUIContext.setStatus types, both already in hand.

## Workflow

> Consume the traced contract as-is: publish early, publish always, choose
> words that cannot collide with the severity regexes.

## Steps

1. extensions/index.ts: STATUS_KEY + publishStatus (dedupe, hasUI-guarded) +
   statusFromOutcome (policy denial = answered); publish at session_start
   (off/starting), boot-lane settle (ok/unreachable/needs-attention), every
   hook outcome, and /appa status.
2. test/extension.test.ts: setStatus recorder in the fake UI; tests for
   off / ok / unreachable / failing / deny-stays-ok.
3. README status bullet; CHANGELOG Unreleased → Added.
4. `just check`; graphify update.

## Verification

`just check` green; unit tests assert the published texts; Human validates
the chip color in a live deck.
