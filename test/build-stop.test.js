// bun test: a rows build that Herdr stops partway leaves the rows, their sizes and their index
// in step. Herdr stops a draw that runs past its time with the script engine's interrupt, which
// falls at any call, so a build can be stopped between any two calls in it. Here the stop is an
// error thrown from inside the build, at one chosen call, out of the draw. On the render harness
// (test/render-harness.js), with the harness's made-up session (make-fixture.js).
import { test, expect } from "bun:test";

import { draw, dropTimers, fixture, pane, settleRows, setup } from "./render-harness.js";

setup();

const STOP = new Error("stopped by Herdr");
const paras = (n) => Array.from({ length: n }, (_, i) => `Paragraph ${i + 1}: the cart total rounds per line.`).join("\n\n");

// A pane on the made-up session, its last turn's reply made n short paragraphs. Returns the
// pane, the turn's key, and a draw that counts a stop instead of throwing it.
async function longReply(n) {
  const { v, cx } = await pane(fixture("--extra", "2"), { sliced: true });
  v.debug = false;
  const turn = v.sessions.at(-1).turns.at(-1);
  turn.after = [paras(n)];
  turn.shapeKey = null;
  const key = `${v.sessions.length - 1}:${turn.n}`;
  const run = { stops: 0 };
  run.frame = () => { try { draw(v, cx); } catch (e) { if (e !== STOP) throw e; run.stops++; } };
  return { v, cx, key, run };
}

// Herdr can stop a full build after it has sized a row and before it has put the row in its
// index. The build goes on from its next row, so that row was in no index: here a turn's row,
// and when the card is opened, the rebuild of its rows finds it in no row, takes it for a turn
// not shown, and the card never draws.
test("a full build Herdr stops between sizing a row and indexing it leaves no row out of the index: the card opened after it draws", async () => {
  const { v, cx, key, run } = await longReply(400);
  let armed = true;
  let hit = false;
  // The build's index entry for the turn's row is stopped as it is made. The index is the
  // build's own (rowJob), made before its rows are, and the stop is put in it once they are,
  // so it falls in this build only, whichever of the size and the index entry comes first.
  const buildRows = v.buildRows;
  v.buildRows = function (...a) {
    const out = buildRows.apply(this, a);
    const index = this.rowJob?.index;
    if (index && !Object.hasOwn(index, "set")) index.set = function (k, i) { if (armed && k === key && v.rowJob?.index === this) { armed = false; hit = true; throw STOP; } return Map.prototype.set.call(this, k, i); };
    return out;
  };
  v.rowsKey = null;
  for (let k = 0; k < 20 && (v.rowJob || v.rowsKey == null); k++) run.frame();
  delete v.buildRows;
  settleRows(v, cx);
  dropTimers(v, cx);
  const indexed = v.baseIndex.has(key);
  v.toggle(key, cx);
  for (let k = 0; k < 20; k++) { run.frame(); cx.flush?.(0); }
  const parts = v.baseRows.filter((x) => x.key.startsWith(`md:${key}:`)).length;
  expect([hit, run.stops, indexed, parts > 0, v.baseRows.every((x, i) => v.baseIndex.get(x.key) === i)]).toEqual([true, 1, true, true, true]);
}, 60000);

// Herdr can stop a draw after the rebuild of an opened turn's rows (spliceRows) has dropped
// the turn's old rows from the index and before it has put the new ones in. A rebuild that
// went on from there found the turn in no row, took it for one not shown, and gave up: the
// card never drew. The build after such a stop is of every row, and a splice that runs to its
// end leaves the next open or close to a splice again.
test("a draw Herdr stops halfway through putting an opened card's rows in leaves no card half built: the next build is of every row, and the card draws", async () => {
  const { v, cx, key, run } = await longReply(400);
  settleRows(v, cx);
  dropTimers(v, cx);
  let armed = true;
  // The splice that puts the new rows in, after the old ones' index entries are dropped.
  const rows = v.baseRows;
  rows.splice = function (...a) { if (a.length > 2 && armed) { armed = false; throw STOP; } return Array.prototype.splice.apply(this, a); };
  v.toggle(key, cx);
  for (let k = 0; k < 20; k++) { run.frame(); cx.flush?.(0); }
  delete rows.splice;
  const parts = v.baseRows.filter((x) => x.key.startsWith(`md:${key}:`)).length;
  const agree = v.baseRows.every((x, i) => v.baseIndex.get(x.key) === i);
  // Closed again: a splice, which takes the card's rows out.
  const made = [];
  const spliceRows = v.spliceRows;
  v.spliceRows = function (...a) { const out = spliceRows.apply(this, a); made.push(out); return out; };
  v.toggle(key, cx);
  settleRows(v, cx);
  delete v.spliceRows;
  const left = v.baseRows.filter((x) => x.key.startsWith(`md:${key}:`)).length;
  expect([armed, run.stops, parts > 0, agree, made.includes(true), left, v.baseRows.every((x, i) => v.baseIndex.get(x.key) === i)]).toEqual([false, 1, true, true, true, 0, true]);
}, 60000);

// A closed row built with an old shape is reshaped where it is (reshapeStale): its new row,
// then its height, which is a call, where Herdr's stop can fall. Stopped there, the row had its
// new shape and its old height, and the next pass, finding the shape already new, left the
// height as it was: the row drew at the wrong height for good. The height is worked out before
// the row changes.
test("a closed row's reshape that Herdr stops as it works out the height leaves the row to be reshaped, and it ends at its new height", async () => {
  const { v, cx, run } = await longReply(4);
  settleRows(v, cx);
  dropTimers(v, cx);
  const rows = v.baseRows;
  const i = rows.findIndex((x) => x.kind === "turn" && x.turn && !x.live && !x.last);
  const j = rows.findIndex((x, k) => x.kind === "turn" && k !== i && v.height(x) !== v.height(rows[i]));
  const key = rows[i].key;
  const real = rows[i].shape;
  // The row as a build out of time leaves it: another row's shape, at that shape's height.
  rows[i] = { ...rows[i], shape: rows[j].shape };
  v.baseSizes[i] = v.height(rows[i]);
  v.staleRows = [i];
  v.reshapeDue = true;
  v.fitKey = null;
  let armed = true;
  const height = v.height;
  v.height = function (r) { if (armed && r?.key === key && r.kind === "turn" && r.shape === real) { armed = false; throw STOP; } return height.call(this, r); };
  for (let k = 0; k < 20; k++) { run.frame(); cx.flush?.(0); }
  delete v.height;
  expect([j >= 0, armed, run.stops, v.baseRows[i].shape === real, v.baseSizes[i] === v.height(v.baseRows[i])]).toEqual([true, false, 1, true, true]);
}, 60000);
