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
    items.push({ key: r.key, i, lane: k?.lane ?? null, ink: k?.ink ?? "context", a, b, open: openBar && a != null, track, failed: r.failed, lk: r.lk });
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
// One row into the session's numbers.
export function addTotals(t, r) {
  if (r.kind === "trh") {
    t.turns++;
    t.calls += r.calls;
    t.tokens += r.tokens ?? 0;
    t.worked += r.total ?? r.span ?? 0;
    t.heads.push(r);
    if (r.partial) t.partial.push(r.key);
    return;
  }
  if (r.kind !== "tr") return;
  t.steps++;
  const lane = laneOf(r.lk);
  if (lane) t[lane]++;
  if (r.lk === "you") { t.user++; t.users.push(r.key); }
  if (r.lk === "agent") t.agent++;
  if (r.failed) { t.failed++; t.fails.push(r.key); }
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
