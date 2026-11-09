// bun test: pins as data. Everything here is made up.
import { test, expect, describe } from "bun:test";
import { turnIds, turnId, parsePins, pinsText, mergeDirty, newPin, pinState, partOf, partKeys, placeAtTop, placeItem, NOT_A_PLACE } from "../mods/agent-threads/pins.js";
import { keyAction, TAKEN_LETTERS, headPinHit } from "../mods/agent-threads/ui.js";

const DAY = 86400000;
const T0 = new Date(2026, 10, 6, 15, 30).getTime();
const turn = (n, prompt, ts = T0 + n * 60000, extra = {}) => ({ n, prompt, ts, after: [], followups: 0, ...extra });

describe("turn identity", () => {
  test("a fingerprint is the time, the prompt and a count, and not the row number", () => {
    const a = [turn(1, "add a test"), turn(2, "fix it")];
    const id = turnId(a, a[1]);
    // The same turn under another number, after an earlier row went away.
    const b = [{ ...a[1], n: 1 }];
    expect(turnIds(b).get(id)?.prompt).toBe("fix it");
  });

  test("the same prompt in the same second is told apart by order", () => {
    const ts = T0;
    const a = [turn(1, "go on", ts), turn(2, "go on", ts), turn(3, "go on", ts)];
    const ids = [...turnIds(a).keys()];
    expect(new Set(ids).size).toBe(3);
    expect(turnId(a, a[1])).toBe(ids[1]);
    expect(turnIds(a).get(ids[2])).toBe(a[2]);
  });

  test("Cursor's minute stamps: a whole-file rewrite makes new objects, and the same ids", () => {
    const minute = Math.floor(T0 / 60000) * 60000;
    const read = () => [turn(1, "first", minute), turn(2, "go on", minute), turn(3, "go on", minute), turn(4, "last", minute + 60000)];
    const before = read();
    const after = read();
    for (let i = 0; i < 4; i++) expect(turnId(after, after[i])).toBe(turnId(before, before[i]));
  });

  test("a turn with no time still has a fingerprint", () => {
    const a = [turn(1, "no clock", null)];
    expect(turnId(a, a[0])).toMatch(/^-\|/);
    expect(turnIds(a).size).toBe(1);
  });

  test("an edited prompt is a different turn", () => {
    const a = [turn(1, "one")];
    const b = [turn(1, "two", a[0].ts)];
    expect(turnId(a, a[0])).not.toBe(turnId(b, b[0]));
  });
});

describe("the file", () => {
  test("no file is no pins, and no error", () => {
    expect(parsePins(null)).toEqual({ store: { version: 1, sessions: {} }, error: null });
    expect(parsePins("  ").error).toBe(null);
  });

  test("text that is not a pins file is an error, so a save leaves it alone", () => {
    expect(parsePins("{ half").error).toMatch(/not valid JSON/);
    expect(parsePins("[]").error).toMatch(/not a pins file/);
    expect(parsePins('{"a":1}').error).toMatch(/not a pins file/);
  });

  test("a bad pin is dropped and the good ones stay", () => {
    const { store } = parsePins(JSON.stringify({ sessions: { "claude:a": { at: 5, pins: [{ id: "x" }, { n: 3 }, null, 7] }, "claude:b": { pins: "no" } } }));
    expect(store.sessions).toEqual({ "claude:a": { at: 5, pins: [{ id: "x" }] } });
  });

  test("it round-trips, and drops empty sessions, sessions over 90 days and past 200", () => {
    const sessions = { keep: { at: T0, pins: [{ id: "k" }] }, empty: { at: T0, pins: [] }, old: { at: T0 - 91 * DAY, pins: [{ id: "o" }] } };
    for (let i = 0; i < 250; i++) sessions[`s${i}`] = { at: T0 - i - 1, pins: [{ id: "p" }] };
    const back = parsePins(pinsText({ sessions }, T0));
    const keys = Object.keys(back.store.sessions);
    expect(keys.length).toBe(200);
    expect(keys).toContain("keep");
    expect(keys).not.toContain("empty");
    expect(keys).not.toContain("old");
    expect(keys).not.toContain("s249");
  });

  test("a save keeps another pane's sessions and this pane's edits, removals included", () => {
    const fresh = { sessions: { other: { pins: [{ id: "o" }] }, mine: { pins: [{ id: "stale" }] }, gone: { pins: [{ id: "g" }] } } };
    const ours = { sessions: { mine: { pins: [{ id: "new" }] } } };
    expect(mergeDirty(fresh, ours, ["mine", "gone"]).sessions).toEqual({ other: { pins: [{ id: "o" }] }, mine: { pins: [{ id: "new" }] } });
  });

  test("a pin keeps 80 characters of the prompt's first line and nothing after it", () => {
    const long = `${"x".repeat(200)}\nsecret second line`;
    const t = turn(1, long);
    const p = newPin([t], t, T0);
    expect(p.text).toBe("x".repeat(80));
    expect(JSON.stringify(p)).not.toContain("secret");
    expect(p).toMatchObject({ n: 1, at: T0, seen: { len: 0, fu: 0 } });
  });
});

describe("what a pin shows", () => {
  test("gone only once the session is fully read", () => {
    expect(pinState({ turn: null, loaded: false })).toBe("loading");
    expect(pinState({ turn: null, loaded: true })).toBe("gone");
  });

  test("live wins, then new text or a new update, then quiet", () => {
    const t = turn(1, "p", T0, { followups: 2 });
    expect(pinState({ turn: t, live: true, seen: { len: 0, fu: 0 } })).toBe("live");
    expect(pinState({ turn: t, seen: { len: 0, fu: 1 } })).toBe("new");
    expect(pinState({ turn: t, seen: { len: 0, fu: 2 } })).toBe("quiet");
  });


});

describe("the reading place", () => {
  test("an item is a place in its turn, or nothing", () => {
    expect(partOf("0:4", "0:4")).toEqual(["head"]);
    expect(partOf("md:0:4:0.2", "0:4")).toEqual(["md", "0.2"]);
    expect(partOf("rhead:0:4", "0:4")).toEqual(["rhead", null]);
    expect(partOf("md:0:5:0", "0:4")).toBe(null);
    expect(partOf("0:5", "0:4")).toBe(null);
    expect(partOf("bar:1", "0:4")).toBe(null);
  });

  test("a place survives another turn number, and a pin saved on a paragraph by an earlier build falls back to its block", () => {
    expect(partKeys(["md", "0.2"], "1:9")).toEqual(["md:1:9:0.2", "md:1:9:0"]);
    expect(partKeys(["md", "1"], "0:4")).toEqual(["md:0:4:1", "md:0:4:1.0"]);
    expect(partKeys(["rhead", null], "0:4")).toEqual(["rhead:0:4"]);
    expect(partKeys(["head"], "0:4")).toEqual([]);
    expect(partKeys(null, "0:4")).toEqual([]);
  });

  test("a place near the top of a turn, or at its end, returns to the head; a later block returns to that block", () => {
    for (const a of [null, ["head"], ["you", null], ["img", "0"], ["rhead", null], ["nr", null], ["md", "0"], ["md", "0.3"], ["cc", "0"], ["code", "0"], ["st", null], ["cp", null], ["lg", null], ["more", null]]) {
      expect(placeAtTop(a)).toBe(true);
    }
    for (const a of [["md", "2"], ["md", "2.1"], ["cc", "1"], ["code", "1"], ["lh", null], ["lt", null]]) expect(placeAtTop(a)).toBe(false);
    expect(placeItem(["code", "1"])).toEqual(["cc", "1"]);
    expect(placeItem(["lt", null])).toEqual(["lh", null]);
    expect(placeItem(["md", "2"])).toEqual(["md", "2"]);
    for (const k of ["st", "cp", "lg", "more", "resume"]) expect(NOT_A_PLACE.has(k)).toBe(true);
    for (const k of ["md", "cc", "code", "lh", "lt", "you", "rhead"]) expect(NOT_A_PLACE.has(k)).toBe(false);
  });
});

describe("keys", () => {
  const k = (key, m = {}) => ({ key, modifiers: m });
  test("p, u and 1 to 5 act; chords and 6 do not", () => {
    expect(keyAction(k("p"))).toBe("pin");
    expect(keyAction(k("u"))).toBe("undoUnpin");
    for (const d of [1, 2, 3, 4, 5]) expect(keyAction(k(String(d)))).toBe(`go:${d}`);
    expect(keyAction(k("6"))).toBe(null);
    expect(keyAction(k("p", { platform: true }))).toBe(null);
    expect(keyAction(k("1", { control: true }))).toBe(null);
  });

  test("while the search field has the keys they type", () => {
    for (const x of ["p", "u", "1"]) expect(keyAction(k(x), true)).toBe(null);
  });

  test("a quote key of p or u keeps its letter, and pin gives it up", () => {
    expect(keyAction(k("p"), false, "p")).toBe("quote");
    expect(keyAction(k("u"), false, "u")).toBe("quote");
    expect(keyAction(k("u"), false, "p")).toBe("undoUnpin");
    expect(TAKEN_LETTERS).not.toContain("p");
    expect(TAKEN_LETTERS).not.toContain("u");
  });

  test("the head's pin zone is left of the chevron and does not touch it", () => {
    const w = 500;
    expect(headPinHit(w - 42, w)).toBe(true); // the pin's middle
    expect(headPinHit(w - 23, w)).toBe(false); // the chevron's middle
    expect(headPinHit(100, w)).toBe(false);
    expect(headPinHit(null, w)).toBe(false);
  });
});
