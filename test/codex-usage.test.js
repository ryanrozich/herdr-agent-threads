// bun test: Codex's token counts are counted once per model response. codex-cli 0.171 writes a
// token_count after each response; when a response reports no usage it writes the last count
// again, the same running total and the same last usage, and a first count can have info null.
// The rollouts in test/fixtures/codex are written by hand in those shapes, with made-up text:
//   usage-repeated.jsonl         a count of 123 in and 7 out, then the same count again
//   usage-null-then-known.jsonl  a count with info null, then 123 in and 7 out
// The reader keys a count by its running total (extract-codex.jq) and keeps one usage per key
// (turns.js), so a repeat replaces rather than adds.
import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply, parseChunk, nextChunk, stats, sessionStats } from "../mods/agent-threads/core/turns.js";
import { statusGroups } from "../mods/agent-threads/ui.js";
import { problems } from "./atif-schema.js";

const root = join(import.meta.dir, "..");
const core = join(root, "mods/agent-threads/core");
const fixtures = join(root, "test/fixtures/codex");

function read(file) {
  const s = newSession("s", file);
  const base = 1 << 20;
  let chunk = base;
  for (let guard = 0; guard < 1000 && chunk; guard++) {
    const r = parseChunk(execFileSync("sh", [join(core, "extract.sh"), file, String(s.offset), String(chunk), "codex"], { encoding: "utf8" }));
    s.size = r.size;
    for (const e of r.events) apply(s, e);
    s.offset += r.used;
    chunk = nextChunk(s, r.used, chunk, base);
  }
  return s;
}

const exportOf = (file) => JSON.parse(execFileSync("bun", [join(core, "atif.js"), file, "codex"], { encoding: "utf8" }));

// The token figure in the status line at the Chat pane's foot, in a pane wide enough for all of it.
const footTokens = (s) => statusGroups({ turns: s.turns.length, hidden: 0, ...sessionStats(s.turns) }, 2000).find((g) => g.key === "tokens")?.text;

for (const [name, shape] of [["usage-repeated.jsonl", "a count repeated after a response that reports none"], ["usage-null-then-known.jsonl", "a count with info null before a known one"]]) {
  const file = join(fixtures, name);

  test(`codex usage, ${shape}: the export has one agent step with 123 in and 7 out, and final_metrics the same`, () => {
    const t = exportOf(file);
    expect(problems(t)).toEqual([]);
    const counted = t.steps.filter((st) => st.metrics);
    expect(counted).toHaveLength(1);
    expect(counted[0].source).toBe("agent");
    expect(counted[0].metrics).toEqual({ prompt_tokens: 123, completion_tokens: 7, cached_tokens: 0, extra: { cache_creation_input_tokens: 0, scope: "turn", model_messages: 1 } });
    expect(t.final_metrics).toEqual({ total_prompt_tokens: 123, total_completion_tokens: 7, total_cached_tokens: 0, total_steps: t.steps.length });
  });

  test(`codex usage, ${shape}: the reader's turn total and the Chat foot count 123 in and 7 out once`, () => {
    const s = read(file);
    expect(s.offset).toBe(s.size);
    expect(s.turns).toHaveLength(1);
    expect(Object.keys(s.turns[0].usage)).toHaveLength(1);
    expect(stats(s.turns[0])).toMatchObject({ input: 123, output: 7, cacheRead: 0, cacheWrite: 0, tokens: 130 });
    expect(sessionStats(s.turns)).toMatchObject({ tokens: 130, context: 123 });
    expect(footTokens(s)).toBe("130 tokens · 0% cache hit");
  });
}

// The running total is the only name a count has. Two responses that both report a zero total
// share it, so the second replaces the first: the turn shows one model message where there
// were two. Codex's counts give nothing better to tell them apart; the miss only ever counts
// fewer responses, never more tokens.
test("codex usage, known limit: two responses that both report zero look like one (under-counted, never over-counted)", () => {
  const ts = (s) => `2026-01-03T06:00:0${s}.000Z`;
  const zero = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };
  const count = (s) => ({ timestamp: ts(s), type: "event_msg", payload: { type: "token_count", info: { total_token_usage: zero, last_token_usage: zero, model_context_window: 258400 }, rate_limits: null } });
  const lines = [
    { timestamp: ts(0), type: "session_meta", payload: { id: "00000000-0000-7000-8000-000000000103", cwd: "/work/demo" } },
    { timestamp: ts(0), type: "turn_context", payload: { cwd: "/work/demo", model: "gpt-5.5-codex", effort: "medium" } },
    { timestamp: ts(1), type: "event_msg", payload: { type: "item_completed", turn_id: "turn-000001", item: { type: "UserMessage", id: "000001", content: [{ type: "text", text: "Count the kiwi list." }] } } },
    { timestamp: ts(2), type: "response_item", payload: { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "Counting." }] } },
    { timestamp: ts(3), type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "call_000001", arguments: '{"cmd":"wc -l lists/kiwi.txt"}' } },
    count(3),
    { timestamp: ts(4), type: "response_item", payload: { type: "function_call_output", call_id: "call_000001", output: "Process exited with code 0\nOutput:\n3 lists/kiwi.txt" } },
    { timestamp: ts(5), type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "Three kiwis." }] } },
    count(5),
    { timestamp: ts(5), type: "event_msg", payload: { type: "task_complete", turn_id: "turn-000001", duration_ms: 4000 } },
  ];
  const file = join(mkdtempSync(join(tmpdir(), "threads-codex-usage-")), "rollout-2026-01-03T06-00-00-00000000-0000-7000-8000-000000000103.jsonl");
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  const s = read(file);
  expect(Object.keys(s.turns[0].usage)).toHaveLength(1);
  expect(stats(s.turns[0])).toMatchObject({ input: 0, output: 0, tokens: 0 });
  const t = exportOf(file);
  const counted = t.steps.filter((st) => st.metrics);
  expect(counted).toHaveLength(1);
  expect(counted[0].metrics.extra.model_messages).toBe(1);
  expect(t.final_metrics).toMatchObject({ total_prompt_tokens: 0, total_completion_tokens: 0 });
});
