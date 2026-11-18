// bun test: sender rules (settings.js parseSenders) and how the reader marks a typed prompt
// with them (core/turns.js ruleSender, markTurn, remarkSenders). Every name and message here
// is made up.
import { test, expect, mock } from "bun:test";

mock.module("herdr", () => ({ writeTextFile: async () => null }));
const { parseSenders, parseExtras } = await import("../mods/agent-threads/settings.js");
const { newSession, apply, ruleSender, remarkSenders, RULE_TEXT } = await import("../mods/agent-threads/core/turns.js");

const HOURLY = "build-bot hourly 2026-11-18T01:47:20Z: 3 merged, open 32; nothing needs you.";
const FROM = "From release-checker: two links in the changelog are dead";
const at = (m) => `2026-11-18T09:${String(m).padStart(2, "0")}:00.000Z`;
const peer = (text) => `<teammate-message teammate_id="helper-a" color="blue" summary="x">${text}</teammate-message>`;

// A session of typed prompts, each with a reply, read with the rules given.
function session(prompts, rules = null) {
  const s = newSession("s", "f.jsonl");
  if (rules) s.senders = rules;
  prompts.forEach((p, i) => {
    apply(s, { k: "p", o: "human", ts: at(2 * i), ...(typeof p === "string" ? { t: p } : p) });
    apply(s, { k: "t", t: `Reply ${i + 1}.` });
    apply(s, { k: "d", ms: 500, ts: at(2 * i + 1) });
  });
  return s;
}

test("a prefix rule: the hourly shape and the From shape name the sender", () => {
  const { rules, notes } = parseSenders([{ name: "Hourly report", prefix: "{name} hourly" }, { prefix: "From {name}:" }]);
  expect(notes).toEqual([]);
  expect(rules.map((r) => [r.n, r.label, r.named])).toEqual([[1, "Hourly report", true], [2, "From {name}:", true]]);
  expect(ruleSender(rules, HOURLY)).toEqual({ kind: "peer", name: "build-bot", rule: 1, ruleLabel: "Hourly report" });
  expect(ruleSender(rules, FROM)).toEqual({ kind: "peer", name: "release-checker", rule: 2, ruleLabel: "From {name}:" });
  // Leading space is skipped; the prefix is literal and case-sensitive, at the start only.
  expect(ruleSender(rules, "  From ci-watch: green")?.name).toBe("ci-watch");
  expect(ruleSender(rules, "from ci-watch: green")).toBe(null);
  expect(ruleSender(rules, "I heard From ci-watch: green")).toBe(null);
  expect(ruleSender(rules, "Fix the hourly job")).toBe(null);
  // Regex characters in a prefix are literal.
  const [br] = parseSenders([{ prefix: "[{name}] " }]).rules;
  expect(ruleSender([br], "[deploy-bot] staging is up")?.name).toBe("deploy-bot");
  expect(ruleSender([br], "deploy-bot staging is up")).toBe(null);
  // {name} at the end runs to a space or the end; a prefix without {name} gives no name.
  const [end] = parseSenders([{ prefix: "Report by {name}" }]).rules;
  expect(ruleSender([end], "Report by night-owl all quiet")?.name).toBe("night-owl");
  const [plain] = parseSenders([{ prefix: "[bot] " }]).rules;
  expect(plain.named).toBe(false);
  expect(ruleSender([plain], "[bot] nightly done")).toEqual({ kind: "peer", rule: 1, ruleLabel: "[bot] " });
});

test("a regular expression rule with a named group sender", () => {
  const { rules, notes } = parseSenders([{ name: "Bracket", pattern: "^\\[(?<sender>[a-z-]+)\\] " }]);
  expect(notes).toEqual([]);
  expect(ruleSender(rules, "[docs-bot] the guide builds again")).toEqual({ kind: "peer", name: "docs-bot", rule: 1, ruleLabel: "Bracket" });
  expect(ruleSender(rules, "[Docs-Bot] the guide builds again")).toBe(null);
  // A rule sees the first line only, and only RULE_TEXT characters of it.
  expect(ruleSender(rules, "Please look at this:\n[docs-bot] the guide builds again")).toBe(null);
  const [far] = parseSenders([{ pattern: "tail-(?<sender>\\w+)$" }]).rules;
  expect(ruleSender([far], `${"x".repeat(RULE_TEXT + 10)} tail-bot`)).toBe(null);
  expect(ruleSender([far], "short tail-bot")?.name).toBe("bot");
  // The first rule that matches wins.
  const two = parseSenders([{ prefix: "From {name}:" }, { pattern: "^From (?<sender>\\w+)" }]).rules;
  expect(ruleSender(two, FROM).rule).toBe(1);
});

test("rules that are not valid are dropped with a note naming each one", () => {
  const { rules, notes } = parseSenders([
    { prefix: "From {name}:", pattern: "^x(?<sender>y)" },
    { name: "nothing" },
    "From {name}:",
    { prefix: "{name}" },
    { prefix: "{name} to {name}:" },
    { pattern: "^From (\\w+):" },
    { pattern: "^(?<sender>[a-z" },
    { pattern: "^(?<sender>(a+)+)!" },
    { pattern: "(?<sender>\\w*)" },
    { pattern: "^(?<sender>\\w+) \\1" },
    { prefix: "x".repeat(101) },
    { prefix: "From {name}:" },
  ]);
  expect(notes).toEqual([
    "Sender rule 1: has both a prefix and a pattern; use one",
    "Sender rule 2: no prefix or pattern",
    "Sender rule 3: not an object",
    "Sender rule 4: prefix needs 2 characters or more besides {name}",
    "Sender rule 5: {name} more than once",
    "Sender rule 6: pattern has no (?<sender>...) group",
    "Sender rule 7: pattern not valid",
    "Sender rule 8: nested quantifier, as in (a+)+",
    "Sender rule 9: pattern matches empty text",
    "Sender rule 10: backreferences are not allowed",
    "Sender rule 11: prefix over 100 characters",
  ]);
  expect(rules.map((r) => r.n)).toEqual([12]);
  expect(parseSenders({ prefix: "From {name}:" }).notes).toEqual(["senders is not a list; no sender rules"]);
  const many = parseSenders(Array.from({ length: 21 }, (_, i) => ({ prefix: `R${i} {name}:` })));
  expect(many.rules.length).toBe(20);
  expect(many.notes).toEqual(["Sender rule 21: past the 20th rule; ignored"]);
  // The settings file: the notes join the link rules' notes, and the count is of every rule.
  const x = parseExtras(JSON.stringify({ senders: [{ prefix: "From {name}:" }, { pattern: "nope" }] }));
  expect(x.senders.length).toBe(1);
  expect(x.senderCount).toBe(2);
  expect(x.notes).toEqual(["Sender rule 2: pattern has no (?<sender>...) group"]);
});

test("no rules: nothing ships on, and a session reads exactly as before", () => {
  expect(parseExtras("{}").senders).toEqual([]);
  expect(parseExtras(null).senderCount).toBe(0);
  const prompts = [HOURLY, FROM, "[docs-bot] the guide builds again", "Rename the cart helper"];
  const plain = session(prompts);
  const none = session(prompts, []);
  expect(none.turns).toEqual(plain.turns);
  expect(plain.turns.every((t) => !t.agent && t.sender.kind === "you")).toBe(true);
  // Marking again with no rules changes no turn and leaves the version alone.
  const v = plain.version;
  expect(remarkSenders(plain, [])).toBe(prompts.length);
  expect(plain.version).toBe(v);
  expect(plain.turns.every((t) => !t.agent)).toBe(true);
});

test("the reader marks typed prompts only: never a command, an hc report or a peer message", () => {
  const { rules } = parseSenders([{ prefix: "From {name}:" }]);
  const s = session([
    FROM,
    { t: "/review From release-checker: x", cmd: true },
    { t: '<hc from="t7 review">From release-checker: two bugs</hc>' },
    { o: "peer", t: peer("From release-checker: done") },
    "Rename the cart helper",
  ], rules);
  const [typed, cmd, hc, msg, own] = s.turns;
  expect(typed).toMatchObject({ agent: true, sender: { kind: "peer", name: "release-checker", rule: 1 } });
  // The prompt itself is kept as written.
  expect(typed.prompt).toBe(FROM);
  expect(cmd).toMatchObject({ agent: false, sender: { kind: "you" } });
  expect(hc.sender).toEqual({ kind: "hc", name: "t7 review" });
  expect(msg.sender).toEqual({ kind: "peer", name: "helper-a" });
  expect(own).toMatchObject({ agent: false, sender: { kind: "you" } });
});

test("new rules mark a session already read again, and each changed turn takes a new version", () => {
  const s = session([HOURLY, "Rename the cart helper", FROM]);
  const before = s.turns.map((t) => t.v);
  const v0 = s.version;
  const { rules } = parseSenders([{ prefix: "From {name}:" }]);
  expect(remarkSenders(s, rules)).toBe(3);
  expect(s.senders).toBe(rules);
  expect(s.version).toBe(v0 + 1);
  expect(s.turns.map((t) => t.agent)).toEqual([false, false, true]);
  expect(s.turns.map((t) => t.v)).toEqual([before[0], before[1], v0 + 1]);
  // Another rule set: the hourly turn becomes an agent message, the From turn is the
  // person's again.
  const hourly = parseSenders([{ prefix: "{name} hourly" }]).rules;
  remarkSenders(s, hourly);
  expect(s.turns.map((t) => t.agent)).toEqual([true, false, false]);
  expect(s.turns[2].sender).toEqual({ kind: "you" });
  expect(s.turns[0].v).toBe(v0 + 2);
  expect(s.turns[2].v).toBe(v0 + 2);
  expect(s.turns[1].v).toBe(before[1]);
  // A prompt read after the change is marked as it is read.
  apply(s, { k: "p", o: "human", t: "night-owl hourly 2026-11-18T02:00:00Z: quiet", ts: at(30) });
  expect(s.turns[3]).toMatchObject({ agent: true, sender: { name: "night-owl", rule: 1 } });
  // In slices: a deadline already past stops after 64 turns, and the next call goes on.
  const big = session(Array.from({ length: 150 }, (_, i) => (i % 2 ? FROM : `Question ${i}`)));
  const i1 = remarkSenders(big, rules, 0, 0);
  expect(i1).toBe(64);
  const i2 = remarkSenders(big, rules, i1, 0);
  expect(i2).toBe(128);
  expect(remarkSenders(big, rules, i2)).toBe(150);
  expect(big.turns.filter((t) => t.agent).length).toBe(75);
});
