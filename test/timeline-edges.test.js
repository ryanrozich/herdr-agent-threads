// bun test: TRD-23 slice 1, the timeline at its edges: a session with no turns, the heads
// changing while the strip is built from nothing, the spans the last turn reaches back over,
// what is drawn on top and what a press there selects, and an older Herdr's torn bars. The
// model is timeline.js (test/timeline.test.js); the pane is on the render harness.
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as TL from "../mods/agent-threads/timeline.js";
import { fixture, frame, H, handlerAfterId, makeCx, pane, settle, setup, Threads, unsliced } from "./render-harness.js";

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

// A Trajectory pane docked along the bottom, w px wide, its rows built whole.
async function dockPane(file, w = 1440) {
  await pane(file);
  const state = H.state;
  state.shared["threads.byTerminal"] = { t4: { pane: "p2" } };
  state.panes.push({ pane: "p5", tab: "A", terminal: null, mod: "agent-threads" });
  const props = state.props;
  state.props = { ...props, view: "trajectory", dock: "bottom" };
  const b = unsliced(new Threads());
  const cb = makeCx();
  b.init(state.props, cb);
  await settle(b);
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
