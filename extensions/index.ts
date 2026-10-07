/**
 * pi-openappa — Pi extension wiring for OpenAPPA.
 *
 * Thin by design: translate Pi events to `appa hook` invocations and enforce
 * the answer. No policy logic lives here; the APPA runtime owns every
 * decision. Protection is opt-in per session (APPA_GATE=1 at launch) and
 * fail-closed while gated: if the runtime cannot answer, the call is blocked.
 *
 * Wire facts and constraints: docs/wire-notes.md
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  parseCallDecision,
  parseResultDecision,
  postToolUsePayload,
  preToolUsePayload,
  promptPayload,
  sessionStartPayload,
  stopPayload,
  toolResponseFrom,
} from "../src/adapter.ts";
import { invokeAppaHook, resolveHookBin, type HookOutcome } from "../src/hook-client.ts";
import { installAppa, type InstallOutcome } from "../src/installer.ts";
import {
  appaDefaultPolicyExists,
  captureGate,
  checkHealth,
  setGloballyOff,
  type GateState,
} from "../src/gate.ts";

interface TextPart {
  type: "text";
  text: string;
}

export default function (pi: ExtensionAPI): void {
  /** Launch-fixed protection state; null until the session starts. */
  let gate: GateState | null = null;
  let sessionId = "";
  /** No policy anywhere and nothing answered: this session runs unprotected. */
  let unprotected = false;
  /**
   * toolCallId → the exact `input` object sent in the PreToolUse payload.
   * PostToolUse must echo it byte-identically or the runtime withholds the
   * result (byte_mismatch, see wire notes).
   */
  const pendingInputs = new Map<string, Record<string, unknown>>();

  const gated = (): boolean => gate?.gated === true && !unprotected;

  pi.on("session_start", async (event, ctx) => {
    gate = captureGate(process.env, ctx.cwd);
    sessionId = ctx.sessionManager.getSessionId();
    if (!gate.gated) return;
    unprotected = false;

    const payload = sessionStartPayload(sessionId, event.reason, ctx.cwd);
    const options = {
      ensureRuntime: true,
      ...(gate.config !== undefined ? { config: gate.config } : {}),
    };
    const notify = (message: string, kind: "info" | "warning"): void => {
      if (ctx.hasUI) ctx.ui.notify(message, kind);
    };
    let outcome = await invokeAppaHook(payload, options);
    let warnedAlready = false;
    // A missing default `appa` is self-provisioned: run the official install
    // script once, then retry bringing the runtime up. Custom APPA_HOOK_BINs
    // are the user's own and never auto-installed.
    if (outcome.binaryMissing && resolveHookBin(process.env) === "appa") {
      notify(
        "`appa` was not found — installing the OpenAPPA runtime " +
          "(https://openappa.com/install.sh)…",
        "info",
      );
      const install = await installAppa();
      if (install.exitCode !== 0) {
        warnedAlready = true;
        notify(
          `OpenAPPA auto-install failed: ${outcomeTail(install)}. ` +
            "Tool calls stay blocked; install `appa` manually (see the README) or run /appa off.",
          "warning",
        );
      } else {
        const retry = await invokeAppaHook(payload, options);
        if (retry.binaryMissing) {
          warnedAlready = true;
          notify(
            "OpenAPPA auto-install finished but `appa` is still not on PATH. " +
              `Installer output: ${outcomeTail(install)} — restart the session once PATH has it.`,
            "warning",
          );
        }
        outcome = retry;
      }
    }
    if (outcome.exitCode !== 0) {
      // No policy anywhere and nothing answering: run this session
      // unprotected with one warning instead of fail-closed (the configured
      // default). A named policy that fails stays fail-closed below.
      if (
        resolveHookBin(process.env) === "appa" &&
        gate.config === undefined &&
        !appaDefaultPolicyExists(process.env) &&
        !(await checkHealth(gate.runtimeUrl)).ok
      ) {
        unprotected = true;
        if (!warnedAlready) {
          notify(
            "OpenAPPA is on by default, but no policy exists (APPA_CONFIG, " +
              ".pi/openappa, or ~/.config/appa/appa.toml) and no runtime answers " +
              `at ${gate.runtimeUrl} — this session runs unprotected. ` +
              "Write a policy, or run /appa off.",
            "warning",
          );
        }
        return;
      }
      if (ctx.hasUI && !warnedAlready) {
      const remedy =
        gate.config === undefined
          ? " Provide a policy (this project's .pi/openappa, APPA_CONFIG, or ~/.config/appa/appa.toml), or run /appa off."
          : "";
      ctx.ui.notify(
        `OpenAPPA gated but the runtime did not answer (${gate.runtimeUrl}): ` +
          `${outcome.stderr.trim() || `exit ${outcome.exitCode}`}.${remedy} ` +
          "Tool calls will be blocked until it answers.",
        "warning",
      );
      }
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!gated()) return;
    // The prompt event establishes the turn boundary; it does not gate.
    await invokeAppaHook(promptPayload(sessionId, event.prompt, ctx.cwd));
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!gated()) return;
    const payload = preToolUsePayload(sessionId, event.toolName, event.input, ctx.cwd);
    const outcome = await invokeAppaHook(payload);
    const decision = parseCallDecision(outcome.exitCode, outcome.stdout, outcome.stderr);
    if (decision.type === "deny") {
      return { block: true, reason: `appa: ${decision.reason}` };
    }
    pendingInputs.set(event.toolCallId, event.input);
    return undefined;
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!gated()) return;
    const sentInput = pendingInputs.get(event.toolCallId);
    pendingInputs.delete(event.toolCallId);
    const response = toolResponseFrom({
      text: joinContent(event.content),
      isError: event.isError,
      details: event.details,
    });
    const payload = postToolUsePayload(
      sessionId,
      event.toolName,
      sentInput ?? event.input,
      response,
      ctx.cwd,
    );
    const outcome = await invokeAppaHook(payload);
    const decision = parseResultDecision(outcome.exitCode, outcome.stdout, outcome.stderr);
    if (decision.type === "pass") {
      return undefined;
    }
    return {
      content: [{ type: "text", text: decision.text } satisfies TextPart],
      isError: decision.isError,
    };
  });

  pi.on("turn_end", async () => {
    if (!gated()) return;
    // Turn completion is reported, never gated (matching --turn-end).
    await invokeAppaHook(stopPayload(sessionId), { turnEnd: true });
  });

  pi.on("session_shutdown", () => {
    pendingInputs.clear();
  });

  pi.registerCommand("appa", {
    description: "Show OpenAPPA status; `appa on|off` toggles protection globally",
    handler: async (args, ctx) => {
      const arg = args.trim();
      if (arg === "on" || arg === "off") {
        setGloballyOff(process.env, arg === "off");
        gate = captureGate(process.env, ctx.cwd);
        if (ctx.hasUI) {
          ctx.ui.notify(
            arg === "on"
              ? "OpenAPPA protection re-enabled: on by default for every session."
              : "OpenAPPA protection disabled globally (/appa on re-enables).",
            "info",
          );
        }
        return;
      }
      const state = gate ?? captureGate(process.env, ctx.cwd);
      const mode =
        state.source === "project"
          ? "project (.pi/openappa)"
          : state.source === "env-on"
            ? "launch (APPA_GATE=1)"
            : state.source === "env-off"
              ? "launch opt-out (APPA_GATE=0)"
              : state.source === "project-off"
                ? "project opt-out (.pi/no-openappa)"
                : state.source === "global-off"
                  ? "global opt-out (/appa on re-enables)"
                  : "on by default (/appa off disables)";
      const lines: string[] = [];
      lines.push(state.gated ? `Protection: ON (session ${sessionId || "not started"})` : `Protection: off — ${mode}`);
      if (unprotected) {
        lines.push("Session: unprotected — no policy found; see the startup warning.");
      }
      if (state.gated && !unprotected) lines.push(`Mode: ${mode}`);
      if (state.config !== undefined) lines.push(`Policy: ${state.config}`);
      lines.push(`Runtime: ${state.runtimeUrl}`);
      const health = await checkHealth(state.runtimeUrl);
      lines.push(`Health: ${health.ok ? "ok" : `unreachable (${health.detail})`}`);
      if (state.gated && !health.ok) {
        lines.push("While the runtime is down, gated tool calls are blocked (fail-closed).");
      }
      const message = lines.join("\n");
      if (ctx.hasUI) {
        ctx.ui.notify(message, health.ok || !state.gated ? "info" : "warning");
      }
    },
  });
}

/** Last ~200 chars of installer output, whitespace-normalized, for notices. */
function outcomeTail(outcome: InstallOutcome): string {
  const text = `${outcome.stderr} ${outcome.stdout}`.trim().replace(/\s+/g, " ");
  if (text === "") return "(no output)";
  return text.length > 200 ? `…${text.slice(-200)}` : text;
}

function joinContent(content: ReadonlyArray<unknown>): string {
  const parts: string[] = [];
  for (const item of content) {
    if (
      typeof item === "object" &&
      item !== null &&
      (item as { type?: unknown }).type === "text"
    ) {
      parts.push(String((item as { text?: unknown }).text ?? ""));
    } else {
      parts.push("[non-text content omitted]");
    }
  }
  return parts.join("\n");
}
