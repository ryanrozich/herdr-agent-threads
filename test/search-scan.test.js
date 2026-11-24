// bun test: a search in a long session draws within Herdr's time (TRD-123). Herdr stops a
// mod's draw that runs past about 50 ms and shows "This view could not be re-rendered" until
// one fits. In a 2,000-turn session a search for "a", then "ar", then a word, stopped every
// draw for 15.7 s on the owner's machine, in the search field's count and place.
//
// The pane's tests run in a child bun (THREADS_CHILD=search-scan), with its own stand-ins for
// gpui-kit, gpui-base and Herdr: bun runs every test file in one process, and a second set of
// module stand-ins there would change what the other files see. The parent installs none; it
// starts the child and checks the figures the child writes.
// When test/render-harness.js is on main, these stand-ins fold into it.
import { test, expect, mock } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const modDir = join(root, "mods/agent-threads");
const CHILD = process.env.THREADS_CHILD === "search-scan";

// ---- the child's clock ----
// It moves only by the work counted, at prices for Herdr's interpreter, so a run does the
// same work in the same draws on any machine, however busy:
// - checks: one threadMatches call, 4 µs. The owner's trace: a stopped draw reached 1,700 to
//   2,600 turn keys of the place's scan in the 6 to 14 ms between entering it (49 ms) and
//   the stop (55 to 63 ms), 3 to 7 µs a key. In bun with the JIT off it is 0.3 to 0.8 µs.
// - reshapes and built: a turn reshaped, and a turn's rows built, at the render harness's
//   prices (bun with the JIT off).
// - base: the rest of a draw, 20 ms a frame, a model: on the trace the draws entered the place's
//   scan at 49 ms, after one scan of the count (about 8 ms at 4 µs) and the rows' slices.
const work = { checks: 0, reshapes: 0, built: 0, frames: 0 };
const PRICE = { checks: 0.004, reshapes: 0.22, built: 0.005, frames: 20 };
const clock = () => work.checks * PRICE.checks + work.reshapes * PRICE.reshapes + work.built * PRICE.built + work.frames * PRICE.frames;
// Herdr's stop, modelled: an element made after LIMIT ms of the draw throws "interrupted".
// Not inside the virtual list's row callback, which Herdr runs outside render() and whose
// errors the mod catches. QuickJS's interrupt cannot be caught; render() catches this one,
// so the driver sets renderOpen again, as the stop leaves it.
const LIMIT = 50;
let stopOn = null;
let inList = false;
const late = () => stopOn && !inList && stopOn.renderOpen && clock() - stopOn.renderAt > LIMIT;

async function childHarness() {
  const app = mkdtempSync(join(tmpdir(), "threads-search-"));
  let state = { panes: [], terminals: [], props: {}, shared: {} };
  let listWindow = null;
  const el = new Proxy(() => {}, {
    has(_t, name) { return String(name) !== "mode"; },
    get(_t, name) {
      if (name === "then") return undefined;
      if (name === "when") return (cond, fn) => { if (cond) fn(el); return el; };
      if (name === "hover") return (fn) => { fn(el); return el; };
      return (...args) => {
        if (late()) throw new Error("interrupted");
        for (const a of args) if (a === undefined) throw new Error(`undefined passed to .${String(name)}()`);
        return el;
      };
    },
    apply() { return el; },
  });
  const viewEl = () => {
    const p = new Proxy(() => {}, { get(_t, name) { if (name === "then") return undefined; if (name === "when") return (cond, fn) => { if (cond) fn(p); return p; }; return () => p; } });
    return p;
  };
  const theme = {
    background: "#1e1e1e", foreground: "#e6e6e6", muted: "#a0a0a0", dim: "#777777", border: "#333333", raised: "#262626",
    chrome: "#202020", hover: "#2c2c2c", selected: "#2a2d3a", accent: "#4f8cff", popover: "#2a2a2a", working: "#d7a000",
    blocked: "#e05050", done: "#40b060", ansi1: "#e06c75", ansi2: "#98c379", ansi3: "#e5c07b", ansi4: "#61afef",
    ansi5: "#c678dd", ansi6: "#56b6c2",
  };
  const never = () => new Promise(() => {});
  mock.module("gpui-kit", () => ({ View: class {}, div: () => el, svg: () => el, image: () => el }));
  mock.module("gpui-base", () => ({
    v_flex: () => el, h_flex: () => el,
    InputState: { new: () => { const st = { handlers: {}, text: "", on(ev, f) { st.handlers[ev] = f; return true; }, value: () => st.text, set_value(x) { st.text = x; }, focus() {} }; return st; } },
    Input: { new: () => el }, Scrollbar: { vertical: () => el },
    Popup: { new: () => el }, HoverCard: { new: () => el },
    VirtualListScrollHandle: { new: () => ({ scroll_to_bottom() {}, scroll_to_item() {} }) },
    ScrollHandle: { new: () => ({ scroll_to_item() {}, release() { return true; } }) },
    v_virtual_list: (_id, n, sizes, keyOf, draw) => {
      const size = (i) => (typeof sizes === "number" ? sizes : sizes[i]);
      for (let i = 0; i < n; i++) { if (!(size(i) > 0)) throw new Error(`item ${keyOf(i)} has height ${size(i)}`); keyOf(i); }
      inList = true;
      try { draw(listWindow ? listWindow(n) : { start: 0, end: n }); } finally { inList = false; }
      return el;
    },
    TextView: { html: () => viewEl(), markdown: () => viewEl() }, Editor: { new: () => el },
    EditorState: { new: (opts) => { const st = { opts, handlers: {}, release() {}, on(ev, f) { st.handlers[ev] = f; return true; } }; return st; } },
  }));
  const execReal = (cmd, args) => {
    try { return { code: 0, stdout: execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"], timeout: 6000 }), stderr: "" }; }
    catch (e) { return { code: e.status ?? 1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") }; }
  };
  mock.module("herdr", () => ({
    exec: async (cmd, args) => (cmd === "open" ? { code: 0, stdout: "", stderr: "" } : execReal(cmd, args)),
    hc: async () => ({ code: 0, stdout: JSON.stringify({ foreground: { name: "claude", argv: ["claude"], pid: 42 } }), stderr: "" }),
    home: () => "/home/test", appHome: () => app,
    window: () => ({ platform: "linux", titlebar: "system", buttons: false, maximized: false, fullscreen: false, active: true }),
    updates: () => ({ app: { version: "0.1.17" } }),
    readTextFile: async () => null, writeTextFile: async () => null, watchFolder: never,
    theme: () => theme, themes: () => [{ name: "test", colors: theme }], settings: () => ({ font_family: "Mono" }),
    panes: () => state.panes, terminals: () => state.terminals, spaces: () => [{ tabs: [{ id: "A", name: "work" }] }],
    focused: () => null, props: () => state.props, run: () => null,
    shared: (k) => state.shared[k], setShared: (k, v) => { state.shared[k] = v; },
    closeOverlay: () => null, openOverlay: () => "ov1", notify: () => null, nextCommand: never,
  }));
  // The checks are counted through a stand-in for core/turns.js, put in before main.js loads.
  const turnsPath = join(modDir, "core/turns.js");
  // Taken from the module before the stand-in replaces its exports (a call through the module
  // would reach the stand-in again).
  const real = { ...(await import(turnsPath)) };
  const matches = real.threadMatches;
  mock.module(turnsPath, () => ({ ...real, threadMatches: (turns, turn, q) => { work.checks++; return matches(turns, turn, q); } }));
  // main.js finds its scripts under appHome()/mods/agent-threads.
  execFileSync("mkdir", ["-p", join(app, "mods")]);
  execFileSync("cp", ["-R", modDir, join(app, "mods/agent-threads")]);
  const { default: Threads } = await import("../mods/agent-threads/main.js");
  const { isShown } = await import("../mods/agent-threads/ui.js");
  for (const [name, n] of [["reshape", "reshapes"], ["turnRows", "built"]]) {
    const f = Threads.prototype[name];
    Threads.prototype[name] = function (...a) { work[n]++; return f.apply(this, a); };
  }
  const frame = Threads.prototype.frame;
  Threads.prototype.frame = function (...a) { work.frames++; return frame.apply(this, a); };

  const makeCx = () => {
    const cx = {
      focus_handle: () => ({ focus() {}, is_focused: () => true }),
      timer: { after(ms, fn) { cx.timers.push({ ms, fn }); }, every(ms, fn) { cx.everies.push({ ms, fn }); } },
      timers: [], everies: [],
      sleep: () => new Promise((r) => setTimeout(r, 0)),
      flush(ms = 200, rounds = 10) { for (let i = 0; i < rounds; i++) { const due = cx.timers.filter((x) => x.ms <= ms); cx.timers = cx.timers.filter((x) => x.ms > ms); if (!due.length) return; for (const x of due) x.fn(cx); } },
      spawn: (fn) => { const p = fn(cx); cx.pending.push(p); return p; },
      pending: [], notify() {}, stop_propagation() {},
      bind_keys(list) { return list.length; },
      write_to_clipboard() {}, read_from_clipboard() { return undefined; }, open_url() {},
    };
    return cx;
  };
  // A pane on a one-turn transcript read through the real extractor; the test then gives it
  // a long session of its own (session()).
  const pane = async () => {
    const dir = mkdtempSync(join(tmpdir(), "threads-fx-"));
    const file = join(dir, "f.jsonl");
    execFileSync("bun", [join(root, "test/make-fixture.js"), file, "00000000-0000-4000-8000-000000000009", "/tmp/threads-demo", "--only", "1"], { stdio: "ignore" });
    state = {
      terminals: [{ address: "t4", status: "idle", name: "claude" }],
      panes: [{ pane: "p1", tab: "A", terminal: "t4", program: { key: "claude", name: "Claude Code" } }, { pane: "p2", tab: "A", terminal: null, mod: "agent-threads" }],
      props: { terminal: "t4", transcript: file, debug: false }, shared: {},
    };
    const v = new Threads();
    const cx = makeCx();
    v.init(state.props, cx);
    for (let i = 0; i < 200; i++) {
      if (v.current()?.loaded && !v.reading && !v.resolving && v.prefsLoaded) return { v, cx, file };
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("the pane never finished reading");
  };
  return { Threads, real, isShown, pane, setWindow: (f) => { listWindow = f; } };
}

// n turns of made-up work over three days: every prompt has an "a"; "ar" (cart) is in a third
// of them; "rename" in a tenth; "zqxjvk" in none. The replies have none of them.
function events(n) {
  const ev = [];
  const day = Math.ceil(n / 3);
  for (let i = 0; i < n; i++) {
    const ts = new Date(Date.UTC(2026, 10, 1 + Math.floor(i / day), 8, 0) + (i % day) * 20000).toISOString();
    const what = i % 10 === 0 ? "rename the queue helper" : i % 3 === 0 ? "check the cart total" : "look at the staging deploy";
    ev.push(
      { k: "p", o: "human", t: `Turn ${i}: please ${what} for order ${i} and tell me what you find.`, ts },
      { k: "t", t: `Done for order ${i}. The totals round per line, so the sum is off by one cent; the helper now rounds once, the test covers it, and the logs show no new noise since the fix went in.` },
      { k: "d", ms: 1000, ts },
    );
  }
  return ev;
}
const QUERIES = ["a", "ar", "rename", "zqxjvk"];

// One draw on the child's clock: its cost, its checks, and whether Herdr stopped it.
function drawOnce(v, cx) {
  const t0 = clock();
  const c0 = work.checks;
  let stopped = false;
  try { v.render(cx); } catch (e) {
    if (String(e?.message) !== "interrupted") throw e;
    stopped = true;
    v.renderOpen = true;
  }
  const out = { ms: clock() - t0, checks: work.checks - c0, stopped };
  cx.flush(0);
  return out;
}
const trace = (...a) => { if (process.env.THREADS_SEARCH_TRACE) console.error(...a); };
const settled = (v) => !v.rowJob && !v.staleRows?.length && !(v.shapeLeft > 0) && !(v.hitsLeft?.() > 0);

// A search typed into a long session, draw by draw: the search command for the first query,
// then each next query typed into the field, as the owner did. The figures for each query.
async function searchRun(H, n) {
  const { v, cx } = await H.pane();
  const s = H.real.newSession("00000000-0000-4000-8000-00000000000a", v.current().file);
  for (const e of events(n)) H.real.apply(s, e);
  s.loaded = true;
  v.sessions = [s];
  v.width = 560; v.rootH = 1100; v.listH = 1000;
  H.setWindow((k) => ({ start: Math.max(0, k - 14), end: k }));
  // Every row built and shaped first, on the real clock, with no budget.
  v.shapeBudget = Infinity;
  for (let k = 0; k < 400; k++) { v.render(cx); cx.flush(0); if (settled(v)) break; }
  v.shapeBudget = null;
  trace("settled", n, settled(v));
  const realPerf = performance.now.bind(performance);
  performance.now = clock;
  stopOn = v;
  const out = { turns: s.turns.length, still: null, steps: [] };
  try {
    v.frameBase = 0;
    v.cutUntil = 0;
    // Draws with no search: none stopped, and they set the frame's cost.
    const before = [];
    for (let k = 0; k < 3; k++) before.push(drawOnce(v, cx));
    out.still = before.at(-1);
    out.beforeStops = before.filter((d) => d.stopped).length;
    for (const [i, q] of QUERIES.entries()) {
      const t0 = clock();
      const c0 = work.checks;
      if (i === 0) v.action(`search:${q}`, cx);
      else { v.input.text = q; v.input.handlers.change(null, cx); }
      const typed = { ms: clock() - t0, checks: work.checks - c0 };
      const draws = [];
      for (let k = 0; k < 60; k++) {
        const d = drawOnce(v, cx);
        trace(q, k, JSON.stringify(d), Boolean(v.rowJob), v.staleRows?.length, v.shapeLeft);
        draws.push(d);
        if (!d.stopped && settled(v)) break;
      }
      // A draw with nothing changed once it has settled.
      const still = drawOnce(v, cx);
      const want = s.turns.filter((t) => H.isShown(t, { agentTurns: false, live: false, turns: s.turns }) && H.real.threadMatches(s.turns, t, q)).length;
      const firstReturn = draws.findIndex((d) => !d.stopped);
      out.steps.push({
        q, typed, frames: draws.length, stops: draws.filter((d) => d.stopped).length,
        firstReturn: firstReturn < 0 ? null : firstReturn + 1, settled: settled(v),
        maxMs: Math.max(...draws.map((d) => d.ms)), maxChecks: Math.max(...draws.map((d) => d.checks)),
        still, count: v.filterCount(), want,
      });
    }
  } finally { performance.now = realPerf; stopOn = null; }
  return out;
}

// A rows build stopped inside one of its slices goes on to the rows one build makes: the
// slice that resumes a build adds to the rows it was handed, and the place it starts from moves
// only when a slice ends.
async function resumeRun(H) {
  const { v, cx } = await H.pane();
  const s = H.real.newSession("00000000-0000-4000-8000-00000000000a", v.current().file);
  for (const e of events(600)) H.real.apply(s, e);
  s.loaded = true;
  v.sessions = [s];
  v.width = 560; v.rootH = 1100; v.listH = 1000;
  H.setWindow((k) => ({ start: Math.max(0, k - 14), end: k }));
  v.shapeBudget = Infinity;
  for (let k = 0; k < 400; k++) { v.render(cx); cx.flush(0); if (settled(v)) break; }
  v.shapeBudget = null;
  const sig = () => v.baseRows.map((r, i) => `${r.kind}|${r.key}|${v.baseSizes[i]}`);
  const whole = sig();
  const realPerf = performance.now.bind(performance);
  performance.now = clock;
  // 0.05 ms a turn's rows: a 10 ms slice builds about 200 turns, so the build takes slices.
  const built = PRICE.built;
  PRICE.built = 0.05;
  const turnRows = v.turnRows;
  let cut = null;
  let stops = 0;
  const out = { slices: 0 };
  try {
    v.frameBase = 0;
    v.cutUntil = 0;
    v.rowsKey = null;
    v.rowBuild = null;
    // The second slice (the first that resumes) is stopped after 50 turns.
    v.turnRows = function (...a) {
      if (cut == null && this.rowJob?.from?.own && this.renderOpen) cut = 0;
      if (cut != null && cut >= 0 && ++cut > 50) { cut = -1; throw new Error("interrupted"); }
      return turnRows.apply(this, a);
    };
    for (let k = 0; k < 100; k++) {
      out.slices++;
      try { v.render(cx); } catch (e) { if (String(e?.message) !== "interrupted") throw e; stops++; v.renderOpen = true; }
      cx.flush(0);
      if (!v.rowJob && k > 0) break;
    }
  } finally { performance.now = realPerf; PRICE.built = built; v.turnRows = turnRows; }
  const now = sig();
  const keys = v.baseRows.map((r) => r.key);
  return { ...out, stops, cutHit: cut === -1, rows: now.length, wholeRows: whole.length, unique: new Set(keys).size, same: now.join("\n") === whole.join("\n") };
}

if (CHILD) {
  const H = await childHarness();
  test("search-scan child: search draws at 2,000 and 5,600 turns, and a build stopped inside a slice", async () => {
    const r = { s2000: await searchRun(H, 2000), s5600: await searchRun(H, 5600), resume: await resumeRun(H) };
    writeFileSync(process.env.THREADS_OUT, JSON.stringify(r));
  }, 300000);
}

// Runs the child once for every test below.
let figures = null;
async function childFigures() {
  if (figures) return figures;
  const out = join(mkdtempSync(join(tmpdir(), "threads-search-")), "out.json");
  await new Promise((resolve, reject) => {
    const child = spawn("bun", ["test", join(root, "test/search-scan.test.js"), "-t", "search-scan child"], {
      env: { ...process.env, THREADS_CHILD: "search-scan", THREADS_OUT: out }, stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (b) => { err += b; });
    const timer = setTimeout(() => child.kill(), 290000);
    child.on("error", reject);
    child.on("exit", (code, sig) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`the search child ended with ${code ?? sig}\n${err.slice(-4000)}`)); });
  });
  figures = JSON.parse(readFileSync(out, "utf8"));
  if (process.env.THREADS_SEARCH_FIGURES) console.log(JSON.stringify(figures, null, 1));
  return figures;
}

if (!CHILD) {
  for (const n of [2000, 5600]) {
    test(`search at ${n.toLocaleString()} turns: "a", "ar", a word and a query with no match each draw inside Herdr's time from the first frame, and settle on the right count`, async () => {
      const r = (await childFigures())[`s${n}`];
      expect(r.turns).toBe(n);
      // The pane draws before the search: the model's base fits.
      expect(r.beforeStops).toBe(0);
      // No draw is stopped, so the first one returns, and the rows settle, for every query.
      expect(r.steps.map((st) => ({ q: st.q, stops: st.stops, firstReturn: st.firstReturn, settled: st.settled }))).toEqual(QUERIES.map((q) => ({ q, stops: 0, firstReturn: 1, settled: true })));
      for (const st of r.steps) expect(st.frames).toBeLessThanOrEqual(40);
      // The final count is every matching shown turn.
      expect(r.steps.map((st) => [st.q, String(st.count).replace(/,/g, "").includes(st.want === 0 ? "No matches" : String(st.want))])).toEqual(QUERIES.map((q) => [q, true]));
    }, 300000);
    test(`search at ${n.toLocaleString()} turns: a draw with nothing changed checks no turn, and no draw checks more than a slice of them`, async () => {
      const r = (await childFigures())[`s${n}`];
      expect(r.steps.map((st) => ({ q: st.q, still: st.still.checks }))).toEqual(QUERIES.map((q) => ({ q, still: 0 })));
      // The scan is cut into slices that fit beside the rest of the draw.
      expect(r.steps.map((st) => [st.q, st.maxMs <= LIMIT])).toEqual(QUERIES.map((q) => [q, true]));
    }, 300000);
  }
  test("a rows build stopped inside a slice that resumes it ends with the rows one build makes, each once", async () => {
    const r = (await childFigures()).resume;
    expect(r.cutHit).toBe(true);
    expect(r.stops).toBe(1);
    expect(r.unique).toBe(r.rows);
    expect(r.same).toBe(true);
  }, 300000);
}
