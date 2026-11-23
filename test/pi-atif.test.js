// bun test: the ATIF export (core/atif.js) of a Pi session says whether each call failed and
// when it finished. Pi's reader gives no result events (extract.sh drops its toolResult lines),
// so the export takes each call's outcome from calls.sh: the toolResult message's text, its
// isError, and its line's time. Pi's bash tool gives isError true when its command exits with a
// code other than 0, as it does when a tool throws. A call still running when its turn was
// stopped keeps no content and extra.no_result. Synthetic sessions in the shapes Pi 1.6 writes,
// built here line by line with made-up words.
import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { problems } from "./atif-schema.js";

const root = join(import.meta.dir, "..");
const core = join(root, "mods/agent-threads/core");
const ID = "00000000-0000-7000-8000-000000000097";
const T0 = Date.UTC(2026, 0, 2, 3, 0, 0);
const at = (s) => new Date(T0 + s * 1000).toISOString();

// A session file from its lines. A line: [type, fields, second], where second is the line's
// timestamp in seconds after T0, or a string written as it is, or null for none.
function session(lines) {
  let n = 0;
  let parent = null;
  const out = [`${JSON.stringify({ type: "session", version: 3, id: ID, timestamp: at(0), cwd: "/home/dev/plinth" })}\n`];
  for (const [type, fields, s] of lines) {
    const id = (++n).toString(16).padStart(8, "0");
    const ts = typeof s === "number" ? { timestamp: at(s) } : typeof s === "string" ? { timestamp: s } : {};
    out.push(`${JSON.stringify({ type, id, parentId: parent, ...ts, ...fields })}\n`);
    parent = id;
  }
  const file = join(mkdtempSync(join(tmpdir(), "threads-piatif-")), `2026-01-02T03-00-00-000Z_${ID}.jsonl`);
  writeFileSync(file, out.join(""));
  return file;
}
const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { total: 0 } };
const text = (t) => ({ type: "text", text: t });
const user = (t, s) => ["message", { message: { role: "user", content: [text(t)], timestamp: T0 + s * 1000 } }, s];
const said = (content, stopReason, s) => ["message", { message: { role: "assistant", content, api: "openai-completions", provider: "stub", model: "stub-1", usage, stopReason, timestamp: T0 + s * 1000 } }, s];
const call = (id, name, args) => ({ type: "toolCall", id, name, arguments: args });
// A toolResult as Pi writes it. isError undefined writes none; s as in session().
const result = (id, name, out, isError, s) => ["message", { message: { role: "toolResult", toolCallId: id, toolName: name, content: [text(out)], details: {}, ...(isError === undefined ? {} : { isError }), durationMs: 40, timestamp: T0 }, }, s];

const exportOf = (file) => JSON.parse(execFileSync("bun", [join(core, "atif.js"), file, "pi"], { encoding: "utf8", maxBuffer: 1 << 26 }));
const resultsOf = (t) => Object.fromEntries(t.steps.flatMap((st) => (st.observation?.results ?? []).map((r) => [r.source_call_id, { r, st }])));

test("pi: the ATIF export gives a completed call its output, a failed one its error, both with their end time, and a call still running none", () => {
  const file = session([
    user("Count the widgets", 1),
    said([text("Counting."), call("call_000001", "bash", { command: "wc -l widgets.txt" }), call("call_000002", "bash", { command: "cat gadget.txt" }), call("call_000003", "read", { path: "gizmo.txt" })], "toolUse", 2),
    result("call_000001", "bash", "3 widgets.txt", false, 3),
    // Pi's bash tool: a command that exits non-zero is an error result, its output then the exit code.
    result("call_000002", "bash", "cat: gadget.txt: No such file or directory\n\nCommand exited with code 1", true, 4),
    // A tool that throws: its message is the result's text, and isError is true.
    result("call_000003", "read", "ENOENT: no such file or directory, open 'gizmo.txt'", true, 5),
    said([text("Three widgets, and no gadget or gizmo file.")], "stop", 6),
    user("Sort the widgets", 10),
    said([call("call_000004", "bash", { command: "sort widgets.txt" })], "toolUse", 11),
    // Stopped with Escape before the call wrote its result.
    said([], "aborted", 12),
  ]);
  const t = exportOf(file);
  expect(problems(t)).toEqual([]);
  const got = resultsOf(t);
  expect(Object.keys(got)).toEqual(["call_000001", "call_000002", "call_000003", "call_000004"]);
  // Completed: its output, not failed, and when it ended.
  expect(got.call_000001.r.content).toBe("3 widgets.txt");
  expect(got.call_000001.r.extra).toEqual({ result_ts: at(3), tool_result_is_error: false });
  // A shell call that exited 1, and a tool that failed: their text, failed, and when they ended.
  expect(got.call_000002.r.content).toBe("cat: gadget.txt: No such file or directory\n\nCommand exited with code 1");
  expect(got.call_000002.r.extra).toEqual({ result_ts: at(4), tool_result_is_error: true });
  expect(got.call_000003.r.content).toBe("ENOENT: no such file or directory, open 'gizmo.txt'");
  expect(got.call_000003.r.extra).toEqual({ result_ts: at(5), tool_result_is_error: true });
  // Still running when its turn was stopped: no content, no outcome, marked.
  expect(Object.hasOwn(got.call_000004.r, "content")).toBe(false);
  expect(got.call_000004.r.extra).toEqual({ no_result: true });
  expect(got.call_000004.st.extra.interrupted).toBe(true);
  // The tool calls keep their ids and their whole input from calls.sh's in lines.
  const calls = t.steps.flatMap((st) => st.tool_calls ?? []);
  expect(calls.map((c) => [c.tool_call_id, c.arguments])).toEqual([
    ["call_000001", { command: "wc -l widgets.txt" }], ["call_000002", { command: "cat gadget.txt" }],
    ["call_000003", { path: "gizmo.txt" }], ["call_000004", { command: "sort widgets.txt" }],
  ]);
});

test("pi: a result with no isError keeps its output and end time, leaves the flag out, and is not marked as having no result", () => {
  const file = session([
    user("Count the widgets", 1),
    said([call("call_000011", "bash", { command: "wc -l widgets.txt" }), call("call_000012", "read", { path: "widgets.txt" }), call("call_000013", "read", { path: "widgets.txt" })], "toolUse", 2),
    result("call_000011", "bash", "3 widgets.txt", undefined, 3),
    result("call_000012", "read", "plum\npear", undefined, 4),
    // Neither an outcome nor a time: the result still has its text, so it is not marked.
    result("call_000013", "read", "plum", undefined, null),
    said([text("Three.")], "stop", 5),
  ]);
  const got = resultsOf(exportOf(file));
  expect(got.call_000011.r.content).toBe("3 widgets.txt");
  expect(got.call_000011.r.extra).toEqual({ result_ts: at(3) });
  expect(got.call_000012.r.content).toBe("plum\npear");
  expect(got.call_000012.r.extra).toEqual({ result_ts: at(4) });
  expect(got.call_000013.r.content).toBe("plum");
  expect(Object.hasOwn(got.call_000013.r, "extra")).toBe(false);
});

test("pi: an end time of 0, one that is not a time, one missing, or one before the call's start gives no result_ts, and the outcome stays; one at the start counts", () => {
  const file = session([
    user("Count the widgets", 1),
    said([10, 11, 12, 13, 14, 15].map((i) => call(`call_0000${i + 11}`, "read", { path: "widgets.txt" })), "toolUse", 20),
    result("call_000021", "read", "widgets", false, 21),
    result("call_000022", "read", "widgets", false, "1970-01-01T00:00:00.000Z"),
    result("call_000023", "read", "widgets", true, "soon"),
    result("call_000024", "read", "widgets", false, null),
    result("call_000025", "read", "widgets", true, 19),
    result("call_000026", "read", "widgets", false, 20),
    said([text("Done.")], "stop", 30),
  ]);
  const got = resultsOf(exportOf(file));
  expect(got.call_000021.r.extra).toEqual({ result_ts: at(21), tool_result_is_error: false });
  expect(got.call_000026.r.extra).toEqual({ result_ts: at(20), tool_result_is_error: false });
  for (const [id, failed] of [["call_000022", false], ["call_000023", true], ["call_000024", false], ["call_000025", true]]) {
    expect([id, got[id].r.content, got[id].r.extra]).toEqual([id, "widgets", { tool_result_is_error: failed }]);
  }
});

test("pi: with no call time to compare it with, or one that is not a time, a result's own end time still counts, but not an end of 0", () => {
  const file = session([
    user("Count the widgets", 1),
    said([call("call_000031", "read", { path: "widgets.txt" })], "toolUse", null),
    result("call_000031", "read", "widgets", false, 3),
    said([call("call_000032", "read", { path: "widgets.txt" })], "toolUse", "early"),
    result("call_000032", "read", "widgets", false, 4),
    said([call("call_000033", "read", { path: "widgets.txt" })], "toolUse", null),
    result("call_000033", "read", "widgets", false, "1970-01-01T00:00:00.000Z"),
    said([text("Done.")], "stop", 5),
  ]);
  const got = resultsOf(exportOf(file));
  expect(got.call_000031.r.extra).toEqual({ result_ts: at(3), tool_result_is_error: false });
  expect(got.call_000032.r.extra).toEqual({ result_ts: at(4), tool_result_is_error: false });
  expect(got.call_000033.r.extra).toEqual({ tool_result_is_error: false });
});
