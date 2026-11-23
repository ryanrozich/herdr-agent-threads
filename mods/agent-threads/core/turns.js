// agent-threads: turns from extractor events. Plain JavaScript with no Herdr imports, so
// the tests run it under bun or node.
//
// One row per prompt a person (or another session, or a schedule) gave the agent, and one
// per task notification that wakes the agent after a row has ended (its sender is
// "task-notification"). Auto-continuations, and task notifications that land while a row
// is still open, are folded into the row above: their tokens and tool calls count, their
// text does not replace the row's final reply.
//
// A slash command line (/usage, /clear, a skill) waits as s.pendingCmd. Local commands
// never start a model turn, so they never become rows; a skill or custom command does,
// and becomes a row titled "/name args". Its text is a meta line naming the command line as
// parent, which makes the row at once, even with another row open. Failing that, the row
// comes when the model starts working between turns. A command line logged during a turn
// with no such meta line never becomes a row: the model events after it belong to that turn.
//
// A row closes when the model finishes a reply (an "s" event). Claude Code writes the
// turn_duration line ("d") for most turns but not all: it can stop for days in one session,
// so that line alone would leave a row open and pile every later turn onto it. When it does
// come, its time replaces the estimate an "s" made. A tool call never holds a row open.
//
// A prompt that arrives while a row is still open (a peer message, a queued or scheduled
// prompt) takes everything after it. An open row that has its reply ends there. One with no
// reply waits: Claude answers both in one model turn, and the next close marks it answered
// together. Only an interrupt line marks a row interrupted.
//
// A restart or a usage limit can end a turn with no reply: only "No response requested." or
// a limit message. When the next prompt's turn then replies, the first row says "Answered in
// #N" (turn.answeredIn), since that reply follows on from it. Who sent the next prompt does
// not matter: text sent through hc is written just as typed text is.
//
// Every row has a sender: the person ("you"), an hc report or request (a human-origin
// prompt wrapped in <hc from="...">), a peer session (<agent-message from="...">), a
// schedule or the SDK. turn.agent is true for every sender but the person, and the shown
// prompt is the message without its wrapper tags. A typed prompt a sender rule matches is
// an agent message too (ruleSender).

const OWN_ROW = new Set(["human", "peer", "scheduled", "sdk"]);

export function newSession(id, file) {
  return {
    id, file, offset: 0, size: null, head: null, title: null, agentName: null, turns: [], seg: null, startedAt: null,
    open: [], pendingCmd: null, clearAt: null, followActive: false, followSince: null, version: 0,
    ctx: null, settled: 0, anchor: null, clock: null, since: null, guess: null,
    // Subagents (Claude Code): each one's state by its call's id and by its agent id, from its
    // launch result ("r") and its task notification ("n"): running, completed, failed,
    // stopped or killed, with the notification's time and tokens.
    agents: new Map(), agentIds: new Map(),
    // Lines the reader skipped (noteSkip): before the first turn, and in all for the debug
    // report. Here so that a session read again from the top (main.js restart) starts at none.
    skippedHead: null, skipped: null,
    // Calls waiting for their result ("x"), by call id: the call's record (a group's info) and
    // its turn.
    calls: new Map(),
  };
}

// How many task notifications are kept for ids no launch has named yet (background
// commands and watches send them too).
const AGENT_KEEP = 2000;

// Cursor records no turn times. The pane gives a prompt and an end of turn it sees arrive the
// time it saw them ("at", in ms): s.clock (an object, set by the panel) keeps them by turn
// number, so a turn's time is only what the pane watched. A turn first read from the file
// keeps a null start, and a file read again from the top keeps the times it had.
function clockStart(s, turn, e) {
  if (s.clock && !(turn.n in s.clock)) s.clock[turn.n] = { start: typeof e.at === "number" ? e.at : null, end: null };
}
function clockEnd(s, turn, e) {
  const c = s.clock?.[turn.n];
  if (!c || c.start == null) return;
  if (c.end == null && typeof e.at === "number") c.end = e.at;
  if (c.end != null) { turn.durationMs = Math.max(0, c.end - c.start); turn.endTs = c.end; }
}

// An event's time in ms, or null.
const ms = (ts) => {
  const n = typeof ts === "string" ? Date.parse(ts) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

// How many calls wait for a result at most: past it the waiting list starts again.
const CALLS_KEEP = 5000;

// A tag's attribute value, or null: attr('<hc from="t7 review">', "from") is "t7 review".
// One pattern per attribute name, made once.
const ATTR = new Map();
function attr(tag, name) {
  let re = ATTR.get(name);
  if (!re) ATTR.set(name, (re = new RegExp(`\\s${name}="([^"]*)"`)));
  const m = tag.match(re);
  return m ? m[1].trim() || null : null;
}

const SPACE = /\s/;
const WORD = /\w/;
// An hc wrapper at the start of a prompt: { tag, body } with the body up to a closing
// </hc> that ends the text (only whitespace after it), or null. The same split as the
// pattern /^\s*(<hc\b[^>]*>)([\s\S]*?)(?:<\/hc>\s*)?$/, done with indexOf: that lazy
// pattern tried the end anchor at every character of a long prompt, which was most of the
// read's time on a busy transcript (test S1 in test/render.test.js).
function hcSplit(t) {
  let i = 0;
  while (i < t.length && SPACE.test(t[i])) i++;
  if (!t.startsWith("<hc", i) || (i + 3 < t.length && WORD.test(t[i + 3]))) return null;
  const close = t.indexOf(">", i + 3);
  if (close < 0) return null;
  const rest = t.slice(close + 1);
  let e = rest.length;
  while (e > 0 && SPACE.test(rest[e - 1])) e--;
  const body = e >= 5 && rest.startsWith("</hc>", e - 5) ? rest.slice(0, e - 5) : rest;
  return { tag: t.slice(i, close + 1), body };
}

// The messages in a peer prompt, as [name, attributes, text], the way
// /<(agent-message|teammate-message)\b([^>]*)>([\s\S]*?)(?:<\/\1>|$)/g matches them: each
// opening tag, then its text up to the first closing tag of the same name or the end.
const PEER_TAGS = ["agent-message", "teammate-message"];
function peerMsgs(t) {
  const out = [];
  let pos = 0;
  while (pos < t.length) {
    let at = -1;
    let name = null;
    for (const n of PEER_TAGS) {
      const i = t.indexOf(`<${n}`, pos);
      if (i >= 0 && (at < 0 || i < at)) { at = i; name = n; }
    }
    if (at < 0) break;
    const after = at + 1 + name.length;
    if (after < t.length && WORD.test(t[after])) { pos = at + 1; continue; }
    const gt = t.indexOf(">", after);
    if (gt < 0) break;
    const end = t.indexOf(`</${name}>`, gt + 1);
    out.push([name, t.slice(after, gt), t.slice(gt + 1, end < 0 ? t.length : end)]);
    pos = end < 0 ? t.length : end + name.length + 3;
  }
  return out;
}
// A prompt body without hc tags; most bodies have none, so the scan is skipped.
const stripHc = (b) => (b.includes("<hc") || b.includes("</hc") ? b.replace(/<\/?hc\b[^>]*>/g, "") : b);

// Who sent a prompt, and the prompt without its wrapper tags: { sender, body }.
// sender.kind: you, hc, peer, scheduled, sdk, or the origin kind of a row that opened a
// session (task-notification, auto-continuation). Names are kept as given.
// A peer message's name is its teammate_id, else the origin's name (originName, e.g.
// "general-purpose" for a subagent's hand-back, whose from= is only an id), else its from.
export function senderOf(origin, text, originName = null) {
  const t = text ?? "";
  const o = origin ?? "human";
  if (o === "human") {
    const m = hcSplit(t);
    if (m && attr(m.tag, "from")) {
      const reach = attr(m.tag, "reach");
      return { sender: { kind: "hc", name: attr(m.tag, "from"), ...(reach ? { request: true } : {}) }, body: stripHc(m.body).trim() };
    }
    return { sender: { kind: "you" }, body: t };
  }
  if (o === "peer") {
    // <agent-message from="helper-a">…</agent-message>, or the shape Claude Code writes
    // today, <teammate-message teammate_id="helper-a" color=… summary=…>…</teammate-message>,
    // sometimes several in one prompt. The body is the messages' text.
    const msgs = peerMsgs(t);
    if (!msgs.length) return { sender: { kind: "peer", ...(originName ? { name: originName } : {}) }, body: t };
    const names = [...new Set(msgs.map((m) => attr(` ${m[1]}`, "teammate_id") ?? (originName || attr(` ${m[1]}`, "from"))).filter(Boolean))];
    const name = names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0];
    const body = msgs.map((m) => m[2].trim()).filter(Boolean).join("\n\n");
    return { sender: { kind: "peer", ...(name ? { name } : {}) }, body: body || t.replace(/<\/?(agent|teammate)-message\b[^>]*>/g, "").trim() };
  }
  return { sender: { kind: o }, body: t };
}

// Sender rules (settings.js parseSenders, kept on the session as s.senders): a prompt typed
// in the terminal (sender "you", not a command) that a rule matches is an agent message,
// { kind: "peer", name, rule: its number, ruleLabel }. A rule sees the prompt's first line
// from its first non-space, up to RULE_TEXT characters: a sender's mark sits at the start
// ("<seat> hourly 2026-11-18T01:47:20Z", "From <seat>:", with a seat name of up to 60
// characters), and a short text keeps the most work a rule can take small (settings.js
// senderCost bounds it from the pattern, at load). Never a reply, and never a turn that
// already carries an agent marker. No clock is read: a rule that loads always runs.
export const RULE_TEXT = 100;
export function ruleSender(rules, prompt) {
  if (!rules?.length || typeof prompt !== "string") return null;
  let a = 0;
  while (a < prompt.length && a < RULE_TEXT && /\s/.test(prompt[a])) a++;
  let head = prompt.slice(a, a + RULE_TEXT);
  const nl = head.indexOf("\n");
  if (nl >= 0) head = head.slice(0, nl);
  for (const r of rules) {
    r.re.lastIndex = 0;
    const m = r.re.exec(head);
    if (!m) continue;
    const name = r.named ? (m.groups?.sender ?? "").trim().slice(0, 60) : "";
    if (r.named && !name) continue;
    return { kind: "peer", ...(name ? { name } : {}), rule: r.n, ruleLabel: r.label };
  }
  return null;
}

// A turn the rules may mark: typed in the terminal, or marked by a rule before.
export const typedTurn = (t) => !t.cmd && (t.sender?.kind === "you" || t.sender?.rule != null);

// Marks one turn by the rules; true when its sender changed.
export function markTurn(turn, rules) {
  if (!typedTurn(turn)) return false;
  const next = ruleSender(rules, turn.prompt) ?? { kind: "you" };
  const was = turn.sender;
  if (was.kind === next.kind && was.name === next.name && was.rule === next.rule && was.ruleLabel === next.ruleLabel) return false;
  turn.sender = next;
  turn.agent = next.kind !== "you";
  return true;
}

// New sender rules for a session already read: its typed turns are marked again from
// turns[from], until the clock (performance.now) passes until, checked after each turn (a
// turn costs at most the rules' step budget, settings.js SENDER_TOTAL).
// Each turn whose sender changed takes the session's next version (turn.v), so a view's
// rows for it are built again. Returns where it stopped (turns.length when done).
export function remarkSenders(s, rules, from = 0, until = Infinity) {
  s.senders = rules;
  const v = s.version + 1;
  let changed = false;
  let i = from;
  while (i < s.turns.length) {
    if (markTurn(s.turns[i], rules)) { s.turns[i].v = v; changed = true; }
    i++;
    if (until !== Infinity && (globalThis.performance?.now?.() ?? Date.now()) > until) break;
  }
  if (changed) s.version = v;
  return i;
}

function newTurn(s, e) {
  // A command line keeps its origin: one a peer, a schedule or the SDK sent is theirs, not
  // the person's, so it hides with the other agent turns.
  const o = e.o ?? "human";
  const said = e.cmd ? { sender: { kind: o === "human" ? "you" : o }, body: e.t ?? "" } : senderOf(e.o, e.t, typeof e.n === "string" ? e.n : null);
  const body = said.body;
  // A typed prompt a sender rule matches is an agent message (ruleSender).
  const sender = (!e.cmd && said.sender.kind === "you" && ruleSender(s.senders, body)) || said.sender;
  return {
    n: s.turns.length + 1,
    // The session's version when the turn last changed (apply).
    v: s.version,
    ts: e.ts ? Date.parse(e.ts) : null,
    origin: e.o,
    prompt: body,
    sender,
    agent: sender.kind !== "you",
    cmd: Boolean(e.cmd),
    after: [],
    tools: 0,
    // Tool calls in background wake-ups after the reply (not in tools), and in the latest one.
    followTools: 0,
    wakeTools: 0,
    toolNames: {},
    // The work before the reply, in order (addStep): the agent's interim text, and groups of
    // the tool calls in a row between texts, each call by its tool name and its id (ids). The
    // reply is the text after the last group, so it is not a step.
    steps: [],
    // When the text after the last call began (the reply's or the next text step's start).
    afterAt: null,
    usage: {},
    // Codex names the model before the prompt it applies to (a "ctx" event).
    model: s.ctx?.m ?? null,
    effort: s.ctx?.e ?? null,
    durationMs: 0,
    done: false,
    interrupted: false,
    followups: 0,
    errors: [],
    compactions: 0,
    endTs: null,
    answeredBy: null,
    answeredIn: null,
    latest: "", // the final text of the last background update that said something
    latestAt: null, // when that text began: the time of its first part
    latestParts: [],
    // Each background update that said something keeps its final text here, in order
    // (turn.updates, made with the first one), so a later update never drops an earlier one,
    // and when that text began beside it (turn.updatesAt, as latestAt).
    // Pasted images: media type and paste number ([Image #N]) each, and what image.sh finds
    // them by: the prompt line's uuid (Claude Code), turn id and ordinal (Codex), or the
    // message id (OpenCode) or entry id (Pi). src is the temp file a Pi paste names.
    images: Array.isArray(e.img)
      ? e.img.map((mt, i) => ({ mt: String(mt), n: Number.isInteger(e.ids?.[i]) ? e.ids[i] : null,
        src: typeof e.src?.[i] === "string" && e.src[i].length <= 300 ? e.src[i] : null }))
      : [],
    imgLine: typeof e.u === "string" && /^[0-9A-Za-z_-]{8,80}$/.test(e.u) ? e.u : null,
  };
}

// Steps (turn.steps): the text said since the last call becomes an interim text step, and the
// call joins the group of calls in a row, or starts one. Herdr draws nothing for Markdown
// over 4,096 characters, so a text step keeps STEP_TEXT; a group keeps its first STEP_CALLS
// names and counts the rest. Past STEP_MAX steps, later text is dropped (counted) and
// calls join the last group, so a turn of thousands of calls stays small. STEP_TEXT is under
// ui.js MD_MAX, the size the reply's Markdown blocks are cut to.
//
// Times: a text step's at is when its first text was written. A group with a call that has an
// input summary or a time keeps a record per call (info, beside ids): in, the input in up to
// 120 characters; at, when the call was made; rt, when its result was written; f, whether it
// failed (null when the result does not say). A result ("x") fills rt and f by the call's id.
export const STEP_TEXT = 3400;
export const STEP_CALLS = 200;
export const STEP_MAX = 300;
// A subagent call's name, as ui.js toolKind sees it (kept here: turns.js imports nothing).
const AGENT_CALL = /^(task|agent|subagent|spawn(_\w+)?|delegate(_\w+)?)$/i;
// owner: the turn a call's result belongs to, when the steps are a wake-up's (keepWakes).
function addStep(s, turn, name, id = null, e = null, owner = turn) {
  const steps = turn.steps;
  const text = turn.after.join("\n\n").trim();
  const reason = turn.reasoning?.join("\n\n") || "";
  // Reasoning the step it precedes does not carry (the ATIF export only): blocks with no text,
  // and a text step's reasoning dropped with it past STEP_MAX. The step that is kept counts it.
  let held = turn.held ?? 0;
  let heldOnText = false;
  if (text) {
    if (steps.length < STEP_MAX) {
      steps.push({ k: "text", t: text.length > STEP_TEXT ? `${text.slice(0, STEP_TEXT - 1)}…` : text, cut: text.length > STEP_TEXT, ...(reason ? { r: reason } : {}), ...(held ? { h: held } : {}), ...(turn.afterAt != null ? { at: turn.afterAt } : {}) });
      heldOnText = true;
    } else {
      turn.stepsDropped = (turn.stepsDropped ?? 0) + 1;
      if (reason) held += turn.reasoning.length;
    }
  }
  // A text step ends the group before it; past STEP_MAX no text is added, so calls join it.
  // Subagent calls make a group of their own, apart from the commands and reads around them.
  const agent = AGENT_CALL.test(String(name ?? ""));
  let g = steps[steps.length - 1];
  if (g?.k === "group" && Boolean(g.agent) !== agent && steps.length < STEP_MAX) g = null;
  if (g?.k !== "group") { g = { k: "group", calls: [], count: 0 }; if (agent) g.agent = true; steps.push(g); }
  if (!text && reason) g.r = g.r ? `${g.r}\n\n${reason}` : reason;
  if (!heldOnText && held) g.h = (g.h ?? 0) + held;
  if (g.calls.length < STEP_CALLS) {
    g.calls.push(String(name ?? "tool"));
    // The call's id in the transcript, for calls.sh to find its input and output on demand.
    // A group gets ids only once a call has one, so agents that record none carry no list.
    const ok = typeof id === "string" && /^[0-9A-Za-z_.:|-]{1,200}$/.test(id);
    if (ok && !g.ids) g.ids = g.calls.slice(0, -1).map(() => null);
    if (g.ids) g.ids.push(ok ? id : null);
    const input = typeof e?.in === "string" && e.in ? e.in.slice(0, 120) : null;
    const at = ms(e?.ts);
    if ((input || at != null) && !g.info) g.info = g.calls.slice(0, -1).map(() => null);
    if (g.info) {
      const info = input || at != null ? { in: input, at, rt: null, f: null } : null;
      g.info.push(info);
      if (info && ok) {
        s.calls ??= new Map();
        if (s.calls.size >= CALLS_KEEP) s.calls.clear();
        s.calls.set(id, { info, turn: owner });
      }
    }
  }
  g.count++;
}

// A model turn starts: an "s" estimates its time from here.
function startModelTurn(s, e) {
  s.since = e.ts ? Date.parse(e.ts) : null;
  s.guess = null;
}

function openRow(s, e) {
  // Later events go to the new row, so an open row with its reply has nothing more to come.
  s.open = s.open.filter((t) => {
    if (!t.after.length) return true;
    t.done = true;
    if (!t.durationMs && t.endTs && t.ts) t.durationMs = Math.max(0, t.endTs - t.ts);
    return false;
  });
  startModelTurn(s, e);
  const turn = newTurn(s, e);
  s.turns.push(turn);
  s.open.push(turn);
  s.seg = "own";
  s.followActive = false;
  return turn;
}

// A pending skill or custom command becomes a row once the model works on it.
function promote(s) {
  if (!s.pendingCmd) return;
  const e = s.pendingCmd;
  s.pendingCmd = null;
  openRow(s, e);
}

// What a turn ends with when it was cut off, not refused or broken.
const CUT_OFF = /^No response requested\b|\bhit your\b.*\blimit\b|\b(usage|rate) limit\b|\blimit reached\b|^API Error: 429\b/i;

// The rows before a turn with a reply that had no reply of their own and were only cut off.
function linkAnswer(s, cur) {
  if (!cur.after.length) return;
  for (let i = cur.n - 2; i >= 0; i--) {
    const t = s.turns[i];
    if (t.after.length || t.interrupted || t.answeredBy || !t.errors.length || !t.errors.every((x) => CUT_OFF.test(x))) return;
    t.answeredIn = cur.n;
    t.v = s.version;
  }
}

// Every open row is done: the shared end of "d" and "s".
function closeOpen(s, cur, end, e) {
  for (const t of s.open) {
    t.done = true;
    if (end) t.endTs = end;
    // Answered together with a later prompt: its reply is on that row. Not a turn with a line
    // left out (noteSkip): its reply may be the line itself.
    if (t !== cur && !t.after.length && !t.skipped) t.answeredBy = cur.n;
  }
  if (s.clock) for (const t of s.open) clockEnd(s, t, e);
  s.open = [];
  s.followActive = false;
  linkAnswer(s, cur);
}

// The events that change no turn: a turn's version (v) moves for every other one. Subagent
// launches and notices (r, n) change what an open turn's subagent group shows: s.agentVer.
const NO_TURN = new Set(["title", "an", "ctx", "settle", "b", "r", "n"]);

// Applies one extractor event to a session, in file order. Every turn the event may have
// changed (the newest, every open one, any linkAnswer marks) takes the session's version as
// its own (turn.v), so a view can keep what it built for a turn until that turn changes.
export function apply(s, e) {
  const cur = s.turns[s.turns.length - 1];
  const open = s.open.length ? s.open.slice() : null;
  applyOne(s, e);
  const v = s.version;
  if (e.k === "r" || e.k === "n") { s.agentVer = v; return; }
  if (e.k === "x") { if (s.xTurn) s.xTurn.v = v; s.xTurn = null; return; }
  if (NO_TURN.has(e.k)) return;
  if (cur) cur.v = v;
  const last = s.turns[s.turns.length - 1];
  if (last) last.v = v;
  if (open) for (const t of open) t.v = v;
}

function applyOne(s, e) {
  s.version++;
  if (e.k === "b") {
    if (s.pendingCmd?.u && s.pendingCmd.u === e.pu) promote(s);
    return;
  }
  // Only between turns: a command line logged during a turn (a local /usage), with no text
  // of its own for the model, is not what the model is working on, so it never takes a row.
  if (s.pendingCmd && !s.open.length && !s.followActive && (e.k === "t" || e.k === "h" || e.k === "u" || e.k === "m" || e.k === "e")) promote(s);
  if (s.pendingCmd && e.k !== "c" && e.k !== "title" && e.k !== "an" && e.k !== "r" && e.k !== "n" && e.k !== "x") s.pendingCmd = null;
  const cur = s.turns[s.turns.length - 1];
  switch (e.k) {
    case "p": {
      if (s.startedAt === null && e.ts) s.startedAt = Date.parse(e.ts);
      if (e.cmd) {
        // "/clear" starts the file of the session it made; it is the divider, not a row.
        if (/^\/clear(\s|$)/.test(e.t ?? "")) {
          if (!s.turns.length && s.clearAt === null) s.clearAt = e.ts ? Date.parse(e.ts) : null;
          return;
        }
        s.pendingCmd = e;
        return;
      }
      // A task notification that wakes the agent once the row above has ended starts a row of
      // its own: what the agent says then is a reply for the person, so it shows in the Chat
      // (the owner, 21 Nov). One that lands while a row is open still counts on that row.
      if (OWN_ROW.has(e.o) || !cur || (e.o === "task-notification" && !s.open.length)) {
        clockStart(s, openRow(s, e), e);
      } else if (s.open.length) {
        // A notification while the row is open: Claude still owes this row its reply. One
        // that only says a subagent of this session is back (its "n" came just before) is
        // shown on that subagent's row, not counted as a background update.
        if (!(e.o === "task-notification" && s.noteAt === s.version - 1)) cur.followups++;
      } else {
        cur.followups++;
        cur.latestParts = [];
        s.updateAt = null;
        s.seg = "follow";
        s.followActive = true;
        // This wake-up's own clock and tool count, apart from the prompt's.
        s.followSince = e.ts ? Date.parse(e.ts) : null;
        cur.wakeTools = 0;
        // The ATIF export (s.keepWakes) keeps each wake-up's texts and calls as steps of its
        // own. The panel never sets it: it shows a wake-up as its last text only.
        if (s.keepWakes) (cur.wakes ??= []).push({ steps: [], after: [], afterAt: null });
        startModelTurn(s, e);
      }
      return;
    }
    case "h": {
      // The model's reasoning (the ATIF export only): kept for the step it precedes, the
      // prompt's own or a background wake-up's (keepWakes); a block with no text (w) is
      // counted there as withheld.
      const w = s.seg === "own" ? cur : s.keepWakes ? cur?.wakes?.at(-1) : null;
      if (!w) return;
      if (e.t) (w.reasoning ??= []).push(e.t);
      else if (e.w) w.held = (w.held ?? 0) + 1;
      return;
    }
    case "t":
      if (!cur || !e.t) return;
      if (s.seg === "own") {
        if (!cur.after.length) cur.afterAt = ms(e.ts);
        cur.after.push(e.t);
      } else {
        // A background update's text: kept apart, so the reply to the prompt stays the reply.
        if (!cur.latestParts.length) cur.latestAt = ms(e.ts);
        cur.latestParts.push(e.t);
        cur.latest = cur.latestParts.join("\n\n").trim();
        // This wake-up's place in turn.updates, taken by its first text: its text after its
        // last call replaces what it said before, as latest does.
        if (s.updateAt?.turn !== cur) s.updateAt = { turn: cur, i: (cur.updates ??= []).push("") - 1 };
        cur.updates[s.updateAt.i] = cur.latest;
        (cur.updatesAt ??= [])[s.updateAt.i] = cur.latestAt;
        const w = s.keepWakes ? cur.wakes?.at(-1) : null;
        if (w) { if (!w.after.length) w.afterAt = ms(e.ts); w.after.push(e.t); }
      }
      return;
    case "u":
      if (!cur) return;
      // A background wake-up's tool calls are counted apart from the prompt's own.
      // toolNames counts the prompt's own calls by name, so its kinds add up to tools.
      if (s.seg === "follow") { cur.followTools++; cur.wakeTools++; } else { cur.tools++; cur.toolNames[e.n] = (cur.toolNames[e.n] ?? 0) + 1; }
      if (s.seg === "own") { addStep(s, cur, e.n, e.id, e); cur.after = []; cur.afterAt = null; if (cur.reasoning) cur.reasoning = []; if (cur.held) cur.held = 0; }
      else {
        cur.latestParts = [];
        const w = s.keepWakes ? cur.wakes?.at(-1) : null;
        if (w) { addStep(s, w, e.n, e.id, e, cur); w.after = []; w.afterAt = null; if (w.reasoning) w.reasoning = []; if (w.held) w.held = 0; }
      }
      return;
    case "m":
      if (!cur) return;
      // w: the context window the agent stated with this count (Codex only), kept beside it.
      cur.usage[e.id] = e.w > 0 ? { ...e.u, w: e.w } : e.u;
      if (e.m) cur.model = e.m;
      if (e.e) cur.effort = e.e;
      if (typeof e.a === "string" && e.a) cur.by = e.a;
      if (e.ts) cur.endTs = Date.parse(e.ts);
      return;
    case "e":
      if (cur && e.t) cur.errors.push(e.t);
      return;
    case "r": {
      // A launch result: a subagent started in the background, or one that ran in the
      // foreground with its status. A notification read first keeps its settled state.
      if (typeof e.id !== "string" || typeof e.a !== "string") return;
      s.agents ??= new Map();
      s.agentIds ??= new Map();
      const a = s.agentIds.get(e.a) ?? { st: null, ms: null, tok: null };
      a.id = e.id;
      a.m = typeof e.m === "string" ? e.m : null;
      if (!a.st && typeof e.st === "string") a.st = e.st === "async_launched" ? "running" : e.st;
      s.agents.set(e.id, a);
      s.agentIds.set(e.a, a);
      return;
    }
    case "n": {
      if (typeof e.a !== "string" || !e.st) return;
      s.agentIds ??= new Map();
      let a = s.agentIds.get(e.a);
      if (!a) {
        if (s.agentIds.size >= AGENT_KEEP) return;
        a = { st: null, ms: null, tok: null, id: null, m: null };
        s.agentIds.set(e.a, a);
      }
      a.st = String(e.st);
      if (Number.isFinite(e.ms)) a.ms = e.ms;
      if (Number.isFinite(e.tok)) a.tok = e.tok;
      // For the prompt line that carries it, next ("p"): a launched subagent's notification.
      s.noteAt = a.id ? s.version : null;
      return;
    }
    case "d": {
      if (!cur) return;
      const end = e.ts ? Date.parse(e.ts) : null;
      // Pi records no turn time: the turn ran from its prompt to its last stop.
      if (e.ms != null) {
        if (s.guess?.turn === cur) cur.durationMs -= s.guess.ms;
        cur.durationMs += e.ms;
        s.since = null;
        s.guess = null;
      } else if (end && cur.ts) cur.durationMs = Math.max(cur.durationMs, end - cur.ts);
      closeOpen(s, cur, end, e);
      return;
    }
    case "s": {
      if (!cur) return;
      const end = e.ts ? Date.parse(e.ts) : null;
      // This model turn's time so far, in place of the estimate before it. A turn_duration
      // right after replaces it with the real figure.
      if (end && s.since != null) {
        const ms = Math.max(0, end - s.since);
        cur.durationMs += ms - (s.guess?.turn === cur ? s.guess.ms : 0);
        s.guess = { turn: cur, ms };
      }
      closeOpen(s, cur, end, e);
      return;
    }
    case "i": {
      if (!s.open.length) { s.followActive = false; return; }
      const last = s.open[s.open.length - 1];
      for (const t of s.open) t.done = true;
      if (s.clock) for (const t of s.open) clockEnd(s, t, e);
      last.interrupted = true;
      s.open = [];
      s.followActive = false;
      return;
    }
    case "c":
      if (cur) cur.compactions++;
      return;
    case "x": {
      // A call's result: when it was written and whether it failed. Only its own turn changes.
      const c = typeof e.id === "string" ? s.calls?.get(e.id) : null;
      if (!c) return;
      s.calls.delete(e.id);
      c.info.rt = ms(e.ts);
      c.info.f = typeof e.f === "boolean" ? e.f : null;
      s.xTurn = c.turn;
      return;
    }
    case "title":
      if (e.t) s.title = e.t;
      return;
    // The agent's name, where the harness records one: Claude Code's agent-name line, a
    // Codex subagent's nickname. OpenCode names the agent on each reply ("m" a).
    case "an":
      if (e.t) s.agentName = e.t;
      return;
    case "ctx":
      s.ctx = { m: e.m ?? null, e: e.e ?? null };
      return;
    case "settle":
      s.settled = s.turns.length;
      if (e.id) s.anchor = e.id;
      return;
  }
}

// OpenCode rewrites its last turn in place while it streams, so a read gets that turn again
// each time: rows after the last settled one are dropped before the new events apply. The
// turn numbers come out the same.
// A line the reader skipped (extract.sh's line_max): counted on the newest turn read so far,
// or on the session's head before the first turn, so the pane can say where in byte order a
// line was left out. Only by turn: the line's own type and time are not read.
export function noteSkip(s, bytes) {
  if (!(bytes > 0)) return;
  const t = s.turns[s.turns.length - 1];
  const at = t ?? s;
  const key = t ? "skipped" : "skippedHead";
  at[key] = { lines: (at[key]?.lines ?? 0) + 1, bytes: (at[key]?.bytes ?? 0) + bytes };
  s.version++;
}

// The note for skipped lines: "A line of 300 MB was left out here, too long to read". In
// decimal MB, as every size in the pane (fmtBytes); from 1 GB up in GB with one decimal.
export function skipNote(k) {
  const size = k.bytes >= 999.5e6 ? `${(k.bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(k.bytes / 1e6))} MB`;
  return k.lines === 1 ? `A line of ${size} was left out here, too long to read` : `${k.lines} lines, ${size} in all, were left out here, too long to read`;
}

export function rewindTail(s) {
  s.turns.length = Math.min(s.turns.length, s.settled ?? 0);
  s.open = [];
  s.seg = null;
  s.pendingCmd = null;
  s.followActive = false;
  s.updateAt = null;
  s.version++;
}

// Parses extractor stdout. Returns { size, used, events, missing }.
export function parseChunk(stdout) {
  const out = newChunk();
  for (const line of stdout.split("\n")) parseLine(out, line);
  return out;
}
export function newChunk() { return { size: null, head: null, used: 0, events: [], missing: false, rewind: false }; }
// One line of extractor stdout into a chunk (the panel parses a chunk in slices).
export function parseLine(out, line) {
  if (!line) return;
  const e = JSON.parse(line);
  if (e.k === "file") { out.size = e.size; out.head = e.head ?? null; if ("anchor" in e) out.anchor = e.anchor; }
  else if (e.k === "chunk") { out.used = e.used; out.rewind = Boolean(e.rewind); if (e.noperl) out.noPerl = true; if (e.skipped > 0) out.skipped = e.skipped; }
  else if (e.k === "missing") out.missing = true;
  else out.events.push(e);
}

// True when a chunk shows the file was replaced since the last read: transcripts only
// grow, so a shorter file, or one whose first line has another uuid, starts over.
// OpenCode's undo can also swap a settled prompt for a new one, which the anchor catches.
export function replaced(s, c) {
  return (c.size != null && c.size < s.offset) || Boolean(c.head && s.head && c.head !== s.head)
    || Boolean(s.anchor && "anchor" in c && c.anchor !== s.anchor);
}

export function reply(turn) {
  return turn.after.join("\n\n").trim();
}

// What every background update after the reply said, in order, one paragraph each: the
// text under LATEST UPDATE. The last of turn.updates is always latest, so it is the earlier
// ones, then latest.
export function updatesText(turn) {
  return [...(turn.updates?.slice(0, -1) ?? []), turn.latest ?? ""].filter(Boolean).join("\n\n").trim();
}

export function running(turn, isLast) {
  return isLast && !turn.done;
}

export function stats(turn) {
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
  for (const u of Object.values(turn.usage)) {
    input += u.i ?? 0;
    output += u.o ?? 0;
    cacheRead += u.cr ?? 0;
    cacheWrite += u.cc ?? 0;
  }
  const fresh = input + cacheWrite + output;
  const prompt = input + cacheWrite + cacheRead;
  return {
    input, output, cacheRead, cacheWrite,
    tokens: fresh,
    cachePct: cachePct(cacheRead, prompt),
  };
}

// The status line's sums over one session's turns: tool calls; tokens, counted as the reply
// stats count them (new input, cache writes and output); the share of the prompt read from
// cache; and context, the prompt of the newest model response (its input, cache reads and
// cache writes). With no usage in any turn (Cursor records none) the three are null, never 0.
export function sessionStats(turns) {
  return sumsStats(turnSums(turns));
}

// sessionStats in two steps, so the pane sums the done turns once and only the newest again:
// turnSums adds turns from..to onto a copy of base, and sumsStats turns the sums into stats.
export function turnSums(turns, from = 0, to = turns.length, base = null) {
  const a = base ? { ...base } : { tools: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, any: false, context: null, window: null };
  for (let k = from; k < to; k++) {
    const t = turns[k];
    a.tools += t.tools ?? 0;
    for (const u of Object.values(t.usage ?? {})) {
      a.any = true;
      a.input += u.i ?? 0;
      a.output += u.o ?? 0;
      a.cacheRead += u.cr ?? 0;
      a.cacheWrite += u.cc ?? 0;
      a.context = (u.i ?? 0) + (u.cr ?? 0) + (u.cc ?? 0);
      // The window stated with the same count, or none: never one from an earlier count.
      a.window = u.w > 0 ? u.w : null;
    }
  }
  return a;
}
export function sumsStats(a) {
  if (!a.any) return { tools: a.tools, tokens: null, cachePct: null, context: null, contextPct: null };
  const context = a.context > 0 ? a.context : null;
  // The context as a whole percent of the window, only where the transcript states the window.
  const contextPct = context != null && a.window > 0 ? Math.round((context * 100) / a.window) : null;
  return { tools: a.tools, tokens: a.input + a.cacheWrite + a.output, cachePct: cachePct(a.cacheRead, a.input + a.cacheWrite + a.cacheRead), context, contextPct };
}

// Share of the prompt read from cache, floored to one decimal: 100 only when every prompt
// token was a cache read, so 99.96% shows as 99.9, never as 100.
export function cachePct(cacheRead, prompt) {
  if (!(prompt > 0)) return null;
  const tenths = Math.min(Math.floor((cacheRead * 1000) / prompt), cacheRead < prompt ? 999 : 1000);
  return tenths / 10;
}

// "99.6%", "82%", "0%".
export function fmtPct(p) {
  return p == null ? "" : `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
}

// "1,204,331" in every locale the tests run in.
export function fmtCount(n) {
  return String(Math.round(n ?? 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// The open card's raw cache counts line.
export function cacheLine(st) {
  return `cache read ${fmtCount(st.cacheRead)} · written ${fmtCount(st.cacheWrite)} · new input ${fmtCount(st.input)}`;
}

// A command row's name and arguments: "/review-pr 12" -> { name: "/review-pr", args: "12" }.
export function commandParts(turn) {
  if (!turn?.cmd) return null;
  const t = (turn.prompt ?? "").trim();
  const i = t.search(/\s/);
  return i < 0 ? { name: t, args: "" } : { name: t.slice(0, i), args: t.slice(i).trim() };
}

export function fmtTokens(n) {
  if (n < 1000) return String(n);
  if (n < 100000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function fmtDuration(ms) {
  if (!ms || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// "9:05\u00a0AM", "12:00\u00a0PM", "12:05\u00a0AM": 12-hour, uppercase like the terminal's
// clock, with a no-break space so the period never wraps away from the time.
export function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}\u00a0${h < 12 ? "AM" : "PM"}`;
}

// Decimal units, as a file listing shows them: 499,185,946 bytes is "499 MB".
export function fmtBytes(n) {
  if (n == null) return "";
  if (n < 999500) return `${Math.max(1, Math.round(n / 1e3))} KB`;
  return `${Math.round(n / 1e6)} MB`;
}

// "claude-opus-5-5" -> "opus 5.5"; "claude-haiku-4-5-20251001" -> "haiku 4.5".
export function shortModel(m) {
  if (!m) return "";
  // Other makers' names read as they are written ("gpt-6.1-sol", "glm-5.3").
  if (!/^(claude-|opus|sonnet|haiku|fable)/.test(m)) return m;
  const x = m.replace(/^claude-/, "").replace(/\[.*\]$/, "").replace(/-\d{8}$/, "");
  const parts = x.split("-");
  const name = parts.shift();
  return parts.length ? `${name} ${parts.join(".")}` : name;
}

// Markdown split into prose and fenced code blocks, in order.
export function segments(md) {
  const out = [];
  const lines = md.split("\n");
  let prose = [];
  let code = null;
  for (const line of lines) {
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+#.-]*)/);
    if (code) {
      if (fence && line.trim().startsWith(code.fence) && line.trim().replace(/[`~]/g, "") === "") {
        out.push({ kind: "code", lang: code.lang, text: code.lines.join("\n") });
        code = null;
      } else code.lines.push(line);
    } else if (fence) {
      if (prose.join("\n").trim()) out.push({ kind: "md", text: prose.join("\n").trim() });
      prose = [];
      code = { fence: fence[1], lang: fence[2] || "", lines: [] };
    } else prose.push(line);
  }
  if (code) out.push({ kind: "code", lang: code.lang, text: code.lines.join("\n") });
  if (prose.join("\n").trim()) out.push({ kind: "md", text: prose.join("\n").trim() });
  return out;
}

// First non-empty line, without markdown decoration.
export function firstLine(text) {
  for (const raw of (text ?? "").split("\n")) {
    const l = raw.replace(/^[#>*\-\s`]+/, "").replace(/\*\*|__|`/g, "").replace(/(?<=^|\s)[*_]+|[*_]+(?=\s|$)/g, "").trim();
    if (l) return l;
  }
  return "";
}

export function matches(turn, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return turn.prompt.toLowerCase().includes(needle) || reply(turn).toLowerCase().includes(needle)
    || Boolean(turn.sender?.name?.toLowerCase().includes(needle));
}

// A row whose answer is on another row, and that row, find each other: the first by the
// answer's words, the second by the question's.
export function threadMatches(turns, turn, q) {
  if (!q) return true;
  if (matches(turn, q)) return true;
  const needle = q.toLowerCase();
  const n = turn.answeredIn ?? turn.answeredBy;
  if (n && reply(turns[n - 1] ?? { after: [] }).toLowerCase().includes(needle)) return true;
  for (let i = turn.n - 2; i >= 0 && (turns[i].answeredIn === turn.n || turns[i].answeredBy === turn.n); i--)
    if (turns[i].prompt.toLowerCase().includes(needle)) return true;
  return false;
}

// The largest call left for this read, after a call that asked for chunk and used bytes. A
// call cut to half or less was read again at half size by the extractor (its output came to
// more than 6 MiB: a transcript dense with text), so the rest of the read asks for half,
// down to floor, the read's first call's size, rather than pay that again every call.
export function readCap(cap, used, chunk, floor) {
  return used > 0 && used * 2 <= chunk ? Math.max(floor, Math.min(cap, chunk / 2)) : cap;
}

// After one extractor call: the chunk size for the next call, or 0 when caught up.
// A line longer than the chunk reads nothing; grow the chunk to get past it. A cut-off
// line at the end of the file is still being written; wait for the next change.
export function nextChunk(session, used, chunk, base) {
  if (session.size == null || session.offset >= session.size) return 0;
  if (used > 0) return base;
  if (session.offset + chunk >= session.size) return 0;
  return chunk * 4;
}
