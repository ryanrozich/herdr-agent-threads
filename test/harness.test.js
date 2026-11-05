// bun test: which agent a terminal runs, and how a terminal finds its session, as pure functions.
import { test, expect } from "bun:test";
import {
  harnessOf, harnessOfFile, idOfFile, dbOfFile, fileChanged, codexArgvSession, opencodeArgv, etimeMs,
  pickOpenCode, openCodeTitleMatch, openCodeLabel, quotePaste,
} from "../mods/agent-threads/harness.js";
import { canQuote } from "../mods/agent-threads/ui.js";
import { shortModel } from "../mods/agent-threads/turns.js";

const CODEX_ID = "00000000-0000-7000-8000-000000000001";

test("harnessOf reads the foreground program", () => {
  expect(harnessOf({ argv: ["codex"], name: "codex" })).toBe("codex");
  expect(harnessOf({ argv: ["/opt/bin/opencode", "-m", "x"], name: "opencode" })).toBe("opencode");
  expect(harnessOf({ argv: ["node", "/usr/lib/node_modules/.bin/codex"], name: "node" })).toBe("codex");
  expect(harnessOf({ argv: ["node", "/x/opencode.js"], name: "node" })).toBe("opencode");
  expect(harnessOf({ argv: ["claude"], name: "claude" })).toBe("claude");
  expect(harnessOf({ argv: [], name: "2.1.316" })).toBe("claude");
  expect(harnessOf({}, { app: "claude-code" })).toBe("claude");
  expect(harnessOf({ argv: ["zsh"], name: "zsh" })).toBe(null);
  expect(harnessOf({ argv: ["node", "/x/server.js"], name: "node" })).toBe(null);
  expect(harnessOf(null, null)).toBe(null);
});

test("a session's file says which agent it belongs to, and its id", () => {
  const rollout = `/h/.codex/sessions/2026/01/02/rollout-2026-01-02T03-04-05-${CODEX_ID}.jsonl`;
  expect(harnessOfFile(rollout)).toBe("codex");
  expect(idOfFile(rollout)).toBe(CODEX_ID);
  expect(harnessOfFile("/h/.local/share/opencode/opencode.db#ses_abc")).toBe("opencode");
  expect(idOfFile("/h/.local/share/opencode/opencode.db#ses_abc")).toBe("ses_abc");
  expect(dbOfFile("/h/.local/share/opencode/opencode.db#ses_abc")).toBe("/h/.local/share/opencode/opencode.db");
  expect(harnessOfFile("/h/.claude/projects/-x/abc.jsonl")).toBe("claude");
  expect(idOfFile("/h/.claude/projects/-x/abc.jsonl")).toBe("abc");
  expect(harnessOfFile(null)).toBe("claude");
});

test("a folder watch counts OpenCode's -wal file as its session changing", () => {
  const f = "/d/opencode.db#ses_a";
  expect(fileChanged(f, ["/d/opencode.db-wal"])).toBe(true);
  expect(fileChanged(f, ["/d/opencode.db"])).toBe(true);
  expect(fileChanged(f, ["/d/opencode.db-shm", "/d/other"])).toBe(false);
  expect(fileChanged("/a/x.jsonl", ["/a/x.jsonl"])).toBe(true);
  expect(fileChanged("/a/x.jsonl", ["/a/y.jsonl"])).toBe(false);
  expect(fileChanged(null, ["/a/x.jsonl"])).toBe(false);
});

test("command lines name a session only when they write to it", () => {
  expect(codexArgvSession(["codex", "resume", CODEX_ID])).toBe(CODEX_ID);
  expect(codexArgvSession(["codex", "resume", "--last"])).toBe(null);
  expect(codexArgvSession(["codex", "fork", CODEX_ID])).toBe(null);
  expect(codexArgvSession(null)).toBe(null);
  expect(opencodeArgv(["opencode", "-s", "ses_a1"])).toEqual({ id: "ses_a1", cont: false });
  expect(opencodeArgv(["opencode", "--session=ses_a1"])).toEqual({ id: "ses_a1", cont: false });
  expect(opencodeArgv(["opencode", "--session", "ses_a1", "--fork"])).toEqual({ id: null, cont: false });
  expect(opencodeArgv(["opencode", "-c"])).toEqual({ id: null, cont: true });
  expect(opencodeArgv(["opencode", "-s", "; rm -rf"])).toEqual({ id: null, cont: false });
});

test("etimeMs reads ps elapsed time", () => {
  expect(etimeMs("03:04")).toBe(184000);
  expect(etimeMs(" 02:03:04 ")).toBe(7384000);
  expect(etimeMs("1-02:03:04")).toBe(93784000);
  expect(etimeMs("")).toBe(null);
  expect(etimeMs(null)).toBe(null);
});

const s = (id, updated, created = updated, title = "New session - 2026-01-02", first = null) => ({ id, updated, created, title, first });

test("a fresh OpenCode process does not take an older session", () => {
  const list = [s("ses_old", 1000)];
  expect(pickOpenCode(list, 5000, 0, {}, null)).toEqual({ id: null, guess: false, via: null, choices: list });
  expect(pickOpenCode([], 5000, 0, {}, null).id).toBe(null);
});

test("alone in the folder, OpenCode's session is the newest one since it started", () => {
  const list = [s("ses_b", 9000, 7000), s("ses_a", 8000, 6000), s("ses_old", 1000)];
  expect(pickOpenCode(list, 5000, 0, {}, null)).toEqual({ id: "ses_b", guess: false, via: "folder", choices: [] });
  // A follow-up in the older of the two does not move it back: created decides.
  const later = [s("ses_a", 9500, 6000), s("ses_b", 9000, 7000)];
  expect(pickOpenCode(later, 5000, 0, {}, null).id).toBe("ses_b");
});

test("OpenCode 2.x keeps its sessions as tabs, so the one whose turn began last is the terminal's", () => {
  const list = [{ ...s("ses_a", 9500, 6000), busy: 9400 }, { ...s("ses_b", 9000, 7000), busy: 7100 }];
  expect(pickOpenCode(list, 5000, 0, {}, null)).toEqual({ id: "ses_a", guess: false, via: "folder", choices: [] });
  // A tab /new made, with no prompt yet, is newer than any turn.
  const fresh = [...list, { ...s("ses_c", 9600, 9600), busy: null }];
  expect(pickOpenCode(fresh, 5000, 0, {}, null).id).toBe("ses_c");
});

test("with another OpenCode in the folder it is a guess, and it stays on the one shown", () => {
  const list = [s("ses_b", 9000), s("ses_a", 8000)];
  const first = pickOpenCode(list, 5000, 1, {}, null);
  expect(first).toEqual({ id: "ses_b", guess: true, via: "cwd", choices: list });
  expect(pickOpenCode(list, 5000, 1, {}, "ses_a").id).toBe("ses_a");
});

test("the terminal's title settles it, and beats the command line after a switch", () => {
  const list = [s("ses_b", 9000, 9000, "Baking bread"), s("ses_a", 8000, 8000, "Fruit list")];
  expect(pickOpenCode(list, 5000, 1, {}, "ses_b", "OC | Fruit list")).toEqual({ id: "ses_a", guess: false, via: "title", choices: [] });
  expect(pickOpenCode(list, 5000, 0, { id: "ses_b" }, null, "OC | Fruit list").id).toBe("ses_a");
  // A session opened from OpenCode's list counts, however long ago it last changed.
  expect(pickOpenCode(list, 99999, 0, {}, null, "OC | Fruit list").id).toBe("ses_a");
  expect(pickOpenCode(list, 5000, 1, {}, null, "OpenCode").guess).toBe(true);
});

test("openCodeTitleMatch handles a cut title and refuses two that fit", () => {
  const list = [s("a", 1, 1, "The moon orbits Earth and reflects sunlight"), s("b", 1, 1, "The sea"), s("c", 1, 1, "The sea")];
  expect(openCodeTitleMatch(list, "OC | The moon orbits Earth and reflects su…").id).toBe("a");
  expect(openCodeTitleMatch(list, "OC | The moon orbits Earth and reflects su...").id).toBe("a");
  expect(openCodeTitleMatch(list, "OC | The sea")).toBe(null);
  expect(openCodeTitleMatch(list, "OC | Nothing here")).toBe(null);
  expect(openCodeTitleMatch(list, "OpenCode")).toBe(null);
  expect(openCodeTitleMatch(list, null)).toBe(null);
});

test("-s names the session, and -c is a guess at the newest", () => {
  const list = [s("ses_a", 1000)];
  expect(pickOpenCode(list, 5000, 0, { id: "ses_z" }, null)).toEqual({ id: "ses_z", guess: false, via: "argv", choices: [] });
  expect(pickOpenCode(list, 5000, 0, { cont: true }, null)).toEqual({ id: "ses_a", guess: true, via: "cwd", choices: list });
});

test("with no start time OpenCode's newest session is the one", () => {
  expect(pickOpenCode([s("ses_b", 2), s("ses_a", 1)], null, 0, {}, null).id).toBe("ses_b");
});

test("a picker row is named by title, or by first prompt while the title is the default", () => {
  expect(openCodeLabel(s("a", 1, 1, "Fruit list", "Reply with fruit"))).toBe("Fruit list");
  expect(openCodeLabel(s("a", 1, 1, "New session - 2026-01-02", "Reply\n  with fruit"))).toBe("Reply with fruit");
  expect(openCodeLabel(s("a", 1, 1, "New session - 2026-01-02", null))).toBe("New session - 2026-01-02");
  expect(openCodeLabel({ id: "a" })).toBe(null);
  // OpenCode 2.x leaves the title empty until it names the session.
  expect(openCodeLabel(s("a", 1, 1, null, "Reply with fruit"))).toBe("Reply with fruit");
});

test("only OpenCode's folded paste gets the zero-width line", () => {
  const long = "> a\n> b\n> c\n\n";
  expect(quotePaste("opencode", long)).toBe(`${long}​`);
  const wide = `> ${"x".repeat(160)}\n\n`;
  expect(quotePaste("opencode", wide)).toBe(`${wide}​`);
  expect(quotePaste("opencode", "> a\n\n")).toBe("> a\n\n");
  expect(quotePaste("opencode", "> a\n> b\n\n")).toBe("> a\n> b\n\n");
  expect(quotePaste("claude", long)).toBe(long);
  expect(quotePaste("codex", long)).toBe(long);
});

test("a quote may paste into Codex or OpenCode, and not into a shell", () => {
  const base = { exists: true, pane: true };
  expect(canQuote({ ...base, fg: { harness: "codex" } })).toEqual({ ok: true, busy: false });
  expect(canQuote({ ...base, fg: { harness: "opencode" }, status: "working" })).toEqual({ ok: true, busy: true });
  expect(canQuote({ ...base, fg: { harness: "codex" }, status: "blocked" })).toEqual({ ok: false, why: "blocked" });
  expect(canQuote({ ...base, fg: { shell: true } })).toEqual({ ok: false, why: "shell" });
  expect(canQuote({ ...base, fg: { claude: true } })).toEqual({ ok: true, busy: false });
});

test("other agents' model names stay as they are", () => {
  expect(shortModel("gpt-5.5-codex")).toBe("gpt-5.5-codex");
  expect(shortModel("glm-5.3-flash-free")).toBe("glm-5.3-flash-free");
});
