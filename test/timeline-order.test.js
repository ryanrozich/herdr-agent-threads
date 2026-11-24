// bun test: the timeline's spans on a made-up session whose bars come out of the clock's order
// (make-fixture.js --order), read by the pane's own reader: the three ways it happens, each
// drawn as the union of its bars, with the gaps between them left empty.
// 1. A line listed after a later one but stamped earlier: two notes at 30 s and then 10 s.
// 2. An unfinished call that starts in its turn's last quarter second: it is drawn 6 px wide,
//    so it starts left of the finished call listed before it.
// 3. The same in a turn under 6 px wide (the --order turns after 100 short ones, across
//    1,440 px): the unfinished call's bar starts left of the turn itself.
import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply, parseChunk, nextChunk } from "../mods/agent-threads/core/turns.js";
import { ledgerTurn } from "../mods/agent-threads/ledger.js";
import { timelineLayout, timelineHit, itemBox, tlLen, tlStep, tlTracks } from "../mods/agent-threads/timeline.js";

const root = join(import.meta.dir, "..");
const extractor = join(root, "mods/agent-threads/core/extract.sh");
const dir = mkdtempSync(join(tmpdir(), "threads-tlorder-"));
const NOW = Date.parse("2027-01-01T00:00:00Z");

function session(name, ...flags) {
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
const short = session("order", "--only", "0", "--order");
const many = session("order-many", "--only", "100", "--order");
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
});
