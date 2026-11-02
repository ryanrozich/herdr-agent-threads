// Writes a very large synthetic transcript for timing the extractor (nothing in it comes
// from a real session). It repeats a make-fixture.js transcript until the file reaches the
// size asked for.
// Usage: bun test/make-big.js <out.jsonl> <megabytes> [mode]
//   real   (default) tool inputs and results of 6 KB, plus api-request-blob, last-prompt and
//          file-history-snapshot lines, roughly the mix of a long real session
//   noisy  about 85% of the bytes in bookkeeping lines
//   dense  conversation lines only: the worst case for the extractor (most bytes parsed)
import { createWriteStream, readFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [out, mb, mode = "real"] = [process.argv[2], Number(process.argv[3]), process.argv[4]];
if (!out || !mb) { console.error("usage: bun test/make-big.js <out.jsonl> <megabytes> [real|noisy|dense]"); process.exit(2); }
const target = mb * 1024 * 1024;
const tmp = join(mkdtempSync(join(tmpdir(), "threads-big-")), "base.jsonl");
execFileSync("bun", [join(import.meta.dir, "make-fixture.js"), tmp, "00000000-0000-4000-8000-000000000001", "/tmp/threads-demo", "--extra", "400"], { stdio: "ignore" });
const base = readFileSync(tmp, "utf8").trimEnd().split("\n").filter((l) => !l.includes('"custom-title"') && !l.includes('"last-prompt"'));
const sid = "00000000-0000-4000-8000-000000000001";
const filler = (n) => "x".repeat(n);
const w = createWriteStream(out);
let bytes = 0, i = 0, pending = [];
const flush = () => { w.write(`${pending.join("\n")}\n`); pending = []; };
const emit = (s) => { pending.push(s); bytes += Buffer.byteLength(s) + 1; if (pending.length > 2000) flush(); };
while (bytes < target) {
  let line = base[i++ % base.length];
  if (mode === "real" || mode === "dense") line = line.split('"…"').join(JSON.stringify(filler(mode === "real" ? 6000 : 1500)));
  emit(line);
  if (mode === "real" && i % 3 === 0) {
    emit(JSON.stringify({ type: "api-request-blob", sessionId: sid, blob: { messages: [{ role: "assistant", content: [{ type: "text", text: filler(3000) }] }] } }));
    emit(JSON.stringify({ type: "last-prompt", lastPrompt: "synthetic", sessionId: sid }));
    emit(JSON.stringify({ type: "file-history-snapshot", messageId: `m${i}`, snapshot: {} }));
  }
  if (mode === "noisy") {
    emit(JSON.stringify({ type: "api-request-blob", sessionId: sid, blob: { messages: [{ role: "assistant", content: [{ type: "text", text: filler(9000) }] }] } }));
    emit(JSON.stringify({ type: "attachment", sessionId: sid, attachment: { type: "diagnostics", text: filler(2500) } }));
    emit(JSON.stringify({ type: "mode", mode: "normal", sessionId: sid }));
  }
}
flush();
w.end(() => console.log(`${out}: ${bytes} bytes (${mode})`));
