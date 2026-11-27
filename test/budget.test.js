// bun test: the window's memory guard (budget.js), as data and in panes on the render harness
// (test/render-harness.js): the estimate, the tail a session keeps past the budget, the side
// panes that read nothing, one read at a time, the smaller chunks, and what a closed or
// replaced copy gives back.
import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newSession, apply, parseChunk } from "../mods/agent-threads/core/turns.js";
import {
  BUDGET, TIGHT_CHUNK, TRIM_TO, PANE_WEIGHT, LOCK_STALE, QUEUE_STALE, GHOST_MS, measure, sessionBytes, trim, shiftKey, tailOf, tailNote, droppedOf, gut, windowState,
  joinWindow, leaveWindow, windowBytes, noteFile, fileBytes, releaseOlder, sweepGhosts, takeRead, holdRead, dropRead, pruneWindow, idsBefore, turnBytes,
} from "../mods/agent-threads/budget.js";
import { turnId, turnIds } from "../mods/agent-threads/pins.js";
import { drawRange, fixture, H, makeCx, modDir, PINS, settle, setup, Threads, unsliced, until } from "./render-harness.js";

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
  // A Pinned pane beside the Chat shares its copy (test/share.test.js): the Chat closes, and
  // its estimate of the file stays for the Pinned pane to judge by.
  chat.v.close();
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

// The completeness test's walk (not the mod's: a trim moves only the fields on its lists).
// A string holds a key of session si's turns when "si:n" is in it and not part of a longer
// number or word (as in "10:30", "1.0:5" or "x0:5").
const hasTurnKey = (str, si) => new RegExp(`(?:^|[^0-9A-Za-z.])${si}:\\d+(?![0-9.])`).test(str);
// Whether x holds one: a string, or one in a Set, a Map (keys and values), an array or an
// object's own values, down to depth levels; skip(o), an object not walked (a session, a turn).
function holdsTurnKey(x, si, skip = () => false, depth = 6, seen = new Set()) {
  if (typeof x === "string") return hasTurnKey(x, si);
  if (!x || typeof x !== "object" || depth <= 0 || seen.has(x) || skip(x)) return false;
  seen.add(x);
  const d = depth - 1;
  if (x instanceof Map) return [...x].some(([k, y]) => holdsTurnKey(k, si, skip, d, seen) || holdsTurnKey(y, si, skip, d, seen));
  if (x instanceof Set || Array.isArray(x)) return [...x].some((y) => holdsTurnKey(y, si, skip, d, seen));
  return Object.keys(x).some((k) => holdsTurnKey(x[k], si, skip, d, seen));
}
// Fields holding a transcript's, the settings' or a person's text, where "si:n" is words: not
// walked, and never on a list a trim moves or starts over.
const TEXT_FIELDS = [
  "sessions", "res", "prefs", "prefsRaw", "prefsNotes", "prefsError", "pinStore", "pinRaw", "pinUndo", "calls", "links", "senders",
  "linkList", "senderList", "linkNotes", "senderNotes", "trajNotes", "toast", "copied", "toldPart", "choices", "lastQuote", "remote",
  "quoteDraft", "quoteFileNote", "ruleEdit", "ruleUndo", "rulesPending", "opening", "shownList", "known", "terminal", "query", "imgs",
  "cardBody", "cardPlaces", "mem", "rowsLog", "readerMoves",
];

test("the completeness test's walk finds a turn's key anywhere in a string but not in a longer number, through Maps, Sets, arrays and nested objects", () => {
  for (const s of ["0:5", "md:0:5:1", "0:59|abc", "w:0:5|x", "at 0:30"]) expect([s, hasTurnKey(s, 0)]).toEqual([s, true]);
  for (const s of ["10:30", "1.0:5", "x0:5", "12:00", "1:5", ""]) expect([s, hasTurnKey(s, 0)]).toEqual([s, false]);
  expect(holdsTurnKey(new Map([["a", { x: [{ k: "zz|0:3" }] }]]), 0)).toBe(true);
  expect(holdsTurnKey(new Map([["0:3", 1]]), 0)).toBe(true);
  expect(holdsTurnKey(new Set([["md:0:4:0"]]), 0)).toBe(true);
  expect(holdsTurnKey({ a: { b: "1:2" } }, 0)).toBe(false);
  const turn = { prompt: "at 0:30" };
  expect(holdsTurnKey({ turn }, 0, (o) => o === turn)).toBe(false);
  const cyc = { a: null };
  cyc.a = cyc;
  expect(holdsTurnKey(cyc, 0)).toBe(false);
});

// A pane with a 60-turn session read in full, and a trim of it past the budget: k, the turns
// that went, and at(n), turn n's key after it.
async function trimmedLater(file = fixture("--only", "1")) {
  fakeReader({ [file]: 60 });
  const p = openPane(file);
  await settle(p.v);
  expect(p.v.current().turns.length).toBe(60);
  p.v.follow = false;
  return {
    ...p,
    trimNow(room = 100 * 1024) {
      phantom(BUDGET - room);
      const s = p.v.current();
      expect(p.v.guard(s)).toBe(false);
      const k = droppedOf(s);
      expect(k).toBeGreaterThanOrEqual(3);
      expect(s.turns.length).toBeGreaterThanOrEqual(3); // turns 58 and 59 are in the tail
      return { k, at: (n) => `0:${n - k}` };
    },
  };
}

test("a trim moves the step-level opens, the code editors and every other field keyed by turn with their turns, and lets go of the ones of turns that went", async () => {
  const { v, trimNow } = await trimmedLater();
  for (const f of ["lineOpen", "lineTouched"]) { v[f].add("0:59"); v[f].add("0:3"); }
  for (const f of ["groupOpen", "groupTouched"]) { v[f].add("0:59:2"); v[f].add("0:3:1"); }
  for (const f of ["callOpen", "callAll"]) { v[f].add("0:59:2:1"); v[f].add("0:3:1:0"); }
  v.codeDue = new Set(["0:59", "0:3"]);
  v.liveCode = new Set(["0:59"]);
  v.mdBroken = new Set(["md:0:59:0", "md:0:3:0"]);
  const released = [];
  const ed = (n) => ({ st: { release() { released.push(n); } }, text: "x" });
  const kept = ed(59);
  v.code.set("0:59:1", kept);
  v.code.set("0:3:0", ed(3));
  v.placeBase = "md:0:58:0";
  v.pinVisit = "0:59";
  v.pinAgain = "0:59";
  v.textSel = "0:59";
  v.tscrollTo = "0:59";
  v.scrollTo = { key: "0:59", how: "land", head: "0:59", until: Date.now() + 400 };
  v.openWait = { key: "0:59", gen: 1, filtering: false };
  v.pinResume = { key: "0:59", part: "md:0:59:2" };
  v.outlineBack = { sel: "0:59", top: "md:0:58:0", follow: false };
  v.flash = { key: "0:59", on: true, n: 1 };
  v.railGrow = { key: "0:3", on: true };
  const { at } = trimNow();
  for (const f of ["lineOpen", "lineTouched"]) expect([...v[f]]).toEqual([at(59)]);
  for (const f of ["groupOpen", "groupTouched"]) expect([...v[f]]).toEqual([`${at(59)}:2`]);
  for (const f of ["callOpen", "callAll"]) expect([...v[f]]).toEqual([`${at(59)}:2:1`]);
  expect([...v.codeDue]).toEqual([at(59)]);
  expect([...v.liveCode]).toEqual([at(59)]);
  expect([...v.mdBroken]).toEqual([`md:${at(59)}:0`]);
  expect([...v.code.keys()]).toEqual([`${at(59)}:1`]);
  expect(v.code.get(`${at(59)}:1`)).toBe(kept);
  expect(released).toEqual([3]);
  expect(v.placeBase).toBe(`md:${at(58)}:0`);
  for (const f of ["pinVisit", "pinAgain", "textSel", "tscrollTo"]) expect(v[f]).toBe(at(59));
  expect(v.scrollTo).toMatchObject({ key: at(59), head: at(59), how: "land" });
  expect(v.openWait).toEqual({ key: at(59), gen: 1, filtering: false });
  expect(v.pinResume).toEqual({ key: at(59), part: `md:${at(59)}:2` });
  expect(v.outlineBack).toEqual({ sel: at(59), top: `md:${at(58)}:0`, follow: false });
  expect(v.flash).toEqual({ key: at(59), on: true, n: 1 });
  expect(v.railGrow).toBeNull(); // its turn went
}, 20000);

test("a trim keeps the Select view on its turn, so its rows show that turn's reply, and ends it when its turn went", async () => {
  const a = await trimmedLater();
  a.v.toggleSelect("0:59", a.cx);
  const st = a.v.selEditor.st;
  expect(a.v.selecting).toBe("0:59");
  const { at } = a.trimNow();
  expect(a.v.selecting).toBe(at(59));
  expect(a.v.selEditor.key).toBe(at(59));
  expect(a.v.selEditor.st).toBe(st);
  expect(a.v.selEditor.text).toBe(a.v.replyText(a.v.findTurn(at(59))));
  expect(a.v.rows().some((r) => r.kind === "seltext" && r.key === `sx:${at(59)}`)).toBe(true);
  // Another pane, its Select view on a turn the trim lets go.
  windowState().panes.clear();
  const b = await trimmedLater(fixture("--only", "2"));
  b.v.toggleSelect("0:3", b.cx);
  let released = 0;
  const release = b.v.selEditor.st.release;
  b.v.selEditor.st.release = () => { released++; return release(); };
  b.trimNow();
  expect(b.v.selecting).toBeNull();
  expect(b.v.selEditor).toBeNull();
  expect(released).toBe(1);
  expect(b.v.rows().some((r) => r.kind === "seltext")).toBe(false);
}, 30000);

test("every field of a pane that holds a turn's key, walked through Maps, Sets, arrays and nested objects after a session's worth of use, is on TURN_KEYED or TURN_KEYED_RESET, and every name on them is the pane's", async () => {
  const { v, cx } = await trimmedLater();
  const { moved, reset } = v.turnKeyed();
  const known = new Set([...moved.map(([f]) => f), ...reset, ...TEXT_FIELDS]);
  // A person's text is on no list a trim moves or starts over.
  expect([...moved.map(([f]) => f), ...reset].filter((f) => TEXT_FIELDS.includes(f))).toEqual([]);
  // Each name on the lists is a field main.js sets; one init() does not make is marked lazy.
  const source = readFileSync(join(modDir, "main.js"), "utf8");
  for (const f of [...moved.map(([f]) => f), ...reset]) expect([f, new RegExp(`this\\.${f}\\b`).test(source)]).toEqual([f, true]);
  for (const [f, , opt] of moved) if (!opt?.lazy) expect([f, Object.hasOwn(v, f)]).toEqual([f, true]);
  // A session's worth of use: the outline, the Select view, a turn opened with its line, a
  // step group and a call, a pin, a flash and a rail tick, a frame drawn, a click on the rail,
  // the Trajectory, and the newest turn asked for while rows are built.
  v.sel = "0:55";
  v.setOutline(true);
  v.toggleSelect("0:59", cx);
  v.toggle("0:58", cx);
  v.toggleLine("0:58");
  v.setGroup("0:58:1", true);
  v.toggleCall("0:58:1:0");
  v.togglePin("0:57", cx);
  const due = cx.timers.length;
  v.flashTurn("0:57", cx);
  cx.timers[due].fn(cx);
  v.railGrowStart("0:56", cx);
  v.rows();
  v.render(cx);
  v.action("debugRailJump:54", cx); // a click on turn #54's tick
  v.enterTraj();
  // Last: the newest turn asked for while rows are built. A build that ends (rows) settles the
  // ask (latestAfterBuild clears latestDue), so it comes after the frame.
  const job = v.rowJob;
  v.rowJob = job ?? { going: true };
  v.selectNewest();
  v.rowJob = job;
  const walked = new Set();
  for (const s of v.sessions) { walked.add(s); for (const t of s.turns) walked.add(t); }
  const skip = (o) => walked.has(o);
  // The use above reached these, so the walk below is not over empty fields.
  for (const f of ["outlineBack", "selecting", "selEditor", "open", "lineOpen", "groupOpen", "groupTouched", "callOpen", "flash", "railGrow", "latestDue", "trajFrom", "tsel", "railTurns", "railMemo"]) {
    expect([f, holdsTurnKey(v[f], 0, skip)]).toEqual([f, true]);
  }
  const left = Object.keys(v).filter((f) => !known.has(f) && holdsTurnKey(v[f], 0, skip));
  expect(left).toEqual([]);
}, 20000);

test("a trim that lets the Select view's turn go ends the view as endSelect does, so the keyboard comes back to the pane", async () => {
  const { v, cx, trimNow } = await trimmedLater();
  v.toggleSelect("0:3", cx);
  v.editorFocused = true; // the Select editor had the keyboard
  let released = 0;
  const st = v.selEditor.st;
  const release = st.release;
  st.release = () => { released++; return release(); };
  trimNow();
  expect(v.selecting).toBeNull();
  expect(v.selEditor).toBeNull();
  expect(released).toBe(1);
  expect(v.editorFocused).toBe(false);
}, 20000);

test("a trim moves the newest-turn ask, the way back from the Trajectory and the rows Herdr cut with their turns, and the newest turn is still selected after the build", async () => {
  const { v, trimNow } = await trimmedLater();
  v.follow = true;
  v.sel = "0:59";
  v.latestDue = { sel: "0:59" };
  v.trajFrom = { follow: true, turn: "0:3" };
  v.cutRows = new Map([["md:0:59:0", { n: 2 }], ["md:0:3:0", { n: 1 }]]);
  const { at } = trimNow();
  expect(v.sel).toBe(at(59));
  expect(v.latestDue).toEqual({ sel: at(59) });
  // Its turn went, and the way back still follows.
  expect(v.trajFrom).toEqual({ follow: true, turn: null });
  expect([...v.cutRows]).toEqual([[`md:${at(59)}:0`, { n: 2 }]]);
  v.rows();
  v.latestAfterBuild();
  expect(v.sel).toBe(`0:${v.current().turns.length}`);
}, 20000);

test("a trim moves the rail's ticks with their turns into a new list, leaving the old one (a build's too) as it was", async () => {
  const { v, trimNow } = await trimmedLater();
  v.rows();
  const old = v.railTurns;
  expect(old.length).toBe(60);
  const was = old.map((x) => x.key);
  const { k, at } = trimNow();
  expect(v.railTurns).not.toBe(old);
  expect(old.map((x) => x.key)).toEqual(was);
  expect(v.railTurns.map((x) => x.key)).toEqual(Array.from({ length: 60 - k }, (_, i) => at(k + i + 1)));
  // Each tick keeps its turn: the key names the same turn as before.
  for (const x of v.railTurns) expect(v.findTurn(x.key)).toBe(x.turn);
}, 20000);

test("a trim leaves a person's text alone, \"0:30\" in it or not: the unpin history, what was copied, the notes", async () => {
  const { v, trimNow } = await trimmedLater();
  const undo = { k: v.sessionKey(v.current()), at: 0, pin: { id: "1|x|1", n: 1, text: "split arr[0:3] at 0:30", at: 0, seen: { len: 0, fu: 0 } } };
  v.pinUndo.push(undo);
  v.toldPart = "see 0:12 in the log";
  v.linkNotes = ["rule 0:2 has no URL"];
  v.trajNotes = ["0:5 is not a turn"];
  trimNow();
  expect(v.pinUndo.at(-1)).toBe(undo);
  expect(undo.pin.text).toBe("split arr[0:3] at 0:30");
  expect(v.toldPart).toBe("see 0:12 in the log");
  expect(v.linkNotes).toEqual(["rule 0:2 has no URL"]);
  expect(v.trajNotes).toEqual(["0:5 is not a turn"]);
}, 20000);

test("while a trim's rebuild runs over several frames, the rows drawn are the tail's, under the new keys, and the window, the top, the jump and the selection land on the same turns once it ends", async () => {
  const { v, cx, trimNow } = await trimmedLater();
  // Under the tail's 20 turns or more: the rows always have a window.
  v.win.cap = { ...v.win.cap, slide: 10, block: 3, stop: 12 };
  // A reader who is not following: the window stays where the jump put it.
  v.follow = false;
  v.toBottom = false;
  v.rows();
  v.sel = "0:50";
  const target = v.findTurn("0:50");
  // Two rows left to be sized again (staleRows): one of a turn the trim lets go (turn 2), one
  // of turn 50.
  const stale = [v.baseRows.findIndex((r) => r.turn === v.findTurn("0:2")), v.baseIndex.get("0:50")];
  expect(stale.every((i) => i >= 0)).toBe(true);
  v.staleRows = stale;
  // Room for about 60% of the session: a tail of 20 turns or more, so its rows take more than
  // one slice, with turn 50 in it.
  const { k, at } = trimNow(Math.floor(v.mem.bytes * 0.6));
  expect(k).toBeLessThan(50);
  const s = v.current();
  expect(s.turns.length).toBeGreaterThanOrEqual(20);
  expect(v.sel).toBe(at(50));
  expect(v.staleRows.map((i) => v.baseRows[i].turn)).toEqual([target]);
  expect(v.baseSizes.length).toBe(v.baseRows.length);
  v.scrollTo = { key: v.sel, how: "center" };
  // A slice a frame, cut every 16 turns (buildRows).
  v.buildMax = () => 0;
  const turnOf = (key) => /(?:^|:)(\d+):(\d+)(?=:|$)/.exec(key)?.slice(1, 3).join(":") ?? null;
  const kept = new Set(s.turns);
  const agree = () => {
    const rows = v.baseRows;
    // Every row of the session is a kept turn's, its key that turn's number now, and the
    // index finds it there.
    expect(rows.filter((r) => r.turn && r.si === 0 && !kept.has(r.turn)).length).toBe(0);
    expect(rows.filter((r) => r.turn && r.si === 0 && turnOf(r.key) !== `0:${r.turn.n}`).map((r) => r.key)).toEqual([]);
    expect(rows.every((r, i) => v.baseIndex.get(r.key) === i)).toBe(true);
    expect(v.baseSizes.length).toBe(rows.length);
    expect(v.baseRows[v.baseIndex.get(v.sel)]?.turn).toBe(target);
  };
  // A frame drawn from the selected turn's row down: the list writes the top and the end back.
  const frame = () => {
    v.render(cx);
    const rows = v.rows();
    const i = rows.findIndex((r) => r.key === v.sel);
    expect(i).toBeGreaterThanOrEqual(0);
    drawRange(v, i, Math.min(rows.length, i + 3));
  };
  const placed = () => {
    expect(v.baseRows[v.baseIndex.get(v.topKey)]?.turn).toBe(target);
    expect(kept.has(v.baseRows[v.baseIndex.get(v.viewEndKey)]?.turn)).toBe(true);
  };
  frame();
  expect(v.rowJob).not.toBeNull(); // mid-build: the rows on screen are the ones from before the trim
  agree();
  placed();
  let frames = 0;
  while (v.rowJob && frames++ < 100) { frame(); if (v.rowJob) { agree(); placed(); } }
  expect(v.rowJob).toBeNull();
  agree();
  placed();
  // The window, placed by the frames mid-build and after, holds the selected turn and starts
  // at a turn of the tail.
  const list = v.winList();
  expect(v.win.from).not.toBeNull();
  expect(kept.has(v.findTurn(v.win.from))).toBe(true);
  expect(v.win.has(list, v.sel)).toBe(true);
  expect(v.findTurn(v.sel)).toBe(target);
}, 30000);

test("a trim lets go of the closed turns' rows kept for every width, and a closed pane empties them", async () => {
  const { v, cx, trimNow } = await trimmedLater();
  v.render(cx);
  const s = v.current();
  const oldest = s.turns[0];
  const holds = (pred) => [...(v.keptBases?.values() ?? [])].some((b) => [...b.rows.values()].some((e) => pred(e.turn) || e.rows.some((r) => pred(r.turn))));
  // The oldest turn's rows are kept before the trim, which lets that turn go.
  expect(holds((t) => t === oldest)).toBe(true);
  const before = [...s.turns];
  trimNow();
  const kept = new Set(s.turns);
  const dropped = before.filter((t) => !kept.has(t));
  expect(dropped).toContain(oldest);
  expect(holds((t) => dropped.includes(t))).toBe(false);
  // Kept again by the next frame, then let go with the pane.
  v.render(cx);
  const kb = v.keptBases;
  const widths = [...kb.values()];
  expect(widths.some((b) => b.rows.size > 0)).toBe(true);
  v.forget();
  expect(kb.size).toBe(0);
  expect(widths.every((b) => b.rows.size === 0 && b.meas.size === 0)).toBe(true);
}, 20000);

test("a trim moves the jump a stopped render asks for again (renderWant) with its turn, and resets the day band's place above the window and the rail's seen range", async () => {
  const { v, cx, trimNow } = await trimmedLater();
  v.render(cx);
  v.renderWant = { toBottom: false, scrollTo: { key: "0:50", how: "center", or: ["md:0:50:0"] }, wheels: v.wheelN ?? 0 };
  v.dayAbove = { base: v.baseRows, ver: v.baseVer ?? 0, at: 3, idx: 0 };
  v.railSeen = "0:40|0:50";
  const { k, at } = trimNow(Math.floor(v.mem.bytes * 0.6));
  expect(k).toBeLessThan(50);
  expect(v.renderWant.scrollTo).toEqual({ key: at(50), how: "center", or: [`md:${at(50)}:0`] });
  expect(v.dayAbove).toBeNull();
  expect(v.railSeen).toBeNull();
}, 20000);

test("a trim lets go of the Trajectory's ledger and timeline, so none of its state holds a turn the trim let go or a key past the tail", async () => {
  const { v, cx, trimNow } = await trimmedLater();
  v.enterTraj();
  for (let i = 0; i < 5; i++) v.render(cx);
  const s = v.current();
  const oldest = s.turns[0];
  const before = [...s.turns];
  const fields = ["ledgerMemo", "ledgerShown", "ledgerJob", "tlModel", "tlJob", "tlKeep", "tlHatch", "tlFails"];
  // Whether x reaches an object or string pred holds for, through Maps, Sets, arrays and own
  // values; skip(o), an object not walked further (the sessions and the kept turns).
  const reaches = (x, pred, skip, depth = 10, seen = new Set()) => {
    if (pred(x)) return true;
    if (!x || typeof x !== "object" || depth <= 0 || seen.has(x) || skip(x)) return false;
    seen.add(x);
    const d = depth - 1;
    if (x instanceof Map) return [...x].some(([k, y]) => reaches(k, pred, skip, d, seen) || reaches(y, pred, skip, d, seen));
    if (x instanceof Set || Array.isArray(x)) return [...x].some((y) => reaches(y, pred, skip, d, seen));
    return Object.keys(x).some((k) => reaches(x[k], pred, skip, d, seen));
  };
  // A key of turn n of session 0 past n turns ("0:60" when the tail is shorter).
  const past = (n) => (x) => typeof x === "string" && [...x.matchAll(/(?:^|[^0-9A-Za-z.])0:(\d+)(?![0-9.])/g)].some((m) => Number(m[1]) > n);
  const sessions = () => new Set([...v.sessions, v.sessions]);
  // The Trajectory was built: it holds the oldest turn, or a key of turn 60.
  const ss = sessions();
  const built = fields.filter((f) => reaches(v[f], (x) => x === oldest || past(59)(x), (o) => ss.has(o) || s.turns.includes(o)));
  expect(built.length).toBeGreaterThan(0);
  trimNow();
  const kept = new Set(s.turns);
  const dropped = new Set(before.filter((t) => !kept.has(t)));
  expect(dropped.has(oldest)).toBe(true);
  const sk = sessions();
  const left = fields.filter((f) => reaches(v[f], (x) => dropped.has(x) || past(s.turns.length)(x), (o) => sk.has(o) || kept.has(o)));
  expect(left).toEqual([]);
}, 20000);

test("a live session at its budget trims once, to TRIM_TO of the room, and the small chunks it writes after fit without another trim", async () => {
  const { v } = await trimmedLater();
  const s = v.current();
  expect(s.turns.length).toBe(60);
  // Just over: the room is one KiB under what the pane holds.
  phantom(BUDGET - (v.mem.bytes - 1024));
  const room = BUDGET - windowBytes(v.mem);
  const trims = [];
  const chunk = (i) => {
    // A small chunk of the live session: one short turn.
    if (i) s.turns.push({ n: s.turns.length + 1, prompt: `live ${i}`, steps: [], done: true, v: s.version });
    const was = droppedOf(s);
    expect(v.guard(s)).toBe(false);
    trims.push(droppedOf(s) - was);
  };
  chunk(0);
  expect(v.mem.bytes).toBeLessThanOrEqual(Math.floor(room * TRIM_TO));
  for (let i = 1; i < 5; i++) chunk(i);
  // The first trims, to about TRIM_TO of the room; the four after it fit in the rest.
  expect(trims[0]).toBeGreaterThan(0);
  expect(trims.slice(1)).toEqual([0, 0, 0, 0]);
  expect(v.mem.bytes).toBeLessThanOrEqual(room);
  expect(s.turns.at(-1).prompt).toBe("live 4");
}, 20000);

test("a trim keeps TRIM_TO of what the pane's other sessions leave of the room: with them at 0.9 of it, the session still keeps the turns that fit", async () => {
  const { v } = await trimmedLater();
  const s = v.current();
  const w = PANE_WEIGHT.chat;
  // Another session of the pane, behind this one.
  const other = sessionOf(60, PAD);
  measure(other);
  v.sessions.push(other);
  const others = sessionBytes(other, w);
  const room = Math.floor(others / 0.9);
  // A few of this session's turns fit in what is left.
  const left = Math.floor((room - others) * TRIM_TO);
  expect(left).toBeGreaterThan(3 * (sessionBytes(s, w) / s.turns.length));
  phantom(BUDGET - room);
  expect(BUDGET - windowBytes(v.mem)).toBe(room);
  expect(v.guard(s)).toBe(false);
  expect(droppedOf(s)).toBeGreaterThan(0);
  expect(s.turns.length).toBeGreaterThan(1);
  expect(sessionBytes(s, w)).toBeLessThanOrEqual(left);
  expect(v.mem.bytes).toBeLessThanOrEqual(room);
}, 20000);

// ---- the review's findings on the guard ----

test("trim counts a dropped turn's waiting calls as going with it, so it lets go of no more turns than fit", () => {
  const w = PANE_WEIGHT.chat;
  const s = sessionOf(10, PAD);
  measure(s);
  const bare = sessionBytes(s, w);
  // 100 calls of the oldest turn wait for their output: charged to the session (measure).
  for (let i = 0; i < 100; i++) s.calls.set(`c${i}`, { turn: s.turns[0] });
  measure(s);
  const all = sessionBytes(s, w);
  expect(all).toBeGreaterThan(bare);
  // Room for all but the oldest turn and its calls (the same turn as one's), and a byte.
  const one = sessionOf(1, PAD);
  measure(one);
  const room = bare - sessionBytes(one, w) + 1;
  expect(trim(s, room, w)).toBe(1);
  expect(s.calls.size).toBe(0);
  // The estimate trim leaves is the one a new measure makes.
  const left = sessionBytes(s, w);
  measure(s);
  expect(sessionBytes(s, w)).toBe(left);
});

test("a repeated prompt keeps its count in the whole session after a trim: a pin on the first copy is older than the tail, one on the second still finds it", () => {
  const w = PANE_WEIGHT.chat;
  const s = newSession("s", "/x/r.jsonl");
  const T = new Date(Date.UTC(2026, 10, 1, 9)).toISOString();
  for (let i = 0; i < 2; i++) for (const e of [{ k: "p", o: "human", ts: T, t: "same prompt" }, { k: "t", ts: T, t: "r" }, { k: "d", ts: T, ms: 1 }]) apply(s, e);
  for (let i = 2; i < 6; i++) for (const e of turnEvents(i, PAD)) apply(s, e);
  const [first, second] = s.turns;
  const id1 = turnId(s.turns, first);
  const id2 = turnId(s.turns, second);
  expect(id1).not.toBe(id2);
  measure(s);
  // The oldest turn goes.
  expect(trim(s, sessionBytes(s, w) - 1, w)).toBe(1);
  expect(s.turns[0]).toBe(second);
  const ids = turnIds(s.turns, [id1, id2], idsBefore(s));
  expect(ids.get(id1)).toBeUndefined();
  expect(ids.get(id2)).toBe(second);
  expect(turnId(s.turns, second, idsBefore(s))).toBe(id2);
});

test("a read whose extractor call is out keeps the window's turn past LOCK_STALE (a computer's sleep), and only then can it go stale", () => {
  const [a, b] = [joinWindow({}, "chat"), joinWindow({}, "pinned")];
  expect(takeRead(a, 1, 0)).toBe(true);
  holdRead(a, 1, 0, true);
  expect(takeRead(b, 1, LOCK_STALE + 5000)).toBe(false);
  expect(takeRead(b, 1, LOCK_STALE * 10)).toBe(false);
  // The call ends: the turn is renewed then, and goes stale as before when no beat follows.
  const t = LOCK_STALE * 10 + 500;
  holdRead(a, 1, t, false);
  expect(takeRead(b, 1, t + 1000)).toBe(false);
  expect(takeRead(b, 1, t + LOCK_STALE + 1)).toBe(true);
  leaveWindow(a);
  leaveWindow(b);
});

test("a side pane refused by an estimate made for another file at that path reads it on Retry, and says when a session is too large on its own", async () => {
  const file = fixture("--only", "1");
  fakeReader({ [file]: 60 });
  // What a pane found here before: far over the budget.
  windowState().files.set(file, [BUDGET * 2, 0]);
  const { v, cx } = openPane(file, { view: "pinned" });
  await until(() => v.refused, "the Pinned pane refusing");
  H.rec = [];
  v.render(cx);
  const said = H.rec.flatMap((e) => e.slice(1)).filter((x) => typeof x === "string").join(" ");
  H.rec = null;
  expect(said).toContain("larger than the memory budget of the Threads panes in this window on its own");
  expect(said).toContain("Open it in a Chat");
  v.retryRead(cx);
  await settle(v);
  expect(v.refused).toBeNull();
  expect(v.current().turns.length).toBe(60);
  expect(fileBytes(file, PANE_WEIGHT.pinned)).toBeLessThan(BUDGET);
}, 20000);

test("a side pane counts its own other sessions before it reads one: refused before any call, with the note to close a pane", async () => {
  const [fa, fb] = [fixture("--only", "1"), fixture("--only", "2")];
  const st = fakeReader({ [fa]: 60 });
  const { v, cx } = openPane(fa, { view: "pinned" });
  await settle(v);
  const mine = v.heldBytes();
  expect(mine).toBeGreaterThan(0);
  // Session b's estimate fits with the other panes, and not with this pane's session a too.
  const need = 100 * 1024;
  windowState().files.set(fb, [need, 0]);
  phantom(BUDGET - need - Math.floor(mine / 2));
  v.sessions.push(newSession("b", fb));
  const asked = st.asked.length;
  v.read(cx);
  expect(v.refused?.file).toBe(fb);
  await new Promise((r) => setTimeout(r, 20));
  expect(st.asked.length).toBe(asked);
  H.rec = [];
  v.render(cx);
  const said = H.rec.flatMap((e) => e.slice(1)).filter((x) => typeof x === "string").join(" ");
  H.rec = null;
  expect(said).toContain("Close another Threads pane to make room, then Retry");
}, 20000);

test("a read superseded after its chunk is applied counts that chunk before it ends", async () => {
  const file = fixture("--only", "1");
  fakeReader({ [file]: 60 }, 1000, 5);
  const { v, cx } = openPane(file);
  const real = performance.now;
  let t = 0;
  let superseded = false;
  // Every clock read is 20 ms on: the measure after the chunk yields after its second turn.
  performance.now = () => (t += 20);
  cx.sleepHook = () => {
    // The first yield with the chunk applied (its offset moved) is the measure's. The newer
    // read (readGen) is a retry's, as watchRead's or Retry's would be.
    const s = v.current();
    if (!superseded && s && s.offset > 0 && !s.partial) { superseded = true; v.readGen++; }
    return new Promise((r) => setTimeout(r, 0));
  };
  try {
    await until(() => superseded, "the read superseded");
    await new Promise((r) => setTimeout(r, 50));
  } finally { performance.now = real; cx.sleepHook = null; }
  const s = v.current();
  expect(s.turns.length).toBe(60);
  const w = PANE_WEIGHT.chat;
  const est = sessionBytes(s, w);
  expect(est).toBeGreaterThan(0);
  measure(s);
  expect(sessionBytes(s, w)).toBe(est);
}, 20000);

test("a press's pending open opens the turn under its new key when a trim comes before the timer", async () => {
  const { v, cx, trimNow } = await trimmedLater();
  v.rows();
  const due = cx.timers.length;
  v.openAfterPress("0:59", cx);
  const timer = cx.timers[due];
  expect(timer).toBeDefined();
  const { at } = trimNow();
  expect(v.openWait?.key).toBe(at(59));
  timer.fn(cx);
  expect(v.open.has(at(59))).toBe(true);
  expect(v.open.has("0:59")).toBe(false);
}, 20000);

test("a pin saved as the pane closes still reaches pins.json", async () => {
  const { v, cx } = await trimmedLater();
  delete H.recordFiles[PINS];
  v.togglePin("0:57", cx);
  v.savePins(cx);
  v.forget();
  await until(() => H.recordFiles[PINS] != null, "pins.json written");
  expect(H.recordFiles[PINS]).toContain("prompt 57");
}, 20000);

test("in a trimmed Chat the Pinned view's row gives the pin's number in the whole session", async () => {
  const { v, cx, trimNow } = await trimmedLater();
  const { k, at } = trimNow();
  v.togglePin(at(59), cx);
  v.setView("pinned");
  const row = v.rows().find((r) => r.compact);
  expect(row?.pinN).toBe(59);
  H.rec = [];
  v.render(cx);
  const said = H.rec.flatMap((e) => e.slice(1)).filter((x) => typeof x === "string");
  H.rec = null;
  expect(said).toContain("#59");
  expect(said).not.toContain(`#${59 - k}`);
}, 20000);

test("a Trajectory finds the turn a trimmed Chat selected by its id, under its own number", async () => {
  const file = fixture("--only", "1");
  fakeReader({ [file]: 60 });
  const { v } = openPane(file, { view: "trajectory" });
  await settle(v);
  const s = v.current();
  const id = turnId(s.turns, s.turns[58]);
  // The Chat dropped 40 turns: turn 59 is its 0:19.
  H.state.shared["threads.turnSel"] = { t4: { key: "0:19", id, by: "chat-copy", at: Date.now(), pane: "chat" } };
  v.syncSel();
  expect(v.tsel).toBe("0:59");
}, 20000);

test("a trim keeps a reader's place who is not following: a jump to the top row under its new key", async () => {
  const { v, trimNow } = await trimmedLater();
  v.rows();
  v.follow = false;
  v.toBottom = false;
  v.scrollTo = null;
  v.anchor = null;
  v.anchorDue = false;
  v.topKey = "0:58";
  const { at } = trimNow();
  expect(v.scrollTo).toEqual({ key: at(58), how: "top" });
}, 20000);

test("a trim that lets go of the top row's turn puts the tail's first turn at the top for a reader who is not following", async () => {
  const { v, trimNow } = await trimmedLater();
  v.rows();
  v.follow = false;
  v.toBottom = false;
  v.scrollTo = null;
  v.anchor = null;
  v.anchorDue = false;
  v.topKey = "md:0:2:0";
  trimNow();
  expect(v.topKey).toBeNull();
  expect(v.scrollTo).toEqual({ key: "0:1", how: "top" });
}, 20000);

test("a trim that lets go of a code editor without the keyboard leaves the one that has it", async () => {
  const { v, trimNow } = await trimmedLater();
  const ed = () => { const e = { handlers: {}, released: 0, on(n, f) { this.handlers[n] = f; }, release() { this.released++; } }; return e; };
  const [old, kept] = [ed(), ed()];
  v.code.set("0:3:0", { st: old, text: "x" });
  v.code.set("0:59:0", { st: kept, text: "y" });
  v.watchEditor(old);
  v.watchEditor(kept);
  kept.handlers.focus();
  expect(v.editorFocused).toBe(true);
  const { at } = trimNow();
  expect(old.released).toBe(1);
  expect(kept.released).toBe(0);
  expect(v.code.get(`${at(59)}:0`)?.st).toBe(kept);
  expect(v.editorFocused).toBe(true);
}, 20000);

test("a trimmed session that gains a turn without trimming again says the new counts in the kept note", async () => {
  const { v, trimNow } = await trimmedLater();
  trimNow(Math.floor(v.mem.bytes * 0.6));
  const s = v.current();
  // Two days, so a later build keeps the rows before the second (keptFrom).
  const half = Math.floor(s.turns.length / 2);
  s.turns.forEach((t, i) => { t.day = i < half ? "20261101" : "20261102"; });
  v.rows();
  expect(v.rowBuild?.multi).toBe(true);
  const before = v.baseRows;
  const noteAt = before.findIndex((r) => r.key === "tail:0");
  expect(noteAt).toBeGreaterThanOrEqual(0);
  const firstTurn = before.findIndex((r) => r.kind === "turn");
  for (const e of turnEvents(60, PAD)) apply(s, e);
  s.turns.at(-1).day = "20261102";
  v.rows();
  // The rows before the change were kept, the note among them with today's counts.
  expect(v.baseRows[firstTurn]).toBe(before[firstTurn]);
  expect(v.baseRows[noteAt].text).toBe(tailNote(tailOf(s)));
  expect(v.baseSizes.length).toBe(v.baseRows.length);
}, 20000);

// ---- the second review's findings ----

test("a final reply's text is counted once: its step is the same object as its entry in finals", () => {
  const s = newSession("s", "/x/f.jsonl");
  const T = new Date(Date.UTC(2026, 10, 1, 9)).toISOString();
  const answer = "a".repeat(10000);
  for (const e of [{ k: "p", o: "human", ts: T, t: "p" }, { k: "t", ts: T, t: answer, a: true }, { k: "u", ts: T, n: "Bash", id: "c1" }, { k: "d", ts: T, ms: 1 }]) apply(s, e);
  const t = s.turns[0];
  expect(t.finals?.length).toBe(1);
  expect(t.steps.includes(t.finals[0])).toBe(true);
  expect(t.finals[0].t).toBe(answer);
  const [text] = turnBytes(t);
  expect(text).toBeGreaterThanOrEqual(answer.length);
  expect(text).toBeLessThan(2 * answer.length);
}, 20000);

// A read superseded at its first yield in phase ("apply": with part of its chunk applied;
// "measure": with the chunk applied, in the measure after it).
// out.cx gets the pane's cx.
async function supersededIn(phase, out = {}) {
  const file = fixture("--only", "1");
  fakeReader({ [file]: 60 }, 1000, 5);
  const { v, cx } = openPane(file);
  out.cx = cx;
  const real = performance.now;
  let t = 0;
  let superseded = false;
  performance.now = () => (t += 20);
  cx.sleepHook = () => {
    const s = v.current();
    const now = phase === "apply" ? s?.partial : s && s.offset > 0 && !s.partial;
    if (!superseded && now) { superseded = true; v.readGen++; }
    return new Promise((r) => setTimeout(r, 0));
  };
  try {
    await until(() => superseded, "the read superseded");
    await new Promise((r) => setTimeout(r, 50));
  } finally { performance.now = real; cx.sleepHook = null; }
  return v;
}

test("a read superseded while it applies its chunk counts the turns it applied and publishes the pane's total", async () => {
  const v = await supersededIn("apply");
  const s = v.current();
  expect(s.partial).toBe(true);
  expect(s.turns.length).toBeGreaterThan(0);
  expect(s.turns.length).toBeLessThan(60);
  const w = PANE_WEIGHT.chat;
  const est = sessionBytes(s, w);
  expect(est).toBeGreaterThan(0);
  expect(v.mem.bytes).toBe(v.heldBytes());
  measure(s);
  expect(sessionBytes(s, w)).toBe(est);
}, 20000);

test("a read superseded in the measure after its chunk publishes the pane's total before it lets go of the window's turn", async () => {
  const v = await supersededIn("measure");
  expect(v.current().turns.length).toBe(60);
  expect(v.mem.bytes).toBeGreaterThan(0);
  expect(v.mem.bytes).toBe(v.heldBytes());
}, 20000);

// A newer read in the same pane on the same session (a retry, watchRead's) is the one that
// holds it to the budget: the session's half-applied chunk is started over (s.partial) before
// its first call, and its first chunk's guard trims it.
test("a read superseded while it applies its chunk, past the budget: the next read starts the session over before its first call, and its first guard trims it", async () => {
  windowState().panes.clear();
  const out = {};
  const v = await supersededIn("apply", out);
  const s = v.current();
  expect(s.partial).toBe(true);
  const applied = s.turns.length;
  expect(applied).toBeGreaterThan(1);
  // The window has room for half of what the session holds now.
  phantom(BUDGET - windowBytes(v.mem) - Math.floor(v.heldBytes() / 2));
  expect(v.heldBytes()).toBeGreaterThan(BUDGET - windowBytes(v.mem));
  const inner = H.extractHook;
  let first = null;
  H.extractHook = async (args) => {
    first ??= { turns: s.turns.length, partial: s.partial };
    return inner(args);
  };
  // supersededIn only moves readGen on, and the read it stopped leaves its flags to the newer
  // read, so the pane still says it is reading: let go of them as watchRead does when it
  // supersedes a read, or read() only asks for another and nothing reads.
  expect(v.reading).toBe(true);
  v.reading = false;
  v.readAgain = false;
  v.readWaiting = false;
  v.readBeat = null;
  v.read(out.cx);
  await settle(v);
  expect(first).toEqual({ turns: 0, partial: false });
  expect(s.partial).toBe(false);
  expect(tailOf(s)).not.toBeNull();
  expect(v.heldBytes()).toBeLessThanOrEqual(BUDGET - windowBytes(v.mem));
  expect(v.mem.bytes).toBe(v.heldBytes());
}, 20000);

// A read a /clear supersedes while it applies its chunk. The hook gives the newer session two
// turns and builds the rows of both, the older one's above; the window has room for the newer
// session and half of what the older one holds. A reader is up in the list on the newer
// session's second turn, not following, with the row window from the older session's first
// turn (which goes) to the newer one's. ready(v, s), if given, runs then too.
async function clearMidChunk(ready = null) {
  windowState().panes.clear();
  const file = fixture("--only", "1");
  const next = fixture("--only", "2");
  fakeReader({ [file]: 60, [next]: 3 }, 1000, 5);
  const { v, cx } = openPane(file);
  const real = performance.now;
  let t = 0;
  const out = { v, cx, s2: null, held: 0, room: 0, both: null };
  performance.now = () => (t += 20);
  cx.sleepHook = () => {
    const s = v.current();
    if (!out.s2 && s?.partial && s.turns.length > 3) {
      const s2 = newSession("s2", next);
      for (let i = 0; i < 2; i++) for (const e of turnEvents(i)) apply(s2, e);
      v.sessions.push(s2);
      measure(s);
      measure(s2);
      const w = PANE_WEIGHT.chat;
      phantom(BUDGET - windowBytes(v.mem) - (sessionBytes(s2, w) + Math.floor(sessionBytes(s, w) / 2)));
      out.held = v.heldBytes();
      out.room = BUDGET - windowBytes(v.mem);
      v.rows();
      out.both = [v.baseRows?.some((r) => r.si === 0 && r.turn), v.baseRows?.some((r) => r.si === 1 && r.turn?.n === 2)];
      v.follow = false;
      v.toBottom = false;
      v.scrollTo = null;
      v.topKey = "1:2";
      v.sel = "1:2";
      v.win.from = "0:1";
      v.win.to = "1:2";
      ready?.(v, s);
      out.s2 = s2;
    }
    return new Promise((r) => setTimeout(r, 0));
  };
  try {
    await until(() => out.s2, "the /clear");
    await new Promise((r) => setTimeout(r, 50));
  } finally { performance.now = real; cx.sleepHook = null; }
  out.s = v.sessions[0];
  return out;
}

// Red at ae69b5c9: the older session kept every turn it applied, past the budget, and only the
// newer session's guard could trim, which trims the newer session.
test("a read a /clear supersedes while it applies its chunk lets the older session's excess go, and leaves the newer session's keys and place", async () => {
  const { v, cx, s, s2, held, room, both } = await clearMidChunk();
  expect(both).toEqual([true, true]);
  expect(held).toBeGreaterThan(room);
  expect(s.partial).toBe(true);
  // The older session keeps the newest turns that fit beside the newer one, at least one.
  const tail = tailOf(s);
  expect(tail).not.toBeNull();
  expect(tail.shown).toBeGreaterThan(0);
  expect(v.heldBytes()).toBeLessThanOrEqual(room);
  expect(v.mem.bytes).toBe(v.heldBytes());
  // The newer session's keys and place are as they were: the list goes back to its top row,
  // and its rows stay in the window, from the older session's first kept turn.
  expect(v.topKey).toBe("1:2");
  expect(v.sel).toBe("1:2");
  expect(v.scrollTo).toEqual({ key: "1:2", how: "top" });
  expect([v.win.from, v.win.to]).toEqual(["0:1", "1:2"]);
  expect(v.current()).toBe(s2);
  expect(s2.turns.length).toBe(2);
  expect(() => v.render(cx)).not.toThrow();
}, 20000);

// Red at 145573e5: the jump was dropped with its turn, and nothing kept the top row.
test("a jump on its way to an older turn the trim lets go leaves the reader's top row kept", async () => {
  const { v } = await clearMidChunk((v) => { v.scrollTo = { key: "0:1", how: "top" }; });
  expect(tailOf(v.sessions[0])).not.toBeNull();
  expect(v.scrollTo).toEqual({ key: "1:2", how: "top" });
}, 20000);

// Red at 145573e5: the link rules' memo and the Markdown heights kept the text of the older
// session's turns the trim let go.
test("a trim of the older session lets go of the text of its turns that went: the link rules' memo and the Markdown heights", async () => {
  let gone = null;
  const { v } = await clearMidChunk((v, s) => {
    gone = s.turns[0].prompt;
    v.applyPrefs(JSON.stringify({ links: [{ name: "Issue", pattern: "\\bprompt (\\d+)\\b", url: "https://linear.example/P-$1" }] }));
    v.linkedSegs("0:1", [{ kind: "md", text: gone }]);
    v.mdHeight(gone);
  });
  expect(gone).toContain(PAD);
  expect(tailOf(v.sessions[0])).not.toBeNull();
  // Whether x holds that text, through Maps (keys too), Sets, arrays and own values; the
  // sessions not walked (the kept turns are theirs).
  const skip = new Set([v.sessions, ...v.sessions]);
  const holds = (x, depth = 12, seen = new Set()) => {
    if (typeof x === "string") return x.includes(gone);
    if (!x || typeof x !== "object" || depth <= 0 || seen.has(x) || skip.has(x)) return false;
    seen.add(x);
    const d = depth - 1;
    if (x instanceof Map) return [...x].some(([k, y]) => holds(k, d, seen) || holds(y, d, seen));
    if (x instanceof Set || Array.isArray(x)) return [...x].some((y) => holds(y, d, seen));
    return Object.keys(x).some((k) => holds(x[k], d, seen));
  };
  expect(Object.keys(v).filter((k) => k !== "sessions" && holds(v[k]))).toEqual([]);
}, 20000);

// Red at 145573e5: the preview landed after the refusal and wrote the prompt back.
test("a preview still being read when its side pane refuses the session is not kept", async () => {
  windowState().panes.clear();
  const file = fixture("--only", "1");
  fakeReader({ [file]: 60 });
  const { v, cx } = openPane(file, { view: "pinned" });
  await settle(v);
  const s = v.current();
  let asked = null;
  let land = null;
  const held = new Promise((r) => { land = r; });
  H.extractHook = async (args) => {
    asked = args;
    await held;
    return { code: 0, stdout: `${JSON.stringify({ k: "p", o: "human", ts: ts(0), t: "QZPEEKMARK the newest prompt" })}\n`, stderr: "" };
  };
  // The loading state, and a file past one chunk: openPeek reads the file's end.
  v.opening = { list: v.sessions, at: Date.now(), painted: true, done: false, pct: null, peek: false, v: null, stats: null, newest: null, mtime: null };
  s.size = 64 * MiB;
  v.openPeek(s, cx);
  await until(() => asked, "the preview asked for");
  phantom(BUDGET);
  expect(v.guard(s)).toBe(true);
  expect(v.refusedNow()).toBe(true);
  land();
  await new Promise((r) => setTimeout(r, 30));
  expect(v.opening.newest).toBeNull();
  expect(() => v.render(cx)).not.toThrow();
}, 20000);

test("the chunk size is chosen once the read has the window's turn: the window passing half the budget in between gives the smaller chunk", async () => {
  const MiB = 1024 * 1024;
  const file = fixture("--only", "1");
  const st = fakeReader({ [file]: 1000 }, 16000);
  const { v, cx } = openPane(file);
  let raised = false;
  // Right after the read chose its third chunk (8 MiB), before it asks for the window's turn:
  // the other panes now hold over half the budget.
  cx.notifyHook = () => {
    if (!raised && st.asked.length === 2 && v.current()?.offset > 3 * MiB) { raised = true; phantom(BUDGET * 0.6); }
  };
  await until(() => st.asked.length >= 3, "the third chunk asked for");
  cx.notifyHook = null;
  expect(raised).toBe(true);
  expect(st.asked[1][2]).toBe(4 * MiB);
  expect(st.asked[2][2]).toBe(TIGHT_CHUNK);
}, 20000);

test("a trim keeps the reader's place while a re-wrap's held place is due or taken: the trim lets that go", async () => {
  for (const held of ["due", "taken"]) {
    // The first pass's pane and its made-up neighbour leave the window.
    windowState().panes.clear();
    const { v, trimNow } = await trimmedLater();
    v.rows();
    v.follow = false;
    v.toBottom = false;
    v.scrollTo = null;
    v.anchorDue = held === "due";
    v.anchor = held === "taken" ? { key: "md:0:58:0", turn: "0:58", share: 0, off: 0, held: new Map(), wheels: 0 } : null;
    v.topKey = "0:58";
    const { at } = trimNow();
    expect(v.anchor).toBeNull();
    expect(v.anchorDue).toBe(false);
    expect(v.scrollTo).toEqual({ key: at(58), how: "top" });
  }
}, 40000);

test("leaving the Select view gives the keyboard back to the pane only when no code editor has it", async () => {
  const { v } = await trimmedLater();
  const ed = () => ({ handlers: {}, released: 0, on(n, f) { this.handlers[n] = f; }, release() { this.released++; } });
  const [sel, code] = [ed(), ed()];
  v.watchEditor(sel);
  v.watchEditor(code);
  v.selEditor = { key: "0:3", st: sel, text: "x" };
  v.code.set("0:59:0", { st: code, text: "y" });
  code.handlers.focus();
  v.endSelect();
  expect(sel.released).toBe(1);
  expect(v.editorFocused).toBe(true);
  expect(v.focusedEd).toBe(code);
  // The Select view's own editor had it: the pane has it again.
  const sel2 = ed();
  v.watchEditor(sel2);
  v.selEditor = { key: "0:4", st: sel2, text: "z" };
  sel2.handlers.focus();
  v.endSelect();
  expect(v.editorFocused).toBe(false);
  expect(v.focusedEd).toBeNull();
}, 20000);

// Red at ae69b5c9: the link rules' memo and the Markdown heights still held the replies' text.
// Red at 145573e5: the sender rule's count still held the session's last turn it read.
test("a side pane that refuses a session it has read lets go of everything built from its turns, and of its text", async () => {
  const file = fixture("--only", "1");
  // Each prompt and reply carries a mark found nowhere else, so a string that holds one was
  // made from the session.
  const markP = (i) => `QZPROMPTMARK${i}`;
  const markR = (i) => `QZREPLYMARK${i}`;
  const per = 1000;
  H.extractHook = async (args) => {
    if (args[1] !== file) return null;
    const n = 60;
    const off = Number(args[2]);
    const a = Math.floor(off / per);
    const b = Math.min(n, Math.floor((off + Number(args[3])) / per));
    const lines = [{ k: "file", size: n * per }, { k: "chunk", used: Math.max(0, b - a) * per }];
    for (let i = a; i < b; i++) {
      lines.push({ k: "p", o: "human", ts: ts(i), t: `${markP(i)} asks about ACME-${i}${PAD}` });
      lines.push({ k: "t", ts: ts(i), t: `${markR(i)} answers, see ACME-${i}.\n\nA second paragraph of ${markR(i)}.` });
      lines.push({ k: "d", ts: ts(i), ms: 1000 });
    }
    return { code: 0, stdout: `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`, stderr: "" };
  };
  const { v, cx } = openPane(file, { view: "trajectory" });
  await settle(v);
  v.applyPrefs(JSON.stringify({ links: [{ name: "Issue", pattern: "\\bACME-(\\d+)\\b", url: "https://linear.example/ACME-$1" }] }));
  expect(v.links.length).toBe(1);
  for (let i = 0; i < 5; i++) v.render(cx);
  const s = v.current();
  const old = new Set(s.turns);
  // What a Pinned pane's open reply builds from its text: the link rules on its segments
  // (linkedSegs) and its Markdown's height (mdHeight).
  const last = s.turns[s.turns.length - 1];
  const textIn = (x, depth = 4) => {
    if (typeof x === "string") return x.includes("QZREPLYMARK") ? x : null;
    if (!x || typeof x !== "object" || depth <= 0) return null;
    for (const y of Array.isArray(x) ? x : Object.values(x)) { const t = textIn(y, depth - 1); if (t) return t; }
    return null;
  };
  const reply = textIn(last);
  expect(reply).toContain("QZREPLYMARK");
  expect(v.linkedSegs(`0:${last.n}`, [{ kind: "md", text: reply }])).not.toBeNull();
  v.mdHeight(reply);
  // The other caches of the session's text: a call's input and output and its output's
  // editor, the running answer's cut, and the loading state's newest prompt.
  v.calls.set(`${file}#toolu_mark`, { st: "ok", input: `${markP(0)} input`, out: `${markR(0)} output`, ver: s.version });
  v.outEds = new Map([[`cout:0:${last.n}:0:0`, { st: false, text: `${markR(0)} output` }]]);
  v.cutKept = { key: `0:${last.n}`, text: reply, ver: "", segs: [{ kind: "md", text: reply }], cut: [], left: 0 };
  // The sender rule's count, as its editor draws it: it holds the last turn it read.
  v.senderMatches({ re: /QZPROMPTMARK/, named: false });
  expect(v.senderHits?.per?.[0]?.last).toBeTruthy();
  v.opening = { ...(v.opening ?? { list: v.sessions, at: Date.now(), painted: true, done: true, pct: null, peek: false, v: null, stats: null, mtime: null }), newest: { text: `${markP(0)} newest`, ts: null } };
  const marked = (x) => typeof x === "string" && (x.includes("QZPROMPTMARK") || x.includes("QZREPLYMARK"));
  // Whether x reaches one of the session's turns before the refusal, or a string made from
  // its text, through Maps (keys too), Sets, arrays and own values (the sessions themselves
  // not walked: restart empties them).
  const skip = new Set([v.sessions, ...v.sessions]);
  const reaches = (x, depth = 12, seen = new Set()) => {
    if (old.has(x) || marked(x)) return true;
    if (!x || typeof x !== "object" || depth <= 0 || seen.has(x) || skip.has(x)) return false;
    seen.add(x);
    const d = depth - 1;
    if (x instanceof Map) return [...x].some(([k, y]) => reaches(k, d, seen) || reaches(y, d, seen));
    if (x instanceof Set || Array.isArray(x)) return [...x].some((y) => reaches(y, d, seen));
    return Object.keys(x).some((k) => reaches(x[k], d, seen));
  };
  const holding = () => Object.keys(v).filter((k) => k !== "sessions" && reaches(v[k]));
  expect(holding().length).toBeGreaterThan(0);
  phantom(BUDGET);
  expect(v.guard(s)).toBe(true);
  expect(v.refused?.file).toBe(file);
  expect(s.turns.length).toBe(0);
  expect(holding()).toEqual([]);
  expect(v.calls.has(`${file}#toolu_mark`)).toBe(false);
  expect(v.outEds).toBeNull();
  expect(v.cutKept).toBeNull();
  expect(v.opening.newest).toBeNull();
  expect(() => v.render(cx)).not.toThrow();
}, 20000);
