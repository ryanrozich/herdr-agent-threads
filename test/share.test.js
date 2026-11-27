// bun test: one copy of a session per window (budget.js holdSession). Panes that show one
// transcript share one parsed session: one pane reads it, the others follow its turns and keep
// their own rows, keys and place, and the window's budget counts the copy once.
import { test, expect } from "bun:test";
import {
  BUDGET, BASE_WEIGHT, VIEW_WEIGHT, PANE_WEIGHT, sessionBytes, tailOf, windowState, windowBytes, holdersOf,
} from "../mods/agent-threads/budget.js";
import { fixture, H, makeCx, settle, setup, Threads, unsliced, until } from "./render-harness.js";

setup();

const ts = (i) => new Date(Date.UTC(2026, 10, 1, 9) + i * 60000).toISOString();
const PAD = " xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const turnEvents = (i) => [{ k: "p", o: "human", ts: ts(i), t: `prompt ${i + 1}${PAD}` }, { k: "t", ts: ts(i), t: `reply ${i + 1}` }, { k: "d", ts: ts(i), ms: 1000 }];
const phantom = (bytes) => { const e = { gen: null, ref: null, kind: "chat", bytes, pane: null, beat: Date.now() }; windowState().panes.add(e); return e; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = (p) => { for (const x of p.cx.everies) if (x.ms === 1000) x.fn(p.cx); };

// The extractor's answers for made-up sessions of n turns, `per` bytes each, by file; every call
// is kept as [file, offset, chunk].
function fakeReader(sessions, per = 1000, delay = 0) {
  const st = { asked: [] };
  H.extractHook = async (args) => {
    const n = sessions[args[1]];
    if (n == null) return null;
    const off = Number(args[2]);
    const chunk = Number(args[3]);
    st.asked.push([args[1], off, chunk]);
    await sleep(delay);
    const a = Math.floor(off / per);
    const b = Math.min(n, Math.floor((off + chunk) / per));
    const lines = [{ k: "file", size: n * per }, { k: "chunk", used: Math.max(0, b - a) * per }];
    for (let i = a; i < b; i++) lines.push(...turnEvents(i));
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
const callsOf = (st, file) => st.asked.filter((x) => x[0] === file).map((x) => x[1]);

test("a Chat, a Pinned and a Trajectory pane on one transcript share one session, and the window counts it once", async () => {
  const file = fixture("--only", "1");
  const st = fakeReader({ [file]: 60 });
  const chat = openPane(file);
  await settle(chat.v);
  const asked = st.asked.length;
  const pin = openPane(file, { view: "pinned" });
  const traj = openPane(file, { view: "trajectory" });
  await settle(pin.v);
  await settle(traj.v);
  const s = chat.v.current();
  expect(s.turns.length).toBe(60);
  expect(pin.v.current()).toBe(s);
  expect(traj.v.current()).toBe(s);
  expect(holdersOf(s)).toBe(3);
  // The side panes found it read in full: no call of their own.
  expect(st.asked.length).toBe(asked);
  // Once, at the session's weight and each pane's view of it.
  const w = BASE_WEIGHT + VIEW_WEIGHT.chat + VIEW_WEIGHT.pinned + VIEW_WEIGHT.trajectory;
  expect(Math.abs(windowBytes() - sessionBytes(s, w))).toBeLessThan(2);
  const apart = sessionBytes(s, PANE_WEIGHT.chat) + sessionBytes(s, PANE_WEIGHT.pinned) + sessionBytes(s, PANE_WEIGHT.trajectory);
  expect(windowBytes()).toBeLessThan(apart * 0.6);
  // Each pane's own sum is the whole copy: none of it is outside the window's.
  for (const p of [chat, pin, traj]) expect(Math.abs(p.v.heldBytes() - windowBytes())).toBeLessThan(2);
  // One pane alone weighs what it did before the copy was shared.
  expect(BASE_WEIGHT + VIEW_WEIGHT.pinned).toBeCloseTo(PANE_WEIGHT.pinned, 5);
  for (const p of [chat, pin, traj]) expect(() => p.v.render(p.cx)).not.toThrow();
}, 20000);

test("a side pane opened while the Chat reads makes no extractor call: every offset is asked once, and it follows to the end", async () => {
  const file = fixture("--only", "1");
  const st = fakeReader({ [file]: 1000 }, 16000, 10);
  const chat = openPane(file);
  await until(() => chat.v.current()?.offset > 0, "the Chat's first chunk");
  const s = chat.v.current();
  expect(s.loaded).toBeFalsy();
  const pin = openPane(file, { view: "pinned" });
  expect(pin.v.current()).toBe(s);
  await until(() => pin.v.readFollowing, "the Pinned pane following");
  await settle(chat.v, 800);
  await settle(pin.v, 800);
  expect(s.turns.length).toBe(1000);
  const offs = callsOf(st, file);
  expect(new Set(offs).size).toBe(offs.length);
  expect(pin.v.reading).toBeFalsy();
  // Its next draw follows the read: the newest turn, as the Chat's own read ends.
  pin.v.render(pin.cx);
  expect(pin.v.shareSeen?.n).toBe(1000);
}, 60000);

test("the reading pane closes mid-read: the session stays whole for the other pane, which goes on from where it was", async () => {
  const file = fixture("--only", "1");
  const st = fakeReader({ [file]: 1000 }, 16000, 10);
  const chat = openPane(file);
  await until(() => chat.v.current()?.offset > 0, "the Chat's first chunk");
  const s = chat.v.current();
  const pin = openPane(file, { view: "pinned" });
  await until(() => pin.v.readFollowing, "the Pinned pane following");
  chat.v.close();
  expect(chat.v.forgotten).toBe(true);
  expect(s.file).toBe(file);
  expect(holdersOf(s)).toBe(1);
  // Its 1 s timer sees no reader and reads on.
  for (let i = 0; i < 400 && !(s.loaded && !pin.v.reading); i++) { tick(pin); await sleep(25); }
  // A chunk the Chat had half applied is read again from the top (read: s.partial).
  expect(pin.v.current()).toBe(s);
  expect(s.turns.length).toBe(1000);
  expect(s.turns.map((t) => t.n)).toEqual(Array.from({ length: 1000 }, (_, i) => i + 1));
  expect(callsOf(st, file).length).toBeGreaterThan(1);
}, 60000);

test("a trim of the shared session moves every pane's keys and rows with their turns", async () => {
  const file = fixture("--only", "1");
  fakeReader({ [file]: 60 });
  const chat = openPane(file);
  await settle(chat.v);
  // A second Threads pane on the same terminal follows it, rows and all; a Trajectory too.
  const other = openPane(file);
  const traj = openPane(file, { view: "trajectory" });
  await settle(other.v);
  await settle(traj.v);
  const s = chat.v.current();
  expect(other.v.current()).toBe(s);
  const t = s.turns[58];
  for (const p of [chat, other, traj]) { p.v.sel = "0:59"; p.v.open.add("0:59"); p.v.follow = false; }
  other.v.rows();
  expect(other.v.baseRows.some((r) => r.turn === t)).toBe(true);
  // The window just full, and the transcript grows: the Chat's read trims the copy.
  phantom(BUDGET - windowBytes() - 1);
  fakeReader({ [file]: 70 });
  chat.v.read(chat.cx);
  await settle(chat.v);
  const tail = tailOf(s);
  expect(tail).not.toBeNull();
  expect(tail.of).toBe(70);
  expect(s.turns).toContain(t);
  expect(t.n).toBeLessThan(59);
  for (const p of [chat, other, traj]) {
    expect(p.v.sel).toBe(`0:${t.n}`);
    expect(p.v.open.has(`0:${t.n}`)).toBe(true);
    expect(p.v.current()).toBe(s);
  }
  // The follower's rows on screen are the tail's, under the new numbers, until its rebuild.
  const kept = new Set(s.turns);
  const rows = other.v.baseRows ?? [];
  for (const r of rows) if (r.turn && r.si === 0) expect(kept.has(r.turn)).toBe(true);
  const row = rows.find((r) => r.turn === t && r.key === `0:${t.n}`);
  expect(row).toBeTruthy();
  expect(windowBytes()).toBeLessThanOrEqual(BUDGET);
  for (const p of [chat, other, traj]) expect(() => p.v.render(p.cx)).not.toThrow();
}, 20000);

test("a /clear in a Chat with a Pinned pane: both move to one copy of the new session and keep one copy of the old one", async () => {
  const [f1, f2] = [fixture("--only", "1"), fixture("--only", "2")];
  const st = fakeReader({ [f1]: 30, [f2]: 400 }, 16000, 5);
  const chat = openPane(f1);
  await settle(chat.v);
  const pin = openPane(f1, { view: "pinned" });
  await settle(pin.v);
  const old = chat.v.current();
  expect(pin.v.current()).toBe(old);
  const r = { kind: "found", id: "made-up-second", file: f2, live: true };
  chat.v.adopt(r, chat.cx);
  await until(() => chat.v.current()?.offset > 0, "the Chat's first chunk of the new session");
  pin.v.adopt(r, pin.cx);
  await settle(chat.v, 800);
  await settle(pin.v, 800);
  const s = chat.v.current();
  expect(s).not.toBe(old);
  expect(pin.v.current()).toBe(s);
  expect(chat.v.sessions).toEqual([old, s]);
  expect(pin.v.sessions).toEqual([old, s]);
  expect(s.turns.length).toBe(400);
  const offs = callsOf(st, f2);
  expect(new Set(offs).size).toBe(offs.length);
  const w = BASE_WEIGHT + VIEW_WEIGHT.chat + VIEW_WEIGHT.pinned;
  expect(Math.abs(windowBytes() - sessionBytes(old, w) - sessionBytes(s, w))).toBeLessThan(2);
  pin.v.render(pin.cx);
  expect(pin.v.shareSeen?.s).toBe(s);
}, 60000);

test("the last pane on a session empties it as it closes; one that closes before it leaves it whole", async () => {
  const file = fixture("--only", "1");
  fakeReader({ [file]: 60 });
  const chat = openPane(file);
  await settle(chat.v);
  const pin = openPane(file, { view: "pinned" });
  await settle(pin.v);
  const s = chat.v.current();
  const turns = s.turns;
  chat.v.close();
  expect(turns.length).toBe(60);
  expect(pin.v.current()).toBe(s);
  expect(Math.abs(windowBytes() - sessionBytes(s, BASE_WEIGHT + VIEW_WEIGHT.pinned))).toBeLessThan(2);
  pin.v.close();
  expect(turns.length).toBe(0);
  expect(windowState().shared.size).toBe(0);
  expect(windowBytes()).toBe(0);
}, 20000);
