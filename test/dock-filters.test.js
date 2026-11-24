// bun test: the Trajectory's filter bar along the bottom dock, on the render harness
// (test/render-harness.js). From WIDE_MIN (900 px) its Failed and User buttons say "Failed only"
// and "User only" with counts. The pane's size callback waits for more than 1 px unless the
// change crosses one of the layout's thresholds, so 900 px has to be one of them along the
// bottom too, or a 1 px move across it leaves the bar as it was.
import { test, expect } from "bun:test";
import { WIDE_MIN } from "../mods/agent-threads/ledger.js";
import { fixture, frame, H, handlerAfterId, makeCx, pane, settle, setup, Threads } from "./render-harness.js";

setup();

// A Trajectory pane along the bottom, w px wide.
async function bottomPane(w) {
  await pane(fixture("--extra", "3"));
  const state = H.state;
  state.shared["threads.byTerminal"] = { t4: { pane: "p2" } };
  state.panes.push({ pane: "p5", tab: "A", terminal: null, mod: "agent-threads" });
  const props = state.props;
  state.props = { ...props, view: "trajectory", dock: "bottom" };
  const b = new Threads();
  const cb = makeCx();
  b.init(state.props, cb);
  await settle(b);
  state.props = props;
  b.width = w;
  b.paneW = w;
  b.rootH = 400;
  return { b, cb };
}

// The filter bar's button labels, as drawn.
function filterLabels(b, cb) {
  const c = frame(b, cb);
  const at = c.findIndex((e) => e[0] === "id" && e[1] === "th-traj-filters");
  expect(at).toBeGreaterThan(-1);
  return c.slice(at).filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
}

test("TRD-24: along the bottom a 1 px size change across 900 px counts both ways, and the filter bar's labels follow it", async () => {
  expect(WIDE_MIN).toBe(900);
  for (const [from, to] of [[899, 900], [900, 899]]) {
    const { b, cb } = await bottomPane(from);
    const c = frame(b, cb);
    handlerAfterId(c, "threads-root", "on_size_change")({ width: to, height: 400 }, cb);
    expect([from, to, b.paneW]).toEqual([from, to, to]);
    const wide = filterLabels(b, cb).some((s) => s.includes("Failed only"));
    expect([from, to, wide]).toEqual([from, to, to >= 900]);
  }
});
