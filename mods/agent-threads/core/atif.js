// agent-threads: a session as an ATIF trajectory (Agent Trajectory Interchange Format,
// ATIF-v1.7, the schema in Harbor's src/harbor/models/trajectories), from the session the
// reader built (turns.js) folded by trajectory.js, and nothing else: no second read of the
// transcript. Plain JavaScript with no Herdr imports. Nothing in the panel uses it; run
//   bun core/atif.js <transcript> [agent]
// to print one (agent: claude, codex, pi, cursor, antigravity, or opencode with
// "<database>#<session id>"; claude when left out).
//
// The mapping follows Harbor's converters where they agree with the reader:
// - A turn's prompt is a user step. Each later step group (trajectory.js) is an agent step:
//   its text as the message ("" when it is only calls), then its calls as tool_calls, each
//   with an observation result joined by the call's id.
// - Tokens as Harbor counts them: prompt_tokens is input, cache reads and cache writes;
//   cached_tokens is cache reads; cache writes also in metrics.extra. The reader keeps them
//   per turn, not per model message, so a turn's sum is on its last agent step
//   (metrics.extra.scope "turn").
// Where the reader has more than ATIF holds, it goes in extra:
// - A step's end (end_ts), a call's input summary (tool_call.extra.input), a result's time
//   (result_ts) and whether it failed, under Harbor's name tool_result_is_error (true or
//   false when the reader knows, left out when it does not). OpenCode's, Pi's and Antigravity's
//   readers give no result events, so for those three the command line takes both from calls.sh
//   (OpenCode: a call's error state or a shell call's non-zero exit code; Pi: the result's
//   isError; Antigravity: true for an ERROR or FAILED step, else left out; and the end time,
//   when it is not before the call's start). The panel's reader keeps no arguments, so
//   arguments is {} unless the caller read them (the command line does, from calls.sh); a
//   call whose input was not JSON, or was not read, keeps {} and says so
//   (extra.arguments_unread).
// - A call with no result yet keeps its observation result, with no content and
//   extra.no_result. A call the transcript gives no id has none made up for the join: its
//   tool_call_id is "<turn id>#<step>.<call>" and tool_call.extra.id_from_reader is true.
// - A subagent call's run (its agent id, state, tokens, time) is in its result's extra. Its
//   own steps are in its own transcript: the command line reads it (Claude Code's
//   subagents/agent-<id>.jsonl in the session's one subagents folder, where Claude Code
//   writes a subagent's own subagents too; Codex's rollout whose session_meta names
//   this thread as its parent) and nests it in subagent_trajectories, its call's result
//   pointing at it (subagent_trajectory_ref). A Claude Code subagent's id must be letters,
//   digits, "-" and "_", and its file must resolve inside the subagents folder, which must not
//   be a link. One it cannot
//   find, or will not read, is marked
//   (extra.subagent_transcript "not found"). The totals then count the subagents too, as
//   Harbor's do.
// - Calls counted but not named (past STEP_CALLS) are a count, extra.calls_not_listed.
// - A background update after the reply is an agent step with extra.kind
//   "background_update". From the command line, each wake-up's texts and calls are steps of
//   their own; from the panel's reader, each wake-up's last text, in order. Background
//   updates are auto-continuations, and task notifications that land while a turn is open.
// - A task notification that wakes the agent after a turn has finished is a turn of its own:
//   a user step with an empty message (the notice's text is not kept) and extra.sender
//   { kind: "task-notification" }, then its agent steps. Harbor would keep the notice's
//   text as the message (test/atif-harbor/differences.js).
// - Work that started by itself after a turn has finished (a Codex goal's task, a Claude Code
//   loop tick or scheduled line with no prompt) is a turn of its own the same way, its sender
//   { kind: "goal" } or { kind: "scheduled" }.
// - An answer the harness marked is an agent step with its whole message, in its place, also
//   when more calls came after it.
// Times are ISO 8601 where the transcript gives one, else left out, never made up.

import { trajectories } from "./trajectory.js";
import { STEP_TEXT } from "./turns.js";

export const ATIF_VERSION = "ATIF-v1.7";

// Harbor's agent names (AgentName) for the readers' harness names.
export const AGENT_NAMES = { claude: "claude-code", codex: "codex", opencode: "opencode", pi: "pi", cursor: "cursor-cli", antigravity: "antigravity-cli" };

// A time string's milliseconds, or NaN. Date.parse rolls a day its month lacks into the next
// month (2026-02-30 reads as March 2), so a written date that does not exist is not a time.
function timeOf(s) {
  const d = /^(\d{4})-(\d\d)-(\d\d)/.exec(s);
  // Day 0 of the next month is this month's last day.
  if (d && Number(d[3]) > new Date(Date.UTC(Number(d[1]), Number(d[2]), 0)).getUTCDate()) return Number.NaN;
  return Date.parse(s);
}

// A time as ISO 8601: from milliseconds (the reader's) or an ISO string (calls.sh's, which
// the command line has checked with timeOf).
const iso = (t) => {
  const ms = typeof t === "string" ? Date.parse(t) : t;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
};

// The object without its undefined and null fields, as Harbor writes them (exclude_none);
// null when nothing is left.
function clean(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) out[k] = v;
  return Object.keys(out).length ? out : null;
}

// A turn's tokens as Harbor counts a message's: input plus cache reads and writes.
function turnMetrics(turn) {
  let input = 0, output = 0, read = 0, write = 0, n = 0;
  for (const u of Object.values(turn.usage ?? {})) {
    input += u.i ?? 0; output += u.o ?? 0; read += u.cr ?? 0; write += u.cc ?? 0; n++;
  }
  if (!n) return null;
  return {
    prompt_tokens: input + read + write,
    completion_tokens: output,
    cached_tokens: read,
    extra: { cache_creation_input_tokens: write, scope: "turn", model_messages: n },
  };
}

// One turn's steps, numbered from `next`. results: an optional Map from call id to what the
// command line read from calls.sh: the result's text (out), the call's whole input (args), or
// that its input is not JSON (unread); for OpenCode, Pi and Antigravity, whose readers give
// no result events, that the call has a result (ended), whether it failed (failed) and when it
// ended (end); and for a subagent call its trajectory (sub) or that its transcript was not
// found (subMissing). The reader's outcome comes first: ended, failed and end only fill in
// what it does not know. A call with a result is never marked as having none, whatever is
// unknown.
function turnSteps(turn, tr, next, results, helperId, claudeSteps) {
  const steps = [];
  // Harbor marks every Claude step (claudeSteps): is_sidechain true, with agent_id, on a
  // helper's (helperId), false on the main session's.
  const base = clean({ turn: turn.n, turn_id: tr.id, agent_id: helperId, is_sidechain: helperId ? true : claudeSteps ? false : undefined });
  const agentStep = (fields, extra) => {
    const st = clean({
      step_id: next + steps.length,
      timestamp: fields.timestamp,
      source: "agent",
      model_name: turn.model ?? undefined,
      reasoning_effort: turn.effort ?? undefined,
      message: fields.message ?? "",
      reasoning_content: fields.reasoning_content || undefined,
      tool_calls: fields.tool_calls?.length ? fields.tool_calls : undefined,
      observation: fields.results?.length ? { results: fields.results } : undefined,
      extra: clean({ ...base, ...extra }),
    });
    st.message = fields.message ?? "";
    steps.push(st);
    return st;
  };
  const [first, ...groups] = tr.groups;
  const prompt = first.cells[0];
  steps.push(clean({
    step_id: next,
    timestamp: iso(prompt.start),
    source: "user",
    message: prompt.text ?? "",
    extra: clean({ ...base, sender: turn.agent && turn.sender ? clean({ ...turn.sender }) ?? undefined : undefined, images: turn.images?.length || undefined }),
  }));
  steps[0].message = prompt.text ?? "";
  // The step the last group became, while calls with no text before them may still join it:
  // the panel keeps subagent calls in a group apart from the commands around them, but they
  // came from the same model reply, so they are one step here.
  let open = null;
  for (const g of groups) {
    const msg = g.cells.find((c) => c.kind === "message" || c.kind === "context");
    const tools = g.cells.filter((c) => c.kind === "tool");
    const more = g.cells.find((c) => c.kind === "more");
    const join = open && !msg && tools.length && g.title !== "Update";
    const stepId = join ? open.st.step_id : next + steps.length;
    const toolCalls = join ? open.toolCalls : [];
    const res = join ? open.res : [];
    const skip = join ? open.toolCalls.length : 0;
    tools.forEach((c, i) => {
      const id = c.call ?? `${tr.id ?? turn.n}#${stepId}.${skip + i + 1}`;
      const got = c.call ? results?.get(c.call) : null;
      const args = got?.args && typeof got.args === "object" && !Array.isArray(got.args) ? got.args : null;
      const unread = results && !args ? (got?.unread ? "not JSON" : "not read") : undefined;
      toolCalls.push(clean({ tool_call_id: id, function_name: c.tool, arguments: args ?? {},
        extra: clean({ input: c.input ?? undefined, arguments_unread: unread, id_from_reader: c.call ? undefined : true, started: iso(c.start), raw_arguments: got?.raw }) }));
      if (!c.call) return;
      res.push(clean({
        source_call_id: c.call,
        content: typeof got?.out === "string" ? got.out : undefined,
        subagent_trajectory_ref: got?.sub ? [clean({ trajectory_id: got.sub.trajectory_id, session_id: got.sub.session_id })] : undefined,
        extra: clean({
          subagent_transcript: got?.subMissing ? "not found" : undefined,
          subagent_reason: got?.subMissing && got.subReason ? got.subReason : undefined,
          subagent_link: got?.sub && got.subLink ? got.subLink : undefined,
          result_ts: iso(c.result?.end ?? got?.end),
          tool_result_is_error: typeof c.result?.failed === "boolean" ? c.result.failed : typeof got?.failed === "boolean" ? got.failed : undefined,
          no_result: c.result?.end == null && c.result?.failed == null && !got?.ended ? true : undefined,
          subagent: c.subagent ? clean(c.subagent) ?? undefined : undefined,
        }),
      }));
    });
    if (join) {
      const st = open.st;
      st.timestamp ??= iso(tools.find((c) => c.start != null)?.start);
      if (st.timestamp === undefined) delete st.timestamp;
      st.tool_calls = toolCalls;
      st.observation = res.length ? { results: res } : undefined;
      if (!st.observation) delete st.observation;
      if (more?.count) st.extra = { ...st.extra, calls_not_listed: (st.extra?.calls_not_listed ?? 0) + more.count };
      if (g.held) st.extra = { ...st.extra, reasoning_withheld: (st.extra?.reasoning_withheld ?? 0) + g.held };
      continue;
    }
    const start = msg?.start ?? tools.find((c) => c.start != null)?.start;
    const st = agentStep({ timestamp: iso(start), message: msg?.text, reasoning_content: msg?.reason, tool_calls: toolCalls, results: res }, {
      kind: g.title === "Update" ? "background_update" : undefined,
      reasoning_withheld: g.held || undefined,
      end_ts: iso(msg?.end),
      cut: msg?.cut ? STEP_TEXT : undefined,
      calls_not_listed: more?.count,
    });
    open = g.title === "Update" ? null : { st, toolCalls, res };
  }
  // The turn's tokens, time and ending on its last agent step.
  const last = steps.length > 1 ? steps[steps.length - 1] : null;
  if (last) {
    const m = turnMetrics(turn);
    if (m) last.metrics = m;
    last.extra = clean({
      ...last.extra,
      duration_ms: turn.durationMs || undefined,
      done: turn.done ? undefined : false,
      interrupted: turn.interrupted || undefined,
      errors: turn.errors?.length ? turn.errors.slice(0, 20) : undefined,
      compactions: turn.compactions || undefined,
      answered_in: turn.answeredIn ?? undefined,
      answered_by: turn.answeredBy ?? undefined,
    });
  } else {
    steps[0].extra = clean({ ...steps[0].extra, done: turn.done ? undefined : false, interrupted: turn.interrupted || undefined });
  }
  return steps;
}

// The whole session as one trajectory. agent: the harness name (claude, codex, ...). Returns
// null when the session has no turn (ATIF needs a step).
export function atif(s, { agent = "claude", version = "unknown", results = null, id = undefined, trajectoryId = undefined, children = [], helperId = undefined } = {}) {
  const trs = trajectories(s);
  const steps = [];
  s.turns.forEach((turn, i) => { steps.push(...turnSteps(turn, trs[i], steps.length + 1, results, helperId, agent === "claude")); });
  if (!steps.length) return null;
  const held = steps.filter((st) => st.extra?.reasoning_withheld).length;
  // Withheld reasoning with no step after it to carry the mark (a turn that is only that).
  const heldOut = trs.reduce((n, tr) => n + (tr.heldOut ?? 0), 0);
  let prompt = 0, completion = 0, cached = 0, any = false;
  for (const st of steps) {
    if (!st.metrics) continue;
    any = true;
    prompt += st.metrics.prompt_tokens; completion += st.metrics.completion_tokens; cached += st.metrics.cached_tokens;
  }
  // The subagents a call points at, once each, then any found with no call to point from.
  const subs = [];
  const seen = new Set();
  for (const r of results?.values() ?? []) if (r.sub && !seen.has(r.sub.trajectory_id)) { seen.add(r.sub.trajectory_id); subs.push(r.sub); }
  for (const c of children) if (!seen.has(c.trajectory_id)) { seen.add(c.trajectory_id); subs.push(c); }
  // Totals with the subagents', as Harbor counts them, when every part has them.
  const fm = subs.map((c) => c.final_metrics ?? {});
  const total = (own, k) => (own == null || fm.some((m) => m[k] == null) ? own : own + fm.reduce((a, m) => a + m[k], 0));
  const model = s.turns.find((t) => t.model)?.model;
  return clean({
    schema_version: ATIF_VERSION,
    session_id: id === undefined ? s.id ?? undefined : id ?? undefined,
    // A root with nested subagents names itself too, as Harbor's does.
    trajectory_id: trajectoryId ?? (subs.length ? (id === undefined ? s.id ?? undefined : id ?? undefined) : undefined),
    agent: clean({ name: AGENT_NAMES[agent] ?? agent, version, model_name: model ?? undefined, extra: { reader: "agent-threads" } }),
    steps,
    notes: (steps.some((step) => step.reasoning_content) ? "Model thinking is kept as reasoning_content. " : "") + (held ? `${held} step${held === 1 ? " has" : "s have"} model reasoning that is not in this file (only a signature, redacted or encrypted, or cut with a step past the step limit), counted in extra.reasoning_withheld. ` : "") + (heldOut ? `${heldOut} more reasoning block${heldOut === 1 ? "" : "s"} with no step after ${heldOut === 1 ? "it" : "them"} ${heldOut === 1 ? "was" : "were"} left out the same way. ` : "") + (results
      ? "Written by agent-threads from the transcript. Tool arguments and each result's whole text (cut only past 4,194,304 characters, with a marker) are read from the transcript; a call's input summary is in tool_call.extra.input. Token counts are per turn, on its last agent step. Results are whole, so this file is as sensitive as the transcript: whatever a tool printed, a secret included, is in it."
      : "Written by agent-threads from the transcript. Tool arguments are not kept: a call's input is a summary of up to 120 characters in tool_call.extra.input. Token counts are per turn, on its last agent step."),
    final_metrics: clean({
      total_prompt_tokens: total(any ? prompt : undefined, "total_prompt_tokens"),
      total_completion_tokens: total(any ? completion : undefined, "total_completion_tokens"),
      total_cached_tokens: total(any ? cached : undefined, "total_cached_tokens"),
      total_steps: steps.length,
    }),
    extra: clean({ title: s.title ?? undefined, agent_name: s.agentName ?? undefined }),
    subagent_trajectories: subs.length ? subs : undefined,
  });
}

// ---- the command line: bun core/atif.js [--no-reasoning] <transcript> [agent] ----
// Reads the transcript the way the panel does (extract.sh, or opencode.sh), takes each call's
// whole result text (up to 4,194,304 characters, then a marker with its whole length) and
// whole input from calls.sh (THREADS_WHOLE=1, THREADS_ARGS=1), keeps
// each background wake-up's texts and calls as steps of their own (the reader's keepWakes),
// nests each subagent's own transcript (SUB_DEPTH levels at most), and prints the
// trajectory. Writes nothing. Its output holds every result whole, so it is as sensitive as the
// transcript itself: whatever a tool printed, a secret included, is in it.
const SUB_DEPTH = 4;
// Codex day folders searched for a thread's children: its own days and one either side.
const CODEX_DAYS = 60;
// The agents whose readers give no result events, so the export takes each call's outcome and
// end time from calls.sh's out lines.
const OUTCOME_FROM_CALLS = new Set(["opencode", "pi", "antigravity"]);
// Antigravity names every conversation's file alike, <data>/brain/<id>/.system_generated/logs/
// transcript_full.jsonl (or transcript.jsonl beside it), so its session id is the folder's
// <id>, as the panel's reader takes it (harness.js AGY_FILE). A file outside that layout, such
// as a copy, keeps its own name, as every other agent's does.
const AGY_FILE = /\/brain\/([0-9A-Za-z_-]+)\/\.system_generated\/logs\/transcript(?:_full)?\.jsonl$/;

async function main(argv) {
  // The model's reasoning is exported by default (Claude Code and Codex); --no-reasoning leaves
  // it out, and the file is then what it was before reasoning was read.
  const reasoning = !argv.includes("--no-reasoning");
  const [file, agent = "claude"] = argv.filter((a) => a !== "--no-reasoning");
  if (!file || !AGENT_NAMES[agent]) {
    console.error("usage: bun core/atif.js [--no-reasoning] <transcript> [claude|codex|opencode|pi|cursor|antigravity]");
    return 2;
  }
  const cp = await import("node:child_process");
  const fs = await import("node:fs");
  const { join, dirname, basename, resolve, sep } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { newSession, apply, parseChunk, nextChunk, replaced, rewindTail } = await import("./turns.js");
  const here = dirname(fileURLToPath(import.meta.url));
  const sh = (script, args, env = {}) => cp.execFileSync("sh", [join(here, script), ...args], { encoding: "utf8", maxBuffer: 256 << 20, env: { ...process.env, ...env } });
  // A file's first line (a Codex rollout's session_meta), from its first 256 KB.
  const head = (f) => {
    let fd = null;
    try {
      fd = fs.openSync(f, "r");
      const b = Buffer.alloc(262144);
      const n = fs.readSync(fd, b, 0, b.length, 0);
      const l = b.subarray(0, n).toString("utf8").split("\n")[0];
      return JSON.parse(l);
    } catch { return null; } finally { if (fd != null) fs.closeSync(fd); }
  };

  // Claude Code writes its version on each conversation line: the first one in the first 256 KB.
  const claudeVersion = (f) => {
    let fd = null;
    try {
      fd = fs.openSync(f, "r");
      const b = Buffer.alloc(262144);
      const n = fs.readSync(fd, b, 0, b.length, 0);
      return b.subarray(0, n).toString("utf8").match(/"version":"([0-9][0-9A-Za-z.+-]{0,39})"/)?.[1] ?? null;
    } catch { return null; } finally { if (fd != null) fs.closeSync(fd); }
  };

  const read = (path, env, from = 0) => {
    let s;
    if (agent === "opencode") {
      const [db, sid] = path.split("#");
      s = newSession(sid, path);
      s.keepWakes = true;
      for (let guard = 0; guard < 100000; guard++) {
        const r = parseChunk(sh("opencode.sh", ["read", db, sid, String(s.offset), "40"]));
        if (replaced(s, r)) { Object.assign(s, newSession(sid, path)); s.keepWakes = true; continue; }
        s.size = r.size;
        if (r.rewind) rewindTail(s);
        for (const e of r.events) apply(s, e);
        s.offset += r.used;
        if (s.offset >= r.size || r.used === 0) break;
      }
      return s;
    }
    const agyId = agent === "antigravity" ? AGY_FILE.exec(resolve(path))?.[1] : undefined;
    s = newSession(agyId ?? basename(path).replace(/\.jsonl$/, ""), path);
    s.keepWakes = true;
    s.offset = from;
    const base = 1 << 20;
    let chunk = base;
    for (let guard = 0; guard < 100000 && chunk; guard++) {
      const r = parseChunk(sh("extract.sh", [path, String(s.offset), String(chunk), agent, ...(reasoning ? ["reasoning"] : [])], env));
      if (r.missing) return null;
      s.size = r.size;
      for (const e of r.events) apply(s, e);
      s.offset += r.used;
      chunk = nextChunk(s, r.used, chunk, base);
      // A line that did not fit and would need more than the ceiling: step past it rather than
      // read it whole.
      if (r.used === 0 && chunk > LINE_MAX) {
        const end = nextNewline(path, s.offset);
        if (end < 0) break;
        skipped.add(`${path}:${end}`);
        s.offset = end;
        chunk = base;
      }
    }
    return s;
  };

  const fill = (s, path) => {
    const results = new Map();
    if (agent === "cursor") return results;
    const ids = s.turns.flatMap((t) => [t.steps, ...(t.wakes ?? []).map((w) => w.steps)].flatMap((l) => l.flatMap((st) => (st.ids ?? []).filter(Boolean))));
    for (let i = 0; i < ids.length; i += 200) {
      let out = "";
      try { out = sh("calls.sh", [path, agent, ...ids.slice(i, i + 200)], { THREADS_ARGS: "1", THREADS_WHOLE: "1", THREADS_LINE_MAX: String(LINE_MAX) }); } catch { out = ""; }
      for (const l of out.split("\n")) {
        let x = null;
        try { x = l ? JSON.parse(l) : null; } catch { x = null; }
        if (typeof x?.id !== "string") continue;
        const r = results.get(x.id) ?? {};
        if (x.k === "out") {
          r.out = x.out;
          // OpenCode's, Pi's and Antigravity's readers give no result events, so their
          // calls' outcome and end time are these, and a call with an out line has a result.
          // Every other agent's stay as its reader has them.
          if (OUTCOME_FROM_CALLS.has(agent)) {
            r.ended = true;
            // An Antigravity step rewritten under its step_index (ERROR, then DONE) prints a
            // line each time, and the last is the step: its outcome and time replace the
            // earlier ones whole, an unknown one included.
            if (agent === "antigravity") { delete r.failed; delete r.end; }
            if (typeof x.err === "boolean") r.failed = x.err;
            if (typeof x.ts === "string") r.end = x.ts;
          }
        }
        else if (x.k === "in") { if (OUTCOME_FROM_CALLS.has(agent) && typeof x.ts === "string") r.start = x.ts; }
        else if (x.k === "args") { if (x.unread) r.unread = true; else r.args = x.args; if (Object.hasOwn(x, "raw")) r.raw = x.raw; }
        results.set(x.id, r);
      }
    }
    // An end counts when it is a time after 1970, on a day that exists, and not before the
    // call's start; a missing start, or one that is not a time, compares false. Otherwise the end is left out, and the
    // outcome stays.
    for (const r of results.values()) {
      if (r.end === undefined) continue;
      const end = timeOf(r.end);
      if (!(end > 0) || end < timeOf(r.start ?? "")) delete r.end;
    }
    return results;
  };

  // Codex: the rollouts whose session_meta names this thread as their parent, by agent_path,
  // in the day folders (sessions/YYYY/MM/DD) the thread's turns ran in and one either side.
  const codexChildren = (path, thread, s) => {
    const found = new Map();
    if (!thread) return found;
    const day = dirname(path);
    const m = day.match(/^(.*)\/(\d{4})\/(\d{2})\/(\d{2})$/);
    const dirs = new Set([day]);
    if (m) {
      const times = s.turns.flatMap((t) => [t.ts, t.afterAt]).filter((x) => typeof x === "number" && x > 0);
      const lo = Date.UTC(+m[2], +m[3] - 1, +m[4]) - 864e5;
      const hi = Math.max(lo + 2 * 864e5, (times.length ? Math.max(...times) : 0) + 864e5);
      for (let t = lo, k = 0; t <= hi && k < CODEX_DAYS; t += 864e5, k++) {
        const d = new Date(t);
        dirs.add(join(m[1], String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, "0"), String(d.getUTCDate()).padStart(2, "0")));
      }
    }
    for (const d of dirs) {
      let names = [];
      try { names = fs.readdirSync(d); } catch { names = []; }
      for (const n of names) {
        if (!/^rollout-.*\.jsonl$/.test(n)) continue;
        const f = join(d, n);
        if (f === path) continue;
        const meta = head(f);
        const p = meta?.type === "session_meta" ? meta.payload : null;
        const spawn = p?.source?.subagent?.thread_spawn;
        if (spawn?.parent_thread_id === thread && typeof spawn.agent_path === "string")
          found.set(spawn.agent_path, { file: f, thread: p.id, from: p.subagent_history_start_ordinal });
      }
    }
    return found;
  };

  // A subagent's id comes from transcript text, which a tool result or a pasted message can
  // carry, so it is never trusted as a path: only letters, digits, "-" and "_", and the file
  // it names must resolve (links followed) inside the subagents folder, which must not be a
  // link itself. Else it is not found. The resolved path is the one read.
  const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
// Skill args shorter than this could be in any subagent's prompt: such a link is marked id only.
const SKILL_ARGS_MIN = 16;
// At most this many transcripts no call names are written; the notes count the rest.
const UNNAMED_MAX = Number(process.env.THREADS_UNNAMED_MAX) > 0 ? Number(process.env.THREADS_UNNAMED_MAX) : 200;
// A transcript line longer than this is skipped, not read: one line of hundreds of MB would
// otherwise be held whole, several times over. The notes count the lines skipped.
const LINE_MAX = Number(process.env.THREADS_LINE_MAX) > 0 ? Number(process.env.THREADS_LINE_MAX) : 64 << 20;
  const resolveInside = (dir, f) => {
    try {
      if (fs.lstatSync(dir).isSymbolicLink()) return null;
      const r = fs.realpathSync(f);
      return r.startsWith(`${fs.realpathSync(dir)}${sep}`) ? r : null;
    } catch { return null; }
  };

  // A subagent transcript's first prompt: its first user line that is not bookkeeping (isMeta),
  // as text, from the first 256 KB; null when that line carries no text.
  // The text of a file's first user record, from a byte offset, read whole however long its
  // line is; null when it has no text (an image alone) or there is none. Meta records are
  // skipped, except with meta, a first record (no parent) that is meta: a Skill-started
  // subagent's prompt is that record.
  const firstPrompt = (f, from = 0, meta = false) => {
    let got = null;
    eachLine(f, (l) => {
      let x = null;
      try { x = JSON.parse(l); } catch { return true; }
      if (x?.type !== "user") return true;
      if (x.isMeta === true && !(meta && typeof x.parentUuid !== "string")) return true;
      const c = x.message?.content;
      const t = typeof c === "string" ? c : Array.isArray(c) ? c.filter((p) => p?.type === "text" && typeof p.text === "string").map((p) => p.text).join("\n") : "";
      got = t || null;
      return false;
    }, from);
    return got;
  };
  // Each subagent file is attached to one call only: the first that names it.
  const attached = new Map();
  // Lines skipped for their size, as file:offset, so a line read twice counts once.
  const skipped = new Set();
  // The byte offset after the next newline from an offset, or -1 when there is none yet.
  const nextNewline = (f, from) => {
    let fd = null;
    try {
      fd = fs.openSync(f, "r");
      const b = Buffer.alloc(1 << 20);
      for (let pos = from; ;) {
        const n = fs.readSync(fd, b, 0, b.length, pos);
        if (n <= 0) return -1;
        const i = b.subarray(0, n).indexOf(10);
        if (i >= 0) return pos + i + 1;
        pos += n;
      }
    } catch { return -1; } finally { if (fd != null) fs.closeSync(fd); }
  };
  // Calls that started no subagent the transcript records (no launch record, no id in the
  // result), with their prompts: a transcript no call names may share one's prompt.
  const unlaunched = [];
  // A file's lines, 4 MB at a time, with the byte offset after each.
  const eachLine = (f, fn, from = 0) => {
    let fd = null;
    try {
      fd = fs.openSync(f, "r");
      const b = Buffer.alloc(4 << 20);
      let at = from;
      let pos = from;
      let rest = Buffer.alloc(0);
      let skip = false;
      for (;;) {
        const n = fs.readSync(fd, b, 0, b.length, pos);
        if (n <= 0) return;
        pos += n;
        let buf = Buffer.concat([rest, b.subarray(0, n)]);
        let i;
        while ((i = buf.indexOf(10)) >= 0) {
          at += i + 1;
          if (skip) { skip = false; skipped.add(`${f}:${at}`); }
          else if (i > LINE_MAX) skipped.add(`${f}:${at}`);
          else if (fn(buf.subarray(0, i).toString("utf8"), at) === false) return;
          buf = buf.subarray(i + 1);
        }
        // A line past the ceiling: drop what there is of it and the rest up to its newline.
        if (skip || buf.length > LINE_MAX) { skip = true; at += buf.length; buf = Buffer.alloc(0); }
        rest = Buffer.from(buf);
      }
    } catch { return; } finally { if (fd != null) fs.closeSync(fd); }
  };
  // A record's own uuid, its top-level key only.
  const uuidOf = (l) => { try { const u = JSON.parse(l)?.uuid; return typeof u === "string" ? u : null; } catch { return null; } };
  const uuidSets = new Map();
  const uuidsOf = (f) => {
    if (!uuidSets.has(f)) { const set = new Set(); eachLine(f, (l) => { const u = uuidOf(l); if (u) set.add(u); }); uuidSets.set(f, set); }
    return uuidSets.get(f);
  };
  // A forked subagent's file starts with copies of its caller's records (the same uuids). The
  // byte offset after the last of them, where the subagent's own records start; 0 for none.
  const copiedPrefix = (f, caller) => {
    const theirs = uuidsOf(caller);
    let end = 0;
    eachLine(f, (l, at) => {
      const u = uuidOf(l);
      if (!u) return true;
      if (!theirs.has(u)) return false;
      end = at;
      return true;
    });
    return end;
  };
  // A Skill call that forked a subagent: its launch record (status "forked") names the id.
  const forkedSkill = (s, call) => {
    const a = s.agents?.get(call);
    if (a?.st !== "forked") return null;
    for (const [id, v] of s.agentIds ?? []) if (v === a) return id;
    return null;
  };

  const build = (path, opts, depth, seen) => {
    const meta = agent === "codex" ? head(path) : null;
    // A subagent rollout read alone still starts at its own history: session_meta's
    // subagent_history_start_ordinal, the same boundary an attached read passes in env.
    const own = agent === "codex" && opts.env?.THREADS_FROM_ORDINAL === undefined
      && Number.isInteger(meta?.payload?.subagent_history_start_ordinal)
      ? { THREADS_FROM_ORDINAL: String(meta.payload.subagent_history_start_ordinal) } : {};
    const s = read(path, { ...opts.env, ...own }, opts.from ?? 0);
    if (!s) return null;
    const results = fill(s, path);
    const thread = meta?.type === "session_meta" && typeof meta.payload?.id === "string" ? meta.payload.id : null;
    const root = opts.root ?? (agent === "codex" ? thread : s.id) ?? s.id;
    const version = agent === "codex" ? meta?.payload?.cli_version : agent === "claude" ? claudeVersion(path) : null;
    let kids = null;
    for (const tr of trajectories(s)) for (const g of tr.groups) for (const c of g.cells) {
      if (c.kind !== "tool" || !c.call) continue;
      const r = results.get(c.call) ?? {};
      let child = null;
      const skill = agent === "claude" && !c.subagent && c.tool === "Skill" ? forkedSkill(s, c.call) : null;
      if (agent === "claude" && typeof c.subagent?.agent !== "string" && (c.tool === "Agent" || c.tool === "Task") && typeof r.args?.prompt === "string" && r.args.prompt.trim())
        unlaunched.push({ call: c.call, prompt: r.args.prompt.trim() });
      if (agent === "claude" && (c.subagent || skill)) {
        const a = skill ?? c.subagent.agent;
        // Claude Code writes every subagent, a subagent's own included, flat in the session's
        // one subagents folder; a folder beside a subagent's file is only the fallback. Either
        // way the file must resolve inside the session's subagents folder.
        const subs = opts.subs ?? join(path.replace(/\.jsonl$/, ""), "subagents");
        if (typeof a === "string" && SAFE_ID.test(a)) {
          const flat = join(subs, `agent-${a}.jsonl`);
          const beside = join(path.replace(/\.jsonl$/, ""), "subagents", `agent-${a}.jsonl`);
          const f = resolveInside(subs, fs.existsSync(flat) ? flat : beside);
          if (f) child = { file: f, id: a, env: { THREADS_SIDECHAIN: "1" }, from: 0 };
        }
      } else if (agent === "codex" && /^spawn_agent$/.test(c.tool)) {
        let task = null;
        try { task = JSON.parse(r.out ?? "null")?.task_name ?? null; } catch { task = null; }
        kids ??= codexChildren(path, thread, s);
        const k = task ? kids.get(task) : null;
        if (k) child = { file: k.file, id: k.thread, env: Number.isInteger(k.from) ? { THREADS_FROM_ORDINAL: String(k.from) } : {} };
      } else continue;
      // A Claude Code subagent named by text could be any subagent of the session: its own first
      // prompt (after any records copied from the caller) must be the call's prompt, or end with
      // it for a fork, and no other call may have it already. A Skill call's subagent is named by
      // its launch record, not by text: it is attached, and when its first prompt does not hold
      // the call's args, extra says the link rests on the id alone.
      if (child && agent === "claude") {
        if (attached.has(child.file)) { r.subReason = `already attached to ${attached.get(child.file)}`; child = null; }
        else if (skill) {
          // Named by its launch record. Its prompt is its first record, which Claude Code marks
          // meta; the Skill call's args should be in it.
          const got = firstPrompt(child.file, 0, true);
          const args = typeof r.args?.args === "string" ? r.args.args.trim() : "";
          if (!args) r.subLink = "id only: the Skill call has no args to look for in the subagent's first prompt";
          else if (args.length < SKILL_ARGS_MIN) r.subLink = `id only: the Skill call's args are under ${SKILL_ARGS_MIN} characters, too short to tell one subagent from another`;
          else if (got == null) r.subLink = "id only: the subagent's first prompt could not be read";
          else if (!got.includes(args)) r.subLink = "id only: the subagent's first prompt does not hold the Skill call's args";
          // Only the file's first record is the prompt: the reader is told its uuid.
          let first = null;
          eachLine(child.file, (l) => { first = uuidOf(l); return false; });
          if (first && SAFE_ID.test(first.replace(/-/g, "_"))) child.env = { ...child.env, THREADS_SKILL: first };
          attached.set(child.file, c.call);
        } else {
          const want = typeof r.args?.prompt === "string" ? r.args.prompt.trim() : null;
          const fork = r.args?.subagent_type === "fork";
          // A fork's file starts with copies of its caller's records; its own start after them.
          if (fork) child.from = copiedPrefix(child.file, path);
          const got = want ? firstPrompt(child.file, child.from)?.trim() || null : null;
          if (want === "") { r.subReason = "the call's prompt is empty"; child = null; }
          else if (want != null && got != null && !(fork ? got.endsWith(want) : got === want)) { r.subReason = "its first prompt is not the call's prompt"; child = null; }
          else {
            // Nothing to compare: attached on the id alone, and marked so.
            if (want == null) r.subLink = "id only: the call has no prompt to compare";
            else if (got == null) r.subLink = "id only: the subagent's first prompt could not be read";
            attached.set(child.file, c.call);
            // Read after its copied records, a fork's prompt sits beside the call's result.
            if (fork && child.from > 0) child.env = { ...child.env, THREADS_FORK: "1" };
          }
        }
      }
      const t = child && depth < SUB_DEPTH && !seen.has(child.file) && fs.existsSync(child.file)
        ? build(child.file, { env: child.env, from: child.from ?? 0, root, id: root, trajectoryId: child.id, subs: opts.subs ?? (agent === "claude" ? join(path.replace(/\.jsonl$/, ""), "subagents") : undefined) }, depth + 1, new Set([...seen, child.file]))
        : null;
      if (t) r.sub = t; else r.subMissing = true;
      results.set(c.call, r);
    }
    return atif(s, { agent, results, id: opts.id ?? root, trajectoryId: opts.trajectoryId, helperId: agent === "claude" ? opts.trajectoryId : undefined, version: typeof version === "string" && version ? version.slice(0, 40) : "unknown" });
  };

  if (agent !== "opencode" && !fs.existsSync(file)) { console.error("no transcript"); return 3; }
  const t = build(file, {}, 0, new Set([file]));
  if (!t) { console.error("no turns"); return 1; }
  // Claude Code subagent transcripts in the session's subagents folder that no call names. They
  // happened, so they are written, but attached to no call: extra.subagents_no_call_names, each
  // with a promptId it shares with the session as a hint, never a link. Same id and path checks.
  if (agent === "claude") {
    const subs = join(file.replace(/\.jsonl$/, ""), "subagents");
    let names = [];
    try { names = fs.lstatSync(subs).isSymbolicLink() ? [] : fs.readdirSync(subs).sort(); } catch { names = []; }
    let rootIds = null;
    const unnamed = [];
    let left = 0;
    for (const n of names) {
      const m = /^agent-([A-Za-z0-9_-]{1,80})\.jsonl$/.exec(n);
      const f = m ? resolveInside(subs, join(subs, n)) : null;
      if (!f || attached.has(f)) continue;
      if (unnamed.length >= UNNAMED_MAX) { left++; continue; }
      attached.set(f, "no call");
      const tr = build(f, { env: { THREADS_SIDECHAIN: "1" }, root: t.session_id, id: t.session_id, trajectoryId: m[1], subs }, 1, new Set([file, f]));
      if (!tr) continue;
      const pid = head(f)?.promptId;
      // The session's promptIds, read once, each from a record's own key.
      if (!rootIds) { rootIds = new Set(); eachLine(file, (l) => { try { const p = JSON.parse(l)?.promptId; if (typeof p === "string") rootIds.add(p); } catch { /* not JSON */ } }); }
      const shared = typeof pid === "string" && SAFE_ID.test(pid) && rootIds.has(pid) ? pid : null;
      // Calls with no launch record whose prompt is exactly this transcript's first prompt.
      const own = firstPrompt(f)?.trim() || null;
      const same = own ? unlaunched.filter((u) => u.prompt === own).map((u) => u.call) : [];
      unnamed.push({ hint: { note: "hints, not links: no call in the session names this transcript; shared_prompt_id is a promptId it shares with the session, and same_prompt_calls are calls with no launch record whose prompt is its first prompt", shared_prompt_id: shared, same_prompt_calls: same }, trajectory: tr });
    }
    if (unnamed.length) {
      t.extra = { ...(t.extra ?? {}), subagents_no_call_names: unnamed };
      t.notes = `${t.notes} ${unnamed.length} subagent ${unnamed.length === 1 ? "transcript" : "transcripts"} in the session's subagents folder that no call names ${unnamed.length === 1 ? "is" : "are"} in extra.subagents_no_call_names, attached to no call and not counted in final_metrics.`;
    }
    if (left) t.notes = `${t.notes} ${left} more that no call names ${left === 1 ? "is" : "are"} left out: at most ${UNNAMED_MAX} are written.`;
  }
  if (skipped.size) t.notes = `${t.notes} ${skipped.size} transcript ${skipped.size === 1 ? "line was" : "lines were"} skipped for being longer than ${LINE_MAX} bytes, so what ${skipped.size === 1 ? "it held is" : "they held is"} missing.`;
  process.stdout.write(`${JSON.stringify(t, null, 1)}\n`);
  return 0;
}

if (import.meta.main) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
