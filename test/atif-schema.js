import { ATIF_VERSION } from "../mods/agent-threads/core/atif.js";

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
export function problems(t) {
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

