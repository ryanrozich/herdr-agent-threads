// bun test: the ATIF export (core/atif.js) of an Antigravity conversation says which calls failed
// and when each finished. Antigravity's reader gives no result events, so the export takes each
// call's outcome from calls.sh: a call's result is the GENERIC step after its planner step, and
// its time is that step's "Completed At" line. A step with status ERROR failed. A step with status
// DONE says nothing either way (a command that exits non-zero can still be DONE), so the flag is
// left out. A step still RUNNING is no result. Synthetic transcripts in the shapes agy 1.5 writes,
// built here step by step with made-up words.
import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { problems } from "./atif-schema.js";

const root = join(import.meta.dir, "..");
const core = join(root, "mods/agent-threads/core");
const ID = "00000000-0000-4000-8000-000000000097";
const at = (sec) => new Date(Date.UTC(2026, 0, 5, 15, 7, 0) + sec * 1000).toISOString().replace(/\.000Z$/, "Z");

// A transcript from its steps, numbered in order. A step's time: sec, a number of seconds, or
// a string written as it is, or null for none.
function transcript(steps) {
  const dir = join(mkdtempSync(join(tmpdir(), "threads-agyatif-")), "brain", ID, ".system_generated", "logs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "transcript_full.jsonl");
  let n = 0;
  writeFileSync(file, steps.map((s) => {
    const { sec, ...rest } = s;
    const index = rest.step_index ?? n;
    n = index + 1;
    const time = typeof sec === "number" ? { created_at: at(sec) } : typeof sec === "string" ? { created_at: sec } : {};
    return `${JSON.stringify({ step_index: index, ...rest, ...time })}\n`;
  }).join(""));
  return file;
}
const user = (text, sec) => ({ source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", sec, content: `<USER_REQUEST>\n${text}\n</USER_REQUEST>` });
const plan = (sec, calls, content) => ({ source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", sec, input_tokens: 10, output_tokens: 5, cache_read_tokens: 0,
  ...(content ? { content } : {}), ...(calls.length ? { tool_calls: calls.map(([name, args]) => ({ name, args })) } : {}) });
// A GENERIC result step: its time lines (each a time string, or null for none), then its text.
const out = (sec, status, created, completed, text, extra = {}) => ({ source: "MODEL", type: "GENERIC", status, sec,
  content: [created == null ? null : `Created At: ${created}`, completed == null ? null : `Completed At: ${completed}`, text].filter((x) => x != null).join("\n"), ...extra });

const exportOf = (file) => JSON.parse(execFileSync("bun", [join(core, "atif.js"), file, "antigravity"], { encoding: "utf8", maxBuffer: 1 << 26 }));
const resultsOf = (t) => Object.fromEntries(t.steps.flatMap((st) => (st.observation?.results ?? []).map((r) => [r.source_call_id, { r, st }])));

test("antigravity: a DONE call keeps its output and end time with no outcome, an ERROR call its error and true, and a RUNNING call no result", () => {
  const file = transcript([
    user("Count the widgets", 0),
    plan(1, [["run_command", { CommandLine: "wc -l widgets.txt" }], ["run_command", { CommandLine: "cat gadget.txt" }], ["view_file", { AbsolutePath: "/home/dev/plinth/gizmo.txt" }]]),
    out(2, "DONE", at(1), at(2), "Command output:\n3 widgets.txt"),
    // A command that exits non-zero: Antigravity's own source is not public, so DONE says nothing.
    out(3, "DONE", at(2), at(3), "Command output:\ncat: gadget.txt: No such file or directory\nThe command failed with exit code: 1"),
    out(4, "ERROR", at(3), at(4), "Encountered error in step execution: no such file", { error: "no such file" }),
    plan(5, [], "Three widgets, and no gadget or gizmo file."),
    user("Sort the widgets", 10),
    plan(11, [["run_command", { CommandLine: "sort widgets.txt" }]]),
    // Still running when the turn was stopped: Antigravity keeps a RUNNING step for it.
    out(12, "RUNNING", at(11), null, "Tool is running as a background task with task id: task-000001"),
    user("Stop", 20),
    plan(21, [], "Stopped."),
  ]);
  const t = exportOf(file);
  expect(problems(t)).toEqual([]);
  const got = resultsOf(t);
  expect(Object.keys(got)).toEqual(["s1.0", "s1.1", "s1.2", "s7.0"]);
  expect(got["s1.0"].r.content).toBe("Command output:\n3 widgets.txt");
  expect(got["s1.0"].r.extra).toEqual({ result_ts: "2026-01-05T15:07:02.000Z" });
  expect(got["s1.1"].r.content).toBe("Command output:\ncat: gadget.txt: No such file or directory\nThe command failed with exit code: 1");
  expect(got["s1.1"].r.extra).toEqual({ result_ts: "2026-01-05T15:07:03.000Z" });
  expect(got["s1.2"].r.content).toBe("Encountered error in step execution: no such file");
  expect(got["s1.2"].r.extra).toEqual({ result_ts: "2026-01-05T15:07:04.000Z", tool_result_is_error: true });
  expect(Object.hasOwn(got["s7.0"].r, "content")).toBe(false);
  expect(got["s7.0"].r.extra).toEqual({ no_result: true });
  // The calls keep their whole input from calls.sh's in lines.
  expect(t.steps.flatMap((st) => st.tool_calls ?? []).map((c) => [c.tool_call_id, c.arguments])).toEqual([
    ["s1.0", { CommandLine: "wc -l widgets.txt" }], ["s1.1", { CommandLine: "cat gadget.txt" }],
    ["s1.2", { AbsolutePath: "/home/dev/plinth/gizmo.txt" }], ["s7.0", { CommandLine: "sort widgets.txt" }],
  ]);
});

test("antigravity: a step written RUNNING then again DONE is read once, as the DONE one", () => {
  const file = transcript([
    user("Count the widgets", 0),
    plan(1, [["run_command", { CommandLine: "wc -l widgets.txt" }]]),
    { ...out(2, "RUNNING", at(1), null, "Tool is running as a background task with task id: task-000002"), step_index: 2 },
    { ...out(9, "DONE", at(1), at(9), "Command output:\n3 widgets.txt"), step_index: 2 },
    plan(10, [], "Three."),
  ]);
  const got = resultsOf(exportOf(file));
  expect(got["s1.0"].r.content).toBe("Command output:\n3 widgets.txt");
  expect(got["s1.0"].r.extra).toEqual({ result_ts: "2026-01-05T15:07:09.000Z" });
});

test("antigravity: a failed step with no text keeps its error; a DONE step with no text keeps none", () => {
  const file = transcript([
    user("Count the widgets", 0),
    plan(1, [["view_file", { AbsolutePath: "/home/dev/plinth/gizmo.txt" }], ["view_file", { AbsolutePath: "/home/dev/plinth/widgets.txt" }]]),
    out(2, "ERROR", at(1), at(2), null, { error: "no such file: gizmo.txt" }),
    out(3, "DONE", at(2), at(3), null, { error: "stray error text" }),
    plan(4, [], "No gizmo."),
  ]);
  const got = resultsOf(exportOf(file));
  expect(got["s1.0"].r.content).toBe("no such file: gizmo.txt");
  expect(got["s1.0"].r.extra).toEqual({ result_ts: "2026-01-05T15:07:02.000Z", tool_result_is_error: true });
  expect(got["s1.1"].r.content).toBe("");
  expect(got["s1.1"].r.extra).toEqual({ result_ts: "2026-01-05T15:07:03.000Z" });
});

test("antigravity: the session id is the conversation's folder in agy's layout, for either transcript file and a relative path; any other path keeps its file's name", () => {
  const lines = `${[user("Count the widgets", 0), plan(1, [], "Three.")].map((s, i) => { const { sec, ...rest } = s; return JSON.stringify({ step_index: i, ...rest, created_at: at(sec) }); }).join("\n")}\n`;
  const base = mkdtempSync(join(tmpdir(), "threads-agyid-"));
  const put = (...parts) => {
    const dir = join(base, ...parts.slice(0, -1));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, parts.at(-1)), lines);
    return join(dir, parts.at(-1));
  };
  const idOf = (file, cwd) => JSON.parse(execFileSync("bun", [join(core, "atif.js"), file, "antigravity"], { encoding: "utf8", cwd })).session_id;
  const logs = [".system_generated", "logs"];
  expect(idOf(put("data", "brain", ID, ...logs, "transcript_full.jsonl"))).toBe(ID);
  expect(idOf(put("data", "brain", "0000000000a8", ...logs, "transcript.jsonl"))).toBe("0000000000a8");
  // Relative to the folder the command runs in.
  expect(idOf(join("brain", ID, ...logs, "transcript_full.jsonl"), join(base, "data"))).toBe(ID);
  // Outside the layout, or a folder name the reader does not take as an id: the file's name.
  expect(idOf(put("copy", "antigravity-cli.trajectory.jsonl"))).toBe("antigravity-cli.trajectory");
  expect(idOf(put("flat", "brain", ID, "transcript_full.jsonl"))).toBe("transcript_full");
  expect(idOf(put("odd", "brain", "0000.00a7", ...logs, "transcript_full.jsonl"))).toBe("transcript_full");
  expect(idOf(put("other", "brain", ID, ...logs, "transcript_part.jsonl"))).toBe("transcript_part");
  expect(idOf(put("near", "mybrain", ID, ...logs, "transcript_full.jsonl"))).toBe("transcript_full");
  expect(idOf(put("bak", "brain", ID, ...logs, "transcript_full.jsonl.bak"))).toBe("transcript_full.jsonl.bak");
  // Another agent's file in that layout keeps its name: the rule is Antigravity's alone.
  const claude = join(base, "claude", "brain", ID, ...logs, "transcript_full.jsonl");
  mkdirSync(dirname(claude), { recursive: true });
  writeFileSync(claude, `${[
    { type: "user", timestamp: at(0), message: { role: "user", content: "Count the widgets" } },
    { type: "assistant", timestamp: at(1), message: { id: "msg_000001", role: "assistant", content: [{ type: "text", text: "Three." }] } },
  ].map((l) => JSON.stringify(l)).join("\n")}\n`);
  expect(JSON.parse(execFileSync("bun", [join(core, "atif.js"), claude, "claude"], { encoding: "utf8" })).session_id).toBe("transcript_full");
});

test("antigravity: a result step rewritten under its step_index is read whole from its last line: outcome, text and time", () => {
  const view = ["view_file", { AbsolutePath: "/home/dev/plinth/widgets.txt" }];
  const file = transcript([
    user("Count the widgets", 0),
    plan(1, [view, view, view]),
    // ERROR, then DONE: the DONE text with no outcome, not the ERROR's true.
    { ...out(2, "ERROR", at(1), at(2), "Encountered error in step execution: busy", { error: "busy" }), step_index: 2 },
    { ...out(4, "DONE", at(1), at(4), "widgets"), step_index: 2 },
    // DONE, then ERROR: the ERROR's text and true.
    { ...out(5, "DONE", at(1), at(5), "widgets"), step_index: 3 },
    { ...out(6, "ERROR", at(1), at(6), "Encountered error in step execution: busy", { error: "busy" }), step_index: 3 },
    // ERROR with a time, then DONE with none: no time, not the ERROR's.
    { ...out(7, "ERROR", at(1), at(7), "Encountered error in step execution: busy", { error: "busy" }), step_index: 4 },
    { ...out(null, "DONE", null, null, "widgets"), step_index: 4 },
    plan(9, [], "Done."),
  ]);
  const got = resultsOf(exportOf(file));
  expect(Object.fromEntries(Object.entries(got).map(([id, { r }]) => [id, [r.content, r.extra]]))).toEqual({
    "s1.0": ["widgets", { result_ts: "2026-01-05T15:07:04.000Z" }],
    "s1.1": ["Encountered error in step execution: busy", { result_ts: "2026-01-05T15:07:06.000Z", tool_result_is_error: true }],
    "s1.2": ["widgets", undefined],
  });
});

test("antigravity: a FAILED call failed, as an ERROR one does; a call whose status the export does not know leaves the flag out", () => {
  const file = transcript([
    user("Count the widgets", 0),
    plan(1, [["run_command", { CommandLine: "sort widgets.txt" }], ["run_command", { CommandLine: "wc -l widgets.txt" }]]),
    out(2, "FAILED", at(1), at(2), "sort: widgets.txt: Permission denied"),
    out(3, "CANCELED", at(2), at(3), "Command output:\n3 widgets.txt"),
    plan(4, [], "No sort."),
  ]);
  const got = resultsOf(exportOf(file));
  expect([got["s1.0"].r.content, got["s1.0"].r.extra]).toEqual(["sort: widgets.txt: Permission denied", { result_ts: "2026-01-05T15:07:02.000Z", tool_result_is_error: true }]);
  expect([got["s1.1"].r.content, got["s1.1"].r.extra]).toEqual(["Command output:\n3 widgets.txt", { result_ts: "2026-01-05T15:07:03.000Z" }]);
});

test("antigravity: an end of 0, one that is not a time, none at all, or one before the call gives no result_ts, and the outcome stays; one at the call counts", () => {
  const file = transcript([
    user("Count the widgets", 0),
    plan(10, [0, 1, 2, 3, 4, 5].map(() => ["view_file", { AbsolutePath: "/home/dev/plinth/widgets.txt" }])),
    out(11, "DONE", at(10), at(11), "widgets"),
    out(null, "ERROR", null, "1970-01-01T00:00:00Z", "widgets"),
    out(null, "DONE", null, "soon", "widgets"),
    out(null, "ERROR", null, null, "widgets"),
    out(12, "DONE", at(5), at(5), "widgets"),
    out(13, "ERROR", at(10), at(10), "widgets"),
    plan(20, [], "Done."),
  ]);
  const got = resultsOf(exportOf(file));
  expect(got["s1.0"].r.extra).toEqual({ result_ts: "2026-01-05T15:07:11.000Z" });
  expect(got["s1.5"].r.extra).toEqual({ result_ts: "2026-01-05T15:07:10.000Z", tool_result_is_error: true });
  for (const [id, extra] of [["s1.1", { tool_result_is_error: true }], ["s1.2", undefined], ["s1.3", { tool_result_is_error: true }], ["s1.4", undefined]]) {
    expect([id, got[id].r.content, got[id].r.extra]).toEqual([id, "widgets", extra]);
  }
});

test("antigravity: an end on a day that does not exist (Feb 30, Apr 31, Feb 29 of 2027) gives no result_ts, a real leap day does, and a start on such a day compares as no start", () => {
  // Date.parse rolls a day the month lacks into the next month: 2026-02-30 would read as March 2.
  const view = ["view_file", { AbsolutePath: "/home/dev/plinth/widgets.txt" }];
  const file = transcript([
    user("Count the widgets", "2026-02-01T15:07:00Z"),
    plan("2026-02-01T15:07:01Z", [view, view, view, view, view]),
    out(null, "ERROR", null, "2026-02-30T15:07:02Z", "widgets"),
    out(null, "DONE", null, "2026-04-31T15:07:02Z", "widgets"),
    out(null, "ERROR", null, "2027-02-29T15:07:02Z", "widgets"),
    out(null, "DONE", null, "2028-02-29T15:07:02Z", "widgets"),
    out(null, "DONE", null, "2026-02-28T15:07:02-06:00", "widgets"),
    plan("2026-02-01T15:07:09Z", [], "Done."),
    user("Count them again", "2026-03-01T15:07:00Z"),
    // A start that does not exist: read, it would be March 2, after the call's real end.
    plan("2026-02-30T15:07:01Z", [view]),
    out(null, "DONE", null, "2026-03-01T15:07:02Z", "widgets"),
    plan("2026-03-01T15:07:09Z", [], "Done."),
  ]);
  const got = resultsOf(exportOf(file));
  const extras = Object.fromEntries(Object.entries(got).map(([id, { r }]) => [id, r.extra]));
  expect(extras).toEqual({
    "s1.0": { tool_result_is_error: true },
    "s1.1": undefined,
    "s1.2": { tool_result_is_error: true },
    "s1.3": { result_ts: "2028-02-29T15:07:02.000Z" },
    "s1.4": { result_ts: "2026-02-28T21:07:02.000Z" },
    "s9.0": { result_ts: "2026-03-01T15:07:02.000Z" },
  });
});

test("antigravity: with no planner time to compare it with, a result's own end still counts, but not an end of 0", () => {
  const file = transcript([
    user("Count the widgets", 0),
    plan(null, [["view_file", { AbsolutePath: "/home/dev/plinth/widgets.txt" }], ["view_file", { AbsolutePath: "/home/dev/plinth/widgets.txt" }]]),
    out(2, "DONE", null, at(2), "widgets"),
    out(null, "DONE", null, "1970-01-01T00:00:00Z", "widgets"),
    plan(5, [], "Done."),
  ]);
  const got = resultsOf(exportOf(file));
  expect(got["s1.0"].r.extra).toEqual({ result_ts: "2026-01-05T15:07:02.000Z" });
  expect([got["s1.1"].r.content, got["s1.1"].r.extra]).toEqual(["widgets", undefined]);
});
