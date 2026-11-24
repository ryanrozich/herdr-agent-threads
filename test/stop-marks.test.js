// bun test: marks a render sets for its next draw (buildNext, shapeNext) are cleared by the
// timer it asks for. A render Herdr stopped may lose those timers, and a mark left set asked for
// no draw again: the rows build it stood for never went on. On the render harness
// (test/render-harness.js), with made-up turns (scripted).
import { test, expect } from "bun:test";

import { H, scripted, setup } from "./render-harness.js";

setup();

function events(n) {
  const ev = [];
  for (let i = 0; i < n; i++) {
    const ts = new Date(Date.UTC(2026, 10, 1, 8, 0) + i * 20000).toISOString();
    const what = i % 10 === 0 ? "rename the queue helper" : i % 3 === 0 ? "check the cart total" : "look at the staging deploy";
    ev.push({ k: "p", o: "human", t: `Turn ${i}: please ${what} for order ${i}.`, ts });
    ev.push({ k: "t", t: `Done for order ${i}. The totals round per line.` });
    ev.push({ k: "d", ms: 1000, ts });
  }
  return ev;
}

// A search's rows are built over several draws, each asked for by a timer (buildNext). Herdr
// stops the draw just after the build asked for its next one, and that timer is lost. The draw
// after a stopped one (Herdr's watch draw) clears the marks, so the build asks again and its
// rows come in; with the mark left set, the list kept the rows from before the search.
test("a render Herdr stops after the rows build asked for its next draw, with that timer lost, leaves no mark: the search's rows come in", async () => {
  const { v, cx } = await scripted(events(1500));
  v.debug = false;
  v.width = 560; v.rootH = 1100; v.listH = 1000;
  H.listWindow = (k) => ({ start: Math.max(0, k - 14), end: k });
  v.shapeBudget = Infinity;
  for (let k = 0; k < 400; k++) { v.render(cx); cx.flush(0); if (!v.rowJob && !v.staleRows?.length && !(v.shapeLeft > 0)) break; }
  v.shapeBudget = null;
  v.buildMax = () => 0.3;
  v.action("search:rename", cx);
  cx.timers = [];
  // The stop, once: in the draw that started the build, after it asked for its next draw.
  const floating = v.floating;
  let stopped = false;
  v.floating = function (...a) { if (!stopped && this.rowJob && this.buildNext) { stopped = true; throw new Error("stopped by Herdr"); } return floating.apply(this, a); };
  for (let k = 0; k < 50 && !stopped; k++) {
    const n0 = cx.timers.length;
    try { v.render(cx); } catch (e) {
      if (String(e?.message) !== "stopped by Herdr") throw e;
      // Herdr's stop runs no catch: the render is left open, and its timers are lost.
      v.renderOpen = true;
      cx.timers.length = Math.min(cx.timers.length, n0);
      break;
    }
    cx.flush(0);
  }
  v.floating = floating;
  // Herdr's watch draw, then a draw only when the pane asks for one.
  let asked = 0;
  cx.notifyHook = () => { asked++; };
  v.render(cx);
  for (let k = 0; k < 2000; k++) {
    asked = 0;
    cx.flush(0);
    if (!asked) break;
    v.render(cx);
  }
  cx.notifyHook = null;
  const rows = v.rows().length;
  const marks = [Boolean(v.rowJob), Boolean(v.buildNext)];
  for (let k = 0; k < 2000 && v.rowJob; k++) { v.render(cx); cx.flush(0); }
  expect([stopped, ...marks, rows === v.rows().length]).toEqual([true, false, false, true]);
}, 120000);
