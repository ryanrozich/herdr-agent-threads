// bun test: each agent's synthetic session, read by its own reader, its turns and the turns
// folded into the trajectory shape (core/trajectory.js), against golden files in
// test/fixtures/trajectory.
// UPDATE=1 bun test test/trajectory.test.js writes the golden files again.
import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply, parseChunk, nextChunk, replaced, rewindTail } from "../mods/agent-threads/core/turns.js";
import { trajectory, trajectories } from "../mods/agent-threads/core/trajectory.js";

const root = join(import.meta.dir, "..");
const extractor = join(root, "mods/agent-threads/core/extract.sh");
const opencode = join(root, "mods/agent-threads/core/opencode.sh");
const golden = join(root, "test/fixtures/trajectory");

// The sessions: make-fixture.js for Claude Code (with its subagent turn), make-agents.js for
// the other five, all made up and fixed by their start times.
const dir = mkdtempSync(join(tmpdir(), "threads-traj-"));
const claude = join(dir, "claude.jsonl");
execFileSync("bun", [join(root, "test/make-fixture.js"), claude, "00000000-0000-4000-8000-000000000042", "/Users/dev/acme-web", "--subagents"]);
const [codex, oc, pi, cursor, agy] = execFileSync("bun", [join(root, "test/make-agents.js"), dir, "/Users/dev/acme-web", "2026-11-01T09:00:00Z"], { encoding: "utf8" })
  .trim().split("\n");

function readFile(file, harness) {
  const s = newSession("s", file);
  const base = 1 << 20;
  let chunk = base;
  for (let guard = 0; guard < 1000 && chunk; guard++) {
    const r = parseChunk(execFileSync("sh", [extractor, file, String(s.offset), String(chunk), harness], { encoding: "utf8" }));
    if (r.head && !s.head) s.head = r.head;
    s.size = r.size;
    for (const e of r.events) apply(s, e);
    s.offset += r.used;
    chunk = nextChunk(s, r.used, chunk, base);
  }
  return s;
}
function readOpencode(ref) {
  const [db, sid] = ref.split("#");
  const s = newSession(sid, ref);
  for (let guard = 0; guard < 100; guard++) {
    const r = parseChunk(execFileSync("sh", [opencode, "read", db, sid, String(s.offset), "40"], { encoding: "utf8" }));
    if (replaced(s, r)) { Object.assign(s, newSession(sid, ref)); continue; }
    if (r.head && !s.head) s.head = r.head;
    s.size = r.size;
    if (r.rewind) rewindTail(s);
    for (const e of r.events) apply(s, e);
    s.offset += r.used;
    if (s.offset >= r.size || r.used === 0) break;
  }
  return s;
}

// The golden file's text, written when missing or with UPDATE=1.
function same(name, value) {
  const file = join(golden, name);
  const text = `${JSON.stringify(value, null, 1)}\n`;
  if (process.env.UPDATE || !existsSync(file)) { mkdirSync(golden, { recursive: true }); writeFileSync(file, text); }
  expect(text).toBe(readFileSync(file, "utf8"));
}

const AGENTS = [
  ["claude", () => readFile(claude, "claude")],
  ["codex", () => readFile(codex, "codex")],
  ["opencode", () => readOpencode(oc)],
  ["pi", () => readFile(pi, "pi")],
  ["cursor", () => readFile(cursor, "cursor")],
  ["antigravity", () => readFile(agy, "antigravity")],
];

for (const [name, read] of AGENTS) {
  test(`trajectory: ${name}'s session folds into turns, step groups and cells, as the golden file has it`, () => {
    const s = read();
    expect(s.turns.length).toBeGreaterThan(0);
    const got = trajectories(s);
    // Each turn has its stable id, and no two share one.
    expect(new Set(got.map((t) => t.id)).size).toBe(got.length);
    expect(got.every((t) => typeof t.id === "string" && t.id.split("|").length === 3)).toBe(true);
    // Every cell has a start and an end, a number or null; a tool's result is joined by its id.
    for (const t of got) {
      expect(t.groups[0]).toMatchObject({ title: "Message", cells: [{ kind: "user" }] });
      for (const g of t.groups) for (const c of g.cells) {
        if (c.kind === "more") continue;
        expect(c.start === null || Number.isFinite(c.start)).toBe(true);
        expect(c.end === null || Number.isFinite(c.end)).toBe(true);
        if (c.kind === "tool" && c.call) expect(c.result).toEqual({ call: c.call });
      }
    }
    same(`${name}.json`, got);
    // The turns themselves, as the reader builds them today: the session model's later steps
    // (a store with indexes, stable ids, times on steps) must keep them, or say what changed.
    same(`turns-${name}.json`, s.turns);
  });
}

test("trajectory: a Claude Code subagent call carries its run, joined by the call's id", () => {
  const s = readFile(claude, "claude");
  const cells = s.turns.flatMap((t) => trajectory(s, t).groups.flatMap((g) => g.cells));
  const sub = cells.filter((c) => c.subagent);
  expect(sub.length).toBeGreaterThan(0);
  expect(sub.some((c) => c.subagent.agent && c.subagent.agent !== c.call && c.subagent.state)).toBe(true);
  for (const c of sub) expect(c.subagent.steps).toBeNull();
});

test("stable ids: a session read again from the top, or whose tail is rewritten, gives every turn the id it had", () => {
  const ts = (s) => `2026-11-01T09:00:${String(s).padStart(2, "0")}.000Z`;
  const turn = (sec, text, answer) => [
    { k: "p", o: "human", t: text, ts: ts(sec) },
    { k: "t", t: answer },
    { k: "s", ts: ts(sec + 1) },
  ];
  // Two turns with the same prompt in the same second (a repeat) count apart.
  const events = [...turn(1, "Fix the cart total", "Done."), ...turn(3, "Run the tests", "All pass."),
    ...turn(5, "again", "One."), ...turn(5, "again", "Two."), ...turn(8, "Ship it", "Shipped.")];
  const read = (evs) => { const s = newSession("s", "f"); for (const e of evs) apply(s, e); return s; };
  const ids = (s) => trajectories(s).map((t) => `${t.n} ${t.id}`);
  const whole = read(events);
  expect(whole.turns.length).toBe(5);
  const first = ids(whole);
  expect(first[2].split("|")[2]).toBe("1");
  expect(first[3].split("|")[2]).toBe("2");
  // Read again from the top.
  expect(ids(read(events))).toEqual(first);
  // The tail rewritten while it streams: two turns settled, the rest dropped and read again
  // (rewindTail, as for OpenCode), first cut short and then whole.
  const s = read([...events.slice(0, 6), { k: "settle" }]);
  for (const e of events.slice(6, 9)) apply(s, e);
  rewindTail(s);
  for (const e of events.slice(6)) apply(s, e);
  expect(ids(s)).toEqual(first);
});
