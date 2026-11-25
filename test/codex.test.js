// bun test: the extractor over a synthetic Codex rollout, built here line by line in the shapes
// Codex writes, with made-up text. Small chunks make turns cross chunk boundaries.
import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply, parseChunk, nextChunk, reply, stats, sessionStats } from "../mods/agent-threads/core/turns.js";

const root = join(import.meta.dir, "..");
const extractor = join(root, "mods/agent-threads/core/extract.sh");
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
  // A text step and a call carry their times; this call records no id, so no result joins it.
  expect(plain.steps).toEqual([{ k: "text", t: "Looking at the cart test.", cut: false, at: Date.parse("2026-01-02T03:00:04.000Z") },
    { k: "group", calls: ["exec_command"], count: 1, info: [{ in: null, at: Date.parse("2026-01-02T03:00:05.000Z"), rt: null, f: null }] }]);
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

test("no reasoning or image data reaches the events, and a call's input only as its summary of up to 120 characters", () => {
  const file = rollout();
  appendFileSync(file, line("response_item", { type: "reasoning", content: [{ type: "text", text: "SECRET-THOUGHT" }] }));
  appendFileSync(file, line("response_item", { type: "function_call", name: "exec_command", call_id: "call_s1", arguments: JSON.stringify({ cmd: "ls cart", extra: "SECRET-ARGS" }) }));
  appendFileSync(file, line("response_item", { type: "function_call", name: "exec_command", call_id: "call_s2", arguments: JSON.stringify({ cmd: `echo ${"a".repeat(300)} SECRET-TAIL` }) }));
  appendFileSync(file, line("response_item", { type: "function_call_output", call_id: "call_s1", output: JSON.stringify({ output: "SECRET-OUTPUT", metadata: { exit_code: 0 } }) }));
  const out = execFileSync("sh", [extractor, file, "0", String(1 << 20), "codex"], { encoding: "utf8" });
  expect(out).not.toContain("SECRET");
  const calls = parseChunk(out).events.filter((e) => e.k === "u" && e.id?.startsWith("call_s"));
  expect(calls.map((e) => e.in)).toEqual(["ls cart", `echo ${"a".repeat(115)}`]);
  expect(parseChunk(out).events.filter((e) => e.k === "x" && e.id === "call_s1").map((e) => e.f)).toEqual([false]);
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

test("level 3: Codex calls carry their call ids, and calls.sh reads each one's input and output by id", () => {
  ordinal = 0;
  second = 0;
  const dir = mkdtempSync(join(tmpdir(), "threads-codex-calls-"));
  const file = join(dir, `rollout-2026-01-02T03-00-00-${ID}.jsonl`);
  const call = (type, id, extra) => line("response_item", { type, call_id: id, ...extra });
  writeFileSync(file, [
    line("session_meta", { id: ID, cwd: "/home/dev/shop" }),
    prompt("turn-0001", [{ type: "text", text: "Fix the cart total" }]),
    call("function_call", "call_e1", { name: "exec_command", arguments: JSON.stringify({ cmd: "bun test cart", workdir: "/home/dev/shop" }) }),
    call("function_call_output", "call_e1", { output: "Chunk ID: 1a\nWall time: 1.2 seconds\nProcess exited with code 1\nOutput:\n1 fail" }),
    call("function_call", "call_s1", { name: "shell", arguments: JSON.stringify({ command: ["bash", "-lc", "ls src"] }) }),
    call("function_call_output", "call_s1", { output: JSON.stringify({ output: "cart.ts\ntax.ts", metadata: { exit_code: 0 } }) }),
    call("custom_tool_call", "call_p1", { name: "apply_patch", input: "*** Begin Patch\n*** Update File: src/cart.ts\n@@\n-a\n+b\n*** End Patch" }),
    call("custom_tool_call_output", "call_p1", { output: JSON.stringify({ output: "Success.", metadata: { exit_code: 0 } }) }),
    call("custom_tool_call", "call_x1", { name: "exec", input: 'const r = await tools.exec_command({cmd:"rg \\"total\\" src"});\ntext(r)' }),
    call("custom_tool_call_output", "call_x1", { output: [{ type: "input_text", text: "Script completed\nWall time 0.2 seconds\nOutput:\n" }, { type: "input_text", text: '{"chunk_id":"9","exit_code":2,"output":"rg: src: no such file"}' }] }),
    call("local_shell_call", "call_l1", { action: { type: "exec", command: ["git", "status"] } }),
    call("function_call", "call_j1", { name: "js", arguments: JSON.stringify({ code: "await x()", title: "Read the cart" }) }),
    call("function_call_output", "call_j1", { output: "Script failed\nTypeError" }),
    say("Fixed."),
    done(9000),
  ].join(""));
  const ev = execFileSync("sh", [extractor, file, "0", String(1 << 20), "codex"], { encoding: "utf8" }).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  expect(ev.filter((e) => e.k === "u").map((e) => `${e.n}:${e.id}`)).toEqual(["exec_command:call_e1", "shell:call_s1", "apply_patch:call_p1", "exec:call_x1", "shell:call_l1", "js:call_j1"]);
  // A call's input reaches the events only as its summary, the same calls.sh shows, and its
  // result as a time and whether it failed: no output text.
  const brief = Object.fromEntries(ev.filter((e) => e.k === "u").map((e) => [e.id, e.in]));
  const failed = Object.fromEntries(ev.filter((e) => e.k === "x").map((e) => [e.id, e.f]));
  expect(JSON.stringify(ev)).not.toContain("no such file");
  const s = newSession(ID, file);
  for (const e of ev) apply(s, e);
  expect(s.turns[0].steps[0].ids).toEqual(["call_e1", "call_s1", "call_p1", "call_x1", "call_l1", "call_j1"]);
  const calls = join(root, "mods/agent-threads/core/calls.sh");
  const got = execFileSync("sh", [calls, file, "codex", ...s.turns[0].steps[0].ids], { encoding: "utf8" }).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const ins = Object.fromEntries(got.filter((x) => x.k === "in").map((x) => [x.id, x.in]));
  expect(ins).toEqual({ call_e1: "bun test cart", call_s1: "ls src", call_p1: "src/cart.ts", call_x1: 'rg "total" src', call_l1: "git status", call_j1: "Read the cart" });
  expect(brief).toEqual(ins);
  const outs = Object.fromEntries(got.filter((x) => x.k === "out").map((x) => [x.id, x]));
  expect(Object.keys(outs).sort()).toEqual(["call_e1", "call_j1", "call_p1", "call_s1", "call_x1"]);
  expect(outs.call_s1).toMatchObject({ out: "cart.ts\ntax.ts", err: false, lines: 2 });
  expect(outs.call_p1).toMatchObject({ out: "Success.", err: false });
  // Failed: a nonzero exit, a command its script ran that exited with a code, a failed script.
  expect(outs.call_e1.err).toBe(true);
  expect(outs.call_x1.err).toBe(true);
  expect(outs.call_j1.err).toBe(true);
  expect(outs.call_x1.out).toContain("rg: src: no such file");
  expect(failed).toEqual(Object.fromEntries(Object.entries(outs).map(([id, x]) => [id, x.err])));
  expect(outs.call_e1.ts).toMatch(/^2026-01-02T03:/);
});

// TRD-17: each count states the window of the model that answered it (model_context_window).
// The ring uses the newest count's own window, so a model changed mid-session shows from its
// first count, and a count with no window shows no ring rather than the last one's.
test("the context window comes from the newest count, through a model change", () => {
  ordinal = 0;
  second = 0;
  const win = (total, input, cached, output, w) => line("event_msg", { type: "token_count",
    info: { total_token_usage: { total_tokens: total }, last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output }, ...(w === undefined ? {} : { model_context_window: w }) } });
  const dir = mkdtempSync(join(tmpdir(), "threads-codex-"));
  const file = join(dir, `rollout-2026-01-02T03-00-00-${ID}.jsonl`);
  const head = [line("session_meta", { id: ID, cwd: "/home/dev/shop" }), ctx("gpt-5.5-codex", "medium"), prompt("turn-0001", [{ type: "text", text: "Why does the cart test fail?" }]), win(100, 64600, 60000, 20, 258400), say("It rounds tax per line."), done(1000)];
  writeFileSync(file, head.join(""));
  const at = (lines) => { appendFileSync(file, lines.join("")); return sessionStats(read(file, 1 << 20).turns); };
  let st = sessionStats(read(file, 1 << 20).turns);
  expect([st.context, st.contextPct]).toEqual([64600, 25]);
  // Another model for the next turn: until it answers, the ring stays with the count it has.
  st = at([ctx("gpt-5.5-codex-max", "high"), prompt("turn-0002", [{ type: "text", text: "Fix it" }])]);
  expect([st.context, st.contextPct]).toEqual([64600, 25]);
  // Its first count states its own window.
  st = at([win(300, 95000, 90000, 30, 475000)]);
  expect([st.context, st.contextPct]).toEqual([95000, 20]);
  // A count that states no window (or a zero or a string one): the context stays, the ring goes.
  for (const w of [undefined, 0, "475000", null]) {
    st = at([win(400 + second, 96000, 90000, 30, w)]);
    expect([st.context, st.contextPct]).toEqual([96000, null]);
  }
  // Over the window (a count Codex wrote just before it compacted): the real percent.
  st = at([win(900, 480000, 400000, 30, 475000)]);
  expect(st.contextPct).toBe(101);
});

// ---- goals: work the agent starts on its own after a turn completed (TRD-164) ----------------

function goalRollout() {
  ordinal = 0;
  second = 0;
  const dir = mkdtempSync(join(tmpdir(), "threads-codex-goal-"));
  const file = join(dir, `rollout-2026-01-02T03-00-00-${ID}.jsonl`);
  writeFileSync(file, [
    line("session_meta", { id: ID, cwd: "/home/dev/shop" }),
    ctx("gpt-5.5-codex", "medium"),
    prompt("turn-0001", [{ type: "text", text: "Check the build." }]),
    say("Build passed.", "final_answer"),
    done(4000),
    // A goal task starts with no typed prompt: its injected instruction is internal context,
    // not a row's text. The task makes a tool call before its own answer.
    line("event_msg", { type: "task_started", id: "task-0009", turn_attribution: { trigger: "goal" } }),
    context("<goal>Keep watching the build.</goal>"),
    tool("exec_command"),
    say("Tests passed.", "final_answer"),
    done(6000),
    // A typed prompt after the goal task: its own row, typed as the person's.
    ctx("gpt-5.5-codex", "medium"),
    prompt("turn-0002", [{ type: "text", text: "Summarise." }]),
    say("All green.", "final_answer"),
    done(1000),
  ].join(""));
  return file;
}

test("a Codex goal has its own row and leaves the completed answer whole", () => {
  const s = read(goalRollout(), 1 << 20);
  expect(s.turns.map((t) => t.prompt)).toEqual(["Check the build.", "", "Summarise."]);
  const [build, goal, sum] = s.turns;
  // The first turn keeps its whole answer even though the goal made a call after it.
  expect(reply(build)).toBe("Build passed.");
  expect(build.steps).toEqual([]);
  expect(build.done).toBe(true);
  // The goal row: a sender that names the trigger, no injected prompt, its own reply.
  expect(goal.origin).toBe("goal");
  expect(goal.sender).toEqual({ kind: "goal" });
  expect(goal.agent).toBe(true);
  expect(goal.prompt).toBe("");
  expect(goal.tools).toBe(1);
  expect(reply(goal)).toBe("Tests passed.");
  expect(goal.done).toBe(true);
  // A typed prompt after it is a typed row again.
  expect(sum.sender).toEqual({ kind: "you" });
  expect(reply(sum)).toBe("All green.");
});

test("goal rows and replies survive a rollout replacement", () => {
  const file = goalRollout();
  // A read whose chunks cross line boundaries, then one whole: the same turns.
  const whole = read(file, 1 << 20);
  const pieced = read(file, 90);
  expect(pieced.turns.map((t) => t.prompt)).toEqual(whole.turns.map((t) => t.prompt));
  expect(pieced.turns.map(reply)).toEqual(whole.turns.map(reply));
  expect(pieced.turns.map((t) => t.sender.kind)).toEqual(["you", "goal", "you"]);
  // And a second read of the same records from the top: no answer moved or doubled.
  const again = read(file, 1 << 20, newSession(ID, file));
  expect(again.turns.map(reply)).toEqual(whole.turns.map(reply));
  expect(again.turns.map((t) => t.steps.map((st) => st.k))).toEqual(whole.turns.map((t) => t.steps.map((st) => st.k)));
});

test("work after a completed task with no start record gets a background row", () => {
  ordinal = 0;
  second = 0;
  const dir = mkdtempSync(join(tmpdir(), "threads-codex-bg-"));
  const file = join(dir, `rollout-2026-01-02T03-00-00-${ID}.jsonl`);
  writeFileSync(file, [
    line("session_meta", { id: ID, cwd: "/home/dev/shop" }),
    ctx("gpt-5.5-codex", "medium"),
    prompt("turn-0001", [{ type: "text", text: "Check the build." }]),
    say("Build passed.", "final_answer"),
    done(4000),
    // No task_started the reader can see: model work after the hard close.
    tool("exec_command"),
    say("Rechecked the logs.", "final_answer"),
    done(2000),
  ].join(""));
  const s = read(file, 1 << 20);
  expect(s.turns.map((t) => t.prompt)).toEqual(["Check the build.", ""]);
  expect(reply(s.turns[0])).toBe("Build passed.");
  expect(s.turns[1].sender).toEqual({ kind: "background" });
  expect(reply(s.turns[1])).toBe("Rechecked the logs.");
});
