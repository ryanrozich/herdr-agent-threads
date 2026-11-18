// bun test: sender rules (settings.js parseSenders) and how the reader marks a typed prompt
// with them (core/turns.js ruleSender, markTurn, remarkSenders). Every name and message here
// is made up.
import { test, expect, mock } from "bun:test";

mock.module("herdr", () => ({ writeTextFile: async () => null }));
const { parseSenders, parseExtras, senderCost, SENDER_OPEN, SENDER_STEPS, SENDER_TOTAL } = await import("../mods/agent-threads/settings.js");
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
  // {name} at the end runs to a space or the end.
  const [end] = parseSenders([{ prefix: "Report by {name}" }]).rules;
  expect(ruleSender([end], "Report by night-owl all quiet")?.name).toBe("night-owl");
});

test("a prefix with no {name} is refused with a note: it would take every prompt that starts with it", () => {
  const { rules, notes } = parseSenders([{ prefix: "From:" }, { prefix: "ab" }, { prefix: "[bot] " }, { prefix: "From {name}:" }]);
  const why = "prefix has no {name}; it would mark every prompt that starts with it";
  expect(notes).toEqual([`Sender rule 1: ${why}`, `Sender rule 2: ${why}`, `Sender rule 3: ${why}`]);
  expect(rules.map((r) => r.n)).toEqual([4]);
  // Prompts that start with the refused prefixes stay the person's.
  for (const p of ["From: the release notes, trimmed", "ab testing plan for the cart", "[bot] nightly done"]) expect(ruleSender(rules, p)).toBe(null);
});

test("a pattern that is not valid says so, and only a real sender group counts", () => {
  const { notes } = parseSenders([{ pattern: "(" }, { pattern: "^(?<sender>\\w+" }, { pattern: "^\\(?<sender>x\\)" }, { pattern: "^[(?<sender>]x" }, { pattern: "^(?<senders>\\w+):" }]);
  expect(notes).toEqual([
    "Sender rule 1: pattern not valid",
    "Sender rule 2: pattern not valid",
    "Sender rule 3: pattern has no (?<sender>...) group",
    "Sender rule 4: pattern has no (?<sender>...) group",
    "Sender rule 5: pattern has no (?<sender>...) group",
  ]);
  // The group may sit in a branch or after other named groups.
  expect(parseSenders([{ pattern: "^(?:x|From (?<sender>[a-z-]+):)" }, { pattern: "^(?<k>\\d) (?<sender>[a-z-]+):" }]).notes).toEqual([]);
});

// The outside review's rules. Read as written on 300 characters, the first took about 4.9 s
// on one prompt of "x", 250 spaces and "!", and the @@ rule froze the pane for 6 s with the
// "@@" at character 200, past every early probe.
const STACKED = "(?<sender>\\w+)\\s*\\s*\\s*\\s*\\s*Z";
const AT_AT = "^(?<sender>\\w+)[^@]*@@\\s*\\s*\\s*\\s*\\s*\\s*\\s*Z";
const AT_AT_PROMPT = `x ${"a".repeat(200)}@@${" ".repeat(80)}`;
const openNote = (n) => `${n} open-ended repeats (*, + or {n,}); 3 at most`;
const TOO_LONG = "could take too long on a prompt (over a million steps on its first 100 characters): start it with ^, or use fewer repeats";

test("the outside review's slow rules are refused at load, with no clock read", () => {
  const clock = performance.now;
  let reads = 0;
  performance.now = () => { reads++; return clock.call(performance); };
  let got;
  try {
    got = parseSenders([
      { pattern: STACKED }, { pattern: `^${STACKED}` }, { pattern: AT_AT },
      // Stacked runs of other characters: hyphens, any character, accented and CJK classes.
      { pattern: "(?<sender>\\w+)-*-*-*-*-*Z" }, { pattern: "(?<sender>\\w+)[.]*[.]*[.]*[.]*[.]*Z" },
      { pattern: "(?<sender>\\w+).*.*.*.*.*Z" }, { pattern: "(?<sender>\\w+)[à-ÿ]*[à-ÿ]*[à-ÿ]*[à-ÿ]*[à-ÿ]*Z" },
      { pattern: "(?<sender>\\w+)[一-龥]*[一-龥]*[一-龥]*[一-龥]*[一-龥]*Z" },
      // The slow part in a lookahead after a late literal.
      { pattern: "^(?<sender>\\w+)(?=[^@]*@@\\s*\\s*\\s*\\s*\\s*Z)" },
      // An exponential the nested-repeat check does not see, and repeats with a bound that
      // are as slow as open ones on a short prompt.
      { pattern: "^(?<sender>\\w+)(?:\\w\\w?)+Z" },
      { pattern: `(?<sender>\\w)${"\\s?".repeat(40)}Z` },
      { pattern: "(?<sender>\\w)\\s{0,99}\\s{0,99}\\s{0,99}\\s{0,99}Z" },
    ]);
  } finally {
    performance.now = clock;
  }
  expect(got.notes).toEqual([
    `Sender rule 1: ${openNote(6)}`, `Sender rule 2: ${openNote(6)}`, `Sender rule 3: ${openNote(9)}`,
    `Sender rule 4: ${openNote(6)}`, `Sender rule 5: ${openNote(6)}`, `Sender rule 6: ${openNote(6)}`, `Sender rule 7: ${openNote(6)}`, `Sender rule 8: ${openNote(6)}`,
    `Sender rule 9: ${openNote(7)}`,
    `Sender rule 10: ${TOO_LONG}`,
    `Sender rule 11: ${TOO_LONG}`,
    `Sender rule 12: ${TOO_LONG}`,
  ]);
  expect(got.rules).toEqual([]);
  expect(reads).toBe(0);
});

test("four open-ended repeats are refused with a note that says so; three that stay cheap are kept", () => {
  expect(SENDER_OPEN).toBe(3);
  const { rules, notes } = parseSenders([
    { pattern: "^(?<sender>\\w+)[^@]*@@\\s*\\s*Z" },
    { pattern: "^(?<sender>[a-z]+)\\s+\\S+\\s{2,}Z" },
    { pattern: "^(?<sender>\\w+)[^@]*@@\\s*Z" },
  ]);
  expect(notes).toEqual([
    "Sender rule 1: 4 open-ended repeats (*, + or {n,}); 3 at most",
    "Sender rule 2: 4 open-ended repeats (*, + or {n,}); 3 at most",
  ]);
  expect(rules.map((r) => r.n)).toEqual([3]);
  // Three that may start anywhere cost a start for each character too, and are refused for
  // the steps; the same three held to the start are kept.
  expect(parseSenders([{ pattern: "(?<sender>\\s+)\\s*\\s*Z" }]).notes).toEqual([`Sender rule 1: ${TOO_LONG}`]);
  expect(parseSenders([{ pattern: "^(?<sender>\\s+)\\s*\\s*Z" }]).notes).toEqual([]);
});

test("the step count is an upper bound on the prompt's head, from the pattern alone", () => {
  expect(SENDER_STEPS).toBe(1e6);
  // A literal pattern held to the start: a step a character, nothing to try again.
  expect(senderCost("^From (?<sender>x):").steps).toBeLessThan(1000);
  // Each open-ended repeat that can take the same characters multiplies the ways to split
  // the text: two run in about RULE_TEXT squared, three in about its cube.
  const two = senderCost("^(?<sender>\\s+)\\s*Z").steps;
  const three = senderCost("^(?<sender>\\s+)\\s*\\s*Z").steps;
  expect(three / two).toBeGreaterThan(RULE_TEXT / 5);
  // The bound holds to the head: on a longer one the same pattern costs more.
  expect(senderCost("^(?<sender>\\s+)\\s*\\s*Z", 300).steps).toBeGreaterThan(SENDER_STEPS);
  // ? and a bounded count are repeats too: 2^k ways for k stacked \s?.
  expect(senderCost(`^(?<sender>\\w)${"\\s?".repeat(10)}Z`).steps).toBeGreaterThan(2 ** 10);
  expect(senderCost(`^(?<sender>\\w)${"\\s?".repeat(18)}Z`).steps).toBeLessThan(SENDER_STEPS);
  expect(senderCost(`^(?<sender>\\w)${"\\s?".repeat(19)}Z`).steps).toBeGreaterThan(SENDER_STEPS);
  // Open-ended repeats are counted inside groups and lookarounds too.
  expect(senderCost("^(?=a*)(?:b+|c*)(?<sender>d{2,})").open).toBe(4);
});

test("the rules together have a step budget, so one prompt costs a bounded time whatever the rules", () => {
  expect(SENDER_TOTAL).toBe(2e6);
  // Each of these is kept alone (under a million steps), but not twenty of them.
  const near = `^(?<sender>\\s)${"\\s?".repeat(18)}Z`;
  const one = senderCost(near).steps;
  expect(one).toBeLessThan(SENDER_STEPS);
  const { rules, notes } = parseSenders(Array.from({ length: 5 }, () => ({ pattern: near })));
  const fit = Math.floor(SENDER_TOTAL / one);
  expect(rules.map((r) => r.n)).toEqual(Array.from({ length: fit }, (_, k) => k + 1));
  expect(notes[0]).toBe(`Sender rule ${fit + 1}: the rules before it and this one could take over 2 million steps between them on a prompt; ignored`);
  // Plain rules use little of it: twenty seat-shaped rules all fit.
  const seats = parseSenders(Array.from({ length: 20 }, (_, k) => ({ pattern: `^From (?<sender>seat${k}|[a-z][a-z0-9]*-[a-z0-9-]*[a-z0-9]):` })));
  expect(seats.notes).toEqual([]);
  expect(seats.rules.length).toBe(20);
});

test("a rule sees the first RULE_TEXT characters of the prompt's first line, in one try a rule", () => {
  expect(RULE_TEXT).toBe(100);
  const seen = [];
  const rule = { n: 1, label: "Spy", re: /^(?<sender>[a-z-]+) hourly/, named: true };
  const exec = rule.re.exec.bind(rule.re);
  rule.re.exec = (t) => { seen.push(t.length); return exec(t); };
  const clock = performance.now;
  let reads = 0;
  performance.now = () => { reads++; return clock.call(performance); };
  try {
    expect(ruleSender([rule], `   seat-one hourly ${"x".repeat(400)}`)?.name).toBe("seat-one");
    expect(ruleSender([rule], `${" ".repeat(250)}seat-one hourly`)).toBe(null);
    expect(ruleSender([rule], "seat-one\nhourly")).toBe(null);
    // The review's @@ prompt: the "@@" at character 200 is past the head.
    expect(ruleSender([rule], AT_AT_PROMPT)).toBe(null);
  } finally {
    performance.now = clock;
  }
  // One call a prompt, never on growing slices: the head after leading spaces (RULE_TEXT),
  // only RULE_TEXT spaces skipped, and the first line only.
  expect(seen).toEqual([100, 100, 8, 100]);
  expect(reads).toBe(0);
  // Nothing on the rule changes with use, so a rule that loads keeps running.
  expect(Object.keys(rule).sort()).toEqual(["label", "n", "named", "re"]);
  // A seat name of 60 characters still fits with " hourly " and a timestamp to the second.
  const long = `seat-${"a".repeat(55)}`;
  const { rules } = parseSenders([{ name: "Hourly report", prefix: "{name} hourly" }, { pattern: "^(?<sender>[a-z][a-z0-9]*-[a-z0-9-]*[a-z0-9]) hourly \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z" }]);
  expect(ruleSender([rules[1]], `${long} hourly 2026-11-18T01:47:20Z: 3 merged`)?.name).toBe(long);
  expect(ruleSender([rules[0]], `${long} hourly 2026-11-18T01:47:20Z: 3 merged`)?.name).toBe(long);
});

// The rules the PR body offers for an owner's own seats, with made-up seat names: relay, and
// lower-case names with a hyphen. "From {name}:" would take the person's own "From scratch:".
const SEATS = [
  { name: "Seat message", pattern: "^From (?<sender>relay|[a-z][a-z0-9]*-[a-z0-9-]*[a-z0-9]):" },
  { name: "Hourly seat report", pattern: "^(?<sender>relay|[a-z][a-z0-9]*-[a-z0-9-]*[a-z0-9]) hourly \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}" },
];

test("seat rules: only a seat's name marks a prompt, never the person's own From and hourly wording", () => {
  const x = parseExtras(JSON.stringify({ senders: SEATS }));
  expect(x.notes).toEqual([]);
  expect(x.senders.length).toBe(2);
  const who = (p) => ruleSender(x.senders, p);
  for (const p of ["From scratch: rebuild it", "From here: keep going", "From now on, keep the changelog sorted", "From now: x", "fix the hourly job", "cron hourly 5 runs", "From Seat-One: x", "From seat-: x", "seat-one hourly report"]) {
    expect([p, who(p)]).toEqual([p, null]);
  }
  expect(who("From seat-one: hourly")).toEqual({ kind: "peer", name: "seat-one", rule: 1, ruleLabel: "Seat message" });
  expect(who("From relay: status")).toEqual({ kind: "peer", name: "relay", rule: 1, ruleLabel: "Seat message" });
  expect(who("From build-bot-2: merged")).toEqual({ kind: "peer", name: "build-bot-2", rule: 1, ruleLabel: "Seat message" });
  expect(who("build-bot-2 hourly 2026-11-18T05:00 report")).toEqual({ kind: "peer", name: "build-bot-2", rule: 2, ruleLabel: "Hourly seat report" });
  expect(who("relay hourly 2026-11-18T05:00")?.name).toBe("relay");
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
  // In slices: a deadline already past stops after each turn, and the next call goes on.
  const big = session(Array.from({ length: 150 }, (_, i) => (i % 2 ? FROM : `Question ${i}`)));
  const i1 = remarkSenders(big, rules, 0, 0);
  expect(i1).toBe(1);
  const i2 = remarkSenders(big, rules, i1, 0);
  expect(i2).toBe(2);
  expect(remarkSenders(big, rules, i2)).toBe(150);
  expect(big.turns.filter((t) => t.agent).length).toBe(75);
});
