// A ticket's run takes stills of the pane in a real Herdr: .catalyst/catalyst.toml installs the
// display packages and runs test/herdr-install.sh (one pinned release, checked against the
// sha256 values committed in it), and test/herdr-still.sh takes the still. A real still needs
// Linux and a display, so these run both scripts with stand-ins on the PATH (curl, uname,
// sha256sum, tar, timeout, Xvfb and a fake Herdr) and start nothing real.
import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const settings = Bun.TOML.parse(readFileSync(join(root, ".catalyst/catalyst.toml"), "utf8"));
const step = settings.environment.setup.find((s) => s.name === "install-herdr");
const install = readFileSync(join(root, "test/herdr-install.sh"), "utf8");
const DISPLAY = ["xvfb", "libgl1", "libegl1", "libgl1-mesa-dri", "mesa-vulkan-drivers", "fonts-dejavu-core", "libxkbcommon0", "libxkbcommon-x11-0"];
const MARK = "install-herdr: Herdr did not install";
const pin = (k) => new RegExp(`^${k}=(\\S+)$`, "m").exec(install)?.[1];

function stub(dir, name, body) {
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(dir, name), 0o755);
}
// GNU timeout's part that matters here: the command in a group of its own, the group ended
// after the limit (STUB_LIMIT seconds in a test, so a hang takes 2 s), and 124; a TERM to it
// ends the command too.
const TIMEOUT = `[ "$1" = -k ] && shift 2
lim=\${STUB_LIMIT:-$1}; shift
exec perl -e 'my $l = shift; my $p = fork; if (!$p) { setpgrp(0, 0); exec @ARGV or exit 127 } $SIG{TERM} = sub { kill "KILL", -$p; waitpid($p, 0); exit 143 }; $SIG{ALRM} = sub { kill "TERM", -$p; select(undef, undef, undef, 0.3); kill "KILL", -$p; waitpid($p, 0); exit 124 }; alarm $l; waitpid($p, 0); exit($? >> 8)' "$lim" "$@"`;

test("the settings: the display packages, one setup step that runs the pinned install within its limit and never fails a phase", () => {
  const pk = settings.environment.system_packages.map((p) => p.name);
  for (const n of DISPLAY) expect(pk).toContain(n);
  expect(step.run.slice(0, 2)).toEqual(["sh", "-c"]);
  const cmd = step.run[2];
  expect(cmd.startsWith("timeout -k 5 280 sh test/herdr-install.sh;")).toBe(true);
  expect(280 + 5).toBeLessThan(step.timeout_seconds);
  expect(cmd.endsWith("; exit 0")).toBe(true);
  expect(cmd).toContain(MARK);
  // The step downloads nothing itself and pipes nothing into a shell.
  expect(cmd).not.toMatch(/curl|wget|\| *(ba|da)?sh\b/);
  expect(settings.environment.container.egress).toEqual(["releases.herdr.dev"]);
  // No setup step starts the display: the still script does, inside its own command.
  for (const s of settings.environment.setup) expect(s.run.join(" ")).not.toMatch(/Xvfb|xvfb-run|DISPLAY=/);
});

test("the install pins one release, and every download it makes is checked against a committed sha256 before anything uses it", () => {
  expect(pin("APP_VERSION")).toMatch(/^\d+\.\d+\.\d+$/);
  expect(pin("CORE_VERSION")).toMatch(/^\d+\.\d+\.\d+$/);
  for (const k of ["APP_SHA256_X86_64", "APP_SHA256_AARCH64", "CORE_SHA256_X86_64", "CORE_SHA256_AARCH64"]) expect(pin(k)).toMatch(/^[0-9a-f]{64}$/);
  // No installer script, no latest manifest, nothing piped into a shell.
  expect(install).not.toMatch(/install\.sh|latest\.json|\| *(ba|da)?sh\b|wget/);
  // curl only inside fetch(), with a time limit; each fetch's next line checks that file.
  const lines = install.split("\n");
  expect(lines.filter((l) => /\bcurl\b/.test(l) && !/^\s*#/.test(l) && !/command -v/.test(l) && !/for c in/.test(l))).toEqual([expect.stringMatching(/^fetch\(\) \{ curl .*--max-time "\$3" -o "\$2" "\$1"/)]);
  // https only, and no redirect to another host: curl fails on one.
  expect(install).toMatch(/^fetch\(\) \{ curl -fsSL --proto =https --proto-redir =https --max-redirs 0 /m);
  const fetches = lines.map((l, i) => [l, i]).filter(([l]) => /^fetch "/.test(l));
  expect(fetches.length).toBe(2);
  for (const [l, i] of fetches) {
    const file = /^fetch "[^"]+" ("[^"]+")/.exec(l)[1];
    expect(lines[i + 1].startsWith(`check ${file} `)).toBe(true);
  }
  // Nothing is unpacked before both checks.
  const lastCheck = Math.max(...fetches.map(([, i]) => i + 1));
  expect(lines.findIndex((l) => /\btar -x/.test(l))).toBeGreaterThan(lastCheck);
});

// The setup step's own command, run in a copy of the two scripts, with stand-ins. "__CO__" in
// an env value is that copy's path and "__D__" the folder around it; pre(co, d) runs first.
function runStep(curl, { sums = null, tar = null, env = {}, pre = null } = {}) {
  const d = mkdtempSync(join(tmpdir(), "herdr-step-"));
  const bin = join(d, "bin");
  const co = join(d, "co");
  mkdirSync(bin);
  mkdirSync(join(co, "test"), { recursive: true });
  writeFileSync(join(co, "test/herdr-install.sh"), install);
  stub(bin, "uname", 'case $1 in -s) echo Linux ;; -m) echo x86_64 ;; *) echo Linux ;; esac');
  stub(bin, "curl", `echo "$*" >> "${d}/curl.log"\n${curl}`);
  stub(bin, "timeout", TIMEOUT);
  stub(bin, "sha256sum", sums ? `case $1 in *app*) echo "${sums.app}  $1" ;; *) echo "${sums.core}  $1" ;; esac` : 'shasum -a 256 "$1"');
  if (tar) stub(bin, "tar", tar);
  if (pre) pre(co, d);
  const r = spawnSync("sh", ["-c", step.run[2]], { cwd: co, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LIMIT: "2", ...Object.fromEntries(Object.entries(env).map(([k, x]) => [k, x.replace("__CO__", co).replace("__D__", d)])) } });
  const curlLog = existsSync(join(d, "curl.log")) ? readFileSync(join(d, "curl.log"), "utf8") : "";
  return { ...r, d, co, curlLog, marks: r.stderr.split("\n").filter((l) => l.startsWith(MARK)) };
}
const out = 'url=$*; while [ $# -gt 0 ]; do [ "$1" = -o ] && o=$2; shift; done';

test("the setup step when the release server refuses, hangs, sends the wrong bytes or the archive does not unpack: one marker line, nothing installed, exit 0", () => {
  // Refuses: curl's own failure reaches the marker.
  let r = runStep("exit 7");
  expect([r.status, r.marks.length]).toEqual([0, 1]);
  expect(r.marks[0]).toContain("download failed: https://releases.herdr.dev/app/");
  expect(existsSync(join(r.co, ".herdr-rig/bin"))).toBe(false);
  // Every download has a connect limit and a total limit, and asks for the pinned version.
  expect(r.curlLog).toMatch(/--connect-timeout 20 --max-time 150 -o \S+ https:\/\/releases\.herdr\.dev\/app\/0\.\d+\.\d+\/herdr-app-linux-x86_64\.tar\.gz/);
  // Hangs: the step's time limit (2 s here, 280 s for real) ends the install; still exit 0.
  r = runStep("exec sleep 30");
  expect([r.status, r.marks.length]).toEqual([0, 1]);
  expect(r.marks[0]).toContain("ended with status 124");
  expect(existsSync(join(r.co, ".herdr-rig/bin"))).toBe(false);
  // The wrong bytes: the checksum refuses them before anything is unpacked.
  r = runStep(`${out}\necho not-herdr > "$o"`);
  expect([r.status, r.marks.length]).toEqual([0, 1]);
  expect(r.marks[0]).toContain(`checksum mismatch for herdr-app ${pin("APP_VERSION")}`);
  expect(r.curlLog.split("\n").filter(Boolean).length).toBe(1);
  expect(existsSync(join(r.co, ".herdr-rig/bin"))).toBe(false);
  expect(existsSync(join(r.co, ".herdr-rig/.download"))).toBe(false);
  // Checked, but the install stops on its own (an archive that does not unpack).
  r = runStep(`${out}\necho bytes > "$o"`, { sums: { app: pin("APP_SHA256_X86_64"), core: pin("CORE_SHA256_X86_64") }, tar: "exit 2" });
  expect([r.status, r.marks.length]).toEqual([0, 1]);
  expect(r.marks[0]).toContain("an archive did not unpack");
  expect(existsSync(join(r.co, ".herdr-rig/bin"))).toBe(false);
  // The whole digest is compared: the pin's first 8 or first 63 characters are not enough.
  const app = pin("APP_SHA256_X86_64");
  for (const near of [`${app.slice(0, 8)}${"0".repeat(56)}`, `${app.slice(0, 63)}${app.endsWith("0") ? "1" : "0"}`]) {
    r = runStep(`${out}\necho bytes > "$o"`, { sums: { app: near, core: pin("CORE_SHA256_X86_64") } });
    expect([r.status, r.marks.length]).toEqual([0, 1]);
    expect(r.marks[0]).toContain(`checksum mismatch for herdr-app ${pin("APP_VERSION")}`);
    expect(existsSync(join(r.co, ".herdr-rig/bin"))).toBe(false);
  }
}, 30000);

test("the install refuses a HERDR_RIG outside the checkout, the checkout itself or one with a . or .. step, before it downloads anything", () => {
  for (const [rig, why] of [["/elsewhere/rig", "outside this checkout"], ["../rig", ". or .. step"], ["sub/../../rig", ". or .. step"], [".", ". or .. step"], ["./", ". or .. step"]]) {
    const r = runStep("exit 7", { env: { HERDR_RIG: rig } });
    expect([rig, r.status, r.marks.length, r.curlLog]).toEqual([rig, 0, 1, ""]);
    expect(r.marks[0]).toContain(why);
  }
  // The checkout itself is refused too: only a folder under it is allowed.
  for (const rig of ["__CO__", "__CO__/"]) {
    const r = runStep("exit 7", { env: { HERDR_RIG: rig } });
    expect([rig, r.status, r.marks.length, r.curlLog]).toEqual([rig, 0, 1, ""]);
    expect(r.marks[0]).toContain("outside this checkout");
  }
  // A folder inside, relative or absolute, gets as far as the download.
  for (const rig of ["sub/rig", ".herdr-rig", "__CO__/deep/rig"]) {
    const r = runStep("exit 7", { env: { HERDR_RIG: rig } });
    expect([rig, r.marks.length]).toEqual([rig, 1]);
    expect(r.marks[0]).toContain("download failed");
  }
  // Paths are compared physically, as on a Mac, where the temp folder is under a link: the
  // checkout reached through a link is inside, and a link inside it that points out is not.
  const links = (co, d) => { symlinkSync(co, join(d, "co-link")); mkdirSync(join(d, "elsewhere")); symlinkSync(join(d, "elsewhere"), join(co, "out")); };
  let r = runStep("exit 7", { env: { HERDR_RIG: "__D__/co-link/deep/rig" }, pre: links });
  expect(r.marks[0]).toContain("download failed");
  for (const rig of ["out/rig", "__CO__/out/rig", "__D__/co-link/out/rig"]) {
    r = runStep("exit 7", { env: { HERDR_RIG: rig }, pre: links });
    expect([rig, r.status, r.marks.length, r.curlLog]).toEqual([rig, 0, 1, ""]);
    expect(r.marks[0]).toContain("outside this checkout");
  }
});

test("the setup step installs the pinned archives once both checksums match", () => {
  // Two small archives in the release layout, made here; the checksum stand-in names them by
  // the pinned values, as the release's real bytes would.
  const src = mkdtempSync(join(tmpdir(), "herdr-arc-"));
  mkdirSync(join(src, "a/herdr-app"), { recursive: true });
  mkdirSync(join(src, "c"));
  writeFileSync(join(src, "a/herdr-app/herdr-app"), "#!/bin/sh\necho herdr-app 0.1.16\n");
  writeFileSync(join(src, "c/herdr-core"), "#!/bin/sh\necho hc 0.1.21\n");
  spawnSync("tar", ["-czf", join(src, "app.tgz"), "-C", join(src, "a"), "herdr-app"]);
  spawnSync("tar", ["-czf", join(src, "core.tgz"), "-C", join(src, "c"), "herdr-core"]);
  const r = runStep(`${out}\ncase "$url" in *herdr-app-linux*) cp "${src}/app.tgz" "$o" ;; *) cp "${src}/core.tgz" "$o" ;; esac`,
    { sums: { app: pin("APP_SHA256_X86_64"), core: pin("CORE_SHA256_X86_64") } });
  expect([r.status, r.marks]).toEqual([0, []]);
  expect(r.stderr).toContain(`install-herdr: Herdr ${pin("APP_VERSION")} and core ${pin("CORE_VERSION")} (x86_64) in `);
  const rig = join(r.co, ".herdr-rig");
  expect(spawnSync(join(rig, "bin/herdr-app"), [], { encoding: "utf8" }).stdout).toBe("herdr-app 0.1.16\n");
  expect(spawnSync(join(rig, "bin/hc"), [], { encoding: "utf8" }).stdout).toBe("hc 0.1.21\n");
  expect(readFileSync(join(rig, "VERSION"), "utf8")).toBe(`herdr-app ${pin("APP_VERSION")}\nherdr-core ${pin("CORE_VERSION")}\n`);
  expect(existsSync(join(rig, ".download"))).toBe(false);
});

// The still script with a fake Herdr in the rig (and timeout, which the app's clean PATH finds
// there), and Xvfb and uname stand-ins on the script's own PATH. HERDR_STILL_X11 is where the
// stand-in display puts its socket, in place of /tmp/.X11-unix.
function fakeRig() {
  const d = mkdtempSync(join(tmpdir(), "herdr-still-"));
  const rig = join(d, "rig");
  const bin = join(d, "bin");
  mkdirSync(join(rig, "bin"), { recursive: true });
  mkdirSync(bin);
  mkdirSync(join(d, "x11"));
  stub(join(rig, "bin"), "timeout", TIMEOUT);
  stub(join(rig, "bin"), "herdr-core", "exit 0");
  stub(join(rig, "bin"), "herdr-app", `log=${JSON.stringify(join(d, "app.log"))}
if { : >&3; } 2> /dev/null; then echo "fd 3 open: $*" >> ${JSON.stringify(join(d, "fd3.log"))}; fi
[ $# -eq 0 ] && { env > ${JSON.stringify(join(d, "launch-env.txt"))}; exec sleep 30; }
echo "$*" >> "$log"
case "$1 $2" in
  "--version "*) echo "herdr-app 0.1.16" ;;
  "status "*) [ -e ${JSON.stringify(join(d, "hang"))} ] && exec perl -e 'sleep 60' ${JSON.stringify(`hang-${d}`)}; echo '{"overlays":[],"errors":[]}' ;;
  "ls "*) echo '{"spaces":[{"name":"still","tabs":[{"terminals":[{"pane":"p1","terminal":"t1"}]}]}]}' ;;
  "do pane.split") echo '{"pane":"p2"}' ;;
  # As the real Herdr 0.1.16 does: any <mod>.<name> is ok, exit 0, known to the mod or not.
  # The stand-in mod reports each one in its debug report the way main.js command() does:
  # acted true for pin, false for anything else; "agent-threads.mute" it never reports.
  "do agent-threads."*)
    echo '{"ok":true}'
    c=\${2#agent-threads.}
    [ "$c" = mute ] && exit 0
    n=$(( $(cat ${JSON.stringify(join(d, "cmd.n"))} 2> /dev/null || echo 0) + 1 )); echo $n > ${JSON.stringify(join(d, "cmd.n"))}
    a=false; [ "$c" = pin ] && a=true
    printf '{"frame.welcomed":"skipped","threads.debug":{"t1":{"command":{"n":%s,"name":"%s","acted":%s}}}}\n' $n "$c" $a > "$HERDR_APP_HOME/shared.json" ;;
  "do no.such.thing") echo '{"error":"unknown command \\"no.such.thing\\""}'; exit 1 ;;
  "shot "*) echo png > "$2" ;;
esac
exit 0`);
  stub(bin, "uname", 'echo "${STUB_OS:-Linux}"');
  stub(bin, "Xvfb", `touch "$HERDR_STILL_X11/X\${1#:}"; exec sleep 30`);
  return { d, rig, bin };
}
function still(args, f, env = {}) {
  return spawnSync("sh", [join(root, "test/herdr-still.sh"), ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, HERDR_RIG: f.rig, HERDR_STILL_X11: join(f.d, "x11"), ...env },
  });
}
const fx = join(root, "test/fixtures/session.jsonl");

test("herdr-still.sh refuses bad arguments, a machine that is not Linux, a missing transcript and a missing Herdr, each with its own exit, before it starts anything", () => {
  const f = fakeRig();
  for (const a of [[], [fx, "x.png", "--theme", "blue"], [fx, "x.png", "--px"], [fx, "x.png", "--size", "big"]]) expect(still(a, f).status).toBe(2);
  let r = still([fx, "x.png"], f, { STUB_OS: "Darwin" });
  expect([r.status, r.stderr]).toEqual([2, "herdr-still: Linux only (this is Darwin)\n"]);
  r = still([join(root, "test/fixtures/none.jsonl"), "x.png"], f);
  expect([r.status, r.stderr]).toEqual([1, `herdr-still: no transcript at ${join(root, "test/fixtures/none.jsonl")}\n`]);
  r = still([fx, "x.png"], { ...f, rig: join(f.d, "no-rig") });
  expect(r.status).toBe(3);
  expect(r.stderr).toContain("herdr-still: no Herdr installed at ");
  expect(existsSync(join(f.d, "app.log"))).toBe(false);
});

test("herdr-still.sh gives the app a clean environment: its own home, XDG folders, temp folder and display, no Wayland, no session bus, nothing else from the caller", () => {
  const f = fakeRig();
  const r = still([fx, "x.png"], f, { HERDR_STILL_SHOW_ENV: "1", WAYLAND_DISPLAY: "wayland-0", DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/bus", XDG_CONFIG_HOME: "/home/someone/.config", DISPLAY: ":0", LEAK_CHECK: "1", GH_TOKEN: "x" });
  expect(r.status).toBe(0);
  const env = Object.fromEntries(r.stdout.trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  expect(Object.keys(env).sort()).toEqual(["ALL_PROXY", "DISPLAY", "DO_NOT_TRACK", "HC_SESSION", "HERDR_APP_HOME", "HERDR_TELEMETRY", "HOME", "HTTPS_PROXY", "HTTP_PROXY", "LANG", "NO_PROXY", "PATH", "TMPDIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME"]);
  const home = env.HOME;
  expect(home).toMatch(/\/herdr-still\.[A-Za-z0-9]+$/);
  for (const k of ["TMPDIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "HERDR_APP_HOME"]) expect(env[k].startsWith(`${home}/`)).toBe(true);
  expect(env.DISPLAY).toBe(":99");
  expect(env.PATH.startsWith(`${f.rig}/bin:`)).toBe(true);
  expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:9");
  // The folder it made for this is gone.
  expect(existsSync(home)).toBe(false);
});

test("herdr-still.sh with a fake Herdr: a still after its --do commands, and a failed --do command is a non-zero exit with no still", () => {
  const f = fakeRig();
  const png = join(f.d, "s.png");
  let r = still([fx, png, "--do", "agent-threads.pin"], f);
  expect([r.status, r.stderr]).toEqual([0, ""]);
  expect(r.stdout).toBe(`${png}\n`);
  expect(readFileSync(png, "utf8")).toBe("png\n");
  const calls = readFileSync(join(f.d, "app.log"), "utf8");
  expect(calls).toContain("do agent-threads.pin\n");
  expect(calls.indexOf("do agent-threads.pin")).toBeLessThan(calls.indexOf("shot "));
  // The app started with the clean environment, and the display it was given.
  const launch = readFileSync(join(f.d, "launch-env.txt"), "utf8");
  expect(launch).toContain("DISPLAY=:99\n");
  expect(launch).not.toMatch(/WAYLAND_DISPLAY|DBUS_SESSION/);
  // A mod command the mod does not act on (Herdr itself answers ok and exits 0 for any
  // agent-threads.<name>, as on the runner image): named, exit 1, no still.
  const png2 = join(f.d, "s2.png");
  r = still([fx, png2, "--do", "agent-threads.nope", "--do", "agent-threads.pin"], f);
  expect(r.status).toBe(1);
  expect(r.stderr).toBe("herdr-still: --do agent-threads.nope: the mod did not act on it (not one of its commands, or nothing to do)\n");
  expect(existsSync(png2)).toBe(false);
  // One the pane never reports: exit 1, no still.
  const png3 = join(f.d, "s3.png");
  r = still([fx, png3, "--do", "agent-threads.mute"], f);
  expect(r.status).toBe(1);
  expect(r.stderr).toBe("herdr-still: --do agent-threads.mute: the Threads pane did not report it\n");
  expect(existsSync(png3)).toBe(false);
  // A Herdr command that does not exist fails in Herdr: its reply is named, exit 1, no still.
  const png4 = join(f.d, "s4.png");
  r = still([fx, png4, "--do", "no.such.thing"], f);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("herdr-still: --do no.such.thing failed: ");
  expect(r.stderr).toContain("unknown command");
  expect(existsSync(png4)).toBe(false);
  // The deadline's message goes to the script's own stderr on fd 3; no Herdr process,
  // the app included, is given fd 3.
  expect(calls.length).toBeGreaterThan(0);
  expect(existsSync(join(f.d, "fd3.log")) ? readFileSync(join(f.d, "fd3.log"), "utf8") : "").toBe("");
}, 30000);

test("herdr-still.sh has one deadline for the whole run: a Herdr call that hangs ends there, with exit 4, its own line and no still", () => {
  const f = fakeRig();
  writeFileSync(join(f.d, "hang"), "");
  const png = join(f.d, "s.png");
  const t0 = Date.now();
  const r = still([fx, png], f, { HERDR_STILL_DEADLINE: "3" });
  const took = (Date.now() - t0) / 1000;
  expect([r.status, r.stderr]).toEqual([4, "herdr-still: the run passed its 3 s deadline\n"]);
  // The hung call (its own limit is 30 s) did not hold the run past the deadline.
  expect(took).toBeLessThan(12);
  expect(existsSync(png)).toBe(false);
  // The hung call itself is gone: the call's subshell execs, so the pid the deadline signals is
  // the timeout process, which ends the call. (On Linux the cleanup's sweep of processes
  // holding the run's folder would also end it, so the text check below pins the exec there.)
  const gone = () => spawnSync("pgrep", ["-f", `hang-${f.d}`]).status === 1;
  for (let i = 0; i < 30 && !gone(); i++) spawnSync("sleep", ["0.1"]);
  expect(gone()).toBe(true);
  expect(readFileSync(join(root, "test/herdr-still.sh"), "utf8")).toMatch(/^ {2}\(X="exec"; appenv timeout -k 5 30 "\$APP" "\$@"\) &$/m);
  // A deadline that is not a number of seconds is a usage error.
  expect(still([fx, png], f, { HERDR_STILL_DEADLINE: "soon" }).status).toBe(2);
}, 30000);
