// bun test: runs the real extractor over the synthetic fixture, in small chunks so turns
// cross chunk boundaries, and checks the assembled turns.
import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply, parseChunk, nextChunk, replaced, reply, stats, segments, shortModel, fmtDuration, fmtTokens, fmtTime, cachePct, fmtPct, cacheLine, commandParts, senderOf, matches, sessionStats } from "../mods/agent-threads/core/turns.js";

const root = join(import.meta.dir, "..");
const extractor = join(root, "mods/agent-threads/core/extract.sh");
const fixture = join(root, "test/fixtures/session.jsonl");

function read(file, base, session = newSession("s", file)) {
  let chunk = base;
  for (let guard = 0; guard < 10000 && chunk; guard++) {
    const out = execFileSync("sh", [extractor, file, String(session.offset), String(chunk)], { encoding: "utf8" });
    const r = parseChunk(out);
    session.size = r.size;
    for (const e of r.events) apply(session, e);
    session.offset += r.used;
    chunk = nextChunk(session, r.used, chunk, base);
  }
  return session;
}

test("assembles turns from the fixture", () => {
  const s = read(fixture, 1 << 20);
  expect(s.offset).toBe(s.size);
  expect(s.title).toBe("login flake");
  expect(s.agentName).toBe("shop-agent"); // an agent-name line gets past extract.sh's filter
  expect(s.turns.map((t) => t.prompt.split("\n")[0])).toEqual([
    "What does the auth mock warning in the test output mean?",
    "Fix the flaky login test so it stops timing out in CI",
    "Run the full e2e suite and summarise the failures",
    "Why does CI fail here? Log below:",
    "Add a retry note to the README",
  ]);
  const [plain, fix, e2e, long, readme] = s.turns;
  expect(plain.tools).toBe(0);
  expect(reply(plain)).toStartWith("It fires when a test skips logout");
  expect(fix.tools).toBe(3);
  // Each step with its time, each call with its input in short, when it was made, when its
  // result came and whether it failed.
  const ms = (t) => Date.parse(`2026-11-01T09:13:${t}.000Z`);
  expect(fix.steps).toEqual([{ k: "text", t: "Let me look at the test first.", cut: false, at: ms("08") }, { k: "group", calls: ["Read", "Bash", "Edit"], ids: ["toolu_000002_Read", "toolu_000003_Bash", "toolu_000004_Edit"], count: 3,
    info: [{ in: "tests/login.spec.ts", at: ms(12), rt: ms(14), f: false }, { in: "bun test login", at: ms(18), rt: ms(20), f: false }, { in: "tests/login.spec.ts", at: ms(24), rt: ms(26), f: false }] }]);
  expect(reply(fix)).toStartWith("The test raced the redirect.");
  expect(reply(fix)).not.toContain("Let me look");
  expect(reply(fix)).not.toContain("background build");
  expect(fix.followups).toBe(1);
  expect(fix.durationMs).toBe(105000);
  expect(e2e.interrupted).toBe(true);
  expect(reply(e2e)).toBe("");
  expect(long.compactions).toBe(0);
  expect(e2e.compactions).toBe(1);
  expect(segments(reply(long)).map((x) => x.kind)).toEqual(["md", "code", "md"]);
  expect(readme.errors).toEqual(["API Error: overloaded"]);
  expect(reply(readme)).toBe("Documented the retry flag under **Testing**.");
  expect(shortModel(fix.model)).toBe("opus 5.5");
  expect(fix.effort).toBe("high");
  // usage repeats on every block line of one message id and is counted once
  const st = stats(plain);
  expect(st.tokens).toBe(6 + 1800 + 120);
  expect(st.cachePct).toBe(95.8); // 42000 / 43806, floored to one decimal
});

test("small chunks give the same turns as one read", () => {
  const whole = read(fixture, 1 << 20);
  const pieces = read(fixture, 1500);
  expect(pieces.offset).toBe(whole.offset);
  expect(JSON.stringify(pieces.turns)).toBe(JSON.stringify(whole.turns));
});

test("a cut-off last line is left for the next read", () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-"));
  const file = join(dir, "live.jsonl");
  const text = require("node:fs").readFileSync(fixture, "utf8");
  const cut = text.lastIndexOf("\n", text.length - 2) + 20;
  writeFileSync(file, text.slice(0, cut));
  const s = read(file, 1 << 20);
  expect(s.offset).toBe(Buffer.byteLength(text.slice(0, text.lastIndexOf("\n", text.length - 2) + 1)));
  appendFileSync(file, text.slice(cut));
  read(file, 1 << 20, s);
  expect(s.offset).toBe(Buffer.byteLength(text));
  expect(s.turns.length).toBe(5);
});

test("running turn stays open until turn_duration", () => {
  const s = newSession("s", "f");
  apply(s, { k: "p", o: "human", ts: "2026-11-01T10:00:00Z", t: "go" });
  apply(s, { k: "u", n: "Bash" });
  expect(s.turns[0].done).toBe(false);
  apply(s, { k: "t", t: "done" });
  apply(s, { k: "d", ms: 1000 });
  expect(s.turns[0].done).toBe(true);
});

test("formatting", () => {
  expect(fmtTokens(18234)).toBe("18.2k");
  expect(fmtTokens(950)).toBe("950");
  expect(fmtDuration(102000)).toBe("1m 42s");
  expect(segments("a\n```\nx\n```").map((s) => s.kind)).toEqual(["md", "code"]);
});

// ---- fixtures made on the fly by make-fixture.js ----

const gen = join(root, "test/make-fixture.js");
function made(...flags) {
  const dir = mkdtempSync(join(tmpdir(), "threads-"));
  const file = join(dir, "f.jsonl");
  execFileSync("bun", [gen, file, "00000000-0000-4000-8000-000000000002", "/tmp/threads-demo", ...flags], { stdio: "ignore" });
  return file;
}
function events(file, script = extractor) {
  return parseChunk(execFileSync("sh", [script, file, "0", String(1 << 26)], { encoding: "utf8", maxBuffer: 1 << 28 })).events;
}

test("a fresh /clear file has no turns and remembers when it was cleared", () => {
  const s = read(made("--clear", "--only", "0"), 1 << 20);
  expect(s.turns.length).toBe(0);
  expect(s.clearAt).toBe(Date.parse("2026-11-01T09:12:01.000Z"));
});

test("/clear followed by prompts: only the prompts are rows", () => {
  const s = read(made("--clear", "--only", "2"), 1 << 20);
  expect(s.turns.map((t) => t.prompt)).toEqual(["Add alt text to the product images", "Bump Playwright to the latest minor"]);
  expect(s.turns.every((t) => t.done && !t.interrupted)).toBe(true);
  expect(s.clearAt).not.toBeNull();
});

test("/usage lines are not turns and do not interrupt the next prompt", () => {
  const s = read(made("--usage"), 1 << 20);
  const last = s.turns.at(-1);
  expect(s.turns.some((t) => t.prompt.startsWith("/usage"))).toBe(false);
  expect(last.prompt).toBe("Rerun the checkout smoke tests");
  expect(last.done).toBe(true);
  expect(last.interrupted).toBe(false);
  expect(reply(last)).toBe("Both checkout smoke tests pass.");
  // both tag orders, with and without origin, reach the extractor as commands
  expect(events(made("--usage")).filter((e) => e.cmd).map((e) => e.t)).toEqual(["/usage", "/usage"]);
});

test("a custom command that Claude answers is one done turn titled /name args", () => {
  const s = read(made("--skill"), 1 << 20);
  const t = s.turns.at(-1);
  expect(t.prompt).toBe("/review-pr 12");
  expect(t.cmd).toBe(true);
  expect(t.done).toBe(true);
  expect(t.interrupted).toBe(false);
  expect(t.tools).toBe(1);
  expect(reply(t)).toStartWith("PR 12 looks correct.");
});

test("a peer prompt mid-turn shares one turn_duration and nothing is interrupted", () => {
  const s = read(made("--peer"), 1 << 20);
  const [a, b] = s.turns.slice(-2);
  expect(a.prompt).toStartWith("Profile the search endpoint");
  expect(b.origin).toBe("peer");
  for (const t of [a, b]) {
    expect(t.done).toBe(true);
    expect(t.interrupted).toBe(false);
  }
  expect(reply(b)).toStartWith("The slow query was a missing index");
  expect(a.answeredBy).toBe(b.n);
});

test("a notification before turn_duration still closes the turn", () => {
  const s = read(made("--notify"), 1 << 20);
  const t = s.turns.at(-1);
  expect(t.prompt).toStartWith("Start the background typecheck");
  expect(t.followups).toBe(1);
  expect(reply(t)).toBe("The typecheck finished with 0 errors.");
  expect(t.done).toBe(true);
  expect(t.interrupted).toBe(false);
  expect(s.followActive).toBe(false);
});

test("only an interrupt line marks a turn interrupted", () => {
  const s = newSession("s", "f");
  apply(s, { k: "p", o: "human", t: "a" });
  apply(s, { k: "p", o: "human", t: "b" });
  expect(s.turns[0].interrupted).toBe(false);
  expect(s.turns[0].done).toBe(false);
  apply(s, { k: "u", n: "Bash" });
  apply(s, { k: "i" });
  expect(s.turns[0].interrupted).toBe(false);
  expect(s.turns[0].done).toBe(true);
  expect(s.turns[1].interrupted).toBe(true);
});

test("a notification turn after a closed row is followActive until its turn_duration", () => {
  const s = newSession("s", "f");
  apply(s, { k: "p", o: "human", t: "a" });
  apply(s, { k: "d", ms: 1 });
  apply(s, { k: "p", o: "task-notification", t: null });
  expect(s.followActive).toBe(true);
  apply(s, { k: "d", ms: 1 });
  expect(s.followActive).toBe(false);
});

test("usage of a message split over block lines counts once", () => {
  const ev = events(made());
  const ids = ev.filter((e) => e.k === "m").map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("the new extractor gives the old event stream, less repeated usage, non-own text, call ids, times, input summaries, results and the newer events", () => {
  // The first release's extractor, kept as a fixture to compare against.
  const before = join(root, "test/fixtures/v1-extractor/extract.sh");
  const file = made("--peer", "--notify");
  const norm = (list) => {
    const seen = new Set();
    return list.filter((e) => e.k !== "s" && e.k !== "b" && e.k !== "an" && e.k !== "x" && (e.k !== "m" || (!seen.has(e.id) && seen.add(e.id)))).map((e) => (e.cmd ? { ...e, u: undefined } : e)).map((e) => (e.k === "u" ? { ...e, id: undefined, ts: undefined, in: undefined } : e)).map((e) => (e.k === "t" ? { ...e, ts: undefined } : e)).map((e) => JSON.stringify({ ...e, t: e.k === "p" && e.o === "task-notification" ? null : e.t }));
  };
  expect(norm(events(file))).toEqual(norm(events(file, before)));
});

test("reads match a reference slice at an unaligned offset", () => {
  const file = made("--extra", "30");
  const text = require("node:fs").readFileSync(file);
  const off = 12345;
  const next = text.indexOf(10, off) + 1;
  const out = execFileSync("sh", [extractor, file, String(next), "5000"], { encoding: "utf8" });
  const used = parseChunk(out).used;
  const slice = text.subarray(next, next + 5000);
  expect(used).toBe(slice.lastIndexOf(10) + 1);
  const ref = execFileSync("sh", ["-c", 'jq -Rc -f "$1"', "x", join(root, "mods/agent-threads/core/extract.jq")], { input: slice.subarray(0, used), encoding: "utf8" });
  expect(parseChunk(out).events).toEqual(parseChunk(ref).events);
});

test("a chunk of huge replies stays under 6 MiB and every turn is read", () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-"));
  const file = join(dir, "huge.jsonl");
  const lines = [];
  for (let i = 0; i < 20; i++) {
    lines.push(JSON.stringify({ type: "user", origin: { kind: "human" }, message: { content: `prompt ${i}` }, timestamp: "2026-11-01T09:00:00Z", uuid: `00000000-0000-4000-9000-${String(i).padStart(12, "0")}` }));
    lines.push(JSON.stringify({ type: "assistant", apiBlockIndex: 0, message: { id: `m${i}`, content: [{ type: "text", text: "y".repeat(600 * 1024) }], usage: { output_tokens: 1 } } }));
    lines.push(JSON.stringify({ type: "system", subtype: "turn_duration", durationMs: 1000 }));
  }
  writeFileSync(file, `${lines.join("\n")}\n`);
  const s = newSession("s", file);
  let chunk = 48 << 20, calls = 0, biggest = 0;
  while (chunk && calls < 100) {
    const out = execFileSync("sh", [extractor, file, String(s.offset), String(chunk)], { encoding: "utf8", maxBuffer: 1 << 28 });
    biggest = Math.max(biggest, Buffer.byteLength(out));
    const r = parseChunk(out);
    s.size = r.size;
    for (const e of r.events) apply(s, e);
    s.offset += r.used;
    chunk = nextChunk(s, r.used, chunk, 48 << 20);
    calls++;
  }
  expect(biggest).toBeLessThan(6 * 1024 * 1024 + 4096);
  expect(s.offset).toBe(s.size);
  expect(s.turns.length).toBe(20);
  expect(s.turns.every((t) => t.done && reply(t).length <= 200000 + 40)).toBe(true);
});

test("the file line names the first uuid, so a replaced file can be told apart", () => {
  const a = made();
  const b = made("--extra", "2");
  const head = (f) => parseChunk(execFileSync("sh", [extractor, f, "0", "100"], { encoding: "utf8" })).head;
  expect(head(a)).toBe("00000000-0000-4000-9000-000000000002");
  writeFileSync(b, require("node:fs").readFileSync(b, "utf8").replaceAll("4000-9000-", "4000-a000-"));
  expect(head(b)).toBe("00000000-0000-4000-a000-000000000002");
});

test("a replaced file is read again from the top", () => {
  // As main.js reads: a chunk that shows another file starts a fresh session.
  const readLikePane = (file, s) => {
    let chunk = 4096;
    while (chunk) {
      const c = parseChunk(execFileSync("sh", [extractor, file, String(s.offset), String(chunk)], { encoding: "utf8" }));
      if (replaced(s, c)) { Object.assign(s, newSession(s.id, s.file)); continue; }
      if (c.head && !s.head) s.head = c.head;
      s.size = c.size;
      for (const e of c.events) apply(s, e);
      s.offset += c.used;
      chunk = nextChunk(s, c.used, chunk, 4096);
    }
    return s;
  };
  const a = made("--only", "2");
  const s = readLikePane(a, newSession("x", a));
  expect(s.turns.length).toBe(2);
  // A larger, different transcript at the same path (new uuids): every turn is its own.
  const b = made("--only", "5");
  writeFileSync(a, require("node:fs").readFileSync(b, "utf8").replaceAll("4000-9000-", "4000-b000-"));
  readLikePane(a, s);
  expect(s.turns.length).toBe(5);
  expect(s.head).toStartWith("00000000-0000-4000-b000-");
  // A shorter file is a replacement too.
  writeFileSync(a, `${require("node:fs").readFileSync(b, "utf8").split("\n").slice(0, 3).join("\n")}\n`);
  expect(replaced(s, { size: 10, head: s.head })).toBe(true);
  expect(replaced(s, { size: s.offset + 10, head: s.head })).toBe(false);
});

// One user line, the way Claude Code writes it, with made-up text.
function userLine(text, extra = {}) {
  return `${JSON.stringify({ type: "user", timestamp: "2026-11-01T09:00:00.000Z", message: { role: "user", content: text }, ...extra })}\n`;
}

test("a prompt that only mentions a command tag stays a prompt", () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-"));
  const file = join(dir, "mention.jsonl");
  const text = "Why does the <command-name> tag show up in transcripts?";
  writeFileSync(file, userLine(text, { origin: { kind: "human" } }) + userLine(text));
  const ev = events(file);
  expect(ev.map((e) => [e.k, Boolean(e.cmd), e.t])).toEqual([["p", false, text], ["p", false, text]]);
  // a real command line still is one, whichever tag comes first
  writeFileSync(file, userLine("<command-message>usage</command-message>\n<command-name>/usage</command-name>")
    + userLine(" <command-name>/review-pr</command-name>\n<command-args>12</command-args>", { origin: { kind: "human" } }));
  expect(events(file).map((e) => [e.cmd, e.t])).toEqual([[true, "/usage"], [true, "/review-pr 12"]]);
});

test("/clear-cache and other names that start with clear are ordinary commands", () => {
  const s = newSession("s", "f");
  apply(s, { k: "p", cmd: true, o: "human", t: "/clear-cache", ts: "2026-11-01T09:00:00.000Z" });
  apply(s, { k: "t", t: "cache cleared" });
  apply(s, { k: "d", ms: 1 });
  expect(s.clearAt).toBeNull();
  expect(s.turns.map((t) => [t.prompt, reply(t)])).toEqual([["/clear-cache", "cache cleared"]]);
  const c = newSession("c", "f");
  apply(c, { k: "p", cmd: true, o: "human", t: "/clear", ts: "2026-11-01T09:00:00.000Z" });
  apply(c, { k: "p", cmd: true, o: "human", t: "/clear now", ts: "2026-11-01T09:00:00.000Z" });
  expect(c.turns.length).toBe(0);
  expect(c.clearAt).not.toBeNull();
});

test("a local command logged mid-turn does not take the running turn's reply", () => {
  const s = newSession("s", "f");
  apply(s, { k: "p", o: "human", t: "Run the suite" });
  apply(s, { k: "u", n: "Bash" });
  apply(s, { k: "p", cmd: true, o: "human", t: "/usage" });
  apply(s, { k: "u", n: "Bash" });
  apply(s, { k: "t", t: "final answer" });
  apply(s, { k: "d", ms: 1 });
  expect(s.turns.length).toBe(1);
  expect(reply(s.turns[0])).toBe("final answer");
  expect(s.turns[0].tools).toBe(2);
  expect(s.turns[0].answeredBy).toBeNull();
});

// ---- v1 feedback ----

test("fmtTime: 12-hour with AM/PM and a no-break space", () => {
  const at = (h, m) => fmtTime(new Date(2026, 10, 1, h, m).getTime());
  expect(at(0, 0)).toBe("12:00 AM");
  expect(at(0, 5)).toBe("12:05 AM");
  expect(at(9, 5)).toBe("9:05 AM");
  expect(at(12, 0)).toBe("12:00 PM");
  expect(at(12, 30)).toBe("12:30 PM");
  expect(at(13, 5)).toBe("1:05 PM");
  expect(at(23, 59)).toBe("11:59 PM");
  expect(at(9, 5)).not.toContain(" ");
  expect(fmtTime(null)).toBe("");
});

test("cache percent floors to one decimal and is 100 only when everything was read", () => {
  expect(cachePct(999, 1000)).toBe(99.9);
  expect(cachePct(9995, 10000)).toBe(99.9);
  expect(cachePct(1, 3)).toBe(33.3);
  expect(cachePct(3, 10)).toBe(30);
  expect(cachePct(5000, 5000)).toBe(100);
  expect(cachePct(0, 0)).toBe(null);
  expect(cachePct(0, 10)).toBe(0);
  expect(cachePct(999999999999, 1000000000000)).toBe(99.9);
  expect(fmtPct(99.6)).toBe("99.6%");
  expect(fmtPct(82)).toBe("82%");
  expect(fmtPct(0)).toBe("0%");
  const st = stats({ usage: { a: { i: 4112, o: 10, cr: 1204331, cc: 31008 } } });
  expect(st.cachePct).toBe(97.1);
  expect(cacheLine(st)).toBe("cache read 1,204,331 · written 31,008 · new input 4,112");
  expect(stats({ usage: {} }).cachePct).toBe(null);
  expect(stats({ usage: { a: { i: 0, o: 5, cr: 100, cc: 0 } } }).cachePct).toBe(100);
});

test("commandParts: name and args", () => {
  expect(commandParts({ cmd: true, prompt: "/review-pr 12" })).toEqual({ name: "/review-pr", args: "12" });
  expect(commandParts({ cmd: true, prompt: "/plugin-marketplace:review-pull-request 12 --deep  x" })).toEqual({ name: "/plugin-marketplace:review-pull-request", args: "12 --deep  x" });
  expect(commandParts({ cmd: true, prompt: "/x" })).toEqual({ name: "/x", args: "" });
  expect(commandParts({ cmd: false, prompt: "/x" })).toBe(null);
});

test("senderOf: every shape, with the wrapper tags stripped", () => {
  expect(senderOf("human", "Fix it")).toEqual({ sender: { kind: "you" }, body: "Fix it" });
  expect(senderOf("human", '<hc from="t7 review">Two bugs</hc>')).toEqual({ sender: { kind: "hc", name: "t7 review" }, body: "Two bugs" });
  expect(senderOf("human", '<hc from="t3 lead" reach="hc send t3 when done">Review x</hc>')).toEqual({ sender: { kind: "hc", name: "t3 lead", request: true }, body: "Review x" });
  expect(senderOf("human", "Explain the <hc from=\"x\"> tag")).toEqual({ sender: { kind: "you" }, body: "Explain the <hc from=\"x\"> tag" });
  expect(senderOf("human", "<hc>no from</hc>").sender.kind).toBe("you");
  expect(senderOf("peer", 'Another Claude session sent a message:\n<agent-message from="helper-a">Frozen?</agent-message>')).toEqual({ sender: { kind: "peer", name: "helper-a" }, body: "Frozen?" });
  expect(senderOf("peer", "Another Claude session asks: which branch?")).toEqual({ sender: { kind: "peer" }, body: "Another Claude session asks: which branch?" });
  expect(senderOf("peer", 'Team:\n<teammate-message teammate_id="helper-b" color="green" summary="s">Tests pass.</teammate-message>')).toEqual({ sender: { kind: "peer", name: "helper-b" }, body: "Tests pass." });
  expect(senderOf("peer", '<teammate-message teammate_id="a">x</teammate-message><teammate-message teammate_id="b">y</teammate-message><teammate-message teammate_id="a">z</teammate-message>')).toEqual({ sender: { kind: "peer", name: "a +1" }, body: "x\n\ny\n\nz" });
  expect(senderOf("scheduled", "Check the build").sender).toEqual({ kind: "scheduled" });
  expect(senderOf("sdk", "x").sender).toEqual({ kind: "sdk" });
  expect(senderOf(undefined, "x").sender).toEqual({ kind: "you" });
});

test("a peer hand-back marked isMeta is an agent message named by its origin; other meta lines are dropped", () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-"));
  const file = join(dir, "m.jsonl");
  const line = (o) => JSON.stringify({ type: "user", sessionId: "s", timestamp: "2026-11-02T03:30:24.000Z", uuid: `u${Math.random()}`, ...o });
  const hand = 'Another Claude session sent a message: <agent-message from="a0f0e0d0c0b0a0901">Done.</agent-message>';
  writeFileSync(file, `${[
    line({ isMeta: true, promptSource: "system", turnOrigin: "peer", origin: { kind: "peer", from: "a0f0e0d0c0b0a0901", senderTaskId: "t1", name: "general-purpose" }, message: { role: "user", content: [{ type: "text", text: hand }] } }),
    line({ isMeta: true, promptSource: "system", turnOrigin: "scheduled", message: { role: "user", content: [{ type: "text", text: "a reminder" }] } }),
    line({ isMeta: true, promptSource: "system", turnOrigin: "auto_continuation", message: { role: "user", content: "a note" } }),
    line({ isMeta: true, message: { role: "user", content: "<local-command-caveat>x</local-command-caveat>" } }),
    line({ isMeta: true, origin: { kind: "human" }, message: { role: "user", content: "meta with a human origin" } }),
  ].join("\n")}\n`);
  const ev = events(file).filter((e) => e.k === "p");
  expect(ev).toEqual([{ k: "p", o: "peer", ts: "2026-11-02T03:30:24.000Z", t: hand, n: "general-purpose" }]);
  const s = newSession("s", "f");
  for (const e of events(file)) apply(s, e);
  expect(s.turns.map((t) => [t.sender, t.agent, t.prompt])).toEqual([[{ kind: "peer", name: "general-purpose" }, true, "Done."]]);
  // Without an origin name the message's from is the label; a teammate_id wins over both.
  expect(senderOf("peer", hand).sender.name).toBe("a0f0e0d0c0b0a0901");
  expect(senderOf("peer", '<teammate-message teammate_id="helper-b">x</teammate-message>', "general-purpose").sender.name).toBe("helper-b");
  expect(senderOf("peer", "no tags", "general-purpose").sender).toEqual({ kind: "peer", name: "general-purpose" });
});

test("--agents, --commands, --latest and --skill fixtures round trip with senders, commands and latest text", () => {
  const s = newSession("s", "f");
  for (const e of events(made("--only", "1", "--agents", "--commands", "--latest", "--skill"))) apply(s, e);
  const rows = s.turns.map((t) => [t.sender.kind, t.sender.name ?? null, t.agent, t.cmd, t.prompt]);
  expect(rows).toEqual([
    ["you", null, false, false, "Add alt text to the product images"],
    ["you", null, false, true, "/review-pr 12"],
    ["hc", "t7 review", true, false, "Two bugs in cart.ts; details in notes/review.md"],
    ["you", null, false, false, "Fix both bugs from the review"],
    ["peer", "helper-a", true, false, "Is the cart API frozen for the release?"],
    ["peer", "helper-b +1", true, false, "The checkout tests pass on the branch.\n\nDocs are updated."],
    ["peer", null, true, false, "Another Claude session asks: which branch is the release on?"],
    ["peer", "general-purpose", true, false, "The survey of the cart module is done: three call sites use the old price field."],
    ["scheduled", null, true, false, "Check the nightly build status"],
    ["hc", "t3 lead", true, false, "Review the checkout copy changes"],
    ["you", null, false, false, "Explain what the <hc from=...> tag in the last report means"],
    ["you", null, false, true, "/plugin-marketplace:review-pull-request 12 --deep check the retry path"],
    ["you", null, false, true, "/x"],
    ["you", null, false, false, "bro tidy the imports"],
    ["you", null, false, false, "Start the nightly export in the background"],
  ]);
  expect(s.turns.every((t) => !t.prompt.startsWith("<"))).toBe(true);
  expect(s.turns[9].sender.request).toBe(true);
  // the auto-continuation folded into "Fix both bugs" as a background update
  const fix = s.turns[3];
  expect(fix.followups).toBe(1);
  expect(reply(fix)).toBe("Fixed both: the guard now rejects 0 and negative quantities.");
  expect(fix.latest).toBe("Added a test for the zero-quantity case.");
  // the task notification after turn_duration said something new; the reply is unchanged
  const exp = s.turns[14];
  expect(reply(exp)).toBe("Started the export; I will report when it finishes.");
  expect(exp.latest).toBe("The export finished: 1,204 rows, no errors. The file is out/export.csv.");
  expect(exp.tools).toBe(1);
  expect(exp.followTools).toBe(1);
  // the filter matches a sender name
  expect(matches(s.turns[2], "t7 rev")).toBe(true);
});

test("the --skill fixture's command row has no tag left", () => {
  const s = newSession("s", "f");
  for (const e of events(made("--only", "1", "--skill"))) apply(s, e);
  const row = s.turns.find((t) => t.cmd);
  expect(row.prompt).toBe("/review-pr 12");
  expect(row.prompt).not.toContain("<");
});

test("background update text resets at each tool call and each new update", () => {
  const s = newSession("s", "f");
  const ev = [
    { k: "p", o: "human", t: "go" }, { k: "t", t: "done" }, { k: "d", ms: 1 },
    { k: "p", o: "task-notification" }, { k: "t", t: "checking" }, { k: "u", n: "Read" }, { k: "t", t: "first update" }, { k: "d", ms: 1 },
    { k: "p", o: "task-notification" }, { k: "u", n: "Read" }, { k: "d", ms: 1 },
  ];
  for (const e of ev) apply(s, e);
  expect(reply(s.turns[0])).toBe("done");
  expect(s.turns[0].latest).toBe("first update");
  expect(s.turns[0].followups).toBe(2);
});

test("the latest background update keeps when its first text came, beside the text", () => {
  const s = newSession("s", "f");
  const at = (m) => `2026-11-01T09:${String(m).padStart(2, "0")}:00.000Z`;
  const ev = [
    { k: "p", o: "human", t: "go", ts: at(0) }, { k: "t", t: "done", ts: at(1) }, { k: "d", ms: 1 },
    { k: "p", o: "task-notification", ts: at(5) }, { k: "t", t: "checking", ts: at(6) }, { k: "u", n: "Read", ts: at(7) },
    { k: "t", t: "first update", ts: at(8) }, { k: "t", t: "and more", ts: at(9) }, { k: "d", ms: 1 },
  ];
  for (const e of ev) apply(s, e);
  expect(s.turns[0].latest).toBe("first update\n\nand more");
  expect(s.turns[0].latestAt).toBe(Date.parse(at(8)));
  // A later wake-up with no text of its own leaves the update and its time as they were.
  for (const e of [{ k: "p", o: "task-notification", ts: at(20) }, { k: "u", n: "Read", ts: at(21) }, { k: "d", ms: 1 }]) apply(s, e);
  expect(s.turns[0].latestAt).toBe(Date.parse(at(8)));
  // One that says something moves both.
  for (const e of [{ k: "p", o: "task-notification", ts: at(30) }, { k: "t", t: "second", ts: at(31) }, { k: "d", ms: 1 }]) apply(s, e);
  expect([s.turns[0].latest, s.turns[0].latestAt]).toEqual(["second", Date.parse(at(31))]);
});

test("a command line from another sender is that sender's turn, not the person's (F3)", () => {
  for (const o of ["peer", "scheduled", "sdk"]) {
    const s = newSession("x", "f");
    apply(s, { k: "p", cmd: true, o, t: "/review 12", ts: "2026-11-01T09:00:00.000Z" });
    apply(s, { k: "t", t: "Reviewed." });
    expect(s.turns.length).toBe(1);
    expect(s.turns[0]).toMatchObject({ cmd: true, agent: true, sender: { kind: o }, prompt: "/review 12" });
  }
  const s = newSession("x", "f");
  apply(s, { k: "p", cmd: true, o: "human", t: "/review 12" });
  apply(s, { k: "t", t: "Reviewed." });
  expect(s.turns[0]).toMatchObject({ agent: false, sender: { kind: "you" } });
});

// ---- round 3: S1 --------------------------------------------------------------------------

// The hc split senderOf used before round 3, kept here as the oracle for the indexOf version.
function oldSender(origin, text) {
  const t = text ?? "";
  const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1].trim() || null : null; };
  if (origin === "peer") {
    const msgs = [...t.matchAll(/<(agent-message|teammate-message)\b([^>]*)>([\s\S]*?)(?:<\/\1>|$)/g)];
    if (!msgs.length) return { sender: { kind: "peer" }, body: t };
    const names = [...new Set(msgs.map((m) => attr(` ${m[2]}`, "teammate_id") ?? attr(` ${m[2]}`, "from")).filter(Boolean))];
    const name = names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0];
    const body = msgs.map((m) => m[3].trim()).filter(Boolean).join("\n\n");
    return { sender: { kind: "peer", ...(name ? { name } : {}) }, body: body || t.replace(/<\/?(agent|teammate)-message\b[^>]*>/g, "").trim() };
  }
  if ((origin ?? "human") !== "human") return null;
  const m = t.match(/^\s*(<hc\b[^>]*>)([\s\S]*?)(?:<\/hc>\s*)?$/);
  if (m && attr(m[1], "from")) {
    const reach = attr(m[1], "reach");
    return { sender: { kind: "hc", name: attr(m[1], "from"), ...(reach ? { request: true } : {}) }, body: m[2].replace(/<\/?hc\b[^>]*>/g, "").trim() };
  }
  return { sender: { kind: "you" }, body: t };
}

function prompts(...flags) {
  const dir = mkdtempSync(join(tmpdir(), "threads-sender-"));
  const file = join(dir, "f.jsonl");
  execFileSync("bun", [join(root, "test/make-fixture.js"), file, "00000000-0000-4000-8000-000000000130", "/tmp/threads-demo", ...flags], { stdio: "ignore" });
  const out = execFileSync("sh", [extractor, file, "0", String(64 << 20)], { encoding: "utf8", maxBuffer: 1 << 28 });
  return parseChunk(out).events.filter((e) => e.k === "p");
}

const SENDER_EDGES = [
  '<hc from="t7 review">Report: done</hc>', '  \n<hc from="t7">body', '<hc from="t7">body</hc>   \n ', '<hc from="t7">a</hc></hc>',
  '<hc from="t7">a</hc>b', '<hcx from="t7">not hc</hcx>', '<hc>no from</hc>', '<hc from="">empty</hc>', '<hc from=" t7 ">pad</hc>',
  '<hc from="t7" reach="t2">request</hc>', '<hc reach="t2" from="t7">order</hc>', '<hc from="t7"', '<hc', '<hc ', 'text <hc from="t7">late</hc>',
  '<hc from="t7"><hc from="t8">nested</hc></hc>', '<hc from="t7">\n\nmulti\nline\n</hc>\n', '<hc\tfrom="t7">tab</hc>', '<hc\nfrom="t7">nl</hc>',
  '<hc from=t7>unquoted</hc>', '<hc data-from="x" from="t7">two</hc>', '<hc from="t7">x</hc >', '<hc from="t7">x</HC>', ' <hc from="t7">nbsp</hc> ',
  '', '   ', 'plain prompt', `<hc from="t7">${"word ".repeat(2000)}</hc>`, '<hc from="t7">x <hc from="t9">inner</hc> y</hc>',
];
const PEER_EDGES = [
  '<agent-message from="helper-a">hi</agent-message>', '<agent-message from="a">one</agent-message><agent-message from="b">two</agent-message>',
  '<teammate-message teammate_id="t-1" color="blue" summary="x">a</teammate-message>\n<teammate-message teammate_id="t-2">b</teammate-message>',
  '<agent-message from="a">never closed', '<agent-message from="a"', '<agent-messages from="a">plural</agent-messages>',
  '<agent-message>no from</agent-message>', 'lead <agent-message from="a">mid</agent-message> tail', '<agent-message from="a"></agent-message>',
  '<agent-message from="a">x</teammate-message>y</agent-message>', '<teammate-message teammate_id="t">a<agent-message from="z">b</agent-message></teammate-message>',
  '<agent-message\nfrom="a">nl</agent-message>', 'no tags at all', '', `<agent-message from="a">${"word ".repeat(2000)}`,
];

test("senderOf's hc and peer splits match the old patterns on every fixture prompt and the edge cases", () => {
  const all = [...prompts("--busy", "130"), ...prompts("--agents"), ...prompts("--edge")];
  expect(all.length).toBeGreaterThan(1300);
  let checked = 0;
  for (const e of [...all, ...SENDER_EDGES.map((t) => ({ o: "human", t })), ...PEER_EDGES.map((t) => ({ o: "peer", t }))]) {
    const want = oldSender(e.o, e.t);
    if (!want) continue;
    expect(senderOf(e.o, e.t)).toEqual(want);
    checked++;
  }
  expect(checked).toBeGreaterThan(1300);
});

// Under the interpreter's speed (BUN_JSC_useJIT=0, set for a child bun), senderOf and the old
// split (oldSender, above) are timed one after the other over the same 1,306 busy prompts in
// the same child, best of five rounds each, and the old split must take at least 4 times as
// long. A fixed limit failed on runner timing alone: 5.027 ms against 5 ms in CI at commit
// 8866382, then a pass on rerun (issue #160). Contention slows both loops together, so the
// ratio holds: 10.58 or more across 200 idle and loaded runs, while a senderOf regressed to
// the old split in one branch or both measures 0.97 to 1.95. oldSender uses nothing from
// turns.js, so a change there moves only senderOf's side. The JIT stays off: with it on, the
// ratio is 3.4 to 4.0.
test("senderOf stays at least 4x faster than the pre-round-3 split on the busy fixture with JIT off", () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-sender-"));
  const file = join(dir, "p.json");
  writeFileSync(file, JSON.stringify(prompts("--busy", "130").map((e) => [e.o, e.t])));
  const script = join(dir, "time.js");
  writeFileSync(script, `import { senderOf } from ${JSON.stringify(join(root, "mods/agent-threads/core/turns.js"))};
${oldSender}
const ps = JSON.parse(require("fs").readFileSync(${JSON.stringify(file)}, "utf8"));
for (const [o, t] of ps.slice(0, 50)) { senderOf(o, t); oldSender(o, t); }
let msNew = Infinity, msOld = Infinity;
for (let r = 0; r < 5; r++) {
  let a = performance.now(); for (const [o, t] of ps) senderOf(o, t); msNew = Math.min(msNew, performance.now() - a);
  a = performance.now(); for (const [o, t] of ps) oldSender(o, t); msOld = Math.min(msOld, performance.now() - a);
}
console.log(JSON.stringify({ n: ps.length, msNew, msOld }));`);
  const out = JSON.parse(execFileSync("bun", [script], { encoding: "utf8", env: { ...process.env, BUN_JSC_useJIT: "0" } }));
  console.log(`senderOf timing, JIT off: n=${out.n} msNew=${out.msNew.toFixed(2)} msOld=${out.msOld.toFixed(2)} ratio=${(out.msOld / out.msNew).toFixed(2)}`);
  expect(out.n).toBeGreaterThan(1300);
  expect(out.msOld / out.msNew).toBeGreaterThanOrEqual(4);
});

// ---- round 3: C3 ------------------------------------------------------------------------------

test("reply() is every text block after the last tool call, joined with a blank line, from the first one", () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-blocks-"));
  const file = join(dir, "b.jsonl");
  execFileSync("bun", [join(root, "test/make-fixture.js"), file, "00000000-0000-4000-8000-000000000003", "/tmp/threads-demo", "--only", "0", "--blocks"], { stdio: "ignore" });
  const s = read(file, 1 << 20);
  expect(s.turns.length).toBe(3);
  const [three, tooled, notified] = s.turns.map(reply);
  expect(three).toBe("Opening words of block one: the retry loop now stops after five tries\n\nand block two goes on mid-sentence, as a split reply can.\n\nBlock three closes the reply.");
  expect(three).not.toContain("Checking the retry module");
  expect(tooled).toBe("Renamed backoff to delay in the retry options.");
  expect(tooled).not.toContain("Early text");
  expect(notified).toBe("First part of the summary: all retry tests pass.\n\nSecond part, after the notification: lint is clean too.");
  expect(s.turns[2].followups).toBe(1);
  // Read in tiny chunks, the replies are the same.
  expect(read(file, 700).turns.map(reply)).toEqual([three, tooled, notified]);
});

test("steps: interim text and groups of calls in order, the reply apart, and caps on size", async () => {
  const { STEP_TEXT, STEP_CALLS, STEP_MAX } = await import("../mods/agent-threads/core/turns.js");
  const s = newSession("00000000-0000-4000-8000-0000000000aa", "/x.jsonl");
  const ev = [
    { k: "p", o: "human", t: "Fix the cart total", ts: "2026-11-01T09:00:00.000Z" },
    { k: "t", t: "Looking at the cart." }, { k: "u", n: "Read" }, { k: "u", n: "Grep" },
    { k: "t", t: "Found it. Running the tests." }, { k: "t", t: "Second paragraph." }, { k: "u", n: "Bash" },
    { k: "u", n: "Bash" }, { k: "t", t: "Fixed the rounding." }, { k: "d", ms: 1000, ts: "2026-11-01T09:01:00.000Z" },
  ];
  for (const e of ev) apply(s, e);
  const t = s.turns[0];
  expect(t.steps).toEqual([
    { k: "text", t: "Looking at the cart.", cut: false }, { k: "group", calls: ["Read", "Grep"], count: 2 },
    { k: "text", t: "Found it. Running the tests.\n\nSecond paragraph.", cut: false }, { k: "group", calls: ["Bash", "Bash"], count: 2 },
  ]);
  expect(reply(t)).toBe("Fixed the rounding.");
  // Caps: a long text keeps STEP_TEXT characters, a long group STEP_CALLS names and its count.
  const s2 = newSession("00000000-0000-4000-8000-0000000000ab", "/y.jsonl");
  apply(s2, { k: "p", o: "human", t: "Big", ts: "2026-11-01T09:00:00.000Z" });
  apply(s2, { k: "t", t: "x".repeat(STEP_TEXT + 50) });
  for (let i = 0; i < STEP_CALLS + 5; i++) apply(s2, { k: "u", n: "Bash" });
  const b = s2.turns[0].steps;
  expect(b[0].t.length).toBe(STEP_TEXT);
  expect(b[0].cut).toBe(true);
  expect(b[1].calls.length).toBe(STEP_CALLS);
  expect(b[1].count).toBe(STEP_CALLS + 5);
  // Past STEP_MAX steps, text is dropped and counted, and calls join the last group.
  for (let i = 0; i < STEP_MAX; i++) { apply(s2, { k: "t", t: `step ${i}` }); apply(s2, { k: "u", n: "Read" }); }
  const c = s2.turns[0];
  expect(c.steps.length).toBeLessThanOrEqual(STEP_MAX + 1);
  expect(c.stepsDropped).toBeGreaterThan(0);
  expect(c.steps.at(-1).k).toBe("group");
  expect(c.tools).toBe(STEP_CALLS + 5 + STEP_MAX);
});

test("subagent states: the launch result and the task notification, read from the session file", () => {
  const file = made("--subagents");
  const ev = events(file);
  const r = ev.filter((e) => e.k === "r");
  const n = ev.filter((e) => e.k === "n");
  expect(r.map((e) => [e.st, e.m])).toEqual([["async_launched", "claude-opus-5-5"], ["async_launched", "claude-opus-5-5"], ["async_launched", "claude-sonnet-5-5"]]);
  expect(r.every((e) => /^toolu_/.test(e.id) && /^a\d{16}$/.test(e.a))).toBe(true);
  // Two from user lines and one queued, by agent id, with the usage block's time and tokens.
  expect(n.map((e) => [e.a, e.st, e.ms, e.tok])).toEqual([[r[0].a, "completed", 48000, 21000], [r[1].a, "completed", 61000, 18500], [r[2].a, "failed", 12000, 4000]]);
  const s = newSession("00000000-0000-4000-8000-000000000002", file);
  for (const e of ev) apply(s, e);
  expect(r.map((e) => s.agents.get(e.id)).map((a) => [a.st, a.ms, a.m])).toEqual([["completed", 48000, "claude-opus-5-5"], ["completed", 61000, "claude-opus-5-5"], ["failed", 12000, "claude-sonnet-5-5"]]);
  // Notifications that only settle this turn's subagents while it works are not background
  // updates.
  const turn = s.turns.find((t) => t.prompt.startsWith("Review the calendar code"));
  expect(turn.followups).toBe(0);
});

test("subagent states: running until its notification; a notification read first is kept; others are not subagents", () => {
  const s = newSession("00000000-0000-4000-8000-00000000000c", "x.jsonl");
  apply(s, { k: "p", o: "human", t: "Review it", ts: "2026-11-01T09:00:00.000Z" });
  apply(s, { k: "u", n: "Agent", id: "toolu_1" });
  apply(s, { k: "r", id: "toolu_1", a: "a1", m: "claude-opus-4-7", st: "async_launched" });
  expect(s.agents.get("toolu_1").st).toBe("running");
  // A background command's notification: kept by its id, not a subagent of any call.
  apply(s, { k: "n", a: "b9", st: "completed" });
  apply(s, { k: "p", o: "task-notification", t: null, ts: "2026-11-01T09:01:00.000Z" });
  expect(s.turns[0].followups).toBe(1);
  // Settled while the turn works: not counted.
  apply(s, { k: "n", a: "a1", st: "completed", ms: 30000, tok: 9000 });
  apply(s, { k: "p", o: "task-notification", t: null, ts: "2026-11-01T09:02:00.000Z" });
  expect(s.agents.get("toolu_1")).toMatchObject({ st: "completed", ms: 30000, tok: 9000 });
  expect(s.turns[0].followups).toBe(1);
  apply(s, { k: "t", t: "Done." });
  apply(s, { k: "d", ms: 120000, ts: "2026-11-01T09:03:00.000Z" });
  // A notification read before its launch result keeps its state.
  apply(s, { k: "p", o: "human", t: "Again", ts: "2026-11-01T09:04:00.000Z" });
  apply(s, { k: "u", n: "Agent", id: "toolu_2" });
  apply(s, { k: "n", a: "a2", st: "failed", ms: 5000 });
  apply(s, { k: "r", id: "toolu_2", a: "a2", m: null, st: "async_launched" });
  expect(s.agents.get("toolu_2")).toMatchObject({ st: "failed", ms: 5000 });
});

test("subagent calls make a step group of their own, apart from the commands around them", async () => {
  const { readFileSync } = await import("node:fs");
  const { AGENT_CALL } = await import("../mods/agent-threads/ui.js");
  // turns.js keeps its own copy of ui.js's pattern: the two must be the same.
  expect(readFileSync(new URL("../mods/agent-threads/core/turns.js", import.meta.url), "utf8")).toContain(`const AGENT_CALL = ${AGENT_CALL};`);
  const s = newSession("00000000-0000-4000-8000-00000000000b", "x.jsonl");
  apply(s, { k: "p", o: "human", t: "Check the calendar code", ts: "2026-11-01T09:00:00.000Z" });
  for (const n of ["Bash", "Read", "Agent", "Agent", "Agent", "Bash", "TaskCreate", "Task"]) apply(s, { k: "u", n, id: `toolu_${n}` });
  const groups = s.turns[0].steps.filter((x) => x.k === "group");
  expect(groups.map((g) => [g.calls, Boolean(g.agent)])).toEqual([
    [["Bash", "Read"], false], [["Agent", "Agent", "Agent"], true], [["Bash", "TaskCreate"], false], [["Task"], true],
  ]);
  expect(groups.map((g) => g.count)).toEqual([2, 3, 2, 1]);
});

test("a turn's version moves only when an event may change it", () => {
  const s = newSession("s", "f");
  const ts = (n) => `2026-11-01T09:00:0${n}.000Z`;
  for (const e of [{ k: "p", o: "human", t: "one", ts: ts(1) }, { k: "t", t: "First." }, { k: "s", ts: ts(2) },
    { k: "p", o: "human", t: "two", ts: ts(3) }]) apply(s, e);
  const [t1, t2] = s.turns;
  const v1 = t1.v;
  const v2 = t2.v;
  apply(s, { k: "t", t: "Second." });
  expect(t1.v).toBe(v1);
  expect(t2.v).toBeGreaterThan(v2);
  // A title or a context line changes no turn.
  const v3 = t2.v;
  apply(s, { k: "title", t: "A title" });
  expect(t2.v).toBe(v3);
  apply(s, { k: "s", ts: ts(4) });
  expect(t2.v).toBeGreaterThan(v3);
  expect(t1.v).toBe(v1);
});

test("sessionStats: the status line's sums over a session, and nothing for what no turn recorded", () => {
  // Two turns with usage, as Claude Code, Codex, OpenCode and Pi record it.
  const a = { tools: 3, usage: { m1: { i: 100, o: 50, cr: 0, cc: 900 }, m2: { i: 10, o: 40, cr: 1000, cc: 0 } } };
  const b = { tools: 2, usage: { m3: { i: 20, o: 30, cr: 1500, cc: 100 } } };
  const st = sessionStats([a, b]);
  expect(st.tools).toBe(5);
  // New input, cache writes and output, as the reply stats count tokens.
  expect(st.tokens).toBe(100 + 10 + 20 + 900 + 100 + 50 + 40 + 30);
  // Cache reads over the whole prompt: 2500 of 3630.
  expect(st.cachePct).toBe(68.8);
  // The newest response's prompt: its input, cache reads and cache writes.
  expect(st.context).toBe(20 + 1500 + 100);
  // Antigravity records no cache writes: the same sums, with writes 0.
  expect(sessionStats([{ tools: 1, usage: { s1: { i: 300, o: 20, cr: 700, cc: 0 } } }])).toEqual({ tools: 1, tokens: 320, cachePct: 70, context: 1000, contextPct: null });
  // Cursor records no tokens: tool calls only, and null for the rest, never 0.
  expect(sessionStats([{ tools: 4, usage: {} }, { tools: 1, usage: {} }])).toEqual({ tools: 5, tokens: null, cachePct: null, context: null, contextPct: null });
  expect(sessionStats([])).toEqual({ tools: 0, tokens: null, cachePct: null, context: null, contextPct: null });
  // A turn with no usage after one with usage leaves the context at the last response.
  expect(sessionStats([b, { tools: 0, usage: {} }]).context).toBe(1620);
});
