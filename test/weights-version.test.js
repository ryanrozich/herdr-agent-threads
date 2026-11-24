// bun test: the Herdr versions whose divider drag is checked to keep weight units (ui.js
// WEIGHT_HERDR), on the render harness (test/render-harness.js). Herdr 0.1.18's drag_to,
// layout.resize, split and close code is the same as 0.1.17's, so on 0.1.18 the Pinned pair
// goes on weights as on 0.1.16 and 0.1.17. The pair's and the row's other tests are in
// render.test.js ("the version gate", "on a listed Herdr version the Pinned pair ...").
import { test, expect, spyOn } from "bun:test";
import { WEIGHT_HERDR, weightHerdr } from "../mods/agent-threads/ui.js";
import { draw, H, keyEv, log, makeCx, pinPane, settle, setup, state, Threads } from "./render-harness.js";

setup();

test("Herdr 0.1.18 is on the weights list, after 0.1.16 and 0.1.17, matched exactly", () => {
  expect(WEIGHT_HERDR).toEqual(["0.1.16", "0.1.17", "0.1.18"]);
  expect(["0.1.16", "0.1.17", "0.1.18"].map(weightHerdr)).toEqual([true, true, true]);
  expect(["0.1.19", "v0.1.18", "0.1.18-dev", "0.1.18.1", null].map(weightHerdr)).toEqual(Array(5).fill(false));
});

// Herdr's row as drag_to and sized() lay it out: px panes take their px, weight panes share
// the rest by weight; each layout.resize in the log is applied. Widths are Herdr px (the
// measured width and the 2 px frame). A drag between two weight panes trades weight between
// those two alone, their sum held (drag_to's weight branch, the same at 0.1.16, 0.1.17 and
// 0.1.18); beside a px pane only that pane's px is set.
function herdrRow(total, sizes) {
  const row = { total, order: Object.keys(sizes), size: { ...sizes }, seen: 0 };
  row.widths = () => {
    const room = row.total - row.order.filter((id) => row.size[id].px != null).reduce((s, id) => s + row.size[id].px, 0);
    const sw = row.order.filter((id) => row.size[id].px == null).reduce((s, id) => s + row.size[id].weight, 0);
    return Object.fromEntries(row.order.map((id) => [id, row.size[id].px ?? Math.round((room * row.size[id].weight) / sw)]));
  };
  row.apply = () => {
    for (; row.seen < log.length; row.seen++) {
      const [kind, name, a] = log[row.seen];
      if (kind === "run" && name === "layout.resize" && row.size[a.id]) row.size[a.id] = a.px != null ? { px: a.px } : { weight: a.weight };
    }
  };
  row.drag = (left, dx) => {
    const right = row.order[row.order.indexOf(left) + 1];
    const w = row.widths();
    const [L, R] = [row.size[left], row.size[right]];
    if (L.px != null) row.size[left] = { px: w[left] + dx };
    else if (R.px != null) row.size[right] = { px: w[right] - dx };
    else {
      const s = L.weight + R.weight;
      row.size[left] = { weight: (s * (w[left] + dx)) / (w[left] + w[right]) };
      row.size[right] = { weight: (s * (w[right] - dx)) / (w[left] + w[right]) };
    }
  };
  return row;
}

// The terminal (p1, weight 0.5), the Chat (v, p2, px 722) and its Pinned column (w, p3, opened
// with v) in an 1,806 px row, on a clock the test moves. step(ms): Herdr applies the asks, each
// pane hears its width (as on_size_change) and draws.
async function pairOn(version) {
  H.herdrVersion = version;
  const { v, cx } = await pinPane("--extra", "6");
  v.debug = false;
  state.shared["threads.byTerminal"] = { t4: { pane: "p2" } };
  let now = 1_000_000;
  const real = Date.now;
  Date.now = () => now;
  const row = herdrRow(1806, { p1: { weight: 0.5 }, p2: { px: 722 } });
  const hear = (x, c, id) => {
    const wd = row.widths()[id] - 2;
    if (Math.abs(wd - (x.paneW ?? -9)) > 1) { x.paneW = wd; x.sizeAt = now; x.fitColumn(); x.shareWidth(); }
    draw(x, c);
    c.flush(0);
  };
  const t = { v, cx, row, w: null, cxw: null, restore: () => { Date.now = real; H.herdrVersion = "0.1.17"; } };
  t.run = (ms) => {
    for (let s = 0; s < ms; s += 100) {
      now += 100;
      row.apply();
      hear(v, cx, "p2");
      if (t.w) hear(t.w, t.cxw, "p3");
      row.apply();
    }
  };
  hear(v, cx, "p2");
  H.log = [];
  row.seen = 0;
  v.key(keyEv("v"), cx);
  row.apply();
  row.order.push("p3");
  row.size.p3 = { weight: 0.5 };
  state.panes.push({ pane: "p3", tab: "A", terminal: null, mod: "agent-threads" });
  v.settleSplit(cx);
  row.apply();
  const props = state.props;
  state.props = { ...props, view: "pinned" };
  t.w = new Threads();
  t.cxw = makeCx();
  t.w.init(state.props, t.cxw);
  await settle(t.w);
  t.w.debug = false;
  state.props = props;
  return t;
}

test("on Herdr 0.1.18 the Chat and its Pinned column go on weights, with no px line in the debug log, and their divider moves only the two of them", async () => {
  const said = spyOn(console, "log");
  const t = await pairOn("0.1.18");
  try {
    t.run(4000);
    expect([t.v.weightsOk, t.w.weightsOk]).toEqual([true, true]);
    expect([t.row.size.p2.weight > 0, t.row.size.p3.weight > 0, state.shared["threads.pinPair"]?.t4?.k > 0]).toEqual([true, true, true]);
    expect(said.mock.calls.some((c) => String(c[0]).includes("stay at px"))).toBe(false);
    const was = t.row.widths();
    t.row.drag("p2", -60);
    t.run(2000);
    const now = t.row.widths();
    expect([now.p1 - was.p1, now.p2 - was.p2, now.p3 - was.p3]).toEqual([0, -60, 60]);
    expect([t.row.size.p2.weight > 0, t.row.size.p3.weight > 0, state.shared["threads.pinPair"]?.t4?.k > 0]).toEqual([true, true, true]);
  } finally { t.restore(); said.mockRestore(); }
});
