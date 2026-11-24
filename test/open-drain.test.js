// bun test: the opening's drain: once the list shows, the rows left to reshape drain
// behind it, newest first while following; the rows drawn first and within a draw's time
// otherwise; and a reader who leaves the end (a wheel, a jump, a pin, the outline) keeps the
// place. On the render harness (test/render-harness.js), which setup() starts clean.
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drawnText, frame, H, lastList, openingPane, settle, setup } from "./render-harness.js";

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
    // The turn's top is on screen once the landing's scrolls are drawn (48 ms), with most rows
    // left to reshape.
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
