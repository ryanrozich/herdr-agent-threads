// Writes the synthetic Codex, OpenCode, Pi, Cursor and Antigravity sessions staged for the
// README's "beside each agent" screenshot: the made-up acme-web project of make-hero.js, a few
// turns each, in the line shapes the tests use. Nothing here comes from a real session.
// Usage: bun test/make-agents.js <out folder> <cwd> <startISO>
// Writes <out>/rollout-<time>-<id>.jsonl (Codex), <out>/opencode.db (OpenCode 2.x; the pane reads
// "<out>/opencode.db#ses_0003acme"), <out>/<time>_<id>.jsonl (Pi),
// <out>/agent-transcripts/<id>/<id>.jsonl (Cursor), <out>/brain/<id>/.system_generated/logs/
// transcript_full.jsonl (Antigravity). Prints the five paths the pane's transcript takes.
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [out, cwd, start] = process.argv.slice(2);
const T0 = Date.parse(start);
mkdirSync(out, { recursive: true });
const iso = (ms) => new Date(ms).toISOString();
const stamp = (ms) => iso(ms).replace(/:/g, "-").replace(".", "-");

// ---- Codex: a rollout file ----
const codexId = "00000000-0000-4000-8000-0000000000c1";
let ord = 0;
let ct = T0;
const cline = (type, payload, gap = 1) => `${JSON.stringify({ timestamp: iso((ct += gap * 1000)), ordinal: ord++, type, payload })}\n`;
const ask = (turn, text, gap) => cline("event_msg", { type: "item_completed", turn_id: turn, item: { type: "UserMessage", content: [{ type: "text", text }] } }, gap);
const say = (text, phase = "final_answer", gap = 6) => cline("response_item", { type: "message", role: "assistant", phase, content: [{ type: "output_text", text }] }, gap);
const call = (name, gap = 2) => cline("response_item", { type: "function_call", name, arguments: "{}" }, gap);
const count = (input, cached, output) => cline("event_msg", { type: "token_count",
  info: { total_token_usage: { total_tokens: input + output }, last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output } } }, 0);
const fin = (ms) => cline("event_msg", { type: "task_complete", duration_ms: ms }, 0);
const codexFile = join(out, `rollout-${stamp(T0).slice(0, 19)}-${codexId}.jsonl`);
writeFileSync(codexFile, [
  cline("session_meta", { id: codexId, cwd }, 0),
  cline("turn_context", { model: "gpt-5.5-codex", effort: "medium" }, 0),
  ask("turn-0001", "Why is the order total a cent off when there are three or more items?", 0),
  say("Checking how the cart adds up tax.", "commentary", 4),
  call("exec_command"),
  call("exec_command"),
  count(48200, 41000, 620),
  say("Tax is rounded on each line and then summed, so three lines can round up three times.\n\n- `cart/total.ts` rounds in `lineTax()`\n- The receipt sums the rounded values\n\nRounding once, on the order's tax total, fixes it. Want me to change it?", "final_answer", 9),
  fin(41000),
  ask("turn-0002", "Yes, and add a test with three items at $3.33", 70),
  call("apply_patch"),
  call("exec_command"),
  count(52100, 47000, 910),
  say("Done. `totalTax()` now rounds once, and `cart/total.test.ts` checks three items at $3.33 come to $10.79 with tax. All 214 tests pass.", "final_answer", 14),
  fin(63000),
].join(""));

// ---- OpenCode 2.x: one SQLite database ----
const ocPath = join(out, "opencode.db");
rmSync(ocPath, { force: true });
const db = new Database(ocPath);
const SID = "ses_0003acme";
db.run(`create table session_v2 (id text primary key, project_id text, parent_id text, directory text, title text,
  time_created integer, time_updated integer, time_archived integer, time_busy integer, time_idle integer)`);
db.run("create table session_message (id text primary key, session_id text, type text, seq integer, time_created integer, time_updated integer, data text)");
db.run("create table session_part (message_id text, session_id text, ordinal integer, type text, data text)");
const O0 = T0 + 600000;
let seq = 0;
const orow = (id, type, t, data) => {
  seq += 3;
  db.run("insert into session_message values (?, ?, ?, ?, ?, ?, ?)", [id, SID, type, seq, O0 + t, O0 + t, JSON.stringify({ time: { created: O0 + t }, ...data })]);
};
const otext = (t) => ({ type: "text", text: t });
const otool = (name) => ({ type: "tool", id: `call_${name}`, name, state: { status: "completed", input: {}, content: [] } });
const oreply = (id, t, done, content, input, output, read) => orow(id, "assistant", t, {
  time: { created: O0 + t, completed: O0 + done }, agent: "build", model: { id: "glm-5.3", providerID: "opencode", variant: "default" },
  content, finish: "stop", cost: 0, tokens: { input, output, reasoning: 0, cache: { read, write: 0 } },
});
orow("msg_u1", "user", 0, { text: "Rename useCart to useBasket everywhere", files: [], agents: [] });
oreply("msg_a1", 100, 38000, [otool("grep"), otool("edit"), otext("Renamed `useCart` to `useBasket` in 14 files, including the hook's own file and its tests. The old name is gone from `src/`.")], 30400, 540, 22000);
orow("msg_i1", "idle", 38001, { outcome: "succeeded" });
orow("msg_u2", "user", 95000, { text: "Update the README example too", files: [], agents: [] });
oreply("msg_a2", 95100, 112000, [otool("edit"), otext("The README's **Cart state** example now imports `useBasket`.")], 31800, 210, 30000);
orow("msg_i2", "idle", 112001, { outcome: "succeeded" });
db.run("insert into session_v2 values (?, 'prj', null, ?, 'Rename useCart', ?, ?, null, ?, ?)", [SID, cwd, O0, O0 + 112001, O0 + 95000, O0 + 112001]);
db.close();

// ---- Pi: a session file ----
const piId = "00000000-0000-4000-8000-0000000000e1";
const P0 = T0 + 1200000;
let pn = 0;
let pt = P0;
let parent = null;
const pentry = (type, fields, gap = 1) => {
  const id = (++pn).toString(16).padStart(8, "0");
  pt += gap * 1000;
  const l = `${JSON.stringify({ type, id, parentId: parent, timestamp: iso(pt), ...fields })}\n`;
  parent = id;
  return l;
};
const pmsg = (message, gap) => pentry("message", { message: { timestamp: pt, ...message } }, gap);
const puser = (text, gap) => pmsg({ role: "user", content: [{ type: "text", text }] }, gap);
const psaid = (content, stop, input, output, read, gap) => pmsg({ role: "assistant", content, api: "openai-completions", provider: "acme", model: "kimi-k3",
  usage: { input, output, cacheRead: read, cacheWrite: 0, totalTokens: input + output + read, cost: { total: 0 } }, stopReason: stop, thinkingLevel: "medium" }, gap);
const piFile = join(out, `${stamp(P0)}_${piId}.jsonl`);
writeFileSync(piFile, [
  `${JSON.stringify({ type: "session", version: 3, id: piId, timestamp: iso(P0), cwd })}\n`,
  pentry("model_change", { provider: "acme", modelId: "kimi-k3" }, 0),
  puser("Which pages still load the old analytics script?", 2),
  psaid([{ type: "text", text: "Searching the templates." }, { type: "toolCall", id: "c1", name: "bash", arguments: {} }], "toolUse", 9000, 120, 4000, 5),
  pmsg({ role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "3 matches" }], isError: false }, 2),
  psaid([{ type: "text", text: "Three pages still load `legacy-analytics.js`:\n\n1. `pages/checkout.tsx`\n2. `pages/account/orders.tsx`\n3. `pages/help.tsx`" }], "stop", 9800, 160, 8800, 7),
  puser("Remove it from all three", 50),
  psaid([{ type: "text", text: "Removed the script tag from all three pages. Nothing else imports it, so `legacy-analytics.js` can go too." }], "stop", 10400, 90, 9500, 21),
  pentry("session_info", { name: "Old analytics script" }, 0),
].join(""));

// ---- Cursor: an agent transcript ----
const cursorId = "00000000-0000-4000-8000-0000000000f1";
const cursorDir = join(out, "agent-transcripts", cursorId);
mkdirSync(cursorDir, { recursive: true });
const C0 = new Date(T0 + 1800000);
const local = (d) => {
  const day = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  return `${day}, ${time} (UTC)`;
};
const cline2 = (o) => `${JSON.stringify(o)}\n`;
const cuser = (text, d) => cline2({ role: "user", message: { content: [{ type: "text", text: `<timestamp>${local(d)}</timestamp>\n<user_query>\n${text}\n</user_query>` }] } });
const csaid = (...content) => cline2({ role: "assistant", message: { content } });
const cursorFile = join(cursorDir, `${cursorId}.jsonl`);
writeFileSync(cursorFile, [
  cuser("Make the checkout button full width on phones", C0),
  csaid({ type: "text", text: "Looking at the checkout styles.\n\n[REDACTED]" }, { type: "tool_use", name: "Read", input: {} }),
  csaid({ type: "text", text: "[REDACTED]" }, { type: "tool_use", name: "Edit", input: {} }),
  csaid({ type: "text", text: "Added a phone rule to `checkout.module.css`:\n\n```css\n@media (max-width: 480px) {\n  .payButton { width: 100%; }\n}\n```\n\nThe button keeps its width on tablets and up.\n\n[REDACTED]" }),
  cline2({ type: "turn_ended", status: "success" }),
  cuser("Does it still line up with the coupon field?", new Date(C0.getTime() + 120000)),
  csaid({ type: "text", text: "Yes. Both now span the full width below 480 px, with the same 16 px side margin." }),
  cline2({ type: "turn_ended", status: "success" }),
].join(""));

// ---- Antigravity: a conversation's transcript ----
const agyId = "00000000-0000-4000-8000-0000000000a9";
const agyDir = join(out, "brain", agyId, ".system_generated", "logs");
mkdirSync(agyDir, { recursive: true });
const A0 = T0 + 2400000;
let step = 0;
const astep = (o, ms) => `${JSON.stringify({ step_index: step++, created_at: iso(A0 + ms).replace(/\.\d+Z$/, "Z"), status: "DONE", ...o })}\n`;
const auser = (text, ms, model) => astep({ source: "USER_EXPLICIT", type: "USER_INPUT",
  content: `<USER_REQUEST>\n${text}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: ${iso(A0 + ms)}.\n</ADDITIONAL_METADATA>${model
    ? `\n<USER_SETTINGS_CHANGE>\nThe user changed setting \`Model Selection\` from None to ${model}. No need to comment on this change if the user doesn't ask about it.\n</USER_SETTINGS_CHANGE>` : ""}` }, ms);
const aplan = (ms, content, calls, [i, o, cr]) => astep({ source: "MODEL", type: "PLANNER_RESPONSE", ...(content ? { content } : {}),
  input_tokens: i, output_tokens: o, cache_read_tokens: cr, ...(calls ? { tool_calls: calls.map((name) => ({ name, args: {} })) } : {}) }, ms);
const aout = (ms) => astep({ source: "MODEL", type: "GENERIC", content: "(tool output)" }, ms);
const agyFile = join(agyDir, "transcript_full.jsonl");
writeFileSync(agyFile, [
  auser("Why does the search box lose its text when I go back?", 0, "Gemini 3.5 Flash (Medium)"),
  aplan(2000, null, ["grep_search"], [11400, 70, 0]),
  aout(4000),
  aplan(6000, null, ["view_file"], [2300, 90, 9300]),
  aout(7000),
  aplan(12000, "The search page keeps its text in component state, which resets when the page mounts again on back.\n\nKeeping it in the URL (`?q=`) fixes both back and reload:\n\n- `SearchBox` reads `q` from the URL on mount\n- typing updates `q` with `replace`, so it adds no history entry\n\nShall I make the change?", null, [2400, 160, 9600]),
  auser("Yes, do it", 60000),
  aplan(63000, null, ["replace_file_content"], [2600, 210, 10100]),
  aout(64000),
  aplan(68000, "Done. `SearchBox` now keeps the query in `?q=`, and going back restores it.", null, [2800, 40, 10600]),
].join(""));

console.log([codexFile, `${ocPath}#${SID}`, piFile, cursorFile, agyFile].join("\n"));
