// Adapted from harbor-framework/harbor, tests/unit/agents/installed/test_claude_code_trajectory.py
// and tests/unit/agents/installed/test_codex_trajectory.py at 110c71b32c268e1d113c3856869202842f8e37a6 (0.26.0).
// Copyright the Harbor authors. Apache-2.0; see LICENSE beside this file.
// Ported: the named entries in CLAUDE_CASES below. A prompt wraps private-method
// cases; the nested helper uses an agent-<id>.jsonl file, launch result and first prompt.
import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const stamp = "2026-01-01T00:00:00Z";
export const user = (content, timestamp = stamp) => ({ type: "user", timestamp, sessionId: "test-session", message: { role: "user", content } });
export const assistant = (content, timestamp = "2026-01-01T00:00:01Z", msgId = null) => ({ type: "assistant", timestamp, sessionId: "test-session", version: "2.1.50", message: { model: "claude-opus-4-6", role: "assistant", content, usage: { input_tokens: 100, output_tokens: 50 }, ...(msgId ? { id: msgId } : {}) } });
const text = (value) => ({ type: "text", text: value });
const thinking = (value) => ({ type: "thinking", thinking: value });
const reason = (t) => t.steps.find((step) => step.source === "agent")?.reasoning_content;
const reply = (t) => t.steps.find((step) => step.source === "agent")?.message;
const contentCase = (name, content, facts) => ({ id: `claude: ${name}`, files: (dir) => ({ main: writeSession(dir, "session.jsonl", [user("What is up"), assistant(content)]) }), facts });
const promptCase = (name, prompt, expected) => ({ id: `claude: ${name}`, files: (dir) => ({ main: writeSession(dir, "session.jsonl", [user(prompt)]) }), facts: (t) => assert.equal(t.steps[0].message, expected) });
export function writeSession(dir, name, events) {
  const file = join(dir, name);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  return file;
}

export const CLAUDE_CASES = [
  promptCase("user_event_text_content_block_unwrapped", [{ type: "text", text: "Base directory for this skill: /logs/agent/sessions/skills/xlsx\n\nAll Excel files must be deterministic." }], "Base directory for this skill: /logs/agent/sessions/skills/xlsx\n\nAll Excel files must be deterministic."),
  promptCase("string_content_preserves_trailing_newline", "Please fix this bug.\n\nThanks,\nuser\n", "Please fix this bug.\n\nThanks,\nuser\n"),
  promptCase("string_content_preserves_leading_whitespace", "  indented prompt  ", "  indented prompt  "),
  promptCase("string_content_internal_whitespace_unchanged", "line1\n\n\tindented\nline3", "line1\n\n\tindented\nline3"),
  promptCase("list_content_single_text_block_byte_faithful", [{ type: "text", text: "Please fix this bug.\n\nThanks,\nuser\n" }], "Please fix this bug.\n\nThanks,\nuser\n"),
  {
    ...promptCase("list_content_multiple_text_blocks_joined_verbatim", [{ type: "text", text: "first part keeps trailing spaces   " }, { type: "text", text: "\n\tsecond part keeps its leading newline+tab" }], ""),
    facts: (t) => assert.equal(t.steps[0].message, "first part keeps trailing spaces   \n\n\n\tsecond part keeps its leading newline+tab"),
    diff: { reason: "R4", kind: "not handled", check: (t) => assert.equal(t.steps[0].message, "first part keeps trailing spaces   \n\n\tsecond part keeps its leading newline+tab") },
  },
  {
    ...promptCase("list_content_non_text_non_tool_result_block_json_encoded", [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo" } }, { type: "text", text: "see the screenshot above" }], ""),
    facts: (t) => assert.ok(t.steps[0].message.includes('"type": "image"')),
    diff: { reason: "R5b", kind: "not handled", check: (t) => { assert.equal(t.steps[0].message, "see the screenshot above"); assert.equal(t.steps[0].extra.images, 1); } },
  },
  contentCase("thinking_block_with_thinking_key", [thinking("Let me analyze the problem step by step."), text("Here is my answer.")], (t) => { assert.equal(reason(t), "Let me analyze the problem step by step."); assert.equal(reply(t), "Here is my answer."); }),
  contentCase("thinking_block_with_text_key", [{ type: "thinking", text: "I need to list files first." }, text("Let me check the directory.")], (t) => { assert.equal(reason(t), "I need to list files first."); assert.equal(reply(t), "Let me check the directory."); }),
  contentCase("thinking_block_no_text_or_thinking_key", [{ type: "thinking", signature: "EogCCk..." }], (t) => { assert.ok(reason(t) == null); assert.equal(t.steps.length, 1); }),
  contentCase("thinking_block_with_empty_text_key", [{ type: "thinking", text: "" }], (t) => { assert.ok(reason(t) == null); assert.equal(t.steps.length, 1); }),
  contentCase("multiple_thinking_blocks_concatenated", [thinking("First thought."), thinking("Second thought."), text("Final answer.")], (t) => { assert.equal(reason(t), "First thought.\n\nSecond thought."); assert.equal(reply(t), "Final answer."); }),
  contentCase("thinking_with_tool_calls", [thinking("I should read the file."), { type: "tool_use", id: "toolu_123", name: "Read", input: { file_path: "/app/test.py" } }], (t) => { const step = t.steps.find((s) => s.source === "agent"); assert.equal(step.reasoning_content, "I should read the file."); assert.equal(step.message, ""); assert.equal(step.tool_calls[0].function_name, "Read"); }),
  {
    id: "claude: tool_use_without_result_renders_call_without_observation",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [user("Run"), assistant([{ type: "tool_use", id: "toolu_pending", name: "Bash", input: { command: "sleep" } }], "2026-01-01T00:00:01Z", "msg_pending")]) }),
    diff: { reason: "R7", kind: "by design", check: (t) => { assert.deepEqual(t.steps.map((step) => step.step_id), [1, 2]); assert.equal(t.steps[1].tool_calls[0].tool_call_id, "toolu_pending"); assert.equal(t.steps[1].observation.results[0].source_call_id, "toolu_pending"); assert.equal(t.steps[1].observation.results[0].extra.no_result, true); } },
    facts: (t) => assert.equal(t.steps[1].observation, undefined),
  },
  contentCase("redacted_thinking_opaque_data_dropped", [{ type: "redacted_thinking", data: "encrypted-data-here" }, text("My response.")], (t) => { assert.equal(reply(t), "My response."); assert.ok(!JSON.stringify(t).includes("encrypted-data-here")); }),
  {
    id: "claude: trajectory_has_reasoning_content",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [user([{ type: "text", text: "What files are here?" }]), assistant([{ type: "thinking", thinking: "Let me list the directory contents.", signature: "abc123" }, text("I'll check for you.")])]) }),
    facts: (t) => { assert.equal(reason(t), "Let me list the directory contents."); assert.equal(reply(t), "I'll check for you."); },
  },
  {
    id: "claude: trajectory_thinking_not_literal_null",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [user([{ type: "text", text: "Hello" }]), assistant([{ type: "thinking", thinking: "Analyzing the request.", signature: "sig" }])]) }),
    facts: (t) => { for (const step of t.steps.filter((s) => s.source === "agent")) assert.notEqual(step.reasoning_content, "null"); },
  },
  {
    id: "claude: orphan_tool_result_without_tool_name_does_not_create_step_gap",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [user("Start"), user([{ type: "tool_result", tool_use_id: "toolu_orphan", content: "orphan output" }], "2026-01-01T00:00:01Z"), assistant([text("Still converted.")], "2026-01-01T00:00:02Z")]) }),
    facts: (t) => { assert.deepEqual(t.steps.map((s) => s.step_id), [1, 2]); assert.equal(t.steps[1].message, "Still converted."); },
  },
  {
    id: "claude: text_and_tool_use_in_one_event_bundle_into_one_step",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [user("Do it"), assistant([text("Let me run the command."), { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "echo hi" } }], "2026-01-01T00:00:01Z", "msg_a"), user([{ type: "tool_result", tool_use_id: "toolu_1", content: "hi" }], "2026-01-01T00:00:02Z")]) }),
    facts: (t) => { assert.deepEqual(t.steps.map((s) => s.step_id), [1, 2]); const st = t.steps[1]; assert.equal(st.message, "Let me run the command."); assert.equal(st.tool_calls[0].tool_call_id, "toolu_1"); assert.equal(st.tool_calls[0].function_name, "Bash"); assert.deepEqual(st.tool_calls[0].arguments, { command: "echo hi" }); assert.equal(st.observation.results[0].content, "hi"); },
  },
  {
    id: "claude: multiple_tool_uses_in_one_event_bundle_into_one_step",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [user("Parallel"), assistant([text("Reading both files."), { type: "tool_use", id: "toolu_a", name: "Read", input: { path: "a" } }, { type: "tool_use", id: "toolu_b", name: "Read", input: { path: "b" } }], "2026-01-01T00:00:01Z", "msg_multi"), user([{ type: "tool_result", tool_use_id: "toolu_a", content: "AAA" }], "2026-01-01T00:00:02Z"), user([{ type: "tool_result", tool_use_id: "toolu_b", content: "BBB" }], "2026-01-01T00:00:03Z")]) }),
    facts: (t) => { assert.deepEqual(t.steps.map((s) => s.step_id), [1, 2]); const st = t.steps[1]; assert.deepEqual(st.tool_calls.map((c) => c.tool_call_id), ["toolu_a", "toolu_b"]); assert.deepEqual(Object.fromEntries(st.observation.results.map((r) => [r.source_call_id, r.content])), { toolu_a: "AAA", toolu_b: "BBB" }); },
  },
  {
    id: "claude: same_message_id_split_across_events_bundles",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [user("Go"), assistant([text("Thinking out loud.")], "2026-01-01T00:00:01Z", "msg_split"), assistant([{ type: "tool_use", id: "toolu_split", name: "Bash", input: { command: "ls" } }], "2026-01-01T00:00:02Z", "msg_split"), user([{ type: "tool_result", tool_use_id: "toolu_split", content: "file.txt" }], "2026-01-01T00:00:03Z")]) }),
    facts: (t) => { assert.deepEqual(t.steps.map((s) => s.step_id), [1, 2]); assert.equal(t.steps[1].message, "Thinking out loud."); assert.equal(t.steps[1].tool_calls[0].tool_call_id, "toolu_split"); assert.equal(t.steps[1].observation.results[0].content, "file.txt"); },
  },
  {
    ...contentCase("redacted_thinking_openrouter_payload_decoded_to_reasoning", [{ type: "redacted_thinking", data: `openrouter.reasoning:${Buffer.from(JSON.stringify({ text: "Okay, let me consider the options.", type: "reasoning.text" })).toString("base64")}` }, text("Here is my answer.")], () => {}),
    facts: (t) => assert.equal(reason(t), "Okay, let me consider the options."),
    diff: { reason: "R1", kind: "by design", check: (t) => { assert.equal(reason(t), undefined); assert.equal(reply(t), "Here is my answer."); } },
  },
  {
    id: "claude: distinct_subagent_ids_survive_the_combined_timeline",
    facts: (t) => assert.deepEqual(t.steps.filter((step) => step.extra?.is_sidechain).map((step) => step.extra.agent_id), ["helper-1", "helper-2"]),
    files: (dir) => {
      const main = writeSession(dir, "session.jsonl", [
        user("Fix the bug."),
        assistant([{ type: "tool_use", id: "toolu_task_1", name: "Task", input: { prompt: "Investigate." } }, { type: "tool_use", id: "toolu_task_2", name: "Task", input: { prompt: "Investigate." } }]),
        { ...user([{ type: "tool_result", tool_use_id: "toolu_task_1", content: "agent launched" }], "2026-01-01T00:00:02Z"), toolUseResult: { agentId: "helper-1", status: "completed" } },
        { ...user([{ type: "tool_result", tool_use_id: "toolu_task_2", content: "agent launched" }], "2026-01-01T00:00:03Z"), toolUseResult: { agentId: "helper-2", status: "completed" } },
      ]);
      for (const [index, id] of ["helper-1", "helper-2"].entries()) writeSession(dir, `session/subagents/agent-${id}.jsonl`, [
        { ...user("Investigate.", `2026-01-01T00:00:0${index + 4}Z`), isSidechain: true, agentId: id },
        { ...assistant([text(`Found it ${index + 1}.`)], `2026-01-01T00:00:0${index + 6}Z`), isSidechain: true, agentId: id },
      ]);
      return { main };
    },
    diff: { reason: "R2", kind: "by design", check: (t) => {
      assert.deepEqual(t.subagent_trajectories?.map((sub) => sub.trajectory_id), ["helper-1", "helper-2"]);
      assert.deepEqual(t.subagent_trajectories.map((sub) => sub.steps.at(-1).message), ["Found it 1.", "Found it 2."]);
      assert.equal(t.steps.some((step) => step.message?.startsWith("Found it")), false);
      const call = t.steps.find((step) => step.tool_calls?.[0]?.function_name === "Task");
      assert.deepEqual(call.observation.results.map((result) => result.subagent_trajectory_ref[0].trajectory_id), ["helper-1", "helper-2"]);
    } },
  },
];
