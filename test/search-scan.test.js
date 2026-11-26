// bun test: a search in a long session draws within Herdr's time (TRD-123). Herdr stops a
// mod's draw that runs past about 50 ms and shows "This view could not be re-rendered" until
// one fits. On the test rig (Herdr 0.1.17, main at 635967f), in a 2,000-turn session, a
// search for "a", then "ar", then a word, stopped every draw for 15.7 s, in the search field's
// count and place. The owner first saw it on a long session.
import { test, expect, spyOn } from "bun:test";
import * as T from "../mods/agent-threads/core/turns.js";
import { isShown, oneCharTest, searchable } from "../mods/agent-threads/ui.js";
import { H, PINS, PRICE, draw, recordFiles, scripted, settleRows, setup, sliced, theme } from "./render-harness.js";

setup();

// ---- the clock ----
// The draws here run on a clock that moves only by the work counted, at prices for Herdr's
// interpreter, so a run does the same work in the same draws on any machine, however busy:
// - checks: one threadMatches call, 4 µs. The rig's trace (Herdr 0.1.17): a stopped draw
//   reached 1,700 to 2,600 turn keys of the place's scan in the 6 to 14 ms between entering
//   it (49 ms) and the stop (55 to 63 ms), 3 to 7 µs a key. In bun with the JIT off it is 0.3
//   to 0.8 µs.
// - reshapes and built: a turn reshaped, and a turn's rows built, at the harness's prices
//   (bun with the JIT off).
// - frames: the rest of a draw, 20 ms each, a model. A still draw with no search fits, as the
//   trace's 508 draws before the search did; on the trace the draws entered the place's scan
//   at 49 ms, after the count's scan (about 8 ms at 4 µs) and the rows' slices.
// The rig moves to a newer Herdr, so the figures are also taken at twice these prices (X 2):
// a check 8 µs, and reshapes and rows twice the harness's; the frame's model stays 20 ms.
// That fixed 20 ms decides the figures at 3x and 4x more than the price does (each slice is
// cut to what the draw has left): the rig's draws on Herdr 0.1.18 are the check, not these.
const COST = { checks: 0.004, reshapes: PRICE.reshapes, built: PRICE.built, frames: 20 };
const paid = { checks: 0, reshapes: 0, built: 0, frames: 0 };
let X = 1;
let spy = null;
const checks = () => paid.checks + (spy ? spy.mock.calls.length : 0);
const clock = () => X * (checks() * COST.checks + paid.reshapes * COST.reshapes + paid.built * COST.built) + paid.frames * COST.frames;
// The spy keeps every call's arguments: folded into paid now and then.
const fold = () => { if (spy) { paid.checks += spy.mock.calls.length; spy.mockClear(); } };
// Herdr's stop past LIMIT ms of a draw (H.stopDraw in the harness). QuickJS's interrupt cannot
// be caught; render() catches this one, so the driver sets renderOpen again, as the stop
// leaves it.
const LIMIT = 50;
// The stop lands at any point of a draw, inside the matches' scan too, which makes no element:
// a check (threadMatches) in a draw past LIMIT on the clock is stopped as well. And one stop
// can be planted (plantStop), once: at the first check of a draw at or after a given count of
// checks; or, with scan, at the given check among those the scan makes in draws.
let stopV = null;
let plant = null;
// Where the last planted stop landed: in the matches' scan (scanHits), in an older step's
// check back (tailBack) or elsewhere, and the turns of the session it was checking (landedIn).
let landed = null;
let landedIn = null;
const realMatches = T.threadMatches;
function stopHere(turns) {
  if (!stopV?.renderOpen) return false;
  if (plant?.back ? stopV.backing && --plant.back === 0 : plant?.scan ? stopV.scanning && --plant.scan === 0 : plant && checks() >= plant.at) { plant = null; landed = stopV.scanning ? "scan" : stopV.backing ? "back" : "other"; landedIn = turns; return true; }
  return base + clock() - stopV.renderAt > LIMIT;
}
// A seeded draw of numbers in [0, 1) (mulberry32), so a planted stop lands at the same check
// in every run.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// One stop planted at a check from 1 to span checks on from now, at random from rnd.
const plantStop = (rnd, span, scan = false) => {
  const k = 1 + Math.floor(rnd() * span);
  plant = scan ? { scan: k } : { at: checks() + k };
};

// n turns of made-up work over three days: every prompt has an "a"; "ar" (cart) is in a third
// of them; "rename" in a tenth; "zqxjvk" in none. The replies have none of them. With bare,
// the cart turns have no reply (an agent message with none is hidden, ui.js isShown).
function events(n, { bare = false } = {}) {
  const ev = [];
  const day = Math.ceil(n / 3);
  for (let i = 0; i < n; i++) {
    const ts = new Date(Date.UTC(2026, 10, 1 + Math.floor(i / day), 8, 0) + (i % day) * 20000).toISOString();
    const what = i % 10 === 0 ? "rename the queue helper" : i % 3 === 0 ? "check the cart total" : "look at the staging deploy";
    ev.push({ k: "p", o: "human", t: `Turn ${i}: please ${what} for order ${i} and tell me what you find.`, ts });
    if (!bare || what !== "check the cart total") ev.push({ k: "t", t: `Done for order ${i}. The totals round per line, so the sum is off by one cent; the helper now rounds once, the test covers it, and the logs show no new noise since the fix went in.` });
    ev.push({ k: "d", ms: 1000, ts });
  }
  return ev;
}
// The searches: two letters, a word, and a query with no match. One letter is under the
// search's minimum (minimum length, below): the list is not filtered and nothing is checked.
const QUERIES = ["ar", "rename", "zqxjvk"];

// A pane on a session of n such turns, every row built and shaped (each in one slice, the
// harness's whole-slice pane, with no budget), its work counted from here on, with its slices
// cut by the clock again (sliced), as in Herdr.
async function longPane(n, opts) {
  const { v, cx, s } = await scripted(events(n, opts));
  v.debug = false;
  v.width = 560; v.rootH = 1100; v.listH = 1000;
  H.listWindow = (k) => ({ start: Math.max(0, k - 14), end: k });
  v.shapeBudget = Infinity;
  for (let k = 0; k < 400; k++) { v.render(cx); cx.flush(0); if (settled(v)) break; }
  v.shapeBudget = null;
  sliced(v);
  for (const [name, n2] of [["reshape", "reshapes"], ["turnRows", "built"], ["frame", "frames"]]) {
    const f = v[name];
    v[name] = function (...a) { paid[n2]++; return f.apply(this, a); };
  }
  return { v, cx, s };
}
// The rows built and the matches all found (counted), and every row shaped (settled).
const counting = (v) => { const h = v.hitsNow(); return Boolean(h && !h.done); };
const counted = (v) => !v.rowJob && !counting(v);
const settled = (v) => counted(v) && !v.staleRows?.length && !(v.shapeLeft > 0);

// The figures here are about the slices: each draw builds, shapes and scans only what its
// slice lets it. A pane whose slices never end (the harness's whole-slice pane) does all of
// it in the first draw, so every figure would be about that, not about Herdr's draws.
test("the search figures' pane cuts its rows build and its shaping into slices by the clock, as in Herdr", async () => {
  const { v } = await longPane(600);
  expect(v.buildMax()).toBeLessThanOrEqual(10);
  expect(v.shapeMax()).toBeLessThanOrEqual(12);
});

// Runs fn on the clock, with Herdr's stop armed for v's draws. The clock goes on from the real
// one's time (base), so a time the pane kept from before (a slice's end, a row's cut) is past,
// as it would be: from 0, how far ahead it looked would depend on how long the run had gone.
let base = 0;
function priced(v, fn) {
  const real = performance.now;
  base = real.call(performance);
  for (const k of Object.keys(paid)) paid[k] = 0;
  spy = spyOn(T, "threadMatches").mockImplementation((...a) => {
    if (stopHere(a[0])) throw new Error("interrupted");
    return realMatches(...a);
  });
  stopV = v;
  // Whether a check is the scan's (a planted stop's landing).
  const own = Object.hasOwn(v, "scanHits") ? v.scanHits : null;
  const scan = v.scanHits;
  v.scanHits = function (...a) { this.scanning = true; try { return scan.apply(this, a); } finally { this.scanning = false; } };
  const ownBack = Object.hasOwn(v, "tailBack") ? v.tailBack : null;
  const back = v.tailBack;
  v.tailBack = function (...a) { this.backing = true; try { return back.apply(this, a); } finally { this.backing = false; } };
  performance.now = () => base + clock();
  H.stopDraw = () => v.renderOpen && base + clock() - v.renderAt > LIMIT;
  v.frameBase = 0;
  v.cutUntil = 0;
  try { return fn(); } finally {
    performance.now = real; H.stopDraw = null; stopV = null; plant = null; fold(); spy.mockRestore(); spy = null;
    if (own) v.scanHits = own;
    else delete v.scanHits;
    if (ownBack) v.tailBack = ownBack;
    else delete v.tailBack;
  }
}

// One draw on the clock: its cost, its checks, and whether Herdr stopped it.
function drawOnce(v, cx) {
  const t0 = clock();
  const c0 = checks();
  let stopped = false;
  try { v.render(cx); } catch (e) {
    if (String(e?.message) !== "interrupted") throw e;
    stopped = true;
    v.renderOpen = true;
  }
  const out = { ms: clock() - t0, checks: checks() - c0, stopped };
  fold();
  cx.flush(0);
  return out;
}

// A search typed into a long session, draw by draw, as the owner did: the search command for
// "a", one letter, under the minimum; then each query typed into the field. The figures for
// the one letter: what it checks and whether the list stays as it was. For each query: the
// handler's cost, the draws until the rows are built and the matches counted, and until every
// row is shaped, at most 1,000 (the rows a search shows are shaped again for its highlights,
// at most SHAPE_MS a draw: "ar" at 5,600 turns is 1,680 reshapes, 0.4 s of them at the
// harness's price, about 75 draws at 5 ms).
// With seed, one stop is planted at a random check among the first 400 the scan makes in each
// query's draws, and the run says whether each query's matches and places are right after it.
async function searchRun(n, x, seed = 0) {
  const { v, cx, s } = await longPane(n);
  const rnd = seed ? seeded(seed) : null;
  const turns = s.turns;
  const real = T.threadMatches;
  X = x;
  try {
    return priced(v, () => {
      const out = { turns: turns.length, x, steps: [] };
      // Draws with no search: none stopped, and they set the frame's cost.
      const before = [];
      for (let k = 0; k < 3; k++) before.push(drawOnce(v, cx));
      out.beforeStops = before.filter((d) => d.stopped).length;
      // One letter: the command, then three draws.
      const rows0 = v.rowsKey;
      const n0 = v.baseRows.length;
      const c1 = checks();
      v.action("search:a", cx);
      const oneTyped = checks() - c1;
      const oneDraws = [drawOnce(v, cx), drawOnce(v, cx), drawOnce(v, cx)];
      out.one = { typed: oneTyped, draws: oneDraws.map((d) => d.checks), stops: oneDraws.filter((d) => d.stopped).length,
        sameRows: v.rowsKey === rows0 && v.baseRows.length === n0, text: fieldText(v) };
      for (const q of QUERIES) {
        const t0 = clock();
        const c0 = checks();
        v.input.text = q;
        v.input.handlers.change(null, cx);
        const typed = { ms: clock() - t0, checks: checks() - c0 };
        landed = null;
        if (rnd) plantStop(rnd, 400, true);
        const draws = [];
        let countedAt = null;
        for (let k = 0; k < 1000; k++) {
          const d = drawOnce(v, cx);
          draws.push(d);
          if (d.stopped) continue;
          if (countedAt == null && counted(v)) countedAt = k + 1;
          if (settled(v)) break;
        }
        // A draw with nothing changed once it has settled.
        const still = drawOnce(v, cx);
        const want = turns.filter((t) => isShown(t, { agentTurns: false, live: false, turns }) && real(turns, t, q)).length;
        const firstReturn = draws.findIndex((d) => !d.stopped);
        out.steps.push({
          q, typed, counted: countedAt, frames: draws.length, stops: draws.filter((d) => d.stopped).length,
          firstReturn: firstReturn < 0 ? null : firstReturn + 1, settled: settled(v),
          maxMs: Math.max(...draws.map((d) => d.ms)), maxChecks: Math.max(...draws.map((d) => d.checks)),
          still, count: v.filterCount(), total: v.matchPlace().n, want, landed,
          exact: rnd ? JSON.stringify(places(v)) === JSON.stringify(wantOf(v, q, real)) : null,
        });
      }
      return out;
    });
  } finally { X = 1; }
}

// A count still going on, as the field shows it: "Counting…", or a total with a "+". The
// total itself is read as a number (matchPlace), not from the field's text, whose digits
// are grouped by the machine's locale ("1,680", "1.680", "1 680").
const partial = (text) => text === "Counting…" || String(text).includes("+");
// A number as the test names write it, 2,000 or 5,600, whatever the machine's locale.
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+$)/g, ",");
// Each pane's figures once, for the tests that read them.
const runs = new Map();
const figures = (n, x, seed = 0) => { const k = `${n}x${x}s${seed}`; if (!runs.has(k)) runs.set(k, searchRun(n, x, seed)); return runs.get(k); };
// The search command and each letter typed run at most one slice of the matches (SCAN_MS,
// 6 ms) and check the selected turn: 6.5 ms with the clock read every 32 checks.
const HANDLER_MS = 6.5;

for (const x of [1, 2]) for (const n of [2000, 5600]) {
  const at = `at ${grouped(n)} turns${x === 1 ? "" : `, at ${x}x the prices`}`;
  test(`search ${at}: one letter checks no turn and leaves the list as it was`, async () => {
    const r = await figures(n, x);
    expect(r.one).toEqual({ typed: 0, draws: [0, 0, 0], stops: 0, sameRows: true, text: "Type 2 or more characters" });
  }, 300000);
  test(`search ${at}: "ar", a word and a query with no match each draw inside Herdr's time from the first frame, and settle on the right count`, async () => {
    const r = await figures(n, x);
    if (process.env.THREADS_SEARCH_FIGURES) console.log(JSON.stringify(r));
    expect(r.turns).toBe(n);
    // The pane draws before the search: the model's frame fits.
    expect(r.beforeStops).toBe(0);
    // No draw is stopped, so the first one returns, and the rows settle, for every query.
    expect(r.steps.map((st) => ({ q: st.q, stops: st.stops, firstReturn: st.firstReturn, settled: st.settled }))).toEqual(QUERIES.map((q) => ({ q, stops: 0, firstReturn: 1, settled: true })));
    // The rows are built and the matches counted within 40 draws.
    for (const st of r.steps) expect([st.q, st.counted != null && st.counted <= 40]).toEqual([st.q, true]);
    // The final count is every matching shown turn.
    expect(r.steps.map((st) => [st.q, st.total, partial(st.count)])).toEqual(r.steps.map((st) => [st.q, st.want, false]));
  }, 300000);
  // After a stop the rows wait out the light draws (CUT_MS) to be reshaped, on a timer that
  // flush(0) does not run: these runs are judged built and counted, not shaped.
  test(`search ${at}, a stop planted at a random check of the scan in each query's draws: each counts right, every place too`, async () => {
    const r = await figures(n, x, 20261124 + n + x);
    if (process.env.THREADS_SEARCH_FIGURES) console.log(JSON.stringify(r));
    expect(r.steps.map((st) => ({ q: st.q, stops: st.stops, landed: st.landed, exact: st.exact }))).toEqual(QUERIES.map((q) => ({ q, stops: 1, landed: "scan", exact: true })));
    for (const st of r.steps) expect([st.q, st.counted != null && st.counted <= 40]).toEqual([st.q, true]);
    expect(r.steps.map((st) => [st.q, st.total, partial(st.count)])).toEqual(r.steps.map((st) => [st.q, st.want, false]));
  }, 300000);
  test(`search ${at}: a draw with nothing changed checks no turn, no draw runs past Herdr's time, and the command and each letter take one slice`, async () => {
    const r = await figures(n, x);
    expect(r.steps.map((st) => ({ q: st.q, still: st.still.checks }))).toEqual(QUERIES.map((q) => ({ q, still: 0 })));
    // The scan is cut into slices that fit beside the rest of the draw.
    expect(r.steps.map((st) => [st.q, st.maxMs <= LIMIT])).toEqual(QUERIES.map((q) => [q, true]));
    expect(r.steps.map((st) => [st.q, st.typed.ms <= HANDLER_MS])).toEqual(QUERIES.map((q) => [q, true]));
  }, 300000);
}

// n (olderMatch) right after a letter, before any draw: the step asks for the rows first
// (action), which starts the new search's rows build, one slice of it (BUILD_MS, 10 ms) in the
// handler, then the step itself. A later n checks nothing.
const STEP_MS = 10 + HANDLER_MS;
for (const x of [1, 2]) test(`n right after a letter at 5,600 turns${x === 1 ? "" : `, at ${x}x the prices`} takes one slice of rows and one of the scan at most, a later n none`, async () => {
  const { v, cx, s } = await longPane(5600);
  v.sel = `0:${s.turns.length}`;
  X = x;
  let r;
  try {
    r = priced(v, () => {
      v.input.text = "ar";
      v.input.handlers.change(null, cx);
      const t0 = clock();
      const c0 = checks();
      v.action("olderMatch", cx);
      const first = { ms: clock() - t0, checks: checks() - c0 };
      const t1 = clock();
      const c1 = checks();
      v.action("olderMatch", cx);
      return { first, later: { ms: clock() - t1, checks: checks() - c1 } };
    });
  } finally { X = 1; }
  if (process.env.THREADS_SEARCH_FIGURES) console.log(JSON.stringify({ step: x, ...r }));
  expect(r.first.ms).toBeLessThanOrEqual(STEP_MS);
  expect(r.later.checks).toBe(0);
}, 120000);

// A rows build stopped inside one of its slices goes on to the rows one build makes. The slice
// that resumes a build adds to the rows it was handed, and the place it starts from moves only
// when a slice ends.
test("a rows build stopped inside the slice that resumes it ends with the rows one build makes, each once", async () => {
  const { v, cx } = await longPane(600);
  const sig = () => v.baseRows.map((r, i) => `${r.kind}|${r.key}|${v.baseSizes[i]}`);
  const whole = sig();
  // 0.05 ms a turn's rows: a 10 ms slice builds about 200 turns, so the build takes slices.
  COST.built = 0.05;
  const turnRows = v.turnRows;
  let cut = null;
  let stops = 0;
  try {
    priced(v, () => {
      v.rowsKey = null;
      v.rowBuild = null;
      // The second slice (the first that resumes) is stopped after 50 turns.
      v.turnRows = function (...a) {
        if (cut == null && this.rowJob?.from?.own && this.renderOpen) cut = 0;
        if (cut != null && cut >= 0 && ++cut > 50) { cut = -1; throw new Error("interrupted"); }
        return turnRows.apply(this, a);
      };
      for (let k = 0; k < 100; k++) {
        try { v.render(cx); } catch (e) { if (String(e?.message) !== "interrupted") throw e; stops++; v.renderOpen = true; }
        cx.flush(0);
        if (!v.rowJob && k > 0) break;
      }
    });
  } finally { COST.built = PRICE.built; v.turnRows = turnRows; }
  expect(cut).toBe(-1);
  expect(stops).toBe(1);
  expect(v.rowJob).toBe(null);
  const keys = v.baseRows.map((r) => r.key);
  expect(new Set(keys).size).toBe(keys.length);
  expect(sig()).toEqual(whole);
}, 120000);

// The same at every place a slice can be stopped: while it builds rows or while it sizes them,
// in the first slice, in a slice that resumes the build, and in a sizing pass carried over to
// the next frame. Each stop ends with the rows one build makes, each once, at their heights.
test("a rows build stopped anywhere, building or sizing, first slice or later, ends with the rows one build makes", async () => {
  const { v, cx } = await longPane(600);
  const sig = () => v.baseRows.map((r, i) => `${r.kind}|${r.key}|${v.baseSizes[i]}`);
  const whole = sig();
  const railSig = () => v.railTurns.map((r) => r.key).join(",");
  const rail = railSig();
  // A turn's rows 0.05 ms and a row's height 0.02 ms: a slice builds about 200 turns and runs
  // out of time sizing them, so the sizing goes on in the next frame.
  COST.built = 0.05;
  const { turnRows, height, buildRows } = v;
  let unit = 0;
  let stopAt = -1;
  let rowsFrame = -1;
  let sized = 0;
  const phases = new Set();
  const stop = (self, what) => {
    if (++unit !== stopAt) return;
    const job = self.rowJob;
    phases.add(`${what} in ${!job.from ? "the first slice" : job.from.own ? "a resumed slice" : "a kept-rows slice"}${what === "sizing" && rowsFrame !== self.renders ? ", carried over" : ""}`);
    throw new Error("interrupted");
  };
  v.turnRows = function (...a) { stop(this, "building"); return turnRows.apply(this, a); };
  v.height = function (...a) { if (this.rowJob) { stop(this, "sizing"); sized++; } return height.apply(this, a); };
  v.buildRows = function (...a) { rowsFrame = this.renders; return buildRows.apply(this, a); };
  const failed = [];
  try {
    // Cold, with no closed turn's rows kept from an earlier build: 1,203 units a build (600
    // turns built, 603 rows sized), a stop every 47th. Warm, with them kept: 605 units (5 rows
    // are sized again), a stop every 23rd.
    for (const [cold, step, end] of [[true, 47, 1200], [false, 23, 600]]) {
      for (stopAt = cold ? 23 : 11; stopAt < end; stopAt += step) {
        if (cold) v.keptFor().rows.clear();
        unit = 0;
        let stops = 0;
        priced(v, () => {
          performance.now = () => base + clock() + sized * 0.02;
          sized = 0;
          v.rowsKey = null;
          v.rowBuild = null;
          for (let k = 0; k < 100; k++) {
            try { v.render(cx); } catch (e) { if (String(e?.message) !== "interrupted") throw e; stops++; v.renderOpen = true; }
            cx.flush(0);
            if (!v.rowJob && k > 0) break;
          }
        });
        const keys = v.baseRows.map((r) => r.key);
        if (stops !== 1 || v.rowJob || new Set(keys).size !== keys.length || sig().join("\n") !== whole.join("\n") || railSig() !== rail) failed.push({ cold, stopAt, stops, rows: keys.length });
      }
    }
  } finally { COST.built = PRICE.built; Object.assign(v, { turnRows, height, buildRows }); }
  expect(failed).toEqual([]);
  expect([...phases].sort()).toEqual([
    "building in a resumed slice", "building in the first slice",
    "sizing in a resumed slice", "sizing in a resumed slice, carried over",
    "sizing in the first slice", "sizing in the first slice, carried over",
  ]);
}, 120000);

// A build stopped while sizing the last row of its last slice, and the running turn ending and a new
// turn coming in before it resumes (the build goes on: only the newest turns changed). The
// sizes and index entries the stopped slice left are for rows that are now different, so they
// are cut too: the build ends with the rows, heights and index one build of the new turns makes.
test("a build stopped while sizing, with turns coming in before it resumes, ends with one build's rows, heights and index", async () => {
  const ts = new Date(Date.UTC(2026, 10, 4, 9, 0)).toISOString();
  const { v, cx, s } = await longPane(600);
  // The newest turn is running, selected, with its steps open: rows of their own, which go
  // when it ends.
  T.apply(s, { k: "p", o: "human", t: "Turn 600: please rename the cart total for order 600.", ts });
  for (let i = 0; i < 4; i++) {
    T.apply(s, { k: "t", t: `Looking at part ${i}.` });
    T.apply(s, { k: "u", n: "Bash", id: `c${i}` });
  }
  T.apply(s, { k: "t", t: "Working on it." });
  v.sel = `0:${s.turns.length}`;
  settleRows(v, cx);
  const liveKeys = v.baseRows.filter((r) => r.key.includes(`0:${s.turns.length}`) && r.key !== `0:${s.turns.length}`).map((r) => r.key);
  expect(liveKeys.length).toBeGreaterThan(2);
  const lastKey = v.baseRows.at(-1).key;
  const { height } = v;
  let stopIn = false;
  let stopped = 0;
  v.height = function (...a) {
    // The last row, in a slice that resumes the build: every row before it, the running
    // turn's too, is sized.
    if (this.rowJob?.from?.own && stopIn && a[0]?.key === lastKey) { stopIn = false; stopped++; throw new Error("interrupted"); }
    return height.apply(this, a);
  };
  COST.built = 0.05;
  try {
    priced(v, () => {
      v.keptFor().rows.clear();
      v.rowsKey = null;
      v.rowBuild = null;
      stopIn = true;
      for (let k = 0; k < 100 && !stopped; k++) {
        try { v.render(cx); } catch (e) { if (String(e?.message) !== "interrupted") throw e; v.renderOpen = true; }
        cx.flush(0);
      }
      expect(stopped).toBe(1);
      expect(v.rowJob).not.toBe(null);
      // Before it resumes: the running turn ends with a longer reply, and a turn comes in.
      T.apply(s, { k: "t", t: "Renamed it.\n\nThe cart total now rounds once per order, and the test covers the old case.\n\nNothing else changed." });
      T.apply(s, { k: "d", ms: 1000, ts });
      T.apply(s, { k: "p", o: "human", t: "Turn 601: please check the queue helper.", ts });
      for (let k = 0; k < 100; k++) {
        v.render(cx);
        cx.flush(0);
        if (!v.rowJob) break;
      }
    });
  } finally { COST.built = PRICE.built; v.height = height; }
  expect(v.rowJob).toBe(null);
  const sig = () => v.baseRows.map((r, i) => `${r.kind}|${r.key}|${v.baseSizes[i]}`);
  const index = () => [...v.baseIndex].map(([k, i]) => `${k}@${i}`).sort();
  const got = { rows: sig(), index: index() };
  // Each index entry is its row's place, and the running turn's step rows are gone.
  expect([...v.baseIndex].filter(([k, i]) => v.baseRows[i]?.key !== k)).toEqual([]);
  expect(liveKeys.filter((k) => v.baseIndex.has(k) || v.baseRows.some((r) => r.key === k))).toEqual([]);
  // One build of the same turns.
  v.keptFor().rows.clear();
  v.rowsKey = null;
  v.rowBuild = null;
  settleRows(v, cx);
  expect(got).toEqual({ rows: sig(), index: index() });
}, 120000);

// ---- one set of matches, kept across draws ----
// The search's matches are found once for each change and kept: the field's count, its place,
// its two steps and n / Shift n read them, and a draw with nothing changed checks no turn.

// The shown turns q matches, newest first, counted directly (with match, the matcher: the
// real one inside priced, which counts T.threadMatches as checks).
const direct = (v, q, agentTurns = false, match = T.threadMatches) => {
  const out = [];
  v.sessions.forEach((s, si) => s.turns.forEach((t, ti) => {
    if (isShown(t, { agentTurns, live: v.isLive(s, si, ti), turns: s.turns }) && match(s.turns, t, q)) out.push(`${si}:${t.n}`);
  }));
  return out.reverse();
};
const hiddenDirect = (v, q, agentTurns = false, match = T.threadMatches) => {
  let n = 0;
  v.sessions.forEach((s, si) => s.turns.forEach((t, ti) => {
    if (!isShown(t, { agentTurns, live: v.isLive(s, si, ti), turns: s.turns }) && match(s.turns, t, q)) n++;
  }));
  return n;
};
// The set the search should hold, in the form places() gives.
function wantOf(v, q, match = T.threadMatches) {
  const keys = direct(v, q, false, match);
  return { keys, at: keys.map((_, i) => i + 1), hidden: hiddenDirect(v, q, false, match), done: true };
}
// Draws on the clock until the rows and matches settle: the draws, the stops and the checks.
// With until counted, until the rows are built and the matches counted: after a stop the
// rows are reshaped only once the light draws end (CUT_MS on the clock).
function drive(v, cx, max = 200, until = settled) {
  let draws = 0, stops = 0, n = 0;
  for (; draws < max; draws++) {
    const d = drawOnce(v, cx);
    n += d.checks;
    if (d.stopped) stops++;
    else if (until(v)) { draws++; break; }
  }
  return { draws, stops, checks: n, settled: settled(v), counted: counted(v) };
}
const fieldText = (v) => String(v.filterCount());

test("a search checks each turn once for its matches and once for its rows, and a draw with nothing changed checks none", async () => {
  const { v, cx, s } = await longPane(2000);
  // Following the newest turn, which does not match.
  v.sel = `0:${s.turns.length}`;
  const r = priced(v, () => {
    drive(v, cx);
    const c0 = checks();
    v.action("search:rename", cx);
    const typed = checks() - c0;
    const run = drive(v, cx);
    const still = [drawOnce(v, cx), drawOnce(v, cx), drawOnce(v, cx)].map((d) => d.checks);
    return { typed, run, still };
  });
  expect(r.run.settled).toBe(true);
  expect(r.run.stops).toBe(0);
  // The command and the draws check each turn once for the matches (and the selected turn),
  // and once for the rows.
  expect(r.typed + r.run.checks).toBe(2 * s.turns.length + 1);
  expect(r.still).toEqual([0, 0, 0]);
  expect(fieldText(v)).toBe("1 of 200 · newest first");
}, 120000);

test("the field's count and place, its steps and n / Shift n walk the same matches, newest first", async () => {
  const { v, cx, s } = await longPane(600);
  v.sel = `0:${s.turns.length}`;
  v.action("search:rename", cx);
  settleRows(v, cx);
  const want = direct(v, "rename");
  expect(want.length).toBe(60);
  // The search starts at the newest match.
  expect(v.sel).toBe(want[0]);
  const seen = [v.sel];
  const texts = [fieldText(v)];
  for (let k = 1; k < want.length; k++) {
    expect(v.action("olderMatch", cx)).toBe(true);
    draw(v, cx);
    seen.push(v.sel);
    texts.push(fieldText(v));
  }
  expect(seen).toEqual(want);
  expect(texts).toEqual(want.map((_, i) => (i === want.length - 1 ? "60 of 60 · first mention" : `${i + 1} of 60 · newest first`)));
  // At the oldest the older step stays, and its button is dimmed.
  expect(v.action("olderMatch", cx)).toBe(true);
  expect(v.sel).toBe(want.at(-1));
  expect(v.matchPlace()).toEqual({ at: 60, n: 60 });
  // Back up with the newer step.
  expect(v.action("newerMatch", cx)).toBe(true);
  expect(v.sel).toBe(want.at(-2));
  // With no match selected, a step goes to the newest; the count says how many.
  v.sel = "0:2";
  expect(fieldText(v)).toBe("60 matches");
  expect(v.action("olderMatch", cx)).toBe(true);
  expect(v.sel).toBe(want[0]);
}, 120000);

test("the matches are found again for a new turn, new sender rules and agent messages shown, and match a direct count", async () => {
  const { v, cx, s } = await longPane(2000, { bare: true });
  const { apply } = await import("../mods/agent-threads/core/turns.js");
  v.sel = `0:${s.turns.length}`;
  v.action("search:ar", cx);
  settleRows(v, cx);
  expect(fieldText(v)).toBe(`1 of ${direct(v, "ar").length} · newest first`);
  const sel = v.sel;
  // A turn arrives that matches: the count grows, the selection stays, and only the newest
  // turns are checked again for the matches (the rows are built again under a search).
  const ts = new Date(Date.UTC(2026, 10, 4, 9, 0)).toISOString();
  const r = priced(v, () => {
    apply(s, { k: "p", o: "human", t: "Turn 2000: please check the cart total again.", ts });
    apply(s, { k: "d", ms: 1000, ts });
    return drive(v, cx);
  });
  expect(r.settled).toBe(true);
  expect(r.checks).toBeLessThanOrEqual(s.turns.length + 64);
  expect(v.sel).toBe(sel);
  expect(v.matchPlace()).toEqual({ at: 2, n: direct(v, "ar").length });
  expect(fieldText(v)).toBe(`2 of ${direct(v, "ar").length} · newest first`);
  // New sender rules make the cart turns agent messages, hidden as they have no reply: the
  // matches are found again, among the hidden ones.
  const carts = direct(v, "ar").length;
  expect(carts).toBe(601);
  v.setSenders([{ n: 1, re: /^Turn \d+: please check/, label: "Checker" }], [], 1);
  settleRows(v, cx);
  expect(direct(v, "ar").length).toBe(0);
  expect(hiddenDirect(v, "ar")).toBe(carts);
  expect(fieldText(v)).toBe(`No matches · ${carts} hidden`);
  // Agent messages shown: they are matches again.
  v.setAgents(true, cx);
  settleRows(v, cx);
  expect(direct(v, "ar", true).length).toBe(carts);
  expect(v.matchPlace().n).toBe(carts);
  expect(fieldText(v)).toMatch(new RegExp(`^(${carts} matches|\\d+ of ${carts} · (newest first|first mention))$`));
}, 120000);

// ---- the matches counted in slices ----
// The matches are found a slice a draw, newest first, so a place counted from the newest stays
// as older ones come in. Until all are found the field says so: "Counting…" with none found
// yet, then the total with a "+". "No matches", "first mention" and "only mention" wait for
// the last turn to be checked, and the older step stays on while more can come.

// The field in each draw of a search at 5,600 turns, until the matches are counted.
function countRun(v, cx, q, before = () => {}) {
  const texts = [];
  priced(v, () => {
    v.action(`search:${q}`, cx);
    before();
    texts.push(fieldText(v));
    for (let k = 0; k < 60; k++) {
      const d = drawOnce(v, cx);
      expect(d.stopped).toBe(false);
      texts.push(fieldText(v));
      if (!counting(v)) break;
    }
  });
  return { texts };
}
// The calls made for the element with this id, up to the next id (render.test.js afterId).
function afterId(calls, id) {
  const i = calls.findIndex((e) => e[0] === "id" && e[1] === id);
  if (i < 0) return null;
  const j = calls.findIndex((e, k) => k > i && e[0] === "id");
  return calls.slice(i + 1, j < 0 ? undefined : j);
}
const olderButton = (v) => { H.rec = []; v.stepButtons(theme); const c = H.rec; H.rec = null; return afterId(c, "th-match-older"); };

test("while the matches are counted the field says so, and says no match, first or only mention once every turn is checked", async () => {
  const { v, cx, s } = await longPane(5600);
  const last = `0:${s.turns.length}`;
  // No match: "Counting…" until the last turn is checked.
  v.sel = last;
  let r = countRun(v, cx, "zqxjvk");
  expect(r.texts.length).toBeGreaterThan(2);
  expect(r.texts.slice(0, -1).every((t) => t === "Counting…")).toBe(true);
  expect(r.texts.at(-1)).toBe("No matches");
  // A word: the newest match selected, the total growing with a "+".
  v.input.set_value("");
  v.setQuery("", cx);
  v.sel = last;
  r = countRun(v, cx, "rename");
  const n = direct(v, "rename").length;
  expect(n).toBe(560);
  const mid = r.texts.slice(0, -1);
  expect(mid.length).toBeGreaterThan(1);
  for (const t of mid) expect(t).toMatch(/^1 of \d+\+ · newest first$/);
  const totals = mid.map((t) => Number(t.match(/of (\d+)/)[1]));
  expect(totals).toEqual([...totals].sort((a, b) => a - b));
  expect(totals.every((t) => t < n)).toBe(true);
  expect(r.texts.at(-1)).toBe("1 of 560 · newest first");
  // Searched again with nothing changed: the kept matches, at once.
  v.input.set_value("");
  v.setQuery("", cx);
  v.sel = last;
  r = countRun(v, cx, "rename");
  expect(r.texts).toEqual(["1 of 560 · newest first", "1 of 560 · newest first"]);
  // No match selected: "N+ matches", then the count ("queue" is in the same turns).
  v.input.set_value("");
  v.setQuery("", cx);
  v.sel = last;
  r = countRun(v, cx, "queue", () => { v.sel = "0:2"; });
  expect(r.texts.length).toBeGreaterThan(2);
  for (const t of r.texts.slice(0, -1)) expect(t).toMatch(/^\d+\+ matches$/);
  expect(r.texts.at(-1)).toBe("560 matches");
}, 120000);

test("while counting, the oldest match found so far is not the first mention, and the older step past it checks one slice", async () => {
  const { v, cx, s } = await longPane(5600);
  v.sel = `0:${s.turns.length}`;
  const want = direct(v, "rename");
  const r = priced(v, () => {
    v.action("search:rename", cx);
    drawOnce(v, cx);
    const found = v.matchPlace().n;
    // Up to the oldest match found by the command's slice: each step checks no turn.
    const stepChecks = [];
    for (let k = 1; k < found; k++) { const c0 = checks(); v.action("olderMatch", cx); stepChecks.push(checks() - c0); }
    const atOldest = { place: v.matchPlace(), text: fieldText(v), sel: v.sel, button: olderButton(v) };
    const t0 = clock();
    const c0 = checks();
    v.action("olderMatch", cx);
    const past = { ms: clock() - t0, checks: checks() - c0, sel: v.sel, place: v.matchPlace() };
    return { found, stepChecks, atOldest, past };
  });
  expect(r.found).toBeGreaterThan(1);
  expect(r.found).toBeLessThan(want.length);
  expect(r.stepChecks.every((c) => c === 0)).toBe(true);
  expect(r.atOldest.sel).toBe(want[r.found - 1]);
  expect(r.atOldest.text).toBe(`${r.found} of ${r.found}+ · newest first`);
  // Its older step is on: more can come.
  expect(r.atOldest.button).toContainEqual(["tooltip", "Older match (n)"]);
  expect(r.atOldest.button.some((e) => e[0] === "opacity")).toBe(false);
  // Past it: one slice, which finds the next older match.
  expect(r.past.ms).toBeLessThanOrEqual(HANDLER_MS);
  expect(r.past.sel).toBe(want[r.found]);
  expect(r.past.place.at).toBe(r.found + 1);
}, 120000);

// The field's settled words are as before: the count and place, the end, the hidden matches,
// the narrow pane's, and the jump's.
test("the field's words once the matches are counted are unchanged", async () => {
  const { v, cx, s } = await longPane(600, { bare: true });
  const say = (q, sel, w = 560) => {
    v.setQuery(q, cx);
    if (sel !== undefined) v.sel = sel;
    v.paneW = w;
    settleRows(v, cx);
    if (sel !== undefined) v.sel = sel;
    return fieldText(v);
  };
  const renames = direct(v, "rename");
  expect(say("rename", renames[0])).toBe("1 of 60 · newest first");
  expect(say("rename", renames[1])).toBe("2 of 60 · newest first");
  expect(say("rename", renames.at(-1))).toBe("60 of 60 · first mention");
  expect(say("rename", "0:2")).toBe("60 matches");
  expect(say("turn 7:", "0:8")).toBe("1 of 1 · only mention");
  expect(say("turn 7:", "0:2")).toBe("1 match");
  expect(say("zqxjvk")).toBe("No matches");
  // The cart turns made agent messages with no reply: hidden, and counted apart.
  v.setSenders([{ n: 1, re: /^Turn \d+: please check/, label: "Checker" }], [], 1);
  const carts = s.turns.filter((t) => t.agent).length;
  expect(carts).toBe(180);
  expect(say("cart")).toBe(`No matches · ${carts} hidden`);
  const o = direct(v, "order 30");
  expect([o.length, hiddenDirect(v, "order 30")]).toEqual([8, 3]);
  expect(say("order 30", o[0])).toBe("1 of 8 · newest first · 3 hidden");
  // A pane under 420 px: the place alone.
  expect(say("rename", renames[1], 400)).toBe("2 of 60");
  expect(say("rename", renames.at(-1), 400)).toBe("60 of 60 · first");
  // A jump.
  expect(say("#")).toBe("turn #");
  expect(say("#12")).toBe("turn 12");
  expect(say("#9999")).toBe("no turn 9999");
}, 120000);

// ---- the count is never wrong ----
// For each query, the count and every place equal a direct count when an agent's turn comes in
// and when sender rules change while the matches are counted.

// The kept set's matches, newest first, and each one's place, for the direct list.
function places(v) {
  const h = v.hitsNow();
  const keys = [];
  for (let p = h.top - 1; p >= h.bot; p--) keys.push(h.by.get(p));
  const was = v.sel;
  const at = keys.map((k) => { v.sel = k; return v.matchPlace().at; });
  v.sel = was;
  return { keys, at, hidden: h.hidden, done: h.done };
}
const want = (v, q) => wantOf(v, q);

// Each of these runs again with one stop planted at a random check (seeded), at the change.
const PLANTED = [0, 99];
const plantName = (seed) => (seed ? ", with a stop planted at a random check" : "");

for (const q of QUERIES) for (const seed of PLANTED) {
  test(`"${q}" at 5,600 turns: a turn coming in while the matches are counted leaves the count and every place right${plantName(seed)}`, async () => {
    const { v, cx, s } = await longPane(5600);
    v.sel = `0:${s.turns.length}`;
    const ts = new Date(Date.UTC(2026, 10, 4, 9, 0)).toISOString();
    const seen = [];
    priced(v, () => {
      v.action(`search:${q}`, cx);
      drawOnce(v, cx);
      expect(counting(v)).toBe(true);
      // A turn comes in and runs (the newest turn, live), then ends, the scan going on.
      T.apply(s, { k: "p", o: "human", t: `Turn ${s.turns.length}: please rename the cart for order 1.`, ts });
      landed = null;
      if (seed) plantStop(seeded(seed), 1000, true);
      seen.push(fieldText(v));
      drawOnce(v, cx);
      seen.push(fieldText(v));
      T.apply(s, { k: "t", t: "Renamed." });
      drawOnce(v, cx);
      T.apply(s, { k: "d", ms: 1000, ts });
      for (let k = 0; k < 60 && counting(v); k++) { drawOnce(v, cx); seen.push(fieldText(v)); }
    });
    expect(counting(v)).toBe(false);
    if (seed) expect(landed).toBe("scan");
    expect(places(v)).toEqual(want(v, q));
    // "No matches" only once every turn was checked.
    expect(seen.slice(0, -1).some((t) => t.startsWith("No matches"))).toBe(false);
    const n = direct(v, q).length;
    expect(fieldText(v).replace(/,/g, "")).toContain(n ? String(n) : "No matches");
  }, 120000);

  test(`"${q}" at 5,600 turns: sender rules changed while the matches are counted leave the count and every place right${plantName(seed)}`, async () => {
    const { v, cx, s } = await longPane(5600, { bare: true });
    v.sel = `0:${s.turns.length}`;
    // The new rules' marking in slices of 1,000 turns, a slice each time the test lets it go on
    // (cx.sleep), as a settings change marks them between draws.
    const real = T.remarkSenders;
    const remark = spyOn(T, "remarkSenders").mockImplementation((ss, rules, from, until) => {
      if (until === Infinity) return real(ss, rules, from, until);
      const pn = performance.now;
      let t = 0;
      performance.now = () => (t += 0.01);
      try { return real(ss, rules, from, 10); } finally { performance.now = pn; }
    });
    const gates = [];
    cx.sleepHook = () => new Promise((r) => gates.push(r));
    const seen = [];
    let slices = 0;
    try {
      await (async () => {
        const run = priced(v, () => { v.action(`search:${q}`, cx); drawOnce(v, cx); return counting(v); });
        expect(run).toBe(true);
        v.setSenders([{ n: 1, re: /^Turn \d+: please check/, label: "Checker" }], [], 1, cx);
        const rnd = seeded(seed);
        for (let k = 0; k < 80; k++) {
          priced(v, () => {
            if (seed && k === 2) { landed = null; plantStop(rnd, 1000, true); }
            drawOnce(v, cx);
            seen.push({ text: fieldText(v), counting: counting(v) });
          });
          const g = gates.shift();
          if (g) { g(); for (let i = 0; i < 5; i++) await Promise.resolve(); }
          else if (!counting(v)) break;
        }
      })();
      slices = remark.mock.calls.length;
    } finally { remark.mockRestore(); cx.sleepHook = null; }
    // 5,600 turns in slices of 1,000.
    expect(slices).toBe(6);
    if (seed) expect(landed).toBe("scan");
    expect(gates.length).toBe(0);
    expect(counting(v)).toBe(false);
    expect(s.turns.filter((t) => t.agent).length).toBe(1680);
    expect(places(v)).toEqual(want(v, q));
    // While counting, neither "No matches" nor a hidden count, which is not all found yet.
    const during = seen.filter((x) => x.counting).map((x) => x.text);
    expect(during.length).toBeGreaterThan(0);
    expect(during.filter((t) => t.startsWith("No matches") || t.includes("hidden"))).toEqual([]);
  }, 120000);
}

// ---- a draw stopped inside the scan ----
// Herdr stops a draw at any point, the matches' scan included. The slice it stops is checked
// again from where the last whole slice ended, so each match is still counted once.
const tally = (v) => {
  const h = v.hitsNow();
  const keys = [];
  for (let p = h.top - 1; p >= h.bot; p--) keys.push(h.by.get(p));
  return { n: h.top - h.bot, distinct: new Set(keys).size, at: h.at.size, done: h.done };
};

test("a draw stopped inside the matches' scan counts each match once", async () => {
  const { v, cx, s } = await longPane(2000);
  const rnd = seeded(123);
  const runs = [];
  for (const q of ["rename", "ar"]) {
    // The 300th check of the scan in draws (as the review's run), then three at random among
    // the scan's checks in draws (about 500 of them, measured: the command checks the first
    // 1,280 turns) and three at random among all of the draws' checks.
    for (const at of [300, "scan", "scan", "scan", "any", "any", "any"]) {
      v.sel = `0:${s.turns.length}`;
      v.setQuery("", cx);
      settleRows(v, cx);
      // Each run its own set of matches, as a search typed first.
      v.hits = null;
      landed = null;
      const r = priced(v, () => {
        v.action(`search:${q}`, cx);
        if (typeof at === "number") plant = { scan: at };
        else plantStop(rnd, at === "scan" ? 480 : 2500, at === "scan");
        return drive(v, cx, 200, counted);
      });
      const w = want(v, q);
      runs.push({ q, landed, stops: r.stops, counted: r.counted, tally: tally(v), places: places(v).keys.join(",") === w.keys.join(","), text: fieldText(v) });
    }
  }
  const n = { rename: direct(v, "rename").length, ar: direct(v, "ar").length };
  expect(n).toEqual({ rename: 200, ar: 600 });
  // Each query's stops land in the scan in at least four runs.
  for (const q of ["rename", "ar"]) expect([q, runs.filter((r) => r.q === q && r.landed === "scan").length >= 4]).toEqual([q, true]);
  expect(runs).toEqual(runs.map((r) => ({ q: r.q, landed: r.landed, stops: 1, counted: true, tally: { n: n[r.q], distinct: n[r.q], at: n[r.q], done: true }, places: true, text: `1 of ${n[r.q]} · newest first` })));
}, 300000);

// A stop can also land between the writes of one place: its key in by, its place in at, and
// the edge (bot or top) moved. The place's key is written first and the edge moved last, so a
// stop leaves no empty place inside the set for a step to land on, and the next slice's cut
// drops a place left half made just outside it.
// A stop planted at a write of the set's places, inside the scan in a draw: at the k-th call
// of set() on its by or at map from now on, before the write or after it.
function plantWrite(h, which, k, after) {
  const m = h[which];
  const real = m.set;
  let n = 0;
  m.set = function (key, val) {
    const hit = Boolean(stopV?.renderOpen && stopV.scanning) && ++n === k;
    if (hit && !after) { delete m.set; landed = `${which} before`; throw new Error("interrupted"); }
    const r = real.call(this, key, val);
    if (hit) { delete m.set; landed = `${which} after`; throw new Error("interrupted"); }
    return r;
  };
}
// Each place with a key in the set's two arrays (Places): [place, key].
const written = (by) => [...by.up.map((k, i) => [i, k]), ...by.dn.map((k, i) => [-1 - i, k])].filter(([, k]) => k !== undefined);
// The set's places agree: every place from bot up to top - 1 has its key, at gives each key
// its place back, and with whole, nothing is written outside the set and neither array has a
// hole (an index under its length with no slot).
function unsound(h, whole) {
  const bad = [];
  for (let p = h.bot; p < h.top; p++) if (h.by.get(p) === undefined || h.at.get(h.by.get(p)) !== p) bad.push(["place", p]);
  if (whole) {
    for (const [side, a] of [["up", h.by.up], ["dn", h.by.dn]]) for (let i = 0; i < a.length; i++) if (!(i in a)) bad.push(["hole", side, i]);
    for (const [p, k] of written(h.by)) if (p < h.bot || p >= h.top) bad.push(["by", p, k]);
    for (const [k, p] of h.at) if (p < h.bot || p >= h.top || h.by.get(p) !== k) bad.push(["at", k, p]);
  }
  return bad;
}

test("a stop between the writes of one place leaves no empty place to step onto, and the cut leaves nothing outside the set", async () => {
  const runs = [];
  // An older place, found by the scan: "ar" at 2,000 turns, the stop in the first draw.
  for (const which of ["by", "at"]) for (const after of [false, true]) {
    const { v, cx, s } = await longPane(2000);
    v.sel = `0:${s.turns.length}`;
    const r = { side: "older", which, after };
    priced(v, () => {
      v.action("search:ar", cx);
      landed = null;
      plantWrite(v.hits, which, 3, after);
      r.stopped = drawOnce(v, cx).stopped;
      r.landed = landed;
      const h = v.hits;
      r.inside = unsound(h, false);
      // n from the oldest place but one: onto the oldest place.
      v.sel = h.by.get(h.bot + 1);
      v.action("olderMatch", cx);
      r.sel = typeof v.sel === "string" && v.selMatches();
      v.hitsCut(h);
      r.cut = unsound(h, true);
      for (let k = 0; k < 60 && counting(v); k++) drawOnce(v, cx);
    });
    r.right = JSON.stringify(places(v)) === JSON.stringify(want(v, "ar"));
    runs.push(r);
  }
  // A newer place, from a tail checked again: 40 turns with "look again" and no reply after
  // the last with one, a turn coming in, the stop in that draw.
  for (const which of ["by", "at"]) for (const after of [false, true]) {
    const { v, cx, s } = await longPane(600);
    tailMore(s, 40);
    settleRows(v, cx);
    v.sel = `0:${s.turns.length}`;
    v.action("search:look again", cx);
    settleRows(v, cx);
    const r = { side: "newer", which, after };
    priced(v, () => {
      tailMore(s, 1);
      landed = null;
      plantWrite(v.hits, which, 3, after);
      // The set as it is: the change is seen in the draw, not here.
      r.stopped = drawOnce(v, cx).stopped;
      r.landed = landed;
      const h = v.hits;
      r.inside = unsound(h, false);
      r.sel = true;
      v.hitsCut(h);
      r.cut = unsound(h, true);
      for (let k = 0; k < 60 && counting(v); k++) drawOnce(v, cx);
    });
    r.right = JSON.stringify(places(v)) === JSON.stringify(want(v, "look again"));
    runs.push(r);
  }
  expect(runs).toEqual(runs.map((r) => ({ side: r.side, which: r.which, after: r.after, stopped: true, landed: `${r.which} ${r.after ? "after" : "before"}`, inside: [], sel: true, cut: [], right: true })));
}, 300000);

// A stop planted in the cut (hitsCut), at the first of the two deletes of one place (its key
// by place, or its place by key), after that delete is done. The cut is then done again from
// the start, as the next slice does it.
function plantDrop(h) {
  const maps = [["by", h.by], ["at", h.at]];
  for (const [name, m] of maps) {
    const real = m.delete;
    m.delete = function (key) {
      real.call(this, key);
      for (const [, x] of maps) delete x.delete;
      landed = `${name} first`;
      throw new Error("interrupted");
    };
  }
}
// A place left half made by a stopped slice is dropped by the next cut, its place by key
// first and then its key by place: a stop between the two leaves the key by place, which the
// cut done again finds and drops. The other way round, the key by place was gone, so the cut
// done again could not find the place by key, which stayed outside the set.
test("a stop between the two deletes of a half-made place in the cut leaves nothing outside the set once the cut is done again", async () => {
  const { v, cx, s } = await longPane(2000);
  v.sel = `0:${s.turns.length}`;
  const r = {};
  priced(v, () => {
    v.action("search:ar", cx);
    landed = null;
    plantWrite(v.hits, "at", 3, true);
    r.stopped = drawOnce(v, cx).stopped;
    r.half = landed;
    const h = v.hits;
    r.halfMade = h.by.get(h.bot - 1) !== undefined && h.at.get(h.by.get(h.bot - 1)) === h.bot - 1;
    landed = null;
    plantDrop(h);
    try { v.hitsCut(h); r.cutStopped = null; } catch (e) { r.cutStopped = e.message; }
    r.first = landed;
    v.hitsCut(h);
    r.cut = unsound(h, true);
    for (let k = 0; k < 60 && counting(v); k++) drawOnce(v, cx);
  });
  expect(r).toEqual({ stopped: true, half: "at after", halfMade: true, cutStopped: "interrupted", first: "at first", cut: [] });
  expect(places(v)).toEqual(want(v, "ar"));
}, 120000);

// Hidden matches (agent messages with no reply) are counted apart from the places: hidOld for
// the older sessions, and hidL, the newest session's turn indexes. A stop in a slice that has
// counted some is cut back to the slice's start, so each is counted once.
const CHECKER = [{ n: 1, re: /^Turn \d+: please check/, label: "Checker" }];
test("hidden matches in an older session and in the newest, with a stop planted in the scan of each, are each counted once", async () => {
  const { v, cx, s } = await longPane(3000, { bare: true });
  const o = T.newSession("00000000-0000-4000-8000-00000000000b", s.file);
  for (const e of events(3000, { bare: true })) T.apply(o, e);
  o.loaded = true;
  v.sessions = [o, s];
  v.setSenders(CHECKER, [], 1);
  settleRows(v, cx);
  const runs = [];
  // The command checks the newest 1,280 turns; the stop lands in the newest session's next
  // slice, or once the scan is in the older session.
  for (const [at, want] of [[300, "newest"], [2400, "older"]]) {
    v.setQuery("", cx);
    settleRows(v, cx);
    v.hits = null;
    v.sel = `1:${s.turns.length}`;
    landed = null;
    landedIn = null;
    priced(v, () => {
      v.action("search:cart", cx);
      plant = { scan: at };
      for (let k = 0; k < 60 && (counting(v) || plant); k++) drawOnce(v, cx);
    });
    runs.push({ want, landed, landedIn: landedIn === o.turns ? "older" : landedIn === s.turns ? "newest" : null, counted: !counting(v), hidden: v.hits.hidden, places: JSON.stringify(places(v)) === JSON.stringify(wantOf(v, "cart")) });
  }
  const n = hiddenDirect(v, "cart");
  // 900 cart turns in each session.
  expect(n).toBe(1800);
  expect(runs).toEqual(runs.map((r) => ({ want: r.want, landed: "scan", landedIn: r.want, counted: true, hidden: n, places: true })));
  expect(fieldText(v)).toBe(`No matches · ${n} hidden`);
}, 120000);

// The newest turns hidden matches, checked again (hitsTail) while the scan goes on: the tail's
// count is kept in the slice's end mark, so the next slice's cut keeps it.
for (const seed of PLANTED) test(`hidden matches among the newest turns, checked again while the scan goes on, are each counted once${plantName(seed)}`, async () => {
  const { v, cx, s } = await longPane(5600, { bare: true });
  v.setSenders(CHECKER, [], 1);
  settleRows(v, cx);
  v.sel = `0:${s.turns.length}`;
  const ts = new Date(Date.UTC(2026, 10, 4, 9, 0)).toISOString();
  const seen = [];
  landed = null;
  priced(v, () => {
    v.action("search:cart", cx);
    if (seed) plantStop(seeded(seed), 1000, true);
    for (let k = 0; k < 20; k++) {
      T.apply(s, { k: "p", o: "human", t: `Turn ${s.turns.length}: please check the cart again.`, ts });
      T.apply(s, { k: "d", ms: 1000, ts });
      drawOnce(v, cx);
      seen.push(counting(v));
    }
    for (let k = 0; k < 60 && counting(v); k++) drawOnce(v, cx);
  });
  // The scan was still going while the turns came in.
  expect(seen.slice(0, 3)).toEqual([true, true, true]);
  if (seed) expect(landed).toBe("scan");
  expect(counting(v)).toBe(false);
  expect(hiddenDirect(v, "cart")).toBe(1700);
  expect(places(v)).toEqual(want(v, "cart"));
}, 120000);

// ---- a long tail with no reply, still changing ----
// More than HITS_TAIL turns after the newest session's last finished turn with a reply (turns
// interrupted, queued, or with no reply), and the session changing before every draw, as a
// running agent's does: the count still ends, within the draws a search with no tail takes,
// and from then on each change is counted again within its own draw.
// Each tail test with a query that matches nowhere, and one that matches every turn of the
// tail ("look again"), whose places are dropped and found again while it is checked again.
const TAIL_QUERIES = ["zqxjvk", "look again"];
const tailName = (q) => (q === "zqxjvk" ? "" : `, "${q}" matching the tail`);
// The field's words while counting: none found yet, or a count with a "+".
const countingWords = (t) => t === "Counting…" || /^[\d,]+\+ matches$|^\d+ of [\d,]+\+/.test(t);
// The field's words once counted, for the selection where it is.
const finalWords = (v, q) => {
  const w = wantOf(v, q).keys;
  const i = w.indexOf(v.sel);
  if (!w.length) return "No matches";
  if (i < 0) return `${w.length} ${w.length === 1 ? "match" : "matches"}`;
  return `${i + 1} of ${w.length} · ${w.length === 1 ? "only mention" : i === w.length - 1 ? "first mention" : "newest first"}`;
};
const tailMore = (s, n) => {
  const ts = new Date(Date.UTC(2026, 10, 4, 9, 0)).toISOString();
  for (let i = 0; i < n; i++) { T.apply(s, { k: "p", o: "human", t: `Turn ${s.turns.length}: please look again.`, ts }); T.apply(s, { k: "d", ms: 1000, ts }); }
};
for (const q of TAIL_QUERIES) for (const x of [1, 2]) test(`with 100 turns after the last one with a reply and a turn coming in before every draw, the count ends in each draw${x === 1 ? "" : `, at ${x}x the prices`}${tailName(q)}`, async () => {
  const { v, cx, s } = await longPane(5600);
  tailMore(s, 100);
  settleRows(v, cx);
  v.sel = `0:${s.turns.length}`;
  const seen = [];
  X = x;
  try {
    priced(v, () => {
      v.action(`search:${q}`, cx);
      for (let k = 0; k < 150; k++) {
        tailMore(s, 1);
        const d = drawOnce(v, cx);
        seen.push({ k, stopped: d.stopped, ms: d.ms <= LIMIT, counting: counting(v), text: fieldText(v) });
      }
      // A turn read in between draws: the count read before the next draw has the tail
      // checked again already (its slice in hitsNow).
      tailMore(s, 1);
      seen.push({ k: 150, stopped: false, ms: true, counting: counting(v), text: fieldText(v) });
    });
  } finally { X = 1; }
  const first = seen.findIndex((d) => !d.counting);
  if (process.env.THREADS_SEARCH_FIGURES) console.log(JSON.stringify({ tail: 100, x, q, countedAt: first + 1 }));
  // Counted within the 40 draws a search is held to, then in every draw after.
  expect(first >= 0 && first < 40).toBe(true);
  expect(seen.filter((d) => d.stopped || !d.ms || (d.k >= first && d.counting))).toEqual([]);
  // "No matches" and a final count only once counted.
  expect(seen.filter((d) => d.counting && !countingWords(d.text))).toEqual([]);
  expect(places(v)).toEqual(want(v, q));
  expect(fieldText(v)).toBe(finalWords(v, q));
}, 120000);

// The limit: a tail too long for the scan's share of a draw, changing before every draw, is
// checked again from its start at each change and leaves the turns before it little or no
// time, so the count is not done while it changes. On this harness, 5,600 turns and a turn
// every draw: a tail of 1,100 turns is counted at draw 34 and one of 1,200 not at all; at 2x
// the prices, 450 at draw 30 and 550 not at all. The field says it is counting meanwhile, and
// the count ends within a few draws of the last change.
for (const q of TAIL_QUERIES) for (const x of [1, 2]) test(`with 2,000 turns after the last one with a reply and a turn coming in before every draw, the field says it is counting, and the count ends within 20 draws of the last${x === 1 ? "" : `, at ${x}x the prices`}${tailName(q)}`, async () => {
  const { v, cx, s } = await longPane(5600);
  tailMore(s, 2000);
  settleRows(v, cx);
  v.sel = `0:${s.turns.length}`;
  const seen = [];
  let after = null;
  X = x;
  try {
    priced(v, () => {
      v.action(`search:${q}`, cx);
      for (let k = 0; k < 60; k++) {
        tailMore(s, 1);
        const d = drawOnce(v, cx);
        seen.push({ k, stopped: d.stopped, ms: d.ms <= LIMIT, counting: counting(v), text: fieldText(v) });
      }
      for (let k = 0; k < 40; k++) {
        const d = drawOnce(v, cx);
        seen.push({ k: 60 + k, stopped: d.stopped, ms: d.ms <= LIMIT, counting: counting(v), text: fieldText(v) });
        if (!counting(v)) { after = k + 1; break; }
      }
    });
  } finally { X = 1; }
  if (process.env.THREADS_SEARCH_FIGURES) console.log(JSON.stringify({ tail: 2000, x, q, countingWhileChanging: seen.slice(0, 60).filter((d) => d.counting).length, drawsAfterLast: after }));
  expect(seen.filter((d) => d.stopped || !d.ms)).toEqual([]);
  // The limit itself: counting in every draw while a turn comes in before each.
  expect(seen.slice(0, 60).filter((d) => !d.counting)).toEqual([]);
  expect(seen.filter((d) => d.counting && !countingWords(d.text))).toEqual([]);
  expect(after != null && after <= 20).toBe(true);
  expect(places(v)).toEqual(want(v, q));
  expect(fieldText(v)).toBe(finalWords(v, q));
}, 120000);

// A reply comes in while a tail longer than a slice is checked again, and then two turns after
// it: once the reply's turn is before the newest, the turns before it are settled, and the
// tail's turns not checked yet are still checked.
test("a reply coming in while a 2,000-turn tail is checked again, then a turn after it, leaves the count and every place right", async () => {
  const { v, cx, s } = await longPane(5600);
  tailMore(s, 2000);
  settleRows(v, cx);
  v.sel = `0:${s.turns.length}`;
  const ts = new Date(Date.UTC(2026, 10, 4, 10, 0)).toISOString();
  let tail = null;
  priced(v, () => {
    v.action("search:look again", cx);
    for (let k = 0; k < 3; k++) { tailMore(s, 1); drawOnce(v, cx); }
    T.apply(s, { k: "p", o: "human", t: `Turn ${s.turns.length}: please look again, with a reply.`, ts });
    T.apply(s, { k: "t", t: "Looked." });
    T.apply(s, { k: "d", ms: 1000, ts });
    const reply = s.turns.length - 1;
    drawOnce(v, cx);
    tailMore(s, 1);
    drawOnce(v, cx);
    tail = { ...v.hitsNow().cur.tail, reply };
    tailMore(s, 1);
    for (let k = 0; k < 40 && counting(v); k++) drawOnce(v, cx);
  });
  // The tail was part checked, short of the reply's turn, when the turn after it came in.
  expect(tail.next != null && tail.next < tail.reply).toBe(true);
  expect(counting(v)).toBe(false);
  // 2,000 + 3 + the reply's turn + 2.
  expect(want(v, "look again").keys.length).toBe(2006);
  expect(places(v)).toEqual(want(v, "look again"));
}, 120000);

// A step from a selected match in a tail being checked again: the match has no place until its
// turn is checked again, and n or Shift n from it goes by turn order to the nearest match older
// or newer than it, not to the newest found. An older step checks the tail's next slice first,
// so it does not skip the tail's matches not yet checked again. The count keeps its "+"
// meanwhile, and the place comes back once the tail is checked.
test("a step from a match in a long tail being checked again goes the way it is asked, and its place comes back once the tail is checked", async () => {
  const { v, cx, s } = await longPane(5600);
  tailMore(s, 2000);
  settleRows(v, cx);
  v.sel = `0:${s.turns.length}`;
  const n = (k) => Number(k.split(":")[1]);
  const r = {};
  priced(v, () => {
    v.action("search:please look", cx);
    for (let k = 0; k < 80 && counting(v); k++) drawOnce(v, cx);
    // Two steps older: a turn near the end of the tail.
    v.action("olderMatch", cx);
    v.action("olderMatch", cx);
    const from = v.sel;
    r.from = n(from) > s.turns.length - 10;
    r.settled = fieldText(v);
    const texts = [];
    for (let k = 0; k < 5; k++) { tailMore(s, 1); drawOnce(v, cx); texts.push(fieldText(v)); }
    r.texts = texts.filter((t) => !countingWords(t));
    // A turn comes in; Shift n, then n, from the selected turn, before the next draw.
    tailMore(s, 1);
    const h = v.hitsNow();
    r.placed = h.at.has(from);
    // Newer: no place newer than it yet (the tail is checked again oldest first), so Shift n
    // waits for the tail check to place it (a slice in the press, then the draws), and lands
    // on the nearest newer match by turn order. Older: the nearest match before it by turn
    // order, among all the matches, though the newest place before it is further back (the
    // tail's matches not checked again).
    const found = [];
    for (let p = h.bot; p < h.top; p++) found.push(h.by.get(p));
    const all = direct(v, "please look");
    const newer = all.findLast((k) => n(k) > n(from));
    const older = all.find((k) => n(k) < n(from));
    r.gap = n(older) > n(found.findLast((k) => n(k) < n(from)));
    r.noNewerPlace = !found.some((k) => n(k) > n(from));
    v.action("newerMatch", cx);
    for (let k = 0; k < 80 && v.sel === from; k++) drawOnce(v, cx);
    r.newer = v.sel === newer;
    v.sel = from;
    v.action("olderMatch", cx);
    r.older = v.sel === older && v.selMatches();
    v.sel = from;
    for (let k = 0; k < 80 && counting(v); k++) drawOnce(v, cx);
    r.back = v.matchPlace().at > 0;
  });
  expect(r).toEqual({ from: true, settled: "3 of 5360 · newest first", texts: [], placed: false, gap: true, noNewerPlace: true, newer: true, older: true, back: true });
  expect(fieldText(v)).toBe(finalWords(v, "please look"));
  expect(places(v)).toEqual(want(v, "please look"));
}, 120000);

// An older step from a match near the end of a 4,000-turn tail, a turn coming in just
// before: no match is passed over. The tail is longer than HITS_TAIL_MAX, so the set is found
// again from the newest turn down, and the step goes from the selection's new place.
test("an older step from a match near the end of a 4,000-turn tail, a turn coming in just before, lands on the nearest older match, with none passed over", async () => {
  const { v, cx, s } = await longPane(5600);
  tailMore(s, 4000);
  settleRows(v, cx);
  v.sel = `0:${s.turns.length}`;
  const n = (k) => Number(k.split(":")[1]);
  const r = {};
  priced(v, () => {
    v.action("search:please look", cx);
    for (let k = 0; k < 200 && counting(v); k++) drawOnce(v, cx);
    v.action("olderMatch", cx);
    v.action("olderMatch", cx);
    const from = v.sel;
    tailMore(s, 1);
    v.hitsNow();
    v.action("olderMatch", cx);
    const nearest = direct(v, "please look").find((k) => n(k) < n(from));
    r.from = n(from);
    r.passedOver = n(nearest) - n(v.sel);
  });
  expect(r).toEqual({ from: 9598, passedOver: 0 });
}, 300000);

// An older step from a match in a tail being checked again, with the turns back from it to
// the nearest older match not checked again yet and more than one slice can check (a 2,400
// -turn tail, under HITS_TAIL_MAX, at twice the prices): the step stays where it is, the next
// press goes on from where the last one stopped, and one lands on that match. No press lands
// past it.
test("an older step whose slice ends before it reaches a match stays, and the next press goes on from there to the nearest older match", async () => {
  const { v, cx, s } = await longPane(5600);
  const ts = new Date(Date.UTC(2026, 10, 4, 9, 0)).toISOString();
  const base = s.turns.length;
  // 2,400 turns with no reply: "zebra" in the 800th and the last, nowhere between.
  for (let i = 0; i < 2400; i++) {
    T.apply(s, { k: "p", o: "human", t: i === 800 || i === 2399 ? `Tail ${i}: the zebra list.` : `Tail ${i}: nothing here.`, ts });
    T.apply(s, { k: "d", ms: 1000, ts });
  }
  settleRows(v, cx);
  const last = `0:${base + 2400}`;
  const nearest = `0:${base + 801}`;
  v.sel = last;
  const r = { moves: [] };
  X = 2;
  try { priced(v, () => {
    v.action("search:zebra", cx);
    for (let k = 0; k < 200 && counting(v); k++) drawOnce(v, cx);
    v.sel = last;
    // A turn comes in: the tail is checked again from its start, a slice at a time.
    T.apply(s, { k: "p", o: "human", t: "One more: nothing here.", ts });
    T.apply(s, { k: "d", ms: 1000, ts });
    v.hitsNow();
    r.checking = v.hitsNow().cur.tail != null && v.hitsNow().cur.tail.next < base + 800;
    for (let k = 0; k < 20 && v.sel === last; k++) { v.action("olderMatch", cx); r.moves.push(v.sel); }
  }); } finally { X = 1; }
  r.presses = r.moves.length;
  r.stays = r.moves.slice(0, -1).every((k) => k === last);
  r.landed = r.moves.at(-1);
  expect(r.checking).toBe(true);
  expect({ more: r.presses > 1, stays: r.stays, landed: r.landed }).toEqual({ more: true, stays: true, landed: nearest });
}, 300000);

// The 2,400-turn tail above, with "zebra" in its 800th turn and its last, the last selected and
// a turn come in, so the tail is checked again from its start: the pane, the keys, and the
// last match's and the nearest older match's keys.
// With also, "zebra" in those tail turns too; with queuedFrom, the tail's turns from that one on
// are prompts left queued, with no reply and no end (open).
async function zebraTail({ also = [], queuedFrom = Infinity } = {}) {
  const { v, cx, s } = await longPane(5600);
  const ts = new Date(Date.UTC(2026, 10, 4, 9, 0)).toISOString();
  const base = s.turns.length;
  for (let i = 0; i < 2400; i++) {
    T.apply(s, { k: "p", o: "human", t: i === 800 || i === 2399 || also.includes(i) ? `Tail ${i}: the zebra list.` : `Tail ${i}: nothing here.`, ts });
    if (i < queuedFrom) T.apply(s, { k: "d", ms: 1000, ts });
  }
  settleRows(v, cx);
  const last = `0:${base + 2400}`;
  return { v, cx, s, ts, base, last, nearest: `0:${base + 801}` };
}
function zebraSearch({ v, cx, s, ts, last }) {
  v.action("search:zebra", cx);
  for (let k = 0; k < 200 && counting(v); k++) drawOnce(v, cx);
  v.sel = last;
  T.apply(s, { k: "p", o: "human", t: "One more: nothing here.", ts });
  T.apply(s, { k: "d", ms: 1000, ts });
  v.hitsNow();
}

// The same step, pressed once: its slice ends before it reaches the match, and the draws after
// it go on with it, each in Herdr's time, until it lands on the nearest older match. A person
// presses n once.
test("an older step whose slice ends before it reaches a match goes on by itself in the next draws and lands on the nearest older match", async () => {
  const z = await zebraTail();
  const { v, cx, last } = z;
  const r = { draws: 0, stops: 0, inTime: true };
  X = 2;
  try { priced(v, () => {
    zebraSearch(z);
    v.action("olderMatch", cx);
    r.stayed = v.sel === last;
    // While the step is kept, a draw goes on with it in place of the scan's slice: the scan's
    // place (cur, and the tail's next turn) is where it was.
    r.scanStill = true;
    for (let k = 0; k < 40 && v.sel === last; k++) {
      const h = v.hitsNow();
      const at = JSON.stringify([h.cur.si, h.cur.ti, h.cur.tail?.next ?? null]);
      const d = drawOnce(v, cx);
      if (v.sel === last && JSON.stringify([h.cur.si, h.cur.ti, h.cur.tail?.next ?? null]) !== at) r.scanStill = false;
      r.draws++;
      if (d.stopped) r.stops++;
      if (d.ms > LIMIT) r.inTime = false;
    }
  }); } finally { X = 1; }
  expect({ stayed: r.stayed, landed: v.sel, stops: r.stops, inTime: r.inTime, scanStill: r.scanStill }).toEqual({ stayed: true, landed: z.nearest, stops: 0, inTime: true, scanStill: true });
  expect(r.draws).toBeGreaterThan(0);
}, 300000);

// Herdr stops a draw going on with the step, inside the step's own check back (tailBack), not
// in the rows' build the new turn left for that draw. The step is kept, and a later draw lands
// it.
test("a draw going on with an older step, stopped inside the step's slice, leaves the step to a later draw, which lands it", async () => {
  const z = await zebraTail();
  const { v, cx, last } = z;
  const r = { stops: 0 };
  X = 2;
  try { priced(v, () => {
    zebraSearch(z);
    v.action("olderMatch", cx);
    r.stayed = v.sel === last;
    landed = null;
    plant = { back: 40 };
    for (let k = 0; k < 40 && v.sel === last; k++) if (drawOnce(v, cx).stopped) r.stops++;
    r.planted = plant === null;
    r.where = landed;
  }); } finally { X = 1; }
  expect({ stayed: r.stayed, planted: r.planted, where: r.where, stops: r.stops, landed: v.sel }).toEqual({ stayed: true, planted: true, where: "back", stops: 1, landed: z.nearest });
}, 300000);

// A step going on by itself is called off by a key, here p (the selected turn pinned, the
// selection left where it is), or by a new selection (a click on a turn): the draws after it
// leave the selection where that put it. The pin is taken off pins.json after, so no later
// test opens with it: once the pane's save chain has written it (pinChain, promises only, no
// clock), with no later save waiting (pinDueAt).
// The new selection is another match, the one the step was going to, with an older match
// below it (tail turn 400): a step that went on from it would move on to that one.
for (const how of ["a key", "a new selection"]) test(`an older step going on by itself is called off by ${how}, and the draws after it leave the selection there`, async () => {
  const z = await zebraTail({ also: [400] });
  const { v, cx, base, last } = z;
  const r = {};
  X = 2;
  try { priced(v, () => {
    zebraSearch(z);
    v.action("olderMatch", cx);
    r.stayed = v.sel === last;
    if (how === "a key") v.action("pin", cx);
    else v.sel = z.nearest;
    r.sel = v.sel;
    for (let k = 0; k < 40; k++) drawOnce(v, cx);
  }); } finally { X = 1; }
  await v.pinChain;
  expect({ written: (recordFiles[PINS] ?? "").includes("the zebra list"), later: v.pinDueAt ?? null }).toEqual({ written: how === "a key", later: null });
  delete recordFiles[PINS];
  expect({ stayed: r.stayed, sel: v.sel }).toEqual({ stayed: true, sel: r.sel });
  expect(r.sel).toBe(how === "a key" ? last : `0:${base + 801}`);
  expect(direct(v, "zebra")).toContain(`0:${base + 401}`);
}, 300000);

// A step going on by itself is called off by anything the reader does to move the list or
// leave the view, with the selection left where it is: the wheel over the list, a scroll the
// list reports with no wheel (its scroll bar), the rail's wheel, a press on a rail end's dot
// and the pin button on a rail card. Each route as its handler runs it: the card's pin button
// is the handler the draw before the step made. The wheel and the bar move only a list that
// can scroll, so for those two the tail's first 60 turns match too (the matches the search
// shows run past the pane), and the bar's scroll comes once the pane's own scroll is done (no
// scroll asked for or settling). The pane hidden is not here: it has no event, and a long gap
// between draws is not shown to mean it (a rig row).
const MANY = Array.from({ length: 60 }, (_, i) => i);
const LEAVES = {
  "the wheel": { also: MANY, go: (v) => v.listWheel({ delta: { y: 3000 } }) },
  "a scroll the list reports": {
    also: MANY,
    go: (v) => {
      v.scrollTo = null;
      v.scrollBusyUntil = 0;
      const rows = v.rows();
      const at = v.stickStart ?? 40;
      v.stickCheck(rows, v.bottomShown, at);
      v.stickCheck(rows, v.bottomShown, at - 20);
    },
  },
  "the rail's wheel": { go: (v, cx) => { v.railCut = true; v.railWheel({ delta_lines: { y: 3 } }, cx); } },
  "a rail end's dot": { go: (v, cx) => v.railReveal(0, cx) },
  "a rail card's pin button": {
    // The last turn's rail card open, as a hover opens it; the draw records its handlers.
    before: (v, cx, last) => { v.debug = true; v.action(`debugRailCard:${last.split(":")[1]}`, cx); v.debug = false; H.rec = []; },
    go: (_v, cx, pin) => pin(null, cx),
  },
};
// The handler the recorded draw gave the element with this id.
function recorded(id, method) {
  let at = null;
  let fn = null;
  for (const c of H.rec ?? []) {
    if (c[0] === "id") at = String(c[1]);
    else if (c[0] === method && at === id) fn = c.at(-1);
  }
  return fn;
}
for (const [how, { also = [], before, go }] of Object.entries(LEAVES)) test(`an older step going on by itself is called off by ${how}, with no words and the selection left where it is`, async () => {
  const z = await zebraTail({ also });
  const { v, cx, last } = z;
  const r = {};
  X = 2;
  try { priced(v, () => {
    zebraSearch(z);
    before?.(v, cx, last);
    drawOnce(v, cx);
    r.pin = before ? recorded("th-rail-card-pin", "on_click") : null;
    H.rec = null;
    v.action("olderMatch", cx);
    r.kept = v.sel === last && Boolean(v.hitsNow().step);
    r.moves = v.readerMoves ?? 0;
    go(v, cx, r.pin);
    r.moved = (v.readerMoves ?? 0) > r.moves;
    for (let k = 0; k < 40; k++) drawOnce(v, cx);
    r.step = v.hitsNow().step ?? null;
    r.field = fieldText(v);
  }); } finally { X = 1; H.rec = null; }
  await v.pinChain;
  delete recordFiles[PINS];
  expect({ found: !before || Boolean(r.pin), kept: r.kept, moved: r.moved, sel: v.sel, step: r.step }).toEqual({ found: true, kept: true, moved: true, sel: last, step: null });
  expect(r.field).not.toMatch(/No (older|newer) match/);
}, 300000);

// An older step going on by itself while the newest session changes before every draw, each
// time by a turn done with no reply: every turn the step's check back passed was closed, so
// that check goes on from where it got to, and the step lands.
test("an older step going on by itself lands on the nearest older match while a turn comes in before every draw", async () => {
  const z = await zebraTail();
  const { v, cx, s, ts, last } = z;
  const r = { draws: 0 };
  X = 2;
  try { priced(v, () => {
    zebraSearch(z);
    v.action("olderMatch", cx);
    r.stayed = v.sel === last;
    for (let k = 0; k < 40 && v.sel === last; k++) {
      T.apply(s, { k: "p", o: "human", t: `More ${k}: nothing here.`, ts });
      T.apply(s, { k: "d", ms: 1000, ts });
      drawOnce(v, cx);
      r.draws++;
    }
  }); } finally { X = 1; }
  expect({ stayed: r.stayed, landed: v.sel }).toEqual({ stayed: true, landed: z.nearest });
  expect(r.draws).toBeLessThan(10);
}, 300000);

// An older step going on by itself back through queued turns (open, with no reply), then a
// reply that ends them all with a match: each of them matches now, so the step's check back
// starts again from the selection and lands on the newest of them, not on one past where it
// had got to.
test("an older step going on by itself back through queued turns lands on the newest of them once a reply answers them with a match", async () => {
  const z = await zebraTail({ queuedFrom: 1000 });
  const { v, cx, s, ts, base, last } = z;
  const r = {};
  X = 2;
  try { priced(v, () => {
    v.action("search:zebra", cx);
    for (let k = 0; k < 200 && counting(v); k++) drawOnce(v, cx);
    v.sel = last;
    T.apply(s, { k: "p", o: "human", t: "One more: nothing here.", ts });
    v.hitsNow();
    v.action("olderMatch", cx);
    r.stayed = v.sel === last;
    drawOnce(v, cx);
    const h = v.hitsNow();
    r.passed = h.back?.key === last && h.back.ti < base + 2398;
    r.kept = v.sel === last;
    T.apply(s, { k: "t", t: "The zebra list is in every one of them." });
    T.apply(s, { k: "d", ms: 1000, ts });
    // The tail checked again: the turns the check back passed were open, so where it got to
    // is cleared, and it starts again from the selection.
    r.cleared = v.hitsNow().back == null;
    for (let k = 0; k < 40 && v.sel === last; k++) drawOnce(v, cx);
  }); } finally { X = 1; }
  expect({ stayed: r.stayed, passed: r.passed, kept: r.kept, cleared: r.cleared, landed: v.sel }).toEqual({ stayed: true, passed: true, kept: true, cleared: true, landed: `0:${base + 2399}` });
  expect(direct(v, "zebra")).toContain(`0:${base + 2399}`);
}, 300000);

// A step that cannot land while the session keeps changing: queued turns back from the
// selection, and one more queued before every draw, so the step's check back starts again from
// the selection each time and never gets far enough. An older match is there all the while
// (tail turn 800). After STEP_DRAWS (100) draws going on with it, the step is dropped with no
// words: the selection stays where it is, and the field does not say there is no older match,
// since the step gave up and did not reach the end. The older button is still there, and a
// press, once the turns stop coming, starts a new step, which lands on that match (at once,
// or kept and landed by the draws after it).
test("a step going on by itself that has not landed within 100 draws is dropped with no words, the selection left where it is, and the older button starts a new one", async () => {
  const z = await zebraTail({ queuedFrom: 1000 });
  const { v, cx, s, ts, last } = z;
  const r = { draws: 0 };
  X = 2;
  try { priced(v, () => {
    v.action("search:zebra", cx);
    for (let k = 0; k < 200 && counting(v); k++) drawOnce(v, cx);
    v.sel = last;
    T.apply(s, { k: "p", o: "human", t: "One more: nothing here.", ts });
    v.hitsNow();
    v.action("olderMatch", cx);
    r.stayed = v.sel === last;
    for (let k = 0; k < 140 && v.hitsNow().step; k++) {
      T.apply(s, { k: "p", o: "human", t: `Queued ${k}: nothing here.`, ts });
      drawOnce(v, cx);
      r.draws++;
    }
    r.step = v.hitsNow().step ?? null;
    r.field = fieldText(v);
    const press = olderButton(v)?.find((c) => c[0] === "on_click")?.at(-1) ?? null;
    r.button = Boolean(press);
    press?.(null, cx);
    r.again = v.sel === z.nearest || (v.sel === last && Boolean(v.hitsNow().step));
    for (let k = 0; k < 40 && v.sel === last; k++) drawOnce(v, cx);
  }); } finally { X = 1; }
  expect({ stayed: r.stayed, draws: r.draws, step: r.step, button: r.button, again: r.again, landed: v.sel }).toEqual({ stayed: true, draws: 100, step: null, button: true, again: true, landed: z.nearest });
  expect(r.field).not.toMatch(/No (older|newer) match/);
}, 300000);

// A draw going on with a step that runs scan slices itself (an older step past the oldest
// match found, while the first count goes on): the draw's scan time is the outer call's, once,
// not the outer call's and its inner slice's again.
test("a draw going on with a step counts the scan's time once", async () => {
  const z = await zebraTail();
  const { v, cx, last } = z;
  const r = { seen: 0, same: true };
  X = 2;
  try { priced(v, () => {
    v.sel = last;
    v.action("search:zebra", cx);
    v.action("olderMatch", cx);
    const ss = v.scanStep;
    let outer = 0;
    v.scanStep = function (c) { if (!c) return ss.call(this, c); const t0 = performance.now(); try { return ss.call(this, c); } finally { outer = performance.now() - t0; } };
    for (let k = 0; k < 40 && v.hitsNow().step; k++) {
      outer = 0;
      drawOnce(v, cx);
      if (!outer) continue;
      r.seen++;
      if (Math.abs((v.scanSpent ?? 0) - outer) > 1e-6) r.same = false;
    }
    v.scanStep = ss;
  }); } finally { X = 1; }
  expect(r.seen).toBeGreaterThan(0);
  expect(r.same).toBe(true);
}, 300000);

// A draw going on with an older step's check back in a tail (tailBack) runs the step's slice
// in place of the scan's: no slice of the scan (scanHits) in that draw, so its time is the
// step's slice and the rest of the draw, and each such draw fits Herdr's time.
test("a draw going on with an older step's check back runs no slice of the scan beside it, and each such draw fits", async () => {
  const z = await zebraTail();
  const { v, cx, last } = z;
  const r = { stepped: 0, scans: 0, late: 0 };
  X = 2;
  try { priced(v, () => {
    zebraSearch(z);
    drawOnce(v, cx);
    v.action("olderMatch", cx);
    r.kept = v.sel === last && Boolean(v.hitsNow().step);
    const scan = v.scanHits;
    let n = 0;
    v.scanHits = function (...a) { n++; return scan.apply(this, a); };
    for (let k = 0; k < 40 && v.hitsNow().step; k++) {
      n = 0;
      const d = drawOnce(v, cx);
      r.stepped++;
      r.scans += n;
      if (d.stopped || d.ms > LIMIT) r.late++;
    }
    v.scanHits = scan;
  }); } finally { X = 1; }
  expect({ kept: r.kept, scans: r.scans, late: r.late, landed: v.sel }).toEqual({ kept: true, scans: 0, late: 0, landed: z.nearest });
  expect(r.stepped).toBeGreaterThan(0);
}, 300000);

// A new session (after a clear or a restart) is a new set: a step going on by itself in the
// old one is dropped, with no words in the field, and the selection stays where it is.
test("an older step going on by itself is dropped with no words when a new session starts", async () => {
  const z = await zebraTail();
  const { v, cx, last } = z;
  const r = {};
  X = 2;
  try { priced(v, () => {
    zebraSearch(z);
    v.action("olderMatch", cx);
    r.stayed = v.sel === last;
    const n = T.newSession("00000000-0000-4000-8000-00000000000c", v.current().file);
    T.apply(n, { k: "p", o: "human", t: "A new session: nothing here.", ts: z.ts });
    v.sessions = [...v.sessions, n];
    for (let k = 0; k < 40; k++) drawOnce(v, cx);
    r.step = v.hitsNow().step ?? null;
    r.field = fieldText(v);
  }); } finally { X = 1; }
  expect({ stayed: r.stayed, sel: v.sel, step: r.step }).toEqual({ stayed: true, sel: last, step: null });
  expect(r.field).not.toMatch(/No (older|newer) match/);
}, 300000);

// An older step going on by itself, and turns coming in that take the tail past the cap, so
// the set is found again from the newest turn down: the step goes on in the new set and lands
// on the nearest older match.
test("an older step going on by itself still lands on the nearest older match when turns come in and the set is found again past the cap", async () => {
  const z = await zebraTail();
  const { v, cx, s, ts, last } = z;
  const r = {};
  X = 2;
  try { priced(v, () => {
    zebraSearch(z);
    v.action("olderMatch", cx);
    r.stayed = v.sel === last;
    const was = v.hits;
    for (let i = 0; i < 200; i++) { T.apply(s, { k: "p", o: "human", t: "More: nothing here.", ts }); T.apply(s, { k: "d", ms: 1000, ts }); }
    v.hitsNow();
    T.apply(s, { k: "p", o: "human", t: "One more: nothing here.", ts });
    T.apply(s, { k: "d", ms: 1000, ts });
    v.hitsNow();
    r.foundAgain = v.hits !== was;
    for (let k = 0; k < 200 && v.sel === last; k++) drawOnce(v, cx);
  }); } finally { X = 1; }
  expect({ stayed: r.stayed, foundAgain: r.foundAgain, landed: v.sel }).toEqual({ stayed: true, foundAgain: true, landed: z.nearest });
}, 300000);

// An older step from the oldest match found so far, while the count goes on, with the next
// older match more than one slice back: the press checks one slice and finds none, so the
// step is kept and the draws after it go on with it until it lands there.
test("an older step past the oldest match found so far, with the next one more than a slice back, goes on by itself and lands on it", async () => {
  const z = await zebraTail();
  const { v, cx, last } = z;
  const r = {};
  X = 2;
  try { priced(v, () => {
    v.sel = last;
    v.action("search:zebra", cx);
    const h = v.hitsNow();
    r.only = h.top - h.bot === 1 && h.at.get(last) === h.bot && !h.done;
    v.action("olderMatch", cx);
    r.stayed = v.sel === last;
    for (let k = 0; k < 40 && v.sel === last; k++) drawOnce(v, cx);
  }); } finally { X = 1; }
  expect({ only: r.only, stayed: r.stayed, landed: v.sel }).toEqual({ only: true, stayed: true, landed: z.nearest });
}, 300000);

// A selected match the scan has not reached yet (picked by a key or a click before the count
// gets there): the matches next to it are not all found yet. A step from it, either way, waits
// for the scan to place it, then lands on the next match that way, passing none over.
for (const way of ["newer", "older"]) test(`${way === "older" ? "an" : "a"} ${way} step from a selected match the scan has not reached yet waits for it and lands on the next ${way} match, with none passed over`, async () => {
  const { v, cx, s } = await longPane(5600);
  v.sel = `0:${s.turns.length}`;
  const r = {};
  priced(v, () => {
    v.action("search:rename", cx);
    drawOnce(v, cx);
    const h = v.hitsNow();
    r.notReached = !h.at.has("0:101") && h.bot < h.top && Number(h.by.get(h.bot).split(":")[1]) > 111;
    v.sel = "0:101";
    v.action(way === "newer" ? "newerMatch" : "olderMatch", cx);
    r.stayed = v.sel === "0:101";
    for (let k = 0; k < 200 && v.sel === "0:101"; k++) drawOnce(v, cx);
  });
  expect({ notReached: r.notReached, stayed: r.stayed, landed: v.sel }).toEqual({ notReached: true, stayed: true, landed: way === "newer" ? "0:111" : "0:91" });
}, 120000);

// A step going on by itself, then the search cleared (its x) and the same words typed again
// before a draw: the set is kept for the same search, but the step is not. The selection stays.
test("an older step going on by itself is called off when the search is cleared, also when the same search is typed again", async () => {
  const z = await zebraTail();
  const { v, cx, last } = z;
  const r = {};
  X = 2;
  try { priced(v, () => {
    zebraSearch(z);
    v.action("olderMatch", cx);
    r.stayed = v.sel === last;
    const was = v.hits;
    v.input.set_value("");
    v.query = "";
    v.filtering = false;
    v.setQuery("zebra", cx);
    r.sameSet = v.hits === was;
    for (let k = 0; k < 40; k++) drawOnce(v, cx);
  }); } finally { X = 1; }
  expect({ stayed: r.stayed, sameSet: r.sameSet, sel: v.sel }).toEqual({ stayed: true, sameSet: true, sel: last });
}, 300000);

// Herdr can stop a draw anywhere, here just after the scan asked for its next draw (its 0 ms
// timer). A timer asked for in a stopped render may never run, so it is dropped here, and the
// scan's mark that it asked is still set. The draw after it (Herdr's 120 ms watch draws a
// stopped pane once more) asks for the scan's next draw again, so the count does not wait on
// another event. (In a search the rows' own build usually asks for draws too; this checks the
// scan's own ask.)
test("after a draw stopped once the scan asked for its next draw, the next draw asks for it again", async () => {
  const { v, cx, s } = await longPane(5600);
  v.sel = `0:${s.turns.length}`;
  const r = {};
  priced(v, () => {
    v.action("search:rename", cx);
    drawOnce(v, cx);
    // The stop: in the step right after the scan's slice, once. The stopped render's timers
    // are dropped.
    const sync = v.syncOutEditors;
    let stopped = false;
    v.syncOutEditors = function (...a) { if (!stopped) { stopped = true; throw new Error("interrupted"); } return sync.apply(this, a); };
    const n0 = cx.timers.length;
    r.stopped = false;
    try { v.render(cx); } catch (e) {
      if (String(e?.message) !== "interrupted") throw e;
      r.stopped = true;
      v.renderOpen = true;
    } finally { v.syncOutEditors = sync; }
    fold();
    r.marked = Boolean(v.scanNext);
    cx.timers.length = Math.min(cx.timers.length, n0);
    // The next draw: which timers it asks for, and whether the scan's is one of them.
    const after = cx.timer.after;
    let scanAsked = false;
    cx.timer.after = function (ms, fn) { if (ms === 0 && new Error().stack.includes("scanStep")) scanAsked = true; return after.call(this, ms, fn); };
    try { v.render(cx); } finally { cx.timer.after = after; }
    fold();
    r.counting = counting(v);
    r.scanAsked = scanAsked;
  });
  expect(r).toEqual({ stopped: true, marked: true, counting: true, scanAsked: true });
}, 120000);

// A finished session, then 4,000 turns read at once, each with a reply: the tail from the last
// turn done with a reply is the whole new read, past HITS_TAIL_MAX, so the set is found again
// from the newest turn down and the newest match is found first, not checked again oldest first.
test("4,000 turns read at once after a finished session: the set is found again from the newest turn, which finds the newest match first", async () => {
  const { v, cx, s } = await longPane(600);
  v.sel = `0:${s.turns.length}`;
  const r = {};
  priced(v, () => {
    v.action("search:rename", cx);
    for (let k = 0; k < 80 && counting(v); k++) drawOnce(v, cx);
    const was = v.hits;
    const ts = new Date(Date.UTC(2026, 10, 4, 9, 0)).toISOString();
    for (let i = 0; i < 4000; i++) {
      T.apply(s, { k: "p", o: "human", t: i === 3999 ? "Newest: rename the queue helper." : `More ${i}: nothing here.`, ts });
      T.apply(s, { k: "t", t: "Done." });
      T.apply(s, { k: "d", ms: 1000, ts });
    }
    const h = v.hitsNow();
    r.foundAgain = h !== was;
    r.newestFirst = h.at.has(`0:${s.turns.length}`);
    for (let k = 0; k < 80 && counting(v); k++) drawOnce(v, cx);
  });
  expect(r).toEqual({ foundAgain: true, newestFirst: true });
  expect(places(v)).toEqual(want(v, "rename"));
}, 120000);

// A tail longer than the cap (HITS_TAIL_MAX turns) is not dropped place by place in one call:
// the set is found again from the start, in slices. Just under the cap the tail is checked
// again; just over it the set is new. Either way the draws keep inside Herdr's time, the
// matches are the same, and the selected match stays selected.
for (const [side, more] of [["just under", 2400], ["just over", 2600]]) test(`a turn coming in after a tail ${side} the cap with no reply: the set ${more < 2500 ? "checks the tail again" : "is found again"} in slices, with the same matches and the same match selected`, async () => {
  const { v, cx, s } = await longPane(5600);
  tailMore(s, more);
  settleRows(v, cx);
  v.sel = `0:${s.turns.length}`;
  const r = {};
  priced(v, () => {
    v.action("search:please look", cx);
    for (let k = 0; k < 200 && counting(v); k++) drawOnce(v, cx);
    v.action("olderMatch", cx);
    v.action("olderMatch", cx);
    const sel = v.sel;
    const was = v.hits;
    tailMore(s, 1);
    let stops = 0;
    for (let k = 0; k < 200 && (k < 1 || counting(v)); k++) if (drawOnce(v, cx).stopped) stops++;
    r.kept = v.hits === was;
    r.stops = stops;
    r.sel = v.sel === sel && fieldText(v).startsWith("4 of ");
  });
  expect(r).toEqual({ kept: more < 2500, stops: 0, sel: true });
  expect(counting(v)).toBe(false);
  expect(places(v)).toEqual(want(v, "please look"));
}, 300000);

// The tail's pop (hitsTail) takes the newest place off in two writes: its entries, then top.
// A stop between them leaves top - 1 with no entry. A step's own hitsNow finishes the pop
// first, so a reader does not meet that state; a step met with it still goes to a match,
// the nearest each way, and throws nothing. Here the state is made by hand, with nothing
// changed since the set was counted, so the step's hitsNow keeps it as it is.
test("a step with the newest place half taken off by a stop in the tail's pop goes to the nearest match each way and throws nothing", async () => {
  const { v, cx } = await longPane(600);
  const r = {};
  priced(v, () => {
    v.action("search:ar", cx);
    drive(v, cx, 200, counted);
    const h = v.hitsNow();
    const half = () => { const p = h.top - 1; const k = h.by.get(p); h.at.delete(k); h.by.delete(p); return { p, k }; };
    const step = (name) => { try { v.action(name, cx); return v.sel; } catch (e) { return String(e); } };
    // n from the match whose place was taken: nearest older is the place below it.
    let { p, k } = half();
    v.sel = k;
    r.older = step("olderMatch") === h.by.get(p - 1);
    // Shift n from the place below the half-taken one: no newer place, so it stays.
    ({ p } = half());
    const below = h.by.get(p - 1);
    v.sel = below;
    r.newer = step("newerMatch") === below;
    r.whole = Array.from({ length: h.top - h.bot }, (_, i) => h.by.has(h.bot + i)).every(Boolean);
  });
  expect(r).toEqual({ older: true, newer: true, whole: true });
}, 120000);

// ---- the places in two arrays ----
// The set keeps each match's key by its place in two arrays (Places in main.js): up for the
// places from 0 up, dn for those from -1 down. With a Map keyed by the place, one tail check of
// a 1,990- or 2,490-turn tail took 10.2 to 14.4 ms on the rig (Herdr 0.1.18, the median of the
// later checks in a run); with the two arrays, 1.9 to 2.4 ms. A dropped place is written
// undefined and no array gets shorter, so a place written next to the oldest one after it was
// dropped lands at the array's end, never past it (a hole).
const holes = (a) => { let n = 0; for (let i = 0; i < a.length; i++) if (!(i in a)) n++; return n; };

test("the set's places in two arrays: each place on either side of 0 reads back its key, a dropped place reads as none, and a place written after the oldest was dropped leaves no hole", async () => {
  const { v, cx } = await longPane(600);
  v.action("search:rename", cx);
  const b = new v.hits.by.constructor();
  for (const p of [0, 1, 2]) b.set(p, `0:${p + 10}`);
  for (const p of [-1, -2, -3]) b.set(p, `0:${p + 5}`);
  const r = { arrays: Array.isArray(b.up) && Array.isArray(b.dn) };
  r.read = [-3, -2, -1, 0, 1, 2].map((p) => b.get(p));
  // The newest place dropped (a tail check's pop), place 0, and the oldest (a cut back).
  b.delete(2);
  b.delete(0);
  b.delete(-3);
  r.dropped = [b.get(2), b.has(2), b.get(0), b.has(0), b.get(-3), b.has(-3), b.get(-1), b.has(1), b.has(-2)];
  // One older than the oldest, and the newest again.
  b.set(-4, "0:1");
  b.set(2, "0:13");
  r.after = [b.get(-4), b.get(-3), b.get(2)];
  r.lengths = [b.up?.length, b.dn?.length];
  r.holes = r.arrays ? [holes(b.up), holes(b.dn)] : null;
  // A drop past either end changes nothing.
  b.delete(9);
  b.delete(-9);
  r.past = [b.up?.length, b.dn?.length];
  expect(r).toEqual({
    arrays: true,
    read: ["0:2", "0:3", "0:4", "0:10", "0:11", "0:12"],
    dropped: [undefined, false, undefined, false, undefined, false, "0:4", true, true],
    after: ["0:1", undefined, "0:13"],
    lengths: [3, 4],
    holes: [0, 0],
    past: [3, 4],
  });
});

// A search counted going back from the newest turn has its places from -1 down; turns that come
// in with matches are placed from the newest place up, past 0. Both arrays then hold their side.
test("a search's places on both sides of 0, after turns come in with matches, are in their two arrays with no hole, and agree with the matches", async () => {
  const { v, cx, s } = await longPane(600);
  v.sel = `0:${s.turns.length}`;
  priced(v, () => {
    v.action("search:please look", cx);
    for (let k = 0; k < 200 && counting(v); k++) drawOnce(v, cx);
    tailMore(s, 100);
    for (let k = 0; k < 200 && (k < 1 || counting(v)); k++) drawOnce(v, cx);
  });
  const h = v.hitsNow();
  const arrays = Array.isArray(h.by.up) && Array.isArray(h.by.dn);
  const r = { sides: [h.bot < 0, h.top > 0], arrays, holes: arrays ? [holes(h.by.up), holes(h.by.dn)] : null, unsound: arrays ? unsound(h, true) : null };
  expect(r).toEqual({ sides: [true, true], arrays: true, holes: [0, 0], unsound: [] });
  expect(counting(v)).toBe(false);
  expect(places(v)).toEqual(want(v, "please look"));
}, 120000);

// A turn with no reply: a prompt and its end.
const asked = (s, t) => {
  const ts = new Date(Date.UTC(2026, 10, 4, 9, 0)).toISOString();
  T.apply(s, { k: "p", o: "human", t, ts });
  T.apply(s, { k: "d", ms: 1000, ts });
};

// A new search selects the newest match. Its first slice, newest first, finds none in a long
// tail with no replies; then a turn comes in and the tail is checked again, oldest first. The
// first match that finds is an old one, and the selection waits for the newest.
test("a new search whose first slice finds nothing selects the newest match, also when a turn comes in and a long tail is checked again oldest first", async () => {
  const { v, cx, s } = await longPane(600);
  const base = s.turns.length;
  // A 2,400-turn tail, under HITS_TAIL_MAX, so the turn coming in has it checked again (oldest
  // first) and not found again from the newest: "zebra" in its 11th turn and its 401st, which
  // is 2,000 turns back from the newest, past the command's first slice.
  for (let i = 0; i < 2400; i++) asked(s, i === 10 || i === 400 ? `Tail ${i}: the zebra list.` : `Tail ${i}: nothing here.`);
  settleRows(v, cx);
  const start = `0:${s.turns.length}`;
  v.sel = start;
  const older = `0:${base + 11}`;
  const r = {};
  // At twice the prices, so a draw's slices do not check the whole tail again at once.
  X = 2;
  try { priced(v, () => {
    v.action("search:zebra", cx);
    r.firstSlice = v.hitsNow().top - v.hitsNow().bot;
    asked(s, "A new turn: nothing here.");
    // The draws after the turn take the change (hitsTail) and check the tail again. Once the
    // older match has its place: the tail is still being checked, and the selection waits.
    for (let k = 0; k < 80 && counting(v); k++) {
      drawOnce(v, cx);
      const h = v.hitsNow();
      if (!r.atOlder && h.at.has(older)) r.atOlder = { checking: h.cur.tail != null, waiting: v.hitsSelect != null, sel: v.sel === start };
    }
  }); } finally { X = 1; }
  r.sel = v.sel;
  expect(r).toEqual({ firstSlice: 0, atOlder: { checking: true, waiting: true, sel: true }, sel: `0:${base + 401}` });
  expect(direct(v, "zebra")).toEqual([`0:${base + 401}`, `0:${base + 11}`]);
  expect(places(v)).toEqual(want(v, "zebra"));
}, 120000);

// A newer step (Shift n) from a match in a tail being checked again: the tail is checked
// oldest first, so the selected match can have its place again, as the newest place, while
// the newer match after it is not checked again yet. The newer button stays on meanwhile (not
// "No newer match"), and the step goes on by itself in the draws after it until the check
// places that match, and lands on it.
test("a newer step from a match in a long tail being checked again, the newer match not checked again yet, goes on by itself and lands on it, and the newer button stays on meanwhile", async () => {
  const { v, cx, s } = await longPane(600);
  const base = s.turns.length;
  // A 2,400-turn tail, under HITS_TAIL_MAX: "zebra" in its 11th turn and its 2,001st, more
  // than a slice apart at twice the prices.
  for (let i = 0; i < 2400; i++) asked(s, i === 10 || i === 2000 ? `Tail ${i}: the zebra list.` : `Tail ${i}: nothing here.`);
  settleRows(v, cx);
  v.sel = `0:${s.turns.length}`;
  const from = `0:${base + 11}`;
  const newer = `0:${base + 2001}`;
  const newerButton = () => { H.rec = []; v.stepButtons(theme); const c = H.rec; H.rec = null; return afterId(c, "th-match-newer"); };
  const r = {};
  X = 2;
  try { priced(v, () => {
    v.action("search:zebra", cx);
    for (let k = 0; k < 200 && counting(v); k++) drawOnce(v, cx);
    r.counted = !counting(v);
    v.sel = from;
    asked(s, "A new turn: nothing here.");
    // The draws after the turn check the tail again. Once the selected match has its place
    // again and the newer one has none yet: the newest place is the selection's.
    for (let k = 0; k < 80 && !r.at; k++) {
      drawOnce(v, cx);
      const h = v.hitsNow();
      if (h.cur.tail && h.at.has(from) && !h.at.has(newer)) {
        r.at = { newest: h.by.get(h.top - 1) === from, dimmed: (newerButton() ?? []).some((c) => c[0] === "tooltip" && c[1] === "No newer match") };
      }
    }
    v.action("newerMatch", cx);
    // The check again has just passed the selected match, and the press's own slice does not
    // reach the newer one, 1,990 turns on: the step is kept, and the selection stays on the
    // match it went from until a draw lands it.
    r.stayed = v.sel === from;
    for (let k = 0; k < 80 && v.sel === from; k++) drawOnce(v, cx);
    r.sel = v.sel;
    for (let k = 0; k < 80 && counting(v); k++) drawOnce(v, cx);
  }); } finally { X = 1; }
  expect(r).toEqual({ counted: true, at: { newest: true, dimmed: false }, stayed: true, sel: newer });
  expect(direct(v, "zebra")).toEqual([newer, from]);
  expect(places(v)).toEqual(want(v, "zebra"));
}, 120000);

// An older press (n) made right after a new search, before any draw, from a turn the search
// does not match: the command's slice found nothing, and the press's own slice finds two
// matches. The press goes to the newest of them, as n with no match selected does; the new
// search's own selection of the newest (hitsSelect) does not move the turn the press goes from
// first, which made it land on the second newest.
test("an older press right after a new search from a turn it does not match, whose own slice finds the first two matches, selects the newest", async () => {
  const { v, cx, s } = await longPane(600);
  // Two matches, then 1,600 turns with none: more than the command's slice checks.
  for (let i = 0; i < 1602; i++) asked(s, i < 2 ? `Tail ${i}: the quokka list.` : `Tail ${i}: nothing here.`);
  settleRows(v, cx);
  const start = `0:${s.turns.length}`;
  v.sel = start;
  const base = s.turns.length - 1602;
  const r = {};
  priced(v, () => {
    v.action("search:quokka", cx);
    r.firstSlice = v.hitsNow().top - v.hitsNow().bot;
    r.from = v.sel === start && !v.selMatches();
    v.action("olderMatch", cx);
    r.found = v.hitsNow().top - v.hitsNow().bot;
    r.sel = v.sel;
    for (let k = 0; k < 80 && counting(v); k++) drawOnce(v, cx);
  });
  expect(r).toEqual({ firstSlice: 0, from: true, found: 2, sel: `0:${base + 2}` });
  expect(direct(v, "quokka")).toEqual([`0:${base + 2}`, `0:${base + 1}`]);
  expect(places(v)).toEqual(want(v, "quokka"));
}, 120000);

// A turn left open with no reply while later ones start, then answered together with a later
// one: its match comes from that reply (answeredBy). It is before the last turn done with a
// reply, so the tail from that turn on does not hold it; the count still counts it.
test("a turn left open and answered together with a later one, after the matches were counted, is counted and placed", async () => {
  const { v, cx, s } = await longPane(600);
  const ts = new Date(Date.UTC(2026, 10, 4, 9, 0)).toISOString();
  // A, with no reply, stays open; B gets its reply; C starts, which ends B, not A.
  T.apply(s, { k: "p", o: "human", t: "Turn A: the alpha question.", ts });
  T.apply(s, { k: "p", o: "human", t: "Turn B: the beta question.", ts });
  T.apply(s, { k: "t", t: "Beta answered." });
  T.apply(s, { k: "p", o: "human", t: "Turn C: the gamma question.", ts });
  settleRows(v, cx);
  const r = {};
  priced(v, () => {
    v.action("search:widget", cx);
    for (let k = 0; k < 80 && counting(v); k++) drawOnce(v, cx);
    r.before = fieldText(v);
    // C's reply, and its end: A is answered by C.
    T.apply(s, { k: "t", t: "The widget is fixed." });
    T.apply(s, { k: "d", ms: 1000, ts });
    for (let k = 0; k < 80 && (k < 1 || counting(v)); k++) drawOnce(v, cx);
  });
  r.answeredBy = s.turns[600].answeredBy;
  r.matches = want(v, "widget").keys;
  expect(r).toEqual({ before: "No matches", answeredBy: 603, matches: ["0:603", "0:601"] });
  expect(places(v)).toEqual(want(v, "widget"));
}, 120000);

// ---- a transcript replaced ----
// A replaced transcript is read again from the top into the same session (restart). Read
// back to as many turns or more before a draw, the matches are found again, not kept from
// the old file.
for (const more of [0, 10]) test(`a transcript replaced and read again to ${600 + more} turns before a draw keeps none of the old file's matches`, async () => {
  const { v, cx, s } = await longPane(600);
  v.sel = `0:${s.turns.length}`;
  v.action("search:rename", cx);
  settleRows(v, cx);
  expect(fieldText(v)).toBe("1 of 60 · newest first");
  // The new file: the same turns with no "rename" in them.
  v.restart(s);
  for (const e of events(600 + more)) T.apply(s, e.t ? { ...e, t: e.t.replace("rename", "review") } : e);
  settleRows(v, cx);
  expect(direct(v, "rename")).toEqual([]);
  expect(places(v)).toEqual(want(v, "rename"));
  expect(fieldText(v)).toBe("No matches");
  // n finds no match to go to.
  const sel = v.sel;
  v.action("olderMatch", cx);
  expect(v.sel === sel || T.threadMatches(s.turns, v.findTurn(v.sel), "rename")).toBe(true);
}, 120000);

// ---- the Pinned view ----
// The Pinned view's matches are among its pins, PIN_LIMIT at most (pins.js): its count, place
// and steps check those, never the session's turns.
test("the Pinned view with every pin it holds in a 5,600-turn session checks only its pins for a search", async () => {
  const { PIN_LIMIT } = await import("../mods/agent-threads/pins.js");
  // No pins from an earlier test: the pane reads pins.json as it opens, and the made-up
  // sessions here all have the same id.
  delete recordFiles[PINS];
  const { v, cx, s } = await longPane(5600);
  await new Promise((r) => setTimeout(r, 20));
  // As many pins as it holds, two of them on turns with "rename" (5,581 and 5,591), the rest
  // on the turns after them, which have none.
  const keys = [5581, 5591, ...Array.from({ length: PIN_LIMIT - 2 }, (_, i) => 5592 + i)].map((n) => `0:${n}`);
  for (const k of keys) { v.sel = k; v.action("pin", cx); }
  expect(v.pinnedList().length).toBe(PIN_LIMIT);
  v.setView("pinned");
  settleRows(v, cx);
  const r = priced(v, () => {
    const c0 = checks();
    v.action("search:rename", cx);
    const typed = checks() - c0;
    const draws = [drawOnce(v, cx), drawOnce(v, cx), drawOnce(v, cx)];
    return { typed, draws };
  });
  const hits = keys.filter((k) => T.threadMatches(s.turns, v.findTurn(k), "rename"));
  expect(hits).toEqual(["0:5581", "0:5591"]);
  // The command, and each draw: the count, the place twice and the steps, each over the pins.
  expect(r.typed).toBeLessThanOrEqual(2 * PIN_LIMIT);
  for (const d of r.draws) { expect(d.stopped).toBe(false); expect(d.checks).toBeLessThanOrEqual(4 * PIN_LIMIT); }
  expect(v.sel).toBe("0:5591");
  expect(fieldText(v)).toBe("1 of 2 · newest first");
  expect(v.action("olderMatch", cx)).toBe(true);
  expect(v.sel).toBe("0:5581");
  expect(fieldText(v)).toBe("2 of 2 · first mention");
}, 120000);

// The newest session's turns checked again (hitsTail): more than HITS_TAIL come in at once, and
// a turn comes in before the scan has got past the turns it checks again. Each ends right.
for (const seed of PLANTED) test(`many turns coming in at once, or one before the scan is past the newest turns, leave the count and every place right${plantName(seed)}`, async () => {
  const rnd = seeded(seed);
  const ts = new Date(Date.UTC(2026, 10, 4, 9, 0)).toISOString();
  const more = (s, n, what) => { for (let i = 0; i < n; i++) { T.apply(s, { k: "p", o: "human", t: `Turn ${s.turns.length}: please ${what}.`, ts }); T.apply(s, { k: "d", ms: 1000, ts }); } };
  // 100 at once, while counting.
  {
    const { v, cx, s } = await longPane(5600);
    v.sel = `0:${s.turns.length}`;
    priced(v, () => {
      v.action("search:rename", cx);
      drawOnce(v, cx);
      expect(counting(v)).toBe(true);
      more(s, 100, "rename the cart");
      landed = null;
      if (seed) plantStop(rnd, 1000, true);
      for (let k = 0; k < 60 && counting(v); k++) drawOnce(v, cx);
    });
    if (seed) expect(landed).toBe("scan");
    expect(places(v)).toEqual(want(v, "rename"));
    expect(want(v, "rename").keys.length).toBe(660);
  }
  // The last 40 turns have no reply, so all 40 are checked again for a new turn; at 16 times
  // the price and a full frame, a slice (1 ms, the clock read every 32 turns) checks 31 turns,
  // so the scan is still among them.
  {
    const { v, cx, s } = await longPane(600);
    more(s, 40, "rename the queue");
    settleRows(v, cx);
    v.sel = "0:1";
    X = 16;
    try {
      priced(v, () => {
        v.frameBase = 40;
        v.action("search:rename", cx);
        const h = v.hitsNow();
        expect(h.cur.si).toBe(0);
        expect(h.cur.ti).toBeGreaterThan(600);
        more(s, 1, "rename it once more");
        landed = null;
        if (seed) plantStop(rnd, 60, true);
        for (let k = 0; k < 200 && counting(v); k++) drawOnce(v, cx);
      });
    } finally { X = 1; }
    if (seed) expect(landed).toBe("scan");
    expect(counting(v)).toBe(false);
    expect(places(v)).toEqual(want(v, "rename"));
    expect(want(v, "rename").keys.length).toBe(101);
  }
}, 120000);

// More of the newest session's changes: a long piece read at once (more than HITS_TAIL turns,
// so they are checked again in slices, not in one go), a hidden match among the
// turns checked again, and the session finishing its read (its newest turn turns live, which
// shows an agent message).
for (const seed of PLANTED) test(`a long piece read at once, a hidden match checked again, and a read finishing keep the count right and the draws in time${plantName(seed)}`, async () => {
  const rnd = seeded(seed);
  const ts = new Date(Date.UTC(2026, 10, 4, 9, 0)).toISOString();
  // 4,000 turns read at once into a 600-turn session with "rename" searched, at twice the price.
  {
    const { v, cx, s } = await longPane(600);
    v.sel = `0:${s.turns.length}`;
    v.action("search:rename", cx);
    settleRows(v, cx);
    // Counted before the piece comes, however long the real clock took: the piece is then a
    // tail checked again after the scan is done.
    for (let k = 0; k < 200 && counting(v); k++) { cx.flush(0); draw(v, cx); }
    expect(counting(v)).toBe(false);
    X = 2;
    const draws = [];
    try {
      priced(v, () => {
        for (let i = 0; i < 4000; i++) { T.apply(s, { k: "p", o: "human", t: `Turn ${s.turns.length}: please rename part ${i}.`, ts }); T.apply(s, { k: "t", t: "Done." }); T.apply(s, { k: "d", ms: 1000, ts }); }
        landed = null;
        if (seed) plantStop(rnd, 1000, true);
        for (let k = 0; k < 400; k++) { const d = drawOnce(v, cx); draws.push(d); if (!d.stopped && counted(v)) break; }
      });
    } finally { X = 1; }
    expect(draws.filter((d) => d.stopped).length).toBe(seed ? 1 : 0);
    if (seed) expect(landed).toBe("scan");
    expect(Math.max(...draws.filter((d) => !d.stopped).map((d) => d.ms))).toBeLessThanOrEqual(LIMIT);
    expect(places(v)).toEqual(want(v, "rename"));
  }
  // The newest turns hidden matches (agent messages with no reply): a turn comes in, and the
  // ones checked again are counted once.
  {
    const { v, cx, s } = await longPane(598, { bare: true });
    v.setSenders([{ n: 1, re: /^Turn \d+: please check/, label: "Checker" }], [], 1);
    expect(s.turns.at(-1).agent).toBe(true);
    v.action("search:cart", cx);
    settleRows(v, cx);
    const n = hiddenDirect(v, "cart");
    expect(fieldText(v)).toBe(`No matches · ${n} hidden`);
    for (let i = 0; i < 3; i++) { T.apply(s, { k: "p", o: "human", t: `Turn ${s.turns.length}: please check the cart again.`, ts }); T.apply(s, { k: "d", ms: 1000, ts }); settleRows(v, cx); }
    expect(hiddenDirect(v, "cart")).toBe(n + 3);
    expect(fieldText(v)).toBe(`No matches · ${n + 3} hidden`);
    expect(places(v)).toEqual(want(v, "cart"));
  }
  // A session still being read: its newest turn, an agent message with no reply yet, is
  // hidden; once the read is done the turn is live and shown, with nothing else changed.
  {
    const { v, cx, s } = await longPane(600, { bare: true });
    v.setSenders([{ n: 1, re: /^Turn \d+: please check/, label: "Checker" }], [], 1);
    T.apply(s, { k: "p", o: "human", t: `Turn ${s.turns.length}: please check the cart once more.`, ts });
    expect(s.turns.at(-1).agent).toBe(true);
    s.loaded = false;
    v.action("search:once more", cx);
    settleRows(v, cx);
    expect(fieldText(v)).toBe("No matches · 1 hidden");
    s.loaded = true;
    settleRows(v, cx);
    expect(fieldText(v)).toBe("1 match");
    expect(places(v)).toEqual(want(v, "once more"));
  }
}, 120000);

// The count goes on by itself: with the rows unchanged (sender rules marked again in slices,
// changing no turn, each slice starting the count again, as the later slices of a new rule's
// marking do), the draws the count asks for are enough to finish it.
test("the count asks for the draws it needs, with nothing else asking", async () => {
  const { v, cx, s } = await longPane(5600);
  v.setSenders([{ n: 1, re: /^No turn starts like this/, label: "None" }], [], 1);
  v.sel = `0:${s.turns.length}`;
  v.action("search:rename", cx);
  settleRows(v, cx);
  const rowsKey = v.rowsKey;
  const real = T.remarkSenders;
  const remark = spyOn(T, "remarkSenders").mockImplementation((ss, rules, from, until) => {
    const pn = performance.now;
    let t = 0;
    performance.now = () => (t += 0.01);
    try { return real(ss, rules, from, until === Infinity ? until : 10); } finally { performance.now = pn; }
  });
  const gates = [];
  cx.sleepHook = () => new Promise((r) => gates.push(r));
  let asked = 1;
  cx.notifyHook = () => { asked++; };
  let draws = 0;
  try {
    v.remark(cx);
    // Draw only when something asks: a timer that notifies, or the marking's end.
    for (let k = 0; k < 200; k++) {
      const g = gates.shift();
      if (g) { g(); for (let i = 0; i < 5; i++) await Promise.resolve(); }
      cx.flush(0);
      if (!asked && !g) break;
      asked = 0;
      // A draw's own timers run at its end (drawOnce), and may ask for the next.
      priced(v, () => { drawOnce(v, cx); });
      draws++;
    }
  } finally { remark.mockRestore(); cx.sleepHook = null; cx.notifyHook = null; }
  expect(v.rowsKey).toBe(rowsKey);
  expect(draws).toBeGreaterThanOrEqual(5);
  expect(counting(v)).toBe(false);
  expect(fieldText(v)).toBe("1 of 560 · newest first");
}, 120000);

// ---- the minimum length ----
// A search is two characters or more, or one in a script written without spaces between words
// (Han, Hiragana, Katakana, Hangul, Thai, Lao, Khmer, Myanmar), where one character can be a
// word. Under it the list is not filtered, nothing is checked, the field says how many to type,
// the steps are gone, and n and Shift n pass on.
test("a search needs two characters, or one in a script written without spaces", async () => {
  const { v, cx } = await longPane(600);
  const isSearch = (q) => { v.setQuery(q, cx); return v.filterText() !== ""; };
  for (const q of ["a", "7", "é", "ー", "😀", "  a  "]) expect([q, isSearch(q)]).toEqual([q, false]);
  for (const q of ["ar", "a7", "字", "𠀀", "あ", "カ", "한", "ก", "ລ", "ក", "က"]) expect([q, isSearch(q)]).toEqual([q, true]);
  // Counted in code points, not in what reads as one character: an "é" written as e and a
  // combining accent (U+0301), a thumbs-up with a skin tone, a heart with its emoji form
  // (U+FE0F) and a flag are two code points each, so each alone is a search, for that exact
  // sequence. Here none is in a turn.
  for (const q of ["e\u0301", "👍🏽", "❤️", "🇫🇷"]) {
    v.setQuery(q, cx);
    settleRows(v, cx);
    expect([q, [...q].length, v.filterText() === q, fieldText(v)]).toEqual([q, 2, true, "No matches"]);
  }
}, 120000);

// The Script property escapes are built at load, in a try: an engine without them (a
// SyntaxError) gets a minimum of 2 code points for every script, and the mod still loads.
test("with no Script property escapes in the engine, a search is two characters in every script", () => {
  expect(oneCharTest()).toBeInstanceOf(RegExp);
  const none = oneCharTest(() => { throw new SyntaxError("Invalid property name"); });
  expect(none).toBeNull();
  for (const q of ["字", "あ", "한", "ก", "a"]) expect([q, searchable(q, none)]).toEqual([q, false]);
  for (const q of ["ar", "字字", "あい"]) expect([q, searchable(q, none)]).toEqual([q, true]);
});

test("under the minimum the list is as it was, nothing is checked, and the field says to type more", async () => {
  const { v, cx, s } = await longPane(5600);
  v.sel = `0:${s.turns.length}`;
  const rows0 = v.rowsKey;
  const keys0 = v.baseRows.map((r) => r.key).join(",");
  const r = priced(v, () => {
    const c0 = checks();
    v.action("search:a", cx);
    const draws = [drawOnce(v, cx), drawOnce(v, cx)];
    H.rec = [];
    drawOnce(v, cx);
    const calls = H.rec;
    H.rec = null;
    const older = v.action("olderMatch", cx);
    const newer = v.action("newerMatch", cx);
    return { checks: checks() - c0, stops: draws.filter((d) => d.stopped).length, calls, older, newer };
  });
  expect(r.checks).toBe(0);
  expect(r.stops).toBe(0);
  expect(v.rowsKey).toBe(rows0);
  expect(v.baseRows.map((r2) => r2.key).join(",")).toBe(keys0);
  expect(v.sel).toBe(`0:${s.turns.length}`);
  // The hint in the count's place; no steps; n and Shift n are not taken.
  expect(afterId(r.calls, "th-search-count")).toContainEqual(["child", "Type 2 or more characters"]);
  expect(afterId(r.calls, "th-match-older")).toBeNull();
  expect([r.older, r.newer]).toEqual([false, false]);
  // Under 420 px, the short hint.
  v.paneW = 400;
  expect(fieldText(v)).toBe("2 or more");
  v.paneW = 560;
  // A second letter makes it a search; a jump is as before.
  v.setQuery("ar", cx);
  settleRows(v, cx);
  expect(fieldText(v)).toBe(`1 of ${direct(v, "ar").length} · newest first`);
  v.setQuery("#12", cx);
  expect(fieldText(v)).toBe("turn 12");
  v.setQuery("#", cx);
  expect(fieldText(v)).toBe("turn #");
}, 120000);
