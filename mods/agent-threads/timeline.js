// agent-threads: the Trajectory's timeline as data (TRD-23). Pure JavaScript with no Herdr
// imports, tested under bun (test/timeline.test.js); main.js draws what this returns.
// Carried from draft 107 (ledger.js there). The steps it reads are each heading's step rows
// (h.steps, made by ledger.js ledgerTurn, which holds no way back to the heading): a step's
// times and flags are its row's, and the tracks are worked out here, in the layout pass, only
// for a turn drawn wide enough for its bars (tlTracks). The ledger keeps no array and no
// number per step for it.

import { durText, startText, LEDGER_KINDS, spanKeys, TL_TRACK, TL_OPEN, TL_FAILED } from "./ledger.js";

// A heading's step count, and its i-th step's row (h.steps, its turn's step rows).
export const tlLen = (h) => h?.steps?.length ?? 0;
export const tlRow = (h, i) => (i >= 0 && i < tlLen(h) ? h.steps[i] : undefined);
const stepN = tlLen;
// How many times the turns were placed (timelineGeo), laid out (timelineLayout), the running
// turn alone laid out again (tlTail), a turn's tracks worked out (tlTracks) and a layer's path
// built (tlPathOf) since the module loaded, for the tests and the debug report: a draw that
// changes none of them adds none.
export const TL_MADE = { geo: 0, layout: 0, tail: 0, tracks: 0, paths: 0 };
// Whether two span lists ([x0, x1] or [x0, x1, 1] for a torn end) are the same, span for span.
function sameSpans(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x[0] !== y[0] || x[1] !== y[1] || (x[2] ?? 0) !== (y[2] ?? 0)) return false;
  }
  return true;
}
// A layer's painted path, kept: keep holds, by the layer's id, the spans it was built from, key
// (its width, height and colour) and the path. The same spans (by identity, else span for
// span: a layout made again or a running turn's events give new arrays) and key give the kept
// path; else build(spans) makes it, and it is kept. A path is a host object whose every point
// was a call into Herdr, so a draw that changes nothing builds none (the paint cost at 2,000
// and 5,600 turns on the test machine).
export function tlPathOf(keep, id, spans, key, build) {
  const k = keep.get(id);
  if (k && k.key === key && sameSpans(k.spans, spans)) { k.spans = spans; return k.path; }
  TL_MADE.paths++;
  const path = build(spans);
  keep.set(id, { key, spans, path });
  return path;
}
// A step's start and end from its row, ms from the turn's start (NaN for none: an instant has
// no end), and its flags: TL_TRACK (in the Tools lane it started while a call on the first
// track ran, drawn half height), TL_OPEN (a call with no result yet) and TL_FAILED.
const rowA = (r) => r.start ?? Number.NaN;
const rowB = (r) => (r.start != null && r.dur != null ? r.start + r.dur : Number.NaN);
const rowF = (r, track) => (track ? TL_TRACK : 0) | (r.open ? TL_OPEN : 0) | (r.failed ? TL_FAILED : 0);
// A turn's tracks: null when no step is on the second track, else one number a step, 1 for a
// call in the Tools lane that started while a call on the first track ran. A call on the
// second track does not hold the first: one that starts while only a half-height call runs
// goes on the first. A call with no result holds the first track to the turn's end; one that
// starts as the first track's call ends stays on the first. The
// calls are taken in clock order: as listed, unless one starts before the one listed before
// it, and then by start, the one listed first at equal starts.
export function tlTracks(h) { return runGen(tracksGen(h, null)); }
// tlTracks' work; with S (a build's state), each row read and each entry the sort moves counts
// in S.work, and the build may stop for the clock once a step's work reaches TL_BUILD_BARS
// (tlBuildGo).
function* tracksGen(h, S) {
  TL_MADE.tracks++;
  const n = stepN(h);
  let calls = [];
  const starts = [];
  let inOrder = true;
  for (let i = 0; i < n; i++) {
    if (S) {
      if (S.work >= TL_BUILD_BARS) { S.work = 0; yield 0; }
      S.work++;
    }
    const r = h.steps[i];
    if (r.start == null || LEDGER_KINDS[r.lk]?.lane !== "tools") continue;
    if (calls.length && r.start < starts[starts.length - 1]) inOrder = false;
    calls.push(i);
    starts.push(r.start);
  }
  if (!inOrder) calls = yield* byKey(calls, starts, S);
  let out = null;
  let end0 = -Infinity;
  for (const i of calls) {
    if (S) {
      if (S.work >= TL_BUILD_BARS) { S.work = 0; yield 0; }
      S.work++;
    }
    const r = h.steps[i];
    const a = r.start;
    if (a < end0) {
      if (!out) out = new Array(n).fill(0);
      out[i] = 1;
      continue;
    }
    end0 = r.open ? Infinity : r.dur != null ? a + r.dur : a;
  }
  return out;
}
// items by their keys, the one listed first at equal keys: a merge sort, so a build can stop
// inside it (S, as tracksGen). Both arrays are the caller's to give up: they are written over.
function* byKey(items, keys, S) {
  const n = items.length;
  let a = items;
  let ka = keys;
  let b = new Array(n);
  let kb = new Array(n);
  for (let w = 1; w < n; w *= 2) {
    for (let lo = 0; lo < n; lo += 2 * w) {
      const mid = Math.min(lo + w, n);
      const hi = Math.min(lo + 2 * w, n);
      let i = lo;
      let j = mid;
      for (let k = lo; k < hi; k++) {
        if (S) {
          if (S.work >= TL_BUILD_BARS) { S.work = 0; yield 0; }
          S.work++;
        }
        const m = j >= hi || (i < mid && ka[i] <= ka[j]) ? i++ : j++;
        b[k] = a[m];
        kb[k] = ka[m];
      }
    }
    [a, b] = [b, a];
    [ka, kb] = [kb, ka];
  }
  return a;
}
// Step i's box from its row (itemBox), on track (0 or 1).
function stepBox(h, i, track, tx, w, wall, scale, len, upTo = null) {
  const r = h.steps[i];
  return itemBox(rowA(r), rowB(r), rowF(r, track), i, tx, w, wall, scale, len, upTo);
}
// The tracks of turn h for a box w px wide in layout L: none under 2 px (the turn is one span
// a lane) or by steps; else the layout's, or, for a turn it did not draw as bars, worked out.
function tracksOf(L, h, w) {
  if (w < 2 || L.scale === "steps") return null;
  return L.tracks?.has(h) ? L.tracks.get(h) : tlTracks(h);
}
// Step i read back as one object: the row's key, kind, lane, ink and span keys, its start and
// end (null for none) and flags. tracks: the turn's (tlTracks), worked out here when not given.
// For a caller that wants one step (the hit's answer, tests); the layout reads the rows in place.
// A row's span keys by its kind, looked up once per kind (no string made per step).
const KIND_KEYS = new Map();
const laneKeys = (r) => {
  const lk = r?.lk;
  if (KIND_KEYS.has(lk)) return KIND_KEYS.get(lk);
  const k = LEDGER_KINDS[lk];
  const v = k?.lane ? spanKeys(k.lane, k.ink ?? "context") : null;
  KIND_KEYS.set(lk, v);
  return v;
};
export function tlStep(h, i, tracks) {
  const r = tlRow(h, i);
  if (!r) return null;
  const k = LEDGER_KINDS[r.lk];
  const t = tracks === undefined ? tlTracks(h) : tracks;
  const a = rowA(r);
  const b = rowB(r);
  return {
    i, key: r.key, lk: r.lk, lane: k?.lane ?? null, ink: k?.ink ?? "context", sk: laneKeys(r),
    a: Number.isNaN(a) ? null : a, b: Number.isNaN(b) ? null : b,
    track: t?.[i] ? 1 : 0, open: Boolean(r.open), failed: Boolean(r.failed),
  };
}

// ---- the timeline (round 3 and round 7) ----
// The session as bars on three lanes, Input, Model and Tools, in a strip cw px wide. Two
// scales: "clock", where a turn is as wide as it took (never under a minimum) and the idle
// time between turns is folded into a fixed break, hatched; "steps", where every step gets
// the same width. heads are the ledger's headings in order (each carries its turn's step rows,
// h.steps, from ledgerTurn).
// It is made in two parts. timelineGeo places the turns with the whole session fitted to the
// strip (it walks the turns, not the steps). timelineLayout draws a view of that: zoomed z
// times and x0 px in (in zoomed px), the steps only of the turns in view, and of those only a
// turn wide enough to draw them (a turn under 2 px is one span per lane it has). Bars that
// touch are joined, so what is drawn is bounded by the strip's width, not the session's
// length, at any zoom.
// A call with no result is a bar with a torn right end. In a turn that is not running it runs
// to the turn's last recorded event (the running rule); in the running turn it runs to now.
// The running turn (only ever the last: the running rule's newest turn) is placed on the clock
// scale at its room, not at its length so far: the next of TL_ROOM_MIN ms times TL_ROOM_GROW
// steps past it (liveRoom). So while it runs the strip keeps every turn's place, and only its
// unfinished bars grow (layout.grow, tlGrow), until it outgrows its room and the strip is
// placed again: fifteen times in its first hour. nowMs: the clock, for the running turn.
export const TL_LANES = Object.freeze(["input", "model", "tools"]);
// Where it is drawn (round 8, slice 1): across the top of the Trajectory pane from TL_MIN_W px
// wide, TL_H px tall with the line under it. A TL_GUT px gutter of lane names, then the strip:
// TL_PT, the turn numbers (TL_AX), the ticks (TL_TK), TL_LT, the three TL_LANE px lanes, 2 px
// and TL_PB. It starts hidden where it would leave fewer than TL_ROWS_MIN rows of the list.
export const TL_MIN_W = 540;
export const TL_H = 98;
export const TL_GUT = 58;
export const TL_AX = 18;
export const TL_TK = 15;
export const TL_LT = 3;
export const TL_LANE = 16;
export const TL_PT = 4;
export const TL_PB = 7;
export const TL_ROWS_MIN = 4;
// The strip's width in a pane w px wide: the pane less the gutter and a 12 px margin.
export function tlStrip(w) { return Math.max(40, Math.floor(w - TL_GUT - 12)); }
export const TL_ROOM_MIN = 10000;
export const TL_ROOM_GROW = 1.5;
export function liveRoom(ms) {
  // A time with no bound (nowMs or span Infinity) gets the least room, not Infinity.
  if (!Number.isFinite(ms)) return TL_ROOM_MIN;
  let r = TL_ROOM_MIN;
  while (r < ms) r *= TL_ROOM_GROW;
  return r;
}
// A turn's length on the clock, ms: from its start to its end, or, not running and with no end,
// to its last recorded event.
const wallOf = (h) => {
  const w = h.total ?? h.span ?? 0;
  return Number.isFinite(w) && w > 0 ? w : 0;
};
// The room of the running turn on this scale at nowMs, or 0 when the last turn is not running
// (or the scale is by steps, where nothing grows).
function roomOf(heads, scale, nowMs) {
  const h = heads[heads.length - 1];
  if (scale === "steps" || !h?.going || h.t0 == null) return 0;
  return liveRoom(Math.max(h.span ?? 0, nowMs - h.t0));
}
// A build stops to look at the clock (tlBuildGo) once a step's work reaches TL_BUILD_BARS:
// each step row read, each span laid, and each span list entry its join reads, moves or drops
// (tlJoin), so no step holds more than that and one join, however many calls a turn has or
// however far back its spans join. It stops too after TL_BUILD_CHUNK turns of one pass: the
// placing and the turn numbers read turns and lay no span, and a turn read is work too.
export const TL_BUILD_CHUNK = 256;
export const TL_BUILD_BARS = 1024;
// Runs a build to its end: the whole build in one go.
function runGen(g) {
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}
export function timelineGeo(heads, cw, scale = "clock", nowMs = Date.now()) { return runGen(geoGen(heads, cw, scale, nowMs)); }
// timelineGeo's work, yielding the turns walked every TL_BUILD_CHUNK of a pass (tlBuildGo).
function* geoGen(heads, cw, scale, nowMs) {
  TL_MADE.geo++;
  const C = TL_BUILD_CHUNK;
  const n = heads.length;
  const geo = { cw, scale, turns: [], index: new Map(), walls: [], gap: 0, total: 0, steps: 0, live: -1, room: 0, m: 0, min: 0 };
  if (!n || !(cw > 0)) return geo;
  const GAP = cw < 700 ? 14 : 30;
  const MIN = cw < 700 ? 30 : 48;
  const gap = n > 1 ? Math.min(GAP, (0.15 * cw) / (n - 1)) : 0;
  const min = Math.min(MIN, (0.3 * cw) / n);
  const target = Math.max(1, cw - gap * (n - 1));
  const walls = new Array(n);
  for (let i = 0; i < n; i++) {
    walls[i] = wallOf(heads[i]);
    geo.steps += Math.max(1, stepN(heads[i]));
    if ((i + 1) % C === 0) yield C;
  }
  yield n % C;
  const room = roomOf(heads, scale, nowMs);
  if (room > 0) { walls[n - 1] = room; geo.live = n - 1; geo.room = room; }
  // Each turn's width, by its index.
  let widthOf;
  if (scale === "steps") {
    const sw = target / geo.steps;
    widthOf = (ti) => Math.max(1, stepN(heads[ti])) * sw;
  } else {
    // The px per ms that fills the strip, each turn at least min wide: the turns held at min
    // and the px per ms for the rest found in turn until neither moves (a few passes; the
    // held set only grows as m falls). n * min is at most 30% of the strip, so it fits.
    let m = 0;
    let all = 0;
    for (let i = 0; i < n; i++) { all += walls[i]; if ((i + 1) % C === 0) yield C; }
    yield n % C;
    if (all > 0) {
      m = target / all;
      for (let k = 0; k < 12; k++) {
        let held = 0;
        let rest = 0;
        for (let i = 0; i < n; i++) {
          const w = walls[i];
          if (w * m < min) held++; else rest += w;
          if ((i + 1) % C === 0) yield C;
        }
        yield n % C;
        const next = rest > 0 ? Math.max(0, target - held * min) / rest : 0;
        if (Math.abs(next - m) <= m * 1e-9) { m = next; break; }
        m = next;
      }
      // The px per ms and the least width, for tlLastLength.
      geo.m = m;
      geo.min = min;
      widthOf = (ti) => Math.max(min, walls[ti] * m);
    } else {
      // No turn has a length: each gets an even share.
      widthOf = () => target / n;
    }
  }
  let x = 0;
  for (let ti = 0; ti < n; ti++) {
    const h = heads[ti];
    const w = widthOf(ti);
    geo.turns.push({ x, w, key: h.key, n: h.n });
    geo.index.set(h.key, ti);
    x += w + (ti < n - 1 ? gap : 0);
    if ((ti + 1) % C === 0) yield C;
  }
  yield n % C;
  geo.walls = walls;
  geo.gap = gap;
  geo.total = x;
  return geo;
}
// How far the last turn's end may move on the strip before the turns are placed again
// (tlLastLength), in px of the view.
export const TL_SLACK = 1;
// The places G with only the last turn's length changed to wall (room: the running room, 0
// when it does not run), at G's px per ms: the other turns keep their places, so the strip
// may end up to TL_SLACK px short of or past G's end. G may be kept places already, so over
// the running turn's room steps the end is under 3 TL_SLACK px off a whole placing
// (timelineModel). Null when that turn's end would move
// more than TL_SLACK px at zoom z (unless any: then by any amount, the strip ending short of
// its edge or past it), or G has no px per ms (by steps, or no turn has a length).
// was: the last heading G was placed for.
function tlLastLength(G, heads, wall, room, z, was, any = false) {
  const n = heads.length;
  if (!(G.m > 0) || G.turns.length !== n) return null;
  const t = G.turns[n - 1];
  const w = Math.max(G.min, wall * G.m);
  if (!any && Math.abs(w - t.w) * z > TL_SLACK) return null;
  const turns = G.turns.slice();
  turns[n - 1] = { ...t, w };
  const walls = G.walls.slice();
  walls[n - 1] = wall;
  const steps = G.steps - Math.max(1, stepN(was)) + Math.max(1, stepN(heads[n - 1]));
  return { ...G, turns, walls, total: G.total - t.w + w, steps, live: room > 0 ? n - 1 : -1, room };
}
// How far the timeline zooms: until four steps fill it (the reference's limit), so it grows
// with the session.
export function tlMaxZoom(geo) { return Math.max(1, (geo?.steps ?? 0) / 4); }
// A view kept inside the session: z from 1 to the limit, x0 from 0 to the zoomed end.
export function tlClamp(geo, view) {
  const z = Math.min(tlMaxZoom(geo), Math.max(1, Number(view?.z) || 1));
  const room = Math.max(0, (geo?.total ?? 0) * z - (geo?.cw ?? 0));
  return { z, x0: Math.min(room, Math.max(0, Number(view?.x0) || 0)) };
}
// The view zoomed to z about a point px from the strip's left: the moment under it stays under
// it (a pinch), or with put, moves to put px (the buttons and keys put it in the middle).
export function tlZoomAt(geo, view, z, at, put = at) {
  const v = tlClamp(geo, view);
  const f = (at + v.x0) / v.z;
  const nz = tlClamp(geo, { z, x0: 0 }).z;
  return tlClamp(geo, { z: nz, x0: f * nz - put });
}
// A turn's box in the view: { x, w } in px of the strip.
export function tlBox(L, ti) {
  const t = L.turns[ti];
  return t ? { x: t.x * L.z - L.x0, w: t.w * L.z } : null;
}
// The rows a band holds, lo to hi px of the view L: the first and last whose bar starts inside
// it ({ a, b } keys, in order), or null when no bar starts there. Walks the turns the band
// covers, found by halving.
export function bandRows(L, heads, lo, hi) {
  const G = L.geo;
  const T = G?.turns ?? [];
  if (!T.length || !(hi >= lo)) return null;
  const z = L.z ?? 1;
  const x0 = L.x0 ?? 0;
  const f0 = (lo + x0) / z;
  const f1 = (hi + x0) / z;
  let i = 0;
  let j = T.length - 1;
  while (i < j) { const m = (i + j) >> 1; if (T[m].x + T[m].w < f0) i = m + 1; else j = m; }
  let a = null;
  let b = null;
  for (let ti = i; ti < T.length && T[ti].x <= f1; ti++) {
    const h = heads[ti];
    const wall = G.walls[ti] ?? wallOf(h);
    const len = stepN(h);
    for (let i = 0; i < len; i++) {
      // A row with no lane (an interrupted turn's Interrupted row) is no bar.
      if (!laneKeys(h.steps[i])) continue;
      // Where a bar starts does not depend on its track.
      const bx = stepBox(h, i, 0, T[ti].x * z - x0, T[ti].w * z, wall, L.scale, len);
      if (!bx || bx.x0 < lo || bx.x0 > hi) continue;
      if (a == null) a = h.steps[i].key;
      b = h.steps[i].key;
    }
  }
  return a == null ? null : { a, b };
}
// A span's right end b (torn: an unfinished call's) taken into span s: the rightmost end and
// its torn mark; at equal ends the mark is kept when either is torn.
const takeEnd = (s, b, torn) => {
  if (b > s[1]) { s[1] = b; if (torn) s[2] = 1; else s.length = 2; }
  else if (torn && b === s[1]) s[2] = 1;
};
// The span [a, b] put into list, one key's spans apart and in order: [x0, x1], or [x0, x1, 1]
// when its right end is an unfinished call's (drawn torn). Spans join where they touch or
// overlap, within half a pixel either way. They come in a turn's row order, which is not the
// clock's (a note listed after a later one, a call on the second track, an unfinished call's
// bar in a turn under 6 px, which starts left of the bars before it), so the span goes in its
// place: after the last span that starts at or left of it, found from the end (one that comes
// in order takes no step back). It joins that span when it starts within half a pixel of its
// end, then the spans after it that it reaches; the spans it does not reach are left apart.
// Gives its work, for a build's count (tlBuildGo): the entries it reads, those it walks back
// over and the few it compares, and each entry its splices move or drop (a splice reads each).
// At most four times the list's length, and five.
export function tlJoin(list, a, b, torn = false) {
  let i = list.length;
  while (i > 0 && list[i - 1][0] > a) i--;
  let work = list.length - i + 2;
  let s;
  if (i > 0 && a <= list[i - 1][1] + 0.5) { i--; s = list[i]; work++; takeEnd(s, b, torn); }
  else { s = torn ? [a, b, 1] : [a, b]; work += list.length - i; list.splice(i, 0, s); }
  // The list was apart, so of the spans s reaches the last ends rightmost.
  let j = i + 1;
  while (j < list.length && list[j][0] <= s[1] + 0.5) j++;
  work += j - i;
  if (j > i + 1) { const e = list[j - 1]; takeEnd(s, e[1], e[2] === 1); work += list.length - i; list.splice(i + 1, j - i - 1); }
  return work;
}
// range: the focus range as { ia, ib, pos } (the first and last row's place in the ledger's
// rows, and every row's place): bars outside it get their own spans, with "|o" on the key.
// The running turn's unfinished bars are not spans: each is in out.grow ({ k, x0, tx, w, wall,
// t0 }), whose right end tlGrow finds at a given time, so a layout holds while the turn runs.
const TL_MARGIN = 40;
// add(k, a, b, torn) gives the span's work: 1, and its join's (tlJoin).
function spanAdder(out) {
  return (k, a, b, torn = false) => {
    let list = out.spans.get(k);
    if (!list) { list = []; out.spans.set(k, list); }
    return 1 + tlJoin(list, a, b, torn);
  };
}
// How far left of the last turn's start, tx, its bars can change a span laid before it: 4.5 px.
// A bar is laid from itemBox's box, in a turn 2 px wide or more (a narrower one is a span from
// tx itself), and starts at or right of tx, or at the turn's end less its least width where that
// is left of tx. The least width is 6 px for an unfinished call and 3 px for any other, so a bar
// starts 4 px left of tx at most, and 1 px. It joins a span that ends within 0.5 px left of its
// start (tlJoin). TL_SLACK adds nothing: a last turn whose length alone changes keeps its tx
// (tlLastLength). The rest is for the rounding of those sums.
const TL_BACK = 4.5 + 1e-6;
// A layout's state before its last turn: where in each span list the spans begin that the last
// turn's bars can join (those that end at or right of tx less TL_BACK; the spans are apart and in
// order, so they are the list's last few) and copies of them, and the lengths of the other lists.
function cutOf(S) {
  const { out, G, z, x0 } = S;
  const from = G.turns[G.turns.length - 1].x * z - x0 - TL_BACK;
  const spans = new Map();
  for (const [k, list] of out.spans) {
    let i = list.length;
    while (i > 0 && list[i - 1][1] >= from) i--;
    spans.set(k, [i, list.slice(i).map((s) => s.slice())]);
  }
  return { spans, fails: out.fails.length, grow: out.grow.length, ticks: out.ticks.length, gaps: out.gaps.length, to: out.to, failEnd: S.failEnd };
}
// The layout P with its last turn laid out again from heads, whose other headings are P's
// (timelineModel checks): the lists cut back to before that turn, copied, then that turn
// alone. The places, the numbers and the breaks stay P's. The tracks are P's (a copy) less
// the old last heading's (was), and the new one's worked out: one track pass an event. G: the
// places, P's or P's with only the last turn's length changed (tlLastLength), whose number
// then gets that turn's width and length text again. With no cut (the last turn out of view),
// P itself on G.
function tlTail(P, heads, was, G = P.geo) {
  TL_MADE.tail++;
  const c = P.cut;
  const on = G === P.geo ? null : { geo: G, turns: G.turns, total: G.total, zmax: tlMaxZoom(G) };
  if (!c) return on ? { ...P, ...on } : P;
  const out = { ...P, ...on, spans: new Map(), fails: P.fails.slice(0, c.fails), grow: P.grow.slice(0, c.grow), ticks: P.ticks.slice(0, c.ticks), gaps: P.gaps.slice(0, c.gaps), to: c.to, tracks: new Map(P.tracks) };
  out.tracks.delete(was);
  for (const [k, list] of P.spans) {
    const s = c.spans.get(k);
    if (!s) continue;
    out.spans.set(k, [...list.slice(0, s[0]), ...s[1].map((sp) => sp.slice())]);
  }
  const S = { out, heads, G, z: P.z, x0: P.x0, cw: P.cw, scale: P.scale, range: null, walls: G.walls, add: spanAdder(out), M: TL_MARGIN, kept: null, failEnd: c.failEnd, nti: [], nx: [], nw: [], work: 0 };
  const n = heads.length;
  runGen(layTurn(S, n - 1));
  const j = P.labels.length - 1;
  if (on && j >= 0 && P.labels[j].ti === n - 1 && S.nti[0] === n - 1) {
    out.labels = P.labels.slice();
    out.labels[j] = { ...P.labels[j], tw: S.nw[0] };
    roomOfNumbers([out.labels[j]], heads, out);
  }
  return out;
}
// One turn of a layout: its number's place, its spans (or one per lane under 2 px), its fail
// marks, its growing bars, its ticks and the break after it. S: the layout's state (timelineLayout).
// false once the turn is past the strip's end and its margin. A generator: inside a wide turn
// it yields 0 (no turn walked) before a row once the step's work (S.work: rows read, spans laid
// and their joins' work, its failure marks sorted and spaced) reaches TL_BUILD_BARS, so a build
// step can end inside a turn; the result is the same as laid out in one go. A turn under 2 px
// looks at it before each span it lays. So a step is over TL_BUILD_BARS by one row and one
// span's join at most.
function* layTurn(S, ti) {
  const { out, heads, G, z, x0, cw, scale, range, walls, add, M, kept } = S;
  const n = G.turns.length;
  const t = G.turns[ti];
  const x = t.x * z - x0;
  if (x > cw + M) return false;
  out.to = ti;
  const h = heads[ti];
  const w = t.w * z;
  // The number at the turn's start, or at the strip's left edge while the turn runs past it.
  if (x < cw && x + w > 0) { S.nti.push(ti); S.nx.push(Math.max(0, x)); S.nw.push(x + w - Math.max(0, x)); }
  if (w < 2) {
    const c = h.cnt ?? {};
    const x1 = x + Math.max(w, 1);
    // A turn too narrow for its steps is inside the range when any of its rows is.
    const ih = range ? range.pos.get(h.key) : null;
    const o = range && !(ih != null && ih <= range.ib && ih + stepN(h) >= range.ia) ? "|o" : "";
    if (c.input) {
      if (S.work >= TL_BUILD_BARS) { S.work = 0; yield 0; }
      S.work += add(`${c.user ? "input|user|0" : c.agent ? "input|agent|0" : "input|context|0"}${o}`, x, x1);
    }
    if (c.model) {
      if (S.work >= TL_BUILD_BARS) { S.work = 0; yield 0; }
      S.work += add(`model|model|0${o}`, x, x1);
    }
    if (c.tools) {
      if (S.work >= TL_BUILD_BARS) { S.work = 0; yield 0; }
      S.work += add(`${c.failed ? "tools|failed|0" : "tools|tools|0"}${o}`, x, x1);
    }
    // A failure mark is drawn at its bar's centre, and spaced by it from the last, 6 px or
    // more, across turns as inside one.
    const fx = x + w / 2;
    if (c.failed && fx >= S.failEnd) { out.fails.push(fx); S.failEnd = fx + 6; }
  } else {
    const live = ti === G.live;
    const len = stepN(h);
    // The turn's tracks, on the clock: the last layout's for the same heading, else worked out.
    let tk = null;
    let marks = null;
    let marksOrdered = true;
    if (scale !== "steps") {
      tk = kept?.get(h);
      if (tk === undefined) tk = yield* tracksGen(h, S);
      out.tracks.set(h, tk);
    }
    for (let i = 0; i < len; i++) {
      if (S.work >= TL_BUILD_BARS) { S.work = 0; yield 0; }
      S.work++;
      const r = h.steps[i];
      const sk = laneKeys(r);
      if (!sk) continue;
      const b = stepBox(h, i, tk?.[i], x, w, walls[ti], scale, len);
      if (!b || b.x1 < -M || b.x0 > cw + M) continue;
      const k = sk[b.track ? 1 : 0];
      if (live && b.open) {
        out.grow.push({ k, x0: b.x0, tx: x, w, wall: walls[ti], t0: h.t0 });
        continue;
      }
      const ip = range ? range.pos.get(r.key) : null;
      S.work += add(range && !(ip != null && ip >= range.ia && ip <= range.ib) ? `${k}|o` : k, b.x0, b.x1, Boolean(b.open));
      if (r.failed) {
        if (!marks) marks = [];
        const fx = (b.x0 + b.x1) / 2;
        if (marks.length && fx < marks[marks.length - 1]) marksOrdered = false;
        marks.push(fx);
      }
    }
    // The turn's failure marks left to right by their bars' centres, where they are drawn (a
    // call run earlier can be listed after a later one), each 6 px or more from the last. So
    // every failed bar has a mark within 6 px of its centre.
    if (marks) {
      if (!marksOrdered) marks = yield* byKey(marks, marks.slice(), S);
      for (const fx of marks) {
        if (S.work >= TL_BUILD_BARS) { S.work = 0; yield 0; }
        S.work++;
        if (fx >= S.failEnd) { out.fails.push(fx); S.failEnd = fx + 6; }
      }
    }
    // Ticks inside a wide turn: on the clock its time from the start, by steps its step
    // numbers. Only those in view.
    if (w >= 120) {
      if (scale === "steps") {
        const len = stepN(h);
        const every = Math.max(1, Math.ceil(36 / (w / len)));
        for (let i = 0; i < len; i += every) { const tx = x + ((i + 0.5) * w) / len; if (tx >= -M && tx <= cw) out.ticks.push({ x: tx, text: `${i + 1}`, step: true }); }
      } else if (walls[ti] > 0) {
        const pps = w / walls[ti];
        const step = [1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].map((s) => s * 1000).find((v) => v * pps >= 62);
        // From the first tick in view.
        const k0 = step ? Math.max(1, Math.floor(-x / (step * pps))) : 1;
        for (let k = k0; step && k * step < walls[ti] && k * step * pps < w - 34; k++) {
          const tx = x + k * step * pps;
          if (tx > cw) break;
          if (tx >= -M) out.ticks.push({ x: tx, text: startText(k * step) });
        }
      }
    }
  }
  if (ti < n - 1) {
    const next = heads[ti + 1];
    out.gaps.push([x + w, x + w + G.gap * z, next.t0 != null && h.t0 != null ? next.t0 - (h.t0 + walls[ti]) : null]);
  }
  return true;
}
// out.tracks: the tracks (tlTracks) of each turn this layout draws as bars on the clock, by
// heading, and of no other; kept: the last layout's, whose entries are taken for the same
// heading (a finished turn keeps its heading when the ledger is built again), so a finished
// turn's tracks are worked out once while it stays drawn.
export function timelineLayout(heads, cw, scale = "clock", nowMs = Date.now(), view = null, geo = null, range = null, kept = null) {
  return runGen(layoutGen(heads, cw, scale, nowMs, view, geo, range, kept));
}
// timelineLayout's work (and the placing's, with no geo), yielding the turns walked every
// TL_BUILD_CHUNK (tlBuildGo).
function* layoutGen(heads, cw, scale, nowMs, view, geo, range, kept) {
  TL_MADE.layout++;
  const G = geo ?? (yield* geoGen(heads, cw, scale, nowMs));
  const { z, x0 } = tlClamp(G, view);
  const out = { cw, scale, z, x0, geo: G, turns: G.turns, index: G.index, total: G.total, zmax: tlMaxZoom(G), gaps: [], spans: new Map(), labels: [], every: 1, ticks: [], fails: [], grow: [], tracks: new Map(), from: 0, to: -1 };
  const n = G.turns.length;
  if (!n) return out;
  const walls = G.walls;
  // Spans by lane, ink and track: "tools|failed|0" -> [[x0, x1]], joined where they touch. A
  // span whose right end is an unfinished call's is [x0, x1, 1]: drawn with its torn end.
  const add = spanAdder(out);
  // The turns in view, and a margin: the first found by halving, since turns are in order.
  const M = TL_MARGIN;
  const left = (x0 - M) / z;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; const t = G.turns[m]; if (t.x + t.w + G.gap < left) lo = m + 1; else hi = m; }
  out.from = lo;
  // The turns that could have a number (those starting before the strip's end) in nti, nx, nw.
  const S = { out, heads, G, z, x0, cw, scale, range, walls, add, M, kept, failEnd: -Infinity, nti: [], nx: [], nw: [], work: 0 };
  let walked = 0;
  for (let ti = lo; ti < n; ti++) {
    // Before the last turn, what the layout holds so far, so a new heading of that turn alone
    // is laid out again from here (tlTail).
    if (ti === n - 1 && !range) out.cut = cutOf(S);
    if (!(yield* layTurn(S, ti))) break;
    if (++walked === TL_BUILD_CHUNK) { yield walked; walked = 0; S.work = 0; }
  }
  yield walked;
  yield* numbersGen(out, heads, S.nti, S.nx, S.nw);
  return out;
}
// A model built from nothing over several draws (opened, or shown again after the pane dropped
// the model while hidden): the placing and the layout, TL_BUILD_CHUNK turns of a pass a step.
// tlBuildGo(J, until, clock) takes steps until clock() reaches until, and gives the model (as
// timelineModel(null, ...) makes it) once done, else null. J.ran: the turns walked in that
// call; J.total: in all. At 5,600 turns the build took 26 ms on the test machine, and it grows
// with the turns, so a draw does only part of it.
export function tlBuildStart(heads, cw, scale = "clock", nowMs = Date.now(), view = null) {
  return { heads, cw, scale, nowMs, vk: view ? `${view.z}|${view.x0}` : "", gen: layoutGen(heads, cw, scale, nowMs, view, null, null, null), ran: 0, total: 0, model: null };
}
export function tlBuildGo(J, until, clock) {
  if (J.model) return J.model;
  J.ran = 0;
  for (;;) {
    const r = J.gen.next();
    if (r.done) {
      const L = r.value;
      J.model = { heads: J.heads, cw: J.cw, scale: J.scale, geo: L.geo, vk: J.vk, L, nowMs: J.nowMs, grow: tlGrow(L, J.nowMs) };
      return J.model;
    }
    J.ran += r.value;
    J.total += r.value;
    if (clock() >= until) return null;
  }
}
// The turns' numbers, 10.5 px: a number is TL_NUM_PAD px (its edge line and padding) and
// TL_NUM_CH px a digit wide, and TL_NUM_GAP px clear of the next. A turn's length goes beside
// its number where the turn and the room to the next number are both TL_NUM_LEN px or more.
// TL_NUM_CH is measured from the test machine's UI font at 10.5 px, where a wide digit takes
// about 7 px ("2000" needs 27 to 28 after its line and padding), with a little over. Another
// font can be wider.
export const TL_NUM_PAD = 6;
export const TL_NUM_CH = 7.2;
export const TL_NUM_GAP = 8;
export const TL_NUM_LEN = 120;
export function tlNumW(text) { return TL_NUM_PAD + String(text).length * TL_NUM_CH; }
// The steps k is chosen from: 1, 2, 5, 10, 20, 50 and on.
function nextStep(k) { const d = 10 ** Math.floor(Math.log10(k)); const m = k / d; return (m < 2 ? 2 : m < 5 ? 5 : 10) * d; }
// out.labels: the first turn's number, then every k-th turn's (turn numbers a multiple of k),
// k the smallest step that keeps them all apart (out.every). A multiple that would run past
// the strip's end, or touch the first turn's number, has none. Then the last turn's, moved inside
// the strip's end, in place of any it touches. nti, nx, nw: the turns in view
// that start before the strip's end, their number's x and their width from it.
// A generator: it yields 0 every TL_BUILD_CHUNK turns it reads (tlBuildGo).
function* numbersGen(out, heads, nti, nx, nw) {
  const cw = out.cw;
  let read = 0;
  const m = nti.length;
  if (!m) return;
  const top = heads[nti[m - 1]].n;
  let k = 1;
  for (; k <= top; k = nextStep(k)) {
    let end = -Infinity;
    let ok = true;
    for (let j = 0; j < m && ok; j++) {
      if (++read === TL_BUILD_CHUNK) { read = 0; yield 0; }
      const ti = nti[j];
      const h = heads[ti];
      if (ti === 0 || h.n % k) continue;
      const w = tlNumW(h.n);
      if (nx[j] + w > cw) continue;
      if (nx[j] < end) ok = false;
      end = nx[j] + w + TL_NUM_GAP;
    }
    if (ok) break;
  }
  out.every = k;
  const list = [];
  let end = -Infinity;
  for (let j = 0; j < m; j++) {
    if (++read === TL_BUILD_CHUNK) { read = 0; yield 0; }
    const ti = nti[j];
    const h = heads[ti];
    if (ti !== 0 && h.n % k) continue;
    const w = tlNumW(h.n);
    if (ti !== 0 && (nx[j] + w > cw || nx[j] < end)) continue;
    list.push({ ti, x: ti === 0 ? Math.min(nx[j], Math.max(0, cw - w)) : nx[j], tw: nw[j], text: `${h.n}`, w: 0, total: null });
    end = list.at(-1).x + w + TL_NUM_GAP;
  }
  // The session's last turn, in view, always has its number: end-aligned inside the strip, in
  // place of the numbers before it that it touches. Touching the first turn's, it has none.
  const lt = nti[m - 1];
  if (lt === heads.length - 1 && lt !== 0 && list.at(-1)?.ti !== lt) {
    const text = `${heads[lt].n}`;
    const x = Math.min(nx[m - 1], Math.max(0, cw - tlNumW(text)));
    const touches = (l) => l.x + tlNumW(l.text) + TL_NUM_GAP > x;
    let keep = list.length;
    while (keep > 0 && list[keep - 1].ti !== 0 && touches(list[keep - 1])) keep--;
    if (!(keep > 0 && touches(list[keep - 1]))) {
      list.length = keep;
      list.push({ ti: lt, x, tw: nw[m - 1], text, w: 0, total: null });
    }
  }
  out.labels = roomOfNumbers(list, heads, out);
}
// Each number's w, the room to the next number (or the strip's end), and its turn's length
// where there is room.
function roomOfNumbers(list, heads, L) {
  for (let j = 0; j < list.length; j++) {
    const l = list[j];
    const room = (j + 1 < list.length ? list[j + 1].x : L.cw) - l.x;
    l.w = Math.max(tlNumW(l.text), room - (j + 1 < list.length ? TL_NUM_GAP / 2 : 0));
    const h = heads[l.ti];
    l.total = l.tw >= TL_NUM_LEN && room >= TL_NUM_LEN ? (h.going ? "running" : durText(L.geo.walls[l.ti]) || null) : null;
  }
  return list;
}
// The numbers to draw with turn ti selected: the layout's, with the selected turn's number
// at its start (kept inside the strip) in place of any it touches. ti null, out of view or
// already numbered: the layout's own list.
export function tlNumbers(L, heads, ti) {
  if (ti == null || !L.turns[ti] || L.labels.some((l) => l.ti === ti)) return L.labels;
  const t = L.turns[ti];
  const x = t.x * L.z - L.x0;
  const w = t.w * L.z;
  if (x >= L.cw || x + w <= 0) return L.labels;
  const text = `${heads[ti].n}`;
  const sw = tlNumW(text);
  const sx = Math.min(Math.max(0, x), Math.max(0, L.cw - sw));
  const touches = (l) => (l.x <= sx ? l.x + tlNumW(l.text) + TL_NUM_GAP > sx : sx + sw + TL_NUM_GAP > l.x);
  const list = [];
  let put = false;
  for (const l of L.labels) {
    if (!put && l.x > sx) { list.push({ ti, x: sx, tw: x + w - Math.max(0, x), text, w: 0, total: null }); put = true; }
    if (!touches(l)) list.push({ ...l });
  }
  if (!put) list.push({ ti, x: sx, tw: x + w - Math.max(0, x), text, w: 0, total: null });
  return roomOfNumbers(list, heads, L);
}
// The breaks' hatch: 45 degree lines TL_HATCH px apart in each break 4 px or wider (gaps from
// timelineLayout, [x0, x1, ms]), cut to the break and to a strip cw px wide and h px tall, as
// segments [x0, y0, x1, y1] in px. One painted path draws them all, so their count is the
// path's size: past TL_HATCH_MAX the lines are spaced wider, so there are never more. At Fit
// the breaks take at most 15% of the strip and a break is 4 px or wider only while the turns
// are few (52 on a 1,370 px strip), so the count stays near 0.4 of the strip's width; the cap
// is for a zoomed view (part 3). every: the spacing used.
export const TL_HATCH = 5;
export const TL_HATCH_MAX = 800;
export function hatchLines(gaps, cw, h) {
  const wide = [];
  let len = 0;
  for (const [a, z] of gaps ?? []) {
    if (!(z - a >= 4 && z > 0 && a < cw)) continue;
    const x0 = Math.max(0, a);
    const x1 = Math.min(cw, z);
    wide.push([x0, x1]);
    len += x1 - x0 + h;
  }
  // Each break gets at most len_i / every + 1 lines, so this spacing keeps the sum to the cap.
  let every = TL_HATCH;
  let n = 0;
  for (const [x0, x1] of wide) n += Math.ceil((x1 - x0 + h) / TL_HATCH);
  if (n > TL_HATCH_MAX) every = len / Math.max(1, TL_HATCH_MAX - wide.length);
  const lines = [];
  for (const [x0, x1] of wide) {
    // The first line half a spacing in, so none is a point at the break's left edge.
    for (let c = x0 - h + every / 2; c < x1; c += every) {
      const a = Math.max(x0, c);
      const z = Math.min(x1, c + h);
      // Rounded to the strip: a line's end at the lanes' top or foot is 0 or h, not 1e-14 past it.
      if (z > a) lines.push([a, Math.min(h, Math.max(0, h - (a - c))), z, Math.min(h, Math.max(0, h - (z - c)))]);
    }
  }
  return { lines, every };
}
// The torn end (round 7 decisions, section 2) as a polygon in px, for a bar a to z px and h
// px tall: the right end cut into teeth (3, each 4 px tall and 5 px deep; 3 px deep under 12
// px wide; a half-height bar 2 teeth 3 px deep), the left corners cut 1 px.
export function tornPoints(a, z, h) {
  const teeth = h < 12 ? 2 : 3;
  const depth = Math.min(h < 12 || z - a < 12 ? 3 : 5, Math.max(1, z - a - 2));
  const r = Math.min(1, (z - a) / 4);
  const th = h / teeth;
  const pts = [[a, r], [a + r, 0], [z - depth, 0]];
  for (let i = 0; i < teeth; i++) pts.push([z, (i + 0.5) * th], [z - depth, (i + 1) * th]);
  pts.push([a + r, h], [a, h - r]);
  return pts;
}
// A polygon whose rows each cross it once (a bar with a torn or slanted end) as whole-pixel
// rows: [{ y, h, x0, x1 }], rows of the same extent joined. For a Herdr with no filled path.
export function polyRows(pts, h) {
  const out = [];
  for (let y = 0; y < h; y++) {
    const yc = y + 0.5;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[(i + 1) % pts.length];
      if ((py <= yc && yc < qy) || (qy <= yc && yc < py)) {
        const x = px + ((yc - py) * (qx - px)) / (qy - py);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
    if (!(x1 > x0)) continue;
    const last = out[out.length - 1];
    if (last && last.y + last.h === y && Math.abs(last.x0 - x0) < 0.25 && Math.abs(last.x1 - x1) < 0.25) last.h++;
    else out.push({ y, h: 1, x0, x1 });
  }
  return out;
}
// The px where the running turn's unfinished bars end at nowMs: a turn tx px in, w px wide,
// placed at wall ms (its room), started at t0. Within the turn.
function growEnd(tx, w, wall, t0, nowMs) {
  return tx + Math.max(0, Math.min(1, (nowMs - t0) / wall)) * w;
}
// The running turn's unfinished bars at nowMs, from a layout's grow list: [{ k, x0, x1 }], each
// at least 6 px wide as itemBox makes them. Only these move while the turn runs.
export function tlGrow(L, nowMs = Date.now()) {
  return (L?.grow ?? []).map((g) => ({ k: g.k, x0: g.x0, x1: Math.max(g.x0 + 6, Math.min(g.tx + g.w, growEnd(g.tx, g.w, g.wall, g.t0, nowMs))) }));
}
// Step i's box on the strip, from its start a and end b (ms from the turn's start, NaN for
// none) and flags f: x0 and x1 in px, and its track. A turn tx px in, w px wide, wall ms long,
// with len steps. null for a step with no time on the clock scale. upTo: where an unfinished
// call's bar ends (px), when not at the turn's end (the running turn's, at now).
export function itemBox(a, b, f, i, tx, w, wall, scale, len, upTo = null) {
  const open = Boolean(f & TL_OPEN);
  if (scale === "steps") {
    const sw = w / Math.max(1, len);
    const pad = sw > 4 ? 1 : 0;
    // An unfinished call fills its step, with the torn end as on the clock.
    const box = { x0: tx + i * sw + pad, x1: tx + (i + 1) * sw - pad, track: 0 };
    if (open) box.open = true;
    return box;
  }
  if (Number.isNaN(a) || !(wall > 0)) return null;
  // An unfinished call (open) is never under 6 px wide, so its torn end keeps its shape.
  const least = open ? 6 : 3;
  // A step that starts before its turn (a tool's clock behind the prompt's) starts at the
  // turn's start; in a turn under least px wide the bar still ends at the turn's end.
  const x0 = Math.min(Math.max(tx, tx + (a / wall) * w), tx + w - least);
  const end = !Number.isNaN(b) ? tx + (b / wall) * w : open ? upTo ?? tx + w : x0 + 3;
  const box = { x0, x1: Math.max(x0 + least, Math.min(end, tx + w)), track: f & TL_TRACK ? 1 : 0 };
  if (open) box.open = true;
  return box;
}
// A step's bar as the layers draw it, in px of the view: on a turn under 2 px wide, which the
// layout draws as one span per lane (x to x + max(w, 1)), that span at the turn's own x; else
// the step's own bar (itemBox) on its track (tk: the turn's tracks, tracksOf). itemBox keeps a
// bar 3 px wide, so on so narrow a turn its bar would start left of the turn; such a turn has
// no tracks (track 0). The press and the outline both use this.
function barAt(h, i, tx, tw, wall, scale, len, upTo, tk) {
  if (tw < 2) return { x0: tx, x1: tx + Math.max(tw, 1), track: 0 };
  return stepBox(h, i, tk?.[i], tx, tw, wall, scale, len, upTo);
}
// Step si of turn ti, as barAt draws it; the running turn's unfinished bars end at nowMs.
export function tlBar(L, heads, ti, si, nowMs = Date.now()) {
  const T = tlBox(L, ti);
  const h = heads[ti];
  if (!T || !h) return null;
  const wall = L.geo?.walls[ti] ?? wallOf(h);
  const upTo = ti === L.geo?.live && h.t0 != null && wall > 0 ? growEnd(T.x, T.w, wall, h.t0, nowMs) : null;
  return barAt(h, si, T.x, T.w, wall, L.scale, stepN(h), upTo, tracksOf(L, h, T.w));
}
// What is drawn over what in a lane, the higher number on top: the view draws its layers in this
// order and a press takes the bar on top by it (nearStep), so both read this one place. The
// running turn's growing bars over all; then failed calls over the rest; then half height over
// full; then, on one track, an ordinary call over a subagent's, and in the Input lane the user's
// message over an agent's and that over a background update.
const TL_OVER = Object.freeze({ context: 0, agent: 1, sub: 1, user: 2, model: 2, tools: 2 });
export const tlOver = (ink, half, growing = false) => (growing ? 16 : 0) + (ink === "failed" ? 8 : 0) + (half ? 4 : 0) + (TL_OVER[ink] ?? 0);
// Turn ti's step for a press at px x of the view in a lane, ly px down it (null: any):
// { ti, i, top, d, r, w } (i null for none). With bars under the press (top; a full bar is 2 to
// 14 px down its lane, a half one 8 to 14, the view's rectLayer), the one drawn on top: r, the
// view's order (tlOver); then, of bars in one layer, the narrowest, w. Else the nearest bar
// within 4 px, the first listed at equal distance. A turn under 2 px is drawn as one span per
// lane, from its x and at least 1 px wide (barAt), so each of its bars is that span here, its
// tool calls in the ordinary call's ink (layTurn): the press answers what is drawn, its failed
// call where the span is red.
function nearStep(L, h, ti, x, lane, nowMs, ly) {
  const z = L.z ?? 1;
  const wall = L.geo?.walls[ti] ?? wallOf(h);
  const tx = L.turns[ti].x * z - (L.x0 ?? 0);
  const tw = L.turns[ti].w * z;
  // The running turn's unfinished bars end at now, not at its room's end.
  const upTo = ti === L.geo?.live && h.t0 != null ? growEnd(tx, tw, wall, h.t0, nowMs) : null;
  const tk = tracksOf(L, h, tw);
  const out = { ti, i: null, top: false, d: 4, r: -1, w: Infinity };
  const len = stepN(h);
  for (let i = 0; i < len; i++) {
    const k = LEDGER_KINDS[h.steps[i].lk];
    // A row with no lane (an interrupted turn's Interrupted row) is no bar.
    if (!laneKeys(h.steps[i]) || (lane && k.lane !== lane)) continue;
    const b = barAt(h, i, tx, tw, wall, L.scale, len, upTo, tk);
    if (!b) continue;
    const d = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
    const ink = tw < 2 && k.lane === "tools" && k.ink !== "failed" ? "tools" : k.ink;
    const r = tlOver(ink, b.track, upTo != null && b.open);
    const w = b.x1 - b.x0;
    if (d === 0 && (ly == null || (ly >= (b.track ? 8 : 2) && ly <= 14))) {
      if (!out.top || r > out.r || (r === out.r && w < out.w)) Object.assign(out, { i, top: true, d, r, w });
    } else if (!out.top && d < out.d) Object.assign(out, { i, d, r, w });
  }
  return out;
}
// The turn and step under px x of the strip in a lane: { turn, key } (key: the step's row,
// or the turn's heading when no step's bar is within 4 px). heads in the layout's order; x in
// px of the view (zoomed and panned); ly, px down the lane (null: any). Where bars are under
// the press, the one drawn on top (nearStep), of the turn under the press, the later turns whose
// bars reach back to it and the earlier turns under 2 px whose 1 px span reaches it; with none,
// the nearest of the turn under the press within 4 px.
export function timelineHit(L, heads, x, lane, nowMs = Date.now(), ly = null) {
  const T = L.turns;
  if (!T.length || !Number.isFinite(x)) return null;
  const z = L.z ?? 1;
  const x0 = L.x0 ?? 0;
  const fx = (x + x0) / z;
  let lo = 0;
  let hi = T.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T[m].x <= fx) lo = m; else hi = m - 1; }
  // Past the turn as drawn into its break: the nearer turn. A turn under 2 px is drawn at least
  // 1 px wide. The press stays where it is, so a step is found only within 4 px of it.
  const end = T[lo].x + (T[lo].w * z < 2 ? Math.max(T[lo].w, 1 / z) : T[lo].w);
  if (fx > end && T[lo + 1] && T[lo + 1].x - fx < fx - end) lo++;
  const h = heads[lo];
  if (!h || h.key !== T[lo].key) return null;
  let win = nearStep(L, h, lo, x, lane, nowMs, ly);
  // In a turn 2 to 6 px wide an unfinished call's bar is 6 px wide and starts left of the turn
  // (itemBox), over the break and the turns before, by 4 px at most. So the later turns that
  // start within 4 px right of the press are looked at, no more, and one of their bars under the
  // press answers when it is drawn on top. A turn under 2 px is drawn as one span per lane from
  // its own x, so none of its bars reaches back.
  for (let j = lo + 1; j < T.length; j++) {
    const tx = T[j].x * z - x0;
    if (tx - 4 > x) break;
    if (T[j].w * z < 2 || heads[j]?.key !== T[j].key) continue;
    const o = nearStep(L, heads[j], j, x, lane, nowMs, ly);
    if (o.top && (!win.top || o.r > win.r || (o.r === win.r && o.w < win.w))) win = o;
  }
  // A turn under 2 px is drawn 1 px wide from its x, so where a turn and its break are under
  // 1 px together its span runs over the next turns' starts. So the turns before that are drawn
  // to the press are looked at too, nearest first, and one of their spans under the press
  // answers when it is drawn on top. A turn 2 px or wider ends before the next begins, so the
  // first turn before whose drawn end is left of the press ends the look: at most the turns
  // that start within 1 px left of the press, and the one that stops it. Drawn ends only grow
  // left to right (each turn starts at or past the one before's own end and is drawn at least
  // 1 px wide), so none before the stop reaches the press. On the clock a turn and its break
  // take at least 0.45 of the strip over the number of turns (timelineGeo: 0.3 and 0.15), so
  // that is at most floor(n / (0.45 * cw * z)) + 1 turns read: 9 at 5,600 turns across 1,440 px,
  // 31 at 20,000. By steps the break alone is 0.15 of it, so at most three times that.
  for (let j = lo - 1; j >= 0; j--) {
    const tw = T[j].w * z;
    if (T[j].x * z - x0 + Math.max(tw, 1) < x) break;
    if (tw >= 2 || heads[j]?.key !== T[j].key) continue;
    const o = nearStep(L, heads[j], j, x, lane, nowMs, ly);
    if (o.top && (!win.top || o.r > win.r || (o.r === win.r && o.w < win.w))) win = o;
  }
  return { turn: heads[win.ti].key, key: win.i != null ? heads[win.ti].steps[win.i].key : h.key };
}
// The timeline for a draw: the turns placed and the view laid out, each made again only when
// what it depends on changes, and the running turn's growing bars at nowMs. prev: the last
// model (or null). The places are kept for the same heads (the ledger's, by identity), width,
// scale and running room, and, but for the last turn's length, at working on or off
// (tlLastLength); the layout for the same places and view. So while a turn runs, a
// draw does only tlGrow, and the rest of the strip stays where it was. A layout made again
// takes the last one's tracks for the headings it still has (timelineLayout kept).
export function timelineModel(prev, heads, cw, scale = "clock", nowMs = Date.now(), view = null) {
  const room = roomOf(heads, scale, nowMs);
  const base = prev && prev.cw === cw && prev.scale === scale && prev.geo.room === room;
  const same = base && prev.heads === heads;
  // ledger() makes a new heads array at every change to the session, but keeps each finished
  // turn's heading. When only the last heading is new and its length on the strip is the
  // same (its room while it runs), the places hold, and only that turn is laid out again.
  const n = heads.length;
  // With no turns (an empty session, or one just cleared) there is no last heading: the strip is
  // empty, its gutter and lanes drawn with no bar, number or tick (geoGen, layoutGen).
  const wall = room > 0 ? room : n ? wallOf(heads[n - 1]) : 0;
  const only = !same && scale === "clock" && prev && prev.cw === cw && prev.scale === scale && lastOnly(prev.heads, heads);
  const tail = only && base && prev.geo.walls[n - 1] === wall;
  // Working on or off (the room comes or goes) with only the last heading new: only that turn's
  // length changes, so the others keep their places while its end moves TL_SLACK px or less.
  // At Fit that holds from a few hundred turns, where placing them all again costs most.
  // Working off, or on with that end moving more than TL_SLACK px, the places are kept by any
  // amount and marked the old scale's (stale): tlDraw places the turns again with the bounded
  // build over the draws after this one. So working off is exact once that build ends. The
  // running turn's room growing a step (liveRoom) is the same: only that turn's length changes.
  // A step kept unmarked moves the end TL_SLACK px or less from the places kept, not from a
  // whole placing, and the room grows TL_ROOM_GROW (1.5) times a step, so the steps kept since
  // the last whole placing add up to under three times the last (1 + 2/3 + 4/9 + ...): while a
  // turn runs its end may be under 3 TL_SLACK px off a whole placing. A session of
  // TL_BUILD_BARS steps or fewer is placed again whole here instead of marked: its whole
  // placing and layout read that many step rows at most, a few steps' work of the bounded
  // build, and on the places kept the running turn would show past the strip's end (or short
  // of it) for a frame, with a growing bar that started in the old room's last 6 px drawn
  // wholly past the end.
  const vk = view ? `${view.z}|${view.x0}` : "";
  const was = only ? prev.heads[n - 1] : null;
  const steps = only ? prev.geo.steps - Math.max(1, stepN(was)) + Math.max(1, stepN(heads[n - 1])) : 0;
  let regeo = null;
  if (only && !tail && prev.geo.room !== room && prev.vk === vk) {
    const z = prev.L.z ?? 1;
    regeo = room > 0 ? tlLastLength(prev.geo, heads, wall, room, z, was) : null;
    if (!regeo && steps > TL_BUILD_BARS) {
      regeo = tlLastLength(prev.geo, heads, wall, room, z, was, true);
      if (regeo) regeo.stale = true;
    }
  }
  const geo = same || (tail && steps === prev.geo.steps) ? prev.geo : tail ? { ...prev.geo, steps } : (regeo ?? timelineGeo(heads, cw, scale, nowMs));
  const L = same && prev.vk === vk ? prev.L : (tail || regeo) && prev.vk === vk ? tlTail(prev.L, heads, was, geo) : timelineLayout(heads, cw, scale, nowMs, view, geo, null, prev?.L?.tracks ?? null);
  return { heads, cw, scale, geo, vk, L, nowMs, grow: tlGrow(L, nowMs) };
}
// One draw's model, and the build it leaves for the next draw: { M, J, wait }. M: the model
// the last draw showed (null for none); J: a build in progress (tlBuildStart), or null; until
// and clock: tlBuildGo's bound. From nothing the build goes on until clock() reaches until,
// and with no model yet the strip waits (wait). A model whose places are the old scale's
// (geo.stale: timelineModel, working on or off) starts the build, whose first step is the
// next draw's. While it runs, a draw takes steps of it and shows the model it had, kept to
// the heads of that draw, so a press or a selection acts on the strip drawn. A width change
// starts the build again at the new width, the old strip shown meanwhile. Once the build
// ends its model is the strip, taken up by timelineModel for the heads of that draw.
export function tlDraw(M, J, heads, cw, nowMs, until, clock) {
  const start = () => tlBuildStart(heads, cw, "clock", nowMs, null);
  if (!M) {
    const j = J && J.cw === cw ? J : start();
    const done = tlBuildGo(j, until, clock);
    if (!done) return { M: null, J: j, wait: true };
    // Its heads are those it began with: taken up below for the heads of this draw.
    M = done;
  } else if (J) {
    // The strip shown while the build runs: the last draw's, at its own width, kept to heads.
    const keep = () => timelineModel(M, heads, M.cw, "clock", nowMs, null);
    if (J.cw !== cw) return { M: keep(), J: start(), wait: false };
    const done = tlBuildGo(J, until, clock);
    if (!done) {
      const K = keep();
      // Placed again whole for heads of a new shape (a new turn): the build is not needed.
      return { M: K, J: K.geo.stale || K.cw !== cw ? J : null, wait: false };
    }
    M = done;
  }
  const N = timelineModel(M, heads, cw, "clock", nowMs, null);
  return { M: N, J: N.geo.stale ? start() : null, wait: false };
}
// Whether b is a with only its last heading new (the same turn): every other heading the same
// object, checked from the end, where a change shows first.
function lastOnly(a, b) {
  const n = b.length;
  if (!a || a.length !== n || !n || a[n - 1].key !== b[n - 1].key) return false;
  for (let i = n - 2; i >= 0; i--) if (a[i] !== b[i]) return false;
  return true;
}
