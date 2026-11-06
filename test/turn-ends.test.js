// bun test: where a row ends and which prompts get a row, through the real extractor, in the
// line shapes of Claude Code 2.1.316. It writes turn_duration for most turns but not all, and
// a prompt sent while it works is an attachment line with no user line. All content is made up.
import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply, parseChunk, nextChunk, reply, threadMatches } from "../mods/agent-threads/turns.js";

const root = join(import.meta.dir, "..");
const extractor = join(root, "mods/agent-threads/extract.sh");
const imager = join(root, "mods/agent-threads/image.sh");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// A small transcript writer. The clock moves only when a line says so.
function transcript() {
  const lines = [];
  let clock = Date.parse("2026-11-01T09:00:00Z");
  let n = 0;
  let parent = null;
  const stamp = (secs = 1) => new Date((clock += secs * 1000)).toISOString();
  const add = (o) => {
    lines.push(JSON.stringify(o));
    if (o.uuid) parent = o.uuid;
    return o.uuid;
  };
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const line = (fields) => ({ parentUuid: parent, isSidechain: false, ...fields, uuid: uuid() });
  const t = {
    lines,
    user: (content, fields = {}, secs = 1) => add({ ...line({ type: "user", message: { role: "user", content }, ...fields }), timestamp: stamp(secs) }),
    prompt: (text, secs = 30) => t.user(text, { origin: { kind: "human" } }, secs),
    notify: (secs = 60) => t.user("<task-notification>a job finished</task-notification>", { origin: { kind: "task-notification" } }, secs),
    // The shape a skill or custom command has: the command line, then its text as a meta line
    // naming the command line as parent.
    skill: (name, secs = 30) => {
      t.user(`<command-message>${name}</command-message>\n<command-name>/${name}</command-name>`, { origin: { kind: "human" } }, secs);
      t.user("Text of the skill, sent to the model.", { isMeta: true }, 0);
    },
    // The shape a local command has: no origin, a caveat before it and its output after it.
    local: (name, secs = 5) => {
      t.user("<local-command-caveat>Caveat text</local-command-caveat>", { isMeta: true }, secs);
      t.user(`<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<command-args></command-args>`, {}, 0);
      t.user("<local-command-stdout>its output</local-command-stdout>", {}, 0);
    },
    queued: (prompt, kind = "human", extra = {}, secs = 5) => add({ ...line({ type: "attachment",
      attachment: { type: "queued_command", prompt, commandMode: "prompt", origin: { kind, ...(extra.name ? { name: extra.name } : {}) }, ...(extra.isMeta ? { isMeta: true } : {}), ...(extra.ids ? { imagePasteIds: extra.ids } : {}) } }), timestamp: stamp(secs) }),
    message: (id, blocks, stop, secs = 2) => blocks.forEach((b, i) => add({ ...line({ type: "assistant", apiBlockIndex: i,
      message: { id, model: "claude-opus-5-5", role: "assistant", type: "message", content: [b], stop_reason: stop, usage: { input_tokens: 5, output_tokens: 10 } } }), timestamp: stamp(i ? 0 : secs) })),
    say: (id, text, secs = 2) => t.message(id, [{ type: "text", text }], "end_turn", secs),
    tool: (id, name = "Bash", secs = 2) => {
      t.message(id, [{ type: "tool_use", id: `tu_${id}`, name, input: {} }], "tool_use", secs);
      t.user([{ type: "tool_result", tool_use_id: `tu_${id}`, content: "ok" }], { toolUseResult: { stdout: "ok" } });
    },
    // A tool call whose result never comes, as a long-lived background tool leaves it.
    stuckTool: (id, name = "Monitor") => t.message(id, [{ type: "tool_use", id: `tu_${id}`, name, input: {} }], "tool_use"),
    hooks: () => add({ ...line({ type: "system", subtype: "stop_hook_summary", hookCount: 1 }), timestamp: stamp(0) }),
    duration: (ms) => add({ ...line({ type: "system", subtype: "turn_duration", durationMs: ms }), timestamp: stamp(0) }),
    // Bookkeeping attachments, in both key orders, that must stay out.
    noise: () => {
      add({ ...line({ type: "attachment", attachment: { type: "skill_listing", content: "duplicate, must be skipped" } }) });
      lines.push(JSON.stringify({ type: "attachment", attachment: { type: "instructions", prompt: "duplicate, must be skipped" }, uuid: uuid() }));
    },
    file: () => {
      const f = join(mkdtempSync(join(tmpdir(), "threads-ends-")), "t.jsonl");
      writeFileSync(f, `${lines.join("\n")}\n`);
      return f;
    },
  };
  return t;
}

function read(file, base = 1 << 20) {
  const s = newSession("s", file);
  let chunk = base;
  for (let guard = 0; guard < 10000 && chunk; guard++) {
    const r = parseChunk(execFileSync("sh", [extractor, file, String(s.offset), String(chunk)], { encoding: "utf8" }));
    s.size = r.size;
    for (const e of r.events) apply(s, e);
    s.offset += r.used;
    chunk = nextChunk(s, r.used, chunk, base);
  }
  return s;
}
const prompts = (s) => s.turns.map((t) => t.prompt);

test("a skill typed with a row still open gets its own row, and the model's work goes on it", () => {
  const t = transcript();
  t.prompt("First question");
  t.tool("m1");
  t.skill("catchup");
  t.tool("m2");
  t.say("m3", "The catch-up reply.");
  t.hooks();
  const s = read(t.file());
  expect(prompts(s)).toEqual(["First question", "/catchup"]);
  expect(s.turns[1].cmd).toBe(true);
  expect(s.turns[1].agent).toBe(false);
  expect(s.turns[1].tools).toBe(1);
  expect(reply(s.turns[1])).toBe("The catch-up reply.");
  expect(s.turns[0].done).toBe(true);
  expect(s.turns[0].answeredBy).toBe(2);
  expect(s.open).toEqual([]);
});

test("a skill keeps its row when a chunk ends between its two lines", () => {
  const t = transcript();
  t.prompt("First question");
  t.tool("m1");
  t.skill("catchup");
  t.say("m2", "The catch-up reply.");
  t.hooks();
  const file = t.file();
  expect(prompts(read(file, 200))).toEqual(prompts(read(file)));
  expect(prompts(read(file, 200))).toContain("/catchup");
});

test("a local command typed during a turn takes no row", () => {
  const t = transcript();
  t.prompt("First question");
  t.tool("m1");
  t.local("usage");
  t.tool("m2");
  t.say("m3", "The reply.");
  t.hooks();
  const s = read(t.file());
  expect(prompts(s)).toEqual(["First question"]);
  expect(s.turns[0].tools).toBe(2);
  expect(reply(s.turns[0])).toBe("The reply.");
});

test("a local command typed during a background update takes no row", () => {
  const t = transcript();
  t.prompt("First question");
  t.say("m1", "The reply.");
  t.hooks();
  t.notify();
  t.tool("m2");
  t.local("usage");
  t.say("m3", "An update.");
  t.hooks();
  const s = read(t.file());
  expect(prompts(s)).toEqual(["First question"]);
  expect(reply(s.turns[0])).toBe("The reply.");
  expect(s.turns[0].latest).toBe("An update.");
});

test("a local command between turns takes no row, and a skill between turns still does", () => {
  const t = transcript();
  t.prompt("First question");
  t.say("m1", "The reply.");
  t.hooks();
  t.local("login");
  t.skill("catchup");
  t.say("m2", "The catch-up reply.");
  t.hooks();
  expect(prompts(read(t.file()))).toEqual(["First question", "/catchup"]);
});

test("with no turn_duration a finished reply closes the row, and later updates do not grow it into hours", () => {
  const t = transcript();
  t.prompt("First question");
  t.tool("m1", "Bash", 10);
  t.say("m2", "The reply.", 10);
  t.hooks();
  const started = 21; // tool at +10, its result at +1, the reply at +10
  for (let i = 0; i < 40; i++) {
    t.notify(3600);
    t.tool(`n${i}`, "Bash", 2);
    t.say(`r${i}`, `Update ${i}.`, 2);
    t.hooks();
  }
  const s = read(t.file());
  expect(s.turns.length).toBe(1);
  const [row] = s.turns;
  expect(row.done).toBe(true);
  expect(s.open).toEqual([]);
  expect(reply(row)).toBe("The reply.");
  expect(row.latest).toBe("Update 39.");
  expect(row.followups).toBe(40);
  expect(row.tools).toBe(41);
  // The work, not the 40 hours on the wall: each update took 5 s.
  expect(row.durationMs).toBe((started + 40 * 5) * 1000);
});

test("the reply's own message closes the row, so a session with no Stop hooks ends too", () => {
  const t = transcript();
  t.prompt("First question");
  t.say("m1", "The reply.");
  const s = read(t.file());
  expect(s.turns[0].done).toBe(true);
  expect(s.open).toEqual([]);
});

test("a message's thinking line does not close the row before its text", () => {
  const t = transcript();
  t.prompt("First question");
  t.message("m1", [{ type: "thinking", thinking: "…" }], "end_turn");
  let s = read(t.file());
  expect(s.turns[0].done).toBe(false);
  t.message("m1", [{ type: "text", text: "The reply." }], "end_turn");
  s = read(t.file());
  expect(s.turns[0].done).toBe(true);
  expect(reply(s.turns[0])).toBe("The reply.");
});

test("a tool call whose result never comes holds nothing open", () => {
  const t = transcript();
  t.prompt("Watch the build");
  t.stuckTool("m1");
  t.say("m2", "Watching it in the background.");
  t.hooks();
  t.notify(3600);
  t.say("m3", "It passed.");
  t.hooks();
  t.prompt("Next question");
  t.say("m4", "Next reply.");
  t.hooks();
  const s = read(t.file());
  expect(prompts(s)).toEqual(["Watch the build", "Next question"]);
  expect(s.turns.every((x) => x.done)).toBe(true);
  expect(reply(s.turns[0])).toBe("Watching it in the background.");
  expect(s.turns[0].durationMs).toBeLessThan(10000);
  expect(s.open).toEqual([]);
});

test("turn_duration replaces the estimate, and is not added to it", () => {
  const t = transcript();
  t.prompt("First question");
  t.say("m1", "The reply.", 7);
  t.hooks();
  t.duration(9000);
  const s = read(t.file());
  expect(s.turns[0].durationMs).toBe(9000);
  // Live, the estimate shows until the line comes.
  const u = transcript();
  u.prompt("First question");
  u.say("m1", "The reply.", 7);
  u.hooks();
  expect(read(u.file()).turns[0].durationMs).toBe(7000);
});

test("a Stop hook that sends the model back keeps one row, and the last reply is its reply", () => {
  const t = transcript();
  t.prompt("First question");
  t.say("m1", "Done, I think.");
  t.hooks();
  t.tool("m2");
  t.say("m3", "Done now.");
  t.hooks();
  t.duration(20000);
  const s = read(t.file());
  expect(s.turns.length).toBe(1);
  expect(reply(s.turns[0])).toBe("Done now.");
  expect(s.turns[0].durationMs).toBe(20000);
  expect(s.turns[0].done).toBe(true);
});

test("a prompt sent while Claude works gets a row, and answers together with the open row", () => {
  const t = transcript();
  t.prompt("First question");
  t.tool("m1");
  t.queued("A second thought");
  t.tool("m2");
  t.say("m3", "An answer to both.");
  t.hooks();
  const s = read(t.file());
  expect(prompts(s)).toEqual(["First question", "A second thought"]);
  expect(s.turns[1].agent).toBe(false);
  expect(s.turns[1].tools).toBe(1);
  expect(reply(s.turns[1])).toBe("An answer to both.");
  expect(s.turns[0].answeredBy).toBe(2);
  expect(s.turns.every((x) => x.done)).toBe(true);
});

test("a new prompt ends an open row that has its reply, at that row's own last activity", () => {
  const t = transcript();
  t.prompt("First question");
  t.say("m1", "A reply, with no stop line.");
  // Nothing closes it on the way: the line is rewritten as the older shape with no stop_reason.
  t.lines[t.lines.length - 1] = t.lines[t.lines.length - 1].replace('"stop_reason":"end_turn"', '"stop_reason":null');
  t.queued("A later question", "human", {}, 600);
  let s = read(t.file());
  expect(s.turns[0].done).toBe(true);
  expect(s.turns[0].answeredBy).toBe(null);
  expect(s.turns[0].durationMs).toBeLessThan(60000);
  expect(s.turns[1].done).toBe(false);
  t.say("m2", "The later reply.");
  s = read(t.file());
  expect(reply(s.turns[0])).toBe("A reply, with no stop line.");
  expect(reply(s.turns[1])).toBe("The later reply.");
});

test("a queued peer message gets its row and name; a queued notification does not; bookkeeping stays out", () => {
  const t = transcript();
  t.prompt("First question");
  t.tool("m1");
  t.noise();
  t.queued('<agent-message from="helper">From the helper</agent-message>', "peer", { name: "helper", isMeta: true });
  t.queued("<task-notification>a job finished</task-notification>", "task-notification");
  t.noise();
  t.say("m2", "A reply.");
  t.hooks();
  const s = read(t.file());
  expect(prompts(s)).toEqual(["First question", "From the helper"]);
  expect(s.turns[1].sender.name).toBe("helper");
  expect(s.turns[1].agent).toBe(true);
  expect(JSON.stringify(s)).not.toContain("must be skipped");
});

test("a queued prompt's pasted image is read from its attachment line", () => {
  const t = transcript();
  t.prompt("First question");
  t.tool("m1");
  t.queued([{ type: "text", text: "[Image #4] Look at this" }, { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }], "human", { ids: [4] });
  t.say("m2", "A reply.");
  t.hooks();
  const file = t.file();
  const s = read(file);
  const row = s.turns[1];
  expect(row.prompt).toBe("[Image #4] Look at this");
  expect(row.images).toEqual([{ mt: "image/png", n: 4, src: null }]);
  const cache = mkdtempSync(join(tmpdir(), "threads-ends-img-"));
  const out = execFileSync("sh", [imager, file, row.imgLine, cache, "sess"], { encoding: "utf8" }).trim();
  expect(JSON.parse(out).i).toBe(0);
  expect(readdirSync(join(cache, "sess")).length).toBe(1);
});

test("an API error ends the turn", () => {
  const t = transcript();
  t.prompt("First question");
  t.tool("m1");
  t.lines.push(JSON.stringify({ parentUuid: null, isSidechain: false, type: "assistant", isApiErrorMessage: true, uuid: "00000000-0000-4000-8000-0000000000ee", timestamp: "2026-11-01T10:00:00.000Z",
    message: { id: "m2", model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "API Error: overloaded" }], stop_reason: "stop_sequence" } }));
  const s = read(t.file());
  expect(s.turns[0].done).toBe(true);
  expect(s.turns[0].errors).toEqual(["API Error: overloaded"]);
});

// A line Claude Code writes itself when a turn is cut off.
function cutOff(t, text) {
  t.lines.push(JSON.stringify({ parentUuid: null, isSidechain: false, type: "assistant", uuid: `00000000-0000-4000-8000-${String(t.lines.length).padStart(12, "0")}`, timestamp: "2026-11-01T10:00:00.000Z",
    message: { id: `cut${t.lines.length}`, model: "<synthetic>", role: "assistant", content: [{ type: "text", text }], stop_reason: "stop_sequence" } }));
}

test("a row with only No response requested is answered in the next prompt's row", () => {
  const t = transcript();
  t.prompt("The question");
  cutOff(t, "No response requested.");
  t.prompt("You were restarted, carry on");
  t.tool("m1");
  t.say("m2", "The answer.");
  t.hooks();
  const s = read(t.file());
  expect(s.turns[0].answeredIn).toBe(2);
  expect(s.turns[0].answeredBy).toBe(null);
  expect(reply(s.turns[0])).toBe("");
  expect(s.turns[1].answeredIn).toBe(null);
});

for (const text of ["You've hit your weekly limit · resets Nov 7 at 2pm (America/Chicago)", "You've hit your session limit · resets 3:30am (America/Chicago)", "Claude usage limit reached. Your limit will reset at 5pm", "API Error: 429 rate limited"]) {
  test(`a limit message counts as cut off: ${text.slice(0, 32)}`, () => {
    const t = transcript();
    t.prompt("The question");
    cutOff(t, text);
    t.prompt("Try again");
    t.say("m1", "The answer.");
    expect(read(t.file()).turns[0].answeredIn).toBe(2);
  });
}

for (const text of ["API Error: Can't reach the API server", "Claude Code can't use your Claude subscription", "Please run /login · API Error: 401 Invalid bearer token"]) {
  test(`other errors stay what they are: ${text.slice(0, 32)}`, () => {
    const t = transcript();
    t.prompt("The question");
    cutOff(t, text);
    t.prompt("Try again");
    t.say("m1", "The answer.");
    const s = read(t.file());
    expect(s.turns[0].answeredIn).toBe(null);
    expect(s.turns[0].errors).toEqual([text]);
  });
}

test("several rows cut off in a row all point at the reply that follows", () => {
  const t = transcript();
  t.prompt("Earlier");
  t.say("m0", "An earlier reply.");
  t.hooks();
  t.prompt("The question");
  cutOff(t, "No response requested.");
  t.prompt("Restarted once");
  cutOff(t, "You've hit your session limit · resets 3pm");
  t.prompt("Restarted twice");
  t.say("m1", "The answer.");
  t.hooks();
  const s = read(t.file());
  expect(s.turns.map((x) => x.answeredIn)).toEqual([null, 4, 4, null]);
});

test("no row claims an answer until a reply comes, and an interrupted row claims none", () => {
  const t = transcript();
  t.prompt("The question");
  cutOff(t, "No response requested.");
  t.prompt("Restarted");
  t.tool("m1");
  let s = read(t.file());
  expect(s.turns[0].answeredIn).toBe(null);
  t.user("[Request interrupted by user]", {});
  s = read(t.file());
  expect(s.turns[0].answeredIn).toBe(null);
  expect(s.turns[1].interrupted).toBe(true);
  t.prompt("Once more");
  t.say("m2", "A reply.");
  s = read(t.file());
  // The interrupted row between them ends the chain.
  expect(s.turns[1].answeredIn).toBe(null);
  expect(s.turns[0].answeredIn).toBe(null);
});

test("a row and its answer find each other in a search, and nothing else does", () => {
  const t = transcript();
  t.prompt("Why do walruses have tusks?");
  cutOff(t, "No response requested.");
  t.prompt("You were restarted, carry on");
  t.say("m1", "They use them to haul out on ice.");
  t.hooks();
  t.prompt("Something else");
  t.say("m2", "Another reply.");
  t.hooks();
  const s = read(t.file());
  const found = (q) => s.turns.filter((x) => threadMatches(s.turns, x, q)).map((x) => x.n);
  expect(found("haul out")).toEqual([1, 2]);
  expect(found("walruses")).toEqual([1, 2]);
  expect(found("carry on")).toEqual([2]);
  expect(found("Another")).toEqual([3]);
  expect(found("")).toEqual([1, 2, 3]);
});
