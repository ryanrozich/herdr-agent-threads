// bun test: RECIPE.md stays well under the 64 KB that the herdr.dev/mods index reads. A larger
// one is skipped ("RECIPE.md exceeds 64 KB or has an unknown size") and the mod drops off the
// listing. The long reference lives in docs/reference.md.
import { expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";

const LIMIT = 60 * 1024;

test("RECIPE.md is under 60 KB", () => {
  const bytes = statSync(join(import.meta.dir, "..", "RECIPE.md")).size;
  expect(bytes).toBeLessThan(LIMIT);
});
