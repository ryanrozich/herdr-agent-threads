// Adapted from harbor-framework/harbor, tests/unit/agents/installed/test_pi.py at
// 110c71b32c268e1d113c3856869202842f8e37a6 (0.26.0).
// Copyright the Harbor authors. Apache-2.0; see LICENSE beside this file.
// Ported: the trajectory items of TestPiTrajectory, the named entries in PI_CASES below; the
// other trajectory items (TestPiTrajectory's two resume tests, and TestPiPopulateContext) are in
// LEFT_OUT (differences.js). The rest of the file tests Harbor's install, configuration and run
// commands, which have no counterpart in an export.
// Changed from Harbor's original: the pytest functions are translated to JavaScript case entries that
// run our export's command line; the diff checks are ours, and "Adapted:" marks changed input.
// Harbor reads the same file Agent Threads reads, Pi's session file (pi/sessions/*.jsonl), so each
// case writes Harbor's events as the file's lines, unchanged, as session.jsonl.
// Harbor's assertions on its run context (AgentContext, filled from pi.txt) and on the image
// files it writes are left out: an export fills no context and writes no files.
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Harbor's _write_session: one JSON line per event, and a newline after the last.
export function writePi(dir, events) {
  const path = join(dir, "session.jsonl");
  writeFileSync(path, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
  return path;
}
// A case's files: Harbor's events (a function of nothing, so each run gets fresh objects).
const session = (events) => (dir) => ({ main: writePi(dir, events()) });
// base64 of b"png bytes", as Harbor's test computes it.
const IMAGE = Buffer.from("png bytes").toString("base64");

const partialEvents = () => [
  { type: "session", id: "pi-session-1", timestamp: "2026-09-13T19:37:55.081Z" },
  { type: "message", id: "user-1", parentId: null, timestamp: "2026-09-13T19:37:55.120Z", message: { role: "user", content: [{ type: "text", text: "Find the bug" }] } },
  { type: "message", id: "assistant-1", parentId: "user-1", timestamp: "2026-09-13T19:37:56.658Z", message: {
    role: "assistant", provider: "harbor-endpoint", api: "openai-completions", model: "deepseek-v4-flash", stopReason: "toolUse",
    content: [{ type: "thinking", thinking: "Inspect the files." }, { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls" } }],
    usage: { input: 100, output: 50, cacheRead: 20, cacheWrite: 10, reasoning: 15, totalTokens: 170, cost: { total: 0.005 } },
  } },
  { type: "message", id: "result-1", parentId: "assistant-1", timestamp: "2026-09-13T19:37:56.677Z", message: {
    role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "src\ntests" }], isError: false,
    usage: { input: 40, output: 10, cacheRead: 4, cacheWrite: 6, reasoning: 2, totalTokens: 54, cost: { total: 0.004 } },
  } },
  { type: "compaction", id: "compact-1", parentId: "result-1", timestamp: "2026-09-13T19:45:17.180Z", summary: "The repository contains source and tests.", tokensBefore: 1000, fromHook: false,
    usage: { input: 30, output: 10, cacheRead: 5, cacheWrite: 2, reasoning: 3, totalTokens: 45, cost: { total: 0.001 } } },
  { type: "message", id: "assistant-aborted", parentId: "compact-1", timestamp: "2026-09-13T19:45:18.180Z", message: { role: "assistant", stopReason: "error", errorMessage: "This operation was aborted", content: [] } },
];

const branchEvents = () => [
  { type: "session", id: "pi-session-1" },
  { type: "message", id: "user-root", parentId: null, message: { role: "user", content: "Start" } },
  { type: "message", id: "assistant-abandoned", parentId: "user-root", message: { role: "assistant", content: [{ type: "toolCall", id: "shared-call", name: "bash", arguments: { command: "wrong" } }], usage: { input: 100, output: 50, cost: { total: 0.10 } } } },
  { type: "message", id: "result-abandoned", parentId: "assistant-abandoned", message: { role: "toolResult", toolCallId: "shared-call", content: "wrong result" } },
  { type: "branch_summary", id: "branch-summary", parentId: "user-root", fromId: "result-abandoned", summary: "The abandoned approach was not useful.", usage: { input: 10, output: 4, cost: { total: 0.01 } } },
  { type: "message", id: "user-active", parentId: "branch-summary", message: { role: "user", content: "Try another way" } },
  { type: "message", id: "assistant-active", parentId: "user-active", message: { role: "assistant", content: [{ type: "text", text: "Done" }], usage: { input: 20, output: 8, cost: { total: 0.02 } } } },
];

const customEvents = () => [
  { type: "session", id: "pi-session-1" },
  { type: "message", id: "user-1", parentId: null, message: { role: "user", content: "Authenticate" } },
  { type: "custom_message", id: "mcp-notice", parentId: "user-1", customType: "mcp-auth-status", content: [{ type: "text", text: "Authentication is required." }], display: false, details: { server: "example" } },
  { type: "message", id: "assistant-1", parentId: "mcp-notice", message: { role: "assistant", content: [{ type: "text", text: "I will authenticate." }], usage: { input: 10, output: 5 } } },
];

const imageEvents = () => [
  { type: "session", id: "pi-session-1" },
  { type: "message", message: { role: "user", content: [{ type: "text", text: "Inspect this" }, { type: "image", data: IMAGE, mimeType: "image/png" }] } },
  { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "diagram.png" } }] } },
  { type: "message", message: { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "Rendered image" }, { type: "image", data: IMAGE, mimeType: "image/png" }] } },
];

export const PI_CASES = [
  {
    id: "pi: partial_session_is_written_as_atif",
    files: session(partialEvents),
    diff: { reason: "R17", kind: "by design", check: (t) => {
      assert.equal(t.session_id, "session");
      assert.deepEqual(t.agent, { name: "pi", version: "unknown", model_name: "deepseek-v4-flash", extra: { reader: "agent-threads" } });
      assert.equal(t.steps.length, 2);
      const step = t.steps[1];
      assert.deepEqual(step.tool_calls, [{ tool_call_id: "call-1", function_name: "bash", arguments: { command: "ls" } }]);
      // The result: its text, its outcome (isError false) and its line's time.
      assert.deepEqual(step.observation.results, [{ source_call_id: "call-1", content: "src\ntests", extra: { result_ts: "2026-09-13T19:37:56.677Z", tool_result_is_error: false } }]);
      // The assistant message's tokens only: Pi's thinking, the tool result's tokens and the
      // compaction's are not read, and the compaction is counted, not a step (R18).
      assert.equal(step.reasoning_content, undefined);
      assert.deepEqual(step.metrics, { prompt_tokens: 130, completion_tokens: 50, cached_tokens: 20, extra: { cache_creation_input_tokens: 10, scope: "turn", model_messages: 1 } });
      assert.equal(step.extra.compactions, 1);
      assert.deepEqual(step.extra.errors, ["This operation was aborted"]);
      assert.deepEqual(t.final_metrics, { total_prompt_tokens: 130, total_completion_tokens: 50, total_cached_tokens: 20, total_steps: 2 });
    } },
    facts: (t) => {
      assert.equal(t.session_id, "pi-session-1");
      assert.deepEqual(t.agent, { name: "pi", version: "0.85.1", model_name: "deepseek/deepseek-v4-flash" });
      assert.equal(t.steps.length, 3);
      const step = t.steps[1];
      assert.equal(step.reasoning_content, "Inspect the files.");
      assert.deepEqual(step.tool_calls[0], { tool_call_id: "call-1", function_name: "bash", arguments: { command: "ls" } });
      assert.equal(step.observation.results[0].content, "src\ntests");
      assert.equal(step.metrics.prompt_tokens, 180);
      assert.equal(step.metrics.completion_tokens, 60);
      assert.equal(step.metrics.cached_tokens, 24);
      assert.ok(Math.abs(step.metrics.cost_usd - 0.009) < 1e-9);
      assert.deepEqual(step.metrics.extra, { cache_write_tokens: 16, reasoning_tokens: 17, pi_total_tokens: 224 });
      assert.equal(step.llm_call_count, 2);
      assert.equal(t.steps[2].extra.pi_event_type, "compaction");
      assert.equal(t.final_metrics.total_prompt_tokens, 217);
      assert.equal(t.final_metrics.total_completion_tokens, 70);
      assert.equal(t.final_metrics.total_cached_tokens, 29);
      assert.ok(Math.abs(t.final_metrics.total_cost_usd - 0.01) < 1e-9);
    },
  },
  {
    id: "pi: uses_only_active_branch_and_preserves_branch_summary",
    files: session(branchEvents),
    diff: { reason: "R19", kind: "not handled", check: (t) => {
      // The branch left behind stays, in file order, and the branch summary is not a step (R18).
      assert.deepEqual(t.steps.map((step) => [step.source, step.message]), [["user", "Start"], ["agent", ""], ["user", "Try another way"], ["agent", "Done"]]);
      assert.deepEqual(t.steps[1].tool_calls.map((call) => call.tool_call_id), ["shared-call"]);
      // A result with no isError and no time: its text, no outcome, and not marked as having none.
      assert.deepEqual(t.steps[1].observation.results, [{ source_call_id: "shared-call", content: "wrong result" }]);
      // These usages give no totalTokens, which Pi's reader needs to count a response.
      assert.deepEqual(t.final_metrics, { total_steps: 4 });
    } },
    facts: (t) => {
      assert.deepEqual(t.steps.map((step) => step.message), ["Start", "The abandoned approach was not useful.", "Try another way", "Done"]);
      assert.equal(t.steps[1].extra.pi_event_type, "branch_summary");
      assert.equal(t.steps[1].extra.from_id, "result-abandoned");
      assert.equal(t.final_metrics.total_prompt_tokens, 30);
      assert.equal(t.final_metrics.total_completion_tokens, 12);
      assert.ok(Math.abs(t.final_metrics.total_cost_usd - 0.03) < 1e-9);
    },
  },
  {
    id: "pi: preserves_model_visible_custom_messages_in_order",
    files: session(customEvents),
    diff: { reason: "R18", kind: "not handled", check: (t) => {
      assert.deepEqual(t.steps.map((step) => [step.source, step.message]), [["user", "Authenticate"], ["agent", "I will authenticate."]]);
    } },
    facts: (t) => {
      assert.deepEqual(t.steps.map((step) => step.message), ["Authenticate", "Authentication is required.", "I will authenticate."]);
      const custom = t.steps[1];
      assert.equal(custom.source, "system");
      assert.deepEqual(custom.extra, { pi_event_id: "mcp-notice", pi_parent_id: "user-1", pi_event_type: "custom_message", custom_type: "mcp-auth-status", display: false, details: { server: "example" } });
    },
  },
  {
    id: "pi: preserves_ordered_image_content",
    files: session(imageEvents),
    diff: { reason: "R5a", kind: "by design", check: (t) => {
      // Text only: no image parts and no files. The result keeps its text and has no outcome.
      assert.equal(t.steps[0].message, "Inspect this");
      assert.deepEqual(t.steps[1].observation.results, [{ source_call_id: "call-1", content: "Rendered image" }]);
    } },
    facts: (t) => {
      const user = t.steps[0].message;
      const observation = t.steps[1].observation.results[0].content;
      // Adapted: both must be lists before their parts are read, so a text message fails on an
      // assertion, not on a type error.
      assert.ok(Array.isArray(user) && Array.isArray(observation));
      assert.deepEqual(user.map((part) => part.type), ["text", "image"]);
      assert.deepEqual(observation.map((part) => part.type), ["text", "image"]);
      assert.deepEqual(user[1].source, { media_type: "image/png", path: "images/pi_image_1.png" });
      assert.deepEqual(observation[1].source, { media_type: "image/png", path: "images/pi_image_2.png" });
    },
  },
  {
    id: "pi: malformed_session_falls_back_to_stream_metrics",
    // Adapted: only the session file is written; Harbor's stale trajectory.json and pi.txt feed
    // its own files and run context, which an export has neither of.
    files: (dir) => {
      const path = join(dir, "session.jsonl");
      writeFileSync(path, "not-json\n");
      return { main: path };
    },
    facts: (t) => {
      assert.equal(t, null);
    },
  },
  {
    id: "pi: invalid_session_encoding_falls_back_to_stream_metrics",
    // Adapted: only the session file is written, as above.
    files: (dir) => {
      const path = join(dir, "session.jsonl");
      writeFileSync(path, Buffer.from([0xff]));
      return { main: path };
    },
    facts: (t) => {
      assert.equal(t, null);
    },
  },
];
