// bun test: a render Herdr stops partway leaves no read waiting for a draw that never comes.
// Herdr stops a draw that runs past its time with the script engine's interrupt, which falls at
// any call. Here the stop is an error thrown from one chosen call inside the render, out of the
// draw. On the render harness (test/render-harness.js), with a small made-up transcript.
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { draw, dropTimers, fixture, pane, settleRows, setup } from "./render-harness.js";

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
