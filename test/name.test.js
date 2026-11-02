// The mod's name lives in one line (name.js) and must match its folder and the keys.json
// chord, so that sh rename.sh, an install and herdr.dev/mods all agree.
import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

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
