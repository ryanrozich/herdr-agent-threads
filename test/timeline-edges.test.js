// bun test: TRD-23 slice 1, the timeline at its edges: a session with no turns, the heads
// changing while the strip is built from nothing, the spans the last turn reaches back over,
// what is drawn on top and what a press there selects, and an older Herdr's torn bars. The
// model is timeline.js (test/timeline.test.js); the pane is on the render harness.
import { test, expect, setSystemTime } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as TL from "../mods/agent-threads/timeline.js";
import { LEDGER_KINDS } from "../mods/agent-threads/ledger.js";
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

// ---- a seeded fuzz of the strip's draws ----
// FUZZ_RUNS made-up sessions, each drawn by tlDraw as the pane draws it, over changes between
// draws. The seed is fixed, so each run of the test draws the same sessions; a failure names its
// run and the changes so far. Shapes, by the run's number: one in eight starts EMPTY, one in eight
// with ONE turn, the rest with 2 to 400 turns (256 turns of 4 steps and more are past
// TL_BUILD_BARS); each is drawn twice before anything changes. About half start from nothing, so
// the first draws wait for the bounded build; the others from a whole model. A draw's build has 1
// to 6 looks at the clock. Changes, up to 12 a run, up to 3 draws after each: working on and off,
// an event in the last turn (a call more, its last call open or ended), the last turn ended, a
// turn added, a clear (no turns), another session picked, another width, the clock a little on
// and far on (the running turn's room steps). What holds in every draw: nothing throws; it waits
// only with no strip; a strip shown is of that draw's heads, with their places; the press and
// the numbers answer. At the end: every build ends in 400 draws; a strip with no running turn is a
// whole build's, field for field; with one, its places are under 3 TL_SLACK px from a whole
// build's and what is laid on them is what a whole layout lays.
// Not covered: zoomed views, the steps scale, the pane's frame and paint, a stopped draw,
// subagents and more than one call at a time.
const FUZZ_SEED = 299;
const FUZZ_RUNS = 320;
function seeded(seed) {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}
// One session's heads under change: make(n) begins another, of n turns, the last one running.
function fuzzSession(ri) {
  const s = { made: 0, done: [], last: null, t0: T0, span: 0, calls: 0, open: false, going: false, heads: [], now: T0 };
  const key = (i) => `${s.made}:${i}`;
  const ended = (i, t0, total) => ({
    kind: "trh", key: key(i), n: i + 1, t0, total, span: total, going: false, cnt: { steps: 4, input: 1, model: 1, tools: 2, failed: 1, user: 1, agent: 0 },
    steps: [row(key(i), 0, "you", 0, null), row(key(i), 1, "tool", 100, Math.min(total, 5000)), row(key(i), 2, "failed", 5000, Math.min(total, 9000)), row(key(i), 3, "reply", Math.min(total - 1, 10000), total)].map((r) => (r.start > total ? { ...r, start: total, dur: 0 } : r)),
  });
  const newest = (total = null) => {
    const k = key(s.done.length);
    const steps = [row(k, 0, "you", 0, null)];
    for (let j = 0; j < s.calls; j++) { const a = Math.min(s.span, 300 * j); steps.push(row(k, j + 1, "tool", a, Math.min(s.span, a + 200))); }
    steps.push(s.open ? row(k, s.calls + 1, s.going ? "running" : "noresult", s.span, null, true) : row(k, s.calls + 1, "reply", Math.min(s.span, 10000), s.span));
    s.last = { kind: "trh", key: k, n: s.done.length + 1, t0: s.t0, total, span: s.span, going: s.going, cnt: { steps: steps.length, input: 1, model: s.open ? 0 : 1, tools: s.calls + (s.open ? 1 : 0), failed: 0, user: 1, agent: 0 }, steps };
    s.heads = [...s.done, s.last];
  };
  const begin = (t0) => Object.assign(s, { t0, span: 500 + ri(5000), calls: 1 + ri(3), open: ri(2) === 0, going: true });
  s.make = (n) => {
    s.made++;
    s.done = [];
    s.last = null;
    s.heads = [];
    let t = T0 + s.made * 1e9;
    for (let i = 0; i < n - 1; i++) { const total = 1000 + ri(ri(3) ? 120000 : 3000000); s.done.push(ended(i, t, total)); t += total + 1000 + ri(100000); }
    if (n) { begin(t); newest(); }
    s.now = t + s.span + ri(20000);
  };
  s.ops = {
    on() { if (!s.last) return; s.going = true; newest(); },
    off() { if (!s.last) return; s.going = false; newest(ri(2) ? null : Math.max(s.span, s.now - s.t0)); },
    event() { if (!s.last) return; s.span = Math.max(s.span, Math.min(s.now - s.t0, s.span + 4000)); s.calls++; s.open = ri(2) === 0; newest(); },
    end() { if (!s.last) return; s.going = false; s.open = false; newest(Math.max(1, s.span)); },
    add() {
      if (s.last) { s.going = false; newest(Math.max(1, s.span)); s.done = s.heads; }
      s.now += 1000;
      begin(s.now);
      newest();
    },
    clear() { s.make(0); },
    pick() { s.make(ri(400)); },
    tick() { s.now += ri(60000); },
    far() { s.now += ri(4000000); },
  };
  return s;
}

test("timeline seeded fuzz: 320 made-up sessions, the empty and the one-turn one among them, over working on and off, events, turns added, clears, picks, widths and the clock, from nothing or not: every draw shows its own heads, no draw throws, every build ends, as a whole build's strip", () => {
  const ri = seeded(FUZZ_SEED);
  const wrong = [];
  const seen = { empty: 0, one: 0, cold: 0, add: 0, clear: 0, pick: 0, off: 0, waits: 0, over: 0, kept: 0, whole: 0 };
  for (let run = 0; run < FUZZ_RUNS && wrong.length < 5; run++) {
    const s = fuzzSession(ri);
    const shape = run % 8 === 0 ? "empty" : run % 8 === 1 ? "one" : "some";
    s.make(shape === "empty" ? 0 : shape === "one" ? 1 : 2 + ri(399));
    const widths = [1370, 1143, 700, 300, 41];
    let cw = widths[ri(5)];
    const cold = ri(2) === 0;
    const plan = [shape, s.heads.length, cw, cold ? "from nothing" : "from a model"];
    let t = 0;
    const clock = () => ++t;
    let M = null;
    let J = null;
    const say = (what) => wrong.push(`run ${run} (${plan.join(", ")}): ${what}`);
    const draw = () => {
      const D = TL.tlDraw(M, J, s.heads, cw, s.now, t + 1 + ri(6), clock);
      ({ M, J } = D);
      if (D.wait !== !M) say(`waits ${D.wait} with ${M ? "a strip" : "none"}`);
      if (D.wait) seen.waits++;
      if (!M) return;
      if (J) seen.over++;
      if (M.heads !== s.heads || M.geo.turns.length !== s.heads.length || M.L.turns !== M.geo.turns || M.geo.turns.some((x, i) => x.key !== s.heads[i].key)) say("a strip of other heads");
      for (const lane of TL.TL_LANES) for (const x of [0, M.cw / 3, M.cw - 1]) TL.timelineHit(M.L, M.heads, x, lane, M.nowMs, 8);
      TL.tlNumbers(M.L, M.heads, s.heads.length ? ri(s.heads.length) : undefined);
    };
    try {
      if (!cold) M = TL.timelineModel(null, s.heads, cw, "clock", s.now, null);
      for (let k = 0; k < 2; k++) draw();
      if (shape !== "some") seen[shape]++;
      if (cold) seen.cold++;
      for (let k = ri(13); k > 0; k--) {
        const op = ["on", "off", "event", "event", "end", "add", "clear", "pick", "width", "tick", "tick", "far"][ri(12)];
        plan.push(op);
        if (J && op in seen) seen[op]++;
        if (op === "width") cw = widths[ri(5)];
        else s.ops[op]();
        for (let j = ri(4); j > 0; j--) draw();
      }
      draw();
      for (let k = 0; k < 400 && (J || !M); k++) draw();
      if (J || !M) { say("a build that does not end"); continue; }
      draw();
      const W = TL.timelineModel(null, s.heads, cw, "clock", s.now, null);
      if (!s.heads.at(-1)?.going) { seen.whole++; sameStrip(M, W); continue; }
      seen.kept++;
      expect([M.cw, M.geo.stale, Math.abs(M.geo.total - W.geo.total) < 3 * TL.TL_SLACK]).toEqual([cw, undefined, true]);
      const Y = TL.timelineLayout(s.heads, cw, "clock", s.now, null, M.geo);
      const laid = (L) => [[...L.spans].sort(), L.fails, L.ticks, L.gaps, L.grow];
      expect(laid(M.L)).toEqual(laid(Y));
    } catch (e) {
      say(String(e?.message ?? e).slice(0, 400));
    }
  }
  expect(wrong).toEqual([]);
  // What the seed covered: each empty and each one-turn start drawn twice; from nothing with draws
  // that waited; builds over a strip; turns, clears, picks and working off while a build ran.
  expect([seen.empty, seen.one]).toEqual([FUZZ_RUNS / 8, FUZZ_RUNS / 8]);
  expect([seen.cold > 100, seen.waits > 100, seen.over > 50, seen.add > 3, seen.clear > 3, seen.pick > 3, seen.off > 3, seen.kept > 50, seen.whole > 50]).toEqual([true, true, true, true, true, true, true, true, true]);
}, 60000);
