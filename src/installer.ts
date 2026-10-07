/**
 * Auto-installer for the OpenAPPA runtime binary.
 *
 * Runs the official install pipeline through `sh -c` — nothing else. It never
 * decides: the extension wiring owns when an install is appropriate and what
 * to report. The command and timeout honor APPA_INSTALL_CMD and
 * APPA_INSTALL_TIMEOUT_MS so mirrors, offline copies, and slow links work.
 */

import { spawn } from "node:child_process";

export const DEFAULT_INSTALL_CMD = "curl -fsSL https://openappa.com/install.sh | sh";

export interface InstallOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export function resolveInstallCmd(env: NodeJS.ProcessEnv): string {
  const cmd = env.APPA_INSTALL_CMD;
  return cmd !== undefined && cmd !== "" ? cmd : DEFAULT_INSTALL_CMD;
}

export function resolveInstallTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = Number(env.APPA_INSTALL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

export async function installAppa(
  env: NodeJS.ProcessEnv = process.env,
): Promise<InstallOutcome> {
  const timeoutMs = resolveInstallTimeoutMs(env);
  return await new Promise<InstallOutcome>((resolve) => {
    let child;
    try {
      child = spawn("sh", ["-c", resolveInstallCmd(env)], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve(installFailure(error));
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
          stderr: `${stderr}appa install timed out after ${timeoutMs}ms`.trim(),
          timedOut: true,
        });
        return;
      }
      resolve({ exitCode, stdout, stderr, timedOut: false });
    };

    child.on("error", (error) => {
      resolve(mergeOutcome(installFailure(error), stderr));
      settled = true;
      clearTimeout(timer);
    });
    child.on("close", (code) => finish(code ?? -1));
  });
}

function installFailure(error: unknown): InstallOutcome {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    exitCode: -1,
    stdout: "",
    stderr: `appa install failed to start: ${detail}`,
    timedOut: false,
  };
}

function mergeOutcome(base: InstallOutcome, stderrSoFar: string): InstallOutcome {
  return { ...base, stderr: `${stderrSoFar}${base.stderr}`.trim() };
}
