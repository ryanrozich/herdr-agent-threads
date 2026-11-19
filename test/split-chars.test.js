// jq's -R decodes its input in pieces of about 4 KB, each on its own, so a character whose
// bytes fell in two pieces came out as two or three U+FFFD: in a prompt, a reply or a tool
// result the pane showed. The readers now give jq each line as a JSON string (core/lines.pl).
import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseChunk } from "../mods/agent-threads/core/turns.js";

const core = join(import.meta.dir, "../mods/agent-threads/core");
const mod = join(import.meta.dir, "../mods/agent-threads");
const run = (cmd, args, input) => spawnSync(cmd, args, { encoding: "utf8", input, maxBuffer: 1 << 26 });

// "—a" repeated: some em dash (three bytes) crosses every 4 KB piece of each line.
const dashes = "—a".repeat(6000);
function session() {
  const d = mkdtempSync(join(tmpdir(), "threads-split-"));
  const f = join(d, "s.jsonl");
  let n = 0;
  const rec = (o) => ({ sessionId: "s-split", cwd: "/Users/dev/acme-web", version: "2.1.0", userType: "external", isSidechain: false, uuid: `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`, timestamp: new Date(Date.parse("2026-11-01T10:00:00Z") + n * 1000).toISOString(), ...o });
  const said = (content, stop) => rec({ type: "assistant", message: { id: `msg_${n}`, model: "claude-sonnet-5-5", role: "assistant", type: "message", content, stop_reason: stop, usage: { input_tokens: 1, output_tokens: 1 } } });
  writeFileSync(f, `${[
    rec({ type: "user", message: { role: "user", content: dashes } }),
    said([{ type: "tool_use", id: "toolu_dashes", name: "Bash", input: { command: "cat dashes.txt" } }], "tool_use"),
    rec({ type: "user", toolUseResult: { stdout: dashes, stderr: "" }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_dashes", content: dashes }] } }),
    said([{ type: "text", text: dashes }], "end_turn"),
  ].map((l) => JSON.stringify(l)).join("\n")}\n`);
  return f;
}

test("a character across a 4 KB piece of a line reaches the prompt, the reply and the tool result whole", () => {
  const f = session();
  const ev = run("sh", [join(core, "extract.sh"), f, "0", "8000000", "claude"]).stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const texts = ev.filter((e) => typeof e.t === "string").map((e) => [e.k, e.t]);
  expect(texts).toEqual([["p", dashes], ["t", dashes]]);
  const out = run("sh", [join(core, "calls.sh"), f, "claude", "toolu_dashes"]).stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.k === "out");
  expect(out.out).toBe(dashes.slice(0, 24576));
  expect(out.out).not.toContain("�");
});

test("lines.pl writes each line as a JSON string of its own text, bad lines and bad bytes included", () => {
  const lines = ['{"a":"tab\there, a \\"quote\\" and \\\\ a backslash"}', "not JSON at all", '{"broken', "\u0001 control \u007f", "é — 😀"];
  const r = run("perl", [join(core, "lines.pl")], `${lines.join("\n")}\n`);
  expect(r.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l))).toEqual(lines);
  // Only ASCII changes: a byte that is not UTF-8 passes through as it is.
  const raw = spawnSync("perl", [join(core, "lines.pl")], { input: Buffer.from([0x61, 0xff, 0x62, 0x0a]) }).stdout;
  expect([...raw]).toEqual([0x22, 0x61, 0xff, 0x62, 0x22, 0x0a]);
});

// A Pi session whose prompt and reply are "—a" repeated.
function piSession() {
  const d = mkdtempSync(join(tmpdir(), "threads-split-pi-"));
  const f = join(d, "2026-01-02T03-00-00-000Z_00000000-0000-7000-8000-00000000000a.jsonl");
  let n = 0;
  let parent = null;
  const entry = (type, fields) => { const id = (++n).toString(16).padStart(8, "0"); const l = JSON.stringify({ type, id, parentId: parent, timestamp: `2026-01-02T03:00:0${n}.000Z`, ...fields }); parent = id; return l; };
  const usage = { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { total: 0 } };
  writeFileSync(f, `${[
    entry("message", { message: { role: "user", content: [{ type: "text", text: dashes }], timestamp: Date.parse("2026-01-02T03:00:01Z") } }),
    entry("message", { message: { role: "assistant", content: [{ type: "text", text: dashes }], api: "openai-completions", provider: "stub", model: "stub-1", usage, stopReason: "stop", timestamp: Date.parse("2026-01-02T03:00:02Z") } }),
  ].join("\n")}\n`);
  return f;
}

// A PATH with every program this one has but perl.
function pathWithoutPerl() {
  const bin = mkdtempSync(join(tmpdir(), "threads-noperl-"));
  for (const dir of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) if (!/^perl/.test(n) && !existsSync(join(bin, n))) { try { symlinkSync(join(dir, n), join(bin, n)); } catch { /* a name taken meanwhile */ } }
  }
  return bin;
}

test("a Pi session reads whole with perl, and still shows its chat without perl, marked for the debug report", () => {
  const f = piSession();
  const read = (env) => spawnSync("sh", [join(core, "extract.sh"), f, "0", "8000000", "pi"], { encoding: "utf8", env, maxBuffer: 1 << 26 }).stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const texts = (ev) => ev.filter((e) => typeof e.t === "string" && (e.k === "p" || e.k === "t")).map((e) => e.k);
  const whole = read(process.env);
  expect(texts(whole)).toEqual(["p", "t"]);
  expect(whole.filter((e) => e.k === "p" || e.k === "t").every((e) => e.t === dashes)).toBe(true);
  expect(whole.find((e) => e.k === "chunk").noperl).toBeUndefined();
  // perl hidden from the path: jq's raw read stands in, so the chat shows (a character may
  // be broken), and the chunk line says perl was not found.
  const bin = pathWithoutPerl();
  expect(spawnSync("sh", ["-c", "command -v perl"], { env: { ...process.env, PATH: bin } }).status).not.toBe(0);
  const raw = read({ ...process.env, PATH: bin });
  expect(texts(raw)).toEqual(["p", "t"]);
  expect(raw.find((e) => e.k === "p").t.replace(/\ufffd+/g, "").length).toBeGreaterThan(dashes.length * 0.9);
  expect(raw.find((e) => e.k === "chunk").noperl).toBe(true);
  // The pane keeps the mark for its debug report.
  const chunk = spawnSync("sh", [join(core, "extract.sh"), f, "0", "8000000", "pi"], { encoding: "utf8", env: { ...process.env, PATH: bin }, maxBuffer: 1 << 26 }).stdout;
  expect(parseChunk(chunk).noPerl).toBe(true);
});

// The one allowed raw read is lines.sh's stand-in for a machine without perl.
const ALLOWED = [["lines.sh", "  lines() { jq -R .; }"]];

test("no script reads a transcript with jq's raw read, in any spelling, but lines.sh's stand-in", () => {
  const scripts = [...readdirSync(core).map((n) => join(core, n)), ...readdirSync(mod).map((n) => join(mod, n))].filter((p) => p.endsWith(".sh"));
  expect(scripts.some((p) => p.endsWith("/core/lines.sh"))).toBe(true);
  // A short option cluster with R (-R, -Rc, -nR, -cnR), the long spelling, held in a
  // variable or not, on a line of its own or one continued with a backslash.
  const raw = /(^|[\s"'=(])(-[a-zA-Z]*R[a-zA-Z]*|--raw-input)(?=$|[\s"')])/;
  const found = [];
  for (const p of scripts) {
    const lines = readFileSync(p, "utf8").replace(/\\\n/g, " ").split("\n").filter((l) => !/^\s*#/.test(l));
    for (const l of lines) if (raw.test(l) && !ALLOWED.some(([f, a]) => p.endsWith(`/${f}`) && l === a)) found.push([p.slice(p.indexOf("mods/")), l.trim().slice(0, 100)]);
  }
  expect(found).toEqual([]);
  // The guard catches each spelling.
  for (const l of ["jq -R .", "jq -cR 'x'", "jq --raw-input .", 'opts="-nR"', "  -R \\", "jq -c \\\n  -R ."]) expect(raw.test(l.replace(/\\\n/g, " "))).toBe(true);
  for (const l of ["rm -rf x", "jq -c .", "grep -E -v x", "sort -r"]) expect(raw.test(l)).toBe(false);
  // lines.sh's stand-in is there, and only it.
  expect(readFileSync(join(core, "lines.sh"), "utf8").split("\n")).toContain(ALLOWED[0][1]);
});
