// bun test: opening a long reply. These tests were in render.test.js, moved here to keep it under
// Biome's size limit. The pane draws on a clock that moves only by priced work, and Herdr's stop
// of a long draw is modelled (costedFrames), on the render tests' harness (render-harness.js).
import { test, expect } from "bun:test";
import { segments } from "../mods/agent-threads/core/turns.js";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { draw, dropTimers, fixture, frame, pane, root, settle, settleRows, setup } from "./render-harness.js";

setup();

// Opening a long reply on a clock that moves only by priced work (performance.now, which the
// draw's budgets read), at prices from the rig (Herdr 0.1.17, made-up sessions):
// - unit, the split (mdSplitOn) by the work a read does, what it scans and what it makes
//   (job.work; a split with no count is priced at SPLIT_PER_CHAR units for each character it
//   scans or makes, which gives the same price for short paragraphs). The rig timed the split
//   at fcae757c, 128 lines a read, on 120 KB and 200 KB of short paragraphs: 0.144 to 0.176 ms a
//   KB in the open draw (cold), 0.09 to 0.12 ms in later draws, and a draw's first read no
//   dearer than its others. Short paragraphs are 3,524 units a KB, so the cold rate is about
//   0.00005 ms a unit, the price here; the tests that bound a draw run at it and at twice it.
// - line, the link rules, a non-blank line: 26 parts of short paragraphs took 34 ms on main
//   (0.024 ms a line), 9 parts 21 ms; the first price, 0.033, from the stopped draws before.
// - row, each row sized (height()): the 2,080-part card on d380ffa was stopped with 456 to 490
//   mdHeight calls made, about 950 rows into its sizes, with about 8 ms of the draw left for
//   them after its split and the rest of the draw.
// - call and char, a wrapped text worked out for a height; rest, the rest of a draw: mixed
//   Markdown of 16 to 96 KB drew in 20 to 38.5 ms on main.
// - segLine and segChar, the passes over the whole reply in an open turn's build: the rig's
//   open of 120 KB of short paragraphs at fcae757c (1,900 lines, 35 parts, 46.9 ms) spent
//   18.2 ms in the reply's links (linkedSegs, linkSeg here) and 8.6 ms in the rest of the
//   build (segmentsOf here, its whole-text pass), which the harness had left out.
// On the rig 26 parts of short paragraphs never drew: 67 of 73 stopped draws died in the link
// pass. Past stop ms Herdr stops a draw (costedFrames). The tests that bound a draw run at these
// prices and at twice them (PRICE_SCALES): at twice, the bounds on frames double and a draw
// after the first need only stay under the stop, as the fixed part of a draw doubles too.
const P121 = { line: 0.033, unit: 0.00005, row: 0.009, call: 0.004, char: 0.0001, rest: 8, stop: 50, segLine: 0.0096, segChar: 0.00007 };
const SPLIT_PER_CHAR = 1.72;
const PRICE_SCALES = [1, 2];
const shortParas = (n) => Array.from({ length: n }, (_, i) => `Paragraph ${i + 1}: the cart total rounds per line, see ACME-${i + 1}.`).join("\n\n");
const mixedReply = (kb) => { const one = readFileSync(join(root, "test/fixtures/long-reply.md"), "utf8").trim(); const out = []; for (let i = 1; out.join("\n\n").length < kb * 1024; i++) out.push(one, `Copy ${i} is filed as ACME-${i}.`); return out.join("\n\n"); };
// One reply, or several on the last turns, every one opened (unless shut).
async function openLong(text, shut = false) {
  const texts = [].concat(text);
  // The pane cuts its build and shaping into slices by the clock, as on Herdr ({ sliced: true }):
  // these tests time the pane's work, and a whole-slice test pane does it all in one draw.
  const { v, cx } = await pane(fixture("--extra", String(Math.max(2, texts.length))), { sliced: true });
  v.debug = false;
  const { parseLinks, LINK_TEMPLATES } = await import("../mods/agent-threads/settings.js");
  const l = parseLinks([LINK_TEMPLATES.ticket.rule]);
  v.setLinks(l.rules, l.list, 1);
  const turns = v.sessions.at(-1).turns.slice(-texts.length);
  turns.forEach((t, j) => { t.after = [texts[j]]; t.shapeKey = null; });
  v.rowsKey = null;
  settleRows(v, cx);
  dropTimers(v, cx);
  const keys = turns.map((t) => `${v.sessions.length - 1}:${t.n}`);
  if (!shut) for (const k of keys) v.toggle(k, cx);
  return { v, cx, key: keys.at(-1), keys };
}
// The open card's parts, settled: all of them shown (no mdrest row stands for any: the rest,
// mr:, or one part being laid out, md:), each one
// linked as the rules link it alone, and sized at the height worked out for its text, not the
// rough one from its length (a table has its own).
async function cardDone(v, key) {
  const { linkify } = await import("../mods/agent-threads/ui.js");
  const want = new Map();
  return () => [].concat(key).every((key) => {
    const i0 = v.baseRows.findIndex((r) => r.key.startsWith(`md:${key}:`));
    if (i0 < 0 || !v.rowsKey || v.rowJob || v.baseRows.some((r) => r.kind === "mdrest" && (r.key.startsWith(`mr:${key}:`) || r.key.startsWith(`md:${key}:`)))) return false;
    // Every Markdown part of the turn, those after a code block too.
    for (let i = i0; i < v.baseRows.length; i++) {
      const r = v.baseRows[i];
      if (r.kind !== "md" || !r.key.startsWith(`md:${key}:`)) continue;
      if (!want.has(r.src)) want.set(r.src, linkify(r.src, v.links, v.linkCtx()));
      const h = v.mdHeights?.map.get(r.src);
      if (r.md !== want.get(r.src).md || r.links !== want.get(r.src).links || (!r.table && (h == null || v.baseSizes[i] !== (r.gap ?? 6) + h))) return false;
    }
    return true;
  });
}
// The host as the rig shows it, on a clock that moves only by priced work (performance.now,
// which the draw's budgets read), by the 16 ms between frames, and by waits. A render happens
// only when one is asked for (cx.notify: the open's own, a timer's, or the pane's own 120 ms
// poke, which asks once a render has been open CUT_WATCH_MS). Past P121.stop ms Herdr stops a
// draw and keeps what it wrote: no catch runs, the next render finds renderOpen set, and the
// timers the stopped render asked for still run (7 of 7 on the rig, on main and on a branch of
// this work). stopAfter: the first renders that many are stopped after rows() as well, as by a
// long draw of the list. scale: every price but the stop that many times over. onFrame(ms):
// after each frame, with the time since the start. stopAt(where, what): true stops the draw
// there, before the work: "expanded" (an open turn's build, its item), "split" (a read of a
// reply's split, its job), "link" (a part's links, its text) or "height" (a row sized, the row).
function costedFrames(v, cx, n, done, { secs = 40, stopAfter = 0, scale = 1, onFrame = null, stopAt = null } = {}) {
  const P = P121;
  const real = performance.now, timer = cx.timer, notify = cx.notify;
  const STOP = new Error("stopped at the draw's time");
  let t = 1e7, at = null, stopped = false, linked = 0, splits = 0, readMost = 0;
  const t0 = t;
  const spend = (ms) => { t += ms * scale; if (at != null && t - at > P.stop) { stopped = true; throw STOP; } };
  const hook = (where, what) => { if (at != null && stopAt?.(where, what)) { stopped = true; throw STOP; } };
  const lo = v.linkOne, wr = v.wrapped, ex = v.expanded;
  v.expanded = function (item, out) { hook("expanded", item); return ex.call(this, item, out); };
  v.linkOne = function (md) { hook("link", md); if (this.links.length) { linked++; spend(md.split("\n").filter((x) => x.trim()).length * P.line); } return lo.call(this, md); };
  v.wrapped = function (s, ...a) { spend(P.call + s.length * P.char); return wr.call(this, s, ...a); };
  const ls = v.linkSeg, so = v.segmentsOf, sg = v.segsSome;
  v.linkSeg = function (md, ...a) { spend(md.split("\n").filter((x) => x.trim()).length * P.segLine); return ls.call(this, md, ...a); };
  // With no fence the split is two native scans (segments), not priced.
  v.segmentsOf = function (text) { spend((/```|~~~/.test(text) ? text.length : 0) * P.segChar); return so.call(this, text); };
  // A read of the segments job by the characters it went over; one Herdr stopped is lost.
  v.segsSome = function (job) {
    const was = { ...job, out: job.out.slice() };
    sg.call(this, job);
    try { spend((job.at - was.at) * P.segChar); } catch (e) { Object.assign(job, was); throw e; }
  };
  // A read of the split is priced by the work it did, what it scanned and what it made; one
  // Herdr stopped is lost, as its state is written back only at its end (mdSplitOn).
  const ss = v.splitSome, hi = v.height;
  // Where a read has got to in the text: a line being measured counts as far as it is.
  const pos = (job) => Math.min(job.at, job.text.length + 1) - (job.line != null ? job.line.length + 1 - job.lineScan : 0);
  v.splitSome = function (job) {
    hook("split", job);
    const was = { ...job, cur: job.cur.slice(), chunk: job.chunk.slice() };
    const n0 = job.n, p0 = pos(job), w0 = job.work;
    if (!job.at) splits++;
    ss.call(this, job);
    const made = job.parts.slice(n0).reduce((k, x) => k + (x.text ?? x).length, 0);
    const units = w0 != null ? job.work - w0 : SPLIT_PER_CHAR * (pos(job) - p0 + made);
    readMost = Math.max(readMost, units * P.unit * scale);
    try { spend(units * P.unit); } catch (e) { Object.assign(job, was); throw e; }
  };
  v.height = function (r) { hook("height", r); spend(P.row); return hi.call(this, r); };
  performance.now = () => { if (stopped) throw STOP; return t; };
  // The wall clock moves with it, from where it is now: the pane's waits on Date.now (a scroll's
  // 2 s, a return's 400 ms) run on the priced time too.
  const realDate = Date.now, d0 = realDate();
  Date.now = () => d0 + (t - t0);
  let timers = cx.timers.map((x) => ({ due: t + x.ms, fn: x.fn }));
  let armed = [];
  cx.timer = { after: (ms, fn) => { armed.push({ due: t + ms, fn }); }, every: timer.every };
  let asked = true;
  cx.notify = () => { asked = true; };
  const watch = cx.everies.filter((x) => x.ms === 120);
  let watchAt = t + 120;
  let last = -Infinity;
  const frames = [];
  let settled = -1, settledMs = -1;
  try {
    while (frames.length < n && t - t0 < secs * 1000) {
      if (asked && t >= last + 16) {
        asked = false;
        last = at = t;
        armed = [];
        try { spend(P.rest); v.render(cx); } catch (e) { if (e !== STOP) throw e; }
        if (frames.length < stopAfter) stopped = true;
        if (stopped) v.renderOpen = true;
        timers.push(...armed);
        armed = [];
        frames.push({ ok: !stopped, ms: Math.round((t - at) * 10) / 10 });
        onFrame?.(t - t0);
        at = null;
        stopped = false;
        if (settled < 0 && frames.at(-1).ok && done()) { settled = frames.length; settledMs = Math.round(t - t0); }
        if (settled > 0 && !asked && !timers.length) break;
        continue;
      }
      t = Math.max(t, Math.min(asked ? last + 16 : Infinity, watchAt, ...timers.map((x) => x.due)));
      const due = timers.filter((x) => x.due <= t).sort((x, y) => x.due - y.due);
      timers = timers.filter((x) => x.due > t);
      for (const x of due) x.fn(cx);
      for (; watchAt <= t; watchAt += 120) for (const w of watch) w.fn(cx);
      timers.push(...armed);
      armed = [];
    }
  } finally {
    performance.now = real;
    Date.now = realDate;
    cx.timer = timer;
    cx.notify = notify;
    cx.timers = timers.map((x) => ({ ms: Math.max(0, x.due - t), fn: x.fn }));
    delete v.linkOne; delete v.wrapped; delete v.splitSome; delete v.height; delete v.expanded; delete v.linkSeg; delete v.segmentsOf; delete v.segsSome;
  }
  const ok = frames.filter((x) => x.ok);
  return { stops: frames.length - ok.length, first: frames.findIndex((x) => x.ok) + 1, open: frames[0]?.ms ?? 0, settled, settledMs, linked, splits, readMost: Math.round(readMost * 100) / 100, most: Math.max(0, ...ok.map((x) => x.ms)), later: Math.max(0, ...ok.slice(1).map((x) => x.ms)), frames };
}

const costLog = (what, r) => { if (process.env.THREADS_COST_LOG) console.log(`${what}: ${JSON.stringify({ ...r, frames: r.frames.slice(0, 14).map((x) => (x.ok ? x.ms : `stop ${x.ms}`)) })}`); };

test("opening a reply of 26, 35 or 58 parts of short paragraphs draws at once and no draw runs past Herdr's time; no part is linked twice", async () => {
  for (const scale of PRICE_SCALES) for (const [n, parts] of [[1400, 26], [1900, 35], [4000, 58]]) {
    const { v, cx, key } = await openLong(shortParas(n));
    const r = costedFrames(v, cx, 40 * scale, await cardDone(v, key), { scale });
    costLog(`${parts} parts, at ${scale}x`, r);
    expect([scale, r.stops, r.first]).toEqual([scale, 0, 1]);
    expect(r.most).toBeLessThan(P121.stop);
    // Work left for the next draw goes on from there: the reply split once, each part linked
    // once, and the frames after the first within the draw's aim (FRAME_AIM_MS, 30 ms).
    expect([v.baseRows.filter((x) => x.key.startsWith(`md:${key}:`)).length, r.linked, r.splits]).toEqual([parts, parts, 1]);
    if (scale === 1) expect(r.later).toBeLessThanOrEqual(30);
  }
}, 60000);

test("an open reply of 18 or 58 parts, or one with a code fence between long prose runs, has every part linked and at its worked-out height within 18 frames", async () => {
  for (const scale of PRICE_SCALES) for (const [text, parts, splits] of [[shortParas(980), 18, 1], [shortParas(4000), 58, 1], [fencedReply(), 54, 2]]) {
    const { v, cx, key } = await openLong(text);
    const r = costedFrames(v, cx, 40 * scale, await cardDone(v, key), { scale });
    costLog(`${parts} parts, heights, at ${scale}x`, r);
    expect([scale, v.baseRows.filter((x) => x.key.startsWith(`md:${key}:`)).length, r.splits]).toEqual([scale, parts, splits]);
    expect(r.settled).toBeGreaterThan(0);
    // 18: at the rig's prices a capped reply's split takes about 34 ms and its links about
    // 132 ms, in draws of 12 ms of reshaping: 58 parts settle at frame 14 (25 at twice).
    expect(r.settled).toBeLessThanOrEqual(18 * scale);
    // After the first, a draw of short paragraphs is the rest of a draw and its reshaping time
    // (SHAPE_MS), which the split, the links and the parts' rows share, and one part past it.
    if (splits === 1) expect(r.later).toBeLessThanOrEqual(scale * (P121.rest + 3) + 12);
    // New rules link every part again, the same way, with the split and the heights kept:
    // till a part is linked again it shows as it was, at its height, and nothing moves.
    const { parseLinks } = await import("../mods/agent-threads/settings.js");
    const l = parseLinks([{ name: "Ticket", pattern: "\\bACME-(\\d+)\\b", url: "https://tickets.example.com/$1" }]);
    const sizes = v.baseSizes.slice();
    v.setLinks(l.rules, l.list, 1);
    const done = await cardDone(v, key);
    let moved = 0;
    const again = costedFrames(v, cx, 40 * scale, () => { if (v.baseSizes.length !== sizes.length || v.baseSizes.some((h, i) => h !== sizes[i])) moved++; return done(); }, { scale });
    costLog(`${parts} parts, new rules, at ${scale}x`, again);
    expect([again.stops, again.linked, again.splits, again.settled > 0 && again.settled <= 12 * scale, moved]).toEqual([0, parts, 0, true, 0]);
    expect(v.baseRows.find((x) => x.key.startsWith(`md:${key}:`)).md).toContain("tickets.example.com/1)");
  }
}, 60000);

// cardDone reads every Markdown part of the turn, those after a code block too: a part there
// that still shows its old links is not settled.
test("an open reply's parts after a code block are checked too: one that still shows its old links is not settled", async () => {
  const { v, cx, key } = await openLong(fencedReply());
  const done = await cardDone(v, key);
  costedFrames(v, cx, 80, done);
  const parts = v.baseRows.filter((r) => r.key.startsWith(`md:${key}:`) && r.kind === "md");
  const code = v.baseRows.findIndex((r) => r.kind === "codehead" && r.key.includes(`:${key}:`));
  const last = v.baseRows.findLastIndex((r) => r.kind === "md" && r.key.startsWith(`md:${key}:`));
  const was = v.baseRows[last];
  v.baseRows[last] = { ...was, md: was.src };
  const stale = done();
  v.baseRows[last] = was;
  expect([parts.length, code > 0 && last > code, was.md !== was.src, done(), stale]).toEqual([54, true, true, true, false]);
}, 60000);

// Replies whose lines are long, or whose blocks run past MD_MAX with no blank line: a read of
// the split is bounded by its work as well as its lines, and a block over the limit is split
// over several reads like the rest, so no draw is stopped at the rig's cold price or at twice
// it, and the card settles to the parts one whole split makes.
// Each under the 200,000-character cap, so the card shows it whole.
const longLines = () => `${"word ".repeat(19990)}\n\n${"next ".repeat(19990)}`;
const longParas = () => Array.from({ length: 130 }, (_, i) => `Para ${i} ${"lorem ipsum dolor sit amet ".repeat(56).slice(0, 1500)}`).join("\n\n");
const noBlank = () => Array.from({ length: 2100 }, (_, i) => `Line ${i + 1} of a reply with no blank line, as some agents write it, ACME-${i + 1}.`).join("\n");
test("replies of long lines, long paragraphs or no blank line draw in time at the rig's cold price and at twice it, and settle to one whole split", async () => {
  const got = [];
  for (const [name, text] of [["two 100 KB lines", longLines()], ["130 paragraphs of 1.5 KB", longParas()], ["2,100 lines with no blank line", noBlank()]]) {
    const want = await splitOf(text);
    for (const scale of [1, 2]) {
      const { v, cx, key } = await openLong(text);
      const r = costedFrames(v, cx, 400, await cardDone(v, key), { scale });
      costLog(`${name}, at ${scale}x`, r);
      const same = JSON.stringify(v.baseRows.filter((x) => x.key.startsWith(`md:${key}:`)).map((x) => x.src)) === JSON.stringify(want);
      // No read of the split dearer than about a millisecond at the cold price.
      got.push([name, scale, r.stops, r.first, r.settled > 0, same, r.readMost <= 1.2 * scale]);
    }
  }
  expect(got).toEqual(got.map(([name, scale]) => [name, scale, 0, 1, true, true, true]));
}, 120000);

// In the light window after a stopped draw, a draw that builds the open turns gives a reply's
// split SHAPE_MIN_MS: a capped reply opened with its first draw stopped goes on splitting in the
// light draw after it, still well inside a draw's time. (The light draws after that one build
// nothing until the window's end asks.)
const splitCount = (v) => { let n = 0; for (const m of v.partTurns?.values() ?? []) for (const job of m.split.values()) n += job.n; return n; };
const partsShown = (v, key) => v.baseRows.filter((x) => x.kind === "md" && x.key.startsWith(`md:${key}:`)).length;
test("an open reply's split goes on in the light window after a stopped draw, in the light draw's time", async () => {
  const { v, cx, keys } = await openLong(shortParas(4000));
  v.probeDue = function () { this.probeLeft = 0; return []; };
  // The parts split by the end of each frame, and whether it was light.
  const seen = [];
  const r = costedFrames(v, cx, 400, await cardDone(v, keys), { stopAfter: 1, onFrame: () => seen.push([v.light, splitCount(v)]) });
  costLog("capped, the split in light frames", { ...r, seen: seen.slice(0, 4) });
  const i = seen.findIndex(([light]) => light);
  expect([r.frames[0].ok, i, seen[1][1] > seen[0][1], r.frames[1].ok && r.frames[1].ms < 25, r.settled > 0]).toEqual([false, 1, true, true, true]);
}, 60000);

// The light draw's new rows (partRow) have SHAPE_MIN_MS, and the split SHAPE_MIN_MS of its own:
// in one shared 2 ms the split left no time for a row, and the card showed none of the parts it
// had through the whole light window.
test("the light draw after a stopped open shows the parts already split, not only the split's count", async () => {
  const { v, cx, keys } = await openLong(shortParas(4000));
  v.probeDue = function () { this.probeLeft = 0; return []; };
  const seen = [];
  const r = costedFrames(v, cx, 400, await cardDone(v, keys), { stopAfter: 1, onFrame: () => seen.push([v.light, splitCount(v), partsShown(v, keys)]) });
  costLog("capped, the parts shown in the light draw", { ...r, seen: seen.slice(0, 4) });
  expect([r.frames[0].ok, seen[1][0], seen[1][2] > 0, seen[1][1] > seen[0][1]]).toEqual([false, true, true, true]);
}, 60000);

// A run with no place to split it costs its height (wrapped) by its length: at twice the price
// one of 200,000 characters sized as Markdown ran past Herdr's time alone, so the light draw
// that sized it was stopped too, and from the fifth frame on every draw was (84 in 30 s). Past
// what one Markdown view holds it is plain text, its height counted from its length at no
// cost, so every light draw returns. Herdr's first draw is stopped here, so the light window
// comes whatever the full draws do.
test("with one 200,000-character word at twice the price every light draw returns: the word is plain text, never sized as Markdown", async () => {
  const { v, cx } = await openLong("z".repeat(200000));
  v.probeDue = function () { this.probeLeft = 0; return []; };
  const seen = [];
  const r = costedFrames(v, cx, 3000, () => false, { stopAfter: 1, scale: 2, secs: 30, onFrame: () => seen.push(v.light) });
  const lit = r.frames.filter((_, i) => seen[i]);
  costLog("one 200,000-character word, the light draws at 2x", { ...r, lit: lit.length });
  expect([r.frames[0].ok, lit.length > 0, lit.filter((f) => !f.ok).length, Math.max(...lit.map((f) => f.ms)) < 25, r.stops <= 7]).toEqual([false, true, 0, true, true]);
}, 60000);

// A part longer than 4,096 characters is a run with no space, line break or Japanese or Chinese
// sentence or clause mark (a word longer than MD_MAX), past what Herdr draws as one Markdown
// view, and at twice the price its height alone ran past Herdr's time in every full draw that
// sized it, for good. It shows whole as plain text under main's line for a part Herdr could not
// draw as Markdown, at a height counted from its length, with no link rules on it. c copies it.
test("a reply of one 200,000-character word shows whole as plain text under main's line, draws in time at the price and twice it, and c copies all of it", async () => {
  const word = "z".repeat(200000);
  for (const scale of PRICE_SCALES) {
    const { v, cx, key } = await openLong(word);
    v.probeDue = function () { this.probeLeft = 0; return []; };
    const part = () => v.baseRows.find((x) => x.key.startsWith(`md:${key}:`));
    const r = costedFrames(v, cx, 400, () => Boolean(v.rowsKey && !v.rowJob && part() && !v.baseRows.some((x) => x.kind === "mdrest" && x.key.includes(`:${key}:`))), { scale });
    costLog(`one 200,000-character word, at ${scale}x`, r);
    expect([scale, r.stops, r.settled > 0, part()?.kind, part()?.src?.length]).toEqual([scale, 0, true, "mdlong", 200000]);
    const text = frame(v, cx).filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
    expect([text.includes("Herdr could not draw this part as Markdown, so it shows as plain text."), text.includes(word), text.some((x) => x.includes("only its start is shown"))]).toEqual([true, true, false]);
    // c, on the selected turn.
    v.sel = key;
    cx.clip = null;
    expect([v.action("copy", cx), cx.clip === word]).toEqual([true, true]);
  }
}, 60000);

// A part with no place to split it that one Markdown view still holds (3,501 to 4,096
// characters) is sized in a light draw like any other part: its height costs about 0.8 ms at
// twice the price. Stopped by Herdr as it is sized, it shows in the light draw after the stop,
// not at the light window's end: kept out of light draws, a 3,800-character word showed
// "Laying out this part…" for 5,153 ms, where one of 3,400 showed at 137 ms.
test("a word of 3,800 or 4,096 characters, its sizing stopped by Herdr, is sized in a light draw and shown long before the light window ends", async () => {
  for (const n of [3800, 4096]) {
    const word = "y".repeat(n);
    const { v, cx, key } = await openLong(word);
    v.probeDue = function () { this.probeLeft = 0; return []; };
    const part = () => v.baseRows.find((x) => x.key.startsWith(`md:${key}:`));
    let once = false;
    const stopAt = (where, r) => where === "height" && r.key?.startsWith(`md:${key}:`) && !once && (once = true);
    const done = await cardDone(v, key);
    const lit = [];
    const r = costedFrames(v, cx, 400, () => part()?.kind === "md" && done(), { scale: 2, stopAt, onFrame: () => lit.push(v.light) });
    costLog(`one ${n}-character word, its sizing stopped, at 2x`, r);
    expect([n, once, r.stops, part()?.kind, part()?.md === word, r.settled > 0 && lit[r.settled - 1], r.settledMs < 1000]).toEqual([n, true, 1, "md", true, true, true]);
  }
}, 60000);

// Herdr's Markdown view holds 4,096 characters (MD_VIEW_CHARS). A run with no place to split it
// (a long URL, in practice) of up to that draws as on main, one Markdown view of the whole run,
// selectable; past it, it is plain text, all of it, under main's line (brokenPlain).
// Draws an open reply to its end as Herdr would: the timers a draw asks for run between draws
// (the next rebuild of an open turn is asked for by one), and no placeholder is left in the card
// when it is read.
function drawToEnd(v, cx, key, ready = () => true) {
  const waiting = () => !ready() || v.baseRows.some((x) => x.kind === "mdrest" && x.key.includes(`:${key}:`));
  for (let i = 0; i < 200 && (i < 2 || waiting()); i++) { draw(v, cx); cx.flush(0); }
  expect(waiting()).toBe(false);
}
async function oneRun(text) {
  const { v, cx, key } = await openLong(text);
  v.probeDue = function () { this.probeLeft = 0; return []; };
  drawToEnd(v, cx, key);
  const card = v.baseRows.filter((x) => x.key.startsWith(`md:${key}:`));
  return { v, cx, card, last: card.at(-1) };
}
// The helpers that draw an open reply to its end read it whole: a reply of 58 parts takes more
// than one build, and the next rebuild of an open turn is asked for by a timer.
test("the helpers that draw an open reply to its end run its timers: a reply of 58 parts is read whole, with no placeholder left", async () => {
  const { v, key, card } = await oneRun(shortParas(4000));
  expect([card.length, card.every((x) => x.kind === "md"), v.baseRows.some((x) => x.kind === "mdrest" && x.key.includes(`:${key}:`))]).toEqual([58, true, false]);
}, 60000);
test("a run with no break of 4,096 characters, a long URL, draws as one Markdown view of the whole run, and one of 4,097 as plain text", async () => {
  const url = (n) => `https://docs.example.com/spec/${"a1b2".repeat(n).slice(0, n - 30)}`;
  const seen = [];
  for (const n of [4096, 4097]) {
    const { v, cx, last } = await oneRun(url(n));
    // A Markdown part: its views; a plain-text one: how much of the run is drawn.
    const drawn = frame(v, cx).filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
    seen.push([url(n).length, last.kind, last.kind === "md" ? v.partViews(last).join("") === url(n) && v.partViews(last).length : Math.max(...drawn.filter((x) => url(n).startsWith(x)).map((x) => x.length))]);
  }
  expect(seen).toEqual([[4096, "md", 1], [4097, "mdlong", 4097]]);
}, 60000);

// Plain text needs no Markdown view, so a run with no place to split it past one view shows
// whole, under main's line for a part Herdr could not draw as Markdown. Nothing is cut, so no
// line says that only its start is shown.
test("a run with no break of 4,097, 20,000 or 200,000 characters shows whole as plain text under main's line, with no line saying only its start is shown", async () => {
  const run = (n) => `${Array.from({ length: Math.ceil(n / 6) + 1 }, (_, i) => `x${String(i * 6).padStart(5, "0")}`).join("").slice(0, n - 8)}ENDOFRUN`;
  const seen = [];
  for (const n of [4097, 20000, 200000]) {
    const text = run(n);
    const { v, cx, card, last } = await oneRun(text);
    const drawn = frame(v, cx).filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
    seen.push([text.length, card.length, last.kind, drawn.includes(text), drawn.includes("Herdr could not draw this part as Markdown, so it shows as plain text."), drawn.some((x) => x.includes("only its start is shown"))]);
  }
  expect(seen).toEqual([[4097, 1, "mdlong", true, true, false], [20000, 1, "mdlong", true, true, false], [200000, 1, "mdlong", true, true, false]]);
}, 60000);

// The link rules lengthen a part ("ACME-1" becomes a Markdown link 41 characters longer). A run
// with no break that fits one view as written, and would not with its links, draws as written:
// Markdown, whole and selectable, without the rules' links. One whose links fit has them.
test("a run with no break under 4,096 characters that its links would take past it draws as Markdown as written; one whose links fit has them", async () => {
  const run = (n) => `ACME-1/${"z".repeat(n - 7)}`;
  const seen = [];
  for (const n of [4000, 4060]) {
    const { last } = await oneRun(run(n));
    seen.push([n, last.kind, last.links ?? null, last.md === run(n), (last.md ?? "").length > 4096]);
  }
  expect(seen).toEqual([[4000, "md", 1, false, false], [4060, "md", 0, true, false]]);
}, 60000);

// A plain-text part is never cut. A run with no break of 4,000 characters fits one view as
// written, but its dollar escapes take it to 6,000, so it is plain text; one of 5,000 is past a
// view as it is. Both show whole, with no line saying only the start is shown.
test("a plain-text part, a 4,000-character run its dollar escapes take past one view or a 5,000-character run, shows whole with no line saying only its start is shown", async () => {
  const seen = [];
  for (const text of ["a$".repeat(2000), "z".repeat(5000)]) {
    const { v, cx, last } = await oneRun(text);
    const lines = frame(v, cx).filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
    seen.push([text.length, last.kind, lines.includes(text), lines.some((x) => x.includes("only its start is shown"))]);
  }
  expect(seen).toEqual([[4000, "mdlong", true, false], [5000, "mdlong", true, false]]);
}, 60000);

// Whether a part fits one view (partFits) is kept per open turn, by the part's text. A change of
// the reply's text makes a new record, so a reply that grows keeps the answers for its parts
// now; a change of the link rules or the repository drops the old answers too, so new rules do
// not add a key of the part's text, linked, at each change.
test("the open turn's record of which parts fit one view stays its parts' size through many changes of the text and of the link rules", async () => {
  const { parseLinks } = await import("../mods/agent-threads/settings.js");
  const base = "The cart total is $41.250 for ACME-1.";
  const { v, cx, key } = await openLong(base);
  v.probeDue = function () { this.probeLeft = 0; return []; };
  const settle = () => { v.rowsKey = null; for (let i = 0; i < 8; i++) draw(v, cx); return v.partTurns.get(key)?.fit?.size ?? 0; };
  const sizes = { grow: [], rules: [] };
  let text = base;
  for (let n = 1; n <= 12; n++) {
    text += ` Added $${n} for ACME-${n + 1}.`;
    v.findTurn(key).after = [text];
    sizes.grow.push(settle());
  }
  for (let n = 1; n <= 12; n++) {
    const l = parseLinks([{ name: "Ticket", pattern: "\\bACME-(\\d+)\\b", url: `https://t${n}.example.com/$1` }]);
    v.setLinks(l.rules, l.list, 1);
    sizes.rules.push(settle());
  }
  if (process.env.THREADS_COST_LOG) console.log(`fit record sizes: ${JSON.stringify(sizes)}`);
  const most = (xs) => Math.max(...xs);
  expect([most(sizes.grow) <= 2, most(sizes.rules) <= 2, sizes.rules.at(-1) > 0]).toEqual([true, true, true]);
}, 60000);

// A part of at most one view's 4,096 characters is never cut. Its dollar escapes ("$" drawn as
// "\\$") can take it past a view as Markdown, and then it shows whole as plain text under main's
// own line for a part Herdr could not draw as Markdown.
test("a part of 3,900 or 4,050 characters with dollar signs, past one view only by its escapes, shows whole as plain text under the line that Herdr could not draw it as Markdown", async () => {
  const seen = [];
  for (const text of [`${"a$".repeat(1800)}${"b".repeat(300)}`, `${"x".repeat(3900)}${"$".repeat(150)}`]) {
    const { v, cx, last } = await oneRun(text);
    const lines = frame(v, cx).filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
    seen.push([text.length, last.kind, lines.includes(text) ? text.length : null, lines.some((x) => x.startsWith("Herdr could not draw this part as Markdown")), lines.some((x) => x.includes("only its start is shown"))]);
  }
  expect(seen).toEqual([[3900, "mdlong", 3900, true, false], [4050, "mdlong", 4050, true, false]]);
}, 60000);

// Such a part's counted height (the mdlong row's, before the probe measures it) holds what is
// drawn: its gap, main's line at the line's 11.5 px (18 px a line, as wide as the reading
// line), 4 px, then all of the text. On a narrow pane main's line wraps to more than one line,
// and a height that left it out, or counted it as one line, gave the part a slot too short; a
// run of 20,000 characters is counted at all its length.
test("a part shown whole as plain text under main's line, of 3,900 or 20,000 characters, is counted at the height of what is drawn, main's line wrapped on a narrow pane", async () => {
  const seen = [];
  for (const [text, w] of [[`${"a$".repeat(1800)}${"b".repeat(300)}`, 640], [`${"a$".repeat(1800)}${"b".repeat(300)}`, 300], ["z".repeat(20000), 640]]) {
    const { v, cx, key } = await openLong(text);
    v.probeDue = function () { this.probeLeft = 0; return []; };
    v.forcedWidth = w;
    v.width = w;
    v.rowsKey = null;
    const row = () => v.baseRows.find((x) => x.key.startsWith(`md:${key}:`) && x.kind === "mdlong");
    drawToEnd(v, cx, key, () => Boolean(row()));
    const r = row();
    const drawn = frame(v, cx).filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
    const note = drawn.find((x) => x.startsWith("Herdr could not draw this part as Markdown"));
    // MD_CHAR in main.js (6.1 px, a character of 13 px prose) at the line's 11.5 px.
    const noteLines = v.wrapped(note, v.prose(), (v.charW(6.1) * 11.5) / 13);
    const held = (r.gap ?? 6) + 18 * noteLines + 4 + v.restHeight(text.length, 1);
    seen.push([text.length, w, drawn.includes(text), noteLines > 1, v.height(r) === held]);
  }
  expect(seen).toEqual([[3900, 640, true, false, true], [3900, 300, true, true, true], [20000, 640, true, false, true]]);
}, 60000);

// A paragraph of Japanese or Chinese prose that one view holds is one Markdown part, as main
// hands it to Herdr; one longer splits after its marks into parts a paragraph gap apart.
test("a paragraph of Japanese or Chinese prose of 1,200 or 4,096 characters is one Markdown part, as on main; one of 4,097 splits after its marks", async () => {
  const seen = [];
  for (const n of [1200, 4096, 4097]) {
    const para = cjkProse(["今日は配送ルートの確認を朝のうちに終えました。", "仓库的订单按线路分配给每一位司机，"], n).slice(0, n);
    const { card } = await oneRun(para);
    seen.push([n, card.length, card.every((x) => x.kind === "md"), card.map((x) => x.src).join("") === para]);
  }
  expect(seen).toEqual([[1200, 1, true, true], [4096, 1, true, true], [4097, 4, true, true]]);
}, 60000);

// In a full draw the rows of the parts split in the draws before are made first, then the split
// goes on: the other way round the split took the draw's whole reshaping time, and no part of a
// split that ran over several draws was shown until it had finished (at twice the price, none
// in the first five draws of a capped reply).
test("while an open reply's split runs over several draws, each draw shows the parts split in the draws before", async () => {
  for (const scale of PRICE_SCALES) {
    const { v, cx, keys } = await openLong(shortParas(4000));
    v.probeDue = function () { this.probeLeft = 0; return []; };
    const seen = [];
    const r = costedFrames(v, cx, 400, await cardDone(v, keys), { scale, onFrame: () => seen.push([v.light, splitCount(v), partsShown(v, keys)]) });
    costLog(`capped, parts shown while it splits, at ${scale}x`, { ...r, seen: seen.slice(0, 6) });
    const total = splitCount(v);
    expect([scale, r.stops, seen[1][0], seen[1][1] < total, seen[1][2] > 0, seen[2][2] > seen[1][2]]).toEqual([scale, 0, false, true, true, true]);
  }
}, 60000);

// Stopped inside the rebuild the shape timer asked for (againOpen), as it builds the card: the
// request stands, and the light draw after it builds the card again and splits on. With the
// request given up before the build, the shape timer asks again only at the window's end.
// Herdr can stop a draw after the rebuild of an open turn's rows (spliceRows) has dropped the
// card's old rows from the index and before it has put the new ones in. A rebuild that went on
// from there found the turn in no row, took it for one not shown, and gave up the request: the
// card never drew. The build after such a stop is of every row.
test("a draw Herdr stops halfway through putting an open card's new rows in leaves no card half built: the next build is of every row, and the card settles", async () => {
  const { v, cx, key } = await openLong(shortParas(4000));
  const MARK = { key: "stop-here", kind: "md" };
  let armed = true;
  // The splice that puts the new rows in, after the old ones' index entries are dropped.
  const arm = () => {
    const rows = v.baseRows;
    if (!rows || Object.hasOwn(rows, "splice")) return;
    rows.splice = function (...a) { if (a.length > 2 && armed) { armed = false; v.height(MARK); } return Array.prototype.splice.apply(this, a); };
  };
  arm();
  const r = costedFrames(v, cx, 80, await cardDone(v, key), { onFrame: arm, stopAt: (_w, x) => x === MARK });
  const parts = v.baseRows.filter((x) => x.key.startsWith(`md:${key}:`) && x.kind === "md").length;
  expect([armed, r.stops, r.settled > 0, parts, v.baseRows.every((x, i) => v.baseIndex.get(x.key) === i)]).toEqual([false, 1, true, 58, true]);
}, 60000);

// A turn that comes in while an open card waits on its placeholder (mdrest): the build after
// it keeps the rows before the last day band (keptFrom), the card's among them, so they are not
// built again. The open turns' work left is counted from what that build makes, and the kept
// placeholder was in none of it: no rebuild of the open turns was asked for, and the card never
// settled.
test("a turn that comes in while an open card waits on a placeholder leaves the card's rest still to come: the card settles", async () => {
  const seen = [];
  for (const append of [false, true]) {
    const { v, cx, keys } = await openLong([shortParas(4000), "Short reply."], true);
    const s = v.sessions.at(-1);
    const T = s.turns;
    // The last turn on a later day: a day band between it and the card, where a build can start.
    T.forEach((t, i) => { t.day = i < T.length - 1 ? "2026-11-01" : "2026-11-02"; });
    v.rowsKey = null;
    settleRows(v, cx);
    dropTimers(v, cx);
    v.toggle(keys[0], cx);
    costedFrames(v, cx, 1, () => true);
    const waited = v.baseRows.some((x) => x.kind === "mdrest" && x.key.includes(`:${keys[0]}:`));
    const kf = v.keptFrom;
    let kept = false;
    v.keptFrom = function (rest) { const out = kf.call(this, rest); kept ||= out != null; return out; };
    if (append) { T.push({ ...T.at(-1), n: T.length + 1, after: ["A new made-up reply."], shapeKey: null }); s.version = (s.version ?? 0) + 1; }
    const r = costedFrames(v, cx, 200, await cardDone(v, keys[0]), { secs: 20 });
    delete v.keptFrom;
    seen.push([append, waited, kept, r.settled > 0, v.baseRows.some((x) => x.kind === "mdrest" && x.key.includes(`:${keys[0]}:`))]);
  }
  expect(seen).toEqual([[false, true, false, true, false], [true, true, true, true, false]]);
}, 60000);

test("a draw stopped inside the rebuild it was asked for keeps the request, and the light draw after it builds the card", async () => {
  const { v, cx, keys } = await openLong(shortParas(4000));
  v.probeDue = function () { this.probeLeft = 0; return []; };
  const seen = [];
  let once = false;
  const stopAt = (where) => where === "expanded" && seen.length === 1 && !once && (once = true);
  const r = costedFrames(v, cx, 400, await cardDone(v, keys), { stopAt, onFrame: () => seen.push([v.light, splitCount(v)]) });
  costLog("stopped in the asked rebuild", { ...r, seen: seen.slice(0, 5) });
  expect([once, seen[1][0], seen[2][0], seen[2][1] > seen[0][1]]).toEqual([true, false, true, true]);
}, 60000);

// A part is shown only at its worked-out height: where there is no time to work it out (a
// light draw, or one out of time), the placeholder stands for it and the parts after it, so no
// part is drawn in a slot too short for it and cut off. 40 paragraphs of 1.4 KB and 300 short
// ones, with the first draw stopped: every frame's shown parts are at least their settled
// height. (On fcae757c 210 of 212 frames had a part short, by 5 to 25%: a rough height counts
// the text as one long line.)
const proseAndShort = () => `${Array.from({ length: 40 }, (_, i) => `Prose ${i + 1}: ${"the route table lists each depot and its orders for the day ".repeat(24).slice(0, 1400)}`).join("\n\n")}\n\n${shortParas(300)}`;
// The frames' card parts shown (md rows) and their slots, from the open (or, with change,
// from a change made to the settled card) until it settles: how many frames had a part in a
// slot shorter than its settled height, and how many showed a part standing in as "Laying out
// this part…".
async function shortSlots(text, opts, change) {
  const { v, cx, key } = await openLong(text);
  v.probeDue = function () { this.probeLeft = 0; return []; };
  const seen = [];
  let waiting = 0;
  const slots = () => {
    const m = new Map();
    v.baseRows.forEach((x, i) => { if (x.kind === "md" && x.key.startsWith(`md:${key}:`)) m.set(x.key, v.baseSizes[i]); });
    if (v.baseRows.some((x) => x.kind === "mdrest" && x.one)) waiting++;
    return m;
  };
  if (change) {
    costedFrames(v, cx, 400, await cardDone(v, key));
    change(v, cx);
  }
  const r = costedFrames(v, cx, 400, await cardDone(v, key), { ...opts, onFrame: () => seen.push(slots()) });
  const settled = slots();
  const short = seen.filter((m) => [...m].some(([k, h]) => h < settled.get(k))).length;
  return { v, cx, key, r, short, waiting, frames: seen.length, parts: settled.size };
}
test("no part of an open reply is drawn in a slot shorter than its worked-out height, in the light frames after a stopped draw or after", async () => {
  const text = proseAndShort();
  const { r, short, frames, parts } = await shortSlots(text, { stopAfter: 1 });
  costLog("prose and short paragraphs, slots", { ...r, short });
  expect([r.settled > 0, parts, frames > 1, short]).toEqual([true, (await splitOf(text)).length, true, 0]);
}, 60000);

// A narrower pane: every part of the settled card is taller there. A part not sized again yet
// stands in as "Laying out this part…" at a rough height (one dim line, nothing to cut), not as
// its Markdown in a slot worked out for the old width.
test("an open reply's parts on a narrower pane stand in as being laid out until each is sized, never drawn in a slot too short", async () => {
  // A capped reply: its 58 parts take more than one draw to size again.
  const text = shortParas(4000);
  const { r, short, waiting, parts } = await shortSlots(text, {}, (v) => { v.width -= 120; v.rowsKey = null; });
  costLog("58 parts, narrower", { ...r, short, waiting });
  expect([r.settled > 0, parts, waiting > 0, short]).toEqual([true, 58, true, 0]);
}, 60000);

// A Markdown height with no time to work it out counts each line of the text at least once and
// each blank line between paragraphs as a gap, not the whole text as one long line: for short
// paragraphs, lists and prose it comes within a tenth of the height worked out, and never over.
test("a rough Markdown height counts lines and paragraph gaps, within a tenth of the worked-out height", async () => {
  const { v } = await openLong(shortParas(10), true);
  const texts = [shortParas(120), Array.from({ length: 60 }, (_, i) => `- Step ${i + 1}: replay the queue`).join("\n"), proseAndShort().slice(0, 30000)];
  const got = texts.map((md) => {
    v.shapeBudget = -1;
    const rough = v.mdHeight(md);
    v.shapeBudget = null;
    v.shapeSpent = 0;
    const real = v.mdHeight(md);
    return [rough <= real, rough >= 0.9 * real];
  });
  expect(got).toEqual(texts.map(() => [true, true]));
}, 60000);

// The open's own scroll of the card (toggle: the card's last part to the near edge, then its
// head) from the open until every opened card settles and no timer is left (the scrolls a
// settled frame asks for 16 and 48 ms on among them), on a pane listH px tall: each scroll the
// list is asked for, with the time since the open and the row's key. onFrame(i, v): after
// frame i.
async function openScrolls(texts, { listH = 600, onFrame, ...opts } = {}) {
  const { v, cx, key, keys } = await openLong(texts);
  v.probeDue = function () { this.probeLeft = 0; return []; };
  v.listH = listH;
  const asks = [];
  let at0 = 0;
  v.scroll = { scroll_to_bottom() {}, scroll_to_item(i, how) { asks.push({ ms: Date.now() - at0, key: v.rowsMemo?.[i]?.key, how }); } };
  let f = 0;
  at0 = Date.now();
  const r = costedFrames(v, cx, 400, await cardDone(v, keys), { ...opts, onFrame: (ms) => { if (f === 0) at0 = Date.now() - ms; onFrame?.(f++, v, cx); } });
  return { v, cx, key, keys, r, asks };
}
// A reader who turns the wheel while the card comes in has taken the view: the open's scroll is
// dropped, and nothing the open asked for moves the list after the wheel. Waits on the list's row
// cap, which carries the rule that a wheel drops any pending scroll.
test.skip("a wheel while an opened card comes in drops the open's scroll of the card", async () => {
  let wheelAt = -1;
  const { v, r, asks } = await openScrolls(shortParas(4000), { onFrame: (i, v) => { if (i === 0) { v.listWheel({ delta: { y: 40 } }); wheelAt = Date.now(); } } });
  costLog("58 parts, a wheel at the first frame", { ...r, asks });
  expect([r.settled > 0, wheelAt > 0, asks.filter((a) => a.ms >= 0), v.scrollTo ?? null]).toEqual([true, true, [], null]);
}, 60000);
// A card taller than the pane lands with its head at the top at once: the rows above it are
// settled, and its own parts coming in below do not move its head. A reader who starts reading
// from there (a wheel down) is not moved again.
test("an opened card taller than the pane lands with its head at the top at once, and a reader reading on from it is not moved as its parts come in", async () => {
  const { key, r, asks } = await openScrolls(shortParas(4000), { onFrame: (i, v) => { if (i === 6) v.listWheel({ delta: { y: -30 } }); } });
  costLog("58 parts, head at once", { ...r, asks });
  // Asked within the first frames, well before the card settles (frame 14 at the rig's prices).
  expect([r.settled > 6, asks.length, asks.at(-1)?.key, asks.every((a) => a.ms < 100)]).toEqual([true, 2, key, true]);
}, 60000);
// A card that fits the pane lands as before: once it has settled, its last part to the near
// edge and then its head, so the whole card is on screen.
test("an opened card that fits the pane lands once it settles, wholly on screen", async () => {
  const { key, r, asks } = await openScrolls(shortParas(6), { listH: 3000 });
  costLog("a short card that fits", { ...r, asks });
  // Its last row (the strip under the reply), then its head.
  expect([r.settled > 0, asks.map((a) => a.key)]).toEqual([true, [`cp:${key}`, key]]);
}, 60000);
// The scroll's wait has a limit (SCROLL_WAIT_MS): a card that fits, below a capped card still
// held after a stopped draw, lands at the limit, though the pane asks for no frame then. Its
// scrolls land on its own rows, though the card above gains rows between the frame that asks
// and the scroll.
test("an opened card's scroll that waits lands at its 2 s limit in a quiet pane", async () => {
  const { key, r, asks } = await openScrolls([shortParas(4000), shortParas(6)], { listH: 3000, stopAfter: 1 });
  costLog("a short card under a held capped one", { ...r, asks });
  expect([asks.map((a) => a.key), asks[0]?.ms >= 2000 && asks[0]?.ms < 2400]).toEqual([[`cp:${key}`, key], true]);
}, 60000);

// An open reply's record (partTurns: its split, its parts' links and rows, about 0.5 to 1 MB a
// capped card) lives only while its card is open: closing the card drops it, and a session read
// again (restart) or another picked (pick) drops every one, as their rows hold the old turns.
test("an open reply's part record goes when its card closes, when the session is read again, and when another is picked", async () => {
  const records = (v) => v.partTurns?.size ?? 0;
  const got = [];
  for (const how of ["close", "restart", "pick"]) {
    const { v, cx, key } = await openLong(shortParas(300));
    costedFrames(v, cx, 400, await cardDone(v, key));
    const before = records(v);
    if (how === "close") v.toggle(key, cx);
    else if (how === "restart") v.restart(v.current());
    else v.pick({ path: v.current().file }, cx);
    got.push([how, before, records(v)]);
  }
  expect(got).toEqual([["close", 1, 0], ["restart", 1, 0], ["pick", 1, 0]]);
}, 60000);

// While a card's parts come in, the placeholder stands at a rough height for the text not shown
// yet, so the card is about as tall as it will be (the list's end and its bar are about right):
// at least a third of its settled height in every frame, not the parts shown and one line.
test("while an open card's parts come in, the card is at least a third of its settled height", async () => {
  const { v, cx, key } = await openLong(shortParas(4000));
  v.probeDue = function () { this.probeLeft = 0; return []; };
  const cardH = () => v.baseRows.reduce((h, x, i) => h + ((x.kind === "md" || x.kind === "mdrest") && (x.key.startsWith(`md:${key}:`) || x.key.startsWith(`mr:${key}:`)) ? v.baseSizes[i] : 0), 0);
  const seen = [];
  const r = costedFrames(v, cx, 400, await cardDone(v, key), { onFrame: () => seen.push(cardH()) });
  const settled = cardH();
  costLog("58 parts, the card's height", { ...r, ratio: seen.map((h) => Math.round((h / settled) * 100) / 100) });
  expect([r.settled > 2, Math.min(...seen) >= settled / 3]).toEqual([true, true]);
}, 60000);
// A part whose height came back rough (out of time inside its sizing) is not shown: the
// placeholder stands for it and the parts after it, and the next build sizes and shows it.
test("a part whose height comes back rough waits behind the placeholder and is shown once sized", async () => {
  const { v, cx, key } = await openLong(shortParas(300), true);
  const md = v.mdHeight;
  let rough = 0;
  // The third part's first sizing runs out of time.
  const parts = await splitOf(shortParas(300));
  v.mdHeight = function (text) { if (!rough && text === parts[2]) { rough++; this.shapeLeft = (this.shapeLeft ?? 0) + 1; return 18; } return md.call(this, text); };
  v.toggle(key, cx);
  v.rows();
  const shown = () => v.baseRows.filter((x) => x.kind === "md" && x.key.startsWith(`md:${key}:`)).map((x) => x.src);
  const first = [rough, shown().length, v.baseRows.some((x) => x.kind === "mdrest" && x.key.startsWith(`mr:${key}:`))];
  v.againOpen = true;
  v.rowsKey = "again";
  v.shapeSpent = 0;
  v.rows();
  expect([first, shown()]).toEqual([[1, 2, true], parts]);
}, 60000);
// The light draw after a stopped draw gives an open reply's new rows SHAPE_MIN_MS (2 ms) and
// its split 2 ms of its own, not the reshaping time of a full draw: it stays short.
test("the light draw after a stopped draw reshapes for SHAPE_MIN_MS, not a full draw's time", async () => {
  const { v, cx, keys } = await openLong(shortParas(4000));
  v.probeDue = function () { this.probeLeft = 0; return []; };
  const light = [];
  const r = costedFrames(v, cx, 400, await cardDone(v, keys), { stopAfter: 1, onFrame: () => light.push(v.light) });
  costLog("capped, the light draw's time", r);
  const ms = r.frames.filter((x, i) => light[i] && x.ok).map((x) => x.ms);
  // The rest of a draw, 2 ms each, and the row (2 ms) and the read (1 ms) that cross them.
  expect([ms.length > 0, ms.every((x) => x <= P121.rest + 2 + 2 + 2 + 1)]).toEqual([true, true]);
}, 60000);

// A light draw measures no part, so through the light window after a stopped draw the pane does
// not draw again and again to measure: only when something asks for work a light draw can do (the draw after the stop, the pane's poke, a scroll's limit) and at the
// window's end. With the measures on (no size comes back here), a capped card opened with its
// first draw stopped drew every 24 ms through the window: 210 draws in 5 s.
test("through the light window after a stopped draw the pane draws only a few times, not every frame", async () => {
  const { v, cx } = await openLong(shortParas(4000));
  const light = [];
  const r = costedFrames(v, cx, 3000, () => false, { stopAfter: 1, secs: 7, onFrame: (ms) => light.push([Math.round(ms), v.light]) });
  const inLight = light.filter(([, l]) => l).map(([ms]) => ms);
  costLog("capped, the light window's draws", { ...r, light: inLight });
  // And the window's end brings the next draw that does the work.
  expect([inLight.length <= 10, light.some(([ms, l]) => !l && ms >= 5000)]).toEqual([true, true]);
}, 60000);

// A stop after the probe's step left it one part to measure (probeLeft 1): a light draw measures
// none, and on main it set the probe's 16 ms timer again each time (on the rig, main drew 149
// times 33.3 ms apart through the window). With the open's scroll dropped, three light draws:
// the one after the stop, the one for the probe's timer the stopped draw had set, and the day
// pill's. The probe finishes in the first draw after the window.
test("a stop after the probe's step, with one part left to measure, brings three light draws, not one a frame", async () => {
  const { v, cx } = await openLong(shortParas(4000));
  v.scrollTo = null;
  let asks = 0;
  v.probeDue = function () { this.probeLeft = asks++ ? 0 : 1; return []; };
  const seen = [];
  const r = costedFrames(v, cx, 3000, () => false, { stopAfter: 1, secs: 7, onFrame: () => seen.push([v.light, v.probeLeft]) });
  const lit = seen.filter(([l]) => l);
  costLog("a stop after the probe, the light draws", { ...r, n: lit.length, seen: seen.slice(0, 8) });
  expect([lit.length <= 3, lit.every(([, p]) => p === 1), seen.at(-1)[1]]).toEqual([true, true, 0]);
}, 60000);

// Parts held through the light window after a stopped draw go on in the draw after it: a
// timer asks for the open turns to be built again (againOpen), for the work left in them
// (otherLeft). Herdr stops that draw inside the rebuild (stopAt, once, in the first draw after
// the window that has the request), and keeps the timers. The request must still stand, so
// every part links with no command.
async function heldThenStopped(texts, stopAt) {
  const { v, cx, keys } = await openLong(texts);
  // No size comes back to the probe here, as Herdr's would, so it would ask for a draw every
  // 16 ms for good: it asks for none.
  v.probeDue = function () { this.probeLeft = 0; return []; };
  let hit = 0;
  const at = (where, what) => {
    if (hit || v.light || v.rowsKey !== "again" || !stopAt(where, what, keys)) return false;
    hit++;
    return true;
  };
  const r = costedFrames(v, cx, 400, await cardDone(v, keys), { stopAfter: 1, stopAt: at });
  const linkedParts = keys.map((k) => v.baseRows.filter((x) => x.key.startsWith(`md:${k}:`) && x.links > 0).length);
  // Settled, no work is left in open turns: a count kept past its rebuild would have every
  // later timer build them again.
  expect([v.otherLeft ?? 0, v.againOpen ?? false]).toEqual([0, false]);
  return { r, hit, linkedParts };
}

test("held parts link after a draw stopped as it builds the open turn again", async () => {
  const { r, hit, linkedParts } = await heldThenStopped(shortParas(1900), (where, item, keys) => where === "expanded" && item.key === keys[0]);
  costLog("35 parts, stopped in its build", r);
  expect([hit, r.stops, r.settled > 0, linkedParts]).toEqual([1, 2, true, [35]]);
}, 60000);

test("held parts link after a draw stopped inside a capped reply's split", async () => {
  const { r, hit, linkedParts } = await heldThenStopped(shortParas(4000), (where) => where === "split");
  costLog("58 parts, stopped in its split", r);
  expect([hit, r.stops, r.settled > 0, linkedParts]).toEqual([1, 2, true, [58]]);
}, 60000);

test("held parts link after a draw stopped inside one open card's split while another card's is kept", async () => {
  // The newest turn is built first: a short reply whose split is kept, then the capped one.
  let splits = 0;
  const { r, hit, linkedParts } = await heldThenStopped([shortParas(4000), shortParas(150)], (where) => where === "split" && ++splits === 1);
  costLog("58 and 3 parts, stopped in the first's split", r);
  expect([hit, r.stops, r.settled > 0, linkedParts]).toEqual([1, 2, true, [58, 3]]);
}, 60000);

test("held parts link after a draw stopped as it links a part", async () => {
  const { r, hit, linkedParts } = await heldThenStopped(shortParas(980), (where) => where === "link");
  costLog("18 parts, stopped in its links", r);
  expect([hit, r.stops, r.settled > 0, linkedParts]).toEqual([1, 2, true, [18]]);
}, 60000);

test("held parts link after a draw stopped in another open turn's build", async () => {
  // The newest turn, a short reply with nothing left, is built first, and its build is stopped.
  const { r, hit, linkedParts } = await heldThenStopped([shortParas(1900), shortParas(150)], (where, item, keys) => where === "expanded" && item.key === keys[1]);
  costLog("35 and 3 parts, stopped in the other's build", r);
  expect([hit, r.stops, r.settled > 0, linkedParts]).toEqual([1, 2, true, [35, 3]]);
}, 60000);

// A frame's timer finds no work left in open turns and asks for closed rows to be reshaped
// (reshapeDue). Before the next render a card opens and its rows are built, with parts held.
// The reshape of closed rows leaves the open card's work left to its own builds.
test("an open card's held parts are not dropped by a reshape of closed rows asked for before it opened", async () => {
  const { v, cx, key } = await openLong(shortParas(1900), true);
  v.probeDue = function () { this.probeLeft = 0; return []; };
  // Closed rows left to reshape, none in open turns: the frame asks for the next.
  v.shapeLeft = 1;
  v.otherLeft = 0;
  v.render(cx);
  const tm = cx.timers.find((x) => x.ms === 0);
  expect(tm).toBeTruthy();
  cx.timers = cx.timers.filter((x) => x !== tm);
  tm.fn(cx);
  expect([v.reshapeDue, v.againOpen ?? false]).toEqual([true, false]);
  // The card opens, and an action builds its rows with no time to make any part.
  v.toggle(key, cx);
  v.shapeBudget = -1;
  v.rows();
  v.shapeBudget = null;
  expect(v.otherLeft).toBeGreaterThan(0);
  const r = costedFrames(v, cx, 400, await cardDone(v, key));
  costLog("35 parts, opened after a reshape was asked for", r);
  expect([r.stops, r.settled > 0]).toEqual([0, true]);
  expect(v.baseRows.filter((x) => x.key.startsWith(`md:${key}:`) && x.links > 0).length).toBe(35);
}, 60000);

// The outside read's run: two 100 KB lines, the open's first draw stopped, and the draw after
// the light window stopped in a read of the split as it builds the card again. The pane must
// not go quiet with the card on its placeholder.
test("held parts of a reply of two long lines link after a draw stopped in its split as it builds the card again", async () => {
  // Each word names a ticket, so every part has links (two lines of about 98 KB).
  const line = (w) => Array.from({ length: 7200 }, (_, i) => `${w} ACME-${i + 1}`).join(" ");
  const text = `${line("see")}\n\n${line("and")}`;
  const { r, hit, linkedParts } = await heldThenStopped(text, (where) => where === "split");
  costLog("two 100 KB lines, stopped in its split", r);
  const parts = (await splitOf(text)).length;
  expect([hit, r.stops, r.settled > 0, linkedParts]).toEqual([1, 2, true, [parts]]);
}, 60000);

test("two capped replies open: no frame passes Herdr's time while both settle, and each is split once", async () => {
  for (const scale of PRICE_SCALES) {
    const { v, cx, keys } = await openLong([0, 1].map((j) => shortParas(4000).replaceAll("Paragraph", `Card ${j}, paragraph`)), true);
    const runs = [];
    for (const k of keys) {
      v.toggle(k, cx);
      runs.push(costedFrames(v, cx, 30 * scale, await cardDone(v, keys.slice(0, runs.length + 1)), { scale }));
      costLog(`card ${runs.length} of 2, at ${scale}x`, runs.at(-1));
    }
    expect(runs.map((r) => [scale, r.stops, r.splits, r.settled > 0 && r.settled <= 18 * scale])).toEqual([[scale, 0, 1, true], [scale, 0, 1, true]]);
    expect(Math.max(...runs.map((r) => r.most))).toBeLessThan(P121.stop);
  }
}, 60000);

test("an open reply's links follow a change of the repository or its owner", async () => {
  const { v, cx, key } = await openLong(shortParas(980));
  const { parseLinks } = await import("../mods/agent-threads/settings.js");
  v.repoLooking = true;
  for (const [url, remotes, want] of [
    ["https://github.com/{repo}/issues/$1", [["acme/web", "acme"], ["acme/shop", "acme"]], ["acme/web/issues/1)", "acme/shop/issues/1)"]],
    ["https://github.com/{owner}/tracker/issues/$1", [["acme/web", "acme"], ["acme/web", "acme-labs"]], ["acme/tracker/issues/1)", "acme-labs/tracker/issues/1)"]],
  ]) {
    const l = parseLinks([{ name: "Issue", pattern: "\\bACME-(\\d+)\\b", url }]);
    v.setLinks(l.rules, l.list, 1);
    for (const [j, [repo, owner]] of remotes.entries()) {
      v.remote = { key: "fixed", repo, owner, host: "github.com" };
      const r = costedFrames(v, cx, 20, await cardDone(v, key));
      expect([r.stops, r.settled > 0]).toEqual([0, true]);
      expect(v.baseRows.find((x) => x.key.startsWith(`md:${key}:`)).md).toContain(want[j]);
    }
  }
}, 60000);

// A prose segment over MD_MAX takes none of the reply's 25 links (linkedSegs): it is shown in
// parts, each linked on its own (partLinks), and the pass over it whole was never drawn. On the
// main branch that pass still counted its links, so the segments after it lost theirs: here a
// 7 KB run of sentences with an id each, a code fence, then three ids, whose row had 0 links.
test("a prose segment over MD_MAX takes none of the reply's 25 links: the segment after it is linked", async () => {
  const run = Array.from({ length: 120 }, (_, i) => `Sentence ${i + 1} of the route notes names the depot order ACME-${i + 1}.`).join(" ");
  const { v, cx, key } = await openLong(`${run}\n\n\`\`\`\nroute check\n\`\`\`\n\nACME-901, ACME-902 and ACME-903 are next.`);
  v.probeDue = function () { this.probeLeft = 0; return []; };
  const r = costedFrames(v, cx, 400, await cardDone(v, key));
  const parts = v.baseRows.filter((x) => x.kind === "md" && x.key.startsWith(`md:${key}:0.`));
  const last = v.baseRows.find((x) => x.key === `md:${key}:2`);
  expect([run.length > 6800, r.settled > 0, parts.length > 1, parts.every((x) => x.links > 0), last?.links]).toEqual([true, true, true, true, 3]);
}, 60000);

test("an open reply whose text changes keeps the links of the parts it still has and links only the new one", async () => {
  const base = shortParas(980);
  const { v, cx, key } = await openLong(base);
  costedFrames(v, cx, 20, await cardDone(v, key));
  const md = () => v.baseRows.filter((x) => x.key.startsWith(`md:${key}:`));
  let text = base;
  // Two changes of the text, then new rules alone, then new rules with a change of the text.
  for (const [n, rules, grow] of [[1, null, true], [2, null, true], [3, "tickets", false], [4, "issues", true]]) {
    if (rules) {
      const { parseLinks } = await import("../mods/agent-threads/settings.js");
      const l = parseLinks([{ name: "Ticket", pattern: "\\bACME-(\\d+)\\b", url: `https://${rules}.example.com/$1` }]);
      v.setLinks(l.rules, l.list, 1);
    }
    const was = new Map(md().map((x) => [x.src, x.md]));
    if (grow) text += `\n\nAdded paragraph ${n}: see ACME-${n}.`;
    v.findTurn(key).after = [text];
    v.rowsKey = null;
    const done = await cardDone(v, key);
    let lost = 0;
    const r = costedFrames(v, cx, 20, () => { for (const x of md()) if (!rules && was.has(x.src) && x.md !== was.get(x.src)) lost++; return done(); });
    expect([r.stops, r.settled > 0, lost, r.linked]).toEqual([0, true, 0, rules ? md().length : 1]);
  }
}, 60000);

test("eight replies of 58 parts each opened one after another, 464 parts in all, draw in time and link and split each once", async () => {
  for (const scale of PRICE_SCALES) {
    const { v, cx, keys } = await openLong(Array.from({ length: 8 }, (_, j) => shortParas(4000).replaceAll("Paragraph", `Turn ${j}, paragraph`)), true);
    const all = { stops: 0, linked: 0, splits: 0, most: 0, settled: [] };
    for (const k of keys) {
      v.toggle(k, cx);
      const r = costedFrames(v, cx, 30 * scale, await cardDone(v, keys.slice(0, keys.indexOf(k) + 1)), { scale });
      for (const n of ["stops", "linked", "splits"]) all[n] += r[n];
      all.most = Math.max(all.most, r.most);
      all.settled.push(r.settled);
    }
    costLog(`8 x 58 parts, at ${scale}x`, { ...all, frames: [] });
    const parts = v.baseRows.filter((x) => x.kind === "md" && keys.some((k) => x.key.startsWith(`md:${k}:`))).length;
    expect(parts).toBeGreaterThan(400);
    expect([all.stops, all.linked, all.splits]).toEqual([0, parts, 8]);
    expect(all.most).toBeLessThan(P121.stop);
    expect([scale, all.settled.every((n) => n > 0 && n <= 18 * scale)]).toEqual([scale, true]);
    // Settled, a frame that builds the open turns again links nothing.
    v.againOpen = true;
    v.rowsKey = "again";
    expect(costedFrames(v, cx, 2, () => true).linked).toBe(0);
    // Kept: the open turns' parts of their replies as they are now. Closed turns go at the next
    // build of an open one.
    for (const k of keys.slice(1)) v.toggle(k, cx);
    costedFrames(v, cx, 1, () => true);
    v.againOpen = true;
    v.rowsKey = "again";
    costedFrames(v, cx, 1, () => true);
    expect([...v.partTurns.keys()]).toEqual([keys[0]]);
    const kept = v.partMemo(keys[0], v.replyText(v.findTurn(keys[0])));
    expect([kept.links.size, kept.split.size]).toEqual([parts / 8, 1]);
    const re = v.partMemo(keys[0], "Rewritten.");
    expect([re.links.size, re.split.size]).toEqual([0, 0]);
  }
}, 60000);

// The open card as rows (kind, key, text, links, height), and the same card made again by one
// build with nothing kept and no limit on its time. Each Markdown segment's parts are also
// worked out here straight from the split (mdChunks, splitTables), segment by segment.
function openCard(v, key) {
  const turn = v.findTurn(key);
  return v.baseRows.map((x, i) => (x.turn === turn ? [x.kind, x.key, x.md ?? null, x.src ?? null, x.links ?? null, v.baseSizes[i]] : null)).filter(Boolean);
}
function unboundedCard(v, key) {
  v.linkMemo = null;
  v.partTurns = null;
  v.partHs = null;
  v.mdHeights = null;
  v.shapeBudget = 1e9;
  v.rowsKey = null;
  v.rows();
  v.shapeBudget = null;
  return openCard(v, key);
}
async function splitOf(text) {
  const { mdChunks, splitTables } = await import("../mods/agent-threads/ui.js");
  return segments(text).filter((g) => g.kind === "md").flatMap((g) => mdChunks(g.text).flatMap((c) => splitTables(c)).map((p) => p.text));
}
// Two long runs of prose with a code fence between them: three segments, the last one split
// on its own.
const fencedReply = () => `${shortParas(1400)}\n\n\`\`\`js\nconst total = lines.reduce((a, b) => a + b, 0);\n\`\`\`\n\n${shortParas(1400).replaceAll("Paragraph", "Later paragraph")}`;
// 1,040 two-word paragraphs, each with a one-row table under it: 2,080 parts, about 76 KB.
const pairsReply = () => Array.from({ length: 1040 }, (_, i) => `Order ${i + 1}\n\n| Ticket | Total | Due |\n|---|---|---|\n| ACME-${i + 1} | ${i + 1} | Mo |`).join("\n\n");

test("an open mixed Markdown reply of 16 to 96 KB, or one with a code fence between long prose runs, settles to the card one unbounded build makes: the same rows, text, links and heights", async () => {
  for (const scale of PRICE_SCALES) {
    for (const [name, text, linked] of [["mixed 16 KB", mixedReply(16), 2], ["mixed 48 KB", mixedReply(48), 6], ["mixed 96 KB", mixedReply(96), 12], ["fenced", fencedReply(), 40]]) {
      const { v, cx, key } = await openLong(text);
      const r = costedFrames(v, cx, 60 * scale, await cardDone(v, key), { scale });
      costLog(`${name}, at ${scale}x`, r);
      expect([scale, r.stops, r.first, r.settled > 0]).toEqual([scale, 0, 1, true]);
      const settled = openCard(v, key);
      expect(settled.filter((x) => x[0] === "md" && x[4] > 0).length).toBeGreaterThan(linked);
      expect(settled.filter((x) => x[0] === "md").map((x) => x[3])).toEqual(await splitOf(text));
      expect(unboundedCard(v, key)).toEqual(settled);
      // With no rules there is nothing to link, and no part waits for a later frame for it.
      v.setLinks([], [], 0);
      v.rows();
      v.shapeBudget = -1;
      v.againOpen = true;
      v.rowsKey = "again";
      v.rows();
      expect([v.otherLeft, v.baseRows.find((x) => x.key.startsWith(`md:${key}:`)).links]).toEqual([0, 0]);
    }
  }
}, 60000);

// On the rig this reply never drew, on main or with the link pass bounded: 205 stopped draws,
// each cut while it built and sized the card's 2,086 rows.
test("an open reply of 2,080 parts, short paragraphs each with a one-row table, draws in time and settles to the card one unbounded build makes", async () => {
  for (const scale of PRICE_SCALES) {
    const text = pairsReply();
    expect(Math.round(text.length / 1024)).toBe(76);
    const { v, cx, key } = await openLong(text);
    const r = costedFrames(v, cx, 400, await cardDone(v, key), { scale });
    costLog(`2,080 parts, at ${scale}x`, r);
    expect([scale, r.stops, r.first, r.settled > 0]).toEqual([scale, 0, 1, true]);
    expect(r.most).toBeLessThan(P121.stop);
    // Within the draw's aim (FRAME_AIM_MS) after the first: a build sizes only the new parts.
    if (scale === 1) expect(r.later).toBeLessThanOrEqual(30);
    const settled = openCard(v, key);
    const md = settled.filter((x) => x[0] === "md");
    expect([md.length, md.filter((x) => x[1] && /\|/.test(x[3])).length]).toEqual([2080, 1040]);
    expect(md.map((x) => x[3])).toEqual(await splitOf(text));
    expect(unboundedCard(v, key)).toEqual(settled);
  }
}, 120000);

// The parts come in below the ones shown, so a reader in the reply stays where they are: a
// part shown keeps its place in the list (the list keeps its offset in px). A jump to the
// newest turn's end holds to the end while they come in, and asks for it again once all are in.
test("while an open capped reply's parts come in, the parts shown keep their place, and a jump to the end lands on the end of the whole reply", async () => {
  for (const scale of PRICE_SCALES) {
    const { v, cx, key } = await openLong(shortParas(4000));
    const ends = [];
    v.scroll = { scroll_to_bottom() { ends.push(v.baseRows.some((x) => x.kind === "mdrest")); }, scroll_to_item() {} };
    // Latest, while the open card's own scroll still waits for it to settle. The command builds
    // the rows off the priced clock, so with no reshaping time for it.
    expect(v.scrollTo?.key).toBe(key);
    v.shapeBudget = -1;
    v.action("latest", cx);
    v.shapeBudget = null;
    const tops = new Map();
    let moved = 0, came = 0;
    const done = await cardDone(v, key);
    const r = costedFrames(v, cx, 60 * scale, () => {
      let top = 0;
      v.baseRows.forEach((x, i) => {
        if (x.kind === "md" && x.key.startsWith(`md:${key}:`)) {
          if (!tops.has(x.key)) came++;
          else if (tops.get(x.key) !== top) moved++;
          tops.set(x.key, top);
        }
        top += v.baseSizes[i];
      });
      return done();
    }, { scale });
    costLog(`58 parts, place, at ${scale}x`, r);
    expect([scale, r.stops, r.settled > 1, came, moved]).toEqual([scale, 0, true, 58, 0]);
    cx.flush(16);
    expect([v.toBottom, ends.length > 1, ends.at(-1)]).toEqual([false, true, false]);
  }
}, 60000);

// An open reply's parts are kept on its turn's record with their rows, so drawing them puts
// nothing in the Markdown memo the closed rows share (mdMemo, the MD_MEMO texts used last). A
// capped card's 58 parts, drawn into a full memo, pushed out 58 of the closed rows' texts.
test("drawing an open capped reply's parts leaves the closed rows' Markdown memo as it was", async () => {
  const { v, cx, key } = await openLong(shortParas(4000), true);
  draw(v, cx);
  for (let i = 0; (v.mdMemo?.size ?? 0) < 400; i++) v.mdParts(`Closed row ${i}`);
  const before = [...v.mdMemo.keys()];
  v.toggle(key, cx);
  costedFrames(v, cx, 400, await cardDone(v, key));
  draw(v, cx);
  const parts = v.baseRows.filter((x) => x.kind === "md" && x.key.startsWith(`md:${key}:`)).map((x) => x.md);
  const after = new Set(v.mdMemo.keys());
  expect([parts.length, parts.filter((p) => after.has(p)).length, before.filter((k) => !after.has(k)).length]).toEqual([58, 0, 0]);
}, 60000);

// A three-turn session cut before its third prompt (file), and the rest of it to append (rest).
function grownFixture() {
  const file = fixture("--only", "3");
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const prompts = lines.map((l, i) => [JSON.parse(l), i]).filter(([j]) => j.type === "user" && !j.isMeta && (typeof j.message?.content === "string" || j.message?.content?.some?.((c) => c.type === "text"))).map(([, i]) => i);
  writeFileSync(file, `${lines.slice(0, prompts[2]).join("\n")}\n`);
  return { file, rest: `${lines.slice(prompts[2]).join("\n")}\n` };
}
// Following, a read that brings a new turn goes to the end (jumpLatest), as Latest does: a
// scroll still waiting for the rows to settle (an open's scroll of a card) is dropped, or it
// would land once they did and take the view from the end. Waits on the list's row cap,
// which carries the rule that every route to the newest turn drops a pending scroll.
test.skip("following, a read that brings a new turn drops a scroll still waiting and goes to the end", async () => {
  const { file, rest } = grownFixture();
  const { v, cx } = await pane(file);
  const key = v.turnKeys(v.rows())[0];
  v.scrollTo = { key, how: "card", until: Date.now() + 400 };
  v.follow = true;
  appendFileSync(file, rest);
  v.read(cx);
  await settle(v);
  expect([v.current().turns.length, v.follow, v.toBottom, v.scrollTo ?? null]).toEqual([3, true, true, null]);
});

// Japanese and Chinese prose has no space between words, so a long paragraph of it has no space
// or line break. It is ordinary text: it splits after its sentence and clause marks and shows
// whole, in Markdown parts, with no line saying that only its start is shown. Made-up prose,
// about 5,000 characters with no ASCII space or line break: with full stops, and on commas
// alone with no full stop (a long list of clauses).
const cjkProse = (s, n = 5000) => {
  let out = "";
  for (let i = 0; out.length < n; i++) out += s[i % s.length];
  return out;
};
async function shownWhole(para) {
  const { v, cx, key } = await openLong(para);
  v.probeDue = function () { this.probeLeft = 0; return []; };
  drawToEnd(v, cx, key);
  const waiting = () => v.baseRows.some((x) => x.kind === "mdrest" && x.key.includes(`:${key}:`));
  const card = v.baseRows.filter((x) => x.key.startsWith(`md:${key}:`));
  const text = frame(v, cx).filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
  return [para.length > 5000, /[ \n]/.test(para), waiting(), card.map((x) => x.kind).filter((k) => k !== "md"), card.map((x) => x.src).join(""), text.some((x) => x.includes("only its start is shown"))];
}
test("a paragraph of Japanese or Chinese prose over 4,000 characters, with no space, shows whole and not only its start", async () => {
  const para = cjkProse(["今日は配送ルートの確認を朝のうちに終えました。", "倉庫の在庫は午後に数え直す予定です。", "仓库的订单按线路分配给每一位司机。", "明天的路线表会在中午之前发出。"]);
  expect(await shownWhole(para)).toEqual([true, false, false, [], para, false]);
}, 60000);
test("a paragraph of Japanese or Chinese prose over 4,000 characters on commas, with no full stop or space, shows whole", async () => {
  const para = cjkProse(["倉庫の在庫を午後に数え直し、", "配送ルートの確認を朝のうちに終え、", "仓库的订单按线路分配给每一位司机，", "明天的路线表在中午之前发出，"]);
  expect(/[。！？]/.test(para)).toBe(false);
  expect(await shownWhole(para)).toEqual([true, false, false, [], para, false]);
}, 60000);

// Thai is written with no space between words and has none of the marks the split breaks
// after, so a long paragraph of it is one run with no place to split it, past one view. It shows
// whole as plain text under main's line, as on main. Made-up prose.
test("a paragraph of Thai prose of 5,000 characters with no space shows whole as plain text under main's line", async () => {
  const para = cjkProse(["การจัดส่งสินค้าตามเส้นทางของวันนี้เสร็จแล้ว", "คลังสินค้าจะนับสต็อกใหม่ในช่วงบ่าย"]).slice(0, 5000);
  const { v, cx, card, last } = await oneRun(para);
  const drawn = frame(v, cx).filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]);
  expect([para.length, /[ \n]/.test(para), card.length, last.kind, drawn.includes(para), drawn.includes("Herdr could not draw this part as Markdown, so it shows as plain text."), drawn.some((x) => x.includes("only its start is shown"))]).toEqual([5000, false, 1, "mdlong", true, true, false]);
}, 60000);
