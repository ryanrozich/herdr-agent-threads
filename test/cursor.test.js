// bun test: the extractor over a synthetic Cursor agent transcript, built here line by line in the
// shapes cursor-agent 2026.11.05 writes, with made-up text. Small chunks make turns cross chunk
// boundaries.
import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, utimesSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession, apply, parseChunk, nextChunk, reply, stats, replaced } from "../mods/agent-threads/turns.js";
import { harnessOf, harnessOfFile, idOfFile, cursorFolder, cursorStore, cursorArgv, cursorRoots, HARNESS } from "../mods/agent-threads/harness.js";

const root = join(import.meta.dir, "..");
const extractor = join(root, "mods/agent-threads/extract.sh");
const locator = join(root, "mods/agent-threads/locate.sh");
const ID = "00000000-0000-4000-8000-00000000000c";

const line = (o) => `${JSON.stringify(o)}\n`;
const user = (text, at = "Monday, Jan 5, 2026, 9:07 AM (UTC-6)") =>
  line({ role: "user", message: { content: [{ type: "text", text: `<timestamp>${at}</timestamp>\n<user_query>\n${text}\n</user_query>` }] } });
const said = (...content) => line({ role: "assistant", message: { content } });
const text = (t) => ({ type: "text", text: t });
const call = (name) => ({ type: "tool_use", name, input: { command: "SECRET-ARGS" } });
const ended = (status = "success", extra = {}) => line({ type: "turn_ended", status, ...extra });

function transcript() {
  return [
    // A turn with a tool call between two replies; the hidden thinking is Cursor's "[REDACTED]".
    user("Why does the cart test fail?"),
    said(text("Looking at it.\n\n[REDACTED]"), call("Shell")),
    said(text("[REDACTED]")),
    said(text("It rounds tax per line.\n\n[REDACTED]")),
    ended(),
    // Thinking Cursor keeps is joined onto the reply with nothing to tell it apart: it stays.
    user("Pick a colour.", "Monday, Jan 5, 2026, 9:09 PM (UTC+5:30)"),
    said(text("Red.\n\nThe user wants one colour.")),
    ended(),
    // A pasted image is written as the word [Image].
    user("[Image] What is this?"),
    said(text("A cat.")),
    ended(),
    // Stopped with Escape, then an error.
    user("Rewrite everything"),
    said(text("Starting")),
    ended("aborted"),
    user("Try again"),
    ended("error", { error: "429 rate limited" }),
  ].join("");
}

function file(body = transcript()) {
  const dir = join(mkdtempSync(join(tmpdir(), "threads-cursor-")), "projects", "home-dev-shop", "agent-transcripts", ID);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `${ID}.jsonl`);
  writeFileSync(f, body);
  return f;
}

// The panel's read loop, with its check for a replaced file.
function read(f, base, s = newSession(ID, f)) {
  let chunk = base;
  for (let guard = 0; guard < 10000 && chunk; guard++) {
    const r = parseChunk(execFileSync("sh", [extractor, f, String(s.offset), String(chunk), "cursor"], { encoding: "utf8" }));
    if (replaced(s, r)) {
      Object.assign(s, newSession(s.id, s.file), { clock: s.clock, restarts: (s.restarts ?? 0) + 1 });
      chunk = base;
      continue;
    }
    s.size = r.size;
    if (s.clock && s.loaded) for (const e of r.events) if (["p", "d", "i"].includes(e.k)) e.at = s.now;
    for (const e of r.events) apply(s, e);
    s.offset += r.used;
    chunk = nextChunk(s, r.used, chunk, base);
  }
  s.loaded = true;
  return s;
}

test("builds turns from a Cursor transcript", () => {
  const s = read(file(), 1 << 20);
  expect(s.offset).toBe(s.size);
  expect(s.turns.map((t) => t.prompt)).toEqual(["Why does the cart test fail?", "Pick a colour.", "[Image] What is this?", "Rewrite everything", "Try again"]);
  const [plain, kept, image, stopped, failed] = s.turns;

  // The prompt's time comes from Cursor's <timestamp> tag, to the minute, in UTC.
  expect(plain.ts).toBe(Date.parse("2026-01-05T15:07:00Z"));
  expect(kept.ts).toBe(Date.parse("2026-01-05T15:39:00Z"));
  expect(reply(plain)).toBe("It rounds tax per line.");
  expect(plain.tools).toBe(1);
  expect(plain.toolNames).toEqual({ Shell: 1 });
  expect(plain.done).toBe(true);
  // Cursor writes no turn times, tokens or model.
  expect(plain.durationMs).toBe(0);
  expect(plain.model).toBe(null);
  expect(stats(plain).tokens).toBe(0);

  expect(reply(kept)).toBe("Red.\n\nThe user wants one colour.");
  expect(image.images).toEqual([]);
  expect(reply(image)).toBe("A cat.");
  expect(stopped.interrupted).toBe(true);
  expect(failed.errors).toEqual(["429 rate limited"]);
  expect(failed.done).toBe(true);
});

test("small chunks give the same turns as one read", () => {
  const f = file();
  const whole = read(f, 1 << 20);
  const pieces = read(f, 300);
  const view = (s) => s.turns.map((t) => [t.prompt, t.ts, reply(t), t.tools, t.done, t.interrupted]);
  expect(pieces.turns.length).toBe(5);
  expect(view(pieces)).toEqual(view(whole));
});

test("tool input stays out, and a [REDACTED] inside a reply is kept", () => {
  const f = file(user("Quote it") + said(text("Cursor writes [REDACTED] for hidden thinking.")) + ended());
  const out = execFileSync("sh", [extractor, f, "0", String(1 << 20), "cursor"], { encoding: "utf8" });
  expect(execFileSync("sh", [extractor, file(), "0", String(1 << 20), "cursor"], { encoding: "utf8" })).not.toContain("SECRET");
  expect(reply(read(f, 1 << 20).turns[0])).toBe("Cursor writes [REDACTED] for hidden thinking.");
  expect(out.split("\n").filter(Boolean).at(-1)).toMatch(/^\{"k":"settle","id":"\d+"\}$/);
});

test("a transcript Cursor writes again from the top is read again; one it adds to is read on", () => {
  const head = user("First") + said(text("One.")) + ended();
  const f = file(head);
  const s = read(f, 1 << 20);
  expect(s.turns.map((t) => t.prompt)).toEqual(["First"]);

  // Added to: read on from the offset.
  appendFileSync(f, user("Second") + said(text("Two.")) + ended());
  read(f, 1 << 20, s);
  expect(s.restarts ?? 0).toBe(0);
  expect(s.turns.map((t) => reply(t))).toEqual(["One.", "Two."]);

  // Written again with an earlier line changed and the file longer: the anchor differs.
  writeFileSync(f, user("First") + said(text("Uno.")) + ended() + user("Second") + said(text("Two.")) + ended() + user("Third") + said(text("Three.")) + ended());
  read(f, 1 << 20, s);
  expect(s.restarts).toBe(1);
  expect(s.turns.map((t) => reply(t))).toEqual(["Uno.", "Two.", "Three."]);

  // Written again shorter: the size says so.
  writeFileSync(f, head);
  read(f, 1 << 20, s);
  expect(s.restarts).toBe(2);
  expect(s.turns.map((t) => reply(t))).toEqual(["One."]);
});

test("a file Cursor wrote again from the top, with only the last turn's end, has no turn left running", () => {
  // After Escape, Cursor writes the chat again from its own store: the earlier turn_ended
  // lines are gone and the stop is on the last turn.
  const s = read(file(user("One") + said(text("A.\n\n[REDACTED]")) + user("Two") + said(text("B.")) + ended("aborted", { error: "User aborted/interrupted manually." })), 1 << 20);
  expect(s.turns.map((t) => [t.prompt, reply(t), t.done, t.interrupted])).toEqual([["One", "A.", true, false], ["Two", "B.", true, true]]);
  expect(s.open).toEqual([]);
});

test("a turn's time is what the pane watched, and survives a read from the top", () => {
  const f = file(user("Old") + said(text("Before the pane.")) + ended());
  const s = newSession(ID, f);
  s.clock = {};
  read(f, 1 << 20, s);
  expect(s.turns[0].durationMs).toBe(0);

  // Watched: the prompt seen at 1000, its end at 4500.
  s.now = 1000;
  appendFileSync(f, user("New"));
  read(f, 1 << 20, s);
  s.now = 4500;
  appendFileSync(f, said(text("Watched.")) + ended());
  read(f, 1 << 20, s);
  expect(s.turns.map((t) => t.durationMs)).toEqual([0, 3500]);

  // Written again from the top later on: the times stay, and the old turn gets none.
  s.now = 9000;
  writeFileSync(f, `${line({ type: "metadata" })}${user("Old")}${said(text("Before the pane."))}${ended()}${user("New")}${said(text("Watched."))}${ended()}`);
  read(f, 1 << 20, s);
  expect(s.restarts).toBe(1);
  expect(s.turns.map((t) => t.durationMs)).toEqual([0, 3500]);
});

test("a Cursor terminal and its files are told apart from the other agents'", () => {
  // The launcher (cursor-agent, or agent) runs node on its versioned index.js.
  const script = "/h/.local/share/cursor-agent/versions/2026.11.05-86047df/index.js";
  expect(harnessOf({ name: "node", argv: ["/h/.local/bin/cursor-agent", "--use-system-ca", script, "--trust"] })).toBe("cursor");
  expect(harnessOf({ name: "node", argv: ["/h/.local/bin/agent", "--use-system-ca", script] })).toBe("cursor");
  expect(harnessOf({ name: "node", argv: ["/h/bin/agent", "x.js"] })).toBe(null);
  expect(HARNESS.cursor.name).toBe("Cursor");
  const f = `/h/.cursor/projects/home-dev-shop/agent-transcripts/${ID}/${ID}.jsonl`;
  expect(harnessOfFile(f)).toBe("cursor");
  expect(idOfFile(f)).toBe(ID);
  expect(harnessOfFile(`/h/.claude/projects/x/agent-transcripts/a/${ID}.jsonl`)).toBe("claude");
  expect(cursorFolder("/h/.cursor", "/Users/dev/my shop/")).toBe("/h/.cursor/projects/Users-dev-my-shop/agent-transcripts");
  expect(cursorStore(`/h/.cursor/chats/0123abcd/${ID}/store.db`)).toEqual({ data: "/h/.cursor", id: ID });
  expect(cursorStore(`/h/.cursor/chats/0123abcd/${ID}/store.db-wal`)).toBe(null);
});

test("a newer Cursor keeps its chat store in ~/.config/cursor and its transcripts in ~/.cursor: both are searched, transcripts first", () => {
  const data = realpathSync(mkdtempSync(join(tmpdir(), "threads-cursor-home-")));
  const store = cursorStore(`${data}/.config/cursor/chats/0123abcd/${ID}/store.db`);
  expect(store).toEqual({ data: `${data}/.config/cursor`, id: ID });
  const roots = cursorRoots(`${data}/.cursor`, store);
  expect(roots).toEqual([`${data}/.cursor`, `${data}/.config/cursor`]);
  // An older build: the store sits in the data folder, which is searched once.
  expect(cursorRoots("/h/.cursor", cursorStore(`/h/.cursor/chats/0123abcd/${ID}/store.db`))).toEqual(["/h/.cursor"]);
  expect(cursorRoots("/h/.cursor", null)).toEqual(["/h/.cursor"]);
  // The chat's transcript is found under the first root and not the store's.
  const dir = cursorFolder(`${data}/.cursor`, "/home/dev/shop");
  mkdirSync(join(dir, ID), { recursive: true });
  writeFileSync(join(dir, ID, `${ID}.jsonl`), user("Made-up prompt") + said(text("ok")) + ended());
  const run = (...a) => { try { return execFileSync("sh", [locator, ...a], { encoding: "utf8" }).trim(); } catch { return null; } };
  expect(run("cursor-find", store.data, ID)).toBe(null);
  expect(roots.map((r) => run("cursor-find", r, ID)).find(Boolean)).toBe(join(dir, ID, `${ID}.jsonl`));
});

test("a Cursor command line names a chat only with --resume <id>", () => {
  expect(cursorArgv(["cursor-agent"])).toEqual({ id: null, cont: false });
  expect(cursorArgv(["cursor-agent", "--resume", ID])).toEqual({ id: ID, cont: false });
  expect(cursorArgv(["cursor-agent", `--resume=${ID}`])).toEqual({ id: ID, cont: false });
  // --resume alone opens a picker in the terminal.
  expect(cursorArgv(["cursor-agent", "--resume", "--model", "x"])).toEqual({ id: null, cont: false });
  expect(cursorArgv(["cursor-agent", "--continue"])).toEqual({ id: null, cont: true });
});

test("locate.sh finds a Cursor chat by id, lists a folder newest first, and labels a chat", () => {
  const data = realpathSync(mkdtempSync(join(tmpdir(), "threads-cursor-data-")));
  const dir = cursorFolder(data, "/home/dev/shop");
  const ids = [ID, "00000000-0000-4000-8000-00000000000d"];
  ids.forEach((id, i) => {
    mkdirSync(join(dir, id), { recursive: true });
    const f = join(dir, id, `${id}.jsonl`);
    writeFileSync(f, user(`  Chat\n number ${i + 1}  `) + said(text("ok")) + ended());
    utimesSync(f, 1000 + i * 100, 1000 + i * 100);
  });
  const run = (...a) => execFileSync("sh", [locator, ...a], { encoding: "utf8" }).trim();
  expect(run("cursor-find", data, ID)).toBe(join(dir, ID, `${ID}.jsonl`));
  expect(run("cursor-list", dir).split("\n").map((l) => l.split(" ")[2])).toEqual([...ids].reverse().map((id) => join(dir, id, `${id}.jsonl`)));
  expect(run("cursor-label", join(dir, ID, `${ID}.jsonl`))).toBe("Chat number 1");
});
