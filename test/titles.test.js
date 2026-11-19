// Pull requests land as one squash commit titled from the pull request, and the release tool
// reads those titles, so a title must be a Conventional Commit. The pattern lives twice: as
// the merge queue's condition (.mergify.yml) and in the title check on each pull request
// (.github/workflows/pr-title.yml). This keeps the two the same and pins what they accept.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const mergify = readFileSync(join(root, ".mergify.yml"), "utf8");
const workflow = readFileSync(join(root, ".github", "workflows", "pr-title.yml"), "utf8");

// The queue's condition line, as YAML holds it: "title ~= <pattern>", backslashes doubled.
const queued = /^\s+- "title ~= (.+)"$/m.exec(mergify)?.[1]?.replace(/\\\\/g, "\\");
const checked = /^\s+PATTERN: '(.+)'$/m.exec(workflow)?.[1];

test("the queue and the title check use one pattern", () => {
  expect(queued).toBeTruthy();
  expect(checked).toBe(queued);
});

test("the pattern takes the release tool's types, a scope and a bang, and nothing else", () => {
  const re = new RegExp(queued);
  for (const ok of [
    "feat: the settings card shows the version you are running",
    "fix(links): one slow run no longer turns a plain rule off",
    "docs: how pull requests merge",
    "feat!: settings move to a new file",
    "refactor(main)!: one draw path",
    "chore(main): release 1.0.1",
    "perf: rows build in slices", "test: a case for issue 131", "build: bun 1.4.2", "ci: squash merges", "revert: feat: the version line", "style: biome format",
  ]) expect([ok, re.test(ok)]).toEqual([ok, true]);
  for (const bad of [
    "Highlighting text stops following",
    "Merge pull request #150 from ryanrozich/docs-depends-on",
    "merge queue: merged #148, #152, #150",
    "feat:no space", "feat : space before", "Feat: capital", "feature: not a type", "fix(): empty scope",
    "fix(Links): capital scope", "fix(a b): space in scope", "docs:", "docs: ", "wip: later",
  ]) expect([bad, re.test(bad)]).toEqual([bad, false]);
});

test("the queue squashes, titled from the pull request with its number, the description as the body", () => {
  expect(mergify).toMatch(/^ {4}merge_method: squash$/m);
  expect(mergify).toMatch(/^ {4}commit_message_format:\n {6}title: pr-title\n {6}body: pr-body$/m);
  expect(mergify).not.toMatch(/merge_method: merge\b/);
});

test("the title check skips Mergify's own batch pull requests and reads the title only from the environment", () => {
  expect(workflow).toMatch(/types: \[opened, edited, synchronize, reopened\]/);
  expect(workflow).toMatch(/!startsWith\(github\.head_ref, 'mergify\/merge-queue\/'\)/);
  // The title goes in through env, never pasted into the script, so a title cannot run code.
  expect(workflow).toMatch(/TITLE: \$\{\{ github\.event\.pull_request\.title \}\}/);
  expect(workflow.split("run:")[1]).not.toContain("${{");
});
