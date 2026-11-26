// bun test: a click on a closed pin or a closed turn opens it, with the pointer's events in the
// order Herdr delivers them, on the render harness (test/render-harness.js). By Herdr's source
// (gpui at v0.1.17 and v0.1.18): the press goes to the list's body (threads-body on_mouse_down),
// the item's click comes on the release over the same item (the list's on_item_click), and the
// body hears every move of the pointer over it (on_mouse_move), the button held or not. The turn
// opens OPEN_WAIT_MS after the release (afterPress). The owner's report (2026-11-26): a click on
// a closed pin in the Pinned column showed only its summary; the pin never opened. The Pinned
// column draws the same Pinned view as the narrow pane here (pinnedRows, the same click).
import { test, expect } from "bun:test";

import { afterPress, fixture, frame, handlerAfterId, pane, pinsShown, setup } from "./render-harness.js";

setup();

// The list's own handlers in a frame: the body's press and moves, and the list's item click.
function pointer(v, cx) {
  const c = frame(v, cx);
  const at = c.findIndex((e) => e[0] === "id" && e[1] === "threads-listbox");
  const item = c.slice(at).find((e) => e[0] === "on_item_click")?.at(-1);
  return { move: handlerAfterId(c, "threads-body", "on_mouse_move"), down: handlerAfterId(c, "threads-body", "on_mouse_down"), item };
}
const ev = (v, p, count = 1) => ({ position: p, local_position: p, bounds: { width: v.width * v.zoom(), height: 700 }, modifiers: {}, button: "left", click_count: count });
// A click as Herdr delivers it: the pointer comes onto the row, the press, the moves while the
// button is held (held), the release (the item's click), then the pointer's moves after the
// release (after), told by the frame drawn after the click, as the release redraws the pane.
function click(v, cx, key, { at = { x: 150, y: 300 }, held = [], after = [], count = 1 } = {}) {
  const h = pointer(v, cx);
  expect([typeof h.move, typeof h.down, typeof h.item]).toEqual(["function", "function", "function"]);
  h.move(ev(v, at), cx);
  h.down(ev(v, at, count), cx);
  for (const p of held) h.move(ev(v, p), cx);
  h.item(key, cx);
  const next = pointer(v, cx);
  for (const p of after) next.move(ev(v, p), cx);
}
// The rows a pin or turn draws: "pin" for a closed pin's compact row, else each row's kind (as
// in render.test.js, "a compact pin opens as a card").
const kinds = (v, key) => v.rows().filter((r) => r.key === key || r.key?.endsWith?.(`:${key}`)).map((r) => (r.compact ? "pin" : r.kind));
// The pointer after the release: still, a little down the row, and on to the next pane.
const AFTER = [[], [{ x: 150, y: 302 }, { x: 150, y: 340 }], [{ x: 220, y: 330 }, { x: 420, y: 620 }]];

test("the Pinned view: a click on a closed pin opens it as the full card a moment later, also when the pointer moves on after the release", async () => {
  const { v, cx } = await pinsShown(["--extra", "6"], [1, 3, 5]);
  v.listH = 700;
  const keys = v.pinnedList().map((p) => p.key);
  expect(keys.length).toBe(3);
  for (const after of AFTER) {
    for (const key of keys) {
      if (v.open.has(key)) v.toggle(key, cx);
      expect(kinds(v, key)).toEqual(["pin"]);
      v.sel = null;
      cx.timers = [];
      click(v, cx, key, { after });
      expect([v.sel, v.open.has(key)]).toEqual([key, false]);
      afterPress(cx);
      expect(v.open.has(key)).toBe(true);
      expect(kinds(v, key)).toContain("head");
      expect(kinds(v, key)).not.toContain("pin");
      // Moving the pointer after a click lifts no fill: no text was selected.
      expect(v.textSel ?? null).toBe(null);
      v.toggle(key, cx);
    }
  }
});

test("the list: a click on a closed turn opens it a moment later, and a click on the open turn closes it, also when the pointer moves on after the release", async () => {
  const { v, cx } = await pane(fixture("--extra", "6"));
  v.listH = 700;
  const keys = v.turnKeys(v.rows()).filter((k) => v.rows().find((r) => r.key === k)?.kind === "turn").slice(0, 3);
  expect(keys.length).toBe(3);
  for (const after of AFTER) {
    for (const key of keys) {
      if (v.open.has(key)) v.toggle(key, cx);
      v.sel = null;
      cx.timers = [];
      click(v, cx, key, { after });
      expect([v.sel, v.open.has(key)]).toEqual([key, false]);
      afterPress(cx);
      expect(v.open.has(key)).toBe(true);
      expect(v.textSel ?? null).toBe(null);
      // A click on the open turn closes it at once; the pointer going on after it lifts no fill.
      click(v, cx, key, { after });
      expect([v.sel, v.open.has(key), v.textSel ?? null]).toEqual([key, false, null]);
    }
  }
});

test("a press that moves while held, or a double press, still only selects a closed pin, and a click after it opens again", async () => {
  const { v, cx } = await pinsShown(["--extra", "6"], [1, 3, 5]);
  v.listH = 700;
  const [a, b] = v.pinnedList().map((p) => p.key);
  for (const k of [a, b]) if (v.open.has(k)) v.toggle(k, cx);
  // A drag that selects text, then the pointer goes on: the pin is selected, not opened.
  v.sel = null;
  cx.timers = [];
  click(v, cx, a, { held: [{ x: 190, y: 300 }, { x: 260, y: 310 }], after: [{ x: 300, y: 400 }] });
  afterPress(cx);
  expect([v.sel, v.open.has(a)]).toEqual([a, false]);
  // A double press (a word): selected, not opened.
  v.sel = null;
  cx.timers = [];
  click(v, cx, b);
  click(v, cx, b, { count: 2 });
  afterPress(cx);
  expect([v.sel, v.open.has(b)]).toEqual([b, false]);
  // A click that does not move, after both: it opens.
  cx.timers = [];
  click(v, cx, a);
  afterPress(cx);
  expect(v.open.has(a)).toBe(true);
});
