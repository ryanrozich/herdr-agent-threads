// bun test: the opening's loading state (ui.js openLines, newestPrompt, fmtSpan, figRuns),
// pure. The pane's side is in render.test.js ("the opening: …").
import { test, expect } from "bun:test";
import { openLines, newestPrompt, fmtSpan, figRuns, openWhen, OPEN_ROWS } from "../mods/agent-threads/ui.js";
import { fmtTokens, fmtBytes } from "../mods/agent-threads/core/turns.js";

// Decimal megabytes, as a file listing shows them.
const MB = 1e6;
const start = Date.UTC(2026, 10, 17, 8, 0);
const base = { offset: 0, size: 518.2 * MB, pct: null, units: "bytes", turns: 0, loaded: false, agent: "Claude Code", model: null, start: null, active: null, working: false, prompts: null, tools: null, tokens: null, pins: 0, newest: null, now: start + 6 * 86400000 + 6 * 3600000 };

test("opening: every line has its row from the first paint, empty until its figure is known, so a figure arriving moves nothing", () => {
  const first = openLines(base);
  expect(first.length).toBe(OPEN_ROWS);
  expect(first[0]).toBe("Reading this session");
  // Only the total before the first chunk: no 0%, no made-up figure.
  expect(first[1]).toBe("518.2 MB");
  expect(first.slice(2)).toEqual(["", "Claude Code", "", "", "", "", ""]);
  const mid = openLines({ ...base, offset: 214.6 * MB, pct: 41, turns: 1912, model: "claude-opus-5-5", start, active: base.now - 12 * 60000, prompts: 1804, tools: 14380, tokens: 1234567, pins: 3,
    newest: { text: "Turn 1600: check the cart total again", ts: start + 6 * 86400000 } });
  expect(mid.length).toBe(OPEN_ROWS);
  expect(mid[1]).toBe("214.6 of 518.2 MB · 41%");
  expect(mid[2]).toBe("1,912 turns so far");
  expect(mid[3]).toBe("Claude Code · opus 5.5");
  expect(mid[4]).toBe(`Started ${openWhen(start, base.now)} · last active ${openWhen(base.now - 12 * 60000, base.now)}`);
  expect(mid[5]).toBe("Spans 6d 5h");
  expect(mid[6]).toBe(`So far: 1,804 prompts · 14,380 tool calls · ${fmtTokens(1234567)} tokens · 3 pins`);
  expect(mid[7]).toBe(`Newest prompt · ${openWhen(start + 6 * 86400000, base.now)}`);
  expect(mid[8]).toBe("Turn 1600: check the cart total again");
});

test("opening: a session the agent is working on says so in place of last active, only once the read is complete", () => {
  const o = { ...base, offset: 100 * MB, pct: 19, start, active: start + 3600000, working: true };
  // Not known before the read ends: last active stays.
  expect(openLines(o)[4]).toMatch(/last active/);
  const done = openLines({ ...o, loaded: true, offset: o.size, pct: 100 });
  expect(done[4]).toBe(`Started ${openWhen(start, base.now)} · Working now`);
  expect(openLines({ ...o, loaded: true, working: false })[4]).toBe(`Started ${openWhen(start, base.now)} · last active ${openWhen(start + 3600000, base.now)}`);
  expect(done[2]).toBe("0 turns");
});

test("opening: OpenCode counts prompts read, not bytes; a count the session does not record is left out, never 0", () => {
  const o = openLines({ ...base, units: "turns", size: 1600, offset: 412, pct: 26, prompts: 400, tools: 9, tokens: null, pins: 0 });
  expect(o[1]).toBe("412 of 1,600 prompts · 26%");
  expect(o[6]).toBe("So far: 400 prompts · 9 tool calls");
  expect(openLines({ ...base, prompts: 1, tools: 1, tokens: 1, pins: 1 })[6]).toBe("So far: 1 prompt · 1 tool call · 1 tokens · 1 pin");
});

test("opening: Spans is the time from the first prompt to the last write, idle gaps included", () => {
  expect(fmtSpan(0)).toBe("");
  expect(fmtSpan(42000)).toBe("42s");
  expect(fmtSpan(3 * 3600000 + 5 * 60000)).toBe("3h 05m");
  expect(fmtSpan(6 * 86400000 + 6 * 3600000 + 59 * 60000)).toBe("6d 6h");
  expect(openLines({ ...base, start, active: start - 1 })[5]).toBe("");
});

test("opening: the newest prompt is the newest one a person typed, by the bubble's rule, as plain text with its whitespace collapsed", () => {
  const you = (prompt, ts, more = {}) => ({ sender: { kind: "you" }, agent: false, cmd: false, prompt, ts, ...more });
  const turns = [
    you("an older prompt", 1),
    you("  the **newest**\n\n  typed   prompt\twith `code`  ", 2),
    { sender: { kind: "agent", name: "helper" }, agent: true, cmd: false, prompt: "an agent message", ts: 3 },
    { sender: { kind: "task-notification" }, agent: true, cmd: false, prompt: "", ts: 4 },
    you("/review-pr 12", 5, { cmd: true }),
  ];
  expect(newestPrompt(turns)).toEqual({ text: "the **newest** typed prompt with `code`", ts: 2 });
  expect(newestPrompt(turns.slice(2))).toBeNull();
  expect(newestPrompt([])).toBeNull();
});

test("opening: figures are drawn a digit to a fixed cell (tabular), the rest as text", () => {
  expect(figRuns("214.6 of 518.2 MB · 41%")).toEqual([["214.6", true], [" of ", false], ["518.2", true], [" MB · ", false], ["41", true], ["%", false]]);
  expect(figRuns("1,912 turns so far")).toEqual([["1,912", true], [" turns so far", false]]);
  expect(figRuns("Reading this session")).toEqual([["Reading this session", false]]);
  expect(figRuns("")).toEqual([]);
});

test("opening: sizes are decimal MB, as a file listing shows them, in the loading state and in Reading session (size)", () => {
  // A 499,185,946-byte file: 499.2 MB (it is 476.1 MiB), 29,100,000 bytes read of it.
  const L = openLines({ ...base, size: 499185946, offset: 29100000, pct: 6 });
  expect(L[1]).toBe("29.1 of 499.2 MB · 6%");
  expect(openLines({ ...base, size: 499185946 })[1]).toBe("499.2 MB");
  expect(fmtBytes(499185946)).toBe("499 MB");
  expect(fmtBytes(180400000)).toBe("180 MB");
  expect(fmtBytes(1000000)).toBe("1 MB");
  expect(fmtBytes(999499)).toBe("999 KB");
  // Never "1000 KB": what rounds to 1,000 KB is 1 MB.
  expect(fmtBytes(999700)).toBe("1 MB");
  expect(fmtBytes(1500)).toBe("2 KB");
  expect(fmtBytes(200)).toBe("1 KB");
});
