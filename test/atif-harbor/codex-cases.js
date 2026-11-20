// Adapted from harbor-framework/harbor, tests/unit/agents/installed/test_codex_trajectory.py
// and tests/unit/agents/installed/test_claude_code_trajectory.py at 110c71b32c268e1d113c3856869202842f8e37a6 (0.26.0).
// Copyright the Harbor authors. Apache-2.0; see LICENSE. Ported: one_step_per_api_call_with_bundled_tool_calls.
// Adaptation: a UserMessage starts the turn, since Agent Threads requires a prompt.
import { strict as assert } from "node:assert";
import { writeSession } from "./claude-cases.js";
const event = (type, payload, timestamp) => ({ timestamp, type, payload });
const t = (second) => `2026-01-01T00:00:0${second}Z`;
const tokens = (prompt, completion, total) => ({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: prompt, output_tokens: completion, cached_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: total }, total_token_usage: { input_tokens: prompt, output_tokens: completion, cached_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: total } } } });
export const CODEX_CASES = [{
  id: "codex: one_step_per_api_call_with_bundled_tool_calls",
  files: (dir) => ({ main: writeSession(dir, "session.jsonl", [
    event("session_meta", { id: "session-1" }, t(0)),
    event("event_msg", { type: "item_completed", item: { type: "UserMessage", content: [{ type: "input_text", text: "Fix the bug." }] } }, t(0)),
    event("response_item", { type: "reasoning", summary: [{ type: "summary_text", text: "Plan the fix." }] }, t(0)),
    event("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "Inspecting." }] }, t(1)),
    event("response_item", { type: "function_call", call_id: "call_1", name: "shell", arguments: JSON.stringify({ command: "ls" }) }, t(2)),
    event("response_item", { type: "function_call_output", call_id: "call_1", output: "README.md" }, t(3)),
    event("response_item", { type: "function_call", call_id: "call_2", name: "shell", arguments: JSON.stringify({ command: "cat README.md" }) }, t(4)),
    event("response_item", { type: "function_call_output", call_id: "call_2", output: "hello" }, t(5)),
    tokens(100, 20, 120),
    event("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] }, t(6)),
    tokens(150, 5, 155),
  ]) }),
  diff: { reason: "R6", kind: "not handled", check: (trajectory) => {
    const steps = trajectory.steps.filter((step) => step.source === "agent");
    assert.equal(steps[0].message, "Inspecting.");
    assert.equal(steps[0].reasoning_content, "Plan the fix.");
    assert.deepEqual(steps[0].tool_calls.map((call) => call.tool_call_id), ["call_1", "call_2"]);
    assert.deepEqual(steps[0].observation.results.map((result) => result.content), ["README.md", "hello"]);
    assert.equal(steps[1].message, "Done.");
    assert.equal(steps[0].llm_call_count, undefined);
    assert.equal(steps[1].llm_call_count, undefined);
    assert.equal(steps.at(-1).metrics.prompt_tokens, 250);
  } },
  facts: (trajectory) => assert.equal(trajectory.steps.filter((step) => step.source === "agent")[0].llm_call_count, 1),
}];
