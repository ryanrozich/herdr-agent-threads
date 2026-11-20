// bun test: drawing helpers (pure, no Herdr).
import { test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  statusGroups, statusWidth, ringStep,
  keyAction, alpha, spans, around, searchPreview, langFor, clipPrompt, wrappedLines, dayKey, jumpTarget,
  rowLines, flattenMd, middle, rowShape, rowHeight, rowTextWidth, bubbleMax, commandLayout, ROW, senderLabel, senderParts, senderIcon, kindWords,
  isShown, visible, countLabel, focusTarget, contrast, mix, labelColor, youHeight, dayParts, bandFill, BAND_LIGHT, over,
  readType, readWidth, replyWidth, MEASURE, PROSE_EM, RAIL, railWindow, toolKind, groupText, groupKinds, KIND_ICON, callTime, outLines, outHeight, outLang, callText, shortPaths, cutPath, OUT,
  pinColumn, PIN_SPLIT_MIN, PIN_COL, PIN_STEP, headerButtonWidth, columnResize, codeRows, splitTables, tableCells, tableNeed, TABLE_COL_CHARS, TABLE_CELL_PAD, landPlan, wrapCap, MONO_EM,
  mdPreview, fitWidth, mdChunks, escapeDollars, cutMd, galleryBox, VIEWER, viewerLayout, viewerKey, labelPieces, replyBlocks, replyScroll, fencedBlock, MD_MAX, cardKey, cardMarks, cardScroll, CARD_LINE, CARD_MARK,
  keySheet, fitHints, hintWidth, agentState, htmlLine, htmlChunks, promptParts, pinPromptText, outlineText,
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

test("Shift w steps the reading width; plain w still fits the pane, and a filter being typed takes the letter", () => {
  expect(keyAction(key("w", { shift: true }))).toBe("widthStep");
  expect(keyAction(key("W", { shift: true }))).toBe("widthStep");
  expect(keyAction(key("W"))).toBe("widthStep");
  expect(keyAction(key("w"))).toBe("fit");
  expect(keyAction(key("w", { shift: true }), true)).toBe(null);
  expect(keyAction(key("W"), true)).toBe(null);
  expect(keyAction(key("w", { shift: true, platform: true }))).toBe(null);
  // Listed under View, beside w.
  const view = keySheet().find(([g]) => g === "View")[1].map(([k, what]) => `${k.join(" ")}: ${what}`);
  expect(view.slice(0, 2)).toEqual(["w: Fit to the reading width", "Shift w: Step the reading width: Comfortable, Wide, Full"]);
});

// TRD-37: n steps to the older search match and Shift n to the newer one, as in less and vim.
// In the search field every letter types; a quote key of n keeps n, and the sheet then drops it.
test("n and Shift n step through search matches; the field types them; a quote key of n wins", () => {
  expect(keyAction(key("n"))).toBe("olderMatch");
  expect(keyAction(key("n", { shift: true }))).toBe("newerMatch");
  expect(keyAction(key("N", { shift: true }))).toBe("newerMatch");
  expect(keyAction(key("N"))).toBe("newerMatch");
  expect(keyAction(key("n"), true)).toBe(null);
  expect(keyAction(key("n", { shift: true }), true)).toBe(null);
  expect(keyAction(key("N"), true)).toBe(null);
  expect(keyAction(key("n", { platform: true }))).toBe(null);
  expect(keyAction(key("n"), false, "n")).toBe("quote");
  const row = (q) => keySheet(q).find(([g]) => g === "List")[1].find(([k]) => k.includes("Shift n"));
  expect(row("q")).toEqual([["n", "Shift n"], "Older or newer search match"]);
  expect(row("n")).toBeUndefined();
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
  // A match inside a long token keeps it: the start is cut in the token, not past the match.
  expect(around(`${"a ".repeat(40)}see https://example.com/docs/bobbin-guide now`, "bobbin")).toBe("…/example.com/docs/bobbin-guide now");
  // A reply under a search: its own text decides, all of it; the flattening's words never count.
  expect(searchPreview("Fix:\n\n```js\nlet x = 1;\n```\n\n- a\n- b", "code")).toBe(null);
  expect(searchPreview("- a\n- b", "·")).toBe(null);
  expect(searchPreview("Start **here** and go on", "here")).toBe("Start here and go on");
  expect(searchPreview(`${"word ".repeat(600)}\n\nThe needle is late.`, "needle")).toBe("… The needle is late.");
  expect(searchPreview("Read [it](https://example.com/bobbin) now", "bobbin")).toContain("https://example.com/bobbin");
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
    // It breaks after a slash, at most a segment short of the full line.
    expect(p.lines[0].endsWith("/")).toBe(true);
    expect(p.lines[0].length).toBeGreaterThan(Math.floor(per(w)) - "segment/".length);
    expect(p.lines[0].length).toBeLessThanOrEqual(Math.floor(per(w)));
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

// A token longer than the line (a path, a long hyphenated name) breaks right after its last
// "/" or "-" that fits, so no word is cut in two; with neither it still breaks at any
// character. Joined back, the lines are the text: nothing lost or added.
test("rowLines: a long token breaks after a slash or a hyphen, else by character, and loses nothing", () => {
  const path = "src/cart/rounding/order-total/receipt-sum/line-tax/per-item/helpers/median-of-three.js";
  const hy = "pre-merge-check-for-the-nightly-rounding-and-receipt-totals-run";
  const bare = "x".repeat(37) + "y".repeat(37);
  const join = (r) => r.lines.join("");
  for (const per of [12, 20, 31, 44, 60]) {
    const p = rowLines(path, 20, per);
    expect(p.cut).toBe(false);
    expect(join(p)).toBe(path);
    for (const l of p.lines) expect(l.length).toBeLessThanOrEqual(per);
    // Every line but the last ends at a slash or a hyphen.
    for (const l of p.lines.slice(0, -1)) expect(l).toMatch(/[/-]$/);
    const h = rowLines(hy, 20, per);
    expect(join(h)).toBe(hy);
    for (const l of h.lines.slice(0, -1)) expect(l).toMatch(/-$/);
    // Neither: full lines, broken at any character.
    const b = rowLines(bare, 20, per);
    expect(join(b)).toBe(bare);
    for (const l of b.lines.slice(0, -1)) expect(l.length).toBe(per);
  }
  // At 31 characters: the slash break, where a character break cut "median-of-three.js".
  expect(rowLines(path, 6, 31).lines).toEqual(["src/cart/rounding/order-total/", "receipt-sum/line-tax/per-item/", "helpers/median-of-three.js"]);
  expect(rowLines(hy, 6, 20).lines).toEqual(["pre-merge-check-for-", "the-nightly-", "rounding-and-", "receipt-totals-run"]);
  // A break that would leave the line less than half full is a character break instead.
  expect(rowLines(`ab/${"c".repeat(30)}`, 4, 16).lines).toEqual(["ab/ccccccccccccc", "cccccccccccccccc", "c"]);
  // "." and "_" are not breaks: an extension or a snake_case name stays whole only if it fits.
  expect(rowLines("aaaa_bbbb_cccc_dddd.eeee", 3, 10).lines).toEqual(["aaaa_bbbb_", "cccc_dddd.", "eeee"]);
  // Words around the token wrap as before, and the joined text is the original with each
  // wrap's space put back.
  const text = `Check ${path} before the run`;
  const t = rowLines(text, 8, 31);
  expect(t.lines).toEqual(["Check", "src/cart/rounding/order-total/", "receipt-sum/line-tax/per-item/", "helpers/median-of-three.js", "before the run"]);
  expect(t.lines.reduce((s, l, i) => s + (i && !t.lines[i - 1].match(/[/-]$/) ? " " : "") + l, "")).toBe(text);
  // Cut to two lines, the second still ends at a break, with the ellipsis after it.
  expect(rowLines(path, 2, 31).lines).toEqual(["src/cart/rounding/order-total/", "receipt-sum/line-tax/per-item/…"]);
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

// ---- pasted output and line breaks in closed rows (TRD-10, issue 93) ----

// The issue's own example: a sentence, a blank line, then a wrapper holding a 7-line table.
const PASTE_TABLE = [
  "Jobs over the last hour:",
  "┌──────────┬────────┬───────┐",
  "│ job      │ runs   │ p95   │",
  "├──────────┼────────┼───────┤",
  "│ build    │ 12     │ 4m 10s│",
  "│ e2e      │ 9      │ 2m 05s│",
  "└──────────┴────────┴───────┘",
].join("\n");
const ISSUE_PROMPT = `How did the build get so slow? Output below.\n\n<pasted_content id="example">\n${PASTE_TABLE}\n</pasted_content>`;

test("promptParts: a pasted block is a verbatim paste run, its wrapper lines gone", () => {
  const runs = (t) => promptParts(t).map((r) => [r.paste ? "p" : r.quote ? "q" : "c", r.lines]);
  expect(runs('a\n<pasted_content id="x">\n> npm test\nb  c\n</pasted_content>\nd')).toEqual([
    ["c", ["a"]],
    ["p", ["> npm test", "b  c"]],
    ["c", ["d"]],
  ]);
  // An unclosed paste runs to the end of the text (a prompt the reader clipped).
  expect(runs("note\n<pasted_content>\nbody")).toEqual([["c", ["note"]], ["p", ["body"]]]);
  // A stray closing line is dropped, not shown as text.
  expect(runs("before\n</pasted_content>\nafter")).toEqual([["c", ["before", "after"]]]);
  // A wrapper inside a fenced code block stays literal text (the fence wins).
  expect(runs("```\n<pasted_content>\n```")).toEqual([["c", ["```", "<pasted_content>", "```"]]]);
  // An empty paste leaves nothing to draw.
  expect(runs('<pasted_content id="e">\n</pasted_content>')).toEqual([]);
  // Any or no attributes, up to three leading spaces.
  expect(runs("   <pasted_content>\nline\n   </pasted_content>")).toEqual([["p", ["line"]]]);
});

test("promptParts: inside a paste, the closing tag closes it wherever it is on its line", () => {
  const runs = (t) => promptParts(t).map((r) => [r.paste ? "p" : r.quote ? "q" : "c", r.lines]);
  const open = 'Look:\n<pasted_content id="x">\n$ make\nok 12 files';
  const want = [["c", ["Look:"]], ["p", ["$ make", "ok 12 files"]], ["c", ["Why?"]]];
  // A paste that did not end in a line break: the tag ends its last line.
  expect(runs(`${open}</pasted_content>\nWhy?`)).toEqual(want);
  // Text typed after the tag on the same line is the person's own line after the paste.
  expect(runs(`${open}\n</pasted_content> Why?`)).toEqual(want);
  expect(runs(`${open}</pasted_content>Why?`)).toEqual(want);
  // Spaces after the tag, or more than three before it.
  expect(runs(`${open}\n</pasted_content>  \nWhy?`)).toEqual(want);
  expect(runs(`${open}\n      </pasted_content>\nWhy?`)).toEqual(want);
  // What follows the tag on its line is read as a line: a quote is a quote.
  expect(runs(`${open}</pasted_content>> said\nWhy?`)).toEqual([["c", ["Look:"]], ["p", ["$ make", "ok 12 files"]], ["q", ["said"]], ["c", ["Why?"]]]);
  // The paste's last line keeps its own spaces before the tag; a body of one line works.
  expect(runs('<pasted_content>\n  a  b  </pasted_content>')).toEqual([["p", ["  a  b"]]]);
  // A second closing tag after the paste, in the person's text, is text.
  expect(runs(`${open}</pasted_content> see </pasted_content>`)).toEqual([["c", ["Look:"]], ["p", ["$ make", "ok 12 files"]], ["c", ["see </pasted_content>"]]]);
});

test("promptParts: a closing tag alone on its line wins over one the pasted text mentions", () => {
  const runs = (t) => promptParts(t).map((r) => [r.paste ? "p" : r.quote ? "q" : "c", r.lines]);
  // The pasted text names the tag mid-line; the paste ends at the tag alone on its line.
  expect(runs("<pasted_content>\nthe tag</pasted_content> closes it\nmore pasted\n</pasted_content>\nWhy?")).toEqual([
    ["p", ["the tag</pasted_content> closes it", "more pasted"]],
    ["c", ["Why?"]],
  ]);
  // The same inside a fenced block within the paste.
  expect(runs("<pasted_content>\n```\nx = '</pasted_content>'\n```\n</pasted_content>\nWhy?")).toEqual([
    ["p", ["```", "x = '</pasted_content>'", "```"]],
    ["c", ["Why?"]],
  ]);
  // The search stops at the next opener: a first paste whose tag ends its last line does not
  // run on to a second paste's closing line.
  expect(runs("A:\n<pasted_content>\none</pasted_content>\nB:\n<pasted_content>\ntwo\n</pasted_content>\nWhy?")).toEqual([
    ["c", ["A:"]], ["p", ["one"]], ["c", ["B:"]], ["p", ["two"]], ["c", ["Why?"]],
  ]);
  // A paste with no closing tag before the next opener line: as on main, the next closing
  // line closes it, and the opener line in between is pasted text.
  expect(runs("<pasted_content>\none\n<pasted_content>\ntwo\n</pasted_content>\nWhy?")).toEqual([
    ["p", ["one", "<pasted_content>", "two"]],
    ["c", ["Why?"]],
  ]);
});

test("pasted prompts: an opener right after a closing tag opens a paste in the pin and the outline too", () => {
  const p = "A:\n<pasted_content>\none\n</pasted_content><pasted_content>\ntwo\n</pasted_content>\nWhy?";
  // After a tag, what follows on its line is read as a line: here a second paste's opener.
  expect(promptParts(p).map((r) => [r.paste ? "p" : "c", r.lines])).toEqual([["c", ["A:"]], ["p", ["one"]], ["p", ["two"]], ["c", ["Why?"]]]);
  expect(pinPromptText(p)).toBe("A: one two Why?");
  expect(outlineText(p)).toBe("A:");
  expect(outlineText("<pasted_content>\none\n</pasted_content><pasted_content>\ntwo\n</pasted_content>")).toBe("one");
  expect(pinPromptText("<pasted_content>\nthe tag</pasted_content> closes it\n</pasted_content>\nWhy?")).toBe("the tag</pasted_content> closes it Why?");
  // Two pastes on lines of their own, one straight after the other, are two runs (two labels).
  expect(promptParts("<pasted_content>\none\n</pasted_content>\n<pasted_content>\ntwo\n</pasted_content>").map((r) => r.lines)).toEqual([["one"], ["two"]]);
});

test("pasted prompts: the text after a closing tag is carried, never spliced into the line list", () => {
  // Splicing each tail back into the list of lines made a prompt of many closing tags read in
  // quadratic time (755 ms for 80,000 in the review, against 4 ms before the change). This
  // checks for the splice, not a time: in Catalyst's runner image at 1 CPU, the one-pass
  // code's time for eight times the pastes ran 6 to 62 times as long inside bun test, which
  // overlaps the spliced code's 58 to 71, so no time bound can tell them apart there.
  const p = Array.from({ length: 50 }, () => "<pasted_content>\nx</pasted_content> > y").join("\n");
  const splice = Array.prototype.splice;
  let calls = 0;
  Array.prototype.splice = function (...a) { calls++; return splice.apply(this, a); };
  try {
    outlineText(p);
    pinPromptText(p);
    promptParts(p); // the bubble and the open bubble (promptMd) read it
  } finally { Array.prototype.splice = splice; }
  expect(calls).toBe(0);
});

test("rowShape: a closed row keeps source line breaks for every prompt", () => {
  const multi = "First point.\nSecond point.\n\nThird after a blank.";
  for (const w of [240, 380, 545]) {
    const sh = rowShape({ prompt: multi, reply: "Done.", width: w, promptLines: 1000, replyLines: 3 });
    expect(sh.kinds, `at ${w}`).toBe(null);
    expect(sh.prompt, `at ${w}`).toEqual(["First point.", "Second point.", "", "Third after a blank."]);
    expect(sh.p, `at ${w}`).toBe(4);
    expect(sh.pMore, `at ${w}`).toBe(false);
    expect(sh.height, `at ${w}`).toBe(rowHeight(sh.p, sh.r, 0));
    // Leading and trailing blank lines drop; a run of blanks is one row.
    const edge = rowShape({ prompt: `\n\n${multi}\n\n\n`, reply: "x", width: w, promptLines: 1000, replyLines: 1 });
    expect(edge.prompt, `at ${w}`).toEqual(sh.prompt);
  }
  // A long line still word-wraps with the greedy logic, each wrapped row its own row.
  const long = "Why does the checkout job fail when the staging deploy runs after the nightly migration and the cache is cold, and what would make it pass?";
  const sh = rowShape({ prompt: `${long}\nshort`, reply: "x", width: 380, promptLines: 1000, replyLines: 1 });
  expect(sh.prompt.length).toBeGreaterThanOrEqual(4);
  expect(sh.prompt[sh.prompt.length - 1]).toBe("short");
  expect(sh.prompt.slice(0, -1).join(" ")).toBe(long);
  expect(sh.p).toBe(sh.prompt.length);
});

test("rowShape: a pasted block is one quiet label row plus one mono row per body line", () => {
  for (const w of [380, 545]) {
    const sh = rowShape({ prompt: ISSUE_PROMPT, reply: "Done.", width: w, promptLines: 1000, replyLines: 3 });
    const at = sh.kinds.indexOf("pl");
    expect(at, `at ${w}`).toBeGreaterThan(0);
    expect(sh.prompt[at], `at ${w}`).toBe("Pasted · 7 lines");
    expect(sh.kinds.slice(at + 1), `at ${w}`).toEqual(["p", "p", "p", "p", "p", "p", "p"]);
    // Each source line its own row, its inner spacing kept, no wrapper anywhere.
    expect(sh.prompt.slice(at + 1), `at ${w}`).toEqual(PASTE_TABLE.split("\n"));
    expect(sh.prompt.join("\n"), `at ${w}`).not.toContain("pasted_content");
    expect(sh.p, `at ${w}`).toBe(sh.prompt.length);
    expect(sh.bubbleW, `at ${w}`).toBeLessThanOrEqual(bubbleMax(w));
    expect(sh.height, `at ${w}`).toBe(rowHeight(sh.p, sh.r, 0));
  }
  // A row wider than the widest bubble clips with a trailing ellipsis, never wraps.
  const wide = `<pasted_content>\n${"x".repeat(200)} tail\n</pasted_content>`;
  const clip = rowShape({ prompt: wide, reply: "x", width: 380, promptLines: 1000, replyLines: 1 });
  expect(clip.kinds).toEqual(["pl", "p"]);
  expect(clip.prompt[1].endsWith("…")).toBe(true);
  expect(clip.prompt[1].length).toBeLessThanOrEqual(Math.floor(rowTextWidth(380) / (MONO_EM * 12.5)) + 1);
  expect(clip.prompt[1]).not.toContain("\n");
  // A paste that is the whole prompt: the label, then the rows, and no other text.
  const only = rowShape({ prompt: `<pasted_content id="only">\n${PASTE_TABLE}\n</pasted_content>`, reply: "x", width: 545, promptLines: 1000, replyLines: 1 });
  expect(only.kinds).toEqual(["pl", ...Array(7).fill("p")]);
  // An unclosed paste runs to the end: label plus body rows, no closing tag anywhere.
  const unclosed = rowShape({ prompt: "head\n<pasted_content id=\"c\">\nalpha\nbeta", reply: "x", width: 380, promptLines: 1000, replyLines: 1 });
  expect(unclosed.kinds).toEqual(["c", "pl", "p", "p"]);
  expect(unclosed.prompt.join("\n")).not.toContain("pasted_content");
});

test("rowShape: '>' lines inside a paste are body rows, not quotes", () => {
  const sh = rowShape({ prompt: '<pasted_content id="s">\n> npm test\n> jest --ci\n</pasted_content>\n\nWhich failed?', reply: "x", width: 380, promptLines: 1000, replyLines: 1 });
  expect(sh.kinds).toEqual(["pl", "p", "p", "c"]);
  expect(sh.prompt[1]).toBe("> npm test");
  expect(sh.prompt[2]).toBe("> jest --ci");
  expect(sh.q).toBe(0);
  expect(sh.pMore).toBe(false);
});

test("rowShape: heights stay arithmetic over paste rows at many widths, sizes and budgets", () => {
  for (const w of [320, 380, 545, 700]) {
    for (const size of [12, 18]) {
      for (const promptLines of [4, 1000]) {
        const sh = rowShape({ prompt: ISSUE_PROMPT, reply: "Done.", width: w, promptLines, replyLines: 3, size });
        const where = `${w} px, size ${size}, ${promptLines} lines`;
        expect(sh.p, where).toBe(sh.prompt.length);
        expect(sh.height, where).toBe(rowHeight(sh.p, sh.r, (sh.pMore ? 1 : 0) + (sh.rMore ? 1 : 0), readType(size).line));
      }
    }
  }
});

test("rowShape: the Prompt lines budget counts label and paste rows", () => {
  for (const promptLines of [1, 2, 4]) {
    const sh = rowShape({ prompt: ISSUE_PROMPT, reply: "x", width: 380, promptLines, replyLines: 1 });
    expect(sh.prompt.length, `${promptLines} lines`).toBeLessThanOrEqual(promptLines);
    expect(sh.p, `${promptLines} lines`).toBe(Math.max(1, sh.prompt.length));
    expect(sh.pMore, `${promptLines} lines`).toBe(true);
    expect(sh.prompt[sh.prompt.length - 1].endsWith("…"), `${promptLines} lines`).toBe(true);
  }
  // Shorten long messages off: the whole prompt shows, no Show more anywhere.
  const all = rowShape({ prompt: ISSUE_PROMPT, reply: "x", width: 380, promptLines: 100000, replyLines: 1 });
  expect(all.pMore).toBe(false);
  expect(all.prompt.length).toBe(10);
});

test("pin and outline prompts drop the paste wrapper", () => {
  const withPaste = `See this:\n<pasted_content id="t">\nalpha\nbeta\n</pasted_content>`;
  expect(pinPromptText(withPaste)).toBe("See this: alpha beta");
  expect(outlineText(withPaste)).toBe("See this:");
  // The tag at the end of the paste's last line, text after it, or CRLF line ends.
  expect(pinPromptText('See this:\n<pasted_content id="t">\nalpha\nbeta</pasted_content> Why?')).toBe("See this: alpha beta Why?");
  expect(pinPromptText('See this:\r\n<pasted_content id="t">\r\nalpha\r\n</pasted_content>\r\nWhy?')).toBe("See this: alpha Why?");
  expect(outlineText('<pasted_content id="o">\nonly body</pasted_content>')).toBe("only body");
  expect(outlineText('<pasted_content id="o">\nbody\n</pasted_content> Why is this slow?')).toBe("Why is this slow?");
  // A paste that is the whole prompt: its body is the fallback, never the tag.
  expect(pinPromptText('<pasted_content id="o">\nonly\n</pasted_content>')).toBe("only");
  expect(outlineText('<pasted_content id="o">\nfirst body\nsecond\n</pasted_content>')).toBe("first body");
  // A paste body that starts with a blank line (npm test output often does): the first
  // text line is the fallback, as fenced code already skips blanks, never an empty row.
  expect(outlineText('<pasted_content id="o">\n\nfirst body\nsecond\n</pasted_content>')).toBe("first body");
  // A wrapper inside a fenced code block stays text: the outline keeps looking for the
  // person's own words past it.
  expect(outlineText("```\n<pasted_content>\n```\nWhat went wrong here?")).toBe("What went wrong here?");
  expect(pinPromptText("plain prompt")).toBe("plain prompt");
  expect(outlineText("plain prompt")).toBe("plain prompt");
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
  // A typed prompt a sender rule matched: "matched by rule" and the tag, whatever kind.
  const ruled = { kind: "peer", name: "build-bot", rule: 2, ruleLabel: "Hourly report" };
  expect(senderLabel(ruled, 380)).toBe("build-bot · matched by rule");
  expect(senderLabel(ruled, 240)).toBe("build-bot");
  expect(senderLabel({ kind: "peer", rule: 1 }, 380)).toBe("Matched by rule");
  expect(senderParts(ruled, 380)).toEqual({ name: "build-bot", words: "matched by rule" });
  expect(senderParts(ruled, 240)).toEqual({ name: "build-bot", words: null });
  expect(senderParts(hc, 380)).toEqual({ name: "t7 review", words: "hc report" });
  expect(senderParts({ kind: "you" }, 380)).toEqual({ name: "User", words: null });
  expect(senderIcon(ruled)).toBe("tag");
  expect(kindWords(ruled)).toBe("matched by rule");
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
  expect(keySheet("q").map(([g]) => g)).toEqual(["List", "Open turn", "Pins", "Image viewer", "Settings card", "View"]);
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
  // Heights: padding, border, margins, one row at least, and the wrapped rows in view (OUT.SHOW
  // until Show all, which is its own row now, as is the viewer link for a longer output).
  expect(outHeight(outLines(""))).toBe(8 * 2 + 2 + 16 + 4);
  expect(outHeight(box)).toBe(8 * 2 + 2 + 12 * 16 + 4);
  expect(outHeight(outLines(big))).toBe(8 * 2 + 2 + 12 * 16 + 4);
  expect(outHeight(outLines("a\nb"))).toBe(8 * 2 + 2 + 2 * 16 + 4);
  expect(outHeight(box, 30)).toBe(8 * 2 + 2 + 30 * 16 + 4);
  expect(outHeight(outLines(""), 0)).toBe(8 * 2 + 2 + 16 + 4);
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
  expect(railLook(56)).toEqual({ lane: 32, mark: 10, sel: 16, right: 14, peak: 24, grow: 36 });
  expect(railLook(32)).toEqual({ lane: 32, mark: 8, sel: 12, right: 6, peak: 16, grow: 24 });
  expect(railLook(24)).toEqual({ lane: 24, mark: 8, sel: 12, right: 6, peak: 16, grow: 24 });
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

test("landPlan: an earlier item at the top puts an item lower; the option nearest want, clear of minTop", () => {
  const slots = [100, 40, 20, 300, 80];
  // i 3: at the top (y 0), under item 2 (20), 1 (60), 0 (160), or centred in 600 (150).
  expect(landPlan(slots, 3, 600, 0)).toEqual({ j: 3, how: "top", y: 0 });
  expect(landPlan(slots, 3, 600, 32, 32, 150)).toEqual({ j: 1, how: "top", y: 60 });
  expect(landPlan(slots, 3, 600, 152, 32)).toEqual({ j: 3, how: "center", y: 150 });
  expect(landPlan(slots, 3, 600, 170, 32)).toEqual({ j: 0, how: "top", y: 160 });
  // Nothing fits: the item at the top.
  expect(landPlan([500, 300], 1, 600, 32, 32, 140)).toEqual({ j: 1, how: "top", y: 0 });
  // Room for some of the item under it: 560 down in a 600 px list leaves only 40.
  expect(landPlan([560, 100], 1, 600, 560, 32).y).not.toBe(560);
});

test("wrapCap: text cut to a number of wrapped rows ends in an ellipsis and still fits them", () => {
  expect(MONO_EM).toBeGreaterThan(0.6);
  expect(wrapCap("bun test", 20, 6)).toEqual({ text: "bun test", rows: 1, cut: false });
  expect(wrapCap("", 20, 6)).toEqual({ text: "", rows: 1, cut: false });
  const long = "x".repeat(100);
  const a = wrapCap(long, 20, 3);
  expect(a).toMatchObject({ rows: 3, cut: true });
  expect(a.text.endsWith("…")).toBe(true);
  expect(codeRows(a.text, 20)).toBeLessThanOrEqual(3);
  // Lines that fill the rows exactly leave room for the ellipsis on the last.
  const b = wrapCap(`${"a".repeat(20)}\n${"b".repeat(20)}\nc`, 20, 2);
  expect(codeRows(b.text, 20)).toBe(2);
  expect(b.text.startsWith("a".repeat(20))).toBe(true);
  // Words wrap as codeRows counts them.
  expect(wrapCap("aaaa bbbb cccc dddd eeee ffff gggg", 10, 2).text).toBe("aaaa bbbb cccc dddd…");
});

test("htmlLine: escaped, with tabs and runs of spaces kept; htmlChunks: whole lines joined by their spaces, each chunk within MD_MAX bytes", () => {
  expect(htmlLine("a  b")).toBe("a&nbsp; b");
  expect(htmlLine(" x<y> & z")).toBe("&nbsp;x&lt;y&gt; &amp; z");
  expect(htmlLine("\tq")).toBe("&nbsp;&nbsp;&nbsp; q");
  // One wrap's lines: joined by the space the wrap took out, or by nothing after a hard break.
  expect(htmlChunks(["one", "two"])).toEqual([{ html: "one two", n: 2 }]);
  expect(htmlChunks(["src/cart/ro", "unding.js", "next"], undefined, [0])).toEqual([{ html: "src/cart/rounding.js next", n: 3 }]);
  const hard = rowLines("open src/cart/rounding/order-total/receipt.js now", 10, 12);
  expect(hard.hard?.length).toBeGreaterThan(0);
  expect(htmlChunks(hard.lines, undefined, hard.hard).map((x) => x.html).join(" ")).toBe("open src/cart/rounding/order-total/receipt.js now");
  const lines = Array.from({ length: 400 }, (_, i) => `line ${i} of a long pasted prompt, with é and ü in it`);
  const c = htmlChunks(lines);
  expect(c.length).toBeGreaterThan(1);
  expect(c.reduce((n, x) => n + x.n, 0)).toBe(400);
  for (const x of c) expect(new TextEncoder().encode(x.html).length).toBeLessThanOrEqual(MD_MAX);
  expect(c.map((x) => x.html).join(" ")).toBe(lines.map(htmlLine).join(" "));
});

test("cutPath: a path cut from its start at a slash, so it begins with a whole folder", () => {
  const p = "~/.config/herdr-app/data/agent-threads/settings.json";
  expect(cutPath(p, 80)).toBe(p);
  expect(cutPath(p, p.length)).toBe(p);
  expect(cutPath(p, 40)).toBe("…/data/agent-threads/settings.json");
  expect(cutPath(p, 30)).toBe("…/agent-threads/settings.json");
  // The file's name stays whole when it alone is longer.
  expect(cutPath(p, 8)).toBe("…/settings.json");
});

test("cardKey: the keys that scroll the settings card; cardScroll: where each takes the view, by which mark", () => {
  const ev = (key, mods = {}) => ({ key, modifiers: { shift: false, control: false, alt: false, platform: false, function: false, ...mods } });
  expect(["down", "j", "up", "k", "pagedown", "space", "pageup", "home", "end"].map((k) => cardKey(ev(k))))
    .toEqual(["down", "down", "up", "up", "pagedown", "pagedown", "pageup", "home", "end"]);
  expect(cardKey(ev("escape"))).toBe(null);
  expect(cardKey(ev(","))).toBe(null);
  expect(cardKey(ev("j", { platform: true }))).toBe(null);
  expect(cardKey(ev("space", { shift: true }))).toBe(null);
  // Rows that fit: nothing to scroll.
  expect(cardScroll("down", 0, 300, 400)).toBe(null);
  // 1,000 px of rows in a 400 px view: a line, then the end, and back.
  const marks = cardMarks(1000);
  const down = cardScroll("down", 0, 1000, 400);
  expect(down.y).toBe(marks[down.mark] + 1 - 400);
  expect(Math.abs(down.y - CARD_LINE)).toBeLessThanOrEqual(CARD_MARK / 2);
  expect(cardScroll("pagedown", 0, 1000, 400).y).toBeCloseTo(360, -1);
  expect(cardScroll("end", 0, 1000, 400)).toEqual({ y: 600, mark: marks.length - 1 });
  expect(cardScroll("end", 600, 1000, 400)).toBe(null);
  expect(cardScroll("home", 600, 1000, 400)).toEqual({ y: 0, mark: 0 });
  const up = cardScroll("up", 600, 1000, 400);
  expect(up.y).toBe(marks[up.mark]);
  expect(up.y).toBe(560);
  expect(cardScroll("pageup", 100, 1000, 400)).toEqual({ y: 0, mark: 0 });
  expect(cardScroll("sideways", 0, 1000, 400)).toBe(null);
});

// The owner (TRD-17): the number of tokens in the context window always shows, with the
// percent where the agent states its window. So the context count is the last to go.
test("statusGroups: the status line's groups, and what gives way first in a narrow pane", () => {
  const full = { turns: 12, hidden: 3, tools: 41, tokens: 1234567, cachePct: 87.4, context: 142000 };
  const text = (gs) => gs.map((g) => `${g.icon}: ${g.text}`);
  expect(text(statusGroups(full, 2000))).toEqual(["messages: 12 turns · 3 hidden · 41 tool calls", "database: 1.2M tokens · 87.4% cache hit", "cpu: 142k context"]);
  // Narrower and narrower: the cache hit, the hidden count and the tokens go; then "tool
  // calls" shortens, the tool count goes, and the turns go; the context count stays.
  const steps = [
    ["12 turns · 3 hidden · 41 tool calls", "1.2M tokens", "142k context"],
    ["12 turns · 41 tool calls", "1.2M tokens", "142k context"],
    ["12 turns · 41 tool calls", "142k context"],
    ["12 turns · 41 tools", "142k context"],
    ["12 turns", "142k context"],
    ["142k context"],
  ];
  let w = statusWidth(statusGroups(full, 2000));
  for (const want of steps) {
    // The widest pane where the step before no longer fits.
    while (statusGroups(full, w).map((g) => g.text).join("|") !== want.join("|") && w > 0) w--;
    expect(statusGroups(full, w).map((g) => g.text)).toEqual(want);
    expect(statusWidth(statusGroups(full, w))).toBeLessThanOrEqual(w);
    w--;
  }
  // Even the context count alone wider than the pane: it stays, and the row truncates it.
  expect(text(statusGroups(full, 10))).toEqual(["cpu: 142k context"]);
  // Cursor: no tokens, so no token group and no context, never "0 tokens"; the turns stay.
  const cursor = { turns: 1, hidden: 0, tools: 1, tokens: null, cachePct: null, context: null };
  expect(text(statusGroups(cursor, 2000))).toEqual(["messages: 1 turn · 1 tool call"]);
  expect(text(statusGroups(cursor, 10))).toEqual(["messages: 1 turn"]);
  // No tool calls: the count is left out, and 0% cache hit is a real number, so it shows.
  expect(statusGroups({ turns: 2, hidden: 0, tools: 0, tokens: 900, cachePct: 0, context: 450 }, 2000).map((g) => g.text)).toEqual(["2 turns", "900 tokens · 0% cache hit", "450 context"]);
});

test("statusGroups: with a stated window the context reads its count and percent behind the ring, and the count goes last", () => {
  const full = { turns: 12, hidden: 3, tools: 41, tokens: 1234567, cachePct: 87.4, context: 142000, contextPct: 55 };
  const text = (gs) => gs.map((g) => `${g.icon}: ${g.text}`);
  expect(text(statusGroups(full, 2000))).toEqual(["messages: 12 turns · 3 hidden · 41 tool calls", "database: 1.2M tokens · 87.4% cache hit", "ring-4: 142k context · 55%"]);
  // The other stats go first, as without a window; then the ring and percent (the count keeps
  // the chip icon), then the turns; the count stays.
  const steps = [
    ["messages: 12 turns · 3 hidden · 41 tool calls", "database: 1.2M tokens", "ring-4: 142k context · 55%"],
    ["messages: 12 turns · 41 tool calls", "database: 1.2M tokens", "ring-4: 142k context · 55%"],
    ["messages: 12 turns · 41 tool calls", "ring-4: 142k context · 55%"],
    ["messages: 12 turns · 41 tools", "ring-4: 142k context · 55%"],
    ["messages: 12 turns", "ring-4: 142k context · 55%"],
    ["messages: 12 turns", "cpu: 142k context"],
    ["cpu: 142k context"],
  ];
  let w = statusWidth(statusGroups(full, 2000));
  for (const want of steps) {
    while (text(statusGroups(full, w)).join("|") !== want.join("|") && w > 0) w--;
    expect(text(statusGroups(full, w))).toEqual(want);
    expect(statusWidth(statusGroups(full, w))).toBeLessThanOrEqual(w);
    w--;
  }
  expect(text(statusGroups(full, 10))).toEqual(["cpu: 142k context"]);
  // No window stated: the count alone, behind the chip icon.
  expect(text(statusGroups({ ...full, contextPct: null }, 2000)).at(-1)).toBe("cpu: 142k context");
  // A tiny stated window (a crafted transcript): shown as 999% at most, with a full ring.
  expect(text(statusGroups({ ...full, contextPct: 14200000 }, 2000)).at(-1)).toBe("ring-8: 142k context · 999%");
  expect(text(statusGroups({ ...full, contextPct: 999 }, 2000)).at(-1)).toBe("ring-8: 142k context · 999%");
  expect(text(statusGroups({ ...full, contextPct: 101 }, 2000)).at(-1)).toBe("ring-8: 142k context · 101%");
  // 0% is a real share, so it shows, with an empty ring.
  expect(text(statusGroups({ ...full, context: 300, contextPct: 0 }, 2000)).at(-1)).toBe("ring-0: 300 context · 0%");
});

test("ringStep: the ring's eighths, empty only at 0% and full only at 100%", () => {
  expect([0, 1, 6, 7, 19, 25, 50, 62, 75, 93, 94, 99, 100, 130].map(ringStep)).toEqual([0, 1, 1, 1, 2, 2, 4, 5, 6, 7, 7, 7, 8, 8]);
  expect([null, undefined, -5, Number.NaN].map(ringStep)).toEqual([0, 0, 0, 0]);
  // Each step has its icon.
  for (let k = 0; k <= 8; k++) expect(existsSync(join(import.meta.dir, `../mods/agent-threads/ring-${k}.svg`))).toBe(true);
});
