// agent-threads: a pane beside a Claude Code, Codex, OpenCode, Pi, Cursor or Antigravity terminal that lists each prompt
// and the agent's final reply, with tool calls hidden. Read-only toward the agent, with one
// exception (RECIPE.md, How it behaves): quoteToTerminal() pastes a quote of a reply into the
// bound terminal's input as a bracketed paste (Herdr's terminal.paste, the ⌘V command),
// never followed by Enter or any other submit. Nothing else types into a terminal. The
// other commands it runs are pane.split (to open itself, and the Pinned column beside it),
// layout.resize (to give that column its width, a pane Cmd-Shift-T opened the reading width, then a weight that keeps that width), pane.focus (the Terminal button, v
// between the two panes, back to Threads after the column opens, and before the quote's paste) and pane.close (its own pane, the Pinned column once its Threads pane is gone, and a Trajectory split the row has no room for). The only programs
// it runs besides its scripts are hc get, git remote get-url and open <the README URL> (the
// Amp page's button; the scripts run jq, lsof, ps
// and sqlite3 -readonly). The only file it writes
// is its own settings file (settings.js). The Link rules page hands two kinds of web address
// to Herdr's cx.open_url (http and https only): a rule's address (Open) and MDN's regular
// expression cheat sheet (Reference).
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
// How long the pointer rests on a line's info icon before its Turn card shows, and how long the
// card stays after the pointer leaves the icon and the card (time to cross the gap between).
const HOVER_OPEN_MS = 300;
const HOVER_CLOSE_MS = 200;
// HoverCard opens the Turn card while the pointer rests on a line's info icon. It owns its open
// state, so it needs no handler, which a list item cannot carry.
const HoverCard = Popup && gpuiBase.HoverCard?.new ? gpuiBase.HoverCard : null;
// A method an older Herdr's elements may lack: called when the element has it, or the element
// is kept as it is. Asked with `in`: on Herdr's diagnostic re-run typeof says "function" for
// any name.
const maybe = (el, name, ...args) => (name in el ? el[name](...args) : el);
// The settings card's Tab and Shift-Tab (issue 104). Plain Tab is the window's own key: it
// moves the keyboard to the next focusable element before a pane's on_key_down sees it. These
// bindings sit in the card's own key context (CARD_CONTEXT), which the pane's root declares
// while the card is open (cardKeyContext); a binding in a deeper context goes before the
// window's, and its actions reach the root's on_action handlers, which move the ring.
const CARD_CONTEXT = "ThreadsCard";
const CARD_BINDINGS = [
  { keystroke: "tab", action: "agent-threads.ringNext", context: CARD_CONTEXT },
  { keystroke: "shift-tab", action: "agent-threads.ringBack", context: CARD_CONTEXT },
];
// Installed once for all the mod's panes (keyInstaller): by the first pane's init, and, only
// if that call threw, once more when the card first opens, whatever other panes' inits did
// in between; never from render, where Herdr refuses it. cardKeys.answer is what Herdr
// said, for the debug report.
const cardKeys = keyInstaller(CARD_BINDINGS);
// PathBuilder and Background paint the fade under the floating top as a gradient (Herdr
// 0.1.15); read from the namespace for the same reason, with steps of alpha without them.
import * as gpuiKit from "gpui-kit";
// window() (the platform) is read from the namespace, so a Herdr without it still loads the mod.
import * as herdrNs from "herdr";
const PAINT = gpuiKit.PathBuilder?.fill && gpuiKit.Background?.linear_gradient ? gpuiKit : null;
import {
  exec, hc, home, appHome, readTextFile, watchFolder, theme, themes, settings, panes, terminals, spaces,
  focused, props, run, shared, setShared, closeOverlay, openOverlay, notify, nextCommand, updates,
} from "herdr";
import {
  newSession, apply, rewindTail, newChunk, parseLine, nextChunk, readCap, replaced, reply, updatesText, stats, segments, threadMatches, remarkSenders, ruleSender, typedTurn, RULE_TEXT,
  fmtTokens, fmtDuration, fmtClock, fmtTime, fmtBytes, shortModel, fmtPct, cacheLine, cachePct, commandParts, fmtCount, turnSums, sumsStats,
  noteSkip, skipNote,
} from "./core/turns.js";
import { claudePaths, slug, argvSession, recordSession, decide, dividerLabel, candidates } from "./session.js";
import { HARNESS, harnessOf, harnessOfFile, idOfFile, dbOfFile, fileChanged, codexArgvSession, pickCodexDaemon, claudeAttach, opencodeAttach, opencodeArgv, etimeMs, pickOpenCode, openCodeLabel, quotePaste, piArgv, piFolder, piStartMs, cursorFolder, cursorStore, cursorArgv, cursorRoots, MARKS, agyBrain, agyArgv, agyFile, UNREAD, unreadOf } from "./harness.js";
import {
  keyAction, ringKey, nextStop, keyInstaller, alpha, spans, around, langFor, clipPrompt, wrappedLines, dayKey, dayLabel, dayParts, jumpTarget, searchable, ledgerKey, TRAJ_MAX,
  rowLines, flattenMd, searchPreview, rowShape, rowTextWidth, replyWidth, readWidth, readType, bubbleMax, ROW, senderLabel, senderParts, senderOrigin, senderIcon, kindWords, noticeTurn, isShown, agentReplied, countLabel,
  focusTarget, contrast, labelColor, matchFill, middle, commandColor, clipYou, promptMd, promptLinks, linkLineRows, promptParts, hyphenBreaks, breakSpans, HYPHEN_BREAK, linkify, escapeMd,
  quoteText, inReply, atLeast, foreground, canQuote, parseRemote, repoFits, actsLayout, stripLayout, boxHit, infoBox, ICON_BOX, QUOTE_INSET, cardLabelColor, bandFill, over, bubbleStyle, bubbleValue, BUBBLES,
  thumbSize, tileRow, TILE_GAP, mdPreview, mdChunks, escapeDollars, cutMd, rowHeight, pinColumn, PIN_COL, PIN_SPLIT_MIN, galleryBox, headerButtonWidth, fitWidth, columnWidth, columnStep, STEPS, railLook, columnResize, PIN_STEP, PIN_ROW, pinRowShape, pinPromptText, trajColumn, trajFit, TERM_KEEP, TRAJ_MIN,
  REWRAP_PAUSE_MS, keySheet, fitHints, statusGroups, agentState, linkPieces, outlineText, outlineHeight, outlineNumW, VIEWER, viewerLayout, viewerKey, labelPieces, replyBlocks, replyScroll, cardKey, cardMarks, cardScroll, cardReveal, fencedBlock, mix, RAIL, railWindow, railSwell, railDay, toolKind, groupText, KIND_ICON, callTime, outLines, outHeight, outLang, callText, shortPaths, OUT, splitTables, tableNeed, tableCells, htmlChunks, MONO_EM, cutPath, wrapCap, codeRows, railRoom, landPlan, landExact, listOffset, placeAt, anchorPlan, pasteLabel, weightLine, weightFor, weightNear, pairEvent, pairAlone, pinFit, weightHerdr, rowEvent, closeWeights, rowSolve,
} from "./ui.js";
import { openLines, newestPrompt, figRuns } from "./ui.js";
import { PIN_LIMIT, turnIds, parsePins, pinsText, mergeDirty, seenOf, newPin, pinState, partOf, partKeys, NOT_A_PLACE, placeAtTop, placeItem, byTime } from "./pins.js";
import { DEFAULTS, RANGES, LOOK, parseSettings, parseExtras, parseQuoteKey, parseLinks, parseSenders, checkSender, ruleFault, templateHost, MAX_RULES, LINK_TEMPLATES, LINK_TYPES, DESCRIPTION_MAX, defaultLinks, settingsText, settingsDir, settingsPath, saveSettings, pinsPath, savePinsText, writable, NOT_SAVED, adoptPrevious, behindLook } from "./settings.js";
import { MOD } from "./name.js";
import {
  LEDGER_ROW, LEDGER_HEAD, LEDGER_FILTERS, LEDGER_KINDS, ledgerTurn, headParts, ledgerTotals, barFrac, coarse, rowTimes, trajCompact, compactRow, COMPACT_PAD, HEAD_ICON_MIN,
  WIDE_MIN, trajInks, SUB_ALPHA, ALL_ROWS, filterRows, filterButtons, toggleFilter, ledgerStatus, detailOf, turnRunning, slantPoints, sessionHasEnds,
  BAR_W, BAR_H, BAR_SLANT, LINE_H, LINE_SLANT, trajLayout, rowsLeft,
} from "./ledger.js";
import { VERSION, versionLine, parseBuild } from "./version.js";
// build.js, what install.sh found (version.js). A dynamic import, so a copy whose build.js
// is missing or does not parse still loads; the version line then says the commit is not
// known. It settles long before anyone opens the settings card.
let built = null;
import("./build.js")
  .then((m) => { built = parseBuild(m?.BUILD) ? m.BUILD : null; })
  .catch(() => { built = null; });
import { isDiagram, drawDiagram } from "./diagram.js";

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
// A read's first extractor call takes CHUNK, so the first figures (and the opening's newest
// prompt) come at once; each later call of that read takes twice the last, up to READ_CHUNK
// (2, 4, 8, 16 MiB), so a short session's bar still steps. A call starts about a dozen
// processes whatever its size, two thirds of a 2 MiB call's time, so fewer, larger calls read
// a long transcript several times as fast. A read of new bytes starts at CHUNK again.
const CHUNK = 2 * 1024 * 1024;
const READ_CHUNK = 16 * 1024 * 1024;
const SLICE_MS = 8; // synchronous work before read() yields to the app
// The opening (openGate): a pane whose list is ready within OPEN_QUIET_MS of its first draw
// goes straight to it, and paints nothing before; a longer one shows the loading state
// (openView). OPEN_PEEK: the bytes at the file's end read once for the newest prompt.
const OPEN_QUIET_MS = 300;
// The loading state's figures held at their peak (openInfo).
const OPEN_PEAKS = ["offset", "size", "turns", "prompts", "tools", "tokens"];
const OPEN_PEEK = 2 * 1024 * 1024;
const COUNT_MS = 6; // a sender rule's count in the editor, a draw at most (senderMatches)
// Reshaping collapsed rows (shape) in one draw: a change of Reply lines, Prompt lines, text
// size, the width or the search reshapes every row, and in a long session that ran past
// Herdr's time for a draw ("This view could not be re-rendered", interrupted). Past this
// many ms a row keeps the shape it had, and the next frame goes on (rows, render).
const SHAPE_MS = 12;
// Rows reshaped first, from the one at the top of the pane down, so what is on screen
// changes in the first frame.
const SHAPE_FIRST = 40;
// Turns at least this long (prompt and reply, in characters) teach the shaping rate (shapeLearn).
const SHAPE_LEARN = 4000;
// The hidden probe (probe) draws at most this many parts in one frame, nearest the top of
// the pane first. Opening the work of a turn with hundreds of steps put every interim text
// in one draw, and it ran past Herdr's time ("This view could not be re-rendered",
// interrupted). The rest are measured over the next frames.
const PROBE_MAX = 16;
// Rows probeDue looks at in one frame. With every part near the top measured, its walk went
// on to every row: 45 to 48 ms in one frame at 6,000 turns on the rig, after each rebuild.
// 300 rows took 7 to 8 ms there; the next frame goes on from there (probeWalk).
const PROBE_WALK = 300;
// Herdr stops a draw that runs past its time (about 50 ms) and keeps the last frame that
// worked, so a draw that never fits would leave the pane blank for good. A row whose draw was
// stopped is drawn plainly for CUT_MS (its Markdown as plain text), and
// blank if that is stopped too; the wait doubles each time, up to five minutes. A stopped
// render draws without reshaping or measuring for CUT_MS.
const CUT_MS = 5000;
// How soon a render Herdr stopped is asked for again, and how long a scroll to a place waits
// for the rows to be built and shaped before it goes ahead with the heights it has.
const CUT_WATCH_MS = 250;
// What a draw should cost. Reshaping and building rows share what the rest of the last draw
// left of it, each down to its floor, so a machine where the rest of a draw is slow does
// less of both per frame and stays clear of Herdr's 50 ms stop.
const FRAME_AIM_MS = 30;
const SHAPE_MIN_MS = 2;
const BUILD_MIN_MS = 3;
// A slice of the search's matches (scanStep): SCAN_MS a draw at most, SCAN_MIN_MS at least.
const SCAN_MS = 6;
const SCAN_MIN_MS = 1;
const SCROLL_WAIT_MS = 2000;
// While a place is held, the probe measures this many rows below the top row with the rows
// above it, and the rest of the rows below once it is let go.
const PROBE_NEAR = 24;
// Markdown split for TextView, kept for the texts drawn last (mdParts).
const MD_MEMO = 400;
// Rows can be rebuilt from inside a day band every BAND_MARK shown turns (keptFrom).
const BAND_MARK = 100;
// One slice of a rows build: past this, buildRows stops at the next turn and the next frame
// goes on (buildStep).
const BUILD_MS = 10;
// While the pane's width is changing (a drag), the column keeps the width it has and the
// turns are laid out again once the pane has been still for ui.js REWRAP_PAUSE_MS. A width
// change reshapes every turn and measures every reply again: at 2,000 turns that is 3.5 to
// 13 s of redraws on the rig, at every step of a drag.
// Column widths whose shapes, measures and kept rows stay with each turn and part, the
// last used first: a drag that ends at a width seen before lays out in a few frames.
const WIDTHS_KEPT = 3;
// Rows left unsized at the end of a build slice that are sized in it anyway (buildStep).
const SIZE_REST = 64;
// A turn come in while a search is on: the newest turns, from the one keptFrom's rule keeps
// (hitsTail), are checked again for the matches at once when they are this many or fewer;
// more, and they are checked again in slices, as the scan's next slice.
const HITS_TAIL = 64;
// A tail of more turns than this is not checked again: the set is found again from the start,
// in slices. hitsTail's walk back to the tail's start and its drop of the tail's places run in
// one call, not cut by the clock: about 0.5 µs a place in bun with the JIT off (5,960 places
// in 2.9 ms), a few ms at this many on Herdr's interpreter (the rig's figure on Herdr 0.1.18
// is to come; the cap moves if it says so). It is above the 2,000-turn tails the tests check
// again as tails.
const HITS_TAIL_MAX = 2500;
// A step kept from a press that could not land yet (stepHit) goes on for this many draws at
// most, a slice each; then it is dropped with no words, the selection left where it is (an
// older or newer match can still be there: the step gave up, it did not reach the end), and
// the step button starts a new one. The bound is in draws, since a draw's slice is what moves a step on, whatever Herdr's
// frame rate: 100 slices check about 150,000 turns at 6 ms and 4 µs a turn, many times the
// longest sessions the figures use, so a step still kept then is waiting on a session that
// changes before every draw (hitsTail), not on work left.
const STEP_DRAWS = 100;
// The hold (REWRAP_PAUSE_MS) is for a conversation whose last full re-wrap, at a column width
// not kept, took more than this much of the pane's own draw time; before one has finished,
// for one of more than HOLD_TURNS turns. A short one re-wraps at every step of a drag.
const HOLD_WORK_MS = 150;
const HOLD_TURNS = 500;
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
// shared("threads.trajByTerminal"): terminal -> its Trajectory pane (y), kept apart the same way.
const TRAJ_MAP_KEY = "threads.trajByTerminal";
// shared("threads.turnSel"): terminal -> { key, by, at, pane }, the selected turn as the pane that
// last moved it wrote it ("chat" or "trajectory"), so the Chat and its Trajectory pane select the
// same turn (syncSel).
const SEL_KEY = "threads.turnSel";
// The Trajectory pane: split off the Chat from this width (narrower, y shows the Trajectory in
// the Chat's own pane), and given this px width.
const TRAJ_SPLIT_MIN = 480;
const TRAJ_COL = 560;
// The Trajectory split's room probe (settleTraj): the new pane's weight while it takes the
// row's room; the earliest its width is read (the width it was split at may come first, and
// Herdr had applied the weight by 300 ms on the rig); how long that width must hold still;
// and how long to wait before the split goes ahead unmeasured.
const ROOM_WEIGHT = 1000;
const ROOM_FIRST = 400;
const ROOM_STILL = 200;
const ROOM_WAIT = 1500;
// How long the Trajectory pane's width stays held (threads.trajWidth) after the probe ends: the
// fitted width's resize, and the pane measuring it.
const TRAJ_W_HOLD = 1500;
// syncSel: how long a loaded pane waits for a turn the other pane selected and it has not read
// yet, and how old an entry of a terminal may get before a write drops it.
const SEL_WAIT = 5000;
const DAY_MS = 86400000;
// In the Trajectory, the list's commands from keys.json move through the ledger; the others
// it does not mean do nothing there (ledgerAction).
const LEDGER_CMD = { prev: "lprev", next: "lnext", first: "lfirst", latest: "llast", open: "ldetail" };
// shared("threads.fit"): panes the launcher just opened, which size themselves to fitWidth once.
const FIT_KEY = "threads.fit";
// Each pane's measured width, so the Pinned column and its Threads pane can resize together.
const WIDTH_KEY = "threads.width";
// The Pinned column's width as the owner last left it, with - and = (a drag on its divider
// resizes Threads, ui.js columnResize) or any other way Herdr resizes it: { px }, Herdr's
// px size (the measured width and the frame). "hold" until a time: the pane's own resize
// (fitToReading) is under way and is not the owner's choice.
const PIN_W_KEY = "threads.pinWidth";
// The Trajectory pane's width as the owner last left it, kept the same way: { px }.
const TRAJ_W_KEY = "threads.trajWidth";
// The Pinned pair on weights (pairBegin), by terminal: { k, m, p, S } once the Chat
// and the column are both on weights (k the px a unit of weight gets in the row, m and p
// their widths as last seen, S the terminals' weights); { S, hold } while they are at px,
// with no new pair before hold. The column's pane makes and keeps it (pairPoll); either pane
// puts the pair back to px (pairPx).
const PAIR_KEY = "threads.pinPair";
// The row on weights while the Trajectory is open (rowPoll), by terminal: { k, S, ids, n }
// once the Chat, the Trajectory and the Pinned column when open are on weights (ids: their
// panes as { chat, traj, pin }, n their widths by pane, k and S as for the pair, so the
// terminals hold k S px); { S } otherwise, the terminals' weights kept for the next opening.
// The Chat makes and keeps it; the Trajectory and the column read it for - and =.
const ROW_KEY = "threads.row";
// What a new divider takes from the weight panes' room when a pane splits (Herdr's frame gap
// and its line, in design px, so the same at any zoom): about 8 px on the rig. The column's
// opening beside the Trajectory counts it before keeping the terminals' 200 px.
const SPLIT_GAP = 8;
// Both widths still this long before the pair is made or its weights brought up to date.
const PAIR_STILL_MS = 500;
// How long a close waits for the pane that takes the closed one's weight to measure wider
// before it asks its weights anyway (rowCloseStep).
const ROW_CLOSE_WAIT_MS = 400;
const DAY_STRIP = 32; // the Pinned view's strip above the list that shows the day while scrolling
// The floating top: the band the state and the icons sit in over the top of the list, and the
// gap the list leaves above its first row so nothing starts under them.
const TOP_BAND = 32;
// The settings card: at most this wide, and the heights of its fixed parts (the title and the
// foot), so its rows get the rest of the room.
const CARD_W = 440;
const CARD_HEAD = 40;
const CARD_FOOT = 40;
// Its gap to the pane's sides and bottom.
const CARD_GAP = 12;
// How far above the pane's bottom the card ends at the least, so a strip of the list stays
// in view under it (the owner's call): 160 in a pane at least CARD_STRIP_MIN tall. Under that
// the strip shrinks a pixel for each pixel the pane loses, so the card keeps its height until
// the strip is down to the foot's space, and then takes the height: shrinking the pane never
// grows the card (TRD-6). 0 makes the card take the height everywhere.
const CARD_STRIP = 160;
const CARD_STRIP_MIN = 514;
// The strip at the card's right edge that holds its always-drawn scrollbar.
const CARD_BAR_W = 10;
// How long a scroll to the ring may wait for the heights it needs (revealRing), in ms. They
// come in the frame after the parts are drawn, so a reveal runs within a frame or two (a draw
// takes 50 ms at the most); past this it is dropped, so it can never land after the user has
// moved on. Time, not frames: frames come only when something redraws.
const REVEAL_WAIT = 250;
// The keys sheet's key column: wide enough for its widest row's chips (PgUp, PgDn, Space) on
// one line, in a pane at least KEYS_COL_MIN wide. A narrower pane keeps the narrow column,
// where those chips wrap, so the descriptions do not wrap more than they did.
const KEYS_COL = 128;
const KEYS_COL_NARROW = 92;
const KEYS_COL_MIN = 520;
// The card's one page: its sections in order, each with its rows in order (settingsRows draws
// each row from its key). Moving a row or renaming a section is a change to this list alone.
const CARD_SECTIONS = [
  ["Messages", ["textSize", "userColor", "truncate", "time"]],
  ["Agent messages", ["agents", "agentRail", "agentColor", "senderRules"]],
  ["Layout", ["railSide", "keyHints", "statusLine"]],
  ["Links and keys", ["linkRules", "quoteKey"]],
  ["File", ["file"]],
];
// Functions that each build a part of the card's rows, returned by one kid of a column
// (cardCol), so each is a part of its own.
class CardParts { constructor(kids) { this.kids = kids; } }
// Its bands' side inset: 16 px, or 12 under a 320 px card.
const cardPad = (w) => (w < 320 ? 12 : 16);
// A color dot on the card, across (settings-spacing 2).
const SWATCH = 24;
// The card's keyboard ring: how far outside its control it is drawn (issue 104).
const RING_OUT = 3;
// A text button's size: the usual, and the card's, which is the height of its rows' controls.
const BUTTON = { h: 26, px: 9, gap: 5, icon: 13 };
const CARD_BUTTON = { h: 28, px: 10, gap: 6, icon: 14 };
// The settings the card's controls set, which Reset to defaults puts back. viewerReply is the
// image viewer's own switch (i), and quoteKey, links and senders are never reset.
// The status line's height (statusRow).
const STATUS_H = 24;
// The actions by which the reader moves the list or leaves the view (readerMoved): the moving
// keys (j, k, Home, End, the days, n and Shift n, Enter and the arrows into and out of a
// turn), the outline, the Pinned view, the Trajectory, the select mode, the Turn card, the
// search opened or closed, and Escape. Besides these, "go:" (a pin's jump), "pick:" (a session
// switch) and "search:" (a search set by command).
const READER_ACTIONS = new Set(["prev", "next", "first", "latest", "olderMatch", "newerMatch", "open", "jump", "prevDay", "nextDay",
  "outline", "outline:on", "outline:off", "pinned", "trajectory", "select", "legend", "deeper", "shallower", "filter", "escape"]);
const CARD_KEYS = ["textSize", "railSide", "keyHints", "statusLine", "bubbleColor", "agentBubbleColor", "agentTurns", "agentRail", "truncate", "promptLines", "replyLines", "alwaysShowTime"];
// A link rule's type (settings.js LINK_TYPES) and its icon on the Link rules page.
const LINK_ICON = { custom: "regex", ticket: "ticket", "pull-request": "git-pull-request" };
// The rule editor's fields: key, label, placeholder, the most it takes.
const RULE_FIELDS = [
  ["name", "Name", "Ticket", 40],
  ["description", "Description", "Optional", DESCRIPTION_MAX],
  ["pattern", "Finds", "A pattern, such as \\bACME-(\\d+)\\b", 200],
  ["url", "Opens", "An address, such as https://tracker.example.com/ACME-$1", 2000],
  ["example", "Example", "Text this rule should link, such as Fixed in ACME-412.", 200],
];
// The Sender rules page's editor: its fields, as RULE_FIELDS. One of Starts with and Pattern
// shows, as its Type says; each keeps its own text.
const SENDER_FIELDS = [
  ["name", "Name", "Optional", 40],
  ["prefix", "Starts with", "[{name}] ", 100],
  ["pattern", "Pattern", "^From (?<sender>[a-z]+-[a-z-]+):", 200],
  ["example", "Example", "[build-bot] nightly build green on main", 200],
];
// A sender rule's two types: the key it writes, its word, its icon and its line in the editor.
const SENDER_TYPES = [
  ["prefix", "Starts with", "text-cursor", "Text at the start, with {name} where the sender's name is."],
  ["pattern", "Pattern", "regex", "A regular expression with a group named sender."],
];
// Sender rule templates: each fills a new rule, with Use, under the rules while no rule has
// its type and text (senderTemplatesLeft). by is the rule's type, the key its text is under.
// Name and a colon asks for a hyphen in the name, so "Note:", "TODO:" and a web address
// stay the person's own; any lowercase hyphenated word before a colon counts, so "follow-up:"
// or "re-run:" at the start shows as from that word, as its line in the box says, while
// "Follow-up:" with a capital stays the person's own.
const SENDER_EXAMPLES = {
  brackets: { by: "prefix", line: "[build-bot] at the start of a prompt", rule: { name: "Name in brackets", prefix: "[{name}] ", example: "[build-bot] nightly build green on main" } },
  from: { by: "prefix", line: "From build-bot: at the start of a prompt", rule: { name: "From line", prefix: "From {name}: ", example: "From build-bot: tag the release notes draft" } },
  colon: { by: "pattern", line: "seat-one: or any hyphenated word, so follow-up: too.", rule: { name: "Name and a colon", pattern: "^(?<sender>[a-z][a-z0-9]*-[a-z0-9-]*[a-z0-9]): ", example: "seat-one: 3 changes open, 1 waiting on review" } },
};
// The templates no sender rule in the file has, as [key, template] in the shipped order. A
// template is in use when a rule (on or off, working or not) has its type and its text, with
// spaces at the end of both left out; the name is not compared. A rule's type is the one the
// editor opens it with (openRule).
function senderTemplatesLeft(list) {
  const has = new Set((list ?? []).map((r) => {
    const by = r.pattern && !r.prefix ? "pattern" : "prefix";
    return `${by}\u0000${(r[by] ?? "").trimEnd()}`;
  }));
  return Object.entries(SENDER_EXAMPLES).filter(([, x]) => !has.has(`${x.by}\u0000${x.rule[x.by].trimEnd()}`));
}
// A rule's example with the sender's name marked (as examplePieces draws a link), or null
// when the rule finds no sender in it. The rule reads it as core/turns.js ruleSender does:
// the first line from its first non-space, RULE_TEXT characters.
function senderPieces(rule, text) {
  let a = 0;
  while (a < text.length && a < RULE_TEXT && /\s/.test(text[a])) a++;
  let head = text.slice(a, a + RULE_TEXT);
  const nl = head.indexOf("\n");
  if (nl >= 0) head = head.slice(0, nl);
  rule.re.lastIndex = 0;
  const m = rule.re.exec(head);
  const raw = m?.groups?.sender;
  if (!m || !raw?.trim()) return null;
  const at = a + m.index + m[0].indexOf(raw);
  return [{ t: text.slice(0, at) }, { t: raw, url: true }, { t: text.slice(at + raw.length) }].filter((p) => p.t);
}
// Whether an example runs past what a sender rule reads.
const pastRuleText = (text) => { const t = text.trimStart(); return t.length > RULE_TEXT || t.slice(0, RULE_TEXT).includes("\n"); };
// How long typing may stop before a rule's fault is shown (chat-look round 10).
const REASON_PAUSE = 1500;
// Why a change to the link or sender rules was not written, on the card's File line.
const RULES_NOT_JSON = "settings.json is not valid JSON, so the rule change was not saved. Fix the file first.";
const rulesNotList = (key) => `"${key}" in settings.json is not a list, so the rule change was not saved. Fix the file first.`;
// The fieldFocused value of a rule editor field, before its key: "rule-pattern" on Link
// rules, "rule-sender-pattern" on Sender rules (Esc in either closes the rule).
const fieldTag = (kind) => (kind === "senders" ? "rule-sender-" : "rule-");
const RULES_MOVED = "The rules in settings.json changed while this change was saved, so it was not saved. The list shows the file now.";
// The edge on the bubble of a message a sender rule matched (the designer's option 2, which
// the owner chose on 18 Nov): "dashed", a 1 px dashed line (bubbleEdge). "none" leaves the
// words "matched by rule" and the tag icon to mark it alone (option 1).
const RULE_EDGE = "dashed";
const REGEX_REFERENCE = "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions/Cheatsheet";
// The flash on a turn a jump lands on: accent at this strength, shown FLASH.AFTER ms after the
// jump (once its scroll is done) and faded out over FADE ms.
const FLASH = { ALPHA: 0.14, AFTER: 140, FADE: 1200 };
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
// The line of links under a coloured bubble (issue 116): its gap, line height and the width of
// a character of its 12 px text, for the estimate the probe then measures.
const YOU_LINK_GAP = 4;
const YOU_LINK_LINE = 18;
const DRAG_SLOP = 4; // design px a press may move and still be a click, not a text selection
// A press on a closed turn selects it at once and opens it this long after the release,
// unless a second press comes first: the first press of a double press (to select a word in
// the reply) must not open the turn, which would redraw the reply under the pointer as other
// views and send the second press to whatever text took its place (issue 131). A press only
// reports its click count, not where its text lies, so the mod cannot tell a press on the
// reply's words from one beside them.
const OPEN_WAIT_MS = 300;
const FULL_REPLY_CHARS = 200000; // of an open reply; a note under it says what is left out
const VIEWER_PROMPT = 8000; // characters of the prompt in the image viewer's panel
const LONG_REPLY = 1600; // characters past which an open reply ends in a Collapse (Esc) row
// px above a paragraph drawn as its own list item, and above a heading, as inside one block
// (measured against the same text drawn whole: 748 px and 748 px).
const visitNote = (search) => (search ? "Pinned, not in this search" : "Pinned, hidden agent message");
// Nothing inside the list scrolls on its own (the owner's choice A and B, 16 Nov): Herdr
// passes a wheel event on to the list after an inner box uses it, and a mod cannot stop that
// inside a list row. Code and a tool's output wrap; a code block shows CODE_LINES rows and a
// tool's output OUT.SHOW, then Show all, its own list item, opens the rest in place. An
// output longer than the panel holds (OUT.MAX lines) opens in a viewer outside the list.
const CODE_LINES = 12;
const CALL_LINE = 16; // a call's command, 12 px mono, one wrapped line
const CALL_LINES = 6; // a call's command wraps to at most this many lines
const SHOW_ALL_H = 26; // the Show all row under a code block or a tool's output
const LINE = 18; // one line of 13 px text in a box of that height (rows, code)
// gpui's default line height is about 1.618 times the text size: 21 px for 13 px TextView
// and plain text (the owner's screenshot measures 21.1). Estimates of such text use it.
const TV_LINE = 21;
// A code block's line: its 12 px editor at gpui's default of about 1.618 em is 19.4 px, so
// 20 px leaves a code block's last line whole. The block's box sets this line height for
// the editor to inherit; an editor that keeps its own shorter line leaves a few px of the
// box's own background below the code, never a cut line (R3-2).
const CODE_LINE = 20;
// The Updating line under a done turn while a background task has woken the agent.
const WAKE_H = 24;
const NOTE_LINE = 20; // the working card's 12 px note, set explicitly (about 1.618 em)
// Open-card parts whose text gpui wraps: drawn once more in a hidden probe, measured, and
// then given that height (measured()).
const PROBED = new Set(["you", "rhead", "md", "itext", "lhead", "latest", "noreply", "cmd"]);
const MD_CHAR = 6.1; // estimated width of a character of 13 px reply prose (scaled by charW())
// Where hlBlock cuts a line into words: after white space or a HYPHEN_BREAK.
const WORD_END = new RegExp(`(?<=[\\s${HYPHEN_BREAK}])`);
const YOU_CHAR = 6.2; // the same for the prompt, a little wider: the YOU block clips
const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "nu", "pwsh", "login", "tcsh", "ksh"]);
const CARD = new Set(["head", "imgs", "you", "ustrip", "rhead", "itext", "grp", "call", "cout", "wspin", "noreply", "md", "codehead", "code", "fold", "lhead", "latest", "copy", "seltext", "resume"]);
const PREVIEW_CHARS = 1200; // of a prompt or reply, enough for any row's line limit
// The line limit of a collapsed row's prompt and reply when long messages are not shortened
// (truncate off, the default): no message reaches it, so nothing is cut.
const NO_CUT = 100000;
// Round 6: messages and replies in the system face while Herdr's interface font is its own
// Geist, on macOS, where gpui names that face SYSTEM_FACE; reply prose at READ_INK strength
// (opacity on its block, which TextView follows: 238 to 208 on graphite, tested on the rig).
const SYSTEM_FACE = ".SystemUIFont";
const READ_INK = 0.86;
const LATEST_LINES = 6;
// The most of a LATEST UPDATE drawn as Markdown, and the height of the note under it that
// says how much more there is.
const LATEST_MD = 12000;
const LATEST_NOTE = 20;

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
      ?? Object.entries(shared(PIN_MAP_KEY) ?? {}).find(([, v]) => v.pane === pane.pane)?.[0]
      ?? Object.entries(shared(TRAJ_MAP_KEY) ?? {}).find(([, v]) => v.pane === pane.pane)?.[0];
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
// open one instead of splitting again, and a pane knows its own id. The Pinned and the
// Trajectory panes are kept in their own maps (PIN_MAP_KEY, TRAJ_MAP_KEY).
// extra: the rest of the entry, as the pane itself gives it ({ dock: "bottom" } for a bottom
// Trajectory, {} for any other; trajBottomId). With none (the Chat settling its split) an
// entry that already names this pane keeps the rest, so a dock the pane wrote first stands.
function remember(terminal, pane, key = MAP_KEY, extra = null) {
  const map = { ...(shared(key) ?? {}) };
  for (const [k, v] of Object.entries(map)) if (!panes().some((p) => p.pane === v.pane)) delete map[k];
  map[terminal] = extra ? { pane, ...extra } : map[terminal]?.pane === pane ? map[terminal] : { pane };
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
    const r = await exec("sh", [SCRIPT("core/opencode.sh"), ...args]).catch(() => null);
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
  if (h === "opencode") return [SCRIPT("core/opencode.sh"), "read", dbOfFile(file), idOfFile(file), String(offset), String(chunk)];
  if (h === "codex" || h === "pi" || h === "cursor" || h === "antigravity") return [SCRIPT("core/extract.sh"), file, String(offset), String(chunk), h];
  return [SCRIPT("core/extract.sh"), file, String(offset), String(chunk)];
}

// ---- the panel --------------------------------------------------------------------------

export default class Threads extends View {
  init(_p, cx) {
    const p = props() ?? _p ?? {};
    // A copy opened as the full-window image gallery (openGallery): it draws only that.
    if (p.gallery) { this.initGallery(p, cx); return; }
    // A copy opened as the output viewer (openOutput): it draws only that.
    if (p.output) { this.initOutput(p, cx); return; }
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
    // props().view "trajectory": this pane is the Trajectory pane that y split off the Chat. It
    // shows the ledger (ledger.js) only, with its own list, and selects the turn the Chat
    // selects (syncSel). traj: the Trajectory shown in the Chat's own pane instead (y in a
    // pane too narrow to split), until y, Esc or its Chat button.
    this.trajPane = p?.view === "trajectory";
    this.traj = this.trajPane;
    // Its dock (TRD-24): props().dock "bottom", a pane along the bottom of the tab, under the
    // Chat's row; else "right", beside the Chat in its row. Nothing opens a bottom pane yet.
    this.trajDock = this.trajPane && p?.dock === "bottom" ? "bottom" : "right";
    // settings.json "trajectory" (settings.js parseTrajectory): read and checked only, for now.
    this.trajPrefs = { dock: "right", height: null };
    // The selected ledger row (a heading's key is its turn's; sel stays the turn that owns the
    // row), the filter buttons, and the detail: null until the person shows or hides it, so it
    // starts by the layout (closed under the ledger, open at its right from 900 px).
    this.tsel = null;
    this.tfilter = { ...ALL_ROWS };
    this.tdetail = null;
    // syncSel: this copy's own id in shared("threads.turnSel"), and whether this Chat's
    // Trajectory pane is open (the 1 s timer and openTraj set it).
    this.selId = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
    this.trajOpen = false;
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
    // A running turn's subagent groups are open until the person opens or closes one
    // (groupTouched); then their choice stays, as with the work line.
    this.groupTouched = new Set();
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
    cardKeys.ask(cx, "init");
    this.scroll = VirtualListScrollHandle.new();
    this.tscroll = VirtualListScrollHandle.new();
    // The settings card's scroll positions, one per page, which the arrows, j, k, Page Up,
    // Page Down, Space, Home and End move (cardScroll). Herdr 0.1.15 and newer; before that
    // the card scrolls with the wheel or trackpad only, and those keys do nothing on it.
    const scrollHandle = () => gpuiBase.ScrollHandle?.new?.() ?? null;
    this.cardScrolls = { main: scrollHandle(), links: scrollHandle(), senders: scrollHandle() };
    if (!this.cardScrolls.main || !this.cardScrolls.links || !this.cardScrolls.senders) this.cardScrolls = null;
    // The card's scrollbar is drawn all the time, so a card taller than its room shows there is
    // more below before anything scrolls. That needs Herdr's Scrollbar and its mode; without
    // them the scroll area's own bar shows while it scrolls.
    this.cardBar = Boolean(gpuiBase.Scrollbar?.vertical) && "mode" in div();
    this.input = InputState.new({ placeholder: "Filter turns, or #12 to jump" });
    this.input.on("change", (_e, cx) => { if (!this.searchSetting) this.readerMoved(); this.setQuery(this.input.value(), cx); cx.notify(); });
    this.quoteInput = InputState.new({ placeholder: "", value: "q" });
    this.quoteInput.on("change", (_e, cx) => { this.quoteTyped(cx); cx.notify(); });
    this.quoteInput.on("focus", (_e, cx) => { this.fieldFocused = "quote"; cx.notify(); });
    this.quoteInput.on("blur", (_e, cx) => { if (this.fieldFocused === "quote") this.fieldFocused = null; cx.notify(); });
    // The rule editor's fields: the Link rules page's, and the Sender rules page's.
    const ruleInputs = (fields, kind) => {
      const out = {};
      for (const [k, , hint] of fields) {
        const tag = `${fieldTag(kind)}${k}`;
        const inp = InputState.new({ placeholder: hint, value: "" });
        inp.on("change", (_e, cx) => { this.ruleTyped(k, cx, kind); cx.notify(); });
        inp.on("focus", (_e, cx) => { this.fieldFocused = tag; this.ruleFieldTook(tag); cx.notify(); });
        inp.on("blur", (_e, cx) => { if (this.fieldFocused === tag) this.fieldFocused = null; this.ruleShow(k); cx.notify(); });
        inp.on("submit", (_e, cx) => { this.keepRule(cx); cx.notify(); });
        out[k] = inp;
      }
      return out;
    };
    this.ruleInputs = ruleInputs(RULE_FIELDS, "links");
    this.senderInputs = ruleInputs(SENDER_FIELDS, "senders");
    this.prefs = { ...DEFAULTS }; // settings.json, read below and watched
    this.prefsRaw = null; // the file's text as last read or written (null: no file)
    this.prefsError = null;
    this.settingsOpen = false;
    // The settings card's page ("main", "links" or "senders") and its rows' height as last drawn
    // ({ key, h }). Not saved. Each opening counts (cardOpens), so its scroll area is a new
    // one and it opens at the top.
    this.cardOpens = 0;
    this.setPage = "main";
    this.cardBody = null;
    // The card's quote key field: what was typed (null: nothing since it opened), and which
    // field has the keyboard ("quote" or null), so its letters are not the panel's keys.
    this.quoteDraft = null;
    this.fieldFocused = null;
    this.quoteFileNote = null;
    // The card's keys (issue 104): the control with the ring (its id, null: none), the order
    // it was last drawn in, and the order as the card draws it, [{ id, press, field }].
    this.cardRing = null;
    this.ringIds = [];
    this.cardStops = [];
    this.linkList = [];
    this.senderList = [];
    // The Link rules and Sender rules pages: the rule open in the editor (null: none), the
    // rule just deleted (for Undo), each with the kind of rule ("links" or "senders"), and
    // each kind's list just written (until the file shows it).
    this.ruleEdit = null;
    this.ruleUndo = null;
    this.rulesPending = { links: null, senders: null };
    this.lastFocus = null;
    this.quoteKey = "q"; // settings.json quoteKey
    this.build = undefined; // a stand-in for build.js in tests; undefined reads build.js (built)
    this.links = []; // compiled link rules (settings.js parseLinks)
    this.linksVer = 0;
    this.senders = []; // compiled sender rules (settings.js parseSenders)
    this.sendersVer = 0;
    this.prefsNotes = []; // notes on quoteKey, link rules and sender rules
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
    // The opening (openGate): its state while the pane's first session is read and its last
    // screenful measured, and the session list a list was last shown for.
    this.opening = null;
    this.shownList = null;
    this.bornAt = Date.now();
    // A turn or reply came in: "pending" until the next draw of the list says whether the end
    // is on screen (then false) or not (then true, the latest button's dot).
    this.unseen = false;
    this.keysOpen = false; // the ? sheet
    // i: the Turn card over the bottom of the pane, with the selected turn's numbers. It
    // follows the selection while open. Not saved.
    this.detailsOpen = false;
    // The closed pin whose row the pointer is on, by its key (pinHover), so the pane, not
    // gpui's hover style, decides which unpin button is drawn (pinButtons, unpinButton).
    this.hoverPin = null;
    // The last press-down on a row's unpin button: its pin's key and whether the button was
    // drawn in the frame the press landed on ({ key, drawn }), which its click goes by.
    this.unpinDown = null;
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
      // A render Herdr stopped left renderOpen set (no timer runs during a render), and
      // Herdr asks for no render after it: ask for one. This timer was set up here, outside
      // any render, since a timer asked for inside a stopped render may never run.
      if (this.renderOpen && now() - (this.renderAt ?? 0) >= CUT_WATCH_MS && now() - (this.cutPokeAt ?? 0) >= CUT_WATCH_MS) {
        this.cutPokeAt = now();
        cx.notify();
      }
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
      // The other pane selected a turn (syncSel): show it.
      if (this.selMoved) { this.selMoved = false; cx.notify(); }
      // Past midnight, Today becomes Yesterday in the day bands and the Pinned view's headers.
      const today = dayKey(Date.now());
      if (this.today !== today) { const was = this.today; this.today = today; if (was) cx.notify(); }
      if (this.debug) this.report();
    });
  }

  // props().debug (tests only): what the pane shows, as data, in shared("threads.debug")
  // under its terminal (the Pinned pane under "<terminal>:pinned", so it never replaces the
  // Chat's entry), so a check can read it with no screenshot.
  report() {
    const s = this.current();
    if (s?.loaded && !this.renders) this.measure(); // render() measures when it draws
    // The Trajectory draws no Chat rows, so its report builds none (they cost a draw's time
    // in a long session); its part is traj.
    const rows = !this.traj && (this.res.kind === "found" || s) ? this.rows() : [];
    const snap = {
      pins: { list: this.pinnedAll().map((p) => ({ n: p.turn?.n ?? null, stored: p.pin.n, state: p.state, anchor: p.pin.anchor ?? null, text: p.pin.text })), top: this.topKey, view: this.view, pinnedPane: this.pinnedPane, rootH: Math.round(this.rootH), listH: Math.round(this.listH), visit: this.pinVisit, error: this.pinsError, undo: this.pinUndo.length },
      renders: this.renders ?? 0, me: this.myPane ?? null, props: Object.keys(props() ?? {}),
      traj: this.trajReport(),
      // Each fall back to px of the row with the Trajectory open (rowFell), and its reason.
      rowFalls: { n: this.rowFallN ?? 0, last: this.rowFalls ?? [] },
      landed: this.landed ? { key: this.landed.key, j: this.landed.j, y: this.landed.y, lift: this.landed.lift ?? 0 } : null,
      outline: this.outlined(), outlineBack: this.outlineBack ? { sel: this.outlineBack.sel ?? null, top: this.outlineBack.top ?? null } : null,
      header: this.headerText(), state: this.agentStateNow()?.word ?? null, unseen: this.unseen, bottomShown: this.bottomShown, pill: this.pillShown(), follow: Boolean(this.follow), range: this.lastRange ?? null, keysOpen: this.keysOpen,
      res: { kind: this.res.kind, guess: Boolean(this.res.guess), ended: this.res.ended ?? null, endedAt: this.res.endedAt ?? null, choices: this.res.choices?.length ?? 0, pendingId: this.res.pendingId ?? null, via: this.res.via ?? null },
      banners: this.bannerTitles(),
      tried: (this.res.tried ?? []).map((x) => `${x.ok ? "ok" : "no"} ${x.what}: ${x.detail}`),
      sessions: this.sessions.map((x) => ({ id: x.id.slice(-4), turns: x.turns.length, loaded: Boolean(x.loaded), clearAt: x.clearAt, error: x.error ?? null, skipped: x.skipped ?? null })),
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
      headerButtons: this.headerButtons().map((b) => `${b[0]}${b[6] ? `[${b[6]}]` : ""}${b[5] != null ? `(${b[5]})` : ""}${b[4] ? ":on" : ""}${b[7] ? ":dot" : ""}${b[8] ? ":off" : ""}|${b[2]}`),
      headerLayout: this.headerLayout(), badgeTip: this.badgeTip(),
      settings: this.prefs, trajPrefs: this.trajPrefs, settingsError: this.prefsError, settingsOpen: this.settingsOpen, settingsCard: this.settingsOpen ? { page: this.setPage, body: this.cardBody, ring: this.cardRing, keys: cardKeys.answer, ...this.cardView() } : null, settingsFile: this.prefsRaw,
      settingsPath: tilde(this.prefsPath()), settingsPoll: Boolean(this.prefsPoll),
      footer: this.footerHints().map(([k, l]) => `${k} ${l}`),
      statusLine: this.statusShown() ? this.statusGroupsShown().map((g) => g.text) : null,
      keyboard: this.keyboardAt(), lastFocus: this.lastFocus, lastBarHit: this.lastBarHit ?? null, barGeom: this.barGeom(),
      toast: this.toast?.text ?? null,
      railJumpAt: this.railJumpAt ?? null, railShown: this.railShown(), listH: this.listH, railCard: (() => { const k = this.railHover && this.railShown() ? this.railTicks().ticks.find((x) => x.key === this.railHover) : null; return k ? this.railCard(k) : null; })(),
      contrast: this.contrastList(),
      // Each theme's selected-turn fill and text-selection colour, for the highlight check.
      textSel: this.textSel ?? null, press: { moved: Math.round(this.pressMoved ?? 0), count: this.pressCount ?? 1 },
      selColors: themes().map((x) => ({ name: x.name, light: x.light, background: x.colors?.background, selected: x.colors?.selected, selection: x.colors?.selection })),
      // Round 2: the quote key, the last quote press (never its text), the link rules and
      // the repo they use.
      quoteKey: this.quoteKey, settingsNotes: this.prefsNotes, lastQuote: this.lastQuote,
      editorFocused: Boolean(this.editorFocused), panelFocused: this.panelFocused(), focusEvents: this.focusEvents ?? null,
      links: { count: this.linkCount ?? 0, valid: this.links.length, ver: this.linksVer, rules: this.links.map((r) => `${r.n} ${r.name}${r.repo ? " {repo}" : ""}`) },
      senders: { count: this.senderCount ?? 0, valid: this.senders.length, ver: this.sendersVer, rules: this.senders.map((r) => `${r.n} ${r.label}`) },
      repo: { repo: this.remote.repo, why: this.remote.why },
      settingsLine: this.settingsLine(),
      command: this.lastCommand ?? null,
      // perl was not found, so a character across a 4 KB piece of a line can show as U+FFFD.
      noPerl: Boolean(this.noPerl),
    };
    const text = JSON.stringify(snap);
    if (text === this.lastReport) return;
    this.lastReport = text;
    // Side panes read the same terminal as their Chat: each reports under its own key
    // ("<terminal>:pinned", "<terminal>:trajectory"), so the Chat's entry is never overwritten.
    const key = this.pinnedPane ? `${this.terminal}:pinned` : this.trajPane ? `${this.terminal}:trajectory` : this.terminal;
    setShared("threads.debug", { ...(shared("threads.debug") ?? {}), [key]: snap });
  }

  // One row or card part as text for the debug report: "turn#3 p2/r3 h89 cmd:/review-pr",
  // "turn#5 agent:hc:t7 review", "you#3 USER · COMMAND", "stats#3 … | cache read …".
  rowDetail(r) {
    const n = r.turn ? `#${r.turn.n}` : "";
    const who = r.turn?.agent ? ` agent:${r.turn.sender.kind}:${r.turn.sender.name ?? ""} lw${this.labelRoom(r.turn, rowTextWidth(this.width, true, this.prefs.textSize, this.chars()))} from:${senderOrigin(r.turn.sender)}` : "";
    switch (r.kind) {
      case "turn": case "wrow": {
        const sh = r.shape;
        if (r.compact) return `pin${n} ${r.pinNo} p${sh.p} h${sh.height}${r.fresh ? " new" : ""}${r.running ? " live" : ""} | ${sh.prompt.join(" ⏎ ")} | ${sh.reply}`;
        const pl = sh.kinds ? sh.prompt.map((l, i) => (sh.kinds[i] === "q" || sh.kinds[i] === "qonly" ? `▎${l}` : l)) : sh.prompt;
        return `${r.kind}${n} p${sh.p}/r${sh.r}${sh.q ? ` q${sh.q}` : ""}${sh.kinds?.[0] === "qonly" ? " qonly" : ""} h${sh.height}${sh.cmd ? ` cmd:${sh.cmd.name}` : ""}${who} | ${this.metaText(r.turn, r.kind === "wrow")} | ${sh.chip ? `[${sh.chip.label}] ` : ""}${pl.join(" ⏎ ")} | ${sh.reply.join(" ⏎ ")}`;
      }
      case "wtop": return `wtop${n} tiles ${r.turn.images.length} h${this.height(r)}`;
      case "afold": return `afold${n} ${r.fold}${r.open ? " open" : ""} ${senderLabel(r.turn.sender, this.width)}${r.turn.sender.rule != null ? ` rule${r.turn.sender.rule}` : ""} h${this.height(r)}`;
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
      case "itext": return `itext${n} h${this.height(r)} | ${r.src.replace(/\n/g, " ⏎ ").slice(0, 120)}`;
      case "grp": {
        const g = this.groupInfo(r);
        const ag = this.agentCounts(r);
        const going = r.now || ag.working > 0;
        const failed = Math.max(g.failed, ag.failed);
        const back = ag.known > 0 && ag.known === r.step.count && !ag.working && !ag.stopped;
        return `grp${n} ${groupText(r.step.calls, r.step.count, going)}${ag.working ? ` · ${ag.working} working` : ""}${g.current ? ` · ${g.current}` : ""}${failed ? ` · ${failed} failed [failed]` : g.known || back ? " [ok]" : ""}${r.open ? " [open]" : ""}`;
      }
      case "call": {
        if (r.more) return `call${n} +${r.more}`;
        const c = this.callEntry(r.si, r.id);
        const a = this.agentOf(r.si, r.id, r.name);
        const time = this.callTook(r.name, c, a);
        const mark = a ? ` [${this.agentWorks(r.si, a) ? "working" : a.st === "running" ? "no result" : a.st}]` : "";
        const pill = a?.m && shortModel(a.m) !== shortModel(r.turn.model) ? ` (${shortModel(a.m)})` : "";
        return `call${n}${r.one ? " one" : ""} ${c?.input != null ? callText(r.name, c.input) : r.name}${pill}${time ? ` · ${time}` : ""}${c?.err ? " [failed]" : ""}${mark}${r.id ? (this.callOpen.has(`${r.si}:${r.turn.n}:${r.gi}:${r.ci}`) ? " [open]" : " [closed]") : ""}`;
      }
      case "cout": return `cout${n} ${r.st}${r.going ? " running" : ""} lines ${r.box.lines.length}/${r.box.total}${r.box.cut ? " +first" : ""} ${this.outEditorFor(r) ? `editor ${this.outLangOf(r)}` : "plain"} h${this.height(r)}${r.box.lines.length ? ` | ${r.box.lines.slice(0, 3).join(" ⏎ ").slice(0, 160)}` : ""}`;
      case "wspin": return `wspin${n} Working…`;
      case "seltext": return `seltext${n} lines ${r.lines} h${this.height(r)} editor:${this.selEditor?.st ? "yes" : "no"} border:${this.selecting ? "accent" : "border"} | ${this.selectHint()}`;
      case "copy": {
        const L = this.acts(r.turn);
        const on = this.sel === `${r.si}:${r.turn.n}`;
        const selOn = this.selecting === `${r.si}:${r.turn.n}`;
        const icons = ["copy", "quote", "select"].filter((k) => L[k]).map((k) => (k === "select" && selOn ? "select(on)" : k)).join(" ");
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
    // The launcher, the gallery and the output viewer (overlays) return from init() before any
    // of this exists.
    if (this.outv?.st) this.outv.st.release();
    if (this.launcher || this.gal || this.outv) return;
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
      this.applyPrefs(text, cx);
      // A file from an earlier build: written once with the current mark (settings.js LOOK),
      // so what it reads as now (agent messages off the rail) is what it holds. Once per
      // text: a write that does not land is not tried again on the same text.
      if (behindLook(text) && this.lookTried !== text) { this.lookTried = text; this.changePrefs({}, cx); }
      cx.notify();
    });
  }

  applyPrefs(text, cx = null) {
    const { values, error } = parseSettings(text);
    this.prefsRaw = text;
    this.prefsError = error;
    this.setPrefs(values);
    this.applyExtras(text, cx);
  }

  // quoteKey, the link rules and the sender rules, compiled once here (never while drawing).
  // A file that does not parse keeps the ones last read.
  applyExtras(text, cx = null) {
    if (text != null && String(text).trim() !== "" && parseSettings(text).error) return;
    const x = parseExtras(text);
    const quoteWas = this.quoteKey;
    this.quoteKey = x.quoteKey;
    this.quoteFileNote = x.quoteNote;
    // The card's field shows the key the file now holds, unless it is being typed in.
    if (this.quoteKey !== quoteWas && this.fieldFocused !== "quote") { this.quoteDraft = null; this.setQuoteField(this.quoteKey); }
    this.prefsNotes = x.notes;
    this.trajPrefs = x.trajectory;
    this.trajNotes = x.trajNotes;
    this.linkNotes = x.linkNotes;
    this.senderNotes = x.senderNotes;
    this.setLinks(x.links, x.linkList, x.linkCount);
    this.setSenders(x.senders, x.senderList, x.senderCount, cx);
    const kind = this.ruleEdit?.kind ?? this.ruleUndo?.kind;
    if (kind) this.followRules(this.fileRules(kind));
  }

  // New sender rules: the turns are marked again when the rules that run changed.
  setSenders(rules, list, count, cx = null) {
    this.senderCount = count;
    this.senderList = list;
    this.senderListVer = (this.senderListVer ?? 0) + 1;
    const ssig = JSON.stringify(rules.map((r) => [r.n, r.re.source, r.label]));
    if (ssig !== (this.sendersSig ?? "[]")) { this.sendersSig = ssig; this.senders = rules; this.sendersVer++; this.remark(cx); }
  }

  // New sender rules: every session read so far is marked again (turns.js remarkSenders),
  // in slices of SLICE_MS with cx (a settings change), all at once without it (tests). A
  // newer change stops an older pass. Turns read later are marked as they are read.
  remark(cx) {
    const gen = (this.remarkGen = (this.remarkGen ?? 0) + 1);
    const rules = this.senders;
    const pass = async (cx) => {
      for (const s of this.sessions.slice()) {
        let i = 0;
        do {
          i = remarkSenders(s, rules, i, cx ? now() + SLICE_MS : Infinity);
          // Each slice can change any turn's sender: the search's matches are found again (hits).
          this.remarkVer = (this.remarkVer ?? 0) + 1;
          if (i >= s.turns.length) break;
          await cx.sleep(0);
          if (this.remarkGen !== gen) return;
        } while (i < s.turns.length);
      }
      cx?.notify();
    };
    if (cx) cx.spawn(pass);
    else pass(null);
  }

  setLinks(rules, list, count) {
    this.linkCount = count;
    this.linkList = list;
    this.linkListVer = (this.linkListVer ?? 0) + 1;
    const sig = JSON.stringify(rules.map((r) => [r.re.source, r.url]));
    if (sig !== this.linksSig) { this.linksSig = sig; this.links = rules; this.linksVer++; }
  }

  setPrefs(values) {
    const was = this.prefs;
    this.prefs = values;
    // Hiding agent turns: a hidden selected turn hands the selection to the turn before it.
    if (was.agentTurns && !values.agentTurns) this.reselect = true;
  }

  // Changes settings from the panel, keys or commands: applied now, then written. A save
  // that finds the file changed meanwhile reads it again and applies the change on top.
  // extra: keys written as they are (the card's quote key, the link rules). fits: given the
  // file's text, why extra may not be written over it, or null; asked before the save and
  // again on the text read after a stale one (writeRules). Returns the save.
  changePrefs(patch, cx, extra = null, fits = null) {
    // The current mark, so a slate chosen here is kept (settings.js LOOK).
    const next = parseSettings(JSON.stringify({ ...this.prefs, ...patch, look: LOOK })).values;
    this.setPrefs(next);
    this.prefsSaving = (this.prefsSaving ?? 0) + 1;
    // Not written: the pane shows the file as it is, and the card says why.
    const refuse = (text, why) => { this.rulesPending = { links: null, senders: null }; this.prefsMerged = false; this.applyPrefs(text); this.prefsError = why; };
    const chain = (this.prefsChain ?? Promise.resolve()).then(async () => {
      const why = writable(this.prefsRaw) ? fits?.(this.prefsRaw) : null;
      if (why) { refuse(this.prefsRaw, why); return; }
      try {
        await saveSettings(appHome(), next, this.prefsRaw, extra);
        this.prefsRaw = settingsText(next, this.prefsRaw, extra);
        this.prefsError = null;
      } catch {
        const text = await readTextFile(this.prefsPath()).catch(() => null);
        // The file holds a hand edit that does not parse: leave it, keep the change in the
        // pane only, and say so.
        if (!writable(text)) { this.prefsRaw = text; this.prefsError = NOT_SAVED; this.prefsMerged = false; return; }
        const late = fits?.(text);
        if (late) { refuse(text, late); return; }
        const merged = { ...parseSettings(text).values, ...patch };
        try {
          await saveSettings(appHome(), merged, text, extra);
          this.prefsRaw = settingsText(merged, text, extra);
          this.prefsError = null;
          // Applied when the queue is done (below): a save queued behind this one is live in
          // the pane already, and may write over this text before then.
          this.prefsMerged = true;
        } catch (e) {
          this.prefsRaw = text;
          this.prefsError = `Could not save settings.json: ${clean(String(e?.message ?? e))}`;
          this.prefsMerged = false;
        }
      }
    });
    this.prefsChain = chain;
    cx.spawn(async (cx) => {
      await chain;
      this.prefsSaving--;
      if (!this.prefsSaving) {
        // A save written on top of a changed file, with none after it failed or refused: the
        // pane takes what the file holds now, extras too.
        if (this.prefsMerged) { this.prefsMerged = false; this.applyPrefs(this.prefsRaw, cx); }
        // An edit made in an editor while the save ran.
        this.readPrefs(cx);
      }
      cx.notify();
    });
    return chain;
  }

  // Shows or hides agent turns, with a toast that says which; quiet from the settings card,
  // which shows the change itself.
  setAgents(on, cx, quiet = false) {
    if (Boolean(this.prefs.agentTurns) === on) return;
    this.changePrefs({ agentTurns: on }, cx);
    if (!quiet) this.say(on ? "Agent messages shown" : "Agent messages hidden", "bot", cx);
  }

  // ---- the settings card's state ----

  // Opens the card at the top of its one page and gives the pane the keyboard, so one Esc
  // closes it; or closes it.
  setSettings(open) {
    if (!open) { this.closeSettings(); return true; }
    this.settingsOpen = true;
    this.filtering = false;
    this.keysOpen = false;
    this.detailsOpen = false;
    this.quietRail();
    this.cardOpens++;
    this.cardPlaces = {};
    this.cardSizes = {};
    this.cardSlots = {};
    // A handle keeps its place from the last opening: its mark at 0 (child 1) takes the view
    // back to the top, the way a new opening starts.
    for (const h of Object.values(this.cardScrolls ?? {})) h.scroll_to_item(1);
    this.setPage = "main";
    this.leaveLinks();
    this.quoteDraft = null;
    this.setQuoteField(this.quoteKey);
    this.cardRing = null;
    this.h.focus();
    return true;
  }
  // Closes the card. A field in it that had the keyboard hands it back to the pane; else the
  // pane has it already, or another pane took it with the press that closed the card.
  closeSettings() {
    this.settingsOpen = false;
    this.cardRing = null;
    this.ringShow = null;
    this.leaveLinks();
    this.dropField();
  }

  // ---- the settings card's keys (issue 104) ----
  //
  // The pane keeps the keyboard while the card is open; only a text field on the card takes
  // it, while the ring is on that field. Tab and Shift-Tab move a ring through the card's
  // controls in the order they are drawn (cardStop), round the ends, and Enter and Space press
  // the control it is on, as a click does. So the panel's keys and one Esc work whatever the
  // ring is on, and nothing has to hand the keyboard back when the card closes or a control
  // goes. The ring shows only after Tab: a pointer press on the card takes it away, and a press
  // that moves it (ringMove) does nothing without one, so a click never shows a ring.

  // The ring one stop on (1) or back (-1), from the field with the keyboard if one has it (a
  // press in a field leaves the ring where it was, TRD-100), else from the ring. Onto a field,
  // the field takes the keyboard; off one, the pane takes it back.
  moveRing(step) {
    const stops = this.cardStops ?? [];
    const from = stops.find((s) => s.field && s.field.name === this.fieldFocused)?.id ?? this.cardRing ?? null;
    this.ringTo(nextStop(stops.map((s) => s.id), from, step));
    return true;
  }
  ringTo(id) {
    const field = (this.cardStops ?? []).find((s) => s.id === id)?.field ?? null;
    this.cardRing = id;
    this.askReveal();
    if (field) { this.fieldFocused = field.name; this.ruleFieldTook(field.name); field.input.focus(); }
    else if (this.fieldFocused) { this.fieldFocused = null; this.h.focus(); }
  }
  // Enter or Space: the control with the ring, pressed as a click presses it.
  pressRing(cx) {
    const s = (this.cardStops ?? []).find((x) => x.id === this.cardRing);
    if (!s) return false;
    if (s.field) { this.ringTo(s.id); return true; }
    s.press({}, cx);
    return true;
  }
  // Where the ring goes when a press takes its control away; nothing while it is not shown.
  ringMove(id) { if (this.cardRing && id) { this.cardRing = id; this.askReveal(); } }
  // A control the ring can reach, in the order drawn: what Enter and Space do (its click), and
  // for a text field its input and the name fieldFocused takes. The ring is 2 px of the accent,
  // 3 px outside the control and round its corners, over nothing, so the control does not move;
  // a field shows it has the keys with its own accent edge instead (and has them itself). The
  // control with the ring is the one a screen reader hears as focused, where Herdr has the
  // calls (0.1.15 and 0.1.16 do).
  cardStop(el, t, id, press, { radius = 6, label = null, role = "button", field = null } = {}) {
    this.cardStops.push({ id, press, field });
    if (this.cardRing !== id || field) return el;
    let out = el;
    if ("role" in out) out = out.role(role);
    if (label && "accessibility_label" in out) out = out.accessibility_label(label);
    if ("aria_active_descendant" in out) out = out.aria_active_descendant();
    return out.relative().child(div().absolute().top(-RING_OUT).left(-RING_OUT).right(-RING_OUT).bottom(-RING_OUT)
      .rounded(radius + RING_OUT).border_2().border_color(t.accent));
  }
  // A new rule's or an opened rule's first control: its first type, or Change. A sender rule
  // shows its two types while it is new, a link rule while its fields are untouched.
  editorFirst(e) {
    if (e.kind === "senders") return e.at == null || e.typeOpen ? `th-sender-type-${SENDER_TYPES[0][0]}` : "th-sender-type-change";
    return (e.at == null && !e.touched) || e.typeOpen ? `th-rule-type-${LINK_TYPES[0]}` : "th-rule-type-change";
  }
  // A rule's Edit button on its page's list (n counts from 1).
  editStop(kind, n) { return kind === "senders" ? `th-sender-edit-btn-${n}` : `th-rule-edit-btn-${n}`; }
  // Leaving the Link rules or Sender rules page: a rule open in the editor is dropped unkept,
  // and Undo goes.
  leaveLinks() {
    this.ruleEdit = null;
    this.senderHits = null;
    this.ruleUndo = null;
  }
  // While the settings card or the keys sheet is open, it and its clear layer are all that
  // react: nothing under them takes a hover, a press or the wheel (settings-spacing 7). The
  // kit has no call that keeps a hover from reaching what lies under a layer, so each part
  // under it asks: the rail, its ticks and their cards, the list's presses, pointer and
  // wheel, and the rows' hover fills, reveals and info cards.
  covered() { return Boolean(this.settingsOpen || this.keysOpen || this.openActive()); }
  // The opening is under way: the list is not shown, or is drawn hidden under the loading state.
  openActive() { return Boolean(this.opening && !this.opening.done); }
  // A card or sheet opening drops the rail's hover, so no tick card waits under it to come
  // back when it closes.
  quietRail() {
    this.railHover = null;
    this.railCardOn = false;
    this.railLeave = null;
    this.railQuiet = null;
  }
  // The pane's own value in the search field: its change event is not the reader's typing (the
  // Escape, button or key that set it counted already).
  setSearchField(v) {
    this.searchSetting = true;
    try { this.input.set_value(v); } finally { this.searchSetting = false; }
  }
  setQuoteField(v) {
    this.quoteSetting = true;
    try { this.quoteInput?.set_value(v); } finally { this.quoteSetting = false; }
  }
  // A letter typed in the quote key field: the field holds one letter (the newest typed), and
  // a free letter a to z becomes the quote key at once and is written to the file. Any other
  // leaves the key as it was, and the note under the field says why.
  quoteTyped(cx) {
    if (this.quoteSetting) return;
    let v = String(this.quoteInput.value() ?? "");
    if (v.length > 1) {
      const old = this.quoteDraft ?? this.quoteKey;
      const i = v.indexOf(old);
      v = (i >= 0 ? v.slice(0, i) + v.slice(i + old.length) : v).slice(-1);
      this.setQuoteField(v);
    }
    this.quoteDraft = v;
    if (v && v !== this.quoteKey && parseQuoteKey(v).note == null) {
      this.quoteKey = v;
      this.changePrefs({}, cx, { quoteKey: v });
    }
  }
  // A field in the card that leaves the screen (another page, the card closed)
  // hands the keyboard back to the pane, so the panel's keys work again.
  dropField() {
    if (this.fieldFocused) { this.fieldFocused = null; this.h.focus(); }
  }

  // ---- link rules and sender rules changed on the card (chat-look round 10) ----
  // One editor serves both pages. kind is the list a rule is in, "links" or "senders", and
  // the file's key that holds it; a rule's row, its editor and its Undo carry their kind.

  // The kind of rule the page shown holds: the Sender rules page's, else the Link rules page's.
  ruleKind() { return this.setPage === "senders" ? "senders" : "links"; }
  inputsOf(kind) { return kind === "senders" ? this.senderInputs : this.ruleInputs; }
  fieldsOf(kind) { return kind === "senders" ? SENDER_FIELDS : RULE_FIELDS; }
  listOf(kind) { return (kind === "senders" ? this.senderList : this.linkList) ?? []; }

  // Whether the card may change rules of a kind: not while the file holds text that is not
  // settings (a hand edit in progress) or that kind is not a list, which a write would replace.
  rulesEditable(kind = this.ruleKind()) {
    return writable(this.prefsRaw) && this.rulesIn(this.prefsRaw, kind) != null;
  }
  // A change to the rules (Delete, Undo, the switch, Keep rule, Move up) while the card may
  // not change them: refused, and the card's File line says why. Returns true when refused.
  rulesRefused(kind = this.ruleKind()) {
    if (this.rulesEditable(kind)) return false;
    this.prefsError = writable(this.prefsRaw) ? rulesNotList(kind) : RULES_NOT_JSON;
    return true;
  }
  // The rules of a kind a settings text holds, as copies to change: for links, the fresh
  // install's rule for no file or an empty one; none for a file without the key (or one that
  // does not parse); null when the key is not a list.
  rulesIn(text, kind) {
    if (text == null || String(text).trim() === "") return kind === "links" ? defaultLinks() : [];
    let raw = null;
    try { raw = JSON.parse(text); } catch { return []; }
    if (raw?.[kind] == null) return [];
    return Array.isArray(raw[kind]) ? raw[kind].map((r) => (r && typeof r === "object" && !Array.isArray(r) ? { ...r } : r)) : null;
  }
  // The rules as the file holds them, as copies to change: the list just written while its
  // save runs, or the fresh install's link rule while there is no file.
  fileRules(kind = this.ruleKind()) {
    const pending = this.rulesPending[kind];
    if (pending) return pending.map((r) => (r && typeof r === "object" ? { ...r } : r));
    return this.rulesIn(this.prefsRaw, kind) ?? [];
  }
  // A list of a kind as the pane's rules now, before the file holds it. The notes of the
  // other kind stay as they were.
  useRules(kind, raw, cx) {
    if (kind === "senders") {
      const p = parseSenders(raw);
      this.senderNotes = p.notes;
      this.setSenders(p.rules, p.list, raw.length, cx);
    } else {
      const l = parseLinks(raw);
      this.linkNotes = l.notes;
      this.setLinks(l.rules, l.list, raw.length);
    }
    // The file's other notes stand: the quote key's, and the Trajectory object's (TRD-24).
    this.prefsNotes = [...(this.quoteFileNote ? [this.quoteFileNote] : []), ...(this.linkNotes ?? []), ...(this.senderNotes ?? []), ...(this.trajNotes ?? [])];
  }
  // Applies a changed list at once, then writes it under its kind (settings.js keeps the
  // rest). The save writes it only over the list it was made from: when the file's list
  // changed meanwhile (a hand edit, another pane) or is no longer a list, nothing is written,
  // the pane shows the file again and the card says why. undo: the Undo line a Delete just
  // set, cleared when that Delete is not written, so Undo cannot add the rule a second time.
  // kept: the rule Keep rule just closed. When its save is refused it opens again where its
  // rule now is, with what was typed, and says why under its buttons (as draft PR 121 does
  // for link rules), while the card is still on its page and no other rule is open.
  writeRules(kind, raw, cx, undo = null, kept = null) {
    const from = JSON.stringify(this.fileRules(kind));
    this.rulesPending[kind] = raw;
    this.useRules(kind, raw, cx);
    this.followRules(raw);
    const fits = (text) => {
      const now = this.rulesIn(text, kind);
      const why = now == null ? rulesNotList(kind) : JSON.stringify(now) !== from ? RULES_MOVED : null;
      if (why && undo && this.ruleUndo === undo) this.ruleUndo = null;
      if (why && kept && !this.ruleEdit && this.settingsOpen && this.setPage === kind) {
        this.ruleEdit = kept;
        for (const [k] of this.fieldsOf(kind)) this.setRuleField(k, kept.draft[k], kind);
      }
      if (why && kept && this.ruleEdit === kept) kept.refused = why;
      return why;
    };
    const chain = this.changePrefs({}, cx, { [kind]: raw }, fits);
    chain.then(() => { if (this.rulesPending[kind] === raw) this.rulesPending[kind] = null; });
    return chain;
  }
  // The list changed, here or in the file: the open rule and the Undo line follow their
  // rules by what they hold, not by place (the nearest same rule, for twins). An open rule
  // that is gone from the list (changed in the file, or removed) becomes a new, unkept rule
  // where it was, with what was typed in it.
  followRules(raw) {
    const keys = raw.map((r) => JSON.stringify(r));
    const near = (key, at) => {
      let best = -1;
      keys.forEach((k, i) => { if (k === key && (best < 0 || Math.abs(i - at) < Math.abs(best - at))) best = i; });
      return best;
    };
    const e = this.ruleEdit;
    if (e && e.at != null) {
      const i = near(e.key, e.at);
      if (i >= 0) e.at = i;
      else Object.assign(e, { insertAt: Math.min(e.at, raw.length), at: null, key: null, lost: true, touched: true, typeOpen: false });
    }
    const u = this.ruleUndo;
    if (u) {
      const before = u.prev != null ? near(u.prev, u.at - 1) : -1;
      const after = u.next != null ? near(u.next, u.at) : -1;
      u.at = before >= 0 ? before + 1 : after >= 0 ? after : Math.min(u.at, raw.length);
    }
  }
  // A draft as the file's rule: the keys in a fixed order, the optional ones only when set,
  // and any key this version does not know kept from the rule it replaces. A sender rule
  // keeps the one of prefix and pattern that Matches by names.
  ruleObject(d, base, kind = "links") {
    const o = {};
    if (d.name.trim()) o.name = d.name.trim();
    let known;
    if (kind === "senders") {
      o[d.by] = d[d.by];
      known = ["name", "prefix", "pattern", "example", "on"];
    } else {
      if (d.type !== "custom") o.type = d.type;
      const desc = d.description.replace(/\s+/g, " ").trim();
      if (desc) o.description = desc;
      o.pattern = d.pattern;
      o.url = d.url.trim();
      known = ["name", "type", "description", "pattern", "url", "example", "on"];
    }
    if (d.example) o.example = d.example;
    if (!d.on) o.on = false;
    for (const [k, v] of Object.entries(base && typeof base === "object" ? base : {})) if (!known.includes(k)) o[k] = v;
    return o;
  }
  setRuleField(k, v, kind = this.ruleEdit?.kind ?? "links") {
    this.ruleSetting = true;
    try { this.inputsOf(kind)[k]?.set_value(v ?? ""); } finally { this.ruleSetting = false; }
  }
  // Opens rule `at` (its index in the file) in place, or a new rule (at null) placed at
  // insertAt, blank or filled from `from` (Duplicate). One rule is open at a time.
  openRule(at, from = null, insertAt = null, kind = this.ruleKind()) {
    if (!this.rulesEditable(kind)) return;
    const raw = this.fileRules(kind);
    const senders = kind === "senders";
    let d;
    let base = null;
    if (at != null) {
      const r = this.listOf(kind)[at];
      if (!r) return;
      base = raw[at];
      const name = typeof base?.name === "string" ? base.name : "";
      d = senders
        ? { name, by: r.pattern && !r.prefix ? "pattern" : "prefix", prefix: r.prefix, pattern: r.pattern, example: r.example, on: r.on }
        : { name, description: r.description, pattern: r.pattern, url: r.url, example: r.example, type: r.type, on: r.on };
    } else if (from) d = { ...from, name: from.name ? `${from.name} copy`.slice(0, 40) : "" };
    else if (senders) d = { name: "", by: "prefix", prefix: "", pattern: "", example: "", on: true };
    else d = { name: "", description: "", pattern: "", url: "", example: "", type: "custom", on: true };
    if (this.fieldFocused?.startsWith("rule-")) { this.fieldFocused = null; this.h.focus(); }
    const e = { kind, at, key: at != null ? JSON.stringify(base) : null, lost: false, insertAt: insertAt ?? raw.length, base, draft: d, touched: Boolean(from), typeOpen: false,
      shown: senders ? { prefix: null, pattern: null } : { pattern: null, url: null }, faults: null, result: null, lastGood: null, stale: false, gen: 0, refused: null,
      // The control the ring was on, which it goes back to when the rule closes unkept.
      from: this.cardRing };
    this.ruleEdit = e;
    this.ringMove(this.editorFirst(e));
    // A new rule (Add rule, or Use on a template) opens at the end of the list, which may be
    // out of view: the card scrolls to show as much of it as fits from its first line, ring
    // or no ring.
    if (at == null && !from) this.askReveal(this.editorFirst(e), true);
    for (const [k] of this.fieldsOf(kind)) this.setRuleField(k, d[k], kind);
    this.ruleCheck();
    // A kept rule that is not working says why at once.
    if (at != null) for (const f of Object.keys(e.shown)) e.shown[f] = e.faults[f];
  }
  closeRule() {
    const from = this.ruleEdit?.from;
    this.ruleEdit = null;
    this.senderHits = null;
    if (this.fieldFocused?.startsWith("rule-")) { this.fieldFocused = null; this.h.focus(); }
    this.ringMove(from);
  }
  // A type pressed: in a new rule whose Finds, Opens and Example are untouched it fills them
  // (and the name, unless one was typed); otherwise it is only the label.
  chooseType(k) {
    const e = this.ruleEdit;
    if (e?.kind !== "links" || !LINK_TYPES.includes(k)) return;
    e.draft.type = k;
    if (e.at == null && !e.touched) {
      const tpl = LINK_TEMPLATES[k].rule;
      const names = Object.values(LINK_TEMPLATES).map((x) => x.rule?.name).filter(Boolean);
      for (const f of ["pattern", "url", "example"]) e.draft[f] = tpl?.[f] ?? "";
      if (!e.draft.name || names.includes(e.draft.name)) e.draft.name = tpl?.name ?? "";
      for (const [f] of RULE_FIELDS) this.setRuleField(f, e.draft[f]);
      this.ruleCheck();
    } else e.typeOpen = false;
    this.ringMove(this.editorFirst(e) === "th-rule-type-change" ? "th-rule-type-change" : `th-rule-type-${k}`);
  }
  // A field of the open rule took the keyboard, by a press or by Tab (tag: its fieldFocused
  // name, on either page). The type rows Change opened fold back, as a key in Starts with or
  // Finds folds them, so the fields are where they were before Change; and a ring shown moves
  // onto the field, so Tab goes on from there. With no ring shown, none comes (TRD-100). A new
  // link rule's rows, shown while its fields are untouched, stay.
  ruleFieldTook(tag) {
    const e = this.ruleEdit;
    if (!e) return;
    const head = fieldTag(e.kind);
    const k = tag?.startsWith(head) ? tag.slice(head.length) : null;
    if (!this.fieldsOf(e.kind).some(([f]) => f === k)) return;
    e.typeOpen = false;
    if (this.cardRing) this.cardRing = `th-rule-f-${k}`;
  }
  // A sender rule's type pressed: its field shows, with the text it had, and on a kept rule
  // the two rows fold back to one line.
  chooseSenderType(by) {
    const e = this.ruleEdit;
    if (e?.kind !== "senders" || !SENDER_TYPES.some(([k]) => k === by)) return;
    e.typeOpen = false;
    this.ringMove(e.at == null ? `th-sender-type-${by}` : "th-sender-type-change");
    if (e.draft.by === by) return;
    if (this.fieldFocused?.startsWith("rule-")) { this.fieldFocused = null; this.h.focus(); }
    e.draft.by = by;
    e.shown = { prefix: null, pattern: null };
    this.ruleCheck();
  }
  // Use on a template: a new rule filled from it, its type pressed, not kept until Keep rule.
  // The open rule names the template it started from (ruleShell).
  useSenderExample(k) {
    const x = SENDER_EXAMPLES[k];
    if (!x) return;
    this.openRule(null, null, null, "senders");
    const e = this.ruleEdit;
    if (e?.kind !== "senders") return;
    Object.assign(e.draft, x.rule, { by: x.by });
    e.touched = true;
    e.template = x.rule.name;
    for (const [f] of SENDER_FIELDS) this.setRuleField(f, e.draft[f], "senders");
    this.ruleCheck();
  }
  // A key in one of the rule's fields. Good news at every key; a fault shows when typing
  // stops for REASON_PAUSE, when the field is left or on Keep rule, and once shown it follows
  // the field and goes the moment the rule runs.
  ruleTyped(k, cx, kind = "links") {
    if (this.ruleSetting) return;
    const e = this.ruleEdit;
    if (!e || e.kind !== kind) return;
    const inp = this.inputsOf(kind)[k];
    const max = this.fieldsOf(kind).find((f) => f[0] === k)?.[3] ?? 200;
    let v = String(inp.value() ?? "");
    if (v.length > max) { v = v.slice(0, max); this.setRuleField(k, v, kind); }
    e.draft[k] = v;
    if (k === "pattern" || k === "url" || k === "example" || k === "prefix") { e.touched = true; e.typeOpen = false; }
    this.ruleCheck();
    const gen = ++e.gen;
    cx.timer.after(REASON_PAUSE, (cx) => { if (this.ruleEdit === e && e.gen === gen) { this.ruleShow(k); cx.notify(); } });
  }
  // Shows the fault of a field that can have one (Finds and Opens, or Starts with and
  // Pattern), if it has one; an empty field waits for Keep rule.
  ruleShow(k) {
    const e = this.ruleEdit;
    if (!e || !(k in e.shown) || !e.draft[k]) return;
    e.shown[k] = e.faults[k];
  }
  // The open rule's faults, one per field, and what it does to its example. A pattern that
  // does not run keeps the last result that did, dimmed.
  ruleCheck() {
    const e = this.ruleEdit;
    if (e.kind === "senders") return this.senderCheck();
    const d = e.draft;
    const url = d.url.trim();
    const pf = d.pattern ? ruleFault({ pattern: d.pattern, url: "https://example.com/$1" }) : "no pattern";
    const uf = url ? ruleFault({ pattern: "x(\\d)", url }) : "no url";
    e.faults = { pattern: pf ?? (uf ? null : ruleFault({ pattern: d.pattern, url })), url: uf };
    for (const f of ["pattern", "url"]) if (e.shown[f] != null) e.shown[f] = e.faults[f];
    e.repo = this.repoSig();
    if (e.faults.pattern || e.faults.url) { e.stale = true; return; }
    e.result = this.ruleResult(e);
    e.lastGood = e.result;
    e.stale = false;
  }
  // A sender rule's fault, in parseSenders' words, is on the field its type names: the draft
  // alone, as the file would read it (settings.js checkSender).
  senderCheck() {
    const e = this.ruleEdit;
    const d = e.draft;
    const f = d.by;
    const { rule, why } = d[f] ? checkSender({ [f]: d[f] }) : { rule: null, why: `no ${f}` };
    e.faults = { prefix: null, pattern: null, [f]: why };
    for (const k of ["prefix", "pattern"]) if (e.shown[k] != null) e.shown[k] = e.faults[k];
    e.rule = why ? null : rule;
    if (why) { e.stale = true; return; }
    e.result = this.senderResult(e, rule);
    e.lastGood = e.result;
    e.stale = false;
  }
  // What a sender rule does to its example, as the reader would (core/turns.js ruleSender:
  // the first line, its first 100 characters): the example with the sender's name marked and
  // the label a match shows, or no match; a rule higher in the list that takes it first; and
  // whether the example runs past what a rule reads. null with no example.
  senderResult(e, rule) {
    const d = e.draft;
    if (!d.example) return null;
    const past = pastRuleText(d.example);
    const hit = ruleSender([rule], d.example);
    if (!hit) return { past };
    const pos = e.at ?? e.insertAt;
    const above = (this.senders ?? []).filter((r) => r.n - 1 < pos);
    const first = above.length ? ruleSender(above, d.example) : null;
    const beaten = first ? (this.senderList[first.rule - 1]?.name ?? "A rule above") : null;
    return { pieces: senderPieces(rule, d.example) ?? [{ t: d.example }], label: hit.name ? `${hit.name} · matched by rule` : "matched by rule", beaten, past };
  }
  // How many of the prompts typed in this pane's sessions a sender rule matches on its own
  // (a rule above it may take some first), as the reader marks them (turns.js typedTurn and
  // ruleSender): { hits, of }, or null with no rule or no typed prompt, and null while the
  // count is still going. A rule may take many steps on a prompt (settings.js senderCost), so
  // the count runs for COUNT_MS a draw at most and goes on in the next (senderHitsLeft).
  // A turn's prompt never changes and a typed turn stays typed, and turns are only added or
  // cut back to where the session settled (turns.js rewindTail). So for the rule's text each
  // session keeps how far its turns were read and the last turn read: a draw reads only the
  // turns added since, and a session is read again from its start only when its turns were
  // cut back or it is another session. That progress holds the sessions it read, so it goes
  // when the rule closes, the page is left, the pane follows another transcript (pick), or a
  // draw draws no count (render, senderHitsDrawn).
  senderMatches(rule) {
    if (!rule) return null;
    this.senderHitsDrawn = true;
    const rk = `${rule.re.source}/${rule.re.flags}|${rule.named ? 1 : 0}`;
    let c = this.senderHits;
    if (c?.rk !== rk) c = this.senderHits = { rk, per: [], shown: null };
    const fresh = (s) => ({ s, id: s.id, n: 0, last: null, hits: 0, of: 0 });
    c.per = this.sessions.map((s) => c.per.find((p) => p.s === s && p.id === s.id) ?? fresh(s));
    const until = now() + COUNT_MS;
    let hits = 0;
    let of = 0;
    let left = false;
    for (let i = 0; i < c.per.length; i++) {
      let p = c.per[i];
      const turns = p.s.turns;
      if (p.n > turns.length || (p.n && turns[p.n - 1] !== p.last)) p = c.per[i] = fresh(p.s);
      while (!left && p.n < turns.length) {
        const t = (p.last = turns[p.n++]);
        if (!typedTurn(t)) continue;
        p.of++;
        if (ruleSender([rule], t.prompt)) p.hits++;
        if (now() > until) left = true;
      }
      if (p.n < turns.length) left = true;
      hits += p.hits;
      of += p.of;
    }
    // Read by the draw that built this editor (render), and set again only by the next one.
    if (left) { this.senderHitsLeft = true; return null; }
    if (!of) return null;
    if (c.shown?.hits !== hits || c.shown.of !== of) c.shown = { hits, of };
    return c.shown;
  }
  // The line under the open rule's result: how many typed prompts here it matches.
  senderMatchLine(n) {
    if (n.of === 1) return n.hits ? "Matches the one prompt typed in this conversation." : "Does not match the one prompt typed in this conversation.";
    const of = `${fmtCount(n.of)} prompts typed in this conversation`;
    return n.hits ? `Matches ${fmtCount(n.hits)} of the ${of}.` : `Matches none of the ${of}.`;
  }
  // The session's repository changed (another session, another folder) under the open
  // rule: its example's result is worked out again for the new one.
  ruleRepoCheck() {
    const e = this.ruleEdit;
    if (e?.kind !== "links" || e.repo === this.repoSig()) return;
    e.repo = this.repoSig();
    if (!e.stale) e.result = e.lastGood = this.ruleResult(e);
  }
  ruleResult(e) {
    const d = e.draft;
    const url = d.url.trim();
    const rule = { n: 0, name: d.name || "This rule", re: new RegExp(d.pattern, "g"), url, host: templateHost(url), repo: /\{(repo|owner)\}/.test(url) };
    if (!d.example) return { line: "Type an example to see what this rule links." };
    const away = this.repoAway(rule);
    if (away) return { pieces: [{ t: d.example }], under: away };
    const ctx = this.linkCtx();
    const pieces = linkPieces(d.example, [rule], ctx);
    const hit = pieces.find((p) => p.url)?.url ?? null;
    if (!hit) return { pieces, under: "Finds nothing in its example" };
    // A rule higher in the list that takes the same text first.
    const pos = e.at ?? e.insertAt;
    const above = (this.links ?? []).filter((r) => r.n - 1 < pos);
    let beaten = null;
    if (above.length && !linkPieces(d.example, [...above, rule], ctx).some((p) => p.url === hit)) {
      beaten = above.find((r) => linkPieces(d.example, [r], ctx).some((p) => p.url))?.name ?? "A rule above";
    }
    return { pieces, under: hit, url: hit, beaten };
  }
  // Keep rule (or Enter in a field): a rule that would not run stays open with its reasons,
  // and the first faulty field takes the keys.
  keepRule(cx) {
    const e = this.ruleEdit;
    if (!e) return false;
    this.ruleCheck();
    const bad = Object.keys(e.faults).filter((f) => e.faults[f]);
    if (bad.length) {
      for (const f of bad) e.shown[f] = e.faults[f];
      if (this.cardRing) this.cardRing = `th-rule-f-${bad[0]}`;
      this.fieldFocused = `${fieldTag(e.kind)}${bad[0]}`;
      this.inputsOf(e.kind)[bad[0]].focus();
      return false;
    }
    if (this.rulesRefused(e.kind)) { e.refused = this.prefsError; return false; }
    const raw = this.fileRules(e.kind);
    this.followRules(raw);
    const o = this.ruleObject(e.draft, e.base, e.kind);
    const at = e.at ?? Math.min(e.insertAt, raw.length);
    if (e.at != null) raw[e.at] = o;
    else raw.splice(at, 0, o);
    this.closeRule();
    this.ringMove(this.editStop(e.kind, at + 1));
    this.writeRules(e.kind, raw, cx, null, e);
    return true;
  }
  // The switch on a row: off keeps the rule and links (or marks) nothing with it.
  toggleRule(at, cx, kind = this.ruleKind()) {
    if (this.rulesRefused(kind)) return;
    const raw = this.fileRules(kind);
    const o = raw[at];
    if (!o || typeof o !== "object") return;
    if (o.on === false) delete o.on;
    else o.on = false;
    this.writeRules(kind, raw, cx);
  }
  // Remove: gone at once, with Undo in its place until the page is left or another goes.
  removeRule(at, cx, kind = this.ruleKind()) {
    if (this.rulesRefused(kind)) return;
    const raw = this.fileRules(kind);
    if (at < 0 || at >= raw.length) return;
    const key = (r) => (r === undefined ? null : JSON.stringify(r));
    const prev = at > 0 ? key(raw[at - 1]) : null;
    const next = key(raw[at + 1]);
    const [rule] = raw.splice(at, 1);
    // Its neighbors, so Undo puts it back beside them whatever moved meanwhile.
    this.ruleUndo = { kind, at, rule, prev, next, name: this.listOf(kind)[at]?.name ?? `Rule ${at + 1}` };
    if (this.ruleEdit?.at === at) this.closeRule();
    this.ringMove("th-rule-undo");
    this.writeRules(kind, raw, cx, this.ruleUndo);
  }
  undoRemove(cx) {
    const u = this.ruleUndo;
    if (!u || this.rulesRefused(u.kind)) return;
    const raw = this.fileRules(u.kind);
    this.followRules(raw);
    raw.splice(Math.min(u.at, raw.length), 0, u.rule);
    this.ruleUndo = null;
    this.ringMove(this.editStop(u.kind, Math.min(u.at, raw.length - 1) + 1));
    this.writeRules(u.kind, raw, cx);
  }
  // Move up: the open rule one place higher, so it takes text before the rule it passes.
  moveRuleUp(cx) {
    const e = this.ruleEdit;
    if (!e || e.at == null || e.at < 1 || this.rulesRefused(e.kind)) return;
    const raw = this.fileRules(e.kind);
    [raw[e.at - 1], raw[e.at]] = [raw[e.at], raw[e.at - 1]];
    e.at -= 1; // so the twin nearest the new place is the one followed
    if (e.at === 0 && this.cardRing === "th-rule-up") this.cardRing = "th-rule-dup";
    this.writeRules(e.kind, raw, cx);
    this.ruleCheck();
  }
  // Duplicate: a new rule under this one, filled from it, not kept until Keep rule.
  duplicateRule() {
    const e = this.ruleEdit;
    if (!e) return;
    this.openRule(null, { ...e.draft }, (e.at ?? e.insertAt) + 1, e.kind);
    // Discard goes back to where the rule it copies was opened from.
    if (this.ruleEdit) this.ruleEdit.from = e.from;
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
  // Their place in this order is their number (1 to 7) and digit key.
  pinnedAll() {
    // No terminal status in the key: whether a pin's turn is live does not depend on it
    // (isLive), and reading it here, once per row drawn, read Herdr's panes thousands of
    // times a draw in a long session.
    const memoKey = `${this.pinVer}|${this.sessions.map((s) => `${s.version}.${s.turns.length}.${s.loaded ? 1 : 0}`).join(",")}|${this.sel}|${this.sel && this.open.has(this.sel) ? 1 : 0}`;
    if (this.pinMemoKey === memoKey) return this.pinMemo;
    const out = [];
    this.sessions.forEach((s, si) => {
      const pins = this.pinStore.sessions[this.sessionKey(s)]?.pins ?? [];
      if (!pins.length) return;
      const ids = turnIds(s.turns, pins.map((p) => p.id));
      for (const pin of pins) {
        const turn = ids.get(pin.id) ?? null;
        const key = turn ? `${si}:${turn.n}` : null;
        if (turn) pin.n = turn.n;
        const live = turn ? this.isLive(s, si, turn.n - 1) : false;
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
  // A pinned turn's number (1 to 7, its place in the Pinned view and its digit key), or null.
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
    const hidden = (q && !threadMatches(s.turns, turn, q)) || !isShown(turn, { agentTurns: this.prefs.agentTurns, live: p.state === "live", turns: s.turns });
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
    this.scrollTo = again ? { key: first, how: "land", or: rest, head: key, until, resume: true, flash: true } : { key, how: "head", until, flash: true };
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
    if (this.sideKey()) return this.sideSelf(this.sideKey());
    const known = shared(MAP_KEY)?.[this.terminal];
    const mine = known ? panes().find((p) => p.pane === known.pane) : null;
    if (mine) return mine;
    // Opened some other way (props() carries no pane id): the only Threads pane in the
    // terminal's tab that no other terminal has claimed is this one.
    const tab = this.pane()?.tab;
    const claimed = new Set([...Object.entries(shared(MAP_KEY) ?? {}).filter(([t]) => t !== this.terminal).map(([, v]) => v.pane),
      ...Object.values(shared(PIN_MAP_KEY) ?? {}).map((v) => v.pane), ...Object.values(shared(TRAJ_MAP_KEY) ?? {}).map((v) => v.pane)]);
    const here = panes().filter((p) => p.mod === MOD && p.tab === tab && !claimed.has(p.pane));
    if (here.length === 1) return here[0];
    const anywhere = panes().filter((p) => p.mod === MOD && !claimed.has(p.pane));
    return anywhere.length === 1 ? anywhere[0] : null;
  }
  // The map a pane split off the Chat is kept in: the Pinned pane's or the Trajectory pane's.
  sideKey() { return this.pinnedPane ? PIN_MAP_KEY : this.trajPane ? TRAJ_MAP_KEY : null; }
  // Such a pane's own pane: the one in its map, or else the only Threads pane in the main
  // pane's tab that no map claims (it was split from there, and props carry no id).
  sideSelf(key) {
    const known = shared(key)?.[this.terminal];
    const mine = known ? panes().find((p) => p.pane === known.pane) : null;
    if (mine) return mine;
    const main = shared(MAP_KEY)?.[this.terminal]?.pane;
    const claimed = new Set([MAP_KEY, PIN_MAP_KEY, TRAJ_MAP_KEY].flatMap((k) => Object.values(shared(k) ?? {})).map((v) => v.pane));
    const tab = panes().find((p) => p.pane === main)?.tab;
    const here = panes().filter((p) => p.mod === MOD && !claimed.has(p.pane) && (!tab || p.tab === tab));
    return here.length === 1 ? here[0] : null;
  }
  // The main Threads pane of this terminal, and its Pinned pane, when open.
  mainPane() { const id = shared(MAP_KEY)?.[this.terminal]?.pane; return id ? panes().find((p) => p.pane === id) ?? null : null; }
  pinnedPaneOpen() { const id = shared(PIN_MAP_KEY)?.[this.terminal]?.pane; return id ? panes().find((p) => p.pane === id) ?? null : null; }
  trajPaneOpen() { const id = shared(TRAJ_MAP_KEY)?.[this.terminal]?.pane; return id ? panes().find((p) => p.pane === id) ?? null : null; }
  // The Trajectory's dock (TRD-24). Only a Trajectory on the right is in the Chat's row: the
  // row and the pair on weights, the room probe, v's split, - and =, and the kept right width
  // go by trajRightOpen. A bottom pane sits in a split of its own under the row, so none of
  // them counts it (trajBottomId), while y, the Trajectory button and the selection go by
  // trajPaneOpen, either dock.
  trajBottomId() { const e = shared(TRAJ_MAP_KEY)?.[this.terminal]; return e?.dock === "bottom" ? e.pane : null; }
  trajRightOpen() { return this.trajBottomId() ? null : this.trajPaneOpen(); }
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
    s.senders = this.senders;
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
    // Another session while the loading state is up: none of the first one's last write or
    // newest prompt, before its first chunk is read.
    if (this.opening && !this.opening.done && this.opening.list === this.sessions) this.openSwitch(s);
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
          let cap = READ_CHUNK;
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
              cap = READ_CHUNK;
              continue;
            }
            if (c.head && !s.head) s.head = c.head;
            s.size = c.size;
            // From here until the offset moves, s holds part of this chunk.
            s.partial = true;
            if (c.rewind) rewindTail(s);
            // No perl on this machine: the reader fell back to jq's raw read (core/lines.sh).
            if (c.noPerl) this.noPerl = true;
            // A line too long to read (extract.sh's line_max) was skipped: counted for the debug report,
            // and noted in the list after the turn it fell in (noteSkip).
            if (c.skipped) { s.skipped = { lines: (s.skipped?.lines ?? 0) + 1, bytes: (s.skipped?.bytes ?? 0) + c.skipped }; noteSkip(s, c.skipped); }
            // Once read in full, a prompt or end of turn that turns up was seen as it happened.
            if (s.clock && s.loaded) {
              const at = Date.now();
              for (const e of c.events) if (e.k === "p" || e.k === "d" || e.k === "i") e.at = at;
            }
            if (!(await sliced(c.events, (e) => apply(s, e), cx))) return;
            if (c.events.length) grew = true;
            s.offset += c.used;
            s.partial = false;
            if (s.offset < s.size) cap = readCap(cap, c.cut, chunk, CHUNK);
            chunk = nextChunk(s, c.used, chunk, Math.min(cap, chunk * 2));
            if (!s.loaded) cx.notify();
            // Once a session (peek holds the session peeked): another one on the list is
            // statted and peeked again.
            const o = this.opening;
            if (!s.loaded && o && o.list === this.sessions && o.peek !== s) this.openPeek(s, cx);
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
          if (this.openActive() && this.opening.list === this.sessions) this.openStat(s, cx);
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
    this.dropAnchor();
    Object.assign(s, newSession(s.id, s.file), { reason: s.reason, version: s.version + 1, partial: false, clock: s.clock, senders: s.senders });
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
    const key = this.sideKey() ?? MAP_KEY;
    // A bottom Trajectory pane says so in its entry, so the Chat leaves it out of its row.
    const dock = this.trajPane && this.trajDock === "bottom" ? "bottom" : null;
    const was = shared(key)?.[this.terminal];
    if (was?.pane !== mine || (was?.dock ?? null) !== dock) cx.timer.after(0, () => remember(this.terminal, mine, key, dock ? { dock } : {}));
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
    this.settleSplit(cx);
    this.rowLandGone(cx);
    this.trajGiveBack(cx);
    this.weighSoon();
    this.weighStep();
    this.autoPinned(cx);
    this.pairCloseStep();
    this.weightsGate(cx);
    this.pairPoll(cx);
    this.rowPoll(cx);
    if (this.syncSel()) this.selMoved = true;
    this.lookRepo(cx);
    this.ruleRepoCheck();
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
    const sess = this.sessions.map((s) => `${s.version}.${s.turns.length}.${s.loaded ? 1 : 0}`).join(",");
    // What the rows depend on besides the sessions: the open and shown parts of each turn
    // (turnSets, every key starting with its turn's key, which a splice can follow), then the rest.
    const other = [
      this.filterText(), status,
      Math.round(this.width), Boolean(this.res.ended),
      `${P.textSize}.${this.chars()}.${P.promptLines}.${P.replyLines}.${P.truncate ? 1 : 0}.${P.agentTurns ? 1 : 0}.${P.agentRail === true ? 1 : 0}`, this.selecting ?? "",
      this.linksVer, this.sendersVer, this.repoSig(), this.detailsOpen ? 1 : 0, this.imgVer ?? 0, this.pinVisit ?? "", this.resumeAt() ?? "",
      this.view, this.view === "pinned" ? this.pinVer : "", dayKey(Date.now()), this.outlined() ? "outline" : "",
    ].join("|");
    const rest = `${this.turnSets().map((x) => [...x].join(",")).join("|")}|${this.callVer ?? 0}|${other}`;
    const key = `${sess}|${rest}`;
    // Rows left with an old shape (SHAPE_MS) are reshaped where they are; the rest stay.
    if (this.rowsKey === key && this.baseRows && this.reshapeDue) {
      this.reshapeDue = false;
      if (!this.reshapeStale(status)) this.rowsKey = null;
    }
    if (this.rowsKey !== key || !this.baseRows) this.buildStep(status, key, rest, other);
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
    // The pane's height only moves the spacer under a short list: Herdr's banner changes it, and
    // as part of the rows' key it rebuilt every row after each stopped draw.
    const fit = `${key}|${lr?.kind}|${z}|${this.sizesVer ?? 0}|${gap}|${Math.round(this.listH)}|${this.landLift ?? 0}|${this.anchorLift ?? 0}|${this.anchorSlot ? `${this.anchorSlot.i}:${this.anchorSlot.h}` : ""}`;
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
      this.indexedRows = rows;
      this.sizesMemo = sizes;
      // What the list is given: whole design px. v_virtual_list scales item sizes by zoom
      // itself, as it scales what an item draws, so a slot of h design px holds h design px
      // at any zoom (seen in a drawn window at zoom 0.9: a 73 px row took 73 x 0.9 zoomed px).
      this.slotsMemo = sizes.map((h) => Math.ceil(h));
      if (this.anchor && !this.anchor.end) this.holdPlace(rows, this.slotsMemo);
      // A held place put back (letGo): row 0 lift px taller (or shorter) for the layout that
      // lands it.
      if (this.anchorLift && this.slotsMemo.length) this.slotsMemo[0] = Math.max(1, this.slotsMemo[0] + this.anchorLift);
      // Or the row that crosses the bottom edge at the height that lands it, for that layout.
      const slot = this.anchorSlot;
      if (slot && slot.i < this.slotsMemo.length) this.slotsMemo[slot.i] = Math.max(1, slot.h);
      // A rail click's landing (landExact): the first row is lift px taller for the frame of
      // the scroll, far above the view, then its own height again.
      if (this.landLift > 0 && this.slotsMemo.length) this.slotsMemo[0] += Math.ceil(this.landLift);
      this.fitKey = fit;
      // A closed running pin in the Pinned view is a compact row with live off, but its
      // reply line carries the clock, so it counts as shown too.
      this.liveShown = Boolean(lr?.live) || rows.some((r) => r.kind === "wake" || r.running);
    }
    return this.rowsMemo;
  }

  // One slice of a rows build (buildRows with BUILD_MS). The rows on screen stay until the
  // new ones are all built; a build that only gained turns at the end since its last slice
  // goes on where it stopped. Building every row of a 6,000-turn session in one draw took
  // longer than Herdr's time for a draw, which stopped it every time.
  buildStep(status, key, rest, other = null) {
    let job = this.rowJob;
    if (job && job.key !== key) job = job.rest === rest && this.jobGoesOn(job) ? job : null;
    if (!job && other != null && this.spliceRows(status, key, rest, other)) return;
    if (job) {
      job.key = key;
      // One slice a frame: rows() is asked for more than once in a draw.
      if (job.frame === this.renders) return;
    } else {
      this.shapeStart();
      this.shapeLeft = 0;
      this.otherLeft = 0;
      this.againOpen = false;
      this.reshapeDue = false;
      this.shapeInView(status);
      // Only the newest turns changed (a turn came in, the running one grew, the next piece
      // of a long session was read): the rows before them are kept (keptFrom).
      const from = this.rowsKey != null && this.baseRows?.length ? this.keptFrom(rest) : null;
      const index = from ? new Map(this.baseIndex) : new Map();
      if (from) for (let i = from.row; i < this.baseRows.length; i++) index.delete(this.baseRows[i].key);
      job = this.rowJob = {
        key, rest, other, sessions: this.sessions.slice(), vers: this.sessions.map((x) => x.version),
        from: from ? { ...from, rows: this.baseRows, railRows: this.railTurns } : null,
        stale: from ? (this.staleRows ?? []).filter((i) => i < from.row) : [],
        sizes: from ? this.baseSizes.slice(0, from.row) : [],
        index,
      };
    }
    this.buildStale = job.stale;
    job.frame = this.renders;
    const b0 = now();
    const until = b0 + this.buildMax();
    const s0 = this.shapeSpent ?? 0;
    // Rows the last slice built but had no time to size (below): sized first, then built on.
    const left = job.sizing;
    let out;
    if (left) {
      job.sizing = null;
      out = left.out;
      this.buildInfo = left.info;
      this.buildRail = left.rail;
      this.cachedH = left.cachedH;
      this.cacheNew = left.cacheNew;
    } else {
      // A slice Herdr stopped (its draw ran past the limit) leaves what it built past where
      // job.from says the next one starts, as job.from moves only when a slice ends: the rows
      // added to the arrays a resumed slice was handed, and the sizes and index entries of the
      // rows it had sized. Cut back to that start, so no turn's rows are built twice.
      const keep = job.from ? job.from.row : 0;
      if (job.out) for (let i = keep; i < job.sizes.length; i++) { const k = job.out[i]?.key; if (job.index.get(k) === i) job.index.delete(k); }
      if (job.sizes.length > keep) job.sizes.length = keep;
      if (job.from?.own) { job.from.rows.length = job.from.row; job.from.railRows.length = job.from.rail; }
      job.out = null;
      out = this.buildRows(status, job.from, until);
      job.out = out;
      if (job.from?.before && job.from.dayRow != null && !this.buildInfo.resume) job.sizes[job.from.dayRow] = this.height(out[job.from.dayRow]);
    }
    // Each new row's height, inside the slice's time too: at a narrow width the heights of
    // the 1,474 rows a 10 ms slice built took 39 ms more on the rig, and Herdr stopped the
    // draw. While the rows on screen stay (a rebuild), the rest are sized in the next frame's
    // slice, unless only a few are left (about 2 ms of heights). A first build sizes them all:
    // with no rows yet, a pause would show the loading lines for a frame.
    const pause = Boolean(this.baseRows?.length);
    for (let i = job.sizes.length, n = 0; i < out.length; i++, n++) {
      if (pause && (n & 31) === 31 && out.length - i > SIZE_REST && now() > until) {
        job.sizing = { out, info: this.buildInfo, rail: this.buildRail, cachedH: this.cachedH, cacheNew: this.cacheNew };
        this.buildSpent = (this.buildSpent ?? 0) + Math.max(0, now() - b0 - ((this.shapeSpent ?? 0) - s0));
        job.ms = (job.ms ?? 0) + (now() - b0);
        this.buildsLeft = (this.buildsLeft ?? 0) + 1;
        return;
      }
      job.sizes.push(this.cachedH.get(i) ?? this.height(out[i]));
      job.index.set(out[i].key, i);
    }
    this.buildSpent = (this.buildSpent ?? 0) + Math.max(0, now() - b0 - ((this.shapeSpent ?? 0) - s0));
    job.ms = (job.ms ?? 0) + (now() - b0);
    for (const e of this.cacheNew) e.sizes = e.rows.map((_, j) => job.sizes[e.at + j]);
    const res = this.buildInfo.resume;
    if (res) {
      job.from = { ...res, rows: out, railRows: this.buildRail, own: true };
      job.vers = this.sessions.map((x) => x.version);
      job.lens = this.sessions.map((x) => x.turns.length);
      this.buildsLeft = (this.buildsLeft ?? 0) + 1;
      if (!this.baseRows) { this.baseRows = []; this.baseSizes = []; this.baseIndex = new Map(); this.probeList(); this.fitKey = null; }
      return;
    }
    this.rowJob = null;
    this.buildMs = job.ms;
    // A new column width: the place on screen before these rows come in (holdPlace).
    if (this.anchorDue) { this.anchorDue = false; this.anchor = this.takeAnchor(); }
    this.baseRows = out;
    this.railTurns = this.buildRail;
    this.baseSizes = job.sizes;
    this.baseIndex = job.index;
    this.staleRows = job.stale;
    this.probeList();
    this.rowBuild = { rest, sessions: this.sessions.slice(), lens: this.sessions.map((x) => x.turns.length), vers: this.sessions.map((x) => x.version), multi: this.buildInfo.multi, marks: this.buildInfo.marks,
      other: job.other ?? null, sets: this.turnSets().map((x) => new Set(x)), callVer: this.callVer ?? 0 };
    this.rowsKey = key;
    this.fitKey = null;
    // The selection is on a turn the list no longer shows: agent turns were hidden, or a
    // hidden agent turn that showed while it was live has finished.
    if (this.reselect || this.selHidden()) this.reselectVisible();
    this.latestAfterBuild();
  }

  // Whether a build stopped between slices can go on: the same sessions, earlier ones as they
  // were, and in the newest only turns at or after the place it stopped have changed.
  jobGoesOn(job) {
    if (!job.from?.own || !job.lens) return false;
    const S = this.sessions;
    const L = S.length - 1;
    if (S.length !== job.sessions.length) return false;
    for (let i = 0; i <= L; i++) {
      if (S[i] !== job.sessions[i]) return false;
      if (i < L && (S[i].version !== job.vers[i] || S[i].turns.length !== job.lens[i])) return false;
    }
    if (job.from.si !== L) return false;
    const turns = S[L].turns;
    if (turns.length < job.lens[L]) return false;
    let safe = job.lens[L] - 1;
    while (safe > 0 && !(turns[safe - 1].done && turns[safe - 1].after?.length)) safe--;
    return job.from.ti <= safe;
  }

  // Where the kept rows end, or null for a full rebuild: only when nothing but the newest
  // session changed, and in it only turns at or after a turn with its reply. A turn with no
  // reply yet can still change (it is open, a later turn answers it, or it is the newest), so
  // the rebuild starts at the last mark (a day band, or every BAND_MARK turns in one) before
  // the first such turn.
  keptFrom(rest) {
    const b = this.rowBuild;
    if (!b || b.rest !== rest || !b.multi || this.view === "pinned" || this.outlined() || this.filterText()) return null;
    const S = this.sessions;
    const L = S.length - 1;
    if (L < 0 || S.length !== b.sessions.length) return null;
    for (let i = 0; i <= L; i++) {
      if (S[i] !== b.sessions[i]) return null;
      if (i < L && (S[i].version !== b.vers[i] || S[i].turns.length !== b.lens[i])) return null;
    }
    const turns = S[L].turns;
    const was = b.lens[L];
    if (turns.length < was || was < 2) return null;
    let safe = was - 1;
    while (safe > 0 && !(turns[safe - 1].done && turns[safe - 1].after?.length)) safe--;
    for (let k = b.marks.length - 1; k >= 0; k--) {
      const m = b.marks[k];
      if (m.ti <= safe) return { ...m, marks: b.marks.slice(0, k) };
    }
    return null;
  }

  // A closed row's reply block as a probe part (cmdRow), made once per row object.
  cmdFor(r) {
    this.cmdOf ??= new WeakMap();
    let c = this.cmdOf.get(r);
    if (!c) { c = this.cmdRow(r); this.cmdOf.set(r, c); }
    return c;
  }

  // The parts the probe measures changed (probeDue finds them from the rows as it walks).
  probeList() { this.probeVer = (this.probeVer ?? 0) + 1; }
  // Every part the probe measures: the probed rows, then each closed row's reply block. Made
  // when asked; nothing draws from it.
  get probeRows() {
    const probed = [];
    const cmds = [];
    for (const r of this.baseRows ?? []) {
      if (PROBED.has(r.kind)) probed.push(r);
      else if (r.kind === "turn" && r.shape?.md != null) cmds.push(this.cmdFor(r));
      else if (r.live && (r.kind === "working" || r.kind === "wrow")) probed.push(this.workYou(r));
    }
    return probed.concat(cmds);
  }

  // Closed rows built with an old or blank shape (out of SHAPE_MS) get their shape where they
  // are. False when one changes what the row is made of (pasted images), for a full rebuild.
  reshapeStale(status) {
    this.shapeStart();
    this.shapeLeft = 0;
    this.otherLeft = 0;
    this.shapeInView(status);
    const left = [];
    // Nearest the newest first when following, where the view is. Once this draw's time is
    // spent the rest wait as they are, without a look at each.
    const stale = this.staleRows ?? [];
    const order = this.follow ? stale.slice().reverse() : stale;
    const cg = order.length ? this.closedLookNow() : null;
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      if ((this.shapeSpent ?? 0) > this.shapeMax()) { this.shapeLeft += order.length - k; for (; k < order.length; k++) left.push(order[k]); break; }
      const r = this.baseRows[i];
      if (r?.kind !== "turn" || !r.turn) continue;
      const sh = this.shape(r.turn);
      // Left for its expected cost (shapeCost) or out of time: the rest wait too, unlooked at.
      // Going on past a turn left for its cost, with the time not yet spent, called shape() for
      // every row still to reshape in that one draw: 5,500 of them, 40 to 50 ms, on the rig.
      if (this.shapeStale) { this.shapeLeft += order.length - k - 1; for (; k < order.length; k++) left.push(order[k]); break; }
      if (sh === r.shape) continue;
      if (Boolean(sh.thumbs) !== Boolean(r.shape?.thumbs)) return false;
      const nr = { ...r, shape: sh };
      this.baseRows[i] = nr;
      this.baseSizes[i] = this.height(nr);
      // A closed turn of one row, shaped at last: kept for the next rebuild (closedCached), as
      // if the build had shaped it. Most rows of a long session are shaped this way.
      if (cg && !r.live && !r.last && !r.split && this.open.has(r.key) === false) {
        this.keptFor().rows.set(r.key, { turn: r.turn, s: r.s, sig: this.closedSig(r.key, r.turn, r.si, cg), rows: [nr], sizes: [this.baseSizes[i]], at: i, shape: sh });
      }
    }
    this.staleRows = left;
    this.probeList();
    this.fitKey = null;
    return true;
  }

  // The index of a list item in rowsMemo, from baseIndex (the list adds a spacer or a gap
  // first): a search over every row for each one drawn took 1 ms a row in a long session.
  rowIndex(key) {
    const rows = this.rowsMemo ?? [];
    const off = rows[0]?.kind === "spacer" || rows[0]?.kind === "gap" ? 1 : 0;
    const i = this.baseIndex?.get(key);
    if (i != null && rows[i + off]?.key === key) return i + off;
    if (key !== "spacer" && key !== "gap" && key !== "tail" && rows === this.indexedRows) return -1;
    return rows.findIndex((r) => r.key === key);
  }

  // Whether turn ti of session si is the live newest turn (Working or Needs you): only one
  // still owed its reply. A done turn the agent woke up for again (a background task's
  // notification) keeps its reply, with an Updating line under it (waking).
  // The newest turn with no end yet, once its session is read to the end: until then the last
  // turn read may have its end in a later chunk, and it was drawn as running for days.
  isLive(s, si, ti, _status) {
    return Boolean(s.loaded) && si === this.sessions.length - 1 && ti === s.turns.length - 1 && !s.turns[ti].done;
  }
  waking(s, si, ti, status) {
    return si === this.sessions.length - 1 && ti === s.turns.length - 1 && s.turns[ti].done && s.followActive && status === "working";
  }

  // The rows, from the start or from a place (from: a mark from keptFrom, or where an earlier
  // slice stopped), whose rows and rail before it are kept. With until, it stops at a turn
  // once that time has passed and says where (buildInfo.resume), so a long session's rows are
  // built over several frames, each inside Herdr's time for a draw.
  buildRows(status, from = null, until = 0) {
    this.buildInfo = { multi: false, marks: [], resume: null };
    // Closed turns' rows and sizes from earlier builds (closedCached), for this slice.
    this.cachedH = new Map();
    this.cacheNew = [];
    if (this.view === "pinned") { const rows = this.pinnedRows(status); this.buildRail = this.railTurns; return rows; }
    const out = !from ? [] : from.own ? from.rows : from.rows.slice(0, from.row);
    // The rail's turns: every shown turn, with the ones a search leaves out marked.
    const rail = !from ? [] : from.own ? from.railRows : from.railRows.slice(0, from.rail);
    this.buildRail = rail;
    const marks = from ? from.marks.slice() : [];
    const lastSi = this.sessions.length - 1;
    const outline = this.outlined();
    let maxN = 1;
    if (outline) for (const s of this.sessions) maxN = Math.max(maxN, s.turns.length ? s.turns[s.turns.length - 1].n : 1);
    const numW = outlineNumW(maxN);
    const q = this.filterText();
    const agents = Boolean(this.prefs.agentTurns);
    // agentRail off (the default): agent messages get no tick (the running turn keeps its own).
    const agentRail = this.prefs.agentRail === true;
    const fromSi = from ? from.si ?? lastSi : 0;
    // What every closed row depends on besides its own turn; none while a search is on.
    const cg = this.closedLookNow();
    if (!from && cg && this.keptFor().rows.size > 2 * this.sessions.reduce((n, x) => n + x.turns.length, 0) + 100) this.keptFor().rows.clear();
    for (let si = fromSi; si < this.sessions.length; si++) {
      const s = this.sessions[si];
      const first = Boolean(from) && si === fromSi;
      const t0 = first ? from.ti : 0;
      if (!first && si > 0) out.push({ kind: "divider", key: `div:${si}`, s });
      if (!first && s.reason && s.turns.length === 0 && s.loaded) out.push({ kind: "note", key: `empty:${si}`, text: "No turns in this session yet" });
      // A line skipped before the first turn (noteSkip).
      if (!first && s.skippedHead && !outline && !q) out.push({ kind: "note", key: `skip:${si}:head`, text: skipNote(s.skippedHead) });
      // The live newest turn (isLive), found once for the session: none while the session is
      // still read, as a later chunk may hold the turn's end (a later session has no opening).
      const liveTi = s.turns.length && this.isLive(s, si, s.turns.length - 1) ? s.turns.length - 1 : -1;
      const shown = (turn, ti) => isShown(turn, { agentTurns: agents, live: ti === liveTi, turns: s.turns });
      // Day dividers when the session spans more than one day; counts are of shown turns.
      const days = new Map();
      for (let ti = t0; ti < s.turns.length; ti++) {
        const t = s.turns[ti];
        const d = t.day === undefined ? (t.day = dayKey(t.ts)) : t.day;
        if (!d || !shown(t, ti)) continue;
        const r = days.get(d) ?? { ts: t.ts, count: 0 };
        r.count++;
        days.set(d, r);
      }
      const multi = first ? from.multi ?? true : days.size > 1;
      if (si === lastSi) this.buildInfo.multi = multi;
      let day = first ? from.day ?? (from.before ? from.d : null) : null;
      // Shown turns so far in the day band, and the band's day item, for the marks.
      let band = first ? from.before ?? 0 : 0;
      let dayRow = first && from.before ? from.dayRow : null;
      let unmatched = first ? from.unmatched ?? 0 : 0;
      const flush = () => { if (unmatched) out.push({ kind: "hidden", key: `hid:${si}:${out.length}`, n: unmatched }); unmatched = 0; };
      for (let ti = t0; ti < s.turns.length; ti++) {
        if (until && ti > t0 && (ti & 15) === 0 && now() > until) {
          this.buildInfo.resume = { si, ti, row: out.length, rail: rail.length, before: band, d: day, day, dayRow, multi, unmatched, marks };
          this.buildInfo.marks = marks;
          return out;
        }
        const turn = s.turns[ti];
        const key = `${si}:${turn.n}`;
        const railAt = rail.length;
        // Agent turns while they are hidden: skipped, and counted in the header instead.
        const visit = key === this.pinVisit;
        const off = !shown(turn, ti);
        const miss = q && !threadMatches(s.turns, turn, q);
        if (!off && (agentRail || !turn.agent || ti === liveTi)) rail.push({ key, turn, day: turn.day ?? dayKey(turn.ts), live: ti === liveTi, miss: Boolean(miss) });
        if (off && !visit) continue;
        if (miss && !visit) { unmatched++; continue; }
        const d = turn.day;
        const newDay = multi && !q && d && d !== day;
        // Where a later rebuild can start (keptFrom): before a day band, and every BAND_MARK
        // shown turns inside one.
        if (si === lastSi && !q && !outline && (newDay || (band && band % BAND_MARK === 0))) {
          marks.push(newDay ? { ti, row: out.length, rail: railAt, before: 0, d, dayRow: null } : { ti, row: out.length, rail: railAt, before: band, d: day, dayRow });
        }
        flush();
        if (visit && (off || miss)) out.push({ kind: "note", key: `visit:${key}`, text: visitNote(miss) });
        if (newDay) {
          day = d;
          band = 0;
          dayRow = out.length;
          const r = days.get(d);
          out.push({ kind: "day", key: `day:${si}:${d}`, ...dayParts(r.ts), count: r.count });
        }
        if (!off) band++;
        const last = si === this.sessions.length - 1 && ti === s.turns.length - 1;
        const live = ti === liveTi;
        // The outline: one row per turn, under the same day bands, the same search and the
        // same agents toggle. It keeps the turn's key, so the selection carries over.
        if (outline) { out.push({ kind: "line", key, turn, s, si, last, running: live, numW, text: outlineText(noticeTurn(turn) ? kindWords(turn.sender) : turn.prompt, q) }); continue; }
        this.turnRows({ kind: "turn", key, turn, s, si, last, live }, ti, out, status, cg);
        // A line skipped while this turn was the newest one read (noteSkip): one dim line after it.
        if (turn.skipped && !q) out.push({ kind: "note", key: `skip:${key}`, text: skipNote(turn.skipped) });
      }
      flush();
      // Built from inside a day band: the band's day item, kept, counts its turns again.
      if (first && from.before && from.dayRow != null) {
        const dd = from.day ?? from.d;
        out[from.dayRow] = { ...out[from.dayRow], count: from.before + (days.get(dd)?.count ?? 0) };
      }
    }
    this.buildInfo.marks = marks;
    return out;
  }

  // A closed turn. With pasted images its meta line and tiles are an item of their own
  // ("wtop", keyed imgs:<turn>), as a running turn's are, so a click on a tile opens the review
  // at that image (a list item has one click handler), and the row follows without its meta
  // line ("split").
  // One shown turn's rows: running, open or closed, and the wake line under the newest.
  turnRows(item, ti, out, status, cg) {
    const { key, turn, s, si, last, live } = item;
    if (live) this.liveRows(item, out);
    else if (this.open.has(key)) this.expanded(item, out);
    else if (cg && !last) this.closedCached(item, out, cg);
    else this.closedRows(item, out);
    if (this.waking(s, si, ti, status)) out.push({ kind: "wake", key: `wk:${key}`, turn, s });
  }

  // The sets that say which parts of each turn are open or shown. Every key in them starts
  // with its turn's key ("<session>:<number>", "l:" first for an update shown whole).
  turnSets() { return [this.open, this.full, this.lineOpen, this.lineTouched, this.groupOpen, this.groupTouched, this.callOpen, this.callAll]; }

  // A turn opened or closed, or a part of one (a group, a call, a whole prompt), and nothing
  // else changed: only that turn's rows are built again and put in place of its old ones.
  // Building every row walks every turn, 12 ms at 2,000 turns on the rig even with each
  // closed turn's rows kept (closedCached). Returns false when a full build is needed.
  spliceRows(status, key, rest, other) {
    const b = this.rowBuild;
    const cg = this.closedLookNow();
    // A cleared rowsKey asks for every row to be built.
    if (this.rowsKey == null || !b?.sets || b.other !== other || !cg || !this.baseRows?.length || !this.baseIndex) return false;
    const S = this.sessions;
    if (S.length !== b.sessions.length) return false;
    for (let i = 0; i < S.length; i++) if (S[i] !== b.sessions[i] || S[i].version !== b.vers[i] || S[i].turns.length !== b.lens[i]) return false;
    // The turns whose parts changed. New call details (callVer) change every open turn and
    // the running one.
    const keys = new Set();
    const now = this.turnSets();
    const turnOf = (k) => { const p = String(k).replace(/^l:/, "").split(":"); return `${p[0]}:${p[1]}`; };
    for (let i = 0; i < now.length; i++) {
      for (const k of now[i]) if (!b.sets[i].has(k)) keys.add(turnOf(k));
      for (const k of b.sets[i]) if (!now[i].has(k)) keys.add(turnOf(k));
    }
    // New call details, or interim texts and estimates left out of time in open turns.
    const again = this.againOpen;
    this.againOpen = false;
    if (again) this.otherLeft = 0;
    if ((this.callVer ?? 0) !== b.callVer || again) {
      for (const k of this.open) keys.add(k);
      for (const r of this.baseRows) if (r.live) keys.add(r.turnKey ?? r.key);
    }
    // None: new call details with no turn open or running to show them, or the same keys in
    // another order (a part closed and opened again): nothing to build.
    if (keys.size > 8) return false;
    // Each turn's rows: a run of rows that carry it, found from its row (or its image row).
    const runs = [];
    for (const k of keys) {
      const at = this.baseIndex.get(k) ?? this.baseIndex.get(`imgs:${k}`);
      const r = at != null ? this.baseRows[at] : null;
      // Not shown (an agent turn while they are hidden): its parts draw nothing.
      if (!r) { if (this.findTurn(k)) continue; return false; }
      if (!r.turn || r.si == null || !r.s) return false;
      let a = at;
      let z = at;
      while (a > 0 && this.baseRows[a - 1].turn === r.turn) a--;
      while (z + 1 < this.baseRows.length && this.baseRows[z + 1].turn === r.turn) z++;
      runs.push({ k, a, z, r });
    }
    runs.sort((x, y) => y.a - x.a);
    this.shapeStart();
    const stale = new Set(this.staleRows ?? []);
    let marks = b.marks;
    for (const { k, a, z, r } of runs) {
      const { turn, s, si } = r;
      const ti = s.turns[turn.n - 1] === turn ? turn.n - 1 : s.turns.indexOf(turn);
      if (ti < 0) return false;
      const out = [];
      this.buildStale = [];
      this.cachedH = new Map();
      this.cacheNew = [];
      this.turnRows({ kind: "turn", key: k, turn, s, si, last: Boolean(r.last), live: Boolean(r.live) }, ti, out, status, cg);
      const sizes = out.map((x, j) => this.cachedH.get(j) ?? this.height(x));
      for (const e of this.cacheNew) e.sizes = e.rows.map((_, j) => sizes[e.at + j]);
      const gone = z - a + 1;
      const d = out.length - gone;
      for (let i = a; i <= z; i++) this.baseIndex.delete(this.baseRows[i].key);
      this.baseRows.splice(a, gone, ...out);
      this.baseSizes.splice(a, gone, ...sizes);
      // The new rows, and every row after them when the count changed.
      const to = d === 0 ? a + out.length : this.baseRows.length;
      for (let i = a; i < to; i++) this.baseIndex.set(this.baseRows[i].key, i);
      // Rows that wait to be reshaped, and the places a later build can start, move with it.
      const moved = new Set();
      for (const i of stale) { if (i < a) moved.add(i); else if (i > z) moved.add(i + d); }
      for (const i of this.buildStale) moved.add(a + i);
      stale.clear();
      for (const i of moved) stale.add(i);
      if (d) marks = marks.map((m) => (m.row > a || (m.dayRow != null && m.dayRow > a) ? { ...m, row: m.row > a ? m.row + d : m.row, dayRow: m.dayRow != null && m.dayRow > a ? m.dayRow + d : m.dayRow } : m));
    }
    this.rowJob = null;
    this.staleRows = [...stale].sort((x, y) => x - y);
    this.buildStale = this.staleRows;
    this.rowBuild = { ...b, rest, marks, sets: now.map((x) => new Set(x)), callVer: this.callVer ?? 0 };
    this.rowsKey = key;
    this.fitKey = null;
    this.probeList();
    if (this.reselect || this.selHidden()) this.reselectVisible();
    this.latestAfterBuild();
    return true;
  }

  // A closed turn's rows from the last build that made them, while nothing they depend on
  // has changed: the turn (its version, turn.v, which the reader moves on every event that
  // touches it), what every closed row depends on (closedLook), its session's place, and the
  // probe's measures of its parts (keptFor). A click that opens one turn, or a new line
  // in the newest, then builds only the turns that changed, not every row of the session
  // (step 3 of the session model). Open, running and last turns are always built: they
  // ask for calls and editors as they build.
  closedCached(item, out, cg) {
    const { key, turn, s, si } = item;
    const sig = this.closedSig(key, turn, si, cg);
    const tc = this.keptFor().rows;
    const c = tc.get(key);
    // A turn sent back to be shaped again (shapeKey cleared) is built again too.
    if (c && c.turn === turn && c.s === s && c.sig === sig && c.sizes && turn.shapeKey != null && c.shape === this.keptShape(turn)) {
      for (let j = 0; j < c.rows.length; j++) { this.cachedH.set(out.length, c.sizes[j]); out.push(c.rows[j]); }
      // Kept for another width than the turn's last shape: that shape is the turn's again, and
      // the newest kept, as shape() would make it.
      const look = this.shapeLook();
      if (turn.shapeFast.look !== look) this.recallShape(turn, look);
      return;
    }
    const at = out.length;
    this.closedRows(item, out);
    // A row given an old shape for now is reshaped in place later: not kept.
    if (this.shapeStale) { tc.delete(key); return; }
    const e = { turn, s, sig, rows: out.slice(at), sizes: null, at, shape: turn.shapeMemo };
    tc.set(key, e);
    this.cacheNew.push(e);
  }
  closedSig(key, turn, si, cg) { return `${cg}|${si}|${turn.v}|${this.keptFor().meas.get(key) ?? 0}|${turn.agent ? (this.foldState({ key, turn, si }) ?? "") : ""}`; }
  // Closed turns' kept rows (closedCached) and how often the probe has changed a measure of
  // each turn's parts since (closedSig), per layout of the parts (sigBase: the width, zoom,
  // font and text size), for the last WIDTHS_KEPT of them, the last used last. A drag back to
  // a width seen before builds every closed turn from what was kept for it.
  keptFor(base = this.sigBase()) {
    const all = (this.keptBases ??= new Map());
    let k = all.get(base);
    if (k) {
      if (this.keptLast !== base) { all.delete(base); all.set(base, k); this.keptLast = base; }
      return k;
    }
    k = { rows: new Map(), meas: new Map() };
    all.set(base, k);
    this.keptLast = base;
    if (all.size > WIDTHS_KEPT) all.delete(all.keys().next().value);
    return k;
  }
  // Whether the rows as built can be kept per turn: not while a search, the outline or the
  // Pinned view shapes them.
  closedLookNow() { return this.view === "pinned" || this.outlined() || this.filterText() ? null : this.closedLook(); }
  closedLook() {
    // The pane's width and the rail set how far a wide table may grow (tableExtra).
    return `${this.shapeLook()}|${this.sigBase()}|${this.imgVer ?? 0}|${this.measEpoch ?? 0}|${Math.round(this.pw())}|${this.railShown() ? 1 : 0}|${this.linksVer}|${this.sendersVer}|${this.repoSig()}`;
  }

  closedRows(item, out) {
    const shape = this.shape(item.turn);
    const fold = this.foldState(item);
    if (this.shapeStale) (this.buildStale ??= []).push(out.length + (fold || shape.thumbs ? 1 : 0));
    // An agent turn with a reply while agent messages are hidden: its one line, then the row
    // without the sender and, while folded, without the message.
    if (fold) { out.push({ ...item, kind: "afold", key: `af:${item.key}`, turnKey: item.key, live: false, fold }); out.push({ ...item, shape, fold }); return; }
    if (!shape.thumbs) { out.push({ ...item, shape }); return; }
    out.push({ ...item, kind: "wtop", key: `imgs:${item.key}`, turnKey: item.key, live: false });
    out.push({ ...item, shape, split: true });
  }

  // An agent turn shown, while agent messages are hidden, for its reply (ui.js agentReplied):
  // "folded" (its message is one line over the reply) or "shown" (a press on that line drew
  // the message under it: `full` holds "<turn key>:am"); null for every other turn. While a
  // search is on, the message is drawn whole, so its matches can be seen.
  foldState(item) {
    // A task notification's turn has no message to show: its line always stands in for it.
    if (noticeTurn(item.turn) && !item.live) return "folded";
    if (this.prefs.agentTurns || !item.turn?.agent || item.live || this.filterText()) return null;
    const s = this.sessions[item.si];
    if (!s || !agentReplied(item.turn, s.turns)) return null;
    return this.full.has(`${item.key}:am`) ? "shown" : "folded";
  }
  // What a fold leaves out of the closed row: its sender line and, folded, the message and
  // the strip under it (ui.js rowHeight). The row then starts a gap above the line.
  foldCut(r) {
    if (!r.fold || r.kind !== "turn") return 0;
    if (r.fold === "shown") return ROW.PAD_T + ROW.META;
    const sh = r.shape;
    return ROW.PAD_T + ROW.META + ROW.GAP + (sh.thumbs ? thumbSize(this.width, this.prefs.textSize, this.chars()) + ROW.GAP : 0)
      + 2 * ROW.BUBBLE_PY + this.rt().line * sh.p + (sh.pMore ? ROW.MORE : 0) + ROW.GAP + ROW.META;
  }
  // What a running task notification's turn leaves out of its row (workingRow): the bubble,
  // the strip under it and the gap after them. Its sender line is its quiet line.
  noticeCut(r) {
    if (r.kind !== "wrow" || !noticeTurn(r.turn)) return 0;
    const sh = r.shape;
    return 2 * ROW.BUBBLE_PY + this.rt().line * sh.p + (sh.pMore ? ROW.MORE : 0) + ROW.GAP + ROW.META + ROW.GAP;
  }
  // A task notification's turn's one quiet line, where a bubble would be: the bell and
  // "Background task finished" in the folded line's colours, with no chevron.
  quietLine(t, turn) {
    return h_flex().h(ROW.META).gap(5).items_center().text_size(11.5).min_w(0)
      .child(svg(ICON(senderIcon(turn.sender))).size(12).flex_none().text_color(t.dim))
      .child(this.labelView(senderParts(turn.sender, this.width), t.muted, this.labelRoom(turn, replyWidth(this.width)), false));
  }
  // The folded message's one line: the sender's icon, "helper-a · agent message" and a
  // chevron, quiet; a press shows the message, or folds it again. A task notification's
  // turn has no chevron: it has no message to show.
  foldLine(t, r) {
    const { turn } = r;
    const tip = this.ruleTip(turn);
    const line = h_flex().h(ROW.META).gap(5).items_center().text_size(11.5).min_w(0).cursor_pointer()
      .when(Boolean(tip), (el) => el.id("th-rule").tooltip(tip))
      .child(svg(ICON(senderIcon(turn.sender))).size(12).flex_none().text_color(t.dim))
      .child(this.labelView(senderParts(turn.sender, this.width), t.muted, this.labelRoom(turn, replyWidth(this.width)), false))
      .when(!noticeTurn(turn), (el) => el.child(svg(ICON(r.fold === "shown" ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim)));
    if (r.open) return h_flex().px(ROW.PAD_X).min_w(0).child(line);
    return this.rowFrame(t, false, false, false, [line], ROW.PAD_T, 0);
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
      const open = this.groupIsOpen(`${key}:${i}`, live && Boolean(st.agent));
      if (open && read) this.wantCalls(item.si, st.ids);
      // A group of one call, once open, is that call's own row.
      const one = open && read && st.count === 1;
      if (!one) out.push({ ...item, live: false, kind: "grp", key: `gp:${key}:${i}`, gi: i, step: st, now, read, open });
      if (!open) return;
      st.calls.forEach((name, j) => {
        const id = read ? st.ids[j] : null;
        out.push({ ...item, live: false, kind: "call", key: `cl:${key}:${i}:${j}`, name, id, gi: i, ci: j, one, now: one && now });
        if (!id || !this.callOpen.has(`${key}:${i}:${j}`)) return;
        const c = this.callEntry(item.si, id);
        const all = this.callAll.has(`${key}:${i}:${j}`);
        // The running group's newest call with no result yet is still running.
        const going = now && j === st.calls.length - 1 && c?.st === "ok" && c.out == null;
        // Its lines wrap; the box shows OUT.SHOW rows, then Show all (oa:) shows the rest in
        // place, or, for an output longer than the panel holds (OUT.MAX lines), opens all of
        // it in the output viewer.
        const box = outLines(c?.out, true, c?.lines);
        const rows = box.lines.length ? Math.max(1, codeRows(box.lines.join("\n"), this.outPer())) : 1;
        const more = rows > OUT.SHOW;
        out.push({ ...item, live: false, kind: "cout", key: `co:${key}:${i}:${j}`, id, gi: i, ci: j, all, going, name,
          st: c?.st ?? "wait", box, rows, shown: all && more && !box.cut ? rows : Math.min(OUT.SHOW, rows) });
        if (box.cut) out.push({ ...item, live: false, kind: "oall", key: `oa:${key}:${i}:${j}`, id, name, view: true, total: box.total });
        else if (more) out.push({ ...item, live: false, kind: "oall", key: `oa:${key}:${i}:${j}`, id, name, all, left: rows - OUT.SHOW });
      });
      if (st.count > st.calls.length) out.push({ ...item, live: false, kind: "call", key: `cl:${key}:${i}:more`, more: st.count - st.calls.length });
    });
  }
  // A call row's parts: its entry, subagent, time, model pill (a subagent on another model
  // than the turn's), and what it ran wrapped at the room the rest leave it (at 12 px mono),
  // at most CALL_LINES lines.
  callShape(r) {
    const c = this.callEntry(r.si, r.id);
    const a = this.agentOf(r.si, r.id, r.name);
    const time = this.callTook(r.name, c, a);
    const pill = a?.m && shortModel(a.m) !== shortModel(r.turn?.model) ? shortModel(a.m) : null;
    const gaps = 6 * (1 + (pill ? 1 : 0) + (time ? 1 : 0) + (r.id ? 1 : 0));
    const room = this.prose() - (r.one ? 0 : 18) - 12 - gaps - (pill ? pill.length * 6 + 10 : 0) - (time ? Math.ceil(time.length * 6.2) : 0) - (r.id ? 12 : 0);
    const cap = wrapCap(this.short(callText(r.name, c?.input)), Math.max(8, Math.floor(room / (12 * MONO_EM))), CALL_LINES);
    return { c, a, time, pill, text: cap.text, rows: cap.rows };
  }
  lineIsOpen(key, live) { return this.lineTouched.has(key) ? this.lineOpen.has(key) : live; }
  isLiveKey(key) { const i = this.baseIndex?.get(key); return i != null && Boolean(this.baseRows?.[i]?.live); }
  // A step group is open by the person's choice, else when it is a running turn's subagents.
  groupIsOpen(g, auto) { return this.groupTouched.has(g) ? this.groupOpen.has(g) : auto; }
  groupShown(k, i, turn, live) {
    const st = turn?.steps?.[i];
    return st?.k === "group" && this.groupIsOpen(`${k}:${i}`, live && Boolean(st.agent));
  }
  setGroup(g, open) {
    if (open) this.groupOpen.add(g); else this.groupOpen.delete(g);
    this.groupTouched.add(g);
  }

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
          const r = await exec("sh", [SCRIPT("core/calls.sh"), ...(job.tail ? ["--tail"] : []), job.file, harnessOfFile(job.file), ...job.ids]);
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
    const groups = new Set(this.groupOpen);
    for (const r of this.baseRows ?? []) if (r.live && r.turn) (r.turn.steps ?? []).forEach((st, i) => { if (st.agent) groups.add(`${r.key}:${i}`); });
    for (const g of groups) {
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
    const live = this.isLiveKey(k);
    const out = [];
    (turn.steps ?? []).forEach((st, i) => {
      if (!this.groupShown(k, i, turn, live) || !this.readsCalls(si, st)) return;
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
    const groups = (turn.steps ?? []).map((st, i) => (st.k === "group" ? i : null)).filter((i) => i != null);
    if (groups.some((i) => !this.groupShown(k, i, turn, live))) { for (const i of groups) this.setGroup(`${k}:${i}`, true); cx.notify(); return true; }
    for (const c of this.openCalls(k, turn)) this.callOpen.add(c);
    cx.notify();
    return true;
  }
  shallower(cx) {
    const k = this.sel;
    const turn = k ? this.findTurn(k) : null;
    if (!turn) return false;
    const live = this.isLiveKey(k);
    const calls = [...this.callOpen].filter((c) => c.startsWith(`${k}:`) && this.groupShown(k, Number(c.split(":")[2]), turn, live));
    if (calls.length && this.lineIsOpen(k, live)) { for (const c of calls) { this.callOpen.delete(c); this.callAll.delete(c); } cx.notify(); return true; }
    const groups = (turn.steps ?? []).map((_, i) => i).filter((i) => this.groupShown(k, i, turn, live));
    if (groups.length && this.lineIsOpen(k, live)) { for (const i of groups) this.setGroup(`${k}:${i}`, false); cx.notify(); return true; }
    if (this.lineIsOpen(k, live) && (live || this.open.has(k))) { this.toggleLine(k, live); cx.notify(); return true; }
    if (!live && this.open.has(k)) { this.toggle(k, cx); return true; }
    return false;
  }

  // The Pinned view: the pinned turns oldest first (the order of the keys 1 to 7). A closed
  // pin is a compact row (pinRow: its digit, number, time, two lines of the prompt and one of
  // the reply, and its unpin control), so seven fit in the column; an open one is the card,
  // as in the list. A row
  // shows only its time, so a day header goes above the first pin of each day.
  pinnedRows(status) {
    const L = this.pinnedList();
    if (!L.length) return [{ kind: "note", key: "pins:none", text: "No pins yet. Select a turn in the list and press p to pin it. Pins stay with this session, and 1 to 7 bring you back to each." }];
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
    // With the Trajectory open on the right the column splits off it, so the row is the Chat,
    // the Trajectory, then the column, whichever opened first. A bottom one is not in the row.
    // (TRD-24 PR 3: v does nothing while a dock move is under way.)
    const traj = this.trajRightOpen();
    // A close's weights under way: the panes it left to px at their targets first, before the
    // fit reads the widths the close is passing through. With no record left the column's
    // opening has no room to land with: the row stays at px.
    const back = this.splitAsk ? null : this.rowCancelClose(cx, "the column opened during a close");
    const want = pinColumn(this.pw(), this.keptPinWidth());
    const fit = traj ? this.rowPinFit(me, traj, want) : this.pinKeep(me, want);
    const px = fit?.col ?? null;
    if (!me || !px) {
      if (auto) return false;
      this.setView("pinned");
      // Wide enough, but the terminals would go under their keep (pinKeep).
      if (me) this.say(this.pw() >= PIN_SPLIT_MIN ? "Pinned shows here: the row has no room for the Pinned column" : `Pinned shows here: the Pinned column needs Threads ${PIN_SPLIT_MIN} px wide`, "pin", cx, 3500);
      return true;
    }
    if (this.splitAsk) return true;
    // The row on weights goes to px where it is (the split takes its room from the terminals).
    if (fit.T != null) this.rowPx(cx, null);
    // With the Trajectory open, the px the Chat gives so the terminals keep their 200 px come
    // back to it when the column closes (autoPinned, with the Chat's width from before).
    const was = back ?? this.chatAt(Math.round(this.pw()) + PANE_FRAME);
    this.pinChatBack = traj && fit.chat != null && fit.chat < was ? { px: was } : null;
    // The Chat's px: the fit's, else the close's target (its measure may be the close's), else
    // the width a close last sent it back to when it is within 3 px of that (chatAt).
    this.pinPx(me, fit.chat ?? back ?? (this.chatHome ? this.chatAt(Math.round(this.pw()) + PANE_FRAME) : null));
    // The row as this pane knew it: the column's first weight lands at its width (pairBegin).
    if (fit.R > 0 && !traj) {
      const put = () => setShared(PAIR_KEY, { ...(shared(PAIR_KEY) ?? {}), [this.terminal]: { S: fit.S, R: fit.R } });
      if (cx?.timer) cx.timer.after(0, put);
      else put();
    }
    // With the row's room known, the column goes on weights with the others once it holds its
    // px (rowPlan, from settleSplit).
    const row = fit.T != null ? { T: fit.T, S: fit.S, m: fit.m, chat: fit.chat ?? fit.m, traj: fit.traj, trajPane: traj.pane } : null;
    this.splitAsk = { before: panes().map((p) => p.pane), px, back: auto ? me.pane : null, until: Date.now() + 4000, row };
    run("pane.split", { pane: traj ? traj.pane : me.pane, direction: "right", mod: MOD, props: { ...(props() ?? {}), view: "pinned" } });
    return true;
  }
  // The column's opening with the Trajectory open. With the row on weights the terminals hold
  // k S px, so the column keeps their 200 px each as pinKeep does (ui.js pinFit: the terminals
  // give, then the Chat, then the column; the Trajectory keeps its width). With the row at px
  // its room is not known: the width as asked, as before. { chat, col, T, S, m, traj }, or null
  // with no room.
  rowPinFit(me, traj, px) {
    if (!me || !px) return null;
    const ent = this.rowNow();
    const n = ent?.k > 0 && ent.S > 0 ? this.rowWidths({ chat: me.pane, traj: traj.pane }) : null;
    if (!n) return { chat: null, col: px };
    const T = ent.k * ent.S - SPLIT_GAP;
    const others = panes().filter((p) => p.tab === me.tab && p.pane !== me.pane && p.pane !== traj.pane).length;
    const m = n[me.pane];
    const f = pinFit(m, px, T, TERM_KEEP * others);
    // The Chat's give in whole px, rounded up so the terminals keep theirs.
    return f ? { chat: f.chat === m ? null : Math.floor(f.chat), col: f.col, T, S: ent.S, m, traj: n[traj.pane] } : null;
  }

  // Before a split off this pane (the Pinned column, the Trajectory): this pane at a px width,
  // so the new pane's room comes from the terminal. A split takes half its target's weight,
  // so at a weight this pane would lose half its room. A px of its own still applying
  // (sizeTo), or the width a probe under way keeps, is the width it keeps, not a weight's
  // trial width. Returns that px.
  pinPx(me, at = null) {
    const px = at ?? this.weighAfter?.px ?? this.weighing?.n0 ?? Math.round(this.pw()) + PANE_FRAME;
    run("layout.resize", { id: me.pane, px });
    this.weighing = null;
    this.weighAfter = null;
    this.weightNow = null;
    return px;
  }

  // Once the split has applied: the new pane goes in the Pinned map and gets the column's
  // width. Opened by a pin or by Threads opening, the keyboard goes back to Threads. The
  // Trajectory's pane first takes the row's room, to see how much there is (settleTraj).
  settleSplit(cx) {
    const a = this.splitAsk;
    if (!a) return;
    if (a.made) { this.settleTraj(a, cx); return; }
    const made = panes().find((p) => p.mod === MOD && !a.before.includes(p.pane));
    if (made && a.map === TRAJ_MAP_KEY) {
      remember(this.terminal, made.pane, a.map);
      this.splitAsk = { ...a, made: made.pane, probeAt: Date.now(), seen: null };
      // The width it takes to measure the room is not the owner's: held from the probe's start
      // to past its longest wait, however late the pane came.
      this.holdTrajWidth(ROOM_WAIT + TRAJ_W_HOLD);
      run("layout.resize", { id: made.pane, weight: ROOM_WEIGHT });
      this.settleTraj(this.splitAsk, cx);
    } else if (made) {
      this.splitAsk = null;
      remember(this.terminal, made.pane, a.map ?? PIN_MAP_KEY);
      run("layout.resize", { id: made.pane, px: a.px });
      if (a.back) run("pane.focus", { pane: a.back });
      // Split off the Trajectory with the row's room known: the column onto a weight once it
      // holds its px, the Chat and the Trajectory held where they are. Its weights share the
      // terminals' room and its own: T, and what the Chat gave.
      const me = this.me();
      if (a.row && me) this.rowPlan = { probe: made.pane, t: a.px, S: a.row.S, Rr: a.row.T + (a.row.m - a.row.chat), held: { [me.pane]: a.row.chat, [a.row.trajPane]: a.row.traj }, at: Date.now() };
    } else if (Date.now() > a.until) { this.splitAsk = null; this.toWeight(); }
  }

  // The Trajectory split's width. Herdr gives no window size, and a pane the Chat holds at a
  // px width keeps it when a split beside it asks for more than the terminal has: the row
  // then runs past the window's edge, and each pane still measures its full width. So the
  // new pane first takes the row's room by weight (ROOM_WEIGHT against the terminal's 1 or
  // so), and the width it reports once it holds still is that room: the row less the Chat and
  // any pane of a fixed width. trajFit then says what the Trajectory and the Chat get: the
  // other panes give first, down to TERM_KEEP each (trajKeep), then the Chat, then the
  // Trajectory. With too little room even then, the new pane closes and the Trajectory shows
  // in the Chat's pane, as under TRAJ_SPLIT_MIN, so no pane is squeezed for it. A Chat
  // narrowed for it gets its width back when the Trajectory closes (trajGiveBack), unless w
  // resized the Chat while it was open.
  settleTraj(a, cx) {
    // Closed while it was measured: nothing to fit, and the Chat stays as it is.
    if (!panes().some((p) => p.pane === a.made)) { this.splitAsk = null; return; }
    const at = Date.now();
    const w = shared(WIDTH_KEY)?.[a.made];
    const late = at - a.probeAt > ROOM_WAIT;
    if (Number.isFinite(w) && a.seen?.w !== w) a.seen = { w, at };
    const still = a.seen && at - a.seen.at >= ROOM_STILL && at - a.probeAt >= ROOM_FIRST;
    if (!still && !late) {
      if (cx?.timer && !this.roomTimer) { this.roomTimer = true; cx.timer.after(50, (cx) => { this.roomTimer = false; this.settleSplit(cx); }); }
      return;
    }
    this.splitAsk = null;
    // The probe's width may be measured after this: held until the fitted width is in.
    this.holdTrajWidth(TRAJ_W_HOLD);
    // Not measured in time: the width asked for, as before.
    if (!a.seen) { run("layout.resize", { id: a.made, px: a.px }); return; }
    const me = this.me();
    const fit = trajFit(a.chat, a.px, a.seen.w + PANE_FRAME, this.trajKeep(me, a.made));
    if (!fit) {
      // At a px it gives no weight to its neighbour as it closes (Herdr gives a closed pane's
      // weight to the pane before it, the Chat).
      run("layout.resize", { id: a.made, px: TRAJ_MIN });
      run("pane.close", { pane: a.made });
      this.trajOpen = false;
      // The Chat at the width it had before the split, which may have taken some of it, and
      // then a weight that keeps it (sizeTo), as after any px of its own.
      if (me) { this.sizeTo(a.chat); run("pane.focus", { pane: me.pane }); }
      this.enterTraj();
      return;
    }
    run("layout.resize", { id: a.made, px: fit.traj });
    if (fit.chat < a.chat && me) run("layout.resize", { id: me.pane, px: fit.chat });
    // The Chat's width from before the Trajectory, whether it gave the Trajectory room or only
    // the px its landing may take: the width it goes back to when the Trajectory closes.
    if (me) this.trajChatBack = { px: this.chatAt(a.chat), pane: a.made };
    // The row onto weights once the Trajectory holds its width (rowPoll). The room probe is the
    // first point of the line that lands it: at ROOM_WEIGHT it measured nearly all the room the
    // weights share, and the Chat's narrowing adds to that room what it gave.
    const pin = this.pinnedPaneOpen();
    const pw = pin ? shared(WIDTH_KEY)?.[pin.pane] : null;
    if (me && (!pin || Number.isFinite(pw))) {
      const held = { [me.pane]: fit.chat, ...(pin ? { [pin.pane]: Math.round(pw) + PANE_FRAME } : {}) };
      this.rowPlan = { probe: a.made, t: fit.traj, seed: [ROOM_WEIGHT, a.seen.w + PANE_FRAME + (a.chat - fit.chat)], held, at: Date.now() };
    }
  }
  // What the row's other panes keep beside the Trajectory: TERM_KEEP each. Herdr does not say
  // where a pane sits, so every other pane in the Chat's tab counts (a pane above or below
  // the row too, which only makes the Trajectory narrower), less the Chat, the new pane and
  // the Chat's Pinned column, which is at a px of its own.
  trajKeep(me, made) {
    if (!me) return 0;
    const pin = this.pinnedPaneOpen()?.pane;
    return TERM_KEEP * panes().filter((p) => p.tab === me.tab && p.pane !== me.pane && p.pane !== made && p.pane !== pin).length;
  }
  // The Trajectory pane's widths for the next ms, at least, are the split's own, not the
  // owner's (shareWidth). A hold already longer stands.
  holdTrajWidth(ms) {
    const kept = shared(TRAJ_W_KEY) ?? {};
    const hold = Math.max(kept.hold ?? 0, Date.now() + ms);
    if (hold !== kept.hold) setShared(TRAJ_W_KEY, { ...kept, hold });
  }
  // The Trajectory pane closed: a Chat narrowed to make room for it gets its width back,
  // unless w fitted the Chat since (fitToReading). Either
  // way the Chat goes back to a weight that keeps its width (sizeTo, or toWeight once the row
  // settles): it is at a px only while the Trajectory is open.
  trajGiveBack(cx) {
    // A bottom pane took no width from the Chat: its close gives none back.
    const open = Boolean(this.trajRightOpen());
    const closed = this.trajWasOpen && !open;
    this.trajWasOpen = open;
    const back = this.trajChatBack;
    // Its pane gone, the width back is used once, by whichever way the close goes below (back).
    const gone = back && !panes().some((p) => p.pane === back.pane);
    if (gone) this.trajChatBack = null;
    const side = !this.pinnedPane && !this.trajPane;
    // The column's give was against the row with the Trajectory: gone with it.
    if (closed) this.pinChatBack = null;
    // The column's close still under way: both side panes closed together (rowCloseBoth).
    const closing = closed && side ? this.rowClosing() : null;
    if (closing && this.me()) {
      const px = gone ? back.px : closing.targets[this.me().pane];
      this.rowCloseBoth(px, cx);
      return;
    }
    // The row on weights: the Chat gets the Trajectory's weight (Herdr gives a closed pane's to
    // the pane before it), and rowClose asks the weights that keep each pane left, the Chat at
    // the width it had before the split narrowed it.
    const ent = this.rowNow();
    if (closed && side && ent?.k > 0 && ent.ids?.traj && this.me()) {
      const targets = Object.fromEntries(Object.values(ent.ids).filter((id) => id !== ent.ids.traj).map((id) => [id, ent.n[id]]));
      if (back?.pane === ent.ids.traj) targets[ent.ids.chat] = this.chatHome = back.px;
      if (this.rowClose(ent.ids.traj, targets, cx)) return;
    }
    if (gone) {
      // Within 1 px of it already: only the weight below.
      const at = this.paneW != null ? Math.round(this.paneW) + PANE_FRAME : null;
      if (this.me() && !(at != null && Math.abs(at - back.px) <= 1)) { this.sizeTo(back.px); return; }
    }
    if (closed) this.weighAt = Date.now() + 500;
  }

  // This pane's width, for its partner (resizeColumn). In the Pinned column, a width that
  // changes after the pane has settled (1.5 s from its first measure, past the split's own
  // resize) is the owner's: kept for the next time the column opens (keptPinWidth).
  shareWidth() {
    const me = this.me();
    if (!me || this.paneW == null) return;
    const map = shared(WIDTH_KEY) ?? {};
    if (Math.abs((map[me.pane] ?? -9) - this.paneW) > 1) setShared(WIDTH_KEY, { ...map, [me.pane]: Math.round(this.paneW) });
    // The Pinned column's and the Trajectory pane's width, each kept in its own key.
    // A bottom Trajectory's width is the row's, not one the owner set: it keeps none.
    const wKey = this.pinnedPane ? PIN_W_KEY : this.trajPane && this.trajDock !== "bottom" ? TRAJ_W_KEY : null;
    if (!wKey) return;
    const now = Date.now();
    this.firstSizeAt ??= now;
    // The column closed beside the Trajectory: with the row on weights the Trajectory takes its
    // weight for a moment, then the close's weights and the divider's room move it again. Those
    // widths are the close's, not the owner's. colId: the column last seen beside it (trajFrame).
    if (this.trajPane) {
      const col = this.pinnedPaneOpen();
      if (col) this.colId = col.pane;
      else if (this.colId && !panes().some((p) => p.pane === this.colId)) { this.colId = null; this.holdTrajWidth(3000); }
    }
    const kept = shared(wKey) ?? {};
    if (now - this.firstSizeAt < 1500 || now < (kept.hold ?? 0)) return;
    const px = Math.round(this.paneW) + PANE_FRAME;
    if (kept.px !== px) setShared(wKey, { px });
  }
  keptPinWidth() {
    const px = shared(PIN_W_KEY)?.px;
    return Number.isFinite(px) && px > 0 ? px : null;
  }
  keptTrajWidth() {
    const px = shared(TRAJ_W_KEY)?.px;
    return Number.isFinite(px) && px > 0 ? px : null;
  }

  // - and =: a pane 40 px narrower or wider against the pane on its left, the other way, so
  // the terminal stays put (ui.js columnResize says why a drag on a px divider cannot do
  // this). In the Chat, its right neighbour steps: the Trajectory when it is open, else the
  // Pinned column. In the Trajectory, the Trajectory against the Chat; in the column, the
  // column against the Trajectory when that is open (down to TRAJ_MIN), else the Chat. At the
  // Trajectory's limit it says nothing (no notice on a key in the Trajectory).
  resizeColumn(d, cx) {
    const trajOpen = this.trajPane ? this.me() : this.trajRightOpen();
    let col;
    let main;
    let traj = false;
    let mainMin;
    if (this.trajPane) { col = this.me(); main = this.mainPane(); traj = true; }
    else if (this.pinnedPane) { col = this.me(); main = trajOpen ?? this.mainPane(); if (trajOpen) mainMin = TRAJ_MIN; }
    else if (trajOpen) { col = trajOpen; main = this.me(); traj = true; }
    else { col = this.pinnedPaneOpen(); main = this.me(); }
    if (!col || !main) return false;
    const w = shared(WIDTH_KEY) ?? {};
    // Herdr's px size for a pane is its measured width plus the pane's 1 px frame each side.
    const next = columnResize(w[col.pane] + PANE_FRAME, w[main.pane] + PANE_FRAME, d, traj ? TRAJ_MAX : 640, mainMin);
    // At the Trajectory's limit, or a key that would take it further under its floor: nothing,
    // and no notice.
    if (!next && (traj || mainMin === TRAJ_MIN)) return true;
    if (!next) { this.say(d > 0 ? "The Pinned column is as wide as it goes" : "The Pinned column is as narrow as it goes", "info", cx); return true; }
    // The pair, or the row with the Trajectory open, on weights: weight moves from one to the
    // other with their sum held, so the terminals keep theirs (k, the px a unit of weight
    // gets, is the same for all). The Chat's pane follows it as a divider (rowTrack).
    const row = trajOpen ? this.rowNow() : null;
    const onRow = row?.k > 0 && Object.values(row.ids ?? {}).includes(col.pane) && Object.values(row.ids ?? {}).includes(main.pane);
    const pair = trajOpen ? null : shared(PAIR_KEY)?.[this.terminal];
    if (onRow) {
      run("layout.resize", { id: col.pane, weight: Number((next.column / row.k).toPrecision(5)) });
      run("layout.resize", { id: main.pane, weight: Number((next.main / row.k).toPrecision(5)) });
      // Where every pane of the row should land, from the last key's still to come if there is
      // one: the Chat checks it (rowCheck).
      const base = row.want?.n ?? row.n;
      this.rowSave({ ...row, want: { n: { ...base, [col.pane]: next.column, [main.pane]: next.main }, at: Date.now() } }, cx);
    } else if (pair?.k > 0) {
      run("layout.resize", { id: col.pane, weight: Number((next.column / pair.k).toPrecision(5)) });
      run("layout.resize", { id: main.pane, weight: Number((next.main / pair.k).toPrecision(5)) });
    } else {
      // Both at px, as before the pair is made (pairPoll makes it once they are still). A
      // probe's kept px no longer holds.
      run("layout.resize", { id: col.pane, px: next.column });
      run("layout.resize", { id: main.pane, px: next.main });
      if (pair?.probe) { const rest = { ...pair }; delete rest.probe; setShared(PAIR_KEY, { ...(shared(PAIR_KEY) ?? {}), [this.terminal]: rest }); }
    }
    setShared(WIDTH_KEY, { ...w, [col.pane]: next.column - PANE_FRAME, [main.pane]: next.main - PANE_FRAME });
    setShared(traj ? TRAJ_W_KEY : PIN_W_KEY, { px: next.column });
    return true;
  }

  // The column's opening width with the terminals' keep (ui.js pinFit), when the row's room
  // can be known: this pane on a weight it set (weightNow) and the terminals' weights S known,
  // from its weight line or from the last pair. Then its width n at weight w says the room R
  // the weights share, n (w + S) / w, and the terminals have that less this pane. Else the
  // width as asked. { chat (this pane's px, or null to keep it), col, R, S }, or null with no
  // column.
  pinKeep(me, px) {
    if (!me || !px) return null;
    const S = this.weighLine ? this.weighLine.b / this.weighLine.a : shared(PAIR_KEY)?.[this.terminal]?.S;
    const w = this.weightNow;
    if (!(S > 0) || !(w > 0) || this.paneW == null) return { chat: null, col: px };
    const m = Math.round(this.paneW) + PANE_FRAME;
    const under = this.trajBottomId();
    const others = panes().filter((p) => p.tab === me.tab && p.pane !== me.pane && p.pane !== under).length;
    const R = Math.round((m * (w + S)) / w);
    const f = pinFit(m, px, R - m, TERM_KEEP * others);
    return f ? { chat: f.chat === m ? null : f.chat, col: f.col, R, S } : null;
  }
  // Whether the pair and the row may go on weights on this Herdr (ui.js weightHerdr), read
  // when the pane starts and again whenever the version read differs from the last. A version
  // not listed (or none) keeps them at px, with one line in the debug log for each version
  // seen; a pair or a row already on weights, or a probe or landing under way, goes back to
  // px where it is.
  weightsGate(cx) {
    let v = null;
    try { v = updates().app.version; } catch { v = null; }
    if (typeof v !== "string") v = null;
    if (this.weightsOk != null && v === this.herdrSeen) return;
    this.herdrSeen = v;
    this.weightsOk = weightHerdr(v);
    if (this.weightsOk) return;
    console.log(`agent-threads: Herdr ${JSON.stringify(v)} is not one whose drag is checked to keep weight units: the Pinned pair and the row stay at px`);
    if (!this.pinnedPane && !this.trajPane) {
      this.rowCloseDue = null;
      this.rowCloseFix = null;
      this.rowPx(cx, `Herdr ${JSON.stringify(v)} is not one whose drag keeps weight units`);
      return;
    }
    if (!this.pinnedPane) return;
    const main = this.mainPane();
    const w = shared(WIDTH_KEY) ?? {};
    const was = shared(PAIR_KEY)?.[this.terminal];
    const g = this.pairing;
    this.pairing = null;
    if (!(was?.k > 0) && !g) return;
    if (g && !(was?.k > 0)) { const me = this.me(); if (me) run("layout.resize", { id: me.pane, px: was?.probe > 0 ? was.probe : g.p }); }
    else this.pairPx(0);
    if (main && Number.isFinite(w[main.pane])) run("layout.resize", { id: main.pane, px: Math.round(w[main.pane]) + PANE_FRAME });
    if (was?.probe) this.pairPatch((r) => { const rest = { ...r }; delete rest.probe; return rest; }, cx);
  }
  // The pair back to px, as the Trajectory's split and the px resizes (w, - and = with no
  // pair) need: the column at its width (when send), and no new pair for hold ms. The Chat's
  // px is the caller's.
  pairPx(hold, send = true) {
    const col = this.pinnedPane ? this.me() : this.pinnedPaneOpen();
    if (!col) return;
    const w = shared(WIDTH_KEY) ?? {};
    const map = shared(PAIR_KEY) ?? {};
    const was = map[this.terminal];
    // On weights, the column at its width; on a probe's trial weight (or left there by a
    // dropped probe), at the px it had before the probe.
    const px = was?.k > 0 && Number.isFinite(w[col.pane]) ? Math.round(w[col.pane]) + PANE_FRAME : was?.probe > 0 ? was.probe : null;
    if (send && px) run("layout.resize", { id: col.pane, px });
    // The row's weight room as the pair last had it (the terminals' kS and the two widths), so
    // the pair made again after the hold starts from the terminals' width (pairBegin).
    const R = was?.k > 0 ? Math.round(was.k * (was.S ?? 0) + was.m + was.p) : was?.R ?? null;
    setShared(PAIR_KEY, { ...map, [this.terminal]: { S: was?.S ?? null, R, hold: Date.now() + hold } });
  }
  // In the column's pane: the pair onto weights once the split has settled and both widths
  // are still, and its weights kept up to date after that. Not while the Trajectory is open
  // (its fit works in px), zoomed, or held (pairPx).
  pairPoll(cx) {
    if (!this.pinnedPane || !this.weightsOk) return;
    const me = this.me();
    const main = this.mainPane();
    const w = shared(WIDTH_KEY) ?? {};
    if (!me || !main || this.paneW == null || !Number.isFinite(w[main.pane])) { this.pairing = null; return; }
    const now = Date.now();
    const m = Math.round(w[main.pane]) + PANE_FRAME;
    const p = Math.round(this.paneW) + PANE_FRAME;
    if (this.pairSeen?.m !== m) this.pairSeen = { m, at: now };
    const ent = shared(PAIR_KEY)?.[this.terminal] ?? null;
    // The Trajectory closing gives the Chat its width back (trajGiveBack): 1.5 s for that.
    if (this.trajRightOpen()) this.pairTrajAt = now;
    // The Trajectory open, or closed less than 1.5 s ago (pairTrajAt is set while it is open).
    const blocked = Boolean(me.zoomed || main.zoomed) || now < (ent?.hold ?? 0) || now - (this.pairTrajAt ?? -1e9) < 1500;
    if (this.pairing) { this.pairProbe(m, p, blocked, cx); return; }
    const still = now - (this.sizeAt ?? 0) >= PAIR_STILL_MS && now - this.pairSeen.at >= PAIR_STILL_MS;
    if (blocked || !still) return;
    if (ent?.k > 0) { this.pairTrack(ent, m, p, cx); return; }
    if (now - (this.firstSizeAt ?? now) < 1500 || (this.pairTries ?? 0) >= 3) return;
    this.pairBegin(me, main, m, p, ent, cx);
  }
  // The Chat at px m (where it is), and the column to a weight that lands it at its width p:
  // then the column and the other weight panes get the same px a unit of weight, p / w, and
  // the Chat's weight is m w / p. A mod cannot read a pane's size, so the other panes are
  // never resized; one at px keeps its px. The first weight comes from the row as the Chat
  // knew it when it opened the column (pinKeep: the weight room R and the others' weights S,
  // so the others have R - m - p), else from the last pair's S with the others about as wide
  // as the Chat; then toward p from the measures (ui.js weightLine). The Chat does not move.
  pairBegin(me, main, m, p, ent, cx) {
    const under = this.trajBottomId();
    const others = panes().filter((x) => x.tab === me.tab && x.pane !== me.pane && x.pane !== main.pane && x.pane !== under);
    this.pairTries = (this.pairTries ?? 0) + 1;
    // The column's px is kept in the record while it is on a trial weight, so the Trajectory
    // opening mid-probe puts it back at px from the Chat's pane (pairPx). After a dropped
    // probe the column's width follows its trial weight, so the px from before the first is
    // the one kept.
    this.pairPatch((rec) => ({ ...rec, probe: rec.probe > 0 ? rec.probe : p }), cx);
    // No terminal beside them: the two share the row in the ratio of their widths, one ask
    // each.
    if (!others.length) {
      this.pairing = { m, p, S: 0, tried: [], final: { wc: m, wp: p }, asked: Date.now() };
      run("layout.resize", { id: main.pane, weight: m });
      run("layout.resize", { id: me.pane, weight: p });
      return;
    }
    run("layout.resize", { id: main.pane, px: m });
    // The probe's widths are not the owner's (shareWidth). After the drawing pass, as the
    // record's writes (poll runs in render).
    const hold = Date.now() + 4000;
    const put = () => setShared(PIN_W_KEY, { ...(shared(PIN_W_KEY) ?? {}), hold });
    if (cx?.timer) cx.timer.after(0, put);
    else put();
    const S = ent?.S > 0 ? ent.S : 0.5;
    const d = ent?.R > 0 ? ent.R - m - p : 0;
    this.pairing = { m, p, S: ent?.S > 0 ? ent.S : null, tried: [], w: Number(((S * p) / (d > 0 ? d : m)).toPrecision(5)), asked: Date.now(), at: this.paneW };
    run("layout.resize", { id: me.pane, weight: this.pairing.w });
  }
  pairProbe(m, p, blocked, cx) {
    const g = this.pairing;
    const me = this.me();
    const main = this.mainPane();
    const now = Date.now();
    // The Chat moved or the Trajectory opened: the probe ends, and the column stays on its
    // trial weight; the next probe, once the row is still, starts from there. (No answer is a
    // measure after 400 ms, below, and the third ends the probe.)
    if (blocked || Math.abs(m - g.m) > 2) {
      this.pairing = null;
      if ((this.pairTries ?? 0) >= 3) this.pairGiveUp(g, m, cx);
      return;
    }
    if (g.final) {
      if (now - (this.sizeAt ?? 0) < PAIR_STILL_MS && now - g.asked < 1500) return;
      this.pairing = null;
      // Both landed: the pair is on weights. Else a fresh try once still (three at most).
      if (Math.abs(p - g.p) <= 2) {
        this.pairTries = 0;
        this.pairSave({ k: g.m / g.final.wc, m, p, S: g.S }, cx);
      } else if ((this.pairTries ?? 0) >= 3) this.pairGiveUp(g, m, cx);
      return;
    }
    if (Math.abs(this.paneW - g.at) <= 1 && now - g.asked < 400) return;
    const n = Math.round(this.paneW) + PANE_FRAME;
    g.tried.push([g.w, n]);
    const [a, b] = g.tried.slice(-2);
    const line = g.tried.length > 1 ? weightLine(a, b) : null;
    if (line) g.S = line.b / line.a;
    // Landed within 2 px of its width: the Chat's weight at the same px a unit. (On the rig a
    // column stayed 2 px short at two weights 0.4% apart, so 1 px never landed.) With no other
    // pane on a weight the column takes the rest of the row at any weight, the width it has,
    // so the first measure lands (and S stays unknown).
    if (Math.abs(n - g.p) <= 2) {
      g.final = { wc: Number(((g.w * g.m) / n).toPrecision(5)), wp: g.w };
      g.asked = now;
      run("layout.resize", { id: main.pane, weight: g.final.wc });
      return;
    }
    const w = g.tried.length > 2 ? null : line ? weightFor(line, g.p) : weightNear(null, g.tried[0], g.p);
    // Three weights unanswered: the column back at its kept px, the kept px cleared (pairGiveUp),
    // so no record is left with a px the column no longer has.
    if (!w) { this.pairing = null; this.pairGiveUp(g, m, cx); return; }
    g.w = w;
    g.at = this.paneW;
    g.asked = now;
    run("layout.resize", { id: me.pane, weight: w });
  }
  // The third probe ended without a pair: the column back at its px, and the Chat at px where
  // it is when it was given a weight, so no half-made pair is left on a trial weight. No more
  // tries until the column opens again (pairTries is this pane's): a row that keeps moving
  // under the probe is not probed every half second.
  pairGiveUp(g, m, cx) {
    const me = this.me();
    const main = this.mainPane();
    const rec = shared(PAIR_KEY)?.[this.terminal];
    if (me) run("layout.resize", { id: me.pane, px: rec?.probe > 0 ? rec.probe : g.p });
    if (g.final && main) run("layout.resize", { id: main.pane, px: m });
    this.pairPatch((r) => { const rest = { ...r }; delete rest.probe; return rest; }, cx);
  }
  // ---- the row on weights while the Trajectory is open (TRD-75, part 4) -------------------
  // In the Chat's pane. The row is the terminals, the Chat, the Trajectory and the Pinned
  // column, in that order, whichever opened first (the column splits off the Trajectory). Each
  // opening fits its pane at px as before; once it holds its width and the row is still, the
  // new pane goes onto a weight found from measures (rowLandStep), the others held at px, and
  // then the held panes onto weights at the same px a unit, k, in one tick (exact: a pane that
  // turns from px to weight px / k leaves every width as it was). From then on each divider
  // and the outer edge are drags between weight panes, which Herdr makes with their sum held.
  // ROW_KEY keeps { k, S, ids, n }: px a unit, the terminals' weights, the panes, and their
  // widths when last still (a pane's weight is its width over k).
  rowPanes() {
    if (this.pinnedPane || this.trajPane) return null;
    const me = this.me();
    const traj = this.trajRightOpen();
    if (!me || !traj) return null;
    const pin = this.pinnedPaneOpen();
    return { me, traj, pin, ids: { chat: me.pane, traj: traj.pane, ...(pin ? { pin: pin.pane } : {}) } };
  }
  // Each pane's Herdr px: the Chat's own width, the others' as they share it. null while one
  // has not measured.
  rowWidths(ids) {
    const w = shared(WIDTH_KEY) ?? {};
    const me = this.me()?.pane;
    const out = {};
    for (const id of Object.values(ids)) {
      const x = id === me ? this.paneW : w[id];
      if (!Number.isFinite(x)) return null;
      out[id] = Math.round(x) + PANE_FRAME;
    }
    return out;
  }
  // The terminals' weights as last known, for a first guess: the row's, the pair's, this
  // pane's own line, else about one terminal at Herdr's 0.5.
  rowGuessS() {
    const S = this.rowNow()?.S ?? shared(PAIR_KEY)?.[this.terminal]?.S ?? (this.weighLine ? this.weighLine.b / this.weighLine.a : null);
    return S > 0 ? S : 0.5;
  }
  // Another Threads pane in the tab: its own px resizes would read as drags here. The row stays
  // at px for as long as it is there.
  rowCrowded(rp) {
    const mine = new Set(Object.values(rp.ids));
    return panes().some((p) => p.tab === rp.me.tab && p.mod === MOD && !mine.has(p.pane));
  }
  rowNow() {
    return this.rowPending !== undefined ? this.rowPending : shared(ROW_KEY)?.[this.terminal] ?? null;
  }
  // Kept here at once, written after the drawing pass (poll runs in render).
  rowSave(v, cx) {
    this.rowPending = v;
    const put = () => {
      const map = { ...(shared(ROW_KEY) ?? {}) };
      if (v) map[this.terminal] = v;
      else delete map[this.terminal];
      setShared(ROW_KEY, map);
      this.rowPending = undefined;
    };
    if (cx?.timer) cx.timer.after(0, put);
    else put();
  }
  // A pane of a landing closed: the landing given up (rowQuit), the new pane and any held pane
  // back at px. The one place a close ends a landing: it runs before the closes are handled
  // (trajGiveBack, autoPinned), so the widths they send are the last each pane gets.
  rowLandGone(cx) {
    const g = this.rowLand;
    if (g && !this.pinnedPane && !this.trajPane && Object.values(g.ids).some((id) => !panes().some((p) => p.pane === id))) this.rowQuit(cx, "a pane closed during its landing");
  }
  // The Chat's width moved by a drag or a key (ev null): the widths it would go back to when a
  // side pane closes (trajChatBack, pinChatBack) are the owner's choice no more, and dropped.
  // The window (a scale) scales them.
  chatMoved(ev, d) {
    if (ev?.kind === "scale") {
      for (const b of [this.trajChatBack, this.pinChatBack]) if (b) b.px = Math.round(b.px * ev.f);
      if (this.chatHome) this.chatHome = Math.round(this.chatHome * ev.f);
      return;
    }
    if (Math.abs(d) > 2) { this.trajChatBack = null; this.pinChatBack = null; this.chatHome = null; }
  }
  // The Chat's width as a side pane opens, for the width it goes back to: the last width a close
  // sent it back to when it is within 3 px of that (the weigh loop and the fix stop within 2 px,
  // and each cycle would otherwise add its miss to the next), else its width now.
  chatAt(px) {
    return this.chatHome && Math.abs(px - this.chatHome) <= 3 ? this.chatHome : px;
  }
  // Each fall back to px, with its reason, for the debug report (rowFalls). The column's
  // opening, and the Trajectory's opening during a close, go to px on purpose and land on
  // weights again: no reason, not counted.
  rowFell(why) {
    if (!why) return;
    this.rowFallN = (this.rowFallN ?? 0) + 1;
    this.rowFalls = [...(this.rowFalls ?? []).slice(-19), { at: Date.now(), why }];
  }
  rowPoll(cx) {
    if (this.pinnedPane || this.trajPane || !this.terminal || !this.weightsOk) return;
    this.rowCloseStep(cx);
    this.rowFixStep(cx);
    // A record its Chat's pane left when it closed: none of it holds (the pane open now has
    // its own row to make).
    const kept = this.rowNow();
    if (kept?.k > 0 && !panes().some((p) => p.pane === kept.ids?.chat)) this.rowSave({ S: kept.S }, cx);
    const rp = this.rowPanes();
    if (!rp) { this.rowPlan = null; return; }
    this.rowTick(cx);
    if (rp.me.zoomed || rp.traj.zoomed || rp.pin?.zoomed || this.splitAsk || this.rowCloseDue || this.rowCloseFix) return;
    const ent = this.rowNow();
    // The other may take this pane for its own (me() by the terminal's map) and measure its own
    // width as the Chat's: the record's widths, not a measure.
    if (this.rowCrowded(rp)) { if (ent?.k > 0 || this.rowLand) this.rowPx(cx, "a second Threads pane", true); this.rowPlan = null; return; }
    const n = this.rowWidths(rp.ids);
    if (!n) return;
    const now = Date.now();
    const sig = Object.values(rp.ids).map((id) => n[id]).join(",");
    if (this.rowSeen?.sig !== sig) this.rowSeen = { sig, at: now };
    const still = now - this.rowSeen.at >= PAIR_STILL_MS;
    if (this.rowLand) { this.rowLandStep(n, rp, cx); return; }
    if (ent?.k > 0) {
      if (!still) { this.rowWake(PAIR_STILL_MS - (now - this.rowSeen.at), cx); return; }
      const from = ent.want ? this.rowCheck(ent, n, rp, cx) : ent;
      if (from) this.rowTrack(from, n, rp, cx);
      return;
    }
    const plan = this.rowPlan;
    if (!plan) return;
    if (now - plan.at > 10000 || !n[plan.probe]) { this.rowPlan = null; return; }
    const placed = Math.abs(n[plan.probe] - plan.t) <= 2 && Object.entries(plan.held).every(([id, px]) => Math.abs((n[id] ?? -99) - px) <= 2);
    if (placed && still) this.rowBegin(plan, n, rp, cx);
  }
  // The Chat may not draw when only the panes past it move: a measure once the row is still,
  // so the record follows before the next drag rather than on the 1 s poll.
  rowWake(ms, cx) {
    if (this.rowWoken || !cx?.timer) return;
    this.rowWoken = true;
    cx.timer.after(Math.max(0, ms) + 10, (cx) => { this.rowWoken = false; this.rowPoll(cx); });
  }
  // Measures 50 ms apart while a landing, a plan or a close is under way.
  rowTick(cx) {
    if (this.rowTimer || !cx?.timer || !(this.rowLand || this.rowPlan || this.rowCloseDue || this.rowCloseFix)) return;
    this.rowTimer = true;
    cx.timer.after(50, (cx) => { this.rowTimer = false; this.rowPoll(cx); });
  }
  // The new pane's first weight: the line through the room the weights share (Rr) and the
  // terminals' weights (S) puts it at t with S t / (Rr - t). The Trajectory's room probe
  // measured Rr at ROOM_WEIGHT; the column's opening knew it from the row (rowPinFit).
  rowBegin(plan, n, rp, cx) {
    this.rowPlan = null;
    const S = plan.S > 0 ? plan.S : this.rowGuessS();
    const Rr = plan.Rr ?? (plan.seed ? plan.seed[1] * (1 + S / ROOM_WEIGHT) : null);
    if (!(Rr > plan.t)) return;
    const w = Number(((S * plan.t) / (Rr - plan.t)).toPrecision(5));
    this.rowLand = { probe: plan.probe, t: plan.t, seed: plan.seed ?? null, S, held: plan.held, ids: rp.ids, tried: [], w, asked: Date.now(), at: n[plan.probe] };
    // The probe's widths are not the owner's (shareWidth). After the drawing pass, or at once
    // with no timer (tests), as rowSave.
    const hold = () => {
      if (plan.probe === rp.ids.traj) this.holdTrajWidth(4000);
      else setShared(PIN_W_KEY, { ...(shared(PIN_W_KEY) ?? {}), hold: Date.now() + 4000 });
    };
    if (cx?.timer) cx.timer.after(0, hold);
    else hold();
    run("layout.resize", { id: plan.probe, weight: w });
  }
  // Each new width (or 400 ms with none) is a measure. The second weight comes from the line
  // through the room probe's point and the first (the Trajectory), or from the first with the
  // row's S (the column); the third from the last two. Within 2 px it has landed: the held
  // panes go onto px / k, and once the row is still again it is saved. Three misses, a held
  // pane moving, or the panes changing: back to px.
  rowLandStep(n, rp, cx) {
    const g = this.rowLand;
    const now = Date.now();
    const same = Object.keys(g.ids).length === Object.keys(rp.ids).length && Object.entries(g.ids).every(([r, id]) => rp.ids[r] === id);
    if (!same || Object.entries(g.held).some(([id, px]) => Math.abs((n[id] ?? -99) - px) > 2)) { this.rowQuit(cx, same ? "a held pane moved during a landing" : "the panes changed during a landing"); return; }
    const m = n[g.probe];
    if (g.final) {
      if (now - this.rowSeen.at < PAIR_STILL_MS && now - g.final.at < 1500) return;
      if (Math.abs(m - g.t) > 2) { this.rowQuit(cx, "the landing moved after its last weight"); return; }
      this.rowLand = null;
      const ids = g.ids;
      this.weightNow = null;
      this.rowSave({ k: g.final.k, S: g.S, ids, n: Object.fromEntries(Object.values(ids).map((id) => [id, n[id]])) }, cx);
      return;
    }
    if (Math.abs(m - g.at) <= 1 && now - g.asked < 400) return;
    g.tried.push([g.w, m]);
    if (Math.abs(m - g.t) <= 2) {
      const k = m / g.w;
      for (const [id, px] of Object.entries(g.held)) run("layout.resize", { id, weight: Number((px / k).toPrecision(5)) });
      g.final = { k, at: now };
      return;
    }
    if (g.tried.length >= 3) { this.rowQuit(cx, "three misses landing"); return; }
    const line = g.seed && g.tried.length === 1 ? rowSolve(g.seed, g.tried[0])?.line : g.tried.length > 1 ? weightLine(...g.tried.slice(-2)) : null;
    if (line) g.S = line.b / line.a;
    const next = line ? weightFor(line, g.t) : weightNear({ a: 1, b: g.S }, g.tried[0], g.t);
    if (!next) { this.rowQuit(cx, "no weight lands the pane"); return; }
    g.w = next;
    g.at = m;
    g.asked = now;
    run("layout.resize", { id: g.probe, weight: next });
  }
  // The landing given up: the new pane back at its px, and any held pane given a weight back
  // at its px. The row stays at px for this opening.
  rowQuit(cx, why) {
    const g = this.rowLand;
    this.rowLand = null;
    if (!g) return;
    this.rowFell(why);
    if (panes().some((p) => p.pane === g.probe)) run("layout.resize", { id: g.probe, px: g.t });
    if (g.final) for (const [id, px] of Object.entries(g.held)) if (panes().some((p) => p.pane === id)) run("layout.resize", { id, px });
    this.rowSave({ S: g.S }, cx);
  }
  // The row on weights and still: what moved since (ui.js rowEvent). Drags keep k, and the
  // terminals' S gives up what the row's panes took; the window scales k. What the measures
  // cannot prove (mixed), the panes changing, or the terminals left with nothing: back to px
  // where the panes are, which is exact, and no weight is worked out from this record again.
  rowTrack(ent, n, rp, cx) {
    const order = ["chat", "traj", "pin"].map((r) => rp.ids[r]).filter(Boolean);
    const same = order.length === Object.keys(ent.ids).length && order.every((id) => Object.values(ent.ids).includes(id));
    if (!same) { this.rowPx(cx, "the row's panes changed"); return; }
    const { want, ...rec } = ent;
    const was = order.map((id) => rec.n[id]);
    const now = order.map((id) => n[id]);
    const ev = rowEvent(was, now);
    if (ev.kind === "same") { if (want) this.rowSave(rec, cx); return; }
    if (ev.kind === "stale" || ev.kind === "mixed") { this.rowPx(cx, `a change the record cannot follow (${ev.kind})`); return; }
    let { k, S } = rec;
    if (ev.kind === "drag") S -= ev.d / k;
    else k *= ev.f;
    this.chatMoved(ev, now[0] - was[0]);
    if (!(S > 0)) { this.rowPx(cx, "the terminals left with no weight"); return; }
    this.rowSave({ ...rec, k, S, n: Object.fromEntries(order.map((id, i) => [id, now[i]])) }, cx);
  }
  // Weights a key worked out from the record (want: where each pane of the row should land),
  // checked once the row is still: every pane within 2 px, or every pane the same factor off
  // (the window resized after the key: tracked from the key's widths). Otherwise the record was
  // wrong (a change under the rounding, ui.js rowEvent) and the row goes to px at those widths,
  // which is exact. The record to track from, or null.
  rowCheck(ent, n, rp, cx) {
    const { want } = ent;
    // A key that moved the Chat: the widths it would go back to are dropped (chatMoved).
    this.chatMoved(null, (want.n[rp.ids.chat] ?? ent.n[rp.ids.chat]) - ent.n[rp.ids.chat]);
    if (Object.entries(want.n).every(([id, px]) => Math.abs((n[id] ?? -99) - px) <= 2)) return ent;
    const order = ["chat", "traj", "pin"].map((r) => rp.ids[r]).filter((id) => id && want.n[id] > 0);
    if (rowEvent(order.map((id) => want.n[id]), order.map((id) => n[id])).kind === "scale") return { ...ent, want: undefined, n: { ...ent.n, ...want.n } };
    this.rowPxAt(want.n, ent.S, cx, "a key's widths missed by more than 2 px");
    return null;
  }
  // The row's panes to px at the given widths (those still open), and no record but the
  // terminals' S, which only seeds the next landing's first weight.
  rowPxAt(targets, S, cx, why) {
    this.rowFell(why);
    this.rowLand = null;
    this.rowPlan = null;
    for (const [id, px] of Object.entries(targets)) if (px > 0 && panes().some((p) => p.pane === id)) run("layout.resize", { id, px });
    this.rowSave({ S: S ?? null }, cx);
  }
  // Every pane of the row back to px where it is: for w, a second Threads pane, a change it
  // cannot follow, or the column's opening. The row's S is kept for the next landing.
  rowPx(cx, why, kept = false) {
    const ent = this.rowNow();
    const g = this.rowLand;
    this.rowLand = null;
    this.rowPlan = null;
    if (!(ent?.k > 0) && !g) return;
    this.rowFell(why);
    const ids = Object.values(ent?.ids ?? g.ids);
    const w = shared(WIDTH_KEY) ?? {};
    const me = this.me()?.pane;
    for (const id of ids) {
      if (!panes().some((p) => p.pane === id)) continue;
      const x = id === me ? this.paneW : w[id];
      const px = kept && ent?.n?.[id] > 0 ? ent.n[id] : Number.isFinite(x) ? Math.round(x) + PANE_FRAME : ent?.n?.[id];
      if (px > 0) run("layout.resize", { id, px });
    }
    this.rowSave({ S: ent?.S ?? g?.S ?? null }, cx);
  }
  // A pane of the row closed with the row on weights: Herdr gives its weight to the pane before
  // it. Once that pane measures wider (400 ms at most), the weights that keep each pane left at
  // its target (ui.js closeWeights), and the record that follows: the row's, the pair's (the
  // Chat and the column left), or the Chat's own weight line (the Chat alone).
  rowClose(closed, targets, cx) {
    const ent = this.rowNow();
    const r = ent?.k > 0 ? closeWeights({ k: ent.k, S: ent.S, n: ent.n, closed, targets }) : null;
    if (!r) return false;
    const receiver = closed === ent.ids.pin ? ent.ids.traj : ent.ids.chat;
    this.rowLand = null;
    this.rowPlan = null;
    this.rowCloseDue = { r, ent, closed, targets, receiver, n0: ent.n[receiver], until: Date.now() + ROW_CLOSE_WAIT_MS };
    this.weighAt = null;
    this.rowTick(cx);
    return true;
  }
  // A close's weights still under way. Its targets (the panes it left, the Chat at its width
  // from before the Trajectory when that was the pane closed), or null.
  rowClosing() {
    const c = this.rowCloseDue ?? this.rowCloseFix;
    return c ? { targets: c.targets, S: c.ent?.S ?? c.S ?? null } : null;
  }
  // A second side pane closed before the first close's weights are done (two presses of
  // Herdr's close key do this): those weights are for a pane that is gone. The Chat, alone now,
  // goes to px (px: its width from before the side panes) and onto a weight from there
  // (sizeTo), as before the row was on weights.
  rowCloseBoth(px, cx) {
    const c = this.rowClosing();
    this.rowCloseDue = null;
    this.rowCloseFix = null;
    this.rowLand = null;
    this.rowPlan = null;
    this.trajChatBack = null;
    this.weighAt = null;
    this.rowSave({ S: c?.S ?? null }, cx);
    if (px > 0 && this.me()) this.sizeTo(px);
  }
  // A side pane opening while a close's weights are under way: the panes left go to px at
  // their targets, so the opening starts from px and ends all px or all on weights. The Chat's
  // target, or null. why: the reason when the row stays at px (the column's opening); the
  // Trajectory's lands the row on weights again, so none.
  rowCancelClose(cx, why = null) {
    const c = this.rowClosing();
    if (!c) return null;
    this.rowCloseDue = null;
    this.rowCloseFix = null;
    this.rowPxAt(c.targets, c.S, cx, why);
    return c.targets[this.me()?.pane] ?? null;
  }
  rowCloseStep(cx) {
    const c = this.rowCloseDue;
    if (!c) return;
    const me = this.me();
    const x = c.receiver === me?.pane ? this.paneW : shared(WIDTH_KEY)?.[c.receiver];
    const grew = Number.isFinite(x) && Math.round(x) + PANE_FRAME > c.n0 + 2;
    if (!grew && Date.now() < c.until) { this.rowTick(cx); return; }
    this.rowCloseDue = null;
    const { ent, r, closed, targets } = c;
    if (!grew) { this.rowSave({ S: ent.S }, cx); return; }
    for (const [id, w] of Object.entries(r.w)) if (panes().some((p) => p.pane === id)) run("layout.resize", { id, weight: w });
    const ids = Object.fromEntries(Object.entries(ent.ids).filter(([, id]) => id !== closed));
    this.rowSave({ S: ent.S }, cx);
    if (ids.traj || ids.pin) {
      this.rowCloseFix = { ids, w: r.w, S: ent.S, targets, asked: Date.now(), seen: null };
      this.rowTick(cx);
      return;
    }
    // The Chat alone: on its weight with the terminals, R the room they share (with the closed
    // divider's SPLIT_GAP, which Herdr gives back), and the weigh loop's correction from there.
    // Without the gap every close landed the Chat about 2 px wide, within the loop's 2 px, and
    // the next opening kept that as its width: 2 px more each cycle.
    if (!me) return;
    const t = targets[ids.chat];
    const R = r.k * ent.S + t + SPLIT_GAP;
    this.weighLine = { a: 1 / R, b: ent.S / R };
    this.weighing = { pane: me.pane, n0: t, tried: [], w: Number(((ent.S * t) / (R - t)).toPrecision(5)) };
    this.askWeight();
  }
  // After a close's weights: Herdr gives the room the closed pane's divider took back to the
  // weight panes too, so each pane left lands a few px wide (about 8 on the rig). Once they are
  // still, the room they share measured (each pane is k w px) and the weights that put them at
  // their targets with the terminals taking the rest, in one ask; then the record: the row's
  // (the Chat and the Trajectory left) or the pair's (the Chat and the column), which tracks
  // them from there.
  rowFixStep(cx) {
    const f = this.rowCloseFix;
    if (!f) return;
    const now = Date.now();
    const ids = Object.values(f.ids);
    const n = ids.every((id) => panes().some((p) => p.pane === id)) ? this.rowWidths(f.ids) : null;
    if (!n) { this.rowCloseFix = null; return; }
    const sig = ids.map((id) => n[id]).join(",");
    if (f.seen?.sig !== sig) f.seen = { sig, at: now };
    if ((now - f.seen.at < 150 || now - f.asked < 150) && now - f.asked < 1500) { this.rowTick(cx); return; }
    this.rowCloseFix = null;
    const off = ids.some((id) => Math.abs(n[id] - f.targets[id]) > 2);
    // The fix asked unless every pane is within 1 px: a 2 px miss kept would be the next close's
    // width, and each cycle would add to it.
    const near = ids.every((id) => Math.abs(n[id] - f.targets[id]) <= 1);
    // The fix's weights asked: where they landed is the check. Off by more than 2 px, the
    // record they came from was wrong: px at the targets, which is exact, and no record.
    if (f.check) {
      if (off) { this.rowPxAt(f.targets, f.S, cx, "a close's fix missed by more than 2 px"); return; }
      this.rowFixSave(f, f.check.k, n, cx);
      return;
    }
    const sw = ids.reduce((s, id) => s + f.w[id], 0);
    const R = (ids.reduce((s, id) => s + n[id], 0) / sw) * (f.S + sw);
    const T = ids.reduce((s, id) => s + f.targets[id], 0);
    const k = (R - T) / f.S;
    // No room left for the terminals: the record cannot be right. px at the targets.
    if (!(k > 0)) { this.rowPxAt(f.targets, f.S, cx, "a close left the terminals no room"); return; }
    if (near) { this.rowFixSave(f, k, n, cx); return; }
    for (const id of ids) run("layout.resize", { id, weight: Number((f.targets[id] / k).toPrecision(5)) });
    this.rowCloseFix = { ...f, check: { k }, asked: now, seen: null };
    this.rowTick(cx);
  }
  // The record a close leaves once its panes hold their widths: the row's (the Chat and the
  // Trajectory) or the pair's (the Chat and the column). After the drawing pass, or at once
  // with no timer (tests).
  rowFixSave(f, k, n, cx) {
    const at = Object.fromEntries(Object.values(f.ids).map((id) => [id, n[id]]));
    if (f.ids.traj) { this.rowSave({ k, S: f.S, ids: f.ids, n: at }, cx); return; }
    const v = { k, m: at[f.ids.chat], p: at[f.ids.pin], S: f.S };
    const put = () => setShared(PAIR_KEY, { ...(shared(PAIR_KEY) ?? {}), [this.terminal]: v });
    if (cx?.timer) cx.timer.after(0, put);
    else put();
  }
  // The pair on weights and both widths still: what moved since, and k to match (ui.js
  // pairEvent). More than one change between measures: the pair is made again from px.
  pairTrack(ent, m, p, cx) {
    const ev = pairEvent(ent, { m, p });
    if (ev === "same") return;
    if (ev === "stale") { this.pairSave({ S: ent.S }, cx); return; }
    const k = ev === "scale" ? (ent.k * (m + p)) / (ent.m + ent.p) : ent.k;
    // The Chat's left edge: the Chat traded width with the panes on its left, the terminal's
    // weight with it (px panes there would take it instead; S is then only a first guess).
    const S = ev === "chat" && ent.S > 0 ? Math.max(1e-4, ent.S - (m - ent.m) / ent.k) : ent.S;
    this.pairSave({ k, m, p, S }, cx);
  }
  // The column closed with the pair on weights: Herdr gave its weight to the Chat, which takes
  // the column's room. The weight that keeps the Chat at its width (ui.js pairAlone) in one
  // ask, then measured as any weight is (weighStep), with the row's line from the pair for a
  // second ask if one is needed. No other weights known: the width at px, then a weight.
  // Herdr can show the column gone a frame before this pane's new width. The ask waits for
  // that width (the column's room given to this pane), so the wide width is not taken for the
  // answer to it (seen on the rig: the Chat measured 1,170 px as the answer to the weight for
  // 656, and went to 367). Not wider in 400 ms: the room went to another pane (the column was
  // not right of this one), this pane is at its width on its weight, and nothing is asked.
  pairClose(pair) {
    this.pairCloseDue = { pair, at: Date.now() };
    this.pairCloseStep();
  }
  pairCloseStep() {
    const c = this.pairCloseDue;
    if (!c) return;
    const grew = this.paneW != null && Math.round(this.paneW) + PANE_FRAME > c.pair.m + 2;
    if (!grew) { if (Date.now() - c.at >= 400) this.pairCloseDue = null; return; }
    this.pairCloseDue = null;
    const pair = c.pair;
    const me = this.me();
    const wc = me ? pairAlone(pair) : null;
    if (!wc) { if (me) this.sizeTo(Math.round(pair.m)); return; }
    const R = pair.k * pair.S + pair.m + pair.p;
    this.weighLine = { a: 1 / R, b: pair.S / R };
    this.weightNow = null;
    this.weighAfter = null;
    this.weighing = { pane: me.pane, n0: Math.round(pair.m), tried: [], w: wc };
    this.askWeight();
  }
  // This terminal's record changed by fn, after the drawing pass (poll runs in render). Not
  // once this column's pane is gone: its close may have deleted the record in the same tick,
  // and a kept px left behind would be the next column's.
  pairPatch(fn, cx) {
    const mine = this.me()?.pane;
    const put = () => {
      if (!mine || !panes().some((p) => p.pane === mine)) return;
      setShared(PAIR_KEY, { ...(shared(PAIR_KEY) ?? {}), [this.terminal]: fn(shared(PAIR_KEY)?.[this.terminal] ?? {}) });
    };
    if (cx?.timer) cx.timer.after(0, put);
    else put();
  }
  pairSave(v, cx) {
    const put = () => setShared(PAIR_KEY, { ...(shared(PAIR_KEY) ?? {}), [this.terminal]: v });
    if (cx?.timer) cx.timer.after(0, put);
    else put();
  }

  // The Pinned column is the way in: Threads opening with pins opens it once, when there is
  // room. Closing the column keeps it closed for this pane's life, until v opens it again.
  // In the column: it closes when its Threads pane closes.
  autoPinned(cx) {
    if (this.pinnedPane || this.trajPane) {
      // The column goes with its Threads pane: once the main pane has been seen, its closing
      // closes the column, so opening Threads again brings both back together. (TRD-24 PR 3:
      // a dock move closes the Chat and opens it again, so a pane the move names must not
      // close itself here while it is under way; and a move that stops halfway must still
      // leave a Chat open.)
      const main = this.mainPane();
      if (main) this.mainSeen = true;
      else if (this.mainSeen && !this.closing) {
        const me = this.me();
        if (me) { this.closing = true; run("pane.close", { pane: me.pane }); }
      }
      return;
    }
    const open = Boolean(this.pinnedPaneOpen());
    // The column closed: Threads may have been left at a px width (- and =, w), so once
    // the row has settled it goes back to a weight when its width is not held (toWeight).
    if (this.pinColOpen && !open && !this.splitAsk) {
      this.pinColClosed = true;
      this.weighAt = Date.now() + 500;
      // The pair was on weights: Herdr gives the column's weight to the Chat (pairClose). With
      // the Trajectory open, to the Trajectory before it (rowClose).
      const pair = shared(PAIR_KEY)?.[this.terminal];
      const ent = this.rowNow();
      const closing = this.rowClosing();
      const back = this.pinChatBack;
      this.pinChatBack = null;
      if (closing) this.rowCloseBoth(closing.targets[this.me()?.pane], cx);
      else if (ent?.k > 0 && ent.ids?.pin) {
        const targets = Object.fromEntries(Object.values(ent.ids).filter((id) => id !== ent.ids.pin).map((id) => [id, ent.n[id]]));
        if (back && ent.ids.chat) targets[ent.ids.chat] = this.chatHome = back.px;
        if (this.rowClose(ent.ids.pin, targets, cx)) this.weighAt = null;
      } else if (pair?.k > 0 && pair.m > 0) { this.weighAt = null; this.pairClose(pair); }
      if (pair) cx?.timer?.after(0, () => { const map = { ...(shared(PAIR_KEY) ?? {}) }; delete map[this.terminal]; setShared(PAIR_KEY, map); });
    }
    this.pinColOpen = open;
    if (this.pinAutoDone || !this.width || !this.current()?.loaded || !this.pinsRead) return;
    this.pinAutoDone = true;
    if (!open && !this.pinColClosed && this.pinnedList().length) this.openPinned(cx, true);
  }

  // Counts for the header, the Agents button and the empty state, kept until the turns,
  // the status or the setting change. cur: the newest session; all: every session.
  counts() {
    const status = this.status();
    // A session's read ending can make its newest turn live (isLive), so loaded is in the key,
    // as it is in rows() and pinnedAll().
    const key = `${this.sessions.map((s) => `${s.version}.${s.turns.length}.${s.loaded ? 1 : 0}`).join(",")}|${status}|${this.prefs.agentTurns ? 1 : 0}`;
    if (this.countsKey === key) return this.countsMemo;
    const agents = Boolean(this.prefs.agentTurns);
    // folded: agent turns shown for their reply, their message one line (foldState).
    const c = { agentAll: 0, hiddenAll: 0, shownAll: 0, foldedAll: 0, agentCur: 0, hiddenCur: 0, shownCur: 0 };
    const lastSi = this.sessions.length - 1;
    this.sessions.forEach((s, si) => s.turns.forEach((t, ti) => {
      const live = this.isLive(s, si, ti, status);
      const on = isShown(t, { agentTurns: agents, live, turns: s.turns });
      c.agentAll += t.agent ? 1 : 0;
      c.hiddenAll += on ? 0 : 1;
      c.shownAll += on ? 1 : 0;
      c.foldedAll += on && t.agent && !agents && !live ? 1 : 0;
      if (si === lastSi) { c.agentCur += t.agent ? 1 : 0; c.hiddenCur += on ? 0 : 1; c.shownCur += on ? 1 : 0; }
    }));
    this.countsKey = key;
    this.countsMemo = c;
    return c;
  }

  // The agent messages not shown whole while they are hidden: "40 folded, 1 hidden" (folded:
  // shown for their reply, the message one line; hidden: no reply of their own).
  agentCountText(c) {
    return [c.foldedAll ? `${c.foldedAll.toLocaleString()} folded` : null, c.hiddenAll ? `${c.hiddenAll.toLocaleString()} hidden` : null].filter(Boolean).join(", ");
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
    // The memo is checked field by field: building its key string for every turn on every
    // rebuild cost 3 µs a turn, 18 ms at 6,000 turns.
    const look = this.shapeLook();
    const text = this.replyText(turn);
    let f = turn.shapeFast;
    // Another width or text size than the shape's: the one kept for it (keepShape), if any.
    // The checks below still see whether the turn changed since.
    if (f && f.look !== look) f = this.recallShape(turn, look) ?? f;
    this.shapeStale = false;
    if (f && turn.shapeKey === f.key && f.look === look && f.p === turn.prompt.length && f.t === text.length && f.live === live && f.tools === turn.tools
      && f.int === Boolean(turn.interrupted) && f.by === turn.answeredBy && f.inn === turn.answeredIn && f.img === (turn.images?.length ?? 0) && f.ag === Boolean(turn.agent) && f.sv === this.sendersVer) return turn.shapeMemo;
    // Out of time and never shaped: no key to build (3 µs a turn, 30 ms a draw with 6,000 rows
    // waiting after renders were stopped through a whole load).
    if (turn.shapeKey == null && (this.shapeSpent ?? 0) > this.shapeMax()) { this.shapeLeft = (this.shapeLeft ?? 0) + 1; this.shapeStale = true; return this.blankShape(); }
    const q = this.filterText();
    const P = this.prefs;
    const why = turn.interrupted ? `No reply · interrupted after ${plural(turn.tools, "tool call")}` : null;
    const key = `${Math.round(this.width)}|${P.textSize}|${this.chars()}|${P.truncate ? `${P.promptLines}|${P.replyLines}` : "all"}|${q}|${turn.prompt.length}|${text.length}|${why ? 1 : 0}|${live ? 1 : 0}|${turn.answeredBy}|${turn.answeredIn}|${turn.answeredBy && this.prefs.agentTurns ? 1 : 0}|${turn.images?.length ?? 0}|${turn.agent ? 1 : 0}|${this.sendersVer}`;
    const fast = { key, look, p: turn.prompt.length, t: text.length, live, tools: turn.tools, int: Boolean(turn.interrupted), by: turn.answeredBy, inn: turn.answeredIn, img: turn.images?.length ?? 0, ag: Boolean(turn.agent), sv: this.sendersVer };
    if (turn.shapeKey === key) { turn.shapeFast = fast; this.keepShape(turn); return turn.shapeMemo; }
    // Out of time for this draw: the shape it had (a row never shaped yet, as when agent
    // messages are turned on, a blank one-line row), and the next frame reshapes it. A turn
    // whose shaping would take the draw past its time (shapeCost) waits too, unless it is the
    // draw's first: one turn with a pasted 200 KB prompt took 20 to 40 ms on the rig, and on
    // top of the draw's 12 ms it ran past Herdr's time.
    const spent = this.shapeSpent ?? 0;
    const cost = this.shapeCost(turn, text);
    if (spent > this.shapeMax() || (spent > 0 && spent + cost > this.shapeMax())) { this.shapeLeft = (this.shapeLeft ?? 0) + 1; this.shapeStale = true; return turn.shapeMemo ?? this.blankShape(); }
    const t0 = now();
    const sh = this.reshape(turn, live, q, P, why, text);
    this.shapeLearn(turn, text, now() - t0);
    turn.shapeKey = key;
    turn.shapeMemo = sh;
    turn.shapeFast = fast;
    this.keepShape(turn);
    this.shapeSpent = (this.shapeSpent ?? 0) + (now() - t0);
    return sh;
  }
  // What shaping a turn is expected to cost, in ms: its length at the rate learned from long
  // turns shaped before (shapeLearn); 0 until one has been.
  shapeCost(turn, text) { return (turn.prompt.length + text.length) * (this.shapeRate ?? 0); }
  // The rate from each long turn shaped: it rises at once and falls back by a tenth a turn,
  // so one slow turn is not forgotten by the next fast one.
  shapeLearn(turn, text, ms) {
    const n = turn.prompt.length + text.length;
    if (n >= SHAPE_LEARN) this.shapeRate = Math.max(ms / n, (this.shapeRate ?? 0) * 0.9);
  }
  // A turn's shape kept under its look, for the last WIDTHS_KEPT looks it was shaped at, the
  // last used last: a drag back to a width seen before reshapes nothing. A turn that changed
  // fails shape()'s checks and is shaped again; a new session's turns start with none.
  // The shape a turn has for the current look, without shaping it: the last one, or one kept.
  keptShape(turn) {
    const look = this.shapeLook();
    return turn.shapeFast?.look === look ? turn.shapeMemo : turn.shapesKept?.get(look)?.memo;
  }
  recallShape(turn, look) {
    const k = turn.shapesKept?.get(look);
    if (!k) return null;
    turn.shapeKey = k.key;
    turn.shapeMemo = k.memo;
    turn.shapeFast = k.fast;
    this.keepShape(turn);
    return k.fast;
  }
  keepShape(turn) {
    const m = (turn.shapesKept ??= new Map());
    const look = turn.shapeFast.look;
    m.delete(look);
    m.set(look, { key: turn.shapeKey, memo: turn.shapeMemo, fast: turn.shapeFast });
    if (m.size > WIDTHS_KEPT) m.delete(m.keys().next().value);
  }
  // What every row's shape depends on besides its turn, as one string kept while they stay.
  shapeLook() {
    const P = this.prefs;
    const q = this.filterText();
    const w = Math.round(this.width);
    const m = this.lookMemo;
    if (m && m.w === w && m.q === q && m.a === P.textSize && m.b === this.chars() && m.c === P.truncate && m.d === P.promptLines && m.e === P.replyLines && m.f === P.agentTurns) return m.s;
    const s = `${w}|${P.textSize}|${this.chars()}|${P.truncate ? `${P.promptLines}|${P.replyLines}` : "all"}|${q}|${P.agentTurns ? 1 : 0}`;
    this.lookMemo = { w, q, a: P.textSize, b: this.chars(), c: P.truncate, d: P.promptLines, e: P.replyLines, f: P.agentTurns, s };
    return s;
  }
  // A row's shape for the frame or two before it is shaped: one empty line of prompt and of
  // reply at the pane's width and text size.
  blankShape() {
    const k = `${Math.round(this.width)}|${this.prefs.textSize}|${this.chars()}`;
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
      return !live && isShown(s.turns[ti], { agentTurns: agents, live, turns: s.turns }) && !this.open.has(`${si}:${s.turns[ti].n}`);
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
    // Long messages shortened (truncate) or, by default, shown whole. A search still shows the
    // text around the first match.
    const cut = Boolean(P.truncate);
    const promptLines = cut ? P.promptLines : NO_CUT;
    const replyLines = cut ? P.replyLines : NO_CUT;
    const src = (t) => (q ? around(t.replace(/\s+/g, " "), q).slice(0, PREVIEW_CHARS) : cut ? t.slice(0, PREVIEW_CHARS) : t);
    let preview;
    let md = null;
    let tone = "reply";
    // A search shows a reply with a match as one run around its first match, wherever it is
    // (searchPreview). A reply with none (a row listed for the prompt it answered together
    // with) draws as it does with no search.
    const flat = q && text ? searchPreview(text, q, PREVIEW_CHARS) : null;
    const hit = flat != null;
    // A reply, unless a search marks a match in it, starts as Markdown (mdPreview): whole
    // source lines.
    if (!live && !why && text && !hit) {
      md = cut ? mdPreview(text, replyLines, readWidth(this.width, P.textSize, this.chars()) / readType(P.textSize).reply)
        : mdPreview(text, replyLines, readWidth(this.width, P.textSize, this.chars()) / readType(P.textSize).reply, text.length);
      if (!md.md.trim()) md = null;
    }
    if (live) { preview = ""; tone = "live"; }
    else if (why) { preview = why; tone = "why"; }
    else if (md) preview = " ";
    else if (text) preview = src(q ? flat ?? flattenMd(text.slice(0, PREVIEW_CHARS * 2)) : cut ? flattenMd(text, Math.min(PREVIEW_CHARS, (P.replyLines + 1) * Math.ceil(Math.max(this.width || 0, 120) / 5))) : flattenMd(text));
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
      promptLines, replyLines: tone === "reply" ? replyLines : 1,
      // While filtering, the row shows the text around the first match, as one run.
      quotes: !q, size: P.textSize, chars: this.chars(),
    });
    // A running turn draws its live line where a finished one has its line, then a 16 px
    // stats line where the reply and the strip under it go.
    if (live) sh.height += ROW.STATS - sh.r * this.rt().line - ROW.GAP - ROW.ACTS;
    // A reply as Markdown (no search on, or no match in it): its start, as an open turn draws
    // it, cut at a whole source line (mdPreview). Its height is the probe's measure of that
    // block ("cmd"), and until then an estimate; mdBase is the row without it.
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
    const prompt = cmd ? `${cmd.name} ${cmd.args}`.trim() : pinPromptText(noticeTurn(turn) ? kindWords(turn.sender) : turn.prompt.slice(0, PREVIEW_CHARS));
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
    // An agent turn shown for its reply: its message folded to one line (foldState).
    const fold = this.foldState(item);
    if (fold) out.push({ ...item, kind: "afold", key: `af:${key}`, turnKey: key, fold, open: true });
    if (fold !== "folded") {
      // Pasted images: their tiles over the message. A tile opens the review.
      if (turn.images?.length) out.push({ ...item, kind: "imgs", key: `imgs:${key}` });
      // full: the whole message, by the reader's Show all or because long messages are not
      // shortened; less: Show less, only after a Show all.
      out.push({ ...item, kind: "you", key: `you:${key}`, full: this.full.has(key) || !this.prefs.truncate, less: this.full.has(key) && Boolean(this.prefs.truncate), all: this.full.has(`ya:${key}`) });
      out.push({ ...item, kind: "ustrip", key: `us:${key}` });
    }
    const text = this.replyText(turn);
    out.push({ ...item, kind: "rhead", key: `rhead:${key}` });
    // Level 1, under the line when it is open: the steps, then straight into the reply. The
    // turn's numbers are on the Turn card (i, or the info icon on the line).
    if (this.lineIsOpen(key, false)) this.stepRows(item, out);
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
        // A table is an item of its own ("table"), so it can run wider than the reading line.
        const parts = mdChunks(md).flatMap((src) => splitTables(src));
        parts.forEach(({ text: src, table }, j) => {
          const lk = parts.length === 1 && linked?.[i] && src === seg.text ? linked[i] : this.linkOne(src);
          const sub = parts.length === 1 ? `${i}` : `${i}.${j}`;
          push({ ...item, kind: "md", key: `md:${key}:${sub}`, md: lk.md, src, links: lk.links, ...(j ? { gap: this.paraGap() } : {}), ...(table ? { table: true } : {}) });
        });
      } else {
        used += seg.text.length;
        push({ ...item, kind: "codehead", key: `cc:${key}:${i}`, seg, i });
        const cs = this.codeShape(seg.text, this.full.has(`c:${key}:${i}`));
        out.push({ ...item, kind: "code", key: `code:${key}:${i}`, seg, i, ...cs });
        if (cs.more) out.push({ ...item, kind: "codeall", key: `ca:${key}:${i}`, i, all: cs.all, left: cs.rows - CODE_LINES });
        // A Mermaid block: View diagram, which opens it drawn as text in the output viewer.
        if (isDiagram(seg.lang)) out.push({ ...item, kind: "mview", key: `mv:${key}:${i}`, i, seg });
      }
    });
    // A long reply ends in a quiet Collapse (Esc) row, with what the cap left out.
    if (!selecting && (text.length > LONG_REPLY || left)) out.push({ ...item, kind: "fold", key: `fold:${key}`, left });
    // What the agent said in its background updates, every one in order (updatesText), when
    // that is not the reply.
    const late = updatesText(turn);
    if (late && late !== text) {
      // With Shorten long messages off (the default) the update is Markdown from the start,
      // like the reply above it (the owner, 18 Nov: a flat preview was all there was, since
      // nothing was cut and so no Show all came). On, a clamped one-block preview (C5), the
      // Markdown after Show all. Past LATEST_MD characters the rest is not drawn, and a note
      // under it says how much (left).
      const whole = !this.prefs.truncate;
      const all = this.full.has(`l:${key}`);
      // One block that gpui wraps at the card's width (C5); the estimate counts lines only
      // until the probe has measured it.
      const text = whole ? "" : flattenMd(late.slice(0, 4000));
      const l = rowLines(text, LATEST_LINES + 1, this.prose() / this.charW(MD_CHAR));
      // cutMd ends a cut text in " …", so it cuts 4 short of the cap.
      const cut = (whole || all) && late.length > LATEST_MD;
      const md = whole || all ? (cut ? cutMd(late, LATEST_MD - 4) : late) : null;
      const left = cut ? late.length - md.replace(/\s*…$/, "").length : 0;
      push({ ...item, kind: "lhead", key: `lh:${key}` });
      out.push({ ...item, kind: "latest", key: `lt:${key}`, all, whole, text, estLines: l.lines.length + (l.cut ? 1 : 0), md, left });
    }
    out.push({ ...item, kind: "copy", key: `cp:${key}`, part: "bottom" });
  }

  // A code block's box: its rows, 6 px above and below the editor's text, and its bottom
  // border.
  codeBoxH(r) { return r.shown * CODE_LINE + 16; }

  // The editor wraps (nothing in the list scrolls sideways), so rows are the block's wrapped
  // lines at the box's width. A block of up to CODE_LINES rows shows them all; a taller one
  // shows its first CODE_LINES until Show all (all), its own list item, opens the rest.
  codeShape(text, all = false) {
    const lines = text.split("\n");
    const rows = Math.max(1, codeRows(text, this.codePer()));
    const more = rows > CODE_LINES;
    return { lines: lines.length, rows, shown: more && !all ? CODE_LINES : rows, more, all: more && all };
  }
  // Characters on one row of a code block's editor: the column less the box's border and
  // the editor's own inset, at 12 px mono.
  codePer() { return Math.max(8, Math.floor((this.prose() - 18) / (12 * MONO_EM))); }

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
  // A turn answered together with a later one (answeredBy) goes to that turn the same way:
  // opened, with the start of its reply at the top of the pane.
  goToAnswer(turn) {
    const si = this.sessions.findIndex((x) => x.turns[turn.n - 1] === turn);
    const n = turn.answeredIn ?? turn.answeredBy;
    if (si < 0 || !n) return;
    const key = `${si}:${n}`;
    if (turn.answeredIn) {
      this.sel = key;
      this.follow = false;
      this.scrollTo = { key, how: "center", flash: true };
      return;
    }
    if (!this.open.has(key)) { this.open.add(key); this.makeCode(key); }
    this.sel = key;
    this.follow = false;
    // "land": scroll_to_item alone brings an item to the nearest edge, which showed the end
    // of a tall reply below the view. It waits up to 400 ms for the opened parts' measures,
    // since a short estimate lets the list clamp at its end.
    this.scrollTo = { key: `md:${key}:0`, how: "land", or: [`md:${key}:0.0`, `cc:${key}:0`, key], until: Date.now() + 400, flash: true };
  }
  findTurn(key) {
    const [si, n] = key.split(":").map(Number);
    return this.sessions[si]?.turns[n - 1] ?? null;
  }

  // Whether up and down stop at this turn: whether it has a tick on the rail (the rows'
  // rule). An agent message has one only with agentRail on; the running turn always does.
  // In the outline and the Pinned view every row is a stop, as before.
  railStop(key) {
    if (this.prefs.agentRail === true || this.view === "pinned" || this.outlined()) return true;
    const turn = this.findTurn(key);
    if (!turn?.agent) return true;
    const si = Number(key.split(":")[0]);
    const s = this.sessions[si];
    return si === this.sessions.length - 1 && turn === s.turns[s.turns.length - 1] && !turn.done;
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
      if (isShown(turn, { agentTurns, live: this.isLive(s, si, ti), turns: s.turns })) return `${si}:${turn.n}:${turn.done ? 1 : 0}`;
    }
    return null;
  }
  // After a read: a new turn, or the reply to the newest one, came in. The next draw of the
  // list decides: with the list's end off screen the latest button gets a dot until it shows.
  noteNew(before) {
    if (this.view !== "pinned" && this.newestSig() !== before) this.unseen = "pending";
  }

  // The list's scroll offset (listOff, in the list's px), which Herdr gives no read of: the
  // pane's own scroll since the last layout, then the rows this layout draws (ui.js
  // listOffset). A wheel moves it too (listWheel).
  trackOff(slots, range) {
    const ask = this.scrollAsk;
    this.scrollAsk = null;
    this.listOff = listOffset(this.slotPre(slots), this.listOff ?? 0, this.listH, ask, range.start, range.end);
  }
  // The rows' tops in a list's heights, and its end: made once for each set of heights.
  slotPre(slots) {
    if (this.preOf === slots) return this.preArr;
    const pre = new Float64Array(slots.length + 1);
    for (let i = 0; i < slots.length; i++) pre[i + 1] = pre[i] + slots[i];
    this.preOf = slots;
    this.preArr = pre;
    return pre;
  }
  // Every scroll the pane asks of the list, so trackOff knows where it lands.
  askScroll(i, how) { this.scrollAsk = { i, how }; this.scroll.scroll_to_item(i, how); }
  askEnd() { this.scrollAsk = { end: true }; this.scroll.scroll_to_bottom(); }

  // The place on screen just before a re-wrap's rows come in (buildStep): the row at the top
  // edge, the share of its height above the edge, and the heights the list has for the rows
  // above it. A reader at the end (following, the end on screen) is kept at the end instead.
  // None while a landing's lift is on, or in a list that fits the pane.
  takeAnchor() {
    const rows = this.rowsMemo;
    const slots = this.slotsMemo;
    if (!rows?.length || !slots?.length || !(this.listH > 0) || rows[0].kind === "spacer") return null;
    // The reader's wheel count when the place is taken: a wheel after it lets the place go.
    const wheels = this.wheelN ?? 0;
    if (this.follow && this.bottomShown && this.view !== "pinned" && !this.outlined()) return { end: true, wheels };
    if (this.landLift > 0 || this.anchorLift || this.anchorSlot) return null;
    const off = this.listOff ?? 0;
    const p = placeAt(this.slotPre(slots), off);
    const held = new Map();
    for (let i = 0; i < p.i; i++) held.set(rows[i].key, slots[i]);
    return { key: rows[p.i].key, turn: rowTurnKey(rows[p.i]), share: p.share, off, held, wheels };
  }
  // While a place is held: the rows above the anchor keep the heights the list had for them,
  // so the measures the probe brings in over the next frames move nothing on screen. The list
  // keeps its offset in px, and the px those rows lack or have over (taken from or given to
  // the nearest of them, all off screen) put the anchor's top where the same share of its new
  // height is above the edge. That place is set once, from the first rows that have it.
  holdPlace(rows, slots) {
    const A = this.anchor;
    let a = rows[A.a]?.key === A.key ? A.a : rows.findIndex((r) => r.key === A.key);
    // The row is gone (its reply was parted anew): its turn's first row, from its top.
    if (a < 0 && A.turn) {
      a = rows.findIndex((r) => rowTurnKey(r) === A.turn);
      if (a >= 0) { A.key = rows[a].key; A.share = 0; A.pre = null; }
    }
    if (a < 0) { this.anchor = null; return; }
    A.a = a;
    let sum = 0;
    for (let i = 0; i < a; i++) {
      const h = A.held.get(rows[i].key);
      if (h != null) slots[i] = h;
      sum += slots[i];
    }
    A.pre ??= Math.round(A.off - A.share * slots[a]);
    let c = A.pre - sum;
    for (let i = a - 1; i >= 0 && c !== 0; i--) {
      const h = Math.max(1, slots[i] + c);
      c -= h - slots[i];
      slots[i] = h;
    }
  }
  // The sessions start over (a pick, a session read again from the top): row keys are a
  // session's index and a turn's number, so a held place could match a turn in the new rows.
  dropAnchor() {
    if (this.anchor || this.anchorDue) this.fitKey = null;
    this.anchor = null;
    this.anchorDue = false;
  }
  // Why a held place is let go now (letGo), or null:
  // - a jump, which puts the view somewhere new;
  // - the person's scroll (a wheel event since the place was taken);
  // - the rows built and shaped, and the probe with nothing left above the anchor (the whole
  //   list, at the end).
  // Nothing else: no time limit. The probe ends, since each part is drawn in it for three
  // frames at most (probeDue), and while it goes on the place is held and costs a fraction of
  // a ms a frame. Let go any sooner, the measures still to come above the place would move it.
  holdDone() {
    const A = this.anchor;
    if (!A) return null;
    if (this.scrollTo || (this.toBottom && !A.end)) return "jump";
    if (!A.open && (this.wheelN ?? 0) > A.wheels) return "scroll";
    // The probe's word is for this place only from a walk made while it was held.
    if (this.rowJob || this.staleRows?.length || this.shapeLeft > 0 || this.probeFor !== A) return null;
    return this.probeLeft === 0 || (!A.end && this.probeAbove) ? "settled" : null;
  }
  // A held place let go: the rows above the anchor take the heights they have now. In this
  // frame the list goes back to the same place: the row at the top edge, at the same share of
  // its height (ui.js anchorPlan; its lift is taken away in the next frame). A jump puts the
  // view where it goes itself; a reader kept at the end is put at the end once more.
  letGo(why, cx) {
    const A = this.anchor;
    this.anchor = null;
    this.fitKey = null;
    if (A.end) { if (why !== "scroll" && this.follow) this.askEnd(); return; }
    if (why === "jump" || !this.rowsMemo?.length || !this.slotsMemo?.length) return;
    const at = placeAt(this.slotPre(this.slotsMemo), this.listOff ?? 0);
    const key = this.rowsMemo[at.i]?.key;
    const rows = this.rows();
    const slots = this.slotsMemo;
    const i = rows[at.i]?.key === key ? at.i : rows.findIndex((r) => r.key === key);
    if (i < 0) return;
    const pre = this.slotPre(slots);
    const room = Math.max(0, pre[slots.length] - this.listH);
    const want = Math.max(0, Math.min(pre[i] + at.share * slots[i], room));
    const p = anchorPlan(pre, want, Math.min(this.listOff ?? 0, room), this.listH);
    if (!p) return;
    if (p.end) { this.askEnd(); return; }
    if (p.lift || p.slot) { this.anchorLift = p.lift; this.anchorSlot = p.slot ?? null; this.fitKey = null; cx.timer.after(0, (cx) => cx.notify()); }
    this.askScroll(p.j, p.how);
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
    // A scroll of theirs with no wheel since the last frame (the list's own bar) moved the list
    // too: the wheel counted its own (listWheel).
    const wheeled = (this.wheelN ?? 0) !== (this.stickWheelN ?? 0);
    this.stickWheelN = this.wheelN ?? 0;
    if (same && prevStart != null && start !== prevStart && !busy) {
      this.scrolledBy(start < prevStart ? 1 : -1, now);
      if (!wheeled) this.readerMoved();
    }
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
  // The reader moved the list or left the view (a wheel, the rail, a pin, the outline, a search
  // step, a session switch, the pane hidden): what a kept step or a card's scroll waits on is off.
  readerMoved() { this.readerMoves = (this.readerMoves ?? 0) + 1; }

  listWheel(e) {
    const dy = Number(e?.delta?.y) || 0;
    if (!dy || this.openActive()) return;
    // A list that fits the pane (the spacer above it) does not scroll at all.
    if (this.rowsMemo?.[0]?.kind === "spacer") return;
    this.readerMoved();
    // The list has moved by it (trackOff): delta is in the window's px, the offset in the
    // list's, which Herdr scales by zoom.
    this.listOff = (this.listOff ?? 0) - dy / this.zoom();
    this.wheelN = (this.wheelN ?? 0) + 1;
    if (this.view === "pinned") return;
    this.scrolledBy(dy, Date.now());
    this.scrollSeenAt = Date.now();
    if (dy > 0 && this.follow) { this.follow = false; this.toBottom = false; this.pinningUntil = 0; }
    // Just after the opening, parts above the end are still measured: a scroll up takes the
    // place on screen (takeAnchor), so measures above it move nothing, and takes it again at
    // each wheel while parts wait (the rows above the new top keep the heights they had).
    if (this.probeLeft > 0 && (this.openHold || this.anchor?.open) && !this.follow) {
      this.openHold = false;
      this.dropAnchor();
      const a = this.takeAnchor();
      if (a) { a.open = true; this.anchor = a; }
      this.fitKey = null;
    }
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
    // The first rows build is still going over several frames (a long session, a slow
    // machine), so there is no turn to select yet: its end selects the newest (latestAfterBuild).
    else if ((select || !this.sel) && this.rowJob) this.latestDue = { sel: this.sel };
    this.toBottom = true;
  }
  // Selects the newest turn when the build that jumpLatest waited for is done, if the pane is
  // still following and nothing moved the selection meanwhile.
  latestAfterBuild() {
    const due = this.latestDue;
    if (!due) return;
    this.latestDue = null;
    if (!this.follow || this.sel !== due.sel) return;
    const keys = this.turnKeys(this.baseRows);
    if (keys.length) { this.sel = keys[keys.length - 1]; this.toBottom = true; }
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

  // A press on a closed turn: selected now, opened after OPEN_WAIT_MS unless something else
  // comes first: a second press (on_mouse_down with a click count over 1), a drag
  // (holdForSelect), any key (key), or a search starting. A press on another closed turn
  // meanwhile opens the first one straight away, so no open is lost. A turn a search hides by
  // then is not opened.
  openAfterPress(key, cx) {
    const w = this.openWait;
    if (w && w.key !== key) { this.openWait = null; if (this.mayOpen(w)) this.toggle(w.key, cx); }
    this.sel = key;
    this.follow = false;
    const gen = (this.openGen = (this.openGen ?? 0) + 1);
    this.openWait = { key, gen, filtering: Boolean(this.filtering) };
    cx.timer.after(OPEN_WAIT_MS, (cx) => {
      const w = this.openWait;
      if (w?.gen !== gen) return;
      this.openWait = null;
      if (this.mayOpen(w)) this.toggle(key, cx);
    });
    cx.notify();
  }
  // Whether a pending open still applies: the turn is closed and on the list, and no search
  // started since the press (a press in the search field or its button takes no key here).
  mayOpen(w) {
    if (this.open.has(w.key) || !this.findTurn(w.key)) return false;
    if (this.filtering && !w.filtering) return false;
    return this.rows().some((r) => r.key === w.key);
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
    // left under the footer); closing keeps the row in view. Opening waits for the card's
    // parts to be measured (until), as a return to a pin does: worked out from estimates,
    // the view landed and then moved again as the measures came in (issue 131).
    this.scrollTo = this.open.has(key) ? { key, how: "card", until: Date.now() + 400 } : { key, how: "top" };
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

  // A code block with no editor (one that failed to start): its lines, wrapped, in the box.
  // In the image viewer, outside the list (scroll), a taller block scrolls down inside.
  plainCode(t, id, text, mono, scroll = false) {
    return v_flex().id(id).size_full().px(8).py(6).text_size(12).font_family(mono).text_color(t.muted)
      .when(scroll, (el) => el.overflow_y_scroll())
      .children(text.split("\n").map((l) => div().w_full().min_h(CODE_LINE).line_height(`${CODE_LINE}px`).child(l || " ")));
  }
  // The quiet line under a code block or a tool's output whose rest is hidden: Show all and
  // its count, or Show less. It is its own list item, so the list's item click takes it.
  showAllRow(t, text, icon) {
    return h_flex().mt(4).h(SHOW_ALL_H - 4).gap(4).items_center().text_size(12).text_color(t.accent)
      .child(text).child(svg(ICON(icon)).size(12));
  }
  // Characters on one row of a tool's output: the column less the box's indent, padding and
  // border, and the editor's own inset, at 11.5 px mono.
  outPer() { return Math.max(8, Math.floor((this.prose() - 18 - 20 - 2 - 10) / (11.5 * MONO_EM))); }

  // Read-only editors that colour an opened call's output (outLang), by session file and call
  // id. render() asks for the missing ones (syncOutEditors) and a timer makes them, since an
  // editor cannot be made while drawing; editors for outputs no longer open are released.
  outLangOf(r) {
    const c = this.callEntry(r.si, r.id);
    return c?.out ? outLang(c.out, c.input, toolKind(r.name)) : null;
  }
  outKey(r) { return `${this.sessions[r.si]?.file}#${r.id}`; }
  outEditorFor(r) {
    const e = this.outEds?.get(this.outKey(r));
    const c = this.callEntry(r.si, r.id);
    return e && c && e.text === c.out ? e.st || null : null;
  }
  syncOutEditors(cx) {
    const eds = (this.outEds ??= new Map());
    const want = new Map();
    for (const r of this.rowsMemo ?? []) {
      if (r.kind !== "cout" || !r.box.lines.length) continue;
      const lang = this.outLangOf(r);
      if (lang) want.set(this.outKey(r), { lang, text: this.callEntry(r.si, r.id).out });
    }
    let missing = false;
    for (const [k, e] of eds) {
      const w = want.get(k);
      if (!w || w.text !== e.text) { if (e.st) e.st.release(); eds.delete(k); }
    }
    for (const k of want.keys()) if (!eds.has(k)) missing = true;
    if (!missing || this.outNext) return;
    this.outNext = true;
    cx.timer.after(0, (cx) => {
      this.outNext = false;
      const t = theme();
      for (const [k, w] of want) {
        if (eds.has(k)) continue;
        let st = false;
        try {
          st = EditorState.new({
            language: w.lang, value: w.text.split("\n").slice(0, OUT.MAX).map((l) => this.short(l.replace(/\t/g, "    ").slice(0, OUT.CHARS))).join("\n"),
            readonly: true, line_numbers: false, folding: false, soft_wrap: true,
            font_family: settings().font_family, font_size: 11.5, syntax: this.syntaxColors(t),
          });
        } catch (e) {
          console.log(`agent-threads: no editor for ${w.lang} output: ${e?.message ?? e}`);
        }
        if (st) this.watchEditor(st);
        eds.set(k, { st, text: w.text });
      }
      cx.notify();
    });
  }
  syntaxColors(t) {
    return {
      keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1,
      constant: t.ansi6, boolean: t.ansi1, operator: t.muted, punctuation: t.dim, variable: t.foreground, "string.escape": t.ansi6,
    };
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
  // marks nothing copied. quiet: no toast; the button says "Copied" in its own place.
  copy(text, id, label, cx, quiet = false) {
    try {
      cx.write_to_clipboard(text);
    } catch (e) {
      console.log(`agent-threads: clipboard write failed: ${e?.message ?? e}`);
      this.copied = null;
      this.say("Couldn't copy", "circle-x", cx);
      return false;
    }
    this.clipAtPress = null;
    const at = quiet ? Date.now() + Math.random() : this.say(label, "check", cx);
    this.copied = { id, at };
    if (quiet) cx.timer.after(2000, (cx) => { if (this.copied?.at === at) { this.copied = null; cx.notify(); } });
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
  // copied, only when it is part of this reply, or of a turn on screen (copiedPart), so text
  // from anywhere else is never pasted; otherwise the whole reply as Markdown source.
  // { text, source, from } or { refuse, source, why }: from is the turn the copied text came
  // from, when it is another one. In Select view a press means the highlight, so it never
  // falls back to the whole reply: when the clipboard holds nothing from the pane, the quote
  // says how instead.
  quoteSource(key, cx) {
    const turn = key ? this.findTurn(key) : null;
    const reply = turn && this.turnKeys(this.rows()).includes(key) ? this.replyText(turn) : "";
    if (!reply) return { refuse: "No reply to quote." };
    if (this.selecting === key) {
      // Herdr 0.1.16 and later: the editor's highlight itself, with no ⌘C first.
      const lit = this.highlight();
      if (lit?.trim()) return { text: lit, source: "selection", how: "editor" };
      const clip = readClip(cx);
      if (clip.trim() && inReply(clip, reply)) return { text: clip, source: "selection", how: "clipboard" };
      // ⌘C on the formatted text of another turn on screen, Select view still open here.
      const part = this.copiedPart(cx);
      if (part) return { text: part.text, source: "selection", how: "clipboard", from: part.key };
      const say = lit != null ? `Nothing highlighted: select text, then ${this.quoteKey}` : `Couldn't read the highlight, press ⌘C then ${this.quoteKey}`;
      return { refuse: say, source: "selection", why: clip.trim() ? "notInReply" : "empty" };
    }
    const part = this.copiedPart(cx);
    if (part?.key === key) return { text: part.text, source: "selection" };
    return { text: reply, source: "reply" };
  }

  // After ⌘C in Select view, once the editor's copy has run: when the clipboard holds text
  // from this reply or another turn on screen, a toast says q quotes it. Never the text itself in the record.
  sawCopy(key, cx) {
    cx.timer.after(60, (cx) => {
      if (this.selecting !== key) return;
      const turn = this.findTurn(key);
      const clip = readClip(cx);
      const ok = Boolean(turn && clip.trim() && (inReply(clip, this.replyText(turn)) || this.copiedPart(cx)));
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
    if (cx && this.selectGesture()) { this.holdForSelect(); this.liftFill(this.sel, cx); }
  }
  // Selecting text is reading: following stops, as a click on a turn stops it (toggle). Left on,
  // the newest reply growing during the drag, or a new turn, pulled the view to the bottom and
  // carried the text under the pointer off the top of the pane (issue 131). Scrolling back down
  // to the end follows again (stickCheck).
  // A press that becomes a selection also keeps closed the turn an earlier press was about
  // to open (OPEN_WAIT_MS).
  holdForSelect() {
    this.openWait = null;
    if (!this.follow && !this.toBottom) return;
    // A scroll to the bottom a frame already queued (16 ms, below) checks this and does not run.
    // A count, not a time: a clock that steps back, or a hold in the same millisecond as the
    // request, would drop a later request.
    this.holds = (this.holds ?? 0) + 1;
    this.follow = false;
    this.toBottom = false;
    this.pinningUntil = 0;
    this.stickStep = null;
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
  // { key, text } when the clipboard holds text copied since the last press from the reply
  // or message of the selected turn, an open turn or a turn on screen, or null. A drag's
  // release often lands on another turn's item, which then is the selected one (click).
  copiedPart(cx) {
    if (this.clipAtPress == null || !this.replySelectable()) return null;
    const clip = readClip(cx);
    if (!clip.trim() || clip === this.clipAtPress) return null;
    const keys = [...new Set([this.sel, ...this.open, ...this.screenTurns()])].filter(Boolean);
    const key = keys.find((k) => {
      const turn = /^\d+:\d+$/.test(k) ? this.findTurn(k) : null;
      return turn && (inReply(clip, this.replyText(turn)) || inReply(clip, updatesText(turn)) || inReply(clip, turn.prompt ?? ""));
    });
    return key ? { key, text: clip } : null;
  }
  // The turns with an item in the range the list drew last, top to bottom.
  screenTurns() {
    const rows = this.rowsMemo ?? [];
    const [a, b] = this.viewRange ?? [0, 0];
    const out = [];
    for (let i = a; i < Math.min(b, rows.length); i++) {
      const k = rowTurnKey(rows[i]);
      if (k && !out.includes(k)) out.push(k);
    }
    return out;
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
  quote(cx, via, button = null) {
    if (this.settingsOpen || this.choosing) return false;
    // The turn a press is for (a button's, the one in Select view, the selected one), and the
    // turn quoted from: without a button, the turn ⌘C copied from when it is another one.
    const target = button ?? this.selecting ?? this.sel;
    const key = button ?? this.selecting ?? this.copiedPart(cx)?.key ?? this.sel;
    const at = Date.now();
    if (this.quoteAt && at - this.quoteAt < 1000) return true;
    this.quoteAt = at;
    // Select view: a mod cannot read the editor's selection or make it copy (EditorState has
    // no selection; window.dispatch_action and cx.bind_keys reach only the shell's own named
    // actions, never the editor's input::Copy). So ⌘C copies the highlight and q quotes
    // what it copied.
    const k = this.quoteKey;
    const q = this.quoteSource(key, cx);
    // Text copied from a turn other than the one the press is for: the toast names it ("from #12").
    const fromKey = q.from ?? key;
    const fromTurn = !q.refuse && fromKey && fromKey !== target ? this.findTurn(fromKey)?.n ?? null : null;
    const from = fromTurn != null ? ` from #${fromTurn}` : "";
    // Kept for the debug report and, with no text in it, in shared("threads.lastQuote") on
    // every build, so a quote that went wrong can be told apart afterwards.
    const record = (x) => {
      this.lastQuote = { at, via, terminal: this.terminal, selectView: this.selecting === key, copiedInSelect: this.selectCopy ?? null, fromTurn, ...x };
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
      const base = { source: q.source, how: q.how ?? null, lines: out.lines, capped: out.capped, cut: out.cut, chars: out.text.length, gate: gate.ok ? (gate.busy ? "busy" : "ok") : gate.why };
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
        else if (gate.busy) text = `Quoted${from} into ${t4} · ${this.agent().short} will queue it`;
        else if (out.cut === "lines") text = `Quoted the first ${out.lines - 1} lines${from} into ${t4}`;
        else if (out.cut === "chars") text = `Quoted the start${from} into ${t4} · cut at 2,000 characters`;
        else if (q.source === "selection") text = `Quoted the selection${from} into ${t4}`;
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
  // up once per terminal and folder, outside the draw, and only when a rule (or the one open
  // on the card) uses it.
  lookRepo(cx) {
    if (!this.links.some((r) => r.repo) && !/\{(repo|owner)\}/.test(this.ruleEdit?.draft.url ?? "")) return;
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
      this.remote = { key, repo: p?.repo ?? null, owner: p?.owner ?? null, host: p?.host ?? null, why: p ? `origin on ${p.host}` : r?.code === 0 ? "origin is not a repo URL" : "no git remote origin" };
      cx.notify();
    });
  }

  // Link rules on a reply's prose segments, kept per turn until the reply, the rules or the
  // repo change. The caps (20,000 characters, 25 links) are for the whole reply.
  linkedSegs(key, segs) {
    if (!this.links.length) return null;
    const sig = `${this.linksVer}|${this.repoSig()}|${segs.map((x) => `${x.kind}${x.text.length}`).join(",")}`;
    const memo = (this.linkMemo ??= new Map());
    const m = memo.get(key);
    if (m?.sig === sig) return m.out;
    const ctx = this.linkCtx();
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
    const ver = `${this.linksVer}|${this.links.length}|${this.repoSig()}|${this.remote.owner ?? ""}`;
    this.stepLinked ??= new WeakMap();
    const known = this.stepLinked.get(st);
    if (known?.ver === ver) return known.lk;
    if ((this.shapeSpent ?? 0) > this.shapeMax()) {
      this.shapeLeft = (this.shapeLeft ?? 0) + 1;
      this.otherLeft = (this.otherLeft ?? 0) + 1;
      return { md: st.t, links: 0 };
    }
    const t0 = now();
    const linked = this.linkOne(st.t);
    const lk = linked.md.length <= 4000 ? { md: linked.md, links: linked.links } : { md: st.t, links: 0 };
    this.stepLinked.set(st, { ver, lk });
    this.shapeSpent = (this.shapeSpent ?? 0) + (now() - t0);
    return lk;
  }
  // What link rules fill {repo} and {owner} from: the terminal's origin, with its host.
  linkCtx() { return { repo: this.remote.repo, owner: this.remote.owner, host: this.remote.host ?? null }; }
  repoSig() { return this.remote.repo ? `${this.remote.host ?? ""}/${this.remote.repo}` : ""; }
  linkOne(md) { return this.links.length ? linkify(md, this.links, this.linkCtx()) : { md, links: 0 }; }

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
    // The list drawn hidden under the loading state takes no press.
    if (this.openActive()) return;
    this.readerMoved();
    const [kind, ...rest] = key.split(":");
    const id = rest.join(":");
    // While the Turn card is open, a press anywhere closes it and does nothing else: the card
    // is drawn inside a list item, which can carry no handlers, so a press on the card lands on
    // whatever item lies under it. A press on another line's info icon moves it there.
    if (this.detailsOpen && Popup) {
      const x = this.pressX ?? this.mouseX;
      const other = kind === "rhead" && id !== this.sel && this.infoHit(x);
      this.pressX = null;
      this.detailsOpen = other;
      if (other) this.sel = id;
      return cx.notify();
    }
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
    // A folded agent message's line: the message, or folded again (foldState).
    if (kind === "af") {
      const k = `${id}:am`;
      if (this.full.has(k)) this.full.delete(k); else if (!noticeTurn(this.findTurn(id))) this.full.add(k);
      this.toList();
      this.sel = id;
      this.follow = false;
      return cx.notify();
    }
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
      // The selected running card whose message is taller than YOU_MAX: Show all and Show
      // less (ya:, which the open turn shares), as a press on an open turn's bubble does.
      const lr = this.sel === key ? this.baseRows?.find((x) => x.key === key && x.live && x.kind === "working") : null;
      if (lr && this.youMd(this.workYou(lr)).long) {
        const k = `ya:${key}`;
        this.full.has(k) ? this.full.delete(k) : this.full.add(k);
        return cx.notify();
      }
      if (!this.open.has(key)) return this.openAfterPress(key, cx);
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
    if (kind === "you") {
      // A message taller than YOU_MAX: Show all and Show less (ya:). Otherwise Show all and
      // Show less of a shortened message (Shorten long messages on).
      const part = this.baseRows?.find((x) => x.key === key);
      const y = part ? this.youMd(part) : null;
      const k = y?.long && (part.full || !(y.more > 0)) ? `ya:${id}` : id;
      this.full.has(k) ? this.full.delete(k) : this.full.add(k);
      this.sel = id;
      return cx.notify();
    }
    // Show all or Show less under a tool's output, or its viewer.
    if (kind === "oa") {
      const part = this.baseRows?.find((x) => x.key === key) ?? this.rowsMemo?.find((x) => x.key === key);
      this.sel = rest.slice(0, 2).join(":");
      if (part?.view) { this.openOutput(part); return cx.notify(); }
      this.callAll.has(id) ? this.callAll.delete(id) : this.callAll.add(id);
      return cx.notify();
    }
    // View diagram under a Mermaid block.
    if (kind === "mv") {
      const part = this.baseRows?.find((x) => x.key === key) ?? this.rowsMemo?.find((x) => x.key === key);
      this.sel = rest.slice(0, 2).join(":");
      if (part?.seg) this.openDiagram(part);
      return cx.notify();
    }
    // Show all or Show less under a code block.
    if (kind === "ca") {
      const k = `c:${id}`;
      this.full.has(k) ? this.full.delete(k) : this.full.add(k);
      this.sel = rest.slice(0, 2).join(":");
      return cx.notify();
    }
    // Collapse closes the turn and lands on its row, as Esc does.
    if (kind === "nr") {
      const turn = this.findTurn(id);
      if (turn?.answeredIn || turn?.answeredBy) { this.sel = id; this.goToAnswer(turn); return cx.notify(); }
    }
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
    // A click on the line opens it to level 1, or closes it. The info icon at its right end
    // opens the Turn card, or closes it, and leaves the line as it was.
    if (kind === "rhead") {
      const x = this.pressX ?? this.mouseX;
      this.pressX = null;
      if (this.infoHit(x)) {
        this.detailsOpen = !(this.detailsOpen && this.sel === id);
        if (this.detailsOpen) this.keysOpen = false;
        this.sel = id;
        return cx.notify();
      }
      this.toggleLine(id); this.sel = id; return cx.notify();
    }
    // A click on a step group's line opens it to its calls (level 2), or closes it.
    if (kind === "gp") {
      const k = rest.slice(0, 2).join(":");
      this.setGroup(`${k}:${rest[2]}`, !this.groupShown(k, Number(rest[2]), this.findTurn(k), this.isLiveKey(k)));
      this.sel = k;
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
    // A click on an output box selects its turn (Show all under it is its own item, "oa").
    if (kind === "co") {
      this.sel = rest.slice(0, 2).join(":");
      return cx.notify();
    }
    if (["md", "nr", "code", "lh", "sx", "it", "cl", "ws"].includes(kind)) { this.sel = rest.slice(0, 2).join(":"); return cx.notify(); }
  }

  // The icons of the strip under a reply, from the left edge of the list (ui.js actsLayout):
  // copy, and quote when a pane shows a terminal on this computer and the turn has a reply.
  // Select only on a Herdr whose formatted reply cannot be selected. s and t are keys.
  acts(turn) {
    const pane = Boolean(this.pane());
    const quote = pane && !this.terminal.includes("/") && Boolean(turn && this.replyText(turn));
    return actsLayout({ quote, select: !this.replySelectable() });
  }
  barGeom(turn = this.sel ? this.findTurn(this.sel) : null) { return this.acts(turn); }
  // Whether a press at x (column px) is on the info icon at the right end of an open line.
  infoHit(x, w = this.bodyW ?? this.width) {
    if (x == null) return false;
    const b = infoBox(Math.min(replyWidth(w), this.prose()));
    return x >= b[0] - 2 && x <= b[1] + 4;
  }
  barHit(x, turn = this.sel ? this.findTurn(this.sel) : null) {
    if (x == null) return "copy"; // a keyboard or synthetic press
    return boxHit(this.acts(turn), x, ["copy", "quote", "select"]);
  }

  // Keys while the panel has the keyboard. The same actions are commands for keys.json
  // ("agent-threads.next" and so on), delivered through nextCommand().
  // While the settings card is open the pane's root is its key context, so the card's bound Tab
  // and Shift-Tab (CARD_BINDINGS) land here and move the ring, as Tab does in key() when it gets there.
  cardKeyContext(el) {
    let out = maybe(el, "key_context", CARD_CONTEXT);
    for (const [{ action }, step] of [[CARD_BINDINGS[0], "next"], [CARD_BINDINGS[1], "back"]]) {
      out = maybe(out, "on_action", action, (_e, cx) => {
        if (!this.action(`ring:${step}`, cx)) return;
        if ("stop_propagation" in cx) cx.stop_propagation();
        cx.notify();
      });
    }
    return out;
  }
  // Where the keyboard is, for the debug report: "pane" (the panel's own handle, so its keys and
  // the card's reach it), "field:<name>" (a settings card field: fieldFocused, which the fields'
  // focus and blur events and the code that moves the keyboard into one keep), or "elsewhere"
  // (the window moved it on, or another pane has it).
  keyboardAt() {
    if (this.h && "is_focused" in this.h && this.h.is_focused()) return "pane";
    if (this.fieldFocused) return `field:${this.fieldFocused}`;
    return "elsewhere";
  }
  key(e, cx) {
    // Any key wins over a press's pending open (OPEN_WAIT_MS): j, Enter or Esc pressed just
    // after a click acts on its own, and the turn is not opened behind it.
    this.openWait = null;
    // ⌘C in Select view: the editor copies the highlight with its own binding, and the
    // panel says that q now quotes it.
    if (this.selecting && e.keystroke === "cmd-c") this.sawCopy(this.selecting, cx);
    // The settings card: Tab and Shift-Tab move its ring, also out of a field; Enter and Space
    // press the control with the ring, unless it is a field (they type, and Enter keeps a rule).
    const ck = this.settingsOpen ? ringKey(e, Boolean(this.cardRing) && !this.fieldFocused) : null;
    if (ck) {
      if (!this.action(`ring:${ck}`, cx)) return;
      cx.stop_propagation();
      cx.notify();
      return;
    }
    // A field in the settings card has the keyboard: its letters are its own, and one Esc
    // closes the card.
    if (this.fieldFocused) {
      if (e?.key === "escape") {
        if (this.fieldFocused.startsWith("rule-")) this.closeRule();
        else this.closeSettings();
        cx.stop_propagation(); cx.notify();
      }
      return;
    }
    // The settings card is open: the arrows, j, k, Page Up, Page Down, Space, Home and End
    // scroll it, and the list under it stays where it was.
    const card = this.settingsOpen && !this.keysOpen ? cardKey(e) : null;
    if (card) {
      this.action(`settingsScroll:${card}`, cx);
      cx.stop_propagation();
      cx.notify();
      return;
    }
    // The Trajectory's keys are its own (ui.js ledgerKey).
    if (this.traj) {
      const lk = ledgerKey(e);
      if (!lk || !this.ledgerAction(lk, cx)) return;
      cx.stop_propagation();
      cx.notify();
      return;
    }
    const name = keyAction(e, this.filtering, this.quoteKey);
    // While the opening shows the loading state, the list's keys wait: only the settings card,
    // the keys sheet and Esc act.
    if (this.openActive() && name && !["settings", "keys", "escape", "focus"].includes(name)) return;
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
    if (READER_ACTIONS.has(name) || /^(go|pick|search):/.test(name)) this.readerMoved();
    // A key also calls off a step going on by itself (stepHit); a step sets it again.
    if (this.hits) this.hits.step = null;
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
      // Up and down (k and j) follow the rail: they stop only at turns with a tick
      // (railStop), so with Agent messages on the rail off they pass over agent messages.
      // From a turn with no tick (a click selected it) they go to the nearest tick that way;
      // at either end the selection stays. When no turn in the list has a tick (a finished
      // session of agent messages only, with agentRail off), every turn is a stop, as before.
      case "prev": case "next": {
        const d = name === "next" ? 1 : -1;
        const stop = keys.some((k) => this.railStop(k)) ? (k) => this.railStop(k) : () => true;
        let i = at < 0 ? keys.length : at + d;
        if (at < 0) do i--; while (i > 0 && !stop(keys[i]));
        else while (i >= 0 && i < keys.length && !stop(keys[i])) i += d;
        go(i >= 0 && i < keys.length ? i : at);
        return true;
      }
      case "first": go(0); return true;
      case "latest": this.jumpLatest(true); return true;
      // A search: the next match back in time (older) or forward (newer). With no match
      // selected, either goes to the newest. A selected match with no place yet (the scan has
      // not reached it, or a tail is being checked again, hitsTail): the nearest match older
      // or newer than it, by turn order. At either end the selection stays: the search field
      // already says it is the first mention or the newest, and nothing wraps.
      case "olderMatch":
      case "newerMatch": {
        const h = this.hitsNow();
        if (h) return this.stepHit(h, name === "olderMatch");
        const mk = this.matchKeys(keys);
        if (!mk.length) return false;
        const i = mk.indexOf(this.sel);
        const j = i < 0 ? mk.length - 1 : i + (name === "olderMatch" ? -1 : 1);
        if (j < 0 || j >= mk.length) return true;
        go(keys.indexOf(mk[j]));
        // A step never follows, even onto the last row: a match streaming in must not move
        // the reader (setQuery does the same).
        this.follow = false;
        return true;
      }
      case "open":
        // Enter in a "#12" jump: keep the turn selected and leave the field.
        if (jumpTarget(this.query) != null) { this.setSearchField(""); this.query = ""; this.filtering = false; this.h.focus(); return true; }
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
      case "jump": this.filtering = true; this.setSearchField("#"); this.query = "#"; this.input.focus(); return true;
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
      // While a rail card is open, p pins the card's turn, not the selected one.
      case "pin": {
        const card = Popup && this.railHover && this.railShown() ? this.railHover : null;
        if (card || this.sel) this.togglePin(card ?? this.sel, cx);
        return true;
      }
      case "undoUnpin": return this.undoUnpin(cx);
      // The Pinned view header's unpin: the selected pin, directly (not p's rail card first).
      case "unpinSel": if (this.sel) this.unpinButton(this.sel, cx); return true;
      case "pinned": return this.openPinned(cx);
      // Not from the Pinned view or the Pinned column: nothing there offers it.
      case "trajectory": return this.pinnedPane || this.view === "pinned" ? false : this.openTraj();
      case "narrower": return this.resizeColumn(-PIN_STEP, cx);
      case "wider": return this.resizeColumn(PIN_STEP, cx);
      case "fit": return this.fitToReading(cx);
      case "keyHints": this.changePrefs({ keyHints: !this.prefs.keyHints }, cx); return true;
      case "statusLine": this.changePrefs({ statusLine: !this.prefs.statusLine }, cx); return true;
      case "alwaysTime": this.changePrefs({ alwaysShowTime: !this.prefs.alwaysShowTime }, cx); return true;
      case "railSide:left": case "railSide:right": this.railHover = null; this.changePrefs({ railSide: name.slice(9) }, cx); return true;
      case "truncate": this.changePrefs({ truncate: !this.prefs.truncate }, cx); return true;
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
      // i: the Turn card with the selected turn's numbers and what they mean, or closed again.
      // It opens nothing in the list.
      case "legend": {
        if (this.detailsOpen) { this.detailsOpen = false; return true; }
        if (!this.sel || !this.findTurn(this.sel)) return false;
        // Beside the selected turn's Worked for line, brought on screen first. A running
        // turn has no settled line, so nothing to show it beside.
        const at = Popup ? this.detailsAnchor(this.sel) : this.sel;
        if (!at) return false;
        this.detailsOpen = true;
        this.keysOpen = false;
        if (Popup && !this.onScreen(at)) this.scrollTo = { key: at, how: "top" };
        return true;
      }
      case "deeper": return this.deeper(cx);
      case "shallower": return this.shallower(cx);
      case "filter": this.filtering = true; this.settingsOpen = false; this.fieldFocused = null; this.input.focus(); return true;
      case "agents": this.setAgents(!this.prefs.agentTurns, cx); return true;
      // The settings card's switch: no toast, the card shows the change.
      case "agentsQuiet": this.setAgents(!this.prefs.agentTurns, cx, true); return true;
      case "agentRail": this.changePrefs({ agentRail: this.prefs.agentRail !== true }, cx); return true;
      case "agents:on": this.setAgents(true, cx); return true;
      case "agents:off": this.setAgents(false, cx); return true;
      case "settings": if (!this.settingsOpen) cardKeys.ask(cx, "open"); return this.setSettings(!this.settingsOpen);
      case "keys": this.keysOpen = !this.keysOpen; if (this.keysOpen) { this.closeSettings(); this.detailsOpen = false; this.quietRail(); } return true;
      // Every control on the settings card back to its default; link rules, sender rules and the quote key stay.
      case "resetSettings": this.changePrefs(Object.fromEntries(CARD_KEYS.map((k) => [k, DEFAULTS[k]])), cx); this.fitColumn(); return true;
      // The card's keys as commands (for key bindings, and for a window no keys reach).
      case "settingsScroll:down": case "settingsScroll:up": case "settingsScroll:pagedown": case "settingsScroll:pageup":
      case "settingsScroll:home": case "settingsScroll:end":
        if (!this.settingsOpen) return false;
        this.cardScrollBy(name.slice(15));
        return true;
      case "settingsPage:links": case "settingsPage:senders": case "settingsPage:main": if (!this.settingsOpen) return false; this.dropField(); this.leaveLinks(); this.setPage = name.slice(13); return true;
      // The settings card's Tab, Shift-Tab and Enter or Space (key, ringKey).
      case "ring:next": case "ring:back": return this.settingsOpen && this.moveRing(name === "ring:next" ? 1 : -1);
      case "ring:press": return this.settingsOpen && this.pressRing(cx);
      case "escape":
        if (this.detailsOpen) { this.detailsOpen = false; return true; }
        if (this.keysOpen) { this.keysOpen = false; return true; }
        if (this.settingsOpen && this.ruleEdit) { this.closeRule(); return true; }
        if (this.settingsOpen) { this.closeSettings(); return true; }
        if (this.choosing) { this.choosing = false; return true; }
        if (this.selecting) { this.endSelect(); return true; }
        if (this.filtering || this.query) { this.setSearchField(""); this.query = ""; this.filtering = false; this.h.focus(); return true; }
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
    // What a drag does once it passes DRAG_SLOP, for the rig, which has no pointer.
    if (this.debug && name === "debugLift") { this.holdForSelect(); this.liftFill(this.sel); cx?.notify(); return true; }
    // Tests only: "debugRailJump:3" is a click on the turn #3 tick (railJump), and reports
    // the tick's height in px (railJumpAt) for the rig to compare with where the turn lands.
    if (this.debug && name.startsWith("debugRailJump:")) {
      const n = name.slice(14);
      this.railTicks();
      const k = this.railMemo?.all.find((x) => String(x.turns[0].turn.n) === n);
      if (!k) return true;
      this.railJumpAt = this.railTickY(k.key);
      this.railClick(k.key, cx);
      return true;
    }
    // Tests only: "debugRailCard:3" opens the rail card of the turn #3 tick, as a hover
    // would ("debugRailCard:-" closes it), since the test window has no pointer.
    if (this.debug && name.startsWith("debugRailCard:")) {
      const n = name.slice(14);
      if (n === "-") { this.railHover = null; return true; }
      this.railTicks();
      const i = this.railMemo?.all.findIndex((k) => String(k.turns[0].turn.n) === n) ?? -1;
      this.railHover = i >= 0 ? this.railMemo.all[i].key : null;
      if (i >= 0 && !this.railTicks().ticks.some((k) => k.i === i)) { this.railReveal(i, { notify() {} }); }
      return true;
    }
    // Tests only: "debugScroll:md:0:7:4" puts that list item at the top, as a person's scroll would.
    if (this.debug && name.startsWith("debugScroll:")) { this.readerMoved(); this.scrollTo = { key: name.slice(12), how: "land", person: true }; this.scrollSeenAt = Date.now(); return true; }
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
      this.setSearchField(this.query);
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
        const sideIds = new Set([PIN_MAP_KEY, TRAJ_MAP_KEY].flatMap((k) => Object.values(shared(k) ?? {})).map((v) => v.pane));
        const mains = threads.filter((p) => !sideIds.has(p.pane));
        if (focusedOne ? me?.pane === focusedOne.pane : threads.length === 1 || !me || (mains.length === 1 && !this.sideKey() && mains[0].pane === me.pane)) {
          this.command(c, cx);
        }
      }
    });
  }

  // A command bound in keys.json (next, previous and the like) is a key by another road: like
  // key(), it wins over a press's pending open (OPEN_WAIT_MS).
  // In the Trajectory, the list's commands move through the ledger instead (LEDGER_CMD).
  command(name, cx) {
    this.openWait = null;
    const acted = this.traj ? this.ledgerAction(LEDGER_CMD[name] ?? name, cx) : this.action(name, cx);
    // props().debug: the last command's own name (the part before any colon, so a search's
    // text never reaches the report) and whether it acted, for test/herdr-still.sh: Herdr
    // answers ok for any agent-threads.<name>, one we have or not.
    if (this.debug) this.lastCommand = { n: (this.lastCommand?.n ?? 0) + 1, name: String(name).split(":")[0], acted: Boolean(acted) };
    if (acted) cx.notify();
  }

  // Pins the pane to a transcript the person picked from the guesses.
  pick(c, cx) {
    this.dropCode();
    this.endSelect();
    this.resolveGen = (this.resolveGen ?? 0) + 1;
    this.pinned = c.path;
    this.pinnedVia = "picked";
    this.choosing = false;
    this.dropAnchor();
    this.sessions = [];
    this.senderHits = null;
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
      n: turn.n, agent: Boolean(turn.agent), who: turn.agent ? senderLabel(turn.sender, 400) : "User", origin: senderOrigin(turn.sender),
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

  // ---- the output viewer --------------------------------------------------------------
  // A tool's output longer than the panel holds (OUT.MAX lines) opens full window, outside the
  // list, as images do: its call, then all of the output the transcript reader kept, wrapped,
  // in a read-only editor that colours it (outLang) and scrolls on its own. Esc or Close
  // shuts it.
  openOutput(r) {
    const c = this.callEntry(r.si, r.id);
    if (!c?.out) return false;
    const n = String(c.out).replace(/\n+$/, "").split("\n").length;
    openOverlay({ mod: MOD, kind: "dialog", frame: "none", width: 1, height: 1, props: { output: {
      title: `#${r.turn?.n ?? ""} · ${r.name}`, cmd: this.short(callText(r.name, c.input)).slice(0, 400),
      text: String(c.out), lines: n, total: Math.max(n, Number(c.lines) || 0), lang: outLang(c.out, c.input, toolKind(r.name)),
    } } });
    this.outputOpened = { key: r.key, lines: n };
    return true;
  }
  // A Mermaid block drawn as text art (diagram.js) in the same viewer, unwrapped and with no
  // line numbers so the drawing keeps its shape. The editor draws indent guides in leading
  // spaces, which would stripe the space left of a box: those are no-break spaces instead.
  // A kind the renderer cannot draw, or source it cannot read, opens the source with a
  // plain note saying so.
  openDiagram(r) {
    const src = String(r.seg?.text ?? "").replace(/\n+$/, "");
    const d = drawDiagram(src);
    const text = d.art ? d.art.replace(/^ +/gm, (m) => "\u00a0".repeat(m.length)) : src;
    const n = text.split("\n").length;
    openOverlay({ mod: MOD, kind: "dialog", frame: "none", width: 1, height: 1, props: { output: {
      title: `#${r.turn?.n ?? ""} · ${d.art ? "Diagram" : "Mermaid source"}`, cmd: "", note: d.error ?? "", wrap: !d.art, numbers: !d.art,
      text, lines: n, total: n, lang: "text",
    } } });
    this.diagramOpened = { key: r.key, drawn: Boolean(d.art) };
    return true;
  }
  initOutput(p, cx) {
    const o = p.output ?? {};
    // The viewer takes the keyboard, so Esc closes it.
    this.h = cx.focus_handle();
    cx.timer.after(0, () => this.h.focus());
    this.outv = { overlay: p.overlay ?? null, title: String(o.title ?? ""), cmd: String(o.cmd ?? ""), text: String(o.text ?? ""),
      lines: Number(o.lines) || 0, total: Number(o.total) || 0, st: null, note: String(o.note ?? ""), wrap: o.wrap !== false, numbers: o.numbers !== false };
    try {
      this.outv.st = EditorState.new({
        language: o.lang || "text", value: this.outv.text, readonly: true, line_numbers: this.outv.numbers, folding: false, soft_wrap: this.outv.wrap,
        font_family: settings().font_family, font_size: 12, syntax: this.syntaxColors(theme()),
      });
    } catch (e) {
      console.log(`agent-threads: no editor for the output viewer: ${e?.message ?? e}`);
    }
  }
  outputClose() { if (this.outv?.overlay) closeOverlay(this.outv.overlay); }
  outputView() {
    const t = theme();
    const o = this.outv;
    const mono = this.mono();
    const lines = o.total > o.lines ? `the first ${o.lines.toLocaleString()} of ${o.total.toLocaleString()} lines` : plural(o.lines, "line");
    // The wheel over the output scrolls it alone: the box stops the event (as the rail does).
    // If that stop does not hold, the output still scrolls; there is no list under it.
    const body = o.st ? Editor.new(o.st).size_full()
      : v_flex().id("th-output-plain").size_full().px(10).py(8).overflow_y_scrollbar().text_size(12).font_family(mono).text_color(t.muted)
        .children(o.text.split("\n").slice(0, 5000).map((l) => div().w_full().min_h(18).line_height("18px").when(!o.wrap, (el) => el.whitespace_nowrap()).child(l || " ")));
    return v_flex().id("th-output").size_full().bg(t.background)
      .track_focus(this.h)
      .on_key_down((e) => { if ((e?.key ?? "") === "escape") this.outputClose(); })
      .child(h_flex().h(VIEWER.TOP).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
        .child(svg(ICON("square-terminal")).size(15).flex_none().text_color(t.muted))
        .child(div().flex_none().text_size(13).text_color(t.foreground).child(o.title))
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_family(mono).text_color(t.muted).child(o.cmd))
        .child(div().flex_none().text_size(12).text_color(t.dim).child(lines))
        .child(this.galleryButton(t, "th-output-close", "x", "Close (Esc)", null, false, null, () => this.outputClose())))
      .when(o.total > o.lines, (el) => el.child(div().flex_none().px(16).py(6).text_size(12).text_color(t.dim)
        .child("Threads reads the first 24 KB of a tool's output from the transcript; the rest is not shown here.")))
      .when(Boolean(o.note), (el) => el.child(div().flex_none().px(16).py(6).text_size(12).text_color(t.dim).child(o.note)))
      .child(div().id("th-output-body").flex_1().min_h(0).p(12)
        .on_scroll_wheel((_e, cx) => cx.stop_propagation())
        .child(div().size_full().rounded(6).border_1().border_color(t.border).overflow_hidden().child(body)));
  }
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
    const reply = g.blocks.length
      ? g.blocks.map((b, k) => div().w_full().when(k > 0, (el) => el.pt(Math.round((12 * rt.size) / 13))).text_size(rt.size).line_height(`${rt.line}px`)
        .child(g.code?.[k] ? this.galleryCode(t, g.code[k], k, L) : this.readFont(div().w_full().opacity(READ_INK)).child(TextView.markdown(`th-gallery-md-${k}`, b).selectable(false).w_full())))
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
  // inside, and says so). Rows are wrapped at the panel's text width, less the box's border
  // and the editor's inset, at 12 px mono (codePer in the list).
  galleryCode(t, c, k, L) {
    const mono = this.mono();
    const copied = this.gal.codeCopied === k;
    const textW = L.wide ? L.panelW - 2 * L.padX : Math.min(VIEWER.MEASURE, L.stageW - 2 * L.padX);
    const rows = Math.max(1, codeRows(c.text, (textW - 18) / (12 * MONO_EM)));
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
        .child(c.st ? Editor.new(c.st).size_full().py(6) : this.plainCode(t, `th-gallery-code-${k}`, c.text, mono, true)))
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
  // A run of quote lines ("> ") is drawn as the bubble draws it: without the marker, muted
  // and smaller, behind one bar (an absolute box as tall as the run, since its lines wrap).
  galleryPrompt(t, turn, rt, L) {
    const g = this.gal;
    const shown = g.images[g.i]?.n;
    // The prompt's lines as promptParts segments them: a pasted block's wrapper tags are
    // gone and its body is verbatim, so a shell transcript's ">" lines keep their marker.
    const entries = promptParts(String(turn.prompt ?? ""), 1000).flatMap((r) => r.lines.map((l) => ({ text: l, quote: r.quote, paste: Boolean(r.paste) })));
    const lines = entries.slice(0, 400);
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
    const line = (text, li, color = ink) => {
      const pieces = labelPieces(text);
      if (!pieces.some((p) => p.n != null)) return div().min_h(rt.line).text_color(color).child(text || " ");
      return h_flex().flex_wrap().min_h(rt.line).items_center().children(pieces.flatMap((p, k) => (p.n != null ? [tag(p, li, k)]
        : p.t.split(/(?<=\s)/).filter(Boolean).map((w) => div().text_color(color).child(w.replace(/\s$/, " "))))));
    };
    const sub = turn.sub ?? t.muted;
    const blocks = [];
    for (let li = 0; li < lines.length; li++) {
      if (!lines[li].quote) { blocks.push(line(lines[li].text, li)); continue; }
      const quoted = [];
      for (; li < lines.length && lines[li].quote; li++) quoted.push(line(lines[li].text, li, sub));
      li--;
      blocks.push(div().relative().min_w(0).pl(QUOTE_INSET).text_size(rt.small)
        .child(div().absolute().left(0).top(3).bottom(3).w(2).rounded(1).bg(turn.agent ? sub : alpha(ink, 0.28)))
        .children(quoted));
    }
    const body = this.readFont(v_flex().min_w(0).text_size(rt.size).line_height(`${rt.line}px`))
      .when(Boolean(turn.cmd), (el) => el.child(div().text_color(turn.sub ?? t.muted).font_family(this.mono()).text_size(12.5).child(turn.cmd)))
      .children(blocks)
      .when(entries.length > lines.length, (el) => el.child(div().text_size(11.5).italic().text_color(turn.sub ?? t.dim).child(`… ${plural(entries.length - lines.length, "more line")} not shown`)))
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

  // A render that did not reach its end was stopped by Herdr (an error is caught and clears the
  // mark): the next CUT_MS draw without reshaping or measuring, so the pane gets a frame.
  render(cx) {
    if (this.drawingRow) this.rowCut(this.drawingRow);
    // A placement's lift (letGo) is for the one layout that lands it, gone before anything in
    // this frame builds the list's heights.
    if (this.anchorLift || this.anchorSlot) { this.anchorLift = 0; this.anchorSlot = null; this.fitKey = null; }
    if (this.renderOpen) {
      this.renderOpen = false;
      this.cutUntil = now() + CUT_MS;
      this.renderCuts = (this.renderCuts ?? 0) + 1;
      // A scroll the stopped render took on (the jump to the newest turn, a return to a pin)
      // is asked for again: it was taken before the list was drawn.
      if (this.renderWant?.toBottom) this.toBottom = true;
      if (this.renderWant?.scrollTo && !this.scrollTo) this.scrollTo = this.renderWant.scrollTo;
      // Counted at once: a render that is stopped too would never reach the end of the frame.
      this.publishCuts();
      // The scan's next draw, asked for in the stopped render: its timer may never run, and
      // its mark would keep this render from asking again (scanStep).
      this.scanNext = false;
    }
    // Herdr asks for no render after one it stopped: the 120 ms timer asks for the next.
    this.renderWant = { toBottom: this.toBottom, scrollTo: this.scrollTo };
    const light = this.cutUntil > now();
    this.renderAt = now();
    // One budget a draw; while rows are built over several draws (rowJob), one for them all,
    // as before.
    if (!this.rowJob) this.shapeSpent = 0;
    const spent = this.shapeSpent ?? 0;
    this.buildSpent = 0;
    this.scanSpent = 0;
    this.shapeFrame = (this.renders ?? 0) + 1;
    this.renderOpen = true;
    let out;
    try { out = this.frame(cx, light); } catch (e) { this.renderOpen = false; throw e; }
    this.renderOpen = false;
    const rw = this.rewrap;
    if (rw) {
      rw.ms += now() - this.renderAt;
      if (!this.rowJob && !(this.shapeLeft > 0) && !this.staleRows?.length && !(this.probeLeft > 0)) {
        if (rw.full) this.rewrapMs = rw.ms;
        this.rewrap = null;
      }
    }
    // The draw's cost apart from reshaping, building rows and finding the search's matches sets
    // the next draw's time for them.
    this.frameBase = Math.max(0, now() - this.renderAt - Math.max(0, (this.shapeSpent ?? 0) - spent) - (this.buildSpent ?? 0) - (this.scanSpent ?? 0));
    return out;
  }

  // Reshaping time left for this draw: none while a stopped render is being recovered from.
  shapeMax() {
    if (this.light) return -1;
    if (this.shapeBudget != null) return this.shapeBudget;
    return Math.max(SHAPE_MIN_MS, Math.min(SHAPE_MS, this.frameRoom() / 2));
  }
  // A slice of a rows build.
  buildMax() { return Math.max(BUILD_MIN_MS, Math.min(BUILD_MS, this.frameRoom() / 2)); }
  // A slice of the search's matches.
  scanMax() { return Math.max(SCAN_MIN_MS, Math.min(SCAN_MS, this.frameRoom() / 2)); }
  frameRoom() { return FRAME_AIM_MS - (this.frameBase ?? 0); }
  // One reshaping budget a draw: rows() can be asked for more than once in a draw, and each
  // ask used to start the budget again. Outside a render (tests), each ask starts it.
  shapeStart() {
    if (this.renderOpen && this.shapeFrame === this.renders) return;
    this.shapeSpent = 0;
  }

  frame(cx, light) {
    if (this.gal) return this.galleryView();
    if (this.outv) return this.outputView();
    if (this.launcher) return div();
    this.light = light;
    this.renders = (this.renders ?? 0) + 1;
    this.monoFont = null;
    if (this.stickStep) this.applyStick();
    this.fitColumn();
    // A column held through a drag (fitColumn): a draw once the pane has been still.
    if (this.widthHeld && !this.holdNext) {
      this.holdNext = true;
      cx.timer.after(Math.max(0, REWRAP_PAUSE_MS - (Date.now() - (this.sizeAt ?? 0))) + 5, (cx) => { this.holdNext = false; cx.notify(); });
    }
    this.react(cx);
    // Here and not in rows(): the timing report changes the selection for a moment.
    if (this.pinVisit && this.sel !== this.pinVisit) this.pinVisit = null;
    if (this.pinResume && this.sel !== this.pinResume.key) this.pinResume = null;
    if (this.pinAgain && this.sel !== this.pinAgain) this.pinAgain = null;
    this.publishDrawError(cx);
    this.publishCuts();
    // The Trajectory, in its own pane or in this one: the ledger only, with its own list.
    if (this.traj) return this.trajFrame(cx);
    this.rows();
    // A slice of the search's matches, before anything in the draw reads them.
    this.scanStep(cx);
    this.syncOutEditors(cx);
    // Rows left with their old shape (SHAPE_MS): the next frame goes on with them.
    // A rows build left for later slices (buildStep): the next frame goes on with it.
    if (this.rowJob && !this.buildNext) {
      this.buildNext = true;
      cx.timer.after(0, (cx) => { this.buildNext = false; cx.notify(); });
    }
    if ((this.shapeLeft > 0 || this.staleRows?.length) && !this.shapeNext) {
      this.shapeNext = true;
      cx.timer.after(this.light ? Math.max(0, this.cutUntil - now()) : 0, (cx) => {
        this.shapeNext = false;
        // Closed rows are reshaped where they are; interim texts and estimates left out of
        // time are in open turns, which a rebuild brings back.
        // Only the open and running turns are built again (spliceRows), or every row if not.
        if (this.otherLeft) { this.againOpen = true; this.rowsKey = this.rowsKey == null ? null : "again"; } else this.reshapeDue = true;
        cx.notify();
      });
    }
    const t = theme();
    const focusedPanel = this.h.is_focused() || this.input && this.filtering;
    if (this.debug) this.measure();
    const floating = this.floating();
    const banners = this.banners(t);
    // The day at the top of the list, read before the list draws (body), for the day pill.
    this.stickyNow = null;
    const root = v_flex()
      .id("threads-root")
      .track_focus(this.h)
      // The pointer in the pane: the floating top shows its icons. Leaving it, it is on no
      // pin's row (hoverPin).
      .on_hover((on, cx) => {
        if (!on && this.hoverPin) { this.hoverPin = null; cx.notify(); }
        if (Boolean(on) !== Boolean(this.paneHover)) { this.paneHover = Boolean(on); cx.notify(); }
      })
      .on_key_down((e, cx) => this.key(e, cx))
      .when(this.settingsOpen, (el) => this.cardKeyContext(el))
      .on_modifiers_changed((e, cx) => this.cmdUp(e, cx))
      // Zoomed px from on_size_change, design px everywhere else (zoom()).
      .on_size_change((size, cx) => {
        const h = size.height / this.zoom();
        if (Math.abs(h - this.rootH) > 1) { this.rootH = h; cx.notify(); }
        const w = size.width / this.zoom();
        this.measuredWidth = size.width;
        if (!this.forcedWidth && Math.abs(w - (this.paneW ?? -9)) > 1) { this.paneW = w; this.sizeAt = Date.now(); this.fitColumn(); this.shareWidth(); cx.notify(); }
      })
      .size_full().min_h(0).relative()
      .bg(t.background).text_color(t.foreground).text_size(13)
      .when(!floating, (el) => el.child(this.header(t)).children(banners))
      .when(floating && this.topBlock(banners), (el) => el.child(this.topPanels(t, banners)))
      .child(this.body(t, focusedPanel, cx))
      .when(floating, (el) => el.child(this.floatTop(t, focusedPanel)))
      .when(Boolean(this.prefs.keyHints), (el) => el.child(this.footer(t)))
      .when(this.statusShown(), (el) => el.child(this.statusRow(t)))
      .when(this.pillShown(), (el) => el.child(this.pillView(t)))
      .when(!Popup && Boolean(this.detailsTurn()), (el) => el.child(this.detailsView(t)))
      .when(this.keysOpen, (el) => el.child(this.keySheetView(t)))
      .when(this.settingsOpen, (el) => el.child(this.settingsCard(t, cx)))
      .when(Boolean(this.toast), (el) => el.child(this.toastView(t)));
    // A sender rule's count the card above left for the next draw (senderMatches). Taken
    // here each draw, so once the editor is not drawn (closed, its page left, the card
    // closed) or its draft stops compiling, no next draw is asked for.
    // The count's progress holds the sessions and turns it read: a draw that drew no count
    // drops it, so a closed editor, or sessions the pane no longer follows, are not kept.
    if (!this.senderHitsDrawn) this.senderHits = null;
    this.senderHitsDrawn = false;
    if (this.senderHitsLeft) {
      this.senderHitsLeft = false;
      if (!this.countNext) {
        this.countNext = true;
        cx.timer.after(0, (cx) => { this.countNext = false; cx.notify(); });
      }
    }
    return root;
  }

  // props().debug: how long the last full build of the rows took (buildMs, its slices added
  // up; a splice of opened or closed turns is not counted, and it reads 0.0 before the first
  // build), a memoised ask, and whether alpha() reads every colour of every theme. Asked before
  // the first draw (report), the memo figure can include that first build. It builds nothing
  // itself: a build forced on every draw left a long session's rows mid-build at the start of
  // each draw, so the reshaping time never came back (render), and the rows stayed blank while
  // the pane drew about 40 times a second.
  measure() {
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
    this.timing = `rows ${(this.buildMs ?? 0).toFixed(1)} ms · memo ${(c - b).toFixed(2)} ms · move ${((d - c) / 2).toFixed(2)} ms · ${this.rowsMemo.length} items · alpha ${this.alphaOk}`;
  }

  narrow() { return this.width < 300; }
  // The pane's own width, and the column the turns are laid out in (ui.js columnWidth): the
  // text, at most a reading line, with the side gutters left and right of it, centred. Before
  // the pane has measured itself (and in tests that set width) both are this.width.
  pw() { return this.paneW ?? this.width; }
  // The pane's px as Herdr's layout gives it (the frame in), which the compact Trajectory goes
  // by: rounded as everywhere else, so a 200 px pane at zoom 1.25 (199.99) is 200.
  trajPx() { return Math.round(this.pw()) + PANE_FRAME; }
  fitColumn() {
    if (this.forcedWidth || this.paneW == null) return;
    const step = this.paneStep();
    const w = columnWidth(this.paneW, this.prefs.textSize, step);
    if (Math.abs(w - this.width) <= 0.5 && step === this.colStep) { this.widthHeld = false; return; }
    // The pane resized less than REWRAP_PAUSE_MS ago: the column keeps its width, centred in a
    // wider pane and cut off on the right in a narrower one, until it is still (frame asks
    // for a draw then). The first width the pane measures is taken at once.
    if (this.colFit && this.baseRows && Date.now() - (this.sizeAt ?? 0) < REWRAP_PAUSE_MS && this.rewrapCostly()) { this.widthHeld = true; return; }
    const first = !this.colFit;
    this.width = w;
    this.colStep = step;
    this.colFit = true;
    this.widthHeld = false;
    // The re-wrap's draw time is counted (render) until nothing is left to build, shape or
    // measure. A full one: no layout kept for this width.
    if (!first) this.rewrap = { ms: 0, full: !this.keptBases?.has(this.sigBase()) };
    // The place on screen is kept across the rows built for it (buildStep, takeAnchor).
    if (!first) this.anchorDue = true;
  }
  rewrapCostly() {
    if (this.rewrap && this.rewrap.ms > HOLD_WORK_MS) return true;
    if (this.rewrapMs != null) return this.rewrapMs > HOLD_WORK_MS;
    return this.sessions.reduce((n, x) => n + x.turns.length, 0) > HOLD_TURNS;
  }
  // How far the column sits in from the pane's left edge.
  colLeft() { return Math.max(0, (this.pw() - this.width) / 2); }
  // From the pane's edge to the text: the side gutter.
  side() { return this.colLeft() + ROW.PAD_X; }
  // Opened by Cmd-Shift-T: once the pane and the settings are read, a pane wider than the
  // reading width (its step's, readingPx) shrinks to it. A narrower one keeps what it was given.
  fitOnOpen() {
    if (this.paneW == null || !this.prefsLoaded) return;
    const me = this.me();
    const map = shared(FIT_KEY);
    if (!me || !map?.[me.pane]) return;
    const { [me.pane]: _, ...rest } = map;
    setShared(FIT_KEY, rest);
    // The split halved the terminal's room between it and this pane, at equal weights: the
    // row is twice this pane's first width, while the tab has the two of them alone (openRow).
    const sib = this.rowSibling(me);
    this.openRow = sib ? { sib, room: 2 * (this.paneW + PANE_FRAME) } : null;
    const px = this.readingPx();
    if (this.paneW > px + 2) this.sizeTo(px);
    else this.toWeight();
  }
  // The column's step (ui.js columnStep), from the pane's px size (its measured width and the
  // frame, as Herdr and a person count it): the step the pane wants now (paneStep), and the
  // one the column shows (chars), which follows it in fitColumn, held through a drag as the
  // width is. 70 until the pane has measured itself.
  paneStep() { return columnStep(this.paneW == null ? NaN : this.paneW + PANE_FRAME, this.prefs.textSize, this.colStep ?? null); }
  chars() { return this.colStep ?? STEPS[0]; }
  // The width of the column's step, its line and the widest gutters (ui.js fitWidth): what w
  // and the fit button size the pane to, and what Cmd-Shift-T opens it at.
  readingPx() { return fitWidth(this.prefs.textSize, this.colStep ?? this.paneStep()); }
  // Herdr 0.1.16 drags a divider by setting the px of the pane beside it that has a px size
  // (window.rs drag_to), and the panes sized by weight share what is left, those past the
  // other edge too: a Threads pane at a px width grows or shrinks from both edges, whichever
  // one is dragged. A pane at a weight moves only the divider dragged, and changes with the
  // window. So after each px resize this pane asks for (sizeTo), and when Threads opens, a
  // split fails or the Pinned column closes, the main pane goes to a weight that keeps its
  // width (toWeight), once the pane has been still for 300 ms. Never on a size change alone,
  // which may be a drag still going on: after a drag the pane never resizes itself, and its
  // column steps with it (fitColumn). Not in the Pinned or the Trajectory pane, not with
  // either open beside it (- and = keep both at px; it converts when that pane closes), and
  // not zoomed (it converts once unzoomed).
  sizeTo(px) {
    const me = this.me();
    if (!me) return;
    this.weighing = null;
    // At a weight until now: that weight and the width it gives are a measure of the row as
    // it is (the window may have changed size), for the next weight's first ask.
    if (this.weightNow != null && this.paneW != null) this.lastPoint = [this.weightNow, this.paneW + PANE_FRAME];
    this.weightNow = null;
    run("layout.resize", { id: me.pane, px });
    this.weighAfter = { px, until: Date.now() + 1500 };
  }
  // The px applied (or 1.5 s gone by) and the width still for 300 ms, so a window being
  // resized is not measured: the weight. The column closed: 500 ms for the row to settle.
  weighSoon() {
    const a = this.weighAfter;
    const still = Date.now() - (this.sizeAt ?? 0) >= 300;
    if (a && this.paneW != null && still && (Math.abs(this.paneW + PANE_FRAME - a.px) <= 2 || Date.now() > a.until)) { this.weighAfter = null; this.toWeight(); }
    // Unzoomed: 500 ms for the row to settle, as after the column closes.
    if (this.weighZoomed) {
      const me = this.me();
      if (me && !me.zoomed) { this.weighZoomed = false; this.weighAt = Date.now() + 500; }
    }
    if (this.weighAt != null && Date.now() >= this.weighAt) { this.weighAt = null; this.toWeight(true); }
  }
  // The one other pane in this pane's tab, when there is exactly one: the terminal the split
  // came from, and with it the whole row. Else null.
  rowSibling(me) {
    const under = this.trajBottomId();
    const others = panes().filter((p) => p.tab === me.tab && p.pane !== me.pane && p.pane !== under);
    return others.length === 1 ? others[0].pane : null;
  }
  // The first weight of the probe after Threads opens: the row it measured at the split, and
  // the terminal beside it set to weight 1 so the others' weights are known, give the weight
  // for n0 at once. With no measure or line, weight 1 would lay the pane out at the terminal's
  // weight against an unknown one, up to the whole row's width for a moment (the owner saw it
  // open wide). Only while the tab still holds the two panes alone and the row has room past
  // n0. Used once.
  openWeight(me, n0) {
    const o = this.openRow;
    this.openRow = null;
    if (!o || o.room <= n0 || this.rowSibling(me) !== o.sib) return null;
    run("layout.resize", { id: o.sib, weight: 1 });
    return Number((n0 / (o.room - n0)).toPrecision(5));
  }
  // weightNow: the weight this pane last set and has kept since. A drag changes it but leaves
  // a weight, so there is nothing to do; force: the column was open, and its pane may have
  // set this one's px (- and =, w).
  toWeight(force = false) {
    if ((this.weightNow != null && !force) || this.weighing || this.weighAfter || this.sideKey() || this.paneW == null || this.splitAsk || this.pinnedPaneOpen() || this.trajRightOpen()) return;
    const me = this.me();
    if (!me) return;
    if (me.zoomed) { this.weighZoomed = true; return; }
    // Herdr's px size for a pane is its measured width and its frame.
    const n0 = this.paneW + PANE_FRAME;
    const p = this.lastPoint;
    this.lastPoint = null;
    this.weightNow = null;
    const w = (p ? weightNear(this.weighLine, p, n0) : weightFor(this.weighLine, n0)) ?? this.openWeight(me, n0);
    this.openRow = null;
    this.weighing = { pane: me.pane, n0, tried: [], w: w ?? 1 };
    this.askWeight();
  }
  askWeight() {
    const g = this.weighing;
    g.at = this.paneW;
    g.asked = Date.now();
    run("layout.resize", { id: g.pane, weight: g.w });
  }
  // A mod cannot read the weights beside it, so the weight comes from measures (ui.js
  // weightLine): the first from the row as last measured (or 1), the second from one
  // measure, the third from two. It stops at the first within 2 px. A weight that leaves the
  // width as it was shows no size change, so 400 ms with none counts as a measure.
  weighStep() {
    const g = this.weighing;
    if (!g) return;
    const me = this.me();
    // Gone, zoomed, a column or the Trajectory opening, or no answer from Herdr: stop there.
    if (!me || me.pane !== g.pane || me.zoomed || this.splitAsk || this.pinnedPaneOpen() || this.trajRightOpen() || Date.now() - g.asked > 3000) {
      this.weighing = null;
      if (me?.zoomed) this.weighZoomed = true;
      return;
    }
    if (Math.abs(this.paneW - g.at) <= 1 && Date.now() - g.asked < 400) return;
    const n = this.paneW + PANE_FRAME;
    g.tried.push([g.w, n]);
    // The same width at two weights, not the one asked: no other pane in the row is on a
    // weight (a terminal at px), so this one takes all the room at any weight. Back to the
    // width it had, in px, and no weight.
    const [q1, q2] = g.tried.slice(-2);
    if (g.tried.length > 1 && Math.abs(q1[1] - q2[1]) <= 1 && Math.abs(q1[0] - q2[0]) > 1e-4 && Math.abs(n - g.n0) > 2) {
      this.weighing = null;
      this.weightNow = null;
      run("layout.resize", { id: g.pane, px: g.n0 });
      return;
    }
    if (g.tried.length > 1) this.weighLine = weightLine(...g.tried.slice(-2)) ?? this.weighLine;
    const w = Math.abs(n - g.n0) <= 2 || g.tried.length > 2 ? null
      : g.tried.length === 1 ? weightNear(this.weighLine, g.tried[0], g.n0)
      : weightFor(this.weighLine, g.n0);
    if (!w) { this.weighing = null; this.weightNow = g.w; return; }
    g.w = w;
    this.askWeight();
  }
  // w, or the header's fit button: Threads to its column's step's width (readingPx), and an
  // open Pinned column to its own width for that, wider or narrower than they are now.
  fitToReading(cx) {
    const main = this.pinnedPane ? this.mainPane() : this.me();
    if (!main) return false;
    // w sets the Chat's px: the row on weights goes to px for the Trajectory's life.
    this.rowPx(cx, "w");
    const px = this.readingPx();
    if (this.pinnedPane) run("layout.resize", { id: main.pane, px });
    else { this.trajChatBack = null; this.pinChatBack = null; this.chatHome = null; this.sizeTo(px); }
    const col = this.pinnedPane ? this.me() : this.pinnedPaneOpen();
    if (col) {
      setShared(PIN_W_KEY, { ...(shared(PIN_W_KEY) ?? {}), hold: Date.now() + 1500 });
      run("layout.resize", { id: col.pane, px: pinColumn(px, this.keptPinWidth()) ?? PIN_COL[0] });
      this.pairPx(1500, false);
    }
    this.say(`Threads at the reading width, ${px} px`, "fold-horizontal", cx);
    return true;
  }
  // Wider than the reading width by more than a little: the header offers the fit button.
  tooWide() { return !this.sideKey() && this.paneW != null && this.paneW > this.readingPx() + 8; }

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
  // Read once a draw: every Turn card on screen asks for it.
  mono() { return (this.monoFont ??= settings().font_family ?? "JetBrains Mono"); }

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
  // count, label, dot, off]. A labelled button shows its label instead of an icon; an off one
  // is dimmed and inert. Under 440 px the latest button gives way, and under 300 px the
  // agents button too (End and a still act), so the turn count keeps its room beside
  // "Pinned 2". The list has no pin button: p and the pin on an open turn's top line pin, so
  // the session's title keeps that room. A Pinned view (the Pinned pane, or Pinned in this
  // pane) has an unpin button for the selected pin: it needs no row's place, so it is the
  // one click that unpins while the list scrolls and the rows' own buttons hide.
  headerButtons() {
    const c = this.counts();
    const pins = this.pinnedList().length;
    const sel = this.sel && this.pinnedList().some((p) => p.key === this.sel) ? this.findTurn(this.sel) : null;
    const pk = this.quoteKey === "p" ? "" : " (p)";
    // With no pin selected it stays in its place, dimmed and inert, so the header never shifts.
    const pinBtn = ["th-pin", "pin-off", sel ? `Unpin #${sel.n}${pk}` : `Select a pin to unpin it${pk}`, "unpinSel", false, null, null, false, !sel];
    // The Pinned pane keeps it under 300 px too, where the count reads "1/7" beside it
    // (headerText).
    if (this.pinnedPane) return [pinBtn, ["th-pinned", null, "Back to Threads, all turns (v)", "pinned", false, null, "All turns"]];
    const narrow = this.narrow();
    const showAgents = (c.agentAll > 0 || this.prefs.agentTurns) && !narrow;
    const out = [["th-search", "search", "Filter (/)", "filterToggle", this.filtering || Boolean(this.query), null, null]];
    if (showAgents) {
      const on = Boolean(this.prefs.agentTurns);
      out.push(["th-agents", "bot", on ? "Hide agent messages (a)" : `Show agent messages (${this.agentCountText(c)}) (a)`, "agents", on,
        countLabel(on ? c.agentAll : c.hiddenAll + c.foldedAll), null]);
    }
    // Pinned in this pane: under 300 px the count keeps the room, and p unpins.
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

  // A header button with nothing to act on (the unpin with no pin selected): in its place at
  // its size, dimmed, with its tooltip, no hover fill or pointer, and a click that goes no
  // further and does nothing.
  offButton(t, id, icon, tip) {
    return div().id(id).flex_none().size(24).flex().items_center().justify_center().rounded(5)
      .text_color(t.dim).opacity(0.4)
      .tooltip(tip)
      .on_click((_e, cx) => cx.stop_propagation())
      .child(svg(ICON(icon)).size(14));
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
    // None while the opening covers the list: a Done above "Reading this session" read as over.
    if (!s?.loaded || this.openActive() || this.res.kind === "unsupported" || this.res.kind === "remote") return null;
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
    // The session's totals, summed again only when the session changed (every event read
    // bumps its version): summed on every draw, they took a seventh of Herdr's time for a
    // draw in a session of 2,000 turns.
    // Done turns before the newest are summed once (kept while the turn at their end is the
    // same object), and only the turns after them again.
    const v = `${s.id}|${s.version}|${s.turns.length}`;
    if (this.usageMemo?.v !== v) {
      const u = this.usageMemo;
      const keep = u && u.s === s && u.stable <= s.turns.length && (u.stable === 0 || s.turns[u.stable - 1] === u.mark);
      const base = keep ? [...u.base] : [0, 0, 0, 0];
      const add = (acc, t) => { for (const x of Object.values(t.usage)) { acc[0] += x.i ?? 0; acc[1] += x.o ?? 0; acc[2] += x.cr ?? 0; acc[3] += x.cc ?? 0; } };
      let k = keep ? u.stable : 0;
      while (k < s.turns.length - 1 && s.turns[k].done) add(base, s.turns[k++]);
      const sum = [...base];
      for (let j = k; j < s.turns.length; j++) add(sum, s.turns[j]);
      this.usageMemo = { v, s, stable: k, mark: s.turns[k - 1] ?? null, base, input: sum[0], output: sum[1], cr: sum[2], cc: sum[3] };
    }
    const { input, output, cr, cc } = this.usageMemo;
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
    if (!s.loaded) return s.error ? "Read failed" : `Reading…${this.readPct(s) != null && !this.openActive() ? ` ${this.readPct(s)}%` : ""}`;
    // Read, and the list still drawn hidden under the opening's loading state (which says how
    // much is read, so neither repeats the percentage).
    if (this.openActive()) return "Reading…";
    // The Pinned view: "3 of 7", after the Pinned heading (pinnedHeading); "3/7" in the
    // Pinned pane under 300 px, beside its unpin button.
    if (this.view === "pinned") return `${this.pinnedList().length}${this.pinnedPane && this.narrow() ? "/" : " of "}${PIN_LIMIT}`;
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

  // The search field and the banners sit in the flow under the band, so the state and the
  // icons float over empty room and never over a control. Settings is a card over the list.
  topBlock(banners) { return this.filtering || Boolean(this.query) || banners.length > 0; }
  topPanels(t, banners) {
    return v_flex().id("th-top").flex_none().pt(TOP_BAND)
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
    const text = st ? null : s?.loaded && !this.openActive() ? null : this.headerText() || null;
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
    const traj = this.trajPaneOpen();
    const trajTip = traj ? "Go to the Trajectory (y)" : this.pw() >= TRAJ_SPLIT_MIN ? "Open the Trajectory beside the Chat (y)" : "Show the Trajectory in this pane (y)";
    return [
      ["th-search", "search", "Search (/)", "filterToggle", this.filtering || Boolean(this.query), null],
      // The quote key may be y: then the button still opens it, and its tip names no key.
      ["th-traj", "list", this.quoteKey === "y" ? trajTip.replace(" (y)", "") : trajTip, "trajectory", Boolean(traj), null],
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
        .children(this.headerButtons().map(([id, icon, tip, act, on, count, label, dot, off]) => {
          if (off) return this.offButton(t, id, icon, tip);
          const click = this.headerClick(act);
          return label ? this.labelButton(t, id, label, tip, click, on) : this.iconButton(t, id, icon, tip, click, on, count, dot);
        })))
      .when(this.filtering || Boolean(this.query), (el) => el.child(this.searchField(t)));
  }

  // A header or floating-top button's click: the search button opens or closes the field
  // (Esc and the field's x close it too), the rest are actions.
  headerClick(act) {
    return (_e, cx) => {
      if (act === "filterToggle") {
        this.readerMoved();
        this.filtering = !this.filtering;
        this.settingsOpen = false;
        if (this.filtering) this.input.focus();
        else { this.setSearchField(""); this.query = ""; this.h.focus(); }
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
        .on_mouse_down("left", (_e, cx) => { if (!this.filtering) this.readerMoved(); this.filtering = true; cx.notify(); })
        .child(svg(ICON("search")).size(13).flex_none().text_color(t.dim))
        .child(Input.new(this.input).flex_1().min_w(0).h_full().text_size(12.5).text_color(t.foreground))
        .when(!q, (el) => el.child(this.kbd(t, "/")))
        .when(Boolean(q), (el) => el.child(div().id("th-search-count").flex_none().text_size(11.5).font_family(this.mono()).text_color(t.dim)
          .child(this.filterCount())))
        .when(Boolean(this.filterText()) && this.matchPlace().n > 0, (el) => el.children(this.stepButtons(t)))
        .child(this.iconButton(t, "th-clear", "x", "Clear (Esc)", (_e, cx) => { this.readerMoved(); this.setSearchField(""); this.query = ""; this.filtering = false; this.h.focus(); cx.notify(); }));
  }

  // The search field's two steps: older (up, the way back through the list) and newer. The
  // one with no match left that way is dimmed, takes no press, and its tooltip says so.
  stepButtons(t) {
    const { at, n } = this.matchPlace();
    // While the matches are counted the older step stays on: more can come (scanStep).
    const more = this.view !== "pinned" && this.hits && !this.hits.done;
    const step = (id, icon, tip, name, off, none) => off
      ? div().id(id).flex_none().size(24).flex().items_center().justify_center().opacity(0.35).text_color(t.dim).tooltip(none).child(svg(ICON(icon)).size(14))
      : this.iconButton(t, id, icon, tip, (_e, cx) => { this.action(name, cx); cx.notify(); });
    return [
      step("th-match-older", "chevron-up", "Older match (n)", "olderMatch", at === n && !more, "No older match"),
      step("th-match-newer", "chevron-down", "Newer match (Shift n)", "newerMatch", at === 1, "No newer match"),
    ];
  }

  // Where the selection is among the search's matches, counted from the newest, and what the
  // older step reaches: "2 of 7 · newest first", "7 of 7 · first mention", "1 of 1 · only
  // mention", or "7 matches" with no match selected; then matches among hidden agent
  // messages. In a pane under 420 px, the place alone ("first" at the oldest). For "#12":
  // where it went.
  filterCount() {
    const n = jumpTarget(this.query);
    if (n != null) return !n ? "turn #" : this.jumpKey(n) ? `turn ${n}` : `no turn ${n}`;
    const q = this.filterText();
    // Less than a search: how much to type, in the count's place.
    if (!q) return this.query.trim() ? (this.pw() < 420 ? "2 or more" : "Type 2 or more characters") : null;
    let hit = 0, hiddenHit = 0;
    // While the matches are counted (scanStep): "Counting…" with none found yet, and the total
    // so far with a "+"; the hidden ones, no match, and the first or only mention wait for
    // the last turn checked (the words below the counting ones).
    let more = false;
    // The Pinned view shows every pin, agent message or not, and nothing else: the matches
    // are the pins the search matches. Elsewhere the kept set (hitsNow).
    if (this.view === "pinned") hit = this.matchKeys().length;
    else {
      const h = this.hitsNow();
      hit = h.top - h.bot;
      more = !h.done;
      hiddenHit = h.hidden;
    }
    const hidden = hiddenHit ? ` · ${hiddenHit} hidden` : "";
    if (!hit) return more ? "Counting…" : `No matches${hidden}`;
    const { at, n: all } = this.matchPlace();
    const tight = this.pw() < 420;
    if (more) return !at ? `${all.toLocaleString()}+ matches` : tight ? `${at} of ${all}+` : `${at} of ${all}+ · newest first`;
    if (!at) return `${all.toLocaleString()} ${all === 1 ? "match" : "matches"}${hidden}`;
    const end = all === 1 ? "only mention" : at === all ? "first mention" : "newest first";
    if (tight) return `${at} of ${all}${at === all && all > 1 ? " · first" : ""}`;
    return `${at} of ${all} · ${end}${hidden}`;
  }

  // ---- the settings card (, or the sliders icon) ----
  // A card over the list, under the icons at the top right, CARD_W wide at most (the pane
  // less 12 px each side when narrower). The keys sheet's two pieces: a clear layer over the
  // pane closes it on a press anywhere else in the pane, and the card stops the press. A press
  // in another pane closes it too (on_mouse_down_out), if Herdr delivers it. One page: the
  // title stays put while the rows scroll under it, and the session's line and "? keys" sit
  // at the foot. It opens at the top. No preview: a change shows in the list behind the card.
  // Spacing (settings-spacing): every band has the same side inset (cardPad), so the title,
  // the labels and the foot share one left edge and the controls one right edge.
  // While it is open nothing under it reacts (covered()), and the wheel moves only the card:
  // the clear layer keeps the wheel from the list. No scrim, so the colors and the text size
  // are chosen against the real list; the border and a deep shadow mark the layer.
  settingsCard(t, cx = null) {
    const close = (_e, cx) => { cx.stop_propagation(); this.closeSettings(); cx.notify(); };
    // A rules page (Link rules or Sender rules) has the head with Back, and no tabs or preview.
    const page = this.setPage === "links" || this.setPage === "senders" ? this.setPage : null;
    const h = this.rootH || 600;
    const fixed = CARD_HEAD + CARD_FOOT + 2;
    // Under the icons at the top, unless the pane is too short for the head and foot there:
    // then the card moves up, so they stay inside the pane (TRD-7).
    const top = Math.max(0, Math.min(this.floating() ? TOP_BAND : 46, h - CARD_GAP - fixed));
    const under = Math.max(this.footSpace() + CARD_GAP, Math.min(CARD_STRIP, h - (CARD_STRIP_MIN - CARD_STRIP)));
    // At least 180 px, over the key hints if it must, but never past the pane's bottom (less
    // the gap): in a very short pane the rows shrink first, to nothing if need be.
    const room = Math.max(Math.min(180, h - top - CARD_GAP), h - top - under);
    const w = this.setCardW();
    const pad = cardPad(w);
    const bodyMax = Math.max(0, room - fixed);
    // The rows' own height, as last drawn on this page and tab, up to the room left.
    const key = page ?? "main";
    const rowsH = this.cardBody?.key === key ? this.cardBody.h : null;
    const bodyH = Math.min(bodyMax, rowsH ?? bodyMax);
    // Built top to bottom (the foot last, in place), so the controls take their places in
    // Tab's order as drawn.
    this.cardStops = [];
    const head = this.cardHead(t, page, close, pad);
    const rows = () => (page === "links" ? this.linkRulesRows(t, w) : page === "senders" ? this.senderRulesRows(t, w) : this.settingsRows(t, w));
    const place = this.cardPlace(key);
    place.viewH = bodyH;
    // When the rows get shorter (a rule closes), the place stays inside them, as Herdr's own
    // scroll does; a scroll to the ring is worked out from there.
    if (rowsH != null) place.y = Math.max(0, Math.min(place.y, rowsH - bodyH));
    const handle = this.cardScrolls?.[key] ?? null;
    const id = `th-set-body-${key}-${this.cardOpens}`;
    // Child 0 is the rows; the marks after it are what the keys bring into view (cardMarks).
    const marks = handle && rowsH ? cardMarks(rowsH) : [];
    const wheel = (from) => (e) => this.cardWheel(e, key, from);
    const body = v_flex().id(id).flex_none().h(bodyH)
      .when(this.cardBar, (el) => el.overflow_y_scroll()).when(!this.cardBar, (el) => el.overflow_y_scrollbar())
      .when(Boolean(handle), (el) => el.track_scroll(handle))
      .on_scroll_wheel(wheel("area"))
      .child(this.cardCol(v_flex().id(`th-set-rows-${key}`).flex_none().px(pad).py(16).gap(20)
        .on_size_change((size, cx) => {
          const h = size.height / this.zoom();
          if (this.cardBody?.key !== key || Math.abs(this.cardBody.h - h) > 1) { this.cardBody = { key, h, shape: this.cardRoot?.shape ?? null }; cx.notify(); }
        })
        .on_scroll_wheel(wheel("rows")), 20, 16, rows(), key))
      .children(marks.map((y) => div().absolute().top(y).left(0).w(1).h(1)));
    const card = div().id("th-set-catch").absolute().top(0).left(0).right(0).bottom(0)
      .on_click(close)
      // The card's own scroll runs first (it is drawn over this layer); the wheel stops here.
      .on_scroll_wheel((_e, cx) => cx.stop_propagation())
      .child(v_flex().id("th-set-card").absolute().top(top).right(CARD_GAP).w(w)
        .rounded(8).border_1().border_color(t.border).bg(this.solidFill(t)).shadow_2xl()
        .on_click((_e, cx) => cx.stop_propagation())
        // A pointer press anywhere on the card takes the keyboard ring away.
        .on_mouse_down("left", (_e, cx) => { if (this.cardRing) { this.cardRing = null; cx.notify(); } })
        .on_mouse_down_out((_e, cx) => { if (this.settingsOpen) { this.closeSettings(); cx.notify(); } })
        .child(head)
        // The always-drawn bar sits in a strip at the right edge, so it takes no press meant
        // for a row.
        .child(this.cardBar
          ? div().relative().flex_none().h(bodyH).child(body)
            .child(div().absolute().top(0).bottom(0).right(0).w(CARD_BAR_W).child(gpuiBase.Scrollbar.vertical(id).mode("always").absolute().top(0).bottom(0).left(0).right(0)))
          : body)
        .child(this.cardFoot(t, pad)));
    this.placeRing(cx);
    this.revealRing(cx, key);
    return card;
  }
  // For the debug report: where the card's view is on its page (view: y from the rows' top,
  // and its height) and where the control with the ring is in the rows (ringAt: top and
  // bottom, or null in the head or foot or before it is measured).
  cardView() {
    const key = this.setPage === "links" || this.setPage === "senders" ? this.setPage : "main";
    const place = this.cardPlace(key);
    const i = this.cardRing ? (this.cardStops ?? []).findIndex((s) => s.id === this.cardRing) : -1;
    return { view: { y: place.y, h: place.viewH }, ringAt: i >= 0 && this.cardRoot ? this.ringSpan(this.cardRoot, i) : null };
  }
  // A column of the card's rows whose controls the card can scroll into view for the ring.
  // Its kids (elements, or functions that build an element or a list of them) are built in
  // order, so the ring's stops each one adds are known (from and to in cardStops). A kid
  // that is itself a column is linked (cols), and its height is the sum of its parts; every
  // other part's height is kept as it draws, by the part (cardSizes) and by its place in the
  // column (cardSlots). A part's key is its kid's place in the list it was built from, its
  // place in what that kid returned, and the first control it holds, so a row that comes or
  // goes elsewhere leaves the other parts' heights right. A part that is new and not measured
  // yet takes the height last measured in its place, which Herdr may not report again when
  // it did not change; revealRing checks the sum against the rows' measured height. pad is
  // the column's padding and border at the top and again at the bottom; gap the space
  // between its parts.
  cardCol(el, gap, pad, kids, path = this.cardKidPath ?? "card") {
    const node = { el: null, gap, pad, path, items: [], keys: [], cols: [], shape: "" };
    const els = [];
    const owners = [];
    // A kid that returns CardParts is several kids, each its own part (a row with controls
    // under it, such as Shorten long messages and its line steppers).
    const add = (k, n) => {
      const from = (this.cardStops ?? []).length;
      const at = els.length;
      this.cardKidPath = `${path}/${n}`;
      this.cardColLast = null;
      const out = typeof k === "function" ? k() : k;
      if (out instanceof CardParts) { out.kids.forEach((x, m) => add(x, `${n}-${m}`)); return; }
      const inner = this.cardColLast;
      const list = [out].flat().filter(Boolean);
      if (!list.length) return;
      const to = (this.cardStops ?? []).length;
      const first = to > from ? this.cardStops[from].id : "";
      const col = list.length === 1 && inner?.el === list[0] ? inner : null;
      const item = { from, to, first: at, last: at + list.length - 1, child: col };
      list.forEach((_x, j) => { node.keys.push(`${path}/${n}.${j}:${first}`); node.cols.push(col); owners.push(item); });
      els.push(...list);
      node.items.push(item);
    };
    kids.forEach((k, n) => add(k, n));
    this.cardKidPath = null;
    node.shape = node.keys.map((k, j) => (node.cols[j] ? `${k}{${node.cols[j].shape}}` : k)).join(",");
    const sizes = (this.cardSizes ??= {});
    const slots = (this.cardSlots ??= {});
    const sized = els.map((x, i) => {
      if (node.cols[i]) return x;
      const k = node.keys[i];
      const slot = `${path}#${i}`;
      const onSize = (size, cx) => {
        const h = size.height / this.zoom();
        slots[slot] = h;
        if (Math.abs((sizes[k] ?? -1) - h) <= 0.5) return;
        sizes[k] = h;
        if (this.ringShow) cx.notify();
      };
      // For the tests: the part's key, its place, and the controls it holds (cardItem).
      onSize.cardPath = k;
      onSize.cardSlot = slot;
      onSize.cardItem = owners[i];
      return x.on_size_change(onSize);
    });
    node.el = el.children(sized);
    this.cardColLast = node;
    // The rows' own column (a page's key, no slash) is where a search for the ring starts.
    if (!path.includes("/") && path !== "card") this.cardRoot = node;
    return node.el;
  }
  // The height of a column's part j, and of a whole column: null while one it needs has not
  // been measured.
  cardPartH(node, j) {
    if (node.cols[j]) return this.cardColH(node.cols[j]);
    return this.cardSizes?.[node.keys[j]] ?? this.cardSlots?.[`${node.path}#${j}`] ?? null;
  }
  cardColH(node) {
    let sum = 2 * node.pad;
    for (let j = 0; j < node.keys.length; j++) {
      const h = this.cardPartH(node, j);
      if (h == null) return null;
      sum += h + (j > 0 ? node.gap : 0);
    }
    return sum;
  }
  // Where the control at stop i is in the card's rows: [top, bottom] from the rows' top, or
  // null when it is not in them (the head and foot always show) or a height it needs has not
  // been measured yet.
  ringSpan(node, i, y = 0, head = false) {
    const it = node?.items.find((x) => i >= x.from && i < x.to);
    if (!it) return null;
    let at = y + node.pad;
    for (let j = 0; j < it.first; j++) {
      const h = this.cardPartH(node, j);
      if (h == null) return null;
      at += h + node.gap;
    }
    if (it.child) {
      const span = this.ringSpan(it.child, i, at, head);
      // With head, a control in an open rule stands for the whole rule, so a scroll to it
      // shows as much of the rule as fits, from its first line.
      if (!span || !head || !it.child.ruleShell) return span;
      const h = this.cardColH(it.child);
      return [at, h == null ? span[1] : Math.max(span[1], at + h)];
    }
    let end = at;
    for (let j = it.first; j <= it.last; j++) {
      const h = this.cardPartH(node, j);
      if (h == null) return null;
      end += h + (j < it.last ? node.gap : 0);
    }
    return [at, end];
  }
  // The ring moved: a scroll to it is pending (ringShow), for this page, from now. id: a
  // control to show in place of the ring's; head: the whole open rule holding it (ruleShell),
  // from its first line, as much as fits.
  askReveal(id = null, head = false) { this.ringShow = { key: this.cardPageKey(), at: Date.now(), id, head }; }
  cardPageKey() { return this.setPage === "links" || this.setPage === "senders" ? this.setPage : "main"; }
  // After the ring moves (ringShow), the card scrolls so the control with it shows in full
  // (cardReveal), by bringing one mark into view as the keys do, from the next frame. Nothing
  // moves when it shows already, or for a control in the head or foot. It waits for the
  // heights it needs, for REVEAL_WAIT at the most; the user's own scroll (the wheel or the
  // keys), another page or closing the card drops it. Nothing else shows.
  revealRing(cx, key) {
    const want = this.ringShow;
    if (!want) return;
    if (want.key !== key || Date.now() - want.at > REVEAL_WAIT) { this.ringShow = null; return; }
    const id = want.id ?? this.cardRing;
    const i = id ? this.cardStops.findIndex((s) => s.id === id) : -1;
    const root = this.cardRoot;
    const handle = this.cardScrolls?.[key] ?? null;
    if (i < 0 || !handle || !root?.items.some((x) => i >= x.from && i < x.to)) { this.ringShow = null; return; }
    // The rows' height as drawn, once it is known to fit their parts as they are now: measured
    // since they last changed, or equal to the sum of their parts. Until then it waits, so a
    // scroll is never worked out from a height a row that came or went has made stale.
    const h = this.cardBody?.key === key ? this.cardBody.h : null;
    const sum = this.cardColH(root);
    const fresh = h != null && sum != null && (Math.abs(h - sum) <= 2 || this.cardBody.shape === root.shape);
    const span = fresh ? this.ringSpan(root, i, 0, want.head) : null;
    if (!span) return;
    this.ringShow = null;
    const place = this.cardPlace(key);
    const r = cardReveal(span[0], span[1], place.y, h, place.viewH);
    if (!r) return;
    place.y = r.y;
    const go = () => handle.scroll_to_item(1 + r.mark);
    if (cx?.timer) cx.timer.after(0, (cx) => { go(); cx.notify(); });
    else go();
  }
  // The ring's control was not drawn this time (a press or a file change took it away, and no
  // press said where the ring goes): the ring goes to the control that now follows where it
  // was, after the last one before it that is still drawn, passing over text fields (which
  // would take the keyboard). It shows from the next frame, which a frame's context asks for.
  placeRing(cx) {
    if (!this.cardRing) return;
    const ids = this.cardStops.map((s) => s.id);
    if (ids.includes(this.cardRing)) { this.ringIds = ids; return; }
    const old = this.ringIds ?? [];
    let j = old.indexOf(this.cardRing);
    if (j < 0) j = old.length;
    let i = 0;
    while (--j >= 0) if (ids.includes(old[j])) { i = ids.indexOf(old[j]) + 1; break; }
    const stops = this.cardStops;
    while (i < stops.length && stops[i].field) i++;
    this.cardRing = stops[i]?.id ?? [...stops].reverse().find((s) => !s.field)?.id ?? null;
    this.askReveal();
    this.ringIds = ids;
    cx?.timer.after(0, (cx) => cx.notify());
  }
  setCardW() { return Math.max(200, Math.min(CARD_W, this.pw() - 2 * CARD_GAP)); }
  // Where the card's view is on a page (y, from the top of its rows), as the keys left it and
  // the wheel moved it since, and the view's height as last drawn. A new opening starts over.
  cardPlace(key) { return ((this.cardPlaces ??= {})[key] ??= { y: 0, viewH: 0 }); }
  // A key or a settingsScroll command: the view moves a line, a page, or to the top or end
  // (cardScroll), by bringing one mark into view. Nothing happens on a Herdr with no
  // ScrollHandle, or before the rows have been measured.
  cardScrollBy(kind) {
    this.ringShow = null;
    const key = this.cardPageKey();
    const handle = this.cardScrolls?.[key];
    const h = this.cardBody?.key === key ? this.cardBody.h : null;
    const place = this.cardPlace(key);
    const r = handle && h ? cardScroll(kind, place.y, h, place.viewH) : null;
    if (!r) return false;
    place.y = r.y;
    handle.scroll_to_item(1 + r.mark);
    return true;
  }
  // The wheel or trackpad moved the card: its place follows, so the keys go on from there.
  // The rows and the area both listen (the area's own scrolling may stop the event before
  // the area's listener runs); the same event reaching both counts once.
  cardWheel(e, key, from) {
    const dy = Number(e?.delta?.y) || 0;
    if (!dy) return;
    this.ringShow = null;
    const place = this.cardPlace(key);
    const k = `${e?.position?.x},${e?.position?.y},${dy},${e?.touch_phase}`;
    if (from === "area" && place.wheelKey === k) return;
    place.wheelKey = from === "rows" ? k : null;
    const h = this.cardBody?.key === key ? this.cardBody.h : 0;
    place.y = Math.max(0, Math.min(Math.max(0, h - place.viewH), place.y - dy));
  }

  // The close and back buttons sit 5 px out, so their glyphs (not their boxes) are on the inset.
  // The settings key (,) is in the sliders icon's tooltip and on the keys sheet.
  cardHead(t, page, close, pad) {
    const back = (_e, cx) => { this.dropField(); this.leaveLinks(); this.setPage = "main"; this.ringMove(page === "senders" ? "th-set-senders" : "th-set-links"); cx.notify(); };
    return h_flex().flex_none().h(CARD_HEAD).px(pad).gap(8).items_center().border_b(1).border_color(t.border)
      .when(Boolean(page), (el) => el.child(this.cardStop(this.iconButton(t, "th-set-back", "chevron-left", "Back to settings", back).ml(-5), t, "th-set-back", back, { radius: 5, label: "Back to settings" })))
      .child(div().flex_1().min_w(0).truncate().text_size(14).font_semibold().text_color(t.foreground).child(page === "links" ? "Link rules" : page === "senders" ? "Sender rules" : "Settings"))
      .child(this.cardStop(this.iconButton(t, "th-set-close", "x", "Close (Esc)", close).mr(-5), t, "th-set-close", close, { radius: 5, label: "Close" }));
  }

  // The card's foot, under the scroll: the mod's name and version (versionRow), and "? keys",
  // the way to every key while the key hints are off. The chat's agent, counts and title
  // were here with the floating top; the owner wants the version here, and the chat's stats
  // are now the status line at the pane's foot (statusRow).
  cardFoot(t, pad) {
    const keys = (_e, cx) => { cx.stop_propagation(); this.action("keys", cx); cx.notify(); };
    return h_flex().id("th-set-foot").flex_none().h(CARD_FOOT).px(pad).gap(8).items_center().border_t(1).border_color(t.border)
      .child(this.versionRow(t))
      .child(this.cardStop(h_flex().id("th-set-keys").flex_none().gap(4).items_center().cursor_pointer().tooltip("Every key (?)")
        .on_click(keys)
        .child(this.kbd(t, "?")).child(div().flex_none().text_size(12).text_color(t.muted).child("keys")), t, "th-set-keys", keys, { radius: 4, label: "Every key" }));
  }

  // The pieces every row of the card is made of. A row is 28 px high at least, 4 px from the
  // next in its group; a group's label is 6 px over its first row, and groups are 20 px apart
  // (the rows' gap). Text a person reads is muted at the faintest; dim is for decoration.
  cardKit(t) {
    const label = (text) => div().flex_1().min_w(0).text_size(13).text_color(t.foreground).child(text);
    const note = (text, color = t.muted) => div().text_size(12).line_height("16px").text_color(color).child(text);
    // A group is a column (cardCol); its kids may be functions that build them.
    const group = (title, kids) => this.cardCol(v_flex().gap(4), 4, 0,
      [div().pb(2).text_size(11).font_semibold().text_color(t.muted).child(title), ...kids]);
    // 32 by 18 with a 14 px knob. Off, the track has a `muted` outline, since the track alone
    // barely shows on the card (full `muted`, so the edge reaches 3:1 on light themes too); the
    // outline takes a px of the padding so the knob stays put.
    const toggle = (on) => div().flex_none().w(32).h(18).rounded(9).flex().items_center()
      .when(on, (el) => el.p(2).justify_end().bg(t.ansi5))
      .when(!on, (el) => el.p(1).bg(t.border).border_1().border_color(t.muted))
      .child(div().size(14).rounded(7).bg(on ? t.background : t.muted));
    // A switch row: the whole row flips it.
    const sw = (id, text, on, act, value = null) => {
      const press = (_e, cx) => { cx.stop_propagation(); this.action(act, cx); cx.notify(); };
      return this.cardStop(h_flex().id(id).min_h(28).gap(8).items_center().cursor_pointer()
        .on_click(press)
        .child(label(text))
        .when(Boolean(value), (el) => el.child(div().flex_none().text_size(12).text_color(t.muted).child(value)))
        .child(toggle(on)), t, id, press, { role: "switch", label: text });
    };
    const step = (id, icon, act, ok, name) => {
      const press = (_e, cx) => { cx.stop_propagation(); if (ok) this.action(act, cx); cx.notify(); };
      return this.cardStop(div().id(id).flex_none().size(24).flex().items_center().justify_center().rounded(6)
        .border_1().border_color(t.border).bg(t.background).cursor_pointer()
        .when(!ok, (el) => el.opacity(0.4))
        .hover((s) => s.bg(t.hover))
        .on_click(press)
        .child(svg(ICON(icon)).size(12).text_color(t.muted)), t, id, press, { label: name });
    };
    const stepper = (key, name) => {
      const [lo, hi] = RANGES[key];
      const v = this.prefs[key];
      return h_flex().min_h(28).gap(6).items_center()
        .child(label(name))
        .child(step(`th-${key}-minus`, "minus", `${key}:-`, v > lo, `${name} down`))
        .child(div().flex_none().w(20).text_center().text_size(13).font_family(this.mono()).text_color(t.foreground).child(String(v)))
        .child(step(`th-${key}-plus`, "plus", `${key}:+`, v < hi, `${name} up`));
    };
    // A chooser: each choice its icon and its word, the chosen one filled. 28 px high, as a row.
    const choose = (id, cur, opts, act) => h_flex().flex_none().p(2).gap(2).rounded(6).border_1().border_color(t.border).bg(t.background)
      .children(opts.map(([v, word, icon]) => {
        const press = (_e, cx) => { cx.stop_propagation(); this.action(`${act}:${v}`, cx); cx.notify(); };
        return this.cardStop(h_flex().id(`${id}-${v}`).flex_none().h(22).px(8).gap(5).items_center().rounded(4).cursor_pointer()
          .text_size(12).bg(v === cur ? t.hover : alpha(t.hover, 0)).text_color(v === cur ? t.foreground : t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(press)
          .child(svg(ICON(icon)).size(13).flex_none())
          .child(word), t, `${id}-${v}`, press, { radius: 4, role: "radio_button" });
      }));
    const row = (text, ctl) => h_flex().min_h(28).gap(8).items_center().flex_wrap().child(label(text)).child(ctl);
    return { label, note, group, sw, stepper, choose, row, toggle };
  }

  // Reset to defaults, once, at the end of the page: every control on the card, faded when
  // every one is at its default. Link rules, sender rules and the quote key are never
  // touched, which the line under the button says.
  resetRow(t) {
    const differ = this.prefsDiffer();
    const { note } = this.cardKit(t);
    const reset = (_e, cx) => { if (differ) this.action("resetSettings", cx); cx.notify(); };
    return v_flex().gap(6).items_start()
      .child(this.cardStop(this.button(t, "th-set-reset", "Reset to defaults", reset, "refresh", CARD_BUTTON)
        .when(!differ, (el) => el.opacity(0.45)), t, "th-set-reset", (e, cx) => { cx.stop_propagation(); reset(e, cx); }))
      .child(note("Link rules, sender rules and the quote key stay."));
  }
  prefsDiffer() { return CARD_KEYS.some((k) => this.prefs[k] !== DEFAULTS[k]); }

  // The card is one page (settings-structure-review, order B): Messages, Agent messages,
  // Layout, Links and keys and File, in that order (CARD_SECTIONS), then Reset once. No tabs, no preview: a change
  // shows in the list behind the card as it is made.
  settingsRows(t, w) {
    const P = this.prefs;
    const { note, group, sw, stepper, choose, row } = this.cardKit(t);
    const qn = this.quoteNote();
    // Each row by its key in CARD_SECTIONS; a row may be more than one element.
    const rows = {
      textSize: () => [stepper("textSize", "Text size")],
      userColor: () => [this.colorRow(t, "bubbleColor", "User message color", w)],
      agentColor: () => [this.colorRow(t, "agentBubbleColor", "Agent message color", w)],
      agents: () => {
        const hidden = !P.agentTurns && this.sessions.length ? this.agentCountText(this.counts()).replace(", ", " · ") : "";
        return [sw("th-set-agents", "Show agent messages", Boolean(P.agentTurns), "agentsQuiet", hidden || null)];
      },
      agentRail: () => [sw("th-set-agent-rail", "Agent messages on the rail", P.agentRail === true, "agentRail")],
      truncate: () => new CardParts([
        () => sw("th-set-truncate", "Shorten long messages", Boolean(P.truncate), "truncate"),
        () => (P.truncate ? this.cardCol(v_flex().pl(16).gap(4), 4, 0, [() => stepper("promptLines", "Prompt lines"), () => stepper("replyLines", "Reply lines")]) : null),
      ]),
      time: () => [sw("th-set-time", "Always show time", Boolean(P.alwaysShowTime), "alwaysTime")],
      railSide: () => [row("Rail side", choose("th-rail", this.railLeft() ? "left" : "right", [["left", "Left", "panel-left"], ["right", "Right", "panel-right"]], "railSide"))],
      keyHints: () => [sw("th-set-hints", "Key hints at the bottom", Boolean(P.keyHints), "keyHints")],
      statusLine: () => [sw("th-set-status", "Chat stats at the bottom", P.statusLine !== false, "statusLine")],
      linkRules: () => [this.linkRulesEntry(t)],
      senderRules: () => [this.senderRulesEntry(t)],
      quoteKey: () => [v_flex().gap(4)
        .child(row("Quote key", this.cardStop(h_flex().id("th-set-quote").flex_none().w(36).h(24).px(6).items_center().rounded(6)
          .border_1().border_color(this.fieldFocused === "quote" ? t.accent : t.border).bg(t.background)
          .child(maybe(Input.new(this.quoteInput), "tab_stop", false).w_full().h_full().text_size(13).font_family(this.mono()).text_color(t.foreground)),
        t, "th-set-quote", null, { field: { input: this.quoteInput, name: "quote" } })))
        .when(Boolean(qn), (el) => el.child(note(qn, this.quoteDraft != null && this.quoteDraft !== this.quoteKey ? t.muted : t.blocked)))],
      file: () => [this.fileRow(t, w), this.prefsError ? note(this.prefsError, t.blocked) : null],
    };
    return [...CARD_SECTIONS.map(([name, keys]) => () => group(name, keys.map((k) => () => rows[k]()))), () => this.resetRow(t)];
  }

  // A row that opens a rules page: its name, how many rules the file holds (or None), how
  // many are not working in the blocked color, and a chevron. Each page has its own row
  // method, so the row can move to another section on its own (CARD_SECTIONS).
  pageEntry(t, id, page, name, n, bad) {
    const open = (_e, cx) => { cx.stop_propagation(); this.dropField(); this.leaveLinks(); this.setPage = page; this.ringMove("th-set-back"); cx.notify(); };
    return this.cardStop(h_flex().id(id).min_h(28).gap(8).items_center().cursor_pointer().rounded(6)
      .hover((s) => s.bg(t.hover))
      .on_click(open)
      .child(div().flex_1().min_w(0).text_size(13).text_color(t.foreground).child(name))
      .child(div().flex_none().text_size(12).text_color(t.muted).child(n ? String(n) : "None"))
      .when(bad > 0, (el) => el.child(div().flex_none().text_size(12).text_color(t.blocked).child(`${bad} not working`)))
      .child(svg(ICON("chevron-right")).size(13).flex_none().text_color(t.dim)), t, id, open, { label: name });
  }
  linkRulesEntry(t) {
    const bad = (this.linkList ?? []).filter((r) => r.why || r.rule?.slow).length;
    return this.pageEntry(t, "th-set-links", "links", "Link rules", this.linkCount ?? 0, bad);
  }
  senderRulesEntry(t) {
    const bad = (this.senderList ?? []).filter((r) => r.why).length;
    return this.pageEntry(t, "th-set-senders", "senders", "Sender rules", this.senderCount ?? 0, bad);
  }

  // A message color: its name, then a dot for each preset (ui.js BUBBLES) and, when the file
  // holds one, its own #rrggbb. The color's name is the dot's tooltip; the chosen one has a
  // ring. Each dot is 24 px across (a 16 px color in a 2 px ring and 2 px of air), 2 px apart.
  // On one line with the name when they fit beside its 96 px; else the name above and the dots
  // 6 px under it, from the left edge. Plain, and a color drawn as an outline, get a muted
  // edge, since their fill alone barely shows on the card.
  colorRow(t, key, name, w) {
    const cur = this.prefs[key];
    const agent = key === "agentBubbleColor";
    const names = Object.keys(BUBBLES);
    const list = cur.startsWith("#") ? [...names, cur] : names;
    const word = (v) => (v.startsWith("#") ? v : `${v[0].toUpperCase()}${v.slice(1)}`);
    const dotsW = list.length * SWATCH + (list.length - 1) * 2;
    const oneLine = 96 + 8 + dotsW <= w - 2 * cardPad(w);
    const dots = h_flex().flex_none().gap(2).flex_wrap().children(list.map((v) => {
      const st = bubbleStyle(v, t, agent);
      const on = v === cur;
      const press = (_e, cx) => { cx.stop_propagation(); this.action(`${key}:${v}`, cx); cx.notify(); };
      return this.cardStop(div().id(`th-${key}-${v}`).flex_none().size(SWATCH).rounded(SWATCH / 2).p(2).cursor_pointer()
        .border_2().border_color(on ? t.accent : alpha(t.accent, 0))
        .tooltip(`${word(v)}${v === DEFAULTS[key] ? " · default" : ""}`)
        .on_click(press)
        .child(div().size_full().rounded(8).bg(st.fill).border_1().border_color(st.outline || v === "plain" ? t.muted : st.fill)),
      // A rounded square, not a circle, so it is not taken for the chosen color's ring.
      t, `th-${key}-${v}`, press, { radius: 5, role: "radio_button", label: `${name}: ${word(v)}` });
    }));
    const title = div().text_size(13).text_color(t.foreground).child(name);
    return oneLine
      ? h_flex().id(`th-${key}-row`).min_h(28).gap(8).items_center().child(title.flex_1().min_w(96)).child(dots)
      : v_flex().id(`th-${key}-row`).gap(6).child(title).child(dots);
  }

  // The settings file: its path, cut at a slash from its start so it begins with a whole
  // folder (cutPath), with the whole path in its tooltip, and Copy path, which says "Copied"
  // in its own place. Under a 320 px card the button says Copy.
  fileRow(t, w) {
    const copied = this.copied?.id === "settings-path";
    const word = copied ? "Copied" : w < 320 ? "Copy" : "Copy path";
    const path = tilde(this.prefsPath());
    // The button: its padding and border, the icon and its gap, and the word.
    const button = 2 * CARD_BUTTON.px + 2 + CARD_BUTTON.icon + CARD_BUTTON.gap + Math.ceil(word.length * 12 * 0.55);
    const room = w - 2 * cardPad(w) - 6 - button;
    const copy = (_e, cx) => { this.copy(this.prefsPath(), "settings-path", null, cx, true); cx.notify(); };
    return h_flex().gap(6).items_center()
      .child(div().id("th-set-path").flex_1().min_w(0).truncate().text_size(11.5).font_family(this.mono()).text_color(t.muted)
        .tooltip(path).child(cutPath(path, Math.floor(room / (11.5 * MONO_EM)))))
      .child(this.cardStop(this.button(t, "th-set-copy", word, copy, copied ? "check" : "copy", CARD_BUTTON), t, "th-set-copy", (e, cx) => { cx.stop_propagation(); copy(e, cx); }, { label: "Copy the settings file's path" }));
  }

  // The card's last row: the mod's name and version (version.js), with the commit install.sh
  // found. A plain line, not a control; a copy without a build says the commit is not known,
  // and its tooltip says why. It takes the room "? keys" leaves and truncates in a narrow card,
  // so otherwise its tooltip is the whole line.
  versionRow(t) {
    const line = versionLine(VERSION, this.build === undefined ? built : this.build);
    return div().id("th-set-version").flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).tooltip(line.tip ?? line.text).child(line.text);
  }

  // The quote key field's note: a letter that cannot be the quote key, and why it stays.
  quoteNote() {
    const d = this.quoteDraft;
    const q = this.quoteKey;
    if (d == null || d === q) return this.quoteFileNote ?? null;
    if (d === "") return `Type one letter. The quote key stays ${q}.`;
    if (/^[a-z]$/.test(d)) return `${d} is a Threads key already. The quote key stays ${q}.`;
    return `One letter, a to z. The quote key stays ${q}.`;
  }

  // The Link rules page: what a link rule is, then each rule in the file with its type's
  // icon, its name, its description, its example with the linked part marked and the address
  // that opens, and its switch (or why the mod will not run it). A press on a row opens the
  // rule in place, as Edit does; Delete takes it at once, with Undo. The rules change on the
  // card and in the file alike. Rule cards are 8 px apart (boxes with borders).
  linkRulesRows(t, w) {
    const { note, group } = this.cardKit(t);
    const list = this.linkList ?? [];
    const e = this.ruleEdit?.kind === "links" ? this.ruleEdit : null;
    const edit = this.rulesEditable("links");
    // Notes on the link rules that are not about one rule ("links is not a list").
    const other = (this.linkNotes ?? []).filter((n) => !/^Link rule \d+:/.test(n));
    // Placed first and built in that order, so Tab takes them as drawn.
    const slots = list.map((_r, i) => (e?.at === i ? "edit" : i));
    if (e && e.at == null) slots.splice(Math.min(e.insertAt, slots.length), 0, "edit");
    if (this.ruleUndo?.kind === "links") slots.splice(Math.min(this.ruleUndo.at, slots.length), 0, "undo");
    const rows = slots.map((x) => () => (x === "edit" ? this.ruleEditor(t) : x === "undo" ? this.undoLine(t) : this.ruleRow(t, list[x], x, edit)));
    const add = (_e, cx) => { this.openRule(null); cx.notify(); };
    return [
      note("A link rule turns text in a reply into a link. A rule can make ACME-412 open its ticket.", t.muted),
      () => group(`Rules${list.length ? ` · ${list.length}` : ""}`, [() => (rows.length ? this.cardCol(v_flex().gap(8), 8, 0, rows) : note("No rules yet."))]),
      () => (!list.length && !e && edit ? this.ruleExamples(t) : null),
      ...other.map((n) => note(n, t.blocked)),
      list.length >= 2 ? note("When two rules match the same text, the higher one wins.") : null,
      () => (edit && !e && list.length < MAX_RULES
        ? h_flex().child(this.cardStop(this.button(t, "th-rule-add", "Add rule", add, "plus", CARD_BUTTON), t, "th-rule-add", (e, cx) => { cx.stop_propagation(); add(e, cx); })) : null),
      () => group("File", [
        note(edit ? "Rules are kept under \"links\" in the settings file. A change made there shows here within a second."
          : writable(this.prefsRaw) ? "\"links\" in the settings file is not a list now, so rules change only in the file until it is fixed."
            : "The settings file does not read as settings now, so rules change only in the file until it is fixed."),
        () => this.fileRow(t, w),
        this.prefsError ? note(this.prefsError, t.blocked) : null,
      ]),
    ].filter(Boolean);
  }

  // A rule's card (settings-spacing 6): 12 px in, its lines 4 px apart. The type's icon, 8 px,
  // the name, then Edit and Delete, always shown (a button that shows only under the pointer
  // cannot be found and pushes the name aside), 4 px apart, then 12 px and the switch in a 36
  // by 24 hit area, at the far right so the switches line up down the list. A rule Threads
  // will not run has its warning mark in the switch's place.
  ruleRow(t, r, i, edit = false) {
    const { toggle } = this.cardKit(t);
    const why = r.why ?? r.rule?.slow ?? null;
    const bad = why != null;
    const ex = this.ruleExample(r);
    const open = (_e, cx) => { cx.stop_propagation(); this.openRule(i); cx.notify(); };
    const del = (_e, cx) => { cx.stop_propagation(); this.removeRule(i, cx); cx.notify(); };
    const flip = (_e, cx) => { cx.stop_propagation(); this.toggleRule(i, cx); cx.notify(); };
    const end = (id) => div().when(Boolean(id), (el) => el.id(id)).flex_none().w(36).h(24).ml(4).flex().items_center().justify_center();
    return v_flex().id(`th-rule-${r.n}`).p(12).gap(4).rounded(6).border_1()
      .border_color(bad ? alpha(t.blocked, 0.55) : t.border).when(bad, (el) => el.bg(alpha(t.blocked, 0.07)))
      .when(edit, (el) => el.cursor_pointer().on_click(open))
      .child(h_flex().gap(8).items_center()
        .child(svg(ICON(LINK_ICON[r.type] ?? "regex")).size(14).flex_none().text_color(t.dim).when(!bad && !r.on, (el) => el.opacity(0.55)))
        .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(!bad && !r.on ? t.muted : t.foreground).child(r.name))
        .when(!bad && !r.on, (el) => el.child(div().flex_none().text_size(12).text_color(t.muted).child("Off")))
        .when(edit, (el) => el.child(h_flex().flex_none().gap(4)
          .child(this.cardStop(this.ruleIcon(t, `th-rule-edit-btn-${r.n}`, "pencil", "Edit rule", open), t, `th-rule-edit-btn-${r.n}`, open, { radius: 5 }))
          .child(this.cardStop(this.ruleIcon(t, `th-rule-delete-btn-${r.n}`, "trash", "Delete rule", del, true), t, `th-rule-delete-btn-${r.n}`, del, { radius: 5 }))))
        .child(bad ? end(null).child(svg(ICON("alert")).size(14).text_color(t.blocked))
          : edit ? this.cardStop(end(`th-rule-on-${r.n}`).cursor_pointer().tooltip(r.on ? "Switch off" : "Switch on")
            .on_click(flip)
            .child(toggle(r.on)), t, `th-rule-on-${r.n}`, flip, { radius: 5, role: "switch", label: `${r.name}: ${r.on ? "on" : "off"}` })
            : div().flex_none().text_size(12).text_color(t.muted).child(r.on ? "On" : "Off")))
      .child(v_flex().gap(4).when(!bad && !r.on, (el) => el.opacity(0.55))
        .when(Boolean(r.description), (el) => el.child(div().text_size(12).text_color(t.muted).child(r.description)))
        .child(this.examplePieces(t, ex))
        .when(Boolean(ex.under), (el) => el.child(div().min_w(0).truncate().text_size(11).font_family(this.mono()).text_color(t.muted).child(ex.under))))
      .when(bad, (el) => el.child(div().text_size(12).text_color(t.blocked).child(`Not working: ${why}`)));
  }

  // Edit and Delete on a rule's card: a 24 px icon button, the icon dim with no fill at rest;
  // under the pointer the hover fill and the foreground, or for Delete the blocked color on a
  // 12% tint of it. Its tooltip is also what a screen reader says.
  ruleIcon(t, id, icon, tip, onClick, danger = false) {
    // `muted` at rest, not `dim`: a control a person has to find needs 3:1 on light themes too.
    return div().id(id).flex_none().size(24).flex().items_center().justify_center().rounded(5).cursor_pointer()
      .text_color(t.muted)
      .hover((s) => (danger ? s.bg(alpha(t.blocked, 0.12)).text_color(t.blocked) : s.bg(t.hover).text_color(t.foreground)))
      .tooltip(tip).accessibility_label(tip).role("button")
      .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); })
      .child(svg(ICON(icon)).size(14));
  }

  // An example as a reply would show it, the part a rule links underlined in the accent.
  examplePieces(t, ex) {
    return ex.pieces
      ? h_flex().flex_wrap().text_size(12).text_color(t.muted).children(ex.pieces.map((p) => (p.url
        ? div().flex_none().underline().text_color(t.accent).child(p.t)
        : div().flex_none().whitespace_nowrap().child(p.t))))
      : div().text_size(12).text_color(t.muted).child(ex.line);
  }

  // A small bordered button inside a rule (Use, Open, the type's Change): 24 px high, the
  // least anything pressed is.
  miniButton(t, id, label, onClick) {
    return div().id(id).flex_none().h(24).px(8).flex().items_center().rounded(6).cursor_pointer()
      .border_1().border_color(t.border).bg(t.background).text_size(12).text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); })
      .child(label);
  }

  // Where a deleted rule was: a quiet dashed line, 32 px high, with Undo as a 24 px text button.
  // No confirm step: Undo is the way back.
  undoLine(t) {
    const undo = (_e, cx) => { cx.stop_propagation(); this.undoRemove(cx); cx.notify(); };
    return h_flex().id("th-rule-undo-line").min_h(32).pl(12).pr(4).gap(8).items_center().rounded(6).border_1().border_dashed().border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(`Deleted ${this.ruleUndo.name}.`))
      .child(this.cardStop(div().id("th-rule-undo").flex_none().h(24).px(8).flex().items_center().rounded(5).cursor_pointer()
        .text_size(12).font_medium().text_color(t.foreground).hover((s) => s.bg(t.hover))
        .on_click(undo)
        .child("Undo"), t, "th-rule-undo", undo, { radius: 5 }));
  }

  // No rules: the two types that fill a rule, in dashed boxes. Use opens a new rule with that
  // type pressed.
  ruleExamples(t) {
    return this.cardCol(v_flex().gap(6), 6, 0, [
      div().text_size(11).font_semibold().text_color(t.muted).child("Templates, not rules until you keep one"),
      ...["ticket", "pull-request"].map((k) => () => {
        const tpl = LINK_TEMPLATES[k];
        const use = (_e, cx) => { this.openRule(null); this.chooseType(k); cx.notify(); };
        return h_flex().id(`th-rule-example-${k}`).p(12).gap(8).items_center().rounded(6).border_1().border_dashed().border_color(t.border)
          .child(svg(ICON(LINK_ICON[k])).size(14).flex_none().text_color(t.dim))
          .child(v_flex().flex_1().min_w(0).gap(4)
            .child(div().text_size(13).font_semibold().text_color(t.foreground).child(tpl.word))
            .child(div().text_size(12).text_color(t.muted).child(tpl.line)))
          .child(this.miniStop(t, `th-rule-use-${k}`, "Use", use, `Use ${tpl.word}`));
      })]);
  }

  // The open rule: Type, then Name, Description, Finds, Opens and Example, the line that says
  // what the rule does to its example, and Keep rule with the rest. A Keep rule that was not
  // saved has the File line's reason under the buttons too, while the File line shows it: a
  // tall rule can push the foot of the page out of view (issue 114).
  ruleEditor(t) {
    const e = this.ruleEdit;
    const d = e.draft;
    const { note } = this.cardKit(t);
    const isNew = e.at == null;
    const label = (text) => this.ruleLabel(t, text);
    // Built as each field draws, so Reference takes its place after Finds. The hint's text
    // may shrink and wrap (min_w(0)), so in a narrow card it wraps inside the card, with
    // Reference after it or on the line under it.
    const hints = {
      description: () => note("It shows under the name in the list."),
      pattern: () => h_flex().flex_wrap().gap(4).text_size(12).text_color(t.muted)
        .child(div().min_w(0).child("A JavaScript regular expression. Capitals count."))
        .child(this.referenceLink(t)),
      url: () => note("An address that starts with https://. $1 puts in what the first ( ) found; {repo} is this session's repository."),
    };
    const field = ([k, name]) => this.ruleField(t, e, k, name, hints[k]);
    const typeRows = (isNew && !e.touched) || e.typeOpen;
    const tpl = LINK_TEMPLATES[d.type] ?? LINK_TEMPLATES.custom;
    const typeBlock = () => (typeRows
      ? this.cardCol(v_flex().gap(4), 4, 0, [label("Type"), ...LINK_TYPES.map((k) => () => {
          const on = d.type === k;
          const x = LINK_TEMPLATES[k];
          const choose = (_e, cx) => { cx.stop_propagation(); this.chooseType(k); cx.notify(); };
          return this.cardStop(h_flex().id(`th-rule-type-${k}`).p(6).gap(8).items_center().rounded(5).cursor_pointer().border_1()
            .border_color(on ? t.accent : t.border).bg(on ? t.hover : t.background)
            .hover((s) => s.bg(t.hover))
            .on_click(choose)
            .child(svg(ICON(LINK_ICON[k])).size(13).flex_none().text_color(on ? t.foreground : t.dim))
            .child(div().flex_none().text_size(12.5).font_medium().text_color(t.foreground).child(x.word))
            .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).child(x.line)), t, `th-rule-type-${k}`, choose, { radius: 5, role: "radio_button", label: x.word });
        }), !isNew || e.touched ? note("The label changes; the fields stay.") : null])
      : h_flex().gap(6).items_center()
        .child(label("Type"))
        .child(svg(ICON(LINK_ICON[d.type] ?? "regex")).size(13).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.foreground).child(tpl.word))
        .child(this.miniStop(t, "th-rule-type-change", "Change", (_e, cx) => { e.typeOpen = true; this.ringMove(`th-rule-type-${d.type}`); cx.notify(); }, "Change the type")));
    const fields = RULE_FIELDS.map((f) => () => field(f));
    const r = e.stale ? e.lastGood : e.result;
    const result = () => r
      ? v_flex().id("th-rule-result").gap(2).when(e.stale, (el) => el.opacity(0.45))
        .child(this.examplePieces(t, r))
        .when(Boolean(r.under), (el) => el.child(h_flex().gap(6).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(11).font_family(this.mono()).text_color(t.muted).child(r.under))
          .when(Boolean(r.url) && !e.stale, (el2) => el2.child(this.miniStop(t, "th-rule-open", "Open", (_e, cx) => { cx.open_url?.(r.url); }, "Open the example's link")))))
        .when(Boolean(r.beaten) && !e.stale, (el) => el.child(note(this.beatenLine(e, r.beaten, "takes this text first"), t.muted)))
      : null;
    return this.ruleShell(t, e, [typeBlock, ...fields, result, () => this.ruleButtons(t, e),
      () => (this.refusedHere(e) ? this.cardKit(t).note(e.refused, t.blocked) : null)]);
  }

  // The parts both rule editors share. A field's label.
  ruleLabel(t, text) { return div().text_size(11.5).font_medium().text_color(t.muted).child(text); }
  // A mini button (Use, Open, Change) as a ring stop.
  miniStop(t, id, word, press, name = null) { return this.cardStop(this.miniButton(t, id, word, press), t, id, press, { label: name }); }
  // Reference under Finds or Pattern: MDN's regular expression cheat sheet.
  referenceLink(t) {
    const open = (_e, cx) => { cx.stop_propagation(); cx.open_url?.(REGEX_REFERENCE); };
    return this.cardStop(div().id("th-rule-reference").flex_none().underline().cursor_pointer().tooltip(REGEX_REFERENCE)
      .on_click(open)
      .child("Reference"), t, "th-rule-reference", open, { radius: 3, role: "link", label: "Regular expression reference" });
  }
  // A field: its label, its box (the accent while it has the keys, the blocked color while
  // its fault shows), its fault as "Not working: why", and its hint.
  // The hint is a function, so a control in it takes its ring stop after the field's.
  ruleField(t, e, k, name, hint) {
    const { note } = this.cardKit(t);
    const shown = e.shown[k] ?? null;
    const tag = `${fieldTag(e.kind)}${k}`;
    const input = this.inputsOf(e.kind)[k];
    return v_flex().gap(3)
      .child(this.ruleLabel(t, name))
      .child(this.cardStop(h_flex().id(`th-rule-f-${k}`).h(26).px(7).items_center().rounded(5).border_1()
        .border_color(shown ? t.blocked : this.fieldFocused === tag ? t.accent : t.border).bg(t.background)
        .child(maybe(Input.new(input), "tab_stop", false).w_full().h_full().text_size(12.5).text_color(t.foreground)
          .when(k === "pattern" || k === "url" || k === "prefix", (el) => el.font_family(this.mono()))),
      t, `th-rule-f-${k}`, null, { field: { input, name: tag } }))
      .when(Boolean(shown), (el) => el.child(note(`Not working: ${shown}`, t.blocked)))
      .when(Boolean(hint), (el) => el.child(hint()));
  }
  // A rule higher in the list that takes the example first, and how to put this one above it.
  beatenLine(e, name, what) {
    return `${name} is higher in the list and ${what}. ${e.at != null && e.at > 0 ? "Move up puts this rule above it." : "Keep this rule, then Move up to put it above."}`;
  }
  // The open rule's box: the accent border, and over a new rule the line that says it is not kept.
  // A column (cardCol), 10 px in and a 1 px edge, its parts 10 px apart.
  ruleShell(t, e, kids) {
    const isNew = e.at == null;
    const el = this.cardCol(v_flex().id(isNew ? "th-rule-new" : `th-rule-edit-${e.at + 1}`).p(10).gap(10).rounded(6).border_1().border_color(t.accent), 10, 11, [
      isNew ? div().text_size(11).font_semibold().text_color(e.lost ? t.blocked : t.muted)
        .child(e.lost ? "This rule changed in the file or was removed. Keep rule adds it as a new rule."
          : e.template ? `New rule from ${e.template}, not kept yet` : "New rule, not kept yet") : null,
      ...kids]);
    // Its column, for a scroll to its top (ringSpan head).
    this.cardColLast.ruleShell = true;
    return el;
  }
  // Keep rule, Discard, and on a kept rule Move up (not the first), Duplicate and Delete.
  // Whether the open rule shows why its Keep rule was not saved: while the File line shows
  // that same reason. It goes when the file is fixed, the next Keep is saved, or the rule
  // closes. The same text in a second place, where the person is looking: a tall open rule
  // can push the File line out of view.
  refusedHere(e) { return Boolean(e.refused) && e.refused === this.prefsError; }
  ruleButtons(t, e) {
    const isNew = e.at == null;
    const big = (id, word, press, icon) => this.cardStop(this.button(t, id, word, press, icon, CARD_BUTTON), t, id, press);
    return h_flex().gap(6).flex_wrap()
      .child(big("th-rule-keep", "Keep rule", (_e, cx) => { this.keepRule(cx); cx.notify(); }, "check"))
      .child(big("th-rule-discard", "Discard", (_e, cx) => { this.closeRule(); cx.notify(); }, null))
      .when(!isNew && e.at > 0, (el) => el.child(big("th-rule-up", "Move up", (_e, cx) => { this.moveRuleUp(cx); cx.notify(); }, "chevron-up")))
      .when(!isNew, (el) => el
        .child(big("th-rule-dup", "Duplicate", (_e, cx) => { this.duplicateRule(); cx.notify(); }, "copy"))
        .child(big("th-rule-delete", "Delete", (_e, cx) => { this.removeRule(e.at, cx, e.kind); cx.notify(); }, "trash")));
  }

  // The Sender rules page, on the Link rules page's pattern: what a sender rule is, then
  // each rule in the file as a card (senderRow), the two examples with Use when there are
  // none, Add rule, a note not about one rule ("senders is not a list") in the blocked color
  // above File, and File. A press on a card opens the rule in place, as Edit does; Delete
  // takes it at once, with Undo.
  senderRulesRows(t, w) {
    const { note, group } = this.cardKit(t);
    const list = this.senderList ?? [];
    const e = this.ruleEdit?.kind === "senders" ? this.ruleEdit : null;
    const edit = this.rulesEditable("senders");
    const other = (this.senderNotes ?? []).filter((n) => !/^Sender rule \d+:/.test(n));
    // Placed first and built in that order, so Tab takes them as drawn.
    const slots = list.map((_r, i) => (e?.at === i ? "edit" : i));
    if (e && e.at == null) slots.splice(Math.min(e.insertAt, slots.length), 0, "edit");
    if (this.ruleUndo?.kind === "senders") slots.splice(Math.min(this.ruleUndo.at, slots.length), 0, "undo");
    const rows = slots.map((x) => () => (x === "edit" ? this.senderEditor(t) : x === "undo" ? this.undoLine(t) : this.senderRow(t, list[x], x, edit)));
    const add = (_e, cx) => { this.openRule(null, null, null, "senders"); cx.notify(); };
    return [
      note("A sender rule names who sent a prompt that was typed into the terminal. A rule can make \"[build-bot] nightly build green\" show as a message from build-bot.", t.muted),
      () => group(`Rules${list.length ? ` · ${list.length}` : ""}`, [() => (rows.length ? this.cardCol(v_flex().gap(8), 8, 0, rows) : note("No rules yet."))]),
      list.length >= 2 ? note("When two rules match the same prompt, the higher one wins.") : null,
      () => (edit && !e && list.length < MAX_RULES ? this.senderExamples(t, list) : null),
      () => (edit && !e && list.length < MAX_RULES
        ? h_flex().child(this.cardStop(this.button(t, "th-rule-add", "Add rule", add, "plus", CARD_BUTTON), t, "th-rule-add", (e, cx) => { cx.stop_propagation(); add(e, cx); })) : null),
      ...other.map((n) => note(n, t.blocked)),
      () => group("File", [
        note(edit ? "Rules are kept under \"senders\" in the settings file. A change made there shows here within a second."
          : writable(this.prefsRaw) ? "\"senders\" in the settings file is not a list now, so rules change only in the file until it is fixed."
            : "The settings file does not read as settings now, so rules change only in the file until it is fixed."),
        () => this.fileRow(t, w),
        this.prefsError ? note(this.prefsError, t.blocked) : null,
      ]),
    ].filter(Boolean);
  }

  // A sender rule's card, the box a link rule's has (ruleRow): 12 px in, lines 4 px apart.
  // Line 1: its type's icon (text-cursor for Starts with, regex for Pattern), its name (its
  // text when it has none), Off, Edit, Delete, and the switch at the far right, or the
  // warning mark in its place on a rule the mod will not run. Then its example with the
  // sender's name underlined, or "No example yet"; with the tag icon, what a match shows as,
  // or "Finds no sender in its example"; "Starts with" or "Pattern" and its text in the code
  // font, in a small box so a space at its end shows; and on a refused rule, why.
  senderRow(t, r, i, edit = false) {
    const { toggle } = this.cardKit(t);
    const bad = r.why != null;
    const off = !bad && !r.on;
    const ex = this.senderExample(r);
    const pattern = Boolean(r.pattern) && !r.prefix;
    const open = (_e, cx) => { cx.stop_propagation(); this.openRule(i, null, null, "senders"); cx.notify(); };
    const del = (_e, cx) => { cx.stop_propagation(); this.removeRule(i, cx, "senders"); cx.notify(); };
    const flip = (_e, cx) => { cx.stop_propagation(); this.toggleRule(i, cx, "senders"); cx.notify(); };
    const end = (id) => div().when(Boolean(id), (el) => el.id(id)).flex_none().w(36).h(24).ml(4).flex().items_center().justify_center();
    const text = r.prefix || r.pattern;
    return v_flex().id(`th-sender-${r.n}`).p(12).gap(4).rounded(6).border_1()
      .border_color(bad ? alpha(t.blocked, 0.55) : t.border).when(bad, (el) => el.bg(alpha(t.blocked, 0.07)))
      .when(edit, (el) => el.cursor_pointer().on_click(open))
      .child(h_flex().gap(8).items_center()
        .child(svg(ICON(pattern ? "regex" : "text-cursor")).size(14).flex_none().text_color(t.dim).when(off, (el) => el.opacity(0.55)))
        .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(off ? t.muted : t.foreground).child(r.name))
        .when(off, (el) => el.child(div().flex_none().text_size(12).text_color(t.muted).child("Off")))
        .when(edit, (el) => el.child(h_flex().flex_none().gap(4)
          .child(this.cardStop(this.ruleIcon(t, `th-sender-edit-btn-${r.n}`, "pencil", "Edit rule", open), t, `th-sender-edit-btn-${r.n}`, open, { radius: 5 }))
          .child(this.cardStop(this.ruleIcon(t, `th-sender-delete-btn-${r.n}`, "trash", "Delete rule", del, true), t, `th-sender-delete-btn-${r.n}`, del, { radius: 5 }))))
        .child(bad ? end(null).child(svg(ICON("alert")).size(14).text_color(t.blocked))
          : edit ? this.cardStop(end(`th-sender-on-${r.n}`).cursor_pointer().tooltip(r.on ? "Switch off" : "Switch on")
            .on_click(flip)
            .child(toggle(r.on)), t, `th-sender-on-${r.n}`, flip, { radius: 5, role: "switch", label: `${r.name}: ${r.on ? "on" : "off"}` })
            : div().flex_none().text_size(12).text_color(t.muted).child(r.on ? "On" : "Off")))
      .child(v_flex().gap(4).when(off, (el) => el.opacity(0.55))
        .child(this.examplePieces(t, ex))
        .when(Boolean(ex.label), (el) => el.child(this.matchedLine(t, ex.label)))
        .when(Boolean(ex.under), (el) => el.child(div().text_size(12).text_color(t.muted).child(ex.under)))
        .when(Boolean(text), (el) => el.child(this.senderText(t, pattern ? "Pattern" : "Starts with", text))))
      .when(bad, (el) => el.child(div().text_size(12).text_color(t.blocked).child(`Not working: ${r.why}`)));
  }
  // What a match shows as: the tag icon and the label, in the accent.
  matchedLine(t, label, lead = null) {
    return h_flex().gap(6).items_center().min_w(0)
      .child(svg(ICON("tag")).size(13).flex_none().text_color(lead ? t.muted : t.accent))
      .when(Boolean(lead), (el) => el.child(div().flex_none().text_size(12).text_color(t.muted).child(lead)))
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_medium().text_color(t.accent).child(label));
  }
  // "Starts with" or "Pattern", then the rule's text in the code font in a small box.
  senderText(t, word, text) {
    return h_flex().gap(6).items_center().min_w(0)
      .child(div().flex_none().text_size(11.5).font_family(this.mono()).text_color(t.muted).child(word))
      .child(div().min_w(0).truncate().px(4).rounded(3).border_1().border_color(t.border).bg(t.background)
        .text_size(11.5).font_family(this.mono()).text_color(t.foreground).child(text));
  }

  // What a sender rule does to its own example, kept until the list changes, in the shape
  // examplePieces draws: { pieces (the sender's name marked), label } on a match,
  // { pieces, under: "Finds no sender in its example" }, or { line: "No example yet" }. A
  // refused rule shows its example as it is.
  senderExample(r) {
    const k = this.senderListVer ?? 0;
    if (this.senderExKey !== k) { this.senderExKey = k; this.senderExMemo = new Map(); }
    const hit = this.senderExMemo.get(r);
    if (hit) return hit;
    let out;
    if (!r.example) out = { line: "No example yet" };
    else if (!r.rule) out = { pieces: [{ t: r.example }] };
    else {
      const m = ruleSender([r.rule], r.example);
      out = m ? { pieces: senderPieces(r.rule, r.example) ?? [{ t: r.example }], label: m.name ? `${m.name} · matched by rule` : "matched by rule" }
        : { pieces: [{ t: r.example }], under: "Finds no sender in its example" };
    }
    this.senderExMemo.set(r, out);
    return out;
  }

  // The templates no rule in the file has, under the rules, in dashed boxes, each with Use;
  // when every one is in use, a line says so.
  senderExamples(t, list) {
    const left = senderTemplatesLeft(list);
    if (!left.length) return div().id("th-sender-templates-used").text_size(12.5).text_color(t.muted).child("Every template is in use.");
    return this.cardCol(v_flex().gap(6), 6, 0, [
      div().text_size(11).font_semibold().text_color(t.muted).child("Templates, not rules until you keep one"),
      ...left.map(([k, x]) => () => h_flex().id(`th-sender-example-${k}`).p(12).gap(8).items_center().rounded(6).border_1().border_dashed().border_color(t.border)
        .child(svg(ICON(SENDER_TYPES.find(([b]) => b === x.by)[2])).size(14).flex_none().text_color(t.dim))
        .child(v_flex().flex_1().min_w(0).gap(4)
          .child(div().text_size(13).font_semibold().text_color(t.foreground).child(x.rule.name))
          .child(div().text_size(12).text_color(t.muted).child(x.line)))
        .child(this.miniStop(t, `th-sender-use-${k}`, "Use", (_e, cx) => { this.useSenderExample(k); cx.notify(); }, "Start a new rule from this template")))]);
  }

  // The open sender rule: Type (two rows on a new rule, else one line with Change), Name,
  // Starts with or Pattern, Example, what the rule does to the example, and Keep rule with
  // the rest. A draft that would not run shows no result: its reason is under its field.
  senderEditor(t) {
    const e = this.ruleEdit;
    const d = e.draft;
    const { note } = this.cardKit(t);
    const label = (text) => this.ruleLabel(t, text);
    // A function: an element is used once, and both hints below hold this line.
    const firstLine = () => note(`Read against the first ${RULE_TEXT} characters of a prompt's first line.`);
    // Built as each field draws, so Reference takes its place after Pattern. The pattern
    // hint's text wraps inside the card, as Finds' does on Link rules.
    const hints = {
      name: () => note("It shows in the list, and in the tooltip on a message it matched."),
      prefix: () => v_flex().gap(2).child(note("{name} is the sender's name. It ends at the text you put after it, or at a space.")).child(firstLine()),
      pattern: () => v_flex().gap(2)
        .child(h_flex().flex_wrap().gap(4).text_size(12).text_color(t.muted)
          .child(div().min_w(0).child("A JavaScript regular expression with a group named sender. Capitals count."))
          .child(this.referenceLink(t)))
        .child(firstLine()),
      example: () => note("A prompt this rule should match. Type any prompt here to try the rule."),
    };
    const field = (k) => this.ruleField(t, e, k, SENDER_FIELDS.find((x) => x[0] === k)[1], hints[k]);
    const type = SENDER_TYPES.find(([k]) => k === d.by) ?? SENDER_TYPES[0];
    const typeBlock = () => (e.at == null || e.typeOpen
      ? this.cardCol(v_flex().gap(4), 4, 0, [label("Type"), ...SENDER_TYPES.map(([k, word, icon, line]) => () => {
          const on = d.by === k;
          const choose = (_e, cx) => { cx.stop_propagation(); this.chooseSenderType(k); cx.notify(); };
          return this.cardStop(h_flex().id(`th-sender-type-${k}`).p(6).gap(8).items_center().rounded(5).cursor_pointer().border_1()
            .border_color(on ? t.accent : t.border).bg(on ? t.hover : t.background)
            .hover((s) => s.bg(t.hover))
            .on_click(choose)
            .child(svg(ICON(icon)).size(13).flex_none().text_color(on ? t.foreground : t.dim))
            .child(div().flex_none().text_size(12.5).font_medium().text_color(t.foreground).child(word))
            .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).child(line)), t, `th-sender-type-${k}`, choose, { radius: 5, role: "radio_button", label: word });
        })])
      : h_flex().gap(6).items_center()
        .child(label("Type"))
        .child(svg(ICON(type[2])).size(13).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.foreground).child(type[1]))
        .child(this.miniStop(t, "th-sender-type-change", "Change", (_e, cx) => { e.typeOpen = true; this.ringMove(`th-sender-type-${d.by}`); cx.notify(); }, "Change the type")));
    const fields = ["name", d.by, "example"].map((k) => () => field(k));
    const r = e.stale ? null : e.result;
    const result = () => r
      ? v_flex().id("th-rule-result").gap(4)
        .when(Boolean(r.label), (el) => el.child(this.examplePieces(t, r)).child(this.matchedLine(t, r.label, "Matches. It shows as")))
        .when(!r.label, (el) => el.child(note("No match. This prompt would stay yours.")))
        .when(Boolean(r.beaten), (el) => el.child(note(this.beatenLine(e, r.beaten, "takes this prompt first"))))
        .when(Boolean(r.past), (el) => el.child(note(`Only the first ${RULE_TEXT} characters of the first line are read.`)))
      : null;
    // How many prompts typed here the rule matches (senderMatches), under the result.
    const count = () => {
      const n = this.senderMatches(e.rule);
      return n ? div().id("th-sender-count").child(note(this.senderMatchLine(n))) : null;
    };
    return this.ruleShell(t, e, [typeBlock, ...fields, result, count, () => this.ruleButtons(t, e),
      () => (this.refusedHere(e) ? this.cardKit(t).note(e.refused, t.blocked) : null)]);
  }

  // Why a rule that needs the session's repository links nothing here, or null.
  repoAway(rule) {
    if (!rule?.repo) return null;
    if (!this.remote.repo) return "This session has no repository, so this rule links nothing here.";
    if (!repoFits(rule, this.linkCtx())) return `This repository is on ${this.remote.host}, not GitHub, so this rule links nothing here.`;
    return null;
  }

  // What a rule does to its own example, kept until the rules or the repository change:
  // { pieces, under } when it makes a link (the address under), or { line, under }.
  ruleExample(r) {
    const k = `${this.linksVer}|${this.linkListVer ?? 0}|${this.repoSig()}`;
    if (this.ruleExKey !== k) { this.ruleExKey = k; this.ruleExMemo = new Map(); }
    if (r.rule?.slow) return r.example ? { pieces: [{ t: r.example }], under: null } : { line: "No example yet", under: r.pattern || null };
    const hit = this.ruleExMemo.get(r);
    if (hit) return hit;
    let out;
    if (!r.example) out = { line: "No example yet", under: r.pattern || null };
    else if (!r.rule) out = { pieces: [{ t: r.example }], under: null };
    else if (this.repoAway(r.rule)) out = { pieces: [{ t: r.example }], under: this.repoAway(r.rule) };
    else {
      const pieces = linkPieces(r.example, [r.rule], this.linkCtx());
      const url = pieces.find((p) => p.url)?.url ?? null;
      out = url ? { pieces, under: url } : { pieces, under: "Finds nothing in its example" };
    }
    this.ruleExMemo.set(r, out);
    return out;
  }

  // The text the list is filtered by: none while the field holds a "#12" jump, or less than a
  // search (ui.js searchable).
  filterText() {
    if (jumpTarget(this.query) != null) return "";
    const q = this.query.trim();
    return searchable(q) ? q : "";
  }
  // The keys of the turns the search matches, oldest first, from the list's turn keys: a
  // pin's visit can show a turn that does not match, which is not a match to step to.
  matchKeys(keys = this.turnKeys(this.rows())) {
    const q = this.filterText();
    if (!q) return [];
    return keys.filter((k) => {
      const s = this.sessions[Number(k.split(":")[0])];
      const t = this.findTurn(k);
      return Boolean(s && t && threadMatches(s.turns, t, q));
    });
  }
  // Where the selection is among the matches, counted from the newest: { at (1 for the
  // newest, 0 when no match is selected), n }.
  matchPlace() {
    const h = this.hitsNow();
    if (h) {
      const p = h.at.get(this.sel);
      return { at: p == null ? 0 : h.top - p, n: h.top - h.bot };
    }
    const mk = this.matchKeys();
    const i = mk.indexOf(this.sel);
    return { at: i < 0 ? 0 : mk.length - i, n: mk.length };
  }

  // ---- the search's matches (hits) ----
  // The shown turns the search matches, found once for each change and kept across draws:
  // the field's count and place, its two steps, n / Shift n and a new search's first
  // selection read them, and a draw with nothing changed checks no turn. Not in the Pinned
  // view, whose matches are among its pins (matchKeys over its rows).
  // The set: what it was found for (base, and each session, its version, turn count, turns
  // array and loaded; a session read again from the top, restart, has a new array); at, a
  // match's key to its place, and by, back: places run from bot (the oldest found) up to
  // top - 1 (the newest); hidden, the matches among hidden agent messages: hidOld of them in
  // the older sessions, and hidL, their turn indexes in the newest; cur, the next turn to
  // check, going back from the newest, with bot, hidOld and the length of hidL as they were
  // there, and tail, the newest session's turns still to check again (hitsTail): next, the
  // first of them, and top as it was there; done once every turn is checked.
  // Herdr can stop a draw anywhere in a slice: cur moves only at a slice's end, in one write,
  // and each slice first cuts the set back to it (hitsCut), so the turns a stopped slice
  // checked are checked again and counted once.
  // It is found again from the newest turn for a new search, the agent messages shown or
  // hidden, new sender rules (each slice of their marking, remark), or a session added,
  // shortened or changed other than the newest. The rows' own build does not depend on it, and
  // opening or closing a turn changes nothing in it.
  hitsNow() {
    const q = this.filterText();
    if (!q || this.view === "pinned") return null;
    const S = this.sessions;
    const L = S.length - 1;
    const base = `${q}|${this.prefs.agentTurns ? 1 : 0}|${this.sendersVer}|${this.remarkVer ?? 0}`;
    let h = this.hits;
    // The newest session's tail checked again (hitsTail) in this call.
    let tail = false;
    // A step kept in a set found again for the same search (stepHit): it goes on in the new one.
    let step = null;
    if (h && h.base === base && h.sessions.length === S.length && S.every((s, i) => s === h.sessions[i])) {
      let older = false;
      let newest = false;
      for (let i = 0; i <= L; i++) {
        if (S[i].turns !== h.arrs[i]) older = true;
        if (S[i].version === h.vers[i] && S[i].turns.length === h.lens[i] && Boolean(S[i].loaded) === h.loaded[i]) continue;
        if (i < L) older = true;
        else newest = true;
      }
      if (older || (newest && !(tail = this.hitsTail(h)))) { step = h.step ?? null; h = null; }
    } else h = null;
    h ??= { base, q, agents: Boolean(this.prefs.agentTurns), sessions: S.slice(), at: new Map(), by: new Map(), top: 0, bot: 0,
      hidOld: 0, hidL: [], cur: { si: L, ti: L >= 0 ? S[L].turns.length - 1 : -1, bot: 0, hidOld: 0, hidL: 0, tail: null }, done: false,
      get hidden() { return this.hidOld + this.hidL.length; } };
    h.vers = S.map((s) => s.version);
    h.arrs = S.map((s) => s.turns);
    h.lens = S.map((s) => s.turns.length);
    h.loaded = S.map((s) => Boolean(s.loaded));
    // The newest session's oldest open turn: a later turn's end can still answer it
    // (answeredBy), so the next tail starts no later than it (hitsTail).
    const open = L >= 0 ? S[L].open : null;
    h.open = open?.length ? Math.min(...open.map((t) => t.n - 1)) : Infinity;
    // A new set's first slice, wherever it is first asked for (scanStep). A tail too long to
    // check again at once: its first slice, here, the same way.
    if (h !== this.hits) { h.step = step; this.hits = h; this.scanHits(h, now() + this.scanMax()); }
    else if (tail && h.cur.tail) this.scanHits(h, now() + this.scanMax(), true);
    return h;
  }

  // One slice of the matches, SCAN_MS at most (scanMax), in each draw until all are found, a
  // 0 ms timer asking for the next draw as the rows' build does; and in the search command,
  // each letter typed and an older step past the oldest match found so far, which run one
  // slice each. Its time is left out of the draw's base cost, as the build's is.
  scanStep(cx = null) {
    const t0 = now();
    const was = this.hits;
    const h = this.hitsNow();
    if (!h) return h;
    // A step kept from a press that could not land yet (stepHit): in a draw, its next slice,
    // in place of the scan's, while the step's match is still selected and still matches. It
    // keeps itself until it lands, so a stop in its slice leaves it for the next draw.
    // A step still kept after STEP_DRAWS draws going on with it is dropped with no words, the
    // selection left where it is: it gave up, so a match that way can still be there.
    // The reader moving the list or leaving the view since the step was kept (readerMoves, noted
    // when it was kept) drops it with no words, the selection left where it is.
    let stepped = false;
    if (cx && h.step != null) {
      if ((this.readerMoves ?? 0) !== h.step.moves) h.step = null;
      else if (h.step.key === this.sel && this.selMatches()) {
        stepped = true;
        h.step.draws = (h.step.draws ?? 0) + 1;
        this.stepHit(h, h.step.older);
        if (h.step && h.step.draws >= STEP_DRAWS) h.step = null;
      } else h.step = null;
    }
    // A set made just now has had its first slice (hitsNow).
    if (h === was && !h.done && !stepped) this.scanHits(h, t0 + this.scanMax());
    // The draw's own call only: a step's slices run inside it (stepHit), and are in its time.
    if (cx && this.renderOpen) this.scanSpent = (this.scanSpent ?? 0) + (now() - t0);
    // A new search's selection (setQuery): the newest match, once one is found, unless the
    // selection moved meanwhile. Not while a tail is checked again (oldest first): a newer
    // match can still come there.
    const want = this.hitsSelect;
    if (want && ((h.top > h.bot && !h.cur.tail) || h.done)) {
      this.hitsSelect = null;
      if (h.top > h.bot && this.sel === want.sel) {
        this.sel = h.by.get(h.top - 1);
        this.follow = false;
        this.scrollTo = { key: this.sel, how: "center" };
      }
    }
    if (cx && !h.done && !this.scanNext) {
      this.scanNext = true;
      cx.timer.after(0, (cx) => { this.scanNext = false; cx.notify(); });
    }
    return h;
  }

  // Checks turns of the set until the clock passes until (read every 32 turns, as the rows'
  // build does): first the newest session's tail to check again (cur.tail), oldest first, each
  // match the newest so far; then, unless tailOnly, going back from cur. The turns checked.
  scanHits(h, until, tailOnly = false) {
    const S = this.sessions;
    this.hitsCut(h);
    let n = 0;
    const tail = h.cur.tail;
    if (tail) {
      const L = S.length - 1;
      const turns = S[L].turns;
      for (let ti = tail.next; ti < turns.length; ti++) {
        if ((++n & 31) === 0 && until !== Infinity && now() > until) { h.cur = { ...h.cur, hidL: h.hidL.length, tail: { next: ti, top: h.top } }; return n - 1; }
        this.hitCheck(h, S[L], L, ti, true);
      }
      h.cur = { ...h.cur, hidL: h.hidL.length, tail: null };
    }
    if (tailOnly || h.cur.si < 0) {
      if (h.cur.si < 0) h.done = true;
      return n;
    }
    let { si, ti } = h.cur;
    const mark = (si, ti) => ({ si, ti, bot: h.bot, hidOld: h.hidOld, hidL: h.hidL.length, tail: null });
    while (si >= 0) {
      const s = S[si];
      for (; ti >= 0; ti--) {
        if ((++n & 31) === 0 && until !== Infinity && now() > until) { h.cur = mark(si, ti); return n - 1; }
        this.hitCheck(h, s, si, ti, false);
      }
      si--;
      ti = si >= 0 ? S[si].turns.length - 1 : -1;
    }
    h.cur = mark(-1, -1);
    h.done = true;
    return n;
  }

  // The set cut back to where its last whole slice ended (cur): the places below cur.bot,
  // from cur.tail.top up, and the hidden matches past cur's counts are from a slice that was
  // stopped. A place a stop left half made (its key or place written, the edge not yet moved)
  // is just outside the set, at bot - 1 or at top, and is cut too. Safe to stop and do again.
  hitsCut(h) {
    const c = h.cur;
    const drop = (p) => {
      const k = h.by.get(p);
      h.by.delete(p);
      if (k !== undefined && h.at.get(k) === p) h.at.delete(k);
    };
    for (let p = h.bot - 1; p < c.bot; p++) drop(p);
    h.bot = c.bot;
    if (c.tail) {
      for (let p = c.tail.top; p <= h.top; p++) drop(p);
      if (h.top > c.tail.top) h.top = c.tail.top;
    }
    h.hidOld = c.hidOld;
    if (h.hidL.length > c.hidL) h.hidL.length = c.hidL;
  }

  // One turn checked for the set: a shown match takes the next place, older (below bot) or
  // newer (at top); a hidden one is counted. The place's key and place are written first and
  // the edge moved last, so a stop at any point leaves no empty place inside the set, and one
  // that hitsCut puts right.
  hitCheck(h, s, si, ti, newer) {
    const t = s.turns[ti];
    if (!threadMatches(s.turns, t, h.q)) return;
    if (!isShown(t, { agentTurns: h.agents, live: this.isLive(s, si, ti), turns: s.turns })) {
      if (si === this.sessions.length - 1) h.hidL.push(ti);
      else h.hidOld++;
      return;
    }
    const key = `${si}:${t.n}`;
    if (newer) {
      const p = h.top;
      h.by.set(p, key);
      h.at.set(key, p);
      h.top = p + 1;
    } else {
      const p = h.bot - 1;
      h.by.set(p, key);
      h.at.set(key, p);
      h.bot = p;
    }
  }

  // Only the newest session changed (a turn came in, the running one grew or ended): the
  // matches before the first turn keptFrom's rule keeps (the turns before the last done turn
  // with a reply are settled; a reply links back only to the turns after it) stay, and the
  // turns from there, the tail, are checked again, oldest first, each match the newest so far:
  // at once when they are HITS_TAIL or fewer, else as the scan's next slice (scanHits), first
  // in hitsNow and then first in each draw's slice. The count is final for every turn before
  // the tail all the while. A tail longer than a slice that changes before every draw is not
  // done while it changes. False when the session got shorter, or the tail is longer than
  // HITS_TAIL_MAX: the set is found again.
  hitsTail(h) {
    const S = this.sessions;
    const L = S.length - 1;
    const turns = S[L].turns;
    const was = h.lens[L];
    if (turns.length < was || was < 2) return false;
    let safe = was - 1;
    // A tail longer than HITS_TAIL_MAX: the set is found again, so neither this walk nor the
    // drop below goes past it.
    while (safe > 0 && !(turns[safe - 1].done && turns[safe - 1].after?.length)) if (was - --safe > HITS_TAIL_MAX) return false;
    // A slice stopped earlier is cut back first. A tail still being checked again: from its
    // next turn on, the turns are not checked yet.
    this.hitsCut(h);
    if (h.cur.tail) safe = Math.min(safe, h.cur.tail.next);
    // A turn that was open at the last check can be answered by a newer one now.
    if (h.open < safe) safe = h.open;
    // The cap is on the turns to check again, the new ones too: a long read after a finished
    // session is found again newest first, not checked again oldest first.
    if (turns.length - safe > HITS_TAIL_MAX) return false;
    // The matches from safe on: the newest places, and the hidden ones in the newest session.
    while (h.top > h.bot) {
      const p = h.top - 1;
      const k = h.by.get(p);
      if (k !== undefined) {
        const c = k.indexOf(":");
        if (Number(k.slice(0, c)) !== L || Number(k.slice(c + 1)) - 1 < safe) break;
        if (h.at.get(k) === p) h.at.delete(k);
        h.by.delete(p);
      }
      h.top = p;
    }
    h.hidL = h.hidL.filter((ti) => ti < safe);
    // A step's check back (tailBack) goes on from where it got to unless a turn it passed was
    // open at the last check: a newer turn's end can answer that one now (answeredBy), and it
    // can match. A turn closed then matches as it did, so the turns passed need no check again,
    // and a step lands while turns come in before every draw.
    if (h.back && h.open <= Number(h.back.key.slice(h.back.key.indexOf(":") + 1)) - 2) h.back = null;
    // The tail from safe, marked with the counts as they are now, in one write. A scan still
    // among those turns found only matches from safe on, all gone now: it goes on from the turn
    // before safe.
    const inTail = h.cur.si === L && h.cur.ti >= safe;
    h.cur = { ...h.cur, ...(inTail ? { ti: safe - 1 } : {}), bot: h.bot, hidOld: h.hidOld, hidL: h.hidL.length, tail: { next: safe, top: h.top } };
    h.done = false;
    if (turns.length - safe <= HITS_TAIL) this.scanHits(h, Infinity, true);
    return true;
  }

  // A step through the set's matches, older or newer (n and Shift n): the next match back in
  // time or forward from the selected one. The tail's pop stopped between its writes leaves
  // top - 1 with no entry: top goes down to it, the pop's last write (hitsNow finishes the pop
  // first; this is a guard).
  stepHit(h, older) {
    while (h.top > h.bot && !h.by.has(h.top - 1)) h.top--;
    const next = () => {
      const p = h.at.get(this.sel);
      if (p != null) return p + (older ? -1 : 1);
      return this.selMatches() ? this.hitNear(h, this.sel, older) : h.top - 1;
    };
    // A step that cannot land yet keeps itself (h.step, with its way): each draw after it goes
    // on with it, a slice each (scanStep), until it lands. A key, a new selection or a change
    // to the search calls it off.
    // It notes the reader's count as it was first kept, after the key's own (readerMoves): a
    // move since then calls it off (scanStep).
    const draws = h.step?.draws ?? 0;
    const moves = h.step?.moves ?? this.readerMoves ?? 0;
    const keep = () => { h.step = { key: this.sel, older, draws, moves }; return true; };
    // An older step from a match in a tail being checked again, not placed yet: the turns back
    // from it to the tail's next turn, not checked again yet, are checked here, one slice at
    // most (tailBack). It lands on the first match there; a slice that ends first keeps the
    // step, which goes on from where it stopped. Every match before the tail's next turn has
    // its place, so hitNear is exact there.
    const tail = h.cur.tail;
    const L = this.sessions.length - 1;
    const [si, n] = this.sel ? this.sel.split(":").map(Number) : [-1, 0];
    const inTail = tail && si === L && n - 1 >= tail.next;
    const unplaced = !h.at.has(this.sel) && this.selMatches();
    if (older && inTail && unplaced && n - 1 > tail.next) {
      const k = this.tailBack(h, this.sel, n - 2, now() + this.scanMax());
      if (k === undefined) return keep();
      h.step = null;
      if (k) { this.sel = k; this.follow = false; this.scrollTo = { key: k, how: "center" }; return true; }
    }
    h.step = null;
    // A selected match with no place yet, other than an older step in a tail: the scan has not
    // reached it, so the matches next to it are not all found. One slice here; then, while it
    // still has no place, the step is kept, and lands once the scan places it.
    if (unplaced && !h.done && !(older && inTail)) {
      this.scanStep();
      if (!h.done && !h.at.has(this.sel)) return keep();
    }
    let j = next();
    // Past the oldest match found so far, while more can come: one slice, here, and the step
    // kept while that finds none.
    if (older && j < h.bot && !h.done) {
      this.scanStep();
      j = next();
      if (j < h.bot && !h.done) return keep();
    }
    if (h.top === h.bot) return !h.done;
    if (j < h.bot || j >= h.top) return true;
    this.sel = h.by.get(j);
    this.follow = false;
    this.scrollTo = { key: this.sel, how: "center" };
    return true;
  }

  // The newest shown match among the newest session's turns from turn index from down to the
  // tail's next turn (those not checked again yet), checked within until: its key, or null
  // when there is none. A slice that runs out returns undefined and keeps where it got to
  // (h.back), and a later call for the same key goes on from there. hitsTail clears it when a
  // turn it passed was open, so a newer turn's end can have changed it.
  tailBack(h, key, from, until) {
    const L = this.sessions.length - 1;
    const s = this.sessions[L];
    const turns = s.turns;
    const stop = h.cur.tail.next;
    let ti = h.back?.key === key ? Math.min(h.back.ti, from) : from;
    for (let c = 1; ti >= stop; ti--, c++) {
      if ((c & 31) === 0 && now() > until) { h.back = { key, ti }; return undefined; }
      const t = turns[ti];
      if (threadMatches(turns, t, h.q) && isShown(t, { agentTurns: h.agents, live: this.isLive(s, L, ti), turns })) return `${L}:${t.n}`;
    }
    return null;
  }

  // The place of the nearest match older (or newer) than turn key, by turn order: the places
  // run in turn order from bot (the oldest) up. bot - 1, or top, when there is none that way.
  hitNear(h, key, older) {
    const turn = (k) => { const c = k.indexOf(":"); return [Number(k.slice(0, c)), Number(k.slice(c + 1))]; };
    const [si, n] = turn(key);
    const before = (k) => { const [a, b] = turn(k); return a < si || (a === si && b < n); };
    // The first place not before key.
    let lo = h.bot;
    let hi = h.top;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (before(h.by.get(m))) lo = m + 1;
      else hi = m;
    }
    if (older) return lo - 1;
    return lo < h.top && h.by.get(lo) === key ? lo + 1 : lo;
  }

  // Whether the selected turn is shown and the search matches it.
  selMatches() {
    const t = this.sel ? this.findTurn(this.sel) : null;
    const si = t ? Number(this.sel.split(":")[0]) : -1;
    const s = this.sessions[si];
    if (!s || s.turns[t.n - 1] !== t) return false;
    return isShown(t, { agentTurns: this.prefs.agentTurns, live: this.isLive(s, si, t.n - 1), turns: s.turns }) && threadMatches(s.turns, t, this.filterText());
  }

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
    // A search starts at its newest match: the selection moves there unless it is on a match.
    // The matches are found newest first (hitsNow), which moves the selection to the first
    // one found.
    this.hitsSelect = null;
    // The field changed: a step kept in the set (stepHit) is called off, also when the same
    // words are typed again after the field was cleared, which keeps the set.
    if (this.hits) this.hits.step = null;
    if (n == null && this.filterText()) {
      if (this.view === "pinned") {
        const mk = this.matchKeys();
        if (mk.length && !mk.includes(this.sel)) {
          this.sel = mk[mk.length - 1];
          this.follow = false;
          this.scrollTo = { key: this.sel, how: "center" };
        }
        return;
      }
      if (!this.selMatches()) this.hitsSelect = { sel: this.sel };
      this.scanStep();
      return;
    }
    const key = n ? this.jumpKey(n) : null;
    if (!key) return;
    if (cx && this.findTurn(key)?.agent && !this.prefs.agentTurns && !this.turnKeys(this.rows()).includes(key)) this.setAgents(true, cx);
    this.sel = key; this.follow = false; this.scrollTo = { key, how: "center", flash: true };
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

  button(t, id, label, onClick, icon, size = BUTTON) {
    return h_flex().id(id).h(size.h).px(size.px).gap(size.gap).items_center().rounded(6).cursor_pointer().bg(t.raised).border_1().border_color(t.border)
      .text_size(12).text_color(t.foreground).hover((s) => s.bg(t.hover))
      .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); })
      .when(Boolean(icon), (el) => el.child(svg(ICON(icon)).size(size.icon).text_color(t.muted)))
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

  // The pane's content. The opening ends with any other state than its own draws (openCover,
  // openOver) once the session is read, failed or gone: "No turns yet", "No user messages
  // yet", a read error, no session found. Left on, it would say Reading and drop every key.
  body(t, focusedPanel, cx) {
    this.openDrew = false;
    const out = this.bodyNow(t, focusedPanel, cx);
    const s = this.current();
    if (this.openActive() && !this.openDrew && (!s || s.loaded || s.error)) this.openFinish();
    return out;
  }
  bodyNow(t, focusedPanel, cx) {
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
    const gate = this.openGate(t, s, cx);
    if (gate) return gate;
    if (s && !s.loaded && s.turns.length === 0)
      return this.loading(t, `Reading session${s.size && harnessOfFile(s.file) !== "opencode" ? ` (${fmtBytes(s.size)})` : ""}…`, this.readPct(s));
    if (s?.loaded && this.sessions.length === 1 && s.turns.length === 0) return noTurns();
    const why = this.holdDone();
    if (why) this.letGo(why, cx);
    const rows = this.rows();
    // The first rows of a session still being built, in slices over several frames (buildStep):
    // no row yet, and no empty state either, which would say there is nothing while the turns
    // are still on their way.
    if (s && this.rowJob && !this.baseRows?.length && this.openActive()) return this.openCover(t, s, cx);
    if (s && this.rowJob && !this.baseRows?.length) return this.loading(t, `Reading session${s.size && harnessOfFile(s.file) !== "opencode" ? ` (${fmtBytes(s.size)})` : ""}…`, this.readPct(s));
    if (s?.loaded && !this.filterText() && !this.turnKeys(rows).length && this.counts().hiddenAll > 0) {
      const n = this.counts().hiddenAll;
      return this.empty(t, "bot", "No user messages yet",
        `No user messages in this session yet. ${plural(n, "agent message")} ${n === 1 ? "is" : "are"} hidden.`, null,
        [this.button(t, "th-show-agents", "Show them", (_e, cx) => { this.setAgents(true, cx); cx.notify(); }, "bot")]);
    }
    const slots = this.slotsMemo;
    const due = this.light ? [] : this.probeDue();
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
    // A reader at the end through a re-wrap stays at the end: in this frame, every frame, until
    // the place is let go (holdDone).
    if (this.anchor?.end && rows.length && !this.scrollTo) { this.pinningUntil = Date.now() + 1000; this.askEnd(); }
    const unsettled = this.shapeLeft > 0 || this.staleRows?.length || this.rowJob;
    if (!(this.toBottom || this.scrollTo) || !unsettled) this.scrollWait = 0;
    else if (!this.scrollWait) this.scrollWait = Date.now();
    // A scroll to a place waits 2 s at most: while renders keep being stopped the rows never
    // settle. The end is held to in every frame while they do (below).
    const bottomHeld = this.toBottom && !this.scrollTo;
    // The opening's end is held in this frame while parts above it are still measured (each
    // measure moves the end down, and a scroll a frame later showed it slip and Jump to latest
    // flash), and in every frame the list is drawn hidden under the loading state, the one that
    // shows it among them. The frame in which nothing is left to measure still holds it: its
    // slots carry the last measures, which came in after the frame before was laid out (the
    // rig showed a 79 px slip there, and a 15 px one on a short session's first frame shown).
    const partsDue = bottomHeld && (this.openActive() || this.openHold);
    if (this.openHold && !(this.probeLeft > 0)) this.openHold = false;
    if ((this.toBottom || this.scrollTo) && (unsettled || partsDue) && (bottomHeld || Date.now() - this.scrollWait < SCROLL_WAIT_MS)) {
      // A return's wait for the probe (until, below) starts once the rows are reshaped.
      if (this.scrollTo?.until) this.scrollTo.until = Math.max(this.scrollTo.until, Date.now() + 400);
      // To the end in this frame, every frame while they settle: rows reshaped above the view
      // push it up, since the list keeps its offset in px, and a scroll a frame later showed
      // the view jumping up and back. Before, the list stayed at the oldest turn when renders
      // were stopped through a load and the rows never settled.
      if (bottomHeld && rows.length) {
        this.pinningUntil = Date.now() + 1000;
        this.askEnd();
      }
    } else if (this.toBottom && rows.length) {
      this.toBottom = false;
      this.scrollTo = null;
      this.pinningUntil = Date.now() + 1000;
      this.upAt = 0;
      this.downAt = 0;
      const holds = this.holds ?? 0;
      cx.timer.after(16, (cx) => {
        if ((this.holds ?? 0) !== holds) return; // a highlight started meanwhile (holdForSelect)
        this.askEnd();
        cx.notify();
      });
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
      // A jump the person asked for (a rail tick or card, a pin return, #n in the search, Go to
      // that reply) flashes the turn it lands on, after the scroll (a second press's follow-up
      // scroll flashes instead).
      if (i >= 0 && st.flash && !(how === "land" && st.resume)) this.flashTurn(rowTurnKey(rows[i]) ?? rows[i].key, cx);
      // A closed or running turn with pasted images has its tiles in the item over its row
      // (wtop): a scroll to the turn takes them along.
      const lead = (k) => ((rows[k - 1]?.kind === "wtop" || rows[k - 1]?.kind === "afold") && rows[k - 1].turnKey === rows[k].key ? k - 1 : k);
      // A second press goes on to the place further down the turn, under a line that says the
      // turn starts above, which the next frame's rows carry.
      if (i >= 0 && how === "land" && st.resume) {
        this.pinResume = { key: st.head, part: rows[i].key };
        this.scrollTo = { key: `resume:${st.head}`, how: "land", or: [rows[i].key], until: Date.now() + 400, flash: st.flash };
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
        cx.timer.after(16, (cx) => { this.askScroll(j, "top"); cx.notify(); });
        cx.timer.after(48, (cx) => { this.askScroll(top, "top"); cx.notify(); });
      } else if (i >= 0 && how === "land") {
        // scroll_to_item only brings an item to the nearest edge, so a place below the view
        // would land at the bottom. An item a pane further down first, then the place, which
        // is then above the view and lands at the top.
        i = lead(i);
        let j = i;
        for (let below = 0; j + 1 < rows.length && below < this.listH; j++) below += slots[j];
        // Clear of the floating top, which covers the list's first TOP_BAND px: an earlier item
        // at the top (a short way, a quarter of the pane at most), or level with a rail tick.
        const minTop = this.floating() ? TOP_BAND : 0;
        // A rail click lands the turn's top level with its tick (landExact). Other jumps take an
        // earlier item at the top a short way up (landPlan), and when none fits, the turn's top
        // just under the floating top, never under it.
        let p = st.at == null ? landPlan(slots, i, this.listH, minTop, minTop, this.listH / 4) : null;
        if (!p || p.y < minTop) p = landExact(slots, i, Math.round(Math.max(minTop, st.at ?? minTop)));
        const lift = p.lift ?? 0;
        this.landed = { key: rows[i]?.key ?? null, ...p };
        cx.timer.after(16, (cx) => { this.askScroll(j, "top"); cx.notify(); });
        cx.timer.after(48, (cx) => {
          if (lift > 0) { this.landLift = lift; this.fitKey = null; }
          this.askScroll(p.j, p.how);
          cx.notify();
        });
        if (lift > 0) cx.timer.after(120, (cx) => { this.landLift = 0; this.fitKey = null; cx.notify(); });
      } else if (i >= 0) {
        const top = lead(i);
        cx.timer.after(16, (cx) => { this.askScroll(i, how); cx.notify(); });
        if (top !== i) cx.timer.after(48, (cx) => { this.askScroll(top, how); cx.notify(); });
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
    const body = v_flex().id("threads-body").flex_1().min_h(0).relative()
      .on_mouse_move((e, cx) => {
        if (this.covered()) return;
        const x = e.local_position?.x;
        this.mouseX = x == null ? null : x / this.zoom() - this.colLeft();
        this.notePointer(e.position, cx);
      })
      // Where the press landed, for the action bar (a list item takes one click handler,
      // so its parts are told apart by position), in design px.
      .on_mouse_down("left", (e, cx) => {
        if (this.covered()) return;
        const x = e.local_position?.x;
        const w = e.bounds?.width;
        // In the column's own px: a centred column starts colLeft() in.
        this.pressX = x == null ? null : x / this.zoom() - this.colLeft();
        this.bodyW = w == null ? null : Math.min(w / this.zoom(), this.width);
        this.pressAt = e.position ? { x: e.position.x, y: e.position.y } : null;
        this.pressMoved = 0;
        this.pressCount = e.click_count ?? 1;
        // A double or triple press selects a word or a paragraph straight away, and the turn
        // its first press was about to open stays closed (OPEN_WAIT_MS).
        if (this.pressCount > 1) { this.holdForSelect(); this.liftFill(this.sel, cx); }
        this.notePress(cx);
      })
      .when(strip, (el) => el.child(h_flex().id("th-day-strip").h(DAY_STRIP).flex_none().w_full().justify_center().items_center().bg(t.background)
        .border_b_1().border_color(sticky ? t.border : t.background)
        .when(Boolean(sticky), (el) => el.child(div().id("th-sticky-day").child(this.dayPill(t, sticky))))))
      .child(div().id("threads-listbox").flex_1().min_h(0).w_full().relative()
        .on_size_change((size, cx) => { const h = size.height / this.zoom(); if (Math.abs(h - this.listH) > 1) { this.listH = h; cx.notify(); } })
        .on_scroll_wheel((e) => { if (!this.covered()) this.listWheel(e); })
        .child(h_flex().size_full().justify_center().child(div().h_full().w_full()
          .child(v_virtual_list(this.listGen ? `threads-list-${this.listGen}` : "threads-list", rows.length, slots, (i) => rows[i]?.key ?? `gone:${i}`,
            (range) => this.listItems(t, rows, slots, range, focusedPanel, dim))
            .track_scroll(this.scroll)
            .on_item_click((key, cx) => this.click(key, cx))
            .size_full())))
        .children(this.pinButtons(t, this.pinButtonRows(rows, slots)))
        .when(this.railShown(), (el) => el.child(this.railView(t))))
      .when(Boolean(s && !s.loaded && !s.error), (el) => el.child(this.progress(t, s)))
      .when(due.length > 0, (el) => el.child(this.probe(t, due)));
    return this.openActive() ? this.openOver(t, s, body, rows, cx) : body;
  }

  // ---- the opening ----
  // A pane's first session opens at its end, still. While it is read there are no rows and no
  // scrolling: the loading state fills the pane (openView). Once read, built and shaped, the
  // list is drawn hidden under it at its end until every part on screen is measured, and then
  // shown. Above it, parts are measured out of view with the end held (render: partsDue); a
  // scroll up meanwhile takes the place on screen (listWheel). A pane whose list is ready
  // within OPEN_QUIET_MS goes straight to it and paints nothing before. Armed only by a draw
  // while the pane's first session is unread: a session that comes after a list was shown
  // (/clear, a new session) opens as it always did.
  openGate(t, s, cx) {
    if (!s) return null;
    let o = this.opening;
    if (!o || o.list !== this.sessions) {
      this.opening = o = null;
      if (s.loaded || this.shownList === this.sessions) { this.shownList = this.sessions; return null; }
      o = this.opening = { list: this.sessions, at: Date.now(), painted: false, done: false, pct: null, peek: false, v: null, stats: null, newest: null, mtime: null };
    }
    if (o.done) return null;
    // A read that failed shows its error, as before.
    if (s.error) { this.openFinish(); return null; }
    if (s.loaded) return null;
    return this.openCover(t, s, cx);
  }
  // The whole pane, before a list can be drawn: its background alone within the quiet time,
  // then the loading state.
  openCover(t, s, cx) {
    const o = this.opening;
    this.openDrew = true;
    if (!o.painted && Date.now() - o.at < OPEN_QUIET_MS) { this.openTick(cx); return v_flex().flex_1().min_h(0).bg(t.background); }
    o.painted = true;
    return this.openView(t, s);
  }
  // A frame when the quiet time ends, so the loading state paints even if nothing else draws.
  openTick(cx) {
    const o = this.opening;
    if (o.tick) return;
    o.tick = true;
    cx.timer.after(Math.max(0, OPEN_QUIET_MS - (Date.now() - o.at)) + 10, (cx) => { o.tick = false; cx.notify(); });
  }
  // The list, built and shaped, drawn at its end under the loading state until what it shows is
  // measured (openReady); then shown in the same frame, nothing on screen left to move.
  openOver(t, s, body, rows, cx) {
    const o = this.opening;
    if (this.openReady(rows)) { this.openFinish(); return body; }
    this.openDrew = true;
    this.follow = true;
    if (!this.bottomShown) this.toBottom = true;
    if (!o.next) { o.next = true; cx.timer.after(16, (cx) => { o.next = false; cx.notify(); }); }
    const quiet = !o.painted && Date.now() - o.at < OPEN_QUIET_MS;
    if (!quiet) o.painted = true;
    return v_flex().id("th-open").flex_1().min_h(0).relative()
      .child(body.opacity(0))
      .child(v_flex().absolute().top(0).left(0).right(0).bottom(0).bg(t.background).when(!quiet, (el) => el.child(this.openView(t, s))));
  }
  // Ready to show: every row built and shaped, and the list last drawn with them at its end
  // with every part in view measured (or tried three times, as the probe gives up). A short
  // session waits for the same, under the background alone (the rig showed its first rows
  // move twice in 25 ms when they were shown as soon as they were built).
  openReady(rows) {
    if (this.rowJob || this.staleRows?.length || this.shapeLeft > 0 || !rows.length) return false;
    const n = Number(String(this.lastRange ?? "").split("/")[1]);
    if (n !== rows.length || !this.bottomShown || !this.viewRange) return false;
    return !this.partsWaiting(rows, this.viewRange[0], this.viewRange[1]);
  }
  // Whether a part in rows a..b is still to be measured, by the probe's own test (probeDue).
  partsWaiting(rows, a, b) {
    const base = this.sigBase();
    for (let i = Math.max(0, a); i < b && i < rows.length; i++) {
      const r = rows[i];
      const part = PROBED.has(r.kind) ? r : r.kind === "turn" && r.shape?.md != null ? this.cmdFor(r)
        : r.live && (r.kind === "working" || r.kind === "wrow") ? this.workYou(r) : null;
      if (!part) continue;
      const sig = this.partSig(part, base);
      if (this.measOf(part.key, sig) > 0) continue;
      if ((this.probeTries?.get(`${part.key}|${sig}`) ?? 0) >= 3) continue;
      return true;
    }
    return false;
  }
  openFinish() {
    const o = this.opening;
    o.done = true;
    o.shownAt = Date.now();
    this.shownList = this.sessions;
    // The end is held while parts above it wait, and in the next frame (render: partsDue).
    this.openHold = true;
    this.follow = true;
    this.toBottom = true;
  }
  // Once the first chunk is in: the file's last write (one stat) and, from a short read of its
  // end, the newest prompt a person typed. A file read in one chunk has its end already;
  // OpenCode's database and Cursor's transcripts are not read by bytes from the end.
  openPeek(s, cx) {
    this.openSwitch(s);
    const o = this.opening;
    o.peek = s;
    const h = harnessOfFile(s.file);
    if (h === "opencode") return;
    this.openStat(s, cx);
    if (h === "cursor" || !(s.size > CHUNK)) return;
    const from = Math.max(0, s.size - OPEN_PEEK);
    cx.spawn(async (cx) => {
      try {
        const t0 = now();
        const r = await exec("sh", readArgs(s.file, from, OPEN_PEEK));
        o.peekMs = now() - t0;
        if (this.opening !== o || this.current() !== s || o.done || r.code !== 0) return;
        const c = newChunk();
        for (const l of r.stdout.split("\n")) parseLine(c, l);
        const tail = newSession(s.id, s.file);
        tail.senders = s.senders;
        for (const e of c.events) apply(tail, e);
        o.newest = newestPrompt(tail.turns);
        cx.notify();
      } catch {
        // No preview: the line stays empty.
      }
    });
  }
  // The file's last write, for "last active": at the first chunk, and again once it is read.
  openStat(s, cx) {
    const o = this.opening;
    if (harnessOfFile(s.file) === "opencode") return;
    listMtimes([s.file]).then((m) => { if (this.opening === o && this.current() === s && m.get(s.file)) { o.mtime = m.get(s.file); cx.notify(); } }).catch(() => {});
  }
  // The last write, the newest prompt and the summed figures are one session's: another one
  // on the list (a /clear, a restart while the first still loads) has none of them until its
  // own stat, peek and sums, which its first chunk asks for (peek holds the session peeked,
  // so it differs). The figures' key has no session in it, so it is cleared here too. Called
  // before that chunk is read (read), and by the loading state while a read of the first
  // holds it.
  openSwitch(s) {
    const o = this.opening;
    if (!o || o.shows === s) return;
    Object.assign(o, { shows: s, mtime: null, newest: null, v: null, stats: null });
  }
  // What the loading state shows now (ui.js openLines). The counts are summed again only when
  // the session changed, as the status line's are (statusStats, whose tokens these are).
  openInfo(s) {
    const o = this.opening;
    this.openSwitch(s);
    // The bar and the peaks are this session's: another one on the list (a /clear, a restart
    // while the first still loads) starts from its own.
    if (o.peakFor !== s) { o.peakFor = s; o.peak = {}; o.pct = null; }
    const pct = this.readPct(s) ?? (s.loaded ? 100 : null);
    // The bar never goes back (a chunk read again at a smaller size, a rewind).
    if (pct != null) o.pct = Math.max(o.pct ?? 0, pct);
    const v = `${s.version}|${s.turns.length}|${s.loaded ? 1 : 0}|${this.pinVer}`;
    if (o.v !== v || !o.stats) {
      o.v = v;
      const st = this.statusStats();
      let prompts = 0;
      for (const t of s.turns) if (t.sender?.kind === "you" && !t.cmd) prompts++;
      let model = null;
      for (let i = s.turns.length - 1; i >= 0 && !model; i--) model = s.turns[i].model ?? null;
      o.stats = { tools: st.tools, tokens: st.tokens, prompts, model, pins: this.pinStore.sessions[this.sessionKey(s)]?.pins?.length ?? 0 };
    }
    const h = harnessOfFile(s.file);
    const read = s.offset > 0 || s.loaded;
    const si = this.sessions.indexOf(s);
    const info = {
      offset: s.offset, size: s.size, pct: o.pct, units: h === "opencode" ? "turns" : "bytes", turns: s.turns.length, loaded: Boolean(s.loaded),
      agent: h === "claude" ? "Claude Code" : this.agent().name, model: o.stats.model, start: s.turns[0]?.ts ?? null, active: o.mtime,
      working: Boolean(s.loaded && s.turns.length && this.isLive(s, si, s.turns.length - 1)),
      prompts: read ? o.stats.prompts : null, tools: read ? o.stats.tools : null, tokens: read ? o.stats.tokens : null, pins: o.stats.pins,
      newest: (s.loaded ? newestPrompt(s.turns) : null) ?? o.newest, now: Date.now(),
    };
    // Every figure holds its peak, as the bar does: a read started over part way (a stall,
    // a replaced file) counts up from the top again under what was already shown.
    const peak = (o.peak ??= {});
    for (const k of OPEN_PEAKS) if (info[k] != null || peak[k] != null) info[k] = peak[k] = Math.max(peak[k] ?? 0, info[k] ?? 0);
    return info;
  }
  // The loading state, at the list's column: what is read and found so far, then what is known
  // of the session. Every line keeps its row from the first paint (ui.js openLines), and each
  // digit takes a cell of one width, so nothing moves as figures arrive and grow.
  openView(t, s) {
    const L = openLines(this.openInfo(s));
    const pct = this.opening.pct;
    const figs = (text, size) => {
      const cw = Math.ceil(size * 0.62);
      return figRuns(text).map(([x, f]) => (f
        ? h_flex().flex_none().children([...x].map((ch) => (/\d/.test(ch) ? div().flex_none().w(cw).flex().justify_center().child(ch) : div().flex_none().child(ch))))
        : div().flex_none().whitespace_nowrap().child(x)));
    };
    const line = (text, h, size, color, mt) => h_flex().h(h).mt(mt).flex_none().w_full().min_w(0).overflow_hidden().items_center()
      .text_size(size).text_color(color).children(figs(text, size));
    const w = Math.min(this.width, this.pw());
    // Two lines of the newest prompt at 12.5 px, cut at a word with "…".
    const room = Math.max(20, Math.floor(((w - 2 * ROW.PAD_X) / 6.6) * 2) - 2);
    let said = L[8];
    if (said.length > room) said = `${said.slice(0, room).replace(/\s+\S*$/, "")} …`;
    const mk = mark(this.agent().key, 14);
    return v_flex().id("th-opening").flex_1().min_h(0).w_full().bg(t.background).items_center()
      // Clear of the floating top, as the list's first row is (TOP_BAND).
      .child(v_flex().w(w).px(ROW.PAD_X).pt(18 + (this.floating() ? TOP_BAND : 0)).flex_none()
        .child(div().h(22).flex_none().text_size(14).font_semibold().text_color(t.foreground).child(L[0]))
        .child(line(L[1], 18, 12.5, t.muted, 4))
        .child(div().h(3).mt(6).flex_none().w_full().rounded(2).bg(t.border).overflow_hidden()
          .child(pct != null ? div().h_full().w(`${pct}%`).bg(t.accent) : div().h_full().w("30%").bg(t.accent).loop("opacity", { from: 0.3, to: 1, period: 1100 })))
        .child(line(L[2], 18, 12.5, t.foreground, 8))
        .child(h_flex().h(18).mt(18).flex_none().gap(6).items_center().min_w(0)
          .when(Boolean(mk), (el) => el.child(mk))
          .child(h_flex().flex_1().min_w(0).overflow_hidden().text_size(12).text_color(t.muted).children(figs(L[3], 12))))
        .child(line(L[4], 18, 12, t.muted, 4))
        .child(line(L[5], 18, 12, t.muted, 4))
        .child(line(L[6], 18, 12, t.muted, 4))
        .child(line(L[7], 16, 11.5, t.dim, 18))
        .child(div().h(38).mt(4).flex_none().w_full().overflow_hidden().text_size(12.5).line_height("19px").text_color(t.foreground).child(said || " ")));
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
        .on_click((_e, cx) => { cx.stop_propagation(); this.readerMoved(); this.pick(c, cx); })
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
  // shows. The last piece truncates. under: the opaque colour the line is drawn on (hlFill).
  hlLine(t, under, text, color) {
    const q = this.filterText();
    if (!q || !text.toLowerCase().includes(q.toLowerCase()))
      return div().flex_1().min_w(0).truncate().text_color(color).child(text);
    const parts = spans(around(text, q), q);
    const nb = (s) => s.replace(/^ | $/g, "\u00a0");
    return h_flex().flex_1().min_w(0).overflow_hidden().children(parts.map((p, i) => p.hit
      ? div().flex_none().rounded(3).bg(this.hlFill(t, under)).text_color(t.foreground).child(p.t)
      : (i === parts.length - 1 ? div().flex_1().min_w(0).truncate() : div().flex_none()).text_color(color).child(nb(p.t))));
  }

  // Lines already clipped to fit (rowLines), each one line high, with filter matches marked.
  // A line that turns out wider than its estimate truncates instead of wrapping, so the
  // row keeps the height the list was given.
  // A closed turn's message or reply start, as one selectable text view, so a drag selects in
  // it as in an open reply; only a click that does not move opens the turn (click). The
  // lines are the shape's, already cut to fit, joined by the spaces their wrap took out
  // (htmlChunks: Herdr draws no break at "<br>" and wraps the text itself), and clipped to
  // their rows. TextView draws in the theme's text colour whatever its parent or the HTML sets
  // (checked on the rig: neither <font color> nor a style attribute reaches it), so lines in
  // any other colour (a quote, an agent's message, a coloured bubble, a stop's reason) stay
  // plain lines, as do lines while a search marks its hits, or where Herdr cannot select.
  // TextView sets its text half a px lower than a centred line (rig, 2x), hence mt(-0.5).
  selLines(t, under, id, lines, color, size, lh, hard = null) {
    const ink = String(theme().foreground ?? "").toLowerCase();
    if (this.liteDraw || !this.replySelectable() || this.filterText() || String(color ?? "").toLowerCase() !== ink) return this.lines(t, under, lines, color, size, lh);
    // Escaped once per line list (the shape's, kept on the turn), and split as a long reply is,
    // since one TextView holds at most MD_MAX bytes. A drag selects within one of them.
    const memo = (this.htmlMemo ??= new WeakMap());
    let chunks = memo.get(lines);
    if (!chunks) { chunks = htmlChunks(lines, undefined, hard); memo.set(lines, chunks); }
    const block = (c, i) => div().w_full().h(c.n * lh).overflow_hidden()
      .child(TextView.html(chunks.length > 1 ? `${id}-${i}` : id, c.html).selectable(true).w_full().mt(-0.5));
    return v_flex().flex_1().min_w(0).text_size(size).line_height(`${lh}px`).text_color(color).children(chunks.map(block));
  }
  lines(t, under, lines, color, size, lh) {
    const q = this.filterText();
    return v_flex().flex_1().min_w(0).text_size(size).children(lines.map((l) => {
      const row = h_flex().h(lh).min_w(0).items_center().overflow_hidden();
      if (!q || !l.toLowerCase().includes(q.toLowerCase())) return row.child(div().flex_1().min_w(0).truncate().text_color(color).child(l));
      const parts = spans(l, q);
      return row.children(parts.map((p, i) => p.hit
        ? div().flex_none().rounded(3).bg(this.hlFill(t, under)).text_color(t.foreground).child(p.t)
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
  chip(t, under, label, maxW, bare = false, selected = false) {
    const q = this.filterText().toLowerCase();
    const hit = Boolean(q) && label.toLowerCase().includes(q);
    return div().flex_none().h(18).max_w(maxW).flex().items_center().rounded(4)
      .when(hit, (el) => el.px(3).bg(this.hlFill(t, under)))
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

  // A search match's fill: the working colour at 32%, and stronger in the selected turn's rows
  // (item sets hlCur), so the match the reader is on stands out among the others: up to 60%,
  // as far as the text on it still reads at 4.5:1 (ui.js matchFill; a bubble's theme has its
  // own text). under is the opaque colour the match is drawn on, which every caller passes:
  // the background, the selected fill over it, or a bubble's fill over it (bubbleLook under).
  // It is a fill only, so no height changes and nothing is reshaped.
  hlFill(t, under) {
    if (under == null) throw new Error("hlFill: no backdrop");
    const k = `${t.working}|${t.foreground}|${under}|${this.hlCur ? 1 : 0}`;
    this.fillMemo ??= new Map();
    let f = this.fillMemo.get(k);
    if (f == null) {
      f = matchFill(t.working, t.foreground, under, Boolean(this.hlCur));
      if (this.fillMemo.size > 16) this.fillMemo.clear();
      this.fillMemo.set(k, f);
    }
    return f;
  }

  // Wrapped text with the filter's matches marked, word by word. rows: each line's spans
  // worked out already (an open message's, ui.js breakSpans), or null to find them here.
  // A word is one element that does not wrap inside, so a long hyphenated token is cut into
  // words after each HYPHEN_BREAK too, where the row can wrap.
  hlBlock(t, under, text, color, rows = null) {
    const q = this.filterText();
    if (!rows && (!q || !text.toLowerCase().includes(q.toLowerCase()))) return div().text_color(color).child(text);
    return v_flex().children((rows ?? text.split("\n").map((line) => spans(line, q))).map((row) => h_flex().flex_wrap().min_h(LINE).children(
      row.flatMap((p) => p.hit
        ? [div().rounded(3).bg(this.hlFill(t, under)).text_color(t.foreground).child(p.t)]
        : p.t.split(WORD_END).filter(Boolean).map((w) => div().text_color(color).child(w.replace(/\s$/, " ")))))));
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
  // A table may run wider than the reading line, as wide as its columns want (ui.js
  // tableNeed), centred on the line, up to the pane less the column's gutter on each side:
  // the px it takes past the reading line. For a table item (r.table), or a closed turn's
  // reply that holds tables (its widest); 0 otherwise, or when the pane has no room.
  tableExtra(r) {
    const md = r?.table ? (r.src ?? r.md) : r?.kind === "cmd" ? r.md : r?.kind === "turn" ? r.shape?.md : null;
    if (!md?.includes("|")) return 0;
    const memo = (this.tableMemo ??= new Map());
    let need = memo.get(md);
    if (need == null) {
      need = 0;
      for (const p of r.table ? [{ text: md, table: true }] : splitTables(md)) if (p.table) need = Math.max(need, tableNeed(p.text, this.charW(MD_CHAR)));
      memo.set(md, need);
      if (memo.size > 200) memo.delete(memo.keys().next().value);
    }
    // The reply's line starts at the column's left plus its gutter; each side may grow out to
    // the pane's edge less the same gutter, and less the rail's lane on both sides (it is on
    // one, and the table stays centred on the line).
    const lane = this.railShown() ? RAIL.LANE : 0;
    const left = this.colLeft() - lane;
    const right = this.pw() - this.colLeft() - 2 * ROW.PAD_X - this.prose() - lane;
    const half = Math.floor(Math.max(0, Math.min(left, right, (need - this.prose()) / 2)));
    return 2 * half;
  }
  // A table drawn extra px wider than the reading line, half of it on each side.
  tableBlock(el, extra) { return extra > 0 ? div().flex_none().w(this.prose() + extra).ml(-extra / 2).child(el) : el; }
  // A table's height before it is measured: Herdr gives its columns equal widths and wraps
  // each cell, so each row is as tall as its longest cell's lines, plus the cell padding.
  tableHeight(r) {
    const rows = tableCells(r.src ?? r.md);
    const cols = Math.max(1, ...rows.map((x) => x.length));
    const { line } = this.rt();
    const per = Math.max(1, Math.floor(((this.prose() + this.tableExtra(r)) / cols - 16) / this.charW(MD_CHAR)));
    return rows.reduce((h, x) => h + 16 + line * Math.max(1, ...x.map((c) => Math.ceil(c.length / per))), 0);
  }
  perLine() { return Math.max(8, Math.floor(rowTextWidth(this.width, false, this.prefs.textSize, this.chars()) / this.charW(YOU_CHAR))); }
  // A reading block: the reading size and line, at most a reading line wide.
  readBlock(el) { const { size, line } = this.rt(); return this.readFont(el.w_full().max_w(this.prose()).text_size(size).line_height(`${line}px`)).opacity(READ_INK); }
  // The face for messages and replies (SYSTEM_FACE), or null where the text keeps Herdr's
  // interface font: off macOS, and when the person set an interface font of their own, which
  // is followed. Read once per draw.
  readFace() {
    const r = this.renders ?? 0;
    if (this.faceMemo?.r === r) return this.faceMemo.v;
    const s = settings() ?? {};
    const ui = s.ui_font ?? s.ui_font_family;
    const v = this.platform() === "macos" && (!ui || ui === "Geist") ? SYSTEM_FACE : null;
    this.faceMemo = { r, v };
    return v;
  }
  readFont(el) { const f = this.readFace(); return f ? el.font_family(f) : el; }
  platform() { return herdrNs.window?.()?.platform ?? null; }
  // Markdown for TextView: dollar signs escaped (escapeDollars), and split into blocks short
  // enough for Herdr to draw (mdChunks). Kept for the MD_MEMO texts used last, as they are
  // redrawn often: the probe walks every turn, and a memo cleared when full made a long reply
  // on screen split again about once a second.
  mdParts(md) {
    const memo = (this.mdMemo ??= new Map());
    let parts = memo.get(md);
    if (parts) { memo.delete(md); memo.set(md, parts); return parts; }
    parts = mdChunks(escapeDollars(md));
    memo.set(md, parts);
    if (memo.size > MD_MEMO) memo.delete(memo.keys().next().value);
    return parts;
  }
  // One TextView, or several stacked a paragraph apart when the Markdown is too long for one.
  mdView(id, md, selectable) {
    if (this.liteDraw) return div().w_full().text_color(theme().foreground).child(String(md ?? ""));
    const parts = this.mdParts(md);
    if (parts.length === 1) return TextView.markdown(id, parts[0]).selectable(selectable).w_full();
    return v_flex().w_full().gap(this.paraGap()).children(parts.map((p, i) => TextView.markdown(`${id}-${i}`, p).selectable(selectable).w_full()));
  }
  // The space between paragraphs, for estimates: TextView's own, about 12 px at 13 px.
  paraGap() { return Math.round((12 * this.rt().size) / 13); }

  // A collapsed row's reply block, as a probe part of its own: "cmd:<turn key>".
  cmdRow(r) { return { kind: "cmd", key: `cmd:${r.key}`, turn: r.turn, md: r.shape.md, est: r.shape.mdEst }; }
  // The running turn's message, drawn on its card (workingItem) as an open turn's YOU part
  // draws it: whole, as Markdown, every paragraph and quote. It is measured by the probe like
  // that part, under its own key, while the turn runs, selected or not, so selecting the
  // turn (which rebuilds nothing) finds it measured.
  workYou(r) { return { ...r, kind: "you", key: `wyou:${r.key}`, full: true, less: false, all: this.full.has(`ya:${r.key}`) }; }

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
    if ((this.shapeSpent ?? 0) > this.shapeMax()) {
      this.shapeLeft = (this.shapeLeft ?? 0) + 1;
      this.otherLeft = (this.otherLeft ?? 0) + 1;
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

  // Codex, OpenCode, Pi and Cursor can leave a turn with no usage on record (one stopped early), and "0 tokens"
  // would claim a count nobody made. Claude Code's cards keep the chip they always had.
  showTokens(st) { return st.tokens > 0 || this.agent().key === "claude"; }

  // The Turn card's rows (i): [label, value, what it means, counts under the value or null],
  // "context compacted" first when it happened. Elapsed time stays on "Worked for".
  detailRows(turn) {
    // Kept per turn, since every settled line on screen carries a card; the key notices a turn
    // that changed in place (a reply still arriving).
    const who = this.agent().short;
    const k = `${who}|${turn.tools}|${turn.model}|${turn.effort}|${turn.compactions}|${Object.keys(turn.usage ?? {}).length}`;
    const m = (this.detailMemo ??= new WeakMap());
    const hit = m.get(turn);
    if (hit && hit.k === k) return hit.rows;
    const rows = this.detailRowsOf(turn, who);
    m.set(turn, { k, rows });
    return rows;
  }
  detailRowsOf(turn, who) {
    const st = stats(turn);
    const model = [shortModel(turn.model), turn.effort].filter(Boolean).join(" · ");
    return [
      turn.compactions ? ["Context", "Compacted", `The conversation got long, so ${who} summarised the earlier part to free room. Some earlier detail is condensed.`, null] : null,
      model ? ["Model", model, "The model that answered, and the effort level it was set to.", null] : null,
      this.showTokens(st) ? ["Tokens", fmtTokens(st.tokens), `Text ${who} newly read and wrote this turn. Re-reading its cache is not counted${st.cachePct != null ? ", so it can be far smaller than the cache read count" : ""}.`, null] : null,
      ["Tool calls", fmtCount(turn.tools), `Commands, file reads and edits ${who} ran for this turn.`, null],
      st.cachePct != null ? ["Cache hit", fmtPct(st.cachePct), `Share of the prompt ${who} read back from its cache instead of processing it again. High is normal on a long session, and cheaper. Under it: tokens read from the cache, written to it, and new input.`, cacheLine(st).replace(/^cache /, "")] : null,
    ].filter(Boolean);
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

  // "USER", "USER · COMMAND", "FROM T7 REVIEW", or for a message a sender rule matched
  // "FROM BUILD-BOT · MATCHED BY RULE". youParts gives the name and the words apart.
  youParts(turn) {
    if (!turn.agent) return { name: turn.cmd ? "USER · COMMAND" : "USER", words: null };
    if (!turn.sender?.name) return { name: kindWords(turn.sender).toUpperCase(), words: null };
    return { name: `FROM ${turn.sender.name.toUpperCase()}`, words: senderOrigin(turn.sender) === "rule" ? "MATCHED BY RULE" : null };
  }
  youLabel(turn) {
    const p = this.youParts(turn);
    return p.words ? `${p.name} · ${p.words}` : p.name;
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
    // An agent's bubble is at least as wide as the line inside it ("FROM BUILD-BOT ·
    // MATCHED BY RULE", 11.5 px capitals, about 7.5 px each, after an 11 px icon and a 5 px
    // gap), up to the bubble's limit.
    const head = r.turn.agent ? Math.ceil(this.youLabel(r.turn).length * 7.5) + 16 + 2 * ROW.BUBBLE_PX : 0;
    const sig = `${r.full ? 1 : 0}${r.all ? 1 : 0}|${this.perLine()}|${Math.round(this.width)}|${this.prefs.textSize}|${this.chars()}|${this.linksVer}|${this.repoSig()}|${src.length}|${hl ? q : ""}|${plain ? 1 : 0}|${head}`;
    if (r.turn.youMemo?.sig === sig) return r.turn.youMemo.v;
    const c = this.youText(r);
    // Show all reads up to 200,000 characters of the prompt, and says what it leaves out.
    const max = r.full ? FULL_PROMPT_CHARS / 8 : 4000;
    const bmax = bubbleMax(this.width, this.prefs.textSize, this.chars());
    const yc = this.charW(YOU_CHAR);
    // A hyphenated token longer than about 3/4 of the widest bubble's line gets HYPHEN_BREAK
    // after its "-"s in the drawn text (ui.js hyphenBreaks); the margin is for a line of
    // wider letters than the estimate's average. y.text stays the message itself. Only these
    // plain lines get breaks, never the Markdown below: a plain bubble's Markdown can be
    // selected and Herdr copies it as drawn. A pasted block gets none: it is drawn as code,
    // and code keeps what was typed.
    const brk = Math.max(8, Math.floor(((bmax - 2 * ROW.BUBBLE_PX) / yc) * 0.75));
    const parts = plain ? promptParts(c.text, max).map((p) => {
      const t = p.lines.join("\n");
      if (p.paste) return { ...p, draw: t, rows: null };
      return { ...p, draw: hyphenBreaks(t, brk), rows: hl && t.toLowerCase().includes(q.toLowerCase()) ? p.lines.map((l) => breakSpans(l, q, brk)) : null };
    }) : null;
    const m = plain ? { md: "", quotes: parts.filter((x) => x.quote).length, code: 0, links: 0, cut: Math.max(0, c.text.length - max * 8) }
      : promptMd(c.text, { links: this.links, ...this.linkCtx(), max });
    const extra = 6 * m.quotes + 16 * m.code;
    // The bubble: as wide as the widest line, at most bubbleMax.
    const widest = c.text.split("\n").slice(0, 400).reduce((w, l) => Math.max(w, l.length), 0);
    const bw = Math.min(bmax, Math.max(r.turn.agent ? 160 : 120, head, Math.ceil(widest * yc) + 2 * ROW.BUBBLE_PX + 8, m.quotes || m.code ? bmax : 0));
    const per = Math.max(8, Math.floor((bw - 2 * ROW.BUBBLE_PX) / yc));
    const n = wrappedLines(c.text, per);
    // One spare line, so the first frame's estimate does not run short.
    const raw = c.text ? (n + 1) * this.rt().line + extra : 0;
    // Taller than YOU_MAX (long): its first YOU_MAX px, cut, with Show all under it (capped),
    // until Show all (r.all) draws it whole at its measured height, with Show less.
    const long = raw >= YOU_MAX;
    const capped = long && !r.all;
    // A coloured bubble draws the prompt as plain text, so the links its rules make go on a
    // line of their own under the bubble (youLinks), each once (issue 116).
    const lk = plain && this.links.length ? promptLinks(c.text, this.links, this.linkCtx()) : [];
    const linkMd = lk.length ? lk.map((p) => `[${escapeMd(p.t)}](${p.url})`).join(" \u00b7 ") : null;
    // Its rows at the width inside the bubble's padding (the line has the same padding).
    const linkH = linkMd ? YOU_LINK_GAP + YOU_LINK_LINE * linkLineRows(lk.map((p) => p.t), bw - 2 * ROW.BUBBLE_PX) : 0;
    const v = { ...m, text: c.text, more: c.more, hl, plain, parts, extra, bw, bodyH: capped ? YOU_MAX : raw, capped, long, linkMd, linkH };
    r.turn.youMemo = { sig, v };
    return v;
  }

  youHeight(r) {
    const y = this.youMd(r);
    const clipped = !r.full && y.more > 0;
    const canLess = (r.less && this.youClip(r.turn).more > 0) || (y.long && !clipped);
    const chip = r.turn.cmd ? this.rt().line + 4 : 0;
    const label = r.turn.agent ? 16 + 4 : 0;
    // 8 padding, the sender (an agent's), the text, Show all or Show less, 8 padding.
    // Then the line of links under a coloured bubble, if its rules made any.
    return 8 + label + chip + (y.text ? y.bodyH : 0) + (clipped || canLess ? 22 : 0) + 8 + y.linkH;
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
      const m = this.measured(this.cmdFor(r));
      return (m != null ? r.shape.mdBase + m : r.shape.height) - this.splitCut(r) - this.foldCut(r);
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
      case "turn": return r.shape.height - this.splitCut(r) - this.foldCut(r);
      case "afold": return r.open ? ROW.META : ROW.PAD_T + ROW.META;
      case "wrow": return r.shape.height - (r.split ? ROW.PAD_T + (r.turn.agent ? ROW.META + ROW.GAP : 0) - ROW.GAP : 0) - this.noticeCut(r);
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
        // The message is the open turn's YOU part (workYou): its measure, or its estimate.
        const g = this.workingGeom(r.turn, r.shape);
        // A task notification's turn: its quiet line in place of the message and its strip.
        if (noticeTurn(r.turn)) return ROW.PAD_T + ROW.META + ROW.GAP + ROW.LINE + ROW.GAP + g.note * NOTE_LINE + ROW.PAD_B;
        const y = this.workYou(r);
        return (r.split ? ROW.GAP : ROW.PAD_T) + (this.measured(y) ?? this.youHeight(y))
          + ROW.GAP + ROW.META + ROW.GAP + ROW.LINE + ROW.GAP + g.note * NOTE_LINE + ROW.PAD_B;
      }
      case "head": return ROW.PAD_T;
      case "ustrip": return ROW.GAP + ROW.META;
      case "you": return this.youHeight(r);
      case "rhead": return ROW.GAP + ROW.LINE + (this.captionRows(r.turn) ? 6 + this.captionRows(r.turn) * 18 : 0);
      case "lhead": return 14 + TV_LINE;
      case "latest": return 6 + (r.md ? this.mdHeight(r.md) + (r.left > 0 ? LATEST_NOTE : 0) + (r.whole ? 0 : 22) : this.latestBox(r) + (this.latestCut(r) ? 22 : 0));
      case "noreply": return 6 + TV_LINE * (this.wrapped(this.noReplyText(r.turn), w, MD_CHAR) + 1);
      case "md": return (r.gap ?? 6) + (r.table ? this.tableHeight(r) : this.mdHeight(r.src ?? r.md));
      case "seltext": return 6 + 22 + r.boxH;
      case "codehead": return 8 + 28;
      case "code": return this.codeBoxH(r);
      case "codeall": return SHOW_ALL_H;
      case "mview": return SHOW_ALL_H;
      case "fold": return 8 + 26 + (r.left ? 18 : 0);
      case "itext": return 6 + this.mdHeight(r.src);
      case "grp": return STEP_GAP + GROUP_H;
      case "call": return (r.one ? STEP_GAP + GROUP_H : CALL_H) + (r.more ? 0 : (this.callShape(r).rows - 1) * CALL_LINE);
      case "cout": return outHeight(r.box, r.shown);
      case "oall": return SHOW_ALL_H;
      case "wspin": return STEP_GAP + GROUP_H;
      case "copy": return ROW.GAP + ROW.ACTS + ROW.PAD_B;
    }
    return 30;
  }

  // ---- measured heights (V3b) ----
  // gpui gives no text measure, but on_size_change reports an element's laid-out height.
  // So each open-card text part is drawn a second time in a hidden probe outside the list
  // (probe()), at the card's text width and with no fixed height; its height, divided by
  // zoom, becomes the part's list size. A measure is kept under the part's key with a
  // signature of everything that changes its layout.

  // What every part's signature starts with, read from Herdr's settings once per draw. Every
  // row's height and every probe part asks for it; read once per part, it took a third of
  // Herdr's time for a draw in a session of 2,000 turns ("This view could not be
  // re-rendered", interrupted).
  sigBase() {
    const r = this.renders ?? 0, w = Math.round(this.width), P = this.prefs;
    const m = this.sigMemo;
    if (m && m.r === r && m.w === w && m.ts === P.textSize && m.pw === this.chars()) return m.v;
    const v = `${w}|${this.zoom()}|${settings()?.ui_font ?? ""}|${P.textSize}|${this.chars()}`;
    this.sigMemo = { r, w, ts: P.textSize, pw: this.chars(), v };
    return v;
  }
  partSig(r, base = this.sigBase()) {
    const head = `${base}|${r.kind}`;
    switch (r.kind) {
      case "you": { const y = this.youMd(r); return `${head}|${y.text.length}|${y.more}|${r.full ? 1 : 0}|${y.hl ? this.filterText() : ""}|${y.plain ? 1 : 0}|${y.capped ? 1 : 0}|${this.linksVer}|${this.repoSig()}|${y.linkMd ?? ""}`; }
      case "rhead": return `${head}|${this.captionParts(r.turn).map((x) => x[1]).join("|")}`;
      case "itext": return `${head}|${r.md.length}|${this.linksVer}`;
      case "md": return `${head}|${r.md.length}|${r.gap ?? 6}|${this.linksVer}|${this.repoSig()}|${this.mdBroken?.has(r.key) ? "plain" : "md"}${r.table ? `|t${this.tableExtra(r)}` : ""}`;
      case "cmd": return `${head}|${r.md.length}|${r.md.slice(-24)}|t${this.tableExtra(r)}`;
      case "lhead": return `${head}|${r.turn.followups}`;
      // The Markdown form draws a Show less row only after Show all (not when whole) and a note
      // past the cap (left), so both are part of its layout.
      case "latest": return `${head}|${r.md ? `all${r.md.length}|${r.whole ? "w" : "s"}|${r.left ?? 0}` : r.text.length}`;
      case "noreply": return `${head}|${this.noReplyText(r.turn)}`;
      default: return head;
    }
  }

  // The measured height of a part for its current layout, or null.
  measured(r) {
    const h = this.measOf(r.key, this.partSig(r));
    return h > 0 ? h : null;
  }
  // A part's measure for a layout (sig): the last one taken, or one of the WIDTHS_KEPT - 1
  // before it (old), so a width seen before needs no probe. The part's text changing makes
  // a new sig, and its old measures go out as new ones come in.
  measOf(key, sig) {
    const m = this.meas?.get(key);
    if (!m) return null;
    if (m.sig === sig) return m.h;
    const o = m.old?.find((x) => x.sig === sig);
    return o ? o.h : null;
  }
  measPut(key, sig, h) {
    const was = this.meas.get(key);
    const all = was ? [{ sig: was.sig, h: was.h }, ...(was.old ?? [])].filter((x) => x.sig !== sig) : [];
    const old = all.slice(0, WIDTHS_KEPT - 1);
    this.meas.set(key, old.length ? { sig, h, old } : { sig, h });
    // A layout that lost a measure: rows the probe found measured there are looked at again
    // (probeDue's stamp).
    for (const x of all.slice(WIDTHS_KEPT - 1)) {
      const d = (this.measDrops ??= new Map());
      if (d.size >= 64) { d.clear(); this.dropEpoch = (this.dropEpoch ?? 0) + 1; }
      const b = x.sig.split("|", 5).join("|");
      d.set(b, (d.get(b) ?? 0) + 1);
    }
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
      this.measVer = (this.measVer ?? 0) + 1;
      cx.notify();
      return;
    }
    if (this.measOf(key, sig) === h) return;
    // Every closed row's reply block is measured: a cap under the turns a long session has
    // made the probe measure the same parts again and again.
    // PR 81 (kept rows' sizes) and PR 83 (the probe's walk) each start over when measures go.
    if (this.meas.size > 20000) { this.meas.clear(); this.measEpoch = (this.measEpoch ?? 0) + 1; this.probeEpoch = (this.probeEpoch ?? 0) + 1; }
    this.measPut(key, sig, h);
    this.measVer = (this.measVer ?? 0) + 1;
    const rowKey = key.startsWith("cmd:") ? key.slice(4) : key.startsWith("wyou:") ? key.slice(5) : key;
    const i = this.baseIndex?.get(rowKey);
    const r = i != null ? this.baseRows[i] : null;
    if (r?.key === rowKey) {
      this.baseSizes[i] = this.height(r);
      this.sizesVer = (this.sizesVer ?? 0) + 1;
      // The turn's kept rows (closedCached) have the old size: built again next time.
      // A row kept for this layout gets the new size too, so a drag back to this width builds
      // it from what was kept. Measured at another layout (a width the pane has just left),
      // the turn's rows kept for that one are built again next time (closedSig's count).
      const base = sig.split("|", 5).join("|");
      const kept = r.turn && r.si != null ? this.keptBases?.get(base) : null;
      if (kept) {
        const tk = `${r.si}:${r.turn.n}`;
        const e = kept.rows.get(tk);
        const j = e?.sizes && base === this.sigBase() ? e.rows.indexOf(r) : -1;
        if (j >= 0) e.sizes[j] = this.baseSizes[i];
        else kept.meas.set(tk, (kept.meas.get(tk) ?? 0) + 1);
      }
    }
    cx.notify();
  }

  // The parts still to measure, each drawn in the probe for at most three frames: a part
  // that never reports keeps its estimate (the debug report says "measured: none").
  // The parts to measure this frame: at most PROBE_MAX, nearest the top of the pane first,
  // found by walking out from the top row both ways and stopping once there are enough (a
  // pass over every part each frame cost 5 to 13 ms in a 6,000-turn session while its rows
  // were measured). probeLeft is above 0 while parts may be left.
  probeDue() {
    const want = [];
    this.probeFor = this.anchor ?? null;
    this.probeTries ??= new Map();
    const base = this.sigBase();
    // Nothing was due and nothing it depends on changed: every part was measured, or tried.
    const qm = this.probeQuiet;
    if (qm && qm.ver === (this.probeVer ?? 0) && qm.base === base && qm.mv === (this.measVer ?? 0) && qm.broken === (this.mdBroken?.size ?? 0)) { this.probeLeft = 0; return want; }
    // Rows being built for a new layout: the ones shown now are about to go. The walk waits
    // for the new ones (a draw that builds rows has no time for it as well).
    if (this.rowJob && this.baseRows?.length) { this.probeLeft = 1; return want; }
    const rows = this.baseRows ?? [];
    const n = rows.length;
    // A closed turn's reply block found measured in this layout, pane width and rail, with no
    // measure dropped since, is passed over at once (stamped below): a column width seen
    // before is not walked again, part by part. 2,000 turns took 150 to 190 ms of frames.
    const stamp = `${base}|${Math.round(this.pw())}|${this.railShown() ? 1 : 0}|${this.measEpoch ?? 0}|${this.dropEpoch ?? 0}|${this.measDrops?.get(base) ?? 0}`;
    const top = Math.min(Math.max(0, (this.topKey != null && this.baseIndex?.get(this.topKey)) || 0), Math.max(0, n - 1));
    // Within the clean radius of the top row nothing was due, and while the rows, their
    // layout and the top stay, a new measure only settles parts: the walk starts there.
    // Measures and tries cleared (probeEpoch) start it from the top again.
    // A measure dropped for this layout (stamp) starts it again too.
    // While a place is held (holdPlace), the rows above the top row, and only the few below it:
    // the place is let go once the rows above are measured. The rest below come after.
    const up = this.anchor && !this.anchor.end;
    const wk = `${this.probeVer ?? 0}|${base}|${this.mdBroken?.size ?? 0}|${top}|${this.probeEpoch ?? 0}|${stamp}|${up ? 1 : 0}`;
    const d0 = this.probeWalk?.key === wk ? this.probeWalk.clean : 0;
    const visit = (r) => {
      if (r.probeOk === stamp && r.kind === "turn") return 0;
      const part = PROBED.has(r.kind) ? r : r.kind === "turn" && r.shape?.md != null ? this.cmdFor(r)
        : r.live && (r.kind === "working" || r.kind === "wrow") ? this.workYou(r) : null;
      if (!part) return 1;
      const sig = this.partSig(part, base);
      if (this.measOf(part.key, sig) > 0) { if (r.kind === "turn") r.probeOk = stamp; return 1; }
      const k = `${part.key}|${sig}`;
      if ((this.probeTries.get(k) ?? 0) >= 3) return 1;
      want.push([part, sig, k]);
      return 1;
    };
    let d = d0;
    let clean = d0;
    let seen = 0;
    for (; d < n && seen < PROBE_WALK; d++) {
      if (up && d > PROBE_NEAR && top - d < 0) break;
      if (top + d < n && !(up && d > PROBE_NEAR)) seen += visit(rows[top + d]);
      if (d > 0 && top - d >= 0) seen += visit(rows[top - d]);
      if (!want.length) clean = d + 1;
      if (want.length >= PROBE_MAX) break;
    }
    this.probeWalk = { key: wk, clean };
    const out = want.slice(0, PROBE_MAX);
    for (const [, , k] of out) this.probeTries.set(k, (this.probeTries.get(k) ?? 0) + 1);
    // Nothing due anywhere: quiet. Otherwise parts wait, or rows are not looked at yet.
    // Rows below left out while a place is held are not done.
    const done = !up && top + clean >= n && top - clean < 0;
    this.probeAbove = top - clean < 0;
    this.probeLeft = done ? 0 : 1;
    this.probeQuiet = done ? { ver: this.probeVer ?? 0, base, mv: this.measVer ?? 0, broken: this.mdBroken?.size ?? 0 } : null;
    // Not while a place is held: cleared tries would be tried again, and the hold, which waits
    // for every part above to be measured or tried 3 times, might never end.
    if (this.probeTries.size > 4000 && !this.anchor) { this.probeTries.clear(); this.probeEpoch = (this.probeEpoch ?? 0) + 1; }
    return out.map(([r, sig]) => [r, sig]);
  }

  // Zero height, clipped and fully transparent, outside the list: the parts laid out at the
  // card's text width with their own TextView ids, no scroll and no fixed heights. Not
  // invisible(): gpui may skip painting a hidden element's subtree, and a size report made
  // at paint would then never come. The zero-height clip and opacity 0 hide it (R3-1).
  probe(t, due) {
    this.hlCur = false;
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
    return this.prefs.truncate ? Math.min(full, LATEST_LINES * line) : full;
  }
  latestCut(r) {
    if (r.md || !this.prefs.truncate) return false;
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
      : turn.errors.at(-1) ?? (turn.answeredBy ? `${this.agent().short} answered this together with #${turn.answeredBy}. Go to that reply` : "No final reply.");
  }

  // The list's items for the range on screen. An error thrown here blanks the whole list
  // until it scrolls or resizes, and Herdr reports nothing, so each item is drawn on its own:
  // one that fails shows as a short error row, and the error is kept for the owner.
  listItems(t, rows, slots, range, focusedPanel, dim) {
    if (this.drawingRow) this.rowCut(this.drawingRow);
    // gpui also asks for item 0 alone, to measure the list's width. That is not the top of
    // the pane, and taking it as the top would move a pin's place to the first row.
    if (!(range.start === 0 && range.end === 1 && rows.length > 1)) {
      this.trackOff(slots, range);
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
      // The Pinned view's rows on screen, for the unpin buttons over them (pinButtonRows): when
      // they change, the next frame draws the buttons for them.
      if (this.view === "pinned") {
        const drawn = rows.slice(range.start, range.end).map((x) => x?.key).join("\n");
        if (drawn !== this.pinDrawn) { this.pinDrawn = drawn; this.stickyDue = true; }
      }
      try { this.stickCheck(rows, prevShown, range.start); } catch (e) { this.drawFailed(e, null); }
      if (this.unseen && this.bottomShown) { if (this.unseen === true) this.stickyDue = true; this.unseen = false; }
      else if (this.unseen === "pending") { this.unseen = true; this.stickyDue = true; }
    }
    const out = [];
    for (let i = range.start; i < range.end; i++) {
      const x = rows[i];
      const h = slots[i] > 0 ? slots[i] : 1;
      let body;
      const cut = x && this.cutRows?.get(x.key);
      const held = cut && cut.until > now();
      if (held && cut.blank) body = div();
      else {
        this.drawingRow = x ? { key: x.key, lite: Boolean(held) } : null;
        this.liteDraw = Boolean(held);
        try { body = x ? this.item(t, x, focusedPanel, h) : div(); } catch (e) { this.drawFailed(e, x); body = this.drawErrorRow(t, e); }
        this.liteDraw = false;
        this.drawingRow = null;
      }
      // A plain row keeps the slot its Markdown measured, which is taller: it sits at the
      // slot's foot, so its end is next to the rows below it.
      // The list spans the pane and each item sits in the reading column, centred. An item
      // with a wide table (tableExtra) is wider by it, padded by half on each side, so its
      // other parts stay in the column and the table reaches past it (tableBlock). Herdr
      // clips an item on both axes, even with overflow_y_hidden. A turn a jump landed on has
      // its flash layer over the column (flashTurn).
      const ex = this.tableExtra(x);
      const fl = this.flash && x && (rowTurnKey(x) ?? x.key) === this.flash.key ? this.flash : null;
      out.push(h_flex().w_full().h(h).justify_center()
        .child(v_flex().w_full().max_w(this.width + ex).when(ex > 0, (el) => el.px(ex / 2)).h_full().overflow_hidden()
          .when(Boolean(held), (el) => el.justify_end())
          .when(Boolean(dim && x && !CARD.has(x.kind)), (el) => el.opacity(0.55))
          .when(Boolean(fl), (el) => el.relative().child(div().id(`th-flash-${fl.n}-${x.key}`).absolute().top(0).left(0).size_full()
            .bg(alpha(t.accent, FLASH.ALPHA)).opacity(fl.on ? 1 : 0).transition("opacity", { duration: FLASH.FADE, easing: "ease-out" })))
          .child(body)));
    }
    return out;
  }

  // A row Herdr stopped while it drew (drawingRow still set when the list draws again): drawn
  // plainly, or blank if it was already plain, for CUT_MS, doubling each time.
  rowCut(d) {
    this.drawingRow = null;
    this.liteDraw = false;
    const c = (this.cutRows ??= new Map());
    const n = (c.get(d.key)?.n ?? 0) + 1;
    c.delete(d.key);
    c.set(d.key, { n, blank: d.lite, until: now() + Math.min(300000, CUT_MS * 2 ** (n - 1)) });
    if (c.size > 200) c.delete(c.keys().next().value);
    this.rowCuts = (this.rowCuts ?? 0) + 1;
    // Once its row callback is stopped, Herdr's list asks only for the first row again (to
    // measure), never for the rows on screen, and stays blank. A new id gives a new list,
    // kept at the place it had: the end when the end was on screen.
    this.listGen = (this.listGen ?? 0) + 1;
    if (this.bottomShown) this.toBottom = true;
    else if (this.topKey != null) this.scrollTo = { key: this.topKey, how: "top" };
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
  // How many draws Herdr stopped, for an agent on the owner's machine: shared("threads.cuts"),
  // counts and times only, written when they change.
  publishCuts() {
    const k = `${this.renderCuts ?? 0}|${this.rowCuts ?? 0}`;
    if (k === "0|0" || k === this.cutsSent) return;
    this.cutsSent = k;
    try { setShared("threads.cuts", { renders: this.renderCuts ?? 0, rows: this.rowCuts ?? 0, at: new Date().toISOString() }); } catch { /* counts only */ }
  }

  publishDrawError(cx) {
    const d = this.drawError;
    if (!d || d.sent) return;
    d.sent = true;
    try { setShared("threads.drawError", { ...d, count: this.drawErrors, terminal: this.terminal ?? null }); } catch { /* the toast still says it */ }
    this.say("Part of a turn could not be drawn. The details are saved for the owner.", "circle-x", cx, 5000);
  }

  item(t, r, focusedPanel, size) {
    // The selected turn's search matches get the stronger fill (hlFill) while its rows draw.
    this.hlCur = r.turn != null && Boolean(this.sel) && r.turn === this.findTurn(this.sel);
    switch (r.kind) {
      case "spacer": return div();
      case "gap": return div();
      case "tail": return div();
      case "turn": return this.rowItem(t, r, focusedPanel);
      case "line": return this.lineItem(t, r, focusedPanel);
      case "wrow": return this.workingRow(t, r, focusedPanel);
      case "wtop": return this.workingTop(t, r, focusedPanel);
      case "afold": return this.foldLine(t, r);
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
  // rowHeight). The selected exchange has no mark on the row itself (the owner found the bar
  // on its left too distracting) and no fill, so a text selection in it always shows.
  rowFrame(_t, _sel, _focusedPanel, _live, kids, top = ROW.PAD_T, bottom = ROW.PAD_B) {
    return v_flex().w_full().relative().px(ROW.PAD_X).pt(top).pb(bottom).gap(ROW.GAP).min_w(0)
      .children(kids);
  }

  // The sender over an agent's message: its icon and name in the agent colour, on the left.
  senderLine(t, turn) {
    const ac = this.agentColor(t);
    const tip = this.ruleTip(turn);
    return h_flex().h(ROW.META).gap(5).items_center().text_size(11.5).min_w(0)
      .when(Boolean(tip), (el) => el.id("th-rule").tooltip(tip))
      .child(svg(ICON(senderIcon(turn.sender))).size(12).flex_none().text_color(ac))
      .child(this.labelView(senderParts(turn.sender, this.width), ac, this.labelRoom(turn, replyWidth(this.width))));
  }
  // An agent message's label as drawn: its name, cut in the middle when the room is short,
  // then "·" and its words ("hc report", "matched by rule"), which are never cut (ui.js
  // senderParts). room: the most it may take, or null to shrink with its parent (the line
  // inside an open bubble).
  labelView(parts, color, room, semibold = true) {
    return h_flex().gap(4).items_center().min_w(0).text_color(color).when(semibold, (el) => el.font_semibold())
      .when(room != null, (el) => el.flex_none().max_w(room))
      .child(div().min_w(0).overflow_hidden().whitespace_nowrap().text_ellipsis_middle().child(parts.name))
      .when(Boolean(parts.words), (el) => el.child(div().flex_none().child("·")).child(div().flex_none().whitespace_nowrap().child(parts.words)));
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
  reveal(t, el) { return el.text_color(CLEAR).when(!this.covered(), (x) => x.hover((s) => s.text_color(t.dim))); }

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
  // number in the accent colour. An open line ends with the info icon for the Turn card
  // (info): "on" while the card shows this turn, "sel" on the selected turn, "hover" with no
  // colour of its own, for the hover around the line to reveal. Every other part sets its own
  // colour, so only the icon takes the hover's.
  workLine(t, turn, pinNo = this.pinNumber(turn), open = false, info = null) {
    const bad = turn.interrupted || this.failed(turn);
    const name = this.mixedAgents(turn) ? this.agentName(turn) : null;
    const pinned = this.isPinnedTurn(turn);
    return v_flex().h(ROW.LINE).w_full().max_w(this.prose()).min_w(0).border_b_1().border_color(t.border)
      .child(h_flex().h(17).gap(5).items_center().text_size(12).min_w(0)
        // On a narrow line the agent's name gives way (it shrinks and truncates); the time after
        // it never does, so "Worked for" is never shown without its time.
        .when(Boolean(name), (el) => el.child(div().min_w(0).max_w(160).truncate().font_semibold().text_color(t.muted).child(name)).child(div().flex_none().text_color(t.dim).child("·")))
        .child(div().flex_none().text_color(bad ? t.blocked : t.dim).child(this.workText(turn)))
        .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim))
        .child(div().flex_1())
        .when(pinned, (el) => el.child(svg(ICON("pin")).size(12).flex_none().text_color(t.accent)))
        .when(pinNo != null, (el) => el.child(div().flex_none().text_size(11).font_semibold().text_color(t.accent).child(String(pinNo))))
        .when(Boolean(info), (el) => el.child(info.el ?? this.infoIcon(t, info.state))));
  }
  // Always shown, in the line's label colour (dim, about 3:1) on every turn, accent while its
  // card shows. A hover style alone did not show on the owner's machine, and at half strength
  // it fell under 2:1 in every theme.
  infoIcon(t, state) {
    return div().flex_none().w(ICON_BOX).h(17).flex().items_center().justify_end()
      .child(svg(ICON("info")).size(12).text_color(state === "on" ? t.accent : t.dim));
  }
  // The info icon of a turn's line, for item itemKey, and the card's anchor: its top right
  // corner under the icon's right edge, or its bottom right corner over it when the line is
  // low in the pane (detailsDir). Where i or a click opened the card for this turn, a Popup.
  // Otherwise, while no card is open, a HoverCard: resting the pointer on the icon shows the
  // card and moving off hides it, on an open or a closed turn. Never in the hidden probe,
  // which would draw a second card.
  lineIcon(t, itemKey, key, probe) {
    const state = this.infoState(key);
    if (probe || !Popup || (state !== "on" && (this.detailsOpen || !HoverCard || this.covered()))) return { state };
    const turn = this.findTurn(key);
    if (!turn || this.detailsAnchor(key) !== itemKey) return { state };
    const up = this.detailsDir(itemKey, turn) === "up";
    const anchor = up ? "bottom_right" : "top_right";
    if (state === "on") return { state, el: Popup.new(`th-details-${key}`, this.infoIcon(t, state)).anchor(anchor).content(this.detailsCard(t, turn, up)) };
    return { state, el: HoverCard.new(`th-hover-${key}`).anchor(anchor).open_delay(HOVER_OPEN_MS).close_delay(HOVER_CLOSE_MS)
      .trigger(this.infoIcon(t, state)).content(this.detailsCard(t, turn, up, true)) };
  }
  // The info icon's state on a turn's settled Worked for line, open or closed: "on" while the
  // card shows this turn, "sel" on the selected turn, "hover" on the others (drawn at half
  // strength; resting the pointer on it shows the card).
  infoState(key) {
    if (this.sel !== key) return "hover";
    return this.detailsOpen ? "on" : "sel";
  }
  // The list item whose Worked for line the card opens beside: an open turn's line, or a
  // closed turn's row. Null for a running turn, the outline and the Pinned view.
  detailsAnchor(key) {
    const rows = this.rowsMemo ?? this.rows();
    if (this.rowIndex(`rhead:${key}`) >= 0) return `rhead:${key}`;
    const row = rows[this.rowIndex(key)];
    return row && row.kind === "turn" && !row.live && !row.running && !row.compact ? key : null;
  }
  // Whether a list item was in the range the list last drew.
  onScreen(key) {
    const i = this.rowIndex(key);
    const [a, b] = this.viewRange ?? [0, 0];
    return i >= a && i < b;
  }
  // The line's words: "Worked for 2m 31s"; a stopped or failed turn says how long it ran.
  workText(turn) {
    const d = turn.durationMs ? fmtDuration(turn.durationMs) : null;
    if (turn.interrupted) return d ? `Stopped after ${d}` : "Stopped";
    if (this.failed(turn)) return d ? `Failed after ${d}` : "Failed";
    // A turn the agent answered together with a later one has no time of its own: the line
    // says where its answer is, not a bare "Worked".
    if (!d && turn.answeredBy) return `Answered with #${turn.answeredBy}`;
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

  // The strip under a reply (ui.js actsLayout): on the selected turn, copy the reply and quote
  // it, as icons (keys c and q; s and t have no icon). It keeps its height
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
      .when(Boolean(L.select), (e) => e.child(box("text-cursor", this.selecting === key ? t.accent : ink, has)));
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
    const inset = this.edgeInset(turn, style);
    const box = this.bubbleEdge(this.readFont(v_flex().flex_none().w(w).max_w_full().px(ROW.BUBBLE_PX - inset).py(ROW.BUBBLE_PY - inset).min_w(0)).bg(style.fill).text_color(this.bubbleLook(t, agent).theme.foreground), t, turn, style)
      .when(!agent, (el) => el.rounded_tl(14).rounded_tr(14).rounded_bl(14).rounded_br(4))
      .when(agent, (el) => el.rounded_tl(4).rounded_tr(14).rounded_bl(14).rounded_br(14))
      .children(kids);
    return h_flex().w_full().min_w(0).when(!agent, (el) => el.justify_end()).child(box);
  }
  // Whether a turn's bubble has the dashed edge: a message a sender rule matched.
  ruleEdge(turn) { return RULE_EDGE === "dashed" && Boolean(turn.agent) && senderOrigin(turn.sender) === "rule"; }
  // The edge of a bubble. A message a sender rule matched: 1 px dashed, in the bubble's ink
  // at 50% on a coloured fill (its quote bar's colour), in muted on Plain in place of the
  // solid outline; the fill is the same. Any other agent's bubble: on Plain the solid
  // outline, else none. A Herdr whose elements have no border_dashed draws the edge solid.
  bubbleEdge(el, t, turn, style) {
    if (!this.ruleEdge(turn)) return style.outline ? el.border_1().border_color(t.border) : el;
    let e = el.border_1();
    if ("border_dashed" in e) e = e.border_dashed();
    return e.border_color(style.outline ? t.muted : style.bar);
  }
  // The padding an edge takes back on a coloured bubble, so its text sits where a bubble
  // with no edge has it.
  edgeInset(turn, style) { return this.ruleEdge(turn) && !style.outline ? 1 : 0; }

  // How a bubble is drawn (settings bubbleColor and agentBubbleColor, ui.js bubbleStyle),
  // and the theme its text is drawn with. On a coloured fill the bubble's ink stands in for
  // the text, muted and accent colours, so a quote, a command's name and Show more read on
  // it. Plain keeps the pane's theme: the person's bubble is the text colour at 8% over
  // whatever is under it. under is that fill drawn over the background, for hlFill.
  bubbleLook(t, agent) {
    const v = agent ? this.prefs.agentBubbleColor : this.prefs.bubbleColor;
    const k = `${agent ? 1 : 0}|${v}|${t.foreground}|${t.background}|${t.muted}|${t.dim}|${t.border}`;
    this.bubbleMemo ??= new Map();
    let look = this.bubbleMemo.get(k);
    if (!look) {
      const style = bubbleStyle(v, t, agent);
      const plain = style.outline || style.ink === t.foreground;
      const theme = plain ? t : { ...t, foreground: style.ink, muted: style.sub, dim: style.sub, accent: style.ink, background: style.fill, selected: style.fill, border: style.bar };
      // What a match in this bubble is drawn on: its fill over the row's (rows have no fill).
      look = { style, theme, under: over(style.fill, t.background) };
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
  // t is the bubble's theme and under what its text is drawn on (bubbleLook).
  promptBlock(t, under, turn, sh, sel = false, key = null) {
    const sl = (id, ls, c, sz, hard = null) => (key ? this.selLines(t, under, `th-sp-${id}-${key}`, ls, c, sz, lh, hard) : this.lines(t, under, ls, c, sz, lh));
    const agent = turn.agent;
    const color = agent ? t.muted : t.foreground;
    const rt = this.rt();
    const size = agent ? rt.small : rt.size;
    const lh = rt.line;
    if (sh.chip) {
      return h_flex().gap(6).items_start().min_w(0)
        .child(div().flex_none().h(lh).flex().items_center().child(this.chip(t, under, sh.chip.label, sh.chip.chipW, sh.prompt.length === 0, sel)))
        .when(sh.prompt.length > 0, (el) => el.child(sl("p", sh.prompt, color, size, sh.pHard)));
    }
    // A prompt that quotes something: each quote line behind a bar, muted at 12.5 px; a
    // quote that is the whole prompt keeps the prompt's own colour and size. A pasted
    // block: one quiet label row ("Pasted · N lines", muted 12.5 px, no bar), then each
    // body line its own mono row, clipped by the shape, never wrapped.
    if (sh.kinds) {
      return v_flex().min_w(0).children(sh.prompt.map((l, i) => {
        const k = sh.kinds[i];
        if (k === "c") return h_flex().min_w(0).when(!agent, (el) => el.font_medium()).child(sl(i, [l], color, size));
        if (k === "p") return h_flex().h(lh).min_w(0).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_family(this.mono()).text_color(color).child(l || " "));
        if (k === "pl") return h_flex().h(lh).min_w(0).items_center().child(sl(i, [l], t.muted, 12.5));
        return h_flex().h(lh).min_w(0).gap(QUOTE_INSET - 2).items_center()
          .child(this.quoteBar(t, agent))
          .child(k === "qonly"
            ? h_flex().flex_1().min_w(0).when(!agent, (el) => el.font_medium()).child(sl(i, [l], color, size))
            : sl(i, [l], t.muted, rt.small));
      }));
    }
    return h_flex().min_w(0).when(!agent, (el) => el.font_medium()).child(sl("p", sh.prompt, color, size, sh.pHard));
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
    // Folded (foldState): the sender is the line over it, and the message is left out.
    return this.rowFrame(t, sel, focusedPanel, false, [
      ...(turn.agent && !r.split && !r.fold ? [this.senderLine(t, turn)] : []),
      ...(r.fold === "folded" ? [] : [this.youGroup(t, turn, key, sel, [
        ...(sh.thumbs && !r.split ? [this.thumbStrip(t, turn, key)] : []),
        this.bubble(t, turn, [
          this.promptBlock(bt, this.bubbleLook(t, turn.agent).under, turn, sh, sel, key),
          ...(sh.pMore ? [this.moreLine(bt)] : []),
        ], sh.bubbleW),
      ])]),
      r.running || r.live ? this.workLine(t, turn, r.pinNo ?? this.pinNumber(turn))
        : div().w_full().child(this.workLine(t, turn, r.pinNo ?? this.pinNumber(turn), false, this.lineIcon(t, key, key, false))),
      v_flex().min_w(0).max_w(this.prose())
        .child(sh.md != null ? this.cmdBlock(sh.md, `th-cmd-cmd:${key}`, this.tableExtra(r)) : this.selLines(t, t.background, `th-sr-${key}`, sh.reply, color, this.rt().size, this.rt().line, sh.rHard))
        .when(sh.rMore, (el) => el.child(this.moreLine(t))),
      this.actsStrip(t, turn, key, sel),
    ], r.split || r.fold ? ROW.GAP : ROW.PAD_T);
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
  pinRow(t, r, _focusedPanel) {
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
    // The unpin button is not in here: a list item can carry no handlers, so it is drawn over
    // the list (pinButtons), at the room the lines leave it (UNPIN_ROOM).
    return h_flex().w_full().relative().px(P.PAD_X).pt(P.PAD_T).pb(P.PAD_B).gap(P.GAP_X).items_start().min_w(0)
      .when(sel, (el) => el.bg(t.selected))
      .when(!sel && !this.covered(), (el) => el.hover((s) => s.bg(t.hover)))
      .child(div().flex_none().size(P.BADGE).mt(-2).rounded(6).flex().items_center().justify_center()
        .bg(alpha(t.accent, sel ? 0.28 : 0.16)).text_size(12).font_semibold().text_color(t.accent).child(String(r.pinNo)))
      .child(v_flex().flex_1().min_w(0).gap(P.GAP).pr(P.UNPIN_ROOM)
        .child(h_flex().h(P.META).gap(5).items_center().min_w(0).text_size(11.5).text_color(t.dim)
          .when(Boolean(st), (el) => el.child(this.liveIcon(st, 12)))
          .when(!st && (turn.interrupted || this.failed(turn)), (el) => el.child(this.statusIcon(t, turn)))
          .child(div().flex_none().font_family(this.mono()).text_color(t.muted).child(`#${turn.n}`))
          .child(div().flex_none().child("·"))
          .when(turn.agent, (el) => el
            .child(svg(ICON(senderIcon(turn.sender))).size(12).flex_none().text_color(ac))
            .child(this.labelView(senderParts(turn.sender, this.width), ac, Math.floor(this.width * 0.4)))
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

  // The closed pins whose unpin buttons are drawn, each with its row's top in the list and its
  // height: compact pins (the Pinned view's closed pins), with nothing over the list, and
  // only while each row's place on screen is known for sure. Herdr gives no read of the
  // list's scroll offset, so that is while the list fits its box (measured; 0 before) and
  // cannot scroll (its offset is 0, and a row is where the heights above it put it), and for
  // the rows the list drew last. A list taller than its box has no buttons; the header's
  // unpin and p still unpin the selected pin. None under the Turn card either: a press
  // outside it only closes it (click()).
  pinButtonRows(rows, slots) {
    if (this.view !== "pinned" || this.covered() || (this.detailsOpen && Popup)) return [];
    let total = 0;
    for (const h of slots) total += h;
    if (total > this.listH + 0.5) return [];
    const drawn = new Set((this.pinDrawn ?? "").split("\n"));
    const out = [];
    let top = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r?.compact && drawn.has(r.key)) out.push({ r, top, h: slots[i] });
      top += slots[i];
    }
    return out;
  }
  // The unpin buttons over the Pinned view's closed pins (pinButtonRows): each is the heading's
  // button (iconButton) with its own click, so a press unpins only on it, and the press and the
  // release both on it (gpui's click), and goes no further (stop_propagation): the list under
  // it neither selects nor opens the turn. It sits in a clear box the size of its row, which
  // tells the pane when the pointer comes onto the row and leaves it (pinHover). The pane draws
  // the button, in its box's colour, on the row the pointer is on and on the selected pin, from
  // its own state, not gpui's hover style, which a key hides while the pointer rests. (gpui's
  // hover callback reports false on the paint after a key; Herdr drops a false while the
  // pointer is still inside the element, so the row the pointer rests on keeps its button.)
  // Only a drawn button has the hover fill and the hand. Its press-down only notes whether it
  // was drawn in the frame the press landed on (unpinDown) and stops nothing, so a drag that
  // starts on it is not held and Herdr still focuses the pane. The click goes by that note: the
  // press-down puts gpui back in pointer mode and the window repaints before the release, and
  // after a key moved the rows (p, u) that repaint can bring the row under the pointer an
  // enter of its own. The layer is laid out as the list's items are: the reading column,
  // centred.
  pinButtons(t, btns) {
    // The row the pointer was on is gone from the layer, or the layer is: it is on no button.
    if (this.hoverPin && !btns.some((b) => b.r.key === this.hoverPin)) this.hoverPin = null;
    if (!btns.length) return [];
    const P = PIN_ROW;
    return [h_flex().id("th-unpins").absolute().top(0).left(0).size_full().justify_center()
      .child(div().w_full().max_w(this.width).h_full().relative()
        .children(btns.map(({ r, top, h }) => {
          const sel = this.sel === r.key;
          const drawn = sel || this.hoverPin === r.key;
          const tip = `Unpin #${r.turn.n}${sel && this.quoteKey !== "p" ? " (p)" : ""}`;
          return div().id(`th-unpin-row-${r.pinNo}`).absolute().top(top).left(0).w_full().h(h)
            .text_color(drawn ? t.dim : CLEAR)
            .on_hover((on, cx) => this.pinHover(r.key, on, cx))
            .child(h_flex().absolute().top(0).bottom(0).right(P.UNPIN_R).items_center()
              .child(div().id(`th-unpin-${r.pinNo}`).flex_none().size(P.UNPIN).flex().items_center().justify_center().rounded(5)
                .when(drawn, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
                .tooltip(tip)
                .on_mouse_down("left", () => { this.unpinDown = { key: r.key, drawn }; })
                .on_click((_e, cx) => {
                  cx.stop_propagation();
                  const down = this.unpinDown?.key === r.key ? this.unpinDown : null;
                  this.unpinDown = null;
                  this.unpinButton(r.key, cx, Boolean(down?.drawn));
                })
                .child(svg(ICON("pin-off")).size(14))));
        })))];
  }
  // The pointer came onto a closed pin's row (on) or left it. Rows' enter and leave can come in
  // either order, so a leave clears only its own row. A redraw only on a change.
  pinHover(key, on, cx) {
    if (on ? this.hoverPin === key : this.hoverPin !== key) return;
    this.hoverPin = on ? key : null;
    cx.notify();
  }
  // A press on a pin's unpin button, or the header's (for the selected pin): the pin goes,
  // and the turn is neither selected nor opened. The notice offers undo (unpin). Nothing
  // while a card or sheet covers the list. Under the Turn card the press only closes it, as
  // a press anywhere outside it does (click()). A press on a button the pane did not draw
  // when the press went down (drawn, from pinButtons' press-down note: neither the selected
  // pin's nor the one on the row the pointer is on, as when a row moved under a pointer at
  // rest) selects that pin, as a press on its row would; selected, its button is drawn, so a
  // second press on the spot unpins it. The header's unpin is the selected pin's: drawn.
  unpinButton(key, cx, drawn = this.sel === key) {
    if (this.covered() || this.view !== "pinned") return;
    if (this.detailsOpen && Popup) { this.detailsOpen = false; cx.notify(); return; }
    if (!drawn) { this.sel = key; cx.notify(); return; }
    const p = this.pinnedList().find((x) => x.key === key);
    if (p) { this.unpin(p, cx); cx.notify(); }
  }

  // An outline row: "#12  8:43 AM  First line of the prompt  📌 2", one line at the reading
  // size, with the selected turn's fill. An agent's message leads with its sender's
  // icon and is muted; a stopped or failed turn leads with its icon; the running turn says
  // "now". Under 300 px the time gives way to the prompt.
  lineItem(t, r, _focusedPanel) {
    const { turn, key } = r;
    const sel = this.sel === key;
    const rt = this.rt();
    const pinNo = this.pinNumber(turn);
    const pinned = pinNo != null || this.isPinnedTurn(turn);
    const icon = turn.agent ? svg(ICON(senderIcon(turn.sender))).size(12).flex_none().text_color(this.agentColor(t))
      : turn.interrupted || this.failed(turn) ? this.statusIcon(t, turn) : null;
    return h_flex().w_full().h(outlineHeight(this.prefs.textSize)).relative().px(ROW.PAD_X).gap(8).items_center().min_w(0)
      .when(sel, (el) => el.bg(t.selected))
      .when(!sel && !this.covered(), (el) => el.hover((s) => s.bg(t.hover)))
      .child(div().flex_none().w(r.numW).text_size(11.5).font_family(this.mono()).text_color(sel ? t.muted : t.dim).child(`#${turn.n}`))
      .when(!this.narrow(), (el) => el.child(div().flex_none().w(62).text_size(11.5).whitespace_nowrap().text_color(r.running ? t.working : t.dim).child(r.running ? "now" : fmtTime(turn.ts))))
      .when(Boolean(icon), (el) => el.child(icon))
      .child(h_flex().flex_1().min_w(0).text_size(turn.agent ? rt.small : rt.size).when(!turn.agent, (el) => el.font_medium())
        .child(this.hlLine(t, sel ? over(t.selected, t.background) : t.background, r.text || " ", turn.agent ? t.muted : t.foreground)))
      .when(pinned, (el) => el.child(h_flex().flex_none().gap(3).items_center().text_size(11.5).text_color(t.accent)
        .child(svg(ICON("pin")).size(11))
        .when(pinNo != null, (x) => x.child(String(pinNo)))));
  }

  // A collapsed row's reply start, drawn as Markdown at the reading size. Selectable like an
  // open reply: a drag selects, and only a click that does not move opens the turn (click).
  // Its tables may run wider than the reading line (tableBlock), each its own Markdown view.
  cmdBlock(md, id, extra = 0) {
    const sel = this.replySelectable();
    if (!(extra > 0)) return this.readBlock(div()).child(this.mdView(id, md, sel));
    const parts = splitTables(md);
    return this.readBlock(v_flex()).gap(this.paraGap()).children(parts.map((p, i) => p.table
      ? this.tableBlock(this.mdView(`${id}-t${i}`, p.text, sel), extra)
      : this.mdView(`${id}-p${i}`, p.text, sel)));
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

  // How long a call took (callTime). Not for a subagent started in the background: its call
  // ends when it is launched, so the time is the launch, not the work.
  callTook(name, c, a = null) {
    // A subagent settled by its notification: the time it took, from the notification.
    if (a && a.st !== "running" && Number.isFinite(a.ms)) return callTime(null, null, a.ms);
    if (toolKind(name) === "agent" && /^Async agent launched/.test(String(c?.out ?? ""))) return "";
    return callTime(c?.inTs, c?.outTs, c?.ms);
  }
  // A subagent call's state from the session file (its launch result and task notification),
  // or null for another call, or one whose launch result is not read.
  agentOf(si, id, name) { return id && toolKind(name) === "agent" ? this.sessions[si]?.agents?.get(id) ?? null : null; }
  // A subagent with no notification yet is working only in the newest session while its
  // terminal has not ended; otherwise it has no result on record.
  agentWorks(si, a) { return a?.st === "running" && si === this.sessions.length - 1 && !this.res?.ended; }
  // A subagent group's states: working, back, failed, and stopped (or no result on record).
  agentCounts(r) {
    const c = { working: 0, done: 0, failed: 0, stopped: 0, known: 0 };
    if (!r.step.agent) return c;
    (r.step.ids ?? []).forEach((id, i) => {
      const a = this.agentOf(r.si, id, r.step.calls[i]);
      if (!a) return;
      c.known++;
      if (this.agentWorks(r.si, a)) c.working++;
      else if (a.st === "completed") c.done++;
      else if (a.st === "failed") c.failed++;
      else c.stopped++;
    });
    return c;
  }
  // A subagent's mark: the spinner while it works, a check once back, a red cross when it
  // failed, a grey dash when stopped or with no result.
  agentMark(t, si, a) {
    if (this.agentWorks(si, a)) return this.liveIcon(this.liveState(t), 12);
    const failed = a.st === "failed";
    return svg(ICON(a.st === "completed" ? "check" : failed ? "circle-x" : "minus")).size(12).flex_none().when(failed, (e) => e.text_color(t.blocked));
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
    // A task notification's turn: its quiet line, and no bubble (noticeCut).
    if (noticeTurn(turn)) return this.rowFrame(t, sel, focusedPanel, true, [this.quietLine(t, turn), this.liveLine(t, turn), this.statsLine(t, [tokens, "no reply yet"].filter(Boolean).join(" · "))], ROW.PAD_T);
    return this.rowFrame(t, sel, focusedPanel, true, [
      ...(!r.split && turn.agent ? [this.senderLine(t, turn)] : []),
      this.youGroup(t, turn, key, sel, [this.bubble(t, turn, [this.promptBlock(bt, this.bubbleLook(t, turn.agent).under, turn, sh, false, key), ...(sh.pMore ? [this.moreLine(bt)] : [])], sh.bubbleW)]),
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
  // The selected running turn. Its message is drawn as an open turn's YOU part (workYou):
  // whole, as Markdown, every paragraph, with each quote in full behind its bar and an
  // agent's name inside its bubble. It used to be the closed row's lines, which ran the
  // paragraphs together and cut a long quote.
  workingItem(t, r) {
    const { turn, key } = r;
    const g = this.workingGeom(turn, r.shape);
    const notice = noticeTurn(turn);
    return this.rowFrame(t, true, this.h.is_focused(), true, [
      ...(notice ? [this.quietLine(t, turn)] : [this.partContent(t, this.workYou(r), false), this.youStrip(t, turn, key, true)]),
      this.liveLine(t, turn, true),
      div().h(g.note * NOTE_LINE).overflow_hidden().text_size(12).line_height(`${NOTE_LINE}px`).text_color(t.dim).child(g.noteText),
    ], r.split ? ROW.GAP : ROW.PAD_T);
  }
  // sh: the row's shape, whose prompt lines the card draws; without one, the prompt's first
  // lines as plain text.
  workingGeom(turn, sh = null) {
    const prompt = clipPrompt(turn.prompt, PROMPT_LINES, this.perLine(), PROMPT_CHARS).text;
    const tw = bubbleMax(this.width, this.prefs.textSize, this.chars()) - 2 * ROW.BUBBLE_PX;
    const lines = sh ? Math.max(1, sh.p) : Math.max(1, Math.min(6, this.wrapped(prompt, tw, this.charW(YOU_CHAR))));
    const promptH = lines * this.rt().line + (sh?.pMore ? ROW.MORE : 0);
    const st = this.status();
    const noteText = st === "blocked" ? `${this.agent().short} is waiting for you in the terminal.`
      : st === "working" ? `No final reply yet. It appears here when ${this.agent().short} finishes this turn.`
        : "This turn has no final reply yet. It may have been stopped.";
    const note = this.wrapped(noteText, this.inner(), 6.0);
    return { prompt, lines, promptH, note, noteText };
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
  // turn's fill when selected.
  resumeItem(t, r, size) {
    const sel = this.sel === r.key.slice("resume:".length);
    return v_flex().h(size).w_full().relative().justify_center().px(ROW.PAD_X)
      .when(sel, (el) => el.bg(t.selected))
      .child(h_flex().gap(6).items_center().text_size(12).text_color(t.accent).min_w(0)
        .child(svg(ICON("chevron-up")).size(12).flex_none())
        .child(div().min_w(0).truncate().child(`#${r.turn.n} starts above · show the prompt`)));
  }

  // One slice of an open turn: exactly its slot's height, 16 px in from each side like a
  // closed exchange. The first part has the 8 px top padding and the last the 10 px bottom
  // padding, with no seam between them.
  cardPart(t, r, size) {
    return v_flex().h(size).w_full().relative().overflow_hidden().px(ROW.PAD_X)
      .when(r.part === "top", (el) => el.pt(ROW.PAD_T))
      .when(r.part === "bottom", (el) => el.pb(ROW.PAD_B))
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
        const { style, theme: bt, under } = this.bubbleLook(t, turn.agent);
        const c = { text: y.text, more: y.more };
        // A prompt taller than YOU_MAX shows its first YOU_MAX px, cut, and Show all; the
        // bubble is one list item, so a press on it opens the rest (click, "you"). Nothing in
        // it scrolls. Opened, it is drawn at its own height (measured), with Show less.
        const clipped = !r.full && c.more > 0;
        const longLine = y.long && !clipped;
        const canLess = !longLine && r.less && this.youClip(turn).more > 0;
        // Markdown through TextView (quotes, code and link rules drawn the way the reply is),
        // or with a filter that matches the prompt, the matches marked and each quote run
        // behind the same bar. A pasted block: the quiet label, then its body in the mono
        // face, one block, the wrapper gone.
        const text = y.plain
          ? v_flex().gap(6).children(y.parts.map((p) => p.quote
            ? div().relative().pl(QUOTE_INSET).child(div().absolute().left(0).top(2).bottom(2).w(2).rounded(1).bg(turn.agent ? bt.dim : alpha(bt.foreground, 0.28)))
              .child(this.hlBlock(bt, under, p.draw, bt.muted, p.rows))
            : p.paste
              ? v_flex().min_w(0).child(div().text_size(12.5).text_color(bt.muted).child(pasteLabel(p.lines.length)))
                .child(div().min_w(0).font_family(mono).text_size(12.5).text_color(bt.muted).child(this.hlBlock(bt, under, p.draw, bt.muted, p.rows)))
              : this.hlBlock(bt, under, p.draw, bt.foreground, p.rows)).concat(y.cut
            ? [div().text_size(11.5).italic().text_color(bt.dim).child(`… ${y.cut.toLocaleString()} more characters not shown`)] : []))
          : this.mdView(tv(`th-you-${r.key}`), y.md, this.replySelectable());
        const cmd = commandParts(turn);
        const ac = style.outline ? this.agentColor(t) : bt.foreground;
        const box = y.capped ? div().h(YOU_MAX).overflow_hidden() : div();
        // The message in its bubble, on the right (an agent's outlined, on the left, under its
        // sender), as wide as its widest line.
        const agent = turn.agent;
        const inset = this.edgeInset(turn, style);
        const bubbleRow = h_flex().w_full().when(!agent, (el) => el.justify_end())
          .child(this.bubbleEdge(this.readFont(v_flex().flex_none().w(y.bw).px(ROW.BUBBLE_PX - inset).py(8 - inset).gap(4)).bg(style.fill), t, turn, style)
            .when(!agent, (el) => el.rounded_tl(14).rounded_tr(14).rounded_bl(14).rounded_br(4))
            .when(agent, (el) => el.rounded_tl(4).rounded_tr(14).rounded_bl(14).rounded_br(14))
            .when(agent, (el) => el.child(h_flex().gap(5).items_center().min_w(0).text_size(11.5)
              .child(svg(ICON(senderIcon(turn.sender))).size(11).flex_none().text_color(ac))
              .child(this.labelView(this.youParts(turn), ac, null))))
            .when(Boolean(cmd), (el) => el.child(h_flex().h(this.rt().line).child(this.chip(bt, under, middle(cmd.name, Math.floor((y.bw - 32) / ROW.CHIP_CHAR)), y.bw - 20, !cmd.args))))
            .when(Boolean(c.text), (el) => el.child(box.text_size(this.rt().size).line_height(`${this.rt().line}px`).text_color(bt.foreground).child(text)))
            .when(c.more > 0, (el) => el.child(h_flex().h(18).gap(4).items_center().text_size(12).text_color(bt.accent)
              .child(`Show all · ${plural(c.more, "more line")}`).child(svg(ICON("chevron-down")).size(12))))
            .when(longLine, (el) => el.child(h_flex().h(18).gap(4).items_center().text_size(12).text_color(bt.accent)
              .child(y.capped ? "Show all" : "Show less").child(svg(ICON(y.capped ? "chevron-down" : "chevron-up")).size(12))))
            .when(canLess, (el) => el.child(h_flex().h(18).gap(4).items_center().text_size(12).text_color(bt.accent)
              .child("Show less").child(svg(ICON("chevron-up")).size(12)))));
        if (!y.linkMd) return bubbleRow;
        // Under a coloured bubble, the links its rules made, as wide as the bubble and on its
        // side, in the theme's text and link colours (issue 116).
        return v_flex().w_full().child(bubbleRow)
          .child(h_flex().w_full().pt(YOU_LINK_GAP).when(!agent, (el) => el.justify_end())
            .child(div().flex_none().w(y.bw).px(ROW.BUBBLE_PX).text_size(12).line_height(`${YOU_LINK_LINE}px`)
              .child(this.mdView(tv(`th-ylk-${r.key}`), y.linkMd, false))));
      }
      case "ustrip": return this.reveal(t, div().id(`ush:${tkey}`).pt(ROW.GAP)).child(this.youStrip(t, turn, tkey, this.sel === tkey, "all"));
      case "rhead":
        // Under the message, before the reply: the line ("Worked for 2m 31s"), then what the
        // reply does not show, wrapping ("🔔 144 background updates · 🤖 shared with agent
        // message #4").
        return v_flex().pt(ROW.GAP)
          .child(this.workLine(t, turn, this.pinNumber(turn), this.lineIsOpen(tkey, false), this.lineIcon(t, r.key, tkey, probe)))
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
          .when(r.left > 0, (el) => el.child(div().h(LATEST_NOTE).flex().items_center().text_size(11.5).italic().text_color(t.dim).child(`… ${r.left.toLocaleString()} more characters not shown`)))
          .when(!r.whole, (el) => el.child(div().h(22).flex().items_center().text_size(12).text_color(t.accent).child("Show less")));
        // One block that gpui wraps at the card's width, 21 px a line, in a box that shows
        // whole lines up to LATEST_LINES (C5).
        const block = this.readBlock(div()).text_color(t.foreground).child(r.text);
        if (probe) return block;
        return v_flex().mt(6)
          .child(div().h(this.latestBox(r)).overflow_hidden().child(block))
          .when(this.latestCut(r), (el) => el.child(div().h(22).flex().items_center().text_size(12).text_color(t.accent).child("Show all")));
      }
      case "noreply":
        // A link: the list's own item click (click, "nr") goes to the answer, since a list
        // item can register no handler of its own.
        if ((turn.answeredIn || turn.answeredBy) && !probe) {
          return div().mt(6).text_size(12.5).text_color(t.accent).cursor_pointer().child(this.noReplyText(turn));
        }
        return div().mt(6).text_size(12.5).text_color(t.dim).child(this.noReplyText(turn));
      case "cmd":
        return this.cmdBlock(r.md, tv(`th-cmd-${r.key}`), this.tableExtra(r));
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
          .child(this.tableBlock(this.mdView(tv(`th-md-${r.key}`), r.md, this.replySelectable()), this.tableExtra(r)));
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
        // The editor is as tall as all its rows, inside a box that shows r.shown of them, so it
        // has nothing to scroll and the wheel moves the list. The clip ends at the last shown
        // row (the editor's text starts 6 px down), so no part of the next row shows under it.
        const st = this.code.get(`${tkey}:${r.i}`)?.st;
        return div().h(this.codeBoxH(r)).rounded_b(7).overflow_hidden().border_1().border_t(0).border_color(t.border).bg(t.background)
          .text_size(12).line_height(`${CODE_LINE}px`)
          .child(div().w_full().h(r.shown * CODE_LINE + 6).overflow_hidden()
            .child(div().w_full().flex_none().h(r.rows * CODE_LINE + 16)
              .child(st ? Editor.new(st).size_full().py(6) : this.plainCode(t, `th-code-${r.key}`, r.seg.text, mono))));
      }
      case "codeall": return this.showAllRow(t, r.all ? "Show less" : `Show all · ${plural(r.left, "more row")}`, r.all ? "chevron-up" : "chevron-down");
      case "mview": return this.showAllRow(t, "View diagram", "panel-right");
      case "fold":
        // Quiet: no border or fill, so it reads as the end of the reply, not a button to find.
        return v_flex().mt(8)
          .when(r.left > 0, (el) => el.child(div().h(18).text_size(11.5).line_height("18px").truncate().text_color(t.dim)
            .child(`${r.left.toLocaleString()} more characters are left out here. c copies the whole reply.`)))
          .child(h_flex().h(26).gap(5).items_center().text_size(12).text_color(t.dim)
            .child(svg(ICON("chevron-up")).size(12)).child("Collapse").child(div().text_size(11).font_family(mono).child("Esc")));
      case "imgs": return v_flex().pt(8).child(this.thumbStrip(t, turn, tkey));
      case "itext":
        // The agent's interim text, as Markdown at the reading size, between step groups.
        return this.readBlock(div().mt(6)).child(this.mdView(tv(`th-it-${r.key}`), r.md, this.replySelectable()));
      case "grp": {
        // A step group's line: the tool icon until its calls are read, then a check, or a red
        // mark and how many failed; the spinner while it runs (with what runs now, once read);
        // and a chevron.
        const open = r.open;
        const g = this.groupInfo(r);
        // Subagents: present tense and the spinner while any works, after the reply too, and
        // how many work and how many failed; a check once all are back.
        const ag = this.agentCounts(r);
        const going = r.now || ag.working > 0;
        const failed = Math.max(g.failed, ag.failed);
        const back = ag.known > 0 && ag.known === r.step.count && !ag.working && !ag.stopped;
        return h_flex().mt(STEP_GAP).h(GROUP_H).gap(6).items_center().min_w(0).max_w(this.prose()).text_size(12.5).text_color(going ? t.dim : t.muted)
          .child(going ? this.liveIcon(this.liveState(t), 12)
            : svg(ICON(failed ? "circle-x" : g.known || back ? "check" : r.step.agent ? "bot" : "wrench")).size(12).flex_none().text_color(failed ? t.blocked : t.dim))
          .child(div().flex_none().child(groupText(r.step.calls, r.step.count, going)))
          .when(ag.working > 0, (e) => e.child(div().flex_none().child(`· ${ag.working} working`)))
          .when(failed > 0, (e) => e.child(div().flex_none().text_color(t.blocked).child(`· ${failed} failed`)))
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
        const { c, a, time, pill, text, rows } = this.callShape(r);
        const open = this.callOpen.has(`${tkey}:${r.gi}:${r.ci}`);
        const icon = r.now && !a ? this.liveIcon(this.liveState(t), 12)
          : a ? this.agentMark(t, r.si, a)
            : svg(ICON(c?.err ? "circle-x" : KIND_ICON[toolKind(r.name)])).size(12).flex_none().when(Boolean(c?.err), (e) => e.text_color(t.blocked));
        // What it ran wraps (at most CALL_LINES lines, then an ellipsis); the icon, the model,
        // the time and the chevron stay level with its first line.
        const lead = r.one ? GROUP_H : CALL_H;
        const cell = (el) => div().flex_none().h(lead).flex().items_center().child(el);
        const extra = (rows - 1) * CALL_LINE;
        return h_flex().when(r.one, (e) => e.mt(STEP_GAP).h(GROUP_H + extra)).when(!r.one, (e) => e.h(CALL_H + extra).pl(18))
          .gap(6).items_start().min_w(0).max_w(this.prose()).text_size(12).text_color(t.dim)
          .child(cell(icon))
          .child(div().flex_1().min_w(0).pt((lead - CALL_LINE) / 2).line_height(`${CALL_LINE}px`).font_family(mono).text_color(c?.input != null ? t.muted : t.dim).child(text))
          .when(Boolean(pill), (e) => e.child(cell(div().h(16).px(5).rounded(4).bg(alpha(t.foreground, 0.08)).text_size(10.5).line_height("16px").child(pill))))
          .when(Boolean(time), (e) => e.child(cell(div().text_size(11).child(time))))
          .when(Boolean(r.id), (e) => e.child(cell(svg(ICON(open ? "chevron-down" : "chevron-right")).size(12))));
      }
      case "cout": {
        // A call's output (level 3): mono lines, not wrapped, in a box OUT.SHOW lines tall that
        // scrolls down and sideways inside, holding up to OUT.MAX lines. JSON, a diff or a read
        // file with a known extension is shown in a read-only editor that colours it
        // (outLang); the editor is made between frames, so the first frame shows plain lines.
        const lines = r.box.lines;
        const note = r.going ? "Running…" : r.st === "wait" ? "Reading…" : r.st === "err" ? "Could not read this call" : r.st === "none" ? "Not in the transcript" : "No output";
        // The lines wrap, at their full height inside a box r.shown rows tall, so nothing in it
        // scrolls and the wheel moves the list.
        const ed = probe ? null : this.outEditorFor(r);
        const inner = !lines.length ? div().h(OUT.LINE).line_height(`${OUT.LINE}px`).text_color(t.dim).child(note)
          : ed ? Editor.new(ed).size_full()
            : v_flex().w_full()
              .children(lines.map((l) => div().w_full().min_h(OUT.LINE).line_height(`${OUT.LINE}px`).font_family(mono).text_color(t.muted).child(this.short(l) || " ")));
        return v_flex().pl(18).pt(2).pb(2).min_w(0).max_w(this.prose())
          .child(v_flex().px(10).py(OUT.PAD).rounded(6).border_1().border_color(t.border).bg(t.background).min_w(0).overflow_hidden().text_size(11.5)
            .child(div().w_full().min_w(0).h(Math.max(1, r.shown) * OUT.LINE).overflow_hidden()
              .child(div().w_full().flex_none().h(Math.max(1, r.rows) * OUT.LINE).child(inner))));
      }
      case "oall": return div().pl(18).child(this.showAllRow(t, r.view ? `Open all ${r.total.toLocaleString()} lines in a viewer` : r.all ? "Show less" : `Show all · ${plural(r.left, "more row")}`,
        r.view ? "panel-right" : r.all ? "chevron-up" : "chevron-down"));
      case "wspin":
        return h_flex().mt(STEP_GAP).h(GROUP_H).gap(6).items_center().text_size(12.5).text_color(t.working)
          .child(this.liveIcon(this.liveState(t), 12)).child("Working…");
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
    if (this.canReadHighlight()) return this.narrow() ? `${this.quoteKey} quotes the highlight · s returns` : `Select text, then ${this.quoteKey} quotes it · s or Esc returns`;
    return this.narrow() ? `⌘C, then ${this.quoteKey} quotes it · s returns` : `Select text, ⌘C, then ${this.quoteKey} quotes it · s or Esc returns`;
  }
  // Whether Select view's editor tells its highlight (EditorState.selected_range, Herdr 0.1.16):
  // before that a mod could not read it, and ⌘C put it on the clipboard for q.
  canReadHighlight() { return typeof this.selEditor?.st?.selected_range === "function"; }
  // The text highlighted in Select view's editor: "" when nothing is, null when the editor
  // cannot say. Its offsets are UTF-16, as slice() takes them, into the text it was given.
  highlight() {
    if (!this.canReadHighlight()) return null;
    try {
      const r = this.selEditor.st.selected_range();
      const text = this.selEditor.text.slice(0, SELECT_CHARS);
      const a = Math.max(0, Math.min(r?.start ?? 0, r?.end ?? 0));
      const b = Math.min(text.length, Math.max(r?.start ?? 0, r?.end ?? 0));
      return b > a ? text.slice(a, b) : "";
    } catch {
      return null;
    }
  }

  // The settings panel's line on the keys the file sets by hand.
  settingsLine() {
    const bad = (this.linkCount ?? 0) - this.links.length;
    const sn = this.senderCount ?? 0;
    const sbad = (this.senderList ?? []).filter((r) => r.why).length;
    return `Link rules · ${this.linkCount ?? 0}${bad > 0 ? ` (${bad} not working)` : ""}${sn ? ` · Sender rules · ${sn}${sbad > 0 ? ` (${sbad} not working)` : ""}` : ""} · Quote key · ${this.quoteKey}`;
  }

  // Which sender rule made a typed prompt an agent message, for the tooltip on its sender:
  // "Typed into the terminal. Sender rule 2 · Hourly report named its sender.", or null for
  // every other turn. Both the number and the name, since the number changes when rules move.
  ruleTip(turn) {
    const r = turn?.sender?.rule;
    if (r == null) return null;
    const name = turn.sender.ruleLabel ? ` · ${turn.sender.ruleLabel}` : "";
    return `Typed into the terminal. Sender rule ${r}${name} named its sender.`;
  }

  // Key hints that apply now, on one row: [key, label]. The most-used keys (move, open,
  // copy, quote, filter, pin) and "? keys", which opens the sheet with every key; what does
  // not fit the pane's width gives way from the right, "? keys" last (ui.js fitHints). In
  // Select view: how to select, copy, quote and go back.
  footerHints() {
    if (this.traj) {
      const detail = this.trajShape(false).side !== "none" ? [["↵", "detail"]] : [];
      return fitHints([["↑↓", "move"], ...detail, ["f", "next failure"], ["m", "user message"], ["y", "chat"], ["?", "keys"]], this.pw());
    }
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

  // The room the key hints and the status line take at the pane's foot: none for either while
  // it is off (settings keyHints and statusLine).
  footSpace() { return (this.prefs.keyHints ? (this.footerH ?? 38) : 0) + (this.statusShown() ? STATUS_H : 0); }

  // The status line: the chat's stats for the session the pane reads, once it is read (the
  // owner, 2026-11-19: a slim line at the very bottom). Only what the transcript records:
  // turns, hidden turns and tool calls for every agent; tokens, cache hit and context for
  // the agents that record usage (sessionStats). It takes no click and shows no tooltip.
  statusShown() { return this.prefs.statusLine !== false && Boolean(this.current()?.loaded); }
  // Summed again only when the session changes, and then only from the newest done turn on,
  // as bindingTip's totals are: a sum over every turn on every draw is too slow in a long
  // session (Herdr stops a draw past about 50 ms).
  statusStats() {
    const c = this.counts();
    const s = this.current();
    if (!s) return { turns: c.shownCur, hidden: c.hiddenCur, ...sumsStats(turnSums([])) };
    // The session's own objects are part of the key: a session read again from the start gets
    // a new turns list, so the same id and counts can never bring back the old line.
    const v = `${s.id}|${s.version}|${s.turns.length}`;
    const u = this.statusMemo;
    if (u?.v !== v || u.s !== s || u.list !== s.turns) {
      const keep = u && u.s === s && u.list === s.turns && u.stable <= s.turns.length && (u.stable === 0 || s.turns[u.stable - 1] === u.mark);
      let k = keep ? u.stable : 0;
      const from = k;
      while (k < s.turns.length - 1 && s.turns[k].done) k++;
      const base = turnSums(s.turns, from, k, keep ? u.base : null);
      this.statusMemo = { v, s, list: s.turns, stable: k, mark: s.turns[k - 1] ?? null, base, stats: sumsStats(turnSums(s.turns, k, s.turns.length, base)) };
    }
    return { turns: c.shownCur, hidden: c.hiddenCur, ...this.statusMemo.stats };
  }
  statusGroupsShown() { return statusGroups(this.statusStats(), this.pw()); }
  statusRow(t) {
    const groups = this.statusGroupsShown();
    return h_flex().id("th-status").flex_none().h(STATUS_H).px(12).gap(18).items_center().justify_center().overflow_hidden()
      .children(groups.map((g) => h_flex().id(`th-status-${g.key}`).gap(5).items_center().min_w(0).when(groups.length > 1, (el) => el.flex_none())
        // The ring takes the text's colour: in dim its arc barely parts from its faint track on a
        // dark theme (rig stills).
        .child(svg(ICON(g.icon)).flex_none().size(12).text_color(g.icon.startsWith("ring-") ? t.muted : t.dim))
        .child(div().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(g.text))));
  }

  // ---- the Trajectory (ledger.js) ----
  // The debug report's part for the Trajectory: where it shows, the rows listed, the selected
  // row and what the heading, the status line and the detail say.
  trajReport() {
    if (!this.traj) return { pane: false, inPane: false, open: Boolean(this.trajOpen) };
    const L = this.ledger();
    const shown = this.ledgerRows();
    const i = this.ledgerSel(shown);
    const w = this.pw();
    const shape = this.trajShape();
    return {
      pane: this.trajPane, inPane: !this.trajPane, dock: this.trajPane ? this.trajDock : null, width: Math.round(w), cols: shape.cols, going: L.going,
      layout: { side: shape.side, detailW: shape.detailW, listW: shape.listW },
      listH: this.tlistH != null ? Math.round(this.tlistH) : null, rowsLeft: rowsLeft(this.tlistH),
      rows: shown.length, sel: shown[i]?.key ?? null, fails: this.failCount(L, shown, i), filter: this.tfilter,
      detail: this.detailOpen() && shown[i] ? detailOf(shown[i]) : null,
      heads: L.totals.heads.slice(-5).map((h) => ({ n: h.n, total: headParts(h, w).total, stale: h.stale, lastAt: h.lastAt })),
      status: ledgerStatus(L.totals, w, L.going).map((g) => g.text),
    };
  }
  // y or the Trajectory button in the Chat: the Trajectory pane beside it, split off to the
  // right from TRAJ_SPLIT_MIN px wide, or focused when it is open already. Narrower, the
  // Trajectory shows in this pane with no notice, and y, Esc or its Chat
  // button goes back. In the Trajectory pane, y goes to the Chat. The bottom dock is TRD-24.
  openTraj() {
    if (this.trajPane) {
      const main = this.mainPane();
      if (main) run("pane.focus", { pane: main.pane });
      return true;
    }
    if (this.traj) { this.leaveTraj(); return true; }
    // TRD-24 PR 3: y does nothing while a dock move for this terminal is under way.
    const open = this.trajPaneOpen();
    if (open) { run("pane.focus", { pane: open.pane }); return true; }
    const me = this.me();
    if (!me || this.pw() < TRAJ_SPLIT_MIN) { this.enterTraj(); return true; }
    if (this.splitAsk) return true;
    // The kept width, or TRAJ_COL, held to what the Chat can give (its 240 px floor). The
    // Chat at that px first, and both stay at px while the Trajectory is open (pinPx). An open
    // Pinned column goes back to px too: the Trajectory's room probe needs both at px.
    // A close's weights under way: the panes it left to px at their targets first, the Chat
    // at its own.
    const back = this.rowCancelClose(null);
    this.pairPx(5000);
    const chat = this.pinPx(me, back);
    const px = trajColumn(chat, this.keptTrajWidth() ?? TRAJ_COL);
    this.splitAsk = { before: panes().map((p) => p.pane), px, chat, back: null, map: TRAJ_MAP_KEY, until: Date.now() + 4000 };
    // The widths the new pane passes through on its way (settleTraj) are not the owner's.
    this.holdTrajWidth(5000);
    this.trajOpen = true;
    // The selected turn goes with it (syncSel), so the new pane opens on it.
    this.selSent = null;
    run("pane.split", { pane: me.pane, direction: "right", mod: MOD, props: { ...(props() ?? {}), view: "trajectory" } });
    return true;
  }
  // The Trajectory in the Chat's own pane, on the Chat's selected turn; and back, on the
  // turn the Trajectory had selected.
  enterTraj() {
    this.traj = true;
    this.keysOpen = false;
    // The search closes, as Esc closes it: its field is not drawn in the Trajectory, and the
    // keys go to the pane.
    if (this.filtering || this.query) {
      this.input?.set_value("");
      this.query = "";
      this.filtering = false;
      this.h?.focus();
    }
    this.tsel = this.sel && this.findTurn(this.sel) ? this.sel : null;
    this.tscrolled = false;
    this.tscrollTo = this.tsel;
  }
  leaveTraj() {
    this.traj = false;
    this.keysOpen = false;
    const k = this.turnOfRow(this.tsel);
    if (k && this.findTurn(k)) { this.sel = k; this.follow = false; this.scrollTo = { key: k, how: "center" }; }
  }
  // The turn a ledger row belongs to: a heading's key is its turn's, a step's starts with it.
  turnOfRow(key) {
    if (!key) return null;
    if (key.startsWith("tr:")) { const p = key.split(":"); return `${p[1]}:${p[2]}`; }
    return /^\d+:\d+$/.test(key) ? key : null;
  }

  // The Chat and its Trajectory pane select the same turn: each writes the turn it selected
  // to shared("threads.turnSel") under the terminal, and takes the other's. Runs from poll(),
  // so on every draw and once a second. Returns true when this pane took a new turn.
  // Not in the Pinned column: its selection is a pin, and written there it pulled the Chat
  // back to that pin about a second after End, Home or a rail tick moved it (the owner, with
  // the column and the Trajectory open). Each pane takes only the other's turn.
  syncSel() {
    if (!this.terminal || this.launcher || this.pinnedPane) return false;
    if (!this.trajPane) this.trajOpen = Boolean(this.trajPaneOpen());
    if (!this.trajPane && !this.trajOpen) return false;
    const map = shared(SEL_KEY) ?? {};
    const e = map[this.terminal];
    const from = this.trajPane ? "chat" : "trajectory";
    // Another pane's turn (an older copy's, or one no pane should write): seen, and left.
    if (e && e.by !== this.selId && e.at > (this.selSeenAt ?? 0) && e.pane !== from) this.selSeenAt = e.at;
    else if (e && e.by !== this.selId && e.at > (this.selSeenAt ?? 0)) {
      const have = Boolean(this.findTurn(e.key));
      // A turn this pane has not read yet: wait for it a little, then let it go.
      if (have || Date.now() - e.at > SEL_WAIT) this.selSeenAt = e.at;
      if (have) {
        this.selSent = e.key;
        if (this.trajPane) {
          if (this.turnOfRow(this.tsel) !== e.key) { this.tsel = e.key; this.tscrollTo = e.key; return true; }
        } else if (this.sel !== e.key && this.chatShows(e.key)) { this.readerMoved(); this.sel = e.key; this.follow = false; this.scrollTo = { key: e.key, how: "center" }; return true; }
        return false;
      }
    }
    const mine = this.trajPane ? this.turnOfRow(this.tsel) : this.sel;
    if (!mine || mine === this.selSent) return false;
    this.selSent = mine;
    const keep = Object.fromEntries(Object.entries(map).filter(([k, v]) => k !== this.terminal && Date.now() - (v?.at ?? 0) < DAY_MS));
    setShared(SEL_KEY, { ...keep, [this.terminal]: { key: mine, by: this.selId, at: Date.now(), pane: this.trajPane ? "trajectory" : "chat" } });
    return false;
  }

  // Whether the Chat's list shows a turn: one it hides (an agent turn while those are hidden,
  // one outside a search) is never selected from the Trajectory, which would leave the Chat
  // a selection it does not draw.
  chatShows(key) {
    return Boolean(this.baseRows) && this.turnKeys(this.baseRows).includes(key);
  }

  // The ledger's rows for every session (ledger.js ledgerTurn), with a divider between
  // sessions, and its totals. Built again only when a session changes or the running rule
  // turns; a done turn's rows are kept with the turn.
  ledger() {
    const status = this.status();
    const s = this.current();
    const newest = s?.turns[s.turns.length - 1] ?? null;
    const going = turnRunning({
      // A session guessed from the folder may be another one there: not followed.
      followed: this.res.kind === "found" && !this.res.guess, alive: this.res.ended == null, open: Boolean(newest && !newest.done),
      reports: this.agent().key === "claude", status,
    });
    const key = `${this.sessions.map((x) => `${x.version}.${x.turns.length}.${x.agentVer ?? 0}.${x.loaded ? 1 : 0}`).join(",")}|${going ? 1 : 0}`;
    const m = this.ledgerMemo;
    if (m?.key === key && m.sessions === this.sessions && !m.partial) return m;
    this.turnLedger ??= new WeakMap();
    // The rows are built newest turn first, one slice a draw (buildMax, as the Chat's rows):
    // every turn of a 2,000-turn session in one draw took longer than Herdr gives a draw. Until
    // the build is done, the rows shown before stay; with none, the newest turns built so far.
    let job = this.ledgerJob;
    if (!job || job.key !== key || job.sessions !== this.sessions) {
      // Whether the agent writes result times (ledger.js sessionHasEnds): Claude Code always
      // does; another agent shows it by a result time anywhere in the session.
      const claude = this.agent().key === "claude";
      const all = [];
      this.sessions.forEach((x, si) => x.turns.forEach((turn) => all.push({ x, si, turn })));
      job = this.ledgerJob = {
        key, going, sessions: this.sessions, all, outs: new Array(all.length), next: all.length - 1, frame: null,
        endsOf: this.sessions.map((x) => claude || this.sessionEnds(x)),
      };
    }
    // One slice a draw: ledger() is asked for more than once in a draw.
    if (this.renderOpen && job.frame === this.renders) return m ?? this.ledgerPart(job);
    job.frame = this.renders;
    const b0 = now();
    const until = b0 + this.buildMax();
    const last = job.all.length - 1;
    while (job.next >= 0) {
      const { x, si, turn } = job.all[job.next];
      const ends = job.endsOf[si];
      // A done turn's rows are kept until the turn changes (turn.v), or, for a turn with a
      // subagent, until a launch or notice comes (s.agentVer): a background subagent often
      // finishes after its turn did.
      // The last turn read so far of a session still being read, with no end read yet
      // (ledgerTurn's reading): its rows claim nothing. Only done turns are kept.
      const reading = !x.loaded && !turn.done && turn === x.turns[x.turns.length - 1];
      const kept = turn.done ? this.turnLedger.get(turn) : null;
      const fresh = kept?.si === si && kept.v === turn.v && kept.ends === ends && (!kept.sub || kept.agentVer === x.agentVer);
      let out = fresh ? kept.out : null;
      if (!out) {
        out = ledgerTurn(x, turn, si, going && job.next === last, { ends, reading });
        if (turn.done) this.turnLedger.set(turn, { si, out, v: turn.v, ends, sub: out.rows.some((r) => r.sub), agentVer: x.agentVer });
      }
      job.outs[job.next--] = out;
      if (job.next >= 0 && now() > until) break;
    }
    this.buildSpent = (this.buildSpent ?? 0) + (now() - b0);
    if (job.next >= 0) return m ?? this.ledgerPart(job);
    this.ledgerJob = null;
    this.ledgerMemo = { key, sessions: this.sessions, rows: this.ledgerJoin(job, 0), going, partial: false };
    this.ledgerMemo.totals = ledgerTotals(this.ledgerMemo.rows);
    this.ledgerShown = null;
    return this.ledgerMemo;
  }
  // The rows of a build's turns from the i-th on, with a divider before each session after
  // the first.
  ledgerJoin(job, from) {
    const rows = [];
    for (let i = from; i < job.all.length; i++) {
      const { x, si, turn } = job.all[i];
      if (si > 0 && turn === x.turns[0]) rows.push({ kind: "sess", key: `sess:${si}`, si, ts: turn.ts ?? null });
      for (const r of job.outs[i].rows) rows.push(r);
    }
    return rows;
  }
  // Before the first build is done: the newest turns its first slice built, kept until it is.
  ledgerPart(job) {
    if (job.part) return job.part;
    const rows = this.ledgerJoin(job, job.next + 1);
    job.part = { key: null, sessions: job.sessions, rows, totals: ledgerTotals(rows), going: job.going, partial: true };
    this.ledgerShown = null;
    return job.part;
  }
  // A session once seen with a result time keeps it; until then it is looked for again.
  sessionEnds(x) {
    this.endsSeen ??= new WeakSet();
    if (this.endsSeen.has(x)) return true;
    if (!sessionHasEnds(x)) return false;
    this.endsSeen.add(x);
    return true;
  }
  // Whether the counts and the keys that go by them (f, m, Home, End) wait: while the session
  // is still being found or read, or the first build is not done. A split opened while its
  // session is read builds over the turns read so far, and that build is whole, but its
  // counts are of part of the session. Only the current session is read (read()): an earlier
  // one left mid-read by a clear, a restart or a resume is never read further, so it does not
  // hold them (statusShown looks at the current one too).
  ledgerHeld(L) { return L.partial === true || this.unread(); }
  unread() {
    const s = this.current();
    return this.res.kind === "resolving" || (s != null && !s.loaded);
  }
  // The rows the filter buttons leave, kept until the rows or the filter change.
  ledgerRows() {
    const L = this.ledger();
    const f = this.tfilter;
    const k = this.ledgerShown;
    if (k?.rows === L.rows && k.f === f) return k.shown;
    const shown = filterRows(L.rows, f).rows;
    this.ledgerShown = { rows: L.rows, f, shown, partial: L.partial };
    return shown;
  }
  // The selected row, as shown: the one selected, or its turn's heading when the filter hides
  // it, or else the newest heading.
  ledgerSel(shown) {
    const at = (k) => (k ? shown.findIndex((r) => r.key === k) : -1);
    let i = at(this.tsel);
    if (i < 0) i = at(this.turnOfRow(this.tsel));
    if (i < 0) for (let j = shown.length - 1; j >= 0 && i < 0; j--) if (shown[j].kind === "trh") i = j;
    return i;
  }
  // The pane's layout for its dock and width (ledger.js trajLayout), the list as wide as the
  // detail leaves it when open. The Trajectory in the Chat's own pane lays out as on the right.
  trajShape(open = this.detailOpen()) { return trajLayout(this.pw(), this.trajPane ? this.trajDock : "right", open); }
  // The width the list's rows size their figures by (headParts, compactRow): along the bottom
  // the list's, so a 340 px list beside the detail shows what a 340 px right pane shows; on the
  // right, and in the Chat's own pane, the pane's, as before.
  rowW() { return this.trajPane && this.trajDock === "bottom" ? this.trajShape().listW : this.pw(); }
  // What a width gives the pane's layout (trajLayout: the detail's side, the list's columns;
  // along the bottom also headParts: a heading's figures by the list's width), so the size
  // callback counts a 1 px change across any of them. "" in the Chat's own pane.
  dockForm(x) {
    if (!this.trajPane) return "";
    if (this.trajDock !== "bottom") {
      const R = trajLayout(x, "right");
      return `|${R.side}${R.cols.start ? "s" : ""}${R.cols.bar ? "b" : ""}${R.cols.filters ? "f" : ""}`;
    }
    const L = trajLayout(x, "bottom", this.tdetail ?? true);
    const h = headParts({ calls: 1, tokens: 1 }, L.listW);
    // The filter bar spans the pane, and from WIDE_MIN its Failed and User buttons say more.
    return `|${L.side}${L.cols.start ? "s" : ""}${L.cols.bar ? "b" : ""}${L.cols.filters ? "f" : ""}${x >= WIDE_MIN ? "w" : ""}${h.calls ? "c" : ""}${h.tokens ? "t" : ""}`;
  }
  // Whether the detail shows: as the person last left it, or by the layout until then (open at
  // its right, closed under the ledger). Along the bottom under 700 px there is none.
  detailOpen() {
    const side = this.trajShape(false).side;
    return side !== "none" && (this.tdetail ?? side === "right");
  }

  // A Trajectory key (ui.js ledgerKey). Returns false when it did nothing, so Esc reaches Herdr.
  ledgerAction(name, cx) {
    const shown = this.ledgerRows();
    const i = this.ledgerSel(shown);
    // Until the session is read and the first build is done (ledgerHeld), the rows are part
    // of it only: the first and last rows, the failed calls and the user's messages are not
    // known yet.
    const held = this.ledgerShown?.partial === true || this.unread();
    const pick = (j) => {
      const r = shown[j];
      if (!r || r.kind === "sess") return;
      this.tsel = r.key;
      this.tscrollTo = r.key;
    };
    const step = (from, d) => {
      let j = from + d;
      while (shown[j]?.kind === "sess") j += d;
      return j < 0 || j >= shown.length ? from : j;
    };
    // The next or previous row that matches, from the selected one; at either end nothing moves.
    const seek = (ok, d) => {
      for (let j = i + d; j >= 0 && j < shown.length; j += d) if (ok(shown[j])) { pick(j); return; }
    };
    switch (name) {
      case "lprev": pick(i < 0 ? shown.length - 1 : step(i, -1)); return true;
      case "lnext": pick(i < 0 ? shown.length - 1 : step(i, 1)); return true;
      case "lfirst": if (held) return false; pick(step(-1, 1)); return true;
      case "llast": if (held) return false; pick(step(shown.length, -1)); return true;
      case "lfail": if (held) return false; seek((r) => r.failed === true, 1); return true;
      case "lfailBack": if (held) return false; seek((r) => r.failed === true, -1); return true;
      case "luser": if (held) return false; seek((r) => r.lk === "you", 1); return true;
      case "luserBack": if (held) return false; seek((r) => r.lk === "you", -1); return true;
      case "ldetail": return this.toggleDetail(shown[i]?.key ?? null);
      case "trajectory": return this.openTraj();
      case "escape":
        if (this.keysOpen || this.settingsOpen) return this.action("escape", cx);
        if (this.detailOpen()) { this.tdetail = false; return true; }
        if (this.traj && !this.trajPane) { this.leaveTraj(); return true; }
        return false;
      // The few of the Chat's actions the Trajectory means. Any other (a bound pin, copy, the
      // outline) would act on the Chat's selection, which the Trajectory does not show.
      case "focus": case "settings": case "keys": return this.action(name, cx);
      // - and = step the Trajectory pane on the right; shown in the Chat's own pane there is
      // none to step, and a bottom pane's width is the row's.
      case "narrower": case "wider": return this.trajPane && this.trajDock !== "bottom" ? this.action(name, cx) : false;
      default: return false;
    }
  }
  // The detail shown or hidden. Opening it under the list (narrower than 900 px) leaves the
  // list shorter: the selected row (key) is scrolled back into view. Where the layout has no
  // detail (the bottom dock under 700 px) nothing changes: false, so the key passes on.
  toggleDetail(key) {
    const side = this.trajShape(false).side;
    if (side === "none") return false;
    this.tdetail = !this.detailOpen();
    if (this.tdetail && key && side === "under") this.tscrollTo = key;
    return true;
  }
  // A click on a row selects it; on the selected row it shows or hides the detail.
  ledgerClick(key) {
    if (key.startsWith("sess:") || key.startsWith("gone:")) return false;
    const shown = this.ledgerRows();
    if (key === shown[this.ledgerSel(shown)]?.key) this.toggleDetail(key);
    this.tsel = key;
    return true;
  }
  ledgerFilter(key) {
    this.tfilter = toggleFilter(this.tfilter, key);
  }
  // The failures counter in the heading: "1 of 2" on a failed call, else "2 failed" ("2+" when
  // some calls' results were not kept).
  failCount(L, shown, i) {
    const n = L.totals.failed;
    // Until the session is read and built, the count would be of part of it.
    if (!n || this.ledgerHeld(L)) return null;
    const fails = L.totals.fails;
    const at = shown[i]?.failed ? fails.indexOf(shown[i].key) : -1;
    const more = L.totals.partial.length ? "+" : "";
    return at >= 0 ? `${at + 1} of ${n}${more}` : `${n}${more} failed`;
  }

  // The Trajectory: its 40 px named heading, the filter buttons from 540 px, the ledger, the
  // detail (under the ledger, or at its right from 900 px), the key hints and the status line.
  trajFrame(cx) {
    const t = theme();
    // The column beside the Trajectory's pane, kept for its close (shareWidth).
    if (this.trajPane) { const col = this.pinnedPaneOpen(); if (col) this.colId = col.pane; }
    const w = this.pw();
    // The detail's side and width, and the list's columns by its width (ledger.js trajLayout).
    const shape = this.trajShape();
    const cols = shape.cols;
    const L = this.ledger();
    // A rows build left for later slices (ledger): the next frame goes on with it.
    if (this.ledgerJob && !this.buildNext) {
      this.buildNext = true;
      cx.timer.after(0, (cx) => { this.buildNext = false; cx.notify(); });
    }
    const shown = this.ledgerRows();
    const i = this.ledgerSel(shown);
    const selRow = shown[i] ?? null;
    this.liveShown = L.going;
    const dark = (contrast(t.background, "#000000") ?? 1) < (contrast(t.foreground, "#000000") ?? 21);
    const inks = trajInks(t, dark);
    const detail = this.detailOpen() && selRow ? detailOf(selRow) : null;
    const right = shape.side === "right";
    const list = this.ledgerList(t, shown, i, cols, inks, cx, right);
    const panel = detail ? this.ledgerDetail(t, detail, inks, right, shape.detailW) : null;
    // TRD-23's timeline goes here, across the whole pane above the list and the detail, shown
    // only where it leaves enough rows (rowsLeft with the list box's measured height, tlistH).
    const timeline = null;
    return v_flex()
      .id("threads-root")
      .track_focus(this.h)
      .on_key_down((e, cx) => this.key(e, cx))
      // Its settings card takes Tab and Shift-Tab as the Chat's does (cardKeyContext).
      .when(this.settingsOpen, (el) => this.cardKeyContext(el))
      .on_size_change((size, cx) => {
        const h = size.height / this.zoom();
        if (Math.abs(h - this.rootH) > 1) { this.rootH = h; cx.notify(); }
        const pw = size.width / this.zoom();
        this.measuredWidth = size.width;
        // A change of 1 px counts when it takes the pane across 200 or 64 px (ledger.js trajCompact), or
        // across HEAD_ICON_MIN inside the frame, where the compact heading's list icon gives way;
        // in a Trajectory pane, also across any of its layout's thresholds (dockForm).
        const form = (x) => `${trajCompact(Math.round(x) + PANE_FRAME)}${x >= HEAD_ICON_MIN ? "+" : ""}${this.dockForm(x)}`;
        const cross = this.paneW != null && form(pw) !== form(this.paneW);
        if (!this.forcedWidth && (cross || Math.abs(pw - (this.paneW ?? -9)) > 1)) { this.paneW = pw; this.shareWidth(); cx.notify(); }
      })
      .size_full().min_h(0).relative()
      .bg(t.background).text_color(t.foreground).text_size(13)
      .child(this.trajHeading(t, L, shown, i))
      .when(cols.filters, (el) => el.child(this.filterBar(t, L.totals, w, inks, this.ledgerHeld(L))))
      .when(Boolean(timeline), (el) => el.child(timeline))
      .child(right
        ? h_flex().id("th-traj-body").flex_1().min_h(0).w_full().items_start().child(list).when(Boolean(panel), (el) => el.child(panel))
        : v_flex().id("th-traj-body").flex_1().min_h(0).w_full().child(list).when(Boolean(panel), (el) => el.child(panel)))
      .when(Boolean(this.prefs.keyHints), (el) => el.child(this.footer(t)))
      .when(this.statusShown(), (el) => el.child(this.ledgerFoot(t, L, w)))
      .when(this.keysOpen, (el) => el.child(this.keySheetView(t)))
      .when(this.settingsOpen, (el) => el.child(this.settingsCard(t)))
      .when(Boolean(this.toast), (el) => el.child(this.toastView(t)));
  }

  // The heading, 40 px: the list icon and "Trajectory", the failures with the
  // previous and next arrows, then the settings button, and the Chat button when the
  // Trajectory shows in the Chat's own pane.
  trajHeading(t, L, shown, i) {
    const fails = this.failCount(L, shown, i);
    const arrow = (id, icon, tip, name) => this.iconButton(t, id, icon, tip, (_e, cx) => { this.ledgerAction(name, cx); cx.notify(); });
    // Below 200 px, the icon alone (ledger.js trajCompact), with a red dot at its corner when
    // calls failed, and the count in its tooltip; f and Shift f still go through them.
    // In the Chat's own pane (y in a Chat under 480 px) its way back stays: the settings and the
    // Chat buttons as icons after it, the list icon given up for them when the three do not fit
    // (HEAD_ICON_MIN inside the frame).
    const form = trajCompact(this.trajPx());
    if (form) {
      const inChat = this.traj && !this.trajPane;
      const icon = () => div().id("th-traj-icon").flex_none().relative().tooltip(fails ? `Trajectory · ${fails}` : "Trajectory")
        .child(svg(ICON("list")).size(14).text_color(t.muted))
        .when(Boolean(fails), (el) => el.child(div().id("th-traj-icon-fails").absolute().top(-2).right(-3).size(6).rounded(3).bg(t.blocked)));
      const head = h_flex().id("th-traj-heading").flex_none().h(LEDGER_HEAD).px(COMPACT_PAD).gap(2).items_center().border_b(1).border_color(t.border);
      if (!inChat) return head.justify_center().child(icon());
      return head
        .when(form === "line" && this.pw() >= HEAD_ICON_MIN, (el) => el.child(icon()).child(div().flex_1()))
        .when(form !== "line" || this.pw() < HEAD_ICON_MIN, (el) => el.justify_center())
        .child(this.iconButton(t, "th-settings", "sliders-horizontal", "Settings (,)", this.headerClick("settings"), this.settingsOpen))
        .child(this.iconButton(t, "th-traj-chat", "messages", "Back to the Chat (y)", (_e, cx) => { this.readerMoved(); this.leaveTraj(); cx.notify(); }));
    }
    return h_flex().id("th-traj-heading").flex_none().h(LEDGER_HEAD).px(10).gap(8).items_center().border_b(1).border_color(t.border)
      .child(svg(ICON("list")).size(14).flex_none().text_color(t.muted))
      .child(div().flex_none().text_size(13.5).font_semibold().text_color(t.foreground).child("Trajectory"))
      .when(Boolean(fails), (el) => el.child(h_flex().id("th-traj-fails").flex_none().gap(4).items_center().ml(4)
        .child(div().flex_none().size(6).rounded(3).bg(t.blocked))
        .child(div().flex_none().text_size(12).text_color(t.muted).child(fails))
        .child(arrow("th-traj-fail-prev", "chevron-up", "Previous failed call (Shift f)", "lfailBack"))
        .child(arrow("th-traj-fail-next", "chevron-down", "Next failed call (f)", "lfail"))))
      .child(div().flex_1())
      .child(this.iconButton(t, "th-settings", "sliders-horizontal", "Settings (,)", this.headerClick("settings"), this.settingsOpen))
      .when(this.traj && !this.trajPane, (el) => el.child(this.labelButton(t, "th-traj-chat", "Chat", "Back to the Chat (y)",
        (_e, cx) => { this.readerMoved(); this.leaveTraj(); cx.notify(); })));
  }

  // The filter buttons: Input, Model and Tools each with their swatch, Failed with a red dot,
  // User with the user mark. From 900 px they say "Failed only" and "User only", with counts.
  filterBar(t, totals, w, inks, held = false) {
    const sq = (c) => div().flex_none().size(8).rounded(2).bg(c);
    const swatch = {
      input: h_flex().flex_none().gap(1).child(sq(inks.user)).child(sq(inks.agent)).child(sq(inks.context)),
      model: sq(inks.model), tools: sq(inks.tools),
      failed: div().flex_none().size(6).rounded(3).bg(inks.failed),
      user: svg(ICON("user")).flex_none().size(12).text_color(inks.user),
    };
    const f = this.tfilter;
    return h_flex().id("th-traj-filters").flex_none().h(LEDGER_FILTERS).px(10).gap(6).items_center().border_b(1).border_color(t.border)
      .children(filterButtons(totals, w, held).map((b) => {
        const on = Boolean(f[b.key]);
        return h_flex().id(`th-filter-${b.key}`).flex_none().h(24).px(8).gap(6).items_center().rounded(5).cursor_pointer()
          .text_size(12).text_color(on ? t.foreground : t.dim).when(on, (el) => el.bg(t.raised))
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.ledgerFilter(b.key); cx.notify(); })
          .child(swatch[b.key])
          .child(div().flex_none().child(b.label))
          .when(b.count != null, (el) => el.child(div().flex_none().text_color(t.dim).child(String(b.count))));
      }));
  }

  // The ledger: a uniform LEDGER_ROW px list, so Herdr places every row with no measuring.
  // right: the detail sits at its right, in a row, where the list takes the row's height
  // (h_flex centres its children, so it would have none).
  ledgerList(t, shown, i, cols, inks, cx, right = false) {
    const sel = shown[i]?.key ?? null;
    // The first draw shows the selected row (the newest heading when none is selected).
    if (!this.tscrolled && shown.length) { this.tscrolled = true; this.tscrollTo ??= sel; }
    const goTo = this.tscrollTo;
    if (goTo) {
      this.tscrollTo = null;
      // The row itself, or its turn's heading when the filter hides it.
      let j = shown.findIndex((r) => r.key === goTo);
      if (j < 0) { const head = this.turnOfRow(goTo); j = shown.findIndex((r) => r.key === head); }
      // Now, and again once the list has its size (a timer asked for in a draw may not run
      // before the list is laid out at a new width).
      if (j >= 0) {
        this.tscroll.scroll_to_item(j, "center");
        cx.timer.after(16, (cx) => { this.tscroll.scroll_to_item(j, "center"); cx.notify(); });
      }
    }
    return div().id("th-traj-listbox").flex_1().min_h(0).min_w(0).w_full().relative().when(right, (el) => el.h_full())
      // Its height, in design px, for the rows it keeps (ledger.js rowsLeft).
      .on_size_change((size, cx) => {
        const h = size.height / this.zoom();
        if (Math.abs(h - (this.tlistH ?? -9)) >= 1) { this.tlistH = h; cx.notify(); }
      })
      .child(v_virtual_list("th-traj-list", shown.length, LEDGER_ROW, (j) => shown[j]?.key ?? `gone:${j}`,
        (range) => {
          const out = [];
          for (let j = range.start; j < range.end; j++) out.push(this.ledgerRow(t, shown[j], shown[j]?.key === sel, cols, inks));
          return out;
        })
        .track_scroll(this.tscroll)
        .on_item_click((key, cx) => {
          if (this.ledgerClick(key)) cx.notify();
        })
        .size_full());
  }

  ledgerRow(t, r, on, cols, inks) {
    if (!r) return div().h(LEDGER_ROW);
    const mono = this.mono();
    if (r.kind === "sess") {
      return h_flex().id(r.key).h(LEDGER_ROW).px(10).items_center().text_size(11.5).text_color(t.dim)
        .child(div().truncate().child(`New session${r.ts ? ` · ${fmtTime(r.ts)}` : ""}`));
    }
    const rw = this.rowW();
    const c = compactRow(r, Math.round(rw) + PANE_FRAME, rw);
    if (c && r.kind !== "sess") return this.ledgerCompact(t, r, on, inks, c);
    if (r.kind === "trh") return this.ledgerHead(t, r, on, inks);
    const k = LEDGER_KINDS[r.lk] ?? LEDGER_KINDS.text;
    const ink = inks[k.ink] ?? t.dim;
    const { start, dur } = rowTimes(r);
    const words = r.tool
      ? h_flex().flex_1().min_w(0).gap(6).items_center()
        .child(div().flex_none().font_family(mono).text_size(12).text_color(t.foreground).child(r.tool))
        .child(div().flex_1().min_w(0).truncate().font_family(mono).text_size(12).text_color(k.faint ? t.dim : t.muted).child(r.sub ? r.text || " " : r.text || " "))
      : div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t[k.tone] ?? t.foreground)
        .child(r.sender ? `${r.sender} · ${r.text}` : r.text);
    return h_flex().id(r.key).h(LEDGER_ROW).px(10).gap(8).items_center().cursor_pointer()
      .when(on, (el) => el.bg(t.raised)).hover((s) => s.bg(t.hover))
      .when(cols.start, (el) => el.child(div().flex_none().w(40).font_family(mono).text_size(11.5).text_color(t.dim).child(start)))
      .child(this.ledgerMark(t, k, ink))
      .child(words)
      .when(Boolean(r.sub?.state) && !r.failed, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim)
        .child([r.sub.state, r.sub.tokens ? `${fmtTokens(r.sub.tokens)} tok` : null].filter(Boolean).join(" · "))))
      .when(Boolean(r.status), (el) => el.child(div().flex_none().text_size(11.5)
        .text_color(r.failed ? t.foreground : r.lk === "running" ? t.working : t.dim).child(r.status)))
      .child(div().flex_none().w(52).font_family(mono).text_size(11.5).text_color(t.muted).text_right().child(dur))
      .when(cols.bar, (el) => el.child(this.ledgerBar(r, ink, inks)));
  }

  // Below 200 px (ledger.js compactRow), a row on one LEDGER_ROW line: a step's mark, its turn's
  // number and its duration; a heading's number and total on its band, over its thin line;
  // below 64 px, the mark alone. The label and the time are in the tooltip.
  ledgerCompact(t, r, on, inks, c) {
    const mono = this.mono();
    const head = r.kind === "trh";
    const k = head ? null : LEDGER_KINDS[r.lk] ?? LEDGER_KINDS.text;
    const row = h_flex().h(head ? LEDGER_ROW - LINE_H : LEDGER_ROW).px(COMPACT_PAD).gap(COMPACT_PAD).items_center()
      .when(c.mode === "icon", (el) => el.justify_center())
      .when(Boolean(k), (el) => el.child(this.ledgerMark(t, k, inks[k.ink] ?? t.dim)))
      .when(c.num != null, (el) => el.child(div().flex_none().font_family(mono).text_size(11.5).text_color(head ? t.muted : t.dim).child(c.num)))
      .when(c.mode === "line", (el) => el.child(div().flex_1()))
      .when(c.dur != null, (el) => el.child(div().flex_none().font_family(mono).text_size(11.5)
        .text_color(r.failed ? t.blocked : head && r.going ? t.working : t.muted).text_right().child(c.dur)));
    const box = div().id(r.key).h(LEDGER_ROW).w_full().relative().cursor_pointer().tooltip(c.tip || " ")
      .when(on || head, (el) => el.bg(on ? t.raised : alpha(t.foreground, 0.035))).hover((s) => s.bg(t.hover))
      .child(row);
    if (!head || !r.line) return box;
    const seg = (key, list, col) => coarse(list ?? [], 12).map(([a, b], j) => div().id(`${r.key}-${key}-${j}`).absolute().top(0)
      .left(`${(a * 100).toFixed(2)}%`).w(`${Math.max(0.4, (b - a) * 100).toFixed(2)}%`).h(LINE_H).bg(col));
    return box.child(div().id(`${r.key}-line`).absolute().left(COMPACT_PAD).right(COMPACT_PAD).bottom(0).h(LINE_H)
      .children([...seg("tools", r.line.tools, inks.tools), ...seg("model", r.line.model, inks.model), ...seg("red", r.line.red, inks.failed)]));
  }

  // The kind's mark: an icon on a square tinted with its ink, or a drawn dot, ring or square.
  ledgerMark(t, k, ink) {
    const box = div().flex_none().size(16).rounded(4).flex().items_center().justify_center().bg(alpha(ink, 0.16));
    if (!k.mark) return div().flex_none().size(16);
    if (k.mark === "dot") return box.child(div().size(6).rounded(3).bg(ink));
    if (k.mark === "ring") return box.child(div().size(7).rounded(4).border_1().border_color(k.faint ? t.dim : ink));
    if (k.mark === "square") return box.child(div().size(6).rounded(1).bg(t.dim));
    if (k.mark === "x") return box.bg(alpha(t.blocked, 0.16)).child(svg(ICON("x")).size(11).text_color(t.blocked));
    return box.child(svg(ICON(k.mark)).size(11).text_color(ink));
  }

  // The row's small bar: BAR_W by BAR_H px, as long as the step took on the session's scale
  // (ledger.js barFrac). An unfinished call, running or with no result, fills the track in the
  // grey open ink, its right end one BAR_SLANT px slant; a failed call is red; a subagent's at
  // SUB_ALPHA.
  ledgerBar(r, ink, inks) {
    const slot = div().flex_none().w(BAR_W).h(BAR_H);
    if (r.open) return slot.child(this.slantBar(inks.open, BAR_W, BAR_H, BAR_SLANT));
    if (!rowTimes(r).bar) return slot;
    const c = r.failed ? inks.failed : r.lk === "subagent" ? alpha(inks.sub, SUB_ALPHA) : ink;
    return slot.child(div().h(BAR_H).w(Math.max(2, Math.round(BAR_W * barFrac(r.dur)))).rounded(1).bg(c));
  }
  // A bar w by h px whose right end is one d px slant: a painted path where Herdr has one,
  // else a plain bar.
  slantBar(color, w, h, d) {
    const win = globalThis.window;
    if (PAINT && typeof win?.paint_path === "function") {
      try {
        const pts = slantPoints(0, w, h, d);
        let b = PAINT.PathBuilder.fill().move_to(pts[0][0], pts[0][1]);
        for (const [x, y] of pts.slice(1)) b = b.line_to(x, y);
        return win.paint_path(b.close().build(), color).w(w).h(h);
      } catch { /* the plain bar below */ }
    }
    return div().w(w).h(h).rounded(1).bg(color);
  }
  // A d by h px end whose top runs d px past its foot, to close a stretch drawn as a box: a
  // painted path where Herdr has one, else a plain d px end.
  slantEnd(color, d, h) {
    const win = globalThis.window;
    if (PAINT && typeof win?.paint_path === "function") {
      try {
        const b = PAINT.PathBuilder.fill().move_to(0, 0).line_to(d, 0).line_to(0, h);
        return div().flex_none().w(d).h(h).child(win.paint_path(b.close().build(), color).w(d).h(h));
      } catch { /* the plain end below */ }
    }
    return div().flex_none().w(d).h(h).bg(color);
  }

  // A turn's heading: its number and time, the numbers at the right (headParts), and under them
  // the turn's thin line: its calls teal, failed ones red, the reply violet, a subagent's
  // calls at SUB_ALPHA. An unfinished call is teal too, from its start to the turn's last
  // recorded event, and that end is one LINE_SLANT px slant.
  ledgerHead(t, r, on, inks) {
    const mono = this.mono();
    const p = headParts(r, this.rowW());
    const dot = " · ";
    const parts = [p.calls, p.failed ? "failed" : null, p.tokens, p.total].filter(Boolean);
    const line = r.line;
    const seg = (key, list, c) => coarse(list ?? [], 40).map(([a, b], j) => div().id(`${r.key}-${key}-${j}`).absolute().top(0)
      .left(`${(a * 100).toFixed(2)}%`).w(`${Math.max(0.4, (b - a) * 100).toFixed(2)}%`).h(LINE_H).bg(c));
    const torn = (key, list, c) => coarse(list ?? [], 40).map(([a, b], j) => h_flex().id(`${r.key}-${key}-${j}`).absolute().top(0)
      .left(`${(a * 100).toFixed(2)}%`).w(`${Math.max(0.4, (b - a) * 100).toFixed(2)}%`).h(LINE_H)
      .child(div().flex_1().min_w(0).h(LINE_H).bg(c)).child(this.slantEnd(c, LINE_SLANT, LINE_H)));
    return div().id(r.key).h(LEDGER_ROW).w_full().relative().cursor_pointer()
      .bg(on ? t.raised : alpha(t.foreground, 0.035)).hover((s) => s.bg(t.hover))
      .child(h_flex().h(LEDGER_ROW - LINE_H).px(10).gap(8).items_center()
        .child(div().flex_none().font_family(mono).text_size(11.5).text_color(t.muted).child(`#${r.n}`))
        .when(Boolean(r.ts), (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(fmtTime(r.ts))))
        .child(div().flex_1())
        .children(parts.map((x, j) => {
          const fail = x === "failed";
          return h_flex().flex_none().gap(4).items_center().text_size(11.5).text_color(r.going && x === p.total ? t.working : t.muted)
            .when(j > 0, (el) => el.child(div().text_color(t.dim).child(dot.trim())))
            .when(fail, (el) => el.child(div().size(6).rounded(3).bg(inks.failed)))
            .child(fail ? p.failed : x);
        })))
      .when(Boolean(line), (el) => el.child(div().id(`${r.key}-line`).absolute().left(10).right(10).bottom(0).h(LINE_H)
        .children([
          ...seg("tools", line.tools, inks.tools), ...seg("sub", line.sub, alpha(inks.sub, SUB_ALPHA)), ...seg("model", line.model, inks.model),
          ...torn("open", line.open, inks.tools), ...torn("osub", line.openSub, alpha(inks.sub, SUB_ALPHA)), ...seg("red", line.red, inks.failed),
        ])));
  }

  // The detail: the row's tag and title with a close button, its fields, then its whole words.
  // At the right of the ledger, width px wide (from 900 px on the right, from 700 px along the
  // bottom: ledger.js trajLayout), else under it.
  ledgerDetail(t, d, inks, right, width = 300) {
    const k = d.kind ? LEDGER_KINDS[d.kind] : null;
    const ink = k ? inks[k.ink] ?? t.dim : t.muted;
    const tagInk = d.kind === "failed" ? t.blocked : ink;
    const field = ([label, value]) => h_flex().gap(12).items_start().min_w(0)
      .child(div().flex_none().w(96).text_size(12).text_color(t.dim).child(label))
      .child(div().flex_1().min_w(0).text_size(12).text_color(label === "Result" && value === "failed" ? t.blocked : t.foreground).child(value));
    const box = v_flex().id("th-traj-detail").flex_none().min_h(0).bg(t.background)
      .when(right, (el) => el.w(width ?? 300).h_full().border_l(1).border_color(t.border))
      .when(!right, (el) => el.w_full().h(Math.max(140, Math.min(300, Math.round((this.rootH || 600) * 0.42)))).border_t(1).border_color(t.border));
    return box
      .child(h_flex().flex_none().h(34).px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().px(6).h(18).flex().items_center().rounded(4).bg(alpha(tagInk, 0.16)).text_size(11).text_color(tagInk).child(d.tag))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().when(d.code, (el) => el.font_family(this.mono())).child(d.title))
        .child(this.iconButton(t, "th-traj-detail-close", "x", "Close the detail (Esc)", (_e, cx) => { this.tdetail = false; cx.notify(); })))
      .child(v_flex().id("th-traj-detail-body").flex_1().min_h(0).overflow_y_scrollbar().px(12).py(10).gap(6)
        .children(d.fields.map(field))
        .when(Boolean(d.text), (el) => el.child(div().pt(8).text_size(12).text_color(t.foreground)
          .when(d.code, (x) => x.font_family(this.mono())).child(String(d.text).slice(0, 4000)))));
  }

  // The foot: the Chat's status line, with the Trajectory's numbers (ledger.js ledgerStatus).
  ledgerFoot(t, L, w) {
    // Until the first build is done, the line is left empty: its counts would be of the
    // newest turns only. It keeps its height. Until the session is read, it is not drawn
    // (statusShown).
    const groups = L.partial ? [] : ledgerStatus(L.totals, w, L.going);
    return h_flex().id("th-status").flex_none().h(STATUS_H).px(12).gap(18).items_center().justify_center().overflow_hidden()
      .children(groups.map((g) => h_flex().id(`th-status-${g.key}`).gap(5).items_center().min_w(0).when(groups.length > 1, (el) => el.flex_none())
        .child(svg(ICON(g.icon)).flex_none().size(12).text_color(g.key === "failed" ? t.blocked : t.dim))
        .child(div().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(g.text))));
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
  keySheetWant(groups) {
    const rows = groups.reduce((n, [, items]) => n + items.length, 0);
    return 36 + 20 + groups.length * (16 + 6) + rows * 25 + (groups.length - 1) * 12 + 8;
  }
  keySheetH(groups) {
    const room = (this.rootH || 600) - 46 - this.footSpace() - 6;
    return Math.max(120, Math.min(this.keySheetWant(groups), room));
  }

  // ?: every key, grouped (ui.js keySheet), over the list between the header and the footer.
  // Esc, ?, the close button or a click outside the card closes it.
  keySheetView(t) {
    const close = (_e, cx) => { cx.stop_propagation(); this.keysOpen = false; cx.notify(); };
    // The key column fits the widest row's chips on one line where the pane has room (TRD-8).
    const col = this.pw() >= KEYS_COL_MIN ? KEYS_COL : KEYS_COL_NARROW;
    const row = ([keys, what]) => h_flex().gap(8).items_start().min_w(0)
      .child(h_flex().flex_none().w(col).gap(3).flex_wrap().children(keys.map((k) => this.kbd(t, k))))
      .child(div().flex_1().min_w(0).text_size(12).text_color(t.foreground).child(what));
    const groups = keySheet(this.quoteKey, { outline: !this.pinnedPane, ledger: this.traj, inPane: this.traj && !this.trajPane, bottom: this.trajPane && this.trajDock === "bottom" });
    const sheetH = this.keySheetH(groups);
    // Taller than its room: the list scrolls, and where Herdr has Scrollbar and its mode the bar
    // is drawn all the time, in a strip at the right edge, so the sheet shows there is more.
    const bar = this.cardBar && this.keySheetWant(groups) > sheetH;
    const list = v_flex().id("th-keys-list").flex_1().min_h(0)
      .when(bar, (el) => el.overflow_y_scroll().pr(12 + CARD_BAR_W)).when(!bar, (el) => el.overflow_y_scrollbar().pr(12)).pl(12).py(10).gap(12)
      .children(groups.map(([group, items]) => v_flex().gap(6)
        .child(div().text_size(11).font_semibold().text_color(t.muted).child(group))
        .children(items.map(row))));
    return div().id("th-keys-scrim").absolute().top(0).left(0).right(0).bottom(0).bg(alpha(t.background, 0.6))
      .on_click(close)
      // Nothing under the sheet takes the wheel (covered()).
      .on_scroll_wheel((_e, cx) => cx.stop_propagation())
      .child(v_flex().id("th-keys").absolute().top(46).left(10).right(10).h(sheetH)
        .rounded(8).border_1().border_color(t.border).bg(this.solidFill(t)).shadow_md()
        .on_click((_e, cx) => cx.stop_propagation())
        .child(h_flex().flex_none().h(36).px(12).gap(8).items_center().border_b(1).border_color(t.border)
          .child(div().flex_1().min_w(0).text_size(13).font_semibold().text_color(t.foreground).child("Keys"))
          .child(this.kbd(t, "?"))
          .child(this.iconButton(t, "th-keys-close", "x", "Close (Esc)", close)))
        .child(bar
          ? div().relative().flex_1().min_h(0).flex().flex_col().child(list)
            .child(div().absolute().top(0).bottom(0).right(0).w(CARD_BAR_W).child(gpuiBase.Scrollbar.vertical("th-keys-list").mode("always").absolute().top(0).bottom(0).left(0).right(0)))
          : list));
  }

  // i: the Turn card, with the selected turn's numbers and what each means (detailRows). It
  // opens beside the info icon of the turn's Worked for line (lineIcon), follows the
  // selection, so ↑ ↓ compare turns, and closes with i, Esc or any press. On Herdr before
  // 0.1.15 (no Popup) it sits over the bottom of the pane instead, like the ? sheet.
  cardW() { return Math.min(420, Math.min(replyWidth(this.width), this.prose()) + 8); }
  // hover: the HoverCard's copy, with no close mark, since moving off closes it.
  detailsCard(t, turn, up = false, hover = false) {
    const row = ([label, value, what, under]) => h_flex().gap(14).items_start().min_w(0)
      .child(div().flex_none().w(78).text_size(12.5).line_height("18px").text_color(t.muted).child(label))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(12.5).line_height("18px").text_color(t.foreground).child(value))
        .when(Boolean(under), (el) => el.child(div().text_size(11.5).line_height("16px").font_family(this.mono()).text_color(this.labelInk(t, t.popover)).child(under)))
        .child(div().text_size(11.5).line_height("16px").text_color(t.dim).child(what)));
    return v_flex().id(hover ? "th-details-hover" : "th-details").w(this.cardW()).when(up, (el) => el.mb(4)).when(!up, (el) => el.mt(4))
      .rounded(10).border_1().border_color(t.border).bg(this.solidFill(t)).shadow_md()
      .child(h_flex().flex_none().h(34).px(12).gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(`Turn #${turn.n}`))
        .child(this.kbd(t, "i"))
        .when(!hover, (el) => el.child(div().flex_none().size(22).flex().items_center().justify_center().child(svg(ICON("x")).size(13).text_color(t.dim)))))
      .child(v_flex().px(12).pb(12).gap(8).children(this.detailRows(turn).map(row)));
  }
  // The card's height before it is drawn: the head, then each row's value, counts and
  // explanation, wrapped at the card's text width.
  // Kept per turn and card width, since every settled line on screen carries a card.
  cardH(turn) {
    const w = this.cardW();
    const rows = this.detailRows(turn);
    const m = (this.cardHMemo ??= new WeakMap());
    const hit = m.get(turn);
    if (hit && hit.w === w && hit.rows === rows) return hit.h;
    const per = Math.max(10, Math.floor((w - 24 - 78 - 14) / 6.2));
    const h = 34 + 12 + rows.reduce((acc, [, , what, under], i) => acc + (i ? 8 : 0) + 18 + 2 + (under ? 18 : 0) + wrappedLines(what, per) * 16, 0);
    m.set(turn, { w, rows, h });
    return h;
  }
  // Down from the icon, or up when the line sits low in the pane and the card would not fit
  // under it. The list says which items it drew, not where, so the line's height in the pane
  // is worked out from the item sizes: how far the first drawn item is scrolled off is what
  // keeps the last drawn item on screen and the next one off (exact at the end of the list).
  detailsDir(itemKey, turn) {
    const rows = this.rowsMemo ?? [];
    const sizes = this.sizesMemo ?? [];
    const i = this.rowIndex(itemKey);
    const [a, b] = this.viewRange ?? [0, 0];
    if (i < a || i >= b) return "down";
    let all = 0;
    for (let k = a; k < b; k++) all += sizes[k] ?? 0;
    const last = sizes[b - 1] ?? 0;
    const H = this.listH;
    const lo = Math.max(0, all - last - H);
    const hi = b >= rows.length ? Math.max(lo, all - H) : Math.max(lo, Math.min(sizes[a] ?? 0, all - H));
    let y = b >= rows.length ? -Math.max(0, all - H) : -(lo + hi) / 2;
    for (let k = a; k < i; k++) y += sizes[k] ?? 0;
    // An open turn's line item has the line at its top; a closed row has it over the start of
    // the reply and the strip.
    const sh = rows[i].shape;
    const under = (sh?.reply?.length ?? 2) * this.rt().line + (sh?.rMore ? ROW.MORE : 0) + ROW.GAP + ROW.ACTS + ROW.PAD_B;
    y += itemKey.startsWith("rhead:") ? ROW.GAP + ROW.LINE : (sizes[i] ?? 0) - under;
    const h = this.cardH(turn) + 4;
    return y + h > H && y - ROW.LINE > h ? "up" : "down";
  }
  detailsTurn() { return this.detailsOpen && this.sel ? this.findTurn(this.sel) : null; }
  detailsView(t) {
    const turn = this.detailsTurn();
    if (!turn) return div();
    return h_flex().absolute().bottom(this.footSpace() + 8).left(0).right(0).px(8).justify_center()
      .on_click((_e, cx) => { cx.stop_propagation(); this.detailsOpen = false; cx.notify(); })
      .child(this.detailsCard(t, turn).mt(0));
  }

  // True when the shown turns span more than one day (day dividers, and [ ] moves by day).
  manyDays() {
    const days = new Set();
    for (const s of this.sessions) for (const t of s.turns) { days.add(t.day ?? dayKey(t.ts)); if (days.size > 1) return true; }
    return false;
  }

  // ---- the rail ----
  // On the list's right edge (or left, railSide), in place of the scrollbar, in the list's
  // own view: one tick per turn, 9 px apart at every length, in a window of at most 60% of
  // the list's height and 540 px (ui.js railWindow) that follows the turns on screen. Turns
  // on screen are brighter, the selected turn's tick is longer, a pinned turn's takes the
  // accent colour and the running turn's pulses. A search dims the turns it leaves out. A
  // click brings the turn level with its tick (railJump).
  // A pane too narrow for a whole 70 character line hides the rail (ui.js railRoom), as Codex
  // hides its side rail.
  railShown() {
    return this.view !== "pinned" && !this.pinnedPane && !this.outlined() && (this.railTurns?.length ?? 0) > 1 && railRoom(this.pw(), this.prefs.textSize);
  }
  // The ticks are made once per list of turns and set of pins; on each draw only the window,
  // the selection and the turns on screen are worked out, and only the ticks in the window
  // are drawn (60 at most at any length). Making every tick on every draw, with a pin lookup
  // per turn, took about half of Herdr's time for a draw in a session of 2,000 turns.
  railTicks() {
    const list = this.railTurns ?? [];
    this.pinnedAll();
    const pins = this.pinTurns ?? new Set();
    let base = this.railMemo;
    if (!base || base.list !== list || base.pins !== pins) {
      const all = [];
      const at = new Map();
      const pinAt = [];
      let liveAt = -1;
      list.forEach((x, i) => {
        at.set(x.key, i);
        const prev = list[i - 1];
        const pinned = pins.has(x.turn);
        if (pinned) pinAt.push(i);
        if (x.live) liveAt = i;
        all.push({ key: x.key, last: x, turns: [x], dayStart: Boolean(prev && x.day && x.day !== prev.day), pinned, live: Boolean(x.live), miss: Boolean(x.miss) });
      });
      base = this.railMemo = { list, pins, all, at, pinAt, liveAt };
    }
    const { all } = base;
    const n = all.length;
    // Which turns are on screen, from the range the list last drew.
    const rows = this.rowsMemo ?? [];
    const [a, b] = this.viewRange ?? [0, 0];
    const on = new Set();
    let lo = Infinity;
    let hi = -1;
    for (let i = a; i < Math.min(b, rows.length); i++) {
      const k = rowTurnKey(rows[i]);
      const gi = k ? base.at.get(k) : undefined;
      if (gi != null) { on.add(gi); lo = Math.min(lo, gi); hi = Math.max(hi, gi); }
    }
    // The window stays where it is while the pointer is on the rail (railOn) or its card
    // (railCardOn), and after a dot brought a turn into it until the list moves (railHeld);
    // otherwise it follows the list.
    const range = `${a}:${b}`;
    if (this.railHeld && this.railHeld !== range) this.railHeld = null;
    // A card that closed (its tick left the window) without telling the pointer left it.
    if (!this.railHover) this.railCardOn = false;
    const held = Boolean(this.railOn || this.railCardOn || this.railHeld);
    const day = (i) => all[i].dayStart;
    const W = railWindow(n, day, Math.max(0, this.listH), this.railTop ?? 0, held || hi < 0 ? null : [lo, hi], !held && Boolean(this.follow));
    this.railTop = W.top;
    this.railCut = W.cut;
    const end = W.top + W.count;
    const sel = this.sel ? base.at.get(this.sel) : undefined;
    const ticks = [];
    for (let i = W.top; i < end; i++) {
      const j = i - W.top;
      let fade = 1;
      if (W.top > 0 && j < RAIL.FADE.length) fade = RAIL.FADE[j];
      if (end < n && end - 1 - i < RAIL.FADE.length) fade = Math.min(fade, RAIL.FADE[end - 1 - i]);
      ticks.push({ ...all[i], i, sel: i === sel, inView: on.has(i), fade, dayStart: j > 0 && all[i].dayStart });
    }
    // A pin or the running turn past an end: the nearest one, the running turn first.
    const past = (above) => {
      const live = base.liveAt >= 0 && (above ? base.liveAt < W.top : base.liveAt >= end) ? base.liveAt : -1;
      if (live >= 0) return { i: live, live: true };
      let pin = -1;
      for (const p of base.pinAt) if (above ? p < W.top && p > pin : p >= end && (pin < 0 || p < pin)) pin = p;
      return pin >= 0 ? { i: pin, live: false } : null;
    };
    return { L: { pitch: RAIL.MAX, mark: 2 }, ticks, n, cut: W.cut, top: W.top, dotTop: W.cut ? past(true) : null, dotBottom: W.cut ? past(false) : null };
  }
  // The wheel on the rail moves its window a tick at a time (9 px of a touchpad's travel, or a
  // line from a wheel that counts lines) and the list stays: the rail is drawn over the list,
  // so its handler runs first and stops the event there. A window that is not cut has nothing
  // to move, and the wheel goes on to the list.
  railWheel(e, cx) {
    if (!this.railCut) return;
    cx.stop_propagation();
    const lines = Number(e?.delta_lines?.y) || 0;
    let steps;
    if (lines) steps = Math.sign(lines) * Math.max(1, Math.round(Math.abs(lines)));
    else {
      this.railAcc = (this.railAcc ?? 0) + (Number(e?.delta?.y) || 0);
      steps = Math.trunc(this.railAcc / RAIL.MAX);
      this.railAcc -= steps * RAIL.MAX;
    }
    if (e?.touch_phase === "ended" || e?.touch_phase === "cancelled") this.railAcc = 0;
    if (!steps) return;
    this.readerMoved();
    // Up (a positive delta, as for the list) shows earlier turns.
    this.railTop = Math.max(0, (this.railTop ?? 0) - steps);
    this.railOn = true;
    cx.notify();
  }
  // A press on an end's dot: its turn comes into the window, and the list stays where it is.
  railReveal(i, cx) {
    const base = this.railMemo;
    if (!base) return;
    this.readerMoved();
    const W = railWindow(base.all.length, (k) => base.all[k].dayStart, Math.max(0, this.listH), this.railTop ?? 0, [i, i], false);
    this.railTop = W.top;
    const [a, b] = this.viewRange ?? [0, 0];
    this.railHeld = `${a}:${b}`;
    cx.notify();
  }
  railTip(k) {
    const a = k.turns[0].turn;
    const text = String(a.prompt ?? "").replace(/\s+/g, " ").trim();
    const cut = text.length > 60 ? `${text.slice(0, 59)}…` : text;
    return [`#${a.n}`, k.live ? "now" : fmtTime(a.ts), k.pinned ? "pinned" : null, cut || null].filter(Boolean).join(" · ");
  }
  // The rail card (Herdr 0.1.15, Popup): a first line with the day, the time and the number
  // ("Yesterday · 3:48 PM · #7", the running turn "Today · now · #149") and a pin when the turn
  // is pinned; for an agent message (sent, or matched by a sender rule) its icon and label on
  // a 15 px line; the prompt on two lines; the reply on three, flattened (a table's cells joined
  // with a middle dot, code as "[code]"), or "Working · 0:48" for the running turn. A turn with
  // no reply shows its prompt alone.
  // The reply is flattened once per hovered turn (railReplyMemo), from its first 600
  // characters.
  railCard(k) {
    const a = k.turns[0].turn;
    // The person's own words, as the Pinned rows show them: a quoted line is not the prompt.
    const text = pinPromptText(String(a.prompt ?? "")).replace(/\s+/g, " ").trim();
    const body = clipPrompt(text, 2, RAIL.CARD_CHARS, 200).text;
    let reply = null;
    if (k.live) reply = `Working${a.ts ? ` · ${fmtClock(Date.now() - a.ts)}` : ""}`;
    else {
      const m = this.railReplyMemo;
      if (m?.turn === a) reply = m.text;
      else {
        const flat = flattenMd(String(this.replyText(a) ?? "").slice(0, 600), 200);
        reply = flat ? clipPrompt(flat, 3, RAIL.REPLY_CHARS, 200).text : null;
        this.railReplyMemo = { turn: a, text: reply };
      }
    }
    return { day: railDay(a.ts), rest: [k.live ? "now" : fmtTime(a.ts), `#${a.n}`].join(" · "), pinned: k.pinned, body, reply, origin: senderOrigin(a.sender),
      who: a.agent ? senderLabel(a.sender, 400) : null, icon: a.agent ? senderIcon(a.sender) : null };
  }
  // The rail's side: "right" (the default) or "left" (settings railSide). Only the lane, the
  // side the ticks grow toward and the side the card opens on move.
  railLeft() { return this.prefs.railSide === "left"; }
  railView(t) {
    const { L, ticks, cut, dotTop, dotBottom } = this.railTicks();
    const busy = this.liveState(t).color;
    const look = railLook(this.side());
    const left = this.railLeft();
    // The peak: each tick's width from its distance in px to the hovered tick, set in the draw
    // that opens the card. Distances count the day gaps.
    // Under the settings card or the keys sheet the rail takes no hover, press or wheel.
    const quiet = this.covered();
    const hi = quiet || this.railHover == null ? -1 : ticks.findIndex((k) => k.key === this.railHover);
    let ys = null;
    if (hi >= 0) {
      ys = [];
      let y = 0;
      ticks.forEach((k, i) => { if (i && k.dayStart) y += RAIL.DAY; ys.push(y); y += L.pitch; });
    }
    // The pointer on the rail holds its window (railTicks).
    const rail = v_flex().id("th-rail").absolute().top(RAIL.PAD).bottom(RAIL.PAD).w(look.lane).justify_center()
      .when(!quiet, (el) => el
        .on_hover((on, cx) => { if (Boolean(on) !== Boolean(this.railOn)) { this.railOn = Boolean(on); if (!on) cx.notify(); } })
        .on_scroll_wheel((e, cx) => this.railWheel(e, cx)));
    // A cut end has a 9 px row past it, holding a dot for a pin or the running turn that lies
    // that way; a press brings it into the window.
    const endRow = (id, d, above) => {
      const row = div().id(id).flex_none().relative().w(look.lane).h(L.pitch);
      if (!d) return row;
      const turn = this.railMemo.all[d.i].turns[0].turn;
      const dot = div().absolute().top((L.pitch - RAIL.DOT) / 2).size(RAIL.DOT).rounded(RAIL.DOT / 2).bg(d.live ? busy : t.accent)
        .when(d.live, (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1400 }));
      const place = left ? dot.left(look.right + 3) : dot.right(look.right + 3);
      if (quiet) return row.child(place);
      return row.cursor_pointer().tooltip(`${d.live ? "Working" : "Pinned"} #${turn.n} ${above ? "above" : "below"}`)
        .on_click((_e, cx) => { cx.stop_propagation(); this.railReveal(d.i, cx); })
        .child(place);
    };
    return (left ? rail.left(0).items_start() : rail.right(0).items_end())
      .when(cut, (el) => el.child(endRow("th-rail-up", dotTop, true)))
      .children(ticks.map((k, i) => {
        const hot = i === hi;
        const color = k.live ? busy : k.pinned ? t.accent : k.sel || hot ? t.foreground : k.inView ? t.muted : t.dim;
        const op = (k.miss && !hot ? 0.16 : k.live || k.pinned || k.sel || k.inView || hot ? 1 : 0.5) * (hot ? 1 : k.fade);
        const own = k.sel ? look.sel : look.mark;
        const swell = ys ? Math.max(own, railSwell(look.mark, look.peak, Math.abs(ys[i] - ys[hi]))) : own;
        // A clicked tick (railGrow): out to its grow width at the usual slide, then back over
        // the flash's fade, so the two fade together.
        const grow = this.railGrow?.key === k.key ? this.railGrow : null;
        const w = grow?.on ? look.grow : swell;
        // The mark hangs from the pane's edge and grows inward; it is placed by hand so the
        // peak can be wider than the lane leaves beside the inset.
        // Herdr slides a change of width over 90 ms by itself (round 7, the slide): the draw
        // only sets the new width, and no timer runs in the mod.
        const mark = div().id(`th-mark-${k.i}`).absolute().top(Math.floor((L.pitch - L.mark) / 2)).w(w).h(L.mark).rounded(1).bg(color).opacity(op)
          .transition("width", { duration: grow && !grow.on ? FLASH.FADE : RAIL.SLIDE_MS, easing: "ease-out" })
          .when(k.live, (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1400 }));
        const still = div().id(`th-tick-${k.i}`).flex_none().relative().w(look.lane).h(L.pitch)
          .when(k.dayStart, (el) => el.mt(RAIL.DAY))
          .child(left ? mark.left(look.right) : mark.right(look.right));
        if (quiet) return still;
        const tick = still.cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); this.railClick(k.key, cx); });
        // On Herdr 0.1.15 a hovered tick shows the card beside it, on the rail's inner side;
        // before that, the one-line tooltip.
        if (!Popup) return tick.tooltip(this.railTip(k));
        return Popup.new(`th-tick-card-${k.i}`, tick.on_hover((on, cx) => {
          // A click closed this tick's card (railCardClose): it stays closed until the pointer
          // leaves the tick.
          if (on && this.railQuiet === k.key) return;
          if (on) { this.railHover = k.key; this.railLeave = null; this.railQuiet = null; cx.notify(); return; }
          if (this.railQuiet === k.key) this.railQuiet = null;
          if (this.railHover !== k.key || this.railCardOn) return;
          // The card stays 200 ms after the pointer leaves its tick, so it can cross to the
          // card (whose own hover then keeps it); another tick's hover cancels the wait.
          const leave = (this.railLeave = {});
          cx.timer.after(RAIL.CARD_KEEP_MS, (cx) => {
            if (this.railLeave !== leave) return;
            this.railLeave = null;
            if (this.railHover === k.key && !this.railCardOn) { this.railHover = null; cx.notify(); }
          });
        })).anchor(left ? "left_center" : "right_center").when(hot, (el) => el.content(this.railCardView(t, k).id("th-rail-card-box")
          .on_hover((on, cx) => {
            // The pointer on the card keeps it open and holds the window.
            this.railCardOn = Boolean(on);
            if (on) { this.railHover = k.key; this.railLeave = null; }
            else if (this.railHover === k.key && !this.railOn) { this.railHover = null; cx.notify(); }
          })));
      }))
      .when(cut, (el) => el.child(endRow("th-rail-down", dotBottom, false)));
  }
  railCardView(t, k) {
    const c = this.railCard(k);
    const card = v_flex().id("th-rail-card").w(Math.min(RAIL.CARD_W, Math.max(120, this.width - 44))).px(10).py(7).gap(2)
      .rounded(8).border_1().border_color(t.border).bg(this.solidFill(t)).shadow_md();
    // Clear of the peak, which reaches past the lane by what it outgrows the room beside the
    // inset (6 px at the usual 32 px lane and 14 px inset). Padding on a box around the card,
    // since the Popup pins the card's outer corner and a margin on that side is not counted.
    const look = railLook(this.side());
    const gap = RAIL.CARD_GAP + Math.max(0, look.peak + look.right - look.lane);
    const box = div().flex_none();
    return (this.railLeft() ? box.pl(gap) : box.pr(gap)).child(card
      .child(h_flex().h(15).gap(4).items_center().text_size(11).line_height("15px").min_w(0)
        .when(Boolean(c.day), (el) => el.child(div().flex_none().text_color(t.muted).child(c.day)).child(div().flex_none().text_color(t.dim).child("·")))
        .child(div().min_w(0).truncate().text_color(t.dim).child(c.rest))
        .child(div().flex_1())
        // The pin: accent when pinned; a press pins or unpins the card's turn, as p does.
        .child(div().id("th-rail-card-pin").flex_none().size(15).flex().items_center().justify_center().rounded(3).cursor_pointer()
          .text_color(c.pinned ? t.accent : t.dim).hover((s) => s.bg(t.hover).text_color(c.pinned ? t.accent : t.foreground))
          .tooltip(`${c.pinned ? "Unpin" : "Pin"} #${k.turns[0].turn.n} (p)`)
          .on_click((_e, cx) => { cx.stop_propagation(); this.readerMoved(); this.togglePin(k.key, cx); cx.notify(); })
          .child(svg(ICON("pin")).size(11))))
      // An agent message, sent or matched by a sender rule: its icon and label, as in the list.
      .when(Boolean(c.who), (el) => el.child(h_flex().h(15).gap(5).items_center().min_w(0).text_size(11).line_height("15px")
        .child(svg(ICON(c.icon)).size(11).flex_none().text_color(this.agentColor(t)))
        .child(this.labelView(senderParts(k.turns[0].turn.sender, 400), this.agentColor(t), null))))
      .when(Boolean(c.body), (el) => el.child(div().text_size(12.5).line_height("18px").max_h(36).overflow_hidden().font_medium().text_color(t.foreground).child(c.body)))
      .when(Boolean(c.reply), (el) => el.child(div().text_size(12).line_height("17px").max_h(51).overflow_hidden().text_color(t.muted).child(c.reply))));
  }
  // A click on a tick (or its card) brings the turn level with the tick, where the eyes are
  // (landPlan): its first line about the tick's height, never under the floating top.
  // The flash on a turn a jump landed on: a tint of accent over its items (FLASH.ALPHA), drawn
  // at full strength once the scroll is done, then faded out by Herdr itself (transition on
  // opacity, FLASH.FADE ms), then dropped. No rows change and no timer redraws the fade.
  flashTurn(key, cx) {
    if (!key) return;
    const n = (this.flashN ?? 0) + 1;
    this.flashN = n;
    cx.timer.after(FLASH.AFTER, (cx) => { if (this.flashN === n) { this.flash = { key, on: true, n }; cx.notify(); } });
    cx.timer.after(FLASH.AFTER + 40, (cx) => { if (this.flashN === n && this.flash) { this.flash = { ...this.flash, on: false }; this.railGrowEnd(key); cx.notify(); } });
    cx.timer.after(FLASH.AFTER + 40 + FLASH.FADE + 60, (cx) => { if (this.flashN === n) { this.flash = null; if (this.railGrow?.key === key && !this.railGrow.on) this.railGrow = null; cx.notify(); } });
  }
  // The owner's experiment, 17 Nov: "If you clicked it, the line would briefly extend, then
  // flash, and they would all fade out together so you see which one you clicked on." A
  // clicked tick grows to look.grow (railGrow on); when the turn's flash starts to fade, the
  // tick shrinks back over the same FLASH.FADE (railGrowEnd), and both are dropped together.
  // If no flash comes (the jump found nothing), RAIL.GROW_KEEP_MS shrinks it anyway.
  railGrowStart(key, cx) {
    const g = (this.railGrow = { key, on: true });
    cx.timer.after(RAIL.GROW_KEEP_MS, (cx) => {
      if (this.railGrow !== g) return;
      this.railGrow = { key, on: false };
      cx.notify();
      cx.timer.after(FLASH.FADE + 60, (cx) => { if (this.railGrow?.key === key && !this.railGrow.on) { this.railGrow = null; cx.notify(); } });
    });
  }
  // A click on a tick: its card closes, the tick grows, and the turn comes up level with it.
  railClick(key, cx) {
    this.readerMoved();
    this.railCardClose(key);
    this.railGrowStart(key, cx);
    this.railJump(key, cx);
  }
  railGrowEnd(key) {
    if (this.railGrow?.on && this.railGrow.key === key) this.railGrow = { key, on: false };
  }
  // A click on a tick closes its card, so the card does not cover the turn the click brings
  // up, and keeps it closed while the pointer stays on that tick (railQuiet).
  railCardClose(key) {
    this.railHover = null;
    this.railCardOn = false;
    this.railLeave = null;
    this.railQuiet = key;
  }
  railJump(key, cx) {
    const y = this.railTickY(key);
    this.toList();
    this.sel = key;
    this.follow = false;
    this.toBottom = false;
    this.scrollTo = { key, how: "head", flash: true, ...(y == null ? {} : { at: Math.max(0, y - ROW.PAD_T - 10) }) };
    cx.notify();
  }
  // A drawn tick's middle, in px down the list's box: the rail's ticks are centred in it,
  // RAIL.PAD in from each end, with a 9 px row past each cut end.
  railTickY(key) {
    const { L, ticks, cut } = this.railTicks();
    let y = cut ? L.pitch : 0;
    let at = null;
    for (const k of ticks) {
      if (k.dayStart) y += RAIL.DAY;
      if (k.key === key) at = y + L.pitch / 2;
      y += L.pitch;
    }
    if (at == null) return null;
    const total = y + (cut ? L.pitch : 0);
    return RAIL.PAD + Math.max(0, (this.listH - 2 * RAIL.PAD - total) / 2) + at;
  }

  // The fill of a surface drawn over the list (the pill, the rail card, the ? sheet, a toast):
  // the popover colour over the pane's background, and a state fill (hover) over that, as one
  // opaque colour. Themes give hover and selected with alpha, and some give popover so, which
  // would let the list show through.
  solidFill(t, state = null) {
    const k = `${t.background}|${t.popover}|${t.raised}|${state ?? ""}`;
    const m = (this.fillMemo ??= new Map());
    let v = m.get(k);
    if (v == null) {
      const base = over(t.popover ?? t.raised, over(t.background, "#000000"));
      v = state ? over(state, base) : base;
      if (m.size > 16) m.clear();
      m.set(k, v);
    }
    return v;
  }

  // The Jump to latest pill: it floats at the bottom centre of the list while the end of the
  // list is off screen, in the list's own view (not the outline or the Pinned view). A down
  // arrow leads its label, and a dot leads both while something new came in below the screen.
  pillShown() {
    return this.bottomShown === false && this.view !== "pinned" && !this.pinnedPane && !this.outlined();
  }
  pillView(t) {
    const dot = this.unseen === true;
    return h_flex().absolute().bottom(this.footSpace() + PILL_GAP).left(0).right(0).justify_center()
      .child(h_flex().id("th-latest-pill").flex_none().h(PILL_H).px(12).gap(6).items_center().rounded(PILL_H / 2)
        .bg(this.solidFill(t)).border_1().border_color(t.border).shadow_md().cursor_pointer()
        .text_size(12).text_color(t.foreground).hover((s) => s.bg(this.solidFill(t, t.hover)))
        .tooltip(dot ? "New below · jump to latest (End)" : "Jump to latest (End)")
        // The click stops here, so nothing under the pill takes it (a row, a pin's button). The
        // press-down goes on, so Herdr still focuses the pane on it.
        .on_click((_e, cx) => { cx.stop_propagation(); this.action("latest", cx); cx.notify(); })
        .when(dot, (el) => el.child(div().id("th-latest-pill-dot").flex_none().size(6).rounded(3).bg(t.accent)))
        .child(svg(ICON("arrow-down")).size(12).flex_none().text_color(t.muted))
        .child(div().flex_none().child("Jump to latest")));
  }

  toastView(t) {
    // Just above the footer, whose hints can wrap to two lines, and above the pill.
    const pill = this.pillShown() ? PILL_H + PILL_GAP : 0;
    return h_flex().absolute().bottom(this.footSpace() + 6 + pill).left(0).right(0).justify_center()
      // It takes the click, so a click on it reaches nothing under it: a row, or a pin's unpin
      // button it covers (pinButtons). The press-down goes on, so Herdr still focuses the pane.
      .child(h_flex().id("th-toast").min_h(32).max_w(Math.max(120, this.width - 24)).px(12).py(6).gap(7).items_center().rounded(8).bg(this.solidFill(t)).border_1().border_color(t.border).shadow_md()
        .on_click((_e, cx) => cx.stop_propagation())
        .text_size(12.5).text_color(t.foreground)
        .child(svg(ICON(this.toast.icon ?? "check")).size(13).flex_none().text_color(this.toast.icon === "circle-x" ? t.blocked : this.toast.icon === "check" ? t.ansi2 : t.muted))
        .child(div().min_w(0).max_h(44).overflow_hidden().child(this.toast.text)));
  }
}
