// bun test: TRD-23 slice 1, the timeline at its edges: a session with no turns, the heads
// changing while the strip is built from nothing, the spans the last turn reaches back over,
// what is drawn on top and what a press there selects, an older Herdr's torn bars, and the room
// of a turn's number. The model is timeline.js (test/timeline.test.js); the pane is on the
// render harness.
import { test, expect, setSystemTime } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as TL from "../mods/agent-threads/timeline.js";
import { newSession, apply, STEP_MAX } from "../mods/agent-threads/core/turns.js";
import { LEDGER_KINDS, headParts, ledgerTurn, trajInks } from "../mods/agent-threads/ledger.js";
import { fixture, frame, H, handlerAfterId, makeCx, pane, settle, setup, theme, Threads, unsliced, until } from "./render-harness.js";

setup();

const T0 = Date.parse("2026-11-01T09:00:00Z");
const CW = 1370;
// A made-up step row of turn key: kind lk from a to b ms into the turn (b null: an instant).
function row(key, j, lk, a, b, open = false) {
  const r = { kind: "tr", key: `tr:${key}:${j}`, lk, failed: lk === "failed", start: a, dur: b == null ? null : b - a };
  if (open) r.open = true;
  return r;
}
// Finished turn i: 60 s long and 100 s after the last, the user's message, a call, a failed
// call and the reply.
function doneTurn(i) {
  const key = `0:${i}`;
  return {
    kind: "trh", key, n: i + 1, t0: T0 + i * 100000, total: 60000, span: 60000, going: false,
    cnt: { steps: 4, input: 1, model: 1, tools: 2, failed: 1, user: 1, agent: 0 },
    steps: [row(key, 0, "you", 0, null), row(key, 1, "tool", 1000, 5000), row(key, 2, "failed", 6000, 9000), row(key, 3, "reply", 10000, 60000)],
  };
}
const doneTurns = (n) => Array.from({ length: n }, (_, i) => doneTurn(i));
// A session of n finished turns and a last one left running (on) and then not (off): its last
// event is 60 s in, and the clock, now, 16 days after it started, so working off leaves the
// strip's places the old scale's and starts the bounded build (over TL_BUILD_BARS steps).
function grown(n) {
  const key = `0:${n}`;
  const t0 = T0 + n * 100000;
  const last = {
    kind: "trh", key, n: n + 1, t0, total: null, span: 60000,
    cnt: { steps: 3, input: 1, model: 1, tools: 1, failed: 0, user: 1, agent: 0 },
    steps: [row(key, 0, "you", 0, null), row(key, 1, "tool", 1000, 5000), row(key, 2, "reply", 10000, 60000)],
  };
  const heads = doneTurns(n);
  expect(heads.length * 4 + 3).toBeGreaterThan(TL.TL_BUILD_BARS);
  return { on: [...heads, { ...last, going: true }], off: [...heads, { ...last, going: false }], now: t0 + 16 * 86400000 };
}
// A clock that moves 1 ms each look, so a build stops after a few steps a draw.
function slowClock() {
  let t = 0;
  return { clock: () => ++t, until: (ms = 3) => t + ms };
}
// A clock a build never reaches the end of: built whole in the draw.
const fast = { clock: () => 0, until: () => 1 };
const drawn = (s, heads, c = fast, cw = CW, now = T0) => TL.tlDraw(s.M, s.J, heads, cw, now, c.until(), c.clock);
// The strip a model shows, field for field against another's.
function sameStrip(M, W) {
  expect(M.cw).toBe(W.cw);
  expect(M.geo).toEqual(W.geo);
  expect(M.L).toEqual(W.L);
  expect(M.grow).toEqual(W.grow);
}
const whole = (heads, now = T0) => TL.timelineModel(null, heads, CW, "clock", now, null);

// A Trajectory pane docked along the bottom, w px wide, its rows built whole. hold (heldRead):
// its first read is held midway.
async function dockPane(file, w = 1440, hold = null) {
  await pane(file);
  if (hold) H.extractHook = hold.hook;
  const state = H.state;
  state.shared["threads.byTerminal"] = { t4: { pane: "p2" } };
  state.panes.push({ pane: "p5", tab: "A", terminal: null, mod: "agent-threads" });
  const props = state.props;
  state.props = { ...props, view: "trajectory", dock: "bottom" };
  const b = unsliced(new Threads());
  const cb = makeCx();
  b.init(state.props, cb);
  await (hold ? hold.mid(b) : settle(b));
  state.props = props;
  b.width = w;
  b.paneW = w;
  b.rootH = 600;
  return { b, cb };
}
const ids = (c) => c.filter((e) => e[0] === "id").map((e) => e[1]);
const own = (c, id) => {
  const at = c.findIndex((e) => e[0] === "id" && e[1] === id);
  if (at < 0) return null;
  const end = c.findIndex((e, j) => j > at && e[0] === "id");
  return c.slice(at, end < 0 ? c.length : end);
};
const words = (calls) => (calls ?? []).filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
// A frame with the list measured tall enough for the timeline, so it shows, and the frames
// after it while the strip's build goes on.
function shownFrame(b, cb, h = 400) {
  const c0 = frame(b, cb);
  handlerAfterId(c0, "th-traj-listbox", "on_size_change")({ width: b.paneW, height: h }, cb);
  let c = frame(b, cb);
  for (let k = 0; k < 400 && b.tlJob; k++) c = frame(b, cb);
  return c;
}

test("timeline of a session with no turns: the model is an empty strip in every draw, the first and those after it, and turns that come and go are placed whole", () => {
  const empty = (s, heads) => {
    expect([s.wait, s.J, s.M.heads === heads, s.M.cw]).toEqual([false, null, true, CW]);
    expect([s.M.geo.turns, s.M.geo.walls, s.M.L.turns, s.M.L.labels, s.M.L.ticks, s.M.L.fails, s.M.L.gaps, s.M.grow]).toEqual([[], [], [], [], [], [], [], []]);
    expect([s.M.L.spans.size, s.M.L.from, s.M.L.to]).toEqual([0, 0, -1]);
  };
  // The same list of no turns drawn three times, then a new one each draw, as the ledger makes
  // a new list at a change to the session.
  const none = [];
  let s = { M: null, J: null };
  for (let k = 0; k < 3; k++) { s = drawn(s, none); empty(s, none); }
  for (let k = 0; k < 2; k++) { const other = []; s = drawn(s, other); empty(s, other); }
  // Another width.
  for (let k = 0; k < 2; k++) s = drawn(s, none, fast, 900);
  expect([s.J, s.M.cw, s.M.geo.turns]).toEqual([null, 900, []]);
  // No press answers, and no number is drawn.
  expect(TL.timelineHit(s.M.L, s.M.heads, 100, "tools", T0, 8)).toBe(null);
  expect(TL.tlNumbers(s.M.L, s.M.heads, undefined)).toEqual([]);
  // The first turn comes, drawn twice; then the session is empty again (a clear, another pick).
  s = drawn({ M: null, J: null }, none);
  const one = doneTurns(1);
  for (let k = 0; k < 2; k++) { s = drawn(s, one); sameStrip(s.M, whole(one)); }
  for (let k = 0; k < 2; k++) { const other = []; s = drawn(s, other); empty(s, other); }
  // A long session's build over an old strip still running when the session turns empty, the
  // build's own draw done in it or not: the strip is empty, and stays so.
  for (const last of [fast, slowClock()]) {
    const { on, off, now } = grown(400);
    const c = slowClock();
    let t = { M: whole(on, now), J: null };
    for (let k = 0; k < 2; k++) t = drawn(t, off, c, CW, now);
    expect([t.J?.total > 0, t.M.geo.stale]).toEqual([true, true]);
    t = drawn(t, none, last, CW, now);
    for (let k = 0; k < 2; k++) t = drawn(t, none, fast, CW, now);
    empty(t, none);
  }
});

test("timeline view: a session with no turns draws its gutter and an empty strip, in every frame", async () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-tl-none-"));
  const file = join(dir, "e.jsonl");
  writeFileSync(file, `${JSON.stringify({ type: "summary", summary: "Made-up cart work", leafUuid: "u0" })}\n`);
  const { b, cb } = await dockPane(file);
  shownFrame(b, cb);
  for (let k = 0; k < 3; k++) {
    let c = null;
    expect(() => { c = frame(b, cb); }).not.toThrow();
    expect(words(own(c, "th-tl-gutter"))).toEqual(["Input", "Model", "Tools"]);
    expect(ids(c)).toContain("th-tl-lanes");
    expect(ids(c)).not.toContain("th-tl-wait");
    expect(words(own(c, "th-tl-labels"))).toEqual([]);
    expect(ids(c).filter((id) => /^th-tl-(input|model|tools|grow)-/.test(id))).toEqual([]);
    expect([b.tlModel.L.turns.length, b.tlJob]).toEqual([0, null]);
  }
  // A press on it selects nothing.
  const c = frame(b, cb);
  const was = b.tsel;
  handlerAfterId(c, "th-tl-lanes", "on_mouse_down")({ local_position: { x: 100, y: 40 }, position: { x: 100, y: 40 } }, cb);
  expect(b.tsel).toBe(was);
});

// ---- the heads changing while the strip is built from nothing ----
// The model's build from nothing, begun for heads and left after a few steps.
function coldBuild(heads, now = T0) {
  const s = drawn({ M: null, J: null }, heads, slowClock(), CW, now);
  expect([s.M, s.wait, s.J?.total > 0, s.J?.heads === heads]).toEqual([null, true, true, true]);
  return s;
}

test("timeline from nothing, the heads change while the build runs: another session, an event, a new turn, working off or an emptied session; the first strip shown is of the heads of that draw", () => {
  const a = doneTurns(400);
  const last = a.at(-1);
  const longer = [...a.slice(0, -1), { ...last, total: 90000, span: 90000, steps: [...last.steps.slice(0, -1), row(last.key, 3, "reply", 10000, 90000)] }];
  const other = doneTurns(120).map((h) => ({ ...h, t0: h.t0 + 86400000, total: h.total + 5000 * (h.n % 7) }));
  for (const [what, heads] of [["another session", other], ["an event", longer], ["a new turn", doneTurns(401)], ["emptied", []]]) {
    const s = drawn(coldBuild(a), heads);
    expect([what, s.wait, s.J, s.M?.heads === heads]).toEqual([what, false, null, true]);
    expect([what, s.M.geo.turns.length]).toEqual([what, heads.length]);
    sameStrip(s.M, whole(heads));
  }
  // Working off: that draw shows the heads no longer running, and the strip ends as theirs whole.
  const { on, off, now } = grown(400);
  let s = drawn(coldBuild(on, now), off, fast, CW, now);
  expect([s.wait, s.M?.heads === off, s.M?.geo.room]).toEqual([false, true, 0]);
  for (let k = 0; k < 400 && s.J; k++) s = drawn(s, off, fast, CW, now);
  expect(s.J).toBe(null);
  sameStrip(s.M, whole(off, now));
});

// Each look at the clock 3 ms later while f runs: a build stops after a step or two a frame.
function slowNow(f) {
  const real = performance.now;
  let t = real.call(performance);
  performance.now = () => (t += 3);
  try { return f(); } finally { performance.now = real; }
}
function stillNow(f) {
  const real = performance.now;
  const t = real.call(performance);
  performance.now = () => t;
  try { return f(); } finally { performance.now = real; }
}
// A Trajectory pane of 400 turns with its strip's build from nothing begun and not done.
async function buildingPane() {
  const { b, cb } = await dockPane(fixture("--extra", "400"));
  slowNow(() => {
    const c = frame(b, cb);
    handlerAfterId(c, "th-traj-listbox", "on_size_change")({ width: 1440, height: 400 }, cb);
    frame(b, cb);
  });
  expect(b.tlModel ?? null).toBe(null);
  expect(b.tlJob?.total).toBeGreaterThan(0);
  return { b, cb };
}
// The pane's own asks for a next draw of the strip's build among its timers (found by their
// source, which the transpiler may give as !1), run and taken off the list.
function buildAsks(cb) {
  const at = (x) => x.ms === 0 && /this\.tlNext = (false|!1)/.test(String(x.fn));
  const due = cb.timers.filter(at);
  cb.timers = cb.timers.filter((x) => !at(x));
  for (const x of due) x.fn(cb);
  return due.length;
}

for (const [what, change] of [
  ["another session picked", (b, cb, file) => b.pick({ path: file }, cb)],
  ["a new session after a clear", (b, cb, file) => b.adopt({ kind: "found", id: "made-up-second", file, live: true }, cb)],
]) {
  test(`timeline view: ${what} while the strip is built from nothing: it waits for the read with no build kept, and the first strip drawn is of what the pane holds then`, async () => {
    const { b, cb } = await buildingPane();
    const was = b.ledger().totals.heads;
    change(b, cb, fixture("--extra", "60"));
    const c = frame(b, cb);
    expect(words(own(c, "th-tl-wait"))).toEqual(["The timeline shows once the whole session is read"]);
    expect(b.tlJob ?? null).toBe(null);
    await settle(b);
    let first = null;
    for (let k = 0; k < 400 && !first; k++) {
      const f = frame(b, cb);
      if (own(f, "th-tl-lanes")) first = { M: b.tlModel, heads: b.ledger().totals.heads };
    }
    expect(first).toBeTruthy();
    expect(first.heads === was).toBe(false);
    expect(first.heads.length).not.toBe(was.length);
    expect(first.M.heads === first.heads).toBe(true);
    for (let k = 0; k < 400 && b.tlJob; k++) frame(b, cb);
    sameStrip(b.tlModel, TL.timelineModel(null, first.heads, b.tlModel.cw, "clock", Date.now(), null));
  }, 30000);
}

test("timeline view: while the session is read again, a strip's build left from before asks for no draw; read, it is built again", async () => {
  const { b, cb } = await buildingPane();
  expect(buildAsks(cb)).toBe(1);
  b.current().loaded = false;
  let asks = 0;
  for (let k = 0; k < 20; k++) {
    const c = frame(b, cb);
    expect(words(own(c, "th-tl-wait"))).toEqual(["The timeline shows once the whole session is read"]);
    asks += buildAsks(cb);
  }
  expect(asks).toBe(0);
  expect(b.tlJob ?? null).toBe(null);
  b.current().loaded = true;
  for (let k = 0; k < 400 && (b.tlJob || !b.tlModel); k++) frame(b, cb);
  const M = b.tlModel;
  expect(M.heads === b.ledger().totals.heads).toBe(true);
  sameStrip(M, TL.timelineModel(null, M.heads, M.cw, "clock", Date.now(), null));
});

// ---- another transcript picked ----
// The rows are built in slices over draws here, which a test pane turns off (unsliced): with
// buildMax at -1 a slice is one turn. Until the build is done the ledger gives the rows it had.
const oneTurnASlice = (v) => { v.buildMax = () => -1; };
// The Trajectory in the Chat's own pane: y in a Chat under its split width, the pane then made
// 800 px wide, so it has the strip. The Chat's rows are built whole. y again goes back to the
// Chat, where a person picks.
function enterOwn(v, cx) {
  v.buildMax = () => 1e9;
  v.paneW = 400;
  v.width = 400;
  v.command("trajectory", cx);
  v.tdetail = false;
  v.paneW = 800;
  v.width = 800;
  expect(v.traj).toBe(true);
}
function leaveOwn(v, cx) {
  v.command("trajectory", cx);
  expect(v.traj).toBe(false);
}
// Such a pane with its strip shown for a first transcript, and the Chat back in it.
async function ownPane() {
  const { v, cx } = await pane(fixture("--extra", "30"));
  enterOwn(v, cx);
  shownFrame(v, cx);
  expect([v.tlModel.heads === v.ledger().totals.heads, v.tlModel.heads.length]).toEqual([true, v.current().turns.length]);
  leaveOwn(v, cx);
  return { v, cx };
}
// The pane's own asks for a next draw of the rows' build among its timers, run and taken off.
function rowAsks(cx) {
  const at = (x) => x.ms === 0 && /this\.buildNext = (false|!1)/.test(String(x.fn));
  const due = cx.timers.filter(at);
  cx.timers = cx.timers.filter((x) => !at(x));
  for (const x of due) x.fn(cx);
  return due.length;
}
// What each frame drew until no build of the rows or of the strip is left: the strip's headings,
// or the words it waits with. While one is left the frame asks for the next: the pane is still.
function stripFrames(v, cx) {
  rowAsks(cx);
  buildAsks(cx);
  const seen = [];
  for (let k = 0; k < 600; k++) {
    // The clock stands: the strip's own build ends in the draw it begins in.
    const c = stillNow(() => frame(v, cx));
    seen.push(own(c, "th-tl-lanes") ? v.tlModel.heads : words(own(c, "th-tl-wait")).join(" "));
    const asks = rowAsks(cx) + buildAsks(cx);
    if (!v.ledgerJob && !v.tlJob) return seen;
    expect([k, asks > 0]).toEqual([k, true]);
  }
  throw new Error("the builds did not end in 600 frames");
}
const told = (x, named) => named.find(([h]) => h === x)?.[1] ?? (Array.isArray(x) ? `a strip of ${x.length} other turns` : x);
const READ_WAIT = "The timeline shows once the whole session is read";
// The strip waited in every frame but the last, which drew the turns of the transcript the pane is
// on; and nothing waits or asks for a draw after it.
function onlyThePick(v, cx, seen) {
  const heads = v.ledgerMemo.totals.heads;
  expect([v.ledgerMemo.sessions === v.sessions, heads.length]).toEqual([true, v.sessions.reduce((n, x) => n + x.turns.length, 0)]);
  expect(seen.length).toBeGreaterThan(10);
  expect(seen.map((x) => told(x, [[heads, "the pick's strip"]]))).toEqual([...new Array(seen.length - 1).fill(READ_WAIT), "the pick's strip"]);
  for (let k = 0; k < 3; k++) {
    const c = frame(v, cx);
    expect([ids(c).includes("th-tl-wait"), v.tlModel.heads === heads, v.ledgerJob ?? null, v.tlJob ?? null, rowAsks(cx) + buildAsks(cx)]).toEqual([false, true, null, null, 0]);
  }
}

test("timeline view: another transcript picked, its rows built a slice a draw once it is read: the strip waits for them, draws none of the turns of the transcript before, and is then the picked one's", async () => {
  const { v, cx } = await ownPane();
  v.pick({ path: fixture("--extra", "12") }, cx);
  await settle(v);
  enterOwn(v, cx);
  oneTurnASlice(v);
  onlyThePick(v, cx, stripFrames(v, cx));
}, 30000);

for (const [what, first] of [
  ["its rows are built", async (v, cx, file) => {
    v.pick({ path: file }, cx);
    await settle(v);
    enterOwn(v, cx);
    oneTurnASlice(v);
    for (let k = 0; k < 4; k++) frame(v, cx);
    expect([v.ledgerJob?.sessions === v.sessions, v.ledgerJob?.next >= 0]).toEqual([true, true]);
    leaveOwn(v, cx);
  }],
  ["it is read", async (v, cx, file) => {
    v.pick({ path: file }, cx);
    expect([v.reading, Boolean(v.current()?.loaded)]).toEqual([true, false]);
  }],
]) {
  test(`timeline view: a pick replaced by a second one while ${what}: the strip waits for the second one's rows and is then its strip, and nothing waits after it`, async () => {
    const { v, cx } = await ownPane();
    await first(v, cx, fixture("--extra", "20"));
    v.pick({ path: fixture("--extra", "12") }, cx);
    await settle(v);
    enterOwn(v, cx);
    oneTurnASlice(v);
    onlyThePick(v, cx, stripFrames(v, cx));
  }, 30000);
}

test("timeline view: a pick whose read fails: the strip waits for the read alone and asks for no draw; a second pick that is read has its strip, and nothing waits after it", async () => {
  const { v, cx } = await ownPane();
  const bad = fixture("--extra", "20");
  H.extractHook = async (args) => (args.includes(bad) ? { code: 3, stdout: "", stderr: "made-up failure" } : null);
  v.pick({ path: bad }, cx);
  await until(() => v.current()?.error && !v.reading, "the read to fail");
  enterOwn(v, cx);
  oneTurnASlice(v);
  expect(stripFrames(v, cx)).toEqual([READ_WAIT]);
  for (let k = 0; k < 5; k++) {
    const c = frame(v, cx);
    expect(words(own(c, "th-tl-wait"))).toEqual([READ_WAIT]);
    // The ledger's rows are the pick's own (none): what the strip waits for is its read.
    expect([v.ledgerMemo.sessions === v.sessions, v.ledgerMemo.rows.length, v.unread()]).toEqual([true, 0, true]);
    expect([v.ledgerJob ?? null, v.tlJob ?? null, rowAsks(cx) + buildAsks(cx)]).toEqual([null, null, 0]);
  }
  leaveOwn(v, cx);
  v.pick({ path: fixture("--extra", "12") }, cx);
  await settle(v);
  enterOwn(v, cx);
  oneTurnASlice(v);
  onlyThePick(v, cx, stripFrames(v, cx));
}, 30000);

test("timeline view: the same transcript read again with more turns, its rows built a slice a draw: the strip is drawn in every frame, of the turns it had until they are built, then of them all", async () => {
  const file = fixture("--extra", "30");
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  writeFileSync(file, `${lines.slice(0, Math.floor(lines.length / 2)).join("\n")}\n`);
  const { b, cb } = await dockPane(file);
  shownFrame(b, cb);
  const was = b.tlModel.heads;
  expect([was === b.ledger().totals.heads, was.length > 5]).toEqual([true, true]);
  writeFileSync(file, `${lines.join("\n")}\n`);
  b.read(cb);
  await settle(b);
  expect(b.current().turns.length).toBeGreaterThan(was.length);
  // Every turn's rows made again, so the build takes a draw a turn.
  b.turnLedger = new WeakMap();
  oneTurnASlice(b);
  const seen = stripFrames(b, cb);
  const heads = b.ledgerMemo.totals.heads;
  expect(heads.length).toBe(b.current().turns.length);
  expect(seen.length).toBeGreaterThan(10);
  expect(seen.map((x) => told(x, [[was, "the turns it had"], [heads, "them all"]]))).toEqual([...new Array(seen.length - 1).fill("the turns it had"), "them all"]);
}, 30000);

// ---- rows built of part of a session ----
// A read of file held midway: its first call reads about half the file's bytes, and the next
// waits until open(). mid(v): until the pane's read is there.
function heldRead(file) {
  const size = statSync(file).size;
  let open;
  const gate = new Promise((r) => { open = r; });
  return {
    open: () => open(),
    hook: async (args) => {
      if (args[1] !== file) return null;
      if (Number(args[2]) === 0) args[3] = String(Math.floor(size / 2));
      else await gate;
      return null;
    },
    mid: (v) => until(() => v.reading && v.current()?.offset > 0 && v.current().offset < size, "the read to be midway"),
  };
}
const linesOf = (file) => readFileSync(file, "utf8").split("\n").filter(Boolean);
const writeLines = (file, lines) => writeFileSync(file, `${lines.join("\n")}\n`);
// A Trajectory pane whose strip shows the whole of a file's first n lines, its rows built a turn
// a draw from here on.
async function wholeThen(file, n) {
  const lines = linesOf(file);
  writeLines(file, lines.slice(0, n));
  const { b, cb } = await dockPane(file);
  shownFrame(b, cb);
  expect([b.tlModel.heads === b.ledger().totals.heads, b.tlModel.heads.length]).toEqual([true, b.current().turns.length]);
  expect(b.tlModel.heads.length).toBeGreaterThan(5);
  oneTurnASlice(b);
  return { b, cb, lines };
}
// What one frame drew: the strip's headings, or the words it waits with.
function oneFrame(v, cx) {
  const c = stillNow(() => frame(v, cx));
  return own(c, "th-tl-lanes") ? v.tlModel.heads : words(own(c, "th-tl-wait")).join(" ");
}
// The strip is of the rows of every turn read, and nothing waits or asks for a draw after it.
function wholeStrip(v, cx) {
  const heads = v.ledgerMemo.totals.heads;
  expect(heads.length).toBe(v.sessions.reduce((n, x) => n + x.turns.length, 0));
  for (let k = 0; k < 3; k++) {
    const c = frame(v, cx);
    expect([ids(c).includes("th-tl-wait"), v.tlModel.heads === heads, v.ledgerJob ?? null, v.tlJob ?? null, rowAsks(cx) + buildAsks(cx)]).toEqual([false, true, null, null, 0]);
  }
}

test("timeline view: the Trajectory open while a long session is read, its last rows built a slice a draw: the strip waits until they are built, draws none of the turns read so far alone, and is then the whole session's", async () => {
  const file = fixture("--extra", "40");
  const hold = heldRead(file);
  const { b, cb } = await dockPane(file, 1440, hold);
  shownFrame(b, cb);
  expect(oneFrame(b, cb)).toBe(READ_WAIT);
  // The rows of the turns read so far are built, and kept.
  const part = b.ledgerMemo.totals.heads.length;
  expect([b.unread(), part > 5, part]).toEqual([true, true, b.current().turns.length]);
  oneTurnASlice(b);
  hold.open();
  await settle(b);
  expect(b.current().turns.length).toBeGreaterThan(part);
  onlyThePick(b, cb, stripFrames(b, cb));
}, 30000);

test("timeline view: a session read again from the top with the Trajectory open, its last rows built a slice a draw: the strip waits until they are built and is then the whole session's", async () => {
  const file = fixture("--extra", "40");
  const { b, cb } = await dockPane(file);
  shownFrame(b, cb);
  const hold = heldRead(file);
  H.extractHook = hold.hook;
  b.retryRead(cb);
  await hold.mid(b);
  expect(oneFrame(b, cb)).toBe(READ_WAIT);
  const part = b.ledgerMemo.totals.heads.length;
  expect([b.unread(), part > 5, part]).toEqual([true, true, b.current().turns.length]);
  oneTurnASlice(b);
  hold.open();
  await settle(b);
  expect(b.current().turns.length).toBeGreaterThan(part);
  onlyThePick(b, cb, stripFrames(b, cb));
}, 30000);

test("timeline view: a new session after a clear read with no frame drawn meanwhile, its rows built a slice a draw: the strip waits until they are built, not drawn of the turns before the clear alone", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "30"));
  shownFrame(b, cb);
  const was = b.sessions;
  expect(b.tlModel.heads.length).toBe(b.current().turns.length);
  oneTurnASlice(b);
  b.adopt({ kind: "found", id: "made-up-second", file: fixture("--extra", "12"), live: true }, cb);
  // The same array, one session more.
  expect([b.sessions === was, b.sessions.length]).toEqual([true, 2]);
  await settle(b);
  onlyThePick(b, cb, stripFrames(b, cb));
}, 30000);

test("timeline view: one event after the whole session is read, its rows built a slice a draw: the strip is drawn in every frame, of the rows it had until they are built, then of the new ones", async () => {
  const file = fixture("--extra", "30");
  const all = linesOf(file);
  let n = Math.floor(all.length / 2);
  while (!JSON.parse(all[n]).message?.content?.some?.((x) => x.type === "tool_use")) n++;
  const { b, cb, lines } = await wholeThen(file, n);
  const was = b.tlModel.heads;
  const ver = b.current().version;
  writeLines(file, lines.slice(0, n + 1));
  b.read(cb);
  await until(() => !b.reading, "the read to end");
  expect(b.current().version).toBeGreaterThan(ver);
  const seen = stripFrames(b, cb);
  const heads = b.ledgerMemo.totals.heads;
  expect([heads === was, seen.length > 5]).toEqual([false, true]);
  expect(seen.map((x) => told(x, [[was, "the rows it had"], [heads, "the new ones"]]))).toEqual([...new Array(seen.length - 1).fill("the rows it had"), "the new ones"]);
  wholeStrip(b, cb);
}, 30000);

test("timeline view: a live session read whole that grows by an event, by turns and by a read of several calls, its rows built a slice a draw: the strip is drawn in every frame, while each call of a read is out and after it", async () => {
  const file = fixture("--extra", "40");
  const total = linesOf(file).length;
  const third = Math.floor(total / 3);
  const { b, cb, lines } = await wholeThen(file, third);
  const seen = [];
  let calls = 0;
  for (const [upTo, parts] of [[third + 1, 1], [third + 2, 1], [third + 20, 1], [total, 2]]) {
    writeLines(file, lines.slice(0, upTo));
    const from = b.current().offset;
    const size = statSync(file).size;
    const gates = [];
    H.extractHook = async (args) => {
      if (args[1] !== file) return null;
      calls++;
      if (parts > 1 && Number(args[2]) === from) args[3] = String(Math.ceil((size - from) / 2));
      await new Promise((r) => gates.push(r));
      return null;
    };
    b.read(cb);
    // Each call held while two frames are drawn.
    while (b.reading) {
      await until(() => gates.length || !b.reading, "the read to go on");
      seen.push(oneFrame(b, cb), oneFrame(b, cb));
      for (const go of gates.splice(0)) go();
    }
    expect(b.current().offset).toBe(size);
    seen.push(...stripFrames(b, cb));
    wholeStrip(b, cb);
  }
  expect(calls).toBeGreaterThan(4);
  expect(seen.length).toBeGreaterThan(40);
  expect(seen.filter((x) => typeof x === "string")).toEqual([]);
}, 30000);

test("timeline view: a read that fails after the whole session was read, its rows built a slice a draw: the strip stays, of the turns it had; read again, it is drawn in every frame and of them all", async () => {
  const file = fixture("--extra", "30");
  const { b, cb, lines } = await wholeThen(file, Math.floor(linesOf(file).length / 2));
  const was = b.tlModel.heads;
  writeLines(file, lines);
  H.extractHook = async (args) => (args[1] === file ? { code: 3, stdout: "", stderr: "made-up failure" } : null);
  b.read(cb);
  await until(() => b.current().error && !b.reading, "the read to fail");
  expect(b.current().loaded).toBe(true);
  expect(stripFrames(b, cb).map((x) => told(x, [[was, "the turns it had"]]))).toEqual(["the turns it had"]);
  H.extractHook = null;
  b.read(cb);
  await until(() => !b.reading && !b.current().error, "the read to end");
  const seen = stripFrames(b, cb);
  const heads = b.ledgerMemo.totals.heads;
  expect(seen.map((x) => told(x, [[was, "the turns it had"], [heads, "them all"]]))).toEqual([...new Array(seen.length - 1).fill("the turns it had"), "them all"]);
  wholeStrip(b, cb);
}, 30000);

test("timeline view: a read that fails with part of its bytes applied after the whole session was read: the strip waits for the read alone and asks for no draw; read again from the top, it is the whole session's", async () => {
  const file = fixture("--extra", "30");
  const { b, cb, lines } = await wholeThen(file, Math.floor(linesOf(file).length / 2));
  writeLines(file, lines);
  // What an interrupt in the middle of a chunk leaves: the next read starts from the top.
  b.current().partial = true;
  H.extractHook = async (args) => (args[1] === file ? { code: 3, stdout: "", stderr: "made-up failure" } : null);
  b.read(cb);
  await until(() => b.current().error && !b.reading, "the read to fail");
  expect([Boolean(b.current().loaded), b.current().turns.length]).toEqual([false, 0]);
  expect(stripFrames(b, cb)).toEqual([READ_WAIT]);
  for (let k = 0; k < 3; k++) expect([oneFrame(b, cb), rowAsks(cb) + buildAsks(cb)]).toEqual([READ_WAIT, 0]);
  H.extractHook = null;
  b.buildMax = () => 1e9;
  b.retryRead(cb);
  await settle(b);
  shownFrame(b, cb);
  wholeStrip(b, cb);
}, 30000);

test("timeline view: a read that stalls twice after the whole session was read, its rows built a slice a draw: the strip stays, of the turns it had, and after a read that ends is drawn in every frame and of them all", async () => {
  const file = fixture("--extra", "30");
  const { b, cb, lines } = await wholeThen(file, Math.floor(linesOf(file).length / 2));
  const was = b.tlModel.heads;
  writeLines(file, lines);
  const gates = [];
  H.extractHook = async (args) => {
    if (args[1] === file) await new Promise((r) => gates.push(r));
    return null;
  };
  b.read(cb);
  for (const stalls of [1, 2]) {
    await until(() => gates.length === stalls, "the read's call to be out");
    expect(stripFrames(b, cb).map((x) => told(x, [[was, "the turns it had"]]))).toEqual(["the turns it had"]);
    // No heartbeat for long: the 1 s timer drops the read, and starts it again the first time.
    b.readBeat = 1;
    b.watchRead(cb);
    expect([b.readStalls, b.reading]).toEqual([stalls, stalls === 1]);
    expect(stripFrames(b, cb).map((x) => told(x, [[was, "the turns it had"]]))).toEqual(["the turns it had"]);
  }
  expect([Boolean(b.current().error), b.current().loaded]).toEqual([true, true]);
  H.extractHook = null;
  for (const go of gates.splice(0)) go();
  b.read(cb);
  await until(() => !b.reading && !b.current().error, "the read to end");
  const seen = stripFrames(b, cb);
  const heads = b.ledgerMemo.totals.heads;
  expect(seen.map((x) => told(x, [[was, "the turns it had"], [heads, "them all"]]))).toEqual([...new Array(seen.length - 1).fill("the turns it had"), "them all"]);
  wholeStrip(b, cb);
}, 30000);

// ---- what the wait is for, and how it ends ----
test("timeline view: a session read again from the top to the same number of turns, no frame drawn meanwhile, its rows built a slice a draw: the strip waits until they are built, not drawn of the turns before the read", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "30"));
  shownFrame(b, cb);
  const was = b.current().turns;
  oneTurnASlice(b);
  b.retryRead(cb);
  await settle(b);
  // Another array, as long.
  expect([b.current().turns === was, b.current().turns.length]).toEqual([false, was.length]);
  onlyThePick(b, cb, stripFrames(b, cb));
}, 30000);

test("timeline view: a pane with no session waits for nothing: an empty strip in every frame, and no draw asked", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "30"));
  shownFrame(b, cb);
  expect(b.tlModel.heads.length).toBeGreaterThan(5);
  b.sessions = [];
  b.res = { kind: "none" };
  oneTurnASlice(b);
  expect(stripFrames(b, cb)).toEqual([[]]);
  expect([b.current(), b.unread()]).toEqual([null, false]);
  wholeStrip(b, cb);
}, 30000);

test("timeline view: a pick still being looked for, with no session yet: the strip waits for it alone and asks for no draw; found and read, it is the pick's", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "30"));
  shownFrame(b, cb);
  // The pane's own lookup is out, so the pick's waits for it.
  b.resolving = true;
  b.pick({ path: fixture("--extra", "12") }, cb);
  expect([b.current(), b.res.kind]).toEqual([null, "resolving"]);
  oneTurnASlice(b);
  expect(stripFrames(b, cb)).toEqual([READ_WAIT]);
  for (let k = 0; k < 5; k++) {
    expect(oneFrame(b, cb)).toBe(READ_WAIT);
    // Its rows (none) are built: what it waits for is the lookup.
    expect([b.ledgerMemo.sessions === b.sessions, b.ledgerMemo.rows.length, b.ledgerMemo.partial]).toEqual([true, 0, false]);
    expect([b.ledgerJob ?? null, b.tlJob ?? null, rowAsks(cb) + buildAsks(cb)]).toEqual([null, null, 0]);
  }
  b.resolving = false;
  b.resolve(cb);
  await settle(b);
  onlyThePick(b, cb, stripFrames(b, cb));
}, 30000);

// Every frame until no build of the rows or of the strip is left, the clock 3 ms on at each look:
// what it drew (the strip's headings, or the words it waits with), the placings and the whole
// layouts begun in it, and whether it left a build of the strip. A slice of the rows is ms long:
// about 20 turns at 60, every turn at 1e9.
const LAYING = "Laying out the timeline…";
function countedFrames(b, cb, ms = 60) {
  rowAsks(cb);
  buildAsks(cb);
  b.buildMax = () => ms;
  const seen = [];
  for (let k = 0; k < 600; k++) {
    const m = { ...TL.TL_MADE };
    const c = slowNow(() => frame(b, cb));
    const what = own(c, "th-tl-lanes") ? b.tlModel.heads : words(own(c, "th-tl-wait")).join(" ");
    seen.push([what, TL.TL_MADE.geo - m.geo, TL.TL_MADE.layout - m.layout, Boolean(b.tlJob)]);
    const asks = rowAsks(cb) + buildAsks(cb);
    if (!b.ledgerJob && !b.tlJob) return seen;
    expect([k, asks > 0]).toEqual([k, true]);
  }
  throw new Error("the builds did not end in 600 frames");
}
// The strip waited for its rows, was built from nothing over draws (the first of them begins the
// one placing and the one layout, and leaves them for the next), and came in a draw with neither.
function builtOverDraws(b, cb, seen) {
  const heads = b.ledgerMemo.totals.heads;
  const draws = seen.map(([x, ...n]) => [told(x, [[heads, "its strip"]]), ...n]);
  const reads = draws.filter(([x]) => x === READ_WAIT).length;
  expect(reads).toBeGreaterThan(10);
  expect(draws.slice(0, reads)).toEqual(new Array(reads).fill([READ_WAIT, 0, 0, false]));
  expect(draws.at(-1)).toEqual(["its strip", 0, 0, false]);
  const laid = draws.slice(reads, -1);
  expect(laid.length).toBeGreaterThan(1);
  expect(laid).toEqual(laid.map((_, i) => (i ? [LAYING, 0, 0, true] : [LAYING, 1, 1, true])));
  sameStrip(b.tlModel, TL.timelineModel(null, heads, b.tlModel.cw, "clock", Date.now(), null));
  wholeStrip(b, cb);
}

for (const [what, change] of [
  ["another transcript picked", (b, cb) => b.pick({ path: fixture("--extra", "320") }, cb)],
  ["a new session after a clear", (b, cb) => b.adopt({ kind: "found", id: "made-up-second", file: fixture("--extra", "320"), live: true }, cb)],
  ["a session read again from the top", (b, cb) => b.retryRead(cb)],
]) {
  test(`timeline view: ${what}, its rows built over draws: the draw that ends the wait places and lays out no turns whole, and the strip is built from nothing over draws, as at a first read`, async () => {
    const { b, cb } = await dockPane(fixture("--extra", "300"));
    shownFrame(b, cb);
    expect(b.tlModel.heads.length).toBe(b.current().turns.length);
    change(b, cb);
    await settle(b);
    builtOverDraws(b, cb, countedFrames(b, cb));
  }, 60000);
}

test("timeline view: a first read with the Trajectory open, its last rows built over draws: the strip is built from nothing over draws, and comes in a draw that places and lays out no turns whole", async () => {
  const file = fixture("--extra", "300");
  const hold = heldRead(file);
  const { b, cb } = await dockPane(file, 1440, hold);
  shownFrame(b, cb);
  expect([oneFrame(b, cb), b.tlModel ?? null]).toEqual([READ_WAIT, null]);
  hold.open();
  await settle(b);
  builtOverDraws(b, cb, countedFrames(b, cb));
}, 60000);

// The rows of the turns before a clear are kept, so a short session after it has its rows in the
// draw that ends the read's wait: no draw waits for the rows alone.
test("timeline view: a new session after a clear held midway in its read, its rows then built in one draw: no draw waits for the rows alone, and the strip is built from nothing over draws", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "300"));
  shownFrame(b, cb);
  expect(b.tlModel.heads.length).toBeGreaterThan(300);
  const file = fixture("--extra", "12");
  const hold = heldRead(file);
  H.extractHook = hold.hook;
  b.adopt({ kind: "found", id: "made-up-second", file, live: true }, cb);
  await hold.mid(b);
  for (let k = 0; k < 3; k++) expect([oneFrame(b, cb), b.tlModel ?? null, b.tlJob ?? null]).toEqual([READ_WAIT, null, null]);
  hold.open();
  await settle(b);
  const seen = countedFrames(b, cb, 1e9);
  const heads = b.ledgerMemo.totals.heads;
  const draws = seen.map(([x, ...n]) => [told(x, [[heads, "its strip"]]), ...n]);
  expect(draws.length).toBeGreaterThan(2);
  expect(draws).toEqual(draws.map((_, i) => (i === draws.length - 1 ? ["its strip", 0, 0, false] : i ? [LAYING, 0, 0, true] : [LAYING, 1, 1, true])));
  sameStrip(b.tlModel, TL.timelineModel(null, heads, b.tlModel.cw, "clock", Date.now(), null));
  wholeStrip(b, cb);
}, 60000);

test("timeline view: the debug report counts no turns while the strip waits, for the read and for the rows, and the strip's own once it is drawn", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "30"));
  shownFrame(b, cb);
  const counted = () => {
    const { shown, waiting, turns, drawn, spans, layers, labels, cw } = b.trajReport().timeline;
    return { shown, waiting, turns, drawn, spans, layers, labels, cw };
  };
  const none = { shown: true, waiting: true, turns: 0, drawn: 0, spans: 0, layers: 0, labels: 0, cw: null };
  expect(counted()).toMatchObject({ shown: true, waiting: false, turns: b.current().turns.length });
  const file = fixture("--extra", "40");
  const hold = heldRead(file);
  H.extractHook = hold.hook;
  b.pick({ path: file }, cb);
  await hold.mid(b);
  expect([oneFrame(b, cb), b.unread(), counted()]).toEqual([READ_WAIT, true, none]);
  oneTurnASlice(b);
  hold.open();
  await settle(b);
  expect([oneFrame(b, cb), b.unread(), counted()]).toEqual([READ_WAIT, false, none]);
  expect(b.ledgerJob ?? null).not.toBe(null);
  b.buildMax = () => 1e9;
  shownFrame(b, cb);
  const now = counted();
  expect([now.shown, now.waiting, now.turns, now.drawn > 0, now.spans > 0, now.layers > 0, now.labels > 0, now.cw]).toEqual([true, false, b.current().turns.length, true, true, true, true, b.tlModel.cw]);
}, 30000);

// ---- a press between the pane's change and its next frame ----
// A call on the strip of frame c (the last drawn) whose bar a press gets, the first there is from
// turn from on: its row's key, and that press through the frame's own handler. With lane
// "model" a reply instead of a call.
function callOn(b, c, from = 0, lane = "tools") {
  const M = b.tlModel;
  const down = handlerAfterId(c, "th-tl-lanes", "on_mouse_down");
  for (let ti = from; ti < M.heads.length; ti++) {
    for (const [i, r] of M.heads[ti].steps.entries()) {
      if (LEDGER_KINDS[r.lk]?.lane !== lane || (lane === "model" && r.lk !== "reply")) continue;
      const box = TL.tlBar(M.L, M.heads, ti, i, M.nowMs);
      if (!box) continue;
      const x = (box.x0 + box.x1) / 2;
      // 11 px down the lane a full bar and a half-height one are both drawn.
      if (TL.timelineHit(M.L, M.heads, x, lane, M.nowMs, 11)?.key !== r.key) continue;
      const y = ["input", "model", "tools"].indexOf(lane) * TL.TL_LANE + 11;
      return { key: r.key, press: (cb) => down({ local_position: { x, y }, position: { x, y } }, cb) };
    }
  }
  throw new Error("no call on the strip");
}
// What that press selects and scrolls to, with nothing selected before it.
// A press on turn ti on the strip of frame c (the last drawn) where it gets the turn's heading: the
// heading's key, and that press.
function headOn(b, c, ti) {
  const M = b.tlModel;
  const down = handlerAfterId(c, "th-tl-lanes", "on_mouse_down");
  const { key } = M.heads[ti];
  const { x: x0, w } = M.L.turns[ti];
  for (let x = x0; x <= x0 + w; x++) {
    for (const [li, lane] of ["input", "model", "tools"].entries()) {
      if (TL.timelineHit(M.L, M.heads, x, lane, M.nowMs, 11)?.key !== key) continue;
      const y = li * TL.TL_LANE + 11;
      return { key, press: (cb) => down({ local_position: { x, y }, position: { x, y } }, cb) };
    }
  }
  throw new Error("no place for the heading on the strip");
}
// What press on selects, and what the list is scrolled to, with nothing selected before it.
function pressed(b, cb, on) {
  b.tsel = null;
  b.tscrollTo = null;
  on.press(cb);
  return [b.tsel ?? null, b.tscrollTo ?? null];
}
const whenRead = (b, was) => until(() => !b.reading && !b.resolving && b.current()?.loaded && b.current().turns !== was, "the read to end");
for (const [what, change] of [
  ["another transcript picked and read", async (b, cb, was) => {
    b.pick({ path: fixture("--extra", "6") }, cb);
    await settle(b);
    // As many turns: their number alone does not tell the two apart.
    expect(b.current().turns.length).toBe(was.length);
  }],
  ["another transcript picked, read in part", async (b, cb, was) => {
    const file = fixture("--extra", "40");
    const hold = heldRead(file);
    H.extractHook = hold.hook;
    b.pick({ path: file }, cb);
    await hold.mid(b);
    expect(b.current().turns.length).toBeGreaterThan(5);
    return async () => { hold.open(); await whenRead(b, was); };
  }],
  ["the transcript replaced by a shorter one and read again", async (b, cb, was, file) => {
    writeLines(file, linesOf(fixture("--extra", "3")));
    b.read(cb);
    await whenRead(b, was);
  }],
]) {
  for (const [how, ms] of [["in the press", 1e9], ["over draws", -1]]) {
    test(`timeline view: ${what}, its rows built ${how}: a press on the strip of the frame before it selects nothing; on the next strip drawn a press selects its call`, async () => {
      const file = fixture("--extra", "6");
      const { b, cb } = await dockPane(file);
      const c = shownFrame(b, cb);
      const on = callOn(b, c);
      expect(pressed(b, cb, on)).toEqual([on.key, on.key]);
      const was = b.current().turns;
      const ti = b.tlModel.L.index.get(b.turnOfRow(on.key));
      const head = headOn(b, c, ti);
      const before = was[ti];
      const then = await change(b, cb, was, file);
      expect(b.current().turns === was).toBe(false);
      // The new turns have a row of that key too, so the key alone names one of them.
      const [si, n] = b.turnOfRow(on.key).split(":").map(Number);
      expect([si, Boolean(b.current().turns[n - 1])]).toEqual([0, true]);
      // A turn of the same words and time, as in a session's resumed copy: its heading does not
      // tell the two apart.
      const now = b.current().turns[ti];
      expect([n - 1, now === before, now.ts != null, now.ts === before.ts, now.prompt === before.prompt]).toEqual([ti, false, true, true, true]);
      b.buildMax = () => ms;
      expect([pressed(b, cb, on), pressed(b, cb, head)]).toEqual([[null, null], [null, null]]);
      b.buildMax = () => 1e9;
      await then?.();
      const next = callOn(b, shownFrame(b, cb));
      expect(b.tlModel.heads === b.ledger().totals.heads).toBe(true);
      expect(pressed(b, cb, next)).toEqual([next.key, next.key]);
    }, 30000);
  }
}

for (const [how, ms] of [["in the press", 1e9], ["over draws", -1]]) {
  test(`timeline view: a session that grows by turns, its rows built ${how}: a press on the strip of the frame before selects the call it did`, async () => {
    const file = fixture("--extra", "30");
    const { b, cb, lines } = await wholeThen(file, Math.floor(linesOf(file).length / 2));
    const on = callOn(b, frame(b, cb));
    expect(pressed(b, cb, on)).toEqual([on.key, on.key]);
    const was = b.current().turns;
    const n = was.length;
    writeLines(file, lines);
    b.read(cb);
    await until(() => !b.reading, "the read to end");
    expect([b.current().turns === was, was.length > n]).toEqual([true, true]);
    b.buildMax = () => ms;
    expect(pressed(b, cb, on)).toEqual([on.key, on.key]);
  }, 30000);
}

// ---- a press between a change to the turns read and the next frame ----
// A pane on a transcript whose reader gives the events first at its first read. read(events, rewind):
// a read after it that gives events, with rewind on it, as on every read of OpenCode's, so that the
// turns after the last settled one are cut back first (turns.js rewindTail).
async function cutPane(first) {
  const file = fixture("--extra", "3");
  let next = { events: [], rewind: true };
  const hook = async (args) => {
    if (args[1] !== file) return null;
    const top = Number(args[2]) === 0;
    const lines = [{ k: "file", size: 10 }, ...(top ? first : next.events), { k: "chunk", used: top ? 10 : 0, ...(top || !next.rewind ? {} : { rewind: true }) }];
    return { code: 0, stdout: lines.map((e) => JSON.stringify(e)).join("\n"), stderr: "" };
  };
  const { b, cb } = await dockPane(file, 1440, { hook, mid: (v) => settle(v) });
  const read = async (events, rewind = true) => {
    next = { events, rewind };
    b.read(cb);
    await until(() => !b.reading, "the read to end");
  };
  return { b, cb, read };
}
// Turn n's events, its words w: a prompt, a call and a reply, and, settled, its end. The call and
// the reply have times, so that they have bars, as no OpenCode session's have (bareOf).
function eventsOf(n, w, settled) {
  const at = (sec) => new Date(T0 + n * 100000 + sec * 1000).toISOString();
  return [
    { k: "p", o: "human", t: `${w} ${n}`, ts: at(0) },
    { k: "u", n: "Bash", id: `${w}-${n}`, in: w, ts: at(1) },
    { k: "x", id: `${w}-${n}`, f: false, ts: at(40) },
    { k: "t", t: `${w} done`, ts: at(41) },
    { k: "m", id: `m-${n}`, u: {}, ts: at(60) },
    ...(settled ? [{ k: "d", ms: 60000, ts: at(60) }, { k: "settle", id: `p-${n}` }] : []),
  ];
}
// The same in the shape of OpenCode's reader (core/opencode-read.sql): no time on a call or on
// words, and no result. The prompt is sent sec seconds in; null: it has no time.
function bareOf(n, w, settled, sec = 0) {
  const at = (x) => new Date(T0 + n * 100000 + x * 1000).toISOString();
  return [
    { k: "p", o: "human", t: `${w} ${n}`, ...(sec == null ? {} : { ts: at(sec) }) },
    { k: "u", n: "bash", id: `${w}-${n}` },
    { k: "t", t: `${w} done` },
    { k: "m", id: `m-${n}`, u: {}, ts: at(60) },
    ...(settled ? [{ k: "d", ms: 60000, ts: at(60) }, { k: "settle", id: `p-${n}` }] : []),
  ];
}
// Five finished turns and the events last after them, in that shape.
const bareTo = (last) => [...Array.from({ length: 5 }, (_, i) => bareOf(i + 1, "first", true)).flat(), ...last];
const eventsTo = (n, settled) => Array.from({ length: n }, (_, i) => eventsOf(i + 1, "first", settled || i + 1 < n)).flat();
for (const [what, events, left] of [
  ["cut back in place and another one read at its number", eventsOf(6, "other", false), 6],
  ["cut back in place, nothing read after it yet", [], 5],
]) {
  for (const [how, ms] of [["in the press", 1e9], ["over draws", -1]]) {
    test(`timeline view: the last turn ${what}, its rows built ${how}: a press on the strip of the frame before it selects nothing; on the next strip drawn a press selects its call`, async () => {
      const { b, cb, read } = await cutPane(eventsTo(6, false));
      const c = shownFrame(b, cb);
      const on = callOn(b, c, 5);
      const early = callOn(b, c);
      const head = headOn(b, c, 5);
      expect([on.key, early.key, head.key]).toEqual(["tr:0:6:1", "tr:0:1:1", "0:6"]);
      expect([on, early, head].map((x) => pressed(b, cb, x))).toEqual([on, early, head].map((x) => [x.key, x.key]));
      const was = b.current().turns;
      const last = was[5];
      await read(events);
      expect([b.current().turns === was, was.length, was[5] === last]).toEqual([true, left, false]);
      b.buildMax = () => ms;
      // Nor does one on its heading (the turn read at its number has other words). One on a turn
      // before the cut selects the call it did.
      expect([on, early, head].map((x) => pressed(b, cb, x))).toEqual([[null, null], [early.key, early.key], [null, null]]);
      b.buildMax = () => 1e9;
      const next = callOn(b, shownFrame(b, cb), left - 1);
      expect(next.key).toBe(`tr:0:${left}:1`);
      expect(pressed(b, cb, next)).toEqual([next.key, next.key]);
    }, 30000);
  }
}

for (const [how, ms] of [["in the press", 1e9], ["over draws", -1]]) {
  test(`timeline view: a read that cuts no turn back and adds one, its rows built ${how}: a press on the strip of the frame before selects the call it did`, async () => {
    const { b, cb, read } = await cutPane(eventsTo(6, true));
    const on = callOn(b, shownFrame(b, cb), 5);
    expect(pressed(b, cb, on)).toEqual([on.key, on.key]);
    const was = b.current().turns;
    const last = was[5];
    await read(eventsOf(7, "first", false));
    expect([b.current().turns === was, was.length, was[5] === last]).toEqual([true, 7, true]);
    b.buildMax = () => ms;
    expect(pressed(b, cb, on)).toEqual([on.key, on.key]);
  }, 30000);
}

test("timeline view: the last turn cut back in place and another one read at its number, the strip drawn again before its rows are built: a press on it selects nothing; once they are built a press selects its call", async () => {
  const { b, cb, read } = await cutPane(eventsTo(6, false));
  shownFrame(b, cb);
  await read(eventsOf(6, "other", false));
  oneTurnASlice(b);
  const c = frame(b, cb);
  // The rows built before, so the turn cut back is on the strip.
  expect([b.tlWait, b.ledgerJob != null, b.tlModel.heads[5].steps[1].text]).toEqual([false, true, "first"]);
  const on = callOn(b, c, 5);
  expect(pressed(b, cb, on)).toEqual([null, null]);
  b.buildMax = () => 1e9;
  const next = callOn(b, shownFrame(b, cb), 5);
  expect([next.key, b.tlModel.heads[5].steps[1].text]).toEqual([on.key, "other"]);
  expect(pressed(b, cb, next)).toEqual([next.key, next.key]);
}, 30000);

for (const [how, ms] of [["in the press", 1e9], ["over draws", -1]]) {
  test(`timeline view: a read that cuts back the last turn and reads it again as it was, in the shape of OpenCode's reader, its rows built ${how}: a press on the strip of the frame before selects the heading it did, of the turns before and of the last one`, async () => {
    const { b, cb, read } = await cutPane(bareTo(bareOf(6, "first", false)));
    const c = shownFrame(b, cb);
    const heads = b.tlModel.heads.map((_, ti) => headOn(b, c, ti));
    const keys = ["0:1", "0:2", "0:3", "0:4", "0:5", "0:6"];
    expect(heads.map((x) => x.key)).toEqual(keys);
    const was = b.current().turns;
    const last = was[5];
    await read(bareOf(6, "first", false));
    expect([b.current().turns === was, was.length, was[5] === last]).toEqual([true, 6, false]);
    b.buildMax = () => ms;
    expect(heads.map((x) => pressed(b, cb, x))).toEqual(keys.map((k) => [k, k]));
  }, 30000);
}
for (const [what, sec, then] of [
  ["sent at another time", 0, 7],
  ["and no time on either", null, null],
]) {
  test(`timeline view: the last turn cut back and a turn of the same words ${what} read at its number: a press on its heading on the strip of the frame before selects nothing; on the next strip drawn one selects the heading`, async () => {
    const { b, cb, read } = await cutPane(bareTo(bareOf(6, "first", false, sec)));
    const head = headOn(b, shownFrame(b, cb), 5);
    expect(pressed(b, cb, head)).toEqual([head.key, head.key]);
    const last = b.current().turns[5];
    await read(bareOf(6, "first", false, then));
    const now = b.current().turns[5];
    expect([now === last, now.prompt === last.prompt, now.ts === last.ts]).toEqual([false, true, sec === then]);
    expect(pressed(b, cb, head)).toEqual([null, null]);
    const next = headOn(b, shownFrame(b, cb), 5);
    expect(pressed(b, cb, next)).toEqual([head.key, head.key]);
  }, 30000);
}

// Herdr's stop in the draw after the read, past the strip's model: the frame before stays on
// screen, with its handlers, and the pane has the new model.
const STOP = new Error("stopped by Herdr");
test("timeline view: the last turn cut back in place and another one read at its number, the next draw stopped by Herdr after the strip is placed: a press on the strip of the frame before selects nothing; on the next strip drawn a press selects its call", async () => {
  const { b, cb, read } = await cutPane(eventsTo(6, false));
  const on = callOn(b, shownFrame(b, cb), 5);
  expect(pressed(b, cb, on)).toEqual([on.key, on.key]);
  await read(eventsOf(6, "other", false));
  b.buildMax = () => 1e9;
  b.hatchLayer = () => { throw STOP; };
  let stops = 0;
  try { b.render(cb); } catch (e) { if (e !== STOP) throw e; b.renderOpen = true; stops++; }
  expect([stops, b.tlWait, b.tlModel.heads[5].steps[1].text]).toEqual([1, false, "other"]);
  expect(pressed(b, cb, on)).toEqual([null, null]);
  delete b.hatchLayer;
  const next = callOn(b, shownFrame(b, cb), 5);
  expect(next.key).toBe(on.key);
  expect(pressed(b, cb, next)).toEqual([next.key, next.key]);
}, 30000);

// A turn of pairs of words and a call, then words for half of the turn's time, the last event.
function pairs(n) {
  const at = (sec) => new Date(T0 + sec * 1000).toISOString();
  const out = [{ k: "p", o: "human", t: "Do it", ts: at(0) }];
  for (let i = 0; i < n; i++) out.push({ k: "t", t: `Words ${i}`, ts: at(2 * i + 1) }, { k: "u", n: "Bash", id: `c-${i}`, in: "ls", ts: at(2 * i + 2) }, { k: "x", id: `c-${i}`, f: false, ts: at(2 * i + 3) });
  return [...out, { k: "t", t: "The last words", ts: at(2 * n + 1) }, { k: "m", id: "m-1", u: {}, ts: at(4 * n + 2) }];
}
for (const [n, what, kept] of [
  [STEP_MAX / 2 - 1, "keeps its words, under the most steps a turn keeps, when a call follows them: a press on them on the strip of the frame before selects them", true],
  [STEP_MAX / 2, "keeps no more words, so that a call takes their place: a press on them on the strip of the frame before selects nothing", false],
]) {
  test(`timeline view: a turn that ${what}`, async () => {
    const { b, cb, read } = await cutPane(pairs(n));
    const c = shownFrame(b, cb);
    const on = callOn(b, c, 0, "model");
    const head = headOn(b, c, 0);
    expect(on.key).toBe(`tr:0:1:${2 * n + 1}`);
    expect([pressed(b, cb, on), pressed(b, cb, head)]).toEqual([[on.key, on.key], [head.key, head.key]]);
    const was = b.current().turns;
    const turn = was[0];
    const at = (sec) => new Date(T0 + sec * 1000).toISOString();
    await read([{ k: "u", n: "Bash", id: "c-next", in: "ls", ts: at(4 * n + 3) }, { k: "x", id: "c-next", f: false, ts: at(4 * n + 9) }], false);
    expect([b.current().turns === was, was[0] === turn, was.length]).toEqual([true, true, 1]);
    expect([pressed(b, cb, on), pressed(b, cb, head)]).toEqual([kept ? [on.key, on.key] : [null, null], [head.key, head.key]]);
    expect(b.ledger().rows.find((r) => r.key === on.key).lk).toBe(kept ? "text" : "tool");
    const next = callOn(b, shownFrame(b, cb));
    expect(pressed(b, cb, next)).toEqual([next.key, next.key]);
  }, 30000);
}

// ---- the last turn's bars over the turns before ----
// A session of n turns drawn as one span a lane each, under 2 px, but the first, so long that
// it takes the rest of the strip, and the last, px wide, its steps rows(key, ms long). Up to
// 400 turns the spans before the last turn are apart (over half a pixel), and an unfinished call
// in a turn 2 to 6 px wide has a bar that starts up to 4 px left of it, over them.
function narrowLast(n, px, rows) {
  const gap = Math.min(30, (0.15 * CW) / (n - 1));
  const min = Math.min(48, (0.3 * CW) / n);
  const unit = 60000;
  const rest = CW - gap * (n - 1) - min * (n - 2);
  const heads = [];
  let t0 = T0;
  for (let i = 0; i < n; i++) {
    const key = `0:${i}`;
    const total = Math.round(unit * (i === 0 ? rest - px : i === n - 1 ? px : 0.2));
    const steps = i === n - 1 ? rows(key, total) : [row(key, 0, "you", 0, null), row(key, 1, i % 3 ? "tool" : "subagent", 100, 2000), row(key, 2, "reply", 2000, total)];
    heads.push({ kind: "trh", key, n: i + 1, t0, total, span: total, going: false, cnt: { steps: steps.length, input: 1, model: 1, tools: 1, failed: 0, user: 1, agent: 0 }, steps });
    t0 += total + 5000;
  }
  return heads;
}
const withLast = (heads, steps) => [...heads.slice(0, -1), { ...heads.at(-1), steps }];

// ---- the words beside the last turn's number ----
const said = (M) => M.L.labels.map((l) => [l.text, l.total]);
// The draw of heads after the model prev: the model, and the placings, whole layouts and layouts of
// the last turn alone it made.
function after(prev, heads, now = T0) {
  const m = { ...TL.TL_MADE };
  const M = TL.timelineModel(prev, heads, CW, "clock", now, null);
  return { M, made: [TL.TL_MADE.geo - m.geo, TL.TL_MADE.layout - m.layout, TL.TL_MADE.tail - m.tail] };
}

test("timeline tail: a wide last turn with no start time that starts or stops running, its places kept: the words beside its number are a whole layout's, and kept while it neither starts nor stops", () => {
  const last = { ...doneTurn(1), t0: null };
  const off = [doneTurn(0), last];
  const on = [off[0], { ...last, going: true }];
  expect([said(whole(off)), said(whole(on))]).toEqual([[["1", "1m 00s"], ["2", "1m 00s"]], [["1", "1m 00s"], ["2", "running"]]]);
  let M = whole(off);
  for (const heads of [on, off, on]) {
    const a = after(M, heads);
    // With no start time there is no room for the running turn, so nothing is placed again.
    expect([a.made, a.M.geo === M.geo, a.M.geo.room]).toEqual([[0, 0, 1], true, 0]);
    expect(said(a.M)).toEqual(said(whole(heads)));
    expect(a.M.L.labels).toEqual(whole(heads).L.labels);
    M = a.M;
  }
  // An event that moves nothing: a new heading, running as before.
  const a = after(M, [off[0], { ...on[1], steps: on[1].steps.map((r) => ({ ...r })) }]);
  expect([a.made, a.M.L.labels === M.L.labels]).toEqual([[0, 0, 1], true]);
});

// A session whose prompts carry ts, or no time at all, and no other time (an agent that writes none,
// its transcript opened after it was written): turns of a prompt, a call and a reply, the last open.
function timeless(ts) {
  const s = newSession("made-up", "made-up");
  const prompt = (t) => ({ k: "p", o: "human", t, ...(ts ? { ts } : {}) });
  for (const e of [prompt("one"), { k: "u", n: "Shell" }, { k: "t", t: "Done." }, { k: "d" }, prompt("two"), { k: "u", n: "Shell" }, { k: "t", t: "Fixed." }]) apply(s, e);
  const head = (i, live) => ledgerTurn(s, s.turns[i], 0, live, { ends: false }).head;
  return { s, head, first: head(0, false) };
}

test("timeline tail: a turn of a session with no times that ends with no new step, or is taken up again: the last number says running while it runs and not after", () => {
  const { s, head, first } = timeless(null);
  const on = [first, head(1, true)];
  apply(s, { k: "d" });
  const off = [first, head(1, false)];
  expect([on[1].t0, on[1].steps.length, off[1].steps.length]).toEqual([null, 3, 3]);
  let M = whole(on);
  expect(said(M).at(-1)).toEqual(["2", "running"]);
  for (const [heads, running] of [[off, false], [on, true], [off, false]]) {
    const a = after(M, heads);
    expect(a.made).toEqual([0, 0, 1]);
    expect([said(a.M).at(-1)[1] === "running", said(a.M)]).toEqual([running, said(whole(heads))]);
    M = a.M;
  }
});

test("timeline number: a turn with no length recorded has no length beside its number, as its heading says no times; one with a length has it", () => {
  for (const ts of [null, "2026-11-01T09:00:00Z"]) {
    const { s, head, first } = timeless(ts);
    apply(s, { k: "d" });
    const heads = [first, head(1, false)];
    const M = whole(heads);
    expect(heads.map((h) => headParts(h).total)).toEqual(["no times", "no times"]);
    // Each is wide enough for one (TL_NUM_LEN).
    expect(M.L.labels.every((l) => l.tw >= TL.TL_NUM_LEN)).toBe(true);
    expect(said(M)).toEqual([["1", null], ["2", null]]);
    // The selected turn's number, added at draw time, the same.
    expect(TL.tlNumbers({ ...M.L, labels: [] }, heads, 1).map((l) => [l.text, l.total])).toEqual([["2", null]]);
  }
  // A short one that is recorded: 50 ms, alone on the strip.
  const short = { ...doneTurn(0), total: 50, span: 50 };
  expect(said(whole([short]))).toEqual([["1", "<0.1s"]]);
});

// A turn read from its events, sinceT0(ms) being ms after its prompt: its heading by the ledger.
const sinceT0 = (ms) => new Date(T0 + ms).toISOString();
function headOf(events, live = false, opts = {}) {
  const s = newSession("made-up", "made-up");
  for (const e of events) apply(s, e);
  return ledgerTurn(s, s.turns[0], 0, live, { ends: true, ...opts }).head;
}
const asked = { k: "p", o: "human", t: "one", ts: sinceT0(0) };
// Every event in the prompt's own ms: a call with its result, the reply, the model's count.
const inNone = [asked, { k: "u", n: "Bash", id: "c", ts: sinceT0(0) }, { k: "x", id: "c", f: false, ts: sinceT0(0) }, { k: "t", t: "Done.", ts: sinceT0(0) }, { k: "m", id: "m", u: {}, ts: sinceT0(0) }];
const inMinute = [...inNone, { k: "m", id: "m", u: {}, ts: sinceT0(60000) }];
const noStep = [asked, { k: "u", n: "Bash" }, { k: "t", t: "Done." }];
for (const [what, h, heading, number] of [
  ["ended in the ms it began, its steps with times", () => headOf([...inNone, { k: "d", ts: sinceT0(0) }]), "<0.1s", "<0.1s"],
  ["ended in the ms it began, no step with a time", () => headOf([...noStep, { k: "d", ts: sinceT0(0) }]), "no times", null],
  ["with no time but its prompt's", () => headOf([...noStep, { k: "d" }]), "no times", null],
  ["with no time at all", () => headOf([{ ...asked, ts: undefined }, ...noStep.slice(1), { k: "d" }]), "no times", null],
  ["ended before it began, by its times", () => headOf([...inNone, { k: "d", ts: sinceT0(-5000) }]), null, null],
  ["running, in the ms it began", () => headOf(inNone, true), "running", "running"],
  ["stale, its last event in the ms it began", () => headOf(inNone), "no result", null],
  ["stale, its last event a minute on", () => headOf(inMinute), "no result", "1m 00s"],
  ["being read, its last event so far in the ms it began", () => headOf(inNone, false, { reading: true }), null, null],
  ["being read, its last event so far a minute on", () => headOf(inMinute, false, { reading: true }), null, "1m 00s"],
  ["interrupted in the ms it began", () => headOf([...inNone, { k: "i" }]), "interrupted", "<0.1s"],
  ["interrupted a minute on", () => headOf([...inMinute, { k: "i" }]), "interrupted", "1m 00s"],
]) {
  test(`timeline number: a turn ${what}: what its heading says and what its number on the strip says`, () => {
    const head = h();
    const M = whole([head]);
    expect(M.L.labels[0].tw).toBeGreaterThan(TL.TL_NUM_LEN);
    expect([headParts(head).total, said(M)]).toEqual([heading, [["1", number]]]);
    expect(TL.tlNumbers({ ...M.L, labels: [] }, [head], 0).map((l) => l.total)).toEqual([number]);
  });
}

test("timeline tail: a last turn of 0 ms, its places kept, that ends, or is taken up again: its number says <0.1s once it has ended and nothing while it has not", () => {
  const s = newSession("made-up", "made-up");
  for (const e of [...inNone, { k: "d", ts: sinceT0(0) }, ...inNone.map((e) => ({ ...e, ...(e.id ? { id: `${e.id}2` } : {}) }))]) apply(s, e);
  const head = (i) => ledgerTurn(s, s.turns[i], 0, false, { ends: true }).head;
  const first = head(0);
  const open = [first, head(1)];
  apply(s, { k: "d", ts: sinceT0(0) });
  const ended = [first, head(1)];
  expect([open[1].steps.length, ended[1].steps.length, open[1].total, ended[1].total]).toEqual([3, 3, null, 0]);
  let M = whole(open);
  expect(said(M)).toEqual([["1", "<0.1s"], ["2", null]]);
  for (const [heads, words] of [[ended, "<0.1s"], [open, null], [ended, "<0.1s"]]) {
    const a = after(M, heads);
    expect([a.made, said(a.M)]).toEqual([[0, 0, 1], [["1", "<0.1s"], ["2", words]]]);
    expect(a.M.L.labels).toEqual(whole(heads).L.labels);
    M = a.M;
  }
});

test("timeline tail: only the last turn laid out again gives the spans a whole layout gives, where its bars reach back over the spans before it: an unfinished call that comes, ends or stays, in a turn 2 to 6 px wide", () => {
  let reached = 0;
  // From 206 turns a turn held at its least width is under 2 px, and that least is under 2.02.
  for (const n of [210, 300, 400, 500]) {
    for (const px of [2.02, 2.4, 3, 4, 5.2, 5.98, 7]) {
      const you = (key) => row(key, 0, "you", 0, null);
      const open = (key, at) => [you(key), row(key, 1, "noresult", at, null, true)];
      const done = (key, at, total) => [you(key), row(key, 1, "tool", at, Math.max(at, Math.min(total, at + 100)))];
      const sub = (key, at) => [you(key), { ...row(key, 1, "subagent", at, null, true) }];
      const note = (key, at) => [you(key), row(key, 1, "text", at, null)];
      const shapes = { open: (k) => open(k, 1000), late: (k, t) => open(k, t - 10), done: (k, t) => done(k, 1000, t), sub: (k) => sub(k, 1000), note: (k) => note(k, 1000) };
      for (const from of Object.keys(shapes)) {
        const heads = narrowLast(n, px, shapes[from]);
        const total = heads.at(-1).total;
        let M = TL.timelineModel(null, heads, CW, "clock", T0, null);
        const w = M.geo.turns.at(-1).w;
        expect([n, px, Math.abs(w - px) < 0.05]).toEqual([n, px, true]);
        const tx = M.geo.turns.at(-1).x;
        const before = [...M.L.spans.values()].flat().filter((sp) => sp[0] < tx - 1 && sp[1] > tx);
        if (before.length && px < 6) reached++;
        // Event after event in the last turn, its length the same: each shape in turn.
        for (const to of [...Object.keys(shapes), from]) {
          const next = withLast(M.heads, shapes[to](heads.at(-1).key, total));
          const m = { ...TL.TL_MADE };
          const N = TL.timelineModel(M, next, CW, "clock", T0, null);
          expect([n, px, from, to, TL.TL_MADE.geo - m.geo, TL.TL_MADE.layout - m.layout, TL.TL_MADE.tail - m.tail]).toEqual([n, px, from, to, 0, 0, 1]);
          const W = TL.timelineLayout(next, CW, "clock", T0, null, N.geo);
          expect([n, px, from, to, [...N.L.spans].sort()]).toEqual([n, px, from, to, [...W.spans].sort()]);
          expect([N.L.fails, N.L.ticks, N.L.gaps, N.L.labels, N.L.grow]).toEqual([W.fails, W.ticks, W.gaps, W.labels, W.grow]);
          M = N;
        }
      }
    }
  }
  // Not for nothing: in many of these an unfinished call's bar was drawn over earlier spans.
  expect(reached).toBeGreaterThan(20);
});

test("timeline tail: a span that ends 4 to 4.5 px left of the last turn is one an unfinished call's bar there joins: when the call ends, the tail gives a whole layout's spans", () => {
  // Every turn but the first held at the least width, 2 to 2.2 px, so the last turn's unfinished
  // call starts 3.8 to 4 px left of it; the turn before it has no call, and the call of the one
  // before that ends 4 to 4.4 px left of it: past 4 px, within the half pixel of the bar.
  const held = (n, last) => {
    const heads = [];
    let t0 = T0;
    for (let i = 0; i < n; i++) {
      const key = `0:${i}`;
      const total = i === 0 ? 3600000 : 1000;
      const calls = i === n - 1 ? last(key) : i === n - 3 ? [row(key, 1, "tool", 100, total)] : [];
      heads.push({ kind: "trh", key, n: i + 1, t0, total, span: total, going: false, cnt: { steps: 1 + calls.length, input: 1, model: 0, tools: calls.length, failed: 0, user: 1, agent: 0 }, steps: [row(key, 0, "you", 0, null), ...calls] });
      t0 += total + 5000;
    }
    return heads;
  };
  const tools = (L) => L.spans.get("tools|tools|0");
  for (let n = 191; n <= 205; n++) {
    const open = held(n, (key) => [row(key, 1, "noresult", 0, null, true)]);
    const M = TL.timelineModel(null, open, CW, "clock", T0, null);
    const tx = M.geo.turns.at(-1).x;
    const before = M.geo.turns.at(-3);
    const off = tx - (before.x + before.w);
    expect([n, off > 4 && off < 4.5]).toEqual([n, true]);
    // The two bars are one span, from the call before to the last turn's torn end.
    expect([n, tools(M.L).length, tools(M.L)[0][0] < tx - 4.5, tools(M.L)[0][2]]).toEqual([n, 1, true, 1]);
    const done = withLast(open, held(n, (key) => [row(key, 1, "tool", 0, 100)]).at(-1).steps);
    const m = { ...TL.TL_MADE };
    const N = TL.timelineModel(M, done, CW, "clock", T0, null);
    expect([n, TL.TL_MADE.geo - m.geo, TL.TL_MADE.layout - m.layout, TL.TL_MADE.tail - m.tail]).toEqual([n, 0, 0, 1]);
    const W = TL.timelineLayout(done, CW, "clock", T0, null, N.geo);
    expect([n, tools(W).length, tools(N.L)]).toEqual([n, 2, tools(W)]);
    expect([n, [...N.L.spans].sort()]).toEqual([n, [...W.spans].sort()]);
  }
});

// ---- what is drawn on top, and what a press there selects ----
// Three made-up turns, 60 s long and the last one running 50 s in, whose bars overlap in every
// way the rule has: an ordinary call and a subagent's on one track, each inside the other and
// listed in either order, a failed call with both, a user's, an agent's and a background message
// at one time, and, running, bars that grow on both tracks.
function overlapTurns() {
  const turnOf = (i, rows, o = {}) => {
    const key = `0:${i}`;
    const steps = rows.map(([lk, a, z], j) => ({ ...row(key, j, lk, a, z === "open" ? null : z, z === "open") }));
    return {
      kind: "trh", key, n: i + 1, t0: T0 + i * 100000, total: 60000, span: 60000, going: false,
      cnt: { steps: steps.length, input: 1, model: 1, tools: 1, failed: 1, user: 1, agent: 1 }, steps, ...o,
    };
  };
  return [
    turnOf(0, [["context", 60, null], ["you", 0, null], ["agent", 30, null], ["tool", 1000, 40000], ["subagent", 4000, 24000], ["tool", 6000, 22000], ["subagent", 8000, 12000], ["failed", 18000, 20000], ["reply", 50000, 60000]]),
    turnOf(1, [["you", 0, null], ["context", 20, null], ["agent", 40, null], ["subagent", 1000, 50000], ["tool", 5000, 30000], ["subagent", 9000, 45000], ["tool", 34000, 38000], ["failed", 25000, 36000], ["subagent", 26000, 28000], ["text", 55000, null], ["reply", 56000, 60000]]),
    turnOf(2, [["agent", 0, null], ["you", 0, null], ["subagent", 1000, "open"], ["tool", 20000, "open"], ["subagent", 10000, "open"], ["failed", 24000, 30000], ["subagent", 28000, "open"]], { total: null, span: 30000, going: true }),
  ];
}
// The layers the pane drew on the lanes, in the order drawn: [key, growing]. A growing layer's
// key is found by its place and colour.
function layersOf(c, M) {
  const bg = (id) => own(c, id)?.find((e) => e[0] === "bg")?.[1];
  const out = [];
  for (const id of ids(c)) {
    const m = /^th-tl-(input|model|tools)-([a-z]+)-([01])$/.exec(id);
    if (m) { out.push([`${m[1]}|${m[2]}|${m[3]}`, false]); continue; }
    if (!/^th-tl-grow-\d+$/.test(id)) continue;
    const top = own(c, id).find((e) => e[0] === "top")[1];
    const keys = [...new Set(M.grow.map((g) => g.k))].filter((k) => (k.endsWith("|1") ? 8 : 2) === top % TL.TL_LANE && JSON.stringify(bg(`th-tl-${k.slice(0, -2).replace("|", "-")}-0`)) === JSON.stringify(bg(id)));
    expect([id, keys.length]).toEqual([id, 1]);
    out.push([keys[0], true]);
  }
  return out;
}

test("timeline view: one order for what is drawn and what a press selects: at every bar, the step a press gets is of the layer drawn last there; on one track an ordinary call is over a subagent's", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "3"));
  const heads = overlapTurns();
  try {
    setSystemTime(new Date(heads.at(-1).t0 + 50000));
    b.ledger();
    b.ledgerMemo.totals = { ...b.ledgerMemo.totals, heads };
    const c = shownFrame(b, cb);
    const M = b.tlModel;
    expect(M.heads === heads).toBe(true);
    const layers = layersOf(c, M);
    expect(layers.filter((x) => x[1]).length).toBe(3);
    expect(new Set(layers.map(String)).size).toBe(layers.length);
    const over = (k, g, x) => (g ? M.grow.filter((e) => e.k === k).some((e) => e.x0 <= x && x <= e.x1) : M.L.spans.get(k).some((sp) => sp[0] <= x && x <= sp[1]));
    const wrong = [];
    let met = 0;
    heads.forEach((h, ti) => h.steps.forEach((r, si) => {
      const box = TL.tlBar(M.L, heads, ti, si);
      const lane = LEDGER_KINDS[r.lk].lane;
      for (const f of [0.02, 0.2, 0.5, 0.8, 0.98]) {
        const x = box.x0 + f * (box.x1 - box.x0);
        const there = layers.filter(([k, g]) => k.startsWith(`${lane}|`) && over(k, g, x));
        // 11 px down the lane, where a full bar and a half one both are.
        const hit = TL.timelineHit(M.L, heads, x, lane, Date.now(), 11);
        const hti = M.L.index.get(hit.turn);
        const hs = heads[hti].steps.findIndex((e) => e.key === hit.key);
        const got = heads[hti].steps[hs];
        const hb = TL.tlBar(M.L, heads, hti, hs);
        const layer = [`${lane}|${LEDGER_KINDS[got.lk].ink}|${hb.track}`, Boolean(heads[hti].going && got.open)];
        if (there.length > 1) met++;
        if (String(there.at(-1)) !== String(layer)) wrong.push([r.key, f, String(there.at(-1)), String(layer)]);
      }
    }));
    expect(wrong).toEqual([]);
    expect(met).toBeGreaterThan(40);
    // The ordinary call over the subagent's, wider or narrower, listed first or not, drawn or growing.
    const keys = layers.map(([k, g]) => `${k}${g ? "+" : ""}`);
    for (const [low, high] of [["tools|sub|1", "tools|tools|1"], ["tools|sub|0", "tools|tools|0"], ["tools|sub|1+", "tools|tools|1+"], ["tools|tools|0", "tools|sub|1"], ["tools|tools|1", "tools|failed|1"], ["tools|failed|1", "tools|sub|0+"], ["tools|sub|0+", "tools|sub|1+"], ["input|context|0", "input|agent|0"], ["input|agent|0", "input|user|0"]]) {
      expect([low, high, keys.includes(low), keys.includes(high), keys.indexOf(low) < keys.indexOf(high)]).toEqual([low, high, true, true, true]);
    }
  } finally {
    setSystemTime();
  }
});

test("timeline press: an ordinary call and a subagent's on one track: the ordinary call, wider or narrower, whichever is listed first; of two of one kind the narrower", () => {
  const heads = overlapTurns();
  const now = heads.at(-1).t0 + 50000;
  const L = TL.timelineLayout(heads, CW, "clock", now, null);
  const at = (ti, ms, ly = 11) => {
    const t = TL.tlBox(L, ti);
    const hit = TL.timelineHit(L, heads, t.x + (ms / L.geo.walls[ti]) * t.w, "tools", now, ly);
    return heads[ti].steps.findIndex((r) => r.key === hit.key);
  };
  // In the first turn, on the half track: a subagent's 4 to 24 s, a call 6 to 22 s, a subagent's
  // 8 to 12 s inside it and a failed call 18 to 20 s.
  expect([at(0, 5000), at(0, 10000), at(0, 15000), at(0, 19000), at(0, 23000)]).toEqual([4, 5, 5, 7, 4]);
  // In the second: a call 5 to 30 s, a subagent's 9 to 45 s, a call 34 to 38 s, a failed call 25
  // to 36 s and a subagent's 26 to 28 s.
  expect([at(1, 7000), at(1, 12000), at(1, 27000), at(1, 37000), at(1, 42000), at(1, 42000, 4)]).toEqual([4, 4, 7, 6, 5, 3]);
  // Running: the growing bars over all, half height over full, the ordinary call over a
  // subagent's that began before or after it; above the half track the full one.
  expect([at(2, 12000), at(2, 25000), at(2, 35000), at(2, 35000, 4)]).toEqual([4, 3, 3, 2]);
});

test("timeline press: on a turn under 2 px a subagent's call ranks as an ordinary one, as its span is drawn: of the two in one turn the one listed first, and over a neighbour's ordinary call the pressed turn's own", () => {
  const turnOf = (i, kinds) => {
    const key = `0:${i}`;
    return {
      kind: "trh", key, n: i + 1, t0: T0 + i * 100000, total: 60000, span: 60000, going: false,
      cnt: { steps: 1 + kinds.length, input: 1, model: 0, tools: kinds.length, failed: 0, user: 1, agent: 0 },
      steps: [row(key, 0, "you", 0, null), ...kinds.map((lk, j) => row(key, j + 1, lk, 1000 * (j + 1), 50000))],
    };
  };
  const heads = Array.from({ length: 2000 }, (_, i) => turnOf(i, i === 1000 ? ["subagent"] : i === 400 ? ["subagent", "tool"] : i === 600 ? ["tool", "subagent"] : i % 100 === 0 ? [] : ["tool"]));
  const L = TL.timelineLayout(heads, CW, "clock", T0, null);
  expect(L.turns[1000].w).toBeLessThan(1);
  // Under 2 px the lane has one layer, the ordinary call's, and the spans of all these join.
  expect([...L.spans.keys()].filter((k) => k.startsWith("tools|"))).toEqual(["tools|tools|0"]);
  const at = (ti, f) => TL.timelineHit(L, heads, TL.tlBox(L, ti).x + f * TL.tlBox(L, ti).w, "tools", T0, 8);
  // The 1 px span of the turn before, an ordinary call's, is under each of these presses too.
  expect(TL.tlBox(L, 999).x + 1).toBeGreaterThan(TL.tlBox(L, 1000).x + 0.5 * TL.tlBox(L, 1000).w);
  for (const f of [0.1, 0.3, 0.5]) {
    expect([f, at(1000, f)]).toEqual([f, { turn: "0:1000", key: "tr:0:1000:1" }]);
    expect([f, at(400, f)]).toEqual([f, { turn: "0:400", key: "tr:0:400:1" }]);
    expect([f, at(600, f)]).toEqual([f, { turn: "0:600", key: "tr:0:600:1" }]);
  }
});

test("timeline view: a press acts on the strip as it was drawn: past a growing bar's drawn end it gets no call the clock has reached since; drawn again, it does", async () => {
  // One turn cut just after its second call, so it runs: that call's bar grows to now.
  const file = fixture("--only", "1");
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  writeFileSync(file, `${lines.slice(0, lines.findLastIndex((l) => l.includes('"tool_use"')) + 1).join("\n")}\n`);
  const { b, cb } = await dockPane(file);
  try {
    const { t0, span } = b.ledger().totals.heads.at(-1);
    // Two moments in one room (timeline.js liveRoom), the one after the call's own.
    const room = TL.liveRoom(span) * TL.TL_ROOM_GROW;
    const at = (f) => setSystemTime(new Date(t0 + f * room));
    H.state.terminals[0].status = "working";
    b.ledgerMemo = null;
    at(0.7);
    const c = shownFrame(b, cb);
    const M = b.tlModel;
    expect([M.geo.room, M.grow.length, M.heads.length]).toEqual([room, 1, 1]);
    const open = M.heads[0].steps.find((r) => r.open);
    const x = M.geo.turns[0].x + 0.8 * M.geo.turns[0].w;
    expect(M.grow[0].x1).toBeLessThan(x - 8);
    const pressed = (calls, px) => {
      handlerAfterId(calls, "th-tl-lanes", "on_mouse_down")({ local_position: { x: px, y: 2 * TL.TL_LANE + 8 }, position: { x: px, y: 0 } }, cb);
      return b.tsel;
    };
    // The clock moves on with no draw: the strip is the one drawn at 0.7.
    at(0.85);
    expect(pressed(c, x)).toBe(M.heads[0].key);
    expect(pressed(c, M.grow[0].x1 - 2)).toBe(open.key);
    // Drawn again at 0.85, the bar is under the same press.
    expect(pressed(frame(b, cb), x)).toBe(open.key);
  } finally {
    setSystemTime();
    H.state.terminals[0].status = "idle";
  }
});

// ---- an older Herdr, which paints no path ----
test("timeline view: where Herdr paints no path, every unfinished call in view is drawn: up to 40 of a layer with a torn end, the ones after with a straight one", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "3"));
  // 50 made-up turns, each with an unfinished call that runs to its end.
  const heads = doneTurns(50).map((h) => ({ ...h, steps: [row(h.key, 0, "you", 0, null), row(h.key, 1, "noresult", 10000, null, true), row(h.key, 2, "reply", 10000, 60000)] }));
  b.ledger();
  b.ledgerMemo.totals = { ...b.ledgerMemo.totals, heads };
  const c = shownFrame(b, cb);
  const spans = b.tlModel.L.spans.get("tools|tools|0");
  expect([spans.length, spans.every((sp) => sp[2] === 1), spans.every((sp, k) => k === 0 || sp[0] - spans[k - 1][1] > 2)]).toEqual([50, true, true]);
  // The layer's divs, by where each starts: the bars' own and a torn end's rows.
  const lefts = own(c, "th-tl-tools-tools-0").filter((e) => e[0] === "left").map((e) => e[1]).slice(1);
  const divs = spans.map(([a]) => lefts.filter((x) => Math.abs(x - a) <= 1.5).length);
  expect(divs.filter((n) => n === 0).length).toBe(0);
  expect([divs.slice(0, 40).every((n) => n > 1), divs.slice(40).every((n) => n === 1)]).toEqual([true, true]);
});

// ---- the step count of kept places ----
test("timeline model: an event in the running turn that keeps its places counts its steps: at 1,024 steps one more makes 1,025, and the next room step keeps the places for the bounded build", () => {
  const done = doneTurns(255);
  const key = "0:255";
  const t0 = T0 + 255 * 100000;
  const last = (k) => ({
    kind: "trh", key, n: 256, t0, total: null, span: 60000, going: true,
    cnt: { steps: k, input: 1, model: k - 1, tools: 0, failed: 0, user: 1, agent: 0 },
    steps: [row(key, 0, "you", 0, null), ...Array.from({ length: k - 1 }, (_, j) => row(key, j + 1, "text", 1000 * (j + 1), null))],
  });
  const r0 = TL.liveRoom(600000);
  const heads = [...done, last(4)];
  const M = TL.timelineModel(null, heads, CW, "clock", t0 + r0 - 2000, null);
  expect([M.geo.steps, M.L.zmax]).toEqual([1024, 256]);
  let m = { ...TL.TL_MADE };
  const since = () => [TL.TL_MADE.geo - m.geo, TL.TL_MADE.layout - m.layout, TL.TL_MADE.tail - m.tail];
  const more = [...done, last(5)];
  const N = TL.timelineModel(M, more, CW, "clock", t0 + r0 - 1000, null);
  expect(since()).toEqual([0, 0, 1]);
  expect([N.geo.steps, N.L.zmax, N.L.geo === N.geo]).toEqual([1025, 1025 / 4, true]);
  expect(N.geo.turns).toBe(M.geo.turns);
  sameStrip(N, TL.timelineModel(null, more, CW, "clock", t0 + r0 - 1000, null));
  // A heading with the same number of steps keeps the placing itself.
  expect(TL.timelineModel(N, [...done, last(5)], CW, "clock", t0 + r0 - 1000, null).geo).toBe(N.geo);
  // The room's next step, with no event more: past 1,024 steps, so nothing is placed whole.
  m = { ...TL.TL_MADE };
  const S = TL.timelineModel(N, more, CW, "clock", t0 + r0 + 1000, null);
  expect([...since(), S.geo.stale, S.geo.steps]).toEqual([0, 0, 1, true, 1025]);
});

// ---- the room of a turn's number ----
// A number is drawn with a 1 px line at its left, 5 px of padding and then its digits, 10.5 px.
// A wide digit takes 7 px there (measured on the test machine's UI font), so this is the room a
// number needs, from its line's left edge to its last digit's end.
const DIGIT_PX = 7;
const numNeeds = (text) => 1 + 5 + text.length * DIGIT_PX;
const NUM_WIDTHS = [1143, 1370, 1440, 1479];
const NUM_TURNS = [9, 99, 999, 1234, 2000, 10000];
// The turns selected in turn, n turns long: none, the first, one inside, and the last two.
const numPicks = (n) => [null, 0, Math.floor(n * 0.617), n - 2, n - 1];

test("timeline number room: a number of 1 to 5 digits has its line, its padding and 7 px a digit", () => {
  expect(TL.TL_NUM_PAD).toBe(6);
  const short = [1, 2, 3, 4, 5].filter((k) => TL.tlNumW("8".repeat(k)) < numNeeds("8".repeat(k)));
  expect(short).toEqual([]);
});

test("timeline number room: the last number's digits end inside the strip at 9 to 10,000 turns, with a turn selected or none", () => {
  const cut = [];
  for (const n of NUM_TURNS) {
    const heads = doneTurns(n);
    for (const cw of NUM_WIDTHS) {
      const L = TL.timelineLayout(heads, cw, "clock", T0, null);
      for (const ti of numPicks(n)) {
        const nums = TL.tlNumbers(L, heads, ti);
        const last = nums.at(-1);
        // The last turn's number, or the selected one's in its place.
        expect([n, n - 1]).toContain(Number(last.text));
        const past = last.x + numNeeds(last.text) - cw;
        if (past > 0) cut.push([cw, n, ti, last.text, Math.round(past * 10) / 10]);
      }
    }
  }
  expect(cut).toEqual([]);
});

test("timeline number room: drawn in the pane, every number's digits end inside the strip, from its drawn left over its line and padding", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "3"));
  shownFrame(b, cb);
  // The numbers drawn, each with the left, the padding, the line and the text size it is under.
  const numbersDrawn = (c) => {
    const out = [];
    let at = null;
    for (const [name, v] of own(c, "th-tl-labels")) {
      if (name === "left") at = { x: v };
      else if (at && ["pl", "border_l", "text_size"].includes(name)) at[name] = v;
      else if (at && name === "child" && typeof v === "string" && /^\d+$/.test(v)) out.push({ ...at, text: v });
    }
    return out;
  };
  const cut = [];
  for (const n of NUM_TURNS) {
    const heads = doneTurns(n);
    for (const cw of NUM_WIDTHS) {
      b.paneW = b.width = cw + TL.TL_GUT + 12;
      for (const ti of numPicks(n)) {
        H.rec = [];
        b.timelineView(theme, { totals: { heads }, sessions: b.sessions, whole: b.current()?.turns ?? null, partial: false }, ti == null ? [] : [{ key: heads[ti].key }], ti == null ? -1 : 0, trajInks(theme, true));
        const c = H.rec;
        H.rec = null;
        expect([b.tlModel.heads === heads, b.tlModel.L.cw]).toEqual([true, cw]);
        const nums = numbersDrawn(c);
        expect(nums.map((l) => l.text)).toEqual(TL.tlNumbers(b.tlModel.L, heads, ti).map((l) => l.text));
        for (const l of nums) {
          expect([l.pl, l.border_l, l.text_size]).toEqual([5, 1, 10.5]);
          const past = l.x + numNeeds(l.text) - cw;
          if (past > 0) cut.push([cw, n, ti, l.text, Math.round(past * 10) / 10]);
        }
      }
    }
  }
  expect(cut).toEqual([]);
});

// ---- a seeded fuzz of the strip's draws ----
// FUZZ_RUNS made-up sessions, each drawn by tlDraw as the pane draws it, over changes between
// draws. The seed is fixed, so every run of this test draws the same sessions; a failure names
// its run and the changes planned. The shapes, by the run's number: one in eight starts EMPTY, one
// in eight with ONE turn, the rest with 2 to 601 turns of four steps (from 257 they are past
// TL_BUILD_BARS); each is drawn at least twice before anything changes. The last turn runs: young
// with its events a few seconds in, with an open call, or 16 days old. About half start from
// nothing, so the first draws wait for the bounded build; the others from a whole model. A draw's
// build has 1 to 6 looks at the clock. The changes, one or more a run, up to three draws after
// each: working on and off, another width, the last turn ended, an event in it, the clock a
// little on and far on (the running turn's room steps), a turn added, a clear (no turns) and
// another session picked, in a build or out of one.
// What holds: nothing throws; a draw waits only with no strip; a strip shown is of that draw's
// heads, with their places; the press and the numbers answer; every build ends. The ended strip
// with no running turn is a whole build's, field for field (but for the copies the next event is
// laid out from). With one, its places end under 3
// TL_SLACK px from a whole build's, and the spans, marks, ticks, breaks and growing bars on them
// are a whole layout's there.
// Not covered: zoomed views, the steps scale, the pane's frame and paint, a stopped draw,
// subagents and more than one call at a time.
const FUZZ_SEED = 299;
const FUZZ_RUNS = 320;
test("timeline seeded fuzz: 320 made-up sessions, the empty and the one-turn one among them, over working on and off, events, turns added, clears, picks, widths and the clock, from nothing or not: every draw shows its own heads, no draw throws, every build ends, as a whole build's strip", () => {
  let seed = FUZZ_SEED;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const ri = (n) => Math.floor(rnd() * n);
  const DAY = 86400000;
  const WIDTHS = [1370, 1143, 700, 300, 41];
  const OPS = ["on", "off", "width", "finish", "event", "tick", "tick", "tick", "tick", "bigtick", "add", "add", "clear", "pick"];
  const ended = (i, t0) => {
    const key = `0:${i}`;
    const tot = 1000 + ri(ri(3) ? 120000 : 3000000);
    return {
      kind: "trh", key, n: i + 1, t0, total: tot, span: tot, going: false, cnt: { steps: 4, input: 1, model: 1, tools: 2, failed: 1, user: 1, agent: 0 },
      steps: [row(key, 0, "you", 0, null), row(key, 1, "tool", 100, Math.min(tot, 5000)), row(key, 2, "failed", 200, Math.min(tot, 9000)), row(key, 3, "reply", Math.min(tot - 1, 10000), tot)],
    };
  };
  const newest = (i, t0, kind, going, span) => {
    const key = `0:${i}`;
    const base = { kind: "trh", key, n: i + 1, t0, total: null, cnt: { steps: 3, input: 1, model: 1, tools: 1, failed: 0, user: 1, agent: 0 } };
    if (kind === "open") return { ...base, span: 6000, going, steps: [row(key, 0, "you", 0, null), row(key, 1, "tool", 1000, 5000), row(key, 2, going ? "running" : "noresult", 6000, null, true)] };
    return { ...base, span, going, steps: [row(key, 0, "you", 0, null), row(key, 1, "tool", Math.min(span, 1000), Math.min(span, 1500000)), row(key, 2, "reply", Math.min(span, 10000), span)] };
  };
  const wrong = [];
  const seen = { cold: 0, waits: 0, over: 0, add: 0, clear: 0, pick: 0, clearIn: 0, pickIn: 0, whole: 0, kept: 0 };
  const least = { empty: 99, one: 99 };
  for (let run = 0; run < FUZZ_RUNS && wrong.length < 5; run++) {
    const how = run % 8 === 0 ? "empty" : run % 8 === 1 ? "one" : "some";
    let n = how === "some" ? 1 + ri(600) : 0;
    let t = T0;
    let done = [];
    for (let i = 0; i < n; i++) { done.push(ended(i, t)); t += 1000 + ri(200000); }
    const kind = ["live", "live", "live", "open", "grown"][ri(5)];
    let lt0 = t;
    let span = kind === "grown" ? 60000 : 500 + ri(5000);
    let now = lt0 + (kind === "grown" ? 16 * DAY : kind === "open" ? 6000 + ri(600000) : span + ri(20000));
    let cw = WIDTHS[ri(5)];
    let going = true;
    let last = how === "empty" ? null : newest(n, lt0, kind, true, span);
    let heads = last ? [...done, last] : [];
    const cold = ri(2) === 0;
    let M = null;
    let J = null;
    let looks = 0;
    let draws = 0;
    const clock = () => ++looks;
    const plan = [];
    const say = (what) => wrong.push(`run ${run} (${how}, ${kind}, ${cold ? "from nothing" : "from a model"}: ${plan.join(" ")}): ${what}`);
    const draw = () => {
      const D = TL.tlDraw(M, J, heads, cw, now, looks + 1 + ri(6), clock);
      M = D.M;
      J = D.J;
      draws++;
      if (D.wait !== !M) say(`waits ${D.wait} with ${M ? "a strip" : "none"}`);
      if (D.wait) seen.waits++;
      if (!M) return;
      if (J) seen.over++;
      for (const lane of [...TL.TL_LANES, null]) for (const x of [0, M.cw / 3, M.cw - 1]) TL.timelineHit(M.L, M.heads, x, lane, now, lane ? 8 : null);
      TL.tlNumbers(M.L, M.heads, heads.length ? ri(heads.length) : undefined);
      if (M.heads !== heads || M.geo.turns.length !== heads.length || M.L.turns !== M.geo.turns || !M.geo.turns.every((x, i) => x.key === heads[i].key)) say("a strip of other heads");
    };
    try {
      if (cold) seen.cold++;
      else M = TL.timelineModel(null, heads, cw, "clock", now, null);
      for (let k = 0; k < 1 + ri(14); k++) plan.push(OPS[ri(14)]);
      for (let k = 0; k < 2; k++) draw();
      if (how !== "some") least[how] = Math.min(least[how], draws);
      for (const op of plan) {
        if (op in seen) seen[op]++;
        if (J && `${op}In` in seen) seen[`${op}In`]++;
        if (op === "clear") {
          n = 0;
          done = [];
          last = null;
          heads = [];
        } else if (op === "pick") {
          n = ri(600);
          t = T0 + 7 * DAY;
          done = [];
          for (let i = 0; i < n; i++) { done.push(ended(i, t)); t += 1000 + ri(200000); }
          lt0 = t;
          now = lt0 + span + ri(20000);
          last = newest(n, lt0, kind, true, span);
          going = true;
          heads = [...done, last];
        } else if (op === "add") {
          if (last) {
            done = [...done, { ...last, going: false, total: Math.max(1, last.span) }];
            n++;
          }
          now += 1000;
          lt0 = now;
          span = 500;
          going = true;
          last = newest(n, lt0, kind === "grown" ? "live" : kind, true, span);
          heads = [...done, last];
        } else if (op === "width") cw = WIDTHS[ri(5)];
        else if (op === "tick") now += ri(kind === "live" ? 8000 : 60000);
        else if (op === "bigtick") now += ri(400000);
        else if (!last) heads = [];
        else if (op === "on" || op === "off") {
          going = op === "on";
          last = newest(n, lt0, kind, going, span);
          if (!going && rnd() < 0.5) last = { ...last, total: Math.max(span, now - lt0) };
          heads = [...heads.slice(0, -1), last];
        } else if (op === "finish") heads = [...heads.slice(0, -1), { ...last, going: false, total: Math.max(1, last.span) }];
        else if (op === "event") {
          if (kind === "live" && now - lt0 > span) span = now - lt0;
          last = newest(n, lt0, kind, going, span);
          heads = [...heads.slice(0, -1), last];
        }
        for (let k = 0; k < ri(4); k++) draw();
      }
      draw();
      for (let k = 0; k < 3000 && (J || !M); k++) draw();
      if (J || !M) { say("a build that does not end"); continue; }
      draw();
      const W = TL.timelineModel(null, heads, cw, "clock", now, null);
      if (!heads.at(-1)?.going) { seen.whole++; sameStrip({ ...M, L: { ...M.L, cut: null } }, { ...W, L: { ...W.L, cut: null } }); continue; }
      seen.kept++;
      expect([M.cw, M.geo.stale, Math.abs(M.geo.total - W.geo.total) < 3 * TL.TL_SLACK]).toEqual([cw, undefined, true]);
      const Y = TL.timelineLayout(heads, cw, "clock", now, null, M.geo);
      const laid = (L) => [[...L.spans].sort(), L.fails, L.ticks, L.gaps, L.grow];
      expect(laid(M.L)).toEqual(laid(Y));
    } catch (e) {
      say(String(e?.message ?? e).slice(0, 400));
    }
  }
  expect(wrong).toEqual([]);
  // What the seed covered; a shape under its floor is named with its count.
  const floor = { cold: 100, waits: 50, over: 20, add: 50, clear: 25, pick: 25, clearIn: 2, pickIn: 2, whole: 25, kept: 25 };
  expect(Object.entries(floor).filter(([k, v]) => seen[k] < v).map(([k, v]) => `${k} ${seen[k]} under ${v}`)).toEqual([]);
  expect([least.empty >= 2 && least.empty < 99, least.one >= 2 && least.one < 99]).toEqual([true, true]);
}, 60000);
