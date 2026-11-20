// Adapted from harbor-framework/harbor, tests/unit/agents/installed/test_codex_trajectory.py
// and tests/unit/agents/installed/test_claude_code_trajectory.py at 110c71b32c268e1d113c3856869202842f8e37a6 (0.26.0).
// Copyright the Harbor authors. Apache-2.0; see LICENSE. Ported: one_step_per_api_call_with_bundled_tool_calls.
// Adaptation: a UserMessage starts the turn, since Agent Threads requires a prompt.
<<<<<<< HEAD
=======
// Changed from Harbor's original: the pytest functions are translated to JavaScript case entries that run our
// export's command line; litellm price mocks are dropped, the diff checks are ours, and "Adapted:" marks changed input.
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { writeSession } from "./claude-cases.js";

const event = (type, payload, timestamp) => ({ timestamp, type, payload });
const t = (second) => `2026-01-01T00:00:0${second}Z`;
const tokens = (prompt, completion, total) => ({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: prompt, output_tokens: completion, cached_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: total }, total_token_usage: { input_tokens: prompt, output_tokens: completion, cached_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: total } } } });
const ctEvent = (timestamp, type, payload) => ({ timestamp, type, payload });
const ctPrompt = (text) => ctEvent(t(0), "event_msg", { type: "item_completed", item: { type: "UserMessage", content: [{ type: "input_text", text }] } });
const ctMeta = (id) => ctEvent(t(0), "session_meta", { id });
const mcpSession = (output) => [ctMeta("session-mcp"), ctPrompt("Use the tool."), ctEvent(t(0), "response_item", { type: "function_call", call_id: "call_mcp", name: "mcp__server__tool", arguments: "{}" }), ctEvent(t(1), "response_item", { type: "function_call_output", call_id: "call_mcp", output })];
const step = (tr) => tr.steps.find((s) => s.source === "agent");
const mcpResult = (tr) => {
  const s = step(tr);
  assert.ok(s.observation);
  assert.equal(s.observation.results.length, 1);
  const r = s.observation.results[0];
  assert.equal(r.source_call_id, "call_mcp");
  return r;
};
const toolCase = (id, output, facts, diff) => ({ id, files: (dir) => ({ main: writeSession(dir, "session.jsonl", mcpSession(output)) }), facts, diff });

const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-image-bytes")]);
const PNG_B64 = PNG_BYTES.toString("base64");
const NICKNAMES = { alpha: "Alpha", beta: "Beta" };

const stamp = (second) => `2026-01-01T00:00:0${second}Z`;
const imgEvent = (second, ordinal, type, payload) => ({ timestamp: stamp(second), ordinal, type, payload });
const meta = (id, parent = null, path = null, boundary = null, nickname = null) => {
  const payload = { id };
  if (parent != null) {
    const threadSpawn = { parent_thread_id: parent };
    if (path != null) threadSpawn.agent_path = path;
    if (nickname != null) threadSpawn.agent_nickname = nickname;
    payload.source = { subagent: { thread_spawn: threadSpawn } };
    if (boundary != null) payload.subagent_history_start_ordinal = boundary;
  }
  return imgEvent(0, 0, "session_meta", payload);
};
const message = (text, ordinal, second = 1) => imgEvent(second, ordinal, "response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text }] });
const imgTokens = (prompt, completion, { cached = 0, ordinal = 2, second = 2, totalPrompt = null, totalCompletion = null } = {}) => {
  const last = { input_tokens: prompt, output_tokens: completion, cached_input_tokens: cached, cache_write_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: prompt + completion };
  const cumulative = { ...last, input_tokens: totalPrompt ?? prompt, output_tokens: totalCompletion ?? completion };
  cumulative.total_tokens = cumulative.input_tokens + cumulative.output_tokens;
  return imgEvent(second, ordinal, "event_msg", { type: "token_count", info: { last_token_usage: last, total_token_usage: cumulative } });
};
const spawn = (name, path, ordinal) => [
  imgEvent(0, ordinal, "response_item", { type: "function_call", name: "spawn_agent", call_id: `spawn_${name}`, arguments: JSON.stringify({ task_name: name }) }),
  imgEvent(0, ordinal + 1, "response_item", { type: "function_call_output", call_id: `spawn_${name}`, output: JSON.stringify({ task_name: path }) }),
];
const imgPrompt = (text, ordinal) => imgEvent(0, ordinal, "event_msg", { type: "item_completed", item: { type: "UserMessage", content: [{ type: "input_text", text }] } });
const turnContext = (model, ordinal) => imgEvent(0, ordinal, "turn_context", { model });
const mcpCall = (output, ordinal = 2) => [
  imgEvent(0, ordinal, "response_item", { type: "function_call", call_id: "call_mcp", name: "mcp__server__tool", arguments: "{}" }),
  imgEvent(1, ordinal + 1, "response_item", { type: "function_call_output", call_id: "call_mcp", output }),
];

let scratchDir = null;
const write = (dir, name, events) => {
  scratchDir = dir;
  return writeSession(dir, name, events);
};
const writeDay = (dir, name, events) => write(dir, `sessions/2026/01/01/rollout-${name}.jsonl`, events);

const mcpContent = (t) => {
  const step = t.steps.find((s) => s.tool_calls?.some((c) => c.tool_call_id === "call_mcp"));
  assert.ok(step?.observation != null);
  assert.equal(step.observation.results.length, 1);
  const [result] = step.observation.results;
  assert.equal(result.source_call_id, "call_mcp");
  return result.content;
};

const modelUsage = (t) => {
  const usage = {};
  const unpriced = new Set();
  const walk = (tr) => {
    for (const step of tr.steps ?? []) {
      const model = step.model_name ?? tr.agent?.model_name ?? null;
      if (model == null || step.metrics == null) continue;
      if (usage[model] == null) usage[model] = { n_input_tokens: 0, n_cache_tokens: 0, n_output_tokens: 0, cost_usd: 0 };
      const total = usage[model];
      total.n_input_tokens += step.metrics.prompt_tokens ?? 0;
      total.n_cache_tokens += step.metrics.cached_tokens ?? 0;
      total.n_output_tokens += step.metrics.completion_tokens ?? 0;
      if (typeof step.metrics.cost_usd === "number") total.cost_usd += step.metrics.cost_usd;
      else if (step.metrics.prompt_tokens || step.metrics.completion_tokens) unpriced.add(model);
    }
    for (const sub of tr.subagent_trajectories ?? []) walk(sub);
  };
  walk(t);
  for (const model of unpriced) usage[model].cost_usd = null;
  return usage;
};
const approx = (actual, expected) => assert.ok(typeof actual === "number" && Math.abs(actual - expected) < 1e-9, `${actual} is not approximately ${expected}`);
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
},

  {
    id: "codex: tool_call_without_message_does_not_fabricate_assistant_text",
    // Adapted: the normalized tool event becomes its rollout pair (function_call + output); a UserMessage starts the turn.
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [
      ctMeta("session-1"),
      ctPrompt("Where am I?"),
      ctEvent(t(0), "response_item", { type: "function_call", call_id: "call_1", name: "shell", arguments: JSON.stringify({ command: "pwd" }) }),
      ctEvent(t(1), "response_item", { type: "function_call_output", call_id: "call_1", output: "/workspace" }),
    ]) }),
    facts: (tr) => {
      const s = step(tr);
      assert.equal(s.message, "");
      assert.ok(s.tool_calls);
      assert.equal(s.tool_calls[0].function_name, "shell");
      assert.ok(s.observation);
      assert.equal(s.observation.results[0].content, "/workspace");
    },
  },
  {
    id: "codex: converted_trajectory_emits_latest_atif_version",
    // Adapted: a UserMessage starts the turn.
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [
      ctMeta("session-1"),
      ctPrompt("Go"),
      ctEvent(t(0), "response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] }),
    ]) }),
    facts: (tr) => {
      assert.ok(tr);
      assert.equal(tr.schema_version, "ATIF-v1.7");
    },
  },
  {
    id: "codex: user_messages_are_never_grouped",
    // Adapted: a UserMessage item starts the turn (the role:user response_item alone makes no turn in our reader).
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [
      ctMeta("session-2"),
      ctPrompt("Fix the bug."),
      ctEvent(t(0), "response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "Fix the bug." }] }),
      ctEvent(t(1), "response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "On it." }] }),
      tokens(50, 10, 60),
    ]) }),
    diff: { reason: "R6", kind: "not handled", check: (tr) => {
      assert.deepEqual(tr.steps.map((s) => s.source), ["user", "agent"]);
      const [userStep, agentStep] = tr.steps;
      assert.equal(userStep.message, "Fix the bug.");
      assert.equal(agentStep.message, "On it.");
      assert.ok(userStep.llm_call_count == null);
      assert.ok(agentStep.llm_call_count == null);
    } },
    facts: (tr) => {
      assert.deepEqual(tr.steps.map((s) => s.source), ["user", "agent"]);
      const [userStep, agentStep] = tr.steps;
      assert.ok(userStep.llm_call_count == null);
      assert.equal(agentStep.llm_call_count, 1);
    },
  },
  {
    id: "codex: web_search_calls_preserve_native_ids_and_get_unique_fallbacks",
    // Adapted: a UserMessage starts the turn.
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [
      ctMeta("session-search"),
      ctPrompt("Search the web."),
      ctEvent(t(0), "response_item", { type: "web_search_call", id: "ws_first", status: "completed", action: { type: "search", query: "first query" } }),
      ctEvent(t(1), "response_item", { type: "web_search_call", id: "ws_second", status: "completed", action: { type: "search", query: "second query" } }),
      ctEvent(t(2), "response_item", { type: "web_search_call", status: "completed", action: { type: "search", query: "fallback query" } }),
      ctEvent(t(3), "response_item", { type: "web_search_call", id: "   ", status: "completed", action: { type: "search", query: "blank id query" } }),
    ]) }),
    diff: { reason: "R9", kind: "not handled", check: (tr) => {
      assert.equal(tr.steps.length, 2);
      const s = step(tr);
      const callIds = s.tool_calls.map((c) => c.tool_call_id);
      assert.deepEqual(callIds, ["1767225600|ar0tvq|1#2.1", "1767225600|ar0tvq|1#2.2", "1767225600|ar0tvq|1#2.3", "1767225600|ar0tvq|1#2.4"]);
      assert.equal(new Set(callIds).size, 4);
      assert.ok(s.tool_calls.every((c) => c.function_name === "web_search" && c.extra.id_from_reader === true));
      assert.deepEqual(s.tool_calls.map((c) => c.extra.input), ["first query", "second query", "fallback query", "blank id query"]);
      assert.deepEqual(s.tool_calls.map((c) => c.arguments), [{}, {}, {}, {}]);
      assert.equal(s.observation, undefined);
    } },
    facts: (tr) => {
      assert.equal(tr.steps.length, 1);
      const s = tr.steps[0];
      assert.ok(s.tool_calls);
      const callIds = s.tool_calls.map((c) => c.tool_call_id);
      assert.deepEqual(callIds, ["ws_first", "ws_second", "api_call_1_web_search_2", "api_call_1_web_search_3"]);
      assert.equal(new Set(callIds).size, 4);
      assert.ok(s.observation);
      assert.deepEqual(s.observation.results.map((r) => r.source_call_id), callIds);
      assert.deepEqual(s.tool_calls.map((c) => c.arguments.query), ["first query", "second query", "fallback query", "blank id query"]);
    },
  },
  toolCase("codex: json_encoded_mcp_text_content_becomes_plain_text", '[{"type": "text", "text": "hello"}, {"type": "text", "text": "{\\"status\\": \\"ok\\"}"}]', (tr) => assert.equal(mcpResult(tr).content, 'hello\n{"status": "ok"}')),
  toolCase("codex: content_item_array_becomes_plain_text", [{ type: "input_text", text: "first" }, { type: "input_text", text: "second" }], (tr) => assert.equal(mcpResult(tr).content, "first\nsecond")),
  toolCase("codex: other_blocks_are_kept_as_json_text[0]", [{ type: "input_text", text: "see:" }, { type: "resource_link", uri: "file:///notes.txt", name: "notes" }],
    (tr) => assert.equal(mcpResult(tr).content, 'see:\n{"type": "resource_link", "uri": "file:///notes.txt", "name": "notes"}'),
    { reason: "R5b", kind: "not handled", check: (tr) => assert.equal(mcpResult(tr).content, "see:") }),
  toolCase("codex: other_blocks_are_kept_as_json_text[1]", [{ type: "input_text", text: "see:" }, { type: "audio", data: "QUJD", mimeType: "audio/wav" }],
    (tr) => assert.equal(mcpResult(tr).content, 'see:\n{"type": "audio", "data": "QUJD", "mimeType": "audio/wav"}'),
    { reason: "R5b", kind: "not handled", check: (tr) => assert.equal(mcpResult(tr).content, "see:") }),
  toolCase("codex: other_blocks_are_kept_as_json_text[2]", [{ type: "input_text", text: "see:" }, { type: "input_audio", audio_url: "data:audio/wav;base64,QUJD" }],
    (tr) => assert.equal(mcpResult(tr).content, 'see:\n{"type": "input_audio", "audio_url": "data:audio/wav;base64,QUJD"}'),
    { reason: "R5b", kind: "not handled", check: (tr) => assert.equal(mcpResult(tr).content, "see:") }),
  toolCase("codex: other_blocks_are_kept_as_json_text[3]", [{ type: "input_text", text: "see:" }, { type: "encrypted_content", encrypted_content: "opaque" }],
    (tr) => assert.equal(mcpResult(tr).content, 'see:\n{"type": "encrypted_content", "encrypted_content": "opaque"}'),
    { reason: "R5b", kind: "not handled", check: (tr) => assert.equal(mcpResult(tr).content, "see:") }),
  toolCase("codex: structured_output_with_odd_type_values_is_kept_verbatim[0]", '[{"type": ["text"], "name": "x"}]',
    (tr) => assert.equal(mcpResult(tr).content, '[{"type": ["text"], "name": "x"}]'),
    { reason: "R5b", kind: "not handled", check: (tr) => assert.equal(mcpResult(tr).content, "") }),
  toolCase("codex: structured_output_with_odd_type_values_is_kept_verbatim[1]", '[{"type": {"kind": "text"}}]',
    (tr) => assert.equal(mcpResult(tr).content, '[{"type": {"kind": "text"}}]'),
    { reason: "R5b", kind: "not handled", check: (tr) => assert.equal(mcpResult(tr).content, "") }),
  toolCase("codex: structured_output_with_odd_type_values_is_kept_verbatim[2]", '[{"type": null}]',
    (tr) => assert.equal(mcpResult(tr).content, '[{"type": null}]'),
    { reason: "R5b", kind: "not handled", check: (tr) => assert.equal(mcpResult(tr).content, "") }),
  toolCase("codex: structured_output_with_odd_type_values_is_kept_verbatim[3]", '[{"type": 1, "text": "hi"}]',
    (tr) => assert.equal(mcpResult(tr).content, '[{"type": 1, "text": "hi"}]'),
    { reason: "R5b", kind: "not handled", check: (tr) => assert.equal(mcpResult(tr).content, "") }),
  toolCase("codex: structured_output_with_odd_type_values_is_kept_verbatim[4]", '[{"type": "text", "text": "hi"}, {"name": "no type"}]',
    (tr) => assert.equal(mcpResult(tr).content, '[{"type": "text", "text": "hi"}, {"name": "no type"}]'),
    { reason: "R5b", kind: "not handled", check: (tr) => assert.equal(mcpResult(tr).content, "hi") }),
  toolCase("codex: dict_output_that_is_not_a_string_is_kept_as_json[0]", '{"output": 5, "metadata": {"exit_code": 0}}',
    (tr) => {
      assert.equal(mcpResult(tr).content, "5");
<<<<<<< HEAD
      assert.deepEqual(step(tr).extra.tool_call_details.call_mcp.metadata, { exit_code: 0 });
    },
    { reason: "R5a", kind: "by design", check: (tr) => {
=======
      assert.deepEqual(step(tr).extra?.tool_call_details?.call_mcp?.metadata, { exit_code: 0 });
    },
    { reason: "R5a", kind: "not handled", check: (tr) => {
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
      assert.equal(mcpResult(tr).content, "5");
      assert.equal(step(tr).extra?.tool_call_details, undefined);
    } }),
  toolCase("codex: dict_output_that_is_not_a_string_is_kept_as_json[1]", '{"output": true, "metadata": {"exit_code": 0}}',
    (tr) => {
      assert.equal(mcpResult(tr).content, "true");
<<<<<<< HEAD
      assert.deepEqual(step(tr).extra.tool_call_details.call_mcp.metadata, { exit_code: 0 });
    },
    { reason: "R5a", kind: "by design", check: (tr) => {
=======
      assert.deepEqual(step(tr).extra?.tool_call_details?.call_mcp?.metadata, { exit_code: 0 });
    },
    { reason: "R5a", kind: "not handled", check: (tr) => {
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
      assert.equal(mcpResult(tr).content, "true");
      assert.equal(step(tr).extra?.tool_call_details, undefined);
    } }),
  toolCase("codex: dict_output_that_is_not_a_string_is_kept_as_json[2]", '{"output": [1, "two"], "metadata": {"exit_code": 0}}',
    (tr) => {
      assert.equal(mcpResult(tr).content, '[1, "two"]');
<<<<<<< HEAD
      assert.deepEqual(step(tr).extra.tool_call_details.call_mcp.metadata, { exit_code: 0 });
    },
    { reason: "R5a", kind: "by design", check: (tr) => {
=======
      assert.deepEqual(step(tr).extra?.tool_call_details?.call_mcp?.metadata, { exit_code: 0 });
    },
    { reason: "R5a", kind: "not handled", check: (tr) => {
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
      assert.equal(mcpResult(tr).content, "");
      assert.equal(step(tr).extra?.tool_call_details, undefined);
    } }),
  toolCase("codex: dict_output_that_is_not_a_string_is_kept_as_json[3]", '{"output": {"nested": null}, "metadata": {"exit_code": 0}}',
    (tr) => {
      assert.equal(mcpResult(tr).content, '{"nested": null}');
<<<<<<< HEAD
      assert.deepEqual(step(tr).extra.tool_call_details.call_mcp.metadata, { exit_code: 0 });
    },
    { reason: "R5a", kind: "by design", check: (tr) => {
=======
      assert.deepEqual(step(tr).extra?.tool_call_details?.call_mcp?.metadata, { exit_code: 0 });
    },
    { reason: "R5a", kind: "not handled", check: (tr) => {
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
      assert.equal(mcpResult(tr).content, '{"nested":null}');
      assert.equal(step(tr).extra?.tool_call_details, undefined);
    } }),
  toolCase("codex: dict_output_that_is_not_a_string_is_kept_as_json[4]", '{"output": "", "metadata": {"exit_code": 0}}',
    (tr) => {
      assert.equal(mcpResult(tr).content, "");
<<<<<<< HEAD
      assert.deepEqual(step(tr).extra.tool_call_details.call_mcp.metadata, { exit_code: 0 });
    },
    { reason: "R5a", kind: "by design", check: (tr) => {
=======
      assert.deepEqual(step(tr).extra?.tool_call_details?.call_mcp?.metadata, { exit_code: 0 });
    },
    { reason: "R5a", kind: "not handled", check: (tr) => {
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
      assert.equal(mcpResult(tr).content, "");
      assert.equal(step(tr).extra?.tool_call_details, undefined);
    } }),
  toolCase("codex: other_json_values_are_not_python_reprs[0]", "plain text", (tr) => assert.equal(mcpResult(tr).content, "plain text")),
  toolCase("codex: other_json_values_are_not_python_reprs[1]", "true", (tr) => assert.equal(mcpResult(tr).content, "true")),
  toolCase("codex: other_json_values_are_not_python_reprs[2]", "null", (tr) => assert.equal(mcpResult(tr).content, "null")),
  toolCase("codex: other_json_values_are_not_python_reprs[3]", '"quoted"',
    (tr) => assert.equal(mcpResult(tr).content, '"quoted"'),
<<<<<<< HEAD
    { reason: "R5a", kind: "by design", check: (tr) => assert.equal(mcpResult(tr).content, "quoted") }),
  toolCase("codex: other_json_values_are_not_python_reprs[4]", "[1, 2]",
    (tr) => assert.equal(mcpResult(tr).content, "[1, 2]"),
    { reason: "R5a", kind: "by design", check: (tr) => assert.equal(mcpResult(tr).content, "") }),
  toolCase("codex: other_json_values_are_not_python_reprs[5]", "[]",
    (tr) => assert.equal(mcpResult(tr).content, "[]"),
    { reason: "R5a", kind: "by design", check: (tr) => assert.equal(mcpResult(tr).content, "") }),
=======
    { reason: "R5a", kind: "not handled", check: (tr) => assert.equal(mcpResult(tr).content, "quoted") }),
  toolCase("codex: other_json_values_are_not_python_reprs[4]", "[1, 2]",
    (tr) => assert.equal(mcpResult(tr).content, "[1, 2]"),
    { reason: "R5a", kind: "not handled", check: (tr) => assert.equal(mcpResult(tr).content, "") }),
  toolCase("codex: other_json_values_are_not_python_reprs[5]", "[]",
    (tr) => assert.equal(mcpResult(tr).content, "[]"),
    { reason: "R5a", kind: "not handled", check: (tr) => assert.equal(mcpResult(tr).content, "") }),
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
  toolCase("codex: other_json_values_are_not_python_reprs[6]", '[{"type": "user", "name": "bob"}]',
    (tr) => assert.equal(mcpResult(tr).content, '[{"type": "user", "name": "bob"}]'),
    { reason: "R5b", kind: "not handled", check: (tr) => assert.equal(mcpResult(tr).content, "") }),
  toolCase("codex: other_json_values_are_not_python_reprs[7]", [1, "two"],
    (tr) => assert.equal(mcpResult(tr).content, '[1, "two"]'),
<<<<<<< HEAD
    { reason: "R5a", kind: "by design", check: (tr) => assert.equal(mcpResult(tr).content, "") }),
=======
    { reason: "R5a", kind: "not handled", check: (tr) => assert.equal(mcpResult(tr).content, "") }),
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c


  {
    id: "codex: codex_subagent_rollouts_use_atif_children_without_copied_history",
    // Adapted: a UserMessage starts the main and each child rollout (Agent Threads requires a prompt);
    // each child's own events are renumbered from its subagent_history_start_ordinal.
    files: (dir) => {
      const main = writeDay(dir, "00-root", [
        meta("root"),
        imgPrompt("Oversee the subagents.", 0),
        ...spawn("alpha", "/root/alpha", 1),
        ...spawn("beta", "/root/beta", 3),
        message("parent done", 5),
        imgTokens(100, 10, { cached: 40, ordinal: 6 }),
      ]);
      for (const name of ["alpha", "beta"]) writeDay(dir, name, [
        meta(name, "root", `/root/${name}`, 4, NICKNAMES[name]),
        imgEvent(0, 1, "session_meta", { id: "root" }),
        message("copied parent history", 2),
        imgTokens(999, 99, { cached: 999, ordinal: 3 }),
        imgPrompt(`Do the ${name} task.`, 4),
        message(`${name} child work`, 5),
        imgTokens(name === "alpha" ? 50 : 70, name === "alpha" ? 5 : 7, { cached: name === "alpha" ? 0 : 20, ordinal: 6 }),
      ]);
      return { main };
    },
    facts: (t) => {
      assert.ok(t != null);
      assert.equal(t.session_id, "root");
      assert.equal(t.trajectory_id, "root");
      assert.ok(t.subagent_trajectories != null);
      const children = new Map(t.subagent_trajectories.map((child) => [child.trajectory_id, child]));
      assert.deepEqual([...children.keys()].sort(), ["alpha", "beta"]);
      for (const [name, child] of children) {
        assert.equal(child.session_id, "root");
        assert.deepEqual(child.steps.map((step) => step.message), [`${name} child work`]);
        assert.deepEqual(child.steps.map((step) => step.step_id), [1]);
        assert.equal(child.agent.extra.agent_nickname, NICKNAMES[name]);
      }
      const refs = new Set(t.steps.flatMap((step) => step.observation?.results ?? []).flatMap((result) => (result.subagent_trajectory_ref ?? []).map((ref) => ref.trajectory_id)));
      assert.deepEqual([...refs].sort(), ["alpha", "beta"]);
      assert.ok(t.final_metrics != null);
      assert.equal(t.final_metrics.total_prompt_tokens, 220);
      assert.equal(t.final_metrics.total_completion_tokens, 22);
      assert.equal(t.final_metrics.total_cached_tokens, 60);
      approx(t.final_metrics.total_cost_usd, 0.22);
      assert.equal(t.final_metrics.total_steps, t.steps.length);
      assert.equal(t.final_metrics.extra.total_tokens, 242);
      assert.ok(t.final_metrics.total_cost_usd == null);
    },
    diff: { reason: "R3", kind: "by design", check: (t) => {
      assert.equal(t.session_id, "root");
      assert.equal(t.trajectory_id, "root");
      assert.deepEqual(t.subagent_trajectories.map((child) => child.trajectory_id), ["alpha", "beta"]);
      for (const child of t.subagent_trajectories) {
        assert.equal(child.session_id, "root");
        assert.deepEqual(child.steps.map((step) => step.message), [`Do the ${child.trajectory_id} task.`, `${child.trajectory_id} child work`]);
        assert.deepEqual(child.steps.map((step) => step.step_id), [1, 2]);
        assert.equal(child.agent.extra.agent_nickname, undefined);
        assert.equal(child.extra.agent_name, NICKNAMES[child.trajectory_id]);
      }
      assert.equal(JSON.stringify(t.steps).includes("copied parent history"), false);
<<<<<<< HEAD
=======
      const refs = t.steps.flatMap((step) => step.observation?.results ?? []).flatMap((result) => (result.subagent_trajectory_ref ?? []).map((ref) => ref.trajectory_id));
      assert.deepEqual(refs.sort(), ["alpha", "beta"]);
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
      assert.deepEqual(t.final_metrics, { total_prompt_tokens: 220, total_completion_tokens: 22, total_cached_tokens: 60, total_steps: 3 });
    } },
  },
  {
<<<<<<< HEAD
=======
    // Adapted: a UserMessage starts the turn (Agent Threads requires a prompt), so Harbor's
    // steps[0] is the first agent step here. The cost assertions use Harbor's mocked price
    // table and are not ported; the cache-write token counts are.
    id: "codex: cache_write_usage_is_preserved_and_priced",
    files: (dir) => ({ main: writeSession(dir, "session.jsonl", [
      event("session_meta", { id: "session-cache-write" }, t(0)),
      ctPrompt("Write the cache."),
      event("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "Cache-writing response." }] }, t(0)),
      { type: "event_msg", payload: { type: "token_count", info: {
        last_token_usage: { input_tokens: 1000, output_tokens: 10, cached_input_tokens: 300, reasoning_output_tokens: 0, total_tokens: 1010, cache_write_input_tokens: 600 },
        total_token_usage: { input_tokens: 1000, output_tokens: 10, cached_input_tokens: 300, reasoning_output_tokens: 0, total_tokens: 1010, cache_write_input_tokens: 600 },
      } } },
    ]) }),
    facts: (tr) => {
      assert.ok(tr != null);
      assert.ok(tr.final_metrics != null);
      assert.ok(tr.final_metrics.extra != null);
      assert.equal(tr.final_metrics.extra.total_cache_write_input_tokens, 600);
      assert.ok(step(tr).metrics != null);
      assert.ok(step(tr).metrics.extra != null);
      assert.equal(step(tr).metrics.extra.cache_write_input_tokens, 600);
    },
    diff: { reason: "R11", kind: "not handled", check: (tr) => {
      assert.equal(step(tr).message, "Cache-writing response.");
      assert.equal(step(tr).metrics.extra.cache_creation_input_tokens, 600);
      assert.equal(step(tr).metrics.extra.cache_write_input_tokens, undefined);
      assert.equal(tr.final_metrics.extra?.total_cache_write_input_tokens, undefined);
    } },
  },
  {
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
    id: "codex: codex_grandchild_is_nested_under_its_parent",
    // Adapted: a UserMessage starts each of the three rollouts (Agent Threads requires a prompt).
    files: (dir) => {
      const main = writeDay(dir, "00-root", [meta("root"), imgPrompt("Oversee.", 0), ...spawn("child", "/root/child", 1)]);
      writeDay(dir, "01-child", [meta("child", "root", "/root/child", 1), imgPrompt("Child work.", 1), ...spawn("grandchild", "/root/child/grandchild", 2)]);
      writeDay(dir, "02-grandchild", [meta("grandchild", "child", "/root/child/grandchild", 1), imgPrompt("Grandchild work.", 1), message("grandchild", 2)]);
      return { main };
    },
    facts: (t) => {
      assert.ok(t != null);
      assert.equal(t.session_id, "root");
      assert.ok(t.subagent_trajectories != null);
      const [child] = t.subagent_trajectories;
      assert.equal(child.trajectory_id, "child");
      assert.ok(child.subagent_trajectories != null);
      const [grandchild] = child.subagent_trajectories;
      assert.equal(grandchild.trajectory_id, "grandchild");
      assert.equal(grandchild.steps[0].message, "grandchild");
    },
    diff: { reason: "R3", kind: "by design", check: (t) => {
      assert.equal(t.session_id, "root");
      assert.equal(t.subagent_trajectories.length, 1);
      const [child] = t.subagent_trajectories;
      assert.equal(child.trajectory_id, "child");
      assert.equal(child.session_id, "root");
      assert.deepEqual(child.steps.map((step) => step.message), ["Child work.", ""]);
      assert.equal(child.subagent_trajectories.length, 1);
      const [grandchild] = child.subagent_trajectories;
      assert.equal(grandchild.trajectory_id, "grandchild");
      assert.equal(grandchild.steps[0].message, "Grandchild work.");
      assert.equal(grandchild.steps[1].message, "grandchild");
    } },
  },
  {
    id: "codex: loaded_orphan_subagent_excludes_copied_history",
    // Adapted: a UserMessage starts the orphan (Agent Threads requires a prompt); the old root
    // rollout is written beside it, as Harbor wrote it under the same sessions folder.
    files: (dir) => {
      const main = writeDay(dir, "2026-11-02T10-00-20-child", [
<<<<<<< HEAD
        meta("child", "missing-parent", null, 5),
        imgEvent(0, 1, "session_meta", { id: "missing-parent" }),
        // A copied parent prompt opens a turn when read from ordinal 0: the boundary must cut it.
        imgPrompt("Parent asks.", 2),
        message("copied parent history", 3),
        imgTokens(999, 99, { ordinal: 4 }),
        imgPrompt("Child task.", 5),
        message("child work", 6),
        imgTokens(50, 5, { ordinal: 7 }),
=======
        meta("child", "missing-parent", null, 4),
        imgEvent(0, 1, "session_meta", { id: "missing-parent" }),
        message("copied parent history", 2),
        imgTokens(999, 99, { ordinal: 3 }),
        imgPrompt("Child task.", 4),
        message("child work", 5),
        imgTokens(50, 5, { ordinal: 6 }),
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
      ]);
      writeDay(dir, "2026-11-02T09-00-00-old-root", [meta("old"), imgPrompt("Old root task.", 0), message("old", 1)]);
      return { main };
    },
    facts: (t) => {
      assert.ok(t != null);
      assert.equal(t.session_id, "child");
      assert.ok(t.subagent_trajectories == null);
      assert.deepEqual(t.steps.map((step) => step.message), ["child work"]);
      assert.ok(t.final_metrics != null);
      assert.equal(t.final_metrics.total_prompt_tokens, 50);
      approx(t.final_metrics.total_cost_usd, 0.05);
      const usage = Object.values(modelUsage(t))[0];
      assert.equal(usage.n_input_tokens, 50);
      approx(usage.cost_usd, 0.05);
      assert.equal(t.final_metrics.total_prompt_tokens, 50);
      assert.equal(t.session_id, "child");
    },
    diff: { reason: "R10", kind: "by design", check: (t) => {
      assert.equal(t.session_id, "child");
      assert.equal(t.subagent_trajectories, undefined);
      assert.deepEqual(t.steps.map((step) => step.message), ["Child task.", "child work"]);
      assert.deepEqual(t.steps.map((step) => step.step_id), [1, 2]);
<<<<<<< HEAD
      for (const copied of ["Parent asks.", "copied parent history"]) assert.equal(JSON.stringify(t).includes(copied), false, copied);
=======
      assert.equal(JSON.stringify(t).includes("copied parent history"), false);
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
      assert.deepEqual(t.final_metrics, { total_prompt_tokens: 50, total_completion_tokens: 5, total_cached_tokens: 0, total_steps: 2 });
    } },
  },
  {
    id: "codex: codex_uses_active_turn_model_for_steps_and_pricing",
    // Adapted: two UserMessages open the two turns (Agent Threads requires a prompt; the model of
    // a turn is the one the last turn_context before its prompt names).
    files: (dir) => ({ main: write(dir, "rollout-root.jsonl", [
      meta("root"),
      turnContext("unused-model", 1),
      turnContext("gpt-first", 2),
      imgPrompt("First question.", 3),
      message("first", 4),
      imgTokens(10, 2, { ordinal: 5 }),
      turnContext("gpt-second", 6),
      imgPrompt("Second question.", 7),
      message("second", 8, 3),
      imgTokens(10, 2, { ordinal: 9, second: 4, totalPrompt: 20, totalCompletion: 4 }),
    ]) }),
    facts: (t) => {
      assert.ok(t != null);
      assert.equal(t.agent.model_name, "gpt-first");
      assert.deepEqual(t.steps.map((step) => step.model_name), ["gpt-first", "gpt-second"]);
      assert.deepEqual(t.steps.map((step) => step.metrics?.cost_usd), [0.01, 0.02]);
      assert.deepEqual(t.steps.filter((step) => step.source === "agent").map((step) => step.model_name), ["gpt-first", "gpt-second"]);
      assert.deepEqual(Object.keys(modelUsage(t)).sort(), ["gpt-first", "gpt-second"]);
    },
    diff: { reason: "R8", kind: "not handled", check: (t) => {
      assert.equal(t.agent.model_name, "gpt-first");
      assert.deepEqual(t.steps.map((step) => [step.source, step.model_name ?? null]), [["user", null], ["agent", "gpt-first"], ["user", null], ["agent", "gpt-second"]]);
      assert.deepEqual(t.steps.map((step) => step.message), ["First question.", "first", "Second question.", "second"]);
      assert.equal(t.steps[1].metrics.prompt_tokens, 10);
      assert.equal(t.steps[3].metrics.prompt_tokens, 10);
      assert.equal(t.steps[1].metrics.cost_usd, undefined);
      assert.equal(t.steps[3].metrics.cost_usd, undefined);
      assert.deepEqual(t.final_metrics, { total_prompt_tokens: 20, total_completion_tokens: 4, total_cached_tokens: 0, total_steps: 4 });
      assert.deepEqual(modelUsage(t), { "gpt-first": { n_input_tokens: 10, n_cache_tokens: 0, n_output_tokens: 2, cost_usd: null }, "gpt-second": { n_input_tokens: 10, n_cache_tokens: 0, n_output_tokens: 2, cost_usd: null } });
    } },
  },
  {
    id: "codex: missing_root_usage_keeps_combined_totals_unknown",
    // Adapted: a UserMessage starts the root and the child rollout (Agent Threads requires a prompt).
    files: (dir) => {
      const main = writeDay(dir, "root", [meta("root"), imgPrompt("Root task.", 0), message("root", 1)]);
      writeDay(dir, "child", [meta("child", "root"), imgPrompt("Child task.", 0), message("child", 1), imgTokens(50, 5, { ordinal: 2 })]);
      return { main };
    },
    facts: (t) => {
      assert.ok(t != null);
      assert.ok(t.final_metrics != null);
      assert.ok(t.final_metrics.total_prompt_tokens == null);
      assert.ok(t.final_metrics.total_cost_usd == null);
      assert.equal(t.final_metrics.total_steps, t.steps.length);
      assert.ok(t.subagent_trajectories != null);
      const [child] = t.subagent_trajectories;
      assert.ok(child.final_metrics != null);
      assert.equal(child.final_metrics.total_prompt_tokens, 50);
      assert.equal(child.final_metrics.total_cost_usd, 0.01);
      assert.equal(modelUsage(t)["openai/o3"].n_input_tokens, 50);
      assert.ok(t.final_metrics.total_prompt_tokens == null);
      assert.ok(t.final_metrics.total_cached_tokens == null);
      assert.ok(t.final_metrics.total_cost_usd == null);
    },
    diff: { reason: "R2", kind: "not handled", check: (t) => {
      assert.equal(t.session_id, "root");
      assert.deepEqual(t.steps.map((step) => step.message), ["Root task.", "root"]);
      assert.deepEqual(t.final_metrics, { total_steps: 2 });
      assert.equal(t.subagent_trajectories, undefined);
      assert.equal(JSON.stringify(t).includes('"child"'), false);
    } },
  },
  {
    id: "codex: input_image_data_url_is_saved_next_to_trajectory",
    // Adapted: a UserMessage starts the turn (Agent Threads requires a prompt).
    files: (dir) => ({ main: write(dir, "session.jsonl", [
      meta("session-mcp"),
      imgPrompt("Run the tool.", 1),
      ...mcpCall(JSON.stringify([
        { type: "input_text", text: "screenshot:" },
        { type: "input_image", image_url: `data:image/png;base64,${PNG_B64}`, detail: "high" },
      ])),
    ]) }),
    facts: (t) => {
      const content = mcpContent(t);
      assert.ok(Array.isArray(content));
      const [textPart, imagePart] = content;
      assert.equal(textPart.type, "text");
      assert.equal(textPart.text, "screenshot:");
      assert.equal(imagePart.type, "image");
      assert.ok(imagePart.source != null);
      assert.equal(imagePart.source.media_type, "image/png");
      assert.ok(imagePart.source.path.startsWith("images/"));
      assert.deepEqual(readFileSync(join(scratchDir, imagePart.source.path)), PNG_BYTES);
      assert.ok(t.steps.some((step) => step.observation?.results.some((result) => Array.isArray(result.content) && result.content.some((part) => part?.type === "image"))));
      assert.equal(readdirSync(join(scratchDir, "images")).length, 1);
    },
    diff: { reason: "R5a", kind: "by design", check: (t) => {
      assert.equal(mcpContent(t), "screenshot:");
      assert.equal(existsSync(join(scratchDir, "images")), false);
      assert.deepEqual(readdirSync(scratchDir), ["session.jsonl"]);
    } },
  },
  {
    id: "codex: data_url_parameters_do_not_hide_the_media_type",
    // Adapted: a UserMessage starts the turn (Agent Threads requires a prompt).
    files: (dir) => ({ main: write(dir, "session.jsonl", [
      meta("session-mcp"),
      imgPrompt("Run the tool.", 1),
      ...mcpCall(JSON.stringify([{ type: "input_image", image_url: `data:Image/PNG;name=shot.png;charset=x;base64,${PNG_B64}` }])),
    ]) }),
    facts: (t) => {
      const content = mcpContent(t);
      assert.ok(Array.isArray(content));
      const [imagePart] = content;
      assert.ok(imagePart.source != null);
      assert.equal(imagePart.source.media_type, "image/png");
      assert.deepEqual(readFileSync(join(scratchDir, imagePart.source.path)), PNG_BYTES);
    },
    diff: { reason: "R5a", kind: "by design", check: (t) => {
      assert.equal(mcpContent(t), "");
      assert.equal(existsSync(join(scratchDir, "images")), false);
      assert.deepEqual(readdirSync(scratchDir), ["session.jsonl"]);
    } },
  },
  {
    id: "codex: mcp_image_block_is_saved",
    // Adapted: a UserMessage starts the turn (Agent Threads requires a prompt).
    files: (dir) => ({ main: write(dir, "session.jsonl", [
      meta("session-mcp"),
      imgPrompt("Run the tool.", 1),
      ...mcpCall(JSON.stringify([{ type: "image", data: PNG_B64, mimeType: "image/jpg" }])),
    ]) }),
    facts: (t) => {
      const content = mcpContent(t);
      assert.ok(Array.isArray(content));
      const [imagePart] = content;
      assert.ok(imagePart.source != null);
      assert.equal(imagePart.source.media_type, "image/jpeg");
      assert.ok(imagePart.source.path.endsWith(".jpg"));
      assert.deepEqual(readFileSync(join(scratchDir, imagePart.source.path)), PNG_BYTES);
    },
    diff: { reason: "R5a", kind: "by design", check: (t) => {
      assert.equal(mcpContent(t), "");
      assert.equal(existsSync(join(scratchDir, "images")), false);
      assert.deepEqual(readdirSync(scratchDir), ["session.jsonl"]);
    } },
  },
  ...["https://example.com/shots/cat.png?size=large", "http://example.com/render?id=42", "HTTPS://EXAMPLE.COM/CAT.PNG", "s3://bucket/cat.png"].map((url, index) => ({
    id: `codex: remote_image_url_is_kept_in_text[${index}]`,
    // Adapted: a UserMessage starts the turn (Agent Threads requires a prompt).
    files: (dir) => ({ main: write(dir, "session.jsonl", [
      meta("session-mcp"),
      imgPrompt("Run the tool.", 1),
      ...mcpCall(JSON.stringify([{ type: "input_text", text: "look:" }, { type: "input_image", image_url: url }])),
    ]) }),
    facts: (t) => {
      assert.equal(mcpContent(t), `look:\n[image: ${url}]`);
      assert.equal(existsSync(join(scratchDir, "images")), false);
    },
<<<<<<< HEAD
    diff: { reason: "R5a", kind: "by design", check: (t) => {
=======
    diff: { reason: "R5a", kind: "not handled", check: (t) => {
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
      assert.equal(mcpContent(t), "look:");
      assert.equal(existsSync(join(scratchDir, "images")), false);
      assert.deepEqual(readdirSync(scratchDir), ["session.jsonl"]);
    } },
  })),
  ...[{ type: "input_image", file_id: "file-123" }, { type: "image", data: "PHN2Zz4=", mimeType: "image/svg+xml" }, { type: "image", data: "not base64!", mimeType: "image/png" }].map((imageBlock, index) => ({
    id: `codex: unstorable_images_are_omitted[${index}]`,
    // Adapted: a UserMessage starts the turn (Agent Threads requires a prompt).
    files: (dir) => ({ main: write(dir, "session.jsonl", [
      meta("session-mcp"),
      imgPrompt("Run the tool.", 1),
      ...mcpCall(JSON.stringify([{ type: "input_text", text: "look:" }, imageBlock])),
    ]) }),
    facts: (t) => {
      assert.equal(mcpContent(t), "look:\n[image omitted]");
      assert.equal(existsSync(join(scratchDir, "images")), false);
    },
<<<<<<< HEAD
    diff: { reason: "R5a", kind: "by design", check: (t) => {
=======
    diff: { reason: "R5a", kind: "not handled", check: (t) => {
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
      assert.equal(mcpContent(t), "look:");
      assert.equal(existsSync(join(scratchDir, "images")), false);
      assert.deepEqual(readdirSync(scratchDir), ["session.jsonl"]);
    } },
  })),
  {
    id: "codex: data_url_containing_a_url_is_not_treated_as_remote",
    // Adapted: a UserMessage starts the turn (Agent Threads requires a prompt).
    files: (dir) => ({ main: write(dir, "session.jsonl", [
      meta("session-mcp"),
      imgPrompt("Run the tool.", 1),
      ...mcpCall(JSON.stringify([{ type: "input_image", image_url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }])),
    ]) }),
    facts: (t) => {
      assert.equal(mcpContent(t), "[image omitted]");
    },
<<<<<<< HEAD
    diff: { reason: "R5a", kind: "by design", check: (t) => {
=======
    diff: { reason: "R5a", kind: "not handled", check: (t) => {
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
      assert.equal(mcpContent(t), "");
      assert.equal(existsSync(join(scratchDir, "images")), false);
      assert.deepEqual(readdirSync(scratchDir), ["session.jsonl"]);
    } },
  },
  ...["images", "final", "tmp"].map((planted, index) => {
    let plantedLayout = null;
    return {
      id: `codex: images_are_never_written_through_a_planted_symlink[${index}]`,
      // Adapted: a UserMessage starts the turn, and the planted images path is a plain directory
      // or file, never a real symlink; the outside folder and victim file are planted as in Harbor.
      files: (dir) => {
        const outside = join(dirname(dir), `${basename(dir)}-outside`);
        mkdirSync(outside, { recursive: true });
        const victim = join(outside, "victim.png");
        writeFileSync(victim, "victim");
        const digest = createHash("sha256").update(PNG_BYTES).digest("hex").slice(0, 16);
        const imagesDir = join(dir, "images");
        mkdirSync(imagesDir, { recursive: true });
        let plantedNames = [];
        let plantedFile = null;
        if (planted !== "images") {
          const suffix = planted === "final" ? "" : ".tmp";
          plantedFile = join(imagesDir, `codex_${digest}.png${suffix}`);
          writeFileSync(plantedFile, "planted");
          plantedNames = [basename(plantedFile)];
        }
        plantedLayout = { outside, victim, imagesDir, plantedNames, plantedFile };
        return { main: write(dir, "session.jsonl", [
          meta("session-mcp"),
          imgPrompt("Run the tool.", 1),
          ...mcpCall(JSON.stringify([{ type: "input_image", image_url: `data:image/png;base64,${PNG_B64}` }])),
        ]) };
      },
      facts: (t) => {
        assert.equal(mcpContent(t), "[image omitted]");
        assert.equal(readFileSync(plantedLayout.victim, "utf8"), "victim");
        assert.deepEqual(readdirSync(plantedLayout.outside).sort(), ["victim.png"]);
      },
<<<<<<< HEAD
      diff: { reason: "R5a", kind: "by design", check: (t) => {
=======
      diff: { reason: "R5a", kind: "not handled", check: (t) => {
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
        assert.equal(mcpContent(t), "");
        assert.equal(readFileSync(plantedLayout.victim, "utf8"), "victim");
        assert.deepEqual(readdirSync(plantedLayout.outside).sort(), ["victim.png"]);
        assert.deepEqual(readdirSync(plantedLayout.imagesDir).sort(), plantedLayout.plantedNames);
        if (plantedLayout.plantedFile != null) assert.equal(readFileSync(plantedLayout.plantedFile, "utf8"), "planted");
        assert.equal(JSON.stringify(t).includes("images/"), false);
      } },
    };
  }),

];
