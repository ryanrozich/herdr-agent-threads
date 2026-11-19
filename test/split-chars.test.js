// jq's -R decodes its input in pieces of about 4 KB, each on its own, so a character whose
// bytes fell in two pieces came out as two or three U+FFFD: in a prompt, a reply or a tool
// result the pane showed. The readers now give jq each line as a JSON string (core/lines.pl).
import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("no script reads a transcript with jq -R", () => {
  const scripts = [...readdirSync(core).map((n) => join(core, n)), ...readdirSync(mod).map((n) => join(mod, n))].filter((p) => p.endsWith(".sh"));
  for (const p of scripts) {
    const bad = readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).filter((l) => /\bjq\b.*\s-[a-zA-Z]*R[a-zA-Z]*\b/.test(l) || /'\s+-[a-zA-Z]*R[a-zA-Z]*(\s|$)/.test(l));
    expect([p, bad]).toEqual([p, []]);
  }
});
