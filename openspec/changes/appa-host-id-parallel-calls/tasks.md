# Tasks

Step states: `[ ]` Pending, `[-]` Running/interrupted/failed, `[x]` Complete.

## Task 1 — Parallel tool calls pass the APPA runtime

> Execution: appa-host-id-parallel-calls

- [x] Step 1 — Probe runtime: host-id field + one-outstanding rule · start:
      2026-10-19T15:12Z · elapsed: 10m · check: probe transcript, every opened
      call closed · paths: /tmp/appa-probe (scratch)
- [x] Step 2 — Adapter + extension carry host id and tool call id · start:
      2026-10-19T15:25Z · elapsed: 35m · check: `just check` green (81 unit +
      5 live-integration tests), live E2E: two concurrent calls both released ·
      paths: src/adapter.ts, extensions/index.ts, test/, docs/wire-notes.md,
      CHANGELOG.md
- [x] Step 3 — Human validation — restart a Pi session in this checkout and
      issue parallel tool calls; both pass with no host-id denial · response:
      user reloaded with `pi remove npm:pi-openappa` + `pi install .`; live
      in-session proof: parallel bash+read and read+read both released
      (2026-10-19, this session) · outcome: VALID · at: 2026-10-19T15:5xZ
