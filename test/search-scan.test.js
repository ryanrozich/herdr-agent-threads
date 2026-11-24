// bun test: a search in a long session draws within Herdr's time (TRD-123). Herdr stops a
// mod's draw that runs past about 50 ms and shows "This view could not be re-rendered" until
// one fits. In a 2,000-turn session a search for "a", then "ar", then a word, stopped every
// draw for 15.7 s on the owner's machine, in the search field's count and place.
import { test, expect, spyOn } from "bun:test";
import * as T from "../mods/agent-threads/core/turns.js";
import { isShown } from "../mods/agent-threads/ui.js";
import { H, PRICE, draw, scripted, settleRows, setup } from "./render-harness.js";

setup();

// ---- the clock ----
// The draws here run on a clock that moves only by the work counted, at prices for Herdr's
// interpreter, so a run does the same work in the same draws on any machine, however busy:
// - checks: one threadMatches call, 4 µs. The owner's trace: a stopped draw reached 1,700 to
//   2,600 turn keys of the place's scan in the 6 to 14 ms between entering it (49 ms) and
//   the stop (55 to 63 ms), 3 to 7 µs a key. In bun with the JIT off it is 0.3 to 0.8 µs.
// - reshapes and built: a turn reshaped, and a turn's rows built, at the harness's prices
//   (bun with the JIT off).
// - frames: the rest of a draw, 20 ms each, a model. A still draw with no search fits, as the
//   owner's 508 draws before the search did; on the trace the draws entered the place's scan
//   at 49 ms, after the count's scan (about 8 ms at 4 µs) and the rows' slices.
const COST = { checks: 0.004, reshapes: PRICE.reshapes, built: PRICE.built, frames: 20 };
const paid = { checks: 0, reshapes: 0, built: 0, frames: 0 };
let spy = null;
const checks = () => paid.checks + (spy ? spy.mock.calls.length : 0);
const clock = () => checks() * COST.checks + paid.reshapes * COST.reshapes + paid.built * COST.built + paid.frames * COST.frames;
// The spy keeps every call's arguments: folded into paid now and then.
const fold = () => { if (spy) { paid.checks += spy.mock.calls.length; spy.mockClear(); } };
// Herdr's stop past LIMIT ms of a draw (H.stopDraw in the harness). QuickJS's interrupt cannot
// be caught; render() catches this one, so the driver sets renderOpen again, as the stop
// leaves it.
const LIMIT = 50;

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
const QUERIES = ["a", "ar", "rename", "zqxjvk"];

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
const settled = (v) => !v.rowJob && !v.staleRows?.length && !(v.shapeLeft > 0) && !(v.hitsLeft?.() > 0);

// Runs fn on the clock, with Herdr's stop armed for v's draws.
function priced(v, fn) {
  const real = performance.now;
  for (const k of Object.keys(paid)) paid[k] = 0;
  spy = spyOn(T, "threadMatches");
  performance.now = clock;
  H.stopDraw = () => v.renderOpen && clock() - v.renderAt > LIMIT;
  v.frameBase = 0;
  v.cutUntil = 0;
  try { return fn(); } finally { performance.now = real; H.stopDraw = null; fold(); spy.mockRestore(); spy = null; }
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

// A search typed into a long session, draw by draw: the search command for the first query,
// then each next query typed into the field, as the owner did. The figures for each query.
async function searchRun(n) {
  const { v, cx, s } = await longPane(n);
  const turns = s.turns;
  const real = T.threadMatches;
  return priced(v, () => {
    const out = { turns: turns.length, steps: [] };
    // Draws with no search: none stopped, and they set the frame's cost.
    const before = [];
    for (let k = 0; k < 3; k++) before.push(drawOnce(v, cx));
    out.beforeStops = before.filter((d) => d.stopped).length;
    for (const [i, q] of QUERIES.entries()) {
      const t0 = clock();
      const c0 = checks();
      if (i === 0) v.action(`search:${q}`, cx);
      else { v.input.text = q; v.input.handlers.change(null, cx); }
      const typed = { ms: clock() - t0, checks: checks() - c0 };
      const draws = [];
      for (let k = 0; k < 60; k++) {
        const d = drawOnce(v, cx);
        draws.push(d);
        if (!d.stopped && settled(v)) break;
      }
      // A draw with nothing changed once it has settled.
      const still = drawOnce(v, cx);
      const want = turns.filter((t) => isShown(t, { agentTurns: false, live: false, turns }) && real(turns, t, q)).length;
      const firstReturn = draws.findIndex((d) => !d.stopped);
      out.steps.push({
        q, typed, frames: draws.length, stops: draws.filter((d) => d.stopped).length,
        firstReturn: firstReturn < 0 ? null : firstReturn + 1, settled: settled(v),
        maxMs: Math.max(...draws.map((d) => d.ms)), maxChecks: Math.max(...draws.map((d) => d.checks)),
        still, count: v.filterCount(), want,
      });
    }
    return out;
  });
}

// Each pane's figures once, for the tests that read them.
const runs = new Map();
const figures = (n) => { if (!runs.has(n)) runs.set(n, searchRun(n)); return runs.get(n); };

for (const n of [2000, 5600]) {
  test(`search at ${n.toLocaleString()} turns: "a", "ar", a word and a query with no match each draw inside Herdr's time from the first frame, and settle on the right count`, async () => {
    const r = await figures(n);
    if (process.env.THREADS_SEARCH_FIGURES) console.log(JSON.stringify(r));
    expect(r.turns).toBe(n);
    // The pane draws before the search: the model's frame fits.
    expect(r.beforeStops).toBe(0);
    // No draw is stopped, so the first one returns, and the rows settle, for every query.
    expect(r.steps.map((st) => ({ q: st.q, stops: st.stops, firstReturn: st.firstReturn, settled: st.settled }))).toEqual(QUERIES.map((q) => ({ q, stops: 0, firstReturn: 1, settled: true })));
    for (const st of r.steps) expect(st.frames).toBeLessThanOrEqual(40);
    // The final count is every matching shown turn.
    expect(r.steps.map((st) => [st.q, String(st.count).replace(/,/g, "").includes(st.want === 0 ? "No matches" : String(st.want))])).toEqual(QUERIES.map((q) => [q, true]));
  }, 120000);
  test(`search at ${n.toLocaleString()} turns: a draw with nothing changed checks no turn, and no draw runs past Herdr's time`, async () => {
    const r = await figures(n);
    expect(r.steps.map((st) => ({ q: st.q, still: st.still.checks }))).toEqual(QUERIES.map((q) => ({ q, still: 0 })));
    // The scan is cut into slices that fit beside the rest of the draw.
    expect(r.steps.map((st) => [st.q, st.maxMs <= LIMIT])).toEqual(QUERIES.map((q) => [q, true]));
  }, 120000);
}

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
  const base = clock;
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
          performance.now = () => base() + sized * 0.02;
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

// ---- one set of matches, kept across draws ----
// The search's matches are found once for each change and kept: the field's count, its place,
// its two steps and n / Shift n read them, and a draw with nothing changed checks no turn.

// The shown turns q matches, newest first, counted directly.
const direct = (v, q, agentTurns = false) => {
  const out = [];
  v.sessions.forEach((s, si) => s.turns.forEach((t, ti) => {
    if (isShown(t, { agentTurns, live: v.isLive(s, si, ti), turns: s.turns }) && T.threadMatches(s.turns, t, q)) out.push(`${si}:${t.n}`);
  }));
  return out.reverse();
};
const hiddenDirect = (v, q, agentTurns = false) => {
  let n = 0;
  v.sessions.forEach((s, si) => s.turns.forEach((t, ti) => {
    if (!isShown(t, { agentTurns, live: v.isLive(s, si, ti), turns: s.turns }) && T.threadMatches(s.turns, t, q)) n++;
  }));
  return n;
};
// Draws on the clock until the rows and matches settle: the draws, the stops and the checks.
function drive(v, cx, max = 200) {
  let draws = 0, stops = 0, n = 0;
  for (; draws < max; draws++) {
    const d = drawOnce(v, cx);
    n += d.checks;
    if (d.stopped) stops++;
    else if (settled(v)) { draws++; break; }
  }
  return { draws, stops, checks: n, settled: settled(v) };
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
