// Writes a synthetic Claude Code transcript: the line shapes of a real 2.1.316 file
//, with made-up content. Nothing here comes from a real session.
// Usage: bun test/make-fixture.js <out.jsonl> [sessionId] [cwd] [flags]
//   --extra N    N short turns before the scripted ones (to fill a list)
//   --only N     only N short turns, none of the scripted ones
//   --open       end with a turn that has tool calls and no reply yet (a running turn)
//   --start T    ISO time of the first line (default 2026-11-01T09:12:00Z)
//   --gap S      seconds between the --extra/--only turns (default 300)
//   --clear      start the file the way /clear starts one: a caveat line, the /clear
//                command line and its local_command system line
//   --usage      add /usage command lines (with and without origin, both tag orders)
//   --skill      add a custom command (/review-pr 12) that Claude answers
//   --peer       add a peer prompt that lands mid-turn and shares one turn_duration
//   --notify     add a task notification that lands before its turn's turn_duration
//   --agents     add turns other senders gave: an hc report <hc from="t7 review">, a peer
//                message with <agent-message from="helper-a">, two <teammate-message
//                teammate_id="…"> messages in one prompt, a peer line with no from, a
//                subagent hand-back marked isMeta (origin name "general-purpose"),
//                a scheduled prompt, an hc request with reach=, and an auto-continuation
//                that folds into the turn above
//   --commands   add slash commands that Claude answers: a long plugin name with args, a
//                bare /x, and a malformed command line (command-message and command-args,
//                no command-name)
//   --latest     add a turn whose background update (a task notification after its
//                turn_duration) says something new
//   --langs      add a turn whose reply has code blocks in many languages
//   --long       add a 40-line prompt, a 5,000-character one-line prompt and a reply
//                with a 200-line code block of 300-character lines
//   --busy N     N rounds of a long own prompt then 9 long agent messages (hc reports and
//                peer messages), each with a long Markdown reply: a busy supervisor session
//                (--busy 130 is about 1,300 turns), for timing the list
//   --quotes     add prompts that quote the reply above in Markdown ("> "): quote only,
//                comment only, quote then comment, comment then quote, interleaved, ">"
//                with no space, nested "> >", a ">" line inside a fence, and a 40-line quote
//   --links      add a turn whose prompt and reply hold ACME-123, #45, a fence holding
//                ACME-9, an existing link, a URL with ACME-2 in it and a #123456 colour
//   --hostile    add a turn whose reply holds an ESC[201~, a CR and a command (for the
//                quote's sanitising)
//   --edge       add the round-2 review's edge cases: a reply that opens with a 4,000-
//                character code block and then prose, a reply whose first paragraph is
//                over 2,000 characters, a reply with ACME-2 in a fence inside a quote,
//                ACME-3 in a code span over a line break and ACME-7 in a nested list item,
//                and a 40,000-character prompt that ends in TAIL-END
//   --blocks     add final replies split over several text blocks (round 3, C3): three
//                blocks with no tool call between them (two in one message, one in the
//                next), a tool call between two blocks, and a task notification that lands
//                between two blocks of the reply
//   --pad-mb N   add about N MB of bookkeeping lines (api-request-blob, snapshots,
//                attachments) between turns, as real transcripts have
//   --images     add prompts with pasted images, as Claude Code writes them (text with
//                [Image #N], base64 image blocks, imagePasteIds): one wide image, a tall and
//                a square one together, and an image with no text. The images are generated
//                (colour blocks, no text)
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const flags = process.argv.slice(2);
const flag = (name) => { const i = flags.indexOf(name); if (i < 0) return null; const v = flags[i + 1]; flags.splice(i, 2); return v; };
const bool = (name) => { const i = flags.indexOf(name); if (i < 0) return false; flags.splice(i, 1); return true; };
const open = bool("--open");
const clear = bool("--clear");
const usage = bool("--usage");
const skill = bool("--skill");
const peer = bool("--peer");
const notifyFirst = bool("--notify");
const langs = bool("--langs");
const agents = bool("--agents");
const commands = bool("--commands");
const latestFx = bool("--latest");
const long = bool("--long");
const quotes = bool("--quotes");
const linksFx = bool("--links");
const hostile = bool("--hostile");
const edge = bool("--edge");
const blocks = bool("--blocks");
const imagesFx = bool("--images");
const extra = Number(flag("--extra") ?? 0);
const only = flag("--only");
const busy = Number(flag("--busy") ?? 0);
const gap = Number(flag("--gap") ?? 300);
const padMb = Number(flag("--pad-mb") ?? 0);
const start = flag("--start");
const out = flags[0] ?? "test/fixtures/session.jsonl";
const sessionId = flags[1] ?? "00000000-0000-4000-8000-000000000001";
const cwd = flags[2] ?? "/tmp/threads-demo";
const version = "2.1.316";
const model = "claude-opus-5-5";

let clock = Date.parse(start ?? "2026-11-01T09:12:00.000Z");
let n = 0;
let parent = null;
const lines = [];
const uid = () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
const tick = (s) => new Date((clock += s * 1000)).toISOString();
const base = () => ({ parentUuid: parent, isSidechain: false, userType: "external", cwd, sessionId, version, gitBranch: "main" });

function push(obj) {
  lines.push(JSON.stringify(obj));
  if (obj.uuid) parent = obj.uuid;
}
function noise() {
  push({ type: "queue-operation", operation: "enqueue", timestamp: tick(0), sessionId });
  push({ type: "api-request-blob", sessionId, blob: { messages: [{ role: "assistant", content: [{ type: "text", text: "duplicate, must be skipped" }] }] } });
  push({ type: "mode", mode: "normal", sessionId });
}
// Bookkeeping that real transcripts carry between conversation lines (padding only).
let padLeft = padMb * 1024 * 1024;
let padPer = 0;
function pad() {
  let share = Math.min(padLeft, padPer);
  const fill = (n) => "x".repeat(Math.max(0, n));
  while (share > 0) {
    const blob = JSON.stringify({ type: "api-request-blob", sessionId, blob: { messages: [{ role: "assistant", content: [{ type: "text", text: fill(Math.min(share, 400000) - 2400) }] }] } });
    const snap = JSON.stringify({ type: "file-history-snapshot", messageId: `m${lines.length}`, snapshot: { trackedFileBackups: { "src/a.ts": { backupFileName: "a@v1", version: 1 } } } });
    const att = JSON.stringify({ type: "attachment", sessionId, attachment: { type: "diagnostics", text: fill(2000) } });
    for (const l of [blob, snap, att]) { lines.push(l); padLeft -= l.length + 1; share -= l.length + 1; }
  }
}
let promptIndex = 0;
let turnIndex = 0;
function prompt(text, kind = "human", gap = 30) {
  pad();
  const promptId = uid();
  push({ ...base(), type: "user", promptId, origin: { kind }, promptSource: "typed",
    turnPosition: { promptIndex: kind === "human" ? ++promptIndex : promptIndex, turnIndex: ++turnIndex },
    message: { role: "user", content: text }, uuid: uid(), timestamp: tick(gap) });
  return promptId;
}
let msg = 0;
function assistant(blocks, { stop = "end_turn", out = 120, input = 6, read = 42000, write = 1800, secs = 4 } = {}) {
  const id = `msg_${String(++msg).padStart(6, "0")}`;
  const usage = { input_tokens: input, output_tokens: out, cache_read_input_tokens: read, cache_creation_input_tokens: write };
  blocks.forEach((b, i) => push({ ...base(), type: "assistant", requestId: `req_${msg}`, apiBlockIndex: i, effort: "high",
    message: { id, model, role: "assistant", type: "message", content: [b], stop_reason: stop, usage },
    uuid: uid(), timestamp: tick(i === 0 ? secs : 0) }));
  return id;
}
function tool(name, input, result, promptId) {
  const id = `toolu_${String(msg).padStart(6, "0")}_${name}`;
  assistant([{ type: "thinking", thinking: "…" }, { type: "tool_use", id, name, input }], { stop: "tool_use", out: 60 });
  push({ ...base(), type: "user", promptId, toolUseResult: { stdout: result }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: result }] }, uuid: uid(), timestamp: tick(2) });
}
function command(name, args = "", { origin = false, order = "name" } = {}) {
  const n = `<command-name>${name}</command-name>`;
  const m = `<command-message>${name.slice(1)}</command-message>`;
  const a = `<command-args>${args}</command-args>`;
  const content = order === "name" ? `${n}\n${m}\n${a}` : `${m}\n${n}\n${a}`;
  push({ ...base(), type: "user", ...(origin ? { origin: { kind: "human" } } : {}), message: { role: "user", content }, uuid: uid(), timestamp: tick(20) });
}
function localOutput(text) {
  push({ ...base(), type: "user", isMeta: false, message: { role: "user", content: `<local-command-stdout>${text}</local-command-stdout>` }, uuid: uid(), timestamp: tick(0) });
  push({ ...base(), type: "system", subtype: "local_command", content: "<local-command-stdout>ok</local-command-stdout>", level: "info", uuid: uid(), timestamp: tick(0) });
}
function end(ms) {
  push({ ...base(), type: "system", subtype: "stop_hook_summary", hookCount: 1, uuid: uid(), timestamp: tick(0) });
  push({ ...base(), type: "system", subtype: "turn_duration", durationMs: ms, messageCount: 9, uuid: uid(), timestamp: tick(0) });
}

const SMALL = [
  ["Add alt text to the product images", "Added alt text from the product name.", 2],
  ["Bump Playwright to the latest minor", "Bumped it; no test changes needed.", 3],
  ["Set up Playwright for the checkout flow", "Added a config and two smoke tests for checkout.", 7],
  ["Why does the cart badge show 0 after refresh?", "It read local state before hydration; now uses the store.", 4],
  ["Rename the `useCart` hook to `useBasket`", "Renamed it in 14 files and updated the tests.", 6],
  ["Is the staging deploy green?", "Yes. The last staging deploy passed all checks.", 1],
  ["Delete the unused feature flag for gift cards", "Removed the flag and its two dead branches.", 5],
  ["Make the header sticky on mobile", "The header now sticks below 640 px; desktop is unchanged.", 3],
];
if (clear) {
  push({ type: "mode", mode: "normal", sessionId });
  push({ ...base(), type: "user", isMeta: true, message: { role: "user", content: "<local-command-caveat>Caveat: the messages below were generated by the user while running local commands.</local-command-caveat>" }, uuid: uid(), timestamp: tick(0) });
  push({ ...base(), type: "user", message: { role: "user", content: "<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>" }, uuid: uid(), timestamp: tick(1) });
  push({ ...base(), type: "system", subtype: "local_command", content: "<local-command-stdout></local-command-stdout>", level: "info", uuid: uid(), timestamp: tick(0) });
}
const count = only != null ? Number(only) : extra;
if (padMb) padPer = Math.ceil((padMb * 1024 * 1024) / (count + (only == null ? 8 : 0) || 1));
for (let i = 0; i < count; i++) {
  const [q, a, tools] = SMALL[i % SMALL.length];
  const pid = prompt(q, "human", gap);
  for (let k = 0; k < tools; k++) tool(["Read", "Edit", "Bash", "Grep"][k % 4], {}, "…", pid);
  assistant([{ type: "text", text: a }], { out: 80 + tools * 30, read: 20000 + tools * 4000, write: 900 + tools * 200, secs: 3 });
  end(8000 + tools * 9000);
}

const LOREM = "the deploy check passed on staging but the retry path still logs a warning when the queue is empty so we should look at the backoff before the next release and confirm the alert threshold";
const para = (k, words) => { const w = LOREM.split(" "); return Array.from({ length: words }, (_, i) => w[(i * 7 + k) % w.length]).join(" "); };
const longReply = (k) => `${para(k, 40)}.\n\n- **${para(k + 1, 6)}** ${para(k + 2, 30)}\n- ${para(k + 3, 35)}\n- \`${para(k + 4, 3)}\` ${para(k + 5, 28)}\n\n\`\`\`ts\nconst x = ${k}\n\`\`\`\n\n${para(k + 6, 120)}.`;
for (let i = 0; i < busy; i++) {
  prompt(`> ${para(i, 30)}\n\n${para(i + 1, 90)}`, "human", 60);
  assistant([{ type: "text", text: longReply(i) }], { out: 400, secs: 5 });
  end(30000);
  for (let j = 0; j < 9; j++) {
    const k = i * 9 + j;
    const body = `${para(k, 200)}\n\n${para(k + 1, 150)}`;
    prompt(j % 2 ? `<hc from="t${j} worker">${body}</hc>` : `<agent-message from="helper-${j}">${body}</agent-message>`, j % 2 ? "human" : "peer", 20);
    assistant([{ type: "text", text: longReply(k) }], { out: 300, secs: 4 });
    end(20000);
  }
}

if (only == null) {
// 1. Plain question, no tools.
prompt("What does the auth mock warning in the test output mean?");
assistant([{ type: "text", text: "It fires when a test skips logout, so the mock session outlives the test. It is harmless: every suite resets the mock in `beforeEach`." }]);
end(9000);
noise();

// 2. Tools, then a reply with a code block. Text before the last tool call is not final.
let p = prompt("Fix the flaky login test so it stops timing out in CI");
assistant([{ type: "text", text: "Let me look at the test first." }], { stop: "tool_use" });
tool("Read", { file_path: "tests/login.spec.ts" }, "…", p);
tool("Bash", { command: "bun test login" }, "1 fail", p);
tool("Edit", { file_path: "tests/login.spec.ts" }, "ok", p);
assistant([{ type: "text", text: "The test raced the redirect. It now waits for the session response instead of sleeping 2 s:\n\n```ts\nawait page.waitForResponse(\n  (r) => r.url().endsWith('/session'),\n)\nexpect(await cookie()).toBeTruthy()\n```\n\nRan the suite 20 times locally with no failures. One unrelated warning remains in the auth mock." }], { out: 410, read: 61000, write: 2400, secs: 6 });
end(102000);
noise();

// 3. A task notification after the turn folds into it and does not replace its reply.
prompt("<task-notification>background build finished</task-notification>", "task-notification", 20);
assistant([{ type: "text", text: "The background build finished cleanly." }], { stop: "end_turn", out: 20 });
end(3000);

// 4. Interrupted: no turn_duration, then an interrupt line.
p = prompt("Run the full e2e suite and summarise the failures");
tool("Bash", { command: "bun run e2e" }, "…", p);
push({ ...base(), type: "user", promptId: p, message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user for tool use]" }] }, uuid: uid(), timestamp: tick(40) });

// 5. Compaction mid-session, then a turn with a long pasted prompt and a long reply.
push({ ...base(), type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "auto", preTokens: 160000, postTokens: 21000 }, uuid: uid(), timestamp: tick(10) });
push({ ...base(), type: "user", isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: "user", content: "This session is being continued from a previous conversation…" }, uuid: uid(), timestamp: tick(1) });
const trace = Array.from({ length: 40 }, (_, i) => `    at step${i} (tests/login.spec.ts:${40 + i}:5)`).join("\n");
p = prompt(`Why does CI fail here? Log below:\n\nTimeoutError: waitForURL 30000ms\n${trace}`);
tool("Grep", { pattern: "waitForURL" }, "…", p);
tool("Read", { file_path: "src/auth/flow.ts" }, "…", p);
const helper = Array.from({ length: 24 }, (_, i) => `  const step${i} = await runStep(${i}, { retries: 2, timeoutMs: 15_000, label: "step-${i}-with-a-long-label-that-scrolls" })`).join("\n");
const paras = Array.from({ length: 6 }, (_, i) => `Paragraph ${i + 1}: the staging redirect adds a second hop, so the wait has to follow the final URL rather than the first one. This is placeholder prose to make the reply long.`).join("\n\n");
assistant([{ type: "text", text: `The login spec waited on a URL that the new auth flow never visits.\n\n${paras}\n\n\`\`\`ts\nexport async function waitForSession(page: Page) {\n${helper}\n}\n\`\`\`\n\nThen I ran the suite 20 times locally with no failures.` }], { out: 1900, read: 30000, write: 9000, secs: 12 });
end(185000);
noise();

// 6. A synthetic API error is not a reply.
prompt("Add a retry note to the README");
push({ ...base(), type: "assistant", isApiErrorMessage: true, message: { id: "msg_err", model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "API Error: overloaded" }], stop_reason: "stop_sequence", usage: { input_tokens: 0, output_tokens: 0 } }, uuid: uid(), timestamp: tick(3) });
tool("Edit", { file_path: "README.md" }, "ok", null);
assistant([{ type: "text", text: "Documented the retry flag under **Testing**." }], { out: 40 });
end(19000);

}

if (usage) {
  // Local commands: no model turn, no turn_duration. Both tag orders, with and without origin.
  command("/usage");
  localOutput("Current session: 41k tokens");
  command("/usage", "", { origin: true, order: "message" });
  localOutput("Current session: 41k tokens");
  prompt("Rerun the checkout smoke tests");
  tool("Bash", { command: "bun test checkout" }, "…", null);
  assistant([{ type: "text", text: "Both checkout smoke tests pass." }], { out: 30 });
  end(14000);
}

if (skill) {
  command("/review-pr", "12", { origin: true, order: "message" });
  push({ ...base(), type: "user", isMeta: true, message: { role: "user", content: [{ type: "text", text: "Review pull request 12 for correctness." }] }, uuid: uid(), timestamp: tick(0) });
  tool("Bash", { command: "gh pr diff 12" }, "…", null);
  assistant([{ type: "text", text: "PR 12 looks correct. One nit: the retry count is not logged." }], { out: 60 });
  end(31000);
}

if (peer) {
  // A peer prompt lands while Claude works on the first; one turn_duration ends both.
  const a = prompt("Profile the search endpoint and find the slow query");
  tool("Bash", { command: "bun run profile" }, "…", a);
  prompt("Another Claude session asks: is the search index rebuilt yet?", "peer", 5);
  tool("Read", { file_path: "src/search/index.ts" }, "…", a);
  assistant([{ type: "text", text: "The slow query was a missing index on `orders.created_at`. The index is rebuilt." }], { out: 90 });
  end(64000);
}

if (notifyFirst) {
  // A task notification arrives before the turn's turn_duration.
  const a = prompt("Start the background typecheck and report when done");
  tool("Bash", { command: "bun run typecheck &" }, "…", a);
  prompt("<task-notification>typecheck finished: 0 errors</task-notification>", "task-notification", 8);
  assistant([{ type: "text", text: "The typecheck finished with 0 errors." }], { out: 25 });
  end(22000);
}

if (agents) {
  // An hc report from a child terminal (human origin, wrapped in <hc from>).
  let a = prompt('<hc from="t7 review">Two bugs in cart.ts; details in notes/review.md</hc>');
  tool("Read", { file_path: "notes/review.md" }, "…", a);
  assistant([{ type: "text", text: "Read the review notes. Both bugs are in the quantity guard; fixing them next." }], { out: 50 });
  end(16000);
  // The person again.
  prompt("Fix both bugs from the review");
  tool("Edit", { file_path: "src/cart.ts" }, "ok", null);
  assistant([{ type: "text", text: "Fixed both: the guard now rejects 0 and negative quantities." }], { out: 40 });
  end(21000);
  // An auto-continuation folds into the turn above as a background update.
  prompt("Continue from where you left off.", "auto-continuation", 4);
  assistant([{ type: "text", text: "Added a test for the zero-quantity case." }], { out: 30 });
  end(9000);
  // A peer session's message, with a sender name.
  a = prompt('Another Claude session sent a message:\n<agent-message from="helper-a">Is the cart API frozen for the release?</agent-message>', "peer", 30);
  assistant([{ type: "text", text: "Replied to helper-a: the cart API is frozen until Friday." }], { out: 30 });
  end(7000);
  // The shape Claude Code writes today: two teammate messages in one prompt.
  prompt('Messages from your team:\n<teammate-message teammate_id="helper-b" color="green" summary="tests pass">The checkout tests pass on the branch.</teammate-message>\n<teammate-message teammate_id="helper-c" color="blue">Docs are updated.</teammate-message>', "peer", 30);
  assistant([{ type: "text", text: "Noted both updates from the team." }], { out: 20 });
  end(4000);
  // A peer line with no from.
  prompt("Another Claude session asks: which branch is the release on?", "peer", 30);
  assistant([{ type: "text", text: "The release is on release/2.4." }], { out: 20 });
  end(5000);
  // A subagent's hand-back the way Claude Code writes it today: isMeta, promptSource
  // "system", turnOrigin "peer", an origin with a name and a from that is only an id.
  pad();
  push({ ...base(), type: "user", isMeta: true, promptSource: "system", turnOrigin: "peer",
    origin: { kind: "peer", from: "a0f0e0d0c0b0a0901", senderTaskId: "task-0001", name: "general-purpose" },
    message: { role: "user", content: [{ type: "text", text: 'Another Claude session sent a message: <agent-message from="a0f0e0d0c0b0a0901">The survey of the cart module is done: three call sites use the old price field.</agent-message>' }] },
    uuid: uid(), timestamp: tick(30) });
  // A meta line from a scheduled turn (no origin object) stays bookkeeping, not a turn.
  push({ ...base(), type: "user", isMeta: true, promptSource: "system", turnOrigin: "scheduled",
    message: { role: "user", content: [{ type: "text", text: "Reminder: keep the summary short." }] }, uuid: uid(), timestamp: tick(0) });
  assistant([{ type: "text", text: "Thanks, I will update the three call sites." }], { out: 20 });
  end(5000);
  // A scheduled prompt (/loop, a wakeup).
  prompt("Check the nightly build status", "scheduled", 60);
  tool("Bash", { command: "gh run list" }, "…", null);
  assistant([{ type: "text", text: "The nightly build passed." }], { out: 20 });
  end(11000);
  // An hc request from a parent, with reach=.
  a = prompt('<hc from="t3 lead" reach="hc send t3 when done or stuck">Review the checkout copy changes</hc>');
  tool("Read", { file_path: "src/checkout/copy.ts" }, "…", a);
  assistant([{ type: "text", text: "Reviewed the copy changes; two typos, both fixed." }], { out: 40 });
  end(18000);
  // The person, with an <hc tag in the middle of the prompt (stays the person's).
  prompt("Explain what the <hc from=...> tag in the last report means");
  assistant([{ type: "text", text: "It marks a report another terminal sent through hc." }], { out: 20 });
  end(6000);
}

if (commands) {
  command("/plugin-marketplace:review-pull-request", "12 --deep check the retry path", { origin: true, order: "message" });
  push({ ...base(), type: "user", isMeta: true, message: { role: "user", content: [{ type: "text", text: "Review pull request 12 in depth." }] }, uuid: uid(), timestamp: tick(0) });
  tool("Bash", { command: "gh pr diff 12" }, "…", null);
  assistant([{ type: "text", text: "PR 12: the retry path is correct." }], { out: 40 });
  end(25000);
  command("/x", "", { origin: true });
  assistant([{ type: "text", text: "Ran x." }], { out: 10 });
  end(3000);
  // Malformed: no command-name, so the tags are stripped and the text is a prompt.
  push({ ...base(), type: "user", origin: { kind: "human" }, message: { role: "user", content: "<command-message>bro</command-message>\n<command-args>tidy the imports</command-args>" }, uuid: uid(), timestamp: tick(20) });
  assistant([{ type: "text", text: "Tidied the imports." }], { out: 10 });
  end(4000);
}

if (latestFx) {
  const a = prompt("Start the nightly export in the background");
  tool("Bash", { command: "bun run export &" }, "…", a);
  assistant([{ type: "text", text: "Started the export; I will report when it finishes." }], { out: 30 });
  end(8000);
  prompt("<task-notification>export finished: 1,204 rows</task-notification>", "task-notification", 90);
  tool("Read", { file_path: "out/export.csv" }, "…", null);
  assistant([{ type: "text", text: "The export finished: 1,204 rows, no errors. The file is out/export.csv." }], { out: 30 });
  end(6000);
}

if (langs) {
  const blocks = [
    ["ts", "type User = { id: string; admin: boolean }\nexport const isAdmin = (u: User): boolean => u.admin === true // ok"],
    ["tsx", "export function Badge({ n }: { n: number }) {\n  return <span className=\"badge\">{n > 99 ? \"99+\" : n}</span>\n}"],
    ["js", "const total = items.reduce((sum, x) => sum + x.price * x.qty, 0)\nconsole.log(`total: ${total}`, null, true)"],
    ["json", "{ \"name\": \"checkout\", \"private\": true, \"version\": \"1.4.0\", \"retries\": 3 }"],
    ["jsonc", "{\n  // retries for the smoke tests\n  \"retries\": 3, \"timeout\": 15000\n}"],
    ["yaml", "jobs:\n  test:\n    runs-on: ubuntu-latest # pinned\n    timeout-minutes: 15\n    if: true"],
    ["toml", "[server]\nport = 8080 # dev only\nhost = \"127.0.0.1\"\ndebug = false"],
    ["bash", "for f in tests/*.spec.ts; do\n  echo \"running $f\" && bun test \"$f\" || exit 1\ndone"],
    ["sh", "set -eu\nif [ -n \"${CI:-}\" ]; then echo ci; fi"],
    ["python", "def retry(fn, times=3):\n    for i in range(times):  # simple\n        if fn(): return True\n    return False"],
    ["rust", "fn main() {\n    let n: u32 = 42; // answer\n    println!(\"{}\", n + 1);\n}"],
    ["go", "func Sum(xs []int) int {\n\ttotal := 0 // running\n\tfor _, x := range xs { total += x }\n\treturn total\n}"],
    ["html", "<button class=\"buy\" disabled>\n  <!-- shown when the cart is empty -->\n  Buy now\n</button>"],
    ["css", ".buy { color: #fff; padding: 4px 8px; }\n.buy:hover { opacity: 0.9 } /* soft */"],
    ["sql", "SELECT id, total FROM orders\nWHERE created_at > NOW() - INTERVAL '1 day' -- recent\nORDER BY total DESC LIMIT 10;"],
    ["markdown", "# Checkout\n\n- **Retries**: 3\n- `timeout`: 15 s"],
    ["diff", "--- a/src/cart.ts\n+++ b/src/cart.ts\n@@ -1,2 +1,2 @@\n-const max = 10\n+const max = 20"],
    ["dockerfile", "FROM oven/bun:1.2\nWORKDIR /app\nCOPY . .\nRUN bun install # deps\nCMD [\"bun\", \"start\"]"],
    ["", "plain text block with no language\nsecond line"],
  ];
  const md = `Here is one block per language:\n\n${blocks.map(([l, c]) => `${l || "(no language)"}:\n\n\`\`\`${l}\n${c}\n\`\`\``).join("\n\n")}`;
  const a = prompt("Show a short sample in each language the docs use");
  tool("Read", { file_path: "docs/samples.md" }, "…", a);
  assistant([{ type: "text", text: md }], { out: 900 });
  end(41000);
}

if (long) {
  const forty = Array.from({ length: 40 }, (_, i) => `line ${i + 1}: TimeoutError in checkout step ${i + 1} after 30000 ms`).join("\n");
  let a = prompt(`Why does the checkout job fail? Full log:\n${forty}`);
  tool("Read", { file_path: "ci.log" }, "…", a);
  assistant([{ type: "text", text: "The job waits on a URL the new flow never visits." }], { out: 40 });
  end(12000);
  const oneLine = Array.from({ length: 125 }, (_, i) => `token${i} and some more words`).join(" ").slice(0, 5000);
  a = prompt(oneLine);
  assistant([{ type: "text", text: "That is a single 5,000-character line." }], { out: 20 });
  end(6000);
  const wide = Array.from({ length: 200 }, (_, i) => `const row${String(i).padStart(3, "0")} = ${JSON.stringify("w".repeat(260))} // ${i}`).join("\n");
  a = prompt("Generate the 200-row lookup table");
  tool("Write", { file_path: "src/table.ts" }, "ok", a);
  assistant([{ type: "text", text: `Here is the table:\n\n\`\`\`ts\n${wide}\n\`\`\`\n\nEach row is 300 characters wide.` }], { out: 9000 });
  end(48000);
}

if (quotes) {
  const Q = [
    "> The retry path still logs a warning when the queue is empty.",
    "Make the backoff start at 200 ms and cap it at 5 s.",
    "> The retry path still logs a warning when the queue is empty.\n> It also retries forever.\n\nCap the retries at five, and log once.",
    "Two notes on your summary:\n\n> The cache is warmed on deploy.\n\nIt is not; the job was removed last week.",
    "> First, the queue drains on shutdown.\nGood, keep that.\n> Second, the alert fires after 3 misses.\nMake it 5.",
    ">No space after the marker here.\nStill a quote above; this is the comment.",
    "> > Nested: you said it twice.\n> Once more at one level.\n\nFlattened to one quote.",
    "Run this:\n\n```sh\n> not a quote, a redirect\necho ok > out.txt\n```\n\nThen tell me what it prints.",
    `${Array.from({ length: 40 }, (_, i) => `> quoted line ${i + 1} of the long summary`).join("\n")}\n\nThat is the whole summary; trim it to five lines.`,
  ];
  Q.forEach((q, i) => {
    prompt(q);
    assistant([{ type: "text", text: `Done with quote case ${i + 1}. The backoff now starts at 200 ms.` }], { out: 60 });
    end(7000 + i * 1000);
  });
}

if (linksFx) {
  prompt("Look at ACME-123 and PR #45, but not `ACME-7` in code.\n> ACME-88 was the old ticket.\nAlso see https://x.example/ACME-2 for context.");
  assistant([{ type: "text", text: "ACME-123 is fixed in #45. The colour #123456 is unchanged, and so is [ACME-1](https://x.example/one).\n\n```sh\ngit log --grep ACME-9\n```\n\nSee <https://x.example/ACME-3> and https://x.example/ACME-4 for the history; `ACME-5` stays code." }], { out: 90 });
  end(9000);
}

if (hostile) {
  prompt("Show me the escape sequence test");
  assistant([{ type: "text", text: "Line one of the reply.\nA paste end marker: \u001b[201~ and a carriage return\rrm -rf x\nLast line." }], { out: 40 });
  end(5000);
}

if (edge) {
  const block = Array.from({ length: 130 }, (_, i) => `const step${i} = schedule(${i}, "retry");`).join("\n");
  prompt("Show the whole retry table, then explain it");
  assistant([{ type: "text", text: `\`\`\`js\n${block}\n\`\`\`\n\nThe explanation follows here: each step waits twice as long as the one before.` }], { out: 900 });
  end(6000);
  prompt("Summarise the incident in one paragraph");
  assistant([{ type: "text", text: `${"The queue backed up because the retry loop never gave up and every worker kept waiting on the same lock. ".repeat(24)}\n\nSecond paragraph.` }], { out: 600 });
  end(6000);
  prompt("Where do the ticket numbers appear?");
  assistant([{ type: "text", text: "> ```\n> see ACME-2\n> ```\n\ntext `code\nACME-3 more` end, and ACME-4 in prose.\n\n- item\n\n    - ACME-7 nested" }], { out: 80 });
  end(5000);
  prompt(`${"Pasted log line with plain words in it. ".repeat(1000)}TAIL-END`);
  assistant([{ type: "text", text: "That log is long; the last line is the one that matters." }], { out: 40 });
  end(5000);
}

if (blocks) {
  // Three text blocks after the last tool call, no tool between them.
  let b = prompt("Explain the retry change in three parts");
  assistant([{ type: "text", text: "Checking the retry module first." }], { stop: "tool_use" });
  tool("Read", { file_path: "src/retry.ts" }, "…", b);
  assistant([{ type: "text", text: "Opening words of block one: the retry loop now stops after five tries" }, { type: "text", text: "and block two goes on mid-sentence, as a split reply can." }], { out: 70 });
  assistant([{ type: "text", text: "Block three closes the reply." }], { out: 20 });
  end(12000);
  // A tool call between two blocks: only the block after it is the reply.
  b = prompt("Rename the backoff option");
  assistant([{ type: "text", text: "Early text before the tool call, not part of the reply." }], { stop: "tool_use" });
  tool("Edit", { file_path: "src/retry.ts" }, "ok", b);
  assistant([{ type: "text", text: "Renamed backoff to delay in the retry options." }], { out: 30 });
  end(9000);
  // A task notification between two blocks of the reply.
  b = prompt("Run the retry tests and summarise");
  tool("Bash", { command: "bun test retry" }, "…", b);
  assistant([{ type: "text", text: "First part of the summary: all retry tests pass." }], { out: 30, stop: null });
  prompt("<task-notification>lint finished: 0 warnings</task-notification>", "task-notification", 3);
  assistant([{ type: "text", text: "Second part, after the notification: lint is clean too." }], { out: 30 });
  end(15000);
}

// A synthetic PNG: w x h, a diagonal gradient with a few colour blocks. No text.
function png(w, h, hue) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      const t = (x / w + y / h) / 2;
      let r = 40 + 120 * t, g = 60 + 80 * (1 - t), b = 90 + 100 * t;
      const box = (x0, y0, x1, y1) => x >= x0 * w && x < x1 * w && y >= y0 * h && y < y1 * h;
      if (box(0.1, 0.15, 0.45, 0.5)) { r = 230; g = 90 + hue; b = 70; }
      if (box(0.55, 0.3, 0.9, 0.8)) { r = 70; g = 160; b = 200 - hue; }
      if (box(0.2, 0.65, 0.4, 0.9)) { r = 240; g = 210; b = 90; }
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}
function imagePrompt(text, imgs, ids) {
  pad();
  const promptId = uid();
  const content = [{ type: "text", text }, ...imgs.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/png", data } }))];
  push({ ...base(), type: "user", promptId, origin: { kind: "human" }, promptSource: "typed", imagePasteIds: ids,
    turnPosition: { promptIndex: ++promptIndex, turnIndex: ++turnIndex },
    message: { role: "user", content }, uuid: uid(), timestamp: tick(30) });
  return promptId;
}

if (imagesFx) {
  imagePrompt("[Image #1] The header overlaps the search box at this width. Can you fix it?", [png(800, 400, 0)], [1]);
  assistant([{ type: "text", text: "The header had a fixed height. It now grows with its content, so the search box sits below it." }], { out: 40 });
  end(14000);
  imagePrompt("[Image #2] [Image #3] Compare the two layouts: the tall one is the phone view.", [png(300, 600, 40), png(400, 400, 80)], [2, 3]);
  assistant([{ type: "text", text: "The phone view stacks the filters above the list; the square one keeps them side by side." }], { out: 40 });
  end(11000);
  imagePrompt("[Image #4]", [png(640, 360, 120)], [4]);
  assistant([{ type: "text", text: "That is the empty state of the dashboard. It looks right." }], { out: 20 });
  end(8000);
}

if (open) {
  const pid = prompt("Run the full e2e suite and summarise the failures", "human", 40);
  for (let k = 0; k < 6; k++) tool("Bash", { command: "bun run e2e" }, "…", pid);
}

if (only == null) push({ type: "custom-title", customTitle: "login flake", sessionId });
push({ type: "last-prompt", lastPrompt: "Add a retry note to the README", sessionId });

writeFileSync(out, `${lines.join("\n")}\n`);
console.log(`${out}: ${lines.length} lines`);
