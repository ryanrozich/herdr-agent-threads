// test/herdr-still.sh takes a still of the pane in a real Herdr on Linux, in a ticket's run,
// from what .catalyst/catalyst.toml installs. The still itself needs Linux and a display, so
// these check the settings it depends on and the script's refusals, which run anywhere.
import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const settings = Bun.TOML.parse(readFileSync(join(root, ".catalyst/catalyst.toml"), "utf8"));
const DISPLAY = ["xvfb", "libgl1", "libegl1", "libgl1-mesa-dri", "mesa-vulkan-drivers", "fonts-dejavu-core", "libxkbcommon0", "libxkbcommon-x11-0"];

test("the settings install the display packages and Herdr, and the install step cannot fail a phase", () => {
  const pk = settings.environment.system_packages.map((p) => p.name);
  for (const n of DISPLAY) expect(pk).toContain(n);
  const step = settings.environment.setup.find((s) => s.name === "install-herdr");
  expect(step.run.slice(0, 2)).toEqual(["sh", "-c"]);
  const cmd = step.run[2];
  expect(cmd).toContain("https://releases.herdr.dev/app/install.sh");
  expect(cmd).toContain('HOME="$HOME/.cache/herdr-rig"');
  // Whatever the install does, the step ends in a message, not a failure.
  expect(cmd).toMatch(/\|\| echo '[^']+' >&2$/);
  expect(settings.environment.container.egress).toContain("releases.herdr.dev");
  // No setup step starts the display: the script does, inside its own command.
  for (const s of settings.environment.setup) expect(s.run.join(" ")).not.toMatch(/Xvfb|xvfb-run|DISPLAY=/);
});

const still = (args, env = {}) => spawnSync("sh", [join(root, "test/herdr-still.sh"), ...args], { encoding: "utf8", env: { ...process.env, ...env } });

test("herdr-still.sh refuses bad arguments, a missing transcript and a missing Herdr, before it starts anything", () => {
  const fx = join(root, "test/fixtures/session.jsonl");
  expect(still([]).status).toBe(2);
  expect(still([fx, "x.png", "--theme", "blue"]).status).toBe(2);
  expect(still([fx, "x.png", "--px"]).status).toBe(2);
  expect(still([fx, "x.png", "--size", "big"]).status).toBe(2);
  let r = still([join(root, "test/fixtures/none.jsonl"), "x.png"]);
  expect([r.status, r.stderr]).toEqual([1, `herdr-still: no transcript at ${join(root, "test/fixtures/none.jsonl")}\n`]);
  r = still([fx, "x.png"], { HERDR_RIG: join(root, "test/fixtures/no-rig") });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("no Herdr at ");
});
