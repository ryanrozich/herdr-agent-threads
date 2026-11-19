// bun test: each agent's synthetic session written as ATIF-v1.7 (core/atif.js), checked
// against Harbor's rules for the schema (src/harbor/models/trajectories: the fields each
// object allows, the required ones, step ids from 1, agent-only fields, results joined to a
// call of their own step) and against golden files in test/fixtures/atif.
// UPDATE=1 bun test test/atif.test.js writes the golden files again.
import { test, expect } from "bun:test";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
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

// A subagent's id is transcript text: one that names a file outside the session's subagents
// folder is not read, by its spelling or through a link.
test("atif: a subagent id with folder steps, odd characters, or a file linked from elsewhere is not found, and nothing outside is read", () => {
  const d = mkdtempSync(join(tmpdir(), "threads-atif-id-"));
  const f = join(d, "s", "00000000-0000-4000-8000-000000000047.jsonl");
  mkdirSync(join(d, "s"));
  execFileSync("bun", [join(root, "test/make-fixture.js"), f, "00000000-0000-4000-8000-000000000047", "/Users/dev/acme-web", "--subagents"]);
  const lines = readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const launches = lines.filter((l) => typeof l?.toolUseResult?.agentId === "string");
  // A transcript outside the session's folder, whose text must never reach the export.
  const secret = (id) => `${JSON.stringify({ isSidechain: true, agentId: id, sessionId: "x", type: "user", uuid: "00000000-0000-4000-b000-000000000001", timestamp: "2026-11-01T10:00:00Z", message: { role: "user", content: "OUTSIDE-THE-SESSION" } })}\n`;
  writeFileSync(join(d, "secret.jsonl"), secret("secret"));
  const subs = join(f.replace(/\.jsonl$/, ""), "subagents");
  mkdirSync(subs, { recursive: true });
  // 1: parent-folder steps that land on secret.jsonl; 2: a link inside the folder to it;
  // 3: characters an id never has.
  const ids = ["x/../../../../secret", "linked0000000001", "a b;c"];
  writeFileSync(join(d, "secret2.jsonl"), secret(ids[1]));
  symlinkSync(join(d, "secret2.jsonl"), join(subs, `agent-${ids[1]}.jsonl`));
  launches.forEach((l, k) => { l.toolUseResult.agentId = ids[k]; });
  writeFileSync(f, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  expect(existsSync(join(subs, `agent-${ids[0]}.jsonl`))).toBe(true);
  const out = execFileSync("bun", [join(core, "atif.js"), f, "claude"], { encoding: "utf8" });
  expect(out).not.toContain("OUTSIDE-THE-SESSION");
  const t = JSON.parse(out);
  expect(problems(t)).toEqual([]);
  expect(t.subagent_trajectories).toBeUndefined();
  const agentResults = t.steps.flatMap((st) => (st.tool_calls ?? []).filter((c) => c.function_name === "Agent")
    .map((c) => st.observation.results.find((r) => r.source_call_id === c.tool_call_id)));
  expect(agentResults.map((r) => r.extra.subagent_transcript)).toEqual(["not found", "not found", "not found"]);
});

test("atif: a subagents folder that is itself a link is not read", () => {
  const d = mkdtempSync(join(tmpdir(), "threads-atif-link-"));
  const f = join(d, "00000000-0000-4000-8000-000000000050.jsonl");
  execFileSync("bun", [join(root, "test/make-fixture.js"), f, "00000000-0000-4000-8000-000000000050", "/Users/dev/acme-web", "--subagents"]);
  const lines = readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const a = lines.find((l) => typeof l?.toolUseResult?.agentId === "string").toolUseResult.agentId;
  // The real folder is elsewhere; the session's subagents folder only links to it.
  const elsewhere = join(d, "elsewhere");
  mkdirSync(elsewhere);
  writeFileSync(join(elsewhere, `agent-${a}.jsonl`), `${JSON.stringify({ isSidechain: true, agentId: a, sessionId: "x", type: "user", uuid: "00000000-0000-4000-b000-000000000002", timestamp: "2026-11-01T10:00:00Z", message: { role: "user", content: "LINKED-FOLDER" } })}\n`);
  mkdirSync(f.replace(/\.jsonl$/, ""));
  symlinkSync(elsewhere, join(f.replace(/\.jsonl$/, ""), "subagents"));
  const out = execFileSync("bun", [join(core, "atif.js"), f, "claude"], { encoding: "utf8" });
  expect(out).not.toContain("LINKED-FOLDER");
  expect(JSON.parse(out).subagent_trajectories).toBeUndefined();
});

// ---- found on real sessions by an eval reader, reproduced here on made-up ones ----

// A Claude Code session whose fixture is fresh, in a folder of its own.
function freshClaude(name) {
  const d = mkdtempSync(join(tmpdir(), "threads-atif-fix-"));
  const f = join(d, `${name}.jsonl`);
  execFileSync("bun", [join(root, "test/make-fixture.js"), f, name, "/Users/dev/acme-web", "--subagents"]);
  const lines = readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { d, f, lines, save: (ls) => writeFileSync(f, `${ls.map((l) => JSON.stringify(l)).join("\n")}\n`) };
}
const sideUsage = { input_tokens: 4, output_tokens: 50, cache_read_input_tokens: 9000, cache_creation_input_tokens: 600 };
// One subagent's transcript: every line isSidechain, as Claude Code writes them.
function sidechain(agent, sid, k, rows) {
  let n = 0;
  let clock = Date.parse("2026-11-01T10:00:00Z") + k * 600000;
  const b = (sec) => ({ isSidechain: true, agentId: agent, sessionId: sid, userType: "external", cwd: "/Users/dev/acme-web", version: "2.1.0", uuid: `00000000-0000-4000-a${k}00-${String(++n).padStart(12, "0")}`, timestamp: new Date((clock += sec * 1000)).toISOString() });
  const said = (content, stop) => ({ ...b(3), type: "assistant", message: { id: `msg_${agent}_${n}`, model: "claude-sonnet-5-5", role: "assistant", type: "message", content, stop_reason: stop, usage: sideUsage } });
  return `${rows(b, said).map((l) => JSON.stringify(l)).join("\n")}\n`;
}

test("atif: a subagent's own subagent is found in the session's one subagents folder, where Claude Code writes every one", () => {
  const { f, lines } = freshClaude("00000000-0000-4000-8000-000000000044");
  const A = lines.find((l) => typeof l?.toolUseResult?.agentId === "string").toolUseResult.agentId;
  const sid = lines.find((l) => l.sessionId).sessionId;
  const subs = join(f.replace(/\.jsonl$/, ""), "subagents");
  mkdirSync(subs, { recursive: true });
  const B = "b00000000000000nest";
  writeFileSync(join(subs, `agent-${A}.jsonl`), sidechain(A, sid, 1, (b, said) => [
    { ...b(0), type: "user", message: { role: "user", content: "Review range math in src/calendar." } },
    said([{ type: "tool_use", id: "toolu_A_Agent", name: "Agent", input: { description: "Check DST", prompt: "Check DST edges." } }], "tool_use"),
    // In a subagent's own file the result of the subagent it started has no toolUseResult:
    // the id is only a line of the result's text.
    { ...b(9), type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_A_Agent", content: [{ type: "text", text: "DST is fine." }, { type: "text", text: `agentId: ${B} (use it to continue this agent)\n<usage>total_tokens: 9654</usage>` }] }] } },
    said([{ type: "text", text: "The range math is right, and DST is fine." }], "end_turn"),
  ]));
  // B sits beside A, not in a folder of A's own.
  writeFileSync(join(subs, `agent-${B}.jsonl`), sidechain(B, sid, 2, (b, said) => [
    { ...b(0), type: "user", message: { role: "user", content: "Check DST edges." } },
    said([{ type: "tool_use", id: "toolu_B_Read", name: "Read", input: { file_path: "src/calendar/dst.ts" } }], "tool_use"),
    { ...b(2), type: "user", toolUseResult: { stdout: "export const DST = true;" }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_B_Read", content: "export const DST = true;" }] } },
    said([{ type: "text", text: "DST is fine." }], "end_turn"),
  ]));
  const t = JSON.parse(execFileSync("bun", [join(core, "atif.js"), f, "claude"], { encoding: "utf8" }));
  expect(problems(t)).toEqual([]);
  const a = t.subagent_trajectories.find((x) => x.trajectory_id === A);
  expect(a.subagent_trajectories.map((x) => x.trajectory_id)).toEqual([B]);
  const res = a.steps.flatMap((st) => st.observation?.results ?? []).find((r) => r.source_call_id === "toolu_A_Agent");
  expect(res.subagent_trajectory_ref[0].trajectory_id).toBe(B);
  expect(res.extra?.subagent_transcript).toBeUndefined();
  expect(a.subagent_trajectories[0].steps.flatMap((st) => st.tool_calls ?? []).map((c) => c.function_name)).toEqual(["Read"]);
});

test("atif: the work after a background notice wakes the agent is kept, call by call, and the panel's reader still only counts it", () => {
  const { f, lines, save } = freshClaude("00000000-0000-4000-8000-000000000045");
  const ref = lines.find((l) => l.type === "assistant" && JSON.stringify(l.message?.content ?? "").includes("All three reviews are back"));
  const note = lines.find((l) => l.type === "user" && l.origin?.kind === "task-notification");
  const last = lines.findLast((l) => typeof l.timestamp === "string").timestamp;
  let clock = Date.parse(last) + 60000;
  const at = (sec) => new Date((clock += sec * 1000)).toISOString();
  const usage = { input_tokens: 4, output_tokens: 30, cache_read_input_tokens: 9000, cache_creation_input_tokens: 100 };
  const said = (k, content, stop) => ({ ...ref, uuid: `00000000-0000-4000-f000-0000000000${k}`, timestamp: at(3), message: { ...ref.message, id: `msg_wake${k}`, content, stop_reason: stop, usage } });
  const result = (k, id, text, err) => ({ ...ref, type: "user", uuid: `00000000-0000-4000-f000-0000000001${k}`, timestamp: at(2), toolUseResult: { stdout: text }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text, ...(err ? { is_error: true } : {}) }] } });
  // The turn has ended; a late notice wakes the agent, which says something, runs two
  // commands (the second fails) and answers.
  save([...lines,
    { ...note, uuid: "00000000-0000-4000-f000-000000000000", timestamp: at(0) },
    said(10, [{ type: "text", text: "A late report came in; checking the tests." }, { type: "tool_use", id: "toolu_wake1", name: "Bash", input: { command: "bun test test/range.test.ts" } }], "tool_use"),
    result(10, "toolu_wake1", "2 fail"),
    said(11, [{ type: "tool_use", id: "toolu_wake2", name: "Bash", input: { command: "bun run build" } }], "tool_use"),
    result(11, "toolu_wake2", "exit 1", true),
    said(12, [{ type: "text", text: "Fixed the clock in two tests; the build still exits 1." }], "end_turn"),
  ]);
  const t = JSON.parse(execFileSync("bun", [join(core, "atif.js"), f, "claude"], { encoding: "utf8" }));
  expect(problems(t)).toEqual([]);
  const wake = t.steps.filter((st) => st.extra?.kind === "background_update");
  // Both wake-ups, each with its own steps: the fixture's earlier one (its text only), then
  // this one's text with its two calls (no text between them, so one step, as in the prompt's
  // own work), then its answer.
  expect(wake.map((st) => [st.message, (st.tool_calls ?? []).map((c) => c.tool_call_id)])).toEqual([
    ["The background build finished cleanly.", []],
    ["A late report came in; checking the tests.", ["toolu_wake1", "toolu_wake2"]],
    ["Fixed the clock in two tests; the build still exits 1.", []],
  ]);
  const results = wake.flatMap((st) => st.observation?.results ?? []);
  expect(results.map((r) => [r.source_call_id, r.content, r.extra?.failed ?? false])).toEqual([["toolu_wake1", "2 fail", false], ["toolu_wake2", "exit 1", true]]);
  expect(wake[1].tool_calls[1].arguments).toEqual({ command: "bun run build" });
  expect(wake[1].timestamp).toBeDefined();
  // The panel's reader is unchanged: the wake-up's calls are counted, not kept as steps.
  const s = readFile(f, "claude");
  const turn = s.turns.at(-1);
  expect(turn.wakeTools).toBe(2);
  expect(turn.steps.flatMap((st) => st.ids ?? []).filter((id) => /^toolu_wake/.test(id ?? ""))).toEqual([]);
});

test("atif: a result is whole in the export; the panel's calls.sh still cuts it at 24 KB", () => {
  const { f, lines, save } = freshClaude("00000000-0000-4000-8000-000000000046");
  const at = lines.findIndex((l) => l.type === "user" && Array.isArray(l.message?.content) && l.message.content[0]?.type === "tool_result" && typeof l.message.content[0].content === "string");
  const id = lines[at].message.content[0].tool_use_id;
  const long = `${"x".repeat(29990)}\nexit 1`;
  lines[at] = { ...lines[at], toolUseResult: { stdout: long }, message: { ...lines[at].message, content: [{ ...lines[at].message.content[0], content: long }] } };
  save(lines);
  const out = (env) => execFileSync("sh", [join(core, "calls.sh"), f, "claude", id], { encoding: "utf8", env: { ...process.env, ...env } })
    .split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((x) => x.k === "out").out;
  expect(out({}).length).toBe(24576);
  expect(out({ THREADS_WHOLE: "1" })).toBe(long);
  const t = JSON.parse(execFileSync("bun", [join(core, "atif.js"), f, "claude"], { encoding: "utf8" }));
  const r = t.steps.flatMap((st) => st.observation?.results ?? []).find((x) => x.source_call_id === id);
  expect(r.content).toBe(long);
});

test("atif: past 4,194,304 characters a result is cut for the export too, with a marker that gives its whole length", () => {
  const { f, lines, save } = freshClaude("00000000-0000-4000-8000-000000000048");
  const at = lines.findIndex((l) => l.type === "user" && Array.isArray(l.message?.content) && l.message.content[0]?.type === "tool_result" && typeof l.message.content[0].content === "string");
  const id = lines[at].message.content[0].tool_use_id;
  const huge = "h".repeat(4194404);
  lines[at] = { ...lines[at], toolUseResult: { stdout: "" }, message: { ...lines[at].message, content: [{ ...lines[at].message.content[0], content: huge }] } };
  save(lines);
  const out = execFileSync("sh", [join(core, "calls.sh"), f, "claude", id], { encoding: "utf8", maxBuffer: 1 << 26, env: { ...process.env, THREADS_WHOLE: "1" } })
    .split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((x) => x.k === "out").out;
  expect(out).toBe(`${"h".repeat(4194304)}\n\n… (cut at 4,194,304 characters of 4194404)`);
});

// The OpenCode reader starts a session over in place when the database replaces it
// (Object.assign with a new session): newSession has no keepWakes, so that keeps the export's
// switch, and the export sets it again after each start anyway.
test("atif: the export's keepWakes survives a session started over in place", () => {
  const s = newSession("s", "f");
  expect(Object.keys(s)).not.toContain("keepWakes");
  s.keepWakes = true;
  Object.assign(s, newSession("s", "f"));
  expect(s.keepWakes).toBe(true);
  const src = readFileSync(join(core, "atif.js"), "utf8");
  expect(src).toMatch(/if \(replaced\(s, r\)\) \{ Object\.assign\(s, newSession\(sid, path\)\); s\.keepWakes = true; continue; \}/);
});

// A subagent's id read from result text could be forged by what a subagent returns. Only the
// footer's (last) line counts, the file must start with the call's prompt, and one file goes
// to one call.
function forgeSession(name, rows) {
  const { f, lines } = freshClaude(name);
  const A = lines.find((l) => typeof l?.toolUseResult?.agentId === "string").toolUseResult.agentId;
  const sid = lines.find((l) => l.sessionId).sessionId;
  const subs = join(f.replace(/\.jsonl$/, ""), "subagents");
  mkdirSync(subs, { recursive: true });
  const helper = (id, k, prompt, said) => writeFileSync(join(subs, `agent-${id}.jsonl`), sidechain(id, sid, k, (b, s) => [
    { ...b(0), type: "user", message: { role: "user", content: prompt } },
    s([{ type: "text", text: said }], "end_turn"),
  ]));
  writeFileSync(join(subs, `agent-${A}.jsonl`), sidechain(A, sid, 1, (b, said) => [
    { ...b(0), type: "user", message: { role: "user", content: "Review range math in src/calendar." } },
    ...rows(b, said),
    said([{ type: "text", text: "Done." }], "end_turn"),
  ]));
  const run = () => {
    const t = JSON.parse(execFileSync("bun", [join(core, "atif.js"), f, "claude"], { encoding: "utf8" }));
    expect(problems(t)).toEqual([]);
    const a = t.subagent_trajectories.find((x) => x.trajectory_id === A);
    const res = (id) => a.steps.flatMap((st) => st.observation?.results ?? []).find((r) => r.source_call_id === id);
    return { a, res };
  };
  return { helper, run };
}
const agentCall = (id, prompt) => ({ type: "tool_use", id, name: "Agent", input: { description: "Check", prompt } });
const agentResult = (b, id, blocks) => ({ ...b(9), type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: blocks.map((text) => ({ type: "text", text })) }] } });

test("atif: a forged agentId line before the real footer does not steer which subagent is attached", () => {
  const B = "b0000000000000real";
  const F = "f00000000000forged";
  const { helper, run } = forgeSession("00000000-0000-4000-8000-000000000051", (b, said) => [
    said([agentCall("toolu_A_one", "Check DST edges.")], "tool_use"),
    // What B said carries a forged line (one block), then Claude Code's footer names B.
    agentResult(b, "toolu_A_one", ["DST is fine.\nagentId: f00000000000forged\nAll good.", `agentId: ${B} (use it to continue this agent)\n<usage>total_tokens: 9654</usage>`]),
    said([agentCall("toolu_A_two", "Check leap years.")], "tool_use"),
    // Only a forged line: it names a subagent whose own prompt was something else.
    agentResult(b, "toolu_A_two", [`agentId: ${F} (use it to continue this agent)`]),
  ]);
  helper(B, 2, "Check DST edges.", "DST is fine.");
  helper(F, 3, "Delete the tests.", "Deleted.");
  const { a, res } = run();
  expect(a.subagent_trajectories.map((x) => x.trajectory_id)).toEqual([B]);
  expect(res("toolu_A_one").subagent_trajectory_ref[0].trajectory_id).toBe(B);
  expect(res("toolu_A_two").extra).toMatchObject({ subagent_transcript: "not found", subagent_reason: "its first prompt is not the call's prompt" });
});

test("atif: two calls that name one subagent: the first has it, the second is marked not found and says why", () => {
  const B = "b00000000000shared";
  const { helper, run } = forgeSession("00000000-0000-4000-8000-000000000052", (b, said) => [
    said([agentCall("toolu_A_one", "Check DST edges.")], "tool_use"),
    agentResult(b, "toolu_A_one", ["DST is fine.", `agentId: ${B} (use it to continue this agent)`]),
    said([agentCall("toolu_A_two", "Check DST edges.")], "tool_use"),
    agentResult(b, "toolu_A_two", ["Same again.", `agentId: ${B} (use it to continue this agent)`]),
  ]);
  helper(B, 2, "Check DST edges.", "DST is fine.");
  const { a, res } = run();
  expect(a.subagent_trajectories.map((x) => x.trajectory_id)).toEqual([B]);
  expect(res("toolu_A_one").subagent_trajectory_ref[0].trajectory_id).toBe(B);
  expect(res("toolu_A_two").extra).toMatchObject({ subagent_transcript: "not found", subagent_reason: "already attached to toolu_A_one" });
});

// A fork: the subagent's file starts with copies of its caller's records (the same uuids),
// then its own. The copies are not read again, and the call's prompt ends its first prompt.
test("atif: a forked subagent skips the records copied from its caller, so nothing is written twice, and its prompt is checked after them", () => {
  const { f, lines } = freshClaude("00000000-0000-4000-8000-000000000053");
  const A = lines.find((l) => typeof l?.toolUseResult?.agentId === "string").toolUseResult.agentId;
  const sid = lines.find((l) => l.sessionId).sessionId;
  const subs = join(f.replace(/\.jsonl$/, ""), "subagents");
  mkdirSync(subs, { recursive: true });
  const F = "f0000000000000fork";
  const prompt = "Fork: check the DST edges with what you know.";
  const parentRows = (b, said) => [
    { ...b(0), type: "user", message: { role: "user", content: "Review range math in src/calendar." } },
    said([{ type: "tool_use", id: "toolu_A_Grep", name: "Grep", input: { pattern: "endOfRange" } }], "tool_use"),
    { ...b(2), type: "user", toolUseResult: { stdout: "src/calendar/range.ts:12" }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_A_Grep", content: "src/calendar/range.ts:12" }] } },
    said([{ type: "tool_use", id: "toolu_A_Fork", name: "Agent", input: { description: "Fork", prompt, subagent_type: "fork", name: "dst" } }], "tool_use"),
  ];
  const aText = sidechain(A, sid, 1, (b, said) => [
    ...parentRows(b, said),
    { ...b(9), type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_A_Fork", content: [{ type: "text", text: "DST is fine." }, { type: "text", text: `agentId: ${F} (use it to continue this agent)` }] }] } },
    said([{ type: "text", text: "Done." }], "end_turn"),
  ]);
  writeFileSync(join(subs, `agent-${A}.jsonl`), aText);
  // The fork's file: A's first four records as they are, then its own.
  const copied = aText.split("\n").slice(0, 4).join("\n");
  const own = sidechain(F, sid, 2, (b, said) => [
    said([{ type: "text", text: "Forking." }], "end_turn"),
    { ...b(1), type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_A_Fork", content: "forked" }, { type: "text", text: `You are a fork of the conversation above.\n\n${prompt}` }] } },
    said([{ type: "tool_use", id: "toolu_F_Read", name: "Read", input: { file_path: "src/calendar/dst.ts" } }], "tool_use"),
    { ...b(2), type: "user", toolUseResult: { stdout: "export const DST = true;" }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_F_Read", content: "export const DST = true;" }] } },
    said([{ type: "text", text: "DST is fine." }], "end_turn"),
  ]);
  writeFileSync(join(subs, `agent-${F}.jsonl`), `${copied}\n${own}`);
  const t = JSON.parse(execFileSync("bun", [join(core, "atif.js"), f, "claude"], { encoding: "utf8" }));
  expect(problems(t)).toEqual([]);
  const a = t.subagent_trajectories.find((x) => x.trajectory_id === A);
  const res = a.steps.flatMap((st) => st.observation?.results ?? []).find((r) => r.source_call_id === "toolu_A_Fork");
  expect(res.subagent_trajectory_ref[0].trajectory_id).toBe(F);
  const fork = a.subagent_trajectories.find((x) => x.trajectory_id === F);
  // Only the fork's own call: the copied Grep and the copied Agent call are A's alone.
  expect(fork.steps.flatMap((st) => st.tool_calls ?? []).map((c) => c.tool_call_id)).toEqual(["toolu_F_Read"]);
  expect(JSON.stringify(fork)).not.toContain("toolu_A_Grep");
});

// A Skill call that forks a subagent: its launch record (status "forked") names it.
function skillSession(name, args, laterMeta = false) {
  const { f, lines, save } = freshClaude(name);
  const sid = lines.find((l) => l.sessionId).sessionId;
  const at = lines.findIndex((l) => l.type === "assistant" && JSON.stringify(l.message?.content ?? "").includes("All three reviews are back"));
  const ref = lines[at];
  const S = "s000000000000skill";
  const usage = { input_tokens: 4, output_tokens: 30, cache_read_input_tokens: 9000, cache_creation_input_tokens: 100 };
  lines.splice(at, 0,
    { ...ref, uuid: "00000000-0000-4000-e000-000000000001", message: { ...ref.message, id: "msg_skill", content: [{ type: "tool_use", id: "toolu_Skill", name: "Skill", input: { skill: "review-tests", ...(args ? { args } : {}) } }], stop_reason: "tool_use", usage } },
    { ...ref, type: "user", uuid: "00000000-0000-4000-e000-000000000002", toolUseResult: { agentId: S, commandName: "review-tests", result: "Reviewed.", status: "forked", success: true }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_Skill", content: "Reviewed." }] } });
  save(lines);
  const subs = join(f.replace(/\.jsonl$/, ""), "subagents");
  mkdirSync(subs, { recursive: true });
  writeFileSync(join(subs, `agent-${S}.jsonl`), sidechain(S, sid, 3, (b, said) => [
    // As Claude Code writes it: the one prompt is the first record, marked meta.
    { ...b(0), type: "user", isMeta: true, message: { role: "user", content: `Base directory for this skill: review-tests\n\nReview the tests.${args ? `\n\nARGUMENTS: ${args}` : ""}` } },
    // A later meta record with no parent is bookkeeping, not a second prompt.
    ...(laterMeta ? [{ ...b(1), type: "user", isMeta: true, message: { role: "user", content: "LATER META NOTE" } }] : []),
    said([{ type: "tool_use", id: "toolu_S_Grep", name: "Grep", input: { pattern: "Date.now" } }], "tool_use"),
    { ...b(2), type: "user", toolUseResult: { stdout: "test/range.test.ts:4" }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_S_Grep", content: "test/range.test.ts:4" }] } },
    said([{ type: "text", text: "Two tests need a fixed clock." }], "end_turn"),
  ]));
  const t = JSON.parse(execFileSync("bun", [join(core, "atif.js"), f, "claude"], { encoding: "utf8" }));
  expect(problems(t)).toEqual([]);
  const res = t.steps.flatMap((st) => st.observation?.results ?? []).find((r) => r.source_call_id === "toolu_Skill");
  return { t, res, S };
}

test("atif: a Skill call's forked subagent is attached by its launch record; its args are looked for in the subagent's first prompt", () => {
  const { t, res, S } = skillSession("00000000-0000-4000-8000-000000000054", "src/calendar and test/range");
  expect(res.subagent_trajectory_ref[0].trajectory_id).toBe(S);
  expect(res.extra.subagent_link).toBeUndefined();
  const sub = t.subagent_trajectories.find((x) => x.trajectory_id === S);
  expect(sub.steps.flatMap((st) => st.tool_calls ?? []).map((c) => c.function_name)).toEqual(["Grep"]);
});

test("atif: a Skill call with no args to look for is still attached, and extra says the link rests on the id alone", () => {
  const { res, S } = skillSession("00000000-0000-4000-8000-000000000055", null);
  expect(res.subagent_trajectory_ref[0].trajectory_id).toBe(S);
  expect(res.extra.subagent_link).toBe("id only: the Skill call has no args to look for in the subagent's first prompt");
  // Short args could be in any prompt: attached, and marked.
  const short = skillSession("00000000-0000-4000-8000-000000000057", "src");
  expect(short.res.subagent_trajectory_ref[0].trajectory_id).toBe(short.S);
  expect(short.res.extra.subagent_link).toBe("id only: the Skill call's args are under 16 characters, too short to tell one subagent from another");
});

// A helper named in a subagent's own file, as the nested test's shape: the call's prompt and
// the helper's first user line are set per test.
function nestedWith(name, callPrompt, firstUser, extraType) {
  const { f, lines } = freshClaude(name);
  const A = lines.find((l) => typeof l?.toolUseResult?.agentId === "string").toolUseResult.agentId;
  const sid = lines.find((l) => l.sessionId).sessionId;
  const subs = join(f.replace(/\.jsonl$/, ""), "subagents");
  mkdirSync(subs, { recursive: true });
  const B = "b0000000000000check";
  writeFileSync(join(subs, `agent-${A}.jsonl`), sidechain(A, sid, 1, (b, said) => [
    { ...b(0), type: "user", message: { role: "user", content: "Review range math in src/calendar." } },
    said([{ type: "tool_use", id: "toolu_A_Agent", name: "Agent", input: { description: "Check", prompt: callPrompt, ...(extraType ? { subagent_type: extraType } : {}) } }], "tool_use"),
    { ...b(9), type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_A_Agent", content: [{ type: "text", text: "Done." }, { type: "text", text: `agentId: ${B} (use it to continue this agent)` }] }] } },
    said([{ type: "text", text: "Done." }], "end_turn"),
  ]));
  writeFileSync(join(subs, `agent-${B}.jsonl`), sidechain(B, sid, 2, (b, said) => [
    { ...b(0), type: "user", message: { role: "user", content: firstUser } },
    said([{ type: "tool_use", id: "toolu_B_Read", name: "Read", input: { file_path: "src/calendar/dst.ts" } }], "tool_use"),
    { ...b(2), type: "user", toolUseResult: { stdout: "ok" }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_B_Read", content: "ok" }] } },
    said([{ type: "text", text: "Done." }], "end_turn"),
  ]));
  const t = JSON.parse(execFileSync("bun", [join(core, "atif.js"), f, "claude"], { encoding: "utf8", maxBuffer: 1 << 26 }));
  const a = t.subagent_trajectories.find((x) => x.trajectory_id === A);
  return { res: a.steps.flatMap((st) => st.observation?.results ?? []).find((r) => r.source_call_id === "toolu_A_Agent"), B };
}

test("atif: a fork call with an empty prompt attaches nothing, since every prompt ends with an empty one", () => {
  const { res } = nestedWith("00000000-0000-4000-8000-000000000058", "", "Anything at all.", "fork");
  expect(res.subagent_trajectory_ref).toBeUndefined();
  expect(res.extra.subagent_reason).toBe("the call's prompt is empty");
});

test("atif: a helper whose first prompt cannot be read (an image alone) is attached on the id alone, and marked so", () => {
  const { res, B } = nestedWith("00000000-0000-4000-8000-000000000059", "Look at this.", [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }]);
  expect(res.subagent_trajectory_ref[0].trajectory_id).toBe(B);
  expect(res.extra.subagent_link).toBe("id only: the subagent's first prompt could not be read");
});

test("atif: a first prompt on a line longer than 256 KB is read whole and checked", () => {
  const long = `Check these: ${"x".repeat(300000)}`;
  const ok = nestedWith("00000000-0000-4000-8000-000000000060", long, long);
  expect(ok.res.subagent_trajectory_ref[0].trajectory_id).toBe(ok.B);
  expect(ok.res.extra.subagent_link).toBeUndefined();
  const other = nestedWith("00000000-0000-4000-8000-000000000061", long, `${long}y`);
  expect(other.res.subagent_trajectory_ref).toBeUndefined();
  expect(other.res.extra.subagent_reason).toBe("its first prompt is not the call's prompt");
});

test("atif: transcripts no call names are capped, and the notes count the ones left out", () => {
  const { f, lines } = freshClaude("00000000-0000-4000-8000-000000000062");
  const sid = lines.find((l) => l.sessionId).sessionId;
  const subs = join(f.replace(/\.jsonl$/, ""), "subagents");
  mkdirSync(subs, { recursive: true });
  for (const k of [1, 2, 3]) {
    const U = `u00000000000capped${k}`;
    writeFileSync(join(subs, `agent-${U}.jsonl`), sidechain(U, sid, 5 + k, (b, said) => [
      { ...b(0), type: "user", message: { role: "user", content: `Watch build ${k}.` } },
      said([{ type: "text", text: "Fine." }], "end_turn"),
    ]));
  }
  const t = JSON.parse(execFileSync("bun", [join(core, "atif.js"), f, "claude"], { encoding: "utf8", env: { ...process.env, THREADS_UNNAMED_MAX: "2" } }));
  expect(t.extra.subagents_no_call_names.map((x) => x.trajectory.trajectory_id)).toEqual(["u00000000000capped1", "u00000000000capped2"]);
  expect(t.notes).toContain("1 more that no call names is left out: at most 2 are written.");
});

test("atif: a subagent transcript no call names is written apart, attached to no call, with its shared promptId as a hint and a count in the notes", () => {
  const { f, lines } = freshClaude("00000000-0000-4000-8000-000000000056");
  const sid = lines.find((l) => l.sessionId).sessionId;
  const pid = lines.find((l) => typeof l.promptId === "string").promptId;
  const before = JSON.parse(execFileSync("bun", [join(core, "atif.js"), f, "claude"], { encoding: "utf8" }));
  const subs = join(f.replace(/\.jsonl$/, ""), "subagents");
  mkdirSync(subs, { recursive: true });
  const U = "u0000000000unnamed";
  writeFileSync(join(subs, `agent-${U}.jsonl`), sidechain(U, sid, 4, (b, said) => [
    { ...b(0), type: "user", promptId: pid, message: { role: "user", content: "Watch the build." } },
    said([{ type: "tool_use", id: "toolu_U_Bash", name: "Bash", input: { command: "bun run build" } }], "tool_use"),
    { ...b(2), type: "user", toolUseResult: { stdout: "ok" }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_U_Bash", content: "ok" }] } },
    said([{ type: "text", text: "The build is fine." }], "end_turn"),
  ]));
  // A link in the folder to a file elsewhere is never read, named or not.
  const d = dirname(f);
  writeFileSync(join(d, "elsewhere.jsonl"), sidechain("elsewhere00000001", sid, 5, (b) => [{ ...b(0), type: "user", message: { role: "user", content: "ELSEWHERE" } }]));
  symlinkSync(join(d, "elsewhere.jsonl"), join(subs, "agent-elsewhere00000001.jsonl"));
  const out = execFileSync("bun", [join(core, "atif.js"), f, "claude"], { encoding: "utf8" });
  expect(out).not.toContain("ELSEWHERE");
  const t = JSON.parse(out);
  expect(problems(t)).toEqual([]);
  const un = t.extra.subagents_no_call_names;
  expect(un.map((x) => [x.trajectory.trajectory_id, x.hint])).toEqual([[U, { note: "hints, not links: no call in the session names this transcript; shared_prompt_id is a promptId it shares with the session, and same_prompt_calls are calls with no launch record whose prompt is its first prompt", shared_prompt_id: pid, same_prompt_calls: [] }]]);
  expect(un[0].trajectory.steps.flatMap((st) => st.tool_calls ?? []).map((c) => c.tool_call_id)).toEqual(["toolu_U_Bash"]);
  expect(t.notes).toContain("1 subagent transcript in the session's subagents folder that no call names is in extra.subagents_no_call_names");
  // Attached to no call and not in the totals or the standard field.
  expect(t.subagent_trajectories ?? []).toEqual(before.subagent_trajectories ?? []);
  expect(t.final_metrics).toEqual(before.final_metrics);
  expect(JSON.stringify(t.steps)).not.toContain(U);
});

test("atif: with a Skill-started subagent, only its file's first record is read as its prompt", () => {
  const { t, S } = skillSession("00000000-0000-4000-8000-000000000063", "src/calendar and test/range", true);
  const sub = t.subagent_trajectories.find((x) => x.trajectory_id === S);
  expect(JSON.stringify(sub)).not.toContain("LATER META NOTE");
  expect(sub.steps.filter((st) => st.source === "user").length).toBe(1);
});

test("atif: a transcript no call names lists, as a hint, the calls with no launch record that have its first prompt", () => {
  const { f, lines, save } = freshClaude("00000000-0000-4000-8000-000000000064");
  const sid = lines.find((l) => l.sessionId).sessionId;
  const at = lines.findIndex((l) => l.type === "assistant" && JSON.stringify(l.message?.content ?? "").includes("All three reviews are back"));
  const ref = lines[at];
  const prompt = "Watch the build and report.";
  // An Agent call whose result is an error, with no launch record: Claude Code wrote a string.
  lines.splice(at, 0,
    { ...ref, uuid: "00000000-0000-4000-e100-000000000001", message: { ...ref.message, id: "msg_err", content: [{ type: "tool_use", id: "toolu_Err", name: "Agent", input: { description: "Watch", prompt } }], stop_reason: "tool_use" } },
    { ...ref, type: "user", uuid: "00000000-0000-4000-e100-000000000002", toolUseResult: "Error: the agent stopped", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_Err", is_error: true, content: "Error: the agent stopped" }] } });
  save(lines);
  const subs = join(f.replace(/\.jsonl$/, ""), "subagents");
  mkdirSync(subs, { recursive: true });
  const U = "u000000000erroredx";
  writeFileSync(join(subs, `agent-${U}.jsonl`), sidechain(U, sid, 6, (b, said) => [
    { ...b(0), type: "user", message: { role: "user", content: prompt } },
    said([{ type: "text", text: "The build is fine." }], "end_turn"),
  ]));
  const t = JSON.parse(execFileSync("bun", [join(core, "atif.js"), f, "claude"], { encoding: "utf8" }));
  expect(problems(t)).toEqual([]);
  const un = t.extra.subagents_no_call_names;
  expect(un.map((x) => [x.trajectory.trajectory_id, x.hint.same_prompt_calls])).toEqual([[U, ["toolu_Err"]]]);
  // Not attached: the call's result names no subagent.
  const res = t.steps.flatMap((st) => st.observation?.results ?? []).find((r) => r.source_call_id === "toolu_Err");
  expect(res.subagent_trajectory_ref).toBeUndefined();
});

test("atif: a transcript line longer than the ceiling is skipped, the rest is read, and the notes say so", () => {
  const { f, lines, save } = freshClaude("00000000-0000-4000-8000-000000000065");
  const at = lines.findIndex((l) => l.type === "user" && typeof l.message?.content === "string");
  const before = JSON.parse(execFileSync("bun", [join(core, "atif.js"), f, "claude"], { encoding: "utf8" }));
  // A record of 3 MB before the first prompt, with a 2 MB ceiling.
  lines.splice(at, 0, { ...lines[at], type: "system", uuid: "00000000-0000-4000-e200-000000000001", content: "x".repeat(3000000) });
  save(lines);
  const probe = spawnSync("bun", [join(core, "atif.js"), f, "claude"], { encoding: "utf8", maxBuffer: 1 << 28, env: { ...process.env, THREADS_LINE_MAX: "2000000" } });
  console.log("PROBE stderr", probe.stderr.slice(0, 3000));
  console.log("PROBE head", JSON.stringify(readFileSync(f, "utf8").split("\n").map((l) => l.length).slice(0, 8)));
  const t = JSON.parse(probe.stdout);
  expect(problems(t)).toEqual([]);
  expect(t.notes).toContain("1 transcript line was skipped for being longer than 2000000 bytes");
  expect(t.steps.length).toBe(before.steps.length);
});
