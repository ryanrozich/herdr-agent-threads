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
//   (result_ts) and whether it failed. The panel's reader keeps no arguments, so arguments
//   is {} unless the caller read them (the command line does, from calls.sh); a call whose
//   input was not JSON, or was not read, keeps {} and says so (extra.arguments_unread).
// - A call with no result yet keeps its observation result, with no content and
//   extra.no_result. A call the transcript gives no id has none made up for the join: its
//   tool_call_id is "<turn id>#<step>.<call>" and tool_call.extra.id_from_reader is true.
// - A subagent call's run (its agent id, state, tokens, time) is in its result's extra. Its
//   own steps are in its own transcript: the command line reads it (Claude Code's
//   subagents/agent-<id>.jsonl beside the session; Codex's rollout whose session_meta names
//   this thread as its parent) and nests it in subagent_trajectories, its call's result
//   pointing at it (subagent_trajectory_ref). One it cannot find is marked
//   (extra.subagent_transcript "not found"). The totals then count the subagents too, as
//   Harbor's do.
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

// One turn's steps, numbered from `next`. results: an optional Map from call id to what the
// command line read from calls.sh: the result's text (out), the call's whole input (args), or
// that its input is not JSON (unread); and for a subagent call its trajectory (sub) or that
// its transcript was not found (subMissing).
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
      const got = c.call ? results?.get(c.call) : null;
      const args = got?.args && typeof got.args === "object" && !Array.isArray(got.args) ? got.args : null;
      const unread = results && !args ? (got?.unread ? "not JSON" : "not read") : undefined;
      toolCalls.push(clean({ tool_call_id: id, function_name: c.tool, arguments: args ?? {},
        extra: clean({ input: c.input ?? undefined, arguments_unread: unread, id_from_reader: c.call ? undefined : true, started: iso(c.start) }) }));
      if (!c.call) return;
      res.push(clean({
        source_call_id: c.call,
        content: typeof got?.out === "string" ? got.out : undefined,
        subagent_trajectory_ref: got?.sub ? [clean({ trajectory_id: got.sub.trajectory_id, session_id: got.sub.session_id })] : undefined,
        extra: clean({
          subagent_transcript: got?.subMissing ? "not found" : undefined,
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
export function atif(s, { agent = "claude", version = "unknown", results = null, id = undefined, trajectoryId = undefined, children = [] } = {}) {
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
    trajectory_id: trajectoryId,
    agent: clean({ name: AGENT_NAMES[agent] ?? agent, version, model_name: model ?? undefined, extra: { reader: "agent-threads" } }),
    steps,
    notes: results
      ? "Written by agent-threads from the transcript. Tool arguments and result text are read from the transcript (a result's text up to 24 KB); a call's input summary is in tool_call.extra.input. Token counts are per turn, on its last agent step."
      : "Written by agent-threads from the transcript. Tool arguments are not kept: a call's input is a summary of up to 120 characters in tool_call.extra.input. Token counts are per turn, on its last agent step.",
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

// ---- the command line: bun core/atif.js <transcript> [agent] ----
// Reads the transcript the way the panel does (extract.sh, or opencode.sh), takes each call's
// result text (at most 24 KB a call) and whole input from calls.sh, nests each subagent's own
// transcript (SUB_DEPTH levels at most), and prints the trajectory. Writes nothing.
const SUB_DEPTH = 4;
// Codex day folders searched for a thread's children: its own days and one either side.
const CODEX_DAYS = 60;

async function main(argv) {
  const [file, agent = "claude"] = argv;
  if (!file || !AGENT_NAMES[agent]) {
    console.error("usage: bun core/atif.js <transcript> [claude|codex|opencode|pi|cursor|antigravity]");
    return 2;
  }
  const cp = await import("node:child_process");
  const fs = await import("node:fs");
  const { join, dirname, basename } = await import("node:path");
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

  const read = (path, env) => {
    let s;
    if (agent === "opencode") {
      const [db, sid] = path.split("#");
      s = newSession(sid, path);
      for (let guard = 0; guard < 100000; guard++) {
        const r = parseChunk(sh("opencode.sh", ["read", db, sid, String(s.offset), "40"]));
        if (replaced(s, r)) { Object.assign(s, newSession(sid, path)); continue; }
        s.size = r.size;
        if (r.rewind) rewindTail(s);
        for (const e of r.events) apply(s, e);
        s.offset += r.used;
        if (s.offset >= r.size || r.used === 0) break;
      }
      return s;
    }
    s = newSession(basename(path).replace(/\.jsonl$/, ""), path);
    const base = 1 << 20;
    let chunk = base;
    for (let guard = 0; guard < 100000 && chunk; guard++) {
      const r = parseChunk(sh("extract.sh", [path, String(s.offset), String(chunk), agent], env));
      if (r.missing) return null;
      s.size = r.size;
      for (const e of r.events) apply(s, e);
      s.offset += r.used;
      chunk = nextChunk(s, r.used, chunk, base);
    }
    return s;
  };

  const fill = (s, path) => {
    const results = new Map();
    if (agent === "cursor") return results;
    const ids = s.turns.flatMap((t) => t.steps.flatMap((st) => (st.ids ?? []).filter(Boolean)));
    for (let i = 0; i < ids.length; i += 200) {
      let out = "";
      try { out = sh("calls.sh", [path, agent, ...ids.slice(i, i + 200)], { THREADS_ARGS: "1" }); } catch { out = ""; }
      for (const l of out.split("\n")) {
        let x = null;
        try { x = l ? JSON.parse(l) : null; } catch { x = null; }
        if (typeof x?.id !== "string") continue;
        const r = results.get(x.id) ?? {};
        if (x.k === "out") r.out = x.out;
        else if (x.k === "args") { if (x.unread) r.unread = true; else r.args = x.args; }
        results.set(x.id, r);
      }
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

  const build = (path, opts, depth, seen) => {
    const s = read(path, opts.env);
    if (!s) return null;
    const results = fill(s, path);
    const meta = agent === "codex" ? head(path) : null;
    const thread = meta?.type === "session_meta" && typeof meta.payload?.id === "string" ? meta.payload.id : null;
    const root = opts.root ?? (agent === "codex" ? thread : s.id) ?? s.id;
    let kids = null;
    for (const tr of trajectories(s)) for (const g of tr.groups) for (const c of g.cells) {
      if (c.kind !== "tool" || !c.call) continue;
      const r = results.get(c.call) ?? {};
      let child = null;
      if (agent === "claude" && c.subagent) {
        const a = c.subagent.agent;
        if (a) child = { file: join(path.replace(/\.jsonl$/, ""), "subagents", `agent-${a}.jsonl`), id: a, env: { THREADS_SIDECHAIN: "1" } };
      } else if (agent === "codex" && /^spawn_agent$/.test(c.tool)) {
        let task = null;
        try { task = JSON.parse(r.out ?? "null")?.task_name ?? null; } catch { task = null; }
        kids ??= codexChildren(path, thread, s);
        const k = task ? kids.get(task) : null;
        if (k) child = { file: k.file, id: k.thread, env: Number.isInteger(k.from) ? { THREADS_FROM_ORDINAL: String(k.from) } : {} };
      } else continue;
      const t = child && depth < SUB_DEPTH && !seen.has(child.file) && fs.existsSync(child.file)
        ? build(child.file, { env: child.env, root, id: root, trajectoryId: child.id }, depth + 1, new Set([...seen, child.file]))
        : null;
      if (t) r.sub = t; else r.subMissing = true;
      results.set(c.call, r);
    }
    return atif(s, { agent, results, id: opts.id, trajectoryId: opts.trajectoryId });
  };

  if (agent !== "opencode" && !fs.existsSync(file)) { console.error("no transcript"); return 3; }
  const t = build(file, {}, 0, new Set([file]));
  if (!t) { console.error("no turns"); return 1; }
  process.stdout.write(`${JSON.stringify(t, null, 1)}\n`);
  return 0;
}

if (import.meta.main) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
