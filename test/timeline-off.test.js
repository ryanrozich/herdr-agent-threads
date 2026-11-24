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
    const { s, shown } = drawOut(st, off, CW, now, c);
    expect(s.J).toBe(null);
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
  expect(w.J).not.toBe(st.J);
  expect([w.J.cw, w.J.total]).toEqual([1143, 0]);
  expect(w.M.L).toBe(st.M.L);
  expect(w.M.cw).toBe(CW);
  const { s } = drawOut(w, off, 1143, now, c);
  sameStrip(s.M, TL.timelineModel(null, off, 1143, "clock", now, null));
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
    expect(b.tlJob).toBe(J);
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
    const ti = 200;
    const h = b.tlModel.heads[ti];
    const si = h.steps.findIndex((r) => r.lk === "tool" && r.start != null && r.dur > 0);
    b.tsel = h.steps[si].key;
    const c = slowNow(() => frame(b, cb));
    expect(b.tlJob).toBe(J);
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
    const L0 = b.tlModel.L;
    b.width = 1200;
    b.paneW = 1200;
    const m = made();
    slowNow(() => frame(b, cb));
    expect(since(m)).toEqual({ geo: 0, layout: 0, tail: 0 });
    expect(b.tlJob).not.toBe(J);
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
