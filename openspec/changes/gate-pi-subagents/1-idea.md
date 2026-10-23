# Idea: gate pi-subagents launches behind the APPA guard

## Pain

pi-openappa promises that every tool call in a protected session is checked
by the APPA runtime before it runs — silence never means yes. But
`npm:pi-subagents` breaks that promise structurally: a protected parent can
launch child sessions through four unclaimed paths (non-native runners,
remote machines, unclamped `allowedAgents`, unclamped `allowedTools`) in
which the guard never loads or nothing clamps capability. Operators relying
on default-on protection get unguarded grandchildren on every delegation,
and nothing today claims the enforcement seams pi-subagents already provides
(verified 2026-10-23: `extensions/index.ts` calls neither).

## Questions

- **Q1 (what):** Which launch paths from a protected session must end
  guarded in the child, and which must be rejected at admission?
- **Q2 (what):** What observable outcome proves all four paths are closed —
  what does the human-only validation look at?
- **Q3 (what):** Is clamping non-subagent delegation surfaces (external CLI
  agents, providers) part of this spec or explicitly out?
- **Q4 (how might we):** How might child guardability become a condition of
  admission rather than a per-call hope?
- **Q5 (how might we):** How might capability be clamped without moving any
  policy logic into the extension?
- **Q6 (what):** What must happen when pi-subagents is absent, present but
  too old for the seams, or toggled mid-session?
