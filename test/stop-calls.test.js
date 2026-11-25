// bun test: a render Herdr stops partway leaves no read waiting for a draw that never comes.
// Herdr stops a draw that runs past its time with the script engine's interrupt, which falls at
// any call. Here the stop is an error thrown from one chosen call inside the render, out of the
// draw. On the render harness (test/render-harness.js), with a small made-up transcript.
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { draw, dropTimers, editors, fixture, pane, pinPane, scripted, settleRows, setup } from "./render-harness.js";

setup();

const STOP = new Error("stopped by Herdr");
const settleCx = async (cx) => { await Promise.all(cx.pending); cx.pending = []; };

// A one-turn session with two groups of tool calls in its transcript, the turn open to its
// steps (deeper once): its calls are read when a group opens (deeper again).
async function callsPane() {
  const dir = mkdtempSync(join(tmpdir(), "threads-stop-calls-"));
  const file = join(dir, "00000000-0000-4000-8000-00000000000d.jsonl");
  const ts = (s) => `2026-11-01T09:00:${String(s).padStart(2, "0")}.000Z`;
  const use = (id, name, input, s) => ({ type: "assistant", timestamp: ts(s), message: { id: `msg_${id}`, role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
  const res = (id, content, s) => ({ type: "user", timestamp: ts(s), message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: false }] } });
  const lines = [use("toolu_b1", "Bash", { command: "bun test cart" }, 1), res("toolu_b1", "12 pass", 3),
    use("toolu_b2", "Bash", { command: "bun run lint" }, 4), res("toolu_b2", "lint: clean", 5),
    use("toolu_b3", "Read", { file_path: "src/cart.ts" }, 7), res("toolu_b3", "export const total = 1;", 7)];
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  const { newSession, apply } = await import("../mods/agent-threads/core/turns.js");
  const { v, cx } = await pane(fixture("--only", "1"));
  v.debug = false;
  const s = newSession("00000000-0000-4000-8000-00000000000d", file);
  for (const e of [{ k: "p", o: "human", t: "Fix the cart total", ts: ts(0) },
    { k: "u", n: "Bash", id: "toolu_b1" }, { k: "u", n: "Bash", id: "toolu_b2" },
    { k: "t", t: "Reading the file." }, { k: "u", n: "Read", id: "toolu_b3" },
    { k: "t", t: "Fixed." }, { k: "d", ms: 9000, ts: ts(9) }]) apply(s, e);
  s.loaded = true;
  v.sessions = [s];
  cx.pending = [];
  const ids = ["toolu_b1", "toolu_b2", "toolu_b3"].map((id) => `${file}#${id}`);
  const run = { stops: 0 };
  run.frame = () => { try { draw(v, cx); } catch (e) { if (e !== STOP) throw e; run.stops++; } };
  run.settled = async () => { for (let i = 0; i < 6; i++) { run.frame(); cx.flush(0); await settleCx(cx); } };
  run.read = () => ids.map((k) => v.calls.get(k)?.st ?? null);
  return { v, cx, run };
}

// The render asks for the calls' read: it marks the read as running (callBusy), then asks for
// the timer that reads them. A stop between the two left the mark with no timer to clear it, so
// the calls stayed waiting and no call was read again in that pane.
test("a render Herdr stops after it marked the calls' read as running and before it asked for its timer still reads the calls", async () => {
  const { v, cx, run } = await callsPane();
  v.sel = "0:1";
  v.action("deeper", cx);
  await run.settled();
  let armed = true;
  const flush = v.flushCalls;
  v.flushCalls = function (cx) {
    const after = cx.timer.after;
    cx.timer.after = function (...a) {
      if (armed && this === cx.timer) { armed = false; throw STOP; }
      return after.apply(this, a);
    };
    try { return flush.call(this, cx); } finally { cx.timer.after = after; }
  };
  // → opens the groups: their calls are queued, and the render that would read them is stopped.
  v.action("deeper", cx);
  await run.settled();
  const afterDraws = run.read();
  // A selection change and back.
  v.action("shallower", cx);
  await run.settled();
  v.action("deeper", cx);
  await run.settled();
  delete v.flushCalls;
  expect([armed, run.stops, afterDraws, run.read(), Boolean(v.callBusy)]).toEqual([false, 1, ["ok", "ok", "ok"], ["ok", "ok", "ok"], false]);
});

// Interim texts and estimates left out of time in an open turn (otherLeft) are brought back by
// rebuilding the open turns: the shaping's timer marks it (againOpen) and puts "again" in the
// rows' key, and the next rows() splices those turns' rows. The splice took the mark before it
// had made its record: a stop in between, and the draw after found nothing to build, set the
// key, and the open turn was never rebuilt.
test("a splice of the open turns Herdr stops before its record is made rebuilds them in the next draw", async () => {
  const got = [];
  for (const stop of [false, true]) {
    const { v, cx } = await pane(fixture("--extra", "2"));
    v.debug = false;
    settleRows(v, cx);
    const key = v.baseRows.filter((r) => r.kind === "turn").at(-1).key;
    v.toggle(key, cx);
    settleRows(v, cx);
    dropTimers(v, cx);
    let builds = 0;
    const turnRows = v.turnRows;
    v.turnRows = function (r, ...a) { if (r?.key === key) builds++; return turnRows.call(this, r, ...a); };
    let armed = stop;
    let stops = 0;
    const splice = v.spliceRows;
    v.spliceRows = function (...a) {
      const shapeStart = this.shapeStart;
      this.shapeStart = function (...b) { if (armed) { armed = false; throw STOP; } return shapeStart.apply(this, b); };
      try { return splice.apply(this, a); } finally { delete this.shapeStart; }
    };
    // As the shaping's timer does when an open turn's parts were left out of time.
    v.otherLeft = 1;
    v.againOpen = true;
    v.rowsKey = "again";
    for (let k = 0; k < 6; k++) { try { draw(v, cx); } catch (e) { if (e !== STOP) throw e; stops++; } cx.flush?.(0); }
    delete v.turnRows;
    delete v.spliceRows;
    got.push([stop, stops, builds, Boolean(v.againOpen), v.open.has(key)]);
  }
  expect(got).toEqual([[false, 0, 1, false, true], [true, 1, 1, false, true]]);
}, 60000);

// A stop thrown from a timer call while a draw runs (drawing), once (armed), in the method
// named: before the timer is registered, or just after it (at "after").
function stopAt(v, cx, name, when = "before") {
  const s = { armed: true, drawing: false, asked: 0, stops: 0 };
  const own = v[name];
  v[name] = function (cx) {
    const after = cx.timer.after;
    cx.timer.after = function (...a) {
      s.asked++;
      if (s.armed && s.drawing && this === cx.timer && when === "before") { s.armed = false; throw STOP; }
      const r = after.apply(this, a);
      if (s.armed && s.drawing && this === cx.timer && when === "after") { s.armed = false; throw STOP; }
      return r;
    };
    try { return own.call(this, cx); } finally { cx.timer.after = after; }
  };
  s.frame = () => { s.drawing = true; try { draw(v, cx); } catch (e) { if (e !== STOP) throw e; s.stops++; } finally { s.drawing = false; } };
  s.settled = async () => { for (let i = 0; i < 6; i++) { s.frame(); cx.flush(0); await settleCx(cx); } };
  s.done = () => { delete v[name]; };
  return s;
}

// An open card's code blocks get their editors when it opens. A code block that comes in later
// (the running turn's reply grows) is noted as the rows are built, and gets its editor from a
// timer (flushCode), since an editor cannot be made while drawing: the render marks the timer as
// asked for (codeTick), then asks for it. A stop between the two left the mark with no timer to
// clear it, and no code editor was made again in that pane: later code blocks drew as plain
// text (the 1 s timer's flushCode returns while the mark is set).
test("a render Herdr stops after it marked the code editors' timer as asked for and before it asked for it still makes the editor of a code block that came in later", async () => {
  const ts = (s) => `2026-11-01T09:00:${String(s).padStart(2, "0")}.000Z`;
  const { v, cx, s } = await scripted([{ k: "p", o: "human", t: "Add a total to the cart", ts: ts(0) },
    { k: "t", t: "The total:\n\n```js\nexport const total = (xs) => xs.reduce((a, x) => a + x, 0);\n```" }, { k: "d", ms: 4000, ts: ts(4) }]);
  const { apply } = await import("../mods/agent-threads/core/turns.js");
  v.debug = false;
  cx.pending = [];
  const run = stopAt(v, cx, "flushCode");
  await run.settled();
  v.toggle("0:1", cx);
  await run.settled();
  const opened = [...v.code.keys()];
  // The running turn's reply grows by a second code block.
  apply(s, { k: "t", t: "And its test:\n\n```sh\nbun test cart\n```" });
  await run.settled();
  const afterDraws = [...v.code.entries()].map(([k, c]) => [k, Boolean(c.st)]);
  // A selection change and back.
  v.action("next", cx);
  await run.settled();
  v.action("prev", cx);
  await run.settled();
  run.done();
  expect([run.armed, run.stops, opened, afterDraws, [...v.code.entries()].map(([k, c]) => [k, Boolean(c.st)]), Boolean(v.codeTick)])
    .toEqual([false, 1, ["0:1:1"], [["0:1:1", true], ["0:1:3", true]], [["0:1:1", true], ["0:1:3", true]], false]);
});

// A turn's pasted images are decoded by a timer that reads them one prompt at a time
// (flushImages): the render marks the decode as running (imgBusy), then asks for the timer. A
// stop between the two left the mark with no timer to clear it, and no image was decoded again
// in that pane: its tiles stayed empty.
test("a render Herdr stops after it marked the images' decode as running and before it asked for its timer still decodes the images", async () => {
  const { v, cx } = await pane(fixture("--extra", "2", "--images"));
  v.debug = false;
  v.width = 380;
  cx.pending = [];
  const turns = v.current().turns.filter((t) => t.images.length);
  const run = stopAt(v, cx, "flushImages");
  const decoded = async () => {
    for (let i = 0; i < 40 && !turns.every((t) => v.imgState(t) === "ok"); i++) {
      run.frame(); cx.flush(0); await settleCx(cx);
      await new Promise((r) => setTimeout(r, 20));
    }
    return turns.map((t) => v.imgState(t));
  };
  const got = await decoded();
  run.done();
  expect([run.armed, run.stops, got, Boolean(v.imgBusy)]).toEqual([false, 1, ["ok", "ok", "ok"], false]);
}, 30000);

// flushCalls asks for its timer, then marks the read as running. A stop that falls after the
// timer is registered and before the mark is set lets the next render ask for a second timer, so
// two reads run at once. Each timer takes its own job from the queue, and one that finds none
// clears the mark and stops: each call is read once, and the mark ends cleared.
test("a render Herdr stops after the calls' timer is registered and before the read is marked as running reads each call once and ends with no mark", async () => {
  const { v, cx, run: base } = await callsPane();
  v.sel = "0:1";
  v.action("deeper", cx);
  await base.settled();
  const read = [];
  let running = 0;
  let most = 0;
  v.callDue = [];
  v.callDue.shift = function () {
    const job = Array.prototype.shift.call(this);
    if (job) { read.push(...job.ids); running++; most = Math.max(most, running); }
    return job;
  };
  const pruneCalls = v.pruneCalls;
  v.pruneCalls = function () { running--; return pruneCalls.call(this); };
  const run = stopAt(v, cx, "flushCalls", "after");
  // → opens the groups: their calls are queued (a job a group), and the render that asked for
  // the read is stopped after its timer was registered. Herdr runs that timer before the next
  // render (it asks for none after a stopped one), so the first read starts; a render while it
  // runs finds no mark and asks for a second timer, which starts the second read.
  v.action("deeper", cx);
  run.frame();
  cx.flush(0);
  run.frame();
  cx.flush(0);
  await run.settled();
  run.done();
  delete v.pruneCalls;
  expect([run.armed, run.stops, run.asked, most, read.sort(), base.read(), Boolean(v.callBusy)])
    .toEqual([false, 1, 2, 2, ["toolu_b1", "toolu_b2", "toolu_b3"], ["ok", "ok", "ok"], false]);
});

// spliceRows reads againOpen, rebuilds the open turns and clears it with the record. A splice
// runs inside one draw and no timer runs inside a draw, so the shaping's timer (the one writer
// of againOpen) can only ask again between draws. Here a splice is stopped before the rebuild
// (shapeStart) or after it (sizing the rebuilt rows); the shaping's timer then asks again, as
// it does when the rebuild left parts out of time; the next draw rebuilds the open turn again.
test("a splice of the open turns Herdr stops before or after the rebuild, with the shaping's timer asking again before the next draw, rebuilds them in the next draw", async () => {
  const got = [];
  for (const where of ["shapeStart", "height"]) {
    const { v, cx } = await pane(fixture("--extra", "2"));
    v.debug = false;
    settleRows(v, cx);
    const key = v.baseRows.filter((r) => r.kind === "turn").at(-1).key;
    v.toggle(key, cx);
    settleRows(v, cx);
    dropTimers(v, cx);
    let builds = 0;
    let rebuilt = false;
    const turnRows = v.turnRows;
    v.turnRows = function (r, ...a) { const out = turnRows.call(this, r, ...a); if (r?.key === key) { builds++; rebuilt = true; } return out; };
    let armed = true;
    let stops = 0;
    const splice = v.spliceRows;
    v.spliceRows = function (...a) {
      const own = this[where];
      this[where] = function (...b) { if (armed && (where === "shapeStart" || rebuilt)) { armed = false; throw STOP; } return own.apply(this, b); };
      try { return splice.apply(this, a); } finally { delete this[where]; }
    };
    v.otherLeft = 1;
    v.againOpen = true;
    v.rowsKey = "again";
    try { draw(v, cx); } catch (e) { if (e !== STOP) throw e; stops++; }
    // Between draws: the shaping's timer, as when the rebuild left parts out of time.
    v.otherLeft = 1;
    v.againOpen = true;
    v.rowsKey = v.rowsKey == null ? null : "again";
    const left = Boolean(v.againOpen);
    for (let k = 0; k < 6; k++) { draw(v, cx); cx.flush?.(0); }
    delete v.turnRows;
    delete v.spliceRows;
    const at = v.baseIndex.get(key);
    got.push([where, stops, left, builds, Boolean(v.againOpen), v.open.has(key), v.baseRows[at]?.key === key]);
  }
  expect(got).toEqual([["shapeStart", 1, true, 1, false, true, true], ["height", 1, true, 2, false, true, true]]);
}, 60000);

// An opened call's output is coloured by a read-only editor, made by a timer (syncOutEditors),
// since an editor cannot be made while drawing: the render marks the timer as asked for
// (outNext), then asks for it. A stop between the two left the mark with no timer to clear it,
// and no output editor was made again in that pane: every output opened later drew as plain text.
test("a render Herdr stops after it marked the output editors' timer as asked for and before it asked for it still colours the opened call's output", async () => {
  const { v, cx, run: base } = await callsPane();
  v.sel = "0:1";
  v.action("deeper", cx);
  await base.settled();
  v.action("deeper", cx);
  await base.settled();
  const run = stopAt(v, cx, "syncOutEditors");
  // The Read call (src/cart.ts), a group of one: its output opens.
  v.callOpen.add("0:1:2:0");
  await run.settled();
  const key = [...v.calls.keys()].find((k) => k.endsWith("#toolu_b3"));
  const afterDraws = Boolean(v.outEds?.get(key)?.st);
  // A selection change and back.
  v.action("shallower", cx);
  await run.settled();
  v.action("deeper", cx);
  await run.settled();
  run.done();
  expect([run.armed, run.stops, afterDraws, Boolean(v.outEds?.get(key)?.st), Boolean(v.outNext)]).toEqual([false, 1, true, true, false]);
});

// The timer-first sites (flushCode, flushImages, syncOutEditors), when the stop falls after
// the timer is registered and before the mark is set: a render before that timer runs (as one
// an event asks for) finds no mark and asks for a second timer, so two are in flight. Each item
// is still handled once: the code editors' second timer finds nothing due, the output editors'
// skips an output that has its editor, and each images' timer takes its own prompt.
test("a render Herdr stops after the code editors' timer is registered and before the mark is set makes each editor once and ends with no mark", async () => {
  const ts = (s) => `2026-11-01T09:00:${String(s).padStart(2, "0")}.000Z`;
  const { v, cx, s } = await scripted([{ k: "p", o: "human", t: "Add a total to the cart", ts: ts(0) },
    { k: "t", t: "The total:\n\n```js\nexport const total = (xs) => xs.reduce((a, x) => a + x, 0);\n```" }, { k: "d", ms: 4000, ts: ts(4) }]);
  const { apply } = await import("../mods/agent-threads/core/turns.js");
  v.debug = false;
  cx.pending = [];
  const run = stopAt(v, cx, "flushCode", "after");
  await run.settled();
  v.toggle("0:1", cx);
  await run.settled();
  const was = editors.length;
  apply(s, { k: "t", t: "And its test:\n\n```sh\nbun test cart\n```" });
  run.frame();
  run.frame();
  cx.flush(0);
  await run.settled();
  run.done();
  const made = editors.slice(was).map((e) => e.opts.value);
  expect([run.armed, run.stops, run.asked, made, [...v.code.keys()], Boolean(v.codeTick)])
    .toEqual([false, 1, 2, ["bun test cart"], ["0:1:1", "0:1:3"], false]);
});

test("a render Herdr stops after the output editors' timer is registered and before the mark is set makes each output's editor once and ends with no mark", async () => {
  const { v, cx, run: base } = await callsPane();
  v.sel = "0:1";
  v.action("deeper", cx);
  await base.settled();
  v.action("deeper", cx);
  await base.settled();
  const run = stopAt(v, cx, "syncOutEditors", "after");
  const was = editors.length;
  v.callOpen.add("0:1:2:0");
  run.frame();
  run.frame();
  cx.flush(0);
  await run.settled();
  run.done();
  const made = editors.slice(was).map((e) => e.opts.value);
  expect([run.armed, run.stops, run.asked, made, v.outEds.size, Boolean(v.outNext)])
    .toEqual([false, 1, 2, ["export const total = 1;"], 1, false]);
});

test("a render Herdr stops after the images' timer is registered and before the decode is marked as running decodes each prompt's images once and ends with no mark", async () => {
  const { v, cx } = await pane(fixture("--extra", "2", "--images"));
  v.debug = false;
  v.width = 380;
  cx.pending = [];
  const turns = v.current().turns.filter((t) => t.images.length);
  const read = [];
  let running = 0;
  let most = 0;
  v.imgDue = [];
  v.imgDue.shift = function () {
    const job = Array.prototype.shift.call(this);
    if (job) { read.push(job.u); running++; most = Math.max(most, running); }
    return job;
  };
  const set = v.imgs?.set;
  v.imgs ??= new Map();
  const imgs = v.imgs;
  imgs.set = function (u, x) { if (x?.st !== "wait") running--; return Map.prototype.set.call(this, u, x); };
  const run = stopAt(v, cx, "flushImages", "after");
  // The stopped render; Herdr runs its timer, whose decode starts; a render while it runs finds
  // no mark and asks for a second timer, which starts the next prompt's decode.
  run.frame();
  cx.flush(0);
  run.frame();
  cx.flush(0);
  for (let i = 0; i < 40 && !turns.every((t) => v.imgState(t) === "ok"); i++) {
    run.frame(); cx.flush(0); await settleCx(cx);
    await new Promise((r) => setTimeout(r, 20));
  }
  run.done();
  delete imgs.set;
  void set;
  expect([run.armed, run.stops, run.asked >= 2, most, [...read].sort(), turns.map((t) => t.imgLine).sort(), turns.map((t) => v.imgState(t)), Boolean(v.imgBusy)])
    .toEqual([false, 1, true, 2, turns.map((t) => t.imgLine).sort(), turns.map((t) => t.imgLine).sort(), ["ok", "ok", "ok"], false]);
}, 30000);

// A rail jump that lands a long turn level with its tick, with no earlier item's top there,
// lifts the first row for the frame of the scroll: the render asks for a timer 48 ms on that
// sets the lift (landLift) and scrolls, and one 120 ms on that takes the lift off. A stop
// between the two asks ran the first and never the second: the first row stayed taller for the
// pane's life, and no place was kept across a resize (takeAnchor gives none while a lift is on).
test("a render Herdr stops between the landing's lift and the timer that takes it off leaves no lift: the first row keeps its height", async () => {
  const { v, cx, keys } = await pinPane("--extra", "6");
  v.paneW = 675;
  v.listH = 1000;
  draw(v, cx);
  const ks = keys();
  const mid = ks[Math.floor(ks.length / 2)];
  const prev = ks[ks.indexOf(mid) - 1];
  // Both turns are long, so the landing needs a lift (as in render.test.js's landing test).
  for (const k of [prev, mid]) {
    const turn = v.findTurn(k);
    turn.prompt = Array.from({ length: 30 }, (_, i) => `line ${i + 1} of the long paste about the checkout total`).join("\n");
    turn.shapeKey = null;
  }
  v.rowsKey = null;
  draw(v, cx);
  const first = v.slotsMemo[0];
  v.scroll = { scroll_to_item() {}, scroll_to_bottom() {} };
  cx.timers = [];
  let armed = true;
  let stops = 0;
  const bodyNow = v.bodyNow;
  v.bodyNow = function (...a) {
    const after = cx.timer.after;
    cx.timer.after = function (ms, fn) {
      if (armed && this === cx.timer && ms === 120) { armed = false; throw STOP; }
      return after.call(this, ms, fn);
    };
    try { return bodyNow.apply(this, a); } finally { cx.timer.after = after; }
  };
  v.railJump(mid, cx);
  try { draw(v, cx); } catch (e) { if (e !== STOP) throw e; stops++; }
  const lift = v.landed?.lift ?? 0;
  cx.flush(48);
  cx.flush(200);
  for (let k = 0; k < 4; k++) { draw(v, cx); cx.flush(200); }
  delete v.bodyNow;
  expect([armed, stops, lift > 0, v.landLift ?? 0, v.slotsMemo[0] === first]).toEqual([false, 1, true, 0, true]);
});
