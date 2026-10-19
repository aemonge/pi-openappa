# Idea: Publish openappa status to the footer/deck

<!-- Standalone -->

Observed pain: pi-stardeck renders the openappa shield chip from a footer
status published via ctx.ui.setStatus — and ABSENCE renders red ("silent
off"). pi-openappa never publishes, so the chip is permanently red even when
protection is healthy; the user cannot tell "off" from "error". Contract
(traced in pi-stardeck, 2026-10-19): key `openappa`; severity word-matched —
error|fail|down|unreachable|unhealthy → red, warn|stale|needs attention →
yellow, anything else → blue; plain text ≤ 240 chars; never empty (empty is
dropped; undefined removes and reads red).

Direction and hard limits: publish from session start and keep it current
from hook outcomes the extension already observes. No polling loop, no new
wire calls, no policy logic. Healthy texts must avoid the severity
fragments ("countdown", "downloading" collide).
