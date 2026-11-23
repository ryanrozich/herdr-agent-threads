// Adapted from harbor-framework/harbor, tests/unit/agents/installed/test_opencode.py
// and tests/unit/agents/installed/test_opencode_v2.py at 110c71b32c268e1d113c3856869202842f8e37a6 (0.26.0).
// Copyright the Harbor authors. Apache-2.0; see LICENSE. Cases: OPENCODE_CASES in opencode-cases.js.
// Changed from Harbor's original: this runner is ours (pytest's role); it runs each case through our export's command line.
import { test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPENCODE_CASES } from "./opencode-cases.js";
import { checkCase } from "./differences.js";
const cli = join(import.meta.dir, "../../mods/agent-threads/core/atif.js");
// A case's export, or null when the export says exactly "no turns" (exit 1); anything else throws.
const run = (files) => {
  const { main } = files(mkdtempSync(join(tmpdir(), "threads-harbor-")));
  const r = spawnSync("bun", [cli, main, "opencode"], { encoding: "utf8" });
  if (r.status === 1 && r.stderr.trim() === "no turns") return null;
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
};
for (const item of OPENCODE_CASES) test(`harbor ${item.id.replaceAll("_", " ")}`, () => {
  checkCase(item, run(item.files), item.diff?.control ? run(item.diff.control) : undefined);
});
