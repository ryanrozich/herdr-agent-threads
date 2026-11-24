// bun test: the Trajectory's timeline as data (timeline.js, TRD-23 part 1): each heading's steps
// read from its turn's own rows (ledger.js ledgerTurn keeps no array a step), their tracks
// worked out in the layout pass, the turns placed on a strip (timelineGeo), a view of them
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
  tornPoints, polyRows, timelineModel, tlGrow, tlStep, tlLen, tlRow, tlTracks, TL_MADE,
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
const head = (t, live = false, s = S) => ledgerTurn(s, t, 0, live).head;
// A heading's steps read back, one object each, for the tests only (the pane keeps none).
const stepsOf = (h) => Array.from({ length: tlLen(h) }, (_, i) => tlStep(h, i));
// A heading's step rows: the array ledgerTurn returns beside it (h.steps).
const rowsOf = (h) => h.steps;

test("timeline steps: a heading keeps no array of its own for its steps: they are its turn's step rows (h.steps), read back with their times and flags", () => {
  const out = ledgerTurn(S, turn(3, ["Looking first.", [["Read", "src/a.ts", 2000, 2300], ["Bash", "bun test", 2100, 45000, true]]]), 0);
  const { head: h, steps } = out;
  expect(TL_LANES).toEqual(["input", "model", "tools"]);
  // No object and no number array per step: the heading holds its turn's step rows, the one
  // array ledgerTurn returns beside it (no rows array with the heading in it); a step's times
  // and flags are read from its row.
  expect(out.rows).toBe(undefined);
  expect(h.rows).toBe(undefined);
  expect(h.items).toBe(undefined);
  expect(h.tl).toBe(undefined);
  expect(h.stepRows).toBe(undefined);
  expect(h.steps).toBe(steps);
  expect(steps.includes(h)).toBe(false);
  expect(tlLen(h)).toBe(steps.length);
  expect(steps.every((r, i) => tlRow(h, i) === r)).toBe(true);
  const at = (lk) => steps.findIndex((r) => r.lk === lk);
  // [a, b, flags]: ms from the turn's start, null for none; flags 1 for the second track, 2
  // for an unfinished call, 4 for a failed one.
  const three = (h, i) => { const st = tlStep(h, i); return [st.a, st.b, (st.track ? 1 : 0) | (st.open ? 2 : 0) | (st.failed ? 4 : 0)]; };
  expect(three(h, at("you"))).toEqual([0, null, 0]);
  expect(three(h, at("text"))).toEqual([1000, null, 0]);
  expect(three(h, at("tool"))).toEqual([2000, 2300, 0]);
  // Bash starts while Read runs: the second track, drawn half height; and it failed.
  expect(three(h, at("failed"))).toEqual([2100, 45000, 1 | 4]);
  // Read back with the row's key, kind, lane and ink.
  expect(tlStep(h, at("failed"))).toMatchObject({ i: at("failed"), key: steps[at("failed")].key, lk: "failed", lane: "tools", ink: "failed", a: 2100, b: 45000, track: 1, open: false, failed: true });
  expect(tlStep(h, at("you"))).toMatchObject({ lane: "input", a: 0, b: null, track: 0 });
  // The span keys are one shared pair per lane and ink, not an array per step.
  const other = head(turn(4, [[["Grep", "x", 3000, 4000]]]));
  expect(tlStep(other, 1).sk).toBe(tlStep(h, at("tool")).sk);
  expect(tlStep(h, at("tool")).sk).toEqual(["tools|tools|0", "tools|tools|1"]);
  // An interrupted turn's Interrupted row is no bar.
  const sh = head(turn(5, [[["Read", "a", 2000, 2500]]], { interrupted: true, reply: null, end: T0 + 40000 }));
  expect(tlStep(sh, rowsOf(sh).findIndex((r) => r.lk === "stop"))).toMatchObject({ lane: null, sk: null });
  // A call with no result yet: flag 2.
  const oh = head(turn(6, [[["Bash", "sleep", 6000, null]]], { done: false, end: null, reply: null }), true);
  const oi = rowsOf(oh).findIndex((r) => r.open);
  expect(three(oh, oi)).toEqual([6000, null, 2]);
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
  expect(St.turns[0].w / tlLen(a)).toBeCloseTo(St.turns[1].w / tlLen(b), 6);
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
  // 6,000 turns: each under 2 px, so the layout walks turns, not steps, and draws few spans:
  // one placing, one layout and no turn's tracks worked out (counted, not timed).
  const one = head(turn(4, ["a", [["Bash", "x", 1000, 2000, true]]]));
  const heads = Array.from({ length: 6000 }, (_, i) => ({ ...one, key: `0:${i + 1}`, n: i + 1, t0: T0 + i * 120000 }));
  const was = { ...TL_MADE };
  const big = timelineLayout(heads, 500, "clock");
  expect([TL_MADE.geo - was.geo, TL_MADE.layout - was.layout, TL_MADE.tracks - was.tracks]).toEqual([1, 1, 0]);
  expect(big.turns.length).toBe(6000);
  expect(big.turns.every((t) => t.w < 2)).toBe(true);
  let spans = 0;
  for (const list of big.spans.values()) spans += list.length;
  expect(spans).toBeLessThan(500);
  expect(big.fails.length).toBeLessThanOrEqual(500 / 6 + 1);
});

test("timeline failure marks: spaced left to right as drawn, not in the order the ledger lists the calls", () => {
  const marks = (h) => timelineLayout([h], 600, "clock", T0 + 1e7).fails.map((x) => Math.round(x * 1000) / 1000);
  // 60 s across 600 px: a failed Bash at 30 s (300 to 310 px), then a failed Read listed after
  // it but run at 10 s (100 to 110 px), 200 px to its left: both marks.
  const a = head(turn(1, [[["Bash", "x", 30000, 31000, true]], [["Read", "a", 10000, 11000, true]]]));
  expect(timelineLayout([a], 600, "clock", T0 + 1e7).turns[0]).toMatchObject({ x: 0, w: 600 });
  expect(marks(a)).toEqual([105, 305]);
  // Failed calls under 6 px apart: one mark, the leftmost bar's, whichever is listed first.
  const b = head(turn(2, [[["Bash", "x", 30400, 31000, true]], [["Read", "a", 30000, 31000, true]]]));
  expect(marks(b)).toEqual([305]);
  const c = head(turn(3, [[["Read", "a", 30000, 31000, true]], [["Bash", "x", 30400, 31000, true]]]));
  expect(marks(c)).toEqual([305]);
});

// Each failed bar's centre as drawn, at Fit: a turn under 2 px is one span per lane from its x,
// its mark at x + w/2; a wider turn's failed bars are their own boxes (itemBox).
function failCentres(L, heads) {
  const out = [];
  L.turns.forEach((t, ti) => {
    const h = heads[ti];
    if (t.w < 2) { if (h.cnt?.failed) out.push(t.x + t.w / 2); return; }
    for (const st of stepsOf(h)) {
      if (!st.failed) continue;
      const b = itemBox(st.a ?? Number.NaN, st.b ?? Number.NaN, 0, st.i, t.x, t.w, L.geo.walls[ti], "clock", tlLen(h));
      if (b) out.push((b.x0 + b.x1) / 2);
    }
  });
  return out;
}

test("timeline failure marks: a failed bar inside another with the same centre gives one mark, not two on the same px", () => {
  // 60 s across 600 px: a failed Bash from 2 to 40 s (20 to 400 px) and a failed Read from 10
  // to 32 s (100 to 320 px) on the half track inside it. Both are centred at 210 px.
  const h = head(turn(1, [[["Bash", "x", 2000, 40000, true]], [["Read", "a", 10000, 32000, true]]]));
  const L = timelineLayout([h], 600, "clock", T0 + 1e7);
  expect(failCentres(L, [h])).toEqual([210, 210]);
  expect(L.fails).toEqual([210]);
});

test("timeline failure marks: across turns too, the marks are 6 px or more apart, spaced by the centres they are drawn at", () => {
  // Sessions where a wide turn's last failed call ends at its end and short turns after it
  // (under 2 px from a few hundred turns, one span a lane) have failed calls of their own.
  let close = 0;
  for (const n of [40, 90, 150, 240, 330, 420, 560, 700]) {
    const heads = Array.from({ length: n }, (_, i) => {
      const kind = i % 7;
      const calls = kind === 0 ? [["Bash", "x", 57000, 60000, true]] : kind === 3 ? [["Read", "a", 0, 400, true]] : kind === 5 ? [["Grep", "b", 200, 900, true]] : [["Glob", "c", 100, 300]];
      const end = kind === 0 ? 60000 : kind === 3 ? 4000 : 1000 + (i % 5) * 700;
      return { ...head(turn(i + 1, ["a", calls], { end: T0 + end })), t0: T0 + i * 120000 };
    });
    for (const cw of [1370, 1143]) {
      const L = timelineLayout(heads, cw, "clock", T0 + 1e9);
      const f = L.fails;
      for (let k = 1; k < f.length; k++) {
        expect([n, cw, f[k] - f[k - 1] >= 6 - 1e-9]).toEqual([n, cw, true]);
      }
      // Each failed bar has a mark within 6 px of its centre.
      for (const c of failCentres(L, heads)) {
        if (f.some((m) => Math.abs(m - c) < 6)) continue;
        expect([n, cw, c, "no mark within 6 px"]).toEqual([n, cw, c, null]);
      }
      const narrow = L.turns.filter((t) => t.w < 2).length;
      if (narrow && narrow < L.turns.length) close++;
    }
  }
  // Both kinds of turn come up side by side, as at Fit from a few hundred turns.
  expect(close).toBeGreaterThan(4);
});

test("timeline failure marks: every failed bar has a mark within 6 px of its centre; the marks go left to right by centre", () => {
  const marks = (h) => timelineLayout([h], 600, "clock", T0 + 1e7).fails.map((x) => Math.round(x * 1000) / 1000);
  // A failed Read from 0 to 0.4 s (0 to 4 px, centre 2) and a failed Bash from 0.5 to 5.5 s
  // (5 to 55 px, centre 30): the Bash starts under 6 px from the Read but is centred 28 px
  // from it, so it has a mark of its own.
  const a = head(turn(1, [[["Read", "a", 0, 400, true]], [["Bash", "x", 500, 5500, true]]]));
  expect(marks(a)).toEqual([2, 30]);
  // A failed Bash from 0 to 10 s (0 to 100 px, centre 50) and a failed Read from 1 to 1.4 s
  // (10 to 14 px, centre 12) inside it: by start the Bash comes first, by centre the Read.
  // Both marks, left to right.
  const b = head(turn(2, [[["Bash", "x", 0, 10000, true]], [["Read", "a", 1000, 1400, true]]]));
  expect(marks(b)).toEqual([12, 50]);
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
  const box = itemBox(99990, Number.NaN, 2, 0, 0, 400, 100000, "clock", 4);
  expect(box.x1 - box.x0).toBe(6);
  expect(box.open).toBe(true);
  expect(itemBox(99990, Number.NaN, 0, 0, 0, 400, 100000, "clock", 4).x1 - 394).toBeLessThanOrEqual(6);
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
  const steps = heads.reduce((n, h) => n + tlLen(h), 0);
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
  const box = (ti, it) => itemBox(it.a ?? Number.NaN, it.b ?? Number.NaN, 0, it.i, L.turns[ti].x, L.turns[ti].w, L.geo.walls[ti], "clock", tlLen(heads[ti]));
  const read2 = stepsOf(heads[1]).find((it) => it.lk === "tool");
  const bash2 = stepsOf(heads[1]).filter((it) => it.lk === "tool")[1];
  const b = bandRows(L, heads, box(1, read2).x0 - 0.5, box(1, bash2).x0 + 0.5);
  expect(b).toEqual({ a: read2.key, b: bash2.key });
  const across = bandRows(L, heads, L.turns[0].x, L.turns[2].x + L.turns[2].w);
  expect(across.a).toBe(tlRow(heads[0], 0).key);
  expect(across.b).toBe(heads[2].steps.at(-1).key);
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

test("timeline tracks: in clock order, not the ledger's: a call listed after another but run before it, apart from it, stays on the first track; at equal starts the one listed first keeps it", () => {
  const tracksOf = (h) => stepsOf(h).filter((it) => it.lane === "tools").map((it) => [it.a, it.track]);
  // Read from 30 to 31 s, then a Grep listed after it from 5 to 6 s: they never overlap.
  const a = head(turn(1, [[["Read", "a", 30000, 31000]], [["Grep", "b", 5000, 6000]]]));
  expect(tracksOf(a)).toEqual([[30000, 0], [5000, 0]]);
  expect(tlTracks(a)).toBe(null);
  // Listed Read (30 to 40 s), Grep (5 to 6 s) and Bash (35 to 36 s): only Bash starts while
  // another runs.
  const b = head(turn(1, [[["Read", "a", 30000, 40000]], [["Grep", "b", 5000, 6000]], [["Bash", "c", 35000, 36000]]]));
  expect(tracksOf(b)).toEqual([[30000, 0], [5000, 0], [35000, 1]]);
  // Equal starts: the one listed first holds the first track, in either order.
  const c = head(turn(1, [[["Read", "a", 10000, 20000], ["Grep", "b", 10000, 12000]]]));
  expect(tracksOf(c)).toEqual([[10000, 0], [10000, 1]]);
  const d = head(turn(1, [[["Grep", "b", 10000, 12000], ["Read", "a", 10000, 20000]]]));
  expect(tracksOf(d)).toEqual([[10000, 0], [10000, 1]]);
  // In a turn taken out of the ledger's order, equal starts keep it too: Grep (listed before
  // Bash) holds the first track, Bash goes on the second, and Read, after both, the first.
  const e = head(turn(1, [[["Read", "a", 30000, 40000]], [["Grep", "b", 10000, 12000]], [["Bash", "c", 10000, 20000]]]));
  expect(tracksOf(e)).toEqual([[30000, 0], [10000, 0], [10000, 1]]);
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

test("timeline press: an unfinished call's bar that starts left of its narrow turn is found by a press on it there, past the turn before's box", () => {
  // 100 turns of 60 s across 500 px, each under 6 px wide; turn 12 (index 11) stopped after a
  // Read, with a Bash that never returned, the others text only, so no Tools bar. The Bash's
  // bar is 6 px wide, so it starts left of its turn, over the break and the turn before.
  const heads = Array.from({ length: 100 }, (_, i) => ({
    ...head(turn(i + 1, i === 11 ? ["a", [["Read", "b", 500, 800]], [["Bash", "sleep", 1000, null]]] : ["a"], i === 11 ? { interrupted: true, reply: null } : {})),
    t0: T0 + i * 120000,
  }));
  const L = timelineLayout(heads, 500, "clock", T0 + 1e9);
  const [p, t] = [L.turns[10], L.turns[11]];
  expect(t.w).toBeGreaterThan(2);
  expect(t.w).toBeLessThan(6);
  const bash = stepsOf(heads[11]).find((it) => it.open);
  const bar = L.spans.get("tools|tools|0").find(([a, b]) => a < t.x && t.x < b);
  expect(bar[0]).toBeCloseTo(t.x + t.w - 6, 9);
  expect(bar[2]).toBe(1);
  // At the bar's left end, inside the turn before's box: the Bash, not the turn before.
  const at = bar[0] + 0.25;
  expect(at).toBeLessThan(p.x + p.w);
  expect(timelineHit(L, heads, at, "tools")).toEqual({ turn: heads[11].key, key: bash.key });
  // In the Model lane, or in none, the turn before's reply bar (3 px, at its turn's end) is under
  // the press too, and a bar of the turn the press is in comes first.
  const reply = stepsOf(heads[10]).find((it) => it.lk === "reply");
  expect(timelineHit(L, heads, at, "model")).toEqual({ turn: heads[10].key, key: reply.key });
  expect(timelineHit(L, heads, at, null)).toEqual({ turn: heads[10].key, key: reply.key });
  // Left of the bar, no bar under the press: the turn before's heading, as before.
  expect(timelineHit(L, heads, p.x + 0.1, "tools")).toEqual({ turn: heads[10].key, key: heads[10].key });
});

test("timeline press: a bar of the turn the press is in and one reaching back from the next both under it: the one drawn on top, failed over the rest, half height over full, then the narrowest", () => {
  // As above, 100 turns of 60 s across 500 px. Turn 11 (index 10) ends with a Grep at 58 to
  // 59 s, drawn 3 px wide at its turn's end; turn 12 (index 11) stopped with a Bash that never
  // returned, 6 px wide, starting left of its turn over the Grep's last px.
  const mk = (grep, rest) => Array.from({ length: 100 }, (_, i) => ({
    ...head(turn(i + 1, i === 10 ? ["a", [grep]] : i === 11 ? ["a", ...rest] : ["a"], i === 11 ? { interrupted: true, reply: null } : {})),
    t0: T0 + i * 120000,
  }));
  const press = (heads) => {
    const L = timelineLayout(heads, 500, "clock", T0 + 1e9);
    const [p, t] = [L.turns[10], L.turns[11]];
    // Both bars are under a press half a px inside the turn's end.
    const x = p.x + p.w - 0.5;
    expect(t.x + t.w - 6).toBeLessThan(x);
    expect(p.x + p.w - 3).toBeLessThan(x);
    return timelineHit(L, heads, x, "tools");
  };
  const grepOf = (heads) => stepsOf(heads[10]).find((it) => it.lane === "tools").key;
  const bashOf = (heads) => stepsOf(heads[11]).find((it) => it.open).key;
  // The Bash starts while a Read runs: on the half-height track, drawn over the full Grep.
  const a = mk(["Grep", "g", 58000, 59000], [[["Read", "b", 500, 2000]], [["Bash", "sleep", 1000, null]]]);
  expect(stepsOf(a[11]).find((it) => it.open).track).toBe(1);
  expect(press(a)).toEqual({ turn: a[11].key, key: bashOf(a) });
  // Both full height, one ink (one span): the narrower, the Grep.
  const b = mk(["Grep", "g", 58000, 59000], [[["Bash", "sleep", 1000, null]], [["Read", "b", 2000, 3000]]]);
  expect(stepsOf(b[11]).find((it) => it.open).track).toBe(0);
  expect(press(b)).toEqual({ turn: b[10].key, key: grepOf(b) });
  // The Grep failed: its red bar is drawn over the half-height Bash.
  const c = mk(["Grep", "g", 58000, 59000, true], [[["Read", "b", 500, 2000]], [["Bash", "sleep", 1000, null]]]);
  expect(press(c)).toEqual({ turn: c[10].key, key: grepOf(c) });
});

test("timeline press: in one turn too, of the bars under the press the one drawn on top: failed over the rest, then half height over full, then the narrowest", () => {
  const hit = (h, ms) => {
    const L = timelineLayout([h], 1200, "clock", T0 + 1e7);
    return timelineHit(L, [h], (ms / 60000) * 1200, "tools").key;
  };
  const keyOf = (h, name) => stepsOf(h).find((it) => it.lane === "tools" && rowsOf(h)[it.i].tool === name).key;
  // A failed Read from 2 to 40 s, full height, and a Grep from 10 to 20 s on the half track
  // over it: at 15 s the red Read is drawn on top.
  const a = head(turn(1, [[["Read", "a", 2000, 40000, true]], [["Grep", "b", 10000, 20000]]]));
  expect(stepsOf(a).filter((it) => it.lane === "tools").map((it) => it.track)).toEqual([0, 1]);
  expect(hit(a, 15000)).toBe(keyOf(a, "Read"));
  // Read from 2 to 40 s; Glob (12 to 14 s) listed before Grep (10 to 20 s), both on the half
  // track: at 13 s the narrower, Glob.
  const b = head(turn(2, [[["Read", "a", 2000, 40000]], [["Glob", "c", 12000, 14000]], [["Grep", "b", 10000, 20000]]]));
  expect(stepsOf(b).filter((it) => it.lane === "tools").map((it) => it.track)).toEqual([0, 1, 1]);
  expect(hit(b, 13000)).toBe(keyOf(b, "Glob"));
  // Only the full Read under the press, at 30 s: the Read.
  expect(hit(b, 30000)).toBe(keyOf(b, "Read"));
});

test("timeline press: looks at the turns that start within 4 px right of the press and no further, so at 5,600 turns it reads as many turns at turn 10 as at turn 5,000", () => {
  const one = head(turn(4, ["a", [["Bash", "x", 1000, 2000]]]));
  const heads = Array.from({ length: 5600 }, (_, i) => ({ ...one, key: `0:${i + 1}`, n: i + 1, t0: T0 + i * 120000 }));
  const L = timelineLayout(heads, 1371, "clock", T0 + 1e9);
  let reads = 0;
  const turns = new Proxy(L.turns, { get(o, k, r) { if (typeof k === "string" && /^[0-9]+$/.test(k)) reads++; return Reflect.get(o, k, r); } });
  const P = { ...L, turns };
  const cost = (ti) => {
    reads = 0;
    const got = timelineHit(P, heads, L.turns[ti].x + 0.01, "tools");
    expect(got.turn).toBe(heads[ti].key);
    return reads;
  };
  const pitch = L.turns[1].x - L.turns[0].x;
  const [early, late] = [cost(10), cost(5000)];
  // The halving takes 12 or 13 looks; then the turn and those within 4 px right of the press.
  expect(Math.abs(early - late)).toBeLessThanOrEqual(2);
  expect(late).toBeLessThan(14 + 2 * Math.ceil(4 / pitch + 2) + 6);
});

test("timeline press: on turns under 2 px, drawn as one span per lane from the turn's x and at least 1 px wide, a press on a span gets that turn, and its failed call where the span is drawn red", () => {
  // 500 short turns across 1,370 px with a 0.4 px break, under 2 px each and many under 1 px,
  // whose span runs 1 px from its turn's x, past the turn's own width into the break. Every
  // 50th turn is 60 s long, wide enough for its own bars; presses within 6 px of one are left
  // out.
  const heads = Array.from({ length: 500 }, (_, i) => {
    const k = i % 4;
    const calls = k === 0 ? [["Read", "a", 100, 300], ["Bash", "x", 400, 900, true]] : k === 1 ? [["Read", "a", 100, 300]] : k === 3 ? [["Bash", "x", 100, 600, true]] : null;
    return { ...head(turn(i + 1, calls ? ["a", calls] : ["a"], { end: T0 + (i % 50 === 0 ? 60000 : 1000 + (i % 3) * 500) })), t0: T0 + i * 120000 };
  });
  const L = timelineLayout(heads, 1370, "clock", T0 + 1e9);
  const wide = L.turns.filter((t) => t.w >= 2);
  expect(wide.length).toBe(10);
  expect(L.turns.filter((t) => t.w < 1).length).toBeGreaterThan(100);
  const span = (t) => [t.x, t.x + Math.max(t.w, 1)];
  let pressed = 0;
  let past = 0;
  for (let x = 0.05; x < 600; x += 0.1) {
    if (wide.some((t) => x > t.x - 6 && x < t.x + t.w + 6)) continue;
    const under = L.turns.map((t, ti) => ti).filter((ti) => L.turns[ti].w < 2 && heads[ti].cnt?.tools && x >= span(L.turns[ti])[0] && x <= span(L.turns[ti])[1]);
    if (!under.length) continue;
    pressed++;
    const got = timelineHit(L, heads, x, "tools");
    const ti = heads.findIndex((h) => h.key === got.turn);
    const st = stepsOf(heads[ti]).find((it) => it.key === got.key);
    const failed = Boolean(heads[ti].cnt.failed);
    expect([x, under.includes(ti), st?.lane, st?.failed === failed]).toEqual([x, true, "tools", true]);
    if (x > L.turns[ti].x + L.turns[ti].w) past++;
  }
  // Presses past a turn's own width, inside its drawn span, come up too.
  expect(pressed).toBeGreaterThan(1000);
  expect(past).toBeGreaterThan(40);
});

test("timeline press: a running call's growing bar is drawn over every other bar, so a press on it gets that call, over a failed one under it", () => {
  // A running turn: a failed Read from 2 to 40 s, full height, and a Bash started at 10 s
  // with no result yet, on the half track, its bar growing to now (50 s in). The growing bars
  // are drawn last, over the lanes' spans.
  const h = head(turn(1, [[["Read", "a", 2000, 40000, true]], [["Bash", "x", 10000, null]]], { done: false, end: null, reply: null }), true);
  const now = h.t0 + 50000;
  const L = timelineLayout([h], 1200, "clock", now);
  const bash = stepsOf(h).find((it) => it.open);
  const read = stepsOf(h).find((it) => it.failed);
  expect([bash.track, L.grow.length]).toEqual([1, 1]);
  const t = L.turns[0];
  const at = (ms) => t.x + (ms / L.geo.walls[0]) * t.w;
  const g = tlGrow(L, now)[0];
  expect(g.x0).toBeLessThan(at(15000));
  expect(g.x1).toBeGreaterThan(at(15000));
  expect(timelineHit(L, [h], at(15000), "tools", now).key).toBe(bash.key);
  // Before the Bash started, only the Read is under the press.
  expect(timelineHit(L, [h], at(5000), "tools", now).key).toBe(read.key);
});

test("timeline press: reaches 4 px left of a turn exactly 2 px wide, where its unfinished call's bar starts", () => {
  // 300 turns across 2,000 px: the least turn width is 0.3 * 2,000 / 300, 2 px exactly, with a
  // break of about 1 px. Turn 151 (index 150) is 600 s long with text only, so it takes most
  // of the strip; the others are 0.5 s long, held at 2 px, and turn 152 stopped after a Read
  // with a Bash that never returned. That bar is 6 px wide and ends at its turn's end, so
  // it starts 4 px left of it, over the break and the long turn's end.
  const heads = Array.from({ length: 300 }, (_, i) => {
    const t = i === 150 ? turn(i + 1, ["a"], { end: T0 + 600000 }) : i === 151 ? turn(i + 1, ["a", [["Read", "b", 50, 100]], [["Bash", "sleep", 200, null]]], { interrupted: true, reply: null, end: T0 + 500, untimed: true }) : turn(i + 1, ["a"], { end: T0 + 500, untimed: true });
    return { ...head(t), t0: T0 + i * 1200000 };
  });
  const L = timelineLayout(heads, 2000, "clock", T0 + 1e10);
  const t = L.turns[151];
  expect(t.w).toBe(2);
  expect(L.turns[150].x + L.turns[150].w).toBeGreaterThan(t.x - 3.9);
  const bash = stepsOf(heads[151]).find((it) => it.open);
  const bar = L.spans.get("tools|tools|0").find(([a, b]) => a < t.x && t.x < b);
  expect(bash.open).toBe(true);
  expect(bar[0]).toBeCloseTo(t.x - 4, 9);
  // 3.9 px left of the turn, inside the long turn: the Bash, drawn there.
  expect(timelineHit(L, heads, t.x - 3.9, "tools")).toEqual({ turn: heads[151].key, key: bash.key });
  // Past its bar's start: the long turn's heading.
  expect(timelineHit(L, heads, t.x - 4.1, "tools")).toEqual({ turn: heads[150].key, key: heads[150].key });
});

test("timeline press: in one turn, of two bars on the same layer under the press, the narrower, whichever is listed first", () => {
  const hit = (h, ms) => timelineHit(timelineLayout([h], 1200, "clock", T0 + 1e7), [h], (ms / 60000) * 1200, "tools").key;
  const keyOf = (h, name) => stepsOf(h).find((it) => it.lane === "tools" && rowsOf(h)[it.i].tool === name).key;
  // Read from 2 to 40 s; Grep (10 to 20 s) listed before Glob (12 to 14 s), both on the half
  // track: at 13 s the narrower, Glob, though Grep is listed first.
  const h = head(turn(1, [[["Read", "a", 2000, 40000]], [["Grep", "b", 10000, 20000]], [["Glob", "c", 12000, 14000]]]));
  expect(stepsOf(h).filter((it) => it.lane === "tools").map((it) => it.track)).toEqual([0, 1, 1]);
  expect(hit(h, 13000)).toBe(keyOf(h, "Glob"));
  expect(hit(h, 16000)).toBe(keyOf(h, "Grep"));
});

test("timeline press: takes no y inside the lane, so where a half-height bar is over a full one it gets the half one, even where only the full one is drawn", () => {
  // Read from 2 to 40 s, full height (2 to 14 px down the lane), and a Grep from 10 to 20 s on
  // the half track (8 to 14 px). At 15 s a press 4 px down the lane is on the Read alone, but
  // the model's press has no y: it gets the Grep, the bar drawn on top at that x. The view's
  // press (slice 1) passes the y.
  const h = head(turn(1, [[["Read", "a", 2000, 40000]], [["Grep", "b", 10000, 20000]]]));
  const L = timelineLayout([h], 1200, "clock", T0 + 1e7);
  expect(timelineHit.length).toBe(4);
  const grep = stepsOf(h).find((it) => rowsOf(h)[it.i].tool === "Grep");
  expect(timelineHit(L, [h], 300, "tools").key).toBe(grep.key);
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
  // Straight from a step's numbers: a turn 100 px in, 100 px wide, 10 s long.
  expect(itemBox(-5000, 1000, 0, 0, 100, 100, 10000, "clock", 1)).toEqual({ x0: 100, x1: 110, track: 0 });
  expect(itemBox(-5000, -4000, 0, 0, 100, 100, 10000, "clock", 1)).toEqual({ x0: 100, x1: 103, track: 0 });
  // A turn narrower than a bar's least width: the bar still ends at the turn's end.
  expect(itemBox(0, Number.NaN, 2, 0, 100, 4, 10000, "clock", 1)).toEqual({ x0: 98, x1: 104, track: 0, open: true });
});

test("timeline running turn: a room for a time with no bound is the least room, and the strip stays placed", () => {
  expect([Number.POSITIVE_INFINITY, Number.NaN].map(liveRoom)).toEqual([TL_ROOM_MIN, TL_ROOM_MIN]);
  const a = head(turn(1, [[["Bash", "x", 6000, 12000]]]));
  const live = head(turn(2, [[["Bash", "bun run e2e", 3000, null]]], { done: false, end: null, reply: null }), true);
  const geo = timelineGeo([a, live], 600, "clock", Number.POSITIVE_INFINITY);
  expect(geo.room).toBe(TL_ROOM_MIN);
  expect(geo.turns.every((t) => Number.isFinite(t.x) && Number.isFinite(t.w) && t.w > 0)).toBe(true);
});

test("torn end by steps: an unfinished call in a turn with no times is torn too; on the clock it is no bar", () => {
  // No step has a time, so the turn is not timed; its last call, in the running turn, has no result yet.
  const h = head(turn(9, ["Looking.", [["Bash", "sleep", null, null]]], { untimed: true, done: false, end: null, reply: null }), true);
  const i = rowsOf(h).findIndex((r) => r.open);
  expect(i).toBeGreaterThan(-1);
  expect(tlStep(h, i)).toMatchObject({ a: null, b: null, track: 0, open: true, failed: false });
  const St = timelineLayout([h], 400, "steps");
  expect(St.spans.get("tools|tools|0").filter((sp) => sp[2] === 1).length).toBe(1);
  const Cl = timelineLayout([h], 400, "clock", Date.now());
  expect(Cl.spans.has("tools|tools|0")).toBe(false);
  expect(Cl.grow).toEqual([]);
});

test("timeline tracks: worked out in the layout pass, only for a turn drawn wide enough for its bars, once for a finished turn, kept only for the turns drawn", () => {
  // Turn 1: Grep starts while Read runs (the second track). Turn 2: one call.
  const a = head(turn(1, [[["Read", "y", 6000, 60000], ["Grep", "z", 10000, 20000]]]));
  const b = head(turn(2, [[["Bash", "x", 2000, 3000]]]));
  let p = TL_MADE.tracks;
  const L = timelineLayout([a, b], 600, "clock");
  expect(TL_MADE.tracks - p).toBe(2);
  // Kept with the layout, by heading: a turn with a call on the second track keeps one number a
  // step, one with none keeps nothing.
  const kept = [...L.tracks.keys()];
  expect(kept.length).toBe(2);
  expect(kept[0]).toBe(a);
  expect(kept[1]).toBe(b);
  expect(L.tracks.get(a)).toEqual([0, 0, 1, 0]);
  expect(L.tracks.get(b)).toBe(null);
  // A press reads them from the layout: no pass.
  const grepKey = stepsOf(a).find((it) => it.track === 1).key;
  const [grep] = L.spans.get("tools|tools|1");
  p = TL_MADE.tracks;
  const hit = timelineHit(L, [a, b], (grep[0] + grep[1]) / 2, "tools");
  expect(TL_MADE.tracks - p).toBe(0);
  expect(hit.key).toBe(grepKey);
  // The ledger built again (a new heads array): the finished turns keep their headings, so only
  // the running turn, whose heading is new, is worked out again; a draw with nothing new, none.
  const t3 = (calls) => head(turn(3, [calls], { done: false, end: null, reply: null }), true);
  const live = t3([["Bash", "bun run e2e", 3000, null]]);
  p = TL_MADE.tracks;
  const m1 = timelineModel(null, [a, b, live], 600, "clock", live.t0 + 5000);
  expect(TL_MADE.tracks - p).toBe(3);
  const live2 = t3([["Bash", "bun run e2e", 3000, null], ["Read", "log", 4000, 4500]]);
  p = TL_MADE.tracks;
  const m2 = timelineModel(m1, [a, b, live2], 600, "clock", live.t0 + 6000);
  expect(m2.L).not.toBe(m1.L);
  expect(TL_MADE.tracks - p).toBe(1);
  expect(m2.L.tracks.get(live2)).toEqual([0, 0, 1]);
  p = TL_MADE.tracks;
  timelineModel(m2, m2.heads, 600, "clock", live.t0 + 6500);
  expect(TL_MADE.tracks - p).toBe(0);
  // 6,000 turns at Fit, each under 2 px: drawn as one span a lane, so no pass and none kept.
  const one = head(turn(4, ["a", [["Bash", "x", 1000, 2000, true]]]));
  const many = Array.from({ length: 6000 }, (_, i) => ({ ...one, key: `0:${i + 1}`, n: i + 1, t0: T0 + i * 120000 }));
  p = TL_MADE.tracks;
  const big = timelineLayout(many, 500, "clock");
  expect(TL_MADE.tracks - p).toBe(0);
  expect(big.tracks.size).toBe(0);
  // Zoomed in: only the turns laid out are worked out and kept.
  const ten = Array.from({ length: 10 }, (_, i) => head(turn(i + 1, ["a", [["Read", "x", 2000, 3000], ["Bash", "y", 2500, 9000]]])));
  const g = timelineGeo(ten, 500, "clock");
  p = TL_MADE.tracks;
  const Z = timelineLayout(ten, 500, "clock", Date.now(), { z: 4, x0: 800 }, g);
  expect(Z.tracks.size).toBe(Z.to - Z.from + 1);
  expect(Z.tracks.size).toBeLessThan(10);
  expect(TL_MADE.tracks - p).toBe(Z.tracks.size);
});

test("timeline lane-less rows: an interrupted turn's Interrupted row is no bar, so no band or press finds it", () => {
  const h = head(turn(5, [[["Read", "a", 2000, 2500]]], { interrupted: true, reply: null, end: T0 + 40000 }));
  const L = timelineLayout([h], 400, "clock", T0 + 100000);
  const read = rowsOf(h).find((r) => r.lk === "tool");
  expect(rowsOf(h).some((r) => r.lk === "stop")).toBe(true);
  // The layout draws nothing at the turn's end: the prompt's bar and the Read's.
  expect([...L.spans.values()].flat().every(([, b]) => b < 390)).toBe(true);
  // Where the Interrupted row's box would be, at the turn's end: no band, and the heading.
  expect(bandRows(L, [h], 396, 400)).toBe(null);
  expect(timelineHit(L, [h], 398, null, T0 + 100000)).toEqual({ turn: h.key, key: h.key });
  // A row with a lane is found as before: the Read's bar, 20 to 25 px.
  expect(bandRows(L, [h], 18, 30)).toEqual({ a: read.key, b: read.key });
  expect(timelineHit(L, [h], 22, null, T0 + 100000)).toEqual({ turn: h.key, key: read.key });
});

test("timeline spans: in a turn under 6 px wide, a call with no result keeps its 6 px when it joins the span before it", () => {
  const heads = Array.from({ length: 100 }, (_, i) => head(turn(i + 1, [[["Read", "a", 2000, 2500], ["Bash", "bun test", 3000, null]]], { interrupted: true, reply: null, end: T0 + 40000 })));
  const L = timelineLayout(heads, 500, "clock", T0 + 100000);
  const t = L.turns[10];
  expect(t.w).toBeGreaterThan(2);
  expect(t.w).toBeLessThan(6);
  expect(rowsOf(heads[10]).find((r) => r.lk === "noresult").open).toBe(true);
  // The call's bar is the turn's last 6 px, past its start; the Read's bar starts later. The
  // span they join holds the whole call's bar (here it reaches back over the turn before, and
  // the turns after join it too, each call's bar reaching back over the break).
  const end = t.x + t.w;
  const list = L.spans.get("tools|tools|0");
  const s = list.find((v) => v[0] <= end - 6 + 1e-9 && v[1] >= end - 1e-9);
  expect(s).toBeTruthy();
  expect(s[2]).toBe(1);
  // The spans stay apart and in order.
  for (let i = 1; i < list.length; i++) expect(list[i][0]).toBeGreaterThan(list[i - 1][1] + 0.5);
});

test("timeline press in a break: the nearer turn, and its step only within 4 px of the press itself", () => {
  const heads = [head(turn(1, [[["Read", "a", 2000, 2500]]])), head(turn(2, [[["Read", "a", 2000, 2500]]]))];
  const L = timelineLayout(heads, 600, "clock", T0 + 100000);
  const [t1, t2] = L.turns;
  expect(t1.x + t1.w).toBe(293);
  expect(t2.x).toBe(307);
  const [h1, h2] = heads;
  const prompt = rowsOf(h2)[0].key;
  const at = (x, lane = null) => timelineHit(L, heads, x, lane, T0 + 100000);
  // 301 and 303: nearer the second turn, 6 and 4 px from its prompt's bar at 307: its heading.
  expect(at(301)).toEqual({ turn: h2.key, key: h2.key });
  expect(at(301, "input")).toEqual({ turn: h2.key, key: h2.key });
  expect(at(303)).toEqual({ turn: h2.key, key: h2.key });
  // 304: 3 px from it, the prompt.
  expect(at(304)).toEqual({ turn: h2.key, key: prompt });
  // Nearer the first turn, by the same rule: 3 px past its reply's bar, the reply; 6 px, the heading.
  expect(at(296)).toEqual({ turn: h1.key, key: rowsOf(h1).find((r) => r.lk === "reply").key });
  expect(at(299)).toEqual({ turn: h1.key, key: h1.key });
});

test("timeline steps: a heading and its steps hold no path back to the heading, and the heading has only its own keys", () => {
  const { head: h, steps, fails, calls } = ledgerTurn(S, turn(3, ["Looking first.", [["Read", "src/a.ts", 2000, 2300], ["Bash", "bun test", 2100, 45000, true]]], { interrupted: true }), 0);
  expect([fails, calls]).toEqual([1, 2]);
  // No cycle: nothing reached from the heading (its steps, its turn, its lists) leads back to
  // it, so a turn's thrown-away rows are freed as soon as nothing holds them, with no wait for
  // the engine's cycle collector.
  const seen = new Set();
  const back = [];
  const walk = (v, path) => {
    if (v === null || typeof v !== "object") return;
    if (v === h && path) { back.push(path); return; }
    if (seen.has(v)) return;
    seen.add(v);
    for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`);
  };
  walk(h, "");
  expect(back).toEqual([]);
  expect(steps.length).toBeGreaterThan(3);
  // The heading's keys, all of them: a second copy of its steps under any name is caught here.
  expect(Object.keys(h).sort()).toEqual([
    "agent", "calls", "cnt", "failKeys", "fails", "going", "interrupted", "key", "kind", "lastAt", "line", "n", "partial", "reading",
    "si", "span", "stale", "steps", "t0", "timed", "tokens", "total", "ts", "turn", "userKeys",
  ]);
  // And their values: no copy of a step row (an object with a kind of step, lk) is reached
  // from the heading other than through its steps and its turn, however deep it is nested.
  const rows = [];
  const seen2 = new Set();
  const look = (v, path) => {
    if (v === null || typeof v !== "object" || seen2.has(v)) return;
    seen2.add(v);
    if ("lk" in v) { rows.push(path); return; }
    for (const k of Object.keys(v)) look(v[k], `${path}.${k}`);
  };
  for (const k of Object.keys(h)) if (k !== "steps" && k !== "turn") look(h[k], k);
  expect(rows).toEqual([]);
  // cnt holds only numbers; failKeys and userKeys only keys, each a step row's.
  expect(Object.values(h.cnt).every((v) => typeof v === "number")).toBe(true);
  const keys = new Set(steps.map((r) => r.key));
  for (const list of [h.failKeys, h.userKeys]) {
    expect(Array.isArray(list)).toBe(true);
    expect(list.every((v) => typeof v === "string" && keys.has(v))).toBe(true);
  }
  expect(h.failKeys.length).toBe(1);
  expect(h.userKeys.length).toBe(1);
});

test("timeline press in a break, zoomed: the nearer turn is found once, so a press there can not land back on the turn before", () => {
  // Twelve turns of 60 s across 1,440 px: each 102 px, breaks of 19.6 px. At this zoom, the
  // second turn's start in px of the view, turned back into px of the strip, comes out a
  // little under its start, so a second search from there finds the first turn again.
  const heads = Array.from({ length: 12 }, (_, i) => head(turn(i + 1, [[["Read", "a", 2000, 2500]]])));
  const L = timelineLayout(heads, 1440, "clock", T0 + 1e7, { z: 1.0532, x0: 0 });
  expect(L.z).toBe(1.0532);
  const t = L.turns[1];
  expect((t.x * L.z - L.x0 + L.x0) / L.z).toBeLessThan(t.x);
  // A press 1.6 px of the strip before the second turn: nearer it than the first turn's end.
  const hit = timelineHit(L, heads, (t.x - 1.6) * L.z - L.x0, null, T0 + 1e7);
  expect(hit).toEqual({ turn: heads[1].key, key: rowsOf(heads[1])[0].key });
});

test("timeline 2 px rule at its edge: a turn 2 px wide or more is drawn as bars, with its tracks; one under 2 px is not", () => {
  const h = head(turn(1, [[["Read", "a", 2000, 2500], ["Bash", "x", 2100, 3000]]]));
  // One turn placed by hand at w px, at the strip's left.
  const at = (w) => {
    const geo = { cw: 100, scale: "clock", turns: [{ x: 0, w, key: h.key, n: h.n }], index: new Map([[h.key, 0]]), walls: [60000], gap: 0, total: w, steps: tlLen(h), live: -1, room: 0 };
    return timelineLayout([h], 100, "clock", T0 + 1e7, null, geo);
  };
  expect(at(1.99).tracks.has(h)).toBe(false);
  expect(at(2).tracks.has(h)).toBe(true);
  expect(at(2.5).tracks.has(h)).toBe(true);
  // Bash starts while Read runs: the second track, so the tracks are not null.
  expect(at(2).tracks.get(h)).not.toBe(null);
});

test("timeline tracks by steps: the steps scale draws every bar full height, so no turn's tracks are worked out, in the layout or a press", () => {
  const heads = [head(turn(1, [[["Read", "a", 2000, 2500], ["Bash", "x", 2100, 3000]]])), head(turn(2, [[["Grep", "b", 2000, 2400]]]))];
  const before = TL_MADE.tracks;
  const L = timelineLayout(heads, 600, "steps", T0 + 1e7);
  expect(L.tracks.size).toBe(0);
  const x = L.turns[0].x + L.turns[0].w / 2;
  expect(timelineHit(L, heads, x, null, T0 + 1e7)?.turn).toBe(heads[0].key);
  expect(TL_MADE.tracks - before).toBe(0);
});

test("timeline bar ends: a call whose result comes after its turn's end is drawn to the turn's end, not into the break", () => {
  const h = head(turn(1, [[["Read", "a", 50000, 70000]]], { end: T0 + 60000 }));
  const i = rowsOf(h).findIndex((r) => r.lk === "tool");
  const L = timelineLayout([h], 400, "clock", T0 + 1e7);
  const t = L.turns[0];
  // Its end is past the turn's length on the clock.
  expect(tlStep(h, i).b).toBeGreaterThan(L.geo.walls[0]);
  const [bar] = L.spans.get("tools|tools|0");
  expect(bar[1]).toBe(t.x + t.w);
  expect(bar[0]).toBeLessThan(bar[1]);
});

// A turn of 60 s whose model notes are at the given ms, in that (cell) order.
const notesAt = (n, ats) => {
  const t = turn(n, ats.map((_, i) => `Note ${i + 1}.`));
  ats.forEach((at, i) => { t.steps[i].at = T0 + at; });
  return t;
};
// Each bar of lane's steps as the layout's boxes give it (itemBox), before any join.
const rawBars = (L, h, ti, lane) => {
  const t = L.turns[ti];
  const out = [];
  for (let i = 0; i < tlLen(h); i++) {
    const st = tlStep(h, i);
    if (st.lane !== lane || st.a == null) continue;
    const bx = itemBox(st.a, st.b ?? Number.NaN, st.open ? 2 : 0, i, t.x * L.z - L.x0, t.w * L.z, L.geo.walls[ti], L.scale, tlLen(h));
    out.push([bx.x0, bx.x1]);
  }
  return out;
};

test("timeline spans out of order: a bar that ends before an earlier row's bar starts stays apart from it, with the gap between them empty", () => {
  // One 60 s turn across 1,440 px (24 px a second), Fit, on the clock; its two model notes in
  // cell order at 30 s and then 10 s: two 3 px bars, at 720 and at 240 px.
  const h = head(notesAt(1, [30000, 10000]));
  const L = timelineLayout([h], 1440, "clock", T0 + 1e7);
  expect(L.turns[0]).toMatchObject({ x: 0, w: 1440 });
  const raw = rawBars(L, h, 0, "model");
  expect(raw.slice(0, 2)).toEqual([[720, 723], [240, 243]]);
  // The reply's bar is the third, from 55 s to the end.
  expect(raw[2]).toEqual([1320, 1440]);
  // Drawn: each bar in its place, the 477 px between them empty.
  expect(L.spans.get("model|model|0")).toEqual([[240, 243], [720, 723], [1320, 1440]]);
  // Out of order and touching (29.9 s and then 30 s, 0.6 px apart, overlapping): one bar.
  const g = head(notesAt(2, [30000, 29900]));
  const G = timelineLayout([g], 1440, "clock", T0 + 1e7);
  expect(rawBars(G, g, 0, "model").slice(0, 2)).toEqual([[720, 723], [717.6, 720.6]]);
  expect(G.spans.get("model|model|0")).toEqual([[717.6, 723], [1320, 1440]]);
});

test("timeline press in the gap between two bars out of order: no step, only the turn's heading, and no drawn span there", () => {
  // The two notes at 30 s and then 10 s: bars at 720 to 723 and 240 to 243 px.
  const h = head(notesAt(1, [30000, 10000]));
  const L = timelineLayout([h], 1440, "clock", T0 + 1e7);
  const [, later, earlier] = rowsOf(h);
  expect([later.lk, earlier.lk]).toEqual(["text", "text"]);
  const at = (x, lane) => timelineHit(L, [h], x, lane, T0 + 1e7);
  const drawn = (x) => L.spans.get("model|model|0").some(([a, b]) => a <= x && x <= b);
  // The 4 px rule: under 4 px from a bar, its step; at 4 px or more from both, in the model
  // lane or in none, the turn's heading, and no drawn span covers the press either.
  expect(at(246, "model")).toEqual({ turn: h.key, key: earlier.key });
  expect(at(717, "model")).toEqual({ turn: h.key, key: later.key });
  for (const x of [247, 247.5, 300, 400, 480, 600, 715.5, 716]) {
    expect(at(x, "model")).toEqual({ turn: h.key, key: h.key });
    expect(at(x, null)).toEqual({ turn: h.key, key: h.key });
    expect(drawn(x)).toBe(false);
  }
  expect(drawn(241)).toBe(true);
  expect(drawn(721)).toBe(true);
});

test("timeline spans out of order: an unfinished call's torn end is kept, apart from a bar left of it or joined with one that reaches it", () => {
  const lay = (h) => timelineLayout([h], 1440, "clock", T0 + 1e7);
  const end = { interrupted: true, reply: null, end: T0 + 60000 };
  // To a thousandth of a px (31 s of 60 across 1,440 px is 744 with a float's last bit).
  const r3 = (list) => list.map((sp) => sp.map((v) => Math.round(v * 1000) / 1000));
  // Listed Read (30 to 31 s), Bash (20 s, no result, so torn to the turn's end) and Grep (5 to
  // 6 s). In clock order Grep runs alone, then Bash holds the first track to the end, so Read
  // goes on the second; Grep's bar at 120 to 144 px is apart from the torn bar.
  const a = head(turn(1, [[["Read", "a", 30000, 31000]], [["Bash", "sleep", 20000, null]], [["Grep", "b", 5000, 6000]]], end));
  const A = lay(a);
  expect(A.turns[0]).toMatchObject({ x: 0, w: 1440 });
  expect(r3(rawBars(A, a, 0, "tools"))).toEqual([[720, 744], [480, 1440], [120, 144]]);
  expect(r3(A.spans.get("tools|tools|0"))).toEqual([[120, 144], [480, 1440, 1]]);
  expect(r3(A.spans.get("tools|tools|1"))).toEqual([[720, 744]]);
  // Read from 10 s to 50 s on the first track; Bash at 20 s with no result and a Grep listed
  // after it but started at 15 s, both while Read runs, so both on the second track: Grep at
  // 360 to 540 px reaches the torn bar, so one span, still torn.
  const b = head(turn(2, [[["Read", "a", 10000, 50000]], [["Bash", "sleep", 20000, null]], [["Grep", "b", 15000, 22500]]], end));
  const B = lay(b);
  expect(r3(rawBars(B, b, 0, "tools"))).toEqual([[240, 1200], [480, 1440], [360, 540]]);
  expect(r3(B.spans.get("tools|tools|0"))).toEqual([[240, 1200]]);
  expect(r3(B.spans.get("tools|tools|1"))).toEqual([[360, 1440, 1]]);
});

test("timeline span join (tlJoin): spans touch within half a pixel on either side; a span in any order goes in its place and joins what it reaches", () => {
  const { tlJoin } = TL;
  const run = (list, ...adds) => { for (const s of adds) tlJoin(list, ...s); return list; };
  // In order: 0.3 px apart is a touch; 0.6 px apart is not.
  expect(run([[0, 10]], [10.3, 20])).toEqual([[0, 20]]);
  expect(run([[0, 10]], [10.6, 20])).toEqual([[0, 10], [10.6, 20]]);
  // Out of order, the same on the other side: a span ending 0.3 px left of the next joins it.
  expect(run([[10, 20]], [0, 9.7])).toEqual([[0, 20]]);
  expect(run([[10, 20]], [0, 9.4])).toEqual([[0, 9.4], [10, 20]]);
  // Out of order with a gap: in its place, the others as they were.
  expect(run([[720, 723]], [240, 243])).toEqual([[240, 243], [720, 723]]);
  expect(run([[0, 3], [720, 723]], [240, 243])).toEqual([[0, 3], [240, 243], [720, 723]]);
  // A span that reaches over two keeps the leftmost start and the rightmost end.
  expect(run([[90, 95], [100, 110]], [85, 105])).toEqual([[85, 110]]);
  expect(run([[0, 10], [20, 30]], [9, 21])).toEqual([[0, 30]]);
  expect(run([[0, 10], [20, 30], [40, 50]], [5, 45])).toEqual([[0, 50]]);
  // The torn mark goes with the rightmost end. Two equal ends: torn if either is.
  expect(run([[0, 10]], [5, 10, true])).toEqual([[0, 10, 1]]);
  expect(run([[0, 10, 1]], [5, 10])).toEqual([[0, 10, 1]]);
  expect(run([[5, 10, 1]], [0, 10])).toEqual([[0, 10, 1]]);
  expect(run([[20, 30]], [5, 30, true])).toEqual([[5, 30, 1]]);
  // A torn end inside a span is hidden; one past it is the span's end.
  expect(run([[0, 10]], [2, 8, true])).toEqual([[0, 10]]);
  expect(run([[0, 10, 1]], [5, 20])).toEqual([[0, 20]]);
  expect(run([[0, 10]], [5, 20, true])).toEqual([[0, 20, 1]]);
  // Out of order and apart, each keeps its own mark.
  expect(run([[100, 110]], [50, 60, true])).toEqual([[50, 60, 1], [100, 110]]);
  expect(run([[100, 110, 1]], [50, 60])).toEqual([[50, 60], [100, 110, 1]]);
});
