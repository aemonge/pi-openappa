/**
 * Session gate: protection is ON by default and fixed at session start.
 *
 * Opt-outs, most specific first:
 * - APPA_GATE=1 / APPA_GATE=0 force on/off for one launch,
 * - a project opt-out marker `<cwd>/.pi/no-openappa`,
 * - a project marker `<cwd>/.pi/openappa` (which also names that project's
 *   policy, absolute or cwd-relative),
 * - the global `/appa off` marker below; `/appa on` clears it.
 * Otherwise the session is protected (the default).
 *
 * An explicit APPA_CONFIG always wins as the policy source; otherwise a
 * project marker's content is used; otherwise the settings file's `config`;
 * otherwise APPA's own default. The gate is
 * captured once per session so a session cannot disable its own protection
 * mid-run; `/appa on|off` are deliberate user commands and do re-resolve.
 * The legacy `always-on` marker from opt-in days is ignored; `/appa on`
 * removes it.
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

/** Global opt-out written by `/appa off`; `/appa on` removes it. */
export function globalOffMarkerPath(env: NodeJS.ProcessEnv): string {
  return join(baseConfigDir(env), "pi-openappa", "off");
}

/** Legacy opt-in marker from before default-on; ignored, cleared by `/appa on`. */
export function legacyAlwaysOnMarkerPath(env: NodeJS.ProcessEnv): string {
  return join(baseConfigDir(env), "pi-openappa", "always-on");
}

/** The policy a gated session auto-starts the runtime with, by APPA default. */
export function appaDefaultConfigPath(env: NodeJS.ProcessEnv): string {
  return join(baseConfigDir(env), "appa", "appa.toml");
}

/** File-backed settings for this extension (see `ExtensionSettings`). */
export function settingsPath(env: NodeJS.ProcessEnv): string {
  return join(baseConfigDir(env), "pi-openappa", "settings.json");
}

/**
 * Keys read from `settings.json`. Every key is optional; environment
 * variables of the same meaning always win over the file, and the file
 * always wins over the built-in defaults. Written by `/appa init`.
 */
export interface ExtensionSettings {
  /** Policy path passed as `--config` (the APPA_CONFIG fallback). */
  config?: string;
  /** Runtime endpoint (the APPA_RUNTIME_URL fallback). */
  runtimeUrl?: string;
  /** Hook binary (the APPA_HOOK_BIN fallback). */
  hookBin?: string;
  /** Hook timeout in ms (the APPA_HOOK_TIMEOUT_MS fallback). */
  hookTimeoutMs?: number;
}

/** Read settings.json; a missing or malformed file resolves to `{}`. */
export function readSettings(env: NodeJS.ProcessEnv): ExtensionSettings {
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath(env), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const out: ExtensionSettings = {};
    const record = parsed as Record<string, unknown>;
    for (const key of ["config", "runtimeUrl", "hookBin"] as const) {
      const value = record[key];
      if (typeof value === "string" && value !== "") out[key] = value;
    }
    const timeout = record["hookTimeoutMs"];
    if (typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0) {
      out.hookTimeoutMs = timeout;
    }
    return out;
  } catch {
    return {};
  }
}

export function projectMarkerPath(cwd: string): string {
  return join(cwd, ".pi", "openappa");
}

export function projectNoMarkerPath(cwd: string): string {
  return join(cwd, ".pi", "no-openappa");
}

export function isGloballyOff(env: NodeJS.ProcessEnv): boolean {
  return existsSync(globalOffMarkerPath(env));
}

export function setGloballyOff(env: NodeJS.ProcessEnv, off: boolean): void {
  const marker = globalOffMarkerPath(env);
  if (off) {
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, "");
  } else {
    rmSync(marker, { force: true });
    rmSync(legacyAlwaysOnMarkerPath(env), { force: true });
  }
}

/**
 * Does APPA's own default policy exist? Heuristic mirror of the runtime's
 * lookup: `$XDG_CONFIG_HOME/appa/appa.toml` or `~/.config/appa/appa.toml`.
 */
export function appaDefaultPolicyExists(env: NodeJS.ProcessEnv): boolean {
  const xdg = env.XDG_CONFIG_HOME;
  const candidates = [
    ...(xdg !== undefined && xdg !== "" ? [join(xdg, "appa", "appa.toml")] : []),
    join(env.HOME ?? "", ".config", "appa", "appa.toml"),
  ];
  return candidates.some((candidate) => existsSync(candidate));
}

export type GateSource =
  | "env-on"
  | "env-off"
  | "project"
  | "project-off"
  | "global-off"
  | "default";

export interface GateState {
  /** Protection active for this session. */
  gated: boolean;
  /** Most specific reason this session is (or is not) protected. */
  source: GateSource;
  /** Policy for auto-start: env, then project marker, then settings file. */
  config?: string;
  /** Runtime URL for health reporting (the hook binary reads it from env). */
  runtimeUrl: string;
  /** Hook binary used for reporting. */
  hookBin: string;
  /** Hook timeout in ms when settings pin one; otherwise the default applies. */
  hookTimeoutMs?: number;
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
  const settings = readSettings(env);
  const base = {
    runtimeUrl: env.APPA_RUNTIME_URL ?? settings.runtimeUrl ?? DEFAULT_RUNTIME_URL,
    hookBin: env.APPA_HOOK_BIN ?? settings.hookBin ?? "appa",
    ...(settings.hookTimeoutMs !== undefined ? { hookTimeoutMs: settings.hookTimeoutMs } : {}),
  };
  const explicitConfig =
    env.APPA_CONFIG !== undefined && env.APPA_CONFIG !== ""
      ? env.APPA_CONFIG
      : undefined;
  const projectGated = cwd !== undefined && existsSync(projectMarkerPath(cwd));
  const projectOff = cwd !== undefined && existsSync(projectNoMarkerPath(cwd));
  const projectCfg =
    projectGated && cwd !== undefined ? projectConfig(cwd) : undefined;
  // Precedence: launch env, then the project marker (per-project intent),
  // then the global settings file (see readSettings).
  const config = explicitConfig ?? projectCfg ?? settings.config;

  // An explicit launch choice beats every marker.
  if (env.APPA_GATE === "1") {
    return {
      gated: true,
      source: "env-on",
      ...base,
      ...(config !== undefined ? { config } : {}),
    };
  }
  if (env.APPA_GATE === "0") {
    return { gated: false, source: "env-off", ...base };
  }
  // Project level: an opt-out beats the project's own opt-in.
  if (projectOff) {
    return { gated: false, source: "project-off", ...base };
  }
  if (projectGated) {
    return {
      gated: true,
      source: "project",
      ...base,
      ...(config !== undefined ? { config } : {}),
    };
  }
  // Global opt-out, then the default: protection on.
  if (isGloballyOff(env)) {
    return { gated: false, source: "global-off", ...base };
  }
  return {
    gated: true,
    source: "default",
    ...base,
    ...(config !== undefined ? { config } : {}),
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
