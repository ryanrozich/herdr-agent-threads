// bun test: the timeline's spans on a made-up session whose bars come out of the clock's order
// (make-fixture.js --order), read by the pane's own reader: the three ways it happens, each
// drawn as the union of its bars, with the gaps between them left empty.
// 1. A line listed after a later one but stamped earlier: two notes at 30 s and then 10 s.
// 2. An unfinished call that starts in its turn's last quarter second: it is drawn 6 px wide,
//    so it starts left of the finished call listed before it.
// 3. The same in a turn under 6 px wide (the --order turns after 100 short ones, across
//    1,440 px): the unfinished call's bar starts left of the turn itself.
// Then the same three turns' bars worked out by hand from their times, and tlJoin by property:
// random orders of made-up bars, checked against their union after every add.
import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply, parseChunk, nextChunk } from "../mods/agent-threads/core/turns.js";
import { ledgerTurn } from "../mods/agent-threads/ledger.js";
import { timelineLayout, timelineHit, itemBox, tlLen, tlStep, tlTracks, tlJoin } from "../mods/agent-threads/timeline.js";

const root = join(import.meta.dir, "..");
const extractor = join(root, "mods/agent-threads/core/extract.sh");
const NOW = Date.parse("2027-01-01T00:00:00Z");

function session(dir, name, ...flags) {
  const file = join(dir, `${name}.jsonl`);
  execFileSync("bun", [join(root, "test/make-fixture.js"), file, "00000000-0000-4000-8000-000000000061", "/tmp/threads-demo", ...flags], { stdio: "ignore" });
  const s = newSession("s", file);
  const base = 1 << 20;
  let chunk = base;
  for (let guard = 0; guard < 1000 && chunk; guard++) {
    const r = parseChunk(execFileSync("sh", [extractor, file, String(s.offset), String(chunk), "claude"], { encoding: "utf8" }));
    if (r.head && !s.head) s.head = r.head;
    s.size = r.size;
    for (const e of r.events) apply(s, e);
    s.offset += r.used;
    chunk = nextChunk(s, r.used, chunk, base);
  }
  const heads = s.turns.map((t, i) => ledgerTurn(s, t, 0, i === s.turns.length - 1 && !t.done && !t.interrupted).head);
  return { s, heads };
}
// The made-up sessions are written to a folder of their own and read; make(dir) returns what
// the tests use, and the folder goes once it returns or throws (seen: the folders made).
const seen = [];
function fixtures(make) {
  const dir = mkdtempSync(join(tmpdir(), "threads-tlorder-"));
  seen.push(dir);
  try {
    return make(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const { short, many } = fixtures((dir) => ({
  short: session(dir, "order", "--only", "0", "--order"),
  many: session(dir, "order-many", "--only", "100", "--order"),
}));
const byPrompt = (o, text) => o.heads[o.s.turns.findIndex((t) => t.prompt === text)];

// One turn's bars by span key, in the order the layout puts them in (its row order), each as
// itemBox gives it: [x0, x1, torn].
function rawBars(L, h, ti) {
  const t = L.turns[ti];
  const tk = tlTracks(h);
  const out = new Map();
  for (let i = 0; i < tlLen(h); i++) {
    const st = tlStep(h, i);
    if (!st.sk || st.a == null) continue;
    const bx = itemBox(st.a, st.b ?? Number.NaN, (tk?.[i] ? 1 : 0) | (st.open ? 2 : 0), i, t.x * L.z - L.x0, t.w * L.z, L.geo.walls[ti], L.scale, tlLen(h));
    if (!bx) continue;
    const k = st.sk[bx.track ? 1 : 0];
    if (!out.has(k)) out.set(k, []);
    out.get(k).push([bx.x0, bx.x1, bx.open ? 1 : 0]);
  }
  return out;
}
// Whether a list of bars comes with one starting left of one before it.
const outOfOrder = (bars) => bars.some((b, i) => bars.slice(0, i).some((p) => b[0] < p[0]));
// The union of bars, worked out apart from the layout: sorted by start, joined where they touch
// within half a pixel; the torn mark goes with the rightmost end, kept at equal ends if either is.
function union(bars) {
  const out = [];
  for (const [a, b, torn] of [...bars].sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 0.5) {
      if (b > last[1]) { last[1] = b; last[2] = torn; }
      else if (b === last[1] && torn) last[2] = 1;
    } else out.push([a, b, torn]);
  }
  return out.map(([a, b, torn]) => (torn ? [a, b, 1] : [a, b]));
}
const alone = (h) => timelineLayout([h], 1440, "clock", NOW);

test("timeline order fixtures: the folder the sessions are written to is gone once they are read, and when making them fails", () => {
  expect(seen.length).toBe(1);
  expect(existsSync(seen[0])).toBe(false);
  let dir = null;
  expect(() => fixtures((d) => { dir = d; throw new Error("no session"); })).toThrow("no session");
  expect(dir).toBeTruthy();
  expect(existsSync(dir)).toBe(false);
});

test("timeline order (make-fixture.js --order): a note listed after a later one but stamped earlier is its own bar, with the gap before the later one empty", () => {
  const h = byPrompt(short, "Why does the retry path warn on an empty queue?");
  const notes = Array.from({ length: tlLen(h) }, (_, i) => tlStep(h, i)).filter((st) => st.lk === "text");
  expect(notes.map((st) => st.a)).toEqual([30000, 10000]);
  const L = alone(h);
  const raw = rawBars(L, h, 0);
  const model = raw.get("model|model|0");
  expect(outOfOrder(model)).toBe(true);
  for (const [k, bars] of raw) expect(L.spans.get(k)).toEqual(union(bars));
  // The 10 s note's bar ends before the 30 s note's starts: two spans, nothing drawn between.
  const [late, early] = model;
  expect(early[1] + 0.5).toBeLessThan(late[0]);
  const mid = (early[1] + late[0]) / 2;
  expect(L.spans.get("model|model|0").some(([a, b]) => a <= mid && mid <= b)).toBe(false);
  expect(timelineHit(L, [h], mid, "model", NOW)).toEqual({ turn: h.key, key: h.key });
});

test("timeline order (make-fixture.js --order): an unfinished call in its turn's last quarter second starts left of the finished call before it, and the two are one torn span", () => {
  const h = byPrompt(short, "Tail the deploy log");
  const L = alone(h);
  expect(L.turns[0]).toMatchObject({ x: 0, w: 1440 });
  const raw = rawBars(L, h, 0);
  const tools = raw.get("tools|tools|0");
  expect(outOfOrder(tools)).toBe(true);
  for (const [k, bars] of raw) expect(L.spans.get(k)).toEqual(union(bars));
  // The finished call at 59.8 s, 3 px from 1,435.2 px; the unfinished one at 59.9 s, drawn its
  // 6 px back from the turn's end, so from 1,434 px.
  expect(tools).toEqual([[1435.2, 1438.2, 0], [1434, 1440, 1]]);
  expect(L.spans.get("tools|tools|0")).toEqual([[1434, 1440, 1]]);
});

test("timeline order (make-fixture.js --only 100 --order): in a turn under 6 px wide the unfinished call's bar starts left of the turn and of the call before it, and the span holds both", () => {
  expect(many.heads.length).toBe(103);
  const ti = many.heads.length - 1;
  const h = many.heads[ti];
  expect(many.s.turns[ti].prompt).toBe("Run the smoke test");
  const L = timelineLayout(many.heads, 1440, "clock", NOW);
  const t = L.turns[ti];
  expect(t.w).toBeGreaterThanOrEqual(2);
  expect(t.w).toBeLessThan(6);
  const tools = rawBars(L, h, ti).get("tools|tools|0");
  expect(outOfOrder(tools)).toBe(true);
  const end = t.x + t.w;
  expect(tools[1]).toEqual([end - 6, end, 1]);
  expect(tools[1][0]).toBeLessThan(t.x);
  // The layout's span holds both bars, torn at the turn's end. (Here it also joins the turn
  // before: that turn's torn bar ends within half a pixel of this one's start.)
  const list = L.spans.get("tools|tools|0");
  const s = list.find((v) => v[0] <= end - 6 + 1e-9 && v[1] >= end - 1e-9);
  expect(s).toBeTruthy();
  expect(s[2]).toBe(1);
  expect(s[0]).toBeLessThanOrEqual(Math.min(tools[0][0], tools[1][0]));
  // The spans stay apart and in order.
  for (let i = 1; i < list.length; i++) expect(list[i][0]).toBeGreaterThan(list[i - 1][1] + 0.5);
  // Every key's spans are the union of every turn's bars, as in the two tests above, so a join
  // that also took in bars of the turn before that it does not reach would differ here. Every
  // turn is 2 px wide or more, so each is drawn as its own bars, not one span per lane.
  expect(L.turns.every((u) => u.w >= 2)).toBe(true);
  const all = new Map();
  L.turns.forEach((_, i) => {
    for (const [k, bars] of rawBars(L, many.heads[i], i)) all.set(k, [...(all.get(k) ?? []), ...bars]);
  });
  expect([...L.spans.keys()].sort()).toEqual([...all.keys()].sort());
  for (const [k, bars] of all) expect(L.spans.get(k)).toEqual(union(bars));
});

// The bars of the three turns worked out by hand from their times, not with itemBox, so a fault
// in the boxes shows here even where the layout and rawBars agree. A bar is its start's share
// of the turn's length times the turn's width; one with no end is 3 px wide, an unfinished
// call 6 px; neither starts later than that width before the turn's end.
const near = (list) => list.map((s) => s.map((v, i) => (i < 2 ? Math.round(v * 1e4) / 1e4 : v)));
test("timeline order by hand: the three turns' bars from their times, a note listed late, an unfinished call in the last 6 px and a turn under 6 px", () => {
  // 1. "Why does the retry path warn…", alone across 1,440 px: its last row (the reply) is at
  // 50 s, so 1,440 px is 50 s, 28.8 px a second. Model: the notes at 30 s (30 * 28.8 = 864) and
  // 10 s (10 * 28.8 = 288), 3 px each, and the reply at 50 s, which starts 3 px before the end
  // (1,437). Tools: the Read from 31 to 32 s (892.8 to 921.6), the Grep from 33 to 34 s (950.4
  // to 979.2).
  const L1 = alone(byPrompt(short, "Why does the retry path warn on an empty queue?"));
  expect(near(L1.spans.get("model|model|0"))).toEqual([[288, 291], [864, 867], [1437, 1440]]);
  expect(near(L1.spans.get("tools|tools|0"))).toEqual([[892.8, 921.6], [950.4, 979.2]]);
  // 2. "Tail the deploy log", alone: 60 s across 1,440 px, 24 px a second. The Read at 59.8 s
  // (59.8 * 24 = 1,435.2) to 59.85 s (1,436.4) is drawn its least 3 px, to 1,438.2. The
  // unfinished Bash at 59.9 s (1,437.6) starts its 6 px before the end, at 1,440 - 6 = 1,434,
  // so it is left of the Read and takes it in: one span, torn.
  const L2 = alone(byPrompt(short, "Tail the deploy log"));
  expect(near(L2.spans.get("tools|tools|0"))).toEqual([[1434, 1440, 1]]);
  expect(near(L2.spans.get("model|model|0"))).toEqual([[48, 51]]); // the note at 2 s: 2 * 24
  // 3. "Run the smoke test", the last of 103 turns across 1,440 px, held at the least width:
  // 0.3 * 1,440 / 103 = 4.1942 px, from 1,440 - 4.1942 = 1,435.8058 (the strip ends with it).
  // Its length is 2 s, to its last row. The Read from 1 s to 1.5 s would start halfway in
  // (1,437.9029), but no later than 3 px before the end: 1,437. The unfinished Bash at 2 s
  // starts 6 px before the end: 1,434, left of the turn. The break before it is 0.15 * 1,440 /
  // 102 = 2.1176 px, so the turn before ends at 1,435.8058 - 2.1176 = 1,433.6882, and its own
  // torn bar there is within half a pixel of 1,434: the two turns' torn bars are one span to
  // 1,440.
  const L3 = timelineLayout(many.heads, 1440, "clock", NOW);
  const t3 = L3.turns[102];
  expect([Math.round(t3.x * 1e4) / 1e4, Math.round(t3.w * 1e4) / 1e4, Math.round(L3.geo.gap * 1e4) / 1e4]).toEqual([1435.8058, 4.1942, 2.1176]);
  const bars3 = rawBars(L3, many.heads[102], 102).get("tools|tools|0");
  expect(near(bars3)).toEqual([[1437, 1440, 0], [1434, 1440, 1]]);
  // The turn before: 60 s at 26.6801 px from 1,407.0081 (its place, from the layout). Its
  // unfinished call at 59.9 s starts 6 px before its end: 1,433.6882 - 6 = 1,427.6882.
  const t2 = L3.turns[101];
  expect(Math.round((t2.x + t2.w) * 1e4) / 1e4).toBe(1433.6882);
  const last = near(L3.spans.get("tools|tools|0")).at(-1);
  expect(last).toEqual([1427.6882, 1440, 1]);
});

// tlJoin against the union, whatever order the bars come in: a few hundred made-up lists of
// bars on grids of 1, 0.5, 0.25 and 0.1 px (so exact half-pixel touches and equal ends come up),
// a third of them torn, each put in in five orders. After every add the list is in order, apart
// by more than half a pixel, and the union of the bars put in so far. Seeded: a failure names its
// seed, the order and the step.
function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
test("timeline span join (tlJoin) by property: in any order, after every add, its spans are in order, apart and the union of the bars put in", () => {
  let checked = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed);
    const g = [1, 0.5, 0.25, 0.1][Math.floor(r() * 4)];
    const n = 2 + Math.floor(r() * 13);
    const bars = Array.from({ length: n }, () => {
      const a = Math.floor(r() * 40) * g;
      return [a, a + Math.floor(r() * 9) * g, r() < 0.33 ? 1 : 0];
    });
    const shuffled = () => { const o = [...bars]; for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; };
    const orders = { listed: bars, reversed: [...bars].reverse(), rightToLeft: [...bars].sort((p, q) => q[0] - p[0]), shuffled1: shuffled(), shuffled2: shuffled() };
    for (const [order, list] of Object.entries(orders)) {
      const out = [];
      for (let step = 0; step < list.length; step++) {
        const [a, b, torn] = list[step];
        tlJoin(out, a, b, torn === 1);
        const apart = out.every((s, i) => i === 0 || s[0] > out[i - 1][1] + 0.5);
        const want = union(list.slice(0, step + 1));
        if (!apart || JSON.stringify(out) !== JSON.stringify(want)) {
          expect({ seed, order, step, bars: list.slice(0, step + 1), spans: out }).toEqual({ seed, order, step, bars: list.slice(0, step + 1), spans: want });
        }
        checked++;
      }
    }
  }
  expect(checked).toBeGreaterThan(5000);
});
