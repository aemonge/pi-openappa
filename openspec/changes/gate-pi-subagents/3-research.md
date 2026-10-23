# Research

Runs between the drafted and refined requirements — its findings are the
steering that turns draft into refined.

## Findings

- Seam A — `registerRequiredChildExtensions` from
  `pi-subagents/required-child-extensions`: `{ sessionId, extensions:
  [{ id, path }] }`; **one live registration per parent session** until
  idempotent `dispose()`; paths canonicalized into an immutable launch
  snapshot; required paths survive agent defaults and `extensions: []`
  across native foreground, detached, nested, and recovery launches;
  status/watch paths never query the registry. *(pi-subagents docs,
  extension-api.md / agents.md, via Context7)*
- `requireForAllRunners: true` (user-verified option): launches that cannot
  load the required extension — non-native runner, remote machine — fail at
  admission. Docs say "external runners are excluded"; with this flag the
  exclusion must become rejection — **prove by test**.
- Seam B — `registerSubagentCapabilityCeiling` from
  `pi-subagents/capability-ceiling`: `{ sessionId, source, ceiling: {
  allowedAgents?, allowedTools?, denyExtensions? } })` → `{ update(),
  dispose() }`; registrations **intersect** allowlists and **OR**
  `denyExtensions`; explicit `[]` blocks all for that field, omitted means
  unrestricted; non-allowlisted agents fail before spawn and stay visible
  (non-executable) in `{action:"list"}`; snapshots propagate monotonically
  to nested/async children; `structured_output` remains package-internal.
  Mid-session changes need `restriction.update()` — the snapshot is
  immutable.
- **Conflict warning to verify:** a `capabilityCeiling.denyExtensions`
  conflict rejects before model resolution, while required paths survive
  `extensions: []` — whether `denyExtensions: true` coexists with required
  pi-openappa is undecided by docs; a test must decide before any default
  ships.
- `extensions/index.ts` (read in full): `session_start` sets `gate` and
  `sessionId` synchronously; `unprotected` settles later on the serialized
  background lane; `session_shutdown` handler exists; `/appa on|off`
  re-captures `gate` in place — all four lifecycle hooks have natural
  homes.
- `package.json`: no pi-subagents dependency today; peer
  `@earendil-works/pi-coding-agent`; `node --test` suite → registrars
  should be dependency-injected, not module-mocked.
- Verified 2026-10-23: neither gate package calls either seam; no installed
  extension registers a `denyExtensions` ceiling — nothing suppresses the
  seams; they are unclaimed. *(user's grep, confirmed by full read)*
- Open: minimum pi-subagents version shipping `requireForAllRunners` —
  pin the peer range at Plan.

## Options

- **Registration timing** — eager at `session_start` when `gate.gated`
  (dispose on later unprotected fallback) vs. register only after
  protection is confirmed (window where launches escape → violates
  fail-closed; rejected). Eager wins on the silence-never-means-yes rule.
- **Ceiling surface** — `settings.json` `subagentCeiling` with env override
  (matches existing precedence env > marker > settings) vs. env-only
  (simpler, no persistence) vs. `appa.toml` section (rejected — parsing
  policy is policy logic) vs. hardcoded (rejected — same, plus
  unsteerable).
- **Presence handling** — dynamic `await import()` per seam in `try/catch`
  at `session_start`, silent no-op when the module is missing; installed
  but seam-less (too old) pi-subagents cannot be detected from the module
  alone → surface a one-time warning, not a block (blocking would break
  sessions whose pi-subagents predates the seams).
- **`/appa status`** — extending it to show seam state (registered /
  no-op / conflicted) is cheap and inside Scope; decided at Plan.

## Evidence

As of: 2026-10-23

- "Active registrations intersect `allowedTools` and `allowedAgents` sets
  and OR `denyExtensions`… Launching a non-allowlisted agent fails before
  spawn." *(pi-subagents docs, extension-api.md)*
- "Required paths follow ordinary extension resolution and survive agent
  defaults and `extensions: []` across native foreground, detached, nested,
  and recovery launches… External runners are excluded." *(agents.md)*
- "A `capabilityCeiling.denyExtensions` conflict or required
  load/provider-registration failure rejects before model resolution."
  *(agents.md)*
- Full read of `extensions/index.ts` (491 lines): zero references to either
  seam; `session_start` / `session_shutdown` / `/appa` handlers as
  described above.

## Alternatives

- **Required-child-extensions alone** — every launch that cannot load the
  guard fails at admission, nothing else changes.
  Trade-off: allowlists stay unclamped, so vetting of agent/tool capability
  is left entirely to per-call gating inside guarded children.
  Pick-when: delegation must keep working with zero operator configuration
  and per-call gating is accepted as sufficient.
- **Required-child-extensions + denyExtensions-only ceiling** — admission
  fail-closed plus a ceiling that strips ambient/provider extensions in
  children by default.
  Trade-off: the denyExtensions × required-extension interaction is
  undocumented and must be proven benign by test, else the default drops
  it.
  Pick-when: ambient extensions are the accepted smuggling path and the
  operator wants an unconfigured, non-breaking default.
- **Operator-declared allowlists, block-all default** — ceiling clamps
  `allowedAgents`/`allowedTools` from settings/env, empty (block all
  launches) until declared.
  Trade-off: breaks delegation for every protected session until
  configured — a breaking default-on change.
  Pick-when: the operator wants capability as explicit opt-in and accepts
  the break.
