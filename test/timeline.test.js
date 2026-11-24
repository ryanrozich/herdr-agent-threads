// bun test: the Trajectory's timeline as data (timeline.js, TRD-23 part 1): each heading's steps
// as one plain number array, three a step (ledger.js ledgerTurn), the turns placed on a strip (timelineGeo), a view of them
// (timelineLayout), the zoom and pan kept inside the session, a press found on a bar
// (timelineHit), the torn end, and a running turn whose bars grow without the rest moving
// (timelineModel, tlGrow). Nothing here draws. The turns are made up in the reader's shape
// (turns.js), as in test/ledger.test.js.
import { test, expect } from "bun:test";
import { ledgerTurn, slantPoints } from "../mods/agent-threads/ledger.js";
// As a namespace, so a name the module lacks fails only the tests that use it.
import * as TL from "../mods/agent-threads/timeline.js";

const {
  TL_LANES, TL_ROOM_MIN, TL_ROOM_GROW, liveRoom, timelineGeo, timelineLayout, timelineHit, itemBox, tlMaxZoom, tlClamp, tlZoomAt, tlBox, bandRows,
  tornPoints, polyRows, timelineModel, tlGrow, tlStep,
} = TL;

const T0 = Date.parse("2026-11-01T09:00:00Z");
// A turn in the reader's shape: steps are [text] or [calls], each call [name, input, at, rt, failed].
function turn(n, steps, o = {}) {
  const out = [];
  for (const st of steps) {
    if (typeof st === "string") { out.push({ k: "text", t: st, at: o.untimed ? undefined : T0 + 1000 }); continue; }
    out.push({
      k: "group", calls: st.map((c) => c[0]), count: st.length, ids: st.map((_, i) => `call_${n}_${out.length}_${i}`),
      info: st.map(([, input, at, rt, f]) => ({ in: input, at: at == null ? null : T0 + at, rt: rt == null ? null : T0 + rt, f: f ?? null })),
      ...(o.agent ? { agent: true } : {}),
    });
  }
  return {
    n, prompt: o.prompt ?? `Prompt ${n}`, ts: T0, endTs: o.end === undefined ? T0 + 60000 : o.end, done: o.done ?? true,
    after: o.reply === null ? [] : [o.reply ?? "Done."], afterAt: o.untimed ? null : T0 + 55000, steps: out, usage: { m: { i: 100, o: 50, cr: 0, cc: 0 } },
    ...(o.interrupted ? { interrupted: true } : {}), ...(o.latest ? { latest: o.latest } : {}), ...(o.who ? { agent: true, sender: { kind: "peer", name: o.who } } : {}),
  };
}
const S = { agents: new Map(), agentIds: new Map() };
const head = (t, live = false, s = S) => ledgerTurn(s, t, 0, live).rows[0];
// A heading's steps read back, one object each, for the tests only (the pane keeps none).
const stepsOf = (h) => h.stepRows.map((_, i) => tlStep(h, i));

test("timeline steps: a heading keeps its steps' times as one plain number array, three a step, made in the turn's own pass", () => {
  const { rows } = ledgerTurn(S, turn(3, ["Looking first.", [["Read", "src/a.ts", 2000, 2300], ["Bash", "bun test", 2100, 45000, true]]]), 0);
  const [h, ...steps] = rows;
  expect(TL_LANES).toEqual(["input", "model", "tools"]);
  // No object per step: the heading holds its step rows (the same rows, in order) and tl, a
  // plain array of [a, b, flags] a step: ms from the turn's start, NaN for none; flags 1 for
  // the second track, 2 for an unfinished call, 4 for a failed one.
  expect(h.items).toBe(undefined);
  expect(h.stepRows.length).toBe(steps.length);
  expect(h.stepRows.every((r, i) => r === steps[i])).toBe(true);
  expect(Array.isArray(h.tl)).toBe(true);
  expect(h.tl.length).toBe(3 * steps.length);
  expect(h.tl.every((x) => typeof x === "number")).toBe(true);
  const at = (lk) => steps.findIndex((r) => r.lk === lk);
  const three = (i) => h.tl.slice(3 * i, 3 * i + 3);
  expect(three(at("you"))).toEqual([0, Number.NaN, 0]);
  expect(three(at("text"))).toEqual([1000, Number.NaN, 0]);
  expect(three(at("tool"))).toEqual([2000, 2300, 0]);
  // Bash starts while Read runs: the second track, drawn half height; and it failed.
  expect(three(at("failed"))).toEqual([2100, 45000, 1 | 4]);
  // Read back with the row's key, kind, lane and ink.
  expect(tlStep(h, at("failed"))).toMatchObject({ i: at("failed"), key: steps[at("failed")].key, lk: "failed", lane: "tools", ink: "failed", a: 2100, b: 45000, track: 1, open: false, failed: true });
  expect(tlStep(h, at("you"))).toMatchObject({ lane: "input", a: 0, b: null, track: 0 });
  // The span keys are one shared pair per lane and ink, not an array per step.
  const other = head(turn(4, [[["Grep", "x", 3000, 4000]]]));
  expect(tlStep(other, 1).sk).toBe(tlStep(h, at("tool")).sk);
  expect(tlStep(h, at("tool")).sk).toEqual(["tools|tools|0", "tools|tools|1"]);
  // An interrupted turn's Interrupted row is no bar.
  const sh = head(turn(5, [[["Read", "a", 2000, 2500]]], { interrupted: true, reply: null, end: T0 + 40000 }));
  expect(tlStep(sh, sh.stepRows.findIndex((r) => r.lk === "stop"))).toMatchObject({ lane: null, sk: null });
  // A call with no result yet: flag 2.
  const oh = head(turn(6, [[["Bash", "sleep", 6000, null]]], { done: false, end: null, reply: null }), true);
  const oi = oh.stepRows.findIndex((r) => r.open);
  expect(oh.tl.slice(3 * oi, 3 * oi + 3)).toEqual([6000, Number.NaN, 2]);
  expect(tlStep(oh, oi).open).toBe(true);
});

test("timeline: a turn as wide as it took, a break between turns, bars on Input, Model and Tools, joined where they touch", () => {
  // Turn 1 takes 60 s, turn 2 120 s; a call in turn 2 runs while another does (track 1).
  const a = head(turn(1, ["Looking.", [["Bash", "x", 6000, 12000, true]]]));
  const b = head(turn(2, [[["Read", "y", 6000, 60000], ["Grep", "z", 10000, 20000]]], { end: T0 + 120000 }));
  const L = timelineLayout([a, b], 600, "clock");
  expect(L.turns.length).toBe(2);
  expect(L.gaps.length).toBe(1);
  expect(L.gaps[0][1] - L.gaps[0][0]).toBe(14);
  expect(L.total).toBeCloseTo(600, 0);
  expect(L.turns[1].w / L.turns[0].w).toBeCloseTo(2, 1);
  // The failed call is its own span in the Tools lane; the overlapping call is on track 1.
  expect(L.spans.get("tools|failed|0").length).toBe(1);
  expect(L.spans.get("tools|tools|1").length).toBe(1);
  expect(L.spans.get("input|user|0").length).toBe(2);
  expect(L.spans.has("model|model|0")).toBe(true);
  // The failed call's marker, and the labels.
  expect(L.fails.length).toBe(1);
  expect(L.labels.map((l) => l.text)).toEqual(["1", "2"]);
  // A press on the failed call's bar finds its row; on an empty lane, the turn's heading.
  const fx = (L.spans.get("tools|failed|0")[0][0] + L.spans.get("tools|failed|0")[0][1]) / 2;
  expect(timelineHit(L, [a, b], fx, "tools").key).toBe(stepsOf(a).find((it) => it.failed).key);
  expect(timelineHit(L, [a, b], L.turns[1].x + L.turns[1].w - 1, "input").key).toBe(b.key);
  // Steps: every step the same width.
  const St = timelineLayout([a, b], 600, "steps");
  expect(St.turns[0].w / a.stepRows.length).toBeCloseTo(St.turns[1].w / b.stepRows.length, 6);
  expect(St.ticks.every((t) => t.step)).toBe(true);
});

test("timeline: a call with no result in a turn that is not running runs flat to its last activity; a long session is one span per lane per turn under 2 px", () => {
  // Not running (the running rule): the turn ends at its last recorded event, and so does the bar.
  const t = turn(3, [[["Bash", "sleep", 6000, null]], [["Read", "a", 7000, 8000]]], { done: false, end: null, reply: null });
  const h = head(t, false);
  const open = stepsOf(h).find((it) => it.open);
  expect(open).toBeTruthy();
  const L = timelineLayout([h], 400, "clock", T0 + 100000);
  const torn = L.spans.get("tools|tools|0").filter((sp) => sp[2] === 1);
  expect(torn.length).toBe(1);
  expect(torn[0][1]).toBeCloseTo(L.turns[0].w, 3);
  expect(L.grow).toEqual([]);
  // 6,000 turns: each under 2 px, so the layout walks turns, not steps, and draws few spans.
  const one = head(turn(4, ["a", [["Bash", "x", 1000, 2000, true]]]));
  const heads = Array.from({ length: 6000 }, (_, i) => ({ ...one, key: `0:${i + 1}`, n: i + 1, t0: T0 + i * 120000 }));
  const t0 = performance.now();
  const big = timelineLayout(heads, 500, "clock");
  const ms = performance.now() - t0;
  expect(big.turns.length).toBe(6000);
  let spans = 0;
  for (const list of big.spans.values()) spans += list.length;
  expect(spans).toBeLessThan(500);
  expect(big.fails.length).toBeLessThanOrEqual(500 / 6 + 1);
  expect(ms).toBeLessThan(200);
});

// Round 7 decisions, section 2: an unfinished call is mark 1, the torn end.
test("torn end: 3 teeth 4 px tall and 5 px deep; 3 px deep under 12 px wide; a half-height bar 2 teeth 3 px deep; left corners cut 1 px", () => {
  const right = (pts) => pts.filter(([x]) => x === 100);
  const wide = tornPoints(20, 100, 12);
  expect(right(wide).map(([, y]) => y)).toEqual([2, 6, 10]);
  expect(Math.min(...wide.map(([x]) => x).filter((x) => x > 50))).toBe(95);
  expect(wide.slice(0, 2)).toEqual([[20, 1], [21, 0]]);
  expect(wide.slice(-2)).toEqual([[21, 12], [20, 11]]);
  const narrow = tornPoints(0, 10, 12);
  expect(right(narrow.map(([x, y]) => [x * 10, y])).length).toBe(3);
  expect(Math.min(...narrow.map(([x]) => x).filter((x) => x > 5))).toBe(7);
  const half = tornPoints(0, 100, 6);
  expect(right(half).map(([, y]) => y)).toEqual([1.5, 4.5]);
  expect(Math.min(...half.map(([x]) => x).filter((x) => x > 50))).toBe(97);
  // As whole-pixel rows (a Herdr with no filled path): the tips reach the end, the roots are
  // 5 px in, and nothing is drawn past the bar.
  const rows = polyRows(wide, 12);
  const at = (y) => rows.find((r) => y >= r.y && y < r.y + r.h);
  expect(rows.reduce((a, r) => a + r.h, 0)).toBe(12);
  expect(Math.max(...rows.map((r) => r.x1))).toBeLessThanOrEqual(100);
  expect(at(0).x1).toBeLessThan(96.5);
  expect(at(2).x1).toBeGreaterThan(98.5);
  expect(at(4).x1).toBeLessThan(96.5);
  expect(at(6).x0).toBe(20);
  expect(polyRows(slantPoints(0, 56, 4, 5), 4).map((r) => Math.round(r.x1 * 8) / 8)).toEqual([55.375, 54.125, 52.875, 51.625]);
});

test("torn end on the timeline: an unfinished call's span is torn and never under 6 px; a finished one is not", () => {
  const ended = head(turn(7, [[["Read", "a", 2000, 2500], ["Bash", "bun run e2e", 3000, null]]], { interrupted: true, reply: null, end: T0 + 40000 }));
  const it = stepsOf(ended).find((x) => x.open);
  expect(it.lk).toBe("noresult");
  const L = timelineLayout([ended], 400, "clock");
  const torn = L.spans.get("tools|tools|0").filter((sp) => sp[2] === 1);
  expect(torn.length).toBe(1);
  expect(torn[0][1]).toBeCloseTo(L.turns[0].w, 3);
  // A call started at the turn's very end: 6 px, not 3.
  const box = itemBox([99990, Number.NaN, 2], 0, 0, 400, 100000, "clock", 4);
  expect(box.x1 - box.x0).toBe(6);
  expect(box.open).toBe(true);
  expect(itemBox([99990, Number.NaN, 0], 0, 0, 400, 100000, "clock", 4).x1 - 394).toBeLessThanOrEqual(6);
  const done = head(turn(6, [[["Read", "a", 2000, 2500]]]));
  expect([...timelineLayout([done], 400, "clock").spans.values()].flat().some((sp) => sp[2])).toBe(false);
});

test("torn end: a subagent whose run has no end yet is unfinished too, on the subagent's ink; one that ended is not", () => {
  const t = turn(8, [[["Agent", "Review the range math", 2000, null]]], { agent: true, done: false, end: null, reply: null });
  const id = t.steps[0].ids[0];
  const s = { agents: new Map([[id, { st: "async_launched", tok: null, ms: null }]]), agentIds: new Map() };
  const h = head(t, true, s);
  const r = stepsOf(h).find((x) => x.lk === "subagent");
  expect(r).toMatchObject({ open: true, ink: "sub" });
  // Running: its bar is a growing one, on the subagent's span key.
  const L = timelineLayout([h], 400, "clock", T0 + 30000);
  expect(L.grow.map((g) => g.k)).toEqual(["tools|sub|0"]);
  const done = { agents: new Map([[id, { st: "completed", tok: 1000, ms: 9000 }]]), agentIds: new Map() };
  expect(stepsOf(head(t, true, done)).find((x) => x.lk === "subagent").open).toBe(false);
});

test("timeline running turn: only the last turn moves; the strip keeps its places until the turn outgrows its room", () => {
  expect([TL_ROOM_MIN, TL_ROOM_GROW]).toEqual([10000, 1.5]);
  expect([0, 10000, 10001, 15000, 100000].map(liveRoom)).toEqual([10000, 10000, 15000, 15000, 113906.25]);
  const a = head(turn(1, ["Looking.", [["Bash", "x", 6000, 12000]]]));
  const b = head(turn(2, [[["Read", "y", 6000, 9000]]], { end: T0 + 120000 }));
  const live = head(turn(3, [[["Read", "a", 2000, 2500], ["Bash", "bun run e2e", 3000, null]]], { done: false, end: null, reply: null }), true);
  expect(live.going).toBe(true);
  const heads = [a, b, live];
  const at = live.t0 + 10500;
  const m1 = timelineModel(null, heads, 600, "clock", at);
  // The running turn is placed at its room (10.5 s elapsed: 15 s), so the strip does not
  // refit each second.
  expect(m1.geo.live).toBe(2);
  expect(m1.geo.room).toBe(15000);
  expect(m1.grow.length).toBe(1);
  const T = m1.L.turns[2];
  const tx = T.x * m1.L.z - m1.L.x0;
  expect(m1.grow[0].x1).toBeCloseTo(tx + (10500 / 15000) * T.w, 3);
  // A second later: the same placing and the same layout; only the growing bar is new.
  const m2 = timelineModel(m1, heads, 600, "clock", at + 1000);
  expect(m2.geo).toBe(m1.geo);
  expect(m2.L).toBe(m1.L);
  expect(m2.grow[0].x0).toBe(m1.grow[0].x0);
  expect(m2.grow[0].x1).toBeCloseTo(tx + (11500 / 15000) * T.w, 3);
  expect(m2.grow).toEqual(tlGrow(m1.L, at + 1000));
  // The running call's bar is not also a torn span in the layout.
  expect((m1.L.spans.get("tools|tools|0") ?? []).some((sp) => sp[2] === 1)).toBe(false);
  // A press on the growing bar finds it; past its end (the room still empty), the heading.
  const hitX = (m2.grow[0].x0 + m2.grow[0].x1) / 2;
  expect(timelineHit(m2.L, heads, hitX, "tools", at + 1000).key).toBe(stepsOf(live).find((it) => it.open).key);
  expect(timelineHit(m2.L, heads, tx + T.w - 1, "tools", at + 1000).key).toBe(live.key);
  // Past its room the turn gets the next one, and the strip is placed again, once.
  expect(tx + T.w - 1 - m2.grow[0].x1).toBeGreaterThan(4);
  const m3 = timelineModel(m2, heads, 600, "clock", live.t0 + 16000);
  expect(m3.geo).not.toBe(m2.geo);
  expect(m3.geo.room).toBe(22500);
  expect(timelineModel(m3, heads, 600, "clock", live.t0 + 17000).geo).toBe(m3.geo);
  // A new width, scale or session places it again; a turn that is not running never grows.
  expect(timelineModel(m3, heads, 601, "clock", live.t0 + 17000).geo).not.toBe(m3.geo);
  expect(timelineModel(m3, [...heads], 600, "clock", live.t0 + 17000).geo).not.toBe(m3.geo);
  const ab = [a, b];
  const still = timelineModel(null, ab, 600, "clock", at);
  expect([still.geo.live, still.geo.room, still.grow]).toEqual([-1, 0, []]);
  expect(timelineModel(still, ab, 600, "clock", at + 60000).L).toBe(still.L);
  // By steps nothing grows: an unfinished call fills its step.
  const st = timelineModel(null, heads, 600, "steps", at);
  expect([st.geo.live, st.grow]).toEqual([-1, []]);
  expect(st.L.spans.get("tools|tools|0").some((sp) => sp[2] === 1)).toBe(true);
});

test("timeline view: zoom from 1 to four steps across, the pan kept inside the session, a zoom about a point, a turn's box", () => {
  const heads = Array.from({ length: 10 }, (_, i) => head(turn(i + 1, ["a", [["Read", "x", 2000, 3000], ["Bash", "y", 4000, 9000]]])));
  const steps = heads.reduce((n, h) => n + h.stepRows.length, 0);
  const geo = timelineGeo(heads, 500, "clock");
  expect(geo.steps).toBe(steps);
  expect(tlMaxZoom(geo)).toBe(steps / 4);
  expect(tlClamp(geo, { z: 0.2, x0: -50 })).toEqual({ z: 1, x0: 0 });
  expect(tlClamp(geo, { z: 1e9, x0: 1e9 })).toEqual({ z: steps / 4, x0: geo.total * (steps / 4) - 500 });
  // A pinch about 100 px keeps the moment under it there.
  const v = tlZoomAt(geo, { z: 1, x0: 0 }, 2, 100);
  expect(v.z).toBe(2);
  expect((100 + v.x0) / v.z).toBeCloseTo(100, 6);
  // The keys put the moment in the middle; a view that would start before the session is
  // held at its start.
  const mid = tlZoomAt(geo, { z: 1, x0: 0 }, 2, 200, 250);
  expect((250 + mid.x0) / mid.z).toBeCloseTo(200, 6);
  expect(tlZoomAt(geo, { z: 1, x0: 0 }, 2, 100, 250).x0).toBe(0);
  const L = timelineLayout(heads, 500, "clock", Date.now(), { z: 4, x0: 800 }, geo);
  expect(tlBox(L, 3)).toEqual({ x: geo.turns[3].x * 4 - 800, w: geo.turns[3].w * 4 });
  expect(tlBox(L, 99)).toBe(null);
  // Only the turns in view (and a margin) are walked.
  expect(L.from).toBeGreaterThan(0);
  expect(L.to).toBeLessThan(heads.length - 1);
});

test("timeline band: the first and last steps whose bars start inside a band, in order; none when no bar starts there", () => {
  const heads = [1, 2, 3].map((n) => head(turn(n, ["a", [["Read", "x", 2000, 3000], ["Bash", "y", 30000, 40000]]])));
  const L = timelineLayout(heads, 600, "clock");
  const box = (ti, it) => itemBox(heads[ti].tl, it.i, L.turns[ti].x, L.turns[ti].w, L.geo.walls[ti], "clock", heads[ti].stepRows.length);
  const read2 = stepsOf(heads[1]).find((it) => it.lk === "tool");
  const bash2 = stepsOf(heads[1]).filter((it) => it.lk === "tool")[1];
  const b = bandRows(L, heads, box(1, read2).x0 - 0.5, box(1, bash2).x0 + 0.5);
  expect(b).toEqual({ a: read2.key, b: bash2.key });
  const across = bandRows(L, heads, L.turns[0].x, L.turns[2].x + L.turns[2].w);
  expect(across.a).toBe(heads[0].stepRows[0].key);
  expect(across.b).toBe(heads[2].stepRows.at(-1).key);
  // A band inside the break between turns holds nothing.
  expect(bandRows(L, heads, L.gaps[0][0] + 1, L.gaps[0][1] - 1)).toBe(null);
  expect(bandRows(L, heads, 10, 5)).toBe(null);
});

// ---- slice 1's bounds (PR #299 review): what a draw can be asked to make ----
// n made-up headings in the layout's shape, each 60 s long and 100 s after the last: the user's
// message, a call, a failed call, the reply (fail: false leaves the failed one a plain call).
function strip(n, { fail = true } = {}) {
  const heads = [];
  for (let i = 0; i < n; i++) {
    const key = `0:${i}`;
    const lks = ["you", "tool", fail ? "failed" : "tool", "reply"];
    heads.push({
      kind: "trh", key, n: i + 1, t0: T0 + i * 100000, total: 60000, span: 60000, going: false,
      cnt: { steps: 4, input: 1, model: 1, tools: 2, failed: fail ? 1 : 0, user: 1, agent: 0 },
      stepRows: lks.map((lk, j) => ({ kind: "tr", key: `tr:${key}:${j}`, lk, failed: lk === "failed" })),
      tl: [0, Number.NaN, 0, 1000, 5000, 0, 6000, 9000, fail ? 4 : 0, 10000, 60000, 0],
    });
  }
  return heads;
}
const LANES_H = 48;

test("timeline hatch: at Fit the breaks 4 px or wider make at most TL_HATCH_MAX segments, 5 px apart until then and wider past it", () => {
  expect([TL.TL_HATCH, TL.TL_HATCH_MAX]).toEqual([5, 800]);
  const counts = {};
  for (const cw of [1370, 2500]) {
    for (const n of [2, 5, 8, 20, 40, 52, 60, 100, 300, 2000]) {
      const L = timelineLayout(strip(n), cw, "clock", T0, null);
      const { lines, every } = TL.hatchLines(L.gaps, cw, LANES_H);
      counts[`${cw}/${n}`] = lines.length;
      expect(lines.length).toBeLessThanOrEqual(TL.TL_HATCH_MAX);
      expect(every).toBe(5);
      // Each segment a 45 degree line inside its break, inside the lanes.
      for (const [x0, y0, x1, y1] of lines) {
        expect(x1).toBeGreaterThan(x0);
        expect(Math.abs((y0 - y1) - (x1 - x0))).toBeLessThan(1e-9);
        expect(Math.min(y0, y1)).toBeGreaterThanOrEqual(0);
        expect(Math.max(y0, y1)).toBeLessThanOrEqual(LANES_H);
      }
    }
  }
  // Past 52 turns a 1,370 px strip's breaks are under 4 px: no hatch at all.
  expect([counts["1370/60"], counts["1370/300"], counts["1370/2000"]]).toEqual([0, 0, 0]);
  expect(counts["1370/52"]).toBeGreaterThan(0);
  // A strip of many wide breaks (as a zoomed view could hold): capped, the lines spaced wider.
  const gaps = Array.from({ length: 400 }, (_, i) => [i * 40, i * 40 + 30, null]);
  const many = TL.hatchLines(gaps, 16000, LANES_H);
  expect(many.lines.length).toBeLessThanOrEqual(TL.TL_HATCH_MAX);
  // At least one line a break: the count is the cap less one a break, at most the cap.
  expect(many.lines.length).toBeGreaterThanOrEqual(TL.TL_HATCH_MAX - 400);
  expect(many.every).toBeGreaterThan(5);
  // Breaks under 4 px, or out of the strip, make none.
  expect(TL.hatchLines([[10, 13, null], [-40, -1, null], [1400, 1430, null]], 1370, LANES_H).lines).toEqual([]);
});

test("timeline labels, ticks and fail marks: never more than fit, at any session length: numbers apart by their own width and a gap, ticks 62 px apart, fail marks 6 px apart, the last turn's kept", () => {
  for (const cw of [1370, 2500]) {
    for (const n of [1, 3, 10, 40, 100, 400, 2000, 6000]) {
      const L = timelineLayout(strip(n), cw, "clock", T0, null);
      const gapsOf = (xs) => xs.slice(1).map((x, i) => x - xs[i]);
      const lx = L.labels.map((l) => l.x);
      const tx = L.ticks.map((k) => k.x);
      L.labels.slice(1).forEach((l, i) => expect(l.x - lx[i]).toBeGreaterThanOrEqual(TL.tlNumW(L.labels[i].text) + TL.TL_NUM_GAP));
      for (const d of gapsOf(tx)) expect(d).toBeGreaterThanOrEqual(62);
      for (const d of gapsOf(L.fails)) expect(d).toBeGreaterThanOrEqual(6);
      expect(L.labels.length).toBeLessThanOrEqual(Math.floor(cw / (TL.tlNumW("1") + TL.TL_NUM_GAP)) + 1);
      expect(L.ticks.length).toBeLessThanOrEqual(Math.floor(cw / 62) + 1);
      expect(L.fails.length).toBeLessThanOrEqual(Math.floor(cw / 6) + 1);
      // The marks run to the strip's right end: the last turn's failure is among them.
      const last = L.turns.at(-1);
      expect(L.fails.at(-1)).toBeGreaterThanOrEqual(last.x - 6);
    }
  }
});

test("timeline model: a selection change or a press places nothing again; the placements and layouts made are counted", () => {
  const heads = strip(2000);
  const before = { ...TL.TL_MADE };
  const m = timelineModel(null, heads, 1370, "clock", T0, null);
  expect([TL.TL_MADE.geo - before.geo, TL.TL_MADE.layout - before.layout]).toEqual([1, 1]);
  // The same heads, width and scale (a selection change, a press, a tick): nothing made again.
  let next = m;
  for (let k = 0; k < 5; k++) next = timelineModel(next, heads, 1370, "clock", T0 + k * 1000, null);
  expect([TL.TL_MADE.geo - before.geo, TL.TL_MADE.layout - before.layout]).toEqual([1, 1]);
  expect([next.geo, next.L]).toEqual([m.geo, m.L]);
  expect(next.geo).toBe(m.geo);
  // A new width: placed again.
  timelineModel(next, heads, 1330, "clock", T0, null);
  expect([TL.TL_MADE.geo - before.geo, TL.TL_MADE.layout - before.layout]).toEqual([2, 2]);
});

// The numbers' steps, 1, 2, 5, 10, 20, 50 and on, and where a turn's number sits at Fit: at its
// start. A multiple of k whose number would run past the strip's end has none; the selected
// turn's is moved inside it.
const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
const numAt = (L, ti) => Math.min(Math.max(0, L.turns[ti].x), L.cw - TL.tlNumW(`${ti + 1}`));
const fits = (L, ti) => Math.max(0, L.turns[ti].x) + TL.tlNumW(`${ti + 1}`) <= L.cw;
const clash = (a, b) => a.x + TL.tlNumW(a.text) + TL.TL_NUM_GAP > b.x;

test("timeline numbers: every k-th turn has its number, k the smallest of 1, 2, 5, 10, 20, 50 and on that keeps them apart, and the first turn always; at 2,000 turns on 1,370 and 2,500 px there are numbers", () => {
  const got = {};
  for (const cw of [1370, 2500]) {
    for (const n of [3, 20, 85, 400, 2000, 5600]) {
      const L = timelineLayout(strip(n), cw, "clock", T0, null);
      const k = L.every;
      got[`${cw}/${n}`] = [k, L.labels.length];
      expect(STEPS).toContain(k);
      // The first turn's number, then only multiples of k, in order and apart.
      expect(L.labels[0].text).toBe("1");
      expect(L.labels[0].x).toBe(0);
      for (const l of L.labels.slice(1)) expect(Number(l.text) % k).toBe(0);
      L.labels.slice(1).forEach((l, i) => expect(clash(L.labels[i], l)).toBe(false));
      // Every multiple of k is there, but one that would touch the first turn's number.
      const want = [];
      for (let ti = k - 1; ti < n; ti += k) {
        if (ti === 0 || !fits(L, ti)) continue;
        const l = { x: numAt(L, ti), text: `${ti + 1}` };
        if (!clash({ x: 0, text: "1" }, l)) want.push(l.text);
      }
      expect(L.labels.slice(1).map((l) => l.text)).toEqual(want);
      // The step below k would put two numbers too close.
      const below = STEPS[STEPS.indexOf(k) - 1];
      if (below) {
        const xs = [];
        for (let ti = below - 1; ti < n; ti += below) if (ti > 0 && fits(L, ti)) xs.push({ x: numAt(L, ti), text: `${ti + 1}` });
        expect(xs.slice(1).some((l, i) => clash(xs[i], l))).toBe(true);
      }
    }
  }
  // Few turns: each its number, and the wide ones their lengths too. Narrow ones keep the
  // number and drop the length first.
  expect(got["1370/3"]).toEqual([1, 3]);
  expect(got["1370/20"]).toEqual([1, 20]);
  expect(timelineLayout(strip(3), 1370, "clock", T0, null).labels.every((l) => l.total === "1m 00s")).toBe(true);
  expect(timelineLayout(strip(20), 1370, "clock", T0, null).labels.every((l) => l.total == null)).toBe(true);
  // Past 52 turns, where a turn is under 24 px, the numbers are thinned, not gone.
  expect(got["1370/2000"][1]).toBeGreaterThanOrEqual(10);
  expect(got["2500/2000"][1]).toBeGreaterThanOrEqual(10);
  expect(got["1370/5600"][1]).toBeGreaterThanOrEqual(10);
  expect([got["1370/2000"][0], got["2500/2000"][0]]).toEqual([100, 50]);
});

test("timeline numbers: the selected turn's number always shows and wins a clash; only the numbers it touches give way, the first turn's too", () => {
  for (const cw of [1370, 2500]) {
    const heads = strip(2000);
    const L = timelineLayout(heads, cw, "clock", T0, null);
    expect(TL.tlNumbers(L, heads, null)).toBe(L.labels);
    expect(TL.tlNumbers(L, heads, undefined)).toBe(L.labels);
    for (const ti of [0, 1, 2, 7, 98, 99, 100, 101, 999, 1233, 1998, 1999]) {
      const nums = TL.tlNumbers(L, heads, ti);
      const s = nums.find((l) => l.text === `${ti + 1}`);
      expect(s).toBeDefined();
      expect(s.x).toBe(numAt(L, ti));
      expect(s.x + TL.tlNumW(s.text)).toBeLessThanOrEqual(cw);
      nums.slice(1).forEach((l, i) => expect(clash(nums[i], l)).toBe(false));
      // The rest are the layout's own, less those the selected one touches.
      const kept = L.labels.filter((l) => l.text === s.text || !(l.x <= s.x ? clash(l, s) : clash(s, l)));
      expect(nums.map((l) => l.text)).toEqual([...new Set([...kept.map((l) => l.text), s.text])].sort((a, b) => a - b));
      // The first turn's stays unless the selected one touches it.
      if (!clash({ x: 0, text: "1" }, s)) expect(nums[0].text).toBe("1");
    }
    // A selected turn already numbered: the layout's numbers as they are.
    expect(TL.tlNumbers(L, heads, 99).map((l) => l.text)).toEqual(L.labels.map((l) => l.text));
  }
});

// One turn whose Tools lane has calls running at once, as a long session's subagents make:
// a subagent on the first track, then a second subagent, a failed call and a short call
// inside it, all three on the second (half-height) track. t0 ms, 60 s long.
function overlapping() {
  const key = "0:0";
  const lks = ["you", "subagent", "subagent", "failed", "tool", "reply"];
  const TR = 1;
  const F = 4;
  return [{
    kind: "trh", key, n: 1, t0: T0, total: 60000, span: 60000, going: false,
    cnt: { steps: 6, input: 1, model: 1, tools: 4, failed: 1, user: 1, agent: 0 },
    stepRows: lks.map((lk, j) => ({ kind: "tr", key: `tr:${key}:${j}`, lk, failed: lk === "failed" })),
    tl: [0, Number.NaN, 0, 2000, 30000, 0, 4000, 40000, TR, 6000, 14000, TR | F, 9000, 10000, TR, 59000, 60000, 0],
  }];
}

test("timeline press: where bars overlap, the press gets the bar drawn on top at its x and y: failed over the rest, half height over full, then the narrowest; the y inside the lane picks the track", () => {
  const heads = overlapping();
  const L = timelineLayout(heads, 1000, "clock", T0, null);
  const T = tlBox(L, 0);
  const box = (si) => itemBox(heads[0].tl, si, T.x, T.w, L.geo.walls[0], "clock", 6);
  const mid = (si) => (box(si).x0 + box(si).x1) / 2;
  const at = (x, ly) => timelineHit(L, heads, x, "tools", T0, ly)?.key;
  expect([box(1).track, box(2).track, box(3).track, box(4).track]).toEqual([0, 1, 1, 1]);
  // The failed call, drawn over the others: at its middle on the half track, it, not the
  // short call inside it (later in the turn) or the subagent under it.
  expect(at(mid(3), 11)).toBe("tr:0:0:3");
  expect(at(box(3).x0 + 1, 11)).toBe("tr:0:0:3");
  // The short call is inside the failed one, so under it: the failed one again.
  expect(at(mid(4), 11)).toBe("tr:0:0:3");
  // Past the failed call, the second subagent's half bar and the first's full bar overlap:
  // the half one is on top.
  expect(at(box(3).x1 + 20, 11)).toBe("tr:0:0:2");
  // Above the half track (the first 6 px of the lane's bars) only the full bar is there.
  expect(at(mid(3), 4)).toBe("tr:0:0:1");
  expect(at(box(3).x1 + 20, 4)).toBe("tr:0:0:1");
  // With no y, the bar drawn on top at x.
  expect(at(mid(3))).toBe("tr:0:0:3");
  // Off every bar but within 4 px: the nearest; past 4 px the turn's heading.
  expect(at(box(1).x0 - 2, 11)).toBe("tr:0:0:1");
  expect(at(T.x + T.w - 1, 11)).toBe("0:0");
});

test("timeline press: of two bars on top at a point, on the same track and ink, the narrower one is pressed", () => {
  const heads = overlapping();
  // The failed call made a plain tool call: now two plain calls on the half track, the
  // short one inside the long one.
  heads[0].stepRows[3] = { ...heads[0].stepRows[3], lk: "tool", failed: false };
  heads[0].tl[3 * 3 + 2] = 1;
  const L = timelineLayout(heads, 1000, "clock", T0, null);
  const T = tlBox(L, 0);
  const box = (si) => itemBox(heads[0].tl, si, T.x, T.w, L.geo.walls[0], "clock", 6);
  const mid = (si) => (box(si).x0 + box(si).x1) / 2;
  expect(timelineHit(L, heads, mid(4), "tools", T0, 11).key).toBe("tr:0:0:4");
  // Inside the long one, clear of the short one: the long one.
  expect(timelineHit(L, heads, box(3).x0 + 5, "tools", T0, 11).key).toBe("tr:0:0:3");
});

test("timeline press: a turn under 2 px at Fit is drawn as one span per lane; a press gets the turn under the pointer, and a step of it, the one drawn on top, only where its span is within 4 px; the span is the step's bar for the press and the outline", () => {
  for (const cw of [1143, 1370]) {
    const heads = strip(2000);
    // One turn with no tools call: in the Tools lane it has no span, so a press there gets
    // its heading. Its rows keep their keys (the reply is tr:0:1000:3).
    const q = heads[1000];
    heads[1000] = { ...q, cnt: { ...q.cnt, tools: 0, failed: 0 }, stepRows: [q.stepRows[0], q.stepRows[3]], tl: [0, Number.NaN, 0, 10000, 60000, 0] };
    const L = timelineLayout(heads, cw, "clock", T0, null);
    for (const ti of [0, 1, 999, 1233, 1980, 1998, 1999]) {
      const T = tlBox(L, ti);
      expect(T.w).toBeLessThan(2);
      const span = { x0: T.x, x1: T.x + Math.max(T.w, 1), track: 0 };
      // The bar a press and the outline use is the span the layers draw, at the turn's own x.
      for (const si of [0, 1, 2, 3]) expect(TL.tlBar(L, heads, ti, si, T0)).toEqual(span);
      const x = T.x + T.w / 2;
      // The tools span is red where the turn has a failed call: the failed call is on top.
      expect(timelineHit(L, heads, x, "tools", T0, 4)).toEqual({ turn: `0:${ti}`, key: `tr:0:${ti}:2` });
      expect(timelineHit(L, heads, x, "input", T0, 4)).toEqual({ turn: `0:${ti}`, key: `tr:0:${ti}:0` });
      expect(timelineHit(L, heads, x, "model", T0, 4)).toEqual({ turn: `0:${ti}`, key: `tr:0:${ti}:3` });
    }
    const T = tlBox(L, 1000);
    expect(timelineHit(L, heads, T.x + T.w / 2, "tools", T0, 4)).toEqual({ turn: "0:1000", key: "0:1000" });
    expect(timelineHit(L, heads, T.x + T.w / 2, "model", T0, 4)).toEqual({ turn: "0:1000", key: "tr:0:1000:3" });
  }
  // A wide turn's bar is its own (itemBox), as before.
  const few = strip(3);
  const L = timelineLayout(few, 1370, "clock", T0, null);
  const T = tlBox(L, 1);
  expect(TL.tlBar(L, few, 1, 2, T0)).toEqual(itemBox(few[1].tl, 2, T.x, T.w, L.geo.walls[1], "clock", 4));
});
