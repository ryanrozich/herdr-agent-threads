// Adapted from harbor-framework/harbor, tests/unit/agents/installed/test_codex_trajectory.py
// and tests/unit/agents/installed/test_claude_code_trajectory.py at 110c71b32c268e1d113c3856869202842f8e37a6 (0.26.0).
// Copyright the Harbor authors. Apache-2.0; see LICENSE. Cases: CODEX_CASES in codex-cases.js.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CODEX_CASES } from "./codex-cases.js";
import { checkCase } from "./differences.js";
const cli = join(import.meta.dir, "../../mods/agent-threads/core/atif.js");
for (const item of CODEX_CASES) test(`harbor codex: ${item.id.slice(7).replaceAll("_", " ")}`, () => {
  const { main } = item.files(mkdtempSync(join(tmpdir(), "threads-harbor-")));
  const r = spawnSync("bun", [cli, main, "codex"], { encoding: "utf8" });
  if (r.status !== 0 && !/no turns/.test(r.stderr)) throw new Error(r.stderr);
  checkCase(item, r.status === 0 ? JSON.parse(r.stdout) : null);
});

test("harbor codex: the subagent case needs the history boundary", () => {
  const item = CODEX_CASES.find((candidate) => candidate.id === "codex: codex_subagent_rollouts_use_atif_children_without_copied_history");
  const dir = mkdtempSync(join(tmpdir(), "threads-harbor-"));
  const { main } = item.files(dir);
  for (const file of readdirSync(dirname(main), { withFileTypes: true }).map((e) => join(dirname(main), e.name))) {
    if (!file.endsWith(".jsonl") || file === main) continue;
    const stripped = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => {
      const e = JSON.parse(line);
      if (e.type === "session_meta" && e.payload?.subagent_history_start_ordinal != null) { delete e.payload.subagent_history_start_ordinal; return JSON.stringify(e); }
      return line;
    });
    writeFileSync(file, `${stripped.join("\n")}\n`);
  }
  const r = spawnSync("bun", [cli, main, "codex"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  expect(() => item.diff.check(JSON.parse(r.stdout))).toThrow();
});
