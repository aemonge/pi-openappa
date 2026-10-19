# Tasks

Step states: `[ ]` Pending, `[-]` Running/interrupted/failed, `[x]` Complete.

## Task 1 — The openappa chip reflects real state (no more silent off-red)

> Execution: publish-companion-status

- [x] Step 1 — Publish status at session start + boot settle + hook outcomes
      + /appa status · start: 2026-10-19T16:20Z · elapsed: 30m · check:
      `just check` green (86 unit incl. 5 status tests), live integration 91
      pass · paths: extensions/index.ts, test/extension.test.ts, README.md,
      CHANGELOG.md
- [x] Step 2 — Human validation — reload a session and see the shield chip
      blue (`openappa ok · gated`) in the stardeck deck · response: "VALID -
      Shall we commit, tag, push and publish?" · outcome: VALID · at:
      2026-10-19T16:05Z
