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

// What a pane's view of s adds: its weight times the session's fixed bytes.
const viewOf = (s, kind) => VIEW_WEIGHT[kind] * (sessionBytes(s, 1) - sessionBytes(s, 0));

test("a Chat that joins a Pinned pane's copy, read in full, past the budget trims it with no call of its own", async () => {
  const file = fixture("--only", "1");
  const st = fakeReader({ [file]: 60 });
  const pin = openPane(file, { view: "pinned" });
  await settle(pin.v);
  const s = pin.v.current();
  phantom(BUDGET - windowBytes() - Math.floor(viewOf(s, "chat") / 2));
  const asked = st.asked.length;
  const chat = openPane(file);
  await settle(chat.v);
  expect(chat.v.current()).toBe(s);
  expect(pin.v.current()).toBe(s);
  expect(st.asked.length).toBe(asked);
  expect(tailOf(s)?.of).toBe(60);
  expect(windowBytes()).toBeLessThanOrEqual(BUDGET);
  expect(pin.v.refused).toBeFalsy();
  for (const p of [chat, pin]) expect(() => p.v.render(p.cx)).not.toThrow();
}, 20000);

test("a side pane that joins past the budget stands back alone, the pane already on it keeps it, and Retry takes the copy back once there is room", async () => {
  const file = fixture("--only", "1");
  const st = fakeReader({ [file]: 60 });
  const pin = openPane(file, { view: "pinned" });
  await settle(pin.v);
  const s = pin.v.current();
  const room = phantom(BUDGET - windowBytes() - Math.floor(viewOf(s, "trajectory") / 2));
  const traj = openPane(file, { view: "trajectory" });
  await until(() => traj.v.refused, "the Trajectory standing back");
  expect(traj.v.refusedNow()).toBe(true);
  expect(traj.v.current()).not.toBe(s);
  expect(traj.v.current().turns.length).toBe(0);
  expect(pin.v.refused).toBeFalsy();
  expect(pin.v.current()).toBe(s);
  expect(s.turns.length).toBe(60);
  expect(tailOf(s)).toBeNull();
  expect(holdersOf(s)).toBe(1);
  expect(windowBytes()).toBeLessThanOrEqual(BUDGET);
  for (const p of [pin, traj]) expect(() => p.v.render(p.cx)).not.toThrow();
  // Room made: Retry follows the Pinned pane's copy, with no call.
  windowState().panes.delete(room);
  const asked = st.asked.length;
  traj.v.retryRead(traj.cx);
  expect(traj.v.current()).toBe(s);
  expect(traj.v.refused).toBeNull();
  expect(holdersOf(s)).toBe(2);
  expect(st.asked.length).toBe(asked);
  expect(() => traj.v.render(traj.cx)).not.toThrow();
}, 20000);

test("a Trajectory opened while the Chat reads follows it: no call of its own, a heading for every turn, and again after a trim", async () => {
  const file = fixture("--only", "1");
  const st = fakeReader({ [file]: 200 }, 16000, 10);
  const chat = openPane(file);
  await until(() => chat.v.current()?.offset > 0, "the Chat's first chunk");
  const s = chat.v.current();
  const traj = openPane(file, { view: "trajectory" });
  expect(traj.v.current()).toBe(s);
  await until(() => traj.v.readFollowing, "the Trajectory following");
  expect(traj.v.unread()).toBe(true);
  await settle(chat.v, 800);
  await settle(traj.v, 800);
  const offs = callsOf(st, file);
  expect(new Set(offs).size).toBe(offs.length);
  expect(traj.v.unread()).toBe(false);
  const heads = () => traj.v.ledger().rows.filter((r) => r.kind === "trh").map((r) => r.key);
  expect(() => traj.v.render(traj.cx)).not.toThrow();
  expect(heads().length).toBe(200);
  expect(heads().at(-1)).toBe("0:200");
  // The window just full, and the transcript grows: the Chat's read trims the copy, and the
  // Trajectory's ledger is the tail's, under the new numbers.
  phantom(BUDGET - windowBytes() - 1);
  fakeReader({ [file]: 220 }, 16000);
  chat.v.read(chat.cx);
  await settle(chat.v, 800);
  expect(tailOf(s)?.of).toBe(220);
  expect(traj.v.current()).toBe(s);
  expect(traj.v.refused).toBeFalsy();
  expect(() => traj.v.render(traj.cx)).not.toThrow();
  expect(heads().length).toBe(s.turns.length);
  expect(heads().at(-1)).toBe(`0:${s.turns.length}`);
  expect(windowBytes()).toBeLessThanOrEqual(BUDGET);
}, 60000);

test("a Pinned pane beside a Chat being trimmed keeps the copy, and each pane's keys move by its own place for the session", async () => {
  const [f1, f2] = [fixture("--only", "1"), fixture("--only", "2")];
  fakeReader({ [f1]: 5, [f2]: 60 });
  const chat = openPane(f1);
  await settle(chat.v);
  const pin = openPane(f2, { view: "pinned" });
  await settle(pin.v);
  const s = pin.v.current();
  // The agent's /clear: the Chat moves to the session the Pinned pane shows.
  chat.v.adopt({ kind: "found", id: s.id, file: f2, live: true }, chat.cx);
  expect(chat.v.sessions.length).toBe(2);
  expect(chat.v.current()).toBe(s);
  const t = s.turns[58];
  chat.v.sel = "1:59";
  pin.v.sel = "0:59";
  for (const p of [chat, pin]) p.v.follow = false;
  phantom(BUDGET - windowBytes() - 1);
  fakeReader({ [f1]: 5, [f2]: 70 });
  chat.v.read(chat.cx);
  await settle(chat.v);
  expect(tailOf(s)?.of).toBe(70);
  expect(s.turns).toContain(t);
  expect(t.n).toBeLessThan(59);
  expect(pin.v.refused).toBeFalsy();
  expect(pin.v.current()).toBe(s);
  expect(chat.v.sel).toBe(`1:${t.n}`);
  expect(pin.v.sel).toBe(`0:${t.n}`);
  expect(windowBytes()).toBeLessThanOrEqual(BUDGET);
  for (const p of [chat, pin]) expect(() => p.v.render(p.cx)).not.toThrow();
}, 20000);

// A side pane's whole read of file, then closed: the copy's estimate stays for the next read to
// be judged by (budget.js noteFile), with its cost and a Trajectory's view of it.
async function measured(file) {
  const a = openPane(file, { view: "pinned" });
  await settle(a.v, 800);
  const s = a.v.current();
  const out = { cost: windowBytes(), view: viewOf(s, "trajectory"), n: s.turns.length };
  a.v.close();
  expect(windowBytes()).toBe(0);
  return out;
}

test("a Trajectory that joins a Pinned pane mid-read stands back once the read passes the budget, and the Pinned pane reads on to the end", async () => {
  const file = fixture("--only", "1");
  fakeReader({ [file]: 200 }, 16000);
  const m = await measured(file);
  phantom(BUDGET - m.cost - Math.floor(m.view / 2));
  const st = fakeReader({ [file]: 200 }, 16000, 10);
  const pin = openPane(file, { view: "pinned" });
  await until(() => pin.v.current()?.offset > 0, "the Pinned pane's first chunk");
  const s = pin.v.current();
  const traj = openPane(file, { view: "trajectory" });
  expect(traj.v.current()).toBe(s);
  await until(() => traj.v.refused, "the Trajectory standing back");
  await settle(pin.v, 800);
  expect(traj.v.refusedNow()).toBe(true);
  expect(traj.v.current()).not.toBe(s);
  expect(pin.v.refused).toBeFalsy();
  expect(s.turns.length).toBe(200);
  expect(tailOf(s)).toBeNull();
  expect(holdersOf(s)).toBe(1);
  const offs = callsOf(st, file);
  expect(new Set(offs).size).toBe(offs.length);
  expect(windowBytes()).toBeLessThanOrEqual(BUDGET);
}, 60000);

test("a Trajectory that joins before any of the session is read stands back at once when the Pinned pane would fit alone, with no call", async () => {
  const file = fixture("--only", "1");
  fakeReader({ [file]: 60 });
  const m = await measured(file);
  phantom(BUDGET - m.cost - Math.floor(m.view / 2));
  // The Pinned pane's first call is held, so the session is still at its top when the
  // Trajectory opens on it.
  let release = null;
  const held = new Promise((r) => { release = r; });
  const st = fakeReader({ [file]: 60 });
  const inner = H.extractHook;
  H.extractHook = async (args) => { await held; return inner(args); };
  const pin = openPane(file, { view: "pinned" });
  await until(() => st.asked.length === 0 && pin.v.readWaiting, "the Pinned pane's call");
  const s = pin.v.current();
  expect(s.offset).toBe(0);
  const traj = openPane(file, { view: "trajectory" });
  await until(() => traj.v.refused, "the Trajectory standing back");
  expect(traj.v.current()).not.toBe(s);
  expect(holdersOf(s)).toBe(1);
  release();
  await settle(pin.v);
  expect(pin.v.refused).toBeFalsy();
  expect(s.turns.length).toBe(60);
  // One pane read it: each offset asked once, from the top.
  const offs = callsOf(st, file);
  expect(offs[0]).toBe(0);
  expect(new Set(offs).size).toBe(offs.length);
}, 20000);

test("a follower that is not following notes a turn that came with the chunk that trimmed the copy", async () => {
  const file = fixture("--only", "1");
  fakeReader({ [file]: 60 });
  const chat = openPane(file);
  await settle(chat.v);
  const other = openPane(file);
  await settle(other.v);
  const s = chat.v.current();
  other.v.follow = false;
  other.v.sel = "0:30";
  other.v.followShared(other.cx);
  expect(other.v.shareSeen?.n).toBe(60);
  expect(other.v.unseen).toBeFalsy();
  phantom(BUDGET - windowBytes() - 1);
  fakeReader({ [file]: 70 });
  chat.v.read(chat.cx);
  await settle(chat.v);
  expect(tailOf(s)?.of).toBe(70);
  // What it last saw moved with the trim, so the new turn is told from the old ones.
  expect(other.v.shareSeen?.n).toBe(60 - tailOf(s).of + tailOf(s).shown);
  expect(other.v.followShared(other.cx)).toBe(true);
  expect(other.v.unseen).toBe("pending");
}, 20000);

test("a refused or stood-back pane's header says the session is too large, not that it is reading", async () => {
  const file = fixture("--only", "1");
  fakeReader({ [file]: 60 });
  const pin = openPane(file, { view: "pinned" });
  await settle(pin.v);
  const s = pin.v.current();
  expect(pin.v.headerText()).not.toStartWith("Reading");
  // Stood back beside the Pinned pane.
  const room = phantom(BUDGET - windowBytes() - Math.floor(viewOf(s, "trajectory") / 2));
  const traj = openPane(file, { view: "trajectory" });
  await until(() => traj.v.refused, "the Trajectory standing back");
  expect(traj.v.headerText()).toBe("Too large");
  // Retry with room: the header is the session's again.
  windowState().panes.delete(room);
  traj.v.retryRead(traj.cx);
  expect(traj.v.headerText()).not.toBe("Too large");
  // Refused alone: a Pinned pane on another transcript, with the window full, lets it go after
  // its first chunk. (No pane here closes: the harness's tasks outlive a closed pane, which
  // Herdr's never do.)
  await settle(traj.v);
  const other = fixture("--only", "2");
  fakeReader({ [file]: 60, [other]: 60 });
  phantom(BUDGET - windowBytes() - 1);
  const again = openPane(other, { view: "pinned" });
  await until(() => again.v.refused, "the Pinned pane refusing");
  expect(again.v.current().loaded).toBeFalsy();
  expect(again.v.headerText()).toBe("Too large");
  again.v.report();
  expect(H.state.shared["threads.debug"]["t4:pinned"].header).toBe("Too large");
}, 20000);
