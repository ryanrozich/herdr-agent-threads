// bun test: the render harness starts each test file clean. bun runs every test file in one
// process and loads test/render-harness.js once, so a setting one file leaves behind would
// reach the next file that uses the harness; setup() puts them all back.
import { test, expect } from "bun:test";
import { allPins, closed, editors, heldClock, hostReads, keyBinds, lacking, mdSources, overlays, pinPane, pinsIdle, PINS, saved, scrollHandles, settingsWrites, setup, stubHas, views, work, H } from "./render-harness.js";

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

// A save queued for later (pinChangedLater, saved by the pane's tick 1.5 s on) belongs to the
// pane of the test that queued it. The pane is kept here so the next test can look at it.
let queuedPane = null;
test("leak check, part 5: a test queues a pin save for later and ends with its pane kept", async () => {
  const { v } = await pinPane("--extra", "3");
  queuedPane = v;
  v.pinChangedLater(v.sessionKey(v.current()));
  expect(v.pinDueAt).not.toBeNull();
});

test("leak check, part 6: the pane of the test before has no save queued, and no pins record was written", () => {
  expect(queuedPane.pinDueAt).toBeNull();
  expect(H.recordFiles).toEqual({});
  expect(H.pinWrites).toBe(0);
});

// Counts the timers a call makes through the global clock functions, then puts them back.
async function timersOf(fn) {
  const real = { set: globalThis.setTimeout, clear: globalThis.clearTimeout };
  const made = [];
  const live = new Set();
  const zero = { n: 0 };
  globalThis.setTimeout = (f, ms, ...a) => { const t = real.set(f, ms, ...a); if (ms === 0) zero.n++; else { made.push(ms); live.add(t); } return t; };
  globalThis.clearTimeout = (t) => { live.delete(t); return real.clear(t); };
  try { await fn(zero); } finally { globalThis.setTimeout = real.set; globalThis.clearTimeout = real.clear; }
  return { made, live: live.size, zero };
}

test("pinsIdle leaves no timer pending when the saves end", async () => {
  const { live, made } = await timersOf(() => pinsIdle());
  expect(made).toEqual([2000]);
  expect(live).toBe(0);
});

test("pinsIdle stops its loop when the cap wins: a save that never ends does not keep it turning", async () => {
  const { v, cx, keys } = await pinPane("--extra", "3");
  let release;
  v.pinChain = new Promise((r) => { release = r; });
  v.sel = keys()[0];
  v.action("pin", cx);
  try {
    await timersOf(async (zero) => {
      await expect(pinsIdle(40)).rejects.toThrow("a pin save never ended");
      const at = zero.n;
      await new Promise((r) => setTimeout(r, 80));
      expect(zero.n).toBe(at);
    });
  } finally { release(); }
});

// A pane whose save never settles to idle: its chain is already resolved, so each turn of the
// loop gets through at once, but pinSaving stays set, so the loop would turn again for ever.
// The cap must end that loop, not only the call that waits on it.
test("pinsIdle stops its loop when the cap wins: a pane that is saving but whose chain has ended does not keep it turning", async () => {
  const { v, cx, keys } = await pinPane("--extra", "3");
  v.sel = keys()[0];
  v.action("pin", cx);
  await pinsIdle();
  v.pinSaving = 1;
  v.pinChain = Promise.resolve();
  try {
    await timersOf(async (zero) => {
      await expect(pinsIdle(40)).rejects.toThrow("a pin save never ended");
      expect(zero.n).toBeGreaterThan(0); // it did turn while the cap was open
      const at = zero.n;
      await new Promise((r) => setTimeout(r, 80));
      expect(zero.n).toBe(at);
    });
  } finally { v.pinSaving = 0; }
});

// The hook that runs before every test. A pane whose save never ends fails the call once, at
// the cap; the call after that finds no pane to wait on and returns.
test("the hook before each test: a pane whose save never ends fails one call, and the next call returns with nothing to wait on", async () => {
  const hook = globalThis.__threadsHarnessEachTest;
  const { v, cx, keys } = await pinPane("--extra", "3");
  let release;
  v.pinChain = new Promise((r) => { release = r; });
  v.sel = keys()[0];
  v.action("pin", cx);
  const chain = v.pinChain;
  try {
    await expect(hook(40)).rejects.toThrow("a pin save never ended");
    await expect(hook(40)).resolves.toBeUndefined();
  } finally {
    release();
    await chain; // the late write lands now, and the call after clears it
    await hook();
  }
});
