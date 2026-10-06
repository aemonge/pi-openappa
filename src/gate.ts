/**
 * Session gate: protection is opt-in, fixed at session start.
 *
 * Three ways a session becomes protected, most specific first for reporting:
 * - a project marker `<cwd>/.pi/openappa` (project-scoped; optional content
 *   names that project's policy, absolute or cwd-relative),
 * - launched with APPA_GATE=1 (the launcher route, mirroring `clappa`), or
 * - always-on mode, persisted by `/appa on` (marker file below).
 *
 * An explicit APPA_CONFIG always wins as the policy source; otherwise a
 * project marker's content is used; otherwise APPA's own default. The gate is
 * captured once per session so a session cannot disable its own protection
 * mid-run; `/appa on|off` are deliberate user commands and do re-resolve.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

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

export function projectMarkerPath(cwd: string): string {
  return join(cwd, ".pi", "openappa");
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

export type GateSource = "project" | "env" | "always-on" | "off";

export interface GateState {
  /** Protection active for this session. */
  gated: boolean;
  /** Most specific reason this session is (or is not) protected. */
  source: GateSource;
  /** Policy for auto-start: explicit env wins, then project marker content. */
  config?: string;
  /** Runtime URL for health reporting (the hook binary reads it from env). */
  runtimeUrl: string;
  /** Hook binary used for reporting. */
  hookBin: string;
}

/** Read a project marker's optional policy path; empty content resolves to none. */
function projectConfig(cwd: string): string | undefined {
  try {
    const content = readFileSync(projectMarkerPath(cwd), "utf8").trim();
    if (content === "") return undefined;
    return isAbsolute(content) ? content : resolve(cwd, content);
  } catch {
    return undefined;
  }
}

export function captureGate(env: NodeJS.ProcessEnv, cwd?: string): GateState {
  const base = {
    runtimeUrl: env.APPA_RUNTIME_URL ?? DEFAULT_RUNTIME_URL,
    hookBin: env.APPA_HOOK_BIN ?? "appa",
  };
  const explicitConfig =
    env.APPA_CONFIG !== undefined && env.APPA_CONFIG !== ""
      ? env.APPA_CONFIG
      : undefined;
  const projectGated = cwd !== undefined && existsSync(projectMarkerPath(cwd));
  const projectCfg =
    projectGated && cwd !== undefined ? projectConfig(cwd) : undefined;
  const config = explicitConfig ?? projectCfg;

  if (env.APPA_GATE === "1" || projectGated) {
    return {
      gated: true,
      source: projectGated ? "project" : "env",
      ...base,
      ...(config !== undefined ? { config } : {}),
    };
  }
  if (isAlwaysOn(env)) {
    return {
      gated: true,
      source: "always-on",
      ...base,
      ...(explicitConfig !== undefined ? { config: explicitConfig } : {}),
    };
  }
  return { gated: false, source: "off", ...base };
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
