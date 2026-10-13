## What changes

<!-- One or two sentences; link the issue if one exists. -->

## Checklist

- [ ] `just check` passes locally (tests, typecheck, all three policy gates)
- [ ] Policy change: a `traces/*.appa` case proves the new decision **and**
      that clean sessions still flow
- [ ] New Pi tool: declared in `templates/appa.toml` under its verbatim name
      and added to `pi_tools` in the justfile
- [ ] README updated if user-visible behavior changed
- [ ] CHANGELOG.md has an entry
- [ ] No new runtime dependencies (this package stays dependency-free)
