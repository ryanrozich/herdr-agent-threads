// bun test: the render harness starts each test file clean. bun runs every test file in one
// process and loads test/render-harness.js once, so a setting one file leaves behind would
// reach the next file that uses the harness; setup() puts them all back.
import { test, expect } from "bun:test";
import { closed, editors, hostReads, keyBinds, lacking, mdSources, overlays, scrollHandles, settingsWrites, setup, stubHas, views, work, H } from "./render-harness.js";

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
  extractHook: null,
  extractCalls: null,
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
