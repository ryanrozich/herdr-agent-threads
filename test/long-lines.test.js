// TRD-31: a transcript line longer than the reader's chunk. The reader works out where a
// chunk's whole lines end without tail -n 1 (uutils coreutils 0.10.0, on Ubuntu 26.04, prints
// only the last 983,040 bytes of a line with no newline), and skips a line longer than its
// ceiling instead of reading it in ever larger chunks.
import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, symlinkSync, existsSync, chmodSync, openSync, writeSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reply, newSession, apply, parseChunk, nextChunk, noteSkip, skipNote, readCap } from "../mods/agent-threads/core/turns.js";

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
    expect(reply(s.turns[4]).length).toBeGreaterThan(100000);
    expect(skipped).toBe(0);
    expect(s.offset).toBe(s.size);
  }
});

test("a line longer than the ceiling is skipped to its end, counted, and the turns around it are read", () => {
  const f = session(3);
  const { s, calls, skipped } = read(f, { ...process.env, THREADS_LINE_MAX: String(1 << 20) });
  expect(s.turns.length).toBe(9);
  expect(reply(s.turns[3])).toBe("Turn 4 is done.");
  expect(reply(s.turns[4])).toBe("");
  expect(reply(s.turns[5])).toBe("Turn 6 is done.");
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
  // Decimal MB and GB, as a file listing and the rest of the pane show sizes.
  expect(skipNote({ lines: 2, bytes: 140e6 })).toBe("2 lines, 140 MB in all, were left out here, too long to read");
  expect(skipNote({ lines: 1, bytes: 300 * 1048576 })).toBe("A line of 315 MB was left out here, too long to read");
  expect(skipNote({ lines: 1, bytes: 1500 })).toBe("A line of 1 MB was left out here, too long to read");
  // From 1 GB up, in GB with one decimal.
  expect(skipNote({ lines: 1, bytes: 999e6 })).toBe("A line of 999 MB was left out here, too long to read");
  expect(skipNote({ lines: 1, bytes: 999.6e6 })).toBe("A line of 1.0 GB was left out here, too long to read");
  expect(skipNote({ lines: 1, bytes: 1e9 })).toBe("A line of 1.0 GB was left out here, too long to read");
  expect(skipNote({ lines: 3, bytes: 5.3e9 })).toBe("3 lines, 5.3 GB in all, were left out here, too long to read");
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
  expect(reply(s.turns[2])).toBe("Turn 3 is done.");
});

test("readCap: a call the extractor cut (its output over 6 MiB, it says cut) halves the rest of the read's calls, never below the first call's size", () => {
  const MiB = 2 ** 20;
  // Not cut: the cap stays, however little the call read.
  expect(readCap(16 * MiB, false, 16 * MiB, 2 * MiB)).toBe(16 * MiB);
  expect(readCap(16 * MiB, false, 2 * MiB, 2 * MiB)).toBe(16 * MiB);
  // Cut, from 16 MiB: 8 MiB a call from then on, so the cut is not paid again each call.
  expect(readCap(16 * MiB, true, 16 * MiB, 2 * MiB)).toBe(8 * MiB);
  expect(readCap(8 * MiB, true, 8 * MiB, 2 * MiB)).toBe(4 * MiB);
  // Down to the first call's size and no lower.
  expect(readCap(2 * MiB, true, 2 * MiB, 2 * MiB)).toBe(2 * MiB);
  // A call grown past the cap to get by a long line, then cut: never above the cap.
  expect(readCap(8 * MiB, true, 64 * MiB, 2 * MiB)).toBe(8 * MiB);
});

// A call that stops short of a line longer than the rest of it reads little with nothing cut;
// only a call whose output came to more than 6 MiB says cut.
test("extract.sh says cut only when it read a call again at half its size", () => {
  const MiB = 2 ** 20;
  const d = mkdtempSync(join(tmpdir(), "threads-cut-"));
  const at = (i) => new Date(Date.parse("2026-11-01T10:00:00Z") + i * 1000).toISOString();
  const rec = (i, o) => JSON.stringify({ uuid: `00000000-0000-4000-9500-${String(i).padStart(12, "0")}`, timestamp: at(i), sessionId: "s-cut", ...o });
  // 3 MiB of short turns, then a 14 MiB tool result: a 16 MiB call reads the short turns only.
  const sparse = join(d, "sparse.jsonl");
  const fd = openSync(sparse, "w");
  let i = 0;
  for (let n = 0; n < 3 * MiB; ) {
    const l = `${rec(++i, { type: "user", message: { role: "user", content: `Turn ${i}: check the cart totals for month ${i}.` } })}\n`;
    writeSync(fd, l);
    n += l.length;
  }
  writeSync(fd, `${rec(++i, { type: "assistant", message: { id: "m-long", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t-long", name: "Read", input: { file_path: "cart/log.txt" } }] } })}\n`);
  writeSync(fd, `${rec(++i, { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t-long", content: "zo".repeat(7 * MiB) }] } })}\n`);
  closeSync(fd);
  const call = (f, max) => {
    const out = spawnSync("sh", [join(core, "extract.sh"), f, "0", String(max)], { encoding: "utf8", maxBuffer: 1 << 28 }).stdout;
    return { c: parseChunk(out), line: out.split("\n").find((l) => l.startsWith('{"k":"chunk"')) };
  };
  const a = call(sparse, 16 * MiB);
  expect(a.c.used).toBeGreaterThan(3 * MiB - 200);
  expect(a.c.used).toBeLessThan(3 * MiB + 500);
  expect(a.c.cut).toBeUndefined();
  expect(a.line).not.toContain("cut");
  // 140 replies of 100 KB of plain words: an 8 MiB call prints more than 6 MiB, so it is read
  // again at 4 MiB and says so.
  const dense = join(d, "dense.jsonl");
  const words = "kaz vel orin tam sula pero dint ".repeat(3300);
  const lines = [];
  for (let k = 0; k < 140; k++) {
    lines.push(rec(2 * k, { type: "user", origin: { kind: "human" }, promptSource: "typed", message: { role: "user", content: `Turn ${k + 1}: write it out` } }));
    lines.push(rec(2 * k + 1, { type: "assistant", message: { id: `m${k}`, role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: words }] } }));
  }
  writeFileSync(dense, `${lines.join("\n")}\n`);
  const b = call(dense, 8 * MiB);
  expect(b.c.used).toBeLessThanOrEqual(4 * MiB);
  expect(b.c.used).toBeGreaterThan(3 * MiB);
  expect(b.c.cut).toBe(true);
  // A call small enough not to be cut does not say cut.
  const e = call(dense, 2 * MiB);
  expect(e.c.cut).toBeUndefined();
}, 60000);
