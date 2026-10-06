import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapSessionSource,
  mapToolName,
  parseCallDecision,
  parseResultDecision,
  postToolUsePayload,
  preToolUsePayload,
  sessionStartPayload,
  stopPayload,
  promptPayload,
  renderToolOutput,
  toolResponseFrom,
} from "../src/adapter.ts";

const SESSION = "11111111-1111-1111-1111-111111111111";

describe("tool name mapping", () => {
  it("maps pi built-ins to Claude Code policy names", () => {
    assert.equal(mapToolName("bash"), "Bash");
    assert.equal(mapToolName("read"), "Read");
    assert.equal(mapToolName("edit"), "Edit");
    assert.equal(mapToolName("write"), "Write");
    assert.equal(mapToolName("grep"), "Grep");
    assert.equal(mapToolName("find"), "Glob");
    assert.equal(mapToolName("ls"), "LS");
    assert.equal(mapToolName("powershell"), "PowerShell");
  });

  it("passes custom tool names through verbatim", () => {
    assert.equal(mapToolName("subagent"), "subagent");
    assert.equal(mapToolName("mcp__zoekt__search"), "mcp__zoekt__search");
  });
});

describe("session source mapping", () => {
  it("maps startup and new to startup", () => {
    assert.equal(mapSessionSource("startup"), "startup");
    assert.equal(mapSessionSource("new"), "startup");
  });

  it("maps resume, fork, and reload to resume", () => {
    assert.equal(mapSessionSource("resume"), "resume");
    assert.equal(mapSessionSource("fork"), "resume");
    assert.equal(mapSessionSource("reload"), "resume");
  });
});

describe("payload builders", () => {
  it("session start carries source and cwd", () => {
    assert.deepEqual(sessionStartPayload(SESSION, "startup", "/w"), {
      session_id: SESSION,
      hook_event_name: "SessionStart",
      source: "startup",
      cwd: "/w",
    });
  });

  it("prompt carries the prompt text", () => {
    assert.equal(promptPayload(SESSION, "list files", "/w").prompt, "list files");
  });

  it("pre and post tool use echo the same input reference", () => {
    const input = { command: "ls", description: "list" };
    const pre = preToolUsePayload(SESSION, "bash", input, "/w");
    const post = postToolUsePayload(SESSION, "bash", input, { output: "x" }, "/w");
    assert.equal(pre.tool_input, input);
    assert.equal(post.tool_input, input);
    assert.equal(JSON.stringify(pre.tool_input), JSON.stringify(post.tool_input));
    assert.equal(pre.tool_name, "Bash");
    assert.equal(post.tool_name, "Bash");
  });

  it("stop payload is minimal", () => {
    assert.deepEqual(stopPayload(SESSION), {
      session_id: SESSION,
      hook_event_name: "Stop",
    });
  });
});

describe("tool response shaping", () => {
  it("carries text and error flag generically", () => {
    assert.deepEqual(toolResponseFrom({ text: "hello", isError: false }), {
      output: "hello",
      isError: false,
    });
  });

  it("copies structured fields from details when present", () => {
    const response = toolResponseFrom({
      text: "out",
      isError: true,
      details: { stdout: "out", exitcode: 1, interrupted: false },
    });
    assert.equal(response.stdout, "out");
    assert.equal(response.exitcode, 1);
    assert.equal(response.interrupted, false);
    assert.equal(response.isError, true);
  });

  it("renders updatedToolOutput with stdout/stderr preference", () => {
    assert.equal(renderToolOutput({ stdout: "kept", exitcode: 0 }), "kept");
    const rendered = renderToolOutput({ structured: true });
    assert.ok(rendered.includes("structured"));
  });
});

describe("parseCallDecision (wire fixtures from appa 0.31.1)", () => {
  it("allows on silent exit 0", () => {
    assert.deepEqual(parseCallDecision(0, "", ""), { type: "allow" });
  });

  it("allows on empty json object", () => {
    assert.deepEqual(parseCallDecision(0, "{}", ""), { type: "allow" });
  });

  it("allows on structured permission allow", () => {
    const stdout =
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"appa: the call is released"}}';
    assert.deepEqual(parseCallDecision(0, stdout, ""), { type: "allow" });
  });

  it("denies with reason on exit 2 stderr (undeclared tool)", () => {
    const decision = parseCallDecision(
      2,
      '{"error":"tool host/claude-code/SendWebhook is not declared"}',
      "OpenAPPA hook blocked: tool host/claude-code/SendWebhook is not declared",
    );
    assert.equal(decision.type, "deny");
    if (decision.type === "deny") {
      assert.ok(decision.reason.includes("not declared"));
    }
  });

  it("denies on structured permission deny with its reason", () => {
    const stdout =
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"appa: this command may not run here"}}';
    const decision = parseCallDecision(0, stdout, "");
    assert.equal(decision.type, "deny");
    if (decision.type === "deny") {
      assert.equal(decision.reason, "appa: this command may not run here");
    }
  });

  it("denies fail-closed on unrecognized exit codes", () => {
    const decision = parseCallDecision(-1, "", "appa hook failed to start:ENOENT");
    assert.equal(decision.type, "deny");
  });

  it("denies fail-closed on unrecognized structured decisions", () => {
    const decision = parseCallDecision(0, '{"decision":"mystery"}', "");
    assert.equal(decision.type, "deny");
  });
});

describe("parseResultDecision (wire fixtures from appa 0.31.1)", () => {
  it("passes on silent exit 0", () => {
    assert.deepEqual(parseResultDecision(0, "", ""), { type: "pass" });
  });

  it("passes on empty json object", () => {
    assert.deepEqual(parseResultDecision(0, "{}", ""), { type: "pass" });
  });

  it("replaces with updatedToolOutput content (withheld result)", () => {
    const stdout = JSON.stringify({
      decision: "block",
      reason: "this outcome does not match the open dispatch; it is not reported",
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput: {
          exitcode: 0,
          stdout: "[appa] the tool result was withheld",
        },
      },
    });
    const decision = parseResultDecision(0, stdout, "");
    assert.equal(decision.type, "replace");
    if (decision.type === "replace") {
      assert.equal(decision.text, "[appa] the tool result was withheld");
      assert.equal(decision.isError, false);
    }
  });

  it("withholds as error on exit 2", () => {
    const decision = parseResultDecision(2, "", "OpenAPPA hook blocked: result may not cross");
    assert.equal(decision.type, "replace");
    if (decision.type === "replace") {
      assert.equal(decision.isError, true);
      assert.ok(decision.text.includes("result may not cross"));
    }
  });

  it("withholds as error when the runtime is unreachable", () => {
    const decision = parseResultDecision(
      -1,
      "",
      "appa hook failed to start: cannot reach 127.0.0.1:8787",
    );
    assert.equal(decision.type, "replace");
    if (decision.type === "replace") {
      assert.equal(decision.isError, true);
    }
  });
});
