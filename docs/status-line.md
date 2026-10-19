# Status line: what pi-openappa publishes, and how to render it

pi-openappa publishes a footer/deck status through Pi's native extension
status API (`ctx.ui.setStatus`, key **`openappa`**). This page documents the
published states, the refresh points, and the contract status renderers
(pi's own footer, pi-stardeck's shield chip, custom statuslines) should
implement.

The one rule that shapes everything: **silence renders as an error.**
Renderers treat "no status published" as off/KO and color it red, so a
companion that only speaks when something is wrong looks permanently broken.
pi-openappa therefore publishes from session start and keeps the text
current — absence is never an honest state for a loaded extension.

## Published states

| Text | When | Severity downstream |
|---|---|---|
| `openappa starting` | gated session, runtime boot still in flight | blue |
| `openappa ok · gated` | the runtime answered (a policy denial is still an answer) | blue |
| `openappa off · protection opted out` | ungated session (`APPA_GATE=0`, `.pi/no-openappa`, `/appa off`) | blue |
| `openappa unreachable · <url>` | boot or health check cannot reach the runtime | red |
| `openappa unreachable · hook timeout` | hook exceeded `APPA_HOOK_TIMEOUT_MS` | red |
| `openappa failing · appa binary missing` | hook binary not on PATH (ENOENT) | red |
| `openappa failing · hook exited N` | unrecognized nonzero hook exit | red |
| `openappa needs attention · no policy, session unprotected` | first-run fallback: no policy anywhere, nothing answers | yellow |

Texts are plain text, whitespace-collapsed, ≤ 240 chars (front-load the
meaning — narrow surfaces truncate), and never empty: empty strings are
dropped by bridges, and `setStatus(key, undefined)` *removes* the status,
which renders as red again.

**A policy denial is an answer.** A call blocked by policy (exit 2 block or
a `permissionDecision: "deny"`) means the runtime is alive and deciding —
the status stays `ok`. Only transport-level failures (unreachable, timeout,
missing binary, unrecognized exit) degrade the status. Blocking a call and
being unable to decide are different failures.

## Refresh points

The footer re-reads statuses on every render, so publication is push-once
per state change (deduped internally):

- `session_start` — `starting` (gated) or `off · protection opted out`
- the runtime boot lane settling — `ok`, `unreachable`, or
  `needs attention`
- every hook outcome (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
  `Stop --turn-end`) — `ok` on any answer, degraded text on transport
  failure
- `/appa status` — refreshes from its explicit health check

No polling loop: hook outcomes already observe the runtime on every turn.

## For status renderer authors

Severity is word-matched against the published text, case-insensitive,
substring:

- contains `error`, `fail`, `down`, `unreachable`, `unhealthy` → red
- contains `warn`, `stale`, `update recommended`, `needs attention` →
  yellow
- anything else → blue (healthy)
- **nothing published** → red (off)

Substring matching cuts both ways: `countdown`, `downloading`, and
`no failures` all contain a red word. When authoring new pi-openappa
statuses, keep healthy texts collision-free and put the red/yellow word in
degraded texts on purpose. If you render statuses, surface degraded texts
verbatim in a notice slot (e.g. `⚠ openappa unreachable · …`) so the user
sees the reason, not just the color.

## For pi-openappa contributors

- Publication lives in `extensions/index.ts`: `publishStatus` (dedupe,
  `hasUI` guard, key `openappa`) and `statusFromOutcome` (policy denial =
  answered; only transport failures degrade). Keep the vocabulary table
  above in sync with the code.
- Unit tests record published statuses through a fake-UI `setStatus`
  recorder (`test/extension.test.ts`, `harness.statuses`). Add a case for
  any new state text.
- End-to-end: reload a session in a checkout and watch the chip — blue
  `openappa ok · gated` is the happy path; kill the runtime
  (`pkill -f "appa runtime"`) and reload to see honest red.
