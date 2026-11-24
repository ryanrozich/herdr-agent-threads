// bun test preload (bunfig.toml): the whole run keeps its temp files in one fresh folder,
// threads-run-<pid>-XXXXXX under the temp folder it was started with. TMPDIR points there
// before any test loads, so every mkdtempSync(join(tmpdir(), ...)) in the tests, and every
// mktemp in the scripts they run, lands inside it. When the run ends (passed, failed, or
// stopped by SIGINT, SIGTERM or SIGHUP) the processes it started that are still alive are
// stopped and the folder is removed. A run killed outright (SIGKILL) leaves its folder; a
// later run removes it once its pid is gone and it is over an hour old.
import { afterAll, beforeEach } from "bun:test";
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
// 2026"), read as a time in ms, so the command name is what follows them. A row whose start
// does not parse is left out and counted; the cleanup reports the count.
let unread = 0;
function table(args) {
  const out = [];
  for (const line of ps(args).split("\n")) {
    const w = line.trim().split(/\s+/);
    const [pid, ppid] = w.slice(0, 2).map(Number);
    if (!(pid > 0)) continue;
    const start = w.length >= 7 ? Date.parse(w.slice(2, 7).join(" ")) : Number.NaN;
    if (Number.isFinite(start)) out.push({ pid, ppid, start, comm: base0(w.slice(7).join(" ")) });
    else unread++;
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

// SIGTERM, up to a second's wait, then SIGKILL for what is left. The list is read again first
// (one ps over every process): a process is skipped when its parent or start time changed,
// and children the listed processes started since the list was made are added. Before
// SIGKILL a second scan adds children the survivors started meanwhile (they get SIGTERM and
// the same wait), and each process's start time is checked again (its parent may have died
// of the SIGTERM). Start times may differ by a second: lstart has whole seconds, and Linux
// derives it from the boot time, which can move.
function stop(list) {
  if (!list.length) return;
  const signal = (rs, sig) => { for (const r of rs) { try { process.kill(r.pid, sig); } catch {} } };
  const wait = (rs) => { for (let i = 0; i < 20 && rs.some((r) => alive(r.pid)); i++) Bun.sleepSync(50); };
  const sameStart = (a, b) => Math.abs(a.start - b.start) <= 1000;
  // Children (and theirs) of the given processes in this snapshot that are not in it yet.
  const children = (rows, of) => {
    const pids = new Set(of.map((r) => r.pid));
    const out = [];
    for (let grew = true; grew;) {
      grew = false;
      for (const r of rows) if (pids.has(r.ppid) && !pids.has(r.pid) && r.pid !== process.pid && !(r.comm === "ps" && r.ppid === process.pid)) { pids.add(r.pid); out.push(r); grew = true; }
    }
    return out;
  };
  let rows = snapshot();
  const now = new Map(rows.map((r) => [r.pid, r]));
  const sent = list.filter((r) => { const n = now.get(r.pid); return n && n.ppid === r.ppid && sameStart(n, r); });
  sent.push(...children(rows, sent));
  signal(sent, "SIGTERM");
  wait(sent);
  rows = snapshot();
  const late = children(rows, sent.filter((r) => alive(r.pid)));
  if (late.length) { signal(late, "SIGTERM"); wait(late); sent.push(...late); rows = snapshot(); }
  const still = new Map(rows.map((r) => [r.pid, r]));
  signal(sent.filter((r) => still.has(r.pid) && sameStart(still.get(r.pid), r)), "SIGKILL");
}

let done = false;
function cleanup() {
  if (done) return;
  done = true;
  stop(leftovers());
  try { rmSync(root, { recursive: true, force: true }); } catch {}
  if (unread) console.error(`preload: ${unread} ps rows had a start time this file could not read; those processes were not checked`);
}

// bun test does not fire process "exit"; an afterAll in a preload runs once, after every file.
afterAll(cleanup);

// Once test/render-harness.js is loaded it sets a hook that puts every setting a test can
// write back to its start before each test (the pins and settings records, the logs, the
// panes). A global hook reaches every test file; one set by the harness would bind to a
// single file.
beforeEach(() => globalThis.__threadsHarnessEachTest?.());
for (const [sig, n] of [["SIGINT", 2], ["SIGTERM", 15], ["SIGHUP", 1]]) {
  process.on(sig, () => { cleanup(); process.exit(128 + n); });
}

// A bun test that a test runs (render.test.js's timing child) ends with the run that started
// it: if its parent goes away, it cleans up and exits.
if (parentRun) {
  const parent = process.ppid;
  setInterval(() => { if (process.ppid !== parent) { cleanup(); process.exit(1); } }, 500).unref();
}
