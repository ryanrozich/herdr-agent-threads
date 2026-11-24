// bun test: the render harness starts each test file clean. bun runs every test file in one
// process and loads test/render-harness.js once, so a setting one file leaves behind would
// reach the next file that uses the harness; setup() puts them all back.
import { test, expect } from "bun:test";
import { allPins, closed, editors, heldClock, hostReads, keyBinds, lacking, mdSources, overlays, pinPane, PINS, saved, scrollHandles, settingsWrites, setup, stubHas, views, work, H } from "./render-harness.js";

const DEFAULTS = {
  calls: 0,
  rec: null,
  state: { panes: [], terminals: [], props: {}, shared: {} },
  log: [],
  hcOut: JSON.stringify({ foreground: { name: "claude", argv: ["claude"], pid: 42 } }),
  hcBy: {},
  recordFiles: {},
  focusNow: null,
  focusCalls: 0,
  listWindow: null,
  lastList: null,
  herdrSettings: { font_family: "Mono" },
  hostPlatform: "linux",
  herdrVersion: "0.1.17",
  marks: null,
  pinWrites: 0,
  extractCalls: null,
  extractHook: null,
  keepSettings: false,
  settingsStale: false,
};
const LISTS = { closed, editors, mdSources, overlays, scrollHandles, settingsWrites, views };

test("setup() puts every harness setting back to its default and empties every shared list and count, but keeps the key bindings", () => {
  const focus = () => {};
  for (const k of Object.keys(DEFAULTS)) H[k] = { left: k };
  H.afterFocus = focus;
  lacking.add("on_scroll_wheel");
  stubHas.add("mode");
  for (const list of Object.values(LISTS)) list.push({ left: true });
  for (const k of Object.keys(hostReads)) hostReads[k] = 5;
  for (const k of Object.keys(work)) work[k] = 5;
  // The mod binds its keys once per process, so their record is kept for the whole run.
  const bound = keyBinds.length;
  keyBinds.push([{ keystroke: "x", action: "left" }]);
  try {
    setup();
    for (const [k, v] of Object.entries(DEFAULTS)) expect(H[k], k).toEqual(v);
    expect([...lacking, ...stubHas]).toEqual([]);
    for (const [name, list] of Object.entries(LISTS)) expect(list, name).toEqual([]);
    expect(hostReads).toEqual({ settings: 0, panes: 0, terminals: 0 });
    expect(work).toEqual({ lines: 0, events: 0, reshapes: 0, built: 0 });
    // The default focus stand-in: the focused pane's terminal, from the panes the test set.
    expect(H.afterFocus).not.toBe(focus);
    H.state.panes = [{ pane: "p1", terminal: "t4" }];
    H.afterFocus({ pane: "p1" });
    expect(H.focusNow).toEqual({ terminal: "t4" });
    expect(keyBinds.length).toBe(bound + 1);
  } finally {
    keyBinds.pop();
    setup();
  }
});

test("heldClock holds performance.now where it was while fn runs, returns fn's value, and puts the real clock back, also when fn throws", () => {
  const real = performance.now;
  const before = performance.now();
  const seen = heldClock(() => {
    const a = performance.now();
    const until = Date.now() + 5;
    while (Date.now() < until);
    return [a, performance.now()];
  });
  expect(seen[0]).toBe(seen[1]);
  expect(seen[0]).toBeGreaterThanOrEqual(before);
  expect(performance.now).toBe(real);
  expect(performance.now()).toBeGreaterThan(seen[0]);
  expect(() => heldClock(() => { throw new Error("made-up"); })).toThrow("made-up");
  expect(performance.now).toBe(real);
});

// Two tests in file order: the first writes through the pane and the harness, the second must
// start from nothing. Without a reset between tests, the pins record outlives its test and a
// later test finds (or unpins) another test's pins, or hits the pin limit.
test("leak check, part 1: a test pins a turn, writes a setting and leaves state in the harness", async () => {
  const { v, cx, keys } = await pinPane("--extra", "3");
  v.sel = keys()[0];
  v.action("pin", cx);
  expect(allPins(await saved())).toHaveLength(1);
  expect(H.pinWrites).toBeGreaterThan(0);
  H.recordFiles["/made-up/settings.json"] = "{}";
  H.herdrSettings = { font_family: "Left" };
  H.state.shared.left = 1;
  H.log.push(["left"]);
  H.keepSettings = true;
  settingsWrites.push("{}");
});

test("leak check, part 2: the next test starts with no pins, no records and no state the last one wrote", async () => {
  expect(H.recordFiles[PINS]).toBeUndefined();
  expect(H.recordFiles).toEqual({});
  expect(allPins(await saved())).toEqual([]);
  expect(H.pinWrites).toBe(0);
  expect(H.herdrSettings).toEqual({ font_family: "Mono" });
  expect(H.state.shared).toEqual({});
  expect(H.log).toEqual([]);
  expect(H.keepSettings).toBe(false);
  expect(settingsWrites).toEqual([]);
});

// A save still in flight when its test ends: the pane's pin chain is held, then released
// after the test has ended. The reset waits for it, so its write cannot reach the next test.
test("leak check, part 3: a pin save still in flight when the test ends", async () => {
  const { v, cx, keys } = await pinPane("--extra", "3");
  let release;
  v.pinChain = new Promise((r) => { release = r; });
  v.sel = keys()[0];
  v.action("pin", cx);
  setTimeout(release, 50);
  expect(H.recordFiles[PINS]).toBeUndefined(); // not written yet
});

test("leak check, part 4: the save of the test before does not land in this one", async () => {
  expect(H.recordFiles).toEqual({});
  await new Promise((r) => setTimeout(r, 150));
  expect(H.recordFiles).toEqual({});
  expect(H.pinWrites).toBe(0);
});
