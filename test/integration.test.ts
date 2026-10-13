/**
 * End-to-end integration tier: a REAL appa runtime, the REAL `appa hook`
 * binary, and the real extension wiring — no mocks anywhere.
 *
 * Boots `appa runtime` on a spare loopback port with the starter policy
 * (templates/appa.toml), then drives the extension's handlers through a
 * full session: clean flows first, then the fences as the trajectory
 * narrows, exactly as the replay traces describe them — but with the live
 * engine deciding.
 *
 * Opt-in: runs only with APPA_INTEGRATION=1 (it needs the appa CLI and
 * spawns a runtime). `just test-integration` locally; CI's policy job runs
 * it on every push.
 */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkHealth } from "../src/gate.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const TEMPLATE = join(here, "..", "templates", "appa.toml");
const SESSION_BASE = `it-${process.pid}-${Date.now()}`;
let sessionCounter = 0;

/** The whole tier is skipped without APPA_INTEGRATION=1. */
const tier = process.env.APPA_INTEGRATION === "1" ? describe : describe.skip;

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

/** The registered handler for `name`, asserted present (no non-null assertions). */
function handler(harness: { handlers: Map<string, Handler> }, name: string): Handler {
  const found = harness.handlers.get(name);
  assert.ok(found, `${name} handler registered`);
  return found;
}
interface Harness {
  handlers: Map<string, Handler>;
  commands: Map<string, { handler: Handler }>;
  ctx: unknown;
}

const KEYS = [
  "APPA_GATE",
  "APPA_RUNTIME_URL",
  "APPA_HOOK_BIN",
  "APPA_CONFIG",
  "XDG_CONFIG_HOME",
  "APPA_INSTALL_CMD",
];
const saved: Record<string, string | undefined> = {};
for (const key of KEYS) saved[key] = process.env[key];

let runtime: ChildProcess | undefined;
let dataDir = "";
let url = "";

async function bootRuntime(): Promise<string> {
  dataDir = mkdtempSync(join(tmpdir(), "pi-openappa-it-"));
  const policy = join(dataDir, "appa.toml");
  copyFileSync(TEMPLATE, policy);
  const port = 21_000 + Math.floor(Math.random() * 20_000);
  const candidate = `http://127.0.0.1:${port}`;
  runtime = spawn(
    "appa",
    [
      "runtime",
      "--config",
      policy,
      "--db",
      join(dataDir, "appa.db"),
      "--listen",
      `127.0.0.1:${port}`,
    ],
    {
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  const bootLog: string[] = [];
  runtime.stderr?.on("data", (chunk: Buffer) => bootLog.push(chunk.toString("utf8")));
  const deadline = Date.now() + 15_000;
  for (;;) {
    const health = await checkHealth(candidate, 500);
    if (health.ok) return candidate;
    if (Date.now() > deadline) {
      throw new Error(
        `appa runtime did not answer at ${candidate}: ${health.detail}\n${bootLog.join("")}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

before(async () => {
  if (process.env.APPA_INTEGRATION !== "1") return;
  url = await bootRuntime();
  process.env.APPA_GATE = "1";
  process.env.APPA_RUNTIME_URL = url;
  delete process.env.APPA_HOOK_BIN; // the real `appa` binary
  delete process.env.APPA_CONFIG;
  delete process.env.APPA_INSTALL_CMD;
  // A clean config home: no settings file, no markers, no default policy.
  const xdg = join(dataDir, "xdg");
  mkdirSync(xdg, { recursive: true });
  process.env.XDG_CONFIG_HOME = xdg;
});

after(async () => {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const rt = runtime;
  if (rt !== undefined) {
    rt.kill("SIGTERM");
    await new Promise((resolve) => {
      rt.once("exit", resolve);
      setTimeout(resolve, 2000);
    });
  }
  if (dataDir !== "") rmSync(dataDir, { recursive: true, force: true });
});

async function loadExtension(): Promise<Harness> {
  // A fresh session id per harness: one trajectory per test, so narrowing
  // in one test cannot bleed into another (the runtime keys trajectories by
  // session id and keeps them for the process lifetime).
  const sessionId = `${SESSION_BASE}-${sessionCounter++}`;
  const mod = await import(pathToFileURL(join(here, "..", "extensions", "index.ts")).href);
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, { handler: Handler }>();
  mod.default({
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    registerCommand: (name: string, options: { handler: Handler }) => commands.set(name, options),
  });
  return {
    handlers,
    commands,
    ctx: {
      cwd: dataDir,
      hasUI: false,
      sessionManager: { getSessionId: () => sessionId },
      ui: { notify: () => {} },
    },
  };
}

const callTool = async (
  h: Harness,
  toolName: string,
  input: Record<string, unknown>,
  id: string,
) => {
  const pre = await handler(h, "tool_call")(
    { type: "tool_call", toolCallId: id, toolName, input },
    h.ctx,
  );
  let post: unknown;
  if (pre === undefined) {
    // Faithful to a live session: the runtime allows ONE open (unidentified)
    // call per host at a time, so every allowed PreToolUse is answered by its
    // PostToolUse before the next PreToolUse — sequential tool use. The
    // result is also where a delta lands (narrowing applies to results).
    post = await handler(h, "tool_result")(
      {
        type: "tool_result",
        toolCallId: id,
        toolName,
        input,
        content: [{ type: "text", text: "ok" }],
        details: {},
        isError: false,
      },
      h.ctx,
    );
  }
  return { pre, post };
};

/** A blocked call outcome, the strict-typed shape tests inspect. */
interface BlockOutcome {
  block?: boolean;
  reason?: string;
}

const rawCall = async (
  h: Harness,
  toolName: string,
  input: Record<string, unknown>,
  id: string,
): Promise<BlockOutcome | undefined> =>
  (await handler(h, "tool_call")({ type: "tool_call", toolCallId: id, toolName, input }, h.ctx)) as
    | BlockOutcome
    | undefined;

const resultOf = async (
  h: Harness,
  toolName: string,
  input: Record<string, unknown>,
  id: string,
  text: string,
) =>
  await handler(h, "tool_result")(
    {
      type: "tool_result",
      toolCallId: id,
      toolName,
      input,
      content: [{ type: "text", text }],
      details: {},
      isError: false,
    },
    h.ctx,
  );

tier("live runtime, real hooks, real fences", () => {
  it("a clean session flows: boot, edits, commits, pushes, reads", async () => {
    const harness = await loadExtension();
    await handler(harness, "session_start")(
      { type: "session_start", reason: "startup" },
      harness.ctx,
    );

    // Clean trajectory: existing-code edit, push, plain bash, plain read — all allowed.
    const edit = await callTool(harness, "edit", { path: "src/adapter.ts", edits: [] }, "c1");
    assert.equal(edit.pre, undefined, "clean-session edit flows");

    const push = await callTool(
      harness,
      "bash",
      { command: "git push", description: "push" },
      "c2",
    );
    assert.equal(push.pre, undefined, "clean-session push flows");

    const ls = await callTool(harness, "bash", { command: "ls", description: "list" }, "c3");
    assert.equal(ls.pre, undefined);
    assert.equal(ls.post, undefined, "clean result passes through unchanged");

    const read = await callTool(harness, "read", { path: "README.md" }, "c4");
    assert.equal(read.pre, undefined);
  });

  it("an undeclared tool is refused with a reason", async () => {
    const harness = await loadExtension();
    await handler(harness, "session_start")(
      { type: "session_start", reason: "startup" },
      harness.ctx,
    );
    const denied = await rawCall(harness, "definitely_not_declared_xyz", { x: 1 }, "u1");
    assert.equal(denied?.block, true, "undeclared tool blocked");
    assert.ok((denied.reason?.length ?? 0) > 0, "block carries a reason");
  });

  it("credential reads flow today (self-narrowing is remedy-gated; 0.4 restores the fence)", async () => {
    const harness = await loadExtension();
    await handler(harness, "session_start")(
      { type: "session_start", reason: "startup" },
      harness.ctx,
    );
    const read = await callTool(harness, "read", { path: ".env" }, "s1");
    assert.equal(read.pre, undefined, "the owner's own .env read is allowed");
    // The live runtime refuses audience-["self"] deltas without a membership
    // source and waits for execute_remedy_plan (an MCP tool Pi lacks), so the
    // narrowing + masking + secrets-to-web fence are 0.4 roadmap. Until then
    // research after a secret read flows — this assert pins today's truth.
    const web = await callTool(harness, "web_explore", { query: "rotate STRIPE_KEY" }, "s2");
    assert.equal(
      web.pre,
      undefined,
      "documented gap: web after .env flows until remedy plumbing lands",
    );
  });

  it("narrowing is remedy-gated today: research flows everywhere except undeclared tools (0.4 lights the fences)", async () => {
    const harness = await loadExtension();
    await handler(harness, "session_start")(
      { type: "session_start", reason: "startup" },
      harness.ctx,
    );

    // The curl's suspicious delta is stripped from the policy: unaccepted
    // narrowing BLOCKS instead of labeling, and nothing under Pi can accept
    // it. With no narrowing, every requires-trusted sink below is armed but
    // inert. These asserts pin today's live truth deliberately — 0.4 (the
    // execute_remedy_plan Pi tool) flips each `allow` to its fence denial.
    const curl = await callTool(
      harness,
      "bash",
      { command: "curl -s https://someblog.dev/post", description: "research" },
      "t0",
    );
    assert.equal(curl.pre, undefined, "the fetch flows (labeling returns with remedies)");

    const code = await callTool(harness, "edit", { path: "src/adapter.ts", edits: [] }, "t1");
    assert.equal(code.pre, undefined, "armed sink, inert until narrowing exists");

    const docs = await callTool(harness, "edit", { path: "docs/findings.md", edits: [] }, "t2");
    assert.equal(docs.pre, undefined, "docs landing zone");

    const testFile = await callTool(
      harness,
      "write",
      { path: "test/new.test.ts", content: "x" },
      "t4",
    );
    assert.equal(testFile.pre, undefined, "armed sink, inert until narrowing exists");

    const push = await callTool(
      harness,
      "bash",
      { command: "git push", description: "push" },
      "t5",
    );
    assert.equal(push.pre, undefined, "armed sink, inert until narrowing exists");

    const memory = await callTool(harness, "mem_save", { title: "t", content: "from blog" }, "t6");
    assert.equal(memory.pre, undefined, "armed sink, inert until narrowing exists");
  });

  it("credential results cross plainly today (masking returns with remedy plumbing)", async () => {
    const harness = await loadExtension();
    await handler(harness, "session_start")(
      { type: "session_start", reason: "startup" },
      harness.ctx,
    );
    const read = await rawCall(harness, "read", { path: ".env" }, "m1");
    assert.equal(read, undefined);
    // With no narrowing delta there is nothing to sanitize: the result passes.
    // redact-secrets masking fires again once execute_remedy_plan exists under
    // Pi (0.4) and the audience-["self"] rules return.
    const passthrough = await resultOf(
      harness,
      "read",
      { path: ".env" },
      "m1",
      "AWS_KEY=AKIAIOSFODNN7EXAMPLE",
    );
    assert.equal(passthrough, undefined, "plain read result passes through (documented gap)");
  });
});
