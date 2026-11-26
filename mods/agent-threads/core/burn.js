// agent-threads: the loading chart's data, tokens over the session's time by model (and the
// prompts, for an agent whose log has no token counts). Plain JavaScript with no Herdr imports.
//
// Bounded, whatever the session's size: BURN.N fixed time buckets, each holding BURN.COLS
// numbers (five model slots in order of first use, "other" for the sixth model on, and the
// prompts typed), filled as turns.js applies each event. When time runs past the last bucket,
// pairs merge and the bucket width doubles, so the series never grows. Nothing here keeps a
// turn or an event.
//
// Idle time folds: a gap over BURN.FOLD between two events the chart takes is cut out of the
// chart's own clock (v, in ms of active time), and the point is kept (folds), so the axis can
// still name the real time of any point. Up to BURN.FOLDS folds; a gap past them stays in.
export const BURN = Object.freeze({ N: 256, MODELS: 5, COLS: 7, OTHER: 5, PROMPTS: 6, W0: 75000, FOLD: 2 * 3600000, FOLDS: 64 });

export function newBurn() {
  return {
    // The first and the newest time taken (ms), the newest's place on the chart's clock, and
    // the width of one bucket on it.
    t0: null, last: null, v: 0, w: BURN.W0,
    // Buckets in use, and the folds as pairs: [v, real time of the first event after the gap].
    n: 0, folds: [],
    // Model names (short) by slot, in order of first use, and each column's total.
    models: [], tot: [0, 0, 0, 0, 0, 0, 0],
    data: new Float32Array(BURN.N * BURN.COLS),
    // Bumped on every change, for the drawing's memo.
    ver: 0,
  };
}

// A copy, for the read that takes the tail again (OpenCode: turns.js settle and rewindTail).
// into: an earlier copy to write over, so a settle each chunk makes no new array.
export function burnCopy(b, into = null) {
  if (!b) return null;
  const c = into ?? newBurn();
  c.t0 = b.t0; c.last = b.last; c.v = b.v; c.w = b.w; c.n = b.n;
  c.folds = b.folds.slice(); c.models = b.models.slice(); c.tot = b.tot.slice();
  c.data.set(b.data);
  c.ver = b.ver + 1;
  return c;
}

// Merges each pair of buckets and doubles the width.
function coarsen(b) {
  const { N, COLS } = BURN;
  const d = b.data;
  for (let i = 0; i < N / 2; i++) for (let c = 0; c < COLS; c++) d[i * COLS + c] = d[2 * i * COLS + c] + d[(2 * i + 1) * COLS + c];
  d.fill(0, (N / 2) * COLS);
  b.w *= 2;
  b.n = Math.ceil(b.n / 2);
}

// The bucket for an event at time t (ms), moving the chart's clock on. An event older than
// the newest (out of order) goes back on the clock as far as its age, but not past the
// newest fold.
function place(b, t) {
  if (b.t0 == null) { b.t0 = t; b.last = t; }
  else if (t > b.last) {
    const gap = t - b.last;
    if (gap > BURN.FOLD && b.folds.length < 2 * BURN.FOLDS) {
      // The gap is cut, and what comes after it starts a bucket of its own.
      b.v = Math.ceil(b.v / b.w) * b.w;
      if (b.v >= b.w * BURN.N) coarsen(b);
      b.folds.push(b.v, t);
    } else b.v += gap;
    b.last = t;
  }
  const floor = b.folds.length ? b.folds[b.folds.length - 2] : 0;
  const v = t >= b.last ? b.v : Math.max(floor, b.v - (b.last - t));
  while (v >= b.w * BURN.N) coarsen(b);
  const i = Math.floor(v / b.w);
  if (i + 1 > b.n) b.n = i + 1;
  return i;
}

function slotOf(b, model) {
  const name = model ?? "";
  const i = b.models.indexOf(name);
  if (i >= 0) return i;
  if (b.models.length < BURN.MODELS) return b.models.push(name) - 1;
  return BURN.OTHER;
}

// Tokens (new input, cache writes and output, as "So far" counts them) a model used at time t.
// A negative amount (a count given again, lower) takes back what it can from that bucket.
export function burnTokens(b, t, model, amount) {
  if (!(Number.isFinite(t) && Number.isFinite(amount)) || amount === 0) return;
  const i = place(b, t);
  const k = i * BURN.COLS + slotOf(b, model);
  const was = b.data[k];
  b.data[k] = Math.max(0, was + amount);
  b.tot[k % BURN.COLS] += b.data[k] - was;
  b.ver++;
}

// A prompt a person typed at time t.
export function burnPrompt(b, t) {
  if (!Number.isFinite(t)) return;
  const i = place(b, t);
  b.data[i * BURN.COLS + BURN.PROMPTS] += 1;
  b.tot[BURN.PROMPTS] += 1;
  b.ver++;
}

// The real time at a place on the chart's clock.
export function burnReal(b, v) {
  let base = b.t0;
  let at = 0;
  for (let k = 0; k < b.folds.length; k += 2) {
    if (b.folds[k] > v) break;
    at = b.folds[k];
    base = b.folds[k + 1];
  }
  return base + (v - at);
}

// The place on the chart's clock of a real time, or null when it falls in a folded gap.
export function burnAt(b, t) {
  let base = b.t0;
  let at = 0;
  for (let k = 0; k <= b.folds.length; k += 2) {
    const next = k < b.folds.length ? b.folds[k] : Infinity;
    if (t < base) return null;
    if (t - base <= next - at) return at + (t - base);
    at = next;
    base = b.folds[k + 1];
  }
  return null;
}

// What a session's chart has taken: turns.js calls these as it applies events.
export function sessionTokens(s, t, model, amount) { burnTokens((s.burn ??= newBurn()), t, model, amount); }
export function sessionPrompt(s, t) { burnPrompt((s.burn ??= newBurn()), t); }
