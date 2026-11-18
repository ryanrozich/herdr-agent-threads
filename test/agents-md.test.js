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
  expect(skills.sort()).toEqual(["cut-a-release", "open-a-pr"]);
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
