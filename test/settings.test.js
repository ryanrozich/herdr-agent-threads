// bun test: the settings file (parse, clamp, defaults, the one write). settings.js imports
// writeTextFile from Herdr, so the module is mocked here and records each write.
import { test, expect, mock } from "bun:test";

const writes = [];
mock.module("herdr", () => ({ writeTextFile: async (path, text, expected) => { writes.push({ path, text, expected }); return null; } }));
const { DEFAULTS, RANGES, parseSettings, parseExtras, settingsText, settingsPath, saveSettings } = await import("../mods/agent-threads/settings.js");
// The quiet look's settings at their defaults.
const CHAT = { textSize: 14, bubbleColor: "blue", agentBubbleColor: "amber", width: "comfortable", readingWidth: true, viewerReply: true, alwaysShowTime: false, truncate: false, railSide: "right", keyHints: false };

test("defaults when there is no file, or it is empty", () => {
  expect(DEFAULTS).toEqual({ promptLines: 4, replyLines: 6, agentTurns: false, ...CHAT });
  expect(parseSettings(null)).toEqual({ values: DEFAULTS, error: null });
  expect(parseSettings("  ")).toEqual({ values: DEFAULTS, error: null });
  expect(parseSettings("{}")).toEqual({ values: DEFAULTS, error: null });
});

test("values clamp to their ranges and wrong types take the default", () => {
  expect(RANGES).toEqual({ textSize: [12, 18], promptLines: [1, 10], replyLines: [1, 12] });
  expect(parseSettings('{"textSize": 9}').values.textSize).toBe(12);
  expect(parseSettings('{"textSize": 30}').values.textSize).toBe(18);
  expect(parseSettings('{"textSize": "15"}').values.textSize).toBe(15);
  expect(parseSettings('{"textSize": "big"}').values.textSize).toBe(14);
  expect(parseSettings('{"promptLines": 0, "replyLines": 99, "agentTurns": true}').values).toEqual({ promptLines: 1, replyLines: 12, agentTurns: true, ...CHAT });
  expect(parseSettings('{"promptLines": 11, "replyLines": -3}').values).toMatchObject({ promptLines: 10, replyLines: 1 });
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
  const t = settingsText({ promptLines: 14 }, '{"replyLines": 5, "future": "x"}');
  expect(JSON.parse(t)).toEqual({ replyLines: 5, future: "x", promptLines: 10, agentTurns: false, ...CHAT, look: 3 });
  expect(t.endsWith("\n")).toBe(true);
  expect(JSON.parse(settingsText({ agentTurns: true }, "not json"))).toEqual({ promptLines: 4, replyLines: 6, agentTurns: true, ...CHAT, look: 3 });
});

test("the only write goes to data/agent-threads/settings.json with the expected snapshot", async () => {
  expect(settingsPath("/apphome")).toBe("/apphome/data/agent-threads/settings.json");
  await saveSettings("/apphome", { promptLines: 4 }, null);
  await saveSettings("/apphome", { replyLines: 2 }, '{"promptLines":4}');
  expect(writes.map((w) => [w.path, w.expected])).toEqual([
    ["/apphome/data/agent-threads/settings.json", null],
    ["/apphome/data/agent-threads/settings.json", '{"promptLines":4}'],
  ]);
  expect(JSON.parse(writes[1].text)).toEqual({ promptLines: 4, replyLines: 2, agentTurns: false, ...CHAT, look: 3 });
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

test("a file from before the chat look holding the old defaults reads as the new ones, once", () => {
  // Written by an earlier build, which saved every value on any change.
  expect(parseSettings('{"promptLines": 2, "replyLines": 3, "agentTurns": true}').values).toEqual({ promptLines: 4, replyLines: 6, agentTurns: true, ...CHAT });
  // Any other pair was chosen, and stays.
  expect(parseSettings('{"promptLines": 2, "replyLines": 5}').values).toMatchObject({ promptLines: 2, replyLines: 5 });
  // Once the file carries the mark, 2 and 3 are the person's choice.
  expect(parseSettings('{"promptLines": 2, "replyLines": 3, "look": 2}').values).toMatchObject({ promptLines: 2, replyLines: 3 });
  // Choosing 2 and 3 from the panel writes the mark with them, so they hold.
  const t = settingsText({ promptLines: 2, replyLines: 3 }, '{"promptLines": 4, "replyLines": 3}');
  expect(JSON.parse(t)).toMatchObject({ promptLines: 2, replyLines: 3, look: 3 });
  expect(parseSettings(t).values).toMatchObject({ promptLines: 2, replyLines: 3 });
});

test("bubble colours take a preset name or #rrggbb, and anything else the default", () => {
  const v = (j) => parseSettings(JSON.stringify(j)).values;
  expect(v({ bubbleColor: "Teal", agentBubbleColor: "plain" })).toMatchObject({ bubbleColor: "teal", agentBubbleColor: "plain" });
  expect(v({ bubbleColor: "#1a2b3c", agentBubbleColor: "#abc" })).toMatchObject({ bubbleColor: "#1A2B3C", agentBubbleColor: "#AABBCC" });
  for (const bad of ["navy", "#12345", "rgb(1,2,3)", 7, null, "toString"]) expect(v({ bubbleColor: bad }).bubbleColor).toBe("blue");
  expect(JSON.parse(settingsText({ bubbleColor: "green" }, null))).toMatchObject({ bubbleColor: "green", agentBubbleColor: "amber" });
  expect(v({ bubbleColor: "Blue", agentBubbleColor: "purple" })).toMatchObject({ bubbleColor: "blue", agentBubbleColor: "purple" }); // the bright pair
});

test("the quiet look: slate in a file from before it was the old default and reads as plain; any other colour, or slate chosen since, is kept", () => {
  const v = (j) => parseSettings(JSON.stringify(j)).values;
  expect(v({ bubbleColor: "slate" }).bubbleColor).toBe("blue");
  expect(v({ bubbleColor: "slate", look: 2 }).bubbleColor).toBe("blue");
  expect(v({ bubbleColor: "teal", look: 2 }).bubbleColor).toBe("teal");
  expect(v({ bubbleColor: "#1a2b3c" }).bubbleColor).toBe("#1A2B3C");
  expect(v({ bubbleColor: "slate", look: 3 }).bubbleColor).toBe("slate");
  // Choosing slate writes the new mark with it, so it holds.
  const t = settingsText({ bubbleColor: "slate" }, '{"bubbleColor": "plain", "look": 3}');
  expect(JSON.parse(t)).toMatchObject({ bubbleColor: "slate", look: 3 });
  expect(parseSettings(t).values.bubbleColor).toBe("slate");
  // The agent's bubble keeps its default.
  expect(v({}).agentBubbleColor).toBe("amber");
});

test("agent messages are amber by default; a file that holds plum keeps it, and a save keeps it", () => {
  const v = (j) => parseSettings(JSON.stringify(j)).values;
  expect(DEFAULTS.agentBubbleColor).toBe("amber");
  expect(v({}).agentBubbleColor).toBe("amber");
  expect(v({ agentBubbleColor: "plum" }).agentBubbleColor).toBe("plum");
  expect(v({ agentBubbleColor: "plum", look: 3 }).agentBubbleColor).toBe("plum");
  expect(JSON.parse(settingsText({ textSize: 15 }, '{"agentBubbleColor": "plum"}')).agentBubbleColor).toBe("plum");
  // User messages are blue by default; a file that stored plain keeps it.
  expect(DEFAULTS.bubbleColor).toBe("blue");
  expect(parseSettings(JSON.stringify({ bubbleColor: "plain", look: 3 })).values.bubbleColor).toBe("plain");
  expect(parseSettings(JSON.stringify({ textSize: 15 })).values.bubbleColor).toBe("blue");
});

test("keyHints is a boolean, false by default: no key row at the pane's foot", () => {
  const v = (j) => parseSettings(JSON.stringify(j)).values.keyHints;
  expect(v({})).toBe(false);
  expect(v({ keyHints: true })).toBe(true);
  expect(v({ keyHints: "yes" })).toBe(false);
});

test("the card's quote key is written as an extra: the values and every other key stay as they were", async () => {
  const before = '{"links": [{"pattern": "x-(\\\\d+)", "url": "https://x.example/$1"}], "quoteKey": "q", "textSize": 15}';
  const t = JSON.parse(settingsText({ ...parseSettings(before).values }, before, { quoteKey: "y" }));
  expect(t.quoteKey).toBe("y");
  expect(t.textSize).toBe(15);
  expect(t.links).toEqual(JSON.parse(before).links);
  expect(parseExtras(JSON.stringify(t)).quoteKey).toBe("y");
  writes.length = 0;
  await saveSettings("/apphome", parseSettings(before).values, before, { quoteKey: "z" });
  expect(JSON.parse(writes[0].text).quoteKey).toBe("z");
  expect(writes[0].expected).toBe(before);
});

test("truncate is a boolean, false by default: long messages show in full", () => {
  const v = (j) => parseSettings(JSON.stringify(j)).values.truncate;
  expect(v({})).toBe(false);
  expect(v({ truncate: true })).toBe(true);
  expect(v({ truncate: "yes" })).toBe(false);
  expect(DEFAULTS.truncate).toBe(false);
});

test("alwaysShowTime is a boolean, false by default", () => {
  const v = (j) => parseSettings(JSON.stringify(j)).values.alwaysShowTime;
  expect(v({})).toBe(false);
  expect(v({ alwaysShowTime: true })).toBe(true);
  expect(v({ alwaysShowTime: "yes" })).toBe(false);
});

test("a file that still names you (youName, now gone) loads without a note, and a save leaves the key as written", () => {
  const text = JSON.stringify({ youName: "Sam", textSize: 15 });
  const r = parseSettings(text);
  expect(r.error).toBe(null);
  expect(r.values.youName).toBeUndefined();
  expect(r.values.textSize).toBe(15);
  expect(parseExtras(text).notes).toEqual([]);
  expect(JSON.parse(settingsText({ ...r.values, textSize: 16 }, text))).toMatchObject({ youName: "Sam", textSize: 16 });
});

test("width is comfortable, wide or full; anything else reads as comfortable", () => {
  expect(parseSettings('{"width": "wide"}').values.width).toBe("wide");
  expect(parseSettings('{"width": "full"}').values.width).toBe("full");
  expect(parseSettings('{"width": "huge"}').values.width).toBe("comfortable");
  expect(parseSettings('{"width": 90}').values.width).toBe("comfortable");
});
