// agent-threads: the loading chart's geometry (main.js loadChart), pure, tested under bun.
// From the session's bounded series (core/burn.js): stacked areas of tokens per hour by
// model, or bars of prompts for an agent whose log has no token counts (Cursor); the time
// axis from the first event to the file's last write, filled to the point read so far;
// idle gaps folded, each with a mark; the scale's top rounded up to 1, 2 or 5 times a power
// of ten, so it steps a few times in a read at most; and the legend.
import { BURN, burnAt, burnReal } from "./core/burn.js";
import { fmtTime } from "./core/turns.js";
import { dayKey, dayLabel } from "./ui.js";

export const CHART = Object.freeze({ H: 72, PTS: 120, PT_PX: 3, BAR_PX: 4, FOLD_PX: 7, FOLD_SHARE: 0.25, MARK_PX: 4, HOUR_GAP: 80, LABEL_PX: 10.5 });

// The scale's top: v rounded up to 1, 2 or 5 times a power of ten; null for none.
export function niceTop(v) {
  if (!(v > 0)) return null;
  const e = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * e).find((x) => x >= v * (1 - 1e-9));
}

// "5M", "200k", "50": a scale top in the pane's units for tokens.
export function fmtTop(n) {
  const f = (x, u) => `${+x.toPrecision(3)}${u}`;
  return n >= 1e9 ? f(n / 1e9, "B") : n >= 1e6 ? f(n / 1e6, "M") : n >= 1e3 ? f(n / 1e3, "k") : String(+n.toPrecision(3));
}

// A bar's time: "75 s", "10 min", "2 h", "1 h 20 min".
export function fmtPer(ms) {
  const min = ms / 60000;
  if (min < 1 || !Number.isInteger(min)) return `${Math.round(ms / 1000)} s`;
  if (min < 60) return `${min} min`;
  return min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`;
}

// A whole hour as the axis names it: "12 PM", with a no-break space as fmtTime has.
const hourText = (t) => { const h = new Date(t).getHours(); return `${h % 12 || 12}\u00a0${h < 12 ? "AM" : "PM"}`; };

// A label's width at the axis's size, roughly (figures and letters alike).
const textW = (s) => s.length * CHART.LABEL_PX * 0.55;

// The chart for a session's series b in a w x h box. end: the file's last write (ms) or null;
// loaded: read to its end; prompts: the agent records no tokens; agent: its name, for the
// note. Everything is in px of the box, rounded to tenths.
export function chartModel(b, { w, h = CHART.H, end = null, loaded = false, prompts = false, agent = "", now = Date.now() } = {}) {
  const kind = prompts ? "prompts" : "tokens";
  const out = { kind, title: prompts ? "Prompts over time" : "Tokens over time", top: "", areas: [], bars: [], readX: null, base: w, folds: [], labels: [], legend: [], more: 0, note: prompts ? `${agent || "This agent"}'s log has no token counts` : "" };
  const slots = prompts ? [BURN.PROMPTS] : [0, 1, 2, 3, 4, BURN.OTHER].filter((k) => b?.tot[k] > 0);
  if (!b || b.t0 == null || !slots.length || !(w > 0)) {
    out.legend = prompts ? [{ slot: BURN.PROMPTS, name: "prompts", share: "" }] : [];
    return out;
  }
  const r = (x) => Math.round(x * 10) / 10;
  // The axis: the part read, then the time to the file's last write still to read (an idle
  // end of a session read whole is left off, as a fold would cut it).
  const vRead = b.v;
  const tail = end > b.last && !(loaded && end - b.last > BURN.FOLD) ? end - b.last : 0;
  const L = Math.max(vRead + tail, b.w);
  const folds = [];
  for (let k = 0; k < b.folds.length; k += 2) folds.push(b.folds[k]);
  const G = folds.length ? Math.min(CHART.FOLD_PX, (w * CHART.FOLD_SHARE) / folds.length) : 0;
  const sx = (w - G * folds.length) / L;
  const X = (v) => { let n = 0; for (const f of folds) if (f <= v) n++; return v * sx + G * n; };
  // Buckets drawn together, so a point (or a bar) is never narrower than its few px.
  let k = 1;
  const minPx = prompts ? CHART.BAR_PX : CHART.PT_PX;
  while (k < BURN.N && (k * b.w * sx < minPx || Math.ceil(b.n / k) > CHART.PTS)) k *= 2;
  const groups = Math.ceil(b.n / k);
  const sum = (g, slot) => { let x = 0; for (let i = g * k; i < Math.min(b.n, (g + 1) * k); i++) x += b.data[i * BURN.COLS + slot]; return x; };
  if (!loaded) { out.readX = r(X(vRead)); out.base = out.readX; }
  if (prompts) {
    const counts = Array.from({ length: groups }, (_, g) => sum(g, BURN.PROMPTS));
    const top = niceTop(Math.max(...counts));
    if (!top) return out;
    counts.forEach((c, g) => {
      if (!c) return;
      const v0 = g * k * b.w;
      const x = X(v0);
      // A bar ends short of the read edge while the read goes, and of a fold's gap within it.
      let end = x + k * b.w * sx - 1;
      if (!loaded) end = Math.min(end, X(vRead));
      for (const f of folds) if (f > v0 && f <= v0 + k * b.w) { end = Math.min(end, X(f) - G); break; }
      const bw = Math.min(Math.max(1, k * b.w * sx - 1.5), end - x - 0.5);
      if (bw > 0) out.bars.push({ x: r(x + 0.5), w: r(bw), h: r((c / top) * h) });
    });
    // No bar with any width yet (one prompt at the read edge): no scale over nothing, as
    // before the first prompt (the title, the legend and the note).
    if (!out.bars.length) {
      out.legend = [{ slot: BURN.PROMPTS, name: "prompts", share: "" }];
      return out;
    }
    out.top = `top ${top} per ${fmtPer(k * b.w)}`;
  } else {
    // Points: each group's tokens per hour at its middle (the first at the axis's start, the
    // last at the read point), and a drop to nothing on each side of every fold.
    const perH = 3600000 / (k * b.w);
    const pts = [];
    for (let g = 0; g < groups; g++) {
      const vals = slots.map((s) => sum(g, s) * perH);
      pts.push({ x: X(g === 0 ? 0 : Math.min(vRead, (g * k + k / 2) * b.w)), vals });
    }
    const last = pts.at(-1);
    if (X(vRead) > last.x) pts.push({ x: X(vRead), vals: last.vals });
    // Everything at one instant (the first count of a read): read whole, it is one bucket wide;
    // while the read goes there is no width to the left of the read edge, so nothing is drawn
    // (no scale, no legend) until a second point.
    if (pts.length === 1) {
      if (!loaded) return out;
      pts.push({ x: X(b.w), vals: last.vals });
    }
    for (const f of folds) {
      if (f > vRead || f <= 0) continue;
      const x1 = X(f) - G;
      pts.push({ x: x1, vals: null }, { x: x1 + G, vals: null });
    }
    // At one x, a fold's drop comes before a point: the first count after a fold sits on the
    // fold, and the area rises from the baseline there instead of falling back to it.
    pts.sort((a, c) => a.x - c.x || (a.vals ? 1 : 0) - (c.vals ? 1 : 0));
    let peak = 0;
    for (const p of pts) if (p.vals) peak = Math.max(peak, p.vals.reduce((a, c) => a + c, 0));
    const top = niceTop(peak);
    if (!top) return out;
    out.top = `top ${fmtTop(top)}/h`;
    const cum = pts.map(() => 0);
    const Y = (v) => r(h - (Math.min(v, top) / top) * h);
    slots.forEach((slot, j) => {
      const below = cum.slice();
      pts.forEach((p, i) => { cum[i] += p.vals ? p.vals[j] : 0; });
      const fill = [];
      for (let i = 0; i < pts.length; i++) fill.push(r(pts[i].x), Y(cum[i]));
      if (j === 0) fill.push(r(pts.at(-1).x), h, r(pts[0].x), h);
      else for (let i = pts.length - 1; i >= 0; i--) fill.push(r(pts[i].x), Y(below[i]));
      // The top edge, broken where it lies on the baseline.
      const line = [];
      let seg = null;
      for (let i = 0; i < pts.length; i++) {
        if (i > 0 && !cum[i] && !cum[i - 1]) { seg = null; continue; }
        if (!seg) line.push((seg = []));
        seg.push(r(pts[i].x), Y(cum[i]));
      }
      // n: the points on its top edge, which come first in fill.
      out.areas.push({ slot, fill, n: pts.length, line: line.filter((s) => s.length >= 4) });
    });
  }
  if (G >= CHART.MARK_PX) for (const f of folds) if (f <= vRead && f > 0) out.folds.push(r(X(f) - G / 2));
  out.labels = axisLabels(b, { w, X, L, now });
  out.legend = legendOf(b, slots, prompts, w, out);
  return out;
}

// The axis's words: the start at the left and the end at the right; between them the hours
// (a day or so) or the days (longer), each where it falls, left out where it would crowd.
function axisLabels(b, { w, X, L, now }) {
  const t1 = burnReal(b, L);
  const days = t1 - b.t0 > 30 * 3600000;
  const left = days ? dayLabel(b.t0, now) : `${dayLabel(b.t0, now)} ${fmtTime(b.t0)}`;
  const right = days ? dayLabel(t1, now) : dayKey(t1) === dayKey(b.t0) ? fmtTime(t1) : `${dayLabel(t1, now)} ${fmtTime(t1)}`;
  const from = textW(left) + 16;
  const to = w - textW(right) - 16;
  const marks = [];
  if (days) {
    // Each day where its work starts: its midnight, or the first point after a fold when the
    // midnight falls in the folded time.
    const d = new Date(b.t0);
    d.setHours(24, 0, 0, 0);
    for (let t = d.getTime(); t < t1; ) {
      let v = burnAt(b, t);
      let at = t;
      if (v == null) {
        for (let k = 0; k < b.folds.length; k += 2) if (b.folds[k + 1] >= t) { v = b.folds[k]; at = b.folds[k + 1]; break; }
      }
      if (v != null && dayKey(at) !== dayKey(t1) && !marks.some((m) => m.key === dayKey(at))) marks.push({ x: X(v), text: String(new Date(at).getDate()), key: dayKey(at) });
      const n = new Date(Math.max(at, t));
      n.setHours(24, 0, 0, 0);
      t = n.getTime();
    }
  } else {
    // Whole hours, the fewest steps that leave room between them.
    for (const step of [1, 2, 3, 4, 6, 12]) {
      if ((step * 3600000 * (w / Math.max(1, L))) < CHART.HOUR_GAP) continue;
      const d = new Date(b.t0);
      d.setMinutes(0, 0, 0);
      for (let t = d.getTime() + 3600000; t < t1; t += 3600000) {
        if (new Date(t).getHours() % step) continue;
        const v = burnAt(b, t);
        if (v != null) marks.push({ x: X(v), text: hourText(t) });
      }
      break;
    }
  }
  const out = [{ x: 0, text: left }];
  let edge = from;
  for (const m of marks) {
    if (m.x < edge || m.x + textW(m.text) > to) continue;
    out.push({ x: Math.round(m.x * 10) / 10, text: m.text });
    edge = m.x + textW(m.text) + 12;
  }
  out.push({ right: true, text: right });
  return out;
}

// The legend: each model in order of first use, its share of the tokens when two or three
// show; what does not fit at this width is counted as "+n".
function legendOf(b, slots, prompts, w, out) {
  if (prompts) return [{ slot: BURN.PROMPTS, name: "prompts", share: "" }];
  const all = slots.reduce((a, s) => a + b.tot[s], 0);
  const shares = slots.length >= 2 && slots.length <= 3;
  const items = slots.map((s) => ({ slot: s, name: s === BURN.OTHER ? "other" : b.models[s] || "tokens", share: shares ? `${Math.round((b.tot[s] * 100) / all)}%` : "" }));
  const itemW = (it) => 13 + it.name.length * 5.9 + (it.share ? 5 + it.share.length * 6.2 : 0);
  const fit = [];
  let used = 0;
  for (let i = 0; i < items.length; i++) {
    const need = (i ? 14 : 0) + itemW(items[i]);
    if (used + need > w - (i < items.length - 1 ? 34 : 0)) break;
    used += need;
    fit.push(items[i]);
  }
  out.more = items.length - fit.length;
  return fit;
}
