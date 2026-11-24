// bun test: a save from the settings card that meets a file changed meanwhile, on the render
// harness (test/render-harness.js). The save reads the file again, writes its change on top,
// and what the merged file holds is live at once: the chat settings and the keys the card
// writes as they are (the quote key, the link and sender rules, the Trajectory's object).
import { test, expect } from "bun:test";
import { fixture, H, pane, rec, recordFiles, settingsWrites, setup, theme } from "./render-harness.js";

setup();

function onOf(calls, id, name) {
  const at = calls.findIndex((e) => e[0] === "id" && e[1] === id);
  if (at < 0) return null;
  for (let j = at + 1; j < calls.length && calls[j][0] !== "id"; j++) if (calls[j][0] === name) return calls[j].at(-1);
  return null;
}
const cardOf = (v) => { H.rec = []; v.settingsCard(theme); const c = rec; H.rec = null; return c; };
const settleAll = async (cx) => { for (let i = 0; i < 3; i++) { const p = cx.pending; cx.pending = []; await Promise.all(p); } };

// Review of PR 277 (CodeRabbit, outside the diff): the retry after a stale save took the merged
// file's chat settings only, so the quote key, the rules and the Trajectory's object an editor
// wrote meanwhile stayed as last read until the file was read again.
test("a card save that meets a file changed meanwhile merges it, and every setting the merged file holds is live at once: the quote key and the Trajectory's values and notes", async () => {
  const { v, cx } = await pane(fixture("--extra", "2"));
  try {
    H.keepSettings = true;
    v.applyPrefs(JSON.stringify({ textSize: 15 }));
    recordFiles[v.prefsPath()] = v.prefsRaw;
    v.action("settings", cx);
    cx.pending = []; // the folder watch never ends: wait only for what follows
    expect([v.quoteKey, v.trajPrefs, v.trajNotes]).toEqual(["q", { dock: "right", height: null }, []]);
    const rail = v.prefs.agentRail === true;
    // An editor writes a quote key and a Trajectory object as the switch is pressed.
    H.settingsStale = true;
    recordFiles[v.prefsPath()] = JSON.stringify({ textSize: 16, quoteKey: "y", trajectory: { dock: "bottom", height: 120 } });
    settingsWrites.length = 0;
    onOf(cardOf(v), "th-set-agent-rail", "on_click")({}, cx);
    await settleAll(cx);
    // Written once, on top of the editor's file.
    expect(settingsWrites.length).toBe(1);
    const w = JSON.parse(settingsWrites[0]);
    expect([w.agentRail === true, w.textSize, w.quoteKey, w.trajectory]).toEqual([!rail, 16, "y", { dock: "bottom", height: 120 }]);
    expect(v.prefsError).toBe(null);
    expect(v.prefsRaw).toBe(settingsWrites[0]);
    // Live with no further read: the chat settings, the quote key, and the Trajectory's values
    // with the note for the height it cannot use.
    expect([v.prefs.agentRail === true, v.prefs.textSize]).toEqual([!rail, 16]);
    expect(v.quoteKey).toBe("y");
    expect(v.trajPrefs).toEqual({ dock: "bottom", height: 270 });
    expect(v.trajNotes).toEqual(["trajectory.height 120 is under 270 px; using 270"]);
  } finally {
    H.keepSettings = false;
    H.settingsStale = false;
    delete recordFiles[v.prefsPath()];
  }
});

// Review of PR 277 at dfba2174 (CodeRabbit, main.js:1426): a save queued behind a stale one.
// The saves chain: each runs when the one before it ends. Save A finds the file changed and
// writes on top of it; save B, made while A waited, then writes on its own path. When the queue
// drains, the pane shows what the file holds.
// The card's quote key field does this when a free letter is typed (quoteTyped).
const typeQuote = (v, k, cx, patch = {}) => { v.quoteKey = k; v.changePrefs(patch, cx, { quoteKey: k }); };
// A pane with the card open over a file of { textSize: 15 }, then an editor's write of
// { textSize: 16 } that the next save meets as stale.
async function staleCard() {
  const r = await pane(fixture("--extra", "2"));
  H.keepSettings = true;
  r.v.applyPrefs(JSON.stringify({ textSize: 15 }));
  recordFiles[r.v.prefsPath()] = r.v.prefsRaw;
  r.v.action("settings", r.cx);
  r.cx.pending = []; // the folder watch never ends: wait only for what follows
  H.settingsStale = true;
  recordFiles[r.v.prefsPath()] = JSON.stringify({ textSize: 16 });
  settingsWrites.length = 0;
  return r;
}
const fileOf = (v) => JSON.parse(recordFiles[v.prefsPath()]);
function undo(v) { H.keepSettings = false; H.settingsStale = false; delete recordFiles[v.prefsPath()]; }

test("a save queued behind a stale one: when the queue drains the pane's quote key and chat setting are the file's", async () => {
  const { v, cx } = await staleCard();
  try {
    const rail = v.prefs.agentRail === true;
    typeQuote(v, "u", cx); // A: meets the editor's write
    typeQuote(v, "x", cx, { agentRail: !rail }); // B: made while A waits
    await settleAll(cx);
    const f = fileOf(v);
    expect(v.prefsRaw).toBe(recordFiles[v.prefsPath()]);
    // The file holds B's, the last save made.
    expect([f.quoteKey, f.agentRail === true]).toEqual(["x", !rail]);
    expect([v.quoteKey, v.prefs.agentRail === true]).toEqual([f.quoteKey, f.agentRail === true]);
  } finally { undo(v); }
});

test("a chat save queued behind a stale chat save: when the queue drains the pane's chat settings are the file's", async () => {
  const { v, cx } = await staleCard();
  try {
    const rail = v.prefs.agentRail === true;
    const hints = v.prefs.keyHints === true;
    v.changePrefs({ agentRail: !rail }, cx); // A: meets the editor's write
    v.changePrefs({ keyHints: !hints }, cx); // B: made while A waits
    await settleAll(cx);
    const f = fileOf(v);
    expect(v.prefsRaw).toBe(recordFiles[v.prefsPath()]);
    expect([f.agentRail === true, f.keyHints === true]).toEqual([!rail, !hints]);
    expect([v.prefs.agentRail === true, v.prefs.keyHints === true]).toEqual([f.agentRail === true, f.keyHints === true]);
  } finally { undo(v); }
});

test("a save queued behind a stale one keeps the editor's change that the stale save merged, in the file and the pane", async () => {
  const { v, cx } = await staleCard();
  try {
    const rail = v.prefs.agentRail === true;
    v.changePrefs({ agentRail: !rail }, cx); // A: merges the editor's textSize 16
    v.changePrefs({ keyHints: !(v.prefs.keyHints === true) }, cx); // B: made while A waits
    await settleAll(cx);
    expect(fileOf(v).textSize).toBe(16);
    expect(v.prefs.textSize).toBe(16);
  } finally { undo(v); }
});
