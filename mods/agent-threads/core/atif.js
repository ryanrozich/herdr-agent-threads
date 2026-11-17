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
// - A step's end (end_ts), a call's input summary (tool_call.extra.input: the reader keeps
//   no arguments, so arguments is {}), a result's time (result_ts) and whether it failed.
// - A call with no result yet keeps its observation result, with no content and
//   extra.no_result. A call the transcript gives no id has none made up for the join: its
//   tool_call_id is "<turn id>#<step>.<call>" and tool_call.extra.id_from_reader is true.
// - A subagent call's run (its agent id, state, tokens, time) is in its result's extra. Its
//   own steps are in its own transcript, not read here, so no subagent_trajectories yet.
// - Calls counted but not named (past STEP_CALLS) are a count, extra.calls_not_listed.
// Times are ISO 8601 where the transcript gives one, else left out, never made up.

import { trajectories } from "./trajectory.js";
import { STEP_TEXT } from "./turns.js";

export const ATIF_VERSION = "ATIF-v1.7";

// Harbor's agent names (AgentName) for the readers' harness names.
export const AGENT_NAMES = { claude: "claude-code", codex: "codex", opencode: "opencode", pi: "pi", cursor: "cursor-cli", antigravity: "antigravity-cli" };

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : undefined);

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

// One turn's steps, numbered from `next`. results: an optional Map from call id to the
// result's text ({ out }), which the command line fills from calls.sh.
function turnSteps(turn, tr, next, results) {
  const steps = [];
  const base = clean({ turn: turn.n, turn_id: tr.id });
  const agentStep = (fields, extra) => {
    const st = clean({
      step_id: next + steps.length,
      timestamp: fields.timestamp,
      source: "agent",
      model_name: turn.model ?? undefined,
      reasoning_effort: turn.effort ?? undefined,
      message: fields.message ?? "",
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
  for (const g of groups) {
    const msg = g.cells.find((c) => c.kind === "message" || c.kind === "context");
    const tools = g.cells.filter((c) => c.kind === "tool");
    const more = g.cells.find((c) => c.kind === "more");
    const stepId = next + steps.length;
    const toolCalls = [];
    const res = [];
    tools.forEach((c, i) => {
      const id = c.call ?? `${tr.id ?? turn.n}#${stepId}.${i + 1}`;
      toolCalls.push(clean({ tool_call_id: id, function_name: c.tool, arguments: {}, extra: clean({ input: c.input ?? undefined, id_from_reader: c.call ? undefined : true, started: iso(c.start) }) }));
      if (!c.call) return;
      const got = results?.get(c.call);
      res.push(clean({
        source_call_id: c.call,
        content: typeof got?.out === "string" ? got.out : undefined,
        extra: clean({
          result_ts: iso(c.result?.end),
          failed: c.result?.failed ?? undefined,
          no_result: c.result?.end == null && c.result?.failed == null ? true : undefined,
          subagent: c.subagent ? clean(c.subagent) ?? undefined : undefined,
        }),
      }));
    });
    const start = msg?.start ?? tools.find((c) => c.start != null)?.start;
    agentStep({ timestamp: iso(start), message: msg?.text, tool_calls: toolCalls, results: res }, {
      kind: g.title === "Update" ? "background_update" : undefined,
      end_ts: iso(msg?.end),
      cut: msg?.cut ? STEP_TEXT : undefined,
      calls_not_listed: more?.count,
    });
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
export function atif(s, { agent = "claude", version = "unknown", results = null } = {}) {
  const trs = trajectories(s);
  const steps = [];
  s.turns.forEach((turn, i) => { steps.push(...turnSteps(turn, trs[i], steps.length + 1, results)); });
  if (!steps.length) return null;
  let prompt = 0, completion = 0, cached = 0, any = false;
  for (const st of steps) {
    if (!st.metrics) continue;
    any = true;
    prompt += st.metrics.prompt_tokens; completion += st.metrics.completion_tokens; cached += st.metrics.cached_tokens;
  }
  const model = s.turns.find((t) => t.model)?.model;
  return clean({
    schema_version: ATIF_VERSION,
    session_id: s.id ?? undefined,
    agent: clean({ name: AGENT_NAMES[agent] ?? agent, version, model_name: model ?? undefined, extra: { reader: "agent-threads" } }),
    steps,
    notes: "Written by agent-threads from the transcript. Tool arguments are not kept: a call's input is a summary of up to 120 characters in tool_call.extra.input. Token counts are per turn, on its last agent step.",
    final_metrics: clean({
      total_prompt_tokens: any ? prompt : undefined,
      total_completion_tokens: any ? completion : undefined,
      total_cached_tokens: any ? cached : undefined,
      total_steps: steps.length,
    }),
    extra: clean({ title: s.title ?? undefined, agent_name: s.agentName ?? undefined }),
  });
}

// ---- the command line: bun core/atif.js <transcript> [agent] ----
// Reads the transcript the way the panel does (extract.sh, or opencode.sh), takes each call's
// result text from calls.sh (at most 24 KB a call), and prints the trajectory. Writes nothing.
async function main(argv) {
  const [file, agent = "claude"] = argv;
  if (!file || !AGENT_NAMES[agent]) {
    console.error("usage: bun core/atif.js <transcript> [claude|codex|opencode|pi|cursor|antigravity]");
    return 2;
  }
  const cp = await import("node:child_process");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { newSession, apply, parseChunk, nextChunk, replaced, rewindTail } = await import("./turns.js");
  const here = dirname(fileURLToPath(import.meta.url));
  const sh = (script, args) => cp.execFileSync("sh", [join(here, script), ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
  let s;
  if (agent === "opencode") {
    const [db, sid] = file.split("#");
    s = newSession(sid, file);
    for (let guard = 0; guard < 100000; guard++) {
      const r = parseChunk(sh("opencode.sh", ["read", db, sid, String(s.offset), "40"]));
      if (replaced(s, r)) { Object.assign(s, newSession(sid, file)); continue; }
      s.size = r.size;
      if (r.rewind) rewindTail(s);
      for (const e of r.events) apply(s, e);
      s.offset += r.used;
      if (s.offset >= r.size || r.used === 0) break;
    }
  } else {
    s = newSession(file.split("/").pop().replace(/\.jsonl$/, ""), file);
    const base = 1 << 20;
    let chunk = base;
    for (let guard = 0; guard < 100000 && chunk; guard++) {
      const r = parseChunk(sh("extract.sh", [file, String(s.offset), String(chunk), agent]));
      if (r.missing) { console.error("no transcript"); return 3; }
      s.size = r.size;
      for (const e of r.events) apply(s, e);
      s.offset += r.used;
      chunk = nextChunk(s, r.used, chunk, base);
    }
  }
  const ids = s.turns.flatMap((t) => t.steps.flatMap((st) => (st.ids ?? []).filter(Boolean)));
  const results = new Map();
  if (agent !== "cursor") {
    for (let i = 0; i < ids.length; i += 200) {
      let out = "";
      try { out = sh("calls.sh", [file, agent, ...ids.slice(i, i + 200)]); } catch { out = ""; }
      for (const l of out.split("\n")) {
        let x = null;
        try { x = l ? JSON.parse(l) : null; } catch { x = null; }
        if (x?.k === "out" && typeof x.id === "string") results.set(x.id, { out: x.out });
      }
    }
  }
  const t = atif(s, { agent, results });
  if (!t) { console.error("no turns"); return 1; }
  process.stdout.write(`${JSON.stringify(t, null, 1)}\n`);
  return 0;
}

if (import.meta.main) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
