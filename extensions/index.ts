/**
 * pi-openappa — Pi extension wiring for OpenAPPA.
 *
 * Thin by design: translate Pi events to `appa hook` invocations and enforce
 * the answer. No policy logic lives here; the APPA runtime owns every
 * decision. Protection is ON by default (opt out with APPA_GATE=0, a project
 * `.pi/no-openappa` marker, or `/appa off`) and fail-closed while gated: if
 * the runtime cannot answer, the call is blocked. A missing `appa` binary
 * self-installs once on the background lane; a first run with no policy
 * anywhere and no runtime runs the session unprotected with one warning.
 *
 * Wire facts and constraints: docs/wire-notes.md
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { invokeAppaHook, resolveHookBin } from "../src/hook-client.ts";
import type { InvokeOptions } from "../src/hook-client.ts";
import { installAppa, type InstallOutcome } from "../src/installer.ts";
import {
  appaDefaultConfigPath,
  appaDefaultPolicyExists,
  captureGate,
  checkHealth,
  setGloballyOff,
  settingsPath,
  type GateState,
} from "../src/gate.ts";

interface TextPart {
  type: "text";
  text: string;
}

/** The starter policy `/appa init` writes (templates/appa.toml in this package). */
function templateToml(): string {
  return readFileSync(
    fileURLToPath(new URL("../templates/appa.toml", import.meta.url)),
    "utf8",
  );
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

  /**
   * Serialized hook lane. Every `appa hook` invocation for this session runs
   * through here in order, so the SessionStart payload (with
   * `--ensure-runtime`) always lands before the first PreToolUse even though
   * session_start does not wait for it. Startup stays off the fast-start
   * lane: the runtime boot — and a first run's auto-install — is paid by
   * whichever tool call needs the runtime first, and a runtime that cannot
   * answer fails that call closed with the reason — never a slower session
   * start.
   */
  let lane: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
    const outcome = lane.then(run, run);
    lane = outcome.then(
      () => undefined,
      () => undefined,
    );
    return outcome;
  };

  const gated = (): boolean => gate?.gated === true && !unprotected;

  const hookOptions = (state: GateState, extra: InvokeOptions = {}): InvokeOptions => {
    const options: InvokeOptions = { ...extra };
    if (state.hookTimeoutMs !== undefined) options.timeoutMs = state.hookTimeoutMs;
    return options;
  };

  pi.on("session_start", async (event, ctx) => {
    gate = captureGate(process.env, ctx.cwd);
    sessionId = ctx.sessionManager.getSessionId();
    if (!gate.gated) return;
    unprotected = false;
    const state = gate;
    const options: InvokeOptions = { ensureRuntime: true };
    if (state.config !== undefined) options.config = state.config;
    if (state.hookTimeoutMs !== undefined) options.timeoutMs = state.hookTimeoutMs;
    // Backgrounded on purpose (see `lane`): a cold runtime boot — or a first
    // run that still has to install the runtime — must not sit in Pi's
    // session-start path. Auto-install, the retry, and the first-run
    // unprotected decision all run serialized on the lane; failure surfaces
    // as a warning when it settles.
    void enqueue(async () => {
      const notify = (message: string, kind: "info" | "warning"): void => {
        if (ctx.hasUI) ctx.ui.notify(message, kind);
      };
      const payload = sessionStartPayload(sessionId, event.reason, ctx.cwd);
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
          state.config === undefined &&
          !appaDefaultPolicyExists(process.env) &&
          !(await checkHealth(state.runtimeUrl)).ok
        ) {
          unprotected = true;
          if (!warnedAlready) {
            notify(
              "OpenAPPA is on by default, but no policy exists (run /appa init, " +
                "or set APPA_CONFIG, .pi/openappa, or ~/.config/appa/appa.toml) and no runtime answers " +
                `at ${state.runtimeUrl} — this session runs unprotected. ` +
                "Write a policy, or run /appa off.",
              "warning",
            );
          }
          return;
        }
        if (ctx.hasUI && !warnedAlready) {
          const remedy =
            state.config === undefined
              ? " Provide a policy (this project's .pi/openappa, /appa init, APPA_CONFIG, or ~/.config/appa/appa.toml), or run /appa off."
              : "";
          ctx.ui.notify(
            `OpenAPPA gated but the runtime did not answer (${state.runtimeUrl}): ` +
              `${outcome.stderr.trim() || `exit ${outcome.exitCode}`}.${remedy} ` +
              "Tool calls will be blocked until it answers.",
            "warning",
          );
        }
      }
    });
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!gated()) return;
    // The prompt event establishes the turn boundary; it does not gate.
    await enqueue(() =>
      invokeAppaHook(promptPayload(sessionId, event.prompt, ctx.cwd), hookOptions(gate!)),
    );
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!gated()) return;
    const payload = preToolUsePayload(sessionId, event.toolName, event.input, ctx.cwd);
    const outcome = await enqueue(() =>
      invokeAppaHook(payload, hookOptions(gate!)),
    );
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
    const outcome = await enqueue(() =>
      invokeAppaHook(payload, hookOptions(gate!)),
    );
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
    await enqueue(() =>
      invokeAppaHook(stopPayload(sessionId), hookOptions(gate!, { turnEnd: true })),
    );
  });

  pi.on("session_shutdown", () => {
    pendingInputs.clear();
  });

  pi.registerCommand("appa", {
    description:
      "OpenAPPA guard: status, `appa on|off` global toggle, `appa init [project]` writes a starter policy",
    getArgumentCompletions: (argumentPrefix) => {
      const items = [
        {
          value: "on",
          label: "on",
          description: "Re-enable default-on protection for every session",
        },
        { value: "off", label: "off", description: "Disable protection globally (/appa on re-enables)" },
        {
          value: "init",
          label: "init",
          description: "Write the starter policy to ~/.config/appa/appa.toml",
        },
        {
          value: "init project",
          label: "init project",
          description: "Write ./appa.toml plus the .pi/openappa project marker",
        },
        { value: "status", label: "status", description: "Show protection and runtime health" },
      ];
      const prefix = argumentPrefix.trim();
      const hits = prefix === "" ? items : items.filter((item) => item.value.startsWith(prefix));
      return hits.length > 0 ? hits : null;
    },
    handler: async (args, ctx) => {
      const tokens = args.trim().split(/\s+/).filter((token) => token !== "");
      const arg = tokens[0] ?? "";

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

      if (arg === "init") {
        const scope = tokens[1] === "project" ? "project" : "user";
        const force = tokens.includes("--force");
        await runInit(scope, force, ctx);
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

  /** `/appa init` — write the starter policy (and settings) without clobbering. */
  async function runInit(
    scope: "user" | "project",
    force: boolean,
    ctx: { cwd: string; hasUI: boolean; ui: { notify: (message: string, type?: "info" | "warning" | "error") => void } },
  ): Promise<void> {
    const notify = (message: string, type: "info" | "warning" | "error" = "info") => {
      if (ctx.hasUI) ctx.ui.notify(message, type);
    };
    try {
      if (scope === "project") {
        const policy = join(ctx.cwd, "appa.toml");
        const marker = join(ctx.cwd, ".pi", "openappa");
        if (existsSync(policy) && !force) {
          notify(`${policy} already exists; rerun with --force to overwrite it.`, "warning");
          return;
        }
        mkdirSync(dirname(policy), { recursive: true });
        writeFileSync(policy, templateToml());
        if (!existsSync(marker)) {
          mkdirSync(dirname(marker), { recursive: true });
          writeFileSync(marker, "appa.toml\n");
        }
        notify(
          `Wrote ${policy} and the .pi/openappa marker. Sessions started in this directory are protected; new sessions pick the policy up (trajectories keep the policy they opened with).`,
        );
        return;
      }
      const policy = appaDefaultConfigPath(process.env);
      if (existsSync(policy) && !force) {
        notify(
          `${policy} already exists; rerun with --force to overwrite it, or /appa init project for one project.`,
          "warning",
        );
        return;
      }
      mkdirSync(dirname(policy), { recursive: true });
      writeFileSync(policy, templateToml());
      const settings = settingsPath(process.env);
      const lines: string[] = [`Wrote the starter policy to ${policy}.`];
      if (!existsSync(settings)) {
        mkdirSync(dirname(settings), { recursive: true });
        writeFileSync(settings, `${JSON.stringify({ config: policy }, null, 2)}\n`);
        lines.push(`Wrote ${settings} pointing at it.`);
      }
      lines.push("Protection is on by default; /appa off disables it, /appa init project scopes a policy to one project.");
      notify(lines.join(" "));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      notify(`/appa init failed: ${detail}`, "error");
    }
  }
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
