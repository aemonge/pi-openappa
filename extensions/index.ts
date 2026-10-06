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
import { invokeAppaHook } from "../src/hook-client.ts";
import { captureGate, checkHealth, type GateState } from "../src/gate.ts";

interface TextPart {
  type: "text";
  text: string;
}

export default function (pi: ExtensionAPI): void {
  /** Launch-fixed protection state; null until the session starts. */
  let gate: GateState | null = null;
  let sessionId = "";
  /**
   * toolCallId → the exact `input` object sent in the PreToolUse payload.
   * PostToolUse must echo it byte-identically or the runtime withholds the
   * result (byte_mismatch, see wire notes).
   */
  const pendingInputs = new Map<string, Record<string, unknown>>();

  const gated = (): boolean => gate?.gated === true;

  pi.on("session_start", async (event, ctx) => {
    gate = captureGate(process.env);
    sessionId = ctx.sessionManager.getSessionId();
    if (!gated()) return;

    const outcome = await invokeAppaHook(
      sessionStartPayload(sessionId, event.reason, ctx.cwd),
    );
    if (outcome.exitCode !== 0 && ctx.hasUI) {
      ctx.ui.notify(
        `OpenAPPA gated but the runtime did not answer (${gate.runtimeUrl}): ` +
          `${outcome.stderr.trim() || `exit ${outcome.exitCode}`}. ` +
          "Tool calls will be blocked until it answers.",
        "warning",
      );
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
    description: "Show OpenAPPA protection status and runtime health",
    handler: async (_args, ctx) => {
      const state = gate ?? captureGate(process.env);
      const lines: string[] = [];
      lines.push(
        state.gated
          ? `Protection: ON (session ${sessionId || "not started"})`
          : "Protection: off — start Pi with APPA_GATE=1 to protect a session",
      );
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
