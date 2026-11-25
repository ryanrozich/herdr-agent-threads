// bun test: the Trajectory's timeline as data (timeline.js, TRD-23 part 1): each heading's steps
// read from its turn's own rows (ledger.js ledgerTurn keeps no array a step), their tracks
// worked out in the layout pass, the turns placed on a strip (timelineGeo), a view of them
// (timelineLayout), the zoom and pan kept inside the session, a press found on a bar
// (timelineHit), the torn end, and a running turn whose bars grow without the rest moving
// (timelineModel, tlGrow). Nothing here draws. The turns are made up in the reader's shape
// (turns.js), as in test/ledger.test.js.
import { test, expect } from "bun:test";
import { ledgerTurn, slantPoints, TL_TRACK, TL_OPEN, TL_FAILED } from "../mods/agent-threads/ledger.js";
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
  // Past its room the turn gets the next one, and its end moves more than 1 px. A session this
  // small (1,024 steps or fewer) is placed again whole at once; a larger one keeps its places,
  // marked the old scale's, for the bounded build (test/timeline-off.test.js).
  expect(tx + T.w - 1 - m2.grow[0].x1).toBeGreaterThan(4);
  const m3 = timelineModel(m2, heads, 600, "clock", live.t0 + 16000);
  expect(m3.geo).not.toBe(m2.geo);
  expect([m3.geo.room, m3.geo.stale]).toEqual([22500, undefined]);
  expect(m3.geo).toEqual(timelineGeo(heads, 600, "clock", live.t0 + 16000));
  expect(timelineModel(m3, heads, 600, "clock", live.t0 + 17000).geo).toBe(m3.geo);
  // A new width, scale or session places it again; a turn that is not running never grows.
  // A new heads array alone is not a new session: ledger() makes one at every change, with
  // the finished headings the same (the next test).
  expect(timelineModel(m3, heads, 601, "clock", live.t0 + 17000).geo).not.toBe(m3.geo);
  expect(timelineModel(m3, [...heads], 600, "clock", live.t0 + 17000).geo).toBe(m3.geo);
  expect(timelineModel(m3, [a, { ...b }, live], 600, "clock", live.t0 + 17000).geo).not.toBe(m3.geo);
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

test("timeline press: looks at the turns that start within 4 px right of the press, and the turns under 2 px drawn to it from the left, and no further, so at 5,600 turns it reads as many turns at turn 10 as at turn 5,000", () => {
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
  // The halving takes 12 or 13 looks; then the turn, those within 4 px right of the press (two
  // reads each), and those before it whose 1 px span reaches it, which start within 1 px left of
  // it (five reads each: a turn under 2 px is read for its steps), and the one that ends the look.
  expect(Math.abs(early - late)).toBeLessThanOrEqual(2);
  expect(late).toBeLessThan(14 + 2 * Math.ceil(4 / pitch + 2) + 5 * Math.ceil(1 / pitch + 2) + 6);
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
    const under = L.turns.map((_, ti) => ti).filter((ti) => L.turns[ti].w < 2 && heads[ti].cnt?.tools && x >= span(L.turns[ti])[0] && x <= span(L.turns[ti])[1]);
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
  // With the y inside the lane: on the half track (8 to 14 px down), the Bash; above it (2 to
  // 8 px), only the Read is drawn there.
  expect(timelineHit(L, [h], at(15000), "tools", now, 10).key).toBe(bash.key);
  expect(timelineHit(L, [h], at(15000), "tools", now, 4).key).toBe(read.key);
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
  // With the y inside the lane (slice 1's view): on the Bash's bar, the Bash; above it, the
  // long turn's heading.
  const now = T0 + 1e10;
  expect(timelineHit(L, heads, t.x - 3.9, "tools", now, 10)).toEqual({ turn: heads[151].key, key: bash.key });
  expect(timelineHit(L, heads, t.x - 3.9, "tools", now, 1)).toEqual({ turn: heads[150].key, key: heads[150].key });
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

test("timeline press: with no y inside the lane, where a half-height bar is over a full one it gets the half one, even where only the full one is drawn", () => {
  // Read from 2 to 40 s, full height (2 to 14 px down the lane), and a Grep from 10 to 20 s on
  // the half track (8 to 14 px). At 15 s a press 4 px down the lane is on the Read alone, but
  // with no y the press gets the Grep, the bar drawn on top at that x. The view's press passes
  // the y, and gets the Read.
  const h = head(turn(1, [[["Read", "a", 2000, 40000]], [["Grep", "b", 10000, 20000]]]));
  const L = timelineLayout([h], 1200, "clock", T0 + 1e7);
  expect(timelineHit.length).toBe(4);
  const grep = stepsOf(h).find((it) => rowsOf(h)[it.i].tool === "Grep");
  expect(timelineHit(L, [h], 300, "tools").key).toBe(grep.key);
  const read = stepsOf(h).find((it) => rowsOf(h)[it.i].tool === "Read");
  expect(timelineHit(L, [h], 300, "tools", T0 + 1e7, 4).key).toBe(read.key);
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

// ---- slice 1's bounds (PR #299 review): what a draw can be asked to make ----
// A made-up heading's step rows (h.steps), as ledgerTurn gives them: each step's kind and
// key, and its start, end and flags from tl, three numbers a step (ms from the turn's start,
// NaN for none; flags 2 an unfinished call). The tracks are the layout's (tlTracks), from the
// times.
function rowsOf3(key, lks, tl) {
  return lks.map((lk, j) => {
    const a = tl[3 * j];
    const b = tl[3 * j + 1];
    const r = { kind: "tr", key: `tr:${key}:${j}`, lk, failed: lk === "failed", start: Number.isNaN(a) ? null : a, dur: Number.isNaN(a) || Number.isNaN(b) ? null : b - a };
    if (tl[3 * j + 2] & 2) r.open = true;
    return r;
  });
}
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
      steps: rowsOf3(key, lks, [0, Number.NaN, 0, 1000, 5000, 0, 6000, 9000, 0, 10000, 60000, 0]),
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
      for (const l of L.labels.slice(1)) if (l.text !== `${n}`) expect(Number(l.text) % k).toBe(0);
      L.labels.slice(1).forEach((l, i) => expect(clash(L.labels[i], l)).toBe(false));
      // Every multiple of k is there, but one that would touch the first turn's number, then
      // the last turn's number (numbersWithLast).
      const want = [];
      for (let ti = k - 1; ti < n; ti += k) {
        if (ti === 0 || !fits(L, ti)) continue;
        const l = { x: numAt(L, ti), text: `${ti + 1}` };
        if (!clash({ x: 0, text: "1" }, l)) want.push(l);
      }
      expect(L.labels.slice(1).map((l) => l.text)).toEqual(numbersWithLast(L, want, n).map((l) => l.text));
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

// The numbers after the first, with the last turn's number end-aligned inside the strip in place
// of those it touches; none when it would touch the first turn's. want: the multiples of k.
function numbersWithLast(L, want, n) {
  if (n < 2) return want;
  const last = { x: numAt(L, n - 1), text: `${n}` };
  if (want.some((l) => l.text === last.text) || clash({ x: 0, text: "1" }, last)) return want;
  return [...want.filter((l) => !clash(l, last)), last];
}

test("timeline numbers: the last turn's number always shows, end-aligned inside the strip, and only the number it touches gives way, with 1234 selected or nothing", () => {
  for (const cw of [1370, 1143, 1440]) {
    const heads = strip(2000);
    const L = timelineLayout(heads, cw, "clock", T0, null);
    const last = { x: numAt(L, 1999), text: "2000" };
    // The last turn starts within a number's width of the strip's end: its number is moved in.
    expect(L.turns[1999].x + TL.tlNumW("2000")).toBeGreaterThan(cw);
    expect(last.x).toBe(cw - TL.tlNumW("2000"));
    // The last multiple of k before it: kept unless the two touch.
    const k = L.every;
    const prev = { x: numAt(L, 1999 - k), text: `${2000 - k}` };
    for (const ti of [null, 1233]) {
      const nums = TL.tlNumbers(L, heads, ti);
      const texts = nums.map((l) => l.text);
      expect(nums.at(-1)).toMatchObject({ ti: 1999, x: last.x, text: "2000" });
      expect(nums.at(-1).x + TL.tlNumW("2000")).toBeLessThanOrEqual(cw);
      expect(texts.includes(prev.text)).toBe(!clash(prev, last));
      nums.slice(1).forEach((l, i) => expect(clash(nums[i], l)).toBe(false));
      if (ti != null) expect(texts).toContain("1234");
      // The last number's length: the room to the strip's end is under TL_NUM_LEN, so none.
      expect(nums.at(-1).total).toBe(null);
    }
    // Both cases met: at 1,370 px 1900 touches 2000 and is dropped; at 1,440 px it is kept.
    if (cw === 1370) expect([k, clash(prev, last)]).toEqual([100, true]);
    if (cw === 1440) expect([k, clash(prev, last)]).toEqual([100, false]);
  }
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
  // The second subagent, the failed call and the short call start while the first runs: the
  // layout puts them on the second track (tlTracks).
  return [{
    kind: "trh", key, n: 1, t0: T0, total: 60000, span: 60000, going: false,
    cnt: { steps: 6, input: 1, model: 1, tools: 4, failed: 1, user: 1, agent: 0 },
    steps: rowsOf3(key, lks, [0, Number.NaN, 0, 2000, 30000, 0, 4000, 40000, 0, 6000, 14000, 0, 9000, 10000, 0, 59000, 60000, 0]),
  }];
}

test("timeline press: where bars overlap, the press gets the bar drawn on top at its x and y: failed over the rest, half height over full, then the narrowest; the y inside the lane picks the track", () => {
  const heads = overlapping();
  const L = timelineLayout(heads, 1000, "clock", T0, null);
  const T = tlBox(L, 0);
  const box = (si) => TL.tlBar(L, heads, 0, si, T0);
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
  heads[0].steps[3] = { ...heads[0].steps[3], lk: "tool", failed: false };
  const L = timelineLayout(heads, 1000, "clock", T0, null);
  const box = (si) => TL.tlBar(L, heads, 0, si, T0);
  const mid = (si) => (box(si).x0 + box(si).x1) / 2;
  expect(timelineHit(L, heads, mid(4), "tools", T0, 11).key).toBe("tr:0:0:4");
  // Inside the long one, clear of the short one: the long one.
  expect(timelineHit(L, heads, box(3).x0 + 5, "tools", T0, 11).key).toBe("tr:0:0:3");
});

test("timeline press: a turn under 2 px at Fit is drawn as one span per lane; a press gets the turn under the pointer, and a step of it, the one drawn on top, only where its span is within 4 px; the span is the step's bar for the press and the outline", () => {
  for (const cw of [1143, 1370]) {
    const heads = strip(2000);
    // One turn with no tools call: it draws no tools span of its own. Its rows keep their
    // keys (the reply is tr:0:1000:3).
    const q = heads[1000];
    heads[1000] = { ...q, cnt: { ...q.cnt, tools: 0, failed: 0 }, steps: [q.steps[0], q.steps[3]] };
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
    // Turn 999's tools span, at least 1 px, runs over turn 1000, which has none: the press
    // gets the turn whose span is under it, 999 (the next test), not at a y above the span.
    expect(timelineHit(L, heads, T.x + T.w / 2, "tools", T0, 4)).toEqual({ turn: "0:999", key: "tr:0:999:2" });
    expect(timelineHit(L, heads, T.x + T.w / 2, "tools", T0, 1)).toEqual({ turn: "0:1000", key: "0:1000" });
    expect(timelineHit(L, heads, T.x + T.w / 2, "model", T0, 4)).toEqual({ turn: "0:1000", key: "tr:0:1000:3" });
  }
  // A wide turn's bar is its own (itemBox), as before.
  const few = strip(3);
  const L = timelineLayout(few, 1370, "clock", T0, null);
  const T = tlBox(L, 1);
  expect(TL.tlBar(L, few, 1, 2, T0)).toEqual(itemBox(6000, 9000, 4, 2, T.x, T.w, L.geo.walls[1], "clock", 4));
});

// The running turn n as ledger() gives it after k events: a new heading each time, its tool
// calls 2 s apart from 150 s in, the last one open (TL_OPEN, 2) after an even count.
function runningHead(n, k, t0) {
  const key = `0:${n - 1}`;
  const lks = ["you"];
  const tl = [0, Number.NaN, 0];
  for (let j = 0; j < k; j++) {
    const a = 150000 + j * 2000;
    const open = j === k - 1 && k % 2 === 0;
    lks.push("tool");
    tl.push(a, open ? Number.NaN : a + 1500, open ? 2 : 0);
  }
  return {
    kind: "trh", key, n, t0, total: null, span: 150000 + k * 2000, going: true,
    cnt: { steps: k + 1, input: 1, model: 0, tools: k, failed: 0, user: 1, agent: 0 },
    steps: rowsOf3(key, lks, tl),
  };
}
// What a layout draws, to set two side by side.
const drawn = (L) => ({ spans: [...L.spans.entries()], labels: L.labels, every: L.every, ticks: L.ticks, fails: L.fails, gaps: L.gaps, grow: L.grow, from: L.from, to: L.to });

test("timeline model: with events arriving in the running turn, the finished turns are placed once and laid out once; only the running turn is laid out again, and the strip is the one a whole layout makes", () => {
  for (const [n, cw] of [[8, 1370], [2000, 1370], [5600, 1143]]) {
    const done = strip(n - 1);
    const t0 = T0 + (n - 1) * 100000;
    // From 192 s in, the turn's room is 256.3 s: 30 events 2 s apart stay inside it.
    const at = (k) => t0 + 190000 + k * 2000;
    const before = { ...TL.TL_MADE };
    let cmpTracks = 0;
    let m = timelineModel(null, [...done, runningHead(n, 1, t0)], cw, "clock", at(1), null);
    const geo = m.geo;
    expect(geo.room).toBe(liveRoom(192000));
    for (let k = 2; k <= 31; k++) {
      // A new heads array at each event, as ledger() makes it, the finished headings the same.
      m = timelineModel(m, [...done, runningHead(n, k, t0)], cw, "clock", at(k), null);
      expect(m.geo).toBe(geo);
      if (k === 16) {
        const c = TL.TL_MADE.tracks;
        expect(drawn(m.L)).toEqual(drawn(timelineLayout(m.heads, cw, "clock", at(k), null)));
        cmpTracks = TL.TL_MADE.tracks - c;
      }
    }
    const made = { geo: TL.TL_MADE.geo - before.geo, layout: TL.TL_MADE.layout - before.layout, tail: TL.TL_MADE.tail - before.tail };
    // The model placed and laid out once, and laid out the running turn alone at each of the
    // 30 events. The whole layout at k 16, for the comparison above, adds one of each.
    expect(made).toEqual({ geo: 2, layout: 2, tail: 30 });
    // Tracks are worked out only for a turn 2 px or wider: each finished one once, the running
    // one at the first layout and then once an event. At Fit at 2,000 and 5,600 turns no
    // finished turn is that wide, so only the running turn's are, where its room makes it so.
    const wide = (ti) => tlBox(m.L, ti).w >= 2;
    const W = done.filter((_, ti) => wide(ti)).length;
    const r = wide(n - 1) ? 1 : 0;
    expect(TL.TL_MADE.tracks - before.tracks - cmpTracks).toBe(W + 31 * r);
    expect(cmpTracks).toBe(W + r);
    expect(W).toBe(n === 8 ? 7 : 0);
    if (n === 8) expect(r).toBe(1);
    // The same strip as a whole layout of the last heads, the running turn's open bar too.
    const whole = timelineLayout(m.heads, cw, "clock", at(31), null);
    expect(drawn(m.L)).toEqual(drawn(whole));
    const m2 = timelineModel(m, [...done, runningHead(n, 32, t0)], cw, "clock", at(32), null);
    // Its open call grows where the turn is 2 px or wider; under 2 px it is the lane's span.
    expect(m2.grow.length).toBe(tlBox(m2.L, n - 1).w >= 2 ? 1 : 0);
    expect(drawn(m2.L)).toEqual(drawn(timelineLayout(m2.heads, cw, "clock", at(32), null)));
    // Past its room (a step of liveRoom): nothing placed, the running turn laid out alone, the
    // places kept; marked the old scale's for the bounded build (test/timeline-off.test.js)
    // where its end moved more than 1 px, as working on. At 8 turns (1,024 steps or fewer) it is
    // placed again whole at once instead.
    const b3 = { ...TL.TL_MADE };
    const m3 = timelineModel(m2, [...done, runningHead(n, 33, t0)], cw, "clock", t0 + 260000, null);
    const c3 = [TL.TL_MADE.geo - b3.geo, TL.TL_MADE.layout - b3.layout, TL.TL_MADE.tail - b3.tail];
    // At 8 turns its places are a whole placing's.
    if (n === 8) expect(m3.geo).toEqual(timelineGeo(m3.heads, cw, "clock", t0 + 260000));
    expect([n, ...c3]).toEqual([n, ...(n === 8 ? [1, 1, 0] : [0, 0, 1])]);
    const moved = Math.abs(m3.geo.turns[n - 1].w - m2.geo.turns[n - 1].w);
    expect([n, m3.geo.room, m3.geo.stale, moved > 1]).toEqual([n, liveRoom(260000), n === 2000 ? true : undefined, n !== 5600]);
    // A finished heading that is new (another session, or the turn before the running one
    // just ended) places it again.
    const g1 = TL.TL_MADE.geo;
    const d2 = [...done];
    d2[n - 2] = { ...d2[n - 2] };
    timelineModel(m3, [...d2, runningHead(n, 33, t0)], cw, "clock", t0 + 260000, null);
    expect(TL.TL_MADE.geo - g1).toBe(1);
  }
});

test("timeline model: working on or off on the last turn alone places nothing in that frame: the finished turns keep their places and only the last is laid out; working off, or on with its end moved more than 1 px, marks the places the old scale's for the bounded build, past 1,024 steps; at 3 turns either is placed again whole at once", () => {
  // on: what working on does. kept: its end moves 1 px or less, so the places are kept and not
  // marked; marked: it moves more on a session past 1,024 steps (a running turn of 12 calls,
  // 174 s long, whose room is the next step, 256.3 s), so they are kept and marked; whole: it
  // moves more on a session of 1,024 steps or fewer, placed again whole.
  for (const [n, cw, k, on] of [[2000, 1370, 6, "kept"], [5600, 1143, 6, "kept"], [257, 1370, 12, "marked"], [3, 1370, 6, "whole"]]) {
    const done = strip(n - 1);
    const t0 = T0 + (n - 1) * 100000;
    const run = runningHead(n, k, t0);
    const big = 4 * (n - 1) + k + 1 > TL.TL_BUILD_BARS;
    const fin = { ...run, going: false, total: run.span };
    const at = t0 + run.span + 1000;
    const room = liveRoom(run.span + 1000);
    const m0 = timelineModel(null, [...done, fin], cw, "clock", at, null);
    expect([m0.geo.room, m0.geo.live]).toEqual([0, -1]);
    const count = (b) => ({ geo: TL.TL_MADE.geo - b.geo, layout: TL.TL_MADE.layout - b.layout, tail: TL.TL_MADE.tail - b.tail, tracks: TL.TL_MADE.tracks - b.tracks });
    // Working on: the last heading new and running, so it has a room on the strip. The finished
    // turns' tracks are the last layout's either way (timelineLayout kept).
    let before = { ...TL.TL_MADE };
    const m1 = timelineModel(m0, [...done, { ...run }], cw, "clock", at, null);
    const c1 = count(before);
    expect([m1.geo.room, m1.geo.live, m1.geo.walls[n - 1]]).toEqual([room, n - 1, room]);
    // A whole placing of these heads, and how far it would move the turns from their places.
    const fresh = timelineGeo(m1.heads, cw, "clock", at);
    const moved = Math.max(...fresh.turns.map((t, ti) => Math.abs(t.x - m0.geo.turns[ti].x)));
    const wide = (m) => (tlBox(m.L, n - 1).w >= 2 ? 1 : 0);
    expect([n, big]).toEqual([n, on !== "whole"]);
    if (on === "kept") {
      expect(moved).toBeLessThanOrEqual(1);
      expect(c1).toEqual({ geo: 0, layout: 0, tail: 1, tracks: wide(m1) });
      expect(m1.geo.turns.slice(0, -1).every((t, ti) => t === m0.geo.turns[ti])).toBe(true);
      expect(m1.geo.turns[n - 1].x).toBe(m0.geo.turns[n - 1].x);
      for (let ti = 0; ti < n; ti++) expect(Math.abs(m1.geo.turns[ti].x - fresh.turns[ti].x)).toBeLessThanOrEqual(1);
      expect(m1.geo.stale).toBeUndefined();
    } else if (on === "marked") {
      // Its end moves more than 1 px past 1,024 steps: the places are kept all the same, marked
      // the old scale's, and only the last turn is laid out, its tracks worked out alone (it is
      // 2 px or wider); tlDraw places them again over the draws after (test/timeline-off.test.js).
      expect(moved).toBeGreaterThan(1);
      expect([n, wide(m1)]).toEqual([n, 1]);
      expect(c1).toEqual({ geo: 0, layout: 0, tail: 1, tracks: 1 });
      expect(m1.geo.stale).toBe(true);
      expect(m1.geo.turns.slice(0, -1).every((t, ti) => t === m0.geo.turns[ti])).toBe(true);
    } else {
      // Its end moves more than 1 px on a session of 1,024 steps or fewer: placed again whole at
      // once, nothing marked (test/timeline-off.test.js holds the edge).
      expect(moved).toBeGreaterThan(1);
      expect(c1).toEqual({ geo: 1, layout: 1, tail: 0, tracks: wide(m1) });
      expect(m1.geo.stale).toBeUndefined();
      expect(m1.geo).toEqual(fresh);
    }
    // The strip is the one a whole layout of those places makes: the running turn's bars grow.
    expect(drawn(m1.L)).toEqual(drawn(timelineLayout(m1.heads, cw, "clock", at, null, m1.geo)));
    expect(m1.L.geo).toBe(m1.geo);
    // Working off: the last heading new and finished again, back to its own length.
    before = { ...TL.TL_MADE };
    const m2 = timelineModel(m1, [...done, { ...fin }], cw, "clock", at, null);
    expect([m2.geo.room, m2.geo.live, m2.geo.walls[n - 1]]).toEqual([0, -1, run.span]);
    // Placed nothing, and marked the old scale's either way, so the bounded build makes it exact;
    // at 3 turns placed again whole at once.
    if (big) {
      expect(count(before)).toEqual({ geo: 0, layout: 0, tail: 1, tracks: wide(m2) });
      expect(m2.geo.stale).toBe(true);
      expect(m2.geo.turns.every((t, ti) => ti === n - 1 ? t.w === m0.geo.turns[ti].w : t === m0.geo.turns[ti])).toBe(true);
    } else {
      expect(count(before)).toEqual({ geo: 1, layout: 1, tail: 0, tracks: wide(m2) });
      expect(m2.geo.stale).toBeUndefined();
      expect(m2.geo).toEqual(timelineGeo(m2.heads, cw, "clock", at));
    }
    expect(drawn(m2.L)).toEqual(drawn(timelineLayout(m2.heads, cw, "clock", at, null, m2.geo)));
  }
});

test("timeline press: on turns under 1 px whose spans join, a press on a drawn span gets a turn with a bar in the lane, none nearer, never a turn with none", () => {
  const heads = strip(4000);
  // Every other turn has no tools call, and turns 2000 to 2100 none at all.
  const bare = (q) => ({ ...q, cnt: { ...q.cnt, tools: 0, failed: 0 }, steps: [q.steps[0], q.steps[3]] });
  for (let i = 0; i < 4000; i++) if (i % 2 === 1 || (i >= 2000 && i <= 2100)) heads[i] = bare(heads[i]);
  const has = (i) => heads[i].cnt.tools > 0;
  const L = timelineLayout(heads, 1000, "clock", T0, null);
  const span = (j) => { const T = tlBox(L, j); return [T.x, T.x + Math.max(T.w, 1)]; };
  const dist = (j, x) => { const [a, b] = span(j); return x < a ? a - x : x > b ? x - b : 0; };
  const drawnTools = [...(L.spans.get("tools|failed|0") ?? []), ...(L.spans.get("tools|tools|0") ?? [])];
  expect(tlBox(L, 1).w).toBeLessThan(1);
  let presses = 0;
  const wrong = [];
  for (const [a, b] of drawnTools) {
    for (let x = a; x <= b; x += 0.25) {
      presses++;
      const hit = timelineHit(L, heads, x, "tools", T0, 8);
      const ti = L.index.get(hit.turn);
      if (!hit.key.startsWith("tr:") || !has(ti)) { wrong.push(`${x.toFixed(2)}: ${hit.key}`); continue; }
      // The nearest turn with tools: none of those around it is nearer.
      const d = dist(ti, x);
      for (let j = Math.max(0, ti - 30); j <= Math.min(3999, ti + 30); j++) if (has(j) && dist(j, x) < d - 1e-9) wrong.push(`${x.toFixed(2)}: ${hit.turn} not ${j}`);
    }
  }
  expect(presses).toBeGreaterThan(2000);
  expect(wrong.slice(0, 5)).toEqual([]);
  // Where no turn within 4 px has a tools bar (inside the run 2000 to 2100), the heading of
  // the turn under the pointer.
  const T = tlBox(L, 2050);
  expect(timelineHit(L, heads, T.x + T.w / 2, "tools", T0, 8)).toEqual({ turn: "0:2050", key: "0:2050" });
  expect(timelineHit(L, heads, T.x + T.w / 2, "model", T0, 8)).toEqual({ turn: "0:2050", key: "tr:0:2050:3" });
});

test("timeline paint: a layer's path is kept while its spans are the same, a new array of the same spans too, and built again when they, the width, the height or the colour change; over events only the changed layers are built", () => {
  const keep = new Map();
  let builds = 0;
  const build = (s) => ({ n: ++builds, s });
  const before = TL.TL_MADE.paths;
  const key = "1370|12|#e05050";
  const p1 = TL.tlPathOf(keep, "x", [[0, 5], [7, 9, 1]], key, build);
  expect(TL.tlPathOf(keep, "x", [[0, 5], [7, 9, 1]], key, build)).toBe(p1);
  expect(builds).toBe(1);
  // A torn end gone, a span moved, one more span, another width, height or colour: built again.
  for (const [spans, k] of [[[[0, 5], [7, 9]], key], [[[0, 5], [7, 9.5]], key], [[[0, 5], [7, 9.5], [10, 11]], key], [[[0, 5], [7, 9.5], [10, 11]], "1143|12|#e05050"], [[[0, 5], [7, 9.5], [10, 11]], "1143|6|#e05050"], [[[0, 5], [7, 9.5], [10, 11]], "1143|6|#ffffff"]]) {
    const n = builds;
    const p = TL.tlPathOf(keep, "x", spans, k, build);
    expect(builds).toBe(n + 1);
    expect(p.s).toBe(spans);
    expect(TL.tlPathOf(keep, "x", spans.map((sp) => sp.slice()), k, build)).toBe(p);
  }
  // Each layer by its own id.
  expect(TL.tlPathOf(keep, "y", [[0, 5]], key, build)).not.toBe(TL.tlPathOf(keep, "x", [[0, 5]], key, build));
  expect(TL.TL_MADE.paths - before).toBe(builds);
  // Events arriving in a running turn: the layout's lists are new arrays at each event (tlTail),
  // but only the lanes the running turn changed are built again.
  for (const [n, cw] of [[8, 1370], [2000, 1370]]) {
    const done = strip(n - 1);
    const t0 = T0 + (n - 1) * 100000;
    const at = (k) => t0 + 190000 + k * 2000;
    const lanes = new Map();
    let b = 0;
    const paint = (L) => { for (const [k, spans] of L.spans) TL.tlPathOf(lanes, k, spans, `${cw}|12`, () => ({ n: ++b })); };
    let m = timelineModel(null, [...done, runningHead(n, 1, t0)], cw, "clock", at(1), null);
    paint(m.L);
    expect(b).toBe(m.L.spans.size);
    for (let k = 2; k <= 6; k++) {
      const was = new Map([...m.L.spans].map(([key, s]) => [key, JSON.stringify(s)]));
      m = timelineModel(m, [...done, runningHead(n, k, t0)], cw, "clock", at(k), null);
      const changed = [...m.L.spans].filter(([key, s]) => was.get(key) !== JSON.stringify(s)).length;
      const b0 = b;
      paint(m.L);
      expect(b - b0).toBe(changed);
      expect(changed).toBeLessThan(m.L.spans.size);
    }
  }
});

test("timeline build: from nothing it goes on over frames: past its budget in one it stops, goes on in the next, and ends with the model a whole build makes", () => {
  for (const [n, cw] of [[5600, 1143], [20000, 1370]]) {
    const heads = strip(n);
    // A clock the test holds: one unit a look, so each frame does the same work.
    let t = 0;
    const clock = () => t++;
    const J = TL.tlBuildStart(heads, cw, "clock", T0, null);
    const per = [];
    let M = null;
    for (let f = 0; f < 5000 && !M; f++) {
      M = TL.tlBuildGo(J, t + 4, clock);
      per.push(J.ran);
    }
    expect(M).not.toBe(null);
    // At most five steps a frame (the budget's four looks, and the step before the first), each
    // at most TL_BUILD_CHUNK turns, so it takes many frames; nothing done twice or left out.
    expect(Math.max(...per)).toBeLessThanOrEqual(5 * TL.TL_BUILD_CHUNK);
    expect(per.length).toBeGreaterThan(Math.floor(J.total / (5 * TL.TL_BUILD_CHUNK)));
    expect(per.reduce((a, b) => a + b, 0)).toBe(J.total);
    expect(J.total).toBeGreaterThanOrEqual(3 * n);
    const whole = timelineModel(null, heads, cw, "clock", T0, null);
    expect(M.geo.turns).toEqual(whole.geo.turns);
    expect(drawn(M.L)).toEqual(drawn(whole.L));
    // It goes on as a model does: the next draw keeps it.
    const before = { ...TL.TL_MADE };
    expect(timelineModel(M, heads, cw, "clock", T0, null).L).toBe(M.L);
    expect([TL.TL_MADE.geo - before.geo, TL.TL_MADE.layout - before.layout]).toEqual([0, 0]);
  }
  // With no bound, one frame.
  expect(TL.tlBuildGo(TL.tlBuildStart(strip(50), 1370, "clock", T0, null), Infinity, () => 0)).not.toBe(null);
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
    "agent", "calls", "cnt", "failKeys", "fails", "going", "interrupted", "key", "kind", "lastAt", "n", "partial", "reading",
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

// A seeded session of mixed turns: about 1 in 25 long (10 to 50 minutes, notes and calls, some
// run at once, some failed), the rest short (1 to 40 s: the prompt, maybe a note, maybe a reply,
// up to 3 calls, some failed). At Fit most turns are under 2 px.
function mixedSession(n, seed) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const heads = [];
  let at = T0;
  for (let i = 0; i < n; i++) {
    const long = rnd() < 0.04;
    const len = long ? Math.round(600000 + rnd() * 2400000) : Math.round(1000 + rnd() * 39000);
    const steps = [];
    if (long) {
      let t = 2000;
      for (let k = 0; t < len - 20000 && k < 20; k++) {
        if (rnd() < 0.3) steps.push("Looking.");
        const d = Math.round(500 + rnd() * (len / 12));
        const call = ["Bash", "x", t, Math.min(len - 1000, t + d), rnd() < 0.25];
        if (rnd() < 0.3) steps.push([call, ["Read", "y", t + Math.round(d / 3), Math.min(len - 1000, t + Math.round(d / 2)), rnd() < 0.25]]);
        else steps.push([call]);
        t += d + Math.round(rnd() * 20000);
      }
    } else {
      if (rnd() < 0.3) steps.push("Looking.");
      const calls = Math.floor(rnd() * 4);
      for (let k = 0; k < calls; k++) steps.push([["Read", "z", 200 + k * 200, Math.min(len - 100, 300 + k * 200), rnd() < 0.3]]);
    }
    const t = turn(i + 1, steps, { end: T0 + len, reply: rnd() < 0.5 ? null : "Done.", untimed: false });
    heads.push({ ...head(t), t0: at });
    at += len + Math.round(5000 + rnd() * 600000);
  }
  return heads;
}
// The failure marks two rules give, from each turn's failed bars' centres in order: turns
// [{ narrow, x, w, cs }] (cs: a wide turn's failed bars' centres). by: "centre" (the rule),
// "x" (a turn under 2 px gated and spaced by its x, as at d97a479a) or "own" (a wide turn with
// failed bars spacing its marks afresh, not from the turn before).
function marksBy(turns, by) {
  const out = [];
  let end = -Infinity;
  for (const t of turns) {
    if (t.narrow) {
      if (!t.cs.length) continue;
      const g = by === "x" ? t.x : t.x + t.w / 2;
      if (g >= end) { out.push(t.x + t.w / 2); end = g + 6; }
    } else {
      if (by === "own" && t.cs.length) end = -Infinity;
      for (const c of [...t.cs].sort((p, q) => p - q)) if (c >= end) { out.push(c); end = c + 6; }
    }
  }
  return out;
}
const breaksRule = (marks, centres) => marks.some((m, k) => k > 0 && m - marks[k - 1] < 6 - 1e-9) || centres.some((c) => !marks.some((m) => Math.abs(m - c) <= 6 + 1e-9));

test("timeline seeded mixed turns: the failure marks keep both rules, and every press gets the bar drawn on top there, or the nearest of the turn drawn there", () => {
  const seen = { x: 0, own: 0, deep: 0 };
  for (const [n, cw, seed] of [[1000, 1440, 3], [2500, 1440, 5], [700, 1143, 7]]) {
    const heads = mixedSession(n, seed);
    const L = timelineLayout(heads, cw, "clock", T0 + 1e12);
    const T = L.turns;
    const all = [];
    const turns = T.map((t, ti) => {
      const h = heads[ti];
      const narrow = t.w < 2;
      const wall = L.geo.walls[ti];
      const len = tlLen(h);
      const tk = narrow ? null : L.tracks.has(h) ? L.tracks.get(h) : tlTracks(h);
      const cs = [];
      const bars = [];
      for (let i = 0; i < len; i++) {
        const st = tlStep(h, i, tk);
        if (!st.sk) continue;
        const r = (narrow ? 0 : st.track) + (st.ink === "failed" ? 2 : 0);
        const b = narrow ? { x0: t.x, x1: t.x + Math.max(t.w, 1) } : itemBox(st.a ?? Number.NaN, st.b ?? Number.NaN, (st.track ? TL_TRACK : 0) | (st.open ? TL_OPEN : 0) | (st.failed ? TL_FAILED : 0), i, t.x, t.w, wall, "clock", len);
        if (!b) continue;
        const bar = { ti, i, key: st.key, lane: st.lane, x0: b.x0, x1: b.x1, r, w: b.x1 - b.x0 };
        bars.push(bar);
        all.push(bar);
        if (st.failed && !narrow) cs.push((b.x0 + b.x1) / 2);
      }
      if (narrow && h.cnt?.failed) cs.push(t.x + t.w / 2);
      return { narrow, x: t.x, w: t.w, cs, bars };
    });
    // Marks: the layout's are the rule's and keep both rules; the two old rules each break one
    // on some case (so a mark rule turned back is seen).
    const centres = turns.flatMap((t) => t.cs);
    const want = marksBy(turns, "centre");
    expect([n, L.fails.length]).toEqual([n, want.length]);
    L.fails.forEach((m, k) => expect(m).toBeCloseTo(want[k], 9));
    expect([n, breaksRule(L.fails, centres)]).toEqual([n, false]);
    if (breaksRule(marksBy(turns, "x"), centres)) seen.x++;
    if (breaksRule(marksBy(turns, "own"), centres)) seen.own++;
    // The press, at every 0.13 px of the strip in each lane, against all bars.
    const byPx = new Map();
    for (const b of all) for (let p = Math.floor(b.x0) - 4; p <= Math.floor(b.x1) + 4; p++) { if (!byPx.has(p)) byPx.set(p, []); byPx.get(p).push(b); }
    const drawnAt = (fx, wide) => {
      let lo = 0;
      while (lo + 1 < T.length && T[lo + 1].x <= fx) lo++;
      const end = T[lo].x + (wide || T[lo].w >= 2 ? T[lo].w : Math.max(T[lo].w, 1));
      return fx > end && T[lo + 1] && T[lo + 1].x - fx < fx - end ? lo + 1 : lo;
    };
    let covered = 0;
    let thin = 0;
    let moved = 0;
    let lo0 = 0;
    for (let x = 0; x < cw; x += 0.13) {
      while (lo0 + 1 < T.length && T[lo0 + 1].x <= x) lo0++;
      for (const lane of ["input", "model", "tools"]) {
        const near = (byPx.get(Math.floor(x)) ?? []).filter((b) => b.lane === lane);
        const on = near.filter((b) => b.x0 <= x && x <= b.x1);
        const got = timelineHit(L, heads, x, lane, T0 + 1e12);
        if (on.length) {
          covered++;
          const top = on.reduce((m, b) => (b.r > m.r || (b.r === m.r && b.w < m.w) ? b : m));
          const okBars = on.filter((b) => b.r === top.r && b.w === top.w);
          const ok = okBars.map((b) => b.key);
          if (on.some((b) => b.ti < lo0)) thin++;
          // Only a span of a turn two or more before the one starting under the press is on top
          // there: a press that looked back at one turn only would miss it.
          if (okBars.every((b) => b.ti <= lo0 - 2)) seen.deep++;
          if (!ok.includes(got.key)) expect([n, x, lane, got.key]).toEqual([n, x, lane, ok]);
        } else {
          // No bar under it: the turn drawn there, as wide as drawn (at least 1 px under 2 px),
          // or the nearer one in a break; its nearest bar within 4 px, else its heading.
          const D = drawnAt(x, false);
          if (D !== drawnAt(x, true)) moved++;
          let best = null;
          for (const b of turns[D].bars) {
            if (b.lane !== lane) continue;
            const d = x < b.x0 ? b.x0 - x : x - b.x1;
            if (d < 4 && (!best || d < best.d)) best = { d, key: b.key };
          }
          const want = { turn: heads[D].key, key: best ? best.key : heads[D].key };
          if (got.turn !== want.turn || got.key !== want.key) expect([n, x, lane, got]).toEqual([n, x, lane, want]);
        }
      }
    }
    // The session holds the cases: presses on a span of a turn before the one starting under
    // the press, and presses past a narrow turn's own width but inside its drawn 1 px, nearer
    // the next turn.
    expect([n, covered > 1000, thin > 20, moved > 20]).toEqual([n, true, true, true]);
  }
  expect([seen.x > 0, seen.own > 0, seen.deep > 100]).toEqual([true, true, true]);
}, 120000);

// The seeded sessions zoomed in, where a turn under 2 px at Fit can be drawn as bars and a
// turn still under 2 px has its 1 px span run over the turns after it. The bars in px of the
// view, as the press places them: each turn at x * z - x0, w * z wide.
function viewBars(L, heads, cw) {
  const all = [];
  const turns = L.turns.map((t, ti) => {
    const tx = t.x * L.z - L.x0;
    const tw = t.w * L.z;
    const narrow = tw < 2;
    const bars = [];
    if (tx > cw + 8 || tx + Math.max(tw, 1) < -8) return { narrow, tx, tw, bars };
    const h = heads[ti];
    const wall = L.geo.walls[ti];
    const len = tlLen(h);
    const tk = narrow ? null : L.tracks.has(h) ? L.tracks.get(h) : tlTracks(h);
    for (let i = 0; i < len; i++) {
      const st = tlStep(h, i, tk);
      if (!st.sk) continue;
      const r = (narrow ? 0 : st.track) + (st.ink === "failed" ? 2 : 0);
      const b = narrow ? { x0: tx, x1: tx + Math.max(tw, 1) } : itemBox(st.a ?? Number.NaN, st.b ?? Number.NaN, (st.track ? TL_TRACK : 0) | (st.open ? TL_OPEN : 0) | (st.failed ? TL_FAILED : 0), i, tx, tw, wall, "clock", len);
      if (!b) continue;
      const bar = { ti, i, key: st.key, lane: st.lane, x0: b.x0, x1: b.x1, r, w: b.x1 - b.x0 };
      bars.push(bar);
      all.push(bar);
    }
    return { narrow, tx, tw, bars };
  });
  return { all, turns };
}

test("timeline seeded mixed turns, zoomed: every press gets the bar drawn on top there, at a thin span's exact drawn end too, and over a near bar of the turn under the press", () => {
  const seen = { near: 0, end: 0 };
  for (const [n, cw, seed, z] of [[5600, 1143, 11, 3.7], [2500, 1440, 5, 2.5], [20000, 1440, 3, 6], [1000, 1440, 3, 1]]) {
    const heads = mixedSession(n, seed);
    const G = timelineGeo(heads, cw, "clock");
    const GT = G.turns;
    // The views: the session's middle, and up to 12 spread over it, each centred on a turn drawn
    // as bars, with a failed call, that the 1 px span of the turn under 2 px before it runs into.
    const into = [];
    for (let j = 0; j + 1 < GT.length; j++) {
      const w = GT[j].w * z;
      if (w < 2 && GT[j].x * z + Math.max(w, 1) > GT[j + 1].x * z && GT[j + 1].w * z >= 2 && heads[j + 1].cnt?.failed) into.push(j + 1);
    }
    const views = [0.5 * (G.total * z - cw)];
    const k6 = Math.min(12, into.length);
    for (let k = 0; k < k6; k++) views.push(GT[into[Math.floor((k * into.length) / k6)]].x * z - cw / 2);
    for (const vx of views) {
      const L = timelineLayout(heads, cw, "clock", T0 + 1e12, { z, x0: vx }, G);
      expect([n, L.z]).toEqual([n, z]);
      const T = L.turns;
      const { all, turns } = viewBars(L, heads, cw);
      const byPx = new Map();
      for (const b of all) for (let p = Math.floor(b.x0) - 4; p <= Math.floor(b.x1) + 4; p++) { if (!byPx.has(p)) byPx.set(p, []); byPx.get(p).push(b); }
      // The turn the press is in: found on the strip, then the nearer one past its drawn end.
      const turnAt = (x) => {
        const fx = (x + L.x0) / L.z;
        let lo = 0;
        let hi = T.length - 1;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T[m].x <= fx) lo = m; else hi = m - 1; }
        const end = T[lo].x + (T[lo].w * L.z < 2 ? Math.max(T[lo].w, 1 / L.z) : T[lo].w);
        return fx > end && T[lo + 1] && T[lo + 1].x - fx < fx - end ? lo + 1 : lo;
      };
      const press = (x, lane) => {
        if (!(x >= 0 && x < cw)) return null;
        const D = turnAt(x);
        const on = (byPx.get(Math.floor(x)) ?? []).filter((b) => b.lane === lane && b.x0 <= x && x <= b.x1);
        const got = timelineHit(L, heads, x, lane, T0 + 1e12);
        // The nearest bar of the turn the press is in, within 4 px, the first listed at equal distance.
        let best = null;
        for (const b of turns[D].bars) {
          if (b.lane !== lane) continue;
          const d = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
          if (d < 4 && (!best || d < best.d)) best = { d, b };
        }
        if (!on.length) {
          const want = { turn: heads[D].key, key: best ? best.b.key : heads[D].key };
          if (got.turn !== want.turn || got.key !== want.key) expect([n, x, lane, got]).toEqual([n, x, lane, want]);
          return null;
        }
        const top = on.reduce((m, b) => (b.r > m.r || (b.r === m.r && b.w < m.w) ? b : m));
        const okBars = on.filter((b) => b.r === top.r && b.w === top.w);
        if (!okBars.some((b) => b.key === got.key)) expect([n, x, lane, got.key]).toEqual([n, x, lane, okBars.map((b) => b.key)]);
        // Every bar under the press is an earlier turn's span, and the turn the press is in has
        // a bar near it, not under it, that the span drawn on top does not outrank. A look-back
        // that let a span replace that near bar only by outranking it would answer the near bar.
        if (on.every((b) => b.ti < D) && best && best.d > 0 && !(top.r > best.b.r || (top.r === best.b.r && top.w < best.b.w))) seen.near++;
        return { D, okBars };
      };
      for (let x = 0; x < cw; x += 0.13) for (const lane of ["input", "model", "tools"]) press(x, lane);
      for (let j = 1; j < T.length; j++) {
        const t = turns[j];
        const p = turns[j - 1];
        if (!t.bars.length && !p.bars.length) continue;
        // Inside the span of a turn under 2 px where it runs into a turn drawn as bars: 16 presses
        // between the bars' turn's start and the span's end.
        if (!t.narrow && p.narrow) {
          const reach = p.tx + Math.max(p.tw, 1);
          for (let k = 0; k < 16 && reach > t.tx; k++) for (const lane of ["input", "model", "tools"]) press(t.tx + ((reach - t.tx) * (k + 0.5)) / 16, lane);
        }
        // At the exact drawn end of each span of a turn under 2 px, where the span is still under
        // the press. Where only spans that end at the press, of turns before the one the press is
        // in, are drawn on top, a look-back that stopped at a span ending at the press misses them.
        if (p.narrow && p.bars.length) {
          const x = T[j - 1].x * L.z - L.x0 + Math.max(T[j - 1].w * L.z, 1);
          for (const lane of new Set(p.bars.map((b) => b.lane))) {
            const r = press(x, lane);
            if (r?.okBars.every((b) => b.ti < r.D && b.x1 === x)) seen.end++;
          }
        }
      }
    }
  }
  // The sessions hold both cases: 77 presses over a near bar, at 17 turns, and 28,420 at a
  // span's exact end.
  expect([seen.near > 40, seen.end > 10000]).toEqual([true, true]);
}, 120000);
