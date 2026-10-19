# Wire notes: `appa hook` contract (verified 2026-10-06, re-verified 2026-10-19, appa 0.31.1)

All facts below were probed live against `appa runtime` on 127.0.0.1:8791 with a
minimal one-tool policy. Probes: SessionStart, UserPromptSubmit, PreToolUse (allow,
undeclared-refuse), PostToolUse (byte-mismatch withhold), Stop --turn-end, plus
ungated and runtime-down probes. The 2026-10-19 re-verification (live runtime on
127.0.0.1:8787) added concurrent-call probing and discovered the call-identification
rule below — the original probes were strictly sequential, so it never surfaced.

## Transport

- Subprocess: `appa hook` (env inherited; gate and URL read from env)
- Gate: inert unless `APPA_GATE=1` — ungated always exits 0, no side effects
- URL: `APPA_RUNTIME_URL` (default `127.0.0.1:8787`, loopback only)
- Turn-end: pass `--turn-end` (non-blocking report; exit 0 even when down)
- Payload: Claude Code hook JSON on stdin

## Payload fields (accepted and observed)

- `session_id` — becomes trajectory `cc:<session_id>` in the runtime
- `hook_event_name` — `SessionStart` | `UserPromptSubmit` | `PreToolUse` |
  `PostToolUse` | `Stop`
- `source` (SessionStart): `startup` | `resume`
- `prompt` (UserPromptSubmit)
- `tool_name`, `tool_input` (PreToolUse / PostToolUse)
- `tool_use_id` (PreToolUse / PostToolUse) — the host-proposed call id; see
  "Call identification" below
- `tool_response` (PostToolUse)
- `cwd`

## Decision protocol (observed)

- Exit 0, no stdout (or `{}`) → proceed. SessionStart/UserPromptSubmit behave so.
- Exit 0 + `{"hookSpecificOutput":{"hookEventName":"PreToolUse",
  "permissionDecision":"allow","permissionDecisionReason":"..."}}` → proceed.
- Exit 2 + stderr `OpenAPPA hook blocked: <reason>` → block; reason goes to the
  model. Observed for an undeclared tool (HTTP 409 upstream, stdout carries
  `{"error": "<reason>"}`).
- Exit 0 + `{"hookSpecificOutput":{"hookEventName":"PreToolUse",
  "permissionDecision":"deny","permissionDecisionReason":"[appa] <reason>"}}`
  → block with the reason (observed 2026-10-19: the one-outstanding-unidentified-
  call denial; reasons carry an `[appa] ` prefix). A declared-but-policy-denied
  call is expected to use this same shape.
- Exit 0 + `{"decision":"block","reason":"...",
  "hookSpecificOutput":{"hookEventName":"PostToolUse","updatedToolOutput":{...}}}`
  → PostToolUse replacement: `updatedToolOutput` is what the model must see
  (observed: withheld-result notice replacing a mismatched result).
- Runtime down: PreToolUse exit 2 (fail-closed, stderr names 127.0.0.1:8787);
  Stop --turn-end exit 0 + stderr warning.

## Call identification (verified 2026-10-19)

- A PreToolUse carrying `tool_use_id` is **identified**: identified calls may
  overlap freely — two and three concurrent outstanding calls verified, all
  allowed.
- A PreToolUse **without** `tool_use_id` is **unidentified**: the runtime allows
  only ONE unidentified call outstanding at a time. While one is outstanding,
  every subsequent PreToolUse — identified or not — is denied (exit 0,
  `permissionDecision:"deny"`) with reason: `[appa] a call without a host id is
  already outstanding; this host must propose one unidentified call at a time`.
  "Host id" here means the id the host proposes per call (`tool_use_id`), not an
  identifier of the host itself.
- Consequence for hosts that run parallel tool calls (Pi does): every
  PreToolUse MUST carry `tool_use_id`, or the second concurrent call is denied.
  Inferred (not probed — would require crashing a client mid-call): an
  orphaned unidentified call denies calls for everyone on that runtime until
  it resolves or the runtime restarts — runtime-side concern.
- PostToolUse resolves the outstanding call via the byte-exact `tool_input`
  echo; `tool_use_id` on PostToolUse is accepted but optional (verified: a Post
  without it still resolved the call). Send it anyway for precise correlation.
- A `host_id` payload field is ignored — probed on SessionStart and on calls,
  no effect on the rule above.

## Hard constraints

1. **Byte-exact echo**: PostToolUse `tool_input` must be byte-identical to the
   PreToolUse `tool_input` (runtime digests it canonically; mismatch → result
   withheld with `byte_mismatch`). The extension must remember the exact object
   it sent per tool call id.
2. **Tool naming**: the runtime sees `host/claude-code/<Name>`; policies are
   written in Claude-Code naming. Map pi built-ins: bash→Bash,
   powershell→PowerShell, read→Read, edit→Edit, write→Write, grep→Grep,
   find→Glob, ls→LS. Unknown/custom tools pass through verbatim; policy authors
   declare them under the pi name.
3. **tool_response shape**: Claude-Code-shaped for tools where pi provides the
   data (bash: `stdout`/`stderr`/`exitcode`/`interrupted` from details when
   present); otherwise generic `{ "output": <joined text>, "isError": <bool> }`.

## Session mapping

pi `session_start.reason`: `startup|new` → `startup`; `resume|fork|reload` →
`resume`.

## Not yet observed (client parses defensively)

- `deliver_value` / remedy offers on PreToolUse
- Subagent (`SubagentStop`, child trajectories) — out of v1 scope

## Auto-start (verified 2026-10-06)

- `appa hook --ensure-runtime --config <path>` with nothing on the default
  port boots a runtime on `127.0.0.1:8787`; the hook exits 0.
- `--ensure-runtime` with a custom `APPA_RUNTIME_URL` exits 2:
  `the runtime could not be started: nothing answers <url>, and a runtime at
  a URL the session named is the user's own to start` — custom URLs are
  user-managed by design; nothing binds 8787 in that case.

## Test seam

`appa replay <dir>` checks `.appa` trace files against a policy; mock-driven unit
tests remain our primary seam (no runtime needed).
