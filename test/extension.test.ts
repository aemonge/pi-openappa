import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, copyFileSync, chmodSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MOCK_BIN = join(here, "fixtures", "mock-appa.mjs");
const SESSION = "22222222-2222-2222-2222-222222222222";

/** Environment keys this suite mutates; restored after every test. */
const KEYS = ["APPA_GATE", "APPA_HOOK_BIN", "MOCK_MODE", "MOCK_RECORD", "APPA_HOOK_TIMEOUT_MS", "APPA_CONFIG", "XDG_CONFIG_HOME", "APPA_INSTALL_CMD", "APPA_INSTALL_TIMEOUT_MS", "PATH", "HOME", "APPA_RUNTIME_URL"];
const saved: Record<string, string | undefined> = {};
for (const key of KEYS) saved[key] = process.env[key];

const workDirs: string[] = [];
function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-openappa-test-"));
  workDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

type Handler = (event: any, ctx: any) => Promise<any>;

interface Harness {
  handlers: Map<string, Handler>;
  commands: Map<string, { handler: Handler }>;
  ctx: unknown;
}

async function loadExtension(cwd?: string): Promise<Harness> {
  const mod = await import(pathToFileURL(join(here, "..", "extensions", "index.ts")).href);
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, { handler: Handler }>();
  const fakePi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerCommand: (name: string, options: { handler: Handler }) =>
      commands.set(name, options),
  };
  mod.default(fakePi);
  const ctx = {
    cwd: cwd ?? "/home/aemonge/projects/pi-openappa",
    hasUI: false,
    sessionManager: { getSessionId: () => SESSION },
    ui: { notify: () => {} },
  };
  return { handlers, commands, ctx };
}

async function startSession(harness: Harness, reason = "startup"): Promise<void> {
  const handler = harness.handlers.get("session_start");
  assert.ok(handler, "session_start handler registered");
  await handler({ type: "session_start", reason }, harness.ctx);
}

function recordedLines(dir: string): string[] {
  const file = join(dir, "record.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

function withMock(dir: string, mode: string): void {
  process.env.APPA_GATE = "1";
  process.env.APPA_HOOK_BIN = MOCK_BIN;
  process.env.MOCK_MODE = mode;
  process.env.MOCK_RECORD = join(dir, "record.jsonl");
}

/** PATH with `appa` absent: extra dirs first, then only node/curl/sh system dirs. */
function hermeticPath(...extraDirs: string[]): string {
  return [...extraDirs, dirname(process.execPath), "/usr/bin", "/bin"].join(":");
}

/** Give the fake ctx a recording UI; returns [kind, message] pairs. */
function enableUiSpy(harness: Harness): Array<[string, string]> {
  const notices: Array<[string, string]> = [];
  const ctx = harness.ctx as { hasUI?: boolean; ui?: { notify: (m: string, k: string) => void } };
  ctx.hasUI = true;
  ctx.ui = { notify: (message, kind) => notices.push([kind, message]) };
  return notices;
}

const bashCall = { type: "tool_call", toolCallId: "call-1", toolName: "bash", input: { command: "ls", description: "list" } };
const bashResult = {
  type: "tool_result",
  toolCallId: "call-1",
  toolName: "bash",
  input: { command: "ls", description: "list" },
  content: [{ type: "text", text: "file1 file2" }],
  details: { stdout: "file1 file2", exitcode: 0 },
  isError: false,
};

beforeEach(() => {
  // Isolate gate resolution from real machine state: clean config dir and
  // HOME per test (no off markers, no APPA default policy), no gate env.
  // Tests that want to opt out set APPA_GATE=0 or a marker themselves.
  process.env.XDG_CONFIG_HOME = join(workDir(), "xdg");
  process.env.HOME = join(workDir(), "home");
  delete process.env.APPA_GATE;
  delete process.env.APPA_CONFIG;
  delete process.env.APPA_RUNTIME_URL;
});

describe("opted-out session (APPA_GATE=0): extension is inert", () => {
  beforeEach(() => {
    process.env.APPA_GATE = "0";
  });

  it("never invokes the hook and passes everything through", async () => {
    const dir = workDir();
    process.env.APPA_HOOK_BIN = MOCK_BIN;
    process.env.MOCK_RECORD = join(dir, "record.jsonl");
    const harness = await loadExtension();
    await startSession(harness);
    const prompt = await harness.handlers.get("before_agent_start")!(
      { type: "before_agent_start", prompt: "hello", systemPrompt: "", systemPromptOptions: {} },
      harness.ctx,
    );
    const call = await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
    const result = await harness.handlers.get("tool_result")!(bashResult, harness.ctx);
    const turnEnd = await harness.handlers.get("turn_end")!({ type: "turn_end" }, harness.ctx);
    assert.equal(prompt, undefined);
    assert.equal(call, undefined);
    assert.equal(result, undefined);
    assert.equal(turnEnd, undefined);
    assert.deepEqual(recordedLines(dir), []);
  });
});

describe("gated session through the scripted mock", () => {
  it("allows a released call and passes its result", async () => {
    const dir = workDir();
    withMock(dir, "allow");
    const harness = await loadExtension();
    await startSession(harness);
    const call = await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
    assert.equal(call, undefined);
    const result = await harness.handlers.get("tool_result")!(bashResult, harness.ctx);
    assert.equal(result, undefined);
    const events = recordedLines(dir).map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((e) => e.hook_event_name),
      ["SessionStart", "PreToolUse", "PostToolUse"],
    );
  });

  it("denies with the runtime's reason on exit 2", async () => {
    const dir = workDir();
    withMock(dir, "deny-stderr");
    const harness = await loadExtension();
    await startSession(harness);
    const call = await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
    assert.deepEqual(call, {
      block: true,
      reason: "appa: not declared in this policy",
    });
  });

  it("denies with a structured permission reason", async () => {
    const dir = workDir();
    withMock(dir, "deny-permission");
    const harness = await loadExtension();
    await startSession(harness);
    const call = await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
    assert.deepEqual(call, {
      block: true,
      reason: "appa: appa: this command may not run here",
    });
  });

  it("replaces a withheld result with the runtime's output", async () => {
    const dir = workDir();
    withMock(dir, "replace-result");
    const harness = await loadExtension();
    await startSession(harness);
    await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
    const result = await harness.handlers.get("tool_result")!(bashResult, harness.ctx);
    assert.deepEqual(result, {
      content: [{ type: "text", text: "[appa] the tool result was withheld by policy" }],
      isError: false,
    });
  });

  it("withholds a result as an error when the runtime blocks it", async () => {
    const dir = workDir();
    withMock(dir, "deny-result");
    const harness = await loadExtension();
    await startSession(harness);
    await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
    const result = await harness.handlers.get("tool_result")!(bashResult, harness.ctx);
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("result may not cross"));
  });

  it("fails closed when the hook binary cannot start", async () => {
    const dir = workDir();
    withMock(dir, "allow");
    // A named config keeps this fail-closed: with none, a failed start with
    // nothing answering downgrades the session to unprotected instead.
    process.env.APPA_CONFIG = "/tmp/policy.toml";
    process.env.APPA_RUNTIME_URL = "http://127.0.0.1:8799";
    process.env.APPA_HOOK_BIN = join(dir, "does-not-exist");
    const harness = await loadExtension();
    await startSession(harness);
    const call = await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
    assert.equal(call.block, true);
    assert.ok(call.reason.includes("failed to start"));
  });

  it("fails closed on hook timeout", async () => {
    const dir = workDir();
    withMock(dir, "sleep");
    process.env.APPA_CONFIG = "/tmp/policy.toml"; // no no-policy downgrade
    process.env.APPA_RUNTIME_URL = "http://127.0.0.1:8799";
    process.env.APPA_HOOK_TIMEOUT_MS = "150";
    const harness = await loadExtension();
    await startSession(harness);
    const call = await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
    assert.equal(call.block, true);
    assert.ok(call.reason.includes("timed out"));
  });

  it("treats a subagent spawn as a plain tool call", async () => {
    const dir = workDir();
    withMock(dir, "allow");
    const harness = await loadExtension();
    await startSession(harness);
    const spawn = await harness.handlers.get("tool_call")!(
      {
        type: "tool_call",
        toolCallId: "call-2",
        toolName: "subagent",
        input: { agent: "scout", prompt: "look around" },
      },
      harness.ctx,
    );
    assert.equal(spawn, undefined);
    const events = recordedLines(dir).map((line) => JSON.parse(line));
    const pre = events.find((e) => e.hook_event_name === "PreToolUse");
    assert.equal(pre.tool_name, "subagent");
    assert.deepEqual(pre.tool_input, { agent: "scout", prompt: "look around" });
  });

  it("echoes the exact tool_input bytes between Pre and PostToolUse", async () => {
    const dir = workDir();
    withMock(dir, "allow");
    const harness = await loadExtension();
    await startSession(harness);
    await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
    // The executed input mutates afterwards (another handler rewrote it);
    // the result event sees different bytes than what was checked.
    const mutatedResult = {
      ...bashResult,
      input: { command: "ls -la", description: "list" },
    };
    await harness.handlers.get("tool_result")!(mutatedResult, harness.ctx);
    const lines = recordedLines(dir).map((line) => JSON.parse(line));
    const pre = lines.find((e) => e.hook_event_name === "PreToolUse");
    const post = lines.find((e) => e.hook_event_name === "PostToolUse");
    assert.equal(
      JSON.stringify(pre.tool_input),
      JSON.stringify({ command: "ls", description: "list" }),
    );
    assert.equal(JSON.stringify(post.tool_input), JSON.stringify(pre.tool_input));
  });

  it("reports turn end with --turn-end semantics (non-blocking)", async () => {
    const dir = workDir();
    withMock(dir, "crash");
    const harness = await loadExtension();
    await startSession(harness);
    const outcome = await harness.handlers.get("turn_end")!({ type: "turn_end" }, harness.ctx);
    assert.equal(outcome, undefined);
  });

  it("sends the prompt as the turn boundary and stop at turn end", async () => {
    const dir = workDir();
    withMock(dir, "allow");
    const harness = await loadExtension();
    await startSession(harness);
    await harness.handlers.get("before_agent_start")!(
      { type: "before_agent_start", prompt: "list the files", systemPrompt: "", systemPromptOptions: {} },
      harness.ctx,
    );
    await harness.handlers.get("turn_end")!({ type: "turn_end" }, harness.ctx);
    const events = recordedLines(dir).map((line) => JSON.parse(line));
    const prompt = events.find((e) => e.hook_event_name === "UserPromptSubmit");
    const stop = events.find((e) => e.hook_event_name === "Stop");
    assert.equal(prompt.prompt, "list the files");
    assert.ok(stop);
  });
});

function recordedArgv(dir: string): string[][] {
  const file = `${join(dir, "record.jsonl")}.argv`;
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as string[]);
}

describe("auto-start on gated session start", () => {
  it("passes --ensure-runtime and --config from APPA_CONFIG", async () => {
    const dir = workDir();
    withMock(dir, "allow");
    process.env.APPA_CONFIG = "/tmp/playground/appa.toml";
    const harness = await loadExtension();
    await startSession(harness);
    const first = recordedArgv(dir)[0];
    assert.ok(first?.includes("--ensure-runtime"), `argv: ${JSON.stringify(first)}`);
    const configIndex = first?.indexOf("--config");
    assert.notEqual(configIndex, -1);
    assert.equal(first?.[Number(configIndex) + 1], "/tmp/playground/appa.toml");
  });

  it("omits --config when APPA_CONFIG is unset", async () => {
    const dir = workDir();
    withMock(dir, "allow");
    delete process.env.APPA_CONFIG;
    const harness = await loadExtension();
    await startSession(harness);
    const first = recordedArgv(dir)[0];
    assert.ok(first?.includes("--ensure-runtime"));
    assert.ok(!first?.includes("--config"));
  });

  it("starts nothing when opted out (APPA_GATE=0)", async () => {
    const dir = workDir();
    withMock(dir, "allow");
    process.env.APPA_GATE = "0";
    delete process.env.APPA_CONFIG;
    const harness = await loadExtension();
    await startSession(harness);
    assert.deepEqual(recordedArgv(dir), []);
    assert.deepEqual(recordedLines(dir), []);
  });
});

describe("auto-install on gated session start (default-on)", () => {
  it("installs the default appa and retries ensure-runtime", async () => {
    const dir = workDir();
    const binDir = join(dir, "bin");
    mkdirSync(binDir);
    // No APPA_GATE: protection is on by default now.
    delete process.env.APPA_HOOK_BIN;
    delete process.env.APPA_CONFIG;
    process.env.MOCK_MODE = "allow";
    process.env.MOCK_RECORD = join(dir, "record.jsonl");
    const installed = join(binDir, "appa");
    process.env.APPA_INSTALL_CMD = `cp ${MOCK_BIN} ${installed} && chmod +x ${installed}`;
    process.env.PATH = hermeticPath(binDir);
    const harness = await loadExtension();
    const notices = enableUiSpy(harness);
    await startSession(harness);
    assert.ok(existsSync(installed), "installer ran and placed appa");
    const first = recordedArgv(dir)[0];
    assert.ok(first?.includes("--ensure-runtime"), `argv: ${JSON.stringify(first)}`);
    assert.ok(!first?.includes("--config"));
    assert.ok(notices.some(([kind]) => kind === "info"), "install notice shown");
    assert.deepEqual(
      notices.filter(([kind]) => kind === "warning"),
      [],
      `no warnings on success: ${JSON.stringify(notices)}`,
    );
  });

  it("reports a failed install once and never retries the hook", async () => {
    const dir = workDir();
    process.env.APPA_GATE = "1";
    delete process.env.APPA_HOOK_BIN;
    delete process.env.APPA_CONFIG;
    process.env.MOCK_MODE = "allow";
    process.env.MOCK_RECORD = join(dir, "record.jsonl");
    process.env.APPA_INSTALL_CMD = "echo boom >&2; exit 3";
    process.env.APPA_RUNTIME_URL = "http://127.0.0.1:8799";
    process.env.PATH = hermeticPath(join(dir, "bin"));
    const harness = await loadExtension();
    const notices = enableUiSpy(harness);
    await startSession(harness);
    assert.deepEqual(recordedArgv(dir), []);
    assert.deepEqual(recordedLines(dir), []);
    const warnings = notices.filter(([kind]) => kind === "warning");
    assert.equal(warnings.length, 1, JSON.stringify(notices));
    assert.ok(warnings[0]?.[1].includes("auto-install failed"));
    assert.ok(warnings[0]?.[1].includes("boom"));
    assert.ok(warnings[0]?.[1].includes("blocked"));
  });

  it("warns once when the install succeeds but appa is still missing", async () => {
    const dir = workDir();
    process.env.APPA_GATE = "1";
    delete process.env.APPA_HOOK_BIN;
    delete process.env.APPA_CONFIG;
    process.env.MOCK_MODE = "allow";
    process.env.MOCK_RECORD = join(dir, "record.jsonl");
    process.env.APPA_INSTALL_CMD = "true";
    process.env.APPA_RUNTIME_URL = "http://127.0.0.1:8799";
    process.env.PATH = hermeticPath(join(dir, "bin"));
    const harness = await loadExtension();
    const notices = enableUiSpy(harness);
    await startSession(harness);
    assert.deepEqual(recordedArgv(dir), []);
    const warnings = notices.filter(([kind]) => kind === "warning");
    assert.equal(warnings.length, 1, JSON.stringify(notices));
    assert.ok(warnings[0]?.[1].includes("still not on PATH"));
  });

  it("never auto-installs a custom APPA_HOOK_BIN", async () => {
    const dir = workDir();
    process.env.APPA_GATE = "1";
    process.env.APPA_HOOK_BIN = join(dir, "missing-bin");
    delete process.env.APPA_CONFIG;
    process.env.MOCK_MODE = "allow";
    process.env.MOCK_RECORD = join(dir, "record.jsonl");
    const marker = join(dir, "install-ran");
    process.env.APPA_INSTALL_CMD = `touch ${marker}`;
    process.env.PATH = hermeticPath();
    const harness = await loadExtension();
    const notices = enableUiSpy(harness);
    await startSession(harness);
    assert.ok(!existsSync(marker), "installer must not run for custom binaries");
    const warnings = notices.filter(([kind]) => kind === "warning");
    assert.equal(warnings.length, 1, JSON.stringify(notices));
    assert.ok(warnings[0]?.[1].includes("did not answer"), "generic fail-closed warning");
  });
});

describe("project-scoped protection (.pi/openappa)", () => {
  it("gates the project and passes the marker's policy as --config", async () => {
    const dir = workDir();
    withMock(dir, "allow");
    delete process.env.APPA_GATE;
    delete process.env.APPA_CONFIG;
    const proj = join(dir, "proj");
    mkdirSync(join(proj, ".pi"), { recursive: true });
    writeFileSync(join(proj, ".pi", "openappa"), "appa.toml\n");
    const harness = await loadExtension(proj);
    await startSession(harness);
    const first = recordedArgv(dir)[0];
    assert.ok(first?.includes("--ensure-runtime"), `argv: ${JSON.stringify(first)}`);
    const index = first?.indexOf("--config");
    assert.notEqual(index, -1);
    assert.equal(first?.[Number(index) + 1], join(proj, "appa.toml"));
    const call = await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
    assert.equal(call, undefined);
  });

  it("empty marker content passes no --config", async () => {
    const dir = workDir();
    withMock(dir, "allow");
    delete process.env.APPA_GATE;
    delete process.env.APPA_CONFIG;
    const proj = join(dir, "proj2");
    mkdirSync(join(proj, ".pi"), { recursive: true });
    writeFileSync(join(proj, ".pi", "openappa"), "");
    const harness = await loadExtension(proj);
    await startSession(harness);
    const first = recordedArgv(dir)[0];
    assert.ok(first?.includes("--ensure-runtime"));
    assert.ok(!first?.includes("--config"));
  });

  it("explicit APPA_CONFIG wins over marker content", async () => {
    const dir = workDir();
    withMock(dir, "allow");
    delete process.env.APPA_GATE;
    process.env.APPA_CONFIG = "/tmp/env-policy.toml";
    const proj = join(dir, "proj3");
    mkdirSync(join(proj, ".pi"), { recursive: true });
    writeFileSync(join(proj, ".pi", "openappa"), "appa.toml\n");
    const harness = await loadExtension(proj);
    await startSession(harness);
    const first = recordedArgv(dir)[0];
    const index = first?.indexOf("--config");
    assert.equal(first?.[Number(index) + 1], "/tmp/env-policy.toml");
  });
});

describe("global opt-out (/appa off marker)", () => {
  it("gates every session by default, with no markers or env", async () => {
    const dir = workDir();
    withMock(dir, "allow");
    delete process.env.APPA_GATE;
    const harness = await loadExtension();
    await startSession(harness);
    const call = await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
    assert.equal(call, undefined);
    assert.ok(recordedArgv(dir).length > 0, "hook was invoked without APPA_GATE");
  });

  it("is inert once the global off marker exists", async () => {
    const dir = workDir();
    withMock(dir, "allow");
    delete process.env.APPA_GATE;
    process.env.XDG_CONFIG_HOME = join(dir, "xdg");
    mkdirSync(join(dir, "xdg", "pi-openappa"), { recursive: true });
    writeFileSync(join(dir, "xdg", "pi-openappa", "off"), "");
    const harness = await loadExtension();
    await startSession(harness);
    const call = await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
    assert.equal(call, undefined);
    assert.deepEqual(recordedArgv(dir), []);
  });
});

describe("/appa on|off", () => {
  it("off writes the global marker and ungates; on clears it and re-gates", async () => {
    const dir = workDir();
    withMock(dir, "allow");
    delete process.env.APPA_GATE;
    process.env.XDG_CONFIG_HOME = join(dir, "xdg");
    const harness = await loadExtension();
    const command = harness.commands.get("appa");
    assert.ok(command);
    await command.handler("off", harness.ctx);
    const marker = join(dir, "xdg", "pi-openappa", "off");
    assert.ok(existsSync(marker));
    const argvAfterOff = recordedArgv(dir).length;
    await startSession(harness);
    const optedOut = await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
    assert.equal(optedOut, undefined);
    assert.equal(recordedArgv(dir).length, argvAfterOff, "no hook while opted out");
    await command.handler("on", harness.ctx);
    assert.ok(!existsSync(marker));
    await startSession(harness);
    const reGated = await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
    assert.equal(reGated, undefined);
    assert.ok(recordedArgv(dir).length > argvAfterOff, "hook invoked again after /appa on");
  });

  it("on also clears the legacy always-on marker", async () => {
    const dir = workDir();
    process.env.XDG_CONFIG_HOME = join(dir, "xdg");
    mkdirSync(join(dir, "xdg", "pi-openappa"), { recursive: true });
    writeFileSync(join(dir, "xdg", "pi-openappa", "always-on"), "");
    delete process.env.APPA_GATE;
    const harness = await loadExtension();
    await harness.commands.get("appa")!.handler("on", harness.ctx);
    assert.ok(!existsSync(join(dir, "xdg", "pi-openappa", "always-on")));
  });

  it("status completes without a runtime", async () => {
    const dir = workDir();
    process.env.XDG_CONFIG_HOME = join(dir, "xdg2");
    process.env.APPA_RUNTIME_URL = "http://127.0.0.1:8799";
    const harness = await loadExtension();
    await startSession(harness);
    await harness.commands.get("appa")!.handler("status", harness.ctx);
  });
});

describe("/appa command", () => {
  it("reports protection state without a runtime", async () => {
    const dir = workDir();
    delete process.env.APPA_GATE;
    process.env.APPA_RUNTIME_URL = "http://127.0.0.1:8799";
    const harness = await loadExtension();
    await startSession(harness);
    const command = harness.commands.get("appa");
    assert.ok(command, "/appa registered");
    // No UI in this harness; the handler must still complete without throwing.
    await command.handler("", harness.ctx);
  });
});

describe("no-policy downgrade (runs unprotected)", () => {
  function noPolicySetup(dir: string): void {
    delete process.env.APPA_GATE;
    delete process.env.APPA_CONFIG;
    delete process.env.APPA_HOOK_BIN;
    // The mock stands in for the default `appa` binary: present on PATH (so
    // no auto-install triggers), crashing on ensure-runtime (spawn works).
    const binDir = join(dir, "bin");
    mkdirSync(binDir, { recursive: true });
    const asAppa = join(binDir, "appa");
    copyFileSync(MOCK_BIN, asAppa);
    chmodSync(asAppa, 0o755);
    process.env.MOCK_MODE = "crash";
    process.env.MOCK_RECORD = join(dir, "record.jsonl");
    process.env.APPA_RUNTIME_URL = "http://127.0.0.1:8799"; // nothing answers
    process.env.APPA_INSTALL_CMD = "exit 1"; // tripwire: must never run
    process.env.PATH = hermeticPath(binDir);
  }

  it("runs the session unprotected with one warning when no policy exists", async () => {
    const dir = workDir();
    noPolicySetup(dir);
    const harness = await loadExtension();
    const notices = enableUiSpy(harness);
    await startSession(harness);
    const warnings = notices.filter(([kind]) => kind === "warning");
    assert.equal(warnings.length, 1, JSON.stringify(notices));
    assert.ok(warnings[0]?.[1].includes("runs unprotected"));
    // The initial SessionStart went out; tool calls afterwards do not.
    assert.equal(recordedLines(dir).length, 1);
    const call = await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
    assert.equal(call, undefined);
    assert.equal(recordedLines(dir).length, 1, "no hook while unprotected");
  });

  it("stays fail-closed when APPA's default policy exists", async () => {
    const dir = workDir();
    noPolicySetup(dir);
    mkdirSync(join(process.env.XDG_CONFIG_HOME!, "appa"), { recursive: true });
    writeFileSync(join(process.env.XDG_CONFIG_HOME!, "appa", "appa.toml"), "");
    const harness = await loadExtension();
    const notices = enableUiSpy(harness);
    await startSession(harness);
    const warnings = notices.filter(([kind]) => kind === "warning");
    assert.equal(warnings.length, 1, JSON.stringify(notices));
    assert.ok(warnings[0]?.[1].includes("did not answer"));
    const call = await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
    assert.equal(call.block, true);
  });

  it("stays fail-closed with a named APPA_CONFIG", async () => {
    const dir = workDir();
    noPolicySetup(dir);
    process.env.APPA_CONFIG = "/tmp/named-but-broken.toml";
    const harness = await loadExtension();
    const notices = enableUiSpy(harness);
    await startSession(harness);
    const warnings = notices.filter(([kind]) => kind === "warning");
    assert.equal(warnings.length, 1, JSON.stringify(notices));
    assert.ok(warnings[0]?.[1].includes("did not answer"));
    const call = await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
    assert.equal(call.block, true);
  });

  it("stays fail-closed when a runtime is already answering", async () => {
    const dir = workDir();
    noPolicySetup(dir);
    const server = createServer((req, res) => {
      res.end(req.url?.includes("health") ? "ok" : "");
    });
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const address = server.address() as { port: number };
    process.env.APPA_RUNTIME_URL = `http://127.0.0.1:${address.port}`;
    try {
      const harness = await loadExtension();
      const notices = enableUiSpy(harness);
      await startSession(harness);
      const warnings = notices.filter(([kind]) => kind === "warning");
      assert.equal(warnings.length, 1, JSON.stringify(notices));
      assert.ok(warnings[0]?.[1].includes("did not answer"));
      const call = await harness.handlers.get("tool_call")!(bashCall, harness.ctx);
      assert.equal(call.block, true);
    } finally {
      server.close();
    }
  });
});
