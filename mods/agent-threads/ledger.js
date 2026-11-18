// agent-threads: the Trajectory view's rows (the ledger), as data. Pure JavaScript with no
// Herdr imports, tested under bun (test/ledger.test.js); main.js draws what this returns.
//
// One turn is a heading row, then one row per cell of its trajectory (core/trajectory.js):
// the prompt, each text the agent wrote, each call, the reply, a background update. Every
// row is LEDGER_ROW px, the heading too, so the list knows every offset without measuring.
// Nothing here reads a file: a row is made from what the reader already holds.
//
// A row keeps its kind (lk), and what each kind looks like is in one table (LEDGER_KINDS),
// so a colour per kind is one change there. Each kind has an ink (TRAJ_INKS, trajInks) and a
// lane of the timeline (Input, Model or Tools).

import { trajectory } from "./core/trajectory.js";
import { reply, stats, fmtClock, fmtTokens, fmtDuration, fmtTime } from "./core/turns.js";
import { outlineText, flattenMd, callTime } from "./ui.js";

export const LEDGER_ROW = 24;

// Each kind of row: its mark (an icon file, or a drawn "dot", "ring", "square"), the theme
// colour of its words (tone, a theme key) and whether the words are in the code face; its ink
// (the bar, the icon square's tint and the tag, trajInks), the word on its tag in a pane
// 900 px or wider, and its lane of the timeline (null: none).
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
// amber, the model violet, tool calls teal (a subagent's call the lighter teal: tools drawn at
// SUB_ALPHA), a failed call the theme's red, context and the system prompt the theme's dim.
// One shade per bar, and no gradient anywhere.
export const TRAJ_INKS = Object.freeze({
  user: Object.freeze({ light: "#2563EB", dark: "#7BA2FF" }),
  agent: Object.freeze({ light: "#87643A", dark: "#CC9A5E" }),
  model: Object.freeze({ light: "#7A48C0", dark: "#C49BEE" }),
  tools: Object.freeze({ light: "#1C7A6D", dark: "#5DBCAA" }),
});
export const SUB_ALPHA = 0.45;
// The user's colour: "blue" (the default) or "plain" (the text colour, with a neutral-tint
// square). The one place a setting can feed later.
export const USER_COLOR = "blue";
// Each ink as a colour for a theme t ({ foreground, dim, blocked }); dark: the theme is dark.
// sub is the tools colour, drawn at SUB_ALPHA.
export function trajInks(t, dark, user = USER_COLOR) {
  const pick = (k) => TRAJ_INKS[k][dark ? "dark" : "light"];
  return {
    user: user === "plain" ? t.foreground : pick("user"), plain: user === "plain",
    agent: pick("agent"), model: pick("model"), tools: pick("tools"), sub: pick("tools"),
    context: t.dim, failed: t.blocked,
  };
}
// A row's lane of the timeline: "input", "model", "tools", or null.
export const laneOf = (lk) => LEDGER_KINDS[lk]?.lane ?? null;

// The status word after a row's words, for the kinds that have one.
const STATUS = { failed: "failed", running: "running", noresult: "no result" };

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

// The columns at a pane width: the bar from 500 px, the start from 420 px; the switch's words
// become two icons under 420 px. The duration always stays.
export function ledgerCols(width) {
  return { bar: width >= 500, start: width >= 420, words: width >= 420 };
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

// Every row of a list h px tall, so the list can be given one number for its sizes: Herdr's
// v_virtual_list takes at most 10,000 sizes as an array (a 6,000-turn Trajectory has about
// 41,000 rows), and any count as one number. The spacer under a short list becomes as many
// h px fillers as fit in it (floor, so the list still fits); the gap under the floating top,
// the tail and any other row taller than h keep an h px first slot, followed by fillers
// (ceil). Fillers keep a spacer's, gap's or tail's kind, else are "fill"; their keys are
// "<key>:<k>". Returns the rows and sizes as they were when every row is h px already.
export function evenRows(rows, sizes, h = LEDGER_ROW) {
  if (sizes.every((x) => x === h)) return { rows, sizes };
  const out = [];
  const hs = [];
  rows.forEach((r, i) => {
    if (sizes[i] === h) { out.push(r); hs.push(h); return; }
    const pad = r.kind === "spacer" || r.kind === "gap" || r.kind === "tail";
    const n = r.kind === "spacer" ? Math.floor(sizes[i] / h) : Math.max(1, Math.ceil(sizes[i] / h));
    for (let k = 0; k < n; k++) {
      out.push(k > 0 ? { kind: pad ? r.kind : "fill", key: `${r.key}:${k}`, h } : pad ? { ...r, h } : r);
      hs.push(h);
    }
  });
  return { rows: out, sizes: hs };
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

// One turn's rows: the heading, then a row per cell. si and the turn make the keys: the
// heading's key is the turn's own ("<session>:<number>", as in the chat), so the selected
// turn is the same key in both views; a cell row is "tr:<session>:<number>:<i>".
// live: the turn is the running one, so a call with no result yet is "running", not "no result".
export function ledgerTurn(s, turn, si, live = false) {
  const tr = trajectory(s, turn);
  const key = `${si}:${turn.n}`;
  const t0 = tr.start;
  const hasReply = Boolean(reply(turn));
  const cells = [];
  for (const g of tr.groups) for (const c of g.cells) cells.push(c);
  // The reply is the last message cell when the turn has one (trajectory puts it last but
  // for a background update).
  let replyAt = -1;
  if (hasReply) for (let i = cells.length - 1; i >= 0; i--) if (cells[i].kind === "message") { replyAt = i; break; }
  // A turn with no time on any step (the turn's own start and end are not a step's): its
  // cells are left empty and its heading says so.
  const timed = t0 != null && cells.some((c, i) => i > 0 && c.start != null);
  // Whether this turn's calls carry result times at all. Without them a call with no end is a
  // call whose outcome is not recorded (an ordinary row), not one with no result.
  const ends = cells.some((c) => c.kind === "tool" && c.end != null);
  let lastTool = -1;
  for (let i = cells.length - 1; i >= 0 && lastTool < 0; i--) if (cells[i].kind === "tool") lastTool = i;
  const rows = [];
  let calls = 0;
  let fails = 0;
  let lastEnd = t0;
  // The line under the heading: calls (a subagent's apart, failed ones red) and the reply.
  const tools = [];
  const sub = [];
  const model = [];
  const red = [];
  const openAt = [];
  cells.forEach((c, i) => {
    const r = { kind: "tr", key: `tr:${key}:${i}`, turn, si, lk: "text", text: "", tool: null, status: null, start: null, dur: null, startQ: false, durQ: false, failed: false };
    if (c.start != null) lastEnd = Math.max(lastEnd ?? c.start, c.start);
    if (c.end != null) lastEnd = Math.max(lastEnd ?? c.end, c.end);
    if (c.kind === "user") {
      r.lk = turn.agent ? "agent" : "you";
      r.text = outlineText(c.text) || " ";
      r.sender = turn.agent ? turn.sender?.name ?? null : null;
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
      r.text = String(c.input ?? "").replace(/\s+/g, " ").trim();
      // A failed call: its result says so, or, for a subagent, its run ended failed (the
      // launch itself succeeds). A run stopped or killed is not a failure.
      const failed = c.result?.failed === true || c.subagent?.state === "failed";
      const ended = c.end != null;
      const open = Boolean(c.result) && !ended && (ends || (live && i === lastTool));
      r.lk = failed ? "failed" : c.subagent ? "subagent" : open ? (live ? "running" : "noresult") : "tool";
      if (c.subagent) {
        r.tool = "Agent";
        r.sub = { state: c.subagent.state ?? null, tokens: c.subagent.tokens ?? null };
      }
      r.status = STATUS[r.lk] ?? null;
      if (failed && r.sub?.tokens) r.status = `failed · ${fmtTokens(r.sub.tokens)} tok`;
      r.failed = failed;
      if (failed) fails++;
      if (c.start != null && t0 != null) r.start = c.start - t0;
      else r.startQ = true;
      const ms = c.subagent?.ms ?? (c.start != null && c.end != null ? c.end - c.start : null);
      if (Number.isFinite(ms)) r.dur = ms;
      else if (r.lk === "tool" || r.lk === "subagent" || r.lk === "failed") r.durQ = true;
      if (c.start != null && c.end != null) (failed ? red : c.subagent ? sub : tools).push([c.start, c.end]);
      // A call with no result: a flat bar to the turn's end (to now while it runs), drawn
      // plain until its mark is settled.
      else if (c.start != null && (r.lk === "running" || r.lk === "noresult")) openAt.push(c.start);
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
      r.startQ = true;
    }
    if (!timed) { r.start = null; r.dur = null; r.startQ = false; r.durQ = false; }
    rows.push(r);
  });
  if (tr.interrupted) rows.push({ kind: "tr", key: `tr:${key}:stop`, turn, si, lk: "stop", text: "Interrupted", tool: null, status: null, start: timed && tr.end != null ? tr.end - t0 : null, dur: null, startQ: false, durQ: false, failed: false });
  const t1 = tr.end ?? lastEnd;
  const span = t0 != null && t1 != null ? t1 - t0 : null;
  for (const a of openAt) tools.push([a, Math.max(a, t1)]);
  const line = timed && span > 0
    ? { tools: stretches(tools, t0, span), sub: stretches(sub, t0, span), model: stretches(model, t0, span), red: stretches(red, t0, span) }
    : null;
  // The turn's own counts, and its steps on the timeline: each row's lane, ink, start and end
  // (ms from the turn's start; b null for an instant, open for a call with no result yet) and,
  // in the Tools lane, its track (1: it started while another call ran, drawn half height).
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
    const openBar = r.lk === "running" || r.lk === "noresult";
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
    tokens: stats(turn).tokens, total: tr.end != null && t0 != null ? tr.end - t0 : null,
    interrupted: Boolean(tr.interrupted), agent: Boolean(turn.agent), line,
    // Calls past what the reader keeps: their failures are not known, so the count is a floor.
    partial: cells.some((c) => c.kind === "more"),
    // The turn's start (ms), and its length so far for a turn that has no end yet.
    t0, span, cnt, items,
    // The keys of its failed calls and of the user's messages, for the session's lists.
    failKeys: rows.filter((r) => r.failed).map((r) => r.key), userKeys: rows.filter((r) => r.lk === "you").map((r) => r.key),
  };
  return { rows: [head, ...rows], fails, calls };
}

// The heading's numbers at the right: "10 calls · 1 failed · 48.2k tok · 9m 44s". When
// narrow, tokens go first, then the call count; failures and the total stay. The failed
// count is its own part so the drawing can put the red dot before it.
export function headParts(h, width = 600) {
  const calls = h.calls ? `${h.calls} call${h.calls === 1 ? "" : "s"}` : null;
  const failed = h.fails ? `${h.fails}${h.partial ? "+" : ""} failed` : null;
  const tok = h.tokens ? `${fmtTokens(h.tokens)} tok` : null;
  const total = h.going ? "running" : h.interrupted ? "interrupted" : !h.timed ? "no times" : durText(h.total) || null;
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

// ---- the filter bar (round 6, section 3) ----
// The rows listed: the Input, Model and Tools chips each take their lane's rows out when off;
// Failed only lists only failed calls, User only only the user's messages (one at a time). A
// heading is listed when any row of its turn is. Its counts are whole-session (ledgerTotals).
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
// The listed rows and their sizes, and how many steps are listed (n). A row that is not the
// ledger's (a session divider, a note) is kept.
export function filterRows(rows, sizes, f) {
  const out = [];
  const hs = [];
  let head = -1;
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.kind === "trh") { head = i; continue; }
    if (r.kind === "tr") {
      if (!passes(r, f)) continue;
      if (head >= 0) { out.push(rows[head]); hs.push(sizes[head]); head = -1; }
      n++;
    }
    out.push(r);
    hs.push(sizes[i]);
  }
  return { rows: out, sizes: hs, n };
}

// ---- the detail (round 6, section 3) ----
// What the detail says about a row: its tag and title, its fields as [label, value] and its
// whole words (null for none). A heading's detail is its turn's numbers.
export function detailOf(r) {
  if (!r) return null;
  if (r.kind === "trh") {
    const p = headParts(r, 10000);
    const F = [["Started", r.ts ? fmtTime(r.ts) : "not recorded"]];
    F.push(["Calls", r.calls ? `${r.calls}${r.partial ? " (some results not kept)" : ""}` : "none"]);
    if (r.fails) F.push(["Failed", `${r.fails}${r.partial ? "+" : ""}`]);
    if (p.tokens) F.push(["Tokens", p.tokens]);
    F.push(["Took", p.total ?? "not recorded"]);
    return { kind: null, tag: "Turn", title: `Turn ${r.n}`, fields: F, text: null, code: false };
  }
  const k = LEDGER_KINDS[r.lk] ?? LEDGER_KINDS.text;
  const F = [];
  if (r.lk === "you") F.push(["From", "the user"]);
  else if (r.lk === "agent") F.push(["From", `${r.sender ?? "an agent"} · another agent, not the user`]);
  else if (r.lk === "context") F.push(["From", "the harness · nobody typed this"]);
  F.push(["Turn", `${r.turn?.n ?? "?"}`]);
  F.push(["Started", r.start != null ? `${startText(r.start)} into the turn` : r.startQ ? "not recorded" : "no times in this turn"]);
  const call = laneOf(r.lk) === "tools" && r.lk !== "more";
  if (call || r.lk === "reply") {
    const took = r.dur != null ? durText(r.dur) : r.lk === "running" ? "still running" : r.lk === "noresult" ? "no result" : "not recorded";
    F.push(["Took", took]);
  }
  if (call) {
    F.push(["Result", r.failed ? "failed" : r.lk === "running" ? "Running, no result yet" : r.lk === "noresult" ? "No result: the turn ended first" : r.durQ ? "not recorded" : "ok"]);
    if (r.sub) F.push(["Subagent", [r.sub.state, r.sub.tokens ? `${fmtTokens(r.sub.tokens)} tok` : null].filter(Boolean).join(" · ") || "no state recorded"]);
  }
  if (r.lk === "more") F.push(["Result", "results not kept"]);
  const title = r.tool ? r.tool : k.label;
  return { kind: r.lk, tag: k.tag, title, fields: F, text: String(r.text ?? "").trim() || null, code: Boolean(k.code && r.tool) };
}

// ---- the timeline (round 3 and round 7) ----
// The session as bars on three lanes, Input, Model and Tools, in a strip cw px wide. Two
// scales: "clock", where a turn is as wide as it took (never under a minimum) and the idle
// time between turns is folded into a fixed break, hatched; "steps", where every step gets
// the same width. heads are the ledger's headings in order (each carries its turn's steps,
// items, from ledgerTurn).
// It is made in two parts. timelineGeo places the turns with the whole session fitted to the
// strip (it walks the turns, not the steps). timelineLayout draws a view of that: zoomed z
// times and x0 px in (in zoomed px), the steps only of the turns in view, and of those only a
// turn wide enough to draw them (a turn under 2 px is one span per lane it has). Bars that
// touch are joined, so what is drawn is bounded by the strip's width, not the session's
// length, at any zoom.
// A call with no result yet is a plain flat bar to the turn's end (to now while the turn
// runs). nowMs: the clock, for a running turn.
export const TL_LANES = Object.freeze(["input", "model", "tools"]);
const wallOf = (h, nowMs) => {
  const w = h.going && h.t0 != null ? Math.max(h.span ?? 0, nowMs - h.t0) : (h.total ?? h.span ?? 0);
  return Number.isFinite(w) && w > 0 ? w : 0;
};
export function timelineGeo(heads, cw, scale = "clock", nowMs = Date.now()) {
  const n = heads.length;
  const geo = { cw, scale, turns: [], index: new Map(), walls: [], gap: 0, total: 0, steps: 0 };
  if (!n || !(cw > 0)) return geo;
  const GAP = cw < 700 ? 14 : 30;
  const MIN = cw < 700 ? 30 : 48;
  const gap = n > 1 ? Math.min(GAP, (0.15 * cw) / (n - 1)) : 0;
  const min = Math.min(MIN, (0.3 * cw) / n);
  const target = Math.max(1, cw - gap * (n - 1));
  const walls = heads.map((h) => wallOf(h, nowMs));
  for (const h of heads) geo.steps += Math.max(1, h.items?.length ?? 1);
  let widths;
  if (scale === "steps") {
    const sw = target / geo.steps;
    widths = heads.map((h) => Math.max(1, h.items?.length ?? 1) * sw);
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
// range: the focus range as { ia, ib, pos } (the first and last row's place in the ledger's
// rows, and every row's place): bars outside it get their own spans, with "|o" on the key.
// The rows a band holds, lo to hi px of the view L: the first and last whose bar starts inside
// it ({ a, b } keys, in order), or null when no bar starts there. Walks the turns the band
// covers, found by halving.
export function bandRows(L, heads, lo, hi, nowMs = Date.now()) {
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
    const wall = G.walls[ti] ?? wallOf(h, nowMs);
    for (const it of h?.items ?? []) {
      const bx = itemBox(it, T[ti].x * z - x0, T[ti].w * z, wall, L.scale, h.items.length);
      if (!bx || bx.x0 < lo || bx.x0 > hi) continue;
      if (a == null) a = it.key;
      b = it.key;
    }
  }
  return a == null ? null : { a, b };
}
export function timelineLayout(heads, cw, scale = "clock", nowMs = Date.now(), view = null, geo = null, range = null) {
  const G = geo ?? timelineGeo(heads, cw, scale, nowMs);
  const { z, x0 } = tlClamp(G, view);
  const out = { cw, scale, z, x0, geo: G, turns: G.turns, index: G.index, total: G.total, zmax: tlMaxZoom(G), gaps: [], spans: new Map(), labels: [], ticks: [], fails: [], from: 0, to: -1 };
  const n = G.turns.length;
  if (!n) return out;
  const walls = G.walls;
  // Spans by lane, ink and track: "tools|failed|0" -> [[x0, x1]], joined where they touch.
  const add = (k, a, b) => {
    let list = out.spans.get(k);
    if (!list) { list = []; out.spans.set(k, list); }
    const last = list[list.length - 1];
    if (last && a <= last[1] + 0.5) { if (b > last[1]) last[1] = b; return; }
    list.push([a, b]);
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
      const o = range && !(ih != null && ih <= range.ib && ih + (h.items?.length ?? 0) >= range.ia) ? "|o" : "";
      if (c.input) add(`${c.user ? "input|user|0" : c.agent ? "input|agent|0" : "input|context|0"}${o}`, x, x1);
      if (c.model) add(`model|model|0${o}`, x, x1);
      if (c.tools) add(`${c.failed ? "tools|failed|0" : "tools|tools|0"}${o}`, x, x1);
      if (c.failed && x >= failEnd) { out.fails.push(x + w / 2); failEnd = x + 6; }
    } else {
      for (const it of h.items ?? []) {
        const b = itemBox(it, x, w, walls[ti], scale, h.items.length);
        if (!b || !it.sk || b.x1 < -M || b.x0 > cw + M) continue;
        const ip = range ? range.pos.get(it.key) : null;
        add(range && !(ip != null && ip >= range.ia && ip <= range.ib) ? `${it.sk[b.track ? 1 : 0]}|o` : it.sk[b.track ? 1 : 0], b.x0, b.x1);
        if (it.failed && b.x0 >= failEnd) { out.fails.push((b.x0 + b.x1) / 2); failEnd = b.x0 + 6; }
      }
      // Ticks inside a wide turn: on the clock its time from the start, by steps its step
      // numbers. Only those in view.
      if (w >= 120) {
        if (scale === "steps") {
          const len = h.items.length;
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
// One step's box on the strip: x0 and x1 in px, and its track. A turn tx px in, w px wide, wall
// ms long, with len steps. null for a step with no time on the clock scale.
export function itemBox(it, tx, w, wall, scale, len) {
  if (scale === "steps") {
    const sw = w / Math.max(1, len);
    const pad = sw > 4 ? 1 : 0;
    return { x0: tx + it.i * sw + pad, x1: tx + (it.i + 1) * sw - pad, track: 0 };
  }
  if (it.a == null || !(wall > 0)) return null;
  const x0 = Math.min(tx + (it.a / wall) * w, tx + w - 3);
  const end = it.b != null ? tx + (it.b / wall) * w : it.open ? tx + w : x0 + 3;
  return { x0, x1: Math.max(x0 + 3, Math.min(end, tx + w)), track: it.track };
}
// The turn and step under px x of the strip in a lane: { turn, key } (key: the step's row,
// or the turn's heading when no step's bar is within 4 px). heads in the layout's order; x in
// px of the view (zoomed and panned).
export function timelineHit(L, heads, x, lane, nowMs = Date.now()) {
  const T = L.turns;
  if (!T.length) return null;
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
  const wall = wallOf(h, nowMs);
  const tx = t.x * z - x0;
  const tw = t.w * z;
  let best = null;
  let bestD = 4;
  for (const it of h.items ?? []) {
    if (lane && it.lane !== lane) continue;
    const b = itemBox(it, tx, tw, wall, L.scale, h.items.length);
    if (!b) continue;
    const d = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
    if (d < bestD || (d === 0 && bestD === 0 && it.track === 1)) { best = it; bestD = d; }
  }
  return { turn: h.key, key: best ? best.key : h.key };
}
