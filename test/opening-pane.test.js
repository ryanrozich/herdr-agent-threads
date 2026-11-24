// bun test: the opening of a pane (TRD-94), on the render harness (test/render-harness.js),
// which setup() starts clean: the first session opens at its end, still, with a loading state
// while it reads. Moved from render.test.js, which is near the 1 MiB lint-size limit.
import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { newSession as newSessionForTest } from "../mods/agent-threads/core/turns.js";
import { join } from "node:path";
import { statusGroups as statusGroupsForTest } from "../mods/agent-threads/ui.js";

import {
  busy,
  draw,
  drawnText,
  endInChunk2,
  fixture,
  frame,
  H,
  keyEv,
  lastList,
  openingPane,
  pane,
  settle,
  setup,
  until,
} from "./render-harness.js";

setup();

// ---- the opening (TRD-94): the pane's first session opens at its end, still ----
// Frames until the opening has shown the list (as Herdr draws: timers due, then a draw).
function openFrames(v, cx, n = 300) {
  const frames = [];
  for (let k = 0; k < n && v.openActive(); k++) { cx.flush(16); frames.push(frame(v, cx)); v.report(); }
  return frames;
}

test("the opening: while the session is read there are no rows and no scrolling, only the loading state; a turn whose end is in a later chunk is never running", async () => {
  const { v, cx, go } = await openingPane(endInChunk2(), (v) => v.current()?.offset > 0);
  go((v) => v.current()?.offset > 0);
  await until(() => v.current().offset > 0 && v.opening?.peek, "the first chunk");
  const s = v.current();
  expect(s.loaded).toBeFalsy();
  // The first chunk ends inside the turn: it has no end yet, and it is not the running turn.
  expect(s.turns.length).toBe(1);
  expect(s.turns[0].done).toBe(false);
  expect(v.isLive(s, 0, 0)).toBe(false);
  // Nor does the loading state say the agent is working: that waits for the whole read.
  expect(v.openInfo(s).working).toBe(false);
  // Within the quiet time, the background alone (the header says Reading…); then the loading
  // state. No list either way.
  H.lastList = null;
  const painted = v.opening.painted;
  v.opening.painted = false;
  v.opening.at = Date.now();
  expect(drawnText(frame(v, cx)).filter((x) => !/^Reading…/.test(x))).toEqual([]);
  v.opening.painted = painted;
  v.opening.at -= 1000;
  const said = drawnText(frame(v, cx));
  expect(lastList).toBeNull();
  expect(said).toContain("Reading this session");
  expect(said.join("|")).not.toMatch(/No reply yet|Working|Running/);
  // The status row says Reading, with no percentage: the loading state below says how much.
  expect(v.headerText()).toBe("Reading…");
  expect(said.filter((x) => /^Reading…/.test(x))).toEqual(["Reading…"]);
  // A wheel, a key and a press change nothing while it reads.
  const sel = v.sel;
  v.listWheel({ delta: { y: 120 } });
  v.key(keyEv("k"), cx);
  v.click("0:1", cx);
  expect([v.sel, v.follow]).toEqual([sel, true]);
  go(() => false);
  await settle(v);
  openFrames(v, cx);
  expect(v.openActive()).toBe(false);
  expect(s.turns[0].done).toBe(true);
  expect(v.isLive(s, 0, 0)).toBe(false);
});

test("the opening: the list shows at its end, still, with every row near it shaped (no empty bubbles), and the end held while parts above are measured", async () => {
  H.listWindow = (n) => ({ start: Math.max(0, n - 12), end: n });
  try {
    const { v, cx, go } = await openingPane(busy());
    v.opening.at -= 1000;
    draw(v, cx);
    expect(v.opening.painted).toBe(true);
    go(() => false);
    await settle(v);
    let bottoms = 0;
    const asked = [];
    v.scroll = { scroll_to_bottom() { bottoms++; }, scroll_to_item() {} };
    const frames = [];
    const states = [];
    while (v.openActive() && frames.length < 300) {
      cx.flush(16);
      const b0 = bottoms;
      const hidden = v.current().loaded;
      frames.push(frame(v, cx));
      asked.push(bottoms > b0);
      // Read but not shown yet: still Reading, and no Done (nor any state) before the list.
      if (hidden && v.openActive()) states.push([v.headerText(), v.agentStateNow(), drawnText(frames.at(-1)).includes("Done"), drawnText(frames.at(-1)).includes("Reading…")]);
      v.report();
    }
    expect(states.length).toBeGreaterThan(0);
    for (const x of states) expect(x).toEqual(["Reading…", null, false, true]);
    expect(v.openActive()).toBe(false);
    // The end is asked for in every frame drawn hidden, and in the one that shows the list.
    expect(asked.every(Boolean)).toBe(true);
    // Shown: the state is the agent's again.
    expect(v.agentStateNow()?.word).toBe("Done");
    expect(v.headerText()).not.toBe("Reading…");
    // Every frame before was the list hidden under the loading state.
    for (const f of frames.slice(0, -1)) expect(drawnText(f)).toContain("Reading this session");
    // Shown: built, at the end, with no blank shape near it (nearSpan).
    expect(v.rowJob).toBeNull();
    const [a, b, off] = v.nearSpan();
    expect(v.rowsMemo.slice(a + off, b + off).some((r) => r.shape?.blank)).toBe(false);
    expect(v.bottomShown).toBe(true);
    expect(v.partsWaiting(v.rowsMemo, ...v.viewRange)).toBe(false);
    // Each condition alone holds it back: a part in view unmeasured, the end off screen, or a
    // draw that did not have every row.
    const rows = v.rowsMemo;
    expect(v.openReady(rows)).toBe(true);
    const pw = v.partsWaiting;
    v.partsWaiting = () => true;
    expect(v.openReady(rows)).toBe(false);
    v.partsWaiting = pw;
    v.bottomShown = false;
    expect(v.openReady(rows)).toBe(false);
    v.bottomShown = true;
    const lr = v.lastRange;
    v.lastRange = `${String(lr).split("/")[0]}/${rows.length - 1}`;
    expect(v.openReady(rows)).toBe(false);
    v.lastRange = lr;
    // A rows build still going, or near the end a row left with an old shape (stale) or a
    // blank one. Further up, neither holds it back: those rows are shaped after it shows.
    const job = v.rowJob;
    v.rowJob = { made: "up" };
    expect(v.openReady(rows)).toBe(false);
    v.rowJob = job;
    expect(a).toBeGreaterThan(0);
    const stale = v.staleRows;
    for (const [i, held] of [[b - 1, true], [a, true], [a - 1, false], [0, false]]) {
      v.staleRows = [i];
      expect([i, v.openReady(rows)]).toEqual([i, !held]);
      const r = v.baseRows[i];
      const sh = r.shape;
      v.staleRows = stale;
      r.shape = { ...sh, blank: true };
      expect([i, v.openReady(rows)]).toEqual([i, !held]);
      r.shape = sh;
    }
    v.staleRows = stale;
    const left = v.shapeLeft;
    v.shapeLeft = 1;
    expect(v.openReady(rows)).toBe(true);
    v.shapeLeft = left;
    expect(v.openReady(rows)).toBe(true);
    // Parts above the end are still to measure: each frame asks for the end in that frame.
    expect(v.probeLeft).toBeGreaterThan(0);
    expect(v.openHold).toBe(true);
    bottoms = 0;
    for (let k = 0; k < 3; k++) draw(v, cx);
    expect(bottoms).toBe(3);
    expect(v.follow).toBe(true);
    // The frame that finds nothing left still asks: its slots carry the last measures.
    v.probeDue = () => { v.probeLeft = 0; return []; };
    bottoms = 0;
    draw(v, cx);
    expect(bottoms).toBe(1);
    expect(v.openHold).toBe(false);
  } finally { H.listWindow = null; }
});

test("the opening: a scroll up while parts above wait takes the place on screen and keeps it through the next wheels, until they are measured", async () => {
  H.listWindow = (n) => ({ start: Math.max(0, n - 12), end: n });
  try {
    const { v, cx, go } = await openingPane(busy());
    v.opening.at -= 1000;
    draw(v, cx);
    go(() => false);
    await settle(v);
    openFrames(v, cx);
    expect(v.openHold).toBe(true);
    v.listH = 600;
    v.listWheel({ delta: { y: 120 } });
    expect(v.follow).toBe(false);
    expect(v.anchor?.open).toBe(true);
    expect(v.openHold).toBe(false);
    draw(v, cx);
    const a = v.anchor;
    // A place still to take for a new column width (rows: anchorDue) is dropped with the old
    // one (dropAnchor): the wheel's own place is the one held.
    v.anchorDue = true;
    v.listWheel({ delta: { y: 60 } });
    expect(v.anchorDue).toBe(false);
    draw(v, cx);
    // Taken again at the new place, not let go by the wheel.
    expect(v.anchor?.open).toBe(true);
    expect(v.anchor).not.toBe(a);
    expect(v.holdDone()).not.toBe("scroll");
    // A wheel past the one it was taken at does not let it go either (an ordinary anchor goes).
    v.wheelN = v.anchor.wheels + 2;
    expect(v.holdDone()).not.toBe("scroll");
    v.anchor.open = false;
    expect(v.holdDone()).toBe("scroll");
  } finally { H.listWindow = null; }
});

test("the opening: a list ready within the quiet time is shown at once, and the loading state never paints", async () => {
  const { v, cx, go } = await openingPane(fixture("--extra", "3"));
  go(() => false);
  await settle(v);
  expect(Date.now() - v.opening.at).toBeLessThan(300);
  // Drawn hidden under the background alone until what it shows is measured, then shown.
  const said = openFrames(v, cx).flatMap(drawnText);
  expect(v.openActive()).toBe(false);
  expect(v.opening.painted).toBe(false);
  expect(said).not.toContain("Reading this session");
  expect(v.turnKeys(v.rows()).length).toBeGreaterThan(0);
});

test("the opening: the loading state's tokens are the status line's, and the newest prompt from the file's end is the newest one typed", async () => {
  const { v, go } = await openingPane(busy(), (v) => v.current()?.offset > 0);
  go((v) => v.current()?.offset > 0);
  await until(() => v.opening?.newest, "the newest prompt");
  const s = v.current();
  expect(s.loaded).toBeFalsy();
  const early = v.opening.newest;
  // The bar never goes back.
  v.openInfo(s);
  const pct = v.opening.pct;
  const off = s.offset;
  s.offset = 1;
  expect(v.openInfo(s).pct).toBe(pct);
  s.offset = off;
  go(() => false);
  await settle(v);
  const { newestPrompt } = await import("../mods/agent-threads/ui.js");
  expect(early).toEqual(newestPrompt(s.turns));
  const info = v.openInfo(s);
  // Found once for each version of the session, not in every draw (a whole prompt's white
  // space collapsed, a pasted one of 950 KB among them): a prompt changed under the same
  // version shows as it was, and the next version shows it.
  const you = s.turns.findLast((x) => x.sender?.kind === "you" && !x.cmd);
  const was = you.prompt;
  you.prompt = "a   changed\n prompt";
  expect(v.openInfo(s).newest).toEqual(info.newest);
  s.version++;
  expect(v.openInfo(s).newest.text).toBe("a changed prompt");
  you.prompt = was;
  s.version++;
  expect(info.tokens).toBe(v.statusStats().tokens);
  expect(info.tokens).toBeGreaterThan(0);
  // The status line's own words for them, at a width that has room for its tokens.
  const tokens = statusGroupsForTest(v.statusStats(), 2000).find((g) => g.key === "tokens")?.text ?? "";
  const { openLines } = await import("../mods/agent-threads/ui.js");
  expect(tokens.startsWith(openLines(info)[6].match(/· ([^·]+ tokens)/)[1])).toBe(true);
});

test("the opening: a session whose last turn runs says Working now once read, by the running turn's own test", async () => {
  const { v, cx, go } = await openingPane(fixture("--extra", "3", "--open"));
  go(() => false);
  await settle(v);
  draw(v, cx);
  const s = v.current();
  const last = s.turns.length - 1;
  expect(v.isLive(s, 0, last)).toBe(true);
  expect(v.openInfo(s).working).toBe(true);
  const { openLines } = await import("../mods/agent-threads/ui.js");
  expect(openLines(v.openInfo(s))[4]).toMatch(/ · Working now$/);
});

test("the opening: with nothing left to measure, the frame that shows the list and the one after still ask for the end (their slots carry the last measures)", async () => {
  const { v, cx, go } = await openingPane(fixture("--extra", "3"));
  go(() => false);
  await settle(v);
  v.probeDue = () => { v.probeLeft = 0; return []; };
  v.partsWaiting = () => false;
  let bottoms = 0;
  v.scroll = { scroll_to_bottom() { bottoms++; }, scroll_to_item() {} };
  const asked = [];
  // Frames until one is drawn with the list already shown.
  for (let was = true, k = 0; was && k < 300; k++) {
    cx.flush(16);
    const b0 = bottoms;
    was = v.openActive();
    frame(v, cx);
    asked.push([was, bottoms > b0]);
    v.report();
  }
  expect(v.openActive()).toBe(false);
  // Every frame up to and including the one that showed it, then the next one.
  expect(asked.length).toBeGreaterThanOrEqual(2);
  expect(asked.every(([, b]) => b)).toBe(true);
  expect(asked.at(-1)[0]).toBe(false);
  expect(v.openHold).toBe(false);
});

// The opening ends with any state other than its own once the session is read, failed or gone:
// the status row is the session's again, the agent's state shows, and the list's keys act.
function openEnded(v, cx, text) {
  for (let k = 0; k < 60; k++) { cx.flush(16); const f = frame(v, cx); v.report(); if (k === 59) expect(drawnText(f)).toContain(text); }
  expect(v.openActive()).toBe(false);
  expect(v.headerText()).not.toBe("Reading…");
  expect(v.headerText()).not.toBe("");
  v.filtering = false;
  v.key(keyEv("/"), cx);
  expect(v.filtering).toBe(true);
  v.filtering = false;
}

test("the opening ends when every turn read is hidden (No user messages yet): Done shows, and keys act", async () => {
  const file = fixture("--only", "0", "--agents");
  const { v, cx, go } = await openingPane(file, (v) => v.current()?.offset > 0);
  go((v) => v.current()?.offset > 0);
  await until(() => v.current().offset > 0, "the first chunk");
  expect(v.openActive()).toBe(true);
  // Only agent turns with no reply, and agent messages off: every turn is hidden.
  const s = v.current();
  s.turns = s.turns.filter((t) => t.agent);
  for (const t of s.turns) t.after = [];
  s.version++;
  go(() => false);
  await settle(v);
  expect(v.prefs.agentTurns).toBe(false);
  openEnded(v, cx, "No user messages yet");
  expect(v.counts().hiddenAll).toBeGreaterThan(0);
  expect(v.agentStateNow()).not.toBeNull();
});

test("the opening ends when the session is read with no turns (No turns yet: a new session's first line only)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-open-"));
  const file = join(dir, "e.jsonl");
  writeFileSync(file, `${JSON.stringify({ type: "summary", summary: "Made-up cart work", leafUuid: "u0" })}\n`);
  const { v, cx, go } = await openingPane(file);
  expect(v.openActive()).toBe(true);
  go(() => false);
  await settle(v);
  expect(v.current().turns.length).toBe(0);
  openEnded(v, cx, "No turns yet");
  expect(v.headerText()).toBe("0 turns");
});

test("the opening ends when the read fails before any turn (Couldn't read this session, with Retry)", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  H.extractHook = async () => { await gate; return { code: 3, stdout: "", stderr: "made-up failure" }; };
  try {
    const { v, cx } = await openingPane(busy());
    expect(v.openActive()).toBe(true);
    release();
    await until(() => v.current()?.error && !v.reading, "the failed read");
    openEnded(v, cx, "Couldn't read this session");
    expect(v.headerText()).toBe("Read failed");
  } finally { H.extractHook = null; }
});

test("the opening ends when the sessions are dropped and resolving finds none", async () => {
  const { v, cx, go } = await openingPane(busy(), (v) => v.current()?.offset > 0);
  expect(v.openActive()).toBe(true);
  // What a pick leaves (pick: the sessions dropped), then a resolution that found nothing.
  v.resolveGen = (v.resolveGen ?? 0) + 1;
  v.sessions = [];
  v.res = { kind: "none", tried: [], choices: [] };
  go(() => false);
  for (let k = 0; k < 10; k++) { cx.flush(16); frame(v, cx); v.report(); }
  expect(v.headerText()).toBe("No session");
  expect(v.openActive()).toBe(false);
  expect(v.headerText()).not.toBe("Reading…");
  v.filtering = false;
  v.key(keyEv("/"), cx);
  expect(v.filtering).toBe(true);
});

test("the opening: a frame when the quiet time ends paints the loading state, with nothing else asking for one (openTick)", async () => {
  const { v, cx } = await openingPane(busy());
  const o = v.opening;
  expect(o.painted).toBe(false);
  expect(Date.now() - o.at).toBeLessThan(300);
  // One timer for the end of the quiet time, and nothing else drawing meanwhile.
  const tick = cx.timers.filter((x) => x.ms >= 250 && x.ms <= 320);
  expect(tick.length).toBe(1);
  let notified = 0;
  cx.notifyHook = () => { notified++; };
  o.at -= 400;
  cx.timers = cx.timers.filter((x) => x !== tick[0]);
  tick[0].fn(cx);
  expect(notified).toBe(1);
  cx.notifyHook = null;
  expect(drawnText(frame(v, cx))).toContain("Reading this session");
  expect(o.painted).toBe(true);
});

test("the opening: a read started over part way never shows less than was shown (MB with the bar, turns, prompts, tool calls, tokens)", async () => {
  const { openLines } = await import("../mods/agent-threads/ui.js");
  const { v, go } = await openingPane(busy(), (v) => v.current()?.offset > 0 && v.current().turns.length > 3);
  go((v) => v.current()?.offset > 0 && v.current().turns.length > 3);
  await until(() => v.current().offset > 0 && v.current().turns.length > 3, "the first chunks");
  const s = v.current();
  // busy() has no tool counts in its status figures: 7 before, as a session with tools would.
  const stats = v.statusStats.bind(v);
  v.statusStats = () => ({ ...stats(), tools: 7 });
  const was = v.openInfo(s);
  const shown = openLines(was);
  expect(was.turns).toBeGreaterThan(3);
  expect(was.prompts).toBeGreaterThan(0);
  expect(was.tools).toBeGreaterThan(0);
  expect(was.tokens).toBeGreaterThan(0);
  // As a stall's recovery or a replaced file does: the session from the top again.
  v.restart(s);
  s.offset = 1;
  s.version++;
  v.statusStats = () => ({ ...stats(), tools: 0 });
  const now = v.openInfo(s);
  for (const k of ["offset", "size", "pct", "turns", "prompts", "tools", "tokens"]) expect(now[k]).toBe(was[k]);
  expect(openLines(now).slice(1, 3)).toEqual(shown.slice(1, 3));
  expect(openLines(now)[6]).toBe(shown[6]);
  go(() => false);
});

test("the opening: last active is the file's last write at the first chunk, and again once the read ends", async () => {
  // A copy of the shared busy fixture, whose time is changed below.
  const file = join(mkdtempSync(join(tmpdir(), "threads-open-")), "b.jsonl");
  writeFileSync(file, readFileSync(busy()));
  const { v, go } = await openingPane(file, (v) => v.current()?.offset > 0);
  go((v) => v.current()?.offset > 0);
  await until(() => v.opening?.mtime, "the first stat");
  const first = v.opening.mtime;
  // A write while it is read (as a live session's), with the size the same.
  const later = new Date(first + 90 * 60000);
  utimesSync(file, later, later);
  go(() => false);
  await settle(v);
  await until(() => v.opening.mtime !== first, "the stat at the end");
  expect(Math.abs(v.opening.mtime - later.getTime())).toBeLessThan(2000);
});

test("the opening: read, with its first rows still being built, keeps the loading state (no other state ends it)", async () => {
  const { v, cx, go } = await openingPane(busy());
  v.opening.at -= 1000;
  go(() => false);
  await settle(v);
  expect(v.openActive()).toBe(true);
  // As the first slice of a rows build leaves it: a job going on and no row yet.
  const rows = v.rows;
  v.rows = () => { v.rowJob = { made: "up" }; v.baseRows = []; return []; };
  try {
    const said = drawnText(frame(v, cx));
    expect(said).toContain("Reading this session");
    expect(v.openActive()).toBe(true);
  } finally { v.rows = rows; v.rowJob = null; v.baseRows = null; }
});

test("the opening: a new session on the list while the first is read starts from its own figures, not the first one's peaks", async () => {
  const { openLines } = await import("../mods/agent-threads/ui.js");
  const { v, go } = await openingPane(busy(), (v) => v.current()?.offset > 0 && v.current().turns.length > 3);
  go((v) => v.current()?.offset > 0 && v.current().turns.length > 3);
  await until(() => v.current().offset > 0 && v.current().turns.length > 3 && v.opening?.mtime && v.opening?.newest, "the first chunks, stat and peek");
  const was = v.openInfo(v.current());
  expect(was.turns).toBeGreaterThan(3);
  expect(was.pct).toBeGreaterThan(0);
  expect(was.active).toBeGreaterThan(0);
  expect(was.newest?.text).toBeTruthy();
  // A /clear part way: a new session of 5 KB, nothing of it read yet, on the same list.
  const n = newSessionForTest("made-up-new", join(mkdtempSync(join(tmpdir(), "threads-open-")), "n.jsonl"));
  n.size = 5000;
  v.sessions.push(n);
  expect(v.current()).toBe(n);
  const now = v.openInfo(n);
  expect([now.offset, now.size, now.pct, now.turns]).toEqual([0, 5000, null, 0]);
  // In the frame before its read starts: no last write and no newest prompt of the first's.
  expect([now.active, now.newest]).toEqual([null, null]);
  expect(openLines(now)[7]).toBe("");
  expect(openLines(now)[1]).not.toContain("of");
  expect(openLines(now)[1]).toBe("5 KB");
  expect(openLines(now)[2]).toBe("");
  go(() => false);
});

test("the opening: a new session on the list with the same version and turn count as the first sums its own figures, never keeps the first one's", async () => {
  const { v, go } = await openingPane(busy(), (v) => v.current()?.offset > 0 && v.current().turns.length > 3);
  go((v) => v.current()?.offset > 0 && v.current().turns.length > 3);
  await until(() => v.current().offset > 0 && v.current().turns.length > 3, "the first chunks");
  const first = v.current();
  const stats = v.statusStats.bind(v);
  v.statusStats = () => ({ ...stats(), tools: 7, tokens: 7000 });
  const was = v.openInfo(first);
  expect([was.tools, was.tokens]).toEqual([7, 7000]);
  // A /clear part way: a new session whose version, turn count and read state match the
  // first's, with its own model and figures.
  const n = newSessionForTest("made-up-new", join(mkdtempSync(join(tmpdir(), "threads-open-")), "n.jsonl"));
  n.turns = first.turns.map((t) => ({ ...t, model: "made-up-model-b" }));
  n.version = first.version;
  n.loaded = first.loaded;
  n.offset = first.offset;
  n.size = first.size;
  v.sessions.push(n);
  expect(v.current()).toBe(n);
  v.statusStats = () => ({ ...stats(), tools: 3, tokens: 300 });
  const now = v.openInfo(n);
  expect([now.tools, now.tokens, now.model]).toEqual([3, 300, "made-up-model-b"]);
  go(() => false);
});

test("the opening: a new session on the list while the first is read shows its own last write and newest prompt, never the first one's", async () => {
  const { openLines } = await import("../mods/agent-threads/ui.js");
  const { v, cx, go } = await openingPane(busy(), (v) => v.current()?.offset > 0);
  go((v) => v.current()?.offset > 0);
  await until(() => v.opening?.mtime && v.opening?.newest, "the first session's stat and peek");
  const first = v.current();
  const was = { mtime: v.opening.mtime, newest: v.opening.newest.text };
  expect(openLines(v.openInfo(first))[7]).toMatch(/^Newest prompt/);
  // A /clear part way: another session, over a chunk so the loading state stays up and its
  // end is peeked, its newest prompt in other words, last written two days before the first.
  const file = join(mkdtempSync(join(tmpdir(), "threads-open-")), "second.jsonl");
  writeFileSync(file, readFileSync(busy(), "utf8").replaceAll(was.newest, "Sort the made-up changelog by date"));
  const old = new Date(was.mtime - 2 * 86400000);
  utimesSync(file, old, old);
  // What the opening holds when the second's first chunk is in, before its peek, with no
  // frame drawn in between: the reset is the read's, not the next frame's.
  const atPeek = [];
  const peek = v.openPeek.bind(v);
  v.openPeek = (s, cx) => { atPeek.push({ s, mtime: v.opening.mtime, newest: v.opening.newest }); peek(s, cx); };
  v.adopt({ kind: "found", id: "made-up-second", file, live: true }, cx);
  const second = v.current();
  expect(second).not.toBe(first);
  // Its first chunk: stat and peek again, for this session.
  go((v) => v.current() === second && second.offset > 0);
  await until(() => second.offset > 0 && v.opening.newest && v.opening.mtime, "the second session's stat and peek");
  expect(atPeek.map((x) => [x.s === second, x.mtime, x.newest])).toEqual([[true, null, null]]);
  expect(v.openActive()).toBe(true);
  const info = v.openInfo(second);
  expect(Math.abs(info.active - old.getTime())).toBeLessThan(2000);
  expect(info.newest.text).toBe("Sort the made-up changelog by date");
  expect(openLines(info)[8]).toBe("Sort the made-up changelog by date");
  // A stat of the first session that comes back late lands nowhere.
  v.openStat(first, cx);
  await new Promise((r) => setTimeout(r, 300));
  expect(Math.abs(v.opening.mtime - old.getTime())).toBeLessThan(2000);
  go(() => false);
}, 20000);

test("the opening: the first session's stat and peek that come back after another session took the list land nowhere", async () => {
  const n = newSessionForTest("made-up-new", join(mkdtempSync(join(tmpdir(), "threads-open-")), "n.jsonl"));
  n.size = 5000;
  let switched = false;
  // At the first chunk's pause, its stat and peek just asked for: the list changes there.
  const hold = (v) => {
    if (!switched && v.opening?.peek) {
      switched = true;
      v.sessions.push(n);
      v.openInfo(n);
    }
    return true;
  };
  const { v, go } = await openingPane(busy(), hold);
  go(hold);
  await until(() => switched, "the first chunk");
  expect(v.current()).toBe(n);
  // Long enough for both to come back (each is one short call).
  await new Promise((r) => setTimeout(r, 600));
  expect([v.opening.mtime, v.opening.newest]).toEqual([null, null]);
  go(() => false);
});

test("a later session still being read, with no loading state over it, shows no running turn before a later chunk has the turn's end", async () => {
  let second = null;
  const { v, cx, go } = await openingPane(busy(), (v) => second != null && v.current() === second && second.offset > 0);
  v.opening.at -= 1000;
  go((v) => second != null && v.current() === second && second.offset > 0);
  await settle(v);
  openFrames(v, cx);
  expect(v.openActive()).toBe(false);
  // A new session (a /clear) whose first turn ends in its second chunk, held after the first.
  v.adopt({ kind: "found", id: "made-up-second", file: endInChunk2(), live: true }, cx);
  second = v.current();
  await until(() => second.offset > 0, "the second session's first chunk");
  expect([Boolean(second.loaded), second.turns.length, second.turns[0].done]).toEqual([false, 1, false]);
  expect(v.isLive(second, 1, 0)).toBe(false);
  // Not the running turn: no live row, and no working card.
  const rows = v.rows();
  expect(rows.filter((r) => r.live || r.running).map((r) => r.kind)).toEqual([]);
  expect(drawnText(frame(v, cx)).join("|")).not.toMatch(/No reply yet|Working/);
  go(() => false);
  await settle(v);
  expect(second.turns[0].done).toBe(true);
}, 30000);

test("the agent message counts follow a session's read ending: a running agent turn counted hidden while read is shown once it is", async () => {
  const { v } = await pane(fixture("--extra", "2"));
  const s = v.current();
  v.prefs = { ...v.prefs, agentTurns: false };
  // The newest turn an agent message, still running, as a read leaves it before its end.
  const t = s.turns[s.turns.length - 1];
  t.agent = true;
  t.sender = { kind: "agent", name: "made-up-bot" };
  t.done = false;
  s.loaded = false;
  const before = v.counts();
  // The read ends: loaded, and nothing else about the turns changes.
  s.loaded = true;
  expect(v.isLive(s, v.sessions.length - 1, s.turns.length - 1)).toBe(true);
  const after = v.counts();
  v.countsKey = null;
  const fresh = v.counts();
  expect(after).toEqual(fresh);
  expect(fresh).not.toEqual(before);
});
