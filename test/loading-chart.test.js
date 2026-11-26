// bun test: the loading chart (core/burn.js, chart.js, main.js loadChart): tokens over the
// session's time by model, in a bounded series filled as events apply, drawn under the
// loading state's bar and filled to the point read. The pure parts first, then the pane on
// the render harness (test/render-harness.js). Made-up sessions only.
import { test, expect } from "bun:test";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BURN, newBurn, burnTokens, burnPrompt, burnReal, burnAt } from "../mods/agent-threads/core/burn.js";
import { newSession, apply, rewindTail, sessionStats } from "../mods/agent-threads/core/turns.js";
import { chartModel, niceTop, fmtTop, fmtPer } from "../mods/agent-threads/chart.js";
import { openCounts } from "../mods/agent-threads/ui.js";
import { draw, frame, H, openingPane, settle, setup, until } from "./render-harness.js";

setup();

const HOUR = 3600000;
const iso = (ms) => new Date(ms).toISOString();
const drawnText = (calls) => calls.filter(([n, x]) => n === "child" && typeof x === "string").map(([, x]) => x);
// A label's width as chart.js reckons it.
const textW = (s) => s.length * 10.5 * 0.55;

// A working day, 8:42 to 16:57, a count every 20 to 60 s, three models.
function day(models = ["opus 5.5", "sonnet 5.5", "haiku 4.5"]) {
  const t0 = new Date(2026, 10, 20, 8, 42).getTime();
  const b = newBurn();
  let x = 7;
  const rnd = () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let t = t0; t < t0 + 8.25 * HOUR; t += 20000 + rnd() * 40000) burnTokens(b, t, models[Math.floor(rnd() * models.length)], 2000 + rnd() * 8000);
  return { b, t0, end: t0 + 8.25 * HOUR };
}

test("the chart counts what a model count adds: an id given again (streamed, repeated) adds only the difference, and its sum is the status line's tokens", () => {
  const s = newSession("s", "f.jsonl");
  const t0 = Date.UTC(2026, 10, 20, 9, 0);
  apply(s, { k: "p", o: "human", t: "Sum the cart", ts: iso(t0) });
  apply(s, { k: "m", id: "a", m: "claude-opus-5-5", u: { i: 10, o: 5, cr: 900, cc: 100 }, ts: iso(t0 + 1000) });
  apply(s, { k: "m", id: "a", m: "claude-opus-5-5", u: { i: 10, o: 50, cr: 900, cc: 100 }, ts: iso(t0 + 2000) });
  apply(s, { k: "m", id: "a", m: "claude-opus-5-5", u: { i: 10, o: 50, cr: 900, cc: 100 }, ts: iso(t0 + 3000) });
  apply(s, { k: "m", id: "b", m: "claude-haiku-4-5-20251001", u: { i: 3, o: 7, cr: 0, cc: 0 }, ts: iso(t0 + 4000) });
  const b = s.burn;
  expect(b.models).toEqual(["opus 5.5", "haiku 4.5"]);
  expect(b.tot[0]).toBe(160);
  expect(b.tot[1]).toBe(10);
  expect(b.tot[BURN.PROMPTS]).toBe(1);
  expect(b.tot[0] + b.tot[1]).toBe(sessionStats(s.turns).tokens);
  // A count with no time is not placed; a model count before any turn is not counted, as
  // the stats do not count it.
  const n = newSession("n", "f.jsonl");
  apply(n, { k: "m", id: "z", u: { i: 5, o: 5 }, ts: iso(t0) });
  expect(n.burn).toBeNull();
});

test("the chart's series stays the same size however long the session: buckets merge in pairs and the totals hold", () => {
  const b = newBurn();
  const t0 = Date.UTC(2026, 9, 1, 9, 0);
  let sum = 0;
  // 60 days, a count every 10 minutes around the clock: no gap to fold.
  for (let t = t0; t < t0 + 60 * 24 * HOUR; t += 600000) { burnTokens(b, t, "opus 5.5", 1000); sum += 1000; }
  expect(b.n).toBeLessThanOrEqual(BURN.N);
  expect(b.data.length).toBe(BURN.N * BURN.COLS);
  expect(b.data.byteLength).toBe(7168);
  expect(b.folds).toEqual([]);
  let inData = 0;
  for (let i = 0; i < b.n; i++) inData += b.data[i * BURN.COLS];
  expect(inData).toBeCloseTo(sum, -2);
  expect(b.tot[0]).toBe(sum);
  // Each bucket is a power-of-two multiple of the first width.
  expect(Math.log2(b.w / BURN.W0) % 1).toBe(0);
});

test("the chart gives five models a slot each in order of first use, and the sixth on to other", () => {
  const b = newBurn();
  const t0 = Date.UTC(2026, 10, 20, 9, 0);
  ["a", "b", "c", "d", "e", "f", "g", "a"].forEach((m, i) => burnTokens(b, t0 + i * 60000, m, 100));
  expect(b.models).toEqual(["a", "b", "c", "d", "e"]);
  expect(b.tot[0]).toBe(200);
  expect(b.tot[BURN.OTHER]).toBe(200);
  const m = chartModel(b, { w: 600, end: t0 + 8 * 60000, loaded: true, now: t0 });
  expect(m.areas.map((a) => a.slot)).toEqual([0, 1, 2, 3, 4, BURN.OTHER]);
  expect(m.legend.map((l) => l.name)).toEqual(["a", "b", "c", "d", "e", "other"]);
  // Shares only for two or three.
  expect(m.legend.every((l) => l.share === "")).toBe(true);
});

test("the chart folds an idle gap over 2 h out of its time, and still knows the real time of every point", () => {
  const b = newBurn();
  const t0 = new Date(2026, 10, 20, 9, 0).getTime();
  burnTokens(b, t0, "opus 5.5", 100);
  burnTokens(b, t0 + HOUR, "opus 5.5", 100);
  // Lunch of 1h 59m stays in.
  burnTokens(b, t0 + 2 * HOUR + 59 * 60000, "opus 5.5", 100);
  expect(b.folds).toEqual([]);
  // The night is cut.
  const morning = t0 + 24 * HOUR;
  burnTokens(b, morning, "opus 5.5", 100);
  expect(b.folds.length).toBe(2);
  expect(b.folds[1]).toBe(morning);
  expect(burnReal(b, b.v)).toBe(morning);
  expect(burnAt(b, morning)).toBe(b.v);
  expect(burnAt(b, t0 + 12 * HOUR)).toBeNull();
  for (const v of [0, 30 * 60000, b.folds[0]]) expect(burnAt(b, burnReal(b, v))).toBe(v);
  // The gap starts a bucket of its own: nothing before it shares one with what comes after.
  expect(b.folds[0] % b.w).toBe(0);
});

test("a read that takes the tail again (OpenCode) puts the chart back to the last settle first, so nothing counts twice", () => {
  const s = newSession("s", "f");
  const t0 = Date.UTC(2026, 10, 20, 9, 0);
  apply(s, { k: "p", o: "human", t: "one", ts: iso(t0) });
  apply(s, { k: "m", id: "a", m: "glm-5.3", u: { i: 10, o: 10 }, ts: iso(t0 + 1000) });
  apply(s, { k: "settle" });
  const tail = () => { apply(s, { k: "p", o: "human", t: "two", ts: iso(t0 + 60000) }); apply(s, { k: "m", id: "b", m: "glm-5.3", u: { i: 30, o: 70 }, ts: iso(t0 + 61000) }); };
  tail();
  rewindTail(s);
  tail();
  expect(s.burn.tot[0]).toBe(120);
  expect(s.burn.tot[BURN.PROMPTS]).toBe(2);
  // Read again with nothing settled: the chart starts over.
  const u = newSession("u", "f");
  apply(u, { k: "p", o: "human", t: "one", ts: iso(t0) });
  apply(u, { k: "m", id: "a", u: { i: 1, o: 1 }, ts: iso(t0) });
  rewindTail(u);
  expect(u.burn).toBeNull();
});

test("the scale's top is the peak rounded up to 1, 2 or 5 times a power of ten, in the pane's units", () => {
  expect([1.2e6, 2.9e6, 1e6, 3.4e6, 0.034, 7, 10, 11].map(niceTop)).toEqual([2e6, 5e6, 1e6, 5e6, 0.05, 10, 10, 20]);
  expect(niceTop(0)).toBeNull();
  expect([5e6, 2e5, 50, 1e9, 2e3].map(fmtTop)).toEqual(["5M", "200k", "50", "1B", "2k"]);
  expect([600000, 75000, 150000, 3600000, 4800000].map(fmtPer)).toEqual(["10 min", "75 s", "150 s", "1 h", "1 h 20 min"]);
});

test("while the read goes, nothing is drawn right of the read point, and the axis runs on to the file's last write", () => {
  const { b, t0, end } = day();
  const w = 461;
  // Read to about 40% of the day; the file was last written at the day's end.
  const part = newBurn();
  const cut = t0 + 0.4 * (end - t0);
  for (let t = t0; t < cut; t += 30000) burnTokens(part, t, "opus 5.5", 5000);
  const m = chartModel(part, { w, end, loaded: false, now: end });
  expect(m.readX).toBeGreaterThan(0.35 * w);
  expect(m.readX).toBeLessThan(0.45 * w);
  expect(m.base).toBe(m.readX);
  for (const a of m.areas) for (let i = 0; i < a.fill.length; i += 2) expect(a.fill[i]).toBeLessThanOrEqual(m.readX + 0.05);
  expect(m.top).toMatch(/^top (1|2|5)(0*)(k|M)?\/h$/);
  // Read whole: no read edge, the baseline across.
  const done = chartModel(b, { w, end, loaded: true, now: end });
  expect(done.readX).toBeNull();
  expect(done.base).toBe(w);
  expect(done.areas.length).toBe(3);
  // Every point sits in the box.
  for (const a of done.areas) for (let i = 0; i < a.fill.length; i += 2) { expect(a.fill[i]).toBeGreaterThanOrEqual(0); expect(a.fill[i]).toBeLessThanOrEqual(w + 0.05); expect(a.fill[i + 1]).toBeGreaterThanOrEqual(0); expect(a.fill[i + 1]).toBeLessThanOrEqual(72); }
  // At most CHART.PTS points per edge, however many buckets.
  expect(done.areas[0].n).toBeLessThanOrEqual(122);
});

test("the axis names the start and the end and the hours between, never two words on top of each other", () => {
  const { b, end } = day();
  for (const w of [300, 461]) {
    const m = chartModel(b, { w, end, loaded: true, now: end });
    expect(m.labels[0].text).toMatch(/^Today 8:42 AM$/);
    expect(m.labels.at(-1)).toEqual({ right: true, text: "4:57 PM" });
    const mid = m.labels.slice(1, -1);
    expect(mid.length).toBeGreaterThan(0);
    for (const l of mid) expect(l.text).toMatch(/^\d{1,2} (AM|PM)$/);
    const spans = [[0, textW(m.labels[0].text)], ...mid.map((l) => [l.x, l.x + textW(l.text)]), [w - textW(m.labels.at(-1).text), w]];
    for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThan(spans[i - 1][1]);
  }
});

test("a session of many days folds its idle nights, with a mark at each fold, and names the days", () => {
  const b = newBurn();
  const s0 = new Date(2026, 10, 13, 9, 22).getTime();
  for (let d = 0; d < 14; d++) {
    if (d === 2 || d === 3) continue;
    for (let hh = 0; hh < 8; hh += 0.05) burnTokens(b, s0 + d * 24 * HOUR + hh * HOUR, d > 6 ? "sonnet 5.5" : "opus 5.5", 2500);
  }
  const now = s0 + 13 * 24 * HOUR + 8 * HOUR;
  const m = chartModel(b, { w: 461, end: b.last, loaded: true, now });
  expect(b.folds.length / 2).toBe(11);
  expect(m.folds.length).toBe(11);
  expect(m.labels.at(-1)).toEqual({ right: true, text: "Today" });
  expect(m.labels[0].text).toBe("13 Nov");
  // Days by their date between, each once.
  const mid = m.labels.slice(1, -1).map((l) => l.text);
  expect(mid.length).toBeGreaterThan(3);
  expect(new Set(mid).size).toBe(mid.length);
  for (const t of mid) expect(t).toMatch(/^\d{1,2}$/);
  // A fold drops the area to the baseline.
  const a = m.areas[1].fill;
  const n = m.areas[1].n;
  const x = m.folds[3];
  const near = [];
  for (let i = 0; i < n; i++) if (Math.abs(a[2 * i] - x) <= 4) near.push(a[2 * i + 1]);
  expect(near).toContain(72);
});

test("the legend shows each model's share with two or three, none with one, and +n for what does not fit", () => {
  const one = chartModel(day(["opus 5.5"]).b, { w: 461, end: null, loaded: true });
  expect(one.legend).toEqual([{ slot: 0, name: "opus 5.5", share: "" }]);
  const three = chartModel(day().b, { w: 461, end: null, loaded: true });
  expect(three.legend.map((l) => l.name)).toEqual(["opus 5.5", "sonnet 5.5", "haiku 4.5"]);
  const sum = three.legend.reduce((a, l) => a + Number(l.share.replace("%", "")), 0);
  expect(sum).toBeGreaterThanOrEqual(99);
  expect(sum).toBeLessThanOrEqual(101);
  const six = chartModel(day(["opus 5.5", "sonnet 5.5", "haiku 4.5", "gpt-6.1", "glm-5.3", "kimi-k3", "qwen-4"]).b, { w: 300, end: null, loaded: true });
  expect(six.legend.length + six.more).toBe(6);
  expect(six.more).toBeGreaterThan(0);
});

test("an agent whose log has no token counts (Cursor) gets bars of the prompts typed, and says why", () => {
  const b = newBurn();
  const t0 = new Date(2026, 10, 20, 9, 10).getTime();
  for (let k = 0; k < 40; k++) burnPrompt(b, t0 + k * 11 * 60000);
  const end = t0 + 7.9 * HOUR;
  const m = chartModel(b, { w: 461, end, loaded: false, prompts: true, agent: "Cursor", now: end });
  expect(m.title).toBe("Prompts over time");
  expect(m.note).toBe("Cursor's log has no token counts");
  expect(m.legend).toEqual([{ slot: BURN.PROMPTS, name: "prompts", share: "" }]);
  expect(m.areas).toEqual([]);
  expect(m.bars.length).toBeGreaterThan(10);
  expect(m.top).toMatch(/^top (1|2|5) per \d+ (min|s)$/);
  for (const r of m.bars) { expect(r.x).toBeLessThanOrEqual(m.readX); expect(r.h).toBeLessThanOrEqual(72); }
  // Before any prompt: the title, the legend, nothing drawn.
  const none = chartModel(null, { w: 461, prompts: true, agent: "Cursor" });
  expect(none.bars).toEqual([]);
  expect(none.top).toBe("");
  expect(none.title).toBe("Prompts over time");
});

test("the counts so far are two rows: prompts, tool calls and pins, then the tokens with the cache share; a count not recorded is left out", () => {
  expect(openCounts({ prompts: 87, tools: 1702, pins: 1, tokens: 14.9e6, cachePct: 90.4 })).toEqual(["So far: 87 prompts · 1,702 tool calls · 1 pin", "14.9M tokens · cache 90.4%"]);
  expect(openCounts({ prompts: 41, tools: null, pins: 2, tokens: null, cachePct: null })).toEqual(["So far: 41 prompts · 2 pins", ""]);
  expect(openCounts({ prompts: null, tools: null, pins: 0, tokens: null })).toEqual(["", ""]);
});

// A made-up session of six hours: a prompt each half hour, opus for the first four hours and
// sonnet after, each turn with a tool result of 300 KB, so the read takes several chunks.
function chartSession() {
  const t0 = Date.UTC(2026, 10, 20, 9, 0);
  const lines = [];
  for (let k = 0; k < 12; k++) {
    const t = t0 + k * 30 * 60000;
    const model = k < 8 ? "claude-opus-5-5" : "claude-sonnet-5-5";
    lines.push({ type: "user", uuid: `u${k}`, timestamp: iso(t), sessionId: "s", origin: { kind: "human" }, promptSource: "typed", message: { role: "user", content: `Check part ${k} of the cart` } });
    lines.push({ type: "assistant", uuid: `a${k}`, timestamp: iso(t + 1000), sessionId: "s", message: { id: `m${k}a`, model, role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: `t${k}`, name: "Read", input: { file_path: `cart/part${k}.ts` } }], usage: { input_tokens: 40, output_tokens: 200, cache_read_input_tokens: 9000, cache_creation_input_tokens: 500 } } });
    lines.push({ type: "user", uuid: `r${k}`, timestamp: iso(t + 2000), sessionId: "s", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t${k}`, content: `const zib${k} = "${"ka".repeat(150000)}";` }] } });
    lines.push({ type: "assistant", uuid: `z${k}`, timestamp: iso(t + 60000), sessionId: "s", message: { id: `m${k}z`, model, role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: `Part ${k} adds up.` }], usage: { input_tokens: 20, output_tokens: 400, cache_read_input_tokens: 9500, cache_creation_input_tokens: 300 } } });
  }
  const file = join(mkdtempSync(join(tmpdir(), "threads-chart-")), "c.jsonl");
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  // Last written as its last turn ends, so the axis is the session's six hours.
  const end = (t0 + 11 * 30 * 60000 + 60000) / 1000;
  utimesSync(file, end, end);
  return file;
}

test("the pane: the chart has its rows from the first paint, fills from the first chunk to the read point, and goes with the loading state", async () => {
  const { v, cx, go } = await openingPane(chartSession(), (v) => v.current()?.offset > 0);
  const o = v.opening;
  o.at -= 1000;
  go((v) => v.current()?.offset > 0);
  await until(() => v.current().offset > 0 && v.opening?.peek && v.opening.mtime, "the first chunk");
  const s = v.current();
  expect(s.loaded).toBeFalsy();
  // With no point yet (as before the first chunk): the chart's title, no scale, no legend.
  const burn = s.burn;
  s.burn = null;
  const first = drawnText(frame(v, cx));
  expect(first).toContain("Reading this session");
  expect(first).toContain("Tokens over time");
  expect(first.some((x) => x.startsWith("top "))).toBe(false);
  expect(first).not.toContain("opus 5.5");
  s.burn = burn;
  const said = drawnText(frame(v, cx));
  expect(said).toContain("Tokens over time");
  expect(said.some((x) => /^top (1|2|5)0*(k|M)?\/h$/.test(x))).toBe(true);
  expect(said).toContain("opus 5.5");
  expect(said).not.toContain("sonnet 5.5");
  const m = o.chart.m;
  // Six hours on the axis, the first chunk's turns read: filled part way.
  const w = Number(o.chart.key.split("|")[1]);
  expect(m.readX).toBeGreaterThan(0.1 * w);
  expect(m.readX).toBeLessThan(0.9 * w);
  // The same chart is kept while nothing changed.
  const kept = o.chart;
  draw(v, cx);
  expect(o.chart).toBe(kept);
  // The counts in two rows, the tokens with the cache share.
  expect(said.join("|")).toMatch(/So far: \d+ prompts? · \d+ tool calls?/);
  go(() => false);
  await settle(v);
  expect(s.loaded).toBe(true);
  expect(s.burn.models).toEqual(["opus 5.5", "sonnet 5.5"]);
  expect(s.burn.tot[0] + s.burn.tot[1]).toBe(v.statusStats().tokens);
  for (let k = 0; k < 300 && v.openActive(); k++) { cx.flush(16); draw(v, cx); }
  expect(v.openActive()).toBe(false);
  expect(o.chart).toBeNull();
  H.rec = null;
});
