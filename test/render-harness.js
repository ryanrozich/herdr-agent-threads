// The render tests' harness: gpui-kit, gpui-base and Herdr replaced by stubs, so the panel's
// drawing code runs in bun. Every element method returns the same chainable stub; .when()
// and .hover() run their callbacks, and the virtual list draws every item unless a test sets
// a window (listWindow). The pane reads synthetic fixtures through the real extractor (exec
// runs it). Used by test/render.test.js; other test files can share it.
//
// bun runs every test file in one process and loads this module once, so each test file calls
// setup() as it starts: it re-installs the module stand-ins and, through reset(), puts every
// setting below back to its default and empties every shared list and count. Nothing is reset
// between the tests of one file. What reset() leaves alone: keyBinds, since the mod binds its
// keys once per process (ui.js), so a later file's panes bind nothing and the record of that
// one binding has to stay; app and the mod copied into it, made once; and main.js and ui.js
// themselves, loaded once, with their own module state.
import { mock, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const root = join(import.meta.dir, "..");
export const modDir = join(root, "mods/agent-threads");
export const app = mkdtempSync(join(tmpdir(), "threads-render-"));

export let calls = 0;
// With rec set, every element method call is recorded as [name, ...args].
export let rec = null;
// Element methods by what a test says the running Herdr has, for code that asks with
// "name in el". `lacking`: an older Herdr's gap, so `name in el` answers false and a call
// throws, as Herdr's "not a function". `stubHas`: a method only a newer Herdr has (NEWER),
// which answers true only while a test adds it.
export const lacking = new Set();
export const stubHas = new Set();
export const NEWER = new Set(["mode"]);
export const el = new Proxy(() => {}, {
  has(_t, name) { const n = String(name); return !lacking.has(n) && (!NEWER.has(n) || stubHas.has(n)); },
  get(_t, name) {
    if (name === "then") return undefined;
    if (lacking.has(String(name))) return undefined;
    if (name === "when") return (cond, fn) => { if (cond) fn(el); return el; };
    if (name === "hover") return (fn) => { fn(el); return el; };
    return (...args) => { calls++; if (rec) rec.push([String(name), ...args]); for (const a of args) if (a === undefined) throw new Error(`undefined passed to .${String(name)}()`); return el; };
  },
  apply() { return el; },
});
export const theme = {
  background: "#1e1e1e", foreground: "#e6e6e6", muted: "#a0a0a0", dim: "#777777", border: "#333333", raised: "#262626",
  chrome: "#202020", hover: "#2c2c2c", selected: "#2a2d3a", accent: "#4f8cff", popover: "#2a2a2a", working: "#d7a000",
  blocked: "#e05050", done: "#40b060", ansi1: "#e06c75", ansi2: "#98c379", ansi3: "#e5c07b", ansi4: "#61afef",
  ansi5: "#c678dd", ansi6: "#56b6c2",
};
export let state = { panes: [], terminals: [], props: {}, shared: {} };
// What the pane did through Herdr: run() calls, the clipboard, and hc get's answer.
export let log = [];
export let hcOut = JSON.stringify({ foreground: { name: "claude", argv: ["claude"], pid: 42 } });
// hc get's answer per terminal, and session records by path, for the binding tests.
export let hcBy = {};
export let recordFiles = {};
export let focusNow = null;
// After pane.focus: the focused pane's terminal, from the panes the test set.
function focusPane(args) { focusNow = { terminal: state.panes.find((p) => p.pane === args?.pane)?.terminal ?? null }; }
export let afterFocus = focusPane;
export const mdSources = [];
// Overlays the mod opened (the image gallery).
export const overlays = [];
export const closed = [];
// Every TextView made, with the calls on it (scrollable, size_full, …).
export const views = [];
export function viewEl(calls) {
  const p = new Proxy(() => {}, {
    get(_t, name) {
      if (name === "then") return undefined;
      if (name === "when") return (cond, fn) => { if (cond) fn(p); return p; };
      return (...args) => { calls.push([String(name), ...args]); return p; };
    },
  });
  return p;
}
export const editors = [];
// Plain scroll handles made (the image viewer's panel), with the children each was asked to reveal.
export const scrollHandles = [];
export let focusCalls = 0;
// Every list given to cx.bind_keys, for the whole run: the mod installs its keys once per
// process, so reset() keeps this.
export const keyBinds = [];
export const never = () => new Promise(() => {});
// The items the virtual list draws, as Herdr does for what is on screen: all of them unless a
// test sets this (n) => { start, end }.
export let listWindow = null;
// What the last v_virtual_list was given: its sizes and item keys.
export let lastList = null;
// settings(): the person's Herdr settings (zoom, fonts).
export let herdrSettings = { font_family: "Mono" };
// What Herdr's window() reports as the platform (round 6 face).
export let hostPlatform = "linux";
// updates().app.version: Herdr's version.
export let herdrVersion = "0.1.17";
// Reads of Herdr's settings, panes and terminals, for the draw-time guard.
export const hostReads = { settings: 0, panes: 0, terminals: 0 };
// With marks set, exec records when the script hands off ("out") and gets its answer back
// ("in"), with the time and the work counted so far, so a test can measure the synchronous
// stretches between awaits.
export let marks = null;
export const stamp = (what) => { if (marks) marks.push([what, performance.now(), { ...work }]); };
export let pinWrites = 0;
// The extractor's calls, as [offset, bytes], while a test collects them (an array; null: not collected).
export let extractCalls = null;
// A test's stand-in for the extractor: its answer, or null to run it.
export let extractHook = null;
// What the pane wrote to settings.json (the viewer keeps its panel choice there). With
// keepSettings set, a write is also what the next read finds, as on disk.
export const settingsWrites = [];
export let keepSettings = false;
// With settingsStale set, a settings write whose expected text is not what the file holds is
// rejected, as Herdr rejects a stale snapshot.
export let settingsStale = false;
// A script that has not ended in 4 s is killed with everything it started, and the call fails
// with a line naming it: a hung child ends before bun's 5 s test limit kills it as a dangling
// process, which says nothing of which call it was (once in CI). The script runs in a process
// group of its own under this perl, which kills the group: a timeout on the call alone stops
// only sh, and the extractor's sh waits for its pipeline before it heeds a TERM.
export const EXEC_LIMIT_S = 4;
export const EXEC_GUARD = `my $s = shift; my $late = 0;
my $pid = fork() // die "fork: $!";
if (!$pid) { setpgrp(0, 0); exec { $ARGV[0] } @ARGV; exit 127 }
$SIG{ALRM} = sub { $late = 1; kill "KILL", -$pid; kill "KILL", $pid };
alarm $s; waitpid($pid, 0); my $st = $?; alarm 0;
exit 124 if $late;
exit($st & 127 ? 128 + ($st & 127) : $st >> 8);`;
export function execReal(cmd, args) {
    const opts = { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"], timeout: (EXEC_LIMIT_S + 2) * 1000 };
    try { return { code: 0, stdout: execFileSync("perl", ["-e", EXEC_GUARD, String(EXEC_LIMIT_S), cmd, ...args], opts), stderr: "" }; }
    catch (e) {
      if (e.status === 124 || e.code === "ETIMEDOUT") console.error(`exec: ${cmd} ${args.join(" ")} ran past ${EXEC_LIMIT_S} s and was killed`);
      return { code: e.status ?? 1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
    }
}
export function herdrRest() { return {
  home: () => "/home/test", appHome: () => app,
  window: () => ({ platform: hostPlatform, titlebar: "system", buttons: false, maximized: false, fullscreen: false, active: true }),
  updates: () => ({ app: { version: herdrVersion } }),
  readTextFile: async (p) => recordFiles[p] ?? null,
  writeTextFile: async (p, text, expected) => {
    if (p.endsWith("settings.json")) {
      if (settingsStale && (recordFiles[p] ?? null) !== (expected ?? null)) throw new Error("stale snapshot");
      settingsWrites.push(text);
      if (keepSettings) recordFiles[p] = text;
    }
    if (!p.endsWith("pins.json")) return null;
    if ((recordFiles[p] ?? null) !== (expected ?? null)) throw new Error("stale snapshot");
    recordFiles[p] = text;
    pinWrites++;
    return null;
  },
  watchFolder: never,
  theme: () => theme, themes: () => [{ name: "test", colors: theme }], settings: () => { hostReads.settings++; return herdrSettings; },
  panes: () => { hostReads.panes++; return state.panes; }, terminals: () => { hostReads.terminals++; return state.terminals; }, spaces: () => [{ tabs: [{ id: "A", name: "work" }] }],
  focused: () => focusNow, props: () => state.props,
  run: (name, args) => { log.push(["run", name, args ?? null]); if (name === "pane.focus") afterFocus(args); return null; },
  shared: (k) => state.shared[k], setShared: (k, v) => { state.shared[k] = v; },
  closeOverlay: (id) => { closed.push(id); return null; }, openOverlay: (spec) => { overlays.push(spec); return `ov${overlays.length}`; }, notify: (n) => { log.push(["notify", n]); return null; }, nextCommand: never,
}; }

// main.js finds its scripts under appHome()/mods/agent-threads.
execFileSync("mkdir", ["-p", join(app, "mods")]);
execFileSync("cp", ["-R", modDir, join(app, "mods/agent-threads")]);
// The read's work, counted for the S1 child: lines parsed and events applied (through a
// counting stand-in for core/turns.js, in the child only), turns reshaped, and turns whose
// rows were built.
export const work = { lines: 0, events: 0, reshapes: 0, built: 0 };
// What each costs in ms in bun with the JIT off, the interpreter's speed, on a developer
// machine: 0.7 to 1.4 µs a line, 1.25 to 1.4 µs an event, 0.21 to 0.27 ms a reshape, and
// 4.7 to 4.8 µs a turn's rows without its reshape.
export const PRICE = { lines: 0.001, events: 0.0013, reshapes: 0.22, built: 0.005 };
// The S1 child's clock: the work done so far, at those prices.
export const worked = () => work.lines * PRICE.lines + work.events * PRICE.events + work.reshapes * PRICE.reshapes + work.built * PRICE.built;
if (process.env.THREADS_CHILD === "read-timing") {
  const turnsPath = join(modDir, "core/turns.js");
  const real = await import(turnsPath);
  const { parseLine, apply } = real;
  mock.module(turnsPath, () => ({ ...real, parseLine: (c, line) => { work.lines++; return parseLine(c, line); }, apply: (s, e) => { work.events++; return apply(s, e); } }));
}
// Every setting back to its default, and every shared list and count emptied (keyBinds
// stays; see the top of this file).
export function reset() {
  calls = 0;
  rec = null;
  state = { panes: [], terminals: [], props: {}, shared: {} };
  log = [];
  hcOut = JSON.stringify({ foreground: { name: "claude", argv: ["claude"], pid: 42 } });
  hcBy = {};
  recordFiles = {};
  focusNow = null;
  afterFocus = focusPane;
  focusCalls = 0;
  listWindow = null;
  lastList = null;
  herdrSettings = { font_family: "Mono" };
  hostPlatform = "linux";
  herdrVersion = "0.1.17";
  marks = null;
  pinWrites = 0;
  extractCalls = null;
  extractHook = null;
  keepSettings = false;
  settingsStale = false;
  lacking.clear();
  stubHas.clear();
  for (const list of [mdSources, overlays, closed, views, editors, scrollHandles, settingsWrites]) list.length = 0;
  for (const k of Object.keys(hostReads)) hostReads[k] = 0;
  for (const k of Object.keys(work)) work[k] = 0;
}
// The module stand-ins for gpui-kit, gpui-base and Herdr, and the settings reset. Installed
// here before main.js is imported, and again by each test file as it starts: another file may
// have put its own stand-ins in, or left settings behind.
export function setup() {
  reset();
  mock.module("gpui-kit", () => ({ View: class {}, div: () => el, svg: (p) => { if (rec) rec.push(["svg", p]); return el; }, image: () => el }));
  mock.module("gpui-base", () => ({
    v_flex: () => el, h_flex: () => el,
    InputState: { new: () => { const st = { handlers: {}, text: "", on(ev, f) { st.handlers[ev] = f; return true; }, value: () => st.text, set_value(x) { st.text = x; }, focus() {} }; return st; } },
    Input: { new: () => el }, Scrollbar: { vertical: () => el },
    Popup: { new: (id) => { if (rec) rec.push(["Popup", id]); return el; } },
    HoverCard: { new: (id) => { if (rec) rec.push(["HoverCard", id]); return el; } },
    VirtualListScrollHandle: { new: () => ({ scroll_to_bottom() {}, scroll_to_item() {} }) },
    ScrollHandle: { new: () => { const h = { asked: [], scroll_to_item(i) { h.asked.push(i); }, release() { return true; } }; scrollHandles.push(h); return h; } },
    v_virtual_list: (_id, n, sizes, keyOf, draw) => {
      // One number is one height for every item (the Trajectory's list); an array is one each.
      const size = (i) => (typeof sizes === "number" ? sizes : sizes[i]);
      lastList = { sizes: typeof sizes === "number" ? Array.from({ length: n }, () => sizes) : [...sizes], keys: [], draw };
      for (let i = 0; i < n; i++) { if (!(size(i) > 0)) throw new Error(`item ${keyOf(i)} has height ${size(i)}`); lastList.keys.push(keyOf(i)); }
      draw(listWindow ? listWindow(n) : { start: 0, end: n });
      return el;
    },
    TextView: { html: (id, html) => { const calls = []; views.push({ id, html, calls }); if (rec) rec.push(["TextView", id]); return viewEl(calls); }, markdown: (id, md) => { mdSources.push([id, md]); const calls = []; views.push({ id, md, calls }); if (rec) rec.push(["TextView", id]); return viewEl(calls); } }, Editor: { new: () => el }, EditorState: { new: (opts) => { const st = { opts, handlers: {}, release() {}, on(ev, f) { st.handlers[ev] = f; return true; } }; editors.push(st); return st; } },
  }));
  mock.module("herdr", () => ({
    exec: async (cmd, args) => {
      // A link the pane opens is logged, never opened.
      if (cmd === "open") { log.push(["open", ...args]); return { code: 0, stdout: "", stderr: "" }; }
      // The extractor's calls, as [offset, bytes], while a test collects them.
      if (extractCalls && String(args?.[0] ?? "").endsWith("core/extract.sh")) extractCalls.push([Number(args[2]), Number(args[3])]);
      // A test's stand-in for the extractor: its answer, or null to run it.
      if (extractHook && String(args?.[0] ?? "").endsWith("core/extract.sh")) { const r = await extractHook(args); if (r) return r; }
      stamp("out");
      try { return execReal(cmd, args); } finally { stamp("in"); }
    },
    hc: async (args) => { log.push(["hc", ...args]); return { code: 0, stdout: hcBy[args[1]] ?? hcOut, stderr: "" }; },
    ...herdrRest(),
  }));
}
setup();
export const { default: Threads } = await import("../mods/agent-threads/main.js");
export const { thumbSize, tileRow, bubbleMax, ROW, columnWidth, railLook, rowHeight, MD_MAX, alpha: alphaForTest, dayKey } = await import("../mods/agent-threads/ui.js");

export function fixture(...flags) {
  const dir = mkdtempSync(join(tmpdir(), "threads-fx-"));
  const file = join(dir, "f.jsonl");
  execFileSync("bun", [join(root, "test/make-fixture.js"), file, "00000000-0000-4000-8000-000000000009", "/tmp/threads-demo", ...flags], { stdio: "ignore" });
  return file;
}

// A press on a closed turn opens it OPEN_WAIT_MS (300) after the release, unless a second
// press comes first (issue 131). This runs that wait and nothing else.
export function afterPress(cx) {
  const due = cx.timers.filter((x) => x.ms === 300);
  cx.timers = cx.timers.filter((x) => x.ms !== 300);
  for (const x of due) x.fn(cx);
}

export function makeCx() {
  const cx = {
    focus_handle: () => ({ focus() { focusCalls++; }, is_focused: () => true }),
    // Timers are kept; flush() runs the ones due within ms (the quote's focus retries).
    timer: { after(ms, fn) { cx.timers.push({ ms, fn }); }, every(ms, fn) { cx.everies.push({ ms, fn }); } },
    timers: [], everies: [],
    // cx.sleep: a macrotask by default; a test can swap in its own (a dead task, timing marks).
    sleep: (ms) => (cx.sleepHook ? cx.sleepHook(ms) : new Promise((r) => setTimeout(r, 0))),
    sleepHook: null, notifyHook: null,
    flush(ms = 200, rounds = 10) { for (let i = 0; i < rounds; i++) { const due = cx.timers.filter((x) => x.ms <= ms); cx.timers = cx.timers.filter((x) => x.ms > ms); if (!due.length) return; for (const x of due) x.fn(cx); } },
    spawn: (fn) => { const p = fn(cx); cx.pending.push(p); return p; },
    pending: [], notify() { cx.notifyHook?.(); }, stop_propagation() {},
    bind_keys(list) { keyBinds.push(list); return list.length; },
    clip: null,
    write_to_clipboard(t) { cx.clip = t; log.push(["clipboard", t]); },
    read_from_clipboard() { return cx.clip ?? undefined; },
    open_url(u) { log.push(["open_url", u]); },
  };
  return cx;
}
// The watch and command loops never end, so wait for the read itself.
export async function settle(v, tries = 200) {
  for (let i = 0; i < tries; i++) {
    if (v.current()?.loaded && !v.reading && !v.resolving && v.prefsLoaded) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("the pane never finished reading");
}

export async function pane(file) {
  state = {
    terminals: [{ address: "t4", status: "idle", name: "claude" }],
    panes: [{ pane: "p1", tab: "A", terminal: "t4", program: { key: "claude", name: "Claude Code" } }, { pane: "p2", tab: "A", terminal: null, mod: "agent-threads" }],
    props: { terminal: "t4", transcript: file, debug: true }, shared: {},
  };
  const v = new Threads();
  const cx = makeCx();
  v.init(state.props, cx);
  await settle(v);
  return { v, cx };
}

export function draw(v, cx) { v.render(cx); v.report(); return v; }

export async function scripted(events) {
  const { newSession, apply } = await import("../mods/agent-threads/core/turns.js");
  const { v, cx } = await pane(fixture("--only", "1"));
  const s = newSession("00000000-0000-4000-8000-00000000000a", v.current().file);
  for (const e of events) apply(s, e);
  s.loaded = true;
  v.sessions = [s];
  return { v, cx, s };
}

// Drops the queued timers and the marks that say a frame is queued: a timer dropped with its
// mark still set would never be asked for again, and the rows would stop where they are.
export function dropTimers(v, cx) { cx.timers = []; v.shapeNext = false; v.buildNext = false; v.probeNext = false; }
// Draws until the rows are built and shaped. Rows left waiting are reshaped in the frame the
// 0 ms timer asks for (reshapeDue), as Herdr runs it: a draw alone never takes them up.
export function settleRows(v, cx) { draw(v, cx); for (let k = 0; k < 400 && (v.rowJob || v.staleRows?.length || v.shapeLeft > 0); k++) { cx.flush(0); draw(v, cx); } }

// Herdr's v_virtual_list as the pane meets it: an offset in px that new heights do not move,
// held to the list at each layout; scroll_to_item to the near edge or the middle, and
// scroll_to_bottom, each taken at the next layout; the rows on screen drawn. A wheel moves the
// list first, then the pane hears of it. Each layout is kept in frames.
export function simList(v) {
  const sim = { off: 0, ask: null, frames: [], asks: 0 };
  v.scroll = { scroll_to_item(i, how) { sim.ask = { i, how }; sim.asks++; }, scroll_to_bottom() { sim.ask = { end: true }; sim.asks++; } };
  const room = (s) => Math.max(0, s.reduce((x, y) => x + y, 0) - v.listH);
  listWindow = (n) => {
    const s = lastList.sizes;
    const pre = [0];
    for (const x of s) pre.push(pre[pre.length - 1] + x);
    let off = sim.off;
    const a = sim.ask;
    sim.ask = null;
    // As gpui-component's virtual_list.rs: scroll_to_bottom is the near edge for the last row.
    const ai = a?.end ? n - 1 : a?.i;
    if (a && ai >= 0 && ai < n) {
      const top = pre[ai];
      const bot = pre[ai + 1];
      if (a.how === "center") off = (top + bot - v.listH) / 2;
      else if (top < off) off = top;
      else if (bot > off + v.listH) off = bot - v.listH;
    }
    off = Math.max(0, Math.min(off, room(s)));
    sim.off = off;
    // The rows drawn: from the first whose bottom is past the top edge, to two past the first
    // whose bottom is past the bottom edge, or to the end.
    const past = (edge) => { let k = 0; while (k < n && pre[k + 1] <= edge) k++; return k; };
    const start = Math.min(past(off), n - 1);
    const pe = past(off + v.listH);
    const end = Math.max(start + 1, pe === n ? n : Math.min(pe + 2, n));
    sim.frames.push({ key: lastList.keys[start], into: off - pre[start], share: (off - pre[start]) / s[start], end: end >= n, off, sizes: s, keys: lastList.keys, lift: v.anchorLift ?? 0, held: Boolean(v.anchor && !v.anchor.end) });
    return { start, end };
  };
  sim.wheel = (dy) => {
    sim.off = Math.max(0, Math.min(sim.off - dy, room(lastList.sizes)));
    v.listWheel({ delta: { y: dy * v.zoom() } });
  };
  sim.last = () => sim.frames[sim.frames.length - 1];
  return sim;
}
// A frame, then the probe's parts drawn in it answered with made-up heights, as the real probe
// trickles measures in over the frames after a re-wrap.
export const fakeH = (p) => 30 + ((p.key.length * 37 + p.key.charCodeAt(p.key.length - 1) * 13) % 70);
export function probeFrame(v, cx) {
  let due = [];
  v.probeDue = function () { due = Threads.prototype.probeDue.call(this); return due; };
  try { draw(v, cx); } finally { delete v.probeDue; }
  // The timers due before the next frame run, as Herdr runs them between frames (a scroll
  // asked 16 or 48 ms on); the frame marks they would clear are cleared.
  cx.flush(120, 3);
  dropTimers(v, cx);
  for (const [p, sig] of due) v.probed(p.key, sig, { width: 300, height: fakeH(p) * v.zoom() }, cx);
  return due.length;
}
// Frames until the rows are built and shaped, the probe has measured everything, and no
// place is held; the frames each drew.
export function settleList(v, cx, sim, max = 900) {
  const from = sim.frames.length;
  for (let k = 0; k < max; k++) {
    probeFrame(v, cx);
    if (!v.rowJob && !v.staleRows?.length && !(v.shapeLeft > 0) && v.probeLeft === 0 && !v.anchor && !v.anchorLift) break;
  }
  probeFrame(v, cx);
  return sim.frames.slice(from);
}
// A pane width through the column's steps, still for long enough that it re-wraps at once.
export const stillAt = (v, w) => { v.paneW = w - 2; v.sizeAt = Date.now() - 2000; };
// The pane at w px with the rows built, measured and at the end, as a session opens.
export function openAt(v, cx, sim, w) {
  stillAt(v, w);
  settleList(v, cx, sim);
  v.jumpLatest();
  settleList(v, cx, sim);
  expect([v.follow, sim.last().end]).toEqual([true, true]);
}

// The harness's settings a test changes (an importer cannot assign an imported binding).
export const H = {
  get calls() { return calls; },
  set calls(x) { calls = x; },
  get rec() { return rec; },
  set rec(x) { rec = x; },
  get state() { return state; },
  set state(x) { state = x; },
  get log() { return log; },
  set log(x) { log = x; },
  get hcOut() { return hcOut; },
  set hcOut(x) { hcOut = x; },
  get hcBy() { return hcBy; },
  set hcBy(x) { hcBy = x; },
  get recordFiles() { return recordFiles; },
  set recordFiles(x) { recordFiles = x; },
  get focusNow() { return focusNow; },
  set focusNow(x) { focusNow = x; },
  get afterFocus() { return afterFocus; },
  set afterFocus(x) { afterFocus = x; },
  get focusCalls() { return focusCalls; },
  set focusCalls(x) { focusCalls = x; },
  get listWindow() { return listWindow; },
  set listWindow(x) { listWindow = x; },
  get lastList() { return lastList; },
  set lastList(x) { lastList = x; },
  get herdrSettings() { return herdrSettings; },
  set herdrSettings(x) { herdrSettings = x; },
  get hostPlatform() { return hostPlatform; },
  set hostPlatform(x) { hostPlatform = x; },
  get herdrVersion() { return herdrVersion; },
  set herdrVersion(x) { herdrVersion = x; },
  get marks() { return marks; },
  set marks(x) { marks = x; },
  get pinWrites() { return pinWrites; },
  set pinWrites(x) { pinWrites = x; },
  get extractCalls() { return extractCalls; },
  set extractCalls(x) { extractCalls = x; },
  get extractHook() { return extractHook; },
  set extractHook(x) { extractHook = x; },
  get keepSettings() { return keepSettings; },
  set keepSettings(x) { keepSettings = x; },
  get settingsStale() { return settingsStale; },
  set settingsStale(x) { settingsStale = x; },
};

// Helpers the render tests share: render.test.js and the topic files on this harness.
export const tooltips = (v, cx) => { H.rec = []; v.render(cx); const out = rec.filter(([n]) => n === "tooltip").map(([, x]) => x); H.rec = null; return out; };
export const svgs = (c) => c.filter((e) => e[0] === "svg").map((e) => e[1].split("/").pop());
export const keyEv = (key, extra = {}) => ({ key, modifiers: { shift: false, control: false, alt: false, platform: false, function: false }, ...extra });
export async function until(f, what, n = 400) {
  for (let i = 0; i < n; i++) { if (f()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error(`timed out waiting for ${what}`);
}
// The handler a recorded element chain set right after .id(id), or null.
export function handlerAfterId(calls, id, name) {
  for (let i = 0; i < calls.length; i++) {
    if (calls[i][0] !== "id" || calls[i][1] !== id) continue;
    for (let j = i + 1; j < calls.length && j < i + 8; j++) if (calls[j][0] === name) return calls[j].at(-1);
  }
  return null;
}
export function frame(v, cx) { H.rec = []; v.render(cx); const c = rec; H.rec = null; return c; }
export const PINS = join(app, "data/agent-threads/pins.json");
export async function pinPane(...flags) {
  delete recordFiles[PINS];
  const { v, cx } = await pane(fixture(...flags));
  await new Promise((r) => setTimeout(r, 20)); // the first read of pins.json
  return { v, cx, keys: () => v.turnKeys(v.rows()) };
}
export const saved = async () => { await new Promise((r) => setTimeout(r, 30)); return JSON.parse(recordFiles[PINS] ?? "{}"); };
export const allPins = (j) => Object.values(j.sessions ?? {}).flatMap((x) => x.pins);
export const toastText = (v) => v.toast?.text ?? null;
// Pins the turns at these indexes, in this order, then shows the Pinned view in this pane.
export async function pinsShown(fixtureFlags, order, width = 400) {
  const { v, cx, keys } = await pinPane(...fixtureFlags);
  const k = keys();
  for (const i of order) { v.sel = k[i]; v.action("pin", cx); }
  v.width = width;
  v.key(keyEv("v"), cx); // under 480 px, v shows Pinned in this pane
  expect(v.view).toBe("pinned");
  return { v, cx, k };
}
export const compactPins = (v) => v.rows().filter((r) => r.kind === "turn");
export const itemWords = (v, r) => { H.rec = []; v.item(theme, r, true, v.height(r)); const c = rec; H.rec = null; return c; };
// The list as gpui draws it with only the rows from start to end on screen.
export function drawRange(v, start, end) {
  const rows = v.rows();
  v.listItems(theme, rows, v.slotsMemo ?? rows.map(() => 40), { start, end: end ?? rows.length }, true, false);
}
// A frame with the person's scroll before it: the same rows, the top row moved.
export function scrolled(v, start, end) { drawRange(v, start, end); }
export const ownOf = (c, id) => { const at = c.findIndex((e) => e[0] === "id" && e[1] === id); let end = c.findIndex((e, j) => j > at && e[0] === "id"); if (end < 0) end = c.length; return c.slice(at, end); };
