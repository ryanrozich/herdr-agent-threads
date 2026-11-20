// Adapted from harbor-framework/harbor, tests/unit/agents/installed/test_codex_trajectory.py
// and tests/unit/agents/installed/test_claude_code_trajectory.py at 110c71b32c268e1d113c3856869202842f8e37a6 (0.26.0).
// Copyright the Harbor authors. Apache-2.0; see LICENSE. Cases: CODEX_CASES in codex-cases.js.
import { test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODEX_CASES } from "./codex-cases.js";
import { checkCase } from "./differences.js";
const cli = join(import.meta.dir, "../../mods/agent-threads/core/atif.js");
for (const item of CODEX_CASES) test(`harbor codex: ${item.id.slice(7).replaceAll("_", " ")}`, () => {
  const { main } = item.files(mkdtempSync(join(tmpdir(), "threads-harbor-")));
  checkCase(item, JSON.parse(execFileSync("bun", [cli, main, "codex"], { encoding: "utf8" })));
});
