// Adapted from harbor-framework/harbor, tests/unit/agents/installed/test_codex_trajectory.py
// and tests/unit/agents/installed/test_claude_code_trajectory.py at 110c71b32c268e1d113c3856869202842f8e37a6 (0.26.0).
// Copyright the Harbor authors. Apache-2.0; see LICENSE. Cases: CODEX_CASES in codex-cases.js.
<<<<<<< HEAD
=======
// Changed from Harbor's original: this runner is ours (pytest's role); it runs each case through our export's command line.
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
import { test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODEX_CASES } from "./codex-cases.js";
import { checkCase } from "./differences.js";
const cli = join(import.meta.dir, "../../mods/agent-threads/core/atif.js");
<<<<<<< HEAD
for (const item of CODEX_CASES) test(`harbor codex: ${item.id.slice(7).replaceAll("_", " ")}`, () => {
  const { main } = item.files(mkdtempSync(join(tmpdir(), "threads-harbor-")));
  const r = spawnSync("bun", [cli, main, "codex"], { encoding: "utf8" });
  if (r.status !== 0 && !/no turns/.test(r.stderr)) throw new Error(r.stderr);
  checkCase(item, r.status === 0 ? JSON.parse(r.stdout) : null);
=======
// A case's export, or null when the export says exactly "no turns" (exit 1); anything else throws.
const run = (files) => {
  const { main } = files(mkdtempSync(join(tmpdir(), "threads-harbor-")));
  const r = spawnSync("bun", [cli, main, "codex"], { encoding: "utf8" });
  if (r.status === 1 && r.stderr.trim() === "no turns") return null;
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
};
for (const item of CODEX_CASES) test(`harbor codex: ${item.id.slice(7).replaceAll("_", " ")}`, () => {
  checkCase(item, run(item.files), item.diff?.control ? run(item.diff.control) : undefined);
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
});
