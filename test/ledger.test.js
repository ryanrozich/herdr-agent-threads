// bun test: the Trajectory view's rows as data (ledger.js): a heading and a row per step of a
// turn, the start and duration cells, "?" for a time the transcript does not give, "no
// times" for a turn with none, failures, the bar's scale and the turn's line. The turns are
// made up here in the reader's shape (turns.js), as small as each case needs.
import { test, expect } from "bun:test";
import { ledgerTurn, headParts, ledgerTotals, ledgerCols, barFrac, durText, startText, coarse, LEDGER_KINDS, LEDGER_ROW, TRAJ_INKS, trajInks, laneOf, USER_COLOR, ALL_ROWS, filterOn, filterRows, passes } from "../mods/agent-threads/ledger.js";

const T0 = Date.parse("2026-11-01T09:00:00Z");
// A turn in the reader's shape: steps are [text] or [calls], each call [name, input, at, rt, failed].
function turn(n, steps, o = {}) {
  const out = [];
  for (const st of steps) {
    if (typeof st === "string") { out.push({ k: "text", t: st, at: o.untimed ? undefined : T0 + 1000 }); continue; }
    out.push({
      k: "group", calls: st.map((c) => c[0]), count: st.length, ids: st.map((_, i) => `call_${n}_${out.length}_${i}`),
      info: st.map(([, input, at, rt, f]) => ({ in: input, at: at == null ? null : T0 + at, rt: rt == null ? null : T0 + rt, f: f ?? null })),
      ...(o.agent ? { agent: true } : {}),
    });
  }
  return {
    n, prompt: o.prompt ?? `Prompt ${n}`, ts: T0, endTs: o.end === undefined ? T0 + 60000 : o.end, done: o.done ?? true,
    after: o.reply === null ? [] : [o.reply ?? "Done."], afterAt: o.untimed ? null : T0 + 55000, steps: out, usage: { m: { i: 100, o: 50, cr: 0, cc: 0 } },
    ...(o.interrupted ? { interrupted: true } : {}), ...(o.latest ? { latest: o.latest } : {}), ...(o.who ? { agent: true, sender: { kind: "peer", name: o.who } } : {}),
  };
}
const S = { agents: new Map(), agentIds: new Map() };

test("ledger: a turn is a heading keyed as the chat's turn, then a 24 px row per step in order", () => {
  const t = turn(3, ["Looking first.", [["Read", "src/a.ts", 2000, 2300], ["Bash", "bun test", 3000, 45000, true]]]);
  const { rows, fails, calls } = ledgerTurn(S, t, 0);
  expect(LEDGER_ROW).toBe(24);
  expect(rows[0]).toMatchObject({ kind: "trh", key: "0:3", n: 3, calls: 2, fails: 1, timed: true, total: 60000 });
  expect(rows.slice(1).map((r) => r.lk)).toEqual(["you", "text", "tool", "failed", "reply"]);
  expect(rows.slice(1).every((r) => r.kind === "tr" && r.key.startsWith("tr:0:3:") && r.si === 0 && r.turn === t)).toBe(true);
  expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  expect([fails, calls]).toEqual([1, 2]);
  // Words: the prompt's first line, the text's first line, a call's tool and input, the reply.
  expect(rows[1].text).toBe("Prompt 3");
  expect(rows[2].text).toBe("Looking first.");
  expect([rows[3].tool, rows[3].text]).toEqual(["Read", "src/a.ts"]);
  expect([rows[4].tool, rows[4].text, rows[4].status, rows[4].failed]).toEqual(["Bash", "bun test", "failed", true]);
  expect(rows[5].text).toBe("Done.");
  // Every kind a row can be has its look in the one table.
  for (const r of rows.slice(1)) expect(LEDGER_KINDS[r.lk]).toBeTruthy();
});

test("ledger times: the start from the turn's start, the duration, '?' for a time not given, none where a kind has none", () => {
  const t = turn(1, ["Thinking.", [["Read", "a", 2000, 2300], ["Grep", "b", null, 9000], ["Edit", "c", 12000, null]]]);
  const r = ledgerTurn(S, t, 0).rows;
  const cell = (x) => [x.start != null ? startText(x.start) : x.startQ ? "?" : "", x.dur != null ? durText(x.dur) : x.durQ ? "?" : ""];
  // The prompt starts at 0:00 and has no duration; a text starts and has none.
  expect(cell(r[1])).toEqual(["0:00", ""]);
  expect(cell(r[2])).toEqual(["0:01", ""]);
  expect(cell(r[3])).toEqual(["0:02", "0.3s"]);
  // A call with no start: "?" for the start and the duration, never 0 and never a neighbour's.
  expect(cell(r[4])).toEqual(["?", "?"]);
  // A call with no result time in a turn whose calls have them: "no result", no duration.
  expect([r[5].lk, r[5].status, ...cell(r[5])]).toEqual(["noresult", "no result", "0:12", ""]);
  // The reply: its start and how long it took to write (afterAt to the turn's end).
  expect(cell(r[6])).toEqual(["0:55", "5s"]);
  // Durations as the chat's calls show them.
  expect([durText(300), durText(42000), durText(372000), durText(3840000), durText(50)]).toEqual(["0.3s", "42s", "6m 12s", "1h 04m", "<0.1s"]);
});

test("ledger times: a turn with no step times leaves its cells empty and its heading says 'no times' once", () => {
  const t = turn(2, ["Thinking.", [["Read", "a", null, null], ["Bash", "b", null, null]]], { untimed: true });
  const { rows } = ledgerTurn(S, t, 0);
  expect(rows[0].timed).toBe(false);
  expect(rows[0].line).toBe(null);
  expect(headParts(rows[0]).total).toBe("no times");
  for (const r of rows.slice(1)) expect([r.start, r.dur, r.startQ, r.durQ]).toEqual([null, null, false, false]);
  // Calls of an agent that writes no result times are ordinary calls: the outcome is not recorded.
  expect(rows.filter((r) => r.lk === "tool").length).toBe(2);
  expect(rows.some((r) => r.lk === "noresult" || r.lk === "running")).toBe(false);
});

test("ledger: a running turn's open call says 'running'; an interrupted turn ends in an Interrupted row", () => {
  const live = turn(5, [[["Read", "a", 2000, 2500], ["Bash", "bun run e2e", 3000, null]]], { done: false, end: null, reply: null });
  const a = ledgerTurn(S, live, 0, true).rows;
  expect(a.slice(1).map((r) => r.lk)).toEqual(["you", "tool", "running"]);
  expect(a[3].status).toBe("running");
  expect(a[3].dur).toBe(null);
  expect(headParts(a[0]).total).toBe("running");
  const cut = turn(6, [[["Bash", "bun run e2e", 3000, null]]], { interrupted: true, reply: null, end: T0 + 40000 });
  const b = ledgerTurn(S, cut, 0).rows;
  expect(b.at(-1)).toMatchObject({ lk: "stop", text: "Interrupted", start: 40000 });
  expect(b[0].interrupted).toBe(true);
  expect(headParts(b[0]).total).toBe("interrupted");
});

test("ledger: an agent's message is marked apart from the person's, with its sender; a background update and calls past the limit are rows", () => {
  const t = turn(7, [[["Read", "a", 1000, 1200]]], { who: "planner", latest: "Build finished\nall green" });
  t.steps[0].count = 40; // 39 calls past the names the reader keeps
  const rows = ledgerTurn(S, t, 1).rows;
  expect(rows[1]).toMatchObject({ lk: "agent", sender: "planner" });
  expect(rows[0]).toMatchObject({ agent: true, key: "1:7", calls: 40 });
  expect(rows.find((r) => r.lk === "more").text).toBe("and 39 more calls");
  expect(rows.at(-1)).toMatchObject({ lk: "context", text: "Build finished", startQ: true });
});

test("ledger: a subagent call is one row with its run's time, state and tokens", () => {
  const t = turn(8, [[["Agent", "Review the range math", 2000, 3000]]], { agent: true });
  const id = t.steps[0].ids[0];
  const s = { agents: new Map([[id, { st: "completed", tok: 41000, ms: 48000 }]]), agentIds: new Map([["a1", id]]) };
  const r = ledgerTurn(s, t, 0).rows[2];
  expect(r).toMatchObject({ lk: "subagent", tool: "Agent", text: "Review the range math", dur: 48000, sub: { state: "completed", tokens: 41000 } });
});

test("ledger: a subagent whose run failed is a failed call (cross, wash, count, f); one stopped is not", () => {
  const t = turn(9, [[["Agent", "Audit the tests", 2000, 3000], ["Agent", "Check the docs", 2000, 3000]]], { agent: true });
  const [a, b] = t.steps[0].ids;
  const s = { agents: new Map([[a, { st: "failed", tok: 4000, ms: 9000 }], [b, { st: "killed", tok: 1000, ms: 2000 }]]), agentIds: new Map() };
  const { rows, fails } = ledgerTurn(s, t, 0);
  expect(rows[2]).toMatchObject({ lk: "failed", failed: true, tool: "Agent", text: "Audit the tests", status: "failed · 4k tok", sub: { state: "failed" } });
  expect(rows[3]).toMatchObject({ lk: "subagent", failed: false, sub: { state: "killed" } });
  expect([fails, rows[0].fails, ledgerTotals(rows).fails]).toEqual([1, 1, [rows[2].key]]);
});

test("ledger: calls past what the reader keeps make the failure count a floor ('1+ failed'), and their row says so", () => {
  const t = turn(10, [[["Bash", "bun test", 2000, 3000, true], ["Read", "a.ts", 3000, 3100]]]);
  t.steps[0].count = 250;
  const { rows } = ledgerTurn(S, t, 0);
  expect(rows[0]).toMatchObject({ fails: 1, partial: true });
  expect(headParts(rows[0], 600).failed).toBe("1+ failed");
  expect(rows.find((r) => r.lk === "more")).toMatchObject({ text: "and 248 more calls", status: "results not kept" });
  expect(ledgerTotals(rows).partial).toEqual([rows[0].key]);
  expect(headParts({ ...rows[0], partial: false }, 600).failed).toBe("1 failed");
});

test("ledger heading: '10 calls · 1 failed · 48.2k tok · 9m 44s'; narrow, tokens go first, then calls", () => {
  const h = { calls: 10, fails: 1, tokens: 48200, total: 584000, timed: true, going: false, interrupted: false };
  expect(Object.values(headParts(h, 600)).filter(Boolean).join(" · ")).toBe("10 calls · 1 failed · 48.2k tok · 9m 44s");
  expect(Object.values(headParts(h, 400)).filter(Boolean).join(" · ")).toBe("10 calls · 1 failed · 9m 44s");
  expect(Object.values(headParts(h, 300)).filter(Boolean).join(" · ")).toBe("1 failed · 9m 44s");
  // No failures: no failure part.
  expect(headParts({ ...h, fails: 0 }).failed).toBe(null);
});

test("ledger: the session's numbers in one place, with its failures in order", () => {
  const a = ledgerTurn(S, turn(1, [[["Bash", "x", 1000, 2000, true]]]), 0).rows;
  const b = ledgerTurn(S, turn(2, [[["Read", "y", 1000, 2000], ["Bash", "z", 3000, 4000, true]]]), 0).rows;
  const sums = ledgerTotals([{ kind: "spacer" }, ...a, ...b]);
  expect(sums).toMatchObject({ turns: 2, calls: 3, failed: 2 });
  expect(sums.fails).toEqual([a.find((r) => r.failed).key, b.find((r) => r.failed).key]);
  expect(sums.steps).toBe(a.length + b.length - 2);
});

test("ledger bars: one scale for the session, each step of ten the same length, 0.1 s to an hour", () => {
  const step = barFrac(1000) - barFrac(100);
  expect(barFrac(10000) - barFrac(1000)).toBeCloseTo(step, 6);
  expect(barFrac(3600000)).toBe(1);
  expect(barFrac(7200000)).toBe(1);
  // A step under a tenth of a second is the shortest bar, never none.
  expect(barFrac(5)).toBe(barFrac(100));
  expect(barFrac(5)).toBeGreaterThan(0);
  expect(barFrac(null)).toBe(0);
});

test("ledger line: the turn's clock with each call a stretch of it, failed ones apart, touching stretches joined", () => {
  const t = turn(4, [[["Read", "a", 6000, 12000], ["Grep", "b", 12000, 18000], ["Bash", "c", 30000, 36000, true]]]);
  const { line } = ledgerTurn(S, t, 0).rows[0];
  expect(line.tools).toEqual([[0.1, 0.3]]);
  expect(line.red).toEqual([[0.5, 0.6]]);
  // The reply is the model's stretch of the line (from its first word to the turn's end).
  expect(line.model.length).toBe(1);
  expect(line.sub).toEqual([]);
  // A call of a few ms still shows.
  const quick = ledgerTurn(S, turn(9, [[["Read", "a", 6000, 6001]]]), 0).rows[0].line.tools[0];
  expect(quick[1] - quick[0]).toBeGreaterThan(0.005);
  // Drawn as elements, at most n stretches, the closest joined first.
  expect(coarse([[0, 0.1], [0.11, 0.2], [0.5, 0.6], [0.9, 1]], 3)).toEqual([[0, 0.2], [0.5, 0.6], [0.9, 1]]);
});

test("ledger columns: the bar from 500 px, the start from 420 px; the duration always", () => {
  expect(ledgerCols(573)).toEqual({ bar: true, start: true, words: true });
  expect(ledgerCols(420)).toEqual({ bar: false, start: true, words: true });
  expect(ledgerCols(340)).toEqual({ bar: false, start: false, words: false });
});

test("ledger inks: the user blue, agents amber, the model violet, tools teal, as tints; plain is the text colour", () => {
  expect(USER_COLOR).toBe("blue");
  expect(TRAJ_INKS.user).toEqual({ light: "#2563EB", dark: "#7BA2FF" });
  const th = { foreground: "#e8e8ec", dim: "#878c96", blocked: "#f0746a" };
  const dark = trajInks(th, true);
  expect([dark.user, dark.agent, dark.model, dark.tools]).toEqual(["#7BA2FF", "#CC9A5E", "#C49BEE", "#5DBCAA"]);
  expect([dark.context, dark.failed, dark.plain]).toEqual([th.dim, th.blocked, false]);
  expect(trajInks(th, false).user).toBe("#2563EB");
  const plain = trajInks(th, true, "plain");
  expect([plain.user, plain.plain]).toEqual([th.foreground, true]);
  // Every kind has an ink, a tag and a lane (Interrupted has none); the user's tag says User.
  for (const k of Object.values(LEDGER_KINDS)) expect(typeof k.ink === "string" && typeof k.tag === "string").toBe(true);
  expect([LEDGER_KINDS.you.tag, LEDGER_KINDS.you.label, LEDGER_KINDS.you.ink]).toEqual(["User", "User message", "user"]);
  expect(["you", "agent", "context", "text", "reply", "tool", "failed", "subagent", "stop"].map(laneOf))
    .toEqual(["input", "input", "input", "model", "model", "tools", "tools", "tools", null]);
});

test("ledger totals: the whole session's lanes, the user's and agents' messages, tokens and time worked", () => {
  const a = ledgerTurn(S, turn(1, ["Looking.", [["Bash", "x", 1000, 2000, true]]]), 0).rows;
  const b = ledgerTurn(S, turn(2, [[["Read", "y", 1000, 2000]]], { who: "reviewer" }), 0).rows;
  const t = ledgerTotals([...a, ...b]);
  expect(t).toMatchObject({ turns: 2, input: 2, model: 3, tools: 2, user: 1, agent: 1, failed: 1, worked: 120000 });
  expect(t.users).toEqual([a.find((r) => r.lk === "you").key]);
  expect(t.heads.map((h) => h.key)).toEqual(["0:1", "0:2"]);
  expect(t.tokens).toBe(a[0].tokens + b[0].tokens);
});

test("ledger filters: the lane chips take rows out, Failed only and User only list one kind, a heading only with a row listed", () => {
  const a = ledgerTurn(S, turn(1, ["Looking.", [["Bash", "x", 1000, 2000, true]]]), 0).rows;
  const b = ledgerTurn(S, turn(2, [[["Read", "y", 1000, 2000]]]), 0).rows;
  const rows = [...a, { kind: "divider", key: "d" }, ...b];
  const sizes = rows.map(() => 24);
  expect(filterOn(ALL_ROWS)).toBe(false);
  expect(filterRows(rows, sizes, ALL_ROWS).rows).toEqual(rows);
  const failed = filterRows(rows, sizes, { ...ALL_ROWS, failed: true });
  expect(failed.rows.map((r) => r.key)).toEqual(["0:1", a.find((r) => r.failed).key, "d"]);
  expect(failed.n).toBe(1);
  const user = filterRows(rows, sizes, { ...ALL_ROWS, user: true });
  expect(user.rows.filter((r) => r.kind === "tr").every((r) => r.lk === "you")).toBe(true);
  expect(user.rows.filter((r) => r.kind === "trh").length).toBe(2);
  const noTools = filterRows(rows, sizes, { ...ALL_ROWS, tools: false });
  expect(noTools.rows.some((r) => laneOf(r.lk) === "tools")).toBe(false);
  expect(noTools.sizes.length).toBe(noTools.rows.length);
  expect(passes({ kind: "tr", lk: "stop" }, { ...ALL_ROWS, tools: false, model: false, input: false })).toBe(true);
});
