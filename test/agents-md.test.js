// AGENTS.md and the skills it names are how an agent learns to work here. These keep them
// pointing at things that exist: the skills, their names, CLAUDE.md, and the title examples.
import { test, expect } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
const skills = readdirSync(join(root, ".claude", "skills"));

test("CLAUDE.md points at AGENTS.md, which names each skill by its path", () => {
  expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
  expect(skills.sort()).toEqual(["cut-a-release", "open-a-pr", "verify-a-change"]);
  for (const s of skills) expect(agents).toContain(`.claude/skills/${s}/SKILL.md`);
});

test("each skill has a name that matches its folder and a description", () => {
  for (const s of skills) {
    const text = readFileSync(join(root, ".claude", "skills", s, "SKILL.md"), "utf8");
    const head = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(text);
    expect(head?.[1]).toBe(s);
    expect(head?.[2].length).toBeGreaterThan(40);
  }
});

test("the files AGENTS.md names exist", () => {
  for (const p of ["mods/agent-threads/version.js", ".release-please-manifest.json", "CHANGELOG.md", ".github/workflows/release.yml", "docs/develop.md", "test/scan-private.sh", "RECIPE.md", "preview.png"]) {
    expect(agents).toContain(p);
    expect([p, existsSync(join(root, p))]).toEqual([p, true]);
  }
});

// The release is the owner's call alone. These lines keep that from being dropped quietly.
test("AGENTS.md and the release skill say a release needs the owner's own words, and nothing else will do", () => {
  const skill = readFileSync(join(root, ".claude", "skills", "cut-a-release", "SKILL.md"), "utf8");
  for (const text of [agents, skill]) {
    expect(text).toContain("in their own words");
    expect(text).toMatch(/never mark it ready, label it `queue` or merge it on your own judgement/i);
    expect(text).toMatch(/a green `check`[^.]*(is not a reason|as a reason)/);
    expect(text).toMatch(/relay's say-so[^.]*is not enough/);
    expect(text).toContain("draft");
  }
  // Step 4, the only step that releases, is gated on the owner's own request.
  const step4 = /^4\. \*\*(.+)$/m.exec(skill)?.[1] ?? "";
  expect(step4).toMatch(/^Release, on the owner's own request\.\*\*/);
  expect(step4).toContain("is not enough");
  expect(step4).toContain("gh pr ready");
});

test("verify-a-change lists CI's own checks, in CI's order", () => {
  const ci = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
  const skill = readFileSync(join(root, ".claude", "skills", "verify-a-change", "SKILL.md"), "utf8");
  // The table's command column, with the escaped pipe back to a plain one.
  const cmds = [...skill.matchAll(/^\| [^|]+ \| `(.+?)` \| /gm)].map((m) => m[1].replace(/\\\|/g, "|"));
  expect(cmds).toHaveLength(4);
  const at = cmds.map((c) => ci.indexOf(c));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
});
