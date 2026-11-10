// bun test: the extractor over a synthetic Codex rollout, built here line by line in the shapes
// Codex writes, with made-up text. Small chunks make turns cross chunk boundaries.
import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply, parseChunk, nextChunk, reply, stats } from "../mods/agent-threads/turns.js";

const root = join(import.meta.dir, "..");
const extractor = join(root, "mods/agent-threads/extract.sh");
const imager = join(root, "mods/agent-threads/image.sh");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==";
const ID = "00000000-0000-7000-8000-000000000001";

let ordinal = 0;
let second = 0;
const line = (type, payload, extra = {}) => {
  const ts = `2026-01-02T03:${String(Math.floor(second / 60)).padStart(2, "0")}:${String(second % 60).padStart(2, "0")}.000Z`;
  second++;
  return `${JSON.stringify({ timestamp: ts, ordinal: ordinal++, type, payload, ...extra })}\n`;
};
const ctx = (model, effort) => line("turn_context", { model, effort });
const prompt = (turn, content) => line("event_msg", { type: "item_completed", turn_id: turn, item: { type: "UserMessage", content } });
const context = (text) => line("response_item", { type: "message", role: "user", content: [{ type: "input_text", text }] });
const say = (text, phase = "final_answer") => line("response_item", { type: "message", role: "assistant", phase, content: [{ type: "output_text", text }] });
const tool = (name) => line("response_item", { type: "function_call", name, arguments: "{}" });
const tokens = (total, input, cached, output) => line("event_msg", {
  type: "token_count",
  info: { total_token_usage: { total_tokens: total }, last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output } },
});
const done = (ms) => line("event_msg", { type: "task_complete", duration_ms: ms });

function rollout() {
  ordinal = 0;
  second = 0;
  const dir = mkdtempSync(join(tmpdir(), "threads-codex-"));
  const file = join(dir, `rollout-2026-01-02T03-00-00-${ID}.jsonl`);
  writeFileSync(file, [
    line("session_meta", { id: ID, cwd: "/home/dev/shop" }),
    // Plain turn: context Codex injects as a user message is not a prompt.
    ctx("gpt-5.5-codex", "medium"),
    context("<environment_context>the folder</environment_context>"),
    prompt("turn-0001", [{ type: "text", text: "Why does the cart test fail?" }]),
    say("Looking at the cart test.", "commentary"),
    tool("exec_command"),
    tokens(100, 80, 30, 20),
    // A rate-limit update repeats the last count.
    tokens(100, 80, 30, 20),
    line("event_msg", { type: "token_count", info: null, rate_limits: {} }),
    say("It rounds tax per line."),
    tokens(200, 90, 70, 10),
    done(4000),
    // An image: its data sits on the user message just before the prompt event.
    ctx("gpt-5.5-codex", "high"),
    line("response_item", { type: "message", role: "user", content: [
      { type: "input_text", text: "What colour?" },
      { type: "input_image", image_url: `data:image/png;base64,${PNG}` },
    ] }),
    prompt("turn-0002", [{ type: "text", text: "What colour?" }, { type: "local_image", path: "/home/dev/shot.PNG" }]),
    say("Blue."),
    done(1000),
    // Interrupted.
    ctx("gpt-5.5-codex", "high"),
    prompt("turn-0003", [{ type: "text", text: "Rewrite everything" }]),
    tool("web_search"),
    line("response_item", { type: "web_search_call" }),
    line("response_item", { type: "local_shell_call" }),
    line("event_msg", { type: "turn_aborted", reason: "interrupted" }),
    // A subagent's message, then one a fork inherited.
    line("response_item", { type: "agent_message", author: "/root/reviewer", recipient: "/root", content: [{ type: "input_text", text: "Review finished, two nits." }] }),
    line("response_item", { type: "agent_message", author: "/root/reviewer", recipient: "/root", content: [{ type: "input_text", text: "Copied from the parent." }] }, { metadata: { inherited_user_message: true } }),
    say("Noted."),
    done(500),
    line("compacted", { message: "" }),
    line("event_msg", { type: "thread_name_updated", thread_name: "Cart rounding" }),
    line("event_msg", { type: "error", message: "stream closed" }),
  ].join(""));
  return file;
}

function read(file, base, s = newSession(ID, file)) {
  let chunk = base;
  for (let guard = 0; guard < 10000 && chunk; guard++) {
    const r = parseChunk(execFileSync("sh", [extractor, file, String(s.offset), String(chunk), "codex"], { encoding: "utf8" }));
    s.size = r.size;
    for (const e of r.events) apply(s, e);
    s.offset += r.used;
    chunk = nextChunk(s, r.used, chunk, base);
  }
  return s;
}

test("builds turns from a Codex rollout", () => {
  const s = read(rollout(), 1 << 20);
  expect(s.offset).toBe(s.size);
  expect(s.title).toBe("Cart rounding");
  expect(s.turns.map((t) => t.prompt)).toEqual(["Why does the cart test fail?", "What colour?", "Rewrite everything", "Review finished, two nits."]);
  const [plain, image, stopped, peer] = s.turns;

  expect(reply(plain)).toBe("It rounds tax per line.");
  expect(plain.tools).toBe(1);
  expect(plain.model).toBe("gpt-5.5-codex");
  expect(plain.effort).toBe("medium");
  expect(plain.durationMs).toBe(4000);

  expect(image.effort).toBe("high");
  expect(image.images.map((i) => i.mt)).toEqual(["image/png"]);
  expect(image.imgLine).toMatch(/^turn-0002_\d+$/);

  expect(stopped.interrupted).toBe(true);
  expect(stopped.tools).toBe(3);

  expect(peer.sender).toEqual({ kind: "peer", name: "reviewer" });
  expect(reply(peer)).toBe("Noted.");
});

test("counts each model response once, with cached input apart", () => {
  const [plain] = read(rollout(), 1 << 20).turns;
  const st = stats(plain);
  // New input (80-30)+(90-70), cache reads 30+70, output 20+10; the repeat and the empty count add nothing.
  expect(st.input).toBe(70);
  expect(st.cacheRead).toBe(100);
  expect(st.output).toBe(30);
  expect(st.tokens).toBe(70 + 30);
});

test("small chunks give the same turns", () => {
  const file = rollout();
  const whole = read(file, 1 << 20);
  const small = read(file, 200);
  expect(small.turns.map((t) => [t.prompt, reply(t), t.tools, t.durationMs, t.model])).toEqual(whole.turns.map((t) => [t.prompt, reply(t), t.tools, t.durationMs, t.model]));
});

test("a half-written last line waits for the rest", () => {
  const file = rollout();
  const s = read(file, 1 << 20);
  const before = s.turns.length;
  ordinal = 500;
  const next = prompt("turn-0009", [{ type: "text", text: "One more" }]);
  appendFileSync(file, next.slice(0, 40));
  read(file, 1 << 20, s);
  expect(s.turns.length).toBe(before);
  appendFileSync(file, next.slice(40));
  read(file, 1 << 20, s);
  expect(s.turns.at(-1).prompt).toBe("One more");
});

test("no reasoning, tool input or image data reaches the events", () => {
  const file = rollout();
  appendFileSync(file, line("response_item", { type: "reasoning", content: [{ type: "text", text: "SECRET-THOUGHT" }] }));
  appendFileSync(file, line("response_item", { type: "function_call", name: "exec_command", arguments: "SECRET-ARGS" }));
  const out = execFileSync("sh", [extractor, file, "0", String(1 << 20), "codex"], { encoding: "utf8" });
  expect(out).not.toContain("SECRET");
  expect(out).not.toContain(PNG);
  expect(out).not.toContain("environment_context");
});

test("image.sh finds the data on the line before the prompt event", () => {
  const file = rollout();
  const s = read(file, 1 << 20);
  const cache = mkdtempSync(join(tmpdir(), "threads-img-"));
  const u = s.turns[1].imgLine;
  const out = execFileSync("sh", [imager, file, u, cache, ID, "codex"], { encoding: "utf8" });
  const got = JSON.parse(out.trim());
  expect(got.i).toBe(0);
  expect(got.file).toBe(`${u}-0.png`);
  expect(got.file).toMatch(/^[0-9A-Za-z_-]+-\d+\.(png|jpg|gif|webp)$/);
  expect(existsSync(join(cache, ID, got.file))).toBe(true);
  expect(readFileSync(join(cache, ID, got.file)).toString("base64")).toBe(PNG);
});

test("image.sh refuses an id with no ordinal", () => {
  let code = 0;
  try { execFileSync("sh", [imager, rollout(), "turn-0002_x", mkdtempSync(join(tmpdir(), "threads-img-")), ID, "codex"], { stdio: "pipe" }); }
  catch (e) { code = e.status; }
  expect(code).toBe(2);
});

test("a subagent's thread is named by its nickname; a thread of its own has no name", () => {
  expect(read(rollout(), 1 << 20).agentName).toBe(null);
  const file = join(mkdtempSync(join(tmpdir(), "threads-codex-")), "rollout-2026-11-01T09-00-00-00000000-0000-7000-8000-000000000002.jsonl");
  writeFileSync(file, [
    line("session_meta", { id: ID, cwd: "/home/dev/shop", agent_nickname: "Ohm", agent_path: "/root/review", thread_source: "subagent", base_instructions: { text: "x".repeat(9000) } }),
    prompt("turn-0001", [{ type: "text", text: "Review the cart" }]),
    say("Two nits."),
    done(1000),
  ].join(""));
  const s = read(file, 1 << 20);
  expect(s.agentName).toBe("Ohm");
  expect(s.turns.map((t) => t.prompt)).toEqual(["Review the cart"]);
});

// Codex 0.166's pasted image, in the shapes its TUI writes: the message names the image and
// its temporary file around the data, and the prompt event keeps the path and an
// "[Image #1]" placeholder in its text. The turn is still running (no task_complete).
test("a pasted image in a running Codex 0.166 turn reads and decodes", () => {
  ordinal = 0;
  second = 0;
  const file = join(mkdtempSync(join(tmpdir(), "threads-codex-")), `rollout-2026-11-10T01-00-00-${ID}.jsonl`);
  const tmpPng = "/var/folders/xx/yy/T/codex-clipboard-AbCdEf.png";
  writeFileSync(file, [
    line("session_meta", { id: ID, cwd: "/home/dev/shop" }),
    line("event_msg", { type: "task_started" }),
    ctx("gpt-6.1", "medium"),
    line("response_item", { type: "message", role: "user", content: [
      { type: "input_text", text: `<image name=[Image #1] path="${tmpPng}">` },
      { type: "input_image", image_url: `data:image/png;base64,${PNG}`, detail: "high" },
      { type: "input_text", text: "</image>" },
      { type: "input_text", text: "[Image #1] The chips wrap on tablet." },
    ] }),
    line("event_msg", { type: "item_completed", thread_id: ID, turn_id: "turn-0009", item: { type: "UserMessage", id: "m1", content: [
      { type: "local_image", path: tmpPng },
      { type: "text", text: "[Image #1] The chips wrap on tablet.", text_elements: [{ byte_range: { start: 0, end: 10 }, placeholder: "[Image #1]" }] },
    ] } }),
    say("Looking at the chips.", "commentary"),
    tool("exec_command"),
  ].join(""));
  const s = read(file, 1 << 20);
  expect(s.turns).toHaveLength(1);
  const [t] = s.turns;
  expect(t.done).toBe(false);
  expect(t.prompt).toBe("[Image #1] The chips wrap on tablet.");
  expect(t.images.map((i) => i.mt)).toEqual(["image/png"]);
  // The temporary file is gone by the time the pane draws: the data on the message is enough.
  expect(existsSync(tmpPng)).toBe(false);
  const cache = mkdtempSync(join(tmpdir(), "threads-img-"));
  const got = JSON.parse(execFileSync("sh", [imager, file, t.imgLine, cache, ID, "codex"], { encoding: "utf8" }).trim());
  expect(got.i).toBe(0);
  expect(readFileSync(join(cache, ID, got.file)).toString("base64")).toBe(PNG);
});
