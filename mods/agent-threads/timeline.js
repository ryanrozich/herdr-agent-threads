// agent-threads: the Trajectory's timeline as data (TRD-23). Pure JavaScript with no Herdr
// imports, tested under bun (test/timeline.test.js); main.js draws what this returns.
// Carried from draft 107 (ledger.js there). The steps it reads are each heading's turn's rows
// (h.rows, heading first, made by ledger.js ledgerTurn): a step's times and flags are its
// row's, and the tracks are worked out here, in the layout pass, only for a turn drawn wide
// enough for its bars (tlTracks). The ledger keeps no array and no number per step for it.

import { durText, startText, LEDGER_KINDS, spanKeys, TL_TRACK, TL_OPEN, TL_FAILED } from "./ledger.js";

// A heading's step count, and its i-th step's row: the turn's rows after the heading.
export const tlLen = (h) => Math.max(0, (h?.rows?.length ?? 1) - 1);
export const tlRow = (h, i) => (i >= 0 && i < tlLen(h) ? h.rows[i + 1] : undefined);
const stepN = tlLen;
// How many times the turns were placed (timelineGeo), laid out (timelineLayout) and a turn's
// tracks worked out (tlTracks) since the module loaded, for the tests and the debug report.
export const TL_MADE = { geo: 0, layout: 0, tracks: 0 };
// A step's start and end from its row, ms from the turn's start (NaN for none: an instant has
// no end), and its flags: TL_TRACK (in the Tools lane it started while another call ran, drawn
// half height), TL_OPEN (a call with no result yet) and TL_FAILED.
const rowA = (r) => r.start ?? Number.NaN;
const rowB = (r) => (r.start != null && r.dur != null ? r.start + r.dur : Number.NaN);
const rowF = (r, track) => (track ? TL_TRACK : 0) | (r.open ? TL_OPEN : 0) | (r.failed ? TL_FAILED : 0);
// A turn's tracks: null when no step is on the second track, else one number a step, 1 for a
// call in the Tools lane that started while another ran. A call with no result holds the
// first track to the turn's end; one that starts as the last ends stays on the first.
export function tlTracks(h) {
  TL_MADE.tracks++;
  const n = stepN(h);
  let out = null;
  let end0 = -Infinity;
  for (let i = 0; i < n; i++) {
    const r = h.rows[i + 1];
    const a = r.start;
    if (a == null || LEDGER_KINDS[r.lk]?.lane !== "tools") continue;
    if (a < end0) {
      if (!out) out = new Array(n).fill(0);
      out[i] = 1;
      continue;
    }
    end0 = r.open ? Infinity : r.dur != null ? a + r.dur : a;
  }
  return out;
}
// Step i's box from its row (itemBox), on track (0 or 1).
function stepBox(h, i, track, tx, w, wall, scale, len, upTo = null) {
  const r = h.rows[i + 1];
  return itemBox(rowA(r), rowB(r), rowF(r, track), i, tx, w, wall, scale, len, upTo);
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
// the same width. heads are the ledger's headings in order (each carries its turn's rows,
// from ledgerTurn).
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
export function timelineGeo(heads, cw, scale = "clock", nowMs = Date.now()) {
  TL_MADE.geo++;
  const n = heads.length;
  const geo = { cw, scale, turns: [], index: new Map(), walls: [], gap: 0, total: 0, steps: 0, live: -1, room: 0 };
  if (!n || !(cw > 0)) return geo;
  const GAP = cw < 700 ? 14 : 30;
  const MIN = cw < 700 ? 30 : 48;
  const gap = n > 1 ? Math.min(GAP, (0.15 * cw) / (n - 1)) : 0;
  const min = Math.min(MIN, (0.3 * cw) / n);
  const target = Math.max(1, cw - gap * (n - 1));
  const walls = heads.map(wallOf);
  const room = roomOf(heads, scale, nowMs);
  if (room > 0) { walls[n - 1] = room; geo.live = n - 1; geo.room = room; }
  for (const h of heads) geo.steps += Math.max(1, stepN(h));
  let widths;
  if (scale === "steps") {
    const sw = target / geo.steps;
    widths = heads.map((h) => Math.max(1, stepN(h)) * sw);
  } else {
    // The px per ms that fills the strip, each turn at least min wide: the turns held at min
    // and the px per ms for the rest found in turn until neither moves (a few passes; the
    // held set only grows as m falls). n * min is at most 30% of the strip, so it fits.
    let m = 0;
    let all = 0;
    for (const w of walls) all += w;
    if (all > 0) {
      m = target / all;
      for (let k = 0; k < 12; k++) {
        let held = 0;
        let rest = 0;
        for (const w of walls) { if (w * m < min) held++; else rest += w; }
        const next = rest > 0 ? Math.max(0, target - held * min) / rest : 0;
        if (Math.abs(next - m) <= m * 1e-9) { m = next; break; }
        m = next;
      }
    }
    widths = walls.map((w) => Math.max(min, w * m));
    // No turn has a length: each gets an even share.
    if (!(all > 0)) widths = walls.map(() => target / n);
  }
  let x = 0;
  heads.forEach((h, ti) => {
    geo.turns.push({ x, w: widths[ti], key: h.key, n: h.n });
    geo.index.set(h.key, ti);
    x += widths[ti] + (ti < n - 1 ? gap : 0);
  });
  geo.walls = walls;
  geo.gap = gap;
  geo.total = x;
  return geo;
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
      // Where a bar starts does not depend on its track.
      const bx = stepBox(h, i, 0, T[ti].x * z - x0, T[ti].w * z, wall, L.scale, len);
      if (!bx || bx.x0 < lo || bx.x0 > hi) continue;
      if (a == null) a = h.rows[i + 1].key;
      b = h.rows[i + 1].key;
    }
  }
  return a == null ? null : { a, b };
}
// range: the focus range as { ia, ib, pos } (the first and last row's place in the ledger's
// rows, and every row's place): bars outside it get their own spans, with "|o" on the key.
// The running turn's unfinished bars are not spans: each is in out.grow ({ k, x0, tx, w, wall,
// t0 }), whose right end tlGrow finds at a given time, so a layout holds while the turn runs.
// out.tracks: the tracks (tlTracks) of each turn this layout draws as bars on the clock, by
// heading, and of no other; kept: the last layout's, whose entries are taken for the same
// heading (a finished turn keeps its heading when the ledger is built again), so a finished
// turn's tracks are worked out once while it stays drawn.
export function timelineLayout(heads, cw, scale = "clock", nowMs = Date.now(), view = null, geo = null, range = null, kept = null) {
  TL_MADE.layout++;
  const G = geo ?? timelineGeo(heads, cw, scale, nowMs);
  const { z, x0 } = tlClamp(G, view);
  const out = { cw, scale, z, x0, geo: G, turns: G.turns, index: G.index, total: G.total, zmax: tlMaxZoom(G), gaps: [], spans: new Map(), labels: [], ticks: [], fails: [], grow: [], tracks: new Map(), from: 0, to: -1 };
  const n = G.turns.length;
  if (!n) return out;
  const walls = G.walls;
  // Spans by lane, ink and track: "tools|failed|0" -> [[x0, x1]], joined where they touch. A
  // span whose right end is an unfinished call's is [x0, x1, 1]: drawn with its torn end.
  const add = (k, a, b, torn = false) => {
    let list = out.spans.get(k);
    if (!list) { list = []; out.spans.set(k, list); }
    const last = list[list.length - 1];
    if (last && a <= last[1] + 0.5) {
      if (b > last[1]) { last[1] = b; if (torn) last[2] = 1; else last.length = 2; }
      else if (torn && b === last[1]) last[2] = 1;
      return;
    }
    list.push(torn ? [a, b, 1] : [a, b]);
  };
  // The turns in view, and a margin: the first found by halving, since turns are in order.
  const M = 40;
  const left = (x0 - M) / z;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; const t = G.turns[m]; if (t.x + t.w + G.gap < left) lo = m + 1; else hi = m; }
  out.from = lo;
  let labelEnd = -Infinity;
  let failEnd = -Infinity;
  for (let ti = lo; ti < n; ti++) {
    const t = G.turns[ti];
    const x = t.x * z - x0;
    if (x > cw + M) break;
    out.to = ti;
    const h = heads[ti];
    const w = t.w * z;
    // The number at the turn's start, or at the strip's left edge while the turn runs past it.
    const lx = Math.max(x, Math.min(0, x + w - 24));
    if (x + w - lx >= 24 && lx >= labelEnd) {
      out.labels.push({ x: lx, w: x + w - lx, text: `${h.n}`, total: x + w - lx >= 120 ? (h.going ? "running" : durText(walls[ti]) || null) : null });
      labelEnd = lx + Math.max(24, Math.min(x + w - lx, 120));
    }
    if (w < 2) {
      const c = h.cnt ?? {};
      const x1 = x + Math.max(w, 1);
      // A turn too narrow for its steps is inside the range when any of its rows is.
      const ih = range ? range.pos.get(h.key) : null;
      const o = range && !(ih != null && ih <= range.ib && ih + stepN(h) >= range.ia) ? "|o" : "";
      if (c.input) add(`${c.user ? "input|user|0" : c.agent ? "input|agent|0" : "input|context|0"}${o}`, x, x1);
      if (c.model) add(`model|model|0${o}`, x, x1);
      if (c.tools) add(`${c.failed ? "tools|failed|0" : "tools|tools|0"}${o}`, x, x1);
      if (c.failed && x >= failEnd) { out.fails.push(x + w / 2); failEnd = x + 6; }
    } else {
      const live = ti === G.live;
      const len = stepN(h);
      let tk = null;
      if (scale !== "steps") {
        tk = kept?.get(h);
        if (tk === undefined) tk = tlTracks(h);
        out.tracks.set(h, tk);
      }
      for (let i = 0; i < len; i++) {
        const r = h.rows[i + 1];
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
        add(range && !(ip != null && ip >= range.ia && ip <= range.ib) ? `${k}|o` : k, b.x0, b.x1, Boolean(b.open));
        if (r.failed && b.x0 >= failEnd) { out.fails.push((b.x0 + b.x1) / 2); failEnd = b.x0 + 6; }
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
  }
  return out;
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
// The turn and step under px x of the strip in a lane: { turn, key } (key: the step's row,
// or the turn's heading when no step's bar is within 4 px). heads in the layout's order; x in
// px of the view (zoomed and panned).
export function timelineHit(L, heads, x, lane, nowMs = Date.now()) {
  const T = L.turns;
  if (!T.length || !Number.isFinite(x)) return null;
  const z = L.z ?? 1;
  const x0 = L.x0 ?? 0;
  const fx = (x + x0) / z;
  let lo = 0;
  let hi = T.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T[m].x <= fx) lo = m; else hi = m - 1; }
  const t = T[lo];
  const h = heads[lo];
  if (!h || h.key !== t.key) return null;
  // Past the turn into its break: the nearer turn.
  if (fx > t.x + t.w && T[lo + 1] && T[lo + 1].x - fx < fx - (t.x + t.w)) return timelineHit(L, heads, T[lo + 1].x * z - x0, lane, nowMs);
  const wall = L.geo?.walls[lo] ?? wallOf(h);
  const tx = t.x * z - x0;
  const tw = t.w * z;
  // The running turn's unfinished bars end at now, not at its room's end.
  const upTo = lo === L.geo?.live && h.t0 != null ? growEnd(tx, tw, wall, h.t0, nowMs) : null;
  // The tracks the layout worked out for this turn; a turn it did not draw as bars, here.
  const tk = L.tracks?.has(h) ? L.tracks.get(h) : L.scale === "steps" ? null : tlTracks(h);
  let best = null;
  let bestD = 4;
  const len = stepN(h);
  for (let i = 0; i < len; i++) {
    if (lane && LEDGER_KINDS[h.rows[i + 1].lk]?.lane !== lane) continue;
    const b = stepBox(h, i, tk?.[i], tx, tw, wall, L.scale, len, upTo);
    if (!b) continue;
    const d = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
    if (d < bestD || (d === 0 && bestD === 0 && b.track === 1)) { best = i; bestD = d; }
  }
  return { turn: h.key, key: best != null ? h.rows[best + 1].key : h.key };
}
// The timeline for a draw: the turns placed and the view laid out, each made again only when
// what it depends on changes, and the running turn's growing bars at nowMs. prev: the last
// model (or null). The places are kept for the same heads (the ledger's, by identity), width,
// scale and running room; the layout for the same places and view. So while a turn runs, a
// draw does only tlGrow, and the rest of the strip stays where it was. A layout made again
// takes the last one's tracks for the headings it still has (timelineLayout kept).
export function timelineModel(prev, heads, cw, scale = "clock", nowMs = Date.now(), view = null) {
  const room = roomOf(heads, scale, nowMs);
  const same = prev && prev.heads === heads && prev.cw === cw && prev.scale === scale && prev.geo.room === room;
  const geo = same ? prev.geo : timelineGeo(heads, cw, scale, nowMs);
  const vk = view ? `${view.z}|${view.x0}` : "";
  const L = same && prev.vk === vk ? prev.L : timelineLayout(heads, cw, scale, nowMs, view, geo, null, prev?.L?.tracks ?? null);
  return { heads, cw, scale, geo, vk, L, grow: tlGrow(L, nowMs) };
}
