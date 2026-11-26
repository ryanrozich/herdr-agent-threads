// Adapted from harbor-framework/harbor, tests/unit/agents/installed/test_opencode.py
// and tests/unit/agents/installed/test_opencode_v2.py at 110c71b32c268e1d113c3856869202842f8e37a6 (0.26.0).
// Copyright the Harbor authors. Apache-2.0; see LICENSE beside this file.
// Ported: the trajectory items of both files, the named entries in OPENCODE_CASES below; the
// other trajectory items are in LEFT_OUT (differences.js). The rest of both files tests Harbor's
// install, configuration and run commands, which have no counterpart in an export.
// Changed from Harbor's original: the pytest functions are translated to JavaScript case entries that
// run our export's command line; the diff checks are ours, and "Adapted:" marks changed input.
// Harbor converts the JSON lines of `opencode run --format json`; Agent Threads reads OpenCode's
// database. So each case writes Harbor's events into a database the way OpenCode stores them:
// test_opencode.py's (the OpenCode agent) into 1.x's message and part tables, and
// test_opencode_v2.py's (OpenCodeV2) into 2.x's session_v2 and session_message tables. A
// step_start opens an assistant message, its parts go in order, and its step_finish gives the
// message's end, its finish reason and its tokens.
// Adapted, for every case: each part gets an id of its own (Harbor's helpers give every tool
// part of a message the same id, which the part table keys on); a tool state with no status
// and an output is written as completed, as OpenCode always writes a status; a 1.x tool error
// that is an object is written as its message, as OpenCode 1.x writes a tool error as text.
import { strict as assert } from "node:assert";
import { Database } from "bun:sqlite";
import { join } from "node:path";

// Harbor's event helpers (test_opencode.py).
const stepStart = (sid, mid, timestamp = 1700000000000) => ({ type: "step_start", timestamp, sessionID: sid, part: { id: `prt_start_${mid}`, sessionID: sid, messageID: mid, type: "step-start", snapshot: "abc" } });
const text = (sid, mid, value, timestamp = 1700000001000) => ({ type: "text", timestamp, sessionID: sid, part: { id: `prt_text_${mid}`, sessionID: sid, messageID: mid, type: "text", text: value, time: { start: timestamp, end: timestamp } } });
const toolUse = (sid, mid, tool, input, output, callID = "call_1", timestamp = 1700000002000) => ({ type: "tool_use", timestamp, sessionID: sid, part: { id: `prt_tool_${mid}`, sessionID: sid, messageID: mid, type: "tool", callID, tool, state: { status: "completed", input, output } } });
const reasoning = (sid, mid, value, timestamp = 1700000001500) => ({ type: "reasoning", timestamp, sessionID: sid, part: { id: `prt_reasoning_${mid}`, sessionID: sid, messageID: mid, type: "reasoning", text: value, time: { start: timestamp, end: timestamp } } });
const stepFinish = (sid, mid, { cost = 0.01, input = 100, output = 50, reasoningTok = 0, cacheRead = 0, cacheWrite = 0, timestamp = 1700000003000 } = {}) => ({ type: "step_finish", timestamp, sessionID: sid, part: { id: `prt_finish_${mid}`, sessionID: sid, messageID: mid, type: "step-finish", reason: "stop", cost, tokens: { total: input + output + cacheRead + cacheWrite, input, output, reasoning: reasoningTok, cache: { read: cacheRead, write: cacheWrite } } } });
const userEvent = (sid, value, timestamp = 1699999999000) => ({ type: "user", timestamp, sessionID: sid, parts: [{ type: "text", text: value }] });
// test_opencode_v2.py's text helper.
const v2Text = (value = "Implemented the task.", mid = "msg_fixture") => ({ type: "text", sessionID: "ses_fixture", timestamp: 1700000001000, part: { type: "text", messageID: mid, text: value } });

// Harbor's events as an OpenCode database. prompt: the user message's text when the events have
// no user event (Harbor's run() instruction, or a prompt the port adds); null writes none.
// Returns "<database>#<session id>", the export's argument.
export function writeOpencode(dir, events, { version = "1.x", prompt = null } = {}) {
  const sid = events.find((e) => typeof e?.sessionID === "string")?.sessionID ?? "ses_fixture";
  const path = join(dir, "opencode.db");
  // Messages in order: the prompt, then a message per step_start (or per message id first seen).
  const msgs = [];
  let clock = 1700000000000;
  const at = (e) => (typeof e?.timestamp === "number" ? e.timestamp : (clock += 1000));
  const first = events.find((e) => e?.type === "user");
  const promptText = first ? first.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n") : prompt;
  if (promptText != null) msgs.push({ id: "msg_000000", role: "user", t: first ? at(first) : 1699999999000, text: promptText });
  let cur = null;
  const open = (mid, t) => { cur = { id: mid ?? `msg_${String(msgs.length).padStart(6, "0")}`, role: "assistant", t, parts: [], done: null, finish: null, tokens: null, cost: null }; msgs.push(cur); return cur; };
  for (const e of events) {
    if (!e || typeof e !== "object" || e.type === "user" || e.type === "error") continue;
    const mid = e.part?.messageID;
    if (e.type === "step_start") { open(mid ?? null, at(e)); continue; }
    const m = (mid && msgs.find((x) => x.id === mid)) || cur || open(mid ?? null, at(e));
    if (e.type === "step_finish") {
      m.done = at(e);
      m.finish = e.part?.reason ?? "stop";
      if (e.part?.tokens) m.tokens = e.part.tokens;
      if (typeof e.part?.cost === "number") m.cost = e.part.cost;
    } else if (e.part) m.parts.push(e.part);
  }
  const db = new Database(path);
  const model = { providerID: "anthropic", id: "claude-sonnet-4-5-20250929" };
  const toolState = (s, v2) => {
    const status = s.status ?? (s.output != null ? "completed" : undefined);
    const out = { status, input: s.input ?? {} };
    if (v2) {
      if (s.output != null) out.content = [{ type: "text", text: String(s.output) }];
      if (status === "error") out.error = s.error && typeof s.error === "object" ? s.error : { type: "unknown", message: String(s.error ?? "") };
    } else {
      if (s.output != null) out.output = s.output;
      if (s.error != null) out.error = typeof s.error === "object" ? String(s.error.message ?? JSON.stringify(s.error)) : s.error;
    }
    return out;
  };
  if (version === "1.x") {
    db.run("create table session (id text primary key, parent_id text, directory text, title text, time_created integer, time_updated integer, time_archived integer)");
    db.run("create table message (id text primary key, session_id text, time_created integer, data text)");
    db.run("create table part (id text primary key, message_id text, session_id text, data text)");
    db.run("insert into session values (?, null, '/app', 'New session - fixture', 1, 2, null)", [sid]);
    let n = 0;
    const part = (mid, data) => db.run("insert into part values (?, ?, ?, ?)", [`prt_${String(++n).padStart(6, "0")}`, mid, sid, JSON.stringify(data)]);
    const userId = msgs.find((m) => m.role === "user")?.id;
    for (const m of msgs) {
      if (m.role === "user") {
        db.run("insert into message values (?, ?, ?, ?)", [m.id, sid, m.t, JSON.stringify({ role: "user", time: { created: m.t } })]);
        part(m.id, { type: "text", text: m.text });
        continue;
      }
      const data = { role: "assistant", parentID: userId, agent: "build", modelID: model.id, providerID: model.providerID, time: { created: m.t, ...(m.done != null ? { completed: m.done } : {}) } };
      if (m.finish) data.finish = m.finish;
      if (m.tokens) data.tokens = m.tokens;
      if (m.cost != null) data.cost = m.cost;
      db.run("insert into message values (?, ?, ?, ?)", [m.id, sid, m.t, JSON.stringify(data)]);
      for (const p of m.parts) {
        if (p.type === "tool") part(m.id, { type: "tool", tool: p.tool, callID: p.callID ?? p.id, state: toolState(p.state ?? {}, false) });
        else part(m.id, { type: p.type, text: p.text ?? "" });
      }
    }
  } else {
    db.run(`create table session_v2 (id text primary key, project_id text, parent_id text, directory text, title text,
      time_created integer, time_updated integer, time_archived integer, time_busy integer, time_idle integer)`);
    db.run("create table session_message (id text primary key, session_id text, type text, seq integer, time_created integer, time_updated integer, data text)");
    db.run("create table session_part (message_id text, session_id text, ordinal integer, type text, data text)");
    db.run("insert into session_v2 values (?, 'prj', null, '/app', 'New session - fixture', 1, 2, null, null, null)", [sid]);
    let seq = 0;
    const row = (id, type, t, data) => { seq += 1; db.run("insert into session_message values (?, ?, ?, ?, ?, ?, ?)", [id, sid, type, seq, t, t, JSON.stringify({ time: { created: t }, ...data })]); };
    for (const m of msgs) {
      if (m.role === "user") { row(m.id, "user", m.t, { text: m.text, files: [], agents: [] }); continue; }
      const content = m.parts.map((p) => (p.type === "tool"
        ? { type: "tool", id: p.callID ?? p.id, name: p.tool, state: toolState(p.state ?? {}, true) }
        : { type: p.type, text: p.text ?? "" }));
      const tk = m.tokens ? { input: m.tokens.input ?? 0, output: m.tokens.output ?? 0, reasoning: m.tokens.reasoning ?? 0, cache: { read: m.tokens.cache?.read ?? 0, write: m.tokens.cache?.write ?? 0 } } : undefined;
      row(m.id, "assistant", m.t, { time: { created: m.t, ...(m.done != null ? { completed: m.done } : {}) }, agent: "build", model: { id: model.id, providerID: model.providerID, variant: "default" }, content,
        ...(m.finish ? { finish: m.finish } : {}), ...(m.cost != null ? { cost: m.cost } : {}), ...(tk ? { tokens: tk } : {}) });
    }
    const last = msgs.at(-1);
    if (last?.role === "assistant" && last.done != null) row("msg_999999", "idle", last.done + 1, { outcome: "succeeded" });
  }
  db.close();
  return `${path}#${sid}`;
}

const agentSteps = (t) => t.steps.filter((step) => step.source === "agent");
const ADDED = "Run the task.";
// A case's files: Harbor's events (a function of nothing, so each run gets fresh objects).
const session = (events, opts) => (dir) => ({ main: writeOpencode(dir, events(), opts) });

// test_failed_tool_is_an_observation_with_error_metadata's parameters, in pytest's order: the
// first decorator's values change fastest (agent_class, then error, then output).
const FAILED_CLASSES = [["OpenCode", "1.x"], ["OpenCodeV2", "2.x"]];
const FAILED_ERRORS = ["Blocked by configuration policy", { type: "permission.rejected", message: "Blocked by configuration policy" }, ""];
const FAILED_OUTPUTS = [null, "partial output", ""];
const pyStr = (v) => (typeof v === "string" ? v : `{${Object.entries(v).map(([k, x]) => `'${k}': '${x}'`).join(", ")}}`);
const failedEvents = (error, output) => [
  { type: "step_start", sessionID: "ses_fixture" },
  { type: "tool_use", part: { id: "part_failure", callID: "call_failure", type: "tool", tool: "webfetch", state: { status: "error", input: { url: "https://fixture.example" }, error, output } } },
  { type: "tool_use", part: { type: "tool", callID: "call_success", tool: "read", state: { input: { path: "README.md" }, output: "file content" } } },
  { type: "step_finish", part: {} },
];
const failedCases = FAILED_OUTPUTS.flatMap((output, oi) => FAILED_ERRORS.flatMap((error, ei) => FAILED_CLASSES.map(([, version], ci) => ({
  id: `opencode-v2: failed_tool_is_an_observation_with_error_metadata[${oi * 6 + ei * 2 + ci}]`,
  // Adapted: a prompt starts the turn (Agent Threads requires one), so the step is the first agent step.
  files: session(() => failedEvents(error, output), { version, prompt: ADDED }),
  diff: { reason: "R14", kind: "by design", check: (t) => {
    const step = agentSteps(t)[0];
    assert.deepEqual(step.tool_calls.map((call) => call.tool_call_id), ["call_failure", "call_success"]);
    const [failure, success] = step.observation.results;
    assert.equal(failure.source_call_id, "call_failure");
    // Ours: the call's own error text when it has no output (2.x keeps an error object's message).
    const own = output != null ? output : typeof error === "string" ? error : error.message;
    assert.equal(failure.content, own);
    assert.equal(failure.extra.tool_result_is_error, true);
    assert.equal(Object.hasOwn(failure.extra, "error"), false);
    assert.equal(success.content, "file content");
    assert.equal(success.extra.tool_result_is_error, false);
    assert.equal(step.metrics, undefined);
    assert.equal(t.final_metrics.total_prompt_tokens, undefined);
    assert.equal(t.schema_version, "ATIF-v1.7");
  } },
  facts: (t) => {
    const step = agentSteps(t)[0];
    assert.deepEqual(step.tool_calls.map((call) => call.tool_call_id), ["call_failure", "call_success"]);
    const [failure, success] = step.observation.results;
    assert.equal(failure.source_call_id, "call_failure");
    assert.equal(failure.content, output == null ? pyStr(error) : output);
    assert.deepEqual(failure.extra, { error });
    assert.equal(success.source_call_id, "call_success");
    assert.equal(success.content, "file content");
    assert.equal(success.extra ?? null, null);
    assert.equal(step.metrics ?? null, null);
    assert.equal(t.final_metrics.total_prompt_tokens ?? null, null);
    assert.equal(t.final_metrics.total_completion_tokens ?? null, null);
    assert.equal(t.final_metrics.total_cost_usd ?? null, null);
    assert.equal(t.schema_version, "ATIF-v1.7");
  },
}))));

export const OPENCODE_CASES = [
  {
    id: "opencode: text_only_turn",
    // Adapted: a prompt starts the turn (Agent Threads requires one), so Harbor's one step is the first agent step.
    files: session(() => [stepStart("s1", "m1"), text("s1", "m1", "Hello, I will help you."), stepFinish("s1", "m1", { cost: 0.015, input: 100, output: 50 })], { prompt: ADDED }),
    diff: { reason: "R8", kind: "not handled", check: (t) => {
      const steps = agentSteps(t);
      assert.equal(t.session_id, "s1");
      assert.equal(t.agent.name, "opencode");
      assert.equal(steps.length, 1);
      assert.equal(steps[0].message, "Hello, I will help you.");
      assert.equal(steps[0].metrics.prompt_tokens, 100);
      assert.equal(steps[0].metrics.completion_tokens, 50);
      assert.equal(steps[0].metrics.cost_usd, undefined);
    } },
    facts: (t) => {
      const steps = agentSteps(t);
      assert.equal(t.schema_version, "ATIF-v1.7");
      assert.equal(t.session_id, "s1");
      assert.equal(t.agent.name, "opencode");
      assert.equal(steps.length, 1);
      assert.equal(steps[0].source, "agent");
      assert.equal(steps[0].message, "Hello, I will help you.");
      assert.equal(steps[0].metrics.prompt_tokens, 100);
      assert.equal(steps[0].metrics.completion_tokens, 50);
      assert.equal(steps[0].metrics.cost_usd, 0.015);
    },
  },
  {
    id: "opencode: synthesizes_user_step_from_instruction",
    // Adapted: the instruction Harbor's run() keeps is the session's prompt, as OpenCode stores it.
    files: session(() => [stepStart("s1", "m1"), text("s1", "m1", "On it."), stepFinish("s1", "m1")], { prompt: "Create a hello world file." }),
    facts: (t) => {
      assert.equal(t.steps.length, 2);
      assert.equal(t.steps[0].source, "user");
      assert.equal(t.steps[0].message, "Create a hello world file.");
      assert.equal(t.steps[1].source, "agent");
      assert.deepEqual(t.steps.map((step) => step.step_id), [1, 2]);
    },
  },
  {
    id: "opencode: prefers_user_event_over_instruction",
    // Adapted: the database holds only the user event's prompt; the fallback instruction never reaches it.
    files: session(() => [userEvent("s1", "the real prompt"), stepStart("s1", "m1"), text("s1", "m1", "Working."), stepFinish("s1", "m1")], { prompt: "fallback instruction" }),
    facts: (t) => {
      const users = t.steps.filter((step) => step.source === "user");
      assert.equal(users.length, 1);
      assert.equal(users[0].message, "the real prompt");
      assert.equal(t.steps[0].source, "user");
    },
  },
  {
    id: "opencode: no_user_step_without_instruction_or_event",
    files: session(() => [stepStart("s1", "m1"), text("s1", "m1", "Hello"), stepFinish("s1", "m1")]),
    diff: { reason: "R3", kind: "by design", control: session(() => [stepStart("s1", "m1"), text("s1", "m1", "Hello"), stepFinish("s1", "m1")], { prompt: ADDED }), check: (t, control) => {
      assert.equal(t, null);
      assert.equal(agentSteps(control)[0].message, "Hello");
    } },
    facts: (t) => {
      assert.notEqual(t, null);
      assert.ok(t.steps.every((step) => step.source !== "user"));
      assert.equal(t.steps[0].source, "agent");
    },
  },
  {
    id: "opencode: tool_call_turn",
    // Adapted: a prompt starts the turn, so Harbor's one step is the first agent step.
    files: session(() => [stepStart("s1", "m1"), text("s1", "m1", "Let me create that file."), toolUse("s1", "m1", "write", { filePath: "/app/hello.txt", content: "Hello!" }, "Wrote file successfully.", "toolu_abc"), stepFinish("s1", "m1", { cost: 0.02, input: 200, output: 80 })], { prompt: ADDED }),
    diff: { reason: "R15", kind: "not handled", check: (t) => {
      const steps = agentSteps(t);
      // The message completed with finish stop, so its text is a marked answer (R23): the call
      // is one step, the answer the turn's reply step, where Harbor keeps them in one.
      assert.equal(steps.length, 2);
      assert.equal(steps[0].message, "");
      assert.equal(steps[0].tool_calls[0].tool_call_id, "toolu_abc");
      assert.equal(steps[0].tool_calls[0].function_name, "write");
      assert.deepEqual(steps[0].tool_calls[0].arguments, {});
      assert.equal(steps[0].tool_calls[0].extra.arguments_unread, "not read");
      assert.equal(steps[0].observation.results[0].content, "Wrote file successfully.");
      assert.equal(steps[1].message, "Let me create that file.");
    } },
    facts: (t) => {
      const steps = agentSteps(t);
      assert.equal(steps.length, 1);
      const step = steps[0];
      assert.equal(step.message, "Let me create that file.");
      assert.equal(step.tool_calls.length, 1);
      assert.equal(step.tool_calls[0].function_name, "write");
      assert.equal(step.tool_calls[0].tool_call_id, "toolu_abc");
      assert.deepEqual(step.tool_calls[0].arguments, { filePath: "/app/hello.txt", content: "Hello!" });
      assert.notEqual(step.observation, undefined);
      assert.equal(step.observation.results[0].content, "Wrote file successfully.");
    },
  },
  {
    id: "opencode: reasoning_content_is_captured",
    // Adapted: a prompt starts the turn.
    files: session(() => [stepStart("s1", "m1"), reasoning("s1", "m1", "I should inspect README first."), text("s1", "m1", "I'll read the README and summarize it."), stepFinish("s1", "m1", { cost: 0.01, input: 120, output: 40 })], { prompt: ADDED }),
    diff: { reason: "R13", kind: "not handled", check: (t) => {
      const step = agentSteps(t)[0];
      assert.equal(step.reasoning_content, undefined);
      assert.equal(step.message, "I'll read the README and summarize it.");
    } },
    facts: (t) => {
      const step = agentSteps(t)[0];
      assert.equal(step.reasoning_content, "I should inspect README first.");
      assert.equal(step.message, "I'll read the README and summarize it.");
    },
  },
  {
    id: "opencode: multiple_reasoning_events_are_joined",
    // Adapted: a prompt starts the turn.
    files: session(() => [stepStart("s1", "m1"), reasoning("s1", "m1", "First thought."), reasoning("s1", "m1", "Second thought."), toolUse("s1", "m1", "glob", { pattern: "README*" }, "/app/README.md"), stepFinish("s1", "m1", { cost: 0.01, input: 10, output: 5 })], { prompt: ADDED }),
    diff: { reason: "R13", kind: "not handled", check: (t) => {
      const step = agentSteps(t)[0];
      assert.equal(step.reasoning_content, undefined);
      assert.equal(step.message, "");
      assert.equal(step.tool_calls.length, 1);
    } },
    facts: (t) => {
      const step = agentSteps(t)[0];
      assert.equal(step.reasoning_content, "First thought.\n\nSecond thought.");
      assert.equal(step.message, "");
      assert.notEqual(step.tool_calls, undefined);
    },
  },
  {
    id: "opencode: empty_reasoning_is_ignored",
    // Adapted: a prompt starts the turn.
    files: session(() => [stepStart("s1", "m1"), reasoning("s1", "m1", ""), toolUse("s1", "m1", "pwd", {}, "/app"), stepFinish("s1", "m1", { cost: 0.001, input: 1, output: 1 })], { prompt: ADDED }),
    facts: (t) => {
      const step = agentSteps(t)[0];
      assert.equal(step.reasoning_content ?? null, null);
      assert.equal(step.message, "");
    },
  },
  {
    id: "opencode: multiple_turns",
    // Adapted: a prompt starts the turn, so the steps are the agent steps and total_steps counts the prompt too.
    files: session(() => [
      stepStart("s1", "m1", 1700000000000), text("s1", "m1", "I'll write the file."), toolUse("s1", "m1", "write", { filePath: "test.txt", content: "hi" }, "Done."), stepFinish("s1", "m1", { cost: 0.01, input: 100, output: 50 }),
      stepStart("s1", "m2", 1700000004000), text("s1", "m2", "File created successfully.", 1700000005000), stepFinish("s1", "m2", { cost: 0.005, input: 150, output: 30, cacheRead: 100, timestamp: 1700000006000 }),
    ], { prompt: ADDED }),
    diff: { reason: "R8", kind: "not handled", check: (t) => {
      const steps = agentSteps(t);
      assert.equal(steps.length, 2);
      assert.equal(steps[0].tool_calls.length, 1);
      assert.equal(steps[1].tool_calls, undefined);
      // Both messages completed with finish stop, so both texts are marked answers of the one
      // turn, joined in order as its reply (R23), where Harbor keeps one step per message.
      assert.equal(steps[1].message, "I'll write the file.\n\nFile created successfully.");
      assert.equal(t.final_metrics.total_cost_usd, undefined);
      assert.equal(t.final_metrics.total_completion_tokens, 80);
      assert.equal(t.final_metrics.total_cached_tokens, 100);
      assert.equal(t.final_metrics.total_steps, 3);
    } },
    facts: (t) => {
      const steps = agentSteps(t);
      assert.equal(steps.length, 2);
      assert.notEqual(steps[0].tool_calls, undefined);
      assert.equal(steps[1].tool_calls, undefined);
      assert.equal(steps[1].message, "File created successfully.");
      const fm = t.final_metrics;
      assert.equal(fm.total_cost_usd, 0.015);
      assert.equal(fm.total_completion_tokens, 80);
      assert.equal(fm.total_cached_tokens, 100);
      assert.equal(fm.total_steps, 3);
    },
  },
  {
    id: "opencode: cache_tokens_in_metrics",
    // Adapted: a prompt starts the turn.
    files: session(() => [stepStart("s1", "m1"), text("s1", "m1", "Thinking..."), stepFinish("s1", "m1", { cost: 0.001, input: 5, output: 40, cacheRead: 500, cacheWrite: 200 })], { prompt: ADDED }),
    diff: { reason: "R11", kind: "not handled", check: (t) => {
      const step = agentSteps(t)[0];
      assert.equal(step.metrics.prompt_tokens, 705);
      assert.equal(step.metrics.cached_tokens, 500);
      assert.equal(step.metrics.extra.cache_creation_input_tokens, 200);
      assert.equal(Object.hasOwn(step.metrics.extra, "cache_write_tokens"), false);
    } },
    facts: (t) => {
      const step = agentSteps(t)[0];
      assert.equal(step.metrics.prompt_tokens, 505);
      assert.equal(step.metrics.cached_tokens, 500);
      assert.deepEqual(step.metrics.extra, { cache_write_tokens: 200 });
    },
  },
  {
    id: "opencode: empty_events",
    files: session(() => []),
    facts: (t) => assert.equal(t, null),
  },
  {
    id: "opencode: no_step_finish_events_only",
    files: session(() => [{ type: "error", sessionID: "s1", error: { name: "Err" } }]),
    facts: (t) => assert.equal(t, null),
  },
  {
    id: "opencode: session_id_extracted",
    // Adapted: a prompt starts the turn.
    files: session(() => [stepStart("ses_abc123", "m1"), text("ses_abc123", "m1", "hi"), stepFinish("ses_abc123", "m1")], { prompt: ADDED }),
    facts: (t) => assert.equal(t.session_id, "ses_abc123"),
  },
  {
    id: "opencode-v2: trajectory_retains_a_final_turn_without_step_finish",
    // Adapted: the instruction Harbor's run() keeps is the session's prompt, as OpenCode stores it.
    files: session(() => [{ type: "step_start", sessionID: "ses_fixture", timestamp: 1700000000000 }, v2Text()], { version: "2.x", prompt: "Implement the fixture task." }),
    diff: { reason: "R16", kind: "by design", check: (t) => {
      assert.equal(t.agent.name, "opencode");
      assert.equal(t.session_id, "ses_fixture");
      assert.deepEqual(t.steps.map((step) => step.source), ["user", "agent"]);
      assert.equal(t.steps.at(-1).message, "Implemented the task.");
      assert.equal(t.steps.at(-1).metrics, undefined);
      assert.equal(t.final_metrics.total_prompt_tokens, undefined);
    } },
    facts: (t) => {
      assert.equal(t.agent.name, "opencode-v2");
      assert.equal(t.session_id, "ses_fixture");
      assert.deepEqual(t.steps.map((step) => step.source), ["user", "agent"]);
      assert.equal(t.steps.at(-1).message, "Implemented the task.");
      assert.equal(t.steps.at(-1).metrics ?? null, null);
      assert.equal(t.final_metrics.total_prompt_tokens ?? null, null);
    },
  },
  {
    id: "opencode-v2: trajectory_keeps_tool_observations_and_native_usage",
    // Adapted: a prompt starts the turn, so Harbor's first step is the first agent step.
    files: session(() => [
      { type: "step_start", sessionID: "ses_fixture" },
      { type: "tool_use", part: { type: "tool", callID: "call_fixture", tool: "shell", state: { input: { command: "true" }, output: "fixture output" } } },
      { type: "step_finish", part: { tokens: { input: 10, output: 5, cache: { read: 3 } } } },
      { type: "step_start", sessionID: "ses_fixture" },
      v2Text(),
    ], { version: "2.x", prompt: ADDED }),
    diff: { reason: "R16", kind: "by design", check: (t) => {
      const steps = agentSteps(t);
      assert.equal(t.agent.name, "opencode");
      assert.equal(steps[0].tool_calls[0].function_name, "shell");
      assert.equal(steps[0].observation.results[0].content, "fixture output");
      assert.equal(steps.at(-1).message, "Implemented the task.");
      assert.equal(t.final_metrics.total_prompt_tokens, 13);
      assert.equal(t.final_metrics.total_completion_tokens, 5);
    } },
    facts: (t) => {
      const steps = agentSteps(t);
      assert.equal(t.agent.name, "opencode-v2");
      assert.equal(steps[0].tool_calls[0].function_name, "shell");
      assert.equal(steps[0].observation.results[0].content, "fixture output");
      assert.equal(steps.at(-1).message, "Implemented the task.");
      assert.equal(t.final_metrics.total_prompt_tokens, 13);
      assert.equal(t.final_metrics.total_completion_tokens, 5);
    },
  },
  ...failedCases,
  {
    id: "opencode-v2: unfinished_tool_does_not_get_a_fabricated_observation",
    // Adapted: a prompt starts the turn, so Harbor's first step is the first agent step.
    files: session(() => [{ type: "tool_use", part: { type: "tool", callID: "call_pending", tool: "shell", state: { status: "running", input: { command: "sleep 1" } } } }], { version: "2.x", prompt: ADDED }),
    diff: { reason: "R7", kind: "by design", check: (t) => {
      const step = agentSteps(t)[0];
      assert.equal(step.tool_calls[0].tool_call_id, "call_pending");
      assert.deepEqual(step.observation.results, [{ source_call_id: "call_pending", extra: { no_result: true } }]);
    } },
    facts: (t) => {
      const step = agentSteps(t)[0];
      assert.equal(step.tool_calls[0].tool_call_id, "call_pending");
      assert.equal(step.observation ?? null, null);
    },
  },
];
