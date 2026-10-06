/**
 * Session gate: protection is opt-in, fixed at session start.
 *
 * Two ways a session becomes protected:
 * - launched with APPA_GATE=1 (the launcher route, mirroring `clappa`), or
 * - always-on mode, persisted by `/appa on` (marker file below).
 *
 * The env value is captured once per session so a session cannot disable its
 * own protection mid-run; `/appa on|off` are deliberate user commands and do
 * re-resolve for the current session.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const DEFAULT_RUNTIME_URL = "http://127.0.0.1:8787";

/** Base config directory honoring XDG_CONFIG_HOME, falling back to ~/.config. */
function baseConfigDir(env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg !== undefined && xdg !== "") return xdg;
  return join(env.HOME ?? "", ".config");
}

export function alwaysOnMarkerPath(env: NodeJS.ProcessEnv): string {
  return join(baseConfigDir(env), "pi-openappa", "always-on");
}

export function isAlwaysOn(env: NodeJS.ProcessEnv): boolean {
  return existsSync(alwaysOnMarkerPath(env));
}

export function setAlwaysOn(env: NodeJS.ProcessEnv, on: boolean): void {
  const marker = alwaysOnMarkerPath(env);
  if (on) {
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, "");
  } else {
    rmSync(marker, { force: true });
  }
}

export interface GateState {
  /** Protection active for this session. */
  gated: boolean;
  /** Runtime URL for health reporting (the hook binary reads it from env). */
  runtimeUrl: string;
  /** Hook binary used for reporting. */
  hookBin: string;
}

export function captureGate(env: NodeJS.ProcessEnv): GateState {
  return {
    gated: env.APPA_GATE === "1" || isAlwaysOn(env),
    runtimeUrl: env.APPA_RUNTIME_URL ?? DEFAULT_RUNTIME_URL,
    hookBin: env.APPA_HOOK_BIN ?? "appa",
  };
}

export interface HealthResult {
  ok: boolean;
  detail: string;
}

export async function checkHealth(
  runtimeUrl: string,
  timeoutMs = 2000,
): Promise<HealthResult> {
  try {
    const response = await fetch(new URL("health", withSlash(runtimeUrl)), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await response.text()).trim();
    if (response.ok && body === "ok") {
      return { ok: true, detail: "ok" };
    }
    return { ok: false, detail: body !== "" ? body : `HTTP ${response.status}` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, detail };
  }
}

function withSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}
