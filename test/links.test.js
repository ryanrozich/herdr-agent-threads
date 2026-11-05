// bun test: link rules from settings.json (parse, guards, substitution), where they apply
// (never in code, links or URLs), the git remote parser, and that a save from the panel
// keeps quoteKey and links exactly as written.
import { test, expect, mock } from "bun:test";

const writes = [];
// Every name main.js imports, as stubs: bun keeps the export names of the first mock of a
// module, and render.test.js mocks "herdr" again with working ones.
const stub = () => null;
mock.module("herdr", () => ({
  writeTextFile: async (path, text, expected) => { writes.push({ path, text, expected }); return null; },
  ...Object.fromEntries(["exec", "hc", "home", "appHome", "readTextFile", "watchFolder", "theme", "themes", "settings", "panes", "terminals",
    "spaces", "focused", "props", "run", "shared", "setShared", "closeOverlay", "notify", "nextCommand", "updates"].map((k) => [k, stub])),
}));
const { parseLinks, parseQuoteKey, parseExtras, templateHost, saveSettings, parseSettings, DEFAULTS } = await import("../mods/agent-threads/settings.js");
const { linkify, linkPieces, fillUrl, parseRemote, promptMd } = await import("../mods/agent-threads/ui.js");

const ISSUE = { name: "Issue", pattern: "\\bACME-(\\d+)\\b", url: "https://linear.app/acme/issue/ACME-$1" };
const PR = { name: "PR", pattern: "(?<![\\w&/#])#(\\d{1,5})\\b", url: "https://github.com/{repo}/pull/$1" };
const rules = (...r) => parseLinks(r).rules;
const ctx = { repo: "acme/widgets", owner: "acme" };

test("valid rules compile, with their host and whether they use {repo}", () => {
  const { rules: r, notes } = parseLinks([ISSUE, PR]);
  expect(notes).toEqual([]);
  expect(r.map((x) => [x.n, x.name, x.host, x.repo])).toEqual([[1, "Issue", "linear.app", false], [2, "PR", "github.com", true]]);
  expect(r[0].re.flags).toContain("g");
  expect(parseLinks(undefined)).toEqual({ rules: [], notes: [] });
  expect(parseLinks({}).notes[0]).toContain("not a list");
});

test("bad rules are dropped with a note naming each one", () => {
  const bad = [
    { pattern: "", url: "https://x.example/$1" },
    { pattern: "x(", url: "https://x.example/$1" },
    { pattern: "x*", url: "https://x.example/$0" },
    { pattern: "\\b", url: "https://x.example/$0" },
    { pattern: "(a+)+$", url: "https://x.example/$1" },
    { pattern: "(.*)*x", url: "https://x.example/$1" },
    { pattern: "(\\w+\\s?)+$", url: "https://x.example/$1" },
    { pattern: "(a)\\1", url: "https://x.example/$1" },
    { pattern: "a".repeat(201), url: "https://x.example/$0" },
    { pattern: "ACME-(\\d+)" },
    { pattern: "(a|aa)+c", url: "https://x.example/x/$1" },
    { pattern: "(?:x|\\w)*y", url: "https://x.example/$0" },
  ];
  const { rules: r, notes } = parseLinks(bad);
  expect(r).toEqual([]);
  expect(notes).toEqual([
    "Link rule 1: no pattern", "Link rule 2: pattern not valid", "Link rule 3: pattern matches empty text",
    "Link rule 4: pattern matches empty text", "Link rule 5: nested quantifier, as in (a+)+", "Link rule 6: nested quantifier, as in (a+)+",
    "Link rule 7: nested quantifier, as in (a+)+", "Link rule 8: backreferences are not allowed", "Link rule 9: pattern over 200 characters",
    "Link rule 10: no url", "Link rule 11: alternation under a quantifier, as in (a|aa)+",
    "Link rule 12: alternation under a quantifier, as in (a|aa)+",
  ]);
  // An alternation that is not quantified is fine, and so are the README's examples.
  expect(parseLinks([{ pattern: "\\b(?:PR|pr)-(\\d+)\\b", url: "https://x.example/$1" }, ISSUE, PR]).rules.length).toBe(3);
  const many = parseLinks(Array.from({ length: 21 }, (_, i) => ({ pattern: `K${i}-(\\d+)`, url: "https://x.example/$1" })));
  expect(many.rules.length).toBe(20);
  expect(many.notes).toEqual(["Link rule 21: past the 20th rule; ignored"]);
});

test("URL templates: literal http(s), a fixed host, placeholders only in the path", () => {
  for (const url of ["javascript:alert(1)//$1", "data:text/html,$1", "file:///etc/$1", "//evil.example/$1", "https://$1.example/x",
    "https://x@evil/$1", "https://{owner}.github.io/x", "https://x.example", "https://x.example/{nope}"]) {
    expect(templateHost(url), url).toBe(null);
    expect(parseLinks([{ pattern: "ACME-(\\d+)", url }]).rules.length, url).toBe(0);
  }
  expect(templateHost("https://Linear.app/acme/$1")).toBe("linear.app");
  expect(templateHost("http://localhost:8080/t/$1")).toBe("localhost:8080");
});

test("captures are encoded and the host never changes", () => {
  const [r] = rules({ pattern: "go:(\\S+)", url: "https://x.example/item/$1" });
  const m = (s) => { r.re.lastIndex = 0; return r.re.exec(s); };
  expect(fillUrl(r, m("go:../../admin"), {})).toBe("https://x.example/item/..%2F..%2Fadmin");
  expect(fillUrl(r, m("go:x@y"), {})).toBe("https://x.example/item/x%40y");
  expect(fillUrl(r, m("go:a(b)"), {})).toBe("https://x.example/item/a%28b%29");
  const [p] = rules(PR);
  p.re.lastIndex = 0;
  const pm = p.re.exec("see #45");
  expect(fillUrl(p, pm, ctx)).toBe("https://github.com/acme/widgets/pull/45");
  expect(fillUrl(p, pm, { repo: "../x" })).toBe(null);
  expect(fillUrl(p, pm, { repo: "a/b c" })).toBe(null);
  expect(fillUrl(p, pm, {})).toBe(null);
});

test("linkify: prose only, never in code, links, URLs or a colour", () => {
  const r = rules(ISSUE, PR);
  const md = "ACME-123 is fixed in #45. The colour #123456 is unchanged, and so is [ACME-1](https://x.example/one).\n\n```sh\ngit log --grep ACME-9\n```\n\nSee <https://x.example/ACME-3> and https://x.example/ACME-4 for the history; `ACME-5` stays code. Not &#12; either.";
  const out = linkify(md, r, ctx);
  expect(out.links).toBe(2);
  expect(out.md).toContain("[ACME\\-123](https://linear.app/acme/issue/ACME-123)");
  expect(out.md).toContain("[\\#45](https://github.com/acme/widgets/pull/45)");
  for (const keep of ["#123456", "[ACME-1](https://x.example/one)", "git log --grep ACME-9", "<https://x.example/ACME-3>", "https://x.example/ACME-4", "`ACME-5`", "&#12;"]) expect(out.md).toContain(keep);
  // No repo: the {repo} rule is skipped and #45 stays plain.
  const noRepo = linkify(md, r, {});
  expect(noRepo.links).toBe(1);
  expect(noRepo.md).toContain("fixed in #45.");
  // The first rule that matches at a position wins.
  const two = rules({ pattern: "ACME-(\\d+)", url: "https://a.example/$1" }, { pattern: "ACME-\\d+", url: "https://b.example/$0" });
  expect(linkify("ACME-7", two, {}).md).toBe("[ACME\\-7](https://a.example/7)");
  // An indented code block is left alone.
  expect(linkify("text\n\n    ACME-1 in code", r, {}).links).toBe(0);
});

// R4 and R2-1: code in a blockquote or a list item, and a code span over a line break, keep
// their text; a nested list item four spaces in is text.
test("linkify finds code the CommonMark way: in quotes, in list items, across lines", () => {
  const r = rules(ISSUE);
  const one = (md) => linkify(md, r, {});
  const linked = (md) => one(md).md.match(/\[ACME\\-\d+\]/g)?.map((x) => x.slice(1, -1).replace("\\", "")) ?? [];
  expect(linked("> ```\n> see ACME-2\n> ```\n> after ACME-9")).toEqual(["ACME-9"]);
  expect(one("> ```\n> see ACME-2\n> ```").md).toBe("> ```\n> see ACME-2\n> ```");
  expect(linked("text `code\nACME-3 more` end ACME-4")).toEqual(["ACME-4"]);
  expect(linked("- item\n\n    - ACME-7 nested")).toEqual(["ACME-7"]);
  expect(linked("- item\n\n  ```\n  ACME-8 in fence\n  ```\n- next ACME-10")).toEqual(["ACME-10"]);
  expect(linked("1. one\n   ```\n   ACME-11\n   ```\n   ACME-12 after")).toEqual(["ACME-12"]);
  expect(linked("- ```js\n  ACME-14\n  ```\nACME-15")).toEqual(["ACME-15"]);
  // A paragraph's continuation line is text, even four spaces in.
  expect(linked("para\n    ACME-13 continuation")).toEqual(["ACME-13"]);
  // A fence in a quote ends with the quote.
  expect(linked("> ```\nACME-18 outside quote")).toEqual(["ACME-18"]);
  // Code under a nested item, and the paragraph after the list.
  expect(linked("- a\n  - b\n\n        code ACME-22\n\nplain ACME-23")).toEqual(["ACME-23"]);
  // A backtick that a blank line leaves unclosed is plain text.
  expect(linked("`tick\n\nACME-20 new para`")).toEqual(["ACME-20"]);
  // Lines keep their count and order.
  const md = "> quote ACME-16\nlazy ACME-17\n\n# Head ACME-19";
  expect(one(md).md.split("\n").length).toBe(md.split("\n").length);
  expect(linked(md)).toEqual(["ACME-16", "ACME-17", "ACME-19"]);
});

// The YOU block shows a prompt's backticks as typed unless they pair on one line, so a span
// over a line break is not code there: the text it holds is plain and may be linked.
test("promptMd: backticks that do not pair on a line are shown as typed", () => {
  const out = promptMd("multi `code\nACME-5 more` end", { links: rules(ISSUE) });
  expect(out.md).toBe("multi \\`code\\\n[ACME\\-5](https://linear.app/acme/issue/ACME-5) more\\` end");
  expect(out.code).toBe(0);
});

test("the probe stops a pattern whose time grows fast before it costs much", () => {
  const t0 = performance.now();
  const { rules: r, notes } = parseLinks([{ pattern: "a*a*a*a*a*a*a*b", url: "https://x.example/$0" }]);
  expect(performance.now() - t0).toBeLessThan(500);
  expect(r).toEqual([]);
  expect(notes[0]).toContain("too slow");
});

test("linkify caps: 20,000 characters scanned, 25 links, 80 characters a match, and fast", () => {
  const r = rules(ISSUE);
  const late = `${"x ".repeat(10500)}ACME-1`;
  expect(linkify(late, r, {}).links).toBe(0);
  const lots = Array.from({ length: 40 }, (_, i) => `ACME-${i}`).join(" ");
  expect(linkify(lots, r, {}).links).toBe(25);
  const [long] = rules({ pattern: "Z+", url: "https://x.example/$0" });
  expect(linkPieces("Z".repeat(81), [long], {}).length).toBe(1);
  expect(linkPieces("Z".repeat(80), [long], {})[0].url).toBeTruthy();
  const big = Array.from({ length: 2000 }, (_, i) => `Paragraph ${i} mentions ACME-${i} and #${i} and \`code\` and https://x.example/${i}.`).join("\n");
  expect(big.length).toBeGreaterThan(100000);
  const t0 = performance.now();
  linkify(big, rules(ISSUE, PR), ctx);
  expect(performance.now() - t0).toBeLessThan(50);
});

test("promptMd applies the rules to the prompt's plain text only", () => {
  const r = rules(ISSUE, PR);
  const out = promptMd("Look at ACME-123 and PR #45, but not `ACME-7` in code.\n> ACME-88 was the old ticket.\nAlso see https://x.example/ACME-2 for context.", { links: r, ...ctx });
  expect(out.links).toBe(3);
  expect(out.md).toContain("[ACME\\-123](https://linear.app/acme/issue/ACME-123)");
  expect(out.md).toContain("[\\#45](https://github.com/acme/widgets/pull/45)");
  expect(out.md).toContain("> [ACME\\-88](https://linear.app/acme/issue/ACME-88)");
  expect(out.md).toContain("`ACME-7`");
  expect(out.md).toContain("<https://x.example/ACME-2>");
});

test("parseRemote: https, scp-style and ssh, with or without .git", () => {
  for (const u of ["https://github.com/acme/widgets.git", "https://github.com/acme/widgets", "https://user@github.com/acme/widgets.git/",
    "git@github.com:acme/widgets.git", "git@github.com:acme/widgets", "ssh://git@github.com/acme/widgets.git", "ssh://git@github.com:22/acme/widgets"]) {
    expect(parseRemote(u), u).toEqual({ host: "github.com", owner: "acme", repo: "acme/widgets" });
  }
  expect(parseRemote("https://gitlab.example/group/sub/proj.git").repo).toBe("group/sub/proj");
  for (const junk of ["", "not a url", "https://github.com/onlyone", "file:///tmp/x", "/srv/git/x.git", "https://github.com/a/../b", "git@github.com:a b/c"])
    expect(parseRemote(junk), junk).toBe(null);
});

test("quoteKey: one free letter a–z, else q with a note", () => {
  expect(parseQuoteKey(undefined)).toEqual({ key: "q", note: null });
  expect(parseQuoteKey("y")).toEqual({ key: "y", note: null });
  for (const bad of ["jj", "j", "Q", "1", 5, "", "ä"]) {
    const r = parseQuoteKey(bad);
    expect(r.key).toBe("q");
    expect(r.note).toContain("quoteKey");
  }
});

test("a save from the panel keeps the link rules and quoteKey as written", async () => {
  const file = JSON.stringify({ promptLines: 2, replyLines: 3, agentTurns: false, quoteKey: "jj", links: [ISSUE, { pattern: "(a+)+", url: "https://x.example/$1" }] }, null, 2);
  const x = parseExtras(file);
  expect(x.quoteKey).toBe("q");
  expect(x.links.length).toBe(1);
  expect(x.linkCount).toBe(2);
  expect(x.notes.length).toBe(2);
  // links and quoteKey are not settings values: the panel never normalises them.
  expect(Object.keys(parseSettings(file).values)).toEqual(Object.keys(DEFAULTS));
  await saveSettings("/apphome", { ...parseSettings(file).values, agentTurns: true }, file);
  const saved = JSON.parse(writes.at(-1).text);
  expect(saved.agentTurns).toBe(true);
  expect(saved.quoteKey).toBe("jj");
  expect(saved.links).toEqual([ISSUE, { pattern: "(a+)+", url: "https://x.example/$1" }]);
});

test("linkify: a pasted-image label is never a link, the text after it still is", () => {
  const r = rules(ISSUE, PR);
  const out = linkify("[Image #2] [Image #3] Compare these, see #45.", r, ctx);
  expect(out.links).toBe(1);
  expect(out.md).toContain("[Image #2] [Image #3]");
  expect(out.md).toContain("[\\#45](https://github.com/acme/widgets/pull/45)");
});
