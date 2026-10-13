#!/usr/bin/env node
/**
 * Scripted `appa hook` stand-in for tests. Behavior is selected with
 * MOCK_MODE; every received payload is appended to MOCK_RECORD as JSONL so
 * tests can assert byte-exact echoes across PreToolUse/PostToolUse.
 *
 * Output goes through raw stdio writes (never console.*): this file's bytes
 * ARE the wire protocol the parsers under test consume.
 */
import { appendFileSync } from "node:fs";

let raw = "";
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }
  if (process.env.MOCK_RECORD) {
    appendFileSync(process.env.MOCK_RECORD, `${JSON.stringify(payload)}\n`);
    appendFileSync(`${process.env.MOCK_RECORD}.argv`, `${JSON.stringify(process.argv.slice(2))}\n`);
  }
  const event = payload.hook_event_name;
  const mode = process.env.MOCK_MODE ?? "allow";

  if (mode === "sleep") {
    setTimeout(() => process.exit(0), 2000);
    return;
  }
  if (mode === "crash") {
    process.stderr.write("appa hook failed to start: mock crash\n");
    process.exit(-1);
    return;
  }

  if (event === "PreToolUse") {
    if (mode === "deny-stderr") {
      process.stderr.write("OpenAPPA hook blocked: not declared in this policy\n");
      process.exit(2);
      return;
    }
    if (mode === "deny-json") {
      process.stdout.write(
        `${JSON.stringify({ error: "tool host/claude-code/X is not declared" })}\n`,
      );
      process.stderr.write("OpenAPPA hook blocked: tool host/claude-code/X is not declared\n");
      process.exit(2);
      return;
    }
    if (mode === "deny-permission") {
      process.stdout.write(
        `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: "appa: this command may not run here",
          },
        })}\n`,
      );
      process.exit(0);
      return;
    }
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "appa: the call is released",
        },
      })}\n`,
    );
    process.exit(0);
    return;
  }

  if (event === "PostToolUse" && mode === "replace-result") {
    process.stdout.write(
      `${JSON.stringify({
        decision: "block",
        reason: "this outcome does not match the open dispatch; it is not reported",
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          updatedToolOutput: {
            exitcode: 0,
            stdout: "[appa] the tool result was withheld by policy",
          },
        },
      })}\n`,
    );
    process.exit(0);
    return;
  }

  if (event === "PostToolUse" && mode === "deny-result") {
    process.stderr.write("OpenAPPA hook blocked: result may not cross\n");
    process.exit(2);
    return;
  }

  process.stdout.write("{}\n");
  process.exit(0);
});
