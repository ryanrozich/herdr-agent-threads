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

// Every ps call has a time limit, so a signal handler cannot hang on one.
const ps = (args) => { try { return execFileSync("ps", args, { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }); } catch { return ""; } };
// A command name's first word without its folder: macOS shows a name set with exec -a whole
// ("codex app-server --listen unix://..."), Linux the program's own name.
const base0 = (comm) => (comm.trim().split(/\s+/)[0] ?? "").split("/").pop();
const names = (pid) => base0(ps(["-o", "comm=", "-p", String(pid)]));

// Each process as { pid, ppid, pgid, start, comm }: lstart is five words ("Mon Nov 17 15:04:01
// 2026"), so the command name is what follows them.
function table(args) {
  const out = [];
  for (const line of ps(args).split("\n")) {
    const w = line.trim().split(/\s+/);
    if (w.length < 8) continue;
    const [pid, ppid, pgid] = w.slice(0, 3).map(Number);
    if (!(pid > 0)) continue;
    out.push({ pid, ppid, pgid, start: w.slice(3, 8).join(" "), comm: base0(w.slice(8).join(" ")) });
  }
  return out;
}
const snapshot = (pids) => table(pids ? ["-o", "pid=,ppid=,pgid=,lstart=,comm=", "-p", pids.join(",")] : ["-A", "-o", "pid=,ppid=,pgid=,lstart=,comm="]);

// Names a process matched only by the run's folder in its environment may have: the shells,
// tools and stand-ins the tests start (codex and opencode are renamed bash, sleep or bun). A
// process the tests did not start (a shared daemon one of them woke) is left alone.
const ENV_ONLY = new Set(["bash", "sh", "dash", "sleep", "bun", "node", "jq", "sqlite3", "codex", "opencode"]);

// The processes this run started that are still alive: its descendants; when bun test leads
// its own process group, orphans in it (a child whose parent was killed first, now owned by
// pid 1); and processes whose command line names the run's folder, or whose environment does
// (every child inherits TMPDIR; Linux shows any process's environment, macOS not a system
// binary's) and whose name is in ENV_ONLY. The preload's own ps calls are left out.
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
  if (by.get(process.pid)?.pgid === process.pid) for (const r of rows) if (r.pgid === process.pid && r.ppid === 1) ours.add(r.pid);
  const named = (line) => line.includes(root) || line.includes(realRoot);
  const pidOf = (line) => Number(line.trim().split(/\s+/)[0]);
  for (const line of ps(["axww", "-o", "pid=,command="]).split("\n")) if (named(line)) ours.add(pidOf(line));
  for (const line of ps(["axeww", "-o", "pid=,command="]).split("\n")) {
    const pid = pidOf(line);
    if (named(line) && !ours.has(pid) && ENV_ONLY.has(by.get(pid)?.comm ?? names(pid))) ours.add(pid);
  }
  return rows.filter((r) => ours.has(r.pid) && r.pid > 1 && !ancestors.has(r.pid) && !(r.comm === "ps" && r.ppid === process.pid));
}

// SIGTERM first, then SIGKILL for what is left after about a second. Before each signal the
// list is read again and a process is skipped when it is not the one listed: before SIGTERM
// its parent and start time must match, before SIGKILL its start time (its parent may have
// died of the SIGTERM).
function stop(list) {
  const same = (keys) => {
    if (!list.length) return [];
    const now = new Map(snapshot(list.map((r) => r.pid)).map((r) => [r.pid, r]));
    return list.filter((r) => { const n = now.get(r.pid); return n && keys.every((k) => n[k] === r[k]); });
  };
  const signal = (rs, sig) => { for (const r of rs) { try { process.kill(r.pid, sig); } catch {} } };
  signal(same(["ppid", "start"]), "SIGTERM");
  for (let i = 0; i < 20 && list.some((r) => alive(r.pid)); i++) Bun.sleepSync(50);
  signal(same(["start"]), "SIGKILL");
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
