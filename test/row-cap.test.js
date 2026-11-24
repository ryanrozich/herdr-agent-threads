// bun test: the list's window and capList's guard for Herdr's v_virtual_list, which takes at
// most 10,000 item sizes (TRD-116), on the render harness (test/render-harness.js). Moved whole
// from render.test.js when it grew past the 1 MiB Biome lints.
import { test, expect } from "bun:test";

import {
  capList,
  draw,
  dropTimers,
  H,
  lastList,
  LIST_MAX,
  openAt,
  PINS,
  probeFrame,
  rec,
  RowWindow,
  scripted,
  settleList,
  settleRows,
  setup,
  simList,
  state,
  stillAt,
  theme,
} from "./render-harness.js";

setup();

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
  const { v, cx } = await capSession(150, SMALL);
  const asked = scrollsOf(v);
  const reached = (k) => asked.includes(k) || v.landed?.key === k;
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
  // out, and the landing asks no first time for a head already in place.
  expect(asked.slice(0, asked.indexOf("end"))).toEqual(["0:150"]);
  expect(v.rows().at(-1).kind).toBe("tail");
});

test("a jump to one turn with more items than the list takes lands on its head, and the cut is below it, which is not the end", async () => {
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
  // No pins from an earlier test: p toggles, and pins.json lasts the file (as pinPane does).
  delete H.recordFiles[PINS];
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
// or a third place.
function noThirdPlace(v, cx, sim, key, n = 8, then = () => {}) {
  const seen = [];
  for (let k = 0; k < n; k++) { probeFrame(v, cx); seen.push(shownIn(v, sim.last())); }
  then();
  settleList(v, cx, sim);
  seen.push(shownIn(v, sim.last()));
  for (const [k, s] of seen.entries()) if (!s.includes(key)) throw new Error(`frame ${k + 1} shows ${s.join(", ")}`);
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
  for (let k = 0; k < 5; k++) { probeFrame(v, cx); ends.push(sim.last().end); }
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
    expect([sim.last().end, v.toBottom]).toEqual([true, true]);
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
    for (let k = 0; k < 4; k++) { probeFrame(v, cx); got.latest.push([sim.last().end, v.scrollTo?.key ?? null]); }
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
