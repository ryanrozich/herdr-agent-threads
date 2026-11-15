// calls.sh: one step group's calls, read from a transcript by id, for level 3.
import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "../mods/agent-threads/calls.sh");
const run = (...args) => {
  const r = spawnSync("sh", [script, ...args], { encoding: "utf8" });
  return { code: r.status, lines: r.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l)), err: r.stderr };
};

function transcript() {
  const dir = mkdtempSync(join(tmpdir(), "threads-calls-sh-"));
  const file = join(dir, "t.jsonl");
  const pad = "z".repeat(5 * 1024 * 1024);
  const lines = [
    { type: "assistant", timestamp: "2026-11-01T09:00:01.000Z", message: { content: [{ type: "tool_use", id: "toolu_x1", name: "Bash", input: { command: "bun test cart", description: "Run the tests" } }] } },
    // Claude Code repeats a request's calls on api-request-blob lines, with no time: skipped.
    { type: "api-request-blob", message: { content: [{ type: "tool_use", id: "toolu_x1", name: "Bash", input: { command: "repeated" } }] } },
    { type: "user", timestamp: "2026-11-01T09:00:03.000Z", message: { content: [{ type: "tool_result", tool_use_id: "toolu_x1", content: [{ type: "text", text: "a\nb\nc" }, { type: "image" }] }] } },
    { type: "assistant", timestamp: "2026-11-01T09:00:04.000Z", message: { content: [{ type: "tool_use", id: "toolu_x2", name: "Read", input: { file_path: "src/cart.ts" } }] } },
    { type: "user", timestamp: "2026-11-01T09:00:05.000Z", message: { content: [{ type: "tool_result", tool_use_id: "toolu_x2", content: "no such file", is_error: true }] } },
    { type: "system", timestamp: "2026-11-01T09:00:06.000Z", content: pad },
    { type: "assistant", timestamp: "2026-11-01T09:00:07.000Z", message: { content: [{ type: "tool_use", id: "toolu_x3", name: "WebFetch", input: { url: "https://example.com/docs" } }] } },
    { type: "user", timestamp: "2026-11-01T09:00:08.000Z", message: { content: [{ type: "tool_result", tool_use_id: "toolu_x3", content: "x".repeat(30000) }] } },
  ];
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\nnot json\n`);
  return { dir, file };
}

test("calls.sh reads each call's input and output by id, on the conversation's own lines, and writes nothing", () => {
  const { dir, file } = transcript();
  const r = run(file, "claude", "toolu_x1", "toolu_x2", "toolu_x3");
  expect(r.code).toBe(0);
  expect(r.lines.filter((l) => l.k === "in")).toEqual([
    { id: "toolu_x1", k: "in", ts: "2026-11-01T09:00:01.000Z", in: "bun test cart" },
    { id: "toolu_x2", k: "in", ts: "2026-11-01T09:00:04.000Z", in: "src/cart.ts" },
    { id: "toolu_x3", k: "in", ts: "2026-11-01T09:00:07.000Z", in: "https://example.com/docs" },
  ]);
  const outs = r.lines.filter((l) => l.k === "out");
  expect(outs[0]).toEqual({ id: "toolu_x1", k: "out", ts: "2026-11-01T09:00:03.000Z", err: false, out: "a\nb\nc", lines: 3 });
  expect(outs[1]).toMatchObject({ id: "toolu_x2", err: true, out: "no such file" });
  // Long output is clipped at 24 KB.
  expect(outs[2].out.length).toBe(24576);
  expect(readdirSync(dir)).toEqual(["t.jsonl"]);
});

test("calls.sh --tail reads only the file's last 4 MB; bad ids, a missing file and other agents fail", () => {
  const { file } = transcript();
  const r = run("--tail", file, "claude", "toolu_x1", "toolu_x3");
  expect(r.code).toBe(0);
  expect(r.lines.map((l) => `${l.id}:${l.k}`)).toEqual(["toolu_x3:in", "toolu_x3:out"]);
  expect(run(file, "claude", "toolu_x1;rm").code).toBe(2);
  expect(run(file, "claude", "").code).toBe(2);
  expect(run(file).code).toBe(2);
  expect(run(`${file}.gone`, "claude", "toolu_x1").code).toBe(3);
  expect(run(file, "cursor", "call_1").code).toBe(4);
  expect(run(file, "claude").lines).toEqual([]);
});
