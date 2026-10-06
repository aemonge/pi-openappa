/**
 * The only module that talks to OpenAPPA: it runs `appa hook` and returns the
 * raw outcome. It never decides — adapter.ts interprets, extensions wire.
 *
 * Design rules:
 * - Never throw for policy or transport outcomes; every failure becomes a
 *   HookOutcome the decision parsers treat as fail-closed.
 * - Gate and URL come from the inherited environment (APPA_GATE is checked by
 *   the gate module before any invocation happens; APPA_RUNTIME_URL and other
 *   APPA_* conventions flow straight through to the binary).
 */

import { spawn } from "node:child_process";
import type { AppaHookPayload } from "./adapter.ts";

export interface HookOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface InvokeOptions {
  /** Report a finished turn (non-blocking `--turn-end`). */
  turnEnd?: boolean;
  /** Override for the `appa` binary; defaults to APPA_HOOK_BIN or "appa". */
  bin?: string;
  /** Kill the hook after this many ms; defaults to APPA_HOOK_TIMEOUT_MS or 15000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function resolveHookBin(env: NodeJS.ProcessEnv): string {
  return env.APPA_HOOK_BIN ?? "appa";
}

export function resolveTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = Number(env.APPA_HOOK_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

export async function invokeAppaHook(
  payload: AppaHookPayload,
  options: InvokeOptions = {},
): Promise<HookOutcome> {
  const bin = options.bin ?? resolveHookBin(process.env);
  const timeoutMs = options.timeoutMs ?? resolveTimeoutMs(process.env);
  const args = options.turnEnd === true ? ["hook", "--turn-end"] : ["hook"];

  return await new Promise<HookOutcome>((resolve) => {
    let child;
    try {
      child = spawn(bin, args, {
        env: { ...process.env, APPA_GATE: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolve(spawnFailure(error));
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          exitCode: -1,
          stdout,
          stderr: `${stderr}appa hook timed out after ${timeoutMs}ms`.trim(),
          timedOut: true,
        });
        return;
      }
      resolve({ exitCode, stdout, stderr, timedOut: false });
    };

    child.on("error", (error) => {
      resolve(mergeOutcome(spawnFailure(error), stderr));
      settled = true;
      clearTimeout(timer);
    });
    child.on("close", (code) => finish(code ?? -1));

    try {
      child.stdin?.end(JSON.stringify(payload));
    } catch (error) {
      child.kill("SIGKILL");
      resolve(mergeOutcome(spawnFailure(error), stderr));
      settled = true;
      clearTimeout(timer);
    }
  });
}

function spawnFailure(error: unknown): HookOutcome {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    exitCode: -1,
    stdout: "",
    stderr: `appa hook failed to start: ${detail}`,
    timedOut: false,
  };
}

function mergeOutcome(base: HookOutcome, stderrSoFar: string): HookOutcome {
  return { ...base, stderr: `${stderrSoFar}${base.stderr}`.trim() };
}
