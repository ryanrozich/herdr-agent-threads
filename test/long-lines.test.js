// TRD-31: a transcript line longer than the reader's chunk. The reader works out where a
// chunk's whole lines end without tail -n 1 (uutils coreutils 0.10.0, on Ubuntu 26.04, prints
// only the last 983,040 bytes of a line with no newline), and skips a line longer than its
// ceiling instead of reading it in ever larger chunks.
import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, symlinkSync, existsSync, chmodSync, openSync, writeSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply, parseChunk, nextChunk, noteSkip, skipNote } from "../mods/agent-threads/core/turns.js";

const core = join(import.meta.dir, "../mods/agent-threads/core");
const CHUNK = 2 * 1024 * 1024; // main.js

// A Claude Code session of 9 turns; turn 5's reply line is <mb> MB of text. at: "head" puts the
// long line before the first prompt instead.
function session(mb, at = 5) {
  const d = mkdtempSync(join(tmpdir(), "threads-long-"));
  const f = join(d, "s.jsonl");
  const fd = openSync(f, "w");
  let n = 0;
  const rec = (o) => ({ parentUuid: null, isSidechain: false, userType: "external", cwd: "/Users/dev/acme-web", sessionId: "s-long", version: "2.1.0", uuid: `00000000-0000-4000-9400-${String(++n).padStart(12, "0")}`, timestamp: new Date(Date.parse("2026-11-01T10:00:00Z") + n * 1000).toISOString(), ...o });
  const said = (text) => rec({ type: "assistant", message: { id: `msg_${n}`, model: "claude-sonnet-5-5", role: "assistant", type: "message", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } } });
  for (let t = 1; t <= 9; t++) {
    if (at === "head" && t === 1) {
      const [a, b] = JSON.stringify(said("@@")).split("@@");
      writeSync(fd, a);
      const piece = "Notes from an earlier run, kept in the session. ".repeat(2000);
      for (let done = 0; done < mb * 1048576; done += piece.length) writeSync(fd, piece);
      writeSync(fd, `${b}\n`);
    }
    writeSync(fd, `${JSON.stringify(rec({ type: "user", message: { role: "user", content: `Turn ${t}: check month ${t}.` } }))}\n`);
    if (t === at) {
      const [a, b] = JSON.stringify(said("@@")).split("@@");
      writeSync(fd, a);
      const piece = "Build output from the range helper, month by month. ".repeat(2000);
      for (let done = 0; done < mb * 1048576; done += piece.length) writeSync(fd, piece);
      writeSync(fd, `${b}\n`);
    } else writeSync(fd, `${JSON.stringify(said(`Turn ${t} is done.`))}\n`);
  }
  closeSync(fd);
  return f;
}

// A first read as the panel makes it (main.js: 2 MB chunks and nextChunk).
function read(f, env = process.env, s = newSession("s", f)) {
  let chunk = CHUNK;
  let calls = 0;
  let skipped = 0;
  while (chunk && calls < 300) {
    const c = parseChunk(spawnSync("sh", [join(core, "extract.sh"), f, String(s.offset), String(chunk)], { encoding: "utf8", env, maxBuffer: 1 << 28 }).stdout);
    s.size = c.size;
    for (const e of c.events) apply(s, e);
    // As main.js does: counted, and noted on the newest turn read so far.
    if (c.skipped) { skipped += c.skipped; noteSkip(s, c.skipped); }
    s.offset += c.used;
    calls++;
    chunk = nextChunk(s, c.used, chunk, CHUNK);
  }
  return { s, calls, skipped };
}

// A tail that answers -n 1 as uutils coreutils 0.10.0 does on a line with no newline: only
// its last 983,040 bytes. Everything else is the real tail.
function uutilsTail() {
  const bin = mkdtempSync(join(tmpdir(), "threads-uutail-"));
  const real = spawnSync("sh", ["-c", "command -v tail"], { encoding: "utf8" }).stdout.trim();
  writeFileSync(join(bin, "tail"), `#!/bin/sh\nif [ "$1" = "-n" ] && [ "$2" = "1" ]; then "${real}" -n 1 "$3" | "${real}" -c 983040; else exec "${real}" "$@"; fi\n`);
  chmodSync(join(bin, "tail"), 0o755);
  return bin;
}

test("a 3 MB reply line is read whole, also where tail -n 1 prints only a line's last 983,040 bytes", () => {
  const f = session(3);
  for (const env of [process.env, { ...process.env, PATH: `${uutilsTail()}:${process.env.PATH}` }]) {
    const { s, skipped } = read(f, env);
    expect(s.turns.map((t) => t.prompt)).toEqual(Array.from({ length: 9 }, (_, i) => `Turn ${i + 1}: check month ${i + 1}.`));
    expect(s.turns[4].after.join("").length).toBeGreaterThan(100000);
    expect(skipped).toBe(0);
    expect(s.offset).toBe(s.size);
  }
});

test("a line longer than the ceiling is skipped to its end, counted, and the turns around it are read", () => {
  const f = session(3);
  const { s, calls, skipped } = read(f, { ...process.env, THREADS_LINE_MAX: String(1 << 20) });
  expect(s.turns.length).toBe(9);
  expect(s.turns[3].after.join("")).toBe("Turn 4 is done.");
  expect(s.turns[4].after.join("")).toBe("");
  expect(s.turns[5].after.join("")).toBe("Turn 6 is done.");
  // parseChunk carries the skipped bytes (read() sums c.skipped), for the debug report.
  expect(skipped).toBeGreaterThan(3 * 1048576);
  expect(s.offset).toBe(s.size);
  // The reads stop growing at the ceiling: one read of the turns before, one of 1 MB that
  // finds no end and skips, one of the rest.
  expect(calls).toBe(3);
  // The note goes after turn 5, the turn the line fell in, and nowhere else.
  expect(s.turns.map((t) => Boolean(t.skipped))).toEqual([false, false, false, false, true, false, false, false, false]);
  expect(s.turns[4].skipped).toEqual({ lines: 1, bytes: skipped });
  // Its reply may be the line left out: the next turn's reply is not taken for its own.
  expect(s.turns[4].answeredBy).toBe(null);
  expect(skipNote(s.turns[4].skipped)).toBe("A line of 3 MB was left out here, too long to read");
  expect(s.skippedHead).toBe(null);
});

test("a line skipped before the first prompt is noted at the session's head", () => {
  const { s, skipped } = read(session(3, "head"), { ...process.env, THREADS_LINE_MAX: String(1 << 20) });
  expect(s.turns.length).toBe(9);
  expect(s.turns.some((t) => t.skipped)).toBe(false);
  expect(s.skippedHead).toEqual({ lines: 1, bytes: skipped });
  expect(skipNote({ lines: 2, bytes: 140 * 1048576 })).toBe("2 lines, 140 MB in all, were left out here, too long to read");
  // From 1 GB up, in GB with one decimal.
  expect(skipNote({ lines: 1, bytes: 1023 * 1048576 })).toBe("A line of 1023 MB was left out here, too long to read");
  expect(skipNote({ lines: 1, bytes: 1073741824 })).toBe("A line of 1.0 GB was left out here, too long to read");
  expect(skipNote({ lines: 3, bytes: 5 * 1073741824 + 300 * 1048576 })).toBe("3 lines, 5.3 GB in all, were left out here, too long to read");
  // Read again from the top (main.js restart puts a new session's fields over the old): the
  // same line is counted once, not twice.
  Object.assign(s, newSession(s.id, s.file));
  const again = read(s.file, { ...process.env, THREADS_LINE_MAX: String(1 << 20) }, s);
  expect(again.s.skippedHead).toEqual({ lines: 1, bytes: skipped });
});

test("ends.pl and its stand-ins without perl say where lines end", () => {
  const d = mkdtempSync(join(tmpdir(), "threads-ends-"));
  const f = join(d, "f");
  writeFileSync(f, "ab\ncdef\ngh");
  const sh = (fn, from, env) => Number(spawnSync("sh", ["-c", `threads_core=${core}; . ${core}/lines.sh; ${fn} "$1" "$2"`, "sh", f, String(from)], { encoding: "utf8", env }).stdout.trim());
  const bin = mkdtempSync(join(tmpdir(), "threads-noperl-"));
  for (const dir of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) if (!/^perl/.test(n) && !existsSync(join(bin, n))) { try { symlinkSync(join(dir, n), join(bin, n)); } catch { /* taken */ } }
  }
  for (const env of [process.env, { ...process.env, PATH: bin }]) {
    expect([sh("whole", 0, env), sh("whole", 3, env), sh("whole", 8, env), sh("whole", 9, env)]).toEqual([8, 8, 8, 9]);
    expect([sh("line_end", 0, env), sh("line_end", 3, env), sh("line_end", 8, env)]).toEqual([3, 8, -1]);
  }
});

// From the review of eece24a: Cursor never skips a line, so a ceiling on its reads stopped the
// session for good at a line longer than it (every read used nothing). Its reads grow as before.
test("a Cursor line longer than the ceiling is read whole, and the session goes on past it", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "threads-long-cursor-")), "projects", "home-dev-shop", "agent-transcripts", "00000000-0000-4000-8000-0000000000c3");
  mkdirSync(dir, { recursive: true });
  const f = join(dir, "00000000-0000-4000-8000-0000000000c3.jsonl");
  const user = (t) => `${JSON.stringify({ role: "user", message: { content: [{ type: "text", text: `<user_query>\n${t}\n</user_query>` }] } })}\n`;
  const said = (t) => `${JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: t }] } })}\n`;
  const ended = `${JSON.stringify({ type: "turn_ended", status: "success" })}\n`;
  writeFileSync(f, [user("Turn 1: check the cart."), said("Turn 1 is done."), ended, user("Turn 2: print the log."), said("Build output, line by line. ".repeat(110000)), ended, user("Turn 3: and now?"), said("Turn 3 is done."), ended].join(""));
  const env = { ...process.env, THREADS_LINE_MAX: String(1 << 20) };
  const s = newSession("c", f);
  let chunk = CHUNK / 2;
  let calls = 0;
  let skipped = 0;
  while (chunk && calls < 40) {
    const c = parseChunk(spawnSync("sh", [join(core, "extract.sh"), f, String(s.offset), String(chunk), "cursor"], { encoding: "utf8", env, maxBuffer: 1 << 28 }).stdout);
    s.size = c.size;
    for (const e of c.events) apply(s, e);
    if (c.skipped) skipped += c.skipped;
    s.offset += c.used;
    calls++;
    chunk = nextChunk(s, c.used, chunk, CHUNK / 2);
  }
  expect(s.offset).toBe(s.size);
  expect(skipped).toBe(0);
  expect(s.turns.map((t) => t.prompt)).toEqual(["Turn 1: check the cart.", "Turn 2: print the log.", "Turn 3: and now?"]);
  expect(s.turns[2].after.join("")).toBe("Turn 3 is done.");
});
