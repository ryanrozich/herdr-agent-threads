// bun test: the opening's drain: once the list shows, the rows left to reshape drain
// behind it, newest first while following; the rows drawn first and within a draw's time
// otherwise; and a reader who leaves the end (a wheel, a jump, a pin, the outline) keeps the
// place. On the render harness (test/render-harness.js), which setup() starts clean.
import { test, expect, setSystemTime } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drawnText, frame, H, lastList, openingPane, settle, setup, simList, state } from "./render-harness.js";

setup();

// A long plain chat: n turns of a typed prompt and a Markdown reply, nothing else. Made-up words.
const plainFiles = {};
function plainChat(n) {
  if (plainFiles[n]) return plainFiles[n];
  const at = (k) => new Date(Date.UTC(2026, 9, 1, 8, 0, 0) + k * 60000).toISOString();
  const say = (k, len) => Array.from({ length: len }, (_, j) => ["kazo", "the cart", "**total**", "zerb", "`sum()`", "agrees", "with", "quil"][(k + j) % 8]).join(" ");
  const lines = [];
  for (let k = 0; k < n; k++) {
    lines.push({ type: "user", uuid: `u${k}`, timestamp: at(2 * k), sessionId: "s", origin: { kind: "human" }, promptSource: "typed", message: { role: "user", content: `Turn ${k + 1}: ${say(k, 8 + (k % 20))}` } });
    lines.push({ type: "assistant", uuid: `a${k}`, timestamp: at(2 * k + 1), sessionId: "s", message: { id: `m${k}`, role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: `${say(k, 30)}\n\n- ${say(k + 1, 8)}\n- ${say(k + 2, 8)}\n\n${say(k + 3, 30)}` }], usage: { input_tokens: 5, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 30 } } });
    lines.push({ type: "system", subtype: "turn_duration", durationMs: 4000, uuid: `d${k}`, timestamp: at(2 * k + 1), sessionId: "s" });
  }
  const file = join(mkdtempSync(join(tmpdir(), "threads-plain-")), "p.jsonl");
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  plainFiles[n] = file;
  return file;
}
// A plain chat of n turns read whole, under the loading state, its rows not built yet. The
// shaping clock counts 1 ms a reshape and nothing else (a link pass or a Markdown height, real
// time on a busy machine, counts 0), and a draw has 12 ms of it (shapeBudget): a draw reshapes
// 12 rows on any machine, as a slow one would, and most rows are left to drain.
// Debug is off (measure() would rebuild the rows in every draw).
async function plainOpening(n, file = plainChat(n)) {
  const { v, cx, go } = await openingPane(file);
  v.debug = false;
  v.opening.at -= 1000;
  v.shapeBudget = 12;
  for (const [name, ms] of [["reshape", 1], ["stepLinks", 0], ["mdHeight", 0]]) {
    const f = v[name];
    // shape() adds reshape's real time after it returns: taken off here first.
    v[name] = function (...a) {
      const s0 = this.shapeSpent ?? 0;
      const t0 = performance.now();
      const r = f.apply(this, a);
      if (name === "reshape") this.shapeSpent = s0 + ms - (performance.now() - t0);
      else if ((this.shapeSpent ?? 0) !== s0) this.shapeSpent = s0 + ms;
      return r;
    };
  }
  go(() => false);
  await settle(v);
  let bottoms = 0;
  v.scroll = { scroll_to_bottom() { bottoms++; }, scroll_to_item() {} };
  // One frame as Herdr draws it (timers due, then a draw), with the rows left before and after.
  const step = () => {
    cx.flush(16);
    const before = v.staleRows?.length ?? 0;
    const b0 = bottoms;
    const shown = !v.openActive();
    const f = frame(v, cx);
    return { before, after: v.staleRows?.length ?? 0, end: bottoms > b0, shown, f };
  };
  return { v, cx, step };
}
// The rows the opening waits for, worked out here: the rows drawn last and 40 (SHAPE_NEAR) each
// side, as indexes of the built rows (the list puts a spacer or a gap first), then in the list.
function nearRows(v) {
  if (!v.viewRange || !v.baseRows?.length) return null;
  const off = ["spacer", "gap"].includes(v.rowsMemo?.[0]?.kind) ? 1 : 0;
  return [Math.max(0, v.viewRange[0] - off - 40), Math.min(v.baseRows.length, v.viewRange[1] - off + 40), off];
}
// Those rows settled: every row built, none of them stale or blank, none with a part to measure.
function spanSettled(v) {
  const span = nearRows(v);
  if (v.rowJob || !span) return false;
  const [a, b, off] = span;
  if ((v.staleRows ?? []).some((i) => i >= a && i < b)) return false;
  for (let i = a; i < b; i++) if (v.baseRows[i].shape?.blank) return false;
  return !v.partsWaiting(v.rowsMemo, a + off, b + off);
}

// The rows the last list drew with a blank shape: empty bubbles on screen.
const blankInView = (v) => { const r = lastList?.range; let n = 0; for (let i = r?.start ?? 0; i < (r?.end ?? 0); i++) if (v.rowsMemo?.[i]?.shape?.blank) n++; return n; };
// A reader who leaves the end by go() once the list shows, while the rows above drain. The list
// as Herdr keeps it: an offset in px (host.off) and 600 px of rows from it; a scroll to the end
// or to a row applies to the heights of the draw that asked for it, and goes no further than the
// end. go() returns the row it goes
// to, if not the turn it is given. Each frame after go(), and four after the rows are drained:
// [rows left, the first and last row drawn, blank rows among them, that row's top in the view,
// its height, rows on screen drawn at a height not their own (held), a place held, the rows].
// The timers age pace ms a frame. The clock is the harness's (1 us a read): a draw's time, the
// 35 ms line and the shaping time are the same on every run and every machine.
async function leaveDuringDrain(go, pace = 16) {
  const realPerf = performance.now.bind(performance);
  let clock = 0;
  performance.now = () => (clock += 0.001);
  const host = { off: 0, end: false, want: null };
  const top = (z, i) => z.slice(0, i).reduce((x, y) => x + y, 0);
  H.listWindow = (n, id) => {
    const z = lastList.sizes;
    if (!String(id).startsWith("threads-list")) return { start: 0, end: n };
    if (host.end) host.off = Math.max(0, top(z, n) - 600);
    else if (host.want != null) host.off = Math.min(top(z, host.want), Math.max(0, top(z, n) - 600));
    host.end = false;
    host.want = null;
    let a = 0, y = 0;
    while (a < n - 1 && y + z[a] <= host.off) y += z[a++];
    let b = a;
    while (b < n && y < host.off + 600) y += z[b++];
    return { start: a, end: b };
  };
  try {
    const { v, cx, step } = await plainOpening(2400);
    v.listH = 600;
    v.scroll = { scroll_to_bottom() { host.end = true; }, scroll_to_item(i) { host.want = i; } };
    for (let k = 0; v.openActive() && k < 400; k++) step();
    step();
    // Rows left to drain when go() leaves the end (see the jump test on the counts).
    expect(v.staleRows.length).toBeGreaterThan(250);
    // A turn far from the end, among the rows left.
    const key = v.baseRows[v.staleRows[v.staleRows.length >> 1]].key;
    const aim = go(v, cx, key, step, host) ?? key;
    const frames = [];
    for (let k = 0, after = 0; (v.rowJob || v.staleRows?.length || after++ < 4) && k < 400; k++) {
      // A return waits 400 ms at most for its parts (the harness measures none): as if passed.
      if (v.scrollTo?.until) v.scrollTo.until = 1;
      // pace ms a frame for the timers too: a landing's scrolls and lift come over several frames.
      for (const x of cx.timers) x.ms -= pace;
      step();
      const { sizes, range } = lastList;
      const i = lastList.keys.indexOf(aim);
      let held = 0;
      for (let j = range.start; j < range.end; j++) if (sizes[j] !== Math.ceil(v.sizesMemo[j])) held++;
      frames.push([v.staleRows?.length ?? 0, range.start, range.end, blankInView(v), i < 0 ? null : top(sizes, i) - host.off, sizes[i], held, Boolean(v.anchor?.open), sizes.length]);
    }
    return { v, cx, frames, step };
  } finally { H.listWindow = null; performance.now = realPerf; }
}

test("the opening: a long plain chat shows within a few frames of its read, once the rows near the end are shaped and measured", async () => {
  H.listWindow = (n) => ({ start: Math.max(0, n - 12), end: n });
  try {
    const { v, step } = await plainOpening(2400);
    const frames = [];
    while (v.openActive() && frames.length < 400) frames.push(step());
    expect(v.openActive()).toBe(false);
    // Shown in a few frames, while most rows still wait for their shape: before, the list was
    // held until every row was shaped, at 12 a frame.
    expect(frames.length).toBeLessThanOrEqual(30);
    expect(v.staleRows.length).toBeGreaterThan(400);
    // What it shows is settled: built, the rows drawn and SHAPE_NEAR either side shaped and
    // measured, at the end.
    expect(spanSettled(v)).toBe(true);
    expect(v.nearSpan()).toEqual(nearRows(v));
    const [a, b, off] = nearRows(v);
    expect(b).toBe(v.baseRows.length);
    expect(a).toBe(v.viewRange[0] - off - 40);
    expect(v.bottomShown).toBe(true);
    for (const r of v.rowsMemo.slice(v.viewRange[0], v.viewRange[1])) expect(r.shape?.blank).toBeFalsy();
    // Every frame before was the list hidden under the loading state.
    for (const x of frames.slice(0, -1)) expect(drawnText(x.f)).toContain("Reading this session");
  } finally { H.listWindow = null; }
}, 30000);

test("the opening: once the list shows, the rows left drain behind it, the end held in every frame, until every row is shaped", async () => {
  H.listWindow = (n) => ({ start: Math.max(0, n - 12), end: n });
  try {
    const { v, step } = await plainOpening(2400);
    for (let k = 0; v.openActive() && k < 400; k++) step();
    expect(v.openActive()).toBe(false);
    const left = v.staleRows.length;
    expect(left).toBeGreaterThan(400);
    const behind = [];
    while ((v.staleRows.length || v.shapeLeft > 0) && behind.length < 400) behind.push(step());
    // Drained in about left / 12 frames, each drawing the list (no loading state), at its end.
    expect(v.staleRows).toEqual([]);
    expect(behind.length).toBeLessThanOrEqual(Math.ceil(left / 10) + 5);
    for (const x of behind) {
      expect(drawnText(x.f)).not.toContain("Reading this session");
      expect(x.end).toBe(true);
    }
    expect(v.bottomShown).toBe(true);
    expect(v.rowsMemo.some((r) => r.shape?.blank)).toBe(false);
    expect(v.openActive()).toBe(false);
    expect(v.headerText()).not.toBe("Reading…");
  } finally { H.listWindow = null; }
}, 30000);

test("the opening: once the list shows, it stays at its end while the rows above drain, through a height far above changing", async () => {
  H.listWindow = (n) => ({ start: Math.max(0, n - 12), end: n });
  try {
    const { v, cx, step } = await plainOpening(2400);
    for (let k = 0; v.openActive() && k < 400; k++) step();
    expect(v.openActive()).toBe(false);
    expect(v.staleRows.length).toBeGreaterThan(400);
    // From here the rows drawn follow the list's offset and the rows' current heights (simList),
    // and the end scrolls asked for are counted, so a frame that does not ask for the end, or
    // asks against old heights, leaves the view off the end. It starts at the end, as shown.
    v.listH = 600;
    const sim = simList(v);
    sim.off = Number.POSITIVE_INFINITY;
    // The list keeps its offset in px, so a row above the view that changes height moves what
    // is on screen unless the same frame asks for the end again.
    const above = () => v.slotsMemo.slice(0, v.viewRange[0]).reduce((x, y) => x + y, 0);
    const room = () => Math.max(0, lastList.sizes.reduce((x, y) => x + y, 0) - v.listH);
    const sel = v.sel;
    step();
    // A turn far above the view, shaped, whose reply block the probe then measures taller.
    const far = v.baseRows.findIndex((r, i) => i < v.nearSpan()[0] - 200 && r.kind === "turn" && r.shape?.md != null && !r.shape.blank);
    expect(far).toBeGreaterThanOrEqual(0);
    let was = above();
    const frames = [];
    while (v.staleRows.length && frames.length < 400) {
      let grew = false;
      if (frames.length === 5) {
        const part = v.cmdFor(v.baseRows[far]);
        const h0 = v.baseSizes[far];
        v.probed(part.key, v.partSig(part), { height: (h0 + 600) * v.zoom() }, cx);
        grew = v.baseSizes[far] > h0;
      }
      const asks = sim.asks;
      step();
      const now = above();
      // The view the offset gives: its last row the list's last, and the offset the most the
      // list's current heights allow.
      frames.push({ grew, moved: now !== was, end: sim.asks > asks, atEnd: v.viewRange[1] === lastList.keys.length && Math.abs(sim.off - room()) < 1e-6, bottom: v.bottomShown, follow: v.follow, sel: v.sel });
      was = now;
    }
    expect(v.staleRows).toEqual([]);
    expect(frames[5].grew).toBe(true);
    expect(frames[5].moved).toBe(true);
    // Heights above the view changed in most frames (each row reshaped there), and in every
    // frame the end was asked for in that frame, the view is at the end the offset gives, the
    // end is on screen, the reader still following and the selection where it was; the frame
    // of the taller measure too.
    expect(frames.filter((f) => f.moved).length).toBeGreaterThan(frames.length / 2);
    for (const f of frames) expect([f.end, f.atEnd, f.bottom, f.follow, f.sel]).toEqual([true, true, true, true, sel]);
  } finally { H.listWindow = null; }
}, 30000);

test("the opening: scrolled up mid-chat while the rows above drain, the row at the top edge and its offset stay put as they are reshaped", async () => {
  // The list as Herdr keeps it: an offset in px (off), and the rows drawn from it. A scroll to
  // the end applies to the heights of the draw that asked for it.
  let off = 0;
  let end = false;
  const place = () => { const z = lastList.sizes; let i = 0, y = 0; while (i < z.length - 1 && y + z[i] <= off) y += z[i++]; return [lastList.keys[i], off - y]; };
  H.listWindow = (n) => { const z = lastList.sizes; if (end) { end = false; off = Math.max(0, z.reduce((x, y) => x + y, 0) - 600); } let a = 0, y = 0; while (a < n - 1 && y + z[a] <= off) y += z[a++]; let b = a; while (b < n && y < off + 600) y += z[b++]; return { start: a, end: b }; };
  try {
    const { v, step } = await plainOpening(2400);
    v.listH = 600;
    v.scroll = { scroll_to_bottom() { end = true; }, scroll_to_item() { throw new Error("no scroll to a row while the place is held"); } };
    for (let k = 0; v.openActive() && k < 400; k++) step();
    expect(v.openActive()).toBe(false);
    step();
    // One wheel up, to a turn mid-chat with rows still to reshape above it (the oldest are
    // reshaped first once the reader is not following).
    const to = lastList.sizes.slice(0, v.staleRows.at(-1) - 20).reduce((x, y) => x + y, 0);
    const dy = Math.round(off - to);
    off -= dy / v.zoom();
    v.listWheel({ delta: { y: dy } });
    expect(v.follow).toBe(false);
    step();
    const at = place();
    const sizes = v.baseSizes.slice();
    const stale = v.staleRows.length;
    expect(stale).toBeGreaterThan(400);
    // No empty bubble on screen after the frame of the wheel: the rows drawn are reshaped first.
    for (let k = 0; v.staleRows.length && k < 400; k++) { step(); expect(place()).toEqual(at); expect(blankInView(v)).toBe(0); }
    // Rows above it were reshaped to other heights meanwhile.
    const ai = v.baseIndex.get(at[0]);
    expect(v.baseSizes.slice(0, ai).filter((h, i) => h !== sizes[i]).length).toBeGreaterThan(100);
  } finally { H.listWindow = null; }
}, 30000);

// Every way to leave the end for a turn while the rows above drain. Before, first, #n, a key step
// and a search step were dropped: the end was held (toBottom) until the jump's wait was over,
// and then the view went to the end. A rail jump, a pin's go-to and the outline's landed, then
// crept up about 8 rows a frame as the rows above were reshaped.
const LEAVE_WAYS = {
  "the rail": (v, cx, key) => { v.railJump(key, cx); },
  first: (v, cx) => { v.action("first", cx); return v.sel; },
  "#n": (v, cx, key) => { v.setQuery(`#${v.findTurn(key).n}`, cx); },
  "a key step": (v, cx, key) => { v.sel = key; v.follow = false; v.action("next", cx); return v.sel; },
  // "Turn" is in every prompt, so the search hides none and the rows drain as before.
  "a search step": (v, cx, key) => { v.setQuery("Turn", cx); v.sel = key; v.action("olderMatch", cx); return v.sel; },
  "older then newer": (v, cx, key) => { v.setQuery("Turn", cx); v.sel = key; for (const a of ["olderMatch", "olderMatch", "newerMatch"]) v.action(a, cx); return v.sel; },
  "the outline": (v, _cx, key, step) => { v.setOutline(true); step(); step(); v.leaveOutline(key); },
  // Pins stay with the session from run to run: this turn's.
  "a pin": (v, cx, key) => {
    if (!v.pinnedList().some((p) => p.key === key)) v.togglePin(key, cx);
    v.goPin(v.pinnedList().findIndex((p) => p.key === key), cx);
  },
};
test("the opening: a jump away from the end while the rows above drain lands on its turn, on rows shaped by the next frame, and stays", async () => {
  // Frames 16 ms apart; 8 ms apart, a frame between the landing's two scrolls; and 130 ms apart,
  // its scrolls, its lift and the hold in one gap.
  for (const [name, go, pace] of Object.entries(LEAVE_WAYS).flatMap(([n, g]) => [16, 8, 130].map((p) => [`${n}, ${p} ms`, g, p]))) {
    const { v, frames } = await leaveDuringDrain(go, pace);
    expect([name, v.staleRows.length]).toEqual([name, 0]);
    const on = (f) => f[4] != null && f[4] >= 0 && f[4] < 600;
    // The turn's top is on screen once the landing's scrolls are drawn (48 ms), with rows left
    // to reshape: it landed during the drain, not after it. The drain's pace is the test's
    // shaping clock (12 rows a frame on any machine); only the rows left when the list shows
    // (go's 250) depend on the machine: 980 to 1,860 in runs here, and once few enough that
    // under 400 were left at the landing. A faster machine leaves fewer, so these lower bounds
    // fail on it rather than pass with no drain to test: by the landing frame (at most 5, 60
    // rows, at 8 ms apart) more than 200 must still be left.
    const at = frames.findIndex(on);
    expect([name, at >= 0 && at <= Math.max(1, Math.ceil(48 / pace) - 1)]).toEqual([name, true]);
    expect([name, frames[at][0] > 200]).toEqual([name, true]);
    // From then on: on screen in every frame, never back at the end, with no empty bubble and no
    // row on screen at a height not its own.
    const later = frames.slice(at + 1);
    expect([name, later.filter((f) => !on(f) || f[2] >= f[8] - 1 || f[3] > 0 || f[6] > 0)]).toEqual([name, []]);
    // Once its scrolls are drawn (130 ms), the place is held: the turn's top stays where it is
    // then, to the end of the drain and after.
    const h = frames.findIndex((f) => f[7]);
    expect([name, h >= at && h <= Math.ceil(130 / pace) + 2]).toEqual([name, true]);
    expect([name, frames.slice(h).filter((f) => Math.abs(f[4] - frames[h][4]) > 1)]).toEqual([name, []]);
  }
}, 120000);

// A drag of the scroll bar while the rows above drain is pulled back to the end in every frame,
// as before this change (196 frames of 196 while 2,364 rows drained, at the base commit and on
// main). Each frame asks for the end before the draw that would show the drag, and stickCheck,
// which tells a drag by the rows drawn, returns while the end is held and needs the rows
// unchanged since the frame before, which each reshape breaks. A fix needs Herdr to report a
// drag, or the end asked for only in frames where it moved: left for a follow-up.
test.skip("the opening: a drag of the scroll bar while the rows above drain stays where it is put", async () => {
  const { frames } = await leaveDuringDrain((_v, _cx, key, _step, host) => {
    host.off = lastList.sizes.slice(0, lastList.keys.indexOf(key)).reduce((x, y) => x + y, 0);
  });
  expect(frames.filter((f) => f[2] >= f[8] - 1)).toEqual([]);
}, 30000);

// A reader who stays at the end during the drain: j at the newest turn (it selects it again,
// with a scroll to it) and Jump to latest just after a jump, while it lands. Both keep the end
// in every frame to the end of the drain, and the rows above drain in each. This is not the
// behaviour before the fix: it pins the wait skip during the drain too. Before, j at the
// newest waited up to 2 s (SCROLL_WAIT_MS) and showed the newest turn's head, not the end.
test("the opening: through the drain the end stays held while following, after j at the newest turn and after Jump to latest", async () => {
  const ways = {
    "j at the newest": (v, cx) => { v.action("next", cx); expect(v.follow).toBe(true); expect(v.scrollTo).not.toBeNull(); return v.sel; },
    "latest after first": (v, cx, _key, step) => {
      v.action("first", cx);
      for (let k = 0; k < 2; k++) { if (v.scrollTo) v.scrollWait = 1; for (const x of cx.timers) x.ms -= 16; step(); }
      expect(lastList.range.start).toBeLessThan(5);
      v.action("latest", cx);
      return v.sel;
    },
  };
  for (const [name, go] of Object.entries(ways)) {
    const { v, frames } = await leaveDuringDrain(go);
    expect([name, frames.length > 30, v.staleRows.length]).toEqual([name, true, 0]);
    // The end drawn in every frame from the fourth, with no empty bubble. Before it, j's scroll to
    // the newest turn's head shows for one frame.
    expect([name, frames.slice(3).filter((f) => f[2] !== f[8] || f[3] > 0)]).toEqual([name, []]);
    expect([name, frames.filter((f, k) => f[0] > 0 && f[0] >= (frames[k - 1]?.[0] ?? Infinity))]).toEqual([name, []]);
  }
}, 60000);

// A jump while the list is still hidden comes only from a command (keys, presses and the wheel
// wait): the list is still shown at its end, following, and the end held through the drain.
test("the opening: a command's jump while the list is hidden still shows it at its end and holds the end", async () => {
  H.listWindow = (n) => ({ start: Math.max(0, n - 12), end: n });
  try {
    const { v, cx, step } = await plainOpening(2400);
    step();
    expect(v.openActive()).toBe(true);
    v.command("first", cx);
    const frames = [];
    for (let k = 0; k < 400 && (v.openActive() || v.staleRows?.length); k++) {
      if (v.scrollTo) v.scrollWait = 1;
      for (const x of cx.timers) x.ms -= 16;
      frames.push(step());
    }
    const s0 = frames.findIndex((f) => f.shown);
    expect(s0).toBeGreaterThan(0);
    expect(s0).toBeLessThanOrEqual(30);
    expect(v.follow).toBe(true);
    // The frame that shows the list and every one after ask for the end.
    expect(frames.slice(s0).filter((f) => !f.end)).toEqual([]);
  } finally { H.listWindow = null; }
}, 30000);

test("the opening: a wheel up once the parts are measured, with rows still to reshape, takes the place on screen", async () => {
  H.listWindow = (n) => ({ start: Math.max(0, n - 12), end: n });
  try {
    const { v, step } = await plainOpening(2400);
    for (let k = 0; v.openActive() && k < 400; k++) step();
    v.probeDue = () => { v.probeLeft = 0; return []; };
    step();
    step();
    expect(v.staleRows.length).toBeGreaterThan(400);
    expect(v.openHold).toBe(true);
    v.listH = 600;
    v.listWheel({ delta: { y: 120 } });
    expect(v.anchor?.open).toBe(true);
    step();
    v.listWheel({ delta: { y: 60 } });
    expect(v.anchor?.open).toBe(true);
  } finally { H.listWindow = null; }
}, 30000);

test("the opening: a new width while the list is hidden shows it once the rows near the end have the new width's shapes", async () => {
  H.listWindow = (n) => ({ start: Math.max(0, n - 12), end: n });
  try {
    const { v, step } = await plainOpening(2400);
    step();
    expect(v.openActive()).toBe(true);
    v.width -= 40;
    const look = v.shapeLook();
    let x = null;
    for (let k = 0; v.openActive() && k < 400; k++) x = step();
    expect(v.openActive()).toBe(false);
    // The frame that showed it: at its end, the rows near it reshaped, none blank, more left.
    expect(x.end).toBe(true);
    const [a, b] = nearRows(v);
    const old = v.baseRows.slice(a, b).filter((r) => r.kind === "turn" && !(r.shape === r.turn.shapeMemo && r.turn.shapeFast?.look === look));
    expect(old.length).toBe(0);
    expect(blankInView(v)).toBe(0);
    expect(v.staleRows.length).toBeGreaterThan(100);
  } finally { H.listWindow = null; }
}, 30000);

test("the drain uses its shaping time: a pass reshapes rows until the draw's budget is spent, in every frame", async () => {
  H.listWindow = (n) => ({ start: Math.max(0, n - 12), end: n });
  try {
    const { v, step } = await plainOpening(2400);
    const frames = [];
    while ((v.openActive() || v.staleRows?.length) && frames.length < 400) frames.push(step());
    expect(v.staleRows).toEqual([]);
    // Every frame that started with rows to spare reshaped 12 (1 ms each, 12 ms a draw): none
    // stopped early, none was left without a pass.
    // (The first frame after the read has none: its pass is asked for by that frame.)
    // Every such frame is counted: one a 12 rows until fewer than 24 are left.
    const full = frames.slice(1).filter((x) => x.before >= 24 && x.after <= x.before);
    expect(frames[1].before).toBeGreaterThan(400);
    expect(full.length).toBeGreaterThanOrEqual(Math.floor((frames[1].before - 24) / 12));
    for (const x of full) expect(x.before - x.after).toBeGreaterThanOrEqual(11);
    // One pass on its own: it stops once the budget is spent, with the rest left as they were.
    v.width -= 40;
    for (let k = 0; k < 20 && v.rowJob; k++) step();
    v.rowsKey = null;
    v.rows();
    while (v.rowJob) { v.renders++; v.rows(); }
    const was = v.staleRows.length;
    expect(was).toBeGreaterThan(100);
    v.shapeSpent = 0;
    v.reshapeStale(v.status());
    expect(was - v.staleRows.length).toBeGreaterThanOrEqual(11);
    expect(was - v.staleRows.length).toBeLessThanOrEqual(13);
    expect(v.shapeSpent).toBeGreaterThan(12);
  } finally { H.listWindow = null; }
}, 30000);

test("the drain's order: while following, every pass walks the rows left newest first, and the rows left stay in order whichever way the pass before walked", async () => {
  H.listWindow = (n) => ({ start: Math.max(0, n - 12), end: n });
  try {
    const { v, step } = await plainOpening(600);
    for (let k = 0; (v.openActive() || v.staleRows?.length) && k < 400; k++) step();
    // Every row left again: a new width, rebuilt whole.
    v.width -= 40;
    for (let k = 0; k < 20 && v.rowJob; k++) step();
    v.rowsKey = null;
    v.rows();
    while (v.rowJob) { v.renders++; v.rows(); }
    expect(v.staleRows.length).toBeGreaterThan(150);
    // The rows a pass's own walk calls shape() for (not shapeInView's), in order. A turn named
    // in defer is left by that walk, as a turn left for its expected cost is: past the rows near
    // the view (none while following) the walk ends there, the rest unlooked at.
    const at = new Map(v.baseRows.map((r, i) => [r.turn, i]));
    let walked = [];
    let inView = false;
    let defer = null;
    const shape = v.shape;
    v.shape = function (t, ...a) {
      if (inView) return shape.call(this, t, ...a);
      walked.push(at.get(t));
      if (t !== defer) return shape.call(this, t, ...a);
      defer = null;
      this.shapeStale = true;
      return t.shapeMemo;
    };
    const siv = v.shapeInView;
    v.shapeInView = function (...a) { inView = true; try { return siv.apply(this, a); } finally { inView = false; } };
    const up = (a) => a.every((x, i) => i === 0 || a[i - 1] < x);
    const pass = (follow, left = false) => {
      v.follow = follow;
      walked = [];
      const s0 = v.staleRows.filter((i) => v.baseRows[i].kind === "turn").sort((a, b) => a - b);
      v.reshapeStale(v.status());
      if (left) expect(walked.length).toBe(3);
      else expect(walked.length).toBeGreaterThan(5);
      // Newest first while following. Otherwise the rows near the view first, those drawn and
      // then outward, then the rest oldest first.
      const [a, b, off] = nearRows(v);
      const d = (i) => Math.max(0, v.viewRange[0] - off - i, i - (v.viewRange[1] - off) + 1);
      const near = s0.filter((i) => i >= a && i < b).sort((x, y) => d(x) - d(y) || x - y);
      expect(walked).toEqual((follow ? s0.slice().reverse() : [...near, ...s0.filter((i) => i < a || i >= b)]).slice(0, walked.length));
      expect(up(v.staleRows)).toBe(true);
      return walked;
    };
    pass(true);
    pass(true);
    pass(true);
    // A turn left by a pass while following, its third, is the next pass's first.
    const d = v.staleRows.at(-3);
    defer = v.baseRows[d].turn;
    expect(pass(true, true)[2]).toBe(d);
    expect(v.staleRows.at(-1)).toBe(d);
    expect(pass(true)[0]).toBe(d);
    // Follow changing between two passes, each way.
    pass(false);
    pass(true);
    pass(false);
    pass(false);
    pass(true);
  } finally { H.listWindow = null; }
}, 30000);

test("the opening: a stopped draw once the rows near the end are settled does not hold the list for the 5 s of plain draws after it", async () => {
  H.listWindow = (n) => ({ start: Math.max(0, n - 12), end: n });
  try {
    const { v, cx, step } = await plainOpening(2400);
    // Herdr stops the first draw that finds the rows near the end settled, before it shows them.
    const ready = v.openReady;
    let stopped = false;
    v.openReady = function (rows) {
      if (!stopped && spanSettled(this)) { stopped = true; throw new Error("stopped"); }
      return ready.call(this, rows);
    };
    for (let k = 0; !stopped && k < 400; k++) {
      try { step(); } catch (e) { if (e.message !== "stopped") throw e; v.renderOpen = true; cx.timers = []; v.shapeNext = false; v.buildNext = false; v.probeNext = false; if (v.opening) v.opening.next = false; }
    }
    expect(stopped).toBe(true);
    expect(v.openActive()).toBe(true);
    expect(v.staleRows.length).toBeGreaterThan(400);
    // The next draws are plain for CUT_MS, reshaping nothing; the list shows in the first.
    const after = [];
    while (v.openActive() && after.length < 60) after.push(step());
    expect(v.cutUntil).toBeGreaterThan(performance.now());
    expect(v.openActive()).toBe(false);
    expect(after.length).toBe(1);
    expect(after[0].before - after[0].after).toBe(0);
  } finally { H.listWindow = null; }
}, 30000);

// ---- The draw's time past the shaping budget, a jump in the frame of a scroll to the end, a
// chat with no Markdown reply parts, and the 2 s wait during the drain.

// The list as Herdr keeps it: an offset in px (host.off) and 600 px of rows from it; a scroll to
// the end or to a row (want) applies to the heights of the draw that asked for it, and goes no
// further than the end.
function hostList() {
  const host = { off: 0, end: false, want: null };
  const top = (z, i) => z.slice(0, i).reduce((x, y) => x + y, 0);
  H.listWindow = (n, id) => {
    const z = lastList.sizes;
    if (!String(id).startsWith("threads-list")) return { start: 0, end: n };
    if (host.end) host.off = Math.max(0, top(z, n) - 600);
    else if (host.want != null) host.off = Math.min(top(z, host.want), Math.max(0, top(z, n) - 600));
    host.end = false;
    host.want = null;
    let a = 0, y = 0;
    while (a < n - 1 && y + z[a] <= host.off) y += z[a++];
    let b = a;
    while (b < n && y < host.off + 600) y += z[b++];
    return { start: a, end: b };
  };
  return { host, top };
}
// The probe's walk made to end with rows still to reshape (in the harness each pass restarts
// it), in a chat with no Markdown reply parts (prompts, no replies): the probe has nothing to
// measure, and the place is held by the rows left alone (openUnsettled).
test("the opening: in a chat with no Markdown reply parts, a wheel up with rows still to reshape takes the place and keeps it until they are done", async () => {
  const prompts = join(mkdtempSync(join(tmpdir(), "threads-prompts-")), "p.jsonl");
  writeFileSync(prompts, readFileSync(plainChat(2400), "utf8").split("\n").filter((l) => !l.includes('"type":"assistant"')).join("\n"));
  H.listWindow = (n) => ({ start: Math.max(0, n - 12), end: n });
  try {
    const { v, step } = await plainOpening(2400, prompts);
    for (let k = 0; v.openActive() && k < 400; k++) step();
    // The read shapes as many of these cheap rows as the machine's clock allows: all but the
    // last screen's go back to be reshaped, so as many are left on any machine.
    v.staleRows = [];
    v.baseRows.forEach((r, i) => { if (r.kind === "turn" && i < v.baseRows.length - 30) { Object.assign(r.turn, { shapeKey: null, shapeFast: null, shapesKept: null }); v.staleRows.push(i); } });
    v.probeDue = () => { v.probeLeft = 0; return []; };
    step();
    step();
    expect([v.staleRows.length > 400, v.openHold]).toEqual([true, true]);
    v.listH = 600;
    v.listWheel({ delta: { y: 120 } });
    expect(v.anchor?.open).toBe(true);
    step();
    v.listWheel({ delta: { y: 60 } });
    const held = [];
    for (let k = 0; v.staleRows.length && k < 1000; k++) { held.push(Boolean(v.anchor?.open)); step(); }
    expect([v.staleRows.length, held.length > 20, held.filter((x) => !x).length]).toEqual([0, true, 0]);
  } finally { H.listWindow = null; }
}, 30000);

// On main the frame's toBottom branch dropped the jump: the end, with the turn selected.
test("a jump in the same frame as a pending scroll to the end lands on its turn", async () => {
  const { v, cx, step } = await plainOpening(60);
  for (let k = 0; (v.openActive() || v.staleRows?.length) && k < 400; k++) step();
  v.listH = 600;
  const asks = [];
  v.scroll = { scroll_to_bottom() { asks.push("end"); }, scroll_to_item(i) { asks.push(lastList.keys[i]); } };
  v.toBottom = true;
  v.setQuery("#20", cx);
  expect(v.follow).toBe(false);
  for (let k = 0; k < 12; k++) { for (const x of cx.timers) x.ms -= 16; step(); }
  expect([v.sel, v.toBottom, asks.includes("end"), asks.includes("0:20")]).toEqual(["0:20", false, false, true]);
  // Nothing left to reshape: no landing hold (openLand), so no place is held.
  expect(Boolean(v.anchor?.open)).toBe(false);
}, 30000);

// A wheel up into rows still to reshape (or move(v, cx, host)), on a clock where a reshape costs
// ms and a draw base before its walk. Each frame: when its reshapes started (ms into the
// render), blank rows drawn, rows drawn, rows taken from outside them, and whether Herdr
// stopped it. With until, the work before the walk runs until base ms into the render, as work
// bounded from the render's start does, rather than costing base. With stop, after the move a
// draw past HOST_MS is stopped as Herdr stops one, on its total: a reshape that runs past it
// does not end, a draw whose work after the walk (after ms, the element tree and the list's
// layout) ends past it is stopped too, and the render is left open. A reshape costs its
// characters (prompt and reply) at one rate, ms for a turn of the read's mean size, as the
// estimate (shapeCost) assumes. liveMs: what the running turn's reshape costs, by its length.
// With until the waited time counts as a rows build's (buildSpent), work the draw bounds; without
// it base is fixed work, in the draw's fixed cost (frameBase). base may be a function of the
// frame after the move (0 the move's own). With stop the base and the stop start at the move:
// the opening drains as it does without them. The clock goes on 16 ms a frame besides the
// draw's own time, so the 5 s of plain draws after a stop end.
const wheelUp = (v, _cx, host) => { host.off = Math.max(0, host.off - 30000 / v.zoom()); v.listWheel({ delta: { y: 30000 } }); };
// A row left to reshape again with its text the same (a new look), as a rebuild leaves it.
function restaleRow(v, turn) {
  Object.assign(turn, { shapeKey: null, shapeFast: null, shapesKept: null });
  const i = v.baseRows.findIndex((r) => r.turn === turn);
  if (!v.staleRows.includes(i)) { v.staleRows.push(i); v.staleRows.sort((x, y) => x - y); }
  v.reshapeDue = true;
}
const STOP = new Error("stopped at 50 ms");
async function costlyWheel(ms, base, frames, move = wheelUp, { until = false, stop = false, stream = false, after = 0, liveMs = 0, ahead = false, each = null, plain = null } = {}) {
  const realPerf = performance.now.bind(performance);
  let clock = 0;
  performance.now = () => (clock += 0.001);
  const { host } = hostList();
  try {
    const { v, cx, go } = await openingPane(plainChat(2400));
    v.debug = false;
    v.opening.at -= 1000;
    v.shapeBudget = 12;
    let starts = [];
    let seen = 0;
    let offLate = 0;
    let over = 0;
    let drawn = new Set();
    let on = false;
    const past = (x) => on && stop && x.renderOpen && clock - x.renderAt > 50;
    let mean = 0;
    for (const s of v.sessions) for (const x of s.turns) mean += x.prompt.length + v.replyText(x).length;
    const rate = ms / (mean / v.sessions.reduce((n, s) => n + s.turns.length, 0));
    // The rate shape() learns from long turns (shapeLearn), as learned: these turns are short.
    v.shapeRate = rate;
    const reshape = v.reshape;
    v.reshape = function (...a) {
      if (this.renderOpen) {
        starts.push(Math.round(clock - this.renderAt));
        if (drawn.has(a[0])) seen++;
        else if (clock - this.renderAt > 35) offLate++;
      }
      clock += (a[0].prompt.length + (a[5] ?? "").length) * rate;
      if (this.renderOpen && clock - this.renderAt > 50) over++;
      if (past(this)) throw STOP;
      return reshape.apply(this, a);
    };
    let fk = -1;
    const baseAt = () => (typeof base === "function" ? base(fk) : base);
    // With ahead the fixed work is done in every draw before the owed row (react, ahead of
    // payOwed), not in the walk.
    const react = v.react;
    v.react = function (...a) {
      if (ahead && this.renderOpen && (!stop || on)) clock += baseAt();
      return react.apply(this, a);
    };
    const walk = v.reshapeStale;
    v.reshapeStale = function (...a) {
      if (!ahead && this.renderOpen && (!stop || on)) {
        // Work bounded from the render's start is a rows build's or a fill's, timed as such
        // (buildSpent), so not in the draw's fixed cost (frameBase); a fixed base is in it.
        const b = baseAt();
        const w = until ? Math.max(0, this.renderAt + b - clock) : b;
        clock += w;
        if (until) this.buildSpent = (this.buildSpent ?? 0) + w;
      }
      return walk.apply(this, a);
    };
    const draw = v.frame;
    v.frame = function (...a) {
      const o = draw.apply(this, a);
      if (this.renderOpen) { clock += after; if (past(this)) throw STOP; }
      return o;
    };
    go(() => false);
    await settle(v);
    v.listH = 600;
    v.scroll = { scroll_to_bottom() { host.end = true; }, scroll_to_item(i) { host.want = i; } };
    let stopped = false;
    const step = () => {
      clock += 16;
      for (const x of cx.timers) x.ms -= 16;
      cx.flush(16);
      starts = [];
      seen = 0;
      offLate = 0;
      over = 0;
      // The turns the last draw showed (Herdr draws the same rows until the list moves).
      const r = lastList?.range;
      drawn = new Set(r ? v.rowsMemo.slice(r.start, r.end).map((x) => x.turn).filter(Boolean) : []);
      stopped = false;
      // plain: an error a test throws in a draw, caught as Herdr shows one (the draw left open).
      try { frame(v, cx); } catch (e) { if (plain && e === plain) { H.rec = null; return starts; } if (e !== STOP) throw e; stopped = true; }
      if (past(v)) stopped = true;
      if (stopped) { v.renderOpen = true; H.rec = null; }
      return starts;
    };
    // The frames the opening took to show the list.
    let opened = 0;
    for (; v.openActive() && opened < 600; opened++) step();
    step();
    // An agent writing the newest turn: it runs, and its reply grows a line each frame.
    const live = v.sessions.at(-1).turns.at(-1);
    if (stream) {
      live.done = false;
      // A reply long enough that its reshape costs liveMs.
      if (liveMs) live.after.push("agrees with quil ".repeat(Math.max(0, Math.round((liveMs / rate - live.prompt.length - v.replyText(live).length) / 17))));
      step();
    }
    // The list is shown (the opening over) before the move, and a wheel leaves the end.
    expect(v.openActive()).toBe(false);
    on = true;
    move(v, cx, host);
    if (move === wheelUp) expect(v.follow).toBe(false);
    const out = [];
    for (let k = 0; k < frames; k++) {
      fk = k;
      // each(v, k): a test's change before frame k.
      each?.(v, k);
      if (stream) live.after.push(`More of the reply, line ${k}.`);
      const stale = new Set(v.staleRows);
      const s = step();
      const r = lastList.range;
      const off = v.rowsMemo[0]?.kind === "spacer" || v.rowsMemo[0]?.kind === "gap" ? 1 : 0;
      // Rows taken this frame from outside the rows drawn.
      const away = [...stale].filter((i) => !v.staleRows.includes(i) && (i + off < r.start || i + off >= r.end)).length;
      out.push({ starts: s, seen, offLate, over, blank: blankInView(v), drawn: r.end - r.start, away, stopped, owed: v.owedPaid ?? 0, owedAlone: v.owedAlone ?? 0, alone: v.aloneRun ?? 0 });
    }
    return { v, frames: out, opened };
  } finally { H.listWindow = null; performance.now = realPerf; }
}

// Rows of 20 ms, the shaping time 12: one reshape a draw, and past the time the walk takes only
// the rows drawn (memo hits), not the 40 on each side of them as before.
test("the opening: a wheel into rows that each cost more than a draw's shaping time reshapes one a draw, the rows drawn first", async () => {
  const { v, frames } = await costlyWheel(20, 0, 30);
  expect(v.staleRows.length).toBeGreaterThan(400);
  expect(frames.filter((f) => f.starts.length > 1)).toEqual([]);
  // After the wheel's frame (its walk had the rows drawn before it).
  expect(frames.slice(1).filter((f) => f.away > 0)).toEqual([]);
  // Every row drawn shaped within as many frames as rows on screen.
  expect(frames.slice(frames[0].drawn).filter((f) => f.blank > 0)).toEqual([]);
}, 60000);

// Walked 30 ms into the draw, rows of 8 ms: before, a second reshape started at 38 ms. None
// starts past NEAR_CUT_MS (35), a drawn row's neither; the rows drawn still fill, one a frame,
// and those left are counted (nearCut).
test("the opening: a late draw starts no reshape past 35 ms since its render began, and the rows drawn are shaped within a frame each", async () => {
  const { v, frames } = await costlyWheel(8, 30, 30);
  expect(v.staleRows.length).toBeGreaterThan(400);
  expect(frames.flatMap((f) => f.starts).filter((s) => s > 35)).toEqual([]);
  expect(frames.filter((f) => f.starts.length !== 1)).toEqual([]);
  expect(frames.slice(frames[0].drawn).filter((f) => f.blank > 0)).toEqual([]);
  v.report();
  expect(state.shared["threads.debug"][v.terminal].nearCut).toBeGreaterThan(0);
}, 60000);


// Outside the opening a scroll to a place still waits for the rows to settle, up to
// SCROLL_WAIT_MS (2 s), as before: only the opening's hold (openHold) skips it.
test("after the opening, a jump while rows are reshaped waits for them up to 2 s, as before", async () => {
  const { host } = hostList();
  const asks = [];
  try {
    const { v, cx, step } = await plainOpening(2400);
    v.listH = 600;
    v.scroll = { scroll_to_bottom() { host.end = true; }, scroll_to_item(i) { host.want = i; asks.push(lastList.keys[i]); } };
    for (let k = 0; (v.openActive() || v.staleRows?.length) && k < 600; k++) step();
    // Every part measured (the harness measures none): the opening's hold ends.
    v.probeDue = () => { v.probeLeft = 0; return []; };
    step();
    step();
    expect([v.openHold, v.staleRows.length]).toEqual([false, 0]);
    // Rows above go back to be reshaped (as a settings change sends them).
    v.baseRows.forEach((r, i) => { if (r.kind === "turn" && i < v.baseRows.length - 30) { Object.assign(r.turn, { shapeKey: null, shapeFast: null, shapesKept: null }); v.staleRows.push(i); } });
    const t0 = Date.now();
    setSystemTime(new Date(t0));
    v.setQuery("#300", cx);
    for (let k = 0; k < 10; k++) { for (const x of cx.timers) x.ms -= 16; step(); }
    expect([v.staleRows.length > 400, Boolean(v.scrollTo), asks.length]).toEqual([true, true, 0]);
    setSystemTime(new Date(t0 + 2001));
    for (let k = 0; k < 6; k++) { for (const x of cx.timers) x.ms -= 16; step(); }
    expect([v.staleRows.length > 300, asks.includes("0:300")]).toEqual([true, true]);
  } finally { H.listWindow = null; setSystemTime(); }
}, 60000);

// The 2 s wait protected a landing from heights changing above it: parts measured at other
// heights than their estimates. During the drain the landing's hold does: once it holds, parts
// above the turn measured 60 px taller than estimated move nothing on screen.
test("the opening: a jump during the drain holds its place while parts above it are measured at new heights", async () => {
  let sent = 0;
  const { v, frames } = await leaveDuringDrain((v, cx, key, step) => {
    v.setQuery(`#${v.findTurn(key).n}`, cx);
    for (let k = 0; !v.anchor?.open && k < 20; k++) { if (v.scrollTo?.until) v.scrollTo.until = 1; for (const x of cx.timers) x.ms -= 16; step(); }
    expect(v.anchor?.open).toBe(true);
    for (let i = v.baseIndex.get(key) - 1; i >= 0 && sent < 6; i--) {
      const r = v.baseRows[i];
      if (r.kind !== "turn" || r.shape?.md == null) continue;
      const p = v.cmdFor(r);
      v.probed(p.key, v.partSig(p), { height: (r.shape.mdEst + 60) * v.zoom() }, cx);
      sent++;
    }
  });
  expect([sent, v.staleRows.length]).toEqual([6, 0]);
  // On screen from the first frame after, its top where it was, no empty bubble.
  expect(frames.filter((f) => f[4] == null || f[4] < 0 || f[4] >= 600 || Math.abs(f[4] - frames[0][4]) > 1 || f[3] > 0)).toEqual([]);
}, 60000);

// A jump during the drain onto rows that cost 8 ms each, in draws whose walk starts 30 ms in:
// the landing frame and those after start no reshape past NEAR_CUT_MS, and the turn lands.
test("the opening: a jump during the drain onto costly rows keeps each draw's reshapes under the hard line, and lands", async () => {
  let aim = null;
  const { v, frames } = await costlyWheel(8, 30, 20, (v, cx) => { aim = v.baseRows[v.staleRows[v.staleRows.length >> 1]].key; v.setQuery(`#${v.findTurn(aim).n}`, cx); });
  expect(frames.flatMap((f) => f.starts).filter((s) => s > 35)).toEqual([]);
  const r = lastList.range;
  expect([v.sel, lastList.keys.slice(r.start, r.end).includes(aim), frames.slice(6).filter((f) => f.blank > 0).length]).toEqual([aim, true, 0]);
}, 60000);

// The draw's work before the walk runs to 36, 40, 44 or 48 ms (work bounded from the render's
// start, as waited rows are: a build's time), 1.5 ms of work after the walk (at 48 a draw has
// 2 ms left, so more stops every draw whatever the drain does), rows of 2, 8 or 20 ms, the view
// scrolled up into rows still to reshape, and Herdr's stop at 50 ms on the draw's total.
// Before, past 35 ms the drain's first reshape was let start up to 50 ms: one costlier than
// the time left was stopped, then 5 s of plain draws, then stopped again, and no row was
// reshaped. Now none starts whose expected end, with the rest of the draw, passes the stop
// less the margin: where the first fits it starts at the walk; where it does not, the next
// frame reshapes it first, near 0 ms, as its fixed cost (frameBase, here the 1.5 ms) leaves
// room. Past the line only a row on screen starts. No draw is stopped, a row on screen is
// reshaped in every frame until they are all shaped (in at least every second frame where
// the first does not fit), and they are by the sixth frame after the wheel.
// Per cell: draws stopped; a row on screen reshaped in every frame from the first drawn at the
// wheel's place (the wheel's own frame walks the rows at the end) until they are all shaped
// where the walk's first fits (base + ms + after and the 3 ms margin within 50 ms), else in
// at least every second frame; reshapes that end past 50 ms; starts past 35 ms for a row off
// screen; frames from the sixth with a blank row on screen.
function gridCell(frames, fits) {
  const filled = frames.findLastIndex((f) => f.blank > 0) + 1;
  let run = 0;
  let most = 0;
  for (const f of frames.slice(1, filled)) { run = f.seen ? 0 : run + 1; most = Math.max(most, run); }
  return [frames.filter((f) => f.stopped).length, most <= (fits ? 0 : 1), frames.reduce((n, f) => n + f.over, 0), frames.reduce((n, f) => n + f.offLate, 0), frames.slice(5).filter((f) => f.blank > 0).length];
}
test("the opening: a draw that reaches its walk late starts no reshape expected to end past Herdr's stop, and reshapes the row it refused first in the next frame", async () => {
  const got = [];
  const want = [];
  for (const base of [36, 40, 44, 48]) {
    for (const ms of [2, 8, 20]) {
      const { v, frames } = await costlyWheel(ms, base, 30, wheelUp, { until: true, stop: true, after: 1.5 });
      got.push([base, ms, ...gridCell(frames, base + ms + 1.5 + 3 <= 50), v.staleRows.length > 400]);
      want.push([base, ms, 0, true, 0, 0, 0, true]);
    }
  }
  expect(got).toEqual(want);
}, 300000);

// The same with the work before the walk fixed (30, 38 or 44 ms that the draw does whatever
// else it does, in its fixed cost, frameBase) and 2 ms after it: a reshape of c ms fits no draw
// like these where c + 32, 40 or 46 and the margin pass 50 ms. Each such row alone fits a light
// draw (the draws before the wheel, with no fixed work: lightBase), so in these 30 frames it is
// refused and owed, not run alone: no draw stopped, the rows left to reshape, counted in the
// draws that held an owed row (owedHeldDraws): the reader sees them blank (five rows on screen
// in every frame at 44 ms with rows of 8). Past OWED_DRAWS (64) such a row runs alone: the test
// after this one. Where it fits, the rows fill as
// above. (At 44 with rows of 2 the drain had shaped the rows at the wheel's place before it:
// none on screen is blank, so none is owed.) Per cell: draws stopped, reshapes that end past 50 ms, starts past 35 ms for a row off
// screen, and where it fits frames from the sixth with a blank row on screen, else frames with
// a row on screen reshaped and whether owed rows were held.
// The last cell has rows of 80 ms, each over the limit alone: one runs alone, its run is cut
// at 50 ms (one stop), its mark stays, and it is not run again (this clock does not reach the
// end of the 5 s after a stop; the same with time going on is the test after the next).
test("the opening: with fixed work around the walk, a row that fits only a light draw is owed and not reshaped, and no draw is stopped", async () => {
  const got = [];
  const want = [];
  for (const base of [30, 38, 44]) {
    for (const ms of [2, 8, 20]) {
      const { v, frames } = await costlyWheel(ms, base, 30, wheelUp, { stop: true, after: 2 });
      const fits = base + 2 + ms * 1.1 + 3 <= 50;
      got.push([base, ms, fits, frames.filter((f) => f.stopped).length, frames.reduce((n, f) => n + f.over, 0), frames.reduce((n, f) => n + f.offLate, 0), fits ? frames.slice(5).filter((f) => f.blank > 0).length : frames.filter((f) => f.seen).length, fits || !frames.some((f) => f.blank > 0) || (v.owedHeldDraws ?? 0) > 0, v.aloneRun ?? 0]);
      want.push([base, ms, fits, 0, 0, 0, 0, true, 0]);
    }
  }
  expect(got.map((g) => g[2])).toEqual([true, true, false, true, false, false, false, false, false]);
  expect(got).toEqual(want);
  const { v, frames } = await costlyWheel(80, 30, 30, wheelUp, { stop: true, after: 2 });
  // (Before the wheel, with no stop modelled, the drain ran such rows alone too: alone counts
  // those; the frames after it are what is checked.)
  const marked = v.sessions.flatMap((s) => s.turns).filter((x) => x.shapeMark);
  expect([frames.filter((f) => f.stopped).length, frames.reduce((n, f) => n + f.starts.length, 0), frames.reduce((n, f) => n + f.over, 0), marked.length]).toEqual([1, 1, 1, 1]);
}, 300000);

// The 44/8 cell run on, on a clock that ends the 5 s of plain draws after a stop: 44 ms of fixed
// work in the walk, 2 after it, rows of 8 ms. Each row on screen fits only a lighter draw than
// these, so it is refused and owed. At the 64th draw two rules meet: the lightest of the last 64
// draws is now one of these (lightBase), so the rows can never fit, and the owed row has been
// refused 63 (OWED_DRAWS is 64). It runs alone, as the draw's first unit, at its start; its
// shape is kept, and the draw is stopped once its work is done (8 + 44 + 2 > 50). The plain
// draws after the stop bring lightBase down again, so the row left on screen fits a light draw
// once more; its count (64) runs it alone as the first draw after those 5 s (about 311 frames)
// begins: a second stop, and then no row on screen is blank. (On the frozen clock the 5 s never
// ended and that row stayed blank. Without the count the same draw runs it too, as the fit
// check judges it by the plain draws' frameBase: this cell cannot tell the two apart, and the
// next test can.)
test("the opening: a row on screen refused 64 draws runs alone once, as its draw's first unit, at one stop a row, and the rows on screen fill", async () => {
  const { v, frames } = await costlyWheel(8, 44, 450, wheelUp, { stop: true, after: 2 });
  const stops = frames.flatMap((f, k) => (f.stopped ? [k] : []));
  expect(stops[0]).toBe(64);
  expect(stops.length).toBe(2);
  expect(stops[1] - stops[0]).toBeGreaterThan(5000 / 16 - 10);
  // Blank rows on screen in every frame before the first; after the second none.
  expect(frames.slice(0, 64).filter((f) => f.blank === 0)).toEqual([]);
  expect(frames.slice(stops[1]).filter((f) => f.blank > 0)).toEqual([]);
  // Each stopped draw started one reshape, at its start: the owed row, alone.
  expect(stops.map((k) => frames[k].starts)).toEqual([[0], [0]]);
  expect([v.aloneRun, v.owedAlone, v.aloneCut ?? 0, frames.reduce((n, f) => n + f.over, 0)]).toEqual([2, 1, 0, 0]);
}, 300000);

// 44 ms of fixed work in every draw ahead of the owed row (ahead: in react, before payOwed, as
// on this branch applyStick, fitColumn and react are), 2 after it, rows of 8 ms. A row on
// screen fits no such draw (44 + 8 and the margin pass 50), and from the 64th draw the lightest
// draw is one of these too, so the rows can never fit and are owed. A run alone that starts at
// 44 ms is expected to be cut at 50, so none starts where the time already spent and its
// estimate pass the limit less the margin: no row is run and no draw is stopped for a second
// 64 draws the row is refused in. The estimate may be too high, so then the row runs alone
// once all the same, as the draw's first unit. Here the estimate is right: the run is cut, one
// stop, and the row is held, blank, for its text. The other rows on screen do the same, one
// after each 5 s of plain draws.
test("the opening: with 44 ms of work ahead of the owed row in every draw, a row that can end in no such draw waits a second 64 draws, then runs alone once, at one stop", async () => {
  const { v, frames } = await costlyWheel(8, 44, 450, wheelUp, { stop: true, after: 2, ahead: true });
  const ran = frames.flatMap((f, k) => (f.starts.length ? [k] : []));
  expect(ran[0]).toBeGreaterThanOrEqual(126);
  expect(ran[0]).toBeLessThanOrEqual(130);
  expect(frames.slice(0, ran[0]).filter((f) => f.stopped).length).toBe(0);
  expect(frames.map((f) => f.starts.length).filter((n) => n > 1)).toEqual([]);
  // Each run cut, each a stop, each leaving its turn's mark; the next row about 5 s after.
  const held = v.sessions[0].turns.filter((t) => t.shapeMark?.alone).length;
  expect([ran.length, frames.filter((f) => f.stopped).length, frames.reduce((n, f) => n + f.over, 0), held]).toEqual([2, 2, 2, 2]);
  expect(ran[1] - ran[0]).toBeGreaterThan(5000 / 16 - 10);
  expect(frames.slice(-10).filter((f) => f.blank === 0)).toEqual([]);
}, 300000);

// The two-stop bound on the release path. With 44 ms ahead of the owed row in every draw and
// rows of 8 ms, a row released after a second 64 draws runs alone, so its mark says alone, and
// its cut holds it for its text: through 1,400 frames (about 22 s, four of the 5 s after a
// stop) no turn runs twice, each run is cut, and the stops are one for each turn run. A text
// costs at most two stops: one in a run with others, then one alone; a run released here is
// always the alone one.
test("the opening: a row released after a second 64 draws runs alone, and its cut holds it: one stop for its text, within the two a text may cost", async () => {
  const runs = new Map();
  const { frames } = await costlyWheel(8, 44, 1400, (v, cx, host) => {
    wheelUp(v, cx, host);
    const reshape = v.reshape;
    v.reshape = function (...a) { if (this.renderOpen) runs.set(a[0], [...(runs.get(a[0]) ?? []), Boolean(this.unitAlone)]); return reshape.apply(this, a); };
  }, { stop: true, after: 2, ahead: true });
  const each = [...runs.values()];
  // Runs of each turn run (alone or not): one each, alone, never more than two.
  expect(each.map((r) => r.length).filter((n) => n > 2)).toEqual([]);
  expect(each.filter((r) => r.length !== 1 || !r[0])).toEqual([]);
  expect([...runs.keys()].filter((t) => !t.shapeMark?.alone)).toEqual([]);
  expect(each.length).toBeGreaterThanOrEqual(3);
  expect([frames.filter((f) => f.stopped).length, frames.reduce((n, f) => n + f.over, 0)]).toEqual([each.length, each.length]);
}, 300000);

// The count of draws a row on screen is refused is for its text. In the 44 ms-ahead cell the
// first row released runs alone, is cut, and is held for its text with its count past 128.
// Its text then changes (a new chunk of the session read), which drops the mark: it waits a
// second 64 draws again for that text, counted from 0, and is not run as the first draw after
// the 5 s of plain draws begins, as a count carried over from the old text would have it.
// Then, once it has been refused 30 draws on the new text and no stop holds the pane, six light
// draws (no work ahead) let it be shaped and kept, which ends its count; left
// to reshape again with the same text, it counts from 0 once more and waits a second 64
// refused draws before it is released, not the rest of the count it had.
test("the opening: a row's refused draws count for its text: a released row cut and held, whose text then changes, waits a second 64 draws again", async () => {
  let turn = null;
  let changed = -1;
  let fresh = null;
  const runs = [];
  let cur = -1;
  let lightFrom = -1;
  let restaled = -1;
  let afterShape = null;
  let refusedSince = 0;
  let lastN = 0;
  const { frames } = await costlyWheel(8, (fk) => (lightFrom >= 0 && fk >= lightFrom && fk < lightFrom + 6 ? 0 : 44), 3200, (v, cx, host) => {
    wheelUp(v, cx, host);
    const reshape = v.reshape;
    v.reshape = function (...a) {
      if (this.renderOpen && !turn) turn = a[0];
      if (this.renderOpen && a[0] === turn) runs.push(cur);
      return reshape.apply(this, a);
    };
  }, {
    stop: true, after: 2, ahead: true, each: (v, k) => {
      cur = k;
      if (turn && changed < 0 && turn.shapeMark?.cut) {
        changed = k;
        expect([turn.shapeMark.alone, turn.refused.n >= 2 * 64 - 2]).toEqual([true, true]);
        turn.prompt = `${turn.prompt} zerb quil`;
      }
      // Twenty draws after the 5 s of plain draws that follow the stop.
      // The count that holds for its text now (a count of the old text, or one with no text, is
      // the one the release would read).
      if (changed >= 0 && k === changed + 313 + 20) {
        const r = turn.refused;
        fresh = r && (r.sig == null || r.sig === v.markSig(turn, v.replyText(turn))) ? r.n : 0;
      }
      if (changed >= 0 && lightFrom < 0 && k > changed + 313 + 20 && (turn.refused?.n ?? 0) >= 30 && !(performance.now() < (v.cutUntil ?? 0))) lightFrom = k + 1;
      // After the light draws: shaped and kept, its count ended; then left to reshape again.
      if (lightFrom >= 0 && k === lightFrom + 6) {
        afterShape = [turn.shapeKey != null, turn.shapeMark ?? null, turn.refused ?? null];
        restaleRow(v, turn);
        restaled = k;
        lastN = 0;
      }
      if (restaled >= 0 && k > restaled && runs.filter((x) => x > restaled).length === 0) {
        const n = turn.refused?.n ?? 0;
        if (n > lastN) refusedSince += n - lastN;
        lastN = n;
      }
    },
  });
  expect(changed).toBeGreaterThan(120);
  expect(runs[0]).toBeLessThan(changed);
  expect(fresh).toBeLessThanOrEqual(24);
  // Its next run on the new text: in the light draws, not before.
  const light = runs.filter((k) => k > changed);
  expect(light.length).toBeGreaterThanOrEqual(1);
  expect([light[0] >= lightFrom, light[0] < lightFrom + 6]).toEqual([true, true]);
  expect(afterShape).toEqual([true, null, null]);
  // Left to reshape again, its next run comes after a second 64 draws refused, counted from 0,
  // alone, once.
  const again = runs.filter((k) => k > restaled);
  expect(again.length).toBe(1);
  expect(refusedSince).toBeGreaterThanOrEqual(2 * 64 - 2);
  expect(frames.filter((f) => f.stopped).length).toBeGreaterThanOrEqual(1);
}, 300000);

// A rate four times too high, 40 ms of work ahead of the owed row in every draw, rows that
// really cost 4 ms (40 + 4 and the 2 after fit in 50): estimated at about 18 ms, each row looks
// as if no such draw could end it, so the time spent holds it. Nothing teaches the rate down:
// only a long turn that is shaped does. Before, the rows stayed blank for good. After a second
// 64 draws refused, a row runs alone all the same, ends in time, and is kept, with no stop; the
// rows on screen fill, one a draw.
test("the opening: with a rate four times too high and 40 ms of work ahead in every draw, a row the time spent holds runs alone after a second 64 draws, and is kept", async () => {
  const { v, frames } = await costlyWheel(4, 40, 220, (v, cx, host) => { wheelUp(v, cx, host); v.shapeRate *= 4; }, { stop: true, after: 2, ahead: true });
  const ran = frames.flatMap((f, k) => (f.starts.length ? [k] : []));
  expect(ran[0]).toBeGreaterThanOrEqual(126);
  expect(ran[0]).toBeLessThanOrEqual(130);
  expect([frames.filter((f) => f.stopped).length, frames.reduce((n, f) => n + f.over, 0), v.aloneCut ?? 0, frames.at(-1).blank]).toEqual([0, 0, 0, 0]);
  expect(frames.slice(0, ran[0]).filter((f) => f.blank === 0)).toEqual([]);
}, 300000);

// The same with one draw in every 40 of 2 ms (frames 39, 79, ...): that light draw keeps the
// lightest draw low, so no row ever counts as one that can never fit, and it is judged by the
// heavy draw before it (fitsHost on its frameBase), so it refuses the row too. Before, the rows
// stayed blank for as long as that went on. A row refused 64 draws is due to run alone, but
// in the heavy draws the time already spent (44 ms) and its estimate pass the limit, so it
// waits for the first light draw: there it runs alone, at about 2 ms, and is kept, with no
// stop. One row a light draw, alone, until none on screen is blank.
test("the opening: with one light draw in every 40, a row on screen refused 64 draws runs alone in the first light draw after, with no stop", async () => {
  const mixed = (k) => (k % 40 === 39 ? 2 : 44);
  for (const ms of [4, 8]) {
    const { v, frames } = await costlyWheel(ms, mixed, 240, wheelUp, { stop: true, after: 2, ahead: true });
    const ran = frames.flatMap((f, k) => (f.starts.length ? [k] : []));
    expect(v.lightBase()).toBeLessThan(6);
    expect([ms, ran[0], ran.every((k) => k % 40 === 39), frames.filter((f) => f.stopped).length, frames.reduce((n, f) => n + f.over, 0)]).toEqual([ms, 79, true, 0, 0]);
    expect([ms, frames.slice(0, 79).filter((f) => f.blank === 0).length, frames.at(-1).blank, v.owedAlone > 0]).toEqual([ms, 0, 0, true]);
  }
}, 300000);

// The count starts again once a row is shaped. In the light-draw cell (rows of 8 ms) the first
// row run, due at 64, runs in the light draw at 79 and is kept, which clears its count. Left to
// reshape again at once, its text the same, it is refused anew from 0: in the light draw at 119
// it has 38 of the 64 and is refused (judged by the heavy draw before it), and it runs in the one
// at 159. A count kept from before would have it due again at once, run at 119.
test("the opening: a row shaped and then left to reshape again, its text the same, counts its refused draws from 0", async () => {
  let turn = null;
  let cur = -1;
  let restaled = -1;
  const runs = [];
  const mixed = (k) => (k % 40 === 39 ? 2 : 44);
  await costlyWheel(8, mixed, 240, (v, cx, host) => {
    wheelUp(v, cx, host);
    const reshape = v.reshape;
    v.reshape = function (...a) {
      if (this.renderOpen && !turn) turn = a[0];
      if (this.renderOpen && a[0] === turn) runs.push(cur);
      return reshape.apply(this, a);
    };
  }, {
    stop: true, after: 2, ahead: true, each: (v, k) => {
      cur = k;
      if (turn && restaled < 0 && turn.shapeKey != null) {
        restaled = k;
        expect(turn.refused ?? null).toBeNull();
        restaleRow(v, turn);
      }
    },
  });
  expect([runs[0], restaled]).toEqual([79, 80]);
  expect(runs.slice(1)).toEqual([159]);
}, 300000);

// A row refused in the walk for the time spent there is owed, not only counted. With 10 ms of
// fixed work in the walk (rows of 8 ms, the rows on screen shaped first), one row on screen made
// a turn of about 40 ms can never fit (40 + 12 and the margin pass 50). The walk reaches it at
// about 10 ms, where its run alone would end past the limit less the margin (cutWhereNow): it
// waits, owed. The next draw tries it first (payOwed), at its start, where the run fits the
// limit: it runs alone there, as its draw's first unit, a draw or two after it was made big. Not
// owed, it would be met only in the walk, at 10 ms, for a second 64 draws, and then cut there.
test("the opening: a row the walk refuses for the time spent is owed, and runs alone at the start of the next draw", async () => {
  let big = null;
  let madeAt = -1;
  let cur = -1;
  const runs = [];
  const { frames } = await costlyWheel(8, 10, 200, (v, cx, host) => {
    wheelUp(v, cx, host);
    const reshape = v.reshape;
    v.reshape = function (...a) {
      if (this.renderOpen && a[0] === big) runs.push([cur, Boolean(this.unitAlone)]);
      return reshape.apply(this, a);
    };
  }, {
    stop: true, after: 2, each: (v, k) => {
      cur = k;
      const r = lastList.range;
      const off = v.rowsMemo[0]?.kind === "spacer" || v.rowsMemo[0]?.kind === "gap" ? 1 : 0;
      // Once the rows on screen are shaped and the lightest of the last 64 draws is one of these
      // (lightBase), the one in their middle is made about 40 ms.
      if (big || k < 70 || blankInView(v) || v.staleRows.some((i) => i + off >= r.start && i + off < r.end)) return;
      const row = v.rowsMemo[(r.start + r.end) >> 1];
      big = row.turn;
      madeAt = k;
      const add = Math.ceil((40 - v.shapeCost(big, v.replyText(big))) / v.shapeRate);
      big.prompt = `${big.prompt} ${"kaz vel orin tam ".repeat(Math.ceil(add / 17))}`;
      restaleRow(v, big);
      expect(v.neverFits(v.hostCost(big, v.replyText(big)))).toBe(true);
    },
  });
  expect(madeAt).toBeGreaterThan(0);
  expect(runs).toHaveLength(1);
  expect(runs[0][1]).toBe(true);
  expect(runs[0][0] - madeAt).toBeLessThanOrEqual(3);
  expect(frames[runs[0][0]].starts[0]).toBe(0);
}, 300000);

// A plain error thrown in an owed row's run alone (payOwed, with owedRun set): in the 44/8 cell
// the row due at 64 throws there. The draw is left open, so the 5 s of plain draws follow, and
// the next render starts with no owed run. The row's text then changes and the draws turn light
// (2 ms of work): it is shaped in the walk like any row, not alone, and no owed run is counted
// for it (owedAlone). An owed run left from the throw would run it alone, and count it.
test("the opening: after a plain error in an owed row's run alone, the next render has no owed run: the row, with new text, is shaped like any row", async () => {
  const BOOM = new Error("a made-up failure in a reshape");
  let turn = null;
  let light = false;
  let cur = -1;
  let owed = -1;
  let changed = -1;
  const runs = [];
  await costlyWheel(8, () => (light ? 2 : 44), 600, (v, cx, host) => {
    wheelUp(v, cx, host);
    const reshape = v.reshape;
    v.reshape = function (...a) {
      if (this.renderOpen && !turn && this.unitAlone && this.owedRun) { turn = a[0]; owed = this.owedAlone; throw BOOM; }
      if (this.renderOpen && a[0] === turn) runs.push([cur, Boolean(this.unitAlone)]);
      return reshape.apply(this, a);
    };
  }, {
    stop: true, after: 2, plain: BOOM, each: (v, k) => {
      cur = k;
      if (turn && changed < 0) {
        changed = k;
        expect(turn.shapeMark?.alone).toBe(true);
        turn.prompt = `${turn.prompt} zerb quil`;
        light = true;
      }
      if (changed >= 0 && k === changed + 1) expect(v.owedRun ?? null).toBeNull();
      if (k === 599) expect([turn.shapeKey != null, v.owedAlone]).toEqual([true, owed]);
    },
  });
  expect(changed).toBeGreaterThan(60);
  expect(runs.length).toBeGreaterThan(0);
  expect(runs.filter(([, alone]) => alone)).toEqual([]);
}, 300000);

// Past the line a row whose cost is unknown (no rate learned yet) does not start: only one
// expected to fit may (lineCut), and an unknown cost does not count as fitting. With 40 ms of
// fixed work in the walk, every walk starts past the 35 ms line: the rows on screen left after
// a wheel up are refused there and owed, and each is reshaped at the start of the next draw
// (payOwed, where an unknown cost goes ahead as a draw's first does). No reshape starts past 35
// ms, and the rows on screen fill.
test("the opening: before a rate is learned, a walk past the line starts no reshape, and the rows on screen are reshaped first in the next draw", async () => {
  const { v, frames } = await costlyWheel(4, 40, 120, (v, cx, host) => { wheelUp(v, cx, host); v.shapeRate = undefined; }, { after: 0 });
  expect(v.shapeRate ?? null).toBeNull();
  expect(frames.flatMap((f) => f.starts).filter((ms) => ms > 35)).toEqual([]);
  expect(frames.reduce((n, f) => n + f.starts.length, 0)).toBeGreaterThan(0);
  expect([v.owedPaid > 0, frames.at(-1).blank]).toEqual([true, 0]);
}, 300000);

// While following, the walk takes the rows left newest first, and past the line it stops at the
// first row off screen, not at the first row: the rows on screen are still looked at, and the
// first of them that fits starts (lineCut). With 40 ms of fixed work in the walk every walk is
// past the line; the rows on screen at the end, left to reshape again (their text the same),
// are reshaped one a draw at about 40 ms, and none is left after 30 frames.
test("the opening: following, a walk past the line still reshapes the rows on screen, one a draw, before it stops at the first row off screen", async () => {
  let rows = [];
  const { v, frames } = await costlyWheel(4, 40, 30, (v) => {
    const r = lastList.range;
    rows = v.rowsMemo.slice(r.start, r.end).map((x) => x.turn).filter(Boolean);
    for (const t of rows) restaleRow(v, t);
  }, { after: 0, stop: true });
  expect(v.follow).toBe(true);
  expect(rows.length).toBeGreaterThanOrEqual(2);
  const left = rows.filter((t) => t.shapeKey == null);
  expect(left).toEqual([]);
  expect(frames.flatMap((f) => f.starts).filter((ms) => ms > 35).length).toBeGreaterThanOrEqual(rows.length - 1);
  expect(frames.filter((f) => f.stopped).length).toBe(0);
}, 300000);

// In the opening the rows it waits for (the rows drawn and 40 either side, nearSpan) count as on
// screen past the line, not only the rows drawn: with 40 ms of fixed work in the walk from the
// read's end, every walk is past the line, and the opening still shows the list, one of those
// rows reshaped a draw. Were only the rows drawn counted, the 40 above them would wait for a walk
// that starts before the line, which never comes.
test("the opening: with every walk past the line, the rows the opening waits for are reshaped one a draw, and the list shows", async () => {
  const { v, opened } = await costlyWheel(4, 40, 1, () => {}, { after: 0 });
  expect(v.openActive()).toBe(false);
  expect(opened).toBeLessThan(400);
  expect(v.lateWalks).toBeGreaterThan(40);
}, 300000);

// Past the line no reshape starts off screen, a run alone included: shapeInView, at the walk's
// start, shapes up to SHAPE_FIRST turns from the top of the pane down, past the rows drawn too,
// with no row on screen (lineScreen false). With 36 ms of fixed work ahead in every draw and 6
// after it every walk is past the line, and once the lightest of the last 64 draws is 42 ms a
// row of 8 ms can never fit (8 + 42 + 3 > 50), though it would end in this draw (36 + 8 + 3 <=
// 50). Rows below the view, left to reshape again, wait for a walk before the line, through the
// walks that come once the rows on screen are filled and the 5 s after their runs alone end.
test("the opening: past the line a turn below the view that can never fit is not run alone, and no reshape starts off screen", async () => {
  let below = [];
  const { v, frames } = await costlyWheel(8, 36, 600, wheelUp, {
    after: 6,
    stop: true,
    ahead: true,
    each: (v, k) => {
      if (k !== 1) return;
      const r = lastList.range;
      const shown = v.rowsMemo.slice(r.start, r.end).map((x) => x.turn).filter(Boolean);
      const last = v.rowsMemo.slice(0, r.end).findLast((x) => x.turn)?.turn;
      const turns = v.sessions.at(-1).turns;
      const from = turns.indexOf(last) + 1;
      below = turns.slice(from, from + 20).filter((t) => !shown.includes(t));
      for (const t of below) restaleRow(v, t);
    },
  });
  expect(v.follow).toBe(false);
  expect(below.length).toBe(20);
  // Every walk after the move was past the line, and the rows below can never fit by the end.
  expect(v.lateWalks).toBeGreaterThan(100);
  expect(below.every((t) => v.neverFits(v.hostCost(t, v.replyText(t))))).toBe(true);
  expect(frames.reduce((n, f) => n + f.offLate, 0)).toBe(0);
  expect(below.filter((t) => t.shapeKey != null)).toEqual([]);
  // A run alone of a row on screen may cost its stop, one a row.
  expect(frames.filter((f) => f.stopped).length).toBeLessThanOrEqual(frames[0].drawn);
  expect(frames.at(-1).blank).toBe(0);
}, 300000);

// Two jumps 60 ms apart, in different frames, during the drain: each one's 130 ms timer is for
// its own landing. Before, the first's ended the second's 70 ms in: its place was held before
// the second's scrolls and lift were all drawn.
test("the opening: a second jump 60 ms after the first is held only after its own scrolls are drawn", async () => {
  let at = 0;
  const { v, frames } = await leaveDuringDrain((v, cx, key, step) => {
    const i = v.staleRows.indexOf(v.baseIndex.get(key));
    const first = v.baseRows[v.staleRows[i - 200]].key;
    v.setQuery(`#${v.findTurn(first).n}`, cx);
    for (let k = 0; k < 4; k++) { if (v.scrollTo?.until) v.scrollTo.until = 1; for (const x of cx.timers) x.ms -= 15; step(); }
    expect(v.anchor?.open).toBeFalsy();
    at = v.landId;
    v.setQuery(`#${v.findTurn(key).n}`, cx);
  });
  expect(v.staleRows.length).toBe(0);
  // Frames are 16 ms apart from the second jump: not held before its 130 ms.
  const h = frames.findIndex((f) => f[7]);
  expect([v.landId > at, h >= Math.ceil(130 / 16) - 1]).toEqual([true, true]);
  expect(frames.slice(h).filter((f) => f[4] == null || f[4] < 0 || f[4] >= 600 || Math.abs(f[4] - frames[h][4]) > 1)).toEqual([]);
}, 60000);

// A landing's hold still to take ends with the place: a pick of another session, a restart of
// the read, a wheel (dropAnchor), or a switch to the other view with nothing selected (with a
// selection the switch makes a landing of its own) leaves no hold to be taken on other rows.
test("the opening: a pick, a restart, a dropped place or a switch of view ends a landing's hold still to take", async () => {
  const { v, cx } = await plainOpening(60);
  const views = () => { v.sel = null; v.setView(v.view === "pinned" ? "all" : "pinned"); };
  for (const [name, f] of [["dropAnchor", () => v.dropAnchor()], ["restart", () => v.restart(v.current())], ["view", views], ["view back", views], ["pick", () => v.pick({ path: v.current().file }, cx)]]) {
    v.openLand = "due";
    f();
    expect([name, v.openLand]).toEqual([name, false]);
  }
}, 30000);

// An agent writing the newest turn while the reader is scrolled up into rows still to reshape,
// the walk 40 ms into each draw, 1.5 ms after it, rows of 8 ms and the running turn's reshape
// 20. The running turn is off screen: past the line it is not reshaped in the drain (the rows
// build shapes it when it is drawn), and the rows on screen are, one a frame, as without it.
// Before, the running turn was reshaped first in every frame and took the draw's one reshape
// past the line: the rows on screen stayed blank in all 30 frames.
test("the opening: while a turn streams, the rows on screen are still reshaped, one a frame, and the running turn off screen waits", async () => {
  const { frames } = await costlyWheel(8, 40, 30, wheelUp, { until: true, stop: true, stream: true, after: 1.5, liveMs: 20 });
  expect(gridCell(frames, false)).toEqual([0, true, 0, 0, 0]);
  // The rows on screen filled by the fourth frame after the wheel.
  expect(frames.findLastIndex((f) => f.blank > 0)).toBeLessThan(3);
}, 60000);

// The 35 ms line is the drain's (reshapeStale): a reshape asked for late in a draw elsewhere (a
// rows build, a settings rebuild) is held only to the draw's shaping time, as before it.
test("a reshape asked for past 35 ms in a draw outside the drain starts, and inside the drain, off screen, waits", async () => {
  const { v } = await plainOpening(60);
  const turn = v.sessions[0].turns[3];
  const fresh = () => Object.assign(turn, { shapeKey: null, shapeFast: null, shapesKept: null });
  try {
    v.renderOpen = true;
    v.renderAt = performance.now() - 40;
    v.shapeSpent = 0;
    fresh();
    v.shape(turn);
    expect(v.shapeStale).toBe(false);
    fresh();
    v.lineOn = true;
    v.lineFirst = true;
    v.shape(turn);
    expect(v.shapeStale).toBe(true);
  } finally {
    v.lineOn = false;
    v.renderOpen = false;
  }
}, 30000);


// The row on screen the line refused is owed by its key for the next frame only while the view
// stays: a wheel, a jump waiting or a new top row drops it, so the next frame's first reshape
// is not spent on a row no longer drawn. With the view still, it is reshaped.
test("the opening: a row the line refused is reshaped first next frame only while the view has not moved", async () => {
  const { v } = await plainOpening(60);
  const got = [];
  for (const [name, move] of [["still", () => {}], ["wheel", () => { v.wheelN = (v.wheelN ?? 0) + 1; }], ["jump", () => { v.scrollTo = { key: "0:1" }; }], ["top row", () => { v.viewRange = [3, 13]; }]]) {
    const r = v.baseRows.find((x) => x.kind === "turn");
    Object.assign(r.turn, { shapeKey: null, shapeFast: null, shapesKept: null });
    Object.assign(v, { viewRange: [0, 10], scrollTo: null, renderOpen: true, renderAt: performance.now(), shapeSpent: 0, shapeAtRender: 0, buildSpent: 0, frameBase: 0, shapeRate: 0.00001 });
    v.lineOwed = { key: r.key, view: 0, wheel: v.wheelN ?? 0 };
    const paid = v.owedPaid ?? 0;
    move();
    v.payOwed();
    got.push([name, (v.owedPaid ?? 0) - paid, r.turn.shapeKey != null, v.lineOwed]);
    v.renderOpen = false;
    v.scrollTo = null;
  }
  expect(got).toEqual([["still", 1, true, null], ["wheel", 0, false, null], ["jump", 0, false, null], ["top row", 0, false, null]]);
}, 30000);

// A plain chat drained, then on a priced clock: a reshape costs its characters (prompt and
// reply) at rate ms each, as the rate shape() learned says (shapeRate, set to it), a draw has
// after ms of work after its rows, and frames are 16 ms apart. Herdr's stop is modelled as
// Herdr does it, on the draw's total: a reshape that runs past 50 ms from the render's start
// is interrupted (nothing of it kept), a draw whose work ends past it is stopped once that
// work is done (what it set is kept), and the render is left open. charge(turn, ms) adds ms to
// that turn's reshapes, a cost its estimate does not see. restale(turn, chars) makes
// a turn chars longer and leaves its row to reshape; step() gives the frame's reshapes, in
// order ({ turn, at, cost }), and whether it was stopped.
async function pricedDrain({ n = 120, rate = 0.001, after = 10 } = {}) {
  let build = 0;
  const realPerf = performance.now.bind(performance);
  let clock = 0;
  performance.now = () => (clock += 0.001);
  const { v, cx, go } = await openingPane(plainChat(n));
  v.debug = false;
  v.opening.at -= 1000;
  v.shapeBudget = 12;
  v.listH = 600;
  let on = false;
  let log = [];
  const extra = new Map();
  const reshape = v.reshape;
  v.reshape = function (...a) {
    const cost = on ? (a[0].prompt.length + (a[5] ?? "").length) * rate + (extra.get(a[0]) ?? 0) : 0;
    if (this.renderOpen) log.push({ turn: a[0], at: clock - this.renderAt, cost });
    clock += cost;
    if (on && this.renderOpen && clock - this.renderAt > 50) throw STOP;
    return reshape.apply(this, a);
  };
  // A rows build this draw (build ms, once), as a new chunk read makes: building time, which
  // the draw's fixed cost (frameBase) leaves out.
  const rows = v.rows;
  v.rows = function (...a) {
    if (on && build && this.renderOpen) { clock += build; this.buildSpent = (this.buildSpent ?? 0) + build; build = 0; }
    return rows.apply(this, a);
  };
  const draw = v.frame;
  v.frame = function (...a) {
    const o = draw.apply(this, a);
    if (on && this.renderOpen) { clock += after; if (clock - this.renderAt > 50) throw STOP; }
    return o;
  };
  // Fixed work in every draw ahead of the owed row (setAhead: in react, before payOwed).
  let ahead = 0;
  const react = v.react;
  v.react = function (...a) {
    if (on && this.renderOpen) clock += ahead;
    return react.apply(this, a);
  };
  go(() => false);
  await settle(v);
  v.scroll = { scroll_to_bottom() {}, scroll_to_item() {} };
  const step = () => {
    clock += 16;
    for (const x of cx.timers) x.ms -= 16;
    cx.flush(16);
    log = [];
    let stopped = false;
    try { frame(v, cx); } catch (e) { if (e !== STOP) throw e; stopped = true; v.renderOpen = true; H.rec = null; }
    return { log, stopped };
  };
  for (let k = 0; (v.openActive() || v.staleRows?.length) && k < 800; k++) step();
  expect([v.openActive(), v.staleRows.length]).toEqual([false, 0]);
  step();
  const restale = (turn, chars = 0) => {
    if (chars) turn.prompt = `${turn.prompt} ${"kaz vel orin tam ".repeat(Math.ceil(chars / 17))}`;
    Object.assign(turn, { shapeKey: null, shapeFast: null, shapesKept: null });
    const i = v.baseRows.findIndex((r) => r.turn === turn);
    if (!v.staleRows.includes(i)) { v.staleRows.push(i); v.staleRows.sort((x, y) => x - y); }
    // As a rebuild that leaves rows to reshape asks for the walk.
    v.reshapeDue = true;
  };
  // Priced from here, with 65 draws on the priced clock first, so the draw's fixed cost
  // (frameBase, the last draw's) and the lightest of the last 64 (lightBase) are this clock's.
  const begin = () => { on = true; v.shapeRate = rate; for (let k = 0; k <= 64; k++) step(); };
  const end = () => { performance.now = realPerf; };
  // A new chunk of the session read (its version), as an agent writing its reply makes.
  const grow = () => { v.sessions[0].version++; };
  return { v, cx, step, turns: v.sessions[0].turns, restale, begin, end, grow, setBuild: (x) => { build = x; }, setAhead: (x) => { ahead = x; }, charge: (turn, ms) => extra.set(turn, ms) };
}
// Frames until nothing is left to reshape and the light frames after a stop are over.
function untilDone(v, step, max = 900) {
  const frames = [];
  for (let k = 0; k < max && (v.staleRows.length || v.cutUntil > performance.now() || frames.length < 3); k++) frames.push(step());
  return frames;
}

// A turn expected to cost 44 ms, with 10 ms of the draw after it: with the margin it fits no
// draw (44 + 10 + 3 > 50), so it can never fit. It runs only as its draw's first shaping unit,
// alone (unitAlone, counted in aloneRun): nothing else is shaped in that draw. It passes
// Herdr's limit once, in that draw, as one turn that size does on main. It ends before the
// stop (44 ms), so what it shaped is kept: no later draw shapes it again, and it has no mark,
// so a new width runs it alone once more.
test("shaping: a turn that can never fit runs alone as its draw's first unit, passes Herdr's limit once, and keeps its shape", async () => {
  const p = await pricedDrain();
  try {
    const big = p.turns.at(-3);
    const near = [p.turns.at(-1), p.turns.at(-2), p.turns.at(-4)];
    p.begin();
    p.restale(big, 44000);
    for (const t of near) p.restale(t);
    const alone0 = p.v.aloneRun ?? 0;
    const frames = untilDone(p.v, p.step);
    const withBig = frames.filter((f) => f.log.some((x) => x.turn === big));
    expect(withBig.length).toBe(1);
    expect(withBig[0].log.map((x) => x.turn === big)).toEqual([true]);
    expect(frames.filter((f) => f.stopped).length).toBe(1);
    expect(withBig[0].stopped).toBe(true);
    expect([p.v.staleRows.length, big.shapeKey != null, (p.v.aloneRun ?? 0) - alone0]).toEqual([0, true, 1]);
    for (const t of near) expect(frames.some((f) => f.log.some((x) => x.turn === t))).toBe(true);
    // A run that ended leaves no mark: after a new width it is run alone once more.
    expect(big.shapeMark ?? null).toBe(null);
    p.v.width -= 40;
    const again = untilDone(p.v, p.step);
    expect(again.filter((f) => f.log.some((x) => x.turn === big)).length).toBe(1);
  } finally { p.end(); }
}, 120000);

// A turn of 30 ms fits an empty draw (30 + 10 + 3 within 50) but not the draw it met, one that
// built rows for 25 ms first: refused, owed, and reshaped first in the next draw, ahead of a
// newer turn made stale in between that the walk would take first, with no stop.
test("shaping: a turn that fits an empty draw but not the one it met is reshaped first in the next, with no stop", async () => {
  const p = await pricedDrain();
  try {
    const t30 = p.turns.at(-3);
    const later = p.turns.at(-2);
    const at = (f) => f.log.map((x) => p.turns.indexOf(x.turn));
    p.begin();
    p.restale(t30, 30000);
    p.setBuild(25);
    const f1 = p.step();
    expect([at(f1), f1.stopped, p.v.staleRows.length]).toEqual([[], false, 1]);
    p.restale(later);
    const f2 = p.step();
    expect(at(f2)[0]).toBe(p.turns.indexOf(t30));
    const frames = [f1, f2, ...untilDone(p.v, p.step)];
    expect(frames.filter((f) => f.stopped).length).toBe(0);
    expect(frames.flatMap((f) => f.log).filter((x) => x.turn === t30).length).toBe(1);
    expect(frames.some((f) => f.log.some((x) => x.turn === later))).toBe(true);
    expect(p.v.staleRows.length).toBe(0);
  } finally { p.end(); }
}, 120000);

// Two turns that can never fit: one a draw, each alone, in the order the draw meets them (the
// turns in view from the top, shapeInView), each passing Herdr's limit once.
test("shaping: two turns that can never fit run one a draw, alone, in order", async () => {
  const p = await pricedDrain();
  try {
    const a = p.turns.at(-2);
    const b = p.turns.at(-4);
    p.begin();
    p.restale(a, 44000);
    p.restale(b, 44000);
    const frames = untilDone(p.v, p.step, 1400);
    const shaped = frames.filter((f) => f.log.length);
    expect(shaped.map((f) => f.log.map((x) => p.turns.indexOf(x.turn)))).toEqual([[p.turns.indexOf(b)], [p.turns.indexOf(a)]]);
    expect(frames.filter((f) => f.stopped).length).toBe(2);
    expect(p.v.staleRows.length).toBe(0);
  } finally { p.end(); }
}, 120000);

// The running turn keeps its own allowance: reshaped first in every draw while it fits. A long
// live reply that can never fit is not reshaped at each update (each would pass Herdr's limit,
// and after each stop the next came 5 s later): while it runs it keeps the shape it had, and
// once it ends it is shaped once, alone.
test("shaping: a running turn whose reply can never fit is not reshaped at each update, and is shaped once, alone, when it ends", async () => {
  const p = await pricedDrain();
  try {
    const live = p.turns.at(-1);
    live.done = false;
    p.grow();
    p.step();
    p.begin();
    // Fits: reshaped in every draw it grows in.
    let frames = [];
    for (let k = 0; k < 10; k++) { live.after.push(`More of the reply, line ${k}.`); p.grow(); frames.push(p.step()); }
    expect(frames.filter((f) => f.log.some((x) => x.turn === live)).length).toBe(10);
    // Grown past what can ever fit: 60 updates, no reshape of it and no stop.
    live.after.push("agrees with quil ".repeat(2600));
    frames = [];
    for (let k = 0; k < 60; k++) { live.after.push(`More of the reply, line ${k}.`); p.grow(); frames.push(p.step()); }
    expect([frames.filter((f) => f.log.some((x) => x.turn === live)).length, frames.filter((f) => f.stopped).length]).toEqual([0, 0]);
    // It ends: shaped once, alone.
    live.done = true;
    p.grow();
    frames = untilDone(p.v, p.step);
    const withLive = frames.filter((f) => f.log.some((x) => x.turn === live));
    expect(withLive.map((f) => f.log.length)).toEqual([1]);
    expect(frames.filter((f) => f.stopped).length).toBeLessThanOrEqual(1);
  } finally { p.end(); }
}, 120000);

// A turn of 60 ms, over Herdr's limit alone, on a clock that goes on past the 5 s after a
// stop: one alone run, cut at 50 ms (one stop), its mark left on the turn. In the 2,000 frames
// after (32 s, six times the 5 s) it is not run again: no retry, no further stop, and the
// reader keeps its last shape. A width change does not clear the mark (each step of a divider
// drag would cost a stop). New text does: one more alone run. The debug report counts the run,
// the cut found and the refusals since.
test("shaping: a turn whose run alone was cut by Herdr's stop is not run again for the same text, keeps its last shape, and is counted", async () => {
  const p = await pricedDrain();
  try {
    const big = p.turns.at(-3);
    p.begin();
    const before = big.shapeMemo;
    expect(before).toBeTruthy();
    p.restale(big, 60000);
    const row = () => p.v.baseRows.find((r) => r.turn === big);
    let frames = untilDone(p.v, p.step, 2000);
    const runs = (fs) => fs.filter((f) => f.log.some((x) => x.turn === big)).length;
    expect([runs(frames), frames.filter((f) => f.stopped).length, big.shapeMark?.cut]).toEqual([1, 1, true]);
    expect([row().shape === before, big.shapeMemo === before]).toEqual([true, true]);
    p.v.report();
    const d = () => state.shared["threads.debug"][p.v.terminal];
    expect([d().alone, d().aloneCut, d().cutHeld > 0]).toEqual([1, 1, true]);
    // A new width: every row reshaped, the cut turn still not run.
    p.v.width -= 40;
    frames = untilDone(p.v, p.step, 2000);
    expect([runs(frames), frames.filter((f) => f.stopped).length, big.shapeMark?.cut]).toEqual([0, 0, true]);
    // New text: run alone once more (and cut once more).
    p.restale(big, 20);
    frames = untilDone(p.v, p.step, 2000);
    expect([runs(frames), frames.filter((f) => f.stopped).length]).toEqual([1, 1]);
    p.v.report();
    expect([d().alone, d().aloneCut]).toEqual([2, 2]);
  } finally { p.end(); }
}, 300000);

// A turn whose estimate fits a draw (about 31 ms, with the 10 ms after it and the margin within
// 50) but whose reshape costs 60 ms more than that: a turn unlike the long turns the rate was
// learned on. Before, only a run alone was marked, and a cut teaches the rate nothing: it was
// run and cut every 5 s for good (7 runs and 7 stops in 32 s). Now its first run, not alone, is
// cut and leaves its mark; it next runs alone, as a draw's first unit; that run is cut too, and
// it is held for that text: two runs and two stops in 2,000 frames (32 s), and it keeps its
// last shape.
test("shaping: a turn that costs more than its estimate is cut once with others, once alone, and is then held for that text", async () => {
  const p = await pricedDrain();
  try {
    const big = p.turns.at(-3);
    p.begin();
    const before = big.shapeMemo;
    p.restale(big, 30000);
    p.charge(big, 60);
    expect(p.v.neverFits(p.v.hostCost(big, p.v.replyText(big)))).toBe(false);
    const alone = [];
    const reshape = p.v.reshape;
    p.v.reshape = function (...a) { if (a[0] === big && this.renderOpen) alone.push(Boolean(this.unitAlone)); return reshape.apply(this, a); };
    const frames = untilDone(p.v, p.step, 2000);
    expect([alone, frames.filter((f) => f.stopped).length]).toEqual([[false, true], 2]);
    expect([big.shapeMark?.alone, big.shapeMark?.cut, big.shapeKey ?? null, p.v.baseRows.find((r) => r.turn === big).shape === before]).toEqual([true, true, null, true]);
    p.v.report();
    const d = state.shared["threads.debug"][p.v.terminal];
    expect([d.sharedCut, d.aloneCut, d.cutHeld > 0]).toEqual([1, 1, true]);
  } finally { p.end(); }
}, 300000);

// The two-stop bound through the wait and the release: a text cut in company, then held by the
// time spent until its release, cut alone, then held. The turn of the cost test (30,000
// characters, 60 ms its estimate does not see) is cut in a run with others. From then on every
// draw has 25 ms of fixed work ahead of it, so its run alone, expected at about 30 ms, would end
// past the limit less the margin (cutWhereNow) and waits, owed and counted on screen. After a
// second 64 draws refused it runs alone all the same, is cut (the 60 ms), and is held for its
// text: two runs, two stops, and none after.
test("shaping: a text cut in company waits through the time spent to its release, is cut alone, and is then held: two stops for the text", async () => {
  const p = await pricedDrain();
  try {
    const big = p.turns.at(-3);
    p.begin();
    p.restale(big, 30000);
    p.charge(big, 60);
    const runs = [];
    const reshape = p.v.reshape;
    let k = 0;
    p.v.reshape = function (...a) { if (a[0] === big && this.renderOpen) runs.push([k, Boolean(this.unitAlone)]); return reshape.apply(this, a); };
    const frames = [];
    for (; k < 1200; k++) {
      const f = p.step();
      frames.push(f);
      if (f.stopped && runs.length === 1) p.setAhead(25);
    }
    const stops = frames.flatMap((f, i) => (f.stopped ? [i] : []));
    expect(runs.map(([, a]) => a)).toEqual([false, true]);
    expect(stops).toEqual(runs.map(([i]) => i));
    // The run alone waited out the 5 s of plain draws and then a second 64 draws refused.
    expect(runs[1][0] - runs[0][0]).toBeGreaterThanOrEqual(312 + 2 * 64 - 2);
    expect([big.shapeMark?.alone, big.shapeMark?.cut, big.shapeKey ?? null, p.v.sharedCut, p.v.aloneCut, p.v.cutHeld > 0]).toEqual([true, true, null, 1, 1, true]);
  } finally { p.end(); }
}, 300000);

// A turn cut after another turn in its draw overran: the first, expected at about 5 ms, costs
// 30; the second, expected at about 2, starts at 30 ms as its estimate fits what is left, costs
// 22, and is cut at 50 ms. Its mark says only that it was cut once, perhaps by a neighbour, so
// it is not held: it runs alone as the first draw after the 5 s of plain draws begins, ahead of
// a third turn left to reshape that the same draw would have shaped with it, and its shape is
// kept, with no further stop.
test("shaping: a turn cut after a neighbour overran in its draw runs alone next, is shaped, and is not held", async () => {
  const p = await pricedDrain({ after: 0 });
  try {
    const [first, cut, third] = [p.turns.at(-4), p.turns.at(-3), p.turns.at(-2)];
    p.begin();
    p.v.shapeBudget = 60;
    p.restale(first, 5000);
    p.charge(first, 25);
    p.restale(cut, 2000);
    p.charge(cut, 20);
    p.restale(third);
    const frames = untilDone(p.v, p.step, 2000);
    const with_ = (t) => frames.flatMap((f, k) => (f.log.some((x) => x.turn === t) ? [k] : []));
    const [a, b] = with_(cut);
    expect(with_(cut).length).toBe(2);
    expect([frames[a].log.map((x) => x.turn), frames[a].stopped]).toEqual([[first, cut], true]);
    expect([frames[b].log.map((x) => x.turn), frames[b].stopped]).toEqual([[cut], false]);
    expect(with_(third)[0]).toBeGreaterThan(b);
    expect([frames.filter((f) => f.stopped).length, cut.shapeKey != null, cut.shapeMark ?? null, p.v.staleRows.length]).toEqual([1, true, null, 0]);
    expect([p.v.sharedCut, p.v.aloneCut ?? 0]).toEqual([1, 0]);
  } finally { p.end(); }
}, 300000);

// Outside the walk nothing else checks a draw's end, so a turn never shaped, after the draw's
// first unit, goes ahead only if it is expected to end in time (fitsHost): in a rows build it
// otherwise waits for a later draw (its blank row drawn meanwhile). Two turns made never
// shaped, of about 8 and 35 ms at the rate learned (1 us a character), then a rebuild: the
// first is shaped in the build; the second, 9 ms in and expected to end at about 57 ms with
// the 10 ms after the rows, waits and is shaped as a later draw's first, with no draw stopped.
// Before, it ran 9 ms into the build's draw and the draw was stopped. Of 5 and 25 ms, the
// second is expected to end by about 44 ms and is shaped in the build all the same.
test("shaping: in a rows build, a turn never shaped after another unit is shaped if it is expected to end in time, and else waits for a later draw, and no draw is stopped", async () => {
  for (const [na, nb, inBuild] of [[8000, 35000, false], [5000, 25000, true]]) {
    const p = await pricedDrain();
    try {
      const [a, b] = [p.turns.at(-8), p.turns.at(-5)];
      p.begin();
      for (const [t, n] of [[a, na], [b, nb]]) {
        t.prompt = `${t.prompt} ${"kaz vel orin tam ".repeat(Math.ceil(n / 17))}`;
        Object.assign(t, { shapeKey: null, shapeFast: null, shapesKept: null });
      }
      // A rebuild of every row, as turning agent messages on makes.
      p.v.rowsKey = null;
      const built = p.step();
      const who = (f) => f.log.map((x) => (x.turn === a ? "a" : x.turn === b ? "b" : "other")).filter((x) => x !== "other");
      expect([nb, who(built), built.stopped]).toEqual([nb, inBuild ? ["a", "b"] : ["a"], false]);
      expect([nb, b.shapeKey != null]).toEqual([nb, inBuild]);
      const frames = [built, ...untilDone(p.v, p.step)];
      if (!inBuild) {
        const k = frames.findIndex((f) => f.log.some((x) => x.turn === b));
        expect(k).toBeGreaterThan(0);
        expect([frames[k].log[0].turn === b, frames[k].stopped]).toEqual([true, false]);
      }
      expect([nb, frames.filter((f) => f.stopped).length, b.shapeKey != null, p.v.staleRows.length]).toEqual([nb, 0, true, 0]);
    } finally { p.end(); }
  }
}, 300000);

// Rows never shaped, as the light draws after a stop leave them (on the rig, 3,791 of 5,600
// turns once the read ended), drained on a priced clock with 5 ms of the draw after the rows
// (the rig's draw after the list showed): 300 turns, most of 2 to 9 ms at the rate learned and
// 0.3 ms over it, and every seventh of 30 ms and 6 ms over it. A drain draw shapes for its
// shaping time (12 ms here), and after its first unit a turn never shaped starts only if its
// expected cost fits what is left, as on main: a 30 ms turn runs only as a draw's first, the
// rest of the draw keeps its room, and no draw is stopped. Before, a turn never shaped skipped
// that check and was held only by the fit check (fitsHost): a 30 ms turn started 10 ms into a
// draw, expected to end at 48 with the rest, and its miss took the draw past 50 (10 stops, and
// the drain not done in 3,000 draws). The rig showed the same on big5600b: drain frames of 45
// to 52 ms, where main's worst is 42, and a stop inside a reshape run in company.
test("shaping: rows never shaped are drained within the draw's shaping time, so a drain draw keeps room for the rest of the frame and none is stopped", async () => {
  const p = await pricedDrain({ n: 400, after: 5 });
  try {
    p.begin();
    const fresh = new Set(p.turns.slice(40, 340));
    const over = (x) => (x.cost > 25 ? 6 : 0.3);
    let i = 0;
    for (const t of fresh) { const big = i % 7 === 3; p.restale(t, big ? 30000 : 2000 + ((i * 1373) % 7000)); p.charge(t, big ? 6 : 0.3); i++; }
    const frames = untilDone(p.v, p.step, 3000);
    const late = [];
    for (const [k, f] of frames.entries()) {
      let spent = 0;
      for (const [j, x] of f.log.entries()) {
        if (j > 0 && fresh.has(x.turn) && spent + (x.cost - over(x)) > 12 + 0.01) late.push([k, j, Math.round(spent * 10) / 10, Math.round((x.cost - over(x)) * 10) / 10]);
        spent += x.cost;
      }
    }
    expect(late.slice(0, 5)).toEqual([]);
    expect([frames.filter((f) => f.stopped).length, [...fresh].filter((t) => t.shapeKey == null).length, p.v.staleRows.length]).toEqual([0, 0, 0]);
  } finally { p.end(); }
}, 300000);

// A limit, pinned as it is: the owed row is paid before the draw's rows build (payOwed, then
// rows()), and the build's slice is not cut by the time the owed row took. A turn of about 30
// ms on screen meets a 25 ms build and is owed; in the next draw it is paid first (30 ms, and
// 10 after the rows fit 50) and then that draw builds for x ms. With x 0 or 8 the draw ends
// in time; with 15 or 25 it passes 50 ms and is stopped, once the owed row's shape is stored,
// so the row is kept. A fix caps the build by the time left, or pays the owed row after rows().
test("shaping: an owed row is paid before the draw's rows build, whose slice does not count its time: with 15 ms of build or more after a 30 ms owed row the draw is stopped, and the row is kept", async () => {
  const got = [];
  for (const x of [0, 8, 15, 25]) {
    const p = await pricedDrain();
    try {
      const t = p.turns.at(-3);
      p.begin();
      p.setBuild(25);
      p.restale(t, 30000);
      const met = p.step();
      expect([x, met.log.some((r) => r.turn === t), p.v.lineOwed?.key === p.v.baseRows.find((r) => r.turn === t)?.key]).toEqual([x, false, true]);
      p.setBuild(x);
      const paid = p.step();
      got.push([x, paid.log[0]?.turn === t, paid.stopped, t.shapeKey != null]);
    } finally { p.end(); }
  }
  expect(got).toEqual([[0, true, false, true], [8, true, false, true], [15, true, true, true], [25, true, true, true]]);
}, 300000);

// The neighbour test's cut, with one more row left to reshape in every draw (restaled each
// frame, its text the same), as a drain, a search being typed or another owed row makes. Each
// draw reshapes that row before the cut turn reaches its run alone, so the turn, on screen, is
// refused for the units run before it. Refused so, it is owed and counted like any row on
// screen the fit check refuses (oweRow, refuse): the next draw tries it first (payOwed), where
// it runs alone and is kept, with no further stop. With 5 and 20 back the pane draws every row.
// In the third case it draws its last 12, so on screen and off differ: the other row, 6 back, is
// on screen above the cut turn (the rows in view are shaped from the top down, shapeInView, so
// it runs first), and a turn 40 back, off screen, with a cut-in-company
// mark of its own, is refused the same way in every draw but not owed, so it waits while the
// other row keeps reshaping.
test("shaping: a turn cut in company, with another row reshaped first in every draw, is owed on screen and runs alone first in a later draw, with no further stop", async () => {
  for (const [back, win] of [[5, false], [20, false], [6, true]]) {
    const p = await pricedDrain({ after: 0 });
    if (win) H.listWindow = (n) => ({ start: Math.max(0, n - 12), end: n });
    try {
      const [first, cut, third] = [p.turns.at(-4), p.turns.at(-3), p.turns.at(-2)];
      const other = p.turns.at(-back);
      const off = p.turns.at(-40);
      p.begin();
      p.v.shapeBudget = 60;
      if (win) {
        off.shapeMark = { sig: p.v.markSig(off, p.v.replyText(off)), alone: false, cut: true };
        p.restale(off);
      }
      p.restale(first, 5000);
      p.charge(first, 25);
      p.restale(cut, 2000);
      p.charge(cut, 20);
      p.restale(third);
      const frames = [];
      let shapedAt = -1;
      for (let k = 0; k < 1500; k++) {
        p.restale(other);
        frames.push(p.step());
        if (shapedAt < 0 && cut.shapeKey != null) shapedAt = k;
      }
      const runs = frames.flatMap((f, k) => (f.log.some((x) => x.turn === cut) ? [k] : []));
      // The first run, with first, is cut at 50 ms; the 5 s of plain draws after it shape
      // nothing (312 frames); the run alone comes within a few frames of their end.
      expect([back, frames.filter((f) => f.stopped).length, runs.length]).toEqual([back, 1, 2]);
      expect([back, frames[runs[1]].log[0].turn === cut, frames[runs[1]].stopped]).toEqual([back, true, false]);
      expect([back, shapedAt > 0 && shapedAt < 330, cut.shapeMark ?? null, cut.refused ?? null]).toEqual([back, true, null, null]);
      expect([back, p.v.sharedCut, p.v.aloneCut ?? 0, p.v.owedPaid > 0]).toEqual([back, 1, 0, true]);
      if (!win) continue;
      // The rows drawn are the last 12, and the turn off screen was never owed or run.
      const r = lastList.range;
      const shown = new Set(p.v.rowsMemo.slice(r.start, r.end).map((x) => x.turn).filter(Boolean));
      expect([back, shown.has(cut), shown.has(off)]).toEqual([back, true, false]);
      expect([back, frames.some((f) => f.log.some((x) => x.turn === off)), off.shapeKey ?? null]).toEqual([back, false, null]);
    } finally { H.listWindow = null; p.end(); }
  }
}, 300000);

// The release on that path: a text cut in company, then with 25 ms of fixed work ahead of every
// draw and another row reshaped first in each. The owed run alone is held by the time spent
// (cutWhereNow) where it is paid, before the walk, which counts nothing there (no row is on
// screen outside the walk); in the walk it is refused for the units run before it and counted
// on screen. So the count reaches its second 64 draws, and the turn runs alone, is cut and is
// held: two runs and two stops for the text. Uncounted, it would wait for good.
test("shaping: a text cut in company, with another row reshaped first in every draw and the time spent holding its run alone, is counted on screen and released after a second 64 draws", async () => {
  const p = await pricedDrain();
  try {
    const big = p.turns.at(-3);
    const other = p.turns.at(-2);
    p.begin();
    p.restale(big, 30000);
    p.charge(big, 60);
    const runs = [];
    const reshape = p.v.reshape;
    let k = 0;
    p.v.reshape = function (...a) { if (a[0] === big && this.renderOpen) runs.push([k, Boolean(this.unitAlone)]); return reshape.apply(this, a); };
    const frames = [];
    for (; k < 1200; k++) {
      if (runs.length) p.restale(other);
      const f = p.step();
      frames.push(f);
      if (f.stopped && runs.length === 1) p.setAhead(25);
    }
    const stops = frames.flatMap((f, i) => (f.stopped ? [i] : []));
    expect(runs.map(([, a]) => a)).toEqual([false, true]);
    expect(stops).toEqual(runs.map(([i]) => i));
    // Released after a second 64 draws in which other was reshaped ahead of it, once the 5 s of
    // plain draws after the first stop were over.
    expect(frames.slice(runs[0][0] + 1, runs[1][0]).filter((f) => f.log[0]?.turn === other).length).toBeGreaterThanOrEqual(2 * 64 - 2);
    expect([big.shapeMark?.alone, big.shapeMark?.cut, big.shapeKey ?? null, p.v.sharedCut, p.v.aloneCut]).toEqual([true, true, null, 1, 1]);
  } finally { p.end(); }
}, 300000);

// Herdr's stop landing after a turn's reshape has ended but before its shape is stored (here
// in shapeLearn, as if the stop came there): nothing of the run is kept, so it counts as a cut.
// The mark comes off only once the shape is stored, so the turn is held for that text: one
// run, one stop, in 2,000 frames.
test("shaping: a stop that lands after a turn's reshape but before its shape is stored counts as a cut", async () => {
  const p = await pricedDrain();
  try {
    const big = p.turns.at(-3);
    p.begin();
    p.restale(big, 44000);
    const learn = p.v.shapeLearn;
    p.v.shapeLearn = function (...a) { if (a[0] === big && this.renderOpen) throw STOP; return learn.apply(this, a); };
    const frames = untilDone(p.v, p.step, 2000);
    expect([frames.filter((f) => f.log.some((x) => x.turn === big)).length, frames.filter((f) => f.stopped).length]).toEqual([1, 1]);
    expect([big.shapeMark?.alone, big.shapeMark?.cut, big.shapeKey ?? null]).toEqual([true, true, null]);
  } finally { p.end(); }
}, 300000);

// A plain error thrown inside a turn's run alone (a reshape that fails on that text): the draw
// throws once, the mark stays as for a cut, and the turn is held for that text, so the error
// shows once, not at each draw after. New text runs it alone again: once more.
test("shaping: a plain error thrown inside a turn's run alone shows once, and the turn is held for that text", async () => {
  const p = await pricedDrain();
  try {
    const big = p.turns.at(-3);
    p.begin();
    p.restale(big, 44000);
    const BOOM = new Error("a made-up failure in a reshape");
    let runs = 0;
    let thrown = 0;
    const reshape = p.v.reshape;
    p.v.reshape = function (...a) {
      if (a[0] === big && this.renderOpen) { runs++; if (this.unitAlone) throw BOOM; }
      return reshape.apply(this, a);
    };
    const step = () => { try { p.step(); } catch (e) { if (e !== BOOM) throw e; thrown++; H.rec = null; } };
    for (let k = 0; k < 600; k++) step();
    expect([runs, thrown, big.shapeMark?.alone, big.shapeMark?.cut, big.shapeKey ?? null]).toEqual([1, 1, true, true, null]);
    p.restale(big, 20);
    for (let k = 0; k < 600; k++) step();
    expect([runs, thrown]).toEqual([2, 2]);
  } finally { p.end(); }
}, 300000);

// A turn never shaped whose run alone was cut: the reader sees the blank one-line row the pane
// draws for a row not yet shaped, with no throw and no further stop.
test("shaping: a turn never shaped whose run alone was cut shows the pane's unshaped row, with no throw and no further stop", async () => {
  const p = await pricedDrain();
  try {
    const big = p.turns.at(-3);
    p.begin();
    p.restale(big, 60000);
    // As a row the rows build made before it was ever shaped.
    big.shapeMemo = null;
    p.v.baseRows.find((r) => r.turn === big).shape = p.v.blankShape();
    const frames = untilDone(p.v, p.step, 2000);
    expect([frames.filter((f) => f.log.some((x) => x.turn === big)).length, frames.filter((f) => f.stopped).length, big.shapeKey ?? null]).toEqual([1, 1, null]);
    expect(p.v.baseRows.find((r) => r.turn === big).shape).toEqual(p.v.blankShape());
  } finally { p.end(); }
}, 300000);

// The mark is set only as a reshape in a draw starts, in shape() just before it: every reshape
// in a draw starts with its turn marked, as run alone or not, and a draw that is not stopped
// leaves no turn marked. Several turns that can never fit, in view and off it, through
// a new width (every row left to reshape, the walk ending early each draw) and a wheel up. The
// draw's 8 ms after its rows stop the draws that ran one alone once its reshape has ended: no
// run is cut, so no mark is left and no cut is counted.
test("shaping: a reshape in a draw is marked as it starts, run alone or not, and a draw not stopped leaves no mark", async () => {
  const p = await pricedDrain({ after: 8 });
  try {
    const big = [p.turns.at(-2), p.turns.at(-5), p.turns.at(-40), p.turns.at(-90)];
    p.begin();
    for (const t of big) p.restale(t, 44000);
    const at = [];
    const reshape = p.v.reshape;
    let alone = 0;
    p.v.reshape = function (...a) {
      if (this.renderOpen) { at.push(a[0].shapeMark?.alone === Boolean(this.unitAlone)); if (this.unitAlone) alone++; }
      return reshape.apply(this, a);
    };
    const marked = () => p.turns.filter((t) => t.shapeMark).length;
    const check = (frames) => { for (const f of frames) if (!f.stopped) expect(marked()).toBe(0); };
    const each = (n) => { const fs = []; for (let k = 0; k < n; k++) { fs.push(p.step()); check(fs.slice(-1)); } return fs; };
    // Each run alone here stops its draw, and the 5 s after a stop (312 frames) shape nothing.
    let frames = each(1600);
    p.v.width -= 40;
    frames = frames.concat(each(1600));
    p.v.wheelN = (p.v.wheelN ?? 0) + 1;
    p.v.follow = false;
    frames = frames.concat(each(400));
    expect([alone >= 8, at.length > alone]).toEqual([true, true]);
    expect(at.every(Boolean)).toBe(true);
    expect([frames.filter((f) => f.stopped).length > 0, marked(), p.v.aloneCut ?? 0]).toEqual([true, 0, 0]);
  } finally { p.end(); }
}, 300000);
