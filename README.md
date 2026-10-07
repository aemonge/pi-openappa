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

- The `appa` binary on `PATH`: `curl -fsSL https://openappa.com/install.sh | sh`
  (the extension installs it automatically when missing) — version 0.31.x
  verified; see `docs/wire-notes.md` for the recorded contract
- An APPA runtime listening on loopback (default `127.0.0.1:8787`)
- A policy (`appa.toml`) that declares the tools your sessions may use

## Install

```sh
pi install npm:pi-openappa        # published on npm; indexed by the Pi gallery
pi install ./pi-openappa          # from a checkout
```

## Smoke test

Ship and verify in one pass:

```sh
just deploy                        # sync the lockfile, run checks, npm publish
just remove                        # drop a local-checkout install, if present
pi install npm:pi-openappa         # install the published package
pi                                 # any session: protection on, appa auto-installs
appa --version                     # OK — the runtime is on PATH
```

`pi install` only registers the package — extension code runs when a session
starts, so `appa` appears after that first session, not before.

## Protect sessions

Protection is **on by default**: every Pi session is guarded unless you opt
out. Opt-outs, most specific first:

- **Per launch:** `APPA_GATE=0 pi` (and `APPA_GATE=1 pi` to force it on).
- **Per project:** create `<project>/.pi/no-openappa` — sessions started in
  that directory run unguarded.
- **Globally:** `/appa off` once (marker `~/.config/pi-openappa/off`) — every
  session everywhere runs unguarded until `/appa on`.

The project marker `<project>/.pi/openappa` names that project's policy
(absolute or cwd-relative) and re-enables protection even when globally off;
empty content falls back to `APPA_CONFIG` or APPA's default:

  ```sh
  cd your-project && mkdir -p .pi && echo "appa.toml" > .pi/openappa
  ```

A protected session brings the runtime up on its own: `session_start` invokes
`appa hook --ensure-runtime`, passing `--config "$APPA_CONFIG"` when set and
otherwise letting APPA use its own default policy (`~/.config/appa/appa.toml`).
Protected sessions therefore need zero manual server management. A custom
`APPA_RUNTIME_URL` names a runtime that is *yours* to start — the hook
refuses with exactly that reason instead of guessing.

When the default `appa` is missing from `PATH`, a protected session installs
it itself — once, with a UI notice — by running the same official script
(`curl -fsSL https://openappa.com/install.sh | sh`), then retries starting
the runtime. Sessions that name a custom `APPA_HOOK_BIN` are never
auto-installed.

While protected, a runtime that cannot answer blocks the call and the reason
is returned to the model — **silence never means yes**; `/appa off` always
works, even with every tool call blocked. One exception: with **no policy
anywhere** (`APPA_CONFIG`, marker content, and `~/.config/appa/appa.toml` all
absent) and no runtime answering, the session runs **unprotected** with one
startup warning naming the fixes — an unconfigured guard must not lock you
out of your own machine. A named policy that fails stays fail-closed.
Opted-out sessions never invoke the hook.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `APPA_GATE` | unset | `1` forces protection on for this launch; `0` forces it off |
| `.pi/openappa` | absent | Project marker: names that project's policy and forces protection on |
| `.pi/no-openappa` | absent | Project opt-out: sessions started there run unguarded |
| `APPA_RUNTIME_URL` | `http://127.0.0.1:8787` | Runtime endpoint (loopback only) |
| `APPA_CONFIG` | unset | `appa.toml` the session auto-starts the runtime with |
| `APPA_HOOK_BIN` | `appa` | Hook binary to invoke |
| `APPA_INSTALL_CMD` | `curl -fsSL https://openappa.com/install.sh \| sh` | Auto-install command for a missing default `appa` (pin a mirror or offline copy) |
| `APPA_HOOK_TIMEOUT_MS` | `15000` | Kill the hook after this long; the call is then blocked |
| `APPA_INSTALL_TIMEOUT_MS` | `120000` | Kill a stuck auto-install after this long |

`/appa` reports protection, opt-out state, and runtime health; `/appa off`
disables protection globally (marker `~/.config/pi-openappa/off`) and
`/appa on` re-enables it, taking effect immediately including the
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
- **On by default**: installing this extension guards every session and may
  download and run openappa.com's install script once on first run. The
  opt-outs above and `APPA_INSTALL_CMD` are the escapes.
- **Auto-install is `curl \| sh`**: a protected session with the default
  binary missing downloads and runs the script with user privileges, at most
  once per session start. Pre-install `appa` or pin `APPA_INSTALL_CMD` to
  avoid it.
- The adapter never starts a runtime for opted-out sessions; auto-start needs
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
