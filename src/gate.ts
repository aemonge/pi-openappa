/**
 * Session gate: protection is opt-in, fixed at session start.
 *
 * OpenAPPA's model: hooks are inert until a session opts in with APPA_GATE=1
 * (set by a launcher like `clappa`), and the value is fixed at launch so a
 * session cannot disable its own protection mid-run. We mirror both halves:
 * the gate is captured once per session and never re-read from the live
 * environment afterwards.
 */

export const DEFAULT_RUNTIME_URL = "http://127.0.0.1:8787";

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
    gated: env.APPA_GATE === "1",
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
