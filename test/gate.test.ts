import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appaDefaultPolicyExists,
  captureGate,
  globalOffMarkerPath,
  legacyAlwaysOnMarkerPath,
} from "../src/gate.ts";

/** Environment keys this suite mutates; restored after every test. */
const KEYS = ["APPA_GATE", "APPA_CONFIG", "XDG_CONFIG_HOME", "HOME"];
const saved: Record<string, string | undefined> = {};
for (const key of KEYS) saved[key] = process.env[key];

after(() => {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const workDirs: string[] = [];
after(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

/** Fresh env with isolated HOME/XDG (no markers, no default policy) + project dir. */
function fresh(): { env: Record<string, string>; proj: string } {
  const dir = mkdtempSync(join(tmpdir(), "pi-openappa-gate-"));
  workDirs.push(dir);
  return {
    env: { HOME: join(dir, "home"), XDG_CONFIG_HOME: join(dir, "xdg") },
    proj: join(dir, "proj"),
  };
}

function projectMarker(env: Record<string, string>, proj: string, content = ""): void {
  mkdirSync(join(proj, ".pi"), { recursive: true });
  writeFileSync(join(proj, ".pi", "openappa"), content);
}

describe("default-on gate resolution", () => {
  it("is gated by default with no markers or env", () => {
    const { env, proj } = fresh();
    const state = captureGate(env, proj);
    assert.equal(state.gated, true);
    assert.equal(state.source, "default");
    assert.equal(state.config, undefined);
  });

  it("APPA_GATE=0 opts out for one launch; APPA_GATE=1 forces on", () => {
    const { env, proj } = fresh();
    env.APPA_GATE = "0";
    assert.equal(captureGate(env, proj).source, "env-off");
    env.APPA_GATE = "1";
    const on = captureGate(env, proj);
    assert.equal(on.gated, true);
    assert.equal(on.source, "env-on");
  });

  it("an explicit launch choice beats every project marker", () => {
    const { env, proj } = fresh();
    projectMarker(env, proj, "appa.toml");
    mkdirSync(join(proj, ".pi"), { recursive: true });
    writeFileSync(join(proj, ".pi", "no-openappa"), "");
    env.APPA_GATE = "1";
    assert.equal(captureGate(env, proj).source, "env-on");
    env.APPA_GATE = "0";
    assert.equal(captureGate(env, proj).source, "env-off");
  });

  it(".pi/openappa gates the project and names its policy", () => {
    const { env, proj } = fresh();
    projectMarker(env, proj, "appa.toml\n");
    const state = captureGate(env, proj);
    assert.equal(state.gated, true);
    assert.equal(state.source, "project");
    assert.equal(state.config, join(proj, "appa.toml"));
  });

  it(".pi/no-openappa opts the project out, beating .pi/openappa", () => {
    const { env, proj } = fresh();
    projectMarker(env, proj, "appa.toml");
    writeFileSync(join(proj, ".pi", "no-openappa"), "");
    const state = captureGate(env, proj);
    assert.equal(state.gated, false);
    assert.equal(state.source, "project-off");
  });

  it("the /appa off marker opts out globally; APPA_CONFIG still names a policy", () => {
    const { env, proj } = fresh();
    mkdirSync(join(env.XDG_CONFIG_HOME!, "pi-openappa"), { recursive: true });
    writeFileSync(globalOffMarkerPath(env), "");
    const state = captureGate(env, proj);
    assert.equal(state.gated, false);
    assert.equal(state.source, "global-off");
    env.APPA_CONFIG = "/tmp/policy.toml";
    env.APPA_GATE = "1";
    assert.equal(captureGate(env, proj).config, "/tmp/policy.toml");
  });

  it("ignores the legacy always-on marker (default is already on)", () => {
    const { env, proj } = fresh();
    mkdirSync(join(env.XDG_CONFIG_HOME!, "pi-openappa"), { recursive: true });
    writeFileSync(legacyAlwaysOnMarkerPath(env), "");
    assert.equal(captureGate(env, proj).source, "default");
  });
});

describe("appaDefaultPolicyExists heuristic", () => {
  it("finds nothing in a clean environment", () => {
    const { env } = fresh();
    assert.equal(appaDefaultPolicyExists(env), false);
  });

  it("finds ~/.config/appa/appa.toml and the XDG equivalent", () => {
    const home = fresh();
    mkdirSync(join(home.env.HOME!, ".config", "appa"), { recursive: true });
    writeFileSync(join(home.env.HOME!, ".config", "appa", "appa.toml"), "");
    assert.equal(appaDefaultPolicyExists(home.env), true);

    const xdg = fresh();
    mkdirSync(join(xdg.env.XDG_CONFIG_HOME!, "appa"), { recursive: true });
    writeFileSync(join(xdg.env.XDG_CONFIG_HOME!, "appa", "appa.toml"), "");
    assert.equal(appaDefaultPolicyExists(xdg.env), true);
  });
});
