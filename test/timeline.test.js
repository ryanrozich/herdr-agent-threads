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

test("timeline bar ends: a finished call's bar runs from its start to its end on the clock", () => {
  // Turn 2 takes 120 s: Read runs 6 to 60 s on track 0, Grep 10 to 20 s on track 1.
  const a = head(turn(1, ["Looking.", [["Bash", "x", 6000, 12000, true]]]));
  const b = head(turn(2, [[["Read", "y", 6000, 60000], ["Grep", "z", 10000, 20000]]], { end: T0 + 120000 }));
  const L = timelineLayout([a, b], 600, "clock");
  expect(L.geo.walls[1]).toBe(120000);
  const { x, w } = L.turns[1];
  const [read] = L.spans.get("tools|tools|0");
  const [grep] = L.spans.get("tools|tools|1");
  expect(read[0]).toBeCloseTo(x + (6000 / 120000) * w, 6);
  expect(read[1]).toBeCloseTo(x + (60000 / 120000) * w, 6);
  expect(grep[0]).toBeCloseTo(x + (10000 / 120000) * w, 6);
  expect(grep[1]).toBeCloseTo(x + (20000 / 120000) * w, 6);
});

test("timeline tracks: a call that starts as the last one ends stays on the first track; one that starts before it ends does not", () => {
  const h = head(turn(1, [[["Read", "a", 2000, 3000], ["Grep", "b", 3000, 4000], ["Bash", "c", 3500, 5000]]]));
  const tools = stepsOf(h).filter((it) => it.lane === "tools");
  expect(tools.map((it) => [it.a, it.b, it.track])).toEqual([[2000, 3000, 0], [3000, 4000, 0], [3500, 5000, 1]]);
});

test("timeline tracks: a call with no result holds the first track to the turn's end, so a later call goes on the second", () => {
  // Not running: Bash never returned, so it runs to the turn's last event, and Read, which
  // starts after Bash began, runs beside it.
  const h = head(turn(3, [[["Bash", "sleep", 6000, null]], [["Read", "a", 7000, 8000]]], { done: false, end: null, reply: null }));
  const tools = stepsOf(h).filter((it) => it.lane === "tools");
  expect(tools.map((it) => [it.a, it.open, it.track])).toEqual([[6000, true, 0], [7000, false, 1]]);
  const L = timelineLayout([h], 400, "clock");
  expect(L.spans.get("tools|tools|1").length).toBe(1);
});

test("timeline press: a press within 4 px of a bar finds its step; past 4 px, the turn's heading", () => {
  // One turn 60 s long across 400 px; Read runs 30 to 40 s, the only bar in the Tools lane.
  const h = head(turn(1, [[["Read", "a", 30000, 40000]]]));
  const L = timelineLayout([h], 400, "clock");
  const [[x0, x1]] = L.spans.get("tools|tools|0");
  expect([x0, x1].map((v) => Math.round(v * 100) / 100)).toEqual([200, 266.67]);
  const read = stepsOf(h).find((it) => it.lk === "tool").key;
  const hit = (x) => timelineHit(L, [h], x, "tools").key;
  expect([hit(x0 - 3), hit(x0), hit((x0 + x1) / 2), hit(x1 + 3)]).toEqual([read, read, read, read]);
  expect([hit(x0 - 5), hit(x1 + 5)]).toEqual([h.key, h.key]);
});

test("timeline press: a press at no number finds nothing", () => {
  const h = head(turn(1, [[["Read", "a", 30000, 40000]]]));
  const L = timelineLayout([h], 400, "clock");
  expect(timelineHit(L, [h], Number.NaN, "tools")).toBe(null);
  expect(timelineHit(L, [h], Number.NaN, null)).toBe(null);
});

test("timeline bar starts: a step that starts before its turn does is drawn from the turn's start, not left of it", () => {
  // A tool's time a little before the prompt's (clocks that disagree): turn 2's Read at -5 s.
  const a = head(turn(1, [[["Bash", "x", 6000, 12000]]]));
  const b = head(turn(2, [[["Read", "y", -5000, 1000]]]));
  const L = timelineLayout([a, b], 600, "clock");
  const read = L.spans.get("tools|tools|0").at(-1);
  expect(read[0]).toBe(L.turns[1].x);
  expect(read[1]).toBeCloseTo(L.turns[1].x + (1000 / 60000) * L.turns[1].w, 6);
  // Straight from tl: a turn 100 px in, 100 px wide, 10 s long.
  expect(itemBox([-5000, 1000, 0], 0, 100, 100, 10000, "clock", 1)).toEqual({ x0: 100, x1: 110, track: 0 });
  expect(itemBox([-5000, -4000, 0], 0, 100, 100, 10000, "clock", 1)).toEqual({ x0: 100, x1: 103, track: 0 });
  // A turn narrower than a bar's least width: the bar still ends at the turn's end.
  expect(itemBox([0, Number.NaN, 2], 0, 100, 4, 10000, "clock", 1)).toEqual({ x0: 98, x1: 104, track: 0, open: true });
});

test("timeline running turn: a room for a time with no bound is the least room, and the strip stays placed", () => {
  expect([Number.POSITIVE_INFINITY, Number.NaN].map(liveRoom)).toEqual([TL_ROOM_MIN, TL_ROOM_MIN]);
  const a = head(turn(1, [[["Bash", "x", 6000, 12000]]]));
  const live = head(turn(2, [[["Bash", "bun run e2e", 3000, null]]], { done: false, end: null, reply: null }), true);
  const geo = timelineGeo([a, live], 600, "clock", Number.POSITIVE_INFINITY);
  expect(geo.room).toBe(TL_ROOM_MIN);
  expect(geo.turns.every((t) => Number.isFinite(t.x) && Number.isFinite(t.w) && t.w > 0)).toBe(true);
});
