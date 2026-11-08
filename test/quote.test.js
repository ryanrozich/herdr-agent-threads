// bun test: round 2 helpers (pure, no Herdr): prompt quotes in rows and cards, the quiet
// command colour, the action bar, the quote text pasted into a terminal and its gate.
import { test, expect } from "bun:test";
import {
  promptParts, quoteRows, rowShape, clipYou, promptMd, escapeMd, quoteText, inReply, atLeast, canQuote, foreground,
  commandColor, contrast, barLayout, keyAction, TAKEN_LETTERS, rowTextWidth, rowHeight,
} from "../mods/agent-threads/ui.js";

const runs = (t) => promptParts(t).map((r) => [r.quote ? "q" : "c", r.lines]);

test("promptParts: quote and comment runs in source order, no lazy continuation", () => {
  expect(runs("> only a quote")).toEqual([["q", ["only a quote"]]]);
  expect(runs("only a comment")).toEqual([["c", ["only a comment"]]]);
  expect(runs("> quoted\nmy comment")).toEqual([["q", ["quoted"]], ["c", ["my comment"]]]);
  expect(runs("my comment\n\n> quoted")).toEqual([["c", ["my comment"]], ["q", ["quoted"]]]);
  expect(runs("> a\nfirst\n> b\nsecond")).toEqual([["q", ["a"]], ["c", ["first"]], ["q", ["b"]], ["c", ["second"]]]);
  expect(runs(">no space")).toEqual([["q", ["no space"]]]);
  expect(runs("> > nested\n>> twice\n   > indented")).toEqual([["q", ["nested", "twice", "indented"]]]);
  expect(runs("    > four spaces is not a quote")).toEqual([["c", ["    > four spaces is not a quote"]]]);
  expect(runs("> a\n>\n> b")).toEqual([["q", ["a", "", "b"]]]);
  expect(runs("run:\n```sh\n> redirect\n```\n> real quote")).toEqual([["c", ["run:", "```sh", "> redirect", "```"]], ["q", ["real quote"]]]);
  const forty = Array.from({ length: 40 }, (_, i) => `> line ${i}`).join("\n");
  expect(runs(forty)[0][1].length).toBe(40);
});

test("promptParts reads only the start of a 1 MB prompt", () => {
  const big = `> quoted\n${"word ".repeat(220000)}`;
  const t0 = performance.now();
  const r = promptParts(big);
  expect(performance.now() - t0).toBeLessThan(50);
  expect(r[0]).toEqual({ quote: true, lines: ["quoted"] });
  expect(r[1].lines.join("").length).toBeLessThanOrEqual(1200 * 8);
});

const CASES = {
  quoteOnly: "> The retry path still logs a warning when the queue is empty.",
  commentOnly: "Make the backoff start at 200 ms and cap it at 5 s.",
  quoteThenComment: "> The retry path still logs a warning when the queue is empty.\n> It also retries forever.\n\nCap the retries at five, and log once.",
  commentThenQuote: "Two notes on your summary:\n\n> The cache is warmed on deploy.\n\nIt is not; the job was removed last week.",
  interleaved: "> First, the queue drains on shutdown.\nGood, keep that.\n> Second, the alert fires after 3 misses.\nMake it 5.",
  noSpace: ">No space after the marker here.\nStill a quote above; this is the comment.",
  nested: "> > Nested: you said it twice.\n> Once more at one level.\n\nFlattened to one quote.",
  fence: "Run this:\n\n```sh\n> not a quote, a redirect\necho ok > out.txt\n```\n\nThen tell me what it prints.",
  forty: `${Array.from({ length: 40 }, (_, i) => `> quoted line ${i + 1} of the long summary`).join("\n")}\n\nThat is the whole summary; trim it to five lines.`,
};

test("rowShape keeps quotes within Prompt lines and always shows a comment line", () => {
  for (const width of [240, 380]) {
    for (const promptLines of [1, 2, 6]) {
      for (const [name, prompt] of Object.entries(CASES)) {
        const sh = rowShape({ prompt, reply: "Done.", width, promptLines, replyLines: 3 });
        const where = `${name} at ${width} px, ${promptLines} lines`;
        expect(sh.prompt.length, where).toBeLessThanOrEqual(promptLines);
        expect(sh.p, where).toBe(Math.max(1, sh.prompt.length));
        expect(sh.height, where).toBe(rowHeight(sh.p, sh.r, (sh.pMore ? 1 : 0) + (sh.rMore ? 1 : 0)));
        const hasComment = promptParts(prompt).some((r) => !r.quote);
        const hasQuote = promptParts(prompt).some((r) => r.quote);
        if (!hasQuote) { expect(sh.kinds, where).toBe(null); continue; }
        if (hasComment) expect(sh.kinds.includes("c"), where).toBe(true);
        else expect(sh.kinds.every((k) => k === "qonly"), where).toBe(true);
        if (promptLines === 1 && hasComment) expect(sh.kinds, where).toEqual(["c"]);
        expect(sh.q, where).toBe(sh.kinds.filter((k) => k !== "c").length);
      }
    }
  }
  // The quote line takes one truncated line, then the comment wraps.
  const sh = rowShape({ prompt: CASES.quoteThenComment, reply: "Done.", width: 380, promptLines: 2, replyLines: 3 });
  expect(sh.kinds).toEqual(["q", "c"]);
  expect(sh.prompt[0].startsWith("The retry path")).toBe(true);
  expect(sh.prompt[1]).toBe("Cap the retries at five, and log once.");
  // Interleaved at 6 lines: every run, in order.
  expect(rowShape({ prompt: CASES.interleaved, reply: "x", width: 380, promptLines: 6, replyLines: 1 }).kinds).toEqual(["q", "c", "q", "c"]);
  // Interleaved at 2: the first quote and the first comment, then an ellipsis.
  const two = rowShape({ prompt: CASES.interleaved, reply: "x", width: 380, promptLines: 2, replyLines: 1 });
  expect(two.kinds).toEqual(["q", "c"]);
  expect(two.prompt[1].endsWith("…")).toBe(true);
  // A fence's ">" lines are not quotes.
  expect(rowShape({ prompt: CASES.fence, reply: "x", width: 380, promptLines: 2, replyLines: 1 }).kinds).toBe(null);
  // While filtering, the row shows the text around the match as one run.
  expect(rowShape({ prompt: CASES.quoteThenComment, reply: "x", width: 380, promptLines: 2, replyLines: 1, quotes: false }).kinds).toBe(null);
});

test("quoteRows: a quote-only prompt wraps within the budget at prompt size", () => {
  const tw = rowTextWidth(380);
  const r = quoteRows(Array.from({ length: 40 }, (_, i) => `> quoted line ${i + 1}`).join("\n"), 3, tw);
  expect(r.kinds).toEqual(["qonly", "qonly", "qonly"]);
  expect(r.lines[2].endsWith("…")).toBe(true);
  expect(quoteRows("no quote here", 3, tw)).toBe(null);
});

test("clipYou: 2 lines per quote run, 3 comment lines, then the count left out", () => {
  const c = clipYou(CASES.forty, { per: 50 });
  expect(c.text.split("\n").slice(0, 2)).toEqual(["> quoted line 1 of the long summary", "> quoted line 2 of the long summary …"]);
  // A long quote line wraps within its 2 lines instead of being cut at one.
  expect(clipYou(`> ${"word ".repeat(15).trim()}\ncomment`, { per: 40 }).text.split("\n")[0]).toBe(`> ${"word ".repeat(15).trim()}`);
  expect(c.text).toContain("That is the whole summary");
  expect(c.more).toBe(38);
  const short = clipYou(CASES.quoteThenComment, { per: 60 });
  expect(short.more).toBe(0);
  // A fence the clip cuts is closed again.
  const f = clipYou("look:\n```\na\nb\nc\nd\n```", { per: 40, commentLines: 3 });
  expect((f.text.match(/```/g) ?? []).length % 2).toBe(0);
});

test("promptMd: quotes become blockquotes, everything else shows as typed", () => {
  expect(escapeMd("*a* _b_ #c")).toBe("\\*a\\* \\_b\\_ \\#c");
  const md = (t) => promptMd(t).md;
  expect(md("use *bold* and _this_")).toBe("use \\*bold\\* and \\_this\\_");
  expect(md("# not a heading")).toBe("\\# not a heading");
  expect(md("1. not a list")).toBe("1\\. not a list");
  expect(md("<b>not html</b>")).toBe("\\<b\\>not html\\<\\/b\\>");
  // A pasted log keeps its lines (hard breaks, never on a paragraph's last line).
  expect(md("line one\nline two\nline three")).toBe("line one\\\nline two\\\nline three");
  // Quote then comment: a blank line between, so the comment is never part of the quote.
  const qc = promptMd("> quoted\n> more\nmy comment");
  expect(qc.md).toBe("> quoted\\\n> more\n\nmy comment");
  expect(qc.quotes).toBe(1);
  // A fence keeps its ">" lines as code.
  const f = promptMd("Run this:\n```sh\n> not a quote\n```\ndone");
  expect(f.md).toBe("Run this\\:\n\n```sh\n> not a quote\n```\n\ndone");
  expect(f.code).toBe(1);
  // Inline code is kept, with its "*" inside.
  expect(md("call `a * b` now")).toBe("call `a * b` now");
  // Indentation is kept without becoming a code block; a bare URL is an autolink.
  expect(md("    indented")).toBe("    indented");
  expect(md("see https://x.example/a.")).toBe("see <https://x.example/a>\\.");
  // A blank quote line splits the quote into paragraphs without a stray backslash.
  expect(md("> a\n>\n> b")).toBe("> a\n>\n> b");
});

test("promptMd reads 32,000 characters by default, more with max, and says what it leaves out", () => {
  const long = "a ".repeat(25004);
  const d = promptMd(long);
  expect(d.cut).toBe(50008 - 32000);
  expect(d.md.endsWith("*… 18,008 more characters not shown*")).toBe(true);
  const all = promptMd(long, { max: 25000 });
  expect(all.cut).toBe(0);
  expect(all.md).not.toContain("not shown");
  expect(all.md.replace(/\s+/g, "").length).toBe(25004);
  expect(promptMd("short").cut).toBe(0);
});

test("quoteText: sanitised, prefixed, capped, with one blank line at the end", () => {
  const h = quoteText("Reply \u001b[201~\rrm -rf x\nnext");
  for (const ch of h.text) { const c = ch.charCodeAt(0); expect(c >= 0x20 || c === 0x0a).toBe(true); }
  expect(h.text).not.toContain("[201~");
  // A lone CR is a line break (inside a bracketed paste an LF is text, never Enter).
  expect(h.text).toBe("> Reply \n> rm -rf x\n> next\n\n".replace("Reply \n", "Reply\n"));
  expect(quoteText("a\r\nb").text).toBe("> a\n> b\n\n");
  expect(quoteText("\tx").text).toBe(">     x\n\n");
  expect(quoteText("a‮b⁦c​d﻿").text).toBe("> abcd\n\n");
  expect(quoteText("\u001b[2[200~00~x").text).toBe("> x\n\n");
  expect(quoteText("a\n\nb").text).toBe("> a\n>\n> b\n\n");
  expect(quoteText("\n\n  \nonly\n\n").text).toBe("> only\n\n");
  const hundred = quoteText(Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n"));
  expect(hundred.capped).toBe(true);
  expect(hundred.lines).toBe(40);
  expect(hundred.text.split("\n").slice(-3)).toEqual(["> …", "", ""]);
  expect(hundred.cut).toBe("lines");
  const chars = quoteText("x".repeat(5000));
  expect(chars.capped).toBe(true);
  expect(chars.cut).toBe("chars");
  expect(chars.text.length).toBeLessThanOrEqual(2002);
  // A first line over the cap is quoted in part, cut at a word, never dropped (R1).
  const long = quoteText(`${"word ".repeat(450)}\nsecond`);
  expect(long.cut).toBe("chars");
  expect(long.lines).toBe(1);
  expect(long.text.startsWith("> word word")).toBe(true);
  expect(long.text).toMatch(/^> (word )+word…\n\n$/);
  expect(long.text.length).toBeLessThanOrEqual(2002);
  expect(long.text).not.toContain("second");
  // A later line that does not fit is cut the same way after the lines that do.
  const later = quoteText(["short one", "y ".repeat(1500)].join("\n"));
  expect(later.text.startsWith("> short one\n> y y")).toBe(true);
  expect(later.text).toMatch(/…\n\n$/);
  expect(later.text.length).toBeLessThanOrEqual(2002);
  // A cut never splits a surrogate pair.
  const emoji = quoteText("😀".repeat(1500));
  expect(emoji.text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  expect(quoteText("")).toBe(null);
  expect(quoteText(" \n\u001b\r\n ")).toBe(null);
  expect(quoteText("x").text.endsWith("\n\n")).toBe(true);
  expect(quoteText("x").text.endsWith("\n\n\n")).toBe(false);
});

test("inReply: only text that is part of this reply's source", () => {
  const reply = "First paragraph.\n\n- item **one**\n- item two";
  expect(inReply("item **one**\n- item", reply)).toBe(true);
  expect(inReply("  First   paragraph. ", reply)).toBe(true);
  expect(inReply("something else", reply)).toBe(false);
  expect(inReply("", reply)).toBe(false);
  expect(inReply("   ", reply)).toBe(false);
});

test("inReply: what Herdr copies from the formatted reply counts as part of it", () => {
  const reply = [
    "## The **cart** test", "",
    "It rounds *tax* per `line`, see [the docs](https://example.com/tax \"Tax\") and [more][m].", "",
    "- item **one**", "1. item two", "",
    "| Name | Rate |", "|---|---|", "| AT&amp;T | 5% |", "",
    "```python", "print(1)", "```", "",
    "After the ~~old~~ code.", "",
    "[m]: https://example.com/more",
  ].join("\n");
  // Markers, link targets and entities are gone from a formatted copy.
  expect(inReply("The cart test", reply)).toBe(true);
  expect(inReply("rounds tax per line, see the docs and more.", reply)).toBe(true);
  expect(inReply("AT&T", reply)).toBe(true);
  // Each block is its own line, and a list marker may or may not come along.
  expect(inReply("item one\nitem two", reply)).toBe(true);
  expect(inReply("• item one\n2. item two", reply)).toBe(true);
  // A code block between two blocks is not in the copy (its editor is not part of the selection).
  expect(inReply("The cart test\nAfter the old code.", reply)).toBe(true);
  expect(inReply("print(1)", reply)).toBe(true);
  // Lines out of order, a link's address alone, and outside text are not from this reply.
  expect(inReply("After the old code.\nThe cart test", reply)).toBe(false);
  expect(inReply("example.com/tax rate", reply)).toBe(false);
  expect(inReply("rm -rf / from some other window", reply)).toBe(false);
  expect(inReply("The cart test\nrm -rf /", reply)).toBe(false);
  // Symbols alone count only when they are there as written.
  expect(inReply("---", "a --- b")).toBe(true);
  expect(inReply("***", "plain words")).toBe(false);
});

test("atLeast compares versions by number", () => {
  expect(atLeast("0.1.13", "0.1.13")).toBe(true);
  expect(atLeast("0.1.14", "0.1.13")).toBe(true);
  expect(atLeast("0.2.0", "0.1.13")).toBe(true);
  expect(atLeast("0.1.12", "0.1.13")).toBe(false);
  expect(atLeast("0.1.9", "0.1.13")).toBe(false);
  expect(atLeast(undefined, "0.1.13")).toBe(false);
});

test("canQuote: every refusal, and the idle and busy cases", () => {
  const ok = { exists: true, remote: false, pane: true, moved: false, ended: null, status: "idle", fg: { claude: true } };
  expect(canQuote(ok)).toEqual({ ok: true, busy: false });
  expect(canQuote({ ...ok, status: "working" })).toEqual({ ok: true, busy: true });
  expect(canQuote({ ...ok, status: "done" }).ok).toBe(true);
  expect(canQuote({ ...ok, status: null }).ok).toBe(true);
  const why = (x) => canQuote({ ...ok, ...x }).why;
  expect(why({ status: "blocked" })).toBe("blocked");
  expect(why({ fg: { claude: false, shell: true } })).toBe("shell");
  expect(why({ fg: { claude: false, shell: false } })).toBe("other");
  expect(why({ exists: false })).toBe("closed");
  expect(why({ ended: "closed" })).toBe("closed");
  expect(why({ ended: "exited" })).toBe("exited");
  expect(why({ pane: false })).toBe("nopane");
  expect(why({ moved: true })).toBe("moved");
  expect(why({ remote: true })).toBe("remote");
  expect(why({ panelOpen: true })).toBe("panel");
});

test("foreground: the same claude test resolve() uses", () => {
  expect(foreground({ foreground: { argv: ["/usr/local/bin/claude", "--resume", "x"], name: "claude" } }).claude).toBe(true);
  expect(foreground({ foreground: { name: "2.1.316", argv: ["node"] } }).claude).toBe(true);
  expect(foreground({ foreground: { name: "node" } }, { app: "claude-code" }).claude).toBe(true);
  const sh = foreground({ foreground: { name: "zsh", argv: ["-zsh"] } });
  expect([sh.claude, sh.shell]).toEqual([false, true]);
  expect(foreground({}).claude).toBe(false);
});

test("the quote key: q by default, configurable, never a key already taken", () => {
  const k = (key, mods = {}) => ({ key, modifiers: { shift: false, control: false, alt: false, platform: false, function: false, ...mods } });
  expect(keyAction(k("q"))).toBe("quote");
  expect(keyAction(k("q"), true)).toBe(null); // not while filtering
  expect(keyAction(k("y"), false, "y")).toBe("quote");
  expect(keyAction(k("q"), false, "y")).toBe(null);
  expect(keyAction(k("q", { platform: true }))).toBe(null);
  expect(keyAction(k("q", { shift: true }))).toBe(null);
  expect(keyAction(k("j"), false, "j")).toBe("next"); // a taken key keeps its action
  expect([...TAKEN_LETTERS].sort()).toEqual(["a", "c", "g", "i", "j", "k", "o", "s", "t"]);
  // Round 3 (C2): i explains the stat chips, so it cannot be the quote key.
  expect(keyAction(k("i"))).toBe("legend");
  expect(keyAction(k("i"), false, "i")).toBe("legend");
});

test("commandColor: muted where it reads at 4.5:1 on the row's background, else foreground", () => {
  const pass = { background: "#1e1e1e", selected: "#2a2d3a", muted: "#a0a0a0", foreground: "#e6e6e6" };
  expect(commandColor(pass)).toBe("#a0a0a0");
  expect(commandColor(pass, true)).toBe("#a0a0a0");
  const failBg = { ...pass, muted: "#555555" };
  expect(commandColor(failBg)).toBe("#e6e6e6");
  const failSel = { background: "#ffffff", selected: "#9a9a9a", muted: "#6b6b6b", foreground: "#111111" };
  expect(contrast(failSel.muted, failSel.background)).toBeGreaterThanOrEqual(4.5);
  expect(commandColor(failSel)).toBe("#6b6b6b");
  expect(commandColor(failSel, true)).toBe("#111111");
  expect(commandColor({ background: "#fff", muted: "nope", foreground: "#000" })).toBe("#000");
});

test("barLayout: four buttons that never overlap, labels dropping as the pane narrows", () => {
  for (let w = 200; w <= 700; w += 10) {
    for (const quote of [true, false]) for (const terminal of [true, false]) {
      const L = barLayout(w, { quote, terminal });
      const boxes = [L.copy, L.select, L.quote, L.terminal].filter(Boolean);
      for (let i = 1; i < boxes.length; i++) if (w >= 240) expect(boxes[i][0] - boxes[i - 1][1], `${w}`).toBeGreaterThanOrEqual(6);
      expect(Boolean(L.quote)).toBe(quote);
    }
  }
  expect(barLayout(700).labels).toEqual({ copy: "Copy reply", select: true, quote: true, terminal: true });
  expect(barLayout(380).labels).toEqual({ copy: "Copy reply", select: true, quote: false, terminal: true });
  expect(barLayout(300).labels).toEqual({ copy: "Copy", select: false, quote: false, terminal: true });
  expect(barLayout(240).labels).toEqual({ copy: "Copy", select: false, quote: false, terminal: false });
  // No Quote button (no pane): the bar keeps the layout it had before.
  expect(barLayout(240, { quote: false, terminal: false }).labels.copy).toBe("Copy reply");
});
