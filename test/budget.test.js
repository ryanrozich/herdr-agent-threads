// bun test: the window's memory guard (budget.js), as data and in panes on the render harness
// (test/render-harness.js): the estimate, the tail a session keeps past the budget, the side
// panes that read nothing, one read at a time, the smaller chunks, and what a closed or
// replaced copy gives back.
import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { newSession, apply, parseChunk } from "../mods/agent-threads/core/turns.js";
import {
  BUDGET, TIGHT_CHUNK, PANE_WEIGHT, LOCK_STALE, QUEUE_STALE, GHOST_MS, measure, sessionBytes, trim, tailOf, tailNote, gut, windowState,
  joinWindow, leaveWindow, windowBytes, noteFile, fileBytes, releaseOlder, sweepGhosts, takeRead, dropRead,
} from "../mods/agent-threads/budget.js";
import { fixture, H, makeCx, modDir, settle, setup, Threads, unsliced, until } from "./render-harness.js";

setup();

const MiB = 1024 * 1024;
const ts = (i) => new Date(Date.UTC(2026, 10, 1, 9) + i * 60000).toISOString();
const turnEvents = (i, text = "") => [{ k: "p", o: "human", ts: ts(i), t: `prompt ${i + 1}${text}` }, { k: "t", ts: ts(i), t: `reply ${i + 1}` }, { k: "d", ts: ts(i), ms: 1000 }];
const sessionOf = (n, text = "") => { const s = newSession("s", "/x/s.jsonl"); for (let i = 0; i < n; i++) for (const e of turnEvents(i, text)) apply(s, e); return s; };
// Another pane of the window, holding bytes.
const phantom = (bytes) => { const e = { gen: null, ref: null, kind: "chat", bytes, pane: null, beat: Date.now() }; windowState().panes.add(e); return e; };

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
    for (let i = a; i < b; i++) lines.push(...turnEvents(i, " xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"));
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
  const now = Date.now();
  ghost.beat = now - GHOST_MS + 100;
  expect(sweepGhosts(mine, now)).toBe(0); // still beating
  other.beat = now - 2 * GHOST_MS;
  ghost.beat = now - 2 * GHOST_MS;
  expect(sweepGhosts(mine, now)).toBe(1);
  expect(forgot).toEqual(["old", "ghost"]);
  expect(windowState().panes.has(other)).toBe(true); // another pane's copy is not this one's
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
  expect(v.win.bytes).toBeLessThanOrEqual(100 * 1024);
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
  expect(t.v.win.bytes).toBe(0);
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
  expect(a.v.win.bytes).toBeGreaterThan(0);
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
  b.v.win.gen = {};
  releaseOlder();
  expect(b.v.forgotten).toBe(true);
  expect(windowState().panes.size).toBe(0);
}, 20000);
