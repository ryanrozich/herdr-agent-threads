// bun test preload (bunfig.toml): the whole run keeps its temp files in one fresh folder,
// threads-run-<pid>-XXXXXX under the temp folder it was started with. TMPDIR points there
// before any test loads, so every mkdtempSync(join(tmpdir(), ...)) in the tests, and every
// mktemp in the scripts they run, lands inside it. When the run ends (passed, failed, or
// stopped by SIGINT, SIGTERM or SIGHUP) the processes it started that are still alive are
// killed and the folder is removed. A run killed outright (SIGKILL) leaves its folder; the
// next run removes it, since its pid is gone.
import { afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = tmpdir();
const parentRun = process.env.THREADS_TEST_ROOT;

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

// Folders of earlier runs that were killed before they could clean up.
try {
  for (const name of readdirSync(base)) {
    const m = /^threads-run-(\d+)-/.exec(name);
    if (m && Number(m[1]) !== process.pid && !alive(Number(m[1]))) rmSync(join(base, name), { recursive: true, force: true });
  }
} catch {}

const root = mkdtempSync(join(base, `threads-run-${process.pid}-`));
const realRoot = realpathSync(root);
process.env.TMPDIR = root;
process.env.THREADS_TEST_ROOT = root;
if (tmpdir() !== root) throw new Error(`preload: os.tmpdir() is ${tmpdir()}, not the run's folder ${root}`);

const ps = (args) => { try { return execFileSync("ps", args, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };

// The processes this run started that are still alive: its descendants; orphans in its
// process group (a child whose parent was killed first, now owned by pid 1); and any process
// whose command line or environment names the run's folder (every child inherits TMPDIR;
// Linux shows any process's environment, macOS not a system binary's).
function leftovers() {
  const rows = ps(["-A", "-o", "pid=,ppid=,pgid="]).split("\n").map((l) => l.trim().split(/\s+/).map(Number)).filter((r) => r.length === 3 && r.every((n) => n > 0));
  const ppid = new Map(rows.map(([pid, pp]) => [pid, pp]));
  const ancestors = new Set();
  for (let p = process.pid; p > 1 && !ancestors.has(p); p = ppid.get(p) ?? 0) ancestors.add(p);
  const group = rows.find(([pid]) => pid === process.pid)?.[2];
  const ours = new Set([process.pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, pp] of rows) if (ours.has(pp) && !ours.has(pid)) { ours.add(pid); grew = true; }
  }
  for (const [pid, pp, pg] of rows) if (pg === group && pp === 1) ours.add(pid);
  for (const line of ps(["axeww", "-o", "pid=,command="]).split("\n")) {
    if (line.includes(root) || line.includes(realRoot)) ours.add(Number(line.trim().split(/\s+/)[0]));
  }
  return [...ours].filter((pid) => pid > 1 && !ancestors.has(pid));
}

let done = false;
function cleanup() {
  if (done) return;
  done = true;
  for (const pid of leftovers()) { try { process.kill(pid, "SIGKILL"); } catch {} }
  try { rmSync(root, { recursive: true, force: true }); } catch {}
}

// bun test does not fire process "exit"; an afterAll in a preload runs once, after every file.
afterAll(cleanup);
for (const [sig, n] of [["SIGINT", 2], ["SIGTERM", 15], ["SIGHUP", 1]]) {
  process.on(sig, () => { cleanup(); process.exit(128 + n); });
}

// A bun test that a test runs (render.test.js's timing child) ends with the run that started
// it: if its parent goes away, it cleans up and exits.
if (parentRun) {
  const parent = process.ppid;
  setInterval(() => { if (process.ppid !== parent) { cleanup(); process.exit(1); } }, 500).unref();
}
