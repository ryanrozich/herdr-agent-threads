// agent-threads: the Trajectory pane's rows (the ledger), as data. Pure JavaScript with no
// Herdr imports, tested under bun (test/ledger.test.js); main.js draws what this returns.
//
// One turn is a heading row, then one row per cell of its trajectory (core/trajectory.js):
// the prompt, each text the agent wrote, each call, the reply, a background update. Every
// row is LEDGER_ROW px, the heading too, so the list knows every offset without measuring.
// Nothing here reads a file: a row is made from what the reader already holds.
//
// A row keeps its kind (lk), and what each kind looks like is in one table (LEDGER_KINDS),
// so a colour per kind is one change there. Each kind has an ink (TRAJ_INKS, trajInks) and a
// lane (Input, Model or Tools), which the filter buttons go by.

import { trajectory } from "./core/trajectory.js";
import { reply, stats, fmtClock, fmtTokens, fmtDuration, fmtTime } from "./core/turns.js";
import { outlineText, flattenMd, callTime, noticeTurn, kindWords } from "./ui.js";

export const LEDGER_ROW = 24;
// The pane's heading, as tall as the Pinned pane's.
export const LEDGER_HEAD = 40;
// The filter bar under the heading, from FILTER_MIN px wide.
export const LEDGER_FILTERS = 34;

// Each kind of row: its mark (an icon file, or a drawn "dot", "ring", "square"), the theme
// colour of its words (tone, a theme key) and whether the words are in the code face; its ink
// (the bar, the icon square's tint and the detail's tag, trajInks), the word on that tag, and
// its lane (null: none).
export const LEDGER_KINDS = Object.freeze({
  you: { mark: "user", tone: "foreground", ink: "user", tag: "User", lane: "input", label: "User message" },
  agent: { mark: "bot", tone: "muted", ink: "agent", tag: "Agent", lane: "input", label: "Agent message" },
  context: { mark: "reply", tone: "muted", ink: "context", tag: "Context", lane: "input", label: "Background update" },
  text: { mark: "list", tone: "muted", ink: "model", tag: "Model", lane: "model", label: "Text" },
  reply: { mark: "list", tone: "foreground", ink: "model", tag: "Reply", lane: "model", label: "Reply" },
  tool: { mark: "dot", tone: "foreground", code: true, ink: "tools", tag: "Tool", lane: "tools", label: "Tool call" },
  failed: { mark: "x", tone: "foreground", code: true, ink: "failed", tag: "Failed", lane: "tools", label: "Failed call", accent: "blocked" },
  running: { mark: "ring", tone: "foreground", code: true, ink: "tools", tag: "Tool", lane: "tools", label: "Running" },
  noresult: { mark: "ring", tone: "foreground", code: true, ink: "tools", tag: "Tool", lane: "tools", label: "No result", faint: true },
  subagent: { mark: "bot", tone: "foreground", ink: "sub", tag: "Subagent", lane: "tools", label: "Subagent" },
  more: { mark: null, tone: "dim", ink: "context", tag: "More", lane: "tools", label: "More calls" },
  stop: { mark: "square", tone: "muted", ink: "context", tag: "Stop", lane: null, label: "Interrupted" },
});

// The inks, each a tint like every other kind's: the user's messages blue, agent messages
// amber, the model violet, tool calls teal (a subagent's call the same teal at SUB_ALPHA), a
// failed call the theme's red, context the theme's dim. One shade per bar, and no gradient.
export const TRAJ_INKS = Object.freeze({
  user: Object.freeze({ light: "#2563EB", dark: "#7BA2FF" }),
  agent: Object.freeze({ light: "#87643A", dark: "#CC9A5E" }),
  model: Object.freeze({ light: "#7A48C0", dark: "#C49BEE" }),
  tools: Object.freeze({ light: "#1C7A6D", dark: "#5DBCAA" }),
  // The ledger row's small bar for an unfinished call, running or with no result.
  open: Object.freeze({ light: "#878C96", dark: "#747882" }),
});
export const SUB_ALPHA = 0.45;
// The user's colour: "blue" (the default) or "plain" (the text colour). The one place a
// setting can feed later.
export const USER_COLOR = "blue";
// Each ink as a colour for a theme t ({ foreground, dim, blocked }); dark: the theme is dark.
// sub is the tools colour, drawn at SUB_ALPHA.
export function trajInks(t, dark, user = USER_COLOR) {
  const pick = (k) => TRAJ_INKS[k][dark ? "dark" : "light"];
  return {
    user: user === "plain" ? t.foreground : pick("user"), plain: user === "plain",
    agent: pick("agent"), model: pick("model"), tools: pick("tools"), sub: pick("tools"),
    context: t.dim, failed: t.blocked, open: pick("open"),
  };
}
// A row's lane: "input", "model", "tools", or null.
export const laneOf = (lk) => LEDGER_KINDS[lk]?.lane ?? null;

// The status word after a row's words, for the kinds that have one.
const STATUS = { failed: "failed", running: "running", noresult: "no result" };

// ---- whether a turn is running (the running rule) ----
// A missing result does not prove the agent is still at work: a session killed with no turn
// end written would read as running for ever. So a turn is running only with evidence beyond
// that: the pane follows a terminal, the agent's process is alive there, the newest turn has
// no end record, and, for Claude Code (the one agent that reports a status), Herdr's status
// for the terminal is working or blocked. Anything else is unknown, and never shown as
// running: a call with no result then stops at the last thing the transcript recorded.
export function turnRunning({ followed = false, alive = false, open = false, reports = false, status = null } = {}) {
  if (!followed || !alive || !open) return false;
  return !reports || status === "working" || status === "blocked";
}

// A start, from the turn's start: "0:27", "12:05", "1:02:10".
export function startText(ms) { return fmtClock(Math.max(0, ms)); }
// A duration: "<0.1s", "0.3s", "42s", "6m 12s" (ui.js callTime, as the chat's calls), and
// "1h 04m" from an hour.
export function durText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  return ms >= 3600000 ? fmtDuration(ms) : callTime(null, null, ms);
}

// The bar's length, 0..1, on one scale for the whole session: each step of ten the same
// length, from a tenth of a second to an hour. A step under a tenth is the shortest bar.
const BAR_LO = Math.log10(100);
const BAR_HI = Math.log10(3600000);
export function barFrac(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  const f = (Math.log10(Math.max(ms, 100)) - BAR_LO) / (BAR_HI - BAR_LO);
  return 0.04 + 0.96 * Math.max(0, Math.min(1, f));
}
// The ledger row's small bar: 64 by 4 px. An unfinished call's bar fills the track and its
// right end is one 5 px slant.
export const BAR_W = 64;
export const BAR_H = 4;
export const BAR_SLANT = 5;
// The thin line under a turn heading: 3 px, an unfinished call's end one 4 px slant.
export const LINE_H = 3;
export const LINE_SLANT = 4;
// A slanted right end as a polygon, in px: [x, y] points of a bar from a to z, h tall, whose
// top runs d px past its foot. Under d px wide it is a plain box, never a sliver.
export function slantPoints(a, z, h, d) {
  if (z - a <= d) return [[a, 0], [z, 0], [z, h], [a, h]];
  return [[a, 0], [z, 0], [z - d, h], [a, h]];
}

// The pane's parts at a width: the start column from 420 px, the bar from 500 px,
// the filter bar from 540 px, and from 900 px the filters' long words and counts and the
// detail to the right of the ledger (under it when narrower).
export const FILTER_MIN = 540;
export const WIDE_MIN = 900;
// Below COMPACT_W (the pane's px, its frame in) the Trajectory draws one line a row: a step's kind mark, its turn's number and,
// when it fits, the duration at the right; a heading its number and the turn's total. Below
// ICON_W, the mark alone. The label and the time go into the row's tooltip. Rows keep
// LEDGER_ROW at every width, so the list's heights and scroll do not change across 200 px.
export const COMPACT_W = 200;
export const ICON_W = 64;
export const COMPACT_PAD = 4;
// In the Chat's own pane the compact heading holds the list icon (14 px) and a spacer, then the
// settings and Chat buttons (24 px each), 2 px apart, inside its padding: 76 px inside the frame.
// Narrower, the icon gives way so both buttons stay inside the pane.
export const HEAD_ICON_MIN = 2 * COMPACT_PAD + 14 + 2 + 2 + 24 + 2 + 24;
// A mono character at 11.5 px, for what fits.
const COMPACT_CH = 6.9;
export function trajCompact(width) {
  const w = Number.isFinite(width) ? width : COMPACT_W;
  return w >= COMPACT_W ? null : w >= ICON_W ? "line" : "icon";
}
// What a compact row shows at a pane's px: { mode, num, dur, tip }, num and dur null where they
// are not drawn. null at COMPACT_W and up. inner is the width inside the frame, for what fits.
// The tooltip has all the full row shows: a heading's time, calls, failures, tokens and total
// (headParts at any width); a step's label, subagent state and tokens, time, duration and its
// status as it is now.
export function compactRow(r, width, inner = width) {
  const mode = trajCompact(width);
  if (!mode || !r) return null;
  const head = r.kind === "trh";
  const n = head ? r.n : r.turn?.n;
  const num = n != null ? `#${n}` : "";
  const t = rowTimes(r);
  const dur = head ? (r.total != null ? durText(r.total) : "") : t.dur;
  let tip;
  if (head) {
    const p = headParts(r, Infinity);
    tip = [num, r.ts ? fmtTime(r.ts) : "", p.calls, p.failed, p.tokens, p.total].filter(Boolean).join(" · ");
  } else {
    const label = r.tool ? `${r.tool} ${r.text ?? ""}`.trim() : r.sender ? `${r.sender} · ${r.text ?? ""}` : (r.text ?? "");
    const sub = r.sub?.state && !r.failed ? [r.sub.state, r.sub.tokens ? `${fmtTokens(r.sub.tokens)} tok` : null] : [];
    tip = [num, label, ...sub, t.start, dur, r.status].filter(Boolean).join(" · ");
  }
  if (mode === "icon") return { mode, num: null, dur: null, tip };
  const room = inner - 2 * COMPACT_PAD - (head ? 0 : 16 + COMPACT_PAD) - num.length * COMPACT_CH;
  return { mode, num, dur: dur && room >= COMPACT_PAD + dur.length * COMPACT_CH ? dur : null, tip };
}

export function ledgerCols(width) {
  const w = Number.isFinite(width) ? width : 0;
  return { start: w >= 420, bar: w >= 500, filters: w >= FILTER_MIN, detailRight: w >= WIDE_MIN };
}

// The pane's layout by its dock (TRD-24). On the right (and in the Chat's own pane) the detail
// sits at the ledger's right, DETAIL_W wide, from WIDE_MIN, and under it narrower; the columns go
// by the pane's width (ledgerCols). Along the bottom (TRD-87, picks 3 and 4) the detail sits at
// the list's right from DOCK_SIDE_MIN, DOCK_DETAIL_MIN wide at least, taking what the list leaves
// past DOCK_LIST_MAX up to DOCK_DETAIL_MAX (a block of text about 85 characters wide), past which
// the list takes the rest; under DOCK_SIDE_MIN there is none, since under the list it
// would leave no rows at the dock's least height. There the list's start and bar columns go by
// the list's own width, and the filter bar, across the whole pane, by the pane's.
// open: whether the detail is shown, so the list has the width the detail leaves it.
// { side: "right" | "under" | "none", detailW (at the right; null otherwise), listW, cols }.
export const DETAIL_W = 300;
export const DOCK_SIDE_MIN = 700;
export const DOCK_LIST_MAX = 1100;
export const DOCK_DETAIL_MIN = 360;
export const DOCK_DETAIL_MAX = 640;
export function trajLayout(width, dock = "right", open = true) {
  const w = Number.isFinite(width) ? width : 0;
  const pane = ledgerCols(w);
  if (dock !== "bottom") {
    const side = pane.detailRight ? "right" : "under";
    return { side, detailW: side === "right" ? DETAIL_W : null, listW: side === "right" && open ? w - DETAIL_W : w, cols: pane };
  }
  const side = w >= DOCK_SIDE_MIN ? "right" : "none";
  const detailW = side === "right" ? Math.min(DOCK_DETAIL_MAX, Math.max(DOCK_DETAIL_MIN, w - DOCK_LIST_MAX)) : null;
  const listW = side === "right" && open ? w - detailW : w;
  const list = ledgerCols(listW);
  return { side, detailW, listW, cols: { start: list.start, bar: list.bar, filters: pane.filters, detailRight: side === "right" } };
}
// The whole LEDGER_ROW rows a list of this height keeps, less a timeline's height above it
// (TRD-23 shows the timeline only where enough rows are left). null when not measured yet.
export function rowsLeft(listH, timelineH = 0) {
  if (!Number.isFinite(listH)) return null;
  return Math.max(0, Math.floor((listH - timelineH) / LEDGER_ROW));
}

// The first line of a text, flattened from Markdown, at most 200 characters.
function firstLine(text) {
  const line = String(text ?? "").slice(0, 4000).split("\n").find((l) => l.trim()) ?? "";
  return flattenMd(line.slice(0, 800), 200).trim().slice(0, 200);
}

// Stretches of the turn's clock, merged where they touch, as fractions of the turn: [[a, b]].
// A stretch is at least `min` long so a call of a few ms still shows.
function stretches(list, t0, span, min = 0.006) {
  const segs = list.map(([s, e]) => [(s - t0) / span, (e - t0) / span])
    .map(([a, b]) => [Math.max(0, Math.min(1, a)), Math.max(0, Math.min(1, b))])
    .map(([a, b]) => (b - a < min ? [Math.max(0, Math.min(a, 1 - min)), Math.min(1, Math.max(a, 1 - min) + min)] : [a, b]))
    .sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const sg of segs) {
    const last = out[out.length - 1];
    if (last && sg[0] <= last[1]) last[1] = Math.max(last[1], sg[1]);
    else out.push([sg[0], sg[1]]);
  }
  return out;
}

// At most n stretches: the closest neighbours are joined until n are left, for a drawing
// that makes an element per stretch (the line without vector paths).
export function coarse(segs, n = 40) {
  const out = segs.map((x) => [x[0], x[1]]);
  while (out.length > n) {
    let best = 1;
    for (let i = 2; i < out.length; i++) if (out[i][0] - out[i - 1][1] < out[best][0] - out[best - 1][1]) best = i;
    out[best - 1][1] = Math.max(out[best - 1][1], out[best][1]);
    out.splice(best, 1);
  }
  return out;
}

// Whether a session's calls carry result times: any call in it with one. main.js also counts
// Claude Code, which always writes them, so its first turn killed mid-call is not misread.
export function sessionHasEnds(s) {
  for (const t of s?.turns ?? []) for (const st of t.steps ?? []) for (const x of st.info ?? []) if (x?.rt != null) return true;
  return false;
}

// One turn's rows: the heading, then a row per cell. si and the turn make the keys: the
// heading's key is the turn's own ("<session>:<number>", as in the chat), so the selected
// turn is the same key in the Chat and the Trajectory; a cell row is "tr:<session>:<number>:<i>".
// live: the turn is running by the running rule (turnRunning), so a call with no result yet is
// "running". Otherwise such a call is "no result", and its row and the heading carry the
// turn's last recorded activity (lastAt, ms). Either way its row bar fills the track, and its
// stretch of the heading's line ends at the turn's last recorded event, not at now.
// opts.ends: whether the agent writes result times (see sessionHasEnds); left out, this turn
// or its session decides.
// opts.reading: the last turn read so far of a session still being read. With no end read yet,
// its end may be in the part not read, so it claims nothing: no "no result" and no last
// activity, and a call with no end yet has blank fields (r.reading).
export function ledgerTurn(s, turn, si, live = false, opts = {}) {
  const tr = trajectory(s, turn);
  const reading = !live && opts.reading === true && !turn.done && !turn.interrupted;
  const key = `${si}:${turn.n}`;
  const t0 = tr.start;
  const hasReply = Boolean(reply(turn));
  const cells = [];
  // A message cell with no words (one that holds only the model's reasoning, which the pane's
  // reader never keeps) is no step of its own.
  for (const g of tr.groups) for (const c of g.cells) if (!(c.kind === "message" && !String(c.text ?? "").trim())) cells.push(c);
  // The reply is the last message cell when the turn has one (trajectory puts it last but
  // for a background update).
  let replyAt = -1;
  if (hasReply) for (let i = cells.length - 1; i >= 0; i--) if (cells[i].kind === "message") { replyAt = i; break; }
  // A turn with no time on any step (the turn's own start and end are not a step's): its
  // cells are left empty and its heading says so.
  const timed = t0 != null && cells.some((c, i) => i > 0 && c.start != null);
  // Whether the agent writes result times. Without them a call with no end is a call whose
  // outcome is not recorded (an ordinary row), not one with no result. That is the agent's
  // way, not the turn's: a turn killed during its only call has no end anywhere in it.
  const ends = opts.ends ?? (cells.some((c) => c.kind === "tool" && c.end != null) || sessionHasEnds(s));
  let lastTool = -1;
  for (let i = cells.length - 1; i >= 0 && lastTool < 0; i--) if (cells[i].kind === "tool") lastTool = i;
  const rows = [];
  let calls = 0;
  let fails = 0;
  let lastEnd = t0;
  // The line under the heading: calls (a subagent's apart, failed ones red), the reply, and
  // the unfinished calls, each drawn with its slanted end.
  const tools = [];
  const sub = [];
  const model = [];
  const red = [];
  const openAt = [];
  const openSub = [];
  cells.forEach((c, i) => {
    const r = { kind: "tr", key: `tr:${key}:${i}`, turn, si, lk: "text", text: "", tool: null, status: null, start: null, dur: null, startQ: false, durQ: false, failed: false };
    if (c.start != null) lastEnd = Math.max(lastEnd ?? c.start, c.start);
    if (c.end != null) lastEnd = Math.max(lastEnd ?? c.end, c.end);
    if (c.kind === "user") {
      // A task notification's turn has no message: its row says what the Chat's quiet line
      // says ("Background task finished"), never the notice's text.
      const notice = noticeTurn(turn);
      r.lk = turn.agent ? "agent" : "you";
      r.text = notice ? kindWords(turn.sender) : outlineText(c.text) || " ";
      r.sender = turn.agent && !notice ? turn.sender?.name ?? null : null;
      if (notice) r.notice = true;
      r.start = t0 != null ? 0 : null;
    } else if (c.kind === "message") {
      const isReply = i === replyAt;
      r.lk = isReply ? "reply" : "text";
      r.text = firstLine(c.text) || " ";
      if (c.start != null && t0 != null) r.start = c.start - t0;
      else r.startQ = true;
      if (isReply) {
        if (c.start != null && c.end != null) { r.dur = c.end - c.start; model.push([c.start, c.end]); }
        else r.durQ = true;
      }
    } else if (c.kind === "tool") {
      calls++;
      r.tool = String(c.tool ?? "tool");
      r.call = c.call ?? null;
      r.text = String(c.input ?? "").replace(/\s+/g, " ").trim();
      // A failed call: its result says so, or, for a subagent, its run ended failed (the
      // launch itself succeeds). A run stopped or killed is not a failure.
      const failed = c.result?.failed === true || c.subagent?.state === "failed";
      const ended = c.end != null;
      const open = Boolean(c.result) && !ended && !reading && (ends || (live && i === lastTool));
      r.lk = failed ? "failed" : c.subagent ? "subagent" : open ? (live ? "running" : "noresult") : "tool";
      // A subagent whose run has no end and no final state yet: unfinished too, drawn at the
      // subagent's SUB_ALPHA. Its row keeps the run's state as its words.
      const subOpen = Boolean(c.subagent) && !failed && !ended && !Number.isFinite(c.subagent.ms) && c.start != null
        && (c.subagent.state == null || c.subagent.state === "async_launched" || c.subagent.state === "running") && (ends || live) && !reading;
      if ((open && !c.subagent && !failed) || subOpen) r.open = true;
      if (c.subagent) {
        r.tool = "Agent";
        r.sub = { state: c.subagent.state ?? null, tokens: c.subagent.tokens ?? null };
      }
      r.status = STATUS[r.lk] ?? null;
      if (failed && r.sub?.tokens) r.status = `failed · ${fmtTokens(r.sub.tokens)} tok`;
      // A subagent the transcript last saw launched or running: only a running turn may say so
      // (the running rule). Otherwise its outcome is unknown, so it has no result.
      if (r.sub && !failed && !live && !reading && (r.sub.state === "running" || r.sub.state === "async_launched")) {
        r.sub = { ...r.sub, state: null };
        r.status = "no result";
        r.noResult = true;
      }
      r.failed = failed;
      if (failed) fails++;
      if (reading && !ended && !failed) r.reading = true;
      if (c.start != null && t0 != null) r.start = c.start - t0;
      else r.startQ = true;
      const ms = c.subagent?.ms ?? (c.start != null && c.end != null ? c.end - c.start : null);
      if (Number.isFinite(ms)) r.dur = ms;
      else if (!r.open && !r.reading && (r.lk === "tool" || r.lk === "subagent" || r.lk === "failed")) r.durQ = true;
      if (c.start != null && c.end != null) (failed ? red : c.subagent ? sub : tools).push([c.start, c.end]);
      else if (c.start != null && r.open) (subOpen ? openSub : openAt).push(c.start);
    } else if (c.kind === "more") {
      calls += c.count;
      r.lk = "more";
      r.text = `and ${c.count} more call${c.count === 1 ? "" : "s"}`;
      // The reader names and follows the first STEP_CALLS calls of a group; the rest are a
      // count, so whether any of them failed is not known (the failure counts read "N+").
      r.status = "results not kept";
    } else if (c.kind === "context") {
      r.lk = "context";
      r.text = firstLine(c.text) || " ";
      if (c.start != null && t0 != null) r.start = c.start - t0;
      else r.startQ = true;
    }
    if (!timed) { r.start = null; r.dur = null; r.startQ = false; r.durQ = false; }
    rows.push(r);
  });
  if (tr.interrupted) rows.push({ kind: "tr", key: `tr:${key}:stop`, turn, si, lk: "stop", text: "Interrupted", tool: null, status: null, start: timed && tr.end != null ? tr.end - t0 : null, dur: null, startQ: false, durQ: false, failed: false });
  const t1 = tr.end ?? lastEnd;
  const span = t0 != null && t1 != null ? t1 - t0 : null;
  // A turn with no end record that is not running: unknown. Its calls with no result stop at
  // the last recorded event, and the rows say when that was. (An unfinished turn's end time is
  // only its latest model message, so it is activity, not an end.)
  const stale = !live && !reading && !tr.done && !tr.interrupted;
  // The turn's last recorded activity. The heading shows it for a stale turn; a call with no
  // result shows it in any turn that is not running, and says "interrupted" only when the
  // turn is marked so.
  const activity = lastEnd != null || tr.end != null ? Math.max(lastEnd ?? tr.end, tr.end ?? lastEnd) : null;
  const lastAt = stale ? activity : null;
  if (!live) {
    for (const r of rows) {
      if (!(r.lk === "noresult" || r.noResult || (r.open && stale))) continue;
      if (activity != null) r.lastAt = activity;
      if (tr.interrupted) r.interrupted = true;
    }
  }
  const open = openAt.map((a) => [a, Math.max(a, t1)]);
  const opens = openSub.map((a) => [a, Math.max(a, t1)]);
  const line = timed && span > 0
    ? { tools: stretches(tools, t0, span), sub: stretches(sub, t0, span), model: stretches(model, t0, span), red: stretches(red, t0, span), open: stretches(open, t0, span), openSub: stretches(opens, t0, span) }
    : null;
  // The turn's own counts, for the filter buttons and the status line, and its steps on the
  // timeline (timeline.js): each row's lane, ink, start and end (ms from the turn's start; b
  // null for an instant, open for a call with no result yet) and, in the Tools lane, its
  // track (1: it started while another call ran, drawn half height).
  const cnt = { steps: 0, input: 0, model: 0, tools: 0, failed: 0, user: 0, agent: 0 };
  const items = [];
  let end0 = -Infinity;
  rows.forEach((r, i) => {
    const k = LEDGER_KINDS[r.lk];
    cnt.steps++;
    if (k?.lane) cnt[k.lane]++;
    if (r.failed) cnt.failed++;
    if (r.lk === "you") cnt.user++;
    if (r.lk === "agent") cnt.agent++;
    const a = r.start;
    const openBar = Boolean(r.open);
    const b = a != null && r.dur != null ? a + r.dur : null;
    let track = 0;
    if (k?.lane === "tools" && a != null) {
      track = a < end0 ? 1 : 0;
      if (track === 0) end0 = openBar ? Infinity : b ?? a;
    }
    const ink = k?.ink ?? "context";
    // The timeline's span keys for this step, made once (timelineLayout joins by them).
    const sk = k?.lane ? [`${k.lane}|${ink}|0`, `${k.lane}|${ink}|1`] : null;
    items.push({ key: r.key, i, lane: k?.lane ?? null, ink, a, b, open: openBar && a != null, track, failed: r.failed, lk: r.lk, sk });
  });
  const head = {
    // going, not live or running: those mark the chat's live rows, which tick a clock (main.js).
    kind: "trh", key, turn, si, n: turn.n, ts: turn.ts ?? null, going: live, calls, fails, timed,
    tokens: stats(turn).tokens, total: tr.end != null && t0 != null && (tr.done || tr.interrupted) ? tr.end - t0 : null,
    interrupted: Boolean(tr.interrupted), agent: Boolean(turn.agent), line, stale, lastAt, reading,
    // Calls past what the reader keeps: their failures are not known, so the count is a floor.
    partial: cells.some((c) => c.kind === "more"),
    t0, span, cnt, items,
    // The keys of its failed calls and of the user's messages, for the session's lists.
    failKeys: rows.filter((r) => r.failed).map((r) => r.key), userKeys: rows.filter((r) => r.lk === "you").map((r) => r.key),
  };
  return { rows: [head, ...rows], fails, calls };
}

// The heading's numbers at the right: "10 calls · 1 failed · 48.2k tok · 9m 44s". When
// narrow, tokens go first, then the call count; failures and the total stay. The failed
// count is its own part so the drawing can put the red dot before it. A turn that is neither
// running nor ended says "no result", never "running"; the last turn read so far of a session
// still being read (reading) says nothing.
export function headParts(h, width = 600) {
  const calls = h.calls ? `${h.calls} call${h.calls === 1 ? "" : "s"}` : null;
  const failed = h.fails ? `${h.fails}${h.partial ? "+" : ""} failed` : null;
  const tok = h.tokens ? `${fmtTokens(h.tokens)} tok` : null;
  const total = h.going ? "running" : h.interrupted ? "interrupted" : h.stale ? "no result" : h.reading ? null : !h.timed ? "no times" : durText(h.total) || null;
  return {
    calls: width >= 340 ? calls : null,
    failed,
    tokens: width >= 420 ? tok : null,
    total,
  };
}

// The session's numbers, worked out in one place for whatever draws them: turns, steps
// (rows that are not headings), calls and failures. rows are the ledger's rows.
export function ledgerTotals(rows) {
  const t = newTotals();
  for (const r of rows) addTotals(t, r);
  return t;
}
// The session's numbers before any row: also the rows in each lane, the user's and agents'
// messages, tokens and the time worked (from the headings), and the user's rows in order.
export function newTotals() {
  return { turns: 0, steps: 0, calls: 0, failed: 0, fails: [], partial: [], users: [], heads: [], input: 0, model: 0, tools: 0, user: 0, agent: 0, tokens: 0, worked: 0 };
}
// One row into the session's numbers: a heading brings its whole turn's (its counts and keys,
// made with its rows), so a build adds one object a turn, and a step row adds nothing.
export function addTotals(t, r) {
  if (r.kind !== "trh") return;
  const c = r.cnt ?? {};
  t.turns++;
  t.calls += r.calls;
  t.tokens += r.tokens ?? 0;
  t.worked += r.total ?? r.span ?? 0;
  t.heads.push(r);
  if (r.partial) t.partial.push(r.key);
  t.steps += c.steps ?? 0;
  t.input += c.input ?? 0;
  t.model += c.model ?? 0;
  t.tools += c.tools ?? 0;
  t.user += c.user ?? 0;
  t.agent += c.agent ?? 0;
  t.failed += c.failed ?? 0;
  for (const k of r.failKeys ?? []) t.fails.push(k);
  for (const k of r.userKeys ?? []) t.users.push(k);
}

// ---- the filter buttons ----
// The rows listed: Input, Model and Tools each take their lane's rows out when off; Failed
// only lists only failed calls, User only only the user's messages (one at a time). A heading
// is listed when any row of its turn is. Its counts are whole-session (ledgerTotals).
export const ALL_ROWS = Object.freeze({ input: true, model: true, tools: true, failed: false, user: false });
export function filterOn(f) { return Boolean(f) && (!f.input || !f.model || !f.tools || f.failed || f.user); }
export function passes(r, f) {
  if (r.kind !== "tr") return true;
  const lane = laneOf(r.lk);
  if (lane && !f[lane]) return false;
  if (f.failed) return r.failed === true;
  if (f.user) return r.lk === "you";
  return true;
}
// The listed rows, and how many steps are listed (n). A row that is not the ledger's (a
// session divider, a note) is kept.
export function filterRows(rows, f) {
  if (!filterOn(f)) return { rows, n: rows.filter((r) => r.kind === "tr").length };
  const out = [];
  let head = -1;
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.kind === "trh") { head = i; continue; }
    if (r.kind === "tr") {
      if (!passes(r, f)) continue;
      if (head >= 0) { out.push(rows[head]); head = -1; }
      n++;
    }
    out.push(r);
  }
  return { rows: out, n };
}
// The filter buttons, as data: [key, label, count]. From WIDE_MIN px Failed and User say
// "Failed only" and "User only", and each button carries its count.
// held: the first build of the rows is not done, so the counts would be of the newest turns
// only; the buttons show their labels alone.
export function filterButtons(totals, width, held = false) {
  const wide = width >= WIDE_MIN;
  return [
    ["input", "Input", totals.input], ["model", "Model", totals.model], ["tools", "Tools", totals.tools],
    ["failed", wide ? "Failed only" : "Failed", totals.failed], ["user", wide ? "User only" : "User", totals.user],
  ].map(([key, label, n]) => ({ key, label, count: wide && !held ? n : null }));
}
// A press on a filter button: a lane turns on or off; Failed only and User only are one at a
// time, and a second press turns it off.
export function toggleFilter(f, key) {
  const now = { ...(f ?? ALL_ROWS) };
  if (key === "failed" || key === "user") {
    const on = !now[key];
    now.failed = false;
    now.user = false;
    now[key] = on;
  } else now[key] = !now[key];
  return now;
}

// ---- the status line at the pane's foot ----
// Turns and steps, failed, tokens, time worked: the groups that fit, as the Chat's status line
// draws them ({ key, icon, text }). Time worked gives way under FILTER_MIN px, tokens under
// 420 px. A turn still running makes the time "so far".
export function ledgerStatus(t, width, going = false) {
  const many = (x, w) => `${x.toLocaleString()} ${w}${x === 1 ? "" : "s"}`;
  const out = [{ key: "turns", icon: "list", text: `${many(t.turns, "turn")} · ${many(t.steps, "step")}` }];
  if (t.failed) out.push({ key: "failed", icon: "circle-x", text: `${t.failed}${t.partial.length ? "+" : ""} failed` });
  if (t.tokens && width >= 420) out.push({ key: "tokens", icon: "database", text: `${fmtTokens(t.tokens)} tokens` });
  if (t.worked > 0 && width >= FILTER_MIN) out.push({ key: "worked", icon: "clock", text: `${durText(t.worked)} worked${going ? " so far" : ""}` });
  return out;
}

// A row's start and duration columns as text, and whether it draws a bar of its duration. A
// row with no time recorded leaves the column blank (the detail says "not recorded"). A row
// that says "no result" leaves its duration blank and draws no duration bar. A direct call with
// no result is open, and main.js ledgerBar draws the grey unfinished bar for it before it asks
// this; a subagent whose launch returned but whose run was never seen to finish is not open, so
// it shows no bar, and the launch call's time stays in the detail.
export function rowTimes(r) {
  const none = r.status === "no result";
  return {
    start: r.start != null ? startText(r.start) : "",
    dur: none || r.dur == null ? "" : durText(r.dur),
    bar: !none && r.dur != null && r.lk !== "more",
  };
}

// ---- the detail ----
// What the detail says about a row: its tag and title, its fields as [label, value] and its
// whole words (null for none). A heading's detail is its turn's numbers. A call with no result
// in a turn that is not running says so, with the last activity the transcript recorded.
export function detailOf(r) {
  if (!r) return null;
  if (r.kind === "trh") {
    const p = headParts(r, 10000);
    const F = [["Started", r.ts ? fmtTime(r.ts) : "not recorded"]];
    F.push(["Calls", r.calls ? `${r.calls}${r.partial ? " (some results not kept)" : ""}` : "none"]);
    if (r.fails) F.push(["Failed", `${r.fails}${r.partial ? "+" : ""}`]);
    if (p.tokens) F.push(["Tokens", p.tokens]);
    // A turn cut off mid-call has no time it took: it says so once, as its calls' detail does.
    if (r.stale) F.push(["Result", "No result"]);
    else F.push(["Took", p.total ?? (r.reading ? "" : "not recorded")]);
    if (r.lastAt != null) F.push(["Last activity", fmtTime(r.lastAt)]);
    return { kind: null, tag: "Turn", title: `Turn ${r.n}`, fields: F, text: null, code: false };
  }
  const k = LEDGER_KINDS[r.lk] ?? LEDGER_KINDS.text;
  const F = [];
  if (r.lk === "you") F.push(["From", "the user"]);
  else if (r.lk === "agent") F.push(["From", r.notice ? "the harness · a background task finished, nobody typed this" : `${r.sender ?? "an agent"} · another agent, not the user`]);
  else if (r.lk === "context") F.push(["From", "the harness · nobody typed this"]);
  if (r.turn?.n != null) F.push(["Turn", `${r.turn.n}`]);
  F.push(["Started", r.start != null ? `${startText(r.start)} into the turn` : r.startQ ? "not recorded" : "no times in this turn"]);
  const call = laneOf(r.lk) === "tools" && r.lk !== "more";
  // A call with no result took no time the transcript knows: Took is left out, and Result says
  // "No result" once.
  const cut = r.lk === "noresult" || r.noResult || (r.open && r.lastAt != null) || r.interrupted;
  if ((call || r.lk === "reply") && !(cut && r.dur == null)) {
    const took = r.dur != null ? durText(r.dur) : r.reading ? "" : r.lk === "running" || r.open ? "still running" : "not recorded";
    F.push(["Took", took]);
  }
  if (call) {
    const none = r.interrupted ? "No result: the turn was interrupted" : "No result";
    F.push(["Result", r.failed ? "failed" : r.reading ? "" : r.lk === "running" ? "Running, no result yet" : r.lk === "noresult" || r.noResult ? none : r.durQ ? "not recorded" : "ok"]);
    if (r.lastAt != null) F.push(["Last activity", fmtTime(r.lastAt)]);
    if (r.sub) F.push(["Subagent", [r.sub.state, r.sub.tokens ? `${fmtTokens(r.sub.tokens)} tok` : null].filter(Boolean).join(" · ") || "no state recorded"]);
  }
  if (r.lk === "more") F.push(["Result", "results not kept"]);
  const title = r.tool ? r.tool : k.label;
  return { kind: r.lk, tag: k.tag, title, fields: F, text: String(r.text ?? "").trim() || null, code: Boolean(k.code && r.tool) };
}
