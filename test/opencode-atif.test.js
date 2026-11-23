// bun test: the ATIF export (core/atif.js) of an OpenCode session says whether each call
// failed and when it finished. OpenCode's reader gives no result events, so the export takes
// each call's outcome from calls.sh (opencode.sh calls): its output or error text, whether it
// failed, and when it ended. A call still running keeps no content and extra.no_result.
// Both versions: 1.x's part table and 2.x's session_message table, each built here by hand
// with made-up words. The other agents' outcomes still come from their readers' result events.
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply, parseChunk, nextChunk } from "../mods/agent-threads/core/turns.js";
import { trajectories } from "../mods/agent-threads/core/trajectory.js";
import { problems } from "./atif-schema.js";

const root = join(import.meta.dir, "..");
const core = join(root, "mods/agent-threads/core");
const SID = "ses_000001";
const T0 = Date.UTC(2026, 0, 2, 3, 0, 0);
const at = (ms) => new Date(T0 + ms).toISOString();

// Turn 1: a call that completes (call_000001) and one that fails (call_000002), then a reply.
// Turn 2: a call still running (call_000003) when the turn is stopped.
function v1() {
  const dir = mkdtempSync(join(tmpdir(), "threads-ocatif1-"));
  const path = join(dir, "opencode.db");
  const db = new Database(path);
  db.run("create table session (id text primary key, parent_id text, directory text, title text, time_created integer, time_updated integer, time_archived integer)");
  db.run("create table message (id text primary key, session_id text, time_created integer, data text)");
  db.run("create table part (id text primary key, message_id text, session_id text, data text)");
  db.run("insert into session values (?, null, '/home/dev/plinth', 'Widget count', ?, ?, null)", [SID, T0, T0 + 9000]);
  let n = 0;
  const msg = (id, data, t) => db.run("insert into message values (?, ?, ?, ?)", [id, SID, T0 + t, JSON.stringify(data)]);
  const part = (mid, data) => db.run("insert into part values (?, ?, ?, ?)", [`prt_${String(++n).padStart(6, "0")}`, mid, SID, JSON.stringify(data)]);
  const usage = { input: 10, output: 5, reasoning: 0, total: 15, cache: { read: 0, write: 0 } };
  const assistant = (id, parent, t, done, extra = {}) =>
    msg(id, { role: "assistant", parentID: parent, agent: "build", modelID: "glm-5.3-flash-free", variant: "high", tokens: usage, time: { created: T0 + t, ...(done == null ? {} : { completed: T0 + done }) }, ...extra }, t);
  msg("msg_000001", { role: "user" }, 0);
  part("msg_000001", { type: "text", text: "Count the widgets" });
  assistant("msg_000002", "msg_000001", 100, 2900, { finish: "tool-calls" });
  part("msg_000002", { type: "tool", tool: "bash", callID: "call_000001", state: { status: "completed", input: { command: "wc -l widgets.txt" }, output: "widgets: 3", title: "wc", time: { start: T0 + 100, end: T0 + 2100 } } });
  part("msg_000002", { type: "tool", tool: "read", callID: "call_000002", state: { status: "error", input: { filePath: "gadget.txt" }, error: "File not found: gadget.txt", time: { start: T0 + 2200, end: T0 + 2250 } } });
  assistant("msg_000003", "msg_000001", 3000, 3500, { finish: "stop" });
  part("msg_000003", { type: "text", text: "Three widgets, and no gadget file." });
  msg("msg_000004", { role: "user" }, 5000);
  part("msg_000004", { type: "text", text: "Sort the widgets" });
  assistant("msg_000005", "msg_000004", 5100, null, { finish: null, error: { name: "MessageAbortedError", data: { message: "aborted" } } });
  part("msg_000005", { type: "tool", tool: "bash", callID: "call_000003", state: { status: "running", input: { command: "sort widgets.txt" }, time: { start: T0 + 5200 } } });
  db.close();
  return path;
}

function v2() {
  const dir = mkdtempSync(join(tmpdir(), "threads-ocatif2-"));
  const path = join(dir, "opencode.db");
  const db = new Database(path);
  db.run(`create table session_v2 (id text primary key, project_id text, parent_id text, directory text, title text,
    time_created integer, time_updated integer, time_archived integer, time_busy integer, time_idle integer)`);
  db.run("create table session_message (id text primary key, session_id text, type text, seq integer, time_created integer, time_updated integer, data text)");
  db.run("create table session_part (message_id text, session_id text, ordinal integer, type text, data text)");
  db.run("insert into session_v2 values (?, 'prj', null, '/home/dev/plinth', 'Widget count', ?, ?, null, ?, null)", [SID, T0, T0 + 9000, T0 + 5000]);
  let seq = 0;
  const row = (id, type, t, data) => {
    seq += 3;
    db.run("insert into session_message values (?, ?, ?, ?, ?, ?, ?)", [id, SID, type, seq, T0 + t, T0 + t, JSON.stringify({ time: { created: T0 + t }, ...data })]);
  };
  const text = (t) => ({ type: "text", text: t });
  const call = (id, name, input, state, created, completed) =>
    ({ type: "tool", id, name, state: { input, ...state }, time: { created: T0 + created, ...(completed == null ? {} : { completed: T0 + completed }) } });
  const assistant = (id, t, done, content, extra = {}) => row(id, "assistant", t, {
    time: { created: T0 + t, ...(done == null ? {} : { completed: T0 + done }) },
    agent: "build", model: { id: "glm-5.3-flash-free", providerID: "opencode", variant: "default" }, content,
    cost: 0, tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }, ...extra,
  });
  row("msg_000001", "user", 0, { text: "Count the widgets", files: [], agents: [] });
  assistant("msg_000002", 100, 2900, [
    call("call_000001", "shell", { command: "wc -l widgets.txt" }, { status: "completed", content: [text("widgets: 3")] }, 100, 2100),
    call("call_000002", "read", { filePath: "gadget.txt" }, { status: "error", error: { type: "unknown", message: "File not found: gadget.txt" } }, 2200, 2250),
  ], { finish: "tool-calls" });
  assistant("msg_000003", 3000, 3500, [text("Three widgets, and no gadget file.")], { finish: "stop" });
  row("msg_000004", "idle", 3501, { outcome: "succeeded" });
  row("msg_000005", "user", 5000, { text: "Sort the widgets", files: [], agents: [] });
  assistant("msg_000006", 5100, 5400, [
    call("call_000003", "shell", { command: "sort widgets.txt" }, { status: "running" }, 5200, null),
  ], { finish: "error", error: { type: "aborted", message: "Step interrupted" } });
  row("msg_000007", "idle", 5410, { outcome: "interrupted" });
  db.close();
  return path;
}

const exportOf = (ref, agent) => JSON.parse(execFileSync("bun", [join(core, "atif.js"), ref, agent], { encoding: "utf8", maxBuffer: 1 << 26 }));
const resultsOf = (t) => Object.fromEntries(t.steps.flatMap((st) => (st.observation?.results ?? []).map((r) => [r.source_call_id, { r, st }])));

for (const [version, make] of [["1.x", v1], ["2.x", v2]]) {
  test(`opencode ${version}: the ATIF export gives a completed call its output, a failed one its error, both with their end time, and a call still running none`, () => {
    const t = exportOf(`${make()}#${SID}`, "opencode");
    expect(problems(t)).toEqual([]);
    const got = resultsOf(t);
    expect(Object.keys(got)).toEqual(["call_000001", "call_000002", "call_000003"]);
    // Completed: its output, not failed, and when it ended.
    expect(got.call_000001.r.content).toBe("widgets: 3");
    expect(got.call_000001.r.extra).toEqual({ result_ts: at(2100), tool_result_is_error: false });
    // Failed: its error text, failed, and when it ended.
    expect(got.call_000002.r.content).toBe("File not found: gadget.txt");
    expect(got.call_000002.r.extra).toEqual({ result_ts: at(2250), tool_result_is_error: true });
    // Still running when its turn was stopped: no content, no outcome, marked.
    expect(Object.hasOwn(got.call_000003.r, "content")).toBe(false);
    expect(got.call_000003.r.extra).toEqual({ no_result: true });
    expect(got.call_000003.st.extra.interrupted).toBe(true);
    // The tool calls keep their ids and their whole input from calls.sh's in lines.
    const calls = t.steps.flatMap((st) => st.tool_calls ?? []);
    expect(calls.map((c) => c.tool_call_id)).toEqual(["call_000001", "call_000002", "call_000003"]);
  });
}

test("opencode: a result whose call has no end time still says whether it failed, and is not marked as having no result", () => {
  // 2.x: a completed call whose item carries no time.completed.
  const dir = mkdtempSync(join(tmpdir(), "threads-ocatif3-"));
  const path = join(dir, "opencode.db");
  const db = new Database(path);
  db.run(`create table session_v2 (id text primary key, project_id text, parent_id text, directory text, title text,
    time_created integer, time_updated integer, time_archived integer, time_busy integer, time_idle integer)`);
  db.run("create table session_message (id text primary key, session_id text, type text, seq integer, time_created integer, time_updated integer, data text)");
  db.run("create table session_part (message_id text, session_id text, ordinal integer, type text, data text)");
  db.run("insert into session_v2 values (?, 'prj', null, '/home/dev/plinth', 'Widget count', ?, ?, null, ?, null)", [SID, T0, T0 + 9000, T0]);
  const row = (id, type, seq, t, data) => db.run("insert into session_message values (?, ?, ?, ?, ?, ?, ?)", [id, SID, type, seq, T0 + t, T0 + t, JSON.stringify({ time: { created: T0 + t }, ...data })]);
  row("msg_000001", "user", 1, 0, { text: "Count the widgets", files: [], agents: [] });
  row("msg_000002", "assistant", 2, 100, {
    time: { created: T0 + 100, completed: T0 + 900 }, agent: "build", model: { id: "glm-5.3-flash-free", providerID: "opencode", variant: "default" },
    content: [{ type: "tool", id: "call_000004", name: "shell", state: { status: "error", input: { command: "wc" }, error: { type: "unknown", message: "no such widget" } } }, { type: "text", text: "None." }],
    finish: "stop", cost: 0, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
  });
  row("msg_000003", "idle", 3, 901, { outcome: "succeeded" });
  db.close();
  const got = resultsOf(exportOf(`${path}#${SID}`, "opencode"));
  expect(got.call_000004.r.content).toBe("no such widget");
  expect(got.call_000004.r.extra).toEqual({ tool_result_is_error: true });
});

// The other agents: each result's outcome and time in the command line's export are the
// reader's, from its result events (Claude Code, Codex, Pi), or left out where the reader has
// none (Antigravity), whatever calls.sh says. Cursor's export reads no calls.sh at all.
test("the other agents' exported outcomes and result times are their readers', not calls.sh's", () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-ocatif4-"));
  const claude = join(dir, "claude.jsonl");
  execFileSync("bun", [join(root, "test/make-fixture.js"), claude, "00000000-0000-4000-8000-000000000042", "/Users/dev/acme-web"]);
  const [codex, , pi, cursor, agy] = execFileSync("bun", [join(root, "test/make-agents.js"), dir, "/Users/dev/acme-web", "2026-11-01T09:00:00Z"], { encoding: "utf8" }).trim().split("\n");
  const read = (file, harness) => {
    const s = newSession("s", file);
    s.keepWakes = true;
    const base = 1 << 20;
    let chunk = base;
    for (let guard = 0; guard < 1000 && chunk; guard++) {
      const r = parseChunk(execFileSync("sh", [join(core, "extract.sh"), file, String(s.offset), String(chunk), harness, "reasoning"], { encoding: "utf8" }));
      s.size = r.size;
      for (const e of r.events) apply(s, e);
      s.offset += r.used;
      chunk = nextChunk(s, r.used, chunk, base);
    }
    return s;
  };
  const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : undefined);
  let failedSeen = 0, openSeen = 0;
  for (const [file, harness] of [[claude, "claude"], [codex, "codex"], [pi, "pi"], [cursor, "cursor"], [agy, "antigravity"]]) {
    const cells = new Map(trajectories(read(file, harness)).flatMap((tr) => tr.groups.flatMap((g) => g.cells.filter((c) => c.call).map((c) => [c.call, c.result]))));
    const results = exportOf(file, harness).steps.flatMap((st) => st.observation?.results ?? []);
    expect(results.length).toBe(cells.size);
    for (const r of results) {
      const want = cells.get(r.source_call_id);
      expect([harness, r.source_call_id, r.extra?.tool_result_is_error, r.extra?.result_ts, r.extra?.no_result])
        .toEqual([harness, r.source_call_id, want.failed ?? undefined, iso(want.end), want.end == null && want.failed == null ? true : undefined]);
      if (want.failed === true) failedSeen++;
      if (r.extra?.no_result) openSeen++;
    }
  }
  // The fixtures hold both a failed call and a call with no result, so both paths are checked.
  expect(failedSeen).toBeGreaterThan(0);
  expect(openSeen).toBeGreaterThan(0);
});
