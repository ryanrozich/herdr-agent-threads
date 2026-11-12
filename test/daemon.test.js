// bun test: sessions another process holds. Plain codex runs its session in Codex's app-server
// daemon (codex --no-daemon keeps it in the terminal's process), claude attach opens a claude
// --bg session, and opencode attach uses a server's sessions. Synthetic paths and ids only; the
// stand-in processes are sleep and bun, renamed with exec -a.
import { test, expect } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickCodexDaemon, claudeAttach, opencodeAttach } from "../mods/agent-threads/harness.js";

const root = join(import.meta.dir, "..");
const locator = join(root, "mods/agent-threads/locate.sh");
const oc = join(root, "mods/agent-threads/opencode.sh");
const ID = "00000000-0000-4000-8000-0000000000d1";
const ID2 = "00000000-0000-4000-8000-0000000000d2";
const SUB = "00000000-0000-4000-8000-0000000000d3";
const tmp = (p) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (args, env = {}) => {
  try { return execFileSync("sh", args, { encoding: "utf8", env: { ...process.env, ...env } }).trim(); } catch { return null; }
};

// A rollout whose first line is the session_meta Codex writes.
function rollout(dir, id, cwd, ts, extra = {}) {
  const f = join(dir, `rollout-2026-11-12T09-25-46-${id}.jsonl`);
  writeFileSync(f, `${JSON.stringify({ timestamp: ts, type: "session_meta", payload: { id, timestamp: ts, cwd, ...extra } })}\n`);
  return f;
}

// A process that holds the files open on fds 3, 4, ..., named argv0.
function holder(files, argv0, cwd) {
  const opens = files.map((f, i) => `exec ${i + 3}<"${f}"`).join("; ");
  return spawn("bash", ["-c", `${opens}; exec -a "${argv0}" sleep 30`], { cwd, stdio: "ignore" });
}

test("pickCodexDaemon: the folder's main session that began after the process, newest written", () => {
  const start = Date.parse("2026-11-12T15:25:00Z");
  const f = (id, cwd, ts, mtime, sub = false) => ({ path: `/s/rollout-x-${id}.jsonl`, cwd, ts, mtime, sub });
  const mine = f(ID, "/home/dev/shop", "2026-11-12T15:25:46Z", 3000);
  const files = [
    mine,
    f(SUB, "/home/dev/shop", "2026-11-12T15:26:00Z", 9000, true), // a subagent's thread
    f(ID2, "/home/dev/other", "2026-11-12T15:27:00Z", 8000), // another folder
    f("old", "/home/dev/shop", "2026-11-10T09:00:00Z", 7000), // began before the process
  ];
  expect(pickCodexDaemon(files, ["/home/dev/shop"], start)).toEqual({ file: mine.path, guess: false, choices: [] });
  // The 5 s allowance for the clocks.
  expect(pickCodexDaemon([mine], ["/home/dev/shop"], Date.parse("2026-11-12T15:25:50Z")).file).toBe(mine.path);
  // After /new: the newer session, still exact while no other Codex runs in the folder.
  const next = f(ID2, "/home/dev/shop", "2026-11-12T15:40:00Z", 5000);
  expect(pickCodexDaemon([...files, next], ["/home/dev/shop"], start)).toEqual({ file: next.path, guess: false, choices: [] });
  // A second Codex terminal in the folder: a guess, with both to choose from, newest first.
  const two = pickCodexDaemon([...files, next], ["/home/dev/shop"], start, 1);
  expect(two.guess).toBe(true);
  expect(two.file).toBe(next.path);
  expect(two.choices.map((c) => c.path)).toEqual([next.path, mine.path]);
  // None began after the process (codex resume --last): the folder's newest written, a guess.
  const resumed = pickCodexDaemon(files, ["/home/dev/shop"], Date.parse("2026-11-12T16:00:00Z"));
  expect(resumed.guess).toBe(true);
  expect(resumed.file).toBe("/s/rollout-x-old.jsonl");
  expect(resumed.choices.map((c) => c.path)).toEqual(["/s/rollout-x-old.jsonl", mine.path]);
  // Nothing in the folder, or nothing held.
  expect(pickCodexDaemon(files, ["/home/dev/none"], start)).toEqual({ file: null, guess: false, choices: [] });
  expect(pickCodexDaemon([], ["/home/dev/shop"], start).file).toBe(null);
  // Either spelling of the folder (/tmp and /private/tmp on macOS).
  expect(pickCodexDaemon([f(ID, "/private/tmp/shop", "2026-11-12T15:25:46Z", 1)], ["/tmp/shop", "/private/tmp/shop"], start).file).toBe(`/s/rollout-x-${ID}.jsonl`);
});

test("claudeAttach and opencodeAttach read the command line", () => {
  expect(claudeAttach(["claude", "attach", "ced9fc4f"])).toBe("ced9fc4f");
  expect(claudeAttach(["claude", "attach", "review"])).toBe("review");
  expect(claudeAttach(["claude", "attach"])).toBe(null);
  expect(claudeAttach(["claude", "--resume", ID])).toBe(null);
  expect(claudeAttach(["claude", "-p", "please attach the file", "attach"])).toBe(null);
  expect(opencodeAttach(["opencode", "attach", "http://127.0.0.1:4096"])).toEqual({ url: "http://127.0.0.1:4096", dir: null, port: 4096, local: true });
  expect(opencodeAttach(["opencode", "attach", "http://localhost:4096", "--dir", "/home/dev/shop", "-s", "ses_1"]).dir).toBe("/home/dev/shop");
  expect(opencodeAttach(["opencode", "attach", "--dir=/home/dev/shop", "https://box.example:8443"])).toEqual({ url: "https://box.example:8443", dir: "/home/dev/shop", port: 8443, local: false });
  expect(opencodeAttach(["opencode"])).toBe(null);
  expect(opencodeAttach(["opencode", "attach"])).toBe(null);
});

test("locate.sh finds a Codex session in either mode: held by the terminal's process or by the daemon", async () => {
  const sessions = tmp("threads-codex-held-");
  const cwd = "/home/dev/shop";
  const mine = rollout(sessions, ID, cwd, "2026-11-12T15:25:46Z");
  const sub = rollout(sessions, SUB, cwd, "2026-11-12T15:26:00Z", { source: { subagent: { thread_spawn: {} } } });
  // codex --no-daemon: the terminal's own process holds the file (codex-open, as before).
  const own = holder([mine, sub], "codex --no-daemon", sessions);
  // Plain codex: the daemon holds it, and the terminal's process holds none.
  const daemon = holder([mine, sub], "codex app-server --listen unix:// --managed-daemon", sessions);
  const loop = holder([], "codex app-server daemon pid-update-loop", sessions);
  const client = holder([], "codex", sessions);
  try {
    await wait(400);
    expect(run([locator, "codex-open", String(own.pid)])).toBe(mine);
    expect(run([locator, "codex-open", String(client.pid)])).toBeFalsy();
    // The daemons, found by their command line; the pid-update loop is not one.
    const pids = (run([locator, "codex-daemons"]) ?? "").split("\n");
    expect(pids).toContain(String(daemon.pid));
    expect(pids).not.toContain(String(loop.pid));
    expect(pids).not.toContain(String(client.pid));
    // The files the daemon holds, each with its folder and start (only this daemon here).
    const lines = (run([locator, "codex-daemon"], { THREADS_CODEX_DAEMONS: String(daemon.pid) }) ?? "").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(lines.map((l) => [l.path, l.cwd, l.ts, l.sub]).sort()).toEqual([[mine, cwd, "2026-11-12T15:25:46Z", false], [sub, cwd, "2026-11-12T15:26:00Z", true]].sort());
    expect(lines.every((l) => l.mtime > 0)).toBe(true);
    expect(pickCodexDaemon(lines, [cwd], Date.parse("2026-11-12T15:25:00Z")).file).toBe(mine);
    // A daemon that holds nothing.
    expect(run([locator, "codex-daemon"], { THREADS_CODEX_DAEMONS: String(loop.pid) })).toBe(null);
    // Peers: the other plain codex in the folder counts; the app servers do not.
    expect(run([locator, "codex-peers", String(own.pid), sessions])).toBe("0");
  } finally {
    for (const p of [own, daemon, loop, client]) p.kill();
  }
});

test("locate.sh claude-bg names the session of a claude --bg record, by id start or name", () => {
  const dir = tmp("threads-claude-sessions-");
  writeFileSync(join(dir, "41355.json"), JSON.stringify({ pid: 41355, kind: "bg", sessionId: ID, name: "Review the cart", cwd: "/home/dev/shop" }));
  const OTHER = "00000000-0000-4000-8000-0000000000d4";
  writeFileSync(join(dir, "41400.json"), JSON.stringify({ pid: 41400, kind: "interactive", sessionId: OTHER, name: "review" }));
  mkdirSync(join(dir, "sub"));
  expect(run([locator, "claude-bg", dir, ID.slice(0, 8)])).toBe(ID);
  expect(run([locator, "claude-bg", dir, "cart"])).toBe(ID);
  // Only background sessions: the interactive record's id does not count.
  expect(run([locator, "claude-bg", dir, OTHER])).toBe(null);
  expect(run([locator, "claude-bg", dir, "nothing-like-it"])).toBe(null);
  expect(run([locator, "claude-bg", dir, ""])).toBe(null);
});

test("opencode.sh server-dir names the folder of the local OpenCode server on a port", async () => {
  const dir = tmp("threads-oc-server-");
  const port = 47000 + Math.floor(Math.random() * 900);
  const bun = process.execPath;
  const server = spawn("bash", ["-c", `exec -a "opencode serve --port ${port}" "${bun}" -e 'Bun.serve({ port: ${port}, fetch: () => new Response("") }); setTimeout(() => {}, 30000)'`], { cwd: dir, stdio: "ignore" });
  try {
    let out = null;
    for (let k = 0; k < 30 && !out; k++) { await wait(200); out = run([oc, "server-dir", String(port)]); }
    expect(out).toBe(dir);
    expect(run([oc, "server-dir", String(port + 1)])).toBe(null);
    expect(run([oc, "server-dir", "x"])).toBe(null);
  } finally {
    server.kill();
  }
});
