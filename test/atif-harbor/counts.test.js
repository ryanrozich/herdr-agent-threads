// Adapted from harbor-framework/harbor, tests/unit/agents/installed/test_claude_code_trajectory.py
// and tests/unit/agents/installed/test_codex_trajectory.py at 110c71b32c268e1d113c3856869202842f8e37a6 (0.26.0),
// with tests/unit/agents/installed/test_opencode.py, test_opencode_v2.py, test_pi.py and
// test_antigravity_cli.py at the same commit.
// Copyright the Harbor authors. Apache-2.0; see LICENSE. Case inventory and omissions: differences.js.
// Changed from Harbor's original: nothing here is Harbor's code; it checks our record of Harbor's items adds up.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_CASES } from "./claude-cases.js";
import { CODEX_CASES } from "./codex-cases.js";
import { OPENCODE_CASES } from "./opencode-cases.js";
import { PI_CASES } from "./pi-cases.js";
import { ANTIGRAVITY_CASES } from "./antigravity-cases.js";
import { COUNTS, EXPECTED_DIFFERENCES, LEFT_OUT, checkCase } from "./differences.js";
const cases = [...CLAUDE_CASES, ...CODEX_CASES, ...OPENCODE_CASES, ...PI_CASES, ...ANTIGRAVITY_CASES];
test("harbor: every expected difference names a ported case that runs our value", () => {
  for (const item of cases) expect(Boolean(item.diff)).toBe(EXPECTED_DIFFERENCES.some((entry) => entry.id === item.id));
  for (const entry of EXPECTED_DIFFERENCES) {
    const item = cases.find((candidate) => candidate.id === entry.id);
    expect(item?.diff?.reason).toBe(entry.reason);
    expect(item?.diff?.kind).toBe(entry.kind);
    expect(typeof item?.diff?.check).toBe("function");
    expect(typeof item?.facts).toBe("function");
    expect(LEFT_OUT.some((candidate) => candidate.id === entry.id)).toBe(false);
  }
});
test("harbor: a wrong value fails a case by name", () => {
  const item = CLAUDE_CASES.find((candidate) => candidate.id === "claude: multiple_thinking_blocks_concatenated");
  expect(() => checkCase(item, { schema_version: "ATIF-v1.7", agent: { name: "Claude Code", version: "1" }, steps: [{ step_id: 1, source: "user", message: "What is up" }, { step_id: 2, source: "agent", message: "Final answer.", reasoning_content: "wrong" }] })).toThrow(item.id);
});
test("harbor: the subagent rollout case accepts Harbor's own trajectory", () => {
  // This test shows the case's facts can pass. It asserted 0.22 and null for one
  // conversion's total_cost_usd, which no trajectory can satisfy.
  const item = CODEX_CASES.find((candidate) => candidate.id === "codex: codex_subagent_rollouts_use_atif_children_without_copied_history");
  const nicknames = { alpha: "Alpha", beta: "Beta" };
  const harborShaped = {
    session_id: "root",
    trajectory_id: "root",
    steps: [{ step_id: 1, observation: { results: [{ subagent_trajectory_ref: [{ trajectory_id: "alpha" }, { trajectory_id: "beta" }] }] } }],
    subagent_trajectories: ["alpha", "beta"].map((name) => ({
      trajectory_id: name,
      session_id: "root",
      steps: [{ step_id: 1, message: `${name} child work` }],
      agent: { extra: { agent_nickname: nicknames[name] } },
    })),
    final_metrics: { total_prompt_tokens: 220, total_completion_tokens: 22, total_cached_tokens: 60, total_cost_usd: 0.22, total_steps: 1, extra: { total_tokens: 242 } },
  };
  expect(() => item.facts(harborShaped)).not.toThrow();
});
test("harbor: the counts of passing, listed and left-out cases match the record", () => {
  const ids = [...cases.map((item) => item.id), ...LEFT_OUT.map((item) => item.id)];
  expect(new Set(ids).size).toBe(211);
  expect(ids.length).toBe(COUNTS.items.total);
  expect(cases.filter((item) => !item.diff).length).toBe(COUNTS.items.pass);
  expect(cases.filter((item) => item.diff).length).toBe(COUNTS.items.listed);
  expect(LEFT_OUT.length).toBe(COUNTS.items.leftOut);
  expect(LEFT_OUT.every((item) => item.reason.trim().length > 0)).toBe(true);
  const functionNames = (agent) => new Set(ids.filter((id) => id.startsWith(`${agent}: `)).map((id) => id.replace(/\[\d+\]$/, "")));
  expect(functionNames("claude").size).toBe(COUNTS.functions.claude);
  expect(functionNames("codex").size).toBe(COUNTS.functions.codex);
  expect(functionNames("opencode").size).toBe(COUNTS.functions.opencode);
  expect(functionNames("opencode-v2").size).toBe(COUNTS.functions["opencode-v2"]);
  expect(functionNames("pi").size).toBe(COUNTS.functions.pi);
  expect(functionNames("antigravity").size).toBe(COUNTS.functions.antigravity);
  expect(COUNTS.functions.claude + COUNTS.functions.codex + COUNTS.functions.opencode + COUNTS.functions["opencode-v2"] + COUNTS.functions.pi + COUNTS.functions.antigravity).toBe(COUNTS.functions.total);
});
test("harbor: the port carries Harbor's license and the pin", () => {
  const license = readFileSync(join(import.meta.dir, "LICENSE"), "utf8");
  expect(license).toContain("Apache License");
  expect(license).toContain("Version 2.0");
  for (const file of ["claude-cases.js", "claude.test.js", "codex-cases.js", "codex.test.js", "differences.js"]) {
    const source = readFileSync(join(import.meta.dir, file), "utf8");
    expect(source).toContain("110c71b32c268e1d113c3856869202842f8e37a6");
    expect(source).toContain("test_claude_code_trajectory.py");
    expect(source).toContain("test_codex_trajectory.py");
  }
  for (const file of ["opencode-cases.js", "opencode.test.js"]) {
    const source = readFileSync(join(import.meta.dir, file), "utf8");
    expect(source).toContain("110c71b32c268e1d113c3856869202842f8e37a6");
    expect(source).toContain("test_opencode.py");
    expect(source).toContain("test_opencode_v2.py");
  }
  for (const file of ["pi-cases.js", "pi.test.js"]) {
    const source = readFileSync(join(import.meta.dir, file), "utf8");
    expect(source).toContain("110c71b32c268e1d113c3856869202842f8e37a6");
    expect(source).toContain("test_pi.py");
  }
  for (const file of ["antigravity-cases.js", "antigravity.test.js"]) {
    const source = readFileSync(join(import.meta.dir, file), "utf8");
    expect(source).toContain("110c71b32c268e1d113c3856869202842f8e37a6");
    expect(source).toContain("test_antigravity_cli.py");
  }
});
