// bun test: the extractor over a synthetic Antigravity CLI conversation, built here step by step
// in the shapes agy 1.5.3 writes to <data>/brain/<id>/.system_generated/logs/transcript_full.jsonl,
// with made-up text. Small chunks make turns cross chunk boundaries.
import { test, expect } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply, parseChunk, nextChunk, reply, stats, replaced } from "../mods/agent-threads/turns.js";
import { harnessOf, harnessOfFile, idOfFile, agyFile, agyBrain, agyArgv, HARNESS, MARKS } from "../mods/agent-threads/harness.js";

const root = join(import.meta.dir, "..");
const extractor = join(root, "mods/agent-threads/extract.sh");
const locator = join(root, "mods/agent-threads/locate.sh");
const ID = "00000000-0000-4000-8000-0000000000a9";

const line = (o) => `${JSON.stringify(o)}\n`;
let step = 0;
const at = (sec) => `2026-01-05T15:${String(7 + Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}Z`;
const user = (text, sec, model = null) => line({
  step_index: step++, source: "USER_EXPLICIT", type: "USER_INPUT", status: "DONE", created_at: at(sec),
  content: `<USER_REQUEST>\n${text}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-01-05T09:07:00-06:00.\n</ADDITIONAL_METADATA>${model
    ? `\n<USER_SETTINGS_CHANGE>\nThe user changed setting \`Model Selection\` from None to ${model}. No need to comment on this change if the user doesn't ask about it.\n</USER_SETTINGS_CHANGE>` : ""}`,
});
const plan = (sec, { content, calls = [], tokens = [100, 10, 0], status = "DONE", error } = {}) => line({
  step_index: step++, source: "MODEL", type: "PLANNER_RESPONSE", status, created_at: at(sec),
  ...(content == null ? {} : { content }), input_tokens: tokens[0], output_tokens: tokens[1], cache_read_tokens: tokens[2],
  ...(calls.length ? { tool_calls: calls.map((name) => ({ name, args: { Path: "SECRET-ARGS" } })) } : {}),
  thinking: "SECRET-THOUGHT", ...(error ? { error } : {}),
});
const output = (sec, status = "DONE") => line({
  step_index: step++, source: "MODEL", type: "GENERIC", status, created_at: at(sec), content: "SECRET-OUT",
  ...(status === "ERROR" ? { error: "SECRET-ERR" } : {}),
});

function transcript() {
  step = 0;
  return [
    // A turn with a tool call, its output, then the answer; the model is chosen with it.
    user("Why does the cart test fail?", 0, "Gemini 9 Test (High)"),
    plan(1, { calls: ["read_file"], tokens: [1200, 40, 0] }),
    output(3),
    plan(5, { content: "It rounds tax per line.", tokens: [300, 25, 1100] }),
    // A turn whose tool fails, with text beside the call.
    user("Run the tests", 60),
    plan(61, { content: "Running them.", calls: ["run_command"], tokens: [400, 30, 1300] }),
    output(70, "ERROR"),
    plan(72, { content: "The command failed; the runner is missing.", tokens: [200, 20, 1500] }),
    // Stopped before any answer: the next prompt ends it.
    user("Rewrite everything", 120),
    plan(121, { calls: ["list_dir"] }),
    user("Never mind", 180),
    plan(181, { content: "Stopped.", status: "ERROR", error: "the model stopped" }),
  ].join("");
}

function file(body = transcript()) {
  const data = join(mkdtempSync(join(tmpdir(), "threads-agy-")), "antigravity-cli");
  const f = agyFile(data, ID);
  mkdirSync(join(f, ".."), { recursive: true });
  writeFileSync(f, body);
  return f;
}

// The panel's read loop, with its check for a replaced file.
function read(f, base, s = newSession(ID, f)) {
  let chunk = base;
  for (let guard = 0; guard < 10000 && chunk; guard++) {
    const r = parseChunk(execFileSync("sh", [extractor, f, String(s.offset), String(chunk), "antigravity"], { encoding: "utf8" }));
    if (replaced(s, r)) {
      Object.assign(s, newSession(s.id, s.file), { restarts: (s.restarts ?? 0) + 1 });
      chunk = base;
      continue;
    }
    if (r.head && !s.head) s.head = r.head;
    s.size = r.size;
    for (const e of r.events) apply(s, e);
    s.offset += r.used;
    chunk = nextChunk(s, r.used, chunk, base);
  }
  s.loaded = true;
  return s;
}

test("builds turns from an Antigravity conversation", () => {
  const s = read(file(), 1 << 20);
  expect(s.offset).toBe(s.size);
  expect(s.turns.map((t) => t.prompt)).toEqual(["Why does the cart test fail?", "Run the tests", "Rewrite everything", "Never mind"]);
  const [plain, failed, stopped, last] = s.turns;

  expect(plain.ts).toBe(Date.parse("2026-01-05T15:07:00Z"));
  expect(reply(plain)).toBe("It rounds tax per line.");
  expect(plain.toolNames).toEqual({ read_file: 1 });
  expect(plain.done).toBe(true);
  // The turn ran from its prompt to its answer.
  expect(plain.durationMs).toBe(5000);
  // The model chosen with the first prompt holds for the turns after it.
  expect([plain.model, plain.effort]).toEqual(["Gemini 9 Test", "High"]);
  expect(failed.model).toBe("Gemini 9 Test");
  // input_tokens leaves out the cached ones.
  const st = stats(plain);
  expect([st.input, st.output, st.cacheRead]).toEqual([1500, 65, 1100]);

  // A tool's failure is its output, which stays out; the answer says it. The reply is the
  // text after the last tool call.
  expect(reply(failed)).toBe("The command failed; the runner is missing.");
  expect(failed.toolNames).toEqual({ run_command: 1 });
  expect(failed.errors).toEqual([]);
  expect(failed.done).toBe(true);

  expect(stopped.done).toBe(true);
  expect(reply(stopped)).toBe("");
  expect(last.errors).toEqual(["the model stopped"]);
});

test("small chunks give the same turns as one read", () => {
  const f = file();
  const whole = read(f, 1 << 20);
  const pieces = read(f, 300);
  const view = (s) => s.turns.map((t) => [t.prompt, t.ts, reply(t), t.tools, t.done, t.durationMs, t.model]);
  expect(pieces.turns.length).toBe(4);
  expect(view(pieces)).toEqual(view(whole));
});

test("tool input and output and thinking stay out", () => {
  const out = execFileSync("sh", [extractor, file(), "0", String(1 << 20), "antigravity"], { encoding: "utf8" });
  expect(out).not.toContain("SECRET");
  expect(out).not.toContain("ADDITIONAL_METADATA");
});

test("a conversation added to is read on from the offset", () => {
  step = 0;
  const f = file(user("First", 0) + plan(2, { content: "One." }));
  const s = read(f, 1 << 20);
  expect(s.turns.map((t) => t.prompt)).toEqual(["First"]);
  appendFileSync(f, user("Second", 60) + plan(62, { content: "Two." }));
  read(f, 1 << 20, s);
  expect(s.restarts ?? 0).toBe(0);
  expect(s.turns.map((t) => reply(t))).toEqual(["One.", "Two."]);
});

test("the harness knows agy, its files and its command line", () => {
  expect(harnessOf({ argv: ["/home/dev/.local/bin/agy", "--prompt-interactive", "hi"], name: "agy" })).toBe("antigravity");
  expect(harnessOf({ name: "agy" })).toBe("antigravity");
  expect(HARNESS.antigravity.name).toBe("Antigravity");
  expect(MARKS.antigravity.icon).toBe("logo-antigravity");
  const f = agyFile("/home/dev/.gemini/antigravity-cli", ID);
  expect(f).toBe(`/home/dev/.gemini/antigravity-cli/brain/${ID}/.system_generated/logs/transcript_full.jsonl`);
  expect(harnessOfFile(f)).toBe("antigravity");
  expect(harnessOfFile(f.replace("_full", ""))).toBe("antigravity");
  expect(idOfFile(f)).toBe(ID);
  expect(agyBrain(`/home/dev/.gemini/antigravity-cli/brain/${ID}`)).toEqual({ data: "/home/dev/.gemini/antigravity-cli", id: ID });
  expect(agyBrain("/home/dev/.gemini/antigravity-cli/brain")).toBe(null);
  expect(agyArgv(["agy", "--conversation", ID])).toEqual({ id: ID, cont: false });
  expect(agyArgv(["agy", `--conversation=${ID}`])).toEqual({ id: ID, cont: false });
  expect(agyArgv(["agy", "-c"])).toEqual({ id: null, cont: true });
  expect(agyArgv(["agy", "--prompt-interactive", "hello"])).toEqual({ id: null, cont: false });
});

test("locate.sh agy-open names the conversation folder a process holds open", async () => {
  const data = realpathSync(join(mkdtempSync(join(tmpdir(), "threads-agy-")), "."));
  const brain = join(data, "brain", ID);
  mkdirSync(join(brain, ".system_generated", "logs"), { recursive: true });
  writeFileSync(join(brain, ".system_generated", "logs", "transcript_full.jsonl"), user("Hi", 0));
  // A stand-in process whose working folder is the conversation's: lsof lists it like agy's
  // open folder.
  const p = spawn("sleep", ["20"], { cwd: brain, stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 300));
    const out = execFileSync("sh", [locator, "agy-open", String(p.pid)], { encoding: "utf8" }).trim();
    expect(out).toBe(brain);
  } finally {
    p.kill();
  }
  expect(execFileSync("sh", [locator, "agy-dir"], { encoding: "utf8", env: { ...process.env, AGY_DATA_DIR: data } }).trim()).toBe(data);
});
