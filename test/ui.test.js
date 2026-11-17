// bun test: drawing helpers (pure, no Herdr).
import { test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  keyAction, alpha, spans, around, langFor, clipPrompt, wrappedLines, dayKey, jumpTarget,
  rowLines, flattenMd, middle, rowShape, rowHeight, rowTextWidth, bubbleMax, commandLayout, ROW, senderLabel, senderIcon, kindWords,
  isShown, visible, countLabel, focusTarget, contrast, mix, labelColor, youHeight, dayParts, bandFill, BAND_LIGHT, over,
  readType, readWidth, replyWidth, MEASURE, PROSE_EM, RAIL, railWindow, toolKind, groupText, groupKinds, KIND_ICON, callTime, outLines, outHeight, outLang, callText, shortPaths, OUT,
  pinColumn, PIN_SPLIT_MIN, PIN_COL, PIN_STEP, headerButtonWidth, columnResize, codeRows, splitTables, tableCells, tableNeed, TABLE_COL_CHARS, TABLE_CELL_PAD,
  mdPreview, fitWidth, mdChunks, escapeDollars, cutMd, galleryBox, VIEWER, viewerLayout, viewerKey, labelPieces, replyBlocks, replyScroll, fencedBlock, MD_MAX,
  keySheet, fitHints, hintWidth, agentState,
} from "../mods/agent-threads/ui.js";

const key = (key, mods = {}) => ({ key, modifiers: { shift: false, control: false, alt: false, platform: false, function: false, ...mods } });

test("keys: plain keys act, chords with cmd, ctrl, alt or fn never do", () => {
  expect(keyAction(key("j"))).toBe("next");
  expect(keyAction(key("k"))).toBe("prev");
  expect(keyAction(key("down"))).toBe("next");
  expect(keyAction(key("g"))).toBe("jump");
  expect(keyAction(key("home"))).toBe("first");
  expect(keyAction(key("["))).toBe("prevDay");
  expect(keyAction(key("]"))).toBe("nextDay");
  expect(keyAction(key("g", { shift: true }))).toBe("latest");
  expect(keyAction(key("end"))).toBe("latest");
  expect(keyAction(key("enter"))).toBe("open");
  expect(keyAction(key("c"))).toBe("copy");
  expect(keyAction(key("/"))).toBe("filter");
  expect(keyAction(key("escape"))).toBe("escape");
  expect(keyAction(key("c", { platform: true }))).toBe(null);
  expect(keyAction(key("c", { control: true }))).toBe(null);
  expect(keyAction(key("/", { platform: true }))).toBe(null);
  expect(keyAction(key("t", { platform: true, shift: true }))).toBe(null);
  expect(keyAction(key("j", { alt: true }))).toBe(null);
  expect(keyAction(key("down", { function: true }))).toBe(null);
  expect(keyAction(key("c", { shift: true }))).toBe(null);
  expect(keyAction(key("x"))).toBe(null);
  // while typing a filter only these keys reach the list
  expect(keyAction(key("j"), true)).toBe(null);
  expect(keyAction(key("c"), true)).toBe(null);
  expect(keyAction(key("down"), true)).toBe("next");
  expect(keyAction(key("escape"), true)).toBe("escape");
});

test("alpha: every colour form", () => {
  expect(alpha("#ff8800", 0.5)).toBe("#ff880080");
  expect(alpha("#f80", 1)).toBe("#ff8800ff");
  expect(alpha("#ff880080", 0.5)).toBe("#ff880040");
  expect(alpha("rgb(255, 136, 0)", 0)).toBe("#ff880000");
  expect(alpha("rgba(255,136,0,0.5)", 0.5)).toBe("#ff880040");
  expect(alpha("rgb(255 136 0 / 50%)", 1)).toBe("#ff880080");
  expect(alpha("transparent", 0.5)).toBe("transparent");
});

test("alpha: every colour of a synthetic theme, and of every installed theme, parses", () => {
  // The synthetic set always runs, so the test does not depend on the machine (A7); the
  // installed themes (read only) are checked too when the folder exists.
  const colours = new Set(["#1e1e1e", "#FFF", "#e6e6e6cc", "rgb(30, 30, 30)", "rgba(255,255,255,0.4)", "rgb(10 20 30 / 25%)"]);
  for (const c of colours) expect(alpha(c, 0.5)).toMatch(/^#[0-9a-f]{8}$/);
  const dir = join(homedir(), ".config/herdr-app/themes");
  if (!existsSync(dir)) return;
  const walk = (v) => {
    if (typeof v === "string" && /^(#|rgb)/i.test(v.trim())) colours.add(v.trim());
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try { walk(JSON.parse(readFileSync(join(dir, f), "utf8"))); } catch { /* not a theme */ }
  }
  for (const c of colours) expect(alpha(c, 0.5)).toMatch(/^#[0-9a-f]{8}$/);
});

test("spans split around every match, any case", () => {
  expect(spans("Fix the login and LOGIN test", "login")).toEqual([
    { t: "Fix the ", hit: false }, { t: "login", hit: true }, { t: " and ", hit: false }, { t: "LOGIN", hit: true }, { t: " test", hit: false },
  ]);
  expect(spans("abc", "")).toEqual([{ t: "abc", hit: false }]);
  expect(spans("login", "login")).toEqual([{ t: "login", hit: true }]);
  expect(spans("", "x")).toEqual([{ t: "", hit: false }]);
  expect(around(`${"a ".repeat(40)}needle here`, "needle")).toStartWith("…");
  expect(around("short needle", "needle")).toBe("short needle");
});

test("languages map to a highlighter or plain text", () => {
  expect(langFor("ts")).toBe("js");
  expect(langFor("TSX")).toBe("js");
  expect(langFor("jsonc")).toBe("json");
  expect(langFor("toml")).toBe("yaml");
  expect(langFor("sh")).toBe("bash");
  expect(langFor("dockerfile")).toBe("bash");
  expect(langFor("")).toBe("txt");
  expect(langFor("brainfuck")).toBe("txt");
});

test("prompts clip by wrapped lines and a character cap", () => {
  const forty = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
  const a = clipPrompt(forty, 3, 50);
  expect(a.text.split("\n").length).toBe(3);
  expect(a.more).toBe(37);
  const one = "word ".repeat(1000).trim();
  const b = clipPrompt(one, 3, 50);
  expect(b.text.length).toBeLessThanOrEqual(3 * 50 + 2);
  expect(b.more).toBe(wrappedLines(one, 50) - 3);
  expect(clipPrompt("short", 3, 50)).toEqual({ text: "short", more: 0 });
  expect(clipPrompt("x ".repeat(400), 30, 200, 600).text.length).toBeLessThanOrEqual(602);
});

test("day keys follow the local calendar", () => {
  expect(dayKey(new Date(2026, 10, 1, 23, 59).getTime())).not.toBe(dayKey(new Date(2026, 10, 2, 0, 1).getTime()));
  expect(dayKey(null)).toBe(null);
});

test("a day divider names today and yesterday with their date, and older days by weekday", () => {
  const now = new Date(2026, 10, 5, 12, 0).getTime();
  expect(dayParts(new Date(2026, 10, 5, 9, 0).getTime(), now)).toEqual({ name: "Today", date: "Thu 5 Nov" });
  expect(dayParts(new Date(2026, 10, 4, 23, 0).getTime(), now)).toEqual({ name: "Yesterday", date: "Wed 4 Nov" });
  expect(dayParts(new Date(2026, 10, 2, 9, 0).getTime(), now)).toEqual({ name: "Monday 2 Nov", date: null });
});

test("the day band: raised in a dark theme, darker than raised in a light one, never past the selected row", () => {
  const dark = { background: "#17191d", foreground: "#e6e6e6", raised: "#2c2e31", selected: "#ffffff17" };
  expect(bandFill(dark)).toBe(dark.raised);
  const light = { background: "#ffffff", foreground: "#1f2328", raised: "#f6f6f6", selected: "#00000012" };
  const fill = bandFill(light);
  expect(contrast(fill, light.background)).toBeGreaterThan(contrast(light.raised, light.background));
  expect(contrast(fill, light.background)).toBeGreaterThanOrEqual(BAND_LIGHT);
  expect(contrast(fill, light.background)).toBeLessThanOrEqual(contrast(over(light.selected, light.background), light.background));
  // A light theme whose selected row sits between raised and the goal: the band stops at it.
  const faint = { ...light, selected: "#0000000e" };
  expect(contrast(over(faint.selected, light.background), light.background)).toBeLessThan(BAND_LIGHT);
  expect(contrast(bandFill(faint), light.background)).toBeLessThanOrEqual(contrast(over(faint.selected, light.background), light.background) + 0.01);
  // A light theme whose card fill already stands out keeps it.
  expect(bandFill({ ...light, raised: "#e4e4e4" })).toBe("#e4e4e4");
  // Colours that do not parse fall back to raised.
  expect(bandFill({ ...light, background: "var(--bg)" })).toBe(light.raised);
  expect(over("#00000080", "#ffffff")).toBe("#7f7f7f");
  expect(over("#123456", "#ffffff")).toBe("#123456");
  // Installed themes (read only): dark ones keep raised; light ones stay within selected.
  const dir = join(homedir(), ".config/herdr-app/themes");
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    let c;
    try { c = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
    c = c.colors ?? c;
    if (!c.background || !c.foreground || !c.raised) continue;
    expect(typeof bandFill(c)).toBe("string");
  }
});

test("#N in the filter field is a jump, anything else a filter", () => {
  expect(jumpTarget("#12")).toBe(12);
  expect(jumpTarget(" #3 ")).toBe(3);
  expect(jumpTarget("#")).toBe(0);
  expect(jumpTarget("#12a")).toBe(null);
  expect(jumpTarget("login")).toBe(null);
  expect(jumpTarget("")).toBe(null);
});

// ---- v1 feedback ----

test("keys: a agents, t terminal, comma settings; none while filtering", () => {
  expect(keyAction(key("a"))).toBe("agents");
  expect(keyAction(key("t"))).toBe("focus");
  expect(keyAction(key(","))).toBe("settings");
  expect(keyAction(key("a"), true)).toBe(null);
  expect(keyAction(key("t"), true)).toBe(null);
  expect(keyAction(key(","), true)).toBe(null);
  expect(keyAction(key("a", { platform: true }))).toBe(null);
});

// Characters per line in a collapsed row's prompt at a pane width (same formula as main.js).
// rowLines on its own, at a fixed text width per pane width (the wrapping, not the layout).
const per = (w) => (w - 32) / ROW.PROMPT_CHAR;

test("rowLines: short, exactly two lines, long paths, CJK, limits 1 and 6", () => {
  for (const w of [240, 380]) {
    const short = rowLines("Is the staging deploy green?", 2, per(w));
    expect(short).toEqual({ lines: ["Is the staging deploy green?"], cut: false });
    const long = "Why does the checkout job fail when the staging deploy runs after the nightly migration and the cache is cold, and what would make it pass reliably every time?";
    const two = rowLines(long, 2, per(w));
    expect(two.lines.length).toBe(2);
    expect(two.cut).toBe(true);
    expect(two.lines[1].endsWith("…")).toBe(true);
    for (const l of two.lines) expect(l.length).toBeLessThanOrEqual(Math.floor(per(w)));
    const path = `/srv/app/${"segment/".repeat(36)}file.ts`; // 300 characters, no spaces
    expect(path.length).toBeGreaterThanOrEqual(300);
    const p = rowLines(path, 2, per(w));
    expect(p.lines.length).toBe(2);
    expect(p.lines[0].length).toBe(Math.floor(per(w)));
    expect(p.lines[1].endsWith("…")).toBe(true);
    const cjk = rowLines("检查一下这个函数为什么在生产环境里会失败然后修复它并添加测试用例再更新文档说明", 2, per(w));
    expect(cjk.lines.length).toBe(2);
    // wide characters count twice
    expect([...cjk.lines[0]].length).toBeLessThanOrEqual(Math.floor(per(w) / 2));
    expect(rowLines(long, 1, per(w)).lines.length).toBe(1);
    expect(rowLines(long, 6, per(w)).lines.length).toBeLessThanOrEqual(6);
  }
  // exactly two lines worth of text, no ellipsis
  const fits = rowLines("aaaa bbbb cccc dddd", 2, 9);
  expect(fits).toEqual({ lines: ["aaaa bbbb", "cccc dddd"], cut: false });
  expect(rowLines("line one\nline two", 2, 40)).toEqual({ lines: ["line one line two"], cut: false });
  expect(rowLines("", 2, 30)).toEqual({ lines: [], cut: false });
});

test("flattenMd: bullets, fences, links, emphasis, headings", () => {
  const md = "## Summary\n\nFixed **two** bugs in `cart.ts`:\n\n- the [badge](https://x.test/a) count\n- the _retry_ loop\n\n```ts\nconst x = 1\n```\n\n> Done. snake_case_name stays.";
  expect(flattenMd(md)).toBe("Summary Fixed two bugs in cart.ts: the badge count · the retry loop [code] Done. snake_case_name stays.");
  expect(flattenMd("1. one\n2. two")).toBe("one · two");
  const r = rowLines(flattenMd(md), 3, (rowTextWidth(240) - 17) / ROW.REPLY_CHAR);
  expect(r.lines.length).toBe(3);
  expect(r.lines.join(" ")).not.toMatch(/[*`#]/);
});

test("row heights follow the clipped line counts at 240 and 380 px", () => {
  const long = "Why does the checkout job fail when the staging deploy runs after the nightly migration and the cache is cold?";
  const reply = "## Fixed\n\n- the guard\n- the retry\n\n```ts\nx\n```\n\nThe nightly migration now runs before the deploy, so the cache is warm when the checkout job starts and the job passes.";
  for (const w of [240, 380]) {
    // An agent turn with no text (a task notification that opens a session) (F4).
    expect(rowShape({ prompt: "", reply: "x", width: w, promptLines: 2, replyLines: 3, agent: true }).prompt).toEqual(["(no message text)"]);
    expect(rowShape({ prompt: "", reply: "x", width: w, promptLines: 2, replyLines: 3 }).prompt).toEqual(["(empty prompt)"]);
    const a = rowShape({ prompt: "Short prompt", reply: "Done.", width: w, promptLines: 2, replyLines: 3 });
    expect([a.p, a.r, a.height]).toEqual([1, 1, rowHeight(1, 1)]);
    const b = rowShape({ prompt: long, reply, width: w, promptLines: 2, replyLines: 3 });
    expect(b.p).toBe(2);
    expect(b.r).toBe(w === 240 ? 3 : b.r);
    expect(b.height).toBe(rowHeight(b.p, b.r, (b.pMore ? 1 : 0) + (b.rMore ? 1 : 0)));
    expect(b.pMore).toBe(true);
    expect(a.pMore || a.rMore).toBe(false);
    // The bubble fits its widest line, up to 82% of the text width (90% under 320 px).
    expect(a.bubbleW).toBeLessThan(b.bubbleW);
    expect(b.bubbleW).toBeLessThanOrEqual(bubbleMax(w));
    const one = rowShape({ prompt: long, reply, width: w, promptLines: 1, replyLines: 1 });
    expect([one.p, one.r]).toEqual([1, 1]);
    const six = rowShape({ prompt: long.repeat(4), reply: reply.repeat(4), width: w, promptLines: 6, replyLines: 8 });
    expect(six.p).toBe(6);
    expect(six.r).toBe(8);
  }
  // Padding 8, bubble 6 + lines + 6, gap 6, the strip under it 16, gap 6, the line 24, gap
  // 6, reply lines, gap 6, the strip under the reply 16, padding 10. No meta line over the
  // bubble and no stats line. Lines are 21 px at the 14 px default.
  expect(rowHeight(1, 1)).toBe(8 + 12 + 22 + 6 + 16 + 6 + 24 + 6 + 22 + 6 + 16 + 10);
  expect(rowHeight(4, 6)).toBe(8 + 12 + 88 + 6 + 16 + 6 + 24 + 6 + 132 + 6 + 16 + 10);
  // An agent's message has its sender's name over the bubble.
  expect(rowHeight(1, 1, 0, 22, true)).toBe(rowHeight(1, 1) + 16 + 6);
  expect(rowShape({ prompt: "Short", reply: "Done.", width: 380, promptLines: 2, replyLines: 3, agent: true }).height).toBe(rowHeight(1, 1, 0, 22, true));
  expect(ROW.NAME).toBeUndefined();
  expect(rowHeight(1, 1, 2)).toBe(rowHeight(1, 1) + 36);
  expect(rowHeight(1, 1, 0, 25)).toBe(rowHeight(1, 1) + 6);
  expect(bubbleMax(380)).toBe(Math.floor(348 * 0.82));
  expect(bubbleMax(280)).toBe(Math.floor(248 * 0.9));
});

test("reading type: 14 px on 22 px lines by default, and a line of about 70 characters at any width", () => {
  const d = readType();
  expect([d.size, d.line, d.small]).toEqual([14, 22, 13.5]);
  // At least 1.5 times the size at every setting (WCAG 2.2 SC 1.4.8), about 1.57.
  for (let px = 12; px <= 18; px++) expect(readType(px).line / px).toBeGreaterThanOrEqual(1.53);
  expect(readType(16).line).toBe(25);
  expect(readType(40).size).toBe(18);
  expect(readType(Number.NaN).size).toBe(14);
  // The reading line is MEASURE characters of prose: 461 px at 14 px, 527 at 16.
  expect(d.measure).toBe(Math.round(MEASURE * PROSE_EM * 14));
  expect(MEASURE).toBeGreaterThanOrEqual(65);
  expect(MEASURE).toBeLessThanOrEqual(75);
  expect(readType(16).measure).toBeGreaterThan(d.measure);
  // A wide pane: the reply and the bubble stop at the reading line; a narrow one keeps its width.
  expect(readWidth(960)).toBe(d.measure);
  expect(readWidth(520)).toBe(d.measure);
  expect(readWidth(280)).toBe(replyWidth(280));
  expect(replyWidth(960)).toBe(928);
  expect(bubbleMax(960)).toBe(d.measure + 20);
  expect(bubbleMax(960, 18)).toBeGreaterThan(bubbleMax(960));
  // At 960 px a long reply wraps at the reading line, not across the pane.
  const words = "the nightly migration now runs before the deploy so the cache is warm ".repeat(8);
  const sh = rowShape({ prompt: "x", reply: words, width: 960, promptLines: 1, replyLines: 4 });
  for (const l of sh.reply) expect(l.length).toBeLessThanOrEqual(Math.ceil(d.measure / d.reply) + 1);
  expect(sh.reply[0].length).toBeGreaterThan(55);
  // Bigger text: fewer characters a line, taller lines.
  const big = rowShape({ prompt: "x", reply: words, width: 380, promptLines: 1, replyLines: 4, size: 18 });
  const base = rowShape({ prompt: "x", reply: words, width: 380, promptLines: 1, replyLines: 4 });
  expect(big.reply[0].length).toBeLessThan(base.reply[0].length);
  expect(big.height).toBe(rowHeight(1, 4, 1, 28));
});

test("command rows: the chip takes width from the first line and long names cut in the middle", () => {
  const c = commandLayout("/review-pr", "12", 380, 2);
  expect(c).toMatchObject({ label: "/review-pr", lines: ["12"], rows: 1 });
  const long = commandLayout("/plugin-marketplace:review-pull-request", "12 --deep check the retry path and the backoff", 240, 2);
  expect(long.label).toContain("…");
  expect(long.label.startsWith("/pl")).toBe(true);
  expect(long.chipW).toBeLessThanOrEqual(Math.floor(rowTextWidth(240) * 0.45));
  // the args wrap in the space right of the chip, so they need more lines than the full width
  const plain = rowLines("12 --deep check the retry path and the backoff", 2, rowTextWidth(240) / ROW.PROMPT_CHAR);
  expect(long.lines.length).toBeGreaterThanOrEqual(plain.lines.length);
  expect(commandLayout("/x", "", 240, 2)).toMatchObject({ label: "/x", lines: [], rows: 1 });
  expect(middle("abcdefghij", 5)).toBe("ab…ij");
  expect(middle("abc", 5)).toBe("abc");
});

test("sender labels, icons and kinds", () => {
  const hc = { kind: "hc", name: "t7 review" };
  expect(senderLabel(hc, 240)).toBe("t7 review");
  expect(senderLabel(hc, 380)).toBe("t7 review · hc report");
  expect(senderLabel({ kind: "hc", name: "t3 lead", request: true }, 380)).toBe("t3 lead · hc request");
  expect(senderLabel({ kind: "peer", name: "helper-a" }, 380)).toBe("helper-a · agent message");
  expect(senderLabel({ kind: "peer" }, 380)).toBe("Agent message");
  expect(senderLabel({ kind: "peer" }, 240)).toBe("Agent message");
  expect(senderLabel({ kind: "scheduled" }, 380)).toBe("Scheduled");
  expect(senderLabel({ kind: "sdk" }, 240)).toBe("SDK");
  expect(senderLabel({ kind: "task-notification" }, 380)).toBe("Task notification");
  expect(senderLabel({ kind: "something-new" }, 380)).toBe("Background agent");
  expect(senderIcon(hc)).toBe("bot");
  expect(senderIcon({ kind: "scheduled" })).toBe("clock");
  expect(senderIcon({ kind: "sdk" })).toBe("square-terminal");
  expect(kindWords({ kind: "peer" })).toBe("agent message");
});

test("visible: agent turns hidden by default, shown when on, live always, numbers keep gaps", () => {
  const T = (n, agent) => ({ n, agent, prompt: agent ? "report" : `mine ${n}` });
  const turns = [T(1, false), T(2, true), T(3, false), T(4, true), T(5, true)];
  const off = visible(turns);
  expect(off.shown.map((t) => t.n)).toEqual([1, 3]);
  expect(off.hidden).toBe(3);
  const on = visible(turns, { agentTurns: true });
  expect(on.shown.map((t) => t.n)).toEqual([1, 2, 3, 4, 5]);
  expect(on.hidden).toBe(0);
  // the live newest turn shows whoever sent it
  expect(visible(turns, { live: turns[4] }).shown.map((t) => t.n)).toEqual([1, 3, 5]);
  expect(isShown(turns[1])).toBe(false);
  expect(isShown(turns[1], { live: true })).toBe(true);
  // filter counts: matches shown and matches hidden
  const f = visible(turns, { match: (t) => t.prompt.includes("report") || t.n === 1 });
  expect([f.matched, f.hiddenMatches, f.shown.length]).toEqual([1, 3, 2]);
  expect(countLabel(99)).toBe("99");
  expect(countLabel(100)).toBe("99+");
  expect(countLabel(4321)).toBe("99+");
});

test("focusTarget: the terminal's pane in this tab, then any pane, then none", () => {
  const panes = [
    { pane: "p1", tab: "A", terminal: "t1" },
    { pane: "p2", tab: "B", terminal: "t4" },
    { pane: "p3", tab: "A", terminal: "t4" },
    { pane: "p9", tab: "A", terminal: null, mod: "agent-threads" },
  ];
  expect(focusTarget(panes, "t4", "A").pane).toBe("p3");
  expect(focusTarget(panes, "t4", "C").pane).toBe("p2");
  expect(focusTarget(panes, "t4", null).pane).toBe("p2");
  expect(focusTarget(panes, "t7", "A")).toBe(null);
  expect(focusTarget([], "t4", "A")).toBe(null);
});

test("contrast and the sender label colour", () => {
  expect(contrast("#000000", "#ffffff")).toBe(21);
  expect(contrast("#777777", "#777777")).toBe(1);
  expect(contrast("nope", "#fff")).toBe(null);
  expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  expect(labelColor("#c678dd", "#e6e6e6", "#1e1e1e")).toBe("#c678dd");
  const dim = labelColor("#5a3e66", "#e6e6e6", "#1e1e1e");
  expect(dim).not.toBe("#5a3e66");
  expect(contrast(dim, "#1e1e1e")).toBeGreaterThanOrEqual(4.5);
  // a theme whose foreground is its background: keep ansi5 rather than make it worse
  expect(labelColor("#aa00aa", "#000000", "#000000")).toBe("#aa00aa");
});

test("YOU block heights for 1-, 4- and 20-line prompts at 240 and 380 px", () => {
  for (const w of [240, 380]) {
    const inner = w - 32;
    const one = youHeight("Fix the login test", inner);
    expect(one).toBe(8 + 10 + 16 + 4 + 18 + 10 + 10);
    const four = youHeight("a\nb\nc\nd", inner);
    expect(four).toBe(8 + 10 + 16 + 4 + 5 * 18 + 10 + 10); // one line of slack
    const twenty = youHeight(Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"), inner, { link: true });
    expect(twenty).toBe(8 + 10 + 16 + 4 + 21 * 18 + 10 + 22 + 10); // 20 lines and one of slack
    const huge = youHeight(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"), inner);
    expect(huge).toBe(8 + 10 + 16 + 4 + 420 + 10 + 10);
  }
});

// The agent toggle crash: pressing a on a busy session interrupted the render (Herdr runs mods in an
// interpreter with a deadline). A row reads only the text its lines can show.
test("rowLines and flattenMd read only the start of a long text", () => {
  const words = Array.from({ length: 400000 }, (_, i) => ["deploy", "check", "retry", "queue"][i % 4]).join(" ");
  const token = "x".repeat(2_000_000);
  const t0 = performance.now();
  const a = rowLines(words, 3, 50);
  const b = rowLines(token, 3, 50);
  const c = flattenMd(`${words}\n- item`, 400);
  expect(performance.now() - t0).toBeLessThan(150);
  expect(a.lines.length).toBe(3);
  expect(a.cut).toBe(true);
  expect(a.lines[2].endsWith("…")).toBe(true);
  expect(b.lines).toEqual(["x".repeat(50), "x".repeat(50), `${"x".repeat(49)}…`]);
  expect(c.length).toBeLessThan(400 * 8 + 600);
  // The cut never changes what fits: same lines as the text cut well past the limit.
  const short = words.slice(0, 2000);
  expect(rowLines(short, 3, 50)).toEqual(a);
});

// R2: the read limit counts prose only, so a long code block at the start of a reply no longer
// hides the prose after it.
test("flattenMd with a limit reads the prose after a long leading code block", () => {
  const block = `\`\`\`js\n${Array.from({ length: 200 }, (_, i) => `const v${i} = compute(${i});`).join("\n")}\n\`\`\`\nThe explanation follows here.`;
  expect(block.length).toBeGreaterThan(4000);
  expect(flattenMd(block, 304)).toBe("[code] The explanation follows here.");
  expect(flattenMd(block, 304)).toBe(flattenMd(block));
  expect(flattenMd("~~~~\n```\ninside\n~~~~\nafter", 100)).toBe("[code] after");
  expect(flattenMd("a\r\n```\r\ncode\r\n```\r\nb", 100)).toBe("a [code] b");
  expect(flattenMd("```\nnever closed\nmore", 100)).toBe("[code]");
  const huge = `\`\`\`\n${"x = 1\n".repeat(200000)}\`\`\`\nAfter.`;
  const t0 = performance.now();
  expect(flattenMd(huge, 304)).toBe("[code] After.");
  expect(performance.now() - t0).toBeLessThan(50);
});

// ---- round 3: D1, the card's caps labels and counts line --------------------------------

test("cardLabelColor: muted where it reads at 4.5:1 on the card, else foreground", async () => {
  const { cardLabelColor, contrast } = await import("../mods/agent-threads/ui.js");
  const pass = { raised: "#262626", background: "#1e1e1e", muted: "#a0a0a0", dim: "#777777", foreground: "#e6e6e6" };
  expect(contrast(pass.dim, pass.raised)).toBeLessThan(4.5); // why dim is no longer used for them
  expect(cardLabelColor(pass)).toBe(pass.muted);
  expect(cardLabelColor(pass, pass.background)).toBe(pass.muted);
  const fail = { ...pass, muted: "#6a6a6a" };
  expect(contrast(fail.muted, fail.raised)).toBeLessThan(4.5);
  expect(cardLabelColor(fail)).toBe(fail.foreground);
  const light = { raised: "#f2f2f2", background: "#ffffff", muted: "#5c5c5c", foreground: "#1a1a1a" };
  expect(cardLabelColor(light)).toBe(light.muted);
  expect(cardLabelColor({ ...light, muted: "#9a9a9a" })).toBe(light.foreground);
  // Installed theme files that carry these colours (read only); Herdr derives them for
  // palette-only files, which the debug report's contrast list covers at run time.
  const dir = join(homedir(), ".config/herdr-app/themes");
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    let c;
    try { c = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
    c = c.colors ?? c;
    if (!c.muted || !c.raised || !c.foreground) continue;
    const ink = cardLabelColor(c);
    expect(ink === c.foreground || contrast(ink, c.raised) >= 4.5).toBe(true);
  }
});

test("the Pinned column: from 480 px, 40% of Threads and a step, 380 to 440 px, never under 240 or leaving Threads under 200", () => {
  expect(PIN_SPLIT_MIN).toBe(480);
  // One step (PIN_STEP, one press of =) wider than it opened before: 373 px beside the
  // 573 px reading-width pane, where it opened at 333.
  expect(PIN_STEP).toBe(40);
  for (const [w, px] of [[0, null], [380, null], [479, null], [480, 280], [498, 298], [571, 371], [573, 373], [580, 380], [700, 380], [820, 380], [900, 400], [960, 424], [1000, 440], [1600, 440]]) {
    expect(pinColumn(w)).toBe(px);
    if (px) { expect(w - px).toBeGreaterThanOrEqual(200); expect(px).toBeGreaterThanOrEqual(PIN_COL[0]); }
    // A compact row's text (the column less 54 px) holds about 45 prompt characters from 580 px.
    if (w >= 580) expect((px - 54) / 6.7).toBeGreaterThanOrEqual(48);
  }
  // A width the owner left the column at wins, within 240 to 640 px and Threads at least 240.
  for (const [w, kept, px] of [[1000, 300, 300], [1000, 460, 460], [600, 500, 360], [571, 300, 300], [1600, 700, 640], [500, 200, 240], [470, 300, null]]) {
    expect(pinColumn(w, kept)).toBe(px);
  }
  expect(pinColumn(Number.NaN)).toBe(null);
  expect(headerButtonWidth(null)).toBe(24);
  expect(headerButtonWidth("Pinned 2")).toBe(69);
});

test("codeRows: a code line wrapped word by word, a long word split across rows", () => {
  expect(codeRows("ls", 40)).toBe(1);
  expect(codeRows("", 40)).toBe(1);
  expect(codeRows("a\nb\nc", 40)).toBe(3);
  expect(codeRows("aaaa bbbb cccc", 9)).toBe(2);
  expect(codeRows("x".repeat(25), 10)).toBe(3);
  expect(codeRows("cd ~/acme-web-try && git fetch && git checkout coupon-checks && git pull", 40)).toBe(2);
});

test("columnResize: the column by d and Threads by -d, within 200 to 640 px and Threads at least 240", () => {
  expect(columnResize(252, 700, 40)).toEqual({ column: 292, main: 660 });
  expect(columnResize(252, 700, -40)).toEqual({ column: 212, main: 740 });
  expect(columnResize(212, 740, -40)).toEqual({ column: 200, main: 752 });
  expect(columnResize(200, 752, -40)).toBe(null);
  expect(columnResize(252, 260, 40)).toEqual({ column: 272, main: 240 });
  expect(columnResize(272, 240, 40)).toBe(null);
  expect(columnResize(630, 900, 40)).toEqual({ column: 640, main: 890 });
  expect(columnResize(undefined, 700, 40)).toBe(null);
});

test("a collapsed reply as Markdown: whole source lines within the line budget, a cut fence closed", () => {
  const md = "## Result\n\nThe fix is in.\n\n- one\n- two\n- three\n\n```js\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```\n\nDone.";
  const all = mdPreview(md, 20, 70);
  expect(all.cut).toBe(false);
  expect(all.md).toBe(md);
  const four = mdPreview(md, 4, 70);
  expect(four.cut).toBe(true);
  expect(four.md).toBe("## Result\n\nThe fix is in.\n\n- one");
  expect(four.lines).toBeLessThanOrEqual(4);
  // Cut inside the code block: the fence is closed.
  const code = mdPreview(md, 7.5, 70);
  expect(code.md.endsWith("const a = 1;\n```")).toBe(true);
  // A long paragraph counts its wrapped lines and is not split mid-line.
  const long = `${"word ".repeat(60).trim()}\n\nsecond`;
  const three = mdPreview(long, 3, 70);
  expect(three.cut).toBe(true);
  expect(three.md.endsWith(" …")).toBe(true);
  expect(three.md.length).toBeLessThanOrEqual(3 * 70);
  expect(three.lines).toBe(3);
  expect(mdPreview(long, 5, 70).md).toBe("word ".repeat(60).trim());
  expect(mdPreview("", 6, 70).md).toBe("");
});

test("the reading width Threads opens at: 573 px at 14 px, scaled with Text size", () => {
  expect(fitWidth()).toBe(573);
  expect(fitWidth(12)).toBe(507);
  expect(fitWidth(18)).toBe(704);
});

test("mdChunks: Markdown over Herdr's limit splits at paragraphs, never inside fenced code", () => {
  expect(mdChunks("short")).toEqual(["short"]);
  const para = (i) => `Paragraph ${i}: ${"words in a sentence ".repeat(12).trim()}.`;
  const fence = `\`\`\`sh\n${"echo one\n\necho two\n".repeat(3)}\`\`\``;
  const md = [...Array.from({ length: 30 }, (_, i) => para(i)), fence, para(30)].join("\n\n");
  const parts = mdChunks(md, 1000);
  expect(parts.length).toBeGreaterThan(3);
  expect(parts.every((p) => Buffer.byteLength(p) <= 1000)).toBe(true);
  expect(parts.join("\n\n")).toBe(md);
  expect(parts.some((p) => p.includes(fence))).toBe(true);
  // One paragraph longer than the limit splits at words; multibyte text counts in bytes.
  const long = "naïve café — ".repeat(200).trim();
  const lp = mdChunks(long, 500);
  expect(lp.every((p) => Buffer.byteLength(p) <= 500)).toBe(true);
  expect(lp.join("")).toBe(long);
});

// mdChunks as it was before its pieces' lengths were kept as they grew: the same chunks, found
// by measuring each whole chunk again for every piece.
function mdChunksBefore(md, max = MD_MAX) {
  const len = (x) => { let n = 0; for (const ch of x) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; };
  const packed = (pieces, sep) => { const out = []; let acc = ""; for (const p of pieces) { const next = acc ? `${acc}${sep}${p}` : p; if (acc && len(next) > max) { out.push(acc); acc = p; } else acc = next; } if (acc) out.push(acc); return out; };
  const text = String(md ?? "");
  if (len(text) <= max) return [text];
  const blocks = [];
  let cur = [];
  let fence = null;
  for (const line of text.split("\n")) {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; }
    else if (!fence && !line.trim()) { if (cur.length) blocks.push(cur.join("\n")); cur = []; continue; }
    cur.push(line);
  }
  if (cur.length) blocks.push(cur.join("\n"));
  const pieces = blocks.flatMap((b) => (len(b) <= max ? [b] : packed(b.split("\n").flatMap((l) => (len(l) <= max ? [l] : packed(l.match(/\S+\s*/g) ?? [l], ""))), "\n")));
  return packed(pieces, "\n\n");
}

test("mdChunks: a reply with long tables splits as before, counted in UTF-8 bytes, surrogates included", () => {
  const table = (k) => `### Table ${k}\n\n| Area | File | Before | After |\n|---|---|---|---|\n${Array.from({ length: 40 }, (_, i) => `| checkout ${i} | src/cart/part${i}.ts | ${i * 13} ms | ${i * 7} ms |`).join("\n")}`;
  const reply = Array.from({ length: 6 }, (_, k) => `${table(k)}\n\nThe subtotal is rounded once. `.repeat(2)).join("\n\n");
  const odd = ["", "a", "\n\n\n", "é".repeat(5000), "😀".repeat(3000), "\uD800x".repeat(2000), "x\uDC00".repeat(2000), "日本 ".repeat(3000),
    `\`\`\`\n${"code line\n".repeat(800)}\`\`\`\n\nafter`, `| a | b |\n|---|---|\n${"| 日本 | 😀 |\n".repeat(600)}`];
  // A long table or fenced block now splits apart (the next test); everything else as before.
  const whole = (md, max) => !mdChunksBefore(md, max).some((c) => /^\|/.test(c) || /^```/.test(c) !== /```$/.test(c));
  for (const md of [reply, ...odd]) {
    for (const max of [MD_MAX, 500, 7]) if (whole(md, max)) expect(mdChunks(md, max)).toEqual(mdChunksBefore(md, max));
  }
  const parts = mdChunks(reply);
  expect(parts.length).toBeGreaterThan(3);
  expect(parts.every((p) => Buffer.byteLength(p) <= MD_MAX)).toBe(true);
  expect(mdChunks("😀 ".repeat(3000), 400).every((p) => Buffer.byteLength(p) <= 400)).toBe(true);
});

test("mdChunks: each piece of a long table starts with its header rows, each piece of long code is fenced", () => {
  const rows = Array.from({ length: 80 }, (_, i) => `| checkout ${i} | src/cart/part${i}.ts | ${i * 13} ms | rounding moved to the subtotal step for case ${i} |`);
  const head = "| Area | File | Time | Note |\n|---|:---:|---|---|";
  const code = Array.from({ length: 300 }, (_, i) => `const total${i} = sum(items, ${i});`);
  const md = `### Table\nThe numbers:\n${head}\n${rows.join("\n")}\nAfter the table.\n\n\`\`\`ts\n${code.join("\n")}\n\`\`\`\n\nThe end.`;
  const parts = mdChunks(md, 3500);
  expect(parts.every((p) => Buffer.byteLength(p) <= 3500)).toBe(true);
  const tables = parts.filter((p) => p.includes("| checkout"));
  expect(tables.length).toBeGreaterThan(1);
  for (const t of tables) expect(t.slice(t.indexOf("| Area"))).toStartWith(`${head}\n| checkout`);
  // Every row once, in order.
  expect(tables.flatMap((t) => t.split("\n").filter((l) => l.startsWith("| checkout")))).toEqual(rows);
  expect(parts[0]).toStartWith("### Table\nThe numbers:");
  expect(parts.join("\n\n")).toContain("After the table.");
  const fenced = parts.filter((p) => p.includes("const total"));
  expect(fenced.length).toBeGreaterThan(1);
  for (const f of fenced) { const at = f.indexOf("```ts\n"); expect(at).toBeGreaterThanOrEqual(0); expect(f.slice(at)).toMatch(/\n```(\n\nThe end\.)?$/); }
  expect(fenced.flatMap((f) => f.split("\n").filter((l) => l.startsWith("const total")))).toEqual(code);
  // Room too small for the header twice: split as other text.
  expect(mdChunks(`${head}\n${rows.slice(0, 4).join("\n")}`, 60).some((p) => p.startsWith("| checkout"))).toBe(true);
});

test("escapeDollars: prices outside code are escaped, code and escaped ones are not", () => {
  expect(escapeDollars("The $41.250 total includes **4,180 look-ups at $0.009 each**."))
    .toBe("The \\$41.250 total includes **4,180 look-ups at \\$0.009 each**.");
  expect(escapeDollars("Run `echo $HOME` and pay \\$5")).toBe("Run `echo $HOME` and pay \\$5");
  expect(escapeDollars("```sh\nexport A=$B\n```\n$1")).toBe("```sh\nexport A=$B\n```\n\\$1");
  expect(escapeDollars("no prices")).toBe("no prices");
});

test("cutMd: a paragraph end when one is near, no empty list item, a bold closed, a table row whole", () => {
  const md = `${"Intro words here. ".repeat(60)}\n\nThese are the open choices:\n\n1. **Delivery credit:** add $25 to the route account before Friday.\n\n2. **Bulbs:** a dozen are listed twice.`;
  expect(cutMd(md, md.indexOf("1. **Delivery") + 6)).toMatch(/These are the open choices: …$/);
  expect(cutMd("Choices:\n\n- one\n- ", 40)).toBe("Choices:\n\n- one …");
  expect(cutMd("Recommendation: **$25 credit to finish the delivery routes, then cache", 60))
    .toBe("Recommendation: **$25 credit to finish the delivery routes,** …");
  expect(cutMd("Start\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\nafter", 40)).toBe("Start\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n…");
});

test("galleryBox: an image fits the room with its shape, never past its own pixels", () => {
  expect(galleryBox({ w: 2000, h: 1247 }, 1400, 900)).toEqual({ w: 1400, h: 873 });
  expect(galleryBox({ w: 1200, h: 2400 }, 1400, 900)).toEqual({ w: 450, h: 900 });
  expect(galleryBox({ w: 300, h: 200 }, 1400, 900)).toEqual({ w: 300, h: 200 });
  expect(galleryBox({ w: 0, h: 0 }, 1400, 900)).toEqual({ w: 1400, h: 900 });
  expect(galleryBox(null, 10, 10)).toEqual({ w: 40, h: 40 });
});

test("? opens the key sheet, as ? or Shift-/, but not while the search field types", () => {
  expect(keyAction(key("?", { shift: true }))).toBe("keys");
  expect(keyAction(key("/", { shift: true }))).toBe("keys");
  expect(keyAction(key("?"))).toBe("keys");
  expect(keyAction(key("?", { shift: true }), true)).toBe(null);
  expect(keyAction(key("/"))).toBe("filter");
});

test("the key sheet lists every key the panel takes, and a pin key gives way to a quote key of the same letter", () => {
  const shown = (q) => new Set(keySheet(q).flatMap(([, items]) => items.flatMap(([keys]) => keys)));
  const names = { up: "↑", down: "↓", enter: "↵", space: "Space", escape: "Esc", home: "Home", end: "End" };
  const all = shown("q");
  for (const k of ["up", "k", "down", "j", "home", "g", "end", "enter", "space", "o", "c", "/", "escape", "[", "]", "a", "t", ",", "s", "i", "v", "-", "=", "w", "?", "p", "u", "q", "G"]) {
    expect(all.has(names[k] ?? k)).toBe(true);
  }
  expect(all.has("1-5")).toBe(true);
  expect(keySheet("q").map(([g]) => g)).toEqual(["List", "Open turn", "Pins", "Image viewer", "View"]);
  expect(shown("p").has("p")).toBe(true); // as the quote key
  expect(keySheet("p").find(([g]) => g === "Pins")[1].some(([k]) => k[0] === "p")).toBe(false);
  expect(keySheet("u").find(([g]) => g === "Pins")[1].some(([k]) => k[0] === "u")).toBe(false);
});

test("the footer's hints keep to one row: what does not fit gives way from the right, ? keys last", () => {
  const hints = [["↑↓", "move"], ["↵", "open"], ["c", "copy"], ["q", "quote"], ["/", "filter"], ["p", "pin"], ["?", "keys"]];
  const total = (h) => h.reduce((s, x) => s + hintWidth(x), 0) + 10 * (h.length - 1) + 26;
  expect(fitHints(hints, 2000)).toEqual(hints);
  for (const w of [200, 240, 300, 380, 440, 545]) {
    const out = fitHints(hints, w);
    expect(out.at(-1)).toEqual(["?", "keys"]);
    expect(out.length === 1 || total(out) <= w).toBe(true);
    expect(out).toEqual(hints.filter((h) => out.includes(h))); // order kept, a prefix plus ? keys
    expect(out.slice(0, -1)).toEqual(hints.slice(0, out.length - 1));
  }
  expect(fitHints(hints, 20)).toEqual([["?", "keys"]]);
});

test("the agent's state: Claude Code's reported status, else only what the transcript shows", () => {
  const done = { done: true }, running = { done: false };
  expect(agentState({ ended: "exited", status: "working", reports: true, newest: running })).toEqual({ word: "Exited", tone: "dim" });
  expect(agentState({ status: "blocked", reports: true, newest: running })).toEqual({ word: "Needs you", tone: "blocked" });
  expect(agentState({ status: "working", reports: true, newest: done })).toEqual({ word: "Working", tone: "working" });
  expect(agentState({ status: "idle", reports: true, newest: done })).toEqual({ word: "Done", tone: "done" });
  expect(agentState({ status: "idle", reports: true, newest: running })).toBe(null);
  // No reported status: never Working or Needs you, and nothing for a running turn.
  expect(agentState({ status: "working", reports: false, newest: running })).toBe(null);
  expect(agentState({ status: "blocked", reports: false, newest: done })).toEqual({ word: "Done", tone: "done" });
  expect(agentState({ reports: false, newest: null })).toBe(null);
  expect(agentState()).toBe(null);
});

test("o is the outline key, Enter and Space still open, and o stays a letter the quote key cannot take", async () => {
  const { outlineText, outlineHeight, outlineNumW, TAKEN_LETTERS } = await import("../mods/agent-threads/ui.js");
  expect(keyAction(key("o"))).toBe("outline");
  expect(keyAction(key("enter"))).toBe("open");
  expect(keyAction(key("space"))).toBe("open");
  expect(keyAction(key("o"), true)).toBe(null); // the search field types it
  expect(keyAction(key("o"), false, "o")).toBe("outline");
  expect(TAKEN_LETTERS).toContain("o");
  const list = keySheet("q").find(([g]) => g === "List")[1];
  expect(list.find(([k]) => k.includes("o"))[1]).toBe("Outline: one row per turn");
  expect(list.find(([k]) => k.includes("↵"))[0]).toEqual(["↵", "Space"]);
  // The Pinned column has no outline, so its sheet leaves o out.
  const column = keySheet("q", { outline: false }).find(([g]) => g === "List")[1];
  expect(column.some(([k]) => k.includes("o"))).toBe(false);
  expect(column.find(([k]) => k.includes("Esc"))[1]).not.toMatch(/outline/);
  // The row's text: the prompt's first line of the person's own words.
  expect(outlineText("Fix the login flake\nand the retry")).toBe("Fix the login flake");
  expect(outlineText("\n\n  Spaced out  \nmore")).toBe("Spaced out");
  expect(outlineText("> a quoted reply line\n> another\n\nWhat about the backoff?")).toBe("What about the backoff?");
  expect(outlineText("> only a quote")).toBe("only a quote");
  expect(outlineText("```ts\nconst x = 1\n```\nwhy is this slow")).toBe("why is this slow");
  expect(outlineText("```\nonly code\n```")).toBe("only code");
  expect(outlineText("> a\n```\ncode\n```")).toBe("a");
  expect(outlineText("")).toBe("");
  expect(outlineText(null)).toBe("");
  expect(outlineText("x".repeat(500)).length).toBe(240);
  // With a search, the text around the first match, on one line.
  expect(outlineText("one two three four five six seven eight nine ten eleven twelve\nthe retry path", "retry")).toMatch(/^….*retry path$/);
  expect(outlineText("retry first", "retry")).toBe("retry first");
  expect(outlineHeight(14)).toBe(30);
  expect(outlineHeight(18)).toBe(36);
  expect(outlineHeight(12)).toBe(30);
  expect(outlineNumW(9)).toBeLessThan(outlineNumW(10));
  expect(outlineNumW(999)).toBe(Math.ceil(4 * 7.2) + 6);
});

test("viewerLayout: from 1100 px the reading panel sits beside the image, 500 px wide; narrower, it docks under it", () => {
  const wide = viewerLayout(1600, 1000, true);
  expect(wide).toMatchObject({ wide: true, panelW: 500, panelH: 0, strip: 64, thumb: 40, padX: 24 });
  // The image's room: the stage less the round buttons, and above the strip.
  expect(wide.room).toEqual({ w: 1600 - 501 - 128, h: 1000 - 53 - 64 - 16 });
  // Hidden, the image has the whole width back.
  expect(viewerLayout(1600, 1000, false)).toMatchObject({ panelW: 0, room: { w: 1600 - 128, h: 1000 - 53 - 64 - 16 } });
  const narrow = viewerLayout(900, 800, true);
  expect(narrow).toMatchObject({ wide: false, panelW: 0, panelH: 300, strip: 52, thumb: 32 });
  expect(narrow.room).toEqual({ w: 900 - 128, h: 800 - 53 - 301 - 52 - 16 });
  // The narrow panel's text is at most 560 px wide, centred.
  expect(narrow.padX).toBe((900 - 560) / 2);
  expect(viewerLayout(500, 900, true).padX).toBe(24);
  // A short window keeps room for the image: the panel takes at most 45% of it.
  expect(viewerLayout(900, 500, true).panelH).toBe(225);
  expect(viewerLayout(VIEWER.WIDE - 1, 900).wide).toBe(false);
  expect(viewerLayout(VIEWER.WIDE, 900).wide).toBe(true);
});

test("viewerKey: arrows and h, l step; j, k and Space scroll the reply with the panel shown and step without it", () => {
  for (const k of ["left", "up", "h", "pageup"]) expect(viewerKey(key(k), true)).toBe("prev");
  for (const k of ["right", "down", "l", "pagedown"]) expect(viewerKey(key(k), true)).toBe("next");
  expect(viewerKey(key("j"), true)).toBe("down");
  expect(viewerKey(key("space"), true)).toBe("down");
  expect(viewerKey(key("k"), true)).toBe("up");
  expect(viewerKey(key("j"), false)).toBe("next");
  expect(viewerKey(key("space"), false)).toBe("next");
  expect(viewerKey(key("k"), false)).toBe("prev");
  expect(viewerKey(key("i"))).toBe("panel");
  expect(viewerKey(key("c"))).toBe("copy");
  expect(viewerKey(key("home"))).toBe("first");
  expect(viewerKey(key("end"))).toBe("last");
  for (const k of ["escape", "q", "enter"]) expect(viewerKey(key(k))).toBe("close");
  expect(viewerKey(key("1"))).toBe("go:0");
  expect(viewerKey(key("9"))).toBe("go:8");
  expect(viewerKey(key("0"))).toBe(null);
  // Chords belong to Herdr and the system: Cmd-C copies nothing here.
  expect(viewerKey(key("c", { platform: true }))).toBe(null);
  expect(viewerKey(key("x"))).toBe(null);
});

test("labelPieces: a prompt line as text and pasted-image labels, a label in code staying text", () => {
  expect(labelPieces("[Image #1] [Image #2] Compare the two")).toEqual([
    { t: "[Image #1]", n: 1 }, { t: " " }, { t: "[Image #2]", n: 2 }, { t: " Compare the two" },
  ]);
  expect(labelPieces("see `[Image #3]` and [Image #4].")).toEqual([{ t: "see `[Image #3]` and " }, { t: "[Image #4]", n: 4 }, { t: "." }]);
  expect(labelPieces("no labels here")).toEqual([{ t: "no labels here" }]);
  expect(labelPieces("")).toEqual([]);
});

test("replyBlocks: a reply split at paragraphs for j and k, code kept whole, a list item's next paragraph kept with it", () => {
  const md = "First paragraph.\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\n- one\n- two\n\n  more about two\n\n## Heading\n\nLast.";
  expect(replyBlocks(md)).toEqual([
    "First paragraph.", "```js\nconst a = 1;\n\nconst b = 2;\n```", "- one\n- two\n\n  more about two", "## Heading", "Last.",
  ]);
  expect(replyBlocks("")).toEqual([]);
  // A paragraph longer than Herdr draws is split again.
  const long = Array.from({ length: 900 }, (_, i) => `word${i}`).join(" ");
  const parts = replyBlocks(`${long}\n\nend`);
  expect(parts.length).toBeGreaterThan(2);
  expect(parts.every((p) => p.length <= MD_MAX)).toBe(true);
  expect(parts.at(-1)).toBe("end");
});

test("replyScroll: j and k places from the measured parts, the view's height and where it is", () => {
  // Parts of 100, 30, 300, 300, 300 and 20 px (they start at 4, 104, 134, 434, 734, 1034)
  // in a 400 px view, so the view goes down to 674.
  const sizes = [100, 30, 300, 300, 300, 20];
  expect(replyScroll(sizes, 400, 0, 1)).toEqual({ y: 104, steps: [3, 1] });
  expect(replyScroll(sizes, 400, 104, 1)).toEqual({ y: 134, steps: [3, 2] });
  expect(replyScroll(sizes, 400, 434, 1)).toEqual({ y: 674, steps: [5] });
  // At the end, down goes nowhere; up from the end comes to the last part that can be at the top.
  expect(replyScroll(sizes, 400, 674, 1)).toBe(null);
  expect(replyScroll(sizes, 400, 674, -1)).toEqual({ y: 434, steps: [3] });
  // From the middle of a part (a wheel scroll): up goes to its start, down to the next.
  expect(replyScroll(sizes, 400, 300, -1)).toEqual({ y: 134, steps: [2] });
  expect(replyScroll(sizes, 400, 300, 1)).toEqual({ y: 434, steps: [4, 3] });
  expect(replyScroll(sizes, 400, 104, -1)).toEqual({ y: 0, steps: [0] });
  expect(replyScroll(sizes, 400, 0, -1)).toBe(null);
  // A part whose bottom lands the view exactly at the place needs one step.
  expect(replyScroll([100, 400, 100], 400, 0, 1)).toEqual({ y: 104, steps: [1] });
  // Everything fits, or nothing is measured: nothing to do.
  expect(replyScroll([100, 100], 400, 0, 1)).toBe(null);
  expect(replyScroll([], 400, 0, 1)).toBe(null);
  expect(replyScroll(sizes, 0, 0, 1)).toBe(null);
});

test("fencedBlock: a reply block that is one fenced code block, with its language", () => {
  expect(fencedBlock("```css\n.a { b: c; }\n.d {}\n```")).toEqual({ lang: "css", text: ".a { b: c; }\n.d {}" });
  expect(fencedBlock("~~~\nplain\n~~~")).toEqual({ lang: "", text: "plain" });
  expect(fencedBlock("````js title=x\na\n\nb\n````")).toEqual({ lang: "js", text: "a\n\nb" });
  // Not a code block alone: text before it, a fence left open, or a closing fence of the other kind.
  expect(fencedBlock("Here:\n```\na\n```")).toBe(null);
  expect(fencedBlock("```\na")).toBe(null);
  expect(fencedBlock("```\na\n~~~")).toBe(null);
  expect(fencedBlock("The chips had a fixed width.")).toBe(null);
});

test("railWindow: 9 px a tick at every length, a window of 60% of the list and at most 540 px that follows the turns on screen", () => {
  const none = () => false;
  // A short session: every tick, no cut.
  expect(railWindow(20, none, 900)).toEqual({ top: 0, count: 20, cut: false });
  expect(railWindow(60, none, 900)).toEqual({ top: 0, count: 60, cut: false });
  // Past 60 ticks at 900 px: a window of 58 (540 px less a 9 px row at each end for a dot).
  // While the list follows the newest turn it rests at the end.
  expect(railWindow(344, none, 900, 0, null, true)).toEqual({ top: 286, count: 58, cut: true });
  // It keeps the turns on screen three ticks from its ends, moving only as far as needed.
  expect(railWindow(344, none, 900, 0, [130, 134])).toEqual({ top: 80, count: 58, cut: true });
  expect(railWindow(344, none, 900, 100, [130, 134]).top).toBe(100);
  expect(railWindow(344, none, 900, 128, [130, 134]).top).toBe(127);
  // 60% of a 400 px list is 240 px: 24 ticks.
  expect(railWindow(344, none, 400, 0, [10, 12]).count).toBe(24);
  // Day gaps take 7 px and hold at every length.
  const days = (i) => i % 10 === 0;
  const w = railWindow(344, days, 900, 0, null, true);
  expect(w.top + w.count).toBe(344);
  expect(w.count).toBeLessThan(58);
  // The same number of ticks for 3,000 turns as for 344.
  expect(railWindow(3000, none, 900, 0, null, true).count).toBe(58);
  expect(RAIL.FADE).toEqual([0.25, 0.5, 0.75]);
});

test("toolKind: each agent's tool names fall into commands, reads, edits, searches, web, agent tasks and other", () => {
  // Claude Code, Codex, OpenCode, Pi, Cursor and Antigravity names.
  for (const n of ["Bash", "shell", "exec_command", "local_shell", "bash", "Shell", "run_command"]) expect(toolKind(n)).toBe("command");
  for (const n of ["Read", "read", "read_file", "view_file", "view_image"]) expect(toolKind(n)).toBe("read");
  for (const n of ["Edit", "Write", "MultiEdit", "apply_patch", "edit", "write", "replace_file_content", "write_to_file", "NotebookEdit"]) expect(toolKind(n)).toBe("edit");
  for (const n of ["Grep", "Glob", "grep", "glob", "list", "LS", "codebase_search", "find_by_name", "grep_search"]) expect(toolKind(n)).toBe("search");
  for (const n of ["WebSearch", "WebFetch", "web_search", "webfetch", "read_url_content"]) expect(toolKind(n)).toBe("web");
  for (const n of ["Task", "Agent", "task", "spawn_agent", "subagent"]) expect(toolKind(n)).toBe("agent");
  // Claude Code's task list tools are not subagents.
  for (const n of ["TodoWrite", "update_plan", "ExitPlanMode", "mcp__linear__get_issue", "Skill", "tool", "", "TaskCreate", "TaskUpdate", "TaskList", "TaskOutput", "TaskStop", "AgentTool"]) expect(toolKind(n)).toBe("other");
});

test("groupText: a group's calls by kind as one sentence, past tense when done and present while running", () => {
  expect(groupText(["Bash", "Bash"])).toBe("Ran 2 commands");
  expect(groupText(["Read"])).toBe("Read 1 file");
  expect(groupText(["WebSearch", "WebSearch", "Bash", "Bash", "Bash", "Bash", "Bash"])).toBe("Searched the web 2 times and ran 5 commands");
  expect(groupText(["Read", "Grep", "Edit"])).toBe("Read 1 file, searched 1 time and edited 1 file");
  expect(groupText(["Bash", "Bash", "Bash", "Bash"], 4, true)).toBe("Running 4 commands");
  expect(groupText(["Read", "Bash"], 2, true)).toBe("Reading 1 file and running 1 command");
  expect(groupText(["Task"])).toBe("Ran 1 subagent");
  expect(groupText(["Agent", "Agent", "Agent", "Agent"])).toBe("Ran 4 subagents");
  expect(groupText(["Agent", "Agent", "Agent", "Agent"], 4, true)).toBe("Running 4 subagents");
  expect(groupText(["mcp__x__y", "TodoWrite"])).toBe("Used 2 other tools");
  // Calls past the names a group keeps.
  expect(groupText(["Bash"], 5)).toBe("Ran 1 command and 4 more");
  expect(groupText([], 0)).toBe("Used no tools");
  expect(groupKinds(["Bash", "Read", "Bash"])).toEqual([["command", 2], ["read", 1]]);
  for (const k of ["command", "read", "edit", "search", "web", "agent", "other"]) expect(typeof KIND_ICON[k]).toBe("string");
});

test("level 3 helpers: a call's time, its output's lines and box height, and its row text", () => {
  expect(callTime("2026-11-01T09:00:00.000Z", "2026-11-01T09:00:00.400Z")).toBe("0.4s");
  expect(callTime("2026-11-01T09:00:00.000Z", "2026-11-01T09:00:12.000Z")).toBe("12s");
  expect(callTime("2026-11-01T09:00:00.000Z", "2026-11-01T09:02:05.000Z")).toBe("2m 05s");
  expect(callTime("2026-11-01T09:00:00.000Z", null)).toBe("");
  expect(callTime("2026-11-01T09:00:05.000Z", "2026-11-01T09:00:00.000Z")).toBe("");
  // Every line up to OUT.MAX (the box scrolls), tabs as spaces, each line kept to OUT.CHARS
  // (it scrolls sideways), trailing blank lines dropped.
  const out = Array.from({ length: 30 }, (_, i) => (i === 0 ? `a\tb${"x".repeat(OUT.CHARS + 500)}` : `line ${i + 1}`)).join("\n");
  const box = outLines(`${out}\n\n`);
  expect(box.lines.length).toBe(30);
  expect(box.lines[0].startsWith("a    b")).toBe(true);
  expect(box.lines[0].length).toBe(OUT.CHARS);
  expect(box).toMatchObject({ total: 30, cut: false });
  // calls.sh clips long output and gives the whole count: the box says it holds the first lines.
  expect(outLines("one\ntwo", true, 900)).toMatchObject({ total: 900, cut: true });
  expect(outLines("")).toEqual({ lines: [], total: 0, cut: false });
  expect(outLines("a\r\nb").lines).toEqual(["a", "b"]);
  const big = Array.from({ length: 1000 }, () => "y").join("\n");
  expect(outLines(big).lines.length).toBe(OUT.MAX);
  expect(outLines(big).cut).toBe(true);
  // Heights: padding, border, margins, one line at least, at most OUT.SHOW lines in view, and
  // the dim line when the output is longer than the box holds.
  expect(outHeight(outLines(""))).toBe(8 * 2 + 2 + 16 + 4);
  expect(outHeight(box)).toBe(8 * 2 + 2 + 12 * 16 + 4);
  expect(outHeight(outLines(big))).toBe(8 * 2 + 2 + 12 * 16 + 4 + 22);
  expect(outHeight(outLines("a\nb"))).toBe(8 * 2 + 2 + 2 * 16 + 4);
  // The language an output is coloured as.
  expect(outLang('{"a": [1, 2]}')).toBe("json");
  expect(outLang("{not json")).toBe(null);
  expect(outLang("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-a\n+b")).toBe("diff");
  expect(outLang("const a = 1;", "src/cart.ts", "read")).toBe("js");
  expect(outLang("     1→const a = 1;", "src/cart.ts", "read")).toBe(null);
  expect(outLang("const a = 1;", "src/cart.ts", "bash")).toBe(null);
  expect(outLang("12 passed")).toBe(null);
  expect(outLang("")).toBe(null);
  expect(callText("Bash", "bun test\n  --watch")).toBe("bun test --watch");
  expect(callText("Bash", "")).toBe("Bash");
  expect(callText("Bash", null)).toBe("Bash");
});

test("callTime prefers the agent's own duration when it records one", () => {
  expect(callTime("2026-11-01T09:00:00.000Z", "2026-11-01T09:00:00.000Z", 2350)).toBe("2s");
  expect(callTime(null, null, 40)).toBe("<0.1s");
  expect(callTime(null, null, null)).toBe("");
});

test("round 6: side gutters of 8% of the pane between 24 and 56 px, the column between them, and the rail's ticks", async () => {
  const { gutter, columnWidth, railLook, GUTTER } = await import("../mods/agent-threads/ui.js");
  expect(GUTTER).toEqual({ PCT: 0.08, MIN: 24, MAX: 56 });
  expect([200, 300, 500, 700, 960].map(gutter)).toEqual([24, 24, 40, 56, 56]);
  // The column is the text and 16 px each side; the side gutter is what is left, split evenly.
  const side = (w, size, chars) => (w - columnWidth(w, size, chars)) / 2 + 16;
  // At the kept width the text is one reading line with 56 px each side.
  expect(columnWidth(573)).toBe(461 + 32);
  expect(side(573)).toBe(56);
  expect(side(704, 14, 90)).toBe(56);
  // Narrower, 8% of the pane; never under 24 px.
  expect(side(400)).toBe(32);
  expect(side(250)).toBe(24);
  // Full: the pane less its gutters.
  expect(columnWidth(960, 14, Infinity)).toBe(960 - 112 + 32);
  // The ticks: 10 px, 16 selected, 14 px in, in a lane up to 32 px; in a gutter under 40 px,
  // 8, 12 and 6.
  expect(railLook(56)).toEqual({ lane: 32, mark: 10, sel: 16, right: 14, peak: 24 });
  expect(railLook(32)).toEqual({ lane: 32, mark: 8, sel: 12, right: 6, peak: 16 });
  expect(railLook(24)).toEqual({ lane: 24, mark: 8, sel: 12, right: 6, peak: 16 });
});

test("width: the reading line and column for Comfortable, Wide and Full at 12, 14 and 18 px", async () => {
  const { readType, fitWidth, widthChars, WIDTH_NAMES } = await import("../mods/agent-threads/ui.js");
  expect(WIDTH_NAMES).toEqual(["comfortable", "wide", "full"]);
  expect(widthChars("nope")).toBe(70);
  const at = (w, size) => [readType(size, widthChars(w)).measure, fitWidth(size, widthChars(w))];
  expect([12, 14, 18].map((s) => at("comfortable", s))).toEqual([[395, 507], [461, 573], [592, 704]]);
  expect([12, 14, 18].map((s) => at("wide", s))).toEqual([[508, 620], [592, 704], [761, 873]]);
  expect(at("full", 14)).toEqual([Infinity, Infinity]);
  // A bubble's line stops at Wide's in Full.
  expect(readType(14, Infinity).bubble).toBe(592);
  expect(readType(14).bubble).toBe(461);
});

test("level 3 paths: relative to the working folder inside it, from ~ elsewhere, others as they are", () => {
  const cwd = "/home/dev/acme-web";
  const home = "/home/dev";
  const cases = [
    ["/home/dev/acme-web/src/admin/export.ts", "src/admin/export.ts"],
    ["cd /home/dev/acme-web && bun test", "cd . && bun test"],
    ["grep -n 'total' /home/dev/acme-web/src", "grep -n 'total' src"],
    ["path=/home/dev/acme-web/a.ts", "path=a.ts"],
    ["/home/dev/notes/todo.md", "~/notes/todo.md"],
    ["ls /home/dev", "ls ~"],
    // A sibling folder whose name starts with the working folder's is not inside it.
    ["/home/dev/acme-webapp/x.ts", "~/acme-webapp/x.ts"],
    ["/etc/hosts", "/etc/hosts"],
    ["no paths here", "no paths here"],
  ];
  for (const [from, to] of cases) expect(shortPaths(from, cwd, home)).toBe(to);
  // With no working folder known, only the home folder is shortened.
  expect(shortPaths("/home/dev/acme-web/src/a.ts", null, home)).toBe("~/acme-web/src/a.ts");
  // A folder given with a trailing slash, and a root or empty folder, which shortens nothing.
  expect(shortPaths("/home/dev/acme-web/a.ts", "/home/dev/acme-web/", home)).toBe("a.ts");
  expect(shortPaths("/etc/hosts", "/", "")).toBe("/etc/hosts");
});

test("splitTables and tableNeed: a table is its own part, and wants each column as wide as its longest cell, up to 40 characters", () => {
  const md = "Intro.\n\n| Region | Notes |\n|---|:--:|\n| us | short |\n| eu | a much longer note |\n\nAfter the table.";
  expect(splitTables(md)).toEqual([
    { text: "Intro.", table: false },
    { text: "| Region | Notes |\n|---|:--:|\n| us | short |\n| eu | a much longer note |", table: true },
    { text: "After the table.", table: false },
  ]);
  // Pipes in prose, or a pipe row with no rule under it, are not a table.
  expect(splitTables("a | b")).toEqual([{ text: "a | b", table: false }]);
  expect(splitTables("| a |\n| b |")).toEqual([{ text: "| a |\n| b |", table: false }]);
  expect(tableCells(md.split("\n\n")[1])).toEqual([["Region", "Notes"], ["us", "short"], ["eu", "a much longer note"]]);
  // "Region" 6 and "a much longer note" 18 characters, at 8 px, plus padding per column.
  expect(tableNeed(md.split("\n\n")[1], 8)).toBe(6 * 8 + TABLE_CELL_PAD + 18 * 8 + TABLE_CELL_PAD);
  // A long cell counts 40 characters; the rest wraps.
  expect(tableNeed(`| a |\n|---|\n| ${"x".repeat(90)} |`, 10)).toBe(TABLE_COL_CHARS * 10 + TABLE_CELL_PAD);
});

test("round 7: the rail card's day, the peak's widths, and a table flattened for the card", async () => {
  const { railDay, railSwell, flattenMd, RAIL } = await import("../mods/agent-threads/ui.js");
  const now = new Date(2026, 10, 16, 12).getTime();
  expect(railDay(now, now)).toBe("Today");
  expect(railDay(now - 86400000, now)).toBe("Yesterday");
  expect(railDay(new Date(2026, 10, 13, 11, 20).getTime(), now)).toBe("Fri 13 Nov");
  expect(railDay(new Date(2025, 11, 28, 14, 5).getTime(), now)).toBe("Sun 28 Dec 2025");
  expect(railDay(null, now)).toBe(null);
  expect([0, 9, 18, 27, 36, 50].map((d) => railSwell(10, RAIL.PEAK, d))).toEqual([24, 18, 13.5, 11, 10, 10]);
  expect(railSwell(8, RAIL.PEAK_SMALL, 0)).toBe(16);
  expect(RAIL.CARD_W).toBe(300);
  expect(flattenMd("Here:\n\n| Step | State | Takes |\n|---|:--:|---|\n| build | **ok** | 2s |\n\nDone.")).toBe("Here: Step · State · Takes · build · ok · 2s Done.");
  expect(flattenMd("```js\nx()\n```\nthen")).toBe("[code] then");
});
