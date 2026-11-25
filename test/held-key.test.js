// bun test: a key held down in the Chat, on the render harness (test/render-harness.js): the list
// goes along with the turn the key has reached, however soon the next repeat comes.
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dropTimers, frame, pane, settleList, setup, simList } from "./render-harness.js";

setup();
// 300 made-up turns of a line or two, so nothing is past the list's cap and no window moves.
function chat300() {
  const at = (k) => new Date(Date.UTC(2026, 9, 1, 8, 0, 0) + k * 60000).toISOString();
  const lines = [];
  for (let k = 0; k < 300; k++) {
    lines.push({ type: "user", uuid: `u${k}`, timestamp: at(2 * k), sessionId: "s", origin: { kind: "human" }, promptSource: "typed", message: { role: "user", content: `Turn ${k + 1} zerb` } });
    lines.push({ type: "assistant", uuid: `a${k}`, timestamp: at(2 * k + 1), sessionId: "s", message: { id: `m${k}`, role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: `kazo the cart ${k}` }] } });
    lines.push({ type: "system", subtype: "turn_duration", durationMs: 4000, uuid: `d${k}`, timestamp: at(2 * k + 1), sessionId: "s" });
  }
  const file = join(mkdtempSync(join(tmpdir(), "threads-held-")), "h.jsonl");
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  return file;
}
// Down held from turn 21 for 2 s, then let go. One thread and one clock, in ms: a press, a timer
// due and a draw each wait for the draw that runs; a draw starts at a 16 ms tick once one was
// asked for and takes cost ms; a timer it asks for counts from its start. The clock is the
// test's own: it says nothing of how long Herdr's draws take.
async function hold(file, every, cost) {
  const { v, cx } = await pane(file);
  v.debug = false;
  v.listH = 600;
  const sim = simList(v);
  settleList(v, cx, sim);
  dropTimers(v, cx);
  const keys = v.turnKeys(v.rows());
  v.sel = keys[20];
  v.follow = false;
  v.scrollTo = null;
  let q = [];
  let t = 0;
  let dirty = false;
  let asks = 0;
  const after = cx.timer.after;
  cx.timer.after = (ms, fn) => { q.push({ at: t + ms, fn }); };
  cx.notifyHook = () => { dirty = true; };
  const item = v.scroll.scroll_to_item;
  v.scroll.scroll_to_item = (...a) => { asks++; return item(...a); };
  // Where the turn selected is in the list's view, in the last frame drawn.
  const place = () => {
    const f = sim.last();
    const i = f.keys.indexOf(v.sel);
    const top = f.sizes.slice(0, i).reduce((x, y) => x + y, 0) - f.off;
    return { shown: i >= 0 && top + f.sizes[i] > 0 && top < v.listH, off: Math.abs(top + f.sizes[i] / 2 - v.listH / 2) };
  };
  // held: the draws made while the key is held.
  const got = { presses: 0, draws: 0, held: 0, lost: 0 };
  let busy = 0;
  let next = 0;
  for (; t < 2600; t++) {
    if (t < busy) continue;
    while (next <= t && next < 2000) { next += every; got.presses++; v.action("next", cx); dirty = true; }
    if (t >= 2000) got.asks ??= asks;
    for (;;) {
      const due = q.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      q = q.filter((x) => x !== due);
      due.fn(cx);
    }
    if (dirty && t % 16 === 0) {
      dirty = false;
      got.draws++;
      if (t < 2000) got.held++;
      frame(v, cx);
      busy = t + cost;
      // The first draw's own ask comes after it: the list is still at the chat's end there.
      if (t < 2000 && got.draws > 1 && !place().shown) got.lost++;
    }
  }
  cx.timer.after = after;
  cx.notifyHook = null;
  return { ...got, turn: keys.indexOf(v.sel), centred: place().off <= 1 };
}
const COSTS = [2, 10, 20, 30];
// How often main at d98ec0e5 asked the list for a turn while the key was held, by the repeat and
// the draws' cost above (measured with this chat and this clock). There each landing asked for
// its own turn 16 ms on, whatever came since.
const MAIN = { 16: [124, 124, 62, 62], 30: [66, 66, 62, 62], 33: [60, 60, 60, 60], 50: [40, 40, 40, 40], 90: [22, 22, 22, 22] };
test("a key held down for 2 s asks the list for its turns as often as main at d98ec0e5, less one at most, at every repeat and draw cost measured there, and the list ends on the turn it has reached", async () => {
  const file = chat300();
  const short = [];
  const ends = [];
  for (const [every, want] of Object.entries(MAIN)) for (const [k, cost] of COSTS.entries()) {
    const r = await hold(file, Number(every), cost);
    if (r.asks < want[k] - 1) short.push(`a press every ${every} ms, a draw of ${cost} ms: ${r.asks} asks, main ${want[k]}`);
    if (r.turn !== 20 + r.presses || !r.centred) ends.push([every, cost, r]);
  }
  expect({ short, ends }).toEqual({ short: [], ends: [] });
}, 60000);
test("a key held down with a press every 16 ms: every frame drawn while it is held, but the first, shows the turn it has reached", async () => {
  const file = chat300();
  const got = {};
  for (const cost of COSTS) { const r = await hold(file, 16, cost); got[cost] = [r.held > 60, r.lost]; }
  expect(got).toEqual(Object.fromEntries(COSTS.map((c) => [c, [true, 0]])));
}, 60000);
