// agent-threads: turns from extractor events. Plain JavaScript with no Herdr imports, so
// the tests run it under bun or node.
//
// One row per prompt a person (or another session, or a schedule) gave the agent.
// Task notifications and auto-continuations start model turns of their own, but they are
// folded into the row above: their tokens and tool calls count, their text does not
// replace the row's final reply.
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
// prompt is the message without its wrapper tags.

const OWN_ROW = new Set(["human", "peer", "scheduled", "sdk"]);

export function newSession(id, file) {
  return {
    id, file, offset: 0, size: null, head: null, title: null, agentName: null, turns: [], seg: null, startedAt: null,
    open: [], pendingCmd: null, clearAt: null, followActive: false, followSince: null, version: 0,
    ctx: null, settled: 0, anchor: null, clock: null, since: null, guess: null,
  };
}

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

function newTurn(s, e) {
  // A command line keeps its origin: one a peer, a schedule or the SDK sent is theirs, not
  // the person's, so it hides with the other agent turns.
  const o = e.o ?? "human";
  const { sender, body } = e.cmd ? { sender: { kind: o === "human" ? "you" : o }, body: e.t ?? "" } : senderOf(e.o, e.t, typeof e.n === "string" ? e.n : null);
  return {
    n: s.turns.length + 1,
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
    latestParts: [],
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
  }
}

// Every open row is done: the shared end of "d" and "s".
function closeOpen(s, cur, end, e) {
  for (const t of s.open) {
    t.done = true;
    if (end) t.endTs = end;
    // Answered together with a later prompt: its reply is on that row.
    if (t !== cur && !t.after.length) t.answeredBy = cur.n;
  }
  if (s.clock) for (const t of s.open) clockEnd(s, t, e);
  s.open = [];
  s.followActive = false;
  linkAnswer(s, cur);
}

// Applies one extractor event to a session, in file order.
export function apply(s, e) {
  s.version++;
  if (e.k === "b") {
    if (s.pendingCmd?.u && s.pendingCmd.u === e.pu) promote(s);
    return;
  }
  // Only between turns: a command line logged during a turn (a local /usage), with no text
  // of its own for the model, is not what the model is working on, so it never takes a row.
  if (s.pendingCmd && !s.open.length && !s.followActive && (e.k === "t" || e.k === "u" || e.k === "m" || e.k === "e")) promote(s);
  if (s.pendingCmd && e.k !== "c" && e.k !== "title" && e.k !== "an") s.pendingCmd = null;
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
      if (OWN_ROW.has(e.o) || !cur) {
        clockStart(s, openRow(s, e), e);
      } else if (s.open.length) {
        // A notification while the row is open: Claude still owes this row its reply.
        cur.followups++;
      } else {
        cur.followups++;
        cur.latestParts = [];
        s.seg = "follow";
        s.followActive = true;
        // This wake-up's own clock and tool count, apart from the prompt's.
        s.followSince = e.ts ? Date.parse(e.ts) : null;
        cur.wakeTools = 0;
        startModelTurn(s, e);
      }
      return;
    }
    case "t":
      if (!cur || !e.t) return;
      if (s.seg === "own") cur.after.push(e.t);
      else {
        // A background update's text: kept apart, so the reply to the prompt stays the reply.
        cur.latestParts.push(e.t);
        cur.latest = cur.latestParts.join("\n\n").trim();
      }
      return;
    case "u":
      if (!cur) return;
      // A background wake-up's tool calls are counted apart from the prompt's own.
      if (s.seg === "follow") { cur.followTools++; cur.wakeTools++; } else cur.tools++;
      cur.toolNames[e.n] = (cur.toolNames[e.n] ?? 0) + 1;
      if (s.seg === "own") cur.after = [];
      else cur.latestParts = [];
      return;
    case "m":
      if (!cur) return;
      cur.usage[e.id] = e.u;
      if (e.m) cur.model = e.m;
      if (e.e) cur.effort = e.e;
      if (typeof e.a === "string" && e.a) cur.by = e.a;
      if (e.ts) cur.endTs = Date.parse(e.ts);
      return;
    case "e":
      if (cur && e.t) cur.errors.push(e.t);
      return;
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
export function rewindTail(s) {
  s.turns.length = Math.min(s.turns.length, s.settled ?? 0);
  s.open = [];
  s.seg = null;
  s.pendingCmd = null;
  s.followActive = false;
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
  else if (e.k === "chunk") { out.used = e.used; out.rewind = Boolean(e.rewind); }
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

export function fmtBytes(n) {
  if (n == null) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${Math.round(n / (1024 * 1024))} MB`;
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

// After one extractor call: the chunk size for the next call, or 0 when caught up.
// A line longer than the chunk reads nothing; grow the chunk to get past it. A cut-off
// line at the end of the file is still being written; wait for the next change.
export function nextChunk(session, used, chunk, base) {
  if (session.size == null || session.offset >= session.size) return 0;
  if (used > 0) return base;
  if (session.offset + chunk >= session.size) return 0;
  return chunk * 4;
}
