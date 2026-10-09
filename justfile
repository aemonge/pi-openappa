# pi-openappa — a Pi extension for OpenAPPA
# Just runs from the repo root; recipes are boring on purpose.

# Run everything a change should pass (default)
default: check

# Tests + typecheck together, plus the policy gates
check: test typecheck policy-check policy-test policy-coverage

# Mock-driven test suite (no APPA runtime needed)
test:
    npm test

# TypeScript check, no emit
typecheck:
    npm run typecheck

# Install this checkout as a local Pi package (loads live from this path)
install:
    pi install {{justfile_directory()}}

# Reconcile Pi package installations after dependency changes
update:
    pi update --extensions

# Remove this checkout from Pi's packages
remove:
    pi remove {{justfile_directory()}}

# Publish to npm (requires `npm login`; the Pi gallery indexes the pi-package keyword)
publish: check
    npm publish

# Ship a version: sync the lockfile version, run every check, publish to npm
# (run the README smoke test right after)
deploy:
    npm install --package-lock-only --no-audit --no-fund
    just check
    npm publish

# ── Starter-policy gates (no APPA runtime needed; appa CLI only) ──────────

# Pi session toolset the starter policy must cover: mapped built-in names
# (bash→Bash, find→Glob, …) plus custom/MCP tools verbatim. Extend when you
# adopt new tools — an unlisted tool is silently outside this check.
pi_tools := "Bash,PowerShell,Read,Edit,Write,Grep,Glob,LS,subagent,web_explore,codemode,resolve-library-id,query-docs,lsp_diagnostics,lsp_fix,work_focus,stage,subject,openspec_focus,mem_search,mem_save,mem_update,mem_delete,mem_capture_passive,mem_context,mem_stats,mem_timeline,mem_get_observation,mem_list_projects,mem_current_project,mem_doctor"

# Validate the starter policy loads
policy-check:
    appa describe --config templates/appa.toml --check > /dev/null && echo "templates/appa.toml loads"

# Day E: every known Pi tool must be declared — refusals fail the build
# (deny-undeclared stays a deliberate choice, made in the policy, not here)
policy-coverage:
    #!/usr/bin/env sh
    set -eu
    out="$(appa describe --config templates/appa.toml --check --session-tools '{{pi_tools}}')"
    echo "$out" | grep -E '^Session tools:'
    echo "$out" | grep -q ', 0 refused' || { echo "$out" | sed -n '/refused/p'; echo 'ERROR: a Pi tool is refused by the starter policy — declare it or fix selectors'; exit 1; }

# Days A–D, F: replay the usage-day traces (sequences share one trajectory,
# so taint accumulates exactly as in a live session)
policy-test:
    appa replay --config templates/appa.toml traces/
