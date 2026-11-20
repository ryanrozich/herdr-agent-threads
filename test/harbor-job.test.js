// The Harbor job (.github/workflows/harbor.yml, test/harbor/) runs Harbor's own Python on our
// ATIF exports, outside the main check. These keep it outside, keep its pin the one the ported
// cases cite, and keep the tests it takes its exports from where it looks for them.
import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const job = read(".github/workflows/harbor.yml");
const run = read("test/harbor/run.sh");
const report = read("test/harbor/report.py");
const PIN = "110c71b32c268e1d113c3856869202842f8e37a6";

test("harbor: the job never gates a merge: a workflow of its own, one job named harbor, and the queue still asks only for check", () => {
  const jobs = job.slice(job.indexOf("\njobs:\n"));
  expect([...jobs.matchAll(/^ {2}([a-z][\w-]*):$/gm)].map((m) => m[1])).toEqual(["harbor"]);
  expect(job).not.toMatch(/^\s+needs:/m);
  expect(job).not.toContain("continue-on-error");
  expect(job).toMatch(/^permissions:\n {2}contents: read\n/m);
  expect(read(".mergify.yml").match(/check-success=\S+/g)).toEqual(["check-success=check", "check-success=check"]);
  expect(read(".github/workflows/ci.yml")).not.toMatch(/harbor/i);
});

test("harbor: nothing in test/harbor is a bun test file, so bun test never needs Python", () => {
  expect(readdirSync(join(root, "test", "harbor")).filter((f) => /\.test\./.test(f))).toEqual([]);
});

test("harbor: run.sh installs the commit the ported cases cite, from Harbor's lock, with Python 3.12", () => {
  expect(run).toContain(`HARBOR_COMMIT=${PIN}`);
  expect(read("test/atif-harbor/differences.js")).toContain(PIN);
  expect(run).toMatch(/sync -q --frozen --no-dev --python 3\.12/);
  expect(run).toMatch(/python" -I /);
});

test("harbor: the job runs when the export, the tests it reads or the job itself change", () => {
  const paths = [...job.matchAll(/^ {6}- "([^"]+)"$/gm)].map((m) => m[1]);
  for (const p of [".github/workflows/harbor.yml", "test/harbor/**", "mods/agent-threads/core/**", "test/atif.test.js", "test/make-fixture.js", "test/make-agents.js"]) expect(paths).toContain(p);
  expect(job).toContain("run: sh test/harbor/run.sh");
});

test("harbor: the tests run.sh selects exist and write the files report.py reads", () => {
  const pattern = /-t "([^"]+)"/.exec(run)?.[1];
  const atif = read("test/atif.test.js");
  const names = [...atif.matchAll(/^test\("([^"]+)"/gm)].map((m) => m[1]).filter((n) => n.includes(pattern));
  expect(names).toHaveLength(2);
  for (const f of ["nest-claude.json", "nest-codex.json"]) {
    expect(atif).toContain(`join(process.env.ATIF_KEEP, "${f}")`);
    expect(report).toContain(`"${f}"`);
  }
  expect(run).toContain('> "$s/out/codex.json"');
  expect(report).toContain('"codex.json"');
});

test("harbor: develop.md says how to run it and that the queue does not wait for it", () => {
  const dev = read("docs/develop.md");
  expect(dev).toContain("sh test/harbor/run.sh");
  expect(dev).toContain(".github/workflows/harbor.yml");
});
