# pi-openappa

A thin [OpenAPPA](https://openappa.com) guard extension for
[Pi](https://pi.dev): every tool call in a protected session is checked by the
APPA runtime before it runs, and every tool result before the model sees it.
No policy logic lives here — the APPA runtime owns every decision; this
extension only translates events and enforces the answer.

```text
pi event ──▶ adapter ──▶ `appa hook` ──▶ APPA runtime
                                          allow / deny / replace
pi event ◀── enforce  ◀── decision  ◀────────────┘
```

## Requirements

- The `appa` binary on `PATH` ([install](https://openappa.com)) — version
  0.31.x verified; see `docs/wire-notes.md` for the recorded contract
- An APPA runtime listening on loopback (default `127.0.0.1:8787`)
- A policy (`appa.toml`) that declares the tools your sessions may use

## Install

```sh
pi install npm:pi-openappa        # once published
pi install ./pi-openappa          # from a checkout
```

## Protect a session

Protection is opt-in per session and fixed at launch, matching OpenAPPA's own
Claude Code integration (`clappa`):

```sh
APPA_GATE=1 pi          # protected session
pi                      # normal, unprotected session
```

A launcher alias keeps it comfortable:

```sh
alias pippa='APPA_GATE=1 pi'
```

While gated, a runtime that cannot answer blocks the call and the reason is
returned to the model — **silence never means yes**. Sessions started without
`APPA_GATE` are untouched: the extension never invokes the hook.

### Auto-start

A gated session brings the runtime up on its own: `session_start` invokes
`appa hook --ensure-runtime`, passing `--config "$APPA_CONFIG"` when set.
With the default port this means `APPA_GATE=1 APPA_CONFIG=./appa.toml pi`
is a fully protected session with zero manual server management. A custom
`APPA_RUNTIME_URL` names a runtime that is *yours* to start — the hook
refuses with exactly that reason instead of guessing.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `APPA_GATE` | unset | `1` protects this session (read once at launch) |
| `APPA_RUNTIME_URL` | `http://127.0.0.1:8787` | Runtime endpoint (loopback only) |
| `APPA_CONFIG` | unset | `appa.toml` the session auto-starts the runtime with |
| `APPA_HOOK_BIN` | `appa` | Hook binary to invoke |
| `APPA_HOOK_TIMEOUT_MS` | `15000` | Kill the hook after this long; the call is then blocked |

`/appa` reports protection state and runtime health.

## Event mapping

| Pi event | APPA event | Effect |
|---|---|---|
| `session_start` | `SessionStart` | opens the trajectory; warns when the runtime is down |
| `before_agent_start` | `UserPromptSubmit` | turn boundary (never gates) |
| `tool_call` | `PreToolUse` | deny blocks the call; the reason reaches the model |
| `tool_result` | `PostToolUse` | replace swaps the result the model sees |
| `turn_end` | `Stop` | reported (`--turn-end`), never gates |

Pi built-in tool names map to Claude Code policy names (`bash`→`Bash`,
`find`→`Glob`, …); custom and MCP tools pass through under their own names and
policies declare them verbatim.

## Limitations

- **Load order matters in theory**: the runtime digests tool arguments at
  `PreToolUse`. If another extension rewrites `event.input` after this
  handler runs, the executed arguments differ from the checked ones and the
  runtime withholds the result (`byte_mismatch`). Load pi-openappa last if
  you combine it with argument-rewriting extensions.
- **Policy edits reach new sessions only**: trajectories keep the policy they
  opened with, by runtime design. When iterating on a policy, restart the
  runtime (and start fresh sessions) — a stale runtime or an old trajectory
  will keep serving the old policy.
- **Subagents**: spawning is mediated as a plain tool call (deny blocks the
  spawn). Child trajectories are not linked into the parent's label chain
  yet; a gated child Pi process opens its own root trajectory.
- The adapter never starts a runtime for ungated sessions; auto-start needs
  either `APPA_CONFIG` or an installed APPA deployment.
- OpenAPPA is Preview & RFC: wire surfaces may break without shims. The
  entire wire contract lives in `src/hook-client.ts` and `src/adapter.ts`
  (verified facts in `docs/wire-notes.md`), and the adapter core is
  runtime-agnostic so a pi-durable wiring can reuse it unchanged.

## Development

```sh
npm test        # node --test, mock-driven, no runtime needed
npm run typecheck
```

The adapter core (`src/adapter.ts`) has no Pi imports by design; the Pi
wiring is `extensions/index.ts` only.

## License

MIT
