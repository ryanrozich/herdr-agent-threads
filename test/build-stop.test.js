// bun test: a rows build that Herdr stops partway leaves the rows, their sizes and their index
// in step. Herdr stops a draw that runs past its time with the script engine's interrupt, which
// falls at any call, so a build can be stopped between any two calls in it. Here the stop is an
// error thrown from inside the build, at one chosen call, out of the draw. On the render harness
// (test/render-harness.js), with the harness's made-up session (make-fixture.js).
import { test, expect } from "bun:test";

import { draw, dropTimers, fixture, openAt, pane, probeFrame, scripted, settleList, settleRows, setup, simList, stillAt } from "./render-harness.js";

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
  // A closed turn's reply grows (a longer shape), and a full build has no reshaping time: the
  // time is spent before the first shape, so the row is built with its old shape, to be reshaped.
  const T = v.sessions.at(-1).turns;
  const t = T.find((x, k) => k < T.length - 1 && v.baseRows.some((r) => r.kind === "turn" && r.turn === x && !r.live && !r.last));
  t.after = [`${(t.after ?? []).join("\n\n")}\n\nA longer made-up reply.\n\nWith more lines.\n\nAnd more.`];
  t.shapeKey = null;
  v.shapeMax = () => -1;
  v.rowsKey = null;
  for (let k = 0; k < 20 && (v.rowJob || v.rowsKey == null); k++) run.frame();
  delete v.shapeMax;
  dropTimers(v, cx);
  const rows = v.baseRows;
  const i = (v.staleRows ?? []).find((k) => rows[k]?.turn === t && rows[k].kind === "turn") ?? -1;
  const key = rows[i]?.key;
  const old = rows[i]?.shape;
  const oldH = v.baseSizes[i];
  let armed = true;
  const height = v.height;
  v.height = function (r) { if (armed && r?.key === key && r.kind === "turn" && r.shape !== old) { armed = false; throw STOP; } return height.call(this, r); };
  v.reshapeDue = true;
  for (let k = 0; k < 20; k++) { run.frame(); cx.flush?.(0); }
  delete v.height;
  expect([i >= 0, armed, run.stops, v.baseRows[i].shape === v.shape(v.baseRows[i].turn), v.baseSizes[i] === v.height(v.baseRows[i]), v.baseSizes[i] !== oldH]).toEqual([true, false, 1, true, true, true]);
}, 60000);

// A full build puts its rows, sizes and index in, then makes the record later builds start
// from (probeList and the build record are calls, where Herdr's stop can fall), then the rows'
// key. Stopped in between, the new rows stood under the old record and the old key, and the
// next build trusted that record. The key is cleared before the rows go in: the build after
// such a stop is of every row.
test("a full build Herdr stops after its rows are in and before its record is made is followed by a build of every row", async () => {
  const { v, cx, key, run } = await longReply(4);
  settleRows(v, cx);
  dropTimers(v, cx);
  let armed = true;
  let keyAfter;
  // Where the stop fell: the new rows, sizes and index in, and the old record still standing.
  let fell = null;
  const record = v.rowBuild;
  const probeList = v.probeList;
  v.probeList = function (...a) {
    if (armed && this.rowJob == null) {
      armed = false;
      keyAfter = this.rowsKey;
      const R = this.baseRows;
      fell = [R.some((x) => x.key.startsWith(`md:${key}:`)), this.baseSizes.length === R.length, this.baseIndex.size === R.length && R.every((x, i) => this.baseIndex.get(x.key) === i), this.rowBuild === record];
      throw STOP;
    }
    return probeList.apply(this, a);
  };
  // The open is built by a full build, not a splice.
  v.spliceRows = () => false;
  v.toggle(key, cx);
  run.frame();
  delete v.spliceRows;
  delete v.probeList;
  let full = 0;
  const buildRows = v.buildRows;
  v.buildRows = function (status, from, ...a) { if (!from) full++; return buildRows.call(this, status, from, ...a); };
  settleRows(v, cx);
  delete v.buildRows;
  const got = v.baseRows.map((x) => x.key).join("\n");
  const agree = v.baseRows.every((x, i) => v.baseIndex.get(x.key) === i);
  v.rowsKey = null;
  settleRows(v, cx);
  expect([armed, run.stops, keyAfter ?? null, fell, full > 0, agree, got === v.baseRows.map((x) => x.key).join("\n")]).toEqual([false, 1, null, [true, true, true, true], true, true, true]);
}, 60000);

// With the index entry made first, Herdr's stop can fall after it and before the row's size:
// the row is indexed and has no size. The build goes on from its first row with no size, so
// the next draw sizes that row, at the place its index entry already names.
test("a full build Herdr stops between indexing a row and sizing it sizes that row in the next draw: every row has its size and its own index entry", async () => {
  const { v, cx, key, run } = await longReply(400);
  let armed = true;
  let hit = -1;
  const buildRows = v.buildRows;
  v.buildRows = function (...a) {
    const out = buildRows.apply(this, a);
    const job = this.rowJob;
    if (job?.index && !Object.hasOwn(job.index, "set")) {
      job.index.set = function (k, i) {
        const m = Map.prototype.set.call(this, k, i);
        if (armed && k === key && v.rowJob?.index === this) { armed = false; hit = job.sizes.length - i; throw STOP; }
        return m;
      };
    }
    return out;
  };
  v.rowsKey = null;
  for (let k = 0; k < 20 && (v.rowJob || v.rowsKey == null); k++) run.frame();
  delete v.buildRows;
  settleRows(v, cx);
  dropTimers(v, cx);
  const at = v.baseIndex.get(key);
  const sized = v.baseSizes.length === v.baseRows.length && v.baseSizes.every((h) => h > 0) && v.baseSizes[at] === v.height(v.baseRows[at]);
  v.toggle(key, cx);
  for (let k = 0; k < 20; k++) { run.frame(); cx.flush?.(0); }
  const parts = v.baseRows.filter((x) => x.key.startsWith(`md:${key}:`)).length;
  // hit 0: the stop fell with the row indexed and its size not yet pushed.
  expect([hit, run.stops, v.baseRows[at]?.key === key, sized, parts > 0, v.baseRows.every((x, i) => v.baseIndex.get(x.key) === i)]).toEqual([0, 1, true, true, true, true]);
}, 60000);

// A new column width holds the place on screen across the rows built for it: the full build
// takes the place (takeAnchor) as it ends. That is a call, where Herdr's stop can fall, and the
// request was cleared before it: stopped there, the place was never taken, and the list moved
// to another turn. The request is cleared once the place is taken. Made-up session of 400 short
// turns (scripted).
test("a full build Herdr stops as it takes the held place of a width change keeps that place: the next build takes it", async () => {
  const words = "the cart total rounds per line so the order is off by a cent when a coupon applies to a split shipment".split(" ");
  const say = (i, k) => Array.from({ length: k }, (_, j) => words[(i * 7 + j * 3) % words.length]).join(" ");
  const ev = [];
  for (let i = 0; i < 400; i++) {
    const ts = new Date(Date.UTC(2026, 10, 1, 8, 0) + i * 60000).toISOString();
    ev.push({ k: "p", o: "human", t: `Prompt ${i}: ${say(i, 18 + (i % 5) * 6)}.`, ts }, { k: "t", t: `Reply ${i}: ${say(i + 3, 30 + (i % 7) * 8)}.` }, { k: "d", ts });
  }
  const { v, cx } = await scripted(ev);
  v.debug = false;
  v.listH = 600;
  const sim = simList(v);
  openAt(v, cx, sim, 650);
  sim.wheel(sim.off / 2);
  probeFrame(v, cx);
  settleList(v, cx, sim);
  const before = sim.last().key;
  let armed = true;
  let stops = 0;
  const takeAnchor = v.takeAnchor;
  v.takeAnchor = function (...a) { if (armed) { armed = false; throw STOP; } return takeAnchor.apply(this, a); };
  stillAt(v, 750);
  for (let k = 0; k < 30; k++) { try { draw(v, cx); } catch (e) { if (e !== STOP) throw e; stops++; } cx.flush?.(0); }
  const held = v.anchor?.key ?? null;
  settleList(v, cx, sim);
  delete v.takeAnchor;
  expect([armed, stops, held, sim.last().key]).toEqual([false, 1, before, before]);
}, 60000);

// The running turn's row changes kind when it is selected or left (working, wrow): its kind,
// then its height, which is a call, where Herdr's stop can fall. Stopped there, the row had its
// new kind at its old height, and the next draw, finding the kind already new, left the height
// as it was until the running turn was built again (its next event). The height is worked out
// on a copy with the new kind, and the kind and the size are stored together.
test("a draw Herdr stops as the running row works out its height for a new kind leaves the row to change again: it ends at its new height", async () => {
  const { v, cx } = await pane(fixture("--only", "0", "--agents", "--open"));
  v.debug = false;
  v.prefs = { ...v.prefs, agentTurns: false };
  settleRows(v, cx);
  dropTimers(v, cx);
  const li = v.baseRows.findIndex((x) => x.live);
  const key = v.baseRows[li]?.key;
  v.sel = key;
  v.fitKey = null;
  settleRows(v, cx);
  const was = v.baseRows[li]?.kind;
  let armed = true;
  let stops = 0;
  const height = v.height;
  v.height = function (r) { if (armed && r?.key === key && r.kind === "wrow") { armed = false; throw STOP; } return height.call(this, r); };
  v.sel = null;
  v.fitKey = null;
  for (let k = 0; k < 10; k++) { try { draw(v, cx); } catch (e) { if (e !== STOP) throw e; stops++; } cx.flush?.(0); }
  delete v.height;
  const r = v.baseRows[li];
  const slot = v.rows().find((x) => x.key === key);
  expect([was, armed, stops, r.kind, v.baseSizes[li] === v.height(r), slot?.kind]).toEqual(["working", false, 1, "wrow", true, "wrow"]);
}, 60000);

// A splice that Herdr stops after the rows have changed and before the rows' key is set
// (spliceRows) leaves its mark, and the next build is of every row. But the reader can close
// the card again before that build: the key is then the one the rows had before the open, the
// rows looked built, and the build that clears the mark never came. The mark is read before the
// key is.
test("a card closed again right after a draw Herdr stopped in its opening splice is closed: the rows, their sizes and their index agree, and it opens again", async () => {
  const { v, cx, key, run } = await longReply(40);
  settleRows(v, cx);
  dropTimers(v, cx);
  const was = v.baseRows.map((x) => x.key).join("\n");
  let armed = true;
  // The sizes' splice, after the rows' own: the rows hold the card's, the sizes and the index do not yet.
  const sizes = v.baseSizes;
  sizes.splice = function (...a) { if (a.length > 2 && armed) { armed = false; throw STOP; } return Array.prototype.splice.apply(this, a); };
  v.toggle(key, cx);
  run.frame();
  delete sizes.splice;
  const half = v.baseRows.some((x) => x.key.startsWith(`md:${key}:`));
  // Closed again before the next draw. A draw that throws (a row with no size) is counted.
  v.toggle(key, cx);
  let bad = 0;
  for (let k = 0; k < 20; k++) { try { run.frame(); } catch { bad++; } cx.flush?.(0); }
  const agree = (w) => w.baseRows.length === w.baseSizes.length && w.baseRows.every((x, i) => w.baseIndex.get(x.key) === i) && w.baseIndex.size === w.baseRows.length;
  const closed = [v.baseRows.map((x) => x.key).join("\n") === was, agree(v)];
  // And opened again: the card draws.
  v.toggle(key, cx);
  settleRows(v, cx);
  const parts = v.baseRows.filter((x) => x.key.startsWith(`md:${key}:`)).length;
  expect([armed, run.stops, half, bad, ...closed, parts > 0, agree(v)]).toEqual([false, 1, true, 0, true, true, true, true]);
}, 60000);

// A build of many turns goes on over several draws. Each slice after the first adds its rows to
// the build's own array, from the turn the slice before ended at. Herdr's stop can fall inside a
// slice, as it builds a turn's rows or works out a row's height: the next draw went on from the
// same turn and added that slice's rows again, so the rows (and the rail's turns) held turns
// twice. Made-up session of 120 short turns (scripted).
test("a resumed build Herdr stops inside a later slice builds each row once: the next draw goes on from where that slice began", async () => {
  const ev = [];
  for (let i = 0; i < 120; i++) {
    const ts = new Date(Date.UTC(2026, 10, 1, 8, 0) + i * 60000).toISOString();
    ev.push({ k: "p", o: "human", t: `Prompt ${i}: check the cart total ${i}.`, ts }, { k: "t", t: `Reply ${i}: the total rounds per line.` }, { k: "d", ts });
  }
  const got = [];
  // The stop in a row's height (the closed rows kept so far are dropped, so each is sized), or
  // in the building of a turn's rows, in the fourth slice.
  for (const at of ["height", "turnRows"]) {
    const { v, cx } = await scripted(ev);
    v.debug = false;
    settleRows(v, cx);
    dropTimers(v, cx);
    const key = "0:60";
    let armed = true;
    let stops = 0;
    let slices = 0;
    v.keptFor().rows.clear();
    // Every slice ends at the next sixteenth turn: its time is up at once.
    v.buildMax = () => -1;
    const fn = v[at];
    v[at] = function (r, ...a) {
      if (armed && r?.key === key && this.rowJob?.from?.own) { armed = false; throw STOP; }
      return fn.call(this, r, ...a);
    };
    const buildRows = v.buildRows;
    v.buildRows = function (...a) { slices++; return buildRows.apply(this, a); };
    v.rowsKey = null;
    for (let k = 0; k < 60 && (v.rowJob || v.rowsKey == null); k++) { try { draw(v, cx); } catch (e) { if (e !== STOP) throw e; stops++; } cx.flush?.(0); }
    delete v[at];
    delete v.buildMax;
    delete v.buildRows;
    const keys = v.baseRows.map((x) => x.key);
    // The rail's turns too, one tick each.
    const rail = v.railTurns.map((x) => x.key);
    got.push([at, armed, stops, slices > 4, new Set(keys).size === keys.length, keys.filter((k) => k === key).length, v.baseRows.length === v.baseSizes.length, v.baseRows.every((x, i) => v.baseIndex.get(x.key) === i), rail.length, new Set(rail).size]);
  }
  expect(got).toEqual([["height", false, 1, true, true, 1, true, true, 120, 120], ["turnRows", false, 1, true, true, 1, true, true, 120, 120]]);
}, 60000);

// A resumed build goes on while the newest session changes (jobGoesOn), and the running turn
// is live by its transcript (no done event yet) while Herdr's status may still say working. A
// stop in the running turn's last row, in the last slice, leaves that turn's other rows in the
// build's index; its done event comes before the next draw, and the retry builds it closed, in
// other rows. The cut takes back the index entries of the stopped slice's rows: none is left
// pointing at a place another row now holds.
test("a resumed build Herdr stops in the running turn's last row, whose done event comes before the next draw, leaves no index entry for a row it no longer has", async () => {
  const at = (i) => new Date(Date.UTC(2026, 10, 1, 8, 0) + i * 60000).toISOString();
  const ev = [];
  for (let i = 0; i < 120; i++) ev.push({ k: "p", o: "human", t: `Prompt ${i}: check the cart total ${i}.`, ts: at(i) }, { k: "t", t: `Reply ${i}: the total rounds per line.` }, { k: "d", ts: at(i) });
  ev.push({ k: "p", o: "human", t: "Prompt 120: run the cart tests.", ts: at(120) }, { k: "t", t: "Running the tests." }, { k: "u", n: "Bash", id: "toolu_1", ts: at(120), in: "bun test" }, { k: "t", t: "They pass so far." });
  const { v, cx, s } = await scripted(ev);
  v.debug = false;
  v.status = () => "working";
  settleRows(v, cx);
  dropTimers(v, cx);
  const live = v.baseRows.filter((x) => x.key.includes("0:121")).map((x) => x.key);
  const last = live.at(-1);
  let armed = true;
  let stops = 0;
  // At the stop: the job, and which of the turn's other rows its index holds.
  let job = null;
  let held = null;
  v.keptFor().rows.clear();
  v.buildMax = () => -1;
  const height = v.height;
  v.height = function (r) {
    if (armed && r?.key === last && this.rowJob?.from?.own) {
      armed = false;
      job = this.rowJob;
      held = live.slice(1, -1).filter((k) => job.index.has(k));
      throw STOP;
    }
    return height.call(this, r);
  };
  // The job the retry goes on with, as its record is made.
  let ended = null;
  const buildStep = v.buildStep;
  v.buildStep = function (...a) { const j = this.rowJob; const out = buildStep.apply(this, a); if (j && !this.rowJob) ended = j; return out; };
  v.rowsKey = null;
  const { apply } = await import("../mods/agent-threads/core/turns.js");
  for (let k = 0; k < 60 && (v.rowJob || v.rowsKey == null); k++) {
    try { draw(v, cx); } catch (e) {
      if (e !== STOP) throw e;
      stops++;
      // The turn's done event, before the next draw; Herdr still says working.
      apply(s, { k: "d", ts: at(121) });
      s.version++;
    }
    cx.flush?.(0);
  }
  delete v.height;
  delete v.buildMax;
  delete v.buildStep;
  const rows = v.baseRows;
  const wrong = [...v.baseIndex].filter(([k, i]) => rows[i]?.key !== k).map(([k]) => k);
  // The turn's interim text and its step group were in the index at the stop, the same job went
  // on to its record, and it built the turn closed: one row, and no entry for the rows it had.
  expect([live, armed, stops, held, ended === job, v.baseIndex.size === rows.length, wrong, rows.filter((x) => x.key.includes("0:121")).map((x) => x.key)]).toEqual([
    ["0:121", "it:0:121:0", "gp:0:121:1", "ws:0:121"], false, 1, ["it:0:121:0", "gp:0:121:1"], true, true, [], ["0:121"],
  ]);
}, 60000);
