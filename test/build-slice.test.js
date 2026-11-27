// bun test: a rows build's slice (buildRows with BUILD_MS) ends on time even when the turns are
// huge. The owner's long session has turns of 300 to 460 tool calls, and on a slower machine its
// first build's 10 ms slice ran to 45 ms: the time was checked only every 16 turns, and never in a
// turn's steps. Here the clock is the test's own: each step of an open turn costs STEP_MS, so a
// turn of 420 steps costs 21 ms, and every other call costs nothing. On the render harness
// (test/render-harness.js).
import { test, expect } from "bun:test";

import { Threads, draw, scripted, setup } from "./render-harness.js";

setup();

const STEP_MS = 0.05;
const STEPS = 420;
// Herdr's time for a draw (gpui-kit sandbox.rs, render); a timer's own is longer, but a slice
// must fit the shorter one wherever it runs.
const DRAW_MS = 50;
const ts = (s) => `2026-11-01T09:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.000Z`;

// A session of one short turn, then five turns of STEPS steps each, open with their steps shown,
// on a clock that only the steps move. Each slice's time and where it stopped are recorded.
async function hugeTurns() {
  const events = [];
  for (let n = 0; n < 6; n++) events.push({ k: "p", o: "human", t: `Prompt ${n + 1}`, ts: ts(n * 10) }, { k: "t", t: `Reply ${n + 1}.` }, { k: "d", ms: 4000, ts: ts(n * 10 + 4) });
  const { v, cx, s } = await scripted(events);
  v.debug = false;
  for (const turn of s.turns.slice(1)) {
    turn.steps = Array.from({ length: STEPS }, (_, i) => (i % 2 ? { k: "group", calls: ["Read"], count: 1 } : { k: "text", t: `Step ${i + 1}` }));
    const key = `0:${turn.n}`;
    v.open.add(key);
    v.lineTouched.add(key);
    v.lineOpen.add(key);
  }
  v.rowsKey = null;
  v.baseRows = null;
  v.rowJob = null;
  v.buildMax = () => 10;
  const real = performance.now;
  let T = real.call(performance);
  let inBuild = false;
  performance.now = () => T;
  const step = (fn) => function (...a) { if (inBuild) T += STEP_MS; return fn.apply(this, a); };
  v.groupIsOpen = step(Threads.prototype.groupIsOpen);
  v.stepLinks = step(Threads.prototype.stepLinks);
  const slices = [];
  v.buildRows = function (...a) {
    const t = T;
    inBuild = true;
    let out;
    try { out = Threads.prototype.buildRows.apply(this, a); } finally { inBuild = false; }
    const r = this.buildInfo.resume;
    // The rows a stopped slice keeps for the next (buildStep's job.from.rows).
    slices.push({ ms: T - t, ti: r ? r.ti : null, rows: r ? [...out] : null });
    return out;
  };
  const done = () => { performance.now = real; delete v.buildRows; delete v.groupIsOpen; delete v.stepLinks; };
  return { v, cx, s, slices, done };
}

// The first build is asked for outside a render, as the read's end asks for it (jumpLatest), then
// goes on a slice a frame. Every slice ends inside a draw's time, and the rows it ends with are a
// whole build's. With the time checked only between turns, every 16, the first slice built all
// five huge turns in one go: 105 ms.
test("a first build of turns with 400 steps each ends every slice within a draw's time, and ends with every row", async () => {
  const { v, cx, slices, done } = await hugeTurns();
  try {
    v.jumpLatest(true);
    for (let k = 0; k < 40 && (v.rowJob || v.rowsKey == null); k++) draw(v, cx);
    const max = Math.max(...slices.map((x) => x.ms));
    const built = v.baseRows.map((r) => r.key);
    const whole = Threads.prototype.buildRows.call(v, v.status()).map((r) => r.key);
    expect([max <= DRAW_MS, slices.length > 1, Boolean(v.rowJob), built.length, built]).toEqual([true, true, false, whole.length, whole]);
  } finally { done(); }
}, 60000);

// A slice that runs out in a turn's steps stops there, leaves none of that turn's rows, and the
// next slice builds that turn first and whole (its first turn is never stopped), so every slice
// gains a turn. With no check in the steps, the slice never stopped in a turn at all.
test("a slice that runs out inside a turn's steps leaves none of the turn's rows, and the next slice builds the turn whole", async () => {
  const { v, cx, s, slices, done } = await hugeTurns();
  try {
    v.jumpLatest(true);
    const first = slices[0];
    const second = s.turns[1];
    draw(v, cx);
    const next = slices[1];
    const own = (rows) => (rows ?? []).filter((r) => r.turn === second).length;
    // The next slice built the turn whole: a row for each of its steps, and its card's own.
    expect([first.ti, own(first.rows), first.ms < 2 * 10, next.ti, own(next.rows) > STEPS]).toEqual([1, 0, true, 2, true]);
  } finally { done(); }
}, 60000);
