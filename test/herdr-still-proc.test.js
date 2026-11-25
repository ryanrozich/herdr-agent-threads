// test/herdr-still.sh stops what its Herdr left running (the core, and anything that started)
// without reading any process's environment. These run a copy of the script in which every
// /proc is a made-up folder tree, so no real process is looked at on any machine, whatever the
// script asks for. The tree's processes are sleeps these tests start, of 30 s each; the fake
// Herdr fills in their cmdline, cwd and environ.
import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const script = readFileSync(join(root, "test/herdr-still.sh"), "utf8");
const SH = existsSync("/bin/dash") ? "/bin/dash" : "/bin/sh";
const TIME = 30000;
const SLEEP = "/bin/sleep 30 > /dev/null 2>&1 < /dev/null &";

function stub(dir, name, body) {
  writeFileSync(join(dir, name), `#!${SH}\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
}

// A killed process may stay listed as a zombie where nothing reaps it (Linux, in a container).
function alive(pid) {
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8")); } catch { return true; }
}

// One run of the copy, with a fake Herdr that starts the processes and then refuses the
// script's first command, so the script fails there and cleans up. Each name in the result is a
// process: was it still up after the script ended.
//   core   as the real one: the rig's herdr-core, found on the app's PATH, with "serve", working
//          where the app works (its folder here is the fake app's own, as the script started it)
//   holder the run's folder in its command line
//   shell  works in the run's folder
//   other  has the folder in its environment only
//   before the folder in its command line and works in it, but ran before the script began
// Every one has the folder in its environ, as anything the app starts does.
const NAMES = ["core", "holder", "shell", "other", "before"];
let result = null;
const pids = [];
function cleanedUp() {
  if (result) return result;
  const d = mkdtempSync(join(tmpdir(), "herdr-still-proc-"));
  const tree = join(d, "tree");
  const rig = join(d, "rig");
  const bin = join(d, "bin");
  const co = join(d, "co");
  for (const p of [tree, join(rig, "bin"), bin, join(d, "x11"), join(co, "test")]) mkdirSync(p, { recursive: true });
  symlinkSync(join(root, "mods"), join(co, "mods"));
  writeFileSync(join(co, "test/herdr-still.sh"), script.replaceAll("/proc", tree));
  const before = Number(spawnSync(SH, ["-c", `${SLEEP} echo $!`], { encoding: "utf8" }).stdout);
  pids.push(before);
  writeFileSync(join(d, "before"), `${before}\n`);
  mkdirSync(join(tree, String(before)));
  stub(join(rig, "bin"), "timeout", '[ "$1" = -k ] && shift 2\nshift\nexec "$@"');
  stub(join(rig, "bin"), "herdr-core", "exit 0");
  stub(join(rig, "bin"), "herdr-app", `d='${d}'
case "$1 $2" in
  "--version "*) echo "herdr-app 0.1.16" ;;
  # No answer until the processes are in the tree.
  "status "*) [ -e "$d/ready" ] && echo '{"overlays":[],"errors":[]}' ;;
  "do space.new") exit 1 ;;
esac
[ $# -eq 0 ] || exit 0
run=\${HERDR_APP_HOME%/a}
# fill <pid> <working folder> <command line...>; start the same, with a name and a new process.
fill() {
  t="$d/tree/$1"
  mkdir -p "$t"
  ln -s "$2" "$t/cwd"
  printf 'HOME=%s\\0' "$run" > "$t/environ"
  shift 2
  printf '%s\\0' "$@" > "$t/cmdline"
}
start() {
  ${SLEEP}
  echo $! > "$d/$1"
  shift
  fill "$!" "$@"
}
core=$(command -v herdr-core)
start core "$(pwd -P)" "$core" serve
start holder / "$core" hold --socket "$run/run/t1.sock"
start shell "$run/code" /bin/sh
start other / other-app
fill "$(cat "$d/before")" "$run/code" "$run/x"
echo > "$d/ready"
exec /bin/sleep 30`);
  stub(bin, "uname", "echo Linux");
  stub(bin, "Xvfb", `touch "$HERDR_STILL_X11/X\${1#:}"; exec /bin/sleep 30`);
  // The script needs a timeout of its own PATH too; macOS has none.
  stub(bin, "timeout", '[ "$1" = -k ] && shift 2\nshift\nexec "$@"');
  const r = spawnSync(SH, [join(co, "test/herdr-still.sh"), join(root, "test/fixtures/session.jsonl"), join(d, "s.png")], {
    encoding: "utf8", timeout: 20000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HERDR_RIG: rig, HERDR_STILL_X11: join(d, "x11") },
  });
  const pid = Object.fromEntries(NAMES.map((n) => [n, Number(existsSync(join(d, n)) ? readFileSync(join(d, n), "utf8") : 0)]));
  pids.push(...NAMES.map((n) => pid[n]).filter((p) => p !== before));
  // A process that was signalled gets a moment to end.
  for (let i = 0; i < 20 && alive(pid.core) && pid.core > 0; i++) Bun.sleepSync(25);
  Bun.sleepSync(100);
  result = { r, pid, up: Object.fromEntries(NAMES.map((n) => [n, pid[n] > 0 && alive(pid[n])])) };
  return result;
}
afterAll(() => { for (const p of pids) if (p > 0 && alive(p)) process.kill(p, "SIGKILL"); });

test("the script's copy ran: its cleanup looks through /proc, and every process of the made-up tree was started", () => {
  expect(script).toContain("in /proc/[0-9]*");
  const { r, pid } = cleanedUp();
  expect([r.status, r.stderr]).toEqual([1, "herdr-still: space.new failed\n"]);
  for (const n of NAMES) expect(pid[n]).toBeGreaterThan(1);
}, TIME);

test("the cleanup stops the core, whose command line names the rig only: it works where the app was started", () => {
  expect(cleanedUp().up.core).toBe(false);
}, TIME);

test("the cleanup stops a left process that has the run's folder in its command line", () => {
  expect(cleanedUp().up.holder).toBe(false);
}, TIME);

test("the cleanup stops a left process that works in the run's folder", () => {
  expect(cleanedUp().up.shell).toBe(false);
}, TIME);

test("the cleanup leaves alone a process that has the run's folder in its environment only", () => {
  expect(cleanedUp().up.other).toBe(true);
}, TIME);

test("the cleanup leaves alone a process that ran before the script began", () => {
  expect(cleanedUp().up.before).toBe(true);
}, TIME);

test("the script names no process's environ", () => {
  expect(script.split("\n").filter((l) => !/^\s*#/.test(l) && l.includes("environ"))).toEqual([]);
}, TIME);

// The Linux half of "a test run reads no process's environment". This file writes the made-up
// tree's, so its own lines are left out; a comment line opens nothing.
test("nothing under test/ opens a process's environ file", () => {
  const files = readdirSync(join(root, "test"), { recursive: true }).map(String).filter((f) => /\.(sh|js|mjs|jq|py)$/.test(f) && f !== "herdr-still-proc.test.js");
  expect(files).toContain("herdr-still.sh");
  expect(files).toContain("preload.js");
  const hits = files.flatMap((f) => readFileSync(join(root, "test", f), "utf8").split("\n").map((l, i) => [`${f}:${i + 1}`, l])
    .filter(([, l]) => !/^\s*(#|\/\/)/.test(l) && /\/environ(?![a-z])/i.test(l)).map(([at]) => at));
  expect(hits).toEqual([]);
}, TIME);
