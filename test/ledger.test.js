// bun test: the Trajectory pane's rows as data (ledger.js): a heading and a row per step of a
// turn, the start and duration cells, blank for a time the transcript does not give, "no
// times" for a turn with none, failures, the bar's scale, the turn's line, the filters, the
// detail, the status line and the running rule. The turns are made up here in the reader's
// shape (turns.js), as small as each case needs.
import { test, expect } from "bun:test";
import {
  ledgerTurn, headParts, ledgerTotals, ledgerCols, barFrac, durText, startText, coarse, LEDGER_KINDS, LEDGER_ROW, LEDGER_HEAD, TRAJ_INKS, trajInks,
  trajCompact, compactRow,
  laneOf, USER_COLOR, ALL_ROWS, filterOn, filterRows, passes, detailOf, turnRunning, filterButtons, toggleFilter, ledgerStatus, slantPoints,
  BAR_W, BAR_H, BAR_SLANT, LINE_SLANT, sessionHasEnds, rowTimes,
  trajLayout, rowsLeft, DOCK_SIDE_MIN, DOCK_LIST_MAX, DOCK_DETAIL_MIN,
} from "../mods/agent-threads/ledger.js";
import { fmtTime } from "../mods/agent-threads/core/turns.js";

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

test("ledger times: the start from the turn's start, the duration, blank for a time not given (the detail says not recorded), none where a kind has none", () => {
  const t = turn(1, ["Thinking.", [["Read", "a", 2000, 2300], ["Grep", "b", null, 9000], ["Edit", "c", 12000, null]]]);
  const r = ledgerTurn(S, t, 0).rows;
  const cell = (x) => [rowTimes(x).start, rowTimes(x).dur];
  // The prompt starts at 0:00 and has no duration; a text starts and has none.
  expect(cell(r[1])).toEqual(["0:00", ""]);
  expect(cell(r[2])).toEqual(["0:01", ""]);
  expect(cell(r[3])).toEqual(["0:02", "0.3s"]);
  // A call with no start: blank start and duration, never 0 and never a neighbour's, and no
  // "?" either: the detail says neither was recorded.
  expect(cell(r[4])).toEqual(["", ""]);
  expect(detailOf(r[4]).fields).toContainEqual(["Started", "not recorded"]);
  expect(detailOf(r[4]).fields).toContainEqual(["Took", "not recorded"]);
  expect(detailOf(r[4]).fields).toContainEqual(["Result", "not recorded"]);
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

test("ledger: a background update's row starts when its text began, on either reader's path; with no time it is blank, never ?", () => {
  // The Chat's reader keeps the latest update and when its first text came (latestAt).
  const t = turn(22, [[["Read", "a", 1000, 1200]]], { latest: "Build finished" });
  t.latestAt = T0 + 70000;
  const row = (x) => ledgerTurn(S, x, 0).rows.find((r) => r.lk === "context");
  expect(row(t)).toMatchObject({ start: 70000, startQ: false });
  expect(rowTimes(row(t))).toMatchObject({ start: startText(70000), dur: "" });
  expect(detailOf(row(t)).fields).toContainEqual(["Started", `${startText(70000)} into the turn`]);
  // The export's reader (keepWakes): each wake-up's last text, at its afterAt.
  const w = turn(23, [[["Read", "a", 1000, 1200]]]);
  w.wakes = [{ steps: [], after: ["Deploy done"], afterAt: T0 + 90000 }];
  expect(row(w)).toMatchObject({ text: "Deploy done", start: 90000 });
  // An update with no time recorded: blank, and the detail says so.
  const u = turn(24, [[["Read", "a", 1000, 1200]]], { latest: "Build finished" });
  expect(rowTimes(row(u)).start).toBe("");
  expect(detailOf(row(u)).fields).toContainEqual(["Started", "not recorded"]);
  // No "?" in any column or detail field of these turns.
  for (const x of [t, w, u, turn(25, [[["Grep", "b", null, null]]], { done: false, end: null, reply: null })]) {
    for (const r of ledgerTurn(S, x, 0).rows) {
      if (r.kind === "trh") continue;
      expect(`${rowTimes(r).start}|${rowTimes(r).dur}`).not.toContain("?");
      expect(JSON.stringify(detailOf(r).fields)).not.toContain("?");
    }
  }
  // A row with no turn number leaves the Turn field out.
  expect(detailOf({ ...row(t), turn: null }).fields.map((f) => f[0])).not.toContain("Turn");
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

test("ledger columns: the start from 420 px, the bar from 500, the filter bar from 540, the detail at the right from 900", () => {
  expect(ledgerCols(960)).toEqual({ start: true, bar: true, filters: true, detailRight: true });
  expect(ledgerCols(600)).toEqual({ start: true, bar: true, filters: true, detailRight: false });
  expect(ledgerCols(520)).toEqual({ start: true, bar: true, filters: false, detailRight: false });
  expect(ledgerCols(460)).toEqual({ start: true, bar: false, filters: false, detailRight: false });
  expect(ledgerCols(340)).toEqual({ start: false, bar: false, filters: false, detailRight: false });
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
    expect(filterOn(ALL_ROWS)).toBe(false);
  expect(filterRows(rows, ALL_ROWS).rows).toEqual(rows);
  const failed = filterRows(rows, { ...ALL_ROWS, failed: true });
  expect(failed.rows.map((r) => r.key)).toEqual(["0:1", a.find((r) => r.failed).key, "d"]);
  expect(failed.n).toBe(1);
  const user = filterRows(rows, { ...ALL_ROWS, user: true });
  expect(user.rows.filter((r) => r.kind === "tr").every((r) => r.lk === "you")).toBe(true);
  expect(user.rows.filter((r) => r.kind === "trh").length).toBe(2);
  const noTools = filterRows(rows, { ...ALL_ROWS, tools: false });
  expect(noTools.rows.some((r) => laneOf(r.lk) === "tools")).toBe(false);
  expect(passes({ kind: "tr", lk: "stop" }, { ...ALL_ROWS, tools: false, model: false, input: false })).toBe(true);
});

test("running rule: running only with a followed terminal, a live process and an open turn; Claude Code also needs working or blocked", () => {
  const ok = { followed: true, alive: true, open: true };
  expect(turnRunning(ok)).toBe(true);
  // Any one missing: unknown, never running.
  expect(turnRunning({ ...ok, followed: false })).toBe(false);
  expect(turnRunning({ ...ok, alive: false })).toBe(false);
  expect(turnRunning({ ...ok, open: false })).toBe(false);
  expect(turnRunning()).toBe(false);
  // Claude Code reports a status: only working or blocked (a turn waiting on an approval) count.
  expect(turnRunning({ ...ok, reports: true, status: "working" })).toBe(true);
  expect(turnRunning({ ...ok, reports: true, status: "blocked" })).toBe(true);
  for (const status of ["idle", "done", null]) expect(turnRunning({ ...ok, reports: true, status })).toBe(false);
  // Other agents never report one: a live process with no end record is the best evidence.
  expect(turnRunning({ ...ok, reports: false, status: null })).toBe(true);
});

test("ledger: a turn with no end record that is not running says 'no result' and the last activity, and never 'running'", () => {
  const t = turn(11, [[["Read", "a", 2000, 2500], ["Bash", "bun run e2e", 3000, null]]], { done: false, end: null, reply: null });
  const { rows } = ledgerTurn(S, t, 0, false);
  expect(rows.slice(1).map((r) => r.lk)).toEqual(["you", "tool", "noresult"]);
  expect(rows.some((r) => r.status === "running" || r.lk === "running")).toBe(false);
  // The last thing the transcript recorded: the open call's start, after the first call's end.
  expect(rows[0]).toMatchObject({ stale: true, going: false, lastAt: T0 + 3000 });
  expect(headParts(rows[0]).total).toBe("no result");
  expect(rows[3]).toMatchObject({ status: "no result", lastAt: T0 + 3000, open: true });
  const d = detailOf(rows[3]);
  expect(d.fields).toContainEqual(["Result", "No result"]);
  expect(d.fields).toContainEqual(["Last activity", fmtTime(T0 + 3000)]);
  // Said once: Took is left out, Result says "No result".
  expect(d.fields.map(([k]) => k)).not.toContain("Took");
  expect(d.fields.filter(([, v]) => /no result/i.test(v))).toEqual([["Result", "No result"]]);
  expect(detailOf(rows[0]).fields).toContainEqual(["Last activity", fmtTime(T0 + 3000)]);
  expect(detailOf(rows[0]).fields.filter(([, v]) => /no result/i.test(v))).toEqual([["Result", "No result"]]);
  expect(detailOf(rows[0]).fields.map(([k]) => k)).not.toContain("Took");
  // The same turn while running: "running", no last activity.
  const live = ledgerTurn(S, t, 0, true).rows;
  expect(live[3]).toMatchObject({ lk: "running", status: "running" });
  expect(live[3].lastAt).toBeUndefined();
  expect(live[0]).toMatchObject({ stale: false, lastAt: null, going: true });
  expect(detailOf(live[3]).fields).toContainEqual(["Result", "Running, no result yet"]);
  // A turn that ended (done, or an end record) is never stale.
  expect(ledgerTurn(S, turn(12, [[["Bash", "x", 1000, null]]]), 0).rows[0].stale).toBe(false);
});

test("ledger: a message cell with no words (reasoning only, which the pane never reads) is no row; a withheld mark changes nothing", () => {
  const t = turn(13, ["Looking.", [["Read", "a", 2000, 2300]]]);
  const plain = ledgerTurn(S, t, 0).rows.map((r) => [r.lk, r.text]);
  const marked = { ...t, steps: [{ ...t.steps[0], r: "thinking", h: 2 }, { ...t.steps[1], r: "more thinking", h: 1 }], held: 1 };
  expect(ledgerTurn(S, marked, 0).rows.map((r) => [r.lk, r.text])).toEqual(plain);
  const onlyReason = { ...t, steps: [t.steps[1]], reasoning: ["why"], after: [] };
  expect(ledgerTurn(S, onlyReason, 0).rows.slice(1).map((r) => r.lk)).toEqual(["you", "tool"]);
});

test("ledger filters: the buttons say Failed and User, and from 900 px 'Failed only' and 'User only' with counts; one of the two at a time", () => {
  const t = { input: 6, model: 7, tools: 16, failed: 2, user: 3 };
  expect(filterButtons(t, 600).map((b) => [b.label, b.count])).toEqual([["Input", null], ["Model", null], ["Tools", null], ["Failed", null], ["User", null]]);
  expect(filterButtons(t, 960).map((b) => [b.label, b.count])).toEqual([["Input", 6], ["Model", 7], ["Tools", 16], ["Failed only", 2], ["User only", 3]]);
  // Until the first build is done: the wide labels, no counts.
  expect(filterButtons(t, 960, true).map((b) => [b.label, b.count])).toEqual([["Input", null], ["Model", null], ["Tools", null], ["Failed only", null], ["User only", null]]);
  let f = toggleFilter(ALL_ROWS, "tools");
  expect(f).toEqual({ ...ALL_ROWS, tools: false });
  f = toggleFilter(f, "failed");
  expect([f.failed, f.user]).toEqual([true, false]);
  f = toggleFilter(f, "user");
  expect([f.failed, f.user]).toEqual([false, true]);
  f = toggleFilter(toggleFilter(f, "user"), "tools");
  expect(filterOn(f)).toBe(false);
});

test("ledger status line: turns and steps, failed, tokens, time worked; time gives way under 540 px, tokens under 420", () => {
  const a = ledgerTurn(S, turn(1, ["Looking.", [["Bash", "x", 1000, 2000, true]]]), 0).rows;
  const t = ledgerTotals(a);
  const text = (w, going) => ledgerStatus(t, w, going).map((g) => g.text);
  expect(text(800)).toEqual(["1 turn · 4 steps", "1 failed", `${t.tokens} tokens`, "1m 00s worked"]);
  expect(text(800, true).at(-1)).toBe("1m 00s worked so far");
  expect(text(500)).toEqual(["1 turn · 4 steps", "1 failed", `${t.tokens} tokens`]);
  expect(text(400)).toEqual(["1 turn · 4 steps", "1 failed"]);
  expect(ledgerStatus({ ...t, failed: 0 }, 400).map((g) => g.key)).toEqual(["turns"]);
});

test("ledger: the last turn read so far of a session still being read claims no 'no result' and no last activity", () => {
  const t = turn(11, [[["Read", "a", 2000, 2500], ["Bash", "bun run e2e", 3000, null]]], { done: false, end: null, reply: null });
  const { rows } = ledgerTurn(S, t, 0, false, { reading: true });
  expect(rows.slice(1).map((r) => r.lk)).toEqual(["you", "tool", "tool"]);
  expect(rows[0]).toMatchObject({ stale: false, lastAt: null, reading: true });
  expect(rows.some((r) => r.lastAt != null || r.noResult || r.open)).toBe(false);
  expect(headParts(rows[0]).total).toBe(null);
  // Blank fields: the heading's Took, and the open call's Took and Result. The ended call keeps its own.
  expect(detailOf(rows[0]).fields).toContainEqual(["Took", ""]);
  expect(rows[3]).toMatchObject({ reading: true, status: null, dur: null, durQ: false });
  const f = Object.fromEntries(detailOf(rows[3]).fields);
  expect([f.Took, f.Result]).toEqual(["", ""]);
  expect(rows[2].reading).toBeUndefined();
  expect(Object.fromEntries(detailOf(rows[2]).fields).Result).toBe("ok");
  for (const r of rows) expect(detailOf(r).fields.some(([k, v]) => k === "Last activity" || /no result|not recorded/i.test(v))).toBe(false);
  // A subagent last seen running: no "no result" either.
  const a = turn(14, [[["Agent", "Audit the tests", 1000, 2000]], [["Agent", "Audit the docs", 3000, null]]], { done: false, end: null, reply: null, agent: true });
  const s = { agents: new Map([[a.steps[0].ids[0], { st: "running", tok: null, ms: null }], [a.steps[1].ids[0], { st: "running", tok: null, ms: null }]]), agentIds: new Map() };
  const subs = (o) => ledgerTurn(s, a, 0, false, o).rows.filter((r) => r.tool === "Agent");
  for (const sub of subs({ reading: true })) {
    expect(sub.noResult).toBeUndefined();
    expect(sub.lastAt).toBeUndefined();
    expect(sub.open).toBeUndefined();
  }
  // Not read in full is what holds them: read, the unfinished run is drawn open, with its last activity.
  expect(subs({})[1]).toMatchObject({ open: true, lastAt: T0 + 3000 });
  // Running wins: reading changes nothing for a live turn.
  expect(ledgerTurn(S, t, 0, true, { reading: true }).rows[3]).toMatchObject({ lk: "running", status: "running" });
  // Nor for a turn whose end is read: its call with no result has none.
  const ended = turn(12, [[["Read", "a", 2000, 2500], ["Bash", "bun run e2e", 3000, null]]]);
  expect(ledgerTurn(S, ended, 0, false, { reading: true }).rows[3]).toMatchObject({ lk: "noresult", status: "no result" });
  expect(ledgerTurn(S, ended, 0, false, { reading: true }).rows[0].reading).toBe(false);
});

test("ledger bars: 64 by 4 px; an unfinished call's bar ends in one 5 px slant, the heading line's in 4 px", () => {
  expect([BAR_W, BAR_H, BAR_SLANT, LINE_SLANT, LEDGER_HEAD]).toEqual([64, 4, 5, 4, 40]);
  expect(slantPoints(0, 64, 4, 5)).toEqual([[0, 0], [64, 0], [59, 4], [0, 4]]);
  // Narrower than the slant: a plain box.
  expect(slantPoints(10, 13, 3, 4)).toEqual([[10, 0], [13, 0], [13, 3], [10, 3]]);
});

test("ledger: a subagent last seen launched or running says so only in a running turn; else no result", () => {
  const t = turn(14, [[["Agent", "Audit the tests", 1000, 2000]]], { done: false, end: null, reply: null, agent: true });
  const s = { agents: new Map([[t.steps[0].ids[0], { st: "running", tok: null, ms: null }]]), agentIds: new Map() };
  const sub = (live) => ledgerTurn(s, t, 0, live).rows.find((r) => r.tool === "Agent");
  expect(sub(true).sub.state).toBe("running");
  expect(sub(true).noResult).toBeUndefined();
  expect(sub(false)).toMatchObject({ status: "no result", noResult: true, lastAt: T0 + 2000 });
  expect(sub(false).sub.state).toBeNull();
  expect(detailOf(sub(false)).fields).toContainEqual(["Result", "No result"]);
  expect(detailOf(sub(false)).fields).toContainEqual(["Last activity", fmtTime(T0 + 2000)]);
});

test("ledger: a dead turn killed during its only call says no result, when the agent writes result times", () => {
  // Nothing in this turn has a result: whether that means "no result" is the agent's way, not
  // the turn's (Claude Code, or a session with a result time anywhere).
  const t = turn(15, [[["Bash", "bun run e2e", 2000, null]]], { done: false, end: null, reply: null });
  const dead = ledgerTurn(S, t, 0, false, { ends: true }).rows;
  expect(dead[2]).toMatchObject({ lk: "noresult", status: "no result", open: true, lastAt: T0 + 2000 });
  expect(detailOf(dead[2]).fields).toContainEqual(["Result", "No result"]);
  expect(ledgerTurn(S, t, 0, true, { ends: true }).rows[2]).toMatchObject({ lk: "running", status: "running" });
  // Every call of a parallel batch pending, while live: each is running.
  const batch = turn(16, [[["Read", "a", 2000, null], ["Read", "b", 2000, null]]], { done: false, end: null, reply: null });
  expect(ledgerTurn(S, batch, 0, true, { ends: true }).rows.slice(2).map((r) => r.lk)).toEqual(["running", "running"]);
  // An agent that writes no result times: a call with no end is an ordinary row.
  expect(ledgerTurn(S, t, 0, false, { ends: false }).rows[2].lk).toBe("tool");
  // Left out, the session decides: any call in it with an end.
  const s = { ...S, turns: [turn(1, [[["Read", "a", 1000, 1200]]]), t] };
  expect(sessionHasEnds(s)).toBe(true);
  expect(sessionHasEnds({ ...S, turns: [t] })).toBe(false);
  expect(ledgerTurn(s, t, 0, false).rows[2].lk).toBe("noresult");
});

test("ledger detail: no result says 'interrupted' only for a turn marked so, with the last activity where it is known", () => {
  const field = (r, name) => detailOf(r).fields.find(([k]) => k === name)?.[1];
  // A done turn whose one call has no result: not interrupted.
  const done = turn(17, [[["Bash", "bun run e2e", 2000, null]], [["Read", "a", 5000, 5600]]], { end: T0 + 9000 });
  const d = ledgerTurn(S, done, 0, false, { ends: true }).rows.find((r) => r.lk === "noresult");
  expect(field(d, "Result")).toBe("No result");
  expect(field(d, "Last activity")).toBe(fmtTime(T0 + 9000));
  expect(field(d, "Took")).toBeUndefined();
  // A turn marked interrupted says so.
  const cut = turn(18, [[["Bash", "bun run e2e", 3000, null]]], { interrupted: true, reply: null, end: T0 + 40000 });
  const c = ledgerTurn(S, cut, 0, false, { ends: true }).rows.find((r) => r.lk === "noresult");
  expect(field(c, "Result")).toBe("No result: the turn was interrupted");
  // No detail says interrupted for a turn that was not.
  for (const r of ledgerTurn(S, done, 0, false, { ends: true }).rows) expect(JSON.stringify(detailOf(r).fields)).not.toContain("interrupted");
});

test("ledger rows: a row that says no result shows no duration, and its detail keeps the launch call's time", () => {
  // Three subagents launched in the background, then the turn was cut off: each launch took 2 s,
  // and none of the runs is known to have finished.
  const t = turn(19, [[["Agent", "Review range math", 1000, 3000]]], { done: false, end: null, reply: null, agent: true });
  const s = { agents: new Map([[t.steps[0].ids[0], { st: "async_launched", tok: null, ms: null }]]), agentIds: new Map() };
  const rows = ledgerTurn(s, t, 0, false, { ends: true }).rows;
  const r = rows.find((x) => x.status === "no result");
  expect(r).toBeTruthy();
  expect(r.dur).toBe(2000);
  expect(rowTimes(r).dur).toBe("");
  expect(detailOf(r).fields).toContainEqual(["Took", "2s"]);
  // Every row of these turns that says "no result" has an empty duration column.
  const cut = turn(20, [[["Bash", "bun run e2e", 2000, null]]], { done: false, end: null, reply: null });
  for (const x of [...rows, ...ledgerTurn(S, cut, 0, false, { ends: true }).rows]) if (x.status === "no result") expect(rowTimes(x).dur).toBe("");
  // A finished call keeps its duration.
  const ok = ledgerTurn(S, turn(21, [[["Read", "a", 1000, 1200]]]), 0).rows.find((x) => x.lk === "tool");
  expect(rowTimes(ok).dur).toBe(durText(200));
  expect(rowTimes(ok).bar).toBe(true);
  // Nor does the row draw the launch's time as a bar.
  expect(rowTimes(r).bar).toBe(false);
});

// A task notification after a finished turn is a turn of its own with an empty message: its
// first row says what the Chat's quiet line says, from the harness, then its steps and reply.
test("ledger: a task notification's turn starts with a Background task finished row, never a blank one, then its steps and reply", () => {
  const t = { ...turn(4, [[["Bash", "bun run build", 2000, 9000]]], { prompt: "", reply: "The build finished clean." }), agent: true, sender: { kind: "task-notification" } };
  const { rows } = ledgerTurn(S, t, 0);
  expect(rows.slice(1).map((r) => [r.lk, r.text])).toEqual([["agent", "Background task finished"], ["tool", "bun run build"], ["reply", "The build finished clean."]]);
  expect(rows[1].sender).toBeNull();
  const d = detailOf(rows[1]);
  expect(d.fields).toContainEqual(["From", "the harness · a background task finished, nobody typed this"]);
  expect(d.text).toBe("Background task finished");
  // A teammate's message keeps its own words and name.
  const peer = ledgerTurn(S, turn(5, [], { prompt: "Review the diff", who: "helper-a" }), 0).rows[1];
  expect([peer.lk, peer.text, peer.sender]).toEqual(["agent", "Review the diff", "helper-a"]);
});

test("compact rows below 200 px: the turn's number and the duration where it fits; below 64 px the mark alone; the label and the time in the tooltip", () => {
  expect([trajCompact(200), trajCompact(199), trajCompact(100), trajCompact(64), trajCompact(63), trajCompact(60)]).toEqual([null, "line", "line", "line", "icon", "icon"]);
  const step = { kind: "tr", turn: { n: 291 }, lk: "tool", tool: "Bash", text: "ls -la", start: 12000, dur: 3400, status: null };
  expect(compactRow(step, 240)).toBe(null);
  const at100 = compactRow(step, 100);
  expect([at100.mode, at100.num, at100.dur]).toEqual(["line", "#291", durText(3400)]);
  expect(at100.tip).toBe(["#291", "Bash ls -la", startText(12000), durText(3400)].join(" · "));
  // A 100 px pane, 98 inside: a three-figure number and a five-character duration fit.
  expect(compactRow({ ...step, dur: 50 }, 100, 98).dur).toBe(durText(50));
  // Too narrow for the duration: the number alone.
  expect(compactRow(step, 72).dur).toBe(null);
  expect(compactRow(step, 72).num).toBe("#291");
  const at60 = compactRow(step, 60);
  expect([at60.mode, at60.num, at60.dur, at60.tip]).toEqual(["icon", null, null, at100.tip]);
  const head = { kind: "trh", n: 291, ts: null, total: 8000 };
  expect([compactRow(head, 100).num, compactRow(head, 100).dur]).toEqual(["#291", durText(8000)]);
});

test("compact tooltips carry what the compact row drops: a heading's calls, failures, tokens and total; a step's subagent state and tokens and its status now", () => {
  const head = { kind: "trh", n: 12, ts: null, total: 8000, calls: 3, fails: 1, partial: false, tokens: 12400, timed: true };
  const p = headParts(head, Infinity);
  expect(compactRow(head, 100).tip).toBe(["#12", p.calls, p.failed, p.tokens, p.total].join(" · "));
  expect(compactRow(head, 100).tip).toContain("3 calls");
  expect(compactRow(head, 100).tip).toContain("1 failed");
  expect(compactRow(head, 100).tip).toContain("tok");
  // A running turn says so.
  expect(compactRow({ ...head, going: true }, 100).tip.endsWith("running")).toBe(true);
  const step = { kind: "tr", turn: { n: 12 }, lk: "tool", tool: "Task", text: "review", start: 12000, dur: 3400, status: null, sub: { state: "completed", tokens: 5200 } };
  const tip = compactRow(step, 100).tip;
  expect(tip).toContain("completed");
  expect(tip).toContain("5.2k tok");
  // The status as the row has it now: running, then failed (the subagent state gives way, as in
  // the full row).
  expect(compactRow({ ...step, status: "running" }, 100).tip.endsWith("running")).toBe(true);
  const failed = compactRow({ ...step, status: "failed", failed: true }, 60).tip;
  expect(failed.endsWith("failed")).toBe(true);
  expect(failed).not.toContain("completed");
});

// TRD-87 picks 3 and 4: the bottom dock's detail at the list's right from 700 px, at least 360 px
// and whatever the list leaves past 1,100 px; none under 700. The right dock as before.
test("trajLayout: the bottom dock's detail side and widths, and the list's columns by the list's width; the right dock by ledgerCols", () => {
  const at = (w, open = true) => { const L = trajLayout(w, "bottom", open); return [L.side, L.detailW, L.listW, L.cols.start, L.cols.bar, L.cols.filters, L.cols.detailRight]; };
  expect(at(1700)).toEqual(["right", 600, 1100, true, true, true, true]);
  expect(at(1460)).toEqual(["right", 360, 1100, true, true, true, true]);
  expect(at(1100)).toEqual(["right", 360, 740, true, true, true, true]);
  expect(at(860)).toEqual(["right", 360, 500, true, true, true, true]);
  expect(at(859)).toEqual(["right", 360, 499, true, false, true, true]);
  expect(at(780)).toEqual(["right", 360, 420, true, false, true, true]);
  expect(at(779)).toEqual(["right", 360, 419, false, false, true, true]);
  expect(at(700)).toEqual(["right", 360, 340, false, false, true, true]);
  expect(at(699)).toEqual(["none", null, 699, true, true, true, false]);
  expect(at(530)).toEqual(["none", null, 530, true, true, false, false]);
  // The detail closed by the person: the list takes the width, its columns with it.
  expect(at(1700, false)).toEqual(["right", 600, 1700, true, true, true, true]);
  expect(at(700, false)).toEqual(["right", 360, 700, true, true, true, true]);
  expect([DOCK_SIDE_MIN, DOCK_LIST_MAX, DOCK_DETAIL_MIN]).toEqual([700, 1100, 360]);
  // The right dock, and anything that is not "bottom": its 300 px detail from 900 px, columns by the pane.
  for (const dock of ["right", undefined, "top"]) {
    for (const w of [1700, 960, 900, 899, 560, 300]) {
      const L = trajLayout(w, dock);
      const side = w >= 900 ? "right" : "under";
      expect([L.side, L.detailW, L.listW]).toEqual([side, side === "right" ? 300 : null, side === "right" ? w - 300 : w]);
      expect(L.cols).toEqual(ledgerCols(w));
    }
  }
  expect(trajLayout(Number.NaN, "bottom").side).toBe("none");
});

test("rowsLeft: the whole 24 px rows a list keeps in its height, less a timeline's above it", () => {
  expect(rowsLeft(240)).toBe(10);
  expect(rowsLeft(263)).toBe(10);
  expect(rowsLeft(264)).toBe(11);
  expect(rowsLeft(240, 60)).toBe(7);
  expect(rowsLeft(23)).toBe(0);
  expect(rowsLeft(40, 80)).toBe(0);
  expect(rowsLeft(null)).toBe(null);
  expect(rowsLeft(Number.NaN)).toBe(null);
});
