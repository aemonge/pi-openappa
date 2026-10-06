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

## Protect sessions

Protection is opt-in, in one of three ways:

- **Project-scoped (recommended):** create `<project>/.pi/openappa` — sessions
  started in that directory are protected, sessions elsewhere are not. The
  marker's optional content names that project's policy (absolute or
  cwd-relative); empty content falls back to `APPA_CONFIG` or APPA's default:

  ```sh
  cd your-project && mkdir -p .pi && echo "appa.toml" > .pi/openappa
  ```

- **Built-in:** run `/appa on` once — every Pi session everywhere is
  protected. `/appa off` disables.
- **Per launch:** `APPA_GATE=1 pi` (the `clappa`-style launcher route).

A gated session brings the runtime up on its own: `session_start` invokes
`appa hook --ensure-runtime`, passing `--config "$APPA_CONFIG"` when set and
otherwise letting APPA use its own default policy (`~/.config/appa/appa.toml`).
Protected sessions therefore need zero manual server management. A custom
`APPA_RUNTIME_URL` names a runtime that is *yours* to start — the hook
refuses with exactly that reason instead of guessing.

While gated, a runtime that cannot answer blocks the call and the reason is
returned to the model — **silence never means yes**. If no policy exists the
startup warning names the exact outs; `/appa off` always works, even with
every tool call blocked. Ungated sessions never invoke the hook.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `APPA_GATE` | unset | `1` protects this session (read once at launch) |
| `.pi/openappa` | absent | Project marker: gates sessions started in that directory; optional content = policy path |
| `APPA_RUNTIME_URL` | `http://127.0.0.1:8787` | Runtime endpoint (loopback only) |
| `APPA_CONFIG` | unset | `appa.toml` the session auto-starts the runtime with |
| `APPA_HOOK_BIN` | `appa` | Hook binary to invoke |
| `APPA_HOOK_TIMEOUT_MS` | `15000` | Kill the hook after this long; the call is then blocked |

`/appa` reports protection, always-on state, and runtime health; `/appa on`
and `/appa off` toggle always-on protection (marker:
`~/.config/pi-openappa/always-on`), taking effect immediately including the
current session.

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
