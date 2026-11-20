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

// The queue's condition line, as YAML holds it: "title~=<pattern>", backslashes doubled.
const queued = /^\s+- "title~=(.+)"$/m.exec(mergify)?.[1]?.replace(/\\\\/g, "\\");
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

// Catalyst's reader of this file matches each condition as attribute, operator, value with
// nothing between them, and refuses the whole file on one it cannot read. Mergify reads both
// spellings the same, so every condition list (queue_conditions, merge_conditions and each
// rule's conditions) is written compact. A space inside a value, as in the title pattern, is
// part of the value.
test("the queue's conditions put no space around the operator", () => {
  const conditions = [];
  let list = null;
  for (const line of mergify.split("\n")) {
    const head = /^\s+(queue_conditions|merge_conditions|conditions):\s*$/.exec(line);
    if (head) { list = head[1]; continue; }
    if (!list) continue;
    const item = /^\s+- (.+)$/.exec(line);
    if (item) { conditions.push([list, item[1].replace(/^"(.*)"$/, "$1")]); continue; }
    if (/^\s*(#.*)?$/.test(line)) continue;
    list = null;
  }
  expect(conditions.length).toBeGreaterThanOrEqual(8);
  expect(conditions.map(([list]) => list)).toContain("conditions");
  for (const [list, c] of conditions) {
    const compact = /^-?#?[a-z][a-z-]*(?:(?:=|!=|~=|>=|<=|<|>)[^\s=~<>!].*)?$/.test(c);
    expect([list, c, compact]).toEqual([list, c, true]);
  }
});

// An acceptance hold must stop every route into the queue, so the hold lines sit in the queue
// rule's own queue_conditions (which the label, the command and every pull_request_rules
// entry all go through), not in one entry's conditions.
test("a hold or hold:preview label keeps any pull request out of the queue", () => {
  const rules = mergify.slice(mergify.indexOf("queue_rules:"), mergify.indexOf("merge_queue:"));
  const queueConditions = rules.slice(rules.indexOf("queue_conditions:"), rules.indexOf("merge_conditions:"));
  const conditions = [...queueConditions.matchAll(/^ {6}- (.+)$/gm)].map((m) => m[1]);
  expect(conditions).toContain("label!=hold");
  expect(conditions).toContain("label!=hold:preview");
  // One queue rule, so no pull request can be queued into a rule without them.
  expect([...rules.matchAll(/^ {2}- name: /gm)]).toHaveLength(1);
});

// The one rule that queues with no person's `queue` label: Catalyst's own ticket pull
// requests, kept off the files that define the gate. Each condition is pinned, so dropping
// one is a visible change.
const catalystRule = () => mergify.split(/^ {2}- name: /m).find((r) => r.startsWith("queue a Catalyst pull request"));
const ruleConditions = (rule) => [...rule.matchAll(/^ {6}- (.+)$/gm)].map((m) => m[1].replace(/^"(.*)"$/, "$1"));

test("the Catalyst rule queues only the app's own ticket branches, never a change to the gate's own files", () => {
  const rule = catalystRule();
  expect(rule).toBeTruthy();
  expect(ruleConditions(rule)).toEqual([
    "author=catalyst-cloud-connector[bot]",
    "label=queue:ready",
    "head-repo-full-name=ryanrozich/herdr-agent-threads",
    "head~=^TRD-[0-9]+$",
    "base=main",
    "#files<=100",
    "-files~=^\\.mergify",
    "-files~=^\\.github/",
    "-files~=^\\.catalyst/",
    "-files~=^\\.(claude|agents)/",
    "-files~=^test/leftover-check\\.sh$",
    "-files~=^bunfig\\.toml$",
    "-files~=^biome\\.jsonc$",
    "-files~=^\\.gitleaks",
    "-files~=(^|/)(AGENTS|CLAUDE)\\.md$",
  ]);
  // The rule only queues: the queue rule's conditions (check, title, threads, holds) decide.
  expect(rule).toMatch(/actions:\n {6}queue:\s*$/);
});

// Mergify reads a regex condition on a list as true when any item matches (a Python search),
// and the minus negates that. This applies the rule's files lines the same way.
test("the Catalyst rule's files lines pass an ordinary change and refuse one to the gate's files", () => {
  const lines = ruleConditions(catalystRule()).filter((c) => c.startsWith("-files~="));
  const res = lines.map((c) => new RegExp(c.slice("-files~=".length)));
  const passes = (files) => res.every((re) => !files.some((f) => re.test(f)));
  expect(passes(["mods/agent-threads/main.js", "test/render.test.js", "docs/usage.md", "README.md", "install.sh"])).toBe(true);
  expect(passes(["docs/AGENTS.md.txt", "mods/agent-threads/claude-mark.svg", "github/notes.md"])).toBe(true);
  expect(passes(["test/leftover-check.test.js", "test/bunfig.toml", "docs/biome.jsonc.md", "docs/gitleaks.md", "test/.gitleaks.toml"])).toBe(true);
  const gate = [
    ".mergify.yml", ".mergify/config.yml", ".github/workflows/ci.yml", ".github/mergify.yml", ".catalyst/catalyst.toml",
    ".claude/skills/cut-a-release/SKILL.md", ".agents/skills/x/SKILL.md", "AGENTS.md", "CLAUDE.md", "mods/agent-threads/AGENTS.md", "test/CLAUDE.md",
    "test/leftover-check.sh", "bunfig.toml", "biome.jsonc", ".gitleaks.toml", ".gitleaksignore",
  ];
  for (const f of gate) expect([f, passes(["mods/agent-threads/main.js", f])]).toEqual([f, false]);
  // A gate file moved elsewhere counts at both paths, so it does not pass.
  expect(passes([".mergify.yml", "docs/mergify.yml"])).toBe(false);
});
