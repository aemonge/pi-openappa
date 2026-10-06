/**
 * Pure translation between host events and the OpenAPPA `appa hook` wire.
 *
 * This module must stay runtime-agnostic: no Pi imports, no I/O. Everything
 * that knows about `appa hook` subprocess semantics lives in hook-client.ts;
 * everything that knows about Pi lives in extensions/index.ts.
 *
 * Wire facts are documented and verified in docs/wire-notes.md (appa 0.31.1).
 */

export type HookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "Stop";

export interface AppaHookPayload {
  session_id: string;
  hook_event_name: HookEventName;
  source?: "startup" | "resume";
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  cwd?: string;
}

/** Decision for a tool call (PreToolUse). */
export type AppaCallDecision =
  | { type: "allow" }
  | { type: "deny"; reason: string };

/** Decision for a tool result (PostToolUse). */
export type AppaResultDecision =
  | { type: "pass" }
  | { type: "replace"; text: string; isError: boolean };

/**
 * Pi built-in tool names → Claude Code policy names. The claude-code codec
 * and battery argument selectors are written against these; custom tools pass
 * through verbatim and policies declare them under the host name.
 */
const TOOL_NAME_MAP: Readonly<Record<string, string>> = {
  bash: "Bash",
  powershell: "PowerShell",
  read: "Read",
  edit: "Edit",
  write: "Write",
  grep: "Grep",
  find: "Glob",
  ls: "LS",
};

export function mapToolName(piName: string): string {
  return TOOL_NAME_MAP[piName] ?? piName;
}

/** pi session_start reason → Claude Code SessionStart source. */
export function mapSessionSource(
  reason: "startup" | "reload" | "new" | "resume" | "fork",
): "startup" | "resume" {
  return reason === "resume" || reason === "fork" || reason === "reload"
    ? "resume"
    : "startup";
}

export function sessionStartPayload(
  sessionId: string,
  reason: "startup" | "reload" | "new" | "resume" | "fork",
  cwd: string,
): AppaHookPayload {
  return {
    session_id: sessionId,
    hook_event_name: "SessionStart",
    source: mapSessionSource(reason),
    cwd,
  };
}

export function promptPayload(
  sessionId: string,
  prompt: string,
  cwd: string,
): AppaHookPayload {
  return {
    session_id: sessionId,
    hook_event_name: "UserPromptSubmit",
    prompt,
    cwd,
  };
}

/**
 * Build the PreToolUse payload. The returned payload's `tool_input` reference
 * must be echoed byte-identically at PostToolUse time: the runtime digests it
 * canonically and withholds results that mismatch (byte_mismatch). Callers
 * must keep the exact `input` object they passed here until the call settles.
 */
export function preToolUsePayload(
  sessionId: string,
  piToolName: string,
  input: Record<string, unknown>,
  cwd: string,
): AppaHookPayload {
  return {
    session_id: sessionId,
    hook_event_name: "PreToolUse",
    tool_name: mapToolName(piToolName),
    tool_input: input,
    cwd,
  };
}

/**
 * Build the PostToolUse payload. `input` MUST be the exact object previously
 * passed to preToolUsePayload for this call (see its doc comment).
 */
export function postToolUsePayload(
  sessionId: string,
  piToolName: string,
  input: Record<string, unknown>,
  response: Record<string, unknown>,
  cwd: string,
): AppaHookPayload {
  return {
    session_id: sessionId,
    hook_event_name: "PostToolUse",
    tool_name: mapToolName(piToolName),
    tool_input: input,
    tool_response: response,
    cwd,
  };
}

export function stopPayload(sessionId: string): AppaHookPayload {
  return { session_id: sessionId, hook_event_name: "Stop" };
}

/**
 * Host tool result → Claude-Code-shaped `tool_response`. Structured fields are
 * copied when the host provides them; every result also carries the joined
 * text and error flag so unknown tools stay observable.
 */
export function toolResponseFrom(parts: {
  text?: string;
  isError?: boolean;
  details?: unknown;
}): Record<string, unknown> {
  const response: Record<string, unknown> = {
    output: parts.text ?? "",
    isError: parts.isError === true,
  };
  if (isRecord(parts.details)) {
    for (const key of ["stdout", "stderr", "exitcode", "interrupted"] as const) {
      const value = parts.details[key];
      if (value !== undefined) response[key] = value;
    }
  }
  return response;
}

/** Render a runtime-supplied `updatedToolOutput` as model-facing text. */
export function renderToolOutput(output: Record<string, unknown>): string {
  const stdout = typeof output.stdout === "string" ? output.stdout : undefined;
  const stderr = typeof output.stderr === "string" ? output.stderr : undefined;
  if (stdout !== undefined || stderr !== undefined) {
    const parts: string[] = [];
    if (stdout !== undefined && stdout !== "") parts.push(stdout);
    if (stderr !== undefined && stderr !== "") parts.push(stderr);
    if (parts.length > 0) return parts.join("\n");
  }
  return JSON.stringify(output, null, 2);
}

const BLOCKED_PREFIX = "OpenAPPA hook blocked: ";

function reasonFromStderr(stderr: string): string {
  const trimmed = stderr.trim();
  if (trimmed.startsWith(BLOCKED_PREFIX)) {
    return trimmed.slice(BLOCKED_PREFIX.length);
  }
  return trimmed;
}

interface StdoutDecision {
  permissionDecision?: string;
  permissionDecisionReason?: string;
  decision?: string;
  reason?: string;
  error?: string;
  hookSpecificOutput?: {
    hookEventName?: string;
    permissionDecision?: string;
    permissionDecisionReason?: string;
    updatedToolOutput?: Record<string, unknown>;
  };
}

function parseStdout(stdout: string): StdoutDecision | undefined {
  const text = stdout.trim();
  if (text === "" || text === "{}") return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? (parsed as StdoutDecision) : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Map a finished `appa hook` invocation for a PreToolUse event to a call
 * decision. Fail-closed: every unrecognized outcome denies.
 */
export function parseCallDecision(
  exitCode: number,
  stdout: string,
  stderr: string,
): AppaCallDecision {
  const out = parseStdout(stdout);
  if (exitCode === 0 && out === undefined) return { type: "allow" };
  if (out?.error !== undefined && exitCode !== 0) {
    return { type: "deny", reason: String(out.error) };
  }
  const permission = out?.hookSpecificOutput?.permissionDecision ?? out?.permissionDecision;
  if (permission === "deny") {
    return {
      type: "deny",
      reason:
        out?.hookSpecificOutput?.permissionDecisionReason ??
        out?.permissionDecisionReason ??
        out?.reason ??
        "denied by APPA policy",
    };
  }
  if (out?.decision === "block" || out?.decision === "deny_call") {
    return { type: "deny", reason: out?.reason ?? "blocked by APPA policy" };
  }
  if (exitCode === 0 && (permission === "allow" || permission === undefined)) {
    if (out?.decision !== undefined && out.decision !== "allow") {
      // A decision we do not understand is treated as a denial, not a pass.
      return {
        type: "deny",
        reason: out?.reason ?? `unrecognized APPA decision: ${out.decision}`,
      };
    }
    return { type: "allow" };
  }
  return {
    type: "deny",
    reason: reasonFromStderr(stderr) || `appa hook exited ${exitCode}`,
  };
}

/**
 * Map a finished `appa hook` invocation for a PostToolUse event to a result
 * decision. The runtime replaces results through `updatedToolOutput`; exit 2
 * or an unreadable outcome withholds the result (isError) rather than passing
 * possibly-unauthorized content through.
 */
export function parseResultDecision(
  exitCode: number,
  stdout: string,
  stderr: string,
): AppaResultDecision {
  const out = parseStdout(stdout);
  const updated = out?.hookSpecificOutput?.updatedToolOutput;
  if (exitCode === 0 && isRecord(updated)) {
    return { type: "replace", text: renderToolOutput(updated), isError: false };
  }
  if (exitCode === 0 && (out === undefined || out.decision === undefined || out.decision === "allow")) {
    return { type: "pass" };
  }
  const reason =
    out?.reason ??
    (out?.error !== undefined ? String(out.error) : undefined) ??
    reasonFromStderr(stderr) ??
    (exitCode === 0 ? "tool result withheld by APPA policy" : `appa hook exited ${exitCode}`);
  return { type: "replace", text: reason, isError: true };
}
