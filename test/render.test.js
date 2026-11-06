// bun test: runs the panel's drawing code with gpui-kit and Herdr replaced by stubs, so an
// error in render() fails here instead of in a window. Every element method returns the same
// chainable stub; .when() and .hover() run their callbacks, and the virtual list draws every
// item. The pane reads synthetic fixtures through the real extractor (exec runs it).
import { test, expect, mock } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { stats, segments, reply } from "../mods/agent-threads/turns.js";
import { join } from "node:path";

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
let focusCalls = 0;
const never = () => new Promise(() => {});
// What the last v_virtual_list was given: its sizes and item keys.
let lastList = null;
// settings(): the person's Herdr settings (zoom, fonts).
let herdrSettings = { font_family: "Mono" };
// updates().app.version: Herdr's version.
let herdrVersion = "0.1.13";
mock.module("gpui-kit", () => ({ View: class {}, div: () => el, svg: () => el, image: () => el }));
mock.module("gpui-base", () => ({
  v_flex: () => el, h_flex: () => el,
  InputState: { new: () => ({ on() {}, value: () => "", set_value() {}, focus() {} }) },
  Input: { new: () => el }, Scrollbar: { vertical: () => el },
  VirtualListScrollHandle: { new: () => ({ scroll_to_bottom() {}, scroll_to_item() {} }) },
  v_virtual_list: (_id, n, sizes, keyOf, draw) => {
    lastList = { sizes: [...sizes], keys: [] };
    for (let i = 0; i < n; i++) { if (!(sizes[i] > 0)) throw new Error(`item ${keyOf(i)} has height ${sizes[i]}`); lastList.keys.push(keyOf(i)); }
    draw({ start: 0, end: n });
    return el;
  },
  TextView: { markdown: (id, md) => { mdSources.push([id, md]); const calls = []; views.push({ id, md, calls }); if (rec) rec.push(["TextView", id]); return viewEl(calls); } }, Editor: { new: () => el }, EditorState: { new: () => { const st = { handlers: {}, release() {}, on(ev, f) { st.handlers[ev] = f; return true; } }; editors.push(st); return st; } },
}));
// With marks set, exec records when the script hands off ("out") and gets its answer back
// ("in"), so a test can time the synchronous stretches between awaits.
let marks = null;
const stamp = (what) => { if (marks) marks.push([what, performance.now()]); };
mock.module("herdr", () => ({
  exec: async (cmd, args) => {
    stamp("out");
    try { return execReal(cmd, args); } finally { stamp("in"); }
  },
  hc: async (args) => { log.push(["hc", ...args]); return { code: 0, stdout: hcBy[args[1]] ?? hcOut, stderr: "" }; },
  ...herdrRest(),
}));
function execReal(cmd, args) {
    try { return { code: 0, stdout: execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] }), stderr: "" }; }
    catch (e) { return { code: e.status ?? 1, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") }; }
}
function herdrRest() { return {
  home: () => "/home/test", appHome: () => app,
  updates: () => ({ app: { version: herdrVersion } }),
  readTextFile: async (p) => recordFiles[p] ?? null, writeTextFile: async () => null, watchFolder: never,
  theme: () => theme, themes: () => [{ name: "test", colors: theme }], settings: () => herdrSettings,
  panes: () => state.panes, terminals: () => state.terminals, spaces: () => [{ tabs: [{ id: "A", name: "work" }] }],
  focused: () => focusNow, props: () => state.props,
  run: (name, args) => { log.push(["run", name, args ?? null]); if (name === "pane.focus") afterFocus(args); return null; },
  shared: (k) => state.shared[k], setShared: (k, v) => { state.shared[k] = v; },
  closeOverlay: () => null, notify: () => null, nextCommand: never,
}; }

// main.js finds its scripts under appHome()/mods/agent-threads.
execFileSync("mkdir", ["-p", join(app, "mods")]);
execFileSync("cp", ["-R", modDir, join(app, "mods/agent-threads")]);
const { default: Threads } = await import("../mods/agent-threads/main.js");

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
      v.full = new Set(s.turns.flatMap((t) => [`0:${t.n}`, `r:0:${t.n}`, `l:0:${t.n}`]));
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
  // drop the person's own turns: every turn hidden
  w.current().turns = w.current().turns.filter((t) => t.agent);
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

test("the action bar acts only inside each button", async () => {
  const { v } = await pane(fixture("--only", "2"));
  v.sel = v.turnKeys(v.rows())[0];
  v.width = 380;
  // Copy reply 16–123, Select 129–221, Quote (icon) 227–257, Terminal 271–364.
  expect(v.barHit(20, 380)).toBe("copy");
  expect(v.barHit(170, 380)).toBe("select");
  expect(v.barHit(240, 380)).toBe("quote");
  expect(v.barHit(264, 380)).toBe(null);
  expect(v.barHit(350, 380)).toBe("terminal");
  v.width = 240;
  // Copy 16–99, Select 105–135, Quote 141–171, Terminal 194–224 (icons).
  expect(v.barHit(120, 240)).toBe("select");
  expect(v.barHit(150, 240)).toBe("quote");
  expect(v.barHit(215, 240)).toBe("terminal");
  expect(v.barHit(182, 240)).toBe(null);
  // No pane shows the terminal: no Quote and no Terminal, so Select keeps its label.
  state.panes = state.panes.filter((p) => p.terminal !== "t4");
  expect(v.barHit(150, 240)).toBe("select");
  expect(v.barHit(230, 240)).toBe(null);
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
  expect(v.rowDetail(v.rows().find((r) => r.kind === "copy"))).toContain("Formatted");
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
  v.click(`st:${key}`, cx);
  expect(focusCalls).toBe(before + 2);
  st.handlers.blur();
  expect(v.editorFocused).toBe(false);
  v.action("escape", cx);
  expect(v.selecting).toBe(null);
});

// F3: the selected running turn's working card is sized with the line heights it draws.
test("the working card's estimate uses the 21 px prompt and 20 px note lines it draws", async () => {
  const { v } = await pane(fixture("--only", "0", "--agents", "--open"));
  let seen = 0;
  for (const width of [240, 380, 640]) {
    v.width = width;
    v.fitKey = null;
    const r = v.rows().find((x) => x.kind === "working");
    if (!r) continue;
    seen++;
    const tw = v.inner() - 2;
    const est = v.estimate(r);
    // The smallest it can be: one prompt line, one chip row, one note line.
    expect(est).toBeGreaterThanOrEqual(8 + 2 + 20 + 18 + 8 + 21 + 8 + 27 + 3 + 20);
    // Each prompt line counts 21 px and each note line 20 px, at the card's text width.
    const prompt = v.wrapped(r.turn.prompt.split("\n").slice(0, 3).join("\n"), tw, 6.2);
    const note = v.wrapped("No final reply yet. It appears here when Claude finishes this turn.", tw, 6.0);
    expect(est).toBeGreaterThanOrEqual(8 + 2 + 20 + 18 + 8 + Math.min(6, prompt) * 21 + 8 + 27 + 3 + note * 20 - 21 * 3);
    rec = [];
    v.workingItem(theme, r);
    const lh = rec.filter(([n]) => n === "line_height").map(([, x]) => x);
    rec = null;
    expect(lh).toContain("21px");
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
  const { newSession, apply } = await import("../mods/agent-threads/turns.js");
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
  const { apply } = await import("../mods/agent-threads/turns.js");
  apply(s, { k: "t", t: "Noted." });
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
    const tw = (await import("../mods/agent-threads/ui.js")).rowTextWidth(w, true);
    const room = v.labelRoom(t1, tw);
    // icon 12 + label + time + #n + bell + gaps fit inside the text width
    const used = 12 + room + 8 * 6.6 + 4 * 7.2 + (13 + 2 * 6.6) + 6 * 5;
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
  expect(v.toast.text).toMatch(/^Quoted your selection into t4/);
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

test("the footer offers s select with a turn open and q quote with a local terminal", async () => {
  const { v, cx } = await quotePane();
  const hints = () => v.footerHints().map(([k, l]) => `${k} ${l}`);
  expect(hints()).toContain("s select");
  expect(hints().indexOf("q quote")).toBe(hints().indexOf("c copy reply") + 1);
  v.toggle(v.sel, cx);
  expect(hints()).not.toContain("s select");
  v.width = 240;
  expect(hints()).toEqual(["↑↓ move", "↵ open", "c copy", "/ filter"]);
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
  v.mouseX = v.pressX = v.bar(v.findTurn(key)).quote[0] + 4;
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

test("prompt quotes: rows draw a bar line within the budget, the card draws Markdown", async () => {
  const { v, cx } = await pane(fixture("--only", "0", "--quotes"));
  v.width = 380;
  draw(v, cx);
  const snap = () => state.shared["threads.debug"].t4;
  const turn = (n) => snap().detail.find((d) => d.startsWith(`turn#${n} `));
  // "> two lines\n\ncomment" at Prompt lines 2: one quote line, one comment line.
  expect(turn(3)).toMatch(/^turn#3 p2\/r\d q1 h\d+ /);
  expect(turn(3)).toContain("▎The retry path");
  expect(turn(1)).toMatch(/^turn#1 p\d\/r\d q\d qonly /);
  expect(turn(2)).toMatch(/^turn#2 p\d\/r\d h/);
  expect(turn(8)).toMatch(/^turn#8 p\d\/r\d h/); // the fence's ">" lines are code
  // Heights match the units.
  const { rowShape } = await import("../mods/agent-threads/ui.js");
  const t3 = v.current().turns[2];
  expect(v.shape(t3).height).toBe(rowShape({ prompt: t3.prompt.slice(0, 1200), reply: v.shape(t3).reply.join(" "), width: 380, promptLines: 2, replyLines: 3 }).height);
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
  expect(snap().detail.find((d) => d.startsWith("you#3"))).toMatch(/^you#3 YOU md q1 code0 links0 h\d+/);
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
  expect(snap().detail.find((d) => d.startsWith("you#3"))).toMatch(/^you#3 YOU hl q1/);
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
  let src = mdSources.find(([id]) => id === "th-you-you:0:3")[1];
  expect(src).toContain("TAIL\\-END");
  expect(src).not.toContain("more characters not shown");
  t3b.prompt = `${"word ".repeat(50000)}end`;
  mdSources.length = 0;
  draw(v, cx);
  src = mdSources.find(([id]) => id === "th-you-you:0:3")[1];
  expect(src).toMatch(/\*… 50,003 more characters not shown\*$/);
  t3b.prompt = keep;
  v.full.clear();
});

test("link rules: the open card's reply and prompt carry links, rows never do", async () => {
  const { v, cx } = await pane(fixture("--only", "0", "--links"));
  v.width = 380;
  v.applyPrefs(JSON.stringify({ links: [
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
  expect(v.rows().filter((r) => r.kind === "md").at(-1).links).toBe(0);
  const snap = state.shared["threads.debug"].t4;
  expect(snap.detail.find((d) => d.startsWith("md#1"))).toMatch(/^md#1 links 2 h\d+ \| \]\(https:\/\/linear\.app\/acme\/issue\/ACME-123\) \]\(https:\/\/github\.com\/acme\/widgets\/pull\/45\) /);
  expect(snap.detail.find((d) => d.startsWith("you#1"))).toMatch(/ md q1 code0 links3 /);
  expect(snap.links).toMatchObject({ count: 3, valid: 2 });
  // Collapsed rows stay plain text.
  v.open.clear();
  draw(v, cx);
  const row = state.shared["threads.debug"].t4.detail.find((d) => d.startsWith("turn#1"));
  expect(row).not.toContain("](");
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
  const keys = view.turnKeys(view.rows());
  view.toggle(keys.at(-2), r.cx);
  const openFrame = time(() => view.render(r.cx));
  const nextFrame = time(() => view.render(r.cx));
  require("node:fs").writeFileSync(process.env.THREADS_OUT, JSON.stringify({ longest, pcts, turns: view.current().turns.length, loaded: view.current().loaded, awaits: m.length / 2, toggleOn, toggleOff, openFrame, nextFrame }));
}, 120000);

test("S1: with JIT off the read's longest synchronous stretch is at most 25 ms, and the percentage rises chunk by chunk", () => {
  const out = join(mkdtempSync(join(tmpdir(), "threads-timing-")), "out.json");
  execFileSync("bun", ["test", join(root, "test/render.test.js"), "-t", "S1 child"], {
    env: { ...process.env, BUN_JSC_useJIT: "0", THREADS_CHILD: "read-timing", THREADS_OUT: out }, stdio: "ignore", timeout: 120000,
  });
  const r = JSON.parse(readFileSync(out, "utf8"));
  expect(r.loaded).toBe(true);
  expect(r.turns).toBe(1305);
  // The bounds below are for a developer machine. GitHub's shared runners measured about 1.3x
  // slower (32 ms, 207 ms), so CI allows twice each: the regressions they guard against (a
  // whole read parsed in one go, rows rebuilt per frame) cost several times more.
  const slow = process.env.CI ? 2 : 1;
  expect(r.longest).toBeLessThanOrEqual(25 * slow);
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
  console.log(`S1 timing, JIT off: longest stretch ${f(r.longest)} ms over ${r.awaits} awaits; percent ${r.pcts.join(", ")}; agents on ${f(r.toggleOn)} ms, off ${f(r.toggleOff)} ms; open-card frame ${f(r.openFrame)} ms, next ${f(r.nextFrame)} ms`);
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
    handlerAfterId(calls, "threads-body", "on_size_change")({ width: reported, height: 700 * zoom }, cx);
    rec = [];
    v.render(cx);
    const drawn = rec;
    rec = null;
    return { width: v.width, listH: v.listH, rows: v.rows().map((r) => r.key), est: [...v.sizesMemo], list: lastList, drawn };
  };
  try {
    for (const w of [240, 380, 640]) {
      const one = run(1, w);
      const z = run(0.9, w * 0.9);
      expect(z.width).toBeCloseTo(w, 6);
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
      expect(v.width).toBeCloseTo(w, 6);
      const g = v.barGeom(w, v.findTurn(key));
      for (const [name, b] of Object.entries(g)) {
        if (!b) continue;
        down({ local_position: { x: ((b[0] + b[1]) / 2) * 0.9, y: 10 }, bounds: { width: w * 0.9 } });
        v.sel = key;
        // Only the hit is checked: the handlers themselves are covered elsewhere.
        const hit = v.barHit(v.pressX, v.bodyW, v.findTurn(key));
        expect(hit).toBe(name);
        expect(v.bodyW).toBeCloseTo(w, 6);
      }
    }
  } finally { herdrSettings = { font_family: "Mono" }; }
});

// ---- round 3: V3b, measured heights, and C1, C3, C5 on top -------------------------------

const PROBED_KINDS = ["you", "rhead", "md", "lhead", "latest", "stats", "legend", "noreply"];
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
      expect(parts.map((r) => r.kind)).toEqual(expect.arrayContaining(["you", "rhead", "md", "lhead", "latest", "stats"]));
      const probes = probeEntries(frame(v, cx));
      expect([...probes.keys()].sort()).toEqual(parts.map((r) => r.key).sort());
      // Each part reports a height in zoomed px; the list then gets that part's size.
      const fed = new Map();
      parts.forEach((r, i) => {
        const H = r.kind === "latest" ? 4 * 21 : 40 + i * 13;
        fed.set(r.key, H);
        probes.get(r.key)({ width: v.inner() * zoom, height: H * zoom }, cx);
      });
      const calls = frame(v, cx);
      expect(probeEntries(calls).size).toBe(0); // measured parts leave the probe
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
      expect(rep.parts.find((x) => x.startsWith(`st:${key} `))).toMatch(/est \d+ · measured: \d+ · slot \d+/);
    }
  } finally { herdrSettings = { font_family: "Mono" }; }
});

test("V3b: reply and latest TextViews never scroll, and only the YOU box over 420 px does", async () => {
  const { v, cx } = await pane(fixture("--extra", "2", "--latest", "--langs", "--long", "--blocks"));
  v.open = new Set(v.current().turns.map((t) => `0:${t.n}`));
  v.full = new Set(v.current().turns.flatMap((t) => [`0:${t.n}`, `l:0:${t.n}`]));
  views.length = 0;
  frame(v, cx);
  const md = views.filter((x) => /^(th-probe-)?th-(md|lmd)-/.test(x.id));
  expect(md.length).toBeGreaterThan(5);
  for (const x of md) expect(x.calls.some(([n, a]) => n === "scrollable" && a === true)).toBe(false);
  const you = views.filter((x) => x.id.startsWith("th-you-"));
  const scrolls = you.filter((x) => x.calls.some(([n, a]) => n === "scrollable" && a === true));
  expect(scrolls.length).toBeGreaterThan(0); // the 40-line prompt with Show all
  for (const x of scrolls) expect(v.youMd(v.rows().find((r) => `th-you-${r.key}` === x.id)).capped).toBe(true);
  for (const x of views.filter((y) => y.id.startsWith("th-probe-"))) expect(x.calls.some(([n]) => n === "scrollable")).toBe(false);
});

test("V3b: the first-frame estimate is never under the 21 px line reference, and at most a line and 18 px over", async () => {
  const { wrappedLines } = await import("../mods/agent-threads/ui.js");
  const { v, cx } = await pane(fixture("--extra", "4", "--langs", "--edge", "--blocks"));
  v.open = new Set(v.current().turns.map((t) => `0:${t.n}`));
  for (const w of [240, 380, 640]) {
    v.forcedWidth = w; v.width = w; v.meas = new Map();
    let n = 0;
    for (const r of v.rows().filter((x) => x.kind === "md")) {
      const blocks = r.src.split(/\n{2,}/);
      const per = Math.floor(v.inner() / 6.1);
      const ref = 6 + blocks.reduce((h, b) => h + wrappedLines(b.replace(/[*_`#>]/g, ""), per) * 21, 0) + (blocks.length - 1) * 12;
      const est = v.estimate(r);
      expect(est).toBeGreaterThanOrEqual(ref);
      expect(est).toBeLessThanOrEqual(ref + 21 + 18);
      n++;
    }
    expect(n).toBeGreaterThan(5);
  }
  draw(v, cx);
});

test("C1: the counts line is in the stats part's probe entry, at 16 px lines of 0.6 em", async () => {
  const { v, cx } = await pane(fixture("--only", "2"));
  const key = v.turnKeys(v.rows())[0];
  v.open = new Set([key]);
  const line57 = "cache read 1,204,331 · written 12,345 · new input 123,456";
  expect(line57.length).toBe(57);
  // 57 characters × 6.6 px: 376 px, so 2 lines in a 240 px pane (208 px of text) and in a
  // 380 px one (348 px), 1 at 640.
  v.width = 240; expect(v.countsHeight(line57)).toBe(6 + 2 * 16);
  v.width = 380; expect(v.countsHeight(line57)).toBe(6 + 2 * 16);
  v.width = 640; expect(v.countsHeight(line57)).toBe(6 + 16);
  v.width = 380; expect(v.countsHeight(line57.slice(0, 50))).toBe(6 + 16);
  for (const w of [240, 380]) {
    v.forcedWidth = w; v.width = w; v.meas = new Map(); v.probeTries = new Map();
    const st = v.rows().find((r) => r.kind === "stats");
    const counts = v.countsLine(st.turn);
    expect(counts).toMatch(/^cache read /);
    const calls = frame(v, cx);
    const at = calls.findIndex(([n, x]) => n === "id" && String(x).startsWith(`th-probe-${st.key}-`));
    expect(at).toBeGreaterThanOrEqual(0);
    const next = calls.findIndex(([n, x], i) => i > at && n === "id" && String(x).startsWith("th-probe-"));
    const inProbe = calls.slice(at, next < 0 ? undefined : next);
    expect(inProbe.some(([n, x]) => n === "child" && x === counts)).toBe(true);
    expect(inProbe.some(([n, x]) => n === "line_height" && x === "16px")).toBe(true);
    expect(v.estimate(st)).toBeGreaterThanOrEqual(10 + 22 + v.countsHeight(counts));
  }
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
  const t = v.current().turns.find((x) => x.latest && x.latest !== v.replyText(x));
  const key = `0:${t.n}`;
  v.open = new Set([key]);
  try {
    for (const [zoom, reported] of [[1, 380], [0.9, 342]]) {
      herdrSettings = { font_family: "Mono", zoom };
      v.forcedWidth = null; v.meas = new Map(); v.probeTries = new Map();
      handlerAfterId(frame(v, cx), "threads-root", "on_size_change")({ width: reported, height: 800 }, cx);
      expect(v.width).toBeCloseTo(380, 6);
      const lt = v.rows().find((r) => r.kind === "latest");
      let calls = frame(v, cx);
      // The probe measures the block at the card's design text width.
      const at = calls.findIndex(([n, x]) => n === "id" && String(x).startsWith(`th-probe-${lt.key}-`));
      expect(calls.slice(at, at + 4).some(([n, x]) => n === "w" && x === v.inner())).toBe(true);
      expect(v.inner()).toBe(348);
      // One text child, not one per line.
      expect(calls.filter(([n, x]) => n === "child" && x === lt.text).length).toBe(2); // the list and the probe
      const feed = (lines) => probeEntries(calls).get(lt.key)({ width: 348 * zoom, height: lines * 21 * zoom }, cx);
      feed(4);
      expect(v.latestBox(lt)).toBe(84);
      expect(v.latestCut(lt)).toBe(false);
      expect(v.height(lt)).toBe(6 + 84);
      calls = frame(v, cx);
      expect(calls.some(([n, x]) => n === "child" && x === "Show all")).toBe(false);
      v.meas = new Map(); v.probeTries = new Map();
      calls = frame(v, cx);
      feed(9);
      expect(v.latestBox(lt)).toBe(126);
      expect(v.latestCut(lt)).toBe(true);
      expect(v.height(lt)).toBe(6 + 126 + 22);
      calls = frame(v, cx);
      expect(calls.some(([n, x]) => n === "child" && x === "Show all")).toBe(true);
      expect(calls.some(([n, x]) => n === "h" && x === 126)).toBe(true);
      // A click on it shows all.
      v.click(lt.key, cx);
      expect(v.full.has(`l:${key}`)).toBe(true);
      v.full.clear();
    }
  } finally { herdrSettings = { font_family: "Mono" }; }
});

// ---- round 3: C2, what the chips mean ------------------------------------------------------

test("C2: plain chip names, and i or a click on the stats shows a legend of the chips shown", async () => {
  const { v, cx } = await pane(fixture());
  const t = v.current().turns.find((x) => x.compactions > 0 && stats(x).cachePct != null);
  expect(t).toBeTruthy();
  const key = `0:${t.n}`;
  v.sel = key;
  v.open = new Set([key]);
  v.width = 380;
  const texts = v.statTexts(t);
  expect(texts[0]).toMatch(/^[\d.]+k? tokens$/);
  expect(texts).toContain("context compacted");
  expect(texts.some((x) => /^\d+ tool calls?$/.test(x))).toBe(true);
  expect(texts.some((x) => /^cache hit [\d.]+%$/.test(x))).toBe(true);
  expect(texts.some((x) => / tok$|^compacted$|^cache \d/.test(x))).toBe(false);
  const kinds = () => v.rows().filter((r) => partOf(r, key)).map((r) => r.kind);
  expect(kinds()).not.toContain("legend");
  expect(v.footerHints().map(([k, l]) => `${k} ${l}`)).toContain("i explain");
  v.key(keyEv("i"), cx);
  expect(kinds()).toContain("legend");
  expect(kinds().indexOf("legend")).toBe(kinds().indexOf("stats") + 1);
  const entries = v.legendEntries(t);
  // One entry per chip shown, context compacted first, then the counts line.
  expect(entries.length).toBe(texts.length + 1);
  expect(entries[0][1]).toMatch(/^context compacted: /);
  expect(entries[1][1]).toMatch(/^tokens: .*cache read count above\.$/);
  expect(entries.at(-1)[1]).toMatch(/^cache read · written · new input: /);
  // The legend is a measured part, drawn in the probe.
  v.meas = new Map(); v.probeTries = new Map();
  expect([...probeEntries(frame(v, cx)).keys()]).toContain(`lg:${key}`);
  draw(v, cx);
  expect(state.shared["threads.debug"].t4.detail.find((d) => d.startsWith(`legend#${t.n}`))).toMatch(/^legend#\d+ context compacted · tokens · /);
  v.key(keyEv("i"), cx);
  expect(kinds()).not.toContain("legend");
  // A click on the stats part toggles it too.
  v.click(`st:${key}`, cx);
  expect(kinds()).toContain("legend");
  v.click(`st:${key}`, cx);
  expect(kinds()).not.toContain("legend");
  // A turn without a cache count or compaction lists only its own chips.
  const plain = v.current().turns.find((x) => !x.compactions && stats(x).cachePct == null);
  if (plain) expect(v.legendEntries(plain).map((x) => x[1].split(":")[0])).toEqual(v.statChips(plain).map((c) => ({ tokens: "tokens", duration: "duration", model: "model · effort", tools: "tool calls" })[c[0]]));
  // The footer hint shows from 300 px, with a turn open.
  v.width = 240;
  expect(v.footerHints().map(([k, l]) => `${k} ${l}`)).not.toContain("i explain");
  v.width = 380;
  v.open.clear();
  expect(v.footerHints().map(([k, l]) => `${k} ${l}`)).not.toContain("i explain");
});

// ---- round 3: D1 ----------------------------------------------------------------------------

test("D1: FINAL REPLY, LATEST UPDATE, YOU and the counts line draw in muted, or foreground where muted is faint", async () => {
  const { v, cx } = await pane(fixture("--extra", "1", "--latest"));
  const t = v.current().turns.find((x) => x.latest && x.latest !== v.replyText(x));
  v.open = new Set([`0:${t.n}`]);
  v.width = 380;
  const colourOf = (calls, text) => {
    const i = calls.findIndex(([n, x]) => n === "child" && x === text);
    for (let j = i - 1; j >= 0 && j > i - 8; j--) if (calls[j][0] === "text_color") return calls[j][1];
    return null;
  };
  const counts = v.countsLine(t);
  let calls = frame(v, cx);
  for (const label of ["FINAL REPLY", "LATEST UPDATE", "YOU", counts]) expect(colourOf(calls, label)).toBe(theme.muted);
  // A theme whose muted reads under 4.5:1 on the card: foreground.
  const faint = { ...theme, muted: "#5a5a5a" };
  const real = theme.muted;
  try {
    Object.assign(theme, faint);
    calls = frame(v, cx);
    for (const label of ["FINAL REPLY", "LATEST UPDATE", "YOU", counts]) expect(colourOf(calls, label)).toBe(theme.foreground);
  } finally { theme.muted = real; }
  draw(v, cx);
  expect(state.shared["threads.debug"].t4.contrast[0]).toMatch(/ card label muted \([\d.]+ on raised\) /);
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

test("pasted images: thumbnails in rows from 300 px, a count when narrower, decoded on first draw, larger in the open card", async () => {
  const { v, cx } = await pane(fixture("--extra", "2", "--images"));
  const turns = v.current().turns.filter((t) => t.images.length);
  expect(turns.map((t) => t.images.map((i) => i.n))).toEqual([[1], [2, 3], [4]]);
  expect(turns.every((t) => /^[0-9a-f-]{36}$/.test(t.imgLine))).toBe(true);
  expect(turns[2].prompt).toBe("[Image #4]");
  const two = turns[1];
  const key = `0:${two.n}`;
  // 380 px: a strip of thumbnails adds a 40 px line to the row; 240 px: none, the meta
  // line counts them.
  v.width = 380;
  const at380 = v.shape(two).height;
  expect(v.shape(two).thumbs).toBe(true);
  expect(at380 - v.shape({ ...two, images: [], shapeKey: null }).height).toBe(43);
  v.width = 240;
  expect(v.shape(two).thumbs).toBeUndefined();
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
  // Open: one part per image after YOU, at most 260 px tall, never wider than its own size;
  // a click shows it at full size, and again folds it.
  v.toggle(key, cx);
  const parts = v.rows().filter((r) => r.kind === "img" && r.key.startsWith(`img:${key}:`));
  expect(parts.map((r) => r.i)).toEqual([0, 1]);
  const rows = v.rows();
  expect(rows[rows.findIndex((r) => r.key === `you:${key}`) + 1].kind).toBe("img");
  expect(v.imgBox(parts[0])).toEqual({ w: 130, h: 260 });
  expect(v.height(parts[0])).toBe(8 + 4 + 18 + 260);
  v.click(parts[0].key, cx);
  const big = v.rows().find((r) => r.key === parts[0].key);
  expect(big.full).toBe(true);
  expect(v.imgBox(big)).toEqual({ w: 300, h: 600 });
  v.click(parts[0].key, cx);
  expect(v.rows().find((r) => r.key === parts[0].key).full).toBe(false);
  // Drawn rows and cards hold image elements with the cached paths.
  rec = [];
  v.render(cx);
  const drawn = rec; rec = null;
  expect(drawn.some(([n]) => n === "size_full")).toBe(true);
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
