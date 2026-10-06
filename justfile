# pi-openappa — a Pi extension for OpenAPPA
# Just runs from the repo root; recipes are boring on purpose.

# Run everything a change should pass (default)
default: check

# Tests + typecheck together
check: test typecheck

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
