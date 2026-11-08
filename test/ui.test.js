// bun test: drawing helpers (pure, no Herdr).
import { test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  keyAction, alpha, spans, around, langFor, clipPrompt, wrappedLines, dayKey, jumpTarget,
  rowLines, flattenMd, middle, rowShape, rowHeight, rowTextWidth, bubbleMax, commandLayout, ROW, senderLabel, senderIcon, kindWords,
  isShown, visible, countLabel, focusTarget, contrast, mix, labelColor, youHeight, dayParts, bandFill, BAND_LIGHT, over,
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
  // Padding 8, meta 16, gap 6, bubble 6 + lines + 6, gap 6, the agent's name 18, reply lines,
  // gap 6, stats 16, padding 10.
  expect(rowHeight(1, 1)).toBe(8 + 16 + 6 + 12 + 18 + 6 + 18 + 18 + 6 + 16 + 10);
  expect(rowHeight(4, 6)).toBe(8 + 16 + 6 + 12 + 72 + 6 + 18 + 108 + 6 + 16 + 10);
  expect(rowHeight(1, 1, 2)).toBe(rowHeight(1, 1) + 36);
  expect(bubbleMax(380)).toBe(Math.floor(348 * 0.82));
  expect(bubbleMax(280)).toBe(Math.floor(248 * 0.9));
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
