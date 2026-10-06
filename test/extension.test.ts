import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MOCK_BIN = join(here, "fixtures", "mock-appa.mjs");
const SESSION = "22222222-2222-2222-2222-222222222222";

/** Environment keys this suite mutates; restored after every test. */
const KEYS = ["APPA_GATE", "APPA_HOOK_BIN", "MOCK_MODE", "MOCK_RECORD", "APPA_HOOK_TIMEOUT_MS", "APPA_CONFIG"];
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

async function loadExtension(): Promise<Harness> {
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
    cwd: "/home/aemonge/projects/pi-openappa",
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

describe("gate off: extension is inert", () => {
  beforeEach(() => {
    delete process.env.APPA_GATE;
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

  it("starts nothing when ungated", async () => {
    const dir = workDir();
    withMock(dir, "allow");
    delete process.env.APPA_GATE;
    delete process.env.APPA_CONFIG;
    const harness = await loadExtension();
    await startSession(harness);
    assert.deepEqual(recordedArgv(dir), []);
    assert.deepEqual(recordedLines(dir), []);
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
