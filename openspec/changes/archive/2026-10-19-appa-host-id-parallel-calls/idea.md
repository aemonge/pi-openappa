# Idea: Identify hook calls to the APPA runtime

<!-- Standalone -->

Observed pain: any Pi turn that issues parallel tool calls gets its second
call denied by the APPA runtime with `a call without a host id is already
outstanding; this host must propose one unidentified call at a time`
(reproduced live 2026-10-19: bash+read, read+read — second call blocked,
solo calls pass). Because every local session shares 127.0.0.1:8787 and no
call carries a host id, one orphaned outstanding call (interrupted session,
subagent) blocks every session until the runtime restarts. The wire notes
(verified 2026-10-06, appa 0.31.1) never probed concurrent PreToolUse, so
this contract requirement was never captured.

Direction and hard limits: probe the live runtime to learn the exact host-id
wire field, then send it (plus a per-call id) from the adapter in
Pre/PostToolUse payloads. No policy logic moves into this repo; the runtime
keeps owning every decision. Byte-exact PostToolUse echo semantics are
untouched.
