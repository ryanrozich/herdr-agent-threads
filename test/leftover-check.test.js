// The leftover check (test/leftover-check.sh) and the run's own cleanup (test/preload.js) find
// what a run left behind without asking ps for any process's environment, and put no other
// process's command line in a file. ps, lsof, sleep and, for the check, bun are stand-ins first
// in the PATH: they record their arguments and print made-up processes, so nothing here reads a
// real process list, command line or environment, not even run against a check that asks for
// one. The only real processes are sleeps these tests start, of 20 s each.
import { test, expect } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECK = join(import.meta.dir, "leftover-check.sh");
const PRELOAD = join(import.meta.dir, "preload.js");
const SH = existsSync("/bin/dash") ? "/bin/dash" : "/bin/sh";
const TIME = 60000;

// A made-up process is one line: pid|ppid|pgid|stat|lstart|comm|args|environment. The pids of
// those with no real process behind them are past any system's highest.
const OLD = "Mon Nov 2 09:00:00 2026";
const NEW = "Tue Nov 3 09:00:00 2026";
const ENV = "MADE_UP_TOKEN=made-up-value";
const OLDER = 99999902;
const OTHER = 99999903;
const older = `${OLDER}|1|${OLDER}|S|${OLD}|old-app|old-app --made-up-word|${ENV}`;
const other = `${OTHER}|1|${OTHER}|S|${NEW}|other-app|other-app --made-up-word|${ENV}`;

function stub(bin, name, body) {
  writeFileSync(join(bin, name), `#!${SH}\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
}

// A folder with the stand-ins in bin, the made-up processes in procs and their working folders
// in cwds (pid|folder), each call in calls, and an empty temp folder for the run (tmp). The call
// whose number is in stop-at prints what it has to, makes the file "at", and stays.
function world() {
  const dir = mkdtempSync(join(tmpdir(), "threads-leftover-"));
  const bin = join(dir, "bin");
  const tmp = join(dir, "tmp");
  mkdirSync(bin);
  mkdirSync(tmp);
  writeFileSync(join(dir, "procs"), `${older}\n`);
  writeFileSync(join(dir, "cwds"), "");
  const called = (name) => `d='${dir}'
{ printf '${name}'; printf '\\t%s' "$@"; echo; } >> "$d/calls"`;
  const stay = `if [ "$(cat "$d/stop-at" 2> /dev/null)" = "$(wc -l < "$d/calls" | tr -d ' ')" ]; then echo > "$d/at"; exec /bin/sleep 20; fi`;
  // As ps does: a word with no dash that holds e, or a dash word that holds E, asks for the
  // environment, which follows the command line.
  stub(bin, "ps", `${called("ps")}
env=0 cols='' only=''
while [ $# -gt 0 ]; do
  case $1 in
    -o) cols=$2; shift ;;
    -p) only=$2; shift ;;
    -*E*) env=1 ;;
    -*) ;;
    *e*) env=1 ;;
  esac
  shift
done
awk -F '|' -v cols="$cols" -v only="$only" -v env="$env" '
  BEGIN {
    k = split("pid ppid pgid stat lstart comm args", name, " ")
    for (i = 1; i <= k; i++) at[name[i]] = i
    at["command"] = at["args"]
    n = split(cols, c, ",")
    for (i = 1; i <= n; i++) sub(/=$/, "", c[i])
  }
  only != "" && index("," only ",", "," $1 ",") == 0 { next }
  {
    line = ""
    for (i = 1; i <= n; i++) {
      v = $(at[c[i]])
      if (env && at[c[i]] == at["args"]) v = v " " $8
      line = line (i > 1 ? " " : "") v
    }
    print line
  }' "$d/procs"
${stay}`);
  stub(bin, "lsof", `${called("lsof")}
only=''
while [ $# -gt 0 ]; do
  case $1 in -p) only=$2; shift ;; esac
  shift
done
awk -F '|' -v only="$only" 'only != "" && index("," only ",", "," $1 ",") == 0 { next } { print "p" $1; print "n" $2 }' "$d/cwds"
${stay}`);
  stub(bin, "sleep", "exit 0");
  return { dir, bin, tmp };
}

const read = (w, name) => (existsSync(join(w.dir, name)) ? readFileSync(join(w.dir, name), "utf8") : "");
const calls = (w) => read(w, "calls").split("\n").filter(Boolean).map((l) => l.split("\t"));
const envOf = (w) => ({ ...process.env, PATH: `${w.bin}:${process.env.PATH}`, TMPDIR: w.tmp });
// The value after a call's option (-o, -p), or "".
const option = (call, name) => (call.includes(name) ? call[call.indexOf(name) + 1] : "");
const asksEnvironment = (call) => {
  let value = false;
  return call.slice(1).some((a) => {
    if (value) { value = false; return false; }
    if (a === "-o" || a === "-p") { value = true; return false; }
    return a.startsWith("-") ? a.includes("E") : a.includes("e");
  });
};
const commandCalls = (w) => calls(w).filter((c) => c[0] === "ps" && /\b(args|command)\b/.test(option(c, "-o")));
const pidsOf = (cs) => cs.flatMap((c) => option(c, "-p").split(",").filter(Boolean).map(Number));

// The check's bun: a run that writes its folder down and starts another app's process, then
// does `more`.
function withRun(w, more = "") {
  stub(w.bin, "bun", `d='${w.dir}'
echo '${other}' >> "$d/procs"
${more}
exit 0`);
  return w;
}
const check = (w) => spawnSync("sh", [CHECK], { env: envOf(w), encoding: "utf8", timeout: 30000 });
// A real sleep the run leaves, in the folder it is started from, with its line in procs.
const leave = (row, after = "") => `/bin/sleep 20 > /dev/null 2>&1 < /dev/null &
echo $! > "$d/left"
echo "$!|${row}|" >> "$d/procs"
${after}`;

// A killed process may stay listed as a zombie where nothing reaps it (Linux, in a container).
function alive(pid) {
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8")); } catch { return true; }
}
async function ends(pid) {
  for (let i = 0; i < 80 && alive(pid); i++) await Bun.sleep(25);
  return !alive(pid);
}
const end = (pid) => { if (pid > 0 && alive(pid)) process.kill(pid, "SIGKILL"); };

const filesHolding = (dir, text) => readdirSync(dir, { recursive: true }).map((f) => join(dir, f)).filter((f) => statSync(f).isFile() && readFileSync(f, "utf8").includes(text));

test("a check killed during any of its listings leaves no file holding a process's environment or another process's command line", async () => {
  const whole = withRun(world());
  const r = check(whole);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("the run left nothing behind");
  const n = calls(whole).length;
  expect(n).toBeGreaterThan(1);
  for (let i = 1; i <= n; i++) {
    const w = withRun(world());
    writeFileSync(join(w.dir, "stop-at"), String(i));
    // A group of its own, so the kill takes the check and the listing it waits for.
    const child = spawn("perl", ["-e", "setpgrp(0, 0); exec @ARGV or exit 127", "sh", CHECK], { env: envOf(w), stdio: "ignore" });
    const ended = new Promise((resolve) => child.on("exit", resolve));
    for (let t = 0; t < 160 && !existsSync(join(w.dir, "at")); t++) await Bun.sleep(25);
    const reached = existsSync(join(w.dir, "at"));
    process.kill(-child.pid, "SIGKILL");
    await ended;
    expect(reached).toBe(true);
    expect(filesHolding(w.tmp, "made-up-value")).toEqual([]);
    expect(filesHolding(w.tmp, "--made-up-word")).toEqual([]);
  }
}, TIME);

test("the check asks ps for no environment", () => {
  const w = withRun(world());
  expect(check(w).status).toBe(0);
  expect(calls(w).filter((c) => c[0] === "ps" && asksEnvironment(c))).toEqual([]);
}, TIME);

test("the check asks for the command line and the working folder only of processes started since the run began", () => {
  const w = withRun(world());
  expect(check(w).status).toBe(0);
  const asked = [...commandCalls(w), ...calls(w).filter((c) => c[0] === "lsof")];
  expect(asked.filter((c) => !option(c, "-p"))).toEqual([]);
  expect(pidsOf(asked)).toContain(OTHER);
  expect(pidsOf(asked)).not.toContain(OLDER);
}, TIME);

for (const [how, row, before, after] of [
  ["the folder in its command line", `1|${OTHER}|S|${NEW}|sleep|sleep 20 $TMPDIR/x`, "cd /", ""],
  ["its working folder in the folder", `1|${OTHER}|S|${NEW}|sleep|sleep 20`, 'cd "$TMPDIR"', 'echo "$!|$TMPDIR" >> "$d/cwds"'],
  ["the run's process group", `1|$$|S|${NEW}|sleep|sleep 20`, "cd /", ""],
]) {
  test(`the check finds and ends a left process by ${how}, and fails`, async () => {
    const w = withRun(world(), `${before}\n${leave(row, after)}`);
    const r = check(w);
    const pid = Number(read(w, "left"));
    try {
      expect(pid).toBeGreaterThan(1);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("the run left these processes running");
      expect(r.stderr).toContain(`${pid} sleep 20`);
      expect(await ends(pid)).toBe(true);
    } finally { end(pid); }
  }, TIME);
}

test("a listing cut off by its time limit fails the check", () => {
  const whole = withRun(world());
  expect(check(whole).status).toBe(0);
  const at = calls(whole).findIndex((c) => c[0] === "ps" && /\b(args|command)\b/.test(option(c, "-o")));
  expect(at).toBeGreaterThan(-1);
  const w = withRun(world());
  writeFileSync(join(w.dir, "stop-at"), String(at + 1));
  const r = check(w);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("ran out of time");
}, TIME);

// A bun test run of its own, with the preload and one test that does `body`: add(line) adds a
// made-up process, and leave(line) starts a real sleep and adds it as <pid>|line.
const PARENT = 99999910;
function run(w, body) {
  const dir = join(w.dir, "tests");
  mkdirSync(dir);
  writeFileSync(join(dir, "bunfig.toml"), `[test]\npreload = [${JSON.stringify(PRELOAD)}]\n`);
  writeFileSync(join(dir, "one.test.js"), `import { test } from "bun:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
const w = ${JSON.stringify(w.dir)};
const run = process.env.TMPDIR;
const add = (line) => appendFileSync(w + "/procs", line + "\\n");
const leave = (line) => {
  const pid = execFileSync("/bin/sh", ["-c", "/bin/sleep 20 > /dev/null 2>&1 < /dev/null & echo $!"], { encoding: "utf8" }).trim();
  writeFileSync(w + "/left", pid);
  add(pid + "|" + line + "|");
};
test("one", () => {
  add("${PARENT}|1|${PARENT}|S|${OLD}|sh|sh|${ENV}");
  add(process.pid + "|${PARENT}|" + process.pid + "|S|${NEW}|bun|bun test|${ENV}");
${body}
});
`);
  const r = spawnSync(process.execPath, ["test", "./one.test.js"], { cwd: dir, env: envOf(w), encoding: "utf8", timeout: 30000 });
  expect(r.status).toBe(0);
  return Number(read(w, "left"));
}

test("a run's own cleanup asks ps for no environment, and for the command line only of processes started since the run began whose name is one the tests start", () => {
  const w = world();
  run(w, `  add("${other}");
  add("99999904|1|99999904|S|${NEW}|sh|sh --made-up-word|${ENV}");
  add("99999905|1|99999905|S|${OLD}|sh|sh --made-up-word|${ENV}");`);
  expect(calls(w).filter((c) => c[0] === "ps").length).toBeGreaterThan(0);
  expect(calls(w).filter((c) => c[0] === "ps" && asksEnvironment(c))).toEqual([]);
  const asked = commandCalls(w);
  expect(asked.filter((c) => !option(c, "-p"))).toEqual([]);
  expect(pidsOf(asked)).toEqual([99999904]);
}, TIME);

test("a run's own cleanup ends an orphan that has the run's folder in its command line", async () => {
  const w = world();
  const pid = run(w, `  leave("1|${OTHER}|S|${NEW}|sleep|sleep 20 " + run + "/x");`);
  try {
    expect(pid).toBeGreaterThan(1);
    expect(await ends(pid)).toBe(true);
  } finally { end(pid); }
}, TIME);

test("a run's own cleanup leaves alone a process with the folder in its command line under a name the tests do not start", () => {
  const w = world();
  const pid = run(w, `  leave("1|${OTHER}|S|${NEW}|editor|editor " + run + "/x");`);
  try {
    expect(pid).toBeGreaterThan(1);
    expect(alive(pid)).toBe(true);
  } finally { end(pid); }
}, TIME);
