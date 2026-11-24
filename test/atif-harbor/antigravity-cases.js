// Adapted from harbor-framework/harbor, tests/unit/agents/installed/test_antigravity_cli.py at
// 110c71b32c268e1d113c3856869202842f8e37a6 (0.26.0).
// Copyright the Harbor authors. Apache-2.0; see LICENSE beside this file.
// Ported: the trajectory items of TestAntigravityStepTranscript, the named entries in
// ANTIGRAVITY_CASES below; the other trajectory items (that class's legacy Gemini session test,
// TestAntigravityTrajectoryLoading and TestAntigravityStreamUsage) are in LEFT_OUT
// (differences.js). The rest of the file tests Harbor's install, authentication, settings and
// run commands, which have no counterpart in an export.
// Changed from Harbor's original: the pytest functions are translated to JavaScript case entries that
// run our export's command line; the diff checks are ours, and "Adapted:" marks changed input.
// Harbor reads a copy of the file Agent Threads reads, agy's step transcript
// (transcript_full.jsonl), so each case writes Harbor's records as the file's lines, unchanged,
// as antigravity-cli.trajectory.jsonl. Adapted: a newline after the last record, as agy writes
// it; Harbor's _write leaves it out, and Agent Threads leaves a line with no newline unread
// (agy may still be writing it).
// Harbor's assertion on its run context (AgentContext) is left out: an export fills no context.
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Harbor's _write: one JSON line per record (Adapted: and a newline after the last).
export function writeAgy(dir, records) {
  const path = join(dir, "antigravity-cli.trajectory.jsonl");
  writeFileSync(path, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`);
  return path;
}
// A case's files: Harbor's records (a function of nothing, so each run gets fresh objects).
const transcript = (records) => (dir) => ({ main: writeAgy(dir, records()) });

// Harbor's _live_records.
const liveRecords = () => [
  { step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", created_at: "2026-08-18T19:24:48Z", content: "<USER_REQUEST>\nCreate hello.txt\n</USER_REQUEST>" },
  { step_index: 1, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", created_at: "2026-08-18T19:24:48Z", tool_calls: [{ name: "write_to_file", args: { TargetFile: "/app/hello.txt" } }] },
  { step_index: 2, source: "MODEL", type: "CODE_ACTION", status: "DONE", created_at: "2026-08-18T19:24:50Z", content: "Created file file:///app/hello.txt" },
  { step_index: 3, source: "SYSTEM", type: "CHECKPOINT", status: "DONE", created_at: "2026-08-18T19:24:50Z", content: "{{ CHECKPOINT 0 }} summary" },
  { step_index: 4, source: "MODEL", type: "PLANNER_RESPONSE", status: "DONE", created_at: "2026-08-18T19:24:50Z", content: "Created hello.txt." },
];
// The call, with its arguments read whole from calls.sh, and its CODE_ACTION result not read
// (R20): an observation entry marked as having none.
const writeCall = (step) => {
  assert.deepEqual(step.tool_calls, [{ tool_call_id: "s1.0", function_name: "write_to_file", arguments: { TargetFile: "/app/hello.txt" } }]);
  assert.deepEqual(step.observation.results, [{ source_call_id: "s1.0", extra: { no_result: true } }]);
};

export const ANTIGRAVITY_CASES = [
  {
    id: "antigravity: converts_live_shaped_transcript_to_atif",
    files: transcript(liveRecords),
    diff: { reason: "R20", kind: "not handled", check: (t) => {
      assert.deepEqual(t.steps.map((s) => s.source), ["user", "agent", "agent"]);
      writeCall(t.steps[1]);
      assert.equal(t.steps[2].message, "Created hello.txt.");
      assert.ok(!t.steps.some((s) => JSON.stringify(s).includes("CHECKPOINT")));
    } },
    facts: (t) => {
      const sources = t.steps.map((s) => s.source);
      assert.deepEqual(sources, ["user", "agent", "agent"]);
      const agentStep = t.steps[1];
      assert.equal(agentStep.tool_calls[0].function_name, "write_to_file");
      // The CODE_ACTION result folds into the issuing planner step.
      assert.equal(agentStep.observation.results[0].content, "Created file file:///app/hello.txt");
      // CHECKPOINT is agy-internal context management, not an agent step.
      assert.ok(!t.steps.some((s) => JSON.stringify(s).includes("CHECKPOINT")));
    },
  },
  {
    id: "antigravity: snapshot_records_are_deduped",
    files: transcript(() => {
      const records = liveRecords();
      const pending = { ...records[4], status: "PENDING", content: "partial…" };
      return [...records.slice(0, 4), pending, records[4]];
    }),
    diff: { reason: "R21", kind: "not handled", check: (t) => {
      // The PENDING snapshot is read, and the DONE one after it too: both texts, in one reply.
      assert.deepEqual(t.steps.filter((s) => s.source === "agent").map((s) => s.message), ["", "partial…\n\nCreated hello.txt."]);
    } },
    facts: (t) => {
      const finalMessages = t.steps.filter((s) => s.source === "agent").map((s) => s.message);
      assert.ok(!finalMessages.includes("partial…"));
      assert.ok(finalMessages.includes("Created hello.txt."));
    },
  },
  {
    id: "antigravity: millisecond_timestamps_are_normalized",
    files: transcript(() => {
      const records = liveRecords();
      records[0].created_at = 1787426688000;
      return records;
    }),
    diff: { reason: "R22", kind: "not handled", check: (t) => {
      // The prompt's time is not read; the reply's string time still is.
      assert.equal(t.steps[0].timestamp, undefined);
      assert.equal(t.steps[0].message, "Create hello.txt");
      assert.equal(t.steps[2].extra.end_ts, "2026-08-18T19:24:50.000Z");
    } },
    facts: (t) => {
      // Adapted: the timestamp must be a string before its start is read, so a missing one fails
      // on an assertion, not on a type error.
      assert.equal(typeof t.steps[0].timestamp, "string");
      assert.ok(t.steps[0].timestamp.startsWith("2026-"));
    },
  },
  {
    id: "antigravity: orphan_error_record_becomes_system_step",
    files: transcript(() => [...liveRecords(), { step_index: 5, source: "SYSTEM", type: "TOOL_RESULT", status: "ERROR", created_at: "2026-08-18T19:24:51Z", error: "tool exploded" }]),
    diff: { reason: "R20", kind: "not handled", check: (t) => {
      assert.deepEqual(t.steps.map((s) => [s.source, s.message]), [["user", "Create hello.txt"], ["agent", ""], ["agent", "Created hello.txt."]]);
      assert.ok(!JSON.stringify(t).includes("tool exploded"));
    } },
    facts: (t) => {
      assert.equal(t.steps.at(-1).source, "system");
      assert.ok(t.steps.at(-1).message.includes("tool exploded"));
    },
  },
  {
    id: "antigravity: distinct_terminal_records_sharing_a_key_are_both_kept",
    files: transcript(() => {
      const records = liveRecords();
      return [...records, { ...records[4], content: "Follow-up message." }];
    }),
    diff: { reason: "R21", kind: "by design", check: (t) => {
      // Both texts are kept, in order, as the turn's one reply.
      assert.deepEqual(t.steps.map((s) => s.message), ["Create hello.txt", "", "Created hello.txt.\n\nFollow-up message."]);
    } },
    facts: (t) => {
      const messages = t.steps.map((s) => s.message);
      assert.ok(messages.includes("Created hello.txt."));
      assert.ok(messages.includes("Follow-up message."));
    },
  },
];
