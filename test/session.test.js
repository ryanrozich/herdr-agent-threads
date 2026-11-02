// bun test: session mapping helpers (pure, no Herdr).
import { test, expect } from "bun:test";
import { argvSession, slug, validId, recordSession, decide, dividerLabel, candidates, claudePaths } from "../mods/agent-threads/session.js";
import { newSession } from "../mods/agent-threads/turns.js";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

test("argvSession: every form, and --fork-session names no file", () => {
  expect(argvSession(["claude", "--resume", A])).toBe(A);
  expect(argvSession(["claude", "-r", A])).toBe(A);
  expect(argvSession(["claude", "--session-id", A])).toBe(A);
  expect(argvSession(["claude", `--resume=${A}`])).toBe(A);
  expect(argvSession(["claude", `--session-id=${A}`])).toBe(A);
  expect(argvSession(["claude", "--resume"])).toBe(null);
  expect(argvSession(["claude", "--resume", "not-an-id"])).toBe(null);
  expect(argvSession(["claude", "--resume", A, "--fork-session"])).toBe(null);
  expect(argvSession(["claude", "--fork-session", `--resume=${A}`])).toBe(null);
  expect(argvSession(undefined)).toBe(null);
});

test("slug: every character but letters and digits becomes a dash", () => {
  expect(slug("/Users/a/.config/x")).toBe("-Users-a--config-x");
  expect(slug("/tmp/my_app")).toBe("-tmp-my-app");
  expect(slug("/tmp/My App")).toBe("-tmp-My-App");
  expect(slug("/tmp/a@b.c")).toBe("-tmp-a-b-c");
  expect(slug("/tmp/threads-demo")).toBe("-tmp-threads-demo");
});

test("ids are validated wherever they come from", () => {
  expect(validId(A)).toBe(true);
  expect(validId("../../etc/passwd")).toBe(false);
  expect(validId("0000000-0000-4000-8000-00000000000a")).toBe(false);
  expect(validId(`${A}x`)).toBe(false);
  expect(recordSession(JSON.stringify({ pid: 1, sessionId: A }))).toBe(A);
  expect(recordSession(JSON.stringify({ pid: 1, sessionId: "*" }))).toBe(null);
  expect(recordSession("{not json")).toBe(null);
  expect(recordSession(null)).toBe(null);
});

test("claudeHome reaches every path", () => {
  const p = claudePaths("/home/x", "/fake/claude");
  expect([p.projects, p.sessions, p.record(42), p.project("/tmp/d"), p.transcript("/tmp/d", A)]).toEqual([
    "/fake/claude/projects", "/fake/claude/sessions", "/fake/claude/sessions/42.json",
    "/fake/claude/projects/-tmp-d", `/fake/claude/projects/-tmp-d/${A}.jsonl`,
  ]);
  expect(claudePaths("/home/x").root).toBe("/home/x/.claude");
  expect(claudePaths("/home/x", "").record(1)).toBe("/home/x/.claude/sessions/1.json");
});

test("decide: same, new, pending, keep and none", () => {
  const cur = { id: A, file: `/p/${A}.jsonl`, guess: false };
  expect(decide({ id: A, file: cur.file }, cur)).toBe("same");
  expect(decide({ id: B, file: `/p/${B}.jsonl` }, cur)).toBe("new");
  expect(decide({ id: B, file: null }, cur)).toBe("pending");
  expect(decide({ id: A, file: null }, cur)).toBe("same");
  expect(decide({ id: B, file: `/p/${B}.jsonl`, guess: true }, cur)).toBe("keep");
  expect(decide({ id: B, file: `/p/${B}.jsonl`, guess: true }, { ...cur, guess: true })).toBe("new");
  expect(decide({ id: B, file: `/p/${B}.jsonl` }, null)).toBe("new");
  expect(decide({ id: B, file: null }, null)).toBe("pending");
  expect(decide(null, cur)).toBe("none");
});

test("divider label: /clear only when the file starts with one", () => {
  const s = newSession(B, "f");
  s.startedAt = new Date(2026, 10, 1, 13, 12).getTime();
  expect(dividerLabel(s)).toBe("New session · 1:12\u00a0PM");
  s.clearAt = new Date(2026, 10, 1, 14, 31).getTime();
  expect(dividerLabel(s)).toBe("New session · /clear at 2:31\u00a0PM");
  expect(dividerLabel(newSession(B, "f"))).toBe("New session");
});

test("candidates drop files other live sessions hold and keep five", () => {
  const files = Array.from({ length: 8 }, (_, i) => ({ path: `/p/00000000-0000-4000-8000-00000000000${i}.jsonl` }));
  const held = new Set(["00000000-0000-4000-8000-000000000000", "00000000-0000-4000-8000-000000000002"]);
  const got = candidates(files, held).map((f) => f.path.slice(-7, -6));
  expect(got).toEqual(["1", "3", "4", "5", "6"]);
  expect(candidates(["/p/x.jsonl"], new Set()).length).toBe(1);
});
