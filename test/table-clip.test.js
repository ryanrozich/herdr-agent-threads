// bun test: a wide table in an open turn shows whole. A table may run wider than the reading
// line (tableExtra), drawn wider by extra and moved left by half of it (tableBlock), and its
// row's slot is wider by extra too. The card part around it (cardPart) clipped at the column,
// 16 px past the reading line, so a table wider than that lost its first column's start and
// its last column's end. On the render harness (test/render-harness.js); its calls are a flat
// list, so a clip is told apart by where it comes: the item's own calls come before its slot's
// (the slot's max_w is the width of the column plus extra).
import { test, expect } from "bun:test";

import { draw, fixture, H, itemWords, pane, pinPane, rec, ROW, setup, theme } from "./render-harness.js";

setup();

// Nine columns of long cells: wider than any reading line, so extra is the room beside the
// column (the pane less the gutter), far more than 2 x 16 px.
const cells = Array.from({ length: 9 }, (_x, i) => `Column ${i} heading words`);
const WIDE = `| ${cells.join(" | ")} |\n|${"---|".repeat(9)}\n| ${cells.map((c) => `${c} and a long value`).join(" | ")} |`;
const NARROW = "| File | Size |\n|---|---|\n| notes.txt | 4 KB |";

// The turn before the newest, open, its reply a paragraph, the table and a paragraph: its md
// items. In the Pinned view (pinned) it is pinned and opened there.
function openTable(v, cx, table, pinned = false) {
  v.paneW = 1400;
  draw(v, cx);
  const key = v.turnKeys(v.rows()).at(-2);
  const turn = v.findTurn(key);
  turn.after = [`Here is the plan:\n\n${table}\n\nWhich one first?`];
  turn.shapeKey = null;
  v.rowsKey = null;
  draw(v, cx);
  if (pinned) {
    v.view = "pinned";
    v.togglePin(key, cx);
  }
  v.open.add(key);
  v.rowsKey = null;
  draw(v, cx);
  const rows = v.rows();
  const md = rows.filter((r) => r.kind === "md" && r.key.startsWith(`md:${key}:`));
  expect(md.map((r) => Boolean(r.table))).toEqual([false, true, false]);
  return { rows, md };
}

// One row drawn as the list draws it: its item, then its slot.
function slotCalls(v, rows, r) {
  const at = rows.indexOf(r);
  H.rec = [];
  v.listItems(theme, rows, rows.map(() => 400), { start: at, end: at + 1 }, true, false);
  const c = rec;
  H.rec = null;
  return c;
}

// Where each clip of a drawn row is: in the item, or on the slot (after the slot's max_w).
function clips(calls, slotW) {
  const slot = calls.findIndex((e) => e[0] === "max_w" && e[1] === slotW);
  expect(slot).toBeGreaterThan(0);
  return calls.flatMap((e, i) => (e[0] === "overflow_hidden" ? [i > slot ? "slot" : "item"] : []));
}

// The table's item and slot: nothing in the item clips, and the slot, the one clip, holds the
// table with the gutter to spare on each side. Before the fix the card part clipped at the
// column: in the slot the table runs from 16 px to 16 + prose + extra, the card part from
// extra / 2 to extra / 2 + the column, so extra / 2 - 16 px was cut on each side.
function shownWhole(v, rows, r) {
  const extra = v.tableExtra(r);
  expect(extra / 2).toBeGreaterThan(ROW.PAD_X);
  const item = itemWords(v, r);
  expect(item).toContainEqual(["w", v.prose() + extra]);
  expect(item).toContainEqual(["ml", -extra / 2]);
  expect(item.filter((e) => e[0] === "overflow_hidden")).toEqual([]);
  const calls = slotCalls(v, rows, r);
  expect(clips(calls, v.width + extra)).toEqual(["slot"]);
  expect(calls).toContainEqual(["px", extra / 2]);
  expect(calls).toContainEqual(["px", ROW.PAD_X]);
  expect(ROW.PAD_X + v.prose() + extra + ROW.PAD_X).toBeLessThanOrEqual(v.width + extra);
}

test("an open turn's wide table shows whole: nothing in its card part clips it, only its row's slot, which holds it", async () => {
  const { v, cx } = await pane(fixture("--extra", "3"));
  const { rows, md } = openTable(v, cx, WIDE);
  expect(v.pw()).toBeGreaterThan(v.width);
  shownWhole(v, rows, md[1]);
});

test("an open pin's wide table in the Pinned view shows whole too", async () => {
  const { v, cx } = await pinPane("--extra", "3");
  const { rows, md } = openTable(v, cx, WIDE, true);
  expect(v.view).toBe("pinned");
  expect(v.pinnedList().length).toBe(1);
  shownWhole(v, rows, md[1]);
});

test("a table narrower than the column draws as before, on the reading line in the column's box, and the card's other parts keep their clip", async () => {
  const { v, cx } = await pane(fixture("--extra", "3"));
  const { rows, md } = openTable(v, cx, NARROW);
  expect(v.tableExtra(md[1])).toBe(0);
  // No wider block and no shift: the Markdown view sits in the reading block.
  const item = itemWords(v, md[1]);
  expect(item).toContainEqual(["max_w", v.prose()]);
  expect(item.filter((e) => e[0] === "ml" || e[0] === "w")).toEqual([]);
  // The slot is the column, and it clips there.
  const calls = slotCalls(v, rows, md[1]);
  expect(clips(calls, v.width).at(-1)).toBe("slot");
  expect(calls.filter((e) => e[0] === "max_w" && e[1] > v.width)).toEqual([]);
  // A paragraph's card part still clips at the column.
  expect(itemWords(v, md[0]).filter((e) => e[0] === "overflow_hidden").length).toBe(1);
  expect(clips(slotCalls(v, rows, md[0]), v.width)).toEqual(["item", "slot"]);
});
