// bun test: the window's memory guard (budget.js), as data and in panes on the render harness
// (test/render-harness.js): the estimate, the tail a session keeps past the budget, the side
// panes that read nothing, one read at a time, the smaller chunks, and what a closed or
// replaced copy gives back.
import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { newSession, apply, parseChunk } from "../mods/agent-threads/core/turns.js";
import {
  BUDGET, TIGHT_CHUNK, PANE_WEIGHT, LOCK_STALE, QUEUE_STALE, GHOST_MS, measure, sessionBytes, trim, shiftKey, tailOf, tailNote, droppedOf, gut, windowState,
  joinWindow, leaveWindow, windowBytes, noteFile, fileBytes, releaseOlder, sweepGhosts, takeRead, dropRead, pruneWindow,
} from "../mods/agent-threads/budget.js";
import { turnId } from "../mods/agent-threads/pins.js";
import { fixture, H, makeCx, modDir, settle, setup, Threads, unsliced, until } from "./render-harness.js";

setup();

const MiB = 1024 * 1024;
const ts = (i) => new Date(Date.UTC(2026, 10, 1, 9) + i * 60000).toISOString();
const turnEvents = (i, text = "") => [{ k: "p", o: "human", ts: ts(i), t: `prompt ${i + 1}${text}` }, { k: "t", ts: ts(i), t: `reply ${i + 1}` }, { k: "d", ts: ts(i), ms: 1000 }];
const sessionOf = (n, text = "") => { const s = newSession("s", "/x/s.jsonl"); for (let i = 0; i < n; i++) for (const e of turnEvents(i, text)) apply(s, e); return s; };
// Another pane of the window, holding bytes.
const phantom = (bytes) => { const e = { gen: null, ref: null, kind: "chat", bytes, pane: null, beat: Date.now() }; windowState().panes.add(e); return e; };

// What each made-up turn's prompt carries past "prompt <n>" in fakeReader.
const PAD = " xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
// The extractor's answers for made-up sessions of n turns, `per` bytes each, by file: a call for
// [offset, offset + chunk) gets the whole turns in it. Each call is counted while it runs.
function fakeReader(sessions, per = 1000, delay = 0) {
  const st = { active: 0, max: 0, asked: [] };
  H.extractHook = async (args) => {
    const n = sessions[args[1]];
    if (n == null) return null;
    const off = Number(args[2]);
    const chunk = Number(args[3]);
    st.asked.push([args[1], off, chunk]);
    st.active++;
    st.max = Math.max(st.max, st.active);
    await new Promise((r) => setTimeout(r, delay));
    st.active--;
    const a = Math.floor(off / per);
    const b = Math.min(n, Math.floor((off + chunk) / per));
    const lines = [{ k: "file", size: n * per }, { k: "chunk", used: Math.max(0, b - a) * per }];
    for (let i = a; i < b; i++) lines.push(...turnEvents(i, PAD));
    return { code: 0, stdout: `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`, stderr: "" };
  };
  return st;
}
// A pane on file, with props (view: "pinned" or "trajectory" for a side pane).
function openPane(file, props = {}) {
  H.state = {
    terminals: [{ address: "t4", status: "idle", name: "claude" }],
    panes: [{ pane: "p1", tab: "A", terminal: "t4", program: { key: "claude", name: "Claude Code" } }, { pane: "p2", tab: "A", terminal: null, mod: "agent-threads" }],
    props: { terminal: "t4", transcript: file, debug: true, ...props }, shared: H.state.shared ?? {},
  };
  const v = unsliced(new Threads());
  const cx = makeCx();
  v.init(H.state.props, cx);
  return { v, cx };
}
const turnNumbers = (v) => [...new Set(v.rows().filter((r) => r.turn).map((r) => r.turn.n))];

test("measure: a session's estimate grows as turns are appended, and a character above U+00FF counts its text twice", () => {
  const s = sessionOf(10);
  const a = { ...measure(s) };
  for (const e of turnEvents(10)) apply(s, e);
  const b = { ...measure(s) };
  expect(b.fixed).toBeGreaterThan(a.fixed);
  expect(b.text).toBeGreaterThan(a.text);
  expect(sessionBytes(s, 2)).toBe(b.text + 2 * b.fixed);
  // The same prompt with one curly quote: its whole text at two bytes a character.
  const plain = sessionOf(1, ` ${"y".repeat(1000)}`);
  const wide = sessionOf(1, ` ${"y".repeat(999)}’`);
  expect(measure(wide).text - measure(plain).text).toBe("prompt 1 ".length + 1000);
});

test("measure: a time limit stops it after one turn, the next call goes on, and an unchanged turn is not measured again", () => {
  const s = sessionOf(5);
  let calls = 0;
  while (!measure(s, 0)) calls++;
  expect(calls).toBe(4);
  // Nothing changed: done at once, even with no time left.
  expect(measure(s, 0)).not.toBeNull();
  // The newest turn changes: measured again.
  apply(s, { k: "t", ts: ts(4), t: "more" });
  const before = sessionBytes(s, 1);
  expect(measure(s, 0)).not.toBeNull();
  expect(sessionBytes(s, 1)).toBeGreaterThan(before);
});

test("trim keeps the newest turns that fit, numbers them from 1 and says how many of how many", () => {
  const s = sessionOf(20);
  s.turns[17].answeredIn = 19;
  measure(s);
  const all = sessionBytes(s, 3);
  const per = all / 20;
  expect(trim(s, all, 3)).toBe(0);
  expect(tailOf(s)).toBeNull();
  expect(trim(s, per * 6.5, 3)).toBe(14);
  expect(s.turns.map((t) => t.n)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(s.turns[0].prompt).toBe("prompt 15");
  // turns[n - 1] is the turn numbered n, and an answer's number moved with it.
  expect(s.turns[3].answeredIn).toBe(5);
  expect(sessionBytes(s, 3)).toBeLessThanOrEqual(per * 6.5);
  expect(tailOf(s)).toEqual({ shown: 6, of: 20 });
  expect(tailNote({ shown: 1200, of: 3300 })).toBe("This session is too large to show in full: showing the newest 1,200 of 3,300 turns");
  // More turns, trimmed again: the count goes on.
  for (const e of turnEvents(20)) apply(s, e);
  measure(s);
  trim(s, per * 6.5, 3);
  expect(tailOf(s)).toEqual({ shown: 6, of: 21 });
  // Never below the newest turn.
  trim(s, 0, 3);
  expect(s.turns.map((t) => t.prompt)).toEqual(["prompt 21"]);
});

test("the weights: the made-up 3,300-turn session comes to the rig's 80, 46 and 50 MiB, and the budget takes a Chat with one side pane but not with both", () => {
  // test/make-big.js real repeats this fixture; tool output is dropped by the extractor, so the
  // model per turn is the same.
  const file = fixture("--extra", "400");
  const s = newSession("s", file);
  for (let off = 0, i = 0; i < 20; i++) {
    const c = parseChunk(execFileSync("sh", [join(modDir, "core/extract.sh"), file, String(off), String(16 * MiB)], { encoding: "utf8", maxBuffer: 1 << 28 }));
    for (const e of c.events) apply(s, e);
    off += c.used;
    if (!c.used || off >= c.size) break;
  }
  const m = measure(s);
  const k = 3300 / s.turns.length;
  const at = (w) => (m.text + w * m.fixed) * k / MiB;
  expect(Math.abs(at(PANE_WEIGHT.chat) - 80)).toBeLessThan(2.4);
  expect(Math.abs(at(PANE_WEIGHT.pinned) - 46)).toBeLessThan(1.4);
  expect(Math.abs(at(PANE_WEIGHT.trajectory) - 50)).toBeLessThan(1.5);
  const B = BUDGET / MiB;
  expect(at(PANE_WEIGHT.chat) + at(PANE_WEIGHT.pinned)).toBeLessThan(B);
  expect(at(PANE_WEIGHT.chat) + at(PANE_WEIGHT.trajectory)).toBeLessThan(B);
  expect(at(PANE_WEIGHT.chat) + at(PANE_WEIGHT.pinned) + at(PANE_WEIGHT.trajectory)).toBeGreaterThan(B);
}, 30000);

test("one read at a time: others wait in order, a dead turn or a waiter that stopped asking is passed over, and a pane of a replaced registry is not held up", () => {
  const [a, b, c] = [joinWindow({}, "chat"), joinWindow({}, "pinned"), joinWindow({}, "trajectory")];
  expect(takeRead(a, 1, 0)).toBe(true);
  expect(takeRead(c, 1, 10)).toBe(false);
  expect(takeRead(b, 1, 20)).toBe(false);
  expect(takeRead(a, 2, 30)).toBe(true); // a newer read of the same pane takes over
  dropRead(a, 1); // the older read's end leaves the newer one's turn alone
  expect(takeRead(c, 1, 40)).toBe(false);
  dropRead(a, 2);
  expect(takeRead(b, 1, 50)).toBe(false); // c asked first
  expect(takeRead(c, 1, 60)).toBe(true);
  // c's turn not renewed for LOCK_STALE: taken as dead.
  expect(takeRead(b, 1, 60 + LOCK_STALE)).toBe(false);
  expect(takeRead(b, 1, 61 + LOCK_STALE)).toBe(true);
  dropRead(b);
  // a asks, then stops asking: b, asking after QUEUE_STALE, goes first.
  expect(takeRead(c, 2, 70 + LOCK_STALE)).toBe(true);
  expect(takeRead(a, 3, 80 + LOCK_STALE)).toBe(false);
  dropRead(c);
  expect(takeRead(b, 2, 81 + LOCK_STALE + QUEUE_STALE)).toBe(true);
  leaveWindow(b);
  expect(windowState().lock).toBeNull();
  // A pane that is not in the registry (another layout's, a test's) reads at once.
  expect(takeRead({}, 1, 0)).toBe(true);
});

test("a new copy of the mod releases the panes of an older one, and a pane's copy whose timer stopped is released by the copy that took its place", () => {
  const forgot = [];
  const pane = (name) => ({ forget() { forgot.push(name); } });
  const mine = joinWindow(pane("mine"), "chat");
  const old = joinWindow(pane("old"), "chat");
  old.gen = {}; // as made by an earlier evaluation of budget.js
  old.bytes = 50 * MiB;
  expect(takeRead(old, 1)).toBe(true);
  expect(releaseOlder()).toBe(1);
  expect(forgot).toEqual(["old"]);
  expect(windowState().panes.has(old)).toBe(false);
  expect(windowState().lock).toBeNull();
  expect(windowBytes()).toBe(0);
  // Same code reloaded: the replaced copy in pane p2 stopped beating.
  const ghost = joinWindow(pane("ghost"), "chat");
  const other = joinWindow(pane("other"), "chat");
  ghost.pane = "p2";
  other.pane = "p3";
  mine.pane = "p2";
  ghost.born = mine.born - 1; // the replaced copy joined first
  // A copy that joined after this one, in the same pane, its timer held up: never swept by it.
  const newer = joinWindow(pane("newer"), "chat");
  newer.pane = "p2";
  const now = Date.now();
  newer.beat = now - 2 * GHOST_MS;
  ghost.beat = now - GHOST_MS + 100;
  expect(sweepGhosts(mine, now)).toBe(0); // still beating
  other.beat = now - 2 * GHOST_MS;
  ghost.beat = now - 2 * GHOST_MS;
  expect(sweepGhosts(mine, now)).toBe(1);
  expect(forgot).toEqual(["old", "ghost"]);
  expect(windowState().panes.has(other)).toBe(true); // another pane's copy is not this one's
  expect(windowState().panes.has(newer)).toBe(true);
});

test("a registry entry whose pane was collected with no close() stops counting, and a copy that throws as it is emptied is counted for the debug report", () => {
  const dead = joinWindow({}, "chat");
  dead.ref = { deref: () => undefined };
  dead.bytes = 99 * MiB;
  const live = phantom(MiB);
  // windowBytes only reads; the 1 s timer's pruneWindow lets the dead entry go.
  expect(windowBytes()).toBe(99 * MiB + MiB);
  expect(pruneWindow()).toBe(1);
  expect(windowBytes()).toBe(MiB);
  expect(windowState().panes.has(dead)).toBe(false);
  expect(windowState().panes.has(live)).toBe(true);
  // A phantom has no evaluation of its own (gen null), so releaseOlder would release it too.
  leaveWindow(live);
  const old = joinWindow({ forget() { throw new Error("old code"); } }, "chat");
  old.gen = {};
  const keep = old.ref.deref?.() ?? old.ref; // held here, so the WeakRef stays full
  expect(releaseOlder()).toBe(1);
  expect(keep).toBeTruthy();
  expect(windowState().releaseErrors).toBe(1);
  expect(windowState().releaseError).toBe("old code");
});

test("gut empties a session in place, and the transcript's estimate stays for a side pane to judge by", () => {
  const s = sessionOf(4);
  s.file = "/x/a.jsonl";
  measure(s);
  noteFile(s);
  expect(fileBytes("/x/a.jsonl", 2)).toBe(sessionBytes(s, 2));
  const turns = s.turns;
  gut(s);
  expect(turns.length).toBe(0);
  expect(Object.keys(s)).toEqual([]);
  expect(fileBytes("/x/a.jsonl", 2)).toBeGreaterThan(0);
});

test("past the budget a Chat opens at its tail: the newest turns that fit, numbered from 1, under a note saying how many of how many", async () => {
  const file = fixture("--only", "1");
  fakeReader({ [file]: 60 });
  phantom(BUDGET - 100 * 1024);
  const { v } = openPane(file);
  await settle(v);
  const s = v.current();
  const n = s.turns.length;
  expect(n).toBeGreaterThan(1);
  expect(n).toBeLessThan(60);
  expect(s.turns[0].prompt).toStartWith(`prompt ${61 - n} `);
  expect(turnNumbers(v)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
  const note = v.rows().find((r) => r.kind === "note" && r.key === "tail:0");
  expect(note.text).toBe(`This session is too large to show in full: showing the newest ${n} of 60 turns`);
  expect(v.mem.bytes).toBeLessThanOrEqual(100 * 1024);
  expect(windowBytes()).toBeLessThanOrEqual(BUDGET);
  v.report();
  expect(H.state.shared["threads.debug"].t4.sessions[0].tail).toEqual({ shown: n, of: 60 });
}, 20000);

test("a Pinned pane on a session too large for the window reads none of it and says so; Retry reads it once room is made; a Trajectory pane lets go mid-read", async () => {
  const file = fixture("--only", "1");
  const st = fakeReader({ [file]: 60 });
  const chat = openPane(file);
  await settle(chat.v);
  expect(chat.v.current().turns.length).toBe(60);
  // The Chat's estimate of the file, at the Pinned pane's weight: half of it is left.
  const needs = fileBytes(file, PANE_WEIGHT.pinned);
  expect(needs).toBeGreaterThan(0);
  const room = phantom(BUDGET - windowBytes() - needs / 2);
  const asked = st.asked.length;
  const { v, cx } = openPane(file, { view: "pinned" });
  await until(() => v.refused, "the Pinned pane refusing");
  await new Promise((r) => setTimeout(r, 50));
  expect(st.asked.length).toBe(asked);
  expect(v.current().turns.length).toBe(0);
  H.rec = [];
  v.render(cx);
  const said = H.rec.flatMap((e) => e.slice(1)).filter((x) => typeof x === "string");
  H.rec = null;
  expect(said).toContain("This session is too large to show in full");
  // Room made: Retry reads it.
  windowState().panes.delete(room);
  v.retryRead(cx);
  await settle(v);
  expect(v.refused).toBeNull();
  expect(v.current().turns.length).toBe(60);
  // A Trajectory pane on a file no pane knows yet reads, then lets go past the budget.
  const other = fixture("--only", "2");
  fakeReader({ [file]: 60, [other]: 60 });
  phantom(BUDGET - windowBytes() - 50 * 1024);
  const t = openPane(other, { view: "trajectory" });
  await until(() => t.v.refused, "the Trajectory pane refusing");
  expect(t.v.current().turns.length).toBe(0);
  expect(t.v.mem.bytes).toBe(0);
  expect(() => t.v.render(t.cx)).not.toThrow();
}, 20000);

test("two panes read one chunk at a time between them, and over half the budget no call asks for more than 4 MiB", async () => {
  const [f1, f2] = [fixture("--only", "1"), fixture("--only", "2")];
  const per = 16000;
  let st = fakeReader({ [f1]: 1000, [f2]: 1000 }, per, 15);
  phantom(BUDGET * 0.6);
  const a = openPane(f1);
  const b = openPane(f2);
  await settle(a.v, 800);
  await settle(b.v, 800);
  expect(a.v.current().turns.length).toBe(1000);
  expect(b.v.current().turns.length).toBe(1000);
  expect(st.max).toBe(1);
  expect(new Set(st.asked.map((x) => x[0]))).toEqual(new Set([f1, f2]));
  expect(Math.max(...st.asked.map((x) => x[2]))).toBe(TIGHT_CHUNK);
  // Under half the budget, the same session asks for more.
  windowState().panes.clear();
  st = fakeReader({ [f1]: 1000 }, per);
  const c = openPane(f1);
  await settle(c.v, 800);
  expect(Math.max(...st.asked.map((x) => x[2]))).toBeGreaterThan(TIGHT_CHUNK);
}, 60000);

test("a pane that closes, or that a newer copy of the mod replaces, empties its sessions, leaves the window, draws a note and its timers do nothing", async () => {
  const a = openPane(fixture("--extra", "3"));
  await settle(a.v);
  expect(a.v.mem.bytes).toBeGreaterThan(0);
  const turns = a.v.current().turns;
  a.v.close();
  expect(a.v.forgotten).toBe(true);
  expect(turns.length).toBe(0);
  expect(windowBytes()).toBe(0);
  expect(() => a.v.render(a.cx)).not.toThrow();
  expect(() => { for (const x of a.cx.everies) x.fn(a.cx); }).not.toThrow();
  expect(() => a.v.close()).not.toThrow();
  // Replaced by a reload: its entry is an older evaluation's.
  const b = openPane(fixture("--extra", "3"));
  await settle(b.v);
  b.v.mem.gen = {};
  releaseOlder();
  expect(b.v.forgotten).toBe(true);
  expect(windowState().panes.size).toBe(0);
}, 20000);

test("a reload of the same code: the copy it replaced in this Herdr pane, its timers stopped, is emptied by the new copy's 1 s timer, and a copy still beating is left alone", async () => {
  const file = fixture("--extra", "3");
  const tick = (p) => { for (const x of p.cx.everies) if (x.ms === 1000) x.fn(p.cx); };
  const a = openPane(file);
  await settle(a.v);
  tick(a);
  const where = a.v.mem.pane;
  expect(where).toBeTruthy();
  const turns = a.v.current().turns;
  // The new copy, in the same Herdr pane, while the old one still beats: both stay.
  const b = openPane(file);
  await settle(b.v);
  tick(b);
  tick(b);
  expect(b.v.mem.pane).toBe(where);
  expect(a.v.forgotten).toBeUndefined();
  // The old copy's timers stopped (Herdr cancelled them): the new copy's next beat empties it,
  // but not a beat that comes after its own timer was held up (a sleep: no copy beat).
  a.v.mem.beat = Date.now() - 2 * GHOST_MS;
  b.v.lastTick = Date.now() - 60000;
  tick(b);
  expect(a.v.forgotten).toBeUndefined();
  a.v.mem.beat = Date.now() - 2 * GHOST_MS;
  tick(b);
  expect(a.v.forgotten).toBe(true);
  expect(turns.length).toBe(0);
  expect([...windowState().panes]).toEqual([b.v.mem]);
  expect(b.v.current().turns.length).toBeGreaterThan(0);
}, 20000);

test("a pin on a turn a trimmed Chat let go is older than the tail, not gone, and a pin keeps its number in the whole session", async () => {
  const file = fixture("--only", "1");
  fakeReader({ [file]: 60 });
  phantom(BUDGET - 100 * 1024);
  const { v, cx } = openPane(file);
  await settle(v);
  const s = v.current();
  const n = s.turns.length;
  expect(n).toBeLessThan(60);
  expect(droppedOf(s)).toBe(60 - n);
  // The same turns as the transcript's, for their ids.
  const whole = sessionOf(60, PAD);
  const pinOf = (i) => ({ id: turnId(whole.turns, whole.turns[i]), n: i + 1, text: `prompt ${i + 1}`, at: Date.now(), seen: { len: 0, fu: 0 } });
  const k = v.sessionKey(s);
  v.pinStore.sessions[k] = { at: Date.now(), pins: [pinOf(0), pinOf(59)] };
  v.pinVer++;
  const [old, last] = v.pinnedAll();
  expect(old.turn).toBeNull();
  expect(old.state).toBe("beyond");
  expect(old.pin.n).toBe(1);
  expect(last.turn).toBe(s.turns[n - 1]);
  expect(last.pin.n).toBe(60);
  // A pin made in the tail is stored with its number in the whole session.
  expect(v.togglePin(`0:${n - 1}`, cx)).toBe(true);
  const made = v.pinStore.sessions[k].pins.find((p) => p.id === turnId(whole.turns, whole.turns[58]));
  expect(made.n).toBe(59);
}, 20000);

test("a refusal is for its session: a new, small session in the same side pane is read", async () => {
  const file = fixture("--only", "1");
  const small = fixture("--only", "2");
  fakeReader({ [file]: 60, [small]: 3 });
  const chat = openPane(file);
  await settle(chat.v);
  phantom(BUDGET - windowBytes() - fileBytes(file, PANE_WEIGHT.pinned) / 2);
  const { v, cx } = openPane(file, { view: "pinned" });
  await until(() => v.refused, "the Pinned pane refusing");
  expect(v.refusedNow()).toBe(true);
  // The agent's /clear: the pane moves to a new session.
  v.sessions.push(newSession("s2", small));
  v.read(cx);
  await settle(v);
  expect(v.current().turns.length).toBe(3);
  expect(v.refusedNow()).toBe(false);
  H.rec = [];
  v.render(cx);
  const said = H.rec.flatMap((e) => e.slice(1)).filter((x) => typeof x === "string");
  H.rec = null;
  expect(said).not.toContain("This session is too large to show in full");
}, 20000);

test("a read keeps the window's turn until its chunk is measured and counted: no other pane's extractor call starts before", async () => {
  const [f1, f2] = [fixture("--only", "1"), fixture("--only", "2")];
  fakeReader({ [f1]: 600, [f2]: 600 }, 16000, 5);
  const log = [];
  const held = [];
  const ask = H.extractHook;
  H.extractHook = async (args) => { log.push(["exec", args[1]]); return ask(args); };
  phantom(BUDGET * 0.6); // over half the budget: 4 MiB chunks, several a session
  const panes = [openPane(f1), openPane(f2)];
  for (const { v } of panes) {
    const guard = v.guard.bind(v);
    v.guard = (s) => { held.push(windowState().lock?.e === v.mem); log.push(["guard", s.file]); return guard(s); };
  }
  for (const { v } of panes) await settle(v, 800);
  expect(held.length).toBeGreaterThan(2);
  expect(held.every(Boolean)).toBe(true);
  // Between a pane's extractor call and its guard, no other pane's call.
  let open = null;
  for (const [k, f] of log) {
    if (k === "exec") { expect(open == null || open === f).toBe(true); open = f; }
    else if (f === open) open = null;
  }
}, 60000);

test("a pane that picks another transcript lets go of the old one's estimate at once", async () => {
  const a = openPane(fixture("--extra", "3"));
  await settle(a.v);
  expect(a.v.mem.bytes).toBeGreaterThan(0);
  a.v.pick({ path: fixture("--extra", "4") }, a.cx);
  expect(a.v.mem.bytes).toBe(0);
}, 20000);

test("in a trimmed Chat a pin is loading while its session is read, gone when its number is in the tail but its turn is not, and older than the tail only when its number is; the toast gives the whole session's number", async () => {
  const file = fixture("--only", "1");
  fakeReader({ [file]: 60 });
  phantom(BUDGET - 100 * 1024);
  const { v, cx } = openPane(file);
  await settle(v);
  const s = v.current();
  const n = s.turns.length;
  const dropped = droppedOf(s);
  expect(dropped).toBe(60 - n);
  const whole = sessionOf(60, PAD);
  const id = (i) => turnId(whole.turns, whole.turns[i]);
  // Turn 59's second and count, another prompt: the agent rewrote that turn.
  const rewritten = id(58).replace(/\|[^|]+\|/, "|x|");
  const k = v.sessionKey(s);
  v.pinStore.sessions[k] = { at: Date.now(), pins: [
    { id: id(0), n: 1, text: "prompt 1", at: Date.now(), seen: { len: 0, fu: 0 } },
    { id: rewritten, n: 59, text: "prompt 59", at: Date.now(), seen: { len: 0, fu: 0 } },
  ] };
  v.pinVer++;
  expect(v.pinnedAll().map((p) => p.state)).toEqual(["beyond", "gone"]);
  // Still being read: neither is known yet.
  s.loaded = false;
  expect(v.pinnedAll().map((p) => p.state)).toEqual(["loading", "loading"]);
  s.loaded = true;
  // The toast and the Pinned list give one number: the whole session's.
  v.pinStore.sessions[k].pins.length = 0;
  v.pinVer++;
  expect(v.togglePin(`0:${n - 1}`, cx)).toBe(true);
  expect(v.toast.text).toStartWith("Pinned #59 ");
}, 20000);

test("a pane whose close() throws part way still leaves the window and empties its sessions", async () => {
  const a = openPane(fixture("--extra", "3"));
  await settle(a.v);
  const turns = a.v.current().turns;
  expect(turns.length).toBeGreaterThan(0);
  a.v.dropCode = () => { throw new Error("boom"); };
  expect(() => a.v.close()).toThrow("boom");
  expect(a.v.forgotten).toBe(true);
  expect(turns.length).toBe(0);
  expect(windowState().panes.size).toBe(0);
}, 20000);

test("a read whose extractor call ran past LOCK_STALE keeps the window's turn: its heartbeat renews it, so no other pane takes it before the chunk is counted", async () => {
  const file = fixture("--only", "1");
  fakeReader({ [file]: 5 });
  const ask = H.extractHook;
  // The call came back after LOCK_STALE, no other pane having asked meanwhile.
  H.extractHook = async (args) => { const r = await ask(args); const l = windowState().lock; if (l) l.at = Date.now() - LOCK_STALE - 1; return r; };
  const otherPane = {};
  const other = joinWindow(otherPane, "pinned");
  const { v } = openPane(file);
  const took = [];
  const guard = v.guard.bind(v);
  v.guard = (s) => {
    took.push(takeRead(other, 1));
    dropRead(other);
    return guard(s);
  };
  await settle(v);
  expect(otherPane).toBeTruthy();
  expect(took.length).toBeGreaterThan(0);
  expect(took.every((x) => x === false)).toBe(true);
}, 20000);

test("a trim with the rows over the row window's stop starts the row window, capKey and viewEndKey over, so the next rows place the window on the renumbered turns", async () => {
  const file = fixture("--only", "1");
  fakeReader({ [file]: 60 });
  const { v } = openPane(file);
  await settle(v);
  const s = v.current();
  expect(s.turns.length).toBe(60);
  // A small window: 60 turns are past its stop, so it has a range (from) once placed at the end.
  v.win.cap = { ...v.win.cap, slide: 20, block: 5, stop: 24 };
  v.rows();
  v.win.place(v.winList(), { tail: true });
  expect(v.win.from).not.toBeNull();
  expect(v.win.at).not.toBeNull();
  v.capKey = "0:50";
  v.viewEndKey = "0:55";
  // The window fills up: this pane's next guard keeps the newest turns that fit.
  phantom(BUDGET - 100 * 1024);
  expect(v.guard(s)).toBe(false);
  const n = s.turns.length;
  expect(n).toBeLessThan(60);
  expect(droppedOf(s)).toBe(60 - n);
  expect({ from: v.win.from, to: v.win.to, at: v.win.at, capKey: v.capKey, viewEndKey: v.viewEndKey }).toEqual({ from: null, to: null, at: null, capKey: null, viewEndKey: null });
  // Placed again, with a window smaller than the tail's rows, the range starts at a turn of the
  // tail and ends at its end.
  expect(n).toBeGreaterThanOrEqual(2);
  v.win.cap = { ...v.win.cap, slide: 2, block: 1, stop: 3 };
  v.rows();
  expect(v.winList().rows.length).toBeGreaterThan(3);
  v.win.place(v.winList(), { tail: true });
  expect(v.win.from).not.toBeNull();
  expect(v.winList().index.has(v.win.from)).toBe(true);
  expect(v.findTurn(v.win.from)).not.toBeNull();
  expect(v.win.at.z).toBe(v.winList().rows.length);
}, 20000);

test("shiftKey: after a trim of k turns, a key of session si names the same turn, a key of a turn that went is null, and other keys stay", () => {
  expect(shiftKey("0:50", 0, 40)).toBe("0:10");
  expect(shiftKey("md:0:50:2.1", 0, 40)).toBe("md:0:10:2.1");
  expect(shiftKey("imgs:md:0:50:1", 0, 40)).toBe("imgs:md:0:10:1");
  expect(shiftKey("0:50:3", 0, 40)).toBe("0:10:3"); // a code editor's key
  expect(shiftKey("skip:0:50", 0, 40)).toBe("skip:0:10");
  expect(shiftKey("0:40", 0, 40)).toBeNull();
  expect(shiftKey("1:50", 0, 40)).toBe("1:50");
  for (const k of ["day:0:20261101", "hid:0:300", "skip:0:head", "tail:0", "pins:3", "pday:2", "empty:0", "div:0", "sess:0"]) expect(shiftKey(k, 0, 40)).toBe(k);
  expect(shiftKey(null, 0, 40)).toBeNull();
});

test("a trim keeps the selection, the open turns, the reader's place and a pending scroll on the same turns, and drops the ones of turns that went", async () => {
  const file = fixture("--only", "1");
  fakeReader({ [file]: 60 });
  const { v } = openPane(file);
  await settle(v);
  const s = v.current();
  expect(s.turns.length).toBe(60);
  v.follow = false;
  v.sel = "0:59";
  v.open.add("0:59");
  v.open.add("0:3");
  v.full.add("l:0:59");
  v.topKey = "md:0:58:0";
  v.winSeen = "0:58";
  v.tsel = "0:59";
  v.scrollTo = { key: "md:0:59:0", how: "land", or: ["0:3", "0:59"], until: Date.now() + 400 };
  phantom(BUDGET - 100 * 1024);
  expect(v.guard(s)).toBe(false);
  const k = droppedOf(s);
  expect(k).toBeGreaterThanOrEqual(3);
  expect(s.turns.length).toBeGreaterThanOrEqual(3); // turns 58 and 59 are in the tail
  const at = (n) => `0:${n - k}`;
  expect(v.sel).toBe(at(59));
  expect(v.findTurn(v.sel).prompt).toStartWith("prompt 59 ");
  expect([...v.open].sort()).toEqual([at(59)]);
  expect([...v.full]).toEqual([`l:${at(59)}`]);
  expect(v.topKey).toBe(`md:${at(58)}:0`);
  expect(v.findTurn(v.winSeen).prompt).toStartWith("prompt 58 ");
  expect(v.tsel).toBe(at(59));
  expect(v.scrollTo).toMatchObject({ key: `md:${at(59)}:0`, how: "land", or: [at(59)] });
}, 20000);
