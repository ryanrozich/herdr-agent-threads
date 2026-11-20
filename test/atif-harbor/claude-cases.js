// Adapted from harbor-framework/harbor, tests/unit/agents/installed/test_claude_code_trajectory.py
// and tests/unit/agents/installed/test_codex_trajectory.py at 110c71b32c268e1d113c3856869202842f8e37a6 (0.26.0).
// Copyright the Harbor authors. Apache-2.0; see LICENSE beside this file.
// Ported: the named entries in CLAUDE_CASES below. A prompt wraps private-method
// cases; the nested helper uses an agent-<id>.jsonl file, launch result and first prompt.
// Changed from Harbor's original: the pytest functions are translated to JavaScript case entries that
// run our export's command line on the same events; the diff checks are ours, and "Adapted:" marks changed input.
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

const userSteps = (t) => t.steps.filter((step) => step.source === "user");
const agentSteps = (t) => t.steps.filter((step) => step.source === "agent");
const b64 = (s) => Buffer.from(s).toString("base64");
const toolResult = (id, content, timestamp) => user([{ type: "tool_result", tool_use_id: id, content }], timestamp);

const sidechain = (event, agentId = "agent-1", uuid = null) => ({ ...event, isSidechain: true, agentId, ...(uuid ? { uuid } : {}) });
const onModel = (event, model, usage) => ({ ...event, message: { ...event.message, model, usage } });
const haiku = (content, timestamp, msgId = null) => onModel(assistant(content, timestamp, msgId), "claude-haiku-4-5", { input_tokens: 50, output_tokens: 5 });
const sidechainStepsOf = (t) => t.steps.filter((step) => step.extra?.is_sidechain);
// A difference whose export prints "no turns" runs a control: the same session with the stated
// cause removed, which must export. The check asserts both, so another cause of "no turns" fails it.
const session = (events) => (dir) => ({ main: writeSession(dir, "session.jsonl", events) });
const messagesOf = (t) => t.steps.map((step) => step.message);

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
    facts: (t) => {
      assert.ok(t != null);
      assert.equal(userSteps(t).length, 1);
      const message = userSteps(t)[0].message;
      assert.equal(typeof message, "string");
      assert.ok(message.includes('{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo"}}'));
      assert.ok(message.includes("see the screenshot above"));
      assert.ok(message.endsWith("see the screenshot above"));
    },
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
    facts: (t) => {
      assert.ok(t != null);
      assert.deepEqual(t.steps.map((s) => s.step_id), [1, 2]);
      const st = t.steps[1];
      assert.equal(st.source, "agent");
      assert.equal(st.message, "Let me run the command.");
      assert.ok(st.tool_calls != null);
      assert.equal(st.tool_calls.length, 1);
      assert.equal(st.tool_calls[0].tool_call_id, "toolu_1");
      assert.equal(st.tool_calls[0].function_name, "Bash");
      assert.deepEqual(st.tool_calls[0].arguments, { command: "echo hi" });
      assert.ok(st.observation != null);
      assert.equal(st.observation.results.length, 1);
      assert.equal(st.observation.results[0].source_call_id, "toolu_1");
      assert.equal(st.observation.results[0].content, "hi");
      assert.ok(!t.steps.some((s) => (s.message || "").startsWith("Executed ")));
    },
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


  {
    // Adapted: Harbor converts one tool_call record through _convert_event_to_step; here the
    // same call and its output are a whole session (prompt, tool_use, tool_result).
    id: "claude: tool_call_without_message_does_not_fabricate_assistant_text",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [
      user("Run the command"),
      assistant([{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "pwd" } }]),
      toolResult("toolu_1", "/workspace", "2026-01-01T00:00:02Z"),
    ]) }),
    facts: (t) => {
      const step = t.steps.find((s) => s.source === "agent");
      assert.equal(step.message, "");
      assert.ok(step.tool_calls != null);
      assert.equal(step.tool_calls[0].function_name, "Bash");
      assert.ok(step.observation != null);
      assert.equal(step.observation.results[0].content, "/workspace");
    },
  },
  {
    // Adapted: Harbor loops over its three malformed payloads in one test; they share one
    // assistant event here, beside the one text block each iteration asserted against.
    id: "claude: redacted_thinking_openrouter_malformed_payload_dropped",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [
      user("What is up"),
      assistant([
        { type: "redacted_thinking", data: "openrouter.reasoning:not-base64!!!" },
        { type: "redacted_thinking", data: `openrouter.reasoning:${b64("not-json")}` },
        { type: "redacted_thinking", data: `openrouter.reasoning:${b64('{"type":"reasoning.text"}')}` },
        text("Fallback message."),
      ]),
    ]) }),
    facts: (t) => {
      const step = t.steps.find((s) => s.source === "agent");
      assert.ok(step.reasoning_content == null);
      assert.equal(step.message, "Fallback message.");
      assert.ok(!step.message.includes("openrouter.reasoning"));
    },
  },
  {
    id: "claude: string_content_empty_is_skipped",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [user(""), assistant([text("ack")])]) }),
    facts: (t) => { assert.ok(t != null); assert.deepEqual(userSteps(t), []); },
    diff: { reason: "R3", kind: "by design", control: session([user("x"), assistant([text("ack")])]), check: (t, control) => {
      assert.equal(t, null);
      assert.deepEqual(messagesOf(control), ["x", "ack"]);
    } },
  },
  {
    id: "claude: string_content_whitespace_only_is_skipped",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [user("   \n  \t"), assistant([text("ack")])]) }),
    facts: (t) => { assert.ok(t != null); assert.deepEqual(userSteps(t), []); },
    diff: { reason: "R4", kind: "not handled", check: (t) => { assert.equal(userSteps(t).length, 1); assert.equal(userSteps(t)[0].message, "   \n  \t"); } },
  },
  {
    id: "claude: list_content_empty_and_whitespace_only_parts_filtered",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [user([text(""), text("   \n\t"), text("real content with trailing newline\n")])]) }),
    facts: (t) => { assert.ok(t != null); assert.equal(userSteps(t).length, 1); assert.equal(userSteps(t)[0].message, "real content with trailing newline\n"); },
    diff: { reason: "R4", kind: "not handled", check: (t) => assert.equal(userSteps(t)[0].message, "\n   \n\t\nreal content with trailing newline\n") },
  },
  {
    id: "claude: fallback_content_non_str_non_list_byte_faithful",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [user({ hello: "world", trailing_ws_in_value: "x \n" })]) }),
    facts: (t) => {
      assert.ok(t != null);
      assert.equal(userSteps(t).length, 1);
      assert.equal(userSteps(t)[0].message, "{\"hello\": \"world\", \"trailing_ws_in_value\": \"x \\n\"}");
    },
    diff: { reason: "R5b", kind: "not handled", control: session([user("{\"hello\": \"world\", \"trailing_ws_in_value\": \"x \\n\"}")]), check: (t, control) => {
      assert.equal(t, null);
      assert.deepEqual(messagesOf(control), ["{\"hello\": \"world\", \"trailing_ws_in_value\": \"x \\n\"}"]);
    } },
  },
  ...[
    [42, "42"],
    [["a", "b", "c"], "a\n\nb\n\nc"],
    [[1, 2, 3], "1\n\n2\n\n3"],
    [true, "true"],
  ].map(([weirdContent, expected], index) => ({
    id: `claude: fallback_branch_stringifies_non_dict_shapes[${index}]`,
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [user(weirdContent)]) }),
    facts: (t) => {
      assert.ok(t != null);
      assert.equal(userSteps(t).length, 1);
      assert.equal(userSteps(t)[0].message, expected);
    },
    diff: { reason: "R5b", kind: "not handled", control: session([user(expected)]), check: (t, control) => {
      assert.equal(t, null);
      assert.deepEqual(messagesOf(control), [expected]);
    } },
  })),
  {
    id: "claude: list_branch_tool_result_path_unchanged",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [
      user("list the files", "2026-01-01T00:00:00Z"),
      assistant([{ type: "tool_use", id: "toolu_abc", name: "Bash", input: { command: "ls" } }], "2026-01-01T00:00:01Z"),
      toolResult("toolu_abc", "file1.py\nfile2.py\n", "2026-01-01T00:00:02Z"),
    ]) }),
    facts: (t) => {
      assert.ok(t != null);
      const toolCallSteps = agentSteps(t).filter((s) => s.tool_calls);
      assert.equal(toolCallSteps.length, 1, "expected exactly one tool_call step; tool_result may have been absorbed into a different path");
      const observation = toolCallSteps[0].observation;
      assert.ok(observation != null, "tool_call step missing observation; tool_result didn't make it through the tool-result handling branch");
      const observationStr = JSON.stringify(observation);
      const resultStripped = "file1.py\nfile2.py\n".trim();
      const resultEscaped = JSON.stringify(resultStripped).slice(1, -1);
      assert.ok(observationStr.includes(resultStripped) || observationStr.includes(resultEscaped), "observation does not carry the tool_result bytes");
      assert.equal(userSteps(t).length, 1, "expected exactly one user step (the initial instruction); tool_result may have leaked into user text");
      assert.equal(userSteps(t)[0].message, "list the files");
    },
  },
  {
    id: "claude: list_branch_interleaved_text_and_tool_result",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [
      assistant([{ type: "tool_use", id: "toolu_xyz", name: "Read", input: { file_path: "/tmp/x" } }], "2026-01-01T00:00:00Z"),
      user([text("before result"), { type: "tool_result", tool_use_id: "toolu_xyz", content: "tool output payload" }, text("after result")], "2026-01-01T00:00:01Z"),
    ]) }),
    facts: (t) => {
      assert.ok(t != null);
      assert.equal(userSteps(t).length, 1, "expected one user step from the two text blocks");
      assert.equal(userSteps(t)[0].message, "before result\n\nafter result");
      assert.ok(!userSteps(t)[0].message.includes("tool output payload"), "tool_result payload leaked into the text-joined user step");
      const toolCallSteps = agentSteps(t).filter((s) => s.tool_calls);
      assert.equal(toolCallSteps.length, 1);
      const observation = toolCallSteps[0].observation;
      assert.ok(observation != null);
      assert.ok(JSON.stringify(observation).includes("tool output payload"));
    },
    diff: { reason: "R3", kind: "by design", control: session([
      user("Read the file.", "2025-12-31T23:59:59Z"),
      assistant([{ type: "tool_use", id: "toolu_xyz", name: "Read", input: { file_path: "/tmp/x" } }], "2026-01-01T00:00:00Z"),
      user([text("before result"), { type: "tool_result", tool_use_id: "toolu_xyz", content: "tool output payload" }, text("after result")], "2026-01-01T00:00:01Z"),
    ]), check: (t, control) => {
      assert.equal(t, null);
      assert.equal(control.steps[0].message, "Read the file.");
      const call = agentSteps(control).find((step) => step.tool_calls?.[0]?.tool_call_id === "toolu_xyz");
      assert.equal(call.observation.results[0].content, "tool output payload");
    } },
  },
  {
    // Adapted: Harbor writes each payload to its own session; here all five share one, in
    // the test's order.
    id: "claude: stringify_uses_json_dumps_for_non_str",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [
      user(true),
      user(false),
      user({ a: 1, b: "x" }),
      user({ nested: { inner: [1, 2] } }),
      user({ 中文: "value", "emoji_🎉": 1 }),
    ]) }),
    facts: (t) => {
      assert.ok(t != null);
      for (const [payload, expected] of [
        [true, "true"],
        [false, "false"],
        [{ a: 1, b: "x" }, "{\"a\": 1, \"b\": \"x\"}"],
        [{ nested: { inner: [1, 2] } }, "{\"nested\": {\"inner\": [1, 2]}}"],
        [{ 中文: "value", "emoji_🎉": 1 }, "{\"中文\": \"value\", \"emoji_🎉\": 1}"],
      ]) {
        assert.equal(userSteps(t).length, 1, JSON.stringify(payload));
        assert.equal(userSteps(t)[0].message, expected, `json.dumps semantics expected for ${JSON.stringify(payload)}`);
      }
    },
    diff: { reason: "R5b", kind: "not handled", control: session(["true", "false", "{\"a\": 1, \"b\": \"x\"}"].map((value) => user(value))), check: (t, control) => {
      assert.equal(t, null);
      assert.deepEqual(messagesOf(control), ["true", "false", "{\"a\": 1, \"b\": \"x\"}"]);
    } },
  },
  ...["", "a", "a\n", "\na", "\n", "  \t  ", "a  ", "  a", "a\nb\nc", "a\n\nb", "\x00", "héllo", "🎉", "a".repeat(1000)].map((byteSeq, index) => {
    const item = {
      id: `claude: byte_faithful_property_across_inputs[${index}]`,
      files: (dir) => ({ main: writeSession(dir, "session.jsonl", [user(byteSeq), assistant([text("ack")])]) }),
      facts: (t) => {
        assert.ok(t != null);
        const steps = userSteps(t);
        if (byteSeq.trim()) { assert.equal(steps.length, 1); assert.equal(steps[0].message, byteSeq); } else assert.deepEqual(steps, []);
      },
    };
    if (byteSeq === "") item.diff = { reason: "R3", kind: "by design", control: session([user("x"), assistant([text("ack")])]), check: (t, control) => {
      assert.equal(t, null);
      assert.deepEqual(messagesOf(control), ["x", "ack"]);
    } };
    if (byteSeq === "\n" || byteSeq === "  \t  ") item.diff = { reason: "R4", kind: "not handled", check: (t) => { assert.equal(userSteps(t).length, 1); assert.equal(userSteps(t)[0].message, byteSeq); } };
    return item;
  }),
  {
    id: "claude: duplicate_session_uuid_tool_result_is_deduped",
    files: (dir) => {
      const toolUse = { ...assistant([{ type: "tool_use", id: "toolu_duplicate", name: "Bash", input: { command: "echo ok" } }], "2026-01-01T00:00:01Z"), uuid: "assistant-tool-use" };
      const result = { ...toolResult("toolu_duplicate", "ok", "2026-01-01T00:00:02Z"), uuid: "duplicate-tool-result" };
      return { main: writeSession(dir, "session.jsonl", [
        user("Run the command", "2026-01-01T00:00:00Z"),
        toolUse,
        result,
        { type: "system", subtype: "compact_boundary", uuid: "compact-boundary", timestamp: "2026-01-01T00:00:03Z" },
        { ...result },
        assistant([text("Done.")], "2026-01-01T00:00:04Z"),
      ]) };
    },
    facts: (t) => {
      assert.ok(t != null);
      assert.deepEqual(t.steps.map((step) => step.step_id), t.steps.map((_, i) => i + 1));
      const toolSteps = t.steps.filter((step) => step.tool_calls);
      assert.equal(toolSteps.length, 1);
      assert.equal(toolSteps[0].tool_calls[0].function_name, "Bash");
      assert.ok(toolSteps[0].observation != null);
      assert.equal(toolSteps[0].observation.results[0].content, "ok");
    },
  },
  {
    // Adapted: a prompt starts the turn (Agent Threads requires one); Harbor's run log,
    // claude-code.txt, is written into the logs folder as Harbor's test writes it. The step's
    // estimated cost comes from Harbor's mocked price table and is not ported.
    id: "claude: reported_cost_remains_authoritative",
    files: (dir) => {
      writeFileSync(join(dir, "claude-code.txt"), `${JSON.stringify({ type: "result", total_cost_usd: 1.25 })}\n`);
      return { main: writeSession(dir, "projects/test-project/test-session/session.jsonl", [user("Finish."), assistant([text("Done.")], "2026-01-01T00:00:01Z", "msg_done")]) };
    },
    facts: (t) => {
      assert.ok(t != null);
      assert.ok(t.final_metrics != null);
      assert.equal(t.final_metrics.total_cost_usd, 1.25);
      assert.ok(t.final_metrics.extra == null);
    },
    diff: { reason: "R8", kind: "not handled", check: (t) => {
      assert.deepEqual(messagesOf(t), ["Finish.", "Done."]);
      assert.equal(t.final_metrics.total_cost_usd, undefined);
      assert.equal(t.steps[1].metrics.cost_usd, undefined);
      assert.equal(JSON.stringify(t).includes("1.25"), false);
    } },
  },
  {
    id: "claude: agent_steps_carry_llm_call_count",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [user([text("Fix the bug.")]), assistant([text("Looking.")], "2026-01-01T00:00:01Z", "msg_1")]) }),
    facts: (t) => {
      assert.ok(t != null);
      const userStep = t.steps.find((s) => s.source === "user");
      const agentStep = t.steps.find((s) => s.source === "agent");
      assert.ok(userStep.llm_call_count == null);
      assert.equal(agentStep.llm_call_count, 1);
    },
    diff: { reason: "R6", kind: "not handled", check: (t) => {
      assert.deepEqual(t.steps.map((step) => step.source), ["user", "agent"]);
      assert.equal(t.steps[0].message, "Fix the bug.");
      assert.equal(t.steps[1].message, "Looking.");
      assert.ok(t.steps[1].llm_call_count == null);
    } },
  },


  {
    // Adapted: the tool_result gains the launch record toolUseResult.agentId "agent-1", and the
    // helper file is named agent-agent-1.jsonl in the session's subagents folder; its events are
    // Harbor's, the first user event doubling as the prompt the Task call is matched against.
    id: "claude: subagent_file_events_become_sidechain_steps",
    files: (dir) => {
      const main = writeSession(dir, "session.jsonl", [
        user([text("Fix the bug.")], "2026-01-01T00:00:00Z"),
        onModel(assistant([{ type: "tool_use", id: "toolu_task", name: "Task", input: { prompt: "explore the repo" } }], "2026-01-01T00:00:01Z", "msg_main_1"), "claude-opus-4-6", { input_tokens: 100, output_tokens: 10 }),
        { ...toolResult("toolu_task", "subagent finished", "2026-01-01T00:00:04Z"), toolUseResult: { agentId: "agent-1", status: "completed" } },
        onModel(assistant([text("All done.")], "2026-01-01T00:00:05Z", "msg_main_2"), "claude-opus-4-6", { input_tokens: 200, output_tokens: 20 }),
      ]);
      writeSession(dir, "session/subagents/agent-agent-1.jsonl", [
        sidechain(user([text("explore the repo")], "2026-01-01T00:00:02Z")),
        sidechain(haiku([text("Repo explored.")], "2026-01-01T00:00:03Z", "msg_sub_1")),
      ]);
      return { main };
    },
    facts: (t) => {
      assert.ok(t);
      const sidechainSteps = sidechainStepsOf(t);
      assert.equal(sidechainSteps.length, 2);
      assert.deepEqual(new Set(sidechainSteps.map((step) => step.extra.agent_id)), new Set(["agent-1"]));
      assert.ok(t.steps.filter((step) => !sidechainSteps.includes(step)).every((step) => !("agent_id" in (step.extra ?? {}))));
      const subagentStep = sidechainSteps.find((step) => step.source === "agent");
      assert.equal(subagentStep.model_name, "claude-haiku-4-5");
      assert.ok(subagentStep.metrics != null);
      assert.equal(subagentStep.metrics.prompt_tokens, 50);
      assert.ok(t.final_metrics != null);
      assert.equal(t.final_metrics.total_prompt_tokens, 100 + 200 + 50);
      assert.equal(t.final_metrics.total_completion_tokens, 10 + 20 + 5);
      assert.equal(t.agent.model_name, "claude-opus-4-6");
      const firstUserStep = t.steps.find((step) => step.source === "user");
      assert.equal(firstUserStep.message, "Fix the bug.");
      const subagentIndex = t.steps.indexOf(subagentStep);
      const taskCallIndex = t.steps.findIndex((step) => step.tool_calls);
      const finalIndex = t.steps.findIndex((step) => step.message === "All done.");
      assert.ok(taskCallIndex < subagentIndex && subagentIndex < finalIndex);
    },
    diff: { reason: "R2", kind: "by design", check: (t) => {
      assert.deepEqual(t.steps.map((step) => step.message), ["Fix the bug.", "", "All done."]);
      assert.equal(sidechainStepsOf(t).length, 0);
      const sub = t.subagent_trajectories[0];
      assert.equal(sub.trajectory_id, "agent-1");
      assert.deepEqual(sub.steps.map((step) => step.message), ["explore the repo", "Repo explored."]);
      assert.equal(sub.steps[1].model_name, "claude-haiku-4-5");
      assert.equal(sub.steps[1].metrics.prompt_tokens, 50);
      assert.equal(t.final_metrics.total_prompt_tokens, 350);
      assert.equal(t.final_metrics.total_completion_tokens, 35);
      assert.equal(t.agent.model_name, "claude-opus-4-6");
      const result = t.steps[1].observation.results[0];
      assert.equal(result.content, "subagent finished");
      assert.deepEqual(result.subagent_trajectory_ref, [{ trajectory_id: "agent-1", session_id: "session" }]);
    } },
  },
  {
    // Adapted: the helper file is agent-agent-1.jsonl in the session's subagents folder and gains a
    // first prompt, since our export reads a subagent only as a transcript of its own; the
    // duplicated event itself, uuid and all, is Harbor's.
    id: "claude: subagent_events_deduped_by_uuid_across_files",
    files: (dir) => {
      const duplicated = sidechain(haiku([text("Repo explored.")], "2026-01-01T00:00:02Z", "msg_sub_1"), "agent-1", "uuid-sub-1");
      const main = writeSession(dir, "session.jsonl", [user([text("Fix the bug.")], "2026-01-01T00:00:00Z"), duplicated]);
      writeSession(dir, "session/subagents/agent-agent-1.jsonl", [sidechain(user([text("explore the repo")], "2026-01-01T00:00:01Z")), duplicated]);
      return { main };
    },
    facts: (t) => {
      assert.ok(t);
      assert.equal(t.steps.filter((step) => step.message === "Repo explored.").length, 1);
      assert.ok(t.final_metrics != null);
      assert.equal(t.final_metrics.total_prompt_tokens, 50);
    },
    diff: { reason: "R2", kind: "by design", check: (t) => {
      assert.equal(t.steps.filter((step) => step.message === "Repo explored.").length, 0);
      const sub = t.extra.subagents_no_call_names[0].trajectory;
      assert.equal(sub.trajectory_id, "agent-1");
      assert.equal(sub.steps.filter((step) => step.message === "Repo explored.").length, 1);
      assert.equal(sub.final_metrics.total_prompt_tokens, 50);
      assert.equal(t.subagent_trajectories, undefined);
      assert.equal(t.final_metrics.total_prompt_tokens, undefined);
    } },
  },
  {
    id: "claude: inline_sidechain_events_stay_chronological",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [
      user([text("Fix the bug.")], "2026-01-01T00:00:00Z"),
      sidechain(user([text("explore the repo")], "2026-01-01T00:00:01Z")),
      assistant([text("All done.")], "2026-01-01T00:00:02Z", "msg_main_1"),
    ]) }),
    facts: (t) => {
      assert.ok(t);
      const firstUserStep = t.steps.find((step) => step.source === "user");
      assert.equal(firstUserStep.message, "Fix the bug.");
    },
  },
  {
    // Adapted: the helper file is agent-agent-1.jsonl in the session's subagents folder; Harbor's
    // rglob finds it with no call naming it, and our export reads it the same way (a transcript no
    // call names) but builds nothing from it without a prompt, so the main chain decides the model.
    id: "claude: root_model_prefers_main_chain_over_earlier_sidechain",
    files: (dir) => {
      const main = writeSession(dir, "session.jsonl", [
        user([text("Fix the bug.")], "2026-01-01T00:00:00Z"),
        assistant([text("Done.")], "2026-01-01T00:00:03Z", "msg_main_1"),
      ]);
      writeSession(dir, "session/subagents/agent-agent-1.jsonl", [sidechain(haiku([text("Repo explored.")], "2026-01-01T00:00:01Z", "msg_sub_1"))]);
      return { main };
    },
    facts: (t) => {
      assert.ok(t);
      assert.equal(t.agent.model_name, "claude-opus-4-6");
    },
  },
  {
    // Adapted: Harbor's session uuid and home-style project folder become a 00000000- uuid and a
    // synthetic path, and the helper file gains a first prompt (our export reads a subagent only as
    // a transcript of its own); the event sequence, ids and asserted values are Harbor's. Harbor's
    // logs-dir discovery assertion is carried by files() returning this exact production layout.
    id: "claude: verbatim_production_layout",
    files: (dir) => {
      const sid = "00000000-0000-4708-8d5c-1f453f0eb05c";
      const main = writeSession(dir, `sessions/projects/-logs-dev-app/${sid}.jsonl`, [
        { ...user([text("Fix the bug.")], "2026-01-01T00:00:00Z"), sessionId: sid },
        { ...assistant([text("All done.")], "2026-01-01T00:00:03Z", "msg_main_1"), sessionId: sid },
      ]);
      writeSession(dir, `sessions/projects/-logs-dev-app/${sid}/subagents/agent-a4e70aa0cbe15c6ff.jsonl`, [
        { ...sidechain(user([text("explore the repo")], "2026-01-01T00:00:00Z"), "a4e70aa0cbe15c6ff"), sessionId: sid },
        { ...sidechain(haiku([text("Repo explored.")], "2026-01-01T00:00:01Z", "msg_sub_1"), "a4e70aa0cbe15c6ff"), sessionId: sid },
      ]);
      return { main };
    },
    facts: (t) => {
      assert.ok(t);
      assert.equal(t.session_id, "00000000-0000-4708-8d5c-1f453f0eb05c");
      const sidechainSteps = sidechainStepsOf(t);
      assert.deepEqual(sidechainSteps.map((step) => step.message), ["Repo explored."]);
      assert.equal(sidechainSteps[0].model_name, "claude-haiku-4-5");
    },
    diff: { reason: "R2", kind: "by design", check: (t) => {
      assert.equal(t.session_id, "00000000-0000-4708-8d5c-1f453f0eb05c");
      assert.deepEqual(t.steps.map((step) => step.message), ["Fix the bug.", "All done."]);
      assert.equal(sidechainStepsOf(t).length, 0);
      const sub = t.extra.subagents_no_call_names[0].trajectory;
      assert.equal(sub.trajectory_id, "a4e70aa0cbe15c6ff");
      assert.equal(sub.steps.at(-1).message, "Repo explored.");
      assert.equal(sub.steps.at(-1).model_name, "claude-haiku-4-5");
    } },
  },

];
