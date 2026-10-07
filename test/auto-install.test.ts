import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { sessionStartPayload } from "../src/adapter.ts";
import { invokeAppaHook } from "../src/hook-client.ts";
import {
  DEFAULT_INSTALL_CMD,
  installAppa,
  resolveInstallCmd,
  resolveInstallTimeoutMs,
} from "../src/installer.ts";

/** Environment keys this suite mutates; restored after every test. */
const KEYS = ["APPA_INSTALL_CMD", "APPA_INSTALL_TIMEOUT_MS"];
const saved: Record<string, string | undefined> = {};
for (const key of KEYS) saved[key] = process.env[key];

after(() => {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("installer resolution", () => {
  it("defaults to the official install pipeline", () => {
    delete process.env.APPA_INSTALL_CMD;
    assert.equal(resolveInstallCmd(process.env), DEFAULT_INSTALL_CMD);
    assert.equal(DEFAULT_INSTALL_CMD, "curl -fsSL https://openappa.com/install.sh | sh");
  });

  it("honors APPA_INSTALL_CMD", () => {
    process.env.APPA_INSTALL_CMD = "./offline-install.sh";
    assert.equal(resolveInstallCmd(process.env), "./offline-install.sh");
  });

  it("honors APPA_INSTALL_TIMEOUT_MS with a sane default", () => {
    delete process.env.APPA_INSTALL_TIMEOUT_MS;
    assert.equal(resolveInstallTimeoutMs(process.env), 120_000);
    process.env.APPA_INSTALL_TIMEOUT_MS = "2500";
    assert.equal(resolveInstallTimeoutMs(process.env), 2500);
    process.env.APPA_INSTALL_TIMEOUT_MS = "garbage";
    assert.equal(resolveInstallTimeoutMs(process.env), 120_000);
  });
});

describe("installer run", () => {
  it("captures a successful install", async () => {
    process.env.APPA_INSTALL_CMD = "echo installed-ok";
    const outcome = await installAppa();
    assert.equal(outcome.exitCode, 0);
    assert.ok(outcome.stdout.includes("installed-ok"));
    assert.equal(outcome.timedOut, false);
  });

  it("captures a failed install with its output", async () => {
    process.env.APPA_INSTALL_CMD = "echo boom >&2; exit 3";
    const outcome = await installAppa();
    assert.equal(outcome.exitCode, 3);
    assert.ok(outcome.stderr.includes("boom"));
    assert.equal(outcome.timedOut, false);
  });

  it("kills a stuck install", async () => {
    process.env.APPA_INSTALL_CMD = "sleep 5";
    process.env.APPA_INSTALL_TIMEOUT_MS = "150";
    const started = Date.now();
    const outcome = await installAppa();
    assert.equal(outcome.timedOut, true);
    assert.equal(outcome.exitCode, -1);
    assert.ok(outcome.stderr.includes("timed out"));
    assert.ok(Date.now() - started < 4000, "killed promptly, not after sleep 5");
  });
});

describe("hook-client binary detection", () => {
  it("flags a missing hook binary (ENOENT)", async () => {
    const outcome = await invokeAppaHook(sessionStartPayload("s1", "startup", "/tmp"), {
      bin: "/nonexistent-dir/appa",
    });
    assert.equal(outcome.binaryMissing, true);
    assert.equal(outcome.exitCode, -1);
    assert.ok(outcome.stderr.includes("failed to start"));
  });
});
