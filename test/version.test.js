// The version a user can see: version.js holds the last release this copy has, build.js
// what ./install.sh found in the clone it ran from, and versionLine() turns the two into the
// settings card's line. A copy made without install.sh (from the herdr.dev listing, say)
// keeps the committed build.js, so its line says the commit is not known.
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dir, "..");
const mod = join(root, "mods", "agent-threads");
const { VERSION, NAME, versionLine, parseBuild } = await import(join(mod, "version.js"));
const { BUILD } = await import(join(mod, "build.js"));

test("version.js holds one plain version, the name matches mod.json's title, and build.js in the repo is null", () => {
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  expect(NAME).toBe(JSON.parse(readFileSync(join(mod, "mod.json"), "utf8")).title);
  expect(BUILD).toBe(null);
  // The release tool finds the line it bumps by this marker, so it stays on that line.
  expect(readFileSync(join(mod, "version.js"), "utf8")).toMatch(/^export const VERSION = "\d+\.\d+\.\d+"; \/\/ x-release-please-version$/m);
});

test("the line: a release, a later commit, local changes, an older or newer tag, and no build at all", () => {
  expect(versionLine("1.0.0", "v1.0.0-0-gd7c9cfb")).toEqual({ text: "Agent Threads 1.0.0", tip: null, commit: "d7c9cfb", later: 0, dirty: false, known: true });
  // Past the release: the commit, labelled, and no count on the line (the owner, 2026-11-19:
  // "commit: and the hash there for brevity"); the tooltip keeps the count.
  expect(versionLine("1.0.0", "v1.0.0-3-gabc1234")).toEqual({ text: "Agent Threads 1.0.0, commit: abc1234", tip: "Agent Threads 1.0.0, commit: abc1234, 3 commits after the 1.0.0 release", commit: "abc1234", later: 3, dirty: false, known: true });
  expect(versionLine("1.0.0", "v1.0.0-1-gabc1234").tip).toBe("Agent Threads 1.0.0, commit: abc1234, 1 commit after the 1.0.0 release");
  // Local changes: the commit shows even on the release's own commit, since the copy is not it.
  expect(versionLine("1.0.0", "v1.0.0-0-gd7c9cfb-dirty").text).toBe("Agent Threads 1.0.0, commit: d7c9cfb, with local changes");
  expect(versionLine("1.0.0", "v1.0.0-0-gd7c9cfb-dirty").tip).toBe(null);
  expect(versionLine("1.0.0", "v1.0.0-2-gabc1234-dirty").text).toBe("Agent Threads 1.0.0, commit: abc1234, with local changes");
  expect(versionLine("1.0.0", "v1.0.0-2-gabc1234-dirty").tip).toBe("Agent Threads 1.0.0, commit: abc1234, with local changes, 2 commits after the 1.0.0 release");
  // The tag git found is not this version (a release PR's branch, a clone with old tags):
  // the version file wins and the commit says where the copy came from.
  expect(versionLine("1.1.0", "v1.0.0-5-gabc1234").text).toBe("Agent Threads 1.1.0, commit: abc1234");
  expect(versionLine("1.1.0", "v1.0.0-5-gabc1234").tip).toBe(null);
  // No build: the repo's own build.js, or a copy made without install.sh.
  const none = versionLine("1.0.0", null);
  expect(none.text).toBe("Agent Threads 1.0.0 (commit not known)");
  expect(none.tip).toBe("Copied without ./install.sh, so the commit is not known: this release or a later commit on main.");
  expect(none.known).toBe(false);
  // Anything else install.sh could have written reads as no build, never as a release.
  for (const bad of ["", "abc1234", "v1.0-0-gabc1234", "v1.0.0-x-gabc1234", "1.0.0-0-gabc1234", "v1.0.0-0-gZZZ", 7, {}]) {
    expect(parseBuild(bad)).toBe(null);
    expect(versionLine("1.0.0", bad).text).toBe("Agent Threads 1.0.0 (commit not known)");
  }
  expect(parseBuild("v2.10.3-12-g0123456789ab")).toEqual({ tag: "2.10.3", later: 12, commit: "0123456", dirty: false });
});

// install.sh against a throwaway clone: its git describe goes into the installed build.js,
// and the clone's own files stay as they were. herdr-app is a stand-in on PATH, since the
// real check must never run here.
const sh = (cwd, cmd, env = {}) => {
  const r = spawnSync("sh", ["-c", cmd], { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr}`);
  return r.stdout.trim();
};
const install = (from, tag) => {
  const base = mkdtempSync(join(tmpdir(), "threads-ver-"));
  try {
    const outer = join(base, "outer");
    const repo = from === "inside" ? join(outer, "copy") : join(base, "repo");
    mkdirSync(join(repo, "mods"), { recursive: true });
    cpSync(mod, join(repo, "mods", "agent-threads"), { recursive: true, filter: (p) => !/vendor|\.DS_Store/.test(p) });
    cpSync(join(root, "install.sh"), join(repo, "install.sh"));
    const bin = join(base, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "herdr-app"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, "herdr-app"), 0o755);
    const env = { ID: "-c user.name=t -c user.email=t", HERDR_APP_HOME: join(base, "home"), PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
    if (from === "git") {
      sh(repo, "git init -q && git add -A && git $ID commit -q -m one", env);
      if (tag) sh(repo, 'git $ID tag -a "$TAG" -m x', { ...env, TAG: tag });
      sh(repo, "echo x > extra.txt && git add extra.txt && git $ID commit -q -m two", env);
    }
    if (from === "inside") {
      sh(outer, "git init -q && git add -A && git $ID commit -q -m one", env);
      sh(outer, 'git $ID tag -a "$TAG" -m x', { ...env, TAG: tag });
    }
    sh(repo, "sh install.sh", env);
    return {
      built: readFileSync(join(base, "home", "mods", "agent-threads", "build.js"), "utf8"),
      kept: readFileSync(join(repo, "mods", "agent-threads", "build.js"), "utf8"),
      head: from === "git" ? sh(repo, "git rev-parse --short=7 HEAD", env) : null,
    };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
};

test("install.sh writes nothing from a tag name that parseBuild would not read: quotes, dollars and the like stay out of build.js", () => {
  const unknown = "export const BUILD = null;\n";
  // Tag names git allows that a careless printf would paste into JavaScript. (git refuses
  // a backslash or a newline in a tag name.)
  for (const tag of ['v1.0.0"x', "v1.0.0'x", "v1.0.0$x", "v1.0.0`x`", "v1.0.0;x", "v1.0.0x"]) {
    const r = install("git", tag);
    expect([tag, r.built]).toEqual([tag, unknown]);
  }
});

test("main.js loads build.js only through a dynamic import that catches, so a missing or broken build.js leaves the pane working", () => {
  const main = readFileSync(join(mod, "main.js"), "utf8");
  expect(main).not.toMatch(/^import .* from "\.\/build\.js";$/m);
  expect(main).toMatch(/import\("\.\/build\.js"\)\s*\.then\(\(m\) => \{ built = parseBuild\(m\?\.BUILD\) \? m\.BUILD : null; \}\)\s*\.catch\(\(\) => \{ built = null; \}\);/);
});

test("install.sh writes git describe into the installed build.js, and leaves the repo's own as it is", () => {
  const committed = readFileSync(join(mod, "build.js"), "utf8");
  const tagged = install("git", "v1.0.0");
  expect(tagged.built).toBe(`export const BUILD = "v1.0.0-1-g${tagged.head}";\n`);
  expect(tagged.kept).toBe(committed);
  // No release tag in the clone: nothing to describe against, so the copy says null.
  const unknown = "export const BUILD = null;\n";
  expect(install("git", null).built).toBe(unknown);
  // Not a git clone at all (a downloaded folder): the same.
  expect(install("none", null).built).toBe(unknown);
  // A copy inside some other git repo that has a release tag of its own: that repo's tags
  // say nothing about this copy, so it keeps null too.
  expect(install("inside", "v9.9.9").built).toBe(unknown);
});
