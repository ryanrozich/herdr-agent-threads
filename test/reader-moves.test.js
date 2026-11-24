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
import { cardKey, keyAction, ledgerKey, ringKey } from "../mods/agent-threads/ui.js";
import { trajCompact } from "../mods/agent-threads/ledger.js";
import { H, drawRange, fixture, keyEv, pane, pinsShown, root, settleRows, setup, state } from "./render-harness.js";

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

// Every key key() takes ahead of keyAction, walked through key() itself: the Trajectory's
// own keys (ledgerKey) while it shows in this pane, the settings card's ring (Tab, Shift Tab,
// and Enter or Space on a control: ringKey) and its scroll keys (cardKey), and every key
// while a field in the card has the keyboard. A key none of them takes goes on to keyAction,
// whose rows are above. Leaving the Trajectory (y, Esc) is the reader's: the Chat scrolls to
// the Trajectory's turn. Its other keys move the Trajectory's own list.
const LEDGER = {
  lprev: 0, lnext: 0, lfirst: 0, llast: 0, ldetail: 0, lfail: 0, lfailBack: 0, luser: 0, luserBack: 0,
  trajectory: 1, escape: 1, focus: 0, settings: 0, keys: 0, narrower: 0, wider: 0,
};
const RING = { next: 0, back: 0, press: 0 };
const CARD = { down: 0, up: 0, pagedown: 0, pageup: 0, home: 0, end: 0 };
function allKeys() {
  const out = [];
  for (const key of [...NAMED, ...PRINTABLE]) for (const shift of [false, true]) out.push({ key, modifiers: { shift } });
  return out;
}
const label = (e) => `${e.modifiers.shift ? "shift-" : ""}${e.key}`;
// What a key that goes on to keyAction counts (the first walk's rows).
const onward = (v, e) => { const n = keyAction(e, v.filtering, v.quoteKey); return n ? ACTIONS[n] ?? `no row for ${n}` : 0; };
const BEFORE = {
  // The Trajectory in this pane (y in a Chat under its split width).
  trajectory: {
    enter: (v, cx) => { v.paneW = 400; v.width = 400; v.action("trajectory", cx); v.tdetail = false; },
    check: (v) => v.traj && !v.trajPane,
    want: (_v, e) => { const n = ledgerKey(e); return n ? LEDGER[n] ?? `no row for ${n}` : 0; },
  },
  // The settings card, its ring on nothing and then on its first control that is not a field.
  settings: {
    enter: (v, cx) => { v.action("settings", cx); },
    check: (v) => v.settingsOpen && !v.fieldFocused,
    want: (v, e) => { const r = ringKey(e, Boolean(v.cardRing)); if (r) return RING[r]; const c = cardKey(e); return c ? CARD[c] : onward(v, e); },
  },
  ring: {
    enter: (v, cx) => { v.action("settings", cx); v.render(cx); for (let k = 0; k < 20 && (k === 0 || v.fieldFocused); k++) v.action("ring:next", cx); },
    check: (v) => v.settingsOpen && Boolean(v.cardRing) && !v.fieldFocused,
    want: (v, e) => { const r = ringKey(e, true); if (r) return RING[r]; const c = cardKey(e); return c ? CARD[c] : onward(v, e); },
  },
  // A field in the card has the keyboard: its keys are its own, and Esc closes the card.
  field: {
    enter: (v, cx) => { v.action("settings", cx); v.fieldFocused = "quoteKey"; },
    check: (v) => v.settingsOpen && Boolean(v.fieldFocused),
    want: (_v, e) => (ringKey(e, false) ? RING[ringKey(e, false)] : 0),
  },
};
test("every key key() takes ahead of keyAction counts as its row says: the Trajectory's, the settings card's ring and scroll, a field's", async () => {
  const got = {};
  const wanted = {};
  const states = [];
  for (const [state, s] of Object.entries(BEFORE)) {
    const { v, cx } = await pane(fixture("--open", "--extra", "30"));
    settleRows(v, cx);
    const back = () => {
      for (let k = 0; k < 4 && (v.keysOpen || v.settingsOpen || v.filtering || v.query) && v.action("escape", cx); k++);
      v.fieldFocused = null;
      if (v.traj) v.leaveTraj();
      v.sel = v.sel ?? v.turnKeys(v.rows()).at(-1);
      s.enter(v, cx);
      v.render(cx);
    };
    back();
    states.push([state, s.check(v)]);
    for (const e of allKeys()) {
      const k = `${state} ${label(e)}`;
      const want = s.want(v, e);
      const n0 = v.readerMoves ?? 0;
      const ask = v.scrollTo;
      try { v.key(e, cx); } catch (err) { got[k] = `threw ${err?.message}`; wanted[k] = want; back(); continue; }
      got[k] = (v.readerMoves ?? 0) - n0;
      // A key that counts nothing asks the list for no scroll either.
      if (!got[k] && v.scrollTo && v.scrollTo !== ask) got[k] = "asked the list to scroll";
      wanted[k] = want;
      back();
    }
  }
  expect(states).toEqual(Object.keys(BEFORE).map((k) => [k, true]));
  expect(got).toEqual(wanted);
}, 120000);

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
  // The Trajectory in this pane: back to the Chat (its label button, or its icon at the
  // compact width) leaves it; its failed-call arrows and rows move the Trajectory's own list,
  // not the Chat's.
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
  // Its Link rules and Senders pages: a rule opened, added, turned on or off, edited or
  // deleted, and how a sender's name is written. The rows draw again with the new links or
  // names, which moves nothing of the reader's.
  ["on_click", /^th-(rule|sender)-.*$/, 0, PRESS],
  ["on_click", /^th-textSize-(minus|plus)$/, 0, PRESS],
  // The body's press and pointer (where a press lands, for a press that did not move), and
  // the pointer moving over it (a drag past the slop selects text, which moves nothing).
  ["on_mouse_down", /^threads-body$/, 0, { local_position: { x: 10, y: 10 }, bounds: { width: 400 } }],
  ["on_mouse_move", /^threads-body$/, 0, { local_position: { x: 12, y: 12 }, position: { x: 12, y: 12 } }],
  // The pointer over the pane (the floating top's icons), a pin's row (its unpin button), the
  // rail (its ticks) or a tick's card: they show things and move nothing.
  ["on_hover", /^(threads-root|th-unpin-row-N|th-rail|th-tick-N|th-tick-card-N|th-rail-card-box)$/, 0, true],
  // The pane's keys: a key with no action here; every key is walked through key() below.
  ["on_key_down", /^threads-root$/, 0, keyEv("x")],
];
const POINTER = new Set(["on_click", "on_mouse_down", "on_mouse_up", "on_scroll_wheel", "on_item_click", "on_mouse_down_out", "on_mouse_move", "on_hover", "on_key_down"]);

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
  // The Trajectory in this pane at its compact width: its Chat button is an icon.
  trajIcon: { enter: (v, cx) => { v.paneW = 150; v.width = 150; v.action("trajectory", cx); }, check: (v) => v.traj && trajCompact(v.trajPx()) != null },
  // A search kept with its field shown and not typing in: a press on the field takes the
  // typing back.
  kept: { enter: (v, cx) => { v.action("search:Turn", cx); v.filtering = false; }, check: (v) => Boolean(v.query) && !v.filtering },
  // The settings card's Link rules and Senders pages.
  links: (v, cx) => { v.action("settings", cx); v.action("settingsPage:links", cx); },
  senders: (v, cx) => { v.action("settings", cx); v.action("settingsPage:senders", cx); },
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
    if (s.check && !s.check(v)) wrong.push(`${state}: not the state its row names`);
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
      const ask = v.scrollTo;
      try { fn(ev, cx); } catch (e) { wrong.push(`${k}: threw ${e?.message}`); continue; }
      if (moves(v) - n0 !== want) wrong.push(`${k}: ${moves(v) - n0}, not ${want} (${id})`);
      // A handler that counts nothing asks the list for no scroll either.
      else if (!want && v.scrollTo && v.scrollTo !== ask) wrong.push(`${k}: asked the list to scroll and counted nothing (${id})`);
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
  // The handlers only these states draw ran: the Trajectory's Chat button in both its forms,
  // and the field's press with the search kept and not typing in.
  expect(["trajectory on_click th-traj-chat", "trajIcon on_click th-traj-chat", "kept on_mouse_down th-search-field"].filter((k) => !ran.has(k))).toEqual([]);
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
// The source with its comments taken out: a line comment to its line's end, a block comment
// whole. Strings and template strings are kept as they are, so a "//" in one is not a comment.
function code(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
// Whether this source calls readerMoved (in its code, not its comments).
const callsReaderMoved = (src) => /\breaderMoved\s*\(/.test(code(src));
test("no scroll the pane makes itself counts as the reader's", () => {
  const found = Object.fromEntries(PANE.map((n) => [n, body(n) == null ? "missing" : callsReaderMoved(body(n)) ? "counts" : "no"]));
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
// delta neither. Two turns fit a pane 2000 px tall: the spacer above them says so.
test("a wheel that moves nothing does not count", async () => {
  const { v, cx } = await pane(fixture("--only", "2"));
  v.listH = 2000;
  settleRows(v, cx);
  const fits = v.rows()[0]?.kind === "spacer" && v.rowsMemo?.[0]?.kind === "spacer";
  const n0 = moves(v);
  v.listWheel({ delta: { y: 0 } });
  const none = moves(v) - n0;
  v.listWheel({ delta: { y: 120 } });
  expect({ fits, none, fitting: moves(v) - n0 - none }).toEqual({ fits: true, none: 0, fitting: 0 });
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

// The outline and the Pinned view scroll on the same list: a scroll it reports with no wheel
// since the last frame (a drag on its bar) counts once there too, a wheel there counts once
// (the frame after it does not count it again), and the pane's own scrolls there (a scroll
// asked for, the way down to the end) do not count.
const VIEWS = {
  "the outline": async () => {
    const { v, cx } = await pane(fixture("--extra", "30"));
    settleRows(v, cx);
    v.action("outline", cx);
    return { v, cx };
  },
  "the Pinned view": async () => {
    const { v, cx } = await pinsShown(["--extra", "10"], [1, 2, 3, 4, 5, 6, 7]);
    return { v, cx };
  },
};
for (const [where, make] of Object.entries(VIEWS)) test(`in ${where}, a scroll the list reports counts once, a wheel once, and the pane's own scrolls not at all`, async () => {
  const { v, cx } = await make();
  v.listH = 100;
  v.render(cx);
  const rows = v.rows();
  v.follow = false;
  v.scrollTo = null;
  v.scrollBusyUntil = 0;
  v.toBottom = false;
  v.pinningUntil = 0;
  const step = (f) => { const n0 = moves(v); f(); return moves(v) - n0; };
  v.stickCheck(rows, false, 20);
  const got = {
    view: v.view === "pinned" ? "pinned" : v.outlined() ? "outline" : "list",
    bar: step(() => v.stickCheck(rows, false, 10)),
    wheel: step(() => { v.listWheel({ delta: { y: 120 } }); v.stickCheck(rows, false, 7); }),
    asked: step(() => { v.scrollTo = { key: rows.at(-1).key, how: "center" }; v.stickCheck(rows, false, 4); v.scrollTo = null; }),
    toEnd: step(() => { v.toBottom = true; v.stickCheck(rows, false, 2); v.toBottom = false; }),
  };
  expect(got).toEqual({ view: where === "the outline" ? "outline" : "pinned", bar: 1, wheel: 1, asked: 0, toEnd: 0 });
});

// The check on the pane's own scrolls reads the source: a comment naming readerMoved is not a
// call, and a call is one even after a string holding "//".
test("the source check counts a call to readerMoved, not a comment naming it", () => {
  const cases = {
    comment: "  read() {\n    // the reader's own: readerMoved() is not called here\n    this.follow = true;\n  }\n",
    block: "  read() {\n    /* this.readerMoved() */\n    this.follow = true;\n  }\n",
    call: "  read() {\n    this.readerMoved(); // the reader's\n  }\n",
    afterString: "  read() {\n    const u = \"https://example.com\"; this.readerMoved();\n  }\n",
  };
  expect(Object.fromEntries(Object.entries(cases).map(([k, src]) => [k, callsReaderMoved(src)]))).toEqual({ comment: false, block: false, call: true, afterString: true });
});

// N1: a draw Herdr stops part way (its time limit) while the list reports a scroll of its
// bar. Stopped at the count itself, the start is not yet written, so the next frame counts
// the scroll; stopped after the count (in scrolledBy), the start is written, so the next
// frames do not count it again. Run through the list's draw (drawRange), where a stop is
// caught (drawFailed) and the frame goes on.
test("a draw stopped at a bar scroll's count counts it on the next frame, and one stopped after the count does not count it twice", async () => {
  const { v, cx } = await pane(fixture("--extra", "30"));
  settleRows(v, cx);
  const run = (at) => {
    v.follow = false;
    v.scrollTo = null;
    v.scrollBusyUntil = 0;
    v.toBottom = false;
    v.pinningUntil = 0;
    drawRange(v, 20);
    const n0 = moves(v);
    let stops = 0;
    const own = v[at];
    v[at] = function (...a) { if (!stops++) throw new Error("stopped"); return own.apply(this, a); };
    drawRange(v, 10);
    drawRange(v, 10);
    drawRange(v, 10);
    delete v[at];
    return { stops: Math.min(stops, 1), moves: moves(v) - n0 };
  };
  expect({ atCount: run("readerMoved"), afterCount: run("scrolledBy") }).toEqual({ atCount: { stops: 1, moves: 1 }, afterCount: { stops: 1, moves: 1 } });
});

// The Trajectory's ways back to the Chat each count once: y, Esc, its Chat button (above),
// and the trajectory action itself run while it shows (a command, or code that calls it).
test("leaving the Trajectory counts once by each way out", async () => {
  const { v, cx } = await pane(fixture("--open", "--extra", "30"));
  settleRows(v, cx);
  v.paneW = 400;
  v.width = 400;
  const ways = {
    y: () => v.key(keyEv("y"), cx),
    escape: () => v.key(keyEv("escape"), cx),
    command: () => v.command("trajectory", cx),
    action: () => v.action("trajectory", cx),
    leave: () => v.leaveTraj(),
  };
  const got = {};
  for (const [way, f] of Object.entries(ways)) {
    v.action("trajectory", cx);
    v.tdetail = false;
    const inTraj = v.traj;
    const n0 = moves(v);
    f();
    got[way] = { inTraj, left: !v.traj, moves: moves(v) - n0 };
  }
  expect(got).toEqual(Object.fromEntries(Object.keys(ways).map((k) => [k, { inTraj: true, left: true, moves: 1 }])));
});

// syncSel: the Trajectory pane beside the Chat selected another turn, and the Chat scrolls to
// it. That is the reader's move, made in the other pane. The same turn again moves nothing.
test("the Trajectory pane beside the Chat moving its selection counts once in the Chat", async () => {
  const { v, cx } = await pane(fixture("--extra", "30"));
  settleRows(v, cx);
  state.panes.push({ pane: "p3", tab: "A", terminal: null, mod: "agent-threads" });
  state.shared["threads.trajByTerminal"] = { [v.terminal]: { pane: "p3" } };
  const keys = v.turnKeys(v.rows());
  const pick = keys.find((k) => k !== v.sel);
  const n0 = moves(v);
  state.shared["threads.turnSel"] = { [v.terminal]: { key: pick, by: "other", at: Date.now() + 1000, pane: "trajectory" } };
  const took = v.syncSel();
  const once = moves(v) - n0;
  state.shared["threads.turnSel"] = { [v.terminal]: { key: pick, by: "other", at: Date.now() + 2000, pane: "trajectory" } };
  const again = v.syncSel();
  expect({ took, sel: v.sel === pick, once, again, after: moves(v) - n0 - once }).toEqual({ took: true, sel: true, once: 1, again: false, after: 0 });
});

// The commands the pane takes (a mod command, a script's herdr-app do, and the Herdr still
// tests' debug commands), run through command() as Herdr sends them. Every form action()
// reads (a case, a name it compares, a prefix, a pattern) has a row: its command, and what it
// counts. One with no row fails. Forms a key also gives count as the key walk's rows say.
// debugScroll counts: it stands for the reader's scroll in the still tests, which have no
// pointer (as debugClick stands for a press and debugRailJump for a tick's), so a kept step
// or a card's scroll is called off there as it would be by the reader.
const COMMANDS = {
  "outline:on": ["outline:on", 1], "outline:off": ["outline:off", 1],
  "pick:": ["pick:1", 1], "search:": ["search:Turn", 1], "go:": ["go:1", 1], "(go|pick|search):": ["search:Turn", 1],
  choose: ["choose", 0], unpinSel: ["unpinSel", 0], keyHints: ["keyHints", 0], statusLine: ["statusLine", 0], alwaysTime: ["alwaysTime", 0],
  "railSide:left": ["railSide:left", 0], "railSide:right": ["railSide:right", 0], truncate: ["truncate", 0],
  agentsQuiet: ["agentsQuiet", 0], agentRail: ["agentRail", 0], "agents:on": ["agents:on", 0], "agents:off": ["agents:off", 0],
  resetSettings: ["resetSettings", 0],
  "settingsScroll:down": ["settingsScroll:down", 0], "settingsScroll:up": ["settingsScroll:up", 0], "settingsScroll:pagedown": ["settingsScroll:pagedown", 0],
  "settingsScroll:pageup": ["settingsScroll:pageup", 0], "settingsScroll:home": ["settingsScroll:home", 0], "settingsScroll:end": ["settingsScroll:end", 0],
  "settingsPage:links": ["settingsPage:links", 0], "settingsPage:senders": ["settingsPage:senders", 0], "settingsPage:main": ["settingsPage:main", 0],
  "ring:next": ["ring:next", 0], "ring:back": ["ring:back", 0], "ring:press": ["ring:press", 0],
  "(bubbleColor|agentBubbleColor):": ["bubbleColor:teal", 0], "(textSize|promptLines|replyLines):": ["textSize:15", 0],
  "debugWidth:": ["debugWidth:400", 0], debugLift: ["debugLift", 0], "debugRailJump:": ["debugRailJump:1", 1], "debugRailCard:": ["debugRailCard:1", 0],
  "debugScroll:": [(v) => `debugScroll:${v.turnKeys(v.rows())[0]}`, 1], "debugHover:": ["debugHover:1", 0], debugDayPill: ["debugDayPill", 0],
  "debugClick:": [(v) => `debugClick:40:${v.turnKeys(v.rows())[0]}`, 1], debugQuote: ["debugQuote", 0],
};
// action()'s forms, read from its code.
function forms() {
  const b = code(body("action"));
  const out = new Set();
  for (const m of b.matchAll(/case "([^"]+)"/g)) out.add(m[1]);
  for (const m of b.matchAll(/name === "([^"]+)"/g)) out.add(m[1]);
  for (const m of b.matchAll(/name\.startsWith\("([^"]+)"\)/g)) out.add(m[1]);
  for (const m of b.matchAll(/\/\^(\(?[^/]*?:)/g)) out.add(m[1]);
  return [...out].sort();
}
test("every command form the pane takes has a row, and each counts as its row says", async () => {
  const all = forms();
  expect(all.filter((f) => !(f in COMMANDS) && !(f in ACTIONS) && !(`${f}1` in ACTIONS))).toEqual([]);
  const { v, cx } = await pane(fixture("--open", "--extra", "30"));
  settleRows(v, cx);
  const got = {};
  const want = {};
  for (const f of all) {
    const [cmd, n] = COMMANDS[f] ?? [f in ACTIONS ? f : `${f}1`, ACTIONS[f] ?? ACTIONS[`${f}1`]];
    const name = typeof cmd === "function" ? cmd(v) : cmd;
    // A session switch picks from the picker's list: this session as its one choice.
    if (f === "pick:") { v.choices = [{ path: v.res.path, label: "This session" }]; v.choosing = true; }
    if (f.startsWith("ring:") || f.startsWith("settings")) { v.action("settings", cx); v.render(cx); }
    v.sel = v.sel ?? v.turnKeys(v.rows()).at(-1);
    const n0 = moves(v);
    const ask = v.scrollTo;
    try { v.command(name, cx); } catch (e) { got[f] = `threw ${e?.message}`; want[f] = n; continue; }
    got[f] = moves(v) - n0;
    // A command that counts nothing asks the list for no scroll either.
    if (!got[f] && v.scrollTo && v.scrollTo !== ask) got[f] = "asked the list to scroll";
    want[f] = n;
    for (let k = 0; k < 4 && v.action("escape", cx); k++);
    if (v.traj) v.leaveTraj();
    v.choosing = false;
    v.render(cx);
  }
  expect(got).toEqual(want);
}, 60000);
