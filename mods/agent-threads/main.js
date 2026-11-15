// agent-threads: a pane beside a Claude Code, Codex, OpenCode, Pi, Cursor or Antigravity terminal that lists each prompt
// and the agent's final reply, with tool calls hidden. Read-only toward the agent, with one
// exception (RECIPE.md, How it behaves): quoteToTerminal() pastes a quote of a reply into the
// bound terminal's input as a bracketed paste (Herdr's terminal.paste, the ⌘V command),
// never followed by Enter or any other submit. Nothing else types into a terminal. The
// other commands it runs are pane.split (to open itself, and the Pinned column beside it),
// layout.resize (to give that column its width, and a pane Cmd-Shift-T opened the reading width), pane.focus (the Terminal button, v
// between the two panes, back to Threads after the column opens, and before the quote's paste) and pane.close (its own pane, and the Pinned column once its Threads pane is gone). The only programs
// it runs besides its scripts are hc get, git remote get-url and open <the README URL> (the
// Amp page's button; the scripts run jq, lsof, ps
// and sqlite3 -readonly). The only file it writes
// is its own settings file (settings.js).
//
// Two roles, one mod:
// - Opened with mod.open (keys.json "mod.open:agent-threads"), it is a launcher: it
//   splits a Threads pane to the right of the focused terminal and closes itself. Opened
//   on a Threads pane, it focuses that pane's terminal instead.
// - As a split pane, props().terminal names the terminal it reads. props().transcript, if
//   set, pins the pane to that transcript file instead of finding the terminal's session
//   (for demos and tests beside a terminal that does not run Claude). props().claudeHome
//   (an absolute path, tests and demos only) reads sessions from another folder than
//   ~/.claude. props().debug shows render timings in the header.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, VirtualListScrollHandle, v_virtual_list, TextView, Editor, EditorState } from "gpui-base";
// ScrollHandle (a plain scroll area's position, which j and k move in the image viewer's
// panel) is new in Herdr 0.1.15. A named import of it stops the mod loading on 0.1.14, so it
// is read from the module's namespace, and the viewer works without it.
import * as gpuiBase from "gpui-base";
// Popup (the rail card) is new in 0.1.15 too: without it the rail keeps its one-line tooltip.
const Popup = gpuiBase.Popup?.new ? gpuiBase.Popup : null;
// PathBuilder and Background paint the fade under the floating top as a gradient (Herdr
// 0.1.15); read from the namespace for the same reason, with steps of alpha without them.
import * as gpuiKit from "gpui-kit";
const PAINT = gpuiKit.PathBuilder?.fill && gpuiKit.Background?.linear_gradient ? gpuiKit : null;
import {
  exec, hc, home, appHome, readTextFile, watchFolder, theme, themes, settings, panes, terminals, spaces,
  focused, props, run, shared, setShared, closeOverlay, openOverlay, notify, nextCommand, updates,
} from "herdr";
import {
  newSession, apply, rewindTail, newChunk, parseLine, nextChunk, replaced, reply, stats, segments, threadMatches,
  fmtTokens, fmtDuration, fmtClock, fmtTime, fmtBytes, shortModel, fmtPct, cacheLine, cachePct, commandParts, fmtCount,
} from "./turns.js";
import { claudePaths, slug, argvSession, recordSession, decide, dividerLabel, candidates } from "./session.js";
import { HARNESS, harnessOf, harnessOfFile, idOfFile, dbOfFile, fileChanged, codexArgvSession, pickCodexDaemon, claudeAttach, opencodeAttach, opencodeArgv, etimeMs, pickOpenCode, openCodeLabel, quotePaste, piArgv, piFolder, piStartMs, cursorFolder, cursorStore, cursorArgv, cursorRoots, MARKS, agyBrain, agyArgv, agyFile, UNREAD, unreadOf } from "./harness.js";
import {
  keyAction, alpha, spans, around, langFor, clipPrompt, wrappedLines, dayKey, dayLabel, dayParts, jumpTarget,
  rowLines, flattenMd, rowShape, rowTextWidth, replyWidth, readWidth, readType, bubbleMax, ROW, senderLabel, senderIcon, kindWords, isShown, countLabel,
  focusTarget, contrast, labelColor, middle, commandColor, clipYou, promptMd, promptParts, linkify,
  quoteText, inReply, atLeast, foreground, canQuote, parseRemote, actsLayout, stripLayout, boxHit, ICON_BOX, QUOTE_INSET, cardLabelColor, bandFill, over, bubbleStyle, bubbleValue, BUBBLES,
  thumbSize, tileRow, TILE_GAP, mdPreview, codeRows, mdChunks, escapeDollars, cutMd, rowHeight, pinColumn, PIN_COL, PIN_SPLIT_MIN, galleryBox, headerButtonWidth, fitWidth, WIDTH_NAMES, widthChars, columnResize, PIN_STEP, PIN_ROW, pinRowShape, pinPromptText,
  keySheet, fitHints, agentState, outlineText, outlineHeight, outlineNumW, VIEWER, viewerLayout, viewerKey, labelPieces, replyBlocks, replyScroll, fencedBlock, mix, RAIL, railLayout, toolKind, groupText, KIND_ICON, callTime, outLines, outHeight, callText, shortPaths, OUT,
} from "./ui.js";
import { PIN_LIMIT, turnIds, parsePins, pinsText, mergeDirty, seenOf, newPin, pinState, partOf, partKeys, NOT_A_PLACE, placeAtTop, placeItem, byTime } from "./pins.js";
import { DEFAULTS, RANGES, LOOK, nameValue, parseSettings, parseExtras, settingsText, settingsDir, settingsPath, saveSettings, pinsPath, savePinsText, writable, NOT_SAVED, adoptPrevious } from "./settings.js";
import { MOD } from "./name.js";

const ICON = (n) => `mods/${MOD}/${n}.svg`;
// The turn a list row belongs to, or null (a day band, the spacer, the tail).
const rowTurnKey = (r) => (r?.turn && r.si != null ? `${r.si}:${r.turn.n}` : null);
// The height of a step group's line and the gap above it, and of a call's row in an open
// group.
const GROUP_H = 22;
const STEP_GAP = 4;
const CALL_H = 20;
// Calls read for level 3 kept in memory at once (pruneCalls).
const CALLS_MAX = 800;
// The agents whose calls calls.sh reads.
const CALLS_READ = new Set(["claude", "codex", "pi", "opencode", "antigravity"]);
// A clear colour, for what a hover reveals.
const CLEAR = "#00000000";
// The Jump to latest pill's height and its gap over the footer.
const PILL_H = 28;
const PILL_GAP = 10;
const SCRIPT = (n) => `${appHome()}/mods/${MOD}/${n}`;
// An agent's mark on its tile (MARKS in harness.js), size px square, or null for an agent
// with none. A one-colour mark is drawn white; a full-colour one as it is.
function mark(key, size) {
  const m = MARKS[key];
  if (!m) return null;
  const glyph = Math.round(size * (key === "claude" ? 0.7 : 0.75));
  return div().flex_none().size(size).rounded(Math.max(3, Math.round(size / 4))).bg(m.tile).flex().items_center().justify_center()
    .child(m.tint ? svg(ICON(m.icon)).size(glyph).text_color("#ffffff") : image(ICON(m.icon)).size(glyph));
}
// Pasted images, decoded by image.sh into the mod's data folder (kept across installs, never
// in the repo, trimmed to 200 MB). image() takes paths from the app home.
const IMG_DIR = `data/${MOD}/images`;
// Bytes per extractor call. A 6.7 MB busy transcript reads in 4 calls, so the header's
// percentage moves, and each call's parse and apply run in slices (read()).
const CHUNK = 2 * 1024 * 1024;
const SLICE_MS = 8; // synchronous work before read() yields to the app
// Reshaping collapsed rows (shape) in one draw: a change of Reply lines, Prompt lines, text
// size, the width or the search reshapes every row, and in a long session that ran past
// Herdr's time for a draw ("This view could not be re-rendered", interrupted). Past this
// many ms a row keeps the shape it had, and the next frame goes on (rows, render).
const SHAPE_MS = 12;
// Rows reshaped first, from the one at the top of the pane down, so what is on screen
// changes in the first frame.
const SHAPE_FIRST = 40;
// The hidden probe (probe) draws at most this many parts in one frame, nearest the top of
// the pane first. Opening the work of a turn with hundreds of steps put every interim text
// in one draw, and it ran past Herdr's time ("This view could not be re-rendered",
// interrupted). The rest are measured over the next frames.
const PROBE_MAX = 16;
// The list ends in a blank row this tall. On screen, the view counts as at the bottom: new
// content then keeps it pinned there, as a chat does (stickToBottom).
const TAIL = 24;
// A read with no heartbeat for this long was interrupted (watchRead). Every step between
// heartbeats is a slice of at most a few tens of ms, so 4 s is far past any real step.
const READ_STALL = 4000;
// The same while the read awaits the extractor: a slow call or a busy disk is not an
// interrupt, and the read then resumes at its offset (nothing was applied yet).
const EXEC_STALL = 30000;
// The 1 s timer did not run for this long (the computer slept, the app was suspended):
// the read's clock starts again instead of the read being judged stalled.
const TICK_GAP = 3000;
const MAP_KEY = "threads.byTerminal";
// shared("threads.pinnedByTerminal"): terminal -> its Pinned pane (v), kept apart from the
// map above so Cmd-Shift-T still finds the main Threads pane.
const PIN_MAP_KEY = "threads.pinnedByTerminal";
// shared("threads.fit"): panes the launcher just opened, which size themselves to fitWidth once.
const FIT_KEY = "threads.fit";
// Each pane's measured width, so the Pinned column and its Threads pane can resize together.
const WIDTH_KEY = "threads.width";
const DAY_STRIP = 32; // the Pinned view's strip above the list that shows the day while scrolling
// The floating top: the band the state and the icons sit in over the top of the list, and the
// gap the list leaves above its first row so nothing starts under them.
const TOP_BAND = 32;
// The day pill over the list shows while you scroll, and goes this long after you stop.
const DAY_PILL_MS = 1500;
const PDAY_H = 30; // a day header in the Pinned view
// What Herdr's layout px size adds to the width a pane measures (its frame).
const PANE_FRAME = 2;
// The Pinned heading's width: a 14 px pin, 6 px, and "Pinned" at 13.5 px semibold (about 46 px).
const PINNED_HEADING = 66;
// The header's state chip: its padding a side (the hover fill), and what its tooltip adds.
const STATE_PAD = 5;
const STATE_CLICK = "click to go to the terminal (t)";
const SELECT_CHARS = 60000; // of a reply in the Select text view
const SELECT_CHAR = 7.5; // px per character of the terminal font at 12.5 px
// Every agent Threads reads, for the notices that name them (one list, so a new agent is
// named everywhere at once).
const AGENT_NAMES = "Claude Code, Codex, OpenCode, Pi, Cursor or Antigravity";
const PROMPT_LINES = 3; // in the open card's YOU block (collapsed rows use the settings)
const PROMPT_CHARS = 600;
const FULL_PROMPT_CHARS = 200000; // of a prompt with Show all; a note says what is left out
const YOU_MAX = 420; // a whole prompt taller than this scrolls inside the YOU block
const DRAG_SLOP = 4; // design px a press may move and still be a click, not a text selection
const FULL_REPLY_CHARS = 200000; // of an open reply; a note under it says what is left out
const VIEWER_PROMPT = 8000; // characters of the prompt in the image viewer's panel
const LONG_REPLY = 1600; // characters past which an open reply ends in a Collapse (Esc) row
// px above a paragraph drawn as its own list item, and above a heading, as inside one block
// (measured against the same text drawn whole: 748 px and 748 px).
const visitNote = (search) => (search ? "Pinned, not in this search" : "Pinned, hidden agent message");
const CODE_LINES = 12;
const LINE = 18; // one line of 13 px text in a box of that height (rows, code)
// gpui's default line height is about 1.618 times the text size: 21 px for 13 px TextView
// and plain text (the owner's screenshot measures 21.1). Estimates of such text use it.
const TV_LINE = 21;
const COUNTS_LINE = 16; // the counts line's explicit line height (11 px mono)
// A code block's line: its 12 px editor at gpui's default of about 1.618 em is 19.4 px, so
// 20 px leaves a code block's last line whole. The block's box sets this line height for
// the editor to inherit; an editor that keeps its own shorter line leaves a few px of the
// box's own background below the code, never a cut line (R3-2).
const CODE_LINE = 20;
// The Updating line under a done turn while a background task has woken the agent.
const WAKE_H = 24;
// The code box's borders and the editor's own padding inside it, left and right.
const CODE_PAD = 24;
const NOTE_LINE = 20; // the working card's 12 px note, set explicitly (about 1.618 em)
const MONO_EM = 0.6; // width of a mono character, in em
// Open-card parts whose text gpui wraps: drawn once more in a hidden probe, measured, and
// then given that height (measured()).
const PROBED = new Set(["you", "rhead", "md", "itext", "lhead", "latest", "stats", "legend", "noreply", "cmd"]);
const MD_CHAR = 6.1; // estimated width of a character of 13 px reply prose (scaled by charW())
const YOU_CHAR = 6.2; // the same for the prompt, a little wider: the YOU block clips
const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "nu", "pwsh", "login", "tcsh", "ksh"]);
const CARD = new Set(["head", "imgs", "you", "ustrip", "rhead", "itext", "grp", "call", "cout", "wspin", "noreply", "md", "codehead", "code", "fold", "lhead", "latest", "stats", "legend", "copy", "seltext", "resume"]);
const PREVIEW_CHARS = 1200; // of a prompt or reply, enough for any row's line limit
const LATEST_LINES = 6;

const base = (p) => (p ?? "").split("/").pop().replace(/^-/, "");
const dirname = (p) => p.slice(0, p.lastIndexOf("/"));
const idOf = (p) => idOfFile(p);
const POLL_MS = 3000; // how often a pane on Codex, OpenCode, Pi, Cursor or Antigravity looks for a new session
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;
const tilde = (p) => (p?.startsWith(home()) ? `~${p.slice(home().length)}` : p ?? "");
const now = () => globalThis.performance?.now?.() ?? Date.now();
// One stderr line for a banner, with folders cut to the file name.
const clean = (s) => (s ?? "").trim().split("\n")[0].replace(/\/[^\s:'"]+/g, (p) => p.split("/").pop()).slice(0, 200);
const when = (ts) => (dayKey(ts) === dayKey(Date.now()) ? fmtTime(ts) : `${dayLabel(ts)} ${fmtTime(ts)}`);
const readClip = (cx) => { try { return cx.read_from_clipboard?.() ?? ""; } catch { return ""; } };

// ---- launcher ---------------------------------------------------------------------------

// Returns a function that records the new pane once the split has applied, or null.
function launch() {
  const f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  if (pane?.mod === MOD) {
    // Pressed on a Threads pane: go back to the terminal it reads.
    const term = Object.entries(shared(MAP_KEY) ?? {}).find(([, v]) => v.pane === pane.pane)?.[0]
      ?? Object.entries(shared(PIN_MAP_KEY) ?? {}).find(([, v]) => v.pane === pane.pane)?.[0];
    if (term && terminals().some((t) => t.address === term)) {
      // By pane id: pane.focus {terminal} prefers a layout block showing the terminal, which
      // may be outside this tab.
      const target = focusTarget(panes(), term, pane.tab);
      run("pane.focus", target ? { pane: target.pane } : { terminal: term });
    }
    return null;
  }
  if (!pane?.terminal) {
    notify({ title: "Agent Threads", body: `Focus a ${AGENT_NAMES} terminal first, then open Threads beside it.`, level: "info", timeout: 4000 });
    return null;
  }
  const known = shared(MAP_KEY)?.[pane.terminal];
  if (known && panes().some((p) => p.pane === known.pane)) {
    run("pane.focus", { pane: known.pane });
    return null;
  }
  const before = new Set(panes().map((p) => p.pane));
  run("pane.split", { pane: pane.pane, direction: "right", mod: MOD, props: { terminal: pane.terminal } });
  return () => {
    const made = panes().find((p) => p.mod === MOD && !before.has(p.pane));
    if (!made) return false;
    remember(pane.terminal, made.pane);
    // The new pane sizes itself to the reading width once it knows its width (fitOnOpen).
    setShared(FIT_KEY, { ...(shared(FIT_KEY) ?? {}), [made.pane]: true });
    return true;
  };
}

// shared("threads.byTerminal"): terminal -> its Threads pane, so the launcher focuses an
// open one instead of splitting again, and a pane knows its own id. The Pinned pane is kept
// in its own map (PIN_MAP_KEY).
function remember(terminal, pane, key = MAP_KEY) {
  const map = { ...(shared(key) ?? {}) };
  for (const [k, v] of Object.entries(map)) if (!panes().some((p) => p.pane === v.pane)) delete map[k];
  map[terminal] = { pane };
  setShared(key, map);
}

// ---- finding the session ----------------------------------------------------------------

function paths(claudeHome) {
  const P = claudePaths(home(), claudeHome);
  P.show = (p) => p.replace(P.root, claudeHome ? "claude-home" : "~/.claude");
  return P;
}

async function locate(...args) {
  const r = await exec("sh", [SCRIPT("locate.sh"), ...args]).catch(() => null);
  return r && r.code === 0 ? r.stdout.trim() : null;
}

async function listFolder(dir) {
  const out = await locate("list", dir);
  return (out ?? "").split("\n").filter(Boolean).map((l) => {
    const [mtime, size, ...rest] = l.split(" ");
    return { mtime: Number(mtime) * 1000, size: Number(size), path: rest.join(" ") };
  });
}

// A Codex session file's first line never changes: its folder, start and origin, by path.
const codexMeta = new Map();

// The last write of each file, in ms, by path (locate.sh mtimes).
async function listMtimes(files) {
  const out = await locate("mtimes", ...files);
  const m = new Map();
  for (const l of (out ?? "").split("\n")) {
    const at = l.indexOf(" ");
    if (at > 0) m.set(l.slice(at + 1), Number(l.slice(0, at)) * 1000);
  }
  return m;
}

async function heldIds(root, pid) {
  const out = await locate("held", root, String(pid ?? ""));
  return new Set((out ?? "").split("\n").filter(Boolean));
}

// Terminal -> transcript, in this order:
// foreground pid -> <claude home>/sessions/<pid>.json, then --resume/--session-id in argv,
// then the transcripts for the folder (a guess, with up to five to choose from).
async function resolve(address, claudeHome, current = null) {
  if (address.includes("/")) return { kind: "remote" };
  const term = terminals().find((t) => t.address === address);
  if (!term) return { kind: "gone" };
  const pane = panes().find((p) => p.terminal === address);
  const P = paths(claudeHome);
  const tried = {};
  let info = {};
  try { info = JSON.parse((await hc(["get", address, "--json"])).stdout); } catch { /* keep going */ }
  const fg = info.foreground ?? {};
  const argv = fg.argv ?? [];
  const cmd = base(argv[0] ?? fg.name);
  const version = /^\d+\.\d+\.\d+/.test(fg.name ?? "") ? fg.name : null;
  const claude = cmd === "claude" || Boolean(version);
  const shell = SHELLS.has(cmd) || SHELLS.has(base(fg.name));
  const app = pane?.app === "claude-code";
  const program = pane?.program;
  // Amp: the pane knows it and does not read it (UNREAD says why).
  const unread = !claude && !app && !harnessOf(fg, pane) ? unreadOf(fg, pane) : null;
  if (unread) return { kind: "unsupported", name: UNREAD[unread].name, key: unread };
  if (!claude && !app && !harnessOf(fg, pane) && program?.agent && program.key !== "claude" && !shell)
    return { kind: "unsupported", name: program.name ?? cmd };
  const pid = fg.pid ?? null;
  const live = claude || app;
  const cwd = fg.cwd || pane?.cwd || term.cwd || null;
  // The process reports its real path (/private/tmp/x on macOS) while the terminal may
  // report the path it was opened with (/tmp/x); Claude names the folder after one of them.
  const cwds = [...new Set([fg.cwd, pane?.cwd, term.cwd, info.cwd].filter(Boolean)
    .flatMap((c) => [c, c.replace(/^\/private(?=\/(tmp|var|etc)\/)/, "")]))];
  const harness = harnessOf(fg, pane);
  if (harness === "codex") return resolveCodex({ argv, pid, cwd, cwds, cmd }, current);
  if (harness === "pi") return resolvePi({ argv, pid, cwd, cwds, cmd }, current);
  if (harness === "cursor") return resolveCursor({ argv, pid, cwd, cwds, cmd }, current);
  if (harness === "opencode") return resolveOpenCode({ argv, pid, cwd, cwds, cmd, title: info.title ?? pane?.title ?? term.title }, current);
  if (harness === "antigravity") return resolveAntigravity({ argv, pid, cwd, cmd });
  const who = { claude, live, pid, cwd };
  tried.program = { what: "Program in pane", detail: `${claude ? `claude${version ? ` ${version}` : ""}` : cmd || "?"}${pid ? ` · pid ${pid}` : ""}`, ok: claude };
  const fromArgv = argvSession(argv);
  tried.argv = {
    what: "Session id in arguments", ok: Boolean(fromArgv),
    detail: fromArgv ? fromArgv.slice(0, 8) : argv.includes("--fork-session") ? "--fork-session writes a new id" : "no --resume or --session-id",
  };
  let id = null;
  let via = null;
  if (live && pid) {
    const path = P.record(pid);
    const text = await readTextFile(path).catch(() => null);
    id = recordSession(text);
    tried.record = { what: "Live session record", detail: `${P.show(path)}${id ? ` · ${id.slice(0, 8)}` : text == null ? " missing" : " names no session"}`, ok: Boolean(id) };
    if (id) via = "record";
  } else {
    tried.record = { what: "Live session record", detail: "no claude process to look up", ok: false };
  }
  if (!id && fromArgv) { id = fromArgv; via = "argv"; }
  // claude attach <id|name>: a background session (claude --bg), whose own record names it.
  const attach = claudeAttach(argv);
  if (!id && attach && cmd === "claude") {
    const sid = await locate("claude-bg", P.sessions, attach);
    tried.attach = { what: "Background session it attached to", detail: sid ? sid.slice(0, 8) : `no claude --bg session ${attach}`, ok: Boolean(sid) };
    if (sid) { id = sid; via = "attach"; }
  }
  const order = () => ["program", "argv", "record", "attach", "file", "newest"].map((k) => tried[k]).filter(Boolean);
  if (id) {
    const file = await locate("find", P.root, id);
    if (file) return { kind: "found", id, file, via, ...who, guess: false, tried: order() };
    tried.file = { what: "Transcript for that id", detail: `${id.slice(0, 8)}….jsonl not written yet`, ok: false };
    // A fresh claude writes its transcript with the first prompt.
    if (live) return { kind: "pending", id, via, ...who, tried: order(), watch: P.projects };
  }
  let choices = [];
  if (cwd) {
    let dir = null;
    for (const c of cwds) if (!dir) dir = await locate("folder", P.projects, slug(c));
    for (const c of cwds) if (!dir) dir = await locate("folder", P.projects, slug(c), JSON.stringify(c).slice(1, -1));
    const files = dir ? await listFolder(dir) : [];
    choices = candidates(files, files.length ? await heldIds(P.root, pid) : new Set(), 5);
    tried.newest = {
      what: "Newest transcript in project folder", ok: choices.length === 1,
      detail: !choices.length ? `none for ${tilde(cwd)}`
        : choices.length === 1 ? `${idOf(choices[0].path).slice(0, 8)} · modified ${when(choices[0].mtime)}`
          : `${choices.length} candidates in ${tilde(cwd)}, too close to call`,
    };
    if (choices.length && live)
      return { kind: "found", id: idOf(choices[0].path), file: choices[0].path, via: "cwd", ...who, guess: true, choices, tried: order() };
  } else {
    tried.newest = { what: "Newest transcript in project folder", detail: "the terminal reports no folder", ok: false };
  }
  return { kind: "none", ...who, tried: order(), choices };
}

// A Codex process keeps its session file open, which names it exactly (codex --no-daemon).
// Plain codex runs the session in Codex's app-server daemon, which holds the file instead
// (pickCodexDaemon). Codex writes no file until the first prompt, so a process with none is
// waiting for one.
async function resolveCodex({ argv, pid, cwd, cwds, cmd }, current) {
  const who = { harness: "codex", claude: false, live: true, pid, cwd };
  const program = { what: "Program in pane", detail: `${cmd}${pid ? ` · pid ${pid}` : ""}`, ok: true };
  const open = pid ? await locate("codex-open", String(pid)) : null;
  const openStep = { what: "Session file the process has open", detail: open ? idOf(open).slice(0, 8) : "none", ok: Boolean(open) };
  if (open) return { kind: "found", id: idOf(open), file: open, via: "open file", ...who, guess: false, tried: [program, openStep] };
  const named = codexArgvSession(argv);
  if (named) {
    const file = await locate("codex-find", named);
    if (file) return { kind: "found", id: named, file, via: "argv", ...who, guess: false, tried: [program, openStep] };
  }
  // The files Codex's app servers hold; each one's first line is read once (codexMeta).
  const paths = ((await locate("codex-held")) ?? "").split("\n").filter(Boolean);
  const fresh = paths.filter((p) => !codexMeta.has(p));
  if (fresh.length) {
    for (const l of ((await locate("codex-meta", ...fresh)) ?? "").split("\n")) {
      try { const m = JSON.parse(l); codexMeta.set(m.path, m); } catch { /* not a line */ }
    }
    if (codexMeta.size > 500) for (const k of [...codexMeta.keys()].slice(0, 250)) codexMeta.delete(k);
  }
  const mtimes = paths.length ? await listMtimes(paths) : new Map();
  const held = paths.map((p) => codexMeta.get(p)).filter(Boolean).map((m) => ({ ...m, mtime: mtimes.get(m.path) ?? m.mtime }));
  const age = pid ? etimeMs(await locate("etime", String(pid))) : null;
  const where = cwds ?? [cwd].filter(Boolean);
  const resumed = (argv ?? []).includes("resume");
  const near = held.some((f) => where.includes(f.cwd));
  const peers = near && pid && cwd ? Number(await locate("codex-peers", String(pid), cwd)) || 0 : 0;
  const pick = pickCodexDaemon(held, where, age == null ? null : Date.now() - age, { peers, current, resumed });
  const daemonStep = {
    what: "Session file the Codex daemon has open",
    detail: !pick.file ? "none yet" : `${idOf(pick.file).slice(0, 8)}${pick.choices.length ? ` · ${pick.choices.length} in this folder` : ""}${peers ? ` · ${plural(peers + 1, "Codex terminal")} here` : ""}`,
    ok: Boolean(pick.file),
  };
  const tried = [program, openStep, daemonStep];
  const choices = pick.choices.map((x) => ({ mtime: x.mtime, size: null, path: x.path }));
  if (pick.file) return { kind: "found", id: idOf(pick.file), file: pick.file, via: "daemon", ...who, guess: pick.guess, choices, tried };
  const watch = await locate("codex-dir");
  return { kind: "pending", id: null, via: null, ...who, tried, watch };
}

// OpenCode records no process for a session, so the terminal title, its folder and its start time
// decide (pickOpenCode).
async function resolveOpenCode({ argv, pid, cwd, cwds, cmd, title }, current) {
  const who = { harness: "opencode", claude: false, live: true, pid, cwd };
  const program = { what: "Program in pane", detail: `${cmd}${pid ? ` · pid ${pid}` : ""}`, ok: true };
  const script = async (...args) => {
    const r = await exec("sh", [SCRIPT("opencode.sh"), ...args]).catch(() => null);
    return r && r.code === 0 ? r.stdout.trim() : null;
  };
  const db = await script("db");
  if (!db) return { kind: "none", ...who, tried: [program, { what: "OpenCode's database", detail: "not found", ok: false }], choices: [] };
  // opencode attach <url>: the sessions are the server's, under --dir or the server's folder.
  const attach = opencodeAttach(argv);
  const tried = [program];
  if (attach) {
    const dir = attach.dir ?? (attach.local ? await script("server-dir", String(attach.port)) : null);
    tried.push({ what: "Folder of the OpenCode server", detail: dir ? tilde(dir) : attach.local ? "server not found" : `${attach.url} is on another machine`, ok: Boolean(dir) });
    if (dir) cwds = [dir, dir.replace(/^\/private(?=\/(tmp|var|etc)\/)/, ""), ...cwds];
  }
  const lines = (await script("sessions", db, ...cwds)) ?? "";
  const list = lines.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const age = pid ? etimeMs(await locate("etime", String(pid))) : null;
  const peers = pid && cwd ? Number(await script("peers", String(pid), cwd)) || 0 : 0;
  const file = (id) => `${db}#${id}`;
  const pick = pickOpenCode(list, age == null ? null : Date.now() - age, peers, opencodeArgv(argv), current, title);
  const step = {
    what: "Sessions in this folder since the process started",
    detail: !pick.id ? "none yet" : `${pick.id.slice(0, 12)}${peers ? ` · ${plural(peers + 1, "OpenCode terminal")} here` : ""}`,
    ok: Boolean(pick.id),
  };
  const choices = pick.choices.map((x) => ({ mtime: x.updated, size: null, path: file(x.id), label: openCodeLabel(x) }));
  tried.push(step);
  if (!pick.id) return { kind: "pending", id: null, via: null, ...who, tried, watch: dirname(db), choices };
  return { kind: "found", id: pick.id, file: file(pick.id), via: pick.via, ...who, guess: pick.guess, choices, tried };
}

// Pi keeps no session file open and records no process, so its sessions folder for the working
// directory, the process's start time and the command line decide, as for OpenCode
// (pickOpenCode). Pi writes only the session it is on, so a file's last write is when its last
// turn ran.
async function resolvePi({ argv, pid, cwd, cwds, cmd }, current) {
  const who = { harness: "pi", claude: false, live: true, pid, cwd };
  const program = { what: "Program in pane", detail: `${cmd}${pid ? ` · pid ${pid}` : ""}`, ok: true };
  const root = (await locate("pi-dir")) ?? `${home()}/.pi/agent/sessions`;
  const named = piArgv(argv);
  // --session <path>: that file. One not written yet reads as missing until it is.
  if (named.path)
    return { kind: "found", id: named.id, file: named.path, via: "argv", ...who, guess: false, tried: [program] };
  let dir = null;
  let files = [];
  for (const c of cwds) {
    if (files.length) break;
    dir = piFolder(root, c);
    files = (await listFolder(dir)).filter((f) => harnessOfFile(f.path) === "pi");
  }
  const list = files.map((f) => ({ id: idOfFile(f.path), path: f.path, created: piStartMs(f.path) ?? f.mtime, updated: f.mtime, busy: f.mtime }));
  const byId = named.id ? list.find((x) => x.id === named.id || x.id.startsWith(named.id)) : null;
  const age = pid ? etimeMs(await locate("etime", String(pid))) : null;
  const peers = pid && cwd ? Number(await locate("pi-peers", String(pid), cwd)) || 0 : 0;
  const pick = pickOpenCode(list, age == null ? null : Date.now() - age, peers, { id: byId?.id ?? null, cont: named.cont }, current, null);
  const step = {
    what: "Sessions in this folder since the process started",
    detail: !pick.id ? "none yet" : `${pick.id.slice(0, 8)}${peers ? ` · ${plural(peers + 1, "Pi terminal")} here` : ""}`,
    ok: Boolean(pick.id),
  };
  const choices = await Promise.all(pick.choices.map(async (x) => ({ mtime: x.updated, size: null, path: x.path, label: (await locate("pi-label", x.path)) || null })));
  const found = pick.id && list.find((x) => x.id === pick.id);
  // A fresh Pi writes its file with the first reply; the folder may not exist before then.
  if (!found) return { kind: "pending", id: null, via: null, ...who, tried: [program, step], watch: files.length ? dir : root, choices };
  return { kind: "found", id: found.id, file: found.path, via: pick.via, ...who, guess: pick.guess, choices, tried: [program, step] };
}

// A Cursor process keeps its chat's store open, and the store's path names the chat id; its
// transcript is written with the first reply, under Cursor's data folder (cursorRoots). Without that, --resume <id>,
// else the folder's newest transcript since the process started, as for Pi.
async function resolveCursor({ argv, pid, cwd, cwds, cmd }, current) {
  const who = { harness: "cursor", claude: false, live: true, pid, cwd };
  const program = { what: "Program in pane", detail: `${cmd}${pid ? ` · pid ${pid}` : ""}`, ok: true };
  const store = pid ? cursorStore(await locate("cursor-open", String(pid))) : null;
  const openStep = { what: "Chat the process has open", detail: store ? store.id.slice(0, 8) : "none", ok: Boolean(store) };
  // The transcripts' folder first: a newer Cursor keeps the store elsewhere (cursorRoots).
  const roots = cursorRoots((await locate("cursor-dir")) ?? `${home()}/.cursor`, store);
  const data = roots[0];
  const named = cursorArgv(argv);
  const id = store?.id ?? named.id;
  if (id) {
    let file = null;
    for (const r of roots) if (!file) file = await locate("cursor-find", r, id);
    const via = store ? "open file" : "argv";
    if (file) return { kind: "found", id, file, via, ...who, guess: false, tried: [program, openStep] };
    if (store) return { kind: "pending", id, via, ...who, tried: [program, openStep], watch: `${data}/projects` };
  }
  let dir = null;
  let files = [];
  for (const c of cwds) {
    if (files.length) break;
    dir = cursorFolder(data, c);
    const out = await locate("cursor-list", dir);
    files = (out ?? "").split("\n").filter(Boolean).map((l) => {
      const [mtime, size, ...rest] = l.split(" ");
      return { mtime: Number(mtime) * 1000, size: Number(size), path: rest.join(" ") };
    });
  }
  const list = files.map((f) => ({ id: idOfFile(f.path), path: f.path, created: f.mtime, updated: f.mtime, busy: f.mtime }));
  const age = pid ? etimeMs(await locate("etime", String(pid))) : null;
  const peers = pid && cwd ? Number(await locate("cursor-peers", String(pid), cwd)) || 0 : 0;
  const pick = pickOpenCode(list, age == null ? null : Date.now() - age, peers, { id: null, cont: named.cont }, current, null);
  const step = {
    what: "Chats in this folder since the process started",
    detail: !pick.id ? "none yet" : `${pick.id.slice(0, 8)}${peers ? ` · ${plural(peers + 1, "Cursor terminal")} here` : ""}`,
    ok: Boolean(pick.id),
  };
  const choices = await Promise.all(pick.choices.map(async (x) => ({ mtime: x.updated, size: null, path: x.path, label: (await locate("cursor-label", x.path)) || null })));
  const found = pick.id && list.find((x) => x.id === pick.id);
  if (!found) return { kind: "pending", id: null, via: null, ...who, tried: [program, openStep, step], watch: files.length ? dir : `${data}/projects`, choices };
  return { kind: "found", id: found.id, file: found.path, via: pick.via, ...who, guess: pick.guess, choices, tried: [program, openStep, step] };
}

// An agy process keeps its conversation's folder open (<data>/brain/<id>), which names it
// exactly; its transcript is written with the first prompt. Else --conversation <id>.
async function resolveAntigravity({ argv, pid, cwd, cmd }) {
  const who = { harness: "antigravity", claude: false, live: true, pid, cwd };
  const program = { what: "Program in pane", detail: `${cmd}${pid ? ` · pid ${pid}` : ""}`, ok: true };
  const brain = pid ? agyBrain(await locate("agy-open", String(pid))) : null;
  const openStep = { what: "Conversation the process has open", detail: brain ? brain.id.slice(0, 8) : "none yet", ok: Boolean(brain) };
  const data = brain?.data ?? (await locate("agy-dir")) ?? `${home()}/.gemini/antigravity-cli`;
  const id = brain?.id ?? agyArgv(argv).id;
  if (!id) return { kind: "pending", id: null, via: null, ...who, tried: [program, openStep], watch: `${data}/brain` };
  const file = agyFile(data, id);
  const via = brain ? "open file" : "argv";
  const written = (await listFolder(dirname(file))).some((f) => f.path.endsWith("/transcript_full.jsonl"));
  if (!written) return { kind: "pending", id, via, ...who, tried: [program, openStep], watch: `${data}/brain` };
  return { kind: "found", id, file, via, ...who, guess: false, tried: [program, openStep] };
}

// What a session's file takes to read one chunk.
function readArgs(file, offset, chunk) {
  const h = harnessOfFile(file);
  if (h === "opencode") return [SCRIPT("opencode.sh"), "read", dbOfFile(file), idOfFile(file), String(offset), String(chunk)];
  if (h === "codex" || h === "pi" || h === "cursor" || h === "antigravity") return [SCRIPT("extract.sh"), file, String(offset), String(chunk), h];
  return [SCRIPT("extract.sh"), file, String(offset), String(chunk)];
}

// ---- the panel --------------------------------------------------------------------------

export default class Threads extends View {
  init(_p, cx) {
    const p = props() ?? _p ?? {};
    // A copy opened as the full-window image gallery (openGallery): it draws only that.
    if (p.gallery) { this.initGallery(p, cx); return; }
    if (p.overlay) {
      this.launcher = true;
      cx.timer.after(0, (cx) => {
        const record = launch();
        if (!record) return closeOverlay(p.overlay);
        let tries = 0;
        const again = (cx) => { if (record() || ++tries > 20) closeOverlay(p.overlay); else cx.timer.after(100, again); };
        again(cx);
      });
      return;
    }
    this.terminal = p?.terminal ?? null;
    this.pinned = p?.transcript ?? null;
    this.pinnedVia = "props";
    this.claudeHome = typeof p?.claudeHome === "string" && p.claudeHome.startsWith("/") ? p.claudeHome.replace(/\/+$/, "") : null;
    this.debug = Boolean(p?.debug);
    // props().view "pinned": this pane is the Pinned pane that v split off a Threads pane.
    // view is what the list shows: "all" turns, or the "pinned" ones (the Pinned pane, or
    // the switch in a pane too narrow to split).
    this.pinnedPane = p?.view === "pinned";
    this.view = this.pinnedPane ? "pinned" : "all";
    // Tests only, with debug: a pane width to lay out for when the window does not draw
    // (a window behind another never reports its size). Never set by the launcher.
    this.forcedWidth = this.debug && Number(p?.width) > 0 ? Number(p.width) : null;
    this.sessions = []; // oldest first; a new one starts after /clear or a restart
    this.res = { kind: "resolving" };
    this.sel = null; // key of the selected turn
    this.open = new Set(); // keys of expanded turns
    this.full = new Set(); // keys showing the whole prompt ("k") or an update ("l:k")
    this.selecting = null; // the open turn whose reply shows as selectable source
    this.selEditor = null; // { key, st, text }
    this.code = new Map(); // `${key}:${i}` -> { st: EditorState, or false when it could not be made, text }
    this.copied = null; // { id, at }
    this.toast = null;
    // Turns whose line is open (level 1): the steps and the numbers under it. A running turn's
    // line is open until the person opens or closes it (lineTouched); then their choice stays,
    // also after the turn ends. Open step groups (level 2), by "<turn>:<step>".
    this.lineOpen = new Set();
    this.lineTouched = new Set();
    this.groupOpen = new Set();
    // Level 3: each call's input and output, read from the transcript when its group opens
    // (calls.sh) and kept in memory only, at most CALLS_MAX, by "<file>#<call id>". Calls
    // whose output box is open, and boxes showing every line, by "<turn>:<step>:<call>".
    this.calls = new Map();
    this.callOpen = new Set();
    this.callAll = new Set();
    this.query = "";
    this.filtering = false;
    this.choosing = false;
    this.width = this.forcedWidth ?? 380;
    this.listH = 0;
    this.follow = true;
    this.seen = { turn: null, status: null };
    this.known = new Set();
    this.h = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.input = InputState.new({ placeholder: "Filter turns, or #12 to jump" });
    this.input.on("change", (_e, cx) => { this.setQuery(this.input.value(), cx); cx.notify(); });
    // The settings panel's name field: while it has the keyboard, keys type (this.naming).
    this.nameInput = InputState.new({ placeholder: DEFAULTS.youName, value: DEFAULTS.youName });
    this.naming = false;
    this.nameInput.on("focus", (_e, cx) => { this.naming = true; cx.notify(); });
    this.nameInput.on("blur", (_e, cx) => { this.endNaming(cx); });
    this.nameInput.on("submit", (_e, cx) => { this.endNaming(cx); this.h.focus(); });
    this.nameInput.on("change", (_e, cx) => {
      const v = nameValue(this.nameInput.value());
      if (v && v !== this.prefs.youName) this.changePrefs({ youName: v }, cx);
      cx.notify();
    });
    this.prefs = { ...DEFAULTS }; // settings.json, read below and watched
    this.prefsRaw = null; // the file's text as last read or written (null: no file)
    this.prefsError = null;
    this.settingsOpen = false;
    this.lastFocus = null;
    this.quoteKey = "q"; // settings.json quoteKey
    this.links = []; // compiled link rules (settings.js parseLinks)
    this.linksVer = 0;
    this.prefsNotes = []; // notes on quoteKey and link rules
    this.lastQuote = null; // the last quote press, for the debug report (never its text)
    this.remote = { key: null, repo: null, owner: null, why: "not looked up" }; // F3.3
    this.pinStore = parsePins(null).store; // pins.json, read below and watched
    this.pinRaw = null; // the file's text as last read or written
    this.pinsError = null;
    this.pinVer = 0;
    this.pinDirty = new Map(); // session key -> edit number, until a save holds that edit
    this.pinEdits = 0;
    this.pinDueAt = null; // when a changed reading place is saved
    this.pinUndo = []; // unpinned this pane's life, newest last
    this.pinVisit = null; // a pinned turn shown although the search or a setting hides it
    this.pinResume = null; // { key, part }: the "starts above" line a return put over a place
    this.pinAgain = null; // the turn a return just showed from its head, for a second press
    this.topKey = null; // the list item at the top of the pane
    this.bottomShown = true; // the list's last item is on screen
    // A turn or reply came in: "pending" until the next draw of the list says whether the end
    // is on screen (then false) or not (then true, the latest button's dot).
    this.unseen = false;
    this.keysOpen = false; // the ? sheet
    // o: the outline, one row per turn ("line" items). outlineBack is where the list was
    // when it opened, for Esc. Not saved across restarts.
    this.outline = false;
    this.outlineBack = null;
    this.rootH = 0;
    if (!this.terminal) { this.res = { kind: "none", tried: [] }; return; }
    this.commands(cx);
    this.loadPrefs(cx);
    this.readPins(cx);
    this.resolve(cx);
    // While the agent works, re-read every few seconds in case a folder event is missed.
    // While a session id has no transcript yet, look for it. Idle panes do nothing here.
    cx.timer.every(5000, (cx) => {
      if (this.status() === "working") { this.read(cx); cx.notify(); }
      if (this.res.kind === "pending" || this.res.pendingId) this.resolve(cx);
      // No folder watch for the settings (the folder could not be watched): read it here.
      if (this.prefsPoll) { this.readPrefs(cx); this.readPins(cx); }
    });
    // The sticky day: redraw once the top of the pane moved into another day.
    cx.timer.every(120, (cx) => {
      // The day pill goes DAY_PILL_MS after the last scroll.
      if (this.scrollSeenAt && Date.now() - this.scrollSeenAt >= DAY_PILL_MS) { this.scrollSeenAt = 0; this.stickyDue = true; }
      if (this.stickyDue) { this.stickyDue = false; cx.notify(); }
    });
    // The running turn's clock, once a second while one is shown.
    cx.timer.every(1000, (cx) => {
      this.watchRead(cx);
      this.poll(cx);
      this.flushCode(cx);
      if (this.pinDueAt != null && Date.now() >= this.pinDueAt) this.savePins(cx);
      if (this.liveShown && ["working", "blocked"].includes(this.status())) cx.notify();
      // Past midnight, Today becomes Yesterday in the day bands and the Pinned view's headers.
      const today = dayKey(Date.now());
      if (this.today !== today) { const was = this.today; this.today = today; if (was) cx.notify(); }
      if (this.debug) this.report();
    });
  }

  // props().debug (tests only): what the pane shows, as data, in shared("threads.debug")
  // under its terminal, so a check can read it with no screenshot.
  report() {
    const s = this.current();
    if (s?.loaded && !this.renders) this.measure(); // render() measures when it draws
    const rows = this.res.kind === "found" || s ? this.rows() : [];
    const snap = {
      pins: { list: this.pinnedAll().map((p) => ({ n: p.turn?.n ?? null, stored: p.pin.n, state: p.state, anchor: p.pin.anchor ?? null, text: p.pin.text })), top: this.topKey, view: this.view, pinnedPane: this.pinnedPane, rootH: Math.round(this.rootH), listH: Math.round(this.listH), visit: this.pinVisit, error: this.pinsError, undo: this.pinUndo.length },
      renders: this.renders ?? 0, me: this.myPane ?? null, props: Object.keys(props() ?? {}),
      outline: this.outlined(), outlineBack: this.outlineBack ? { sel: this.outlineBack.sel ?? null, top: this.outlineBack.top ?? null } : null,
      header: this.headerText(), state: this.agentStateNow()?.word ?? null, unseen: this.unseen, bottomShown: this.bottomShown, pill: this.pillShown(), follow: Boolean(this.follow), range: this.lastRange ?? null, keysOpen: this.keysOpen,
      res: { kind: this.res.kind, guess: Boolean(this.res.guess), ended: this.res.ended ?? null, endedAt: this.res.endedAt ?? null, choices: this.res.choices?.length ?? 0, pendingId: this.res.pendingId ?? null, via: this.res.via ?? null },
      banners: this.bannerTitles(),
      tried: (this.res.tried ?? []).map((x) => `${x.ok ? "ok" : "no"} ${x.what}: ${x.detail}`),
      sessions: this.sessions.map((x) => ({ id: x.id.slice(-4), turns: x.turns.length, loaded: Boolean(x.loaded), clearAt: x.clearAt, error: x.error ?? null })),
      rows: rows.map((r) => `${r.kind}${r.turn ? `#${r.turn.n}` : ""}${r.kind === "divider" ? `:${dividerLabel(r.s)}` : ""}`),
      live: this.liveShown ? this.liveState(theme()).label : null, status: this.status(),
      sel: this.sel, query: this.query, count: this.filterCount(),
      code: [...(this.codeInfo ?? new Map()).values()], choosing: this.choosing, width: Math.round(this.width),
      widthSource: this.forcedWidth ? "props.width (debug)" : this.measuredWidth ? "measured" : "default (not drawn yet)",
      measuredWidth: this.measuredWidth ?? null, timing: this.timing ?? null, zoom: this.zoom(),
      // Round 3: each open-card part's estimate, measured height and list slot.
      parts: this.partReport(),
      // v1 feedback: what each row and card part shows, as text.
      detail: rows.map((r) => this.rowDetail(r)).filter(Boolean),
      counts: this.sessions.length ? this.counts() : null,
      headerButtons: this.headerButtons().map((b) => `${b[0]}${b[6] ? `[${b[6]}]` : ""}${b[5] != null ? `(${b[5]})` : ""}${b[4] ? ":on" : ""}${b[7] ? ":dot" : ""}|${b[2]}`),
      headerLayout: this.headerLayout(), badgeTip: this.badgeTip(),
      settings: this.prefs, settingsError: this.prefsError, settingsOpen: this.settingsOpen, settingsFile: this.prefsRaw,
      settingsPath: tilde(this.prefsPath()), settingsPoll: Boolean(this.prefsPoll),
      footer: this.footerHints().map(([k, l]) => `${k} ${l}`),
      lastFocus: this.lastFocus, lastBarHit: this.lastBarHit ?? null, barGeom: this.barGeom(),
      toast: this.toast?.text ?? null,
      railCard: (() => { const k = this.railHover && this.railShown() ? this.railTicks().ticks.find((x) => x.key === this.railHover) : null; return k ? this.railCard(k) : null; })(),
      contrast: this.contrastList(),
      // Each theme's selected-turn fill and text-selection colour, for the highlight check.
      textSel: this.textSel ?? null, press: { moved: Math.round(this.pressMoved ?? 0), count: this.pressCount ?? 1 },
      selColors: themes().map((x) => ({ name: x.name, light: x.light, background: x.colors?.background, selected: x.colors?.selected, selection: x.colors?.selection })),
      // Round 2: the quote key, the last quote press (never its text), the link rules and
      // the repo they use.
      quoteKey: this.quoteKey, settingsNotes: this.prefsNotes, lastQuote: this.lastQuote,
      editorFocused: Boolean(this.editorFocused), panelFocused: this.panelFocused(), focusEvents: this.focusEvents ?? null,
      links: { count: this.linkCount ?? 0, valid: this.links.length, ver: this.linksVer, rules: this.links.map((r) => `${r.n} ${r.name}${r.repo ? " {repo}" : ""}`) },
      repo: { repo: this.remote.repo, why: this.remote.why },
      settingsLine: this.settingsLine(),
    };
    const text = JSON.stringify(snap);
    if (text === this.lastReport) return;
    this.lastReport = text;
    setShared("threads.debug", { ...(shared("threads.debug") ?? {}), [this.terminal]: snap });
  }

  // One row or card part as text for the debug report: "turn#3 p2/r3 h89 cmd:/review-pr",
  // "turn#5 agent:hc:t7 review", "you#3 YOU · COMMAND", "stats#3 … | cache read …".
  rowDetail(r) {
    const n = r.turn ? `#${r.turn.n}` : "";
    const who = r.turn?.agent ? ` agent:${r.turn.sender.kind}:${r.turn.sender.name ?? ""} lw${this.labelRoom(r.turn, rowTextWidth(this.width, true, this.prefs.textSize, this.chars()))}` : "";
    switch (r.kind) {
      case "turn": case "wrow": {
        const sh = r.shape;
        if (r.compact) return `pin${n} ${r.pinNo} p${sh.p} h${sh.height}${r.fresh ? " new" : ""}${r.running ? " live" : ""} | ${sh.prompt.join(" ⏎ ")} | ${sh.reply}`;
        const pl = sh.kinds ? sh.prompt.map((l, i) => (sh.kinds[i] === "c" ? l : `▎${l}`)) : sh.prompt;
        return `${r.kind}${n} p${sh.p}/r${sh.r}${sh.q ? ` q${sh.q}` : ""}${sh.kinds?.[0] === "qonly" ? " qonly" : ""} h${sh.height}${sh.cmd ? ` cmd:${sh.cmd.name}` : ""}${who} | ${this.metaText(r.turn, r.kind === "wrow")} | ${sh.chip ? `[${sh.chip.label}] ` : ""}${pl.join(" ⏎ ")} | ${sh.reply.join(" ⏎ ")}`;
      }
      case "wtop": return `wtop${n} tiles ${r.turn.images.length} h${this.height(r)}`;
      case "head": return `head${n}${who}`;
      case "ustrip": { const on = this.sel === `${r.si}:${r.turn.n}`; return `ustrip${n} ${on ? this.stripText(r.turn, true) : `${this.stripText(r.turn, false) || "(empty)"} hover:${this.stripText(r.turn, true)}`}`; }
      case "you": {
        const y = this.youMd(r);
        return `you${n} ${this.youLabel(r.turn)} ${y.hl ? "hl" : "md"} q${y.quotes} code${y.code} links${y.links}${y.more ? ` +${y.more}` : ""} h${this.height(r)}${y.hl ? "" : ` | ${y.md.replace(/\n/g, " ⏎ ").slice(0, 300)}`}`;
      }
      case "md": return `md${n} links ${r.links ?? 0}${this.mdBroken?.has(r.key) ? " plain" : ""} h${this.height(r)}${r.links ? ` | ${(r.md.match(/\]\(https?:[^)]+\)/g) ?? []).join(" ")}` : ""}`;
      case "rhead": return `rhead${n} ${this.lineText(r.turn, `${r.si}:${r.turn.n}`)}${this.captionParts(r.turn).map(([i, x]) => ` · ${i} ${x}`).join("")} h${this.height(r)}`;
      case "lhead": return `lhead${n} LATEST UPDATE · after ${plural(r.turn.followups, "background update")}`;
      case "latest": return `latest${n} ${r.md ? "all" : `box ${this.latestBox(r)}${this.latestCut(r) ? " +Show all" : ""}`} h${this.height(r)} | ${(r.md ?? r.text).slice(0, 300)}`;
      case "stats": return `stats${n} ${this.statTexts(r.turn).join(" · ")}${this.countsLine(r.turn) ? ` | ${this.countsLine(r.turn)}` : ""} h${this.height(r)}`;
      case "itext": return `itext${n} h${this.height(r)} | ${r.src.replace(/\n/g, " ⏎ ").slice(0, 120)}`;
      case "grp": {
        const g = this.groupInfo(r);
        return `grp${n} ${groupText(r.step.calls, r.step.count, r.now)}${g.current ? ` · ${g.current}` : ""}${g.failed ? ` · ${g.failed} failed [failed]` : g.known ? " [ok]" : ""}${this.groupOpen.has(`${r.si}:${r.turn.n}:${r.gi}`) ? " [open]" : ""}`;
      }
      case "call": {
        if (r.more) return `call${n} +${r.more}`;
        const c = this.callEntry(r.si, r.id);
        const time = callTime(c?.inTs, c?.outTs, c?.ms);
        return `call${n}${r.one ? " one" : ""} ${c?.input != null ? callText(r.name, c.input) : r.name}${time ? ` · ${time}` : ""}${c?.err ? " [failed]" : ""}${r.id ? (this.callOpen.has(`${r.si}:${r.turn.n}:${r.gi}:${r.ci}`) ? " [open]" : " [closed]") : ""}`;
      }
      case "cout": return `cout${n} ${r.st}${r.going ? " running" : ""} lines ${r.box.lines.length}/${r.box.total}${r.box.cut ? " +Show all" : r.all && r.box.total > OUT.SHOW ? " +Show less" : ""} h${this.height(r)}${r.box.lines.length ? ` | ${r.box.lines.slice(0, 3).join(" ⏎ ").slice(0, 160)}` : ""}`;
      case "wspin": return `wspin${n} Working…`;
      case "legend": return `legend${n} ${this.legendEntries(r.turn).map(([, x]) => x.split(":")[0]).join(" · ")} h${this.height(r)}`;
      case "seltext": return `seltext${n} lines ${r.lines} h${this.height(r)} editor:${this.selEditor?.st ? "yes" : "no"} border:${this.selecting ? "accent" : "border"} | ${this.selectHint()}`;
      case "copy": {
        const L = this.acts(r.turn);
        const on = this.sel === `${r.si}:${r.turn.n}`;
        const selOn = this.selecting === `${r.si}:${r.turn.n}`;
        const icons = ["copy", "quote", "select", "terminal"].filter((k) => L[k]).map((k) => (k === "select" && selOn ? "select(on)" : k)).join(" ");
        return `copy${n} ${on ? icons : `(empty) hover:${icons}`}`;
      }
      case "day": return `day ${r.name}${r.date ? ` ${r.date}` : ""} · ${plural(r.count, "turn")}`;
      case "line": {
        const pin = this.pinNumber(r.turn);
        return `line${n} ${r.running ? "now" : fmtTime(r.turn.ts)}${this.narrow() ? " (no time)" : ""}${pin != null ? ` pin${pin}` : this.isPinnedTurn(r.turn) ? " pin" : ""}${r.turn.agent ? ` agent:${r.turn.sender.kind}` : ""} h${this.height(r)} | ${r.text}`;
      }
      case "pday": return `pday ${r.name}${r.date ? ` · ${r.date}` : ""}`;
      case "hidden": return `unmatched ${r.n}`;
      default: return null;
    }
  }

  // For every theme: contrast of ansi5 and muted on the background, and which colour the
  // sender label uses there.
  contrastList() {
    if (this.contrastMemo) return this.contrastMemo;
    this.contrastMemo = themes().map((x) => {
      const c = x.colors ?? {};
      const label = labelColor(c.ansi5, c.foreground, c.background);
      const cmd = commandColor(c);
      const cmdSel = commandColor(c, true);
      const caps = cardLabelColor(c, c.raised);
      const band = bandFill(c);
      const bandWord = band === c.raised ? "raised" : band === c.selected ? "selected" : band;
      return `${x.name ?? x.id ?? "?"}: ansi5 ${contrast(c.ansi5, c.background)} muted ${contrast(c.muted, c.background)} label ${label === c.ansi5 ? "ansi5" : `mix ${contrast(label, c.background)}`} card label ${caps === c.muted ? "muted" : "foreground"} (${contrast(c.muted, c.raised)} on raised) cmd ${cmd === c.muted ? "muted" : "foreground"}/${cmdSel === c.muted ? "muted" : "foreground"} (${contrast(c.muted, c.background)}/${contrast(c.muted, c.selected)} on background/selected) day band ${bandWord} (${contrast(band, c.background)} on background; raised ${contrast(c.raised, c.background)}, selected ${contrast(over(c.selected, c.background), c.background)})`;
    });
    return this.contrastMemo;
  }

  close() {
    // The launcher and the gallery (overlays) return from init() before any of this exists.
    if (this.launcher || this.gal) return;
    this.watchGen = (this.watchGen ?? 0) + 1;
    this.lookGen = (this.lookGen ?? 0) + 1;
    this.prefsGen = (this.prefsGen ?? 0) + 1;
    this.dropCode();
    this.endSelect();
  }

  // ---- settings (settings.js: $HERDR_APP_HOME/data/agent-threads/settings.json) ----

  prefsPath() { return settingsPath(appHome()); }

  // Reads the file now, then on every change in its folder (an editor's atomic save
  // included). Herdr makes the folder for each mod; if it cannot be watched, the 5 s
  // timer reads the file instead.
  loadPrefs(cx) {
    this.readPrefs(cx);
    const dir = settingsDir(appHome());
    const gen = (this.prefsGen = (this.prefsGen ?? 0) + 1);
    cx.spawn(async (cx) => {
      while (this.prefsGen === gen) {
        try { await watchFolder(dir); } catch { this.prefsPoll = true; return; }
        if (this.prefsGen !== gen) return;
        this.readPrefs(cx);
        this.readPins(cx);
      }
    });
  }

  readPrefs(cx) {
    cx.spawn(async (cx) => {
      let text = await readTextFile(this.prefsPath()).catch(() => null);
      // No file under this name: adopt one saved under an earlier name, once.
      if (text == null && !this.adoptTried) { this.adoptTried = true; text = await adoptPrevious(appHome(), readTextFile).catch(() => null); }
      // A save of ours in flight: its own change event would show the older text.
      if (this.prefsSaving) return;
      if (text === this.prefsRaw && this.prefsLoaded) return;
      this.prefsLoaded = true;
      this.applyPrefs(text);
      cx.notify();
    });
  }

  applyPrefs(text) {
    const { values, error } = parseSettings(text);
    this.prefsRaw = text;
    this.prefsError = error;
    this.setPrefs(values);
    this.applyExtras(text);
  }

  // quoteKey and the link rules, compiled once here (never while drawing). A file that does
  // not parse keeps the ones last read.
  applyExtras(text) {
    if (text != null && String(text).trim() !== "" && parseSettings(text).error) return;
    const x = parseExtras(text);
    this.quoteKey = x.quoteKey;
    this.prefsNotes = x.notes;
    this.linkCount = x.linkCount;
    const sig = JSON.stringify(x.links.map((r) => [r.re.source, r.url]));
    if (sig !== this.linksSig) { this.linksSig = sig; this.links = x.links; this.linksVer++; }
  }

  setPrefs(values) {
    const was = this.prefs;
    this.prefs = values;
    // The name field shows the name in use, except while the person is typing in it.
    if (!this.naming && this.nameInput && this.nameInput.value() !== values.youName) this.nameInput.set_value(values.youName);
    // Hiding agent turns: a hidden selected turn hands the selection to the turn before it.
    if (was.agentTurns && !values.agentTurns) this.reselect = true;
  }

  // The name field gives the keyboard back and shows the name in use, trimmed. A cleared
  // field changed nothing, so it shows the name it had.
  endNaming(cx) {
    this.naming = false;
    if (this.nameInput.value() !== this.prefs.youName) this.nameInput.set_value(this.prefs.youName);
    cx?.notify();
  }

  // Changes settings from the panel, keys or commands: applied now, then written. A save
  // that finds the file changed meanwhile reads it again and applies the change on top.
  changePrefs(patch, cx) {
    // The current mark, so a slate chosen here is kept (settings.js LOOK).
    const next = parseSettings(JSON.stringify({ ...this.prefs, ...patch, look: LOOK })).values;
    this.setPrefs(next);
    this.prefsSaving = (this.prefsSaving ?? 0) + 1;
    const chain = (this.prefsChain ?? Promise.resolve()).then(async () => {
      try {
        await saveSettings(appHome(), next, this.prefsRaw);
        this.prefsRaw = settingsText(next, this.prefsRaw);
        this.prefsError = null;
      } catch {
        const text = await readTextFile(this.prefsPath()).catch(() => null);
        // The file holds a hand edit that does not parse: leave it, keep the change in the
        // pane only, and say so.
        if (!writable(text)) { this.prefsRaw = text; this.prefsError = NOT_SAVED; return; }
        const merged = { ...parseSettings(text).values, ...patch };
        try {
          await saveSettings(appHome(), merged, text);
          this.prefsRaw = settingsText(merged, text);
          this.prefsError = null;
          this.setPrefs(parseSettings(this.prefsRaw).values);
        } catch (e) {
          this.prefsRaw = text;
          this.prefsError = `Could not save settings.json: ${clean(String(e?.message ?? e))}`;
        }
      }
    });
    this.prefsChain = chain;
    cx.spawn(async (cx) => {
      await chain;
      this.prefsSaving--;
      // An edit made in an editor while the save ran.
      if (!this.prefsSaving) this.readPrefs(cx);
      cx.notify();
    });
  }

  // Shows or hides agent turns, with a toast that says which.
  setAgents(on, cx) {
    if (Boolean(this.prefs.agentTurns) === on) return;
    this.changePrefs({ agentTurns: on }, cx);
    this.say(on ? "Agent messages shown" : "Agent messages hidden", "bot", cx);
  }

  // ---- pins (pins.js has the file's format) ----

  readPins(cx) {
    cx.spawn(async (cx) => {
      const text = await readTextFile(pinsPath(appHome())).catch(() => null);
      this.pinsRead = true;
      if (this.pinSaving || text === this.pinRaw) return;
      this.pinRaw = text;
      const { store, error } = parsePins(text);
      this.pinsError = error;
      // A file that does not parse (a hand edit in progress): keep the pins already here.
      if (!error) { this.pinStore = mergeDirty(store, this.pinStore, this.pinDirty.keys()); this.pinVer++; }
      cx.notify();
    });
  }

  // Saves the sessions this pane changed over what the file holds now, so two panes keep
  // each other's pins. A rejected write means another pane just wrote: read and try again.
  savePins(cx) {
    this.pinDueAt = null;
    const edits = new Map(this.pinDirty);
    if (!edits.size) return;
    const chain = (this.pinChain ?? Promise.resolve()).then(async () => {
      for (let tries = 0; tries < 3; tries++) {
        const before = await readTextFile(pinsPath(appHome())).catch(() => null);
        const { store, error } = parsePins(before);
        if (error) { this.pinsError = error; this.pinRaw = before; return; }
        const merged = mergeDirty(store, this.pinStore, edits.keys());
        const text = pinsText(merged);
        try {
          await savePinsText(appHome(), text, before);
          this.pinRaw = text;
          this.pinsError = null;
          this.pinStore = mergeDirty(merged, this.pinStore, this.pinDirty.keys());
          for (const [k, n] of edits) if (this.pinDirty.get(k) === n) this.pinDirty.delete(k);
          this.pinVer++;
          return;
        } catch (e) { this.pinsError = `Could not save pins.json: ${clean(String(e?.message ?? e))}`; }
      }
    });
    this.pinChain = chain;
    this.pinSaving = (this.pinSaving ?? 0) + 1;
    cx.spawn(async (cx) => {
      await chain;
      this.pinSaving--;
      if (this.pinsError) this.say(`${this.pinsError}, so pins last until this pane closes`, "circle-x", cx, 5000);
      if (!this.pinSaving) this.readPins(cx);
      cx.notify();
    });
  }

  pinChanged(k, cx) {
    this.pinDirty.set(k, ++this.pinEdits);
    this.pinVer++;
    this.savePins(cx);
  }

  // A smaller change, saved on the next tick after a pause.
  pinChangedLater(k) {
    this.pinDirty.set(k, ++this.pinEdits);
    this.pinDueAt ??= Date.now() + 1500;
  }

  sessionKey(s) { return `${harnessOfFile(s.file)}:${s.id}`; }

  // The pins of every session in the pane, oldest turn first: { pin, s, si, turn, key, state }.
  // Their place in this order is their number (1 to 5) and digit key.
  pinnedAll() {
    const memoKey = `${this.pinVer}|${this.sessions.map((s) => `${s.version}.${s.turns.length}.${s.loaded ? 1 : 0}`).join(",")}|${this.status()}|${this.sel}|${this.sel && this.open.has(this.sel) ? 1 : 0}`;
    if (this.pinMemoKey === memoKey) return this.pinMemo;
    const out = [];
    this.sessions.forEach((s, si) => {
      const pins = this.pinStore.sessions[this.sessionKey(s)]?.pins ?? [];
      if (!pins.length) return;
      const ids = turnIds(s.turns);
      for (const pin of pins) {
        const turn = ids.get(pin.id) ?? null;
        const key = turn ? `${si}:${turn.n}` : null;
        if (turn) pin.n = turn.n;
        const live = turn ? this.isLive(s, si, turn.n - 1, this.status()) : false;
        // An open, selected turn is being read, so nothing in it is new.
        if (turn && !live && key === this.sel && this.open.has(key)) {
          const seen = seenOf(turn);
          if (seen.len !== pin.seen?.len || seen.fu !== pin.seen?.fu) { pin.seen = seen; this.pinChangedLater(this.sessionKey(s)); }
        }
        out.push({ pin, s, si, turn, key, state: pinState({ turn, loaded: s.loaded, live, seen: pin.seen }) });
      }
    });
    out.sort(byTime);
    this.pinMemoKey = memoKey;
    this.pinMemo = out;
    this.pinKeys = new Set(out.map((p) => p.key).filter(Boolean));
    this.pinTurns = new Set(out.map((p) => p.turn).filter(Boolean));
    return out;
  }
  // What the Pinned view and the digits show: a pane with two sessions can hold more than the limit.
  pinnedList() { return this.pinnedAll().slice(0, PIN_LIMIT); }
  isPinned(key) { this.pinnedAll(); return this.pinKeys.has(key); }
  isPinnedTurn(turn) { this.pinnedAll(); return this.pinTurns.has(turn); }
  // A pinned turn's number (1 to 5, its place in the Pinned view and its digit key), or null.
  pinNumber(turn) { const i = this.pinnedList().findIndex((p) => p.turn === turn); return i < 0 ? null : i + 1; }

  togglePin(key, cx) {
    const turn = key && this.findTurn(key);
    if (!turn) return false;
    const s = this.sessions[Number(key.split(":")[0])];
    const found = this.pinnedAll().find((p) => p.key === key);
    if (found) return this.unpin(found, cx);
    if (this.pinnedAll().length >= PIN_LIMIT) { this.say(`Pins are full (${PIN_LIMIT}). Unpin one first.`, "circle-x", cx, 4000); return true; }
    const k = this.sessionKey(s);
    const rec = (this.pinStore.sessions[k] ??= { at: 0, pins: [] });
    rec.at = Date.now();
    const pin = newPin(s.turns, turn);
    this.notePlace(pin, key);
    rec.pins.push(pin);
    this.pinChanged(k, cx);
    const i = this.pinnedList().findIndex((p) => p.pin === pin);
    // A pin opens the Pinned column when there is room and it was not closed this pane's life.
    const col = !this.pinnedPane && !this.pinnedPaneOpen() && !this.pinColClosed && this.view === "all" && this.openPinned(cx, true);
    this.say(`Pinned #${turn.n} · ${col ? "in the Pinned column · " : ""}press ${i + 1} to come back`, "pin", cx, 3000);
    return true;
  }

  unpin(p, cx) {
    const k = this.sessionKey(p.s);
    const rec = this.pinStore.sessions[k];
    // By id: a save or another pane's change can have replaced the object since the Pinned view drew.
    const at = rec?.pins.findIndex((x) => x.id === p.pin.id) ?? -1;
    if (at < 0) return false;
    const [pin] = rec.pins.splice(at, 1);
    rec.at = Date.now();
    this.pinUndo.push({ k, at, pin });
    this.pinChanged(k, cx);
    this.say(`Unpinned #${p.pin.n} · u to undo`, "pin", cx, 5000);
    return true;
  }

  undoUnpin(cx) {
    const u = this.pinUndo[this.pinUndo.length - 1];
    if (!u) return false;
    if (this.pinnedAll().length >= PIN_LIMIT) { this.say(`Pins are full (${PIN_LIMIT}). Unpin one first.`, "circle-x", cx, 4000); return true; }
    this.pinUndo.pop();
    const rec = (this.pinStore.sessions[u.k] ??= { at: 0, pins: [] });
    rec.pins.splice(Math.min(u.at, rec.pins.length), 0, u.pin);
    rec.at = Date.now();
    this.pinChanged(u.k, cx);
    this.say(`Pinned #${u.pin.n} again`, "pin", cx, 2000);
    return true;
  }

  // Keeps the pin's reading place when the top of the pane is in its turn.
  notePlace(pin, key) {
    const a = this.topKey && partOf(this.topKey, key);
    if (!a || NOT_A_PLACE.has(a[0])) return false;
    if (pin.anchor?.[0] === a[0] && pin.anchor?.[1] === a[1]) return false;
    pin.anchor = a;
    delete pin.whole; // a build before this one remembered whether the reply was cut
    return true;
  }

  // While the selected pinned turn stays open, its place follows the reading. A landing does
  // not count: near the end of the list the list cannot scroll far enough, and the item left
  // at the top would move the place up on every return. So the place holds until the top of
  // the pane moves after the landing.
  trackPlace() {
    if (!this.sel || !this.open.has(this.sel) || this.outlined()) return;
    if (this.placeHold != null) {
      if (Date.now() < this.placeHold) return;
      this.placeHold = null;
      this.placeBase = this.topKey;
    }
    if (this.placeBase != null) {
      if (this.topKey === this.placeBase) return;
      this.placeBase = null;
    }
    const p = this.pinnedAll().find((x) => x.key === this.sel);
    if (p && this.notePlace(p.pin, p.key)) this.pinChangedLater(this.sessionKey(p.s));
  }

  // Returns to pin i: the turn opens at the place the person stopped. The search stays; a
  // turn it hides shows on its own, for as long as it stays selected.
  goPin(i, cx) {
    const p = this.pinnedList()[i];
    if (!p) return false;
    if (!p.turn) {
      this.say(p.state === "gone" ? `#${p.pin.n} is no longer in this session. Unpin to clear it.` : "Still reading this session", "pin", cx, 4000);
      return true;
    }
    const { key, turn, pin, s } = p;
    const wasSel = this.sel;
    if (!this.open.has(key)) { this.open.add(key); this.makeCode(key); }
    this.sel = key;
    this.follow = false;
    this.toBottom = false; // a jump to the newest turn still waiting would take this frame
    const q = this.filterText();
    const hidden = (q && !threadMatches(s.turns, turn, q)) || !isShown(turn, { agentTurns: this.prefs.agentTurns, live: p.state === "live" });
    this.pinVisit = hidden ? key : null;
    // The note above the turn can be out of view when the place is further down.
    if (hidden) this.say(visitNote(Boolean(q && !threadMatches(s.turns, turn, q))), "pin", cx, 3000);
    // A return puts the turn's head at the top of the pane, so the message under it matches
    // the pin's line. A second press of the same number, before the view moves, goes on to
    // the place the person left, under a line that says the turn starts above.
    const [first, ...rest] = placeAtTop(pin.anchor) ? [] : partKeys(placeItem(pin.anchor), key);
    const again = first && this.pinAgain === key && wasSel === key && (this.placeHold != null || this.placeBase != null);
    const until = Date.now() + 400;
    this.pinResume = null;
    this.pinAgain = first && !again ? key : null;
    this.scrollTo = again ? { key: first, how: "land", or: rest, head: key, until, resume: true } : { key, how: "head", until };
    if (first && !again && !hidden) this.say(`Press ${i + 1} again for where you left off`, "pin", cx, 3000);
    this.placeHold = until + 300;
    this.placeBase = null;
    pin.seen = seenOf(turn);
    this.pinChanged(this.sessionKey(s), cx);
    return true;
  }

  // The keyboard back to the list, with any search kept.
  toList() {
    this.filtering = false;
    this.h.focus();
    this.editorFocused = false;
  }

  // ---- data ----

  current() { return this.sessions[this.sessions.length - 1] ?? null; }
  term() { return terminals().find((t) => t.address === this.terminal); }
  pane() { return panes().find((p) => p.terminal === this.terminal); }
  me() {
    const own = props()?.pane ?? this.myPane;
    if (own) return panes().find((p) => p.pane === own) ?? null;
    if (this.pinnedPane) return this.pinnedSelf();
    const known = shared(MAP_KEY)?.[this.terminal];
    const mine = known ? panes().find((p) => p.pane === known.pane) : null;
    if (mine) return mine;
    // Opened some other way (props() carries no pane id): the only Threads pane in the
    // terminal's tab that no other terminal has claimed is this one.
    const tab = this.pane()?.tab;
    const claimed = new Set([...Object.entries(shared(MAP_KEY) ?? {}).filter(([t]) => t !== this.terminal).map(([, v]) => v.pane),
      ...Object.values(shared(PIN_MAP_KEY) ?? {}).map((v) => v.pane)]);
    const here = panes().filter((p) => p.mod === MOD && p.tab === tab && !claimed.has(p.pane));
    if (here.length === 1) return here[0];
    const anywhere = panes().filter((p) => p.mod === MOD && !claimed.has(p.pane));
    return anywhere.length === 1 ? anywhere[0] : null;
  }
  // The Pinned pane's own pane: the one in its map, or else the only Threads pane in the
  // main pane's tab that no map claims (it was split from there, and props carry no id).
  pinnedSelf() {
    const known = shared(PIN_MAP_KEY)?.[this.terminal];
    const mine = known ? panes().find((p) => p.pane === known.pane) : null;
    if (mine) return mine;
    const main = shared(MAP_KEY)?.[this.terminal]?.pane;
    const claimed = new Set([...Object.values(shared(MAP_KEY) ?? {}), ...Object.values(shared(PIN_MAP_KEY) ?? {})].map((v) => v.pane));
    const tab = panes().find((p) => p.pane === main)?.tab;
    const here = panes().filter((p) => p.mod === MOD && !claimed.has(p.pane) && (!tab || p.tab === tab));
    return here.length === 1 ? here[0] : null;
  }
  // The main Threads pane of this terminal, and its Pinned pane, when open.
  mainPane() { const id = shared(MAP_KEY)?.[this.terminal]?.pane; return id ? panes().find((p) => p.pane === id) ?? null : null; }
  pinnedPaneOpen() { const id = shared(PIN_MAP_KEY)?.[this.terminal]?.pane; return id ? panes().find((p) => p.pane === id) ?? null : null; }
  status() { return this.pane()?.status ?? this.term()?.status ?? null; }

  resolve(cx) {
    if (this.resolving) { this.resolveAgain = true; return; }
    this.resolving = true;
    cx.spawn(async (cx) => {
      try {
        do {
          this.resolveAgain = false;
          // pick() bumps the generation: a lookup that started before it is dropped and
          // the loop runs again for the picked file.
          const gen = this.resolveGen ?? 0;
          const r = this.pinned ? this.pinnedResult() : await resolve(this.terminal, this.claudeHome, this.current()?.id ?? null);
          if (gen !== (this.resolveGen ?? 0)) { this.resolveAgain = true; continue; }
          this.adopt(r, cx);
        } while (this.resolveAgain);
      } catch (e) {
        this.res = { kind: "error", error: String(e?.message ?? e) };
      } finally {
        this.resolving = false;
        cx.notify();
      }
    });
  }

  pinnedResult() {
    if (!this.term()) return { kind: "gone" };
    const harness = harnessOfFile(this.pinned);
    return { kind: "found", id: idOf(this.pinned), file: this.pinned, via: this.pinnedVia, harness, claude: harness === "claude", live: true, pid: null, guess: false, tried: [] };
  }

  // Keeps the time a session ended while it stays ended.
  endState(ended) {
    if (!ended) return { ended: null, endedAt: null };
    return { ended, endedAt: this.res.ended === ended && this.res.endedAt ? this.res.endedAt : Date.now() };
  }

  adopt(r, cx) {
    const cur = this.current();
    if (r.kind === "pending") {
      // The record names a session whose transcript is not written yet: keep what is shown
      // and watch for that file.
      this.watchFor = r.id;
      // A Codex, OpenCode, Pi, Cursor or Antigravity process that has written nothing yet says so only by not having
      // a session: the 1 s timer looks again (poll).
      if (!cur) {
        this.res = r;
        this.watch(r.watch, cx);
      } else {
        this.res = { ...this.res, ...this.endState(null), pendingId: r.id };
      }
      return;
    }
    this.watchFor = null;
    if (r.kind !== "found") {
      // Keep what was read when the agent exits or the terminal goes.
      if (cur && (r.kind === "gone" || r.kind === "none")) this.res = { ...this.res, kind: "found", pendingId: null, ...this.endState(r.kind === "gone" ? "closed" : "exited") };
      else this.res = r;
      return;
    }
    const ended = r.live ? null : "exited";
    switch (decide(r, cur && { id: cur.id, file: cur.file, guess: Boolean(this.res.guess) })) {
      case "same":
        this.res = { ...r, ...this.endState(ended) };
        this.watch(dirname(r.file), cx); // re-arms the watch if it stopped
        this.read(cx);
        return;
      case "keep":
        // A guess never replaces a session we were told about.
        this.res = { ...this.res, pendingId: null, ...this.endState("exited") };
        return;
    }
    const s = newSession(r.id, r.file);
    if (cur) s.reason = "new";
    // Cursor records no turn times: the pane keeps the ones it watches (turns.js, clockStart).
    if (harnessOfFile(r.file) === "cursor") s.clock = {};
    this.sessions.push(s);
    this.res = { ...r, ...this.endState(ended) };
    this.follow = true;
    this.known.add(r.file);
    this.watch(dirname(r.file), cx);
    this.read(cx);
  }

  // Reads the transcript from s.offset in chunks. Herdr's interpreter interrupts a script
  // that runs too long, and an interrupt cannot be caught: it skips catch and finally. So
  // every step is short (a chunk's parse and apply run in slices of SLICE_MS, yielding with
  // cx.sleep(0)), every step leaves a heartbeat (readBeat), and watchRead() restarts a read
  // that stopped. readGen names the read in flight: an older one that wakes up quits.
  read(cx) {
    if (this.reading) { this.readAgain = true; return; }
    const s = this.current();
    if (!s) return;
    // A chunk applied only in part (an interrupt, a read superseded mid-apply, a throw):
    // its offset was never advanced, so reading on would apply its events twice. Start over.
    if (s.partial) this.restart(s, true);
    this.reading = true;
    this.readWaiting = false;
    this.readBeat = Date.now();
    const gen = (this.readGen = (this.readGen ?? 0) + 1);
    const live = () => this.readGen === gen && this.current() === s;
    const beat = () => { this.readBeat = Date.now(); };
    // Runs fn over items, yielding after each SLICE_MS of work. False when superseded.
    const sliced = async (items, fn, cx) => {
      let t0 = now();
      for (let i = 0; i < items.length; i++) {
        fn(items[i]);
        if ((i & 15) === 15 && now() - t0 > SLICE_MS) {
          beat();
          await cx.sleep(0);
          if (!live()) return false;
          beat();
          t0 = now();
        }
      }
      return true;
    };
    cx.spawn(async (cx) => {
      try {
        do {
          this.readAgain = false;
          let chunk = CHUNK;
          let retried = false;
          const count = s.turns.length;
          const wasLoaded = s.loaded;
          const before = this.newestSig();
          let grew = false;
          while (chunk && live()) {
            let c;
            try {
              this.readWaiting = true;
              const r = await exec("sh", readArgs(s.file, s.offset, chunk));
              if (!live()) return;
              this.readWaiting = false;
              beat();
              if (r.code !== 0) throw new Error(`The extractor stopped (exit ${r.code}): ${clean(r.stderr) || "no message"}`);
              c = newChunk();
              if (!(await sliced(r.stdout.split("\n"), (line) => parseLine(c, line), cx))) return;
            } catch (e) {
              // One more try with a quarter of the bytes before the error banner.
              if (retried) throw e;
              retried = true;
              chunk = Math.max(1 << 20, Math.floor(chunk / 4));
              continue;
            }
            retried = false;
            if (c.missing) { s.missing = true; break; }
            s.missing = false;
            if (replaced(s, c)) {
              // Transcripts only grow. A shorter file, or one that starts differently, was
              // replaced: read it again from the top.
              this.restart(s);
              chunk = CHUNK;
              continue;
            }
            if (c.head && !s.head) s.head = c.head;
            s.size = c.size;
            // From here until the offset moves, s holds part of this chunk.
            s.partial = true;
            if (c.rewind) rewindTail(s);
            // Once read in full, a prompt or end of turn that turns up was seen as it happened.
            if (s.clock && s.loaded) {
              const at = Date.now();
              for (const e of c.events) if (e.k === "p" || e.k === "d" || e.k === "i") e.at = at;
            }
            if (!(await sliced(c.events, (e) => apply(s, e), cx))) return;
            if (c.events.length) grew = true;
            s.offset += c.used;
            s.partial = false;
            chunk = nextChunk(s, c.used, chunk, CHUNK);
            if (!s.loaded) cx.notify();
            // Let the panel draw the new percentage before the next chunk.
            beat();
            await cx.sleep(0);
            if (!live()) return;
            beat();
          }
          if (!live()) return;
          s.loaded = true;
          s.error = null;
          this.readStalls = 0;
          // Following the newest turn (nothing moved the selection away): keep it on the newest.
          // Following, a read that grew the running reply keeps the view at the bottom too
          // (newestSig does not change while a reply grows; see stickCheck).
          if ((s.turns.length !== count || !this.sel) && this.follow) this.jumpLatest(true);
          else if (this.follow && wasLoaded && grew && this.view !== "pinned" && !this.outlined()) this.toBottom = true;
          else if (wasLoaded) this.noteNew(before);
        } while (this.readAgain && live());
      } catch (e) {
        if (this.readGen === gen) {
          // A throw mid-apply: drop the half-applied chunk so no later read repeats it.
          if (s.partial) this.restart(s, true);
          s.error = String(e?.message ?? e);
        }
      } finally {
        // A read that was superseded (watchRead, a retry) leaves the flags to the newer one.
        if (this.readGen === gen) {
          this.reading = false;
          this.readWaiting = false;
          this.readBeat = null;
          // The pane moved to another session while this one was read (/clear, a pick):
          // the read asked for meanwhile is for that session, so start it now.
          if (this.readAgain && this.current() && this.current() !== s) this.read(cx);
        }
        cx.notify();
      }
    });
  }

  // Starts a session over from the top (a replaced file, an interrupted read, Retry).
  // fresh (an interrupted read, Retry): also shown as not loaded, with no error, so the
  // progress shows again.
  restart(s, fresh = false) {
    Object.assign(s, newSession(s.id, s.file), { reason: s.reason, version: s.version + 1, partial: false, clock: s.clock });
    if (fresh) { s.loaded = false; s.error = null; s.missing = false; }
  }

  // On the 1 s timer: a read with no heartbeat for READ_STALL (EXEC_STALL while it awaits
  // the extractor) was interrupted mid-step (the interpreter's deadline), so its flags never
  // cleared and every later read() would only set readAgain. The read is dropped and started
  // again: from the top when a chunk was half applied (s.partial), else from its offset, so
  // a loaded session keeps its turns. A second stall in a row is shown as an error with
  // Retry, the session left whole (no half-applied chunk stays in it).
  watchRead(cx) {
    const at = Date.now();
    const gap = this.lastTick != null ? at - this.lastTick : 0;
    this.lastTick = at;
    if (!this.reading || this.readBeat == null) return;
    // The timer itself did not run (sleep, a suspended app): nothing was judged meanwhile.
    if (gap > TICK_GAP) { this.readBeat = at; return; }
    if (at - this.readBeat < (this.readWaiting ? EXEC_STALL : READ_STALL)) return;
    const s = this.current();
    this.readGen = (this.readGen ?? 0) + 1;
    this.reading = false;
    this.readAgain = false;
    this.readWaiting = false;
    this.readBeat = null;
    if (!s) return;
    if (s.partial) this.restart(s, true);
    this.readStalls = (this.readStalls ?? 0) + 1;
    if (this.readStalls > 1) {
      s.error = "The read stopped before it finished.";
      cx.notify();
      return;
    }
    this.read(cx);
    cx.notify();
  }

  // Retry (the failure state and the error banner): read the session again from the top.
  retryRead(cx) {
    const s = this.current();
    if (!s) return;
    this.readGen = (this.readGen ?? 0) + 1;
    this.reading = false;
    this.readAgain = false;
    this.readWaiting = false;
    this.readStalls = 0;
    this.restart(s, true);
    this.read(cx);
    cx.notify();
  }

  watch(dir, cx) {
    if (!dir || this.watched === dir) return;
    this.watched = dir;
    const gen = (this.watchGen = (this.watchGen ?? 0) + 1);
    cx.spawn(async (cx) => {
      // Transcripts already in the folder are other sessions, not a new one of ours.
      if (!this.watchFor) for (const p of ((await locate("names", dir)) ?? "").split("\n")) if (p) this.known.add(p);
      while (this.watchGen === gen) {
        let changed;
        try { changed = await watchFolder(dir); } catch { if (this.watched === dir) this.watched = null; return; }
        if (this.watchGen !== gen) return;
        const file = this.current()?.file;
        if (fileChanged(file, changed)) this.read(cx);
        // A transcript appearing here may be ours after /clear, or the one a fresh claude
        // just started writing.
        const want = this.watchFor ? `/${this.watchFor}.jsonl` : null;
        const fresh = changed.filter((p) => p.endsWith(".jsonl") && !this.known.has(p) && (want ? p.endsWith(want) : dirname(p) === dir));
        for (const p of fresh) this.known.add(p);
        if (fresh.length) this.lookSoon(cx);
      }
    });
  }

  // A new transcript appeared. The session record may name it a moment later, so look
  // now and again after 1, 3 and 8 s.
  lookSoon(cx) {
    this.resolve(cx);
    const gen = (this.lookGen = (this.lookGen ?? 0) + 1);
    for (const ms of [1000, 3000, 8000]) cx.timer.after(ms, (cx) => { if (this.lookGen === gen) this.resolve(cx); });
  }

  // Remembers which pane is this one while the terminal still exists to find it by (see
  // me(): a pane the launcher did not open is found only when no other Threads pane could
  // be it, because a mod pane's props do not carry its own id).
  findSelf(cx) {
    if (this.myPane) return;
    const mine = this.me()?.pane ?? null;
    if (!mine) return;
    this.myPane = mine;
    const key = this.pinnedPane ? PIN_MAP_KEY : MAP_KEY;
    if (shared(key)?.[this.terminal]?.pane !== mine) cx.timer.after(0, () => remember(this.terminal, mine, key));
  }

  // Live data changed: a new turn or status in the terminal means look again.
  react(cx) {
    // When Herdr focuses this pane (a click, pane.focus, the launcher), take the keyboard.
    const mine = Boolean(this.me()?.focused);
    if (mine && !this.wasMine && !this.filtering) cx.timer.after(0, () => { if (!this.editorFocused) this.h.focus(); });
    this.wasMine = mine;
    this.poll(cx);
  }

  // A new turn, status or program in the terminal means look again. Runs on render and on
  // the 1 s timer, so it also notices while the window is not drawing.
  poll(cx) {
    if (!this.terminal || this.launcher) return;
    this.findSelf(cx);
    this.fitOnOpen();
    this.keepWidth();
    this.settleSplit();
    this.autoPinned(cx);
    this.lookRepo(cx);
    const t = this.term();
    const now = { turn: t?.turn ?? null, status: t?.status ?? null, there: Boolean(t), fg: this.pane()?.program?.key ?? null };
    const was = this.seen;
    this.seen = now;
    if (was.turn === null && was.status === null && was.there === undefined) return;
    // A program change (claude exited, or started again: a resume) is looked at again after
    // 1, 3 and 8 s too: a fresh claude writes its session record a moment after it starts,
    // and a decoy or an idle claude reports no turn or status change that would look again.
    if (now.fg !== was.fg || now.there !== was.there) this.lookSoon(cx);
    else if (now.turn !== was.turn || now.status !== was.status) this.resolve(cx);
    else if (this.lookPolled()) this.resolve(cx);
  }

  // Codex, OpenCode, Pi, Cursor and Antigravity report no status here and name a new session
  // (/new) nowhere the pane is told about, so a pane on one of them looks again every few seconds
  // while it runs.
  lookPolled() {
    if (this.pinned || !this.res?.live || !["codex", "opencode", "pi", "cursor", "antigravity"].includes(this.res.harness)) return false;
    const at = Date.now();
    if (at - (this.lastPoll ?? 0) < POLL_MS) return false;
    this.lastPoll = at;
    return true;
  }

  // The agent this pane is on: its session's, else what the lookup found.
  agent() {
    const s = this.current();
    return HARNESS[s ? harnessOfFile(s.file) : this.res?.harness] ?? HARNESS.claude;
  }

  // ---- what is shown ----

  // List items and their heights, rebuilt only when something they show changed.
  rows() {
    const status = this.status();
    const P = this.prefs;
    const key = [
      this.sessions.map((s) => `${s.version}.${s.turns.length}.${s.loaded ? 1 : 0}`).join(","),
      [...this.open].join(","), [...this.full].join(","), [...this.lineOpen].join(","), [...this.lineTouched].join(","), [...this.groupOpen].join(","), this.filterText(), status,
      [...this.callOpen].join(","), [...this.callAll].join(","), this.callVer ?? 0,
      Math.round(this.width), Math.round(this.listH), Boolean(this.res.ended),
      `${P.textSize}.${P.width}.${P.promptLines}.${P.replyLines}.${P.agentTurns ? 1 : 0}`, this.selecting ?? "",
      this.linksVer, this.remote.repo ?? "", this.legendOn ? 1 : 0, this.imgVer ?? 0, this.pinVisit ?? "", Math.round(this.rootH), this.resumeAt() ?? "",
      this.view, this.view === "pinned" ? this.pinVer : "", dayKey(Date.now()), this.outlined() ? "outline" : "",
    ].join("|");
    if (this.rowsKey !== key || !this.baseRows) {
      this.shapeSpent = 0;
      this.shapeLeft = 0;
      this.shapeInView(status);
      this.baseRows = this.buildRows(status);
      this.baseSizes = this.baseRows.map((r) => this.height(r));
      this.baseIndex = new Map(this.baseRows.map((r, i) => [r.key, i]));
      this.probeRows = this.baseRows.filter((r) => PROBED.has(r.kind));
      for (const r of this.baseRows) if (r.kind === "turn" && r.shape?.md != null) this.probeRows.push(this.cmdRow(r));
      this.rowsKey = key;
      this.fitKey = null;
      // The selection is on a turn the list no longer shows: agent turns were hidden, or a
      // hidden agent turn that showed while it was live has finished.
      if (this.reselect || this.selHidden()) this.reselectVisible();
    }
    // Only the running turn depends on the selection (one-line row, or the card when
    // selected), and it is always the last item, so moving the selection rebuilds nothing.
    // The running turn's own row: last, or followed by its open steps.
    let li = this.baseRows.length - 1;
    while (li > 0 && !this.baseRows[li].live && ["itext", "grp", "call", "cout", "wspin"].includes(this.baseRows[li].kind)) li--;
    const lr = this.baseRows[li];
    if (lr?.live && lr.kind !== "line") {
      const kind = this.sel === lr.key ? "working" : "wrow";
      if (lr.kind !== kind) { lr.kind = kind; this.baseSizes[li] = this.height(lr); this.fitKey = null; }
    }
    const z = this.zoom();
    const gap = this.floating() ? TOP_BAND : 0;
    const fit = `${key}|${lr?.kind}|${z}|${this.sizesVer ?? 0}|${gap}`;
    if (this.fitKey !== fit) {
      let rows = this.baseRows;
      let sizes = this.baseSizes;
      if (this.view !== "pinned" && !this.outlined() && rows.length) { rows = [...rows, { kind: "tail", key: "tail", h: TAIL }]; sizes = [...sizes, TAIL]; }
      // A short list sits at the bottom, by the newest turn, like the chat. The Pinned view
      // reads from the top: pin 1 first.
      // The floating top: a list that fills the pane starts TOP_BAND down, so its first row is
      // not under the state; a short one's spacer is at least that tall.
      const total = sizes.reduce((x, y) => x + y, 0);
      if (this.view !== "pinned" && this.listH > 0 && rows.length && total + gap < this.listH - 1) {
        rows = [{ kind: "spacer", key: "spacer", h: this.listH - total }, ...rows];
        sizes = [this.listH - total, ...sizes];
      } else if (gap && rows.length) {
        rows = [{ kind: "gap", key: "gap", h: gap }, ...rows];
        sizes = [gap, ...sizes];
      }
      this.rowsMemo = rows;
      this.sizesMemo = sizes;
      // What the list is given: whole design px. v_virtual_list scales item sizes by zoom
      // itself, as it scales what an item draws, so a slot of h design px holds h design px
      // at any zoom (seen in a drawn window at zoom 0.9: a 73 px row took 73 x 0.9 zoomed px).
      this.slotsMemo = sizes.map((h) => Math.ceil(h));
      this.fitKey = fit;
      // A closed running pin in the Pinned view is a compact row with live off, but its
      // reply line carries the clock, so it counts as shown too.
      this.liveShown = Boolean(lr?.live) || rows.some((r) => r.kind === "wake" || r.running);
    }
    return this.rowsMemo;
  }

  // Whether turn ti of session si is the live newest turn (Working or Needs you): only one
  // still owed its reply. A done turn the agent woke up for again (a background task's
  // notification) keeps its reply, with an Updating line under it (waking).
  isLive(s, si, ti, _status) {
    return si === this.sessions.length - 1 && ti === s.turns.length - 1 && !s.turns[ti].done;
  }
  waking(s, si, ti, status) {
    return si === this.sessions.length - 1 && ti === s.turns.length - 1 && s.turns[ti].done && s.followActive && status === "working";
  }

  buildRows(status) {
    if (this.view === "pinned") return this.pinnedRows(status);
    const out = [];
    // The rail's turns: every shown turn, with the ones a search leaves out marked.
    const rail = [];
    this.railTurns = rail;
    const outline = this.outlined();
    let maxN = 1;
    if (outline) for (const s of this.sessions) maxN = Math.max(maxN, s.turns.length ? s.turns[s.turns.length - 1].n : 1);
    const numW = outlineNumW(maxN);
    const q = this.filterText();
    const agents = Boolean(this.prefs.agentTurns);
    this.sessions.forEach((s, si) => {
      if (si > 0) out.push({ kind: "divider", key: `div:${si}`, s });
      if (s.reason && s.turns.length === 0 && s.loaded) out.push({ kind: "note", key: `empty:${si}`, text: "No turns in this session yet" });
      const shown = (turn, ti) => isShown(turn, { agentTurns: agents, live: this.isLive(s, si, ti, status) });
      // Day dividers when the session spans more than one day; counts are of shown turns.
      const days = new Map();
      s.turns.forEach((t, ti) => {
        const d = t.day === undefined ? (t.day = dayKey(t.ts)) : t.day;
        if (!d || !shown(t, ti)) return;
        const r = days.get(d) ?? { ts: t.ts, count: 0 };
        r.count++;
        days.set(d, r);
      });
      let day = null;
      let unmatched = 0;
      const flush = () => { if (unmatched) out.push({ kind: "hidden", key: `hid:${si}:${out.length}`, n: unmatched }); unmatched = 0; };
      s.turns.forEach((turn, ti) => {
        const key = `${si}:${turn.n}`;
        // Agent turns while they are hidden: skipped, and counted in the header instead.
        const visit = key === this.pinVisit;
        const off = !shown(turn, ti);
        const miss = q && !threadMatches(s.turns, turn, q);
        if (!off) rail.push({ key, turn, day: turn.day ?? dayKey(turn.ts), live: this.isLive(s, si, ti, status), miss: Boolean(miss) });
        if (off && !visit) return;
        if (miss && !visit) { unmatched++; return; }
        flush();
        if (visit && (off || miss)) out.push({ kind: "note", key: `visit:${key}`, text: visitNote(miss) });
        const d = turn.day;
        if (days.size > 1 && !q && d && d !== day) {
          day = d;
          const r = days.get(d);
          out.push({ kind: "day", key: `day:${si}:${d}`, ...dayParts(r.ts), count: r.count });
        }
        const last = si === this.sessions.length - 1 && ti === s.turns.length - 1;
        const live = this.isLive(s, si, ti, status);
        // The outline: one row per turn, under the same day bands, the same search and the
        // same agents toggle. It keeps the turn's key, so the selection carries over.
        if (outline) { out.push({ kind: "line", key, turn, s, si, last, running: live, numW, text: outlineText(turn.prompt, q) }); return; }
        const item = { kind: "turn", key, turn, s, si, last, live };
        if (live) this.liveRows(item, out);
        else if (this.open.has(key)) this.expanded(item, out);
        else this.closedRows(item, out);
        if (this.waking(s, si, ti, status)) out.push({ kind: "wake", key: `wk:${key}`, turn, s });
      });
      flush();
    });
    return out;
  }

  // A closed turn. With pasted images its meta line and tiles are an item of their own
  // ("wtop", keyed imgs:<turn>), as a running turn's are, so a click on a tile opens the review
  // at that image (a list item has one click handler), and the row follows without its meta
  // line ("split").
  closedRows(item, out) {
    const shape = this.shape(item.turn);
    if (!shape.thumbs) { out.push({ ...item, shape }); return; }
    out.push({ ...item, kind: "wtop", key: `imgs:${item.key}`, turnKey: item.key, live: false });
    out.push({ ...item, shape, split: true });
  }

  // The running turn. With pasted images its meta line and tiles are an item of their own
  // ("wtop", keyed imgs:<turn>), so a click on a tile can open the viewer (a list item has
  // one click handler), and the rest of the row follows without its meta line ("split").
  liveRows(item, out) {
    const split = Boolean(item.turn.images?.length);
    if (split) out.push({ ...item, kind: "wtop", key: `imgs:${item.key}`, turnKey: item.key, live: false });
    out.push({ ...item, kind: "wrow", split, shape: this.shape(item.turn, true) });
    // Open while it runs: the steps as they arrive, newest at the bottom, then "Working…".
    if (this.lineIsOpen(item.key, true)) {
      this.stepRows(item, out, true);
      if (this.status() === "working") out.push({ ...item, live: false, kind: "wspin", key: `ws:${item.key}` });
    }
  }

  // Level 1's steps, in order: each interim text, and each group's line; an open group
  // (level 2) adds one row per call. A running turn's last group, with nothing said since,
  // is the one still running.
  stepRows(item, out, live = false) {
    const { key, turn } = item;
    const steps = turn.steps ?? [];
    steps.forEach((st, i) => {
      if (st.k === "text") {
        out.push({ ...item, live: false, kind: "itext", key: `it:${key}:${i}`, src: st.t, ...this.stepLinks(st) });
        return;
      }
      const now = live && i === steps.length - 1 && !turn.after?.length;
      const read = this.readsCalls(item.si, st);
      // The running group's newest call is read from the transcript's tail, so its line can
      // name what runs now.
      if (now && read && st.ids?.at(-1)) this.wantCalls(item.si, [st.ids.at(-1)], true);
      const open = this.groupOpen.has(`${key}:${i}`);
      if (open && read) this.wantCalls(item.si, st.ids);
      // A group of one call, once open, is that call's own row.
      const one = open && read && st.count === 1;
      if (!one) out.push({ ...item, live: false, kind: "grp", key: `gp:${key}:${i}`, gi: i, step: st, now, read });
      if (!open) return;
      st.calls.forEach((name, j) => {
        const id = read ? st.ids[j] : null;
        out.push({ ...item, live: false, kind: "call", key: `cl:${key}:${i}:${j}`, name, id, gi: i, ci: j, one, now: one && now });
        if (!id || !this.callOpen.has(`${key}:${i}:${j}`)) return;
        const c = this.callEntry(item.si, id);
        const all = this.callAll.has(`${key}:${i}:${j}`);
        // The running group's newest call with no result yet is still running.
        const going = now && j === st.calls.length - 1 && c?.st === "ok" && c.out == null;
        out.push({ ...item, live: false, kind: "cout", key: `co:${key}:${i}:${j}`, id, gi: i, ci: j, all, going,
          st: c?.st ?? "wait", box: outLines(c?.out, all, c?.lines) });
      });
      if (st.count > st.calls.length) out.push({ ...item, live: false, kind: "call", key: `cl:${key}:${i}:more`, more: st.count - st.calls.length });
    });
  }
  lineIsOpen(key, live) { return this.lineTouched.has(key) ? this.lineOpen.has(key) : live; }
  isLiveKey(key) { return Boolean(this.baseRows?.some((r) => r.key === key && r.live)); }

  // Level 3's data. Calls are read for every agent but Cursor, which records no calls' ids or
  // output: the group must carry its calls' ids.
  readsCalls(si, st) {
    const file = this.sessions[si]?.file;
    return Boolean(file && st?.ids?.some(Boolean) && CALLS_READ.has(harnessOfFile(file)));
  }
  callEntry(si, id) { return id ? this.calls.get(`${this.sessions[si]?.file}#${id}`) ?? null : null; }
  // What a group's line adds from the calls read so far: whether one failed, and while the
  // group runs, what its newest call runs.
  // What a group's line can say about its calls. Calls are read only when a group opens, so
  // a group not read yet claims nothing: no check and no red mark. Once every call's result is
  // in memory it has the check, or the red mark and how many failed.
  // Paths in a level 3 line (ui.js shortPaths): from the terminal's working folder, or from
  // ~. Only what is drawn: the transcript and anything copied keep the full path. The folder
  // is the one the session was found by, else the terminal's own (a pane pinned to a
  // transcript sits beside a terminal too).
  short(text) {
    const cwd = this.res?.cwd || terminals().find((x) => x.address === this.terminal)?.cwd || null;
    return shortPaths(text, cwd, home());
  }

  groupInfo(r) {
    if (!r.read) return { known: false, failed: 0, current: null };
    const cs = r.step.ids.map((id) => (id ? this.callEntry(r.si, id) : null));
    const failed = cs.filter((c) => c?.err === true).length;
    const known = cs.length > 0 && cs.every((c) => c?.st === "ok" && c.out != null);
    const last = r.now ? cs.at(-1) : null;
    return { known, failed, current: last?.input ? this.short(callText(r.step.calls.at(-1), last.input)) : null };
  }
  // Queues the calls not read yet. A call read before its output was written is read again
  // once the session has grown, while its group is open; tail reads only the file's end.
  wantCalls(si, ids, tail = false) {
    const s = this.sessions[si];
    if (!s?.file) return;
    const fresh = [];
    const again = [];
    for (const id of ids ?? []) {
      const c = id ? this.calls.get(`${s.file}#${id}`) : undefined;
      if (!id || c?.st === "wait") continue;
      if (!c) fresh.push(id);
      else if (!tail && c.out == null && c.ver !== s.version) again.push(id);
    }
    for (const id of [...fresh, ...again]) this.calls.set(`${s.file}#${id}`, { ...this.calls.get(`${s.file}#${id}`), st: "wait" });
    // A call read again is recent, so only the file's end is read for it.
    if (fresh.length) (this.callDue ??= []).push({ file: s.file, ver: s.version, ids: fresh, tail });
    if (again.length) (this.callDue ??= []).push({ file: s.file, ver: s.version, ids: again, tail: true });
  }
  flushCalls(cx) {
    if (this.callBusy || !this.callDue?.length) return;
    this.callBusy = true;
    cx.timer.after(0, (cx) => {
      const job = this.callDue.shift();
      if (!job) { this.callBusy = false; return; }
      cx.spawn(async (cx) => {
        const got = new Map();
        let ok = false;
        try {
          const r = await exec("sh", [SCRIPT("calls.sh"), ...(job.tail ? ["--tail"] : []), job.file, harnessOfFile(job.file), ...job.ids]);
          ok = r.code === 0;
          for (const l of ok ? r.stdout.split("\n") : []) {
            let x = null;
            try { x = JSON.parse(l); } catch { continue; }
            if (!x || typeof x.id !== "string" || !job.ids.includes(x.id)) continue;
            const c = got.get(x.id) ?? {};
            if (x.k === "in") Object.assign(c, { input: String(x.in ?? ""), inTs: x.ts ?? null });
            if (x.k === "out") Object.assign(c, { out: String(x.out ?? ""), err: x.err === true, lines: Number(x.lines) || 0, outTs: x.ts ?? null, ms: Number.isFinite(x.ms) ? x.ms : null });
            got.set(x.id, c);
          }
        } catch { ok = false; }
        for (const id of job.ids) {
          const k = `${job.file}#${id}`;
          const was = this.calls.get(k);
          const c = got.get(id);
          // A tail read that misses a call's input keeps the input read before.
          if (c || was?.input != null) this.calls.set(k, { ...was, ...c, st: "ok", ver: job.ver });
          else this.calls.set(k, { st: ok ? "none" : "err", ver: job.ver });
        }
        this.pruneCalls();
        this.callBusy = false;
        this.callVer = (this.callVer ?? 0) + 1;
        cx.notify();
      });
    });
  }
  // Keeps the cache at CALLS_MAX, dropping the oldest reads first but never a call in an open
  // group, so open groups are not read over and over.
  pruneCalls() {
    if (this.calls.size <= CALLS_MAX) return;
    const keep = new Set();
    for (const g of this.groupOpen) {
      const [si, n, i] = g.split(":");
      const file = this.sessions[Number(si)]?.file;
      for (const id of this.findTurn(`${si}:${n}`)?.steps?.[Number(i)]?.ids ?? []) if (id) keep.add(`${file}#${id}`);
    }
    for (const [k, c] of this.calls) {
      if (this.calls.size <= CALLS_MAX) break;
      if (!keep.has(k) && c.st !== "wait") this.calls.delete(k);
    }
  }
  // A call row's click: its output box opens or closes (level 3).
  toggleCall(c) {
    if (this.callOpen.has(c)) { this.callOpen.delete(c); this.callAll.delete(c); } else this.callOpen.add(c);
  }
  // The open groups' calls that can show output, by "<turn>:<step>:<call>".
  openCalls(k, turn) {
    const si = Number(k.split(":")[0]);
    const out = [];
    (turn.steps ?? []).forEach((st, i) => {
      if (st.k !== "group" || !this.groupOpen.has(`${k}:${i}`) || !this.readsCalls(si, st)) return;
      st.ids.forEach((id, j) => { if (id) out.push(`${k}:${i}:${j}`); });
    });
    return out;
  }

  // → opens the selected turn one level deeper: the turn, then its line (level 1), then its
  // step groups (level 2), then their calls' output (level 3). ← backs out one level. A
  // running turn has no closed state: its line opens and closes.
  deeper(cx) {
    const k = this.sel;
    const turn = k ? this.findTurn(k) : null;
    if (!turn) return false;
    const live = this.isLiveKey(k);
    if (!live && !this.open.has(k)) { this.toggle(k, cx); this.lineOpen.add(k); this.lineTouched.add(k); return true; }
    if (!this.lineIsOpen(k, live)) { this.toggleLine(k, live); cx.notify(); return true; }
    const groups = (turn.steps ?? []).map((st, i) => (st.k === "group" ? `${k}:${i}` : null)).filter(Boolean);
    if (groups.some((g) => !this.groupOpen.has(g))) { for (const g of groups) this.groupOpen.add(g); cx.notify(); return true; }
    for (const c of this.openCalls(k, turn)) this.callOpen.add(c);
    cx.notify();
    return true;
  }
  shallower(cx) {
    const k = this.sel;
    const turn = k ? this.findTurn(k) : null;
    if (!turn) return false;
    const live = this.isLiveKey(k);
    const calls = [...this.callOpen].filter((c) => c.startsWith(`${k}:`) && this.groupOpen.has(c.split(":").slice(0, 3).join(":")));
    if (calls.length && this.lineIsOpen(k, live)) { for (const c of calls) { this.callOpen.delete(c); this.callAll.delete(c); } cx.notify(); return true; }
    const groups = [...this.groupOpen].filter((g) => g.startsWith(`${k}:`));
    if (groups.length && this.lineIsOpen(k, live)) { for (const g of groups) this.groupOpen.delete(g); cx.notify(); return true; }
    if (this.lineIsOpen(k, live) && (live || this.open.has(k))) { this.toggleLine(k, live); cx.notify(); return true; }
    if (!live && this.open.has(k)) { this.toggle(k, cx); return true; }
    return false;
  }

  // The Pinned view: the pinned turns oldest first (the order of the keys 1 to 5). A closed
  // pin is a compact row (pinRow: its digit, number, time, two lines of the prompt and one of
  // the reply), so five fit in the column; an open one is the card, as in the list. A row
  // shows only its time, so a day header goes above the first pin of each day.
  pinnedRows(status) {
    const L = this.pinnedList();
    if (!L.length) return [{ kind: "note", key: "pins:none", text: "No pins yet. Select a turn in the list and press p to pin it. Pins stay with this session, and 1 to 5 bring you back to each." }];
    const out = [];
    const now = Date.now();
    let day = null;
    L.forEach((p, i) => {
      const d = dayKey(p.turn?.ts);
      if (d && d !== day) {
        day = d;
        out.push({ kind: "pday", key: `pday:${i}`, ...dayParts(p.turn.ts, now) });
      }
      if (!p.turn) {
        out.push({ kind: "note", key: `pins:${i}`, pinNo: i + 1, text: p.state === "gone" ? `${i + 1} · #${p.pin.n} is no longer in this session. Click to unpin it.` : `${i + 1} · #${p.pin.n} · reading this session…` });
        return;
      }
      const si = this.sessions.indexOf(p.s);
      const live = this.isLive(p.s, si, p.turn.n - 1, status);
      const item = { kind: "turn", key: p.key, turn: p.turn, s: p.s, si, last: false, live, pinNo: i + 1 };
      // Opened, a pin is drawn as in the list: the card, or the running turn's rows.
      if (this.open.has(p.key)) { if (live) this.liveRows(item, out); else this.expanded(item, out); }
      // Closed, a running pin is compact too, with its live state on the reply line. live
      // stays off on that item: rows() turns a live last item into the running turn's card.
      else out.push({ ...item, live: false, running: live, fresh: p.state === "new", compact: true, shape: this.pinShape(p.turn, live) });
      if (this.waking(p.s, si, p.turn.n - 1, status)) out.push({ kind: "wake", key: `wk:${p.key}`, turn: p.turn, s: p.s });
    });
    return out;
  }

  // Shows all turns or the pinned ones in this pane, keeping the selection.
  setView(view) {
    if (this.view === view) return;
    this.view = view;
    this.pinVisit = null;
    if (view === "pinned") {
      const L = this.pinnedList();
      if (!L.some((p) => p.key === this.sel)) this.sel = L.find((p) => p.key)?.key ?? null;
    }
    this.follow = false;
    if (this.sel) this.scrollTo = { key: this.sel, how: "center" };
  }

  // v: the Pinned column beside this pane, from PIN_SPLIT_MIN (480 px) wide; narrower, the
  // switch in this pane, with a toast that says why. In the Pinned pane, v goes back to the
  // main pane. auto: opened by a pin or by Threads opening with pins, so no switch when there
  // is no room, and the keyboard stays in this pane.
  openPinned(cx, auto = false) {
    if (this.pinnedPane) {
      const main = this.mainPane();
      if (main) run("pane.focus", { pane: main.pane });
      return true;
    }
    const open = this.pinnedPaneOpen();
    if (open) { if (!auto) run("pane.focus", { pane: open.pane }); return true; }
    if (this.view === "pinned") { if (!auto) this.setView("all"); return true; }
    const me = this.me();
    const px = pinColumn(this.pw());
    if (!me || !px) {
      if (auto) return false;
      this.setView("pinned");
      if (me) this.say(`Pinned shows here: the Pinned column needs Threads ${PIN_SPLIT_MIN} px wide`, "pin", cx, 3500);
      return true;
    }
    if (this.splitAsk) return true;
    this.splitAsk = { before: panes().map((p) => p.pane), px, back: auto ? me.pane : null, until: Date.now() + 4000 };
    run("pane.split", { pane: me.pane, direction: "right", mod: MOD, props: { ...(props() ?? {}), view: "pinned" } });
    return true;
  }

  // Once the split has applied: the new pane goes in the Pinned map and gets the column's
  // width. Opened by a pin or by Threads opening, the keyboard goes back to Threads.
  settleSplit() {
    const a = this.splitAsk;
    if (!a) return;
    const made = panes().find((p) => p.mod === MOD && !a.before.includes(p.pane));
    if (made) {
      this.splitAsk = null;
      remember(this.terminal, made.pane, PIN_MAP_KEY);
      run("layout.resize", { id: made.pane, px: a.px });
      if (a.back) run("pane.focus", { pane: a.back });
    } else if (Date.now() > a.until) this.splitAsk = null;
  }

  // This pane's width, for its partner (resizeColumn).
  shareWidth() {
    const me = this.me();
    if (!me || this.paneW == null) return;
    const map = shared(WIDTH_KEY) ?? {};
    if (Math.abs((map[me.pane] ?? -9) - this.paneW) > 1) setShared(WIDTH_KEY, { ...map, [me.pane]: Math.round(this.paneW) });
  }

  // - and =, in the column or in Threads while the column is open: the column 40 px
  // narrower or wider, and Threads the other way, so the terminal stays put (ui.js
  // columnResize says why a drag on the divider cannot do this).
  resizeColumn(d, cx) {
    const col = this.pinnedPane ? this.me() : this.pinnedPaneOpen();
    const main = this.pinnedPane ? this.mainPane() : this.me();
    if (!col || !main) return false;
    const w = shared(WIDTH_KEY) ?? {};
    // Herdr's px size for a pane is its measured width plus the pane's 1 px frame each side.
    const next = columnResize(w[col.pane] + PANE_FRAME, w[main.pane] + PANE_FRAME, d);
    if (!next) { this.say(d > 0 ? "The Pinned column is as wide as it goes" : "The Pinned column is as narrow as it goes", "info", cx); return true; }
    // With readingWidth on, Threads stops at the reading width and the terminal takes the rest.
    if (this.prefs.readingWidth && Number.isFinite(this.readingPx())) next.main = Math.min(next.main, this.readingPx());
    run("layout.resize", { id: col.pane, px: next.column });
    run("layout.resize", { id: main.pane, px: next.main });
    setShared(WIDTH_KEY, { ...w, [col.pane]: next.column - PANE_FRAME, [main.pane]: next.main - PANE_FRAME });
    return true;
  }

  // The Pinned column is the way in: Threads opening with pins opens it once, when there is
  // room. Closing the column keeps it closed for this pane's life, until v opens it again.
  // In the column: it closes when its Threads pane closes.
  autoPinned(cx) {
    if (this.pinnedPane) {
      // The column goes with its Threads pane: once the main pane has been seen, its closing
      // closes the column, so opening Threads again brings both back together.
      const main = this.mainPane();
      if (main) this.mainSeen = true;
      else if (this.mainSeen && !this.closing) {
        const me = this.me();
        if (me) { this.closing = true; run("pane.close", { pane: me.pane }); }
      }
      return;
    }
    const open = Boolean(this.pinnedPaneOpen());
    if (this.pinColOpen && !open && !this.splitAsk) this.pinColClosed = true;
    this.pinColOpen = open;
    if (this.pinAutoDone || !this.width || !this.current()?.loaded || !this.pinsRead) return;
    this.pinAutoDone = true;
    if (!open && !this.pinColClosed && this.pinnedList().length) this.openPinned(cx, true);
  }

  // Counts for the header, the Agents button and the empty state, kept until the turns,
  // the status or the setting change. cur: the newest session; all: every session.
  counts() {
    const status = this.status();
    const key = `${this.sessions.map((s) => `${s.version}.${s.turns.length}`).join(",")}|${status}|${this.prefs.agentTurns ? 1 : 0}`;
    if (this.countsKey === key) return this.countsMemo;
    const agents = Boolean(this.prefs.agentTurns);
    const c = { agentAll: 0, hiddenAll: 0, shownAll: 0, agentCur: 0, hiddenCur: 0, shownCur: 0 };
    const lastSi = this.sessions.length - 1;
    this.sessions.forEach((s, si) => s.turns.forEach((t, ti) => {
      const on = isShown(t, { agentTurns: agents, live: this.isLive(s, si, ti, status) });
      c.agentAll += t.agent ? 1 : 0;
      c.hiddenAll += on ? 0 : 1;
      c.shownAll += on ? 1 : 0;
      if (si === lastSi) { c.agentCur += t.agent ? 1 : 0; c.hiddenCur += on ? 0 : 1; c.shownCur += on ? 1 : 0; }
    }));
    this.countsKey = key;
    this.countsMemo = c;
    return c;
  }

  // Whether the selection is on a hidden agent turn.
  selHidden() {
    if (!this.sel || this.prefs.agentTurns || !this.findTurn(this.sel)?.agent) return false;
    return !this.turnKeys(this.baseRows).includes(this.sel);
  }

  // The selected turn was hidden: select the nearest shown turn before it (or the first);
  // while following the newest turn, the newest shown one.
  reselectVisible() {
    this.reselect = false;
    if (!this.sel) return;
    const keys = this.turnKeys(this.baseRows);
    if (!keys.length || keys.includes(this.sel)) return;
    if (this.follow) { this.sel = keys[keys.length - 1]; this.toBottom = true; return; }
    const [si, n] = this.sel.split(":").map(Number);
    let pick = null;
    for (const k of keys) { const [ks, kn] = k.split(":").map(Number); if (ks < si || (ks === si && kn < n)) pick = k; }
    this.sel = pick ?? keys[0];
    this.scrollTo = { key: this.sel, how: "center" };
  }

  // What a collapsed row shows: its prompt and reply lines at the pane width, kept on the
  // turn until any of its inputs change.
  shape(turn, live = false) {
    const q = this.filterText();
    const P = this.prefs;
    const why = turn.interrupted ? `No reply · interrupted after ${plural(turn.tools, "tool call")}` : null;
    const text = this.replyText(turn);
    const key = `${Math.round(this.width)}|${P.textSize}|${P.width}|${P.promptLines}|${P.replyLines}|${q}|${turn.prompt.length}|${text.length}|${why ? 1 : 0}|${live ? 1 : 0}|${turn.answeredBy}|${turn.answeredIn}|${turn.answeredBy && this.prefs.agentTurns ? 1 : 0}|${turn.images?.length ?? 0}`;
    if (turn.shapeKey === key) return turn.shapeMemo;
    // Out of time for this draw: the shape it had (a row never shaped yet, as when agent
    // messages are turned on, a blank one-line row), and the next frame reshapes it.
    if ((this.shapeSpent ?? 0) > (this.shapeBudget ?? SHAPE_MS)) { this.shapeLeft = (this.shapeLeft ?? 0) + 1; return turn.shapeMemo ?? this.blankShape(); }
    const t0 = now();
    const sh = this.reshape(turn, live, q, P, why, text);
    turn.shapeKey = key;
    turn.shapeMemo = sh;
    this.shapeSpent = (this.shapeSpent ?? 0) + (now() - t0);
    return sh;
  }
  // A row's shape for the frame or two before it is shaped: one empty line of prompt and of
  // reply at the pane's width and text size.
  blankShape() {
    const k = `${Math.round(this.width)}|${this.prefs.textSize}|${this.prefs.width}`;
    if (this.blankMemo?.k !== k) {
      const sh = rowShape({ prompt: " ", reply: " ", width: this.width, promptLines: 1, replyLines: 1, size: this.prefs.textSize, chars: this.chars() });
      this.blankMemo = { k, sh: { ...sh, tone: "reply", cmd: null, blank: true } };
    }
    return { ...this.blankMemo.sh };
  }
  // Reshaped before the rest, so the rows on screen are the first to change: the running
  // turn (its row is on screen while the pane follows), then up to SHAPE_FIRST shown turns
  // from the one at the top of the pane down (the newest when the pane has not drawn yet).
  shapeInView(status) {
    this.sessions.forEach((s, si) => {
      const ti = s.turns.length - 1;
      if (ti >= 0 && this.isLive(s, si, ti, status)) this.shape(s.turns[ti], true);
    });
    // The top row's turn, from the rows drawn last (a day band or a hidden-turns note at the
    // top: the first turn under it).
    let si = this.sessions.length - 1;
    let from = -1;
    const at = this.topKey != null ? this.baseIndex?.get(this.topKey) : undefined;
    if (at != null) {
      let r = null;
      for (let i = at; i < this.baseRows.length && !r; i++) if (this.baseRows[i].turn && this.baseRows[i].si != null) r = this.baseRows[i];
      if (r && this.sessions[r.si]) { si = r.si; from = this.sessions[si].turns.indexOf(r.turn); }
    }
    const s = this.sessions[si];
    if (!s?.turns.length) return;
    // Only turns the list shows count (hidden agent messages are skipped).
    const agents = Boolean(this.prefs.agentTurns);
    const shows = (ti) => {
      const live = this.isLive(s, si, ti, status);
      return !live && isShown(s.turns[ti], { agentTurns: agents, live }) && !this.open.has(`${si}:${s.turns[ti].n}`);
    };
    if (from < 0) { from = s.turns.length; for (let k = 0; from > 0 && k < SHAPE_FIRST;) if (shows(--from)) k++; }
    for (let ti = from, k = 0; ti < s.turns.length && k < SHAPE_FIRST; ti++) {
      if (!shows(ti)) continue;
      k++;
      this.shape(s.turns[ti]);
    }
  }
  reshape(turn, live, q, P, why, text) {
    const cmd = commandParts(turn);
    const src = (t) => (q ? around(t.replace(/\s+/g, " "), q) : t).slice(0, PREVIEW_CHARS);
    let preview;
    let md = null;
    let tone = "reply";
    // A reply, with no search on, starts as Markdown (mdPreview): whole source lines.
    if (!live && !why && text && !q) {
      md = mdPreview(text, P.replyLines, readWidth(this.width, P.textSize, this.chars()) / readType(P.textSize).reply);
      if (!md.md.trim()) md = null;
    }
    if (live) { preview = ""; tone = "live"; }
    else if (why) { preview = why; tone = "why"; }
    else if (md) preview = " ";
    else if (text) preview = src(q ? flattenMd(text.slice(0, PREVIEW_CHARS * 2)) : flattenMd(text, Math.min(PREVIEW_CHARS, (P.replyLines + 1) * Math.ceil(Math.max(this.width || 0, 120) / 5))));
    else if (turn.answeredIn) { preview = `Answered in #${turn.answeredIn}`; tone = "note"; }
    else if (turn.errors.length) { preview = turn.errors[turn.errors.length - 1]; tone = "error"; }
    else if (turn.answeredBy) {
      const by = this.findTurn(`${this.sessions.findIndex((x) => x.turns.includes(turn))}:${turn.answeredBy}`);
      preview = by?.agent && !this.prefs.agentTurns ? `Answered together with agent message #${turn.answeredBy}` : `Answered together with #${turn.answeredBy}`;
      tone = "note";
    } else { preview = "No reply"; tone = "note"; }
    const sh = rowShape({
      prompt: src(turn.prompt), reply: preview || " ", width: this.width, agent: turn.agent,
      cmd: cmd && { name: cmd.name, args: src(cmd.args) },
      promptLines: P.promptLines, replyLines: tone === "reply" ? P.replyLines : 1,
      // While filtering, the row shows the text around the first match, as one run.
      quotes: !q, size: P.textSize, chars: this.chars(),
    });
    // A running turn draws its live line where a finished one has its line, then a 16 px
    // stats line where the reply and the strip under it go.
    if (live) sh.height += ROW.STATS - sh.r * this.rt().line - ROW.GAP - ROW.ACTS;
    // A reply, with no search on: its start as Markdown, as an open turn draws it, cut at a
    // whole source line (mdPreview). Its height is the probe's measure of that block ("cmd"),
    // and until then an estimate; mdBase is the row without it.
    if (md && tone === "reply") {
      const { line } = this.rt();
      // No link rules here: a click on a row opens the turn, so rows never carry links.
      sh.md = md.md;
      // The source lines, for the debug report and the tests; the block is drawn from md.
      sh.reply = md.md.split("\n");
      sh.r = md.lines;
      sh.rMore = md.cut;
      sh.mdBase = rowHeight(sh.p, 0, (sh.pMore ? 1 : 0) + (sh.rMore ? 1 : 0), line, Boolean(turn.agent));
      sh.mdEst = md.lines * line + md.gaps * Math.max(0, this.paraGap() - line / 2);
      sh.height = sh.mdBase + sh.mdEst;
    }
    sh.tone = tone;
    sh.cmd = cmd;
    // Pasted images: a row of tiles over the bubble (a running turn's are in its wtop item).
    if (turn.images?.length && !live) {
      const th = thumbSize(this.width, P.textSize, this.chars()) + ROW.GAP;
      sh.thumbs = true;
      sh.height += th;
      if (sh.mdBase != null) sh.mdBase += th;
    }
    return sh;
  }

  // A compact pin's lines (ui.js pinRowShape) at the pane width, kept on the turn like shape().
  pinShape(turn, live = false) {
    const why = turn.interrupted ? `No reply · interrupted after ${plural(turn.tools, "tool call")}` : null;
    const text = live ? "" : this.replyText(turn);
    const key = `${Math.round(this.width)}|${turn.prompt.length}|${text.length}|${why ? 1 : 0}|${live ? 1 : 0}|${turn.answeredIn}|${turn.errors.length}`;
    if (turn.pinShapeKey === key) return turn.pinShapeMemo;
    const cmd = commandParts(turn);
    const prompt = cmd ? `${cmd.name} ${cmd.args}`.trim() : pinPromptText(turn.prompt.slice(0, PREVIEW_CHARS));
    let reply = "";
    let tone = "reply";
    if (live) tone = "live";
    else if (why) { reply = why; tone = "why"; }
    else if (text) reply = flattenMd(text.slice(0, PREVIEW_CHARS * 2), PREVIEW_CHARS);
    else if (turn.answeredIn) { reply = `Answered in #${turn.answeredIn}`; tone = "note"; }
    else if (turn.errors.length) { reply = turn.errors[turn.errors.length - 1]; tone = "error"; }
    else { reply = "No reply"; tone = "note"; }
    const sh = pinRowShape({ prompt, reply, width: this.width });
    sh.tone = tone;
    sh.p = sh.prompt.length;
    sh.r = 1;
    turn.pinShapeKey = key;
    turn.pinShapeMemo = sh;
    return sh;
  }

  // One expanded turn becomes several list items, so each clickable part has its own key
  // (a virtual list allows one click handler, on the list, reporting the item key).
  // The item a return put the "starts above" line over, while that turn stays selected.
  resumeAt() { return this.pinResume && this.sel === this.pinResume.key ? this.pinResume.part : null; }

  expanded(item, out) {
    const { key, turn } = item;
    const resume = this.resumeAt();
    const push = (row) => { if (row.key === resume) out.push({ ...item, kind: "resume", key: `resume:${key}` }); out.push(row); };
    out.push({ ...item, kind: "head", part: "top" });
    // Pasted images: their tiles over the message. A tile opens the review.
    if (turn.images?.length) out.push({ ...item, kind: "imgs", key: `imgs:${key}` });
    out.push({ ...item, kind: "you", key: `you:${key}`, full: this.full.has(key) });
    out.push({ ...item, kind: "ustrip", key: `us:${key}` });
    const text = this.replyText(turn);
    out.push({ ...item, kind: "rhead", key: `rhead:${key}` });
    // Level 1, under the line when it is open: the tool calls by kind, the numbers, and on
    // i what they mean.
    if (this.lineIsOpen(key, false)) {
      this.stepRows(item, out);
      out.push({ ...item, kind: "stats", key: `st:${key}` });
      if (this.legendOn) out.push({ ...item, kind: "legend", key: `lg:${key}` });
    }
    if (!text) out.push({ ...item, kind: "noreply", key: `nr:${key}` });
    let used = 0;
    let left = 0;
    const segs = segments(text);
    // Editors cannot be made while drawing: note the turn, and flushCode() makes them
    // on the next tick.
    const stale = segs.some((seg, i) => seg.kind === "code" && this.code.get(`${key}:${i}`)?.text !== seg.text)
      || [...this.code.keys()].some((k) => k.startsWith(`${key}:`) && segs[Number(k.slice(key.length + 1))]?.kind !== "code");
    if (stale) (this.codeDue ??= new Set()).add(key);
    const selecting = this.selecting === key && this.selEditor?.key === key && text;
    const linked = selecting ? null : this.linkedSegs(key, segs);
    if (selecting) {
      const per = Math.max(8, Math.floor((this.inner() - 26) / SELECT_CHAR));
      const lines = wrappedLines(this.selEditor.text.slice(0, SELECT_CHARS), per);
      out.push({ ...item, kind: "seltext", key: `sx:${key}`, lines, boxH: Math.min(lines * 18 + 14, 2400) });
    }
    // An open turn shows the whole reply, up to FULL_REPLY_CHARS.
    if (!selecting) segs.forEach((seg, i) => {
      if (used >= FULL_REPLY_CHARS) { left += seg.text.length; return; }
      if (seg.kind === "md") {
        let md = seg.text;
        if (used + md.length > FULL_REPLY_CHARS) {
          md = cutMd(md, FULL_REPLY_CHARS - used);
          left += Math.max(0, seg.text.length - md.length);
        }
        used += md.length;
        // Herdr draws nothing for a Markdown block over 4,096 characters, so a long run of
        // prose (no code fence to split it) becomes several list items of at most MD_MAX,
        // split at paragraphs (mdChunks): "md:<turn>:<segment>.<n>". Each is one Markdown view,
        // so a drag can select across the paragraphs in one item but not across items, and
        // the list draws only the items in view. Link rules run on the text shown; heights use
        // the text as written. A return to a pin lands at the start of its item.
        const parts = mdChunks(md);
        parts.forEach((src, j) => {
          const lk = parts.length === 1 && linked?.[i] && src === seg.text ? linked[i] : this.linkOne(src);
          const sub = parts.length === 1 ? `${i}` : `${i}.${j}`;
          push({ ...item, kind: "md", key: `md:${key}:${sub}`, md: lk.md, src, links: lk.links, ...(j ? { gap: this.paraGap() } : {}) });
        });
      } else {
        used += seg.text.length;
        push({ ...item, kind: "codehead", key: `cc:${key}:${i}`, seg, i });
        out.push({ ...item, kind: "code", key: `code:${key}:${i}`, seg, i, ...this.codeShape(seg.text) });
      }
    });
    // A long reply ends in a quiet Collapse (Esc) row, with what the cap left out.
    if (!selecting && (text.length > LONG_REPLY || left)) out.push({ ...item, kind: "fold", key: `fold:${key}`, left });
    // What the agent said in its last background update, when that is not the reply.
    const late = (turn.latest ?? "").trim();
    if (late && late !== text) {
      const all = this.full.has(`l:${key}`);
      // One block that gpui wraps at the card's width (C5); the estimate counts lines only
      // until the probe has measured it.
      const text = flattenMd(late.slice(0, 4000));
      const l = rowLines(text, LATEST_LINES + 1, this.prose() / this.charW(MD_CHAR));
      push({ ...item, kind: "lhead", key: `lh:${key}` });
      out.push({ ...item, kind: "latest", key: `lt:${key}`, all, text, estLines: l.lines.length + (l.cut ? 1 : 0), md: all ? late.slice(0, 12000) : null });
    }
    out.push({ ...item, kind: "copy", key: `cp:${key}`, part: "bottom" });
  }

  // A code block's box: its rows, 6 px above and below the editor's text, and its bottom
  // border.
  codeBoxH(r) { return r.shown * CODE_LINE + 16; }

  // The editor wraps long lines (soft_wrap), so a block never sits scrolled sideways and
  // each line starts at the left edge. rows: the wrapped rows (ui.js codeRows) at the box's
  // width less the editor's padding, 7.3 px a character at 12 px. A block of up to
  // CODE_LINES rows shows them all; a taller one scrolls inside, and says so.
  codeShape(text) {
    const lines = text.split("\n");
    const rows = codeRows(text, (this.inner() - CODE_PAD) / 7.3);
    return { lines: lines.length, rows, shown: Math.min(CODE_LINES, rows), caption: rows > CODE_LINES };
  }

  turnKeys(rows) { return rows.filter((r) => ["turn", "head", "working", "wrow", "line"].includes(r.kind)).map((r) => r.key); }

  // The hidden agent turn whose reply this turn shares: Claude answered the person's prompt
  // and an agent message that came while it was open in one reply, or a later one after this
  // turn was cut off, which landed on the agent turn. While agent turns are hidden the
  // person's row borrows that reply, so it still shows one and "c" copies it.
  borrowedFrom(turn) {
    const n = turn?.answeredBy ?? turn?.answeredIn;
    if (!n || turn.after.length || this.prefs.agentTurns) return null;
    const s = this.sessions.find((x) => x.turns[turn.n - 1] === turn);
    const by = s?.turns[n - 1];
    return by?.agent && reply(by) ? by : null;
  }

  // The reply a row shows, opens and copies.
  replyText(turn) {
    const by = this.borrowedFrom(turn);
    return by ? reply(by) : reply(turn);
  }
  // From a row cut off to the row that has its answer. An open filter stays: threadMatches
  // lists that row whenever it lists this one.
  goToAnswer(turn) {
    const si = this.sessions.findIndex((x) => x.turns[turn.n - 1] === turn);
    if (si < 0 || !turn.answeredIn) return;
    const key = `${si}:${turn.answeredIn}`;
    this.sel = key;
    this.follow = false;
    this.scrollTo = { key, how: "center" };
  }
  findTurn(key) {
    const [si, n] = key.split(":").map(Number);
    return this.sessions[si]?.turns[n - 1] ?? null;
  }

  // ---- actions ----

  // Selects the newest turn (when asked, or when nothing is selected) and scrolls to it on
  // the next render, once the list holds the new rows.
  // The newest shown turn and whether it has ended: what the latest button's dot watches.
  newestSig() {
    const si = this.sessions.length - 1;
    const s = this.sessions[si];
    if (!s) return null;
    const agentTurns = Boolean(this.prefs.agentTurns);
    for (let ti = s.turns.length - 1; ti >= 0; ti--) {
      const turn = s.turns[ti];
      if (isShown(turn, { agentTurns, live: this.isLive(s, si, ti) })) return `${si}:${turn.n}:${turn.done ? 1 : 0}`;
    }
    return null;
  }
  // After a read: a new turn, or the reply to the newest one, came in. The next draw of the
  // list decides: with the list's end off screen the latest button gets a dot until it shows.
  noteNew(before) {
    if (this.view !== "pinned" && this.newestSig() !== before) this.unseen = "pending";
  }

  // Stick to the bottom, from what each frame draws (listItems; it may not change the view,
  // so it leaves a step for render and asks the 120 ms timer for a frame). The list's end
  // (the tail row) on screen is the bottom. The person scrolled when the top row moved with
  // the rows unchanged, outside the pane's own scrolls, or when a wheel event came (upAt and
  // downAt, by direction).
  // - Following, the end off screen: after a scroll up of theirs following stops; with new rows
  //   (content grew below, or the list was rebuilt for a new height) the view goes back down.
  //   The same rows with no scroll of theirs change nothing: the list got shorter for a frame,
  //   or the pane's own scroll put the end off screen.
  // - Not following, the end coming on screen just after a scroll down of theirs: following starts
  //   again. A reply growing meanwhile does not matter; the pane's own scrolls and a taller list
  //   never count.
  stickCheck(rows, prevShown, start) {
    const same = rows === this.stickRows;
    const prevStart = this.stickStart;
    this.stickRows = rows;
    this.stickStart = start;
    if (this.view === "pinned" || this.outlined() || !rows.length) return;
    const now = Date.now();
    if (this.toBottom || now < (this.pinningUntil ?? 0)) {
      if (this.bottomShown && !this.toBottom) this.pinningUntil = 0;
      return;
    }
    const busy = Boolean(this.scrollTo) || now < (this.scrollBusyUntil ?? 0);
    if (same && prevStart != null && start !== prevStart && !busy) this.scrolledBy(start < prevStart ? 1 : -1, now);
    const up = now - (this.upAt ?? 0) < 1000;
    const down = now - (this.downAt ?? 0) < 1000;
    let step = null;
    if (this.follow && !this.bottomShown) step = up ? "unstick" : same ? null : "repin";
    else if (!this.follow && this.bottomShown && prevShown === false && !busy && down) step = "restick";
    if (step) { this.stickStep = step; this.stickyDue = true; }
  }
  // A wheel or trackpad scroll up stops following at once, so a reply that comes in during the
  // scroll does not pull the view back down. The frames catch it too (stickCheck), in case the
  // list keeps the event to itself.
  listWheel(e) {
    const dy = Number(e?.delta?.y) || 0;
    if (!dy || this.view === "pinned") return;
    // A list that fits the pane (the spacer above it) does not scroll at all.
    if (this.rowsMemo?.[0]?.kind === "spacer") return;
    this.scrolledBy(dy, Date.now());
    this.scrollSeenAt = Date.now();
    if (dy > 0 && this.follow) { this.follow = false; this.toBottom = false; this.pinningUntil = 0; }
  }
  // The person's latest scroll, by direction (dy > 0 is up); the other direction is forgotten.
  scrolledBy(dy, now) {
    this.upAt = dy > 0 ? now : 0;
    this.downAt = dy > 0 ? 0 : now;
  }
  applyStick() {
    const step = this.stickStep;
    this.stickStep = null;
    if (!step || this.view === "pinned" || this.outlined()) return;
    // A read that came in before this frame may have asked for the bottom: dropped too.
    if (step === "unstick") { this.follow = false; this.toBottom = false; this.pinningUntil = 0; }
    else if (step === "repin" && this.follow) this.toBottom = true;
    else if (step === "restick" && !this.follow) {
      // Back at the bottom by scrolling: follow again, with the newest turn selected; the view
      // is already there.
      this.follow = true;
      this.unseen = false;
      const keys = this.turnKeys(this.rows());
      if (keys.length) this.sel = keys[keys.length - 1];
    }
  }

  jumpLatest(select = true) {
    this.follow = true;
    this.stickStep = null;
    this.unseen = false;
    const keys = this.turnKeys(this.rows());
    if ((select || !this.sel) && keys.length) this.sel = keys[keys.length - 1];
    this.toBottom = true;
  }

  // ---- the outline (o) ----
  // The outline shows in the list's own view; the Pinned view keeps its cards.
  outlined() { return this.outline && this.view !== "pinned"; }

  // o: one row per turn. It opens on the selected turn (the newest when nothing is selected)
  // and remembers where the list was, so Esc goes back there. In the Pinned view of the same
  // pane it shows all turns first; the Pinned column has no outline.
  setOutline(on) {
    if (this.pinnedPane) return false;
    if (on && this.outlined()) return true;
    if (!on) { if (this.outlined()) return this.leaveOutline(null); this.outline = false; return true; }
    if (this.view === "pinned") this.setView("all");
    if (this.selecting) this.endSelect();
    this.keysOpen = false;
    this.settingsOpen = false;
    this.outlineBack = { sel: this.sel, top: this.topKey, follow: Boolean(this.follow) };
    this.outline = true;
    this.pinResume = null;
    const keys = this.turnKeys(this.rows());
    if (!this.sel || !keys.includes(this.sel)) {
      this.sel = keys[keys.length - 1] ?? null;
      this.toBottom = Boolean(this.sel);
    } else if (this.follow && this.sel === keys[keys.length - 1]) this.toBottom = true;
    else this.scrollTo = { key: this.sel, how: "center" };
    return true;
  }

  // Leaves the outline. With a turn (Enter, Space or a click on its row): the list with that
  // turn selected, open and its head at the top of the pane. Without one (Esc, o): the list
  // as it was when the outline opened.
  leaveOutline(key) {
    const back = this.outlineBack;
    this.outline = false;
    this.outlineBack = null;
    this.toBottom = false;
    if (key && this.findTurn(key)) {
      if (!this.open.has(key)) { this.open.add(key); this.makeCode(key); }
      this.sel = key;
      this.follow = false;
      this.scrollTo = { key, how: "head", until: Date.now() + 400 };
      return true;
    }
    if (back?.sel !== undefined) this.sel = back.sel;
    if (back?.follow) { this.follow = true; this.toBottom = true; return true; }
    this.follow = false;
    const k = back?.top && back.top !== "spacer" && back.top !== "gap" ? back.top : this.sel;
    if (k) this.scrollTo = { key: k, how: back?.top ? "land" : "center", or: this.sel ? [this.sel] : [], until: Date.now() + 400 };
    return true;
  }

  toggle(key, cx) {
    if (this.open.has(key)) {
      this.open.delete(key);
      this.dropCode(`${key}:`);
      if (this.selecting === key) this.endSelect();
    } else {
      this.open.add(key);
      this.makeCode(key);
    }
    this.sel = key;
    this.follow = false;
    // Opening shows the whole card when it fits (seen drawn: its chips and buttons were
    // left under the footer); closing keeps the row in view.
    this.scrollTo = { key, how: this.open.has(key) ? "card" : "top" };
    cx.notify();
  }

  // Whether the formatted reply can be selected: before Herdr 0.1.13 its Markdown view drew
  // a selection over the text, which hid it.
  replySelectable() {
    if (this.selectableMemo == null) {
      try { this.selectableMemo = atLeast(updates().app.version, "0.1.13"); } catch { this.selectableMemo = false; }
    }
    return this.selectableMemo;
  }

  // Select view: the reply as its exact Markdown source in a read-only editor. Opens the turn
  // if needed. It also works before Herdr 0.1.13, where the formatted reply cannot be selected.
  toggleSelect(key, cx) {
    if (this.selecting === key) { this.endSelect(); cx.notify(); return; }
    this.endSelect();
    const turn = this.findTurn(key);
    const text = turn ? this.replyText(turn) : "";
    if (!text) { this.say("No reply to select", "alert", cx); return; }
    let st = false;
    try {
      st = EditorState.new({
        language: "markdown", value: text.slice(0, SELECT_CHARS), readonly: true, line_numbers: false, folding: false,
        soft_wrap: true, font_family: settings().font_family, font_size: 12.5,
      });
    } catch (e) {
      console.log(`agent-threads: no editor for select: ${e?.message ?? e}`);
    }
    if (!st) { this.say("Could not open the reply for selecting", "alert", cx); return; }
    this.watchEditor(st);
    this.selEditor = { key, st, text };
    this.selecting = key;
    if (!this.open.has(key)) this.toggle(key, cx);
    this.sel = key;
    this.follow = false;
    this.scrollTo = { key: `sx:${key}`, how: "top" };
    cx.notify();
  }
  // Whether the panel itself holds the keyboard (not one of its editors), or null.
  panelFocused() { try { return Boolean(this.h.is_focused()); } catch { return null; } }
  endSelect() {
    if (this.selEditor?.st) this.selEditor.st.release();
    this.selEditor = null;
    this.selecting = null;
    this.editorFocused = false;
  }
  // Notes while one of the pane's editors (Select view, code blocks) has the keyboard, so
  // nothing takes it back mid-selection.
  watchEditor(st) {
    try {
      const n = (this.focusEvents ??= { focus: 0, blur: 0 });
      st.on("focus", () => { this.editorFocused = true; n.focus++; });
      st.on("blur", () => { this.editorFocused = false; n.blur++; });
    } catch (e) {
      console.log(`agent-threads: editor focus events: ${e?.message ?? e}`);
    }
  }

  // Makes the editors expanded() found missing or stale, outside the draw.
  // ---- pasted images ----
  // A turn's images are decoded when it is first drawn (a row with thumbnails, or an open
  // card), one prompt at a time, so the first read of a big transcript never waits on them.
  wantImages(turn, key) {
    const u = turn.imgLine;
    if (!u || !turn.images?.length) return;
    this.imgs ??= new Map();
    if (this.imgs.has(u)) return;
    const s = this.sessions[Number(String(key).split(":")[0])];
    const sid = idOf(s?.file).replace(/[^0-9A-Za-z_-]/g, "");
    if (!s?.file || !sid) { this.imgs.set(u, { st: "err" }); return; }
    this.imgs.set(u, { st: "wait" });
    (this.imgDue ??= []).push({ u, file: s.file, sid });
  }

  flushImages(cx) {
    if (this.imgBusy || !this.imgDue?.length) return;
    this.imgBusy = true;
    cx.timer.after(0, (cx) => {
      const job = this.imgDue.shift();
      if (!job) { this.imgBusy = false; return; }
      cx.spawn(async (cx) => {
        let files = null;
        try {
          const r = await exec("sh", [SCRIPT("image.sh"), job.file, job.u, `${appHome()}/${IMG_DIR}`, job.sid, harnessOfFile(job.file)]);
          if (r.code === 0) {
            const lines = r.stdout.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
              .filter((x) => x && Number.isInteger(x.i));
            // A Pi paste whose temp file is gone: the card says so instead of showing an image.
            files = [...lines.filter((x) => /^[0-9A-Za-z_-]+-\d+\.(png|jpg|gif|webp)$/.test(String(x.file)))
              .map((x) => ({ i: x.i, path: `${IMG_DIR}/${job.sid}/${x.file}`, w: Number(x.w) || 0, h: Number(x.h) || 0 })),
            ...lines.filter((x) => x.gone === true).map((x) => ({ i: x.i, gone: true }))];
          }
        } catch { files = null; }
        this.imgs.set(job.u, files?.length ? { st: "ok", files } : { st: "err" });
        this.imgBusy = false;
        this.imgVer = (this.imgVer ?? 0) + 1;
        cx.notify();
      });
    });
  }

  // The decoded file for a turn's image i ({path, w, h}), or null; whether its file is gone;
  // and the state.
  imgFile(turn, i) { return this.imgs?.get(turn.imgLine)?.files?.find((f) => f.i === i && !f.gone) ?? null; }
  imgGone(turn, i) { return Boolean(this.imgs?.get(turn.imgLine)?.files?.some((f) => f.i === i && f.gone)); }
  imgState(turn) { return this.imgs?.get(turn.imgLine)?.st ?? "wait"; }

  // The tiles over a message (ui.js tileRow): the images that fit, then "+N". Each opens the
  // review at its image.
  tileLayout(turn) { return tileRow(turn.images.map((_, i) => this.imgFile(turn, i)), this.width, this.prefs.textSize, this.chars()); }
  thumbStrip(t, turn, key) {
    this.wantImages(turn, key);
    const L = this.tileLayout(turn);
    return h_flex().h(L.size).gap(TILE_GAP).justify_end().items_center().min_w(0)
      .children(L.tiles.map(({ i, w }) => {
        const f = this.imgFile(turn, i);
        return div().flex_none().w(w).h(L.size).rounded(10).overflow_hidden().border_1().border_color(t.border).bg(t.background)
          .when(Boolean(f), (el) => el.child(image(f.path).size_full()))
          .when(!f, (el) => el.flex().items_center().justify_center().child(svg(ICON("image")).size(16).text_color(t.dim)));
      }))
      .when(L.more > 0, (el) => el.child(div().flex_none().w(44).h(L.size).rounded(10).border_1().border_color(t.border).flex().items_center().justify_center()
        .text_size(12).text_color(t.muted).child(`+${L.more}`)));
  }

  // The image a press on a row of tiles landed on, or the first one. The tiles sit on the
  // right of the card's text width. With strict, a press that misses the tiles gives null.
  tileAt(turn, strict = false) {
    const L = this.tileLayout(turn);
    const x = this.pressX;
    const w = this.bodyW ?? this.width;
    if (x == null || !(w > 0)) return L.tiles[0]?.i ?? 0;
    const left = w - ROW.PAD_X - L.width;
    const hit = L.tiles.find((c) => x >= left + c.x && x < left + c.x + c.w);
    if (hit) return hit.i;
    if (x >= left + L.width - 44 && (!strict || x < left + L.width) && L.more) return L.tiles.length;
    return strict ? null : L.tiles[0]?.i ?? 0;
  }

  flushCode(cx) {
    if (!this.codeDue?.size || this.codeTick) return;
    this.codeTick = true;
    cx.timer.after(0, (cx) => {
      this.codeTick = false;
      const keys = [...this.codeDue];
      this.codeDue.clear();
      for (const k of keys) if (this.open.has(k)) this.makeCode(k);
      cx.notify();
    });
  }

  // Releases the code editors whose key starts with prefix (all of them when no prefix).
  dropCode(prefix = "") {
    for (const [k, c] of this.code ?? []) if (k.startsWith(prefix)) { if (c.st) c.st.release(); this.code.delete(k); this.editorFocused = false; }
  }

  // Read-only editors for an open turn's code blocks. An editor is made again when its
  // block's text changed (a running turn's interim reply, a replaced file), and editors
  // for blocks the reply no longer has are released.
  makeCode(key) {
    const turn = this.findTurn(key);
    if (!turn) return;
    const t = theme();
    const segs = segments(this.replyText(turn));
    for (const [k, c] of this.code) {
      if (!k.startsWith(`${key}:`)) continue;
      const seg = segs[Number(k.slice(key.length + 1))];
      if (seg?.kind !== "code" || seg.text !== c.text) { if (c.st) c.st.release(); this.code.delete(k); }
    }
    segs.forEach((seg, i) => {
      if (seg.kind !== "code" || this.code.has(`${key}:${i}`)) return;
      let st = false;
      try {
        st = EditorState.new({
          language: langFor(seg.lang), value: seg.text, readonly: true, line_numbers: false, folding: false, soft_wrap: true,
          font_family: settings().font_family, font_size: 12,
          syntax: {
            keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1,
            constant: t.ansi6, boolean: t.ansi1, operator: t.muted, punctuation: t.dim, variable: t.foreground, "string.escape": t.ansi6,
          },
        });
      } catch (e) {
        // A highlighter that fails shows the block as plain text.
        console.log(`agent-threads: no editor for ${seg.lang || "plain"}: ${e?.message ?? e}`);
      }
      if (st) this.watchEditor(st);
      this.code.set(`${key}:${i}`, { st, text: seg.text });
      if (this.debug) (this.codeInfo ??= new Map()).set(`${key}:${i}`, `${seg.lang || "-"}>${langFor(seg.lang)}:${st ? "editor" : "plain"}`);
    });
  }

  // Copy reply, a code block's Copy, Copy path. A clipboard write that throws says so and
  // marks nothing copied.
  copy(text, id, label, cx) {
    try {
      cx.write_to_clipboard(text);
    } catch (e) {
      console.log(`agent-threads: clipboard write failed: ${e?.message ?? e}`);
      this.copied = null;
      this.say("Couldn't copy", "circle-x", cx);
      return false;
    }
    this.clipAtPress = null;
    const at = this.say(label, "check", cx);
    this.copied = { id, at };
    return true;
  }

  // A toast above the footer for ms (2 s by default). Returns its time, which names it.
  say(text, icon, cx, ms = 2000) {
    const at = Date.now() + Math.random();
    this.toast = { text, icon, at };
    cx.timer.after(ms, (cx) => {
      if (this.copied?.at === at) this.copied = null;
      if (this.toast?.at === at) this.toast = null;
      cx.notify();
    });
    cx.notify();
    return at;
  }

  copyReply(key, cx) {
    const turn = this.findTurn(key);
    // Only a turn the list shows: a selection left on a hidden turn copies nothing.
    if (!turn || !this.turnKeys(this.rows()).includes(key)) return;
    const text = this.replyText(turn);
    if (!text) return;
    this.copy(text, `reply:${key}`, `Reply copied · ${text.length.toLocaleString()} chars, Markdown`, cx);
  }

  // The copy icon under a message: the prompt as the person wrote it.
  copyPrompt(key, cx) {
    const turn = this.findTurn(key);
    if (!turn || !this.turnKeys(this.rows()).includes(key)) return;
    const text = turn.prompt ?? "";
    if (!text) return;
    this.copy(text, `prompt:${key}`, `Prompt copied · ${text.length.toLocaleString()} chars`, cx);
  }

  // ---- quoting a reply into the terminal (the one write: RECIPE.md, How it behaves) ----

  // What is quoted for the turn: in Select view, or after ⌘C on the formatted reply, what ⌘C
  // copied, only when it is part of this reply (so text from anywhere else is never pasted);
  // otherwise the whole reply as Markdown source. { text, source } or { refuse, source, why }. In Select view a press means
  // the highlight, so it never falls back to the whole reply: when the clipboard holds
  // nothing from this reply, the quote says how instead.
  quoteSource(key, cx) {
    const turn = key ? this.findTurn(key) : null;
    const reply = turn && this.turnKeys(this.rows()).includes(key) ? this.replyText(turn) : "";
    if (!reply) return { refuse: "No reply to quote." };
    if (this.selecting === key) {
      const clip = readClip(cx);
      if (clip.trim() && inReply(clip, reply)) return { text: clip, source: "selection" };
      return { refuse: `Couldn't read the highlight, press ⌘C then ${this.quoteKey}`, source: "selection", why: clip.trim() ? "notInReply" : "empty" };
    }
    const part = this.copiedPart(cx);
    if (part?.key === key) return { text: part.text, source: "selection" };
    return { text: reply, source: "reply" };
  }

  // After ⌘C in Select view, once the editor's copy has run: when the clipboard holds text
  // from this reply, a toast says q quotes it. Never the text itself in the record.
  sawCopy(key, cx) {
    cx.timer.after(60, (cx) => {
      if (this.selecting !== key) return;
      const turn = this.findTurn(key);
      const clip = readClip(cx);
      const ok = Boolean(turn && clip.trim() && inReply(clip, this.replyText(turn)));
      this.selectCopy = { at: Date.now(), ok, chars: clip.length };
      if (ok) {
        const words = clip.trim().split(/\s+/).length;
        this.say(`Copied ${plural(words, "word")} · ${this.quoteKey} quotes ${words === 1 ? "it" : "them"}`, "copy", cx, 2500);
      }
      cx.notify();
    });
  }

  // ---- what ⌘C copied from the formatted reply ----
  // A mod cannot read a highlight, and it never sees ⌘C once Herdr's copy action has handled
  // it. So the clipboard is noted at each press in the list: text that arrived after the press
  // and comes from an open reply is what ⌘C copied, and q quotes it.
  // How far the pointer has gone from the last press, in window px. The list's click
  // arrives on the release, so a drag that selected text arrives as a click too.
  notePointer(at, cx) {
    if (!this.pressAt || !at) return;
    this.pressMoved = Math.max(this.pressMoved ?? 0, Math.hypot(at.x - this.pressAt.x, at.y - this.pressAt.y));
    if (cx && this.selectGesture()) this.liftFill(this.sel, cx);
  }
  // Herdr paints a text selection under the text in the theme's selection colour, which a
  // mod cannot change. On the selected turn's fill it is hard to see (graphite: #394454 on
  // the fill is 1.4:1, on the background 1.8:1, as in a terminal; paper: 1.2:1 and 1.4:1). So
  // while you select text in a turn, its card drops the fill and keeps the bar on the left,
  // until a click that does not move or a key that moves on.
  liftFill(key, cx) {
    if (!key || this.textSel === key || !this.replySelectable()) return;
    this.textSel = key;
    cx?.notify();
  }
  // A press that moved more than DRAG_SLOP design px before its release, or a double or
  // triple press (a word or a paragraph selected), is a selection, not a click.
  selectGesture() {
    return (this.pressMoved ?? 0) > DRAG_SLOP * this.zoom() || (this.pressCount ?? 1) > 1;
  }

  notePress(cx) {
    this.clipBefore = this.clipAtPress;
    this.clipAtPress = readClip(cx);
  }
  // { key, text } when the clipboard holds text copied since the last press, or null.
  copiedPart(cx) {
    if (this.clipAtPress == null || !this.replySelectable()) return null;
    const clip = readClip(cx);
    if (!clip.trim() || clip === this.clipAtPress) return null;
    const keys = [...new Set([this.sel, ...this.open])].filter(Boolean);
    const key = keys.find((k) => {
      const turn = /^\d+:\d+$/.test(k) ? this.findTurn(k) : null;
      return turn && (inReply(clip, this.replyText(turn)) || inReply(clip, turn.latest ?? ""));
    });
    return key ? { key, text: clip } : null;
  }
  // ⌘ released: the one moment after ⌘C that reaches the panel. Says once that q quotes it.
  cmdUp(e, cx) {
    if (e?.modifiers?.platform) return;
    if (this.selecting) {
      const clip = readClip(cx);
      if (clip !== this.toldPart) { this.toldPart = clip; this.sawCopy(this.selecting, cx); }
      return;
    }
    cx.timer.after(60, (cx) => {
      const part = this.copiedPart(cx);
      if (!part || part.text === this.toldPart) return;
      this.toldPart = part.text;
      this.sel = part.key;
      const words = part.text.trim().split(/\s+/).length;
      this.say(`Copied ${plural(words, "word")} · ${this.quoteKey} quotes ${words === 1 ? "it" : "them"}`, "copy", cx, 2500);
      cx.notify();
    });
  }

  // A quote press (the quote key, the Quote button, or debugQuote in tests). Returns false
  // when it did nothing, so the key can reach Herdr. Key repeat is ignored by the caller,
  // and a second press within 1 s does nothing.
  quote(cx, via, key = this.selecting ?? this.copiedPart(cx)?.key ?? this.sel) {
    if (this.settingsOpen || this.choosing) return false;
    const at = Date.now();
    if (this.quoteAt && at - this.quoteAt < 1000) return true;
    this.quoteAt = at;
    // Select view: a mod cannot read the editor's selection or make it copy (EditorState has
    // no selection; window.dispatch_action and cx.bind_keys reach only the shell's own named
    // actions, never the editor's input::Copy). So ⌘C copies the highlight and q quotes
    // what it copied.
    const k = this.quoteKey;
    const q = this.quoteSource(key, cx);
    // Kept for the debug report and, with no text in it, in shared("threads.lastQuote") on
    // every build, so a quote that went wrong can be told apart afterwards.
    const record = (x) => {
      this.lastQuote = { at, via, terminal: this.terminal, selectView: this.selecting === key, copiedInSelect: this.selectCopy ?? null, ...x };
      try { setShared("threads.lastQuote", this.lastQuote); } catch { /* the report still has it */ }
    };
    const out = q.refuse ? null : quoteText(q.text);
    if (!out) {
      record({ source: q.source ?? null, gate: q.why ? "nohighlight" : q.refuse ? "nothing" : "empty", why: q.why ?? null, pasted: false, toast: q.refuse ?? null });
      this.say(q.refuse ?? "No reply to quote.", "alert", cx, q.why ? 3500 : undefined);
      cx.notify();
      return true;
    }
    const t4 = this.terminal;
    cx.spawn(async (cx) => {
      // Checked at the press: the terminal, its pane in this tab, and what runs in it now.
      const term = this.term();
      const remote = t4.includes("/");
      const pane = focusTarget(panes(), t4, this.me()?.tab ?? null);
      let info = {};
      if (term && !remote) { try { info = JSON.parse((await hc(["get", t4, "--json"])).stdout); } catch { /* checked below */ } }
      const p = this.pane();
      const me = this.me();
      const gate = canQuote({
        panelOpen: this.settingsOpen || this.choosing, remote, exists: Boolean(this.term()), ended: this.res.ended,
        pane: Boolean(pane), moved: Boolean(me && p && p.tab !== me.tab), fg: foreground(info, p), status: this.status(),
      });
      const base = { source: q.source, lines: out.lines, capped: out.capped, cut: out.cut, chars: out.text.length, gate: gate.ok ? (gate.busy ? "busy" : "ok") : gate.why };
      if (!gate.ok) {
        if (gate.why === "panel") { record({ ...base, pasted: false }); return; }
        cx.write_to_clipboard(out.text);
        this.clipAtPress = null;
        const agent = this.agent();
        const why = {
          blocked: `${agent.short} is waiting on a prompt in ${t4}. Quote copied.`, shell: `${t4} is at a shell. Quote copied.`,
          other: `${t4} is not running ${agent.cmd}. Quote copied.`, closed: `${t4} is closed. Quote copied.`,
          exited: `${agent.cmd} exited in ${t4}. Quote copied.`, moved: `${t4} is in another tab. Quote copied.`,
          remote: "Remote terminal. Quote copied.", nopane: "No terminal for this pane. Quote copied.",
        }[gate.why] ?? "Quote copied.";
        record({ ...base, pasted: false, toast: why });
        this.say(why, "alert", cx, 3000);
        cx.notify();
        return;
      }
      this.quoteToTerminal(quotePaste(this.agent().key, out.text), pane.pane, cx, (r) => {
        const folds = out.text.length > 800 || (out.text.match(/\n/g) ?? []).length > 2;
        let text;
        if (!r.pasted) text = `Could not focus ${t4}. Quote copied.`;
        else if (gate.busy) text = `Quoted into ${t4} · ${this.agent().short} will queue it`;
        else if (out.cut === "lines") text = `Quoted the first ${out.lines - 1} lines into ${t4}`;
        else if (out.cut === "chars") text = `Quoted the start into ${t4} · cut at 2,000 characters`;
        else if (q.source === "selection") text = `Quoted your selection into ${t4}`;
        else text = `Quoted ${plural(out.lines, "line")} into ${t4}`;
        // Claude Code folds a long paste, and a second paste opens it.
        if (r.pasted && folds && this.agent().key === "claude") text += " · ⌘V again shows it in full";
        if (r.pasted && !this.quotedOnce) { this.quotedOnce = true; text += " · focus is in the terminal"; }
        record({ ...base, focusOk: r.focusOk, tries: r.tries, pasted: r.pasted, folds, key: k, toast: text });
        this.say(text, r.pasted ? "quote" : "alert", cx, gate.busy || !r.pasted ? 3000 : 2500);
        cx.notify();
      });
    });
    return true;
  }

  // The one write into a terminal. The quote goes on the clipboard, the bound terminal's
  // pane takes the keyboard, and Herdr's paste command (⌘V) pastes it: a bracketed paste,
  // so its newlines are text, and nothing presses Enter after it. The paste runs only once
  // the keyboard is on the bound terminal (checked on this tick, then up to three times
  // 40 ms apart). The clipboard keeps the quote afterwards: putting the old text back
  // could race the paste and send that instead.
  quoteToTerminal(text, pane, cx, done) {
    cx.write_to_clipboard(text);
    this.clipAtPress = null;
    run("pane.focus", { pane });
    let tries = 0;
    const step = (cx) => {
      const ok = focused()?.terminal === this.terminal;
      if (!ok && ++tries <= 3) { cx.timer.after(40, step); return; }
      if (ok) run("terminal.paste");
      done({ focusOk: ok, pasted: ok, tries });
    };
    step(cx);
  }

  // ---- link rules ----

  // The repo link rules may use ({repo}, {owner}): the terminal's git remote origin, looked
  // up once per terminal and folder, outside the draw, and only when a rule uses it.
  lookRepo(cx) {
    if (!this.links.some((r) => r.repo)) return;
    const cwd = this.res.cwd ?? this.pane()?.cwd ?? this.term()?.cwd ?? null;
    const key = `${this.terminal}|${cwd}`;
    if (this.remote.key === key || this.repoLooking) return;
    if (this.terminal.includes("/")) { this.remote = { key, repo: null, owner: null, why: "remote terminal" }; return; }
    if (!cwd) { this.remote = { key, repo: null, owner: null, why: "the terminal reports no folder" }; return; }
    this.repoLooking = true;
    cx.spawn(async (cx) => {
      const r = await exec("git", ["-C", cwd, "remote", "get-url", "origin"]).catch(() => null);
      this.repoLooking = false;
      const p = r && r.code === 0 ? parseRemote(r.stdout) : null;
      this.remote = { key, repo: p?.repo ?? null, owner: p?.owner ?? null, why: p ? `origin on ${p.host}` : r?.code === 0 ? "origin is not a repo URL" : "no git remote origin" };
      cx.notify();
    });
  }

  // Link rules on a reply's prose segments, kept per turn until the reply, the rules or the
  // repo change. The caps (20,000 characters, 25 links) are for the whole reply.
  linkedSegs(key, segs) {
    if (!this.links.length) return null;
    const sig = `${this.linksVer}|${this.remote.repo ?? ""}|${segs.map((x) => `${x.kind}${x.text.length}`).join(",")}`;
    const memo = (this.linkMemo ??= new Map());
    const m = memo.get(key);
    if (m?.sig === sig) return m.out;
    const ctx = { repo: this.remote.repo, owner: this.remote.owner };
    let chars = 20000;
    let matches = 25;
    const out = segs.map((seg) => {
      if (seg.kind !== "md" || chars <= 0 || matches <= 0) { chars -= seg.text.length; return seg.kind === "md" ? { md: seg.text, links: 0 } : null; }
      const r = linkify(seg.text, this.links, ctx, { maxChars: chars, maxMatches: matches });
      chars -= seg.text.length;
      matches -= r.links;
      return r;
    });
    if (memo.size > 200) memo.clear();
    memo.set(key, { sig, out });
    return out;
  }
  // An interim text with the link rules applied, kept for the step until the rules or the
  // repo change. Every rebuild of the rows asks for each step of every open turn, and the
  // rules run a set of patterns over the text: for hundreds of steps that ran past Herdr's
  // time for a draw ("This view could not be re-rendered", interrupted). New texts share the
  // reshaping time (SHAPE_MS): past it a text shows as written, and the next frame links it.
  // Link rules lengthen the text; past 4,000 characters it stays as written, since Herdr
  // draws nothing for Markdown over 4,096.
  stepLinks(st) {
    const ver = `${this.linksVer}|${this.links.length}|${this.remote.repo ?? ""}|${this.remote.owner ?? ""}`;
    this.stepLinked ??= new WeakMap();
    const known = this.stepLinked.get(st);
    if (known?.ver === ver) return known.lk;
    if ((this.shapeSpent ?? 0) > (this.shapeBudget ?? SHAPE_MS)) {
      this.shapeLeft = (this.shapeLeft ?? 0) + 1;
      return { md: st.t, links: 0 };
    }
    const t0 = now();
    const linked = this.linkOne(st.t);
    const lk = linked.md.length <= 4000 ? { md: linked.md, links: linked.links } : { md: st.t, links: 0 };
    this.stepLinked.set(st, { ver, lk });
    this.shapeSpent = (this.shapeSpent ?? 0) + (now() - t0);
    return lk;
  }
  linkOne(md) { return this.links.length ? linkify(md, this.links, { repo: this.remote.repo, owner: this.remote.owner }) : { md, links: 0 }; }

  // Focuses the terminal this pane reads, by its pane id: pane.focus {terminal} prefers the
  // first layout block that shows the terminal, which can be another pane than the one
  // beside Threads. Says what it did. It cannot scroll the terminal to a turn.
  focusTerminal(cx) {
    const at = Date.now();
    const term = this.term();
    if (!term) {
      this.lastFocus = { args: null, terminal: this.terminal, at, result: "closed" };
      if (cx) this.say(`${this.terminal} is closed`, "circle-x", cx);
      return;
    }
    const myTab = this.me()?.tab ?? null;
    const target = focusTarget(panes(), this.terminal, myTab);
    const args = target ? { pane: target.pane } : { terminal: this.terminal };
    run("pane.focus", args);
    const name = this.pane()?.program?.name ?? term.name ?? (this.res.claude || this.res.harness ? this.agent().cmd : "");
    let text = `Focused ${this.terminal}${name ? ` · ${name}` : ""}`;
    if (target && myTab && target.tab !== myTab) {
      const tab = spaces().flatMap((x) => x.tabs).find((x) => x.id === target.tab);
      text = `Focused ${this.terminal} · moved to tab "${tab?.name ?? "?"}"`;
    }
    this.lastFocus = { args, terminal: this.terminal, at, myTab, targetTab: target?.tab ?? null, text };
    if (cx) this.say(text, "square-terminal", cx);
  }

  click(key, cx) {
    const [kind, ...rest] = key.split(":");
    const id = rest.join(":");
    // A press in the Select view's editor or a code block's editor belongs to that editor:
    // taking the keyboard back here would blur it and clear the selection the person just
    // made. The card is still selected (c, q and s act on it), with a redraw only when the
    // selection moved. A code block drawn as plain text (no editor: its highlighter failed)
    // has nothing to keep the keyboard, so the panel takes it as for any other part (F6).
    if (kind === "sx" || kind === "code") {
      const turnKey = rest.slice(0, 2).join(":");
      const hasEditor = kind === "sx" ? Boolean(this.selEditor?.st) : Boolean(this.code.get(id)?.st);
      if (hasEditor) {
        if (this.sel !== turnKey) { this.sel = turnKey; cx.notify(); }
        return;
      }
    }
    // A drag that selected text, or a double or triple press, never opens, closes, expands
    // or collapses anything and never presses a button: the release lands on whatever item
    // is under the pointer, often a card's head, Collapse or an update's own toggle. The
    // turn is still selected, so c, q and s act on it. Only a press that did not move clicks.
    if (this.selectGesture()) {
      this.toList();
      const turnKey = /^\d+$/.test(kind) ? key : rest.slice(0, 2).join(":");
      if (this.findTurn(turnKey)) { this.sel = turnKey; this.liftFill(turnKey); }
      return cx.notify();
    }
    // A plain click clears Herdr's text selection, so the fill comes back.
    this.textSel = null;
    // Quote in the action bar in Select view: quote what ⌘C copied, and leave the keyboard
    // with the editor so its highlight stays.
    if (kind === "resume") {
      this.toList();
      this.sel = id;
      this.pinResume = null;
      this.scrollTo = { key: id, how: "head" };
      return cx.notify();
    }
    if (kind === "cp") this.clipAtPress = this.clipBefore;
    if (kind === "cp" && this.selecting === id) {
      const hit = this.barHit(this.pressX ?? this.mouseX, this.findTurn(id));
      if (hit === "quote") { this.pressX = null; this.lastBarHit = { hit }; this.quote(cx, "button", id); return cx.notify(); }
    }
    // The panel has the keyboard again, even if an editor's blur event was missed. A search
    // stays, and its field gives up the keys.
    this.toList();
    if (/^\d+$/.test(kind)) {
      if (this.outlined()) { this.leaveOutline(key); return cx.notify(); }
      return this.toggle(key, cx);
    }
    // A click on an image in an open card shows it at the card's full width, or back.
    if (kind === "pins" && /^\d+$/.test(id)) {
      const p = this.pinnedList()[Number(id)];
      if (p && !p.turn && p.state === "gone") { this.unpin(p, cx); return cx.notify(); }
      return;
    }
    if (kind === "imgs") {
      // A tile opens the review at its image, on any turn: at rest, open or running. It
      // selects the turn and changes nothing else, so the list is as it was when the review
      // closes. "+N" opens the first image the tiles leave out. A press beside the tiles on a
      // closed turn opens it, as a press on the rest of its row does; on a running or open
      // turn it selects it. A missing image takes no click.
      const turn = this.findTurn(id);
      if (!turn?.images?.length) return;
      const i = this.tileAt(turn, true);
      this.pressX = null;
      this.sel = id;
      if (i != null && this.openGallery(turn, Math.min(i, turn.images.length - 1))) return cx.notify();
      if (i == null && !this.open.has(id) && this.baseRows?.some((r) => r.key === id && r.kind === "turn")) return this.toggle(id, cx);
      return cx.notify();
    }
    if (kind === "you") { this.full.has(id) ? this.full.delete(id) : this.full.add(id); this.sel = id; return cx.notify(); }
    // Collapse closes the turn and lands on its row, as Esc does.
    if (kind === "fold") { if (this.open.has(id)) this.toggle(id, cx); else this.sel = id; return cx.notify(); }
    if (kind === "lt") {
      if (!this.findTurn(id)) return;
      const k = `l:${id}`;
      const part = this.baseRows?.find((r) => r.key === key);
      if (this.full.has(k)) this.full.delete(k);
      else if (part && this.latestCut(part)) this.full.add(k);
      this.sel = id;
      return cx.notify();
    }
    if (kind === "cp") {
      // The strip under the reply is one list item. A list item takes one click handler, so
      // the press position tells its icons apart. A press beside them selects the turn. The
      // icons show while the pointer is on the strip, so a press on one acts on any turn.
      const x = this.pressX ?? this.mouseX;
      const w = this.bodyW ?? this.width;
      this.pressX = null;
      const hit = this.barHit(x, this.findTurn(id));
      this.lastBarHit = { x: x == null ? null : Math.round(x), w: Math.round(w), hit };
      this.sel = id;
      if (hit === "terminal" && this.pane()) return this.focusTerminal(cx);
      if (hit === "copy") return this.copyReply(id, cx);
      if (hit === "select") return this.toggleSelect(id, cx);
      if (hit === "quote") { this.quote(cx, "button", id); return cx.notify(); }
      return cx.notify();
    }
    if (kind === "us") {
      // The strip under an open turn's message: copy the prompt, or pin, by press position.
      const x = this.pressX ?? this.mouseX;
      const w = this.bodyW ?? this.width;
      this.pressX = null;
      const turn = this.findTurn(id);
      this.sel = id;
      const text = turn ? this.stripText(turn, true) : "";
      const hit = text ? boxHit(stripLayout(w, text, !turn.agent), x, ["copy", "pin"]) : null;
      this.lastBarHit = { x: x == null ? null : Math.round(x), w: Math.round(w), hit, strip: "you" };
      if (hit === "copy") return this.copyPrompt(id, cx);
      if (hit === "pin") { this.togglePin(id, cx); return cx.notify(); }
      return cx.notify();
    }
    // Before Herdr 0.1.13 the formatted reply cannot be selected: say once per pane how to
    // select its text.
    if (kind === "md" && !this.replySelectable() && !this.selectTold) { this.selectTold = true; this.say("Press s to select text in this reply", "text-cursor", cx, 3000); }
    if (kind === "cc") {
      const [si, n, i] = id.split(":");
      const ct = this.findTurn(`${si}:${n}`);
      const seg = ct ? segments(this.replyText(ct))[Number(i)] : null;
      if (seg) this.copy(seg.text, `code:${id}`, `Code copied · ${plural(seg.text.split("\n").length, "line")}`, cx);
      return;
    }
    // The stats part ends in an info icon: a click on it shows or hides what the figures mean.
    if (kind === "st") { this.legendOn = !this.legendOn; this.sel = id; return cx.notify(); }
    // A click on the line opens it to level 1, or closes it.
    if (kind === "rhead") { this.toggleLine(id); this.sel = id; return cx.notify(); }
    // A click on a step group's line opens it to its calls (level 2), or closes it.
    if (kind === "gp") {
      const g = `${rest.slice(0, 2).join(":")}:${rest[2]}`;
      if (this.groupOpen.has(g)) this.groupOpen.delete(g); else this.groupOpen.add(g);
      this.sel = rest.slice(0, 2).join(":");
      return cx.notify();
    }
    // A click on a call opens its output (level 3), or closes it, where its calls are read.
    if (kind === "cl" && rest[3] !== "more") {
      const tk = rest.slice(0, 2).join(":");
      const st = this.findTurn(tk)?.steps?.[Number(rest[2])];
      if (st?.ids?.[Number(rest[3])] && this.readsCalls(Number(rest[0]), st)) this.toggleCall(rest.slice(0, 4).join(":"));
      this.sel = tk;
      return cx.notify();
    }
    // A click on an output box shows all its lines, or the first ones again.
    if (kind === "co") {
      const c = rest.slice(0, 4).join(":");
      if (this.callAll.has(c)) this.callAll.delete(c); else this.callAll.add(c);
      this.sel = rest.slice(0, 2).join(":");
      return cx.notify();
    }
    if (["md", "nr", "code", "lh", "sx", "lg", "it", "cl", "ws"].includes(kind)) { this.sel = rest.slice(0, 2).join(":"); return cx.notify(); }
  }

  // The icons of the strip under a reply, from the left edge of the list (ui.js actsLayout).
  // Quote shows when a pane shows a terminal on this computer and the turn has a reply;
  // Terminal when a pane shows the terminal.
  acts(turn) {
    const pane = Boolean(this.pane());
    const quote = pane && !this.terminal.includes("/") && Boolean(turn && this.replyText(turn));
    return actsLayout({ quote, terminal: pane });
  }
  barGeom(turn = this.sel ? this.findTurn(this.sel) : null) { return this.acts(turn); }
  barHit(x, turn = this.sel ? this.findTurn(this.sel) : null) {
    if (x == null) return "copy"; // a keyboard or synthetic press
    return boxHit(this.acts(turn), x, ["copy", "quote", "select", "terminal"]);
  }

  // Keys while the panel has the keyboard. The same actions are commands for keys.json
  // ("agent-threads.next" and so on), delivered through nextCommand().
  key(e, cx) {
    // ⌘C in Select view: the editor copies the highlight with its own binding, and the
    // panel says that q now quotes it.
    if (this.selecting && e.keystroke === "cmd-c") this.sawCopy(this.selecting, cx);
    const name = keyAction(e, this.filtering || this.naming, this.quoteKey);
    // In the name field Esc gives the keyboard back to the list; other keys type.
    if (this.naming) {
      if (name !== "escape") return;
      this.endNaming(cx);
      this.h.focus();
      cx.stop_propagation();
      return true;
    }
    // While the Select view's or a code block's editor has the keyboard, its keys are its
    // own (moving the turn selection would leave the text being selected).
    // Esc, s and the quote key still act, and pin keys, which those read-only editors have
    // no use for: the moment to pin can be right after clicking into a code block.
    const pinKey = name === "pin" || name === "undoUnpin" || name?.startsWith("go:");
    if (this.editorFocused && name && !pinKey && !["escape", "select", "quote"].includes(name)) return;
    if (pinKey && e.is_held) { cx.stop_propagation(); return; }
    // The quote key is handled here and never through action(), so no mod command (and so
    // no script with herdr-app do) can fire the one write into a terminal.
    if (name === "quote") {
      if (e.is_held) { cx.stop_propagation(); return; }
      if (this.quote(cx, "key") === false) return;
      cx.stop_propagation();
      cx.notify();
      return;
    }
    if (!name || !this.action(name, cx)) return;
    cx.stop_propagation();
    cx.notify();
  }

  // Returns false when the action did nothing (so Escape can reach Herdr).
  action(name, cx) {
    this.stickStep = null; // a key decides, not a frame drawn before it
    if (this.textSel && !["copy", "quote", "keys"].includes(name)) this.textSel = null;
    const rows = this.rows();
    const keys = this.turnKeys(rows);
    const at = keys.indexOf(this.sel);
    const go = (i) => {
      if (!keys.length) return;
      this.sel = keys[Math.max(0, Math.min(keys.length - 1, i))];
      this.follow = this.sel === keys[keys.length - 1];
      this.scrollTo = { key: this.sel, how: "center" };
    };
    switch (name) {
      case "prev": go(at < 0 ? keys.length - 1 : at - 1); return true;
      case "next": go(at < 0 ? keys.length - 1 : at + 1); return true;
      case "first": go(0); return true;
      case "latest": this.jumpLatest(true); return true;
      case "open":
        // Enter in a "#12" jump: keep the turn selected and leave the field.
        if (jumpTarget(this.query) != null) { this.input.set_value(""); this.query = ""; this.filtering = false; this.h.focus(); return true; }
        // A search: Enter also hands the keys to the list, so p and the digits work on a result.
        if (this.filtering && this.query) this.toList();
        // In the outline: the list, with this turn open at its head.
        if (this.outlined()) return this.leaveOutline(this.sel && keys.includes(this.sel) ? this.sel : null);
        // In the Pinned view a closed pin opens at its place, as its number key does.
        if (this.view === "pinned" && this.sel && !this.open.has(this.sel)) {
          const i = this.pinnedList().findIndex((p) => p.key === this.sel);
          if (i >= 0) return this.goPin(i, cx);
        }
        if (this.sel && keys.includes(this.sel)) this.toggle(this.sel, cx);
        return true;
      case "jump": this.filtering = true; this.input.set_value("#"); this.query = "#"; this.input.focus(); return true;
      case "prevDay": case "nextDay": {
        const k = this.dayStep(name === "nextDay" ? 1 : -1);
        if (!k) return false;
        this.sel = k;
        this.follow = k === keys[keys.length - 1];
        this.scrollTo = { key: k, how: "top" };
        return true;
      }
      case "outline": return this.setOutline(!this.outlined());
      case "outline:on": return this.setOutline(true);
      case "outline:off": return this.setOutline(false);
      case "pin": if (this.sel) this.togglePin(this.sel, cx); return true;
      case "undoUnpin": return this.undoUnpin(cx);
      case "pinned": return this.openPinned(cx);
      case "narrower": return this.resizeColumn(-PIN_STEP, cx);
      case "wider": return this.resizeColumn(PIN_STEP, cx);
      case "fit": return this.fitToReading(cx);
      case "keepWidth": this.changePrefs({ readingWidth: !this.prefs.readingWidth }, cx); this.capAsked = null; return true;
      case "alwaysTime": this.changePrefs({ alwaysShowTime: !this.prefs.alwaysShowTime }, cx); return true;
      case "copy": if (this.sel) this.copyReply(this.sel, cx); return true;
      case "select": {
        // In Select view, s returns to the formatted reply of the turn being selected, even
        // after the selection moved to another turn.
        if (this.selecting) { this.endSelect(); return true; }
        if (this.outlined()) { this.outline = false; this.outlineBack = null; }
        if (this.sel && this.findTurn(this.sel)) this.toggleSelect(this.sel, cx);
        return true;
      }
      case "focus": this.focusTerminal(cx); return true;
      // What the stat chips mean, under every open card's stats, for this pane's session.
      case "legend": {
        // i shows what the numbers mean, opening the selected turn and its line first.
        this.legendOn = !this.legendOn;
        const k = this.sel;
        if (this.legendOn && k && this.findTurn(k) && !this.isLiveKey(k)) {
          if (!this.open.has(k)) this.toggle(k, cx);
          this.lineOpen.add(k);
          this.lineTouched.add(k);
        }
        return true;
      }
      case "deeper": return this.deeper(cx);
      case "shallower": return this.shallower(cx);
      case "filter": this.filtering = true; this.settingsOpen = false; this.input.focus(); return true;
      case "agents": this.setAgents(!this.prefs.agentTurns, cx); return true;
      case "agents:on": this.setAgents(true, cx); return true;
      case "agents:off": this.setAgents(false, cx); return true;
      case "settings": this.settingsOpen = !this.settingsOpen; if (this.settingsOpen) { this.filtering = false; this.keysOpen = false; } return true;
      case "keys": this.keysOpen = !this.keysOpen; if (this.keysOpen) this.settingsOpen = false; return true;
      case "resetSettings": this.changePrefs({ textSize: DEFAULTS.textSize, width: DEFAULTS.width, promptLines: DEFAULTS.promptLines, replyLines: DEFAULTS.replyLines, bubbleColor: DEFAULTS.bubbleColor, agentBubbleColor: DEFAULTS.agentBubbleColor, youName: DEFAULTS.youName, alwaysShowTime: DEFAULTS.alwaysShowTime }, cx); return true;
      case "escape":
        if (this.keysOpen) { this.keysOpen = false; return true; }
        if (this.settingsOpen) { this.settingsOpen = false; return true; }
        if (this.choosing) { this.choosing = false; return true; }
        if (this.selecting) { this.endSelect(); return true; }
        if (this.filtering || this.query) { this.input.set_value(""); this.query = ""; this.filtering = false; this.h.focus(); return true; }
        if (this.outlined()) return this.leaveOutline(null);
        if (this.sel && this.open.has(this.sel)) { this.toggle(this.sel, cx); return true; }
        if (this.view === "pinned" && !this.pinnedPane) { this.setView("all"); return true; }
        return false;
    }
    if (name.startsWith("go:")) {
      this.editorFocused = false;
      this.h.focus();
      // A pin opens in the list, at its place, so the outline gives way.
      if (this.outlined() && this.pinnedList()[Number(name.slice(3)) - 1]?.turn) { this.outline = false; this.outlineBack = null; }
      return this.goPin(Number(name.slice(3)) - 1, cx);
    }
    if (name === "choose") {
      const list = this.res.choices ?? [];
      if (list.length < 2) return false;
      this.choices = list;
      this.choosing = true;
      return true;
    }
    if (name.startsWith("pick:")) {
      const c = (this.choosing ? this.choices : null)?.[Number(name.slice(5)) - 1];
      if (!c) return false;
      this.pick(c, cx);
      return true;
    }
    // "width:wide": the reading width (settings width), for every pane.
    if (name.startsWith("width:")) return this.chooseWidth(name.slice(6), cx);
    // "youName:Sam": the name over the person's messages; an empty one is the default.
    if (name.startsWith("youName:")) {
      this.changePrefs({ youName: nameValue(name.slice(8)) ?? DEFAULTS.youName }, cx);
      return true;
    }
    // "bubbleColor:teal", "agentBubbleColor:#715C91": a preset name or #rrggbb.
    const bc = name.match(/^(bubbleColor|agentBubbleColor):(.+)$/);
    if (bc) {
      const v = bubbleValue(bc[2]);
      if (v == null) return false;
      this.changePrefs({ [bc[1]]: v }, cx);
      return true;
    }
    // "promptLines:+", "replyLines:-", "promptLines:4", "textSize:15".
    const m = name.match(/^(textSize|promptLines|replyLines):([+-]|\d+)$/);
    if (m) {
      const [lo, hi] = RANGES[m[1]];
      const cur = this.prefs[m[1]];
      const v = m[2] === "+" ? cur + 1 : m[2] === "-" ? cur - 1 : Number(m[2]);
      if (v < lo || v > hi) return false;
      this.changePrefs({ [m[1]]: v }, cx);
      return true;
    }
    // Tests only: "debugWidth:240" lays the pane out for that width.
    if (this.debug && /^debugWidth:\d+$/.test(name)) { this.forcedWidth = Number(name.slice(11)); this.width = this.forcedWidth; return true; }
    // Tests only: the selected turn as it looks while you select text in it.
    if (this.debug && name === "debugLift") { this.liftFill(this.sel); return true; }
    // Tests only: "debugRailCard:3" opens the rail card of the turn #3 tick, as a hover
    // would ("debugRailCard:-" closes it), since the test window has no pointer.
    if (this.debug && name.startsWith("debugRailCard:")) {
      const n = name.slice(14);
      this.railHover = n === "-" ? null : this.railTicks().ticks.find((k) => k.turns.some((x) => String(x.turn.n) === n))?.key ?? null;
      return true;
    }
    // Tests only: "debugScroll:md:0:7:4" puts that list item at the top, as a person's scroll would.
    if (this.debug && name.startsWith("debugScroll:")) { this.scrollTo = { key: name.slice(12), how: "land", person: true }; this.scrollSeenAt = Date.now(); return true; }
    // The pointer in the pane or out of it (debugHover:1, debugHover:0): the test window has no pointer.
    if (this.debug && name.startsWith("debugHover:")) { this.paneHover = name.slice(11) === "1"; return true; }
    // The day pill held for 6.5 s, long enough for the test window's screenshot after a step.
    if (this.debug && name === "debugDayPill") { this.scrollSeenAt = Date.now() + 5000; return true; }
    // Tests only: "debugClick:470:imgs:0:5" is a press at x 470 (design px) on that list item.
    if (this.debug && /^debugClick:\d+:/.test(name)) {
      const [, x, ...k] = name.split(":");
      this.pressX = Number(x);
      this.bodyW = this.width;
      this.pressMoved = 0;
      this.pressCount = 1;
      this.click(k.join(":"), cx);
      return true;
    }
    // Tests only (props.debug, which the launcher never sets): a quote press on the selected
    // turn, since keys cannot reach a window that does not draw.
    if (this.debug && name === "debugQuote") return this.quote(cx, "debug") !== false;
    if (name.startsWith("search:")) {
      this.filtering = true;
      this.setQuery(name.slice(7), cx);
      this.input.set_value(this.query);
      return true;
    }
    return false;
  }

  // Commands for this mod reach every shown copy; the focused Threads pane takes them,
  // or the only one when none has focus.
  commands(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const me = this.me();
        const threads = panes().filter((p) => p.mod === MOD);
        const focusedOne = threads.find((p) => p.focused);
        const pinnedIds = new Set(Object.values(shared(PIN_MAP_KEY) ?? {}).map((v) => v.pane));
        const mains = threads.filter((p) => !pinnedIds.has(p.pane));
        if (focusedOne ? me?.pane === focusedOne.pane : threads.length === 1 || !me || (mains.length === 1 && !this.pinnedPane && mains[0].pane === me.pane)) {
          if (this.action(c, cx)) cx.notify();
        }
      }
    });
  }

  // Pins the pane to a transcript the person picked from the guesses.
  pick(c, cx) {
    this.dropCode();
    this.endSelect();
    this.resolveGen = (this.resolveGen ?? 0) + 1;
    this.pinned = c.path;
    this.pinnedVia = "picked";
    this.choosing = false;
    this.sessions = [];
    this.open.clear();
    this.full.clear();
    this.sel = null;
    this.res = { kind: "resolving" };
    this.resolve(cx);
    cx.notify();
  }

  // ---- the image viewer ----

  // A message's images, full window: this mod again, as a dialog over the whole window, with
  // the decoded files, the one to start at, and the turn for the reading panel beside the
  // image (viewerTurn). Only images that have a file go in.
  openGallery(turn, i) {
    const list = (turn.images ?? []).map((im, j) => {
      const f = this.imgFile(turn, j);
      return f ? { path: f.path, w: f.w ?? 0, h: f.h ?? 0, n: im?.n ?? j + 1, j } : null;
    }).filter(Boolean);
    if (!list.length) return false;
    const at = Math.max(0, list.findIndex((x) => x.j === i));
    this.galleryOpened = { turn: turn.n, at, count: list.length };
    openOverlay({ mod: MOD, kind: "dialog", frame: "none", width: 1, height: 1,
      props: { gallery: { images: list.map(({ j: _j, ...x }) => x), at, title: `#${turn.n}`, panel: this.prefs.viewerReply !== false, turn: this.viewerTurn(turn) } } });
    return true;
  }
  // The turn as the viewer's panel shows it, a copy taken when the viewer opens (a turn still
  // running keeps the reply it had then, and the panel says so): who sent it and when, the
  // prompt, the caption's parts, the reply as Markdown with the link rules applied (and its
  // source for Copy reply), the stats, and the bubble's colours.
  viewerTurn(turn) {
    const { style, theme: bt } = this.bubbleLook(theme(), turn.agent);
    const text = this.replyText(turn) ?? "";
    const md = text.length > FULL_REPLY_CHARS ? cutMd(text, FULL_REPLY_CHARS) : text;
    const prompt = String(this.youSource(turn) ?? "").replace(/\s+$/, "");
    return {
      n: turn.n, agent: Boolean(turn.agent), who: turn.agent ? senderLabel(turn.sender, 400) : this.prefs.youName,
      when: [turn.ts ? when(turn.ts) : null, fmtDuration(turn.durationMs)].filter(Boolean).join(" · "),
      running: !turn.done, asOf: fmtTime(Date.now()),
      cmd: commandParts(turn)?.name ?? null,
      prompt: prompt.slice(0, VIEWER_PROMPT), promptCut: Math.max(0, prompt.length - VIEWER_PROMPT),
      caption: this.captionParts(turn), md: this.linkOne(md).md, copy: text, left: text.length - md.length,
      stats: this.statsFull(turn), size: this.prefs.textSize,
      fill: style.fill, outline: Boolean(style.outline), ink: bt.foreground, sub: bt.muted,
    };
  }
  initGallery(p, cx) {
    const g = p.gallery ?? {};
    const images = Array.isArray(g.images) ? g.images.filter((x) => x && typeof x.path === "string") : [];
    const turn = g.turn && typeof g.turn === "object" ? g.turn : null;
    this.gal = {
      overlay: p.overlay ?? null, images, i: Math.max(0, Math.min(images.length - 1, Math.round(Number(g.at) || 0))), title: String(g.title ?? ""),
      turn, panel: Boolean(turn) && g.panel !== false, top: 0, y: 0, sizes: [], viewH: 0, paints: 0, copied: 0,
      blocks: turn ? replyBlocks(escapeDollars(String(turn.md ?? ""))) : [],
    };
    this.galSize = null;
    // A reply block that is one fenced code block gets the pane's code box: its language, a
    // Copy button and a read-only editor that highlights it (plain text if that fails).
    const t = theme();
    this.gal.code = this.gal.blocks.map((b) => {
      const c = fencedBlock(b);
      if (!c) return null;
      let st = false;
      try {
        st = EditorState.new({
          language: langFor(c.lang), value: c.text, readonly: true, line_numbers: false, folding: false, soft_wrap: true,
          font_family: settings().font_family, font_size: 12,
          syntax: {
            keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1,
            constant: t.ansi6, boolean: t.ansi1, operator: t.muted, punctuation: t.dim, variable: t.foreground, "string.escape": t.ansi6,
          },
        });
      } catch (e) {
        console.log(`agent-threads: no editor for ${c.lang || "plain"}: ${e?.message ?? e}`);
      }
      return { ...c, st };
    });
    // Without a ScrollHandle (Herdr before 0.1.15) the reply scrolls with the wheel only, and
    // j, k and Space step the images as before.
    this.galScroll = gpuiBase.ScrollHandle?.new?.() ?? null;
    this.h = cx.focus_handle();
    cx.timer.after(0, () => this.h.focus());
    // "agent-threads.galleryNext", galleryPrev, galleryClose, galleryReply (show or hide the
    // panel), galleryCopy, galleryDown and galleryUp (for key bindings, and for a window no
    // keys reach). Other commands are the panes'.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const act = { galleryNext: "next", galleryPrev: "prev", galleryClose: "close", galleryReply: "panel", galleryCopy: "copy", galleryDown: "down", galleryUp: "up" }[c];
        if (act) this.galleryAct(act, cx);
      }
    });
  }
  galleryStep(d, cx) {
    const n = this.gal.images.length;
    if (n < 2) return;
    this.gal.i = (this.gal.i + d + n) % n;
    cx.notify();
  }
  galleryGo(i, cx) {
    if (i < 0 || i >= this.gal.images.length) return;
    this.gal.i = i;
    cx.notify();
  }
  galleryClose() { if (this.gal.overlay) closeOverlay(this.gal.overlay); }
  galleryKey(e, cx) {
    const act = viewerKey(e, this.gal.panel && Boolean(this.galScroll));
    if (act) this.galleryAct(act, cx);
  }
  galleryAct(act, cx) {
    const g = this.gal;
    if (act === "prev") this.galleryStep(-1, cx);
    else if (act === "next") this.galleryStep(1, cx);
    else if (act === "first") this.galleryGo(0, cx);
    else if (act === "last") this.galleryGo(g.images.length - 1, cx);
    else if (act.startsWith("go:")) this.galleryGo(Number(act.slice(3)), cx);
    else if (act === "close") this.galleryClose();
    else if (act === "panel") this.galleryPanel(!g.panel, cx);
    else if (act === "copy") this.galleryCopy(cx);
    else if (act === "down" || act === "up") {
      if (!g.panel || !this.galScroll) this.galleryStep(act === "down" ? 1 : -1, cx);
      else this.galleryScroll(act === "down" ? 1 : -1, cx);
    }
  }
  // The panel's children, top to bottom: the message, the caption, the reply's blocks
  // (ui.js replyBlocks) and the stats. j and k put the next or the one before at the top.
  galleryParts() { return 2 + Math.max(1, this.gal.blocks.length) + 1; }
  galleryScroll(d, cx) {
    const g = this.gal;
    const n = this.galleryParts();
    // With every part measured: replyScroll's places, from the panel's own estimate of where
    // the view is (g.y), so a wheel scroll in between is taken into account.
    const sized = g.sizes.length === n && g.sizes.every((h) => h >= 0) && g.viewH > 0;
    let steps;
    if (sized) {
      const r = replyScroll(g.sizes, g.viewH, g.y, d);
      if (!r) return;
      g.y = r.y;
      steps = r.steps;
    } else {
      // Not measured yet (the first frame): part by part, going down by way of the end.
      const top = Math.max(0, Math.min(n - 1, g.top + d));
      if (top === g.top) return;
      g.top = top;
      steps = d > 0 && top > 0 ? [n - 1, top] : [top];
    }
    const ask = (g.asks = (g.asks | 0) + 1);
    this.galScroll.scroll_to_item(steps[0]);
    cx.notify();
    if (steps.length < 2) return;
    // A request is used once, after a layout: the second waits until a frame has been drawn
    // since the first (g.paints), and a newer press replaces it.
    const paints = g.paints;
    const second = (tries) => (cx) => {
      if (this.gal !== g || g.asks !== ask) return;
      if (g.paints === paints && tries < 6) { cx.timer.after(30, second(tries + 1)); return; }
      this.galScroll.scroll_to_item(steps[1]);
      cx.notify();
    };
    cx.timer.after(30, second(0));
  }
  // The wheel or trackpad moved the reply: the panel's estimate of where the view is follows,
  // so j and k go on from there.
  // Each part listens, since the scroll area's own scrolling may stop the event before a
  // listener on the area runs; the area listens too, for its padding. The same event reaching
  // both counts once.
  galleryWheel(e, from) {
    const g = this.gal;
    const dy = Number(e?.delta?.y) || 0;
    if (!g || !dy) return;
    const key = `${e?.position?.x},${e?.position?.y},${dy},${e?.touch_phase}`;
    if (from === "area" && g.wheelKey === key) return;
    g.wheelKey = from === "part" ? key : null;
    const total = 4 + g.sizes.reduce((a, h) => a + h, 0) + 20;
    g.y = Math.max(0, Math.min(Math.max(0, total - g.viewH), g.y - dy));
  }
  // i, the Reply button or galleryReply: the panel shows or hides, and settings.json keeps
  // the choice (viewerReply) for the next viewer. The pane watches the file and takes it.
  galleryPanel(on, cx) {
    if (!this.gal.turn) return;
    this.gal.panel = on;
    cx.notify();
    cx.spawn(async () => {
      for (let tries = 0; tries < 3; tries++) {
        const text = await readTextFile(settingsPath(appHome())).catch(() => null);
        if (!writable(text)) return;
        // The panel's state when this save runs: a later press may have changed it.
        const now = this.gal ? this.gal.panel : on;
        try { await saveSettings(appHome(), { ...parseSettings(text).values, viewerReply: now }, text); return; }
        catch { /* another save got there first: read it again */ }
      }
    });
  }
  galleryCopy(cx) {
    const text = String(this.gal.turn?.copy ?? "");
    if (!text) return;
    try { cx.write_to_clipboard(text); } catch (e) { console.log(`agent-threads: clipboard write failed: ${e?.message ?? e}`); return; }
    const at = (this.gal.copied = (this.gal.copied | 0) + 1);
    cx.notify();
    cx.timer.after(1500, (cx) => { if (this.gal.copied === at) { this.gal.copied = 0; cx.notify(); } });
  }
  // The stage a shade off the pane colour (darker in a dark theme, a little darker in a light
  // one), so a white screenshot keeps its edge; the image gets a thin ring too.
  galleryLook(t) {
    const dark = (contrast(t.background, "#000000") ?? 1) < (contrast(t.foreground, "#000000") ?? 21);
    return { dark, stage: mix(t.background, "#000000", dark ? 0.25 : 0.055), ring: alpha(t.foreground, dark ? 0.08 : 0.14) };
  }
  galleryView() {
    const t = theme();
    const g = this.gal;
    g.paints = (g.paints | 0) + 1;
    const n = g.images.length;
    const f = g.images[g.i];
    const z = this.zoom();
    const W = (this.galSize?.width ?? 1200) / z;
    const H = (this.galSize?.height ?? 800) / z;
    const L = viewerLayout(W, H, g.panel);
    const look = this.galleryLook(t);
    const box = galleryBox(f, L.room.w, L.room.h);
    const btn = (id, icon, tip, on, act) => div().id(id).flex_none().size(40).rounded(20).flex().items_center().justify_center()
      .bg(alpha(t.foreground, 0.08)).text_color(on ? t.foreground : t.dim).when(!on, (el) => el.opacity(0.35))
      .when(on, (el) => el.cursor_pointer().hover((s) => s.bg(alpha(t.foreground, 0.16))))
      .tooltip(tip)
      .on_click((_e, cx) => { cx.stop_propagation(); if (on) act(cx); })
      .child(svg(ICON(icon)).size(20));
    const label = f ? [`${g.title} · Image ${g.i + 1} of ${n}`, `[Image #${f.n}]`, f.w > 0 ? `${f.w}×${f.h}` : null].filter(Boolean).join(" · ") : "No image";
    // The row and the column centre their children across, so the stage asks for the full
    // height (beside the panel) or width (above it).
    const stage = v_flex().flex_1().min_w(0).min_h(0).bg(look.stage).when(L.wide, (el) => el.h_full()).when(!L.wide, (el) => el.w_full())
      .child(h_flex().flex_1().min_h(0).items_center().justify_between().px(12)
        .child(btn("th-gallery-prev", "chevron-left", "Previous image (Left)", n > 1, (cx) => this.galleryStep(-1, cx)))
        .child(h_flex().flex_1().min_w(0).h_full().items_center().justify_center()
          .child(f ? div().w(box.w).h(box.h).flex_none().rounded(6).overflow_hidden().border_1().border_color(look.ring).child(image(f.path).size_full()) : div()))
        .child(btn("th-gallery-next", "chevron-right", "Next image (Right)", n > 1, (cx) => this.galleryStep(1, cx))))
      .child(this.galleryStrip(t, L, look));
    return v_flex().id("th-gallery").size_full().bg(t.background)
      .track_focus(this.h)
      .on_key_down((e, cx) => this.galleryKey(e, cx))
      .on_size_change((size, cx) => {
        if (Math.abs((this.galSize?.width ?? 0) - size.width) > 1 || Math.abs((this.galSize?.height ?? 0) - size.height) > 1) { this.galSize = size; cx.notify(); }
      })
      .child(h_flex().h(VIEWER.TOP).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
        .child(svg(ICON("image")).size(15).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(label))
        .when(Boolean(g.turn), (el) => el.child(this.galleryButton(t, "th-gallery-reply", L.wide ? "panel-right" : "panel-bottom", "Reply", "i", g.panel,
          g.panel ? "Hide the prompt and reply (i)" : "Show the prompt and reply (i)", (cx) => this.galleryPanel(!g.panel, cx))))
        .child(this.galleryButton(t, "th-gallery-close", "x", "Close (Esc)", null, false, null, () => this.galleryClose())))
      .child((L.wide ? h_flex() : v_flex()).flex_1().min_h(0).min_w(0)
        .child(stage)
        .when(g.panel, (el) => el.child(this.galleryPanelView(t, L))));
  }
  // A top-line or footer button: an icon, a label and its key.
  galleryButton(t, id, icon, text, key, on, tip, act) {
    return div().id(id).flex_none().h(28).px(10).rounded(6).flex().items_center().gap(6).cursor_pointer()
      .border_1().border_color(t.border).text_size(12.5).text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.hover))
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_click((_e, cx) => { cx.stop_propagation(); act(cx); })
      .child(svg(ICON(icon)).size(13).flex_none()).child(text)
      .when(Boolean(key), (el) => el.child(div().px(4).rounded(4).border_1().border_color(t.border).text_size(10.5).font_family(this.mono()).text_color(t.dim).child(key)));
  }
  // Under the image, every image of the message as a thumbnail; a click goes to it.
  galleryStrip(t, L, look) {
    const g = this.gal;
    // Centred while it fits; wider than the stage it starts at the left edge and scrolls, so
    // the first thumbnails are never pushed out of reach.
    return h_flex().id("th-gallery-strip").h(L.strip).flex_none().items_center().overflow_x_scroll()
      .child(h_flex().flex_none().mx_auto().h_full().items_center().gap(8).px(16).children(g.images.map((im, j) => {
        const on = j === g.i;
        const k = im.w > 0 && im.h > 0 ? im.w / im.h : 1.4;
        const w = Math.round(L.thumb * Math.max(0.5, Math.min(2.4, k)));
        return div().id(`th-gallery-thumb-${j}`).flex_none().p(2).rounded(7).border_2().border_color(on ? t.accent : alpha(t.accent, 0))
          .cursor_pointer().tooltip(`[Image #${im.n}]${j < 9 ? ` (${j + 1})` : ""}`)
          .on_click((_e, cx) => { cx.stop_propagation(); this.galleryGo(j, cx); })
          .child(div().w(w).h(L.thumb).rounded(5).overflow_hidden().border_1().border_color(look.ring).when(!on, (el) => el.opacity(0.55))
            .hover((s) => s.opacity(on ? 1 : 0.85))
            .child(image(im.path).size_full()));
      })));
  }
  // The reading panel: the turn's number, sender and time, then a scroll area with the prompt
  // in its bubble (the on-screen image's label marked, each label a way to its image), the
  // caption, the reply as Markdown and the stats, then Copy reply.
  galleryPanelView(t, L) {
    const g = this.gal;
    const turn = g.turn;
    const rt = readType(turn.size);
    const head = turn.running ? `Still running · the reply as of ${turn.asOf}` : turn.when;
    const pad = (el) => el.pl(L.padX).pr(L.padX);
    const textW = L.wide ? L.panelW - 2 * L.padX : Math.min(VIEWER.MEASURE, L.stageW - 2 * L.padX);
    const reply = g.blocks.length
      ? g.blocks.map((b, k) => div().w_full().when(k > 0, (el) => el.pt(Math.round((12 * rt.size) / 13))).text_size(rt.size).line_height(`${rt.line}px`)
        .child(g.code?.[k] ? this.galleryCode(t, g.code[k], k, textW) : TextView.markdown(`th-gallery-md-${k}`, b).selectable(false).w_full()))
      : [div().text_size(rt.size).text_color(t.dim).child(turn.running ? "No reply yet." : "No reply.")];
    return v_flex().id("th-gallery-panel").flex_none().min_h(0).min_w(0).bg(t.background)
      .when(L.wide, (el) => el.w(L.panelW).h_full().border_l(1).border_color(t.border))
      .when(!L.wide, (el) => el.h(L.panelH).w_full().border_t(1).border_color(t.border))
      .child(pad(h_flex().h(VIEWER.HEAD).flex_none().gap(8).items_center().text_size(12.5).text_color(t.dim))
        .child(div().flex_none().font_family(this.mono()).text_color(t.muted).child(`#${turn.n}`))
        .child(div().flex_none().child("·"))
        .child(div().flex_none().font_medium().text_color(t.muted).child(turn.who))
        .child(div().flex_1().min_w(0).truncate().text_right().child(head)))
      .child(pad(v_flex().id("th-gallery-scroll").flex_1().min_h(0).overflow_y_scrollbar().when(Boolean(this.galScroll), (el) => el.track_scroll(this.galScroll)).pt(4).pb(20))
        .on_size_change((size) => { g.viewH = size.height; })
        .on_scroll_wheel((e) => this.galleryWheel(e, "area"))
        // The message, the caption, each reply block and the stats are the scroll area's own
        // children, as galleryParts counts them for j and k; each reports its height.
        .children([
          this.galleryPrompt(t, turn, rt, L),
          h_flex().pb(8).gap_x(6).flex_wrap().items_center().text_size(12.5).text_color(t.dim)
            .children(turn.caption?.length ? turn.caption.map(([icon, text], i) => h_flex().h(18).gap(5).items_center()
              .when(i > 0, (el) => el.child(div().child("·")))
              .when(icon === "name", (el) => el.child(div().font_semibold().text_color(t.muted).child(text)))
              .when(icon !== "name", (el) => el.child(svg(ICON(icon)).size(13).flex_none()).child(text))) : [div().h(4)]),
          ...reply,
          v_flex().pt(6)
            .when(turn.left > 0, (el) => el.child(div().pb(6).text_size(11.5).italic().text_color(t.dim).child(`… ${turn.left.toLocaleString()} more characters not shown`)))
            .child(div().min_w(0).text_size(11.5).font_family(this.mono()).text_color(t.dim).child(turn.stats || " ")),
        ].map((el, k) => el.id(`th-gallery-part-${k}`).on_size_change((size) => { g.sizes[k] = size.height; }).on_scroll_wheel((e) => this.galleryWheel(e, "part")))))
      .child(pad(h_flex().h(VIEWER.FOOT).flex_none().gap(8).items_center().border_t(1).border_color(t.border))
        .child(this.galleryButton(t, "th-gallery-copy", g.copied ? "check" : "copy", g.copied ? "Copied" : "Copy reply", "c", false, "Copy the reply as Markdown (c)", (cx) => this.galleryCopy(cx)))
        .child(div().flex_1())
        .child(div().flex_none().text_size(12).text_color(t.dim).child(this.galScroll ? "j / k scroll the reply · i hides it" : "i hides the reply")));
  }
  // A fenced code block in the panel, as the open turn draws one: the language and Copy on a
  // head, then the highlighted code, up to CODE_LINES wrapped rows (a taller one scrolls
  // inside, and says so).
  galleryCode(t, c, k, textW) {
    const mono = this.mono();
    const copied = this.gal.codeCopied === k;
    const rows = codeRows(c.text, (textW - CODE_PAD) / 7.3);
    const shown = Math.min(CODE_LINES, rows);
    return v_flex().w_full()
      .child(h_flex().h(28).pl(10).pr(4).gap(6).items_center().rounded_t(7).bg(t.chrome).border_1().border_color(t.border)
        .child(div().flex_1().text_size(11.5).font_family(mono).text_color(t.dim).child(c.lang))
        .child(h_flex().id(`th-gallery-code-copy-${k}`).h(22).px(7).gap(5).items_center().rounded(5).cursor_pointer().text_size(11.5)
          .text_color(copied ? t.ansi2 : t.muted).when(copied, (el) => el.bg(alpha(t.ansi2, 0.13)))
          .when(!copied, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)))
          .tooltip("Copy this code")
          .on_click((_e, cx) => { cx.stop_propagation(); this.galleryCopyCode(k, cx); })
          .child(svg(ICON(copied ? "check" : "copy")).size(12)).child(copied ? "Copied" : "Copy")))
      .child(div().w_full().h(shown * CODE_LINE + 16).rounded_b(7).overflow_hidden().border_1().border_t(0).border_color(t.border).bg(t.background)
        .text_size(12).line_height(`${CODE_LINE}px`)
        .child(c.st ? Editor.new(c.st).size_full().py(6) : div().p(8).font_family(mono).text_color(t.muted).child(c.text)))
      .when(rows > CODE_LINES, (el) => el.child(div().pt(6).text_size(11.5).line_height("18px").truncate().text_color(t.dim)
        .child(`${plural(rows, "row")} · scrolls inside`)));
  }
  galleryCopyCode(k, cx) {
    const g = this.gal;
    const text = g.code?.[k]?.text;
    if (text == null) return;
    try { cx.write_to_clipboard(text); } catch (e) { console.log(`agent-threads: clipboard write failed: ${e?.message ?? e}`); return; }
    const at = (g.codeAt = (g.codeAt | 0) + 1);
    g.codeCopied = k;
    cx.notify();
    cx.timer.after(1500, (cx) => { if (this.gal === g && g.codeAt === at) { g.codeCopied = null; cx.notify(); } });
  }
  // The person's message in its bubble on the right (an agent's outlined, on the left), as
  // plain text in the bubble's ink. A line with an [Image #N] label is drawn a word at a
  // time, so the label can be marked (the image on screen) and clicked (goes to its image).
  galleryPrompt(t, turn, rt, L) {
    const g = this.gal;
    const shown = g.images[g.i]?.n;
    const all = String(turn.prompt ?? "").split("\n");
    const lines = all.slice(0, 400);
    const ink = turn.ink ?? t.foreground;
    const tag = (p, li, k) => {
      const j = g.images.findIndex((x) => x.n === p.n);
      const on = p.n === shown;
      return div().id(`th-gallery-tag-${li}-${k}`).flex_none().px(5).rounded(5).text_color(ink)
        .when(on, (el) => el.bg(alpha(ink, 0.2)).border_1().border_color(alpha(ink, 0.35)))
        .when(!on && j >= 0, (el) => el.cursor_pointer().hover((s) => s.bg(alpha(ink, 0.12))))
        .when(j >= 0, (el) => el.on_click((_e, cx) => { cx.stop_propagation(); this.galleryGo(j, cx); }))
        .child(p.t);
    };
    const line = (text, li) => {
      const pieces = labelPieces(text);
      if (!pieces.some((p) => p.n != null)) return div().min_h(rt.line).text_color(ink).child(text || " ");
      return h_flex().flex_wrap().min_h(rt.line).items_center().children(pieces.flatMap((p, k) => (p.n != null ? [tag(p, li, k)]
        : p.t.split(/(?<=\s)/).filter(Boolean).map((w) => div().text_color(ink).child(w.replace(/\s$/, " "))))));
    };
    const body = v_flex().min_w(0).text_size(rt.size).line_height(`${rt.line}px`)
      .when(Boolean(turn.cmd), (el) => el.child(div().text_color(turn.sub ?? t.muted).font_family(this.mono()).text_size(12.5).child(turn.cmd)))
      .children(lines.map(line))
      .when(all.length > lines.length, (el) => el.child(div().text_size(11.5).italic().text_color(turn.sub ?? t.dim).child(`… ${plural(all.length - lines.length, "more line")} not shown`)))
      .when(turn.promptCut > 0, (el) => el.child(div().text_size(11.5).italic().text_color(turn.sub ?? t.dim).child(`… ${turn.promptCut.toLocaleString()} more characters not shown`)));
    const max = Math.round((L.wide ? L.panelW - 2 * L.padX : Math.min(VIEWER.MEASURE, L.stageW - 2 * L.padX)) * 0.92);
    return h_flex().w_full().pb(14).when(!turn.agent, (el) => el.justify_end())
      .child(div().max_w(max).min_w(0).px(14).py(9).bg(turn.fill ?? alpha(t.foreground, 0.08))
        .when(Boolean(turn.outline), (el) => el.border_1().border_color(t.border))
        .when(!turn.agent, (el) => el.rounded_tl(16).rounded_tr(16).rounded_bl(16).rounded_br(4))
        .when(Boolean(turn.agent), (el) => el.rounded_tl(4).rounded_tr(16).rounded_bl(16).rounded_br(16))
        .child(body));
  }

  // ---- drawing ----

  render(cx) {
    if (this.gal) return this.galleryView();
    if (this.launcher) return div();
    this.renders = (this.renders ?? 0) + 1;
    if (this.stickStep) this.applyStick();
    this.fitColumn();
    this.react(cx);
    // Here and not in rows(): the timing report changes the selection for a moment.
    if (this.pinVisit && this.sel !== this.pinVisit) this.pinVisit = null;
    if (this.pinResume && this.sel !== this.pinResume.key) this.pinResume = null;
    if (this.pinAgain && this.sel !== this.pinAgain) this.pinAgain = null;
    this.publishDrawError(cx);
    this.rows();
    // Rows left with their old shape (SHAPE_MS): the next frame goes on with them.
    if (this.shapeLeft > 0 && !this.shapeNext) {
      this.shapeNext = true;
      cx.timer.after(0, (cx) => { this.shapeNext = false; this.rowsKey = null; cx.notify(); });
    }
    const t = theme();
    const focusedPanel = this.h.is_focused() || this.input && this.filtering || this.naming;
    if (this.debug) this.measure();
    const floating = this.floating();
    const banners = this.banners(t);
    // The day at the top of the list, read before the list draws (body), for the day pill.
    this.stickyNow = null;
    return v_flex()
      .id("threads-root")
      .track_focus(this.h)
      // The pointer in the pane: the floating top shows its icons.
      .on_hover((on, cx) => { if (Boolean(on) !== Boolean(this.paneHover)) { this.paneHover = Boolean(on); cx.notify(); } })
      .on_key_down((e, cx) => this.key(e, cx))
      .on_modifiers_changed((e, cx) => this.cmdUp(e, cx))
      // Zoomed px from on_size_change, design px everywhere else (zoom()).
      .on_size_change((size, cx) => {
        const h = size.height / this.zoom();
        if (Math.abs(h - this.rootH) > 1) { this.rootH = h; cx.notify(); }
        const w = size.width / this.zoom();
        this.measuredWidth = size.width;
        if (!this.forcedWidth && Math.abs(w - (this.paneW ?? -9)) > 1) { this.paneW = w; this.fitColumn(); this.shareWidth(); cx.notify(); }
      })
      .size_full().min_h(0).relative()
      .bg(t.background).text_color(t.foreground).text_size(13)
      .when(!floating, (el) => el.child(this.header(t)).children(banners))
      .when(floating && this.topBlock(banners), (el) => el.child(this.topPanels(t, banners)))
      .child(this.body(t, focusedPanel, cx))
      .when(floating, (el) => el.child(this.floatTop(t, focusedPanel)))
      .child(this.footer(t))
      .when(this.pillShown(), (el) => el.child(this.pillView(t)))
      .when(this.keysOpen, (el) => el.child(this.keySheetView(t)))
      .when(Boolean(this.toast), (el) => el.child(this.toastView(t)));
  }

  // props().debug: how long building the rows takes, fresh and memoised, and whether
  // alpha() reads every colour of every theme.
  measure() {
    const a = now();
    this.rowsKey = null;
    this.rows();
    const b = now();
    this.rows();
    const c = now();
    // Moving the selection: what j/k cost.
    const keep = this.sel;
    this.sel = this.rowsMemo[0]?.key ?? null;
    this.rows();
    this.sel = keep;
    this.rows();
    const d = now();
    if (this.alphaOk == null) {
      const all = themes().flatMap((x) => Object.values(x.colors ?? {})).filter((v) => typeof v === "string");
      this.alphaOk = `${all.filter((v) => /^#[0-9a-f]{8}$/.test(alpha(v, 0.5))).length}/${all.length}`;
    }
    this.timing = `rows ${(b - a).toFixed(1)} ms · memo ${(c - b).toFixed(2)} ms · move ${((d - c) / 2).toFixed(2)} ms · ${this.rowsMemo.length} items · alpha ${this.alphaOk}`;
  }

  narrow() { return this.width < 300; }
  // The pane's own width, and the column the turns are laid out in: the pane, or in a pane
  // wider than fitWidth a centred column that wide, so a reply's reading line and the
  // bubbles stay together instead of leaving a gutter between them. Before the pane has
  // measured itself (and in tests that set width) both are this.width.
  pw() { return this.paneW ?? this.width; }
  fitColumn() {
    if (this.forcedWidth || this.paneW == null) return;
    const w = Math.min(this.paneW, this.readingPx());
    if (Math.abs(w - this.width) > 0.5) this.width = w;
  }
  // How far the column sits in from the pane's left edge.
  colLeft() { return Math.max(0, (this.pw() - this.width) / 2); }
  // Opened by Cmd-Shift-T: once the pane and the settings are read, a pane wider than the
  // reading width shrinks to it. A narrower one keeps what it was given.
  fitOnOpen() {
    if (this.paneW == null || !this.prefsLoaded) return;
    const me = this.me();
    const map = shared(FIT_KEY);
    if (!me || !map?.[me.pane]) return;
    const { [me.pane]: _, ...rest } = map;
    setShared(FIT_KEY, rest);
    const px = this.readingPx();
    if (Number.isFinite(px) && this.paneW > px + 2) { this.capAsked = Math.round(this.paneW); run("layout.resize", { id: me.pane, px }); }
  }
  // Herdr has no maximum width for a pane a split made (a layout file's min/max applies to its
  // own nodes only), so with readingWidth on (the default) the pane keeps itself there: wider
  // than the reading width, from a drag, a restart or an older layout, it asks Herdr once to
  // resize it, and the terminal gets the room. One ask per width, so a pane Herdr cannot
  // resize (alone in its tab, or zoomed) is not asked again and again.
  // The width's column (settings width): Infinity for Full, which has no limit.
  readingPx() { return fitWidth(this.prefs.textSize, this.chars()); }
  chars() { return widthChars(this.prefs.width); }
  keepWidth() {
    if (this.pinnedPane || !this.prefs.readingWidth || this.paneW == null || !this.prefsLoaded) return;
    const me = this.me();
    if (!me || me.zoomed) return;
    const px = this.readingPx();
    if (!Number.isFinite(px) || this.paneW <= px + 2) { this.capAsked = null; return; }
    const w = Math.round(this.paneW);
    if (this.capAsked === w) return;
    this.capAsked = w;
    run("layout.resize", { id: me.pane, px });
  }
  // Choosing a width: with "Keep the pane at this width" on, the pane grows or shrinks to the
  // new column and the terminal gives or takes the room. Full has no column, so it leaves the
  // pane as it is and turns that switch off.
  chooseWidth(w, cx) {
    if (!WIDTH_NAMES.includes(w)) return false;
    const full = w === "full";
    this.changePrefs(full ? { width: w, readingWidth: false } : { width: w }, cx);
    this.fitColumn();
    this.capAsked = null;
    const me = this.me();
    if (!full && this.prefs.readingWidth && !this.pinnedPane && me && !me.zoomed && this.paneW != null) {
      const px = this.readingPx();
      if (Math.abs(this.paneW - px) > 2) { this.capAsked = Math.round(this.paneW); run("layout.resize", { id: me.pane, px }); }
    }
    return true;
  }
  // w, or the header's fit button: Threads to the reading width, and an open Pinned column to
  // its own width for that, wider or narrower than they are now.
  fitToReading(cx) {
    const main = this.pinnedPane ? this.mainPane() : this.me();
    if (!main) return false;
    const px = this.readingPx();
    if (!Number.isFinite(px)) { this.say("Full has no reading width to fit to", "fold-horizontal", cx); return true; }
    run("layout.resize", { id: main.pane, px });
    const col = this.pinnedPane ? this.me() : this.pinnedPaneOpen();
    if (col) run("layout.resize", { id: col.pane, px: pinColumn(px) ?? PIN_COL[0] });
    this.capAsked = null;
    this.say(`Threads at the reading width, ${px} px`, "fold-horizontal", cx);
    return true;
  }
  // Wider than the reading width by more than a little: the header offers the fit button.
  tooWide() { return !this.pinnedPane && this.paneW != null && this.paneW > this.readingPx() + 8; }

  // Under 440 px the header's badge drops its word and the latest button gives way (End still
  // acts), so the text keeps room beside the labelled Pinned button.
  compact() { return this.width < 440; }
  // Herdr's zoom (settings.json, 0.5 to 3). It scales every length the panel draws, the item
  // sizes given to v_virtual_list included, while on_size_change and mouse positions come in
  // zoomed px. So the panel works in design px (as AGENTS.md says to write sizes), divides
  // what it measures by zoom, and hands the list design px (rows()).
  zoom() {
    const z = Number(settings()?.zoom);
    return Number.isFinite(z) && z > 0 ? Math.min(3, Math.max(0.5, z)) : 1;
  }
  mono() { return settings().font_family ?? "JetBrains Mono"; }

  iconButton(t, id, icon, tip, onClick, on = false, count = null, dot = false) {
    return div().id(id).flex_none().size(24).flex().items_center().justify_center().rounded(5).cursor_pointer().relative()
      .text_color(on ? t.foreground : t.dim).when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); })
      .child(svg(ICON(icon)).size(14))
      // A count at the corner (the Agents button: hidden or shown agent messages).
      .when(count != null, (el) => el.child(div().absolute().top(-3).right(-5).h(13).px(3).rounded(7)
        .flex().items_center().bg(on ? t.ansi5 : t.raised).border_1().border_color(on ? t.ansi5 : t.border)
        .text_size(9).font_semibold().text_color(on ? t.background : t.muted).child(count)))
      // A dot at the corner (the latest button: a turn or reply came in below the screen).
      .when(Boolean(dot), (el) => el.child(div().id(`${id}-dot`).absolute().top(1).right(1).size(8).rounded(4).bg(t.accent).border_1().border_color(t.background)));
  }

  // The header's buttons, left to right after the text, as data: [id, icon, tip, action, on,
  // count, label, dot]. A labelled button shows its label instead of an icon. Under 440 px the
  // latest button gives way, and under 300 px the agents button too (End and a still act), so
  // the turn count keeps its room beside "Pinned 2". The list has no pin button: p and the
  // pin on an open turn's top line pin, so the session's title keeps that room. A Pinned
  // view (the Pinned pane, or Pinned in this pane) keeps its pin button, as Unpin for the
  // selected pin: every row there is a pin, and a closed one has no pin of its own to click.
  headerButtons() {
    const c = this.counts();
    const pins = this.pinnedList().length;
    const pinned = Boolean(this.sel && this.isPinned(this.sel));
    const n = this.sel ? this.findTurn(this.sel)?.n : null;
    const pinBtn = ["th-pin", "pin", n ? `${pinned ? "Unpin" : "Pin"} #${n} (p)` : "Pin the selected turn (p)", "pin", pinned, null, null];
    // The Pinned pane: its pin button gives way under 300 px too, so "1 of 5" keeps its room
    // beside the heading.
    if (this.pinnedPane) return [...(this.narrow() ? [] : [pinBtn]), ["th-pinned", null, "Back to Threads, all turns (v)", "pinned", false, null, "All turns"]];
    const narrow = this.narrow();
    const showAgents = (c.agentAll > 0 || this.prefs.agentTurns) && !narrow;
    const out = [["th-search", "search", "Filter (/)", "filterToggle", this.filtering || Boolean(this.query), null, null]];
    if (showAgents) {
      const on = Boolean(this.prefs.agentTurns);
      out.push(["th-agents", "bot", on ? "Hide agent messages (a)" : `Show agent messages (${c.hiddenAll.toLocaleString()} hidden) (a)`, "agents", on,
        countLabel(on ? c.agentAll : c.hiddenAll), null]);
    }
    if (!narrow && this.view === "pinned") out.push(pinBtn);
    const label = `Pinned${pins ? ` ${pins}` : ""}`;
    const col = this.pinnedPaneOpen();
    out.push(this.view === "pinned" ? ["th-pinned", null, "Back to all turns (v)", "pinned", true, null, "All turns"]
      : ["th-pinned", null, col ? "Go to the Pinned column (v)" : pinColumn(this.pw()) ? "Open the Pinned column beside Threads (v)"
        : `Show Pinned in this pane: a Pinned column needs Threads ${PIN_SPLIT_MIN} px wide (v)`, "pinned", Boolean(col), null, label]);
    if (this.tooWide()) out.push(["th-fit", "fold-horizontal", `Fit to the reading width, ${this.readingPx()} px (w)`, "fit", false, null, null]);
    out.push(["th-settings", "sliders-horizontal", "Settings (,)", "settings", this.settingsOpen, null, null]);
    return out;
  }

  // A labelled header button: the Pinned control reads "Pinned 2", not an icon to guess at.
  labelButton(t, id, label, tip, onClick, on = false) {
    return div().id(id).flex_none().h(24).px(7).flex().items_center().rounded(5).cursor_pointer().border_1()
      .border_color(on ? t.accent : t.border).text_size(12).text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); })
      .child(label);
  }

  // Estimated header layout at the pane width (no window has to draw to read it): the
  // badge, the room left for the text, and the buttons, inside 10 px padding and 8 px gaps.
  headerLayout() {
    const list = this.headerButtons();
    const st = this.pinnedPane || this.compact() ? null : this.agentStateNow();
    // The state: a 7 px dot, and its word at 12 px (6.6 px a character) after a 5 px gap,
    // inside its padding a side.
    const state = st ? 8 + STATE_PAD * 2 + 7 + 5 + Math.ceil(st.word.length * 6.6) : 0;
    const badge = (this.pinnedPane ? 0 : this.res.kind === "unsupported" || this.res.kind === "remote" ? 90 : this.compact() ? 28 : 28 + 5 + 38) + state;
    const room = list.reduce((sum, b) => sum + headerButtonWidth(b[6]) + 8, 0);
    // The Pinned heading: the pin, a 6 px gap and "Pinned" at 13.5 px semibold.
    const heading = this.view === "pinned" ? PINNED_HEADING + 8 : 0;
    const text = Math.round(this.pw() - 20 - (badge ? badge + 8 : 0) - heading - room);
    return { width: Math.round(this.pw()), badge, heading, text, buttons: list.length, rightGutter: 10 };
  }

  // The agent's state beside the badge, so a reader scrolled up into an older reply still
  // sees it: Working, Needs you, Done or Exited (ui.js agentState), or nothing when the agent
  // reports no status and the transcript cannot tell.
  agentStateNow() {
    const s = this.current();
    if (!s?.loaded || this.res.kind === "unsupported" || this.res.kind === "remote") return null;
    return agentState({ ended: this.res.ended, status: this.status(), reports: this.agent().key === "claude", newest: s.turns[s.turns.length - 1] ?? null });
  }
  stateTip(st) {
    const a = this.agent();
    if (st.word === "Exited") return `${a.cmd} ${this.res.ended === "closed" ? "closed with its terminal" : "exited"}`;
    if (st.word === "Needs you") return `${a.short} is waiting for you in the terminal`;
    if (st.word === "Working") return `${a.short} is working`;
    return a.key === "claude" ? `${a.short} finished its newest turn`
      : `${a.short} finished its newest turn. ${a.name} reports no live status, so this is read from the transcript.`;
  }
  // Under 440 px (where the badge drops its word too) the dot sits on the badge's corner
  // instead (stateDot), and the badge's tooltip says the word, so the header text keeps its room.
  // A click on the state goes to the terminal, as t does: "Needs you" points there, so it is
  // the way there. Under 440 px the badge takes that click, since the 8 px dot on its corner
  // is too small to aim at and the badge already stands for the state there.
  stateChip(t) {
    const st = this.agentStateNow();
    const color = t[st.tone] ?? t.dim;
    return h_flex().id("th-state").flex_none().gap(5).h(24).px(STATE_PAD).items_center().rounded(5).cursor_pointer()
      .on_click((_e, cx) => this.stateClick(cx))
      .hover((s) => s.bg(t.hover))
      .tooltip(`${this.stateTip(st)} · ${STATE_CLICK}`)
      .child(div().flex_none().size(7).rounded(4).bg(color))
      .child(div().flex_none().text_size(12).text_color(st.tone === "blocked" ? color : t.muted).child(st.word));
  }
  stateDot(t, el) {
    const st = this.compact() ? this.agentStateNow() : null;
    return el.relative().when(Boolean(st), (b) => b.cursor_pointer().on_click((_e, cx) => this.stateClick(cx)).hover((s) => s.bg(t.hover))
      .child(div().id("th-state-dot").absolute().top(-3).right(-3).size(8).rounded(4)
        .bg(t[st?.tone] ?? t.dim).border_1().border_color(t.background)));
  }
  stateClick(cx) {
    cx.stop_propagation();
    this.action("focus", cx);
    cx.notify();
  }

  badge(t) {
    // Another agent (frame 03 "Harness not supported"), or a terminal on another machine:
    // a neutral chip with its name instead of the Claude mark.
    const agent = this.agent();
    const other = this.res.kind === "unsupported" ? this.res.name
      : this.res.kind === "remote" ? (this.terminal ?? "").split("/")[0]
        : agent.key !== "claude" ? agent.name : null;
    if (other) return this.stateDot(t, h_flex().id("th-badge").flex_none().gap(5).h(22).px(6).items_center().rounded(5).border_1().border_color(t.border)
      .when(this.res.kind !== "unsupported" && this.res.kind !== "remote", (el) => el.tooltip(this.badgeTip())
        .child(mark(agent.key, 14) ?? svg(ICON("square-terminal")).size(13).text_color(t.muted)))
      .when(this.res.kind === "remote", (el) => el.child(svg(ICON("cpu")).size(12).text_color(t.muted)))
      .child(div().max_w(120).truncate().text_size(12).text_color(t.foreground).child(other)));
    return this.stateDot(t, h_flex().id("th-badge").flex_none().gap(5).h(22).px(6).items_center().rounded(5).border_1().border_color(t.border)
      .tooltip(this.badgeTip())
      .child(mark("claude", 14))
      .when(!this.compact(), (el) => el.child(div().text_size(12).text_color(t.foreground).child("Claude"))));
  }

  // "Reading t4 · session 7f3a1b2c · agent shop-agent · 1.2M tokens · cache 97.1%": which
  // terminal and session the pane is bound to, so a wrong binding shows without a click. The
  // session's agent name (Claude Code's --name, a Codex subagent's nickname) is here since
  // replies carry no name.
  badgeTip() {
    const st = this.compact() ? this.agentStateNow() : null;
    return st ? `${st.word}: ${this.stateTip(st)} · ${STATE_CLICK} · ${this.bindingTip()}` : this.bindingTip();
  }
  bindingTip() {
    const s = this.current();
    if (!s) return `Reading ${this.terminal ?? "no terminal"}`;
    let input = 0, output = 0, cr = 0, cc = 0;
    for (const t of s.turns) for (const u of Object.values(t.usage)) { input += u.i ?? 0; output += u.o ?? 0; cr += u.cr ?? 0; cc += u.cc ?? 0; }
    const pct = cachePct(cr, input + cc + cr);
    // The selected turn's own cache counts too (its chip in the card cannot carry a tooltip).
    const sel = this.sel ? this.findTurn(this.sel) : null;
    const st = sel ? stats(sel) : null;
    return [`Reading ${this.terminal} · session ${s.id.slice(0, 8)}`, s.agentName ? `agent ${s.agentName}` : null, `${fmtTokens(input + cc + output)} tokens`,
      pct != null ? `cache ${fmtPct(pct)} (read ${fmtCount(cr)} · written ${fmtCount(cc)} · new input ${fmtCount(input)})` : null,
      st?.cachePct != null ? `turn #${sel.n}: cache ${fmtPct(st.cachePct)} (${cacheLine(st).replace(/^cache /, "")})` : null]
      .filter(Boolean).join(" · ");
  }

  // How much of the transcript is read, or null before the first chunk is in (the bar is
  // then indeterminate, never a false 0%).
  readPct(s) {
    return s?.size && s.offset > 0 ? Math.min(100, Math.round((s.offset / s.size) * 100)) : null;
  }

  headerText() {
    const s = this.current();
    if (this.res.kind === "unsupported") return "Not readable";
    if (this.res.kind === "remote") return "Not read yet";
    if (!s && (this.res.kind === "none" || this.res.kind === "gone")) return "No session";
    if (!s && this.res.kind === "pending") return "0 turns";
    if (!s) return this.res.kind === "resolving" ? "Finding…" : "";
    if (!s.loaded) return s.error ? "Read failed" : `Reading…${this.readPct(s) != null ? ` ${this.readPct(s)}%` : ""}`;
    // The Pinned view: "3 of 5", after the Pinned heading (pinnedHeading).
    if (this.view === "pinned") return `${this.pinnedList().length} of ${PIN_LIMIT}`;
    const c = this.counts();
    // "98 turns · 43 hidden": the newest session's shown turns, then the agent messages
    // hidden in the whole list, the same number as the Agents button's count and tooltip
    // (from 300 px; below that only the button's count says it).
    return [plural(c.shownCur, "turn"), c.hiddenAll && !this.narrow() ? `· ${c.hiddenAll.toLocaleString()} hidden` : "",
      s.title ? `· ${s.title}` : "", this.res.guess ? "· guessed" : ""].filter(Boolean).join(" ");
  }

  // The Pinned view leads its header with a pin and "Pinned", so the column reads as its own
  // view beside the feed: Herdr titles every copy of a mod's pane with the mod's name, and a
  // mod cannot rename its pane.
  pinnedHeading(t) {
    return h_flex().id("th-pinned-heading").flex_none().gap(6).items_center()
      .child(svg(ICON("pin")).size(14).flex_none().text_color(t.accent))
      .child(div().flex_none().text_size(13.5).font_semibold().text_color(t.foreground).child("Pinned"));
  }

  // The floating top (the list and the outline): no header row and no day strip. The state
  // sits top left and is always there; search, pinned and settings show at the top right while
  // the pointer is in the pane or the panel has the keyboard. The rest is in settings. The
  // Pinned view, and the Pinned pane, keep their header: every row there is a pin, so the view
  // keeps its own tinted line.
  floating() { return this.view !== "pinned" && !this.pinnedPane; }

  // Settings, the search field and the banners sit in the flow under the band, so the state
  // and the icons float over empty room and never over a control.
  topBlock(banners) { return this.settingsOpen || this.filtering || Boolean(this.query) || banners.length > 0; }
  topPanels(t, banners) {
    return v_flex().id("th-top").flex_none().pt(TOP_BAND)
      .when(this.settingsOpen, (el) => el.child(this.settingsPanel(t)))
      .when(this.filtering || Boolean(this.query), (el) => el.child(this.searchField(t)))
      .children(banners);
  }

  floatTop(t, focusedPanel) {
    const show = Boolean(this.paneHover || focusedPanel || this.settingsOpen || this.filtering || this.query);
    const day = this.dayPillShown() ? this.stickyNow : null;
    return div().id("th-float").absolute().top(0).left(0).right(0).h(TOP_BAND)
      .child(this.fadeLayer(t))
      .when(Boolean(day), (el) => el.child(h_flex().absolute().top(4).left(0).right(0).justify_center()
        .child(div().id("th-sticky-day").child(this.dayPill(t, day)))))
      .child(h_flex().absolute().top(0).left(0).right(0).h(TOP_BAND).pl(8).pr(10).gap(6).items_center()
        .child(this.floatState(t))
        .child(div().flex_1())
        .when(show, (el) => el.children(this.floatButtons().map(([id, icon, tip, act, on, count]) => {
          const b = this.iconButton(t, id, icon, tip, this.headerClick(act), on, count);
          // A patch in the list's colour, so a reply under the icon never shows through.
          return on ? b : b.bg(t.background);
        }))));
  }

  // The fade under the floating top: the list's colour at the top, clear at the band's foot, so
  // a reply scrolled under the state fades out. Painted as a gradient on Herdr 0.1.15, in
  // steps of alpha before that.
  fadeLayer(t) {
    const win = globalThis.window;
    if (PAINT && typeof win?.paint_path === "function") {
      try {
        const rect = PAINT.PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
        const bg = PAINT.Background;
        return win.paint_path(rect, bg.linear_gradient(180, bg.stop(t.background, 55), bg.stop(alpha(t.background, 0), 100)))
          .absolute().top(0).left(0).size_full();
      } catch { /* the steps below */ }
    }
    return v_flex().id("th-fade-steps").absolute().top(0).left(0).size_full()
      .children([1, 1, 0.8, 0.45].map((a) => div().flex_1().w_full().bg(alpha(t.background, a))));
  }

  // The state, top left: its dot and word, or what the pane is doing before it has one
  // ("Reading… 42%", "Finding…", "No session"). The tooltip says which terminal, session and
  // title it reads, as the badge's did. A click goes to the terminal, as t does.
  floatState(t) {
    const st = this.agentStateNow();
    const s = this.current();
    const text = st ? null : s?.loaded ? null : this.headerText() || null;
    if (!st && !text) return div();
    const color = st ? t[st.tone] ?? t.dim : null;
    const title = s?.title ? `"${s.title}"` : null;
    const tip = [st ? this.stateTip(st) : null, STATE_CLICK, title, this.bindingTip()].filter(Boolean).join(" · ");
    return h_flex().id("th-state").flex_none().gap(5).h(24).px(STATE_PAD + 1).items_center().rounded(5).cursor_pointer()
      .bg(t.background)
      .on_click((_e, cx) => this.stateClick(cx))
      .hover((x) => x.bg(t.hover))
      .tooltip(tip)
      .when(Boolean(st), (el) => el.child(div().flex_none().size(7).rounded(4).bg(color)))
      .child(div().flex_none().text_size(12).text_color(st?.tone === "blocked" ? color : t.muted).child(st ? st.word : text));
  }

  // The floating top's icons, as data: [id, icon, tip, action, on, count]. Pinned is a pin with
  // the count at its corner.
  floatButtons() {
    const pins = this.pinnedList().length;
    const col = this.pinnedPaneOpen();
    const pinTip = col ? "Go to the Pinned column (v)" : pinColumn(this.pw()) ? "Open the Pinned column beside Threads (v)"
      : `Show Pinned in this pane: a Pinned column needs Threads ${PIN_SPLIT_MIN} px wide (v)`;
    return [
      ["th-search", "search", "Search (/)", "filterToggle", this.filtering || Boolean(this.query), null],
      ["th-pinned", "pin", pins ? `${pinTip} · ${plural(pins, "pin")}` : pinTip, "pinned", Boolean(col), pins ? String(pins) : null],
      ["th-settings", "sliders-horizontal", "Settings (,)", "settings", this.settingsOpen, null],
    ];
  }

  // The day pill over the list: while the person scrolls, and DAY_PILL_MS after.
  dayPillShown() { return Boolean(this.scrollSeenAt) && Date.now() - this.scrollSeenAt < DAY_PILL_MS; }

  header(t) {
    const pinned = this.view === "pinned";
    // The Pinned view's header: an accent bar along its top and a light accent tint.
    return v_flex().flex_none().relative().border_b(1).border_color(t.border)
      .when(pinned, (el) => el.bg(alpha(t.accent, 0.08)).child(div().absolute().top(0).left(0).right(0).h(2).bg(t.accent)))
      .child(h_flex().h(40).px(10).gap(8).items_center()
        .when(pinned, (el) => el.child(this.pinnedHeading(t)))
        .when(!this.pinnedPane, (el) => el.child(this.badge(t)))
        .when(!this.pinnedPane && !this.compact() && Boolean(this.agentStateNow()), (el) => el.child(this.stateChip(t)))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.muted).child(this.headerText()))
        .when(this.debug && Boolean(this.timing) && !this.narrow(), (el) => el.child(div().flex_none().max_w(160).truncate().text_size(10.5).font_family(this.mono()).text_color(t.dim).child(this.timing)))
        .children(this.headerButtons().map(([id, icon, tip, act, on, count, label, dot]) => {
          const click = this.headerClick(act);
          return label ? this.labelButton(t, id, label, tip, click, on) : this.iconButton(t, id, icon, tip, click, on, count, dot);
        })))
      .when(this.settingsOpen, (el) => el.child(this.settingsPanel(t)))
      .when(this.filtering || Boolean(this.query), (el) => el.child(this.searchField(t)));
  }

  // A header or floating-top button's click: the search button opens or closes the field
  // (Esc and the field's x close it too), the rest are actions.
  headerClick(act) {
    return (_e, cx) => {
      if (act === "filterToggle") {
        this.filtering = !this.filtering;
        this.settingsOpen = false;
        if (this.filtering) this.input.focus();
        else { this.input.set_value(""); this.query = ""; this.h.focus(); }
      } else this.action(act, cx);
      cx.notify();
    };
  }

  // The search field, under the header, or under the floating top's band.
  searchField(t) {
    const q = this.query.trim();
    return h_flex().id("th-search-field").mx(10).mb(8).h(30).px(8).gap(6).items_center().rounded(7)
        .border_1().border_color(this.filtering ? t.accent : t.border).bg(t.chrome)
        // A click back into a kept search: the typing is the field's again.
        .on_mouse_down("left", (_e, cx) => { this.filtering = true; cx.notify(); })
        .child(svg(ICON("search")).size(13).flex_none().text_color(t.dim))
        .child(Input.new(this.input).flex_1().min_w(0).h_full().text_size(12.5).text_color(t.foreground))
        .when(!q, (el) => el.child(this.kbd(t, "/")))
        .when(Boolean(q), (el) => el.child(div().flex_none().text_size(11.5).font_family(this.mono()).text_color(t.dim)
          .child(this.filterCount())))
        .child(this.iconButton(t, "th-clear", "x", "Clear (Esc)", (_e, cx) => { this.input.set_value(""); this.query = ""; this.filtering = false; this.h.focus(); cx.notify(); }));
  }

  // "3 of 41 · 2 hidden": matching shown turns of all shown turns across every session in
  // the pane, and matches among hidden agent messages. For "#12": where it went.
  filterCount() {
    const n = jumpTarget(this.query);
    if (n != null) return !n ? "turn #" : this.jumpKey(n) ? `turn ${n}` : `no turn ${n}`;
    const q = this.filterText();
    if (!q) return null;
    const status = this.status();
    let shown = 0, hit = 0, hiddenHit = 0;
    this.sessions.forEach((s, si) => s.turns.forEach((t, ti) => {
      const on = isShown(t, { agentTurns: this.prefs.agentTurns, live: this.isLive(s, si, ti, status) });
      const m = threadMatches(s.turns, t, q);
      if (on) { shown++; if (m) hit++; } else if (m) hiddenHit++;
    }));
    return `${hit} of ${shown}${hiddenHit ? ` · ${hiddenHit} hidden` : ""}`;
  }

  // Settings, under the header in the filter field's place: agent messages, the collapsed
  // rows' line limits, and where the file is.
  settingsPanel(t) {
    const P = this.prefs;
    const mono = this.mono();
    const label = (text) => div().flex_1().min_w(0).text_size(12.5).text_color(t.foreground).child(text);
    const step = (id, icon, act, ok) => div().id(id).flex_none().size(24).flex().items_center().justify_center().rounded(5)
      .border_1().border_color(t.border).bg(t.background).cursor_pointer()
      .when(!ok, (el) => el.opacity(0.4))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); if (ok) this.action(act, cx); cx.notify(); })
      .child(svg(ICON(icon)).size(12).text_color(t.muted));
    const stepper = (key, name) => {
      const [lo, hi] = RANGES[key];
      return h_flex().gap(6).items_center()
        .child(label(name))
        .child(step(`th-${key}-minus`, "minus", `${key}:-`, P[key] > lo))
        .child(div().flex_none().w(18).text_center().text_size(12.5).font_family(mono).text_color(t.foreground).child(String(P[key])))
        .child(step(`th-${key}-plus`, "plus", `${key}:+`, P[key] < hi));
    };
    const toggle = (on) => div().flex_none().w(28).h(16).rounded(8).p(2).flex().items_center()
      .when(on, (el) => el.justify_end()).bg(on ? t.ansi5 : t.border)
      .child(div().size(12).rounded(6).bg(on ? t.background : t.muted));
    const sw = toggle(Boolean(P.agentTurns));
    const path = tilde(this.prefsPath());
    return v_flex().mx(10).mb(8).p(10).gap(8).rounded(7).border_1().border_color(t.border).bg(t.chrome)
      .child(h_flex().id("th-set-agents").gap(6).items_center().cursor_pointer()
        .on_click((_e, cx) => { cx.stop_propagation(); this.action("agents", cx); cx.notify(); })
        .child(svg(ICON("bot")).size(13).flex_none().text_color(t.muted))
        .child(label(this.counts().hiddenAll && !P.agentTurns ? `Agent messages · ${this.counts().hiddenAll.toLocaleString()} hidden` : "Agent messages"))
        .child(sw))
      .child(v_flex().gap(2)
        .child(h_flex().id("th-set-time").gap(6).items_center().cursor_pointer()
          .on_click((_e, cx) => { cx.stop_propagation(); this.action("alwaysTime", cx); cx.notify(); })
          .child(svg(ICON("clock")).size(13).flex_none().text_color(t.muted))
          .child(label("Always show time"))
          .child(toggle(Boolean(P.alwaysShowTime))))
        .child(div().pl(19).text_size(11.5).text_color(t.dim).child(P.alwaysShowTime ? "Each message's time shows under its bubble." : "A message's time shows when its turn is selected.")))
      .child(this.widthRow(t, label))
      .child(h_flex().id("th-set-width").gap(6).items_center().cursor_pointer()
        .on_click((_e, cx) => { cx.stop_propagation(); this.action("keepWidth", cx); cx.notify(); })
        .child(svg(ICON("fold-horizontal")).size(13).flex_none().text_color(t.muted))
        .child(label("Keep the pane at this width"))
        .child(toggle(P.readingWidth !== false)))
      .child(stepper("promptLines", "Prompt lines"))
      .child(stepper("replyLines", "Reply lines"))
      .child(div().text_size(11.5).text_color(t.dim).child("Collapsed rows only. Changes apply now."))
      .child(stepper("textSize", "Text size"))
      .child(h_flex().gap(6).items_center()
        .child(label("Your name"))
        .child(h_flex().id("th-set-name").flex_none().w(this.narrow() ? 110 : 150).h(24).px(6).rounded(5).border_1()
          .border_color(this.naming ? t.accent : t.border).bg(t.background).items_center()
          .child(Input.new(this.nameInput).flex_1().min_w(0).h_full().text_size(12.5).text_color(t.foreground))))
      .child(this.swatches(t, "bubbleColor", "Your messages"))
      .child(this.swatches(t, "agentBubbleColor", "Agent messages"))
      .when(Boolean(this.prefsError), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(this.prefsError)))
      // quoteKey and links are edited in the file; the panel says what it read.
      .child(div().text_size(11.5).text_color(t.muted).child(this.settingsLine()))
      .children(this.prefsNotes.slice(0, 4).map((n) => div().text_size(11.5).text_color(t.blocked).child(n)))
      .when(this.prefsNotes.length > 4, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(`and ${this.prefsNotes.length - 4} more notes`)))
      .child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).overflow_hidden().whitespace_nowrap().text_ellipsis_start().text_size(11).font_family(mono).text_color(t.dim).child(path))
        .child(this.button(t, "th-set-copy", this.narrow() ? "Copy" : "Copy path", (_e, cx) => { this.copy(this.prefsPath(), "settings-path", "Settings path copied", cx); }, "copy")))
      .child(h_flex().gap(6)
        .child(this.button(t, "th-set-reset", "Reset to defaults", (_e, cx) => { this.action("resetSettings", cx); cx.notify(); }, "refresh")))
      .when(this.floating(), (el) => el.child(this.aboutRow(t)));
  }

  // Settings' last row with the floating top: the agent, the turn and hidden counts and the
  // session's title, which the header row showed. Its tooltip names the terminal and session.
  aboutRow(t) {
    const agent = this.agent();
    const s = this.current();
    const c = s?.loaded ? this.counts() : null;
    const text = [c ? plural(c.shownCur, "turn") : this.headerText(), c?.hiddenAll ? `${c.hiddenAll.toLocaleString()} hidden` : null, s?.title].filter(Boolean).join(" · ");
    return h_flex().id("th-about").gap(6).items_center().pt(8).border_t_1().border_color(t.border).tooltip(this.bindingTip())
      .child(mark(agent.key, 14) ?? svg(ICON("square-terminal")).size(13).text_color(t.muted))
      .child(div().flex_none().text_size(12).text_color(t.foreground).child(agent.name))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(text))
      .when(this.debug && Boolean(this.timing), (el) => el.child(div().flex_none().max_w(160).truncate().text_size(10.5).font_family(this.mono()).text_color(t.dim).child(this.timing)));
  }

  // Width: Comfortable, Wide and Full side by side, the chosen one filled. In a pane narrower
  // than Comfortable's column all three look the same, and a line under the row says so.
  widthRow(t, label) {
    const cur = this.prefs.width;
    const names = { comfortable: "Comfortable", wide: "Wide", full: "Full" };
    const narrowPx = fitWidth(this.prefs.textSize);
    const same = this.paneW != null && this.paneW < narrowPx - 2;
    return v_flex().gap(4)
      .child(h_flex().gap(6).items_center()
        .child(svg(ICON("move-horizontal")).size(13).flex_none().text_color(t.muted))
        .child(label("Width"))
        .child(h_flex().flex_none().p(2).gap(2).rounded(6).border_1().border_color(t.border).bg(t.background)
          .children(WIDTH_NAMES.map((w) => div().id(`th-width-${w}`).flex_none().h(20).px(this.narrow() ? 5 : 8).rounded(4)
            .flex().items_center().cursor_pointer().text_size(12)
            .bg(w === cur ? t.hover : alpha(t.hover, 0)).text_color(w === cur ? t.foreground : t.muted)
            .hover((st) => st.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); this.action(`width:${w}`, cx); cx.notify(); })
            .child(names[w])))))
      .when(same, (el) => el.child(div().pl(19).text_size(11.5).text_color(t.dim)
        .child(`This pane is narrower than Comfortable (${narrowPx} px), so all three look the same here.`)));
  }

  // A bubble colour setting: its name and the colour's name, then a swatch for each preset
  // (ui.js BUBBLES) and, when the file holds one, its own #rrggbb. The chosen one has a ring.
  swatches(t, key, name) {
    const cur = this.prefs[key];
    const agent = key === "agentBubbleColor";
    const names = Object.keys(BUBBLES);
    const list = cur.startsWith("#") ? [...names, cur] : names;
    const dflt = DEFAULTS[key];
    const shown = cur.startsWith("#") ? cur : `${cur[0].toUpperCase()}${cur.slice(1)}`;
    return v_flex().gap(6)
      .child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.foreground).child(name))
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(cur === dflt ? `${shown} · default` : shown)))
      .child(h_flex().gap(6).flex_wrap().children(list.map((v) => {
        const st = bubbleStyle(v, t, agent);
        const on = v === cur;
        return div().id(`th-${key}-${v}`).flex_none().size(22).rounded(11).p(2).cursor_pointer()
          .border_2().border_color(on ? t.accent : alpha(t.accent, 0))
          .on_click((_e, cx) => { cx.stop_propagation(); this.action(`${key}:${v}`, cx); cx.notify(); })
          .child(div().size_full().rounded(9).bg(st.fill).border_1().border_color(st.outline || v === "plain" ? t.border : st.fill));
      })));
  }

  // The text the list is filtered by: none while the field holds a "#12" jump.
  filterText() { return jumpTarget(this.query) == null ? this.query.trim() : ""; }

  // Turn n of the newest session that has one.
  jumpKey(n) {
    for (let si = this.sessions.length - 1; si >= 0; si--) if (this.sessions[si].turns[n - 1]) return `${si}:${n}`;
    return null;
  }

  // Sets the filter field's text. "#12" selects turn 12 and scrolls to it; a hidden agent
  // turn turns agent messages on first.
  setQuery(text, cx) {
    this.query = text ?? "";
    const n = jumpTarget(this.query);
    const key = n ? this.jumpKey(n) : null;
    if (!key) return;
    if (cx && this.findTurn(key)?.agent && !this.prefs.agentTurns && !this.turnKeys(this.rows()).includes(key)) this.setAgents(true, cx);
    this.sel = key; this.follow = false; this.scrollTo = { key, how: "center" };
  }

  // The first turn of the day before or after the selected turn's day.
  dayStep(dir) {
    const keys = this.turnKeys(this.rows());
    if (!keys.length) return null;
    const day = (k) => this.findTurn(k)?.day ?? dayKey(this.findTurn(k)?.ts);
    let i = Math.max(0, keys.indexOf(this.sel));
    const here = day(keys[i]);
    if (dir > 0) {
      while (i < keys.length && day(keys[i]) === here) i++;
      return keys[i] ?? null;
    }
    while (i > 0 && day(keys[i]) === here) i--;
    const prev = day(keys[i]);
    if (prev === here) return null;
    while (i > 0 && day(keys[i - 1]) === prev) i--;
    return keys[i];
  }

  kbd(t, k) {
    return div().flex_none().px(5).h(18).flex().items_center().rounded(4).border_1().border_color(t.border).bg(t.raised).text_size(10.5).text_color(t.dim).child(k);
  }

  // A tinted banner (guess, error) or a neutral block (ended, moved).
  banner(t, color, icon, title, body, buttons = []) {
    const neutral = !color;
    return v_flex().flex_none().gap(6)
      .when(neutral, (el) => el.px(12).py(10).bg(t.chrome).border_b(1).border_color(t.border))
      .when(!neutral, (el) => el.mx(10).mt(8).p(10).rounded(8).bg(alpha(color, 0.12)).border_1().border_color(alpha(color, 0.33)))
      .child(h_flex().gap(7).items_center()
        .child(svg(ICON(icon)).size(14).flex_none().text_color(color ?? t.muted))
        .child(div().flex_1().min_w(0).text_size(12.5).font_medium().text_color(t.foreground).child(title)))
      .when(Boolean(body), (el) => el.child(div().text_size(12).text_color(t.muted).child(body)))
      .when(buttons.length > 0, (el) => el.child(h_flex().gap(6).flex_wrap().children(buttons)));
  }

  button(t, id, label, onClick, icon) {
    return h_flex().id(id).h(26).px(9).gap(5).items_center().rounded(6).cursor_pointer().bg(t.raised).border_1().border_color(t.border)
      .text_size(12).text_color(t.foreground).hover((s) => s.bg(t.hover))
      .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); })
      .when(Boolean(icon), (el) => el.child(svg(ICON(icon)).size(13).text_color(t.muted)))
      .child(label);
  }

  chooseButton(t, choices) {
    return choices?.length > 1
      ? [this.button(t, "th-choose", `Choose from ${choices.length}…`, (_e, cx) => { this.choices = choices; this.choosing = true; cx.notify(); }, "list")]
      : [];
  }

  // The banners that apply now, as data: [color, icon, title, body, buttons()].
  bannerSpecs(t) {
    const out = [];
    const me = this.me();
    const n = this.current()?.turns.length ?? 0;
    const ended = this.res.ended;
    const at = this.res.endedAt ? ` at ${fmtTime(this.res.endedAt)}` : "";
    if (ended === "closed") {
      out.push([null, "circle-x", `Session ended · ${this.terminal} closed${at}`,
        `The ${plural(n, "turn")} read so far stay here. This pane no longer follows a terminal.`, () => this.closeButtons(t)]);
    } else if (ended === "exited") {
      out.push([null, "circle-x", `Session ended · ${this.agent().cmd} exited${at}`,
        `The ${plural(n, "turn")} read so far stay here. Start ${this.agent().cmd} in ${this.terminal} again and Threads follows the new session.`, () => this.closeButtons(t)]);
    }
    const p = this.pane();
    if (me && p && p.tab !== me.tab) {
      const tab = spaces().flatMap((s) => s.tabs).find((x) => x.id === p.tab);
      out.push([null, "moved", `${this.terminal} moved to tab "${tab?.name ?? "?"}"`,
        "Threads stays where it was opened. Terminal jumps to it; close this pane and open Threads there to follow it.",
        () => [this.button(t, "th-focusb", "Terminal", (_e, cx) => { this.focusTerminal(cx); cx.notify(); }, "square-terminal"), ...this.closeButtons(t, "Close")]]);
    }
    if (this.res.guess && !ended) {
      out.push([t?.working, "alert", "Guessed session",
        "No live record named this terminal's session, so this is the newest transcript for its folder. It may belong to another seat in the same folder.",
        () => this.chooseButton(t, this.res.choices)]);
    }
    const cur = this.current();
    if (cur?.missing)
      out.push([t?.blocked, "alert", "Transcript not found", `${cur.file.split("/").pop()} is no longer on disk. The turns read so far stay here; Threads reads it again if it comes back.`, () => []]);
    if (cur?.error && (cur.loaded || cur.turns.length)) out.push([t?.blocked, "alert", "Could not read the transcript", cur.error, () => [this.retryButton(t)]]);
    return out;
  }

  bannerTitles() { return this.bannerSpecs(theme()).map((b) => b[2]); }

  banners(t) {
    return this.bannerSpecs(t).map(([color, icon, title, body, buttons]) => this.banner(t, color, icon, title, body, buttons()));
  }

  body(t, focusedPanel, cx) {
    const r = this.res;
    const s = this.current();
    if (this.choosing) return this.chooser(t);
    if (r.kind === "resolving" && !s) return this.loading(t, "Finding the session…", null);
    if (r.kind === "remote") return this.empty(t, "messages", "Remote sessions aren't read yet", `${this.terminal} runs on another machine. This version reads sessions on this computer only.`);
    // Amp: why it is not read, in one line, and the README section that says more.
    if (r.kind === "unsupported" && UNREAD[r.key]) {
      const u = UNREAD[r.key];
      return this.empty(t, mark(u.key, 36) ?? "messages", `${u.name} isn't supported`, u.why, "Threads reads only the sessions agents keep on this computer.",
        [this.button(t, "th-why-unread", `Why ${u.name} isn't supported`, () => { exec("open", [u.url]).catch(() => null); }, "info")]);
    }
    if (r.kind === "unsupported") return this.empty(t, "messages", `${r.name} isn't supported yet`, `Threads reads ${AGENT_NAMES.replace(/ or ([^ ]+)$/, " and $1")} sessions. Other terminal panes are left alone.`, null,
      [HARNESS.claude, HARNESS.codex, HARNESS.opencode, HARNESS.pi, HARNESS.cursor, HARNESS.antigravity].map((h) => h_flex().h(22).px(7).gap(5).items_center().rounded(5).border_1().border_color(t.border).text_size(11.5).text_color(t.muted)
        .child(mark(h.key, 12))
        .child(h.key === "claude" ? "Claude Code" : h.name)), true);
    if (r.kind === "gone" && !s) return this.empty(t, "circle-x", "Terminal closed", `${this.terminal} is gone, and nothing was read from it.`, null, this.closeButtons(t));
    if (r.kind === "error" && !s) return this.empty(t, "alert", "Something went wrong", r.error);
    if (r.kind === "none" && !s) return this.notFound(t, r);
    const noTurns = () => this.empty(t, mark(this.agent().key, 36) ?? "messages", "No turns yet", `Send a prompt to ${this.agent().cmd} in ${this.terminal}. Each prompt and its final reply will show up here.`, "Threads only reads the session. It never types into the terminal.");
    if (r.kind === "pending" && !s) return noTurns();
    if (s && !s.loaded && s.error && s.turns.length === 0)
      return this.empty(t, "alert", "Couldn't read this session", s.error, null, [this.retryButton(t), ...this.closeButtons(t)]);
    if (s && !s.loaded && s.turns.length === 0)
      return this.loading(t, `Reading session${s.size && harnessOfFile(s.file) !== "opencode" ? ` (${fmtBytes(s.size)})` : ""}…`, this.readPct(s));
    if (s?.loaded && this.sessions.length === 1 && s.turns.length === 0) return noTurns();
    const rows = this.rows();
    if (s?.loaded && !this.filterText() && !this.turnKeys(rows).length && this.counts().hiddenAll > 0) {
      const n = this.counts().hiddenAll;
      return this.empty(t, "bot", "Nothing you typed yet",
        `Nothing you typed in this session yet. ${plural(n, "agent message")} ${n === 1 ? "is" : "are"} hidden.`, null,
        [this.button(t, "th-show-agents", "Show them", (_e, cx) => { this.setAgents(true, cx); cx.notify(); }, "bot")]);
    }
    const slots = this.slotsMemo;
    const due = this.probeDue();
    // Parts left for later frames (PROBE_MAX): the parts drawn now report their sizes and
    // ask for a frame, but one that never reports would not, so ask here too.
    if (this.probeLeft > 0 && !this.probeNext) {
      this.probeNext = true;
      cx.timer.after(16, (cx) => { this.probeNext = false; cx.notify(); });
    }
    this.flushCode(cx);
    this.flushImages(cx);
    this.flushCalls(cx);
    // Scrolls wait until this frame has laid the list out with its new rows, and until every
    // row has its new shape (SHAPE_MS): the list keeps its offset in px, so a scroll worked out
    // from old heights lands away from its row once the rows above it are reshaped. The next
    // frame is already asked for (render).
    if ((this.toBottom || this.scrollTo) && this.shapeLeft > 0) {
      // A return's wait for the probe (until, below) starts once the rows are reshaped.
      if (this.scrollTo?.until) this.scrollTo.until = Math.max(this.scrollTo.until, Date.now() + 400);
    } else if (this.toBottom && rows.length) {
      this.toBottom = false;
      this.scrollTo = null;
      this.pinningUntil = Date.now() + 1000;
      this.upAt = 0;
      this.downAt = 0;
      cx.timer.after(16, (cx) => { this.scroll.scroll_to_bottom(); cx.notify(); });
    } else if (this.scrollTo?.until && due.length && Date.now() < this.scrollTo.until) {
      // A return waits for the card's parts to be measured: estimates can be off by 100 px,
      // and the list keeps its offset in px, so it would land away from the place.
      cx.timer.after(60, (cx) => cx.notify());
    } else if (this.scrollTo) {
      // A pin's place can be gone (the reply changed): the next best item, then the card.
      const st = this.scrollTo;
      // The pane's own scrolls never count as the person's (stickCheck); debugScroll does.
      if (st.person) { this.upAt = Date.now() + 600; this.downAt = this.upAt; }
      else { this.scrollBusyUntil = Date.now() + 500; this.upAt = 0; this.downAt = 0; }
      let how = st.how;
      let i = -1;
      for (const k of [st.key, ...(st.or ?? [])]) { i = rows.findIndex((x) => x.key === k); if (i >= 0) break; }
      if (i < 0 && st.head) { i = rows.findIndex((x) => x.key === st.head); how = "card"; }
      this.scrollTo = null;
      // A closed or running turn with pasted images has its tiles in the item over its row
      // (wtop): a scroll to the turn takes them along.
      const lead = (k) => (rows[k - 1]?.kind === "wtop" && rows[k - 1].turnKey === rows[k].key ? k - 1 : k);
      // A second press goes on to the place further down the turn, under a line that says the
      // turn starts above, which the next frame's rows carry.
      if (i >= 0 && how === "land" && st.resume) {
        this.pinResume = { key: st.head, part: rows[i].key };
        this.scrollTo = { key: `resume:${st.head}`, how: "land", or: [rows[i].key], until: Date.now() + 400 };
        i = -1;
        cx.timer.after(0, (cx) => cx.notify());
      }
      // A turn's head at the top of the pane, with the note above it when the search hides
      // the turn. It lands like a place, so a head already on screen still goes to the top.
      if (i >= 0 && how === "head") {
        const k = rows[i].key;
        i = lead(i);
        if (rows[i - 1]?.key === `visit:${k}`) i -= 1;
        if (rows[i - 1]?.kind === "pday") i -= 1; // a pin's day header comes with it
        how = "land";
      }
      if (i >= 0 && how === "card") {
        // The card's last part to the near edge, then its head: a card that fits ends up
        // wholly on screen, and a taller one shows from its head down.
        let j = i;
        while (j + 1 < rows.length && CARD.has(rows[j + 1].kind) && rows[j + 1].kind !== "head") j++;
        // A return to a turn the search hides: its note shows above its head.
        let top = lead(i);
        if (rows[top - 1]?.key === `visit:${rows[i].key}`) top -= 1;
        if (rows[top - 1]?.kind === "pday") top -= 1; // a pin's day header comes with it
        cx.timer.after(16, (cx) => { this.scroll.scroll_to_item(j, "top"); cx.notify(); });
        cx.timer.after(48, (cx) => { this.scroll.scroll_to_item(top, "top"); cx.notify(); });
      } else if (i >= 0 && how === "land") {
        // scroll_to_item only brings an item to the nearest edge, so a place below the view
        // would land at the bottom. An item a pane further down first, then the place, which
        // is then above the view and lands at the top.
        i = lead(i);
        let j = i;
        for (let below = 0; j + 1 < rows.length && below < this.listH; j++) below += slots[j];
        cx.timer.after(16, (cx) => { this.scroll.scroll_to_item(j, "top"); cx.notify(); });
        cx.timer.after(48, (cx) => { this.scroll.scroll_to_item(i, "top"); cx.notify(); });
      } else if (i >= 0) {
        const top = lead(i);
        cx.timer.after(16, (cx) => { this.scroll.scroll_to_item(i, how); cx.notify(); });
        if (top !== i) cx.timer.after(48, (cx) => { this.scroll.scroll_to_item(top, how); cx.notify(); });
      }
    }
    const dim = Boolean(this.res.ended);
    const sticky = this.stickyDay();
    this.stickyShown = sticky?.key ?? null;
    this.stickyNow = sticky;
    // The Pinned view's day while scrolling has a strip of its own above the list, so it never
    // covers a message or a control. The strip stays while the list has day bands (it shows
    // nothing while a band is at the top), so the list does not move when the day appears.
    // The floating top shows a pill over the list instead, only while scrolling (floatTop).
    const strip = !this.floating() && this.hasDayStrip(rows);
    return v_flex().id("threads-body").flex_1().min_h(0).relative()
      .on_mouse_move((e, cx) => {
        const x = e.local_position?.x;
        this.mouseX = x == null ? null : x / this.zoom() - this.colLeft();
        this.notePointer(e.position, cx);
      })
      // Where the press landed, for the action bar (a list item takes one click handler,
      // so its parts are told apart by position), in design px.
      .on_mouse_down("left", (e, cx) => {
        const x = e.local_position?.x;
        const w = e.bounds?.width;
        // In the column's own px: a centred column starts colLeft() in.
        this.pressX = x == null ? null : x / this.zoom() - this.colLeft();
        this.bodyW = w == null ? null : Math.min(w / this.zoom(), this.width);
        this.pressAt = e.position ? { x: e.position.x, y: e.position.y } : null;
        this.pressMoved = 0;
        this.pressCount = e.click_count ?? 1;
        // A double or triple press selects a word or a paragraph straight away.
        if (this.pressCount > 1) this.liftFill(this.sel, cx);
        this.notePress(cx);
      })
      .when(strip, (el) => el.child(h_flex().id("th-day-strip").h(DAY_STRIP).flex_none().w_full().justify_center().items_center().bg(t.background)
        .border_b_1().border_color(sticky ? t.border : t.background)
        .when(Boolean(sticky), (el) => el.child(div().id("th-sticky-day").child(this.dayPill(t, sticky))))))
      .child(div().id("threads-listbox").flex_1().min_h(0).w_full().relative()
        .on_size_change((size, cx) => { const h = size.height / this.zoom(); if (Math.abs(h - this.listH) > 1) { this.listH = h; cx.notify(); } })
        .on_scroll_wheel((e) => this.listWheel(e))
        .child(h_flex().size_full().justify_center().child(div().h_full().w_full().max_w(this.pw() > this.width + 1 ? this.width : this.pw() + 1000)
          .child(v_virtual_list("threads-list", rows.length, slots, (i) => rows[i]?.key ?? `gone:${i}`,
            (range) => this.listItems(t, rows, slots, range, focusedPanel, dim))
            .track_scroll(this.scroll)
            .on_item_click((key, cx) => this.click(key, cx))
            .size_full())))
        .when(this.railShown(), (el) => el.child(this.railView(t))))
      .when(Boolean(s && !s.loaded && !s.error), (el) => el.child(this.progress(t, s)))
      .when(due.length > 0, (el) => el.child(this.probe(t, due)));
  }

  progress(t, s) {
    const pct = this.readPct(s);
    return div().absolute().top(0).left(0).right(0).h(3).bg(t.border)
      .child(pct != null ? div().h_full().w(`${pct}%`).bg(t.accent) : div().h_full().w("30%").bg(t.accent).loop("opacity", { from: 0.3, to: 1, period: 1100 }));
  }

  retryButton(t) {
    return this.button(t, "th-retry", "Retry", (_e, cx) => this.retryRead(cx), "refresh");
  }

  loading(t, label, pct) {
    const bar = (w) => div().h(10).w(w).rounded(4).bg(t.raised);
    return v_flex().flex_1().min_h(0).p(14).gap(14)
      .child(v_flex().gap(6)
        .child(div().text_size(12).text_color(t.dim).child(label + (pct != null ? ` ${pct}%` : "")))
        .child(div().h(3).w_full().rounded(2).bg(t.border).overflow_hidden()
          .child(pct != null ? div().h_full().w(`${pct}%`).bg(t.accent)
            : div().h_full().w("30%").bg(t.accent).loop("opacity", { from: 0.3, to: 1, period: 1100 }))))
      .children([0, 1, 2, 3].map((i) => v_flex().gap(7).loop("opacity", { from: 0.45, to: 0.9, period: 1400 })
        .child(bar("40%")).child(bar(i % 2 ? "82%" : "70%")).child(bar(i % 2 ? "55%" : "64%"))));
  }

  closeButtons(t, label = "Close pane") {
    const me = this.me();
    return me ? [this.button(t, "th-close-empty", label, () => run("pane.close", { pane: me.pane }), "x")] : [];
  }

  // icon: a Lucide icon's name, or an element (an agent's mark). wrap: the buttons wrap onto
  // more lines.
  empty(t, icon, title, body, foot, buttons = [], wrap = false) {
    return v_flex().flex_1().min_h(0).p(20).gap(10).items_center().justify_center()
      .child(typeof icon === "string"
        ? div().size(36).rounded(9).bg(t.raised).flex().items_center().justify_center().child(svg(ICON(icon)).size(18).text_color(t.muted))
        : icon)
      .child(div().text_size(14).font_semibold().text_color(t.foreground).child(title))
      .child(div().max_w(300).text_size(12.5).text_color(t.muted).text_center().child(body))
      .when(Boolean(foot), (el) => el.child(div().max_w(300).text_size(11.5).text_color(t.dim).text_center().child(foot)))
      .when(buttons.length > 0, (el) => el.child(h_flex().mt(4).gap(6).when(wrap, (row) => row.max_w(340).flex_wrap().justify_center()).children(buttons)));
  }

  notFound(t, r) {
    const steps = r.tried ?? [];
    return v_flex().flex_1().min_h(0).p(12).gap(10)
      .child(h_flex().gap(10).items_center()
        .child(div().flex_none().size(32).rounded(8).bg(t.raised).flex().items_center().justify_center()
          .child(svg(ICON("file-search")).size(16).text_color(t.muted)))
        .child(div().flex_1().min_w(0).text_size(14).font_semibold().child(`No session found for ${this.terminal}`)))
      .child(div().text_size(12).text_color(t.muted).child(r.claude
        ? "Claude runs in this pane, but no transcript could be matched."
        : `No ${AGENT_NAMES} process runs in ${this.terminal}, and no transcript was matched for its folder.`))
      .child(v_flex().rounded(8).bg(t.chrome).border_1().border_color(t.border).overflow_hidden()
        .child(div().px(10).pt(9).pb(7).text_size(10.5).font_semibold().text_color(t.dim).child("WHAT WE TRIED"))
        .children(steps.map((x) => h_flex().px(10).py(8).gap(8).items_start().border_t(1).border_color(t.border)
          .child(svg(ICON(x.ok ? "circle-check" : "circle-x")).size(13).mt(2).flex_none().text_color(x.ok ? t.done : t.dim))
          .child(v_flex().min_w(0).gap(1)
            .child(div().text_size(12).text_color(t.foreground).child(x.what))
            .child(div().text_size(11).font_family(this.mono()).text_color(t.dim).child(x.detail))))))
      .child(h_flex().gap(6).flex_wrap()
        .child(this.button(t, "th-retry", "Retry", (_e, cx) => { this.res = { kind: "resolving" }; this.resolve(cx); cx.notify(); }, "refresh"))
        .children(this.chooseButton(t, r.choices))
        .children(this.closeButtons(t)))
      .when(!r.harness, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Starting claude with --resume, or upgrading Claude Code, makes the match exact.")));
  }

  chooser(t) {
    const list = this.choices ?? [];
    return v_flex().flex_1().min_h(0).p(12).gap(8)
      .child(div().text_size(13.5).font_semibold().child(`Choose the session for ${this.terminal}`))
      .child(div().text_size(12).text_color(t.muted).child(["opencode", "pi", "cursor"].includes(this.res?.harness) ? `Newest first. ${this.agent().name} doesn't record which terminal runs a session. Threads stays on the one you pick.` : "Newest first. Transcripts another running claude writes are left out. Threads stays on the one you pick."))
      .children(list.map((c, i) => h_flex().id(`th-choice-${i}`).px(10).py(8).gap(9).items_center().rounded(7).cursor_pointer()
        .bg(t.raised).border_1().border_color(t.border).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { cx.stop_propagation(); this.pick(c, cx); })
        .child(svg(ICON("messages")).size(14).flex_none().text_color(t.muted))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(c.label ? div().text_size(12.5).text_color(t.foreground).truncate().child(c.label) : div().text_size(12.5).font_family(this.mono()).text_color(t.foreground).child(idOf(c.path).slice(0, 8)))
          .child(div().text_size(11.5).text_color(t.dim).child(`modified ${when(c.mtime)}${c.size == null ? "" : ` · ${fmtBytes(c.size)}`}${i === 0 ? " · newest" : ""}`)))))
      .child(h_flex().gap(6).child(this.button(t, "th-choose-cancel", "Cancel", (_e, cx) => { this.choosing = false; cx.notify(); }, "x")));
  }

  // ---- list items (no handlers in here: clicks arrive through on_item_click) ----

  meta(turn) {
    const st = stats(turn);
    const parts = [];
    if (st.tokens) parts.push(fmtTokens(st.tokens));
    if (turn.durationMs) parts.push(fmtDuration(turn.durationMs));
    return parts.join(" · ");
  }

  // The meta line's parts as text, for the debug report.
  metaText(turn, live = false) {
    const out = [];
    if (turn.agent) out.push(`[${senderLabel(turn.sender, this.width)}]`);
    out.push(`#${turn.n}`, live ? "now" : fmtTime(turn.ts));
    if (turn.followups > 0) out.push(`bell ${countLabel(turn.followups)}`);
    if (turn.tools > 0 && !this.narrow() && !live) out.push(`wrench ${turn.tools}`);
    const m = this.meta(turn);
    if (m) out.push(m);
    return out.join(" ");
  }

  // An error is all this row has: no reply, and none on a later row.
  failed(turn) { return turn.errors.length > 0 && !turn.answeredIn && !this.replyText(turn); }

  statusIcon(t, turn) {
    if (turn.interrupted) return svg(ICON("ban")).size(12).flex_none().text_color(t.blocked);
    if (this.failed(turn)) return svg(ICON("alert")).size(12).flex_none().text_color(t.blocked);
    return svg(ICON("circle-check")).size(12).flex_none().text_color(t.done);
  }

  // One line of text with the filter's matches marked; the start is cut so the first match
  // shows. The last piece truncates.
  hlLine(t, text, color) {
    const q = this.filterText();
    if (!q || !text.toLowerCase().includes(q.toLowerCase()))
      return div().flex_1().min_w(0).truncate().text_color(color).child(text);
    const parts = spans(around(text, q), q);
    const nb = (s) => s.replace(/^ | $/g, "\u00a0");
    return h_flex().flex_1().min_w(0).overflow_hidden().children(parts.map((p, i) => p.hit
      ? div().flex_none().rounded(3).bg(alpha(t.working, 0.32)).text_color(t.foreground).child(p.t)
      : (i === parts.length - 1 ? div().flex_1().min_w(0).truncate() : div().flex_none()).text_color(color).child(nb(p.t))));
  }

  // Lines already clipped to fit (rowLines), each one line high, with filter matches marked.
  // A line that turns out wider than its estimate truncates instead of wrapping, so the
  // row keeps the height the list was given.
  lines(t, lines, color, size, lh) {
    const q = this.filterText();
    return v_flex().flex_1().min_w(0).text_size(size).children(lines.map((l) => {
      const row = h_flex().h(lh).min_w(0).items_center().overflow_hidden();
      if (!q || !l.toLowerCase().includes(q.toLowerCase())) return row.child(div().flex_1().min_w(0).truncate().text_color(color).child(l));
      const parts = spans(l, q);
      return row.children(parts.map((p, i) => p.hit
        ? div().flex_none().rounded(3).bg(alpha(t.working, 0.32)).text_color(t.foreground).child(p.t)
        : (i === parts.length - 1 ? div().flex_1().min_w(0).truncate() : div().flex_none()).text_color(color).child(p.t.replace(/^ | $/g, "\u00a0"))));
    }));
  }

  // The sender label colour for this theme: ansi5, or ansi5 mixed toward the foreground
  // where ansi5 is under 4.5:1 on the background.
  agentColor(t) {
    const k = `${t.ansi5}|${t.foreground}|${t.background}`;
    if (this.agentColorKey !== k) { this.agentColorKey = k; this.agentColorMemo = labelColor(t.ansi5, t.foreground, t.background); }
    return this.agentColorMemo;
  }

  // A command's name, quiet: mono 12.5 px regular in muted (foreground where muted reads
  // under 4.5:1 on the row's background, selected or not: ui.js commandColor), no fill and
  // no hue; the leading "/" and the mono face mark it. A bare command (no arguments) draws
  // its name in foreground. Long names are cut in the middle. A filter hit keeps its tint.
  chip(t, label, maxW, bare = false, selected = false) {
    const q = this.filterText().toLowerCase();
    const hit = Boolean(q) && label.toLowerCase().includes(q);
    return div().flex_none().h(18).max_w(maxW).flex().items_center().rounded(4)
      .when(hit, (el) => el.px(3).bg(alpha(t.working, 0.32)))
      .text_size(12.5).font_family(this.mono()).text_color(hit || bare ? t.foreground : this.cmdColor(t, selected))
      .child(div().min_w(0).overflow_hidden().whitespace_nowrap().text_ellipsis_middle().child(label));
  }
  cmdColor(t, selected = false) {
    const k = `${t.muted}|${t.foreground}|${t.background}|${t.selected}`;
    if (this.cmdColorKey !== k) { this.cmdColorKey = k; this.cmdColorMemo = [commandColor(t), commandColor(t, true)]; }
    return this.cmdColorMemo[selected ? 1 : 0];
  }

  // A quote line's bar: 2 px, foreground at 28% (dim on agent rows).
  quoteBar(t, agent, h = this.rt().line - 4) {
    return div().flex_none().w(2).h(h).rounded(1).bg(agent ? t.dim : alpha(t.foreground, 0.28));
  }

  // Wrapped text with the filter's matches marked, word by word.
  hlBlock(t, text, color) {
    const q = this.filterText();
    if (!q || !text.toLowerCase().includes(q.toLowerCase())) return div().text_color(color).child(text);
    return v_flex().children(text.split("\n").map((line) => h_flex().flex_wrap().min_h(LINE).children(
      spans(line, q).flatMap((p) => p.hit
        ? [div().rounded(3).bg(alpha(t.working, 0.32)).text_color(t.foreground).child(p.t)]
        : p.t.split(/(?<=\s)/).filter(Boolean).map((w) => div().text_color(color).child(w.replace(/\s$/, " ")))))));
  }

  // ---- heights ----
  // A virtual list places rows by the heights it is given, so each item states its own.
  // Text height is estimated from the pane width (on_size_change) and average glyph
  // widths; prose that runs past its estimate scrolls inside its box. The figures come
  // from the drawn panels in the earlier screenshots: 13 px text is about 18 px a line and
  // 5.4 to 5.8 px a character; the estimates allow a little more for word wrapping.

  wrapped(text, width, charW) { return wrappedLines(text, Math.floor(width / charW)); }
  // An open turn's text width: 16 px in from each side, where a closed exchange's text is.
  inner() { return Math.max(120, replyWidth(this.width)); }
  // Reading text (ui.js readType): its size and line, an estimated character's width at that
  // size, and the width of a reading line: the card's text width, at most about 70
  // characters.
  rt() { return readType(this.prefs.textSize); }
  charW(at13) { return at13 * (this.rt().size / 13); }
  prose() { return Math.max(120, readWidth(this.width, this.prefs.textSize, this.chars())); }
  perLine() { return Math.max(8, Math.floor(rowTextWidth(this.width, false, this.prefs.textSize, this.chars()) / this.charW(YOU_CHAR))); }
  // A reading block: the reading size and line, at most a reading line wide.
  readBlock(el) { const { size, line } = this.rt(); return el.w_full().max_w(this.prose()).text_size(size).line_height(`${line}px`); }
  // Markdown for TextView: dollar signs escaped (escapeDollars), and split into blocks short
  // enough for Herdr to draw (mdChunks). Kept for the text last asked for, as it is redrawn often.
  mdParts(md) {
    const memo = (this.mdMemo ??= new Map());
    let parts = memo.get(md);
    if (!parts) {
      parts = mdChunks(escapeDollars(md));
      if (memo.size > 300) memo.clear();
      memo.set(md, parts);
    }
    return parts;
  }
  // One TextView, or several stacked a paragraph apart when the Markdown is too long for one.
  mdView(id, md, selectable) {
    const parts = this.mdParts(md);
    if (parts.length === 1) return TextView.markdown(id, parts[0]).selectable(selectable).w_full();
    return v_flex().w_full().gap(this.paraGap()).children(parts.map((p, i) => TextView.markdown(`${id}-${i}`, p).selectable(selectable).w_full()));
  }
  // The space between paragraphs, for estimates: TextView's own, about 12 px at 13 px.
  paraGap() { return Math.round((12 * this.rt().size) / 13); }

  // A collapsed row's reply block, as a probe part of its own: "cmd:<turn key>".
  cmdRow(r) { return { kind: "cmd", key: `cmd:${r.key}`, turn: r.turn, md: r.shape.md, est: r.shape.mdEst }; }

  // First-frame estimate of Markdown at the reading width: reading lines, a paragraph gap
  // between blocks, and one spare line so it does not run short. The probe's measure
  // replaces it. Kept per text until the width or the type changes: every rebuild of the
  // rows asks again for each text in the list, and a turn's open work can hold hundreds of
  // them. Worked out afresh on each rebuild, they ran past Herdr's time for a draw ("This
  // view could not be re-rendered", interrupted). New texts share the reshaping time
  // (SHAPE_MS): past it a text gets a rough height from its length, and the next frame
  // works it out (render).
  mdHeight(md) {
    const w = this.prose();
    const { line } = this.rt();
    const cw = this.charW(MD_CHAR);
    const gap = this.paraGap();
    const geo = `${w}|${line}|${cw}|${gap}`;
    if (this.mdHeights?.geo !== geo || this.mdHeights.map.size > 4000) this.mdHeights = { geo, map: new Map() };
    const known = this.mdHeights.map.get(md);
    if (known != null) return known;
    if ((this.shapeSpent ?? 0) > (this.shapeBudget ?? SHAPE_MS)) {
      this.shapeLeft = (this.shapeLeft ?? 0) + 1;
      return (Math.ceil((md.length * cw) / Math.max(w, 1)) + 1) * line;
    }
    const t0 = now();
    let h = 0;
    const blocks = md.split(/\n{2,}/);
    for (const b of blocks) h += this.wrapped(b.replace(/[*_`#>]/g, ""), w, cw) * line;
    h += (blocks.length - 1) * gap + line;
    this.mdHeights.map.set(md, h);
    this.shapeSpent = (this.shapeSpent ?? 0) + (now() - t0);
    return h;
  }

  chipRows(texts) {
    const w = this.inner();
    let rows = 1;
    let x = 0;
    for (const s of texts) {
      const cw = s.length * 7 + 14 + 16;
      if (x && x + 5 + cw > w) { rows++; x = cw; } else x += (x ? 5 : 0) + cw;
    }
    return rows;
  }

  // The stat chips, in order, as [id, icon, label] (C2: plain names, explained by the legend).
  statChips(turn) {
    const st = stats(turn);
    const model = [shortModel(turn.model), turn.effort].filter(Boolean).join(" · ");
    return [
      this.showTokens(st) ? ["tokens", "arrows", `${fmtTokens(st.tokens)} tokens`] : null,
      turn.durationMs ? ["duration", "clock", fmtDuration(turn.durationMs)] : null,
      model ? ["model", "cpu", model] : null,
      ["tools", "wrench", plural(turn.tools, "tool call")],
      st.cachePct != null ? ["cache", "database", `cache hit ${fmtPct(st.cachePct)}`] : null,
      turn.compactions ? ["compacted", "unfold", "context compacted"] : null,
    ].filter(Boolean);
  }
  statTexts(turn) { return this.statChips(turn).map((c) => c[2]); }

  // Codex, OpenCode, Pi and Cursor can leave a turn with no usage on record (one stopped early), and "0 tokens"
  // would claim a count nobody made. Claude Code's cards keep the chip they always had.
  showTokens(st) { return st.tokens > 0 || this.agent().key === "claude"; }

  // The legend under the stats (i, or a click on the stats): one plain sentence for each
  // chip the card shows, "context compacted" first, then the counts line. [icon, text].
  legendEntries(turn) {
    const chips = this.statChips(turn);
    const counts = Boolean(this.countsLine(turn));
    const who = this.agent().short;
    const say = {
      compacted: `context compacted: the conversation got long, so ${who} summarised the earlier part to free room. Some earlier detail is condensed.`,
      tokens: `tokens: text ${who} newly read and wrote this turn.${counts ? " Re-reading its cache is not counted, so it can be far smaller than the cache read count above." : ""}`,
      duration: `duration: how long ${who} worked on this turn, from the prompt to its final reply.`,
      model: "model · effort: the model that answered, and the effort level it was set to.",
      tools: `tool calls: commands, file reads and edits ${who} ran for this turn. They are not shown here.`,
      cache: `cache hit: share of the prompt ${who} read back from its cache instead of processing it again. High is normal on a long session, and cheaper.`,
    };
    const order = ["compacted", "tokens", "duration", "model", "tools", "cache"];
    const out = order.flatMap((id) => { const c = chips.find((x) => x[0] === id); return c ? [[c[1], say[id]]] : []; });
    if (counts) out.push(["list", "cache read · written · new input: the exact counts behind cache hit: tokens read from the cache, written to it, and new input."]);
    return out;
  }

  // The raw counts under the stat chips (a list item cannot carry the chip's tooltip).
  countsLine(turn) {
    const st = stats(turn);
    return st.cachePct == null ? null : cacheLine(st);
  }

  // The prompt text of the YOU block: a command's arguments (its name is on its own line),
  // or the prompt.
  youSource(turn) {
    const c = commandParts(turn);
    return c ? c.args : turn.prompt;
  }

  // The YOU block's text: the whole prompt with Show all, else each quote run cut to 2
  // lines and the comment to PROMPT_LINES wrapped lines (ui.js clipYou).
  youClip(turn, full = false) {
    const src = this.youSource(turn);
    return full ? { text: src.replace(/\s+$/, ""), more: 0 } : clipYou(src, { quoteLines: 2, commentLines: PROMPT_LINES, per: this.perLine(), maxChars: PROMPT_CHARS });
  }
  youText(r) { return this.youClip(r.turn, r.full); }

  // "YOU", "YOU · COMMAND" or "FROM T7 REVIEW".
  youLabel(turn) {
    if (turn.agent) return turn.sender?.name ? `FROM ${turn.sender.name.toUpperCase()}` : kindWords(turn.sender).toUpperCase();
    return turn.cmd ? "YOU · COMMAND" : "YOU";
  }

  // The YOU block as TextView Markdown (ui.js promptMd: quotes as blockquotes, code kept,
  // everything else escaped, link rules applied), or, when the filter matches the prompt,
  // its runs for the highlighting path. Kept on the turn until an input changes.
  youMd(r) {
    const src = this.youSource(r.turn);
    const q = this.filterText();
    const hl = Boolean(q) && src.toLowerCase().includes(q.toLowerCase());
    // TextView draws Markdown in the theme's text colour, whatever its parent sets, which
    // does not read on a coloured bubble. There the message is plain text in the bubble's
    // ink, quotes behind their bar, as for a filter match.
    const plain = hl || (r.turn.agent ? this.prefs.agentBubbleColor : this.prefs.bubbleColor) !== "plain";
    const sig = `${r.full ? 1 : 0}|${this.perLine()}|${Math.round(this.width)}|${this.prefs.textSize}|${this.prefs.width}|${this.linksVer}|${this.remote.repo ?? ""}|${src.length}|${hl ? q : ""}|${plain ? 1 : 0}`;
    if (r.turn.youMemo?.sig === sig) return r.turn.youMemo.v;
    const c = this.youText(r);
    // Show all reads up to 200,000 characters of the prompt, and says what it leaves out.
    const max = r.full ? FULL_PROMPT_CHARS / 8 : 4000;
    const parts = plain ? promptParts(c.text, max) : null;
    const m = plain ? { md: "", quotes: parts.filter((x) => x.quote).length, code: 0, links: 0, cut: Math.max(0, c.text.length - max * 8) }
      : promptMd(c.text, { links: this.links, repo: this.remote.repo, owner: this.remote.owner, max });
    const extra = 6 * m.quotes + 16 * m.code;
    // The bubble: as wide as the widest line, at most bubbleMax.
    const bmax = bubbleMax(this.width, this.prefs.textSize, this.chars());
    const yc = this.charW(YOU_CHAR);
    const widest = c.text.split("\n").slice(0, 400).reduce((w, l) => Math.max(w, l.length), 0);
    const bw = Math.min(bmax, Math.max(r.turn.agent ? 160 : 120, Math.ceil(widest * yc) + 2 * ROW.BUBBLE_PX + 8, m.quotes || m.code ? bmax : 0));
    const per = Math.max(8, Math.floor((bw - 2 * ROW.BUBBLE_PX) / yc));
    const n = wrappedLines(c.text, per);
    // One spare line, so the first frame's estimate does not run short.
    const raw = c.text ? (n + 1) * this.rt().line + extra : 0;
    // Taller than YOU_MAX: a box of that height that scrolls (Show all on a long paste).
    const capped = raw >= YOU_MAX;
    const v = { ...m, text: c.text, more: c.more, hl, plain, parts, extra, bw, bodyH: Math.min(YOU_MAX, raw), capped };
    r.turn.youMemo = { sig, v };
    return v;
  }

  youHeight(r) {
    const y = this.youMd(r);
    const clipped = !r.full && y.more > 0;
    const canLess = r.full && this.youClip(r.turn).more > 0;
    const chip = r.turn.cmd ? this.rt().line + 4 : 0;
    const label = r.turn.agent ? 16 + 4 : 0;
    // 8 padding, the sender (an agent's), the text, Show all or Show less, 8 padding.
    return 8 + label + chip + (y.text ? y.bodyH : 0) + (clipped || canLess ? 22 : 0) + 8;
  }

  // The caption under an open turn's line: what the reply does not show, [icon, text]. The
  // agent's name in a session where more than one agent replied leads the line itself.
  captionParts(turn) {
    const out = [];
    if (turn.followups > 0) out.push(["bell", plural(turn.followups, "background update")]);
    const by = this.borrowedFrom(turn);
    if (by) out.push(["bot", `shared with agent message #${by.n}${by.sender?.name ? ` from ${by.sender.name}` : ""}`]);
    return out;
  }

  // Lines the caption takes when it wraps: the label, then each part (icon + text).
  captionRows(turn) {
    const w = this.inner();
    const parts = this.captionParts(turn);
    if (!parts.length) return 0;
    let rows = 1;
    let x = 0;
    for (const [, text] of parts) {
      const cw = (x ? 10 : 0) + 12 + 4 + [...text].length * 6.3;
      if (x && x + 6 + cw > w) { rows++; x = cw; } else x += (x ? 6 : 0) + cw;
    }
    return rows;
  }

  // What a closed row gives to the wtop item over it when split (closedRows): its top
  // padding, its meta line and its tiles. Their gap stays, as the top of the row.
  splitCut(r) {
    if (!r.split) return 0;
    return ROW.PAD_T + (r.turn.agent ? ROW.META + ROW.GAP : 0) + thumbSize(this.width, this.prefs.textSize, this.chars());
  }

  // A part's list height: what the probe measured for it, else the estimate. A collapsed
  // row with a Markdown reply adds its block's measure to the rest of the row.
  height(r) {
    if (r.kind === "turn" && r.shape?.md != null) {
      const m = this.measured(this.cmdRow(r));
      return (m != null ? r.shape.mdBase + m : r.shape.height) - this.splitCut(r);
    }
    if (PROBED.has(r.kind)) {
      const m = this.measured(r);
      if (m != null) return r.kind === "latest" && !r.md ? 6 + this.latestBox(r) + (this.latestCut(r) ? 22 : 0) : m;
    }
    return this.estimate(r);
  }

  estimate(r) {
    const w = this.inner();
    switch (r.kind) {
      case "spacer": return r.h;
      case "gap": return r.h;
      case "tail": return r.h;
      case "turn": return r.shape.height - this.splitCut(r);
      case "wrow": return r.shape.height - (r.split ? ROW.PAD_T + (r.turn.agent ? ROW.META + ROW.GAP : 0) - ROW.GAP : 0);
      case "wtop": return ROW.PAD_T + (r.turn.agent ? ROW.META + ROW.GAP : 0) + thumbSize(this.width, this.prefs.textSize, this.chars());
      case "wake": return WAKE_H;
      case "line": return outlineHeight(this.prefs.textSize);
      case "cmd": return r.est;
      case "imgs": return 8 + thumbSize(this.width, this.prefs.textSize, this.chars());
      case "divider": return 36;
      case "day": return 46;
      case "pday": return PDAY_H;
      case "hidden": return 28;
      case "note": return 34;
      case "resume": return 30;
      case "working": {
        const g = this.workingGeom(r.turn);
        return (r.split ? ROW.GAP : ROW.PAD_T + (r.turn.agent ? ROW.META + ROW.GAP : 0)) + 2 * ROW.BUBBLE_PY + g.lines * this.rt().line
          + ROW.GAP + ROW.META + ROW.GAP + ROW.LINE + ROW.GAP + g.note * NOTE_LINE + ROW.PAD_B;
      }
      case "head": return ROW.PAD_T;
      case "ustrip": return ROW.GAP + ROW.META;
      case "you": return this.youHeight(r);
      case "rhead": return ROW.GAP + ROW.LINE + (this.captionRows(r.turn) ? 6 + this.captionRows(r.turn) * 18 : 0);
      case "lhead": return 14 + TV_LINE;
      case "latest": return 6 + (r.md ? this.mdHeight(r.md) + 22 : this.latestBox(r) + (this.latestCut(r) ? 22 : 0));
      case "noreply": return 6 + TV_LINE * (this.wrapped(this.noReplyText(r.turn), w, MD_CHAR) + 1);
      case "md": return (r.gap ?? 6) + this.mdHeight(r.src ?? r.md);
      case "seltext": return 6 + 22 + r.boxH;
      case "codehead": return 8 + 28;
      case "code": return this.codeBoxH(r) + (r.caption ? 24 : 0);
      case "fold": return 8 + 26 + (r.left ? 18 : 0);
      case "itext": return 6 + this.mdHeight(r.src);
      case "grp": return STEP_GAP + GROUP_H;
      case "call": return r.one ? STEP_GAP + GROUP_H : CALL_H;
      case "cout": return outHeight(r.box, r.all);
      case "wspin": return STEP_GAP + GROUP_H;
      case "stats": {
        const line = this.countsLine(r.turn);
        const lines = Math.max(1, Math.ceil((this.statsFull(r.turn).length * 11.5 * MONO_EM) / (this.inner() - 18)));
        return 10 + lines * 16 + (line ? this.countsHeight(line) : 0);
      }
      case "legend": {
        const per = (w - 17) / 5.9;
        const lines = this.legendEntries(r.turn).reduce((n, [, text]) => n + wrappedLines(text, Math.floor(per)), 0);
        return 6 + (lines + 1) * 19 + (this.legendEntries(r.turn).length - 1) * 4;
      }
      case "copy": return ROW.GAP + ROW.ACTS + ROW.PAD_B;
    }
    return 30;
  }

  // The counts line's first-frame height: 6 px above, then 16 px lines of 11 px mono at
  // 0.6 em a character (C1).
  countsHeight(line, w = this.inner()) {
    return 6 + Math.max(1, Math.ceil((line.length * 11 * MONO_EM) / w)) * COUNTS_LINE;
  }

  // ---- measured heights (V3b) ----
  // gpui gives no text measure, but on_size_change reports an element's laid-out height.
  // So each open-card text part is drawn a second time in a hidden probe outside the list
  // (probe()), at the card's text width and with no fixed height; its height, divided by
  // zoom, becomes the part's list size. A measure is kept under the part's key with a
  // signature of everything that changes its layout.

  partSig(r) {
    const head = `${Math.round(this.width)}|${this.zoom()}|${settings()?.ui_font ?? ""}|${this.prefs.textSize}|${this.prefs.width}|${r.kind}`;
    switch (r.kind) {
      case "you": { const y = this.youMd(r); return `${head}|${y.text.length}|${y.more}|${r.full ? 1 : 0}|${y.hl ? this.filterText() : ""}|${y.plain ? 1 : 0}|${y.capped ? 1 : 0}|${this.linksVer}|${this.remote.repo ?? ""}`; }
      case "rhead": return `${head}|${this.captionParts(r.turn).map((x) => x[1]).join("|")}`;
      case "itext": return `${head}|${r.md.length}|${this.linksVer}`;
      case "md": return `${head}|${r.md.length}|${r.gap ?? 6}|${this.linksVer}|${this.remote.repo ?? ""}|${this.mdBroken?.has(r.key) ? "plain" : "md"}`;
      case "cmd": return `${head}|${r.md.length}|${r.md.slice(-24)}`;
      case "lhead": return `${head}|${r.turn.followups}`;
      case "latest": return `${head}|${r.md ? `all${r.md.length}` : r.text.length}`;
      case "stats": return `${head}|${this.statTexts(r.turn).join("|")}|${this.countsLine(r.turn) ?? ""}|${this.legendOn ? 1 : 0}`;
      case "legend": return `${head}|${this.legendEntries(r.turn).map((x) => x[1].length).join(",")}`;
      case "noreply": return `${head}|${this.noReplyText(r.turn)}`;
      default: return head;
    }
  }

  // The measured height of a part for its current layout, or null.
  measured(r) {
    const m = this.meas?.get(r.key);
    return m && m.h > 0 && m.sig === this.partSig(r) ? m.h : null;
  }

  // A probe entry reported its size: keep it, and update only that part's list size.
  probed(key, sig, size, cx) {
    const h = Math.ceil(size.height / this.zoom() - 1e-6);
    if (!(h > 0)) return;
    this.meas ??= new Map();
    // A reply block with text that measured no taller than its gap: Herdr drew nothing, so it
    // is drawn again as plain text (partContent), and measured again.
    const part = key.startsWith("md:") ? this.baseRows?.[this.baseIndex?.get(key)] : null;
    if (part?.kind === "md" && part.key === key && !this.mdBroken?.has(key) && h <= (part.gap ?? 6) + 2 && (part.src ?? part.md ?? "").trim()) {
      (this.mdBroken ??= new Set()).add(key);
      this.meas.delete(key);
      cx.notify();
      return;
    }
    const was = this.meas.get(key);
    if (was?.sig === sig && was.h === h) return;
    if (this.meas.size > 2000) this.meas.clear();
    this.meas.set(key, { sig, h });
    const rowKey = key.startsWith("cmd:") ? key.slice(4) : key;
    const i = this.baseIndex?.get(rowKey);
    const r = i != null ? this.baseRows[i] : null;
    if (r?.key === rowKey) {
      this.baseSizes[i] = this.height(r);
      this.sizesVer = (this.sizesVer ?? 0) + 1;
    }
    cx.notify();
  }

  // The parts still to measure, each drawn in the probe for at most three frames: a part
  // that never reports keeps its estimate (the debug report says "measured: none").
  probeDue() {
    const want = [];
    this.probeTries ??= new Map();
    for (const r of this.probeRows ?? []) {
      if (this.measured(r) != null) continue;
      const sig = this.partSig(r);
      const k = `${r.key}|${sig}`;
      if ((this.probeTries.get(k) ?? 0) >= 3) continue;
      want.push([r, sig, k]);
    }
    if (want.length > PROBE_MAX) {
      const top = (this.topKey != null && this.baseIndex?.get(this.topKey)) || 0;
      const at = (r) => this.baseIndex?.get(r.kind === "cmd" ? r.key.slice(4) : r.key) ?? 0;
      want.sort((a, b) => Math.abs(at(a[0]) - top) - Math.abs(at(b[0]) - top));
    }
    const out = want.slice(0, PROBE_MAX);
    for (const [, , k] of out) this.probeTries.set(k, (this.probeTries.get(k) ?? 0) + 1);
    this.probeLeft = want.length - out.length;
    if (this.probeTries.size > 4000) this.probeTries.clear();
    return out.map(([r, sig]) => [r, sig]);
  }

  // Zero height, clipped and fully transparent, outside the list: the parts laid out at the
  // card's text width with their own TextView ids, no scroll and no fixed heights. Not
  // invisible(): gpui may skip painting a hidden element's subtree, and a size report made
  // at paint would then never come. The zero-height clip and opacity 0 hide it (R3-1).
  probe(t, due) {
    const hash = (x) => { let h = 5381; for (let i = 0; i < x.length; i++) h = ((h * 33) ^ x.charCodeAt(i)) >>> 0; return h.toString(36); };
    return div().absolute().top(0).left(0).w(this.width).h(0).overflow_hidden().opacity(0)
      .child(v_flex().w(this.width).children(due.map(([r, sig]) => v_flex().id(`th-probe-${r.key}-${hash(sig)}`).flex_none().w(this.inner())
        .on_size_change((size, cx) => this.probed(r.key, sig, size, cx))
        .child(this.partContent(t, r, true)))));
  }

  // LATEST UPDATE, collapsed: its box shows whole 21 px lines up to LATEST_LINES, and Show
  // all appears when the text is taller than that (C5).
  latestBox(r) {
    const m = this.measured(r);
    const { line } = this.rt();
    const full = m ?? Math.max(1, r.estLines ?? 1) * line;
    return Math.min(full, LATEST_LINES * line);
  }
  latestCut(r) {
    if (r.md) return false;
    const m = this.measured(r);
    return m != null ? m > LATEST_LINES * this.rt().line + 1 : (r.estLines ?? 0) > LATEST_LINES;
  }

  // For the debug report: each open-card part's estimate, measure and list slot.
  partReport() {
    const rows = this.rowsMemo ?? [];
    const out = [];
    rows.forEach((r, i) => {
      if (!CARD.has(r.kind)) return;
      const m = PROBED.has(r.kind) ? this.measured(r) : null;
      out.push(`${r.key} est ${Math.round(this.estimate(r))} · measured: ${m ?? (PROBED.has(r.kind) ? "none" : "fixed")} · slot ${this.slotsMemo?.[i] ?? "?"}`);
    });
    return out.slice(0, 80);
  }

  noReplyText(turn) {
    if (turn.answeredIn) return `Answered in #${turn.answeredIn}. This turn itself ended with: ${turn.errors.at(-1)}`;
    return turn.interrupted ? `No reply · interrupted after ${plural(turn.tools, "tool call")}.`
      : turn.errors.at(-1) ?? (turn.answeredBy ? `${this.agent().short} answered this together with #${turn.answeredBy}; the reply is there.` : "No final reply.");
  }

  // The list's items for the range on screen. An error thrown here blanks the whole list
  // until it scrolls or resizes, and Herdr reports nothing, so each item is drawn on its own:
  // one that fails shows as a short error row, and the error is kept for the owner.
  listItems(t, rows, slots, range, focusedPanel, dim) {
    // gpui also asks for item 0 alone, to measure the list's width. That is not the top of
    // the pane, and taking it as the top would move a pin's place to the first row.
    if (!(range.start === 0 && range.end === 1 && rows.length > 1)) {
      this.topKey = rows[range.start]?.key ?? null;
      try { this.trackPlace(); this.noteTopDay(); } catch (e) { this.drawFailed(e, null); }
      // The end of the list on screen clears the latest button's dot; a new turn or reply
      // with the end off screen sets it (the 120 ms timer redraws the header, since the
      // drawing pass may not).
      const prevShown = this.bottomShown;
      this.bottomShown = range.end >= rows.length;
      // The Jump to latest pill comes and goes with the end of the list.
      if (prevShown !== this.bottomShown) this.stickyDue = true;
      // The rail brightens the turns on screen: redraw when the first or last one changes.
      this.viewRange = [range.start, range.end];
      let f = range.start;
      while (f < range.end - 1 && !rowTurnKey(rows[f])) f++;
      let l = range.end - 1;
      while (l > f && !rowTurnKey(rows[l])) l--;
      const seen = `${rowTurnKey(rows[f])}|${rowTurnKey(rows[l])}`;
      if (seen !== this.railSeen) { this.railSeen = seen; this.stickyDue = true; }
      this.lastRange = `${range.start}-${range.end}/${rows.length}`;
      try { this.stickCheck(rows, prevShown, range.start); } catch (e) { this.drawFailed(e, null); }
      if (this.unseen && this.bottomShown) { if (this.unseen === true) this.stickyDue = true; this.unseen = false; }
      else if (this.unseen === "pending") { this.unseen = true; this.stickyDue = true; }
    }
    const out = [];
    for (let i = range.start; i < range.end; i++) {
      const x = rows[i];
      const h = slots[i] > 0 ? slots[i] : 1;
      let body;
      try { body = x ? this.item(t, x, focusedPanel, h) : div(); } catch (e) { this.drawFailed(e, x); body = this.drawErrorRow(t, e); }
      out.push(v_flex().w_full().h(h).overflow_hidden()
        .when(Boolean(dim && x && !CARD.has(x.kind)), (el) => el.opacity(0.55))
        .child(body));
    }
    return out;
  }

  // Kept for render(), which publishes it: the drawing pass may not notify or write state.
  // The kind and the key say which part failed; no text from the session is kept.
  drawFailed(e, r) {
    const msg = String(e?.message ?? e).slice(0, 300);
    this.drawErrors = (this.drawErrors ?? 0) + 1;
    if (this.drawError?.msg === msg && this.drawError?.key === (r?.key ?? null)) return;
    this.drawError = { msg, kind: r?.kind ?? null, key: r?.key ?? null, stack: String(e?.stack ?? "").split("\n").slice(0, 6).join("\n"), at: new Date().toISOString(), sent: false };
  }

  drawErrorRow(t, e) {
    return h_flex().px(12).h_full().gap(6).items_center().text_size(12).text_color(t.blocked)
      .child(svg(ICON("circle-x")).size(12).flex_none())
      .child(div().min_w(0).truncate().child(`Could not draw this part: ${String(e?.message ?? e).slice(0, 120)}`));
  }

  // A row that failed to draw: saved to shared("threads.drawError"), which an agent on the
  // owner's machine can read, and said once in a toast.
  publishDrawError(cx) {
    const d = this.drawError;
    if (!d || d.sent) return;
    d.sent = true;
    try { setShared("threads.drawError", { ...d, count: this.drawErrors, terminal: this.terminal ?? null }); } catch { /* the toast still says it */ }
    this.say("Part of a turn could not be drawn. The details are saved for the owner.", "circle-x", cx, 5000);
  }

  item(t, r, focusedPanel, size) {
    switch (r.kind) {
      case "spacer": return div();
      case "gap": return div();
      case "tail": return div();
      case "turn": return this.rowItem(t, r, focusedPanel);
      case "line": return this.lineItem(t, r, focusedPanel);
      case "wrow": return this.workingRow(t, r, focusedPanel);
      case "wtop": return this.workingTop(t, r, focusedPanel);
      case "wake": return this.wakeRow(t, r);
      case "working": return this.workingItem(t, r);
      case "divider": return this.dividerItem(t, r);
      case "day": return this.dayItem(t, r);
      case "pday": return this.pinDayItem(t, r);
      case "hidden": return h_flex().px(16).h(26).gap(6).items_center().text_size(12).text_color(t.dim)
        .child(svg(ICON("unfold")).size(12)).child(`${plural(r.n, "turn")} hidden`);
      case "note": return div().px(16).py(8).text_size(12).text_color(t.dim).child(r.text);
      case "resume": return this.resumeItem(t, r, size);
      default: return this.cardPart(t, r, size);
    }
  }

  // The frame of a collapsed exchange: 16 px in from each side, its parts 6 px apart (ui.js
  // rowHeight). The selected exchange has a 2 px bar on its left edge, in the accent colour
  // while the pane has the keyboard, and no fill, so a text selection in it always shows.
  rowFrame(t, sel, focusedPanel, _live, kids, top = ROW.PAD_T, bottom = ROW.PAD_B) {
    return v_flex().w_full().relative().px(ROW.PAD_X).pt(top).pb(bottom).gap(ROW.GAP).min_w(0)
      .when(sel, (el) => el.child(div().absolute().left(0).top(0).bottom(0).w(2).bg(focusedPanel ? t.accent : t.border)))
      .children(kids);
  }

  // The sender over an agent's message: its icon and name in the agent colour, on the left.
  senderLine(t, turn) {
    const ac = this.agentColor(t);
    return h_flex().h(ROW.META).gap(5).items_center().text_size(11.5).min_w(0)
      .child(svg(ICON(senderIcon(turn.sender))).size(12).flex_none().text_color(ac))
      .child(div().flex_none().max_w(this.labelRoom(turn, replyWidth(this.width))).overflow_hidden().whitespace_nowrap().text_ellipsis_middle()
        .font_semibold().text_color(ac).child(senderLabel(turn.sender, this.width)));
  }

  // The text of the strip under a bubble: "#7 · 9:12 AM" on the selected turn, the time alone
  // under every other bubble with alwaysShowTime, else nothing.
  stripText(turn, sel, time = fmtTime(turn.ts)) {
    if (sel) return [`#${turn.n}`, time].filter(Boolean).join(" · ");
    return this.prefs.alwaysShowTime ? time : "";
  }

  // Hover reveal: an element whose text and icons are clear at rest and dim while the
  // pointer is on it. Children that set no colour of their own take it. gpui restyles only
  // the hovered element itself, so the strip a hover reveals must sit inside that element.
  reveal(t, el) { return el.text_color(CLEAR).hover((s) => s.text_color(t.dim)); }

  // The strip under a bubble (ui.js stripLayout): on the selected turn, copy the prompt, the
  // pin (in the accent colour when the turn is pinned) and "#7 · 9:12 AM", at the bubble's
  // right edge (an agent's: its left). It keeps its height when it shows nothing. On other
  // turns `hover` draws what a hover on the element around it reveals, in no colour of its
  // own: "time" the time alone (a closed row, whose one click opens it), "all" the icons and
  // "#7 · 9:12 AM" (an open turn's strip, an item of its own, whose icons take a click).
  youStrip(t, turn, key, sel, hover = null, time = fmtTime(turn.ts)) {
    const always = this.stripText(turn, false, time);
    const icons = sel || hover === "all";
    const text = icons ? this.stripText(turn, true, time) : always || (hover === "time" ? time : "");
    const lit = sel || Boolean(always);
    const agent = turn.agent;
    const el = h_flex().h(ROW.META).w_full().items_center().text_size(11.5).min_w(0).when(!agent, (e) => e.justify_end());
    if (!text) return el;
    const L = stripLayout(this.width, text, !agent);
    const box = (icon, color) => div().flex_none().w(ICON_BOX).h(ROW.META).flex().items_center().justify_center()
      .child(svg(ICON(icon)).size(13).when(Boolean(color), (e) => e.text_color(color)));
    const copied = this.copied?.id === `prompt:${key}`;
    return el.when(Boolean(agent), (e) => e.ml(-4))
      .when(icons, (e) => e.child(box(copied ? "check" : "copy", copied ? t.ansi2 : sel ? t.dim : null)).child(div().w(2).flex_none())
        .child(box("pin", sel && this.isPinnedTurn(turn) ? t.accent : sel ? t.dim : null)).child(div().w(4).flex_none()))
      .child(div().flex_none().w(L.tw).whitespace_nowrap().overflow_hidden().when(lit, (e) => e.text_color(t.dim)).when(!agent, (e) => e.text_right()).child(text));
  }

  // The line between the message and the reply: "Worked for 2m 31s" and a chevron, over a
  // hairline. In a session where more than one agent replied, the agent's name leads it; a
  // stopped or failed turn leads with its icon; a pinned turn ends it with the pin and its
  // number in the accent colour.
  workLine(t, turn, pinNo = this.pinNumber(turn), open = false) {
    const bad = turn.interrupted || this.failed(turn);
    const name = this.mixedAgents(turn) ? this.agentName(turn) : null;
    const pinned = this.isPinnedTurn(turn);
    return v_flex().h(ROW.LINE).w_full().max_w(this.prose()).min_w(0).border_b_1().border_color(t.border)
      .child(h_flex().h(17).gap(5).items_center().text_size(12).text_color(t.dim).min_w(0)
        .when(Boolean(name), (el) => el.child(div().flex_none().max_w(160).truncate().font_semibold().text_color(t.muted).child(name)).child(div().flex_none().child("·")))
        .child(div().flex_none().when(bad, (e) => e.text_color(t.blocked)).child(this.workText(turn)))
        .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(12).flex_none())
        .child(div().flex_1())
        .when(pinned, (el) => el.child(svg(ICON("pin")).size(12).flex_none().text_color(t.accent)))
        .when(pinNo != null, (el) => el.child(div().flex_none().text_size(11).font_semibold().text_color(t.accent).child(String(pinNo)))));
  }
  // The line's words: "Worked for 2m 31s"; a stopped or failed turn says how long it ran.
  workText(turn) {
    const d = turn.durationMs ? fmtDuration(turn.durationMs) : null;
    if (turn.interrupted) return d ? `Stopped after ${d}` : "Stopped";
    if (this.failed(turn)) return d ? `Failed after ${d}` : "Failed";
    return d ? `Worked for ${d}` : "Worked";
  }
  toggleLine(key, live = false) {
    if (this.lineIsOpen(key, live)) this.lineOpen.delete(key); else this.lineOpen.add(key);
    this.lineTouched.add(key);
  }
  // The line as text, for the debug report and the tests: "plan · ⚠ Worked for 40s 📌 2".
  lineText(turn, key = null) {
    const pinNo = this.pinNumber(turn);
    return [this.mixedAgents(turn) ? `${this.agentName(turn)} ·` : null, this.workText(turn),
      key && this.lineIsOpen(key, false) ? "[open]" : null, this.isPinnedTurn(turn) ? `[pin${pinNo != null ? ` ${pinNo}` : ""}]` : null].filter(Boolean).join(" ");
  }

  // The strip under a reply (ui.js actsLayout): on the selected turn, copy the reply, quote
  // it, select its text and go to the terminal, as icons (keys c q s t). It keeps its height
  // when it shows nothing. A collapsed row is one list item and a press on it opens the
  // turn; an open turn's strip is an item of its own, and click() tells its icons apart.
  // With `hover` (an open turn's strip on a turn not selected) it draws the icons in no
  // colour of their own, for the hover around it to reveal.
  actsStrip(t, turn, key, show, hover = false) {
    const el = h_flex().h(ROW.ACTS).items_center().ml(-4).gap(4).when(show, (e) => e.text_color(t.dim));
    if (!show && !hover) return el;
    const L = this.acts(turn);
    const copied = this.copied?.id === `reply:${key}`;
    const has = Boolean(this.replyText(turn));
    const ink = show ? t.dim : null;
    const box = (icon, color = ink, on = true) => div().flex_none().w(ICON_BOX).h(ROW.ACTS).flex().items_center().justify_center()
      .when(!on, (e) => e.opacity(0.4)).child(svg(ICON(icon)).size(13).when(Boolean(color), (e) => e.text_color(color)));
    return el
      .child(box(copied ? "check" : "copy", copied ? t.ansi2 : ink, has))
      .when(Boolean(L.quote), (e) => e.child(box("quote")))
      .child(box("text-cursor", this.selecting === key ? t.accent : ink, has))
      .when(Boolean(L.terminal), (e) => e.child(box("square-terminal")));
  }

  // Width left for an agent's sender label on the meta line: the pane less the icon, #n,
  // time, bell and pin beside it (at most 60%), so a long name shortens in the middle.
  labelRoom(turn, tw) {
    const ch = 6.6;
    const time = Math.max(8, fmtTime(turn.ts).length) * ch;
    const n = (`#${turn.n}`.length) * 7.2;
    const bell = turn.followups > 0 ? 13 + countLabel(turn.followups).length * ch : 0;
    const pin = (this.isPinnedTurn(turn) ? 12 + 5 : 0) + (this.pinNumber(turn) != null ? 12 : 0);
    // Six 5 px gaps: icon, label, "·", #n, "·", time, and the bell or pin between.
    const fixed = 12 + n + 3 * ch + time + bell + pin + 6 * 5 + 8;
    return Math.max(36, Math.floor(Math.min(tw * 0.6, tw - fixed)));
  }

  // The person's message in a bubble on the right (an agent's: an outlined bubble on the
  // left), as wide as its widest line (ui.js rowShape bubbleW).
  bubble(t, turn, kids, w) {
    const agent = turn.agent;
    const { style } = this.bubbleLook(t, agent);
    const box = v_flex().flex_none().w(w).max_w_full().px(ROW.BUBBLE_PX).py(ROW.BUBBLE_PY).min_w(0).bg(style.fill).text_color(this.bubbleLook(t, agent).theme.foreground)
      .when(style.outline, (el) => el.border_1().border_color(t.border))
      .when(!agent, (el) => el.rounded_tl(14).rounded_tr(14).rounded_bl(14).rounded_br(4))
      .when(agent, (el) => el.rounded_tl(4).rounded_tr(14).rounded_bl(14).rounded_br(14))
      .children(kids);
    return h_flex().w_full().min_w(0).when(!agent, (el) => el.justify_end()).child(box);
  }

  // How a bubble is drawn (settings bubbleColor and agentBubbleColor, ui.js bubbleStyle),
  // and the theme its text is drawn with. On a coloured fill the bubble's ink stands in for
  // the text, muted and accent colours, so a quote, a command's name and Show more read on
  // it. Plain keeps the pane's theme: the person's bubble is the text colour at 8% over
  // whatever is under it, so it shows on a selected exchange's fill too.
  bubbleLook(t, agent) {
    const v = agent ? this.prefs.agentBubbleColor : this.prefs.bubbleColor;
    const k = `${agent ? 1 : 0}|${v}|${t.foreground}|${t.background}|${t.muted}|${t.dim}|${t.border}`;
    this.bubbleMemo ??= new Map();
    let look = this.bubbleMemo.get(k);
    if (!look) {
      const style = bubbleStyle(v, t, agent);
      const plain = style.outline || style.ink === t.foreground;
      const theme = plain ? t : { ...t, foreground: style.ink, muted: style.sub, dim: style.sub, accent: style.ink, background: style.fill, selected: style.fill, border: style.bar };
      look = { style, theme };
      if (this.bubbleMemo.size > 8) this.bubbleMemo.clear();
      this.bubbleMemo.set(k, look);
    }
    return look;
  }

  // "Show more" under a message or reply that was cut: Enter or a click opens the turn.
  moreLine(t) {
    return h_flex().h(ROW.MORE).gap(4).items_center().text_size(12).text_color(t.accent)
      .child("Show more").child(svg(ICON("chevron-down")).size(12));
  }

  // The stats under a reply, one line: "52s · 7.7k tokens · opus 5.5 · 3 tool calls". Under
  // 300 px the words go: "52s · 7.7k · 3 tools".
  statsText(turn) {
    const st = stats(turn);
    const narrow = this.narrow();
    const parts = [];
    if (turn.durationMs) parts.push(fmtDuration(turn.durationMs));
    if (this.showTokens(st) && st.tokens > 0) parts.push(narrow ? fmtTokens(st.tokens) : `${fmtTokens(st.tokens)} tokens`);
    if (!narrow && turn.model) parts.push(shortModel(turn.model));
    if (turn.tools > 0) parts.push(narrow ? plural(turn.tools, "tool") : plural(turn.tools, "tool call"));
    return parts.join(" · ");
  }
  // An open turn's stats: the closed exchange's, then cache hit and a compaction.
  statsFull(turn) {
    const st = stats(turn);
    const parts = [this.statsText(turn)];
    if (st.cachePct != null) parts.push(`cache hit ${fmtPct(st.cachePct)}`);
    if (turn.compactions) parts.push("context compacted");
    return parts.filter(Boolean).join(" · ") || "no stats";
  }
  statsLine(t, text, color = t.dim) {
    return h_flex().h(ROW.STATS).min_w(0).items_center().text_size(11.5).font_family(this.mono()).text_color(color)
      .child(div().flex_1().min_w(0).truncate().child(text || " "));
  }

  // A command's chip, then its arguments wrapping to its right.
  promptBlock(t, turn, sh, sel = false) {
    const agent = turn.agent;
    const color = agent ? t.muted : t.foreground;
    const rt = this.rt();
    const size = agent ? rt.small : rt.size;
    const lh = rt.line;
    if (sh.chip) {
      return h_flex().gap(6).items_start().min_w(0)
        .child(div().flex_none().h(lh).flex().items_center().child(this.chip(t, sh.chip.label, sh.chip.chipW, sh.prompt.length === 0, sel)))
        .when(sh.prompt.length > 0, (el) => el.child(this.lines(t, sh.prompt, color, size, lh)));
    }
    // A prompt that quotes something: each quote line behind a bar, muted at 12.5 px; a
    // quote that is the whole prompt keeps the prompt's own colour and size.
    if (sh.kinds) {
      return v_flex().min_w(0).children(sh.prompt.map((l, i) => {
        const k = sh.kinds[i];
        if (k === "c") return h_flex().min_w(0).when(!agent, (el) => el.font_medium()).child(this.lines(t, [l], color, size, lh));
        return h_flex().h(lh).min_w(0).gap(QUOTE_INSET - 2).items_center()
          .child(this.quoteBar(t, agent))
          .child(k === "qonly"
            ? h_flex().flex_1().min_w(0).when(!agent, (el) => el.font_medium()).child(this.lines(t, [l], color, size, lh))
            : this.lines(t, [l], t.muted, rt.small, lh));
      }));
    }
    return h_flex().min_w(0).when(!agent, (el) => el.font_medium()).child(this.lines(t, sh.prompt, color, size, lh));
  }

  // A collapsed exchange: the sender (an agent's), the message, the strip under it, the line,
  // the start of the reply and the strip under that (ui.js rowHeight).
  rowItem(t, r, focusedPanel) {
    if (r.compact) return this.pinRow(t, r, focusedPanel);
    const { turn, key } = r;
    const sel = this.sel === key;
    const sh = r.shape;
    const tone = sh.tone;
    const color = tone === "reply" ? t.foreground : tone === "why" || tone === "error" ? t.blocked : t.dim;
    const bt = this.bubbleLook(t, turn.agent).theme;
    // Split: the meta line and tiles are the wtop item over it (closedRows).
    return this.rowFrame(t, sel, focusedPanel, false, [
      ...(turn.agent && !r.split ? [this.senderLine(t, turn)] : []),
      this.youGroup(t, turn, key, sel, [
        ...(sh.thumbs && !r.split ? [this.thumbStrip(t, turn, key)] : []),
        this.bubble(t, turn, [
          this.promptBlock(bt, turn, sh, sel),
          ...(sh.pMore ? [this.moreLine(bt)] : []),
        ], sh.bubbleW),
      ]),
      this.workLine(t, turn, r.pinNo ?? this.pinNumber(turn)),
      v_flex().min_w(0).max_w(this.prose())
        .child(sh.md != null ? this.cmdBlock(sh.md, `th-cmd-cmd:${key}`) : this.lines(t, sh.reply, color, this.rt().size, this.rt().line))
        .when(sh.rMore, (el) => el.child(this.moreLine(t))),
      this.actsStrip(t, turn, key, sel),
    ], r.split ? ROW.GAP : ROW.PAD_T);
  }

  // A closed row's message and the strip under it, as one element, so a hover anywhere on
  // the message reveals the time under it. The gap is the row's own.
  youGroup(t, turn, key, sel, kids) {
    return this.reveal(t, v_flex().id(`yg:${key}`).w_full().gap(ROW.GAP).min_w(0))
      .children([...kids, this.youStrip(t, turn, key, sel, "time")]);
  }

  // A closed pin in the Pinned view (ui.js PIN_ROW): its digit in an accent badge, then
  // "#7 · 9:12 AM" with a dot at the right while the turn has a reply not read yet, two lines
  // of the prompt and one of the reply. Selected, it has the list's fill and bar.
  pinRow(t, r, focusedPanel) {
    const { turn, key } = r;
    const sel = this.sel === key;
    const sh = r.shape;
    const P = PIN_ROW;
    const st = r.running ? this.liveState(t) : null;
    const color = sh.tone === "reply" ? t.muted : sh.tone === "why" || sh.tone === "error" ? t.blocked : t.dim;
    const clock = r.running && turn.ts ? fmtClock(Date.now() - turn.ts) : "";
    const ac = this.agentColor(t);
    const line = (text, h, size, c) => h_flex().h(h).min_w(0).items_center().overflow_hidden()
      .child(div().flex_1().min_w(0).truncate().text_size(size).text_color(c).child(text));
    return h_flex().w_full().relative().px(P.PAD_X).pt(P.PAD_T).pb(P.PAD_B).gap(P.GAP_X).items_start().min_w(0)
      .when(sel, (el) => el.bg(t.selected))
      .when(!sel, (el) => el.hover((s) => s.bg(t.hover)))
      .when(sel, (el) => el.child(div().absolute().left(0).top(0).bottom(0).w(2).bg(focusedPanel ? t.accent : t.border)))
      .child(div().flex_none().size(P.BADGE).mt(-2).rounded(6).flex().items_center().justify_center()
        .bg(alpha(t.accent, sel ? 0.28 : 0.16)).text_size(12).font_semibold().text_color(t.accent).child(String(r.pinNo)))
      .child(v_flex().flex_1().min_w(0).gap(P.GAP)
        .child(h_flex().h(P.META).gap(5).items_center().min_w(0).text_size(11.5).text_color(t.dim)
          .when(Boolean(st), (el) => el.child(this.liveIcon(st, 12)))
          .when(!st && (turn.interrupted || this.failed(turn)), (el) => el.child(this.statusIcon(t, turn)))
          .child(div().flex_none().font_family(this.mono()).text_color(t.muted).child(`#${turn.n}`))
          .child(div().flex_none().child("·"))
          .when(turn.agent, (el) => el
            .child(svg(ICON(senderIcon(turn.sender))).size(12).flex_none().text_color(ac))
            .child(div().flex_none().max_w(Math.floor(this.width * 0.4)).overflow_hidden().whitespace_nowrap().text_ellipsis_middle()
              .font_semibold().text_color(ac).child(senderLabel(turn.sender, this.width)))
            .child(div().flex_none().child("·")))
          .child(div().flex_1().min_w(0).truncate().child(st?.spin ? "now" : fmtTime(turn.ts)))
          .when(turn.followups > 0, (el) => el.child(h_flex().flex_none().gap(3).items_center().child(svg(ICON("bell")).size(10)).child(countLabel(turn.followups))))
          .when(Boolean(r.fresh), (el) => el.child(div().id(`th-pin-new-${r.pinNo}`).flex_none().size(7).rounded(4).bg(t.accent))))
        .child(v_flex().min_w(0).when(!turn.agent, (el) => el.font_medium())
          .children(sh.prompt.map((l) => line(l, P.LINE, P.SIZE, turn.agent ? t.muted : t.foreground))))
        .child(st
          ? line([this.agentName(turn), st.label, clock].filter(Boolean).join(" · "), P.REPLY, P.REPLY_SIZE, st.color)
          : line(sh.reply, P.REPLY, P.REPLY_SIZE, color)));
  }

  // An outline row: "#12  8:43 AM  First line of the prompt  📌 2", one line at the reading
  // size, with the selected turn's fill and bar. An agent's message leads with its sender's
  // icon and is muted; a stopped or failed turn leads with its icon; the running turn says
  // "now". Under 300 px the time gives way to the prompt.
  lineItem(t, r, focusedPanel) {
    const { turn, key } = r;
    const sel = this.sel === key;
    const rt = this.rt();
    const pinNo = this.pinNumber(turn);
    const pinned = pinNo != null || this.isPinnedTurn(turn);
    const icon = turn.agent ? svg(ICON(senderIcon(turn.sender))).size(12).flex_none().text_color(this.agentColor(t))
      : turn.interrupted || this.failed(turn) ? this.statusIcon(t, turn) : null;
    return h_flex().w_full().h(outlineHeight(this.prefs.textSize)).relative().px(ROW.PAD_X).gap(8).items_center().min_w(0)
      .when(sel, (el) => el.bg(t.selected).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(focusedPanel ? t.accent : t.border)))
      .when(!sel, (el) => el.hover((s) => s.bg(t.hover)))
      .child(div().flex_none().w(r.numW).text_size(11.5).font_family(this.mono()).text_color(sel ? t.muted : t.dim).child(`#${turn.n}`))
      .when(!this.narrow(), (el) => el.child(div().flex_none().w(62).text_size(11.5).whitespace_nowrap().text_color(r.running ? t.working : t.dim).child(r.running ? "now" : fmtTime(turn.ts))))
      .when(Boolean(icon), (el) => el.child(icon))
      .child(h_flex().flex_1().min_w(0).text_size(turn.agent ? rt.small : rt.size).when(!turn.agent, (el) => el.font_medium())
        .child(this.hlLine(t, r.text || " ", turn.agent ? t.muted : t.foreground)))
      .when(pinned, (el) => el.child(h_flex().flex_none().gap(3).items_center().text_size(11.5).text_color(t.accent)
        .child(svg(ICON("pin")).size(11))
        .when(pinNo != null, (x) => x.child(String(pinNo)))));
  }

  // A collapsed row's reply start, drawn as Markdown at the reading size. Not selectable:
  // a click on the row opens the turn.
  cmdBlock(md, id) {
    return this.readBlock(div()).child(this.mdView(id, md, false));
  }

  // Whether the turn's session has replies from more than one named agent (turn.by), counting
  // the person's own turns only: an agent message names its sender over its bubble.
  mixedAgents(turn) {
    if (turn.agent || !turn.by) return false;
    const s = this.sessions.find((x) => x.turns.includes(turn));
    if (!s) return false;
    for (const x of s.turns) if (!x.agent && x.by && x.by !== turn.by) return true;
    return false;
  }

  // Who replied: the name the harness records for the turn (OpenCode's agent) or the session
  // (Claude Code's agent name, a Codex subagent's nickname), else "Agent".
  agentName(turn) {
    if (turn.by) return turn.by;
    for (const s of this.sessions) if (s.turns[turn.n - 1] === turn) return s.agentName || "Agent";
    return "Agent";
  }

  liveState(t) {
    const status = this.status();
    if (status === "blocked") return { color: t.blocked, label: "Needs you", icon: "alert", spin: false };
    if (status === "working") return { color: t.working, label: "Working", icon: "spinner", spin: true };
    return { color: t.dim, label: "No reply yet", icon: "clock", spin: false };
  }

  liveIcon(st, size) {
    const icon = svg(ICON(st.icon)).size(size).flex_none().text_color(st.color);
    return st.spin ? icon.spin(900) : icon;
  }

  // Under a done turn while a background task has woken the agent: a quiet line with this
  // wake-up's own clock (from its notification), its tool calls and what it said last. The
  // reply above stays as it was.
  wakeRow(t, r) {
    const { turn, s } = r;
    const clock = s.followSince ? fmtClock(Date.now() - s.followSince) : null;
    const said = (turn.latest ?? "").replace(/\s+/g, " ").trim();
    return h_flex().h(WAKE_H).px(ROW.PAD_X).gap(6).items_center().min_w(0).text_size(12).text_color(t.dim)
      .child(svg(ICON("spinner")).size(12).flex_none().text_color(t.muted).spin(900))
      .child(div().flex_1().min_w(0).truncate()
        .child(["Updating", clock, turn.wakeTools ? plural(turn.wakeTools, "tool call") : null, said || null].filter(Boolean).join(" · ")));
  }

  // The live line of a running turn, where a finished turn has its line: its state, the
  // agent, its clock and tool calls so far, in the live colour, over a hairline.
  liveLine(t, turn, tokens = false) {
    const st = this.liveState(t);
    const clock = turn.ts ? fmtClock(Date.now() - turn.ts) : "";
    const s = stats(turn);
    // "Working for 0:48 · 3 tool calls so far"; Needs you and No reply yet keep their words.
    const state = st.label === "Working" && clock ? `Working for ${clock}` : [st.label, clock].filter(Boolean).join(" · ");
    const live = [this.mixedAgents(turn) ? this.agentName(turn) : null, state, `${plural(turn.tools, "tool call")} so far`, tokens && this.showTokens(s) && s.tokens > 0 ? `${fmtTokens(s.tokens)} tokens` : null].filter(Boolean).join(" · ");
    return v_flex().h(ROW.LINE).w_full().max_w(this.prose()).min_w(0).border_b_1().border_color(t.border)
      .child(h_flex().h(17).gap(6).items_center().min_w(0)
        .child(this.liveIcon(st, 13))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(st.color).child(live)));
  }

  // The running turn when it is not selected: the message, the strip under it, the live
  // line, then where the reply will be.
  workingRow(t, r, focusedPanel) {
    const { turn, key } = r;
    const sel = this.sel === key;
    const sh = r.shape;
    const tokens = this.showTokens(stats(turn)) && stats(turn).tokens > 0 ? `${fmtTokens(stats(turn).tokens)}${this.narrow() ? "" : " tokens"}` : null;
    const bt = this.bubbleLook(t, turn.agent).theme;
    return this.rowFrame(t, sel, focusedPanel, true, [
      ...(!r.split && turn.agent ? [this.senderLine(t, turn)] : []),
      this.youGroup(t, turn, key, sel, [this.bubble(t, turn, [this.promptBlock(bt, turn, sh), ...(sh.pMore ? [this.moreLine(bt)] : [])], sh.bubbleW)]),
      this.liveLine(t, turn),
      this.statsLine(t, [tokens, "no reply yet"].filter(Boolean).join(" · ")),
    ], r.split ? ROW.GAP : ROW.PAD_T);
  }

  // A running turn's sender (an agent's) and its pasted images' tiles, over the rest of its
  // row. A click on a tile opens the message's images full window.
  workingTop(t, r, focusedPanel) {
    const { turn } = r;
    const sel = this.sel === r.turnKey;
    return this.rowFrame(t, sel, focusedPanel, true, [
      ...(turn.agent ? [this.senderLine(t, turn)] : []),
      this.thumbStrip(t, turn, r.turnKey),
    ], ROW.PAD_T, 0);
  }

  // The running turn when selected: the message in full (up to 6 lines), the strip under
  // it, the live line with its tokens, and a note on where the reply will appear. Every line
  // has a fixed height, so the drawn height is the estimate (F3).
  workingItem(t, r) {
    const { turn, key } = r;
    const g = this.workingGeom(turn);
    return this.rowFrame(t, true, this.h.is_focused(), true, [
      ...(!r.split && turn.agent ? [this.senderLine(t, turn)] : []),
      this.bubble(t, turn, [div().h(g.lines * this.rt().line).overflow_hidden().text_size(this.rt().size).line_height(`${this.rt().line}px`).text_color(this.bubbleLook(t, turn.agent).theme.foreground).child(g.prompt)], bubbleMax(this.width, this.prefs.textSize, this.chars())),
      this.youStrip(t, turn, key, true),
      this.liveLine(t, turn, true),
      div().h(g.note * NOTE_LINE).overflow_hidden().text_size(12).line_height(`${NOTE_LINE}px`).text_color(t.dim).child(g.noteText),
    ], r.split ? ROW.GAP : ROW.PAD_T);
  }
  workingGeom(turn) {
    const prompt = clipPrompt(turn.prompt, PROMPT_LINES, this.perLine(), PROMPT_CHARS).text;
    const tw = bubbleMax(this.width, this.prefs.textSize, this.chars()) - 2 * ROW.BUBBLE_PX;
    const lines = Math.max(1, Math.min(6, this.wrapped(prompt, tw, this.charW(YOU_CHAR))));
    const st = this.status();
    const noteText = st === "blocked" ? `${this.agent().short} is waiting for you in the terminal.`
      : st === "working" ? `No final reply yet. It appears here when ${this.agent().short} finishes this turn.`
        : "This turn has no final reply yet. It may have been stopped.";
    const note = this.wrapped(noteText, this.inner(), 6.0);
    return { prompt, lines, note, noteText };
  }

  // A day: its name, date and shown turns centred between two hairlines, 10 px below the
  // exchange above.
  // A day band: lines either side of a filled pill, "Today" in the text colour and the date
  // and count in muted, so a new day shows while scrolling and stays quieter than a message.
  dayItem(t, r) {
    return v_flex().pt(10).pb(6)
      .child(h_flex().h(30).px(16).gap(10).items_center()
        .child(div().flex_1().h(1).bg(t.border))
        .child(this.dayPill(t, r))
        .child(div().flex_1().h(1).bg(t.border)));
  }
  // The Pinned view's day header: the day pill made compact for the narrow column, with no
  // turn count (the pins under it are not all of that day's turns).
  pinDayItem(t, r) {
    return h_flex().h(PDAY_H).px(12).pt(4).gap(8).items_center()
      .child(div().flex_1().h(1).bg(t.border))
      .child(h_flex().flex_none().h(20).px(8).gap(5).items_center().rounded(10).bg(this.band(t)).border_1().border_color(t.border).text_size(11.5)
        .child(div().font_semibold().text_color(t.foreground).child(r.name))
        .when(Boolean(r.date), (el) => el.child(div().text_color(t.muted).child(`· ${r.date}`))))
      .child(div().flex_1().h(1).bg(t.border));
  }
  // bandFill searches a mix, so it is kept per theme.
  band(t) {
    const k = `${t.background}|${t.foreground}|${t.raised}|${t.selected}`;
    if (this.bandKey !== k) { this.bandKey = k; this.bandVal = bandFill(t); }
    return this.bandVal;
  }
  dayPill(t, r) {
    return h_flex().flex_none().h(24).px(10).gap(6).items_center().rounded(12).bg(this.band(t)).border_1().border_color(t.border).text_size(12)
      .child(div().font_semibold().text_color(t.foreground).child(r.name))
      .when(Boolean(r.date), (el) => el.child(div().text_color(t.muted).child(`· ${r.date}`)))
      .child(div().text_color(t.muted).child(`· ${plural(r.count, "turn")}`));
  }

  // The day the top of the pane is in, kept at the top of the list while its band is
  // scrolled away (the list item at the top comes from the list's own drawing, topKey). The
  // drawing pass may not redraw the pane, so stickyDue asks the 120 ms timer to.
  stickyDay() {
    const rows = this.rowsMemo ?? [];
    if (this.dayOfRows !== rows) {
      this.dayOfRows = rows;
      this.dayOf = new Map();
      let day = null;
      for (const r of rows) {
        if (r.kind === "day") day = r;
        this.dayOf.set(r.key, day);
      }
    }
    const top = this.topKey;
    const day = top ? this.dayOf.get(top) : null;
    // Not while the band itself is at the top of the list, right under the strip.
    return day && day.key !== top ? day : null;
  }
  hasDayStrip(rows) { return rows.some((r) => r.kind === "day"); }
  noteTopDay() {
    const k = this.stickyDay()?.key ?? null;
    if (k !== this.stickyShown) this.stickyDue = true;
  }

  dividerItem(t, r) {
    return h_flex().px(16).py(8).gap(8).items_center()
      .child(svg(ICON(r.s.clearAt ? "eraser" : "messages")).size(13).flex_none().text_color(t.dim))
      .child(div().flex_none().text_size(11.5).text_color(t.muted).child(dividerLabel(r.s)))
      .child(div().flex_1().h(1).bg(t.border));
  }

  // The line a return to a pin puts over a place further down the turn: the prompt and the
  // start of the reply are above it. A click shows the turn from its head. It carries the
  // turn's fill and bar when selected, like the turn's other slices.
  resumeItem(t, r, size) {
    const sel = this.sel === r.key.slice("resume:".length);
    return v_flex().h(size).w_full().relative().justify_center().px(ROW.PAD_X)
      .when(sel, (el) => el.bg(t.selected).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(this.h.is_focused() ? t.accent : t.border)))
      .child(h_flex().gap(6).items_center().text_size(12).text_color(t.accent).min_w(0)
        .child(svg(ICON("chevron-up")).size(12).flex_none())
        .child(div().min_w(0).truncate().child(`#${r.turn.n} starts above · show the prompt`)));
  }

  // One slice of an open turn: exactly its slot's height, 16 px in from each side like a
  // closed exchange. The first part has the 8 px top padding and the last the 10 px bottom
  // padding. The selected turn's slices carry its fill and the bar on the left, so they
  // read as one exchange with no seam.
  cardPart(t, r, size) {
    const tkey = r.kind === "head" ? r.key : r.key.split(":").slice(1, 3).join(":");
    const sel = this.sel === tkey;
    const focusedPanel = this.h.is_focused();
    return v_flex().h(size).w_full().relative().overflow_hidden().px(ROW.PAD_X)
      .when(r.part === "top", (el) => el.pt(ROW.PAD_T))
      .when(r.part === "bottom", (el) => el.pb(ROW.PAD_B))
      .when(sel, (el) => el.child(div().absolute().left(0).top(0).bottom(0).w(2).bg(focusedPanel ? t.accent : t.border)))
      .child(this.partContent(t, r, false));
  }

  // What a card part shows. probe: drawn in the hidden probe (own TextView ids, no scroll,
  // no fixed heights, no editors); the collapsed LATEST UPDATE is then its text alone.
  partContent(t, r, probe) {
    const { turn } = r;
    const tkey = r.kind === "head" ? r.key : r.key.split(":").slice(1, 3).join(":");
    const tv = (id) => (probe ? `th-probe-${id}` : id);
    const mono = this.mono();
    switch (r.kind) {
      case "head":
        // The top of an open turn: its padding alone. The number, time and pin are in the
        // strip under the message (ustrip), and Show less, Collapse or Esc close it.
        return div();
      case "you": {
        const y = this.youMd(r);
        const { style, theme: bt } = this.bubbleLook(t, turn.agent);
        const c = { text: y.text, more: y.more };
        const canLess = r.full && this.youClip(turn).more > 0;
        // A prompt taller than YOU_MAX scrolls inside a box of that height; any other is
        // drawn at its own height (measured), so nothing in it is cut.
        const scroll = y.capped && !probe;
        // Markdown through TextView (quotes, code and link rules drawn the way the reply is),
        // or with a filter that matches the prompt, the matches marked and each quote run
        // behind the same bar.
        const text = y.plain
          ? v_flex().gap(6).children(y.parts.map((p) => p.quote
            ? div().relative().pl(QUOTE_INSET).child(div().absolute().left(0).top(2).bottom(2).w(2).rounded(1).bg(turn.agent ? bt.dim : alpha(bt.foreground, 0.28)))
              .child(this.hlBlock(bt, p.lines.join("\n"), bt.muted))
            : this.hlBlock(bt, p.lines.join("\n"), bt.foreground)).concat(y.cut
            ? [div().text_size(11.5).italic().text_color(bt.dim).child(`… ${y.cut.toLocaleString()} more characters not shown`)] : []))
          : y.capped && scroll && this.mdParts(y.md).length === 1
            ? TextView.markdown(tv(`th-you-${r.key}`), this.mdParts(y.md)[0]).selectable(false).scrollable(true).size_full()
            : y.capped && scroll
              ? v_flex().id(tv(`th-you-scroll-${r.key}`)).size_full().overflow_y_scrollbar().child(this.mdView(tv(`th-you-${r.key}`), y.md, false))
              : this.mdView(tv(`th-you-${r.key}`), y.md, false);
        const cmd = commandParts(turn);
        const ac = style.outline ? this.agentColor(t) : bt.foreground;
        const box = y.capped ? (probe ? div().h(YOU_MAX).overflow_hidden() : y.plain ? v_flex().id(`th-you-${tkey}`).h(YOU_MAX).overflow_y_scrollbar() : div().h(YOU_MAX)) : div();
        // The message in its bubble, on the right (an agent's outlined, on the left, under its
        // sender), as wide as its widest line.
        const agent = turn.agent;
        return h_flex().w_full().when(!agent, (el) => el.justify_end())
          .child(v_flex().flex_none().w(y.bw).px(ROW.BUBBLE_PX).py(8).gap(4)
            .bg(style.fill).when(style.outline, (el) => el.border_1().border_color(t.border))
            .when(!agent, (el) => el.rounded_tl(14).rounded_tr(14).rounded_bl(14).rounded_br(4))
            .when(agent, (el) => el.rounded_tl(4).rounded_tr(14).rounded_bl(14).rounded_br(14))
            .when(agent, (el) => el.child(h_flex().gap(5).items_center()
              .child(svg(ICON(senderIcon(turn.sender))).size(11).flex_none().text_color(ac))
              .child(div().min_w(0).overflow_hidden().whitespace_nowrap().text_ellipsis_middle().text_size(11.5).font_semibold()
                .text_color(ac).child(this.youLabel(turn)))))
            .when(Boolean(cmd), (el) => el.child(h_flex().h(this.rt().line).child(this.chip(bt, middle(cmd.name, Math.floor((y.bw - 32) / ROW.CHIP_CHAR)), y.bw - 20, !cmd.args))))
            .when(Boolean(c.text), (el) => el.child(box.text_size(this.rt().size).line_height(`${this.rt().line}px`).text_color(bt.foreground).child(text)))
            .when(c.more > 0, (el) => el.child(h_flex().h(18).gap(4).items_center().text_size(12).text_color(bt.accent)
              .child(`Show all · ${plural(c.more, "more line")}`).child(svg(ICON("chevron-down")).size(12))))
            .when(canLess, (el) => el.child(h_flex().h(18).gap(4).items_center().text_size(12).text_color(bt.accent)
              .child("Show less").child(svg(ICON("chevron-up")).size(12)))));
      }
      case "ustrip": return this.reveal(t, div().id(`ush:${tkey}`).pt(ROW.GAP)).child(this.youStrip(t, turn, tkey, this.sel === tkey, "all"));
      case "rhead":
        // Under the message, before the reply: the line ("Worked for 2m 31s"), then what the
        // reply does not show, wrapping ("🔔 144 background updates · 🤖 shared with agent
        // message #4").
        return v_flex().pt(ROW.GAP)
          .child(this.workLine(t, turn, this.pinNumber(turn), this.lineIsOpen(tkey, false)))
          .when(this.captionParts(turn).length > 0, (el) => el.child(h_flex().mt(6).gap_x(6).flex_wrap().items_center().text_size(11.5).text_color(t.dim)
            .children(this.captionParts(turn).map(([icon, text], i) => h_flex().h(18).gap(4).items_center()
              .when(i > 0, (el) => el.child(div().child("·")))
              .child(svg(ICON(icon)).size(11).flex_none()).child(text)))));
      case "lhead":
        return h_flex().mt(14).gap(6).items_center().text_size(10.5)
          .child(div().font_semibold().text_color(this.labelInk(t, t.background)).child("LATEST UPDATE"))
          .child(h_flex().gap(4).items_center().text_size(11.5).text_color(t.dim).min_w(0)
            .child(div().child("·")).child(svg(ICON("bell")).size(11).flex_none())
            .child(div().min_w(0).truncate().child(`after ${plural(turn.followups, "background update")}`)));
      case "latest": {
        if (r.md) return v_flex().mt(6)
          .child(this.readBlock(div()).child(this.mdView(tv(`th-lmd-${r.key}`), r.md, this.replySelectable())))
          .child(div().h(22).flex().items_center().text_size(12).text_color(t.accent).child("Show less"));
        // One block that gpui wraps at the card's width, 21 px a line, in a box that shows
        // whole lines up to LATEST_LINES (C5).
        const block = this.readBlock(div()).text_color(t.foreground).child(r.text);
        if (probe) return block;
        return v_flex().mt(6)
          .child(div().h(this.latestBox(r)).overflow_hidden().child(block))
          .when(this.latestCut(r), (el) => el.child(div().h(22).flex().items_center().text_size(12).text_color(t.accent).child("Show all")));
      }
      case "noreply":
        if (turn.answeredIn && !probe) {
          return div().id(`th-answer-${r.key}`).mt(6).text_size(12.5).text_color(t.accent).cursor_pointer()
            .on_click((_e, cx) => { cx.stop_propagation(); this.goToAnswer(turn); cx.notify(); })
            .child(this.noReplyText(turn));
        }
        return div().mt(6).text_size(12.5).text_color(t.dim).child(this.noReplyText(turn));
      case "cmd":
        return this.cmdBlock(r.md, tv(`th-cmd-${r.key}`));
      case "md":
        // The reply at its own height: no scroll inside the card, so its start never scrolls
        // out of view and its end is never cut (C3).
        // A block Herdr drew at no height (mdBroken) shows as plain text with a note, so a
        // reply never vanishes.
        if (this.mdBroken?.has(r.key)) return v_flex().mt(r.gap ?? 6).gap(4)
          .child(h_flex().gap(5).items_center().text_size(11.5).text_color(t.warning ?? t.dim)
            .child(svg(ICON("alert")).size(12).flex_none())
            .child(div().min_w(0).child("Herdr could not draw this part as Markdown, so it shows as plain text.")))
          .child(this.readBlock(div()).text_color(t.foreground).child(r.src ?? r.md));
        return this.readBlock(div().mt(r.gap ?? 6))
          .child(this.mdView(tv(`th-md-${r.key}`), r.md, this.replySelectable()));
      case "seltext": {
        const st = this.selEditor?.st;
        return v_flex().mt(6)
          .child(h_flex().h(22).gap(5).items_center().text_size(11.5).text_color(t.dim).min_w(0)
            .child(svg(ICON("text-cursor")).size(12).flex_none())
            .child(div().min_w(0).truncate().child(this.selectHint())))
          // An accent border says the reply is in Select view.
          .child(div().h(r.boxH).rounded(7).border_1().border_color(t.accent).bg(t.background).overflow_hidden()
            .child(st ? Editor.new(st).size_full().px(6).py(6) : div()));
      }
      case "codehead": {
        const copied = this.copied?.id === `code:${r.key.slice(3)}`;
        return (h_flex().mt(8).h(28).pl(10).pr(4).gap(6).items_center().rounded_t(7).bg(t.chrome).border_1().border_color(t.border)
          // The fence's language when it names one; no label otherwise.
          .child(div().flex_1().text_size(11.5).font_family(mono).text_color(t.dim).child(r.seg.lang || ""))
          .child(h_flex().h(22).px(7).gap(5).items_center().rounded(5).text_size(11.5)
            .text_color(copied ? t.ansi2 : t.muted).when(copied, (el) => el.bg(alpha(t.ansi2, 0.13)))
            .child(svg(ICON(copied ? "check" : "copy")).size(12)).child(copied ? "Copied" : "Copy")));
      }
      case "code": {
        const st = this.code.get(`${tkey}:${r.i}`)?.st;
        return (v_flex()
          .child(div().h(this.codeBoxH(r)).rounded_b(7).overflow_hidden().border_1().border_t(0).border_color(t.border).bg(t.background)
            .text_size(12).line_height(`${CODE_LINE}px`)
            .child(st ? Editor.new(st).size_full().py(6) : div().p(8).text_size(12).line_height(`${CODE_LINE}px`).font_family(mono).text_color(t.muted).child(r.seg.text)))
          // One 18 px line at any width (its height is fixed): short, and cut with an ellipsis.
          .when(r.caption, (el) => el.child(div().pt(6).text_size(11.5).line_height("18px").truncate().text_color(t.dim)
            .child(`${plural(r.rows, "row")} · scrolls inside`))));
      }
      case "fold":
        // Quiet: no border or fill, so it reads as the end of the reply, not a button to find.
        return v_flex().mt(8)
          .when(r.left > 0, (el) => el.child(div().h(18).text_size(11.5).line_height("18px").truncate().text_color(t.dim)
            .child(`${r.left.toLocaleString()} more characters are left out here. c copies the whole reply.`)))
          .child(h_flex().h(26).gap(5).items_center().text_size(12).text_color(t.dim)
            .child(svg(ICON("chevron-up")).size(12)).child("Collapse").child(div().text_size(11).font_family(mono).child("Esc")));
      case "stats": {
        // The stats under the reply, as on a closed exchange, with what only an open turn
        // shows after them: cache hit and a compaction. The info icon (or i, or a click on
        // the line) explains them. The exact counts follow on their own 16 px lines (C1).
        return v_flex().mt(10)
          .child(h_flex().gap(6).items_start()
            .child(div().flex_1().min_w(0).text_size(11.5).line_height("16px").font_family(mono).text_color(t.dim).child(this.statsFull(turn)))
            .child(h_flex().flex_none().h(16).items_center()
              .child(svg(ICON("info")).size(12).text_color(this.legendOn ? t.accent : t.dim))))
          .when(Boolean(this.countsLine(turn)), (el) => el.child(div().w_full().pt(6).text_size(11).line_height("16px").font_family(mono).text_color(this.labelInk(t, t.background)).child(this.countsLine(turn))));
      }
      case "imgs": return v_flex().pt(8).child(this.thumbStrip(t, turn, tkey));
      case "itext":
        // The agent's interim text, as Markdown at the reading size, between step groups.
        return this.readBlock(div().mt(6)).child(this.mdView(tv(`th-it-${r.key}`), r.md, this.replySelectable()));
      case "grp": {
        // A step group's line: the tool icon until its calls are read, then a check, or a red
        // mark and how many failed; the spinner while it runs (with what runs now, once read);
        // and a chevron.
        const open = this.groupOpen.has(`${tkey}:${r.gi}`);
        const g = this.groupInfo(r);
        return h_flex().mt(STEP_GAP).h(GROUP_H).gap(6).items_center().min_w(0).max_w(this.prose()).text_size(12.5).text_color(r.now ? t.dim : t.muted)
          .child(r.now ? this.liveIcon(this.liveState(t), 12)
            : svg(ICON(g.failed ? "circle-x" : g.known ? "check" : "wrench")).size(12).flex_none().text_color(g.failed ? t.blocked : t.dim))
          .child(div().flex_none().child(groupText(r.step.calls, r.step.count, r.now)))
          .when(g.failed > 0, (e) => e.child(div().flex_none().text_color(t.blocked).child(`· ${g.failed} failed`)))
          .when(Boolean(g.current), (e) => e.child(div().min_w(0).truncate().font_family(mono).text_size(11.5).text_color(t.dim).child(g.current)))
          .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim));
      }
      case "call": {
        // One call in an open group: its kind's icon, then what it ran or read once calls.sh
        // has read it (the tool's name until then), how long it took, and a chevron for its
        // output (level 3). A failed call's icon is red. A group of one is this row alone.
        if (r.more) {
          return h_flex().h(CALL_H).pl(18).gap(6).items_center().min_w(0).max_w(this.prose()).text_size(12).text_color(t.dim)
            .child(svg(ICON("plus")).size(12).flex_none()).child(div().min_w(0).truncate().child(`${r.more} more calls`));
        }
        const c = this.callEntry(r.si, r.id);
        const time = callTime(c?.inTs, c?.outTs, c?.ms);
        const open = this.callOpen.has(`${tkey}:${r.gi}:${r.ci}`);
        const icon = r.now ? this.liveIcon(this.liveState(t), 12)
          : svg(ICON(c?.err ? "circle-x" : KIND_ICON[toolKind(r.name)])).size(12).flex_none().when(Boolean(c?.err), (e) => e.text_color(t.blocked));
        return h_flex().when(r.one, (e) => e.mt(STEP_GAP).h(GROUP_H)).when(!r.one, (e) => e.h(CALL_H).pl(18))
          .gap(6).items_center().min_w(0).max_w(this.prose()).text_size(12).text_color(t.dim)
          .child(icon)
          .child(div().flex_1().min_w(0).truncate().font_family(mono).text_color(c?.input != null ? t.muted : t.dim).child(this.short(callText(r.name, c?.input))))
          .when(Boolean(time), (e) => e.child(div().flex_none().text_size(11).child(time)))
          .when(Boolean(r.id), (e) => e.child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(12).flex_none()));
      }
      case "cout": {
        // A call's output (level 3): mono lines, not wrapped, OUT.SHOW of them with the last
        // ones fading when more are left out, and Show all (up to OUT.MAX) or Show less.
        const lines = r.box.lines;
        const note = r.going ? "Running…" : r.st === "wait" ? "Reading…" : r.st === "err" ? "Could not read this call" : r.st === "none" ? "Not in the transcript" : "No output";
        const fade = (i) => (r.box.cut && i >= lines.length - 3 ? alpha(t.muted, [0.75, 0.5, 0.25][i - (lines.length - 3)]) : t.muted);
        const more = r.box.cut ? (r.all ? `Showing ${lines.length} of ${r.box.total} lines` : `Show all ${r.box.total} lines`) : r.all && r.box.total > OUT.SHOW ? "Show less" : null;
        return v_flex().pl(18).pt(2).pb(2).min_w(0).max_w(this.prose())
          .child(v_flex().px(10).py(OUT.PAD).rounded(6).border_1().border_color(t.border).bg(t.background).min_w(0).overflow_hidden().text_size(11.5)
            .children(lines.length
              ? lines.map((l, i) => div().h(OUT.LINE).line_height(`${OUT.LINE}px`).truncate().font_family(mono).text_color(fade(i)).child(this.short(l) || " "))
              : [div().h(OUT.LINE).line_height(`${OUT.LINE}px`).text_color(t.dim).child(note)]))
          .when(Boolean(more), (e) => e.child(div().h(OUT.MORE).line_height(`${OUT.MORE}px`).text_size(11.5).text_color(t.accent).child(more)));
      }
      case "wspin":
        return h_flex().mt(STEP_GAP).h(GROUP_H).gap(6).items_center().text_size(12.5).text_color(t.working)
          .child(this.liveIcon(this.liveState(t), 12)).child("Working…");
      case "legend":
        return v_flex().mt(6).gap(4).children(this.legendEntries(turn).map(([icon, text]) => h_flex().gap(6).items_start()
          .child(svg(ICON(icon)).size(11).mt(4).flex_none().text_color(t.dim))
          .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.muted).child(text))));
      case "copy": return this.reveal(t, div().id(`cph:${tkey}`).pt(ROW.GAP)).child(this.actsStrip(t, turn, tkey, this.sel === tkey, true));
    }
    return div();
  }

  // The colour of the card's caps labels (FINAL REPLY, LATEST UPDATE, YOU) and counts line
  // on bg (ui.js cardLabelColor): muted, or foreground where muted reads under 4.5:1.
  labelInk(t, bg = t.raised) {
    const k = `${t.muted}|${t.foreground}|${bg}`;
    if (this.inkKey !== k) { this.inkKey = k; this.inkMemo = cardLabelColor(t, bg); }
    return this.inkMemo;
  }

  // Whether the quote key can act on this pane at all: a pane shows a terminal on this
  // computer (the rest is checked at the press).
  quotable() { return Boolean(this.pane()) && !this.terminal.includes("/"); }

  // The Select view's hint line.
  selectHint() {
    return this.narrow() ? `⌘C, then ${this.quoteKey} quotes it · s returns` : `Select text, ⌘C, then ${this.quoteKey} quotes it · s or Esc returns`;
  }

  // The settings panel's line on the keys the file sets by hand.
  settingsLine() {
    const bad = (this.linkCount ?? 0) - this.links.length;
    return `Link rules · ${this.linkCount ?? 0}${bad > 0 ? ` (${bad} not valid)` : ""} · Quote key · ${this.quoteKey}`;
  }

  // Key hints that apply now, on one row: [key, label]. The most-used keys (move, open,
  // copy, quote, filter, pin) and "? keys", which opens the sheet with every key; what does
  // not fit the pane's width gives way from the right, "? keys" last (ui.js fitHints). In
  // Select view: how to select, copy, quote and go back.
  footerHints() {
    const narrow = this.narrow();
    if (this.selecting) return narrow ? [["⌘C", "copy"], [this.quoteKey, "quote"], ["Esc", "back"]]
      : [["drag", "select"], ["⌘C", "copy"], ...(this.quotable() ? [[this.quoteKey, "quote"]] : []), ["Esc", "back"]];
    const quote = this.quotable() ? [[this.quoteKey, "quote"]] : [];
    const pin = this.quoteKey !== "p";
    const pinHint = pin ? [["p", this.sel && this.isPinned(this.sel) ? "unpin" : "pin"]] : [];
    // The outline: move, open the turn, back to the list, then search and pin.
    if (this.outlined()) return fitHints([["↑↓", "move"], ["↵", "open"], ["Esc", "list"], ["/", "filter"], ...pinHint, ["?", "keys"]], this.pw());
    // The Pinned column has no outline; in the list the outline's hint gives way first.
    const out = this.view === "pinned"
      ? [["↑↓", "next pin"], ["↵", "open"], ["c", "copy"], ...quote, ...(pin ? [["p", "unpin"]] : [])]
      : [["↑↓", "move"], ["↵", "open"], ["c", "copy"], ...quote, ["/", "filter"], ...pinHint, ["→", "work"], ["o", "outline"]];
    return fitHints([...out, ["?", "keys"]], this.pw());
  }

  footer(t) {
    const hint = (k, label) => (k === "?"
      ? h_flex().id("th-keys-hint").cursor_pointer().tooltip("Every key (?)")
        .on_click((_e, cx) => { cx.stop_propagation(); this.action("keys", cx); cx.notify(); })
      : h_flex()).flex_none().gap(4).items_center().child(this.kbd(t, k)).child(div().flex_none().whitespace_nowrap().text_size(11.5).text_color(t.dim).child(label));
    // One row: the hints that fit (footerHints), and a toast sits above them.
    return h_flex().id("th-footer").flex_none().pl(10).pr(16).py(7).gap(10).items_center().overflow_hidden().border_t(1).border_color(t.border)
      .on_size_change((size, cx) => {
        const h = size.height / this.zoom();
        if (Math.abs(h - (this.footerH ?? 0)) > 1) { this.footerH = h; cx.notify(); }
      })
      .children(this.footerHints().map(([k, label]) => hint(k, label)));
  }

  // The sheet's card: as tall as its keys (a 36 px title, 10 px padding above and below, each
  // group's 16 px name, 25 px a key row, 6 px gaps inside a group and 12 px between groups),
  // and no taller than the room between the header and the footer, where its list scrolls.
  keySheetH(groups) {
    const rows = groups.reduce((n, [, items]) => n + items.length, 0);
    const want = 36 + 20 + groups.length * (16 + 6) + rows * 25 + (groups.length - 1) * 12 + 8;
    const room = (this.rootH || 600) - 46 - (this.footerH ?? 38) - 6;
    return Math.max(120, Math.min(want, room));
  }

  // ?: every key, grouped (ui.js keySheet), over the list between the header and the footer.
  // Esc, ?, the close button or a click outside the card closes it.
  keySheetView(t) {
    const close = (_e, cx) => { cx.stop_propagation(); this.keysOpen = false; cx.notify(); };
    const row = ([keys, what]) => h_flex().gap(8).items_start().min_w(0)
      .child(h_flex().flex_none().w(92).gap(3).flex_wrap().children(keys.map((k) => this.kbd(t, k))))
      .child(div().flex_1().min_w(0).text_size(12).text_color(t.foreground).child(what));
    const groups = keySheet(this.quoteKey, { outline: !this.pinnedPane });
    return div().id("th-keys-scrim").absolute().top(0).left(0).right(0).bottom(0).bg(alpha(t.background, 0.6))
      .on_click(close)
      .child(v_flex().id("th-keys").absolute().top(46).left(10).right(10).h(this.keySheetH(groups))
        .rounded(8).border_1().border_color(t.border).bg(t.popover).shadow_md()
        .on_click((_e, cx) => cx.stop_propagation())
        .child(h_flex().flex_none().h(36).px(12).gap(8).items_center().border_b(1).border_color(t.border)
          .child(div().flex_1().min_w(0).text_size(13).font_semibold().text_color(t.foreground).child("Keys"))
          .child(this.kbd(t, "?"))
          .child(this.iconButton(t, "th-keys-close", "x", "Close (Esc)", close)))
        .child(v_flex().id("th-keys-list").flex_1().min_h(0).overflow_y_scrollbar().px(12).py(10).gap(12)
          .children(groups.map(([group, items]) => v_flex().gap(6)
            .child(div().text_size(11).font_semibold().text_color(t.muted).child(group))
            .children(items.map(row))))));
  }

  // True when the shown turns span more than one day (day dividers, and [ ] moves by day).
  manyDays() {
    const days = new Set();
    for (const s of this.sessions) for (const t of s.turns) { days.add(t.day ?? dayKey(t.ts)); if (days.size > 1) return true; }
    return false;
  }

  // ---- the rail ----
  // On the list's right edge, in place of the scrollbar, in the list's own view: one tick per
  // turn (ui.js railLayout). Turns on screen are brighter, the selected turn's tick is longer,
  // a pinned turn's takes the accent colour and the running turn's pulses. A search dims the
  // turns it leaves out. A tick's tooltip is one line, and a click puts the turn's top at the
  // top of the pane, as a pin return does.
  railShown() {
    return this.view !== "pinned" && !this.pinnedPane && !this.outlined() && (this.railTurns?.length ?? 0) > 1;
  }
  railTicks() {
    const list = this.railTurns ?? [];
    let days = 0;
    for (let i = 1; i < list.length; i++) if (list[i].day && list[i].day !== list[i - 1].day) days++;
    const L = railLayout(list.length, days, Math.max(0, this.listH));
    // Which turns are on screen, from the range the list last drew.
    const rows = this.rowsMemo ?? [];
    const [a, b] = this.viewRange ?? [0, 0];
    const on = new Set();
    for (let i = a; i < Math.min(b, rows.length); i++) { const k = rowTurnKey(rows[i]); if (k) on.add(k); }
    const ticks = [];
    for (let i = 0; i < list.length; i += L.per) {
      const g = list.slice(i, i + L.per);
      const first = g[0];
      const prev = list[i - 1];
      ticks.push({
        key: first.key, last: g[g.length - 1], turns: g,
        dayStart: L.dayGap && Boolean(prev && first.day && first.day !== prev.day),
        sel: g.some((x) => x.key === this.sel), pinned: g.some((x) => this.isPinnedTurn(x.turn)),
        live: g.some((x) => x.live), inView: g.some((x) => on.has(x.key)), miss: g.every((x) => x.miss),
      });
    }
    return { L, ticks };
  }
  railTip(k) {
    const a = k.turns[0].turn;
    if (k.turns.length > 1) return `#${a.n} to #${k.last.turn.n}`;
    const text = String(a.prompt ?? "").replace(/\s+/g, " ").trim();
    const cut = text.length > 60 ? `${text.slice(0, 59)}…` : text;
    return [`#${a.n}`, k.live ? "now" : fmtTime(a.ts), k.pinned ? "pinned" : null, cut || null].filter(Boolean).join(" · ");
  }
  // The rail card (Herdr 0.1.15, Popup): a tick's turn on two lines, its number and time over
  // its prompt, at most two lines of it. A tick that stands for several turns names the range.
  railCard(k) {
    const a = k.turns[0].turn;
    const head = k.turns.length > 1 ? `#${a.n} to #${k.last.turn.n}`
      : [`#${a.n}`, k.live ? "now" : fmtTime(a.ts), k.pinned ? "pinned" : null].filter(Boolean).join(" · ");
    const text = String(a.prompt ?? "").replace(/\s+/g, " ").trim();
    return { head, body: clipPrompt(text, 2, RAIL.CARD_CHARS, 200).text };
  }
  railView(t) {
    const { L, ticks } = this.railTicks();
    const busy = this.liveState(t).color;
    return v_flex().id("th-rail").absolute().top(RAIL.PAD).bottom(RAIL.PAD).right(0).w(RAIL.W).justify_center().items_end()
      .children(ticks.map((k, i) => {
        const color = k.live ? busy : k.pinned ? t.accent : k.sel ? t.foreground : k.inView ? t.muted : t.dim;
        const op = k.miss ? 0.16 : k.live || k.pinned || k.sel || k.inView ? 1 : 0.5;
        const mark = div().flex_none().w(k.sel ? RAIL.SEL : RAIL.MARK).h(L.mark).rounded(1).bg(color).opacity(op)
          .when(k.live, (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1400 }));
        const tick = div().id(`th-tick-${i}`).flex_none().w(RAIL.W).h(L.pitch).flex().items_center().justify_end().pr(RAIL.RIGHT)
          .when(k.dayStart, (el) => el.mt(RAIL.DAY)).cursor_pointer().rounded(2).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { cx.stop_propagation(); this.railJump(k.key, cx); })
          .child(mark);
        // On Herdr 0.1.15 a hovered tick shows the card beside it, to its left; before that,
        // the one-line tooltip.
        if (!Popup) return tick.tooltip(this.railTip(k));
        const open = this.railHover === k.key;
        return Popup.new(`th-tick-card-${i}`, tick.on_hover((on, cx) => {
          if (on) this.railHover = k.key;
          else if (this.railHover === k.key) this.railHover = null;
          cx.notify();
        })).anchor("right_center").when(open, (el) => el.content(this.railCardView(t, k)));
      }));
  }
  railCardView(t, k) {
    const c = this.railCard(k);
    return v_flex().id("th-rail-card").mr(RAIL.CARD_GAP).w(Math.min(RAIL.CARD_W, Math.max(120, this.width - 44))).px(10).py(7).gap(2)
      .rounded(8).border_1().border_color(t.border).bg(t.popover ?? t.raised).shadow_md()
      .child(div().text_size(11).line_height("15px").text_color(t.dim).child(c.head))
      .when(Boolean(c.body), (el) => el.child(div().text_size(12.5).line_height("18px").max_h(36).overflow_hidden().text_color(t.foreground).child(c.body)));
  }
  railJump(key, cx) {
    this.toList();
    this.sel = key;
    this.follow = false;
    this.toBottom = false;
    this.scrollTo = { key, how: "head" };
    cx.notify();
  }

  // The Jump to latest pill: it floats at the bottom centre of the list while the end of the
  // list is off screen, in the list's own view (not the outline or the Pinned view). A down
  // arrow leads its label, and a dot leads both while something new came in below the screen.
  pillShown() {
    return this.bottomShown === false && this.view !== "pinned" && !this.pinnedPane && !this.outlined();
  }
  pillView(t) {
    const dot = this.unseen === true;
    return h_flex().absolute().bottom((this.footerH ?? 38) + PILL_GAP).left(0).right(0).justify_center()
      .child(h_flex().id("th-latest-pill").flex_none().h(PILL_H).px(12).gap(6).items_center().rounded(PILL_H / 2)
        .bg(t.popover).border_1().border_color(t.border).shadow_md().cursor_pointer()
        .text_size(12).text_color(t.foreground).hover((s) => s.bg(t.hover))
        .tooltip(dot ? "New below · jump to latest (End)" : "Jump to latest (End)")
        .on_click((_e, cx) => { cx.stop_propagation(); this.action("latest", cx); cx.notify(); })
        .when(dot, (el) => el.child(div().id("th-latest-pill-dot").flex_none().size(6).rounded(3).bg(t.accent)))
        .child(svg(ICON("arrow-down")).size(12).flex_none().text_color(t.muted))
        .child(div().flex_none().child("Jump to latest")));
  }

  toastView(t) {
    // Just above the footer, whose hints can wrap to two lines, and above the pill.
    const pill = this.pillShown() ? PILL_H + PILL_GAP : 0;
    return h_flex().absolute().bottom((this.footerH ?? 38) + 6 + pill).left(0).right(0).justify_center()
      .child(h_flex().min_h(32).max_w(Math.max(120, this.width - 24)).px(12).py(6).gap(7).items_center().rounded(8).bg(t.popover).border_1().border_color(t.border).shadow_md()
        .text_size(12.5).text_color(t.foreground)
        .child(svg(ICON(this.toast.icon ?? "check")).size(13).flex_none().text_color(this.toast.icon === "circle-x" ? t.blocked : this.toast.icon === "check" ? t.ansi2 : t.muted))
        .child(div().min_w(0).max_h(44).overflow_hidden().child(this.toast.text)));
  }
}
