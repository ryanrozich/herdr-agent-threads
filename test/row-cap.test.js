// bun test: the list's window and capList's guard for Herdr's v_virtual_list, which takes at
// most 10,000 item sizes (TRD-116), on the render harness (test/render-harness.js). Moved whole
// from render.test.js when it grew past the 1 MiB Biome lints.
import { test, expect } from "bun:test";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

import {
  draw,
  dropTimers,
  fixture,
  frame,
  H,
  heldClock,
  keyEv,
  lastList,
  openAt,
  pane,
  paneWith,
  PINS,
  probeFrame,
  rec,
  scripted,
  settle,
  settleList,
  settleRows,
  setup,
  simList,
  state,
  stillAt,
  theme,
  until,
} from "./render-harness.js";
import { capList, LIST_MAX, RowWindow } from "../mods/agent-threads/ui.js";

setup();

// Up or down onto Show earlier or Show later scrolls to it. The landing asks for its item by key
// 16 and 48 ms on (rowIndex), and in a window capList has not cut, the fast answer for a key not
// in the session's rows was "none" for these two as well: no ask was made, and the selection
// could sit on an item off screen. Session of 150 short turns, the small window.
test("up onto Show earlier and down onto Show later scroll to it, in a window capList has not cut", async () => {
  noPins();
  const { v, cx } = await capSession(150, SMALL);
  v.jumpLatest(true);
  frames(v, cx);
  const got = [];
  // Up from the window's first turn onto Show earlier.
  v.sel = v.turnKeys(v.rows())[0];
  v.follow = false;
  let asked = scrollsOf(v);
  v.action("prev", cx);
  frames(v, cx);
  got.push([v.sel, Boolean(v.capCut), asked.filter((k) => k === "older").length > 0]);
  delete v.askScroll;
  // Show earlier pressed twice, so the window ends short of the session's end, then down from
  // its last turn onto Show later.
  v.action("open", cx);
  frames(v, cx);
  v.sel = v.turnKeys(v.rows())[0];
  v.action("prev", cx);
  v.action("open", cx);
  frames(v, cx);
  v.sel = v.turnKeys(v.rows()).at(-1);
  asked = scrollsOf(v);
  v.action("next", cx);
  frames(v, cx);
  got.push([v.sel, Boolean(v.capCut), asked.filter((k) => k === "newer").length > 0]);
  delete v.askScroll;
  expect(got).toEqual([["older", false, true], ["newer", false, true]]);
});


// A filter set, changed or cleared builds other rows, and the window was placed on them from
// its old edges, or from the oldest rows when the filtered list had none: clearing a filter of
// few matches left the selected turn outside the window, and with none selected (only a filter
// with no match leaves none) the rows that were on screen before the filter. The window is
// placed around the selected turn, or around what was on screen before the filter. Session of 300 short turns, the small window: "order 1" matches 111 prompts, more than the
// window holds, "order 19" 11, and "zzz" none.
test("a filter set, changed or cleared places the window around the selected turn, or around what was on screen when none is selected", async () => {
  const got = [];
  // The third pass builds the rows over several draws (a slice ends at every sixteenth turn), as
  // a session past the shipped cap always is: the window waits for the filter's rows.
  for (const [none, slices] of [[false, false], [true, false], [false, true]]) {
    const { v, cx } = await capSession(300, SMALL);
    const sim = simList(v);
    try {
      openAt(v, cx, sim, 562);
      let resumed = 0;
      if (slices) {
        delete v.shapeMax;
        v.buildMax = () => -1;
        const build = v.buildRows;
        v.buildRows = function (status, from, ...a) { if (from?.own) resumed++; return build.call(this, status, from, ...a); };
      }
      v.action("first", cx);
      settleList(v, cx, sim);
      v.command(`search:#${none ? 150 : 13}`, cx);
      v.command("escape", cx);
      settleList(v, cx, sim);
      if (none) v.sel = null;
      const key = none ? "0:150" : null;
      const look = (step) => got.push([step, v.sel, v.win.has(v.winList(), key ?? v.sel)]);
      const steps = none ? [["set", "zzz"], ["cleared", ""]] : [["set", "order 1"], ["changed", "order 19"], ["cleared", ""]];
      for (const [step, q] of steps) {
        v.command(`search:${q}`, cx);
        settleList(v, cx, sim);
        look(step);
      }
      if (slices) got.push(["resumed slices", resumed > 10]);
    } finally {
      H.listWindow = null;
    }
  }
  const one = [["set", "0:13", true], ["changed", "0:200", true], ["cleared", "0:200", true]];
  expect(got).toEqual([...one, ["set", null, false], ["cleared", null, true], ...one, ["resumed slices", true]]);
});

// ---- the list's window: Herdr's v_virtual_list takes at most 10,000 item sizes ----

// Turn i of a one-day session of short done turns, as the reader's events. long: a reply of
// parts paragraphs of 3,000 characters, which an open card draws as that many Markdown items.
// day: the day it is on, from 2026-11-01.
const capTurn = (i, long = false, parts = 25, day = 0) => {
  const ts = new Date(Date.UTC(2026, 10, 1 + day, 9, 0, 0) + i * 1000).toISOString();
  const said = long ? Array.from({ length: parts }, (_, j) => `Part ${j}: ${"word ".repeat(600)}`).join("\n\n") : `Reply ${i}: the order is fine.`;
  return [{ k: "p", o: "human", t: `Prompt ${i}: check order ${i}.`, ts }, { k: "t", t: said }, { k: "d", ts }];
};
async function capSession(n, cap = null, long = -1, parts = 25, dayOf = () => 0) {
  const ev = [];
  for (let i = 0; i < n; i++) ev.push(...capTurn(i, i === long, parts, dayOf(i)));
  const r = await scripted(ev);
  r.v.debug = false;
  if (cap) r.v.win.cap = { ...r.v.win.cap, ...cap };
  r.v.width = 560; r.v.rootH = 1100; r.v.listH = 1000;
  return r;
}
async function addCapTurns(s, from, n) {
  const { apply } = await import("../mods/agent-threads/core/turns.js");
  for (let i = from; i < from + n; i++) for (const e of capTurn(i)) apply(s, e);
  s.version++;
}
// A small window, for a session of 150 turns: past 60 items it slides to 50, and a reader up
// in the session sees it stop at 66.
const SMALL = { slide: 60, block: 10, stop: 66 };
// Every made-up session here has the same id, so its pins are the same in each test, and
// pins.json lasts the whole file. p toggles: a test that pins starts with none (as pinPane does).
const noPins = () => { delete H.recordFiles[PINS]; };
const EDGE = new Set(["gap", "spacer", "tail", "more"]);
const itemsIn = (v) => v.rows().filter((r) => !EDGE.has(r.kind)).length;
const inList = (v, k) => v.rows().some((r) => r.key === k);
// The keys of the items the pane asked the list to scroll to, and where a landing put a turn.
function scrollsOf(v) {
  const asked = [];
  const ask = v.askScroll.bind(v);
  v.askScroll = (i, how) => { asked.push(v.rowsMemo?.[i]?.key ?? null); ask(i, how); };
  return asked;
}
// Frames, with a return's wait for its card's measures (until, 400 ms) over at once.
function frames(v, cx, n = 4) { for (let f = 0; f < n; f++) { if (v.scrollTo?.until) v.scrollTo.until = 0; settleRows(v, cx); cx.flush(150); } }

test("capList: 10,000 items go to the list as they are, and one more keeps the newest 9,999 under a note", () => {
  expect(LIST_MAX).toBe(10000);
  const rows = Array.from({ length: 10000 }, (_, i) => ({ kind: "turn", key: `0:${i + 1}` }));
  const sizes = rows.map(() => 40);
  const at = capList(rows, sizes, LIST_MAX, 34);
  expect(at.cut).toBe(0);
  expect(at.rows).toBe(rows);
  expect(at.sizes).toBe(sizes);
  const past = capList([...rows, { kind: "turn", key: "0:10001" }], [...sizes, 40], LIST_MAX, 34);
  expect(past.rows.length).toBe(10000);
  expect(past.sizes.length).toBe(10000);
  expect(past.cut).toBe(2);
  expect(past.rows[0]).toMatchObject({ kind: "note", key: "capped", text: "2 earlier list items are not shown. Click to show them." });
  expect(past.sizes[0]).toBe(34);
  expect(past.rows[1].key).toBe("0:3");
  expect(past.rows.at(-1).key).toBe("0:10001");
});

test("a session of 10,050 turns draws, as a window of its newest 8,000 to 9,000 items under a Show earlier item", { timeout: 120000 }, async () => {
  const { v, cx } = await capSession(10050);
  v.jumpLatest(true);
  settleRows(v, cx);
  expect(v.baseRows.filter((r) => r.kind === "turn").length).toBe(10050);
  expect(lastList.sizes.length).toBeLessThanOrEqual(9000);
  expect(lastList.sizes.length).toBeGreaterThan(8000);
  const rows = v.rows();
  const more = rows.find((r) => r.kind === "more");
  expect(rows.indexOf(more)).toBeLessThanOrEqual(1); // under the floating top's gap, if any
  expect(more.key).toBe("older");
  const shown = v.turnKeys(rows);
  expect(more).toMatchObject({ text: `${(10050 - shown.length).toLocaleString()} earlier turns`, act: "Show earlier" });
  expect(shown.at(-1)).toBe("0:10050");
  expect(rows.at(-1).kind).toBe("tail");
  v.debug = true;
  v.report();
  expect(state.shared["threads.debug"].t4.listCap.fired).toBe(0);
  expect(state.shared["threads.debug"].t4.window).toMatchObject({ from: shown[0], to: null, earlier: 10050 - shown.length, later: 0 });
});

test("the list's last guard: at its cap every item goes to the list, and one past it the oldest give way to a note, counted in the debug report", async () => {
  const { v, cx } = await capSession(150, { slide: 1e9, stop: 1e9 });
  settleRows(v, cx);
  const n = v.rows().length;
  expect(v.rows().some((r) => r.kind === "more")).toBe(false);
  v.debug = true;
  v.win.cap = { ...v.win.cap, max: n };
  v.fitKey = null;
  draw(v, cx);
  expect(v.rows().length).toBe(n);
  expect(state.shared["threads.debug"].t4.listCap).toEqual({ max: n, fired: 0, cut: 0 });
  v.win.cap = { ...v.win.cap, max: n - 1 };
  v.fitKey = null;
  draw(v, cx);
  const rows = v.rows();
  expect(rows.length).toBe(n - 1);
  expect(lastList.sizes.length).toBe(n - 1);
  expect(rows[0]).toMatchObject({ kind: "note", key: "capped", text: "2 earlier list items are not shown. Click to show them." });
  expect(v.turnKeys(rows).at(-1)).toBe("0:150");
  // A row's index still finds it past the cut, and one cut away is not in the list.
  expect(v.rowIndex("0:150")).toBe(rows.findIndex((r) => r.key === "0:150"));
  expect(v.rowIndex(v.baseRows[0].key)).toBe(-1);
  const rep = state.shared["threads.debug"].t4.listCap;
  expect(rep.fired).toBeGreaterThanOrEqual(1);
  expect(rep).toMatchObject({ max: n - 1, cut: 2 });
});

test("a running session that grows past the window drops its oldest rows from the window in blocks, never from the session", async () => {
  const { v, cx, s } = await capSession(150, SMALL);
  v.jumpLatest(true);
  settleRows(v, cx);
  expect(itemsIn(v)).toBeLessThanOrEqual(60);
  expect(itemsIn(v)).toBeGreaterThanOrEqual(50);
  expect(v.turnKeys(v.rows()).at(-1)).toBe("0:150");
  const starts = new Set([v.turnKeys(v.rows())[0]]);
  // Each move of the start puts the view at the end again (the list keeps its offset in px).
  let ends = 0;
  v.scroll = { scroll_to_bottom() { ends++; }, scroll_to_item() {} };
  for (let i = 150; i < 180; i++) {
    const was = v.turnKeys(v.rows())[0];
    const asked = ends;
    await addCapTurns(s, i, 1);
    settleRows(v, cx);
    cx.flush(50);
    expect(v.follow).toBe(true);
    const keys = v.turnKeys(v.rows());
    expect(keys.at(-1)).toBe(`0:${i + 1}`);
    expect(itemsIn(v)).toBeLessThanOrEqual(60);
    if (keys[0] !== was) expect(ends).toBeGreaterThan(asked);
    starts.add(keys[0]);
  }
  // Thirty turns, in blocks of ten: three moves of the window's start, not thirty.
  expect(starts.size).toBeLessThanOrEqual(4);
  expect(starts.size).toBeGreaterThanOrEqual(3);
  expect(s.turns.length).toBe(180);
  expect(v.baseRows.filter((r) => r.kind === "turn").length).toBe(180);
  expect(v.rows().find((r) => r.key === "older")).toMatchObject({ text: `${180 - v.turnKeys(v.rows()).length} earlier turns`, act: "Show earlier" });
  expect(v.rows().at(-1).kind).toBe("tail");
  // A row's place in the list, from its place in all the rows, under the Show earlier item.
  const k = v.turnKeys(v.rows())[3];
  expect(v.rowIndex(k)).toBe(v.rows().findIndex((r) => r.key === k));
  expect(v.rowIndex("0:1")).toBe(-1);
});

test("a reader up in a long session sees nothing above the view move as turns arrive, and past the window the newest wait under a Show later item", async () => {
  const { v, cx, s } = await capSession(150, SMALL);
  v.jumpLatest(true);
  settleRows(v, cx);
  // The person scrolls up into the window and reads there.
  v.follow = false;
  v.toBottom = false;
  const top = 10;
  H.listWindow = () => ({ start: top, end: top + 8 });
  try {
    draw(v, cx);
    const sig = () => v.rows().slice(0, top + 8).map((r, i) => `${r.key}|${v.slotsMemo[i]}`);
    const before = sig();
    await addCapTurns(s, 150, 5);
    settleRows(v, cx);
    expect(sig()).toEqual(before);
    expect(v.turnKeys(v.rows()).at(-1)).toBe("0:155");
    // Past the window's stop the newest turns wait below it, and still nothing above moves.
    await addCapTurns(s, 155, 20);
    settleRows(v, cx);
    expect(sig()).toEqual(before);
    const rows = v.rows();
    expect(rows.length).toBeLessThanOrEqual(66 + 3);
    expect(rows.at(-1)).toMatchObject({ kind: "more", key: "newer" });
    const last = Number(v.turnKeys(rows).at(-1).split(":")[1]);
    expect(last).toBeLessThan(175);
    expect(rows.at(-1)).toMatchObject({ text: `${175 - last} later turns`, act: "Show later" });
    expect(v.follow).toBe(false);
    // With the Show later item on screen the list's end is not the session's: no follow.
    H.listWindow = (n) => ({ start: n - 5, end: n });
    v.downAt = Date.now();
    draw(v, cx);
    draw(v, cx);
    expect(v.bottomShown).toBe(false);
    expect(v.follow).toBe(false);
    // Jump to latest takes the window to the end.
    H.listWindow = null;
    v.action("latest", cx);
    settleRows(v, cx);
    expect(v.turnKeys(v.rows()).at(-1)).toBe("0:175");
    expect(inList(v, "newer")).toBe(false);
    expect(v.rows().at(-1).kind).toBe("tail");
  } finally { H.listWindow = null; }
});

test("every way to an older turn moves the window to it: #n, a search step, the outline, the rail, a pin, up, Home and Show earlier", async () => {
  noPins();
  const { v, cx } = await capSession(150, SMALL);
  const asked = scrollsOf(v);
  // A landing at a place is planned before it is asked for (landed), and can go by another row
  // (an earlier one at the top). So its own row is asked for after the plan: the plan alone says
  // nothing of the asks. Any other jump asks for the turn's row itself.
  let plan = null;
  Object.defineProperty(v, "landed", { get: () => plan, set(p) { plan = p && { ...p, row: v.rowsMemo[p.j].key, from: asked.length }; } });
  const reached = (k) => (plan?.key === k ? asked.slice(plan.from).includes(plan.row) : asked.includes(k));
  const fresh = () => {
    if (v.outlined()) v.action("outline:off", cx);
    v.query = "";
    v.jumpLatest(true);
    frames(v, cx);
    expect(inList(v, "0:10")).toBe(false);
    asked.length = 0;
    v.landed = null;
  };
  const check = (what, k) => {
    frames(v, cx);
    if (!inList(v, k)) throw new Error(`${what}: ${k} is not in the list`);
    if (!reached(k)) throw new Error(`${what}: the list was not asked to go to ${k} (${asked.join(", ")})`);
    expect(itemsIn(v)).toBeLessThanOrEqual(66);
  };
  fresh();
  v.command("search:#10", cx);
  check("#10", "0:10");
  // A pin made there, then a return to it from the newest turn.
  v.action("pin", cx);
  v.command("search:", cx);
  fresh();
  v.action("go:1", cx);
  check("pin 1", "0:10");
  fresh();
  v.railJump("0:10", cx);
  check("rail", "0:10");
  fresh();
  v.action("first", cx);
  check("Home", "0:1");
  // Up from the window's first turn selects Show earlier, and up again the turn before it.
  fresh();
  const first = v.turnKeys(v.rows())[0];
  v.sel = first;
  v.follow = false;
  v.action("prev", cx);
  frames(v, cx);
  expect(v.sel).toBe("older");
  v.action("prev", cx);
  check("up", `0:${Number(first.split(":")[1]) - 1}`);
  // The outline is windowed too, and Home there reaches the first turn.
  fresh();
  v.action("outline:on", cx);
  frames(v, cx);
  expect(inList(v, "0:1")).toBe(false);
  expect(itemsIn(v)).toBeLessThanOrEqual(66);
  v.action("first", cx);
  check("outline Home", "0:1");
  v.action("open", cx);
  check("outline Enter", "0:1");
  // A search step: "order 1" matches turns 2, 11 to 20 and 101 to 150, more than a window of 34.
  fresh();
  v.win.cap = { ...v.win.cap, slide: 30, block: 5, stop: 34 };
  v.command("search:order 1", cx);
  frames(v, cx);
  expect(v.sel).toBe("0:150");
  expect(inList(v, "0:11")).toBe(false);
  for (let i = 0; i < 60 && v.sel !== "0:11"; i++) { v.action("olderMatch", cx); frames(v, cx, 1); }
  expect(v.sel).toBe("0:11");
  check("older match", "0:11");
  v.win.cap = { ...v.win.cap, ...SMALL };
  // Show earlier: the next block comes in above, and the first turn the list had stays where it was.
  fresh();
  for (let i = 0; i < 20 && !inList(v, "0:1"); i++) {
    const was = v.turnKeys(v.rows())[0];
    asked.length = 0;
    v.landed = null;
    v.click("older", cx);
    check("Show earlier", was);
    expect(v.turnKeys(v.rows())[0]).not.toBe(was);
  }
  expect(inList(v, "0:1")).toBe(true);
  expect(inList(v, "older")).toBe(false);
  // And Show later back down from there.
  expect(inList(v, "newer")).toBe(true);
  const end = v.turnKeys(v.rows()).at(-1);
  const next = `0:${Number(end.split(":")[1]) + 1}`;
  asked.length = 0;
  v.landed = null;
  v.click("newer", cx);
  check("Show later", next);
});

test("with a window in place the rail and the turn numbers are the whole session's", async () => {
  const { v, cx } = await capSession(150, SMALL);
  v.jumpLatest(true);
  frames(v, cx);
  expect(inList(v, "older")).toBe(true);
  expect(v.railTurns.length).toBe(150);
  expect(v.railTurns[0].key).toBe("0:1");
  expect(v.railTurns.at(-1).key).toBe("0:150");
  expect(v.headerText()).toContain("150");
  v.debug = true;
  // Jump to #10, outside the window: it lands on turn 10, numbered 10.
  v.command("search:#10", cx);
  frames(v, cx);
  const row = v.rows().find((r) => r.key === "0:10");
  expect(row.turn.n).toBe(10);
  expect(row.turn.prompt).toContain("Prompt 9:");
  // Its place in the list from its place in all the rows; one the window leaves out has none.
  expect(v.rowIndex("0:10")).toBe(v.rows().indexOf(row));
  expect(v.rowIndex("0:150")).toBe(-1);
  expect(v.sel).toBe("0:10");
  const rep = state.shared["threads.debug"].t4;
  expect(rep.rows).toContain("turn#10");
  expect(rep.header).toContain("150");
  expect(v.railTurns.length).toBe(150);
  expect(rep.window.earlier + rep.window.later + v.turnKeys(v.rows()).length).toBe(150);
});

test("the window counts list items, so an open card with many parts stays inside it and capList never cuts", async () => {
  const { v, cx } = await capSession(150, { ...SMALL, max: 70 }, 140);
  v.jumpLatest(true);
  frames(v, cx);
  v.debug = true;
  // Up in the session, Enter on the long turn opens it: 25 Markdown items and the card's own.
  const key = "0:141";
  v.sel = key;
  v.follow = false;
  v.action("open", cx);
  frames(v, cx);
  const parts = () => v.rows().filter((r) => r.key.startsWith(`md:${key}:`)).length;
  expect(v.open.has(key)).toBe(true);
  expect(parts()).toBe(25);
  expect(itemsIn(v)).toBeLessThanOrEqual(60);
  expect(state.shared["threads.debug"].t4.listCap).toMatchObject({ max: 70, fired: 0, cut: 0 });
  // Following again with the card open: the window moves on past it, still under its budget.
  v.action("latest", cx);
  frames(v, cx);
  expect(v.turnKeys(v.rows()).at(-1)).toBe("0:150");
  expect(parts()).toBe(25);
  expect(itemsIn(v)).toBeLessThanOrEqual(60);
  expect(v.capFired).toBe(0);
  // A reader up at the window's top, the window grown near its stop by new turns, and the
  // card opened below the view: the window ends before the card, under its stop, and the card
  // waits under Show later.
  const b = await capSession(150, { ...SMALL, max: 70 }, 140);
  b.v.jumpLatest(true);
  frames(b.v, b.cx);
  b.v.follow = false;
  b.v.toBottom = false;
  H.listWindow = () => ({ start: 2, end: 10 });
  try {
    draw(b.v, b.cx);
    await addCapTurns(b.s, 150, 10);
    frames(b.v, b.cx);
    expect(itemsIn(b.v)).toBeGreaterThan(50);
    expect(inList(b.v, key)).toBe(true);
    b.v.open.add(key);
    frames(b.v, b.cx);
    expect(itemsIn(b.v)).toBeLessThanOrEqual(66);
    expect(inList(b.v, key)).toBe(false);
    expect(inList(b.v, "newer")).toBe(true);
  } finally { H.listWindow = null; }
  expect(b.v.capFired).toBe(0);
});

test("a selection the window leaves out stays selected, and the first key that acts on it brings the window back", async () => {
  noPins();
  const { v, cx, s } = await capSession(150, SMALL);
  v.jumpLatest(true);
  frames(v, cx);
  const first = v.turnKeys(v.rows())[0];
  const n = Number(first.split(":")[1]);
  // Selected far up while the view follows the end, as turns come in.
  v.sel = first;
  v.follow = true;
  await addCapTurns(s, 150, 30);
  frames(v, cx);
  expect(v.follow).toBe(true);
  expect(inList(v, first)).toBe(false);
  expect(v.sel).toBe(first);
  // j: the turn after it, with the window around it.
  v.action("next", cx);
  frames(v, cx);
  expect(v.sel).toBe(`0:${n + 1}`);
  expect(inList(v, `0:${n + 1}`)).toBe(true);
  expect(v.follow).toBe(false);
  // Enter, p and c the same way, each after the window has moved on again.
  for (const what of ["open", "pin", "copy"]) {
    v.sel = first;
    v.jumpLatest(false);
    frames(v, cx);
    expect(v.sel).toBe(first);
    expect(inList(v, first)).toBe(false);
    v.action(what, cx);
    frames(v, cx);
    expect(v.sel).toBe(first);
    expect(inList(v, first)).toBe(true);
    expect(v.follow).toBe(false);
  }
  expect(v.open.has(first)).toBe(true);
  expect(v.pinnedAll().some((p) => p.key === first)).toBe(true);
  expect(cx.clip).toContain(`Reply ${n - 1}:`);
});

test("Show earlier and Show later are stops for up and down, Enter presses them, they read plainly and they are not turns", async () => {
  noPins();
  const { v, cx } = await capSession(150, SMALL);
  v.jumpLatest(true);
  frames(v, cx);
  const older = v.rows().find((r) => r.key === "older");
  const shown = v.turnKeys(v.rows());
  expect(older).toMatchObject({ kind: "more", text: `${150 - shown.length} earlier turns`, act: "Show earlier" });
  // Up from the window's first turn selects it, drawn as selected.
  const first = shown[0];
  v.sel = first;
  v.follow = false;
  v.action("prev", cx);
  frames(v, cx);
  expect(v.sel).toBe("older");
  const at = v.rows().findIndex((r) => r.key === "older");
  H.rec = [];
  v.listItems(theme, v.rows(), v.slotsMemo, { start: at, end: at + 1 }, true, false);
  const drawn = rec;
  H.rec = null;
  expect(drawn).toContainEqual(["bg", theme.selected]);
  expect(drawn).toContainEqual(["child", "Show earlier"]);
  expect(drawn).toContainEqual(["child", older.text]);
  // Not a turn: p pins nothing, c copies nothing, nothing shows a number for it.
  const pins = v.pinnedAll().length;
  cx.clip = null;
  v.action("pin", cx);
  v.action("copy", cx);
  expect(v.pinnedAll().length).toBe(pins);
  expect(cx.clip).toBe(null);
  expect(v.railTurns.some((x) => x.key === "older")).toBe(false);
  expect(v.turnKeys(v.rows())).not.toContain("older");
  v.debug = true;
  v.report();
  const line = state.shared["threads.debug"].t4.detail.find((d) => d.startsWith("more "));
  expect(line).toBe(`more ${older.text} · Show earlier [selected]`);
  expect(line).not.toContain("#");
  // Enter presses it: the next block comes in above, and the turn that was first is selected.
  v.action("open", cx);
  frames(v, cx);
  expect(v.sel).toBe(first);
  expect(v.turnKeys(v.rows())[0]).not.toBe(first);
  // Again from the new first turn: now the window ends short of the session's end.
  v.sel = v.turnKeys(v.rows())[0];
  v.action("prev", cx);
  v.action("open", cx);
  frames(v, cx);
  const newer = v.rows().find((r) => r.key === "newer");
  const last = v.turnKeys(v.rows()).at(-1);
  const end = Number(last.split(":")[1]);
  expect(newer).toMatchObject({ kind: "more", text: `${150 - end} later turns`, act: "Show later" });
  // Down from the window's last turn selects Show later; Enter brings the next turns in.
  v.sel = last;
  v.action("next", cx);
  frames(v, cx);
  expect(v.sel).toBe("newer");
  v.action("open", cx);
  frames(v, cx);
  expect(v.sel).toBe(`0:${end + 1}`);
  expect(inList(v, `0:${end + 1}`)).toBe(true);
  // From Show earlier, up goes on to the turn before the window.
  const top = v.turnKeys(v.rows())[0];
  v.sel = top;
  v.action("prev", cx);
  v.action("prev", cx);
  frames(v, cx);
  const before = `0:${Number(top.split(":")[1]) - 1}`;
  expect(v.sel).toBe(before);
  expect(inList(v, before)).toBe(true);
});

test("RowWindow on its own: tail, a reader's range, a jump around a row, Show earlier and later, and whether it holds a key", () => {
  // 30 turns of one row, turn 10 of three (its image row and its row, and a skip note after).
  const make = (n) => {
    const rows = [];
    for (let t = 1; t <= n; t++) {
      const turn = { n: t };
      if (t === 10) rows.push({ kind: "wtop", key: "imgs:0:10", si: 0, turn });
      rows.push({ kind: "turn", key: `0:${t}`, si: 0, turn });
      if (t === 10) rows.push({ kind: "note", key: "skip:0:10" });
    }
    return { rows, index: new Map(rows.map((r, i) => [r.key, i])) };
  };
  const w = new RowWindow({ slide: 10, block: 3, stop: 12 });
  let list = make(30);
  // Tail: the newest slide - block rows, the start at a turn's first row.
  let at = w.place(list, { tail: true });
  expect([at.a, at.z]).toEqual([25, 32]);
  expect([w.from, w.to]).toEqual(["0:24", null]);
  expect(w.has(list, "0:30")).toBe(true);
  expect(w.has(list, "0:23")).toBe(false);
  // Turns come in, the view up in the session: the start stays, and past stop the end waits.
  list = make(40);
  at = w.place(list, { seen: 27 });
  expect(at.a).toBe(25);
  expect(at.z).toBe(37);
  expect(w.to).toBe("0:35");
  expect(w.outside(list)).toEqual({ earlier: 23, later: 5 });
  // A jump to turn 10: its three rows whole, inside slide rows.
  at = w.place(list, { want: list.index.get("0:10") });
  expect(at.a).toBeLessThanOrEqual(list.index.get("imgs:0:10"));
  expect(at.z).toBeGreaterThan(list.index.get("skip:0:10"));
  expect(at.z - at.a).toBeLessThanOrEqual(10);
  expect(w.has(list, "imgs:0:10")).toBe(true);
  // Show earlier lands on the old first turn; Show later on the first turn after the old end.
  const first = w.from;
  expect(w.earlier(list)).toBe(first);
  expect(w.has(list, first)).toBe(true);
  const end = Number(w.to.split(":")[1]);
  expect(w.later(list)).toBe(`0:${end + 1}`);
  expect(w.stepKeys(list, ["0:1", w.from, w.to, "0:40"]).filter((k) => k === "older" || k === "newer").length).toBeGreaterThan(0);
  // Everything fits again: no window.
  at = w.place(make(9), { tail: true });
  expect([at.a, at.z, w.from, w.to]).toEqual([0, 9, null, null]);
});

test("following, a newest turn whose rows run past the window shows from its head, and Show earlier brings turns in above it", async () => {
  const { v, cx } = await capSession(150, SMALL, 149, 80);
  v.open.add("0:150");
  v.jumpLatest(true);
  frames(v, cx);
  const md = () => v.rows().filter((r) => r.key.startsWith("md:0:150:")).length;
  const all = v.baseRows.filter((r) => r.key.startsWith("md:0:150:")).length;
  expect(all).toBeGreaterThan(60);
  expect(md()).toBe(all);
  expect(v.turnKeys(v.rows())).toEqual(["0:150"]);
  expect(v.rows().findIndex((r) => r.key === "0:150")).toBe(v.rows().findIndex((r) => r.key === "older") + 1);
  // Each Show earlier brings turns in above and lands on one the list holds.
  let first = 150;
  for (let i = 0; i < 3; i++) {
    v.click("older", cx);
    frames(v, cx);
    expect(inList(v, v.sel)).toBe(true);
    const top = Number(v.turnKeys(v.rows())[0].split(":")[1]);
    expect(top).toBeLessThan(first);
    first = top;
  }
  v.action("latest", cx);
  frames(v, cx);
  expect(v.turnKeys(v.rows())).toEqual(["0:150"]);
  expect(md()).toBe(all);
  // Past the list's cap the end keeps the newest items; a key onto the turn goes to its head
  // first, and following then takes the end again.
  v.win.cap = { ...v.win.cap, max: 40 };
  v.jumpLatest(true);
  frames(v, cx);
  expect(v.rows().at(-1).kind).toBe("tail");
  expect(inList(v, "0:150")).toBe(false);
  const asked = [];
  v.scroll = { scroll_to_item(i) { asked.push(v.rowsMemo?.[i]?.key); }, scroll_to_bottom() { asked.push("end"); } };
  v.sel = "older";
  v.action("next", cx);
  frames(v, cx);
  expect([v.sel, v.follow]).toEqual(["0:150", true]);
  expect(asked[0]).toBe("0:150");
  // Until following takes the end, every ask is for the head: the list still holds it when
  // each is taken. The cut moved, so the jump is held and asked in the frame that lays it
  // out, and the landing asks no first time for a head already in place. The end is asked
  // for: without it, the slice would drop the last ask and prove nothing.
  expect(asked).toContain("end");
  expect(asked.slice(0, asked.indexOf("end"))).toEqual(["0:150"]);
  expect(v.rows().at(-1).kind).toBe("tail");
});

test("a jump to one turn with more items than the list takes lands on its head, and the cut is below it, which is not the end", async () => {
  noPins();
  const { v, cx } = await capSession(150, { ...SMALL, max: 40 }, 140, 80);
  v.jumpLatest(true);
  frames(v, cx);
  v.open.add("0:141");
  frames(v, cx);
  const asked = [];
  v.scroll = { scroll_to_item(i) { asked.push(v.rowsMemo?.[i]?.key); }, scroll_to_bottom() { asked.push("end"); } };
  v.command("search:#141", cx);
  frames(v, cx, 6);
  const rows = v.rows();
  const parts = v.baseRows.filter((r) => r.key.startsWith("md:0:141:"));
  expect(rows.length).toBe(40);
  expect(asked).toContain("0:141");
  expect(asked).not.toContain("end");
  expect(inList(v, "0:141")).toBe(true);
  expect(inList(v, parts[0].key)).toBe(true);
  expect(inList(v, parts.at(-1).key)).toBe(false);
  expect(inList(v, "capped")).toBe(false);
  expect(rows.at(-1)).toMatchObject({ kind: "note", key: "capped-later" });
  expect(rows.at(-1).text).toMatch(/^[\d,]+ later list items are not shown\. Click to show them\.$/);
  // The note at the bottom on screen is not the session's end: no follow.
  try {
    H.listWindow = (n) => ({ start: n - 5, end: n });
    v.downAt = Date.now();
    draw(v, cx);
    draw(v, cx);
    expect(v.bottomShown).toBe(false);
    expect(v.follow).toBe(false);
  } finally { H.listWindow = null; }
  // A huge open pin in the Pinned view reads from its head the same way.
  v.sel = "0:150";
  v.action("pin", cx);
  v.sel = "0:141";
  v.action("pin", cx);
  v.setView("pinned");
  frames(v, cx);
  expect(v.rows().length).toBeLessThanOrEqual(40);
  expect(lastList.sizes.length).toBeLessThanOrEqual(40);
  expect(inList(v, "0:141")).toBe(true);
  expect(inList(v, parts[0].key)).toBe(true);
  expect(v.rows().at(-1).key).toBe("capped-later");
  // With no row asked for, it still reads from the top; a scroll to the next pin brings it in.
  v.capKey = null;
  v.fitKey = null;
  frames(v, cx);
  expect(inList(v, "0:141")).toBe(true);
  expect(inList(v, "0:150")).toBe(false);
  v.sel = "0:150";
  v.scrollTo = { key: "0:150", how: "center" };
  frames(v, cx);
  expect(inList(v, "0:150")).toBe(true);
});

// The Pinned view reads from its top when no row is kept (capKey), so latest there keeps the
// last row instead; the Chat's list keeps its newest items with none.
test("in the Pinned view past the cap, latest after a scroll to a huge pin's head shows the newest pin: the list ends with it", async () => {
  noPins();
  const { v, cx } = await capSession(150, { ...SMALL, max: 40 }, 140, 80);
  v.jumpLatest(true);
  frames(v, cx);
  v.open.add("0:141");
  frames(v, cx);
  v.sel = "0:150";
  v.action("pin", cx);
  v.sel = "0:141";
  v.action("pin", cx);
  expect(v.pinnedAll().map((p) => p.key).sort()).toEqual(["0:141", "0:150"]);
  v.setView("pinned");
  frames(v, cx);
  v.sel = "0:141";
  v.scrollTo = { key: "0:141", how: "center" };
  frames(v, cx);
  expect([inList(v, "0:141"), inList(v, "0:150")]).toEqual([true, false]);
  v.action("latest", cx);
  frames(v, cx);
  expect([v.sel, inList(v, "0:150"), v.rows().at(-1).key]).toEqual(["0:150", true, "0:150"]);
});

test("capList keeps the item a reader went to: a head kept above a note, or a middle between two", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ kind: "md", key: `r${i}` }));
  const sizes = rows.map(() => 40);
  const keys = (x) => x.rows.map((r) => r.key);
  expect(keys(capList(rows, sizes, 10, 34, 25)).slice(0, 2)).toEqual(["capped", "r21"]);
  const head = capList(rows, sizes, 10, 34, 3);
  expect(keys(head)).toEqual(["r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "capped-later"]);
  expect(head.rows.at(-1).text).toBe("21 later list items are not shown. Click to show them.");
  expect(head.cut).toBe(21);
  expect([head.rows.at(-1).go, capList(rows, sizes, 10, 34, 25).rows[0].go]).toEqual(["r9", "r20"]);
  const mid = capList(rows, sizes, 10, 34, 15);
  expect(mid.rows.length).toBe(10);
  expect(mid.sizes.length).toBe(10);
  expect(keys(mid).slice(1, -1)).toEqual(["r11", "r12", "r13", "r14", "r15", "r16", "r17", "r18"]);
  expect(mid.rows[0]).toMatchObject({ key: "capped" });
  expect(mid.rows.at(-1)).toMatchObject({ key: "capped-later" });
  expect(mid.cut).toBe(22);
  expect([mid.rows[0].go, mid.rows.at(-1).go]).toEqual(["r10", "r19"]);
  expect(Number(mid.rows[0].text.split(" ")[0]) + Number(mid.rows.at(-1).text.split(" ")[0])).toBe(22);
});

test("nothing is cut above the row on screen: a card opened above it grows the window past its stop, and the cut falls below", async () => {
  const { v, cx, s } = await capSession(150, SMALL, 125);
  v.jumpLatest(true);
  frames(v, cx);
  v.follow = false;
  v.toBottom = false;
  await addCapTurns(s, 150, 20);
  frames(v, cx);
  const rows = v.rows();
  expect(rows.at(-1).key).toBe("newer");
  // The view on the window's last turns, just above Show later.
  const end = rows.length - 1;
  const last = v.turnKeys(rows.slice(0, end)).at(-1);
  try {
    H.listWindow = (n) => (n === v.rows().length && v.rows()[n - 1]?.key === "newer" ? { start: n - 6, end: n - 1 } : { start: 0, end: 1 });
    draw(v, cx);
    expect(v.viewRange[1]).toBe(end);
    v.open.add("0:126");
    H.listWindow = () => ({ start: 0, end: 1 });
    frames(v, cx, 1);
    expect(v.rows().some((r) => r.key.startsWith("md:0:126:"))).toBe(true);
    expect(inList(v, last)).toBe(true);
  } finally { H.listWindow = null; }
});

test("a window's edges: its first turn has its day band, and it never ends on a day row above Show later", async () => {
  const { v, cx } = await capSession(150, SMALL, -1, 25, (i) => i);
  v.jumpLatest(true);
  frames(v, cx);
  const check = () => {
    const rows = v.rows();
    const t = rows.findIndex((r) => r.kind === "turn");
    expect(rows[t - 1].kind).toBe("day");
    const n = rows.findIndex((r) => r.key === "newer");
    if (n >= 0) expect(rows[n - 1].kind).not.toBe("day");
  };
  check();
  let top = Number(v.turnKeys(v.rows())[0].split(":")[1]);
  for (let i = 0; i < 4; i++) {
    v.click("older", cx);
    frames(v, cx);
    check();
    const t = Number(v.turnKeys(v.rows())[0].split(":")[1]);
    expect(t).toBeLessThan(top);
    expect(t).toBeGreaterThan(top - 15);
    top = t;
  }
  expect(inList(v, "newer")).toBe(true);
  // Up from the first turn stops on Show earlier.
  v.sel = v.turnKeys(v.rows())[0];
  v.action("prev", cx);
  expect(v.sel).toBe("older");
});

test("Jump to latest's scroll to the end moves the window there while not yet following", async () => {
  const { v, cx, s } = await capSession(150, SMALL);
  v.jumpLatest(true);
  frames(v, cx);
  v.follow = false;
  await addCapTurns(s, 150, 20);
  frames(v, cx);
  expect(inList(v, "0:170")).toBe(false);
  v.toBottom = true;
  draw(v, cx);
  expect(inList(v, "0:170")).toBe(true);
});

test("RowWindow at its edges: the slide and the stop at exactly their counts, two blocks at once, a newest turn past slide, and Show earlier from the end", () => {
  const make = (n, big = 0) => {
    const rows = [];
    for (let t = 1; t <= n; t++) {
      const turn = { n: t };
      rows.push({ kind: "turn", key: `0:${t}`, si: 0, turn });
      if (t === n) for (let j = 0; j < big; j++) rows.push({ kind: "md", key: `md:0:${t}:${j}`, si: 0, turn });
    }
    return { rows, index: new Map(rows.map((r, i) => [r.key, i])) };
  };
  const w = new RowWindow({ slide: 10, block: 3, stop: 12 });
  // stop: 12 rows are no window, 13 are.
  expect(w.place(make(12), { tail: true })).toMatchObject({ a: 0, z: 12 });
  expect(w.place(make(13), { tail: true })).toMatchObject({ a: 6, z: 13 });
  // slide: 10 rows after the start stay, 11 slide.
  expect(w.place(make(16), { tail: true }).a).toBe(6);
  expect(w.place(make(17), { tail: true }).a).toBe(10);
  // Two blocks in at once: the start goes to slide - block before the end, not one block on.
  expect(w.place(make(23), { tail: true })).toMatchObject({ a: 16, z: 23, slid: true });
  // A newest turn of 20 rows: the window starts at its first row.
  const big = make(30, 20);
  expect(w.place(big, { tail: true })).toMatchObject({ a: 29, z: 50 });
  expect(w.has(big, "0:30")).toBe(true);
  // Show earlier from a range at the very end lands on a turn it holds.
  w.at = { a: 50, z: 50 };
  const k = w.earlier(big);
  expect(k).toBe("0:30");
  expect(w.has(big, k)).toBe(true);
  // Show later onto that turn holds it from its head.
  w.keep(big, 0, 29, false);
  expect(w.later(big)).toBe("0:30");
  expect(w.at).toMatchObject({ a: 29, z: 50 });
  // The reader's range past stop ends at or after the row after the last on screen.
  const list = make(40);
  w.keep(list, 19, 40, false);
  expect(w.place(list, { seen: 36 }).z).toBe(36);
  expect(w.has(list, "0:36")).toBe(true);
  // Show later and Show earlier move one block, the other end following to slide rows.
  w.keep(list, 20, 30, false);
  expect(w.later(list)).toBe("0:31");
  expect(w.at).toMatchObject({ a: 23, z: 33 });
  w.keep(list, 20, 30, false);
  expect(w.earlier(list)).toBe("0:21");
  expect(w.at).toMatchObject({ a: 17, z: 27 });
});

test("under the list's cap a jump does not rebuild the list's fit for the row it went to", async () => {
  const { v, cx } = await capSession(150);
  v.jumpLatest(true);
  frames(v, cx);
  v.command("search:#10", cx);
  frames(v, cx);
  let fits = 0;
  const fit = v.windowed.bind(v);
  v.windowed = (W) => { fits++; return fit(W); };
  v.capKey = "0:20";
  draw(v, cx);
  expect(fits).toBe(0);
});

test("past the cap, a press on a cut note brings the items it stands for in, to the turn's end and back", async () => {
  const { v, cx } = await capSession(150, { ...SMALL, max: 40 }, 140, 80);
  v.open.add("0:141");
  v.command("search:#141", cx);
  frames(v, cx, 6);
  const parts = v.baseRows.filter((r) => r.key.startsWith("md:0:141:")).map((r) => r.key);
  const note = () => v.rows().find((r) => r.key === "capped-later");
  expect(note().text).toMatch(/^[\d,]+ later list items are not shown\. Click to show them\.$/);
  for (let i = 0; i < 10 && note(); i++) {
    const was = v.rows().filter((r) => parts.includes(r.key)).at(-1).key;
    v.click("capped-later", cx);
    frames(v, cx);
    expect(parts.indexOf(v.rows().filter((r) => parts.includes(r.key)).at(-1).key)).toBeGreaterThan(parts.indexOf(was));
  }
  expect(inList(v, parts.at(-1))).toBe(true);
  expect(v.rows().find((r) => r.key === "capped").text).toMatch(/earlier list items are not shown\. Click to show them\.$/);
  // Back up: the list goes to the item just above the first it holds.
  const first = v.rows().find((r) => parts.includes(r.key)).key;
  const asked = [];
  v.scroll = { scroll_to_item(i) { asked.push(v.rowsMemo?.[i]?.key); }, scroll_to_bottom() { asked.push("end"); } };
  v.click("capped", cx);
  frames(v, cx);
  expect(asked[0]).toBe(parts[parts.indexOf(first) - 1]);
  expect(inList(v, parts.at(-1))).toBe(false);
});

// The rows a simList frame shows, by key.
function shownIn(v, f) {
  const pre = [0];
  for (const x of f.sizes) pre.push(pre[pre.length - 1] + x);
  return f.keys.filter((_k, i) => pre[i + 1] > f.off && pre[i] < f.off + v.listH);
}
// Where a frame's view is by its offset: true at the list's bottom (the offset at its greatest,
// within a px), false with the list's end not drawn, else how far the bottom is below. The rows
// drawn reach two past the view (simList), so the end among them (end) is not yet the bottom.
function endOf(v, f) {
  const short = Math.max(0, f.sizes.reduce((x, y) => x + y, 0) - v.listH) - f.off;
  return short <= 1 ? true : f.end ? `${Math.round(short)} px short` : false;
}

test("past the cap, down from an open turn cut below lands on the next turn in the first frame, though the list is cut anew around it", async () => {
  // 80 turns, turn #41's reply of 40 paragraph and table pairs open: past a cap of 60 items
  // the list holds #41's head and its first parts over a note, and #42 is past the note.
  const ev = [];
  for (let i = 0; i < 80; i++) {
    const [p, t, d] = capTurn(i);
    if (i === 40) t.t = Array.from({ length: 40 }, (_, j) => `Pair ${j}.\n\n| a | b |\n|---|---|\n| ${j} | x |`).join("\n\n");
    ev.push(p, t, d);
  }
  const { v, cx } = await scripted(ev);
  v.debug = false;
  v.win.cap = { ...v.win.cap, max: 60 };
  v.width = 560; v.rootH = 1100; v.listH = 1000;
  const sim = simList(v);
  const shown = (f) => shownIn(v, f);
  try {
    openAt(v, cx, sim, 562);
    v.command("search:#41", cx);
    settleList(v, cx, sim);
    v.action("open", cx);
    v.action("open", cx);
    settleList(v, cx, sim);
    expect(v.rows().at(-1).key).toBe("capped-later");
    expect(inList(v, "0:42")).toBe(false);
    expect(shown(sim.last())).toContain("0:41");
    v.action("next", cx);
    probeFrame(v, cx);
    expect(v.sel).toBe("0:42");
    // The list cut anew holds #42's head (it keeps the newest items, #42's among them); what
    // the first frame shows of it is the offset's to decide.
    expect(v.rows()[0].key).toBe("capped");
    expect(inList(v, "0:42")).toBe(true);
    expect(shown(sim.last())).toContain("0:42");
    // Where it lands in that frame is where it stays: the scroll after it moves nothing.
    const first = sim.last().off;
    settleList(v, cx, sim);
    expect(shown(sim.last())).toContain("0:42");
    expect(sim.last().off).toBe(first);
    // And back up: #41's head, in its own first frame too.
    v.action("prev", cx);
    probeFrame(v, cx);
    expect(v.sel).toBe("0:41");
    expect(shown(sim.last())).toContain("0:41");
  } finally { H.listWindow = null; }
});

test("past the cap, each press on the later note shows the first item it brings in, in the first frame, as the cut moves on through the middle", async () => {
  const { v, cx } = await capSession(150, { max: 30 }, 140, 80);
  const sim = simList(v);
  try {
    openAt(v, cx, sim, 562);
    v.open.add("0:141");
    v.command("search:#141", cx);
    settleList(v, cx, sim);
    let middle = 0;
    const note = () => v.rows().find((r) => r.key === "capped-later");
    for (let k = 0; k < 10 && note(); k++) {
      const go = note().go;
      v.click("capped-later", cx);
      probeFrame(v, cx);
      expect(shownIn(v, sim.last())).toContain(go);
      if (v.rows()[0].key === "capped" && v.rows().at(-1).key === "capped-later") middle++;
      settleList(v, cx, sim);
    }
    // The cut moved from the middle to the middle at least once.
    expect(middle).toBeGreaterThan(1);
  } finally { H.listWindow = null; }
});

test("past the cap, a jump from a reader down in one cut turn to the next open turn shows it in the first frame, the cut moving from middle to middle", async () => {
  const ev = [];
  for (let i = 0; i < 150; i++) ev.push(...capTurn(i, i === 60 || i === 61, 40));
  const { v, cx } = await scripted(ev);
  v.debug = false;
  v.win.cap = { ...v.win.cap, max: 60 };
  v.width = 560; v.rootH = 1100; v.listH = 1000;
  const sim = simList(v);
  try {
    openAt(v, cx, sim, 562);
    v.open.add("0:61");
    v.open.add("0:62");
    v.command("search:#61", cx);
    settleList(v, cx, sim);
    // Down to the end of the items the cut keeps, in #61's reply.
    sim.wheel(-1e6);
    settleList(v, cx, sim);
    const ends = () => [v.rows()[0].key, v.rows().at(-1).key];
    expect(ends()).toEqual(["capped", "capped-later"]);
    expect(shownIn(v, sim.last())).not.toContain("0:61");
    expect(inList(v, "0:62")).toBe(false);
    v.action("next", cx);
    probeFrame(v, cx);
    expect(v.sel).toBe("0:62");
    expect(ends()).toEqual(["capped", "capped-later"]);
    expect(shownIn(v, sim.last())).toContain("0:62");
  } finally { H.listWindow = null; }
});

test("past the cap, the later note at the list's end has the Jump to latest pill's room under its text", async () => {
  const { v, cx } = await capSession(150, { max: 40 }, 140, 80);
  v.open.add("0:141");
  v.command("search:#141", cx);
  frames(v, cx, 6);
  const note = v.estimate({ kind: "note" });
  expect(v.rows().at(-1).key).toBe("capped-later");
  expect(v.pillShown()).toBe(true);
  // The pill is 28 px tall, 10 px over the list's end (PILL_H, PILL_GAP).
  expect(v.sizesMemo.at(-1)).toBe(note + 28 + 10);
  // The earlier note at the top keeps its own height.
  v.click("capped-later", cx);
  frames(v, cx);
  expect(v.rows()[0].key).toBe("capped");
  expect(v.sizesMemo[0]).toBe(note);
  // At the end of the turn the later note is gone, and the tail is last.
  for (let i = 0; i < 10 && v.rows().at(-1).key === "capped-later"; i++) { v.click("capped-later", cx); frames(v, cx); }
  expect(v.rows().at(-1).kind).toBe("tail");
  // Another note at the list's end (the Pinned view with no pins) keeps its own height. Pins
  // other tests left on this session's file are not this test's.
  v.view = "pinned";
  v.pinnedList = () => [];
  v.fitKey = null;
  draw(v, cx);
  const last = v.rows().at(-1);
  expect(last.key).toBe("pins:none");
  expect(v.sizesMemo.at(-1)).toBe(v.height(last));
});

test("past the cap, opening a card inside the items the cut keeps scrolls as under the cap: its last part, then its head, nothing at once", async () => {
  const { v, cx } = await capSession(80, { max: 60 }, 40, 170);
  v.open.add("0:41");
  v.command("search:#41", cx);
  frames(v, cx, 6);
  const ends = () => [v.rows()[0].key, v.rows().at(-1).key];
  const before = ends();
  expect(before[1]).toBe("capped-later");
  const asked = [];
  v.scroll = { scroll_to_item(i, how) { asked.push([v.rowsMemo?.[i]?.key, how]); }, scroll_to_bottom() { asked.push(["end"]); } };
  v.probeDue = () => [];
  v.toggle("0:38", cx);
  settleRows(v, cx);
  cx.flush();
  // The cut did not move: the card's rows are inside the items it keeps.
  expect(ends()).toEqual(before);
  const rows = v.rows();
  let last = rows.findIndex((r) => r.key === "0:38");
  while (!["turn", "head", "day"].includes(rows[last + 1].kind)) last++;
  expect(rows[last].kind).toBe("copy");
  expect(asked).toEqual([[rows[last].key, "top"], ["0:38", "top"]]);
});

// Scene A of the cut's jumps: 80 turns under a cap of 60, #41's reply of 170 parts open and
// cut below, the reader at #41's head.
async function cutScene() {
  const r = await capSession(80, { max: 60 }, 40, 170);
  const { v, cx } = r;
  r.sim = simList(v);
  openAt(v, cx, r.sim, 562);
  v.open.add("0:41");
  v.command("search:#41", cx);
  settleList(v, cx, r.sim);
  expect(v.rows().at(-1).key).toBe("capped-later");
  return r;
}
// The frames after a jump until it settles: each shows the row it goes to, never the old view
// or a third place. Every frame drawn counts, the ones between the landing's timed asks too
// (drawBetweenAsks), not only each call's last.
function noThirdPlace(v, cx, sim, key, n = 8, then = () => {}) {
  const from = sim.frames.length;
  H.drawBetweenAsks = true;
  try {
    for (let k = 0; k < n; k++) probeFrame(v, cx);
    then();
    settleList(v, cx, sim);
  } finally { H.drawBetweenAsks = false; }
  const seen = sim.frames.slice(from).map((f) => shownIn(v, f));
  expect(seen.length).toBeGreaterThan(n);
  for (const [k, s] of seen.entries()) if (!s.includes(key)) throw new Error(`frame ${k + 1} of ${seen.length} shows ${s.join(", ")}`);
}

test("past the cap, a pin's return past the cut, which waits for the card's measures, never shows a third place while it waits", async () => {
  const { v, cx, sim } = await cutScene();
  v.pinnedList = () => [{ key: "0:65", turn: v.findTurn("0:65"), pin: { n: 65 }, s: v.current(), state: "done" }];
  v.goPin(0, cx);
  expect(v.scrollTo?.until).toBeGreaterThan(0);
  noThirdPlace(v, cx, sim, "0:65");
  H.listWindow = null;
});

test("past the cap, Enter from the outline on a turn past the cut, which waits, shows that turn from the first frame of the list", async () => {
  const { v, cx, sim } = await cutScene();
  v.query = "";
  v.action("outline:on", cx);
  settleList(v, cx, sim);
  v.sel = "0:65";
  v.action("open", cx);
  expect(v.outlined()).toBe(false);
  expect(v.scrollTo?.until).toBeGreaterThan(0);
  noThirdPlace(v, cx, sim, "0:65");
  H.listWindow = null;
});

test("past the cap, a jump past the cut while the rows are still reshaping (the scroll's 2 s wait) never shows a third place", async () => {
  const { v, cx, sim } = await cutScene();
  // As in a slow draw: the rows are built and reshaped over many frames.
  v.buildMax = () => 0;
  v.shapeBudget = 0;
  stillAt(v, 380);
  probeFrame(v, cx);
  expect(Boolean(v.shapeLeft > 0 || v.staleRows?.length || v.rowJob)).toBe(true);
  v.sel = "0:41";
  v.action("next", cx);
  expect(v.sel).toBe("0:42");
  noThirdPlace(v, cx, sim, "0:42", 4, () => { delete v.buildMax; v.shapeBudget = null; });
  H.listWindow = null;
});

test("past the cap, a jump from one start cut to another over a different window shows its turn in the first frame", async () => {
  const ev = [];
  for (let i = 0; i < 150; i++) ev.push(...capTurn(i, i === 40 || i === 100, 170));
  const { v, cx } = await scripted(ev);
  v.debug = false;
  v.win.cap = { ...v.win.cap, ...SMALL, max: 60 };
  v.width = 560; v.rootH = 1100; v.listH = 1000;
  const sim = simList(v);
  try {
    openAt(v, cx, sim, 562);
    v.open.add("0:41");
    v.open.add("0:101");
    v.command("search:#41", cx);
    settleList(v, cx, sim);
    // A start cut: the window's first items kept over the later note.
    const startCut = () => v.rows()[0].key !== "capped" && v.rows().at(-1).key === "capped-later";
    expect(startCut()).toBe(true);
    const was = v.win.from;
    // Down to the end of the items the cut keeps.
    sim.wheel(-1e6);
    settleList(v, cx, sim);
    v.command("search:#101", cx);
    probeFrame(v, cx);
    expect(v.win.from).not.toBe(was);
    expect(startCut()).toBe(true);
    expect(shownIn(v, sim.last())).toContain("0:101");
  } finally { H.listWindow = null; }
});

test("under a cut that does not move, a jump is asked for after its frame, as with no cut: #35 from the first turn shows in the next frame", async () => {
  const { v, cx, sim } = await cutScene();
  v.action("first", cx);
  settleList(v, cx, sim);
  const before = shownIn(v, sim.last());
  const ends = [v.rows()[0].key, v.rows().at(-1).key];
  v.command("search:#35", cx);
  probeFrame(v, cx);
  expect([v.rows()[0].key, v.rows().at(-1).key]).toEqual(ends);
  expect(shownIn(v, sim.last())).toEqual(before);
  probeFrame(v, cx);
  expect(shownIn(v, sim.last())).toContain("0:35");
  H.listWindow = null;
});

test("under a cut that does not move, a rail jump keeps the view for its first frame, then lands by its own two asks", async () => {
  const { v, cx, sim } = await cutScene();
  v.action("first", cx);
  settleList(v, cx, sim);
  const before = shownIn(v, sim.last());
  const asked = scrollsOf(v);
  v.railJump("0:35", cx);
  probeFrame(v, cx);
  expect(shownIn(v, sim.last())).toEqual(before);
  settleList(v, cx, sim);
  // No ask at once: the land path's first ask is a pane below the turn, its last the turn's
  // own place (landPlan); where the stub's list then puts it is a rig question.
  expect(asked.length).toBeGreaterThanOrEqual(2);
  expect(asked[0]).not.toBe("0:35");
  H.listWindow = null;
});

// A trackpad flick: its touch's events, then the momentum tail. gpui on macOS gives the tail's
// events (no touch phase of their own) as "moved" after the touch's "ended"; what Herdr passes
// on after a flick is not measured (Limits).
const flick = (sim) => { sim.wheel(-40, "started"); sim.wheel(-120, "moved"); sim.wheel(-60, "ended"); };
const tail = (sim) => { for (const dy of [-30, -12, -4]) sim.wheel(dy, "moved"); };

test("under a cut that does not move, a key jump made inside a flick's momentum tail is dropped by the tail's events: the wheel count takes every phase", async () => {
  const got = {};
  for (const when of ["no tail", "before its frame", "between its frame and its asks"]) {
    const { v, cx, sim } = await cutScene();
    v.action("first", cx);
    settleList(v, cx, sim);
    flick(sim);
    probeFrame(v, cx);
    v.command("search:#35", cx);
    if (when === "before its frame") { tail(sim); probeFrame(v, cx); }
    else if (when !== "no tail") { draw(v, cx); tail(sim); cx.flush(120, 3); dropTimers(v, cx); }
    settleList(v, cx, sim);
    got[when] = { shown: shownIn(v, sim.last()).includes("0:35"), waiting: v.scrollTo };
    H.listWindow = null;
  }
  // The same flick with no tail after the key: the jump lands.
  expect(got).toEqual({ "no tail": { shown: true, waiting: null }, "before its frame": { shown: false, waiting: null }, "between its frame and its asks": { shown: false, waiting: null } });
});

// A reader's own scroll and latest while a jump waits: the reader wins at once.
function slowRows(v, cx) { v.buildMax = () => 0; v.shapeBudget = 0; stillAt(v, 380); probeFrame(v, cx); }
const fastRows = (v) => { delete v.buildMax; v.shapeBudget = null; };
// The offset of each of n frames.
const offs = (v, cx, sim, n) => Array.from({ length: n }, () => { probeFrame(v, cx); return Math.round(sim.last().off); });

test("past the cap, a reader's wheel while a jump waits for the rows to reshape moves the view, and it stays: the jump is dropped", async () => {
  const { v, cx, sim } = await cutScene();
  slowRows(v, cx);
  v.sel = "0:41";
  v.action("next", cx);
  probeFrame(v, cx);
  expect(shownIn(v, sim.last())).toContain("0:42");
  const at = Math.round(sim.last().off) - 600;
  sim.wheel(600);
  expect(offs(v, cx, sim, 4)).toEqual([at, at, at, at]);
  fastRows(v);
  H.listWindow = null;
});

test("past the cap, a pin's return with a wheel down before it lands stays where the reader wheeled it", async () => {
  const { v, cx, sim } = await cutScene();
  v.pinnedList = () => [{ key: "0:65", turn: v.findTurn("0:65"), pin: { n: 65 }, s: v.current(), state: "done" }];
  v.goPin(0, cx);
  probeFrame(v, cx);
  const at = Math.round(sim.last().off) + 600;
  sim.wheel(-600);
  expect(offs(v, cx, sim, 4)).toEqual([at, at, at, at]);
  H.listWindow = null;
});

test("a wheel after a jump is taken, before the landing's own asks 16 and 48 ms on, ends them: a scroll to a turn, a pin's return, a rail jump (with its lift), a card", async () => {
  const lifts = [];
  for (const go of [(v, cx) => { v.sel = "0:41"; v.action("next", cx); }, (v, cx) => { v.pinnedList = () => [{ key: "0:65", turn: v.findTurn("0:65"), pin: { n: 65 }, s: v.current(), state: "done" }]; v.goPin(0, cx); }, (v, cx) => v.railJump("0:65", cx), (v, cx) => v.toggle("0:38", cx)]) {
    const { v, cx, sim } = await cutScene();
    v.probeDue = () => [];
    go(v, cx);
    const asked = scrollsOf(v);
    for (let k = 0; k < 4 && v.scrollTo; k++) draw(v, cx);
    expect(v.scrollTo).toBe(null);
    const n = asked.length;
    sim.wheel(-300);
    const at = Math.round(sim.off);
    // Past the 48 ms ask, before a lift's 120 ms end.
    cx.flush(60, 3);
    expect([asked.length, v.landLift ?? 0]).toEqual([n, 0]);
    lifts.push(v.landed?.lift ?? 0);
    cx.flush(120, 3);
    dropTimers(v, cx);
    delete v.probeDue;
    expect(offs(v, cx, sim, 3)).toEqual([at, at, at]);
    H.listWindow = null;
  }
  expect(Math.max(...lifts)).toBeGreaterThan(0);
});

// The held jumps above leave the landing's first ask out; a jump that did not wait has it.
test("under a cut that does not move, a wheel after a rail jump is taken, before its landing's first ask 16 ms on, ends its asks: the view stays where the wheel put it", async () => {
  const { v, cx, sim } = await cutScene();
  v.action("first", cx);
  settleList(v, cx, sim);
  const ends = [v.rows()[0].key, v.rows().at(-1).key];
  v.probeDue = () => [];
  v.railJump("0:35", cx);
  const asked = scrollsOf(v);
  let held = false;
  for (let k = 0; k < 4 && v.scrollTo; k++) { held ||= Boolean(v.scrollTo.held); draw(v, cx); }
  expect([v.scrollTo, held, [v.rows()[0].key, v.rows().at(-1).key]]).toEqual([null, false, ends]);
  sim.wheel(-300);
  const at = Math.round(sim.off);
  // Past the 48 ms ask, before a lift's 120 ms end.
  cx.flush(60, 3);
  expect([asked, v.landLift ?? 0]).toEqual([[], 0]);
  cx.flush(120, 3);
  dropTimers(v, cx);
  delete v.probeDue;
  expect(offs(v, cx, sim, 3)).toEqual([at, at, at]);
  H.listWindow = null;
});

test("latest while a jump waits for the rows to reshape shows the end in the next frame, and holds it", async () => {
  const { v, cx, sim } = await cutScene();
  slowRows(v, cx);
  v.sel = "0:41";
  v.action("next", cx);
  probeFrame(v, cx);
  v.action("latest", cx);
  const ends = [];
  for (let k = 0; k < 5; k++) { probeFrame(v, cx); ends.push(endOf(v, sim.last())); }
  expect(ends).toEqual([true, true, true, true, true]);
  fastRows(v);
  settleList(v, cx, sim);
  expect([v.follow, sim.last().end]).toEqual([true, true]);
  H.listWindow = null;
});

// A render Herdr stopped leaves renderOpen set, and the next render asks again for the scroll
// it took on (renderWant). A wheel or latest after it is the reader's newer word.
test("after a render Herdr stopped, a wheel still drops the jump that waits and a wheel up the end it took on, latest still holds the end, with no wheel since the end is asked for again, and a jump made after it wins", async () => {
  const got = {};
  const want = {};
  {
    const { v, cx, sim } = await cutScene();
    slowRows(v, cx);
    v.sel = "0:41";
    v.action("next", cx);
    probeFrame(v, cx);
    expect(shownIn(v, sim.last())).toContain("0:42");
    v.renderOpen = true;
    const at = Math.round(sim.last().off) - 600;
    sim.wheel(600);
    got.jump = [...offs(v, cx, sim, 4), v.scrollTo?.key ?? null];
    want.jump = [at, at, at, at, null];
    fastRows(v);
    H.listWindow = null;
  }
  {
    const { v, cx, sim } = await cutScene();
    slowRows(v, cx);
    v.action("latest", cx);
    probeFrame(v, cx);
    expect([endOf(v, sim.last()), v.toBottom]).toEqual([true, true]);
    v.renderOpen = true;
    const at = Math.round(sim.last().off) - 600;
    sim.wheel(600);
    got.end = [...offs(v, cx, sim, 4), v.follow];
    want.end = [at, at, at, at, false];
    fastRows(v);
    H.listWindow = null;
  }
  {
    const { v, cx, sim } = await cutScene();
    slowRows(v, cx);
    v.sel = "0:41";
    v.action("next", cx);
    probeFrame(v, cx);
    v.renderOpen = true;
    v.action("latest", cx);
    got.latest = [];
    for (let k = 0; k < 4; k++) { probeFrame(v, cx); got.latest.push([endOf(v, sim.last()), v.scrollTo?.key ?? null]); }
    want.latest = [[true, null], [true, null], [true, null], [true, null]];
    fastRows(v);
    H.listWindow = null;
  }
  {
    // A wheel long before: the end that a stopped render took on is still asked for again.
    const { v, cx, sim } = await cutScene();
    sim.wheel(300);
    settleList(v, cx, sim);
    v.action("latest", cx);
    v.render(cx);
    dropTimers(v, cx);
    expect(v.toBottom).toBe(false);
    v.renderOpen = true;
    const frame = v.frame.bind(v);
    v.frame = (c, light) => { got.again = v.toBottom; return frame(c, light); };
    v.render(cx);
    want.again = true;
    H.listWindow = null;
  }
  for (const [name, go] of [["rail", (v, cx) => v.railJump("0:20", cx)], ["search", (v, cx) => v.command("search:#20", cx)]]) {
    // Latest, a stopped render that took the end on, then a jump before the next render: the
    // jump is the newer word, as it is with no stop.
    const { v, cx, sim } = await cutScene();
    v.action("latest", cx);
    settleList(v, cx, sim);
    v.action("latest", cx);
    v.render(cx);
    dropTimers(v, cx);
    v.renderOpen = true;
    go(v, cx);
    settleList(v, cx, sim);
    got[name] = [v.sel, shownIn(v, sim.last()).includes("0:20")];
    want[name] = ["0:20", true];
    H.listWindow = null;
  }
  expect(got).toEqual(want);
});

// The y of a turn's head in a frame, or null when it is not in the list.
function headY(f, key) {
  const at = f.keys.indexOf(key);
  if (at < 0) return null;
  let y = -f.off;
  for (let k = 0; k < at; k++) y += f.sizes[k];
  return Math.round(y);
}

// Every frame a reader sees, drawn between the landing's timed asks too (drawBetweenAsks).
// A place is where the turn's head is (its y), so a move of the rows above it counts as much
// as a move of the offset. A rail jump lands with its lift (row 0 that much taller, so the
// turn lands level with its tick once it is gone) and settles by it 120 ms on: a third place,
// the lift's 29 px up from the landed one.
test("past the cap, a jump held while the cut moves lands from the held place: every frame drawn shows the turn, at the held place or the landed one, and a rail jump then settles by its lift", async () => {
  const got = {};
  const want = {};
  for (const [name, go] of [
    ["rail", (v, cx) => v.railJump("0:65", cx)],
    ["pin", (v, cx) => { v.pinnedList = () => [{ key: "0:65", turn: v.findTurn("0:65"), pin: { n: 65 }, s: v.current(), state: "done" }]; v.goPin(0, cx); }],
    ["next", (v, cx) => { v.sel = "0:64"; v.action("next", cx); }],
  ]) {
    const { v, cx, sim } = await cutScene();
    H.drawBetweenAsks = true;
    go(v, cx);
    const from = sim.frames.length;
    settleList(v, cx, sim);
    const frames = sim.frames.slice(from);
    const places = frames.map((f) => headY(f, "0:65")).filter((y, k, a) => k === 0 || y !== a[k - 1]);
    const lift = v.landed?.lift ?? 0;
    const settle = places.length === 3 && lift > 0 && places[1] - places[2] === lift ? `two, then ${lift} px up` : places;
    got[name] = { missing: frames.filter((f) => !shownIn(v, f).includes("0:65")).map((f) => Math.round(f.off)), places: places.length <= 2 ? "two at most" : settle };
    want[name] = { missing: [], places: name === "rail" ? "two, then 29 px up" : "two at most" };
    H.drawBetweenAsks = false;
    H.listWindow = null;
  }
  expect(got).toEqual(want);
});

test("past the cap, a pin's place that is gone falls back to the turn's head while the return waits, under a moved cut", async () => {
  const { v, cx, sim } = await cutScene();
  v.pinnedList = () => [{ key: "0:65", turn: v.findTurn("0:65"), pin: { n: 65, anchor: ["md", "99.3"] }, s: v.current(), state: "done" }];
  v.goPin(0, cx);
  v.goPin(0, cx);
  expect(v.scrollTo).toMatchObject({ key: "md:0:65:99.3", head: "0:65" });
  noThirdPlace(v, cx, sim, "0:65");
  H.listWindow = null;
});

test("past the cap, a jump that waits to a turn with pasted images holds the same item as it lands on: the tiles over the row", async () => {
  const { v, cx, sim } = await cutScene();
  Object.assign(v.findTurn("0:65"), { images: [{ path: "x.png" }], shapeKey: null });
  v.rowsKey = null;
  settleList(v, cx, sim);
  // The jump waits on a rows build in slices, at the same width: no row changes its height.
  v.buildMax = () => 0;
  v.rowsKey = null;
  probeFrame(v, cx);
  v.sel = "0:64";
  v.action("next", cx);
  const waiting = offs(v, cx, sim, 3);
  expect(v.scrollTo?.key).toBe("0:65");
  delete v.buildMax;
  settleList(v, cx, sim);
  expect(shownIn(v, sim.last())).toContain("imgs:0:65");
  expect(waiting).toEqual(Array(3).fill(Math.round(sim.last().off)));
  H.listWindow = null;
});

// A held jump holds the item it lands on at the top (landTop): the item over the turn's row
// comes along, so it is on screen in the held frames as in the landed one.
test("past the cap, a jump that waits to an agent turn folded to its one line keeps that line on screen in every frame: a rail click and a pin's return", async () => {
  const got = {};
  for (const [name, go] of [
    ["rail", (v, cx) => v.railJump("0:65", cx)],
    ["pin", (v, cx) => { v.pinnedList = () => [{ key: "0:65", turn: v.findTurn("0:65"), pin: { n: 65 }, s: v.current(), state: "done" }]; v.goPin(0, cx); }],
  ]) {
    const { v, cx, sim } = await cutScene();
    // A task's notice with no prompt of its own: its one line (afold) is over its row.
    Object.assign(v.findTurn("0:65"), { sender: { kind: "task-notification", name: "Background task" }, prompt: "", shapeKey: null });
    v.rowsKey = null;
    settleList(v, cx, sim);
    expect(v.allRows().find((r) => r.key === "af:0:65")?.turnKey).toBe("0:65");
    go(v, cx);
    const from = sim.frames.length;
    settleList(v, cx, sim);
    const ys = sim.frames.slice(from).map((f) => headY(f, "af:0:65"));
    got[name] = ys.length > 1 && ys.every((y) => y != null && y >= 0 && y < v.listH) ? "on screen" : ys;
    H.listWindow = null;
  }
  expect(got).toEqual({ rail: "on screen", pin: "on screen" });
});

test("past the cap, a pin's return to a turn the search hides keeps the note over its head on screen in every frame, held and landed", async () => {
  const { v, cx, sim } = await cutScene();
  // Every turn matches the search but #65; the open #41 keeps the list past the cap.
  Object.assign(v.findTurn("0:65"), { prompt: "Prompt 64: left out.", shapeKey: null });
  v.pinnedList = () => [{ key: "0:65", turn: v.findTurn("0:65"), pin: { n: 65 }, s: v.current(), state: "done" }];
  v.action("search:check order", cx);
  v.toList();
  settleList(v, cx, sim);
  expect([v.rows().some((r) => r.key === "0:65"), v.rows().at(-1).key]).toEqual([false, "capped-later"]);
  v.goPin(0, cx);
  const from = sim.frames.length;
  settleList(v, cx, sim);
  expect(v.pinVisit).toBe("0:65");
  const ys = sim.frames.slice(from).map((f) => [headY(f, "visit:0:65"), headY(f, "0:65")]);
  expect(ys.length).toBeGreaterThan(1);
  expect(ys.filter(([note, head]) => !(note >= 0 && head > note && head < v.listH))).toEqual([]);
  H.listWindow = null;
});

test("a wheel up ends the end's own asks: the one 16 ms after the end is taken, and the end held through a re-wrap", async () => {
  for (const rewrap of [false, true]) {
    const { v, cx, sim } = await cutScene();
    if (rewrap) {
      v.action("latest", cx);
      settleList(v, cx, sim);
      slowRows(v, cx);
      for (let k = 0; k < 20 && !v.anchor?.end; k++) probeFrame(v, cx);
      expect(v.anchor?.end).toBe(true);
    }
    else { v.action("latest", cx); draw(v, cx); }
    // Nothing asks a scroll after the wheel. Through a re-wrap the wheel lets the held end go
    // (holdDone, before the end's ask in the same frame), and the rows still to reshape then
    // move the view as with any place let go; with no re-wrap the view stays where it was.
    const asked = [];
    const end = v.askEnd.bind(v);
    v.askEnd = () => { asked.push("end"); end(); };
    const ask = v.askScroll.bind(v);
    v.askScroll = (i, h) => { asked.push(i); ask(i, h); };
    sim.wheel(600);
    const at = Math.round(sim.off);
    cx.flush(120, 3);
    dropTimers(v, cx);
    const o = offs(v, cx, sim, 3);
    expect(asked).toEqual([]);
    if (!rewrap) expect(o).toEqual([at, at, at]);
    fastRows(v);
    H.listWindow = null;
  }
});

// ---- the review's fixes ----

test("past the cap, latest on a newest turn open past it, in a session with a hidden agent message, shows the turn, not No user messages yet", async () => {
  const ts = new Date(Date.UTC(2026, 10, 1, 8, 0, 0)).toISOString();
  // A made-up teammate's message, hidden while agent messages are, then 20 turns, the last long.
  const ev = [{ k: "p", o: "peer", t: '<teammate-message teammate_id="helper-a" color="blue" summary="x">Done here</teammate-message>', ts }, { k: "d", ms: 200, ts }];
  for (let i = 0; i < 20; i++) ev.push(...capTurn(i, i === 19, 80));
  const { v, cx } = await scripted(ev);
  v.debug = false;
  v.win.cap = { ...v.win.cap, ...SMALL, max: 40 };
  v.width = 560; v.rootH = 1100; v.listH = 1000;
  v.prefs = { ...v.prefs, agentTurns: false };
  expect(v.counts().hiddenAll).toBe(1);
  const last = v.turnKeys(v.allRows()).at(-1);
  v.open.add(last);
  v.rowsKey = null;
  v.jumpLatest(true);
  frames(v, cx);
  // The list keeps only the open turn's last items: no turn's head is in it.
  expect(v.turnKeys(v.rows())).toEqual([]);
  expect(v.rows()[0].key).toBe("capped");
  expect(JSON.stringify(frame(v, cx)).includes("No user messages yet")).toBe(false);
  expect(lastList.sizes.length).toBe(40);
});

test("with no cut, a jump that moves the window shows its turn in the first frame: Home, a newer #n and latest from the oldest window", async () => {
  const { v, cx } = await capSession(150, SMALL);
  const sim = simList(v);
  const turns = (f) => shownIn(v, f).filter((k) => /^0:\d+$/.test(k));
  v.jumpLatest(true);
  settleList(v, cx, sim);
  expect(turns(sim.last())).toContain("0:150");
  // Home: from the newest window to the oldest. Neither is cut, so only the window moved.
  v.action("first", cx);
  probeFrame(v, cx);
  expect(v.capCut).toBe(0);
  expect(turns(sim.last())).toContain("0:1");
  settleList(v, cx, sim);
  // #120, in a window of its own, from the oldest one.
  v.command("search:#120", cx);
  probeFrame(v, cx);
  expect(turns(sim.last())).toContain("0:120");
  settleList(v, cx, sim);
  // And latest from the oldest window. (From #120's, which runs to the end, latest moves no
  // window: its frame keeps the view, as with no window, and the end is asked for after it.)
  v.action("first", cx);
  settleList(v, cx, sim);
  v.jumpLatest(true);
  probeFrame(v, cx);
  expect(turns(sim.last())).toContain("0:150");
  H.listWindow = null;
});

test("with Show later on screen, a card opened above the view keeps the turns on screen in the window: the end is the last row of the session's on screen", async () => {
  const { v, cx, s } = await capSession(150, SMALL, 125);
  v.jumpLatest(true);
  frames(v, cx);
  v.follow = false;
  v.toBottom = false;
  await addCapTurns(s, 150, 20);
  frames(v, cx);
  const rows = v.rows();
  expect(rows.at(-1).key).toBe("newer");
  // The view on the window's last turns and Show later under them.
  const n = rows.length;
  const last = v.turnKeys(rows).at(-1);
  try {
    H.listWindow = (k) => (k === v.rows().length && v.rows()[k - 1]?.key === "newer" ? { start: k - 6, end: k } : { start: 0, end: 1 });
    draw(v, cx);
    expect(v.viewRange[1]).toBe(n);
    expect(v.viewEndKey).toBe(last);
    v.open.add("0:126");
    H.listWindow = () => ({ start: 0, end: 1 });
    frames(v, cx, 1);
    expect(v.rows().some((r) => r.key.startsWith("md:0:126:"))).toBe(true);
    expect(inList(v, last)).toBe(true);
  } finally { H.listWindow = null; }
});

test("a selection the window leaves out opens its Turn card on the first i, as the window comes back around it", async () => {
  const { v, cx, s } = await capSession(150, SMALL);
  v.jumpLatest(true);
  frames(v, cx);
  const first = v.turnKeys(v.rows())[0];
  v.sel = first;
  v.follow = true;
  await addCapTurns(s, 150, 30);
  frames(v, cx);
  expect(inList(v, first)).toBe(false);
  expect(v.action("legend", cx)).toBe(true);
  expect(v.detailsOpen).toBe(true);
  frames(v, cx);
  expect(inList(v, first)).toBe(true);
  expect(v.sel).toBe(first);
  expect(v.detailsOpen).toBe(true);
});

test("a landing's late ask after a newer jump has landed in another window is dropped: the view stays on the newer turn", async () => {
  const { v, cx } = await capSession(150, SMALL);
  const sim = simList(v);
  const turns = (f) => shownIn(v, f).filter((k) => /^0:\d+$/.test(k));
  v.jumpLatest(true);
  settleList(v, cx, sim);
  // A rail jump to #100 lands: its asks wait 16 and 48 ms (landPlan, landExact).
  v.railJump("0:100", cx);
  draw(v, cx);
  const late = cx.timers;
  cx.timers = [];
  expect(late.length).toBeGreaterThan(0);
  // Before they run, Home moves the window to the oldest turns and lands there.
  v.action("first", cx);
  settleList(v, cx, sim);
  expect(turns(sim.last())).toContain("0:1");
  const asked = scrollsOf(v);
  for (const x of late) x.fn(cx);
  probeFrame(v, cx);
  // The first landing's asks named rows by their place in its own window's rows.
  expect(asked).toEqual([]);
  expect(turns(sim.last())).toContain("0:1");
  H.listWindow = null;
});

// The counts outside the window (RowWindow.outside) read through memoReads, below.
test("a refit for new measures reads no row outside the window, nor does a card opened inside it; a window moved reads only the rows between its old and new edges", async () => {
  const { v, cx } = await capSession(150, SMALL, 125);
  const n = memoReads(v);
  v.jumpLatest(true);
  frames(v, cx);
  v.action("first", cx);
  frames(v, cx);
  const calls = v.win.outside;
  let called = 0;
  v.win.outside = (list) => { called++; return calls(list); };
  n.outside = 0;
  // A batch of measures: new sizes, the same rows and window.
  for (let k = 0; k < 6; k++) { v.sizesVer = (v.sizesVer ?? 0) + 1; draw(v, cx); }
  expect(called).toBeGreaterThan(0);
  expect(n.outside).toBe(0);
  // A card opened inside the window splices its rows in, all of them before the window's end:
  // the count after the window is carried over them.
  const more = v.rows().find((r) => r.key === "newer");
  v.open.add("0:30");
  frames(v, cx, 1);
  expect(n.outside).toBe(0);
  expect(v.rows().find((r) => r.key === "newer").text).toBe(more.text);
  // Show later: the window moves, the counts follow it, from the rows between the edges.
  const was = { ...v.win.at };
  v.showMore(true);
  frames(v, cx, 1);
  const all = v.allRows();
  const { a, z } = v.win.at;
  expect(z).toBeGreaterThan(was.z);
  expect(n.outside).toBeGreaterThan(0);
  expect(n.outside).toBeLessThan(a + all.length - z);
  const { earlier, later } = v.win.outside(v.winList());
  expect(earlier).toBe(all.slice(0, a).filter((r) => TURN_ROW.has(r.kind)).length);
  expect(later).toBe(all.slice(z).filter((r) => TURN_ROW.has(r.kind)).length);
});

test("a window that starts partway through a day keeps that day's pill over its first turns: the day's band is above the window", async () => {
  // Three days of 50 turns each.
  const { v, cx } = await capSession(150, SMALL, -1, 25, (i) => Math.floor(i / 50));
  v.jumpLatest(true);
  frames(v, cx);
  // Show earlier from the newest window, until the window starts partway through a day.
  let rows = v.rows();
  let top;
  for (let k = 0; k < 12 && !top; k++) {
    v.showMore(false);
    frames(v, cx);
    rows = v.rows();
    const firstDay = rows.findIndex((r) => r.kind === "day");
    top = rows.find((r, i) => (firstDay < 0 || i < firstDay) && r.kind === "turn");
  }
  expect(top).toBeDefined();
  const all = v.allRows();
  // The window's first turns are on a day whose band it left out.
  const at = all.findIndex((r) => r.key === top.key);
  const band = all.slice(0, at).findLast((r) => r.kind === "day");
  expect(band).toBeDefined();
  expect(rows.some((r) => r.key === band.key)).toBe(false);
  // A frame with the window's first turn at the top of the list draws that day's pill: the
  // band's row as the session's rows hold it.
  expect(drawnPill(v, cx, top.key)).toBe(band);
  // And with the turn under it at the top, the same pill.
  const next = rows[rows.indexOf(top) + 1];
  expect(drawnPill(v, cx, next.key)).toBe(band);
});

test("a window that ends with Show later has the Jump to latest pill's room under it in the Chat, and none in the outline", async () => {
  const { v, cx, s } = await capSession(150, SMALL);
  v.jumpLatest(true);
  frames(v, cx);
  v.follow = false;
  v.toBottom = false;
  await addCapTurns(s, 150, 20);
  frames(v, cx);
  expect(v.rows().at(-1).key).toBe("newer");
  try {
    // The view at the window's end: Show later on screen, the session's end not.
    H.listWindow = (n) => ({ start: Math.max(0, n - 6), end: n });
    frames(v, cx, 1);
    expect(v.pillShown()).toBe(true);
    // Show later's 36 px, then the pill's 28, 10 px over the list's end (PILL_H, PILL_GAP).
    expect(v.sizesMemo.at(-1)).toBe(36 + 28 + 10);
    v.action("outline:on", cx);
    frames(v, cx, 1);
    expect(v.rows().at(-1).key).toBe("newer");
    expect(v.pillShown()).toBe(false);
    expect(v.sizesMemo.at(-1)).toBe(36);
  } finally { H.listWindow = null; }
});

test("RowWindow: the note over a turn a search hides, which a pin's return shows, leads its turn: a window never starts or ends between them", () => {
  // n turns of one row, turn 20 hidden by the search and visited: its note, then its row; and
  // with day, a day band over the note.
  const make = (n, day = false) => {
    const rows = [];
    for (let t = 1; t <= n; t++) {
      const turn = { n: t };
      if (t === 20 && day) rows.push({ kind: "day", key: "day:0:2026-11-2" });
      if (t === 20) rows.push({ kind: "note", key: "visit:0:20", text: "Pinned, not in this search" });
      rows.push({ kind: "turn", key: `0:${t}`, si: 0, turn });
    }
    return { rows, index: new Map(rows.map((r, i) => [r.key, i])) };
  };
  const w = new RowWindow({ slide: 10, block: 3, stop: 12 });
  let list = make(26);
  const note = list.index.get("visit:0:20");
  const head = list.index.get("0:20");
  expect(head).toBe(note + 1);
  // The turn's first row is the note's: back from the row to the note, on past it to the next turn.
  expect(w.start(list, head, -1)).toBe(note);
  expect(w.start(list, note, 1)).toBe(note);
  expect(w.start(list, head, 1)).toBe(head + 1);
  expect(w.turnRow(list, "0:20")).toBe(note);
  // Tail, with slide - block rows back from the end falling on the turn's row.
  expect(list.rows.length - 7).toBe(head);
  let at = w.place(list, { tail: true });
  expect(list.rows[at.a].key).not.toBe("0:20");
  // A jump to the turn keeps the note in the range.
  at = w.place(list, { want: head });
  expect(at.a).toBeLessThanOrEqual(note);
  expect(at.z).toBeGreaterThan(head);
  // With a day band over the note, the band leads them both.
  list = make(26, true);
  expect(w.start(list, list.index.get("0:20"), -1)).toBe(list.index.get("day:0:2026-11-2"));
  expect(w.start(list, list.index.get("visit:0:20"), -1)).toBe(list.index.get("day:0:2026-11-2"));
  // A turn without a note keeps the day-band rule as before.
  expect(w.start(list, list.index.get("0:21"), -1)).toBe(list.index.get("0:21"));
});

test("in a window of agent messages only, with Agent messages on the rail off, up and down go a turn at a time: Show earlier is no rail tick", async () => {
  const { v, cx } = await capSession(150, SMALL);
  for (const t of v.current().turns) t.agent = true;
  v.prefs = { ...v.prefs, agentTurns: true, agentRail: false };
  v.rowsKey = null;
  v.jumpLatest(true);
  frames(v, cx);
  const keys = v.turnKeys(v.rows());
  expect(v.rows().some((r) => r.key === "older")).toBe(true);
  expect(keys.some((k) => v.railStop(k))).toBe(false);
  v.sel = "0:140";
  v.action("prev", cx);
  expect(v.sel).toBe("0:139");
  v.action("next", cx);
  expect(v.sel).toBe("0:140");
  // From the window's first turn, up goes on to Show earlier.
  v.sel = keys[0];
  v.action("prev", cx);
  expect(v.sel).toBe("older");
});

// ---- the memos' inputs, a new turn in an older window, and a seeded run of jumps ----

// The turns outside the window, counted afresh from the session's rows, and the counts the
// pane draws (RowWindow.outside, through its memo) beside them, with the Show earlier and Show
// later items' text.
const TURN_ROW = new Set(["turn", "head", "working", "wrow", "line"]);
function outsideNow(v) {
  const all = v.allRows();
  const { a, z } = v.win.at ?? { a: 0, z: all.length };
  const fresh = { earlier: all.slice(0, a).filter((r) => TURN_ROW.has(r.kind)).length, later: all.slice(z).filter((r) => TURN_ROW.has(r.kind)).length };
  const rows = v.rows();
  return { fresh, drawn: v.win.outside(v.winList()), older: rows.find((r) => r.key === "older")?.text ?? null, newer: rows.find((r) => r.key === "newer")?.text ?? null };
}
const turnsText = (n, way) => (n ? `${n.toLocaleString()} ${way} turns` : null);
function expectOutsideRight(v) {
  const o = outsideNow(v);
  expect(o.drawn).toEqual(o.fresh);
  expect(o.older).toBe(turnsText(o.fresh.earlier, "earlier"));
  expect(o.newer).toBe(turnsText(o.fresh.later, "later"));
  return o.fresh;
}
// A session of n short turns where every seventh (3, 10, 17, ...) is a made-up teammate's
// message, over days of perDay turns.
async function agentSession(n, cap, perDay = 1000) {
  const ev = [];
  for (let i = 0; i < n; i++) {
    const ts = new Date(Date.UTC(2026, 10, 1 + Math.floor(i / perDay), 9, 0, 0) + i * 1000).toISOString();
    const peer = i % 7 === 3;
    ev.push({ k: "p", o: peer ? "peer" : "human", t: peer ? `<teammate-message teammate_id="helper-a" color="blue" summary="check">Check ${i} done.</teammate-message>` : `Prompt ${i}: check order ${i}.`, ts }, { k: "t", t: `Reply ${i}: the order is fine.` }, { k: "d", ts });
  }
  const r = await scripted(ev);
  r.v.debug = false;
  r.v.win.cap = { ...r.v.win.cap, ...cap };
  r.v.width = 560; r.v.rootH = 1100; r.v.listH = 1000;
  return r;
}

test("the counts outside the window follow turns appended under a window in the middle: the rows are rebuilt and the window stays", async () => {
  const { v, cx, s } = await capSession(150, SMALL);
  v.jumpLatest(true);
  frames(v, cx);
  v.command("search:#90", cx);
  v.command("escape", cx);
  frames(v, cx);
  const was = expectOutsideRight(v);
  expect(was.earlier).toBeGreaterThan(0);
  expect(was.later).toBeGreaterThan(0);
  const at = { ...v.win.at };
  const rows = v.allRows();
  await addCapTurns(s, 150, 5);
  frames(v, cx);
  // A rebuild of the session's rows, not a splice, with the window where it was.
  expect(v.allRows()).not.toBe(rows);
  expect({ a: v.win.at.a, z: v.win.at.z }).toEqual({ a: at.a, z: at.z });
  expect(expectOutsideRight(v)).toEqual({ earlier: was.earlier, later: was.later + 5 });
});

test("the counts outside the window follow a search and its clearing: the rows are rebuilt to the matches and back", async () => {
  const { v, cx } = await capSession(200, SMALL);
  v.jumpLatest(true);
  frames(v, cx);
  const all = expectOutsideRight(v);
  // "order 1" matches turns 1, 10 to 19 and 100 to 199 (keys 0:2, 0:11 to 0:20, 0:101 to 0:200).
  v.command("search:order 1", cx);
  frames(v, cx);
  const hits = expectOutsideRight(v);
  expect(hits).not.toEqual(all);
  v.command("search:", cx);
  frames(v, cx);
  expect(expectOutsideRight(v).earlier).toBeGreaterThan(hits.earlier);
});

test("the counts outside the window stay right through the agent messages toggle, both ways: the rows are rebuilt, the turns are the same", async () => {
  const { v, cx } = await agentSession(200, SMALL);
  v.jumpLatest(true);
  frames(v, cx);
  const before = expectOutsideRight(v);
  expect(before.earlier).toBeGreaterThan(0);
  const n = v.allRows().length;
  // Shown, an agent message is its own turn row; hidden, it keeps that row under a folded line
  // (afold), so the rows change and the turns counted do not.
  v.action("agents", cx);
  frames(v, cx);
  expect(v.allRows().length).not.toBe(n);
  expect(expectOutsideRight(v)).toEqual(before);
  v.action("agents", cx);
  frames(v, cx);
  expect(v.allRows().length).toBe(n);
  expect(expectOutsideRight(v)).toEqual(before);
});

test("the counts outside the window follow Show earlier, which moves only the window's start", async () => {
  const { v, cx } = await capSession(150, SMALL);
  v.jumpLatest(true);
  frames(v, cx);
  const was = expectOutsideRight(v);
  const at = { ...v.win.at };
  const rows = v.allRows();
  v.showMore(false);
  frames(v, cx);
  expect(v.allRows()).toBe(rows);
  expect(v.win.at.z).toBe(at.z);
  expect(v.win.at.a).toBeLessThan(at.a);
  expect(expectOutsideRight(v).earlier).toBeLessThan(was.earlier);
});

test("the counts outside the window follow Show later, which moves only the window's end while it stays under its slide", async () => {
  // From the oldest window, a window of the first 40 rows (as a reader's range that the end
  // was cut to): Show later then brings a block in under the slide of 60, and the start stays.
  const { v, cx } = await capSession(150, SMALL);
  v.jumpLatest(true);
  frames(v, cx);
  v.action("first", cx);
  frames(v, cx);
  v.win.keep(v.winList(), 0, 40, false);
  frames(v, cx);
  expect({ a: v.win.at.a, z: v.win.at.z }).toEqual({ a: 0, z: 40 });
  const was = expectOutsideRight(v);
  const at = { ...v.win.at };
  const rows = v.allRows();
  v.showMore(true);
  frames(v, cx);
  expect(v.allRows()).toBe(rows);
  expect(v.win.at.a).toBe(0);
  expect(v.win.at.z).toBeGreaterThan(at.z);
  expect(expectOutsideRight(v).later).toBeLessThan(was.later);
});

test("a new transcript drops the counts outside the window with the window: none is kept from the session before", async () => {
  const { v, cx } = await capSession(150, SMALL);
  v.jumpLatest(true);
  frames(v, cx);
  expectOutsideRight(v);
  expect(v.win.outMemo).not.toBeNull();
  // A pick drops the window and its counts at once (RowWindow.reset), before the new rows come.
  v.pick({ path: fixture("--only", "3") }, cx);
  expect(v.win.at).toBeNull();
  expect(v.win.outMemo).toBeNull();
  await settle(v);
  frames(v, cx);
  expect(v.current().turns.length).toBe(3);
  expect(expectOutsideRight(v)).toEqual({ earlier: 0, later: 0 });
});

// The day band the pill takes for the window's first turn: the last band above it in the
// session's rows, as a row of the rows the pane holds now.
function dayAboveNow(v) {
  const all = v.allRows();
  const head = v.rows().find((r) => v.baseIndex.has(r.key) && TURN_ROW.has(r.kind));
  const at = all.indexOf(head);
  return { head, band: all.slice(0, at).findLast((r) => r.kind === "day") ?? null, inRows: v.rows().some((r) => r.kind === "day" && v.rows().indexOf(r) < v.rows().indexOf(head)) };
}
function expectPillRight(v, cx) {
  const d = dayAboveNow(v);
  expect(drawnPill(v, cx, d.head.key)).toBe(d.band);
  return d;
}

test("the day pill over a window's first turns follows the window each way, across a day: Show earlier and Show later", async () => {
  // Three days of 50 turns each.
  const { v, cx } = await capSession(150, SMALL, -1, 25, (i) => Math.floor(i / 50));
  v.jumpLatest(true);
  frames(v, cx);
  // Show earlier until the window starts partway through a day, then on into the day before.
  const days = [];
  for (let k = 0; k < 14; k++) {
    v.showMore(false);
    frames(v, cx);
    const d = expectPillRight(v, cx);
    if (!d.inRows && d.band && days.at(-1) !== d.band.key) days.push(d.band.key);
  }
  expect(days.length).toBeGreaterThanOrEqual(2);
  // And Show later back across a day.
  const back = [];
  for (let k = 0; k < 14; k++) {
    if (!v.rows().some((r) => r.key === "newer")) break;
    v.showMore(true);
    frames(v, cx);
    const d = expectPillRight(v, cx);
    if (!d.inRows && d.band && back.at(-1) !== d.band.key) back.push(d.band.key);
  }
  expect(back.length).toBeGreaterThanOrEqual(2);
});

test("the day pill over a window's first turns is the band of the rows the pane holds after a rebuild and a splice", async () => {
  const { v, cx, s } = await capSession(150, SMALL, -1, 25, (i) => Math.floor(i / 50));
  v.jumpLatest(true);
  frames(v, cx);
  for (let k = 0; k < 14 && dayAboveNow(v).inRows; k++) { v.showMore(false); frames(v, cx); }
  const d = expectPillRight(v, cx);
  expect(d.inRows).toBe(false);
  // A rebuild: turns appended below. The window's start stays, and the pill's band is the
  // new rows' own, not the one from the rows before.
  const rows = v.allRows();
  await addCapTurns(s, 150, 3);
  frames(v, cx);
  expect(v.allRows()).not.toBe(rows);
  const rebuilt = expectPillRight(v, cx);
  expect(rebuilt.band.key).toBe(d.band.key);
  // The band's row was built again with the newest day's rows: a band kept from the rows
  // before would be another row with the same key.
  expect(rebuilt.band).not.toBe(d.band);
  // A splice: a card opened inside the window, and one closed again.
  const inside = v.turnKeys(v.rows())[2];
  v.open.add(inside);
  frames(v, cx);
  expect(expectPillRight(v, cx).band.key).toBe(d.band.key);
  v.open.delete(inside);
  frames(v, cx);
  expect(expectPillRight(v, cx).band.key).toBe(d.band.key);
});

test("a new turn while the reader sits in an older window: nothing on screen moves, Show later's count grows, the counts follow, and the selection stays", async () => {
  // A made-up transcript of 155 turns, cut after the 150th, so the last 5 arrive by a read.
  const file = fixture("--only", "155", "--gap", "60");
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const prompts = lines.map((l, i) => [JSON.parse(l), i]).filter(([j]) => j.type === "user" && !j.isMeta && typeof j.message?.content === "string").map(([, i]) => i);
  expect(prompts.length).toBe(155);
  writeFileSync(file, `${lines.slice(0, prompts[150]).join("\n")}\n`);
  const rest = `${lines.slice(prompts[150]).join("\n")}\n`;
  const { v, cx } = await pane(file);
  v.debug = false;
  v.win.cap = { ...v.win.cap, ...SMALL };
  v.width = 560; v.rootH = 1100; v.listH = 1000;
  v.jumpLatest(true);
  frames(v, cx);
  expect(v.current().turns.length).toBe(150);
  // The oldest window, with #10 selected and on screen.
  v.action("first", cx);
  frames(v, cx);
  v.command("search:#10", cx);
  v.command("escape", cx);
  frames(v, cx);
  expect(v.sel).toBe("0:10");
  expect(v.follow).toBe(false);
  const top = 4;
  H.listWindow = () => ({ start: top, end: top + 8 });
  try {
    draw(v, cx);
    const sig = () => v.rows().slice(0, top + 8).map((r, i) => `${r.key}|${v.slotsMemo[i]}`);
    const before = sig();
    const was = expectOutsideRight(v);
    expect(was.later).toBeGreaterThan(0);
    const ends = { from: v.win.from, to: v.win.to };
    appendFileSync(file, rest);
    v.read(cx);
    await settle(v);
    settleRows(v, cx);
    expect(v.current().turns.length).toBe(155);
    expect(sig()).toEqual(before);
    expect({ from: v.win.from, to: v.win.to }).toEqual(ends);
    expect(expectOutsideRight(v)).toEqual({ earlier: was.earlier, later: was.later + 5 });
    expect(v.sel).toBe("0:10");
    expect(v.follow).toBe(false);
  } finally {
    H.listWindow = null;
  }
});

// A small fixed-seed generator (mulberry32), so the run of jumps is the same on every machine.
function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

test("a seeded run of 60 jumps over a small window and a small cap: after each settles, the drawn range holds the row it went to", async () => {
  // 150 turns, #41 open with 25 parts: past a cap of 40 items the list is cut around it.
  const { v, cx } = await capSession(150, { ...SMALL, max: 40 }, 40);
  const sim = simList(v);
  v.jumpLatest(true);
  settleList(v, cx, sim);
  v.open.add("0:41");
  settleList(v, cx, sim);
  const rnd = seeded(291);
  const ops = ["#n", "#n", "next", "prev", "first", "latest", "open", "earlier", "later"];
  const bad = [];
  const seen = { cut: 0, windowed: 0, ops: {} };
  try {
    for (let k = 0; k < 60; k++) {
      const op = ops[Math.floor(rnd() * ops.length)];
      const n = 1 + Math.floor(rnd() * 150);
      if (op === "#n") { v.command(`search:#${n}`, cx); v.command("escape", cx); }
      else if (op === "earlier" || op === "later") { if (!v.rows().some((r) => r.key === (op === "earlier" ? "older" : "newer"))) continue; v.showMore(op === "later"); }
      else if (op === "latest") v.jumpLatest(true);
      else v.action(op, cx);
      settleList(v, cx, sim);
      seen.ops[op] = (seen.ops[op] ?? 0) + 1;
      if (v.capCut > 0) seen.cut++;
      if (v.win.at && (v.win.at.a > 0 || v.win.at.z < v.allRows().length)) seen.windowed++;
      const shown = shownIn(v, sim.last());
      const want = op === "latest" ? v.rows().at(-1).key : v.sel;
      if (!shown.includes(want)) bad.push(`${k} ${op}${op === "#n" ? n : ""}: ${want} not in ${shown[0]}..${shown.at(-1)}`);
    }
  } finally {
    H.listWindow = null;
  }
  expect(bad).toEqual([]);
  // The run went through the cut and through windows that leave rows out, with every kind of
  // step.
  expect(seen.cut).toBeGreaterThan(5);
  expect(seen.windowed).toBeGreaterThan(20);
  expect(Object.keys(seen.ops).sort()).toEqual(["#n", "earlier", "first", "later", "latest", "next", "open", "prev"]);
});

// ---- the timers that scroll: each dropped when the reader has gone elsewhere first ----

// The ends the pane asked the list to scroll to (askEnd), counted.
function endsOf(v) {
  const n = { ends: 0 };
  const end = v.askEnd.bind(v);
  v.askEnd = () => { n.ends++; end(); };
  return n;
}

test("a landing's late asks are dropped by a newer landing in the same rows, and ask for their row by key after the rows above it change", async () => {
  const { v, cx } = await capSession(150, SMALL);
  const sim = simList(v);
  const turns = (f) => shownIn(v, f).filter((k) => /^0:\d+$/.test(k));
  v.action("first", cx);
  settleList(v, cx, sim);
  // A rail jump to #30 inside the oldest window, then, before its late asks, #5 there: the
  // same rows, so #30's row is still in them, and only the newer landing drops its asks.
  v.railJump("0:30", cx);
  draw(v, cx);
  const late = cx.timers;
  cx.timers = [];
  expect(late.length).toBeGreaterThan(0);
  v.command("search:#5", cx);
  v.command("escape", cx);
  settleList(v, cx, sim);
  expect(turns(sim.last())).toContain("0:5");
  const asked = scrollsOf(v);
  for (const x of late) x.fn(cx);
  probeFrame(v, cx);
  expect(asked).toEqual([]);
  expect(turns(sim.last())).toContain("0:5");
  H.listWindow = null;
  // A rail jump to #20, and before its late asks a card of 25 parts opened above it with no
  // scroll of its own (set here, as the window tests set it): every row from the card down
  // moves on, and the asks name the same rows as with no card opened. The rows asked for stay
  // in the window wherever the view is: with the card they are within its first 66 items.
  const lateAsks = async (open) => {
    const { v, cx } = await capSession(150, SMALL, 4);
    const sim = simList(v);
    v.action("first", cx);
    settleList(v, cx, sim);
    v.railJump("0:20", cx);
    draw(v, cx);
    const late = cx.timers;
    cx.timers = [];
    const then = v.rows();
    if (open) { v.open.add("0:5"); draw(v, cx); }
    const asked = scrollsOf(v);
    for (const x of late) x.fn(cx);
    H.listWindow = null;
    // Where each row asked for was in the landing's rows, and where it is now.
    return { asked, moved: asked.map((k) => v.rowsMemo.findIndex((r) => r.key === k) - then.findIndex((r) => r.key === k)) };
  };
  const plain = await lateAsks(false);
  expect(plain.asked.length).toBeGreaterThan(0);
  const opened = await lateAsks(true);
  expect(opened.asked).toEqual(plain.asked);
  // The card moved every one of them on, so an ask by the landing's index would name others.
  for (const d of opened.moved) expect(d).toBeGreaterThan(0);
});

// The list is the plain one, so a jump that waits asks for nothing while it waits (nothing is held).
test("a landing's late asks are dropped while a newer jump waits for the rows to reshape: the view stays as it was until the newer turn lands", async () => {
  for (const [name, go] of [["#30 in the search", (v, cx) => v.command("search:#30", cx)], ["a rail click on #30", (v, cx) => v.railJump("0:30", cx)]]) {
    const { v, cx } = await capSession(80);
    const sim = simList(v);
    v.jumpLatest(true);
    settleList(v, cx, sim);
    go(v, cx);
    draw(v, cx);
    const late = cx.timers;
    cx.timers = [];
    expect([name, v.scrollTo, late.length > 0]).toEqual([name, null, true]);
    // Before its asks, #5, while rows are left to reshape.
    Object.defineProperty(v, "shapeLeft", { get: () => 5, set() {}, configurable: true });
    v.command("search:#5", cx);
    draw(v, cx);
    const at = Math.round(sim.last().off);
    const asked = scrollsOf(v);
    for (const x of late) x.fn(cx);
    draw(v, cx);
    expect([name, asked, Math.round(sim.last().off), v.scrollTo?.key]).toEqual([name, [], at, "0:5"]);
    delete v.shapeLeft;
    v.shapeLeft = 0;
    settleList(v, cx, sim);
    expect([name, shownIn(v, sim.last()).includes("0:5")]).toEqual([name, true]);
    H.listWindow = null;
  }
});

// Down held from #5 for 60 presses. Herdr passes a held key's repeats on and draws what is due
// before each one, so every press has a draw of its own. The frames after the first that do not
// show the turn selected in them; then, let go, whether the list shows the turn it ended on.
async function heldDown(asks) {
  const { v, cx, s } = await capSession(80);
  const sim = simList(v);
  v.command("search:#5", cx);
  v.command("escape", cx);
  settleList(v, cx, sim);
  expect([v.sel, cx.timers]).toEqual(["0:5", []]);
  const lost = [];
  for (let k = 1; k <= 60; k++) {
    asks(v, cx, k, s);
    if (k > 1 && !shownIn(v, sim.last()).includes(v.sel)) lost.push(v.sel);
  }
  settleList(v, cx, sim);
  const end = [v.sel, shownIn(v, sim.last()).includes(v.sel)];
  H.listWindow = null;
  return { lost, end };
}
test("a key held down, each repeat before the last landing's ask 16 ms on, shows the turn it has reached in every frame but the first", async () => {
  expect(await heldDown((v, cx) => { v.action("next", cx); cx.flush(16); draw(v, cx); })).toEqual({ lost: [], end: ["0:65", true] });
});
test("a key held down, each repeat and its draw before the last landing's ask 16 ms on, shows the turn it has reached in every frame but the first", async () => {
  expect(await heldDown((v, cx) => {
    const late = cx.timers;
    cx.timers = [];
    v.action("next", cx);
    draw(v, cx);
    for (const x of late) if (x.ms <= 16) x.fn(cx);
  })).toEqual({ lost: [], end: ["0:65", true] });
});
test("a key held down while a turn comes in and then is done: each press lands once, and every frame but the first shows the turn it has reached", async () => {
  const { apply } = await import("../mods/agent-threads/core/turns.js");
  const [p, t, d] = capTurn(80);
  const landed = [];
  expect(await heldDown((v, cx, k, s) => {
    // The newest turn's prompt and first text come in at press 20, and it is done at press 40.
    if (k === 20) { apply(s, p); apply(s, t); s.version++; }
    if (k === 40) { apply(s, d); s.version++; }
    const late = cx.timers;
    cx.timers = [];
    const n = v.landN ?? 0;
    v.action("next", cx);
    draw(v, cx);
    landed.push((v.landN ?? 0) - n);
    expect(v.turnKeys(v.rowsMemo).length).toBe(k < 20 ? 80 : 81);
    for (const x of late) if (x.ms <= 16) x.fn(cx);
  })).toEqual({ lost: [], end: ["0:65", true] });
  expect(landed).toEqual(Array(60).fill(1));
});
// The 16 ms ask goes to the turn's row, and the one 48 ms on to the tiles over it.
test("a key held down onto a turn with pasted images: the ask in its frame and the one 16 ms on put the list at the same place, and the tiles' own comes after them", async () => {
  const { v, cx } = await capSession(80);
  const sim = simList(v);
  Object.assign(v.findTurn("0:32"), { images: [{ path: "x.png" }], shapeKey: null });
  v.rowsKey = null;
  v.command("search:#28", cx);
  v.command("escape", cx);
  settleList(v, cx, sim);
  expect([v.sel, v.rows().some((r) => r.key === "imgs:0:32")]).toEqual(["0:28", true]);
  const asked = scrollsOf(v);
  for (let k = 0; k < 4; k++) {
    const late = cx.timers;
    cx.timers = [];
    asked.length = 0;
    v.action("next", cx);
    draw(v, cx);
    for (const x of late) if (x.ms <= 16) x.fn(cx);
  }
  expect([v.sel, asked.length]).toEqual(["0:32", 1]);
  // Let go: the frame after the landing's, then the one after its ask 16 ms on.
  const from = sim.frames.length - 1;
  draw(v, cx);
  const due = cx.timers;
  cx.timers = [];
  for (const x of due) if (x.ms <= 16) x.fn(cx);
  draw(v, cx);
  const at = sim.frames.slice(from).map((f) => Math.round(f.off));
  expect(at).toEqual(at.map(() => at.at(-1)));
  expect(shownIn(v, sim.last())).toContain("0:32");
  for (const x of due) if (x.ms === 48) x.fn(cx);
  expect(asked.at(-1)).toBe("imgs:0:32");
  H.listWindow = null;
});
test("a key alone asks for its turn once, 16 ms after it lands and not in its frame, and so does the next key", async () => {
  const { v, cx } = await capSession(80);
  const sim = simList(v);
  v.command("search:#5", cx);
  v.command("escape", cx);
  settleList(v, cx, sim);
  const asked = scrollsOf(v);
  const got = [];
  for (let k = 0; k < 2; k++) {
    v.action("next", cx);
    draw(v, cx);
    const inFrame = asked.splice(0);
    cx.flush(48);
    got.push([v.sel, inFrame, asked.splice(0)]);
  }
  expect(got).toEqual([["0:6", [], ["0:6"]], ["0:7", [], ["0:7"]]]);
  H.listWindow = null;
});
test("a step's late ask after Home has moved the window is dropped, and the next key asks for its turn 16 ms on, not in its frame", async () => {
  const { v, cx } = await capSession(150, SMALL);
  const sim = simList(v);
  const turns = (f) => shownIn(v, f).filter((k) => /^0:\d+$/.test(k));
  v.jumpLatest(true);
  settleList(v, cx, sim);
  v.command("search:#100", cx);
  v.command("escape", cx);
  settleList(v, cx, sim);
  v.action("prev", cx);
  draw(v, cx);
  const late = cx.timers;
  cx.timers = [];
  expect([v.sel, v.scrollTo, late.some((x) => x.ms === 16)]).toEqual(["0:99", null, true]);
  // Before its ask, Home moves the window to the oldest turns and lands there.
  v.action("first", cx);
  settleList(v, cx, sim);
  expect(turns(sim.last())).toContain("0:1");
  const asked = scrollsOf(v);
  for (const x of late) x.fn(cx);
  probeFrame(v, cx);
  expect(asked).toEqual([]);
  expect(turns(sim.last())).toContain("0:1");
  // The step's ask was never made, and Home came since: the next key is a key alone.
  v.action("next", cx);
  draw(v, cx);
  expect([v.sel, asked]).toEqual(["0:2", []]);
  cx.flush(48);
  expect(asked).toEqual(["0:2"]);
  H.listWindow = null;
});

// The list with #5 selected and a step down to #6 drawn: the timers of its landing still to come.
async function stepped() {
  const { v, cx } = await capSession(80);
  const sim = simList(v);
  v.command("search:#5", cx);
  v.command("escape", cx);
  settleList(v, cx, sim);
  const asked = scrollsOf(v);
  v.action("next", cx);
  draw(v, cx);
  const late = cx.timers;
  cx.timers = [];
  expect([v.sel, v.scrollTo, asked.splice(0), late.some((x) => x.ms === 16)]).toEqual(["0:6", null, [], true]);
  return { v, cx, sim, asked, late };
}
test("a step's ask that the reader's wheel dropped is not owed: one key well after it asks for its turn once, 16 ms on, not in its frame", async () => {
  const { v, cx, sim, asked, late } = await stepped();
  sim.wheel(-200);
  for (const x of late) x.fn(cx);
  settleList(v, cx, sim);
  expect(asked).toEqual([]);
  v.action("next", cx);
  draw(v, cx);
  const inFrame = asked.splice(0);
  cx.flush(48);
  expect([v.sel, inFrame, asked]).toEqual(["0:7", [], ["0:7"]]);
  H.listWindow = null;
});
test("the reader's wheel while a key is held: the repeat after it is a key alone, and the one after that, its ask dropped too, asks in its frame", async () => {
  const { v, cx, sim, asked, late } = await stepped();
  // The wheel and the repeat after it, both before the step's ask 16 ms on.
  sim.wheel(-40);
  v.action("next", cx);
  draw(v, cx);
  const after = [v.sel, asked.splice(0)];
  const own = cx.timers;
  cx.timers = [];
  for (const x of late) x.fn(cx);
  expect(asked).toEqual([]);
  v.action("next", cx);
  draw(v, cx);
  const then = [v.sel, asked.splice(0)];
  for (const x of own) x.fn(cx);
  expect(asked).toEqual([]);
  cx.flush(48);
  expect([after, then, asked]).toEqual([["0:7", []], ["0:8", ["0:8"]], ["0:8"]]);
  H.listWindow = null;
});
test("a step's ask dropped for the list's end, held while rows reshape, is not owed: a step from there asks for its turn 16 ms on, not in its frame", async () => {
  const { v, cx, asked, late } = await stepped();
  Object.defineProperty(v, "shapeLeft", { get: () => 5, set() {}, configurable: true });
  v.jumpLatest(true);
  draw(v, cx);
  expect([v.toBottom, v.sel]).toEqual([true, "0:80"]);
  for (const x of late) x.fn(cx);
  expect(asked).toEqual([]);
  // The end never landed: the rows are laid out, and the step up from it does.
  v.action("prev", cx);
  delete v.shapeLeft;
  v.shapeLeft = 0;
  cx.timers = [];
  draw(v, cx);
  expect([v.sel, v.toBottom, v.scrollTo, asked.splice(0)]).toEqual(["0:79", false, null, []]);
  cx.flush(48);
  expect(asked).toEqual(["0:79"]);
  H.listWindow = null;
});

test("latest's own ask 16 ms after the end is taken is dropped by a newer jump: #20 from there stays on screen", async () => {
  const { v, cx } = await capSession(150, SMALL);
  const sim = simList(v);
  const turns = (f) => shownIn(v, f).filter((k) => /^0:\d+$/.test(k));
  v.jumpLatest(true);
  settleList(v, cx, sim);
  v.action("first", cx);
  settleList(v, cx, sim);
  // Latest from the oldest window, one draw: the end is taken, and its ask 16 ms on waits.
  v.jumpLatest(true);
  draw(v, cx);
  expect(v.toBottom).toBe(false);
  const late = cx.timers;
  cx.timers = [];
  expect(late.length).toBeGreaterThan(0);
  // Before it runs, #20 lands in the oldest window.
  v.command("search:#20", cx);
  v.command("escape", cx);
  settleList(v, cx, sim);
  expect(turns(sim.last())).toContain("0:20");
  const n = endsOf(v);
  for (const x of late) x.fn(cx);
  probeFrame(v, cx);
  expect(n.ends).toBe(0);
  expect(turns(sim.last())).toContain("0:20");
  expect(v.sel).toBe("0:20");
  H.listWindow = null;
});

test("a press's open 300 ms on is dropped by a jump made in the wait: a rail click on #25 in the same window stays on #25", async () => {
  const { v, cx } = await capSession(150, SMALL);
  const sim = simList(v);
  const turns = (f) => shownIn(v, f).filter((k) => /^0:\d+$/.test(k));
  v.action("first", cx);
  settleList(v, cx, sim);
  // A press on closed #10: it opens 300 ms after the release, unless something comes first.
  v.click("0:10", cx);
  const wait = cx.timers.filter((x) => x.ms === 300);
  cx.timers = cx.timers.filter((x) => x.ms !== 300);
  expect(wait.length).toBe(1);
  // In the wait, a rail click on #25, in the same window, so #10 is still in its rows: it lands.
  // It comes down from turn 1, so its two asks (16 and 48 ms on) need the draw between them.
  H.drawBetweenAsks = true;
  try {
    v.railJump("0:25", cx);
    settleList(v, cx, sim);
  } finally { H.drawBetweenAsks = false; }
  expect(turns(sim.last())).toContain("0:25");
  // #10 is still in the window's rows, so only the jump keeps it from opening there.
  expect(v.rows().some((r) => r.key === "0:10")).toBe(true);
  for (const x of wait) x.fn(cx);
  settleList(v, cx, sim);
  expect(v.open.has("0:10")).toBe(false);
  expect(v.sel).toBe("0:25");
  expect(turns(sim.last())).toContain("0:25");
  H.listWindow = null;
});

// ---- the window's memos over a live session: what a change past the window's start reads ----

// The session's rows read by RowWindow.outside and by the day pill (stickyDay), counted, and
// the looks for the window's day (each time stickyDay finds the days of new rows). The base rows are given through one proxy
// per array, so every identity the pane keeps still holds, and only reads made inside those
// two are counted. Set before the memos are made: they hold the rows they were made from.
function memoReads(v) {
  const n = { outside: 0, day: 0 };
  let inside = null;
  const proxies = new WeakMap();
  const counted = (rows) => {
    if (!rows || typeof rows !== "object") return rows;
    if (!proxies.has(rows)) proxies.set(rows, new Proxy(rows, { get(t, k) { if (inside && typeof k === "string" && k >= "0" && k <= "9~") n[inside]++; return t[k]; } }));
    return proxies.get(rows);
  };
  let raw = v.baseRows;
  Object.defineProperty(v, "baseRows", { configurable: true, get: () => counted(raw), set: (x) => { raw = x; } });
  const within = (name, fn) => (...args) => { const was = inside; inside = name; try { return fn(...args); } finally { inside = was; } };
  v.win.outside = within("outside", v.win.outside.bind(v.win));
  const day = within("day", v.stickyDay.bind(v));
  n.looks = 0;
  v.stickyDay = () => { const was = v.dayOfRows; const out = day(); if (v.dayOfRows !== was) n.looks++; return out; };
  return n;
}
// A session of n short turns, the newest still running, on two days: the first 100 turns on
// the first. The day bands come with the second day.
async function runningSession(n, cap) {
  const ev = [];
  for (let i = 0; i < n; i++) {
    const ts = new Date(Date.UTC(2026, 10, i < 100 ? 1 : 2, 9, 0, 0) + i * 1000).toISOString();
    ev.push({ k: "p", o: "human", t: `Prompt ${i}: check order ${i}.`, ts }, { k: "t", t: `Reply ${i}: the order is fine.` });
    if (i < n - 1) ev.push({ k: "d", ts });
  }
  const r = await scripted(ev);
  r.v.debug = false;
  r.v.win.cap = { ...r.v.win.cap, ...cap };
  r.v.width = 560; r.v.rootH = 1100; r.v.listH = 1000;
  return r;
}
// The pill a drawn frame shows with row `key` at the top of the list: the list's own drawing
// names the top (topKey), and the next frame draws the pill for it.
function drawnPill(v, cx, key) {
  const i = v.rows().findIndex((r) => r.key === key);
  expect(i).toBeGreaterThanOrEqual(0);
  H.listWindow = () => ({ start: i, end: i + 6 });
  try { draw(v, cx); draw(v, cx); } finally { H.listWindow = null; }
  expect(v.topKey).toBe(key);
  return v.stickyNow;
}
// The band the window's first turn is under, from the session's rows as they are now.
function bandNow(v) {
  const all = v.allRows();
  const head = v.rows().find((r) => v.baseIndex.has(r.key) && TURN_ROW.has(r.kind));
  return { head, band: all.slice(0, all.indexOf(head)).findLast((r) => r.kind === "day") ?? null };
}

test("a live event in a long session, following: the counts outside the window and the window's day are kept, and no row outside the window is read", async () => {
  const { v, cx, s } = await runningSession(1500, { slide: 600, block: 50, stop: 660 });
  const { apply } = await import("../mods/agent-threads/core/turns.js");
  const n = memoReads(v);
  v.jumpLatest(true);
  frames(v, cx);
  expect(v.win.at.a).toBeGreaterThan(900);
  const { head, band } = bandNow(v);
  expect(band?.kind).toBe("day");
  expect(drawnPill(v, cx, head.key)).toBe(band);
  expectOutsideRight(v);
  const per = [];
  for (let e = 0; e < 4; e++) {
    const rows = v.allRows();
    n.outside = 0;
    n.day = 0;
    n.looks = 0;
    apply(s, { k: "t", t: `More ${e}: the order is still fine.` });
    frames(v, cx);
    // Each event built the newest rows again in a new array, the rows before them kept.
    expect(v.allRows()).not.toBe(rows);
    const now = bandNow(v);
    expect(drawnPill(v, cx, now.head.key)).toBe(now.band);
    per.push({ outside: n.outside, day: n.day, looks: n.looks });
    expectOutsideRight(v);
  }
  // No row outside the window, and for the day only the band's own row, once a look.
  for (const x of per) {
    expect(x.looks).toBeGreaterThan(0);
    expect(x.outside).toBe(0);
    expect(x.day).toBeLessThanOrEqual(x.looks);
  }
});

test("a new turn and live events while the reader sits in an older window: no row after the window is read, and Show later's count follows", async () => {
  const { v, cx, s } = await capSession(150, SMALL);
  const { apply } = await import("../mods/agent-threads/core/turns.js");
  v.jumpLatest(true);
  frames(v, cx);
  v.action("first", cx);
  frames(v, cx);
  // Every row built again with the rail as it is now: the closed rows kept so far were built
  // before the rail showed, which a closed row depends on (closedLook).
  v.rowsKey = null;
  frames(v, cx);
  const n = memoReads(v);
  const was = expectOutsideRight(v);
  expect(was.later).toBeGreaterThan(80);
  const ts = new Date(Date.UTC(2026, 10, 1, 9, 0, 0) + 150 * 1000).toISOString();
  const reads = [];
  // A new turn, still running, then three live events on it.
  for (const e of [{ k: "p", o: "human", t: "Prompt 150: check order 150.", ts }, { k: "t", t: "Reply 150: looking." }, { k: "t", t: "Reply 150: still looking." }, { k: "t", t: "Reply 150: the order is fine." }]) {
    n.outside = 0;
    apply(s, e);
    frames(v, cx);
    reads.push(n.outside);
    expect(v.win.at.a).toBe(0);
  }
  expect(expectOutsideRight(v)).toEqual({ earlier: 0, later: was.later + 1 });
  expect(reads).toEqual([0, 0, 0, 0]);
});

test("a card opened and closed above the window, and one inside it, keep the counts and the window's day right, each read only the card's rows", async () => {
  // Three days of 50 turns each, the window starting partway through the second.
  const { v, cx } = await capSession(150, SMALL, -1, 25, (i) => Math.floor(i / 50));
  // No clock: every row is reshaped in the draw that needs it (shapeMax), so no reshape left
  // over falls back to a build of every row between a change and the look after it.
  v.shapeBudget = Infinity;
  const n = memoReads(v);
  // The look carries the band over the rows' changes since the last one found (bandAbove,
  // rowsSince): counted when the rows changed since and the changes were known. Without it
  // the look walks, and this test would not test the carried place at all.
  const bandAbove = v.bandAbove;
  let carried = 0;
  v.bandAbove = function (base, at) {
    const m = this.dayAbove;
    if (m && (m.base !== this.baseRows || m.ver !== (this.baseVer ?? 0)) && this.rowsSince(m.base, m.ver)) carried++;
    return bandAbove.call(this, base, at);
  };
  v.jumpLatest(true);
  frames(v, cx);
  for (let k = 0; k < 14 && bandNow(v).band && v.rows().some((r) => r.kind === "day" && v.rows().indexOf(r) < v.rows().indexOf(bandNow(v).head)); k++) { v.showMore(false); frames(v, cx); }
  const first = bandNow(v);
  expect(v.rows().includes(first.band)).toBe(false);
  expect(first.band.key).not.toBe(v.allRows().find((r) => r.kind === "day").key);
  expect(drawnPill(v, cx, first.head.key)).toBe(first.band);
  const was = expectOutsideRight(v);
  const step = (fn) => {
    n.looks = 0;
    n.outside = 0;
    n.day = 0;
    carried = 0;
    const at = v.win.at.a;
    fn();
    frames(v, cx);
    const now = bandNow(v);
    expect(drawnPill(v, cx, now.head.key)).toBe(now.band);
    expect(now.band.key).toBe(first.band.key);
    expect(expectOutsideRight(v)).toEqual(was);
    return { moved: v.win.at.a - at, outside: n.outside, day: n.day, looks: n.looks, carried };
  };
  // Above the window, on the first day: every row of the window, and its day band, moves on.
  const above = step(() => v.open.add("0:5"));
  expect(above.moved).toBeGreaterThan(0);
  const back = step(() => v.open.delete("0:5"));
  expect(back.moved).toBe(-above.moved);
  // Inside the window: the rows after the card move on, the window's start does not.
  const inside = step(() => v.open.add(v.turnKeys(v.rows())[3]));
  expect(inside.moved).toBe(0);
  for (const x of [above, back, inside]) {
    expect(x.looks).toBeGreaterThan(0);
    expect(x.carried).toBeGreaterThan(0);
    expect(x.outside).toBe(0);
    // The band's own row, once a look: no walk.
    expect(x.day).toBeLessThanOrEqual(x.looks);
  }
});

test("a build that adds more rows than it keeps is not noted: past an older window's end, the turns are counted afresh, and right; with one turn more it is, and none is read", async () => {
  const { v, cx, s } = await capSession(100, SMALL);
  // No clock: every row is shaped in the draw that needs it (shapeMax).
  v.shapeBudget = Infinity;
  v.jumpLatest(true);
  frames(v, cx);
  v.action("first", cx);
  frames(v, cx);
  // Every row built again with the rail as it is now (closedLook), as in "a new turn and live
  // events while the reader sits in an older window".
  v.rowsKey = null;
  frames(v, cx);
  const n = memoReads(v);
  expectOutsideRight(v);
  const add = async (from, count) => {
    const before = expectOutsideRight(v);
    const was = v.allRows();
    const ver = v.baseVer ?? 0;
    const z = v.win.at.z;
    n.outside = 0;
    await addCapTurns(s, from, count);
    frames(v, cx);
    const reads = n.outside;
    const now = v.allRows();
    let K = 0;
    while (K < was.length && K < now.length && now[K] === was[K]) K++;
    const changed = now.length + was.length - 2 * K;
    // The window stays, its end is among the rows kept (so a note would carry its count), and
    // no splice has changed the rows' version.
    expect([v.win.at.a, v.win.at.z, v.baseVer ?? 0, K >= z]).toEqual([0, z, ver, true]);
    expect(expectOutsideRight(v)).toEqual({ earlier: 0, later: before.later + count });
    return { more: changed > K, known: v.rowsSince(was, ver) !== null, reads, past: now.length - z };
  };
  const one = await add(100, 1);
  expect([one.more, one.known, one.reads]).toEqual([false, true, 0]);
  // 300 turns at once, as when more of a session is read than the pane has: the rows changed
  // are more than those kept, so the change is not known, and every row past the window is read.
  const many = await add(101, 300);
  expect([many.more, many.known, many.reads >= many.past]).toEqual([true, false, true]);
});

// Rows of made-up kinds over a fixed seed, with day bands, turns and a turn's other rows.
function madeRows(rnd, n, tag) {
  const kinds = ["day", "turn", "turn", "turn", "md", "head", "md", "wake"];
  return Array.from({ length: n }, (_, i) => ({ kind: kinds[Math.floor(rnd() * kinds.length)], key: `${tag}:${i}` }));
}
// One change to rows as a build or a splice makes it: the rows before K kept (a band among
// them may be a new row in its place), gone rows from K replaced by added new ones.
function madeChange(rnd, rows, tag) {
  const K = Math.floor(rnd() * (rows.length + 1));
  const whole = rnd() < 0.3;
  const gone = whole ? rows.length - K : Math.floor(rnd() * Math.min(12, rows.length - K + 1));
  const fresh = madeRows(rnd, Math.floor(rnd() * 14), tag);
  const kept = rows.slice(0, K).map((r) => (r.kind === "day" && rnd() < 0.5 ? { ...r } : r));
  const next = [...kept, ...fresh, ...rows.slice(K + gone)];
  const dT = fresh.filter((r) => TURN_ROW.has(r.kind)).length - rows.slice(K, K + gone).filter((r) => TURN_ROW.has(r.kind)).length;
  return { next, K, end: K + fresh.length, d: fresh.length - gone, dT };
}

test("the window's memos carried over one to three changes of the rows give what a fresh count gives: a seeded run over made-up rows", async () => {
  const { v } = await capSession(3);
  const rnd = seeded(116);
  const lastBand = (rows, at) => { for (let i = at; i >= 0; i--) if (rows[i].kind === "day") return i; return -1; };
  const turns = (rows, a, z) => rows.slice(a, z).filter((r) => TURN_ROW.has(r.kind)).length;
  const bad = [];
  const carried = { above: 0, below: 0 };
  for (let k = 0; k < 400; k++) {
    const first = madeRows(rnd, 20 + Math.floor(rnd() * 60), `r${k}`);
    // A chain of changes, as the pane notes them (noteRows), every array its own.
    const log = [];
    let rows = first;
    for (let j = 0, m = 1 + Math.floor(rnd() * 3); j < m; j++) {
      const c = madeChange(rnd, rows, `r${k}c${j}`);
      log.push({ r0: rows, v0: 0, r1: c.next, v1: 0, K: c.K, end: c.end, d: c.d, dT: c.dT });
      rows = c.next;
    }
    // The pane looks for a band only above a row it holds.
    if (!rows.length) continue;
    v.baseRows = rows;
    v.baseVer = 0;
    v.rowsLog = log;
    const pick = (n) => Math.floor(rnd() * (n + 1));
    // The window's day: the last band at or above a row, carried from the one found before.
    const was = Math.max(0, pick(first.length - 1));
    const at = Math.max(0, pick(rows.length - 1));
    v.dayAbove = { base: first, ver: 0, at: was, idx: lastBand(first, was) };
    const got = v.bandAbove(rows, at);
    if (got !== lastBand(rows, at)) bad.push(`day ${k}: ${got} for ${lastBand(rows, at)}`);
    // The counts outside a window, carried from those of another window over the first rows.
    const w = new RowWindow(SMALL);
    const a0 = pick(first.length);
    const z0 = a0 + pick(first.length - a0);
    w.at = { a: a0, z: z0 };
    w.outside({ rows: first, ver: 0, since: (r, ver) => v.rowsSince(r, ver) });
    const a = pick(rows.length);
    const z = a + pick(rows.length - a);
    w.at = { a, z };
    // The counts the carry itself gave, not the edges it could have: null is a count afresh.
    const carry = w.carry;
    w.carry = (...args) => { const got = carry.apply(w, args); if (got != null) carried[args.at(-1) > 0 ? "above" : "below"]++; return got; };
    const out = w.outside({ rows, ver: 0, since: (r, ver) => v.rowsSince(r, ver) });
    const want = { earlier: turns(rows, 0, a), later: turns(rows, z, rows.length) };
    if (out.earlier !== want.earlier || out.later !== want.later) bad.push(`count ${k}: ${JSON.stringify(out)} for ${JSON.stringify(want)}`);
  }
  expect(bad).toEqual([]);
  // Edges of both kinds were carried, not counted afresh.
  expect(Math.min(carried.above, carried.below)).toBeGreaterThan(25);
});

// ---- the routes the window's tests had not tried: a resize, a filter, search steps, a new session ----

// The rows of every frame in frames, from the list's own drawing.
const framesShow = (v, frames, key) => frames.filter((f) => !shownIn(v, f).includes(key)).length;

test("in an older window under a small cap and window, a resize keeps the selected turn on screen in every frame, and the window where it was", async () => {
  const { v, cx } = await capSession(150, { ...SMALL, max: 40 });
  const sim = simList(v);
  try {
    openAt(v, cx, sim, 562);
    v.action("first", cx);
    settleList(v, cx, sim);
    v.command("search:#12", cx);
    v.command("escape", cx);
    settleList(v, cx, sim);
    expect(shownIn(v, sim.last())).toContain("0:12");
    // The list is cut (40 items) inside a window that leaves the newest turns out.
    expect(v.capCut).toBeGreaterThan(0);
    expect(v.win.at.z).toBeLessThan(v.allRows().length);
    const ends = { from: v.win.from, to: v.win.to };
    for (const w of [420, 760, 562]) {
      stillAt(v, w);
      const fs = settleList(v, cx, sim);
      expect(fs.length).toBeGreaterThan(0);
      expect(framesShow(v, fs, "0:12")).toBe(0);
      expect({ from: v.win.from, to: v.win.to }).toEqual(ends);
      expect(v.sel).toBe("0:12");
    }
  } finally {
    H.listWindow = null;
  }
});

test("a filter typed in an older window: each letter keeps the selected match in the window's rows and the counts right, and a filter that leaves it out goes to the newest match, on screen", async () => {
  // 300 turns: "order 1" matches 111 of them (1, 10 to 19, 100 to 199), more than the window.
  const { v, cx } = await capSession(300, SMALL);
  const sim = simList(v);
  try {
    openAt(v, cx, sim, 562);
    v.action("first", cx);
    settleList(v, cx, sim);
    v.command("search:#13", cx);
    v.command("escape", cx);
    settleList(v, cx, sim);
    expect(v.sel).toBe("0:13");
    // Typed a letter at a time: "Prompt 12: check order 12." matches each of them. A filter
    // that keeps the selected turn asks for no scroll (setQuery), with or without a window:
    // the list keeps its offset in px over the fewer rows, so the turn is in the window's rows
    // but need not be on screen.
    for (const q of ["o", "or", "order", "order ", "order 1"]) {
      v.command(`search:${q}`, cx);
      settleList(v, cx, sim);
      expect(v.sel).toBe("0:13");
      expect(inList(v, "0:13")).toBe(true);
      expectOutsideRight(v);
    }
    // The matches are more than the window holds, so the filtered rows are windowed too.
    expect(v.win.at.z - v.win.at.a).toBeLessThan(v.allRows().length);
    // One more letter that leaves #13 out: the newest match, #200.
    v.command("search:order 19", cx);
    settleList(v, cx, sim);
    expect(v.sel).toBe("0:200");
    expect(shownIn(v, sim.last())).toContain("0:200");
    // Cleared: every turn again, #200 still selected and the counts right. Like a letter that
    // keeps the selection, clearing asks for no scroll; the window, which a filter of 11
    // matches dropped, goes around #200 again.
    v.command("search:", cx);
    settleList(v, cx, sim);
    expect(v.sel).toBe("0:200");
    expectOutsideRight(v);
  } finally {
    H.listWindow = null;
  }
});

test("search steps through more matches than the window holds: each step past the window's edge moves it, and the step's turn or control is on screen in every frame", async () => {
  const { v, cx } = await capSession(300, SMALL);
  const sim = simList(v);
  try {
    openAt(v, cx, sim, 562);
    v.command("search:order 1", cx);
    settleList(v, cx, sim);
    expect(v.sel).toBe("0:200");
    const starts = new Set([v.win.at.a]);
    const seen = new Set();
    const bad = [];
    for (let k = 0; k < 130 && v.sel !== "0:2"; k++) {
      v.action("prev", cx);
      const fs = settleList(v, cx, sim);
      seen.add(v.sel);
      starts.add(v.win.at.a);
      const miss = framesShow(v, fs, v.sel);
      if (miss) bad.push(`${k} ${v.sel}: ${miss} of ${fs.length} frames`);
    }
    expect(bad).toEqual([]);
    // Every match from the newest to the oldest, through Show earlier, and the window moved.
    expect(v.sel).toBe("0:2");
    expect(seen.has("older")).toBe(true);
    expect(starts.size).toBeGreaterThan(1);
    expect([...seen].filter((k) => /^0:\d+$/.test(k)).length).toBe(110);
  } finally {
    H.listWindow = null;
  }
});

test("a new session picked from an older window opens at its own end: its rows, the window at its end, the counts its own", async () => {
  const { v, cx } = await capSession(150, SMALL);
  const sim = simList(v);
  try {
    openAt(v, cx, sim, 562);
    v.action("first", cx);
    settleList(v, cx, sim);
    expect(v.win.at.a).toBe(0);
    v.pick({ path: fixture("--only", "200") }, cx);
    await settle(v);
    const fs = settleList(v, cx, sim);
    const s = v.current();
    expect(s.turns.length).toBe(200);
    // Every turn row drawn is the new session's.
    expect(v.rows().filter((r) => TURN_ROW.has(r.kind)).every((r) => r.s === s)).toBe(true);
    // At its end, following, the window at its end.
    expect(v.follow).toBe(true);
    expect(sim.last().end).toBe(true);
    expect(v.win.at.z).toBe(v.allRows().length);
    expect(fs.at(-1).keys.at(-1)).toBe(v.rows().at(-1).key);
    expectOutsideRight(v);
  } finally {
    H.listWindow = null;
  }
});

test("a rail landing's lift 48 ms on, and its end 120 ms on, are dropped by a newer jump: neither moves the newer landing", async () => {
  // A rail jump lands with a lift (room over the first row, for the turn's top to sit level
  // with its tick), set 48 ms on and taken off 120 ms on.
  const { v, cx, sim } = await cutScene();
  v.probeDue = () => [];
  v.railJump("0:65", cx);
  for (let k = 0; k < 4 && v.scrollTo; k++) draw(v, cx);
  expect(v.scrollTo).toBe(null);
  expect(v.landed.lift).toBeGreaterThan(0);
  const late = cx.timers;
  cx.timers = [];
  delete v.probeDue;
  // Before they run, #20 lands, with no lift of its own.
  v.command("search:#20", cx);
  v.command("escape", cx);
  settleList(v, cx, sim);
  expect(shownIn(v, sim.last())).toContain("0:20");
  expect(v.landLift ?? 0).toBe(0);
  const at = Math.round(sim.off);
  // The first landing's 16 and 48 ms timers: no lift comes back.
  for (const x of late.filter((x) => x.ms <= 48)) x.fn(cx);
  expect(v.landLift ?? 0).toBe(0);
  expect(offs(v, cx, sim, 3)).toEqual([at, at, at]);
  H.listWindow = null;
  // And a newer rail landing with a lift of its own keeps it past the first one's 120 ms end.
  const two = await cutScene();
  two.v.probeDue = () => [];
  two.v.railJump("0:65", two.cx);
  for (let k = 0; k < 4 && two.v.scrollTo; k++) draw(two.v, two.cx);
  const ends = two.cx.timers.filter((x) => x.ms === 120);
  expect(ends.length).toBe(1);
  two.cx.timers = [];
  two.v.railJump("0:66", two.cx);
  for (let k = 0; k < 4 && two.v.scrollTo; k++) draw(two.v, two.cx);
  const lift = two.v.landed.lift;
  expect(lift).toBeGreaterThan(0);
  for (const x of two.cx.timers.filter((x) => x.ms <= 48)) x.fn(two.cx);
  two.cx.timers = two.cx.timers.filter((x) => x.ms > 48);
  expect(two.v.landLift).toBe(lift);
  for (const x of ends) x.fn(two.cx);
  expect(two.v.landLift).toBe(lift);
  H.listWindow = null;
});

// Latest pressed once a landing is taken, before the next frame is drawn: nothing newer has
// landed and no wheel has come, so only latest itself (toBottom) ends the landing's asks 16 and
// 48 ms on, and a rail landing's lift. Pressed before the first of them and between the two, each
// against the same landing left alone. One jump was held past the cut, so it has only its second
// ask, with a lift; one in a list with no window and no cut has both.
test("latest pressed after a landing is taken and before the next frame ends the landing's asks 16 and 48 ms on and its lift, and the end shows", async () => {
  const scenes = {
    cut: async () => ({ ...(await cutScene()), key: "0:65" }),
    plain: async () => {
      const r = await capSession(80);
      const sim = simList(r.v);
      r.v.action("first", r.cx);
      settleList(r.v, r.cx, sim);
      return { ...r, sim, key: "0:35" };
    },
  };
  for (const scene of ["cut", "plain"]) for (const gone of [0, 16]) for (const press of [false, true]) {
    const at = `${scene}, ${gone} ms gone, ${press ? "latest" : "left alone"}`;
    const { v, cx, sim, key } = await scenes[scene]();
    v.probeDue = () => [];
    cx.timers = [];
    v.railJump(key, cx);
    const asked = scrollsOf(v);
    for (let k = 0; k < 4 && v.scrollTo; k++) draw(v, cx);
    expect([at, v.scrollTo]).toEqual([at, null]);
    const run = (ms) => { const due = cx.timers.filter((x) => x.ms <= ms); cx.timers = cx.timers.filter((x) => x.ms > ms); for (const x of due) x.fn(cx); };
    const marks = () => [v.landN, v.wheelN ?? 0, v.scrollTo];
    if (gone) run(gone);
    const n = asked.length;
    const then = marks();
    if (press) v.action("latest", cx);
    expect([at, Boolean(v.toBottom), marks()]).toEqual([at, press, then]);
    run(48);
    const lift = v.landLift ?? 0;
    if (press) expect([at, asked.slice(n), lift]).toEqual([at, [], 0]);
    else {
      expect([at, asked.length > n]).toEqual([at, true]);
      if (scene === "cut") expect([at, lift > 0, lift]).toEqual([at, true, v.landed.lift]);
    }
    delete v.probeDue;
    if (press) {
      settleList(v, cx, sim);
      expect([at, v.follow, sim.last().end, v.landLift ?? 0]).toEqual([at, true, true, 0]);
    }
    H.listWindow = null;
  }
}, 60000);

// A rail landing Herdr stops as it asks for its lift's end, 120 ms on: its 48 ms timer still sets
// the lift, before the next draw (a late frame, or the watch, CUT_WATCH_MS) takes the jump on
// again and lands a second time, asking for both timers. A wheel, a jump with no lift of its own
// or a rail jump with one comes before the second landing's 48 ms. The first landing's lift comes
// off by the end its own 48 ms callback asked for, 72 ms on, or by the second landing's end, and a
// newer landing's own stays. A round's timers run in the order they were asked for, or the order
// they fall due. Returns what the lift was after each of the lift's timers a render asked for.
async function stoppedLift(move, order) {
  const STOP = new Error("stopped by Herdr");
  const { v, cx, sim } = await cutScene();
  v.probeDue = () => [];
  cx.timers = [];
  const isLift = (x) => x.ms !== 72 && String(x.fn).includes("landLift");
  const lifts = () => cx.timers.filter(isLift).map((x) => x.ms);
  const name = new Map();
  const said = [];
  const round = (who) => {
    for (const x of cx.timers) if (isLift(x) && !name.has(x)) name.set(x, `${who} ${x.ms}`);
    const due = cx.timers.filter((x) => x.ms <= 120);
    cx.timers = cx.timers.filter((x) => x.ms > 120);
    for (const x of order === "asked" ? due : [...due].sort((p, q) => p.ms - q.ms)) { x.fn(cx); if (name.has(x)) said.push([name.get(x), v.landLift ?? 0]); }
  };
  let stops = 0;
  const step = () => { try { draw(v, cx); } catch (e) { if (e !== STOP) throw e; stops++; v.renderOpen = true; } };
  const drawTill = (fn) => { for (let k = 0; k < 8 && !fn(); k++) step(); expect(fn()).toBe(true); };
  let armed = true;
  const bodyNow = v.bodyNow;
  v.bodyNow = function (...a) {
    const after = cx.timer.after;
    cx.timer.after = function (ms, fn) {
      if (armed && this === cx.timer && ms === 120 && isLift({ ms, fn })) { armed = false; throw STOP; }
      return after.call(this, ms, fn);
    };
    try { return bodyNow.apply(this, a); } finally { cx.timer.after = after; }
  };
  v.railJump("0:65", cx);
  drawTill(() => stops > 0);
  const one = v.landed.lift;
  expect([one > 0, lifts()]).toEqual([true, [48]]);
  round("first");
  expect(v.landLift).toBe(one);
  // The next draw (a late frame, or the watch).
  drawTill(() => lifts().length === 2);
  expect([v.landed.lift, lifts()]).toEqual([one, [48, 120]]);
  for (const x of cx.timers) if (isLift(x)) name.set(x, `second ${x.ms}`);
  const landN = v.landN;
  let own = null;
  if (move === "wheel") sim.wheel(-60);
  else if (move) {
    if (move === "jump") v.action("prev", cx);
    else v.railJump("0:66", cx);
    expect(v.scrollTo).not.toBe(null);
    drawTill(() => v.scrollTo == null);
    expect(v.landN).toBe(landN + 1);
    if (move === "lifted") { own = v.landed.lift; expect(own).toBeGreaterThan(0); }
    expect(lifts()).toEqual(move === "lifted" ? [48, 120, 48, 120] : [48, 120]);
  }
  round("newer");
  for (let k = 0; k < 3; k++) { step(); round("late"); }
  delete v.bodyNow;
  const end = { stops, lift: v.landLift ?? 0, tall: v.slotsMemo[0] - Math.ceil(v.sizesMemo[0]) };
  H.listWindow = null;
  return { one, own, said, end };
}
for (const order of ["asked", "due"]) {
  test(`a landing with a lift that Herdr stops as it asks for the lift's end, and a wheel or a newer jump before the next landing sets its own: the lift comes off, a newer landing keeps its own, the timers run in the order ${order === "asked" ? "they were asked for" : "they fall due"}`, async () => {
    const off = { stops: 1, lift: 0, tall: 0 };
    for (const move of [null, "wheel", "jump"]) {
      const { one, said, end } = await stoppedLift(move, order);
      expect([move, said, end]).toEqual([move, [["first 48", one], ["second 48", order === "asked" && move ? 0 : one], ["second 120", 0]], off]);
    }
    const { one, own, said, end } = await stoppedLift("lifted", order);
    expect([said, end]).toEqual([[["first 48", one], ["second 48", order === "asked" ? 0 : one], ...(order === "asked"
      ? [["second 120", 0], ["newer 48", own], ["newer 120", 0]]
      : [["newer 48", own], ["second 120", own], ["newer 120", 0]])], off]);
  }, 60000);
}

// A rail landing on #65, past the cut, its lift's timers asked for: 48 ms on to put it on, 120 to
// take it off, and 72 more from the first one's own callback. Or stopped by Herdr as it asks for
// the 120, the render left open and nothing caught but the stop out of the draw. run takes the
// timers due by ms, in the order they were asked for, or turned round.
const ofLift = (x) => String(x.fn).includes("landLift");
async function liftScene({ stop = false } = {}) {
  const STOP = new Error("stopped by Herdr");
  const r = await cutScene();
  const { v, cx } = r;
  v.probeDue = () => [];
  cx.timers = [];
  let armed = stop;
  const after = cx.timer.after;
  cx.timer.after = function (ms, fn) {
    if (armed && ms === 120 && ofLift({ fn })) { armed = false; throw STOP; }
    return after.call(this, ms, fn);
  };
  let stops = 0;
  const step = () => { try { draw(v, cx); } catch (e) { if (e !== STOP) throw e; stops++; v.renderOpen = true; } };
  const run = (ms, turned = false) => {
    const due = cx.timers.filter((x) => x.ms <= ms);
    cx.timers = cx.timers.filter((x) => x.ms > ms);
    for (const x of turned ? due.reverse() : due) x.fn(cx);
  };
  // The lift's timers out of the queue, in the order they were asked for.
  const take = () => { const out = cx.timers.filter(ofLift); cx.timers = cx.timers.filter((x) => !ofLift(x)); return out; };
  const asked = scrollsOf(v);
  v.railJump("0:65", cx);
  for (let k = 0; k < 8 && !stops && v.scrollTo; k++) step();
  const one = v.landed.lift;
  expect([stops, one > 0, v.landLift ?? 0, cx.timers.filter(ofLift).map((x) => x.ms)]).toEqual([stop ? 1 : 0, true, 0, stop ? [48] : [48, 120]]);
  return { ...r, one, asked, step, run, take };
}
// What is left of a lift, on its own and in the first item's height.
const liftLeft = (v) => ({ lift: v.landLift ?? 0, tall: v.slotsMemo[0] - Math.ceil(v.sizesMemo[0]) });
// The frames and the timers after it, until nothing of the landing is left.
function runOut({ v, step, run }) {
  for (let k = 0; k < 4; k++) { step(); run(120); }
  step();
  H.listWindow = null;
  return liftLeft(v);
}
// A newer rail landing, on #66, with a lift of its own.
function landNewer({ v, cx, step }) {
  const n = v.landN;
  v.railJump("0:66", cx);
  for (let k = 0; k < 8 && v.scrollTo; k++) step();
  expect([v.landN, v.landed.lift > 0]).toEqual([n + 1, true]);
  return v.landed.lift;
}

// A wheel, or a jump with no lift of its own, after the 48 ms timer and before the stopped draw is
// drawn again: nothing lands a second time, so the 120 is never asked for again.
for (const [what, move] of [["a wheel", ({ sim }) => { sim.wheel(-60); }], ["a step up", ({ v, cx }) => { v.action("prev", cx); }]]) {
  test(`a landing with a lift that Herdr stops as it asks for the lift's end, and ${what} after the lift is put on and before the next draw: no lift is left`, async () => {
    const r = await liftScene({ stop: true });
    r.run(48);
    expect(r.v.landLift).toBe(r.one);
    move(r);
    expect(runOut(r)).toEqual({ lift: 0, tall: 0 });
  }, 30000);
}

// Both timers late, so both due at once, and delivered either way round. As asked for, the lift
// goes on and off before a frame is drawn. The other way round it shows for the frame drawn, until
// the end its own callback asked for.
test("a landing with a lift whose two timers run late, as they were asked for: no lift is left, and its place is asked for", async () => {
  const r = await liftScene();
  const place = r.v.rowsMemo[r.v.landed.j].key;
  const n = r.asked.length;
  r.run(120);
  expect([r.asked.slice(n).includes(place), r.v.landLift ?? 0]).toEqual([true, 0]);
  expect(runOut(r)).toEqual({ lift: 0, tall: 0 });
}, 30000);
test("a landing with a lift whose two timers run late, the end first: the lift shows for a frame and none is left, and its place is asked for", async () => {
  const r = await liftScene();
  const place = r.v.rowsMemo[r.v.landed.j].key;
  const n = r.asked.length;
  r.run(120, true);
  expect(r.asked.slice(n)).toContain(place);
  r.step();
  expect(liftLeft(r.v)).toEqual({ lift: r.one, tall: Math.ceil(r.one) });
  expect(runOut(r)).toEqual({ lift: 0, tall: 0 });
}, 30000);

test("a landing with a lift that Herdr stops as it asks for the lift's end, a wheel, and a newer landing that has put its own lift on: the newer lift stays until its own end", async () => {
  const r = await liftScene({ stop: true });
  const { v, cx, sim, run, take } = r;
  run(48);
  expect(v.landLift).toBe(r.one);
  sim.wheel(-60);
  const old = take();
  const own = landNewer(r);
  run(48);
  expect(v.landLift).toBe(own);
  for (const x of old) x.fn(cx);
  expect(v.landLift).toBe(own);
  run(120);
  expect(v.landLift).toBe(0);
  expect(runOut(r)).toEqual({ lift: 0, tall: 0 });
}, 30000);
for (const turned of [false, true]) {
  test(`a landing with a lift whose two timers run late, ${turned ? "the end first" : "as they were asked for"}, after a newer landing has put its own lift on: the newer lift stays until its own end`, async () => {
    const r = await liftScene();
    const { v, cx, run, take } = r;
    const old = take();
    const own = landNewer(r);
    run(48);
    expect(v.landLift).toBe(own);
    for (const x of turned ? old.reverse() : old) { x.fn(cx); expect(v.landLift).toBe(own); }
    run(120);
    expect(v.landLift).toBe(0);
    expect(runOut(r)).toEqual({ lift: 0, tall: 0 });
  }, 30000);
}

// The frames a landing's lift timers ask for, one drawn after each timer that asks: the 48, then
// its own end and the render's, both due 120 ms on, so in a tie either can come first.
async function liftFrames(nestedFirst) {
  const r = await liftScene();
  const { v, cx, step, take } = r;
  let notes = 0;
  cx.notifyHook = () => { notes++; };
  const [on, end] = take();
  let frames = 0;
  const one = (x) => { const n = notes; x.fn(cx); if (notes > n) { frames++; step(); } };
  one(on);
  expect(v.landLift).toBe(r.one);
  const own = take();
  for (const x of nestedFirst ? [...own, end] : [end, ...own]) one(x);
  cx.notifyHook = null;
  expect(runOut(r)).toEqual({ lift: 0, tall: 0 });
  return frames;
}
test("a landing with a lift draws two frames for it, one as it is put on and one as it comes off: the end its own callback asked for, run after the render's, asks for none", async () => {
  expect(await liftFrames(false)).toBe(2);
}, 30000);
test("a landing with a lift, the end its own callback asked for run before the render's and a frame drawn between: three frames, one more than without it", async () => {
  expect(await liftFrames(true)).toBe(3);
}, 30000);

// Herdr stops the draw between its two asks, and then the lift's own callback as it asks for its end:
// that comes before the lift is put on, so no lift is on with no end to come. The wheel keeps the next
// draw from landing again.
test("a landing with a lift that Herdr stops as it asks for the lift's end, and its 48 ms callback as that asks for its own: the lift is not put on, and none is left", async () => {
  const STOP = new Error("stopped by Herdr");
  const r = await liftScene({ stop: true });
  const { v, cx, sim, run } = r;
  const after = cx.timer.after;
  let armed = true;
  cx.timer.after = function (ms, fn) {
    if (armed && ms === 72 && ofLift({ fn })) { armed = false; throw STOP; }
    return after.call(this, ms, fn);
  };
  expect(() => run(48)).toThrow(STOP);
  expect([armed, v.landLift ?? 0]).toEqual([false, 0]);
  sim.wheel(-60);
  expect(runOut(r)).toEqual({ lift: 0, tall: 0 });
}, 30000);

// An older landing's lift with no end to come, made by hand: both its ends are dropped. No stop as
// either is asked for leaves one, since the callback asks for its end before it puts the lift on (the
// test above). The next landing's end takes it off, though a wheel kept that landing's own lift from
// being put on.
test("a landing's end takes off a lift an older landing left with no end of its own, its ends dropped by hand", async () => {
  const r = await liftScene();
  const { v, sim, one, run, take } = r;
  run(48);
  expect(v.landLift).toBe(one);
  take();
  landNewer(r);
  sim.wheel(-60);
  run(48);
  expect(v.landLift).toBe(one);
  run(120);
  expect(v.landLift).toBe(0);
  expect(runOut(r)).toEqual({ lift: 0, tall: 0 });
}, 30000);

test("a press's open 300 ms on is dropped by a jump from outside the list made in the wait: a pin's return to #30, or #30 picked in the Trajectory, stays on #30", async () => {
  noPins();
  const routes = {
    // A press on a pin, which is no press on the list.
    pin: (v, cx) => { v.pinnedList = () => [{ key: "0:30", turn: v.findTurn("0:30"), pin: { n: 30 }, s: v.current(), state: "done" }]; v.goPin(0, cx); },
    // The turn picked in the Trajectory pane open beside the list (trajPaneOpen, here by hand),
    // as that pane writes it for the terminal.
    trajectory: (v) => {
      v.terminal = "t-traj";
      v.trajPaneOpen = () => true;
      state.shared["threads.turnSel"] = { "t-traj": { key: "0:30", by: "other", at: Date.now() + 1000, pane: "trajectory" } };
      expect(v.syncSel()).toBe(true);
    },
  };
  for (const [name, go] of Object.entries(routes)) {
    const { v, cx } = await capSession(150, SMALL);
    const sim = simList(v);
    const turns = (f) => shownIn(v, f).filter((k) => /^0:\d+$/.test(k));
    v.action("first", cx);
    settleList(v, cx, sim);
    v.click("0:10", cx);
    const wait = cx.timers.filter((x) => x.ms === 300);
    cx.timers = cx.timers.filter((x) => x.ms !== 300);
    expect(wait.length).toBe(1);
    // In the wait, #30, in the same window, so #10 is still in its rows. A pin's return comes
    // down from turn 1, so its two asks (16 and 48 ms on) need the draw between them.
    H.drawBetweenAsks = true;
    try {
      go(v, cx);
      settleList(v, cx, sim);
    } finally { H.drawBetweenAsks = false; }
    expect(turns(sim.last())).toContain("0:30");
    expect(v.rows().some((r) => r.key === "0:10")).toBe(true);
    for (const x of wait) x.fn(cx);
    settleList(v, cx, sim);
    expect([name, v.open.has("0:10"), v.sel]).toEqual([name, false, "0:30"]);
    expect(turns(sim.last())).toContain("0:30");
    H.listWindow = null;
    delete state.shared["threads.turnSel"];
  }
});

test("a press's open 300 ms on is dropped by a press on the cut's note made in the wait, though the cut that comes still holds the pressed turn", async () => {
  // 100 closed turns past a cap of 60 items, the reader at #20: the list holds its start over
  // the note. Under 118 items the cut a press on the note brings (the newest 59) overlaps it.
  const { v, cx } = await capSession(100, { max: 60 });
  const sim = simList(v);
  try {
    openAt(v, cx, sim, 562);
    v.command("search:#20", cx);
    v.command("escape", cx);
    settleList(v, cx, sim);
    const note = v.rows().at(-1);
    expect(note.key).toBe("capped-later");
    // The closed turn just above the note, then the note.
    const pressed = v.rows().at(-2);
    expect([pressed.kind, v.open.has(pressed.key)]).toEqual(["turn", false]);
    v.click(pressed.key, cx);
    const wait = cx.timers.filter((x) => x.ms === 300);
    cx.timers = cx.timers.filter((x) => x.ms !== 300);
    expect(wait.length).toBe(1);
    v.click("capped-later", cx);
    settleList(v, cx, sim);
    expect(v.rows().some((r) => r.key === "capped")).toBe(true);
    expect(shownIn(v, sim.last())).toContain(note.go);
    // The pressed turn is still on the list, so only the press on the note keeps it closed.
    expect(v.rows().some((r) => r.key === pressed.key)).toBe(true);
    for (const x of wait) x.fn(cx);
    settleList(v, cx, sim);
    expect({ open: v.open.has(pressed.key), shows: shownIn(v, sim.last()).includes(note.go) }).toEqual({ open: false, shows: true });
  } finally {
    H.listWindow = null;
  }
});

// ---- a jump while the scroll to the bottom is still asked for (toBottom) ----

// The draw takes a pending scroll to the bottom before a jump's, and drops the jump's. So a key
// that goes to a turn other than the newest drops the pending one. Two ways it can be pending
// with the turn not drawn yet: the window slid inside the key itself (its rows grew since the
// last draw), and a read that grew the running reply while following.
test("Home pressed after the window slides and before the draw lands on turn 1", async () => {
  const { v, cx, s } = await capSession(150, SMALL);
  const sim = simList(v);
  try {
    openAt(v, cx, sim, 562);
    expect([v.follow, v.toBottom, shownIn(v, sim.last()).includes("0:1")]).toEqual([true, false, false]);
    // Thirty turns come in, and Home is pressed before they are drawn: the key's own rows() is
    // the first to slide the window. Its build runs whole (the clock is held), as in one slice.
    await addCapTurns(s, 150, 30);
    const slid = [];
    const place = v.win.place.bind(v.win);
    v.win.place = (...args) => { const at = place(...args); slid.push(Boolean(at.slid)); return at; };
    try { heldClock(() => v.action("first", cx)); } finally { delete v.win.place; }
    expect(slid).toContain(true);
    expect([v.sel, v.follow]).toEqual(["0:1", false]);
    settleList(v, cx, sim);
    expect({ shows: shownIn(v, sim.last()).includes("0:1"), toBottom: v.toBottom, sel: v.sel, follow: v.follow }).toEqual({ shows: true, toBottom: false, sel: "0:1", follow: false });
  } finally {
    H.listWindow = null;
  }
});

test("Home pressed with the bottom asked for and no window, in a session under the cap, lands on turn 1", async () => {
  const { v, cx } = await capSession(60);
  const sim = simList(v);
  try {
    openAt(v, cx, sim, 562);
    expect([v.rows().some((r) => r.key === "older"), v.capCut, shownIn(v, sim.last()).includes("0:1")]).toEqual([false, 0, false]);
    v.toBottom = true;
    v.action("first", cx);
    settleList(v, cx, sim);
    expect({ shows: shownIn(v, sim.last()).includes("0:1"), toBottom: v.toBottom, sel: v.sel, follow: v.follow }).toEqual({ shows: true, toBottom: false, sel: "0:1", follow: false });
  } finally {
    H.listWindow = null;
  }
});

test("a key to a turn in the middle with the bottom asked for lands on that turn", async () => {
  const { v, cx } = await capSession(60);
  const sim = simList(v);
  try {
    openAt(v, cx, sim, 562);
    v.sel = "0:31";
    v.toBottom = true;
    v.action("prev", cx);
    expect(v.sel).toBe("0:30");
    settleList(v, cx, sim);
    expect({ shows: shownIn(v, sim.last()).includes("0:30"), end: sim.last().end, toBottom: v.toBottom, follow: v.follow }).toEqual({ shows: true, end: false, toBottom: false, follow: false });
  } finally {
    H.listWindow = null;
  }
});

// The newest turn's head is far from the end when the turn is open and long, so a jump to it
// that dropped the pending bottom would centre the head and leave the end.
test("a key to the session's end with the bottom already asked for still ends at the bottom", async () => {
  const { v, cx } = await capSession(40, null, 39, 40);
  const sim = simList(v);
  try {
    v.open.add("0:40");
    openAt(v, cx, sim, 562);
    expect([v.sel, shownIn(v, sim.last()).includes("0:40")]).toEqual(["0:40", false]);
    v.toBottom = true;
    v.action("next", cx);
    expect([v.sel, v.follow]).toEqual(["0:40", true]);
    const fs = settleList(v, cx, sim);
    expect(fs.length).toBeGreaterThan(0);
    expect({ away: fs.map((f) => endOf(v, f)).filter((at) => at !== true), toBottom: v.toBottom, follow: v.follow }).toEqual({ away: [], toBottom: false, follow: true });
  } finally {
    H.listWindow = null;
  }
});

// A build that keeps the rows before its first new turn notes its change for the window's
// memos (noteRows) once it has put its rows in, with the rows' key cleared until its record is
// made. Herdr's stop falls at any call and runs no catch: the render is left open (renderOpen).
// A stop in noteRows, before the note or just after it, ends as an unstopped run does: the
// same rows, sizes and index, the same window, list and slots, the same counts of turns outside
// the window, which the drawn notes say, the same selection where latest was asked for during a
// build, and the same turns built, the rows before the last mark kept. The note was made before the record, with no key: a stop there left the new rows under
// no key, and the next build was of every row. Over two days (a build keeps rows only then,
// keptFrom), with a live event on the running turn.
test("a build Herdr stops in noteRows, before or after its note, ends as an unstopped run does, with the same rows kept and the same turns built", async () => {
  const STOP = new Error("stopped by Herdr");
  const got = {};
  for (const at of ["none", "before", "after"]) {
    const { v, cx, s } = await runningSession(300, SMALL);
    const { apply } = await import("../mods/agent-threads/core/turns.js");
    v.jumpLatest(true);
    frames(v, cx);
    let built = 0;
    const turnRows = v.turnRows;
    v.turnRows = function (...a) { built++; return turnRows.apply(this, a); };
    let armed = at !== "none";
    let notes = 0;
    const note = v.noteRows;
    v.noteRows = function (...a) {
      notes++;
      if (armed && at === "before") { armed = false; throw STOP; }
      const r = note.apply(this, a);
      if (armed && at === "after") { armed = false; throw STOP; }
      return r;
    };
    apply(s, { k: "t", t: "More: the order is still fine." });
    // Latest was asked for while rows were being built: the build's end selects the newest turn
    // (latestAfterBuild), after the record.
    v.sel = "0:290";
    v.latestDue = { sel: v.sel };
    built = 0;
    let stops = 0;
    for (let k = 0; k < 40; k++) {
      try { draw(v, cx); } catch (e) { if (e !== STOP) throw e; stops++; v.renderOpen = true; }
      cx.flush(150);
    }
    delete v.turnRows;
    delete v.noteRows;
    const index = v.baseRows.every((r, i) => v.baseIndex.get(r.key) === i) && v.baseIndex.size === v.baseRows.length;
    got[at] = {
      stops, noted: notes > 0, keyed: v.rowsKey != null, index,
      rows: v.baseRows.map((r) => r.key), sizes: v.baseSizes.slice(), list: v.rows().map((r) => r.key),
      win: [v.win.at?.a, v.win.at?.z], outside: expectOutsideRight(v), slots: v.slotsMemo.slice(), sel: v.sel, due: v.latestDue ?? null,
      // Turns built from the live event on: all 300 again when a build is of every row.
      built,
    };
  }
  const same = (x) => ({ keyed: x.keyed, index: x.index, rows: x.rows, sizes: x.sizes, list: x.list, win: x.win, outside: x.outside, slots: x.slots, sel: x.sel, due: x.due, built: x.built });
  expect([got.none.stops, got.none.noted, got.before.stops, got.after.stops]).toEqual([0, true, 1, 1]);
  expect(same(got.before)).toEqual(same(got.none));
  expect(same(got.after)).toEqual(same(got.none));
  expect(got.none.outside.earlier).toBeGreaterThan(0);
  expect([got.none.sel, got.none.due]).toEqual(["0:300", null]);
  expect(got.none.built).toBeLessThan(300);
}, 60000);

// A splice (a card closed) notes each run's change inside the part where the rows, their sizes
// and their index change together (splicing). A stop in that note, left as Herdr leaves it, is
// followed by a build of every row, once, and ends as an unstopped run does.
test("a splice Herdr stops in noteRows is followed by one build of every row, and ends as an unstopped run does", async () => {
  const STOP = new Error("stopped by Herdr");
  const got = {};
  for (const stop of [false, true]) {
    const { v, cx } = await runningSession(300, SMALL);
    v.jumpLatest(true);
    frames(v, cx);
    v.toggle("0:295", cx);
    frames(v, cx);
    const opened = v.open.has("0:295");
    let built = 0;
    const turnRows = v.turnRows;
    v.turnRows = function (...a) { built++; return turnRows.apply(this, a); };
    let armed = stop;
    let inSplice = false;
    let notes = 0;
    const splice = v.spliceRows;
    v.spliceRows = function (...a) { inSplice = true; const done = splice.apply(this, a); inSplice = false; return done; };
    const note = v.noteRows;
    v.noteRows = function (...a) {
      if (inSplice) notes++;
      if (armed && inSplice) { armed = inSplice = false; throw STOP; }
      return note.apply(this, a);
    };
    v.toggle("0:295", cx);
    let stops = 0;
    for (let k = 0; k < 40; k++) {
      try { draw(v, cx); } catch (e) { if (e !== STOP) throw e; stops++; v.renderOpen = true; }
      cx.flush(150);
    }
    delete v.turnRows;
    delete v.spliceRows;
    delete v.noteRows;
    got[stop] = {
      opened, closed: !v.open.has("0:295"), stops, notes, built, splicing: Boolean(v.splicing),
      end: {
        keyed: v.rowsKey != null, index: v.baseRows.every((r, i) => v.baseIndex.get(r.key) === i) && v.baseIndex.size === v.baseRows.length,
        rows: v.baseRows.map((r) => r.key), sizes: v.baseSizes.slice(), list: v.rows().map((r) => r.key), slots: v.slotsMemo.slice(),
        win: [v.win.at?.a, v.win.at?.z], outside: expectOutsideRight(v), sel: v.sel,
      },
    };
  }
  const { end: e0, ...none } = got.false;
  const { end: e1, ...one } = got.true;
  expect(none).toEqual({ opened: true, closed: true, stops: 0, notes: 1, built: 1, splicing: false });
  // The stopped splice's one turn, then every turn once.
  expect(one).toEqual({ opened: true, closed: true, stops: 1, notes: 1, built: 301, splicing: false });
  expect(e1).toEqual(e0);
}, 60000);

// A splice raises the rows' version, then notes its change (noteRows), then puts the sizes and
// the index right. Herdr's stop falls at any call: entering the note, at its push, or just after
// it. Until the push the version has no record, and rowsSince must not take the rows as known;
// the next build is of every row in all three (splicing). The stopped draw's timers then run
// (kept) or are gone (lost), and the counts outside the window may be asked for between the stop
// and the next build, as the debug report does. Cards opened above the window, where a wrong
// carry would move its counts and its day's band: one, and one with another in the window (two
// runs in one splice, the later turn's first), over three days.
async function stoppedSplice(two, stop) {
  const STOP = new Error("stopped by Herdr");
  const { v, cx } = await capSession(150, SMALL, -1, 25, (i) => Math.floor(i / 50));
  v.shapeBudget = Infinity;
  v.jumpLatest(true);
  frames(v, cx);
  for (let k = 0; k < 3; k++) { v.showMore(false); frames(v, cx); }
  const opens = two ? ["0:5", v.turnKeys(v.rows())[3]] : ["0:5"];
  expectOutsideRight(v);
  const memo = { rows: v.win.outMemo.rows, ver: v.win.outMemo.ver };
  const was = v.baseRows.length;
  expect([memo.rows === v.baseRows, memo.ver === (v.baseVer ?? 0), v.baseIndex.get("0:5") < v.win.at.a, v.win.at.z < was]).toEqual([true, true, true, true]);
  let built = 0;
  const turnRows = v.turnRows;
  v.turnRows = function (...a) { built++; return turnRows.apply(this, a); };
  let armed = stop != null;
  let notes = 0;
  const note = v.noteRows;
  v.noteRows = function (...a) {
    const here = armed && stop.at !== "spliced" && ++notes === stop.run;
    if (here) armed = false;
    if (here && stop.at === "entry") throw STOP;
    if (here && stop.at === "push") { const log = (this.rowsLog ??= []); log.push = () => { delete log.push; throw STOP; }; }
    const r = note.apply(this, a);
    if (here && stop.at === "noted") throw STOP;
    return r;
  };
  let stops = 0;
  const step = () => { try { draw(v, cx); } catch (e) { if (e !== STOP) throw e; stops++; v.renderOpen = true; } };
  // The rows' own splice, done, then the stop (at "spliced").
  if (stop?.at === "spliced") {
    const arr = v.baseRows;
    let n = 0;
    arr.splice = function (...a) {
      const here = armed && ++n === stop.run;
      if (here) { armed = false; delete arr.splice; }
      const r = Array.prototype.splice.apply(this, a);
      if (here) throw STOP;
      return r;
    };
  }
  for (const k of opens) v.open.add(k);
  const had = cx.timers.slice();
  step();
  let gap = null;
  if (stop) {
    if (stop.timers === "lost") cx.timers = cx.timers.filter((x) => had.includes(x));
    const c = v.rowsSince(memo.rows, memo.ver);
    const rows = v.baseRows;
    gap = { splicing: v.splicing, ver: (v.baseVer ?? 0) - memo.ver, known: c == null ? null : c.d === rows.length - was, now: v.rowsSince(rows, v.baseVer ?? 0).d };
    if (stop.ask) {
      const { a, z } = v.win.at;
      const turns = (x) => x.filter((r) => TURN_ROW.has(r.kind)).length;
      expect(v.win.outside(v.winList())).toEqual({ earlier: turns(rows.slice(0, a)), later: turns(rows.slice(z)) });
      expect(v.bandAbove(rows, a)).toBe(rows.slice(0, a + 1).findLastIndex((r) => r.kind === "day"));
    }
  }
  for (let k = 0; k < 12; k++) { step(); cx.flush(150); }
  delete v.turnRows;
  delete v.noteRows;
  const now = bandNow(v);
  const pill = drawnPill(v, cx, now.head.key);
  expect(pill).toBe(now.band);
  return {
    stops, built, gap, splicing: Boolean(v.splicing), open: opens.every((k) => v.open.has(k)),
    end: {
      keyed: v.rowsKey != null, index: v.baseRows.every((r, i) => v.baseIndex.get(r.key) === i) && v.baseIndex.size === v.baseRows.length,
      rows: v.baseRows.map((r) => r.key), sizes: v.baseSizes.slice(), list: v.rows().map((r) => r.key), slots: v.slotsMemo.slice(),
      win: [v.win.at.a, v.win.at.z], outside: expectOutsideRight(v), band: pill?.key, sel: v.sel,
    },
  };
}
async function stoppedSplicesEndRight(spots) {
  for (const [two, nth] of [[false, 1], [true, 1], [true, 2]]) {
    const { end, ...none } = await stoppedSplice(two, null);
    expect(none).toEqual({ stops: 0, built: two ? 2 : 1, gap: null, splicing: false, open: true });
    expect(end.rows.length).toBeGreaterThan(150);
    for (const at of spots) for (const timers of ["kept", "lost"]) for (const ask of [false, true]) {
      const { end: e, ...one } = await stoppedSplice(two, { run: nth, at, timers, ask });
      // The stopped splice's turns, then every turn once. Not known until the note is made.
      expect([at, timers, ask, one]).toEqual([at, timers, ask, {
        stops: 1, built: nth + 150, gap: { splicing: true, ver: nth, known: at === "noted" ? true : null, now: 0 }, splicing: false, open: true,
      }]);
      expect(e).toEqual(end);
    }
  }
}

test("a splice Herdr stops between its version and its note, in the note or just after it ends as an unstopped run does, its timers kept or lost, and a version with no note is not taken as known", () => stoppedSplicesEndRight(["entry", "push", "noted"]), 120000);

// The splice of the rows and the store of their version have no call between them, so Herdr's
// interpreter cannot stop there. Compiled code can be stopped at any point, so the rows here are
// an array whose own splice does its work and then throws the stop. With the version raised after
// the rows, they have changed under the version a memo holds, rowsSince answers "no change", and
// the counts asked for before the next build ends are the old rows'.
test("a splice Herdr stops just after the rows change, before anything else is stored, ends as an unstopped run does, and the changed rows are not taken as known", () => stoppedSplicesEndRight(["spliced"]), 120000);

// ---- a jump made after a wheel brought the chat's end on screen, before the next frame ----

// The frame a wheel brings the end on screen in leaves a step for the next one, "restick": follow
// again, the newest turn selected (stickCheck, applyStick). The next frame comes with the 120 ms
// timer at the latest. A jump made meanwhile is the newer word. The step was taken over it: with a
// window the list showed the jump's turn for one frame, and the window then slid back to its end.
// Every place here is a turn, or an item, far up from the end.
const PENDING = {
  "#5 typed in the search field": { go: (v, cx) => { v.setQuery("#5", cx); } },
  "a rail jump": { go: (v, cx) => { v.railJump("0:5", cx); } },
  "a pin's return": {
    go: (v, cx) => {
      v.pinnedList = () => [{ key: "0:5", turn: v.findTurn("0:5"), pin: { n: 5 }, s: v.current(), state: "done" }];
      v.goPin(0, cx);
    },
  },
  // As the Trajectory pane open beside the list (trajPaneOpen, here by hand) writes its turn.
  "a turn picked in the Trajectory": {
    go: (v) => {
      v.terminal = "t-traj";
      v.trajPaneOpen = () => true;
      state.shared["threads.turnSel"] = { "t-traj": { key: "0:5", by: "other", at: Date.now() + 1000, pane: "trajectory" } };
      expect(v.syncSel()).toBe(true);
    },
  },
  "Go to that reply": {
    go: (v) => {
      const turn = v.findTurn("0:148");
      const was = turn.answeredIn;
      turn.answeredIn = 5;
      v.goToAnswer(turn);
      turn.answeredIn = was;
    },
  },
  // Answered together with a later turn: that turn opens, and its reply lands at the top.
  "Go to that reply, answered together": {
    go: (v) => {
      const turn = v.findTurn("0:148");
      const was = turn.answeredBy;
      turn.answeredBy = 5;
      v.goToAnswer(turn);
      turn.answeredBy = was;
      expect([v.scrollTo.key, v.scrollTo.how]).toEqual(["md:0:5:0", "land"]);
    },
    at: () => "md:0:5:0",
    sel: "0:5",
  },
  "Show earlier": { go: (v) => { v.showMore(false); }, at: (v) => v.scrollTo.key },
  // 100 closed turns past a cap of 60 items, in no window: the newest 59 under the note.
  "a press on the cut's note": { n: 100, cap: { max: 60 }, go: (v) => { v.capMore("capped"); }, at: (v) => v.scrollTo.key, sel: "0:100" },
  "#5 typed in the search field, in a session under the cap": { n: 60, cap: null, go: (v, cx) => { v.setQuery("#5", cx); } },
};
// The pane with the end brought on screen by a wheel, and the frame after it not drawn yet.
async function backAtEnd(n, cap) {
  noPins();
  const { v, cx } = await capSession(n, cap);
  const sim = simList(v);
  openAt(v, cx, sim, 562);
  sim.wheel(3000);
  settleList(v, cx, sim);
  expect([v.follow, sim.last().end, v.bottomShown]).toEqual([false, false, false]);
  dropTimers(v, cx);
  // No scroll of the pane's own is settling.
  v.scrollBusyUntil = 0;
  sim.wheel(-1e6);
  draw(v, cx);
  expect({ step: v.stickStep, end: sim.last().end, follow: v.follow, scrollTo: v.scrollTo ?? null, toBottom: Boolean(v.toBottom) }).toEqual({ step: "restick", end: true, follow: false, scrollTo: null, toBottom: false });
  return { v, cx, sim };
}
// The frames after a jump, each drawn between its asks as Herdr draws them, until all is settled.
function jumpFrames(v, cx, sim) {
  H.drawBetweenAsks = true;
  try {
    for (let k = 0; k < 8; k++) probeFrame(v, cx);
    settleList(v, cx, sim);
  } finally {
    H.drawBetweenAsks = false;
  }
}
for (const [name, { n = 150, cap = SMALL, go, at = () => "0:5", sel = null }] of Object.entries(PENDING)) {
  test(`the end brought on screen by a wheel and, before the next frame, ${name}: the list ends at the place it went to, and does not follow`, async () => {
    const { v, cx, sim } = await backAtEnd(n, cap);
    go(v, cx);
    const key = at(v);
    expect([v.follow, Boolean(v.scrollTo), shownIn(v, sim.last()).includes(key)]).toEqual([false, true, false]);
    jumpFrames(v, cx, sim);
    expect({ shows: shownIn(v, sim.last()).includes(key), end: sim.last().end, sel: v.sel, follow: v.follow, toBottom: Boolean(v.toBottom) }).toEqual({ shows: true, end: false, sel: sel ?? key, follow: false, toBottom: false });
  }, 30000);
}

// Latest asks for the end, and a jump made before the next frame is the newer word. Where the jump
// did not drop the end asked for, the frame took the end (the draw takes it before a jump's scroll),
// in the window the jump had moved: past the cap the list ended at that window's end, neither the
// jump's turn nor the session's end, and under the cap at the session's end.
const OVER_END = {
  "#5 typed in the search field": PENDING["#5 typed in the search field"],
  "a turn picked in the Trajectory": PENDING["a turn picked in the Trajectory"],
  "Go to that reply": PENDING["Go to that reply"],
  // The Trajectory in this pane: the Chat comes back at its turn. The end asked for waits while it
  // shows, as the list is not drawn.
  "the way back from the Trajectory": { go: (v) => { v.traj = true; v.tsel = "0:5"; v.leaveTraj(); } },
  // The session's first five turns are a day before the others.
  "the day before by key": { dayOf: (i) => (i < 5 ? 0 : 1), go: (v, cx) => { v.action("prevDay", cx); }, at: () => "0:1" },
  "#5 typed in the search field, in a session under the cap": PENDING["#5 typed in the search field, in a session under the cap"],
};
for (const [name, { n = 150, cap = SMALL, dayOf, go, at = () => "0:5" }] of Object.entries(OVER_END)) {
  test(`latest asked for and, before the next frame, ${name}: the list ends at the place it went to`, async () => {
    noPins();
    const { v, cx } = await capSession(n, cap, -1, 25, dayOf);
    const sim = simList(v);
    openAt(v, cx, sim, 562);
    sim.wheel(3000);
    settleList(v, cx, sim);
    expect([v.follow, sim.last().end]).toEqual([false, false]);
    dropTimers(v, cx);
    v.jumpLatest(true);
    expect([v.follow, v.toBottom]).toEqual([true, true]);
    go(v, cx);
    const key = at(v);
    expect([v.sel, v.follow, Boolean(v.scrollTo), shownIn(v, sim.last()).includes(key)]).toEqual([key, false, true, false]);
    jumpFrames(v, cx, sim);
    expect({ shows: shownIn(v, sim.last()).includes(key), end: sim.last().end, sel: v.sel, follow: v.follow, toBottom: Boolean(v.toBottom) }).toEqual({ shows: true, end: false, sel: key, follow: false, toBottom: false });
  }, 30000);
}

// The controls for both: with no jump in between, latest and a wheel to the end do what they did, and
// a rail jump with neither the step nor the end asked for lands.
for (const [where, n, cap] of [["in a window", 150, SMALL], ["under the cap", 60, null]]) {
  test(`control, ${where}: latest alone, from up in the session, ends at the newest turn and follows`, async () => {
    noPins();
    const { v, cx } = await capSession(n, cap);
    const sim = simList(v);
    openAt(v, cx, sim, 562);
    sim.wheel(3000);
    settleList(v, cx, sim);
    expect([v.follow, sim.last().end]).toEqual([false, false]);
    v.jumpLatest(true);
    jumpFrames(v, cx, sim);
    expect({ shows: shownIn(v, sim.last()).includes(`0:${n}`), end: endOf(v, sim.last()), sel: v.sel, follow: v.follow }).toEqual({ shows: true, end: true, sel: `0:${n}`, follow: true });
  }, 30000);
  test(`control, ${where}: the end brought on screen by a wheel, with no jump after it, follows again on the newest turn`, async () => {
    const { v, cx, sim } = await backAtEnd(n, cap);
    v.sel = "0:5";
    jumpFrames(v, cx, sim);
    expect({ shows: shownIn(v, sim.last()).includes(`0:${n}`), end: endOf(v, sim.last()), sel: v.sel, follow: v.follow }).toEqual({ shows: true, end: true, sel: `0:${n}`, follow: true });
  }, 30000);
  test(`control, ${where}: a rail jump from the chat's end, with no step left and no end asked for, lands on its turn`, async () => {
    noPins();
    const { v, cx } = await capSession(n, cap);
    const sim = simList(v);
    openAt(v, cx, sim, 562);
    expect([v.stickStep ?? null, v.toBottom, sim.last().end]).toEqual([null, false, true]);
    v.railJump("0:5", cx);
    jumpFrames(v, cx, sim);
    expect({ shows: shownIn(v, sim.last()).includes("0:5"), end: sim.last().end, sel: v.sel, follow: v.follow }).toEqual({ shows: true, end: false, sel: "0:5", follow: false });
  }, 30000);
}

// ---- the way back from the Trajectory in the Chat's own pane ----

// A reader who follows and only looks at the Trajectory (y, in a pane too narrow for one beside the
// Chat) comes back to the Chat's end, still following. A turn picked there is theirs, and the Chat
// goes to it. The session grows through the pane's own read, which its timers ask for while the
// agent works (every 5 s), with poll beside it (every 1 s); only the extractor's answer is made here.
const NEWEST = "0:150";
// 150 turns in a window, the newest one running (or done), in a 400 px pane at the Chat's end.
async function narrowChat(running = true) {
  noPins();
  const { v, cx, s } = await capSession(running ? 149 : 150, SMALL);
  v.rootH = 600; v.listH = 500;
  state.terminals[0].status = "working";
  // What each transcript holds that is not read yet, an event counted as a byte.
  const files = new Map();
  H.extractHook = async ([, file, offset]) => {
    const f = files.get(file) ?? { size: 0, late: [] };
    const out = [{ k: "file", size: f.size }, { k: "chunk", used: f.size - Number(offset) }, ...f.late.splice(0)];
    return { code: 0, stdout: out.map((e) => JSON.stringify(e)).join("\n"), stderr: "" };
  };
  // Events come in, the pane's timers come round once, and the read they ask for ends.
  const came = async (events, file = s.file) => {
    const f = files.get(file) ?? { size: 0, late: [] };
    files.set(file, f);
    f.size += events.length;
    f.late.push(...events);
    for (const x of cx.everies) x.fn(cx);
    await settle(v);
  };
  // The running turn's reply grows by n paragraphs, with a call after each: two more items each.
  let part = 0;
  const grow = (n) => came(Array.from({ length: n }, () => [{ k: "t", t: `Part ${++part}: ${"word ".repeat(100)}` }, { k: "u", n: "Read" }]).flat());
  if (running) {
    await came([{ k: "p", o: "human", t: "Prompt 149: check order 149.", ts: new Date(Date.UTC(2026, 10, 1, 10)).toISOString() }]);
    await grow(1);
  }
  const sim = simList(v);
  // The Trajectory's list is another one: the Chat's keeps its place while it shows.
  const chat = H.listWindow;
  H.listWindow = (n) => (v.traj ? { start: 0, end: Math.min(n, 40) } : chat(n));
  openAt(v, cx, sim, 402);
  expect([v.sel, v.follow, v.pw(), v.current().turns.length]).toEqual([NEWEST, true, 400, 150]);
  return { v, cx, s, sim, came, grow };
}
function trajFrames(v, cx) { for (let k = 0; k < 3; k++) probeFrame(v, cx); }
// What the Chat is asked for as it comes back, before its first frame.
const asksBack = (v) => ({ traj: v.traj, sel: v.sel, follow: v.follow, toBottom: Boolean(v.toBottom), scrollTo: v.scrollTo ?? null });
const toEnd = (sel = NEWEST) => ({ traj: false, sel, follow: true, toBottom: true, scrollTo: null });
const toTurn = (key) => ({ traj: false, sel: key, follow: false, toBottom: false, scrollTo: { key, how: "center" } });
// Where it ends.
const endsAt = (v, sim) => ({ end: sim.last().end, sel: v.sel, follow: v.follow });
const atEnd = (sel = NEWEST) => ({ end: true, sel, follow: true });

test("followed into the Trajectory, the running reply grown past the pane meanwhile, and back on the same turn: the Chat is at its end, follows, and follows the next growth", async () => {
  const { v, cx, sim, grow } = await narrowChat();
  v.openTraj();
  trajFrames(v, cx);
  await grow(12);
  trajFrames(v, cx);
  v.leaveTraj();
  expect(asksBack(v)).toEqual(toEnd());
  jumpFrames(v, cx, sim);
  expect(endsAt(v, sim)).toEqual(atEnd());
  // The turn's own items are taller than the pane, so its first one is off the top at the end.
  const f = sim.last();
  expect(f.keys.reduce((sum, k, i) => sum + (/(^|:)0:150(:|$)/.test(k) ? f.sizes[i] : 0), 0)).toBeGreaterThan(v.listH);
  await grow(3);
  jumpFrames(v, cx, sim);
  expect(endsAt(v, sim)).toEqual(atEnd());
  expect(shownIn(v, sim.last())).toContain(`gp:0:150:${v.findTurn(NEWEST).steps.length - 1}`);
}, 30000);

test("followed into the Trajectory, 25 turns come meanwhile, and back on the same turn: the Chat is at its end on the newest turn, follows, and follows the next turn", async () => {
  const { v, cx, sim, came } = await narrowChat(false);
  v.openTraj();
  trajFrames(v, cx);
  await came(Array.from({ length: 25 }, (_, i) => capTurn(150 + i)).flat());
  trajFrames(v, cx);
  expect([v.current().turns.length, v.turnOfRow(v.tsel)]).toEqual([175, NEWEST]);
  v.leaveTraj();
  expect(asksBack(v)).toEqual(toEnd("0:175"));
  jumpFrames(v, cx, sim);
  expect(endsAt(v, sim)).toEqual(atEnd("0:175"));
  await came(capTurn(175));
  jumpFrames(v, cx, sim);
  expect(endsAt(v, sim)).toEqual(atEnd("0:176"));
}, 30000);

test("followed into the Trajectory, another turn picked there while the running reply grows, and back: the Chat is at that turn, centred, and does not follow", async () => {
  const { v, cx, sim, grow } = await narrowChat();
  v.openTraj();
  trajFrames(v, cx);
  await grow(6);
  trajFrames(v, cx);
  expect(v.ledgerRows().some((r) => r.key === "0:120")).toBe(true);
  v.ledgerClick("0:120");
  await grow(6);
  trajFrames(v, cx);
  // The end is asked for by the read, and waits while the list is not drawn.
  expect([v.follow, v.toBottom]).toEqual([true, true]);
  v.leaveTraj();
  expect(asksBack(v)).toEqual(toTurn("0:120"));
  jumpFrames(v, cx, sim);
  expect({ ...endsAt(v, sim), shows: shownIn(v, sim.last()).includes("0:120") }).toEqual({ end: false, sel: "0:120", follow: false, shows: true });
}, 30000);

test("not followed into the Trajectory, the running reply grown meanwhile, and back on the same turn: the Chat is at that turn, centred, and does not follow", async () => {
  const { v, cx, sim, grow } = await narrowChat();
  v.command("search:#120", cx);
  v.command("escape", cx);
  settleList(v, cx, sim);
  // Read on from there, so the way back has a place to go to.
  sim.wheel(1500);
  settleList(v, cx, sim);
  expect([v.sel, v.follow, shownIn(v, sim.last()).includes("0:120")]).toEqual(["0:120", false, false]);
  v.openTraj();
  trajFrames(v, cx);
  await grow(12);
  trajFrames(v, cx);
  v.leaveTraj();
  expect(asksBack(v)).toEqual(toTurn("0:120"));
  jumpFrames(v, cx, sim);
  expect({ ...endsAt(v, sim), shows: shownIn(v, sim.last()).includes("0:120") }).toEqual({ end: false, sel: "0:120", follow: false, shows: true });
}, 30000);

test("followed into the Trajectory and back with nothing new: the Chat is at its end and follows", async () => {
  const { v, cx, sim, grow } = await narrowChat();
  v.openTraj();
  trajFrames(v, cx);
  v.leaveTraj();
  expect(asksBack(v)).toEqual(toEnd());
  jumpFrames(v, cx, sim);
  expect(endsAt(v, sim)).toEqual(atEnd());
  await grow(3);
  jumpFrames(v, cx, sim);
  expect(endsAt(v, sim)).toEqual(atEnd());
}, 30000);

// Steps in the Trajectory that come back to the turn it opened on (here to one of its steps) leave
// the reader on the same turn.
test("followed into the Trajectory, a step up to the turn before and down again onto a step of the turn it opened on, the running reply grown meanwhile, and back: the Chat is at its end and follows", async () => {
  const { v, cx, sim, grow } = await narrowChat();
  v.openTraj();
  trajFrames(v, cx);
  v.key(keyEv("up"), cx);
  expect(v.turnOfRow(v.tsel)).toBe("0:149");
  await grow(3);
  trajFrames(v, cx);
  v.key(keyEv("down"), cx);
  v.key(keyEv("down"), cx);
  trajFrames(v, cx);
  expect([v.tsel === NEWEST, v.turnOfRow(v.tsel)]).toEqual([false, NEWEST]);
  v.leaveTraj();
  expect(asksBack(v)).toEqual(toEnd());
  jumpFrames(v, cx, sim);
  expect(endsAt(v, sim)).toEqual(atEnd());
}, 30000);

// Following that stopped while the Trajectory showed stays stopped: a turn taken from a Trajectory
// pane opened beside the Chat meanwhile (trajPaneOpen, here by hand).
test("followed into the Trajectory, following stopped meanwhile by a turn from a Trajectory pane beside the Chat, and back on the same turn: the Chat goes to that turn and does not follow", async () => {
  const { v, cx } = await narrowChat();
  v.openTraj();
  trajFrames(v, cx);
  v.trajPaneOpen = () => true;
  state.shared["threads.turnSel"] = { [v.terminal]: { key: "0:100", by: "other", at: Date.now() + 1000, pane: "trajectory" } };
  expect([v.syncSel(), v.sel, v.follow]).toEqual([true, "0:100", false]);
  delete v.trajPaneOpen;
  v.leaveTraj();
  expect(asksBack(v)).toEqual(toTurn(NEWEST));
}, 30000);

// Following that started while the Trajectory showed (a new session, after /clear: adopt) was not
// the reader's when they went in, and they come back to the turn they were on. The lookup's answer
// is made here; poll asks for it at the terminal's next turn.
test("not followed into the Trajectory, a new session read meanwhile, and back on the same turn: the Chat goes to that turn and does not follow", async () => {
  const { v, cx, sim, s, came } = await narrowChat();
  v.command("search:#120", cx);
  v.command("escape", cx);
  settleList(v, cx, sim);
  v.openTraj();
  trajFrames(v, cx);
  expect([v.follow, v.turnOfRow(v.tsel)]).toEqual([false, "0:120"]);
  const file = s.file.replace(/[^/]*$/, "next.jsonl");
  const found = v.pinnedResult();
  v.pinnedResult = () => ({ ...found, id: "00000000-0000-4000-8000-00000000000b", file });
  state.terminals[0].turn = "next";
  await came(capTurn(0), file);
  expect([v.sessions.length, v.follow, v.sel, v.toBottom]).toEqual([2, true, "1:1", true]);
  trajFrames(v, cx);
  v.leaveTraj();
  expect(asksBack(v)).toEqual(toTurn("0:120"));
}, 30000);

// Every way in (openTraj, from the key, the button over the list and the command) by every way out
// (leaveTraj, from y, Esc, the two forms of the Chat button and the two commands).
const pressOf = (c, id) => c.slice(c.findIndex((e) => e[0] === "id" && e[1] === id)).find((e) => e[0] === "on_click").at(-1);
const INTO = {
  "the y key": (v, cx) => { v.key(keyEv("y"), cx); },
  "the button": (v, cx) => { pressOf(frame(v, cx), "th-traj")({}, cx); },
  "the command": (v, cx) => { v.command("trajectory", cx); },
};
const OUT = {
  "the y key": (v, cx) => { v.key(keyEv("y"), cx); },
  Esc: (v, cx) => { v.key(keyEv("escape"), cx); },
  "the Chat button": (v, cx) => {
    const c = frame(v, cx);
    expect(c.some((e) => e[0] === "child" && e[1] === "Chat")).toBe(true);
    pressOf(c, "th-traj-chat")({}, cx);
  },
  // The heading alone is drawn at 150 px, so the Chat's rows keep their width.
  "the Chat button's icon in a compact heading": (v, cx) => {
    const w = v.paneW;
    v.paneW = 150;
    H.rec = [];
    v.trajHeading(theme, v.ledger(), v.ledgerRows(), 0);
    const c = H.rec;
    H.rec = null;
    v.paneW = w;
    expect(c.some((e) => e[0] === "child" && e[1] === "Chat")).toBe(false);
    pressOf(c, "th-traj-chat")({}, cx);
  },
  "the command": (v, cx) => { v.command("trajectory", cx); },
  "the escape command": (v, cx) => { v.command("escape", cx); },
};
for (const [out, leave] of Object.entries(OUT)) {
  test(`followed into the Trajectory by the y key, the button and the command, and back by ${out}, the running reply grown each time: the Chat is at its end and follows`, async () => {
    const { v, cx, sim, grow } = await narrowChat();
    const got = [];
    const want = [];
    for (const [into, enter] of Object.entries(INTO)) {
      enter(v, cx);
      trajFrames(v, cx);
      expect([into, v.traj]).toEqual([into, true]);
      await grow(3);
      trajFrames(v, cx);
      leave(v, cx);
      got.push([into, asksBack(v)]);
      want.push([into, toEnd()]);
      jumpFrames(v, cx, sim);
      got.push([into, endsAt(v, sim)]);
      want.push([into, atEnd()]);
    }
    expect(got).toEqual(want);
  }, 30000);
}

// Following alone does not say that the reader is on the newest turn. The way back ends at the Chat's
// end only for a Trajectory that opened on the newest turn then, or on nothing.

// A search's last match, stepped onto, follows (the matches are the rows then). y closes the search.
// With slices, the rows after it are built over several draws: the search's are still the list's.
const search = (v, cx, sim, q) => { v.command(`search:${q}`, cx); settleList(v, cx, sim); };
const LAST_MATCH = {
  "Down, then the command": { step: (v, cx) => { v.key(keyEv("down"), cx); } },
  "latest, then the command": { step: (v, cx) => { v.command("latest", cx); } },
  "Enter and End, then y": { step: (v, cx, sim) => { v.key(keyEv("enter"), cx); settleList(v, cx, sim); v.key(keyEv("end"), cx); }, into: (v, cx) => { v.key(keyEv("y"), cx); } },
  "latest, then the command, the rows after the search built over several draws": { step: (v, cx) => { v.command("latest", cx); }, slices: true },
};
for (const [how, { step, into = INTO["the command"], slices = false }] of Object.entries(LAST_MATCH)) {
  test(`a search's last match stepped onto by ${how}, into the Trajectory, and back without a step: the Chat is at that match, centred, and does not follow`, async () => {
    const { v, cx, sim } = await narrowChat(false);
    search(v, cx, sim, "order 120");
    step(v, cx, sim);
    settleList(v, cx, sim);
    expect([v.sel, v.follow, v.query]).toEqual(["0:121", true, "order 120"]);
    const whole = v.buildMax;
    if (slices) v.buildMax = () => -1;
    into(v, cx);
    v.buildMax = whole;
    expect([v.traj, v.query, v.filtering]).toEqual([true, "", false]);
    trajFrames(v, cx);
    v.key(keyEv("y"), cx);
    expect(asksBack(v)).toEqual(toTurn("0:121"));
    jumpFrames(v, cx, sim);
    expect({ ...endsAt(v, sim), shows: shownIn(v, sim.last()).includes("0:121") }).toEqual({ end: false, sel: "0:121", follow: false, shows: true });
  }, 30000);
}
test("control: a search's match not stepped onto, into the Trajectory, and back without a step: the Chat is at that match, centred, and does not follow", async () => {
  const { v, cx, sim } = await narrowChat(false);
  search(v, cx, sim, "order 120");
  expect([v.sel, v.follow]).toEqual(["0:121", false]);
  v.command("trajectory", cx);
  trajFrames(v, cx);
  v.key(keyEv("y"), cx);
  expect(asksBack(v)).toEqual(toTurn("0:121"));
  jumpFrames(v, cx, sim);
  expect({ ...endsAt(v, sim), shows: shownIn(v, sim.last()).includes("0:121") }).toEqual({ end: false, sel: "0:121", follow: false, shows: true });
}, 30000);
test("control: a search's last match stepped onto that is the Chat's newest turn, into the Trajectory, and back without a step: the Chat is at its end and follows", async () => {
  const { v, cx, sim } = await narrowChat(false);
  search(v, cx, sim, "order 149");
  v.key(keyEv("down"), cx);
  settleList(v, cx, sim);
  expect([v.sel, v.follow]).toEqual([NEWEST, true]);
  v.command("trajectory", cx);
  trajFrames(v, cx);
  v.key(keyEv("y"), cx);
  expect(asksBack(v)).toEqual(toEnd());
  jumpFrames(v, cx, sim);
  expect(endsAt(v, sim)).toEqual(atEnd());
}, 30000);

// A press on an open turn's text selects it and leaves the Chat following (click).
async function pressedChat(key) {
  const r = await narrowChat(false);
  const { v, cx, sim } = r;
  if (key !== NEWEST) v.key(keyEv("up"), cx);
  settleList(v, cx, sim);
  expect(v.sel).toBe(key);
  v.key(keyEv("enter"), cx);
  settleList(v, cx, sim);
  v.key(keyEv("end"), cx);
  settleList(v, cx, sim);
  expect([v.sel, v.follow, sim.last().end]).toEqual([NEWEST, true, true]);
  const text = shownIn(v, sim.last()).find((k) => k.startsWith(`md:${key}:`));
  expect(text).toBeDefined();
  v.click(text, cx);
  settleList(v, cx, sim);
  expect([v.sel, v.follow, sim.last().end]).toEqual([key, true, true]);
  return r;
}
const shownTurn = (v, sim, key) => ({ sel: v.sel, follow: v.follow, shows: shownIn(v, sim.last()).includes(key) });
for (const come of [0, 25]) {
  test(`a press on the text of the turn before the newest, at the Chat's end and following, into the Trajectory by y${come ? ", 25 turns come meanwhile" : ""}, and back by y: the Chat is at the pressed turn, centred, and does not follow`, async () => {
    const { v, cx, sim, came } = await pressedChat("0:149");
    v.key(keyEv("y"), cx);
    trajFrames(v, cx);
    if (come) await came(Array.from({ length: come }, (_, i) => capTurn(150 + i)).flat());
    trajFrames(v, cx);
    v.key(keyEv("y"), cx);
    expect(asksBack(v)).toEqual(toTurn("0:149"));
    jumpFrames(v, cx, sim);
    expect(shownTurn(v, sim, "0:149")).toEqual({ sel: "0:149", follow: false, shows: true });
  }, 30000);
}
test("control: a press on the newest turn's text, at the Chat's end and following, into the Trajectory by y, and back by y: the Chat is at its end and follows", async () => {
  const { v, cx, sim } = await pressedChat(NEWEST);
  v.key(keyEv("y"), cx);
  trajFrames(v, cx);
  v.key(keyEv("y"), cx);
  expect(asksBack(v)).toEqual(toEnd());
  jumpFrames(v, cx, sim);
  expect(endsAt(v, sim)).toEqual(atEnd());
}, 30000);

// A pane opened on a session of 25 turns that is still being read: 20 are in, nothing is selected,
// and the rest waits for more(). Its keys wait too (openActive), but not the Trajectory's command.
async function openingChat() {
  noPins();
  const turns = Array.from({ length: 25 }, (_, i) => capTurn(i));
  const pieces = [turns.slice(0, 20).flat(), turns.slice(20).flat()];
  const size = pieces[0].length + pieces[1].length;
  let more;
  const wait = new Promise((done) => { more = done; });
  H.extractHook = async ([, , offset]) => {
    const at = Number(offset);
    if (at > 0) await wait;
    const piece = at === 0 ? pieces[0] : at < size ? pieces[1] : [];
    return { code: 0, stdout: [{ k: "file", size }, { k: "chunk", used: piece.length }, ...piece].map((e) => JSON.stringify(e)).join("\n"), stderr: "" };
  };
  const { v, cx } = await paneWith(fixture("--only", "1"), null, 0);
  await until(() => v.current()?.turns.length === 20 && v.readWaiting && v.prefsLoaded, "the first piece of the session");
  v.debug = false;
  v.rootH = 600; v.listH = 500;
  const sim = simList(v);
  const chat = H.listWindow;
  H.listWindow = (n) => (v.traj ? { start: 0, end: Math.min(n, 40) } : chat(n));
  stillAt(v, 402);
  probeFrame(v, cx);
  v.command("trajectory", cx);
  expect([v.traj, v.sel, v.follow, Boolean(v.current().loaded)]).toEqual([true, null, true, false]);
  trajFrames(v, cx);
  return { v, cx, sim, read: async () => { more(); await settle(v); } };
}
test("the Trajectory opened with nothing selected, a step up and down again onto the newest turn, and back: the Chat is at its end and follows", async () => {
  const { v, cx, sim, read } = await openingChat();
  v.key(keyEv("up"), cx);
  expect(v.turnOfRow(v.tsel)).toBe("0:19");
  v.key(keyEv("down"), cx);
  expect(v.tsel).toBe("0:20");
  v.key(keyEv("y"), cx);
  expect(asksBack(v)).toEqual(toEnd("0:20"));
  await read();
  jumpFrames(v, cx, sim);
  expect(endsAt(v, sim)).toEqual(atEnd("0:25"));
}, 30000);
test("the Trajectory opened with nothing selected, a step up, five more turns read, a step down onto the turn that was the newest, and back: the Chat is at its end on the newest turn and follows", async () => {
  const { v, cx, sim, read } = await openingChat();
  v.key(keyEv("up"), cx);
  await read();
  trajFrames(v, cx);
  v.key(keyEv("down"), cx);
  expect([v.tsel, v.sel, v.current().turns.length]).toEqual(["0:20", "0:25", 25]);
  v.key(keyEv("y"), cx);
  expect(asksBack(v)).toEqual(toEnd("0:25"));
  jumpFrames(v, cx, sim);
  expect(endsAt(v, sim)).toEqual(atEnd("0:25"));
}, 30000);
test("control: the Trajectory opened with nothing selected, and back without a step: the Chat is at its end and follows", async () => {
  const { v, cx, sim, read } = await openingChat();
  v.key(keyEv("y"), cx);
  expect(asksBack(v)).toEqual(toEnd("0:20"));
  await read();
  jumpFrames(v, cx, sim);
  expect(endsAt(v, sim)).toEqual(atEnd("0:25"));
}, 30000);
test("control: the Trajectory opened with nothing selected, a step up, and back: the Chat goes to that turn and does not follow", async () => {
  const { v, cx, read } = await openingChat();
  v.key(keyEv("up"), cx);
  v.key(keyEv("y"), cx);
  expect(asksBack(v)).toEqual(toTurn("0:19"));
  await read();
}, 30000);

// As "not followed into the Trajectory, a new session read meanwhile", on the newest turn: the reader
// scrolled up from the end and went in.
test("control: not followed into the Trajectory on the newest turn, a new session read meanwhile, and back on the same turn: the Chat goes to that turn and does not follow", async () => {
  const { v, cx, sim, s, came } = await narrowChat();
  sim.wheel(1500);
  settleList(v, cx, sim);
  expect([v.sel, v.follow]).toEqual([NEWEST, false]);
  v.openTraj();
  trajFrames(v, cx);
  const file = s.file.replace(/[^/]*$/, "next.jsonl");
  const found = v.pinnedResult();
  v.pinnedResult = () => ({ ...found, id: "00000000-0000-4000-8000-00000000000b", file });
  state.terminals[0].turn = "next";
  await came(capTurn(0), file);
  expect([v.sessions.length, v.follow, v.sel]).toEqual([2, true, "1:1"]);
  trajFrames(v, cx);
  v.leaveTraj();
  expect(asksBack(v)).toEqual(toTurn(NEWEST));
}, 30000);

// Each way back goes by its own way in.
test("into the Trajectory and back three times, not followed on an older turn, then followed on the newest, then on one that came since: each way back goes by its own way in", async () => {
  const { v, cx, sim, came } = await narrowChat(false);
  const visit = () => {
    v.key(keyEv("y"), cx);
    trajFrames(v, cx);
    v.key(keyEv("y"), cx);
    const at = asksBack(v);
    jumpFrames(v, cx, sim);
    return at;
  };
  v.command("search:#100", cx);
  v.command("escape", cx);
  settleList(v, cx, sim);
  const got = [visit()];
  v.key(keyEv("end"), cx);
  settleList(v, cx, sim);
  got.push(visit());
  await came(capTurn(150));
  jumpFrames(v, cx, sim);
  got.push(visit());
  expect(got).toEqual([toTurn("0:100"), toEnd(), toEnd("0:151")]);
}, 30000);

// The end is asked for as latest asks for it (jumpLatest): the newest turn selected, and what would
// come in its way dropped. A read takes a long change in pieces and selects the newest turn at its end.
test("followed into the Trajectory, a new turn read in the first piece of a longer read, and back on the same turn: the Chat is at its end on that new turn, and follows the rest", async () => {
  const { v, cx, sim, s } = await narrowChat(false);
  v.openTraj();
  trajFrames(v, cx);
  const from = s.offset;
  const pieces = [capTurn(150), capTurn(151)];
  const size = from + pieces[0].length + pieces[1].length;
  let more;
  const wait = new Promise((done) => { more = done; });
  H.extractHook = async ([, , offset]) => {
    const at = Number(offset);
    if (at > from) await wait;
    const piece = at === from ? pieces[0] : at < size ? pieces[1] : [];
    return { code: 0, stdout: [{ k: "file", size }, { k: "chunk", used: piece.length }, ...piece].map((e) => JSON.stringify(e)).join("\n"), stderr: "" };
  };
  for (const x of cx.everies) x.fn(cx);
  await until(() => s.turns.length === 151 && v.readWaiting, "the first piece of the read");
  trajFrames(v, cx);
  expect([v.sel, v.follow]).toEqual([NEWEST, true]);
  v.leaveTraj();
  expect(asksBack(v)).toEqual(toEnd("0:151"));
  more();
  await settle(v);
  jumpFrames(v, cx, sim);
  expect(endsAt(v, sim)).toEqual(atEnd("0:152"));
}, 30000);

test("followed into the Trajectory by a step onto a new turn, its jump still to come and the new-turn dot on, and back on the same turn: the end is asked for, the jump dropped and the dot off", async () => {
  const { v, cx, sim, came } = await narrowChat(false);
  sim.wheel(1500);
  settleList(v, cx, sim);
  await came(capTurn(150));
  settleList(v, cx, sim);
  v.key(keyEv("down"), cx);
  v.key(keyEv("y"), cx);
  trajFrames(v, cx);
  expect([v.sel, v.follow, v.unseen, Boolean(v.scrollTo)]).toEqual(["0:151", true, true, true]);
  v.key(keyEv("y"), cx);
  expect({ ...asksBack(v), unseen: v.unseen }).toEqual({ ...toEnd("0:151"), unseen: false });
  jumpFrames(v, cx, sim);
  expect(endsAt(v, sim)).toEqual(atEnd("0:151"));
}, 30000);

test("a press's open in its 300 ms, followed again by a wheel to the end, into the Trajectory by its button and back by the Chat button within them: the turn is not opened", async () => {
  const { v, cx, sim } = await narrowChat(false);
  sim.wheel(1000);
  settleList(v, cx, sim);
  expect([v.follow, v.bottomShown]).toEqual([false, false]);
  dropTimers(v, cx);
  const key = shownIn(v, sim.last()).find((k) => /^0:\d+$/.test(k) && k !== NEWEST);
  v.click(key, cx);
  const wait = cx.timers.filter((x) => x.ms === 300);
  cx.timers = cx.timers.filter((x) => x.ms !== 300);
  expect(wait.length).toBe(1);
  sim.wheel(-1e6);
  draw(v, cx);
  draw(v, cx);
  expect([v.sel, v.follow, v.openWait?.key]).toEqual([NEWEST, true, key]);
  INTO["the button"](v, cx);
  trajFrames(v, cx);
  expect(v.openWait?.key).toBe(key);
  OUT["the Chat button"](v, cx);
  expect({ ...asksBack(v), wait: v.openWait ?? null }).toEqual({ ...toEnd(), wait: null });
  for (const x of wait) x.fn(cx);
  jumpFrames(v, cx, sim);
  expect({ ...endsAt(v, sim), open: v.open.has(key) }).toEqual({ ...atEnd(), open: false });
}, 30000);

// The newest turn the way in goes by (newestTurn) is the newest the Chat lists, in whatever session.
const peerTurn = (...rest) => {
  const ts = new Date(Date.UTC(2026, 10, 1, 10)).toISOString();
  return [{ k: "p", o: "peer", t: '<teammate-message teammate_id="helper-a" color="blue" summary="x">Done here</teammate-message>', ts }, ...rest.map((e) => ({ ...e, ts }))];
};
const ENDED = { k: "d", ms: 200 };
const NEWEST_IS = {
  "an ended agent message with no reply, hidden, after the newest turn the Chat lists": { events: peerTurn(ENDED), sel: NEWEST, done: true },
  "an agent message's turn still open, hidden once it ends, the newest the Chat lists": { events: peerTurn(), sel: "0:151", done: false },
  "an ended agent message with a reply of its own, agent messages hidden, the newest the Chat lists": { events: peerTurn({ k: "t", t: "The check is done." }, ENDED), sel: "0:151", done: true },
  "an ended agent message with no reply, agent messages shown, the newest the Chat lists": { events: peerTurn(ENDED), sel: "0:151", done: true, agentTurns: true },
};
for (const [what, { events, sel, done, agentTurns = false }] of Object.entries(NEWEST_IS)) {
  test(`followed into the Trajectory with ${what}, and back without a step: the Chat is at its end and follows`, async () => {
    const { v, cx, came } = await narrowChat(false);
    v.prefs = { ...v.prefs, agentTurns };
    await came(events);
    trajFrames(v, cx);
    const last = v.current().turns.at(-1);
    expect([last.n, last.agent, last.done, v.sel, v.follow]).toEqual([151, true, done, sel, true]);
    v.openTraj();
    trajFrames(v, cx);
    v.leaveTraj();
    expect(asksBack(v)).toEqual(toEnd(sel));
  }, 30000);
}
test("followed into the Trajectory with a new session with no turns after a clear, and back without a step: the Chat is at its end and follows", async () => {
  const { v, cx, s, came } = await narrowChat(false);
  const file = s.file.replace(/[^/]*$/, "next.jsonl");
  const found = v.pinnedResult();
  v.pinnedResult = () => ({ ...found, id: "00000000-0000-4000-8000-00000000000b", file });
  state.terminals[0].turn = "next";
  await came([], file);
  trajFrames(v, cx);
  expect([v.sessions.length, v.current().turns.length, v.sel, v.follow]).toEqual([2, 0, NEWEST, true]);
  v.openTraj();
  trajFrames(v, cx);
  v.leaveTraj();
  expect(asksBack(v)).toEqual(toEnd());
}, 30000);

// Not followed, the way back asks for its turn, and a press's pending open would take that scroll.
test("a press's open in its 300 ms, into the Trajectory by its button, another turn picked there, and back by the Chat button within them: the Chat is at the picked turn, and the pressed one is not opened", async () => {
  const { v, cx, sim } = await narrowChat(false);
  sim.wheel(1000);
  settleList(v, cx, sim);
  expect(v.follow).toBe(false);
  dropTimers(v, cx);
  const key = shownIn(v, sim.last()).find((k) => /^0:\d+$/.test(k) && k !== NEWEST && k !== "0:120");
  v.click(key, cx);
  const wait = cx.timers.filter((x) => x.ms === 300);
  cx.timers = cx.timers.filter((x) => x.ms !== 300);
  expect([wait.length, v.openWait?.key]).toEqual([1, key]);
  INTO["the button"](v, cx);
  trajFrames(v, cx);
  v.ledgerClick("0:120");
  expect([v.traj, v.tsel, v.openWait?.key]).toEqual([true, "0:120", key]);
  OUT["the Chat button"](v, cx);
  const back = asksBack(v);
  for (const x of wait) x.fn(cx);
  jumpFrames(v, cx, sim);
  expect({ back, ...shownTurn(v, sim, "0:120"), open: v.open.has(key) }).toEqual({ back: toTurn("0:120"), sel: "0:120", follow: false, shows: true, open: false });
}, 30000);

// Latest asked for while a turn that came in is still being built into the rows: the list's rows are
// the ones before it, so the newest of them is selected at once, and the build's end selects the
// newest turn (latestAfterBuild). In a session of one day every build is of every row (keptFrom), and
// a slice ends at every sixteenth turn here, so each build takes several draws.
const IN_BUILD = {
  "latest by its command": async ({ v, cx, s }) => {
    await addCapTurns(s, 150, 1);
    v.command("latest", cx);
  },
  "a turn read while following": async ({ came }) => { await came(capTurn(150)); },
  "the way back from the Trajectory": async ({ v, cx, came }) => {
    v.openTraj();
    trajFrames(v, cx);
    await came(capTurn(150));
    trajFrames(v, cx);
    v.leaveTraj();
  },
  "a wheel back to the end": async ({ v, cx, s, sim }) => {
    sim.wheel(1500);
    settleList(v, cx, sim);
    dropTimers(v, cx);
    v.scrollBusyUntil = 0;
    sim.wheel(-1e6);
    draw(v, cx);
    expect([v.stickStep, v.follow]).toEqual(["restick", false]);
    await addCapTurns(s, 150, 1);
    v.buildMax = () => -1;
    draw(v, cx);
  },
};
for (const [how, go] of Object.entries(IN_BUILD)) {
  test(`${how}, the newest turn still being built into the rows over several draws: that turn is selected once it is built, and the Chat is at its end and follows`, async () => {
    const r = await narrowChat(false);
    const { v, cx, sim } = r;
    const whole = v.buildMax;
    if (how !== "a wheel back to the end") v.buildMax = () => -1;
    await go(r);
    expect([Boolean(v.rowJob), v.sel, v.follow]).toEqual([true, NEWEST, true]);
    jumpFrames(v, cx, sim);
    v.buildMax = whole;
    expect([v.rowJob, v.current().turns.length]).toEqual([null, 151]);
    expect(endsAt(v, sim)).toEqual(atEnd("0:151"));
  }, 30000);
}
test("control: latest pressed and then a step up, while the newest turn is still being built into the rows: the turn stepped to stays selected, and the Chat does not follow", async () => {
  const { v, cx, s, sim } = await narrowChat(false);
  const whole = v.buildMax;
  v.buildMax = () => -1;
  await addCapTurns(s, 150, 1);
  v.command("latest", cx);
  v.key(keyEv("up"), cx);
  expect([Boolean(v.rowJob), v.sel, v.follow]).toEqual([true, "0:149", false]);
  jumpFrames(v, cx, sim);
  v.buildMax = whole;
  expect([v.rowJob, v.sel, v.follow]).toEqual([null, "0:149", false]);
}, 30000);
test("control: latest in a search with its rows all built, and the search closed: its match stays selected", async () => {
  const { v, cx, sim } = await narrowChat(false);
  search(v, cx, sim, "order 120");
  v.command("latest", cx);
  settleList(v, cx, sim);
  expect([v.rowJob, v.sel, v.follow]).toEqual([null, "0:121", true]);
  v.command("escape", cx);
  settleList(v, cx, sim);
  expect([v.rowJob, v.query, v.sel]).toEqual([null, "", "0:121"]);
}, 30000);

// The notes of the rows' changes hold the rows they tell of, and those hold their sessions' turns. A
// build that is not noted (here another session's) ends what the notes before it can say (rowsSince).
test("the notes of the rows' changes are kept over live events, and hold none of a session's rows once another is picked and built", async () => {
  const { v, cx, s } = await runningSession(300, SMALL);
  const { apply } = await import("../mods/agent-threads/core/turns.js");
  v.jumpLatest(true);
  frames(v, cx);
  const was = { rows: v.baseRows, ver: v.baseVer ?? 0 };
  for (const t of ["More: the order is still fine.", "And more: it is."]) {
    apply(s, { k: "t", t });
    frames(v, cx);
  }
  const holding = () => (v.rowsLog ?? []).filter((e) => [e.r0, e.r1].some((rows) => rows.some((r) => r.s === s))).length;
  expect([v.baseRows === was.rows, v.rowsSince(was.rows, was.ver) !== null, holding() > 1]).toEqual([false, true, true]);
  v.pick({ path: fixture("--only", "200") }, cx);
  await settle(v);
  frames(v, cx);
  expect([v.current().turns.length, v.baseRows.some((r) => r.s === s), holding()]).toEqual([200, false, 0]);
}, 30000);

// A jump that waits asks again in each frame it waits (held).
test("a jump that waits for the rows to reshape finds its row in each frame it waits without a walk of the list", async () => {
  const { v, cx } = await capSession(150, SMALL);
  const sim = simList(v);
  openAt(v, cx, sim, 562);
  let looks = 0;
  let walks = 0;
  const scrollRow = v.scrollRow;
  v.scrollRow = function (...a) {
    looks++;
    const rows = this.rowsMemo;
    rows.findIndex = function (...b) { walks++; return Array.prototype.findIndex.apply(this, b); };
    const at = scrollRow.apply(this, a);
    delete rows.findIndex;
    return at;
  };
  // Rows left to reshape in every frame drawn here.
  Object.defineProperty(v, "shapeLeft", { get: () => 5, set() {}, configurable: true });
  v.command("search:#10", cx);
  for (let k = 0; k < 5; k++) draw(v, cx);
  expect([v.scrollTo?.key, v.scrollTo?.held, shownIn(v, sim.last()).includes("0:10")]).toEqual(["0:10", true, true]);
  expect({ looks, walks }).toEqual({ looks: 5, walks: 0 });
  H.listWindow = null;
});

test("the row a jump goes to is the list's own place of its key, else of the next best, else of the head as a card, in a window, with Show earlier and Show later, and in a cut", async () => {
  const { v, cx } = await capSession(150, SMALL);
  v.jumpLatest(true);
  frames(v, cx);
  v.command("search:#60", cx);
  frames(v, cx);
  const seen = [];
  const check = (what) => {
    const rows = v.rows();
    const keys = [...rows.map((r) => r.key), ...v.baseRows.map((r) => r.key), "none"];
    const wrong = keys.filter((key) => v.scrollRow({ key, how: "top" }, rows).i !== rows.findIndex((r) => r.key === key));
    const k = rows[5].key;
    const next = v.scrollRow({ key: "none", or: ["none too", k], head: rows[7].key, how: "land" }, rows);
    const head = v.scrollRow({ key: "none", or: ["none too"], head: k, how: "land" }, rows);
    const none = v.scrollRow({ key: "none", how: "land" }, rows);
    seen.push([what, wrong, next, head, none, v.capCut > 0, inList(v, "older"), inList(v, "newer")]);
  };
  const right = (what, cut, more) => [what, [], { i: 5, how: "land" }, { i: 5, how: "card" }, { i: -1, how: "land" }, cut, more, more];
  check("a window");
  v.win.cap = { ...v.win.cap, slide: 1e9, stop: 1e9, max: 60 };
  v.command("search:#60", cx);
  frames(v, cx);
  check("a cut");
  expect(seen).toEqual([right("a window", false, true), right("a cut", true, false)]);
});
