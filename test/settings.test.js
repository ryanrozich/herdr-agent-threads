// bun test: the settings file (parse, clamp, defaults, the one write). settings.js imports
// writeTextFile from Herdr, so the module is mocked here and records each write.
import { test, expect, mock } from "bun:test";

const writes = [];
mock.module("herdr", () => ({ writeTextFile: async (path, text, expected) => { writes.push({ path, text, expected }); return null; } }));
const { DEFAULTS, RANGES, parseSettings, parseExtras, settingsText, settingsPath, saveSettings } = await import("../mods/agent-threads/settings.js");

test("defaults when there is no file, or it is empty", () => {
  expect(DEFAULTS).toEqual({ promptLines: 2, replyLines: 3, agentTurns: false });
  expect(parseSettings(null)).toEqual({ values: DEFAULTS, error: null });
  expect(parseSettings("  ")).toEqual({ values: DEFAULTS, error: null });
  expect(parseSettings("{}")).toEqual({ values: DEFAULTS, error: null });
});

test("values clamp to their ranges and wrong types take the default", () => {
  expect(RANGES).toEqual({ promptLines: [1, 6], replyLines: [1, 8] });
  expect(parseSettings('{"promptLines": 0, "replyLines": 99, "agentTurns": true}').values).toEqual({ promptLines: 1, replyLines: 8, agentTurns: true });
  expect(parseSettings('{"promptLines": 7, "replyLines": -3}').values).toMatchObject({ promptLines: 6, replyLines: 1 });
  expect(parseSettings('{"promptLines": 2.6, "replyLines": "4"}').values).toMatchObject({ promptLines: 3, replyLines: 4 });
  expect(parseSettings('{"promptLines": "two", "replyLines": null, "agentTurns": "yes"}').values).toEqual(DEFAULTS);
});

test("invalid JSON keeps the defaults with a one-line note", () => {
  const r = parseSettings('{"promptLines": 1,');
  expect(r.values).toEqual(DEFAULTS);
  expect(r.error).toBe("settings.json is not valid JSON; using defaults");
  expect(parseSettings("[1,2]").error).toContain("not a JSON object");
});

test("the file text keeps unknown keys and clamps what it writes", () => {
  const t = settingsText({ promptLines: 9 }, '{"replyLines": 5, "future": "x"}');
  expect(JSON.parse(t)).toEqual({ replyLines: 5, future: "x", promptLines: 6, agentTurns: false });
  expect(t.endsWith("\n")).toBe(true);
  expect(JSON.parse(settingsText({ agentTurns: true }, "not json"))).toEqual({ promptLines: 2, replyLines: 3, agentTurns: true });
});

test("the only write goes to data/agent-threads/settings.json with the expected snapshot", async () => {
  expect(settingsPath("/apphome")).toBe("/apphome/data/agent-threads/settings.json");
  await saveSettings("/apphome", { promptLines: 4 }, null);
  await saveSettings("/apphome", { replyLines: 2 }, '{"promptLines":4}');
  expect(writes.map((w) => [w.path, w.expected])).toEqual([
    ["/apphome/data/agent-threads/settings.json", null],
    ["/apphome/data/agent-threads/settings.json", '{"promptLines":4}'],
  ]);
  expect(JSON.parse(writes[1].text)).toEqual({ promptLines: 4, replyLines: 2, agentTurns: false });
});

test("a save never replaces a file that does not parse (F5)", async () => {
  const { writable, NOT_SAVED } = await import("../mods/agent-threads/settings.js");
  expect(writable(null)).toBe(true);
  expect(writable("")).toBe(true);
  expect(writable('{"promptLines": 3}')).toBe(true);
  expect(writable('{"promptLines": 1, "custom": 5,')).toBe(false);
  expect(writable("[1,2]")).toBe(false);
  const before = writes.length;
  await expect(saveSettings("/apphome", { agentTurns: true }, '{"promptLines": 1, "custom": 5,')).rejects.toThrow(NOT_SAVED);
  expect(writes.length).toBe(before);
});

test("quoteKey i falls back to q with the note, since i explains the stat chips (C2)", () => {
  const x = parseExtras('{"quoteKey": "i"}');
  expect(x.quoteKey).toBe("q");
  expect(x.notes[0]).toMatch(/^quoteKey "i" is not a free letter a–z \(taken: .*\bi\b.*\); using q$/);
});

test("a settings file saved under an earlier name is adopted once, the old file left as it is", async () => {
  const { adoptPrevious, settingsPath } = await import("../mods/agent-threads/settings.js");
  const { PREVIOUS } = await import("../mods/agent-threads/name.js");
  const old = '{ "promptLines": 4, "links": [{ "name": "Issue", "pattern": "\\\\bACME-(\\\\d+)\\\\b", "url": "https://linear.app/acme/issue/ACME-$1" }] }\n';
  const reads = [];
  const read = async (p) => { reads.push(p); if (p === `/h/data/${PREVIOUS[0]}/settings.json`) return old; throw new Error("missing"); };
  writes.length = 0;
  expect(await adoptPrevious("/h", read)).toBe(old);
  expect(reads).toEqual([`/h/data/${PREVIOUS[0]}/settings.json`]);
  expect(writes).toEqual([{ path: settingsPath("/h"), text: old, expected: null }]);
  writes.length = 0;
  expect(await adoptPrevious("/h", async () => { throw new Error("missing"); })).toBe(null);
  expect(await adoptPrevious("/h", async () => "  \n")).toBe(null);
  expect(writes).toEqual([]);
});
