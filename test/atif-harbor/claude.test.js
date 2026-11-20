// Adapted from harbor-framework/harbor, tests/unit/agents/installed/test_claude_code_trajectory.py
// and tests/unit/agents/installed/test_codex_trajectory.py at 110c71b32c268e1d113c3856869202842f8e37a6 (0.26.0).
// Copyright the Harbor authors. Apache-2.0; see LICENSE. Cases: CLAUDE_CASES in claude-cases.js.
<<<<<<< HEAD
=======
// Changed from Harbor's original: this runner is ours (pytest's role); the fixed corpus test replaces Harbor's Hypothesis property.
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_CASES, user, writeSession } from "./claude-cases.js";
import { checkCase } from "./differences.js";

const cli = join(import.meta.dir, "../../mods/agent-threads/core/atif.js");
<<<<<<< HEAD
for (const item of CLAUDE_CASES) test(`harbor claude: ${item.id.slice(8).replaceAll("_", " ")}`, () => {
  const { main } = item.files(mkdtempSync(join(tmpdir(), "threads-harbor-")));
  const r = spawnSync("bun", [cli, main, "claude"], { encoding: "utf8" });
  if (r.status !== 0 && !/no turns/.test(r.stderr)) throw new Error(r.stderr);
  checkCase(item, r.status === 0 ? JSON.parse(r.stdout) : null);
=======
// A case's export, or null when the export says exactly "no turns" (exit 1); anything else throws.
const run = (files) => {
  const { main } = files(mkdtempSync(join(tmpdir(), "threads-harbor-")));
  const r = spawnSync("bun", [cli, main, "claude"], { encoding: "utf8" });
  if (r.status === 1 && r.stderr.trim() === "no turns") return null;
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
};
for (const item of CLAUDE_CASES) test(`harbor claude: ${item.id.slice(8).replaceAll("_", " ")}`, () => {
  checkCase(item, run(item.files), item.diff?.control ? run(item.diff.control) : undefined);
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
});

test("harbor corpus (ours): awkward user strings survive the export byte for byte", () => {
  const same = ["plain", "line\r\nnext", "line\rnext", "a\u2028b", "a\u2029b", "a\u0085b", "\uFEFFstart", "a\u00A0b", "a\u200Bb", "e\u0301", "a\u0001b", "a\u007Fb", 'say "hello"', "a\\b", "astral 😀", "مرحبا", "a\tb", "line\nnext", "👩‍💻", "  leading", "trailing\n", "mixed é 😀 שלום"];
  const consumed = ["[Request interrupted by user]", "<command-name>/usage</command-name>", "<local-command-stdout>ok</local-command-stdout>", "<bash-input>pwd</bash-input>", "<task-notification>done</task-notification>"];
  const run = (value) => {
    const main = writeSession(mkdtempSync(join(tmpdir(), "threads-harbor-")), "session.jsonl", [user(value)]);
    const result = spawnSync("bun", [cli, main, "claude"], { encoding: "utf8" });
    return result.status === 0 ? JSON.parse(result.stdout).steps[0]?.message : null;
  };
  expect(same).toHaveLength(22);
  for (const value of same) expect(run(value)).toBe(value);
  expect(run("x".repeat(200001))).toBe(`${"x".repeat(200000)}\n\n… (cut at 200 KB)`);
  for (const value of consumed) expect(run(value)).not.toBe(value);
});
<<<<<<< HEAD

test("harbor claude: json.dumps facts pass on Harbor's five messages and fail on a wrong one", () => {
  const item = CLAUDE_CASES.find((candidate) => candidate.id === "claude: stringify_uses_json_dumps_for_non_str");
  const exportOf = (messages) => {
    const main = writeSession(mkdtempSync(join(tmpdir(), "threads-harbor-")), "session.jsonl", messages.map((message) => user(message)));
    const result = spawnSync("bun", [cli, main, "claude"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout);
  };
  const harbor = ["true", "false", '{"a": 1, "b": "x"}', '{"nested": {"inner": [1, 2]}}', '{"中文": "value", "emoji_🎉": 1}'];
  item.facts(exportOf(harbor));
  expect(() => item.facts(exportOf(harbor.with(2, '{"a":1,"b":"x"}')))).toThrow('json.dumps semantics expected for {"a":1,"b":"x"}');
  expect(() => item.facts(exportOf(harbor.slice(0, 4)))).toThrow("one user step per payload");
});
=======
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
