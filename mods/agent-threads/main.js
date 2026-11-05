// agent-threads: a pane beside a Claude Code, Codex, OpenCode, Pi or Cursor terminal that lists each prompt
// and the agent's final reply, with tool calls hidden. Read-only toward the agent, with one
// exception (RECIPE.md, How it behaves): quoteToTerminal() pastes a quote of a reply into the
// bound terminal's input as a bracketed paste (Herdr's terminal.paste, the ⌘V command),
// never followed by Enter or any other submit. Nothing else types into a terminal. The
// other commands it runs are pane.split (to open itself), pane.focus (the Terminal
// button, and before the quote's paste) and pane.close (its own pane). The only programs
// it runs besides its scripts are hc get and git remote get-url (the scripts run jq, lsof, ps
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
import { v_flex, h_flex, InputState, Input, Scrollbar, VirtualListScrollHandle, v_virtual_list, TextView, Editor, EditorState } from "gpui-base";
import {
  exec, hc, home, appHome, readTextFile, watchFolder, theme, themes, settings, panes, terminals, spaces,
  focused, props, run, shared, setShared, closeOverlay, notify, nextCommand, updates,
} from "herdr";
import {
  newSession, apply, rewindTail, newChunk, parseLine, nextChunk, replaced, reply, stats, segments, matches,
  fmtTokens, fmtDuration, fmtClock, fmtTime, fmtBytes, shortModel, fmtPct, cacheLine, cachePct, commandParts, fmtCount,
} from "./turns.js";
import { claudePaths, slug, argvSession, recordSession, decide, dividerLabel, candidates } from "./session.js";
import { HARNESS, harnessOf, harnessOfFile, idOfFile, dbOfFile, fileChanged, codexArgvSession, opencodeArgv, etimeMs, pickOpenCode, openCodeLabel, quotePaste, piArgv, piFolder, piStartMs, cursorFolder, cursorStore, cursorArgv } from "./harness.js";
import {
  keyAction, alpha, spans, around, langFor, clipPrompt, wrappedLines, dayKey, dayLabel, dayParts, jumpTarget,
  rowLines, flattenMd, rowShape, rowTextWidth, ROW, senderLabel, senderIcon, kindWords, isShown, countLabel,
  focusTarget, contrast, labelColor, middle, commandColor, clipYou, promptMd, promptParts, linkify,
  quoteText, inReply, atLeast, foreground, canQuote, parseRemote, barLayout, QUOTE_INSET, cardLabelColor, bandFill, over,
} from "./ui.js";
import { DEFAULTS, RANGES, parseSettings, parseExtras, settingsText, settingsDir, settingsPath, saveSettings, writable, NOT_SAVED, adoptPrevious } from "./settings.js";
import { MOD } from "./name.js";

const ICON = (n) => `mods/${MOD}/${n}.svg`;
const SCRIPT = (n) => `${appHome()}/mods/${MOD}/${n}`;
// Pasted images, decoded by image.sh into the mod's data folder (kept across installs, never
// in the repo, trimmed to 200 MB). image() takes paths from the app home.
const IMG_DIR = `data/${MOD}/images`;
const THUMB_W = 64;
const THUMB_H = 40;
const IMG_MAX_H = 260;
const IMG_FULL_H = 1600;
// Bytes per extractor call. A 6.7 MB busy transcript reads in 4 calls, so the header's
// percentage moves, and each call's parse and apply run in slices (read()).
const CHUNK = 2 * 1024 * 1024;
const SLICE_MS = 8; // synchronous work before read() yields to the app
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
const SELECT_CHARS = 60000; // of a reply in the Select text view
const SELECT_CHAR = 7.5; // px per character of the terminal font at 12.5 px
const PROMPT_LINES = 3; // in the open card's YOU block (collapsed rows use the settings)
const PROMPT_CHARS = 600;
const FULL_PROMPT_CHARS = 200000; // of a prompt with Show all; a note says what is left out
const YOU_MAX = 420; // a whole prompt taller than this scrolls inside the YOU block
const REPLY_BUDGET = 1600; // characters of prose shown before "Show full reply"
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
const NOTE_LINE = 20; // the working card's 12 px note, set explicitly (about 1.618 em)
const MONO_EM = 0.6; // width of a mono character, in em
// Open-card parts whose text gpui wraps: drawn once more in a hidden probe, measured, and
// then given that height (measured()).
const PROBED = new Set(["you", "rhead", "md", "lhead", "latest", "stats", "legend", "noreply"]);
const MD_CHAR = 6.1; // estimated width of a character of 13 px reply prose
const YOU_CHAR = 6.2; // the same for the prompt, a little wider: the YOU block clips
const CLAUDE = "#d97757";
const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "nu", "pwsh", "login", "tcsh", "ksh"]);
const CARD = new Set(["head", "you", "img", "rhead", "noreply", "md", "codehead", "code", "more", "lhead", "latest", "stats", "legend", "copy", "seltext"]);
const PREVIEW_CHARS = 1200; // of a prompt or reply, enough for any row's line limit
const LATEST_LINES = 6;

const base = (p) => (p ?? "").split("/").pop().replace(/^-/, "");
const dirname = (p) => p.slice(0, p.lastIndexOf("/"));
const idOf = (p) => idOfFile(p);
const POLL_MS = 3000; // how often a pane on Codex, OpenCode, Pi or Cursor looks for a new session
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
    const term = Object.entries(shared(MAP_KEY) ?? {}).find(([, v]) => v.pane === pane.pane)?.[0];
    if (term && terminals().some((t) => t.address === term)) {
      // By pane id: pane.focus {terminal} prefers a layout block showing the terminal, which
      // may be outside this tab.
      const target = focusTarget(panes(), term, pane.tab);
      run("pane.focus", target ? { pane: target.pane } : { terminal: term });
    }
    return null;
  }
  if (!pane?.terminal) {
    notify({ title: "Agent Threads", body: "Focus a Claude Code, Codex, OpenCode, Pi or Cursor terminal first, then open Threads beside it.", level: "info", timeout: 4000 });
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
    return true;
  };
}

// shared("threads.byTerminal"): terminal -> its Threads pane, so the launcher focuses an
// open one instead of splitting again, and a pane knows its own id.
function remember(terminal, pane) {
  const map = { ...(shared(MAP_KEY) ?? {}) };
  for (const [k, v] of Object.entries(map)) if (!panes().some((p) => p.pane === v.pane)) delete map[k];
  map[terminal] = { pane };
  setShared(MAP_KEY, map);
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
  if (harness === "codex") return resolveCodex({ argv, pid, cwd, cmd });
  if (harness === "pi") return resolvePi({ argv, pid, cwd, cwds, cmd }, current);
  if (harness === "cursor") return resolveCursor({ argv, pid, cwd, cwds, cmd }, current);
  if (harness === "opencode") return resolveOpenCode({ argv, pid, cwd, cwds, cmd, title: info.title ?? pane?.title ?? term.title }, current);
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
  const order = () => ["program", "argv", "record", "file", "newest"].map((k) => tried[k]).filter(Boolean);
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

// A Codex process keeps its session file open, which names it exactly. Codex writes no file
// until the first prompt, so a process with none is waiting for one.
async function resolveCodex({ argv, pid, cwd, cmd }) {
  const who = { harness: "codex", claude: false, live: true, pid, cwd };
  const program = { what: "Program in pane", detail: `${cmd}${pid ? ` · pid ${pid}` : ""}`, ok: true };
  const open = pid ? await locate("codex-open", String(pid)) : null;
  const openStep = { what: "Session file the process has open", detail: open ? idOf(open).slice(0, 8) : "none yet", ok: Boolean(open) };
  if (open) return { kind: "found", id: idOf(open), file: open, via: "open file", ...who, guess: false, tried: [program, openStep] };
  const named = codexArgvSession(argv);
  if (named) {
    const file = await locate("codex-find", named);
    if (file) return { kind: "found", id: named, file, via: "argv", ...who, guess: false, tried: [program, openStep] };
  }
  const watch = await locate("codex-dir");
  return { kind: "pending", id: null, via: null, ...who, tried: [program, openStep], watch };
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
  if (!pick.id) return { kind: "pending", id: null, via: null, ...who, tried: [program, step], watch: dirname(db), choices };
  return { kind: "found", id: pick.id, file: file(pick.id), via: pick.via, ...who, guess: pick.guess, choices, tried: [program, step] };
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

// A Cursor process keeps its chat's store open, and the store's path names the chat id and the
// data folder; its transcript is written with the first reply. Without that, --resume <id>,
// else the folder's newest transcript since the process started, as for Pi.
async function resolveCursor({ argv, pid, cwd, cwds, cmd }, current) {
  const who = { harness: "cursor", claude: false, live: true, pid, cwd };
  const program = { what: "Program in pane", detail: `${cmd}${pid ? ` · pid ${pid}` : ""}`, ok: true };
  const store = pid ? cursorStore(await locate("cursor-open", String(pid))) : null;
  const openStep = { what: "Chat the process has open", detail: store ? store.id.slice(0, 8) : "none", ok: Boolean(store) };
  const data = store?.data ?? (await locate("cursor-dir")) ?? `${home()}/.cursor`;
  const named = cursorArgv(argv);
  const id = store?.id ?? named.id;
  if (id) {
    const file = await locate("cursor-find", data, id);
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

// What a session's file takes to read one chunk.
function readArgs(file, offset, chunk) {
  const h = harnessOfFile(file);
  if (h === "opencode") return [SCRIPT("opencode.sh"), "read", dbOfFile(file), idOfFile(file), String(offset), String(chunk)];
  if (h === "codex" || h === "pi" || h === "cursor") return [SCRIPT("extract.sh"), file, String(offset), String(chunk), h];
  return [SCRIPT("extract.sh"), file, String(offset), String(chunk)];
}

// ---- the panel --------------------------------------------------------------------------

export default class Threads extends View {
  init(_p, cx) {
    const p = props() ?? _p ?? {};
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
    // Tests only, with debug: a pane width to lay out for when the window does not draw
    // (a window behind another never reports its size). Never set by the launcher.
    this.forcedWidth = this.debug && Number(p?.width) > 0 ? Number(p.width) : null;
    this.sessions = []; // oldest first; a new one starts after /clear or a restart
    this.res = { kind: "resolving" };
    this.sel = null; // key of the selected turn
    this.open = new Set(); // keys of expanded turns
    this.full = new Set(); // keys showing the whole prompt ("k") or reply ("r:k")
    this.selecting = null; // the open turn whose reply shows as selectable source
    this.selEditor = null; // { key, st, text }
    this.code = new Map(); // `${key}:${i}` -> { st: EditorState, or false when it could not be made, text }
    this.copied = null; // { id, at }
    this.toast = null;
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
    if (!this.terminal) { this.res = { kind: "none", tried: [] }; return; }
    this.commands(cx);
    this.loadPrefs(cx);
    this.resolve(cx);
    // While the agent works, re-read every few seconds in case a folder event is missed.
    // While a session id has no transcript yet, look for it. Idle panes do nothing here.
    cx.timer.every(5000, (cx) => {
      if (this.status() === "working") { this.read(cx); cx.notify(); }
      if (this.res.kind === "pending" || this.res.pendingId) this.resolve(cx);
      // No folder watch for the settings (the folder could not be watched): read it here.
      if (this.prefsPoll) this.readPrefs(cx);
    });
    // The running turn's clock, once a second while one is shown.
    cx.timer.every(1000, (cx) => {
      this.watchRead(cx);
      this.poll(cx);
      this.flushCode(cx);
      if (this.liveShown && ["working", "blocked"].includes(this.status())) cx.notify();
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
      renders: this.renders ?? 0, me: this.myPane ?? null, props: Object.keys(props() ?? {}),
      header: this.headerText(),
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
      headerButtons: this.headerButtons().map((b) => `${b[0]}${b[5] != null ? `(${b[5]})` : ""}${b[4] ? ":on" : ""}|${b[2]}`),
      headerLayout: this.headerLayout(), badgeTip: this.badgeTip(),
      settings: this.prefs, settingsError: this.prefsError, settingsOpen: this.settingsOpen, settingsFile: this.prefsRaw,
      settingsPath: tilde(this.prefsPath()), settingsPoll: Boolean(this.prefsPoll),
      footer: this.footerHints().map(([k, l]) => `${k} ${l}`),
      lastFocus: this.lastFocus, lastBarHit: this.lastBarHit ?? null, barGeom: this.barGeom(),
      toast: this.toast?.text ?? null,
      contrast: this.contrastList(),
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
    const who = r.turn?.agent ? ` agent:${r.turn.sender.kind}:${r.turn.sender.name ?? ""} lw${this.labelRoom(r.turn, rowTextWidth(this.width, true))}` : "";
    switch (r.kind) {
      case "turn": case "wrow": {
        const sh = r.shape;
        const pl = sh.kinds ? sh.prompt.map((l, i) => (sh.kinds[i] === "c" ? l : `▎${l}`)) : sh.prompt;
        return `${r.kind}${n} p${sh.p}/r${sh.r}${sh.q ? ` q${sh.q}` : ""}${sh.kinds?.[0] === "qonly" ? " qonly" : ""} h${sh.height}${sh.cmd ? ` cmd:${sh.cmd.name}` : ""}${who} | ${this.metaText(r.turn, r.kind === "wrow")} | ${sh.chip ? `[${sh.chip.label}] ` : ""}${pl.join(" ⏎ ")} | ${sh.reply.join(" ⏎ ")}`;
      }
      case "head": return `head${n}${who} | ${[when(r.turn.ts), fmtDuration(r.turn.durationMs)].filter(Boolean).join(" · ")}`;
      case "you": {
        const y = this.youMd(r);
        return `you${n} ${this.youLabel(r.turn)} ${y.hl ? "hl" : "md"} q${y.quotes} code${y.code} links${y.links}${y.more ? ` +${y.more}` : ""} h${this.height(r)}${y.hl ? "" : ` | ${y.md.replace(/\n/g, " ⏎ ").slice(0, 300)}`}`;
      }
      case "md": return `md${n} links ${r.links ?? 0} h${this.height(r)}${r.links ? ` | ${(r.md.match(/\]\(https?:[^)]+\)/g) ?? []).join(" ")}` : ""}`;
      case "rhead": return `rhead${n} FINAL REPLY${this.captionParts(r.turn).map(([i, x]) => ` · ${i} ${x}`).join("")} h${this.height(r)}`;
      case "lhead": return `lhead${n} LATEST UPDATE · after ${plural(r.turn.followups, "background update")}`;
      case "latest": return `latest${n} ${r.md ? "all" : `box ${this.latestBox(r)}${this.latestCut(r) ? " +Show all" : ""}`} h${this.height(r)} | ${(r.md ?? r.text).slice(0, 300)}`;
      case "stats": return `stats${n} ${this.statTexts(r.turn).join(" · ")}${this.countsLine(r.turn) ? ` | ${this.countsLine(r.turn)}` : ""} h${this.height(r)}`;
      case "legend": return `legend${n} ${this.legendEntries(r.turn).map(([, x]) => x.split(":")[0]).join(" · ")} h${this.height(r)}`;
      case "seltext": return `seltext${n} lines ${r.lines} h${this.height(r)} editor:${this.selEditor?.st ? "yes" : "no"} border:${this.selecting ? "accent" : "border"} | ${this.selectHint()}`;
      case "copy": {
        const L = this.bar(r.turn);
        const b = (on, label, icon) => (on ? label : `[${icon} icon]`);
        return `copy${n} ${L.labels.copy} + ${b(L.labels.select, this.selecting === `${r.si}:${r.turn.n}` ? "Formatted" : "Select", "select")}${L.quote ? ` + ${b(L.labels.quote, "Quote", "quote")}` : ""}${L.terminal ? ` + ${b(L.labels.terminal, "Terminal", "terminal")}` : ""}`;
      }
      case "day": return `day ${r.name}${r.date ? ` ${r.date}` : ""} · ${plural(r.count, "turn")}`;
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
    // The launcher (an overlay) returns from init() before any of this exists.
    if (this.launcher) return;
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
    // Hiding agent turns: a hidden selected turn hands the selection to the turn before it.
    if (was.agentTurns && !values.agentTurns) this.reselect = true;
  }

  // Changes settings from the panel, keys or commands: applied now, then written. A save
  // that finds the file changed meanwhile reads it again and applies the change on top.
  changePrefs(patch, cx) {
    const next = parseSettings(JSON.stringify({ ...this.prefs, ...patch })).values;
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

  // ---- data ----

  current() { return this.sessions[this.sessions.length - 1] ?? null; }
  term() { return terminals().find((t) => t.address === this.terminal); }
  pane() { return panes().find((p) => p.terminal === this.terminal); }
  me() {
    const own = props()?.pane ?? this.myPane;
    if (own) return panes().find((p) => p.pane === own) ?? null;
    const known = shared(MAP_KEY)?.[this.terminal];
    const mine = known ? panes().find((p) => p.pane === known.pane) : null;
    if (mine) return mine;
    // Opened some other way (props() carries no pane id): the only Threads pane in the
    // terminal's tab that no other terminal has claimed is this one.
    const tab = this.pane()?.tab;
    const claimed = new Set(Object.entries(shared(MAP_KEY) ?? {}).filter(([t]) => t !== this.terminal).map(([, v]) => v.pane));
    const here = panes().filter((p) => p.mod === MOD && p.tab === tab && !claimed.has(p.pane));
    if (here.length === 1) return here[0];
    const anywhere = panes().filter((p) => p.mod === MOD && !claimed.has(p.pane));
    return anywhere.length === 1 ? anywhere[0] : null;
  }
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
      // A Codex, OpenCode, Pi or Cursor process that has written nothing yet says so only by not having
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
          if ((s.turns.length !== count || !this.sel) && this.follow) this.jumpLatest(true);
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
    if (shared(MAP_KEY)?.[this.terminal]?.pane !== mine) cx.timer.after(0, () => remember(this.terminal, mine));
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

  // Codex, OpenCode, Pi and Cursor report no status here and name a new session (/new) nowhere the pane is
  // told about, so a pane on one of them looks again every few seconds while it runs.
  lookPolled() {
    if (this.pinned || !this.res?.live || !["codex", "opencode", "pi", "cursor"].includes(this.res.harness)) return false;
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
      [...this.open].join(","), [...this.full].join(","), this.filterText(), status,
      Math.round(this.width), Math.round(this.listH), Boolean(this.res.ended),
      `${P.promptLines}.${P.replyLines}.${P.agentTurns ? 1 : 0}`, this.selecting ?? "",
      this.linksVer, this.remote.repo ?? "", this.legendOn ? 1 : 0, this.imgVer ?? 0,
    ].join("|");
    if (this.rowsKey !== key || !this.baseRows) {
      this.baseRows = this.buildRows(status);
      this.baseSizes = this.baseRows.map((r) => this.height(r));
      this.baseIndex = new Map(this.baseRows.map((r, i) => [r.key, i]));
      this.probeRows = this.baseRows.filter((r) => PROBED.has(r.kind));
      this.rowsKey = key;
      this.fitKey = null;
      // The selection is on a turn the list no longer shows: agent turns were hidden, or a
      // hidden agent turn that showed while it was live has finished.
      if (this.reselect || this.selHidden()) this.reselectVisible();
    }
    // Only the running turn depends on the selection (one-line row, or the card when
    // selected), and it is always the last item, so moving the selection rebuilds nothing.
    const li = this.baseRows.length - 1;
    const lr = this.baseRows[li];
    if (lr?.live) {
      const kind = this.sel === lr.key ? "working" : "wrow";
      if (lr.kind !== kind) { lr.kind = kind; this.baseSizes[li] = this.height(lr); this.fitKey = null; }
    }
    const z = this.zoom();
    const fit = `${key}|${lr?.kind}|${z}|${this.sizesVer ?? 0}`;
    if (this.fitKey !== fit) {
      let rows = this.baseRows;
      let sizes = this.baseSizes;
      // A short list sits at the bottom, by the newest turn, like the chat.
      const total = sizes.reduce((x, y) => x + y, 0);
      if (this.listH > 0 && rows.length && total < this.listH - 1) {
        rows = [{ kind: "spacer", key: "spacer", h: this.listH - total }, ...rows];
        sizes = [this.listH - total, ...sizes];
      }
      this.rowsMemo = rows;
      this.sizesMemo = sizes;
      // What the list is given: whole design px. v_virtual_list scales item sizes by zoom
      // itself, as it scales what an item draws, so a slot of h design px holds h design px
      // at any zoom (seen in a drawn window at zoom 0.9: a 73 px row took 73 x 0.9 zoomed px).
      this.slotsMemo = sizes.map((h) => Math.ceil(h));
      this.fitKey = fit;
      this.liveShown = Boolean(lr?.live);
    }
    return this.rowsMemo;
  }

  // Whether turn ti of session si is the live newest turn (Working or Needs you).
  isLive(s, si, ti, status) {
    const turn = s.turns[ti];
    return si === this.sessions.length - 1 && ti === s.turns.length - 1 && (!turn.done || (s.followActive && status === "working"));
  }

  buildRows(status) {
    const out = [];
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
        if (!shown(turn, ti)) return;
        if (q && !matches(turn, q)) { unmatched++; return; }
        flush();
        const d = turn.day;
        if (days.size > 1 && !q && d && d !== day) {
          day = d;
          const r = days.get(d);
          out.push({ kind: "day", key: `day:${si}:${d}`, ...dayParts(r.ts), count: r.count });
        }
        const last = si === this.sessions.length - 1 && ti === s.turns.length - 1;
        const live = this.isLive(s, si, ti, status);
        const item = { kind: "turn", key, turn, s, si, last, live };
        if (live) out.push({ ...item, kind: "wrow", shape: this.shape(turn, true) });
        else if (this.open.has(key)) this.expanded(item, out);
        else out.push({ ...item, shape: this.shape(turn) });
      });
      flush();
    });
    return out;
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
    const key = `${Math.round(this.width)}|${P.promptLines}|${P.replyLines}|${q}|${turn.prompt.length}|${text.length}|${why ? 1 : 0}|${live ? 1 : 0}|${turn.answeredBy}|${turn.answeredBy && this.prefs.agentTurns ? 1 : 0}|${turn.images?.length ?? 0}`;
    if (turn.shapeKey === key) return turn.shapeMemo;
    const cmd = commandParts(turn);
    const src = (t) => (q ? around(t.replace(/\s+/g, " "), q) : t).slice(0, PREVIEW_CHARS);
    let preview;
    let tone = "reply";
    if (live) { preview = ""; tone = "live"; }
    else if (why) { preview = why; tone = "why"; }
    else if (text) preview = src(q ? flattenMd(text.slice(0, PREVIEW_CHARS * 2)) : flattenMd(text, Math.min(PREVIEW_CHARS, (P.replyLines + 1) * Math.ceil(Math.max(this.width || 0, 120) / 5))));
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
      quotes: !q,
    });
    sh.tone = tone;
    sh.cmd = cmd;
    // Pasted images: a strip of thumbnails under the prompt from 300 px; narrower, the count
    // in the meta line says they are there.
    if (turn.images?.length && !this.narrow()) { sh.thumbs = true; sh.height += THUMB_H + 3; }
    turn.shapeKey = key;
    turn.shapeMemo = sh;
    return sh;
  }

  // One expanded turn becomes several list items, so each clickable part has its own key
  // (a virtual list allows one click handler, on the list, reporting the item key).
  expanded(item, out) {
    const { key, turn } = item;
    out.push({ ...item, kind: "head", part: "top" });
    out.push({ ...item, kind: "you", key: `you:${key}`, full: this.full.has(key) });
    (turn.images ?? []).forEach((_, i) => out.push({ ...item, kind: "img", key: `img:${key}:${i}`, i, full: this.full.has(`i:${key}:${i}`) }));
    const text = this.replyText(turn);
    out.push({ ...item, kind: "rhead", key: `rhead:${key}` });
    if (!text) out.push({ ...item, kind: "noreply", key: `nr:${key}` });
    const whole = this.full.has(`r:${key}`);
    let used = 0;
    let cut = false;
    let long = false;
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
    if (!selecting) segs.forEach((seg, i) => {
      if (cut) return;
      if (used > REPLY_BUDGET) { long = true; if (!whole) { cut = true; return; } }
      if (seg.kind === "md") {
        let md = seg.text;
        if (used + md.length > REPLY_BUDGET * 1.4) {
          long = true;
          if (!whole) {
            md = `${md.slice(0, Math.max(200, REPLY_BUDGET - used)).replace(/\s+\S*$/, "")} …`;
            cut = true;
          }
        }
        used += md.length;
        // Link rules (settings.json links) on the text shown; heights use the text as written.
        const lk = linked?.[i] && md === seg.text ? linked[i] : this.linkOne(md);
        out.push({ ...item, kind: "md", key: `md:${key}:${i}`, md: lk.md, src: md, links: lk.links });
      } else {
        used += Math.min(seg.text.length, 400);
        out.push({ ...item, kind: "codehead", key: `cc:${key}:${i}`, seg, i });
        out.push({ ...item, kind: "code", key: `code:${key}:${i}`, seg, i, ...this.codeShape(seg.text) });
      }
    });
    if (selecting) { /* the source view scrolls; nothing more to show */ }
    else if (cut) out.push({ ...item, kind: "more", key: `more:${key}`, words: text.split(/\s+/).length });
    else if (whole && long) out.push({ ...item, kind: "more", key: `more:${key}`, less: true });
    // What the agent said in its last background update, when that is not the reply.
    const late = (turn.latest ?? "").trim();
    if (late && late !== text) {
      const all = this.full.has(`l:${key}`);
      // One block that gpui wraps at the card's width (C5); the estimate counts lines only
      // until the probe has measured it.
      const text = flattenMd(late.slice(0, 4000));
      const l = rowLines(text, LATEST_LINES + 1, this.inner() / MD_CHAR);
      out.push({ ...item, kind: "lhead", key: `lh:${key}` });
      out.push({ ...item, kind: "latest", key: `lt:${key}`, all, text, estLines: l.lines.length + (l.cut ? 1 : 0), md: all ? late.slice(0, 12000) : null });
    }
    out.push({ ...item, kind: "stats", key: `st:${key}` });
    if (this.legendOn) out.push({ ...item, kind: "legend", key: `lg:${key}` });
    out.push({ ...item, kind: "copy", key: `cp:${key}`, part: "bottom" });
  }

  // Lines shown, whether it scrolls sideways, and whether it gets a caption.
  // A code block's box: its lines, 6 px above and below the editor's text, its bottom
  // border, and room for a horizontal scrollbar when a line is wider than the box.
  codeBoxH(r) { return r.shown * CODE_LINE + 16 + (r.wide ? 10 : 0); }

  codeShape(text) {
    const lines = text.split("\n");
    const widest = lines.reduce((m, l) => Math.max(m, l.length), 0);
    const wide = widest * 7.3 > this.inner() - 16;
    return { lines: lines.length, shown: Math.min(CODE_LINES, lines.length), wide, caption: lines.length > CODE_LINES || wide };
  }

  turnKeys(rows) { return rows.filter((r) => ["turn", "head", "working", "wrow"].includes(r.kind)).map((r) => r.key); }

  // The hidden agent turn whose reply this turn shares: Claude answered the person's prompt
  // and an agent message that came while it was open in one reply, which landed on the
  // agent turn. While agent turns are hidden the person's row borrows that reply, so it
  // still shows one and "c" copies it.
  borrowedFrom(turn) {
    if (!turn?.answeredBy || turn.after.length || this.prefs.agentTurns) return null;
    const s = this.sessions.find((x) => x.turns[turn.n - 1] === turn);
    const by = s?.turns[turn.answeredBy - 1];
    return by?.agent && reply(by) ? by : null;
  }

  // The reply a row shows, opens and copies.
  replyText(turn) {
    const by = this.borrowedFrom(turn);
    return by ? reply(by) : reply(turn);
  }
  findTurn(key) {
    const [si, n] = key.split(":").map(Number);
    return this.sessions[si]?.turns[n - 1] ?? null;
  }

  // ---- actions ----

  // Selects the newest turn (when asked, or when nothing is selected) and scrolls to it on
  // the next render, once the list holds the new rows.
  jumpLatest(select = true) {
    this.follow = true;
    const keys = this.turnKeys(this.rows());
    if ((select || !this.sel) && keys.length) this.sel = keys[keys.length - 1];
    this.toBottom = true;
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

  // An open card's image box, in design px: the image at the card's text width or its own
  // size (never enlarged), at most IMG_MAX_H tall, or IMG_FULL_H once clicked.
  imgBox(r) {
    const w = this.inner();
    const f = this.imgFile(r.turn, r.i);
    if (!f) return { w, h: this.imgState(r.turn) === "wait" ? 120 : 44 };
    if (!(f.w > 0 && f.h > 0)) return { w, h: r.full ? 600 : 200 };
    const natural = Math.min(f.h, (f.h * w) / f.w);
    const h = Math.max(24, Math.round(Math.min(natural, r.full ? IMG_FULL_H : IMG_MAX_H)));
    return { w: Math.min(w, Math.round((h * f.w) / f.h)), h };
  }

  // A collapsed row's thumbnails: as many 64 x 40 boxes as fit, then "+N".
  thumbStrip(t, turn, key) {
    this.wantImages(turn, key);
    const room = rowTextWidth(this.width, turn.agent);
    const fit = Math.max(1, Math.floor((room + 4) / (THUMB_W + 4)));
    const n = turn.images.length;
    const shown = n > fit ? Math.max(1, fit - 1) : n;
    return h_flex().h(THUMB_H).gap(4).items_center().overflow_hidden()
      .children(turn.images.slice(0, shown).map((_, i) => {
        const f = this.imgFile(turn, i);
        return div().flex_none().w(THUMB_W).h(THUMB_H).rounded(5).overflow_hidden().border_1().border_color(t.border).bg(t.background)
          .when(Boolean(f), (el) => el.child(image(f.path).size_full()))
          .when(!f, (el) => el.flex().items_center().justify_center().child(svg(ICON("image")).size(14).text_color(t.dim)));
      }))
      .when(n > shown, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(`+${n - shown}`)));
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
          language: langFor(seg.lang), value: seg.text, readonly: true, line_numbers: false, folding: false, soft_wrap: false,
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
    // Quote in the action bar in Select view: quote what ⌘C copied, and leave the keyboard
    // with the editor so its highlight stays.
    if (kind === "cp") this.clipAtPress = this.clipBefore;
    if (kind === "cp" && this.selecting === id) {
      const hit = this.barHit(this.pressX ?? this.mouseX, this.bodyW ?? this.width, this.findTurn(id));
      if (hit === "quote") { this.pressX = null; this.lastBarHit = { hit }; this.quote(cx, "button", id); return cx.notify(); }
    }
    this.h.focus();
    // The panel has the keyboard again, even if an editor's blur event was missed.
    this.editorFocused = false;
    if (/^\d+$/.test(kind)) return this.toggle(key, cx);
    // A click on an image in an open card shows it at the card's full width, or back.
    if (kind === "img") {
      const k = `i:${id}`;
      this.full.has(k) ? this.full.delete(k) : this.full.add(k);
      this.sel = rest.slice(0, 2).join(":");
      return cx.notify();
    }
    if (kind === "you") { this.full.has(id) ? this.full.delete(id) : this.full.add(id); this.sel = id; return cx.notify(); }
    if (kind === "more") { const k = `r:${id}`; this.full.has(k) ? this.full.delete(k) : this.full.add(k); this.sel = id; return cx.notify(); }
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
      // The action bar is one list item: Copy reply on the left, Terminal on the right. A
      // list item takes one click handler, so the press position tells them apart, and a
      // press between the two buttons does nothing.
      const x = this.pressX ?? this.mouseX;
      const w = this.bodyW ?? this.width;
      this.pressX = null;
      const hit = this.barHit(x, w, this.findTurn(id));
      this.lastBarHit = { x: x == null ? null : Math.round(x), w: Math.round(w), hit };
      if (hit === "terminal" && this.pane()) return this.focusTerminal(cx);
      if (hit === "copy") return this.copyReply(id, cx);
      if (hit === "select") return this.toggleSelect(id, cx);
      if (hit === "quote") { this.sel = id; this.quote(cx, "button", id); return cx.notify(); }
      return;
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
    // The stats part ends in an info chip: a click on it shows or hides what the chips mean.
    if (kind === "st") { this.legendOn = !this.legendOn; this.sel = id; return cx.notify(); }
    if (["rhead", "md", "nr", "code", "lh", "sx", "lg"].includes(kind)) { this.sel = rest.slice(0, 2).join(":"); return cx.notify(); }
  }

  // The action bar's buttons, from the left edge of the list (ui.js barLayout): Copy reply,
  // Select and Quote start after the list margin, border and card padding (16 px);
  // Terminal ends 16 px before the right. Quote shows when a pane shows a terminal on this
  // computer and the turn has a reply; Terminal when a pane shows the terminal.
  bar(turn, w = this.width) {
    const pane = Boolean(this.pane());
    const quote = pane && !this.terminal.includes("/") && Boolean(turn && this.replyText(turn));
    return barLayout(w, { quote, terminal: pane });
  }
  barGeom(w = this.width, turn = this.sel ? this.findTurn(this.sel) : null) {
    const L = this.bar(turn, w);
    return { copy: L.copy, select: L.select, quote: L.quote, terminal: L.terminal };
  }
  barHit(x, w, turn = this.sel ? this.findTurn(this.sel) : null) {
    if (x == null) return "copy"; // a keyboard or synthetic press
    const g = this.barGeom(w, turn);
    const inside = (b) => b && x >= b[0] - 2 && x <= b[1] + 2;
    if (inside(g.copy)) return "copy";
    if (inside(g.select)) return "select";
    if (inside(g.quote)) return "quote";
    if (inside(g.terminal)) return "terminal";
    return null;
  }

  // Keys while the panel has the keyboard. The same actions are commands for keys.json
  // ("agent-threads.next" and so on), delivered through nextCommand().
  key(e, cx) {
    // ⌘C in Select view: the editor copies the highlight with its own binding, and the
    // panel says that q now quotes it.
    if (this.selecting && e.keystroke === "cmd-c") this.sawCopy(this.selecting, cx);
    const name = keyAction(e, this.filtering, this.quoteKey);
    // While the Select view's or a code block's editor has the keyboard, its keys are its
    // own (moving the turn selection would leave the text being selected). Esc, s and the
    // quote key still act.
    if (this.editorFocused && name && !["escape", "select", "quote"].includes(name)) return;
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
      case "copy": if (this.sel) this.copyReply(this.sel, cx); return true;
      case "select": {
        // In Select view, s returns to the formatted reply of the turn being selected, even
        // after the selection moved to another turn.
        if (this.selecting) { this.endSelect(); return true; }
        if (this.sel && this.findTurn(this.sel)) this.toggleSelect(this.sel, cx);
        return true;
      }
      case "focus": this.focusTerminal(cx); return true;
      // What the stat chips mean, under every open card's stats, for this pane's session.
      case "legend": this.legendOn = !this.legendOn; return true;
      case "filter": this.filtering = true; this.settingsOpen = false; this.input.focus(); return true;
      case "agents": this.setAgents(!this.prefs.agentTurns, cx); return true;
      case "agents:on": this.setAgents(true, cx); return true;
      case "agents:off": this.setAgents(false, cx); return true;
      case "settings": this.settingsOpen = !this.settingsOpen; if (this.settingsOpen) this.filtering = false; return true;
      case "resetSettings": this.changePrefs({ promptLines: DEFAULTS.promptLines, replyLines: DEFAULTS.replyLines }, cx); return true;
      case "escape":
        if (this.settingsOpen) { this.settingsOpen = false; return true; }
        if (this.choosing) { this.choosing = false; return true; }
        if (this.selecting) { this.endSelect(); return true; }
        if (this.filtering || this.query) { this.input.set_value(""); this.query = ""; this.filtering = false; this.h.focus(); return true; }
        if (this.sel && this.open.has(this.sel)) { this.toggle(this.sel, cx); return true; }
        return false;
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
    // "promptLines:+", "replyLines:-", "promptLines:4".
    const m = name.match(/^(promptLines|replyLines):([+-]|\d+)$/);
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
        if (focusedOne ? me?.pane === focusedOne.pane : threads.length === 1 || !me) {
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

  // ---- drawing ----

  render(cx) {
    if (this.launcher) return div();
    this.renders = (this.renders ?? 0) + 1;
    this.react(cx);
    const t = theme();
    const focusedPanel = this.h.is_focused() || this.input && this.filtering;
    if (this.debug) this.measure();
    return v_flex()
      .id("threads-root")
      .track_focus(this.h)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_modifiers_changed((e, cx) => this.cmdUp(e, cx))
      // Zoomed px from on_size_change, design px everywhere else (zoom()).
      .on_size_change((size, cx) => {
        const w = size.width / this.zoom();
        this.measuredWidth = size.width;
        if (!this.forcedWidth && Math.abs(w - this.width) > 1) { this.width = w; cx.notify(); }
      })
      .size_full().min_h(0).relative()
      .bg(t.background).text_color(t.foreground).text_size(13)
      .child(this.header(t))
      .children(this.banners(t))
      .child(this.body(t, focusedPanel, cx))
      .child(this.footer(t))
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
  // Herdr's zoom (settings.json, 0.5 to 3). It scales every length the panel draws, the item
  // sizes given to v_virtual_list included, while on_size_change and mouse positions come in
  // zoomed px. So the panel works in design px (as AGENTS.md says to write sizes), divides
  // what it measures by zoom, and hands the list design px (rows()).
  zoom() {
    const z = Number(settings()?.zoom);
    return Number.isFinite(z) && z > 0 ? Math.min(3, Math.max(0.5, z)) : 1;
  }
  mono() { return settings().font_family ?? "JetBrains Mono"; }

  iconButton(t, id, icon, tip, onClick, on = false, count = null) {
    return div().id(id).flex_none().size(24).flex().items_center().justify_center().rounded(5).cursor_pointer().relative()
      .text_color(on ? t.foreground : t.dim).when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_click((e, cx) => { cx.stop_propagation(); onClick(e, cx); })
      .child(svg(ICON(icon)).size(14))
      // A count at the corner (the Agents button: hidden or shown agent messages).
      .when(count != null, (el) => el.child(div().absolute().top(-3).right(-5).h(13).px(3).rounded(7)
        .flex().items_center().bg(on ? t.ansi5 : t.raised).border_1().border_color(on ? t.ansi5 : t.border)
        .text_size(9).font_semibold().text_color(on ? t.background : t.muted).child(count)));
  }

  // The header's buttons, left to right after the text, as data: [id, icon, tip, action, on, count].
  headerButtons() {
    const c = this.counts();
    const showAgents = c.agentAll > 0 || this.prefs.agentTurns;
    const out = [["th-search", "search", "Filter (/)", "filterToggle", this.filtering || Boolean(this.query), null]];
    if (showAgents) {
      const on = Boolean(this.prefs.agentTurns);
      out.push(["th-agents", "bot", on ? "Hide agent messages (a)" : `Show agent messages (${c.hiddenAll.toLocaleString()} hidden) (a)`, "agents", on,
        countLabel(on ? c.agentAll : c.hiddenAll)]);
    }
    out.push(["th-latest", "chevrons-down", "Jump to latest (End)", "latest", false, null]);
    out.push(["th-settings", "sliders-horizontal", "Settings (,)", "settings", this.settingsOpen, null]);
    return out;
  }

  // Estimated header layout at the pane width (no window has to draw to read it): the
  // badge, the room left for the text, and the buttons, inside 10 px padding and 8 px gaps.
  headerLayout() {
    const buttons = this.headerButtons().length;
    const badge = this.res.kind === "unsupported" || this.res.kind === "remote" ? 90 : this.narrow() ? 28 : 28 + 5 + 38;
    const text = Math.round(this.width - 20 - badge - 8 - buttons * (24 + 8));
    return { width: Math.round(this.width), badge, text, buttons, rightGutter: 10 };
  }

  badge(t) {
    // Another agent (frame 03 "Harness not supported"), or a terminal on another machine:
    // a neutral chip with its name instead of the Claude mark.
    const agent = this.agent();
    const other = this.res.kind === "unsupported" ? this.res.name
      : this.res.kind === "remote" ? (this.terminal ?? "").split("/")[0]
        : agent.key !== "claude" ? agent.name : null;
    if (other) return h_flex().id("th-badge").flex_none().gap(5).h(22).px(6).items_center().rounded(5).border_1().border_color(t.border)
      .when(this.res.kind !== "unsupported" && this.res.kind !== "remote", (el) => el.tooltip(this.badgeTip())
        .child(svg(ICON("square-terminal")).size(13).text_color(t.muted)))
      .when(this.res.kind === "remote", (el) => el.child(svg(ICON("cpu")).size(12).text_color(t.muted)))
      .child(div().max_w(120).truncate().text_size(12).text_color(t.foreground).child(other));
    return h_flex().id("th-badge").flex_none().gap(5).h(22).px(6).items_center().rounded(5).border_1().border_color(t.border)
      .tooltip(this.badgeTip())
      .child(div().flex_none().size(14).rounded(3).bg(CLAUDE).flex().items_center().justify_center()
        .child(svg(ICON("claude-mark")).size(10).text_color("#ffffff")))
      .when(!this.narrow(), (el) => el.child(div().text_size(12).text_color(t.foreground).child("Claude")));
  }

  // "Reading t4 · session 7f3a1b2c · 1.2M tokens · cache 97.1%": which terminal and
  // session the pane is bound to, so a wrong binding shows without a click.
  badgeTip() {
    const s = this.current();
    if (!s) return `Reading ${this.terminal ?? "no terminal"}`;
    let input = 0, output = 0, cr = 0, cc = 0;
    for (const t of s.turns) for (const u of Object.values(t.usage)) { input += u.i ?? 0; output += u.o ?? 0; cr += u.cr ?? 0; cc += u.cc ?? 0; }
    const pct = cachePct(cr, input + cc + cr);
    // The selected turn's own cache counts too (its chip in the card cannot carry a tooltip).
    const sel = this.sel ? this.findTurn(this.sel) : null;
    const st = sel ? stats(sel) : null;
    return [`Reading ${this.terminal} · session ${s.id.slice(0, 8)}`, `${fmtTokens(input + cc + output)} tokens`,
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
    const c = this.counts();
    // "98 turns · 43 hidden": the newest session's shown turns, then the agent messages
    // hidden in the whole list, the same number as the Agents button's count and tooltip
    // (from 300 px; below that only the button's count says it).
    return [plural(c.shownCur, "turn"), c.hiddenAll && !this.narrow() ? `· ${c.hiddenAll.toLocaleString()} hidden` : "",
      s.title ? `· ${s.title}` : "", this.res.guess ? "· guessed" : ""].filter(Boolean).join(" ");
  }

  header(t) {
    const q = this.query.trim();
    return v_flex().flex_none().border_b(1).border_color(t.border)
      .child(h_flex().h(40).px(10).gap(8).items_center()
        .child(this.badge(t))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.muted).child(this.headerText()))
        .when(this.debug && Boolean(this.timing) && !this.narrow(), (el) => el.child(div().flex_none().max_w(160).truncate().text_size(10.5).font_family(this.mono()).text_color(t.dim).child(this.timing)))
        .children(this.headerButtons().map(([id, icon, tip, act, on, count]) => this.iconButton(t, id, icon, tip, (_e, cx) => {
          if (act === "filterToggle") {
            this.filtering = !this.filtering;
            this.settingsOpen = false;
            if (this.filtering) this.input.focus();
            else { this.input.set_value(""); this.query = ""; this.h.focus(); }
          } else this.action(act, cx);
          cx.notify();
        }, on, count))))
      .when(this.settingsOpen, (el) => el.child(this.settingsPanel(t)))
      .when(this.filtering || Boolean(this.query), (el) => el.child(h_flex().mx(10).mb(8).h(30).px(8).gap(6).items_center().rounded(7)
        .border_1().border_color(this.filtering ? t.accent : t.border).bg(t.chrome)
        .child(svg(ICON("search")).size(13).flex_none().text_color(t.dim))
        .child(Input.new(this.input).flex_1().min_w(0).h_full().text_size(12.5).text_color(t.foreground))
        .when(!q, (el) => el.child(this.kbd(t, "/")))
        .when(Boolean(q), (el) => el.child(div().flex_none().text_size(11.5).font_family(this.mono()).text_color(t.dim)
          .child(this.filterCount())))
        .child(this.iconButton(t, "th-clear", "x", "Clear (Esc)", (_e, cx) => { this.input.set_value(""); this.query = ""; this.filtering = false; this.h.focus(); cx.notify(); }))));
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
      const m = matches(t, q);
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
    const on = Boolean(P.agentTurns);
    const sw = div().flex_none().w(28).h(16).rounded(8).p(2).flex().items_center()
      .when(on, (el) => el.justify_end()).bg(on ? t.ansi5 : t.border)
      .child(div().size(12).rounded(6).bg(on ? t.background : t.muted));
    const path = tilde(this.prefsPath());
    return v_flex().mx(10).mb(8).p(10).gap(8).rounded(7).border_1().border_color(t.border).bg(t.chrome)
      .child(h_flex().id("th-set-agents").gap(6).items_center().cursor_pointer()
        .on_click((_e, cx) => { cx.stop_propagation(); this.action("agents", cx); cx.notify(); })
        .child(svg(ICON("bot")).size(13).flex_none().text_color(t.muted))
        .child(label("Agent messages"))
        .child(sw))
      .child(stepper("promptLines", "Prompt lines"))
      .child(stepper("replyLines", "Reply lines"))
      .child(div().text_size(11.5).text_color(t.dim).child("Collapsed rows only. Changes apply now."))
      .when(Boolean(this.prefsError), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(this.prefsError)))
      // quoteKey and links are edited in the file; the panel says what it read.
      .child(div().text_size(11.5).text_color(t.muted).child(this.settingsLine()))
      .children(this.prefsNotes.slice(0, 4).map((n) => div().text_size(11.5).text_color(t.blocked).child(n)))
      .when(this.prefsNotes.length > 4, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(`and ${this.prefsNotes.length - 4} more notes`)))
      .child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).overflow_hidden().whitespace_nowrap().text_ellipsis_start().text_size(11).font_family(mono).text_color(t.dim).child(path))
        .child(this.button(t, "th-set-copy", this.narrow() ? "Copy" : "Copy path", (_e, cx) => { this.copy(this.prefsPath(), "settings-path", "Settings path copied", cx); }, "copy")))
      .child(h_flex().gap(6)
        .child(this.button(t, "th-set-reset", `Reset to ${DEFAULTS.promptLines} / ${DEFAULTS.replyLines}`, (_e, cx) => { this.action("resetSettings", cx); cx.notify(); }, "refresh")));
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
    if (r.kind === "unsupported") return this.empty(t, "messages", `${r.name} isn't supported yet`, "Threads reads Claude Code, Codex, OpenCode, Pi and Cursor sessions. Other terminal panes are left alone.", null,
      [h_flex().h(22).px(7).gap(5).items_center().rounded(5).border_1().border_color(t.border).text_size(11.5).text_color(t.muted)
        .child(div().flex_none().size(12).rounded(3).bg(CLAUDE).flex().items_center().justify_center().child(svg(ICON("claude-mark")).size(8).text_color("#ffffff")))
        .child("Claude Code"),
      ...[HARNESS.codex, HARNESS.opencode, HARNESS.pi, HARNESS.cursor].map((h) => h_flex().h(22).px(7).gap(5).items_center().rounded(5).border_1().border_color(t.border).text_size(11.5).text_color(t.muted)
        .child(svg(ICON("square-terminal")).size(12).flex_none())
        .child(h.name))]);
    if (r.kind === "gone" && !s) return this.empty(t, "circle-x", "Terminal closed", `${this.terminal} is gone, and nothing was read from it.`, null, this.closeButtons(t));
    if (r.kind === "error" && !s) return this.empty(t, "alert", "Something went wrong", r.error);
    if (r.kind === "none" && !s) return this.notFound(t, r);
    const noTurns = () => this.empty(t, "messages", "No turns yet", `Send a prompt to ${this.agent().cmd} in ${this.terminal}. Each prompt and its final reply will show up here.`, "Threads only reads the session. It never types into the terminal.");
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
    this.flushCode(cx);
    this.flushImages(cx);
    // Scrolls wait until this frame has laid the list out with its new rows.
    if (this.toBottom && rows.length) {
      this.toBottom = false;
      this.scrollTo = null;
      cx.timer.after(16, (cx) => { this.scroll.scroll_to_bottom(); cx.notify(); });
    } else if (this.scrollTo) {
      const i = rows.findIndex((x) => x.key === this.scrollTo.key);
      const how = this.scrollTo.how;
      this.scrollTo = null;
      if (i >= 0 && how === "card") {
        // The card's last part to the near edge, then its head: a card that fits ends up
        // wholly on screen, and a taller one shows from its head down.
        let j = i;
        while (j + 1 < rows.length && CARD.has(rows[j + 1].kind) && rows[j + 1].kind !== "head") j++;
        cx.timer.after(16, (cx) => { this.scroll.scroll_to_item(j, "top"); cx.notify(); });
        cx.timer.after(48, (cx) => { this.scroll.scroll_to_item(i, "top"); cx.notify(); });
      } else if (i >= 0) cx.timer.after(16, (cx) => { this.scroll.scroll_to_item(i, how); cx.notify(); });
    }
    const dim = Boolean(this.res.ended);
    return div().id("threads-body").flex_1().min_h(0).relative()
      .on_size_change((size, cx) => { const h = size.height / this.zoom(); if (Math.abs(h - this.listH) > 1) { this.listH = h; cx.notify(); } })
      .on_mouse_move((e) => { const x = e.local_position?.x; this.mouseX = x == null ? null : x / this.zoom(); })
      // Where the press landed, for the action bar (a list item takes one click handler,
      // so its parts are told apart by position), in design px.
      .on_mouse_down("left", (e, cx) => {
        const x = e.local_position?.x;
        const w = e.bounds?.width;
        this.pressX = x == null ? null : x / this.zoom();
        this.bodyW = w == null ? null : w / this.zoom();
        this.notePress(cx);
      })
      .when(Boolean(s && !s.loaded && !s.error), (el) => el.child(this.progress(t, s)))
      .child(v_virtual_list("threads-list", rows.length, slots, (i) => rows[i].key,
        (range) => rows.slice(range.start, range.end).map((x, j) =>
          v_flex().w_full().h(slots[range.start + j]).overflow_hidden()
            .when(dim && !CARD.has(x.kind), (el) => el.opacity(0.55))
            .child(this.item(t, x, focusedPanel, slots[range.start + j]))))
        .track_scroll(this.scroll)
        .on_item_click((key, cx) => this.click(key, cx))
        .size_full())
      .child(Scrollbar.vertical("threads-list").viewport_from_layout().absolute().inset_0())
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

  empty(t, icon, title, body, foot, buttons = []) {
    return v_flex().flex_1().min_h(0).p(20).gap(10).items_center().justify_center()
      .child(div().size(36).rounded(9).bg(t.raised).flex().items_center().justify_center().child(svg(ICON(icon)).size(18).text_color(t.muted)))
      .child(div().text_size(14).font_semibold().text_color(t.foreground).child(title))
      .child(div().max_w(300).text_size(12.5).text_color(t.muted).text_center().child(body))
      .when(Boolean(foot), (el) => el.child(div().max_w(300).text_size(11.5).text_color(t.dim).text_center().child(foot)))
      .when(buttons.length > 0, (el) => el.child(h_flex().mt(4).gap(6).children(buttons)));
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
        : `No Claude Code, Codex, OpenCode, Pi or Cursor process runs in ${this.terminal}, and no transcript was matched for its folder.`))
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

  statusIcon(t, turn) {
    if (turn.interrupted) return svg(ICON("ban")).size(12).flex_none().text_color(t.blocked);
    if (turn.errors.length && !this.replyText(turn)) return svg(ICON("alert")).size(12).flex_none().text_color(t.blocked);
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
  quoteBar(t, agent, h = ROW.PROMPT_LINE - 4) {
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
  // Card text width: 6 px list margin, 1 px border and 9 px padding each side, so card text
  // starts 16 px in, where row text starts.
  inner() { return Math.max(120, this.width - 12 - 18 - 2); }
  perLine() { return Math.max(8, Math.floor((this.inner() - 20) / YOU_CHAR)); }

  // First-frame estimate of Markdown at the card width: 21 px lines, 12 px between blocks,
  // and one spare line so it does not run short. The probe's measure replaces it.
  mdHeight(md) {
    const w = this.inner();
    let h = 0;
    const blocks = md.split(/\n{2,}/);
    for (const b of blocks) h += this.wrapped(b.replace(/[*_`#>]/g, ""), w, MD_CHAR) * TV_LINE;
    return h + (blocks.length - 1) * 12 + TV_LINE;
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
    const sig = `${r.full ? 1 : 0}|${this.perLine()}|${this.linksVer}|${this.remote.repo ?? ""}|${src.length}|${hl ? q : ""}`;
    if (r.turn.youMemo?.sig === sig) return r.turn.youMemo.v;
    const c = this.youText(r);
    // Show all reads up to 200,000 characters of the prompt, and says what it leaves out.
    const max = r.full ? FULL_PROMPT_CHARS / 8 : 4000;
    const parts = hl ? promptParts(c.text, max) : null;
    const m = hl ? { md: "", quotes: parts.filter((x) => x.quote).length, code: 0, links: 0, cut: Math.max(0, c.text.length - max * 8) }
      : promptMd(c.text, { links: this.links, repo: this.remote.repo, owner: this.remote.owner, max });
    const extra = 6 * m.quotes + 16 * m.code;
    const per = Math.max(8, Math.floor((this.inner() - 20) / YOU_CHAR));
    const n = wrappedLines(c.text, per);
    // One spare line, so the first frame's estimate does not run short.
    const raw = c.text ? (n + 1) * TV_LINE + extra : 0;
    // Taller than YOU_MAX: a box of that height that scrolls (Show all on a long paste).
    const capped = raw >= YOU_MAX;
    const v = { ...m, text: c.text, more: c.more, hl, parts, extra, bodyH: Math.min(YOU_MAX, raw), capped };
    r.turn.youMemo = { sig, v };
    return v;
  }

  youHeight(r) {
    const y = this.youMd(r);
    const clipped = !r.full && y.more > 0;
    const canLess = r.full && this.youClip(r.turn).more > 0;
    const chip = r.turn.cmd ? ROW.PROMPT_LINE + 4 : 0;
    const body = y.text ? 8 + 10 + 16 + 4 + y.bodyH + 10 + (clipped || canLess ? 22 : 0) + 10 : 8 + 10 + 16 + 10 + 10;
    return body + chip;
  }

  // The FINAL REPLY caption's parts: [icon, text].
  captionParts(turn) {
    const out = [];
    if (turn.tools > 0) out.push(["wrench", `${plural(turn.tools, "tool call")} (not shown)`]);
    if (turn.followups > 0) out.push(["bell", plural(turn.followups, "background update")]);
    const by = this.borrowedFrom(turn);
    if (by) out.push(["bot", `shared with agent message #${by.n}${by.sender?.name ? ` from ${by.sender.name}` : ""}`]);
    return out;
  }

  // Lines the caption takes when it wraps: the label, then each part (icon + text).
  captionRows(turn) {
    const w = this.inner();
    let rows = 1;
    let x = 11 * 6.6;
    for (const [, text] of this.captionParts(turn)) {
      const cw = 10 + 12 + 4 + text.length * 6.3;
      if (x + 6 + cw > w) { rows++; x = cw; } else x += 6 + cw;
    }
    return rows;
  }

  // A part's list height: what the probe measured for it, else the estimate.
  height(r) {
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
      case "turn": case "wrow": return r.shape.height;
      case "img": return 8 + 4 + 18 + this.imgBox(r).h;
      case "divider": return 36;
      case "day": return 46;
      case "hidden": return 28;
      case "note": return 34;
      case "working": {
        const prompt = clipPrompt(r.turn.prompt, PROMPT_LINES, this.perLine(), PROMPT_CHARS).text;
        // The working card's text is 2 px narrower than other card text (its 10 px padding),
        // and its prompt and note have explicit line heights, so this is the drawn height
        // when the wrap estimate holds (F3).
        const tw = w - 2;
        const lines = Math.min(6, this.wrapped(prompt, tw, YOU_CHAR));
        const note = this.wrapped(`No final reply yet. It appears here when ${this.agent().short} finishes this turn.`, tw, 6.0);
        return 8 + 2 + 20 + 18 + 8 + lines * TV_LINE + 8 + this.chipRows(["00 tool calls", "000.0k tokens", "00:00"]) * 27 + 3 + note * NOTE_LINE;
      }
      case "head": return 4 + 1 + 10 + 18;
      case "you": return this.youHeight(r);
      case "rhead": return 10 + this.captionRows(r.turn) * 18;
      case "lhead": return 14 + TV_LINE;
      case "latest": return 6 + (r.md ? this.mdHeight(r.md) + 22 : this.latestBox(r) + (this.latestCut(r) ? 22 : 0));
      case "noreply": return 6 + TV_LINE * (this.wrapped(this.noReplyText(r.turn), w, MD_CHAR) + 1);
      case "md": return 6 + this.mdHeight(r.src ?? r.md);
      case "seltext": return 6 + 22 + r.boxH;
      case "codehead": return 8 + 28;
      case "code": return this.codeBoxH(r) + (r.caption ? 24 : 0);
      case "more": return 8 + 26;
      case "stats": {
        const line = this.countsLine(r.turn);
        // The info chip at the end is about as wide as an empty labelled one.
        return 10 + this.chipRows([...this.statTexts(r.turn), ""]) * 27 - 5 + (line ? this.countsHeight(line) : 0);
      }
      case "legend": {
        const per = (w - 17) / 5.9;
        const lines = this.legendEntries(r.turn).reduce((n, [, text]) => n + wrappedLines(text, Math.floor(per)), 0);
        return 6 + (lines + 1) * 19 + (this.legendEntries(r.turn).length - 1) * 4;
      }
      case "copy": return 10 + 28 + 10 + 1 + 4;
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
    const head = `${Math.round(this.width)}|${this.zoom()}|${settings()?.ui_font ?? ""}|${r.kind}`;
    switch (r.kind) {
      case "you": { const y = this.youMd(r); return `${head}|${y.text.length}|${y.more}|${r.full ? 1 : 0}|${y.hl ? this.filterText() : ""}|${y.capped ? 1 : 0}|${this.linksVer}|${this.remote.repo ?? ""}`; }
      case "rhead": return `${head}|${this.captionParts(r.turn).map((x) => x[1]).join("|")}`;
      case "md": return `${head}|${r.md.length}|${this.linksVer}|${this.remote.repo ?? ""}`;
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
    const was = this.meas.get(key);
    if (was?.sig === sig && was.h === h) return;
    if (this.meas.size > 2000) this.meas.clear();
    this.meas.set(key, { sig, h });
    const i = this.baseIndex?.get(key);
    const r = i != null ? this.baseRows[i] : null;
    if (r?.key === key) {
      this.baseSizes[i] = this.height(r);
      this.sizesVer = (this.sizesVer ?? 0) + 1;
    }
    cx.notify();
  }

  // The parts still to measure, each drawn in the probe for at most three frames: a part
  // that never reports keeps its estimate (the debug report says "measured: none").
  probeDue() {
    const out = [];
    this.probeTries ??= new Map();
    for (const r of this.probeRows ?? []) {
      if (this.measured(r) != null) continue;
      const sig = this.partSig(r);
      const k = `${r.key}|${sig}`;
      const n = this.probeTries.get(k) ?? 0;
      if (n >= 3) continue;
      this.probeTries.set(k, n + 1);
      out.push([r, sig]);
    }
    if (this.probeTries.size > 4000) this.probeTries.clear();
    return out;
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
    const full = m ?? Math.max(1, r.estLines ?? 1) * TV_LINE;
    return Math.min(full, LATEST_LINES * TV_LINE);
  }
  latestCut(r) {
    if (r.md) return false;
    const m = this.measured(r);
    return m != null ? m > LATEST_LINES * TV_LINE + 1 : (r.estLines ?? 0) > LATEST_LINES;
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
    return turn.interrupted ? `No reply · interrupted after ${plural(turn.tools, "tool call")}.`
      : turn.errors.at(-1) ?? (turn.answeredBy ? `${this.agent().short} answered this together with #${turn.answeredBy}; the reply is there.` : "No final reply.");
  }

  item(t, r, focusedPanel, size) {
    switch (r.kind) {
      case "spacer": return div();
      case "turn": return this.rowItem(t, r, focusedPanel);
      case "wrow": return this.workingRow(t, r, focusedPanel);
      case "working": return this.workingItem(t, r);
      case "divider": return this.dividerItem(t, r);
      case "day": return this.dayItem(t, r);
      case "hidden": return h_flex().px(16).h(26).gap(6).items_center().text_size(12).text_color(t.dim)
        .child(svg(ICON("unfold")).size(12)).child(`${plural(r.n, "turn")} hidden`);
      case "note": return div().px(16).py(8).text_size(12).text_color(t.dim).child(r.text);
      default: return this.cardPart(t, r, size);
    }
  }

  // The frame of a collapsed row. The 2 px accent ring marks the selected row while the
  // pane has the keyboard; open cards never take it.
  // Agent rows are inset 8 px, with a 2 px ansi5 rail and a faint ansi5 fill.
  rowFrame(t, r, sel, focusedPanel, live, kids) {
    const agent = r.turn.agent;
    const box = v_flex().flex_1().min_w(0).px(10).py(7).gap(3)
      .when(agent, (el) => el.rounded_r(8).bg(alpha(t.ansi5, 0.06)).border_l(2).border_color(alpha(t.ansi5, 0.7)).pl(8))
      .when(!agent, (el) => el.rounded(8))
      .when(sel && !live, (el) => el.bg(t.selected))
      .when(sel && focusedPanel, (el) => el.border_2().border_color(t.accent).px(8).py(5))
      .hover((s) => s.bg(sel && !live ? t.selected : t.hover))
      .children(kids);
    return h_flex().px(6).py(1).child(div().when(agent, (el) => el.w(8)).flex_none()).child(box);
  }

  // Width left for an agent row's sender label: the text width less the icon, time, #n,
  // bell and tool counts beside it and their gaps (at most 60%), so a long name shortens
  // in the middle instead of pushing the time or #n past the gutter.
  labelRoom(turn, tw) {
    const ch = 6.6;
    const time = fmtTime(turn.ts).length * ch;
    const n = (`#${turn.n}`.length) * 7.2;
    const bell = turn.followups > 0 ? 13 + countLabel(turn.followups).length * ch : 0;
    const tools = turn.tools > 0 && !this.narrow() ? 13 + String(turn.tools).length * ch : 0;
    // Gaps: icon, label, time, #n, the bell and tool counts, tokens (which truncate first).
    const gaps = 4 + (bell ? 1 : 0) + (tools ? 1 : 0);
    const fixed = 12 + time + n + bell + tools + 6 * gaps + 8;
    return Math.max(36, Math.floor(Math.min(tw * 0.6, tw - fixed)));
  }

  // The meta line: own rows "#n ✓ 9:05 AM 🔔 12 🔧 4 … tokens · duration"; agent rows
  // "<icon> t7 review · hc report  9:05 AM  #n … tokens". Tokens and duration truncate first.
  metaLine(t, turn, lead, time) {
    const narrow = this.narrow();
    const dim = t.dim;
    const agent = turn.agent;
    const ac = this.agentColor(t);
    const tw = rowTextWidth(this.width, agent);
    return h_flex().h(ROW.META).gap(6).items_center().text_size(11.5).text_color(dim).min_w(0)
      .when(agent, (el) => el
        .child(svg(ICON(senderIcon(turn.sender))).size(12).flex_none().text_color(ac))
        .child(div().flex_none().max_w(this.labelRoom(turn, tw)).overflow_hidden().whitespace_nowrap().text_ellipsis_middle()
          .text_size(11.5).font_semibold().text_color(ac).child(senderLabel(turn.sender, this.width))))
      .when(!agent, (el) => el.child(div().flex_none().font_family(this.mono()).child(`#${turn.n}`)))
      .when(Boolean(lead), (el) => el.child(lead))
      .child(div().flex_none().child(time))
      .when(agent, (el) => el.child(div().flex_none().font_family(this.mono()).child(`#${turn.n}`)))
      .when(turn.followups > 0, (el) => el.child(h_flex().flex_none().gap(3).items_center()
        .child(svg(ICON("bell")).size(10)).child(countLabel(turn.followups))))
      .when(Boolean(turn.images?.length), (el) => el.child(h_flex().flex_none().gap(3).items_center()
        .child(svg(ICON("image")).size(10)).child(String(turn.images.length))))
      .when(turn.tools > 0 && !narrow, (el) => el.child(h_flex().flex_none().gap(3).items_center()
        .child(svg(ICON("wrench")).size(10)).child(String(turn.tools))))
      .child(div().flex_1().min_w(0).truncate().text_right().font_family(this.mono()).child(this.meta(turn)));
  }

  // A command's chip, then its arguments wrapping to its right.
  promptBlock(t, turn, sh, sel = false) {
    const agent = turn.agent;
    const color = agent ? t.muted : t.foreground;
    const size = agent ? 12.5 : 13;
    if (sh.chip) {
      return h_flex().gap(6).items_start().min_w(0)
        .child(div().flex_none().h(ROW.PROMPT_LINE).flex().items_center().child(this.chip(t, sh.chip.label, sh.chip.chipW, sh.prompt.length === 0, sel)))
        .when(sh.prompt.length > 0, (el) => el.child(this.lines(t, sh.prompt, color, size, ROW.PROMPT_LINE)));
    }
    // A prompt that quotes something: each quote line behind a bar, muted at 12.5 px; a
    // quote that is the whole prompt keeps the prompt's own colour and size.
    if (sh.kinds) {
      return v_flex().min_w(0).children(sh.prompt.map((l, i) => {
        const k = sh.kinds[i];
        if (k === "c") return h_flex().min_w(0).when(!agent, (el) => el.font_medium()).child(this.lines(t, [l], color, size, ROW.PROMPT_LINE));
        return h_flex().h(ROW.PROMPT_LINE).min_w(0).gap(QUOTE_INSET - 2).items_center()
          .child(this.quoteBar(t, agent))
          .child(k === "qonly"
            ? h_flex().flex_1().min_w(0).when(!agent, (el) => el.font_medium()).child(this.lines(t, [l], color, size, ROW.PROMPT_LINE))
            : this.lines(t, [l], t.muted, 12.5, ROW.PROMPT_LINE));
      }));
    }
    return h_flex().min_w(0).when(!agent, (el) => el.font_medium()).child(this.lines(t, sh.prompt, color, size, ROW.PROMPT_LINE));
  }

  rowItem(t, r, focusedPanel) {
    const { turn, key } = r;
    const sel = this.sel === key;
    const sh = r.shape;
    const tone = sh.tone;
    const icon = tone === "why" ? "ban" : tone === "error" ? "alert" : "reply";
    const color = tone === "why" ? t.blocked : t.dim;
    // Agent rows leave out the done check; interrupted and error icons still show.
    const status = turn.agent && !turn.interrupted && !(turn.errors.length && !this.replyText(turn)) ? null : this.statusIcon(t, turn);
    return this.rowFrame(t, r, sel, focusedPanel, false, [
      this.metaLine(t, turn, status, fmtTime(turn.ts)),
      this.promptBlock(t, turn, sh, sel),
      ...(sh.thumbs ? [this.thumbStrip(t, turn, key)] : []),
      h_flex().gap(5).items_start().min_w(0)
        .child(div().flex_none().h(ROW.REPLY_LINE).flex().items_center().child(svg(ICON(icon)).size(12).text_color(color)))
        .child(this.lines(t, sh.reply, tone === "reply" ? t.muted : t.dim, 12.5, ROW.REPLY_LINE)),
    ]);
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

  // The running turn when it is not selected: a row like the others, with the live state
  // on the reply line.
  workingRow(t, r, focusedPanel) {
    const { turn, key } = r;
    const st = this.liveState(t);
    const sel = this.sel === key;
    const clock = turn.ts ? fmtClock(Date.now() - turn.ts) : "";
    const tools = `${plural(turn.tools, "tool call")} so far, no reply yet`;
    const sh = r.shape;
    return this.rowFrame(t, r, sel, focusedPanel, true, [
      h_flex().h(ROW.META).gap(6).items_center().text_size(11.5).text_color(t.dim)
        .when(turn.agent, (el) => el.child(svg(ICON(senderIcon(turn.sender))).size(12).flex_none().text_color(this.agentColor(t)))
          .child(div().flex_none().max_w(Math.floor(rowTextWidth(this.width, true) * 0.6)).overflow_hidden().whitespace_nowrap().text_ellipsis_middle()
            .font_semibold().text_color(this.agentColor(t)).child(senderLabel(turn.sender, this.width))))
        .child(div().flex_none().font_family(this.mono()).child(`#${turn.n}`))
        .child(this.liveIcon(st, 12))
        .child(div().flex_none().child(st.spin ? "now" : fmtTime(turn.ts)))
        .child(div().flex_1().min_w(0).truncate().text_right().font_family(this.mono())
          .child([this.showTokens(stats(turn)) ? fmtTokens(stats(turn).tokens) : null, clock].filter(Boolean).join(" · "))),
      this.promptBlock(t, turn, sh),
      h_flex().h(ROW.REPLY_LINE).gap(5).items_center().min_w(0)
        .child(this.liveIcon(st, 12))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(st.color).child(`${st.label} · ${tools}`)),
    ]);
  }

  // The running turn when selected: the working card, with live counts and a clock.
  workingItem(t, r) {
    const { turn } = r;
    const s = stats(turn);
    const st = this.liveState(t);
    const clock = turn.ts ? fmtClock(Date.now() - turn.ts) : "";
    const chip = (icon, text) => h_flex().h(22).px(7).gap(5).items_center().rounded(5).bg(t.raised)
      .text_size(11.5).font_family(this.mono()).text_color(t.muted).child(svg(ICON(icon)).size(11).text_color(t.dim)).child(text);
    return div().px(6).py(4).child(v_flex().p(10).gap(8).rounded(9).bg(alpha(st.color, 0.08)).border_1().border_color(alpha(st.color, 0.55))
      .child(h_flex().h(18).gap(6).items_center().text_size(11.5)
        .child(div().text_color(t.dim).font_family(this.mono()).child(`#${turn.n}`))
        .child(this.liveIcon(st, 12))
        .child(div().text_color(st.color).font_medium().child(`${st.label}${clock ? ` · ${clock}` : ""}`)))
      .child(div().text_size(13).line_height(`${TV_LINE}px`).text_color(t.foreground).child(clipPrompt(turn.prompt, PROMPT_LINES, this.perLine(), PROMPT_CHARS).text))
      .child(h_flex().gap(5).flex_wrap()
        .child(chip("wrench", plural(turn.tools, "tool call")))
        .when(this.showTokens(s), (el) => el.child(chip("arrows", `${fmtTokens(s.tokens)} tokens`)))
        .when(Boolean(clock), (el) => el.child(chip("clock", clock))))
      .child(div().text_size(12).line_height(`${NOTE_LINE}px`).text_color(t.dim).child(st.label === "Needs you"
        ? `${this.agent().short} is waiting for you in the terminal.`
        : st.spin ? `No final reply yet. It appears here when ${this.agent().short} finishes this turn.`
          : "This turn has no final reply yet. It may have been stopped.")));
  }

  // A day divider: a band across the whole pane, 12 px below the turn above, with a rule
  // above and below, a calendar icon in the accent colour, the day and its date, and the
  // day's shown turns on the right. Its fill is ui.js bandFill.
  dayItem(t, r) {
    return v_flex().pt(12)
      .child(h_flex().h(30).px(16).gap(8).items_center().bg(this.bandFill(t)).border_t_1().border_b_1().border_color(t.border)
        .child(svg(ICON("calendar")).size(13).flex_none().text_color(t.accent))
        .child(div().flex_none().text_size(12).font_semibold().text_color(t.foreground).child(r.name))
        .when(Boolean(r.date), (el) => el.child(div().flex_none().text_size(12).text_color(t.muted).child(r.date)))
        .child(div().flex_1())
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(plural(r.count, "turn"))));
  }

  bandFill(t) {
    const k = `${t.background}|${t.foreground}|${t.raised}|${t.selected}`;
    if (this.bandMemo?.k !== k) this.bandMemo = { k, fill: bandFill(t) };
    return this.bandMemo.fill;
  }

  dividerItem(t, r) {
    return h_flex().px(16).py(8).gap(8).items_center()
      .child(svg(ICON(r.s.clearAt ? "eraser" : "messages")).size(13).flex_none().text_color(t.dim))
      .child(div().flex_none().text_size(11.5).text_color(t.muted).child(dividerLabel(r.s)))
      .child(div().flex_1().h(1).bg(t.border));
  }

  // One slice of an expanded turn's card: exactly its slot's height, with the card's
  // raised fill and side borders, so slices stack into one card with no seam. Only the
  // first part has the top edge and the last the bottom edge. The card keeps the border
  // stroke whether or not it is selected.
  cardPart(t, r, size) {
    const { turn } = r;
    // Flex containers, so a child's top margin stays inside the card instead of collapsing
    // through it and leaving a gap between list items.
    const h = size - (r.part === "top" ? 4 : 0) - (r.part === "bottom" ? 4 : 0);
    // An agent turn's card keeps a 3 px ansi5 rail down its left edge, so a slice scrolled
    // into view on its own still says who spoke.
    const rail = turn.agent;
    return v_flex().h(size).px(6).child(v_flex().h(h).flex_none().overflow_hidden().px(9).bg(t.raised).border_l(1).border_r(1).border_color(t.border).relative()
      .when(r.part === "top", (el) => el.mt(4).pt(10).border_t(1).rounded_t(9))
      .when(r.part === "bottom", (el) => el.mb(4).pb(10).border_b(1).rounded_b(9))
      .when(rail, (el) => el.child(div().absolute().left(0).top(0).bottom(0).w(3).bg(t.ansi5)))
      .child(this.partContent(t, r, false)));
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
        return h_flex().h(18).gap(6).items_center().text_size(11.5).text_color(t.dim)
          .child(div().font_family(mono).child(`#${turn.n}`))
          .child(this.statusIcon(t, turn))
          .when(turn.agent, (el) => el.child(svg(ICON(senderIcon(turn.sender))).size(12).flex_none().text_color(this.agentColor(t))))
          .child(div().flex_1().min_w(0).truncate().child([when(turn.ts), fmtDuration(turn.durationMs)].filter(Boolean).join(" · ")))
          .child(svg(ICON("chevron-up")).size(14).flex_none());
      case "you": {
        const y = this.youMd(r);
        const c = { text: y.text, more: y.more };
        const canLess = r.full && this.youClip(turn).more > 0;
        // A prompt taller than YOU_MAX scrolls inside a box of that height; any other is
        // drawn at its own height (measured), so nothing in it is cut.
        const scroll = y.capped && !probe;
        // Markdown through TextView (quotes, code and link rules drawn the way the reply is),
        // or with a filter that matches the prompt, the matches marked and each quote run
        // behind the same bar.
        const text = y.hl
          ? v_flex().gap(6).children(y.parts.map((p) => p.quote
            ? div().relative().pl(QUOTE_INSET).child(div().absolute().left(0).top(2).bottom(2).w(2).rounded(1).bg(turn.agent ? t.dim : alpha(t.foreground, 0.28)))
              .child(this.hlBlock(t, p.lines.join("\n"), t.muted))
            : this.hlBlock(t, p.lines.join("\n"), t.foreground)).concat(y.cut
            ? [div().text_size(11.5).italic().text_color(t.dim).child(`… ${y.cut.toLocaleString()} more characters not shown`)] : []))
          : y.capped
            ? TextView.markdown(tv(`th-you-${r.key}`), y.md).selectable(false).when(scroll, (el) => el.scrollable(true).size_full()).when(!scroll, (el) => el.w_full())
            : TextView.markdown(tv(`th-you-${r.key}`), y.md).selectable(false).w_full();
        const cmd = commandParts(turn);
        const ac = this.agentColor(t);
        const box = y.capped ? (probe ? div().h(YOU_MAX).overflow_hidden() : y.hl ? v_flex().id(`th-you-${tkey}`).h(YOU_MAX).overflow_y_scrollbar() : div().h(YOU_MAX)) : div();
        return v_flex().mt(8).p(10).gap(4).rounded(7).bg(turn.agent ? alpha(t.ansi5, 0.08) : t.background)
          .child(h_flex().gap(5).items_center()
            .when(turn.agent, (el) => el.child(svg(ICON(senderIcon(turn.sender))).size(11).flex_none().text_color(ac)))
            .child(div().min_w(0).overflow_hidden().whitespace_nowrap().text_ellipsis_middle().text_size(10.5).font_semibold()
              .text_color(turn.agent ? ac : this.labelInk(t, t.background)).child(this.youLabel(turn))))
          .when(Boolean(cmd), (el) => el.child(h_flex().h(ROW.PROMPT_LINE).child(this.chip(t, middle(cmd.name, Math.floor((this.inner() - 32) / ROW.CHIP_CHAR)), this.inner() - 20, !cmd.args))))
          .when(Boolean(c.text), (el) => el.child(box.text_size(13).text_color(t.foreground).child(text)))
          .when(c.more > 0, (el) => el.child(div().text_size(12).text_color(t.accent).child(`+ ${plural(c.more, "more line")} · Show all`)))
          .when(canLess, (el) => el.child(div().text_size(12).text_color(t.accent).child("Show less")));
      }
      case "rhead":
        // "FINAL REPLY · 🔧 9 tool calls (not shown) · 🔔 144 background updates", wrapping.
        return h_flex().mt(10).gap_x(6).flex_wrap().items_center().text_size(10.5)
          .child(div().h(18).flex().items_center().font_semibold().text_color(this.labelInk(t)).child("FINAL REPLY"))
          .children(this.captionParts(turn).map(([icon, text]) => h_flex().h(18).gap(4).items_center().text_size(11.5).text_color(t.dim)
            .child(div().child("·")).child(svg(ICON(icon)).size(11).flex_none()).child(text)));
      case "lhead":
        return h_flex().mt(14).gap(6).items_center().text_size(10.5)
          .child(div().font_semibold().text_color(this.labelInk(t)).child("LATEST UPDATE"))
          .child(h_flex().gap(4).items_center().text_size(11.5).text_color(t.dim).min_w(0)
            .child(div().child("·")).child(svg(ICON("bell")).size(11).flex_none())
            .child(div().min_w(0).truncate().child(`after ${plural(turn.followups, "background update")}`)));
      case "latest": {
        if (r.md) return v_flex().mt(6)
          .child(div().text_size(13).child(TextView.markdown(tv(`th-lmd-${r.key}`), r.md).selectable(this.replySelectable()).w_full()))
          .child(div().h(22).flex().items_center().text_size(12).text_color(t.accent).child("Show less"));
        // One block that gpui wraps at the card's width, 21 px a line, in a box that shows
        // whole lines up to LATEST_LINES (C5).
        const block = div().w_full().text_size(13).line_height("21px").text_color(t.foreground).child(r.text);
        if (probe) return block;
        return v_flex().mt(6)
          .child(div().h(this.latestBox(r)).overflow_hidden().child(block))
          .when(this.latestCut(r), (el) => el.child(div().h(22).flex().items_center().text_size(12).text_color(t.accent).child("Show all")));
      }
      case "noreply":
        return div().mt(6).text_size(12.5).text_color(t.dim).child(this.noReplyText(turn));
      case "md":
        // The reply at its own height: no scroll inside the card, so its start never scrolls
        // out of view and its end is never cut (C3).
        return div().mt(6).text_size(13)
          .child(TextView.markdown(tv(`th-md-${r.key}`), r.md).selectable(this.replySelectable()).w_full());
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
          .child(div().flex_1().text_size(11.5).font_family(mono).text_color(t.dim).child(r.seg.lang || "code"))
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
            .child(`${plural(r.lines, "line")} · scrolls inside`))));
      }
      case "more":
        return (h_flex().mt(8).h(26).px(9).gap(5).items_center().rounded(6).border_1().border_color(t.border).text_size(12).text_color(t.muted)
          .child(svg(ICON(r.less ? "chevron-up" : "chevron-down")).size(12))
          .child(r.less ? "Show less" : `Show full reply · ${r.words.toLocaleString()} words`));
      case "stats": {
        const chip = (icon, text) => h_flex().flex_none().h(22).px(7).gap(5).items_center().rounded(5).bg(t.background)
          .text_size(11.5).font_family(mono).text_color(t.muted).child(svg(ICON(icon)).size(11).text_color(t.dim)).child(text);
        return h_flex().mt(10).gap(5).flex_wrap()
          .children(this.statChips(turn).map(([, icon, text]) => chip(icon, text)))
          // The info chip: a click anywhere on the stats (or i) explains the chips.
          .child(h_flex().flex_none().h(22).px(6).items_center().rounded(5).bg(this.legendOn ? t.raised : t.background)
            .border_1().border_color(this.legendOn ? t.accent : t.background)
            .child(svg(ICON("info")).size(11).text_color(this.legendOn ? t.foreground : t.dim)))
          // The exact counts, 16 px lines (C1): its height is measured with the chips.
          .when(Boolean(this.countsLine(turn)), (el) => el.child(div().w_full().pt(6).text_size(11).line_height("16px").font_family(mono).text_color(this.labelInk(t)).child(this.countsLine(turn))));
      }
      case "img": {
        this.wantImages(turn, tkey);
        const f = this.imgFile(turn, r.i);
        const box = this.imgBox(r);
        const n = turn.images[r.i]?.n;
        const st = this.imgState(turn);
        const gone = !f && this.imgGone(turn, r.i);
        const label = [`[Image #${n ?? r.i + 1}]`, gone ? turn.images[r.i]?.src : null, f?.w ? `${f.w}×${f.h}` : null,
          f ? (r.full ? "click to shrink" : "click to enlarge") : null].filter(Boolean).join(" · ");
        return v_flex().pt(8).gap(4)
          .child(f
            ? div().w(box.w).h(box.h).rounded(6).overflow_hidden().border_1().border_color(t.border).bg(t.background).child(image(f.path).size_full())
            : h_flex().w_full().h(box.h).gap(6).rounded(6).bg(t.background).items_center().justify_center().text_size(12).text_color(t.dim)
              .child(svg(ICON("image")).size(13)).child(gone ? "Image no longer on disk" : st === "wait" ? "Loading image…" : "This image could not be shown"))
          .child(div().h(18).text_size(11.5).line_height("18px").truncate().text_color(t.dim).child(label));
      }
      case "legend":
        return v_flex().mt(6).gap(4).children(this.legendEntries(turn).map(([icon, text]) => h_flex().gap(6).items_start()
          .child(svg(ICON(icon)).size(11).mt(4).flex_none().text_color(t.dim))
          .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.muted).child(text))));
      case "copy": {
        const copied = this.copied?.id === `reply:${tkey}`;
        const has = Boolean(this.replyText(turn));
        // Widths and labels from ui.js barLayout, the same figures barHit reads.
        const L = this.bar(turn);
        const wOf = (b) => b[1] - b[0];
        const side = (b, icon, label, on = false) => h_flex().flex_none().w(wOf(b)).h(28).gap(6).items_center().justify_center().rounded(7)
          .border_1().border_color(on ? t.accent : t.border).text_size(12.5)
          .bg(on ? t.raised : t.background).text_color(on ? t.foreground : t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .child(svg(ICON(icon)).size(13))
          .when(Boolean(label), (el) => el.child(label));
        const selOn = this.selecting === tkey;
        return (h_flex().mt(10).gap(6).items_center()
          .child(h_flex().flex_none().w(wOf(L.copy)).h(28).gap(6).items_center().justify_center().rounded(7).text_size(12.5).font_medium()
            .when(!has, (el) => el.opacity(0.4))
            .bg(copied ? alpha(t.ansi2, 0.13) : t.background).border_1().border_color(copied ? t.ansi2 : t.border)
            .text_color(copied ? t.ansi2 : t.foreground)
            .child(svg(ICON(copied ? "check" : "copy")).size(13)).child(copied ? "Copied" : L.labels.copy))
          // Select: the reply as selectable source text (s).
          .when(has, (el) => el.child(side(L.select, "text-cursor", L.labels.select ? (selOn ? "Formatted" : "Select") : null, selOn)))
          // Quote: pastes the reply (or, in Select view, the copied part) into the terminal's
          // input as a Markdown quote, without sending it (q).
          .when(Boolean(L.quote), (el) => el.child(side(L.quote, "quote", L.labels.quote ? "Quote" : null)))
          .child(div().flex_1())
          // Terminal: focuses the terminal pane (it cannot scroll the terminal to this turn).
          .when(Boolean(L.terminal), (el) => el.child(side(L.terminal, "square-terminal", L.labels.terminal ? "Terminal" : null))));
      }
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

  // Key hints that apply now: [key, label]. Below 300 px only move, open, copy and filter.
  // In Select view: how to select, copy, quote and go back.
  footerHints() {
    const narrow = this.narrow();
    if (this.selecting) return narrow ? [["⌘C", "copy"], [this.quoteKey, "quote"], ["Esc", "back"]]
      : [["drag", "select"], ["⌘C", "copy"], ...(this.quotable() ? [[this.quoteKey, "quote"]] : []), ["Esc", "back"]];
    const out = [["↑↓", "move"], ["↵", "open"], ["c", narrow ? "copy" : "copy reply"]];
    if (!narrow && this.quotable()) out.push([this.quoteKey, "quote"]);
    out.push(["/", "filter"]);
    if (narrow) return out;
    if (this.sel && this.open.has(this.sel)) out.push(["s", "select"], ["i", "explain"]);
    out.push(["g", "jump"], ["End", "latest"]);
    if (this.pane()) out.push(["t", "terminal"]);
    if (this.counts().agentAll > 0 || this.prefs.agentTurns) out.push(["a", "agents"]);
    if (this.manyDays()) out.push(["[ ]", "day"]);
    return out;
  }

  footer(t) {
    const hint = (k, label) => h_flex().gap(4).items_center().child(this.kbd(t, k)).child(div().text_size(11.5).text_color(t.dim).child(label));
    return h_flex().flex_none().pl(10).pr(16).py(7).gap(10).flex_wrap().items_center().border_t(1).border_color(t.border)
      .children(this.footerHints().map(([k, label]) => hint(k, label)));
  }

  // True when the shown turns span more than one day (day dividers, and [ ] moves by day).
  manyDays() {
    const days = new Set();
    for (const s of this.sessions) for (const t of s.turns) { days.add(t.day ?? dayKey(t.ts)); if (days.size > 1) return true; }
    return false;
  }

  toastView(t) {
    return h_flex().absolute().bottom(44).left(0).right(0).justify_center()
      .child(h_flex().h(32).max_w(Math.max(120, this.width - 24)).px(12).gap(7).items_center().rounded(8).bg(t.popover).border_1().border_color(t.border).shadow_md()
        .text_size(12.5).text_color(t.foreground)
        .child(svg(ICON(this.toast.icon ?? "check")).size(13).flex_none().text_color(this.toast.icon === "circle-x" ? t.blocked : this.toast.icon === "check" ? t.ansi2 : t.muted))
        .child(div().min_w(0).truncate().child(this.toast.text)));
  }
}
