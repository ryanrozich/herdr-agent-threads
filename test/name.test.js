// The mod's name lives in one line (name.js) and must match its folder and the keys.json
// chord, so that sh rename.sh, an install and herdr.dev/mods all agree.
import { test, expect, mock } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
// settings.js imports herdr, the host's module: a stand-in, so this file runs on its own
// and in any order with the others.
const stub = () => null;
mock.module("herdr", () => ({
  writeTextFile: async () => null,
  ...Object.fromEntries(["exec", "hc", "home", "appHome", "readTextFile", "watchFolder", "theme", "themes", "settings", "panes", "terminals",
    "spaces", "focused", "props", "run", "shared", "setShared", "closeOverlay", "openOverlay", "notify", "nextCommand", "updates"].map((k) => [k, stub])),
}));

test("the mod's folder, name.js and the keys.json chord name the same mod", async () => {
  const dirs = readdirSync(join(root, "mods"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  expect(dirs.length).toBe(1);
  const { MOD } = await import(join(root, "mods", dirs[0], "name.js"));
  expect(MOD).toBe(dirs[0]);
  const keys = JSON.parse(readFileSync(join(root, "keys.json"), "utf8"));
  expect(keys.global["cmd-shift-t"]).toBe(`mod.open:${MOD}`);
  const { settingsDir } = await import(join(root, "mods", MOD, "settings.js"));
  expect(settingsDir("/h")).toBe(`/h/data/${MOD}`);
});

// rename.sh rewrites the mod's paths only in the files it lists. Every tracked file that
// names one (mods/<name>, data/<name>, mod.open:<name>) must be on that list, or a rename
// leaves it pointing at a folder that is gone.
test("rename.sh's file list covers every tracked file that names the mod's paths", async () => {
  const { spawnSync } = await import("node:child_process");
  const { MOD } = await import(join(root, "mods", "agent-threads", "name.js"));
  const git = (...a) => spawnSync("git", a, { cwd: root, encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean);
  const naming = git("grep", "-l", "-I", "-e", `mods/${MOD}`, "-e", `data/${MOD}`, "-e", `mod.open:${MOD}`);
  const line = /^files=\$\(git ls-files (.+)\)$/m.exec(readFileSync(join(root, "rename.sh"), "utf8"))[1];
  const specs = line.match(/'[^']+'|"[^"]+"|\S+/g).map((s) => s.replace(/^['"]|['"]$/g, "").replace("$new", MOD));
  const listed = new Set(git("ls-files", ...specs));
  expect(naming.filter((f) => !listed.has(f))).toEqual([]);
});
