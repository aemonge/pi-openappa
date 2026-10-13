---
name: Bug report
about: Something behaves wrong in a gated session, the policy, or the wiring
labels: bug
---

**What happened**

A short description of the wrong behavior, and what you expected instead.

**The refusal's reason (if any)**

Fail-closed refusals carry a reason — paste it verbatim; it names the rule
and the fence that tripped.

**Environment**

- pi-openappa version: `npm ls pi-openappa` (or the install path)
- Pi version, OS, `appa --version`
- Gating: default / `APPA_GATE=` / marker (`.pi/openappa`, `.pi/no-openappa`) / `/appa off`

**Reproduction**

Steps, or better: a minimal `traces/*.appa` replay case (see
[CONTRIBUTING.md](../CONTRIBUTING.md) for the format) that shows the wrong
decision via `appa replay`.

**Session log excerpt** (optional)

The startup warnings and any auto-install notices, if they matter.
