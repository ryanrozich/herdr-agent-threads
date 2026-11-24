// bun test: the shaping pass's budget (280): a turn whose expected cost would take a draw past
// its shaping time waits for the next draw, unless it is the draw's first; a turn left for its
// cost ends the pass that met it; and the rate it expects is learned from long turns. On the
// render harness (test/render-harness.js). Moved whole from render.test.js.
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixture, H, pane, setup } from "./render-harness.js";

setup();

// Runs f with performance.now held, and v.reshape taking msPerChar ms a character of its turn
// (prompt and reply, as shapeLearn counts them) on that clock: a reshape of known cost,
// whatever the machine is doing meanwhile. The clock and v.reshape are put back after.
function reshapeAt(v, msPerChar, f) {
  const real = globalThis.performance.now;
  const own = Object.hasOwn(v, "reshape");
  const reshape = v.reshape;
  let clk = 1e6;
  globalThis.performance.now = () => clk;
  v.reshape = function (turn, live, q, P, why, text) {
    const out = reshape.call(this, turn, live, q, P, why, text);
    clk += (turn.prompt.length + (text?.length ?? 0)) * msPerChar;
    return out;
  };
  try { return f(); } finally {
    globalThis.performance.now = real;
    if (own) v.reshape = reshape;
    else delete v.reshape;
  }
}

test("shaping: a turn whose expected cost would take the draw past its shaping time waits for the next draw, unless it is the draw's first", async () => {
  const { v } = await pane(fixture("--extra", "3"));
  const t = v.current().turns.at(-1);
  // A pasted prompt of 20,000 characters, at 1 µs a character: 20 ms expected.
  t.prompt = "kaz vel orin tam ".repeat(1250);
  v.shapeBudget = 12;
  v.shapeRate = 1e-3;
  const again = () => { v.sendersVer = (v.sendersVer ?? 0) + 1; v.shapeStale = false; };
  try {
    // 5 ms spent: 5 + 20 is past 12, so it keeps the shape it had and is left for the next draw.
    again();
    const before = t.shapeMemo;
    v.shapeSpent = 5;
    v.shapeLeft = 0;
    expect(v.shape(t)).toBe(before);
    expect([v.shapeLeft, v.shapeStale]).toEqual([1, true]);
    // The draw's first turn is shaped whatever it is expected to cost.
    again();
    v.shapeSpent = 0;
    v.shapeLeft = 0;
    // Its reshape takes 0.1 µs a character on a held clock (reshapeAt), so what it teaches is
    // known however long the reshape really took.
    const sh = reshapeAt(v, 1e-4, () => v.shape(t));
    expect(v.shapeStale).toBe(false);
    expect(v.shapeLeft).toBe(0);
    expect(sh).not.toBe(before);
    // Shaping it taught the rate: under 1 µs a character, so it fell by a tenth.
    expect(v.shapeRate).toBeCloseTo(0.9e-3, 12);
    // At 1 µs a character the rate holds; past it, the rate rises to what the reshape took.
    again();
    v.shapeSpent = 0;
    v.shapeRate = 1e-3;
    reshapeAt(v, 1e-3, () => v.shape(t));
    expect(v.shapeRate).toBeCloseTo(1e-3, 12);
    again();
    v.shapeSpent = 0;
    reshapeAt(v, 2e-3, () => v.shape(t));
    expect(v.shapeRate).toBeCloseTo(2e-3, 12);
    // A short turn still fits: its cost is its length at the same rate.
    const short = v.current().turns[0];
    again();
    v.shapeSpent = 5;
    v.shape(short);
    expect(v.shapeStale).toBe(false);
    // Nothing learned yet: no turn is held back for its cost.
    again();
    v.shapeRate = undefined;
    v.shapeSpent = 5;
    v.shape(t);
    expect(v.shapeStale).toBe(false);
  } finally { v.shapeBudget = null; v.shapeRate = undefined; }
});

test("shaping: a turn left for its cost ends the pass that met it, so a draw never looks at every row still to reshape", async () => {
  const at = (k) => new Date(Date.UTC(2026, 9, 1, 8) + k * 60000).toISOString();
  const lines = [];
  for (let k = 0; k < 1500; k++) lines.push(
    { type: "user", uuid: `u${k}`, timestamp: at(2 * k), sessionId: "s", origin: { kind: "human" }, promptSource: "typed", message: { role: "user", content: `Turn ${k + 1}: zerb kazo quil` } },
    { type: "assistant", uuid: `a${k}`, timestamp: at(2 * k + 1), sessionId: "s", message: { id: `m${k}`, role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "The cart **total** agrees with `sum()`." }] } });
  const file = join(mkdtempSync(join(tmpdir(), "threads-cost-")), "c.jsonl");
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  const { v, cx } = await pane(file);
  v.debug = false;
  // The shaping clock counts 1 ms a reshape and nothing else, 12 ms a draw, and every turn is
  // expected to cost 1.5 ms: with 11 ms spent, a draw's 12th turn waits for its cost.
  for (const [name, ms] of [["reshape", 1], ["stepLinks", 0], ["mdHeight", 0]]) {
    const f = v[name];
    v[name] = function (...a) {
      const s0 = this.shapeSpent ?? 0;
      const t0 = performance.now();
      const r = f.apply(this, a);
      if (name === "reshape") this.shapeSpent = s0 + ms - (performance.now() - t0);
      else if ((this.shapeSpent ?? 0) !== s0) this.shapeSpent = s0 + ms;
      return r;
    };
  }
  const t = v.current().turns[700];
  v.shapeBudget = 12;
  v.shapeRate = 1.5 / (t.prompt.length + v.replyText(t).length);
  // shape() calls made by a pass's own walk (not shapeInView's), the rows it reshaped, and the
  // rows it counted as left (shapeLeft past what shapeInView counted).
  let calls = 0;
  let inView = false;
  let viewLeft = 0;
  const shape = v.shape;
  v.shape = function (...a) { if (!inView) calls++; return shape.apply(this, a); };
  const siv = v.shapeInView;
  v.shapeInView = function (...a) { inView = true; try { return siv.apply(this, a); } finally { inView = false; viewLeft = this.shapeLeft; } };
  const passes = [];
  const rs = v.reshapeStale;
  v.reshapeStale = function (...a) { const c0 = calls; const s0 = this.staleRows.length; const r = rs.apply(this, a); passes.push([calls - c0, s0 - this.staleRows.length, s0, this.shapeLeft - viewLeft, this.staleRows.length]); return r; };
  H.listWindow = (n) => ({ start: Math.max(0, n - 12), end: n });
  try {
    v.width -= 40;
    for (let k = 0; k < 400 && (v.rowJob || v.staleRows?.length || !passes.length); k++) { cx.flush(16); v.render(cx); }
    expect(v.staleRows).toEqual([]);
    expect(passes[0][2]).toBeGreaterThan(1000);
    // None was dropped: every row has its turn's shape at the new width.
    const look = v.shapeLook();
    expect(v.baseRows.filter((r) => r.kind === "turn" && !(r.shape === r.turn.shapeMemo && r.turn.shapeFast?.look === look)).length).toBe(0);
    // Each pass looks at the rows it reshapes and the one it leaves for its cost, however many
    // wait after it, and counts each row it leaves once; all drain at about 11 a draw.
    for (const [n, d, , counted, left] of passes) {
      expect(n).toBeLessThanOrEqual(d + 1);
      expect(counted).toBe(left);
    }
    expect(passes.length).toBeLessThanOrEqual(Math.ceil(passes[0][2] / 10) + 5);
  } finally { v.shapeBudget = null; v.shapeRate = undefined; H.listWindow = null; }
}, 30000);

test("shaping: scrolled up, a turn left for its cost past the rows on screen ends the pass, so a draw looks only at the rows on screen and the rows it reshapes", async () => {
  const at = (k) => new Date(Date.UTC(2026, 9, 1, 8) + k * 60000).toISOString();
  const lines = [];
  for (let k = 0; k < 1500; k++) lines.push(
    { type: "user", uuid: `u${k}`, timestamp: at(2 * k), sessionId: "s", origin: { kind: "human" }, promptSource: "typed", message: { role: "user", content: `Turn ${k + 1}: zerb kazo quil` } },
    { type: "assistant", uuid: `a${k}`, timestamp: at(2 * k + 1), sessionId: "s", message: { id: `m${k}`, role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "The cart **total** agrees with `sum()`." }] } });
  const file = join(mkdtempSync(join(tmpdir(), "threads-cost-up-")), "c.jsonl");
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  const { v, cx } = await pane(file);
  v.debug = false;
  // The clock of the test above: 1 ms a reshape, 12 ms a draw, every turn expected at 1.5 ms,
  // so a draw's 12th turn waits for its cost.
  for (const [name, ms] of [["reshape", 1], ["stepLinks", 0], ["mdHeight", 0]]) {
    const f = v[name];
    v[name] = function (...a) {
      const s0 = this.shapeSpent ?? 0;
      const t0 = performance.now();
      const r = f.apply(this, a);
      if (name === "reshape") this.shapeSpent = s0 + ms - (performance.now() - t0);
      else if ((this.shapeSpent ?? 0) !== s0) this.shapeSpent = s0 + ms;
      return r;
    };
  }
  const t = v.current().turns[700];
  v.shapeBudget = 12;
  v.shapeRate = 1.5 / (t.prompt.length + v.replyText(t).length);
  let calls = 0;
  let inView = false;
  const shape = v.shape;
  let looked = new Set();
  v.shape = function (...a) { if (!inView) { calls++; looked.add(a[0]); } return shape.apply(this, a); };
  const siv = v.shapeInView;
  v.shapeInView = function (...a) { inView = true; try { return siv.apply(this, a); } finally { inView = false; } };
  // The second turn on screen made long enough that its expected cost (about 15 ms) does not
  // fit what is left once the first turn in view is reshaped: in that draw it is left for its
  // cost among the rows drawn, and the walk still looks at the rows drawn after it.
  const big = v.rowsMemo.slice(700, 712).map((x) => x.turn).filter(Boolean)[1];
  big.prompt = `${big.prompt} ${"zerb kazo quil ".repeat(40)}`;
  // Each pass: its walk's shape() calls, the rows it took off the list, the rows on screen
  // still to reshape as it began (the walk's first rows, looked at even when left), whether
  // it walked as a reader scrolled up does, the rows drawn among them not looked at, and
  // whether big was among them and left.
  const passes = [];
  const rs = v.reshapeStale;
  v.reshapeStale = function (...a) {
    const c0 = calls;
    const s0 = this.staleRows.length;
    const near = this.follow ? null : this.nearStale(this.staleRows);
    const drawn = near?.drawn ?? 0;
    const drawnTurns = (near?.rows.slice(0, drawn) ?? []).map((i) => this.baseRows[i]?.turn).filter(Boolean);
    const up = !this.follow;
    looked = new Set();
    const r = rs.apply(this, a);
    const bi = this.baseRows.findIndex((x) => x.turn === big);
    passes.push([calls - c0, s0 - this.staleRows.length, drawn, up, s0, drawnTurns.filter((t) => !looked.has(t)).length, drawnTurns.includes(big) && this.staleRows.includes(bi)]);
    return r;
  };
  // Scrolled up to turn 700 of 1,500, away from the end.
  H.listWindow = () => ({ start: 700, end: 712 });
  try {
    v.follow = false;
    v.width -= 40;
    for (let k = 0; k < 400 && (v.rowJob || v.staleRows?.length || !passes.length); k++) { cx.flush(16); v.render(cx); }
    expect(v.staleRows).toEqual([]);
    const up = passes.filter((x) => x[3] && x[4] > 100);
    expect(up.length).toBeGreaterThan(20);
    expect(up.some((x) => x[2] > 0)).toBe(true);
    // big was left among the rows drawn, and every row drawn was looked at all the same.
    expect(up.filter((x) => x[6]).length).toBeGreaterThan(0);
    expect(up.filter((x) => x[6]).map((x) => x[5])).toEqual(up.filter((x) => x[6]).map(() => 0));
    // Every such pass looks at the rows on screen, the rows it reshapes, and the one turn past
    // them it leaves for its cost: never at the hundreds of rows still waiting after it.
    for (const [n, d, drawn] of up) expect(n).toBeLessThanOrEqual(d + drawn + 1);
    expect(passes.length).toBeLessThanOrEqual(Math.ceil(passes[0][4] / 10) + 5);
  } finally { v.shapeBudget = null; v.shapeRate = undefined; H.listWindow = null; }
}, 30000);

test("shaping: a stale turn over the budget waits while the running turn reshapes first in every draw, and is shaped in the first draw after", async () => {
  const { v, cx } = await pane(fixture("--extra", "3"));
  v.debug = false;
  const t = v.current().turns[0];
  // A pasted prompt of 20,000 characters, at 1 µs a character: 20 ms expected, past the 12.
  t.prompt = "kaz vel orin tam ".repeat(1250);
  v.shapeBudget = 12;
  v.shapeRate = 1e-3;
  v.staleRows = [v.baseIndex.get("0:1")];
  // The running turn reshaped before anything else in each draw (shapeInView), at 1 ms.
  let running = 10;
  const siv = v.shapeInView;
  v.shapeInView = function (...a) { if (running > 0) { running--; this.shapeSpent = (this.shapeSpent ?? 0) + 1; } return siv.apply(this, a); };
  const frames = [];
  try {
    for (let k = 0; k < 20 && v.staleRows.length; k++) { cx.flush(16); v.render(cx); frames.push(running); }
    expect(v.staleRows).toEqual([]);
    // Held back for the 10 draws the running turn reshaped first, then shaped in the next.
    expect(frames.length).toBe(12);
    expect(v.baseRows[v.baseIndex.get("0:1")].shape).toBe(t.shapeMemo);
    expect(t.shapeFast.p).toBe(t.prompt.length);
  } finally { v.shapeBudget = null; v.shapeRate = undefined; }
});

test("shaping: the rate is learned from long turns, rising at once and falling back by a tenth a turn", async () => {
  const { v } = await pane(fixture("--extra", "3"));
  // What the pane's own first draw taught it, forgotten.
  v.shapeRate = undefined;
  const long = { prompt: "x".repeat(16000) };
  const short = { prompt: "x".repeat(3000) };
  expect(v.shapeCost(long, "")).toBe(0);
  v.shapeLearn(short, "", 30);
  expect(v.shapeRate ?? 0).toBe(0);
  v.shapeLearn(long, "", 32);
  expect(v.shapeRate).toBeCloseTo(0.002, 9);
  expect(v.shapeCost(long, "y".repeat(4000))).toBeCloseTo(40, 6);
  v.shapeLearn(long, "", 1.6);
  expect(v.shapeRate).toBeCloseTo(0.0018, 9);
  v.shapeLearn(long, "", 48);
  expect(v.shapeRate).toBeCloseTo(0.003, 9);
});

// Shaping on a clock of its own: each reshape costs its turn's length at trueRate ms a
// character, and nothing else moves the clock. The prompts of every other turn are made 20,000
// characters long (20 ms at 1 µs a character); the rest stay short. Then every row is reshaped
// over frames (a new prompt length, as a text size or width change asks), and each frame's
// reshapes are logged in order.
async function shapingRun(trueRate, rate, budget = 12) {
  const { v, cx } = await pane(fixture("--extra", "40"));
  const turns = v.current().turns;
  turns.forEach((t, i) => { t.prompt = i % 2 === 0 ? `${"kaz vel orin tam ".repeat(1250)}${i}` : `${t.prompt} again`; });
  const real = globalThis.performance.now;
  let clk = 1e6;
  globalThis.performance.now = () => clk;
  const frames = [];
  const shaped = [];
  const reshape = v.reshape.bind(v);
  v.reshape = (turn, live, q, P, why, text) => {
    const cost = (turn.prompt.length + (text?.length ?? 0)) * trueRate;
    frames.at(-1)?.push(cost);
    shaped.push(turns.indexOf(turn));
    const out = reshape(turn, live, q, P, why, text);
    clk += cost;
    return out;
  };
  try {
    v.shapeBudget = budget;
    v.shapeRate = rate;
    v.current().version++;
    v.rowsKey = null;
    for (let k = 0; k < 400; k++) {
      frames.push([]);
      v.render(cx);
      // The frame's own timers (the next reshape, the next build slice), then the next frame.
      cx.flush(0, 1);
      if (!v.rowJob && !(v.shapeLeft > 0) && !v.staleRows?.length && !v.reshapeDue) break;
    }
  } finally { globalThis.performance.now = real; v.shapeBudget = null; }
  return { v, frames: frames.filter((f) => f.length), turns, shaped: shaped.sort((a, b) => a - b) };
}
// What a frame shaped past its budget: its whole cost, past the larger of the budget and its
// first turn's cost (one turn alone may cost more than a frame's budget).
const over = (f) => f.reduce((a, b) => a + b, 0) - Math.max(12, f[0]);

test("shaping: a draw never shapes past its budget, except for its one first turn, and every row is reshaped", async () => {
  const { v, frames, shaped } = await shapingRun(1e-3, 1e-3);
  expect(v.shapeLeft ?? 0).toBe(0);
  expect(v.staleRows?.length ?? 0).toBe(0);
  for (const f of frames) expect(over(f)).toBeLessThanOrEqual(1e-9);
  // The same turns as with no budget at all, each once; a 20 ms turn has a draw to itself,
  // and the short ones share one.
  const free = await shapingRun(1e-3, 1e-3, Infinity);
  expect(shaped).toEqual(free.shaped);
  expect(free.frames.length).toBe(1);
  const long = frames.flat().filter((c) => c > 12).length;
  expect(long).toBeGreaterThan(10);
  expect(frames.length).toBeGreaterThanOrEqual(long);
  expect(frames.some((f) => f.length > 1)).toBe(true);
});

test("shaping: a turn far dearer than estimated runs past the budget once, then the rate it taught holds the others back", async () => {
  const { v, frames, shaped } = await shapingRun(1e-3, 1e-5);
  expect(shaped).toEqual((await shapingRun(1e-3, 1e-3, Infinity)).shaped);
  expect(v.shapeLeft ?? 0).toBe(0);
  expect(frames.filter((f) => over(f) > 1e-9).length).toBeLessThanOrEqual(1);
  expect(v.shapeRate).toBeGreaterThanOrEqual(1e-3 * 0.9 ** 40);
});

test("shaping: a rate far too high holds every turn but the first of each draw, falls back, and shaping still finishes", async () => {
  const { v, frames, shaped } = await shapingRun(1e-5, 1);
  expect(shaped).toEqual((await shapingRun(1e-5, 1e-5, Infinity)).shaped);
  expect(v.shapeLeft ?? 0).toBe(0);
  expect(v.staleRows?.length ?? 0).toBe(0);
  for (const f of frames) expect(over(f)).toBeLessThanOrEqual(1e-9);
  // One turn a draw: the worst a wrong rate costs is a draw for each turn, never a stall.
  // Each long turn it times lowers the rate by a tenth, so draws start to take two.
  expect(frames[0].length).toBe(1);
  expect(frames.length).toBeLessThanOrEqual(shaped.length);
  expect(v.shapeRate).toBeLessThan(1);
  expect(frames.some((f) => f.length > 1)).toBe(true);
});
