// bun test: opencode.sh over a synthetic OpenCode database, built here in the shape OpenCode
// writes, with made-up text. A running turn is rewritten in place, so a read returns it again.
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply, rewindTail, parseChunk, replaced, reply, stats } from "../mods/agent-threads/turns.js";

const root = join(import.meta.dir, "..");
const script = join(root, "mods/agent-threads/opencode.sh");
const imager = join(root, "mods/agent-threads/image.sh");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==";
const SID = "ses_0001demo";

function open() {
  const dir = mkdtempSync(join(tmpdir(), "threads-oc-"));
  const path = join(dir, "opencode.db");
  const db = new Database(path);
  db.run("create table session (id text primary key, parent_id text, directory text, title text, time_created integer, time_updated integer, time_archived integer)");
  db.run("create table message (id text primary key, session_id text, time_created integer, data text)");
  db.run("create table part (id text primary key, message_id text, session_id text, data text)");
  db.run("insert into session values (?, null, '/home/dev/shop', 'Cart rounding', 1000, 9000, null)", [SID]);
  return { db, path, n: 0 };
}
const T0 = Date.UTC(2026, 0, 2, 3, 0, 0);
function msg(o, id, data, t, sid = SID) {
  o.db.run("insert into message values (?, ?, ?, ?)", [id, sid, T0 + t, JSON.stringify(data)]);
}
function part(o, mid, data, sid = SID) {
  o.n++;
  o.db.run("insert into part values (?, ?, ?, ?)", [`prt_${String(o.n).padStart(4, "0")}`, mid, sid, JSON.stringify(data)]);
}
const user = (o, id, text, t) => { msg(o, id, { role: "user" }, t); part(o, id, { type: "text", text }); };
const tokens = (input, output, read = 0, write = 0, reasoning = 0) => ({ input, output, reasoning, total: input + output + read + write + reasoning, cache: { read, write } });
function assistant(o, id, parent, t, { finish = "stop", done = t + 1000, usage = tokens(10, 5), error, model = "glm-5.3-flash-free", variant = "high" } = {}) {
  msg(o, id, { role: "assistant", parentID: parent, agent: "build", modelID: model, variant, finish, tokens: usage, time: { created: T0 + t, completed: done == null ? undefined : T0 + done }, ...(error ? { error } : {}) }, t);
}

function read(o, s = newSession(SID, `${o.path}#${SID}`)) {
  for (let guard = 0; guard < 20; guard++) {
    const out = execFileSync("sh", [script, "read", o.path, SID, String(s.offset), "40"], { encoding: "utf8" });
    const r = parseChunk(out);
    if (replaced(s, r)) {
      // What the pane does: read the session again from the top.
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

function session() {
  const o = open();
  user(o, "msg_u1", "Why does the cart test fail?", 0);
  part(o, "msg_u1", { type: "text", text: "Injected by a plugin", synthetic: true });
  part(o, "msg_u1", { type: "text", text: "Hidden note", ignored: true });
  assistant(o, "msg_a1", "msg_u1", 100, { finish: "tool-calls", usage: tokens(50, 10, 20, 5, 3) });
  part(o, "msg_a1", { type: "reasoning", text: "SECRET-THOUGHT" });
  part(o, "msg_a1", { type: "text", text: "Looking at it." });
  part(o, "msg_a1", { type: "tool", tool: "bash", state: { input: { command: "SECRET-ARGS" }, output: "SECRET-OUT" } });
  assistant(o, "msg_a2", "msg_u1", 2000, { finish: "stop", done: 4000, usage: tokens(60, 20, 40, 0) });
  part(o, "msg_a2", { type: "text", text: "It rounds tax per line." });
  return o;
}

test("builds a finished turn", () => {
  const o = session();
  const s = read(o);
  expect(s.title).toBe("Cart rounding");
  expect(s.turns.length).toBe(1);
  const [t] = s.turns;
  expect(t.prompt).toBe("Why does the cart test fail?");
  expect(reply(t)).toBe("It rounds tax per line.");
  expect(t.tools).toBe(1);
  expect(t.model).toBe("glm-5.3-flash-free");
  expect(t.by).toBe("build"); // the OpenCode agent that replied
  expect(t.durationMs).toBe(4000);
  const st = stats(t);
  expect(st.cacheRead).toBe(60);
  expect(st.input).toBe(110);
  expect(st.cacheWrite).toBe(5);
  expect(s.offset).toBe(1);
});

test("a running turn is read again, and its rows are replaced, not added to", () => {
  const o = session();
  const s = read(o);
  user(o, "msg_u2", "Now fix it", 10000);
  assistant(o, "msg_a3", "msg_u2", 10100, { finish: null, done: null, usage: tokens(0, 0) });
  part(o, "msg_a3", { type: "text", text: "Working on" });
  read(o, s);
  expect(s.turns.length).toBe(2);
  expect(s.offset).toBe(1);

  // Same message, text rewritten, then finished.
  o.db.run("update part set data = ? where message_id = 'msg_a3'", [JSON.stringify({ type: "text", text: "Fixed the rounding." })]);
  read(o, s);
  expect(s.turns.length).toBe(2);
  expect(s.turns[1].done).toBeFalsy();

  o.db.run("update message set data = ? where id = 'msg_a3'", [JSON.stringify({ role: "assistant", parentID: "msg_u2", modelID: "m", finish: "stop", tokens: tokens(5, 5), time: { created: T0 + 10100, completed: T0 + 12000 } })]);
  read(o, s);
  expect(s.turns.length).toBe(2);
  expect(reply(s.turns[1])).toBe("Fixed the rounding.");
  expect(s.turns[1].done).toBe(true);
  expect(s.turns[1].durationMs).toBe(2000);
  expect(s.offset).toBe(2);
  expect(s.turns[0].prompt).toBe("Why does the cart test fail?");
});

test("an undone turn replaced by a new prompt is read again, with the same prompt count", () => {
  const o = session();
  const s = read(o);
  user(o, "msg_u2", "Undo this one", 10000);
  assistant(o, "msg_a3", "msg_u2", 10100);
  part(o, "msg_a3", { type: "text", text: "Done." });
  read(o, s);
  expect(s.offset).toBe(2);
  o.db.run("delete from part where message_id in ('msg_u2','msg_a3')");
  o.db.run("delete from message where id in ('msg_u2','msg_a3')");
  user(o, "msg_u3", "The new prompt", 20000);
  assistant(o, "msg_a4", "msg_u3", 20100);
  part(o, "msg_a4", { type: "text", text: "New reply." });
  read(o, s);
  expect(s.turns.map((t) => [t.prompt, reply(t)])).toEqual([
    ["Why does the cart test fail?", "It rounds tax per line."],
    ["The new prompt", "New reply."],
  ]);
});

test("an undone turn removed with nothing after it leaves the pane", () => {
  const o = session();
  const s = read(o);
  user(o, "msg_u2", "Undo this one", 10000);
  assistant(o, "msg_a3", "msg_u2", 10100);
  read(o, s);
  o.db.run("delete from message where id in ('msg_u2','msg_a3')");
  read(o, s);
  expect(s.turns.map((t) => t.prompt)).toEqual(["Why does the cart test fail?"]);
});

test("a queued prompt keeps its own reply", () => {
  const o = open();
  user(o, "msg_u1", "First", 0);
  user(o, "msg_u2", "Second, sent while the first ran", 500);
  assistant(o, "msg_a1", "msg_u1", 100);
  part(o, "msg_a1", { type: "text", text: "Answer one" });
  assistant(o, "msg_a2", "msg_u2", 1500);
  part(o, "msg_a2", { type: "text", text: "Answer two" });
  const s = read(o);
  expect(s.turns.map((t) => [t.prompt, reply(t)])).toEqual([["First", "Answer one"], ["Second, sent while the first ran", "Answer two"]]);
});

test("an aborted turn reads as interrupted, and another error shows", () => {
  const o = open();
  user(o, "msg_u1", "Stop me", 0);
  assistant(o, "msg_a1", "msg_u1", 100, { finish: null, done: null, error: { name: "MessageAbortedError", data: { message: "aborted" } } });
  user(o, "msg_u2", "Fail me", 5000);
  assistant(o, "msg_a2", "msg_u2", 5100, { finish: null, done: 5200, error: { name: "ProviderAuthError", data: { message: "bad key" } } });
  const s = read(o);
  expect(s.turns[0].interrupted).toBe(true);
  expect(s.turns[1].interrupted).toBeFalsy();
  expect(s.turns[1].errors ?? [s.turns[1].error]).toContain("bad key");
  expect(s.offset).toBe(2);
});

test("a turn with no usage shows no tokens rather than made-up ones", () => {
  const o = open();
  user(o, "msg_u1", "Hello", 0);
  msg(o, "msg_a1", { role: "assistant", parentID: "msg_u1", finish: "stop", time: { completed: T0 + 100 } }, 50);
  part(o, "msg_a1", { type: "text", text: "Hi" });
  const s = read(o);
  expect(stats(s.turns[0]).tokens).toBe(0);
  expect(s.turns[0].model).toBeFalsy();
});

test("nothing but named fields leaves the database", () => {
  const o = session();
  msg(o, "msg_u9", { role: "user" }, 7000);
  part(o, "msg_u9", { type: "file", mime: "image/png", url: `data:image/png;base64,${PNG}` });
  const out = execFileSync("sh", [script, "read", o.path, SID, "0", "40"], { encoding: "utf8" });
  expect(out).not.toContain("SECRET");
  expect(out).not.toContain(PNG);
  expect(out).not.toContain("Injected by a plugin");
  expect(out).not.toContain("Hidden note");
});

test("image.sh decodes a prompt's file parts", () => {
  const o = open();
  user(o, "msg_0001user", "What colour?", 0);
  part(o, "msg_0001user", { type: "file", mime: "image/png", url: `data:image/png;base64,${PNG}` });
  part(o, "msg_0001user", { type: "file", mime: "text/plain", url: "data:text/plain;base64,aGk=" });
  assistant(o, "msg_a1", "msg_0001user", 100);
  const s = read(o);
  expect(s.turns[0].images.map((i) => i.mt)).toEqual(["image/png"]);
  expect(s.turns[0].imgLine).toBe("msg_0001user");
  const cache = mkdtempSync(join(tmpdir(), "threads-img-"));
  const got = JSON.parse(execFileSync("sh", [imager, `${o.path}#${SID}`, "msg_0001user", cache, SID, "opencode"], { encoding: "utf8" }).trim());
  expect(got.file).toBe("msg_0001user-0.png");
  expect(readFileSync(join(cache, SID, got.file)).toString("base64")).toBe(PNG);
});

test("1.19's empty session_message does not make it read as 2.x", () => {
  const o = session();
  o.db.run("create table session_message (id text primary key, session_id text, type text, seq integer, time_created integer, time_updated integer, data text)");
  const s = read(o);
  expect(s.turns.map((t) => reply(t))).toEqual(["It rounds tax per line."]);
  user(o, "msg_0001user", "What colour?", 20000);
  part(o, "msg_0001user", { type: "file", mime: "image/png", url: `data:image/png;base64,${PNG}` });
  const cache = mkdtempSync(join(tmpdir(), "threads-img-"));
  const got = JSON.parse(execFileSync("sh", [imager, `${o.path}#${SID}`, "msg_0001user", cache, SID, "opencode"], { encoding: "utf8" }).trim());
  expect(readFileSync(join(cache, SID, got.file)).toString("base64")).toBe(PNG);
});

test("sessions lists a folder's root sessions with their first prompt", () => {
  const o = session();
  o.db.run("insert into session values ('ses_child', ?, '/home/dev/shop', 'A subagent', 1, 1, null)", [SID]);
  o.db.run("insert into session values ('ses_gone', null, '/home/dev/shop', 'Archived', 1, 1, 5)");
  o.db.run("insert into session values ('ses_else', null, '/home/dev/other', 'Elsewhere', 1, 1, null)");
  const out = execFileSync("sh", [script, "sessions", o.path, "/home/dev/shop", "/x/it's"], { encoding: "utf8" });
  const rows = out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  expect(rows).toEqual([{ id: SID, created: 1000, updated: 9000, title: "Cart rounding", first: "Why does the cart test fail?" }]);
});

test("reads change nothing and refuse a bad id", () => {
  const o = session();
  o.db.close();
  const before = statSync(o.path).mtimeMs;
  const bytes = readFileSync(o.path).toString("base64");
  execFileSync("sh", [script, "read", o.path, SID, "0", "40"]);
  execFileSync("sh", [script, "sessions", o.path, "/home/dev/shop"]);
  expect(statSync(o.path).mtimeMs).toBe(before);
  expect(readFileSync(o.path).toString("base64")).toBe(bytes);
  let code = 0;
  try { execFileSync("sh", [script, "read", o.path, "ses'; drop table part;--", "0", "40"], { stdio: "pipe" }); }
  catch (e) { code = e.status; }
  expect(code).toBe(2);
});

test("a missing database reads as missing", () => {
  const out = execFileSync("sh", [script, "read", "/nonexistent/opencode.db", SID, "0", "40"], { encoding: "utf8" });
  expect(parseChunk(out).missing).toBe(true);
  expect(existsSync("/nonexistent/opencode.db")).toBe(false);
});
