// bun test: the settings file (parse, clamp, defaults, the one write). settings.js imports
// writeTextFile from Herdr, so the module is mocked here and records each write.
import { test, expect, mock } from "bun:test";

const writes = [];
mock.module("herdr", () => ({ writeTextFile: async (path, text, expected) => { writes.push({ path, text, expected }); return null; } }));
const { DEFAULTS, RANGES, LOOK, behindLook, parseSettings, parseExtras, settingsText, settingsPath, saveSettings, defaultLinks, ruleFault, LINK_TEMPLATES, parseLinks, parseTrajectory, TRAJ_MIN_H } = await import("../mods/agent-threads/settings.js");
// The quiet look's settings at their defaults.
const CHAT = { textSize: 14, agentRail: false, bubbleColor: "blue", agentBubbleColor: "amber", viewerReply: true, alwaysShowTime: false, truncate: false, railSide: "right", keyHints: false, statusLine: true };

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
  expect(JSON.parse(t)).toEqual({ replyLines: 5, future: "x", promptLines: 10, agentTurns: false, ...CHAT, look: 4 });
  expect(t.endsWith("\n")).toBe(true);
  expect(JSON.parse(settingsText({ agentTurns: true }, "not json"))).toEqual({ promptLines: 4, replyLines: 6, agentTurns: true, ...CHAT, look: 4 });
});

test("the only write goes to data/agent-threads/settings.json with the expected snapshot", async () => {
  expect(settingsPath("/apphome")).toBe("/apphome/data/agent-threads/settings.json");
  await saveSettings("/apphome", { promptLines: 4 }, null);
  await saveSettings("/apphome", { replyLines: 2 }, '{"promptLines":4}');
  expect(writes.map((w) => [w.path, w.expected])).toEqual([
    ["/apphome/data/agent-threads/settings.json", null],
    ["/apphome/data/agent-threads/settings.json", '{"promptLines":4}'],
  ]);
  expect(JSON.parse(writes[1].text)).toEqual({ promptLines: 4, replyLines: 2, agentTurns: false, ...CHAT, look: 4 });
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
  expect(JSON.parse(t)).toMatchObject({ promptLines: 2, replyLines: 3, look: 4 });
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
  expect(JSON.parse(t)).toMatchObject({ bubbleColor: "slate", look: 4 });
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

test("statusLine is a boolean, true by default: the chat's stats at the pane's very bottom", () => {
  const v = (j) => parseSettings(JSON.stringify(j)).values.statusLine;
  expect(v({})).toBe(true);
  expect(v({ statusLine: false })).toBe(false);
  expect(v({ statusLine: "no" })).toBe(true);
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

test("agentRail is a boolean, false by default: a file with no key has no agent ticks, one that holds true keeps them", () => {
  expect(DEFAULTS.agentRail).toBe(false);
  expect(parseSettings("{}").values.agentRail).toBe(false);
  expect(parseSettings('{"agentRail": true}').values.agentRail).toBe(true);
  expect(parseSettings('{"agentRail": false}').values.agentRail).toBe(false);
  expect(parseSettings('{"agentRail": "yes"}').values.agentRail).toBe(false);
  // A save writes the key either way, so a choice survives the default.
  expect(JSON.parse(settingsText({ ...DEFAULTS, agentRail: true }, null)).agentRail).toBe(true);
  expect(JSON.parse(settingsText({ ...DEFAULTS, agentRail: false }, null)).agentRail).toBe(false);
  expect(JSON.parse(settingsText({ agentTurns: true }, "{}")).agentRail).toBe(false);
  expect(JSON.parse(settingsText({ agentTurns: true }, '{"agentRail": true}')).agentRail).toBe(true);
});

test("look 4: agentRail true in a file from an earlier build reads as off, once; a file with the mark, or with no mark at all, keeps its value", () => {
  const v = (o) => parseSettings(JSON.stringify(o)).values.agentRail;
  expect(LOOK).toBe(4);
  // Every build that wrote agentRail wrote look 3, and before this default it wrote true.
  expect(v({ agentRail: true, look: 3 })).toBe(false);
  expect(v({ agentRail: true, look: 2 })).toBe(false);
  expect(v({ agentRail: true, look: "3" })).toBe(false);
  expect(v({ agentRail: true, look: "x" })).toBe(false);
  expect(v({ agentRail: false, look: 3 })).toBe(false);
  expect(v({ look: 3 })).toBe(false);
  // Marked: the person's choice, made since.
  expect(v({ agentRail: true, look: 4 })).toBe(true);
  expect(v({ agentRail: true, look: 5 })).toBe(true);
  expect(v({ agentRail: false, look: 4 })).toBe(false);
  // No mark: written by hand, kept.
  expect(v({ agentRail: true })).toBe(true);
  // Only agentRail is stepped: the file's other values read as they were.
  expect(parseSettings(JSON.stringify({ agentRail: true, agentTurns: true, railSide: "left", look: 3 })).values).toMatchObject({ agentRail: false, agentTurns: true, railSide: "left" });
  // Which files a load writes again with the mark: a settings object with an older mark.
  expect(behindLook('{"agentRail": true, "look": 3}')).toBe(true);
  expect(behindLook('{"look": 2}')).toBe(true);
  expect(behindLook('{"look": "x"}')).toBe(true);
  expect(behindLook('{"agentRail": true, "look": 4}')).toBe(false);
  expect(behindLook('{"look": 5}')).toBe(false);
  expect(behindLook('{"agentRail": true}')).toBe(false);
  expect(behindLook("{}")).toBe(false);
  expect(behindLook(null)).toBe(false);
  expect(behindLook("")).toBe(false);
  expect(behindLook("{ half an edit")).toBe(false);
  expect(behindLook("[3]")).toBe(false);
  expect(behindLook("null")).toBe(false);
  // The write that marks it: off, look 4, and the keys this build does not know kept.
  const t = JSON.parse(settingsText(parseSettings('{"agentRail": true, "look": 3, "future": 1}').values, '{"agentRail": true, "look": 3, "future": 1}'));
  expect(t).toMatchObject({ agentRail: false, look: 4, future: 1 });
  expect(behindLook(JSON.stringify(t))).toBe(false);
  // Turned on after that: written true with the mark, and read back true.
  const on = settingsText({ ...parseSettings(JSON.stringify(t)).values, agentRail: true }, JSON.stringify(t));
  expect(JSON.parse(on)).toMatchObject({ agentRail: true, look: 4 });
  expect(parseSettings(on).values.agentRail).toBe(true);
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

// The column steps with the pane now (ui.js columnStep): the Width setting and "Keep the pane
// at this width" are gone. A file from an earlier version that holds them reads with no error
// and no note, and a save keeps them, as it keeps any key it does not know.
test("a file holding the old width and keep-width keys reads with no error or note, and a save keeps them", () => {
  for (const text of ['{"width": "wide", "readingWidth": false}', '{"width": "full", "readingWidth": true, "textSize": 16}', '{"width": 90, "readingWidth": "yes"}']) {
    const r = parseSettings(text);
    expect(r.error).toBeNull();
    expect("width" in r.values || "readingWidth" in r.values).toBe(false);
    expect(parseExtras(text).notes).toEqual([]);
    const saved = JSON.parse(settingsText({ ...r.values, promptLines: 5 }, text));
    expect([saved.width, saved.readingWidth]).toEqual([JSON.parse(text).width, JSON.parse(text).readingWidth]);
  }
  expect(parseSettings('{"width": "wide", "readingWidth": false}').values).toEqual(DEFAULTS);
});

// TRD-24: the Trajectory's own object, read and checked; nothing writes it yet.
test("the trajectory object: where y docks it and the bottom height, read with defaults and a note for each value it cannot use; a chat save keeps it as written", () => {
  expect(TRAJ_MIN_H).toBe(270);
  for (const text of [null, "", "{}", '{"textSize": 15}']) expect(parseExtras(text).trajectory).toEqual({ dock: "right", height: null });
  expect(parseExtras('{"trajectory": {"dock": "bottom", "height": 412}}').trajectory).toEqual({ dock: "bottom", height: 412 });
  expect(parseExtras('{"trajectory": {"dock": "bottom", "height": 412}}').notes).toEqual([]);
  expect(parseExtras('{"trajectory": {"dock": "right"}}').trajectory).toEqual({ dock: "right", height: null });
  // A height is whole px, never under 270; a null height is none, with no note.
  expect(parseTrajectory({ height: 300.6 })).toEqual({ dock: "right", height: 301, notes: [] });
  expect(parseTrajectory({ height: null })).toEqual({ dock: "right", height: null, notes: [] });
  expect(parseTrajectory({ height: 270 })).toEqual({ dock: "right", height: 270, notes: [] });
  expect(parseTrajectory({ height: 120 })).toEqual({ dock: "right", height: 270, notes: ["trajectory.height 120 is under 270 px; using 270"] });
  for (const h of ["400", 0, -5, true, [300]]) {
    const r = parseTrajectory({ height: h });
    expect(r.height).toBeNull();
    expect(r.notes).toEqual([`trajectory.height ${JSON.stringify(h)} is not a px height; using the default`]);
  }
  for (const d of ["left", "Bottom", 1, null]) {
    const r = parseTrajectory({ dock: d, height: 400 });
    expect([r.dock, r.height]).toEqual(["right", 400]);
    expect(r.notes).toEqual([`trajectory.dock ${JSON.stringify(d)} is not "right" or "bottom"; using "right"`]);
  }
  for (const t of ["bottom", 3, ["bottom"]]) expect(parseTrajectory(t)).toEqual({ dock: "right", height: null, notes: ["trajectory is not an object; using its defaults"] });
  // Its notes join the file's other notes, and are given apart too (the card's rule edits rebuild the rest).
  expect(parseExtras('{"trajectory": {"height": "x"}}').trajNotes).toEqual(['trajectory.height "x" is not a px height; using the default']);
  expect(parseExtras("{}").trajNotes).toEqual([]);
  const text = JSON.stringify({ quoteKey: "j", trajectory: { dock: "top" } });
  expect(parseExtras(text).notes).toEqual([expect.stringContaining("quoteKey"), 'trajectory.dock "top" is not "right" or "bottom"; using "right"']);
  // Not a chat setting: a chat save keeps the object as written, unknown keys and all.
  const kept = JSON.stringify({ textSize: 15, trajectory: { dock: "bottom", height: 412, later: 1 } });
  expect(parseSettings(kept).values.trajectory).toBeUndefined();
  expect(JSON.parse(settingsText({ ...parseSettings(kept).values, textSize: 16 }, kept)).trajectory).toEqual({ dock: "bottom", height: 412, later: 1 });
});

test("a fresh install (no file, or an empty one) has the pull request rule, on; the first write records it; a file of its own keeps its links or none", () => {
  for (const text of [null, "", "  \n"]) {
    const x = parseExtras(text);
    expect(x.linkList.map((r) => [r.name, r.type, r.on, r.why])).toEqual([["Pull request", "pull-request", true, null]]);
    expect(x.links.length).toBe(1);
  }
  expect(JSON.parse(settingsText(DEFAULTS, null)).links).toEqual(defaultLinks());
  expect(JSON.parse(settingsText(DEFAULTS, "")).links).toEqual(defaultLinks());
  expect(JSON.parse(settingsText(DEFAULTS, "{}")).links).toBe(undefined);
  expect(parseExtras("{}").linkList).toEqual([]);
  expect(JSON.parse(settingsText(DEFAULTS, null, { links: [] })).links).toEqual([]);
  // Copies: changing one never changes the next.
  defaultLinks()[0].name = "x";
  expect(defaultLinks()[0].name).toBe("Pull request");
});

test("the two filled types are rules the mod runs, and ruleFault says why one would not", () => {
  const l = parseLinks([LINK_TEMPLATES.ticket.rule, LINK_TEMPLATES["pull-request"].rule]);
  expect(l.list.map((r) => r.why)).toEqual([null, null]);
  expect(LINK_TEMPLATES.custom.rule).toBe(null);
  expect(ruleFault({ pattern: "x(", url: "https://x.example/$1" })).toBe("pattern not valid");
  expect(ruleFault({ pattern: "x(\\d)", url: "ftp://x/$1" })).toMatch(/^url must start/);
  expect(ruleFault({ pattern: "x(\\d)", url: "https://x.example/$1" })).toBe(null);
});
