// bun test: TRD-23 slice 1, the timeline drawn across the top of the Trajectory pane, on the
// render harness (test/render-harness.js). The model it draws is timeline.js (test/timeline.test.js).
// It shows along the bottom and on the right from 540 px, 98 px tall above the list and the
// detail, once the rows are built; until then its slot holds one dim line. It starts hidden
// where it would leave fewer than four rows, and b or the heading's button shows and hides it.
// A press on it selects the step under it. The 3 px bar under each turn heading is gone.
import { test, expect, setSystemTime } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import * as TL from "../mods/agent-threads/timeline.js";
import { ALL_ROWS, SUB_ALPHA, trajInks, LEDGER_KINDS } from "../mods/agent-threads/ledger.js";
import { keySheet } from "../mods/agent-threads/ui.js";
import { alphaForTest as alpha, fixture, frame, H, handlerAfterId, keyEv, makeCx, pane, settle, setup, theme, Threads, unsliced } from "./render-harness.js";

setup();

// A Trajectory pane docked along the bottom or on the right, w px wide, its rows built whole.
async function dockPane(file, dock, w) {
  await pane(file);
  const state = H.state;
  state.shared["threads.byTerminal"] = { t4: { pane: "p2" } };
  state.panes.push({ pane: "p5", tab: "A", terminal: null, mod: "agent-threads" });
  const props = state.props;
  state.props = { ...props, view: "trajectory", dock };
  const b = unsliced(new Threads());
  const cb = makeCx();
  b.init(state.props, cb);
  await settle(b);
  state.props = props;
  b.width = w;
  b.paneW = w;
  b.rootH = 600;
  return { b, cb };
}
const ids = (c) => c.filter((e) => e[0] === "id").map((e) => e[1]);
// The calls an element made from its id to the next id, or null when it was not drawn.
const own = (c, id) => {
  const at = c.findIndex((e) => e[0] === "id" && e[1] === id);
  if (at < 0) return null;
  const end = c.findIndex((e, j) => j > at && e[0] === "id");
  return c.slice(at, end < 0 ? c.length : end);
};
const words = (calls) => (calls ?? []).filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
// The list box measured h px tall, as Herdr's size callback says after a frame.
function listTall(b, cb, h) {
  const c = frame(b, cb);
  handlerAfterId(c, "th-traj-listbox", "on_size_change")({ width: b.paneW, height: h }, cb);
}
// A frame with the list measured tall enough for the timeline, so it shows.
function shownFrame(b, cb, h = 400) {
  listTall(b, cb, h);
  return frame(b, cb);
}
// A step's bar on the drawn timeline: its turn's box and the bar's x0 and x1, in px of the strip.
function barOf(b, key) {
  const M = b.tlModel;
  const turn = b.turnOfRow(key);
  const ti = M.L.index.get(turn);
  const T = TL.tlBox(M.L, ti);
  const h = M.heads[ti];
  const si = h.stepRows.findIndex((r) => r.key === key);
  const box = TL.itemBox(h.tl, si, T.x, T.w, M.geo.walls[ti], M.L.scale, h.stepRows.length);
  return { T, box, lane: TL.TL_LANES.indexOf(LEDGER_KINDS[h.stepRows[si].lk].lane) };
}
// A press on the lanes at x px of the strip, y px from the lanes' top.
function press(b, cb, x, y) {
  const c = frame(b, cb);
  handlerAfterId(c, "th-tl-lanes", "on_mouse_down")({ local_position: { x, y }, position: { x, y } }, cb);
}

test("timeline view: along the bottom at 1440 px, 98 px across the whole pane between the filter bar and the list, with Input, Model and Tools, a number for each turn and a break between turns", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "3"), "bottom", 1440);
  const c = shownFrame(b, cb);
  const at = (id) => ids(c).indexOf(id);
  expect(at("th-timeline")).toBeGreaterThan(at("th-traj-filters"));
  expect(at("th-traj-body")).toBeGreaterThan(at("th-timeline"));
  expect([TL.TL_H, TL.TL_MIN_W]).toEqual([98, 540]);
  expect(own(c, "th-timeline")).toContainEqual(["h", 98]);
  expect(own(c, "th-timeline")).toContainEqual(["w_full"]);
  expect(words(own(c, "th-tl-gutter"))).toEqual(["Input", "Model", "Tools"]);
  // The strip: the pane less the gutter of lane names and a 12 px margin.
  expect(own(c, "th-tl-lanes")).toContainEqual(["w", 1440 - 58 - 12]);
  const heads = b.ledger().totals.heads;
  expect(heads.length).toBeGreaterThan(2);
  const labels = words(own(c, "th-tl-labels"));
  for (const h of heads) expect(labels).toContain(`${h.n}`);
  // The breaks between turns, hatched (a plain fill where Herdr has no stroked path).
  expect(ids(c)).toContain("th-tl-gaps");
  // Each lane's bars are one layer per ink: Tools and Model have some.
  expect(ids(c).some((id) => id.startsWith("th-tl-tools-tools-"))).toBe(true);
  expect(ids(c).some((id) => id.startsWith("th-tl-model-model-"))).toBe(true);
});

test("timeline view: on the right from 540 px; at 539 px and in the Chat's own pane there is none, no heading button, and b passes on", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "3"), "right", 540);
  let c = shownFrame(b, cb);
  expect(ids(c)).toContain("th-timeline");
  expect(ids(c)).toContain("th-traj-timeline");
  b.width = 539;
  b.paneW = 539;
  c = shownFrame(b, cb);
  expect(ids(c)).not.toContain("th-timeline");
  expect(ids(c)).not.toContain("th-traj-timeline");
  expect(b.ledgerAction("timeline", cb)).toBe(false);
  // The Chat's own pane, under 480 px.
  const { v, cx } = await pane(fixture("--extra", "3"));
  v.width = 460;
  v.paneW = 460;
  v.enterTraj();
  c = shownFrame(v, cx);
  expect(ids(c)).not.toContain("th-timeline");
  expect(v.ledgerAction("timeline", cx)).toBe(false);
});

test("timeline view: it starts hidden when fewer than 4 rows would be left under it; b and the heading's timeline button show and hide it; the key sheet has b from 540 px", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "3"), "bottom", 1440);
  // 3 rows and 23 px under 98 px: hidden.
  listTall(b, cb, 3 * 24 + 23 + 98);
  let c = frame(b, cb);
  expect(ids(c)).not.toContain("th-timeline");
  expect(b.trajReport().timeline).toMatchObject({ shown: false, hidden: null, rowsLeft: 3 });
  expect(ids(c)).toContain("th-traj-timeline");
  b.key(keyEv("b"), cb);
  c = frame(b, cb);
  expect(ids(c)).toContain("th-timeline");
  b.key(keyEv("b"), cb);
  c = frame(b, cb);
  expect(ids(c)).not.toContain("th-timeline");
  own(c, "th-traj-timeline").find((e) => e[0] === "on_click").at(-1)({}, cb);
  c = frame(b, cb);
  expect(ids(c)).toContain("th-timeline");
  expect(b.trajReport().timeline).toMatchObject({ shown: true, hidden: false });
  // Four whole rows: it shows from the start, and the list it leaves shorter keeps it shown.
  const p = await dockPane(fixture("--extra", "3"), "bottom", 1440);
  listTall(p.b, p.cb, 4 * 24 + 98);
  c = frame(p.b, p.cb);
  expect(ids(c)).toContain("th-timeline");
  handlerAfterId(c, "th-traj-listbox", "on_size_change")({ width: 1440, height: 4 * 24 }, p.cb);
  expect(ids(frame(p.b, p.cb))).toContain("th-timeline");
  expect(p.b.trajReport().timeline).toMatchObject({ shown: true, hidden: null, rowsLeft: 4 });
  const sheet = (o) => keySheet("q", { ledger: true, ...o }).flatMap(([, rows]) => rows).map(([k, w]) => `${k.join(" ")}: ${w}`);
  expect(sheet({ timeline: true })).toContain("b: Show or hide the timeline");
  expect(sheet({}).some((x) => x.startsWith("b:"))).toBe(false);
});

test("timeline view: while the rows are built its slot keeps 98 px and holds one dim line saying it waits for the session, then the timeline", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "3"), "bottom", 1440);
  listTall(b, cb, 400);
  // A turn a slice, from the first build.
  b.ledgerMemo = null;
  b.ledgerJob = null;
  b.turnLedger = new WeakMap();
  b.buildMax = () => -1;
  let c = frame(b, cb);
  expect(b.ledger().partial).toBe(true);
  expect(own(c, "th-timeline")).toContainEqual(["h", 98]);
  expect(words(own(c, "th-tl-wait"))).toEqual(["The timeline shows once the whole session is read"]);
  expect(own(c, "th-tl-wait")).toContainEqual(["text_color", theme.dim]);
  expect(ids(c)).not.toContain("th-tl-lanes");
  expect(b.trajReport().timeline.waiting).toBe(true);
  b.buildMax = () => 1e9;
  for (let n = 0; b.ledgerJob && n < 50; n++) c = frame(b, cb);
  c = frame(b, cb);
  expect(ids(c)).not.toContain("th-tl-wait");
  expect(ids(c)).toContain("th-tl-lanes");
});

test("timeline view: the selected step's bar has an outline and its turn the band, and both follow the selection", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "3"), "bottom", 1440);
  shownFrame(b, cb);
  const rows = b.ledgerRows();
  const step = rows.find((r) => r.kind === "tr" && r.lk === "tool" && r.start != null && r.dur > 0);
  b.tsel = step.key;
  let c = frame(b, cb);
  const { T, box } = barOf(b, step.key);
  const sel = own(c, "th-tl-sel");
  expect(sel).toContainEqual(["left", box.x0 - 2]);
  expect(sel).toContainEqual(["w", box.x1 - box.x0 + 4]);
  expect(sel).toContainEqual(["border_color", theme.foreground]);
  expect(own(c, "th-tl-band")).toContainEqual(["left", Math.max(0, T.x)]);
  // A heading of another turn: its band, and no outline.
  const other = rows.find((r) => r.kind === "trh" && r.key !== b.turnOfRow(step.key));
  b.tsel = other.key;
  c = frame(b, cb);
  expect(ids(c)).not.toContain("th-tl-sel");
  const ti = b.tlModel.L.index.get(other.key);
  expect(own(c, "th-tl-band")).toContainEqual(["left", Math.max(0, TL.tlBox(b.tlModel.L, ti).x)]);
});

test("timeline view: a press on a bar selects its step and scrolls the list to it, a press on the selected step shows or hides the detail, and a press with no bar within 4 px selects the turn's heading", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "3"), "bottom", 1440);
  shownFrame(b, cb);
  const rows = b.ledgerRows();
  const step = rows.find((r) => r.kind === "tr" && r.lk === "tool" && r.start != null && r.dur > 0);
  const { T, box, lane } = barOf(b, step.key);
  const y = lane * 16 + 8;
  b.tsel = null;
  press(b, cb, (box.x0 + box.x1) / 2, y);
  expect([b.tsel, b.tscrollTo]).toEqual([step.key, step.key]);
  const open = b.detailOpen();
  press(b, cb, (box.x0 + box.x1) / 2, y);
  expect([b.tsel, b.detailOpen()]).toEqual([step.key, !open]);
  press(b, cb, (box.x0 + box.x1) / 2, y);
  expect(b.detailOpen()).toBe(open);
  // Somewhere in the turn with no Tools bar within 4 px.
  const M = b.tlModel;
  let x = null;
  for (let px = Math.ceil(T.x); px < T.x + T.w && x == null; px++) {
    const hit = TL.timelineHit(M.L, M.heads, px, "tools");
    if (hit && hit.key === hit.turn && hit.turn === b.turnOfRow(step.key)) x = px;
  }
  expect(x).not.toBe(null);
  press(b, cb, x, 2 * 16 + 8);
  expect(b.tsel).toBe(b.turnOfRow(step.key));
});

test("timeline view: a press on a step the filter hides selects its turn's heading instead", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "3"), "bottom", 1440);
  shownFrame(b, cb);
  const step = b.ledgerRows().find((r) => r.kind === "tr" && r.lk === "tool" && r.start != null && r.dur > 0);
  const { box, lane } = barOf(b, step.key);
  b.tfilter = { ...ALL_ROWS, tools: false };
  b.tsel = null;
  press(b, cb, (box.x0 + box.x1) / 2, lane * 16 + 8);
  expect(b.tsel).toBe(b.turnOfRow(step.key));
  expect(b.tscrollTo).toBe(b.turnOfRow(step.key));
});

test("timeline view: a failed call is red, a subagent's at 45%, and the running turn's unfinished call has a torn end that grows to now while the other turns keep their places", async () => {
  const { b, cb } = await dockPane(fixture("--subagents"), "bottom", 1440);
  let c = shownFrame(b, cb);
  const inks = trajInks(theme, true);
  const layer = (lane, ink) => ids(c).filter((id) => id.startsWith(`th-tl-${lane}-${ink}-`));
  expect(layer("tools", "sub").length).toBeGreaterThan(0);
  for (const id of layer("tools", "sub")) expect(own(c, id)).toContainEqual(["bg", alpha(inks.sub, SUB_ALPHA)]);
  expect(layer("tools", "failed").length).toBeGreaterThan(0);
  for (const id of layer("tools", "failed")) expect(own(c, id)).toContainEqual(["bg", theme.blocked]);
  // A session cut just after a call: the newest turn runs, its call has no result yet.
  const file = fixture("--only", "3");
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const last = lines.findLastIndex((l) => l.includes('"tool_use"'));
  writeFileSync(file, `${lines.slice(0, last + 1).join("\n")}\n`);
  const r = await dockPane(file, "bottom", 1440);
  H.state.terminals[0].status = "working";
  r.b.ledgerMemo = null;
  const L = r.b.ledger();
  expect(L.going).toBe(true);
  const { t0, span } = L.totals.heads.at(-1);
  // Two moments past the call's start, inside the running turn's room (timeline.js liveRoom).
  const room = TL.liveRoom(span);
  expect(room).toBeGreaterThan(span);
  try {
    setSystemTime(new Date(t0 + span + (room - span) / 3));
    shownFrame(r.b, r.cb);
    const m1 = r.b.tlModel;
    expect(m1.grow.length).toBe(1);
    c = frame(r.b, r.cb);
    expect(own(c, "th-tl-grow-0")).toContainEqual(["bg", inks.tools]);
    const a = m1.grow[0].x1;
    setSystemTime(new Date(t0 + span + (2 * (room - span)) / 3));
    frame(r.b, r.cb);
    const m2 = r.b.tlModel;
    expect(m2.geo).toBe(m1.geo);
    expect(m2.grow[0].x1).toBeGreaterThan(a);
    expect(r.b.trajReport().timeline.grow.length).toBe(1);
  } finally {
    setSystemTime();
    H.state.terminals[0].status = "idle";
  }
});

test("timeline view: the debug report's traj.timeline says whether it shows, and what the last draw laid out and how long it took", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "3"), "bottom", 1440);
  shownFrame(b, cb);
  const tl = b.trajReport().timeline;
  expect(Object.keys(tl).sort()).toEqual(["can", "cw", "drawn", "grow", "hidden", "labels", "layers", "live", "made", "ms", "rowsLeft", "shown", "spans", "turns", "waiting"]);
  expect(Object.keys(tl.made).sort()).toEqual(["geo", "layout"]);
  expect(tl).toMatchObject({ can: true, shown: true, waiting: false, cw: 1370, turns: b.ledger().totals.heads.length, live: -1, grow: [] });
  expect(tl.spans).toBeGreaterThan(0);
  expect(tl.layers).toBeGreaterThan(0);
  expect(tl.layers).toBeLessThan(20);
  expect(typeof tl.ms).toBe("number");
});

test("heading bar: gone at every width: a heading keeps no line, and no heading row draws one, its row a whole 24 px", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "3"), "bottom", 1440);
  const heads = b.ledger().totals.heads;
  for (const h of heads) expect("line" in h).toBe(false);
  const noLine = (c) => {
    for (const h of heads) {
      expect(ids(c)).not.toContain(`${h.key}-line`);
      expect(ids(c).some((id) => id.startsWith(`${h.key}-tools-`) || id.startsWith(`${h.key}-model-`))).toBe(false);
    }
  };
  // A heading's own row was 24 less the 3 px bar.
  const short = (c) => c.some((e) => e[0] === "h" && e[1] === 21);
  let c = shownFrame(b, cb);
  noLine(c);
  expect(short(c)).toBe(false);
  const { v, cx } = await pane(fixture("--extra", "3"));
  v.enterTraj();
  for (const w of [600, 460, 150]) {
    v.width = w;
    v.paneW = w;
    c = frame(v, cx);
    noLine(c);
    expect([w, short(c)]).toEqual([w, false]);
  }
});

test("timeline view: a selection change and a press reuse the placed turns and their layout: nothing is placed again", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "3"), "bottom", 1440);
  shownFrame(b, cb);
  const M = b.tlModel;
  const made = { ...TL.TL_MADE };
  const rows = b.ledgerRows().filter((r) => r.kind === "tr");
  for (const r of rows.slice(0, 5)) { b.tsel = r.key; frame(b, cb); }
  b.key(keyEv("j"), cb);
  frame(b, cb);
  const step = rows.find((r) => r.lk === "tool" && r.start != null && r.dur > 0);
  const { box, lane } = barOf(b, step.key);
  press(b, cb, (box.x0 + box.x1) / 2, lane * 16 + 8);
  press(b, cb, (box.x0 + box.x1) / 2, lane * 16 + 8);
  frame(b, cb);
  expect([TL.TL_MADE.geo - made.geo, TL.TL_MADE.layout - made.layout]).toEqual([0, 0]);
  expect(b.tlModel.geo).toBe(M.geo);
  expect(b.tlModel.L).toBe(M.L);
  expect(b.trajReport().timeline.made).toEqual({ ...TL.TL_MADE });
});

test("timeline view: every turn number and tick the model gives is drawn, not the first 80, and the fail marks are one layer across the whole strip", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "3"), "bottom", 2600);
  shownFrame(b, cb);
  // n made-up turns, each with a failed call, in the layout's shape.
  const made = (n) => Array.from({ length: n }, (_, i) => {
    const key = `0:${i}`;
    return {
      kind: "trh", key, n: i + 1, t0: 1e12 + i * 100000, total: 60000, span: 60000, going: false,
      cnt: { steps: 2, input: 0, model: 0, tools: 2, failed: 1, user: 0, agent: 0 },
      stepRows: [{ kind: "tr", key: `tr:${key}:0`, lk: "tool" }, { kind: "tr", key: `tr:${key}:1`, lk: "failed", failed: true }],
      tl: [1000, 5000, 0, 6000, 9000, 4],
    };
  });
  const view = (heads) => {
    H.rec = [];
    b.timelineView(theme, { totals: { heads }, partial: false }, [], -1, trajInks(theme, true));
    const c = H.rec;
    H.rec = null;
    return c;
  };
  // 85 turns on a 2,530 px strip: each over 24 px wide, so each has its number.
  let c = view(made(85));
  let T = b.tlModel.L;
  expect(T.labels.length).toBeGreaterThan(80);
  expect(words(own(c, "th-tl-labels")).length).toBe(T.labels.length);
  expect(words(own(c, "th-tl-ticks")).length).toBe(T.ticks.length);
  // 400: a fail mark for nearly every turn, more than 120.
  c = view(made(400));
  T = b.tlModel.L;
  expect(T.fails.length).toBeGreaterThan(120);
  // One layer: in Herdr one painted path; here its divs, which reach the last mark.
  const fails = own(c, "th-tl-fails");
  expect(fails).not.toBe(null);
  const lefts = fails.filter((e) => e[0] === "left").map((e) => e[1]);
  const ws = fails.filter((e) => e[0] === "w").map((e) => e[1]);
  expect(Math.max(...lefts.slice(1).map((x, k) => x + ws[k + 1]))).toBeGreaterThanOrEqual(T.fails.at(-1) + 3 - 0.5);
  expect(fails).toContainEqual(["bg", theme.blocked]);
});

test("timeline view: at 2,000 turns the strip has numbers, thinned to every k-th turn, and the selected turn's number is drawn wherever it is", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "3"), "bottom", 1440);
  shownFrame(b, cb);
  const heads = Array.from({ length: 2000 }, (_, i) => {
    const key = `0:${i}`;
    return {
      kind: "trh", key, n: i + 1, t0: 1e12 + i * 100000, total: 60000, span: 60000, going: false,
      cnt: { steps: 1, input: 0, model: 0, tools: 1, failed: 0, user: 0, agent: 0 },
      stepRows: [{ kind: "tr", key: `tr:${key}:0`, lk: "tool" }],
      tl: [1000, 5000, 0],
    };
  });
  const view = (shown) => {
    H.rec = [];
    b.timelineView(theme, { totals: { heads }, partial: false }, shown, 0, trajInks(theme, true));
    const c = H.rec;
    H.rec = null;
    return words(own(c, "th-tl-labels"));
  };
  const none = view([]);
  const T = b.tlModel.L;
  expect(none.length).toBeGreaterThanOrEqual(10);
  expect(none).toEqual(T.labels.map((l) => l.text));
  expect(none[0]).toBe("1");
  for (const w of none.slice(1)) expect(Number(w) % T.every).toBe(0);
  // A turn selected, by its heading or one of its steps: its number is drawn too.
  for (const key of ["0:1233", "tr:0:1233:0", "0:1", "0:1999", "0:0"]) {
    const ti = Number(b.turnOfRow(key).split(":")[1]);
    const drawn = view([{ key }]);
    expect(drawn).toContain(`${ti + 1}`);
    expect(drawn).toEqual(TL.tlNumbers(T, heads, ti).map((l) => l.text));
  }
});

test("timeline view: a press on a failed call drawn over other calls selects it and outlines it, not a call under it", async () => {
  const { b, cb } = await dockPane(fixture("--extra", "3", "--subagents"), "bottom", 1440);
  shownFrame(b, cb);
  const rows = b.ledgerRows();
  // A failed call with another call's bar under its middle.
  const M = b.tlModel;
  let failed = null;
  for (const r of rows.filter((x) => x.kind === "tr" && x.lk === "failed")) {
    const { T, box } = barOf(b, r.key);
    const ti = M.L.index.get(b.turnOfRow(r.key));
    const h = M.heads[ti];
    const mid = (box.x0 + box.x1) / 2;
    const under = h.stepRows.some((s, si) => s.key !== r.key && LEDGER_KINDS[s.lk]?.lane === "tools" && (() => {
      const o = TL.itemBox(h.tl, si, T.x, T.w, M.geo.walls[ti], M.L.scale, h.stepRows.length);
      return o && o.x0 <= mid && o.x1 >= mid;
    })());
    if (under) { failed = r; break; }
  }
  expect(failed).not.toBe(null);
  const { box, lane } = barOf(b, failed.key);
  press(b, cb, (box.x0 + box.x1) / 2, lane * 16 + (box.track ? 11 : 8));
  expect(b.tsel).toBe(failed.key);
  const c = frame(b, cb);
  expect(own(c, "th-tl-sel")).toContainEqual(["left", box.x0 - 2]);
  expect(own(c, "th-tl-sel")).toContainEqual(["w", box.x1 - box.x0 + 4]);
});
