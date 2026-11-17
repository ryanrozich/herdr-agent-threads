// bun test: each agent's synthetic session written as ATIF-v1.7 (core/atif.js), checked
// against Harbor's rules for the schema (src/harbor/models/trajectories: the fields each
// object allows, the required ones, step ids from 1, agent-only fields, results joined to a
// call of their own step) and against golden files in test/fixtures/atif.
// UPDATE=1 bun test test/atif.test.js writes the golden files again.
import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply, parseChunk, nextChunk, replaced, rewindTail } from "../mods/agent-threads/core/turns.js";
import { trajectories } from "../mods/agent-threads/core/trajectory.js";
import { atif, ATIF_VERSION } from "../mods/agent-threads/core/atif.js";

const root = join(import.meta.dir, "..");
const core = join(root, "mods/agent-threads/core");
const golden = join(root, "test/fixtures/atif");

const dir = mkdtempSync(join(tmpdir(), "threads-atif-"));
const claude = join(dir, "claude.jsonl");
execFileSync("bun", [join(root, "test/make-fixture.js"), claude, "00000000-0000-4000-8000-000000000042", "/Users/dev/acme-web", "--subagents"]);
const [codex, oc, pi, cursor, agy] = execFileSync("bun", [join(root, "test/make-agents.js"), dir, "/Users/dev/acme-web", "2026-11-01T09:00:00Z"], { encoding: "utf8" })
  .trim().split("\n");

function readFile(file, harness) {
  const s = newSession("s", file);
  const base = 1 << 20;
  let chunk = base;
  for (let guard = 0; guard < 1000 && chunk; guard++) {
    const r = parseChunk(execFileSync("sh", [join(core, "extract.sh"), file, String(s.offset), String(chunk), harness], { encoding: "utf8" }));
    s.size = r.size;
    for (const e of r.events) apply(s, e);
    s.offset += r.used;
    chunk = nextChunk(s, r.used, chunk, base);
  }
  return s;
}
function readOpencode(ref) {
  const [db, sid] = ref.split("#");
  const s = newSession(sid, ref);
  for (let guard = 0; guard < 100; guard++) {
    const r = parseChunk(execFileSync("sh", [join(core, "opencode.sh"), "read", db, sid, String(s.offset), "40"], { encoding: "utf8" }));
    if (replaced(s, r)) { Object.assign(s, newSession(sid, ref)); continue; }
    s.size = r.size;
    if (r.rewind) rewindTail(s);
    for (const e of r.events) apply(s, e);
    s.offset += r.used;
    if (s.offset >= r.size || r.used === 0) break;
  }
  return s;
}

// Harbor's ATIF-v1.7 rules, as its Pydantic models state them (extra fields forbidden).
const FIELDS = {
  trajectory: ["schema_version", "session_id", "trajectory_id", "agent", "steps", "notes", "final_metrics", "continued_trajectory_ref", "extra", "subagent_trajectories"],
  agent: ["name", "version", "model_name", "tool_definitions", "extra"],
  step: ["step_id", "timestamp", "source", "model_name", "reasoning_effort", "message", "reasoning_content", "tool_calls", "observation", "metrics", "is_copied_context", "llm_call_count", "extra"],
  tool_call: ["tool_call_id", "function_name", "arguments", "extra"],
  observation: ["results"],
  result: ["source_call_id", "content", "subagent_trajectory_ref", "extra"],
  metrics: ["prompt_tokens", "completion_tokens", "cached_tokens", "cost_usd", "prompt_token_ids", "completion_token_ids", "logprobs", "extra"],
  final_metrics: ["total_prompt_tokens", "total_completion_tokens", "total_cached_tokens", "total_cost_usd", "total_steps", "extra"],
  ref: ["trajectory_id", "session_id", "trajectory_path", "extra"],
};
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isoOk = (t) => typeof t === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(t) && Number.isFinite(Date.parse(t));
function problems(t) {
  const out = [];
  const only = (o, kind, at) => { for (const k of Object.keys(o)) if (!FIELDS[kind].includes(k)) out.push(`${at}: ${kind} has no field ${k}`); };
  const intOrNull = (v, at) => { if (v != null && !Number.isInteger(v)) out.push(`${at} is not an integer`); };
  if (!isObj(t)) return ["not an object"];
  only(t, "trajectory", "trajectory");
  if (t.schema_version !== ATIF_VERSION) out.push(`schema_version ${t.schema_version}`);
  if (!isObj(t.agent) || typeof t.agent.name !== "string" || typeof t.agent.version !== "string") out.push("agent needs a name and a version");
  else only(t.agent, "agent", "agent");
  if (!Array.isArray(t.steps) || !t.steps.length) return [...out, "steps must have one step or more"];
  t.steps.forEach((st, i) => {
    const at = `steps[${i}]`;
    only(st, "step", at);
    if (st.step_id !== i + 1) out.push(`${at}.step_id ${st.step_id}, expected ${i + 1}`);
    if (!["system", "user", "agent"].includes(st.source)) out.push(`${at}.source ${st.source}`);
    if (typeof st.message !== "string") out.push(`${at}.message must be a string`);
    if (st.timestamp != null && !isoOk(st.timestamp)) out.push(`${at}.timestamp ${st.timestamp}`);
    if (st.source !== "agent") for (const k of ["model_name", "reasoning_effort", "reasoning_content", "tool_calls", "metrics"]) if (st[k] != null) out.push(`${at}.${k} on a ${st.source} step`);
    const ids = new Set();
    for (const [j, c] of (st.tool_calls ?? []).entries()) {
      only(c, "tool_call", `${at}.tool_calls[${j}]`);
      if (typeof c.tool_call_id !== "string" || typeof c.function_name !== "string" || !isObj(c.arguments)) out.push(`${at}.tool_calls[${j}] needs an id, a name and arguments`);
      ids.add(c.tool_call_id);
    }
    if (st.observation != null) {
      only(st.observation, "observation", `${at}.observation`);
      for (const [j, r] of st.observation.results.entries()) {
        only(r, "result", `${at}.observation.results[${j}]`);
        if (r.source_call_id != null && !ids.has(r.source_call_id)) out.push(`${at} result for ${r.source_call_id}, no such call in the step`);
        if (r.content != null && typeof r.content !== "string") out.push(`${at} result content`);
        for (const [k, ref] of (r.subagent_trajectory_ref ?? []).entries()) {
          only(ref, "ref", `${at}.observation.results[${j}].subagent_trajectory_ref[${k}]`);
          if (ref.trajectory_id == null && ref.trajectory_path == null) out.push(`${at} a subagent ref needs a trajectory_id or a trajectory_path`);
        }
      }
    }
    if (st.metrics != null) {
      only(st.metrics, "metrics", `${at}.metrics`);
      for (const k of ["prompt_tokens", "completion_tokens", "cached_tokens"]) intOrNull(st.metrics[k], `${at}.metrics.${k}`);
    }
    if (st.extra != null && !isObj(st.extra)) out.push(`${at}.extra`);
  });
  if (t.final_metrics != null) {
    only(t.final_metrics, "final_metrics", "final_metrics");
    for (const k of ["total_prompt_tokens", "total_completion_tokens", "total_cached_tokens", "total_steps"]) intOrNull(t.final_metrics[k], `final_metrics.${k}`);
  }
  // Embedded subagents: each a whole trajectory with its own unique trajectory_id.
  const subIds = new Set();
  for (const [i, sub] of (t.subagent_trajectories ?? []).entries()) {
    if (typeof sub?.trajectory_id !== "string") out.push(`subagent_trajectories[${i}] needs a trajectory_id`);
    else if (subIds.has(sub.trajectory_id)) out.push(`subagent_trajectories[${i}] repeats ${sub.trajectory_id}`);
    else subIds.add(sub.trajectory_id);
    for (const p of problems(sub)) out.push(`subagent_trajectories[${i}]: ${p}`);
  }
  return out;
}

function same(name, value) {
  const file = join(golden, name);
  const text = `${JSON.stringify(value, null, 1)}\n`;
  if (process.env.UPDATE || !existsSync(file)) { mkdirSync(golden, { recursive: true }); writeFileSync(file, text); }
  expect(text).toBe(readFileSync(file, "utf8"));
}

const AGENTS = [
  ["claude", () => readFile(claude, "claude")],
  ["codex", () => readFile(codex, "codex")],
  ["opencode", () => readOpencode(oc)],
  ["pi", () => readFile(pi, "pi")],
  ["cursor", () => readFile(cursor, "cursor")],
  ["antigravity", () => readFile(agy, "antigravity")],
];

for (const [name, read] of AGENTS) {
  test(`atif: ${name}'s session is a valid ATIF-v1.7 trajectory with every turn, call and time the trajectory shape has, as the golden file has it`, () => {
    const s = read();
    const t = atif(s, { agent: name });
    expect(problems(t)).toEqual([]);
    // A user step per turn, in order, each with its turn's stable id.
    const trs = trajectories(s);
    const users = t.steps.filter((st) => st.source === "user");
    expect(users.map((st) => st.extra.turn_id)).toEqual(trs.map((tr) => tr.id));
    // Every call of the trajectory shape, by id and name, in order; every result by its id.
    const cells = trs.flatMap((tr) => tr.groups.flatMap((g) => g.cells.filter((c) => c.kind === "tool")));
    const calls = t.steps.flatMap((st) => st.tool_calls ?? []);
    expect(calls.map((c) => c.function_name)).toEqual(cells.map((c) => c.tool));
    expect(calls.filter((c) => !c.extra?.id_from_reader).map((c) => c.tool_call_id)).toEqual(cells.filter((c) => c.call).map((c) => c.call));
    const results = t.steps.flatMap((st) => st.observation?.results ?? []);
    expect(results.map((r) => r.source_call_id)).toEqual(cells.filter((c) => c.call).map((c) => c.call));
    // Times only where the shape has them.
    const timed = cells.filter((c) => c.result?.end != null).length;
    expect(results.filter((r) => r.extra?.result_ts).length).toBe(timed);
    expect(t.final_metrics.total_steps).toBe(t.steps.length);
    same(`${name}.json`, t);
  });
}

test("atif: Claude Code's and Codex's steps keep their times, results their times and failures, tokens counted as Harbor counts them", () => {
  for (const [file, harness, bad] of [[claude, "claude", "bun test login"], [codex, "codex", "bun test cart/total.test.ts"]]) {
    const s = readFile(file, harness);
    const t = atif(s, { agent: harness });
    // Every agent step has its time, but a background update: the reader keeps none for it yet.
    const agentSteps = t.steps.filter((st) => st.source === "agent");
    expect(agentSteps.filter((st) => st.extra?.kind !== "background_update").every((st) => st.timestamp)).toBe(true);
    const calls = agentSteps.flatMap((st) => (st.tool_calls ?? []).map((c) => ({ c, r: st.observation.results.find((r) => r.source_call_id === c.tool_call_id) })));
    expect(calls.every(({ c, r }) => c.extra.input && r.extra.result_ts >= c.extra.started)).toBe(true);
    expect(calls.filter(({ r }) => r.extra.failed).map(({ c }) => c.extra.input)).toEqual([bad]);
    // Tokens: per turn on its last agent step; prompt tokens are input, cache reads and writes.
    for (const turn of s.turns) {
      const own = t.steps.filter((st) => st.extra?.turn === turn.n && st.source === "agent");
      const sum = Object.values(turn.usage).reduce((a, u) => ({ i: a.i + u.i, o: a.o + u.o, cr: a.cr + u.cr, cc: a.cc + u.cc }), { i: 0, o: 0, cr: 0, cc: 0 });
      const m = own[own.length - 1]?.metrics;
      if (!Object.keys(turn.usage).length) { expect(m).toBeUndefined(); continue; }
      expect(m).toEqual({ prompt_tokens: sum.i + sum.cr + sum.cc, completion_tokens: sum.o, cached_tokens: sum.cr, extra: { cache_creation_input_tokens: sum.cc, scope: "turn", model_messages: Object.keys(turn.usage).length } });
      expect(own.slice(0, -1).every((st) => !st.metrics)).toBe(true);
    }
  }
});

test("atif: a call with no result yet keeps its result entry, marked, and a running turn says it is not done", () => {
  const ts = (sec) => `2026-11-01T09:00:${String(sec).padStart(2, "0")}.000Z`;
  const s = newSession("s1", "f");
  for (const e of [
    { k: "p", o: "human", t: "Run the tests", ts: ts(1) },
    { k: "t", t: "Running them.", ts: ts(2) },
    { k: "u", n: "Bash", id: "toolu_1", ts: ts(3), in: "bun test" },
  ]) apply(s, e);
  const t = atif(s, { agent: "claude" });
  expect(problems(t)).toEqual([]);
  const st = t.steps[1];
  expect(st.tool_calls).toEqual([{ tool_call_id: "toolu_1", function_name: "Bash", arguments: {}, extra: { input: "bun test", started: ts(3) } }]);
  expect(st.observation.results).toEqual([{ source_call_id: "toolu_1", extra: { no_result: true } }]);
  expect(st.extra.done).toBe(false);
  // No turn: no trajectory, since ATIF needs a step.
  expect(atif(newSession("s2", "f"))).toBeNull();
});

test("atif: the command line reads a transcript the way the panel does and adds each call's result text from calls.sh", () => {
  const out = execFileSync("bun", [join(core, "atif.js"), codex, "codex"], { encoding: "utf8" });
  const t = JSON.parse(out);
  expect(problems(t)).toEqual([]);
  const results = Object.fromEntries(t.steps.flatMap((st) => st.observation?.results ?? []).map((r) => [r.source_call_id, r]));
  expect(results.call_c2.content).toBe("1 fail: three items at $3.33");
  expect(results.call_c2.extra.failed).toBe(true);
  expect(t.agent.name).toBe("codex");
  expect(t.agent.model_name).toBe("gpt-5.5-codex");
  // A wrong agent name is refused with the usage line.
  let code = 0;
  try { execFileSync("bun", [join(core, "atif.js"), codex, "nope"], { stdio: "pipe" }); } catch (e) { code = e.status; }
  expect(code).toBe(2);
});

test("atif: the check above refuses what Harbor's models refuse: a field ATIF lacks, a step out of order, a result for a call outside its step", () => {
  const t = atif(readFile(codex, "codex"), { agent: "codex" });
  expect(problems(t)).toEqual([]);
  const bad = (change) => { const c = structuredClone(t); change(c); return problems(c); };
  expect(bad((c) => { c.steps[1].tool_calls[0].input = "x"; })).toEqual(["steps[1].tool_calls[0]: tool_call has no field input"]);
  expect(bad((c) => { c.steps[2].step_id = 9; })).toEqual(["steps[2].step_id 9, expected 3"]);
  expect(bad((c) => { c.steps[1].observation.results[0].source_call_id = "call_nope"; })).toEqual(["steps[1] result for call_nope, no such call in the step"]);
  expect(bad((c) => { c.steps[0].tool_calls = []; })).toEqual(["steps[0].tool_calls on a user step"]);
});

// ---- the command line's nested subagents and whole arguments (made-up sessions only) ----

// Claude Code: two of the fixture's three Agent calls get a transcript of their own, in
// <session>/subagents/agent-<id>.jsonl, every line marked isSidechain; the third has none.
function claudeSubagents() {
  const lines = readFileSync(claude, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } });
  const agentIds = lines.flatMap((l) => (typeof l?.toolUseResult?.agentId === "string" ? [l.toolUseResult.agentId] : []));
  const sid = lines.find((l) => l?.sessionId)?.sessionId;
  const subs = join(claude.replace(/\.jsonl$/, ""), "subagents");
  mkdirSync(subs, { recursive: true });
  agentIds.slice(0, 2).forEach((a, k) => {
    let n = 0;
    let clock = Date.parse("2026-11-01T10:00:00Z") + k * 600000;
    const at = (sec) => new Date((clock += sec * 1000)).toISOString();
    const b = () => ({ isSidechain: true, agentId: a, sessionId: sid, userType: "external", cwd: "/Users/dev/acme-web", version: "2.1.0", uuid: `00000000-0000-4000-a${k}00-${String(++n).padStart(12, "0")}` });
    const usage = { input_tokens: 4, output_tokens: 50, cache_read_input_tokens: 9000, cache_creation_input_tokens: 600 };
    const msg = (content, stop) => ({ id: `msg_s${k}${n}`, model: "claude-sonnet-5-5", role: "assistant", type: "message", content, stop_reason: stop, usage });
    const tid = `toolu_s${k}_Grep`;
    const out = [
      { ...b(), type: "user", message: { role: "user", content: k ? "Check time zones in src/calendar." : "Review range math in src/calendar." }, timestamp: at(0) },
      { ...b(), type: "assistant", message: msg([{ type: "tool_use", id: tid, name: "Grep", input: { pattern: k ? "getTimezoneOffset" : "endOfRange", path: "src/calendar" } }], "tool_use"), timestamp: at(3) },
      { ...b(), type: "user", toolUseResult: { stdout: "src/calendar/range.ts:12" }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: tid, content: "src/calendar/range.ts:12" }] }, timestamp: at(2) },
      { ...b(), type: "assistant", message: msg([{ type: "text", text: k ? "Time zones are handled." : "The range math is right." }], "end_turn"), timestamp: at(5) },
    ];
    writeFileSync(join(subs, `agent-${a}.jsonl`), `${out.map((l) => JSON.stringify(l)).join("\n")}\n`);
  });
  return agentIds;
}

// Codex: a parent thread that spawns two agents, one of which has no rollout on disk; the
// child spawns a grandchild. Each child's rollout starts with a copy of its parent's history
// (ordinals below subagent_history_start_ordinal), as Codex writes them.
function codexFamily() {
  const day = join(dir, "sessions", "2026", "11", "02");
  mkdirSync(day, { recursive: true });
  const ids = { root: "00000000-0000-4000-8000-0000000000d1", child: "00000000-0000-4000-8000-0000000000d2", grand: "00000000-0000-4000-8000-0000000000d3" };
  const rollout = (id, meta, body) => {
    let ord = 0;
    let t = Date.parse("2026-11-02T09:00:00Z");
    const line = (type, payload, gap = 1) => JSON.stringify({ timestamp: new Date((t += gap * 1000)).toISOString(), ordinal: ord++, type, payload });
    const api = {
      ask: (turn, text) => line("event_msg", { type: "item_completed", turn_id: turn, item: { type: "UserMessage", content: [{ type: "text", text }] } }),
      say: (text) => line("response_item", { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text }] }, 4),
      call: (name, cid, args) => line("response_item", { type: "function_call", name, call_id: cid, arguments: typeof args === "string" ? args : JSON.stringify(args) }, 2),
      out: (cid, output) => line("response_item", { type: "function_call_output", call_id: cid, output }),
      count: (input, cached, output) => line("event_msg", { type: "token_count", info: { last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output } } }, 0),
      fin: (ms) => line("event_msg", { type: "task_complete", duration_ms: ms }, 0),
      ord: () => ord,
    };
    const lines = [line("session_meta", { id, cwd: "/Users/dev/acme-web", ...meta }, 0), line("turn_context", { model: "gpt-5.5-codex", effort: "medium" }, 0), ...body(api)];
    const f = join(day, `rollout-2026-11-02T09-00-00-${id}.jsonl`);
    writeFileSync(f, `${lines.join("\n")}\n`);
    return f;
  };
  const spawn = (parent, path) => ({ source: { subagent: { thread_spawn: { parent_thread_id: parent, depth: 1, agent_path: path, agent_nickname: "Reviewer" } } } });
  const root = rollout(ids.root, {}, (a) => [
    a.ask("turn-0001", "Review the cart module with two helpers"),
    a.call("spawn_agent", "call_s1", { task_name: "reviewer", message: "Review cart/total.ts" }),
    a.out("call_s1", JSON.stringify({ task_name: "/root/reviewer" })),
    a.call("spawn_agent", "call_s2", { task_name: "gone", message: "Check the docs" }),
    a.out("call_s2", JSON.stringify({ task_name: "/root/gone" })),
    a.call("exec_command", "call_bad", "{not json"),
    a.out("call_bad", JSON.stringify({ output: "bad arguments", metadata: { exit_code: 1 } })),
    a.count(30000, 25000, 400),
    a.say("Both reviews are in: the totals are right."),
    a.fin(30000),
  ]);
  // The child's copy of its parent's history, then its own task from ordinal 3.
  const child = rollout(ids.child, { ...spawn(ids.root, "/root/reviewer"), subagent_history_start_ordinal: 3 }, (a) => [
    a.ask("turn-0001", "Review the cart module with two helpers"),
    a.ask("turn-c001", "Review cart/total.ts"),
    a.call("exec_command", "call_r1", { cmd: "rg -n round cart/total.ts" }),
    a.out("call_r1", JSON.stringify({ output: "cart/total.ts:22: round(tax)", metadata: { exit_code: 0 } })),
    a.call("spawn_agent", "call_g1", { task_name: "tests", message: "Run the cart tests" }),
    a.out("call_g1", JSON.stringify({ task_name: "/root/reviewer/tests" })),
    a.count(12000, 9000, 200),
    a.say("cart/total.ts rounds once; the tests agree."),
    a.fin(12000),
  ]);
  const grand = rollout(ids.grand, { ...spawn(ids.child, "/root/reviewer/tests"), subagent_history_start_ordinal: 2 }, (a) => [
    a.ask("turn-c001", "Review cart/total.ts"),
    a.ask("turn-g001", "Run the cart tests"),
    a.call("exec_command", "call_t1", { cmd: "bun test cart" }),
    a.out("call_t1", JSON.stringify({ output: "8 pass", metadata: { exit_code: 0 } })),
    a.count(5000, 4000, 80),
    a.say("8 pass."),
    a.fin(5000),
  ]);
  return { root, child, grand, ids };
}

test("atif: the command line nests each Claude Code subagent's own transcript under the call that started it, and marks one it cannot find", () => {
  const agentIds = claudeSubagents();
  const t = JSON.parse(execFileSync("bun", [join(core, "atif.js"), claude, "claude"], { encoding: "utf8" }));
  if (process.env.ATIF_KEEP) writeFileSync(join(process.env.ATIF_KEEP, "nest-claude.json"), JSON.stringify(t));
  expect(problems(t)).toEqual([]);
  expect(t.subagent_trajectories.map((x) => x.trajectory_id)).toEqual(agentIds.slice(0, 2));
  for (const sub of t.subagent_trajectories) expect(sub.session_id).toBe(t.session_id);
  // Each Agent call's result points at its subagent, or says its transcript was not found.
  const agentResults = t.steps.flatMap((st) => (st.tool_calls ?? []).filter((c) => c.function_name === "Agent")
    .map((c) => st.observation.results.find((r) => r.source_call_id === c.tool_call_id)));
  expect(agentResults.map((r) => r.subagent_trajectory_ref?.[0]?.trajectory_id ?? r.extra.subagent_transcript)).toEqual([...agentIds.slice(0, 2), "not found"]);
  // A subagent's own steps: its task, its call with whole arguments, its result, its answer.
  const first = t.subagent_trajectories[0];
  expect(first.steps[0]).toMatchObject({ source: "user", message: "Review range math in src/calendar." });
  const grep = first.steps.flatMap((st) => st.tool_calls ?? [])[0];
  expect(grep).toMatchObject({ function_name: "Grep", arguments: { pattern: "endOfRange", path: "src/calendar" } });
  expect(first.steps.flatMap((st) => st.observation?.results ?? [])[0].content).toBe("src/calendar/range.ts:12");
  expect(first.steps.at(-1).message).toBe("The range math is right.");
  // The totals count the subagents' tokens too, as Harbor's do.
  const own = t.steps.reduce((a, st) => a + (st.metrics?.completion_tokens ?? 0), 0);
  expect(t.final_metrics.total_completion_tokens).toBe(own + t.subagent_trajectories.reduce((a, x) => a + x.final_metrics.total_completion_tokens, 0));
  // Every call in the main session has its whole input as arguments.
  const bash = t.steps.flatMap((st) => st.tool_calls ?? []).find((c) => c.function_name === "Bash" && c.extra.input === "git diff --stat");
  expect(bash.arguments).toEqual({ command: "git diff --stat" });
  expect(t.steps.flatMap((st) => st.tool_calls ?? []).filter((c) => c.extra?.arguments_unread)).toEqual([]);
});

test("atif: the command line nests Codex subagents by their rollout's parent thread, two levels deep, without the history copied from the parent", () => {
  const { root, ids } = codexFamily();
  const t = JSON.parse(execFileSync("bun", [join(core, "atif.js"), root, "codex"], { encoding: "utf8" }));
  if (process.env.ATIF_KEEP) writeFileSync(join(process.env.ATIF_KEEP, "nest-codex.json"), JSON.stringify(t));
  expect(problems(t)).toEqual([]);
  const results = Object.fromEntries(t.steps.flatMap((st) => st.observation?.results ?? []).map((r) => [r.source_call_id, r]));
  expect(results.call_s1.subagent_trajectory_ref).toEqual([{ trajectory_id: ids.child, session_id: ids.root }]);
  expect(results.call_s2.extra.subagent_transcript).toBe("not found");
  expect(t.subagent_trajectories.map((x) => x.trajectory_id)).toEqual([ids.child]);
  const child = t.subagent_trajectories[0];
  // The copied parent prompt is gone: the child starts at its own task.
  expect(child.steps.filter((st) => st.source === "user").map((st) => st.message)).toEqual(["Review cart/total.ts"]);
  expect(child.steps.flatMap((st) => st.tool_calls ?? [])[0].arguments).toEqual({ cmd: "rg -n round cart/total.ts" });
  expect(child.subagent_trajectories.map((x) => [x.trajectory_id, x.session_id])).toEqual([[ids.grand, ids.root]]);
  expect(child.subagent_trajectories[0].steps.at(-1).message).toBe("8 pass.");
  // Totals: the parent's own, its child's and its grandchild's.
  expect(t.final_metrics.total_completion_tokens).toBe(400 + 200 + 80);
  // An input that is not JSON keeps {} and says so.
  const bad = t.steps.flatMap((st) => st.tool_calls ?? []).find((c) => c.tool_call_id === "call_bad");
  expect(bad.arguments).toEqual({});
  expect(bad.extra.arguments_unread).toBe("not JSON");
});
