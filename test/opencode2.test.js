// bun test: opencode.sh over a synthetic OpenCode 2.x database (session_v2 and session_message),
// built here in the shape OpenCode 2.2.5 writes, with made-up text. A 2.x message is one row
// typed user, assistant, idle, system or compaction, and a reply belongs to the prompt before it.
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply, rewindTail, parseChunk, replaced, reply, stats } from "../mods/agent-threads/turns.js";

const root = join(import.meta.dir, "..");
const script = join(root, "mods/agent-threads/opencode.sh");
const imager = join(root, "mods/agent-threads/image.sh");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==";
const SID = "ses_0002demo";
const T0 = Date.UTC(2026, 0, 2, 3, 0, 0);

// old: also make 1.x's tables, empty, as a database 2.x migrated keeps them.
function open({ old = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "threads-oc2-"));
  const path = join(dir, "opencode.db");
  const db = new Database(path);
  db.run(`create table session_v2 (id text primary key, project_id text, parent_id text, directory text, title text,
    time_created integer, time_updated integer, time_archived integer, time_busy integer, time_idle integer)`);
  db.run("create table session_message (id text primary key, session_id text, type text, seq integer, time_created integer, time_updated integer, data text)");
  db.run("create table session_part (message_id text, session_id text, ordinal integer, type text, data text)");
  if (old) {
    db.run("create table session (id text primary key, parent_id text, directory text, title text, time_created integer, time_updated integer, time_archived integer)");
    db.run("create table message (id text primary key, session_id text, time_created integer, data text)");
    db.run("create table part (id text primary key, message_id text, session_id text, data text)");
    db.run("insert into session values (?, null, '/home/dev/shop', 'Stale 1.x copy', 1, 2, null)", [SID]);
  }
  db.run("insert into session_v2 values (?, 'prj', null, '/home/dev/shop', 'Cart rounding', ?, ?, null, ?, null)", [SID, T0, T0 + 9000, T0 + 100]);
  return { db, path, seq: 0 };
}
function row(o, id, type, t, data, sid = SID) {
  o.seq += 3;
  o.db.run("insert into session_message values (?, ?, ?, ?, ?, ?, ?)", [id, sid, type, o.seq, T0 + t, T0 + t, JSON.stringify({ time: { created: T0 + t }, ...data })]);
}
const user = (o, id, text, t, files = []) => row(o, id, "user", t, { text, files, agents: [] });
const idle = (o, id, t, outcome = "succeeded") => row(o, id, "idle", t, { outcome });
const tokens = (input, output, read = 0, write = 0, reasoning = 0) => ({ input, output, reasoning, cache: { read, write } });
function assistant(o, id, t, content, { finish = "stop", done = t + 1000, usage = tokens(10, 5), error, model = "glm-5.3-flash-free", variant = "default" } = {}) {
  row(o, id, "assistant", t, {
    time: { created: T0 + t, ...(done == null ? {} : { completed: T0 + done }) },
    agent: "build", model: { id: model, providerID: "opencode", variant }, content,
    ...(finish ? { finish } : {}), cost: 0, tokens: usage, ...(error ? { error } : {}),
  });
}
const text = (t) => ({ type: "text", text: t });
const tool = (name) => ({ type: "tool", id: "call_1", name, state: { status: "completed", input: { command: "SECRET-ARGS" }, content: [text("SECRET-OUT")] } });
const thought = { type: "reasoning", text: "SECRET-THOUGHT" };

function read(o, s = newSession(SID, `${o.path}#${SID}`)) {
  for (let guard = 0; guard < 20; guard++) {
    const out = execFileSync("sh", [script, "read", o.path, SID, String(s.offset), "40"], { encoding: "utf8" });
    const r = parseChunk(out);
    if (replaced(s, r)) {
      Object.assign(s, newSession(SID, `${o.path}#${SID}`));
      continue;
    }
    if (r.head && !s.head) s.head = r.head;
    s.size = r.size;
    if (r.rewind) rewindTail(s);
    for (const e of r.events) apply(s, e);
    s.offset += r.used;
    if (s.offset >= r.size || r.used === 0) break;
  }
  return s;
}

function session(opts) {
  const o = open(opts);
  user(o, "msg_u1", "Why does the cart test fail?", 0);
  row(o, "msg_s1", "system", 50, { text: "Injected by OpenCode" });
  assistant(o, "msg_a1", 100, [thought, text("Looking at it."), tool("shell")], { finish: "tool-calls", usage: tokens(50, 10, 20, 5, 3) });
  assistant(o, "msg_a2", 2000, [text("It rounds tax per line.")], { done: 4000, usage: tokens(60, 20, 40, 0), variant: "high" });
  idle(o, "msg_i1", 4001);
  return o;
}

test("2.x: builds a finished turn from session_message", () => {
  const s = read(session());
  expect(s.title).toBe("Cart rounding");
  expect(s.turns.length).toBe(1);
  const [t] = s.turns;
  expect(t.prompt).toBe("Why does the cart test fail?");
  expect(reply(t)).toBe("It rounds tax per line.");
  expect(t.tools).toBe(1);
  expect(t.model).toBe("glm-5.3-flash-free");
  expect(t.effort).toBe("high");
  expect(t.durationMs).toBe(4000);
  expect(t.done).toBe(true);
  const st = stats(t);
  expect(st.cacheRead).toBe(60);
  expect(st.input).toBe(110);
  expect(st.cacheWrite).toBe(5);
  expect(s.offset).toBe(1);
});

test("2.x: 1.x's old tables, left behind by the migration, are not read", () => {
  const s = read(session({ old: true }));
  expect(s.title).toBe("Cart rounding");
  expect(s.turns.map((t) => t.prompt)).toEqual(["Why does the cart test fail?"]);
});

test("2.x: a running turn is read again and replaced, then settles on its stop", () => {
  const o = session();
  const s = read(o);
  user(o, "msg_u2", "Now fix it", 10000);
  assistant(o, "msg_a3", 10100, [text("Working on")], { finish: null, done: null, usage: tokens(0, 0) });
  read(o, s);
  expect(s.turns.length).toBe(2);
  expect(s.turns[1].done).toBeFalsy();
  expect(s.offset).toBe(1);
  o.db.run("update session_message set data = ? where id = 'msg_a3'", [JSON.stringify({
    time: { created: T0 + 10100, completed: T0 + 12000 }, model: { id: "m", variant: "default" },
    content: [text("Fixed the rounding.")], finish: "stop", tokens: tokens(5, 5),
  })]);
  read(o, s);
  expect(s.turns.length).toBe(2);
  expect(reply(s.turns[1])).toBe("Fixed the rounding.");
  expect(s.turns[1].done).toBe(true);
  expect(s.turns[1].durationMs).toBe(2000);
  expect(s.offset).toBe(2);
});

test("2.x: a turn that ends on a tool call is finished by its idle row", () => {
  const o = open();
  user(o, "msg_u1", "Check it", 0);
  assistant(o, "msg_a1", 100, [tool("shell")], { finish: "tool-calls", done: 900 });
  let s = read(o);
  expect(s.turns[0].done).toBeFalsy();
  idle(o, "msg_i1", 1000);
  s = read(o);
  expect(s.turns[0].done).toBe(true);
  expect(s.offset).toBe(1);
});

test("2.x: a queued prompt gets its row after the turn before it, and keeps its own reply", () => {
  const o = open();
  user(o, "msg_u1", "First", 0);
  assistant(o, "msg_a1", 100, [text("Answer one")]);
  user(o, "msg_u2", "Second, sent while the first ran", 1200);
  assistant(o, "msg_a2", 1300, [text("Answer two")]);
  idle(o, "msg_i1", 2400);
  const s = read(o);
  expect(s.turns.map((t) => [t.prompt, reply(t), t.done])).toEqual([
    ["First", "Answer one", true],
    ["Second, sent while the first ran", "Answer two", true],
  ]);
});

test("2.x: an aborted turn reads as interrupted, and a provider error shows", () => {
  const o = open();
  user(o, "msg_u1", "Stop me", 0);
  assistant(o, "msg_a1", 100, [text("Rivers are")], { finish: "error", done: 300, error: { type: "aborted", message: "Step interrupted" } });
  idle(o, "msg_i1", 310, "interrupted");
  user(o, "msg_u2", "Fail me", 5000);
  assistant(o, "msg_a2", 5100, [], { finish: "error", done: 5200, error: { type: "provider.error", message: "bad key" }, usage: tokens(0, 0) });
  idle(o, "msg_i2", 5210, "failed");
  const s = read(o);
  expect(s.turns[0].interrupted).toBe(true);
  expect(s.turns[0].errors).toEqual([]);
  expect(s.turns[1].interrupted).toBeFalsy();
  expect(s.turns[1].errors).toContain("bad key");
  expect(s.offset).toBe(2);
});

test("2.x: a compaction takes no row and counts on the turn before it", () => {
  const o = session();
  row(o, "msg_c1", "compaction", 6000, { status: "completed", reason: "manual", summary: "SECRET-SUMMARY" });
  idle(o, "msg_i2", 6500);
  user(o, "msg_u2", "Next", 7000);
  assistant(o, "msg_a3", 7100, [text("Sure.")]);
  const s = read(o);
  expect(s.turns.map((t) => t.prompt)).toEqual(["Why does the cart test fail?", "Next"]);
  expect(s.turns[0].compactions).toBe(1);
  expect(s.offset).toBe(3);
});

test("2.x: a turn with no usage shows no tokens rather than made-up ones", () => {
  const o = open();
  user(o, "msg_u1", "Hello", 0);
  assistant(o, "msg_a1", 50, [text("Hi")], { usage: tokens(0, 0) });
  const s = read(o);
  expect(stats(s.turns[0]).tokens).toBe(0);
  expect(s.turns[0].model).toBeFalsy();
});

test("2.x: nothing but named fields leaves the database", () => {
  const o = session();
  user(o, "msg_u9", "", 7000, [{ data: PNG, mime: "image/png", source: { type: "inline" }, name: "clipboard" }]);
  row(o, "msg_c1", "compaction", 8000, { status: "completed", summary: "SECRET-SUMMARY" });
  const out = execFileSync("sh", [script, "read", o.path, SID, "0", "40"], { encoding: "utf8" });
  expect(out).not.toContain("SECRET");
  expect(out).not.toContain(PNG);
  expect(out).not.toContain("Injected by OpenCode");
});

test("2.x: image.sh decodes a prompt's inline files", () => {
  const o = open();
  user(o, "msg_0001user", "What colour?", 0, [
    { data: PNG, mime: "image/png", source: { type: "inline" }, name: "clipboard", mention: { text: "[Image 1]", start: 0, end: 9 } },
    { data: "aGk=", mime: "text/plain", source: { type: "inline" }, name: "note.txt" },
  ]);
  assistant(o, "msg_a1", 100, [text("Red.")]);
  const s = read(o);
  expect(s.turns[0].images.map((i) => i.mt)).toEqual(["image/png"]);
  expect(s.turns[0].imgLine).toBe("msg_0001user");
  const cache = mkdtempSync(join(tmpdir(), "threads-img-"));
  const got = JSON.parse(execFileSync("sh", [imager, `${o.path}#${SID}`, "msg_0001user", cache, SID, "opencode"], { encoding: "utf8" }).trim());
  expect(got.file).toBe("msg_0001user-0.png");
  expect(readFileSync(join(cache, SID, got.file)).toString("base64")).toBe(PNG);
});

test("2.x: sessions lists a folder's root sessions from session_v2, with when their turn began", () => {
  const o = session({ old: true });
  o.db.run("insert into session_v2 values ('ses_child', 'prj', ?, '/home/dev/shop', 'A subagent', 1, 1, null, null, null)", [SID]);
  o.db.run("insert into session_v2 values ('ses_gone', 'prj', null, '/home/dev/shop', 'Archived', 1, 1, 5, null, null)");
  o.db.run("insert into session_v2 values ('ses_else', 'prj', null, '/home/dev/other', 'Elsewhere', 1, 1, null, null, null)");
  o.db.run("insert into session_v2 values ('ses_new', 'prj', null, '/home/dev/shop', null, 50, 60, null, null, null)");
  const out = execFileSync("sh", [script, "sessions", o.path, "/home/dev/shop", "/x/it's"], { encoding: "utf8" });
  const rows = out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  expect(rows).toEqual([
    { id: SID, created: T0, updated: T0 + 9000, busy: T0 + 100, title: "Cart rounding", first: "Why does the cart test fail?" },
    { id: "ses_new", created: 50, updated: 60, busy: null, title: null, first: null },
  ]);
});

test("2.x: reads change nothing and refuse a bad id", () => {
  const o = session();
  o.db.close();
  const before = statSync(o.path).mtimeMs;
  const bytes = readFileSync(o.path).toString("base64");
  execFileSync("sh", [script, "read", o.path, SID, "0", "40"]);
  execFileSync("sh", [script, "sessions", o.path, "/home/dev/shop"]);
  expect(statSync(o.path).mtimeMs).toBe(before);
  expect(readFileSync(o.path).toString("base64")).toBe(bytes);
  let code = 0;
  try { execFileSync("sh", [script, "read", o.path, "ses'; drop table session_message;--", "0", "40"], { stdio: "pipe" }); }
  catch (e) { code = e.status; }
  expect(code).toBe(2);
});
