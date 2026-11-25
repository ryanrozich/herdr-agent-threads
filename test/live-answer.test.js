// bun test: an answer the agent has given (its harness marked it) is shown while the turn still
// runs, under its steps where the reply will be, once, and stays there when the turn ends. A turn
// with no marked answer looks as it did. And a turn stopped after its answer shows the answer.
// Everything here is made up; the rows are the pane's own, on the render harness.
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply } from "../mods/agent-threads/core/turns.js";
import { MD_MAX, itemWords, pane, settleRows, setup, state } from "./render-harness.js";

setup();

const STOP = new Error("stopped by Herdr");
const ID = "00000000-0000-4000-8000-0000000000f2";
const at = (s) => new Date(Date.UTC(2026, 10, 1, 9, 0, s)).toISOString();
const A = "0:1";
const PROMPT = { k: "p", o: "human", t: "Why does the cart test fail?", ts: at(0) };
const said = (t, s = 2) => ({ k: "t", t, ts: at(s) });
const answer = (t, s = 2) => ({ k: "t", a: 1, t, ts: at(s) });
const call = (s = 3) => ({ k: "u", n: "Bash", ts: at(s) });
const done = { k: "d", ms: 9000, ts: at(9) };

// A pane whose one session holds these events, its terminal working.
async function live(events) {
  const file = join(mkdtempSync(join(tmpdir(), "threads-live-")), `${ID}.jsonl`);
  writeFileSync(file, `${JSON.stringify({ parentUuid: null, isSidechain: false, type: "user", origin: { kind: "human" }, message: { role: "user", content: "Hello" }, uuid: "00000000-0000-4000-9000-000000000001", timestamp: at(0) })}\n`);
  const { v, cx } = await pane(file);
  const s = newSession(ID, file);
  for (const e of events) apply(s, e);
  s.loaded = true;
  v.sessions = [s];
  v.sel = null;
  v.rowsKey = null;
  state.terminals[0].status = "working";
  settleRows(v, cx);
  v.sel = null;
  const add = (...more) => { for (const e of more) apply(s, e); settleRows(v, cx); v.sel = null; };
  return { v, cx, s, add };
}
const mine = (v, key = A) => v.rows().filter((r) => r.turn && `${r.si}:${r.turn.n}` === key);
const kinds = (v) => mine(v).map((r) => r.kind);
const md = (v) => mine(v).filter((r) => r.kind === "md").map((r) => r.src).join("\n\n");
// The words a row draws.
const words = (v, r) => itemWords(v, r).filter((e) => e[0] === "child" && typeof e[1] === "string").map((e) => e[1]).join(" | ");
const own = (v) => v.rows().find((r) => r.live && r.turn);
const long = (n) => Array.from({ length: n }, (_, i) => `Paragraph ${i}: the cart rounds the tax on each line and not on the total, so two lines differ.`).join("\n\n");

// Red at c37c64f3: no "md" row, and "no reply yet". On the base the answer is an "itext" row.
test("a running turn shows the answer it has given, once, under its steps and out of them", async () => {
  const { v } = await live([PROMPT, said("Looking."), call(), answer("The tax is rounded twice."), call()]);
  expect(kinds(v)).toEqual(["wrow", "itext", "grp", "grp", "md", "wspin"]);
  expect([md(v), mine(v).filter((r) => r.kind === "itext").map((r) => r.src)]).toEqual(["The tax is rounded twice.", ["Looking."]]);
  expect(words(v, own(v))).not.toContain("no reply yet");
  expect(words(v, own(v))).toContain("Working for");
});

// Red at c37c64f3, as above.
test("the answer of a running turn is in the same rows when the turn ends, open or closed", async () => {
  const text = `${long(60)}\n\n\`\`\`js\nconst total = 1;\n\`\`\`\n\nThe end.`;
  const { v, cx, add } = await live([PROMPT, call(), answer(text), call()]);
  const parts = () => mine(v).filter((r) => ["md", "codehead", "code"].includes(r.kind)).map((r) => [r.key, r.kind, r.src ?? r.seg.text, r.gap ?? 0]);
  const running = parts();
  expect(running.filter((p) => p[1] === "md").length).toBeGreaterThan(2);
  expect(running.filter((p) => p[1] === "code").length).toBe(1);
  add(done);
  // Not opened by the person, it closes to its row.
  expect(kinds(v)).toEqual(["turn"]);
  v.toggle(A, cx);
  settleRows(v, cx);
  expect(parts()).toEqual(running);
  expect(mine(v).filter((r) => r.kind === "itext")).toEqual([]);
});

// Red at c37c64f3: the answer is not shown.
test("folding a running turn's line hides its steps and leaves its answer", async () => {
  const { v, cx } = await live([PROMPT, said("Looking."), call(), answer("The tax is rounded twice."), call()]);
  v.toggleLine(A, true);
  settleRows(v, cx);
  expect(kinds(v).slice(1)).toEqual(["md"]);
  expect(md(v)).toBe("The tax is rounded twice.");
});

// Red at c37c64f3: nothing shows until the turn ends.
test("an answer shows as it is given, before a call, and several stand in order with a note among the steps", async () => {
  const { v, add } = await live([PROMPT, call(), answer("First answer.")]);
  expect(kinds(v)).toEqual(["wrow", "grp", "md", "wspin"]);
  add(said("Tidying up."));
  expect([kinds(v), md(v)]).toEqual([["wrow", "grp", "md", "wspin"], "First answer."]);
  add(answer("Second answer."), call());
  expect([kinds(v), md(v)]).toEqual([["wrow", "grp", "itext", "grp", "md", "wspin"], "First answer.\n\nSecond answer."]);
  expect(mine(v).find((r) => r.kind === "itext").src).toBe("Tidying up.");
});

// Green on the base and after: which text is the reply is not known while the turn runs.
test("a running turn with no marked answer shows its steps and no reply, as before", async () => {
  const { v, add } = await live([PROMPT, said("Looking."), call(), said("The tax is rounded twice.")]);
  expect(kinds(v)).toEqual(["wrow", "itext", "grp", "wspin"]);
  expect(words(v, own(v))).toContain("no reply yet");
  v.sel = A;
  expect(words(v, v.rows().find((r) => r.kind === "working"))).toContain("No final reply yet. It appears here when Claude finishes this turn.");
  add(call());
  expect(kinds(v)).toEqual(["wrow", "itext", "grp", "itext", "grp", "wspin"]);
  state.terminals[0].status = "idle";
  v.rowsKey = null;
  expect(words(v, own(v))).toContain("No reply yet");
});

// Green on the base and after.
test("a marked text of spaces alone is no answer", async () => {
  const { v, add } = await live([PROMPT, call(), answer(" \n")]);
  expect(kinds(v)).toEqual(["wrow", "grp", "wspin"]);
  expect(words(v, own(v))).toContain("no reply yet");
  add({ k: "i", ts: at(5) });
  expect(v.rows().find((r) => r.kind === "turn").shape.tone).toBe("why");
});

// Red at c37c64f3: "No final reply yet", "no reply yet" and "No reply yet".
test("a running turn that has answered says so, selected or not, whatever its state", async () => {
  const { v, cx } = await live([PROMPT, call(), answer("The tax is rounded twice."), call()]);
  const says = (status) => {
    state.terminals[0].status = status;
    v.rowsKey = null;
    v.sel = null;
    settleRows(v, cx);
    v.sel = null;
    const row = words(v, own(v));
    v.sel = A;
    const card = words(v, v.rows().find((r) => r.kind === "working"));
    v.sel = null;
    return [row, card];
  };
  for (const [status, note] of [
    ["working", "Claude has answered and is still working."],
    ["blocked", "Claude has answered and is waiting for you in the terminal."],
    ["idle", "Claude has answered. This turn may have been stopped."],
  ]) {
    const [row, card] = says(status);
    expect(card).toContain(note);
    expect(`${row} ${card}`).not.toMatch(/no (final )?reply yet/i);
  }
  expect(says("idle")[0]).toContain("Answered · ");
});

// Red at c37c64f3 for the rows under it; the row itself is found past each kind of them.
test("selecting a running turn swaps its own row, with every kind of row of an answer under it", async () => {
  const code = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
  const { v, cx } = await live([PROMPT, call(), answer(`One.\n\n\`\`\`mermaid\ngraph TD\n${code}\n\`\`\`\n\n\`\`\`js\n${code}\n\`\`\``), call()]);
  expect(kinds(v)).toEqual(["wrow", "grp", "grp", "md", "codehead", "code", "codeall", "mview", "codehead", "code", "codeall", "wspin"]);
  // With the line folded each of them is the last row in turn.
  v.toggleLine(A, true);
  settleRows(v, cx);
  for (const last of ["codeall", "mview", "code", "md"]) {
    const t = { mview: `One.\n\n\`\`\`mermaid\ngraph TD\n${code}\n\`\`\``, codeall: `One.\n\n\`\`\`js\n${code}\n\`\`\``, code: "One.\n\n```js\na\n```", md: "One." }[last];
    const p = await live([PROMPT, call(), answer(t), call()]);
    p.v.toggleLine(A, true);
    settleRows(p.v, p.cx);
    p.v.sel = null;
    expect([p.v.rows().filter((r) => r.turn).at(-1).kind, kinds(p.v)[0]]).toEqual([last, "wrow"]);
    p.v.sel = A;
    expect(kinds(p.v)[0]).toBe("working");
    const row = p.v.rows().findIndex((r) => r.kind === "working");
    expect(p.v.baseSizes[p.v.baseRows.findIndex((r) => r.kind === "working")]).toBe(p.v.height(p.v.rows()[row]));
    p.v.sel = null;
    expect(kinds(p.v)[0]).toBe("wrow");
  }
});

// Red at c37c64f3, and on main: the search for the running turn's own row stopped at this row, so
// the row did not change when the turn was selected. It has nothing to do with an answer.
test("selecting a running turn swaps its own row, with a long output's Show all row under it", async () => {
  const { v, cx, s } = await live([PROMPT, { ...call(), id: "toolu_b" }]);
  v.calls.set(`${s.file}#toolu_b`, { st: "ok", out: Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"), lines: 30, ver: s.version });
  v.setGroup(`${A}:0`, true);
  v.callOpen.add(`${A}:0:0`);
  settleRows(v, cx);
  v.sel = null;
  expect(kinds(v)).toEqual(["wrow", "call", "cout", "oall", "wspin"]);
  v.sel = A;
  expect(kinds(v)).toEqual(["working", "call", "cout", "oall", "wspin"]);
  v.sel = null;
  expect(kinds(v)).toEqual(["wrow", "call", "cout", "oall", "wspin"]);
});

// Red at c37c64f3: the answer is cut at each event (there is none to cut).
test("a long answer of a running turn is cut and linked once, not at each event", async () => {
  const { v, add } = await live([PROMPT, call(), answer(long(200))]);
  const n = { cut: 0, link: 0 };
  const { cutReply, linkOne } = Object.getPrototypeOf(v);
  v.cutReply = function (...a) { n.cut++; return cutReply.apply(this, a); };
  v.linkOne = function (...a) { n.link++; return linkOne.apply(this, a); };
  const before = mine(v).filter((r) => r.kind === "md").map((r) => [r.key, r.md]);
  expect(before.length).toBeGreaterThan(4);
  expect(before.every(([, t]) => t.length <= MD_MAX)).toBe(true);
  for (let i = 0; i < 10; i++) add(call(10 + i));
  expect(n).toEqual({ cut: 0, link: 0 });
  expect(mine(v).filter((r) => r.kind === "md").map((r) => [r.key, r.md])).toEqual(before);
  add(answer("Second answer.", 30));
  expect(n.cut).toBe(1);
  // New link rules, once more.
  v.linksVer = (v.linksVer ?? 0) + 1;
  add(call(40));
  add(call(41));
  expect(n.cut).toBe(2);
  expect(md(v).endsWith("Second answer.")).toBe(true);
});

// Red at c37c64f3: the pane has no keptCut.
test("an answer cut with no time left has no links, is not kept, and is linked in a later draw", async () => {
  const { v, s } = await live([PROMPT, call(), answer("See ACME-12.")]);
  const turn = s.turns[0];
  v.links = [{ made: "up" }];
  v.linkedSegs = () => null;
  v.linkOne = (src) => ({ md: `${src} (linked)`, links: 1 });
  v.shapeMax = () => 5;
  v.shapeSpent = 6;
  const left = v.otherLeft ?? 0;
  const first = v.keptCut(A, turn, "See ACME-12.");
  expect([first.cut[0].parts[0].lk.md, v.otherLeft]).toEqual(["See ACME-12.", left + 1]);
  v.shapeSpent = 0;
  const later = v.keptCut(A, turn, "See ACME-12.");
  expect(later.cut[0].parts[0].lk.md).toBe("See ACME-12. (linked)");
  expect(v.keptCut(A, turn, "See ACME-12.")).toBe(later);
});

// Red at c37c64f3: no editor for a running turn's code.
test("a running answer's code block has an editor, and lets it go when the turn ends closed", async () => {
  const { v, cx, add } = await live([PROMPT, call(), answer("One.\n\n```js\nconst a = 1;\n```")]);
  cx.flush(0);
  expect([...v.code.keys()]).toEqual(["0:1:1"]);
  const st = v.code.get("0:1:1").st;
  expect(Boolean(st)).toBe(true);
  // The same editor while it runs on.
  add(call(5), call(6));
  cx.flush(0);
  expect(v.code.get("0:1:1").st).toBe(st);
  add(done);
  cx.flush(0);
  expect([...v.code.keys()]).toEqual([]);
  expect(v.liveCode.size).toBe(0);
});

// Red at c37c64f3, as above.
test("a running answer's editor stays when the turn ends open, and a turn that runs next lets only its own go", async () => {
  const code = "One.\n\n```js\nconst a = 1;\n```";
  const { v, cx, add } = await live([PROMPT, call(), answer(code)]);
  cx.flush(0);
  const st = v.code.get("0:1:1").st;
  v.open.add(A);
  add(done);
  cx.flush(0);
  expect(v.code.get("0:1:1")?.st).toBe(st);
  v.toggle(A, cx);
  add({ k: "p", o: "human", t: "Next", ts: at(20) }, call(21), answer(code, 22));
  cx.flush(0);
  expect([...v.code.keys()]).toEqual(["0:2:1"]);
  // It ends and the next begins in one read.
  add({ ...done, ts: at(30) }, { k: "p", o: "human", t: "And", ts: at(31) }, call(32), answer(code, 33));
  cx.flush(0);
  expect([...v.code.keys()]).toEqual(["0:3:1"]);
});

// Red before its own cure: the rows on screen say nothing of a build not all done, and the
// editor was let go before its rows were drawn, with no later build to ask for it again.
test("a running answer's editor is made while the rows it came with are still being built", async () => {
  const { v, cx } = await live([PROMPT, call(), answer("One.\n\n```js\nconst a = 1;\n```")]);
  cx.flush(0);
  v.dropCode();
  // A build's slice has asked for the editors (replyRows); the rows drawn are the ones before it.
  v.codeDue.add(A);
  v.liveCode.add(A);
  v.baseIndex = new Map();
  v.flushCode(cx);
  cx.flush(0);
  expect([[...v.code.keys()], v.liveCode.has(A)]).toEqual([["0:1:1"], true]);
});

// Red at c37c64f3: there is no cut.
test("a draw Herdr stops in the cut of a running answer keeps nothing of it, and the next draw has its rows", async () => {
  const { v, cx, s } = await live([PROMPT, call(), answer("First answer.")]);
  const { cutReply } = Object.getPrototypeOf(v);
  let stops = 0;
  v.cutReply = function (...a) { if (!stops) { stops++; throw STOP; } return cutReply.apply(this, a); };
  apply(s, answer("Second answer.", 5));
  try { v.render(cx); } catch (e) { if (e !== STOP) throw e; v.renderOpen = true; }
  expect([stops, v.cutOf.get(s.turns[0]).text]).toEqual([1, "First answer."]);
  settleRows(v, cx);
  v.sel = null;
  expect([md(v), kinds(v)]).toEqual(["First answer.\n\nSecond answer.", ["wrow", "grp", "md", "wspin"]]);
});

// Red at c37c64f3: no row says what is left out.
test("an answer past what an open reply shows says how much is left out, with no Collapse", async () => {
  const { v, cx } = await live([PROMPT, call(), answer(long(2600)), call()]);
  const fold = mine(v).find((r) => r.kind === "fold");
  expect(fold.left).toBeGreaterThan(0);
  const drawn = words(v, fold);
  expect(drawn).toContain("more characters are left out here");
  expect(drawn).not.toContain("Collapse");
  expect(v.height(fold)).toBe(26);
  v.click(fold.key, cx);
  expect([v.sel, v.open.has(A)]).toEqual([A, false]);
  // A long one within it has no such row while it runs, and Collapse once it is open.
  const p = await live([PROMPT, call(), answer(long(60)), call()]);
  expect(kinds(p.v)).not.toContain("fold");
  p.add(done);
  p.v.toggle(A, p.cx);
  settleRows(p.v, p.cx);
  const row = mine(p.v).find((r) => r.kind === "fold");
  expect([words(p.v, row).includes("Collapse"), p.v.height(row)]).toEqual([true, 34]);
});

// Red at c37c64f3: "no reply yet" and no answer.
test("a goal's task that runs on after its answer shows it under its quiet line", async () => {
  const { v } = await live([PROMPT, answer("One."), done, { k: "w", o: "goal", ts: at(10) }, call(11), answer("The goal is met.", 12), call(13)]);
  const key = "0:2";
  expect(mine(v, key).map((r) => r.kind)).toEqual(["wrow", "grp", "grp", "md", "wspin"]);
  expect(mine(v, key).find((r) => r.kind === "md").src).toBe("The goal is met.");
  const row = words(v, own(v));
  expect(row).not.toContain("no reply yet");
});

// Red on the base ("No reply · interrupted ...") and at c37c64f3.
test("a turn stopped after its answer shows the answer closed, pinned and open", async () => {
  const { v, cx, s } = await live([PROMPT, answer("First answer."), call(), { k: "i", ts: at(5) }]);
  const turn = s.turns[0];
  const row = v.rows().find((r) => r.kind === "turn");
  expect([turn.interrupted, row.shape.tone, row.shape.reply.join("\n").trim()]).toEqual([true, "reply", "First answer."]);
  const pin = v.pinShape(turn);
  expect([pin.tone, pin.reply]).toEqual(["reply", "First answer."]);
  v.toggle(A, cx);
  settleRows(v, cx);
  expect(md(v)).toBe("First answer.");
});

// Green on the base and after.
test("a turn stopped with no marked answer says it has no reply, as before", async () => {
  const { v, s } = await live([PROMPT, call(), said("Half a thought."), { k: "i", ts: at(5) }]);
  const row = v.rows().find((r) => r.kind === "turn");
  expect([row.shape.tone, v.pinShape(s.turns[0]).reply]).toEqual(["why", "No reply · interrupted after 1 tool call"]);
});
