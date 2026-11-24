// The reader's own movements of the list (readerMoved): every way the reader moves the list or
// leaves the view counts once, and no scroll the pane makes itself counts. Nothing reads the
// count yet; a step or a card's scroll kept for later will be called off when it moves.
//
// Three walks, each failing on anything with no row in its table:
// - every action a key gives (keyAction, over every key with and without Shift, in the list
//   and in the search field), run once each: the count goes up by its row's figure;
// - every pointer handler the built pane draws, in the states below, run once each the same
//   way;
// - the pane's own scrolls, by name: each function's body has no call to readerMoved.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keyAction } from "../mods/agent-threads/ui.js";
import { H, fixture, pane, pinsShown, root, settleRows, setup } from "./render-harness.js";

setup();

const SRC = readFileSync(join(root, "mods/agent-threads/main.js"), "utf8");
const moves = (v) => v.readerMoves ?? 0;

// ---- the keys ----
// Each action a key can give, and whether it is the reader's movement (1) or not (0).
const ACTIONS = {
  prev: 1, next: 1, first: 1, latest: 1, olderMatch: 1, newerMatch: 1, open: 1, jump: 1, prevDay: 1, nextDay: 1,
  outline: 1, pinned: 1, trajectory: 1, select: 1, legend: 1, deeper: 1, shallower: 1, filter: 1, escape: 1,
  "go:1": 1, "go:2": 1, "go:3": 1, "go:4": 1, "go:5": 1, "go:6": 1, "go:7": 1,
  copy: 0, quote: 0, focus: 0, settings: 0, keys: 0, agents: 0, narrower: 0, wider: 0, fit: 0, pin: 0, undoUnpin: 0,
};
const NAMED = ["up", "down", "left", "right", "home", "end", "enter", "space", "escape", "tab", "backspace", "delete", "pageup", "pagedown"];
const PRINTABLE = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789[]-=,./?;'`\\#"];
function keyNames() {
  const out = new Set();
  for (const key of [...NAMED, ...PRINTABLE]) for (const shift of [false, true]) for (const filtering of [false, true]) {
    const name = keyAction({ key, modifiers: { shift } }, filtering, "q");
    if (name) out.add(name);
  }
  return [...out].sort();
}

test("every action a key gives has a row, and each counts as its row says", async () => {
  const names = keyNames();
  expect(names.filter((n) => !(n in ACTIONS))).toEqual([]);
  const { v, cx } = await pane(fixture("--open", "--extra", "30"));
  settleRows(v, cx);
  const got = {};
  for (const name of names) {
    v.sel = v.sel ?? v.turnKeys(v.rows()).at(-1);
    const n0 = moves(v);
    try { v.action(name, cx); } catch (e) { got[name] = `threw ${e?.message}`; continue; }
    got[name] = moves(v) - n0;
    // Back to the list, as far as a key can take it.
    for (let k = 0; k < 4 && v.action("escape", cx); k++);
    if (v.traj) v.leaveTraj();
  }
  expect(got).toEqual(Object.fromEntries(names.map((n) => [n, ACTIONS[n]])));
}, 60000);

test("a key goes through the same count: j once, and a key with no action not at all", async () => {
  const { v, cx } = await pane(fixture("--extra", "10"));
  settleRows(v, cx);
  const n0 = moves(v);
  v.key({ key: "j", modifiers: {} }, cx);
  const n1 = moves(v);
  v.key({ key: "x", modifiers: {} }, cx);
  expect([n1 - n0, moves(v) - n1]).toEqual([1, 0]);
});

// ---- the pointer handlers ----
// Each handler the built pane draws, by its method and its element's id (digits as N), and
// whether running it is the reader's movement (a figure, or what decides it in that state). A
// row's event is what the handler is run with: a press, a wheel of 3 lines up, or a list
// item's key.
const PRESS = {};
const WHEEL = { delta: { y: 120 }, delta_lines: { y: 3 } };
const HANDLERS = [
  // The list: a press on a row (click), also in the Turn card and in a row's own list (yg:),
  // and the wheel over it.
  ["on_item_click", /^(threads-listbox|th-details-hover|yg:N:N)$/, 1, "item"],
  // Under a card over the list (covered), the wheel moves the card, not the list.
  ["on_scroll_wheel", /^threads-listbox$/, (v) => (v.covered() ? 0 : 1), WHEEL],
  // The header and the search field: the search opened or closed, the Pinned view, the
  // Trajectory; the settings card's buttons are not moves.
  ["on_click", /^th-search$/, 1, PRESS],
  ["on_click", /^th-clear$/, 1, PRESS],
  // A press on the field opens the search; on an open one it moves nothing.
  ["on_mouse_down", /^th-search-field$/, (v) => (v.filtering ? 0 : 1), PRESS],
  ["on_click", /^th-pinned$/, 1, PRESS],
  ["on_click", /^th-traj$/, 1, PRESS],
  ["on_click", /^th-settings$/, 0, PRESS],
  ["on_click", /^th-agents$/, 0, PRESS],
  // The Pinned view's unpin button, and a toast, which only keeps a press from what is under it.
  ["on_click", /^th-pin$/, 0, PRESS],
  ["on_click", /^th-toast$/, 0, PRESS],
  ["on_click", /^th-latest-pill$/, 1, PRESS],
  // The rail: its wheel (only once it is cut), an end's dot, a tick, a card's pin.
  ["on_scroll_wheel", /^th-rail$/, (v) => (v.railCut ? 1 : 0), WHEEL],
  ["on_click", /^th-rail-(up|down)$/, 1, PRESS],
  ["on_click", /^th-tick-N$/, 1, PRESS],
  ["on_click", /^th-rail-card-pin$/, 1, PRESS],
  // The Trajectory in this pane: back to the Chat leaves it; its failed-call arrows and rows
  // move the Trajectory's own list, not the Chat's.
  ["on_click", /^th-traj-chat$/, 1, PRESS],
  ["on_click", /^th-traj-fail-(prev|next)$/, 0, PRESS],
  ["on_item_click", /^tr:N:N:N$/, 0, "item"],
  // The keys sheet: its close, its scrim and the sheet itself.
  ["on_click", /^th-keys(-close|-scrim)?$/, 0, PRESS],
  ["on_scroll_wheel", /^th-keys-scrim$/, 0, WHEEL],
  // The agent's badge and state line: they focus the terminal.
  ["on_click", /^th-(badge|state)$/, 0, PRESS],
  // The Pinned view's unpin buttons: a pin taken off, which moves nothing.
  ["on_mouse_down", /^th-unpin-N$/, 0, PRESS],
  ["on_click", /^th-unpin-N$/, 0, PRESS],
  // The session picker: a session switch.
  ["on_click", /^th-choice-N$/, 1, PRESS],
  ["on_click", /^th-choose-cancel$/, 0, PRESS],
  // The settings card and everything on it.
  ["on_click", /^th-set-.*$/, 0, PRESS],
  ["on_mouse_down", /^th-set-card$/, 0, PRESS],
  ["on_mouse_down_out", /^th-set-card$/, 0, PRESS],
  ["on_scroll_wheel", /^th-set-.*$/, 0, WHEEL],
  ["on_click", /^th-(agent)?[bB]ubbleColor-.*$/, 0, PRESS],
  ["on_click", /^th-rail-(left|right)$/, 0, PRESS],
  ["on_click", /^th-textSize-(minus|plus)$/, 0, PRESS],
  // The body's press and pointer (where a press lands, for a press that did not move).
  ["on_mouse_down", /^threads-body$/, 0, { local_position: { x: 10, y: 10 }, bounds: { width: 400 } }],
];
const POINTER = new Set(["on_click", "on_mouse_down", "on_mouse_up", "on_scroll_wheel", "on_item_click", "on_mouse_down_out"]);

// The handlers one frame draws: [method, id with digits as N, the id, the handler].
function handlers(v, cx) {
  H.rec = [];
  v.render(cx);
  const c = H.rec;
  H.rec = null;
  const out = [];
  let id = null;
  for (const call of c) {
    if (call[0] === "id") id = String(call[1]);
    else if (POINTER.has(call[0])) out.push([call[0], (id ?? "-").replace(/\d+/g, "N"), id, call.at(-1)]);
  }
  return out;
}
const rowOf = (method, id) => HANDLERS.find(([m, re]) => m === method && re.test(id));

// The states the walk draws: the list, the search open, the outline, the settings card, the
// Pinned view, and the list scrolled up (the Jump to latest pill).
const STATES = {
  list: () => {},
  search: (v, cx) => v.action("filter", cx),
  outline: (v, cx) => v.action("outline", cx),
  settings: (v, cx) => v.action("settings", cx),
  pinned: (v, cx) => v.action("pinned", cx),
  // The list scrolled up from the end, drawn 3 rows at a time: the Jump to latest pill.
  scrolled: (v) => { v.follow = false; v.sel = v.turnKeys(v.rows())[0]; H.listWindow = () => ({ start: 0, end: 3 }); },
  // The rail with the first turn's card open, in a list short enough that the rail is cut: its
  // wheel, and the dot at its bottom end for the running turn below the window.
  rail: (v, cx) => { v.width = 560; v.listH = 120; v.render(cx); v.action("debugRailCard:1", cx); },
  trajectory: (v, cx) => v.action("trajectory", cx),
  // The keys sheet, the Turn card, and the Pinned view with one pin.
  keys: (v, cx) => v.action("keys", cx),
  card: (v, cx) => v.action("legend", cx),
  // The Pinned view with three pins, and its unpin buttons' layer (its own pane).
  pins: { make: async () => { const { v, cx } = await pinsShown(["--extra", "6"], [1, 3, 5]); v.listH = 700; return { v, cx }; }, enter: () => {} },
  // The session picker, with this session as its one choice.
  choosing: (v) => { v.choices = [{ path: v.res.path, label: "This session" }]; v.choosing = true; },
};

test("every pointer handler the pane draws has a row, and each counts as its row says", async () => {
  const missing = new Set();
  const wrong = [];
  const ran = new Set();
  const used = new Set();
  for (const [state, s] of Object.entries(STATES)) {
    H.listWindow = null;
    const enter = s.enter ?? s;
    const { v, cx } = s.make ? await s.make() : await pane(fixture("--open", "--extra", "30"));
    if (!s.make) settleRows(v, cx);
    enter(v, cx);
    v.render(cx);
    const item = v.rows().filter((r) => r.key != null).at(-1)?.key;
    for (const [method, nid, id, fn] of handlers(v, cx)) {
      const row = rowOf(method, nid);
      if (!row) { missing.add(`${method} ${nid}`); continue; }
      used.add(row);
      const k = `${state} ${method} ${nid}`;
      if (ran.has(k)) continue;
      ran.add(k);
      const ev = row[3] === "item" ? item : row[3];
      const want = typeof row[2] === "function" ? row[2](v) : row[2];
      const n0 = moves(v);
      try { fn(ev, cx); } catch (e) { wrong.push(`${k}: threw ${e?.message}`); continue; }
      if (moves(v) - n0 !== want) wrong.push(`${k}: ${moves(v) - n0}, not ${want} (${id})`);
      // Back to the state, for the next handler.
      for (let j = 0; j < 4 && v.action("escape", cx); j++);
      if (v.traj) v.leaveTraj();
      enter(v, cx);
      v.render(cx);
    }
    H.listWindow = null;
  }
  expect([...missing].sort()).toEqual([]);
  expect(wrong).toEqual([]);
  // Every row is some handler's: a row the walk never reaches stands for nothing.
  expect(HANDLERS.filter((r) => !used.has(r)).map(([m, re]) => `${m} ${re}`)).toEqual([]);
}, 120000);

// ---- the pane's own scrolls ----
// Every place the Chat scrolls itself: following a growing reply (read), the selected turn
// gone after a build (reselectVisible), following again (applyStick), the newest turn after a
// build (latestAfterBuild), the scroll a stopped render asked for again (render), a pin's
// landing's second step (bodyNow), a session's first draw (openOver, openFinish), the place
// put back after a stopped row draw (rowCut), the scroll handles themselves (askScroll,
// askEnd), and jumpLatest, which the reader reaches only through its callers (End, the pill:
// the action latest). None of them counts.
const PANE = ["read", "reselectVisible", "applyStick", "latestAfterBuild", "render", "bodyNow", "openOver", "openFinish", "rowCut", "askScroll", "askEnd", "jumpLatest"];
function body(name) {
  const at = SRC.search(new RegExp(`^  (async )?${name}\\(`, "m"));
  if (at < 0) return null;
  const next = SRC.slice(at + 1).search(/^ {2}(async )?[A-Za-z_]\w*\([^)]*\) \{$/m);
  return SRC.slice(at, next < 0 ? undefined : at + 1 + next);
}
test("no scroll the pane makes itself counts as the reader's", () => {
  const found = Object.fromEntries(PANE.map((n) => [n, body(n) == null ? "missing" : body(n).includes("readerMoved") ? "counts" : "no"]));
  expect(found).toEqual(Object.fromEntries(PANE.map((n) => [n, "no"])));
});

test("the pane's own scrolls leave the count: a reply growing while following, a build, and a stopped render's scroll asked for again", async () => {
  const { v, cx } = await pane(fixture("--extra", "20"));
  settleRows(v, cx);
  const n0 = moves(v);
  v.jumpLatest(true);
  v.latestAfterBuild();
  v.follow = true;
  v.stickStep = "repin";
  v.applyStick();
  v.renderOpen = true;
  v.renderWant = { toBottom: true, scrollTo: null };
  v.render(cx);
  v.reselectVisible();
  v.render(cx);
  expect(moves(v)).toBe(n0);
});

// Herdr's field reports a value the pane sets as a change, as typing is (the pane's other
// fields guard against it: quoteSetting, ruleSetting); the harness's does not, so this test
// makes it, and counts the change events it sends. For each step: what the field holds before
// and after, the change events sent, and the count's move. Typing counts once per change;
// Escape, the field's x, g and a search command count once each, and the change their value
// sets does not count again (with the pane's value set straight on the field, as before
// setSearchField, Escape, the x and g would each count twice).
test("the search field: typing counts, and a value the pane sets does not count again", async () => {
  const { v, cx } = await pane(fixture("--extra", "10"));
  settleRows(v, cx);
  const input = v.input;
  const own = input.set_value;
  let changes = 0;
  const change = () => { changes++; input.handlers.change(null, cx); };
  input.set_value = (x) => { own(x); change(); };
  const type = (x) => { own(x); change(); };
  const clear = () => handlers(v, cx).find(([m, nid]) => m === "on_click" && nid === "th-clear")[3](PRESS, cx);
  const step = (f) => {
    const before = input.value();
    const n0 = moves(v);
    const c0 = changes;
    f();
    return { field: [before, input.value()], changes: changes - c0, moves: moves(v) - n0 };
  };
  const got = {
    open: step(() => v.action("filter", cx)),
    typed: step(() => type("Turn")),
    escape: step(() => v.action("escape", cx)),
    jump: step(() => v.action("jump", cx)),
    typedAgain: step(() => type("#3")),
    x: step(clear),
    command: step(() => v.action("search:Turn", cx)),
  };
  expect(got).toEqual({
    open: { field: ["", ""], changes: 0, moves: 1 },
    typed: { field: ["", "Turn"], changes: 1, moves: 1 },
    escape: { field: ["Turn", ""], changes: 1, moves: 1 },
    jump: { field: ["", "#"], changes: 1, moves: 1 },
    typedAgain: { field: ["#", "#3"], changes: 1, moves: 1 },
    x: { field: ["#3", ""], changes: 1, moves: 1 },
    command: { field: ["", "Turn"], changes: 1, moves: 1 },
  });
  expect(v.query).toBe("Turn");
});

// A wheel over a list too short to scroll moves nothing, and counts nothing; a wheel of no
// delta neither.
test("a wheel that moves nothing does not count", async () => {
  const { v, cx } = await pane(fixture());
  settleRows(v, cx);
  const n0 = moves(v);
  v.listWheel({ delta: { y: 0 } });
  const short = v.rowsMemo?.[0]?.kind === "spacer";
  v.listWheel({ delta: { y: 120 } });
  expect(moves(v) - n0).toBe(short ? 0 : 1);
});

// A scroll the list reports with no wheel since the last frame (its own bar) counts once; the
// frame after a wheel does not count that wheel again.
test("a scroll the list reports counts once, and not again after a wheel", async () => {
  const { v, cx } = await pane(fixture("--extra", "30"));
  settleRows(v, cx);
  const rows = v.rows();
  v.follow = false;
  v.scrollTo = null;
  v.stickCheck(rows, false, 20);
  const n0 = moves(v);
  v.stickCheck(rows, false, 10);
  const bar = moves(v) - n0;
  v.listWheel({ delta: { y: 120 } });
  const n1 = moves(v);
  v.stickCheck(rows, false, 5);
  expect({ bar, wheel: n1 - n0 - bar, after: moves(v) - n1 }).toEqual({ bar: 1, wheel: 1, after: 0 });
});
