// bun test: the extractor over a synthetic Pi session file, built here line by line in the shapes
// Pi 1.5.0 writes, with made-up text. Small chunks make turns cross chunk boundaries.
import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply, parseChunk, nextChunk, reply, stats } from "../mods/agent-threads/turns.js";
import { harnessOf, harnessOfFile, idOfFile, piStartMs, piFolder, piArgv, pickOpenCode } from "../mods/agent-threads/harness.js";

const root = join(import.meta.dir, "..");
const extractor = join(root, "mods/agent-threads/extract.sh");
const imager = join(root, "mods/agent-threads/image.sh");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==";
const ID = "00000000-0000-7000-8000-000000000002";
const NAME = `2026-01-02T03-00-00-000Z_${ID}.jsonl`;

let n = 0;
let second = 0;
let parent = null;
const ts = () => {
  const t = `2026-01-02T03:${String(Math.floor(second / 60)).padStart(2, "0")}:${String(second % 60).padStart(2, "0")}.000Z`;
  second++;
  return t;
};
const entry = (type, fields) => {
  const id = (++n).toString(16).padStart(8, "0");
  const line = `${JSON.stringify({ type, id, parentId: parent, timestamp: ts(), ...fields })}\n`;
  parent = id;
  return line;
};
const msg = (message) => entry("message", { message: { timestamp: Date.parse("2026-01-02T03:00:00Z") + second * 1000, ...message } });
const user = (content) => msg({ role: "user", content });
const system = () => msg({ role: "system", content: "", sections: { preamble: "SECRET-PROMPT" }, toolsAdded: [{ name: "bash", description: "SECRET-SCHEMA" }] });
const usage = (input, output, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite, cost: { total: 0 } });
const said = (content, stopReason = "stop", u = usage(50, 10, 20, 5), extra = {}) =>
  msg({ role: "assistant", content, api: "openai-completions", provider: "stub", model: "stub-1", usage: u, stopReason, thinkingLevel: "medium", ...extra });
const text = (t) => ({ type: "text", text: t });
const call = (name) => ({ type: "toolCall", id: "call_1", name, arguments: { command: "SECRET-ARGS" } });
const result = () => msg({ role: "toolResult", toolCallId: "call_1", toolName: "bash", content: [text("SECRET-OUT")], isError: false });

function session() {
  n = 0;
  second = 0;
  parent = null;
  const dir = mkdtempSync(join(tmpdir(), "threads-pi-"));
  const file = join(dir, NAME);
  writeFileSync(file, [
    `${JSON.stringify({ type: "session", version: 3, id: ID, timestamp: ts(), cwd: "/home/dev/shop" })}\n`,
    entry("model_change", { provider: "stub", modelId: "stub-1" }),
    entry("thinking_level_change", { thinkingLevel: "medium" }),
    system(),
    // A turn with a tool call between two replies.
    user([text("Why does the cart test fail?")]),
    said([{ type: "thinking", thinking: "SECRET-THOUGHT" }, text("Looking at it."), call("bash")], "toolUse"),
    result(),
    said([text("It rounds tax per line.")]),
    // A pasted image, with the prompt as a plain string in an older shape.
    user([text("What colour?"), { type: "image", data: PNG, mimeType: "image/png" }]),
    said([text("Red.")]),
    // Stopped with Escape.
    user("Rewrite everything"),
    said([text("Starting")], "aborted", usage(0, 0)),
    // A provider error.
    user([text("Try again")]),
    said([], "error", usage(0, 0), { errorMessage: "429 rate limited" }),
    entry("compaction", { summary: "SECRET-SUMMARY", firstKeptEntryId: "00000001", tokensBefore: 5000 }),
    entry("session_info", { name: "Cart rounding" }),
  ].join(""));
  return file;
}

function read(file, base, s = newSession(ID, file)) {
  let chunk = base;
  for (let guard = 0; guard < 10000 && chunk; guard++) {
    const r = parseChunk(execFileSync("sh", [extractor, file, String(s.offset), String(chunk), "pi"], { encoding: "utf8" }));
    s.size = r.size;
    for (const e of r.events) apply(s, e);
    s.offset += r.used;
    chunk = nextChunk(s, r.used, chunk, base);
  }
  return s;
}

test("builds turns from a Pi session file", () => {
  const s = read(session(), 1 << 20);
  expect(s.offset).toBe(s.size);
  expect(s.title).toBe("Cart rounding");
  expect(s.turns.map((t) => t.prompt)).toEqual(["Why does the cart test fail?", "What colour?", "Rewrite everything", "Try again"]);
  const [plain, image, stopped, failed] = s.turns;

  expect(reply(plain)).toBe("It rounds tax per line.");
  expect(plain.tools).toBe(1);
  expect(plain.toolNames).toEqual({ bash: 1 });
  expect(plain.model).toBe("stub-1");
  expect(plain.effort).toBe("medium");
  expect(plain.done).toBe(true);
  // From the prompt to the last stop: the prompt is entry 5 and the stop entry 8.
  expect(plain.durationMs).toBe(3000);
  const st = stats(plain);
  expect(st.input).toBe(100);
  expect(st.cacheRead).toBe(40);
  expect(st.cacheWrite).toBe(10);

  expect(image.images.map((i) => i.mt)).toEqual(["image/png"]);
  expect(reply(image)).toBe("Red.");

  expect(stopped.interrupted).toBe(true);
  expect(stats(stopped).tokens).toBe(0);
  expect(failed.errors).toEqual(["429 rate limited"]);
  expect(failed.done).toBe(true);
  expect(failed.compactions).toBe(1);
});

test("small chunks give the same turns as one read", () => {
  const file = session();
  const whole = read(file, 1 << 20);
  const pieces = read(file, 700);
  expect(pieces.turns.map((t) => [t.prompt, reply(t), t.tools, t.done, t.durationMs])).toEqual(whole.turns.map((t) => [t.prompt, reply(t), t.tools, t.done, t.durationMs]));
});

test("nothing but named fields leaves a Pi file", () => {
  const out = execFileSync("sh", [extractor, session(), "0", String(1 << 20), "pi"], { encoding: "utf8" });
  expect(out).not.toContain("SECRET");
  expect(out).not.toContain(PNG);
  expect(JSON.parse(out.split("\n")[0])).toMatchObject({ k: "file", head: ID });
});

test("image.sh decodes a Pi prompt's image", () => {
  const file = session();
  const s = read(file, 1 << 20);
  const cache = mkdtempSync(join(tmpdir(), "threads-img-"));
  const u = s.turns[1].imgLine;
  const got = JSON.parse(execFileSync("sh", [imager, file, u, cache, ID, "pi"], { encoding: "utf8" }).trim());
  expect(got.file).toBe(`${u}-0.png`);
  expect(readFileSync(join(cache, ID, got.file)).toString("base64")).toBe(PNG);
});

test("a Pi terminal and its files are told apart from the other agents'", () => {
  // Pi runs under node and renames its process "pi".
  expect(harnessOf({ argv: ["pi", "", "", ""], name: "node" })).toBe("pi");
  const file = `/h/.pi/agent/sessions/--home-dev-shop--/${NAME}`;
  expect(harnessOfFile(file)).toBe("pi");
  expect(idOfFile(file)).toBe(ID);
  expect(piStartMs(file)).toBe(Date.parse("2026-01-02T03:00:00.000Z"));
  expect(harnessOfFile("/h/.claude/projects/x/abc.jsonl")).toBe("claude");
  expect(harnessOfFile("/h/.codex/sessions/2026/01/02/rollout-2026-01-02T03-00-00-x.jsonl")).toBe("codex");
  expect(piFolder("/h/.pi/agent/sessions", "/home/dev/shop")).toBe("/h/.pi/agent/sessions/--home-dev-shop--");
});

test("a Pi command line names a session only when it writes to it", () => {
  expect(piArgv(["pi"])).toEqual({ id: null, path: null, cont: false });
  expect(piArgv(["pi", "-c"])).toEqual({ id: null, path: null, cont: true });
  expect(piArgv(["pi", "--session", "00000000"])).toEqual({ id: "00000000", path: null, cont: false });
  expect(piArgv(["pi", "--session", `/x/${NAME}`])).toEqual({ id: ID, path: `/x/${NAME}`, cont: false });
  expect(piArgv(["pi", "--session-id", "mine"])).toEqual({ id: "mine", path: null, cont: false });
  expect(piArgv(["pi", "--fork", "00000000"])).toEqual({ id: null, path: null, cont: false });
});

test("alone in the folder, a Pi terminal's session is the one it wrote last since it started", () => {
  const list = [{ id: "a", created: 6000, updated: 9500, busy: 9500 }, { id: "b", created: 7000, updated: 9000, busy: 9000 }, { id: "old", created: 1000, updated: 1000, busy: 1000 }];
  expect(pickOpenCode(list, 5000, 0, { id: null, cont: false }, null, null)).toEqual({ id: "a", guess: false, via: "folder", choices: [] });
  expect(pickOpenCode(list, 5000, 1, { id: null, cont: false }, "b", null)).toMatchObject({ id: "b", guess: true });
  expect(pickOpenCode(list, 99999, 0, { id: null, cont: false }, null, null).id).toBe(null);
});

// Pi's Ctrl-V writes the image to <temp>/pi-clipboard-<uuid>.png and types the path, with no space.
function clipSession(paths, tail) {
  n = 0;
  second = 0;
  parent = null;
  const dir = mkdtempSync(join(tmpdir(), "threads-pi-"));
  const file = join(dir, NAME);
  writeFileSync(file, [
    `${JSON.stringify({ type: "session", version: 3, id: ID, timestamp: ts(), cwd: "/home/dev/shop" })}\n`,
    user([text(`${paths.join("")}${tail}`)]),
    said([text("A cat.")]),
  ].join(""));
  return file;
}
const clip = (k) => `/tmp/pi-clipboard-00000000-0000-4000-8000-00000000000${k}`;

test("a Pi paste's temp path becomes [Image #N] and a thumbnail, and a gone file says so", () => {
  const png = `${clip(1)}.png`, missing = `${clip(2)}.png`, fake = `${clip(3)}.jpg`;
  writeFileSync(png, Buffer.from(PNG, "base64"));
  writeFileSync(fake, "not an image");
  rmSync(missing, { force: true });
  try {
    const file = clipSession([png, " ", missing, " ", fake], "What is in this picture?");
    const s = read(file, 1 << 20);
    const [turn] = s.turns;
    expect(turn.prompt).toBe("[Image #1] [Image #2] [Image #3] What is in this picture?");
    expect(turn.images).toEqual([
      { mt: "image/png", n: 1, src: png },
      { mt: "image/png", n: 2, src: missing },
      { mt: "image/jpeg", n: 3, src: fake },
    ]);
    const cache = mkdtempSync(join(tmpdir(), "threads-img-"));
    const out = execFileSync("sh", [imager, file, turn.imgLine, cache, ID, "pi"], { encoding: "utf8" }).trim().split("\n").map((l) => JSON.parse(l));
    // The real PNG is copied; the gone one says so; the one that is not an image is left out.
    expect(out).toEqual([{ i: 0, file: `${turn.imgLine}-0.png`, w: 1, h: 1 }, { i: 1, gone: true }]);
    expect(readFileSync(join(cache, ID, out[0].file)).toString("base64")).toBe(PNG);
    // Once copied, the image stays after the temp file goes.
    rmSync(png);
    const again = execFileSync("sh", [imager, file, turn.imgLine, cache, ID, "pi"], { encoding: "utf8" });
    expect(again).toContain(`"file":"${turn.imgLine}-0.png"`);
  } finally {
    for (const f of [png, fake]) rmSync(f, { force: true });
  }
});

test("only Pi's temp-folder paste names count, and nothing else is read", () => {
  const other = [
    "/home/dev/tmp/pi-clipboard-00000000-0000-4000-8000-000000000004.png", // not the temp folder
    "/tmp/screenshot.png", // not Pi's name
    "/tmp/pi-clipboard-00000000-0000-4000-8000-000000000005.txt", // not an image name
    "/var/folders/../../etc/pi-clipboard-00000000-0000-4000-8000-000000000006.png",
  ];
  for (const p of other) {
    const s = read(clipSession([p], " hi"), 1 << 20);
    expect(s.turns[0].prompt).toBe(`${p} hi`);
    expect(s.turns[0].images).toEqual([]);
  }
  const mac = "/var/folders/x1/abc_123/T/pi-clipboard-00000000-0000-4000-8000-000000000007.png";
  const s = read(clipSession([mac], "Why?"), 1 << 20);
  expect(s.turns[0].prompt).toBe("[Image #1] Why?");
  expect(existsSync(mac)).toBe(false);
});
