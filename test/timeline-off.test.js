// bun test: TRD-23 slice 1, working on and off when the running turn's room on the strip is
// far from its own length. Working off, the frame lays out only the last turn, on the places
// it had (the old scale), and the strip is placed again by the time-bounded build
// (timeline.js tlBuildStart and tlBuildGo) from the next draw, over draws. Until that ends the
// shown model is the old one with only the last turn changed, so a press or a selection acts
// on what is drawn; a width change starts the build again. Once it ends the strip is a whole
// build's. The model is timeline.js (test/timeline.test.js); the pane is on the render harness.
import { test, expect, setSystemTime } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import * as TL from "../mods/agent-threads/timeline.js";
import { fixture, frame, H, handlerAfterId, makeCx, pane, settle, setup, Threads, unsliced } from "./render-harness.js";

setup();

const T0 = Date.parse("2026-11-01T09:00:00Z");
const DAY = 86400000;
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
// A session of n finished turns, then its last turn, running (on) and not (off), and the clock
// now. Three made-up cases:
// grown: the running turn's last event 60 s in, now 16 days after it started (a turn left open);
// open: its last event an unfinished call 6 s in, now 10 minutes after it started;
// widest: 30 minutes of events, now 40 minutes after it started: the widest turn either way.
function session(kind, n = 300) {
  const heads = [];
  for (let i = 0; i < n; i++) heads.push(doneTurn(i));
  const key = `0:${n}`;
  const t0 = T0 + n * 100000;
  const base = { kind: "trh", key, n: n + 1, t0, total: null, cnt: { steps: 3, input: 1, model: 1, tools: 1, failed: 0, user: 1, agent: 0 } };
  let on;
  let off;
  let now;
  if (kind === "grown") {
    const steps = [row(key, 0, "you", 0, null), row(key, 1, "tool", 1000, 5000), row(key, 2, "reply", 10000, 60000)];
    on = { ...base, span: 60000, going: true, steps };
    off = { ...base, span: 60000, going: false, steps };
    now = t0 + 16 * DAY;
  } else if (kind === "open") {
    on = { ...base, span: 6000, going: true, steps: [row(key, 0, "you", 0, null), row(key, 1, "tool", 1000, 5000), row(key, 2, "running", 6000, null, true)] };
    off = { ...base, span: 6000, going: false, steps: [row(key, 0, "you", 0, null), row(key, 1, "tool", 1000, 5000), row(key, 2, "noresult", 6000, null, true)] };
    now = t0 + 600000;
  } else {
    const steps = [row(key, 0, "you", 0, null), row(key, 1, "tool", 1000, 1500000), row(key, 2, "reply", 1500000, 1800000)];
    on = { ...base, span: 1800000, going: true, steps };
    off = { ...base, span: 1800000, going: false, steps };
    now = t0 + 2400000;
  }
  // Over TL_BUILD_BARS steps: at that many or fewer the strip is placed whole in the frame, and
  // no build runs.
  expect(heads.reduce((a, h) => a + h.steps.length, off.steps.length)).toBeGreaterThan(TL.TL_BUILD_BARS);
  return { on: [...heads, on], off: [...heads, off], now };
}
const made = () => ({ ...TL.TL_MADE });
const since = (m) => ({ geo: TL.TL_MADE.geo - m.geo, layout: TL.TL_MADE.layout - m.layout, tail: TL.TL_MADE.tail - m.tail });
// A clock that moves 1 ms each look, so a build stops after a few steps a draw.
function slowClock() {
  let t = 0;
  return { clock: () => ++t, until: (ms = 3) => t + ms };
}
// Draws (tlDraw) with heads at cw until the build ends; the model shown each draw.
function drawOut(st, heads, cw, now, c = slowClock(), max = 500) {
  const shown = [];
  let s = st;
  for (let k = 0; k < max && s.J; k++) {
    s = TL.tlDraw(s.M, s.J, heads, cw, now, c.until(), c.clock);
    shown.push(s);
  }
  return { s, shown };
}
// The strip a model shows, field for field against another's.
function sameStrip(M, W) {
  expect(M.cw).toBe(W.cw);
  expect(M.geo).toEqual(W.geo);
  expect(M.L).toEqual(W.L);
  expect(M.grow).toEqual(W.grow);
}

test("timeline working off, in the model: only the last turn is laid out, on the places it had, which are marked the old scale's; nothing is placed and nothing laid out whole", () => {
  for (const kind of ["grown", "open", "widest"]) {
    const { on, off, now } = session(kind, 2000);
    const prev = TL.timelineModel(null, on, CW, "clock", now, null);
    expect(prev.geo.room).toBeGreaterThan(0);
    const m = made();
    const M = TL.timelineModel(prev, off, CW, "clock", now, null);
    expect([kind, since(m)]).toEqual([kind, { geo: 0, layout: 0, tail: 1 }]);
    expect(M.geo.room).toBe(0);
    expect(M.geo.stale).toBe(true);
    expect(M.geo.turns.slice(0, -1).every((t, ti) => t === prev.geo.turns[ti])).toBe(true);
    // The last turn at its own length, on the old px per ms.
    expect(M.geo.turns.at(-1).w).toBe(Math.max(prev.geo.min, off.at(-1).span * prev.geo.m));
  }
});

test("timeline working off, drawn: the off draw starts the bounded build and takes no step of it; the next draws do; once it ends the strip equals a whole build field for field, for a turn grown past its last event, an unfinished call and a last turn that is widest", () => {
  for (const kind of ["grown", "open", "widest"]) {
    const { on, off, now } = session(kind);
    const prev = TL.timelineModel(null, on, CW, "clock", now, null);
    const c = slowClock();
    const m = made();
    const st = TL.tlDraw(prev, null, off, CW, now, c.until(), c.clock);
    expect(since(m)).toEqual({ geo: 0, layout: 0, tail: 1 });
    expect(st.wait).toBe(false);
    expect(st.J).toBeTruthy();
    expect([st.J.total, st.J.cw, st.J.heads === off]).toEqual([0, CW, true]);
    const J = st.J;
    const { s, shown } = drawOut(st, off, CW, now, c);
    expect([kind, s.J === null]).toEqual([kind, true]);
    expect([kind, J.total > 0]).toEqual([kind, true]);
    // Over more than one draw, and each draw before the last showed the old strip.
    expect(shown.length).toBeGreaterThan(1);
    for (const x of shown.slice(0, -1)) expect(x.M.L).toBe(st.M.L);
    expect(s.M.geo.stale).toBeUndefined();
    sameStrip(s.M, TL.timelineModel(null, off, CW, "clock", now, null));
    // Steady after: the next draw keeps it, with nothing placed or laid out.
    const m2 = made();
    const t = TL.tlDraw(s.M, s.J, off, CW, now, c.until(), c.clock);
    expect([t.M.L === s.M.L, t.J, since(m2)]).toEqual([true, null, { geo: 0, layout: 0, tail: 0 }]);
  }
});

test("timeline working off, while the build runs: the shown model is the old one with only the last turn changed, so a press lands on the step it shows, not where the new scale will put it", () => {
  const { on, off, now } = session("grown");
  const prev = TL.timelineModel(null, on, CW, "clock", now, null);
  const c = slowClock();
  let st = TL.tlDraw(prev, null, off, CW, now, c.until(), c.clock);
  st = TL.tlDraw(st.M, st.J, off, CW, now, c.until(), c.clock);
  expect(st.J).toBeTruthy();
  expect(st.J.total).toBeGreaterThan(0);
  const M = st.M;
  expect(M.heads).toBe(off);
  expect(M.geo.turns.slice(0, -1).every((t, ti) => t === prev.geo.turns[ti])).toBe(true);
  // Every span left of the last turn is the old layout's.
  const lx = M.geo.turns.at(-1).x;
  for (const [k, list] of prev.L.spans) {
    const keep = list.filter((s) => s[1] < lx - 1);
    expect(M.L.spans.get(k).slice(0, keep.length)).toEqual(keep);
  }
  // A press on a turn's reply, in the Model lane (its only bar there), at the turn as drawn:
  // that reply. On the old scale these turns are under 2 px; the new one puts all but the first
  // elsewhere.
  const whole = TL.timelineModel(null, off, CW, "clock", now, null);
  for (const ti of [0, 120, 299]) {
    const T = TL.tlBox(M.L, ti);
    const hit = TL.timelineHit(M.L, off, T.x + T.w / 2, "model", now, 4);
    expect(hit).toEqual({ turn: `0:${ti}`, key: `tr:0:${ti}:3` });
    if (ti > 0) expect(Math.abs(TL.tlBox(whole.L, ti).x - T.x)).toBeGreaterThan(4);
  }
});

test("timeline working off, a width change while the build runs: the build starts again at the new width, the old strip shows until it ends, and it ends as a whole build at that width", () => {
  const { on, off, now } = session("open");
  const prev = TL.timelineModel(null, on, CW, "clock", now, null);
  const c = slowClock();
  let st = TL.tlDraw(prev, null, off, CW, now, c.until(), c.clock);
  st = TL.tlDraw(st.M, st.J, off, CW, now, c.until(), c.clock);
  expect(st.J.total).toBeGreaterThan(0);
  const m = made();
  const w = TL.tlDraw(st.M, st.J, off, 1143, now, c.until(), c.clock);
  expect(since(m)).toEqual({ geo: 0, layout: 0, tail: 0 });
  expect(w.J !== st.J).toBe(true);
  expect([w.J.cw, w.J.total]).toEqual([1143, 0]);
  expect(w.M.L).toBe(st.M.L);
  expect(w.M.cw).toBe(CW);
  const { s } = drawOut(w, off, 1143, now, c);
  sameStrip(s.M, TL.timelineModel(null, off, 1143, "clock", now, null));
});

// The off draw and one step of the build after it: { prev, st } with the build running.
function offBuilding(kind, c) {
  const { on, off, now } = session(kind);
  const prev = TL.timelineModel(null, on, CW, "clock", now, null);
  let st = TL.tlDraw(prev, null, off, CW, now, c.until(), c.clock);
  st = TL.tlDraw(st.M, st.J, off, CW, now, c.until(), c.clock);
  expect(st.J.total).toBeGreaterThan(0);
  return { on, off, now, prev, st };
}

test("timeline working off, the heads change while the build runs: an event in the last turn, a new turn, working on again; each draw shows its own heads, the draw that ends the build too, and the strip ends as a whole build of the last heads", () => {
  // An event in the last turn that leaves its length as it was: a note 30 s in. The build runs
  // on, for the heads it began with; the draw it ends in shows the new ones.
  {
    const c = slowClock();
    const { off, now, st } = offBuilding("grown", c);
    const J = st.J;
    const last = off.at(-1);
    const ev = [...off.slice(0, -1), { ...last, steps: [...last.steps, row(last.key, 3, "you", 30000, null)] }];
    const { s, shown } = drawOut(st, ev, CW, now, c);
    expect(shown.length).toBeGreaterThan(1);
    expect(J.heads === off).toBe(true);
    expect(J.model?.heads === off).toBe(true);
    for (const x of shown) expect(x.M.heads === ev).toBe(true);
    for (const x of shown) expect(x.M.L.turns === x.M.geo.turns).toBe(true);
    expect(s.M.heads.at(-1).steps).toHaveLength(4);
    // Field for field but the step count and the zoom limit from it (geo.steps, L.zmax): the
    // path that lays out only the last turn keeps the placing's count, one step short here.
    // That is older than this build.
    const W = TL.timelineModel(null, ev, CW, "clock", now, null);
    expect([s.M.geo.steps, s.M.L.zmax]).toEqual([W.geo.steps - 1, (W.geo.steps - 1) / 4]);
    const geo = { ...s.M.geo, steps: W.geo.steps };
    sameStrip({ ...s.M, geo, L: { ...s.M.L, geo, zmax: W.L.zmax } }, W);
  }
  // A new turn: the strip is placed again whole for it in that draw, so the build is dropped.
  {
    const c = slowClock();
    const { off, now, st } = offBuilding("grown", c);
    const nt = [...off, { ...doneTurn(off.length), t0: off.at(-1).t0 + 16 * 86400000 - 120000 }];
    const m = made();
    const d = TL.tlDraw(st.M, st.J, nt, CW, now, c.until(), c.clock);
    expect(since(m).geo).toBe(1);
    expect(d.J === null).toBe(true);
    expect(d.M.heads === nt).toBe(true);
    sameStrip(d.M, TL.timelineModel(null, nt, CW, "clock", now, null));
  }
  // Working on again before the build ends: each draw shows the running heads; the builds end.
  for (const kind of ["grown", "open", "widest"]) {
    const c = slowClock();
    const { on, off, now, st } = offBuilding(kind, c);
    const back = [...off.slice(0, -1), on.at(-1)];
    const { s, shown } = drawOut(st, back, CW, now, c);
    expect([kind, s.J === null]).toEqual([kind, true]);
    for (const x of shown) expect([kind, x.M.heads === back]).toEqual([kind, true]);
    expect(s.M.geo.stale).toBeUndefined();
    expect(s.M.heads.at(-1).going).toBe(true);
  }
});

test("timeline working off, the width changing every draw while the build runs: each draw starts it again at that width and shows the old strip at its own width; the draw after the width settles ends it, a whole build there", () => {
  const { on, off, now } = session("open");
  const prev = TL.timelineModel(null, on, CW, "clock", now, null);
  const c = slowClock();
  let st = TL.tlDraw(prev, null, off, CW, now, c.until(), c.clock);
  const L0 = st.M.L;
  // As in a drag: a new width each draw, 30 draws, narrower then wider.
  const widths = Array.from({ length: 30 }, (_, k) => (k < 15 ? CW - 17 * (k + 1) : CW - 255 + 23 * (k - 14)));
  for (const cw of widths) {
    const J = st.J;
    st = TL.tlDraw(st.M, st.J, off, cw, now, c.until(), c.clock);
    expect([st.M.cw, st.M.L === L0, st.J !== J, st.J.cw, st.J.total]).toEqual([CW, true, true, cw, 0]);
  }
  // Settled: with a step budget the build fits, the next draw ends it.
  const cw = widths.at(-1);
  const J = st.J;
  st = TL.tlDraw(st.M, st.J, off, cw, now, Infinity, c.clock);
  expect(st.J === null).toBe(true);
  expect(J.total).toBeGreaterThan(0);
  sameStrip(st.M, TL.timelineModel(null, off, cw, "clock", now, null));
});

test("timeline from nothing, a width change while the build runs: the build starts again at the new width and ends as a whole build there", () => {
  const { off, now } = session("open");
  const c = slowClock();
  const a = TL.tlDraw(null, null, off, CW, now, c.until(), c.clock);
  expect([a.M, a.wait, a.J.cw]).toEqual([null, true, CW]);
  expect(a.J.total).toBeGreaterThan(0);
  const b = TL.tlDraw(null, a.J, off, 1143, now, c.until(), c.clock);
  expect(b.J !== a.J).toBe(true);
  expect(b.J.cw).toBe(1143);
  let s = b;
  for (let k = 0; k < 500 && s.wait; k++) s = TL.tlDraw(s.M, s.J, off, 1143, now, c.until(), c.clock);
  expect([s.wait, s.J]).toEqual([false, null]);
  sameStrip(s.M, TL.timelineModel(null, off, 1143, "clock", now, null));
});

// ---- the room growing a step ----
// While a turn runs its room on the strip is TL_ROOM_MIN, then TL_ROOM_GROW times that at each
// step (timeline.js liveRoom): six steps in its first two minutes, about fourteen in an hour.
test("timeline working on, the running turn's room growing a step: that draw places nothing and lays out only the last turn, the places kept and marked the old scale's; the bounded build places the strip again over the draws after and ends as a whole build", () => {
  for (const n of [2000, 5600]) {
    const { on } = session("open", n);
    const t0 = on.at(-1).t0;
    const r0 = TL.liveRoom(600000);
    // A second before the step and a second after it.
    const a = t0 + r0 - 1000;
    const b = t0 + r0 + 1000;
    const prev = TL.timelineModel(null, on, CW, "clock", a, null);
    expect(prev.geo.room).toBe(r0);
    const m = made();
    const M = TL.timelineModel(prev, on, CW, "clock", b, null);
    expect([n, since(m)]).toEqual([n, { geo: 0, layout: 0, tail: 1 }]);
    expect(M.geo.room).toBe(r0 * TL.TL_ROOM_GROW);
    expect(M.geo.stale).toBe(true);
    expect(M.geo.turns.slice(0, -1).every((t, ti) => t === prev.geo.turns[ti])).toBe(true);
    expect(M.geo.turns.at(-1).w).toBe(Math.max(prev.geo.min, r0 * TL.TL_ROOM_GROW * prev.geo.m));
    // Drawn: the step's draw starts the build and takes no step of it; the next draws do.
    const c = slowClock();
    const m2 = made();
    const st = TL.tlDraw(prev, null, on, CW, b, c.until(), c.clock);
    expect(since(m2)).toEqual({ geo: 0, layout: 0, tail: 1 });
    expect([st.J?.total, st.M.geo.stale]).toEqual([0, true]);
    const J = st.J;
    const { s, shown } = drawOut(st, on, CW, b, c);
    expect([n, s.J === null]).toEqual([n, true]);
    expect([n, J.total > 0]).toEqual([n, true]);
    expect(shown.length).toBeGreaterThan(1);
    for (const x of shown.slice(0, -1)) expect(x.M.L).toBe(st.M.L);
    sameStrip(s.M, TL.timelineModel(null, on, CW, "clock", b, null));
    // Steady after, in the same room.
    const m3 = made();
    const t = TL.tlDraw(s.M, s.J, on, CW, b + 1000, c.until(), c.clock);
    expect([t.M.L === s.M.L, t.J, since(m3)]).toEqual([true, null, { geo: 0, layout: 0, tail: 0 }]);
  }
});

// Running, the room grows TL_ROOM_GROW times a step. A step that moves the running turn's end
// TL_SLACK px or less keeps the places unmarked: it is measured from the places kept, not from a
// whole build, so the kept steps since the last whole build add up, to under three times the
// last of them (1 + 2/3 + 4/9 + ...), so under 3 TL_SLACK px.
function runningOnly(n, gap) {
  const heads = [];
  for (let i = 0; i < n; i++) {
    const t = doneTurn(i);
    heads.push({ ...t, t0: T0 + i * gap });
  }
  const key = `0:${n}`;
  const t0 = T0 + n * gap;
  heads.push({
    kind: "trh", key, n: n + 1, t0, total: null, span: 1000, going: true,
    cnt: { steps: 2, input: 1, model: 1, tools: 0, failed: 0, user: 1, agent: 0 },
    steps: [row(key, 0, "you", 0, null), row(key, 1, "reply", 10, 1000)],
  });
  return { heads, t0 };
}

test("timeline working on, the room growing step after step for 16 days: the steps kept unmarked add up to under 3 TL_SLACK px from a whole build, reached at 2.92 px on 5,600 turns, and every build ends", () => {
  let most = { d: 0 };
  for (const [n, gap, cw] of [[5600, 4000000, 1370], [5600, 100000, 1370], [2000, 100000, 1143], [400, 100000, 700], [100, 4000000, 300]]) {
    const { heads, t0 } = runningOnly(n, gap);
    let st = { M: TL.timelineModel(null, heads, cw, "clock", t0 + 2000, null), J: null };
    for (let r = TL.TL_ROOM_MIN; r < 16 * DAY; r *= TL.TL_ROOM_GROW) {
      for (const dt of [r + 1, r * 1.2]) {
        const now = t0 + dt;
        st = TL.tlDraw(st.M, st.J, heads, cw, now, Infinity, () => 0);
        if (st.J) st = TL.tlDraw(st.M, st.J, heads, cw, now, Infinity, () => 0);
        expect(st.J === null).toBe(true);
        const F = TL.timelineGeo(heads, cw, "clock", now);
        const G = st.M.geo;
        let d = 0;
        for (let i = 0; i < F.turns.length; i++) d = Math.max(d, Math.abs(F.turns[i].x - G.turns[i].x), Math.abs(F.turns[i].x + F.turns[i].w - G.turns[i].x - G.turns[i].w));
        if (d > most.d) most = { d, n, gap, cw, dt };
      }
    }
  }
  // The largest: 5,600 turns an hour apart on 1,370 px, 576.65 s into the running turn.
  expect(most.d).toBeLessThan(3 * TL.TL_SLACK);
  expect([most.n, most.gap, most.cw, most.d > 2.9 * TL.TL_SLACK]).toEqual([5600, 4000000, 1370, true]);
});

// A session of TL_BUILD_BARS steps or fewer is placed again whole in the frame where its
// places would be marked the old scale's: a room step, working on and working off. n finished
// turns of 4 steps each and a running turn of k steps; the room 16 days in, so each moves the
// end far.
function grownSession(n, k) {
  const heads = [];
  for (let i = 0; i < n; i++) heads.push(doneTurn(i));
  const key = `0:${n}`;
  const t0 = T0 + n * 100000;
  const steps = [row(key, 0, "you", 0, null)];
  for (let j = 1; j < k - 1; j++) steps.push(row(key, j, "tool", 1000 * j, 1000 * j + 500));
  steps.push(row(key, k - 1, "reply", 50000, 60000));
  const base = { kind: "trh", key, n: n + 1, t0, total: null, span: 60000, cnt: { steps: k, input: 1, model: 1, tools: k - 2, failed: 0, user: 1, agent: 0 }, steps };
  return { on: [...heads, { ...base, going: true }], off: [...heads, { ...base, going: false, total: 60000 }], t0 };
}

test("timeline at its edge of 1,024 steps: a room step, working on and working off are placed again whole in that frame at 1,024 steps; at 1,025 the places are kept and marked the old scale's for the bounded build", () => {
  for (const [k, whole] of [[4, true], [5, false]]) {
    const { on, off, t0 } = grownSession(255, k);
    const steps = on.reduce((a, h) => a + Math.max(1, TL.tlLen(h)), 0);
    expect([k, steps]).toEqual([k, 1020 + k]);
    const r0 = TL.liveRoom(16 * DAY);
    const a = t0 + r0 - 1000;
    const b = t0 + r0 + 1000;
    const cases = [
      // A room step: the same heads, the clock past the room.
      ["step", TL.timelineModel(null, on, CW, "clock", a, null), on, b],
      // Working on: the last heading new and running.
      ["on", TL.timelineModel(null, off, CW, "clock", b, null), [...on.slice(0, -1), { ...on.at(-1) }], b],
      // Working off: the last heading new and finished.
      ["off", TL.timelineModel(null, on, CW, "clock", b, null), [...off.slice(0, -1), { ...off.at(-1) }], b],
    ];
    for (const [what, prev, heads, now] of cases) {
      const m = made();
      const M = TL.timelineModel(prev, heads, CW, "clock", now, null);
      if (whole) {
        expect([k, what, since(m), M.geo.stale]).toEqual([k, what, { geo: 1, layout: 1, tail: 0 }, undefined]);
        sameStrip(M, TL.timelineModel(null, heads, CW, "clock", now, null));
      } else {
        expect([k, what, since(m), M.geo.stale]).toEqual([k, what, { geo: 0, layout: 0, tail: 1 }, true]);
        expect(M.geo.turns.slice(0, -1).every((t, ti) => t === prev.geo.turns[ti])).toBe(true);
      }
    }
  }
});

// ---- on the pane ----
// A Trajectory pane docked along the bottom, w px wide, its rows built whole.
async function dockPane(file, w) {
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
const own = (c, id) => {
  const at = c.findIndex((e) => e[0] === "id" && e[1] === id);
  if (at < 0) return null;
  const end = c.findIndex((e, j) => j > at && e[0] === "id");
  return c.slice(at, end < 0 ? c.length : end);
};
// Frames until the strip's build ends.
function settleStrip(b, cb) {
  let c = frame(b, cb);
  for (let k = 0; k < 400 && b.tlJob; k++) c = frame(b, cb);
  return c;
}
// A pane on a made-up session of n turns cut just after a call, so its newest turn is open,
// shown with the strip, the clock 16 days after that turn began and Herdr saying working; then
// the frames after it settled. Its API error line is left out, since an error ends its turn.
async function openPane(n, w = 1440) {
  const file = fixture("--extra", String(n));
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l && !l.includes('"isApiErrorMessage":true'));
  writeFileSync(file, `${lines.slice(0, lines.findLastIndex((l) => l.includes('"tool_use"')) + 1).join("\n")}\n`);
  const { b, cb } = await dockPane(file, w);
  const c = frame(b, cb);
  handlerAfterId(c, "th-traj-listbox", "on_size_change")({ width: w, height: 400 }, cb);
  settleStrip(b, cb);
  const { t0 } = b.ledger().totals.heads.at(-1);
  setSystemTime(new Date(t0 + 16 * DAY));
  H.state.terminals[0].status = "working";
  b.ledgerMemo = null;
  settleStrip(b, cb);
  expect(b.tlModel.heads.at(-1).going).toBe(true);
  // Over TL_BUILD_BARS steps, so working off runs the build (session, above).
  expect(b.tlModel.geo.steps).toBeGreaterThan(TL.TL_BUILD_BARS);
  return { b, cb };
}
// Herdr says idle: the off frame.
function offFrame(b, cb) {
  H.state.terminals[0].status = "idle";
  b.ledgerMemo = null;
  return frame(b, cb);
}
// Each look at the clock 3 ms later while f runs: a build stops after a step or two a frame.
function slowNow(f) {
  const real = performance.now;
  let t = real.call(performance);
  performance.now = () => (t += 3);
  try { return f(); } finally { performance.now = real; }
}

test("timeline view: working off at 400 turns, the off frame places nothing and lays out only the last turn; the next frame begins the bounded build, the old strip drawn meanwhile; it ends as a whole build", async () => {
  try {
    const { b, cb } = await openPane(400);
    const prev = b.tlModel;
    const m = made();
    const c = offFrame(b, cb);
    expect(since(m)).toEqual({ geo: 0, layout: 0, tail: 1 });
    expect(own(c, "th-tl-lanes")).not.toBe(null);
    expect(b.tlModel.heads.at(-1).going).toBe(false);
    expect(b.tlModel.geo.stale).toBe(true);
    expect(b.tlModel.geo.turns.slice(0, -1).every((t, ti) => t === prev.geo.turns[ti])).toBe(true);
    expect(b.tlJob).toBeTruthy();
    expect(b.tlJob.total).toBe(0);
    const J = b.tlJob;
    // A frame is asked for, so the build goes on.
    expect(cb.timers.some((x) => x.ms === 0)).toBe(true);
    const frames = slowNow(() => {
      const out = [];
      for (let k = 0; k < 400 && b.tlJob; k++) {
        const f = frame(b, cb);
        out.push({ lanes: own(f, "th-tl-lanes") != null, wait: own(f, "th-tl-wait") != null, stale: b.tlModel.geo.stale === true });
      }
      return out;
    });
    expect(frames.length).toBeGreaterThan(1);
    for (const f of frames.slice(0, -1)) expect(f).toEqual({ lanes: true, wait: false, stale: true });
    expect(frames.at(-1)).toEqual({ lanes: true, wait: false, stale: false });
    expect(J.total).toBeGreaterThan(0);
    const M = b.tlModel;
    sameStrip(M, TL.timelineModel(null, M.heads, M.cw, "clock", Date.now(), null));
  } finally {
    setSystemTime();
    H.state.terminals[0].status = "idle";
  }
});

test("timeline view: a press while the build runs selects the step under it on the strip drawn, and the build goes on", async () => {
  try {
    const { b, cb } = await openPane(400);
    offFrame(b, cb);
    slowNow(() => frame(b, cb));
    const J = b.tlJob;
    expect(J).toBeTruthy();
    expect(J.total).toBeGreaterThan(0);
    const M = b.tlModel;
    expect(M.geo.stale).toBe(true);
    const ti = 120;
    const h = M.heads[ti];
    // At the turn as drawn (on the old scale, under 2 px), in the Tools lane.
    const T = TL.tlBox(M.L, ti);
    const x = T.x + T.w / 2;
    const y = 2 * TL.TL_LANE + 4;
    expect(Math.abs(TL.tlBox(TL.timelineModel(null, M.heads, M.cw, "clock", Date.now(), null).L, ti).x - T.x)).toBeGreaterThan(4);
    slowNow(() => {
      const c = frame(b, cb);
      handlerAfterId(c, "th-tl-lanes", "on_mouse_down")({ local_position: { x, y }, position: { x, y } }, cb);
    });
    expect(b.turnOfRow(b.tsel)).toBe(h.key);
    expect(b.tsel).not.toBe(h.key);
    expect(b.tlJob === J).toBe(true);
  } finally {
    setSystemTime();
    H.state.terminals[0].status = "idle";
  }
});

test("timeline view: a selection change while the build runs outlines the step's bar on the strip drawn, and the build goes on", async () => {
  try {
    const { b, cb } = await openPane(400);
    offFrame(b, cb);
    slowNow(() => frame(b, cb));
    const J = b.tlJob;
    expect(J).toBeTruthy();
    expect(J.total).toBeGreaterThan(0);
    const ti = 200;
    const h = b.tlModel.heads[ti];
    const si = h.steps.findIndex((r) => r.lk === "tool" && r.start != null && r.dur > 0);
    b.tsel = h.steps[si].key;
    const c = slowNow(() => frame(b, cb));
    expect(b.tlJob === J).toBe(true);
    const M = b.tlModel;
    expect(M.geo.stale).toBe(true);
    const box = TL.tlBar(M.L, M.heads, ti, si);
    expect(own(c, "th-tl-sel")).toContainEqual(["left", box.x0 - 2]);
  } finally {
    setSystemTime();
    H.state.terminals[0].status = "idle";
  }
});

test("timeline view: a width change while the build runs starts it again at the new width; the old strip shows until it ends, then a whole build at that width", async () => {
  try {
    const { b, cb } = await openPane(400);
    offFrame(b, cb);
    slowNow(() => frame(b, cb));
    const J = b.tlJob;
    expect(J).toBeTruthy();
    expect(J.total).toBeGreaterThan(0);
    const L0 = b.tlModel.L;
    b.width = 1200;
    b.paneW = 1200;
    const m = made();
    slowNow(() => frame(b, cb));
    expect(since(m)).toEqual({ geo: 0, layout: 0, tail: 0 });
    expect(b.tlJob !== J).toBe(true);
    expect([b.tlJob.cw, b.tlJob.total]).toEqual([TL.tlStrip(1200), 0]);
    expect(b.tlModel.L).toBe(L0);
    slowNow(() => { for (let k = 0; k < 400 && b.tlJob; k++) frame(b, cb); });
    const M = b.tlModel;
    expect(M.cw).toBe(TL.tlStrip(1200));
    sameStrip(M, TL.timelineModel(null, M.heads, M.cw, "clock", Date.now(), null));
  } finally {
    setSystemTime();
    H.state.terminals[0].status = "idle";
  }
});

// ---- a stop inside a build step ----
// Herdr's interrupt stops a render that runs past its budget, and can land inside the build's
// step (J.gen.next()). A generator that throws is closed. The next step of this build throws
// the stop out of the frame and closes the build's generator, as an interrupt does.
function stopIn(J) {
  const g = J.gen;
  g.next = () => { delete g.next; return g.throw(new Error("stopped by the interrupt")); };
}
// Herdr's stop runs no catch, so renderOpen stays set after it; here render's catch ran and
// cleared it. Set again, as the stop leaves it: the next render takes it for a stopped one.
function leftOpen(b) {
  expect(b.renderOpen).toBe(false);
  b.renderOpen = true;
}
// Frames until the strip's build ends, each look at the clock 3 ms later: none may throw.
function framesOut(b, cb) {
  return slowNow(() => {
    let k = 0;
    for (; k < 400 && (b.tlJob || !b.tlModel); k++) frame(b, cb);
    return k;
  });
}

test("timeline view: a stop inside a step of the working-off build: that frame throws, the stopped build is not kept, and the frames after it throw nothing, build again from the strip drawn and end as a whole build", async () => {
  try {
    const { b, cb } = await openPane(400);
    offFrame(b, cb);
    slowNow(() => frame(b, cb));
    const J = b.tlJob;
    expect(J).toBeTruthy();
    expect(J.total).toBeGreaterThan(0);
    const L0 = b.tlModel.L;
    stopIn(J);
    expect(() => slowNow(() => frame(b, cb))).toThrow("stopped by the interrupt");
    leftOpen(b);
    expect(b.tlJob !== J).toBe(true);
    // The next frame draws the strip it had and starts a new build.
    const c = slowNow(() => frame(b, cb));
    expect(own(c, "th-tl-lanes")).not.toBe(null);
    expect(b.tlModel.L).toBe(L0);
    expect(b.tlJob).toBeTruthy();
    expect(b.tlJob !== J).toBe(true);
    expect(framesOut(b, cb)).toBeGreaterThan(0);
    expect(b.tlJob === null).toBe(true);
    const M = b.tlModel;
    sameStrip(M, TL.timelineModel(null, M.heads, M.cw, "clock", Date.now(), null));
  } finally {
    setSystemTime();
    H.state.terminals[0].status = "idle";
  }
});

test("timeline view: a stop inside a step of the build from nothing: that frame throws, the stopped build is not kept, and the frames after it throw nothing, build again from nothing and end as a whole build", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "400"), 1440);
  slowNow(() => {
    const c = frame(b, cb);
    handlerAfterId(c, "th-traj-listbox", "on_size_change")({ width: 1440, height: 400 }, cb);
    frame(b, cb);
  });
  expect(b.tlModel ?? null).toBe(null);
  const J = b.tlJob;
  expect(J).toBeTruthy();
  expect(J.total).toBeGreaterThan(0);
  stopIn(J);
  expect(() => slowNow(() => frame(b, cb))).toThrow("stopped by the interrupt");
  leftOpen(b);
  expect(b.tlJob !== J).toBe(true);
  const c = slowNow(() => frame(b, cb));
  expect(own(c, "th-tl-wait")).not.toBe(null);
  expect(b.tlJob).toBeTruthy();
  expect(b.tlJob !== J).toBe(true);
  framesOut(b, cb);
  expect(b.tlJob === null).toBe(true);
  const M = b.tlModel;
  expect(M).toBeTruthy();
  sameStrip(M, TL.timelineModel(null, M.heads, M.cw, "clock", Date.now(), null));
});

// The clock held still: no budget runs out.
function stillNow(f) {
  const real = performance.now;
  const t = real.call(performance);
  performance.now = () => t;
  try { return f(); } finally { performance.now = real; }
}

test("timeline view: the pane's width changing every frame while the working-off build runs: the build starts again each frame, the strip keeps its old layout, drawn in a slot of the new width: past the old layout's end the slot is blank, and narrower than that end the newest turns are cut off at its right edge; the frame after the width settles shows the new strip", async () => {
  try {
    const { b, cb } = await openPane(400);
    offFrame(b, cb);
    slowNow(() => frame(b, cb));
    expect(b.tlJob).toBeTruthy();
    expect(b.tlJob.total).toBeGreaterThan(0);
    const L0 = b.tlModel.L;
    const cw0 = b.tlModel.cw;
    expect(cw0).toBe(TL.tlStrip(1440));
    // The old layout's right end, its last turn's: working off shortened that turn on the old
    // scale, so it ends well left of the old strip's edge.
    const last = TL.tlBox(L0, L0.turns.length - 1);
    const end0 = last.x + last.w;
    expect(end0).toBeLessThan(cw0 / 2);
    const seen = [];
    for (const w of [1400, 1100, 800, 640, 560, 640, 900, 1300, 1700]) {
      b.width = w;
      b.paneW = w;
      const J = b.tlJob;
      const c = stillNow(() => frame(b, cb));
      expect([w, b.tlJob !== J, b.tlJob?.cw, b.tlJob?.total, b.tlModel.cw, b.tlModel.L === L0]).toEqual([w, true, TL.tlStrip(w), 0, cw0, true]);
      const lanes = own(c, "th-tl-lanes");
      seen.push({ w, slot: lanes.find((e) => e[0] === "w")[1], clip: lanes.some((e) => e[0] === "overflow_hidden"), cut: end0 > TL.tlStrip(w) });
    }
    // The slot follows the pane and clips; the layout in it is the old one.
    for (const x of seen) expect([x.w, x.slot, x.clip]).toEqual([x.w, TL.tlStrip(x.w), true]);
    expect(seen.filter((x) => x.cut).map((x) => x.w)).toEqual([640, 560, 640]);
    // Settled at 1,700: the next frame ends the build.
    stillNow(() => frame(b, cb));
    expect(b.tlJob === null).toBe(true);
    const M = b.tlModel;
    expect(M.cw).toBe(TL.tlStrip(1700));
    sameStrip(M, TL.timelineModel(null, M.heads, M.cw, "clock", Date.now(), null));
  } finally {
    setSystemTime();
    H.state.terminals[0].status = "idle";
  }
});

// A pane on a made-up session of one short turn cut just after a call, so it is the running
// turn and the only one, shown with the strip, Herdr saying working, the clock 1 s into the turn.
async function soloPane(w = 1440) {
  const file = fixture("--only", "1");
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l && !l.includes('"isApiErrorMessage":true'));
  writeFileSync(file, `${lines.slice(0, lines.findLastIndex((l) => l.includes('"tool_use"')) + 1).join("\n")}\n`);
  const { b, cb } = await dockPane(file, w);
  const c = frame(b, cb);
  handlerAfterId(c, "th-traj-listbox", "on_size_change")({ width: w, height: 400 }, cb);
  settleStrip(b, cb);
  const { t0 } = b.ledger().totals.heads.at(-1);
  setSystemTime(new Date(t0 + 1000));
  H.state.terminals[0].status = "working";
  b.ledgerMemo = null;
  settleStrip(b, cb);
  expect(b.tlModel.heads.length).toBe(1);
  expect(b.tlModel.heads[0].going).toBe(true);
  return { b, cb, t0 };
}

test("timeline view: a room step with only the running turn is placed again whole in that frame: nothing is marked, no build starts, and the turn and its growing bar are inside the strip", async () => {
  try {
    const { b, cb, t0 } = await soloPane();
    const cw = TL.tlStrip(1440);
    const r0 = b.tlModel.geo.room;
    expect(b.tlModel.geo.stale).toBeUndefined();
    const box0 = TL.tlBox(b.tlModel.L, 0);
    expect(box0.x + box0.w).toBeCloseTo(cw, 6);
    // 1 ms past its room: the room grows a step, and on the places kept its end would move half
    // the strip, past the strip's end, the growing bar with it.
    setSystemTime(new Date(t0 + r0 + 1));
    const m = made();
    const c = frame(b, cb);
    const M = b.tlModel;
    expect([M.geo.room, M.geo.stale, b.tlJob, since(m)]).toEqual([r0 * TL.TL_ROOM_GROW, undefined, null, { geo: 1, layout: 1, tail: 0 }]);
    sameStrip(M, TL.timelineModel(null, M.heads, cw, "clock", Date.now(), null));
    const box = TL.tlBox(M.L, 0);
    expect(box.x + box.w).toBeCloseTo(cw, 6);
    expect(M.grow.length).toBeGreaterThan(0);
    for (const g of M.grow) expect(g.x1).toBeLessThanOrEqual(cw);
    const lanes = own(c, "th-tl-lanes");
    expect(lanes.find((e) => e[0] === "w")[1]).toBe(cw);
  } finally {
    setSystemTime();
    H.state.terminals[0].status = "idle";
  }
});

// The bounded build's work counted, not timed: the bars (step rows) a step of it touches. A
// turn of n step rows: the user's message, then notes and calls as given, listed newest first
// (so the clock order is reversed), every 7th call failed. len: the turn's length in ms.
function denseTurn(i, t0, notes, calls, len) {
  const key = `0:${i}`;
  const steps = [row(key, 0, "you", 0, null)];
  const m = notes + calls;
  for (let j = 0; j < m; j++) {
    const a = Math.round(((m - j) / (m + 1)) * len);
    const call = j % 2 === 1 || j >= 2 * notes;
    const lk = !call ? "text" : j % 7 === 0 ? "failed" : "tool";
    steps.push(row(key, j + 1, lk, a, call ? Math.min(len, a + 150) : null));
  }
  steps.push(row(key, m + 1, "reply", len - 10, len));
  const failed = steps.filter((r) => r.failed).length;
  const tools = steps.filter((r) => r.lk === "tool" || r.failed).length;
  return { kind: "trh", key, n: i + 1, t0, total: len, span: len, going: false, cnt: { steps: steps.length, input: 1, model: notes + 1, tools, failed, user: 1, agent: 0 }, steps };
}
// A turn of n notes of len ms, len ms apart, listed in clock order, then the n - 1 notes between
// them, listed in clock order. Notes, so all are in one key's spans whatever the tracks.
function fillTurn(i, t0, n, len) {
  const key = `0:${i}`;
  const end = (2 * n - 1) * len;
  const steps = [row(key, 0, "you", 0, null)];
  for (let k = 0; k < n; k++) steps.push(row(key, steps.length, "text", 2 * k * len, (2 * k + 1) * len));
  for (let k = 0; k < n - 1; k++) steps.push(row(key, steps.length, "text", (2 * k + 1) * len, (2 * k + 2) * len));
  steps.push(row(key, steps.length, "reply", end - 10, end));
  return { kind: "trh", key, n: i + 1, t0, total: end, span: end, going: false, cnt: { steps: steps.length, input: 1, model: 2 * n, tools: 0, failed: 0, user: 1, agent: 0 }, steps };
}
// The span lists' entries a build reads, counted from outside: while fn runs, the global Map
// is one whose get hands out each span list (a key with "|", an array of spans) behind a Proxy
// that counts each entry read, onRead(the list's length). So the join's walk back, and each
// entry its splices move or drop (a splice reads each one it moves), are counted, with the few
// it compares. The first add of a key goes to a list not yet in the map, and is not counted.
function countingSpanReads(onRead, fn) {
  const Real = globalThis.Map;
  const wrapped = new WeakMap();
  const wrap = (v) => {
    let p = wrapped.get(v);
    if (!p) {
      p = new Proxy(v, { get(a, k) { if (typeof k === "string" && /^\d+$/.test(k)) onRead(a.length); return a[k]; } });
      wrapped.set(v, p);
    }
    return p;
  };
  function CountingMap(...args) {
    const m = new Real(...args);
    const get = m.get;
    Object.defineProperty(m, "get", { value: (k) => { const v = get.call(m, k); return typeof k === "string" && k.includes("|") && Array.isArray(v) ? wrap(v) : v; } });
    return m;
  }
  globalThis.Map = CountingMap;
  try {
    return fn();
  } finally {
    globalThis.Map = Real;
  }
}
// The bars and turns of heads a build touches step by step: each heading's step rows behind a
// Proxy that notes each row read (by turn and index) into the current step's set, and the
// heads behind one that notes each heading read; and the span list entries each step reads
// (countingSpanReads).
function touchedSteps(heads, cw, now) {
  let cur = null;
  let curT = null;
  let reads = 0;
  let longest = 0;
  const wrapped0 = heads.map((h, ti) => ({
    ...h,
    steps: new Proxy(h.steps, { get(a, k) { if (cur && typeof k === "string" && /^\d+$/.test(k)) cur.add(ti * 100000 + Number(k)); return a[k]; } }),
  }));
  const wrapped = new Proxy(wrapped0, { get(a, k) { if (curT && typeof k === "string" && /^\d+$/.test(k)) curT.add(Number(k)); return a[k]; } });
  const J = TL.tlBuildStart(wrapped, cw, "clock", now, null);
  const per = [];
  const perT = [];
  const perJ = [];
  let M = null;
  // A clock already past the bound: each call takes one step of the build.
  for (let k = 0; k < 100000 && !M; k++) {
    cur = new Set();
    curT = new Set();
    reads = 0;
    M = countingSpanReads((len) => { reads++; if (len > longest) longest = len; }, () => TL.tlBuildGo(J, 0, () => 1));
    per.push(cur.size);
    perT.push(curT.size);
    perJ.push(reads);
  }
  cur = null;
  curT = null;
  return { per, perT, perJ, longest, M, W: TL.timelineModel(null, wrapped, cw, "clock", now, null) };
}

test("timeline build: no step touches more than 1,024 bars and span entries together, or 260 turns, on 20 turns of 3,000 calls, one turn of 20,000, 5,600 ordinary turns, 20,000 turns, one turn of 300 calls apart and one of 100 notes apart with 99 that fill the gaps, and it ends as a whole build", () => {
  const cases = {
    dense: Array.from({ length: 20 }, (_, i) => denseTurn(i, T0 + i * 700000, 0, 3000, 600000)),
    one: [denseTurn(0, T0, 0, 20000, 3600000), denseTurn(1, T0 + 3700000, 2, 2, 60000)],
    ordinary: Array.from({ length: 5600 }, (_, i) => denseTurn(i, T0 + i * 100000, 12, 12, 60000)),
    // At Fit every one of 20,000 turns is under 2 px, so the layout reads none of their rows:
    // two notes and two calls a turn, listed newest first.
    newest: Array.from({ length: 20000 }, (_, i) => denseTurn(i, T0 + i * 100000, 2, 2, 60000)),
    // 300 calls a second apart in a turn some 1,300 px wide: bars 3 px wide and over 1 px apart,
    // listed newest first, so each one's join walks back over every span of its key so far.
    apart: [denseTurn(0, T0, 0, 300, 300000), denseTurn(1, T0 + 310000, 2, 2, 60000)],
    // 100 notes apart, each some 6 px wide, then the 99 that fill the gaps between them, left to
    // right: each joins the span left of it and reaches the one right of it, so its splice moves
    // every span after that one.
    joined: [fillTurn(0, T0, 100, 1500), denseTurn(1, T0 + 310000, 2, 2, 60000)],
  };
  for (const [name, heads] of Object.entries(cases)) {
    const { per, perT, perJ, longest, M, W } = touchedSteps(heads, 1440, T0 + 1e10);
    expect(M).not.toBe(null);
    // A step touches at most 1,024 bars and span entries together, and 260 turns: a chunk of
    // 256 turns and the turns beside it a turn reads (the next turn's start, for the break).
    // The count is looked at before each bar and each span, so a step can end over it by one
    // bar and its join: at most four times its key's spans (the walk back, the move right, the
    // reach and the move left) and six more. And the cut before the last turn reads each key's
    // last span once.
    const most = Math.max(...per.map((b, k) => b + perJ[k]));
    const over = 4 * longest + 6 + M.L.spans.size;
    expect([name, most <= 1024 + over, Math.max(...perT) <= 260]).toEqual([name, true, true]);
    // Not a build that skips its work: every bar is touched, and it ends as a whole build.
    sameStrip(M, W);
  }
}, 120000);

// A turn's tracks worked out apart from the code: its calls sorted by start, the one listed first
// at equal starts, and each on the second track when it starts before the first track's last
// call ends.
function tracksByHand(h) {
  const calls = h.steps.map((r, i) => ({ i, r })).filter(({ r }) => r.lk === "tool" || r.lk === "failed");
  calls.sort((p, q) => p.r.start - q.r.start || p.i - q.i);
  const out = new Array(h.steps.length).fill(0);
  let end = -Infinity;
  for (const { i, r } of calls) {
    if (r.start < end) out[i] = 1;
    else end = r.start + r.dur;
  }
  return out.some(Boolean) ? out : null;
}

test("timeline tracks in the build: a turn of calls out of the clock's order, with equal starts, gets the tracks worked out by hand, whole or over steps, the sort spread over the steps", () => {
  let a = 7;
  const rnd = () => { a = (Math.imul(a, 1103515245) + 12345) >>> 0; return (a >>> 8) / 16777216; };
  for (const n of [2, 3, 5, 8, 9, 31, 33, 100, 1000, 3000]) {
    // Starts from a few hundred places, so many are equal; each call 1 to 4 s.
    const key = "0:0";
    const steps = [row(key, 0, "you", 0, null)];
    for (let j = 0; j < n; j++) {
      const at = Math.floor(rnd() * Math.max(2, n / 4)) * 1000;
      steps.push(row(key, j + 1, rnd() < 0.2 ? "failed" : "tool", at, at + 1000 + Math.floor(rnd() * 3001)));
    }
    const len = Math.max(...steps.map((r) => r.start + (r.dur ?? 0)));
    const h = { kind: "trh", key, n: 1, t0: T0, total: len, span: len, going: false, cnt: { steps: steps.length, input: 1, model: 0, tools: n, failed: 1, user: 1, agent: 0 }, steps };
    const want = tracksByHand(h);
    expect(TL.tlTracks(h)).toEqual(want);
    // Over steps: the build's tracks for that turn.
    const J = TL.tlBuildStart([h, doneTurn(1)], 1440, "clock", T0 + 1e10, null);
    let M = null;
    let k = 0;
    for (; k < 100000 && !M; k++) M = TL.tlBuildGo(J, 0, () => 1);
    expect([n, M?.L.tracks.get(h)]).toEqual([n, want]);
    // The sort's entries moved: n a pass. A step of 1,024 at most is so many steps more.
    const passes = Math.ceil(Math.log2(n));
    expect([n, k >= Math.floor((n * passes) / 1024)]).toEqual([n, true]);
  }
});

test("timeline failure marks in the build: a turn of 4,000 failed calls whose centres are out of order has the marks a sort by hand gives, its sort and spacing counted and spread over the build's steps, and nothing sorted whole", () => {
  // Calls that start in order, 100 ms apart, every other one 10 s long: their centres are out
  // of order, so the marks are sorted, and the tracks need no sort. "even": all 100 ms long, so
  // the marks are in order.
  const n = 4000;
  const session = (long) => {
    const key = "0:0";
    const steps = [row(key, 0, "you", 0, null)];
    for (let j = 0; j < n; j++) steps.push(row(key, j + 1, "failed", j * 100, j * 100 + (long && j % 2 ? 10000 : 100)));
    const len = n * 100 + 20000;
    return [{ kind: "trh", key, n: 1, t0: T0, total: len, span: len, going: false, cnt: { steps: steps.length, input: 1, model: 0, tools: n, failed: n, user: 1, agent: 0 }, steps }, doneTurn(1)];
  };
  const real = Array.prototype.sort;
  let whole = 0;
  Array.prototype.sort = function (...args) {
    if (this.length > TL.TL_BUILD_BARS) whole++;
    return real.apply(this, args);
  };
  const built = (heads) => {
    const J = TL.tlBuildStart(heads, 1440, "clock", T0 + 1e10, null);
    let M = null;
    let k = 0;
    for (; k < 100000 && !M; k++) M = TL.tlBuildGo(J, 0, () => 1);
    return { M, k };
  };
  let even;
  let odd;
  try {
    even = built(session(false));
    odd = built(session(true));
  } finally {
    Array.prototype.sort = real;
  }
  expect(whole).toBe(0);
  // The marks by hand: the drawn bars' centres sorted, each 6 px or more from the last.
  const h = session(true)[0];
  const centres = [];
  for (let i = 1; i <= n; i++) {
    const b = TL.tlBar(odd.M.L, [h, doneTurn(1)], 0, i, T0 + 1e10);
    centres.push((b.x0 + b.x1) / 2);
  }
  expect(centres.some((c, i) => i > 0 && c < centres[i - 1])).toBe(true);
  const want = [];
  let end = -Infinity;
  for (const c of [...centres].sort((p, q) => p - q)) if (c >= end) { want.push(c); end = c + 6; }
  expect(want.length).toBeGreaterThan(50);
  const got = odd.M.L.fails.slice(0, want.length);
  expect(got.length).toBe(want.length);
  got.forEach((x, k) => expect(x).toBeCloseTo(want[k], 6));
  // Each of the sort's 12 passes over the 4,000 marks is counted: at 1,024 a step, 46 steps more
  // than the same session with its marks in order, less two for where the steps' ends fall.
  expect(odd.k - even.k).toBeGreaterThanOrEqual(Math.floor((n * Math.ceil(Math.log2(n))) / TL.TL_BUILD_BARS) - 2);
});
