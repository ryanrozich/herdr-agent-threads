// bun test: how a session is read in chunks (280): the first call takes 2 MiB, so the first
// figures come at once, and each later call twice the last, up to 16 MiB; a call the
// extractor had to cut asks for half from then on; a replaced file starts again; and S1b, the
// read's longest synchronous stretch with 16 MiB calls. On the render harness
// (test/render-harness.js). Moved whole from render.test.js, which keeps S1 and the opening.
import { test, expect } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { draw, endInChunk2, extractCalls, H, openingPane, s1Child, settle, setup } from "./render-harness.js";

setup();

test("a read takes 2 MiB first, so the first figures come at once, then twice the last call up to 16 MiB and no more; a read of new bytes starts at 2 MiB again", async () => {
  H.extractCalls = [];
  try {
    const file = endInChunk2();
    // Ten more copies of its tool results: about 33 MB in all, past 2 + 4 + 8 + 16 MiB, so a
    // fifth call shows the growth stops at 16 MiB. Tool results print almost nothing, so no
    // call is cut.
    const extra = readFileSync(file, "utf8").split("\n").filter((l) => l.includes("tool_result")).join("\n");
    writeFileSync(file, `${readFileSync(file, "utf8")}${`${extra}\n`.repeat(10)}`);
    const size = statSync(file).size;
    expect(size).toBeGreaterThan(30 * 2 ** 20 + 2 ** 20);
    const { v, cx, go } = await openingPane(file);
    go(() => false);
    await settle(v);
    const s = v.current();
    expect(s.loaded).toBe(true);
    expect(s.offset).toBe(size);
    // The opening's one read of the file's last 2 MiB for the newest prompt, then the read.
    const peek = extractCalls.filter(([o, n]) => o === size - 2 * 2 ** 20 && n === 2 * 2 ** 20);
    expect(peek.length).toBe(1);
    const first = extractCalls.filter((x) => x !== peek[0] && x[0] < size);
    expect(first.map(([, n]) => n / 2 ** 20)).toEqual([2, 4, 8, 16, 16]);
    expect(first[0][0]).toBe(0);
    // New bytes on a session read to its end: 2 MiB first again.
    extractCalls.length = 0;
    appendFileSync(file, `${JSON.stringify({ type: "user", uuid: "u9", timestamp: new Date(Date.UTC(2026, 10, 2, 10, 0, 0)).toISOString(), sessionId: "s", origin: { kind: "human" }, promptSource: "typed", message: { role: "user", content: "One more" } })}\n`);
    v.read(cx);
    await settle(v);
    expect(extractCalls[0]).toEqual([size, 2 * 2 ** 20]);
    draw(v, cx);
  } finally { H.extractCalls = null; }
});

test("a read whose call the extractor had to cut (dense text) asks for half from then on", async () => {
  H.extractCalls = [];
  try {
    // 140 turns, each a prompt and a 100 KB reply of plain words: about 14 MB, nearly all of it
    // events, so 12 MB in one call would print more than the extractor's 6 MiB.
    const at = (i, s) => new Date(Date.UTC(2026, 10, 2, 9, 0, 0) + i * 60000 + s * 1000).toISOString();
    const words = "kaz vel orin tam sula pero dint ".repeat(3300);
    const lines = [];
    for (let i = 0; i < 140; i++) {
      lines.push({ type: "user", uuid: `u${i}`, timestamp: at(i, 0), sessionId: "s", origin: { kind: "human" }, promptSource: "typed", message: { role: "user", content: `Turn ${i + 1}: write it out` } });
      lines.push({ type: "assistant", uuid: `a${i}`, timestamp: at(i, 30), sessionId: "s", message: { id: `m${i}`, role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: words }] } });
      lines.push({ type: "system", subtype: "turn_duration", durationMs: 30000, uuid: `d${i}`, timestamp: at(i, 30), sessionId: "s" });
    }
    const dir = mkdtempSync(join(tmpdir(), "threads-dense-"));
    const file = join(dir, "d.jsonl");
    writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    const size = statSync(file).size;
    const { v, go } = await openingPane(file);
    go(() => false);
    await settle(v);
    expect(v.current().offset).toBe(size);
    const MiB = 2 ** 20;
    const read = extractCalls.filter(([o, n]) => !(o === size - 2 * MiB && n === 2 * MiB));
    // The 8 MiB call was cut to 4 (its events past 6 MiB): the calls after it ask for 4, not
    // for a size already cut, and do not grow again.
    expect(read.map(([, n]) => n / MiB)).toEqual([2, 4, 8, 4, 4]);
    expect(v.current().turns.length).toBe(140);
  } finally { H.extractCalls = null; }
});

// Tool results of 100 KB each, as endInChunk2's, appended to file until it is past bytes.
function padTools(file, bytes) {
  const extra = `${readFileSync(file, "utf8").split("\n").filter((l) => l.includes("tool_result")).join("\n")}\n`;
  let size = statSync(file).size;
  while (size < bytes) { appendFileSync(file, extra); size += extra.length; }
}

test("a call that stops short of a line longer than the rest of it was not cut: the read's calls stay at 16 MiB", async () => {
  H.extractCalls = [];
  try {
    const MiB = 2 ** 20;
    // 17 MiB of tool results, then a 14 MiB one: the 16 MiB call, which starts by 14 MiB,
    // ends before that line does, so it reads about 3 MiB and nothing is cut.
    const file = endInChunk2();
    padTools(file, 17 * MiB);
    const at = new Date(Date.UTC(2026, 10, 2, 9, 50, 0)).toISOString();
    appendFileSync(file, `${JSON.stringify({ type: "assistant", uuid: "aL", timestamp: at, sessionId: "s", message: { id: "mL", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "tL", name: "Read", input: { file_path: "cart/log.txt" } }] } })}\n`);
    appendFileSync(file, `${JSON.stringify({ type: "user", uuid: "rL", timestamp: at, sessionId: "s", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tL", content: "zo".repeat(7 * MiB) }] } })}\n`);
    appendFileSync(file, `${JSON.stringify({ type: "assistant", uuid: "zL", timestamp: at, sessionId: "s", message: { id: "mz2", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "The log is long." }] } })}\n`);
    const size = statSync(file).size;
    const { v, go } = await openingPane(file);
    go(() => false);
    await settle(v);
    expect(v.current().offset).toBe(size);
    const read = extractCalls.filter(([o, n]) => !(o === size - 2 * MiB && n === 2 * MiB));
    // Not 2, 4, 8, 16, 8, 32: a short call is not a cut one, so the cap stays at 16 MiB and the
    // next call reads the long line whole.
    expect(read.map(([, n]) => n / MiB)).toEqual([2, 4, 8, 16, 16]);
  } finally { H.extractCalls = null; }
}, 60000);

test("a file replaced in the middle of a read starts again at 2 MiB with the full ceiling, whatever the cut file's calls had come down to", async () => {
  H.extractCalls = [];
  const MiB = 2 ** 20;
  try {
    // The dense session of the test before (its 8 MiB call is cut to 4), with a first uuid of
    // its own, so the file that replaces it starts differently.
    const at = (i, s) => new Date(Date.UTC(2026, 10, 2, 9, 0, 0) + i * 60000 + s * 1000).toISOString();
    const words = "kaz vel orin tam sula pero dint ".repeat(3300);
    const lines = [];
    for (let i = 0; i < 140; i++) {
      lines.push({ type: "user", uuid: `dd${String(i).padStart(6, "0")}`, timestamp: at(i, 0), sessionId: "s", origin: { kind: "human" }, promptSource: "typed", message: { role: "user", content: `Turn ${i + 1}: write it out` } });
      lines.push({ type: "assistant", uuid: `de${String(i).padStart(6, "0")}`, timestamp: at(i, 30), sessionId: "s", message: { id: `m${i}`, role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: words }] } });
    }
    const dir = mkdtempSync(join(tmpdir(), "threads-swap-"));
    const file = join(dir, "d.jsonl");
    writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    // The file that replaces it: endInChunk2's, past 2 + 4 + 8 MiB.
    const other = endInChunk2();
    padTools(other, 21 * MiB);
    const size = statSync(file).size;
    // The first call after the cut one (a 4 MiB call from past the start): the file is
    // replaced just before it reads.
    let swapAt = -1;
    H.extractHook = async (args) => {
      const [o, n] = [Number(args[2]), Number(args[3])];
      if (swapAt < 0 && o > 0 && o !== size - 2 * MiB && n === 4 * MiB && extractCalls.filter(([, k]) => k === 8 * MiB).length) {
        swapAt = extractCalls.length - 1;
        writeFileSync(file, readFileSync(other));
      }
      return null;
    };
    const { v, go } = await openingPane(file);
    go(() => false);
    await settle(v);
    expect(swapAt).toBeGreaterThan(0);
    const newSize = statSync(other).size;
    expect(v.current().offset).toBe(newSize);
    const before = extractCalls.slice(0, swapAt + 1).filter(([o, n]) => !(o === size - 2 * MiB && n === 2 * MiB));
    expect(before.map(([, n]) => n / MiB)).toEqual([2, 4, 8, 4]);
    // From the top of the new file: 2 MiB, then growing to 16 MiB, not held at the 4 MiB the
    // cut file had come down to.
    const after = extractCalls.slice(swapAt + 1).filter(([o, n]) => !(o === newSize - 2 * MiB && n === 2 * MiB));
    expect(after[0]).toEqual([0, 2 * MiB]);
    expect(after.map(([, n]) => n / MiB)).toEqual([2, 4, 8, 16]);
  } finally { H.extractCalls = null; H.extractHook = null; }
}, 60000);

test("S1b: with 16 MiB calls (a longer session) the read's longest synchronous stretch is still at most 30 ms, and the bar rises with every chunk", async () => {
  const r = await s1Child({ THREADS_S1_BUSY: "500" });
  expect(r.loaded).toBe(true);
  expect(r.size).toBeGreaterThan(20 * 2 ** 20);
  expect(r.calls.slice(0, 4)).toEqual([2 ** 21, 2 ** 22, 2 ** 23, 2 ** 24]);
  expect(r.longest).toBeLessThanOrEqual(30);
  expect(r.pcts.length).toBe(r.calls.length);
  for (let i = 1; i < r.pcts.length; i++) expect(r.pcts[i]).toBeGreaterThan(r.pcts[i - 1]);
  expect(r.pcts.at(-1)).toBe(100);
  console.log(`S1b work: ${(r.size / 1e6).toFixed(1)} MB in calls of ${r.calls.map((n) => n / 2 ** 20).join(", ")} MiB; longest stretch ${r.longest.toFixed(1)} ms over ${r.awaits} awaits, at most ${r.most.lines} lines and ${r.most.events} events in one; percent ${r.pcts.join(", ")}`);
}, 180000);
