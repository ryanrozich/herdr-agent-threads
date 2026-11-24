// bun test: a search in a long session draws within Herdr's time (TRD-123). Herdr stops a
// mod's draw that runs past about 50 ms and shows "This view could not be re-rendered" until
// one fits. On the test rig (Herdr 0.1.17, main at 635967f), in a 2,000-turn session, a
// search for "a", then "ar", then a word, stopped every draw for 15.7 s, in the search field's
// count and place. The owner first saw it on a long session.
import { test, expect, spyOn } from "bun:test";
import * as T from "../mods/agent-threads/core/turns.js";
import { isShown, oneCharTest, searchable } from "../mods/agent-threads/ui.js";
import { H, PRICE, draw, scripted, settleRows, setup, theme } from "./render-harness.js";

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
// Where the last planted stop landed: in the matches' scan (scanHits) or elsewhere, and the
// turns of the session it was checking (landedIn).
let landed = null;
let landedIn = null;
const realMatches = T.threadMatches;
function stopHere(turns) {
  if (!stopV?.renderOpen) return false;
  if (plant?.scan ? stopV.scanning && --plant.scan === 0 : plant && checks() >= plant.at) { plant = null; landed = stopV.scanning ? "scan" : "other"; landedIn = turns; return true; }
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

// A pane on a session of n such turns, every row built and shaped (on the real clock, with no
// budget), its work counted from here on.
async function longPane(n, opts) {
  const { v, cx, s } = await scripted(events(n, opts));
  v.debug = false;
  v.width = 560; v.rootH = 1100; v.listH = 1000;
  H.listWindow = (k) => ({ start: Math.max(0, k - 14), end: k });
  v.shapeBudget = Infinity;
  for (let k = 0; k < 400; k++) { v.render(cx); cx.flush(0); if (settled(v)) break; }
  v.shapeBudget = null;
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
  performance.now = () => base + clock();
  H.stopDraw = () => v.renderOpen && base + clock() - v.renderAt > LIMIT;
  v.frameBase = 0;
  v.cutUntil = 0;
  try { return fn(); } finally {
    performance.now = real; H.stopDraw = null; stopV = null; plant = null; fold(); spy.mockRestore(); spy = null;
    if (own) v.scanHits = own;
    else delete v.scanHits;
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
          still, count: v.filterCount(), want, landed,
          exact: rnd ? JSON.stringify(places(v)) === JSON.stringify(wantOf(v, q, real)) : null,
        });
      }
      return out;
    });
  } finally { X = 1; }
}

// Each pane's figures once, for the tests that read them.
const runs = new Map();
const figures = (n, x, seed = 0) => { const k = `${n}x${x}s${seed}`; if (!runs.has(k)) runs.set(k, searchRun(n, x, seed)); return runs.get(k); };
// The search command and each letter typed run at most one slice of the matches (SCAN_MS,
// 6 ms) and check the selected turn: 6.5 ms with the clock read every 32 checks.
const HANDLER_MS = 6.5;

for (const x of [1, 2]) for (const n of [2000, 5600]) {
  const at = `at ${n.toLocaleString()} turns${x === 1 ? "" : `, at ${x}x the prices`}`;
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
    expect(r.steps.map((st) => [st.q, String(st.count).replace(/,/g, "").includes(st.want === 0 ? "No matches" : String(st.want))])).toEqual(QUERIES.map((q) => [q, true]));
  }, 300000);
  // After a stop the rows wait out the light draws (CUT_MS) to be reshaped, on a timer that
  // flush(0) does not run: these runs are judged built and counted, not shaped.
  test(`search ${at}, a stop planted at a random check of the scan in each query's draws: each counts right, every place too`, async () => {
    const r = await figures(n, x, 20261124 + n + x);
    if (process.env.THREADS_SEARCH_FIGURES) console.log(JSON.stringify(r));
    expect(r.steps.map((st) => ({ q: st.q, stops: st.stops, landed: st.landed, exact: st.exact }))).toEqual(QUERIES.map((q) => ({ q, stops: 1, landed: "scan", exact: true })));
    for (const st of r.steps) expect([st.q, st.counted != null && st.counted <= 40]).toEqual([st.q, true]);
    expect(r.steps.map((st) => [st.q, String(st.count).replace(/,/g, "").includes(st.want === 0 ? "No matches" : String(st.want))])).toEqual(QUERIES.map((q) => [q, true]));
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
  let n = 0;
  m.set = function (key, val) {
    const hit = Boolean(stopV?.renderOpen && stopV.scanning) && ++n === k;
    if (hit && !after) { delete m.set; landed = `${which} before`; throw new Error("interrupted"); }
    const r = Map.prototype.set.call(this, key, val);
    if (hit) { delete m.set; landed = `${which} after`; throw new Error("interrupted"); }
    return r;
  };
}
// The set's places agree: every place from bot up to top - 1 has its key, at gives each key
// its place back, and with whole, nothing is written outside the set.
function unsound(h, whole) {
  const bad = [];
  for (let p = h.bot; p < h.top; p++) if (h.by.get(p) === undefined || h.at.get(h.by.get(p)) !== p) bad.push(["place", p]);
  if (whole) {
    for (const [p, k] of h.by) if (p < h.bot || p >= h.top) bad.push(["by", p, k]);
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
// or newer than it, not to the newest found. The count keeps its "+" meanwhile, and the place
// comes back once the tail is checked.
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
    r.placed = v.hitsNow().at.has(from);
    v.action("newerMatch", cx);
    r.newer = n(v.sel) >= n(from);
    v.sel = from;
    v.action("olderMatch", cx);
    r.older = n(v.sel) < n(from) && v.selMatches();
    v.sel = from;
    for (let k = 0; k < 80 && counting(v); k++) drawOnce(v, cx);
    r.back = v.matchPlace().at > 0;
  });
  expect(r).toEqual({ from: true, settled: "3 of 5360 · newest first", texts: [], placed: false, newer: true, older: true, back: true });
  expect(fieldText(v)).toBe(finalWords(v, "please look"));
  expect(places(v)).toEqual(want(v, "please look"));
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
