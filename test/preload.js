// bun test preload (bunfig.toml): the whole run keeps its temp files in one fresh folder,
// threads-run-<pid>-XXXXXX under the temp folder it was started with. TMPDIR points there
// before any test loads, so every mkdtempSync(join(tmpdir(), ...)) in the tests, and every
// mktemp in the scripts they run, lands inside it. When the run ends (passed, failed, or
// stopped by SIGINT, SIGTERM or SIGHUP) the processes it started that are still alive are
// stopped and the folder is removed. A run killed outright (SIGKILL) leaves its folder; a
// later run removes it once its pid is gone and it is over an hour old.
import { afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = tmpdir();
const parentRun = process.env.THREADS_TEST_ROOT;
const HOUR = 60 * 60 * 1000;

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

// Folders of earlier runs that were killed before they could clean up: the run's pid is gone
// and the folder is over an hour old (a pid can be reused; the age keeps a live run's safe).
try {
  for (const name of readdirSync(base)) {
    const m = /^threads-run-(\d+)-/.exec(name);
    if (!m || Number(m[1]) === process.pid || alive(Number(m[1]))) continue;
    const dir = join(base, name);
    if (Date.now() - statSync(dir).mtimeMs > HOUR) rmSync(dir, { recursive: true, force: true });
  }
} catch {}

const root = mkdtempSync(join(base, `threads-run-${process.pid}-`));
const realRoot = realpathSync(root);
process.env.TMPDIR = root;
process.env.THREADS_TEST_ROOT = root;
if (tmpdir() !== root) throw new Error(`preload: os.tmpdir() is ${tmpdir()}, not the run's folder ${root}`);

// Every ps call has a time limit, so a signal handler cannot hang on one, and the C locale,
// so lstart's day and month names parse.
const ps = (args) => {
  try { return execFileSync("ps", args, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"], timeout: 5000, env: { ...process.env, LC_ALL: "C" } }); } catch { return ""; }
};
// A command name's first word without its folder: macOS shows a name set with exec -a whole
// ("codex app-server --listen unix://..."), Linux the program's own name.
const base0 = (comm) => (comm.trim().split(/\s+/)[0] ?? "").split("/").pop();

// Each process as { pid, ppid, start, comm }: lstart is five words ("Mon Nov 17 15:04:01
// 2026"), read as a time in ms, so the command name is what follows them.
function table(args) {
  const out = [];
  for (const line of ps(args).split("\n")) {
    const w = line.trim().split(/\s+/);
    if (w.length < 7) continue;
    const [pid, ppid] = w.slice(0, 2).map(Number);
    const start = Date.parse(w.slice(2, 7).join(" "));
    if (pid > 0 && Number.isFinite(start)) out.push({ pid, ppid, start, comm: base0(w.slice(7).join(" ")) });
  }
  return out;
}
const snapshot = (pids) => table(pids ? ["-o", "pid=,ppid=,lstart=,comm=", "-p", pids.join(",")] : ["-A", "-o", "pid=,ppid=,lstart=,comm="]);

// Names a process matched by the run's folder (not by being a descendant) may have: the
// shells, tools and stand-ins the tests start (codex and opencode are renamed bash, sleep or
// bun). Anything else that names the folder (an ls, an editor, a shared daemon a test woke) is
// left alone. A helper a future test means to outlive the run, under one of these names, would
// be stopped.
const OURS = new Set(["bash", "sh", "dash", "sleep", "bun", "node", "jq", "sqlite3", "codex", "opencode"]);

// The processes this run started that are still alive: its descendants, and processes with a
// name in OURS whose command line or environment names the run's folder (every child inherits
// TMPDIR, so an orphan still carries it; Linux shows any process's environment, macOS not a
// system binary's). The preload's own ps calls are left out.
function leftovers() {
  const rows = snapshot();
  const by = new Map(rows.map((r) => [r.pid, r]));
  const ancestors = new Set();
  for (let p = process.pid; p > 1 && !ancestors.has(p); p = by.get(p)?.ppid ?? 0) ancestors.add(p);
  const ours = new Set([process.pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows) if (ours.has(r.ppid) && !ours.has(r.pid)) { ours.add(r.pid); grew = true; }
  }
  // With e, ps adds each process's environment to its command line.
  for (const line of ps(["axeww", "-o", "pid=,command="]).split("\n")) {
    if (!line.includes(root) && !line.includes(realRoot)) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (OURS.has(by.get(pid)?.comm)) ours.add(pid);
  }
  return rows.filter((r) => ours.has(r.pid) && r.pid > 1 && !ancestors.has(r.pid) && !(r.comm === "ps" && r.ppid === process.pid));
}

// The listed processes are paused first (SIGSTOP), and children they forked since the list
// was read are found and paused too, so none can start another unseen; then SIGTERM and
// SIGCONT, and SIGKILL for what is left after about a second. Before the pause and before
// SIGKILL the list is read again and a process is skipped when it is not the one listed: its
// parent and start time must match, before SIGKILL its start time only (its parent may have
// died of the SIGTERM). Start times may differ by a second: lstart has whole seconds, and
// Linux derives it from the boot time, which can move.
function stop(list) {
  const same = (rs, parent) => {
    if (!rs.length) return [];
    const now = new Map(snapshot(rs.map((r) => r.pid)).map((r) => [r.pid, r]));
    return rs.filter((r) => { const n = now.get(r.pid); return n && Math.abs(n.start - r.start) <= 1000 && (!parent || n.ppid === r.ppid); });
  };
  const signal = (rs, sig) => { for (const r of rs) { try { process.kill(r.pid, sig); } catch {} } };
  const held = [];
  let batch = same(list, true);
  for (let round = 0; round < 5 && batch.length; round++) {
    signal(batch, "SIGSTOP");
    held.push(...batch);
    const pids = new Set(held.map((r) => r.pid));
    batch = snapshot().filter((r) => pids.has(r.ppid) && !pids.has(r.pid) && r.pid !== process.pid);
  }
  signal(held, "SIGTERM");
  signal(held, "SIGCONT");
  for (let i = 0; i < 20 && held.some((r) => alive(r.pid)); i++) Bun.sleepSync(50);
  signal(same(held, false), "SIGKILL");
}

let done = false;
function cleanup() {
  if (done) return;
  done = true;
  stop(leftovers());
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
