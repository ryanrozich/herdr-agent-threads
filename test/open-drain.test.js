// bun test: the opening's drain: once the list shows, the rows left to reshape drain
// behind it, newest first while following; the rows drawn first and within a draw's time
// otherwise; and a reader who leaves the end (a wheel, a jump, a pin, the outline) keeps the
// place. On the render harness (test/render-harness.js), which setup() starts clean.
import { test, expect, setSystemTime } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drawnText, frame, H, lastList, openingPane, settle, setup, state } from "./render-harness.js";

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
// The timers age pace ms a frame.
async function leaveDuringDrain(go, pace = 16) {
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
  } finally { H.listWindow = null; }
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
    // The list keeps its offset in px, so a row above the view that changes height moves what
    // is on screen unless the same frame asks for the end again.
    const above = () => v.slotsMemo.slice(0, v.viewRange[0]).reduce((x, y) => x + y, 0);
    const sel = v.sel;
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
      const x = step();
      const now = above();
      frames.push({ grew, moved: now !== was, end: x.end, bottom: v.bottomShown, follow: v.follow, sel: v.sel });
      was = now;
    }
    expect(v.staleRows).toEqual([]);
    expect(frames[5].grew).toBe(true);
    expect(frames[5].moved).toBe(true);
    // Heights above the view changed in most frames (each row reshaped there), and in every
    // frame the end was asked for in that frame, the reader still following, the end on screen
    // and the selection where it was.
    expect(frames.filter((f) => f.moved).length).toBeGreaterThan(frames.length / 2);
    for (const f of frames) expect([f.end, f.bottom, f.follow, f.sel]).toEqual([true, true, true, sel]);
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

// What the jump's fix must leave alone: a reader who stays at the end (j at the newest turn
// selects it again, with a scroll to it) and Jump to latest just after a jump, while it lands.
// Both keep the end in every frame to the end of the drain, and the rows above drain in each.
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
    // the newest turn's head shows for one frame, as at the commit before this fix.
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
    // in defer is left by that walk, as a turn left for its expected cost is.
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
    const pass = (follow) => {
      v.follow = follow;
      walked = [];
      const s0 = v.staleRows.filter((i) => v.baseRows[i].kind === "turn").sort((a, b) => a - b);
      v.reshapeStale(v.status());
      expect(walked.length).toBeGreaterThan(5);
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
    expect(pass(true)[2]).toBe(d);
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
// render), blank rows drawn, rows drawn, rows taken from outside them.
const wheelUp = (v, _cx, host) => { host.off = Math.max(0, host.off - 30000 / v.zoom()); v.listWheel({ delta: { y: 30000 } }); };
async function costlyWheel(ms, base, frames, move = wheelUp) {
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
    const reshape = v.reshape;
    v.reshape = function (...a) { if (this.renderOpen) starts.push(Math.round(clock - this.renderAt)); clock += ms; return reshape.apply(this, a); };
    const walk = v.reshapeStale;
    v.reshapeStale = function (...a) { if (this.renderOpen) clock += base; return walk.apply(this, a); };
    go(() => false);
    await settle(v);
    v.listH = 600;
    v.scroll = { scroll_to_bottom() { host.end = true; }, scroll_to_item(i) { host.want = i; } };
    const step = () => { for (const x of cx.timers) x.ms -= 16; cx.flush(16); starts = []; frame(v, cx); return starts; };
    for (let k = 0; v.openActive() && k < 600; k++) step();
    step();
    move(v, cx, host);
    const out = [];
    for (let k = 0; k < frames; k++) {
      const stale = new Set(v.staleRows);
      const s = step();
      const r = lastList.range;
      const off = v.rowsMemo[0]?.kind === "spacer" || v.rowsMemo[0]?.kind === "gap" ? 1 : 0;
      // Rows taken this frame from outside the rows drawn.
      const away = [...stale].filter((i) => !v.staleRows.includes(i) && (i + off < r.start || i + off >= r.end)).length;
      out.push({ starts: s, blank: blankInView(v), drawn: r.end - r.start, away });
    }
    return { v, frames: out };
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

// The draw's work before the walk takes 30, 34, 36 or 40 ms (a slow fit, or waited rows run
// before the frame), with rows of 8 ms and the view scrolled up into rows still to reshape.
// Before, past 35 ms the line let no reshape of the drain start: at 36 and 40 ms the rows on
// screen stayed empty bubbles in every frame and the drain stopped. The draw's first reshape
// goes past the line (up to HOST_MS), so every frame reshapes one row, the top row on screen
// first, and the rows on screen fill by the third frame after the wheel, as at 30 and 34 ms.
test("the opening: a draw that reaches its walk late still reshapes a row on screen in each frame, and the drain goes on", async () => {
  // Per start: frames without exactly one reshape, frames from the third with a blank row on
  // screen, and whether rows are still left after the 30.
  const got = [];
  for (const base of [30, 34, 36, 40]) {
    const { v, frames } = await costlyWheel(8, base, 30);
    got.push([base, frames.filter((f) => f.starts.length !== 1).length, frames.slice(2).filter((f) => f.blank > 0).length, v.staleRows.length > 400]);
  }
  expect(got).toEqual([30, 34, 36, 40].map((b) => [b, 0, 0, true]));
  // Past Herdr's stop (HOST_MS) not even the first starts: the draw is stopped there anyway.
  const { frames } = await costlyWheel(8, 52, 6);
  expect(frames.flatMap((f) => f.starts)).toEqual([]);
}, 120000);
