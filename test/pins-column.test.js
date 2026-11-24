// bun test: the Pinned column's unpin buttons and the seven-pin limit, on the render harness
// (test/render-harness.js). Moved whole from render.test.js when it grew past the 1 MiB Biome
// lints; the other pin tests are still there ("p pins the selected turn", the Pinned view).
import { test, expect } from "bun:test";
import { PIN_ROW, pinRowShape, pinPromptText } from "../mods/agent-threads/ui.js";

import {
  allPins,
  compactPins,
  draw,
  fixture,
  frame,
  H,
  handlerAfterId,
  itemWords,
  keyEv,
  ownOf,
  pane,
  pinPane,
  PINS,
  pinsShown,
  pinWrites,
  rec,
  recordFiles,
  ROW,
  saved,
  settleRows,
  setup,
  svgs,
  theme,
  toastText,
  until,
} from "./render-harness.js";

setup();

test("seven pins are kept and listed, 1 to 7 return to them in order; an eighth is refused, and undo cannot pass the limit", async () => {
  const { v, cx, keys } = await pinPane("--extra", "10");
  const k = keys();
  // Five, then two more.
  for (let i = 0; i < 5; i++) { v.sel = k[i]; v.action("pin", cx); }
  for (const i of [5, 6]) { v.sel = k[i]; v.action("pin", cx); }
  expect(toastText(v)).toMatch(/press 7 to come back$/);
  expect(v.pinnedList().map((p) => p.key)).toEqual(k.slice(0, 7));
  expect(allPins(await saved()).length).toBe(7);
  // Listed: seven compact rows in the Pinned view, numbered 1 to 7.
  v.width = 400;
  v.key(keyEv("v"), cx);
  expect(v.rows().filter((r) => r.kind === "turn").map((r) => r.pinNo)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(v.headerText()).toBe("7 of 7");
  v.key(keyEv("v"), cx);
  // The digits, in order.
  for (let d = 1; d <= 7; d++) {
    v.sel = k.at(-1);
    v.key(keyEv(String(d)), cx);
    expect(v.sel).toBe(k[d - 1]);
    if (v.open.has(k[d - 1])) v.toggle(k[d - 1], cx);
  }
  // An eighth is refused, in words that say seven.
  v.sel = k[7];
  v.action("pin", cx);
  expect(toastText(v)).toBe("Pins are full (7). Unpin one first.");
  expect(v.pinnedList().length).toBe(7);
  expect(v.isPinned(k[7])).toBe(false);
  v.sel = k[0];
  v.action("pin", cx);
  v.sel = k[8];
  v.action("pin", cx);
  v.action("undoUnpin", cx);
  expect(toastText(v)).toBe("Pins are full (7). Unpin one first.");
  expect(v.pinnedList().length).toBe(7);
  draw(v, cx);
});

test("pins saved before seven load unchanged: the same pins, in the same order, and the file is not written again", async () => {
  const first = await pinPane("--extra", "6");
  const k = first.keys();
  for (const i of [4, 0, 2, 5, 1]) { first.v.sel = k[i]; first.v.action("pin", first.cx); }
  await saved();
  const text = recordFiles[PINS];
  const writes = pinWrites;
  const ids = allPins(JSON.parse(text)).map((p) => p.id);
  expect(ids.length).toBe(5);
  // A new pane on the same session reads that file.
  const { v } = await pane(fixture("--extra", "6"));
  await until(() => v.pinsRead, "the first read of pins.json");
  expect(v.pinnedList().map((p) => p.pin.id).sort()).toEqual([...ids].sort());
  expect(v.pinnedList().map((p) => p.key)).toEqual([0, 1, 2, 4, 5].map((i) => k[i]));
  expect(recordFiles[PINS]).toBe(text);
  // Not written again, not even with the same bytes.
  expect(pinWrites).toBe(writes);
});

// The Pinned view with three pins, in this pane (under 480 px), in a list box 700 px tall so
// they fit. The pointer goes through the list's own handlers (threads-body): a frame is drawn,
// then the pointer moves to x (unless move is false) and presses there, and the list reports
// the item pressed (click).
async function threePins(x) {
  const { v, cx, k } = await pinsShown(["--extra", "6"], [1, 3, 5]);
  v.listH = 700;
  const body = () => { const c = frame(v, cx); return { move: handlerAfterId(c, "threads-body", "on_mouse_move"), down: handlerAfterId(c, "threads-body", "on_mouse_down") }; };
  // pos false: an event with no window position (only the list's own x). y: the list's y.
  const ev = (at, pos = true, y = 300) => { const lx = (v.colLeft() + at) * v.zoom(); return { local_position: { x: lx, y }, ...(pos ? { position: { x: lx, y } } : {}), bounds: { width: v.width * v.zoom() }, click_count: 1 }; };
  const point = (at = x, pos = true) => body().move(ev(at, pos), cx);
  const press = (key, at = x, { move = true, pos = true, y = 300 } = {}) => { const h = body(); if (move) h.move(ev(at, pos, y), cx); h.down(ev(at, pos, y), cx); v.click(key, cx); };
  return { v, cx, k, press, point, body, ev, keyOf: (i) => compactPins(v)[i].key };
}
// The unpin buttons' layer in a frame: whether it is drawn, and the pins whose row box
// (th-unpin-row-N) it holds.
const unpinLayer = (v, cx) => {
  const c = frame(v, cx);
  const rows = c.filter((e) => e[0] === "id" && /^th-unpin-row-\d+$/.test(e[1])).map((e) => Number(e[1].slice(13)));
  return { c, has: c.some((e) => e[0] === "id" && e[1] === "th-unpins"), rows };
};
// The pointer comes onto pin n's row (on) or leaves it, as gpui tells the row's box
// (on_hover). False with no such box or no hover handler on it.
const hoverRow = (v, cx, n, on = true, c = frame(v, cx)) => {
  const h = ownOf(c, `th-unpin-row-${n}`).find((e) => e[0] === "on_hover")?.at(-1);
  if (!h) return false;
  h(on, cx);
  return true;
};
// The pins whose unpin button the pane draws in a frame: its row box in the plain dim colour.
const drawnRows = (v, cx) => {
  const c = frame(v, cx);
  return unpinLayer(v, cx).rows.filter((n) => ownOf(c, `th-unpin-row-${n}`).some((e) => e[0] === "text_color" && e[1] === theme.dim));
};
// Pin n's button's press-down in a frame, as gpui delivers it (it notes whether the button was
// drawn in that frame). The number of times it stopped the press, or null with no such handler.
const downButton = (cx, n, c) => {
  const h = ownOf(c, `th-unpin-${n}`).find((e) => e[0] === "on_mouse_down")?.at(-1);
  if (!h) return null;
  let stopped = 0;
  h({ position: { x: 0, y: 0 }, click_count: 1 }, { ...cx, stop_propagation() { stopped++; } });
  return stopped;
};
// A press on pin n's button as gpui delivers it: its press-down, then its own click. The number
// of times the click kept the press there (stop_propagation), or null with no such button. The
// pointer on the button is on its row, so its box is told first (hoverRow) and the pane draws
// again before the press lands, unless hover is false: a press with the pointer at rest since
// the last frame. With a frame given, the press lands on that frame as it is.
const clickButton = (v, cx, n, c = null, { hover = true } = {}) => {
  if (!c) {
    c = frame(v, cx);
    if (hover) { hoverRow(v, cx, n, true, c); c = frame(v, cx); }
  } else if (hover) hoverRow(v, cx, n, true, c);
  const h = ownOf(c, `th-unpin-${n}`).find((e) => e[0] === "on_click")?.at(-1);
  if (!h) return null;
  downButton(cx, n, c);
  let stopped = 0;
  h({ position: { x: 0, y: 0 }, click_count: 1 }, { ...cx, stop_propagation() { stopped++; } });
  return stopped;
};
// Each row's top in the list and its height, by index.
const rowTops = (v) => { const out = []; let top = 0; for (const r of v.rows()) { const h = v.height(r); out.push({ r, top, h }); top += h; } return out; };

test("the Pinned column: a click on a pin's unpin button unpins it and it leaves the list; the press stays on the button, the turn is not opened or selected, and u puts it back", async () => {
  const { v, cx, keyOf } = await threePins(390);
  const [a, b, c] = [0, 1, 2].map(keyOf);
  v.sel = a;
  const n = v.findTurn(b).n;
  expect(clickButton(v, cx, 2)).toBe(1);
  expect(v.isPinned(b)).toBe(false);
  expect(compactPins(v).map((r) => r.key)).toEqual([a, c]);
  expect(v.sel).toBe(a);
  expect(v.open.has(b)).toBe(false);
  expect(v.openWait ?? null).toBe(null);
  cx.flush(1000, 3);
  expect(v.open.has(b)).toBe(false);
  expect(v.sel).toBe(a);
  expect(toastText(v)).toBe(`Unpinned #${n} · u to undo`);
  v.key(keyEv("u"), cx);
  expect(compactPins(v).map((r) => r.key)).toEqual([a, b, c]);
  draw(v, cx);
});

test("the Pinned column: a press through the list never unpins, wherever it lands; it selects: in the button's column at any height, on the selected pin or another, with or without a move, after a scroll, a narrower list, a banner, a move after the press, a release on another row, or under the key sheet", async () => {
  const { v, cx, press, body, ev, keyOf } = await threePins(390);
  const [a, b] = [0, 1].map(keyOf);
  const mid = v.width - PIN_ROW.UNPIN_R - PIN_ROW.UNPIN / 2;
  const kept = () => { expect(v.isPinned(a)).toBe(true); expect(v.isPinned(b)).toBe(true); };
  for (const x of [mid, v.width - PIN_ROW.UNPIN_R - PIN_ROW.UNPIN, v.width - 3]) {
    for (const y of [120, 300, 330]) {
      for (const sel of [null, b]) {
        for (const move of [true, false]) {
          v.sel = sel;
          press(b, x, { move, y });
          kept();
          expect(v.sel).toBe(b);
        }
      }
    }
  }
  // A scroll by key, and another first row drawn: still a selection.
  v.sel = a;
  v.key(keyEv("j"), cx);
  v.sel = null;
  press(b, mid);
  kept();
  H.listWindow = (n) => ({ start: 1, end: n });
  try {
    v.sel = null;
    press(b, mid);
    kept();
  } finally { H.listWindow = null; }
  // A wheel, a narrower list and a banner above it: still a selection.
  v.sel = null;
  v.listWheel({ delta: { x: 0, y: -40 } });
  press(b, mid, { move: false });
  kept();
  v.sel = null;
  let h = body();
  h.move({ ...ev(mid), bounds: { width: (v.width + 20) * v.zoom() } }, cx);
  h.down({ ...ev(mid), bounds: { width: (v.width - 20) * v.zoom() } }, cx);
  v.click(b, cx);
  kept();
  v.sel = null;
  h = body();
  h.move(ev(mid, true, 300), cx);
  h.down({ ...ev(mid, true, 260), position: ev(mid, true, 300).position }, cx);
  v.click(b, cx);
  kept();
  // A move after the press, and a release on another row.
  v.sel = null;
  h = body();
  h.down(ev(mid), cx);
  h.move(ev(mid + 0.5), cx);
  v.click(b, cx);
  kept();
  v.sel = null;
  h = body();
  h.move(ev(mid), cx);
  h.down(ev(mid), cx);
  v.click(a, cx);
  kept();
  expect(v.sel).toBe(a);
  // The key sheet open over the list, with the last press's place left over.
  v.action("keys", cx);
  expect(v.keysOpen).toBe(true);
  v.click(b, cx);
  kept();
  v.action("keys", cx);
});

test("the Pinned column: each closed pin's unpin button is an element of its own over the list, in a box its row's size at its row's place, centred in the row's height and 6 px in from the column's edge: its 24 px box is all that takes the press", async () => {
  const { v, cx } = await threePins(390);
  const L = unpinLayer(v, cx);
  expect(L.has).toBe(true);
  expect(L.rows).toEqual([1, 2, 3]);
  // Over the list, in the reading column as the list's items are.
  const layer = ownOf(L.c, "th-unpins");
  for (const m of ["absolute", "size_full", "justify_center"]) expect(layer.some((e) => e[0] === m)).toBe(true);
  expect(layer.some((e) => e[0] === "max_w" && e[1] === v.width)).toBe(true);
  for (const { r, top, h } of rowTops(v)) {
    if (r.kind !== "turn") continue;
    const box = ownOf(L.c, `th-unpin-row-${r.pinNo}`);
    expect(box).toContainEqual(["top", top]);
    expect(box).toContainEqual(["h", h]);
    // The button's place: the row's full height, items centred, UNPIN_R from the right.
    for (const e of [["absolute"], ["top", 0], ["bottom", 0], ["right", PIN_ROW.UNPIN_R], ["items_center"]]) expect(box).toContainEqual(e);
    const btn = ownOf(L.c, `th-unpin-${r.pinNo}`);
    expect(btn).toContainEqual(["size", PIN_ROW.UNPIN]);
    expect(PIN_ROW.UNPIN).toBe(24);
    expect(PIN_ROW.UNPIN_R).toBe(6);
  }
  // No other element of the layer takes a press or a drag, and the button's press-down only
  // notes (it stops nothing): a drag that starts on a button, as one on the divider beside the
  // column can, is not held by it, and the button's click needs the press and the release on it.
  const takes = (c) => c.filter((e) => /^on_(mouse_down|mouse_up|drag|click|item)/.test(e[0])).map((e) => e[0]);
  expect(takes(layer)).toEqual([]);
  expect(takes(ownOf(L.c, "th-unpin-row-2"))).toEqual([]);
  expect(takes(ownOf(L.c, "th-unpin-2"))).toEqual(["on_mouse_down", "on_click"]);
  // The list's own item has no button any more: nothing in it takes the press as an unpin.
  expect(itemWords(v, compactPins(v)[1]).some((e) => e[0] === "id" && e[1] === "th-unpin-2")).toBe(false);
});

test("the Pinned column: no unpin buttons where a row's place on screen is not known for sure, or where nothing should take the press: a list taller than its box (at the top, at the end, after a wheel past the end), a row the list did not draw last, an open pin, under the key sheet or the settings card, outside the Pinned view; and a button drawn before the sheet opened does nothing under it", async () => {
  const { v, cx, keyOf } = await threePins(390);
  expect(unpinLayer(v, cx).rows).toEqual([1, 2, 3]);
  const total = rowTops(v).reduce((s, x) => s + x.h, 0);
  // Exactly its box: the list cannot scroll, so each row is where its heights put it.
  v.listH = total;
  expect(unpinLayer(v, cx).rows).toEqual([1, 2, 3]);
  // Taller than its box, so the list scrolls and Herdr gives no read of where it is: none.
  v.listH = total - 10;
  v.listOff = 0;
  expect(unpinLayer(v, cx).has).toBe(false);
  v.listOff = 10;
  expect(unpinLayer(v, cx).has).toBe(false);
  v.listWheel({ delta: { x: 0, y: -5000 } });
  expect(unpinLayer(v, cx).has).toBe(false);
  v.listWheel({ delta: { x: 0, y: 5000 } });
  expect(unpinLayer(v, cx).has).toBe(false);
  // Not measured yet (a box of 0): none.
  v.listH = 0;
  expect(unpinLayer(v, cx).has).toBe(false);
  v.listH = 700;
  v.listOff = 0;
  expect(unpinLayer(v, cx).rows).toEqual([1, 2, 3]);
  // The list drew only its first two items (the day band and pin 1): pins 2 and 3 have none.
  // A change in the rows drawn asks for another frame (the 120 ms timer), so the buttons
  // follow it.
  H.listWindow = () => ({ start: 0, end: 2 });
  try {
    expect(unpinLayer(v, cx).rows).toEqual([1]);
  } finally { H.listWindow = null; }
  // The day band scrolled off (all three pins still drawn, the list's end still on screen):
  // only the change in the rows drawn asks for the frame; the same rows again do not.
  H.listWindow = (n) => ({ start: 1, end: n });
  try {
    frame(v, cx);
    v.stickyDue = false;
    frame(v, cx);
    expect(v.stickyDue).toBe(false);
  } finally { H.listWindow = null; }
  v.stickyDue = false;
  expect(unpinLayer(v, cx).rows).toEqual([1, 2, 3]);
  expect(v.stickyDue).toBe(true);
  expect(unpinLayer(v, cx).rows).toEqual([1, 2, 3]);
  // An open pin is the full card, with its own pin: no button over it.
  const k2 = keyOf(1);
  v.toggle(k2, cx);
  expect(unpinLayer(v, cx).rows).toEqual([1, 3]);
  v.toggle(k2, cx);
  expect(unpinLayer(v, cx).rows).toEqual([1, 2, 3]);
  // The key sheet and the settings card cover the list: none.
  v.action("keys", cx);
  expect(unpinLayer(v, cx).has).toBe(false);
  v.action("keys", cx);
  v.settingsOpen = true;
  expect(unpinLayer(v, cx).has).toBe(false);
  v.settingsOpen = false;
  // A button's click from a frame drawn before the sheet opened: nothing.
  const before = frame(v, cx);
  v.action("keys", cx);
  expect(clickButton(v, cx, 2, before)).toBe(1);
  expect(v.isPinned(k2)).toBe(true);
  expect(compactPins(v).length).toBe(3);
  v.action("keys", cx);
  // The list's own view: none, and a button's click from a frame drawn before it does nothing.
  const inPinned = frame(v, cx);
  v.key(keyEv("v"), cx);
  expect(v.view).not.toBe("pinned");
  expect(unpinLayer(v, cx).has).toBe(false);
  expect(clickButton(v, cx, 2, inPinned)).toBe(1);
  expect(v.isPinned(k2)).toBe(true);
});

test("the Pinned column: the unpin buttons follow the rows' heights when they change: a pin opened above, a narrower column that wraps the titles, and back", async () => {
  const { v, cx, keyOf } = await threePins(390);
  const check = () => {
    const L = unpinLayer(v, cx);
    for (const { r, top, h } of rowTops(v)) {
      if (r.kind !== "turn" || !r.compact) continue;
      const box = ownOf(L.c, `th-unpin-row-${r.pinNo}`);
      expect(box).toContainEqual(["top", top]);
      expect(box).toContainEqual(["h", h]);
    }
    return L.rows;
  };
  const tops0 = rowTops(v).filter((x) => x.r.kind === "turn").map((x) => x.top);
  expect(check()).toEqual([1, 2, 3]);
  const k1 = keyOf(0);
  v.toggle(k1, cx);
  expect(check()).toEqual([2, 3]);
  const tops1 = rowTops(v).filter((x) => x.r.kind === "turn" && x.r.compact).map((x) => x.top);
  expect(tops1[0]).toBeGreaterThan(tops0[1]);
  v.toggle(k1, cx);
  expect(check()).toEqual([1, 2, 3]);
  v.width = 240;
  const tops2 = rowTops(v).filter((x) => x.r.kind === "turn").map((x) => x.top);
  expect(tops2[2]).toBeGreaterThan(tops0[2]);
  expect(check()).toEqual([1, 2, 3]);
  v.width = 400;
  expect(check()).toEqual([1, 2, 3]);
});

// gpui's click as it reaches the elements under the pointer, topmost first: each one's click
// runs until one stops it. The handlers given are the on_click ones, top to bottom.
const clickThrough = (cx, handlers) => {
  let stopped = false;
  const scx = { ...cx, stop_propagation() { stopped = true; } };
  for (const h of handlers) { h({ position: { x: 0, y: 0 }, click_count: 1 }, scx); if (stopped) return true; }
  return false;
};

test("the undo notice and the Jump to latest pill take the click: it stops on them, so nothing under them, a pin's button or a row, gets it; the press-down goes on to the pane, so Herdr still focuses it, and no unpin control stops it either", async () => {
  const { v, cx, keyOf } = await threePins(390);
  v.sel = keyOf(1);
  v.key(keyEv("p"), cx);
  expect(toastText(v)).toMatch(/^Unpinned/);
  hoverRow(v, cx, 1); // the pointer on pin 1's row, under the notice
  const c = frame(v, cx);
  const toast = ownOf(c, "th-toast");
  expect(toast.some((e) => e[0] === "on_mouse_down")).toBe(false);
  const click = toast.find((e) => e[0] === "on_click")?.at(-1);
  expect(typeof click).toBe("function");
  // A click on the notice over pin 1's button: the notice's click stops it, the button's never runs.
  const btn = ownOf(c, "th-unpin-1").find((e) => e[0] === "on_click")?.at(-1);
  expect(typeof btn).toBe("function");
  // The press-down reaches the button under the notice too (the notice does not stop it).
  expect(downButton(cx, 1, c)).toBe(0);
  expect(clickThrough(cx, [click, btn])).toBe(true);
  expect(v.isPinned(keyOf(0))).toBe(true);
  // Without the notice the same click reaches the button and unpins (the model is not empty).
  const k0 = keyOf(0);
  expect(downButton(cx, 1, c)).toBe(0);
  expect(clickThrough(cx, [btn])).toBe(true);
  expect(v.isPinned(k0)).toBe(false);
  v.key(keyEv("u"), cx);
  // No unpin control stops the press-down: the rows' buttons only note it, their boxes and the
  // header's take none.
  const c2 = frame(v, cx);
  const ids = c2.filter((e) => e[0] === "id" && /^th-unpin/.test(e[1])).map((e) => e[1]);
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    if (/^th-unpin-\d+$/.test(id)) expect(downButton(cx, Number(id.slice(9)), c2)).toBe(0);
    else expect(ownOf(c2, id).some((e) => e[0] === "on_mouse_down")).toBe(false);
  }
  H.rec = []; v.header(theme); const h = rec; H.rec = null;
  expect(ownOf(h, "th-pin").some((e) => e[0] === "on_click")).toBe(true);
  expect(ownOf(h, "th-pin").some((e) => e[0] === "on_mouse_down")).toBe(false);
  // The pill, in the list's own view.
  const p = await pinPane("--extra", "6");
  H.listWindow = (n) => ({ start: 0, end: n - 1 }); // the list's end off screen
  let pill;
  try {
    frame(p.v, p.cx);
    expect(p.v.pillShown()).toBe(true);
    pill = ownOf(frame(p.v, p.cx), "th-latest-pill");
  } finally { H.listWindow = null; }
  expect(pill.some((e) => e[0] === "on_mouse_down")).toBe(false);
  let s2 = 0;
  pill.find((e) => e[0] === "on_click").at(-1)({ position: { x: 0, y: 0 } }, { ...p.cx, stop_propagation() { s2++; } });
  expect(s2).toBe(1);
});

test("the Pinned column: a press on a pin anywhere but its unpin control still selects it and keeps the pin", async () => {
  const { v, cx, press, keyOf } = await threePins(60);
  const b = keyOf(1);
  press(b);
  expect(v.isPinned(b)).toBe(true);
  expect(v.sel).toBe(b);
  // Just left of the control, too.
  const c = keyOf(2);
  press(c, v.width - PIN_ROW.PAD_X - PIN_ROW.UNPIN - 4);
  expect(v.isPinned(c)).toBe(true);
  expect(v.sel).toBe(c);
  // An open pin is the full card: its own pin does that, not the row's right edge.
  v.toggle(c, cx);
  press(c, v.width - 8);
  expect(v.isPinned(c)).toBe(true);
  draw(v, cx);
});

test("the Pinned column: the unpin button is the heading's button, shown while the pointer is on its row and on the selected pin, and the row's text stays put", async () => {
  const { v, cx, keyOf } = await threePins(390);
  const rows = compactPins(v);
  const r = rows[1];
  v.sel = rows[0].key;
  const c0 = frame(v, cx);
  // Clear at rest, with no hover style of gpui's: the pane draws it (pinHover).
  expect(ownOf(c0, "th-unpin-row-2").filter((e) => e[0] === "text_color").map((e) => e[1])).toEqual(["#00000000"]);
  expect(ownOf(c0, "th-unpin-row-2").some((e) => e[0] === "hover")).toBe(false);
  expect(ownOf(c0, "th-unpin-2").some((e) => e[0] === "hover" || e[0] === "cursor_pointer")).toBe(false);
  hoverRow(v, cx, 2, true, c0);
  const c = frame(v, cx);
  const box = ownOf(c, "th-unpin-row-2");
  const own = ownOf(c, "th-unpin-2");
  // As the heading's buttons (iconButton): 24 px, radius 5, a 14 px icon, the hover fill and a tooltip.
  for (const [m, x] of [["size", 24], ["rounded", 5]]) expect(own.some((e) => e[0] === m && e[1] === x)).toBe(true);
  expect(svgs(own)).toEqual(["pin-off.svg"]);
  expect(own.some((e) => e[0] === "size" && e[1] === 14)).toBe(true);
  expect(own.some((e) => e[0] === "bg" && e[1] === theme.hover)).toBe(true);
  expect(own.some((e) => e[0] === "cursor_pointer")).toBe(true);
  expect(own.filter((e) => e[0] === "tooltip").map((e) => e[1])).toEqual([`Unpin #${r.turn.n}`]);
  expect(own.filter((e) => e[0] === "text_color").map((e) => e[1])).toEqual([theme.foreground]); // its own hover
  // With the pointer on its row, its box is dim, which the button takes, and still has no
  // hover style of gpui's.
  expect(box.filter((e) => e[0] === "text_color").map((e) => e[1])).toEqual([theme.dim]);
  expect(box.some((e) => e[0] === "hover" || e[0] === "bg")).toBe(false);
  // The selected pin shows it at rest, with p in its tooltip.
  hoverRow(v, cx, 2, false, c);
  v.sel = r.key;
  const c2 = frame(v, cx);
  expect(ownOf(c2, "th-unpin-row-2").filter((e) => e[0] === "text_color").map((e) => e[1])).toEqual([theme.dim]);
  expect(ownOf(c2, "th-unpin-2").filter((e) => e[0] === "tooltip").map((e) => e[1])).toEqual([`Unpin #${r.turn.n} (p)`]);
  // The row keeps its hover fill, and its own text colours: the button is not in it.
  const rest = itemWords(v, rows[2]);
  expect(rest.some((e) => e[0] === "id" && /^th-unpin/.test(String(e[1])))).toBe(false);
  const head = rest.slice(rest.findIndex((e) => e[0] === "px" && e[1] === PIN_ROW.PAD_X));
  expect(head.some((e) => e[0] === "bg" && e[1] === theme.hover)).toBe(true);
  expect(head.some((e) => e[0] === "text_color" && e[1] === "#00000000")).toBe(false);
  // The same layout selected or not, and the text keeps clear of the button: the lines' column
  // leaves its room, and the prompt is cut for the row's width less that room.
  const layout = (x) => x.filter((e) => ["px", "pt", "pb", "pr", "pl", "w", "mr", "gap", "absolute", "right", "top", "bottom"].includes(e[0])).map((e) => e.join(" "));
  v.sel = null;
  const off = itemWords(v, r);
  v.sel = r.key;
  expect(layout(itemWords(v, r))).toEqual(layout(off));
  expect(off.some((e) => e[0] === "pr" && e[1] === PIN_ROW.UNPIN_ROOM)).toBe(true);
  const textW = 300 - 2 * PIN_ROW.PAD_X - PIN_ROW.BADGE - PIN_ROW.GAP_X - PIN_ROW.UNPIN_ROOM;
  const long = pinRowShape({ prompt: "ab ".repeat(200), reply: "cd ".repeat(200), width: 300 });
  expect(long.prompt[0].length).toBeLessThanOrEqual(Math.floor(textW / ROW.PROMPT_CHAR));
  expect(long.prompt[0].length).toBeGreaterThan(Math.floor(textW / ROW.PROMPT_CHAR) - 3);
  expect(long.reply.length).toBeLessThanOrEqual(Math.floor(textW / (ROW.REPLY_CHAR * (PIN_ROW.REPLY_SIZE / 13))) + 1);
  expect({ prompt: r.shape.prompt, reply: r.shape.reply, height: r.shape.height }).toEqual(pinRowShape({ prompt: pinPromptText(r.turn.prompt), reply: r.shape.reply, width: v.width }));
  // No Tab stop: the heading's buttons have none either.
  const focusable = (x) => x.some((e) => ["track_focus", "tab_index", "tab_stop", "focusable"].includes(e[0]));
  expect(focusable(own)).toBe(false);
  expect(focusable(box)).toBe(false);
  void keyOf;
});

test("in the list, a press at the right edge of a pinned turn's row is a press on the turn: only the Pinned view's rows have the control", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  const k = keys()[1];
  v.sel = k;
  v.action("pin", cx);
  v.sel = null;
  v.pressX = v.width - 8;
  v.bodyW = v.width;
  v.click(k, cx);
  expect(v.isPinned(k)).toBe(true);
  expect(v.sel).toBe(k);
});

test("the Pinned column: p on a selected pin still unpins it, and u puts it back", async () => {
  const { v, cx, keyOf } = await threePins(390);
  const b = keyOf(1);
  v.sel = b;
  v.key(keyEv("p"), cx);
  expect(v.isPinned(b)).toBe(false);
  expect(toastText(v)).toMatch(/^Unpinned #\d+ · u to undo$/);
  v.key(keyEv("u"), cx);
  expect(v.isPinned(b)).toBe(true);
});

test("the Pinned column: no unpin buttons while the Turn card is open, with one pin open and the list still fitting; a button drawn before the card opened only closes it, as any press outside the card does", async () => {
  const { v, cx, keyOf } = await threePins(390);
  const [a, b] = [0, 1].map(keyOf);
  v.toggle(a, cx);
  v.sel = a;
  expect(unpinLayer(v, cx).rows).toEqual([2, 3]);
  const before = frame(v, cx);
  expect(v.action("legend", cx)).toBe(true);
  expect(v.detailsOpen).toBe(true);
  // The list still fits its box, so only the card hides the closed pins' buttons.
  expect(rowTops(v).reduce((s, x) => s + x.h, 0)).toBeLessThanOrEqual(v.listH);
  expect(unpinLayer(v, cx).has).toBe(false);
  // The button from the frame before the card: the press closes the card and keeps the pin.
  expect(clickButton(v, cx, 2, before)).toBe(1);
  expect(v.detailsOpen).toBe(false);
  expect(v.isPinned(b)).toBe(true);
  expect(toastText(v) ?? "").not.toMatch(/^Unpinned/);
  // Closed again: the buttons are back.
  expect(unpinLayer(v, cx).rows).toEqual([2, 3]);
});

test("the Pinned column: the pane draws a row's unpin button while the pointer is on the row (its box's hover) and on the selected pin, in the plain colour; enter and leave in either order; leaving the pane, the layer going or the row opening clears it; a redraw only on a change", async () => {
  const { v, cx, keyOf } = await threePins(390);
  const [a, b] = [0, 1].map(keyOf);
  v.sel = a;
  let n = 0;
  const ncx = { ...cx, notify() { n++; } };
  expect(drawnRows(v, cx)).toEqual([1]);
  expect(hoverRow(v, ncx, 2)).toBe(true);
  expect(drawnRows(v, cx)).toEqual([1, 2]);
  expect(n).toBe(1);
  hoverRow(v, ncx, 2);
  expect(n).toBe(1);
  // Onto row 3 before row 2's leave: row 2's leave does not clear row 3.
  hoverRow(v, ncx, 3);
  hoverRow(v, ncx, 2, false);
  expect(drawnRows(v, cx)).toEqual([1, 3]);
  expect(n).toBe(2);
  hoverRow(v, ncx, 3, false);
  expect(drawnRows(v, cx)).toEqual([1]);
  expect(n).toBe(3);
  // A drawn button has the hover fill and the hand; one not drawn has neither.
  hoverRow(v, cx, 2);
  const c = frame(v, cx);
  expect(ownOf(c, "th-unpin-2").some((e) => e[0] === "cursor_pointer")).toBe(true);
  expect(ownOf(c, "th-unpin-3").some((e) => e[0] === "cursor_pointer" || e[0] === "hover")).toBe(false);
  // The pointer leaves the pane (the root's hover ends): no row has it.
  handlerAfterId(c, "threads-root", "on_hover")(false, ncx);
  expect(drawnRows(v, cx)).toEqual([1]);
  // The layer goes (a card over the list) and comes back: no row has it.
  hoverRow(v, cx, 2);
  v.settingsOpen = true;
  expect(unpinLayer(v, cx).has).toBe(false);
  v.settingsOpen = false;
  expect(drawnRows(v, cx)).toEqual([1]);
  // Its row opens (no button) and closes: no row has it.
  hoverRow(v, cx, 2);
  v.toggle(b, cx);
  frame(v, cx);
  v.toggle(b, cx);
  v.sel = a;
  expect(drawnRows(v, cx)).toEqual([1]);
  // The boxes and buttons take no move of their own.
  const c2 = frame(v, cx);
  for (const id of c2.filter((e) => e[0] === "id" && /^th-unpin/.test(e[1])).map((e) => e[1])) {
    expect(ownOf(c2, id).some((e) => e[0] === "on_mouse_move")).toBe(false);
  }
});

// The pointer rests on pin 2's row, then something that is not a pointer move happens (go),
// then a press on the spot: pin 2's button is still drawn and the press unpins it.
async function restThenPress(go) {
  const { v, cx, keyOf } = await threePins(390);
  const [a, b] = [0, 1].map(keyOf);
  v.sel = a;
  hoverRow(v, cx, 2);
  go(v, cx);
  v.sel = a;
  expect(drawnRows(v, cx)).toEqual([1, 2]);
  expect(clickButton(v, cx, 2, frame(v, cx), { hover: false })).toBe(1);
  expect(v.isPinned(b)).toBe(false);
  expect(toastText(v)).toMatch(/^Unpinned/);
}

test("the Pinned column: a key the pane gets (key()) while the pointer rests on a pin's row leaves its button drawn, and a press on it unpins", async () => {
  await restThenPress((v, cx) => v.key(keyEv("j"), cx));
});

test("the Pinned column: a mod command (a keys.json binding, command()) while the pointer rests on a pin's row leaves its button drawn, and a press on it unpins", async () => {
  await restThenPress((v, cx) => v.command("latest", cx));
});

test("the Pinned column: a key the pane never sees (another pane's, Herdr's own) while the pointer rests on a pin's row leaves its button drawn, and a press on it unpins", async () => {
  await restThenPress(() => {});
});

test("the Pinned column: a press on a button the pane did not draw selects its pin and keeps it, and a second press on the spot unpins it; a row that moved under the pointer at rest has no button drawn", async () => {
  const { v, cx, keyOf } = await threePins(390);
  const [a, b, c] = [0, 1, 2].map(keyOf);
  v.sel = a;
  hoverRow(v, cx, 3);
  expect(drawnRows(v, cx)).toEqual([1, 3]);
  // Pin 2's button, not drawn: the press selects pin 2 and keeps it.
  expect(clickButton(v, cx, 2, frame(v, cx), { hover: false })).toBe(1);
  expect(v.isPinned(b)).toBe(true);
  expect(v.sel).toBe(b);
  expect(toastText(v) ?? "").not.toMatch(/^Unpinned/);
  // Selected, it is drawn: the next press on the spot unpins it.
  expect(drawnRows(v, cx)).toContain(2);
  expect(clickButton(v, cx, 2, frame(v, cx), { hover: false })).toBe(1);
  expect(v.isPinned(b)).toBe(false);
  v.key(keyEv("u"), cx);
  // The pointer on pin 2's row unpins it there; pin 3 moves up under the pointer at rest, with
  // no enter of its own: no button is drawn on it, and a press there selects it.
  v.sel = a;
  expect(clickButton(v, cx, 2)).toBe(1);
  expect(v.isPinned(b)).toBe(false);
  expect(compactPins(v)[1].key).toBe(c);
  expect(drawnRows(v, cx)).toEqual([1]);
  expect(clickButton(v, cx, 2, frame(v, cx), { hover: false })).toBe(1);
  expect(v.isPinned(c)).toBe(true);
  expect(v.sel).toBe(c);
  // A click whose own press-down the button did not get (another pin's, or none) goes by no
  // record: it selects, even on a drawn button.
  v.sel = a;
  hoverRow(v, cx, 2);
  const f = frame(v, cx);
  const click2 = ownOf(f, "th-unpin-2").find((e) => e[0] === "on_click").at(-1);
  downButton(cx, 1, f);
  click2({ position: { x: 0, y: 0 }, click_count: 1 }, { ...cx, stop_propagation() {} });
  expect(v.isPinned(c)).toBe(true);
  expect(v.sel).toBe(c);
  v.sel = a;
  click2({ position: { x: 0, y: 0 }, click_count: 1 }, { ...cx, stop_propagation() {} });
  expect(v.isPinned(c)).toBe(true);
  expect(v.sel).toBe(c);
});

// The rows' heights as the list takes them, with a count of the walks over them (each for...of)
// and of the heights read one by one (by index, as a for loop or reduce reads them).
const walkedSlots = (v) => {
  const n = { walks: 0, reads: 0 };
  const slots = new Proxy(v.rows().map((r) => v.height(r)), {
    get(t, k) {
      if (k === Symbol.iterator) n.walks++;
      else if (typeof k === "string" && /^\d+$/.test(k)) n.reads++;
      return Reflect.get(t, k);
    },
  });
  return { slots, n };
};

test("outside the Pinned view the rows' unpin buttons cost nothing a frame: a long Chat has no button layer, and its rows' heights are not summed for one", async () => {
  // In the Pinned view (the same pane's switch) the heights are summed: the count sees it.
  const { v: pv, cx: pcx } = await threePins(390);
  expect(pv.view).toBe("pinned");
  frame(pv, pcx); // the rows the list drew
  const a = walkedSlots(pv);
  expect(pv.pinButtonRows(pv.rows(), a.slots).length).toBeGreaterThan(0);
  expect(a.n.walks).toBe(1);
  expect(a.n.reads).toBeGreaterThan(0);
  // A long Chat, a list taller than its box or not: no buttons, and no walk over its rows.
  const { v, cx } = await pinPane("--extra", "400");
  // Its rows are all built before anything is counted: the build runs in timed slices, and on a
  // loaded machine the first frames hold only part of them.
  settleRows(v, cx);
  expect(v.view).toBe("all");
  expect(v.rows().length).toBeGreaterThan(400);
  for (const listH of [700, 1e9]) {
    v.listH = listH;
    const b = walkedSlots(v);
    expect(v.pinButtonRows(v.rows(), b.slots)).toEqual([]);
    expect(b.n.walks).toBe(0);
    expect(b.n.reads).toBe(0);
    expect(unpinLayer(v, cx).has).toBe(false);
  }
  // Back from the Pinned view in the same pane, the same.
  pv.key(keyEv("v"), pcx);
  expect(pv.view).toBe("all");
  const c = walkedSlots(pv);
  expect(pv.pinButtonRows(pv.rows(), c.slots)).toEqual([]);
  expect(c.n.walks).toBe(0);
  expect(c.n.reads).toBe(0);
});

// The pointer rests on a row (n), a key moves the rows under it (go), and a press with no move:
// its press-down lands on the frame drawn after the key, then gpui (back in pointer mode)
// repaints and the row now under the pointer gets an enter, then the release.
function pressAfterShift(v, cx, n, go) {
  hoverRow(v, cx, n);
  go();
  const c = frame(v, cx);
  downButton(cx, n, c);
  hoverRow(v, cx, n, true, frame(v, cx));
  // The release lands on the frame gpui draws after that enter.
  const h = ownOf(frame(v, cx), `th-unpin-${n}`).find((e) => e[0] === "on_click")?.at(-1);
  let stopped = 0;
  h({ position: { x: 0, y: 0 }, click_count: 1 }, { ...cx, stop_propagation() { stopped++; } });
  return stopped;
}

test("the Pinned column: p unpins the selected pin above a resting pointer and the rows move up: a press there, with no move, selects the pin now under it and keeps it, though the repaint after the press-down gives that row an enter", async () => {
  const { v, cx, keyOf } = await threePins(390);
  const [a, b, c] = [0, 1, 2].map(keyOf);
  v.sel = a;
  expect(pressAfterShift(v, cx, 2, () => {
    v.key(keyEv("p"), cx);
    expect(v.isPinned(a)).toBe(false);
    // b moved up under no pointer and is still the hovered pin; c is under the pointer.
    expect(compactPins(v).map((r) => r.key)).toEqual([b, c]);
    expect(drawnRows(v, cx)).toEqual([1]);
  })).toBe(1);
  expect(v.isPinned(c)).toBe(true);
  expect(v.sel).toBe(c);
  expect(toastText(v)).toMatch(/^Unpinned #/);
  expect(v.isPinned(b)).toBe(true);
});

test("the Pinned column: u puts a pin back above a resting pointer and the rows move down: a press there, with no move, selects the pin now under it and keeps it, though the repaint after the press-down gives that row an enter", async () => {
  const { v, cx, keyOf } = await threePins(390);
  const [a, b, c] = [0, 1, 2].map(keyOf);
  v.sel = a;
  v.key(keyEv("p"), cx);
  expect(compactPins(v).map((r) => r.key)).toEqual([b, c]);
  v.sel = c;
  expect(pressAfterShift(v, cx, 1, () => {
    v.key(keyEv("u"), cx);
    expect(v.isPinned(a)).toBe(true);
    // a is back under the pointer with no enter of its own; b, still the hovered pin, moved down.
    expect(compactPins(v).map((r) => r.key)).toEqual([a, b, c]);
    expect(v.sel).not.toBe(a);
    expect(drawnRows(v, cx)).not.toContain(1);
  })).toBe(1);
  expect(v.isPinned(a)).toBe(true);
  expect(v.sel).toBe(a);
  expect(toastText(v) ?? "").not.toMatch(/^Unpinned/);
});

// The header's unpin button in a frame of the header: its own calls, and its click as gpui
// delivers it (the number of times it kept the press, or null with no click).
const headerUnpin = (v, cx) => {
  H.rec = []; v.header(theme); const h = rec; H.rec = null;
  const own = h.some((e) => e[0] === "id" && e[1] === "th-pin") ? ownOf(h, "th-pin") : null;
  const click = () => {
    const f = own?.find((e) => e[0] === "on_click")?.at(-1);
    if (!f) return null;
    let stopped = 0;
    f({ position: { x: 0, y: 0 }, click_count: 1 }, { ...cx, stop_propagation() { stopped++; } });
    return stopped;
  };
  return { own, click, data: v.headerButtons().find((b) => b[0] === "th-pin") ?? null };
};

test("the Pinned view's header unpin: shown while the Pinned view is up, it unpins the selected pin with one click even while the list scrolls and the rows' buttons hide; with none selected it stays, dimmed and inert", async () => {
  const { v, cx } = await pinsShown(["--only", "7", "--gap", "86400"], [0, 1, 2, 3, 4, 5, 6], 390);
  const pins = compactPins(v);
  expect(pins.map((r) => r.pinNo)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  // A short window: the list scrolls, so the rows have no unpin buttons.
  v.listH = 200;
  expect(unpinLayer(v, cx).has).toBe(false);
  const [a, b] = [pins[1].key, pins[4].key];
  v.sel = a;
  const n = v.findTurn(a).n;
  let u = headerUnpin(v, cx);
  expect(u.data.slice(1, 9)).toEqual(["pin-off", `Unpin #${n} (p)`, "unpinSel", false, null, null, false, false]);
  expect(svgs(u.own)).toEqual(["pin-off.svg"]);
  expect(u.own.filter((e) => e[0] === "tooltip").map((e) => e[1])).toEqual([`Unpin #${n} (p)`]);
  expect(u.own.some((e) => e[0] === "cursor_pointer")).toBe(true);
  expect(u.own.some((e) => e[0] === "opacity")).toBe(false);
  // Its own unpin, not p's action: a rail card the pointer rests on is not what it unpins.
  v.railHover = b;
  v.railShown = () => true;
  expect(u.click()).toBe(1);
  expect(v.isPinned(a)).toBe(false);
  expect(v.isPinned(b)).toBe(true);
  expect(toastText(v)).toBe(`Unpinned #${n} · u to undo`);
  v.railHover = null;
  v.key(keyEv("u"), cx);
  expect(v.isPinned(a)).toBe(true);
  // None selected (nothing, a key gone from the list, or a turn that is not a pin): in its
  // place, dimmed, with no hover fill or pointer, and a press does nothing.
  for (const sel of [null, "9:9:9", `${pins[0].key.split(":")[0]}:999`]) {
    v.sel = sel;
    u = headerUnpin(v, cx);
    expect(u.data.slice(1, 9)).toEqual(["pin-off", "Select a pin to unpin it (p)", "unpinSel", false, null, null, false, true]);
    expect(u.own.filter((e) => e[0] === "tooltip").map((e) => e[1])).toEqual(["Select a pin to unpin it (p)"]);
    expect(u.own.some((e) => e[0] === "opacity")).toBe(true);
    expect(u.own.some((e) => e[0] === "cursor_pointer")).toBe(false);
    expect(u.own.some((e) => e[0] === "bg" && e[1] === theme.hover)).toBe(false);
    v.toast = null;
    expect(u.click()).toBe(1);
    expect(compactPins(v).length).toBe(7);
    expect(toastText(v)).toBe(null);
  }
  // Under the settings card or the key sheet it does nothing.
  v.sel = a;
  u = headerUnpin(v, cx);
  for (const open of ["settingsOpen", "keysOpen"]) {
    v[open] = true;
    expect(u.click()).toBe(1);
    expect(v.isPinned(a)).toBe(true);
    v[open] = false;
  }
  // Under the Turn card, a press closes the card and does nothing else, as one in the list does.
  v.detailsOpen = true;
  expect(u.click()).toBe(1);
  expect(v.detailsOpen).toBe(false);
  expect(v.isPinned(a)).toBe(true);
  // With p as the quote key, its tooltips name no key.
  v.quoteKey = "p";
  expect(headerUnpin(v, cx).data[2]).toBe(`Unpin #${n}`);
  v.sel = null;
  expect(headerUnpin(v, cx).data[2]).toBe("Select a pin to unpin it");
  v.quoteKey = "q";
  // The Pinned view in the same pane under 300 px keeps its room for the count: no unpin
  // there (p unpins), and the count in full.
  v.width = 260;
  expect(headerUnpin(v, cx).own).toBe(null);
  expect(v.headerText()).toBe("7 of 7");
  // The Pinned pane under 300 px keeps it, with the count shortened to fit beside it.
  v.pinnedPane = true;
  v.sel = a;
  for (const width of [240, 260, 299]) {
    v.width = width;
    expect(v.headerButtons().map((b) => b[0])).toEqual(["th-pin", "th-pinned"]);
    expect(v.headerText()).toBe("7/7");
    expect(headerUnpin(v, cx).click()).toBe(1);
    expect(v.isPinned(a)).toBe(false);
    v.key(keyEv("u"), cx);
    expect(v.isPinned(a)).toBe(true);
  }
  v.width = 300;
  expect(v.headerText()).toBe("7 of 7");
  v.pinnedPane = false;
});
