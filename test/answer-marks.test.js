// bun test: the text a harness marks as the answer is the row's reply, whatever comes after it.
// Codex marks a message's phase (final_answer, or commentary for a note while it works), Claude
// Code its stop_reason (end_turn), Pi its stopReason (stop) and OpenCode its finish (stop).
// Antigravity and Cursor mark nothing, so there, and in a transcript written without marks, the
// reply stays the text after the row's last call. Work that starts by itself after a row ended
// (a Codex goal task, a Claude Code loop tick or scheduled line with no prompt of its own) is a
// row of its own. Every transcript here is made up and read through the real extractors.
import { test, expect, describe } from "bun:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply, rewindTail, parseChunk, nextChunk, replaced, reply, updatesText, matches } from "../mods/agent-threads/core/turns.js";
import { trajectories } from "../mods/agent-threads/core/trajectory.js";
import { hash, turnId, turnIds } from "../mods/agent-threads/core/ids.js";
import { atif } from "../mods/agent-threads/core/atif.js";
import { seenOf } from "../mods/agent-threads/pins.js";
import { detailOf, ledgerTurn } from "../mods/agent-threads/ledger.js";
import { agentReplied, noticeTurn, senderLabel } from "../mods/agent-threads/ui.js";
import { pane, settleRows, setup, state } from "./render-harness.js";

setup();

// ---- the transcripts ----

const core = join(import.meta.dir, "..", "mods/agent-threads/core");
const extractor = join(core, "extract.sh");
const opencode = join(core, "opencode.sh");
const CODEX_ID = "00000000-0000-7000-8000-000000000001";
// Text a harness puts in front of the model by itself: never in a row, whole or in part.
const PLANTED = "PLANTED-INJECTED-TEXT";
// 5,000 characters, past what a step of the work keeps (STEP_TEXT), in lines.
const long = (word) => `${word} `.repeat(Math.ceil(5000 / (word.length + 1))).slice(0, 4999).trimEnd().padEnd(5000, ".");
const tmp = (name) => join(mkdtempSync(join(tmpdir(), "threads-marks-")), name);

// A Codex rollout, line by line. The clock moves a second a line.
function codex() {
  let ordinal = 0;
  let second = 0;
  const lines = [];
  const line = (type, payload) => {
    const ts = new Date(Date.UTC(2026, 10, 1, 9, 0, second++)).toISOString();
    lines.push(JSON.stringify({ timestamp: ts, ordinal: ordinal++, type, payload }));
  };
  const c = {
    lines,
    line,
    prompt: (text) => line("event_msg", { type: "item_completed", turn_id: "turn-0001", item: { type: "UserMessage", content: [{ type: "text", text }] } }),
    say: (text, phase) => line("response_item", { type: "message", role: "assistant", ...(phase ? { phase } : {}), content: [{ type: "output_text", text }] }),
    note: (text) => c.say(text, "commentary"),
    final: (text) => c.say(text, "final_answer"),
    call: (id, cmd = "ls cart") => line("response_item", { type: "function_call", name: "exec_command", call_id: id, arguments: JSON.stringify({ cmd }) }),
    peer: (text) => line("response_item", { type: "agent_message", author: "/root/reviewer", recipient: "/root", content: [{ type: "input_text", text }] }),
    tokens: (total) => line("event_msg", { type: "token_count", info: { total_token_usage: { total_tokens: total }, last_token_usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, total_tokens: 15 } } }),
    done: (ms) => line("event_msg", { type: "task_complete", turn_id: "turn-0001", duration_ms: ms }),
    abort: () => line("event_msg", { type: "turn_aborted", reason: "interrupted" }),
    error: (message) => line("event_msg", { type: "error", message }),
    // A task Codex starts: what started it, its model, and, for one it starts by itself while a
    // goal is active, the context it writes as a user message of the model's own.
    started: (trigger) => line("event_msg", { type: "task_started", turn_id: "turn-0002", turn_attribution: { turn_trigger: trigger } }),
    ctx: () => line("turn_context", { model: "gpt-6.1", effort: "medium" }),
    goal: () => {
      c.started("goal");
      c.ctx();
      line("response_item", { type: "message", role: "user", content: [{ type: "input_text", text: `<goal_context>${PLANTED}</goal_context>` }] });
    },
    text: () => `${lines.join("\n")}\n`,
    file: () => {
      const f = tmp(`rollout-2026-11-01T09-00-00-${CODEX_ID}.jsonl`);
      writeFileSync(f, c.text());
      return f;
    },
  };
  line("session_meta", { id: CODEX_ID, cwd: "/home/dev/shop" });
  return c;
}
// Case 1's rollout: a prompt with its reply, then the goal's own task.
function goalRollout(answer = "The cart rounds tax on each line.") {
  const c = codex();
  c.ctx();
  c.prompt("Why does the cart test fail?");
  c.note("Looking at the cart test.");
  c.call("call_1");
  c.final(answer);
  c.done(4000);
  c.goal();
  c.call("call_2", "ls checkout");
  c.final("The goal is met.");
  c.done(6000);
  return c;
}

// A Claude Code transcript, line by line. The clock moves only when a line says so.
function claude() {
  const lines = [];
  let clock = Date.parse("2026-11-01T09:00:00Z");
  let n = 0;
  let parent = null;
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const add = (fields, secs) => {
    const id = uuid();
    lines.push(JSON.stringify({ parentUuid: parent, isSidechain: false, ...fields, uuid: id, timestamp: new Date((clock += secs * 1000)).toISOString() }));
    parent = id;
  };
  const t = {
    lines,
    user: (content, fields = {}, secs = 1) => add({ type: "user", message: { role: "user", content }, ...fields }, secs),
    prompt: (text, secs = 30) => t.user(text, { origin: { kind: "human" } }, secs),
    notify: (secs = 60) => t.user("<task-notification>a job finished</task-notification>", { origin: { kind: "task-notification" } }, secs),
    wake: (secs = 60) => t.user("Continue from where you left off.", { origin: { kind: "auto-continuation" } }, secs),
    // A line Claude Code writes by itself when a loop ticks or a schedule comes due, with no
    // prompt line: a meta line that says only what started the turn.
    tick: (secs = 600, origin = "scheduled") => t.user([{ type: "text", text: PLANTED }], { isMeta: true, promptSource: "system", turnOrigin: origin }, secs),
    // A meta line that says nothing of what started the work (a reminder).
    meta: (secs = 1) => t.user(PLANTED, { isMeta: true }, secs),
    queued: (prompt, kind = "human", fields = {}, secs = 5) => add({ type: "attachment", attachment: { type: "queued_command", prompt, commandMode: "prompt", origin: { kind }, ...fields } }, secs),
    message: (id, blocks, stop, secs = 2) => blocks.forEach((b, i) => add({ type: "assistant", apiBlockIndex: i,
      message: { id, model: "claude-opus-5-5", role: "assistant", type: "message", content: [b], stop_reason: stop, usage: { input_tokens: 5, output_tokens: 10 } } }, i ? 0 : secs)),
    say: (id, text, stop = "end_turn", secs = 2) => t.message(id, [{ type: "text", text }], stop, secs),
    tool: (id, secs = 2) => {
      t.message(id, [{ type: "tool_use", id: `tu_${id}`, name: "Bash", input: { command: "ls cart" } }], "tool_use", secs);
      t.user([{ type: "tool_result", tool_use_id: `tu_${id}`, content: "ok" }], { toolUseResult: { stdout: "ok" } }, 0);
    },
    interrupt: () => t.user("[Request interrupted by user]"),
    error: (text) => add({ type: "assistant", isApiErrorMessage: true, message: { id: "err", model: "<synthetic>", role: "assistant", content: [{ type: "text", text }], stop_reason: "stop_sequence" } }, 1),
    hooks: () => add({ type: "system", subtype: "stop_hook_summary", hookCount: 1 }, 0),
    duration: (ms) => add({ type: "system", subtype: "turn_duration", durationMs: ms }, 0),
    text: () => `${lines.join("\n")}\n`,
    file: () => {
      const f = tmp("00000000-0000-4000-8000-0000000000f1.jsonl");
      writeFileSync(f, t.text());
      return f;
    },
  };
  return t;
}
// A prompt with its reply, ended; what comes next is the test's.
function claudeReplied(answer = "The cart rounds tax on each line.") {
  const t = claude();
  t.prompt("Why does the cart test fail?");
  t.tool("m1");
  t.say("m2", answer);
  t.hooks();
  t.duration(5000);
  return t;
}

// A Pi session file. said(text, "stop") is a finished reply; said(text, "toolUse", call) is not.
function pi() {
  let n = 0;
  const lines = [];
  const entry = (type, fields) => lines.push(JSON.stringify({ type, id: `0000000${++n}`.slice(-8), parentId: null, timestamp: new Date(Date.UTC(2026, 10, 1, 9, 0, n)).toISOString(), ...fields }));
  const p = {
    prompt: (text) => entry("message", { message: { role: "user", content: [{ type: "text", text }] } }),
    said: (text, stopReason, call = null) => entry("message", { message: { role: "assistant", model: "stub-1", stopReason, thinkingLevel: "medium",
      usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10 },
      content: [...(text ? [{ type: "text", text }] : []), ...(call ? [{ type: "toolCall", id: call, name: "bash", arguments: { command: "ls cart" } }] : [])] } }),
    file: () => {
      const f = tmp("2026-11-01T09-00-00-000Z_00000000-0000-7000-8000-000000000002.jsonl");
      writeFileSync(f, `${lines.join("\n")}\n`);
      return f;
    },
  };
  entry("session", { version: 3, cwd: "/home/dev/shop" });
  return p;
}

// An OpenCode 1.x database, through the sqlite3 the reader itself uses. A message's row is
// written again in place while its reply streams.
function oc() {
  const path = tmp("opencode.db");
  const sid = "ses_0001demo";
  const T0 = Date.UTC(2026, 10, 1, 9, 0, 0);
  const q = (x) => `'${String(x).replace(/'/g, "''")}'`;
  const run = (sql) => execFileSync("sqlite3", ["-batch", path], { input: sql, encoding: "utf8" });
  run(`create table session (id text primary key, parent_id text, directory text, title text, time_created integer, time_updated integer, time_archived integer);
    create table message (id text primary key, session_id text, time_created integer, data text);
    create table part (id text primary key, message_id text, session_id text, data text);
    insert into session values ('${sid}', null, '/home/dev/shop', 'Cart rounding', 1000, 9000, null);`);
  const msg = (id, t, data) => run(`insert or replace into message values (${q(id)}, '${sid}', ${T0 + t}, ${q(JSON.stringify(data))});`);
  const part = (id, mid, data) => run(`insert or replace into part values (${q(id)}, ${q(mid)}, '${sid}', ${q(JSON.stringify(data))});`);
  const o = {
    prompt: (id, text, t) => { msg(id, t, { role: "user" }); part(`${id}_p`, id, { type: "text", text }); },
    // finish null: still streaming.
    reply: (id, parent, t, finish, fields = {}) => msg(id, t, { role: "assistant", parentID: parent, agent: "build", modelID: "m", ...fields, ...(finish ? { finish } : {}), tokens: { input: 5, output: 5, reasoning: 0, total: 10, cache: { read: 0, write: 0 } }, time: { created: T0 + t, ...(finish ? { completed: T0 + t + 500 } : {}) } }),
    say: (id, text) => part(`${id}_t`, id, { type: "text", text }),
    tool: (id, call) => part(`${id}_u`, id, { type: "tool", tool: "bash", callID: call, state: { status: "completed", input: { command: "ls cart" }, output: "ok" } }),
    read: (s) => readOpenCode(path, sid, s),
    events: () => readEvents(path, sid),
  };
  return o;
}

// The events of one read of an OpenCode session from its start.
const readEvents = (path, sid) => parseChunk(execFileSync("sh", [opencode, "read", path, sid, "0", "40"], { encoding: "utf8" })).events;
// One read of an OpenCode session, on from where s stopped.
function readOpenCode(path, sid, s = newSession(sid, `${path}#${sid}`)) {
  for (let guard = 0; guard < 20; guard++) {
    const r = parseChunk(execFileSync("sh", [opencode, "read", path, sid, String(s.offset), "40"], { encoding: "utf8" }));
    if (replaced(s, r)) { Object.assign(s, newSession(s.id, s.file)); continue; }
    if (r.head && !s.head) s.head = r.head;
    s.size = r.size;
    if (r.rewind) rewindTail(s);
    for (const e of r.events) apply(s, e);
    s.offset += r.used;
    if (s.offset >= r.size || r.used === 0) break;
  }
  return s;
}

// One read of a transcript, on from where s stopped, in calls of base bytes.
function read(file, harness = "claude", base = 1 << 20, s = newSession("s", file)) {
  let chunk = base;
  for (let guard = 0; guard < 10000 && chunk; guard++) {
    const r = parseChunk(execFileSync("sh", [extractor, file, String(s.offset), String(chunk), harness], { encoding: "utf8" }));
    if (r.head && !s.head) s.head = r.head;
    s.size = r.size;
    for (const e of r.events) apply(s, e);
    s.offset += r.used;
    chunk = nextChunk(s, r.used, chunk, base);
  }
  return s;
}
// The texts in a row's Worked part, and its calls there.
const worked = (turn) => turn.steps.filter((st) => st.k === "text").map((st) => st.t);
const groups = (turn) => turn.steps.filter((st) => st.k === "group").map((st) => st.count);
const senders = (s) => s.turns.map((t) => t.sender.kind);
const replies = (s) => s.turns.map(reply);
const prompts = (s) => s.turns.map((t) => t.prompt);
// A row as a person sees it, for comparing one read with another.
const view = (s) => s.turns.map((t) => [t.prompt, t.sender, reply(t), worked(t), groups(t), t.tools, t.done, t.interrupted, t.durationMs, updatesText(t)]);
// The messages of a row's steps in the export, and its user step's sender.
const said = (x, n) => x.steps.filter((st) => st.extra?.turn === n && st.source === "agent").map((st) => st.message).filter(Boolean);
const asked = (x, n) => x.steps.find((st) => st.extra?.turn === n && st.source === "user");

// ---- the filters ----

describe("the filters: what is marked, and what started by itself", () => {
  const events = (file, harness) => parseChunk(execFileSync("sh", [extractor, file, "0", String(1 << 20), harness], { encoding: "utf8" })).events;
  // Each text with its mark, or null.
  const texts = (ev) => ev.filter((e) => e.k === "t").map((e) => [e.t, e.a ?? null]);
  const starts = (ev) => ev.filter((e) => e.k === "w");

  test("Codex marks a final answer, and says when a goal starts a task", () => {
    const c = codex();
    c.started("user");
    c.prompt("One");
    c.note("Looking.");
    c.say("No phase.");
    c.final("The answer.");
    c.done(1000);
    c.line("event_msg", { type: "task_started", turn_id: "turn-0003" });
    c.line("event_msg", { type: "task_started", turn_id: "turn-0004", turn_attribution: "goal" });
    c.goal();
    const ev = events(c.file(), "codex");
    expect(texts(ev)).toEqual([["Looking.", null], ["No phase.", null], ["The answer.", 1]]);
    const at = JSON.parse(c.lines.find((l) => l.includes('"turn_trigger":"goal"'))).timestamp;
    expect(starts(ev)).toEqual([{ k: "w", o: "goal", ts: at }]);
    expect(JSON.stringify(ev)).not.toContain(PLANTED);
  });

  test("Claude Code marks a text that ends the reply, and says when a schedule starts work", () => {
    const t = claude();
    t.prompt("One");
    t.say("m1", "Looking.", "tool_use");
    t.say("m2", "Cut.", "max_tokens");
    t.say("m3", "Old.", null);
    t.say("m4", "The answer.");
    t.say("m5", "Declined.", "refusal");
    t.say("m6", "Stopped.", "stop_sequence");
    t.meta();
    t.tick(1, "auto_continuation");
    t.queued(PLANTED, "human", { isMeta: true });
    t.queued(PLANTED, "scheduled", { isMeta: true, commandMode: "bash" });
    t.tick(1);
    t.queued(PLANTED, "scheduled", { isMeta: true });
    const ev = events(t.file(), "claude");
    expect(texts(ev)).toEqual([["Looking.", null], ["Cut.", null], ["Old.", null], ["The answer.", 1], ["Declined.", 1], ["Stopped.", 1]]);
    const at = t.lines.slice(-2).map((l) => JSON.parse(l).timestamp);
    expect(starts(ev)).toEqual(at.map((ts) => ({ k: "w", o: "scheduled", ts })));
    expect(JSON.stringify(ev)).not.toContain(PLANTED);
  });

  test("Pi marks a finished reply, and not one cut at the length limit", () => {
    const p = pi();
    p.prompt("One");
    p.said("Looking.", "toolUse", "call_1");
    p.said("Cut.", "length");
    p.said("The answer.", "stop");
    expect(texts(events(p.file(), "pi"))).toEqual([["Looking.", null], ["Cut.", null], ["The answer.", 1]]);
  });

  test("OpenCode marks a finished reply, and not one running, cut, failed or with calls to make", () => {
    const o = oc();
    o.prompt("msg_u1", "One", 0);
    const reply = (id, t, finish, text, fields) => { o.reply(id, "msg_u1", t, finish, fields); o.say(id, text); };
    reply("msg_a1", 100, "tool-calls", "Looking.");
    reply("msg_a2", 200, "length", "Cut.");
    reply("msg_a3", 300, "unknown", "Unknown.");
    reply("msg_a4", 400, "stop", "Failed.", { error: { name: "UnknownError" } });
    reply("msg_a5", 500, "stop", "The answer.");
    reply("msg_a6", 600, null, "Running.");
    expect(texts(o.events())).toEqual([["Looking.", null], ["Cut.", null], ["Unknown.", null], ["Failed.", null], ["The answer.", 1], ["Running.", null]]);
  });

  test("OpenCode 2.x marks a finished reply, and not one cut, failed or with calls to make", () => {
    const o = oc2();
    o.row("msg_u1", "user", 0, { text: "One", files: [], agents: [] });
    const said = (id, t, finish, text, fields) => o.said(id, t, finish, [{ type: "text", text }], fields);
    said("msg_a1", 100, "tool-calls", "Looking.");
    said("msg_a2", 200, "length", "Cut.");
    said("msg_a3", 300, "stop", "Failed.", { error: { type: "unknown" } });
    said("msg_a4", 400, "stop", "The answer.");
    said("msg_a5", 500, undefined, "Running.");
    expect(texts(readEvents(o.path, o.sid))).toEqual([["Looking.", null], ["Cut.", null], ["Failed.", null], ["The answer.", 1], ["Running.", null]]);
  });
});

// ---- case 1: the finished reply stays on its row ----

describe("case 1: a finished reply, then a goal's own task", () => {
  // Red on the base: "The goal is met."; the reply is a step of the work.
  test("Codex: the reply stays on its row and out of the work", () => {
    const [row] = read(goalRollout().file(), "codex").turns;
    expect(reply(row)).toBe("The cart rounds tax on each line.");
    expect(worked(row)).toEqual(["Looking at the cart test."]);
  });

  // Red on the base: "The goal is met."; the reply is a step cut to 3,400 characters.
  test("Codex: a long reply is whole, not cut to a step's length", () => {
    const answer = long("rounding");
    const [row] = read(goalRollout(answer).file(), "codex").turns;
    expect(reply(row)).toBe(answer);
    expect(row.steps.some((st) => st.cut)).toBe(false);
  });

  // Red on the base: the goal's text is joined on, "...each line.\n\nThe goal is met.".
  test("Codex: a goal task that only writes adds nothing to the reply before it", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.final("The cart rounds tax on each line.");
    c.done(4000);
    c.goal();
    c.final("The goal is met.");
    c.done(6000);
    expect(reply(read(c.file(), "codex").turns[0])).toBe("The cart rounds tax on each line.");
  });

  // Red on the base: "" ("No final reply"), and the row is done.
  test("Codex: while the goal's task still runs, the row before it keeps its reply and is done", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.final("The cart rounds tax on each line.");
    c.done(4000);
    c.goal();
    c.call("call_2");
    const [row] = read(c.file(), "codex").turns;
    expect([row.done, reply(row)]).toEqual([true, "The cart rounds tax on each line."]);
  });

  // Red on the base: "The tick's reply."; the row's own reply is a step of its work.
  test("Claude Code: the reply stays on its row when a loop ticks", () => {
    const t = claudeReplied();
    t.tick();
    t.tool("m3");
    t.say("m4", "The tick's reply.");
    t.hooks();
    const [row] = read(t.file()).turns;
    expect(reply(row)).toBe("The cart rounds tax on each line.");
    expect(worked(row)).toEqual([]);
  });

  // Red on the base: not found, a length of 0, and not a row an agent's message got a reply on.
  test("a search, a pin's length and the folded row of an agent's message find the marked reply", () => {
    const c = codex();
    c.peer("Is the cart done?");
    c.final("The cart rounds tax on each line.");
    c.call("call_1");
    c.done(4000);
    const s = read(c.file(), "codex");
    const [row] = s.turns;
    expect(row.sender).toEqual({ kind: "peer", name: "reviewer" });
    expect([matches(row, "rounds tax"), seenOf(row).len, agentReplied(row, s.turns)]).toEqual([true, 33, true]);
  });
});

// ---- B: work that starts by itself is a row of its own ----

describe("B: work that starts by itself after a row ended", () => {
  // Red on the base: one row.
  test("Codex: a goal's task is a row of its own, with its own reply, calls and time", () => {
    const s = read(goalRollout().file(), "codex");
    expect(replies(s)).toEqual(["The cart rounds tax on each line.", "The goal is met."]);
    expect(senders(s)).toEqual(["you", "goal"]);
    const [row, goal] = s.turns;
    expect([goal.prompt, goal.agent, goal.done, goal.tools, goal.durationMs]).toEqual(["", true, true, 1, 6000]);
    expect([row.tools, row.durationMs]).toEqual([1, 4000]);
    expect(JSON.stringify(s)).not.toContain(PLANTED);
  });

  // Red on the base: one row with "The goal is met." joined on.
  test("Codex: a goal's task that only writes is a row of its own", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.final("The cart rounds tax on each line.");
    c.done(4000);
    c.goal();
    c.final("The goal is met.");
    c.done(6000);
    const s = read(c.file(), "codex");
    expect(replies(s)).toEqual(["The cart rounds tax on each line.", "The goal is met."]);
    expect(senders(s)).toEqual(["you", "goal"]);
  });

  // Red on the base: one row.
  test("Codex: each of a goal's tasks is a row, and a prompt between them keeps its own", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.final("One.");
    c.done(1000);
    c.goal();
    c.call("call_2");
    c.final("Two.");
    c.done(1000);
    c.started("user");
    c.ctx();
    c.prompt("And the checkout?");
    c.final("Three.");
    c.done(1000);
    c.goal();
    c.call("call_4");
    c.final("Four.");
    c.done(1000);
    const s = read(c.file(), "codex");
    expect(replies(s)).toEqual(["One.", "Two.", "Three.", "Four."]);
    expect(senders(s)).toEqual(["you", "goal", "you", "goal"]);
  });

  // Red on the base: one row, done.
  test("Codex: a goal's task that still runs is the newest row and not done", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.final("One.");
    c.done(1000);
    c.goal();
    c.call("call_2");
    const s = read(c.file(), "codex");
    expect(s.turns.map((t) => [t.sender.kind, t.done, t.tools])).toEqual([["you", true, 0], ["goal", false, 1]]);
  });

  // Red on the base: one row with two token counts on it.
  test("Codex: the count Codex writes again at a task's start makes no row and stays where it was", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.final("One.");
    c.tokens(100);
    c.done(1000);
    c.goal();
    c.tokens(100);
    c.call("call_2");
    c.final("Two.");
    c.tokens(200);
    c.done(1000);
    const s = read(c.file(), "codex");
    expect(s.turns.map((t) => Object.keys(t.usage))).toEqual([["t100"], ["t200"]]);
  });

  // Red on the base: one row with no reply; the stop marks nothing, since the row had ended.
  test("Codex: a goal's task a person stops is its own row, interrupted", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.final("One.");
    c.done(1000);
    c.goal();
    c.call("call_2");
    c.abort();
    const s = read(c.file(), "codex");
    expect(s.turns.map((t) => [t.sender.kind, reply(t), t.interrupted])).toEqual([["you", "One.", false], ["goal", "", true]]);
  });

  // Green on the base and after: a task a person's prompt starts is that prompt's row.
  test("Codex: a person's own task makes one row", () => {
    const c = codex();
    c.started("user");
    c.ctx();
    c.prompt("Why does the cart test fail?");
    c.final("One.");
    c.done(1000);
    const s = read(c.file(), "codex");
    expect([prompts(s), senders(s)]).toEqual([["Why does the cart test fail?"], ["you"]]);
  });

  // Green on the base and after: no work, no row.
  test("Codex: a goal's task that did nothing makes no row", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.final("One.");
    c.done(1000);
    c.goal();
    c.done(0);
    const s = read(c.file(), "codex");
    expect(view(s).map((r) => [r[0], r[2], r[6]])).toEqual([["Why does the cart test fail?", "One.", true]]);
  });

  // Red on the base: 1700, the task's time on the row above.
  test("Codex: the time of a goal's task that did nothing is not the row above's", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.final("One.");
    c.done(1000);
    c.goal();
    c.done(700);
    const s = read(c.file(), "codex");
    expect(s.turns.map((t) => [reply(t), t.durationMs, t.done])).toEqual([["One.", 1000, true]]);
  });

  // Green on the base and after: a prompt that comes before the goal's task worked takes it.
  test("Codex: a prompt that comes before a goal's task did anything is the row", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.final("One.");
    c.done(1000);
    c.goal();
    c.prompt("Stop there");
    c.final("Stopped.");
    c.done(1000);
    const s = read(c.file(), "codex");
    expect([prompts(s), replies(s)]).toEqual([["Why does the cart test fail?", "Stop there"], ["One.", "Stopped."]]);
  });

  // Red on the base: one row.
  test("Claude Code: a loop tick is a row of its own, with its own reply, calls and time", () => {
    const t = claudeReplied();
    t.tick();
    t.tool("m3");
    t.say("m4", "The tick's reply.");
    t.hooks();
    t.duration(4000);
    const s = read(t.file());
    expect(replies(s)).toEqual(["The cart rounds tax on each line.", "The tick's reply."]);
    expect(senders(s)).toEqual(["you", "scheduled"]);
    const [row, tick] = s.turns;
    expect([tick.prompt, tick.agent, tick.done, tick.tools, tick.durationMs]).toEqual(["", true, true, 1, 4000]);
    expect([row.tools, row.durationMs]).toEqual([1, 5000]);
    expect(JSON.stringify(s)).not.toContain(PLANTED);
  });

  // Red on the base: one row with the tick's text joined on.
  test("Claude Code: a scheduled line that only gets a text is a row of its own", () => {
    const t = claudeReplied();
    t.tick();
    t.say("m3", "Nothing to do.");
    t.hooks();
    const s = read(t.file());
    expect(replies(s)).toEqual(["The cart rounds tax on each line.", "Nothing to do."]);
    expect(senders(s)).toEqual(["you", "scheduled"]);
  });

  // Red on the base: one row.
  test("Claude Code: a scheduled line that comes as a queued meta line after the row ended is a row of its own", () => {
    const t = claudeReplied();
    t.queued(PLANTED, "scheduled", { isMeta: true }, 600);
    t.tool("m3");
    t.say("m4", "The scheduled reply.");
    t.hooks();
    const s = read(t.file());
    expect(replies(s)).toEqual(["The cart rounds tax on each line.", "The scheduled reply."]);
    expect(senders(s)).toEqual(["you", "scheduled"]);
    expect(JSON.stringify(s)).not.toContain(PLANTED);
  });

  // Red on the base: one row; its time holds every tick's.
  test("Claude Code: a loop's ticks are a row each, and the row before them keeps its own time", () => {
    const t = claudeReplied();
    for (let i = 0; i < 3; i++) {
      t.tick(3600);
      t.tool(`n${i}`);
      t.say(`r${i}`, `Tick ${i}.`);
      t.hooks();
    }
    const s = read(t.file());
    expect(replies(s)).toEqual(["The cart rounds tax on each line.", "Tick 0.", "Tick 1.", "Tick 2."]);
    expect(s.turns.map((x) => x.durationMs)).toEqual([5000, 4000, 4000, 4000]);
  });

  // Green on the base and after: the line lands while the row above still owes its reply.
  test("Claude Code: a scheduled line that lands while a row is open starts no row", () => {
    const t = claude();
    t.prompt("Why does the cart test fail?");
    t.tool("m1");
    t.tick(1);
    t.say("m2", "One.");
    t.hooks();
    const s = read(t.file());
    expect([prompts(s), replies(s)]).toEqual([["Why does the cart test fail?"], ["One."]]);
  });

  // Green on the base and after: the scheduled prompt that follows has a row of its own.
  test("Claude Code: a scheduled line before a scheduled prompt adds no second row", () => {
    const t = claudeReplied("One.");
    t.tick();
    t.user("Check the nightly build", { origin: { kind: "scheduled" } }, 0);
    t.say("m3", "It passed.");
    t.hooks();
    const s = read(t.file());
    expect([prompts(s), replies(s)]).toEqual([["Why does the cart test fail?", "Check the nightly build"], ["One.", "It passed."]]);
  });

  // Green on the base and after: no work, no row.
  test("Claude Code: a scheduled line with nothing after it makes no row", () => {
    const t = claudeReplied("One.");
    t.tick();
    const s = read(t.file());
    expect([prompts(s), replies(s)]).toEqual([["Why does the cart test fail?"], ["One."]]);
  });

  // Red before the fix: the row kept its 40 s estimate. A line about a tick can come between the
  // row's end and its turn_duration line; that time is the row's, and the tick's work its own.
  for (const ends of [["hooks", "line", "duration"], ["line", "duration"]]) {
    test(`Claude Code: the row keeps its turn_duration when a tick's line comes before it (${ends.join(", ")})`, () => {
      const t = claude();
      t.prompt("Why does the cart test fail?");
      t.say("m1", "One.", "end_turn", 40);
      for (const e of ends) e === "line" ? t.tick(1) : e === "hooks" ? t.hooks() : t.duration(95000);
      const ended = read(t.file());
      expect(ended.turns.map((x) => x.durationMs)).toEqual([95000]);
      t.tool("m2");
      t.say("m3", "The tick's reply.");
      t.hooks();
      t.duration(6000);
      const s = read(t.file());
      expect([replies(s), senders(s)]).toEqual([["One.", "The tick's reply."], ["you", "scheduled"]]);
      expect(s.turns.map((x) => x.durationMs)).toEqual([95000, 6000]);
    });
  }

  // Red on the base: the command's line becomes a row and takes the tick's work from there on.
  test("Claude Code: a local command typed while a tick works is no row, and the tick keeps its work", () => {
    const t = claudeReplied("One.");
    t.tick();
    t.tool("m3");
    t.user("<command-name>/usage</command-name>\n<command-message>usage</command-message>\n<command-args></command-args>", {}, 1);
    t.tool("m4");
    t.say("m5", "The tick's reply.");
    t.hooks();
    const s = read(t.file());
    expect([prompts(s), replies(s), senders(s)]).toEqual([["Why does the cart test fail?", ""], ["One.", "The tick's reply."], ["you", "scheduled"]]);
    expect(s.turns[1].tools).toBe(2);
  });

  // A local command's lines, and a skill's line as it is typed.
  const local = (t, output = true) => {
    t.user("<command-name>/usage</command-name>\n<command-message>usage</command-message>\n<command-args></command-args>", {}, 1);
    if (output) t.user("<local-command-stdout>ok</local-command-stdout>", {}, 0);
  };
  const skill = (t, fields = {}) => t.user("<command-message>check</command-message>\n<command-name>/check</command-name>", fields, 1);

  // Red on the base and at c37c64f3, both: "/usage" is the row, and the tick's reply its reply.
  for (const [name, output] of [["", true], [", the line the tick's line follows", false]])
    test(`Claude Code: a local command typed some time before a tick${name} is no row, and the tick keeps its work`, () => {
      const t = claudeReplied("One.");
      local(t, output);
      t.tick();
      t.tool("m3");
      t.say("m4", "The tick's reply.");
      t.hooks();
      const s = read(t.file());
      expect([prompts(s), replies(s), senders(s)]).toEqual([["Why does the cart test fail?", ""], ["One.", "The tick's reply."], ["you", "scheduled"]]);
    });

  // Red on the base and at c37c64f3: as above.
  test("Claude Code: a local command typed between a tick's line and its first work is no row", () => {
    const t = claudeReplied("One.");
    t.tick();
    local(t);
    t.tool("m3");
    t.say("m4", "The tick's reply.");
    t.hooks();
    const s = read(t.file());
    expect([prompts(s), replies(s), senders(s)]).toEqual([["Why does the cart test fail?", ""], ["One.", "The tick's reply."], ["you", "scheduled"]]);
  });

  // Green on the base and after.
  test("Claude Code: a skill typed between a tick's line and its first work is the row", () => {
    const t = claudeReplied("One.");
    t.tick();
    skill(t);
    t.meta();
    t.tool("m3");
    t.say("m4", "Checked.");
    t.hooks();
    const s = read(t.file());
    expect([prompts(s), replies(s), senders(s)]).toEqual([["Why does the cart test fail?", "/check"], ["One.", "Checked."], ["you", "you"]]);
  });

  // Green on the base and after.
  test("Claude Code: a skill the scheduler runs, whose text is a scheduled line, is the row", () => {
    const t = claudeReplied("One.");
    skill(t, { origin: { kind: "scheduled" } });
    t.tick(1);
    t.tool("m3");
    t.say("m4", "Checked.");
    t.hooks();
    const s = read(t.file());
    expect([prompts(s), replies(s), senders(s)]).toEqual([["Why does the cart test fail?", "/check"], ["One.", "Checked."], ["you", "scheduled"]]);
  });

  // Green on the base and after: no tick's line comes between.
  test("Claude Code: a skill with no text line of its own is the row once the model works", () => {
    const t = claudeReplied("One.");
    skill(t);
    t.tool("m3");
    t.say("m4", "Checked.");
    t.hooks();
    expect(prompts(read(t.file()))).toEqual(["Why does the cart test fail?", "/check"]);
  });

  // Red on the base and at c37c64f3: the work joins the row above, and the line's text is read.
  test("Claude Code: a queued scheduled line whose text begins as a task notification starts a row", () => {
    const notice = "<task-notification>\n<task-id>a1b2c3</task-id>\n<status>completed</status>\n</task-notification>";
    const t = claudeReplied("One.");
    t.queued(`${notice} check the build`, "scheduled", { isMeta: true });
    t.tool("m3");
    t.say("m4", "Nothing new.");
    t.hooks();
    // A real notification queued, not a scheduled line: its state is read, as before.
    t.queued(notice, "task-notification");
    const file = t.file();
    const s = read(file);
    expect([replies(s), senders(s)]).toEqual([["One.", "Nothing new."], ["you", "scheduled"]]);
    expect(parseChunk(execFileSync("sh", [extractor, file, "0", String(1 << 20), "claude"], { encoding: "utf8" })).events.filter((e) => e.k === "n").map((e) => e.a)).toEqual(["a1b2c3"]);
  });

  // Red on the base: noticeTurn knows a task notification only, and "goal" reads "Background agent".
  test("a row that started by itself is a quiet line that says what started it", () => {
    const goal = read(goalRollout().file(), "codex").turns[1];
    const t = claudeReplied();
    t.tick();
    t.say("m3", "Nothing to do.");
    const tick = read(t.file()).turns[1];
    expect([noticeTurn(goal), noticeTurn(tick)]).toEqual([true, true]);
    expect(senderLabel({ kind: "goal" }, 380)).not.toBe("Background agent");
    expect(senderLabel({ kind: "scheduled" }, 380)).toBe("Scheduled");
  });
});

// ---- C: several marked answers in one row ----

describe("C: more than one marked answer in a row", () => {
  // Red on the base: "Second answer."; the first is a step of the work.
  test("Codex: both answers are shown, whole and in order, and neither is in the work", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.call("call_1");
    c.final("First answer.");
    c.call("call_2");
    c.note("Checking once more.");
    c.call("call_3");
    c.final("Second answer.");
    c.done(1000);
    const [row] = read(c.file(), "codex").turns;
    expect(reply(row)).toBe("First answer.\n\nSecond answer.");
    expect(worked(row)).toEqual(["Checking once more."]);
    expect(groups(row)).toEqual([1, 1, 1]);
  });

  // Red on the base: "".
  test("Codex: a call after the answer, with nothing said since, leaves the answer the reply", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.final("First answer.");
    c.call("call_1");
    c.done(1000);
    const [row] = read(c.file(), "codex").turns;
    expect([reply(row), worked(row), groups(row)]).toEqual(["First answer.", [], [1]]);
  });

  // Red on the base: "Tidying up."
  test("Codex: a note Codex marks as commentary after the answer is work, not the reply", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.final("First answer.");
    c.call("call_1");
    c.note("Tidying up.");
    c.done(1000);
    const [row] = read(c.file(), "codex").turns;
    expect([reply(row), worked(row)]).toEqual(["First answer.", ["Tidying up."]]);
  });

  // Red on the base and at c37c64f3: "First answer.\n\nTidying up." with nothing in the work.
  test("Codex: a note right after the answer, with no call between, is work, not the reply", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.call("call_1");
    c.final("First answer.");
    c.note("Tidying up.");
    const running = read(c.file(), "codex").turns[0];
    expect([reply(running), worked(running), running.done]).toEqual(["First answer.", [], false]);
    c.done(1000);
    const [row] = read(c.file(), "codex").turns;
    expect([reply(row), worked(row), groups(row)]).toEqual(["First answer.", ["Tidying up."], [1]]);
    expect(row.steps.map((st) => st.k)).toEqual(["group", "final", "text"]);
  });

  // Red on the base and at c37c64f3: one text of all three.
  test("Codex: a note between two answers, with no call between, is work, and both answers the reply", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.call("call_1");
    c.final("First answer.");
    c.note("Tidying up.");
    c.note("Nearly there.");
    c.final("Second answer.");
    c.done(1000);
    const [row] = read(c.file(), "codex").turns;
    expect(reply(row)).toBe("First answer.\n\nSecond answer.");
    expect(worked(row)).toEqual(["Tidying up.\n\nNearly there."]);
    expect(row.steps.map((st) => st.k)).toEqual(["group", "final", "text"]);
  });

  // Red on the base ("") and at c37c64f3: the first answer, the note and the second are one.
  test("Codex: a note between two answers stays out of both when a call follows", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.final("First answer.");
    c.note("Tidying up.");
    c.final("Second answer.");
    c.call("call_1");
    c.note("And the rest.");
    c.done(1000);
    const [row] = read(c.file(), "codex").turns;
    expect(reply(row)).toBe("First answer.\n\nSecond answer.");
    expect(row.steps.map((st) => (st.k === "group" ? st.count : st.t))).toEqual(["First answer.", "Tidying up.", "Second answer.", 1, "And the rest."]);
  });

  // Red on the base and at c37c64f3: the note is in the reply.
  test("Codex: a note after the last of two answers is work, with a call between the answers or not", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.final("First answer.");
    c.call("call_1");
    c.final("Second answer.");
    c.note("Tidying up.");
    c.abort();
    const [row] = read(c.file(), "codex").turns;
    expect([reply(row), worked(row), row.interrupted]).toEqual(["First answer.\n\nSecond answer.", ["Tidying up."], true]);
  });

  // Red on the base and at c37c64f3: the cut text is in the reply.
  test("Claude Code: a text cut at the length limit right after an answer is work", () => {
    const t = claudeReplied("First answer.");
    t.say("m3", "A half that was cut", "max_tokens");
    t.duration(7000);
    const [row] = read(t.file()).turns;
    expect([reply(row), worked(row)]).toEqual(["First answer.", ["A half that was cut"]]);
  });

  // Green on the base and after: no answer comes before it.
  test("Codex: a note before the first answer, with no call between, stays with it", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.call("call_1");
    c.note("Here it is.");
    c.final("First answer.");
    c.final("And its end.");
    c.done(1000);
    const [row] = read(c.file(), "codex").turns;
    expect([reply(row), worked(row)]).toEqual(["Here it is.\n\nFirst answer.\n\nAnd its end.", []]);
  });

  // Red on the base and at c37c64f3: one message of all three, with no row of its own.
  test("a note between two answers keeps its place in the trajectory, the ledger and the export", () => {
    const c = codex();
    c.prompt("One");
    c.final("First answer.");
    c.note("Tidying up.");
    c.final("Second answer.");
    c.done(1000);
    const s = read(c.file(), "codex");
    const [tr] = trajectories(s);
    expect(tr.groups.flatMap((g) => g.cells).map((x) => x.text)).toEqual(["One", "First answer.", "Tidying up.", "Second answer."]);
    expect(ledgerTurn(s, s.turns[0], 0).steps.map((r) => [r.lk, r.text])).toEqual([["you", "One"], ["reply", "First answer."], ["text", "Tidying up."], ["reply", "Second answer."]]);
    expect(said(atif(s, { agent: "codex" }), 1)).toEqual(["First answer.", "Tidying up.", "Second answer."]);
  });

  // Red on the base and at c37c64f3: the reasoning before the note is the second answer's.
  test("the export keeps each reasoning with the answer or the note it came before", () => {
    const s = newSession("s", "f");
    const ts = (n) => new Date(Date.UTC(2026, 10, 1, 9, 0, n)).toISOString();
    for (const e of [
      { k: "p", o: "human", t: "One", ts: ts(0) },
      { k: "h", t: "R1", ts: ts(1) }, { k: "t", t: "First answer.", a: 1, ts: ts(2) },
      { k: "h", t: "R2", ts: ts(3) }, { k: "h", w: 1, ts: ts(3) }, { k: "t", t: "Tidying up.", ts: ts(4) },
      { k: "h", t: "R3", ts: ts(5) }, { k: "t", t: "Second answer.", a: 1, ts: ts(6) },
      { k: "d", ms: 7000, ts: ts(7) },
    ]) apply(s, e);
    const [row] = s.turns;
    expect(row.steps.map((st) => [st.k, st.t, st.r ?? null, st.h ?? 0, st.at])).toEqual([
      ["final", "First answer.", "R1", 0, Date.parse(ts(2))], ["text", "Tidying up.", "R2", 1, Date.parse(ts(4))]]);
    expect([row.after, row.reasoning, row.held ?? 0, row.afterAt]).toEqual([["Second answer."], ["R3"], 0, Date.parse(ts(6))]);
  });

  // Red on the base and at c37c64f3: the note is in a message with the answer.
  test("the export keeps a background update's note apart from its answers", () => {
    const t = claudeReplied("One.");
    t.wake();
    t.say("m3", "The build is green.");
    t.say("m4", "Half of a note", "max_tokens");
    t.say("m5", "And the tests.");
    t.hooks();
    const s = newSession("s", "f");
    s.keepWakes = true;
    expect(said(atif(read(t.file(), "claude", 1 << 20, s), { agent: "claude" }), 1)).toEqual(["One.", "The build is green.", "Half of a note", "And the tests."]);
  });

  // Red on the base: the first is a step of 3,400 characters.
  test("Codex: two long answers are both whole", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.final(long("first"));
    c.call("call_1");
    c.final(long("second"));
    c.done(1000);
    expect(reply(read(c.file(), "codex").turns[0])).toBe(`${long("first")}\n\n${long("second")}`);
  });

  // Red on the base: "The end."; a text past the work's 300 steps is dropped.
  test("Codex: an answer past the steps a row keeps is still whole", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    for (let i = 0; i < 160; i++) {
      c.note(`Step ${i}.`);
      c.call(`call_${i}`);
    }
    c.final("First answer.");
    c.call("call_last");
    c.final("The end.");
    c.done(1000);
    expect(reply(read(c.file(), "codex").turns[0])).toBe("First answer.\n\nThe end.");
  });

  // Red on the base: the first row has no reply and reads "Answered together with #2".
  test("Codex: a prompt that steers a task after its answer leaves that answer on its own row", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.final("First answer.");
    c.call("call_1");
    c.prompt("Also the checkout");
    c.call("call_2");
    c.final("Second answer.");
    c.done(1000);
    const s = read(c.file(), "codex");
    expect(replies(s)).toEqual(["First answer.", "Second answer."]);
    expect([s.turns[0].answeredBy, s.turns[0].done]).toEqual([null, true]);
  });

  // Green on the base and after.
  test("Codex: a prompt that steers a task before its answer shares the answer with the row above", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.note("Looking at the cart test.");
    c.call("call_1");
    c.prompt("Also the checkout");
    c.call("call_2");
    c.final("Both.");
    c.done(1000);
    const s = read(c.file(), "codex");
    expect([replies(s), s.turns[0].answeredBy]).toEqual([["", "Both."], 2]);
  });

  // Red on the base: "Done now." (turn-ends.test.js holds that today; see its Stop hook test).
  test("Claude Code: an answer a Stop hook sends back, then another, are both shown in one row", () => {
    const t = claude();
    t.prompt("First question");
    t.say("m1", "Done, I think.");
    t.hooks();
    t.tool("m2");
    t.say("m3", "Done now.");
    t.hooks();
    t.duration(20000);
    const s = read(t.file());
    expect(replies(s)).toEqual(["Done, I think.\n\nDone now."]);
    expect([worked(s.turns[0]), s.turns[0].durationMs]).toEqual([[], 20000]);
  });

  // Red on the base: the first row has no reply and reads "Answered together with #2".
  test("Claude Code: a prompt queued after a Stop hook sent an answer back leaves that answer on its own row", () => {
    const t = claude();
    t.prompt("First question");
    t.say("m1", "Done, I think.");
    t.meta();
    t.tool("m2");
    t.queued("Also the checkout");
    t.tool("m3");
    t.say("m4", "Done now.");
    t.hooks();
    const s = read(t.file());
    expect([prompts(s), replies(s)]).toEqual([["First question", "Also the checkout"], ["Done, I think.", "Done now."]]);
    expect([s.turns[0].answeredBy, s.turns[0].done]).toEqual([null, true]);
  });

  // Red on the base: "Done now.".
  test("Claude Code: work after a meta line that says nothing of what started it stays on the row, with both answers", () => {
    const t = claude();
    t.prompt("First question");
    t.say("m1", "Done, I think.");
    t.hooks();
    t.meta();
    t.say("m2", "One more look.", "tool_use");
    t.tool("m3");
    t.say("m4", "Done now.");
    t.hooks();
    const s = read(t.file());
    expect(replies(s)).toEqual(["Done, I think.\n\nDone now."]);
    expect(JSON.stringify(s)).not.toContain(PLANTED);
  });

  // Red on the base: "Done now.".
  test("Pi: an answer Pi marks as its stop, then more calls in the row, is kept", () => {
    const p = pi();
    p.prompt("First question");
    p.said("Done, I think.", "stop");
    p.said("One more look.", "toolUse", "call_1");
    p.said("Done now.", "stop");
    const [row] = read(p.file(), "pi").turns;
    expect([reply(row), groups(row)]).toEqual(["Done, I think.\n\nDone now.", [1]]);
  });

  // Red on the base: "Done now.".
  test("a background update's marked text is not replaced by what the same update says after more calls", () => {
    const t = claudeReplied("One.");
    t.wake();
    t.say("m3", "The build passed.");
    t.tool("m4");
    t.say("m5", "And the tests.");
    t.hooks();
    const [row] = read(t.file()).turns;
    expect(reply(row)).toBe("One.");
    expect(updatesText(row)).toBe("The build passed.\n\nAnd the tests.");
  });
});

// ---- D: "No final reply" only when there is none ----

describe("D: no reply only when there is none", () => {
  // Green on the base and after.
  test("Codex: a row with no text, one interrupted and one that failed have no reply", () => {
    const c = codex();
    c.prompt("One");
    c.call("call_1");
    c.done(1000);
    c.prompt("Two");
    c.call("call_2");
    c.abort();
    c.prompt("Three");
    c.error("stream closed");
    c.done(1000);
    const s = read(c.file(), "codex");
    expect(s.turns.map((t) => [reply(t), t.interrupted, t.errors])).toEqual([["", false, []], ["", true, []], ["", false, ["stream closed"]]]);
  });

  // Green on the base and after.
  test("the row says why it has no reply", async () => {
    const t = claude();
    t.prompt("One");
    t.tool("m1");
    t.hooks();
    t.prompt("Two");
    t.tool("m2");
    t.interrupt();
    t.prompt("Three");
    t.error("API Error: overloaded");
    const { v } = await pane(t.file());
    expect(v.current().turns.map((x) => v.noReplyText(x))).toEqual(["No final reply.", "No reply · interrupted after 1 tool call.", "API Error: overloaded"]);
  });

  // Green on the base and after: a row with nothing but notes shows its last one.
  test("Codex: a row that ends on a note, with no answer marked, shows the note", () => {
    const c = codex();
    c.prompt("One");
    c.note("Looking at the cart test.");
    c.call("call_1");
    c.note("Nothing to change.");
    c.done(1000);
    expect(reply(read(c.file(), "codex").turns[0])).toBe("Nothing to change.");
  });

  // Red on the base: "".
  test("Codex: an answer, then more work a person stops, keeps the answer", () => {
    const c = codex();
    c.prompt("One");
    c.final("First answer.");
    c.call("call_1");
    c.abort();
    const [row] = read(c.file(), "codex").turns;
    expect([reply(row), row.interrupted]).toEqual(["First answer.", true]);
  });
});

// ---- the mark arrives a read later ----

describe("a read that ends anywhere, and a tail read again", () => {
  // Red on the base: one row with no reply, whatever the calls' size.
  test("Codex: small calls give the same rows as one read", () => {
    const file = goalRollout().file();
    const whole = read(file, "codex");
    expect(replies(whole)).toEqual(["The cart rounds tax on each line.", "The goal is met."]);
    expect(view(read(file, "codex", 200))).toEqual(view(whole));
  });

  // Red on the base: one row at the end.
  test("Codex: a read that ends between a goal's start and its first call", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.final("One.");
    c.done(1000);
    c.goal();
    const file = c.file();
    const s = read(file, "codex");
    expect(view(s).map((r) => [r[2], r[6]])).toEqual([["One.", true]]);
    const was = c.lines.length;
    c.call("call_2");
    c.final("Two.");
    c.done(1000);
    appendFileSync(file, `${c.lines.slice(was).join("\n")}\n`);
    read(file, "codex", 1 << 20, s);
    expect([replies(s), senders(s)]).toEqual([["One.", "Two."], ["you", "goal"]]);
  });

  // Red on the base: "".
  test("Codex: the line that marks the answer is half written at the first read", () => {
    const c = codex();
    c.prompt("Why does the cart test fail?");
    c.note("Looking at the cart test.");
    c.call("call_1");
    const file = c.file();
    const was = c.lines.length;
    c.final("First answer.");
    const line = `${c.lines[was]}\n`;
    appendFileSync(file, line.slice(0, 60));
    const s = read(file, "codex");
    expect([reply(s.turns[0]), s.turns[0].done]).toEqual(["", false]);
    appendFileSync(file, line.slice(60));
    read(file, "codex", 1 << 20, s);
    expect(reply(s.turns[0])).toBe("First answer.");
    c.call("call_2");
    c.done(1000);
    appendFileSync(file, `${c.lines.slice(was + 1).join("\n")}\n`);
    read(file, "codex", 1 << 20, s);
    expect([reply(s.turns[0]), worked(s.turns[0])]).toEqual(["First answer.", ["Looking at the cart test."]]);
  });

  // Red on the base: one row at the end.
  test("Claude Code: a read that ends between a loop's tick and its work, and small calls", () => {
    const t = claudeReplied("One.");
    t.tick();
    const file = t.file();
    const s = read(file);
    expect(replies(s)).toEqual(["One."]);
    const was = t.lines.length;
    t.tool("m3");
    t.say("m4", "The tick's reply.");
    t.hooks();
    appendFileSync(file, `${t.lines.slice(was).join("\n")}\n`);
    read(file, "claude", 1 << 20, s);
    expect([replies(s), senders(s)]).toEqual([["One.", "The tick's reply."], ["you", "scheduled"]]);
    expect(view(read(file, "claude", 300))).toEqual(view(read(file)));
  });

  // Red on the base: at the second read the row has no reply, and at the end only the second
  // answer. Each read takes the running turn again from its prompt.
  test("OpenCode: a turn read again and again as its answers are marked keeps each once", () => {
    const o = oc();
    o.prompt("msg_u1", "Why does the cart test fail?", 0);
    o.reply("msg_a1", "msg_u1", 100, null);
    o.say("msg_a1", "First ans");
    const s = o.read();
    expect([prompts(s), replies(s), s.turns[0].done]).toEqual([["Why does the cart test fail?"], ["First ans"], false]);
    // The message's row again, now marked, with the next message's call already there.
    o.reply("msg_a1", "msg_u1", 100, "stop");
    o.say("msg_a1", "First answer.");
    o.reply("msg_a2", "msg_u1", 2000, "tool-calls");
    o.tool("msg_a2", "call_2");
    o.read(s);
    expect([replies(s), s.turns[0].done]).toEqual([["First answer."], false]);
    o.reply("msg_a3", "msg_u1", 3000, "stop");
    o.say("msg_a3", "Second answer.");
    o.read(s);
    expect([prompts(s), replies(s), worked(s.turns[0]), groups(s.turns[0])]).toEqual([["Why does the cart test fail?"], ["First answer.\n\nSecond answer."], [], [1]]);
    expect(s.turns[0].done).toBe(true);
  });
});

// An OpenCode 2.x database: the prompt, the two replies, the call and the idle row it writes.
function oc2() {
  const path = tmp("opencode.db");
  const sid = "ses_0002demo";
  const T0 = Date.UTC(2026, 10, 1, 9, 0, 0);
  let seq = 0;
  const run = (sql) => execFileSync("sqlite3", ["-batch", path], { input: sql, encoding: "utf8" });
  run(`create table session_v2 (id text primary key, project_id text, parent_id text, directory text, title text, time_created integer, time_updated integer, time_archived integer, time_busy integer, time_idle integer);
    create table session_message (id text primary key, session_id text, type text, seq integer, time_created integer, time_updated integer, data text);
    create table session_part (message_id text, session_id text, ordinal integer, type text, data text);
    insert into session_v2 values ('${sid}', 'prj', null, '/home/dev/shop', 'Cart rounding', ${T0}, ${T0 + 9000}, null, ${T0 + 100}, null);`);
  const row = (id, type, t, data) => run(`insert into session_message values ('${id}', '${sid}', '${type}', ${(seq += 3)}, ${T0 + t}, ${T0 + t}, '${JSON.stringify({ time: { created: T0 + t }, ...data }).replace(/'/g, "''")}');`);
  const said = (id, t, finish, content, fields = {}) => row(id, "assistant", t, { ...fields, time: { created: T0 + t, completed: T0 + t + 500 }, agent: "build", model: { id: "m", providerID: "opencode" }, content, finish, tokens: { input: 5, output: 5, reasoning: 0, cache: { read: 0, write: 0 } } });
  return { path, sid, row, said };
}

describe("OpenCode 2.x", () => {
  // Red on the base: "Second answer.".
  test("OpenCode 2.x: an answer marked as its stop, then more calls in the row, is kept", () => {
    const o = oc2();
    o.row("msg_u1", "user", 0, { text: "Why does the cart test fail?", files: [], agents: [] });
    o.said("msg_a1", 1000, "stop", [{ type: "text", text: "First answer." }]);
    o.said("msg_a2", 2000, "tool-calls", [{ type: "text", text: "One more look." }, { type: "tool", id: "call_1", name: "bash", state: { status: "completed", input: {}, content: [] } }]);
    o.said("msg_a3", 3000, "stop", [{ type: "text", text: "Second answer." }]);
    o.row("msg_i1", "idle", 4000, { outcome: "succeeded" });
    const [row] = readOpenCode(o.path, o.sid).turns;
    expect([reply(row), groups(row), row.done]).toEqual(["First answer.\n\nSecond answer.", [1], true]);
  });
});

// ---- no mark: the place rule ----

describe("a transcript with no mark keeps the reply after the last call", () => {
  // Green on the base and after, each one.
  test("Codex written with no phase", () => {
    const c = codex();
    c.prompt("One");
    c.say("Looking.");
    c.call("call_1");
    c.say("The reply.");
    c.done(1000);
    const [row] = read(c.file(), "codex").turns;
    expect([reply(row), worked(row)]).toEqual(["The reply.", ["Looking."]]);
  });

  test("Claude Code written with no stop_reason", () => {
    const t = claude();
    t.prompt("One");
    t.say("m1", "Looking.", null);
    t.tool("m2");
    t.say("m3", "The reply.", null);
    t.hooks();
    const [row] = read(t.file()).turns;
    expect([reply(row), worked(row)]).toEqual(["The reply.", ["Looking."]]);
  });

  test("Claude Code: an answer cut at the length limit, with no mark, stays with the half that follows it", () => {
    const t = claude();
    t.prompt("One");
    t.say("m1", "The first half,", "max_tokens");
    t.say("m2", "and the second.");
    t.hooks();
    expect(reply(read(t.file()).turns[0])).toBe("The first half,\n\nand the second.");
  });

  test("Antigravity", () => {
    const at = (n) => new Date(Date.UTC(2026, 10, 1, 9, 0, n)).toISOString();
    const step = (n, o) => JSON.stringify({ step_index: n, status: "DONE", created_at: at(n), ...o });
    const dir = join(tmp("antigravity-cli"), "brain/00000000-0000-4000-8000-0000000000a9/.system_generated/logs");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "transcript_full.jsonl");
    writeFileSync(file, `${[
      step(0, { source: "USER_EXPLICIT", type: "USER_INPUT", content: "<USER_REQUEST>\nOne\n</USER_REQUEST>" }),
      step(1, { source: "MODEL", type: "PLANNER_RESPONSE", content: "Looking.", tool_calls: [{ name: "read_file", args: {} }] }),
      step(2, { source: "MODEL", type: "PLANNER_RESPONSE", content: "The reply." }),
    ].join("\n")}\n`);
    const [row] = read(file, "antigravity").turns;
    expect([reply(row), worked(row), row.done]).toEqual(["The reply.", ["Looking."], true]);
  });

  test("Cursor", () => {
    const file = tmp("00000000-0000-4000-8000-0000000000c1.jsonl");
    const m = (role, ...content) => JSON.stringify({ role, message: { content } });
    writeFileSync(file, `${[
      m("user", { type: "text", text: "<user_query>\nOne\n</user_query>" }),
      m("assistant", { type: "text", text: "Looking." }, { type: "tool_use", name: "Shell", input: {} }),
      m("assistant", { type: "text", text: "The reply." }),
      JSON.stringify({ type: "turn_ended", status: "success" }),
    ].join("\n")}\n`);
    const [row] = read(file, "cursor").turns;
    expect([reply(row), worked(row), row.done]).toEqual(["The reply.", ["Looking."], true]);
  });
});

// ---- E: the export, the ledger, turn numbers and pins ----

describe("E: the export and the ledger take the same reply", () => {
  const ATIF = join(core, "atif.js");
  const cli = (file, agent) => JSON.parse(execFileSync("bun", [ATIF, file, agent], { encoding: "utf8", maxBuffer: 1 << 26 }));

  // Red on the base: the first answer is cut to 3,400 characters.
  test("the trajectory holds each answer whole, in its place among the calls", () => {
    const c = codex();
    c.prompt("One");
    c.final(long("first"));
    c.call("call_1");
    c.final("Second answer.");
    c.done(1000);
    const [tr] = trajectories(read(c.file(), "codex"));
    const cells = tr.groups.flatMap((g) => g.cells).map((x) => (x.kind === "tool" ? x.tool : x.text));
    expect(cells).toEqual(["One", long("first"), "exec_command", "Second answer."]);
    expect(tr.groups.some((g) => g.cells.some((x) => x.cut))).toBe(false);
  });

  // Red on the base: one turn holds both.
  test("the export gives a goal's task a turn of its own, with who started it and no text", () => {
    const s = read(goalRollout().file(), "codex");
    const x = atif(s, { agent: "codex" });
    expect(said(x, 1)).toEqual(["Looking at the cart test.", "The cart rounds tax on each line."]);
    expect(said(x, 2)).toEqual(["The goal is met."]);
    expect([asked(x, 2)?.message, asked(x, 2)?.extra?.sender]).toEqual(["", { kind: "goal" }]);
    expect(JSON.stringify(x)).not.toContain(PLANTED);
  });

  // Red on the base, for both: one turn, whose last message is the later work's.
  test("the command line gives the same replies: Codex", () => {
    const c = goalRollout(long("rounding"));
    const x = cli(c.file(), "codex");
    expect(said(x, 1).at(-1)).toBe(long("rounding"));
    expect(said(x, 2)).toEqual(["The goal is met."]);
    expect(JSON.stringify(x)).not.toContain(PLANTED);
  });

  test("the command line gives the same replies: Claude Code", () => {
    const t = claudeReplied(long("rounding"));
    t.tick();
    t.tool("m3");
    t.say("m4", "The tick's reply.");
    t.hooks();
    const x = cli(t.file(), "claude");
    expect(said(x, 1).at(-1)).toBe(long("rounding"));
    expect(said(x, 2)).toEqual(["The tick's reply."]);
    expect(asked(x, 2)?.extra?.sender).toEqual({ kind: "scheduled" });
    expect(JSON.stringify(x)).not.toContain(PLANTED);
  });

  // Red on the base: one reply row, "Second answer.".
  test("the ledger marks each answer as a reply", () => {
    const c = codex();
    c.prompt("One");
    c.note("Looking.");
    c.call("call_1");
    c.final("First answer.");
    c.call("call_2");
    c.final("Second answer.");
    c.done(1000);
    const s = read(c.file(), "codex");
    const rows = ledgerTurn(s, s.turns[0], 0).steps;
    expect(rows.map((r) => [r.lk, r.lk === "tool" ? r.tool : r.text])).toEqual([["you", "One"], ["text", "Looking."], ["tool", "exec_command"], ["reply", "First answer."], ["tool", "exec_command"], ["reply", "Second answer."]]);
  });
});

// Red on the base: the first text is cut to 3,400 characters.
test("the export keeps a background update's marked text whole before its later calls", () => {
  const t = claudeReplied("One.");
  t.wake();
  t.say("m3", long("build"));
  t.tool("m4");
  t.say("m5", "And the tests.");
  t.hooks();
  const s = newSession("s", "f");
  s.keepWakes = true;
  const x = atif(read(t.file(), "claude", 1 << 20, s), { agent: "claude" });
  expect(said(x, 1)).toEqual(["One.", long("build"), "And the tests."]);
});

// Red on the base: no row of its own. A row that started by itself is not a finished task's.
test("the ledger's row and detail of a goal's task say what started it", () => {
  const s = read(goalRollout().file(), "codex");
  const [first] = ledgerTurn(s, s.turns[1], 0).steps;
  expect([first.lk, first.text]).toEqual(["agent", "Goal"]);
  expect(detailOf(first).fields[0]).toEqual(["From", "the harness · work that started by itself, nobody typed this"]);
});

// Red on the base: the last text, which Codex marks as a note, is the reply row.
test("the ledger marks a note after the last answer as a text, running or ended", () => {
  const c = codex();
  c.prompt("One");
  c.final("First answer.");
  c.call("call_1");
  c.note("Tidying up.");
  const kinds = (s) => ledgerTurn(s, s.turns[0], 0).steps.map((r) => [r.lk, r.text]);
  const running = kinds(read(c.file(), "codex"));
  c.done(1000);
  const ended = kinds(read(c.file(), "codex"));
  expect(running).toEqual([["you", "One"], ["reply", "First answer."], ["tool", "ls cart"], ["text", "Tidying up."]]);
  expect(ended).toEqual(running);
});

describe("E: a pin stays on its turn while numbers move", () => {
  // Green on the base and after: the id of a row of today's finds that row.
  test("a later prompt's id does not change", () => {
    const t = claudeReplied("One.");
    t.tick();
    t.tool("m3");
    t.say("m4", "The tick's reply.");
    t.hooks();
    t.prompt("Next question");
    t.say("m5", "Two.");
    const s = read(t.file());
    const at = Math.floor(s.turns.at(-1).ts / 1000);
    expect(reply(turnIds(s.turns).get(`${at}|${hash("Next question")}|1`))).toBe("Two.");
  });

  // Green on the base and after.
  test("Codex: a prompt pinned after a goal's task keeps its id", () => {
    const c = goalRollout();
    c.prompt("And the checkout?");
    c.final("Two.");
    c.done(1000);
    const s = read(c.file(), "codex");
    const at = Math.floor(s.turns.at(-1).ts / 1000);
    expect(reply(turnIds(s.turns).get(`${at}|${hash("And the checkout?")}|1`))).toBe("Two.");
  });

  // Red on the base: number 2.
  test("a later prompt's number moves by the rows added before it", () => {
    const t = claudeReplied("One.");
    t.tick();
    t.tool("m3");
    t.say("m4", "The tick's reply.");
    t.hooks();
    t.prompt("Next question");
    t.say("m5", "Two.");
    const s = read(t.file());
    expect(s.turns.map((x) => [x.n, x.prompt, reply(x)])).toEqual([[1, "Why does the cart test fail?", "One."], [2, "", "The tick's reply."], [3, "Next question", "Two."]]);
  });

  // Green on the base and after: both rows have no prompt and the same second, and a pin on the
  // notification's row must not find the tick's.
  test("a pin on a notification's row finds it when a tick's row starts in the same second", () => {
    const t = claudeReplied("One.");
    t.tick();
    t.tool("m3", 0);
    t.say("m4", "The tick's reply.", "end_turn", 0);
    t.notify(0);
    t.say("m5", "The job finished.", "end_turn", 0);
    const s = read(t.file());
    const at = Math.floor(s.turns.at(-1).ts / 1000);
    expect(reply(turnIds(s.turns).get(`${at}|${hash("")}|1`))).toBe("The job finished.");
  });

  // Green on the base and after: every row of today's is a row still.
  test("a notification that lands while a tick works keeps the row it has today", () => {
    const t = claudeReplied("One.");
    t.tick();
    t.tool("m3");
    t.notify(5);
    t.say("m4", "The job finished.");
    t.hooks();
    const s = read(t.file());
    const at = Math.floor(s.turns.at(-1).ts / 1000);
    expect(reply(turnIds(s.turns).get(`${at}|${hash("")}|1`))).toBe("The job finished.");
  });
});

// ---- what the pane shows ----

describe("the pane", () => {
  const of = (v, key, kind) => v.rows().filter((r) => r.kind === kind && r.turn && `${r.si}:${r.turn.n}` === key);
  // The open row with its Worked line open.
  const opened = (v, cx, key) => {
    v.sel = key;
    v.action("deeper", cx);
    return { steps: of(v, key, "itext").map((r) => r.src), reply: of(v, key, "md").map((r) => r.src).join("\n\n"), none: of(v, key, "noreply").length };
  };

  // Red on the base: "Done now." with the first answer in the Worked part.
  test("an open row shows both answers under the line and copies both", async () => {
    const t = claude();
    t.prompt("First question");
    t.say("m1", "Looking at it.", "tool_use");
    t.tool("m2");
    t.say("m3", "Done, I think.");
    t.hooks();
    t.tool("m4");
    t.say("m5", "Done now.");
    t.hooks();
    const { v, cx } = await pane(t.file());
    expect(opened(v, cx, "0:1")).toEqual({ steps: ["Looking at it."], reply: "Done, I think.\n\nDone now.", none: 0 });
    v.copyReply("0:1", cx);
    expect(cx.clip).toBe("Done, I think.\n\nDone now.");
  });

  // Red on the base: "No reply" on the first row's second line.
  test("a closed row's second line shows the answer", async () => {
    const c = codex();
    c.prompt("One");
    c.final("First answer.");
    c.call("call_1");
    c.done(1000);
    c.prompt("Two");
    c.final("Another.");
    c.done(1000);
    const { v, cx } = await pane(claudeReplied().file());
    // The rows of a Codex session, in the pane the harness opens for Claude Code.
    const s = read(c.file(), "codex");
    s.loaded = true;
    v.sessions = [s];
    settleRows(v, cx);
    const row = v.rows().find((r) => r.kind === "turn" && r.turn.n === 1);
    expect([row.shape.tone, row.shape.md]).toEqual(["reply", "First answer."]);
  });

  // Red on the base: the entry with no id is taken. One written before an update names a turn by
  // its number only, and that number can be another turn after it.
  test("a turn the other pane selected is taken by its id, never by its number alone", async () => {
    const t = claudeReplied("One.");
    t.prompt("Next question");
    t.say("m5", "Two.");
    t.hooks();
    const { v, cx } = await pane(t.file());
    settleRows(v, cx);
    state.panes.push({ pane: "p3", tab: "A", terminal: null, mod: "agent-threads" });
    state.shared["threads.trajByTerminal"] = { [v.terminal]: { pane: "p3" } };
    const [pick, before] = v.turnKeys(v.rows());
    v.sel = before;
    const id = (key) => turnId(v.current().turns, v.findTurn(key));
    const at = Date.now();
    const put = (n, fields) => {
      state.shared["threads.turnSel"] = { [v.terminal]: { key: pick, by: "other", at: at + n, pane: "trajectory", ...fields } };
      return [v.syncSel(), v.sel];
    };
    expect(put(1000, {})).toEqual([false, before]);
    expect(put(2000, { id: id(before) })).toEqual([false, before]);
    expect(put(3000, { id: id(pick) })).toEqual([true, pick]);
    // What this pane writes carries the id.
    v.sel = before;
    v.syncSel();
    expect(state.shared["threads.turnSel"][v.terminal]).toMatchObject({ key: before, id: id(before), pane: "chat" });
  });

  // Red on the base: one row, opened to "No final reply." with the answer in the Worked part.
  test("while a tick works, the row before it shows its answer and the tick's row is the running one", async () => {
    const t = claudeReplied();
    t.tick();
    t.tool("m3");
    const { v, cx } = await pane(t.file());
    expect(opened(v, cx, "0:1")).toEqual({ steps: [], reply: "The cart rounds tax on each line.", none: 0 });
    expect(v.rows().filter((r) => r.kind === "wrow").map((r) => `${r.si}:${r.turn.n}`)).toEqual(["0:2"]);
  });
});
