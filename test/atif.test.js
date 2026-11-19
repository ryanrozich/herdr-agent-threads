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
