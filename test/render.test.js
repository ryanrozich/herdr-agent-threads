// bun test: runs the panel's drawing code with gpui-kit and Herdr replaced by stubs, so an
// error in render() fails here instead of in a window. Every element method returns the same
// chainable stub; .when() and .hover() run their callbacks, and the virtual list draws every
// item. The pane reads synthetic fixtures through the real extractor (exec runs it).
import { test, expect, mock } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync, utimesSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { stats, segments, reply, fmtTime as fmtTimeForTest } from "../mods/agent-threads/core/turns.js";
import { join } from "node:path";
import { pinRowHeight, senderLabel, stripLayout, railDay, railSwell, RAIL, contrast } from "../mods/agent-threads/ui.js";
import { turnIds } from "../mods/agent-threads/pins.js";

const root = join(import.meta.dir, "..");
const modDir = join(root, "mods/agent-threads");
const app = mkdtempSync(join(tmpdir(), "threads-render-"));

let calls = 0;
// With rec set, every element method call is recorded as [name, ...args].
let rec = null;
const el = new Proxy(() => {}, {
  get(_t, name) {
    if (name === "then") return undefined;
    if (name === "when") return (cond, fn) => { if (cond) fn(el); return el; };
    if (name === "hover") return (fn) => { fn(el); return el; };
    return (...args) => { calls++; if (rec) rec.push([String(name), ...args]); for (const a of args) if (a === undefined) throw new Error(`undefined passed to .${String(name)}()`); return el; };
  },
  apply() { return el; },
});
const theme = {
  background: "#1e1e1e", foreground: "#e6e6e6", muted: "#a0a0a0", dim: "#777777", border: "#333333", raised: "#262626",
  chrome: "#202020", hover: "#2c2c2c", selected: "#2a2d3a", accent: "#4f8cff", popover: "#2a2a2a", working: "#d7a000",
  blocked: "#e05050", done: "#40b060", ansi1: "#e06c75", ansi2: "#98c379", ansi3: "#e5c07b", ansi4: "#61afef",
  ansi5: "#c678dd", ansi6: "#56b6c2",
};
let state = { panes: [], terminals: [], props: {}, shared: {} };
// What the pane did through Herdr: run() calls, the clipboard, and hc get's answer.
let log = [];
let hcOut = JSON.stringify({ foreground: { name: "claude", argv: ["claude"], pid: 42 } });
// hc get's answer per terminal, and session records by path, for the binding tests.
let hcBy = {};
let recordFiles = {};
let focusNow = null;
let afterFocus = (args) => { focusNow = { terminal: state.panes.find((p) => p.pane === args?.pane)?.terminal ?? null }; };
const mdSources = [];
// Overlays the mod opened (the image gallery).
const overlays = [];
const closed = [];
// Every TextView made, with the calls on it (scrollable, size_full, …).
const views = [];
function viewEl(calls) {
  const p = new Proxy(() => {}, {
    get(_t, name) {
      if (name === "then") return undefined;
      if (name === "when") return (cond, fn) => { if (cond) fn(p); return p; };
      return (...args) => { calls.push([String(name), ...args]); return p; };
    },
  });
  return p;
}
const editors = [];
// Plain scroll handles made (the image viewer's panel), with the children each was asked to reveal.
const scrollHandles = [];
let focusCalls = 0;
const never = () => new Promise(() => {});
// The items the virtual list draws, as Herdr does for what is on screen: all of them unless a
// test sets this (n) => { start, end }.
let listWindow = null;
// What the last v_virtual_list was given: its sizes and item keys.
let lastList = null;
// settings(): the person's Herdr settings (zoom, fonts).
let herdrSettings = { font_family: "Mono" };
// What Herdr's window() reports as the platform (round 6 face).
let hostPlatform = "linux";
// updates().app.version: Herdr's version.
let herdrVersion = "0.1.13";
// Reads of Herdr's settings, panes and terminals, for the draw-time guard.
const hostReads = { settings: 0, panes: 0, terminals: 0 };
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
    lastList = { sizes: [...sizes], keys: [], draw };
    for (let i = 0; i < n; i++) { if (!(sizes[i] > 0)) throw new Error(`item ${keyOf(i)} has height ${sizes[i]}`); lastList.keys.push(keyOf(i)); }
    draw(listWindow ? listWindow(n) : { start: 0, end: n });
    return el;
  },
  TextView: { html: (id, html) => { const calls = []; views.push({ id, html, calls }); if (rec) rec.push(["TextView", id]); return viewEl(calls); }, markdown: (id, md) => { mdSources.push([id, md]); const calls = []; views.push({ id, md, calls }); if (rec) rec.push(["TextView", id]); return viewEl(calls); } }, Editor: { new: () => el }, EditorState: { new: (opts) => { const st = { opts, handlers: {}, release() {}, on(ev, f) { st.handlers[ev] = f; return true; } }; editors.push(st); return st; } },
}));
// With marks set, exec records when the script hands off ("out") and gets its answer back
// ("in"), so a test can time the synchronous stretches between awaits.
let marks = null;
const stamp = (what) => { if (marks) marks.push([what, performance.now()]); };
mock.module("herdr", () => ({
  exec: async (cmd, args) => {
    // A link the pane opens is logged, never opened.
    if (cmd === "open") { log.push(["open", ...args]); return { code: 0, stdout: "", stderr: "" }; }
    stamp("out");
    try { return execReal(cmd, args); } finally { stamp("in"); }
  },
  hc: async (args) => { log.push(["hc", ...args]); return { code: 0, stdout: hcBy[args[1]] ?? hcOut, stderr: "" }; },
  ...herdrRest(),
}));
let pinWrites = 0;
// What the pane wrote to settings.json (the viewer keeps its panel choice there). With
// keepSettings set, a write is also what the next read finds, as on disk.
const settingsWrites = [];
let keepSettings = false;
// With settingsStale set, a settings write whose expected text is not what the file holds is
// rejected, as Herdr rejects a stale snapshot.
let settingsStale = false;
// A script that has not ended in 4 s is killed with everything it started, and the call fails
// with a line naming it: a hung child ends before bun's 5 s test limit kills it as a dangling
// process, which says nothing of which call it was (once in CI). The script runs in a process
// group of its own under this perl, which kills the group: a timeout on the call alone stops
// only sh, and the extractor's sh waits for its pipeline before it heeds a TERM.
const EXEC_LIMIT_S = 4;
const EXEC_GUARD = `my $s = shift; my $late = 0;
my $pid = fork() // die "fork: $!";
if (!$pid) { setpgrp(0, 0); exec { $ARGV[0] } @ARGV; exit 127 }
$SIG{ALRM} = sub { $late = 1; kill "KILL", -$pid; kill "KILL", $pid };
alarm $s; waitpid($pid, 0); my $st = $?; alarm 0;
exit 124 if $late;
exit($st & 127 ? 128 + ($st & 127) : $st >> 8);`;
function execReal(cmd, args) {
    const opts = { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"], timeout: (EXEC_LIMIT_S + 2) * 1000 };
    try { return { code: 0, stdout: execFileSync("perl", ["-e", EXEC_GUARD, String(EXEC_LIMIT_S), cmd, ...args], opts), stderr: "" }; }
    catch (e) {
      if (e.status === 124 || e.code === "ETIMEDOUT") console.error(`exec: ${cmd} ${args.join(" ")} ran past ${EXEC_LIMIT_S} s and was killed`);
      return { code: e.status ?? 1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
    }
}
function herdrRest() { return {
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
const { default: Threads } = await import("../mods/agent-threads/main.js");
const { thumbSize, tileRow, bubbleMax, ROW, columnWidth, railLook, rowHeight, MD_MAX, alpha: alphaForTest, dayKey } = await import("../mods/agent-threads/ui.js");

function fixture(...flags) {
  const dir = mkdtempSync(join(tmpdir(), "threads-fx-"));
  const file = join(dir, "f.jsonl");
  execFileSync("bun", [join(root, "test/make-fixture.js"), file, "00000000-0000-4000-8000-000000000009", "/tmp/threads-demo", ...flags], { stdio: "ignore" });
  return file;
}

function makeCx() {
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
    clip: null,
    write_to_clipboard(t) { cx.clip = t; log.push(["clipboard", t]); },
    read_from_clipboard() { return cx.clip ?? undefined; },
    open_url(u) { log.push(["open_url", u]); },
  };
  return cx;
}
// The watch and command loops never end, so wait for the read itself.
async function settle(v, tries = 200) {
  for (let i = 0; i < tries; i++) {
    if (v.current()?.loaded && !v.reading && !v.resolving && v.prefsLoaded) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("the pane never finished reading");
}

async function pane(file) {
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

function draw(v, cx) { v.render(cx); v.report(); return v; }

test("every state draws at 240 and 380 px, agents on and off, every card open", { timeout: 30000 }, async () => {
  const { v, cx } = await pane(fixture("--extra", "3", "--agents", "--commands", "--latest", "--skill", "--notify", "--langs", "--long"));
  const s = v.current();
  expect(s.loaded).toBe(true);
  expect(s.turns.length).toBeGreaterThan(20);
  for (const width of [240, 380]) {
    v.width = width;
    for (const agents of [false, true]) {
      v.prefs = { ...v.prefs, agentTurns: agents };
      draw(v, cx);
      // every turn open at once, with the whole prompt, reply and latest update
      v.open = new Set(s.turns.map((t) => `0:${t.n}`));
      draw(v, cx);
      v.full = new Set(s.turns.flatMap((t) => [`0:${t.n}`, `l:0:${t.n}`]));
      draw(v, cx);
      v.open.clear(); v.full.clear();
      v.settingsOpen = true; draw(v, cx); v.settingsOpen = false;
      v.query = "review"; draw(v, cx); v.query = "";
      v.toast = { text: "Focused t4 · Claude Code", icon: "square-terminal", at: 1 }; draw(v, cx); v.toast = null;
    }
  }
  const snap = state.shared["threads.debug"].t4;
  expect(snap.detail.some((d) => d.includes("agent:hc:t7 review"))).toBe(true);
  expect(snap.detail.some((d) => d.includes("cmd:/review-pr"))).toBe(true);
  expect(calls).toBeGreaterThan(1000);
});

test("the all-hidden empty state and a running agent turn draw", async () => {
  const { v, cx } = await pane(fixture("--only", "0", "--agents", "--open"));
  v.prefs = { ...v.prefs, agentTurns: false };
  draw(v, cx);
  expect(v.rows().some((r) => r.kind === "wrow" || r.kind === "working")).toBe(true); // the running turn shows
  v.sel = null; v.fitKey = null; draw(v, cx);
  expect(v.rows().some((r) => r.kind === "wrow")).toBe(true);
  const { v: w, cx: wx } = await pane(fixture("--only", "0", "--agents"));
  // drop the person's own turns, and the agents' replies (an agent turn with a reply of its own
  // stays, its message folded): every turn hidden
  w.current().turns = w.current().turns.filter((t) => t.agent);
  for (const t of w.current().turns) t.after = [];
  w.current().version++;
  draw(w, wx);
  expect(w.turnKeys(w.rows()).length).toBe(0);
  expect(w.counts().hiddenAll).toBeGreaterThan(0);
});

test("focusTerminal targets the pane by id and says so", async () => {
  const { v, cx } = await pane(fixture("--only", "2"));
  v.focusTerminal(cx);
  expect(v.lastFocus.args).toEqual({ pane: "p1" });
  expect(v.toast.text).toBe("Focused t4 · Claude Code");
  state.terminals = [];
  v.focusTerminal(cx);
  expect(v.lastFocus.result).toBe("closed");
  expect(v.toast.text).toBe("t4 is closed");
});

test("the strip under the reply is copy and quote, and acts only on each icon", async () => {
  const { v } = await pane(fixture("--only", "2"));
  v.sel = v.turnKeys(v.rows())[0];
  v.width = 380;
  // Copy 12–34, Quote 38–60, at any width. No select or terminal icon: s and t are keys.
  expect(v.barHit(20)).toBe("copy");
  expect(v.barHit(50)).toBe("quote");
  expect(v.barHit(75)).toBe(null);
  expect(v.barHit(100)).toBe(null);
  v.width = 240;
  expect(v.barHit(50)).toBe("quote");
  expect(v.barHit(100)).toBe(null);
  const icons = () => { rec = []; v.actsStrip(theme, v.findTurn(v.sel), v.sel, true); const c = rec; rec = null; return c.filter((e) => e[0] === "svg").map((e) => String(e[1]).split("/").pop()); };
  expect(icons()).toEqual(["copy.svg", "quote.svg"]);
  // Before Herdr 0.1.13 the formatted reply cannot be selected, so the select icon stays,
  // after quote, as the way there by mouse.
  const was = herdrVersion;
  try {
    herdrVersion = "0.1.12"; v.selectableMemo = null;
    expect(v.barHit(75)).toBe("select");
    expect(v.barHit(100)).toBe(null);
    expect(icons()).toEqual(["copy.svg", "quote.svg", "text-cursor.svg"]);
    // No pane shows the terminal: no Quote, so Select moves up beside Copy.
    state.panes = state.panes.filter((p) => p.terminal !== "t4");
    expect(v.barHit(50)).toBe("select");
    expect(v.barHit(75)).toBe(null);
  } finally { herdrVersion = was; v.selectableMemo = null; }
  expect(icons()).toEqual(["copy.svg"]);
  expect(readFileSync(join(modDir, "main.js"), "utf8")).toContain("barHit");
});

test("Select text swaps the formatted reply for a selectable source view, and back", async () => {
  const { v, cx } = await pane(fixture("--only", "2"));
  v.width = 380;
  const key = v.turnKeys(v.rows())[0];
  v.sel = key;
  expect(v.action("select", cx)).toBe(true);
  expect(v.selecting).toBe(key);
  let kinds = v.rows().map((r) => r.kind);
  expect(kinds).toContain("seltext");
  expect(kinds).not.toContain("md");
  // Herdr 0.1.13 and later: the strip has no select icon, s is the way in.
  expect(v.rowDetail(v.rows().find((r) => r.kind === "copy"))).not.toContain("select");
  expect(v.action("escape", cx)).toBe(true);
  expect(v.selecting).toBe(null);
  kinds = v.rows().map((r) => r.kind);
  expect(kinds).toContain("md");
  expect(kinds).not.toContain("seltext");
  // Closing the card ends it too.
  v.action("select", cx);
  v.toggle(key, cx);
  expect(v.selecting).toBe(null);
  // s returns from Select view even after ↓ moved the selection to another turn, and
  // opens no other turn.
  v.action("select", cx);
  expect(v.selecting).toBe(key);
  const openBefore = [...v.open].sort();
  v.action("next", cx);
  expect(v.sel).not.toBe(key);
  expect(v.action("select", cx)).toBe(true);
  expect(v.selecting).toBe(null);
  expect([...v.open].sort()).toEqual(openBefore);
  expect(v.rows().map((r) => r.kind)).not.toContain("seltext");
});

test("a press in the Select view keeps the editor's selection: the panel does not take the keyboard", async () => {
  const { v, cx } = await pane(fixture("--only", "2"));
  v.width = 380;
  const key = v.turnKeys(v.rows())[0];
  v.sel = key;
  v.action("select", cx);
  const st = editors.at(-1);
  expect(typeof st.handlers.focus).toBe("function");
  st.handlers.focus();
  expect(v.editorFocused).toBe(true);
  const before = focusCalls;
  v.sel = null;
  v.click(`sx:${key}`, cx);
  // A press in an editor still selects the card (c, q and s act on it), and keeps focus (F6).
  expect(v.sel).toBe(key);
  // A code block with an editor: the same.
  v.code.set(`${key}:1`, { st: { release() {} }, text: "x" });
  v.sel = null;
  v.click(`code:${key}:1`, cx);
  expect(v.sel).toBe(key);
  expect(focusCalls).toBe(before);
  // A code block drawn as plain text (its highlighter failed) has no editor: the panel takes
  // the keyboard and selects the card.
  v.code.set(`${key}:1`, { st: false, text: "x" });
  v.sel = null;
  v.click(`code:${key}:1`, cx);
  expect(v.sel).toBe(key);
  expect(focusCalls).toBe(before + 1);
  v.code.delete(`${key}:1`);
  // A click on another part of the list still takes the keyboard back.
  v.click(`it:${key}:0`, cx);
  expect(focusCalls).toBe(before + 2);
  st.handlers.blur();
  expect(v.editorFocused).toBe(false);
  v.action("escape", cx);
  expect(v.selecting).toBe(null);
});

// F3: the selected running turn's working card is sized with the line heights it draws.
test("the working card's estimate uses the YOU part it draws and the 20 px note lines", async () => {
  const { v } = await pane(fixture("--only", "0", "--agents", "--open"));
  v.prefs = { ...v.prefs, bubbleColor: "plain" }; // Markdown in the message: the plain look
  let seen = 0;
  for (const width of [240, 380, 640]) {
    v.width = width;
    v.fitKey = null;
    const r = v.rows().find((x) => x.kind === "working");
    if (!r) continue;
    seen++;
    const est = v.estimate(r);
    // The smallest it can be: padding, the message's bubble (one line), the strip under it,
    // the live line, one note line, padding.
    expect(est).toBeGreaterThanOrEqual(8 + 16 + 22 + 6 + 16 + 6 + 24 + 6 + 20 + 10);
    // The message is the open turn's YOU part (its estimate until the probe measures it); each
    // note line counts 20 px.
    const g = v.workingGeom(r.turn, r.shape);
    expect(est).toBe(8 + v.youHeight(v.workYou(r)) + 6 + 16 + 6 + 24 + 6 + g.note * 20 + 10);
    rec = [];
    v.workingItem(theme, r);
    const lh = rec.filter(([n]) => n === "line_height").map(([, x]) => x);
    // The message is the YOU part's TextView; the note sets 20 px lines.
    expect(rec).toContainEqual(["TextView", `th-you-wyou:${r.key}`]);
    rec = null;
    expect(lh).toContain("20px");
  }
  expect(seen).toBe(3);
});

// R3-2: a code block's box is 20 px a line, and sets that line height for its editor.
test("a code block's box and estimate use 20 px lines, and the box sets that line height", async () => {
  const { v } = await pane(fixture("--only", "2", "--langs"));
  v.width = 380;
  const key = v.turnKeys(v.rows()).find((k) => { v.open = new Set([k]); v.fitKey = null; return v.rows().some((r) => r.kind === "code"); });
  expect(key).toBeTruthy();
  const r = v.rows().find((x) => x.kind === "code");
  expect(v.codeBoxH(r)).toBe(r.shown * 20 + 16 + (r.wide ? 10 : 0));
  expect(v.estimate(r)).toBe(v.codeBoxH(r) + (r.caption ? 24 : 0));
  rec = [];
  v.partContent(theme, r, false);
  const calls = rec;
  rec = null;
  const at = calls.findIndex(([n, x]) => n === "h" && x === v.codeBoxH(r));
  expect(at).toBeGreaterThanOrEqual(0);
  expect(calls.slice(at, at + 12).some(([n, x]) => n === "line_height" && x === "20px")).toBe(true);
});

// R3-1: the probe is hidden by a zero-height clip and opacity 0, not invisible(), so a
// size report made at paint still comes.
test("the probe is clipped and transparent, never invisible()", async () => {
  const { v, cx } = await pane(fixture("--only", "2"));
  v.width = 380;
  const key = v.turnKeys(v.rows())[0];
  v.toggle(key, cx);
  rec = [];
  v.render(cx);
  const calls = rec;
  rec = null;
  expect(calls.some(([n]) => n === "invisible")).toBe(false);
  const i = calls.findIndex(([n, x]) => n === "id" && String(x).startsWith("th-probe-"));
  expect(i).toBeGreaterThan(0);
  const before = calls.slice(Math.max(0, i - 40), i).map(([n, x]) => `${n}:${typeof x === "number" || typeof x === "string" ? x : ""}`);
  expect(before).toContain("opacity:0");
  expect(before).toContain("h:0");
});

// A session built from extractor events, put in place of the fixture's.
async function scripted(events) {
  const { newSession, apply } = await import("../mods/agent-threads/core/turns.js");
  const { v, cx } = await pane(fixture("--only", "1"));
  const s = newSession("00000000-0000-4000-8000-00000000000a", v.current().file);
  for (const e of events) apply(s, e);
  s.loaded = true;
  v.sessions = [s];
  return { v, cx, s };
}
const at = (m) => `2026-11-01T09:${String(m).padStart(2, "0")}:00.000Z`;
const peer = (text) => `<teammate-message teammate_id="helper-a" color="blue" summary="x">${text}</teammate-message>`;

test("a live agent turn that finishes while hidden hands the selection back (F1)", async () => {
  const { v, cx, s } = await scripted([
    { k: "p", o: "human", t: "Rename the cart helper", ts: at(0) }, { k: "t", t: "Renamed." }, { k: "d", ms: 1000, ts: at(1) },
    { k: "p", o: "peer", t: peer("Tests are green on helper-a"), ts: at(2) },
  ]);
  v.prefs = { ...v.prefs, agentTurns: false };
  v.follow = true;
  v.jumpLatest(true);
  expect(v.sel).toBe("0:2"); // the live agent turn shows while it runs
  // It ends with no reply of its own (with one it would stay, its message folded).
  const { apply } = await import("../mods/agent-threads/core/turns.js");
  apply(s, { k: "d", ms: 500, ts: at(3) });
  draw(v, cx);
  expect(v.turnKeys(v.rows())).toEqual(["0:1"]);
  expect(v.sel).toBe("0:1");
  // A selection forced back onto the hidden turn copies and opens nothing.
  let copied = null;
  cx.write_to_clipboard = (t) => { copied = t; };
  v.sel = "0:2";
  v.copyReply("0:2", cx);
  expect(copied).toBe(null);
  v.action("open", cx);
  expect(v.open.has("0:2")).toBe(false);
});

test("a prompt answered together with a hidden agent message borrows its reply (F2)", async () => {
  const { v, cx } = await scripted([
    { k: "p", o: "human", t: "Summarise the failing test", ts: at(0) },
    { k: "p", o: "peer", t: peer("Also check cart.ts"), ts: at(1) },
    { k: "t", t: "The test fails because cart.ts rounds early. Both fixed." },
    { k: "d", ms: 2000, ts: at(2) },
  ]);
  const t1 = v.current().turns[0];
  expect(t1.answeredBy).toBe(2);
  v.prefs = { ...v.prefs, agentTurns: false };
  draw(v, cx);
  expect(v.turnKeys(v.rows())).toEqual(["0:1"]);
  expect(v.shape(t1).reply.join(" ")).toContain("rounds early");
  expect(v.captionParts(t1).some(([, x]) => x === "shared with agent message #2 from helper-a")).toBe(true);
  let copied = null;
  cx.write_to_clipboard = (t) => { copied = t; };
  v.copyReply("0:1", cx);
  expect(copied).toContain("rounds early");
  v.open = new Set(["0:1"]); draw(v, cx);
  expect(v.rows().some((r) => r.kind === "md" && r.md.includes("rounds early"))).toBe(true);
  // With agent messages shown the reply stays on the agent row, and the row points there.
  v.open.clear();
  v.prefs = { ...v.prefs, agentTurns: true };
  draw(v, cx);
  expect(v.shape(t1).reply.join(" ")).toBe("Answered together with #2");
});

test("an agent turn with a reply of its own shows while agent messages are hidden, its message folded to one line", async () => {
  const { v, cx } = await scripted([
    { k: "p", o: "human", t: "Rename the cart helper", ts: at(0) }, { k: "t", t: "Renamed." }, { k: "d", ms: 1000, ts: at(1) },
    // A teammate's message, then a reply the person must see.
    { k: "p", o: "peer", t: peer("Tests are green on helper-a"), ts: at(2) }, { k: "t", t: "Good. The release note needs one more line." }, { k: "d", ms: 800, ts: at(3) },
    // One with no reply of its own stays hidden.
    { k: "p", o: "peer", t: peer("Done here"), ts: at(4) }, { k: "d", ms: 200, ts: at(5) },
  ]);
  v.prefs = { ...v.prefs, agentTurns: false };
  draw(v, cx);
  expect(v.turnKeys(v.rows())).toEqual(["0:1", "0:2"]);
  const rows = v.rows();
  const i = rows.findIndex((r) => r.kind === "turn" && r.key === "0:2");
  // The one line over the row, then the row without the sender or the message.
  expect(rows[i - 1]).toMatchObject({ kind: "afold", key: "af:0:2", turnKey: "0:2", fold: "folded" });
  expect(rows[i].fold).toBe("folded");
  const sh = rows[i].shape;
  expect(v.height(rows[i])).toBe(sh.height - v.foldCut(rows[i]));
  expect(v.foldCut(rows[i])).toBeGreaterThan(sh.p * v.rt().line);
  expect(v.height(rows[i - 1])).toBe(8 + 16);
  const detail = state.shared["threads.debug"].t4.detail;
  expect(detail.some((d) => d.startsWith("afold#2 folded helper-a"))).toBe(true);
  // The counts: one folded, one hidden; the chip's number is both.
  expect(v.counts()).toMatchObject({ foldedAll: 1, hiddenAll: 1 });
  const chip = v.headerButtons().find((b) => b[0] === "th-agents");
  expect(chip[2]).toBe("Show agent messages (1 folded, 1 hidden) (a)");
  // A press on the line shows the message under it, and another folds it again.
  v.click("af:0:2", cx);
  draw(v, cx);
  expect(v.sel).toBe("0:2");
  let r2 = v.rows().find((r) => r.kind === "turn" && r.key === "0:2");
  expect(r2.fold).toBe("shown");
  expect(v.height(r2)).toBe(r2.shape.height - 8 - 16);
  v.click("af:0:2", cx);
  draw(v, cx);
  r2 = v.rows().find((r) => r.kind === "turn" && r.key === "0:2");
  expect(r2.fold).toBe("folded");
  // Open: the line over the reply, and no message part while folded.
  v.open = new Set(["0:2"]);
  draw(v, cx);
  const open = v.rows().filter((r) => r.si === 0 && r.turn?.n === 2).map((r) => r.kind);
  expect(open.slice(0, 2)).toEqual(["head", "afold"]);
  expect(open.includes("you")).toBe(false);
  v.click("af:0:2", cx);
  draw(v, cx);
  expect(v.rows().some((r) => r.kind === "you" && r.turn.n === 2)).toBe(true);
  v.open.clear();
  // A search draws the message whole, so its matches can be seen.
  v.query = "green";
  draw(v, cx);
  expect(v.rows().some((r) => r.kind === "afold")).toBe(false);
  expect(v.turnKeys(v.rows())).toEqual(["0:2"]);
  v.query = "";
  // With agent messages shown (a), every agent message is whole, with no line.
  v.prefs = { ...v.prefs, agentTurns: true };
  draw(v, cx);
  expect(v.rows().some((r) => r.kind === "afold" || r.fold)).toBe(false);
  expect(v.turnKeys(v.rows())).toEqual(["0:1", "0:2", "0:3"]);
});

test("an agent turn whose reply is shared with the person's prompt stays hidden: the person's row has the reply", async () => {
  const { v, cx } = await scripted([
    { k: "p", o: "human", t: "Summarise the failing test", ts: at(0) },
    { k: "p", o: "peer", t: peer("Also check cart.ts"), ts: at(1) },
    { k: "t", t: "The test fails because cart.ts rounds early. Both fixed." },
    { k: "d", ms: 2000, ts: at(2) },
  ]);
  v.prefs = { ...v.prefs, agentTurns: false };
  draw(v, cx);
  expect(v.turnKeys(v.rows())).toEqual(["0:1"]);
  expect(v.counts()).toMatchObject({ foldedAll: 0, hiddenAll: 1 });
});

// Sender rules (settings.json senders): typed prompts that are really agents' messages.
// Made-up names and text.
const HOURLY = "build-bot hourly 2026-11-18T01:47:20Z: 3 merged, open 32; nothing needs you.";
const FROM = "From release-checker: two links in the changelog are dead";
const SENDERS = { senders: [{ name: "Hourly report", prefix: "{name} hourly" }, { prefix: "From {name}:" }] };
const senderEvents = () => [
  { k: "p", o: "human", t: "Rename the cart helper", ts: at(0) }, { k: "t", t: "Renamed." }, { k: "d", ms: 1000, ts: at(1) },
  // The hourly report, with a reply of its own: folded once a rule marks it.
  { k: "p", o: "human", t: HOURLY, ts: at(2) }, { k: "t", t: "Noted, nothing to do." }, { k: "d", ms: 800, ts: at(3) },
  // The From message, with no reply: hidden once a rule marks it.
  { k: "p", o: "human", t: FROM, ts: at(4) }, { k: "d", ms: 200, ts: at(5) },
];
const tooltips = (v, cx) => { rec = []; v.render(cx); const out = rec.filter(([n]) => n === "tooltip").map(([, x]) => x); rec = null; return out; };

test("with no sender rules nothing changes: typed prompts stay the person's", async () => {
  const { v, cx } = await scripted(senderEvents());
  v.applyPrefs("{}");
  draw(v, cx);
  expect(v.turnKeys(v.rows())).toEqual(["0:1", "0:2", "0:3"]);
  expect(v.rows().some((r) => r.kind === "afold")).toBe(false);
  expect(v.current().turns.every((t) => !t.agent)).toBe(true);
  expect(v.counts()).toMatchObject({ agentAll: 0, foldedAll: 0, hiddenAll: 0 });
  expect(v.settingsLine()).toBe("Link rules · 0 · Quote key · q");
  expect(v.sendersVer).toBe(0);
});

test("a typed prompt a sender rule matches folds, hides and counts as an agent message, and the rule is named", async () => {
  const { v, cx } = await scripted(senderEvents());
  v.prefs = { ...v.prefs, agentTurns: false };
  draw(v, cx);
  expect(v.turnKeys(v.rows())).toEqual(["0:1", "0:2", "0:3"]);
  const ver = v.current().version;
  // Rules arrive after the rows were built: the turns are marked again and the rows follow.
  v.applyPrefs(JSON.stringify(SENDERS));
  expect(v.current().version).toBe(ver + 1);
  draw(v, cx);
  expect(v.turnKeys(v.rows())).toEqual(["0:1", "0:2"]);
  const rows = v.rows();
  const i = rows.findIndex((r) => r.kind === "turn" && r.key === "0:2");
  expect(rows[i - 1]).toMatchObject({ kind: "afold", key: "af:0:2", fold: "folded" });
  const detail = state.shared["threads.debug"].t4.detail;
  expect(detail.some((d) => d.startsWith("afold#2 folded build-bot · agent message rule1"))).toBe(true);
  expect(v.counts()).toMatchObject({ agentAll: 2, foldedAll: 1, hiddenAll: 1 });
  expect(v.headerButtons().find((b) => b[0] === "th-agents")[2]).toBe("Show agent messages (1 folded, 1 hidden) (a)");
  expect(v.settingsLine()).toBe("Link rules · 0 · Sender rules · 2 · Quote key · q");
  // Which rule: the folded line's tooltip names it.
  expect(v.ruleTip(v.current().turns[1])).toBe("Marked by sender rule 1 · Hourly report");
  expect(tooltips(v, cx)).toContain("Marked by sender rule 1 · Hourly report");
  // Shown whole (a), the sender line over the message carries the same tooltip.
  v.prefs = { ...v.prefs, agentTurns: true };
  draw(v, cx);
  expect(v.turnKeys(v.rows())).toEqual(["0:1", "0:2", "0:3"]);
  expect(state.shared["threads.debug"].t4.detail.some((d) => d.includes("agent:peer:release-checker"))).toBe(true);
  expect(tooltips(v, cx)).toContain("Marked by sender rule 2 · From {name}:");
  v.prefs = { ...v.prefs, agentTurns: false };
  // In Pinned: a pinned rule-marked turn carries its sender like any agent message.
  v.sel = "0:2";
  v.action("pin", cx);
  v.setView("pinned");
  rec = [];
  v.render(cx);
  const kids = rec.filter(([n]) => n === "child").map(([, x]) => x);
  rec = null;
  expect(v.rows().find((r) => r.key === "0:2")?.turn.agent).toBe(true);
  expect(kids).toContain("build-bot · agent message");
  v.setView("all");
  // The rules removed: every turn is the person's again, with no stale row kept.
  v.applyPrefs("{}");
  draw(v, cx);
  expect(v.turnKeys(v.rows())).toEqual(["0:1", "0:2", "0:3"]);
  expect(v.rows().some((r) => r.kind === "afold")).toBe(false);
  expect(v.counts()).toMatchObject({ agentAll: 0, foldedAll: 0, hiddenAll: 0 });
  expect(v.shape(v.current().turns[1]).blank).toBeFalsy();
});

test("every place that draws an agent message can tell a rule-marked typed prompt from one another agent sent", async () => {
  const { senderOrigin } = await import("../mods/agent-threads/ui.js");
  // Two messages from helper-a: one typed in the terminal and marked by the "From {name}:"
  // rule, one helper-a really sent. Today both draw alike; the mark for the first is not
  // chosen yet, so what is checked is that each place has the fact to draw it from.
  const { v, cx } = await scripted([
    { k: "p", o: "human", t: "Rename the cart helper", ts: at(0) }, { k: "t", t: "Renamed." }, { k: "d", ms: 1000, ts: at(1) },
    { k: "p", o: "human", t: "From helper-a: the cart tests are green", ts: at(2) }, { k: "t", t: "Thanks." }, { k: "d", ms: 500, ts: at(3) },
    { k: "p", o: "peer", t: peer("The cart tests are green"), ts: at(4) }, { k: "t", t: "Thanks again." }, { k: "d", ms: 500, ts: at(5) },
  ]);
  v.applyPrefs(JSON.stringify(SENDERS));
  v.prefs = { ...v.prefs, agentTurns: true };
  draw(v, cx);
  const [you, typed, sent] = v.current().turns;
  expect([you, typed, sent].map((t) => senderOrigin(t.sender))).toEqual(["you", "rule", "sent"]);
  // The same words over both bubbles today.
  expect(senderLabel(typed.sender, 400)).toBe(senderLabel(sent.sender, 400));
  // Open header and closed rows: the debug list says which.
  v.open = new Set(["0:2", "0:3"]);
  draw(v, cx);
  const detail = () => state.shared["threads.debug"].t4.detail;
  expect(detail().some((d) => d.startsWith("head#2") && d.includes("agent:peer:helper-a") && d.endsWith("from:rule"))).toBe(true);
  expect(detail().some((d) => d.startsWith("head#3") && d.includes("agent:peer:helper-a") && d.endsWith("from:sent"))).toBe(true);
  // The viewer's copy of a turn keeps it.
  expect([v.viewerTurn(you).origin, v.viewerTurn(typed).origin, v.viewerTurn(sent).origin]).toEqual(["you", "rule", "sent"]);
  // The rail: its turns (every tick is made from one) and the card a tick opens. The rail
  // shows from 700 px; the ticks drawn are only those in its window.
  v.width = 700;
  draw(v, cx);
  const entry = (n) => v.railTurns.find((x) => x.turn.n === n);
  expect([senderOrigin(entry(2).turn.sender), senderOrigin(entry(3).turn.sender)]).toEqual(["rule", "sent"]);
  const card = (n) => v.railCard({ turns: [entry(n)], live: false, pinned: false });
  expect([card(2).origin, card(3).origin]).toEqual(["rule", "sent"]);
  // Folded rows (agent messages hidden) and search rows hold the turn itself.
  v.open = new Set();
  v.prefs = { ...v.prefs, agentTurns: false };
  draw(v, cx);
  expect(detail().some((d) => d.startsWith("afold#2") && d.includes(" rule2"))).toBe(true);
  expect(detail().some((d) => d.startsWith("afold#3") && !d.includes(" rule"))).toBe(true);
  v.prefs = { ...v.prefs, agentTurns: true };
  v.setQuery("cart tests", cx);
  draw(v, cx);
  const found = v.rows().filter((r) => r.turn && r.kind === "turn");
  expect(found.map((r) => senderOrigin(r.turn.sender))).toEqual(["rule", "sent"]);
  v.setQuery("", cx);
  // Pinned: a pinned turn is drawn from the turn, so it carries the same fact.
  for (const k of ["0:2", "0:3"]) { v.sel = k; v.action("pin", cx); }
  v.setView("pinned");
  draw(v, cx);
  expect(v.rows().filter((r) => r.turn).map((r) => senderOrigin(r.turn.sender))).toEqual(["rule", "sent"]);
  v.setView("all");
});

test("a sender rule that is not valid shows a note in the panel and is ignored", async () => {
  const { v, cx } = await scripted(senderEvents());
  v.applyPrefs(JSON.stringify({ senders: [{ pattern: "^(?<sender>(a+)+)!" }, { pattern: "^From (\\w+):" }] }));
  expect(v.prefsNotes).toEqual(["Sender rule 1: nested quantifier, as in (a+)+", "Sender rule 2: pattern has no (?<sender>...) group"]);
  expect(v.settingsLine()).toBe("Link rules · 0 · Sender rules · 2 (2 not valid) · Quote key · q");
  expect(v.current().turns.every((t) => !t.agent)).toBe(true);
  // The card shows them where it shows notes the Link rules page cannot place on a rule.
  v.settingsOpen = true;
  v.setPage = "links";
  rec = [];
  v.render(cx);
  const kids = rec.filter(([n]) => n === "child").map(([, x]) => x);
  rec = null;
  expect(kids).toContain("Sender rule 1: nested quantifier, as in (a+)+");
  expect(v.turnKeys(v.rows())).toEqual(["0:1", "0:2", "0:3"]);
});

test("agentRail: on by default, agent messages have rail ticks; off, only the person's turns and the running one do", async () => {
  const { v, cx } = await scripted([
    { k: "p", o: "human", t: "Rename the cart helper", ts: at(0) }, { k: "t", t: "Renamed." }, { k: "d", ms: 1000, ts: at(1) },
    // A teammate's message with a reply of its own: folded, so it is in the list.
    { k: "p", o: "peer", t: peer("Tests are green on helper-a"), ts: at(2) }, { k: "t", t: "Good. The release note needs one more line." }, { k: "d", ms: 800, ts: at(3) },
    { k: "p", o: "human", t: "Add the line", ts: at(4) }, { k: "t", t: "Added." }, { k: "d", ms: 600, ts: at(5) },
    // A teammate's message still running: the running turn.
    { k: "p", o: "peer", t: peer("Checking the docs build"), ts: at(6) },
  ]);
  const railKeys = () => (v.railTurns ?? []).map((x) => x.key);
  v.prefs = { ...v.prefs, agentTurns: false };
  expect(v.prefs.agentRail).toBe(true);
  draw(v, cx);
  expect(v.rows().some((r) => r.kind === "afold" && r.turnKey === "0:2")).toBe(true);
  expect(railKeys()).toEqual(["0:1", "0:2", "0:3", "0:4"]);
  // The panel's switch, next to Agent messages.
  v.settingsOpen = true;
  rec = [];
  v.render(cx);
  const ids = rec.filter(([n]) => n === "id").map(([, x]) => x);
  const kids = rec.filter(([n]) => n === "child").map(([, x]) => x);
  rec = null;
  expect(ids.indexOf("th-set-agent-rail")).toBe(ids.indexOf("th-set-agents") + 1);
  expect(kids).toContain("Agent messages on the rail");
  v.settingsOpen = false;
  // Off: the folded agent message leaves the rail and stays in the list; the running one keeps its tick.
  v.action("agentRail", cx);
  expect(v.prefs.agentRail).toBe(false);
  draw(v, cx);
  expect(railKeys()).toEqual(["0:1", "0:3", "0:4"]);
  expect(v.turnKeys(v.rows())).toContain("0:2");
  // With agent messages shown whole, they stay off the rail too.
  v.prefs = { ...v.prefs, agentTurns: true };
  draw(v, cx);
  expect(railKeys()).toEqual(["0:1", "0:3", "0:4"]);
  // Back on from the file.
  v.applyPrefs(JSON.stringify({ agentTurns: false, agentRail: true }));
  draw(v, cx);
  expect(railKeys()).toEqual(["0:1", "0:2", "0:3", "0:4"]);
});

test("a turn answered together with a later one: its line says so, and its note goes to that reply", async () => {
  const { v, cx } = await scripted([
    { k: "p", o: "human", t: "First question", ts: at(0) },
    { k: "p", o: "human", t: "A second thought", ts: at(1) },
    { k: "t", t: "An answer to both." },
    { k: "d", ms: 2000, ts: at(2) },
  ]);
  const t1 = v.current().turns[0];
  expect(t1.answeredBy).toBe(2);
  // No time of its own: not a bare "Worked".
  expect(v.workText(t1)).toBe("Answered with #2");
  expect(v.workText(v.current().turns[1])).toBe("Worked for 2s");
  // Opened, its note is a link (in the accent colour, with a click).
  v.sel = "0:1";
  v.action("open", cx);
  const note = v.rows().find((r) => r.kind === "noreply" && r.key.includes("0:1"));
  expect(note).toBeTruthy();
  rec = [];
  v.partContent(theme, note, false);
  const drawn = rec;
  rec = null;
  expect(drawn).toContainEqual(["text_color", theme.accent]);
  expect(v.noReplyText(t1)).toContain("Go to that reply");
  // The link opens the answering turn with the start of its reply at the top.
  v.goToAnswer(t1);
  expect(v.sel).toBe("0:2");
  expect(v.open.has("0:2")).toBe(true);
  expect(v.scrollTo).toMatchObject({ key: "md:0:2:0", how: "land" });
  draw(v, cx);
  expect(v.rows().some((r) => r.key === "md:0:2:0")).toBe(true);
});

test("the info icon is always shown: dim, like the line's label, on every turn, accent with its card open, and no handler", async () => {
  const { v } = await pane(fixture("--extra", "2"));
  const keys = v.turnKeys(v.rows());
  const [a, b] = keys.slice(-2);
  v.sel = b;
  expect(v.infoState(a)).toBe("hover");
  expect(v.infoState(b)).toBe("sel");
  const drawn = (state) => { rec = []; v.infoIcon(theme, state); const c = rec; rec = null; return c; };
  const other = drawn("hover");
  expect(other.filter((e) => e[0] === "text_color")).toEqual([["text_color", theme.dim]]);
  // The label's colour with no fade (about 3:1; at half strength it was under 2:1).
  expect(other.some((e) => e[0] === "opacity")).toBe(false);
  // No hover style and no handler: neither shows on the owner's machine inside a list row.
  expect(other.some((e) => e[0] === "hover" || /^on_/.test(String(e[0])))).toBe(false);
  const sel = drawn("sel");
  expect(sel.filter((e) => e[0] === "text_color")).toEqual([["text_color", theme.dim]]);
  expect(sel.some((e) => e[0] === "opacity")).toBe(false);
  expect(drawn("on").filter((e) => e[0] === "text_color")).toEqual([["text_color", theme.accent]]);
});

test("no list row registers an event handler: Herdr throws on one inside the item renderer", async () => {
  const { v, cx } = await pane(fixture("--extra", "6"));
  draw(v, cx);
  // Two turns with no reply of their own: one answered together with a later turn, one cut
  // off and answered in a later one. Their notes link to the answer.
  const ks = v.turnKeys(v.rows());
  const s = v.current();
  const [t1, t2] = [v.findTurn(ks[1]), v.findTurn(ks[3])];
  t1.after = []; t1.answeredBy = t1.n + 1; t1.shapeKey = null;
  t2.after = []; t2.answeredIn = t2.n + 1; t2.errors = ["cut off"]; t2.shapeKey = null;
  expect(s.turns.includes(t1)).toBe(true);
  v.rowsKey = null;
  // Open every turn, select one, and draw every row the list has.
  for (const k of v.turnKeys(v.rows())) v.open.add(k);
  v.sel = v.turnKeys(v.rows()).at(-2);
  const rows = v.rows();
  rec = [];
  v.listItems(theme, rows, v.slotsMemo ?? rows.map(() => 40), { start: 0, end: rows.length }, true, false);
  const drawn = rec;
  rec = null;
  const handlers = drawn.filter((e) => /^on_/.test(String(e[0])));
  expect(rows.length).toBeGreaterThan(10);
  expect(rows.filter((r) => r.kind === "noreply").length).toBeGreaterThanOrEqual(2);
  expect(handlers.map((e) => e[0])).toEqual([]);
  // The note's link works through the list's own item click.
  v.click(`nr:${ks[1]}`, cx);
  expect(v.sel).toBe(`${ks[1].split(":")[0]}:${t1.n + 1}`);
  expect(v.scrollTo?.key).toBe(`md:${v.sel}:0`);
  expect(v.scrollTo?.how).toBe("land");
  v.click(`nr:${ks[3]}`, cx);
  expect(v.sel).toBe(`${ks[3].split(":")[0]}:${t2.n + 1}`);
});

test("an agent row's sender label leaves room for the time and #n at 240 px (R6)", async () => {
  const { v, cx } = await scripted([
    { k: "p", o: "human", t: "<hc from=\"a-very-long-terminal-name-for-review\">Report: done</hc>", ts: at(0) },
    { k: "t", t: "Thanks." }, { k: "d", ms: 1000, ts: at(1) },
  ]);
  v.prefs = { ...v.prefs, agentTurns: true };
  const t1 = v.current().turns[0];
  t1.followups = 12; t1.n = 128;
  for (const w of [240, 380]) {
    v.width = w;
    const tw = (await import("../mods/agent-threads/ui.js")).replyWidth(w);
    const room = v.labelRoom(t1, tw);
    // icon 12 + label + " · " + #n + " · " + time + bell + gaps fit inside the meta line
    const used = 12 + room + 3 * 6.6 + 8 * 6.6 + 4 * 7.2 + (13 + 2 * 6.6) + 6 * 5;
    expect(used).toBeLessThanOrEqual(tw);
    draw(v, cx);
  }
});

// ---- round 2 ----------------------------------------------------------------------------

const keyEv = (key, extra = {}) => ({ key, modifiers: { shift: false, control: false, alt: false, platform: false, function: false }, ...extra });
async function settleCx(cx) { await Promise.all(cx.pending); cx.pending = []; }
const writes = () => log.filter((x) => x[0] === "run" || x[0] === "clipboard").map((x) => (x[0] === "run" ? `${x[1]}${x[2] ? ` ${JSON.stringify(x[2])}` : ""}` : "clipboard"));

async function quotePane(...flags) {
  const r = await pane(fixture("--only", "2", ...flags));
  r.v.width = 380;
  r.v.sel = r.v.turnKeys(r.v.rows())[0];
  r.v.toggle(r.v.sel, r.cx);
  r.cx.pending = []; // the folder watch and command loops never end; wait only for what follows
  log = [];
  focusNow = null;
  hcOut = JSON.stringify({ foreground: { name: "claude", argv: ["claude"], pid: 42 } });
  afterFocus = (args) => { focusNow = { terminal: state.panes.find((p) => p.pane === args?.pane)?.terminal ?? null }; };
  return r;
}

test("q quotes the open reply: the clipboard, then pane.focus, then terminal.paste, and nothing else", async () => {
  const { v, cx } = await quotePane();
  v.key(keyEv("q"), cx);
  await settleCx(cx);
  expect(writes()).toEqual(["clipboard", 'pane.focus {"pane":"p1"}', "terminal.paste"]);
  const reply = v.replyText(v.findTurn(v.sel));
  expect(cx.clip).toBe(`${reply.split("\n").map((l) => (l.trim() ? `> ${l}` : ">")).join("\n")}\n\n`);
  expect(log.find((x) => x[0] === "hc")).toEqual(["hc", "get", "t4", "--json"]);
  expect(v.lastQuote).toMatchObject({ via: "key", source: "reply", gate: "ok", focusOk: true, pasted: true });
  expect(v.lastQuote.text).toBeUndefined();
  expect(v.toast.text).toMatch(/^Quoted 1 line into t4 · focus is in the terminal$/);
  // A second press within 1 s does nothing; an auto-repeat press never does anything.
  log = [];
  v.key(keyEv("q"), cx);
  await settleCx(cx);
  expect(writes()).toEqual([]);
  v.quoteAt = 0;
  v.key(keyEv("q", { is_held: true }), cx);
  await settleCx(cx);
  expect(writes()).toEqual([]);
  // There is no quote command: action() does nothing with it.
  expect(v.action("quote", cx)).toBe(false);
  expect(v.action("agent-threads.quote", cx)).toBe(false);
  // debugQuote works only with props.debug.
  v.quoteAt = 0;
  expect(v.action("debugQuote", cx)).toBe(true);
  await settleCx(cx);
  expect(writes()).toEqual(["clipboard", 'pane.focus {"pane":"p1"}', "terminal.paste"]);
  v.debug = false;
  v.quoteAt = 0;
  expect(v.action("debugQuote", cx)).toBe(false);
});

test("the quote is never pasted when focus, the program, the status or the terminal is wrong", async () => {
  const cases = [
    ["focus elsewhere", () => { afterFocus = () => { focusNow = { terminal: "t9" }; }; }, /^Could not focus t4\. Quote copied\.$/],
    ["blocked", () => { state.terminals[0].status = "blocked"; }, /^Claude is waiting on a prompt in t4\. Quote copied\.$/],
    ["a shell", () => { hcOut = JSON.stringify({ foreground: { name: "zsh", argv: ["-zsh"] } }); }, /^t4 is at a shell\. Quote copied\.$/],
    ["another program", () => { hcOut = JSON.stringify({ foreground: { name: "vim", argv: ["vim"] } }); }, /^t4 is not running claude\. Quote copied\.$/],
    ["closed", () => { state.terminals = []; }, /^t4 is closed\. Quote copied\.$/],
    ["no pane", () => { state.panes = state.panes.filter((p) => p.terminal !== "t4"); }, /^No terminal for this pane\. Quote copied\.$/],
  ];
  for (const [what, setup, toast] of cases) {
    const { v, cx } = await quotePane();
    setup();
    v.key(keyEv("q"), cx);
    await settleCx(cx);
    cx.flush();
    expect(writes().includes("terminal.paste"), what).toBe(false);
    expect(writes()[0], what).toBe("clipboard"); // the quote is left on the clipboard
    expect(v.toast.text, what).toMatch(toast);
    expect(v.lastQuote.pasted, what).toBe(false);
  }
  // A remote terminal: refused before hc is asked anything.
  const { v, cx } = await quotePane();
  v.terminal = "mac/t4";
  state.terminals = [{ address: "mac/t4", status: "idle" }];
  state.panes[0].terminal = "mac/t4";
  v.quote(cx, "button");
  await settleCx(cx);
  expect(log.some((x) => x[0] === "hc")).toBe(false);
  expect(writes()).toEqual(["clipboard"]);
  expect(v.toast.text).toBe("Remote terminal. Quote copied.");
});

test("busy: the paste still goes in, Claude queues it, and the toast says so for 3 s", async () => {
  const { v, cx } = await quotePane();
  state.terminals[0].status = "working";
  v.quote(cx, "button");
  await settleCx(cx);
  expect(writes()).toEqual(["clipboard", 'pane.focus {"pane":"p1"}', "terminal.paste"]);
  expect(v.toast.text).toMatch(/^Quoted into t4 · Claude will queue it/);
  expect(cx.timers.some((x) => x.ms === 3000)).toBe(true);
  // Focus that lands a tick later: the paste waits for it.
  const late = await quotePane();
  let n = 0;
  afterFocus = () => { focusNow = null; };
  const realFocus = () => { n++; if (n === 2) focusNow = { terminal: "t4" }; };
  late.v.quote(late.cx, "button");
  await settleCx(late.cx);
  expect(writes()).toEqual(["clipboard", 'pane.focus {"pane":"p1"}']);
  realFocus(); late.cx.flush(200, 1); realFocus(); late.cx.flush(200, 1);
  expect(writes()).toEqual(["clipboard", 'pane.focus {"pane":"p1"}', "terminal.paste"]);
  expect(late.v.lastQuote.tries).toBeGreaterThan(0);
});

test("on Herdr 0.1.16 q in Select view quotes the editor's highlight with no ⌘C, and says so when nothing is highlighted", async () => {
  const { v, cx } = await quotePane();
  const key = v.sel;
  v.toggleSelect(key, cx);
  const st = v.selEditor.st;
  // 0.1.16's EditorState tells its highlight, in UTF-16 offsets into the text it was given.
  let range = { start: 0, end: 0 };
  st.selected_range = () => range;
  expect(v.selectHint()).toBe("Select text, then q quotes it · s or Esc returns");
  const text = v.selEditor.text;
  const part = text.split(/\s+/).slice(1, 4).join(" ");
  const at = text.indexOf(part);
  range = { start: at + part.length, end: at }; // dragged right to left
  cx.clip = "rm -rf / from some other window";
  log = [];
  v.quoteAt = 0;
  v.key(keyEv("q"), cx);
  cx.flush();
  await settleCx(cx);
  expect(writes()).toEqual(["clipboard", 'pane.focus {"pane":"p1"}', "terminal.paste"]);
  expect(cx.clip).toBe(`> ${part}\n\n`);
  expect(v.lastQuote).toMatchObject({ source: "selection", how: "editor", selectView: true, pasted: true });
  // Nothing highlighted, and nothing from the reply on the clipboard: nothing is pasted.
  range = { start: 5, end: 5 };
  cx.clip = "";
  log = [];
  v.quoteAt = 0;
  v.key(keyEv("q"), cx);
  cx.flush();
  await settleCx(cx);
  expect(writes()).toEqual([]);
  expect(v.toast.text).toBe("Nothing highlighted: select text, then q");
  // An editor that throws falls back to the clipboard as before.
  st.selected_range = () => { throw new Error("released"); };
  cx.clip = part;
  log = [];
  v.quoteAt = 0;
  v.key(keyEv("q"), cx);
  cx.flush();
  await settleCx(cx);
  expect(v.lastQuote).toMatchObject({ how: "clipboard", pasted: true });
  v.width = 240;
  st.selected_range = () => range;
  expect(v.selectHint()).toBe("q quotes the highlight · s returns");
});

test("in Select view q quotes what ⌘C copied from the reply, and never the whole reply", async () => {
  const { v, cx } = await quotePane();
  const key = v.sel;
  v.toggleSelect(key, cx);
  expect(v.selecting).toBe(key);
  const reply = v.replyText(v.findTurn(key));
  const part = reply.split(/\s+/).slice(1, 4).join(" ");
  // ⌘C in the editor (its own binding copies the highlight): the panel sees the key, and
  // once the clipboard holds text from this reply, says q quotes it.
  cx.clip = part;
  v.key({ key: "c", keystroke: "cmd-c", modifiers: { platform: true } }, cx);
  cx.flush();
  expect(v.toast.text).toBe("Copied 3 words · q quotes them");
  expect(v.selectCopy).toMatchObject({ ok: true, chars: part.length });
  v.key(keyEv("q"), cx);
  cx.flush();
  await settleCx(cx);
  expect(writes()).toEqual(["clipboard", 'pane.focus {"pane":"p1"}', "terminal.paste"]);
  expect(cx.clip).toBe(`> ${part}\n\n`);
  expect(v.lastQuote).toMatchObject({ source: "selection", selectView: true, pasted: true });
  expect(v.toast.text).toMatch(/^Quoted the selection into t4/);
  // Highlighted but not copied: the clipboard holds outside text. q pastes nothing, neither
  // that text nor the whole reply, and says how.
  for (const [clip, why] of [["rm -rf / from some other window", "notInReply"], ["", "empty"]]) {
    log = [];
    v.quoteAt = 0;
    cx.clip = clip;
    v.key(keyEv("q"), cx);
    cx.flush();
    await settleCx(cx);
    expect(v.lastQuote).toMatchObject({ source: "selection", gate: "nohighlight", why, pasted: false });
    expect(v.toast.text).toBe("Couldn't read the highlight, press ⌘C then q");
    expect(writes()).toEqual([]);
    expect(cx.clip).toBe(clip);
  }
  // ⌘C of outside text says nothing.
  v.toast = null;
  cx.clip = "elsewhere";
  v.key({ key: "c", keystroke: "cmd-c", modifiers: { platform: true } }, cx);
  cx.flush();
  expect(v.toast).toBe(null);
  expect(v.selectCopy.ok).toBe(false);
  // Out of Select view, q quotes the whole reply as before.
  v.endSelect();
  log = [];
  v.quoteAt = 0;
  v.key(keyEv("q"), cx);
  cx.flush();
  await settleCx(cx);
  expect(v.lastQuote).toMatchObject({ source: "reply", selectView: false, pasted: true });
  v.toggleSelect(key, cx);
  // The footer and the hint say how.
  expect(v.footerHints()).toEqual([["drag", "select"], ["⌘C", "copy"], ["q", "quote"], ["Esc", "back"]]);
  expect(v.selectHint()).toBe("Select text, ⌘C, then q quotes it · s or Esc returns");
  expect(v.rowDetail(v.rows().find((r) => r.kind === "seltext"))).toContain("border:accent");
  v.width = 240;
  expect(v.footerHints()).toEqual([["⌘C", "copy"], ["q", "quote"], ["Esc", "back"]]);
  expect(v.selectHint()).toBe("⌘C, then q quotes it · s returns");
});

test("the footer is one row of the most-used keys with q quote for a local terminal, and ? keys last", async () => {
  const { v, cx } = await quotePane();
  const hints = () => v.footerHints().map(([k, l]) => `${k} ${l}`);
  v.width = 545; // the reading width
  // → work comes before o outline, which gives way first.
  expect(hints()).toEqual(["↑↓ move", "↵ open", "c copy", "q quote", "/ filter", "p pin", "→ work", "? keys"]);
  v.width = 380;
  expect(hints()).toEqual(["↑↓ move", "↵ open", "c copy", "q quote", "? keys"]);
  v.toggle(v.sel, cx);
  expect(hints()).not.toContain("s select");
  v.width = 240;
  // What does not fit gives way from the right; ? keys stays.
  expect(hints()).toEqual(["↑↓ move", "↵ open", "? keys"]);
  // quoteKey from the settings file.
  v.width = 380;
  v.applyPrefs('{"quoteKey": "y"}');
  expect(v.quoteKey).toBe("y");
  expect(hints()).toContain("y quote");
  expect(v.settingsLine()).toBe("Link rules · 0 · Quote key · y");
  v.applyPrefs('{"quoteKey": "jj"}');
  expect(v.quoteKey).toBe("q");
  expect(v.prefsNotes[0]).toContain('quoteKey "jj"');
  v.key(keyEv("y"), cx); // y is no longer the quote key
  await settleCx(cx);
  expect(writes()).toEqual([]);
  // The Select-view hint names the key in use.
  v.applyPrefs('{"quoteKey": "y"}');
  v.toggleSelect(v.sel, cx);
  expect(v.selectHint()).toBe("Select text, ⌘C, then y quotes it · s or Esc returns");
});

test("before Herdr 0.1.13 the first click on a formatted reply says how to select, once", async () => {
  herdrVersion = "0.1.12";
  const { v, cx } = await quotePane();
  v.replySelectable();
  herdrVersion = "0.1.13";
  const md = v.rows().find((r) => r.kind === "md");
  v.click(md.key, cx);
  expect(v.toast.text).toBe("Press s to select text in this reply");
  v.toast = null;
  v.click(md.key, cx);
  expect(v.toast).toBe(null);
});

test("the formatted reply is selectable from Herdr 0.1.13, and a click there says nothing", async () => {
  const selectable = (v) => {
    views.length = 0;
    const md = v.rows().find((r) => r.kind === "md");
    v.item(theme, md, true, 100);
    return views.flatMap((x) => x.calls).find((c) => c[0] === "selectable")?.[1];
  };
  const { v, cx } = await quotePane();
  expect(selectable(v)).toBe(true);
  v.click(v.rows().find((r) => r.kind === "md").key, cx);
  expect(v.toast).toBe(null);
  herdrVersion = "0.1.12";
  const old = await quotePane();
  old.v.replySelectable();
  herdrVersion = "0.1.13";
  expect(selectable(old.v)).toBe(false);
});

test("after ⌘C on the formatted reply q quotes what it copied, as long as the clipboard holds it", async () => {
  const { v, cx } = await quotePane();
  const key = v.sel;
  const reply = v.replyText(v.findTurn(key));
  // A part of the reply, the way Herdr copies it: no Markdown markers.
  const part = reply.replace(/[*_`#>]/g, "").split(/\s+/).filter(Boolean).slice(1, 4).join(" ");
  const quoteNow = async () => {
    log = [];
    v.quoteAt = 0;
    v.key(keyEv("q"), cx);
    cx.flush();
    await settleCx(cx);
  };
  // A press and drag in the list, ⌘C (the panel does not see it), then ⌘ released.
  cx.clip = "older text";
  v.notePress(cx);
  cx.clip = part;
  v.cmdUp({ modifiers: { platform: false } }, cx);
  cx.flush();
  expect(v.toast.text).toBe("Copied 3 words · q quotes them");
  // Only once for the same text, and not while ⌘ is still down.
  v.toast = null;
  v.cmdUp({ modifiers: { platform: false } }, cx);
  v.cmdUp({ modifiers: { platform: true } }, cx);
  cx.flush();
  expect(v.toast).toBe(null);
  await quoteNow();
  expect(writes()).toEqual(["clipboard", 'pane.focus {"pane":"p1"}', "terminal.paste"]);
  expect(cx.clip).toBe(`> ${part}\n\n`);
  expect(v.lastQuote).toMatchObject({ source: "selection", selectView: false, pasted: true });
  // The clipboard now holds the quote, so the next q quotes the whole reply.
  await quoteNow();
  expect(v.lastQuote).toMatchObject({ source: "reply", pasted: true });
  // Text from elsewhere says nothing, and q still quotes the whole reply.
  v.toast = null;
  cx.clip = "older text";
  v.notePress(cx);
  cx.clip = "rm -rf / from some other window";
  v.cmdUp({ modifiers: {} }, cx);
  cx.flush();
  expect(v.toast).toBe(null);
  await quoteNow();
  expect(v.lastQuote).toMatchObject({ source: "reply", pasted: true });
  // Reply text that was already on the clipboard at the press is not a new copy.
  cx.clip = part;
  v.notePress(cx);
  await quoteNow();
  expect(v.lastQuote).toMatchObject({ source: "reply", pasted: true });
  // No press yet in this pane: the whole reply.
  const fresh = await quotePane();
  fresh.cx.clip = part;
  fresh.v.quoteAt = 0;
  fresh.v.key(keyEv("q"), fresh.cx);
  fresh.cx.flush();
  await settleCx(fresh.cx);
  expect(fresh.v.lastQuote).toMatchObject({ source: "reply" });
});

test("the Quote button's own press does not hide what ⌘C copied, and Copy reply ends it", async () => {
  const { v, cx } = await quotePane();
  const key = v.sel;
  const part = v.replyText(v.findTurn(key)).replace(/[*_`#>]/g, "").split(/\s+/).filter(Boolean).slice(1, 4).join(" ");
  cx.clip = "older text";
  v.notePress(cx);
  cx.clip = part;
  v.notePress(cx); // the press on the Quote button
  v.mouseX = v.pressX = v.acts(v.findTurn(key)).quote[0] + 4;
  v.bodyW = v.width;
  v.quoteAt = 0;
  v.click(`cp:${key}`, cx);
  cx.flush();
  await settleCx(cx);
  expect(v.lastQuote).toMatchObject({ source: "selection", pasted: true });
  cx.clip = "older text";
  v.notePress(cx);
  v.copyReply(key, cx);
  v.quoteAt = 0;
  v.key(keyEv("q"), cx);
  cx.flush();
  await settleCx(cx);
  expect(v.lastQuote).toMatchObject({ source: "reply" });
});

// The owner's go, 17 Nov: highlight by drag in any turn, open or closed. A press and drag
// selects; only a click that does not move opens the turn.
test("a closed turn's message and reply start select by drag, a click that does not move opens it, and q quotes what ⌘C copied from either", async () => {
  const { v, cx } = await quotePane();
  v.prefs = { ...v.prefs, bubbleColor: "plain" }; // Markdown in the message: the plain look
  const keys = v.turnKeys(v.rows());
  const k = keys.find((x) => !v.open.has(x));
  expect(k).toBeTruthy();
  const turn = v.findTurn(k);
  v.toggle(keys.find((x) => v.open.has(x)), cx);
  v.sel = k;
  draw(v, cx);
  const row = v.rows().find((r) => r.key === k);
  expect(row.kind).toBe("turn");
  // Drawn: the message and the reply start are selectable text views.
  const v0 = views.length;
  v.rowItem(theme, row, false);
  const drawn = views.slice(v0);
  const sel = (x) => x.calls.some(([n, on]) => n === "selectable" && on === true);
  const msg = drawn.filter((x) => x.id.startsWith("th-sp-"));
  const rep = drawn.filter((x) => x.id.startsWith("th-cmd-cmd:") || x.id.startsWith("th-sr-"));
  expect(msg.length).toBeGreaterThan(0);
  expect(rep.length).toBeGreaterThan(0);
  expect([...msg, ...rep].every(sel)).toBe(true);
  // A drag selects: the turn is selected and stays closed. A double press too.
  v.sel = keys.find((x) => x !== k);
  v.pressMoved = 40; v.pressCount = 1;
  v.click(k, cx);
  expect([v.sel, v.open.has(k)]).toEqual([k, false]);
  v.pressMoved = 0; v.pressCount = 2;
  v.click(k, cx);
  expect(v.open.has(k)).toBe(false);
  // ⌘C copied part of its message: q quotes that.
  const words = (t) => t.replace(/[*_`#>]/g, "").split(/\s+/).filter(Boolean).slice(1, 4).join(" ");
  cx.clip = "older text";
  v.notePress(cx);
  cx.clip = words(turn.prompt);
  v.quoteAt = 0;
  v.key(keyEv("q"), cx);
  await settleCx(cx);
  expect(v.lastQuote).toMatchObject({ source: "selection", pasted: true });
  // Part of its reply: that.
  cx.clip = "older text";
  v.notePress(cx);
  cx.clip = words(v.replyText(turn));
  v.quoteAt = 0;
  v.key(keyEv("q"), cx);
  await settleCx(cx);
  expect(v.lastQuote).toMatchObject({ source: "selection", pasted: true });
  // A highlight with nothing copied: a mod cannot read it (Herdr issue 1110), so q quotes the
  // whole reply.
  v.notePress(cx);
  v.quoteAt = 0;
  v.key(keyEv("q"), cx);
  await settleCx(cx);
  expect(v.lastQuote).toMatchObject({ source: "reply", pasted: true });
  // A click that does not move opens it.
  v.pressMoved = 0; v.pressCount = 1;
  v.click(k, cx);
  expect(v.open.has(k)).toBe(true);
  // TextView draws only in the theme's text colour, so a line in any other colour (a quote, an
  // agent's message, a stop's reason) stays a plain line, in its own colour.
  const v2 = views.length;
  v.selLines(theme, "th-sp-x", ["muted"], theme.muted, 14, 22);
  v.selLines(theme, "th-sp-y", ["ink"], theme.foreground, 14, 22);
  expect(views.slice(v2).map((x) => x.id)).toEqual(["th-sp-y"]);
  // While a search marks its hits, the lines are plain, so the marks still show.
  v.query = turn.prompt.split(/\s+/)[0];
  const v1 = views.length;
  v.rowItem(theme, { ...row, shape: v.shape(turn) }, false);
  expect(views.slice(v1).some((x) => x.id.startsWith("th-sp-"))).toBe(false);
  v.query = "";
});

test("the command name is quiet: no fill, muted, foreground when bare, tinted on a hit", async () => {
  const { v } = await quotePane();
  rec = [];
  v.chip(theme, "/review-pr", 120);
  expect(rec.some(([n]) => n === "bg")).toBe(false);
  expect(rec.filter(([n]) => n === "text_color").map(([, c]) => c)).toEqual([theme.muted]);
  expect(rec.find(([n]) => n === "text_size")[1]).toBe(12.5);
  rec = [];
  v.chip(theme, "/x", 120, true);
  expect(rec.filter(([n]) => n === "text_color").map(([, c]) => c)).toEqual([theme.foreground]);
  v.query = "review";
  rec = [];
  v.chip(theme, "/review-pr", 120);
  expect(rec.some(([n, c]) => n === "bg" && c === "#d7a00052")).toBe(true);
  v.query = "";
  rec = null;
  // A theme where muted reads under 4.5:1 on the selected row: foreground there only.
  const low = { ...theme, selected: theme.muted };
  expect(v.cmdColor(low, true)).toBe(theme.foreground);
  expect(v.cmdColor(low)).toBe(theme.muted);
});

test("long messages show in full by default: no Show more anywhere, and Shorten long messages brings the cuts back", async () => {
  const { v, cx } = await pane(fixture());
  v.width = 380;
  expect(v.prefs.truncate).toBe(false);
  const long = v.current().turns.find((x) => v.replyText(x).length > 400 && x.done);
  expect(long).toBeTruthy();
  long.prompt = "Please look at this. ".repeat(60);
  long.shapeKey = null;
  draw(v, cx);
  const strings = (fn) => { rec = []; fn(); const c = rec; rec = null; return c.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]); };
  const row = () => v.rows().find((r) => r.turn === long && r.kind === "turn");
  // Off: the whole reply as Markdown and the whole prompt, and no Show more.
  let sh = v.shape(long);
  expect(sh.rMore).toBe(false);
  expect(sh.pMore).toBe(false);
  expect(sh.md.length).toBeGreaterThanOrEqual(v.replyText(long).length - 10);
  expect(strings(() => v.rowItem(theme, row(), false))).not.toContain("Show more");
  // The card's Chat tab: the switch, with no hint that repeats it, and no line steppers while it is off.
  v.action("settings", cx);
  expect(v.setTab).toBe("chat");
  let panel = strings(() => v.render(cx));
  expect(panel).toContain("Shorten long messages");
  expect(panel).not.toContain("Every message and reply shows in full.");
  expect(panel).not.toContain("Reply lines");
  // On: the row is cut to its line limits with Show more, and the steppers show.
  v.action("truncate", cx);
  expect(v.prefs.truncate).toBe(true);
  panel = strings(() => v.render(cx));
  expect(panel).toContain("Reply lines");
  v.settingsOpen = false;
  draw(v, cx);
  sh = v.shape(long);
  expect(sh.rMore || sh.pMore).toBe(true);
  expect(strings(() => v.rowItem(theme, row(), false))).toContain("Show more");
  // Reset to defaults turns it off again.
  v.action("resetSettings", cx);
  expect(v.prefs.truncate).toBe(false);
});

test("prompt quotes: rows draw a bar line within the budget, the card draws Markdown", async () => {
  const { v, cx } = await pane(fixture("--only", "0", "--quotes"));
  // Markdown in the message: the plain look. Rows cut to their line limits (Shorten long messages).
  v.prefs = { ...v.prefs, bubbleColor: "plain", agentBubbleColor: "plain", truncate: true };
  v.width = 380;
  draw(v, cx);
  const snap = () => state.shared["threads.debug"].t4;
  const turn = (n) => snap().detail.find((d) => d.startsWith(`turn#${n} `));
  // "> two lines\n\ncomment": one quote line, then the comment's lines.
  expect(turn(3)).toMatch(/^turn#3 p[23]\/r\d q1 h\d+ /);
  expect(turn(3)).toContain("▎The retry path");
  expect(turn(1)).toMatch(/^turn#1 p\d\/r\d q\d qonly /);
  expect(turn(2)).toMatch(/^turn#2 p\d\/r\d h/);
  expect(turn(8)).toMatch(/^turn#8 p\d\/r\d h/); // the fence's ">" lines are code
  // Heights match the units.
  const { rowShape } = await import("../mods/agent-threads/ui.js");
  const t3 = v.current().turns[2];
  expect(v.shape(t3).height).toBe(rowShape({ prompt: t3.prompt.slice(0, 1200), reply: v.shape(t3).reply.join(" "), width: 380, promptLines: v.prefs.promptLines, replyLines: v.prefs.replyLines }).height);
  // With Prompt lines 1 a quote and a comment show the comment only.
  v.prefs = { ...v.prefs, promptLines: 1 };
  draw(v, cx);
  expect(turn(3)).toMatch(/^turn#3 p1\/r\d h/);
  expect(turn(3)).toContain("Cap the retries");
  v.prefs = { ...v.prefs, promptLines: 2 };
  // The open card: TextView Markdown with a blockquote, then the comment.
  mdSources.length = 0;
  v.open = new Set(["0:3"]);
  draw(v, cx);
  // Collapsed, each quote run shows 2 wrapped lines (the first line wraps at 380 px).
  expect(mdSources.find(([id]) => id === "th-you-you:0:3")[1]).toBe("> The retry path still logs a warning when the queue is empty\\. …\n\nCap the retries at five\\, and log once\\.");
  mdSources.length = 0;
  v.full = new Set(["0:3"]);
  draw(v, cx);
  v.full.clear();
  const you = mdSources.find(([id]) => id === "th-you-you:0:3");
  expect(you[1]).toBe("> The retry path still logs a warning when the queue is empty\\.\\\n> It also retries forever\\.\n\nCap the retries at five\\, and log once\\.");
  expect(snap().detail.find((d) => d.startsWith("you#3"))).toMatch(/^you#3 USER md q1 code0 links0 h\d+/);
  // The 40-line quote is clipped to 2 lines with Show all.
  v.open = new Set(["0:9"]);
  draw(v, cx);
  expect(snap().detail.find((d) => d.startsWith("you#9"))).toMatch(/q1 code0 links0 \+\d+ h/);
  // With a filter that matches the prompt, the matches are marked (no TextView for it).
  mdSources.length = 0;
  v.query = "retry";
  v.open = new Set(["0:3"]);
  draw(v, cx);
  expect(mdSources.some(([id]) => id === "th-you-you:0:3")).toBe(false);
  expect(snap().detail.find((d) => d.startsWith("you#3"))).toMatch(/^you#3 USER hl q1/);
  v.query = "";
  // R5: Show all shows a long pasted prompt to its end, and past 200,000 characters says
  // how much it leaves out.
  const t3b = v.current().turns[2];
  const keep = t3b.prompt;
  t3b.prompt = `${"Long pasted log line with words. ".repeat(1500)}TAIL-END`;
  expect(t3b.prompt.length).toBeGreaterThan(32000);
  v.open = new Set(["0:3"]);
  v.full = new Set(["0:3"]);
  mdSources.length = 0;
  draw(v, cx);
  // Longer than Herdr draws in one Markdown view: stacked blocks, each within MD_MAX.
  const youParts = () => mdSources.filter(([id]) => id === "th-you-you:0:3" || id.startsWith("th-you-you:0:3-")).map(([, m]) => m);
  expect(youParts().length).toBeGreaterThan(1);
  expect(youParts().every((m) => Buffer.byteLength(m) <= MD_MAX)).toBe(true);
  let src = youParts().join("\n\n");
  expect(src).toContain("TAIL\\-END");
  expect(src).not.toContain("more characters not shown");
  t3b.prompt = `${"word ".repeat(50000)}end`;
  mdSources.length = 0;
  draw(v, cx);
  src = youParts().join("\n\n");
  expect(src).toMatch(/\*… 50,003 more characters not shown\*$/);
  t3b.prompt = keep;
  v.full.clear();
});

test("link rules: the open card's reply and prompt carry links, rows never do", async () => {
  const { v, cx } = await pane(fixture("--only", "0", "--links"));
  v.width = 380;
  v.applyPrefs(JSON.stringify({ bubbleColor: "plain", agentBubbleColor: "plain", links: [
    { name: "Issue", pattern: "\\bACME-(\\d+)\\b", url: "https://linear.app/acme/issue/ACME-$1" },
    { name: "PR", pattern: "(?<![\\w&/#])#(\\d{1,5})\\b", url: "https://github.com/{repo}/pull/$1" },
    { pattern: "(a+)+", url: "https://x.example/$1" },
  ] }));
  expect(v.links.length).toBe(2);
  expect(v.settingsLine()).toBe("Link rules · 3 (1 not valid) · Quote key · q");
  expect(v.prefsNotes).toEqual(["Link rule 3: nested quantifier, as in (a+)+"]);
  v.remote = { key: "t4|null", repo: "acme/widgets", owner: "acme", why: "test" };
  v.open = new Set(["0:1"]);
  mdSources.length = 0;
  draw(v, cx);
  const md = v.rows().find((r) => r.kind === "md");
  expect(md.links).toBe(2);
  expect(md.md).toContain("[ACME\\-123](https://linear.app/acme/issue/ACME-123)");
  expect(md.md).toContain("[\\#45](https://github.com/acme/widgets/pull/45)");
  // The fence is its own code item, untouched; the last prose part has only a URL, an
  // autolink and code, so it gets no link.
  expect(v.rows().find((r) => r.kind === "code").seg.text).toBe("git log --grep ACME-9");
  // Code blocks wrap (nothing in the list scrolls on its own): the editor's soft_wrap is on,
  // and the box is as tall as its wrapped rows, up to CODE_LINES (12) until Show all.
  const code = v.rows().find((r) => r.kind === "code");
  expect(code).toMatchObject({ rows: 1, shown: 1, more: false });
  expect(v.codeBoxH(code)).toBe(36);
  v.makeCode(code.key.split(":").slice(1, 3).join(":"));
  expect(editors.at(-1).opts).toMatchObject({ soft_wrap: true, readonly: true, value: "git log --grep ACME-9" });
  const long = `cd ~/acme-try && ${"git fetch && ".repeat(12)}./install.sh`;
  const per = v.codePer();
  const shape = v.codeShape(long);
  expect(per).toBe(Math.floor((v.prose() - 18) / (12 * 0.62)));
  expect(shape.rows).toBe((await import("../mods/agent-threads/ui.js")).codeRows(long, per));
  expect(shape.rows).toBeGreaterThan(1);
  expect(shape.shown).toBe(shape.rows);
  expect(shape.more).toBe(false);
  const tall = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  expect(v.codeShape(tall)).toMatchObject({ rows: 20, shown: 12, more: true, all: false });
  expect(v.codeShape(tall, true)).toMatchObject({ rows: 20, shown: 20, more: true, all: true });
  // The label is the fence's language, or nothing: never "code".
  const head = v.rows().find((r) => r.kind === "codehead");
  rec = []; v.partContent(theme, head, false); const hs = rec.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]); rec = null;
  expect(hs).not.toContain("code");
  expect(v.rows().filter((r) => r.kind === "md").at(-1).links).toBe(0);
  const snap = state.shared["threads.debug"].t4;
  expect(snap.detail.find((d) => d.startsWith("md#1"))).toMatch(/^md#1 links 2 h\d+ \| \]\(https:\/\/linear\.app\/acme\/issue\/ACME-123\) \]\(https:\/\/github\.com\/acme\/widgets\/pull\/45\) /);
  expect(snap.detail.find((d) => d.startsWith("you#1"))).toMatch(/ md q1 code0 links3 /);
  expect(snap.links).toMatchObject({ count: 3, valid: 2 });
  // Collapsed rows get no link rules: the reply's own Markdown shows as written, and
  // ACME-123 and #45 stay plain.
  v.open.clear();
  draw(v, cx);
  const row = state.shared["threads.debug"].t4.detail.find((d) => d.startsWith("turn#1"));
  expect(row).not.toContain("[ACME-123](");
  expect(row).not.toContain("[#45](");
  expect(v.shape(v.findTurn("0:1")).md).toContain("[ACME-1](https://x.example/one)");
  // Without a repo, the {repo} rule is skipped: #45 stays plain.
  v.remote = { key: "y", repo: null, owner: null, why: "no git remote origin" };
  v.open = new Set(["0:1"]);
  draw(v, cx);
  expect(v.rows().find((r) => r.kind === "md").links).toBe(1);
  // A save from the panel keeps the rules in the file.
  const { settingsText } = await import("../mods/agent-threads/settings.js");
  expect(JSON.parse(settingsText({ agentTurns: true }, v.prefsRaw)).links.length).toBe(3);
});

test("the repo comes from git remote get-url origin in the terminal's folder", async () => {
  const { v, cx } = await pane(fixture("--only", "1"));
  cx.pending = [];
  const dir = mkdtempSync(join(tmpdir(), "threads-git-"));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "remote", "add", "origin", "https://github.com/acme/widgets.git"]);
  v.applyPrefs(JSON.stringify({ links: [{ pattern: "#(\\d+)", url: "https://github.com/{repo}/pull/$1" }] }));
  state.panes[0].cwd = dir;
  v.lookRepo(cx);
  await settleCx(cx);
  expect(v.remote).toMatchObject({ repo: "acme/widgets", owner: "acme", why: "origin on github.com" });
  const none = mkdtempSync(join(tmpdir(), "threads-nogit-"));
  state.panes[0].cwd = none;
  v.lookRepo(cx);
  await settleCx(cx);
  expect(v.remote).toMatchObject({ repo: null, why: "no git remote origin" });
});

// ---- round 3: S1, the read never stalls ---------------------------------------------------

let busyFile = null;
const busy = () => (busyFile ??= fixture("--busy", "130"));

// A pane on file whose cx is set up by prep before init (hooks must be in place for the read).
async function paneWith(file, prep, tries = 200) {
  state = {
    terminals: [{ address: "t4", status: "idle", name: "claude" }],
    panes: [{ pane: "p1", tab: "A", terminal: "t4", program: { key: "claude", name: "Claude Code" } }, { pane: "p2", tab: "A", terminal: null, mod: "agent-threads" }],
    props: { terminal: "t4", transcript: file, debug: true }, shared: {},
  };
  const v = new Threads();
  const cx = makeCx();
  prep?.(cx, v);
  v.init(state.props, cx);
  if (tries) await settle(v, tries);
  return { v, cx };
}
async function until(f, what, n = 400) {
  for (let i = 0; i < n; i++) { if (f()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error(`timed out waiting for ${what}`);
}

// Runs in a child bun with BUN_JSC_useJIT=0 (the interpreter's speed); the parent test below
// starts it and checks what it wrote.
test.if(process.env.THREADS_CHILD === "read-timing")("S1 child: read the busy fixture and time each synchronous stretch", async () => {
  const pcts = [];
  let v;
  const r = await paneWith(busy(), (cx, view) => {
    v = view;
    marks = [];
    cx.sleepHook = () => { stamp("out"); return new Promise((res) => setTimeout(() => { stamp("in"); res(); }, 0)); };
    // The read's last notify (in its finally) closes its last stretch.
    cx.notifyHook = () => {
      const h = v.headerText();
      // Other notifies (the settings read) can repeat a percentage; only changes count.
      if (/^Reading… \d+%$/.test(h)) { const p = Number(h.match(/\d+/)[0]); if (p !== pcts.at(-1)) pcts.push(p); }
      if (!v.reading && v.current()?.loaded && marks?.at(-1)?.[0] === "in") stamp("out");
    };
  }, 2000);
  const m = marks;
  marks = null;
  // The longest stretch from a resume ("in") to the next hand-off ("out"), or to the end of
  // the read for the last one.
  let longest = 0;
  for (let i = 1; i < m.length; i++) if (m[i][0] === "out" && m[i - 1][0] === "in") longest = Math.max(longest, m[i][1] - m[i - 1][1]);
  // B1: the agent toggle rebuilds the rows, and an open card draws with its probe.
  const view = r.v;
  const time = (f) => { const a = performance.now(); f(); return performance.now() - a; };
  view.rows();
  const toggleOn = time(() => { view.setPrefs({ ...view.prefs, agentTurns: true }); view.rows(); });
  const toggleOff = time(() => { view.setPrefs({ ...view.prefs, agentTurns: false }); view.rows(); });
  // The list draws the rows of one screen at its end, as Herdr does (the stub otherwise draws
  // all 1,305, and each row's own cost, its hover card and its whole reply, adds up past
  // anything Herdr draws). allFrame is the same open frame with every row drawn, for the log.
  listWindow = (n) => ({ start: Math.max(0, n - 14), end: n });
  // The rows build can take more than one slice (BUILD_MS, one a frame) once agent turns with
  // replies show: the frames that finish it, before the keys are read.
  for (let k = 0; k < 50 && view.rowJob; k++) view.render(r.cx);
  const keys = view.turnKeys(view.rows());
  view.toggle(keys.at(-2), r.cx);
  const openFrame = time(() => view.render(r.cx));
  const nextFrame = time(() => view.render(r.cx));
  listWindow = null;
  view.toggle(keys.at(-3), r.cx);
  const allFrame = time(() => view.render(r.cx));
  require("node:fs").writeFileSync(process.env.THREADS_OUT, JSON.stringify({ longest, pcts, turns: view.current().turns.length, loaded: view.current().loaded, awaits: m.length / 2, toggleOn, toggleOff, openFrame, nextFrame, allFrame }));
}, 120000);

test("S1: with JIT off the read's longest synchronous stretch is at most 25 ms, and the percentage rises chunk by chunk", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "threads-timing-")), "out.json");
  // Not execFileSync: while the child runs, this process stays free to take a signal, so a
  // stopped run ends the child too (test/preload.js) instead of leaving it reading.
  await new Promise((resolve, reject) => {
    const child = spawn("bun", ["test", join(root, "test/render.test.js"), "-t", "S1 child"], {
      env: { ...process.env, BUN_JSC_useJIT: "0", THREADS_CHILD: "read-timing", THREADS_OUT: out }, stdio: "ignore",
    });
    const timer = setTimeout(() => child.kill(), 120000);
    child.on("error", reject);
    child.on("exit", (code, sig) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`the timing child ended with ${code ?? sig}`)); });
  });
  const r = JSON.parse(readFileSync(out, "utf8"));
  expect(r.loaded).toBe(true);
  expect(r.turns).toBe(1305);
  // The bounds below are for a developer machine. GitHub's shared runners measured about 1.3x
  // slower (32 ms, 207 ms), so CI allows twice each: the regressions they guard against (a
  // whole read parsed in one go, rows rebuilt per frame) cost several times more.
  const slow = process.env.CI ? 2 : 1;
  // 30 ms, not 25: 1,170 of this fixture's 1,305 turns are agent messages with a reply, which
  // show folded while agent messages are hidden, and the last stretch shapes the turns in view
  // from them (20 to 23 ms before they showed, 26 to 28 ms after).
  expect(r.longest).toBeLessThanOrEqual(30 * slow);
  expect(r.pcts.length).toBeGreaterThanOrEqual(4);
  for (let i = 1; i < r.pcts.length; i++) expect(r.pcts[i]).toBeGreaterThan(r.pcts[i - 1]);
  expect(r.pcts.at(-1)).toBe(100);
  // Showing agent messages shapes about 1,170 rows for the first time: 112 to 133 ms in this
  // harness, the same as on a build checked in a drawn window, so the bound is loose. Hiding them and
  // drawing an open card with its probe stay small.
  expect(r.toggleOn).toBeLessThan(200 * slow);
  expect(r.toggleOff).toBeLessThan(25 * slow);
  expect(r.openFrame).toBeLessThan(50 * slow);
  const f = (x) => x.toFixed(1);
  console.log(`S1 timing, JIT off: longest stretch ${f(r.longest)} ms over ${r.awaits} awaits; percent ${r.pcts.join(", ")}; agents on ${f(r.toggleOn)} ms, off ${f(r.toggleOff)} ms; open-card frame ${f(r.openFrame)} ms, next ${f(r.nextFrame)} ms; with every row drawn ${f(r.allFrame)} ms`);
}, 130000);

test("S1: before the first chunk the header says Reading… with no percentage, and the bar is indeterminate", async () => {
  const { v, cx } = await paneWith(busy(), (cx) => { cx.sleepHook = never; }, 0);
  await until(() => v.current(), "a session");
  expect(v.headerText()).toBe("Reading…");
  rec = [];
  v.render(cx);
  const widths = rec.filter(([n]) => n === "w").map(([, x]) => x);
  rec = null;
  expect(widths).toContain("30%"); // the looping bar, never "0%"
  expect(widths).not.toContain("0%");
});

test("S1: a read that dies mid-step restarts after 4 s, with no duplicate turns", async () => {
  let dead = 1;
  const { v, cx } = await paneWith(busy(), (cx) => { cx.sleepHook = () => (dead-- > 0 ? never() : new Promise((r) => setTimeout(r, 0))); }, 0);
  await until(() => dead < 0 || (v.reading && dead === 0), "the dead step");
  await new Promise((r) => setTimeout(r, 50));
  expect(v.reading).toBe(true);
  expect(v.current().loaded).toBeFalsy();
  const before = v.current().turns.length;
  // The 1 s timer at 3 s does nothing; at 5 s it restarts the read.
  const tick = cx.everies.find((x) => x.ms === 1000).fn;
  const real = Date.now;
  try {
    Date.now = () => real() + 3000; tick(cx);
    expect(v.reading).toBe(true);
    Date.now = () => real() + 5000; tick(cx);
  } finally { Date.now = real; }
  await settle(v, 1000);
  const turns = v.current().turns;
  expect(turns.length).toBe(1305);
  expect(turns.map((t) => t.n)).toEqual(turns.map((_, i) => i + 1));
  expect(new Set(turns.map((t) => `${t.ts}|${t.prompt.slice(0, 80)}`)).size).toBe(1305);
  expect(before).toBeLessThan(1305);
  expect(v.current().error).toBe(null);
  expect(v.headerText()).toMatch(/^1,?\d{3} turns|^\d+ turns/);
});

test("S1: a second stall shows Read failed with Retry, and Retry reads the session", async () => {
  let dead = 2;
  let deadNow = false;
  const { v, cx } = await paneWith(busy(), (cx) => { cx.sleepHook = () => { if (deadNow) { deadNow = false; return never(); } return new Promise((r) => setTimeout(r, 0)); }; }, 0);
  const tick = cx.everies.find((x) => x.ms === 1000).fn;
  const real = Date.now;
  const stall = async () => {
    deadNow = true;
    await until(() => !deadNow, "the dead step");
    await new Promise((r) => setTimeout(r, 30));
    try { Date.now = () => real() + 11000; tick(cx); } finally { Date.now = real; }
    dead--;
  };
  // The first read dies before its first chunk is in, then the restarted one does too.
  await stall();
  expect(v.reading).toBe(true);
  await stall();
  expect(dead).toBe(0);
  const s = v.current();
  expect(v.reading).toBe(false);
  expect(s.error).toBe("The read stopped before it finished.");
  expect(v.headerText()).toBe("Read failed");
  rec = [];
  v.render(cx);
  const ids = rec.filter(([n]) => n === "id").map(([, x]) => x);
  const widths = rec.filter(([n]) => n === "w").map(([, x]) => x);
  rec = null;
  expect(ids).toContain("th-retry");
  expect(widths).not.toContain("40%"); // no loading skeleton
  if (s.turns.length) expect(v.bannerTitles()).toContain("Could not read the transcript");
  v.retryRead(cx);
  await settle(v, 1000);
  expect(v.current().turns.length).toBe(1305);
  expect(v.current().error).toBe(null);
  expect(v.headerText()).not.toBe("Read failed");
});

// F1: a stall in the middle of applying a chunk, twice. The session must not keep the
// half-applied events, or the next read (a poll, the 5 s timer) applies them again.
test("S1: two stalls mid-apply leave no half-applied chunk, so a later read has no duplicate turns", async () => {
  let kills = 0;
  let view = null;
  // performance.now moves 1 ms a call, so every apply slice runs past SLICE_MS and yields.
  const realPerf = performance.now.bind(performance);
  let fake = 0;
  performance.now = () => (fake += 1);
  try {
    const { v, cx } = await paneWith(busy(), (cx, vv) => {
      view = vv;
      cx.sleepHook = () => {
        if (kills < 2 && view.current()?.partial && view.current().turns.length > 0) { kills++; return never(); }
        return new Promise((r) => setTimeout(r, 0));
      };
    }, 0);
    const tick = cx.everies.find((x) => x.ms === 1000).fn;
    const real = Date.now;
    const stall = async (n) => {
      await until(() => kills >= n, `stall ${n}`);
      await new Promise((r) => setTimeout(r, 30));
      expect(v.current().partial).toBe(true);
      try { Date.now = () => real() + 5000; tick(cx); } finally { Date.now = real; }
    };
    await stall(1);
    expect(v.current().partial).toBe(false); // started over
    await stall(2);
    const s = v.current();
    expect(s.error).toBe("The read stopped before it finished.");
    expect(s.partial).toBe(false);
    expect(s.offset).toBe(0);
    expect(s.turns.length).toBe(0); // the half-applied chunk is gone
    // A plain read (what a poll or the 5 s timer does) now reads the whole file once.
    v.read(cx);
    await settle(v, 1000);
    const turns = v.current().turns;
    expect(turns.length).toBe(1305);
    expect(turns.map((t) => t.n)).toEqual(turns.map((_, i) => i + 1));
    expect(v.current().error).toBe(null);
  } finally { performance.now = realPerf; }
});

// F1, the other path: apply throws midway. The error shows, and no later read repeats events.
test("S1: a throw mid-apply drops the half-applied chunk", async () => {
  const { v, cx } = await paneWith(busy(), null, 1000);
  const s = v.current();
  expect(s.turns.length).toBe(1305);
  // Make the next read apply a chunk that throws after part of it: a fresh start whose
  // sleep hook throws on the first yield while partial.
  const realPerf = performance.now.bind(performance);
  let fake = 0;
  performance.now = () => (fake += 1);
  let thrown = false;
  cx.sleepHook = () => {
    if (!thrown && v.current().partial && v.current().turns.length > 0) { thrown = true; return Promise.reject(new Error("synthetic failure")); }
    return new Promise((r) => setTimeout(r, 0));
  };
  try {
    v.retryRead(cx);
    await until(() => !v.reading, "the failed read");
  } finally { performance.now = realPerf; }
  expect(thrown).toBe(true);
  expect(v.current().error).toBe("synthetic failure");
  expect(v.current().partial).toBe(false);
  expect(v.current().turns.length).toBe(0);
  v.read(cx);
  await settle(v, 1000);
  expect(v.current().turns.length).toBe(1305);
  expect(v.current().error).toBe(null);
});

// F4: a loaded session whose extractor call is slow, or a computer that slept, keeps its turns.
test("S1: a slow extractor call or a sleep never wipes a loaded session", async () => {
  const { v, cx } = await paneWith(busy(), null, 1000);
  const s = v.current();
  expect(s.loaded).toBe(true);
  const tick = cx.everies.find((x) => x.ms === 1000).fn;
  const real = Date.now;
  // A read whose extractor call is in flight: the flags read() sets while it awaits exec.
  const hang = (waiting) => { v.reading = true; v.readWaiting = waiting; v.readBeat = real(); v.readGen = (v.readGen ?? 0) + 1; };
  try {
    // 1. The computer slept for a minute during the call: the next tick sees the gap and
    //    starts the clock again.
    hang(true);
    Date.now = () => real(); tick(cx);
    Date.now = () => real() + 60000; tick(cx);
    expect(v.reading).toBe(true);
    expect(s.turns.length).toBe(1305);
    // 2. The call is slow, the timer runs: still waiting at 20 s past the beat.
    for (let k = 1; k <= 20; k++) { Date.now = () => real() + 60000 + k * 1000; tick(cx); }
    expect(v.reading).toBe(true);
    expect(s.loaded).toBe(true);
    // 3. Past EXEC_STALL the read is dropped and started again from its offset.
    for (let k = 21; k <= 31; k++) { Date.now = () => real() + 60000 + k * 1000; tick(cx); }
  } finally { Date.now = real; }
  expect(s.loaded).toBe(true);
  expect(s.turns.length).toBe(1305);
  await settle(v, 1000);
  expect(v.current().turns.length).toBe(1305);
  expect(v.current().error).toBe(null);
});

// ---- round 3: V3a, design px at any zoom --------------------------------------------------

// The handler a recorded element chain set right after .id(id), or null.
function handlerAfterId(calls, id, name) {
  for (let i = 0; i < calls.length; i++) {
    if (calls[i][0] !== "id" || calls[i][1] !== id) continue;
    for (let j = i + 1; j < calls.length && j < i + 8; j++) if (calls[j][0] === name) return calls[j].at(-1);
  }
  return null;
}

test("V3a: at zoom 0.9 the panel lays out in design px and hands the list the same design px (the list zooms them)", async () => {
  const { v, cx } = await pane(fixture("--extra", "3", "--latest", "--langs"));
  const key = v.turnKeys(v.rows()).at(-2);
  v.toggle(key, cx);
  const run = (zoom, reported) => {
    herdrSettings = { font_family: "Mono", zoom };
    v.forcedWidth = null;
    rec = [];
    v.render(cx);
    const calls = rec;
    rec = null;
    handlerAfterId(calls, "threads-root", "on_size_change")({ width: reported, height: 800 * zoom }, cx);
    handlerAfterId(calls, "threads-listbox", "on_size_change")({ width: reported, height: 700 * zoom }, cx);
    rec = [];
    v.render(cx);
    const drawn = rec;
    rec = null;
    return { width: v.width, pane: v.pw(), listH: v.listH, rows: v.rows().map((r) => r.key), est: [...v.sizesMemo], list: lastList, drawn };
  };
  try {
    for (const w of [240, 380, 640]) {
      const one = run(1, w);
      const z = run(0.9, w * 0.9);
      // The pane's width in design px, and the column the turns use: at most fitWidth.
      expect(z.pane).toBeCloseTo(w, 6);
      expect(z.width).toBeCloseTo(columnWidth(w), 6);
      expect(z.listH).toBeCloseTo(700, 6);
      expect(z.rows).toEqual(one.rows);
      expect(z.est).toEqual(one.est);
      // At zoom 1 the list gets the design sizes themselves (whole px).
      expect(one.list.sizes).toEqual(one.est.map((h) => Math.ceil(h)));
      // v_virtual_list scales item sizes by zoom itself (seen drawn at zoom 0.9), so the
      // list gets the same design px as at zoom 1, and each wrapper is its slot.
      expect(z.list.sizes).toEqual(one.list.sizes);
      const hs = z.drawn.filter(([n, x]) => n === "h" && typeof x === "number").map(([, x]) => x);
      for (const slot of z.list.sizes) expect(hs.includes(slot)).toBe(true);
    }
  } finally { herdrSettings = { font_family: "Mono" }; }
});

test("V3a: at zoom 0.9 a press in the action bar hits the button drawn there", async () => {
  const { v, cx } = await pane(fixture("--only", "2"));
  const key = v.turnKeys(v.rows())[0];
  v.toggle(key, cx);
  try {
    for (const w of [240, 380, 640]) {
      herdrSettings = { font_family: "Mono", zoom: 0.9 };
      v.forcedWidth = null;
      rec = [];
      v.render(cx);
      const calls = rec;
      rec = null;
      handlerAfterId(calls, "threads-root", "on_size_change")({ width: w * 0.9, height: 720 }, cx);
      rec = [];
      v.render(cx);
      const down = handlerAfterId(rec, "threads-body", "on_mouse_down");
      rec = null;
      // A pane wider than fitWidth centres a column that wide; a press is read in its px.
      const c = columnWidth(w);
      expect(v.width).toBeCloseTo(c, 6);
      const left = (w - c) / 2;
      const g = v.barGeom(v.findTurn(key));
      for (const [name, b] of Object.entries(g)) {
        if (!b) continue;
        down({ local_position: { x: (left + (b[0] + b[1]) / 2) * 0.9, y: 10 }, bounds: { width: w * 0.9 } });
        v.sel = key;
        // Only the hit is checked: the handlers themselves are covered elsewhere.
        const hit = v.barHit(v.pressX, v.findTurn(key));
        expect(hit).toBe(name);
        expect(v.bodyW).toBeCloseTo(c, 6);
      }
    }
  } finally { herdrSettings = { font_family: "Mono" }; }
});

// ---- round 3: V3b, measured heights, and C1, C3, C5 on top -------------------------------

const PROBED_KINDS = ["you", "rhead", "md", "lhead", "latest", "noreply"];
// Whether a list item is a part of the card for turn key ("0:3": "you:0:3", "md:0:3:1", …).
const partOf = (r, key) => r.key === key || r.key.split(":").slice(1, 3).join(":") === key;
// The probe's entries in a recorded frame: part key -> its on_size_change handler.
function probeEntries(calls) {
  const out = new Map();
  for (let i = 0; i < calls.length; i++) {
    if (calls[i][0] !== "id" || typeof calls[i][1] !== "string" || !calls[i][1].startsWith("th-probe-")) continue;
    const id = calls[i][1];
    out.set(id.slice(9, id.lastIndexOf("-")), handlerAfterId(calls, id, "on_size_change"));
  }
  return out;
}
function frame(v, cx) { rec = []; v.render(cx); const c = rec; rec = null; return c; }

test("V3b: the open card's text parts are measured in the probe, and the list uses the measure", async () => {
  const { v, cx } = await pane(fixture("--extra", "2", "--latest", "--commands", "--blocks"));
  const latestKey = v.current().turns.find((t) => t.latest && t.latest !== v.replyText(t));
  expect(latestKey).toBeTruthy();
  const key = `0:${latestKey.n}`;
  try {
    for (const zoom of [1, 0.9]) for (const w of [240, 380, 640]) {
      herdrSettings = { font_family: "Mono", zoom };
      v.forcedWidth = w; v.width = w;
      v.meas = new Map(); v.probeTries = new Map();
      v.open = new Set([key]);
      const parts = v.rows().filter((r) => PROBED_KINDS.includes(r.kind) && partOf(r, key));
      expect(parts.map((r) => r.kind)).toEqual(expect.arrayContaining(["you", "rhead", "md", "lhead", "latest"]));
      // Each part reports a height in zoomed px; the list then gets that part's size. The
      // probe takes at most 16 parts a frame, so this goes on until it is empty.
      const fed = new Map();
      const probed = new Set();
      const heightOf = (k) => {
        const i = parts.findIndex((r) => r.key === k);
        if (i < 0) return 42;
        return parts[i].kind === "latest" ? 4 * 21 : 40 + i * 13;
      };
      for (let n = 0; n < 20; n++) {
        const probes = probeEntries(frame(v, cx));
        if (!probes.size) break;
        expect(probes.size).toBeLessThanOrEqual(16);
        for (const [k, f] of probes) {
          probed.add(k);
          if (!k.startsWith("cmd:")) fed.set(k, heightOf(k));
          f({ width: v.inner() * zoom, height: heightOf(k) * zoom }, cx);
        }
      }
      // The closed rows' Markdown reply blocks are measured too ("cmd:<key>").
      expect([...probed].filter((k) => !k.startsWith("cmd:")).sort()).toEqual(parts.map((r) => r.key).sort());
      expect(probeEntries(frame(v, cx)).size).toBe(0); // measured parts leave the probe
      const rows = v.rows();
      for (const r of parts) {
        const i = lastList.keys.indexOf(r.key);
        const H = fed.get(r.key);
        const design = r.kind === "latest" ? 6 + H : H;
        expect(v.height(rows[i])).toBe(design);
        expect(lastList.sizes[i]).toBe(Math.ceil(design));
        // No slot is below its measure.
        expect(lastList.sizes[i] / zoom).toBeGreaterThanOrEqual(design - 1e-9);
      }
      // One card: its parts are consecutive items, and only the first and last carry the
      // top and bottom edges.
      const card = rows.map((r, i) => [r, i]).filter(([r]) => partOf(r, key));
      const idx = card.map(([, i]) => i);
      expect(idx).toEqual(idx.map((_, j) => idx[0] + j));
      expect(card[0][0].part).toBe("top");
      expect(card.at(-1)[0].part).toBe("bottom");
      expect(card.slice(1, -1).every(([r]) => !r.part)).toBe(true);
      // The debug report lists each part's estimate, measure and slot.
      v.report();
      const rep = state.shared["threads.debug"].t4;
      expect(rep.zoom).toBe(zoom);
      expect(rep.parts.find((x) => x.startsWith(`rhead:${key} `))).toMatch(/est \d+ · measured: \d+ · slot \d+/);
    }
  } finally { herdrSettings = { font_family: "Mono" }; }
});

test("V3b: reply, latest and YOU TextViews never scroll; a message over 420 px is cut there with Show all, which a press opens in place", async () => {
  const { v, cx } = await pane(fixture("--extra", "2", "--latest", "--langs", "--long", "--blocks"));
  v.prefs = { ...v.prefs, bubbleColor: "plain", agentBubbleColor: "plain" }; // Markdown in the message: the plain look
  v.open = new Set(v.current().turns.map((t) => `0:${t.n}`));
  v.full = new Set(v.current().turns.flatMap((t) => [`0:${t.n}`, `l:0:${t.n}`]));
  views.length = 0;
  frame(v, cx);
  const md = views.filter((x) => /^(th-probe-)?th-(md|lmd)-/.test(x.id));
  expect(md.length).toBeGreaterThan(5);
  for (const x of md) expect(x.calls.some(([n, a]) => n === "scrollable" && a === true)).toBe(false);
  const you = views.filter((x) => x.id.startsWith("th-you-"));
  expect(you.length).toBeGreaterThan(0);
  for (const x of you) expect(x.calls.some(([n, a]) => n === "scrollable" && a === true)).toBe(false);
  for (const x of views.filter((y) => y.id.startsWith("th-probe-"))) expect(x.calls.some(([n]) => n === "scrollable")).toBe(false);
  // The 40-line prompt: its first 420 px, cut, no scrolling box, and Show all in the bubble.
  const capped = v.rows().find((r) => r.kind === "you" && v.youMd(r).capped);
  expect(capped).toBeTruthy();
  const drawn = (r) => { rec = []; v.partContent(theme, r, false); const d = rec; rec = null; return d; };
  let d = drawn(capped);
  expect(d.some(([n]) => n === "overflow_y_scrollbar" || n === "overflow_scroll")).toBe(false);
  expect(d.some(([n, a]) => n === "h" && a === 420)).toBe(true);
  expect(d.some(([n, a]) => n === "child" && a === "Show all")).toBe(true);
  const h0 = v.estimate(capped);
  // A press on the bubble (the list's item click) opens the rest in place; another closes it.
  v.click(capped.key, cx);
  const open = v.rows().find((r) => r.key === capped.key);
  expect(open.all).toBe(true);
  const y = v.youMd(open);
  expect(y).toMatchObject({ capped: false, long: true });
  expect(y.bodyH).toBeGreaterThan(420);
  expect(v.estimate(open)).toBeGreaterThan(h0);
  d = drawn(open);
  expect(d.some(([n, a]) => n === "h" && a === 420)).toBe(false);
  expect(d.some(([n, a]) => n === "child" && a === "Show less")).toBe(true);
  v.click(capped.key, cx);
  expect(v.youMd(v.rows().find((r) => r.key === capped.key)).capped).toBe(true);
});

test("V3b: the first-frame estimate is never under the reading-line reference, and at most a line and 18 px over", async () => {
  const { wrappedLines } = await import("../mods/agent-threads/ui.js");
  const { v, cx } = await pane(fixture("--extra", "4", "--langs", "--edge", "--blocks"));
  v.open = new Set(v.current().turns.map((t) => `0:${t.n}`));
  for (const w of [240, 380, 640]) {
    v.forcedWidth = w; v.width = w; v.meas = new Map();
    let n = 0;
    for (const r of v.rows().filter((x) => x.kind === "md")) {
      const blocks = r.src.split(/\n{2,}/);
      // The reading line (14 px text on 21 px lines, at most about 70 characters wide).
      const per = Math.floor(v.prose() / v.charW(6.1));
      const line = v.rt().line;
      const ref = 6 + blocks.reduce((h, b) => h + wrappedLines(b.replace(/[*_`#>]/g, ""), per) * line, 0) + (blocks.length - 1) * v.paraGap();
      const est = v.estimate(r);
      expect(est).toBeGreaterThanOrEqual(ref);
      expect(est).toBeLessThanOrEqual(ref + line + 18);
      n++;
    }
    expect(n).toBeGreaterThan(5);
  }
  draw(v, cx);
});

test("C3: the open card's reply starts with the first block after the last tool call, and copy and quote send that text", async () => {
  const r = await quotePane("--blocks");
  const { v, cx } = r;
  const t = v.current().turns.find((x) => x.prompt === "Explain the retry change in three parts");
  const key = `0:${t.n}`;
  v.sel = key; v.open = new Set([key]);
  mdSources.length = 0; views.length = 0;
  frame(v, cx);
  const md = mdSources.filter(([id]) => id === `th-md-md:${key}:0`);
  expect(md.length).toBe(1);
  expect(md[0][1].startsWith("Opening words of block one")).toBe(true);
  for (const x of views.filter((y) => y.id.startsWith("th-md-"))) expect(x.calls.some(([n]) => n === "scrollable")).toBe(false);
  const want = v.replyText(t);
  expect(want.startsWith("Opening words of block one")).toBe(true);
  v.copyReply(key, cx);
  expect(cx.clip).toBe(want);
  v.quoteAt = 0;
  v.quote(cx, "button", key);
  await settleCx(cx);
  expect(cx.clip).toBe(`${want.split("\n").map((l) => (l.trim() ? `> ${l}` : ">")).join("\n")}\n\n`);
});

test("C5: LATEST UPDATE is one wrapped block, clamped to whole lines, with Show all only past 6 lines", async () => {
  const { v, cx } = await pane(fixture("--extra", "1", "--latest"));
  v.prefs = { ...v.prefs, truncate: true }; // Shorten long messages
  const t = v.current().turns.find((x) => x.latest && x.latest !== v.replyText(x));
  const key = `0:${t.n}`;
  v.open = new Set([key]);
  try {
    for (const [zoom, reported] of [[1, 380], [0.9, 342]]) {
      herdrSettings = { font_family: "Mono", zoom };
      v.forcedWidth = null; v.meas = new Map(); v.probeTries = new Map();
      handlerAfterId(frame(v, cx), "threads-root", "on_size_change")({ width: reported, height: 800 }, cx);
      expect(v.width).toBeCloseTo(columnWidth(380), 6);
      const lt = v.rows().find((r) => r.kind === "latest");
      let calls = frame(v, cx);
      // The probe measures the block at the card's design text width.
      const at = calls.findIndex(([n, x]) => n === "id" && String(x).startsWith(`th-probe-${lt.key}-`));
      expect(calls.slice(at, at + 4).some(([n, x]) => n === "w" && x === v.inner())).toBe(true);
      expect(v.inner()).toBe(columnWidth(380) - 32);
      // One text child, not one per line.
      expect(calls.filter(([n, x]) => n === "child" && x === lt.text).length).toBe(2); // the list and the probe
      const feed = (lines) => probeEntries(calls).get(lt.key)({ width: v.inner() * zoom, height: lines * 22 * zoom }, cx);
      feed(4);
      expect(v.latestBox(lt)).toBe(88);
      expect(v.latestCut(lt)).toBe(false);
      expect(v.height(lt)).toBe(6 + 88);
      calls = frame(v, cx);
      expect(calls.some(([n, x]) => n === "child" && x === "Show all")).toBe(false);
      v.meas = new Map(); v.probeTries = new Map();
      calls = frame(v, cx);
      feed(9);
      expect(v.latestBox(lt)).toBe(132);
      expect(v.latestCut(lt)).toBe(true);
      expect(v.height(lt)).toBe(6 + 132 + 22);
      calls = frame(v, cx);
      expect(calls.some(([n, x]) => n === "child" && x === "Show all")).toBe(true);
      expect(calls.some(([n, x]) => n === "h" && x === 132)).toBe(true);
      // A click on it shows all.
      v.click(lt.key, cx);
      expect(v.full.has(`l:${key}`)).toBe(true);
      v.full.clear();
    }
  } finally { herdrSettings = { font_family: "Mono" }; }
});

// ---- round 3: C2, what the chips mean ------------------------------------------------------

test("Turn card: i opens the selected turn's numbers over the bottom of the pane, follows the selection, and opens nothing in the list", async () => {
  const { v, cx } = await pane(fixture());
  const t = v.current().turns.find((x) => x.compactions > 0 && stats(x).cachePct != null);
  expect(t).toBeTruthy();
  const key = `0:${t.n}`;
  v.sel = key;
  v.width = 380;
  const kinds = () => v.rows().filter((r) => partOf(r, key)).map((r) => r.kind);
  // The numbers are no longer parts of the open work.
  v.open = new Set([key]);
  v.toggleLine(key);
  expect(kinds()).not.toContain("stats");
  expect(kinds()).not.toContain("legend");
  const before = v.rows().map((r) => r.key).join(",");
  v.key(keyEv("i"), cx);
  expect(v.detailsOpen).toBe(true);
  // The list does not change under the card.
  expect(v.rows().map((r) => r.key).join(",")).toBe(before);
  // Context compacted first, then model, tokens, tool calls and cache hit with its counts.
  const rows = v.detailRows(t);
  expect(rows.map((r) => r[0])).toEqual(["Context", "Model", "Tokens", "Tool calls", "Cache hit"]);
  const cache = rows.find((r) => r[0] === "Cache hit");
  expect(cache[1]).toMatch(/^[\d.]+%$/);
  expect(cache[3]).toMatch(/^read [\d,]+ · written [\d,]+ · new input [\d,]+$/);
  expect(rows.find((r) => r[0] === "Tokens")[2]).toMatch(/cache read count\.$/);
  // Elapsed time stays on "Worked for" and is not repeated.
  expect(rows.some((r) => /^\d+[hms]/.test(r[1]))).toBe(false);
  // Drawn over the list with its title, each value and what it means.
  let calls = frame(v, cx);
  const ids = calls.filter(([n]) => n === "id").map((c) => c[1]);
  expect(ids).toContain("th-details");
  expect(calls.some(([n, x]) => n === "child" && x === `Turn #${t.n}`)).toBe(true);
  for (const [, value, what, under] of rows) {
    expect(calls.some(([n, x]) => n === "child" && x === value)).toBe(true);
    expect(calls.some(([n, x]) => n === "child" && x === what)).toBe(true);
    if (under) expect(calls.some(([n, x]) => n === "child" && x === under)).toBe(true);
  }
  // It follows the selection: down shows the next turn's numbers.
  v.key(keyEv("down"), cx);
  expect(v.detailsOpen).toBe(true);
  expect(v.sel).not.toBe(key);
  calls = frame(v, cx);
  expect(calls.some(([n, x]) => n === "child" && x === `Turn #${v.findTurn(v.sel).n}`)).toBe(true);
  // i closes it, and so does Esc, before anything else Esc does.
  v.key(keyEv("i"), cx);
  expect(v.detailsOpen).toBe(false);
  expect(frame(v, cx).some(([n, x]) => n === "id" && x === "th-details")).toBe(false);
  v.sel = key;
  v.key(keyEv("i"), cx);
  v.action("escape", cx);
  expect(v.detailsOpen).toBe(false);
  expect(v.open.has(key)).toBe(true);
  // i on a closed turn opens the card and leaves the turn closed.
  v.open.clear();
  v.key(keyEv("i"), cx);
  expect(v.detailsOpen).toBe(true);
  expect(v.open.has(key)).toBe(false);
  // The ? sheet and the card do not stack.
  v.action("keys", cx);
  expect(v.detailsOpen).toBe(false);
  v.key(keyEv("i"), cx);
  expect(v.keysOpen).toBe(false);
  expect(v.detailsOpen).toBe(true);
  v.action("escape", cx);
  // With nothing selected, i does nothing.
  v.sel = null;
  expect(v.action("legend", cx)).toBe(false);
  expect(v.detailsOpen).toBe(false);
  // A turn without a cache count or compaction lists only what it has.
  const plain = v.current().turns.find((x) => !x.compactions && stats(x).cachePct == null);
  if (plain) {
    const names = v.detailRows(plain).map((r) => r[0]);
    expect(names).not.toContain("Cache hit");
    expect(names).not.toContain("Context");
    expect(names).toContain("Tool calls");
  }
  // The ? sheet names the key; the footer keeps to the most-used keys.
  const { keySheet } = await import("../mods/agent-threads/ui.js");
  expect(keySheet("q").flatMap(([, items]) => items).find(([k]) => k[0] === "i" && k.length === 1)?.[1]).toBe("Show or hide the turn's numbers");
  expect(v.footerHints().map(([k, l]) => `${k} ${l}`)).not.toContain("i explain");
});

test("Turn card: resting the pointer on a line's info icon shows the card, on a closed or an open turn, with no click", async () => {
  const { v } = await pane(fixture());
  const t = v.current().turns.find((x) => x.tools > 0 && x.done);
  const key = `0:${t.n}`;
  v.width = 380;
  v.bodyW = 380;
  const rowOf = (sel) => { rec = []; v.rowItem(theme, v.rows().find((r) => r.key === key), sel); const c = rec; rec = null; return c; };
  const partOfLine = (probe = false) => { rec = []; v.partContent(theme, v.rows().find((r) => r.key === `rhead:${key}`), probe); const c = rec; rec = null; return c; };
  const hover = (c) => {
    const i = c.findIndex((e) => e[0] === "HoverCard" && e[1] === `th-hover-${key}`);
    return i < 0 ? null : c.slice(i);
  };
  // A closed turn, not selected and selected: the icon is a HoverCard's trigger, the card its
  // content, anchored under the icon's right edge, with no close mark.
  for (const sel of [null, key]) {
    v.sel = sel;
    const h = hover(rowOf(sel === key));
    expect(h).not.toBeNull();
    expect(h.some((e) => e[0] === "anchor" && e[1] === "top_right")).toBe(true);
    expect(h.some((e) => e[0] === "open_delay")).toBe(true);
    expect(h.some((e) => e[0] === "child" && e[1] === `Turn #${t.n}`)).toBe(true);
    expect(h.some((e) => e[0] === "id" && e[1] === "th-details-hover")).toBe(true);
    expect(h.filter((e) => e[0] === "svg").map((e) => String(e[1]).split("/").pop())).not.toContain("x.svg");
  }
  // Hovering opens nothing: no state changes, so the turn stays closed.
  expect(v.detailsOpen).toBe(false);
  expect(v.open.has(key)).toBe(false);
  // An open turn: on its own line item, never in the hidden probe.
  v.open = new Set([key]);
  v.sel = null;
  expect(hover(partOfLine())).not.toBeNull();
  expect(partOfLine(true).some((e) => e[0] === "HoverCard")).toBe(false);
  // While i's card is open, no hover cards, so only one card shows.
  v.sel = key;
  v.detailsOpen = true;
  const c = partOfLine();
  expect(c.some((e) => e[0] === "HoverCard")).toBe(false);
  expect(c.some((e) => e[0] === "Popup" && e[1] === `th-details-${key}`)).toBe(true);
  // A running turn has no settled line, so no card.
  v.detailsOpen = false;
  const run = v.rows().find((r) => r.kind === "turn" && (r.running || r.live));
  if (run) {
    rec = []; v.rowItem(theme, run, false); const rc = rec; rec = null;
    expect(rc.some((e) => e[0] === "HoverCard")).toBe(false);
  }
});

test("Turn card: every settled Worked for line has the info icon, on the selected turn and under the pointer, and a press on it opens the card beside it", async () => {
  const { v, cx } = await pane(fixture());
  const t = v.current().turns.find((x) => x.tools > 0 && x.done);
  const key = `0:${t.n}`;
  v.width = 380;
  v.bodyW = 380;
  const right = 16 + Math.min(380 - 32, v.prose());
  const partOfLine = () => { rec = []; v.partContent(theme, v.rows().find((r) => r.key === `rhead:${key}`), false); const c = rec; rec = null; return c; };
  const rowOf = () => { rec = []; v.rowItem(theme, v.rows().find((r) => r.key === key), true); const c = rec; rec = null; return c; };
  const icons = (c) => c.filter((e) => e[0] === "svg").map((e) => String(e[1]).split("/").pop());
  // A closed turn: its row's line has the icon, dim, with no fade.
  v.sel = key;
  expect(icons(rowOf())).toContain("info.svg");
  v.sel = null;
  let c = rowOf();
  expect(icons(c)).toContain("info.svg");
  let at = c.findIndex((e) => e[0] === "svg" && String(e[1]).endsWith("info.svg"));
  expect(c.slice(at + 1, at + 5)).toContainEqual(["text_color", theme.dim]);
  expect(c.slice(at + 1, at + 5).some((e) => e[0] === "opacity")).toBe(false);
  // An open turn with its line closed: the icon too.
  v.open = new Set([key]);
  v.sel = key;
  expect(v.lineIsOpen(key, false)).toBe(false);
  expect(v.infoState(key)).toBe("sel");
  expect(icons(partOfLine())).toContain("info.svg");
  v.sel = null;
  expect(v.infoState(key)).toBe("hover");
  c = partOfLine();
  at = c.findIndex((e) => e[0] === "svg" && String(e[1]).endsWith("info.svg"));
  expect(c.slice(at + 1, at + 5)).toContainEqual(["text_color", theme.dim]);
  expect(c.slice(at + 1, at + 5).some((e) => e[0] === "opacity")).toBe(false);
  // A press at the line's right end opens the card on that turn and leaves the line closed.
  v.pressX = right - 6;
  v.click(`rhead:${key}`, cx);
  expect(v.detailsOpen).toBe(true);
  expect(v.sel).toBe(key);
  expect(v.lineIsOpen(key, false)).toBe(false);
  expect(v.infoState(key)).toBe("on");
  // The card is a Popup on the icon, its top right corner under the icon's right edge.
  c = partOfLine();
  const pop = c.findIndex((e) => e[0] === "Popup" && e[1] === `th-details-${key}`);
  expect(pop).toBeGreaterThan(-1);
  expect(c.slice(pop).some((e) => e[0] === "anchor" && e[1] === "top_right")).toBe(true);
  expect(c.some((e) => e[0] === "child" && e[1] === `Turn #${t.n}`)).toBe(true);
  // Never in the hidden probe.
  rec = []; v.partContent(theme, v.rows().find((r) => r.key === `rhead:${key}`), true); const pc = rec; rec = null;
  expect(pc.some((e) => e[0] === "Popup")).toBe(false);
  // While open, any press closes it and does nothing else: a press on the words of the line
  // does not open the line.
  v.pressX = 40;
  v.click(`rhead:${key}`, cx);
  expect(v.detailsOpen).toBe(false);
  expect(v.lineIsOpen(key, false)).toBe(false);
  // With the card closed, a press on the words opens the line, as before.
  v.pressX = 40;
  v.click(`rhead:${key}`, cx);
  expect(v.lineIsOpen(key, false)).toBe(true);
  // The icon again on the open line: the card, and the line stays open.
  v.pressX = right - 6;
  v.click(`rhead:${key}`, cx);
  expect(v.detailsOpen).toBe(true);
  expect(v.lineIsOpen(key, false)).toBe(true);
  // A press on another item while open closes the card and leaves that item alone.
  const md = v.rows().find((r) => r.kind === "md" && partOf(r, key));
  if (md) {
    v.click(md.key, cx);
    expect(v.detailsOpen).toBe(false);
  }
  // A keyboard press (no position) on the line toggles the line.
  v.pressX = null; v.mouseX = null;
  v.click(`rhead:${key}`, cx);
  expect(v.lineIsOpen(key, false)).toBe(false);
});

test("Turn card: i opens it beside the selected turn's line, brings that line on screen first, and opens upward when the line sits low", async () => {
  const { v, cx } = await pane(fixture());
  // Short closed rows (Shorten long messages), so the made-up 120 px row sizes below match
  // the rows' shapes.
  v.prefs = { ...v.prefs, truncate: true };
  const turns = v.current().turns.filter((x) => x.done);
  const t = turns[turns.length - 2];
  const key = `0:${t.n}`;
  v.width = 380;
  v.sel = key;
  const rows = v.rows();
  v.rowsMemo = rows;
  // A closed turn: the anchor is its row; an open one: its line.
  expect(v.detailsAnchor(key)).toBe(key);
  // Off screen: i asks the list to bring the row on screen.
  const i = rows.findIndex((r) => r.key === key);
  v.viewRange = [i + 1, i + 3];
  v.scrollTo = null;
  v.key(keyEv("i"), cx);
  expect(v.detailsOpen).toBe(true);
  expect(v.scrollTo).toMatchObject({ key, how: "top" });
  v.action("escape", cx);
  // On screen near the top: no scroll, and the card opens down.
  v.viewRange = [i, i + 4];
  v.scrollTo = null;
  v.key(keyEv("i"), cx);
  expect(v.scrollTo).toBe(null);
  expect(v.detailsDir(key, t)).toBe("down");
  // Low in the pane: up.
  v.sizesMemo = rows.map(() => 120);
  v.listH = 600;
  v.viewRange = [Math.max(0, i - 4), i + 1];
  expect(i).toBeGreaterThanOrEqual(4);
  {
    expect(v.detailsDir(key, t)).toBe("up");
    rec = []; v.rowItem(theme, v.rows().find((r) => r.key === key), true); const c = rec; rec = null;
    expect(c.some((e) => e[0] === "anchor" && e[1] === "bottom_right")).toBe(true);
  }
  v.action("escape", cx);
  // An open turn anchors to its line.
  v.open = new Set([key]);
  v.rowsMemo = v.rows();
  expect(v.detailsAnchor(key)).toBe(`rhead:${key}`);
  // The card's width keeps its left edge in the pane.
  expect(v.cardW()).toBeLessThanOrEqual(Math.min(380 - 32, v.prose()) + 8);
  expect(v.cardH(t)).toBeGreaterThan(100);
});

// ---- round 3: D1 ----------------------------------------------------------------------------

test("D1: LATEST UPDATE draws in muted, or foreground where muted is faint; the chat look has no FINAL REPLY or YOU label", async () => {
  const { v, cx } = await pane(fixture("--extra", "1", "--latest"));
  const t = v.current().turns.find((x) => x.latest && x.latest !== v.replyText(x));
  v.open = new Set([`0:${t.n}`]);
  v.toggleLine(`0:${t.n}`);
  v.width = 380;
  const colourOf = (calls, text) => {
    const i = calls.findIndex(([n, x]) => n === "child" && x === text);
    for (let j = i - 1; j >= 0 && j > i - 8; j--) if (calls[j][0] === "text_color") return calls[j][1];
    return null;
  };
  let calls = frame(v, cx);
  for (const label of ["LATEST UPDATE"]) expect(colourOf(calls, label)).toBe(theme.muted);
  expect(calls.some(([n, x]) => n === "child" && (x === "FINAL REPLY" || x === "YOU" || x === "USER"))).toBe(false);
  // A theme whose muted reads under 4.5:1 on the card: foreground.
  const faint = { ...theme, muted: "#5a5a5a" };
  const real = theme.muted;
  try {
    Object.assign(theme, faint);
    calls = frame(v, cx);
    for (const label of ["LATEST UPDATE"]) expect(colourOf(calls, label)).toBe(theme.foreground);
  } finally { theme.muted = real; }
  draw(v, cx);
  expect(state.shared["threads.debug"].t4.contrast[0]).toMatch(/ card label muted \([\d.]+ on raised\) /);
});

test("the Jump to latest pill, the rail card, the Turn card, the ? sheet and toasts have an opaque fill, at rest and under the pointer", async () => {
  const { v } = await pane(fixture("--only", "2"));
  // Graphite and paper give hover with alpha, and a theme may give popover so.
  for (const th of [
    { ...theme, background: "#1d1f22", popover: "#25272b", hover: "#ffffff0e" },
    { ...theme, background: "#f7f7f5", popover: "#ffffff", hover: "#0000000c" },
    { ...theme, background: "#1d1f22", popover: "#25272bcc", hover: "#ffffff0e" },
  ]) {
    const rest = v.solidFill(th);
    const hover = v.solidFill(th, th.hover);
    for (const c of [rest, hover]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(hover).not.toBe(rest);
    // The pill: the opaque fill, and the opaque hover fill in its hover style.
    rec = []; v.pillView(th); const pc = rec; rec = null;
    expect(pc.some((e) => e[0] === "bg" && e[1] === rest)).toBe(true);
    // The stub applies a hover style as it is described, so its fill is recorded too.
    expect(pc).toContainEqual(["bg", hover]);
    expect(pc.some((e) => e[0] === "bg" && String(e[1]).length === 9)).toBe(false);
    // The ? sheet and a toast.
    rec = []; v.keySheetView(th); const kc = rec; rec = null;
    expect(kc.some((e) => e[0] === "bg" && e[1] === rest)).toBe(true);
    v.toast = { text: "x", at: 1 };
    rec = []; v.toastView(th); const tc = rec; rec = null;
    v.toast = null;
    expect(tc.some((e) => e[0] === "bg" && e[1] === rest)).toBe(true);
    // The Turn card, opened by i or the pointer on the info icon.
    const turn = v.current().turns.find((x) => x.done);
    rec = []; v.detailsCard(th, turn); const dc = rec; rec = null;
    expect(dc.some((e) => e[0] === "bg" && e[1] === rest)).toBe(true);
    expect(dc.some((e) => e[0] === "bg" && e[1] === th.popover)).toBe(th.popover === rest);
  }
  // An opaque popover over an opaque background is itself.
  expect(v.solidFill({ ...theme, background: "#1d1f22", popover: "#25272b" })).toBe("#25272b");
  // The rail card.
  const src = readFileSync(join(modDir, "main.js"), "utf8");
  expect(src.match(/railCardView\(t, k\) \{[\s\S]*?\n {2}\}/)[0]).toContain("this.solidFill(t)");
});

// ---- round 3: B4 hardening -----------------------------------------------------------------

test("B4: a clipboard write that throws says Couldn't copy and marks nothing copied", async () => {
  const { v, cx } = await quotePane("--langs");
  const key = v.sel;
  cx.write_to_clipboard = () => { throw new Error("no pasteboard"); };
  v.copyReply(key, cx);
  expect(v.toast).toMatchObject({ text: "Couldn't copy", icon: "circle-x" });
  expect(v.copied).toBe(null);
  // A code block's Copy, through the same path.
  const t = v.current().turns.find((x) => segments(v.replyText(x)).some((g) => g.kind === "code"));
  const i = segments(v.replyText(t)).findIndex((g) => g.kind === "code");
  v.toast = null;
  v.click(`cc:0:${t.n}:${i}`, cx);
  expect(v.toast.text).toBe("Couldn't copy");
  expect(v.copied).toBe(null);
  // And a write that works marks it copied.
  cx.write_to_clipboard = (x) => { cx.clip = x; };
  v.copyReply(key, cx);
  expect(v.copied?.id).toBe(`reply:${key}`);
});

test("B4: while an editor has the keyboard, navigation keys are the editor's; Esc and s still return", async () => {
  const { v, cx } = await quotePane();
  const key = v.sel;
  v.toggleSelect(key, cx);
  editors.at(-1).handlers.focus();
  expect(v.editorFocused).toBe(true);
  for (const k of ["down", "up", "j", "k", "g", "home", "end", "enter", "space", "[", "]", "/", "t", "a", "c"]) {
    v.key(keyEv(k), cx);
    expect(v.sel, k).toBe(key);
    expect(v.selecting, k).toBe(key);
    expect(v.filtering, k).toBe(false);
  }
  expect(log.filter((x) => x[0] === "run" || x[0] === "clipboard")).toEqual([]);
  v.key(keyEv("escape"), cx);
  expect(v.selecting).toBe(null);
  expect(v.open.has(key)).toBe(true);
  // s also returns.
  v.toggleSelect(key, cx);
  editors.at(-1).handlers.focus();
  v.key(keyEv("s"), cx);
  expect(v.selecting).toBe(null);
});

test("opening a card brings its last part on screen, then its head; closing scrolls only to the row", async () => {
  const { v, cx } = await pane(fixture("--extra", "3", "--latest", "--langs"));
  const calls = [];
  v.scroll = { scroll_to_bottom() {}, scroll_to_item(i, how) { calls.push([i, how]); } };
  v.render(cx);
  cx.flush();
  calls.length = 0;
  const key = v.turnKeys(v.rows()).at(-3);
  v.toggle(key, cx);
  v.render(cx);
  cx.flush();
  const rows = v.rows();
  const head = rows.findIndex((r) => r.key === key);
  let last = head;
  while (last + 1 < rows.length && rows[last + 1].kind !== "head" && rows[last + 1].kind !== "turn" && rows[last + 1].kind !== "spacer" && rows[last + 1].kind !== "wrow") last++;
  expect(rows[head].kind).toBe("head");
  expect(rows[last].kind).toBe("copy");
  expect(calls).toEqual([[last, "top"], [head, "top"]]);
  calls.length = 0;
  v.toggle(key, cx);
  v.render(cx);
  cx.flush();
  expect(calls).toEqual([[v.rows().findIndex((r) => r.key === key), "top"]]);
});

test("the Quote button in Select view quotes what ⌘C copied and leaves the keyboard with the editor", async () => {
  const { v, cx } = await quotePane();
  const key = v.sel;
  v.toggleSelect(key, cx);
  const reply = v.replyText(v.findTurn(key));
  cx.clip = reply.split(/\s+/).slice(2, 5).join(" ");
  const order = [];
  const focus = v.h.focus;
  v.h.focus = () => { order.push("panel focus"); };
  const hit = v.barHit;
  v.barHit = () => "quote";
  try {
    v.editorFocused = true;
    v.click(`cp:${key}`, cx);
    expect(order).toEqual([]);
    cx.flush();
    await settleCx(cx);
    expect(v.lastQuote).toMatchObject({ source: "selection", via: "button", pasted: true });
  } finally { v.h.focus = focus; v.barHit = hit; }
});

test("pasted images: tiles over the message at any width, decoded on first draw, and one click on a tile opens the review", async () => {
  const { v, cx } = await pane(fixture("--extra", "2", "--images"));
  const turns = v.current().turns.filter((t) => t.images.length);
  expect(turns.map((t) => t.images.map((i) => i.n))).toEqual([[1], [2, 3], [4]]);
  expect(turns.every((t) => /^[0-9a-f-]{36}$/.test(t.imgLine))).toBe(true);
  expect(turns[2].prompt).toBe("[Image #4]");
  const two = turns[1];
  const key = `0:${two.n}`;
  // A row of tiles over the bubble: a third of the widest bubble high (56 to 120 px), and a gap.
  for (const [w, size] of [[240, 58], [380, 91], [640, 120]]) {
    v.width = w;
    expect(thumbSize(w)).toBe(size);
    expect(v.shape(two).thumbs).toBe(true);
    expect(v.shape(two).height - v.shape({ ...two, images: [], shapeKey: null }).height).toBe(size + ROW.GAP);
  }
  v.width = 380;
  // Nothing is decoded until a row with images is drawn; then one prompt at a time.
  expect(v.imgs?.size ?? 0).toBe(0);
  for (let i = 0; i < 40 && !(turns.every((t) => v.imgState(t) === "ok")); i++) {
    v.render(cx); cx.flush();
    await new Promise((r) => setTimeout(r, 20));
  }
  for (const t of turns) expect(v.imgState(t)).toBe("ok");
  const f = v.imgFile(two, 0);
  expect(f).toEqual({ i: 0, path: `data/agent-threads/images/f/${two.imgLine}-0.png`, w: 300, h: 600 });
  expect(existsSync(join(app, f.path))).toBe(true);
  expect(v.imgFile(two, 1)).toMatchObject({ w: 400, h: 400 });
  // Tiles take their image's shape: a tall one is 0.75 of the height wide, a square one square.
  const L = v.tileLayout(two);
  expect(L.tiles).toEqual([{ i: 0, w: 68, x: 0 }, { i: 1, w: 91, x: 74 }]);
  expect(L.more).toBe(0);
  // At rest the meta line and tiles are an item of their own over the row (wtop), and the
  // two add up to the row's shape.
  v.fitKey = null;
  let rows = v.rows();
  const at = (k) => rows.findIndex((r) => r.key === k);
  expect(rows[at(`imgs:${key}`)]).toMatchObject({ kind: "wtop", turnKey: key });
  expect(rows[at(`imgs:${key}`) + 1]).toMatchObject({ kind: "turn", key, split: true });
  expect(v.height(rows[at(`imgs:${key}`)]) + v.height(rows[at(key)])).toBe(v.shape(two).height);
  // One click on the second tile at rest opens the review at that image. The turn is
  // selected and stays closed, and nothing else changes.
  v.bodyW = 380;
  v.sel = null;
  overlays.length = 0;
  v.pressX = 380 - ROW.PAD_X - 10; // inside the right-hand tile
  v.click(`imgs:${key}`, cx);
  expect(overlays).toHaveLength(1);
  expect(overlays[0]).toMatchObject({ mod: "agent-threads", kind: "dialog", width: 1, height: 1, props: { gallery: { at: 1, title: `#${two.n}` } } });
  expect(overlays[0].props.gallery.images.map((x) => [x.path, x.w, x.h])).toEqual([[f.path, 300, 600], [v.imgFile(two, 1).path, 400, 400]]);
  expect(v.sel).toBe(key);
  expect(v.open.has(key)).toBe(false);
  // The reading panel's copy of the turn: its prompt with the labels, the reply, the stats
  // and the bubble's colours, and the panel shown (settings.json viewerReply).
  const vt = overlays[0].props.gallery.turn;
  expect(overlays[0].props.gallery.panel).toBe(true);
  expect(vt).toMatchObject({ n: two.n, agent: false, who: "User", running: false, md: v.replyText(two), copy: v.replyText(two), stats: v.statsFull(two), caption: v.captionParts(two), size: 14 });
  expect(vt.prompt).toContain("[Image #2] [Image #3]");
  expect(vt.fill).toBe(v.bubbleLook(theme, false).style.fill);
  v.prefs = { ...v.prefs, viewerReply: false };
  overlays.length = 0;
  v.pressX = 380 - ROW.PAD_X - 10;
  v.click(`imgs:${key}`, cx);
  expect(overlays[0].props.gallery.panel).toBe(false);
  v.prefs = { ...v.prefs, viewerReply: true };
  // A press beside the tiles opens the turn, as a press on the rest of its row does.
  overlays.length = 0;
  v.pressX = 40;
  v.click(`imgs:${key}`, cx);
  expect(overlays).toHaveLength(0);
  expect(v.open.has(key)).toBe(true);
  // Open: the tiles over the message, and a tile still opens the review in one click. No
  // larger image shows inside the turn.
  rows = v.rows();
  expect(at(`imgs:${key}`)).toBe(at(key) + 1);
  expect(rows[at(`imgs:${key}`)].kind).toBe("imgs");
  expect(at(`you:${key}`)).toBe(at(`imgs:${key}`) + 1);
  expect(v.height(rows[at(`imgs:${key}`)])).toBe(8 + 91);
  v.pressX = 380 - ROW.PAD_X - 10;
  v.click(`imgs:${key}`, cx);
  expect(overlays).toHaveLength(1);
  expect(overlays[0].props.gallery.at).toBe(1);
  expect(v.open.has(key)).toBe(true);
  expect(v.rows().some((r) => r.kind === "img")).toBe(false);
  // Beside the tiles of an open turn: it stays open and selected.
  v.pressX = 40;
  v.click(`imgs:${key}`, cx);
  expect(v.open.has(key)).toBe(true);
  expect(overlays).toHaveLength(1);
  // Drawn rows and cards hold image elements with the cached paths.
  rec = [];
  v.render(cx);
  const drawn = rec; rec = null;
  expect(drawn.some(([n]) => n === "size_full")).toBe(true);
});

// A running turn with pasted images (what the owner saw in Codex: the tiles came only once
// the turn ended). Its meta line and tiles are an item of their own over the running row, and
// a press on a tile opens the message's images full window.
test("a running turn shows its pasted images, and a tile opens the viewer", async () => {
  const { v, cx } = await pane(fixture("--extra", "2", "--images"));
  const s = v.current();
  const two = s.turns.find((t) => t.images.length === 2);
  const last = s.turns.at(-1);
  Object.assign(last, { images: two.images, imgLine: two.imgLine, done: false, shapeKey: null });
  s.version++;
  v.width = 380;
  v.sel = null; v.fitKey = null;
  const key = `0:${last.n}`;
  let rows = v.rows();
  const at = (k) => rows.findIndex((r) => r.key === k);
  expect(rows[at(`imgs:${key}`)]).toMatchObject({ kind: "wtop", turnKey: key });
  expect(rows[at(`imgs:${key}`) + 1]).toMatchObject({ kind: "wrow", key, split: true });
  // The tiles are 91 px at 380 px, at the top of the row; the row under them starts at its
  // bubble, 6 px down.
  expect(v.height(rows[at(`imgs:${key}`)])).toBe(ROW.PAD_T + 91);
  const wrow = rows[at(key)];
  expect(v.shape(last, true).thumbs).toBeUndefined();
  expect(v.height(wrow)).toBe(v.shape(last, true).height - ROW.PAD_T + ROW.GAP);
  // Decoded on first draw, as in a finished turn.
  for (let i = 0; i < 40 && v.imgState(last) !== "ok"; i++) {
    v.render(cx); cx.flush();
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(v.imgState(last)).toBe("ok");
  rec = [];
  draw(v, cx);
  const drawn = rec; rec = null;
  expect(drawn.some(([n]) => n === "size_full")).toBe(true);
  expect(state.shared["threads.debug"].t4.detail.some((d) => d.startsWith(`wtop#${last.n} tiles 2`))).toBe(true);
  // Selected, it is the working card, still under its tiles, 24 px shorter than one with no tiles.
  v.sel = key; v.fitKey = null;
  rows = v.rows();
  const card = rows[at(key)];
  expect(card).toMatchObject({ kind: "working", split: true });
  expect(rows[at(key) - 1].kind).toBe("wtop");
  const g = v.workingGeom(last);
  expect(v.estimate(card)).toBe(6 + v.youHeight(v.workYou(card)) + 6 + 16 + 6 + 24 + 6 + g.note * 20 + 10);
  draw(v, cx);
  // A press beside the tiles selects the turn; one on the second tile opens the viewer at it.
  overlays.length = 0;
  v.sel = null;
  v.bodyW = 380;
  v.pressX = 40;
  v.click(`imgs:${key}`, cx);
  expect(overlays).toHaveLength(0);
  expect(v.sel).toBe(key);
  v.pressX = 380 - ROW.PAD_X - 10;
  v.click(`imgs:${key}`, cx);
  expect(overlays).toHaveLength(1);
  expect(overlays[0]).toMatchObject({ kind: "dialog", width: 1, height: 1, props: { gallery: { at: 1, title: `#${last.n}` } } });
  expect(overlays[0].props.gallery.images).toHaveLength(2);
  // No image tile is drawn larger under a running turn.
  expect(v.rows().some((r) => r.kind === "img")).toBe(false);
  // Once it ends it is a closed row, and its tiles stay an item of their own over it.
  last.done = true; last.shapeKey = null; s.version++; v.fitKey = null;
  rows = v.rows();
  expect(rows[at(key) - 1].kind).toBe("wtop");
  expect(rows[at(key)]).toMatchObject({ kind: "turn", split: true });
  expect(rows[at(key)].shape.thumbs).toBe(true);
});

test("tiles that do not fit the widest bubble end in +N", () => {
  const sq = { w: 400, h: 400 };
  const L = tileRow([sq, sq, sq, sq, sq], 380);
  expect(L.tiles.map((c) => c.i)).toEqual([0, 1]);
  expect(L.more).toBe(3);
  expect(L.width).toBeLessThanOrEqual(bubbleMax(380));
  expect(tileRow([null], 240).tiles).toEqual([{ i: 0, w: 58, x: 0 }]);
});

test("a session over several days draws a day band per day, with its shown turns counted", async () => {
  // Four turns 12 hours apart from 1 Nov 09:12 UTC span three local days in any time zone.
  const { v, cx } = await pane(fixture("--only", "4", "--gap", "43200"));
  draw(v, cx);
  const days = v.rows().filter((r) => r.kind === "day");
  expect(days.length).toBeGreaterThan(1);
  expect(days.reduce((n, r) => n + r.count, 0)).toBe(v.turnKeys(v.rows()).length);
  for (const r of days) {
    expect(r.name).toMatch(/^(Today|Yesterday|[A-Z][a-z]+day \d{1,2} [A-Z][a-z]{2})$/);
    expect(v.height(r)).toBe(46);
  }
  expect(state.shared["threads.debug"].t4.rows.filter((x) => x === "day").length).toBe(days.length);
  // A search shows no day bands.
  v.query = "turn"; draw(v, cx);
  expect(v.rows().some((r) => r.kind === "day")).toBe(false);
});

// ---- two Claude terminals that share a transcript folder --------------------------------

const SESSION_A = "00000000-0000-4000-8000-00000000000a";
const SESSION_B = "00000000-0000-4000-8000-00000000000b";
// A claude home with one project folder holding both sessions. B's file is newer, as a busier
// session's is. Each has one made-up turn.
function sharedFolder() {
  const home = mkdtempSync(join(tmpdir(), "threads-home-"));
  const cwd = "/tmp/threads-shared";
  const folder = join(home, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  execFileSync("mkdir", ["-p", folder, join(home, "sessions")]);
  const write = (id, text, secs) => {
    const file = join(folder, `${id}.jsonl`);
    const at = new Date(Date.parse("2026-11-01T09:00:00Z") + secs * 1000).toISOString();
    writeFileSync(file, `${JSON.stringify({ type: "user", origin: { kind: "human" }, uuid: id, timestamp: at, message: { role: "user", content: text } })}\n`);
    utimesSync(file, new Date(Date.now() + secs * 1000), new Date(Date.now() + secs * 1000));
    return file;
  };
  const a = write(SESSION_A, "Prompt in session A", 0);
  const b = write(SESSION_B, "Prompt in session B", 5);
  const record = (pid, id) => {
    const path = join(home, "sessions", `${pid}.json`);
    const text = JSON.stringify({ pid, sessionId: id, cwd });
    writeFileSync(path, text);
    recordFiles[path] = text;
  };
  return { home, cwd, a, b, record };
}
function fg(pid, cwd, argv = ["claude"]) {
  return JSON.stringify({ foreground: { name: "claude", argv, pid, cwd }, cwd });
}
function sharedState(f, terminal) {
  state = {
    terminals: [{ address: "t3b", status: "idle", cwd: f.cwd }, { address: "t3c", status: "idle", cwd: f.cwd }],
    panes: ["t3b", "t3c"].map((t) => ({ pane: `p${t}`, tab: "A", terminal: t, app: "claude-code", cwd: f.cwd, program: { key: "claude", name: "Claude Code" } }))
      .concat([{ pane: "pm", tab: "A", terminal: null, mod: "agent-threads" }]),
    props: { terminal, claudeHome: f.home, debug: true }, shared: {},
  };
  const v = new Threads();
  const cx = makeCx();
  v.init(state.props, cx);
  return { v, cx };
}
async function looked(v) {
  // The watch and command loops never end, so wait on the flags, not on cx.pending.
  await new Promise((r) => setTimeout(r, 30));
  await until(() => !v.resolving && !v.reading, "the lookup");
  await new Promise((r) => setTimeout(r, 30));
  await until(() => !v.resolving && !v.reading, "the read");
}
const shownPrompts = (v) => v.sessions.flatMap((s) => s.turns.map((t) => t.prompt));

test("each terminal in a shared folder binds its own session, whichever file is newer", async () => {
  const f = sharedFolder();
  f.record(5101, SESSION_A);
  f.record(5102, SESSION_B);
  hcBy = { t3c: fg(5101, f.cwd), t3b: fg(5102, f.cwd) };
  const c = sharedState(f, "t3c");
  await looked(c.v);
  expect(c.v.current().file).toEndWith(`${SESSION_A}.jsonl`);
  expect(c.v.res.guess).toBe(false);
  expect(shownPrompts(c.v)).toEqual(["Prompt in session A"]);
  const b = sharedState(f, "t3b");
  await looked(b.v);
  expect(b.v.current().file).toEndWith(`${SESSION_B}.jsonl`);
  // With the record unread, --resume on its command line names the session too.
  delete recordFiles[join(f.home, "sessions/5101.json")];
  hcBy.t3c = fg(5101, f.cwd, ["claude", "--resume", SESSION_A]);
  const again = sharedState(f, "t3c");
  await looked(again.v);
  expect(again.v.res.guess).toBe(false);
  expect(shownPrompts(again.v)).toEqual(["Prompt in session A"]);
  hcBy = {};
  recordFiles = {};
});

test("a resume in the other terminal does not move a pane to its session", async () => {
  const f = sharedFolder();
  f.record(5101, SESSION_A);
  f.record(5102, SESSION_B);
  hcBy = { t3c: fg(5101, f.cwd), t3b: fg(5102, f.cwd) };
  const { v, cx } = sharedState(f, "t3c");
  await looked(v);
  // The other terminal restarts: its old record goes, then a new pid records the same session.
  execFileSync("rm", [join(f.home, "sessions/5102.json")]);
  delete recordFiles[join(f.home, "sessions/5102.json")];
  v.resolve(cx);
  await looked(v);
  expect(shownPrompts(v)).toEqual(["Prompt in session A"]);
  f.record(5103, SESSION_B);
  hcBy.t3b = fg(5103, f.cwd, ["claude", "--resume", SESSION_B]);
  v.resolve(cx);
  await looked(v);
  expect(shownPrompts(v)).toEqual(["Prompt in session A"]);
  // Even a look that cannot read this terminal's record keeps what it was told.
  delete recordFiles[join(f.home, "sessions/5101.json")];
  v.resolve(cx);
  await looked(v);
  expect(shownPrompts(v)).toEqual(["Prompt in session A"]);
  hcBy = {};
  recordFiles = {};
});

// claude attach <id|name> writes no session record: the background session's own record names
// it, so the pane binds exactly, even from another folder.
test("claude attach binds the claude --bg session its record names", async () => {
  const f = sharedFolder();
  // The background session's record: its process (this one, alive), kind "bg".
  writeFileSync(join(f.home, "sessions", `${process.pid}.json`), JSON.stringify({ pid: process.pid, kind: "bg", sessionId: SESSION_A, name: "Fix the cart", cwd: f.cwd }));
  hcBy = { t3c: fg(5199, "/tmp/threads-elsewhere", ["claude", "attach", "cart"]) };
  const c = sharedState(f, "t3c");
  await looked(c.v);
  expect(c.v.current().file).toEndWith(`${SESSION_A}.jsonl`);
  expect(c.v.res.guess).toBe(false);
  expect(c.v.res.via).toBe("attach");
  expect(c.v.res.tried.some((x) => x.what === "Background session it attached to" && x.ok)).toBe(true);
  // A name no live background session has: no exact bind.
  hcBy = { t3c: fg(5199, f.cwd, ["claude", "attach", "nothing-like-it"]) };
  const d = sharedState(f, "t3c");
  await looked(d.v);
  expect(d.v.res.via).not.toBe("attach");
  expect(d.v.res.tried.some((x) => x.what === "Background session it attached to" && !x.ok)).toBe(true);
  hcBy = {};
  recordFiles = {};
});

// Plain codex with Codex's app-server daemon: the daemon holds the rollout, the terminal's
// process holds none, and the pane binds through the daemon (THREADS_CODEX_DAEMONS points
// locate.sh at the stand-in daemon only).
test("plain codex binds the session Codex's daemon holds for its folder", async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "threads-cx-cwd-")));
  const sessions = realpathSync(mkdtempSync(join(tmpdir(), "threads-cx-sessions-")));
  const id = "00000000-0000-4000-8000-0000000000c7";
  const client = spawn("bash", ["-c", 'exec -a codex sleep 30'], { cwd, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 1200));
  const ts = new Date().toISOString();
  const file = join(sessions, `rollout-2026-11-12T09-25-46-${id}.jsonl`);
  writeFileSync(file, `${JSON.stringify({ timestamp: ts, type: "session_meta", payload: { id, timestamp: ts, cwd, originator: "codex-tui" } })}\n`);
  const daemon = spawn("bash", ["-c", `exec 3<"${file}"; exec -a "codex app-server --listen unix:// --managed-daemon" sleep 30`], { stdio: "ignore" });
  const keep = process.env.THREADS_CODEX_DAEMONS;
  try {
    await new Promise((r) => setTimeout(r, 400));
    process.env.THREADS_CODEX_DAEMONS = String(daemon.pid);
    hcBy = { t5: JSON.stringify({ foreground: { name: "codex", argv: ["codex"], pid: client.pid, cwd }, cwd }) };
    state = {
      terminals: [{ address: "t5", status: "idle", cwd }],
      panes: [{ pane: "pt5", tab: "A", terminal: "t5", cwd }, { pane: "pm", tab: "A", terminal: null, mod: "agent-threads" }],
      props: { terminal: "t5", debug: true }, shared: {},
    };
    const v = new Threads();
    v.init(state.props, makeCx());
    await looked(v);
    expect(v.res.kind).toBe("found");
    expect(v.res.via).toBe("daemon");
    expect(v.res.guess).toBe(false);
    expect(v.current().file).toBe(file);
    const steps = v.res.tried.map((x) => [x.what, x.ok]);
    expect(steps).toContainEqual(["Session file the process has open", false]);
    expect(steps).toContainEqual(["Session file the Codex daemon has open", true]);
  } finally {
    if (keep === undefined) delete process.env.THREADS_CODEX_DAEMONS; else process.env.THREADS_CODEX_DAEMONS = keep;
    client.kill();
    daemon.kill();
    hcBy = {};
  }
});

// ---- a turn cut off, and answered on the next row ----------------------------------------

test("a row cut off shows Answered in #N, goes there, and search finds the answer from it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-cut-"));
  const file = join(dir, "f.jsonl");
  const line = (o) => JSON.stringify({ isSidechain: false, timestamp: new Date(Date.parse("2026-11-01T09:00:00Z") + 60000 * ++line.n).toISOString(), uuid: `u${line.n}`, ...o });
  line.n = 0;
  const user = (content) => line({ type: "user", origin: { kind: "human" }, message: { role: "user", content } });
  const said = (id, text, model = "claude-opus-5-5", stop = "end_turn") => line({ type: "assistant", message: { id, model, role: "assistant", content: [{ type: "text", text }], stop_reason: stop } });
  writeFileSync(file, `${[
    user("What is a walrus?"),
    said("m0", "No response requested.", "<synthetic>", "stop_sequence"),
    user("You were restarted, carry on"),
    said("m1", "A walrus is a large marine mammal with tusks."),
    user("And an otter?"),
    said("m2", "A small one."),
  ].join("\n")}\n`);
  const { v, cx } = await pane(file);
  const [cut, answer, other] = v.current().turns;
  expect(cut.answeredIn).toBe(2);
  expect(cut.errors).toEqual(["No response requested."]);
  expect([v.shape(cut).reply].flat().join(" ")).toBe("Answered in #2");
  expect(v.shape(cut).tone).toBe("note");
  expect(v.failed(cut)).toBe(false);
  expect(v.noReplyText(cut)).toBe("Answered in #2. This turn itself ended with: No response requested.");
  // Open, the note goes to the answer.
  v.goToAnswer(cut);
  expect(v.sel).toBe("0:2");
  expect(v.scrollTo).toEqual({ key: "0:2", how: "center", flash: true });
  const listed = (q) => { v.query = q; return v.rows().filter((r) => r.kind === "turn").map((r) => r.turn.n); };
  // The answer's words list the row cut off, and its words list the answer.
  expect(listed("marine mammal")).toEqual([1, 2]);
  expect(listed("walrus?")).toEqual([1, 2]);
  expect(listed("otter")).toEqual([3]);
  v.query = "marine mammal";
  expect(v.filterCount()).toBe("2 of 3");
  v.query = "";
  draw(v, cx);
  expect(reply(answer)).toStartWith("A walrus");
  expect(reply(other)).toBe("A small one.");
});

// ---- pins ----

const PINS = join(app, "data/agent-threads/pins.json");
async function pinPane(...flags) {
  delete recordFiles[PINS];
  const { v, cx } = await pane(fixture(...flags));
  await new Promise((r) => setTimeout(r, 20)); // the first read of pins.json
  return { v, cx, keys: () => v.turnKeys(v.rows()) };
}
const saved = async () => { await new Promise((r) => setTimeout(r, 30)); return JSON.parse(recordFiles[PINS] ?? "{}"); };
const allPins = (j) => Object.values(j.sessions ?? {}).flatMap((x) => x.pins);
const toastText = (v) => v.toast?.text ?? null;

test("p pins the selected turn, teaches the return key, and saves; p again unpins and u undoes", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  const [a, b] = keys();
  v.sel = a;
  v.key(keyEv("p"), cx);
  expect(v.isPinned(a)).toBe(true);
  expect(toastText(v)).toMatch(/^Pinned #\d+ · press 1 to come back$/);
  expect(allPins(await saved()).length).toBe(1);
  v.sel = b;
  v.key(keyEv("p"), cx);
  expect(toastText(v)).toMatch(/press 2 to come back$/);
  const order = () => v.pinnedList().map((p) => p.key);
  expect(order()).toEqual([a, b]);
  v.sel = a;
  v.key(keyEv("p"), cx);
  expect(toastText(v)).toMatch(/^Unpinned #\d+ · u to undo$/);
  expect(order()).toEqual([b]);
  v.key(keyEv("u"), cx);
  expect(order()).toEqual([a, b]); // back in the same place
  await saved();
  expect(allPins(JSON.parse(recordFiles[PINS])).length).toBe(2);
  expect(v.key(keyEv("u"), cx)).toBeUndefined(); // nothing left to undo, and no error
  draw(v, cx);
});

test("a sixth pin is refused in the design's words, and undo cannot pass the limit", async () => {
  const { v, cx, keys } = await pinPane("--extra", "8");
  const k = keys();
  for (let i = 0; i < 5; i++) { v.sel = k[i]; v.action("pin", cx); }
  v.sel = k[5];
  v.action("pin", cx);
  expect(toastText(v)).toBe("Pins are full (5). Unpin one first.");
  expect(v.pinnedList().length).toBe(5);
  v.sel = k[0];
  v.action("pin", cx);
  v.sel = k[6];
  v.action("pin", cx);
  v.action("undoUnpin", cx);
  expect(toastText(v)).toBe("Pins are full (5). Unpin one first.");
  expect(v.pinnedList().length).toBe(5);
  draw(v, cx);
});

test("a digit returns: the turn opens, stays selected, and shows from its head", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6", "--long");
  const a = keys()[0];
  v.toggle(a, cx);
  v.topKey = `rhead:${a}`;
  v.action("pin", cx);
  expect(v.pinnedList()[0].pin.anchor).toEqual(["rhead", null]);
  v.toggle(a, cx); // closed
  v.sel = keys().at(-1);
  v.follow = true;
  v.key(keyEv("1"), cx);
  expect(v.sel).toBe(a);
  expect(v.open.has(a)).toBe(true);
  expect(v.follow).toBe(false);
  expect(v.scrollTo).toMatchObject({ key: a, how: "head" });
  expect(v.pinAgain).toBe(null); // a place at the top of the turn: no second press
  v.scrollTo.until = 0; // no wait for measures here
  draw(v, cx);
  expect(v.scrollTo).toBe(null);
  expect(v.key(keyEv("3"), cx)).toBeUndefined(); // no third pin: the key does nothing
});

test("the place follows reading the selected turn, not a landing and not another turn", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6", "--long");
  const [a, b] = keys();
  v.toggle(a, cx);
  v.topKey = a;
  v.action("pin", cx);
  const pin = () => v.pinnedList()[0].pin;
  expect(pin().anchor).toEqual(["head"]);
  v.topKey = `rhead:${a}`;
  v.trackPlace();
  expect(pin().anchor).toEqual(["rhead", null]);
  // Another turn selected: its parts say nothing about this pin.
  v.sel = b;
  v.topKey = `rhead:${b}`;
  v.trackPlace();
  expect(pin().anchor).toEqual(["rhead", null]);
  // A landing near the end of the list leaves an earlier item at the top: that is no reading.
  v.goPin(0, cx);
  v.placeHold = Date.now() - 1;
  v.topKey = `you:${a}`;
  v.trackPlace();
  expect(pin().anchor).toEqual(["rhead", null]);
  v.trackPlace();
  expect(pin().anchor).toEqual(["rhead", null]);
  // The top moves: reading again.
  v.topKey = a;
  v.trackPlace();
  expect(pin().anchor).toEqual(["head"]);
});

test("a place that no longer exists falls back to the block, then the head", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6", "--long");
  const a = keys()[0];
  v.toggle(a, cx);
  v.action("pin", cx);
  v.pinnedList()[0].pin.anchor = ["md", "99.3"];
  v.goPin(0, cx);
  v.goPin(0, cx); // the second press, for the place
  expect(v.scrollTo).toMatchObject({ key: `md:${a}:99.3`, or: [`md:${a}:99`], how: "land" });
  v.scrollTo.until = 0;
  const scrolled = [];
  v.scroll = { scroll_to_item: (i, how) => scrolled.push([i, how]) };
  cx.timers = [];
  draw(v, cx);
  expect(v.scrollTo).toBe(null);
  cx.flush();
  // The card: its last part, then its head.
  const head = v.rows().findIndex((r) => r.key === a);
  expect(head).toBeGreaterThanOrEqual(0);
  expect(scrolled.at(-1)).toEqual([head, "top"]);
});

// Turn 8 of the --long fixture has a reply in two blocks around a code block: md 0, cc 1, md 2.
const twoBlocks = (keys) => keys().find((k) => k.endsWith(":8"));

test("a second press goes on to a place far down the turn, under a line that says the turn starts above, after the measures", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6", "--long");
  const a = twoBlocks(keys);
  v.sel = a;
  v.toggle(a, cx);
  v.topKey = `md:${a}:2`;
  v.action("pin", cx);
  expect(v.pinnedList()[0].pin.anchor).toEqual(["md", "2"]);
  v.listH = 60;
  v.sel = keys()[0];
  v.goPin(0, cx);
  // The first press: the head, and a note that a second press goes on.
  expect(v.scrollTo).toMatchObject({ key: a, how: "head" });
  expect(v.toast?.text).toBe("Press 1 again for where you left off");
  v.goPin(0, cx);
  expect(v.scrollTo).toMatchObject({ key: `md:${a}:2`, how: "land", head: a, resume: true });
  const scrolled = [];
  v.scroll = { scroll_to_item: (i, how) => scrolled.push([i, how]) };
  v.probeDue = () => [[v.rows().find((r) => r.kind === "md"), "sig"]];
  cx.timers = [];
  v.render(cx);
  expect(v.scrollTo).toMatchObject({ how: "land" }); // still waiting
  v.probeDue = () => [];
  cx.timers = [];
  v.render(cx);
  // The place, under the line, next frame.
  expect(v.scrollTo).toMatchObject({ key: `resume:${a}`, how: "land", or: [`md:${a}:2`] });
  expect(scrolled.length).toBe(0);
  const rows = v.rows();
  const line = rows.findIndex((r) => r.key === `resume:${a}`);
  expect(rows[line + 1].key).toBe(`md:${a}:2`);
  cx.timers = [];
  v.render(cx);
  expect(v.scrollTo).toBe(null);
  cx.flush();
  expect(scrolled.length).toBe(2);
  expect(scrolled[0][0]).toBeGreaterThan(line);
  // The line's top just under the floating top, never under it: an earlier item at the top,
  // lifted by the rest for one frame (landExact).
  const minTop = v.floating() ? 32 : 0;
  expect(v.landed).toMatchObject({ key: `resume:${a}`, y: minTop });
  const sl = v.slotsMemo;
  expect(scrolled[1]).toEqual([v.landed.j, "top"]);
  expect(sl.slice(v.landed.j, line).reduce((x, n) => x + n, 0) - v.landed.lift).toBe(minTop);
  draw(v, cx);
});

test("the first press shows the head even when the place would show under it; a moved view or another turn forgets the second press", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6", "--long");
  const a = twoBlocks(keys);
  v.sel = a;
  v.toggle(a, cx);
  v.topKey = `md:${a}:2`;
  v.action("pin", cx);
  v.listH = 5000;
  const scrolled = [];
  v.scroll = { scroll_to_item: (i, how) => scrolled.push([i, how]) };
  v.goPin(0, cx);
  v.scrollTo.until = 0;
  cx.timers = [];
  draw(v, cx);
  cx.flush();
  // The head lands like a place: an item further down first, then the head near the top but
  // clear of the floating top (an earlier item at the top, the head under it).
  const head = v.rows().findIndex((r) => r.key === a);
  const [j, how] = scrolled.at(-1);
  expect(how).toBe("top");
  expect(j).toBeLessThanOrEqual(head);
  const y = (v.slotsMemo ?? []).slice(j, head).reduce((x, n) => x + n, 0);
  expect(j === head || y >= 32).toBe(true);
  expect(scrolled[0][0]).toBeGreaterThan(head);
  expect(v.rows().some((r) => r.kind === "resume")).toBe(false);
  // The view moves before the second press: the press shows the head again.
  v.placeHold = null;
  v.placeBase = null;
  v.goPin(0, cx);
  expect(v.scrollTo).toMatchObject({ key: a, how: "head" });
  // A second press with the view still: the place, under the line; a click on it goes to the head.
  v.goPin(0, cx);
  v.scrollTo.until = 0;
  draw(v, cx);
  expect(v.rows().some((r) => r.key === `resume:${a}`)).toBe(true);
  v.click(`resume:${a}`, cx);
  expect(v.scrollTo).toMatchObject({ key: a, how: "head" });
  expect(v.rows().some((r) => r.kind === "resume")).toBe(false);
  // Selecting another turn drops the line and the second press.
  v.goPin(0, cx);
  expect(v.pinAgain).toBe(a);
  v.sel = keys()[0];
  v.action("next", cx);
  draw(v, cx);
  expect(v.pinAgain).toBe(null);
  expect(v.rows().some((r) => r.kind === "resume")).toBe(false);
});

test("scrolling down past a pinned turn keeps its place in the reply, not on its stats or action bar", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6", "--long");
  const a = twoBlocks(keys);
  v.sel = a;
  v.toggle(a, cx);
  v.topKey = a;
  v.action("pin", cx);
  const pin = () => v.pinnedList()[0].pin;
  v.placeHold = null;
  for (const top of [`you:${a}`, `md:${a}:0`, `md:${a}:2`, `lh:${a}`, `st:${a}`, `cp:${a}`, keys()[8]]) {
    v.topKey = top;
    v.trackPlace();
  }
  expect(pin().anchor).toEqual(["lh", null]);
});

test("a place an earlier build saved on a turn's stats or action bar returns to the head", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6", "--long");
  const a = twoBlocks(keys);
  v.sel = a;
  v.toggle(a, cx);
  v.action("pin", cx);
  for (const anchor of [["st", null], ["cp", null], ["lg", null], ["fold", null]]) {
    v.pinnedList()[0].pin.anchor = anchor;
    v.goPin(0, cx);
    expect(v.scrollTo).toMatchObject({ key: a, how: "head" });
    expect(v.pinAgain).toBe(null);
  }
});

test("a pin an older build saved with the reply shown whole returns to the open turn, with the whole reply, after a restart too", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6", "--long");
  const a = keys().find((k) => v.findTurn(k) && reply(v.findTurn(k)).length > 3000) ?? keys()[0];
  v.sel = a;
  v.toggle(a, cx);
  v.rows();
  v.topKey = `rhead:${a}`;
  v.action("pin", cx);
  v.pinnedList()[0].pin.whole = true; // what an older build saved beside a place
  await saved();
  // A new pane reads the same file.
  const file = state.props.transcript;
  const v2 = new Threads();
  const cx2 = makeCx();
  v2.init(state.props, cx2);
  await settle(v2);
  await new Promise((r) => setTimeout(r, 30));
  expect(v2.current().file).toBe(file);
  expect(v2.pinnedList().length).toBe(1);
  v2.goPin(0, cx2);
  expect(v2.open.has(a)).toBe(true);
  const prose = (t) => t.replace(/\s+/g, " ").trim();
  const shown = v2.rows().filter((r) => r.kind === "md" && r.key.startsWith(`md:${a}:`)).map((r) => r.src).join(" ");
  const wanted = segments(reply(v2.findTurn(a))).filter((g) => g.kind === "md").map((g) => g.text).join(" ");
  expect(prose(shown)).toBe(prose(wanted));
  expect([...v2.full].some((k) => k.startsWith("r:"))).toBe(false);
});
test("a turn that is gone stays dim with its saved text, clicking says so, and unpinning clears it", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  v.sel = keys()[0];
  v.action("pin", cx);
  await saved();
  const s = v.current();
  const pin = v.pinnedList()[0].pin;
  pin.id = "1|nothing|1";
  v.pinVer++;
  expect(v.pinnedList()[0].state).toBe("gone");
  draw(v, cx);
  v.goPin(0, cx);
  expect(toastText(v)).toBe(`#${pin.n} is no longer in this session. Unpin to clear it.`);
  expect(v.sel).toBe(keys()[0]); // nothing moved
  v.unpin(v.pinnedList()[0], cx);
  expect(v.pinnedList().length).toBe(0);
  v.undoUnpin(cx);
  expect(v.pinnedList()[0].state).toBe("gone");
  // While the session is still being read, it is not gone yet.
  s.loaded = false;
  v.pinVer++;
  expect(v.pinnedList()[0].state).toBe("loading");
  draw(v, cx);
  s.loaded = true;
});

test("a new reply shows until the turn is read", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  const [a, b] = keys();
  v.sel = a;
  v.action("pin", cx);
  v.sel = b;
  v.pinnedList()[0].turn.followups = 3;
  v.pinVer++;
  expect(v.pinnedList()[0].state).toBe("new");
  draw(v, cx);
  v.goPin(0, cx);
  expect(v.pinnedList()[0].state).toBe("quiet");
});

test("search: the pins stay, a visit shows the one turn with a note, and the search is kept", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  const a = keys()[0];
  v.sel = a;
  v.action("pin", cx);
  const word = "zzz-no-such-word";
  v.action(`search:${word}`, cx);
  expect(v.rows().some((r) => r.key === a)).toBe(false);
  expect(v.pinnedList().length).toBe(1);
  expect(v.key(keyEv("p"), cx)).toBeUndefined();
  expect(v.pinnedList().length).toBe(1); // p typed into the field
  v.toList();
  expect(v.filtering).toBe(false);
  expect(v.query).toBe(word);
  v.key(keyEv("1"), cx);
  expect(v.query).toBe(word);
  const rows = v.rows();
  const i = rows.findIndex((r) => r.key === a);
  expect(i).toBeGreaterThan(-1);
  expect(rows.some((r) => r.kind === "note" && r.text === "Pinned, not in this search")).toBe(true);
  draw(v, cx);
  expect(v.pinVisit).toBe(a); // drawing, with its timing report, does not end the visit
  expect(toastText(v)).toBe("Pinned, not in this search");
  // Moving away ends the visit.
  v.sel = null;
  draw(v, cx);
  expect(v.rows().some((r) => r.key === a)).toBe(false);
  expect(v.rows().some((r) => r.kind === "note")).toBe(false);
});

test("Enter on a search result hands the keys to the list and keeps the search", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  const before = keys().length;
  expect(before).toBeGreaterThan(1);
  const t = v.findTurn(keys()[1]);
  v.action(`search:${t.prompt.slice(0, 12)}`, cx);
  const q = v.query;
  v.key(keyEv("enter"), cx);
  expect(v.filtering).toBe(false);
  expect(v.query).toBe(q);
  v.key(keyEv("p"), cx);
  expect(v.pinnedList().length).toBe(1);
});

test("a search for #12 still jumps with Enter, and digits type into the field", async () => {
  const { v, cx } = await pinPane("--extra", "6");
  v.action("jump", cx);
  expect(v.filtering).toBe(true);
  expect(v.key(keyEv("1"), cx)).toBeUndefined();
  expect(v.pinnedList().length).toBe(0);
  v.action("search:#2", cx);
  v.key(keyEv("enter"), cx);
  expect(v.query).toBe("");
});

test("pins belong to one session, and another pane's save is kept", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  v.sel = keys()[0];
  v.action("pin", cx);
  await saved();
  // Another pane adds a session and this pane writes after it: both stay.
  const j = JSON.parse(recordFiles[PINS]);
  j.sessions["codex:other"] = { at: Date.now(), pins: [{ id: "elsewhere", n: 1, text: "made up" }] };
  recordFiles[PINS] = JSON.stringify(j);
  v.sel = keys()[1];
  v.action("pin", cx);
  const back = await saved();
  expect(back.sessions["codex:other"].pins[0].id).toBe("elsewhere");
  expect(allPins(back).length).toBe(3);
  expect(v.pinnedList().length).toBe(2); // the other session's pin is not this pane's
});

test("pins.json that does not parse is left alone, and pins still work until it is fixed", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  recordFiles[PINS] = "{ half an edit";
  v.sel = keys()[0];
  const before = pinWrites;
  v.action("pin", cx);
  await saved0();
  expect(recordFiles[PINS]).toBe("{ half an edit");
  expect(pinWrites).toBe(before);
  expect(v.pinsError).toMatch(/not valid JSON/);
  expect(v.pinnedList().length).toBe(1);
  delete recordFiles[PINS];
});
const saved0 = () => new Promise((r) => setTimeout(r, 30));

// Where the pin icon is drawn in the strip under an open turn's message, at a 500 px body.
const pinX = (v, key) => { const L = stripLayout(500, v.stripText(v.findTurn(key), true), !v.findTurn(key).agent); return (L.pin[0] + L.pin[1]) / 2; };
const copyX = (v, key) => { const L = stripLayout(500, v.stripText(v.findTurn(key), true), !v.findTurn(key).agent); return (L.copy[0] + L.copy[1]) / 2; };

test("the pin in the strip under an open turn's message pins it; copy there copies the prompt; a press elsewhere on it only selects; its icons act on a turn not selected", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  const a = keys()[0];
  v.toggle(a, cx);
  v.sel = a;
  v.bodyW = 500;
  v.pressX = pinX(v, a);
  v.click(`us:${a}`, cx);
  expect(v.isPinned(a)).toBe(true);
  expect(v.open.has(a)).toBe(true);
  expect(v.lastBarHit).toMatchObject({ hit: "pin", strip: "you" });
  v.pressX = copyX(v, a);
  v.click(`us:${a}`, cx);
  expect(cx.clip).toBe(v.findTurn(a).prompt);
  expect(v.copied?.id).toBe(`prompt:${a}`);
  v.pressX = 100;
  v.click(`us:${a}`, cx);
  expect(v.open.has(a)).toBe(true);
  expect(v.isPinned(a)).toBe(true);
  // On a turn that is not selected the strip shows its icons while the pointer is on it, so
  // a press on the pin acts there too (here it unpins) and selects the turn.
  v.sel = null;
  v.pressX = pinX(v, a);
  v.click(`us:${a}`, cx);
  expect(v.sel).toBe(a);
  expect(v.isPinned(a)).toBe(false);
  expect(v.lastBarHit).toMatchObject({ hit: "pin", strip: "you" });
  // The same under the reply: copy copies the reply on a turn not selected.
  v.sel = null;
  const g = v.barGeom(v.findTurn(a));
  v.pressX = (g.copy[0] + g.copy[1]) / 2;
  v.click(`cp:${a}`, cx);
  expect(v.sel).toBe(a);
  expect(v.copied?.id).toBe(`reply:${a}`);
  // A click on the turn's top closes it.
  v.click(a, cx);
  expect(v.open.has(a)).toBe(false);
});

test("with a quote key of p, an open turn's pin pins and the Pinned view's header button unpins (the README's fallback)", async () => {
  const { keyAction } = await import("../mods/agent-threads/ui.js");
  const { v, cx, keys } = await pinPane("--extra", "6");
  v.quoteKey = "p";
  expect(keyAction(keyEv("p"), false, "p")).toBe("quote");
  expect(keyAction(keyEv("u"), false, "u")).toBe("quote");
  const a = keys()[0];
  v.sel = a;
  v.width = 500;
  // The list's header has no pin button to fall back on.
  expect(v.headerButtons().map((b) => b[0])).not.toContain("th-pin");
  // The pin in the strip under an open turn's message pins it.
  v.toggle(a, cx);
  v.sel = a;
  v.bodyW = 500;
  v.pressX = pinX(v, a);
  v.click(`us:${a}`, cx);
  expect(v.isPinned(a)).toBe(true);
  // In the Pinned view the header's pin button unpins the selected pin with the mouse.
  v.setView("pinned");
  v.sel = a;
  rec = []; v.header(theme); const h = rec; rec = null;
  const at = h.findIndex((e) => e[0] === "id" && e[1] === "th-pin");
  expect(at).toBeGreaterThanOrEqual(0);
  const end = h.findIndex((e, i) => i > at && e[0] === "id");
  const click = h.slice(at, end < 0 ? undefined : end).find((e) => e[0] === "on_click")?.at(-1);
  expect(typeof click).toBe("function");
  click({}, cx);
  expect(v.isPinned(a)).toBe(false);
  v.setView("all");
  v.quoteKey = "q";
});

test("a click in the list gives the search field's keys back to the panel", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  v.action("search:the", cx);
  expect(v.filtering).toBe(true);
  const k = keys()[0];
  if (k) {
    v.click(k, cx);
    expect(v.filtering).toBe(false);
    expect(v.query).toBe("the");
  }
});

test("pin keys work in a focused read-only editor, and do nothing when held", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  v.sel = keys()[0];
  v.editorFocused = true;
  v.key(keyEv("p"), cx);
  expect(v.pinnedList().length).toBe(1);
  v.editorFocused = false;
  v.key(keyEv("p", { is_held: true }), cx);
  expect(v.pinnedList().length).toBe(1);
});

test("the pins show in the Pinned view at every width; the header and footer say how to reach it", async () => {
  const { v, cx, keys } = await pinPane("--extra", "8", "--agents");
  const k = keys();
  for (let i = 0; i < 5; i++) { v.sel = k[i]; v.action("pin", cx); }
  for (const width of [240, 380, 500]) {
    v.width = width;
    for (const view of ["all", "pinned"]) { v.setView(view); for (const h of [0, 300, 900]) { v.rootH = h; draw(v, cx); } }
  }
  v.setView("all");
  v.rootH = 900;
  v.width = 500;
  const btn = () => v.headerButtons().find((b) => b[0] === "th-pin");
  // The list's header has no pin button (p and an open turn's pin do it); the Pinned view
  // keeps one, as Unpin for the selected pin.
  v.sel = k[0];
  expect(btn()).toBeUndefined();
  v.setView("pinned");
  expect(btn()[2]).toMatch(/^Unpin #\d+ \(p\)$/);
  expect(btn()[4]).toBe(true);
  v.sel = k[6];
  expect(btn()[2]).toMatch(/^Pin #\d+ \(p\)$/);
  expect(btn()[4]).toBe(false);
  v.setView("all");
  const pinned = () => v.headerButtons().find((b) => b[0] === "th-pinned");
  expect(pinned().slice(1, 7)).toEqual([null, "Open the Pinned column beside Threads (v)", "pinned", false, null, "Pinned 5"]);
  expect(v.footerHints().map((x) => x[1])).toContain("pin");
  expect(v.footerHints().map((x) => x.join(" "))).toContain("? keys");
  v.sel = k[0];
  expect(v.footerHints().map((x) => x[1])).toContain("unpin");
  v.quoteKey = "p";
  expect(v.footerHints().filter((x) => x[0] === "p").map((x) => x[1])).toEqual(["quote"]);
  v.quoteKey = "q";
  const r = v.report();
  expect(state.shared["threads.debug"].t4.pins.list.length).toBe(5);
  expect(r).toBeUndefined();
});

test("v in a pane under 480 px shows Pinned in the same pane: pins oldest first, Enter opens one at its place, Esc goes back", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  const k = keys();
  for (const i of [3, 0, 5]) { v.sel = k[i]; v.action("pin", cx); }
  v.width = 380;
  log = [];
  v.key(keyEv("v"), cx);
  expect(v.view).toBe("pinned");
  expect(log.filter(([, n]) => n === "pane.split")).toEqual([]);
  expect(toastText(v)).toBe("Pinned shows here: the Pinned column needs Threads 480 px wide");
  expect(v.headerText()).toBe("3 of 5");
  // The heading leads: the pin and "Pinned", then the agent badge, then the count.
  const head = (x) => { rec = []; x.header(theme); const c = rec; rec = null; return c.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]); };
  const hv = head(v);
  expect(hv.indexOf("Pinned")).toBeGreaterThanOrEqual(0);
  expect(hv.indexOf("Pinned")).toBeLessThan(hv.indexOf("3 of 5"));
  rec = []; v.header(theme); const ids = rec.filter((e) => e[0] === "id").map((e) => e[1]); rec = null;
  expect(ids.indexOf("th-pinned-heading")).toBeGreaterThanOrEqual(0);
  expect(ids.indexOf("th-pinned-heading")).toBeLessThan(ids.indexOf("th-badge"));
  expect(v.headerLayout().heading).toBeGreaterThan(0);
  expect(v.headerButtons().find((b) => b[0] === "th-pinned").slice(2, 7)).toEqual(["Back to all turns (v)", "pinned", true, null, "All turns"]);
  const rows = v.rows();
  // Pinned 3, 0, 5: shown and numbered oldest first.
  expect(rows.filter((r) => r.kind === "turn").map((r) => [r.key, r.pinNo])).toEqual([[k[0], 1], [k[3], 2], [k[5], 3]]);
  expect(v.footerHints().map((x) => x.join(" "))).toEqual(["↑↓ next pin", "↵ open", "c copy", "q quote", "? keys"]);
  // The selection moves from pin to pin, and Enter opens the pin at its place.
  v.sel = k[0];
  v.key(keyEv("down"), cx);
  expect(v.sel).toBe(k[3]);
  v.key(keyEv("enter"), cx);
  expect(v.open.has(k[3])).toBe(true);
  expect(v.scrollTo).toMatchObject({ key: k[3] });
  draw(v, cx);
  // p unpins in the view, and u brings it back.
  v.key(keyEv("p"), cx);
  expect(v.rows().filter((r) => r.kind === "turn" || r.kind === "head").map((r) => r.key)).toEqual([k[0], k[5]]);
  v.key(keyEv("u"), cx);
  expect(v.pinnedList().length).toBe(3);
  // Esc closes the open pin, then returns to all turns.
  v.key(keyEv("escape"), cx);
  v.key(keyEv("escape"), cx);
  expect(v.view).toBe("all");
  expect(v.rows().filter((r) => r.kind === "turn").length).toBe(k.length);
  // With no pins the view says how to make one.
  for (const p of [...v.pinnedList()]) v.unpin(p, cx);
  v.setView("pinned");
  expect(v.rows()).toEqual([expect.objectContaining({ kind: "note", key: "pins:none" })]);
  draw(v, cx);
});

test("v in a pane from 480 px splits the Pinned column beside it, 380 px at 700, kept apart from the main pane; v moves between them", async () => {
  const { v, cx } = await pinPane("--extra", "6");
  v.width = 700;
  state.shared["threads.byTerminal"] = { t4: { pane: "p2" } }; // as the launcher records it
  draw(v, cx); // no pins yet, so the column does not open by itself
  expect(v.me().pane).toBe("p2");
  expect(log.filter(([, n]) => n === "pane.split")).toEqual([]);
  log = [];
  v.key(keyEv("v"), cx);
  expect(v.view).toBe("all");
  const split = log.find(([, n]) => n === "pane.split");
  expect(split[2]).toMatchObject({ pane: "p2", direction: "right", mod: "agent-threads", props: { terminal: "t4", view: "pinned" } });
  // The split applies: the new pane goes in its own map and gets the column's width. v
  // asked for it, so the keyboard stays in the column.
  state.panes.push({ pane: "p3", tab: "A", terminal: null, mod: "agent-threads" });
  v.settleSplit();
  expect(state.shared["threads.pinnedByTerminal"]).toEqual({ t4: { pane: "p3" } });
  expect(state.shared["threads.byTerminal"].t4).toEqual({ pane: "p2" });
  expect(log.filter(([, n]) => n === "layout.resize" || n === "pane.focus").map((x) => x.slice(1))).toEqual([["layout.resize", { id: "p3", px: 380 }]]);
  // The header's Pinned button says the column is open, and v or a click focuses it.
  expect(v.headerButtons().find((b) => b[0] === "th-pinned").slice(2, 7)).toEqual(["Go to the Pinned column (v)", "pinned", true, null, "Pinned"]);
  log = [];
  v.key(keyEv("v"), cx);
  expect(log).toEqual([["run", "pane.focus", { pane: "p3" }]]);
  // The Pinned pane: a second panel with view "pinned", which finds its own pane and shows the pins.
  v.sel = v.turnKeys(v.rows())[1];
  v.action("pin", cx);
  expect(log.filter(([, n]) => n === "pane.split")).toEqual([]); // the column is open already
  await saved(); // the main pane's pins.json, which the Pinned pane reads
  const props = state.props;
  state.props = { ...props, view: "pinned" };
  const w = new Threads();
  const cx2 = makeCx();
  w.init(state.props, cx2);
  await settle(w);
  await new Promise((r) => setTimeout(r, 20));
  expect(w.pinnedPane).toBe(true);
  expect(w.view).toBe("pinned");
  expect(w.me().pane).toBe("p3");
  expect(w.rows().filter((r) => r.kind === "turn").length).toBe(1);
  // The pins read from the top, pin 1 first, with no spacer to push them to the bottom.
  w.listH = 900;
  w.rowsKey = null;
  expect(w.rows()[0].kind).not.toBe("spacer");
  // Its header: the Pinned heading, no badge, the pin button and "All turns", with room for "1 of 5" at 240 px.
  w.width = 240;
  expect(w.headerButtons().map((b) => [b[0], b[6]])).toEqual([["th-pinned", "All turns"]]);
  expect(w.headerButtons()[0][2]).toBe("Back to Threads, all turns (v)");
  // From 300 px its pin button is back: Unpin for the selected pin, the one way to unpin a
  // closed pin with the mouse (the list's header has none).
  w.width = 320;
  expect(w.headerButtons().map((b) => b[0])).toEqual(["th-pin", "th-pinned"]);
  w.width = 240;
  expect(w.headerLayout().badge).toBe(0);
  expect(w.headerLayout().text).toBeGreaterThanOrEqual(Math.ceil("1 of 5".length * 6.6));
  rec = []; w.header(theme); const wh = rec; rec = null;
  const ws = wh.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
  expect(ws.slice(0, 2)).toEqual(["Pinned", "1 of 5"]);
  expect(ws).not.toContain("Claude");
  // The accent: the header's tint, and its bar along the top.
  expect(wh.some((e) => e[0] === "bg" && e[1] === alphaForTest(theme.accent, 0.08))).toBe(true);
  // Threads itself keeps a plain header.
  rec = []; w.view = "all"; w.pinnedPane = false; w.header(theme); const plainHead = rec; rec = null; w.view = "pinned"; w.pinnedPane = true;
  expect(plainHead.some((e) => e[0] === "bg" && e[1] === alphaForTest(theme.accent, 0.08))).toBe(false);
  draw(w, cx2);
  expect(state.shared["threads.byTerminal"].t4).toEqual({ pane: "p2" });
  // v in the Pinned pane goes back to the main pane; Esc does not leave the Pinned view there.
  log = [];
  w.key(keyEv("v"), cx2);
  expect(log).toEqual([["run", "pane.focus", { pane: "p2" }]]);
  w.key(keyEv("escape"), cx2);
  expect(w.view).toBe("pinned");
  // = and - in the column: the column 40 px wider or narrower and Threads the other way, so
  // the terminal keeps its width (a drag on the divider between them resizes Threads alone).
  // (Keep to reading width off here, so Threads may be wider than the reading width.)
  v.prefs = { ...v.prefs, readingWidth: false };
  w.prefs = { ...w.prefs, readingWidth: false };
  state.shared["threads.width"] = { p2: 698, p3: 250 }; // measured: the px sizes less the 2 px frame
  log = [];
  w.key(keyEv("="), cx2);
  expect(log.filter(([, n]) => n === "layout.resize").map((x) => x[2])).toEqual([{ id: "p3", px: 292 }, { id: "p2", px: 660 }]);
  log = [];
  v.key(keyEv("-"), cx);
  expect(log.filter(([, n]) => n === "layout.resize").map((x) => x[2])).toEqual([{ id: "p3", px: 252 }, { id: "p2", px: 700 }]);
  // With it on (the default), - narrows the column but Threads stops at the reading width:
  // the terminal takes the rest.
  v.prefs = { ...v.prefs, readingWidth: true };
  state.shared["threads.width"] = { p2: 543, p3: 290 };
  log = [];
  v.key(keyEv("-"), cx);
  expect(log.filter(([, n]) => n === "layout.resize").map((x) => x[2])).toEqual([{ id: "p3", px: 252 }, { id: "p2", px: 573 }]);
  // The column's footer: the same one row, ? keys last (- and = are on the sheet).
  expect(w.footerHints().map((x) => x.join(" "))).toEqual(["↑↓ next pin", "↵ open", "? keys"]);
  // Threads closes: the column closes too, once.
  log = [];
  state.panes = state.panes.filter((p) => p.pane !== "p2");
  w.poll(cx2);
  w.poll(cx2);
  expect(log.filter(([, n]) => n === "pane.close")).toEqual([["run", "pane.close", { pane: "p3" }]]);
  state.props = props;
});

// ---- day headers in the Pinned view ----------------------------------------------------

// Pins the turns at these indexes, in this order, then shows the Pinned view in this pane.
async function pinsShown(fixtureFlags, order, width = 400) {
  const { v, cx, keys } = await pinPane(...fixtureFlags);
  const k = keys();
  for (const i of order) { v.sel = k[i]; v.action("pin", cx); }
  v.width = width;
  v.key(keyEv("v"), cx); // under 480 px, v shows Pinned in this pane
  expect(v.view).toBe("pinned");
  return { v, cx, k };
}
const headsAndPins = (v) => v.rows().filter((r) => r.kind === "pday" || r.kind === "turn")
  .map((r) => (r.kind === "pday" ? `day ${r.name}` : `pin ${r.pinNo}`));

test("Pinned view: pins all from one day get one day header, above the first pin", async () => {
  const { v, cx } = await pinsShown(["--extra", "6"], [4, 1, 3]);
  const rows = v.rows();
  expect(rows[0].kind).toBe("pday");
  expect(rows.filter((r) => r.kind === "pday").length).toBe(1);
  expect(headsAndPins(v).slice(1)).toEqual(["pin 1", "pin 2", "pin 3"]);
  expect(rows[0].name).toMatch(/^(Today|Yesterday|[A-Z][a-z]+day \d{1,2} [A-Z][a-z]{2})$/);
  expect(v.height(rows[0])).toBe(30);
  // It is not a turn: the arrows and the digits still move between pins only.
  expect(v.turnKeys(rows).length).toBe(3);
  draw(v, cx);
  expect(state.shared["threads.debug"].t4.rows[0]).toBe("pday");
});

test("Pinned view: pins across days show oldest first, with one day pill per day, whatever order they were pinned in", async () => {
  // Four turns 12 hours apart from 1 Nov 09:12 UTC span two or three local days.
  const { v, k } = await pinsShown(["--only", "4", "--gap", "43200"], [3, 0, 2, 1]);
  const turns = v.rows().filter((r) => r.kind === "turn");
  expect(turns.map((r) => r.key)).toEqual([k[0], k[1], k[2], k[3]]);
  expect(turns.map((r) => r.pinNo)).toEqual([1, 2, 3, 4]);
  // One pill per day, each above that day's first pin.
  const heads = v.rows().filter((r) => r.kind === "pday");
  const days = new Set(turns.map((r) => dayKey(r.turn.ts)));
  expect(heads.length).toBe(days.size);
  expect(new Set(heads.map((r) => r.name)).size).toBe(heads.length);
  for (const r of heads) expect(r.count).toBeUndefined();
});

test("pin numbers follow time order: pinning an older turn renumbers the newer pins, unpinning closes the gap", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  const k = keys();
  for (const i of [4, 2]) { v.sel = k[i]; v.action("pin", cx); }
  expect(toastText(v)).toMatch(/press 1 to come back$/); // #3 is older than #5, so it is 1
  expect([v.pinNumber(v.findTurn(k[2])), v.pinNumber(v.findTurn(k[4]))]).toEqual([1, 2]);
  v.sel = k[0]; v.action("pin", cx);
  expect([0, 2, 4].map((i) => v.pinNumber(v.findTurn(k[i])))).toEqual([1, 2, 3]);
  expect(v.headerButtons().find((b) => b[0] === "th-pinned")[6]).toBe("Pinned 3");
  // The digit keys follow the numbers: 2 goes to the middle pin.
  v.goPin(1, cx);
  expect(v.sel).toBe(k[2]);
  v.sel = k[0]; v.action("pin", cx); // unpin the oldest
  expect([2, 4].map((i) => v.pinNumber(v.findTurn(k[i])))).toEqual([1, 2]);
  v.goPin(0, cx);
  expect(v.sel).toBe(k[2]);
});

test("pins saved in the order they were pinned load oldest first, all of them, with the file left as it was", async () => {
  const first = await pinPane("--extra", "6");
  const k = first.keys();
  for (const i of [5, 1, 3]) { first.v.sel = k[i]; first.v.action("pin", first.cx); }
  const saved = await new Promise((r) => setTimeout(r, 30)).then(() => recordFiles[PINS]);
  const order = (j) => allPins(JSON.parse(j)).map((p) => p.n);
  expect(order(saved)).toEqual([6, 2, 4]); // the file keeps the order they were pinned in
  // A new pane reads that file as an older build wrote it.
  const { v } = await pane(fixture("--extra", "6"));
  await new Promise((r) => setTimeout(r, 20));
  expect(v.pinnedList().map((p) => p.turn?.n)).toEqual([2, 4, 6]);
  expect(v.pinnedList().map((p) => p.state)).not.toContain("gone");
  expect(order(recordFiles[PINS])).toEqual([6, 2, 4]); // loading changed nothing
});

test("Pinned view: Today and Yesterday roll over at midnight, and the 1 s timer redraws when the day changes", async () => {
  const { v, cx } = await pinsShown(["--extra", "3"], [2, 0]);
  const ts = v.rows().find((r) => r.kind === "turn").turn.ts;
  const real = Date.now;
  const d = new Date(ts);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  const tick = cx.everies.find((x) => x.ms === 1000).fn;
  let notes = 0;
  cx.notifyHook = () => { notes++; };
  try {
    Date.now = () => midnight - 60000; // one minute before midnight, the pins' day
    tick(cx);
    expect(v.rows()[0]).toMatchObject({ kind: "pday", name: "Today" });
    expect(v.rows()[0].date).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);
    notes = 0;
    tick(cx);
    expect(notes).toBe(0); // the same day: no redraw for it
    Date.now = () => midnight + 60000; // one minute after
    tick(cx);
    expect(notes).toBe(1);
    expect(v.rows()[0]).toMatchObject({ kind: "pday", name: "Yesterday" });
    Date.now = () => midnight + 86400000 + 60000; // a day later
    tick(cx);
    expect(v.rows()[0].name).toMatch(/^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]{2}$/);
    expect(v.rows()[0].date).toBe(null);
  } finally { Date.now = real; cx.notifyHook = null; }
});

test("Pinned view: a digit key brings its pin to the top with the day header above it", async () => {
  const { v, cx } = await pinsShown(["--extra", "4"], [3, 1]);
  const scrolled = [];
  v.scroll = { scroll_to_item: (i, how) => scrolled.push([i, how]) };
  v.goPin(0, cx);
  expect(v.scrollTo).toMatchObject({ how: "head" });
  v.scrollTo.until = 0;
  cx.timers = [];
  draw(v, cx);
  cx.flush();
  const rows = v.rows();
  const pin = rows.findIndex((r) => r.key === v.pinnedList()[0].key); // a row or an open card's head
  expect(rows[pin - 1].kind).toBe("pday");
  expect(scrolled.at(-1)).toEqual([pin - 1, "top"]);
});

test("Pinned column: the same day headers as the narrow view, drawn as a compact pill with no count", async () => {
  const { v, cx } = await pinsShown(["--only", "4", "--gap", "43200"], [3, 0]);
  const narrow = headsAndPins(v);
  // The column draws the same rows (pinnedRows): compare with a Pinned pane at 252 px.
  v.width = 252; v.rowsKey = null;
  expect(headsAndPins(v)).toEqual(narrow);
  const head = v.rows().find((r) => r.kind === "pday");
  rec = []; v.item(theme, head, true, 30); const calls = rec; rec = null;
  const words = calls.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
  expect(words[0]).toBe(head.name);
  expect(words.join(" ")).not.toMatch(/turn/);
  expect(calls.some((e) => e[0] === "text_size" && e[1] === 11.5)).toBe(true);
  draw(v, cx);
});

// ---- compact rows in the Pinned view ---------------------------------------------------

// The Pinned column's list at a 1150 px window, measured on a test window (debug listH): the
// pane is 1032 px, less the header, the footer and the day strip.
const PIN_LIST_H = 926;
const compactPins = (v) => v.rows().filter((r) => r.kind === "turn");
const itemWords = (v, r) => { rec = []; v.item(theme, r, true, v.height(r)); const c = rec; rec = null; return c; };

test("Pinned view: each closed pin is a compact row, its digit, number, time, two prompt lines and one reply line", async () => {
  const { v, cx } = await pinsShown(["--extra", "6"], [7, 3, 5]);
  const rows = compactPins(v);
  expect(rows.map((r) => r.pinNo)).toEqual([1, 2, 3]);
  for (const r of rows) {
    expect(r.compact).toBe(true);
    expect(r.shape.prompt.length).toBeGreaterThanOrEqual(1);
    expect(r.shape.prompt.length).toBeLessThanOrEqual(2);
    expect(typeof r.shape.reply).toBe("string");
    // Every line has a fixed height, so the row is what it states: 95 px with two prompt lines.
    expect(v.height(r)).toBe(r.shape.prompt.length === 2 ? 95 : 76);
  }
  const r = rows[1];
  v.sel = rows[0].key;
  const calls = itemWords(v, r);
  const words = calls.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
  expect(words[0]).toBe("2"); // the digit leads
  expect(words).toContain(`#${r.turn.n}`);
  expect(words).toContain(fmtTimeForTest(r.turn.ts));
  for (const l of r.shape.prompt) expect(words).toContain(l);
  expect(words).toContain(r.shape.reply);
  expect(words.join(" ")).not.toMatch(/tokens|tool call/); // no stats line
  // The selected pin has the list's fill and its bar.
  expect(calls.some((e) => e[0] === "bg" && e[1] === theme.selected)).toBe(false);
  v.sel = r.key;
  expect(itemWords(v, r).some((e) => e[0] === "bg" && e[1] === theme.selected)).toBe(true);
  // A reply not read yet puts a dot on the row, and reading it takes the dot away.
  expect(itemWords(v, r).some((e) => e[0] === "id" && e[1] === "th-pin-new-2")).toBe(false);
  v.pinnedList()[1].turn.followups = 2;
  v.pinVer++;
  const fresh = compactPins(v)[1];
  expect(fresh.fresh).toBe(true);
  expect(itemWords(v, fresh).some((e) => e[0] === "id" && e[1] === "th-pin-new-2")).toBe(true);
  v.goPin(1, cx);
  v.action("escape", cx);
  expect(compactPins(v)[1].fresh).toBe(false);
  draw(v, cx);
  expect(state.shared["threads.debug"].t4.detail.filter((x) => x.startsWith("pin#")).length).toBe(3);
});

test("Pinned column: five pins, one day apart, fit a 240 to 400 px column at a 1150 px window without scrolling", async () => {
  const { v, cx } = await pinsShown(["--only", "5", "--gap", "86400"], [4, 2, 0, 3, 1]);
  for (const width of [240, 280, 320, 400]) {
    v.width = width;
    v.rowsKey = null;
    const rows = v.rows();
    expect(rows.filter((r) => r.kind === "pday").length).toBe(5);
    expect(compactPins(v).length).toBe(5);
    expect(compactPins(v).every((r) => r.compact)).toBe(true);
    const total = rows.reduce((sum, r) => sum + v.height(r), 0);
    expect(total).toBeLessThanOrEqual(PIN_LIST_H);
    draw(v, cx);
    expect(lastList.sizes.reduce((x, y) => x + y, 0)).toBeLessThanOrEqual(PIN_LIST_H);
  }
  // The longest rows (two prompt lines each) with a pill over each still fit, from the
  // heights the code states, not from numbers copied into the test.
  const pday = v.rows().find((r) => r.kind === "pday");
  expect(5 * pinRowHeight(2) + 5 * v.height(pday)).toBeLessThanOrEqual(PIN_LIST_H);
  // And so do five pins whose prompts are long enough to wrap: every row is two lines.
  const pinned = v.pinnedList();
  for (const p of pinned) p.turn.prompt = `${p.turn.n} Make the checkout page remember the last shipping address and fill it in again next time. `.repeat(4);
  // A pin is found by its prompt, so give each pin its turn's new id.
  for (const p of pinned) p.pin.id = [...turnIds(p.s.turns)].find(([, t]) => t === p.turn)[0];
  for (const s of v.sessions) s.version++;
  v.pinVer++;
  v.width = 240;
  v.rowsKey = null;
  const long = v.rows();
  expect(compactPins(v).map((r) => r.shape.prompt.length)).toEqual([2, 2, 2, 2, 2]);
  expect(compactPins(v).every((r) => v.height(r) === pinRowHeight(2))).toBe(true);
  expect(long.reduce((sum, r) => sum + v.height(r), 0)).toBeLessThanOrEqual(PIN_LIST_H);
  draw(v, cx);
});

test("a closed running pin keeps its clock ticking: the 1 s timer still sees a live turn shown", async () => {
  const { v, cx } = await pinPane("--only", "0", "--agents", "--open");
  state.terminals[0].status = "working";
  const k = v.turnKeys(v.rows());
  v.sel = k.at(-1);
  v.action("pin", cx);
  v.width = 400;
  v.key(keyEv("v"), cx);
  expect(v.view).toBe("pinned");
  v.sel = null;
  v.rowsKey = null;
  const pin = compactPins(v).find((r) => r.running);
  expect(pin?.compact).toBe(true);
  expect(pin.live).toBe(false);
  expect(v.liveShown).toBe(true);
  draw(v, cx);
  expect(state.shared["threads.debug"].t4.live).toMatch(/Working/);
  // Needs you: the 5 s read stops, so only the 1 s timer moves the clock.
  state.terminals[0].status = "blocked";
  v.rowsKey = null;
  v.rows();
  expect(v.liveShown).toBe(true);
  draw(v, cx);
  expect(state.shared["threads.debug"].t4.live).toMatch(/Needs you/);
});

test("a compact pin opens as a card with Enter, a click or its digit, and closes back to its row", async () => {
  const { v, cx, k } = await pinsShown(["--extra", "6"], [2, 4]);
  const kinds = (key) => v.rows().filter((r) => r.key === key || r.key?.endsWith?.(`:${key}`)).map((r) => (r.compact ? "pin" : r.kind));
  v.sel = k[2];
  v.key(keyEv("enter"), cx);
  expect(v.open.has(k[2])).toBe(true);
  expect(kinds(k[2])).toContain("head");
  expect(kinds(k[2])).not.toContain("pin");
  v.key(keyEv("escape"), cx);
  expect(kinds(k[2])).toEqual(["pin"]);
  v.click(k[4], cx);
  expect(v.open.has(k[4])).toBe(true);
  expect(kinds(k[4])).toContain("head");
  v.click(k[4], cx);
  expect(kinds(k[4])).toEqual(["pin"]);
  v.goPin(0, cx);
  expect(v.sel).toBe(k[2]);
  expect(kinds(k[2])).toContain("head");
  // A pin whose turn is gone keeps its line of text (its saved time puts it first).
  v.pinnedList()[1].pin.id = "1|nothing|1";
  v.pinVer++;
  expect(v.rows().find((r) => r.kind === "note")?.text).toMatch(/^1 · #\d+ is no longer in this session\. Click to unpin it\.$/);
  draw(v, cx);
});

test("the first pin opens the Pinned column when there is room and keeps the keyboard in Threads; a closed column stays closed", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  const k = keys();
  v.width = 960;
  state.shared["threads.byTerminal"] = { t4: { pane: "p2" } };
  draw(v, cx);
  log = [];
  v.sel = k[2];
  v.key(keyEv("p"), cx);
  expect(toastText(v)).toMatch(/^Pinned #\d+ · in the Pinned column · press 1 to come back$/);
  expect(log.filter(([, n]) => n === "pane.split").length).toBe(1);
  // A second pin while the split is on its way asks for no second column.
  v.sel = k[3];
  v.key(keyEv("p"), cx);
  expect(log.filter(([, n]) => n === "pane.split").length).toBe(1);
  state.panes.push({ pane: "p3", tab: "A", terminal: null, mod: "agent-threads" });
  log = [];
  v.settleSplit();
  expect(log.map((x) => x.slice(1))).toEqual([["layout.resize", { id: "p3", px: 424 }], ["pane.focus", { pane: "p2" }]]);
  draw(v, cx);
  // The owner closes the column: the next pin does not open it again, and v still does.
  state.panes = state.panes.filter((p) => p.pane !== "p3");
  draw(v, cx);
  log = [];
  v.sel = k[4];
  v.key(keyEv("p"), cx);
  expect(toastText(v)).toMatch(/^Pinned #\d+ · press 3 to come back$/);
  expect(log.filter(([, n]) => n === "pane.split")).toEqual([]);
  v.key(keyEv("v"), cx);
  expect(log.filter(([, n]) => n === "pane.split").length).toBe(1);
});

test("the Pinned column keeps the width the owner leaves it at, not the split's own resize", async () => {
  const { v, cx } = await pinPane("--extra", "6");
  v.width = 960;
  state.shared["threads.byTerminal"] = { t4: { pane: "p2" } };
  draw(v, cx);
  // In the column: its first sizes (Herdr's default, then the split's resize) are not kept.
  const col = new Threads();
  col.pinnedPane = true;
  col.me = () => ({ pane: "p3" });
  col.paneW = 250;
  col.shareWidth();
  col.paneW = 382;
  col.shareWidth();
  expect(state.shared["threads.pinWidth"]).toBeUndefined();
  // Once settled, a drag to 298 px is kept as Herdr's size, the frame included.
  col.firstSizeAt = Date.now() - 2000;
  col.paneW = 298;
  col.shareWidth();
  expect(state.shared["threads.pinWidth"]).toEqual({ px: 300 });
  // The next column opens at that width.
  log = [];
  v.key(keyEv("v"), cx);
  state.panes.push({ pane: "p3", tab: "A", terminal: null, mod: "agent-threads" });
  v.settleSplit();
  expect(log.filter(([, n]) => n === "layout.resize").map((x) => x[2])).toEqual([{ id: "p3", px: 300 }]);
  // The fit button's own resize of the column is not taken as the owner's choice.
  state.shared["threads.pinWidth"] = { px: 300, hold: Date.now() + 1500 };
  col.paneW = 340;
  col.shareWidth();
  expect(state.shared["threads.pinWidth"].px).toBe(300);
  state.panes = state.panes.filter((p) => p.pane !== "p3");
});

test("Threads opening with pins opens the Pinned column once, from 480 px, and not under it", async () => {
  const first = await pinPane("--extra", "6");
  log = [];
  first.v.sel = first.keys()[1];
  first.v.action("pin", first.cx); // at 380 px: no column
  expect(log.filter(([, n]) => n === "pane.split")).toEqual([]);
  const file = await saved();
  for (const [width, px] of [[479, null], [498, 298]]) {
    log = [];
    recordFiles[PINS] = JSON.stringify(file);
    const w = new Threads();
    const cx2 = makeCx();
    state.shared = { "threads.byTerminal": { t4: { pane: "p2" } } };
    state.panes = state.panes.filter((p) => p.pane !== "p3");
    w.init(state.props, cx2);
    w.width = width;
    await settle(w);
    await new Promise((r) => setTimeout(r, 20));
    draw(w, cx2);
    draw(w, cx2);
    expect(w.pinnedList().length).toBe(1);
    expect(log.filter(([, n]) => n === "pane.split").length).toBe(px ? 1 : 0);
    if (!px) { expect(w.view).toBe("all"); continue; }
    state.panes.push({ pane: "p3", tab: "A", terminal: null, mod: "agent-threads" });
    w.settleSplit();
    expect(log.filter(([, n]) => n === "layout.resize")[0][2]).toEqual({ id: "p3", px });
    expect(log.at(-1)).toEqual(["run", "pane.focus", { pane: "p2" }]);
  }
});

test("the header fits at the widths Threads has beside the column: the Pinned button is labelled, Jump to latest is a pill below, and under 300 px agents give way", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6", "--agents");
  v.sel = keys()[0];
  v.action("pin", cx);
  // From 440 px the agent's state ("Done", about 47 px) sits beside the badge.
  for (const [width, text] of [[260, 60], [380, 110], [500, 110], [640, 250]]) {
    v.width = width;
    const ids = v.headerButtons().map((b) => b[0]);
    expect(ids.includes("th-agents")).toBe(width >= 300);
    expect(ids.includes("th-pin")).toBe(false);
    expect(ids.includes("th-latest")).toBe(false);
    expect(v.headerButtons().find((b) => b[0] === "th-pinned")[6]).toBe("Pinned 1");
    expect(v.headerLayout().text).toBeGreaterThanOrEqual(text);
    draw(v, cx);
  }
});

test("a reply block is one list item however tall, so a drag can cross its paragraphs", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6", "--long");
  v.width = 500;
  v.rootH = 300; // a short pane, so the long reply's prose is taller than it
  v.listH = 200;
  for (const k of keys()) v.toggle(k, cx);
  const md = v.rows().filter((r) => r.kind === "md");
  const tall = md.find((r) => r.src.includes("Paragraph 1:"));
  expect(v.mdHeight(tall.src)).toBeGreaterThan(v.rootH);
  for (const i of [1, 2, 3, 4, 5, 6]) expect(tall.src).toContain(`Paragraph ${i}:`);
  expect(md.filter((r) => r.src.includes("Paragraph")).length).toBe(1);
  expect(md.every((r) => !/^md:.*\.\d+$/.test(r.key))).toBe(true);
  draw(v, cx);
});

test("a pin left on a paragraph by the earlier build: a second press returns to the start of its block", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6", "--long");
  const a = twoBlocks(keys);
  v.toggle(a, cx);
  v.action("pin", cx);
  const pin = v.pinnedList()[0].pin;
  pin.anchor = ["md", "2.1"]; // a paragraph item, which no longer exists
  pin.whole = true;
  v.toggle(a, cx);
  v.sel = keys().at(-1);
  v.listH = 60;
  v.key(keyEv("1"), cx);
  v.key(keyEv("1"), cx);
  v.scrollTo.until = 0;
  const rows = v.rows();
  expect(rows.some((r) => r.key === `md:${a}:2.1`)).toBe(false);
  expect(v.scrollTo).toMatchObject({ key: `md:${a}:2.1`, or: [`md:${a}:2`] });
  expect(rows.some((r) => r.key === `md:${a}:2`)).toBe(true);
  draw(v, cx);
  expect(v.scrollTo).toMatchObject({ key: `resume:${a}`, or: [`md:${a}:2`] });
  v.scrollTo.until = 0;
  draw(v, cx);
  expect(v.scrollTo).toBe(null);
});

test("adding a pin does not change the list items of a reply", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6", "--long");
  v.rootH = 500;
  v.listH = 400;
  const a = keys()[0];
  v.toggle(a, cx);
  const items = () => v.rows().filter((r) => r.kind === "md").map((r) => r.key).join(",");
  const before = items();
  v.action("pin", cx);
  expect(items()).toBe(before);
});

test("a part that fails to draw shows as an error row, not a blank list", async () => {
  const { v, cx } = await pinPane();
  const key = v.turnKeys(v.rows())[1];
  v.toggle(key, cx);
  const item = v.item.bind(v);
  // Before the guard, one throw here blanked every row on screen until a scroll or resize.
  v.item = (t, r, ...rest) => { if (r.kind === "you") throw new Error("test failure in you"); return item(t, r, ...rest); };
  expect(() => draw(v, cx)).not.toThrow();
  const drawn = lastList.draw({ start: 0, end: lastList.keys.length });
  expect(drawn.length).toBe(lastList.keys.length);
  expect(v.drawError).toMatchObject({ msg: "test failure in you", kind: "you", key: `you:${key}` });
  draw(v, cx);
  expect(state.shared["threads.drawError"]).toMatchObject({ msg: "test failure in you", kind: "you" });
  expect(toastText(v)).toBe("Part of a turn could not be drawn. The details are saved for the owner.");
  v.item = item;
});

test("the list measuring its first item does not move a pin's place", async () => {
  const { v, cx } = await pinPane();
  const key = v.turnKeys(v.rows())[2];
  v.toggle(key, cx);
  v.togglePin(key, cx);
  v.placeHold = null; v.placeBase = null;
  draw(v, cx);
  const rows = v.rows();
  const at = rows.findIndex((r) => r.key === `you:${key}`);
  expect(at).toBeGreaterThan(0);
  lastList.draw({ start: at, end: Math.min(rows.length, at + 3) });
  // gpui asks for item 0 alone to measure the list's width; the top is still the YOU part.
  lastList.draw({ start: 0, end: 1 });
  expect(v.topKey).toBe(`you:${key}`);
  expect(v.pinnedAll().find((p) => p.key === key).pin.anchor).toEqual(["you", null]);
});

test("the user's bubble is blue and an agent's amber by default, and the panel's swatches change them", async () => {
  const { v, cx } = await pane(fixture("--extra", "6"));
  const you = () => v.bubbleLook(theme, false);
  const agent = () => v.bubbleLook(theme, true);
  expect(you().style).toMatchObject({ fill: "#2563EB", ink: "#FFFFFF", outline: false });
  // Plain: the theme's text colour at 8%, in the theme's own colours.
  v.prefs = { ...v.prefs, bubbleColor: "plain" };
  expect(you().style).toMatchObject({ fill: "#e6e6e614", ink: theme.foreground, outline: false });
  expect(you().theme).toBe(theme);
  expect(agent().style).toMatchObject({ fill: "#87643A", ink: "#FFFFFF", outline: false });
  // On a coloured fill the text, muted and accent colours are the bubble's ink, so a quote,
  // a command and Show more read on it.
  v.action("bubbleColor:slate", cx);
  expect(you().style).toMatchObject({ fill: "#47648F", ink: "#FFFFFF", outline: false });
  expect(you().theme).toMatchObject({ foreground: "#FFFFFF", accent: "#FFFFFF", background: "#47648F" });
  // Chosen from the panel, slate holds (the change is parsed with the current mark; the
  // file's side is in settings.test.js).
  expect(v.prefs.bubbleColor).toBe("slate");
  v.settingsOpen = true;
  draw(v, cx);
  expect(v.action("bubbleColor:teal", cx)).toBe(true);
  expect(v.prefs.bubbleColor).toBe("teal");
  expect(you().style.fill).toBe("#36706D");
  expect(v.action("agentBubbleColor:#abc", cx)).toBe(true);
  expect(agent().style.fill).toBe("#AABBCC");
  expect(agent().style.ink).toBe("#111111"); // light fill: dark text
  draw(v, cx);
  expect(v.action("bubbleColor:navy", cx)).toBe(false);
  // Plain: the theme's own look, as before the colours.
  v.action("bubbleColor:plain", cx);
  v.action("agentBubbleColor:plain", cx);
  expect(you().theme).toBe(theme);
  expect(you().style.fill).toBe("#e6e6e614");
  expect(agent().style).toMatchObject({ fill: theme.background, outline: true });
  draw(v, cx);
  v.action("resetSettings", cx);
  expect(v.prefs).toMatchObject({ bubbleColor: "blue", agentBubbleColor: "amber", alwaysShowTime: false });
  await new Promise((r) => setTimeout(r, 20));
  draw(v, cx);
});

test("a coloured bubble draws the open message as plain text in its ink, quotes behind their bar; plain draws Markdown", async () => {
  const { v, cx } = await pane(fixture("--only", "0", "--quotes"));
  v.open = new Set(v.current().turns.map((t) => `0:${t.n}`));
  const you = () => v.rows().filter((r) => r.kind === "you").map((r) => v.youMd(r));
  v.action("bubbleColor:teal", cx);
  expect(you().length).toBeGreaterThan(0);
  expect(you().every((y) => y.plain && y.parts)).toBe(true);
  expect(you().some((y) => y.parts.some((p) => p.quote))).toBe(true);
  draw(v, cx);
  v.action("bubbleColor:plain", cx);
  expect(you().every((y) => !y.plain && y.md != null)).toBe(true);
  draw(v, cx);
});

test("a selected turn has no bar on its left: closed, open, or in the outline", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  draw(v, cx);
  // The bar was a 2 px element down the left edge: absolute, top(0), bottom(0), w(2).
  const bars = () => {
    rec = [];
    v.render(cx);
    const c = rec;
    rec = null;
    let n = 0;
    for (let i = 1; i < c.length; i++) if (c[i][0] === "w" && c[i][1] === 2 && c[i - 1][0] === "bottom" && c[i - 1][1] === 0) n++;
    return n;
  };
  const keys = v.turnKeys(v.rows());
  v.sel = keys[keys.length - 1];
  expect(bars()).toBe(0);
  v.open.add(v.sel);
  v.rowsKey = null;
  expect(bars()).toBe(0);
  v.action("outline:on", cx);
  expect(v.outlined()).toBe(true);
  expect(bars()).toBe(0);
});

test("the quiet turn: no meta line over the bubble; the strip under it shows #n and the time on the selected turn, the time on all with alwaysShowTime", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  const strings = (el) => { rec = []; el(); const c = rec; rec = null; return c.filter((x) => x[0] === "child" && typeof x[1] === "string").map((x) => x[1]); };
  const calls = (el) => { rec = []; el(); const c = rec; rec = null; return c; };
  const row = v.rows().find((r) => r.kind === "turn" && !r.turn.agent);
  const turn = row.turn;
  const time = fmtTimeForTest(turn.ts);
  v.sel = null;
  let drawn = strings(() => v.rowItem(theme, row, false));
  expect(drawn).not.toContain("User");
  // (The Turn card in the line's hover card is titled "Turn #n"; it shows only under the pointer.)
  expect(drawn.some((x) => x.includes(`#${turn.n}`) && x !== `Turn #${turn.n}`)).toBe(false);
  // The time is drawn for a hover on the message to reveal: the message and its strip are one
  // element, clear at rest and dim while the pointer is on it. No icons on a closed row that
  // is not selected, since its one click opens it.
  expect(drawn).toContain(time);
  const rest = calls(() => v.rowItem(theme, row, false));
  const clear = rest.findIndex((e) => e[0] === "text_color" && e[1] === "#00000000");
  expect(clear).toBeGreaterThan(-1);
  expect(rest.slice(clear).some((e) => e[0] === "text_color" && e[1] === theme.dim)).toBe(true);
  expect(rest.filter((e) => e[0] === "svg").map((e) => String(e[1]).split("/").pop())).not.toContain("pin.svg");
  // An open turn's strips are items of their own, so each reveals its icons on its own
  // hover: copy, pin and "#n · time" under the message; copy and quote under the reply.
  const svgs = (el) => calls(el).filter((e) => e[0] === "svg").map((e) => String(e[1]).split("/").pop());
  expect(svgs(() => v.youStrip(theme, turn, row.key, false, "all"))).toEqual(["copy.svg", "pin.svg"]);
  expect(strings(() => v.youStrip(theme, turn, row.key, false, "all"))).toContain(`#${turn.n} · ${time}`);
  expect(svgs(() => v.actsStrip(theme, turn, row.key, false, true))).toEqual(["copy.svg", "quote.svg"]);
  expect(strings(() => v.youStrip(theme, turn, row.key, false))).toEqual([]);
  expect(drawn).toContain(v.workText(turn));
  expect(v.workText(turn)).toMatch(/^Worked for \d/);
  // No stats line under the reply (the hover card's own text aside), and no fill on a selected row.
  const card = new Set(v.detailRows(turn).flat().filter(Boolean));
  expect(drawn.some((x) => / tokens/.test(x) && !card.has(x))).toBe(false);
  v.sel = row.key;
  drawn = strings(() => v.rowItem(theme, row, true));
  expect(drawn).toContain(`#${turn.n} · ${time}`);
  const sel = calls(() => v.rowItem(theme, row, true));
  expect(sel.some((e) => e[0] === "bg" && e[1] === theme.selected)).toBe(false);
  // The selected row's two strips draw their icons: copy and pin under the bubble; copy and
  // quote under the reply.
  const icons = sel.filter((e) => e[0] === "svg").map((e) => String(e[1]).split("/").pop());
  for (const i of ["copy.svg", "pin.svg", "quote.svg"]) expect(icons).toContain(i);
  for (const i of ["text-cursor.svg", "square-terminal.svg"]) expect(icons).not.toContain(i);
  // The bubble's width is passed on.
  expect(sel.some((e) => e[0] === "w" && e[1] === row.shape.bubbleW)).toBe(true);
  // Always show time: the time under every bubble, no icons until the turn is selected.
  v.sel = null;
  v.action("alwaysTime", cx);
  expect(v.prefs.alwaysShowTime).toBe(true);
  drawn = strings(() => v.rowItem(theme, row, false));
  expect(drawn).toContain(time);
  expect(calls(() => v.rowItem(theme, row, false)).filter((e) => e[0] === "svg").map((e) => String(e[1]).split("/").pop())).not.toContain("pin.svg");
  v.action("alwaysTime", cx);
  expect(v.prefs.alwaysShowTime).toBe(false);
  // The strips keep their height either way, so selecting a turn moves nothing.
  const h = row.shape.height;
  v.sel = row.key;
  expect(v.rows().find((r) => r.key === row.key).shape.height).toBe(h);
  // An agent's message: its sender over the bubble, its strip on the left.
  const agentTurn = { ...turn, agent: true, sender: { kind: "agent", name: "general-purpose" } };
  const a = calls(() => v.senderLine(theme, agentTurn));
  expect(a.filter((x) => x[0] === "child" && typeof x[1] === "string").map((x) => x[1]).join(" ")).toMatch(/general-purpose/);
  expect(calls(() => v.youStrip(theme, agentTurn, "0:1", true)).some((e) => e[0] === "justify_end")).toBe(false);
  expect(calls(() => v.youStrip(theme, turn, "0:1", true)).some((e) => e[0] === "justify_end")).toBe(true);
  draw(v, cx);
});

test("names: none over your message, none over a reply (one agent), who replied in a mixed session, Agent when the session records none", async () => {
  const { v } = await pane(fixture("--extra", "2"));
  const row = v.rows().find((r) => r.kind === "turn" && !r.turn.agent);
  const drawn = (r) => { rec = []; v.rowItem(theme, r, true); const c = rec; rec = null; return c.filter((x) => x[0] === "child" && typeof x[1] === "string").map((x) => x[1]); };
  expect(v.current().agentName).toBe("shop-agent");
  // No name over your message (the bubble on the right says it is yours), and none over
  // the reply in a session with one agent.
  expect(drawn(row)).not.toContain("User");
  expect(drawn(row)).not.toContain("shop-agent");
  expect(v.lineText(row.turn)).not.toContain("·");
  // A session where more than one agent replied (OpenCode records each turn's agent): who
  // replied leads the line, closed or open.
  const own = v.current().turns.filter((x) => !x.agent);
  own[0].by = "build";
  own[1].by = "plan";
  expect(v.lineText(own[0])).toStartWith("build · ");
  expect(v.lineText(own[1])).toStartWith("plan · ");
  expect(drawn(v.rows().find((r) => r.kind === "turn" && r.turn === own[0]))).toContain("build");
  own[1].by = "build";
  expect(v.lineText(own[0])).not.toContain("build");
  // An agent message never makes the session mixed, and its own caption names no one.
  // (It sits in the session, with another agent's name, so the old check would have named it.)
  const msg = { ...own[1], agent: true, by: "plan" };
  own[0].by = "build";
  v.current().turns.push(msg);
  expect(v.mixedAgents(msg)).toBe(false);
  expect(v.mixedAgents(own[0])).toBe(false);
  v.current().turns.pop();
  delete own[0].by;
  delete own[1].by;
  // The session's agent name moved to the badge's tooltip.
  expect(v.bindingTip()).toContain("agent shop-agent");
  // A name the reply itself records (OpenCode's agent) wins; with neither, "Agent".
  expect(v.agentName({ ...row.turn, by: "plan" })).toBe("plan");
  v.current().agentName = null;
  expect(v.agentName(row.turn)).toBe("Agent");
  // There is no name setting: the settings panel has no name field, and the image viewer
  // heads the user's turn "User".
  v.setSettings(true);
  for (const tab of ["general", "chat"]) {
    v.setTab = tab;
    rec = []; v.settingsCard(theme); const panel = rec; rec = null;
    expect(panel).not.toContainEqual(["child", "Your name"]);
  }
  expect(v.viewerTurn(row.turn).who).toBe("User");
});


test("an agent message keeps its sender's name over the bubble, and a reply row is the height its parts draw without a name line", async () => {
  const { v, cx } = await pane(fixture("--only", "2", "--agents"));
  v.setAgents(true, cx);
  draw(v, cx);
  const drawn = (r) => { rec = []; v.rowItem(theme, r, true); const c = rec; rec = null; return c.filter((x) => x[0] === "child" && typeof x[1] === "string").map((x) => x[1]); };
  const msgs = v.rows().filter((r) => r.kind === "turn" && r.turn.agent && r.turn.sender?.name);
  expect(msgs.length).toBeGreaterThan(0);
  for (const r of msgs) expect(drawn(r).some((s) => s.includes(senderLabel(r.turn.sender, v.width)) || s === r.turn.sender.name)).toBe(true);
  // A turn with nothing the reply leaves out: its open caption is the line alone, 6 px down.
  const quiet = v.rows().find((r) => r.kind === "turn" && !r.turn.agent && !r.turn.tools && !r.turn.followups && !v.borrowedFrom(r.turn));
  expect(quiet).toBeTruthy();
  v.toggle(quiet.key, cx);
  const cap = v.rows().find((r) => r.kind === "rhead" && r.turn === quiet.turn);
  expect(v.captionParts(cap.turn)).toEqual([]);
  expect(v.estimate(cap)).toBe(6 + 24);
  v.toggle(quiet.key, cx);
  const md = v.rows().find((r) => r.kind === "turn" && !r.turn.agent && r.shape.md != null);
  expect(md.shape.mdBase).toBe(rowHeight(md.shape.p, 0, (md.shape.pMore ? 1 : 0) + (md.shape.rMore ? 1 : 0)));
  expect(md.shape.mdBase).toBe(8 + 12 + md.shape.p * 22 + 6 + 16 + 6 + 24 + 6 + 6 + 16 + 10 + 18 * ((md.shape.pMore ? 1 : 0) + (md.shape.rMore ? 1 : 0)));
  // An agent's message is taller by its sender line.
  const am = msgs[0];
  expect(am.shape.height).toBeGreaterThan(0);
});

test("round 6: on macOS, messages and replies take the system face while Herdr's interface font is Geist; reply prose is at 86% strength; the person's own font is followed", async () => {
  const { v } = await pane(fixture("--extra", "2"));
  // Other test files mock "herdr" without window(), and the last mock wins in a full run.
  v.platform = () => hostPlatform;
  const calls = (fn) => { rec = []; fn(); const c = rec; rec = null; return c; };
  const faces = (c) => c.filter((x) => x[0] === "font_family").map((x) => x[1]);
  const row = v.rows().find((r) => r.kind === "turn" && !r.turn.agent);
  const open = () => { v.open = new Set([row.key]); const rows = v.rows(); v.open = new Set(); return rows; };
  const draw = () => {
    v.renders = (v.renders ?? 0) + 1;
    const rows = open();
    const md = rows.find((r) => r.kind === "md");
    const you = rows.find((r) => r.kind === "you");
    v.open = new Set([row.key]);
    const out = { closed: calls(() => v.rowItem(theme, row, true)), md: calls(() => v.partContent(theme, md, false)), you: calls(() => v.partContent(theme, you, false)) };
    v.open = new Set();
    return out;
  };
  const saved = { ...herdrSettings };
  try {
    // Not macOS: Herdr's interface font stays; the reply is still at 86%.
    hostPlatform = "linux";
    let d = draw();
    for (const c of Object.values(d)) expect(faces(c)).not.toContain(".SystemUIFont");
    expect(d.md).toContainEqual(["opacity", 0.86]);
    // macOS with Herdr's own Geist (unset or named): the system face on the closed row's
    // bubble and reply, the open message and the open reply.
    hostPlatform = "macos";
    for (const ui of [undefined, "Geist"]) {
      herdrSettings = { ...saved, ui_font: ui };
      d = draw();
      for (const c of Object.values(d)) expect(faces(c)).toContain(".SystemUIFont");
      expect(d.md).toContainEqual(["opacity", 0.86]);
      // The person's bubble is not dimmed.
      expect(d.you).not.toContainEqual(["opacity", 0.86]);
    }
    // A font the person set is followed: no face of ours.
    herdrSettings = { ...saved, ui_font: "Inter" };
    d = draw();
    for (const c of Object.values(d)) expect(faces(c)).not.toContain(".SystemUIFont");
  } finally {
    herdrSettings = saved;
    hostPlatform = "linux";
  }
});

test("reading type: message and reply text at the Text size on 1.57 lines, a reading line wide at 960 px, labels unchanged", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  const calls = (fn) => { rec = []; fn(); const c = rec; rec = null; return c; };
  const sizes = (c) => c.filter((x) => x[0] === "text_size").map((x) => x[1]);
  v.forcedWidth = 960; v.width = 960;
  const row = v.rows().find((r) => r.kind === "turn" && !r.turn.agent);
  const c = calls(() => v.rowItem(theme, row, true));
  // The message and the reply at 14 px on 21 px lines; the name, the date and the stats stay small.
  expect(sizes(c)).toEqual(expect.arrayContaining([14, 11.5]));
  expect(c.some((x) => x[0] === "h" && x[1] === 22)).toBe(true);
  // The reply stops at the reading line, about 70 characters, not across the pane.
  const prose = v.prose();
  expect(prose).toBeLessThan(500);
  expect(c.some((x) => x[0] === "max_w" && x[1] === prose)).toBe(true);
  for (const l of row.shape.reply) expect(l.length).toBeLessThanOrEqual(75);
  // An open reply's text: 14 px, 21 px lines, at most the reading line.
  v.open = new Set([row.key]);
  const md = v.rows().find((r) => r.kind === "md");
  const m = calls(() => v.partContent(theme, md, false));
  expect(m).toEqual(expect.arrayContaining([["max_w", prose], ["text_size", 14], ["line_height", "22px"]]));
  // Text size: the stepper goes to 18 and no further, and Reset brings 14 back.
  for (let i = 0; i < 6; i++) v.action("textSize:+", cx);
  expect(v.prefs.textSize).toBe(18);
  expect(v.action("textSize:+", cx)).toBe(false);
  expect(v.rt().line).toBe(28);
  expect(v.prose()).toBeGreaterThan(prose);
  const big = v.rows().find((r) => r.kind === "turn" && !r.turn.agent);
  expect(big.shape.height).toBeGreaterThan(row.shape.height);
  v.action("resetSettings", cx);
  expect(v.prefs.textSize).toBe(14);
  await new Promise((r) => setTimeout(r, 20));
});

test("Cmd-Shift-T opens Threads at the reading width: a wider pane shrinks to fitWidth once, a narrower one keeps its width", async () => {
  for (const [measured, size, want] of [[900, 14, 573], [900, 18, 704], [480, 14, null]]) {
    const { v, cx } = await pane(fixture("--extra", "2"));
    v.prefs = { ...v.prefs, textSize: size };
    state.shared["threads.byTerminal"] = { t4: { pane: "p2" } };
    state.shared["threads.fit"] = { p2: true, p9: true };
    v.paneW = measured;
    log = [];
    v.poll(cx);
    v.poll(cx);
    const resized = log.filter(([, n]) => n === "layout.resize").map((x) => x[2]);
    expect(resized).toEqual(want ? [{ id: "p2", px: want }] : []);
    // Once only: the flag is gone, and another pane's flag stays.
    expect(state.shared["threads.fit"]).toEqual({ p9: true });
  }
  // A pane the launcher did not just open (a restart, an existing layout, a drag): with Keep
  // to reading width on, it is asked back once per width; off, it is left alone.
  const { v, cx } = await pane(fixture("--extra", "2"));
  state.shared["threads.byTerminal"] = { t4: { pane: "p2" } };
  v.paneW = 900;
  log = [];
  v.poll(cx);
  v.poll(cx);
  expect(log.filter(([, n]) => n === "layout.resize").map((x) => x[2])).toEqual([{ id: "p2", px: 573 }]);
  // Herdr left it wide (a pane alone in its tab): no second ask at the same width; a new
  // width (a drag) asks again.
  log = [];
  v.poll(cx);
  expect(log.filter(([, n]) => n === "layout.resize")).toEqual([]);
  v.paneW = 960;
  v.poll(cx);
  expect(log.filter(([, n]) => n === "layout.resize").map((x) => x[2])).toEqual([{ id: "p2", px: 573 }]);
  // The header offers the fit button while it is wider; w fits Threads and an open column.
  expect(v.headerButtons().map((b) => b[0])).toContain("th-fit");
  log = [];
  v.key(keyEv("w"), cx);
  expect(log.filter(([, n]) => n === "layout.resize").map((x) => x[2])).toEqual([{ id: "p2", px: 573 }]);
  v.paneW = 571;
  expect(v.headerButtons().map((b) => b[0])).not.toContain("th-fit");
  // Off: a wide pane stays as it is.
  v.prefs = { ...v.prefs, readingWidth: false };
  v.paneW = 900;
  log = [];
  v.poll(cx);
  expect(log.filter(([, n]) => n === "layout.resize")).toEqual([]);
});

test("a pane wider than the reading width lays the turns out in a centred column that wide, scaled with Text size", async () => {
  const { v, cx } = await pane(fixture("--extra", "3"));
  // The text is at most a reading line with gutters of 8% of the pane each side (24 to 56 px),
  // and the rows pad 16 px inside the column: 461 + 32 at 14 px, 592 + 32 at 18.
  for (const [paneW, size, col] of [[960, 14, 493], [960, 18, 624], [500, 14, 452], [300, 14, 284]]) {
    v.prefs = { ...v.prefs, textSize: size };
    v.paneW = paneW;
    draw(v, cx);
    expect(v.width).toBe(col);
    expect(v.pw()).toBe(paneW);
    expect(v.colLeft()).toBe((paneW - col) / 2);
  }
  // The header and the Pinned column go by the pane, not the column.
  v.prefs = { ...v.prefs, textSize: 14 };
  v.paneW = 960;
  draw(v, cx);
  expect(v.headerLayout().width).toBe(960);
  expect(v.headerButtons().find((b) => b[0] === "th-pinned")[2]).toBe("Open the Pinned column beside Threads (v)");
});

test("width: Comfortable, Wide and Full set the column and the reading line; choosing one resizes the pane while it is kept at its width, and Full turns that off", async () => {
  const { v, cx } = await pane(fixture("--extra", "3"));
  state.shared["threads.byTerminal"] = { t4: { pane: "p2" } };
  // The column a wide pane lays its turns out in: the line and 16 px each side, and in Full
  // the pane less its 56 px gutters.
  for (const [w, col, prose] of [["comfortable", 493, 461], ["wide", 624, 592], ["full", 880, 848]]) {
    v.prefs = { ...v.prefs, textSize: 14, width: w };
    v.paneW = 960;
    draw(v, cx);
    expect(v.width).toBe(col);
    expect(v.prose()).toBe(prose);
  }
  // A bubble stops at Wide's line even in Full.
  expect(bubbleMax(960, 14, Infinity)).toBe(592 + 20);
  // Choosing Wide with the pane kept at its width grows the pane to 676; Comfortable takes it
  // back to 573; Full leaves it alone and the switch as it was.
  v.prefs = { ...v.prefs, width: "comfortable", readingWidth: true };
  v.paneW = 573;
  log = [];
  expect(v.action("width:wide", cx)).toBe(true);
  expect(v.prefs.width).toBe("wide");
  expect(log.filter(([, n]) => n === "layout.resize").map((x) => x[2])).toEqual([{ id: "p2", px: 704 }]);
  v.paneW = 704;
  log = [];
  v.action("width:comfortable", cx);
  expect(log.filter(([, n]) => n === "layout.resize").map((x) => x[2])).toEqual([{ id: "p2", px: 573 }]);
  v.paneW = 573;
  log = [];
  v.action("width:full", cx);
  expect(v.prefs).toMatchObject({ width: "full", readingWidth: true });
  expect(log.filter(([, n]) => n === "layout.resize")).toEqual([]);
  // Full has no reading width: no fit button, and the pane is never asked back.
  v.paneW = 1200;
  v.poll(cx);
  expect(log.filter(([, n]) => n === "layout.resize")).toEqual([]);
  expect(v.headerButtons().map((b) => b[0])).not.toContain("th-fit");
  // With the switch off, Wide changes the column only.
  v.prefs = { ...v.prefs, readingWidth: false };
  log = [];
  v.action("width:wide", cx);
  expect(log.filter(([, n]) => n === "layout.resize")).toEqual([]);
  expect(v.action("width:huge", cx)).toBe(false);
  // The card's Chat tab: a Width row with the three choices, each with its icon, then the
  // pane and its reading column as a line, with the characters a line; in a pane narrower
  // than the column, the line says it looks like Full here.
  v.paneW = 420;
  v.action("settings", cx);
  rec = []; v.settingsCard(theme); const sp = rec; rec = null;
  const ids = sp.filter((e) => e[0] === "id").map((e) => e[1]);
  expect(ids).toEqual(expect.arrayContaining(["th-width-comfortable", "th-width-wide", "th-width-full", "th-set-ruler"]));
  const icons = sp.filter((e) => e[0] === "svg").map((e) => String(e[1]).split("/").pop());
  expect(icons).toEqual(expect.arrayContaining(["width-comfortable.svg", "width-wide.svg", "width-full.svg"]));
  const texts = sp.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
  expect(texts).toContain("Keep the pane at this width");
  expect(texts).toContain("Up to 90 characters a line. This pane has room for less, so it looks like Full here.");
  v.paneW = 900;
  expect(v.widthNote()).toBe("Up to 90 characters a line.");
  v.prefs = { ...v.prefs, width: "full" };
  expect(v.widthNote()).toBe("Text runs the whole pane.");
  v.closeSettings();
});

test("a collapsed reply draws as Markdown: its block is measured, and the row is the rest plus that measure, image tiles included", async () => {
  const { v, cx } = await pane(fixture("--extra", "3", "--images"));
  v.width = 545;
  draw(v, cx);
  const rows = v.rows().filter((r) => r.kind === "turn" && r.shape.md != null);
  expect(rows.length).toBeGreaterThan(0);
  const withTiles = rows.find((r) => r.shape.thumbs) ?? rows[0];
  const cmd = v.cmdRow(withTiles);
  expect(v.probeRows.some((r) => r.key === cmd.key)).toBe(true);
  const before = v.height(withTiles);
  v.probed(cmd.key, v.partSig(cmd), { width: 500, height: 63 }, cx);
  const after = v.height(withTiles);
  // A row with tiles gives its meta line and tiles to the wtop item over it.
  expect(after).toBe(withTiles.shape.mdBase + 63 - v.splitCut(withTiles));
  if (withTiles.shape.thumbs) {
    const top = v.rows().find((r) => r.key === `imgs:${withTiles.key}`);
    expect(top.kind).toBe("wtop");
    expect(v.height(top) + after).toBe(withTiles.shape.mdBase + 63);
  }
  if (withTiles.shape.thumbs) expect(withTiles.shape.mdBase).toBeGreaterThan(rowHeight(withTiles.shape.p, 0, 0) + 40);
  expect(typeof before).toBe("number");
});

test("the sticky day: the day of the item at the top of the pane, in its own strip, not while a band is at the top", async () => {
  const { v, cx } = await pane(fixture("--extra", "6", "--gap", "43200"));
  v.width = 545;
  draw(v, cx);
  const rows = v.rows();
  const days = rows.map((r, i) => [r, i]).filter(([r]) => r.kind === "day");
  expect(days.length).toBeGreaterThan(1);
  const [d1, i1] = days[1];
  // The band at the top: no sticky.
  v.topKey = d1.key;
  expect(v.stickyDay()).toBe(null);
  // An item in that day further down: its band shows at the top, and a redraw is asked for.
  const inside = rows.slice(i1 + 1).find((r) => r.kind !== "day");
  v.stickyShown = null;
  v.stickyDue = false;
  v.topKey = inside.key;
  v.noteTopDay();
  expect(v.stickyDay()?.key).toBe(d1.key);
  expect(v.stickyDue).toBe(true);
  // The item just before the next band keeps its own day: the pill sits in the strip above the
  // list, so it never covers the band under it.
  const before = rows[days[2] ? days[2][1] - 1 : -1];
  if (before) { v.topKey = before.key; expect(v.stickyDay()?.key).toBe(d1.key); }
  // The drawn pane carries it while the person scrolls (the floating top's pill).
  v.topKey = inside.key;
  v.scrollSeenAt = Date.now();
  rec = [];
  v.render(cx);
  const ids = rec.filter(([n]) => n === "id").map(([, x]) => x);
  rec = null;
  expect(ids).toContain("th-sticky-day");
});

test("a done turn during a background wake-up keeps its reply, with an Updating line under it, never 'no reply yet'", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  const s = v.sessions.at(-1);
  const turn = s.turns.at(-1);
  expect(turn.done).toBe(true);
  // A task notification woke the agent: Herdr says working, the turn is still done.
  state.terminals[0].status = "working";
  s.followActive = true;
  s.followSince = Date.now() - 90 * 1000;
  turn.wakeTools = 3;
  turn.latest = "Checking the job's output.";
  s.version++;
  v.rowsKey = null;
  const rows = v.rows();
  expect(rows.some((r) => r.kind === "wrow" || r.kind === "working")).toBe(false);
  const last = rows.findIndex((r) => r.key === `${v.sessions.length - 1}:${turn.n}`);
  expect(rows[last].kind).toBe("turn");
  expect(rows[last + 1].kind).toBe("wake");
  expect(v.height(rows[last + 1])).toBe(24);
  rec = []; v.item(theme, rows[last + 1], false, 13); const wake = rec; rec = null;
  const text = wake.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]).join(" ");
  expect(text).toMatch(/^Updating · 1:3\d · 3 tool calls · Checking the job's output\.$/);
  // The turn's own row still has its reply, and nothing on screen says "no reply yet".
  rec = []; v.rowItem(theme, rows[last], false); const row = rec; rec = null;
  expect(JSON.stringify(row)).not.toContain("no reply yet");
  expect(v.liveShown).toBe(true);
  draw(v, cx);
  // The wake-up ends: the line goes.
  s.followActive = false;
  s.version++;
  v.rowsKey = null;
  expect(v.rows().some((r) => r.kind === "wake")).toBe(false);
});

test("a reply longer than Herdr draws in one Markdown view opens whole: list items within the limit, escaped prices, and plain text if one draws nothing", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  const turn = v.sessions.at(-1).turns.at(-1);
  // A made-up reply with the shape of the one that vanished: over 4,096 characters, a table of
  // prices, bold spans between two prices, and a numbered list after "These are the open choices:".
  turn.after = [readFileSync(join(root, "test/fixtures/long-reply.md"), "utf8").trim()];
  turn.shapeKey = null;
  const key = `${v.sessions.length - 1}:${turn.n}`;
  v.open = new Set([key]);
  v.sel = key;
  v.rowsKey = null;
  // The whole reply, as several list items split at paragraphs, each one Markdown view
  // within the limit. Nothing is cut and there is no Show full reply.
  const md = v.rows().filter((r) => r.kind === "md");
  expect(md.length).toBeGreaterThan(1);
  expect(md.map((r) => r.key)).toEqual(md.map((_, j) => `md:${key}:0.${j}`));
  expect(md.every((r) => Buffer.byteLength(r.src) <= MD_MAX)).toBe(true);
  expect(md.map((r) => r.src).join("\n\n")).toBe(reply(turn));
  expect(v.rows().some((r) => r.kind === "more")).toBe(false);
  expect(v.rows().find((r) => r.kind === "fold")).toMatchObject({ key: `fold:${key}`, left: 0 });
  mdSources.length = 0;
  for (const r of md) v.partContent(theme, r, false);
  expect(mdSources.map(([id]) => id)).toEqual(md.map((r) => `th-md-${r.key}`));
  // Dollar signs are escaped, so the bold between two prices is bold, not math.
  const all = mdSources.map(([, m]) => m).join("\n\n");
  expect(all).toContain("**4,180 map look-ups at \\$0.009 each**");
  expect(all.replace(/\\\$/g, "$")).toBe(reply(turn));
  // Herdr drew a block at no height: it shows as plain text with a note instead of vanishing.
  const last = md.at(-1);
  v.probed(last.key, v.partSig(last), { height: 6 * v.zoom() }, cx);
  expect(v.mdBroken.has(last.key)).toBe(true);
  expect(v.rowDetail(last)).toMatch(/ plain /);
  mdSources.length = 0;
  rec = []; v.partContent(theme, last, false); const plain = rec; rec = null;
  expect(mdSources.length).toBe(0);
  const text = plain.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]).join(" ");
  expect(text).toContain("Herdr could not draw this part as Markdown, so it shows as plain text.");
  expect(text).toContain("the morning van.");
  draw(v, cx);
});

// A synthetic reply of about 10,000 words in prose, lists and a table, with no code fence.
function longProse(words) {
  const out = [];
  let n = 0;
  for (let p = 1; n < words; p++) {
    if (p % 9 === 0) { out.push(`- Step ${p}a: check the route table\n- Step ${p}b: replay the queue\n- Step ${p}c: compare the totals`); n += 21; continue; }
    if (p % 13 === 0) { out.push(`| Stop | Orders |\n|---|---|\n| Depot ${p} | ${p * 3} |\n| Market ${p} | ${p * 2} |`); n += 12; continue; }
    const s = Array.from({ length: 60 }, (_, i) => `word${p}x${i}`).join(" ");
    out.push(`Paragraph ${p}: ${s}.`);
    n += 62;
  }
  out.push("The end of the long reply.");
  return out.join("\n\n");
}

test("a 10,000-word reply with no code fence opens whole as Markdown, lands on its head, Esc collapses it, and the next turn is one down-arrow away", async () => {
  const { v, cx } = await pane(fixture("--extra", "3"));
  const keys = v.turnKeys(v.rows());
  const key = keys.at(-3);
  const next = keys.at(-2);
  const turn = v.findTurn(key);
  const long = longProse(10000);
  expect(long.split(/\s+/).length).toBeGreaterThanOrEqual(10000);
  expect(long).not.toContain("```");
  turn.after = [long];
  turn.shapeKey = null;
  v.rowsKey = null;
  const calls = [];
  v.scroll = { scroll_to_bottom() {}, scroll_to_item(i, how) { calls.push([i, how]); } };
  v.render(cx);
  cx.flush();
  v.sel = key;
  calls.length = 0;
  v.key(keyEv("enter"), cx);
  v.render(cx);
  cx.flush();
  expect(v.open.has(key)).toBe(true);
  const rows = v.rows();
  const md = rows.filter((r) => r.kind === "md" && r.key.startsWith(`md:${key}:`));
  // Every word is there, as Markdown, in list items Herdr can draw.
  expect(md.length).toBeGreaterThan(15);
  expect(md.every((r) => Buffer.byteLength(r.src) <= MD_MAX)).toBe(true);
  expect(md.map((r) => r.src).join("\n\n")).toBe(long);
  expect(md.at(-1).src).toMatch(/The end of the long reply\.$/);
  mdSources.length = 0;
  for (const r of md) v.partContent(theme, r, false);
  expect(mdSources.length).toBe(md.length);
  expect(rows.some((r) => r.kind === "more")).toBe(false);
  // It ends in a quiet Collapse (Esc) row, with nothing left out.
  const fold = rows.find((r) => r.kind === "fold");
  expect(fold).toMatchObject({ key: `fold:${key}`, left: 0 });
  rec = []; v.partContent(theme, fold, false); const ft = rec.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]); rec = null;
  expect(ft).toEqual(["Collapse", "Esc"]);
  // Opening lands on the turn's head: the card's end first, then its head at the top.
  const head = rows.findIndex((r) => r.key === key);
  expect(rows[head].kind).toBe("head");
  expect(calls.at(-1)).toEqual([head, "top"]);
  // Esc closes it and keeps its row in view, selected.
  calls.length = 0;
  v.key(keyEv("escape"), cx);
  v.render(cx);
  cx.flush();
  expect(v.open.has(key)).toBe(false);
  expect(v.sel).toBe(key);
  expect(calls).toEqual([[v.rows().findIndex((r) => r.key === key), "top"]]);
  // The next turn is one down-arrow away.
  v.key(keyEv("down"), cx);
  expect(v.sel).toBe(next);
  draw(v, cx);
});

test("an open reply past 200,000 characters stops there and says how much is left out; a short one has no Collapse row", async () => {
  const { v, cx } = await pane(fixture("--extra", "3"));
  const keys = v.turnKeys(v.rows());
  const key = keys.at(-2);
  const turn = v.findTurn(key);
  turn.after = [longProse(36000)];
  turn.shapeKey = null;
  v.sel = key;
  v.toggle(key, cx);
  const rows = v.rows();
  const shown = rows.filter((r) => r.kind === "md" && r.key.startsWith(`md:${key}:`)).reduce((n, r) => n + r.src.length, 0);
  expect(shown).toBeLessThanOrEqual(200005);
  expect(shown).toBeGreaterThan(199000);
  const fold = rows.find((r) => r.kind === "fold");
  // What the cap leaves out: the reply past 200,000 characters, give or take the cut at a word.
  expect(Math.abs(fold.left - (reply(turn).length - 200000))).toBeLessThan(400);
  rec = []; v.partContent(theme, fold, false); const ft = rec.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]); rec = null;
  expect(ft[0]).toBe(`${fold.left.toLocaleString()} more characters are left out here. c copies the whole reply.`);
  expect(v.height(fold)).toBe(8 + 26 + 18);
  // A short reply: nothing after it but the stats.
  const short = keys.at(-1);
  v.toggle(short, cx);
  expect(reply(v.findTurn(short)).length).toBeLessThan(1600);
  expect(v.rows().some((r) => r.kind === "fold" && r.key === `fold:${short}`)).toBe(false);
  draw(v, cx);
});
test("an Amp terminal: Amp isn't supported, why in one line, and a button to the README section", async () => {
  const { UNREAD } = await import("../mods/agent-threads/harness.js");
  hcOut = JSON.stringify({ foreground: { name: "amp", argv: ["amp"], pid: 77 } });
  state = {
    terminals: [{ address: "t4", status: "idle", name: "amp" }],
    panes: [{ pane: "p1", tab: "A", terminal: "t4", program: { key: "amp", name: "Amp", agent: true } }, { pane: "p2", tab: "A", terminal: null, mod: "agent-threads" }],
    props: { terminal: "t4", debug: true }, shared: {},
  };
  const v = new Threads();
  const cx = makeCx();
  v.init(state.props, cx);
  for (let i = 0; i < 200 && v.res?.kind !== "unsupported"; i++) await new Promise((r) => setTimeout(r, 25));
  hcOut = JSON.stringify({ foreground: { name: "claude", argv: ["claude"], pid: 42 } });
  expect(v.res).toMatchObject({ kind: "unsupported", name: "Amp", key: "amp" });
  expect(v.headerText()).toBe("Not readable");
  rec = []; v.body(theme, true, cx); const drawn = rec; rec = null;
  const strings = drawn.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
  expect(strings).toEqual(expect.arrayContaining(["Amp isn't supported", UNREAD.amp.why, "Why Amp isn't supported"]));
  // Amp is not offered among the agents Threads reads.
  expect(strings.join(" ")).not.toMatch(/reads .*Amp/);
  // The button opens the README section, and does nothing else.
  const at = drawn.findIndex((e) => e[0] === "id" && e[1] === "th-why-unread");
  const click = drawn.slice(at).find((e) => e[0] === "on_click")[1];
  log = [];
  click({}, cx);
  await new Promise((r) => setTimeout(r, 10));
  expect(log).toEqual([["open", "https://github.com/ryanrozich/herdr-agent-threads#why-amp-isnt-supported"]]);
  expect(UNREAD.amp.url).toMatch(/#why-amp-isnt-supported$/);
});

// The calls after an element's id, up to the next id, so a test can find its click handler
// or a size set on it.
function afterId(calls, id) {
  const i = calls.findIndex((e) => e[0] === "id" && e[1] === id);
  if (i < 0) return null;
  const j = calls.findIndex((e, k) => k > i && e[0] === "id");
  return calls.slice(i + 1, j < 0 ? undefined : j);
}
const VIEW_TURN = {
  n: 4, agent: false, who: "User", when: "9:25 AM · 58s", running: false, asOf: "9:30 AM", cmd: null,
  prompt: "[Image #41] [Image #42] The chips wrap on tablet.\nSee [Image #43] for the phone.", promptCut: 0,
  caption: [["wrench", "3 tool calls (not shown)"]],
  md: "The chips had a fixed width.\n\n- tablet scrolls\n- desktop stays\n\nCosts $5 to $9 a month.", copy: "The chips had a fixed width. (source)", left: 0,
  stats: "58s · 7.9k tokens · opus 5.5 · 3 tool calls", size: 14, fill: "#47648F", outline: false, ink: "#ffffff", sub: "#dce3ee",
};
function viewer(over = {}) {
  state = { terminals: [], panes: [], shared: {}, props: { overlay: "ov7", gallery: { title: "#4", at: 1, panel: true, turn: VIEW_TURN, images: [
    { path: "data/agent-threads/images/f/a-0.png", w: 2000, h: 1247, n: 41 },
    { path: "data/agent-threads/images/f/a-1.png", w: 300, h: 600, n: 42 },
    { path: "data/agent-threads/images/f/a-2.png", w: 0, h: 0, n: 43 },
  ], ...over } } };
  const g = new Threads();
  const cx = makeCx();
  g.init(state.props, cx);
  const calls = () => { rec = []; g.render(cx); const r = rec; rec = null; return r; };
  const text = () => calls().filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]).join(" | ");
  return { g, cx, calls, text, size: (width, height) => handlerAfterId(calls(), "th-gallery", "on_size_change")({ width, height }, cx) };
}

test("the image gallery: every image of the message full window, Left and Right step and wrap, Esc closes", async () => {
  const { g, cx, text, size } = viewer({ panel: false });
  // Not the launcher, and nothing of the pane starts (no reads, no commands).
  expect(g.launcher).toBeFalsy();
  expect(g.gal.i).toBe(1);
  size(1600, 1000);
  expect(text()).toContain("#4 · Image 2 of 3 · [Image #42] · 300×600");
  g.galleryKey(keyEv("right"), cx);
  expect(text()).toContain("Image 3 of 3 · [Image #43]");
  g.galleryKey(keyEv("right"), cx);
  expect(g.gal.i).toBe(0);
  g.galleryKey(keyEv("left"), cx);
  expect(g.gal.i).toBe(2);
  // With the panel hidden j, k and Space step as before.
  g.galleryKey(keyEv("j"), cx);
  expect(g.gal.i).toBe(0);
  g.galleryKey(keyEv("k"), cx);
  expect(g.gal.i).toBe(2);
  g.galleryKey(keyEv("escape"), cx);
  expect(closed).toContain("ov7");
  expect(() => g.close()).not.toThrow();
});

test("the image viewer shows the turn's prompt and reply beside the image, 500 px wide, and under it when narrow", () => {
  const { g, calls, text, size } = viewer();
  size(1600, 1000);
  let c = calls();
  // Beside the image: the panel is 500 px wide with a hairline on its left.
  expect(afterId(c, "th-gallery-panel")).toContainEqual(["w", 500]);
  expect(afterId(c, "th-gallery-panel")).toContainEqual(["border_l", 1]);
  const t = text();
  // The head, the caption, the stats and Copy reply; the Reply button is on the top line.
  expect(t).toContain("#4 | · | User | 9:25 AM · 58s");
  expect(t).toContain("3 tool calls (not shown)");
  expect(t).toContain("58s · 7.9k tokens · opus 5.5 · 3 tool calls");
  expect(t).toContain("Copy reply");
  expect(t).toContain("Reply");
  expect(t).not.toContain("Left and Right step through");
  // The reply as Markdown, a block per paragraph, dollar signs escaped as in the open card.
  const md = views.filter((x) => x.id.startsWith("th-gallery-md-")).slice(-3).map((x) => x.md);
  expect(md).toEqual(["The chips had a fixed width.", "- tablet scrolls\n- desktop stays", "Costs \\$5 to \\$9 a month."]);
  // Each label in the bubble is its own piece, the one on screen marked.
  const tag = (k) => afterId(c, k) ?? [];
  expect(tag("th-gallery-tag-0-2")).toContainEqual(["child", "[Image #42]"]);
  expect(tag("th-gallery-tag-0-2").some((e) => e[0] === "border_1")).toBe(true);
  expect(tag("th-gallery-tag-0-0").some((e) => e[0] === "border_1")).toBe(false);
  expect(tag("th-gallery-tag-1-1")).toContainEqual(["child", "[Image #43]"]);
  // A thumbnail per image under it, the one on screen ringed.
  for (const j of [0, 1, 2]) expect(afterId(c, `th-gallery-thumb-${j}`)).not.toBe(null);
  // Narrow: the panel docks under the image, 300 px tall, its text at most 560 px wide.
  size(900, 800);
  c = calls();
  expect(afterId(c, "th-gallery-panel")).toContainEqual(["h", 300]);
  expect(afterId(c, "th-gallery-panel")).toContainEqual(["border_t", 1]);
  expect(c).toContainEqual(["pl", 170]);
  expect(g.gal.panel).toBe(true);
});

test("the image viewer: a label or a thumbnail goes to its image, 1 to 9 jump, j and k scroll the reply a block, c copies, i hides and is kept", async () => {
  settingsWrites.length = 0;
  const { g, cx, calls, text, size } = viewer();
  size(1600, 1000);
  const click = (id) => afterId(calls(), id).find((e) => e[0] === "on_click").at(-1)({}, cx);
  click("th-gallery-tag-1-1");
  expect(g.gal.i).toBe(2);
  click("th-gallery-tag-0-0");
  expect(g.gal.i).toBe(0);
  click("th-gallery-thumb-1");
  expect(g.gal.i).toBe(1);
  g.galleryKey(keyEv("3"), cx);
  expect(g.gal.i).toBe(2);
  g.galleryKey(keyEv("9"), cx); // no ninth image
  expect(g.gal.i).toBe(2);
  g.galleryKey(keyEv("home"), cx);
  expect(g.gal.i).toBe(0);
  g.galleryKey(keyEv("end"), cx);
  expect(g.gal.i).toBe(2);
  // j: the message, the caption, three reply blocks and the stats are the panel's six
  // children. Down goes to the end, then back up to the next part, so it lands at the top.
  const h = g.galScroll;
  // The scroll area's own children are the six parts j and k count.
  // (Its children are built first, so its own .children call is the last before the footer.)
  const all = calls();
  const foot = all.findIndex((e) => e[0] === "id" && e[1] === "th-gallery-copy");
  const own = all.slice(all.findIndex((e) => e[0] === "id" && e[1] === "th-gallery-scroll"), foot).filter((e) => e[0] === "children").at(-1);
  expect(own[1]).toHaveLength(g.galleryParts());
  expect(g.galleryParts()).toBe(6);
  g.galleryKey(keyEv("j"), cx);
  expect(g.gal.i).toBe(2); // the image stays
  expect(h.asked).toEqual([5]);
  cx.flush(100);
  expect(h.asked).toEqual([5, 1]);
  g.galleryKey(keyEv("space"), cx);
  cx.flush(100);
  expect(h.asked.slice(-1)).toEqual([2]);
  g.galleryKey(keyEv("k"), cx);
  expect(h.asked.slice(-1)).toEqual([1]);
  // Stepping images leaves the reply where it is.
  g.galleryKey(keyEv("right"), cx);
  expect(g.gal.top).toBe(1);
  // c copies the reply's Markdown source, and the button says so for a moment.
  g.galleryKey(keyEv("c"), cx);
  expect(cx.clip).toBe(VIEW_TURN.copy);
  expect(text()).toContain("Copied");
  cx.flush(2000);
  expect(text()).toContain("Copy reply");
  // i hides the panel and writes the choice for the next viewer; i shows it again.
  g.galleryKey(keyEv("i"), cx);
  expect(g.gal.panel).toBe(false);
  expect(afterId(calls(), "th-gallery-panel")).toBe(null);
  await cx.pending.at(-1);
  expect(JSON.parse(settingsWrites.at(-1)).viewerReply).toBe(false);
  g.galleryKey(keyEv("i"), cx);
  await cx.pending.at(-1);
  expect(g.gal.panel).toBe(true);
  expect(JSON.parse(settingsWrites.at(-1)).viewerReply).toBe(true);
  // The Reply button on the top line does the same.
  click("th-gallery-reply");
  expect(g.gal.panel).toBe(false);
  // The mod commands.
  g.galleryAct("panel", cx);
  expect(g.gal.panel).toBe(true);
});

// From the review: j and k kept a count of their own, so after a wheel scroll they moved the
// reply the wrong way, and held at the end they did nothing on the way back. Now the panel
// measures its parts and the view, follows the wheel, and goes by replyScroll's places.
test("the image viewer: j and k go by the measured parts and follow the wheel; the strip starts at the left; a quick i i saves the last state; a long prompt says how many lines are left out", async () => {
  settingsWrites.length = 0;
  const { g, cx, calls, text, size } = viewer();
  size(1600, 1000);
  const all = calls();
  const after = (id, name) => {
    const i = all.findIndex((e) => e[0] === "id" && e[1] === id);
    for (let j = i + 1; j < all.length && all[j][0] !== "id"; j++) if (all[j][0] === name) return all[j].at(-1);
    return null;
  };
  // Six parts of 100, 30, 300, 300, 300 and 20 px in a 400 px view: they start at 4, 104,
  // 134, 434, 734 and 1034, and the view can go down to 674.
  [100, 30, 300, 300, 300, 20].forEach((height, k) => after(`th-gallery-part-${k}`, "on_size_change")({ width: 400, height }, cx));
  after("th-gallery-scroll", "on_size_change")({ width: 400, height: 400 }, cx);
  const h = g.galScroll;
  const press = (k) => { h.asked.length = 0; g.galleryKey(keyEv(k), cx); cx.flush(200); return [...h.asked]; };
  // Down to the caption: by way of the first part that reaches past it (not the end), then back.
  expect(press("j")).toEqual([3, 1]);
  expect(g.gal.y).toBe(104);
  expect(press("j")).toEqual([3, 2]);
  expect(press("j")).toEqual([4, 3]);
  // Then the end, and nothing further: j at the end does not run on.
  expect(press("j")).toEqual([5]);
  expect(press("j")).toEqual([]);
  // k comes straight back a part at a time.
  expect(press("k")).toEqual([3]);
  expect(g.gal.y).toBe(434);
  // The wheel: 200 px down, then k goes to the start of the part on screen, not the one above.
  // Over a part, the part's listener and then the area's see the same event: it counts once.
  const ev = { delta: { x: 0, y: -200 }, position: { x: 900, y: 400 }, touch_phase: "moved" };
  after("th-gallery-part-3", "on_scroll_wheel")(ev, cx);
  after("th-gallery-scroll", "on_scroll_wheel")({ ...ev }, cx);
  expect(g.gal.y).toBe(634);
  expect(press("k")).toEqual([3]);
  // Back to the top by wheel: j goes to the caption again, not further down.
  after("th-gallery-scroll", "on_scroll_wheel")({ delta: { x: 0, y: 5000 } }, cx);
  expect(g.gal.y).toBe(0);
  expect(press("j")).toEqual([3, 1]);
  // The second step waits for a frame drawn after the first.
  h.asked.length = 0;
  g.galleryKey(keyEv("j"), cx);
  const drawn = g.gal.paints;
  cx.flush(40, 3); // three waits of 30 ms with no frame drawn: still waiting
  expect(h.asked).toEqual([3]);
  calls();
  expect(g.gal.paints).toBe(drawn + 1);
  cx.flush(40);
  expect(h.asked).toEqual([3, 2]);
  // The strip: centred by an auto margin inside the scroll area, so an overflow starts at the left.
  const strip = all.findIndex((e) => e[0] === "id" && e[1] === "th-gallery-strip");
  expect(all.slice(strip, strip + 10).some((e) => e[0] === "justify_center")).toBe(false);
  expect(all.some((e) => e[0] === "mx_auto")).toBe(true);
  // i twice before either save lands: both saves write the state the panel ends in.
  g.galleryKey(keyEv("i"), cx);
  g.galleryKey(keyEv("i"), cx);
  await Promise.all(cx.pending.slice(-2));
  expect(g.gal.panel).toBe(true);
  expect(settingsWrites.length).toBeGreaterThan(0);
  expect(settingsWrites.every((w) => JSON.parse(w).viewerReply === true)).toBe(true);
  // A prompt of 450 lines shows 400 and says how many are left out.
  const long = viewer({ turn: { ...VIEW_TURN, prompt: Array.from({ length: 450 }, (_, i) => `line ${i + 1}`).join("\n") } });
  long.size(1600, 1000);
  expect(long.text()).toContain("50 more lines not shown");
  expect(text()).not.toContain("more lines not shown");
});

// From the side by side with the mock: a code block in the reply has the open turn's head
// (language and Copy) and a highlighting editor, not plain Markdown.
test("the image viewer: a fenced code block in the reply gets the language, a Copy button and a highlighting editor", () => {
  editors.length = 0;
  const md = "The fix:\n\n```css\n.filters { display: flex; }\n```\n\nDone.";
  const { g, cx, calls, text, size } = viewer({ turn: { ...VIEW_TURN, md } });
  size(1600, 1000);
  expect(g.gal.blocks).toHaveLength(3);
  expect(g.gal.code.map((c) => c?.lang ?? null)).toEqual([null, "css", null]);
  expect(editors.at(-1).opts.value).toBe(".filters { display: flex; }");
  expect(editors.at(-1).opts.readonly).toBe(true);
  const all = calls();
  // Only the prose blocks go to Markdown views.
  expect(all.filter((e) => e[0] === "TextView" && String(e[1]).startsWith("th-gallery-md-")).map((e) => e[1])).toEqual(["th-gallery-md-0", "th-gallery-md-2"]);
  expect(text()).toContain("css");
  afterId(all, "th-gallery-code-copy-1").find((e) => e[0] === "on_click").at(-1)({}, cx);
  expect(cx.clip).toBe(".filters { display: flex; }");
  expect(text()).toContain("Copied");
  cx.flush(2000);
  expect(text()).not.toContain("Copied");
  // Still one scroll part per block, so j and k count it.
  expect(g.galleryParts()).toBe(6);
});

test("the image viewer opens with the panel as settings.json last left it, and a running turn says its reply is as of the open", () => {
  const off = viewer({ panel: false });
  off.size(1600, 1000);
  expect(afterId(off.calls(), "th-gallery-panel")).toBe(null);
  const run = viewer({ turn: { ...VIEW_TURN, running: true, md: "", copy: "" } });
  run.size(1600, 1000);
  const t = run.text();
  expect(t).toContain("Still running · the reply as of 9:30 AM");
  expect(t).toContain("No reply yet.");
  // Nothing to copy: c does nothing.
  run.g.galleryKey(keyEv("c"), run.cx);
  expect(run.cx.clip).toBe(null);
  // Herdr before 0.1.15 has no ScrollHandle: the reply scrolls with the wheel, and j, k and
  // Space step the images as before.
  const old = viewer();
  old.g.galScroll = null;
  old.size(1600, 1000);
  expect(old.text()).toContain("i hides the reply");
  old.g.galleryKey(keyEv("j"), old.cx);
  expect(old.g.gal.i).toBe(2);
  old.g.galleryAct("down", old.cx);
  expect(old.g.gal.i).toBe(0);
  // No turn (an older pane's props): no panel and no Reply button, as before.
  const none = viewer({ turn: undefined, panel: true });
  none.size(1600, 1000);
  expect(none.g.gal.panel).toBe(false);
  expect(afterId(none.calls(), "th-gallery-reply")).toBe(null);
});

test("the list's day pill floats over the top while scrolling and goes 1.5 s after; the Pinned view keeps its strip", async () => {
  const { v, cx } = await pane(fixture("--extra", "6", "--gap", "43200"));
  v.width = 545;
  draw(v, cx);
  const rows = v.rows();
  expect(rows.some((r) => r.kind === "day")).toBe(true);
  const idsOf = (calls) => calls.filter((e) => e[0] === "id").map((e) => e[1]);
  rec = []; draw(v, cx); let calls = rec; rec = null;
  // No strip above the list: the list's box is the first thing under the root.
  expect(idsOf(calls)).not.toContain("th-day-strip");
  // Scrolled into a day: the pill shows only while the person scrolls.
  const inDay = rows.find((r, i) => i > 0 && rows[i - 1].kind !== "day" && r.kind !== "day" && rows[i + 1]?.kind !== "day" && rows.slice(0, i).some((x) => x.kind === "day"));
  v.topKey = inDay.key;
  expect(v.stickyDay()).not.toBe(null);
  rec = []; draw(v, cx); calls = rec; rec = null;
  expect(idsOf(calls)).not.toContain("th-sticky-day");
  v.topKey = inDay.key;
  v.listWheel({ delta: { y: 40 } });
  expect(v.dayPillShown()).toBe(true);
  // (The stub list draws every item, which moves topKey to the first; the pane reads the day
  // before the list draws.)
  v.topKey = inDay.key;
  rec = []; draw(v, cx); calls = rec; rec = null;
  const ids = idsOf(calls);
  // In the floating top, drawn after the list's box, so it sits over the list.
  expect(ids.indexOf("th-sticky-day")).toBeGreaterThan(ids.indexOf("threads-listbox"));
  expect(ids.indexOf("th-float")).toBeGreaterThan(ids.indexOf("threads-listbox"));
  // 1.5 s after the last scroll the timer takes it away.
  v.scrollSeenAt = Date.now() - 1600;
  expect(v.dayPillShown()).toBe(false);
  // The Pinned view keeps the strip of its own above the list.
  v.view = "pinned";
  expect(v.floating()).toBe(false);
});

// ---- design-review picks (2026-11-11) -----------------------------------------------------

test("a pinned turn shows its pin number at the end of its line, as in the Pinned view", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  const k = keys();
  for (const i of [3, 1]) { v.sel = k[i]; v.action("pin", cx); }
  v.width = 545;
  const texts = (r) => { rec = []; v.item(theme, r, true, 200); const c = rec; rec = null; return c.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]); };
  const row = (key) => v.rows().find((r) => r.key === key && r.kind === "turn");
  // Pinned 3 then 1: numbered oldest first, so the list shows 1 and 2 beside the pin, like the column.
  expect(v.pinNumber(row(k[1]).turn)).toBe(1);
  expect(texts(row(k[1]))).toContain("1");
  expect(texts(row(k[3]))).toContain("2");
  expect(v.pinNumber(row(k[0]).turn)).toBe(null);
  expect(texts(row(k[0]))).not.toContain("1");
  // The open turn's line carries it too, and unpinning drops it.
  v.toggle(k[1], cx);
  const line = v.rows().find((r) => r.kind === "rhead" && r.key === `rhead:${k[1]}`);
  rec = []; v.partContent(theme, line, false); const hs = rec.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]); rec = null;
  expect(hs).toContain("1");
  expect(v.lineText(line.turn)).toContain("[pin 1]");
  // Unpinning the first renumbers the other.
  v.sel = k[1]; v.action("pin", cx);
  expect(v.pinNumber(v.findTurn(k[3]))).toBe(1);
  expect(v.pinNumber(v.findTurn(k[1]))).toBe(null);
  draw(v, cx);
});

test("the first-run notice and the unsupported note name every agent Threads reads, Antigravity included", async () => {
  const g = new Threads();
  const cx = makeCx();
  state = { terminals: [], panes: [{ pane: "p9", tab: "A", terminal: null }], props: { overlay: "ov9" }, shared: {} };
  focusNow = { pane: "p9" };
  log = [];
  g.init(state.props, cx);
  cx.flush(10);
  const n = log.find((x) => x[0] === "notify")?.[1];
  expect(n.body).toBe("Focus a Claude Code, Codex, OpenCode, Pi, Cursor or Antigravity terminal first, then open Threads beside it.");
  const src = readFileSync(join(modDir, "main.js"), "utf8");
  expect(src).toContain("Threads reads ${AGENT_NAMES.replace(");
  expect("Claude Code, Codex, OpenCode, Pi, Cursor or Antigravity".replace(/ or ([^ ]+)$/, " and $1")).toBe("Claude Code, Codex, OpenCode, Pi, Cursor and Antigravity");
});

test("the header shows the agent's state beside the badge: Working, Needs you, Done or Exited, and nothing it cannot know", async () => {
  // The header is drawn in the Pinned view; the list's floating top has a test of its own.
  const { HARNESS } = await import("../mods/agent-threads/harness.js");
  const { v, cx } = await pane(fixture("--only", "3"));
  v.width = 545;
  const word = () => v.agentStateNow()?.word ?? null;
  const ids = () => { rec = []; v.header(theme); const c = rec; rec = null; return c.filter((e) => e[0] === "id").map((e) => e[1]); };
  const strs = () => { rec = []; v.header(theme); const c = rec; rec = null; return c.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]); };
  // Claude Code reports its status to Herdr.
  expect(v.current().turns.at(-1).done).toBe(true);
  state.terminals[0].status = "idle";
  expect(word()).toBe("Done");
  expect(strs()).toContain("Done");
  expect(ids()).toContain("th-state");
  state.terminals[0].status = "working";
  expect(word()).toBe("Working");
  state.terminals[0].status = "blocked";
  expect(word()).toBe("Needs you");
  expect(v.stateTip(v.agentStateNow())).toBe("Claude is waiting for you in the terminal");
  state.terminals[0].status = "idle";
  // The header text keeps its room: the layout counts the state's width.
  const withState = v.headerLayout().text;
  v.res = { ...v.res, ended: "exited" };
  expect(word()).toBe("Exited");
  v.res = { ...v.res, ended: null };
  // Under 440 px the word goes and a dot sits on the badge's corner; its tooltip says it.
  v.width = 380;
  expect(ids()).not.toContain("th-state");
  expect(ids()).toContain("th-state-dot");
  expect(v.badgeTip()).toMatch(/^Done: Claude finished its newest turn · click to go to the terminal \(t\) · Reading t4/);
  v.width = 545;
  expect(ids()).not.toContain("th-state-dot");
  expect(withState).toBeGreaterThan(100);
  // An agent that reports no status (Codex here): the transcript says only that the newest
  // turn ended. A running turn gets no word, even while Herdr says "working".
  v.agent = () => HARNESS.codex;
  state.terminals[0].status = "working";
  expect(word()).toBe("Done");
  expect(v.stateTip(v.agentStateNow())).toBe("Codex finished its newest turn. Codex reports no live status, so this is read from the transcript.");
  const { apply } = await import("../mods/agent-threads/core/turns.js");
  apply(v.current(), { k: "p", o: "human", t: "One more change", ts: "2026-11-01T10:00:00.000Z" });
  expect(v.current().turns.at(-1).done).toBeFalsy();
  expect(word()).toBe(null);
  expect(ids()).not.toContain("th-state");
  state.terminals[0].status = "blocked";
  expect(word()).toBe(null);
  draw(v, cx);
  expect(JSON.parse(JSON.stringify(state.shared["threads.debug"].t4)).state).toBe(null);
});

test("a click on the header's state goes to the terminal as t does, and its tooltip says so; under 440 px the badge takes the click", async () => {
  const { v, cx } = await pane(fixture("--only", "3"));
  v.width = 545;
  state.terminals[0].status = "blocked";
  expect(v.agentStateNow().word).toBe("Needs you");
  const head = () => { rec = []; v.header(theme); const c = rec; rec = null; return c; };
  // The handler and tooltip a chain set after .id(id), before the next element's id.
  const after = (calls, id, name) => {
    const at = calls.findIndex((e) => e[0] === "id" && e[1] === id);
    if (at < 0) return null;
    const end = calls.findIndex((e, i) => i > at && e[0] === "id");
    return calls.slice(at, end < 0 ? undefined : end).find((e) => e[0] === name)?.at(-1) ?? null;
  };
  // The tooltip and the click are set before the chip's children, so look between its id and its dot.
  const chip = (calls, name) => {
    const at = calls.findIndex((e) => e[0] === "id" && e[1] === "th-state");
    return calls.slice(at, at + 14).find((e) => e[0] === name)?.at(-1) ?? null;
  };
  let h = head();
  expect(chip(h, "tooltip")).toBe("Claude is waiting for you in the terminal · click to go to the terminal (t)");
  expect(h.slice(h.findIndex((e) => e[0] === "id" && e[1] === "th-state")).slice(0, 14).some((e) => e[0] === "cursor_pointer")).toBe(true);
  const click = chip(h, "on_click");
  expect(typeof click).toBe("function");
  log = [];
  v.lastFocus = null;
  click({}, cx);
  expect(log.filter((e) => e[1] === "pane.focus")).toEqual([["run", "pane.focus", { pane: "p1" }]]);
  expect(v.toast.text).toBe("Focused t4 · Claude Code");
  draw(v, cx);
  expect(state.shared["threads.debug"].t4.lastFocus.args).toEqual({ pane: "p1" });
  // The same call as the t key.
  const byClick = { ...v.lastFocus, at: 0 };
  v.key(keyEv("t"), cx);
  expect({ ...v.lastFocus, at: 0 }).toEqual(byClick);
  // Under 440 px the dot sits on the badge's corner; the badge takes the click and says so.
  v.width = 380;
  h = head();
  expect(h.some((e) => e[0] === "id" && e[1] === "th-state")).toBe(false);
  expect(h.some((e) => e[0] === "id" && e[1] === "th-state-dot")).toBe(true);
  expect(v.badgeTip()).toMatch(/^Needs you: Claude is waiting for you in the terminal · click to go to the terminal \(t\) · Reading t4/);
  const badgeClick = after(h, "th-badge", "on_click");
  expect(typeof badgeClick).toBe("function");
  log = [];
  badgeClick({}, cx);
  expect(log.filter((e) => e[1] === "pane.focus")).toEqual([["run", "pane.focus", { pane: "p1" }]]);
  // With no state to show, the badge is only its tooltip.
  v.agentStateNow = () => null;
  expect(after(head(), "th-badge", "on_click")).toBe(null);
  expect(v.badgeTip()).not.toContain("click to go to the terminal");
});

test("the list's header has no pin button, so the session's title gets its room; a Pinned view keeps it", async () => {
  const { headerButtonWidth } = await import("../mods/agent-threads/ui.js");
  const { v, cx, keys } = await pinPane("--extra", "6", "--agents");
  v.sel = keys()[0];
  v.action("pin", cx);
  for (const width of [260, 300, 380, 440, 545, 640]) {
    v.width = width;
    expect(v.headerButtons().map((b) => b[0])).not.toContain("th-pin");
    rec = []; v.header(theme); const h = rec; rec = null;
    expect(h.some((e) => e[0] === "id" && e[1] === "th-pin")).toBe(false);
    draw(v, cx);
    expect(state.shared["threads.debug"].t4.headerButtons.some((b) => b.startsWith("th-pin|") || b.startsWith("th-pin:"))).toBe(false);
  }
  // The text's room: the pane less its padding, the badge (and state) and the buttons, with
  // no 24 px pin button and its 8 px gap among them.
  expect(headerButtonWidth(null) + 8).toBe(32);
  const room = () => {
    const L = v.headerLayout();
    return L.width - 20 - (L.badge + 8) - v.headerButtons().reduce((sum, b) => sum + headerButtonWidth(b[6]) + 8, 0);
  };
  const texts = {};
  for (const width of [380, 545]) {
    v.width = width;
    expect(v.headerLayout().text).toBe(room());
    texts[width] = v.headerLayout().text;
  }
  // Before, with the pin button: 119 at 380 px and 162 at 545 (where the state chip, now
  // 10 px wider for its hover fill, takes 10 of the 32 back). At 545 px the Jump to latest
  // button, now a pill below the list, gives its 24 px and 8 px gap to the text too.
  expect(texts).toEqual({ 380: 119 + 32, 545: 162 + 22 + 32 });
  // In a Pinned view every row is a pin, and a closed one has no pin of its own to click,
  // so the header keeps its pin button there, as Unpin for the selected pin.
  v.width = 380;
  v.setView("pinned");
  expect(v.headerButtons().find((b) => b[0] === "th-pin")?.[2]).toMatch(/^Unpin #\d+ \(p\)$/);
  v.setView("all");
});

// A transcript cut before its third prompt, and the rest, to append as a live session would.
function grownFixture() {
  const file = fixture("--only", "3");
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const prompts = lines.map((l, i) => [JSON.parse(l), i]).filter(([j]) => j.type === "user" && !j.isMeta && (typeof j.message?.content === "string" || j.message?.content?.some?.((c) => c.type === "text"))).map(([, i]) => i);
  const cut = prompts[2];
  writeFileSync(file, `${lines.slice(0, cut).join("\n")}\n`);
  return { file, rest: `${lines.slice(cut).join("\n")}\n` };
}

// The list as gpui draws it with only the rows from start to end on screen.
function drawRange(v, start, end) {
  const rows = v.rows();
  v.listItems(theme, rows, v.slotsMemo ?? rows.map(() => 40), { start, end: end ?? rows.length }, true, false);
}

test("mdParts keeps the texts used last: a long reply on screen is not split again while the probe walks hundreds of others", async () => {
  const { v } = await pane(fixture());
  const big = `${"| a | b |\n|---|---|\n"}${"| one | two |\n".repeat(400)}`;
  const first = v.mdParts(big);
  for (let i = 0; i < 1000; i++) {
    v.mdParts(`text ${i}`);
    if (i % 100 === 0) expect(v.mdParts(big)).toBe(first);
  }
  expect(v.mdParts(big)).toBe(first);
  expect(v.mdMemo.size).toBeLessThanOrEqual(400);
  expect(v.mdMemo.has("text 0")).toBe(false);
});

test("a row Herdr stopped while it drew is drawn as plain text, blank if that is stopped too, and in full again after the wait", async () => {
  const { v } = await pane(fixture("--extra", "2"));
  const rows = v.rows();
  const i = rows.findIndex((r) => r.kind === "turn" && r.shape?.md);
  const r = rows[i];
  expect(i).toBeGreaterThanOrEqual(0);
  const views0 = () => views.filter((x) => String(x.id).includes(r.key)).length;
  let drawn = 0;
  const item = v.item.bind(v);
  v.item = (t, x, ...rest) => { if (x.key === r.key) drawn++; return item(t, x, ...rest); };
  // Drawn in full: its reply is a TextView, and no draw is left open.
  let n = views0();
  drawRange(v, i, i + 1);
  expect(views0()).toBeGreaterThan(n);
  expect(v.drawingRow).toBe(null);
  // Herdr stopped its draw (the mark is still set when the list draws next): plain text.
  v.drawingRow = { key: r.key, lite: false };
  n = views0();
  drawRange(v, i, i + 1);
  expect(v.cutRows.get(r.key)).toMatchObject({ n: 1, blank: false });
  expect(views0()).toBe(n);
  expect(drawn).toBe(2);
  // Herdr's list asks only for its first row after a stopped draw, so the list gets a new id.
  expect(v.listGen).toBe(1);
  // Stopped again while plain, found by the next render: blank, not drawn at all.
  v.drawingRow = { key: r.key, lite: true };
  v.render(makeCx());
  expect(v.drawingRow).toBe(null);
  expect(v.listGen).toBe(2);
  drawn = 0;
  drawRange(v, i, i + 1);
  expect(v.cutRows.get(r.key)).toMatchObject({ n: 2, blank: true });
  expect(v.cutRows.get(r.key).until - performance.now()).toBeGreaterThan(9000);
  expect(drawn).toBe(0);
  // After the wait it is drawn in full again.
  v.cutRows.get(r.key).until = 0;
  n = views0();
  drawRange(v, i, i + 1);
  expect(drawn).toBe(1);
  expect(views0()).toBeGreaterThan(n);
});

test("a render Herdr stopped is followed by frames that neither reshape nor measure, then by full ones; an error is not taken for a stop", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  let probes = 0;
  const probeDue = v.probeDue.bind(v);
  v.probeDue = () => { probes++; return probeDue(); };
  v.render(cx);
  expect(v.renderOpen).toBe(false);
  expect(probes).toBe(1);
  v.renderOpen = true;
  v.render(cx);
  expect(v.light).toBe(true);
  expect(v.shapeMax()).toBe(-1);
  expect(probes).toBe(1);
  expect(v.renderCuts).toBe(1);
  expect(state.shared["threads.cuts"]).toMatchObject({ renders: 1, rows: 0 });
  v.cutUntil = 0;
  v.render(cx);
  expect(v.light).toBe(false);
  expect(probes).toBe(2);
  v.frame = () => { throw new Error("broken"); };
  expect(() => v.render(cx)).toThrow("broken");
  expect(v.renderOpen).toBe(false);
});

test("a render Herdr stopped is asked for again, and counted even when the next one is stopped too", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  let notes = 0;
  cx.notifyHook = () => { notes++; };
  // The watch is the 120 ms timer set up with the pane, not a timer asked for in a render,
  // which may never run when Herdr stops that render.
  const tick = cx.everies.find((x) => x.ms === 120);
  cx.timers = [];
  v.render(cx);
  expect(cx.timers.some((x) => x.ms === 1500 || x.ms === 250)).toBe(false);
  // Finished: the watch asks for nothing (the same timer redraws for the sticky day).
  v.stickyDue = false;
  v.scrollSeenAt = 0;
  notes = 0;
  tick.fn(cx);
  expect(notes).toBe(0);
  // Stopped (renderOpen left set): the watch asks for the next render once 250 ms have
  // gone, and then no more than once each 250 ms.
  v.render(cx);
  v.renderOpen = true;
  v.stickyDue = false;
  v.scrollSeenAt = 0;
  notes = 0;
  tick.fn(cx);
  expect(notes).toBe(0);
  v.renderAt -= 300;
  tick.fn(cx);
  tick.fn(cx);
  expect(notes).toBe(1);
  v.cutPokeAt -= 300;
  tick.fn(cx);
  expect(notes).toBe(2);
  // The next render fails before the end of its frame: the stop is published all the same.
  const frame = v.frame;
  v.frame = () => { throw new Error("interrupted"); };
  expect(() => v.render(cx)).toThrow("interrupted");
  expect(state.shared["threads.cuts"]).toMatchObject({ renders: 1 });
  v.frame = frame;
});

test("one reshaping budget a draw, and less of it when the rest of the draw is slow", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  v.render(cx);
  // A quick draw leaves the whole budget for reshaping and for a slice of a rows build; a
  // slow one splits what is left of 30 ms between them, each down to its floor.
  v.frameBase = 5;
  expect([v.shapeMax(), v.buildMax()]).toEqual([12, 10]);
  v.frameBase = 20;
  expect([v.shapeMax(), v.buildMax()]).toEqual([5, 5]);
  v.frameBase = 34;
  expect([v.shapeMax(), v.buildMax()]).toEqual([2, 3]);
  // Inside a draw, a second ask for the rows keeps what the first spent.
  v.renderOpen = true;
  v.shapeFrame = v.renders;
  v.shapeSpent = 9;
  v.shapeStart();
  expect(v.shapeSpent).toBe(9);
  // Outside a draw (a test asking for rows), each ask starts it again.
  v.renderOpen = false;
  v.shapeStart();
  expect(v.shapeSpent).toBe(0);
  // A finished draw records its cost apart from reshaping.
  v.frameBase = null;
  v.render(cx);
  expect(v.frameBase).toBeGreaterThanOrEqual(0);
});

test("a scroll to a place waits for the rows to settle, but not for more than 2 s", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  v.render(cx);
  const keys = v.turnKeys(v.rows());
  const calls = [];
  v.scroll = { scroll_to_bottom() {}, scroll_to_item(i, how) { calls.push([i, how]); } };
  Object.defineProperty(v, "shapeLeft", { get: () => 5, set() {}, configurable: true });
  v.scrollTo = { key: keys[0], how: "top" };
  cx.timers = [];
  v.render(cx);
  expect(v.scrollTo).not.toBe(null);
  v.scrollWait = Date.now() - 2100;
  v.render(cx);
  expect(v.scrollTo).toBe(null);
  cx.flush(20);
  expect(calls.length).toBeGreaterThan(0);
});

test("the jump to the newest turn that a stopped render took on is asked for again", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  v.render(cx);
  // The stopped render consumed toBottom before Herdr threw its frame away.
  v.toBottom = true;
  v.renderWant = { toBottom: true, scrollTo: null };
  v.toBottom = false;
  v.renderOpen = true;
  let asked = null;
  const frame = v.frame.bind(v);
  v.frame = (c, light) => { asked = v.toBottom; return frame(c, light); };
  v.render(cx);
  expect(asked).toBe(true);
});

// A long session over three days: prompts, replies, each turn done.
async function longSession(n) {
  const ev = [];
  for (let i = 0; i < n; i++) {
    const ts = new Date(Date.UTC(2026, 10, 1 + Math.floor((i * 3) / n), 8, 0) + (i % Math.ceil(n / 3)) * 60000).toISOString();
    ev.push({ k: "p", o: "human", t: `Prompt ${i}: check the cart total for order ${i}.`, ts }, { k: "t", t: `Reply ${i}: the totals round per line, so the cart is off by a cent.` }, { k: "d", ts });
  }
  return scripted(ev);
}
test("rows left unshaped by stopped renders: past the draw's time the rest are not looked at, and the newest come first when following", async () => {
  const { v, cx } = await longSession(450);
  v.debug = false;
  v.width = 545;
  settleRows(v, cx);
  const s = v.current();
  // As after a load whose renders were all stopped: every row built, none shaped.
  for (const t of s.turns) { t.shapeKey = null; t.shapeMemo = null; t.shapeFast = null; }
  v.staleRows = v.baseRows.map((r, i) => (r.kind === "turn" ? i : -1)).filter((i) => i >= 0);
  const n = v.staleRows.length;
  expect(n).toBeGreaterThan(400);
  v.follow = true;
  // A draw has time for 10 reshapes.
  let calls = 0, done = 0;
  const shape = v.shape;
  v.shape = function (...a) { calls++; return shape.apply(this, a); };
  const reshape = v.reshape;
  v.reshape = function (...a) { done++; const out = reshape.apply(this, a); this.shapeSpent = done >= 10 ? 1e9 : 0; return out; };
  // The draw's time is the counted one above, not the clock: shape() also adds its own
  // elapsed time, which on a slow CI runner could pass the 2 to 12 ms limit by itself.
  v.shapeBudget = 1e6;
  v.shapeSpent = 0;
  done = 0;
  calls = 0;
  v.shapeInView = () => {};
  expect(v.reshapeStale("idle")).toBe(true);
  expect(done).toBe(10);
  expect(calls).toBeLessThan(15);
  expect(v.staleRows.length).toBe(n - 10);
  expect(v.shapeLeft).toBeGreaterThan(0);
  // The ten shaped are the newest ten.
  const shaped = v.baseRows.map((r, i) => (r.kind === "turn" && !r.shape?.blank && r.turn.shapeKey != null ? i : -1)).filter((i) => i >= 0);
  const turnRows = v.baseRows.map((r, i) => (r.kind === "turn" ? i : -1)).filter((i) => i >= 0);
  expect(shaped).toEqual(turnRows.slice(-10));
});

test("the jump to the newest turn goes to the end every frame while the rows settle", async () => {
  const { v, cx } = await longSession(450);
  v.debug = false;
  v.width = 545;
  settleRows(v, cx);
  let bottoms = 0;
  v.scroll = { scroll_to_bottom() { bottoms++; }, scroll_to_item() {} };
  Object.defineProperty(v, "shapeLeft", { get: () => 5, set() {}, configurable: true });
  v.toBottom = true;
  // In the same frame, and for as long as they take.
  v.scrollWait = Date.now() - 60000;
  for (let f = 0; f < 3; f++) draw(v, cx);
  expect(bottoms).toBe(3);
  expect(v.toBottom).toBe(true);
});

const rowSig = (v) => v.baseRows.map((r, i) => `${r.kind}|${r.key}|${r.count ?? ""}|${v.baseSizes[i]}`);
// Drops the queued timers and the marks that say a frame is queued: a timer dropped with its
// mark still set would never be asked for again, and the rows would stop where they are.
function dropTimers(v, cx) { cx.timers = []; v.shapeNext = false; v.buildNext = false; v.probeNext = false; }
// Draws until the rows are built and shaped. Rows left waiting are reshaped in the frame the
// 0 ms timer asks for (reshapeDue), as Herdr runs it: a draw alone never takes them up.
function settleRows(v, cx) { draw(v, cx); for (let k = 0; k < 400 && (v.rowJob || v.staleRows?.length || v.shapeLeft > 0); k++) { cx.flush(0); draw(v, cx); } }

test("a long session's rows are built over several frames, the old rows shown till then, and come out as one build would make them", async () => {
  const { v, cx } = await longSession(450);
  v.debug = false;
  v.width = 545;
  settleRows(v, cx);
  const whole = rowSig(v);
  expect(whole.filter((r) => r.startsWith("day|")).length).toBe(3);
  const realPerf = performance.now.bind(performance);
  let fake = 0;
  // Each reading of the clock moves it 2 ms: a slice is over after a few readings.
  performance.now = () => (fake += 2);
  try {
    v.rowsKey = null;
    v.rowBuild = null;
    const old = v.baseRows;
    draw(v, cx);
    expect(v.rowJob).not.toBe(null);
    expect(v.baseRows).toBe(old);
    let slices = 1;
    for (; slices < 400 && v.rowJob; slices++) draw(v, cx);
    expect(slices).toBeGreaterThan(2);
    expect(v.baseRows).not.toBe(old);
  } finally { performance.now = realPerf; }
  settleRows(v, cx);
  expect(rowSig(v)).toEqual(whole);
});

test("a new turn in a long session rebuilds only from the last mark: the rows match a full build", async () => {
  const { apply } = await import("../mods/agent-threads/core/turns.js");
  const { v, cx, s } = await longSession(450);
  v.debug = false;
  v.width = 545;
  settleRows(v, cx);
  const froms = [];
  const build = v.buildRows.bind(v);
  v.buildRows = (status, from, until) => { froms.push(from?.ti ?? 0); return build(status, from, until); };
  const ts = new Date(Date.UTC(2026, 10, 3, 20, 0)).toISOString();
  apply(s, { k: "p", o: "human", t: "One more prompt about the tax line.", ts });
  apply(s, { k: "t", t: "The tax is now rounded once per cart." });
  apply(s, { k: "d", ts });
  s.version++;
  settleRows(v, cx);
  expect(froms.length).toBeGreaterThan(0);
  expect(froms[0]).toBeGreaterThan(300);
  const kept = rowSig(v);
  expect(kept.at(-1)).toContain("0:451");
  // From nothing: the same rows and heights, day counts included.
  v.rowBuild = null;
  v.rowsKey = null;
  froms.length = 0;
  settleRows(v, cx);
  expect(froms[0]).toBe(0);
  expect(rowSig(v)).toEqual(kept);
});

test("the probe takes the parts nearest the top of the pane first, walking out both ways", async () => {
  const { v, cx } = await longSession(300);
  v.debug = false;
  v.width = 545;
  settleRows(v, cx);
  v.meas = new Map();
  v.probeTries = new Map();
  v.probeQuiet = null;
  const turns = v.baseRows.filter((r) => r.kind === "turn");
  const mid = turns[150];
  v.topKey = mid.key;
  const at = v.baseIndex.get(mid.key);
  const due = v.probeDue();
  expect(due.length).toBe(16);
  expect(v.probeLeft).toBeGreaterThan(0);
  expect(due.every(([r]) => Math.abs(v.baseIndex.get(r.key.replace(/^cmd:/, "")) - at) <= 16)).toBe(true);
  // All measured: nothing due, within a few frames (the walk ends its pass, then one pass
  // finds nothing), and then the next call does not walk the rows again.
  for (const r of v.probeRows) v.meas.set(r.key, { sig: v.partSig(r), h: 20 });
  v.measVer = (v.measVer ?? 0) + 1;
  for (let i = 0; i < 6 && v.probeLeft !== 0; i++) expect(v.probeDue().length).toBe(0);
  expect(v.probeLeft).toBe(0);
  const visit = v.partSig.bind(v);
  let sigs = 0;
  v.partSig = (...a) => { sigs++; return visit(...a); };
  expect(v.probeDue().length).toBe(0);
  expect(sigs).toBe(0);
});

test("the Jump to latest pill floats while the end of the list is off screen, with a dot when a turn came in below", async () => {
  const { appendFileSync } = await import("node:fs");
  const { file, rest } = grownFixture();
  const { v, cx } = await pane(file);
  expect(v.current().turns.length).toBe(2);
  v.width = 380;
  const pillIds = () => { rec = []; v.pillView(theme); const ids = rec.filter((e) => e[0] === "id").map((e) => e[1]); rec = null; return ids; };
  // Reading the first turn, with the old last row still in view (as on the rig): no pill.
  v.sel = v.turnKeys(v.rows())[0];
  v.follow = false;
  drawRange(v, 0);
  expect(v.pillShown()).toBe(false);
  appendFileSync(file, rest);
  v.read(cx);
  await settle(v);
  expect(v.current().turns.length).toBe(3);
  // The next draw decides; the new row is off screen.
  expect(v.unseen).toBe("pending");
  v.stickyDue = false;
  drawRange(v, 0, v.rows().length - 1);
  expect(v.unseen).toBe(true);
  expect(v.stickyDue).toBe(true);
  // The end is off screen: the pill shows, with its dot, and the toast sits above it.
  expect(v.pillShown()).toBe(true);
  expect(pillIds()).toEqual(expect.arrayContaining(["th-latest-pill", "th-latest-pill-dot"]));
  rec = []; v.pillView(theme); const tip = rec.find((e) => e[0] === "tooltip")?.[1]; rec = null;
  expect(tip).toBe("New below · jump to latest (End)");
  // Left to right: the dot, a down arrow, then the label.
  rec = []; v.pillView(theme); const order = rec; rec = null;
  const at = (f) => order.findIndex(f);
  const dotAt = at((e) => e[0] === "id" && e[1] === "th-latest-pill-dot");
  const arrowAt = at((e) => e[0] === "svg" && String(e[1]).endsWith("/arrow-down.svg"));
  const labelAt = at((e) => e[0] === "child" && e[1] === "Jump to latest");
  expect(dotAt).toBeGreaterThan(-1);
  expect(arrowAt).toBeGreaterThan(dotAt);
  expect(labelAt).toBeGreaterThan(arrowAt);
  v.toast = { text: "x", at: 1 };
  rec = []; v.toastView(theme); const tb = rec.find((e) => e[0] === "bottom")?.[1]; rec = null;
  v.prefs = { ...v.prefs, keyHints: true };
  v.footerH = 38;
  rec = []; v.toastView(theme); const tb2 = rec.find((e) => e[0] === "bottom")?.[1]; rec = null;
  expect(tb2).toBe(38 + 6 + 28 + 10);
  expect(tb).toBeGreaterThan(38);
  v.toast = null;
  // Not in the outline or the Pinned view, and never in the header.
  v.outline = true;
  expect(v.pillShown()).toBe(false);
  v.outline = false;
  expect(v.headerButtons().some((b) => b[0] === "th-latest")).toBe(false);
  expect(v.sel).toBe(v.turnKeys(v.rows())[0]); // the selection stays where the reader is
  // A draw that reaches the end of the list clears it, and asks the timer to redraw.
  v.stickyDue = false;
  draw(v, cx);
  expect(v.unseen).toBe(false);
  expect(v.stickyDue).toBe(true);
  expect(v.pillShown()).toBe(false);
  // Off screen again with nothing new: the pill, no dot.
  drawRange(v, 0, v.rows().length - 1);
  expect(v.pillShown()).toBe(true);
  expect(pillIds()).not.toContain("th-latest-pill-dot");
  // End clears it too.
  v.unseen = true;
  v.action("latest", cx);
  expect(v.unseen).toBe(false);
});

test("no dot when the new end of the list draws on screen, or when the list follows the newest turn", async () => {
  const { appendFileSync } = await import("node:fs");
  for (const how of ["bottom", "follow"]) {
    const { file, rest } = grownFixture();
    const { v, cx } = await pane(file);
    v.follow = how === "follow";
    if (how === "bottom") v.sel = v.turnKeys(v.rows())[0];
    appendFileSync(file, rest);
    v.read(cx);
    await settle(v);
    expect(v.current().turns.length).toBe(3);
    v.stickyDue = false;
    draw(v, cx); // every row on screen
    expect(v.unseen).toBe(false); // the dot never showed
    // The rail redraws (its last turn on screen is the new one), not the dot.
    expect(v.railSeen.endsWith(`|${v.turnKeys(v.rows()).at(-1)}`)).toBe(true);
    if (how === "follow") expect(v.sel).toBe(v.turnKeys(v.rows()).at(-1));
  }
  // The reply to the newest turn counts as new too: its turn ends.
  const { v } = await scripted([{ k: "p", o: "human", t: "Fix the cart total", ts: at(0) }]);
  const before = v.newestSig();
  const { apply } = await import("../mods/agent-threads/core/turns.js");
  apply(v.current(), { k: "t", t: "Fixed." });
  apply(v.current(), { k: "d", ms: 900, ts: at(1) });
  v.noteNew(before);
  expect(v.unseen).toBe("pending");
  v.noteNew(v.newestSig());
  expect(v.unseen).toBe("pending"); // nothing new since: unchanged
});

// Stick to the bottom, as a chat does: at the bottom the view stays pinned while a reply
// grows; scrolled up nothing moves; scrolling back down follows again.
function runningFixture() {
  const file = fixture("--only", "3");
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const prompts = lines.map((l, i) => [JSON.parse(l), i]).filter(([j]) => j.type === "user" && !j.isMeta && (typeof j.message?.content === "string" || j.message?.content?.some?.((c) => c.type === "text"))).map(([, i]) => i);
  const cut = prompts[2] + 2; // the third prompt and the start of its reply
  writeFileSync(file, `${lines.slice(0, cut).join("\n")}\n`);
  return { file, rest: `${lines.slice(cut).join("\n")}\n` };
}

// A frame with the person's scroll before it: the same rows, the top row moved.
function scrolled(v, start, end) { drawRange(v, start, end); }
function atBottom(v, cx) {
  draw(v, cx);
  v.toBottom = false;
  v.pinningUntil = 0;
  v.stickStep = null;
  v.upAt = 0;
  v.downAt = 0;
}

test("stick to the bottom: at the bottom a growing reply keeps the view pinned to the end", async () => {
  const { appendFileSync } = await import("node:fs");
  const { file, rest } = runningFixture();
  const { v, cx } = await pane(file);
  expect(v.current().turns.length).toBe(3);
  expect(v.follow).toBe(true);
  atBottom(v, cx); // every row on screen: at the bottom
  expect(v.rows().at(-1).kind).toBe("tail");
  appendFileSync(file, rest);
  v.read(cx);
  await settle(v);
  expect(v.current().turns.length).toBe(3); // the same turn, its reply grown
  expect(v.toBottom).toBe(true);
  // Rows that grew some other way (a part measured taller) with the end off screen: back down,
  // and a later frame with the same rows (the terminal beside it drawing) does not undo that.
  atBottom(v, cx);
  v.sizesVer = (v.sizesVer ?? 0) + 1;
  drawRange(v, 0, v.rows().length - 1);
  expect(v.stickStep).toBe("repin");
  drawRange(v, 0, v.rows().length - 1);
  expect(v.stickStep).toBe("repin");
  v.applyStick();
  expect(v.toBottom).toBe(true);
  expect(v.follow).toBe(true);
  // The same rows with the end off screen and no scroll of the person's (the list got shorter
  // for a frame, or the pane's own scroll): following stays on.
  atBottom(v, cx);
  drawRange(v, 0, v.rows().length - 1);
  expect(v.stickStep ?? null).toBe(null);
  expect(v.follow).toBe(true);
});

test("stick to the bottom: scrolled up nothing moves, and scrolling back down follows again", async () => {
  const { appendFileSync } = await import("node:fs");
  const { file, rest } = grownFixture();
  const { v, cx } = await pane(file);
  atBottom(v, cx);
  const sel = v.sel;
  const n = () => v.rows().length;
  // The person scrolls up: the top row moves, the rows are the same. Following stops.
  drawRange(v, 1);
  scrolled(v, 0, n() - 1);
  expect(v.stickStep).toBe("unstick");
  expect(v.stickyDue).toBe(true);
  v.applyStick();
  expect(v.follow).toBe(false);
  // A new turn comes in: nothing moves, the selection stays, and the latest button gets its dot.
  appendFileSync(file, rest);
  v.read(cx);
  await settle(v);
  expect(v.current().turns.length).toBe(3);
  expect(v.toBottom).toBe(false);
  expect(v.sel).toBe(sel);
  expect(v.unseen).toBe("pending");
  drawRange(v, 0, n() - 1);
  expect(v.unseen).toBe(true);
  expect(v.stickStep ?? null).toBe(null);
  // The list gets taller with no scroll (a closed search field): the end shows, but nothing
  // follows and the selection stays.
  drawRange(v, 0);
  expect(v.stickStep ?? null).toBe(null);
  drawRange(v, 0, n() - 1);
  // Scrolling back down until the end shows: following starts again, on the newest turn,
  // with no scroll of the pane's own.
  scrolled(v, 1, n() - 1);
  scrolled(v, 2);
  expect(v.stickStep).toBe("restick");
  v.applyStick();
  expect(v.follow).toBe(true);
  expect(v.sel).toBe(v.turnKeys(v.rows()).at(-1));
  expect(v.toBottom).toBe(false);
  expect(v.unseen).toBe(false);
  // While a reply streams in the rows change on most frames: a scroll up still stops
  // following, and a scroll back down that reaches the end on a frame with new rows follows.
  atBottom(v, cx);
  drawRange(v, 2);
  scrolled(v, 1); // the person scrolls: the top row moves, the rows are the same
  v.sizesVer = (v.sizesVer ?? 0) + 1; // a read grew the reply
  drawRange(v, 1, n() - 1);
  expect(v.stickStep).toBe("unstick");
  // A read before the step is applied asked for the bottom: dropped with it.
  v.toBottom = true;
  v.applyStick();
  expect(v.follow).toBe(false);
  expect(v.toBottom).toBe(false);
  scrolled(v, 2, n() - 1); // scrolling back down
  v.sizesVer += 1;
  drawRange(v, 2);
  expect(v.stickStep).toBe("restick");
  v.applyStick();
  expect(v.follow).toBe(true);
});

test("stick to the bottom: arrows, opening a turn and a scroll of the pane's own are not fought", async () => {
  const { v, cx } = await pane(fixture("--only", "3"));
  atBottom(v, cx);
  const n = () => v.rows().length;
  // A step up at the bottom: the move stops following, and the end still on screen does not undo it.
  v.action("prev", cx);
  expect(v.follow).toBe(false);
  drawRange(v, 0);
  expect(v.stickStep ?? null).toBe(null);
  // Opening the newest turn: following stops, and the card growing below does not pull down.
  v.action("next", cx);
  expect(v.follow).toBe(true);
  atBottom(v, cx);
  v.toggle(v.sel, cx);
  expect(v.follow).toBe(false);
  // The pane's own scroll to the card is pending, then lands: the top row moves, the end comes
  // back on screen, and none of it counts as the person's.
  drawRange(v, 0, n() - 1);
  drawRange(v, 1);
  expect(v.stickStep ?? null).toBe(null);
  v.scrollTo = null;
  v.scrollBusyUntil = Date.now() + 500;
  drawRange(v, 0, n() - 1);
  drawRange(v, 1);
  expect(v.stickStep ?? null).toBe(null);
  // A key after a frame drops that frame's step: End wins over a scroll seen just before it.
  v.stickStep = "unstick";
  v.action("latest", cx);
  expect(v.stickStep).toBe(null);
  expect(v.follow).toBe(true);
  // A wheel scroll up while following stops it at once; a scroll down does not.
  v.listWheel({ delta: { x: 0, y: -30 } });
  expect(v.follow).toBe(true);
  v.listWheel({ delta: { x: 0, y: 30 } });
  expect(v.follow).toBe(false);
});

test("stick to the bottom: a list that fits, the Pinned view and the outline do not follow a growing reply", async () => {
  const { appendFileSync } = await import("node:fs");
  // A wheel over a list that fits the pane scrolls nothing, so it does not stop following.
  const { v, cx } = await pane(fixture("--only", "2"));
  v.listH = 2000;
  draw(v, cx);
  expect(v.rows()[0].kind).toBe("spacer");
  v.listWheel({ delta: { x: 0, y: 30 } });
  expect(v.follow).toBe(true);
  // A growing read pins the list, but not the Pinned view or the outline.
  for (const where of ["pinned", "outline"]) {
    const { file, rest } = runningFixture();
    const { v, cx } = await pane(file);
    draw(v, cx);
    if (where === "pinned") v.view = "pinned";
    else v.outline = true;
    v.follow = true;
    v.toBottom = false;
    appendFileSync(file, rest);
    v.read(cx);
    await settle(v);
    expect(v.toBottom).toBe(false);
  }
});

test("? opens a sheet of every key, grouped; Esc, ? or the close button shuts it, and the footer's ? keys opens it", async () => {
  const { keySheet } = await import("../mods/agent-threads/ui.js");
  const { v, cx } = await quotePane();
  v.width = 545;
  expect(v.footerHints().at(-1)).toEqual(["?", "keys"]);
  v.key(keyEv("?", { modifiers: { shift: true, control: false, alt: false, platform: false, function: false } }), cx);
  expect(v.keysOpen).toBe(true);
  const c = frame(v, cx);
  const ids = c.filter((e) => e[0] === "id").map((e) => e[1]);
  expect(ids).toEqual(expect.arrayContaining(["th-keys", "th-keys-list", "th-keys-close"]));
  const texts = c.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
  for (const [group, items] of keySheet("q")) {
    expect(texts).toContain(group);
    for (const [, what] of items) expect(texts).toContain(what);
  }
  // Esc closes it before anything else it would back out of (here the open turn).
  if (!v.open.has(v.sel)) v.toggle(v.sel, cx);
  v.key(keyEv("escape"), cx);
  expect(v.keysOpen).toBe(false);
  expect(v.open.has(v.sel)).toBe(true);
  // ? again closes it; Shift-/ is the same key.
  v.key(keyEv("/", { modifiers: { shift: true, control: false, alt: false, platform: false, function: false } }), cx);
  expect(v.keysOpen).toBe(true);
  v.key(keyEv("?", { modifiers: { shift: true, control: false, alt: false, platform: false, function: false } }), cx);
  expect(v.keysOpen).toBe(false);
  // The footer's "? keys" (with the key hints on) and the sheet's close button.
  v.prefs = { ...v.prefs, keyHints: true };
  const f = frame(v, cx);
  handlerAfterId(f, "th-keys-hint", "on_click")({}, cx);
  expect(v.keysOpen).toBe(true);
  const g = frame(v, cx);
  // An icon button sets more styles between its id and its handler than handlerAfterId scans.
  const at = g.findIndex((e) => e[0] === "id" && e[1] === "th-keys-close");
  g.slice(at).find((e) => e[0] === "on_click").at(-1)({}, cx);
  expect(v.keysOpen).toBe(false);
  // While the search field has the keyboard, ? types.
  v.action("filter", cx);
  v.key(keyEv("?", { modifiers: { shift: true, control: false, alt: false, platform: false, function: false } }), cx);
  expect(v.keysOpen).toBe(false);
  // Opening settings closes the sheet, and the sheet closes settings.
  v.action("escape", cx);
  v.action("keys", cx);
  v.action("settings", cx);
  expect([v.keysOpen, v.settingsOpen]).toEqual([false, true]);
  v.action("keys", cx);
  expect([v.keysOpen, v.settingsOpen]).toEqual([true, false]);
  draw(v, cx);
  expect(state.shared["threads.debug"].t4.keysOpen).toBe(true);
  // The card is as tall as its keys in a tall pane, and fits between header and footer in a short one.
  v.footerH = 38;
  v.rootH = 1100;
  expect(v.keySheetH(keySheet("q"))).toBe(36 + 20 + 5 * 22 + 31 * 25 + 4 * 12 + 8);
  v.rootH = 500;
  expect(v.keySheetH(keySheet("q"))).toBe(500 - 46 - 38 - 6);
});

// A press on the list, the pointer's moves while it is held, and the click the list sends on
// the release, as Herdr delivers them (window px).
function gesture(v, cx, key, { from = { x: 200, y: 500 }, to = from, count = 1 } = {}) {
  const calls = frame(v, cx);
  const ev = (p) => ({ position: p, local_position: p, bounds: { width: v.width, height: 800 }, modifiers: {} });
  handlerAfterId(calls, "threads-body", "on_mouse_down")({ ...ev(from), button: "left", click_count: count }, cx);
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    handlerAfterId(calls, "threads-body", "on_mouse_move")(ev({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }), cx);
  }
  v.click(key, cx);
}

test("a drag that selects text never closes or collapses anything; a click that does not move still does", async () => {
  const { v, cx } = await pane(fixture("--extra", "1", "--latest"));
  const t = v.current().turns.find((x) => x.latest && x.latest !== v.replyText(x));
  const key = `0:${t.n}`;
  v.open = new Set([key]);
  v.full.add(`l:${key}`);
  const lt = () => v.rows().find((r) => r.kind === "latest");
  expect(lt().all).toBe(true);
  // The owner's case: a drag up through the open update, released on it, on its Show less, on the
  // card's head or on the message above. Each one leaves everything as it was.
  for (const target of [lt().key, key, `you:${key}`, `rhead:${key}`]) {
    v.sel = null;
    gesture(v, cx, target, { from: { x: 120, y: 620 }, to: { x: 380, y: 410 } });
    expect(v.full.has(`l:${key}`)).toBe(true);
    expect(v.open.has(key)).toBe(true);
    expect(v.full.has(key)).toBe(false);
    // The turn is selected, so c and q act on it.
    expect(v.sel).toBe(key);
  }
  // A sideways drag along one line counts too.
  gesture(v, cx, lt().key, { from: { x: 100, y: 500 }, to: { x: 112, y: 500 } });
  expect(v.full.has(`l:${key}`)).toBe(true);
  // A double press selects a word and a triple press a paragraph: neither toggles.
  for (const count of [2, 3]) {
    gesture(v, cx, lt().key, { count });
    expect(v.full.has(`l:${key}`)).toBe(true);
    gesture(v, cx, key, { count });
    expect(v.open.has(key)).toBe(true);
  }
  // A press that moves a pixel or two is still a click: Show less closes the update, and a
  // click on the head closes the card.
  gesture(v, cx, lt().key, { from: { x: 200, y: 500 }, to: { x: 202, y: 501 } });
  expect(v.full.has(`l:${key}`)).toBe(false);
  gesture(v, cx, key);
  expect(v.open.has(key)).toBe(false);
  // A click after a drag is a click again: the next press starts afresh.
  gesture(v, cx, key, { from: { x: 120, y: 620 }, to: { x: 380, y: 410 } });
  expect(v.open.has(key)).toBe(false);
  gesture(v, cx, key);
  expect(v.open.has(key)).toBe(true);
});

test("a drag ending on Collapse under a long reply or on the strip under it does nothing; a click on Collapse closes the turn", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  const turn = v.sessions.at(-1).turns.at(-1);
  turn.after = [readFileSync(join(root, "test/fixtures/long-reply.md"), "utf8").trim()];
  turn.shapeKey = null;
  const key = `${v.sessions.length - 1}:${turn.n}`;
  v.open = new Set([key]);
  v.rowsKey = null;
  const fold = v.rows().find((r) => r.kind === "fold");
  expect(fold.key).toBe(`fold:${key}`);
  gesture(v, cx, fold.key, { from: { x: 150, y: 300 }, to: { x: 260, y: 700 } });
  expect(v.open.has(key)).toBe(true);
  // The action bar: a drag that ends on Copy reply copies nothing.
  const copies = [];
  v.copyReply = (id) => copies.push(id);
  v.sel = key;
  v.pressX = v.barGeom(turn).copy[0] + 4;
  gesture(v, cx, `cp:${key}`, { from: { x: 150, y: 300 }, to: { x: 160, y: 720 } });
  expect(copies).toEqual([]);
  // Without the drag the same release on Collapse closes the turn, which stays selected.
  gesture(v, cx, fold.key);
  expect(v.open.has(key)).toBe(false);
  expect(v.sel).toBe(key);
  expect(v.scrollTo).toMatchObject({ key, how: "top" });
});
// The selected turn's fill and its bar, as drawn this frame.
function fillAndBar(calls) {
  return { fill: calls.filter(([n, x]) => n === "bg" && x === theme.selected).length, bar: calls.filter(([n, x]) => n === "w" && x === 2).length };
}

test("the selected turn has its bar and no fill, so Herdr's highlight always shows; a drag still notes the text selection", async () => {
  const { v, cx } = await pane(fixture("--extra", "1", "--latest"));
  const t = v.current().turns.find((x) => x.latest && x.latest !== v.replyText(x));
  const key = `0:${t.n}`;
  v.open = new Set([key]);
  v.sel = key;
  v.full.add(`l:${key}`);
  const md = v.rows().find((r) => r.kind === "md");
  const before = fillAndBar(frame(v, cx));
  expect(before.fill).toBe(0);
  expect(before.bar).toBeGreaterThan(0);
  // The drag starts: the fill goes as soon as the press has moved, before the release.
  let calls = frame(v, cx);
  const ev = (p) => ({ position: p, local_position: p, bounds: { width: v.width, height: 800 }, modifiers: {} });
  handlerAfterId(calls, "threads-body", "on_mouse_down")({ ...ev({ x: 120, y: 600 }), button: "left", click_count: 1 }, cx);
  handlerAfterId(calls, "threads-body", "on_mouse_move")(ev({ x: 121, y: 601 }), cx);
  expect(v.textSel ?? null).toBe(null);
  handlerAfterId(calls, "threads-body", "on_mouse_move")(ev({ x: 300, y: 450 }), cx);
  expect(v.textSel).toBe(key);
  const now = fillAndBar(frame(v, cx));
  expect(now.fill).toBe(0);
  expect(now.bar).toBe(before.bar);
  // The release, and c, q and ? after it, keep it off: the highlight stays to copy and quote.
  v.click(md.key, cx);
  for (const name of ["copy", "quote", "keys", "keys"]) v.action(name, cx);
  expect(fillAndBar(frame(v, cx)).fill).toBe(0);
  // A click that does not move clears Herdr's selection; still no fill.
  gesture(v, cx, md.key);
  expect(v.textSel).toBe(null);
  expect(fillAndBar(frame(v, cx))).toEqual(before);
  // A double press (a word) lifts it at once; a key that moves on brings it back.
  calls = frame(v, cx);
  handlerAfterId(calls, "threads-body", "on_mouse_down")({ ...ev({ x: 120, y: 600 }), button: "left", click_count: 2 }, cx);
  expect(v.textSel).toBe(key);
  v.action("prev", cx);
  expect(v.textSel).toBe(null);
  // A drag that ends in another open turn leaves that turn selected without a fill.
  const other = v.current().turns.find((x) => x.n !== t.n && v.replyText(x));
  const okey = `0:${other.n}`;
  v.open.add(okey);
  v.sel = key;
  gesture(v, cx, `md:${okey}:0`, { from: { x: 120, y: 600 }, to: { x: 300, y: 300 } });
  expect(v.sel).toBe(okey);
  expect(v.textSel).toBe(okey);
  expect(fillAndBar(frame(v, cx)).fill).toBe(0);
});

test("before Herdr 0.1.13, where the formatted reply cannot be selected, a drag notes no text selection and draws no fill", async () => {
  const was = herdrVersion;
  herdrVersion = "0.1.12";
  try {
    const { v, cx } = await pane(fixture("--extra", "1"));
    const key = `0:${v.current().turns.at(-1).n}`;
    v.open = new Set([key]);
    v.sel = key;
    gesture(v, cx, key, { from: { x: 120, y: 600 }, to: { x: 300, y: 450 } });
    expect(v.textSel ?? null).toBe(null);
    expect(fillAndBar(frame(v, cx)).fill).toBe(0);
  } finally { herdrVersion = was; }
});

// ---- the outline (o) ---------------------------------------------------------------------

test("o shows the outline: one row per turn under the same day bands, with the search and the agents toggle applied", async () => {
  const { outlineHeight } = await import("../mods/agent-threads/ui.js");
  // Six turns 12 hours apart from 1 Nov 09:12 UTC span three or four local days.
  const { v, cx } = await pane(fixture("--only", "6", "--gap", "43200"));
  draw(v, cx);
  const turns = v.turnKeys(v.rows());
  const daysBefore = v.rows().filter((r) => r.kind === "day").map((r) => r.key);
  v.key(keyEv("o"), cx);
  expect(v.outline).toBe(true);
  draw(v, cx);
  const rows = v.rows().filter((r) => r.kind !== "spacer" && r.kind !== "gap");
  expect(rows.filter((r) => r.kind === "line").map((r) => r.key)).toEqual(turns);
  expect(rows.every((r) => r.kind === "line" || r.kind === "day")).toBe(true);
  expect(rows.filter((r) => r.kind === "day").map((r) => r.key)).toEqual(daysBefore);
  // Each row is one reading line high, and the list is given that height.
  for (const r of rows.filter((x) => x.kind === "line")) expect(v.height(r)).toBe(outlineHeight(v.prefs.textSize));
  expect(outlineHeight(14)).toBe(30);
  expect(lastList.sizes.filter((h) => h === 30).length).toBe(turns.length);
  const snap = state.shared["threads.debug"].t4;
  expect(snap.outline).toBe(true);
  expect(snap.rows.filter((x) => x.startsWith("line#")).length).toBe(turns.length);
  expect(snap.detail.find((d) => d.startsWith("line#1 "))).toContain("| Add alt text to the product images");
  // A search: only the matching turns, no day bands, the match marked.
  v.query = "Playwright";
  draw(v, cx);
  expect(v.rows().filter((r) => r.kind === "line").map((r) => r.turn.n)).toEqual([2, 3]);
  expect(v.rows().some((r) => r.kind === "day")).toBe(false);
  v.query = "";
  // Opening the outline again with o, and closing it with o.
  v.key(keyEv("o"), cx);
  expect(v.outline).toBe(false);
  expect(v.rows().some((r) => r.kind === "line")).toBe(false);
  // The agents toggle decides which turns show.
  const { v: w, cx: wx } = await pane(fixture("--only", "2", "--agents"));
  w.prefs = { ...w.prefs, agentTurns: false };
  // An agent turn with a reply of its own shows while agent messages are hidden; one without
  // stays hidden.
  const quiet = w.current().turns.find((t) => t.agent);
  quiet.after = [];
  w.current().version++;
  w.action("outline", wx);
  const own = w.rows().filter((r) => r.kind === "line").length;
  expect(w.rows().some((r) => r.kind === "line" && r.turn === quiet)).toBe(false);
  w.setAgents(true, wx);
  const all = w.rows().filter((r) => r.kind === "line");
  expect(all.length).toBeGreaterThan(own);
  expect(all.some((r) => r.turn.agent)).toBe(true);
  draw(w, wx);
  expect(state.shared["threads.debug"].t4.detail.some((d) => d.startsWith("line#") && d.includes(" agent:"))).toBe(true);
});

test("in the outline Enter, Space or a click opens that turn in the list at its head; Esc and o go back to where the list was", async () => {
  const { v, cx } = await pane(fixture("--only", "8"));
  draw(v, cx);
  const keys = v.turnKeys(v.rows());
  // Reading turn 3, open, with the list's top in its reply.
  v.sel = keys[2];
  v.toggle(keys[2], cx);
  v.topKey = v.rows().find((r) => r.kind === "md" && r.key.includes(`:${keys[2]}`))?.key ?? keys[2];
  const top = v.topKey;
  v.action("outline", cx);
  expect(v.rows().some((r) => r.kind === "head")).toBe(false); // open cards fold into their rows
  // Up, Down, j and k move in it.
  v.key(keyEv("down"), cx);
  v.key(keyEv("j"), cx);
  expect(v.sel).toBe(keys[4]);
  v.key(keyEv("k"), cx);
  v.key(keyEv("up"), cx);
  v.key(keyEv("up"), cx);
  expect(v.sel).toBe(keys[1]);
  // Esc: the list as it was, turn 3 selected and open, its reply at the top.
  v.key(keyEv("escape"), cx);
  expect(v.outline).toBe(false);
  expect(v.sel).toBe(keys[2]);
  expect(v.open.has(keys[2])).toBe(true);
  expect(v.scrollTo).toMatchObject({ key: top, how: "land" });
  // o leaves it the same way.
  v.action("outline", cx);
  v.action("next", cx);
  v.key(keyEv("o"), cx);
  expect([v.outline, v.sel]).toEqual([false, keys[2]]);
  // Enter: turn 6 opens in the list, selected, with its head at the top.
  v.action("outline", cx);
  v.sel = keys[5];
  v.key(keyEv("enter"), cx);
  expect(v.outline).toBe(false);
  expect(v.sel).toBe(keys[5]);
  expect(v.open.has(keys[5])).toBe(true);
  expect(v.scrollTo).toMatchObject({ key: keys[5], how: "head" });
  expect(v.rows().find((r) => r.key === keys[5]).kind).toBe("head");
  // Space does the same.
  v.action("outline", cx);
  v.sel = keys[0];
  v.key(keyEv("space"), cx);
  expect([v.outline, v.sel, v.open.has(keys[0])]).toEqual([false, keys[0], true]);
  // A click on a row too.
  v.action("outline", cx);
  draw(v, cx);
  v.pressMoved = 0; v.pressCount = 1;
  v.click(keys[7], cx);
  expect([v.outline, v.sel, v.open.has(keys[7])]).toEqual([false, keys[7], true]);
  expect(v.scrollTo).toMatchObject({ key: keys[7], how: "head" });
  // With nothing selected it opens on the newest turn, at the bottom; Esc while following
  // the newest turn goes back to the bottom.
  v.sel = null;
  v.follow = true;
  v.action("outline", cx);
  expect(v.sel).toBe(keys[7]);
  v.action("escape", cx);
  expect([v.outline, v.follow, v.toBottom]).toEqual([false, true, true]);
});

test("the outline marks pins, keeps working narrow, has its own footer, gives way to a pin's return, and is not in the Pinned column", async () => {
  const { v, cx } = await pinPane("--only", "6");
  draw(v, cx);
  const keys = v.turnKeys(v.rows());
  v.action("outline", cx);
  v.sel = keys[3];
  v.action("pin", cx);
  draw(v, cx);
  let detail = state.shared["threads.debug"].t4.detail;
  expect(detail.find((d) => d.startsWith("line#4 "))).toMatch(/ pin1 /);
  expect(detail.find((d) => d.startsWith("line#3 "))).not.toMatch(/ pin/);
  expect(v.outline).toBe(true); // pinning keeps the outline
  // The footer: move, open, back to the list, filter and pin.
  v.width = 545;
  expect(v.footerHints().map(([k, l]) => `${k} ${l}`)).toEqual(["↑↓ move", "↵ open", "Esc list", "/ filter", "p unpin", "? keys"]);
  // Under 300 px the time gives way, and every row still draws.
  v.width = 240;
  draw(v, cx);
  detail = state.shared["threads.debug"].t4.detail;
  expect(detail.filter((d) => d.startsWith("line#")).every((d) => d.includes("(no time)"))).toBe(true);
  expect(v.footerHints().at(-1)).toEqual(["?", "keys"]);
  v.width = 380;
  // 1 returns to the pin in the list, at its place: the outline gives way.
  v.sel = keys[0];
  v.action("go:1", cx);
  expect(v.outline).toBe(false);
  expect(v.sel).toBe(keys[3]);
  expect(v.open.has(keys[3])).toBe(true);
  // s opens Select view on the turn, in the list.
  v.action("outline", cx);
  v.sel = keys[1];
  v.action("select", cx);
  expect([v.outline, v.selecting]).toEqual([false, keys[1]]);
  v.action("escape", cx);
  // The Pinned view in the same pane: o shows all turns, as an outline.
  v.setView("pinned");
  expect(v.action("outline", cx)).toBe(true);
  expect(v.view).toBe("all");
  expect(v.rows().some((r) => r.kind === "line")).toBe(true);
  v.action("outline", cx);
  // The Pinned column has no outline: o does nothing there.
  v.pinnedPane = true;
  v.view = "pinned";
  expect(v.action("outline", cx)).toBe(false);
  expect(v.rows().some((r) => r.kind === "line")).toBe(false);
  // Its ? sheet leaves o out, and Esc does not name the outline there.
  v.action("keys", cx);
  let texts = frame(v, cx).filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
  expect(texts).toContain("Show or hide agent messages");
  expect(texts).not.toContain("Outline: one row per turn");
  expect(texts).toContain("Back out: search, Select view, settings, the open turn");
  v.action("keys", cx);
  // The main pane's sheet still lists it.
  v.pinnedPane = false;
  v.view = "all";
  v.action("keys", cx);
  texts = frame(v, cx).filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
  expect(texts).toContain("Outline: one row per turn");
  expect(texts).toContain("Back out: search, Select view, settings, the open turn, the outline");
});

// The owner's report: Reply lines minus in a long session showed "This view could not be
// re-rendered" (interrupted in shape): every collapsed row was reshaped in one draw. Now a
// draw reshapes for at most SHAPE_MS, rows in view first, and the next frames go on.
test("a settings change in a long session reshapes rows over several frames, the ones in view first", async () => {
  // Agent messages with no reply of their own: hidden, and never shaped, till the toggle below.
  const { v, cx } = await paneWith(fixture("--busy", "130", "--quiet"), null, 1000);
  v.width = 545;
  v.prefs = { ...v.prefs, truncate: true }; // so Reply lines changes the rows
  draw(v, cx);
  // Without the debug report, whose timing pass rebuilds the rows once more each draw.
  v.debug = false;
  // Every row built and shaped before the change below, on any machine: on the real clock a
  // slow one left rows unshaped here, and the counts below came out otherwise.
  v.shapeBudget = Infinity;
  settleRows(v, cx);
  v.shapeBudget = null;
  const shown = () => v.rows().filter((r) => r.kind === "turn" && !r.live);
  expect(shown().length).toBeGreaterThan(100);
  // Reshaped for Reply lines 2: the turn's shape key has the new count, and the row draws it.
  const fresh = (r) => r.turn.shapeKey?.split("|")[4] === "2" && r.shape === r.turn.shapeMemo && !r.shape.blank;
  const realPerf = performance.now.bind(performance);
  let fake = 0;
  // Each reading of the clock moves it 0.25 ms, so a reshape costs about 0.5 ms and a frame
  // reshapes about 24 rows.
  performance.now = () => (fake += 0.25);
  // The scroll's waits (2 s at most while rows settle, 400 ms for the probe) are on Date.now:
  // stopped, so the frames below take no time however slow the machine is.
  const realDate = Date.now;
  const today = realDate();
  Date.now = () => today;
  // The list draws the rows of one screen at its end, as Herdr does: drawing all 1,305 rows in
  // each of the 40 frames below took 3 s on one CPU, and the same frames run either way.
  listWindow = (n) => ({ start: Math.max(0, n - 24), end: n });
  try {
    // The pane shows the turns from 20 rows above the end.
    const before = shown();
    v.topKey = before[before.length - 20].key;
    v.action("replyLines:2", cx);
    // The reshaping time a draw gets follows the last draw's cost on the real clock: start
    // from a quick one, so the counts below do not depend on how busy the machine is. On a slow
    // machine the draws above may leave a frame queued: dropTimers drops it with its mark.
    v.frameBase = 0;
    dropTimers(v, cx);
    // A scroll asked for now waits for the reshaping, and a return's wait for the probe
    // (until) starts after it.
    v.scrollTo = { key: before[5].key, how: "center", until: Date.now() - 1 };
    draw(v, cx);
    // The rows are built over a few frames (BUILD_MS on this clock), the old ones shown till then.
    for (let k = 0; k < 50 && v.rowJob; k++) draw(v, cx);
    expect(v.rowJob).toBe(null);
    let rows = shown();
    const first = rows.filter(fresh).length;
    // Some rows, not all, in the first frame, and a frame queued to go on.
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(rows.length);
    expect(v.shapeLeft).toBeGreaterThan(0);
    expect(cx.timers.some((x) => x.ms === 0)).toBe(true);
    expect(v.scrollTo?.key).toBe(before[5].key);
    expect(v.scrollTo.until).toBeGreaterThan(Date.now());
    // The rows from the top of the pane down were among the first; rows further up wait.
    expect(rows.slice(-20).every(fresh)).toBe(true);
    expect(rows.slice(40, 80).some(fresh)).toBe(false);
    // Only the queued frames go on with it (cx.flush runs the timer, which drops the rows).
    let frames = 0;
    for (; frames < 200 && v.shapeLeft > 0; frames++) { cx.flush(0); draw(v, cx); }
    expect(frames).toBeGreaterThan(1);
    expect(v.shapeLeft).toBe(0);
    rows = shown();
    expect(rows.every(fresh)).toBe(true);
    // Then the return waits for the probe until its deadline, and runs.
    draw(v, cx);
    expect(v.scrollTo?.key).toBe(before[5].key);
    v.scrollTo.until = Date.now() - 1;
    draw(v, cx);
    expect(v.scrollTo).toBe(null);
    // Agent messages on: rows never shaped before draw blank for a frame, then fill in.
    v.action("agents", cx);
    dropTimers(v, cx);
    draw(v, cx);
    for (let k = 0; k < 50 && v.rowJob; k++) draw(v, cx);
    expect(shown().some((r) => r.shape.blank)).toBe(true);
    for (let k = 0; k < 400 && v.shapeLeft > 0; k++) { cx.flush(0); draw(v, cx); }
    expect(v.shapeLeft).toBe(0);
    expect(shown().some((r) => r.shape.blank || r.shape !== r.turn.shapeMemo)).toBe(false);
  } finally { performance.now = realPerf; Date.now = realDate; listWindow = null; }
  // The heights match a reshape done in one go, with no budget.
  const keep = shown().map((r) => r.shape.height);
  for (const t of v.current().turns) { t.shapeKey = null; t.shapeMemo = null; }
  v.rowsKey = null;
  v.shapeBudget = Infinity;
  expect(shown().map((r) => r.shape.height)).toEqual(keep);
  expect(v.shapeLeft).toBe(0);
});

test("the rail card: a hovered tick shows the day, time and number, two lines of its prompt and three of its reply, beside it on the left", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  // The default pane at the reading width, or wider than the column.
  v.paneW = Math.max(573, v.width + 80);
  v.listH = 600;
  draw(v, cx);
  const ks = keys();
  let { ticks } = v.railTicks();
  // Each tick is the trigger of a Popup anchored on its right centre, so the card sits to its left.
  rec = []; v.railView(theme); let r = rec; rec = null;
  expect(r.filter((e) => e[0] === "Popup").length).toBe(ticks.length);
  expect(r.some((e) => e[0] === "anchor" && e[1] === "right_center")).toBe(true);
  expect(r.some((e) => e[0] === "id" && e[1] === "th-rail-card")).toBe(false);
  expect(r.some((e) => e[0] === "tooltip")).toBe(false);
  // Pointing at a tick opens its card; leaving it closes it.
  // The first hover report is the rail's own (it holds the window); then one per tick.
  const all = r.filter((e) => e[0] === "on_hover").map((e) => e[1]);
  expect(all.length).toBe(ticks.length + 1);
  const hovers = all.slice(1);
  all[0](true, cx);
  expect(v.railOn).toBe(true);
  all[0](false, cx);
  expect(v.railOn).toBe(false);
  hovers[1](true, cx);
  expect(v.railHover).toBe(ks[1]);
  rec = []; v.railView(theme); r = rec; rec = null;
  expect(r.some((e) => e[0] === "id" && e[1] === "th-rail-card")).toBe(true);
  const turn = v.findTurn(ks[1]);
  const c = v.railCard(ticks[1]);
  // The first line: the day leads (muted), then the time and the number (dim).
  expect(c.day).toBe(railDay(turn.ts));
  expect(c.rest).toMatch(new RegExp(`^\\d{1,2}:\\d\\d\\s[AP]M · #${turn.n}$`));
  expect(r).toContainEqual(["child", c.day]);
  expect(r).toContainEqual(["child", c.rest]);
  expect(c.body.length).toBeGreaterThan(0);
  expect(c.body.length).toBeLessThanOrEqual(2 * 46);
  // The reply on three lines at most, flattened, in the muted colour.
  expect(c.reply.length).toBeGreaterThan(0);
  expect(c.reply.length).toBeLessThanOrEqual(3 * 50);
  expect(c.reply).not.toMatch(/[*`#|]/);
  expect(r).toContainEqual(["child", c.reply]);
  expect(r.some((e) => e[0] === "w" && e[1] === 300)).toBe(true);
  // The peak: the hovered tick at its peak (24 px, 16 in this gutter under 40 px), its
  // neighbours less by the square of how near they are.
  const look = railLook(v.side());
  const ws = r.filter((e) => e[0] === "w").map((e) => e[1]);
  expect(look.peak).toBe(v.side() < 40 ? 16 : 24);
  expect(ws).toContain(look.peak);
  expect(ws).toContain(railSwell(look.mark, look.peak, v.railTicks().L.pitch));
  hovers[0](false, cx);
  expect(v.railHover).toBe(ks[1]);
  // Leaving the tick keeps the card 200 ms, so the pointer can cross to it; then it closes.
  cx.timers.length = 0;
  hovers[1](false, cx);
  expect(v.railHover).toBe(ks[1]);
  expect(cx.timers.map((x) => x.ms)).toEqual([200]);
  cx.timers[0].fn(cx);
  expect(v.railHover).toBe(null);
  // Another tick's hover before the wait ends cancels it.
  hovers[1](true, cx);
  cx.timers.length = 0;
  hovers[1](false, cx);
  hovers[2](true, cx);
  cx.timers[0].fn(cx);
  expect(v.railHover).toBe(ks[2]);
  // The pointer on the card keeps it: the wait finds the card hovered and leaves it open.
  v.railHover = ks[1];
  v.railCardOn = true;
  cx.timers.length = 0;
  hovers[1](false, cx);
  expect(cx.timers.length).toBe(0);
  expect(v.railHover).toBe(ks[1]);
  // The card's pin pins its turn; a second press unpins it.
  rec = []; v.railView(theme); const rc = rec; rec = null;
  const at = rc.findIndex((e) => e[0] === "id" && e[1] === "th-rail-card-pin");
  expect(at).toBeGreaterThan(-1);
  expect(rc.slice(at).find((e) => e[0] === "tooltip")[1]).toBe(`Pin #${turn.n} (p)`);
  const press = rc.slice(at).find((e) => e[0] === "on_click")[1];
  press({}, cx);
  expect(v.isPinnedTurn(turn)).toBe(true);
  press({}, cx);
  expect(v.isPinnedTurn(turn)).toBe(false);
  v.railCardOn = false;
  v.railHover = null;
  // The test command opens it by turn number, since the test window has no pointer.
  v.debug = true;
  v.action(`debugRailCard:${turn.n}`, cx);
  expect(v.railHover).toBe(ks[1]);
  v.action("debugRailCard:-", cx);
  expect(v.railHover).toBe(null);
  // A pinned turn says so; a tick that stands for several turns names the range.
  v.sel = ks[2];
  v.action("pin", cx);
  ({ ticks } = v.railTicks());
  expect(v.railCard(ticks[2]).pinned).toBe(true);
  expect(v.railCard(ticks[1]).pinned).toBe(false);
  // While a card is open, p pins the card's turn, not the selected one.
  v.railHover = ks[3];
  v.action("pin", cx);
  ({ ticks } = v.railTicks());
  expect(ticks[3].pinned).toBe(true);
  expect(ticks[2].pinned).toBe(true);
  v.railHover = null;
  // Rail side Left: the lane on the left edge, the card anchored on its left centre.
  v.prefs = { ...v.prefs, railSide: "left" };
  v.railHover = ks[1];
  rec = []; v.railView(theme); r = rec; rec = null;
  expect(r.some((e) => e[0] === "anchor" && e[1] === "left_center")).toBe(true);
  const lk = railLook(v.side());
  expect(r.some((e) => e[0] === "pl" && e[1] === RAIL.CARD_GAP + Math.max(0, lk.peak + lk.right - lk.lane))).toBe(true);
  expect(r).toContainEqual(["left", 0]);
  v.prefs = { ...v.prefs, railSide: "right" };
  v.railHover = null;
  // Every tick is one turn at any height: no tick stands for several.
  v.listH = 12;
  ({ ticks } = v.railTicks());
  expect(ticks.every((k) => k.turns.length === 1)).toBe(true);
});

test("the rail replaces the scrollbar: a tick per turn, on screen brighter, selected longer, pinned in accent; a click goes to the turn; a search dims misses", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  // The default pane at the reading width, or wider than the column.
  v.paneW = Math.max(573, v.width + 80);
  v.listH = 600;
  draw(v, cx);
  const ks = keys();
  expect(v.railShown()).toBe(true);
  let { L, ticks } = v.railTicks();
  expect(L.pitch).toBe(9);
  expect(ticks.map((k) => k.key)).toEqual(ks);
  // No scrollbar in the body any more, and the rail is drawn in it.
  rec = []; v.render(cx); const drawn = rec; rec = null;
  expect(drawn.some((e) => e[0] === "id" && e[1] === "th-rail")).toBe(true);
  expect(drawn.some((e) => e[0] === "id" && e[1] === "th-tick-0")).toBe(true);
  // The turns the list drew are on screen; the selected tick is longer, a pinned one accent.
  drawRange(v, 0, 3);
  ({ ticks } = v.railTicks());
  expect(ticks[0].inView).toBe(true);
  expect(ticks.at(-1).inView).toBe(false);
  v.sel = ks[1];
  v.action("pin", cx);
  v.sel = ks[2];
  ({ ticks } = v.railTicks());
  expect(ticks[1].pinned).toBe(true);
  expect(ticks[2].sel).toBe(true);
  rec = []; v.railView(theme); const r = rec; rec = null;
  expect(r.some((e) => e[0] === "w" && e[1] === railLook(v.side()).sel)).toBe(true);
  // The ticks take their size from the side gutter: in a 960 px pane the text sits well in,
  // so the ticks are 10 px (16 selected), 14 px in, in a 32 px lane.
  v.paneW = 960;
  draw(v, cx);
  expect(v.side()).toBeGreaterThan(56);
  rec = []; v.railView(theme); const wide = rec; rec = null;
  expect(wide.filter((e) => e[0] === "w").map((e) => e[1])).toEqual(expect.arrayContaining([32, 10, 16]));
  expect(wide.some((e) => e[0] === "right" && e[1] === 14)).toBe(true);
  expect(r.some((e) => e[0] === "bg" && e[1] === theme.accent)).toBe(true);
  // One-line tooltips: number, time, pinned, the prompt's start.
  expect(v.railTip(ticks[1])).toMatch(new RegExp(`^#${v.findTurn(ks[1]).n} · .+ · pinned · `));
  // A click selects the turn and brings it level with the tick: its first line at about the
  // tick's height (railTickY), the turn's top 18 px above that.
  v.follow = true;
  const tickY = v.railTickY(ks[0]);
  expect(tickY).toBeGreaterThan(0);
  expect(tickY).toBeLessThan(v.listH);
  v.railJump(ks[0], cx);
  expect(v.sel).toBe(ks[0]);
  expect(v.follow).toBe(false);
  expect(v.scrollTo).toEqual({ key: ks[0], how: "head", flash: true, at: Math.max(0, tickY - 18) });
  // A search keeps every tick and dims the ones it leaves out.
  const word = v.findTurn(ks[0]).prompt.split(/\s+/).find((w) => w.length > 5);
  v.query = word;
  v.rows();
  ({ ticks } = v.railTicks());
  expect(ticks.length).toBe(ks.length);
  expect(ticks.some((k) => k.miss)).toBe(true);
  expect(ticks[0].miss).toBe(false);
  v.query = "";
  // Not in the outline or the Pinned view.
  v.outline = true;
  expect(v.railShown()).toBe(false);
  v.outline = false;
  v.setView("pinned");
  expect(v.railShown()).toBe(false);
  v.setView("all");
});

test("subagents: their calls are a group of their own, Ran 3 subagents with the bot icon, apart from the commands", async () => {
  const { v, cx } = await scripted([
    { k: "p", o: "human", t: "Check the calendar code", ts: at(0) },
    { k: "u", n: "Bash" }, { k: "u", n: "Agent" }, { k: "u", n: "Agent" }, { k: "u", n: "Agent" }, { k: "u", n: "Bash" },
    { k: "t", t: "All three are back." }, { k: "d", ms: 132000, ts: at(3) },
  ]);
  const a = "0:1";
  v.sel = a;
  v.action("open", cx);
  v.click(`rhead:${a}`, cx);
  const grps = v.rows().filter((r) => r.kind === "grp" && r.key.startsWith(`gp:${a}:`));
  expect(grps.map((r) => v.rowDetail(r).replace(/^grp#\d+ /, ""))).toEqual(["Ran 1 command", "Ran 3 subagents", "Ran 1 command"]);
  const icons = (r) => { rec = []; v.partContent(theme, r); const c = rec; rec = null; return c.filter((e) => e[0] === "svg").map((e) => String(e[1]).split("/").pop()); };
  expect(icons(grps[1])[0]).toBe("bot.svg");
  expect(icons(grps[0])[0]).toBe("wrench.svg");
  // Opened, one row per subagent with the bot icon.
  v.click(grps[1].key, cx);
  const calls = v.rows().filter((r) => r.kind === "call" && r.key.startsWith(`cl:${a}:1:`));
  expect(calls.map((r) => r.name)).toEqual(["Agent", "Agent", "Agent"]);
  expect(icons(calls[0])).toContain("bot.svg");
  draw(v, cx);
  // A subagent started in the background has no time: its call ended at the launch. One that
  // ran in the foreground returned its report, so its time is the work's.
  const c = { inTs: "2026-11-01T09:00:00.000Z", outTs: "2026-11-01T09:00:02.000Z" };
  expect(v.callTook("Agent", { ...c, out: "Async agent launched successfully. agentId: a1" })).toBe("");
  expect(v.callTook("Agent", { ...c, out: "The range math is right." })).toBe("2s");
  expect(v.callTook("Bash", { ...c, out: "Async agent launched" })).toBe("2s");
});

test("subagents: the synthetic fixture's three Agent calls read as their own group", async () => {
  const { v } = await pane(fixture("--subagents"));
  const turn = v.current().turns.find((t) => t.prompt.startsWith("Review the calendar code"));
  expect(turn.steps.filter((x) => x.k === "group").map((g) => [g.calls, Boolean(g.agent)])).toEqual([
    [["Bash"], false], [["Agent", "Agent", "Agent"], true], [["Bash"], false],
  ]);
});

test("subagent states: the group line says how many work and failed, and each row has its mark, time and a model pill when it differs", async () => {
  const { v, cx } = await pane(fixture("--subagents"));
  const turn = v.current().turns.find((t) => t.prompt.startsWith("Review the calendar code"));
  const a = `0:${turn.n}`;
  v.sel = a;
  if (!v.open.has(a)) v.action("open", cx);
  v.click(`rhead:${a}`, cx);
  const grp = v.rows().find((r) => r.kind === "grp" && r.key.startsWith(`gp:${a}:`) && r.step.agent);
  // All back, one failed: past tense, the failed count, no working count.
  expect(v.rowDetail(grp).replace(/^grp#\d+ /, "")).toBe("Ran 3 subagents · 1 failed [failed]");
  // No "background updates" for the notifications that only settled them.
  expect(turn.followups).toBe(0);
  v.click(grp.key, cx);
  const calls = v.rows().filter((r) => r.kind === "call" && r.key.startsWith(`cl:${a}:${grp.gi}:`));
  expect(calls.map((r) => v.rowDetail(r).replace(/^call#\d+ /, "").replace(/ \[(open|closed)\]/, ""))).toEqual([
    "Agent · 48s [completed]", "Agent · 1m 01s [completed]", "Agent (sonnet 5.5) · 12s [failed]",
  ]);
  const icons = (r) => { rec = []; v.partContent(theme, r); const c = rec; rec = null; return c.filter((e) => e[0] === "svg").map((e) => String(e[1]).split("/").pop()); };
  expect(icons(calls[0])[0]).toBe("check.svg");
  expect(icons(calls[2])[0]).toBe("circle-x.svg");
  expect(icons(grp)[0]).toBe("circle-x.svg");
});

test("subagent states: still working after the reply, the line says so with the spinner; in an ended session they have no result", async () => {
  const { v, cx } = await scripted([
    { k: "p", o: "human", t: "Check the calendar code", ts: at(0) },
    { k: "u", n: "Agent", id: "toolu_a" }, { k: "r", id: "toolu_a", a: "a1", m: null, st: "async_launched" },
    { k: "u", n: "Agent", id: "toolu_b" }, { k: "r", id: "toolu_b", a: "a2", m: null, st: "async_launched" },
    { k: "t", t: "Two reviews are running; I will report back." }, { k: "d", ms: 9000, ts: at(1) },
    { k: "n", a: "a2", st: "stopped", ms: 4000 },
  ]);
  const a = "0:1";
  v.sel = a;
  v.action("open", cx);
  v.click(`rhead:${a}`, cx);
  const grp = () => v.rows().find((r) => r.kind === "grp" && r.step.agent);
  expect(v.rowDetail(grp()).replace(/^grp#\d+ /, "")).toBe("Running 2 subagents · 1 working");
  v.click(grp().key, cx);
  const calls = () => v.rows().filter((r) => r.kind === "call" && r.key.startsWith(`cl:${a}:`));
  expect(calls().map((r) => v.rowDetail(r).replace(/^call#\d+ /, "").replace(/ \[(open|closed)\]/, ""))).toEqual(["Agent [working]", "Agent · 4s [stopped]"]);
  // The terminal has ended: the one with no notification has no result on record.
  v.res.ended = true;
  expect(v.rowDetail(grp()).replace(/^grp#\d+ /, "")).toBe("Ran 2 subagents [open]");
  expect(v.rowDetail(calls()[0])).toContain("[no result]");
});

test("level 1 and 2: a click on an open turn's line opens it to its steps; a group opens to its calls; i opens the Turn card and nothing in the list; a stopped turn says how long it ran", async () => {
  const { v, cx } = await scripted([
    { k: "p", o: "human", t: "Fix the cart total", ts: at(0) },
    { k: "u", n: "Read" }, { k: "u", n: "Bash" }, { k: "u", n: "Bash" }, { k: "u", n: "Edit" },
    { k: "t", t: "Fixed the rounding." }, { k: "d", ms: 151000, ts: at(3) },
    { k: "p", o: "human", t: "And the tax line", ts: at(4) }, { k: "u", n: "Grep" }, { k: "i" },
    { k: "p", o: "human", t: "Try again", ts: at(6) }, { k: "t", t: "Done." }, { k: "d", ms: 900, ts: at(7) },
  ]);
  const a = "0:1";
  const kinds = (k = a) => v.rows().filter((r) => r.turn && `${r.si}:${r.turn.n}` === k).map((r) => r.kind);
  v.sel = a;
  v.action("open", cx);
  expect(v.open.has(a)).toBe(true);
  // Closed line: no level 1 parts, a right chevron.
  expect(kinds()).not.toContain("grp");
  const lineOf = () => { rec = []; v.partContent?.(theme, v.rows().find((r) => r.key === `rhead:${a}`)); const c = rec; rec = null; return c; };
  const svgs = (c) => c.filter((e) => e[0] === "svg").map((e) => String(e[1]).split("/").pop());
  if (v.partContent) expect(svgs(lineOf())).toContain("chevron-right.svg");
  // A click on the line opens it: the step group, then straight into the reply.
  v.click(`rhead:${a}`, cx);
  expect(v.lineIsOpen(a, false)).toBe(true);
  const ks = kinds();
  expect(ks.indexOf("grp")).toBe(ks.indexOf("rhead") + 1);
  expect(ks.indexOf("md")).toBe(ks.indexOf("grp") + 1);
  expect(ks).not.toContain("stats");
  expect(ks).not.toContain("legend");
  expect(v.rowDetail(v.rows().find((r) => r.key === `gp:${a}:0`))).toBe("grp#1 Read 1 file, ran 2 commands and edited 1 file");
  // A click on the group opens it to one row per call (level 2), and closes it again.
  v.click(`gp:${a}:0`, cx);
  expect(v.rows().filter((r) => r.kind === "call" && r.key.startsWith(`cl:${a}:`)).map((r) => r.name)).toEqual(["Read", "Bash", "Bash", "Edit"]);
  expect(v.rowDetail(v.rows().find((r) => r.key === `gp:${a}:0`))).toMatch(/\[open\]$/);
  v.click(`gp:${a}:0`, cx);
  expect(kinds()).not.toContain("call");
  expect(v.rowDetail(v.rows().find((r) => r.key === `rhead:${a}`))).toMatch(/Worked for 2m 31s \[open\]/);
  if (v.partContent) expect(svgs(lineOf())).toContain("chevron-down.svg");
  // i opens the Turn card and changes nothing in the list.
  const open = kinds().join(",");
  v.action("legend", cx);
  expect(v.detailsOpen).toBe(true);
  expect(kinds().join(",")).toBe(open);
  v.action("legend", cx);
  expect(v.detailsOpen).toBe(false);
  // A second click closes the line.
  v.click(`rhead:${a}`, cx);
  expect(kinds()).not.toContain("grp");
  // i on a closed turn leaves it closed.
  const b = "0:3";
  v.sel = b;
  v.action("legend", cx);
  expect(v.open.has(b)).toBe(false);
  expect(v.lineIsOpen(b, false)).toBe(false);
  v.detailsOpen = false;
  // A stopped turn's line says so, in the blocked colour, with no icon.
  const stopped = v.findTurn("0:2");
  expect(stopped.interrupted).toBe(true);
  expect(v.workText(stopped)).toMatch(/^Stopped( after .+)?$/);
  rec = []; v.workLine(theme, stopped); const w = rec; rec = null;
  const i = w.findIndex((e) => e[0] === "child" && e[1] === v.workText(stopped));
  expect(w.slice(Math.max(0, i - 4), i).some((e) => e[0] === "text_color" && e[1] === theme.blocked)).toBe(true);
  expect(svgs(w)).toEqual(["chevron-right.svg"]);
  expect(v.workText(v.findTurn(a))).toBe("Worked for 2m 31s");
});

test("the running turn's line reads Working for and the clock, then what it has done so far", async () => {
  const { v, cx } = await scripted([{ k: "p", o: "human", t: "Fix the cart total", ts: new Date(Date.now() - 48000).toISOString() }, { k: "u", n: "Bash" }]);
  v.statusNow = "working";
  const st = v.status;
  v.status = () => "working";
  rec = []; v.liveLine(theme, v.findTurn("0:1")); const c = rec; rec = null;
  v.status = st;
  const text = c.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]).join(" ");
  expect(text).toMatch(/^Working for 0:4\d · 1 tool call so far$/);
  draw(v, cx);
});

test("steps: interim text between groups in order; → opens the turn, its line, then its groups; ← backs out a level at a time", async () => {
  const { v, cx } = await scripted([
    { k: "p", o: "human", t: "Fix the cart total", ts: at(0) },
    { k: "t", t: "Looking at the cart." }, { k: "u", n: "Read" }, { k: "u", n: "Grep" },
    { k: "t", t: "Found it. Running the tests." }, { k: "u", n: "Bash" },
    { k: "t", t: "Fixed the rounding." }, { k: "d", ms: 40000, ts: at(1) },
    { k: "p", o: "human", t: "Thanks", ts: at(2) }, { k: "t", t: "You're welcome." }, { k: "d", ms: 900, ts: at(3) },
  ]);
  const a = "0:1";
  const parts = () => v.rows().filter((r) => r.turn && `${r.si}:${r.turn.n}` === a).map((r) => r.kind);
  v.sel = a;
  // → on a closed turn opens it and its line.
  expect(v.action("deeper", cx)).toBe(true);
  expect(v.open.has(a)).toBe(true);
  const p1 = parts();
  const at1 = p1.indexOf("rhead");
  expect(p1.slice(at1, at1 + 5)).toEqual(["rhead", "itext", "grp", "itext", "grp"]);
  expect(p1).not.toContain("stats");
  const its = v.rows().filter((r) => r.kind === "itext" && r.key.startsWith(`it:${a}:`));
  expect(its.map((r) => r.src)).toEqual(["Looking at the cart.", "Found it. Running the tests."]);
  expect(v.rowDetail(v.rows().find((r) => r.key === `gp:${a}:1`))).toBe("grp#1 Read 1 file and searched 1 time");
  expect(v.rowDetail(v.rows().find((r) => r.key === `gp:${a}:3`))).toBe("grp#1 Ran 1 command");
  // The interim text is measured like the reply: it is in the probe until measured.
  expect(v.probeRows.some((r) => r.kind === "itext")).toBe(true);
  // → again opens every group; ← closes them, then the line, then the turn.
  v.action("deeper", cx);
  expect(parts().filter((k) => k === "call").length).toBe(3);
  v.action("shallower", cx);
  expect(parts()).not.toContain("call");
  expect(parts()).toContain("grp");
  // A closed group's line has the tool icon and no check: its calls are not read, so it
  // cannot know they passed.
  rec = []; v.partContent(theme, v.rows().find((r) => r.key === `gp:${a}:1`), false); const gl = rec; rec = null;
  const glyphs = gl.filter((e) => e[0] === "svg").map((e) => String(e[1]).split("/").pop());
  expect(glyphs).toContain("wrench.svg");
  expect(glyphs).not.toContain("check.svg");
  v.action("shallower", cx);
  expect(parts()).not.toContain("grp");
  expect(v.open.has(a)).toBe(true);
  v.action("shallower", cx);
  expect(v.open.has(a)).toBe(false);
  // A turn with no tool calls opens to its line and the reply.
  v.sel = "0:2";
  v.action("deeper", cx);
  const p2 = v.rows().filter((r) => r.turn && `${r.si}:${r.turn.n}` === "0:2").map((r) => r.kind);
  expect(p2).not.toContain("grp");
  expect(p2).not.toContain("stats");
  expect(v.lineIsOpen("0:2", false)).toBe(true);
  // Group and call rows are never a pin's reading place.
  const { NOT_A_PLACE } = await import("../mods/agent-threads/pins.js");
  for (const k of ["gp", "cl", "ws"]) expect(NOT_A_PLACE.has(k)).toBe(true);
  draw(v, cx);
});

test("a turn with hundreds of interim texts opens within Herdr's time: links and estimates are kept, new ones wait past the budget, the probe takes a few parts a frame", async () => {
  const steps = [];
  // Past 300 steps (STEP_MAX) the rest join the last group, so this is 150 texts.
  for (let i = 0; i < 300; i++) steps.push({ k: "t", t: `Step ${i} looks at ACME-${i}.\n\nThen the tests again.` }, { k: "u", n: "Read" });
  const { v, cx } = await scripted([{ k: "p", o: "human", t: "Refactor the cart", ts: at(0) }, ...steps, { k: "t", t: "Done." }, { k: "d", ms: 40000, ts: at(1) }]);
  v.applyPrefs(JSON.stringify({ links: [{ name: "Issue", pattern: "\\bACME-(\\d+)\\b", url: "https://linear.app/acme/issue/ACME-$1" }] }));
  expect(v.links.length).toBe(1);
  let linked = 0;
  const linkOne = v.linkOne.bind(v);
  v.linkOne = (md) => { if (md.startsWith("Step ")) linked++; return linkOne(md); };
  const texts = () => v.rows().filter((r) => r.kind === "itext");
  // Out of time from the start of the draw: each text shows as written with a rough
  // height, and the next frame is asked for.
  v.shapeBudget = -1;
  v.sel = "0:1";
  v.action("deeper", cx);
  expect(texts().length).toBe(150);
  expect(linked).toBe(0);
  expect(texts().every((r) => r.links === 0 && r.md === r.src)).toBe(true);
  expect(v.mdHeights.map.size).toBe(0);
  expect(v.shapeLeft).toBeGreaterThan(0);
  cx.timers = [];
  v.render(cx);
  expect(cx.timers.some((x) => x.ms === 0)).toBe(true);
  // With time again, the next frame links and measures them, once.
  v.shapeBudget = 1e9;
  v.rowsKey = null;
  expect(texts().every((r) => r.links === 1 && r.md.includes("https://linear.app/acme/issue/ACME-"))).toBe(true);
  expect(linked).toBe(150);
  const known = v.mdHeights.map.size;
  expect(known).toBeGreaterThanOrEqual(150);
  // A rebuild of the rows (any other reason) runs neither again.
  v.rowsKey = null;
  texts();
  expect(linked).toBe(150);
  expect(v.mdHeights.map.size).toBe(known);
  // New link rules link them again.
  v.applyPrefs(JSON.stringify({ links: [{ name: "Issue", pattern: "\\bACME-(\\d+)\\b", url: "https://linear.example/ACME-$1" }] }));
  expect(texts().every((r) => r.md.includes("https://linear.example/ACME-"))).toBe(true);
  expect(linked).toBe(300);
  // The probe draws at most 16 parts in a frame, nearest the top of the pane first, and asks
  // for the next frame while parts are left.
  v.meas = new Map();
  v.probeTries = new Map();
  const top = v.baseIndex.get(texts()[75].key);
  v.topKey = texts()[75].key;
  const due = v.probeDue();
  expect(due.length).toBe(16);
  expect(v.probeLeft).toBeGreaterThan(0);
  expect(due.every(([r]) => Math.abs(v.baseIndex.get(r.key) - top) <= 32)).toBe(true);
  cx.timers = [];
  v.render(cx);
  expect(cx.timers.some((x) => x.ms === 16)).toBe(true);
  draw(v, cx);
});

test("subagents open while the turn runs: their rows show without a press, the person's close stays, and the finished turn folds them into one line", async () => {
  const { apply } = await import("../mods/agent-threads/core/turns.js");
  const { v, s, cx } = await scripted([
    { k: "p", o: "human", t: "Review the calendar code", ts: at(0) },
    { k: "u", n: "Bash", id: "toolu_b" },
    { k: "u", n: "Agent", id: "toolu_a" }, { k: "r", id: "toolu_a", a: "a1", m: null, st: "async_launched" },
    { k: "u", n: "Agent", id: "toolu_c" }, { k: "r", id: "toolu_c", a: "a2", m: null, st: "async_launched" },
  ]);
  const a = "0:1";
  const st = v.status;
  v.status = () => "working";
  v.rowsKey = null;
  v.sel = null;
  // The turn's own row is first: "wrow", or "working" once a click selects it.
  const live = () => v.rows().filter((r) => r.turn && `${r.si}:${r.turn.n}` === a).map((r) => r.kind).slice(1);
  // The command group stays one line; the subagents' rows show, then Working….
  expect(live()).toEqual(["grp", "grp", "call", "call", "wspin"]);
  const grp = () => v.rows().find((r) => r.kind === "grp" && r.step.agent);
  expect(v.rowDetail(grp()).replace(/^grp#\d+ /, "")).toBe("Running 2 subagents · 2 working [open]");
  // One more starts: its row joins the block.
  apply(s, { k: "u", n: "Agent", id: "toolu_d" });
  s.version++;
  expect(live()).toEqual(["grp", "grp", "call", "call", "call", "wspin"]);
  // The person closes it: it stays closed while the turn runs.
  v.click(grp().key, cx);
  expect(live()).toEqual(["grp", "grp", "wspin"]);
  apply(s, { k: "n", a: "a1", st: "completed", ms: 3000 });
  s.version++;
  expect(live()).toEqual(["grp", "grp", "wspin"]);
  // Opened again by the person, and closed by ←.
  v.click(grp().key, cx);
  expect(live()).toContain("call");
  v.sel = a;
  v.shallower(cx);
  expect(live()).not.toContain("call");
  // Done: a finished turn's work is closed, and opened, its subagent block is one line.
  apply(s, { k: "t", t: "Started three reviews." });
  apply(s, { k: "d", ms: 9000, ts: at(1) });
  s.version++;
  v.status = st;
  v.rowsKey = null;
  // The person's choices above would stay; forget them to see the finished turn's default.
  v.groupTouched.clear();
  v.groupOpen.clear();
  v.sel = a;
  if (!v.open.has(a)) v.action("open", cx);
  v.click(`rhead:${a}`, cx);
  expect(live().filter((k) => k === "call")).toEqual([]);
  expect(v.rowDetail(grp())).not.toContain("[open]");
});

test("a running turn is open while it runs: its steps arrive in order, the group still running says so, Working… closes it; it closes when done unless the person chose", async () => {
  const { apply } = await import("../mods/agent-threads/core/turns.js");
  const { v, s } = await scripted([
    { k: "p", o: "human", t: "Fix the cart total", ts: at(0) }, { k: "t", t: "Looking at the cart." }, { k: "u", n: "Read" }, { k: "u", n: "Bash" },
  ]);
  const a = "0:1";
  const st = v.status;
  v.status = () => "working";
  v.rowsKey = null;
  v.sel = null;
  const live = () => v.rows().filter((r) => r.turn && `${r.si}:${r.turn.n}` === a).map((r) => r.kind);
  expect(live()).toEqual(["wrow", "itext", "grp", "wspin"]);
  expect(v.rowDetail(v.rows().find((r) => r.key === `gp:${a}:1`))).toBe("grp#1 Reading 1 file and running 1 command");
  // Selecting the running turn swaps its row for the card, with the steps still after it.
  v.sel = a;
  expect(live()).toEqual(["working", "itext", "grp", "wspin"]);
  v.sel = null;
  // More text, then a call: the group before is done, a new one runs.
  apply(s, { k: "t", t: "Now the tests." });
  apply(s, { k: "u", n: "Bash" });
  s.version++;
  expect(live()).toEqual(["wrow", "itext", "grp", "itext", "grp", "wspin"]);
  expect(v.rowDetail(v.rows().find((r) => r.key === `gp:${a}:1`))).toBe("grp#1 Read 1 file and ran 1 command");
  expect(v.rowDetail(v.rows().find((r) => r.key === `gp:${a}:3`))).toBe("grp#1 Running 1 command");
  // Text after the last call: nothing runs, so no group says Running.
  apply(s, { k: "t", t: "Fixed." });
  s.version++;
  expect(v.rowDetail(v.rows().find((r) => r.key === `gp:${a}:3`))).toBe("grp#1 Ran 1 command");
  // Waiting for the person: no Working… line.
  v.status = () => "blocked";
  v.rowsKey = null;
  expect(live()).not.toContain("wspin");
  v.status = () => "working";
  // Done: the line closes, and the turn reads as a finished row.
  apply(s, { k: "d", ms: 48000, ts: at(1) });
  s.version++;
  v.status = st;
  v.rowsKey = null;
  expect(live()).toEqual(["turn"]);
  expect(v.lineIsOpen(a, false)).toBe(false);
  // A turn the person opened by hand while it ran stays open after; closed stays closed.
  const r2 = await scripted([{ k: "p", o: "human", t: "Again", ts: at(0) }, { k: "u", n: "Bash" }]);
  r2.v.status = () => "working";
  r2.v.sel = a;
  r2.v.action("shallower", r2.cx);
  expect(r2.v.lineIsOpen(a, true)).toBe(false);
  expect(r2.v.rows().filter((r) => r.turn).map((r) => r.kind)).toEqual(["working"]);
  r2.v.action("deeper", r2.cx);
  expect(r2.v.lineIsOpen(a, true)).toBe(true);
  apply(r2.s, { k: "t", t: "Done." });
  apply(r2.s, { k: "d", ms: 900, ts: at(1) });
  expect(r2.v.lineIsOpen(a, false)).toBe(true);
});

test("level 3: an open group reads its calls from the transcript, in memory; a call opens to its output; a failed call is red; → and ← reach it", async () => {
  // A small synthetic Claude Code transcript: a command with 30 lines of output, a failed
  // command, then a group of one read.
  const dir = mkdtempSync(join(tmpdir(), "threads-calls-"));
  const file = join(dir, "00000000-0000-4000-8000-00000000000c.jsonl");
  const ts = (s) => `2026-11-01T09:00:${String(s).padStart(2, "0")}.000Z`;
  const use = (id, name, input, s) => ({ type: "assistant", timestamp: ts(s), message: { id: `msg_${id}`, role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
  const res = (id, content, s, err = false) => ({ type: "user", timestamp: ts(s), message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: err }] } });
  const long = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
  const lines = [use("toolu_a1", "Bash", { command: "bun test cart" }, 1), res("toolu_a1", long, 3),
    use("toolu_a2", "Bash", { command: "bun run lint" }, 4), res("toolu_a2", "lint: 2 errors", 5, true),
    use("toolu_a3", "Read", { file_path: "src/cart.ts" }, 7), res("toolu_a3", "export const total = 1;", 7)];
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  const { newSession, apply } = await import("../mods/agent-threads/core/turns.js");
  const { v, cx } = await pane(fixture("--only", "1"));
  const s = newSession("00000000-0000-4000-8000-00000000000c", file);
  for (const e of [{ k: "p", o: "human", t: "Fix the cart total", ts: ts(0) },
    { k: "u", n: "Bash", id: "toolu_a1" }, { k: "u", n: "Bash", id: "toolu_a2" },
    { k: "t", t: "Lint failed; reading the file." }, { k: "u", n: "Read", id: "toolu_a3" },
    { k: "t", t: "Fixed." }, { k: "d", ms: 9000, ts: ts(9) }]) apply(s, e);
  s.loaded = true;
  v.sessions = [s];
  cx.pending = [];
  const a = "0:1";
  const settled = async () => { for (let i = 0; i < 6; i++) { draw(v, cx); cx.flush(0); await settleCx(cx); } };
  v.sel = a;
  v.action("deeper", cx);
  // Nothing is read while the groups are closed.
  await settled();
  expect(v.calls.size).toBe(0);
  const detail = (k) => v.rowDetail(v.rows().find((r) => r.key === k));
  expect(detail(`gp:${a}:0`)).toBe("grp#1 Ran 2 commands");
  // → opens the groups: their calls are read, each row shows what it ran and how long it took.
  v.action("deeper", cx);
  await settled();
  expect([...v.calls.keys()].sort()).toEqual(["toolu_a1", "toolu_a2", "toolu_a3"].map((id) => `${file}#${id}`));
  expect(detail(`cl:${a}:0:0`)).toBe("call#1 bun test cart · 2s [closed]");
  expect(detail(`cl:${a}:0:1`)).toBe("call#1 bun run lint · 1s [failed] [closed]");
  // A failed call marks its group too, in the blocked colour.
  expect(detail(`gp:${a}:0`)).toBe("grp#1 Ran 2 commands · 1 failed [failed] [open]");
  rec = []; v.partContent?.(theme, v.rows().find((r) => r.key === `cl:${a}:0:1`)); const c1 = rec; rec = null;
  if (v.partContent) {
    expect(c1.some((e) => e[0] === "svg" && String(e[1]).endsWith("circle-x.svg"))).toBe(true);
    expect(c1.some((e) => e[0] === "text_color" && e[1] === theme.blocked)).toBe(true);
  }
  // A group of one, open, is the call's own row, with no group line over it.
  expect(v.rows().some((r) => r.key === `gp:${a}:2`)).toBe(false);
  expect(detail(`cl:${a}:2:0`)).toBe("call#1 one src/cart.ts · <0.1s [closed]");
  // A click on a call opens its output: its lines wrap, in a box 12 rows tall that does not
  // scroll (the lines run on, cut, at their full height), and Show all under it is its own
  // list item.
  v.click(`cl:${a}:0:0`, cx);
  expect(detail(`co:${a}:0:0`)).toMatch(/^cout#1 ok lines 30\/30 plain h\d+ \| line 1 ⏎ line 2 ⏎ line 3$/);
  const box = v.rows().find((r) => r.key === `co:${a}:0:0`);
  expect(box).toMatchObject({ rows: 30, shown: 12 });
  expect(v.height(box)).toBe(8 * 2 + 2 + 12 * 16 + 4);
  rec = []; v.partContent(theme, box, false); const bc = rec; rec = null;
  expect(bc.some((e) => ["overflow_scroll", "overflow_x_scroll", "overflow_y_scrollbar", "whitespace_nowrap"].includes(e[0]))).toBe(false);
  expect(bc.some((e) => e[0] === "h" && e[1] === 30 * 16)).toBe(true);
  const all = v.rows().find((r) => r.key === `oa:${a}:0:0`);
  expect(all).toMatchObject({ kind: "oall", left: 18, all: false });
  expect(v.height(all)).toBe(26);
  rec = []; v.partContent(theme, all, false); const ac = rec; rec = null;
  expect(ac.some((e) => e[0] === "child" && e[1] === "Show all · 18 more rows")).toBe(true);
  // A click on the box only selects its turn.
  v.click(`co:${a}:0:0`, cx);
  expect(detail(`co:${a}:0:0`)).toMatch(/lines 30\/30/);
  expect(v.rows().find((r) => r.key === `co:${a}:0:0`).shown).toBe(12);
  // Show all shows every row in place; Show less goes back to 12.
  v.click(`oa:${a}:0:0`, cx);
  const opened = v.rows().find((r) => r.key === `co:${a}:0:0`);
  expect(opened.shown).toBe(30);
  expect(v.height(opened)).toBe(8 * 2 + 2 + 30 * 16 + 4);
  expect(v.rows().find((r) => r.key === `oa:${a}:0:0`)).toMatchObject({ all: true });
  v.click(`oa:${a}:0:0`, cx);
  expect(v.rows().find((r) => r.key === `co:${a}:0:0`).shown).toBe(12);
  // → opens every call's output; ← closes the outputs, then the groups.
  v.action("deeper", cx);
  expect(v.rows().filter((r) => r.kind === "cout").length).toBe(3);
  expect(detail(`co:${a}:0:1`)).toMatch(/^cout#1 ok lines 1\/1 plain h\d+ \| lint: 2 errors$/);
  // The read file has a known extension: between frames its output gets a read-only editor
  // that colours it as js and wraps; plain text stays plain.
  const before = editors.length;
  draw(v, cx);
  cx.flush(0);
  draw(v, cx);
  const ed = editors.slice(before).find((e) => e.opts.language === "js");
  expect(ed?.opts).toMatchObject({ readonly: true, soft_wrap: true, value: "export const total = 1;" });
  expect(detail(`co:${a}:2:0`)).toMatch(/ editor js h\d+/);
  expect(detail(`co:${a}:0:1`)).toMatch(/ plain h\d+/);
  v.action("shallower", cx);
  expect(v.rows().some((r) => r.kind === "cout")).toBe(false);
  expect(v.rows().some((r) => r.kind === "call")).toBe(true);
  v.action("shallower", cx);
  expect(v.rows().some((r) => r.kind === "call")).toBe(false);
  // The reads are kept in memory only: nothing was written beside the transcript.
  expect(readdirSync(dir)).toEqual(["00000000-0000-4000-8000-00000000000c.jsonl"]);
  // Agents whose calls are not read yet keep level 2: no output, and a click only selects.
  const { NOT_A_PLACE } = await import("../mods/agent-threads/pins.js");
  expect(NOT_A_PLACE.has("co")).toBe(true);
  draw(v, cx);
});

test("level 3: a group claims no check or red mark until its calls are read; once read it keeps the check, or the red mark and how many failed", async () => {
  // Two groups: one with a failed command, one where every call worked.
  const dir = mkdtempSync(join(tmpdir(), "threads-calls-"));
  const file = join(dir, "00000000-0000-4000-8000-00000000000e.jsonl");
  const ts = (s) => `2026-11-01T09:00:${String(s).padStart(2, "0")}.000Z`;
  const use = (id, name, input, s) => ({ type: "assistant", timestamp: ts(s), message: { id: `msg_${id}`, role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
  const res = (id, content, s, err = false) => ({ type: "user", timestamp: ts(s), message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: err }] } });
  const lines = [use("toolu_e1", "Bash", { command: "bun test" }, 1), res("toolu_e1", "ok", 2),
    use("toolu_e2", "Bash", { command: "bun run lint" }, 3), res("toolu_e2", "lint: 2 errors", 4, true),
    use("toolu_e3", "Bash", { command: "bun run lint --fix" }, 5), res("toolu_e3", "fixed", 6),
    use("toolu_e4", "Bash", { command: "bun run lint" }, 7), res("toolu_e4", "clean", 8)];
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  const { newSession, apply } = await import("../mods/agent-threads/core/turns.js");
  const { v, cx } = await pane(fixture("--only", "1"));
  const s = newSession("00000000-0000-4000-8000-00000000000e", file);
  for (const e of [{ k: "p", o: "human", t: "Fix the lint", ts: ts(0) },
    { k: "u", n: "Bash", id: "toolu_e1" }, { k: "u", n: "Bash", id: "toolu_e2" },
    { k: "t", t: "Lint failed; fixing it." }, { k: "u", n: "Bash", id: "toolu_e3" }, { k: "u", n: "Bash", id: "toolu_e4" },
    { k: "t", t: "Fixed." }, { k: "d", ms: 9000, ts: ts(9) }]) apply(s, e);
  s.loaded = true;
  v.sessions = [s];
  cx.pending = [];
  const a = "0:1";
  const settled = async () => { for (let i = 0; i < 6; i++) { draw(v, cx); cx.flush(0); await settleCx(cx); } };
  const detail = (k) => v.rowDetail(v.rows().find((r) => r.key === k));
  const icons = (k) => {
    rec = []; v.partContent?.(theme, v.rows().find((r) => r.key === k)); const c = rec; rec = null;
    return { svgs: c.filter((e) => e[0] === "svg").map((e) => String(e[1]).split("/").pop()), red: c.some((e) => e[0] === "text_color" && e[1] === theme.blocked), text: c.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]) };
  };
  v.sel = a;
  v.action("deeper", cx);
  await settled();
  // Not read yet: the tool icon and "Ran N commands", with no check and nothing red.
  expect(v.calls.size).toBe(0);
  expect(detail(`gp:${a}:0`)).toBe("grp#1 Ran 2 commands");
  expect(detail(`gp:${a}:2`)).toBe("grp#1 Ran 2 commands");
  if (v.partContent) {
    for (const k of [`gp:${a}:0`, `gp:${a}:2`]) {
      const g = icons(k);
      expect(g.svgs).toContain("wrench.svg");
      expect(g.svgs).not.toContain("check.svg");
      expect(g.svgs).not.toContain("circle-x.svg");
      expect(g.red).toBe(false);
    }
  }
  // Opened, the calls are read: the failed group has the red mark and "1 failed", the other a check.
  v.action("deeper", cx);
  await settled();
  expect(v.calls.size).toBe(4);
  expect(detail(`gp:${a}:0`)).toBe("grp#1 Ran 2 commands · 1 failed [failed] [open]");
  expect(detail(`gp:${a}:2`)).toBe("grp#1 Ran 2 commands [ok] [open]");
  // Closed again, they keep it while the calls stay in memory.
  v.action("shallower", cx);
  expect(detail(`gp:${a}:0`)).toBe("grp#1 Ran 2 commands · 1 failed [failed]");
  expect(detail(`gp:${a}:2`)).toBe("grp#1 Ran 2 commands [ok]");
  if (v.partContent) {
    const f = icons(`gp:${a}:0`);
    expect(f.svgs).toContain("circle-x.svg");
    expect(f.red).toBe(true);
    expect(f.text).toContain("· 1 failed");
    const ok = icons(`gp:${a}:2`);
    expect(ok.svgs).toContain("check.svg");
    expect(ok.svgs).not.toContain("wrench.svg");
    expect(ok.red).toBe(false);
  }
});

test("level 3 while a turn runs: the running group names what runs now; an open call read before its output reads it again once the session grows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-calls-"));
  const file = join(dir, "00000000-0000-4000-8000-00000000000d.jsonl");
  const ts = (s) => new Date(Date.now() - 60000 + s * 1000).toISOString();
  const use = { type: "assistant", timestamp: ts(1), message: { id: "msg_b1", role: "assistant", content: [{ type: "tool_use", id: "toolu_b1", name: "Bash", input: { command: "bun run e2e" } }] } };
  writeFileSync(file, `${JSON.stringify(use)}\n`);
  const { newSession, apply } = await import("../mods/agent-threads/core/turns.js");
  const { v, cx } = await pane(fixture("--only", "1"));
  const s = newSession("00000000-0000-4000-8000-00000000000d", file);
  apply(s, { k: "p", o: "human", t: "Run the e2e suite", ts: ts(0) });
  apply(s, { k: "u", n: "Bash", id: "toolu_b1" });
  s.loaded = true;
  v.sessions = [s];
  cx.pending = [];
  v.statusNow = "working";
  v.status = () => "working";
  const a = "0:1";
  const settled = async () => { for (let i = 0; i < 6; i++) { draw(v, cx); cx.flush(0); await settleCx(cx); } };
  await settled();
  const detail = (k) => v.rowDetail(v.rows().find((r) => r.key === k));
  // The running turn's line is open: its group says it runs, and what, from the file's end.
  expect(detail(`gp:${a}:0`)).toBe("grp#1 Running 1 command · bun run e2e");
  // Opened, the group of one is its call's row, still running, with no output yet.
  v.click(`gp:${a}:0`, cx);
  await settled();
  expect(detail(`cl:${a}:0:0`)).toBe("call#1 one bun run e2e [closed]");
  v.click(`cl:${a}:0:0`, cx);
  await settled();
  expect(detail(`co:${a}:0:0`)).toMatch(/^cout#1 ok running lines 0\/0 /);
  // Its box says so, not "No output".
  expect(v.rows().find((r) => r.key === `co:${a}:0:0`).going).toBe(true);
  // The output arrives: once the session grows, the open call is read again.
  const res = { type: "user", timestamp: ts(20), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_b1", content: "12 passed" }] } };
  writeFileSync(file, `${JSON.stringify(use)}\n${JSON.stringify(res)}\n`);
  s.version = (s.version ?? 0) + 1;
  await settled();
  expect(detail(`cl:${a}:0:0`)).toBe("call#1 one bun run e2e · 19s [open]");
  expect(detail(`co:${a}:0:0`)).toMatch(/^cout#1 ok lines 1\/1 plain h\d+ \| 12 passed$/);
  draw(v, cx);
});

test("the floating top: no header row, the state top left at every width, icons only with the pointer or the keyboard, the rest in settings", async () => {
  const { v, cx } = await pane(fixture("--extra", "30"));
  v.width = 545;
  v.listH = 400;
  v.h.is_focused = () => false;
  state.terminals[0].status = "idle";
  draw(v, cx);
  expect(v.floating()).toBe(true);
  const drawn = () => { rec = []; v.render(cx); const c = rec; rec = null; return c; };
  const idsOf = (calls) => calls.filter((e) => e[0] === "id").map((e) => e[1]);
  let ids = idsOf(drawn());
  // No header row: no badge and no header text. The state is there, and no icons at rest.
  expect(ids).not.toContain("th-badge");
  expect(ids).toContain("th-state");
  expect(ids).not.toContain("th-search");
  expect(ids).not.toContain("th-settings");
  // The floating top is drawn after the list's box, so it sits over the list.
  expect(ids.indexOf("th-float")).toBeGreaterThan(ids.indexOf("threads-listbox"));
  // The list starts TOP_BAND down, so its first row is not under the state.
  expect(v.rows()[0].kind).toBe("gap");
  expect(v.rows()[0].h).toBe(32);
  // The state keeps its word under 440 px too (the header put a dot on the badge there).
  v.width = 380;
  const strs = (calls) => calls.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
  let calls = drawn();
  expect(idsOf(calls)).toContain("th-state");
  expect(strs(calls)).toContain("Done");
  v.width = 545;
  // Its tooltip names the terminal and session, as the badge's did, and a click goes to the terminal.
  const at = calls.findIndex((e) => e[0] === "id" && e[1] === "th-state");
  const tip = calls.slice(at, at + 14).find((e) => e[0] === "tooltip")?.[1];
  expect(tip).toMatch(/^Claude finished its newest turn · click to go to the terminal \(t\) · .*Reading t4 · session /);
  // The pointer in the pane, or the keyboard in the panel: search, pinned and settings, in that order.
  v.paneHover = true;
  ids = idsOf(drawn());
  expect(["th-search", "th-pinned", "th-settings"].map((id) => ids.indexOf(id)).every((x, i, a) => x > 0 && (i === 0 || x > a[i - 1]))).toBe(true);
  expect(v.floatButtons().map((b) => [b[0], b[1], b[2].split(" (")[0]])).toEqual([["th-search", "search", "Search"], ["th-pinned", "pin", "Open the Pinned column beside Threads"], ["th-settings", "sliders-horizontal", "Settings"]]);
  v.paneHover = false;
  v.h.is_focused = () => true;
  expect(idsOf(drawn())).toContain("th-settings");
  v.h.is_focused = () => false;
  // Settings open: a card over the list, not in its flow (the list does not move), with the
  // agent, the counts and the title at its foot.
  v.settingsOpen = true;
  calls = drawn();
  ids = idsOf(calls);
  expect(ids).not.toContain("th-top");
  expect(ids.indexOf("th-set-card")).toBeGreaterThan(ids.indexOf("threads-listbox"));
  expect(ids.indexOf("th-about")).toBeGreaterThan(ids.indexOf("th-set-card"));
  expect(strs(calls).some((x) => /^\d+ turns/.test(x))).toBe(true);
  v.settingsOpen = false;
  // A search field opens under the band too.
  v.filtering = true;
  ids = idsOf(drawn());
  expect(ids.indexOf("th-search-field")).toBeGreaterThan(ids.indexOf("th-top"));
  v.filtering = false;
  // The Pinned view keeps its header and has no floating top.
  v.view = "pinned";
  ids = idsOf(drawn());
  expect(ids).not.toContain("th-float");
  expect(ids).toContain("th-pinned-heading");
});

test("the floating top's fade is painted as a gradient where Herdr can, and in steps of alpha before that", async () => {
  const { v } = await pane(fixture("--only", "3"));
  const calls = () => { rec = []; v.fadeLayer(theme); const c = rec; rec = null; return c; };
  // The test stubs have no PathBuilder: the steps.
  expect(calls().some((e) => e[0] === "id" && e[1] === "th-fade-steps")).toBe(true);
  const src = readFileSync(new URL("../mods/agent-threads/main.js", import.meta.url), "utf8");
  expect(src).toContain("bg.linear_gradient(180, bg.stop(t.background, 55), bg.stop(alpha(t.background, 0), 100))");
});

test("a scroll to a closed turn with pasted images lands on its tiles, the item over its row", async () => {
  const { v, cx } = await pane(fixture("--extra", "6", "--images"));
  v.width = 545;
  v.listH = 400;
  draw(v, cx);
  const two = v.current().turns.find((t) => t.images.length === 2);
  const key = `0:${two.n}`;
  const rows = v.rows();
  const tiles = rows.findIndex((r) => r.key === `imgs:${key}`);
  expect(rows[tiles + 1].key).toBe(key);
  for (const how of ["land", "head"]) {
    const scrolled = [];
    v.scroll = { scroll_to_item: (i, h) => scrolled.push([i, h]), scroll_to_bottom() {} };
    v.scrollTo = { key, how };
    cx.timers = [];
    draw(v, cx);
    cx.flush();
    // The tiles' top just under the floating top (landExact when no earlier item fits).
    const minTop = v.floating() ? 32 : 0;
    expect(v.landed).toMatchObject({ key: `imgs:${key}`, y: minTop });
    expect(scrolled.at(-1)).toEqual([v.landed.j, "top"]);
    expect(v.slotsMemo.slice(v.landed.j, tiles).reduce((x, n) => x + n, 0) - (v.landed.lift ?? 0)).toBe(minTop);
  }
});

test("level 3 lines draw paths from the terminal's working folder, or from ~, and only the drawing changes", async () => {
  const { v } = await pane(fixture("--only", "1"));
  v.res = { ...v.res, cwd: "/home/test/acme-web" };
  expect(v.short("Read /home/test/acme-web/src/admin/export.ts")).toBe("Read src/admin/export.ts");
  expect(v.short("/home/test/notes/a.md")).toBe("~/notes/a.md");
  // Pinned to a transcript (no folder from the search): the terminal's own folder.
  v.res = { ...v.res, cwd: null };
  const term = state.terminals.find((x) => x.address === v.terminal);
  const was = term.cwd;
  term.cwd = "/home/test/acme-web";
  expect(v.short("/home/test/acme-web/src/a.ts")).toBe("src/a.ts");
  term.cwd = null;
  expect(v.short("/home/test/acme-web/src/a.ts")).toBe("~/acme-web/src/a.ts");
  term.cwd = was;
  // The call line, the group's current call and each output line go through it; the
  // transcript and the call entries keep the full text.
  const src = readFileSync(new URL("../mods/agent-threads/main.js", import.meta.url), "utf8");
  expect(src).toContain("wrapCap(this.short(callText(r.name, c?.input))");
  expect(src).toContain("current: last?.input ? this.short(callText(");
  expect(src).toContain(".child(this.short(l) || \" \")");
});

// Herdr stops a draw that runs past its time (about 50 ms on an M-series Mac) and shows "This
// view could not be re-rendered" until a draw fits. In a session of 2,000 turns every draw
// came near that, so one click more went over.
test("draw time: a session of 2,000 turns draws well inside Herdr's time, and reads Herdr's state a few times a draw", { timeout: 120000 }, async () => {
  const { v, cx } = await pane(fixture("--extra", "2000"));
  expect(v.current().turns.length).toBeGreaterThan(2000);
  v.width = 560; v.rootH = 1100; v.listH = 1000;
  v.debug = false;
  const turns = v.current().turns;
  for (const t of turns.slice(-4, -1)) { const k = `0:${t.n}`; v.open.add(k); v.lineOpen.add(k); v.lineTouched.add(k); }
  v.sel = `0:${turns.at(-1).n}`;
  // Frames until every row is shaped and every part measured, as Herdr's next frames do.
  for (let i = 0; i < 30; i++) {
    v.render(cx);
    if (!(v.shapeLeft > 0) && !(v.probeLeft > 0)) break;
    if (v.shapeLeft > 0) v.rowsKey = null;
  }
  // Herdr's reads, per draw with nothing changed: none per turn. (Here the list draws all of
  // its rows; before the fix this was over 4,000 reads of the settings and 6,000 of panes.)
  for (const k in hostReads) hostReads[k] = 0;
  v.render(cx);
  expect(hostReads.settings).toBeLessThan(100);
  expect(hostReads.panes + hostReads.terminals).toBeLessThan(100);
  // Time, as the best of five, against shares of Herdr's 50 ms: a draw with nothing changed
  // under a fifth, a draw that rebuilds the rows under a half. bun runs this faster than
  // Herdr does, so these are generous; the reads above are the exact check.
  // The list draws the rows of one screen at its end, as Herdr does.
  listWindow = (n) => ({ start: Math.max(0, n - 14), end: n });
  const best = (fn) => { let b = Infinity; for (let i = 0; i < 5; i++) { const a = performance.now(); fn(); b = Math.min(b, performance.now() - a); } return b; };
  const still = best(() => v.render(cx));
  const rebuild = best(() => { v.rowsKey = null; v.render(cx); });
  listWindow = null;
  expect(still).toBeLessThan(10);
  expect(rebuild).toBeLessThan(25);
});

test("a reply's table may run wider than the reading line, centred on it, up to the pane less its gutters, open or closed", async () => {
  const { v, cx } = await pane(fixture("--extra", "3"));
  v.paneW = 1400;
  draw(v, cx);
  const keys = v.turnKeys(v.rows());
  const key = keys.at(-2);
  const turn = v.findTurn(key);
  const table = [
    "| Region | Service | Current | Target | Owner and rotation | Notes for the change window |",
    "|---|---|---|---|---|---|",
    "| us-east-1 | checkout-api | 4.12.3 | 4.13.0 | Payments platform, rotation A | Drain traffic through the canary pool first |",
  ].join("\n");
  turn.after = [`Here is the plan:\n\n${table}\n\nWhich region first?`];
  turn.shapeKey = null;
  v.rowsKey = null;
  draw(v, cx);
  const extraOf = (row) => v.tableExtra(row);
  // Closed: the turn's reply draws its table as a block of its own, wider by extra, half of
  // it on each side.
  let rows = v.rows();
  const closed = rows.find((r) => r.kind === "turn" && r.key === key);
  const extra = extraOf(closed);
  expect(v.pw()).toBeGreaterThan(v.width);
  expect(extra).toBeGreaterThan(0);
  expect(extra % 2).toBe(0);
  // Never past the pane: half fits beside the column on each side, less the gutter.
  // Clear of the rail's lane too, on both sides.
  const lane = v.railShown() ? 32 : 0;
  expect(v.railShown()).toBe(true);
  expect(extra / 2).toBeLessThanOrEqual(v.colLeft() - lane);
  expect(v.colLeft() + ROW.PAD_X + v.prose() + extra / 2).toBeLessThanOrEqual(v.pw() - ROW.PAD_X - lane);
  let at = rows.indexOf(closed);
  rec = [];
  v.listItems(theme, rows, rows.map(() => 400), { start: at, end: at + 1 }, true, false);
  let drawn = rec;
  rec = null;
  expect(drawn).toContainEqual(["w", v.prose() + extra]);
  expect(drawn).toContainEqual(["ml", -extra / 2]);
  // The item is wider by extra and padded by half on each side, so its other parts stay put.
  expect(drawn).toContainEqual(["max_w", v.width + extra]);
  expect(drawn).toContainEqual(["px", extra / 2]);
  // Open: the table is an item of its own, drawn the same way.
  v.open.add(key);
  v.rowsKey = null;
  draw(v, cx);
  rows = v.rows();
  const md = rows.filter((r) => r.kind === "md" && r.key.startsWith(`md:${key}:`));
  expect(md.map((r) => Boolean(r.table))).toEqual([false, true, false]);
  expect(md[1].src).toBe(table);
  expect(extraOf(md[1])).toBe(extra);
  expect(extraOf(md[0])).toBe(0);
  at = rows.indexOf(md[1]);
  rec = [];
  v.listItems(theme, rows, rows.map(() => 400), { start: at, end: at + 1 }, true, false);
  drawn = rec;
  rec = null;
  expect(drawn).toContainEqual(["w", v.prose() + extra]);
  expect(v.partSig(md[1])).toContain(`|t${extra}`);
  // A pane no wider than the column leaves the table on the reading line.
  v.paneW = v.width;
  expect(extraOf(md[1])).toBe(0);
});

test("the rail's window: 9 px a tick in a long session, at most 540 px, following the list, faded ends, dots for a pin or the running turn past an end", async () => {
  const { v, cx, keys } = await pinPane("--only", "150", "--gap", "600");
  v.listH = 900;
  draw(v, cx);
  const ks = keys();
  expect(ks.length).toBe(150);
  // Pin an early turn, then follow the newest turn: the window rests at the end.
  v.sel = ks[5];
  v.action("pin", cx);
  v.sel = ks.at(-1);
  v.follow = true;
  let w = v.railTicks();
  expect(w.cut).toBe(true);
  expect(w.ticks.length).toBeLessThanOrEqual(58);
  expect(w.ticks.at(-1).key).toBe(ks.at(-1));
  expect(w.ticks.every((k) => k.turns.length === 1)).toBe(true);
  // The top end is cut, so its three ticks fade; the bottom is the real last turn.
  expect(w.ticks.slice(0, 3).map((k) => k.fade)).toEqual([0.25, 0.5, 0.75]);
  expect(w.ticks.at(-1).fade).toBe(1);
  // The pin above the window shows as a dot there.
  expect(w.dotTop).toEqual({ i: 5, live: false });
  expect(w.dotBottom).toBe(null);
  // Only the window's ticks are drawn, with a row at each end.
  rec = []; v.railView(theme); const r = rec; rec = null;
  expect(r.filter((e) => e[0] === "id" && String(e[1]).startsWith("th-tick-") && !String(e[1]).startsWith("th-tick-card")).length).toBe(w.ticks.length);
  expect(r).toContainEqual(["id", "th-rail-up"]);
  // Each mark slides a change of width over 90 ms, natively (no timer in the mod).
  expect(r.filter((e) => e[0] === "transition" && e[1] === "width").length).toBe(w.ticks.length);
  expect(r).toContainEqual(["transition", "width", { duration: 90, easing: "ease-out" }]);
  expect(r).toContainEqual(["tooltip", `Pinned #${v.findTurn(ks[5]).n} above`]);
  // A press on the dot brings the pin into the window, and the list stays.
  const scroll = v.scrollTo;
  v.railReveal(5, cx);
  w = v.railTicks();
  expect(w.ticks.some((k) => k.i === 5)).toBe(true);
  expect(v.scrollTo).toBe(scroll);
  // It stays there until the list moves; then the window follows the list again.
  v.follow = false;
  drawRange(v, 100, 106);
  v.viewRange = [100, 106];
  w = v.railTicks();
  expect(w.ticks.some((k) => k.i === 5)).toBe(false);
  const on = w.ticks.filter((k) => k.inView).map((k) => k.i);
  expect(on.length).toBeGreaterThan(0);
  expect(Math.min(...on) - w.top).toBeGreaterThanOrEqual(RAIL.SPARE);
  // While the pointer is on the rail, the window holds where it is.
  const top = w.top;
  v.railOn = true;
  v.viewRange = [0, 4];
  expect(v.railTicks().top).toBe(top);
  v.railOn = false;
  expect(v.railTicks().top).toBe(0);
});

test("the wheel on the rail moves its window a tick at a time and stops there, so the list stays; the pointer on the card holds it too", async () => {
  const { v, cx, keys } = await pinPane("--only", "150", "--gap", "600");
  v.listH = 900;
  draw(v, cx);
  const ks = keys();
  v.sel = ks.at(-1);
  v.follow = true;
  const w = v.railTicks();
  const top = w.top;
  let stopped = 0;
  const wcx = { ...cx, stop_propagation() { stopped++; }, notify() {} };
  // The rail's handler is the one after its hover report.
  rec = []; v.railView(theme); const r = rec; rec = null;
  const wheel = r.find((e) => e[0] === "on_scroll_wheel")[1];
  // 9 px of upward travel is one tick earlier; 4 px is not yet one, and the rest carries.
  wheel({ delta: { x: 0, y: 4 }, touch_phase: "moved" }, wcx);
  expect(v.railTicks().top).toBe(top);
  wheel({ delta: { x: 0, y: 5 }, touch_phase: "moved" }, wcx);
  expect(v.railOn).toBe(true);
  expect(v.railTicks().top).toBe(top - 1);
  wheel({ delta: { x: 0, y: 27 }, touch_phase: "moved" }, wcx);
  expect(v.railTicks().top).toBe(top - 4);
  // A wheel that counts lines: a line a tick, down towards later turns.
  wheel({ delta: { x: 0, y: -40 }, delta_lines: { x: 0, y: -2 }, touch_phase: "moved" }, wcx);
  expect(v.railTicks().top).toBe(top - 2);
  expect(stopped).toBe(4);
  // The list did not move or stop following.
  expect(v.follow).toBe(true);
  // It never goes past either end.
  wheel({ delta: { x: 0, y: 9000 }, touch_phase: "moved" }, wcx);
  expect(v.railTicks().top).toBe(0);
  wheel({ delta: { x: 0, y: -9000 }, touch_phase: "moved" }, wcx);
  expect(v.railTicks().top).toBe(top);
  // Off the rail the window follows the list again.
  v.railOn = false;
  wheel({ delta: { x: 0, y: 90 }, touch_phase: "moved" }, wcx);
  v.railOn = false;
  expect(v.railTicks().top).toBe(top);
  // The pointer on a card holds the window, and the tick's hover leaving does not close it.
  v.railHover = ks[140];
  v.railCardOn = true;
  wheel({ delta: { x: 0, y: 90 }, touch_phase: "moved" }, wcx);
  v.railOn = false;
  expect(v.railTicks().top).toBe(top - 10);
  v.railCardOn = false;
  expect(v.railTicks().top).toBe(top);
  // A short session has nothing to move: the wheel goes on to the list.
  const short = await pinPane("--extra", "6");
  short.v.listH = 600;
  draw(short.v, short.cx);
  short.v.railTicks();
  stopped = 0;
  short.v.railWheel({ delta: { x: 0, y: 30 }, touch_phase: "moved" }, wcx);
  expect(stopped).toBe(0);
});

// The owner's choice A and B, 16 Nov: nothing inside the list scrolls on its own, since Herdr
// passes the wheel on to the list after an inner box uses it and a row cannot stop it. Code,
// a call's command and a tool's output wrap; a tall code block and a long output show their
// start and Show all, a list item of its own; an output longer than the panel holds opens in
// a viewer outside the list, whose output scrolls on its own and holds the wheel.
test("no list row scrolls on its own: code and commands wrap, Show all opens the rest in place, a long output opens a viewer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-inner-"));
  const file = join(dir, "00000000-0000-4000-8000-00000000000d.jsonl");
  const ts = (s) => `2026-11-01T09:00:${String(s).padStart(2, "0")}.000Z`;
  const use = (id, name, input, s) => ({ type: "assistant", timestamp: ts(s), message: { id: `msg_${id}`, role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
  const res = (id, content, s) => ({ type: "user", timestamp: ts(s), message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: false }] } });
  const longCmd = `cd ~/acme-web && ${"bun run build --filter=packages/checkout && ".repeat(14)}bun test`;
  const huge = Array.from({ length: 500 }, (_, i) => `ok ${i + 1} cart total rounds once`).join("\n");
  const lines = [use("toolu_b1", "Bash", { command: longCmd }, 1), res("toolu_b1", huge, 3),
    use("toolu_b2", "Bash", { command: "bun run lint" }, 4), res("toolu_b2", "a\nb\nc", 5)];
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  const { newSession, apply } = await import("../mods/agent-threads/core/turns.js");
  const { v, cx } = await pane(fixture("--only", "1"));
  const s = newSession("00000000-0000-4000-8000-00000000000d", file);
  const code = Array.from({ length: 30 }, (_, i) => `export const step${i} = ${i};`).join("\n");
  for (const e of [{ k: "p", o: "human", t: "Fix the cart total", ts: ts(0) },
    { k: "u", n: "Bash", id: "toolu_b1" }, { k: "u", n: "Bash", id: "toolu_b2" },
    { k: "t", t: `Done.\n\n\`\`\`js\n${code}\n\`\`\`` }, { k: "d", ms: 9000, ts: ts(9) }]) apply(s, e);
  s.loaded = true;
  v.sessions = [s];
  cx.pending = [];
  const a = "0:1";
  const settled = async () => { for (let i = 0; i < 6; i++) { draw(v, cx); cx.flush(0); await settleCx(cx); } };
  v.sel = a;
  v.toggle(a, cx);
  v.action("deeper", cx);
  await settled();
  v.action("deeper", cx);
  await settled();
  v.click(`cl:${a}:0:0`, cx);
  v.click(`cl:${a}:0:1`, cx);
  await settled();
  const rows = v.rows();
  const drawn = (r) => { rec = []; v.partContent(theme, r, false); const d = rec; rec = null; return d; };
  const scrolling = (d) => d.some(([n, x]) => ["overflow_scroll", "overflow_x_scroll", "overflow_y_scroll", "overflow_y_scrollbar", "overflow_x_scrollbar"].includes(n) || (n === "scrollable" && x === true));
  // Every row, everything open: no scrolling box, and no handler.
  for (const r of rows) {
    const d = drawn(r);
    expect([r.key, scrolling(d)]).toEqual([r.key, false]);
    expect([r.key, d.filter(([n]) => /^on_/.test(n)).map(([n]) => n)]).toEqual([r.key, []]);
  }
  // The long command wraps, up to 6 lines, its row as tall as its lines; the short one is one line.
  const long = rows.find((r) => r.kind === "call" && r.id === "toolu_b1");
  const sh = v.callShape(long);
  expect(sh.rows).toBe(6);
  expect(sh.text.endsWith("…")).toBe(true);
  expect(v.height(long)).toBe((long.one ? 4 + 22 : 20) + 5 * 16);
  const short = rows.find((r) => r.kind === "call" && r.id === "toolu_b2");
  expect(v.callShape(short).rows).toBe(1);
  expect(v.height(short)).toBe(short.one ? 4 + 22 : 20);
  // The 500-line output is more than the panel holds (400 lines): 12 rows, then a link to
  // open all of it in a viewer.
  const big = rows.find((r) => r.kind === "cout" && r.id === "toolu_b1");
  expect(big.shown).toBe(12);
  const link = rows.find((r) => r.kind === "oall" && r.id === "toolu_b1");
  expect(link).toMatchObject({ view: true, total: 500 });
  expect(drawn(link).some(([n, x]) => n === "child" && x === "Open all 500 lines in a viewer")).toBe(true);
  // The 3-line output needs no Show all.
  expect(rows.some((r) => r.kind === "oall" && r.id === "toolu_b2")).toBe(false);
  // The 30-line code block: 12 rows in view, the editor at its full height inside, then Show all.
  const box = rows.find((r) => r.kind === "code");
  expect(box).toMatchObject({ rows: 30, shown: 12, more: true });
  const bd = drawn(box);
  expect(bd.some(([n, x]) => n === "h" && x === 12 * 20 + 16)).toBe(true);
  expect(bd.some(([n, x]) => n === "h" && x === 30 * 20 + 16)).toBe(true);
  expect(bd.some(([n, x]) => n === "h" && x === 12 * 20 + 6)).toBe(true); // the clip ends at row 12
  const more = rows.find((r) => r.kind === "codeall");
  expect(drawn(more).some(([n, x]) => n === "child" && x === "Show all · 18 more rows")).toBe(true);
  v.click(more.key, cx);
  expect(v.rows().find((r) => r.key === box.key)).toMatchObject({ shown: 30, all: true });
  expect(v.height(v.rows().find((r) => r.key === box.key))).toBe(30 * 20 + 16);
  v.click(more.key, cx);
  expect(v.rows().find((r) => r.key === box.key).shown).toBe(12);
  // The link opens the output viewer outside the list.
  overlays.length = 0;
  v.click(link.key, cx);
  expect(overlays).toHaveLength(1);
  expect(overlays[0]).toMatchObject({ mod: "agent-threads", kind: "dialog", props: { output: { title: "#1 · Bash", lines: 500, total: 500 } } });
  expect(overlays[0].props.output.text).toBe(huge);
  // The viewer: the call, its line count, all of it in a read-only editor that wraps and numbers
  // its lines, in a box that holds the wheel; Esc closes it.
  state = { terminals: [], panes: [], shared: {}, props: { overlay: "ov9", output: overlays[0].props.output } };
  const g = new Threads();
  const gcx = makeCx();
  const before = editors.length;
  g.init(state.props, gcx);
  expect(editors.slice(before).at(-1).opts).toMatchObject({ readonly: true, soft_wrap: true, line_numbers: true, value: huge });
  rec = []; g.render(gcx); const gd = rec; rec = null;
  const texts = gd.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
  expect(texts).toContain("#1 · Bash");
  expect(texts).toContain("500 lines");
  expect(handlerAfterId(gd, "th-output-body", "on_scroll_wheel")).toBeTruthy();
  let stopped = false;
  handlerAfterId(gd, "th-output-body", "on_scroll_wheel")({}, { ...gcx, stop_propagation: () => { stopped = true; } });
  expect(stopped).toBe(true);
  handlerAfterId(gd, "th-output", "on_key_down")({ key: "escape" }, gcx);
  expect(closed).toContain("ov9");
  expect(() => g.close()).not.toThrow();
});

test("a rail click lands the turn level with its tick, clear of the floating top; a narrow pane hides the rail", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  v.paneW = Math.max(573, v.width + 80);
  v.listH = 600;
  draw(v, cx);
  const ks = keys();
  expect(v.railShown()).toBe(true);
  // The ticks are centred in the list's box, so the middle one is near the middle.
  const mid = ks[Math.floor(ks.length / 2)];
  expect(Math.abs(v.railTickY(mid) - 300)).toBeLessThan(60);
  const scrolled = [];
  v.scroll = { scroll_to_item: (i, how) => scrolled.push([i, how]), scroll_to_bottom() {} };
  v.railJump(mid, cx);
  const want = v.scrollTo.at;
  draw(v, cx);
  cx.flush();
  const rows = v.rows();
  const slots = v.slotsMemo;
  const head = rows.findIndex((r) => r.key === mid);
  const [j, how] = scrolled.at(-1);
  // Where the turn's top lands: under the items from j, or centred.
  const y = how === "center" ? (600 - slots[head]) / 2 : slots.slice(j, head).reduce((x, n) => x + n, 0);
  expect(y).toBeGreaterThanOrEqual(32);
  const best = Math.min(...[0, ...Array.from({ length: head }, (_, k) => slots.slice(head - 1 - k, head).reduce((x, n) => x + n, 0))]
    .filter((z) => z >= 32 && z + Math.min(slots[head], 48) <= 600).map((z) => Math.abs(z - want)));
  expect(Math.abs(y - want)).toBeLessThanOrEqual(best);
  // A pane too narrow for a whole Comfortable line hides the rail: 549 px at 14 px text.
  const { railMinPane } = await import("../mods/agent-threads/ui.js");
  expect(v.prefs.textSize).toBe(14);
  expect(railMinPane(14)).toBe(549);
  v.paneW = 548;
  expect(v.railShown()).toBe(false);
  v.paneW = 549;
  expect(v.railShown()).toBe(true);
  // The default pane at the reading width (573 px) keeps it.
  v.paneW = 573;
  expect(v.railShown()).toBe(true);
});

// The owner's fault on PR 73, 16 Nov: a click on a tick whose turn had a tall turn above it,
// and was itself taller than the pane, put the turn at the very top with its first lines
// under the top row. The list can only put an item's top at its top edge, and no earlier item
// started near the tick; the turn now lands level with it (landExact, one frame of lift).
test("a rail click lands a tall turn level with its tick when the turn above it is tall too", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  v.paneW = 675;
  v.listH = 1000;
  draw(v, cx);
  const ks = keys();
  const mid = ks[Math.floor(ks.length / 2)];
  const prev = ks[ks.indexOf(mid) - 1];
  // Both turns are long: a 30-line prompt each, and the one above with a long reply.
  for (const k of [prev, mid]) {
    const turn = v.findTurn(k);
    turn.prompt = Array.from({ length: 30 }, (_, i) => `line ${i + 1} of the long paste about the checkout total`).join("\n");
    turn.shapeKey = null;
  }
  v.rowsKey = null;
  draw(v, cx);
  let rows = v.rows();
  let slots = v.slotsMemo;
  const head = rows.findIndex((r) => r.key === mid);
  const want = Math.round(Math.max(32, v.railTickY(mid) - 8 - 10));
  // The case: the item above is taller than the room over the tick, and the turn is taller
  // than the pane, so no item's top lands within a line of the tick.
  expect(slots[head - 1]).toBeGreaterThan(want + 22);
  expect(slots[head]).toBeGreaterThan(1000 - want);
  const scrolled = [];
  v.scroll = { scroll_to_item: (i, how) => scrolled.push([i, how]), scroll_to_bottom() {} };
  cx.timers = [];
  v.railJump(mid, cx);
  draw(v, cx);
  expect(v.landed).toMatchObject({ key: mid, y: want, how: "top" });
  const { j, lift } = v.landed;
  expect(j).toBe(head - 1);
  expect(lift).toBe(slots[head - 1] - want);
  // The scroll to the earlier item comes with its lift on the first row, for that frame.
  const first = slots[0];
  cx.flush(48);
  expect(scrolled.at(-1)).toEqual([j, "top"]);
  expect(v.landLift).toBe(lift);
  draw(v, cx);
  expect(v.slotsMemo[0]).toBe(first + lift);
  // The list kept its offset in px (top of item j plus lift): with the lift gone, the turn's
  // top is want px down, the end of the turn above over it.
  cx.flush(120);
  expect(v.landLift).toBe(0);
  draw(v, cx);
  rows = v.rows();
  slots = v.slotsMemo;
  expect(slots[0]).toBe(first);
  const offset = slots.slice(0, j).reduce((x, n) => x + n, 0) + lift;
  const top = slots.slice(0, head).reduce((x, n) => x + n, 0);
  expect(top - offset).toBe(want);
});

test("landExact: the nearest earlier item at least want above, lifted by the rest", async () => {
  const { landExact } = await import("../mods/agent-threads/ui.js");
  // Item 3 to 300 px down: item 2 (40) is short of it, item 1 (40 + 600) past it by 340.
  expect(landExact([100, 600, 40, 900], 3, 300)).toEqual({ j: 1, how: "top", y: 300, lift: 340 });
  // An exact fit needs no lift.
  expect(landExact([100, 260, 40, 900], 3, 300)).toEqual({ j: 1, how: "top", y: 300, lift: 0 });
  // Want 0: the item itself at the top.
  expect(landExact([100, 600], 1, 0)).toEqual({ j: 1, how: "top", y: 0, lift: 0 });
  // Everything above is shorter than want: the list's start at the top.
  expect(landExact([50, 60, 900], 2, 300)).toEqual({ j: 0, how: "top", y: 110, lift: 0 });
});

test("Rail side lists Left on the left and Right on the right", async () => {
  const { v, cx } = await pinPane("--extra", "2");
  v.action("settings", cx);
  v.setTab = "general";
  rec = [];
  v.settingsCard(theme);
  const ids = rec.filter((e) => e[0] === "id" && /^th-rail-(left|right)$/.test(e[1])).map((e) => e[1]);
  const icons = rec.filter((e) => e[0] === "svg").map((e) => String(e[1]).split("/").pop());
  rec = null;
  expect(ids).toEqual(["th-rail-left", "th-rail-right"]);
  expect(icons).toEqual(expect.arrayContaining(["panel-left.svg", "panel-right.svg"]));
});

// The owner's experiment, 17 Nov: "If you clicked it, the line would briefly extend, then
// flash, and they would all fade out together so you see which one you clicked on."
test("a clicked rail tick grows, then shrinks back over the flash's fade, and both are dropped together", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  v.paneW = Math.max(573, v.width + 80);
  v.listH = 600;
  draw(v, cx);
  const ks = keys();
  const look = railLook(v.side());
  const mark = () => {
    rec = []; v.railView(theme); const r = rec; rec = null;
    const at = r.findIndex((e) => e[0] === "id" && e[1] === "th-mark-1");
    const calls = r.slice(at, at + 12);
    return { r, w: calls.find((e) => e[0] === "w")[1], tr: calls.find((e) => e[0] === "transition") };
  };
  const at = mark();
  const click = at.r.slice(at.r.findIndex((e) => e[0] === "id" && e[1] === "th-tick-1")).find((e) => e[0] === "on_click")[1];
  cx.timers = [];
  click({}, cx);
  // Out to the grow width at the usual slide.
  expect(v.railGrow).toEqual({ key: ks[1], on: true });
  let m = mark();
  expect(m.w).toBe(look.grow);
  expect(look.grow).toBe(v.side() < 40 ? 24 : 36);
  expect(m.tr).toEqual(["transition", "width", { duration: 90, easing: "ease-out" }]);
  // The scroll lands and flashes the turn; when the flash starts to fade, the tick shrinks back
  // over the same 1200 ms.
  cx.timers = [];
  v.flashTurn(ks[1], cx);
  cx.flush(140);
  expect(v.railGrow.on).toBe(true);
  cx.flush(180);
  expect(v.flash.on).toBe(false);
  expect(v.railGrow).toEqual({ key: ks[1], on: false });
  m = mark();
  expect(m.w).toBe(look.sel);
  expect(m.tr).toEqual(["transition", "width", { duration: 1200, easing: "ease-out" }]);
  // Both are dropped together.
  cx.flush(1500);
  expect(v.flash).toBe(null);
  expect(v.railGrow).toBe(null);
  expect(mark().tr).toEqual(["transition", "width", { duration: 90, easing: "ease-out" }]);
  // With no flash (the jump found nothing), the tick shrinks after 2 s and is dropped.
  cx.timers = [];
  click({}, cx);
  expect(v.railGrow.on).toBe(true);
  const keep = cx.timers.find((x) => x.ms === 2000);
  cx.timers = [];
  keep.fn(cx);
  expect(v.railGrow).toEqual({ key: ks[1], on: false });
  expect(cx.timers.map((x) => x.ms)).toEqual([1260]);
  cx.timers[0].fn(cx);
  expect(v.railGrow).toBe(null);
});

// The owner, 17 Nov: "it would be cool if the card went away when we click on it so it doesn't
// obscure what we're pulling up."
test("a click on a rail tick closes its card, and it stays closed while the pointer stays on that tick", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  v.paneW = Math.max(573, v.width + 80);
  v.listH = 600;
  draw(v, cx);
  const ks = keys();
  const handlers = () => {
    rec = []; v.railView(theme); const r = rec; rec = null;
    const hovers = r.filter((e) => e[0] === "on_hover").map((e) => e[1]).slice(1);
    const at = r.findIndex((e) => e[0] === "id" && e[1] === "th-tick-1");
    const click = r.slice(at).find((e) => e[0] === "on_click")[1];
    return { r, hovers, click };
  };
  let h = handlers();
  h.hovers[1](true, cx);
  expect(v.railHover).toBe(ks[1]);
  h = handlers();
  expect(h.r.some((e) => e[0] === "id" && e[1] === "th-rail-card")).toBe(true);
  // The pointer moved onto the card and back: the card's hover is on.
  v.railCardOn = true;
  h.click({}, cx);
  expect(v.railHover).toBe(null);
  expect(v.railCardOn).toBe(false);
  expect(v.sel).toBe(ks[1]);
  expect(v.scrollTo).toMatchObject({ key: ks[1], flash: true });
  h = handlers();
  expect(h.r.some((e) => e[0] === "id" && e[1] === "th-rail-card")).toBe(false);
  // A hover report for the same tick while the pointer is still on it does not reopen it.
  h.hovers[1](true, cx);
  expect(v.railHover).toBe(null);
  // Leaving the tick and coming back opens it as before; so does another tick.
  cx.timers = [];
  h.hovers[1](false, cx);
  expect(cx.timers.length).toBe(0);
  h.hovers[1](true, cx);
  expect(v.railHover).toBe(ks[1]);
  h.click({}, cx);
  expect(v.railHover).toBe(null);
  h.hovers[2](true, cx);
  expect(v.railHover).toBe(ks[2]);
});

// The owner's idea, 16 Nov: after a jump, the pair landed on gets a soft tint that fades out
// fast, to draw the eye to it. It changes no row and redraws nothing for the fade: Herdr runs
// the opacity transition itself.
test("a jump flashes the turn it lands on: an accent tint on its items, faded by a transition, then gone", async () => {
  const { v, cx, keys } = await pinPane("--extra", "4");
  draw(v, cx);
  const ks = keys();
  const key = ks[1];
  v.open = new Set([key]);
  v.rowsKey = null;
  draw(v, cx);
  v.scroll = { scroll_to_item() {}, scroll_to_bottom() {} };
  const rowsKey = v.rowsKey;
  cx.timers = [];
  v.railJump(key, cx);
  draw(v, cx);
  // Nothing before the scroll is done.
  expect(v.flash ?? null).toBe(null);
  const rows = v.rows();
  const mine = rows.map((r, i) => [r, i]).filter(([r]) => r.turn && `${r.si}:${r.turn.n}` === key).map(([, i]) => i);
  expect(mine.length).toBeGreaterThan(3); // an open turn: several items
  const layers = () => {
    rec = [];
    v.listItems(theme, rows, rows.map(() => 100), { start: 0, end: rows.length }, true, false);
    const c = rec; rec = null;
    return c.map((e, i) => [e, i]).filter(([e]) => e[0] === "id" && String(e[1]).startsWith("th-flash-")).map(([e, i]) => ({ id: e[1], calls: c.slice(i, i + 12) }));
  };
  cx.flush(140);
  expect(v.flash).toMatchObject({ key, on: true });
  let ls = layers();
  // One layer per item of that turn, and none on the others.
  expect(ls.length).toBe(mine.length);
  for (const l of ls) {
    expect(l.calls).toContainEqual(["bg", alphaForTest(theme.accent, 0.14)]);
    expect(l.calls).toContainEqual(["opacity", 1]);
    expect(l.calls).toContainEqual(["transition", "opacity", { duration: 1200, easing: "ease-out" }]);
  }
  cx.flush(180);
  expect(v.flash.on).toBe(false);
  ls = layers();
  for (const l of ls) expect(l.calls).toContainEqual(["opacity", 0]);
  cx.flush(900);
  expect(v.flash).not.toBe(null);
  cx.flush(1500);
  expect(v.flash).toBe(null);
  expect(layers()).toHaveLength(0);
  // The rows were never rebuilt for it.
  expect(v.rowsKey).toBe(rowsKey);
  // A pin return, #n in the search and Go to that reply flash too; a plain move does not.
  v.action("prev", cx);
  expect(v.scrollTo?.flash).toBeFalsy();
});

// The owner's fault, 16 Nov: a prompt typed while the agent worked (Claude Code queues it and
// writes it as a queued_command attachment) showed only its quote line, as plain text, while
// its turn ran and was selected.
test("a queued prompt that opens with a quote shows whole on the running turn's card, the quote behind its bar", async () => {
  const prompt = [
    "> The checkout total rounds each line before it sums them, so a cart of three items at 3.335 shows a cent more than the receipt does.",
    "I think the rounding should happen once, at the end, the way the receipt does it.",
    "Can you check where the line totals are built?",
    "",
    "The receipt code is in billing/receipt.ts and the cart code is in cart/total.ts.",
    "Both use the same money helper but call it at different points.",
    "Keep the helper as it is.",
    "",
    "Which of the two should change?",
  ].join("\n");
  const at = (s) => `2026-11-16T10:00:${String(s).padStart(2, "0")}.000Z`;
  const lines = [
    { type: "user", uuid: "u1", timestamp: at(0), sessionId: "s", origin: { kind: "human" }, message: { role: "user", content: "Fix the cart total" } },
    { type: "assistant", uuid: "a1", timestamp: at(5), sessionId: "s", message: { id: "m1", role: "assistant", stop_reason: "tool_use", content: [{ type: "text", text: "Looking at the cart." }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "cart/total.ts" } }] } },
    { type: "queue-operation", operation: "enqueue", timestamp: at(20), sessionId: "s", content: prompt },
    { type: "user", uuid: "u2", timestamp: at(25), sessionId: "s", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
    { type: "queue-operation", operation: "remove", timestamp: at(26), sessionId: "s", content: prompt },
    { type: "attachment", uuid: "q1", timestamp: at(26), sessionId: "s", attachment: { type: "queued_command", prompt, origin: { kind: "human" }, humanTurn: true, commandMode: "prompt" } },
  ];
  const dir = mkdtempSync(join(tmpdir(), "threads-queued-"));
  const file = join(dir, "q.jsonl");
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  const { v, cx } = await pane(file);
  draw(v, cx);
  const turn = v.current().turns.at(-1);
  // The reader keeps all of it.
  expect(turn.prompt).toBe(prompt);
  // Running and selected: the working card.
  const key = v.turnKeys(v.rows()).at(-1);
  v.sel = key;
  const r = v.rows().find((x) => x.key === key);
  expect(r.kind).toBe("working");
  v.prefs = { ...v.prefs, bubbleColor: "plain" }; // Markdown in the bubble: the plain look
  rec = [];
  views.length = 0;
  v.workingItem(theme, r);
  const drawn = rec;
  rec = null;
  // The open turn's YOU part, whole, as Markdown: the quote in full as a blockquote, and the
  // owner's three paragraphs kept apart (the closed row's lines ran them together).
  expect(drawn).toContainEqual(["TextView", `th-you-wyou:${key}`]);
  const md = views.find((x) => x.id === `th-you-wyou:${key}`).md.replace(/\\(?!\n)/g, "");
  for (const w of ["I think the rounding", "billing/receipt", "Keep the helper", "Which of the two should change?"]) expect(md).toContain(w);
  expect(md).toMatch(/^> /);
  expect(md.split(/\n{2,}/).length).toBeGreaterThanOrEqual(3);
  // Its height is the YOU part's: the probe's measure once it reports, the estimate till then.
  const y = v.workYou(r);
  const rest = 8 + 6 + 16 + 6 + 24 + 6 + v.workingGeom(r.turn, r.shape).note * 20 + 10;
  expect(v.estimate(r)).toBe(rest + v.youHeight(y));
  expect(v.probeRows.some((x) => x.key === `wyou:${key}`)).toBe(true);
  v.probed(`wyou:${key}`, v.partSig(y), { height: 300 * v.zoom() }, cx);
  expect(v.estimate(r)).toBe(rest + 300);
  // Not selected, it is the one-line row, and its message is still measured for the card.
  v.sel = null;
  expect(v.rows().find((x) => x.key === key).kind).toBe("wrow");
  expect(v.probeRows.some((x) => x.key === `wyou:${key}`)).toBe(true);
});

// The owner's fault, 16 Nov: the viewer drew a quote as "> " text. A run of quote lines is drawn as
// the bubble draws it: no marker, muted, behind one bar.
test("the image viewer draws a prompt's quote without its marker, muted, behind one bar beside the run", () => {
  const prompt = "> The chips wrap on tablet and the receipt line breaks.\n> They also clip on the phone.\nI think the width is fixed. [Image #41]\n\nWhich file sets it?";
  const { calls, size } = viewer({ turn: { ...VIEW_TURN, prompt } });
  size(1600, 1000);
  const drawn = calls();
  const strings = drawn.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
  const all = strings.join(" ");
  expect(all).toContain("The chips wrap on tablet");
  expect(all).toContain("They also clip on the phone.");
  expect(all).toContain("Which file sets it?");
  expect(strings.some((x) => /^ {0,3}>/.test(x))).toBe(false);
  // One bar for the run of two quote lines: an absolute box 2 px wide.
  const bars = drawn.filter((e, i) => e[0] === "absolute" && drawn.slice(i, i + 8).some((x) => x[0] === "w" && x[1] === 2));
  expect(bars.length).toBe(1);
  // The quote is in the bubble's muted ink; the person's own words in its ink.
  expect(drawn.some((e) => e[0] === "text_color" && e[1] === VIEW_TURN.sub)).toBe(true);
});

test("a rebuild keeps a closed turn's rows until the turn, its measures or the look change", async () => {
  const { v, cx } = await pane(fixture("--extra", "30"));
  for (let i = 0; i < 40; i++) draw(v, cx);
  const keys = v.turnKeys(v.rows());
  const rowOf = (k) => v.baseRows.find((r) => r.kind === "turn" && r.key === k);
  const sizeOf = (k) => v.baseSizes[v.baseRows.indexOf(rowOf(k))];
  const [a, b] = [keys.at(-10), keys.at(-6)];
  // A closed turn whose reply is Markdown, measured by the probe.
  const c = keys.slice(-5, -1).find((k) => rowOf(k)?.shape?.md != null);
  const before = { a: rowOf(a), b: rowOf(b), c: rowOf(c) };
  expect(before.a && before.b && before.c).toBeTruthy();
  // Opening another turn rebuilds the rows: the closed ones are the same objects.
  v.open.add(keys.at(-8));
  draw(v, cx);
  expect(rowOf(a)).toBe(before.a);
  expect(rowOf(b)).toBe(before.b);
  // The reader changed one turn (a new version): only that one is built again.
  const tb = v.findTurn(b);
  tb.after = [`${tb.after?.[0] ?? ""}\n\nOne more line from the agent.`];
  tb.v += 1;
  v.open.delete(keys.at(-8));
  draw(v, cx);
  expect(rowOf(a)).toBe(before.a);
  expect(rowOf(b)).not.toBe(before.b);
  expect(rowOf(b).shape).not.toBe(before.b.shape);
  // A new measure of a closed turn's reply: its kept rows carry the old size, so it is built
  // again with the measured one.
  const rc = rowOf(c);
  const part = v.cmdFor(rc);
  v.probed(part.key, v.partSig(part), { height: 400 * v.zoom() }, cx);
  v.open.add(keys.at(-8));
  draw(v, cx);
  expect(rowOf(c)).not.toBe(rc);
  expect(sizeOf(c)).toBe(rc.shape.mdBase + 400);
  // A new width: every row is built again.
  const wa = rowOf(a);
  v.width += 40;
  for (let i = 0; i < 20; i++) draw(v, cx);
  expect(rowOf(a)).not.toBe(wa);
});

test("opening or closing a turn, or a part of one, puts only its rows in place, the same as building every row", async () => {
  // Ten days of turns: day bands, and the places a later build can start (marks) after them.
  const { v, cx } = await pane(fixture("--extra", "250", "--gap", "3600", "--images"));
  for (let i = 0; i < 40; i++) { if (v.shapeLeft > 0) v.reshapeDue = true; draw(v, cx); }
  const keys = v.turnKeys(v.rows());
  const marks = () => JSON.stringify(v.rowBuild.marks.map((m) => [m.ti, m.row, m.dayRow]));
  const view = (rows, sizes) => rows.map((r, i) => `${r.key} ${r.kind} ${sizes[i]}`);
  const full = () => {
    // The same state built from nothing.
    const w = { rows: v.baseRows, sizes: v.baseSizes, index: v.baseIndex, build: v.rowBuild, key: v.rowsKey };
    v.rowBuild = null; v.rowsKey = null; v.rowJob = null;
    v.rows();
    while (v.rowJob) { v.renders++; v.rows(); }
    const got = { rows: view(v.baseRows, v.baseSizes), index: [...v.baseIndex].sort().join(), marks: marks() };
    Object.assign(v, { baseRows: w.rows, baseSizes: w.sizes, baseIndex: w.index, rowBuild: w.build, rowsKey: w.key, fitKey: null });
    return got;
  };
  let spliced = 0;
  const step = (name, fn) => {
    fn();
    const was = v.rowBuild;
    v.rows();
    if (v.rowBuild !== was && v.rowBuild.sessions === was.sessions) spliced++;
    const want = full();
    expect({ name, rows: view(v.baseRows, v.baseSizes) }).toEqual({ name, rows: want.rows });
    expect([...v.baseIndex].sort().join()).toBe(want.index);
    expect(marks()).toBe(want.marks);
    for (const [k, i] of v.baseIndex) expect(v.baseRows[i].key).toBe(k);
  };
  expect(v.rowBuild.marks.length).toBeGreaterThan(3);
  const a = keys.at(-120);
  const b = keys.at(-5);
  step("open a", () => v.open.add(a));
  step("open b", () => v.open.add(b));
  const g = v.baseRows.find((r) => r.kind === "grp" && r.key.startsWith(`gp:${b}:`));
  if (g) step("open a group of b", () => v.setGroup(`${b}:${g.gi}`, true));
  step("close a", () => v.open.delete(a));
  step("whole prompt of b", () => v.full.add(b));
  step("close b", () => { v.open.delete(b); v.full.delete(b); });
  step("open the first", () => v.open.add(keys[0]));
  step("close it", () => v.open.delete(keys[0]));
  // New call details with nothing open: the rows stay as they are.
  step("new call details", () => { v.callVer = (v.callVer ?? 0) + 1; });
  // The same parts open in another order.
  step("open a and b", () => { v.open.add(a); v.open.add(b); });
  step("same, other order", () => { v.open.delete(a); v.open.add(a); });
  // Estimates left out of time in open turns: those turns are built again, not every row.
  step("again", () => { v.againOpen = true; v.rowsKey = "again"; });
  expect(spliced).toBeGreaterThanOrEqual(6);
});

// PR 72 and 75 together: the running card draws the open turn's YOU part, so a message past
// 420 px is cut there with Show all, and a press on the card opens it in place.
test("the running card's message past 420 px is cut with Show all, and a press on the card shows it whole", async () => {
  const prompt = Array.from({ length: 40 }, (_, i) => `step ${i + 1}: cart total recomputed for order ${1000 + i}`).join("\n");
  const at = (s) => `2026-11-16T10:00:${String(s).padStart(2, "0")}.000Z`;
  const lines = [
    { type: "user", uuid: "u1", timestamp: at(0), sessionId: "s", origin: { kind: "human" }, message: { role: "user", content: prompt } },
    { type: "assistant", uuid: "a1", timestamp: at(5), sessionId: "s", message: { id: "m1", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "cart/total.ts" } }] } },
  ];
  const dir = mkdtempSync(join(tmpdir(), "threads-runlong-"));
  const file = join(dir, "r.jsonl");
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  const { v, cx } = await pane(file);
  draw(v, cx);
  const key = v.turnKeys(v.rows()).at(-1);
  v.sel = key;
  let r = v.rows().find((x) => x.key === key);
  expect(r.kind).toBe("working");
  expect(v.youMd(v.workYou(r))).toMatchObject({ long: true, capped: true });
  const h0 = v.estimate(r);
  v.click(key, cx);
  r = v.rows().find((x) => x.key === key);
  expect(r.kind).toBe("working");
  expect(v.youMd(v.workYou(r))).toMatchObject({ long: true, capped: false });
  expect(v.estimate(r)).toBeGreaterThan(h0);
  expect(v.open.has(key)).toBe(false);
  v.click(key, cx);
  expect(v.youMd(v.workYou(v.rows().find((x) => x.key === key))).capped).toBe(true);
});

test("while a long session's first rows are still built, the pane says it is reading, not that nothing was typed", async () => {
  const { v, cx } = await pane(fixture("--extra", "300", "--agents"));
  v.prefs = { ...v.prefs, agentTurns: false };
  draw(v, cx);
  // The first build of the rows, in slices, as after reading a long session.
  v.baseRows = null; v.rowsKey = null; v.rowJob = null;
  const max = v.buildMax;
  v.buildMax = () => 0;
  const said = [];
  const { empty, loading } = v;
  v.empty = function (...a) { said.push(a[2]); return empty.apply(this, a); };
  v.loading = function (...a) { said.push(a[1]); return loading.apply(this, a); };
  v.render(cx);
  expect(v.rowJob).toBeTruthy();
  expect(said.some((x) => /^Reading session/.test(x))).toBe(true);
  expect(said).not.toContain("No user messages yet");
  // Once built, the turns.
  v.buildMax = max;
  for (let i = 0; i < 60 && v.rowJob; i++) { v.renders++; v.render(cx); }
  said.length = 0;
  v.render(cx);
  expect(v.rowJob).toBeNull();
  expect(v.turnKeys(v.rows()).length).toBeGreaterThan(0);
  expect(said).toEqual([]);
});

test("the probe looks at no more than its share of rows a frame: a part far from the top is found over frames, then nothing is due; the nearest parts stay first", async () => {
  const { v, cx } = await longSession(2000);
  v.debug = false;
  v.width = 545;
  settleRows(v, cx);
  // Every part measured but the first turn's, far above the top at the end of the list.
  const parts = v.baseRows.map((r) => (r.kind === "turn" && r.shape?.md != null ? v.cmdFor(r) : null)).filter(Boolean);
  expect(parts.length).toBeGreaterThan(500);
  v.meas = new Map(parts.slice(1).map((p) => [p.key, { sig: v.partSig(p), h: 20 }]));
  v.probeTries = new Map();
  v.probeQuiet = null;
  v.probeWalk = null;
  v.topKey = v.baseRows.at(-1).key;
  v.measVer = (v.measVer ?? 0) + 1;
  const sig = v.partSig.bind(v);
  let sigs = 0;
  v.partSig = (...a) => { sigs++; return sig(...a); };
  let found = null;
  let calls = 0;
  for (; calls < 20 && !found; calls++) {
    sigs = 0;
    const due = v.probeDue();
    // At most 300 rows, of which only turns with a reply are parts.
    expect(sigs).toBeLessThanOrEqual(300);
    if (!due.length) expect(v.probeLeft).toBe(1);
    found = due.find(([r]) => r.key === parts[0].key) ?? null;
  }
  expect(found).toBeTruthy();
  expect(calls).toBeGreaterThan(1);
  // Measured: the walk goes on from the rows it knows are clean, finds nothing, and the
  // probe is quiet.
  v.meas.set(parts[0].key, { sig: v.partSig(parts[0]), h: 20 });
  v.measVer++;
  sigs = 0;
  expect(v.probeDue().length).toBe(0);
  expect(sigs).toBeLessThanOrEqual(300);
  expect(v.probeLeft).toBe(0);
  sigs = 0;
  expect(v.probeDue().length).toBe(0);
  expect(sigs).toBe(0);
});

test("the probe's walk goes on past measured rows while measures keep coming in", async () => {
  const { v, cx } = await longSession(2000);
  v.debug = false;
  v.width = 545;
  settleRows(v, cx);
  const parts = v.baseRows.map((r) => (r.kind === "turn" && r.shape?.md != null ? v.cmdFor(r) : null)).filter(Boolean);
  v.meas = new Map(parts.slice(1).map((p) => [p.key, { sig: v.partSig(p), h: 20 }]));
  v.probeTries = new Map();
  v.probeQuiet = null;
  v.probeWalk = null;
  v.topKey = v.baseRows.at(-1).key;
  let found = false;
  // A measure of some part comes in every frame, as while the newest parts are measured.
  for (let i = 0; i < 40 && !found; i++) {
    found = v.probeDue().some(([r]) => r.key === parts[0].key);
    v.measVer = (v.measVer ?? 0) + 1;
  }
  expect(found).toBe(true);
});

test("the probe's walk starts over at the top when the rows change, and asks again for a part that has not reported", async () => {
  const { v, cx } = await longSession(300);
  v.debug = false;
  v.width = 545;
  settleRows(v, cx);
  v.meas = new Map();
  v.probeTries = new Map();
  v.probeQuiet = null;
  v.probeWalk = null;
  const turns = v.baseRows.filter((r) => r.kind === "turn");
  v.topKey = turns[150].key;
  const first = v.probeDue().map(([r]) => r.key);
  expect(first.length).toBe(16);
  // Not reported yet: the same parts again, nearest first (up to three tries each).
  expect(v.probeDue().map(([r]) => r.key)).toEqual(first);
  // The rows changed: from the top again.
  v.probeList();
  expect(v.probeDue().map(([r]) => r.key)).toEqual(first);
});

// Mermaid, first step (agreed 17 Nov): a "View diagram" line under a mermaid code block in an
// open turn opens the diagram drawn as text art in the output viewer, unwrapped. A kind the
// renderer cannot draw opens the source with a plain note.
test("View diagram under a mermaid block opens it as text art; a kind it cannot draw shows the source with a note", async () => {
  const ts = (s) => `2026-11-01T09:00:${String(s).padStart(2, "0")}.000Z`;
  const { newSession, apply } = await import("../mods/agent-threads/core/turns.js");
  const { v, cx } = await pane(fixture("--only", "1"));
  const s = newSession("00000000-0000-4000-8000-00000000000e", "/nonexistent/e.jsonl");
  const flow = "flowchart LR\n  A[Cart]-->B{Total ok?}\n  B -->|yes| C[Pay]";
  const pie = 'pie title Orders\n  "web" : 3\n  "app" : 2';
  for (const e of [{ k: "p", o: "human", t: "Draw the checkout", ts: ts(0) },
    { k: "t", t: `Here.\n\n\`\`\`mermaid\n${flow}\n\`\`\`\n\nAnd the split:\n\n\`\`\`Mermaid\n${pie}\n\`\`\`\n\n\`\`\`js\nconst a = 1;\n\`\`\`` },
    { k: "d", ms: 4000, ts: ts(4) }]) apply(s, e);
  s.loaded = true;
  v.sessions = [s];
  cx.pending = [];
  const a = "0:1";
  v.sel = a;
  v.toggle(a, cx);
  for (let i = 0; i < 6; i++) { draw(v, cx); cx.flush(0); await settleCx(cx); }
  const rows = v.rows();
  // One View diagram per mermaid block (the fence's language in any case), none under the js.
  const links = rows.filter((r) => r.kind === "mview");
  expect(links.map((r) => r.key)).toEqual([`mv:${a}:1`, `mv:${a}:3`]);
  const at = (k) => rows.findIndex((r) => r.key === k);
  expect(at(`mv:${a}:1`)).toBe(at(`code:${a}:1`) + 1);
  expect(v.height(links[0])).toBe(26); // as tall as Show all
  rec = []; v.partContent(theme, links[0], false); const d = rec; rec = null;
  expect(d.some(([n, x]) => n === "child" && x === "View diagram")).toBe(true);
  expect(d.filter(([n]) => /^on_/.test(n))).toEqual([]);
  // A press opens the drawing: the boxes and the arrow's label, no source, unwrapped.
  overlays.length = 0;
  v.click(links[0].key, cx);
  expect(v.sel).toBe(a);
  expect(overlays).toHaveLength(1);
  const o = overlays[0].props.output;
  expect(o).toMatchObject({ title: "#1 · Diagram", note: "", wrap: false, numbers: false, lang: "text" });
  expect(o.text).toContain("│ Cart ├───►│ Total ok? ├─yes►│ Pay │");
  // No line starts with a plain space, which the editor would draw indent guides in.
  expect(o.text).not.toMatch(/^ /m);
  expect(o.text).not.toContain("flowchart");
  state = { terminals: [], panes: [], shared: {}, props: { overlay: "ov7", output: o } };
  const g = new Threads();
  const gcx = makeCx();
  const before = editors.length;
  g.init(state.props, gcx);
  expect(editors.slice(before).at(-1).opts).toMatchObject({ readonly: true, soft_wrap: false, line_numbers: false, value: o.text });
  // A pie chart: the source, wrapped, under a note that names what can be drawn.
  overlays.length = 0;
  v.click(links[1].key, cx);
  const p = overlays[0].props.output;
  expect(p).toMatchObject({ title: "#1 · Mermaid source", wrap: true, numbers: true, text: pie });
  expect(p.note).toBe('Threads can draw flowchart, state, sequence, class, ER and XY chart diagrams, not "pie". The source is below.');
  state = { terminals: [], panes: [], shared: {}, props: { overlay: "ov8", output: p } };
  const h = new Threads();
  const hcx = makeCx();
  h.init(state.props, hcx);
  rec = []; h.render(hcx); const hd = rec; rec = null;
  expect(hd.some(([n, x]) => n === "child" && x === p.note)).toBe(true);
});

// ---- the settings card (chat-look rounds 8 to 10, trajectory-5 section 9) ----

// The handler named `name` set on the element with this id, before the next element's id.
function onOf(calls, id, name) {
  const at = calls.findIndex((e) => e[0] === "id" && e[1] === id);
  if (at < 0) return null;
  for (let j = at + 1; j < calls.length && calls[j][0] !== "id"; j++) if (calls[j][0] === name) return calls[j].at(-1);
  return null;
}
const strsOf = (calls) => calls.filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
const idsIn = (calls) => calls.filter((e) => e[0] === "id").map((e) => e[1]);
const cardOf = (v) => { rec = []; v.settingsCard(theme); const c = rec; rec = null; return c; };

test("the settings card: over the list, opens on Chat with the keyboard, closes on a press outside, the x, Esc or the comma", async () => {
  const { v, cx } = await pane(fixture("--extra", "4"));
  v.width = 545; v.paneW = 573; v.rootH = 700;
  const before = focusCalls;
  v.key(keyEv(","), cx);
  expect(v.settingsOpen).toBe(true);
  expect(v.setTab).toBe("chat");
  expect(focusCalls).toBeGreaterThan(before); // the pane has the keyboard, so one Esc closes it
  let c = frame(v, cx);
  const ids = idsIn(c);
  // A clear layer over the pane, then the card, both after the list: the list does not move.
  expect(ids.indexOf("th-set-catch")).toBeGreaterThan(ids.indexOf("threads-listbox"));
  expect(ids).toEqual(expect.arrayContaining(["th-set-card", "th-set-close", "th-set-tab-general", "th-set-tab-chat", "th-set-preview", "th-set-foot", "th-set-keys"]));
  expect(ids.filter((x) => x.startsWith("th-set-tab-"))).toEqual(["th-set-tab-general", "th-set-tab-chat"]);
  expect(ids).not.toContain("th-top");
  // 440 px at most, 12 px from the pane's right edge, and the pane less 12 px each side when narrower.
  expect(c[c.findIndex((e) => e[0] === "id" && e[1] === "th-set-card") + 3]).toEqual(["right", 12]);
  expect(c[c.findIndex((e) => e[0] === "id" && e[1] === "th-set-card") + 4]).toEqual(["w", 440]);
  v.paneW = 360;
  expect(v.setCardW()).toBe(336);
  v.paneW = 573;
  // A press on the card stays in it; a press anywhere else in the pane closes it, and selects nothing.
  const sel = v.sel;
  let stopped = 0;
  const ev = { ...cx, stop_propagation() { stopped++; } };
  onOf(c, "th-set-card", "on_click")({}, ev);
  expect(v.settingsOpen).toBe(true);
  onOf(c, "th-set-catch", "on_click")({}, ev);
  expect(v.settingsOpen).toBe(false);
  expect(v.sel).toBe(sel);
  expect(stopped).toBe(2);
  // The x.
  v.action("settings", cx);
  c = frame(v, cx);
  const at = c.findIndex((e) => e[0] === "id" && e[1] === "th-set-close");
  c.slice(at).find((e) => e[0] === "on_click").at(-1)({}, cx);
  expect(v.settingsOpen).toBe(false);
  // Esc, from the list or from the quote key field, which hands the keyboard back.
  v.action("settings", cx);
  v.key(keyEv("escape"), cx);
  expect(v.settingsOpen).toBe(false);
  v.action("settings", cx);
  v.quoteInput.handlers.focus({}, cx);
  expect(v.fieldFocused).toBe("quote");
  const f0 = focusCalls;
  v.key(keyEv("escape"), cx);
  expect([v.settingsOpen, v.fieldFocused]).toEqual([false, null]);
  expect(focusCalls).toBe(f0 + 1);
  // A press in another pane: Herdr's press-outside handler on the card.
  v.action("settings", cx);
  c = frame(v, cx);
  onOf(c, "th-set-card", "on_mouse_down_out")({}, cx);
  expect(v.settingsOpen).toBe(false);
  // The comma again, and the tabs.
  v.key(keyEv(","), cx);
  v.key(keyEv(","), cx);
  expect(v.settingsOpen).toBe(false);
  v.action("settings", cx);
  c = frame(v, cx);
  onOf(c, "th-set-tab-general", "on_click")({}, cx);
  expect(v.setTab).toBe("general");
  // It opens on Chat each time.
  v.closeSettings(); v.action("settings", cx);
  expect(v.setTab).toBe("chat");
  draw(v, cx);
});

test("General holds text, rail side, key hints, the two message colors, link rules, the quote key and the file; Chat holds messages and the width", async () => {
  const { v, cx } = await pane(fixture("--extra", "4", "--agents"));
  v.width = 545; v.paneW = 573; v.rootH = 700;
  v.action("settings", cx);
  v.setTab = "general";
  const g = cardOf(v);
  const gs = strsOf(g);
  for (const s of ["Text", "Layout", "Colors", "Links and keys", "File", "Text size", "Rail side", "Left", "Right", "Key hints at the bottom", "User messages", "Agent messages", "Link rules", "Quote key", "Copy path", "Reset to defaults", "Link rules and the quote key stay."]) expect(gs).toContain(s);
  for (const s of ["Show agent messages", "Width", "Shorten long messages", "Always show time", "Your name", "Message patterns", "Dock side"]) expect(gs).not.toContain(s);
  // Headings in the keys sheet's style, US spelling; the rows lost their icons.
  expect(gs).not.toContain("Colours");
  const icons = g.filter((e) => e[0] === "svg").map((e) => String(e[1]).split("/").pop());
  for (const gone of ["bot.svg", "clock.svg", "scissors.svg", "fold-horizontal.svg", "move-horizontal.svg"]) expect(icons).not.toContain(gone);
  // A color's name is its dot's tooltip: amber is the agent default now.
  expect(g.some((e) => e[0] === "tooltip" && e[1] === "Amber · default")).toBe(true);
  expect(g.some((e) => e[0] === "tooltip" && e[1] === "Blue · default")).toBe(true);
  v.setTab = "chat";
  const ch = strsOf(cardOf(v));
  for (const s of ["Messages", "Layout", "Show agent messages", "Shorten long messages", "Always show time", "Width", "Comfortable", "Wide", "Full", "Keep the pane at this width", "Reset to defaults"]) expect(ch).toContain(s);
  for (const s of ["User messages", "Agent messages", "Text size", "Quote key", "Copy path", "Rail side"]) expect(ch).not.toContain(s);
  // The hidden count sits beside its switch; the two hints that repeated a switch are gone.
  expect(ch.some((x) => /\d+ (hidden|folded)/.test(x))).toBe(true);
  expect(ch).not.toContain("A message's time shows when its turn is selected.");
  // The line counts sit under their switch only while it is on.
  expect(ch).not.toContain("Prompt lines");
  v.action("truncate", cx);
  expect(strsOf(cardOf(v))).toEqual(expect.arrayContaining(["Prompt lines", "Reply lines"]));
});

test("the preview follows text size, both colors, the time, hidden agent messages and the rail's side", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  v.width = 545; v.paneW = 573;
  v.action("settings", cx);
  const pv = () => { rec = []; v.cardPreview(theme, 440); const c = rec; rec = null; return c; };
  let c = pv();
  // The short words always, at the real text size, each bubble at most 45% of the band.
  expect(strsOf(c)).toEqual(expect.arrayContaining(["Agent · hidden in the list", "From an agent", "From the user", "9:12 AM"]));
  expect(strsOf(c)).not.toContain("9:10 AM");
  // Hidden shows in the label only: nothing in the preview is faded, so the agent's words
  // keep their ink on the amber fill (white, 5.37:1), on light and dark themes alike.
  expect(c.filter((e) => e[0] === "opacity")).toEqual([]);
  expect(c).toContainEqual(["bg", "#87643A"]); // amber
  const at = c.findIndex((e) => e[0] === "bg" && e[1] === "#87643A");
  const ink = c.slice(at).find((e) => e[0] === "text_color")[1];
  expect(contrast(ink, "#87643A")).toBeGreaterThanOrEqual(4.5);
  expect(c).toContainEqual(["text_size", 14]);
  expect(c.filter((e) => e[0] === "max_w")).toEqual([["max_w", 198], ["max_w", 198]]);
  // 10 px above and below: the line height plus 68.
  expect(v.previewH()).toBe(v.rt().line + 68);
  expect(c).toContainEqual(["py", 10]);
  // The ticks on the inset (16 px in), and 36 px on the rail's side to the bubbles.
  expect(c).toContainEqual(["right", 16]);
  expect(c).toContainEqual(["pl", 16]);
  expect(c).toContainEqual(["pr", 36]);
  v.prefs = { ...v.prefs, agentTurns: true, alwaysShowTime: true, textSize: 16, railSide: "left", agentBubbleColor: "teal" };
  c = pv();
  expect(strsOf(c)).toEqual(expect.arrayContaining(["Agent", "9:10 AM"]));
  expect(c.filter((e) => e[0] === "opacity")).toEqual([]);
  expect(c).toContainEqual(["bg", "#36706D"]);
  expect(c).toContainEqual(["text_size", 16]);
  expect(c).toContainEqual(["left", 16]);
  expect(c).toContainEqual(["pl", 36]);
  // A narrow card shortens the label to keep one line.
  v.prefs = { ...v.prefs, agentTurns: false };
  expect(strsOf((() => { rec = []; v.cardPreview(theme, 300); const x = rec; rec = null; return x; })())).toEqual(expect.arrayContaining(["Agent · hidden", "From an agent", "From the user"]));
});

test("a switch on the card shows no toast; the a key still says what it did", async () => {
  const { v, cx } = await pane(fixture("--extra", "3", "--agents"));
  v.action("settings", cx);
  const c = frame(v, cx);
  onOf(c, "th-set-agents", "on_click")({}, cx);
  expect(v.prefs.agentTurns).toBe(true);
  expect(v.toast).toBe(null);
  v.closeSettings();
  v.key(keyEv("a"), cx);
  expect(v.prefs.agentTurns).toBe(false);
  expect(v.toast.text).toBe("Agent messages hidden");
});

test("Reset covers every control on the card, is dim at the defaults, and leaves the quote key and link rules", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  v.applyPrefs(JSON.stringify({ quoteKey: "y", links: [{ pattern: "X-(\\d+)", url: "https://x.example/$1" }] }));
  v.action("settings", cx);
  const reset = () => { const c = cardOf(v); const at = c.findIndex((e) => e[0] === "id" && e[1] === "th-set-reset"); return c.slice(at, at + 20); };
  expect(v.prefsDiffer()).toBe(false);
  expect(reset()).toContainEqual(["opacity", 0.45]);
  for (const a of ["agents", "keyHints", "keepWidth", "alwaysTime", "truncate", "textSize:+", "promptLines:+", "replyLines:-", "railSide:left", "bubbleColor:teal", "agentBubbleColor:rose"]) v.action(a, cx);
  v.prefs = { ...v.prefs, width: "wide" };
  expect(v.prefsDiffer()).toBe(true);
  expect(reset()).not.toContainEqual(["opacity", 0.45]);
  v.action("resetSettings", cx);
  for (const k of ["textSize", "railSide", "keyHints", "bubbleColor", "agentBubbleColor", "agentTurns", "truncate", "promptLines", "replyLines", "alwaysShowTime", "width", "readingWidth"]) expect(v.prefs[k]).toEqual(DEFAULTS_FOR_TEST[k]);
  expect(v.quoteKey).toBe("y");
  expect(v.links.length).toBe(1);
  await new Promise((r) => setTimeout(r, 20));
});
const { DEFAULTS: DEFAULTS_FOR_TEST } = await import("../mods/agent-threads/settings.js");

test("the file: its path with Copy path, which says Copied in its own place with no toast; no Open, which the mod has no way to do", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  v.action("settings", cx);
  v.setTab = "general";
  const c = cardOf(v);
  expect(idsIn(c)).not.toContain("th-set-open");
  expect(strsOf(c)).not.toContain("Open");
  log = [];
  onOf(c, "th-set-copy", "on_click")({}, cx);
  expect(cx.clip).toBe(v.prefsPath());
  expect(v.toast).toBe(null);
  expect(strsOf(cardOf(v))).toContain("Copied");
  cx.flush(2000);
  expect(strsOf(cardOf(v))).toContain("Copy path");
  expect(log.filter((x) => x[0] === "open")).toEqual([]);
  expect(v.action("openSettingsFile", cx)).toBe(false);
});

test("a field that leaves the screen gives the keyboard back: a tab, the Link rules row, Back, or a command, after typing in the quote key field", async () => {
  const { v, cx } = await pane(fixture("--extra", "3"));
  v.action("settings", cx);
  const into = () => { v.setTab = "general"; v.setPage = "main"; v.quoteInput.handlers.focus({}, cx); expect(v.fieldFocused).toBe("quote"); };
  const back = (how) => {
    const f0 = focusCalls;
    how();
    expect(v.fieldFocused).toBe(null);
    expect(focusCalls).toBe(f0 + 1);
    // The panel's keys work again.
    const sel = v.sel;
    v.key(keyEv("k"), cx);
    expect(v.settingsOpen).toBe(true);
    return sel;
  };
  into();
  back(() => onOf(cardOf(v), "th-set-tab-chat", "on_click")({}, cx));
  expect(v.setTab).toBe("chat");
  into();
  back(() => onOf(cardOf(v), "th-set-links", "on_click")({}, cx));
  expect(v.setPage).toBe("links");
  into();
  v.setPage = "links";
  back(() => { const c = cardOf(v); const at = c.findIndex((e) => e[0] === "id" && e[1] === "th-set-back"); c.slice(at).find((e) => e[0] === "on_click").at(-1)({}, cx); });
  into();
  back(() => v.action("settingsTab:chat", cx));
  into();
  back(() => v.action("settingsPage:links", cx));
});

test("the quote key field: a free letter becomes the key and is written; a taken letter or anything else keeps it, with a note; its letters are not the panel's keys", async () => {
  const { v, cx } = await pane(fixture("--extra", "3"));
  v.action("settings", cx);
  v.setTab = "general";
  const q = v.quoteInput;
  expect(q.value()).toBe("q");
  settingsWrites.length = 0;
  keepSettings = true;
  // Typed after the old letter: the field keeps the new one alone.
  q.set_value("qy"); q.handlers.change({}, cx);
  expect(q.value()).toBe("y");
  expect(v.quoteKey).toBe("y");
  await new Promise((r) => setTimeout(r, 20));
  expect(JSON.parse(settingsWrites.at(-1)).quoteKey).toBe("y");
  expect(v.quoteNote()).toBe(null);
  // A letter Threads uses.
  q.set_value("yj"); q.handlers.change({}, cx);
  expect(q.value()).toBe("j");
  expect(v.quoteKey).toBe("y");
  expect(v.quoteNote()).toBe("j is a Threads key already. The quote key stays y.");
  expect(strsOf(cardOf(v))).toContain("j is a Threads key already. The quote key stays y.");
  q.set_value(""); q.handlers.change({}, cx);
  expect(v.quoteNote()).toBe("Type one letter. The quote key stays y.");
  q.set_value("7"); q.handlers.change({}, cx);
  expect(v.quoteNote()).toBe("One letter, a to z. The quote key stays y.");
  // While the field has the keyboard, j and the comma are its own.
  q.handlers.focus({}, cx);
  const sel = v.sel;
  v.key(keyEv("j"), cx);
  v.key(keyEv(","), cx);
  expect(v.sel).toBe(sel);
  expect(v.settingsOpen).toBe(true);
  q.handlers.blur({}, cx);
  expect(v.fieldFocused).toBe(null);
  // Opened again, the field shows the key.
  v.closeSettings(); v.action("settings", cx);
  expect(q.value()).toBe("y");
  expect(v.quoteNote()).toBe(null);
  // A key the file sets reaches the field.
  v.applyPrefs(JSON.stringify({ quoteKey: "z" }));
  expect(q.value()).toBe("z");
  // A file value Threads cannot use: the mod's note, under the field.
  v.applyPrefs(JSON.stringify({ quoteKey: "i" }));
  expect(v.quoteNote()).toMatch(/^quoteKey "i" is not a free letter/);
  keepSettings = false;
  delete recordFiles[v.prefsPath()];
});

test("Shift w steps the width with the toast that names all three; inside the card a width change shows none", async () => {
  const { v, cx } = await pane(fixture("--extra", "3"));
  v.width = 545; v.paneW = 900;
  expect(v.prefs.width).toBe("comfortable");
  const shiftW = keyEv("w", { modifiers: { shift: true, control: false, alt: false, platform: false, function: false } });
  v.key(shiftW, cx);
  expect(v.prefs.width).toBe("wide");
  expect(v.toast.icon).toBe("width-wide");
  expect(v.toast.widths).toEqual({ cur: "wide", tight: false });
  rec = []; v.toastView(theme); let c = rec; rec = null;
  expect(strsOf(c)).toEqual(["Comfortable", "Wide", "Full"]);
  expect(c).toContainEqual(["font_semibold"]);
  // A second press changes the words in place, and the first toast's timer leaves it.
  v.key(shiftW, cx);
  expect(v.prefs.width).toBe("full");
  const at = v.toast.at;
  v.key(shiftW, cx);
  expect(v.prefs.width).toBe("comfortable");
  expect(v.toast.at).not.toBe(at);
  // Too narrow for the list to change, with the pane not kept at the width: it says so, down to 420 px.
  v.paneW = 440;
  v.prefs = { ...v.prefs, readingWidth: false };
  v.key(shiftW, cx);
  expect(v.toast.widths.tight).toBe(true);
  rec = []; v.toastView(theme); c = rec; rec = null;
  expect(strsOf(c)).toContain("too narrow here to show");
  v.paneW = 400;
  rec = []; v.toastView(theme); c = rec; rec = null;
  expect(strsOf(c)).not.toContain("too narrow here to show");
  // With the card open the toast is drawn after it, so it sits over the card.
  v.toast = null;
  v.action("settings", cx);
  v.key(shiftW, cx);
  const f = idsIn(frame(v, cx));
  expect(f.indexOf("th-toast-widths")).toBeGreaterThan(f.indexOf("th-set-card"));
  // A width chosen in the card says nothing.
  v.toast = null;
  c = frame(v, cx);
  onOf(c, "th-width-full", "on_click")({}, cx);
  expect(v.prefs.width).toBe("full");
  expect(v.toast).toBe(null);
});

test("key hints at the bottom are off by default; the switch brings the row back, and ? keys sits at the card's foot", async () => {
  const { v, cx } = await pane(fixture("--extra", "3"));
  expect(v.prefs.keyHints).toBe(false);
  expect(idsIn(frame(v, cx))).not.toContain("th-footer");
  expect(v.footSpace()).toBe(0);
  v.action("settings", cx);
  let c = frame(v, cx);
  onOf(c, "th-set-keys", "on_click")({}, cx);
  expect([v.keysOpen, v.settingsOpen]).toEqual([true, false]);
  v.action("escape", cx);
  v.action("settings", cx);
  v.setTab = "general";
  c = frame(v, cx);
  onOf(c, "th-set-hints", "on_click")({}, cx);
  expect(v.prefs.keyHints).toBe(true);
  v.footerH = 38;
  expect(idsIn(frame(v, cx))).toContain("th-footer");
  expect(v.footSpace()).toBe(38);
  await new Promise((r) => setTimeout(r, 20));
});

test("the card's rows scroll inside it: as tall as they are, up to the room above the key hints", async () => {
  const { v, cx } = await pane(fixture("--extra", "3"));
  v.width = 545; v.paneW = 573; v.rootH = 400;
  v.action("settings", cx);
  const bodyH = () => { const c = cardOf(v); const at = c.findIndex((e) => e[0] === "id" && e[1] === "th-set-body-chat"); return c.slice(at).find((e) => e[0] === "h")[1]; };
  const room = 400 - 32 - 12 - (40 + 36 + v.previewH() + 40 + 2);
  expect(bodyH()).toBe(room);
  // Measured shorter than the room: the card is as tall as its rows.
  const c = cardOf(v);
  onOf(c, "th-set-rows-chat", "on_size_change")({ height: 120, width: 400 }, cx);
  expect(bodyH()).toBe(120);
  onOf(c, "th-set-rows-chat", "on_size_change")({ height: 900, width: 400 }, cx);
  expect(bodyH()).toBe(room);
  // The key hints take their room.
  v.prefs = { ...v.prefs, keyHints: true };
  v.footerH = 38;
  expect(bodyH()).toBe(room - 38);
});

// The owner, 17 Nov: pointing at the settings card near the rail set the rail off under it.
// While the card or the keys sheet is open nothing under it takes a hover, a press or the
// wheel (settings-spacing 7). The kit has no call that blocks a hover under a layer, so the
// rail, the list and the rows ask (covered()).
test("nothing under the settings card or the keys sheet reacts: the rail and its cards, the list's press, pointer and wheel, the rows' hovers", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  v.paneW = Math.max(573, v.width + 80);
  v.listH = 600;
  draw(v, cx);
  const ks = keys();
  const rail = () => { rec = []; v.railView(theme); const r = rec; rec = null; return r; };
  const live = (r) => r.filter((e) => ["on_hover", "on_scroll_wheel", "on_click", "tooltip"].includes(e[0])).length;
  const hovers = () => rail().filter((e) => e[0] === "on_hover").map((e) => e[1]).slice(1);
  let hovered = 0;
  const el = { text_color() { return this; }, when(c, f) { return c ? f(this) : this; }, hover() { hovered++; return this; } };
  let stopped = 0;
  const ev = { ...cx, stop_propagation() { stopped++; } };
  expect(live(rail())).toBeGreaterThan(0);
  v.reveal(theme, el);
  expect(hovered).toBe(1);
  for (const side of ["right", "left"]) {
    for (const page of ["main", "links"]) {
      v.prefs = { ...v.prefs, railSide: side };
      // A tick's card is open when the card opens: it closes, and does not come back after.
      hovers()[1](true, cx);
      expect(v.railHover).toBe(ks[1]);
      v.action("settings", cx);
      v.setPage = page;
      expect(v.settingsOpen).toBe(true);
      expect(v.railHover).toBe(null);
      const r = rail();
      expect(live(r)).toBe(0);
      expect(idsIn(r).some((x) => x.startsWith("th-tick-card-") || x === "th-rail-card")).toBe(false);
      const c = frame(v, cx);
      // The list: a press, the pointer and the wheel do nothing.
      const press = v.pressAt;
      const moved = v.mouseX;
      onOf(c, "threads-body", "on_mouse_move")({ position: { x: 9, y: 9 }, local_position: { x: 9, y: 9 } }, cx);
      onOf(c, "threads-body", "on_mouse_down")({ position: { x: 5, y: 5 }, local_position: { x: 5, y: 5 }, bounds: { width: 500 }, click_count: 2 }, cx);
      expect(v.pressAt).toBe(press);
      expect(v.mouseX).toBe(moved);
      v.follow = true;
      onOf(c, "threads-listbox", "on_scroll_wheel")({ delta: { y: 40 } }, cx);
      expect(v.follow).toBe(true);
      // The rows: no hover fill, no reveal, no info card.
      hovered = 0;
      v.reveal(theme, el);
      expect(hovered).toBe(0);
      expect(c.filter((e) => e[0] === "id" && String(e[1]).startsWith("th-hover-"))).toEqual([]);
      // The wheel over the card or its clear layer stops at the layer, after the card's own
      // scroll (drawn over it) has run.
      stopped = 0;
      onOf(c, "th-set-catch", "on_scroll_wheel")({ delta: { y: 40 } }, ev);
      expect(stopped).toBe(1);
      v.closeSettings();
      expect(live(rail())).toBeGreaterThan(0);
    }
  }
  // The keys sheet too.
  v.action("keys", cx);
  expect(v.keysOpen).toBe(true);
  expect(live(rail())).toBe(0);
  const c = frame(v, cx);
  stopped = 0;
  onOf(c, "th-keys-scrim", "on_scroll_wheel")({ delta: { y: 40 } }, ev);
  expect(stopped).toBe(1);
  v.action("keys", cx);
  expect(live(rail())).toBeGreaterThan(0);
  hovered = 0;
  v.reveal(theme, el);
  expect(hovered).toBe(1);
});

// settings-spacing 1 to 5 and 8: one inset on every band, so the title, the tabs, the labels
// and the foot share a left edge; a 4 px grid; the comma key's cap gone from the head (it is
// in the sliders icon's tooltip and on the keys sheet); readable text no fainter than muted.
test("the card's spacing: a 16 px inset on every band, 40 px head and foot, 36 px tabs, 28 px rows, muted helper text, no comma key in the head", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  v.width = 545; v.paneW = 573; v.rootH = 700;
  v.action("settings", cx);
  v.setTab = "general";
  const muted = theme.muted;
  const of = (fn) => { rec = []; fn(); const c = rec; rec = null; return c; };
  // From an element's id to the next id.
  const own = (c, id) => { const at = c.findIndex((e) => e[0] === "id" && e[1] === id); let end = c.findIndex((e, j) => j > at && e[0] === "id"); if (end < 0) end = c.length; return c.slice(at, end); };
  const head = of(() => v.cardHead(theme, false, () => {}, 16));
  for (const x of [["h", 40], ["px", 16], ["text_size", 14], ["mr", -5]]) expect(head).toContainEqual(x);
  expect(strsOf(head)).toEqual(["Settings"]);
  expect(of(() => v.cardHead(theme, true, () => {}, 16))).toContainEqual(["ml", -5]);
  const tabs = of(() => v.cardTabs(theme, 16));
  for (const x of [["h", 36], ["px", 6], ["px", 10], ["text_size", 13]]) expect(tabs).toContainEqual(x);
  const foot = of(() => v.cardFoot(theme, 16));
  for (const x of [["h", 40], ["px", 16], ["text_size", 12], ["text_color", muted]]) expect(foot).toContainEqual(x);
  let c = cardOf(v);
  for (const x of [["px", 16], ["py", 16], ["gap", 20]]) expect(own(c, "th-set-rows-general")).toContainEqual(x);
  // A switch: 32 by 18 with a 14 px knob; off, its track has a muted outline.
  const hints = own(c, "th-set-hints");
  for (const x of [["min_h", 28], ["w", 32], ["h", 18], ["size", 14], ["border_1"], ["border_color", muted]]) expect(hints).toContainEqual(x);
  // The colors: one line beside the name at 440, 24 px dots 2 px apart, Plain with a muted edge.
  expect(own(c, "th-bubbleColor-row")).toContainEqual(["min_h", 28]);
  expect(own(c, "th-bubbleColor-blue")).toContainEqual(["size", 24]);
  expect(own(c, "th-bubbleColor-plain")).toContainEqual(["border_color", muted]);
  // Reset's line is under the button, muted, whole.
  expect(strsOf(c)).toContain("Link rules and the quote key stay.");
  // The file's path: muted 11.5 mono, cut at a slash, whole in its tooltip.
  const path = own(c, "th-set-path");
  for (const x of [["text_size", 11.5], ["text_color", muted]]) expect(path).toContainEqual(x);
  const full = path.find((e) => e[0] === "tooltip")[1];
  const shown = strsOf(path).at(-1);
  expect(shown === full || (shown.startsWith("…/") && full.endsWith(shown.slice(1)))).toBe(true);
  // A 336 px card: the dots under the name, 6 px below it.
  v.paneW = 360;
  c = cardOf(v);
  expect(own(c, "th-bubbleColor-row")).toContainEqual(["gap", 6]);
  expect(strsOf(c)).toContain("Copy path");
  // Under 320: a 12 px inset, and Copy.
  v.paneW = 330;
  c = cardOf(v);
  expect(own(c, "th-set-rows-general")).toContainEqual(["px", 12]);
  expect(strsOf(c)).toContain("Copy");
  const narrow = strsOf(own(c, "th-set-path")).at(-1);
  expect(narrow.startsWith("…/")).toBe(true);
  expect(narrow.length).toBeLessThan(full.length);
});

test("the width line under Width ends on the controls' right edge: it fills its row, the column centered in the row's width", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  v.width = 545; v.paneW = 573; v.rootH = 700;
  v.action("settings", cx);
  v.setTab = "chat";
  const own = (c, id) => { const at = c.findIndex((e) => e[0] === "id" && e[1] === id); let end = c.findIndex((e, j) => j > at && e[0] === "id"); if (end < 0) end = c.length; return c.slice(at, end); };
  for (const [paneW, pad] of [[573, 16], [330, 12]]) {
    v.paneW = paneW;
    const w = v.setCardW();
    const c = cardOf(v);
    expect(own(c, `th-set-rows-chat`)).toContainEqual(["px", pad]);
    const ruler = own(c, "th-set-ruler");
    // The line takes its row's width, as the chooser's row and the switch rows do, so no fixed
    // width can run past them (it was 2 px over: the card's border).
    expect(ruler).toContainEqual(["w_full"]);
    expect(ruler[0]).toEqual(["id", "th-set-ruler"]);
    const ws = ruler.filter((e) => e[0] === "w").map((e) => e[1]);
    expect(ws.length).toBe(1); // the column's only
    const row = w - 2 - 2 * pad;
    const left = ruler.find((e) => e[0] === "left")[1];
    expect(Math.abs(left * 2 + ws[0] - row)).toBeLessThanOrEqual(1);
    expect(left + ws[0]).toBeLessThanOrEqual(row);
  }
});

test("the Link rules page, read only: each rule with its type icon, name, description, example and address, On or Off, or why it is not working", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  v.applyPrefs(JSON.stringify({ links: [
    { name: "Ticket", type: "ticket", description: "Our tracker", pattern: "\\bACME-(\\d+)\\b", url: "https://tracker.example/ACME-$1", example: "Fixed in ACME-412." },
    { name: "PR", type: "pull-request", pattern: "#(\\d{1,5})\\b", url: "https://git.example/{repo}/pull/$1", example: "See #58.", on: false },
    { name: "Broken", pattern: "x(", url: "https://x.example/$1" },
    { name: "Bare", pattern: "\\bBUG-(\\d+)\\b", url: "https://bugs.example/$1" },
    { name: "Miss", pattern: "\\bZED-(\\d+)\\b", url: "https://z.example/$1", example: "nothing here" },
  ] }));
  v.action("settings", cx);
  v.setTab = "general";
  const g = strsOf(cardOf(v));
  expect(g).toEqual(expect.arrayContaining(["Link rules", "5", "1 not working"]));
  // The row opens the page.
  onOf(cardOf(v), "th-set-links", "on_click")({}, cx);
  expect(v.setPage).toBe("links");
  const c = cardOf(v);
  const s = strsOf(c);
  expect(idsIn(c)).toContain("th-set-back");
  expect(idsIn(c)).not.toContain("th-set-tab-general"); // no tabs and no preview on the page
  expect(idsIn(c)).not.toContain("th-set-preview");
  for (const x of ["Link rules", "A link rule turns text in a reply into a link. A rule can make ACME-412 open its ticket.", "Rules · 5",
    "Ticket", "Our tracker", "Fixed in ", "ACME-412", "https://tracker.example/ACME-412",
    "PR", "Off", "This session has no repository, so this rule links nothing here.",
    "Broken", "Not working: pattern not valid", "Bare", "No example yet", "\\bBUG-(\\d+)\\b", "Miss", "Finds nothing in its example",
    "When two rules match the same text, the higher one wins."]) expect(s).toContain(x);
  expect(c).toContainEqual(["underline"]);
  // A switch on each rule that runs; a warning mark in its place on one that does not.
  expect(idsIn(c)).toEqual(expect.arrayContaining(["th-rule-on-1", "th-rule-on-2", "th-rule-on-4"]));
  expect(idsIn(c)).not.toContain("th-rule-on-3");
  const icons = c.filter((e) => e[0] === "svg").map((e) => String(e[1]).split("/").pop());
  expect(icons).toEqual(expect.arrayContaining(["ticket.svg", "git-pull-request.svg", "regex.svg", "alert.svg"]));
  // With the session's repository, the PR rule's example shows its address (and it stays off).
  v.remote = { ...v.remote, repo: "acme/exports", owner: "acme" };
  expect(strsOf(cardOf(v))).toContain("https://git.example/acme/exports/pull/58");
  expect(v.links.map((r) => r.name)).toEqual(["Ticket", "Bare", "Miss"]);
  // Esc closes the card from the page; Back returns to the tabs.
  onOf(cardOf(v), "th-set-back", "on_click")?.({}, cx);
  const back = cardOf(v);
  const at = back.findIndex((e) => e[0] === "id" && e[1] === "th-set-back");
  if (at >= 0) back.slice(at).find((e) => e[0] === "on_click").at(-1)({}, cx);
  expect(v.setPage).toBe("main");
  v.setPage = "links";
  v.key(keyEv("escape"), cx);
  expect(v.settingsOpen).toBe(false);
  // No rules: the page says so.
  v.applyPrefs("{}");
  v.action("settings", cx);
  v.setPage = "links";
  expect(strsOf(cardOf(v))).toContain("No rules yet.");
});

test("Shift w through Full keeps Keep the pane at this width as it was, and Reset resizes the pane the way a width change does", async () => {
  const { v, cx } = await pane(fixture("--extra", "3"));
  v.width = 545; v.paneW = 573;
  const shiftW = keyEv("w", { modifiers: { shift: true, control: false, alt: false, platform: false, function: false } });
  for (const want of ["wide", "full", "comfortable"]) { v.key(shiftW, cx); expect(v.prefs.width).toBe(want); expect(v.prefs.readingWidth).toBe(true); }
  // Off by hand stays off through a cycle too.
  v.prefs = { ...v.prefs, readingWidth: false };
  for (let i = 0; i < 3; i++) v.key(shiftW, cx);
  expect(v.prefs.readingWidth).toBe(false);
  // Reset: back to Comfortable with the switch on, and the pane to its column.
  v.prefs = { ...v.prefs, width: "wide", readingWidth: true };
  v.paneW = 704;
  log = [];
  v.action("resetSettings", cx);
  expect(v.prefs).toMatchObject({ width: "comfortable", readingWidth: true });
  expect(log.filter(([, n]) => n === "layout.resize").map((x) => x[2])).toEqual([{ id: "p2", px: 573 }]);
  // At the defaults already, at that width: nothing to resize.
  v.paneW = 573;
  log = [];
  v.action("resetSettings", cx);
  expect(log.filter(([, n]) => n === "layout.resize")).toEqual([]);
  await new Promise((r) => setTimeout(r, 20));
});

test("a rule that turned slow on a reply shows Not working with the reason on the page and in the count", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  v.applyPrefs(JSON.stringify({ links: [{ name: "Slowish", pattern: "\\bZ-(\\d+)\\b", url: "https://z.example/$1", example: "Z-1" }] }));
  v.links[0].slow = "too slow on a reply; skipped until the rule changes";
  v.action("settings", cx);
  v.setTab = "general";
  expect(strsOf(cardOf(v))).toContain("1 not working");
  v.setPage = "links";
  const c = cardOf(v);
  expect(strsOf(c)).toContain("Not working: too slow on a reply; skipped until the rule changes");
  expect(strsOf(c)).not.toContain("Finds nothing in its example");
  // A change to the file compiles it again, and it runs.
  v.applyPrefs(JSON.stringify({ links: [{ name: "Slowish", pattern: "\\bZ-(\\d+)\\b", url: "https://z.example/a/$1", example: "Z-1" }] }));
  expect(v.links[0].slow).toBe(undefined);
});

// ---- link rules changed on the card (chat-look round 10; settings-links) ----

const RULES = [
  { name: "Ticket", type: "ticket", pattern: "\\bACME-(\\d+)\\b", url: "https://tracker.example/ACME-$1", example: "Fixed in ACME-412.", keepMe: 1 },
  { name: "Hash", pattern: "#(\\d+)", url: "https://h.example/$1", example: "See #58." },
];
async function rulesPane(rules = RULES) {
  const r = await pane(fixture("--extra", "2"));
  keepSettings = true;
  settingsWrites.length = 0;
  r.v.applyPrefs(JSON.stringify({ textSize: 15, links: rules }));
  recordFiles[r.v.prefsPath()] = r.v.prefsRaw;
  r.v.action("settings", r.cx);
  r.v.setPage = "links";
  r.cx.pending = []; // the folder watch never ends: wait only for what follows
  return r;
}
const settleAll = async (cx) => { for (let i = 0; i < 3; i++) { const p = cx.pending; cx.pending = []; await Promise.all(p); } };
const lastLinks = () => JSON.parse(settingsWrites.at(-1)).links;
function typeIn(v, k, text, cx) { v.ruleInputs[k].set_value(text); v.ruleInputs[k].handlers.change({}, cx); }
function done(v) { keepSettings = false; settingsStale = false; delete recordFiles[v.prefsPath()]; }

test("a fresh install has the pull request rule, on; the first write records it, and a file without links has none", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  keepSettings = true;
  cx.pending = [];
  try {
    v.applyPrefs(null);
    expect(v.linkList.map((r) => [r.name, r.type, r.on, r.why])).toEqual([["Pull request", "pull-request", true, null]]);
    expect(v.links.length).toBe(1);
    v.remote = { ...v.remote, repo: "acme/exports", owner: "acme" };
    expect(v.linkOne("Merged in #58 today.").md).toContain("https://github.com/acme/exports/pull/58");
    settingsWrites.length = 0;
    v.action("textSize:+", cx);
    await settleAll(cx);
    const w = JSON.parse(settingsWrites.at(-1));
    expect(w.links).toEqual([{ name: "Pull request", pattern: "(?<![\\w&/#])#(\\d{1,5})\\b", url: "https://github.com/{repo}/pull/$1", example: "Merged in #58.", type: "pull-request" }]);
    expect(w.textSize).toBe(15);
    v.applyPrefs(JSON.stringify({ textSize: 14 }));
    expect(v.linkList).toEqual([]);
  } finally { done(v); }
});

test("the switch on a row turns a rule off and on, written to the file; an off rule links nothing and is dimmed with Off", async () => {
  const { v, cx } = await rulesPane();
  try {
    onOf(cardOf(v), "th-rule-on-1", "on_click")({}, cx);
    expect(v.links.map((r) => r.name)).toEqual(["Hash"]);
    await settleAll(cx);
    expect(lastLinks()[0]).toEqual({ ...RULES[0], on: false });
    expect(JSON.parse(settingsWrites.at(-1)).textSize).toBe(15);
    const c = cardOf(v);
    expect(strsOf(c)).toContain("Off");
    expect(v.settingsOpen).toBe(true); // the press stays in the card and opens nothing
    expect(v.ruleEdit).toBe(null);
    onOf(c, "th-rule-on-1", "on_click")({}, cx);
    await settleAll(cx);
    expect(lastLinks()[0]).toEqual(RULES[0]);
    expect(v.links.map((r) => r.name)).toEqual(["Ticket", "Hash"]);
  } finally { done(v); }
});

test("Edit and Delete: icon buttons on every row before its switch, with a tooltip and a spoken label; Delete takes the rule at once, and Undo puts it back where it was", async () => {
  const { v, cx } = await rulesPane();
  try {
    let c = cardOf(v);
    // On every row, not only under the pointer, and the row has no hover handler for them.
    expect(idsIn(c)).toEqual(expect.arrayContaining(["th-rule-edit-btn-1", "th-rule-delete-btn-1", "th-rule-edit-btn-2", "th-rule-delete-btn-2"]));
    expect(onOf(c, "th-rule-1", "on_hover")).toBe(null);
    expect(strsOf(c)).not.toContain("Change");
    expect(strsOf(c)).not.toContain("Remove");
    // Name, Edit, Delete, then the switch: the switch stays last, in a 36 by 24 hit area.
    const ids = idsIn(c);
    expect(ids.indexOf("th-rule-edit-btn-1")).toBeLessThan(ids.indexOf("th-rule-delete-btn-1"));
    expect(ids.indexOf("th-rule-delete-btn-1")).toBeLessThan(ids.indexOf("th-rule-on-1"));
    const own = (id) => { const at = c.findIndex((e) => e[0] === "id" && e[1] === id); let end = c.findIndex((e, j) => j > at && e[0] === "id"); if (end < 0) end = c.length; return c.slice(at, end); };
    for (const [id, tip, icon] of [["th-rule-edit-btn-1", "Edit rule", "pencil"], ["th-rule-delete-btn-1", "Delete rule", "trash"]]) {
      const b = own(id);
      for (const x of [["size", 24], ["rounded", 5], ["text_color", theme.muted], ["tooltip", tip], ["accessibility_label", tip], ["role", "button"]]) expect(b).toContainEqual(x);
      expect(b.some((e) => e[0] === "svg" && String(e[1]).endsWith(`/${icon}.svg`))).toBe(true);
      // Lucide outlines at the mod's 1.5 stroke.
      expect(readFileSync(new URL(`../mods/agent-threads/${icon}.svg`, import.meta.url), "utf8")).toContain('stroke-width="1.5"');
    }
    for (const x of [["w", 36], ["h", 24]]) expect(own("th-rule-on-1")).toContainEqual(x);
    // Edit opens the rule, as a press on the row does.
    onOf(c, "th-rule-edit-btn-1", "on_click")({}, cx);
    expect(v.ruleEdit.at).toBe(0);
    v.closeRule();
    onOf(cardOf(v), "th-rule-delete-btn-1", "on_click")({}, cx);
    expect(v.linkList.map((r) => r.name)).toEqual(["Hash"]);
    await settleAll(cx);
    expect(lastLinks()).toEqual([RULES[1]]);
    c = cardOf(v);
    expect(strsOf(c)).toContain("Deleted Ticket.");
    expect(idsIn(c)).toContain("th-rule-undo-line");
    expect(v.ruleUndo.at).toBe(0); // drawn where the rule was
    onOf(c, "th-rule-undo", "on_click")({}, cx);
    await settleAll(cx);
    expect(lastLinks()).toEqual(RULES);
    expect(strsOf(cardOf(v))).not.toContain("Deleted Ticket.");
    // Undo lasts until the page is left.
    v.removeRule(1, cx);
    expect(v.ruleUndo).not.toBe(null);
    v.action("settingsPage:main", cx);
    expect(v.ruleUndo).toBe(null);
    await settleAll(cx);
  } finally { done(v); }
});

// settings-spacing 6: a rule's card 12 px in, its lines 4 px apart, a 14 px type icon 8 px
// from a 13 px name, readable text muted, cards 8 px apart; nothing pressed under 24 px.
test("Link rules spacing: 12 px cards, muted lines, a 32 px Undo line with a 24 px Undo, 24 px small buttons", async () => {
  const { v, cx } = await rulesPane();
  try {
    let c = cardOf(v);
    const own = (id) => { const at = c.findIndex((e) => e[0] === "id" && e[1] === id); let end = c.findIndex((e, j) => j > at && e[0] === "id"); if (end < 0) end = c.length; return c.slice(at, end); };
    const row = own("th-rule-1");
    for (const x of [["p", 12], ["gap", 4], ["gap", 8], ["size", 14], ["text_size", 13], ["font_semibold"]]) expect(row).toContainEqual(x);
    v.removeRule(0, cx);
    c = cardOf(v);
    for (const x of [["min_h", 32], ["text_color", theme.muted]]) expect(own("th-rule-undo-line")).toContainEqual(x);
    expect(own("th-rule-undo")).toContainEqual(["h", 24]);
    expect(strsOf(c)).toContain("Undo");
    await settleAll(cx);
    rec = []; v.miniButton(theme, "x", "Use", () => {}); const m = rec; rec = null;
    expect(m).toContainEqual(["h", 24]);
  } finally { done(v); }
});

test("a press on a row opens the rule in place with its fields; Keep rule writes it, keeping keys this version does not know; Esc and Discard drop the change", async () => {
  const { v, cx } = await rulesPane();
  try {
    onOf(cardOf(v), "th-rule-1", "on_click")({}, cx);
    expect(v.ruleEdit.at).toBe(0);
    expect(Object.fromEntries(Object.entries(v.ruleInputs).map(([k, i]) => [k, i.value()]))).toEqual({ name: "Ticket", description: "", pattern: RULES[0].pattern, url: RULES[0].url, example: RULES[0].example });
    let c = cardOf(v);
    const s = strsOf(c);
    for (const x of ["Type", "Ticket key", "Name", "Description", "Finds", "Opens", "Example", "A JavaScript regular expression. Capitals count.", "Reference", "Keep rule", "Discard", "Duplicate", "Delete", "ACME-412", "https://tracker.example/ACME-412"]) expect(s).toContain(x);
    expect(s).not.toContain("Move up"); // the first rule
    expect(idsIn(c)).toContain("th-rule-edit-1");
    expect(idsIn(c)).not.toContain("th-rule-1");
    expect(idsIn(c)).not.toContain("th-rule-add");
    // Open goes to the address, Reference to the pattern sheet, with Herdr's URL opener.
    log = [];
    onOf(c, "th-rule-open", "on_click")({}, cx);
    onOf(c, "th-rule-reference", "on_click")({}, cx);
    expect(log.filter((x) => x[0] === "open_url").map((x) => x[1])).toEqual(["https://tracker.example/ACME-412", "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions/Cheatsheet"]);
    // A change, kept.
    typeIn(v, "description", "Our tracker", cx);
    typeIn(v, "example", "Shipped ACME-7.", cx);
    expect(strsOf(cardOf(v))).toContain("https://tracker.example/ACME-7");
    v.ruleInputs.name.handlers.submit({}, cx); // Enter in a field keeps it
    expect(v.ruleEdit).toBe(null);
    await settleAll(cx);
    expect(lastLinks()[0]).toEqual({ name: "Ticket", type: "ticket", description: "Our tracker", pattern: RULES[0].pattern, url: RULES[0].url, example: "Shipped ACME-7.", keepMe: 1 });
    expect(strsOf(cardOf(v))).toContain("Our tracker");
    // Esc from a field closes the rule, not the card, and writes nothing.
    const n = settingsWrites.length;
    onOf(cardOf(v), "th-rule-2", "on_click")({}, cx);
    v.ruleInputs.name.handlers.focus({}, cx);
    typeIn(v, "name", "Changed", cx);
    v.key(keyEv("escape"), cx);
    expect([v.ruleEdit, v.settingsOpen, v.fieldFocused]).toEqual([null, true, null]);
    // Esc with no field focused, and Discard, do the same.
    onOf(cardOf(v), "th-rule-2", "on_click")({}, cx);
    v.action("escape", cx);
    expect([v.ruleEdit, v.settingsOpen]).toEqual([null, true]);
    onOf(cardOf(v), "th-rule-2", "on_click")({}, cx);
    c = cardOf(v);
    onOf(c, "th-rule-discard", "on_click")({}, cx);
    expect(v.ruleEdit).toBe(null);
    await settleAll(cx);
    expect(settingsWrites.length).toBe(n);
    expect(v.linkList[1].name).toBe("Hash");
  } finally { done(v); }
});

test("Add rule: three types, Custom first; a type fills an untouched new rule, and after the first change to Finds, Opens or Example it is only the label", async () => {
  const { v, cx } = await rulesPane();
  try {
    onOf(cardOf(v), "th-rule-add", "on_click")({}, cx);
    let c = cardOf(v);
    expect(strsOf(c)).toEqual(expect.arrayContaining(["New rule, not kept yet", "Custom", "Write it yourself.", "Ticket key", "Pull request", "Links a ticket key such as ACME-412 to its ticket."]));
    expect(idsIn(c).indexOf("th-rule-new")).toBeGreaterThan(idsIn(c).indexOf("th-rule-2"));
    expect(v.ruleEdit.draft.type).toBe("custom");
    expect(strsOf(c)).not.toContain("Duplicate");
    onOf(c, "th-rule-type-ticket", "on_click")({}, cx);
    expect(v.ruleInputs.pattern.value()).toBe("\\bACME-(\\d+)\\b");
    expect(v.ruleInputs.name.value()).toBe("Ticket");
    expect(strsOf(cardOf(v))).toContain("https://tracker.example.com/ACME-412");
    // The rule above takes the same text first, and the line says so.
    expect(strsOf(cardOf(v))).toContain("Ticket is higher in the list and takes this text first. Keep this rule, then Move up to put it above.");
    onOf(cardOf(v), "th-rule-type-custom", "on_click")({}, cx);
    expect([v.ruleInputs.pattern.value(), v.ruleInputs.name.value()]).toEqual(["", ""]);
    // Typed: the three rows fold to one line, and a type no longer fills.
    typeIn(v, "pattern", "\\bBUG-(\\d+)\\b", cx);
    c = cardOf(v);
    expect(idsIn(c)).toContain("th-rule-type-change");
    expect(idsIn(c)).not.toContain("th-rule-type-ticket");
    onOf(c, "th-rule-type-change", "on_click")({}, cx);
    expect(strsOf(cardOf(v))).toContain("The label changes; the fields stay.");
    onOf(cardOf(v), "th-rule-type-ticket", "on_click")({}, cx);
    expect(v.ruleInputs.pattern.value()).toBe("\\bBUG-(\\d+)\\b");
    expect(v.ruleEdit.draft.type).toBe("ticket");
    expect(idsIn(cardOf(v))).not.toContain("th-rule-type-ticket");
    typeIn(v, "url", "https://bugs.example/$1", cx);
    typeIn(v, "name", "Bug", cx);
    onOf(cardOf(v), "th-rule-keep", "on_click")({}, cx);
    await settleAll(cx);
    expect(lastLinks()[2]).toEqual({ name: "Bug", type: "ticket", pattern: "\\bBUG-(\\d+)\\b", url: "https://bugs.example/$1" });
    // The description takes 80 characters at most.
    onOf(cardOf(v), "th-rule-add", "on_click")({}, cx);
    typeIn(v, "description", "x".repeat(90), cx);
    expect(v.ruleInputs.description.value().length).toBe(80);
  } finally { done(v); }
});

test("a fault shows when typing stops or the field is left, never at a key; once shown it follows each key and goes the moment the rule runs", async () => {
  const { v, cx } = await rulesPane();
  try {
    onOf(cardOf(v), "th-rule-2", "on_click")({}, cx);
    cx.timers = [];
    typeIn(v, "pattern", "#(\\d+", cx);
    let c = cardOf(v);
    expect(strsOf(c).some((x) => x.startsWith("Not working"))).toBe(false);
    // The result line keeps the last one that worked, dimmed.
    expect(strsOf(c)).toContain("https://h.example/58");
    const at = c.findIndex((e) => e[0] === "id" && e[1] === "th-rule-result");
    expect(c.slice(at, at + 3)).toContainEqual(["opacity", 0.45]);
    // A second key restarts the pause: the first timer finds a newer key and does nothing.
    typeIn(v, "pattern", "#(\\d+x", cx);
    const [first] = cx.timers;
    first.fn(cx);
    expect(v.ruleEdit.shown.pattern).toBe(null);
    cx.flush(REASON_MS);
    expect(strsOf(cardOf(v))).toContain("Not working: pattern not valid");
    expect(cardOf(v)).toContainEqual(["border_color", theme.blocked]);
    // Mended: gone at that key, and the result is back at full strength.
    typeIn(v, "pattern", "#(\\d+)", cx);
    c = cardOf(v);
    expect(strsOf(c).some((x) => x.startsWith("Not working"))).toBe(false);
    const at2 = c.findIndex((e) => e[0] === "id" && e[1] === "th-rule-result");
    expect(c.slice(at2, at2 + 3)).not.toContainEqual(["opacity", 0.45]);
    // Leaving the field shows it at once.
    typeIn(v, "url", "ftp://h.example/$1", cx);
    expect(v.ruleEdit.shown.url).toBe(null);
    v.ruleInputs.url.handlers.blur({}, cx);
    expect(strsOf(cardOf(v))).toContain("Not working: url must start with https:// or http:// and a fixed host; placeholders only in the path");
    // Keep rule does not keep a rule that would not run: it stays open, nothing is written.
    const n = settingsWrites.length;
    onOf(cardOf(v), "th-rule-keep", "on_click")({}, cx);
    expect(v.ruleEdit).not.toBe(null);
    await settleAll(cx);
    expect(settingsWrites.length).toBe(n);
    // An empty field is not a fault until Keep rule.
    v.closeRule();
    onOf(cardOf(v), "th-rule-add", "on_click")({}, cx);
    v.ruleInputs.pattern.handlers.blur({}, cx);
    cx.flush(REASON_MS);
    expect(v.ruleEdit.shown).toEqual({ pattern: null, url: null });
    onOf(cardOf(v), "th-rule-keep", "on_click")({}, cx);
    expect(v.ruleEdit.shown).toEqual({ pattern: "no pattern", url: "no url" });
    expect(strsOf(cardOf(v))).toEqual(expect.arrayContaining(["Not working: no pattern", "Not working: no url"]));
  } finally { done(v); }
});
const REASON_MS = 1500;

test("a kept rule that is not working opens with its reason; Move up and Duplicate", async () => {
  const { v, cx } = await rulesPane([...RULES, { name: "Broken", pattern: "x(", url: "https://x.example/$1" }, { name: "Late", pattern: "ACME-(\\d+)", url: "https://late.example/$1", example: "ACME-9" }]);
  try {
    onOf(cardOf(v), "th-rule-3", "on_click")({}, cx);
    expect(strsOf(cardOf(v))).toContain("Not working: pattern not valid");
    v.closeRule();
    onOf(cardOf(v), "th-rule-4", "on_click")({}, cx);
    expect(strsOf(cardOf(v))).toContain("Ticket is higher in the list and takes this text first. Move up puts this rule above it.");
    for (let i = 0; i < 3; i++) onOf(cardOf(v), "th-rule-up", "on_click")({}, cx);
    expect(v.ruleEdit.at).toBe(0);
    expect(idsIn(cardOf(v))).not.toContain("th-rule-up");
    expect(strsOf(cardOf(v)).some((x) => x.includes("takes this text first"))).toBe(false);
    await settleAll(cx);
    expect(lastLinks().map((r) => r.name)).toEqual(["Late", "Ticket", "Hash", "Broken"]);
    onOf(cardOf(v), "th-rule-dup", "on_click")({}, cx);
    expect([v.ruleEdit.at, v.ruleEdit.insertAt, v.ruleInputs.name.value()]).toEqual([null, 1, "Late copy"]);
    expect(idsIn(cardOf(v))).toContain("th-rule-type-change"); // a copy is never refilled by a type
    onOf(cardOf(v), "th-rule-keep", "on_click")({}, cx);
    await settleAll(cx);
    expect(lastLinks().map((r) => r.name)).toEqual(["Late", "Late copy", "Ticket", "Hash", "Broken"]);
  } finally { done(v); }
});

test("no rules: the two types that fill a rule in dashed boxes, and Use opens one filled; a file that does not read as settings cannot be changed here", async () => {
  const { v, cx } = await rulesPane([]);
  try {
    let c = cardOf(v);
    expect(strsOf(c)).toEqual(expect.arrayContaining(["No rules yet.", "Examples, not rules until you keep one", "Ticket key", "Pull request", "Links a number such as #58 to that pull request in this repository.", "Add rule"]));
    expect(c).toContainEqual(["border_dashed"]);
    onOf(c, "th-rule-use-pull-request", "on_click")({}, cx);
    expect(v.ruleEdit.draft.type).toBe("pull-request");
    expect(v.ruleInputs.url.value()).toBe("https://github.com/{repo}/pull/$1");
    expect(strsOf(cardOf(v))).toContain("This session has no repository, so this rule links nothing here.");
    expect(strsOf(cardOf(v))).not.toContain("Examples, not rules until you keep one");
    v.closeRule();
    // A hand edit that does not parse: the rules show, with no switch, no Add rule and no editor.
    v.applyPrefs(JSON.stringify({ links: RULES }));
    v.applyPrefs("{ not json");
    c = cardOf(v);
    expect(idsIn(c)).not.toContain("th-rule-on-1");
    expect(idsIn(c)).not.toContain("th-rule-add");
    expect(strsOf(c)).toContain("The settings file does not read as settings now, so rules change only in the file until it is fixed.");
    v.openRule(0);
    expect(v.ruleEdit).toBe(null);
  } finally { done(v); }
});

// The merge of the settings card with sender rules: a link rule change worked out the notes
// again from the link rules alone, and the sender rules' notes went from the card.
test("a link rule kept, switched or deleted on the card leaves the sender rules' notes on the Link rules page", async () => {
  const { v, cx } = await rulesPane();
  try {
    const bad = "Sender rule 1: pattern has no (?<sender>...) group";
    const file = JSON.stringify({ textSize: 15, links: RULES, senders: [{ pattern: "^From (\\w+):" }] });
    recordFiles[v.prefsPath()] = file;
    v.applyPrefs(file);
    expect(strsOf(cardOf(v))).toContain(bad);
    onOf(cardOf(v), "th-rule-1", "on_click")({}, cx);
    typeIn(v, "example", "Fixed in ACME-7.", cx);
    onOf(cardOf(v), "th-rule-keep", "on_click")({}, cx);
    expect(v.prefsNotes).toContain(bad);
    expect(strsOf(cardOf(v))).toContain(bad);
    await settleAll(cx);
    expect(lastLinks()[0].example).toBe("Fixed in ACME-7.");
    expect(JSON.parse(settingsWrites.at(-1)).senders).toEqual([{ pattern: "^From (\\w+):" }]);
    for (const press of [() => v.toggleRule(1, cx), () => v.removeRule(1, cx)]) {
      press();
      expect(strsOf(cardOf(v))).toContain(bad);
      await settleAll(cx);
      expect(strsOf(cardOf(v))).toContain(bad);
    }
  } finally { done(v); }
});

const ABCD = ["A", "B", "C", "D"].map((n) => ({ name: n, pattern: `\\b${n}-(\\d+)\\b`, url: `https://${n.toLowerCase()}.example/$1` }));

test("an open rule follows its rule when the list changes under it: Keep never writes over another rule", async () => {
  const { v, cx } = await rulesPane(ABCD);
  try {
    // Open C, remove A from its row, keep C: C changes, D stays.
    onOf(cardOf(v), "th-rule-3", "on_click")({}, cx);
    v.removeRule(0, cx);
    expect(v.ruleEdit.at).toBe(1);
    typeIn(v, "example", "C-7", cx);
    onOf(cardOf(v), "th-rule-keep", "on_click")({}, cx);
    await settleAll(cx);
    expect(lastLinks().map((r) => [r.name, r.example ?? null])).toEqual([["B", null], ["C", "C-7"], ["D", null]]);
    // A hand edit that adds a rule above: the open rule follows it.
    v.applyPrefs(JSON.stringify({ links: ABCD }));
    onOf(cardOf(v), "th-rule-3", "on_click")({}, cx);
    v.applyPrefs(JSON.stringify({ links: [{ name: "X", pattern: "\\bX-(\\d+)\\b", url: "https://x.example/$1" }, ...ABCD] }));
    expect(v.ruleEdit.at).toBe(3);
    typeIn(v, "name", "C2", cx);
    v.keepRule(cx);
    await settleAll(cx);
    expect(lastLinks().map((r) => r.name)).toEqual(["X", "A", "B", "C2", "D"]);
    // A hand edit that changes the open rule: it becomes a new rule where it was, typed text kept.
    v.applyPrefs(JSON.stringify({ links: ABCD }));
    onOf(cardOf(v), "th-rule-3", "on_click")({}, cx);
    typeIn(v, "example", "C-9", cx);
    v.applyPrefs(JSON.stringify({ links: [ABCD[0], ABCD[1], { ...ABCD[2], url: "https://c.example/x/$1" }, ABCD[3]] }));
    expect([v.ruleEdit.at, v.ruleEdit.insertAt, v.ruleEdit.lost]).toEqual([null, 2, true]);
    expect(strsOf(cardOf(v))).toContain("This rule changed in the file or was removed. Keep rule adds it as a new rule.");
    v.keepRule(cx);
    await settleAll(cx);
    expect(lastLinks().map((r) => [r.name, r.url])).toEqual([["A", ABCD[0].url], ["B", ABCD[1].url], ["C", ABCD[2].url], ["C", "https://c.example/x/$1"], ["D", ABCD[3].url]]);
  } finally { done(v); }
});

test("Undo puts a removed rule back beside the same neighbor, whatever was added meanwhile", async () => {
  const { v, cx } = await rulesPane(ABCD);
  try {
    v.removeRule(2, cx); // C, after B
    await settleAll(cx);
    // A rule kept above it, here and by hand.
    onOf(cardOf(v), "th-rule-1", "on_click")({}, cx);
    v.duplicateRule();
    v.keepRule(cx);
    await settleAll(cx);
    v.applyPrefs(JSON.stringify({ links: [{ name: "X", pattern: "\\bX-(\\d+)\\b", url: "https://x.example/$1" }, ...lastLinks()] }));
    recordFiles[v.prefsPath()] = v.prefsRaw;
    expect(v.linkList.map((r) => r.name)).toEqual(["X", "A", "A copy", "B", "D"]);
    v.undoRemove(cx);
    await settleAll(cx);
    expect(lastLinks().map((r) => r.name)).toEqual(["X", "A", "A copy", "B", "C", "D"]);
    // The first rule removed goes back before the rule that followed it.
    v.removeRule(0, cx);
    await settleAll(cx);
    expect(lastLinks()[0].name).toBe("A");
    v.applyPrefs(JSON.stringify({ links: [{ name: "Y", pattern: "\\bY-(\\d+)\\b", url: "https://y.example/$1" }, ...lastLinks()] }));
    recordFiles[v.prefsPath()] = v.prefsRaw;
    v.undoRemove(cx);
    await settleAll(cx);
    expect(lastLinks().map((r) => r.name).slice(0, 3)).toEqual(["Y", "X", "A"]);
  } finally { done(v); }
});

const NOT_LIST = "\"links\" in settings.json is not a list, so the rule change was not saved. Fix the file first.";
const MOVED = "The rules in settings.json changed while this change was saved, so it was not saved. The list shows the file now.";

// Review of PR 97, M2: a hand edit that makes "links" a string is never written over.
test("Undo, Delete and the switch write nothing while \"links\" in the file is not a list, and the card says why", async () => {
  const { v, cx } = await rulesPane();
  try {
    onOf(cardOf(v), "th-rule-delete-btn-1", "on_click")({}, cx);
    await settleAll(cx);
    expect(strsOf(cardOf(v))).toContain("Deleted Ticket.");
    // In an editor "links" becomes the string "oops", and the pane reads it.
    const oops = `${JSON.stringify({ textSize: 15, links: "oops" }, null, 2)}\n`;
    recordFiles[v.prefsPath()] = oops;
    v.applyPrefs(oops);
    settingsWrites.length = 0;
    onOf(cardOf(v), "th-rule-undo", "on_click")({}, cx);
    await settleAll(cx);
    expect(settingsWrites).toEqual([]);
    expect(recordFiles[v.prefsPath()]).toBe(oops);
    const c = cardOf(v);
    expect(strsOf(c)).toContain(NOT_LIST);
    expect(strsOf(c)).toContain("\"links\" in the settings file is not a list now, so rules change only in the file until it is fixed.");
    expect(v.ruleUndo).not.toBe(null); // Undo waits for the file to be fixed
    // Delete and the switch are not drawn now; called anyway, they write nothing and say why.
    expect(idsIn(c)).not.toContain("th-rule-delete-btn-2");
    expect(idsIn(c)).not.toContain("th-rule-on-2");
    for (const press of [() => v.removeRule(0, cx), () => v.toggleRule(0, cx)]) {
      v.prefsError = null;
      press();
      await settleAll(cx);
      expect(settingsWrites).toEqual([]);
      expect(v.prefsError).toBe(NOT_LIST);
    }
    expect(recordFiles[v.prefsPath()]).toBe(oops);
    // The file fixed: Undo puts the rule back.
    const fixed = JSON.stringify({ textSize: 15, links: [RULES[1]] });
    recordFiles[v.prefsPath()] = fixed;
    v.applyPrefs(fixed);
    expect(strsOf(cardOf(v))).not.toContain(NOT_LIST);
    onOf(cardOf(v), "th-rule-undo", "on_click")({}, cx);
    await settleAll(cx);
    expect(lastLinks()).toEqual(RULES);
  } finally { done(v); }
});

test("a press that races the hand edit to a non-list \"links\" (the pane has not read it yet) writes nothing and says why", async () => {
  for (const which of ["delete", "switch", "undo"]) {
    const { v, cx } = await rulesPane();
    try {
      settingsStale = true;
      if (which === "undo") { v.removeRule(0, cx); await settleAll(cx); }
      const before = v.prefsRaw;
      const oops = JSON.stringify({ textSize: 15, links: "oops" });
      recordFiles[v.prefsPath()] = oops; // on disk, not read yet
      settingsWrites.length = 0;
      const c = cardOf(v);
      expect(v.prefsRaw).toBe(before);
      if (which === "delete") onOf(c, "th-rule-delete-btn-1", "on_click")({}, cx);
      if (which === "switch") onOf(c, "th-rule-on-1", "on_click")({}, cx);
      if (which === "undo") onOf(c, "th-rule-undo", "on_click")({}, cx);
      await settleAll(cx);
      expect(settingsWrites).toEqual([]);
      expect(recordFiles[v.prefsPath()]).toBe(oops);
      // The pane shows the file as it is, and the card says why.
      expect(v.prefsRaw).toBe(oops);
      expect(v.linkList).toEqual([]);
      expect(strsOf(cardOf(v))).toContain(NOT_LIST);
    } finally { done(v); }
  }
});

// Review of PR 97, L1: the card's change to the rules never replaces a newer list in the file.
test("a rule change whose save finds the file's rules changed writes nothing over them; a change to other keys still merges", async () => {
  const { v, cx } = await rulesPane();
  try {
    settingsStale = true;
    // An editor adds a rule in the same moment as the switch is pressed.
    const X = { name: "X", pattern: "\\bX-(\\d+)\\b", url: "https://x.example/$1" };
    const edited = JSON.stringify({ textSize: 15, links: [X, ...RULES] });
    recordFiles[v.prefsPath()] = edited;
    settingsWrites.length = 0;
    onOf(cardOf(v), "th-rule-on-1", "on_click")({}, cx);
    expect(v.links.map((r) => r.name)).toEqual(["Hash"]); // shown at once
    await settleAll(cx);
    expect(settingsWrites).toEqual([]);
    expect(recordFiles[v.prefsPath()]).toBe(edited);
    expect(v.linkList.map((r) => [r.name, r.on])).toEqual([["X", true], ["Ticket", true], ["Hash", true]]);
    expect(strsOf(cardOf(v))).toContain(MOVED);
    // From the list it now shows, the same press is written.
    onOf(cardOf(v), "th-rule-on-2", "on_click")({}, cx);
    await settleAll(cx);
    expect(lastLinks()).toEqual([X, { ...RULES[0], on: false }, RULES[1]]);
    expect(strsOf(cardOf(v))).not.toContain(MOVED);
    // An editor changes only the text size: the rules match, so the change is written on top.
    const sized = JSON.stringify({ ...JSON.parse(recordFiles[v.prefsPath()]), textSize: 17 });
    recordFiles[v.prefsPath()] = sized;
    v.removeRule(0, cx);
    await settleAll(cx);
    const w = JSON.parse(settingsWrites.at(-1));
    expect(w.links).toEqual([{ ...RULES[0], on: false }, RULES[1]]);
    expect(w.textSize).toBe(17);
    expect(v.prefsError).toBe(null);
  } finally { done(v); }
});

// Second review of PR 97, N1: a Delete whose save is refused leaves no Undo behind, so Undo
// cannot write the rule a second time ("X, Ticket, Ticket, Hash").
test("a Delete that is not saved because the file's rules changed offers no Undo", async () => {
  const { v, cx } = await rulesPane();
  try {
    settingsStale = true;
    const X = { name: "X", pattern: "\\bX-(\\d+)\\b", url: "https://x.example/$1" };
    const edited = JSON.stringify({ textSize: 15, links: [X, ...RULES] });
    recordFiles[v.prefsPath()] = edited; // an editor adds a rule as Delete is pressed
    settingsWrites.length = 0;
    onOf(cardOf(v), "th-rule-delete-btn-1", "on_click")({}, cx);
    await settleAll(cx);
    expect(settingsWrites).toEqual([]);
    expect(recordFiles[v.prefsPath()]).toBe(edited);
    expect(v.linkList.map((r) => r.name)).toEqual(["X", "Ticket", "Hash"]);
    expect(v.ruleUndo).toBe(null);
    const s = strsOf(cardOf(v));
    expect(s).toContain(MOVED);
    expect(s.some((x) => String(x).startsWith("Deleted "))).toBe(false);
    expect(idsIn(cardOf(v))).not.toContain("th-rule-undo");
    // A Delete that is saved still offers Undo, and Undo puts the rule back once.
    settingsStale = false;
    onOf(cardOf(v), "th-rule-delete-btn-2", "on_click")({}, cx);
    await settleAll(cx);
    expect(lastLinks()).toEqual([X, RULES[1]]);
    expect(idsIn(cardOf(v))).toContain("th-rule-undo");
    onOf(cardOf(v), "th-rule-undo", "on_click")({}, cx);
    await settleAll(cx);
    expect(lastLinks()).toEqual([X, ...RULES]);
  } finally { done(v); }
});

// Review of PR 97, L2: the open rule's example follows the session's repository.
test("the open rule's example is worked out again when the session's repository changes", async () => {
  const PR = { name: "PR", type: "pull-request", pattern: "(?<![\\w&/#])#(\\d{1,5})\\b", url: "https://github.com/{repo}/pull/$1", example: "Merged in #58." };
  const { v, cx } = await rulesPane([PR]);
  try {
    v.remote = { key: "t4|null", repo: "acme/exports", owner: "acme", host: "github.com", why: "test" };
    onOf(cardOf(v), "th-rule-1", "on_click")({}, cx);
    expect(strsOf(cardOf(v))).toContain("https://github.com/acme/exports/pull/58");
    // Another session, in another repository: no key is typed in the rule.
    v.remote = { ...v.remote, repo: "acme/billing" };
    frame(v, cx);
    let s = strsOf(cardOf(v));
    expect(s).toContain("https://github.com/acme/billing/pull/58");
    expect(s).not.toContain("https://github.com/acme/exports/pull/58");
    v.remote = { ...v.remote, repo: null, owner: null, why: "no git remote origin" };
    frame(v, cx);
    s = strsOf(cardOf(v));
    expect(s).toContain("This session has no repository, so this rule links nothing here.");
    expect(v.ruleEdit.draft.example).toBe("Merged in #58.");
  } finally { done(v); }
});

test("the settings card stays open and as it was when the pane's session changes", async () => {
  const f = sharedFolder();
  f.record(5101, SESSION_A);
  f.record(5102, SESSION_B);
  hcBy = { t3c: fg(5101, f.cwd), t3b: fg(5102, f.cwd) };
  const { v, cx } = sharedState(f, "t3c");
  try {
    await looked(v);
    expect(shownPrompts(v)).toEqual(["Prompt in session A"]);
    v.action("settings", cx);
    v.setTab = "general";
    v.setPage = "links";
    onOf(cardOf(v), "th-rule-1", "on_click")({}, cx);
    typeIn(v, "name", "Pull", cx);
    const before = idsIn(cardOf(v));
    // The terminal's agent moves to session B (a /clear or a resume).
    f.record(5101, SESSION_B);
    v.resolve(cx);
    await looked(v);
    expect(v.current().file).toEndWith(`${SESSION_B}.jsonl`);
    expect(shownPrompts(v)).toContain("Prompt in session B");
    expect([v.settingsOpen, v.setTab, v.setPage]).toEqual([true, "general", "links"]);
    expect(v.ruleEdit.draft.name).toBe("Pull");
    const c = frame(v, cx);
    expect(idsIn(c)).toEqual(expect.arrayContaining(["th-set-card", "th-rule-keep"]));
    expect(idsIn(cardOf(v))).toEqual(before);
    // Still closes as before.
    v.key(keyEv("escape"), cx);
    v.key(keyEv("escape"), cx);
    expect(v.settingsOpen).toBe(false);
  } finally {
    hcBy = {};
    recordFiles = {};
  }
});

// Herdr tells a mod pane it lost focus only through its pane's focused flag (read in react);
// there is no blur event for the pane in the API or the stubs.
test("the settings card stays open and as it was when the pane loses focus, and the keys work when it comes back", async () => {
  const { v, cx } = await rulesPane();
  try {
    state.panes[1].focused = true;
    v.react(cx);
    onOf(cardOf(v), "th-rule-1", "on_click")({}, cx);
    typeIn(v, "example", "Fixed in ACME-7.", cx);
    const before = idsIn(cardOf(v));
    // Focus goes to the terminal's pane.
    state.panes[1].focused = false;
    state.panes[0].focused = true;
    v.react(cx);
    const c = frame(v, cx);
    expect([v.settingsOpen, v.setPage, v.ruleEdit?.at]).toEqual([true, "links", 0]);
    expect(v.ruleEdit.draft.example).toBe("Fixed in ACME-7.");
    expect(idsIn(c)).toContain("th-set-card");
    expect(idsIn(cardOf(v))).toEqual(before);
    // Back: the pane takes the keyboard, and Esc closes the rule, then the card.
    state.panes[0].focused = false;
    state.panes[1].focused = true;
    v.react(cx);
    v.key(keyEv("escape"), cx);
    expect(v.ruleEdit).toBe(null);
    expect(v.settingsOpen).toBe(true);
    v.key(keyEv("escape"), cx);
    expect(v.settingsOpen).toBe(false);
  } finally {
    delete state.panes[0].focused;
    delete state.panes[1].focused;
    done(v);
  }
});

test("a rule whose address is on github.com links only when the session's origin is on GitHub; elsewhere it says why", async () => {
  const { v, cx } = await rulesPane([
    { name: "PR", type: "pull-request", pattern: "(?<![\\w&/#])#(\\d{1,5})\\b", url: "https://github.com/{repo}/pull/$1", example: "Merged in #58." },
    { name: "MR", pattern: "!(\\d+)\\b", url: "https://gitlab.com/{repo}/-/merge_requests/$1", example: "See !12." },
  ]);
  try {
    v.remote = { ...v.remote, repo: "acme/exports", owner: "acme", host: "gitlab.com" };
    expect(v.linkOne("Merged in #58 and !12.").md).not.toContain("github.com");
    expect(v.linkOne("Merged in #58 and !12.").md).toContain("https://gitlab.com/acme/exports/-/merge_requests/12");
    expect(strsOf(cardOf(v))).toContain("This repository is on gitlab.com, not GitHub, so this rule links nothing here.");
    onOf(cardOf(v), "th-rule-1", "on_click")({}, cx);
    expect(strsOf(cardOf(v))).toContain("This repository is on gitlab.com, not GitHub, so this rule links nothing here.");
    v.closeRule();
    v.remote = { ...v.remote, host: "github.com" };
    expect(v.linkOne("Merged in #58.").md).toContain("https://github.com/acme/exports/pull/58");
    expect(strsOf(cardOf(v))).toContain("https://github.com/acme/exports/pull/58");
    v.remote = { ...v.remote, host: "ssh.github.com" };
    expect(v.linkOne("Merged in #58.").md).toContain("https://github.com/acme/exports/pull/58");
  } finally { done(v); }
});
