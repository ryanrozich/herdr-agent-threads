// agent-threads: small pure helpers for drawing (no Herdr imports), tested under bun.

import { harnessOf } from "./harness.js";

// The panel action for a key press, or null. Chords with cmd, ctrl, alt or fn belong to
// Herdr and the system (cmd-c, cmd-shift-t, ctrl-tab), so they are never taken.
const KEYS = {
  up: "prev", k: "prev", down: "next", j: "next", home: "first", g: "jump",
  end: "latest", enter: "open", space: "open", o: "outline", c: "copy", "/": "filter", escape: "escape",
  "[": "prevDay", "]": "nextDay", a: "agents", t: "focus", ",": "settings", s: "select", i: "legend", v: "pinned",
  "-": "narrower", "=": "wider", w: "fit", "?": "keys", right: "deeper", left: "shallower",
};
// Pin keys give way to the quote key, so a quote key of p or u keeps working. The person who
// chose it pins with the pin on an open turn's top line, and unpins with that pin or the
// Pinned view's header button (the list's header has no pin button).
const PIN_KEYS = { p: "pin", u: "undoUnpin", 1: "go:1", 2: "go:2", 3: "go:3", 4: "go:4", 5: "go:5" };
// quoteKey (settings.json, default q) returns "quote": the panel handles it itself, and no
// mod command fires it.
export function keyAction(e, filtering = false, quoteKey = "q") {
  const m = e?.modifiers ?? {};
  if (m.platform || m.control || m.alt || m.function) return null;
  const k = e?.key ?? "";
  // ? is Shift-/ on most layouts; Herdr may name it either way. Shift w steps the reading
  // width (Comfortable, Wide, Full), beside w, which fits the pane to it.
  if (m.shift) return k === "g" || k === "G" ? "latest" : k === "w" || k === "W" ? (filtering ? null : "widthStep") : k === "?" || k === "/" ? (filtering ? null : "keys") : null;
  if (k === "G") return "latest";
  if (k === "W") return filtering ? null : "widthStep";
  if (filtering && !["escape", "up", "down", "enter"].includes(k)) return null;
  return KEYS[k] ?? (k === quoteKey && /^[a-z]$/.test(k) ? "quote" : PIN_KEYS[k] ?? null);
}
// Every key, grouped, for the ? sheet: [group, [[keys, what it does]]]. A pin key gives way
// to a quote key of the same letter (PIN_KEYS), so the sheet leaves it out then. The Pinned
// column has no outline (outline false), so its sheet leaves o out.
export function keySheet(quoteKey = "q", { outline = true } = {}) {
  const pin = (k) => quoteKey !== k;
  return [
    ["List", [
      [["↑", "↓", "j", "k"], "Move between turns"], [["Home"], "First turn"], [["↵", "Space"], "Open or close a turn"],
      ...(outline ? [[["o"], "Outline: one row per turn"]] : []), [["/"], "Search"], [["g"], "Jump to a turn number"], [["End", "G"], "Newest turn"], [["[", "]"], "Previous or next day"],
      [["a"], "Show or hide agent messages"], [["Esc"], `Back out: search, Select view, settings, the open turn${outline ? ", the outline" : ""}`],
    ]],
    ["Open turn", [
      [["c"], "Copy the reply"], [[quoteKey], "Quote the reply into the terminal"], [["s"], "Select view, to highlight and copy"],
      [["→", "←"], "Open or close the turn's work, a level at a time"], [["i"], "Show or hide the turn's numbers"], [["t"], "Focus the terminal"],
    ]],
    ["Pins", [
      ...(pin("p") ? [[["p"], "Pin or unpin the selected turn"]] : []), [["1-5"], "Return to that pin"],
      ...(pin("u") ? [[["u"], "Undo the last unpin"]] : []), [["v"], "Open or go to the Pinned column"],
    ]],
    ["Image viewer", [
      [["←", "→", "h", "l"], "Previous or next image"], [["j", "k", "Space"], "Scroll the reply"], [["i"], "Show or hide the prompt and reply"],
      [["c"], "Copy the reply"], [["1-9"], "Go to that image"], [["Esc", "q"], "Close"],
    ]],
    ["View", [
      [["w"], "Fit to the reading width"], [["Shift w"], "Step the reading width: Comfortable, Wide, Full"], [["-", "="], "Pinned column narrower or wider"], [[","], "Settings"], [["?"], "Show or hide these keys"],
    ]],
  ];
}

// The footer's hints on one row: an estimate of each hint's width (the key cap at 10.5 px,
// a 4 px gap, the label at 11.5 px), and the hints that fit in width px. The last hint
// ("? keys") always stays; the one before it gives way first.
export function hintWidth([k, label]) {
  return Math.max(18, 12 + Math.ceil(String(k).length * 6.6)) + 4 + Math.ceil(String(label).length * 6.4);
}
export function fitHints(hints, width, gap = 10, pad = 26) {
  const out = [...hints];
  const total = () => out.reduce((sum, h) => sum + hintWidth(h), 0) + gap * Math.max(0, out.length - 1) + pad;
  while (out.length > 1 && total() > width) out.splice(out.length - 2, 1);
  return out;
}

// The agent's state for the header: { word, tone } or null. Only Claude Code reports a live
// status to Herdr (reports); for the others the transcript says only that the newest turn
// ended, so "Done" is all they get, and a running turn shows no word rather than a guess
// (it may be waiting on an approval). tone names a theme colour.
export function agentState({ ended = null, status = null, reports = false, newest = null } = {}) {
  if (ended) return { word: "Exited", tone: "dim" };
  if (reports && status === "blocked") return { word: "Needs you", tone: "blocked" };
  if (reports && status === "working") return { word: "Working", tone: "working" };
  if (newest?.done) return { word: "Done", tone: "done" };
  return null;
}

// Letters the panel already uses, so the quote key cannot be one of them.
export const TAKEN_LETTERS = Object.freeze(Object.keys(KEYS).filter((k) => /^[a-z]$/.test(k)));

// A theme colour at alpha a (0..1), as #rrggbbaa. Takes #rgb, #rgba, #rrggbb, #rrggbbaa,
// rgb() and rgba(); an existing alpha is multiplied. Anything else comes back unchanged.
export function alpha(color, a) {
  const c = String(color ?? "").trim();
  let r, g, b, base = 1;
  let m = c.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((x) => x + x).join("");
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
    if (h.length === 8) base = parseInt(h.slice(6, 8), 16) / 255;
  } else if ((m = c.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i))) {
    [r, g, b] = [m[1], m[2], m[3]].map((x) => Math.max(0, Math.min(255, Math.round(Number(x)))));
    if (m[4] != null) base = m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  } else return color;
  const hex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}${hex(Math.max(0, Math.min(1, base * a)) * 255)}`;
}

// Text split around case-insensitive matches of q: [{ t, hit }].
export function spans(text, q) {
  const s = text ?? "";
  const needle = (q ?? "").toLowerCase();
  if (!needle) return [{ t: s, hit: false }];
  const low = s.toLowerCase();
  const out = [];
  let at = 0;
  for (let i = low.indexOf(needle); i >= 0; i = low.indexOf(needle, i + needle.length)) {
    if (i > at) out.push({ t: s.slice(at, i), hit: false });
    out.push({ t: s.slice(i, i + needle.length), hit: true });
    at = i + needle.length;
  }
  if (at < s.length || !out.length) out.push({ t: s.slice(at), hit: false });
  return out;
}

// ---- the outline (o) ----
// One row per turn: its number, time, the first line of the prompt and a pin mark. The
// first line is the person's own words: quote lines ("> ") and fenced code are passed over,
// and a prompt that is only a quote or code shows its first line. With a search, the text around the
// first match, as a collapsed row shows it.
export function outlineText(prompt, q = "") {
  const text = String(prompt ?? "");
  if (q) return around(text.replace(/\s+/g, " ").trim(), q).slice(0, 240);
  let fence = false;
  let own = null;
  let code = null;
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (/^(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (!l) continue;
    if (fence) { code ??= l; continue; }
    if (!l.startsWith(">")) { own = l; break; }
    code ??= l.replace(/^(>\s?)+/, "");
  }
  return (own ?? code ?? "").slice(0, 240);
}
// An outline row's height: the reading line plus 8 px, at least 30 px.
export function outlineHeight(size = TEXT_SIZE) { return Math.max(30, readType(size).line + 8); }
// The turn number's column, so the times line up: "#" and the widest number at 7.2 px a
// character (11.5 px tabular digits), and 6 px after it.
export function outlineNumW(maxN) { return Math.ceil((String(Math.max(1, maxN | 0)).length + 1) * 7.2) + 6; }

// One line of text that keeps the first match in view: the start is cut to "…" plus
// `lead` characters before the match.
export function around(text, q, lead = 18) {
  const s = text ?? "";
  const i = q ? s.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i <= lead) return s;
  return `…${s.slice(i - lead).replace(/^\S*\s/, "")}`;
}

// Code fence names to the read-only editor's highlighters. Herdr's editor highlights the
// names on the right (checked in the app; RECIPE.md has the table); anything else is shown
// as plain text.
const LANG = {
  js: "js", javascript: "js", jsx: "js", mjs: "js", cjs: "js",
  ts: "js", tsx: "js", typescript: "js", mts: "js", cts: "js",
  json: "json", jsonc: "json", json5: "json", jsonl: "json",
  yaml: "yaml", yml: "yaml", toml: "yaml",
  bash: "bash", sh: "bash", shell: "bash", zsh: "bash", console: "bash", shellscript: "bash", dockerfile: "bash", docker: "bash", makefile: "bash", make: "bash",
  python: "python", py: "python",
  rust: "rust", rs: "rust",
  go: "go", golang: "go",
  html: "html", htm: "html", xml: "html", svg: "html", vue: "html", svelte: "html",
  css: "css", scss: "css", less: "css",
  sql: "sql",
  markdown: "markdown", md: "markdown",
  diff: "diff", patch: "diff",
};
export function langFor(fence) {
  return LANG[(fence ?? "").trim().toLowerCase()] ?? "txt";
}

// How many lines text takes when wrapped at `per` characters.
export function wrappedLines(text, per) {
  const p = Math.max(8, per);
  return (text ?? "").split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / p)), 0);
}

// Rows a code block takes when the editor wraps it at `per` characters: each line filled
// word by word (a break after a space), a word longer than a row split across rows.
// Herdr's Markdown view draws nothing for a block over 4,096 characters (on 0.1.14 a block
// of 4,090 draws and one of 4,099 measures 0 px tall). Longer Markdown is drawn as several
// blocks of at most MD_MAX bytes, split at blank lines outside fenced code, else at lines,
// else at words.
export const MD_MAX = 3500;
// UTF-8 bytes in a string, by UTF-16 unit: four for a surrogate pair, three for a lone
// surrogate, as TextEncoder counts. A for...of walk over the string cost 36 ms for a 34 KB
// reply in Herdr's QuickJS.
function utf8Len(s) {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) continue;
    if (c < 0x800) { n += 1; continue; }
    if (c >= 0xd800 && c < 0xdc00) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) { n += 2; i++; continue; }
    }
    n += 2;
  }
  return n;
}
const FENCE = /^\s*(`{3,}|~{3,})/;
// Pieces joined by sep into runs of at most max UTF-8 bytes (a longer piece alone). Each run's
// length is kept as it grows: measuring the whole run again for every piece made a reply with
// long tables cost more than Herdr's time for a draw.
function packed(pieces, sep, max) {
  const out = [];
  const sepLen = utf8Len(sep);
  let chunk = [];
  let len = 0;
  for (const p of pieces) {
    const pLen = utf8Len(p);
    if (!len) { chunk = [p]; len = pLen; }
    else if (len + sepLen + pLen > max) { out.push(chunk.join(sep)); chunk = [p]; len = pLen; }
    else { chunk.push(p); len += sepLen + pLen; }
  }
  const last = chunk.join(sep);
  if (last) out.push(last);
  return out;
}
// A Markdown table: lines that start with "|", the second of them a rule (TABLE_RULE).
const tableLine = (l) => l.trim().startsWith("|");
// A Markdown block split into its tables and the text around them, in order:
// [{ text, table }]. A table is its own part so the list can let it run wider than the
// reading line (tableNeed). Empty parts are dropped; text keeps its own blank lines.
export function splitTables(md) {
  const lines = String(md ?? "").split("\n");
  const out = [];
  let buf = [];
  const flush = (table) => {
    const text = buf.join("\n").replace(/^\n+|\n+$/g, "");
    if (text.trim()) out.push({ text, table });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    if (tableLine(lines[i]) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && tableLine(lines[i + 1])) {
      flush(false);
      let j = i;
      while (j < lines.length && tableLine(lines[j])) buf.push(lines[j++]);
      flush(true);
      i = j - 1;
    } else buf.push(lines[i]);
  }
  flush(false);
  return out.length ? out : [{ text: String(md ?? ""), table: false }];
}
// A table's cells, row by row, without the rule line.
export function tableCells(md) {
  return String(md ?? "").split("\n").filter((l) => tableLine(l) && !TABLE_RULE.test(l))
    .map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
}
// The width a table would like, in px: each column as wide as its longest cell, up to
// TABLE_COL_CHARS characters (a longer cell wraps), plus Herdr's cell padding.
export const TABLE_COL_CHARS = 40;
export const TABLE_CELL_PAD = 26;
export function tableNeed(md, charW) {
  const rows = tableCells(md);
  const cols = Math.max(0, ...rows.map((r) => r.length));
  let w = 0;
  for (let c = 0; c < cols; c++) {
    const most = Math.max(1, ...rows.map((r) => Math.min(TABLE_COL_CHARS, (r[c] ?? "").length)));
    w += most * charW + TABLE_CELL_PAD;
  }
  return Math.ceil(w);
}

export function mdChunks(md, max = MD_MAX) {
  const text = String(md ?? "");
  if (utf8Len(text) <= max) return [text];
  const blocks = [];
  let cur = [];
  let fence = null;
  for (const line of text.split("\n")) {
    const f = line.match(FENCE);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; }
    else if (!fence && !line.trim()) { if (cur.length) blocks.push(cur.join("\n")); cur = []; continue; }
    cur.push(line);
  }
  if (cur.length) blocks.push(cur.join("\n"));
  const pieces = blocks.flatMap((b) => (utf8Len(b) <= max ? [b] : splitBlock(b, max) ?? packed(wordsIn(b.split("\n"), max), "\n", max)));
  return packed(pieces, "\n\n", max);
}

const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const PIPE_ROW = /^\s*\|/;
// A block too long for one chunk that holds a table or fenced code, split so that every chunk
// still draws as one: each later piece of a table starts with its header and rule rows again,
// and each piece of a fenced block is closed and opened again with the same fence line. The
// lines before and after it split as other text. Null for a block with neither, or when the
// repeated lines would take half the room.
function splitBlock(b, max) {
  const ls = b.split("\n");
  let at = -1;
  let end = -1;
  let head;
  let foot = "";
  for (let i = 0; i < ls.length && at < 0; i++) {
    if (PIPE_ROW.test(ls[i]) && i + 1 < ls.length && TABLE_RULE.test(ls[i + 1]) && ls[i + 1].includes("-")) {
      at = i;
      end = i + 2;
      while (end < ls.length && PIPE_ROW.test(ls[end])) end++;
      head = `${ls[i]}\n${ls[i + 1]}`;
    }
    const f = ls[i].match(FENCE);
    if (f) {
      let j = i + 1;
      while (j < ls.length && ls[j].match(FENCE)?.[1][0] !== f[1][0]) j++;
      if (j >= ls.length) return null;
      at = i;
      end = j + 1;
      head = ls[i];
      foot = `\n${ls[j]}`;
    }
  }
  if (at < 0) return null;
  const top = head.split("\n").length;
  const body = ls.slice(at + top, foot ? end - 1 : end);
  const extra = utf8Len(head) + 1 + utf8Len(foot);
  if (extra * 2 > max || !body.length) return null;
  const room = max - extra;
  const pre = ls.slice(0, at);
  const tail = ls.slice(end);
  const rest = (part) => (part.length ? packed(wordsIn(part, max), "\n", max) : []);
  const own = packed(wordsIn(body, room), "\n", room).map((part) => `${head}\n${part}${foot}`);
  return [...rest(pre), ...own, ...(tail.length ? splitBlock(tail.join("\n"), max) ?? rest(tail) : [])];
}
// Lines, with any line longer than the room split at words.
function wordsIn(ls, room) { return ls.flatMap((l) => (utf8Len(l) <= room ? [l] : packed(l.match(/\S+\s*/g) ?? [l], "", room))); }

// Herdr's Markdown reads $…$ as inline math and shows the text between as written, so a
// **bold** span between two prices keeps its asterisks. Dollar signs outside code are
// escaped; one already escaped stays as it is.
export function escapeDollars(md) {
  let fence = null;
  return String(md ?? "").split("\n").map((line) => {
    const f = line.match(FENCE);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; return line; }
    if (fence || !line.includes("$")) return line;
    return line.split(/(`+[^`]*`+)/).map((part, i) => (i % 2 ? part : part.replace(/\\?\$/g, (m) => (m === "$" ? "\\$" : m)))).join("");
  }).join("\n");
}

// The start of a Markdown block, for an open reply past its 200,000-character cap: it ends at
// a paragraph when one ends in the last third, else at a word. It never ends on a bare list
// marker or a table row cut short, closes a bold left open, then adds "…".
export function cutMd(md, n) {
  let s = String(md ?? "").slice(0, n);
  const para = s.lastIndexOf("\n\n");
  s = para > n * 0.66 ? s.slice(0, para) : s.replace(/\s+\S*$/, "");
  const lines = s.trimEnd().split("\n");
  const whole = String(md ?? "").split("\n");
  const bare = /^\s*(?:[-*+]|\d+[.)])?\s*(?:\*\*|__|\*|_)?\s*$/;
  const shortRow = (i) => /^\s*\|/.test(lines[i]) && lines[i].trimEnd() !== (whole[i] ?? "").trimEnd();
  while (lines.length > 1 && (bare.test(lines.at(-1)) || shortRow(lines.length - 1))) lines.pop();
  let last = lines.at(-1) ?? "";
  if ((last.match(/\*\*/g) ?? []).length % 2) last = `${last.trimEnd()}**`;
  lines[lines.length - 1] = last;
  const body = lines.join("\n").trimEnd();
  return /^\s*\|/.test(last) ? `${body}\n\n…` : `${body} …`;
}

// The full-window gallery: an image's box inside the room it has, its shape kept, never
// larger than its own pixels (a small image stays sharp). Unknown dimensions take the room.
export function galleryBox(img, roomW, roomH) {
  const W = Math.max(40, Math.floor(roomW));
  const H = Math.max(40, Math.floor(roomH));
  const w = Number(img?.w);
  const h = Number(img?.h);
  if (!(w > 0 && h > 0)) return { w: W, h: H };
  const k = Math.min(1, W / w, H / h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

// The viewer's reading panel: the turn that carried the images, beside the image from
// VIEWER.WIDE design px (VIEWER.PANEL_W wide, about 68 characters a line at 14 px), else
// docked under it (VIEWER.PANEL_H tall, at most 45% of the window, its text at most
// VIEWER.MEASURE wide). The thumbnail strip under the image is shorter when narrow.
export const VIEWER = Object.freeze({
  TOP: 52, WIDE: 1100, PANEL_W: 500, PANEL_H: 300, MEASURE: 560, STRIP: 64, STRIP_NARROW: 52,
  THUMB: 40, THUMB_NARROW: 32, SIDE: 64, HEAD: 40, FOOT: 48, PAD: 24,
});
// The viewer's parts for a window W by H (design px), with the panel shown or not: whether
// it is wide, the panel's size, the strip and thumbnail heights, and the room the image has
// (galleryBox), between the round buttons and above the strip.
export function viewerLayout(W, H, panel = true) {
  const w = Math.max(200, Number(W) || 0);
  const h = Math.max(200, Number(H) || 0);
  const wide = w >= VIEWER.WIDE;
  const strip = wide ? VIEWER.STRIP : VIEWER.STRIP_NARROW;
  const thumb = wide ? VIEWER.THUMB : VIEWER.THUMB_NARROW;
  const panelW = panel && wide ? VIEWER.PANEL_W : 0;
  const panelH = panel && !wide ? Math.min(VIEWER.PANEL_H, Math.round(h * 0.45)) : 0;
  const stageW = w - (panelW ? panelW + 1 : 0);
  const stageH = h - VIEWER.TOP - 1 - (panelH ? panelH + 1 : 0);
  return {
    wide, panel: Boolean(panel), panelW, panelH, strip, thumb, stageW, stageH,
    room: { w: Math.max(40, stageW - 2 * VIEWER.SIDE), h: Math.max(40, stageH - strip - 16) },
    // A narrow panel's text column and its side padding, centred under the image.
    padX: panelH ? Math.max(VIEWER.PAD, Math.floor((w - VIEWER.MEASURE) / 2)) : VIEWER.PAD,
  };
}
// A key in the viewer: the action, or null. Arrows and h, l step the images and wrap; with
// the panel shown j, k and Space scroll the reply a block, else they step as before.
export function viewerKey(e, panel = true) {
  const m = e?.modifiers ?? {};
  if (m.platform || m.control || m.alt || m.function) return null;
  const k = e?.key ?? "";
  if (["left", "up", "h", "pageup"].includes(k)) return "prev";
  if (["right", "down", "l", "pagedown"].includes(k)) return "next";
  if (k === "j" || k === "space") return panel ? "down" : "next";
  if (k === "k") return panel ? "up" : "prev";
  if (k === "i") return "panel";
  if (k === "c") return "copy";
  if (k === "home") return "first";
  if (k === "end") return "last";
  if (k === "escape" || k === "q" || k === "enter") return "close";
  if (/^[1-9]$/.test(k)) return `go:${Number(k) - 1}`;
  return null;
}
// One line of a prompt as pieces: plain text, and each pasted-image label ([Image #3]) with
// its number. A label inside an inline code span stays text.
export function labelPieces(line) {
  const out = [];
  for (const tok of inlineTokens(String(line ?? ""), { markdown: false })) {
    const m = tok.kind === "label" ? /^\[Image #(\d+)\]$/.exec(tok.t) : null;
    if (m) out.push({ t: tok.t, n: Number(m[1]) });
    else if (out.length && out.at(-1).n == null) out.at(-1).t += tok.t;
    else out.push({ t: tok.t });
  }
  return out;
}
// j and k in the viewer's reading panel. A scroll handle only reveals a child with the least
// scroll, and cannot say where the view is, so the panel keeps its own estimate (y, from these
// moves and the wheel) and the parts' measured heights (sizes; pt and pb are the scroll area's
// padding). The places a press can go: the top, the start of each part that can reach the
// top of the view, and the end. d 1 goes to the next place below y, -1 to the one above.
// Returns { y, steps } (the parts to reveal in turn), or null when there is nowhere to go.
// Going down, the first step reveals the first part whose bottom then puts the view at or
// past the place (overshooting by less than that part), and the second brings the place's
// part back to the top edge.
export function replyScroll(sizes, viewH, y, d, pt = 4, pb = 20) {
  const n = sizes.length;
  if (!n || !(viewH > 0)) return null;
  const start = [];
  let at = pt;
  for (const h of sizes) { start.push(at); at += Math.max(0, h); }
  const maxY = Math.max(0, at + pb - viewH);
  if (maxY < 1) return null;
  const places = [0];
  for (let k = 1; k < n; k++) if (start[k] < maxY - 1) places.push(start[k]);
  places.push(maxY);
  const to = d > 0 ? places.find((p) => p > y + 1) : places.filter((p) => p < y - 1).pop();
  if (to == null) return null;
  if (to === maxY) return { y: to, steps: [n - 1] };
  const part = to === 0 ? 0 : start.indexOf(to);
  if (to < y) return { y: to, steps: [part] };
  let m = part;
  while (m < n - 1 && start[m] + sizes[m] - viewH < to - 1) m++;
  const lands = start[m] + sizes[m] - viewH;
  return { y: to, steps: Math.abs(lands - to) <= 1 ? [m] : [m, part] };
}

// A reply as blocks for the reading panel, so j and k move a paragraph at a time: split at
// blank lines outside fenced code, a block that starts indented (a list item's next
// paragraph, which alone would read as code) kept with the one before, and each block
// longer than Herdr draws split again (mdChunks).
export function replyBlocks(md) {
  const blocks = [];
  let cur = [];
  let fence = null;
  const flush = () => {
    if (!cur.length) return;
    const b = cur.join("\n");
    if (blocks.length && /^[ \t]/.test(cur[0])) blocks[blocks.length - 1] += `\n\n${b}`;
    else blocks.push(b);
    cur = [];
  };
  for (const line of String(md ?? "").split("\n")) {
    const f = line.match(FENCE);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; }
    else if (!fence && !line.trim()) { flush(); continue; }
    cur.push(line);
  }
  flush();
  return blocks.flatMap((b) => mdChunks(b));
}

// A reply block (replyBlocks) that is one fenced code block and nothing else: its language
// and its code, for the viewer's code box. Anything else, or a fence left open, is null.
export function fencedBlock(block) {
  const m = String(block ?? "").match(/^ {0,3}(`{3,}|~{3,})[ \t]*([^\n`]*)\n([\s\S]*?)\n {0,3}(`{3,}|~{3,})[ \t]*$/);
  if (!m || m[4][0] !== m[1][0] || m[4].length < m[1].length) return null;
  return { lang: m[2].trim().split(/\s+/)[0] || "", text: m[3] };
}

// A mono character's width in ems, for counting wrapped rows of code, a tool's output and
// a call's command. Most terminal fonts are 0.6 em; a little over, so a count runs long
// (a spare blank row) rather than short (a cut last row).
export const MONO_EM = 0.62;

// Text cut to `max` wrapped rows of `per` characters (codeRows' wrapping): the text, its
// rows (at most max), and whether it was cut. A cut text ends in an ellipsis.
export function wrapCap(text, per, max) {
  const src = String(text ?? "");
  const all = codeRows(src, per);
  if (all <= max) return { text: src, rows: Math.max(1, all), cut: false };
  const p = Math.max(8, Math.floor(per));
  const out = [];
  let used = 0;
  for (const line of src.split("\n")) {
    const n = codeRows(line, p);
    if (used + n <= max) { out.push(line); used += n; if (used === max) break; continue; }
    const room = (max - used) * p - 1;
    if (room > 0) out.push(line.slice(0, room));
    used = max;
    break;
  }
  let kept = out.join("\n").replace(/\s+$/, "");
  while (kept && codeRows(`${kept}…`, p) > max) kept = kept.slice(0, -1).replace(/\s+$/, "");
  return { text: `${kept}…`, rows: max, cut: true };
}

export function codeRows(text, per) {
  const p = Math.max(8, Math.floor(per));
  let rows = 0;
  for (const line of (text ?? "").split("\n")) {
    let n = 1, used = 0;
    for (const word of line.match(/\S+\s*/g) ?? []) {
      let w = word.length;
      if (used > 0 && used + word.trimEnd().length > p) { n++; used = 0; }
      while (w > p) { if (used > 0) { n++; used = 0; } w -= p; n++; }
      used += w;
    }
    rows += n;
  }
  return rows;
}

// A prompt clipped to `lines` wrapped lines of `per` characters and at most `maxChars`.
// more: the wrapped lines left out (0 when the whole text fits).
export function clipPrompt(text, lines, per, maxChars = 600) {
  const all = (text ?? "").replace(/\s+$/, "");
  const p = Math.max(8, per);
  const total = wrappedLines(all, p);
  if (total <= lines && all.length <= maxChars) return { text: all, more: 0 };
  const out = [];
  let used = 0;
  for (const l of all.split("\n")) {
    const need = Math.max(1, Math.ceil(l.length / p));
    if (used + need <= lines) { out.push(l); used += need; continue; }
    const room = lines - used;
    if (room > 0) out.push(`${l.slice(0, room * p).replace(/\s+\S*$/, "")} …`);
    used = lines;
    break;
  }
  let shown = out.join("\n");
  if (shown.length > maxChars) shown = `${shown.slice(0, maxChars).replace(/\s+\S*$/, "")} …`;
  return { text: shown, more: Math.max(1, total - Math.min(lines, wrappedLines(shown, p))) };
}

// Local calendar day of a time, for day dividers.
export function dayKey(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function dayLabel(ts, now = Date.now()) {
  const k = dayKey(ts);
  if (k === dayKey(now)) return "Today";
  if (k === dayKey(now - 86400000)) return "Yesterday";
  const d = new Date(ts);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

// A day divider's words: {name: "Yesterday", date: "Wed 4 Nov"} for today and yesterday,
// {name: "Monday 2 Nov", date: null} further back.
export function dayParts(ts, now = Date.now()) {
  const d = new Date(ts);
  const wd = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const label = dayLabel(ts, now);
  const date = `${d.getDate()} ${months[d.getMonth()]}`;
  return label === "Today" || label === "Yesterday" ? { name: label, date: `${wd.slice(0, 3)} ${date}` } : { name: `${wd} ${date}`, date: null };
}

// The day on a rail card: the day bands' words, short. "Today", "Yesterday", then the short
// weekday and the date, "Fri 13 Nov", with the year when it is not this year,
// "Mon 28 Dec 2025". One rule at every distance, so the card and the list agree.
export function railDay(ts, now = Date.now()) {
  if (!ts) return null;
  const label = dayLabel(ts, now);
  if (label === "Today" || label === "Yesterday") return label;
  const d = new Date(ts);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  const year = d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${wd} ${label}${year}`;
}

// "#12" (or "#" while typing it) in the filter field jumps to a turn instead of filtering.
// Returns the turn number, 0 for a bare "#", or null when the text is a filter.
export function jumpTarget(q) {
  const m = (q ?? "").trim().match(/^#(\d*)$/);
  return m ? Number(m[1] || 0) : null;
}

// ---- collapsed rows -------------------------------------------------------------------

// Width of one character in "average characters": East Asian wide characters and emoji
// take two.
export function charUnits(ch) {
  const c = ch.codePointAt(0);
  if (c < 0x1100) return 1;
  return (c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3)
    || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60)
    || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd) ? 2 : 1;
}
// Text with no wide character (and no surrogate pair) is one unit per UTF-16 code unit, so
// its width is its length. The test runs natively; the per-character loop is only for the
// rest. (Herdr runs mods in an interpreter that interrupts a slow render.)
const NARROW = /^[\u0000-\u10ff]*$/;
const units = (s) => {
  if (NARROW.test(s)) return s.length;
  let n = 0;
  for (const ch of s) n += charUnits(ch);
  return n;
};
// The longest head of s that fits in `room` units.
const headFit = (s, room) => {
  if (NARROW.test(s)) return s.slice(0, Math.max(0, room));
  let head = "";
  let hu = 0;
  for (const ch of s) { const u = charUnits(ch); if (hu + u > room) break; head += ch; hu += u; }
  return head;
};

// Text wrapped at word boundaries into lines of at most `perLine` average characters
// (a long unbroken token, such as a path, breaks hard), clipped to `limit` lines. The
// last line ends in "…" only when text was left out. Newlines collapse to spaces.
// Returns { lines: string[], cut } . The drawing shows each line as its own one-line
// element, so the row height the list is given is exact.
//
// Only the start of the text is read: `limit` lines of `perLine` units cover at most
// limit * (perLine + 1) characters, so the text is cut a line beyond that before it is
// split. A word the cut splits is dropped, so it cannot fit where the whole word would
// not; a split token longer than a line is kept, since it breaks hard either way.
export function rowLines(text, limit, perLine) {
  const per = Math.max(4, Math.floor(perLine));
  const max = Math.max(1, Math.floor(limit));
  const cap = (max + 1) * (per + 1) + 2;
  const raw = String(text ?? "");
  let src = (raw.length > cap * 8 ? raw.slice(0, cap * 8) : raw).replace(/\s+/g, " ").trim();
  let clipped = raw.length > cap * 8;
  if (src.length > cap) {
    src = src.slice(0, cap);
    clipped = true;
    const sp = src.lastIndexOf(" ");
    if (sp > 0 && cap - sp <= per + 1) src = src.slice(0, sp);
  }
  const words = src ? src.split(" ") : [];
  const lines = [];
  let line = "";
  let used = 0;
  let cut = false;
  const push = () => { lines.push(line); line = ""; used = 0; };
  outer: for (let wi = 0; wi < words.length; wi++) {
    let w = words[wi];
    let wu = units(w);
    if (used && used + 1 + wu > per) { push(); if (lines.length >= max) { cut = true; break; } }
    // Hard breaks for a token longer than a line.
    while (wu > per - (used ? used + 1 : 0)) {
      const head = headFit(w, per - (used ? used + 1 : 0));
      if (!head) { push(); if (lines.length >= max) { cut = true; break outer; } continue; }
      line += (used ? " " : "") + head;
      used += (used ? 1 : 0) + units(head);
      w = w.slice(head.length);
      wu = units(w);
      push();
      if (lines.length >= max) { cut = Boolean(w) || wi < words.length - 1 || clipped; break outer; }
    }
    if (!w) continue;
    line += (used ? " " : "") + w;
    used += (used ? 1 : 0) + wu;
  }
  if (line && lines.length < max) lines.push(line);
  else if (line) cut = true;
  if (clipped && lines.length) cut = true;
  if (cut && lines.length) {
    // Room for the ellipsis on the last line.
    let last = lines[lines.length - 1];
    if (units(last) + 1 > per) last = headFit(last, per - 1);
    lines[lines.length - 1] = `${last.replace(/[\s.,;:]+$/, "")}…`;
  }
  return { lines, cut };
}

// A reply as one paragraph of plain text for a row preview: no emphasis, code, heading or
// quote marks; list items joined with " · "; fenced code as "[code]"; link text kept.
// With `max`, stops once it has about that many characters (a row shows a few lines), and
// reads at most max * 8 + 512 characters outside fenced code. A fence's body is skipped
// with one search for its closing line, so the prose after a long code block is still
// read and a fence costs no per-line work.
// The start of a reply as Markdown for a collapsed row: whole source lines, as many as fit
// in `lines` reading lines of `per` characters (a blank line, the gap between blocks,
// counts half a line; a code line counts one and never wraps). A code fence cut open is
// closed, so the rest of the row does not turn into code. { md, cut, lines }.
export function mdPreview(md, lines, per, maxChars = Math.min(4000, (lines + 2) * Math.max(8, per) * 3)) {
  const src = String(md ?? "").slice(0, maxChars).replace(/\r\n?/g, "\n").split("\n");
  const w = Math.max(8, per);
  const out = [];
  let used = 0;
  let fence = null;
  let cut = false;
  for (let i = 0; i < src.length; i++) {
    const line = src[i];
    const open = FENCE_OPEN.exec(line);
    let cost;
    if (fence) cost = closesFence(line, fence) ? 0 : 1;
    else if (open) cost = 0;
    else if (!line.trim()) cost = out.length && out[out.length - 1].trim() ? 0.5 : 0;
    else cost = Math.max(1, Math.ceil(units(line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, "  ").replace(/[*_`]/g, "")) / w));
    if (used + cost > lines + 1e-9) {
      cut = true;
      // A paragraph or list item longer than the lines left: its start, cut at a word.
      const room = Math.floor(lines - used + 1e-9);
      if (!fence && !open && line.trim() && room >= 1) {
        const max = room * w - 2;
        let end = 0;
        let n = 0;
        for (const m of line.matchAll(/\S+\s*/g)) { const u = units(m[0]); if (n + u > max) break; n += u; end = m.index + m[0].length; }
        if (end > 0) { out.push(`${line.slice(0, end).trimEnd()} …`); used += room; }
      }
      break;
    }
    used += cost;
    out.push(line);
    if (fence) { if (closesFence(line, fence)) fence = null; } else if (open) fence = open[1];
  }
  if (!cut && src.length && String(md ?? "").length > maxChars) cut = true;
  while (out.length && !out[out.length - 1].trim()) out.pop();
  if (fence) out.push(fence);
  return { md: out.join("\n"), cut, lines: Math.max(1, Math.ceil(used)), gaps: out.filter((l, i) => !l.trim() && out[i - 1]?.trim()).length };
}

export function flattenMd(md, max = Infinity) {
  const parts = [];
  let have = 0;
  const src = String(md ?? "");
  const budget = Number.isFinite(max) ? max * 8 + 512 : Infinity;
  let read = 0;
  let at = 0;
  while (at <= src.length && have <= max && read < budget) {
    let nl = src.indexOf("\n", at);
    if (nl < 0) nl = src.length;
    let raw = src.slice(at, nl);
    if (read + raw.length > budget) raw = raw.slice(0, budget - read);
    read += raw.length + 1;
    at = nl + 1;
    const f = raw.match(/^\s*(```+|~~~+)/);
    if (f) {
      // The closing line: the same character, at least as many, and nothing else.
      parts.push({ t: "[code]", bullet: false });
      const ch = f[1][0] === "`" ? "`" : "~";
      const close = new RegExp(`\\n[ \\t]*\\${ch}{${f[1].length},}[ \\t]*(?=\\r?\\n|$)`, "g");
      close.lastIndex = nl;
      const c = close.exec(src);
      if (!c) break;
      at = c.index + c[0].length + 1;
      continue;
    }
    let l = raw.replace(/^\s*(>\s*)+/, "");
    // A table row: its cells joined with a middle dot, as bullets are; its rule line goes.
    if (/^\s*\|.*\|\s*$/.test(l)) {
      if (/^[\s|:-]+$/.test(l)) continue;
      const cells = l.trim().slice(1, -1).split("|").map((c) => c.replace(/\*\*|__|`/g, "").trim()).filter(Boolean);
      for (const c of cells) { parts.push({ t: c, bullet: true }); have += c.length + 3; }
      continue;
    }
    const bullet = /^\s*([-*+]|\d+[.)])\s+/.test(l) && !/^\s*([-*_]\s*){3,}$/.test(l);
    l = l.replace(/^\s*#{1,6}\s+/, "").replace(/^\s*([-*+]|\d+[.)])\s+/, "").replace(/^\s*([-*_]\s*){3,}$/, "");
    l = l.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*|__|`/g, "")
      .replace(/(^|[\s(])[*_]+(?=\S)/g, "$1").replace(/(\S)[*_]+(?=[\s).,;:!?]|$)/g, "$1").trim();
    if (l) { parts.push({ t: l, bullet }); have += l.length + 1; }
  }
  let out = "";
  parts.forEach((p, i) => {
    if (i === 0) out = p.t;
    else out += (p.bullet && parts[i - 1].bullet ? " · " : " ") + p.t;
  });
  return out.replace(/\s+/g, " ").trim();
}

// Text cut in the middle to at most `max` characters: "plugin:rev…ew-pr".
export function middle(text, max) {
  const s = [...String(text ?? "")];
  if (s.length <= max) return s.join("");
  const keep = Math.max(2, max - 1);
  const head = Math.ceil(keep / 2);
  return `${s.slice(0, head).join("")}…${s.slice(s.length - (keep - head)).join("")}`;
}

// Row geometry, shared by the drawing and the stated heights. A collapsed turn is drawn as
// a chat exchange, 16 px in from each side (where an open turn's text starts): the person's
// message in a bubble on the right (an agent's on the left, under its sender's name), the
// strip under it (META: copy, pin, "#7 · 9:12 AM", shown on the selected turn), the line
// ("Worked for 2m 31s" over a hairline, LINE), the reply as plain text, then the strip under
// the reply (ACTS: copy, quote, select, terminal, shown on the selected turn). Both strips
// keep their height when they show nothing, so nothing moves when a turn is selected. The
// bubble is at most 82% of the text width (90% under 320 px) and has 10 px of padding each
// side and 6 px above and below. The *_CHAR widths are measured at 13 px; readType scales
// them to the reading size.
export const ROW = Object.freeze({
  META: 16, STATS: 16, LINE: 24, ACTS: 16, MORE: 18, PAD_T: 8, PAD_B: 10, GAP: 6, PAD_X: 16,
  BUBBLE_PX: 10, BUBBLE_PY: 6, PROMPT_CHAR: 6.7, AGENT_CHAR: 6.5, REPLY_CHAR: 6.7, CHIP_CHAR: 7.3,
});

// ---- reading type ----
// Message and reply text is set for reading, a step above the pane's 11.5 to 12.5 px labels
// (names, dates, the stats line and Show more keep those): settings textSize, 14 px by
// default, 12 to 18. Its lines are LINE_RATIO times the size apart, 22 px at 14 (WCAG 2.2 SC 1.4.8
// asks for at least 1.5; Orca's chat uses 1.54), and a line holds about MEASURE characters however wide the pane (SC 1.4.8: no
// more than 80; Bringhurst: 45 to 75, 66 the ideal). PROSE_EM is an average character of
// English prose in the system sans, in em, so MEASURE * PROSE_EM em is the line's width.
export const TEXT_SIZE = 14;
export const LINE_RATIO = 1.57;
export const TEXT_RANGE = Object.freeze([12, 18]);
export const MEASURE = 70;
export const PROSE_EM = 0.47;
// settings width: how long a reading line may be, in characters. Comfortable is MEASURE
// (the line the owner found right, 461 px at 14 px), Wide is 90 (the top of
// Butterick's 45 to 90), Full has no limit. A bubble stops at Wide's line even in Full.
export const WIDTHS = Object.freeze({ comfortable: MEASURE, wide: 90, full: Infinity });
export const WIDTH_NAMES = Object.freeze(Object.keys(WIDTHS));
export function widthChars(width) { return WIDTHS[width] ?? MEASURE; }
export function readType(size = TEXT_SIZE, chars = MEASURE) {
  const px = Number.isFinite(size) ? Math.max(TEXT_RANGE[0], Math.min(TEXT_RANGE[1], size)) : TEXT_SIZE;
  const k = px / 13;
  const n = chars > 0 ? chars : MEASURE;
  const line = (c) => (Number.isFinite(c) ? Math.round(c * PROSE_EM * px) : Infinity);
  return Object.freeze({
    size: px, small: px - 0.5, line: Math.round(px * LINE_RATIO),
    prompt: ROW.PROMPT_CHAR * k, agent: ROW.AGENT_CHAR * k, reply: ROW.REPLY_CHAR * k,
    measure: line(n), bubble: line(Math.min(n, WIDTHS.wide)),
  });
}

// The widest a bubble can be (its text no wider than a reading line), and the width of the
// text inside it.
export function bubbleMax(width, size = TEXT_SIZE, chars = MEASURE) {
  const fit = Math.floor((width - 2 * ROW.PAD_X) * (width < 320 ? 0.9 : 0.82));
  return Math.max(80, Math.min(fit, readType(size, chars).bubble + 2 * ROW.BUBBLE_PX));
}
export function rowTextWidth(width, _agent = false, size = TEXT_SIZE, chars = MEASURE) { return Math.max(60, bubbleMax(width, size, chars) - 2 * ROW.BUBBLE_PX); }
// The pane's text width, less the exchange's padding (labels, code), and the reply's: that,
// at most one reading line.
export function replyWidth(width) { return Math.max(60, width - 2 * ROW.PAD_X); }
export function readWidth(width, size = TEXT_SIZE, chars = MEASURE) { return Math.min(replyWidth(width), readType(size, chars).measure); }
// Side gutters: GUTTER.PCT of the pane each side, never under MIN or over MAX px. The column
// holds the text, at most one reading line, and the turns' rows pad ROW.PAD_X inside it, so
// columnWidth is the text plus 2 * ROW.PAD_X; a pane wider than that centres it, which
// splits the spare room evenly. Bubbles and replies end at the same edge.
export const GUTTER = Object.freeze({ PCT: 0.08, MIN: 24, MAX: 56 });
export function gutter(paneW) { return Math.max(GUTTER.MIN, Math.min(GUTTER.MAX, Math.round(paneW * GUTTER.PCT))); }
export function columnWidth(paneW, size = TEXT_SIZE, chars = MEASURE) {
  const text = Math.max(60, Math.min(readType(size, chars).measure, paneW - 2 * gutter(paneW)));
  return Math.min(paneW, text + 2 * ROW.PAD_X);
}
// The width that fits a reading line: the line and GUTTER.MAX each side. 573 px at 14 px
// (Wide 704); it scales with Text size (505 at 12, 704 at 18). Cmd-Shift-T opens Threads at
// this width and "Keep the pane at this width" holds it there. Full has none (Infinity).
export function fitWidth(size = TEXT_SIZE, chars = MEASURE) { return readType(size, chars).measure + 2 * GUTTER.MAX; }

// ---- pasted images over a message ----
// Tiles over the message, on the right: each THUMB high, about a third of the widest bubble
// (56 to 120 px), and as wide as its image's shape allows between 0.75 and 1.5 times that.
export const TILE_GAP = 6;
export function thumbSize(width, size = TEXT_SIZE, chars = MEASURE) { return Math.max(56, Math.min(120, Math.floor(bubbleMax(width, size, chars) / 3) - 4)); }
// dims: per image { w, h } once decoded, else null. The tiles that fit in the widest bubble,
// in order, with "+N" for the rest: { size, tiles: [{ i, w, x }], more, width }, x from the
// strip's left edge. The "+N" chip takes a tile's place when some do not fit.
export function tileRow(dims, width, text = TEXT_SIZE, chars = MEASURE) {
  const size = thumbSize(width, text, chars);
  const room = bubbleMax(width, text, chars);
  const ws = dims.map((d) => (d && d.w > 0 && d.h > 0 ? Math.round(Math.max(size * 0.75, Math.min(size * 1.5, (size * d.w) / d.h))) : size));
  const chip = 44;
  const tiles = [];
  let x = 0;
  for (let i = 0; i < ws.length; i++) {
    const last = i === ws.length - 1;
    const need = x + ws[i] + (last ? 0 : TILE_GAP + chip);
    if (tiles.length && need > room) break;
    tiles.push({ i, w: ws[i], x });
    x += ws[i] + TILE_GAP;
  }
  const more = ws.length - tiles.length;
  return { size, tiles, more, width: x - TILE_GAP + (more ? TILE_GAP + chip : 0) };
}

// Height of a collapsed exchange with p prompt lines and r reply lines of `line` px, and
// `more` Show more lines (one under a cut message, one under a cut reply). The reply starts
// straight under the message, with no name over it.
// An agent's message has its sender's name over the bubble (META and a gap more).
export function rowHeight(p, r, more = 0, line = readType().line, agent = false) {
  return ROW.PAD_T + (agent ? ROW.META + ROW.GAP : 0) + 2 * ROW.BUBBLE_PY + line * p + ROW.GAP + ROW.META
    + ROW.GAP + ROW.LINE + ROW.GAP + line * r + ROW.GAP + ROW.ACTS + ROW.PAD_B + ROW.MORE * more;
}

// A command row's chip and its argument lines: the chip takes at most 45% of the line
// and the arguments wrap in the space to its right.
export function commandLayout(name, args, width, limit, agent = false, size = TEXT_SIZE, chars = MEASURE) {
  const rt = readType(size);
  const tw = rowTextWidth(width, agent, size, chars);
  const maxChip = Math.floor(tw * 0.45);
  const chipChars = Math.max(3, Math.floor((maxChip - 12) / ROW.CHIP_CHAR));
  const label = middle(name, chipChars);
  const chipW = Math.min(maxChip, Math.ceil([...label].length * ROW.CHIP_CHAR + 12));
  const per = Math.floor((tw - chipW - 6) / rt.prompt);
  const a = args ? rowLines(args, limit, per) : { lines: [], cut: false };
  return { label, chipW, lines: a.lines, cut: a.cut, rows: Math.max(1, a.lines.length) };
}

// The lines a collapsed row shows: { p, r, prompt, reply, chip?, kinds?, q }. kinds, when
// the prompt quotes something, says how each prompt line is drawn: "q" a muted quote line
// with a bar, "qonly" a quote that is the whole prompt (foreground, with the bar), "c" the
// person's own words. q: the quote lines shown.
export function rowShape({ prompt, reply, cmd, width, promptLines, replyLines, agent = false, replyLimit = null, quotes = true, size = TEXT_SIZE, chars = MEASURE }) {
  const rt = readType(size);
  const tw = rowTextWidth(width, agent, size, chars);
  let pr;
  let chip = null;
  if (cmd) {
    chip = commandLayout(cmd.name, cmd.args, width, promptLines, agent, size, chars);
    pr = { lines: chip.lines, rows: chip.rows, cut: chip.cut };
  } else {
    pr = quotes ? quoteRows(prompt, promptLines, tw, agent, size) : null;
    if (!pr) {
      // A task notification that opens a session carries no text: the sender label names it.
      const l = rowLines(prompt || (agent ? "(no message text)" : "(empty prompt)"), promptLines, tw / (agent ? rt.agent : rt.prompt));
      pr = { lines: l.lines, rows: Math.max(1, l.lines.length), cut: l.cut };
    }
  }
  const rl = rowLines(reply, replyLimit ?? replyLines, readWidth(width, size, chars) / rt.reply);
  const r = Math.max(1, rl.lines.length);
  const pMore = Boolean(pr.cut);
  const rMore = Boolean(rl.cut) && (replyLimit ?? replyLines) > 1;
  // The bubble is as wide as its widest line (a command's chip and arguments side by side),
  // and wide enough for "Show more".
  const ch = agent ? rt.agent : rt.prompt;
  const widest = chip ? chip.chipW + 6 + Math.max(0, ...pr.lines.map((l) => units(l))) * ch
    : Math.max(0, ...pr.lines.map((l, i) => units(l) * ch + (pr.kinds && pr.kinds[i] !== "c" ? QUOTE_INSET : 0)));
  const bubbleW = Math.min(bubbleMax(width, size, chars), Math.ceil(Math.max(pMore ? 96 : 40, widest + 4) + 2 * ROW.BUBBLE_PX));
  return {
    p: pr.rows, r, prompt: pr.lines, reply: rl.lines, chip, kinds: pr.kinds ?? null, q: pr.q ?? 0, pMore, rMore, bubbleW,
    height: rowHeight(pr.rows, r, (pMore ? 1 : 0) + (rMore ? 1 : 0), rt.line, agent),
  };
}

// ---- prompt quotes ----------------------------------------------------------------------

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const QUOTE_LINE = /^ {0,3}>/;
function closesFence(line, fence) {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return Boolean(m) && m[1][0] === fence[0] && m[1].length >= fence.length;
}

// A prompt as runs in source order: [{ quote: true, lines }, { quote: false, lines }, …].
// A quote line is up to 3 spaces then ">" (the space after it is optional); nested "> >"
// is one level, and a bare ">" is a blank quote line. Lines inside a fenced code block are
// never quote lines. There is no lazy continuation: a line without ">" ends the quote, so
// a comment written straight under a quote stays a comment. Blank lines at either end of
// a run are dropped, then runs left empty. Reads at most max * 8 characters.
export function promptParts(text, max = 1200) {
  const raw = String(text ?? "");
  const src = raw.length > max * 8 ? raw.slice(0, max * 8) : raw;
  const runs = [];
  let fence = null;
  for (const line of src.split("\n")) {
    let quote = false;
    let body = line.replace(/\r$/, "");
    if (fence) { if (closesFence(body, fence)) fence = null; }
    else {
      const f = FENCE_OPEN.exec(body);
      if (f) fence = f[1];
      else if (QUOTE_LINE.test(body)) { quote = true; body = body.replace(/^(?: {0,3}> ?)+/, ""); }
    }
    const last = runs[runs.length - 1];
    if (last && last.quote === quote) last.lines.push(body);
    else runs.push({ quote, lines: [body] });
  }
  const blank = (l) => l.trim() === "";
  for (const r of runs) {
    while (r.lines.length && blank(r.lines[0])) r.lines.shift();
    while (r.lines.length && blank(r.lines[r.lines.length - 1])) r.lines.pop();
  }
  return runs.filter((r) => r.lines.length);
}

// A line with "…" at its end, within `per` units.
function withEllipsis(line, per) {
  if (line.endsWith("…")) return line;
  const room = Math.max(1, Math.floor(per) - 1);
  return `${(units(line) > room ? headFit(line, room) : line).replace(/[\s.,;:]+$/, "")}…`;
}

// The bar and gap in front of a quote line.
export const QUOTE_INSET = 10;

// A collapsed row's prompt lines when it quotes something, or null when it does not. Each
// quote run takes one truncated line within the Prompt lines budget; the comment wraps as
// usual; when the budget would hide every comment line, the comment takes the last line,
// so with one line the row shows the comment only. A prompt that is only a quote is the
// whole message: it wraps within the budget.
export function quoteRows(prompt, budget, tw, agent = false, size = TEXT_SIZE) {
  if (!prompt || !/(^|\n) {0,3}>/.test(prompt)) return null;
  const parts = promptParts(prompt);
  if (!parts.some((r) => r.quote)) return null;
  const rt = readType(size);
  const max = Math.max(1, Math.floor(budget));
  const qper = (tw - QUOTE_INSET) / rt.agent;
  const per = tw / (agent ? rt.agent : rt.prompt);
  if (!parts.some((r) => !r.quote)) {
    const l = rowLines(parts.map((r) => r.lines.join("\n")).join("\n"), max, (tw - QUOTE_INSET) / (agent ? rt.agent : rt.prompt));
    return { lines: l.lines, rows: Math.max(1, l.lines.length), kinds: l.lines.map(() => "qonly"), q: l.lines.length, cut: l.cut };
  }
  const lines = [];
  const kinds = [];
  let left = max;
  let comment = false;
  let cut = false;
  let lastPer = per;
  for (const r of parts) {
    if (left <= 0) { cut = true; break; }
    if (r.quote) {
      // Keep the last line for the first comment while none has shown.
      if (!comment && left <= 1) continue;
      const l = rowLines(r.lines.join(" "), 1, qper);
      if (!l.lines.length) continue;
      lines.push(l.lines[0]);
      kinds.push("q");
      left--;
      lastPer = qper;
    } else {
      const l = rowLines(r.lines.join("\n"), left, per);
      lines.push(...l.lines);
      kinds.push(...l.lines.map(() => "c"));
      left -= l.lines.length;
      comment = true;
      lastPer = per;
      if (l.cut) { cut = true; break; }
    }
  }
  if (cut && lines.length) lines[lines.length - 1] = withEllipsis(lines[lines.length - 1], lastPer);
  return { lines, rows: Math.max(1, lines.length), kinds, q: kinds.filter((k) => k === "q").length, cut };
}

// The open card's YOU block text, clipped: each quote run at most `quoteLines` lines and
// the comment at most `commentLines` wrapped lines in all, at most maxChars characters,
// written back as source (quote runs as "> " lines). more: the wrapped lines left out.
export function clipYou(text, { quoteLines = 2, commentLines = 3, per = 40, maxChars = 600 } = {}) {
  const parts = promptParts(text, 4000);
  const p = Math.max(8, per);
  let total = 0;
  let shown = 0;
  let commentLeft = commentLines;
  let chars = maxChars;
  const out = [];
  for (const r of parts) {
    const need = r.lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / p)), 0);
    total += need;
    if (chars <= 0) continue;
    if (r.quote) {
      const c = clipPrompt(r.lines.join("\n"), quoteLines, p, chars);
      const kept = c.text.split("\n");
      if (c.more && !kept[kept.length - 1].endsWith("…")) kept[kept.length - 1] += " …";
      const s = kept.map((l) => (l ? `> ${l}` : ">")).join("\n");
      out.push(s);
      chars -= s.length;
      shown += Math.min(wrappedLines(c.text, p), need);
    } else {
      if (commentLeft <= 0) continue;
      const c = clipPrompt(r.lines.join("\n"), commentLeft, p, chars);
      out.push(c.text);
      chars -= c.text.length;
      const used = wrappedLines(c.text, p);
      shown += Math.min(used, need);
      commentLeft -= used;
    }
  }
  let src = out.join("\n\n");
  // A fence the clip left open is closed, so the text after it is not code.
  let fence = null;
  for (const l of src.split("\n")) {
    if (fence) { if (closesFence(l, fence)) fence = null; } else { const f = FENCE_OPEN.exec(l); if (f) fence = f[1]; }
  }
  if (fence) src += `\n${fence}`;
  return { text: src, more: Math.max(0, total - shown) };
}

// Every ASCII punctuation character Markdown could read as syntax, backslash-escaped, so
// the text shows as typed.
export function escapeMd(s) { return String(s ?? "").replace(/[!-/:-@[-`{-~]/g, "\\$&"); }

const URL_TOKEN = /^https?:\/\/[^\s<>"'`]+/;
const SAFE_URL = /^https?:\/\/[^\s/?#@<>"'`\\]+(\/[^\s<>"'`\\]*)?$/;
// A bare URL's end: trailing punctuation that closes the sentence is not part of it.
function urlEnd(s) {
  let u = s;
  for (;;) {
    const before = u;
    u = u.replace(/[.,;:!?]+$/, "");
    if (u.endsWith(")") && (u.match(/\(/g) ?? []).length < (u.match(/\)/g) ?? []).length) u = u.slice(0, -1);
    if (u === before) return u;
  }
}

// One line of text as tokens: inline code spans, Markdown links and images, angle
// autolinks and other angle tags, bare URLs, Claude Code's pasted-image labels
// ([Image #3]), and the plain text between them. Only plain text is matched against link
// rules, so a rule for #N never turns an image label into a link.
export function inlineTokens(line, { markdown = true } = {}) {
  const out = [];
  let plain = "";
  const flush = () => { if (plain) out.push({ kind: "text", t: plain }); plain = ""; };
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "`") {
      let n = 0;
      while (line[i + n] === "`") n++;
      const fence = "`".repeat(n);
      let j = line.indexOf(fence, i + n);
      while (j >= 0 && line[j + n] === "`") { let k = j; while (line[k] === "`") k++; j = line.indexOf(fence, k); }
      if (j >= 0) { flush(); out.push({ kind: "code", t: line.slice(i, j + n) }); i = j + n; continue; }
      plain += fence; i += n; continue;
    }
    if (ch === "[") {
      const m = /^\[Image #\d{1,6}\]/.exec(line.slice(i));
      if (m) { flush(); out.push({ kind: "label", t: m[0] }); i += m[0].length; continue; }
    }
    if (markdown && (ch === "[" || (ch === "!" && line[i + 1] === "["))) {
      const m = /^!?\[[^\]\n]*\](\([^)\n]*\)|\[[^\]\n]*\])/.exec(line.slice(i));
      if (m) { flush(); out.push({ kind: "link", t: m[0] }); i += m[0].length; continue; }
    }
    if (ch === "<") {
      const m = /^<[^<>\n]*>/.exec(line.slice(i));
      if (m) { flush(); out.push({ kind: "angle", t: m[0] }); i += m[0].length; continue; }
    }
    if ((ch === "h" || ch === "H") && (i === 0 || !/[\w/]/.test(line[i - 1]))) {
      const m = URL_TOKEN.exec(line.slice(i));
      if (m) { const u = urlEnd(m[0]); flush(); out.push({ kind: "url", t: u }); i += u.length; continue; }
    }
    plain += ch;
    i++;
  }
  flush();
  return out;
}

// The URL a rule makes for one match, or null when it does not pass the checks: captures
// are URL-encoded, {repo} and {owner} come from the terminal's git remote, and the result
// must be an http(s) URL on the template's own host, under 2,000 characters.
// A rule that uses {repo} or {owner} needs the session's repository; one whose address is
// on github.com needs that repository on GitHub too, so a GitLab or Bitbucket origin never
// gets a github.com link. ctx.host: the origin's host (null when not known).
export const GITHUB_HOSTS = ["github.com", "www.github.com", "ssh.github.com"];
export function repoFits(rule, ctx = {}) {
  if (!rule.repo) return true;
  if (!ctx.repo) return false;
  return !(GITHUB_HOSTS.includes(rule.host) && ctx.host && !GITHUB_HOSTS.includes(String(ctx.host).toLowerCase()));
}

export function fillUrl(rule, m, ctx = {}) {
  if (!repoFits(rule, ctx)) return null;
  let bad = false;
  const url = rule.url.replace(/\$(\d)|\{(repo|owner)\}/g, (_all, d, k) => {
    if (d != null) return encodeURIComponent(m[Number(d)] ?? "");
    const v = k === "repo" ? ctx.repo : ctx.owner;
    if (typeof v !== "string" || !/^[A-Za-z0-9._/-]+$/.test(v) || v.split("/").some((x) => x === "" || x === "." || x === "..")) { bad = true; return ""; }
    return v;
  }).replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29"));
  if (bad || url.length >= 2000 || /[\u0000-\u001f\u007f]/.test(url) || !SAFE_URL.test(url)) return null;
  const host = /^https?:\/\/([^/?#]+)/.exec(url)?.[1];
  return host && host.toLowerCase() === rule.host ? url : null;
}

// Plain text cut into pieces at link-rule matches: [{ t }, { t, url }, …]. The first rule
// that matches at the earliest position wins; a match over 80 characters, or one whose URL
// fails the checks, stays plain. budget (shared across calls for one text): characters
// scanned and matches left. Rules that use {repo} or {owner} are skipped without a repo.
// A rule that still runs slow on a reply's text (the checks in settings.js are a guard, not
// a proof) is marked slow after one search over SLOW_SEARCH ms, or SLOW_TEXT ms in one text,
// and skipped from then on, until the file changes the rule (it is compiled again). The page
// shows the reason. One search already running cannot be stopped.
export const SLOW_SEARCH = 8;
const SLOW_TEXT = 20;
export const SLOW_REPLY = "too slow on a reply; skipped until the rule changes";
const clock = () => globalThis.performance?.now?.() ?? Date.now();
export function linkPieces(text, rules, ctx = {}, budget = { chars: 20000, matches: 25 }) {
  const s = String(text ?? "");
  const usable = (rules ?? []).filter((r) => r.re && !r.slow && repoFits(r, ctx));
  const scan = Math.max(0, Math.min(s.length, budget.chars));
  budget.chars -= s.length;
  if (!usable.length || !scan || budget.matches <= 0) return [{ t: s }];
  const out = [];
  let at = 0;
  let pos = 0;
  const next = usable.map(() => undefined);
  const spent = usable.map(() => 0);
  const find = (i) => {
    const r = usable[i];
    if (r.slow) return null;
    let p = pos;
    for (;;) {
      r.re.lastIndex = p;
      const t0 = clock();
      const m = r.re.exec(s);
      const dt = clock() - t0;
      spent[i] += dt;
      if (dt > SLOW_SEARCH || spent[i] > SLOW_TEXT) { r.slow = SLOW_REPLY; return null; }
      if (!m || m.index >= scan) return null;
      if (m[0].length) return m;
      p = m.index + 1; // a zero-width match moves on by one
      if (p >= scan) return null;
    }
  };
  while (pos < scan && budget.matches > 0) {
    let best = -1;
    for (let i = 0; i < usable.length; i++) {
      if (next[i] === undefined || (next[i] && next[i].index < pos)) next[i] = find(i);
      if (next[i] && (best < 0 || next[i].index < next[best].index)) best = i;
    }
    if (best < 0) break;
    const m = next[best];
    const end = m.index + m[0].length;
    const url = m[0].length <= 80 ? fillUrl(usable[best], m, ctx) : null;
    if (url) {
      if (m.index > at) out.push({ t: s.slice(at, m.index) });
      out.push({ t: m[0], url });
      at = end;
      budget.matches--;
    }
    pos = end;
  }
  if (at < s.length) out.push({ t: s.slice(at) });
  return out;
}

// Columns of leading whitespace (a tab to the next multiple of 4), and a line with up to
// n columns of it removed.
function indentOf(s) {
  let n = 0;
  for (const ch of s) { if (ch === " ") n++; else if (ch === "\t") n += 4 - (n % 4); else break; }
  return n;
}
function dropIndent(s, n) {
  let col = 0;
  let i = 0;
  while (i < s.length && col < n && (s[i] === " " || s[i] === "\t")) { col += s[i] === "\t" ? 4 - (col % 4) : 1; i++; }
  return s.slice(i);
}
const QUOTE_MARKS = /^(?: {0,3}>[ \t]?)*/;
const LIST_ITEM = /^([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const RULE_LINE = /^([-*_])([ \t]*\1){2,}[ \t]*$/;

// Link-rule matches in a reply's Markdown made into [text](url), only in plain text: never
// inside fenced code (also in a blockquote or a list item), indented code, inline code
// (also a span that runs over a line break), an existing link or image, an angle tag or
// autolink, or a bare URL. Blocks are found the CommonMark way, in short: blockquote
// markers are stripped first; a list item's content column sets where its own fences and
// indented code start, so a nested item four spaces in is text, not code; indented code
// cannot interrupt a paragraph. Inline tokens are read per paragraph, so a code span keeps
// across lines. Reads at most maxChars characters for matches and makes at most maxMatches
// links. Returns { md, links }.
export function linkify(md, rules, ctx = {}, { maxChars = 20000, maxMatches = 25 } = {}) {
  const src = String(md ?? "");
  if (!rules?.length || !src) return { md: src, links: 0 };
  const budget = { chars: maxChars, matches: maxMatches };
  let links = 0;
  const lines = src.split("\n");
  let changedAny = false;
  let fence = null; // { mark, depth, indent }
  let list = 0; // the innermost list item's content column, 0 outside a list
  let depthPrev = 0;
  let prevBlank = true;
  let prevCode = false;
  let para = [];
  let paraChars = 0;
  const flush = () => {
    if (!para.length) return;
    const joined = para.map((i) => lines[i]).join("\n");
    let made = 0;
    const parts = inlineTokens(joined).map((tok) => {
      if (tok.kind !== "text") { budget.chars -= tok.t.replace(/\n/g, "").length; return tok.t; }
      return tok.t.split("\n").map((seg) => linkPieces(seg, rules, ctx, budget).map((p) => {
        if (!p.url) return p.t;
        made++;
        return `[${escapeMd(p.t)}](${p.url})`;
      }).join("")).join("\n");
    });
    budget.chars -= para.length;
    const back = made ? parts.join("").split("\n") : null;
    if (back && back.length === para.length) { para.forEach((i, k) => { lines[i] = back[k]; }); changedAny = true; links += made; }
    para = [];
    paraChars = 0;
  };
  for (let li = 0; li < lines.length; li++) {
    if (budget.chars - paraChars <= 0 || budget.matches <= 0) break;
    const line = lines[li];
    const marks = QUOTE_MARKS.exec(line)[0];
    const depth = (marks.match(/>/g) ?? []).length;
    const rest = line.slice(marks.length);
    const skip = () => { budget.chars -= line.length + 1; };
    if (fence) {
      if (depth >= fence.depth) {
        if (closesFence(dropIndent(rest, fence.indent), fence.mark)) fence = null;
        skip();
        continue;
      }
      fence = null; // the blockquote that held it ended
    }
    if (depth !== depthPrev) { flush(); list = 0; prevBlank = true; prevCode = false; depthPrev = depth; }
    if (rest.trim() === "") { flush(); prevBlank = true; skip(); continue; }
    const ind = indentOf(rest);
    const flat = rest.trimStart();
    if (list && ind < list && prevBlank && !LIST_ITEM.test(flat)) list = 0; // the list ended
    const base = list && ind >= list ? list : 0;
    const rel = ind - base;
    if (rel >= 4 && (prevBlank || prevCode)) { flush(); prevCode = true; prevBlank = false; skip(); continue; }
    const item = rel <= 3 && !RULE_LINE.test(flat) ? LIST_ITEM.exec(flat) : null;
    let inner = dropIndent(rest, base);
    let fenceAt = base;
    if (item) {
      flush();
      const gap = item[2].length === 0 || indentOf(item[2]) > 4 ? 1 : indentOf(item[2]);
      list = ind + item[1].length + gap;
      inner = flat.slice(item[0].length);
      fenceAt = list;
    }
    prevBlank = false;
    prevCode = false;
    const f = FENCE_OPEN.exec(inner);
    if (f) { flush(); fence = { mark: f[1], depth, indent: fenceAt }; skip(); continue; }
    const heading = /^ {0,3}#{1,6}([ \t]|$)/.test(inner);
    if (heading) flush();
    para.push(li);
    paraChars += line.length + 1;
    if (heading) flush();
  }
  flush();
  return { md: changedAny ? lines.join("\n") : src, links };
}

// A prompt as Markdown for TextView that changes nothing the person typed except: quote
// runs become blockquotes, followed by a blank line so the comment is never pulled into
// the quote; fenced code stays fenced code and inline code stays inline code; every other
// ASCII punctuation character (and so "<") is escaped, so "#", "*", "-" and "1." show as
// typed and no HTML is read; leading spaces become no-break spaces, so indentation is not
// a code block; each line break is a hard break; bare http(s) URLs become autolinks; link
// rule matches become [text](url). Reads at most max * 8 characters (32,000 by default);
// when the prompt is longer, a last line says how many characters are not shown.
// Returns { md, quotes, code, links, cut }: cut is the characters left out.
export function promptMd(text, { links: rules = [], repo = null, owner = null, host = null, max = 4000 } = {}) {
  const ctx = { repo, owner, host };
  const budget = { chars: 20000, matches: 25 };
  let nLinks = 0;
  const lineMd = (line) => {
    const lead = /^[ \t]*/.exec(line)[0];
    const head = lead.replace(/\t/g, "    ").replace(/ /g, "\u00a0");
    return head + inlineTokens(line.slice(lead.length).replace(/\t/g, "    "), { markdown: false }).map((tok) => {
      if (tok.kind === "code") return tok.t;
      if (tok.kind === "url") return SAFE_URL.test(tok.t) && tok.t.length < 2000 ? `<${tok.t}>` : escapeMd(tok.t);
      if (tok.kind !== "text") return escapeMd(tok.t);
      return linkPieces(tok.t, rules, ctx, budget).map((p) => {
        if (!p.url) return escapeMd(p.t);
        nLinks++;
        return `[${escapeMd(p.t)}](${p.url})`;
      }).join("");
    }).join("");
  };
  // Lines of one paragraph joined by hard breaks.
  const para = (lines, prefix = "") => lines.map((l, i) => prefix + lineMd(l) + (i < lines.length - 1 ? "\\" : "")).join("\n");
  const blocks = [];
  let quotes = 0;
  let code = 0;
  const all = String(text ?? "");
  const cut = Math.max(0, all.length - max * 8);
  for (const r of promptParts(all, max)) {
    if (r.quote) {
      quotes++;
      const groups = [[]];
      for (const l of r.lines) { if (l.trim() === "") groups.push([]); else groups[groups.length - 1].push(l); }
      blocks.push(groups.filter((g) => g.length).map((g) => para(g, "> ")).join("\n>\n"));
      continue;
    }
    let buf = [];
    const flushPara = () => { if (buf.length) blocks.push(para(buf)); buf = []; };
    let fence = null;
    let fenceLines = [];
    for (const l of r.lines) {
      if (fence) {
        fenceLines.push(l);
        if (closesFence(l, fence)) { blocks.push(fenceLines.join("\n")); fence = null; fenceLines = []; }
        continue;
      }
      const f = FENCE_OPEN.exec(l);
      if (f) { flushPara(); fence = f[1]; fenceLines = [l]; code++; continue; }
      if (l.trim() === "") { flushPara(); continue; }
      buf.push(l);
    }
    flushPara();
    if (fence) blocks.push(`${fenceLines.join("\n")}\n${fence}`);
  }
  if (cut) blocks.push(`*… ${cut.toLocaleString()} more characters not shown*`);
  return { md: blocks.join("\n\n"), quotes, code, links: nLinks, cut };
}

// ---- quoting a reply into the terminal ------------------------------------------------------

// The text pasted into the terminal for a quote, or null when nothing is left: control
// characters, CR, DEL, the C1 controls and the bidi and zero-width overrides removed (a
// tab becomes four spaces; CRLF becomes LF), then any "[200~" or "[201~" left over; blank
// lines trimmed at both ends; "> " before every line ("> " alone for a blank one); capped
// at maxLines lines with a "> …" line, or at maxChars characters, where the line that
// does not fit is cut at a word and ends in "…" (so a long first line is quoted in part,
// never dropped); and one blank line at the end, so the person types below the quote and
// not into it. Returns { text, lines, capped, cut }: cut is "lines", "chars" or null.
export function quoteText(source, { maxLines = 40, maxChars = 2000 } = {}) {
  let s = String(source ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "");
  for (let prev = null; prev !== s;) { prev = s; s = s.replace(/\[20[01]~/g, ""); }
  const lines = s.split("\n").map((l) => l.replace(/\s+$/, ""));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return null;
  const out = [];
  let chars = 0;
  let cut = null;
  for (const l of lines) {
    const q = l.trim() ? `> ${l}` : ">";
    if (out.length >= maxLines) { cut = "lines"; break; }
    if (chars + q.length + 1 > maxChars) {
      cut = "chars";
      // The part of this line that fits, with "…": cut at a space when one is near the end.
      const room = maxChars - chars - 2;
      if (l.trim() && room >= 12) {
        let head = q.slice(0, room);
        if (/[\ud800-\udbff]$/.test(head)) head = head.slice(0, -1);
        const sp = head.lastIndexOf(" ");
        if (sp > Math.max(2, room - 40)) head = head.slice(0, sp);
        out.push(`${head.replace(/[\s.,;:]+$/, "")}…`);
      }
      break;
    }
    out.push(q);
    chars += q.length + 1;
  }
  if (cut && !(cut === "chars" && out.length && out[out.length - 1].endsWith("…"))) {
    while (out.length && (out.length >= maxLines || chars + 4 > maxChars)) chars -= out.pop().length + 1;
    out.push("> …");
  }
  return { text: `${out.join("\n")}\n\n`, lines: out.length, capped: Boolean(cut), cut };
}

// Whether clipboard text came from this reply. It may be Markdown source (Select view) or
// what Herdr copies from the formatted reply: plain text, without markers, fences or link
// targets, with one line per block, and with a code block between two blocks left out. So
// each copied line is compared by its letters and digits alone, and must be found in the
// reply after the line before it.
const LIST_MARK = /^\s*(?:\d+[.)]|[-*+\u2022\u25e6\u25aa])\s+/gm;
const lettersOf = (x) => (x.match(/[\p{L}\p{N}]+/gu) ?? []).join("").toLowerCase();
function visibleMd(md) {
  return md
    .replace(/^\s*(?:```|~~~).*$/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/^\s*\[[^\]]+\]:\s+\S+.*$/gm, "")
    .replace(/<\/?[a-z][^<>]*>/gi, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, " ")
    .replace(LIST_MARK, "");
}
// One line of plain text as HTML for a TextView: escaped, with tabs as spaces and every space
// after the first in a run, or at the start, kept as a no-break space, since HTML collapses
// them.
export function htmlLine(line) {
  return String(line ?? "").replace(/\t/g, "    ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^ | (?= )/g, "&nbsp;");
}

// Lines of plain text as HTML for stacked TextViews, each at most max UTF-8 bytes (MD_MAX, as
// mdChunks), whole lines only: [{ html, n }] with n lines in each.
export function htmlChunks(lines, max = MD_MAX) {
  const out = [];
  let cur = [];
  let bytes = 0;
  for (const l of lines ?? []) {
    const h = htmlLine(l);
    const b = utf8Len(h) + 4;
    if (cur.length && bytes + b > max) { out.push({ html: cur.join("<br>"), n: cur.length }); cur = []; bytes = 0; }
    cur.push(h);
    bytes += b;
  }
  if (cur.length) out.push({ html: cur.join("<br>"), n: cur.length });
  return out;
}

export function inReply(clip, reply) {
  const norm = (x) => String(x ?? "").replace(/\s+/g, " ").trim();
  const c = norm(clip);
  if (!c) return false;
  if (norm(reply).includes(c)) return true;
  const hay = lettersOf(visibleMd(String(reply ?? "")));
  let from = 0;
  let any = false;
  for (const line of String(clip).replace(LIST_MARK, "").split("\n")) {
    const want = lettersOf(line);
    if (!want) continue;
    const at = hay.indexOf(want, from);
    if (at < 0) return false;
    from = at + want.length;
    any = true;
  }
  return any;
}

// Whether a version like "0.1.13" is at least min.
export function atLeast(version, min) {
  const parts = (x) => String(x ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(version);
  const b = parts(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

// The terminal's foreground program, from `hc get --json` and its pane: which agent it is
// (harnessOf) or a shell by name. The same test resolve() uses.
const SHELL_NAMES = new Set(["zsh", "bash", "fish", "sh", "dash", "nu", "pwsh", "login", "tcsh", "ksh"]);
export function foreground(info, pane) {
  const fg = info?.foreground ?? {};
  const base = (p) => (p ?? "").split("/").pop().replace(/^-/, "");
  const cmd = base((fg.argv ?? [])[0] ?? fg.name);
  const version = /^\d+\.\d+\.\d+/.test(fg.name ?? "") ? fg.name : null;
  const harness = harnessOf(fg, pane);
  const claude = harness === "claude";
  return { claude, harness, version, shell: !harness && (SHELL_NAMES.has(cmd) || SHELL_NAMES.has(base(fg.name))), name: cmd || fg.name || null, pid: fg.pid ?? null };
}

// Whether a quote may be pasted now, from what was true at the press: { ok: true, busy }
// or { ok: false, why }. The terminal must exist and be on this computer, a pane must show
// it in this tab, an agent must be in the foreground, the session must not have ended, and
// the agent must not be waiting on a prompt of its own (blocked). Working is allowed: the
// agent queues what is sent while it works.
export function canQuote(s) {
  if (s.panelOpen) return { ok: false, why: "panel" };
  if (s.remote) return { ok: false, why: "remote" };
  if (!s.exists || s.ended === "closed") return { ok: false, why: "closed" };
  if (s.ended === "exited") return { ok: false, why: "exited" };
  if (!s.pane) return { ok: false, why: "nopane" };
  if (s.moved) return { ok: false, why: "moved" };
  if (!s.fg?.claude && !s.fg?.harness) return { ok: false, why: s.fg?.shell ? "shell" : "other" };
  if (s.status === "blocked") return { ok: false, why: "blocked" };
  return { ok: true, busy: s.status === "working" };
}

// ---- the git remote ----------------------------------------------------------------------

// owner/name from a git remote URL (https, scp-style git@host:owner/name, or ssh://), with
// or without .git, or null.
export function parseRemote(url) {
  const u = String(url ?? "").trim();
  const m = /^(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(u)
    ?? /^(?:[^@/\s]+@)?([^/:\s]+):(?!\/)(.+?)(?:\.git)?\/?$/.exec(u);
  if (!m) return null;
  const path = m[2];
  const segs = path.split("/");
  if (segs.length < 2 || segs.some((x) => !/^[A-Za-z0-9._-]+$/.test(x) || x === "." || x === "..")) return null;
  return { host: m[1].toLowerCase(), owner: segs[0], repo: segs.join("/") };
}

// ---- agent turns ------------------------------------------------------------------------

const KIND_WORDS = {
  hc: "hc report", peer: "agent message", scheduled: "Scheduled", sdk: "SDK",
  "task-notification": "Task notification", "auto-continuation": "Auto-continuation",
};
export function kindWords(sender) {
  if (!sender) return "Background agent";
  if (sender.kind === "hc" && sender.request) return "hc request";
  return KIND_WORDS[sender.kind] ?? "Background agent";
}
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The sender label on an agent row: "t7 review" below 300 px, "t7 review · hc report" from
// 300 px, "Agent message" with no name.
export function senderLabel(sender, width) {
  if (!sender || sender.kind === "you") return "User";
  const words = kindWords(sender);
  if (!sender.name) return cap1(words);
  return width < 300 ? sender.name : `${sender.name} · ${words}`;
}

// Icon per sender kind.
export function senderIcon(sender) {
  return { scheduled: "clock", sdk: "square-terminal" }[sender?.kind] ?? "bot";
}

// Whether a turn is shown: the person's own turns always; another sender's when the
// setting is on, or while it is the live newest turn (Working or Needs you), or, given its
// session's turns, when it has a reply of its own (agentReplied): then its message is folded
// to one line over the reply.
export function isShown(turn, { agentTurns = false, live = false, turns = null } = {}) {
  return !turn.agent || agentTurns || live || (turns != null && agentReplied(turn, turns));
}

// An agent turn that keeps its reply on screen while agent messages are hidden, its message
// folded to one line (the owner, 17 Nov: a reply written for the person was hidden because
// an agent's message had started the turn). Not one with no reply text, and not one whose
// reply an earlier turn of the person's already shows (main.js borrowedFrom: Claude answered
// both in one reply). Reads the reply's pieces without joining them, since the counts call
// this for every turn.
export function agentReplied(turn, turns) {
  if (!turn.agent || !turn.after?.some((x) => /\S/.test(x))) return false;
  for (let i = turn.n - 2; i >= 0 && turns[i] && (turns[i].answeredIn === turn.n || turns[i].answeredBy === turn.n); i--) {
    if (!turns[i].agent && !turns[i].after.length) return false;
  }
  return true;
}

// The turns shown and how many are hidden, for a list of turns (live: the live turn).
// With a filter: matched counts the shown matches and hiddenMatches the hidden ones.
export function visible(turns, { agentTurns = false, live = null, match = null } = {}) {
  const shown = [];
  let hidden = 0;
  let hiddenMatches = 0;
  let matched = 0;
  for (const t of turns) {
    const on = isShown(t, { agentTurns, live: t === live, turns });
    const hit = match ? match(t) : true;
    if (!on) { hidden++; if (match && hit) hiddenMatches++; continue; }
    shown.push(t);
    if (hit) matched++;
  }
  return { shown, hidden, matched, hiddenMatches };
}

// "99+" above 99.
export function countLabel(n) { return n > 99 ? "99+" : String(n); }

// ---- the terminal -----------------------------------------------------------------------

// The model pane to focus for a terminal: the one in this Threads pane's tab, else any
// pane showing it, else null (then pane.focus {terminal} is the fallback).
export function focusTarget(panes, terminal, myTab) {
  const all = (panes ?? []).filter((p) => p.terminal === terminal && !p.mod);
  return all.find((p) => p.tab === myTab) ?? all[0] ?? null;
}

// The two strips of the selected turn draw their icons 13 px in 22 px boxes, so a press
// anywhere in a box counts (a list item takes one click handler, so click() tells the
// icons apart by the press position). STRIP_CHAR is an 11.5 px label's character.
export const ICON_BOX = 22;
export const STRIP_CHAR = 6.6;

// The strip under an open turn's reply: copy and quote from the left, the first glyph on the
// reply's left edge (16 px). Quote shows when a pane shows a terminal on this computer and
// the turn has a reply. Select shows after them only where the formatted reply cannot be
// selected (Herdr before 0.1.13), as the one way there by mouse; s works everywhere. Returns
// each icon's [start, end], or null when it is not shown.
export function actsLayout({ quote = true, select = false } = {}) {
  const out = { copy: null, quote: null, select: null };
  let x = ROW.PAD_X - 4;
  for (const [name, on] of [["copy", true], ["quote", quote], ["select", select]]) {
    if (!on) continue;
    out[name] = [x, x + ICON_BOX];
    x += ICON_BOX + 4;
  }
  return out;
}

// The strip under a bubble in a body w wide: copy the prompt, pin, then "#7 · 9:12 AM" in a
// box as wide as its text. The person's strip ends at the bubble's right edge (w - 16); an
// agent's starts at its left. Returns { copy, pin, text } as [start, end] and the text width.
// A tool call's kind, from its name as each agent records it (Claude Code's Bash and Read,
// Codex's shell and apply_patch, OpenCode's bash and grep, Cursor's Shell, Antigravity's
// run_command and view_file). MCP tools, plans and to-do lists are other.
export const AGENT_CALL = /^(task|agent|subagent|spawn(_\w+)?|delegate(_\w+)?)$/i;
const TOOL_KINDS = [
  ["other", /^mcp__|todo|plan|skill/i],
  ["web", /web|fetch|brows|url/i],
  // A subagent: Claude Code's Task or Agent, OpenCode's task, Codex's spawn calls. Exact names,
  // since Claude Code's task list tools (TaskCreate, TaskUpdate, TaskOutput) start with Task.
  ["agent", AGENT_CALL],
  // "exe" for exec_command: the read-only test flags the bare program word in the mod's code.
  ["command", /^(bash|shell|exe|local_shell|run_command|run_terminal|terminal|command)/i],
  ["edit", /edit|write|patch|replace|create_file|notebook/i],
  ["read", /^(read|view|cat|open_file)/i],
  ["search", /grep|glob|search|find|^list|^ls$|codebase/i],
];
export function toolKind(name) { return TOOL_KINDS.find(([, re]) => re.test(String(name ?? "")))?.[0] ?? "other"; }

// A step group's line: its calls by kind, in the order the kinds first appear, joined as a
// sentence. Done: "Searched the web 2 times and ran 5 commands". Still running (live):
// "Running 4 commands". count past the names a group keeps is "and N more".
const PAST = {
  command: (n) => `ran ${n} command${n === 1 ? "" : "s"}`, read: (n) => `read ${n} file${n === 1 ? "" : "s"}`,
  edit: (n) => `edited ${n} file${n === 1 ? "" : "s"}`, search: (n) => `searched ${n} time${n === 1 ? "" : "s"}`,
  web: (n) => `searched the web ${n} time${n === 1 ? "" : "s"}`, agent: (n) => `ran ${n} subagent${n === 1 ? "" : "s"}`,
  other: (n) => `used ${n} other tool${n === 1 ? "" : "s"}`,
};
const NOW = {
  command: (n) => `running ${n} command${n === 1 ? "" : "s"}`, read: (n) => `reading ${n} file${n === 1 ? "" : "s"}`,
  edit: (n) => `editing ${n} file${n === 1 ? "" : "s"}`, search: (n) => `searching ${n} time${n === 1 ? "" : "s"}`,
  web: (n) => `searching the web ${n} time${n === 1 ? "" : "s"}`, agent: (n) => `running ${n} subagent${n === 1 ? "" : "s"}`,
  other: (n) => `using ${n} other tool${n === 1 ? "" : "s"}`,
};
export function groupKinds(calls) {
  const counts = new Map();
  for (const name of calls ?? []) { const k = toolKind(name); counts.set(k, (counts.get(k) ?? 0) + 1); }
  return [...counts];
}
export function groupText(calls, count = calls?.length ?? 0, live = false) {
  const words = live ? NOW : PAST;
  const parts = groupKinds(calls).map(([k, n]) => words[k](n));
  const more = count - (calls?.length ?? 0);
  if (more > 0) parts.push(`${more} more`);
  if (!parts.length) return live ? "Working" : "Used no tools";
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
// The icon for a call of this kind in an open group.
export const KIND_ICON = { command: "square-terminal", read: "file-search", edit: "text-cursor", search: "search", web: "search", agent: "bot", other: "wrench" };

// Level 3: how long a call took ("<0.1s", "0.4s", "12s", "2m 05s"): the agent's own count when it
// records one (Pi's durationMs), else from its input's time to its output's; "" when unknown.
export function callTime(inTs, outTs, took = null) {
  const ms = Number.isFinite(took) ? took : Date.parse(outTs ?? "") - Date.parse(inTs ?? "");
  if (!(ms >= 0)) return "";
  if (ms < 100) return "<0.1s";
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

// The lines of a call's output box: OUT.SHOW at first, or up to OUT.MAX once shown in full.
// Lines are not wrapped: each is cut at OUT.CHARS and tabs become spaces, so every line is one
// OUT.LINE tall. total is the whole output's line count (lines, when calls.sh clipped it).
// SHOW lines of an output box are in view; the rest, up to MAX, scroll inside it. A line keeps
// up to CHARS characters and scrolls sideways.
export const OUT = { SHOW: 12, MAX: 400, CHARS: 2000, LINE: 16, PAD: 8, MORE: 22 };
export function outLines(out, all = true, lines = 0) {
  const list = String(out ?? "").replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  if (list.length === 1 && list[0] === "") return { lines: [], total: 0, cut: false };
  const total = Math.max(list.length, Number(lines) || 0);
  const shown = list.slice(0, all ? OUT.MAX : OUT.SHOW).map((l) => l.replace(/\t/g, "    ").slice(0, OUT.CHARS));
  return { lines: shown, total, cut: total > shown.length };
}
// The output box's height: its lines, or one line saying there are none, inside its padding
// and 1 px border, 2 px above and below, and the Show all row when lines are left out or all
// of them show.
// Lines wrap, and nothing scrolls inside: the box shows `shown` wrapped rows (OUT.SHOW
// until Show all, which is its own list item).
export function outHeight(box, shown = Math.min(OUT.SHOW, box.lines.length)) {
  const n = Math.max(1, Math.min(shown, box.lines.length ? shown : 1));
  return OUT.PAD * 2 + 2 + n * OUT.LINE + 4;
}
// The language a call's output is coloured as, for Herdr's editor, or null for plain text:
// JSON that parses, a unified diff, or a file read whose path has a known extension (not when
// the agent numbered its lines, as Claude Code does, which would colour the numbers).
export function outLang(out, input = "", kind = "") {
  const s = String(out ?? "").trim();
  if (!s) return null;
  if (/^[[{]/.test(s) && s.length <= 200000) {
    try { JSON.parse(s); return "json"; } catch { /* not JSON */ }
  }
  if (/^@@ [^\n]* @@/m.test(s) && /^(diff --git|--- |\+\+\+ |@@ )/m.test(s)) return "diff";
  if (kind === "read") {
    const m = /\.([A-Za-z0-9]+)\s*$/.exec(String(input ?? ""));
    const lang = m ? LANG[m[1].toLowerCase()] : null;
    if (lang && !/^\s*\d+[→\t|:]/.test(s)) return lang;
  }
  return null;
}
// A call's text on its row: what it ran or read (calls.sh picks the command, path, pattern,
// query or URL), on one line; the tool's name until that is read.
// Paths in a level 3 line, shorter to read and with no home folder in a screenshot: a path in
// the session's working folder relative to it ("." for the folder itself), and any other path
// in the home folder from "~". A path starts the text or follows a space, a quote, =, (, [ or
// a comma, and the folder ends at a slash, a space, a quote or the end.
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function shortPaths(text, cwd, home) {
  let s = String(text ?? "");
  const at = (dir, to) => {
    const d = String(dir ?? "").replace(/\/+$/, "");
    if (d.length < 2 || !s.includes(d)) return;
    const head = "(^|[\\s\"'=(\\[,])";
    s = s.replace(new RegExp(`${head}${reEsc(d)}/`, "g"), (_m, b) => `${b}${to ? `${to}/` : ""}`)
      .replace(new RegExp(`${head}${reEsc(d)}(?=$|[\\s"'),\\]:;])`, "g"), (_m, b) => `${b}${to || "."}`);
  };
  at(cwd, "");
  at(home, "~");
  return s;
}

export function callText(name, input) {
  const s = String(input ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 300) : String(name ?? "tool");
}

// The rail on the list's right edge (or left), in place of the scrollbar: one tick per turn,
// 9 px apart, a new day 7 px further (railWindow).
// The card beside a hovered tick: at most CARD_W wide, CARD_GAP px from the tick on the
// rail's inner side; a first line with the day, the time and the number, the prompt on two
// lines of about CARD_CHARS characters and the reply on three of about REPLY_CHARS.
// The peak: the hovered tick grows to PEAK px (PEAK_SMALL in a gutter under 40 px), and the
// ticks within SWELL px of it grow less, by the square of how near they are (railSwell).
// The window (round 7): 9 px a tick (MAX) at every length, one tick a turn, in a window at
// most WIN_PCT of the list's height and WIN_MAX px (60 ticks); it keeps the turns on screen
// SPARE ticks from its ends, and the FADE ticks before a cut end fade. A pin or the running
// turn past an end shows as a DOT px dot in a 9 px row there.
export const RAIL = { PAD: 6, MAX: 9, MIN: 3, DAY: 7, LANE: 32, CARD_W: 300, CARD_GAP: 4, CARD_CHARS: 40, REPLY_CHARS: 46, PEAK: 24, PEAK_SMALL: 16, SWELL: 36, WIN_PCT: 0.6, WIN_MAX: 540, SPARE: 3, FADE: [0.25, 0.5, 0.75], DOT: 4, SLIDE_MS: 90, CARD_KEEP_MS: 200 };
// The ticks' look from the pane's side gutter (side px from the pane's edge to the text): a
// tick MARK wide, SEL when selected, RIGHT px in from the pane's edge, in a lane as wide as
// the gutter up to RAIL.LANE that takes the press. A gutter under 40 px has smaller ticks.
// Where to put item i when the list can only bring an item to its top or its centre: i
// itself at the top (y 0), an earlier item k at the top (i then sits lower by the slots from
// k to i), or i centred. The option nearest want, with i at least minTop down (clear of the
// floating top) and no more than maxY, and room for some of i under it. i at the top when
// none fits.
export function landPlan(slots, i, listH, want, minTop = 0, maxY = listH) {
  const h = slots[i] ?? 0;
  const ok = (y) => y >= minTop && y <= maxY && y + Math.min(h, 48) <= listH;
  const opts = [{ j: i, how: "top", y: 0 }];
  let y = 0;
  for (let k = i - 1; k >= 0 && y <= listH; k--) {
    y += slots[k] ?? 0;
    opts.push({ j: k, how: "top", y });
  }
  if (h < listH) opts.push({ j: i, how: "center", y: (listH - h) / 2 });
  let best = null;
  for (const o of opts) if (ok(o.y) && (!best || Math.abs(o.y - want) < Math.abs(best.y - want))) best = o;
  return best ?? opts[0];
}
// Where to scroll so item i's top is want px down a list that can only put an item's top at
// its top edge: the nearest earlier item k whose top is at least want above item i's, at the
// top, then lift px more. The list keeps its offset in px, so the view asks for the scroll
// with lift px added to its first row for one frame and then takes them away: everything
// moves up by lift and item i lands at want, with the end of the item above it showing over
// it, as a scroll by hand would show it. When everything above item i is shorter than want,
// the list's start is at the top and item i is as low as it can be. { j, how, y, lift }: y
// is where item i's top lands.
export function landExact(slots, i, want) {
  let y = 0;
  for (let k = i; k >= 0; k--) {
    if (k < i) y += slots[k] ?? 0;
    if (y >= want) return { j: k, how: "top", y: want, lift: y - want };
  }
  return { j: 0, how: "top", y, lift: 0 };
}
// The rail shows only in a pane that holds a whole Comfortable reading line (MEASURE
// characters at the text size) inside its gutters: a narrower pane is already squeezing the
// line, and the rail gives it the room, as Codex hides its side rail. 549 px at 14 px.
export function railRoom(paneW, size = TEXT_SIZE) {
  return paneW - 2 * gutter(paneW) >= readType(size, MEASURE).measure;
}
// The narrowest pane that shows the rail at a text size.
export function railMinPane(size = TEXT_SIZE) {
  let w = 200;
  while (!railRoom(w, size) && w < 4000) w++;
  return w;
}
export function railLook(side) {
  const small = side < 40;
  return { lane: Math.max(16, Math.min(RAIL.LANE, side)), mark: small ? 8 : 10, sel: small ? 12 : 16, right: small ? 6 : 14, peak: small ? RAIL.PEAK_SMALL : RAIL.PEAK };
}
// A tick's width at d px from the hovered tick: the peak at 0, then less by the square of
// how near it is, back to its own width w at SWELL px. At 9 px apart: 24, 18, 13.5 and 11.
export function railSwell(w, peak, d) {
  if (!(d >= 0) || d >= RAIL.SWELL) return w;
  const k = 1 - d / RAIL.SWELL;
  return Math.max(w, Math.round((w + (peak - w) * k * k) * 2) / 2);
}

// The rail's window over n ticks: { top, count, cut } where the ticks top to top + count - 1
// are drawn. day(i) is true when tick i starts a new day (a 7 px gap above it, except at the
// window's top). room is the window's px: min(WIN_PCT of h, WIN_MAX), less a 9 px row at each
// end for its dot when the ticks do not all fit. The window keeps on (the first and last tick
// on screen, or null) SPARE ticks from its ends, moving only as far as that needs; at the end
// (end true, while the list follows the newest turn) it rests at the last tick. It is not
// kept centred, so it stays still while the list moves a little.
export function railFit(day, from, room, last = Infinity) {
  let y = 0;
  let i = from;
  for (; i <= last; i++) {
    const add = (i > from && day(i) ? RAIL.DAY : 0) + RAIL.MAX;
    if (y + add > room) break;
    y += add;
  }
  return i - from;
}
export function railWindow(n, day, h, top = 0, on = null, end = false) {
  const room0 = Math.max(RAIL.MAX, Math.min(RAIL.WIN_PCT * Math.max(0, h), RAIL.WIN_MAX));
  if (n <= 0) return { top: 0, count: 0, cut: false };
  if (railFit(day, 0, room0, n - 1) >= n) return { top: 0, count: n, cut: false };
  const room = Math.max(RAIL.MAX, room0 - 2 * RAIL.MAX);
  // The window's top for a window that ends at tick e.
  const endingAt = (e) => {
    let y = 0;
    let i = e;
    for (; i >= 0; i--) {
      const add = RAIL.MAX + (i < e && day(i + 1) ? RAIL.DAY : 0);
      if (y + add > room) break;
      y += add;
    }
    return i + 1;
  };
  let t = Math.max(0, Math.min(top, n - 1));
  if (end) t = endingAt(n - 1);
  else if (on) {
    const [a, b] = on;
    if (a < t + RAIL.SPARE) t = Math.max(0, a - RAIL.SPARE);
    const need = Math.min(n - 1, b + RAIL.SPARE);
    if (t + railFit(day, t, room, n - 1) - 1 < need) t = Math.max(t, endingAt(need));
    // A window taller than the turns on screen keeps their first one in view.
    if (t > a) t = Math.max(0, a - RAIL.SPARE);
  }
  t = Math.min(t, endingAt(n - 1));
  return { top: t, count: railFit(day, t, room, n - 1), cut: true };
}

export function stripLayout(w, text, right = true) {
  const tw = Math.ceil([...text].length * STRIP_CHAR) + 2;
  if (right) {
    const t = [w - ROW.PAD_X - tw, w - ROW.PAD_X];
    const pin = [t[0] - 4 - ICON_BOX, t[0] - 4];
    const copy = [pin[0] - 2 - ICON_BOX, pin[0] - 2];
    return { copy, pin, text: t, tw };
  }
  const copy = [ROW.PAD_X - 4, ROW.PAD_X - 4 + ICON_BOX];
  const pin = [copy[1] + 2, copy[1] + 2 + ICON_BOX];
  return { copy, pin, text: [pin[1] + 4, pin[1] + 4 + tw], tw };
}

// The info icon at the right end of an open "Worked for" line, in a line lineW wide that
// starts ROW.PAD_X in: [start, end] from the column's left edge.
export function infoBox(lineW) {
  const end = ROW.PAD_X + lineW;
  return [end - ICON_BOX, end];
}

// Which box of a layout a press at x falls in (2 px of slack each side), or null.
export function boxHit(layout, x, names) {
  if (x == null) return null;
  for (const n of names) {
    const b = layout[n];
    if (b && x >= b[0] - 2 && x <= b[1] + 2) return n;
  }
  return null;
}

// A pin in the Pinned column and the narrow Pinned view is a compact row, so five fit in a
// 240 to 400 px column at a 1150 px window: its digit in an accent badge on the left, then
// the turn's number and time, two lines of the prompt and one of the reply. Every line has
// a fixed height and is cut with an ellipsis where it runs long, so the drawn row is the
// stated height. The prompt is 13 px (PROMPT_CHAR wide), the reply 12.5 px.
export const PIN_ROW = Object.freeze({
  PAD_X: 12, PAD_T: 8, PAD_B: 9, BADGE: 20, GAP_X: 10, META: 16, GAP: 3, LINE: 19, REPLY: 18,
  SIZE: 13, REPLY_SIZE: 12.5, PROMPT_LINES: 2,
});
export function pinRowHeight(p) {
  return PIN_ROW.PAD_T + PIN_ROW.META + PIN_ROW.GAP + Math.max(1, Math.min(PIN_ROW.PROMPT_LINES, p)) * PIN_ROW.LINE
    + PIN_ROW.GAP + PIN_ROW.REPLY + PIN_ROW.PAD_B;
}
// The prompt as a compact row shows it: the person's own words without the lines they
// quoted (the quote's text when it is the whole prompt), on one run of text.
export function pinPromptText(prompt) {
  const lines = String(prompt ?? "").split("\n");
  const quote = (l) => /^ {0,3}>/.test(l);
  const own = lines.filter((l) => !quote(l) && l.trim());
  const keep = own.length ? own : lines.map((l) => l.replace(/^ {0,3}>\s?/, ""));
  return keep.join(" ").replace(/\s+/g, " ").trim();
}
// { prompt: 1 or 2 lines, reply: one line, height } for a compact row width px wide.
export function pinRowShape({ prompt, reply, width }) {
  const tw = Math.max(60, width - 2 * PIN_ROW.PAD_X - PIN_ROW.BADGE - PIN_ROW.GAP_X);
  const k = PIN_ROW.SIZE / 13;
  const p = rowLines(prompt || "(empty prompt)", PIN_ROW.PROMPT_LINES, tw / (ROW.PROMPT_CHAR * k));
  const r = rowLines(reply || " ", 1, tw / (ROW.REPLY_CHAR * (PIN_ROW.REPLY_SIZE / 13)));
  const lines = p.lines.length ? p.lines : [" "];
  return { prompt: lines, reply: r.lines[0] ?? " ", height: pinRowHeight(lines.length) };
}

// - and = make the Pinned column 40 px narrower or wider. Herdr puts the terminal, Threads
// and the column in one row, Threads and the column at fixed widths, and a drag on the
// divider between those two resizes Threads alone (the terminal takes up the rest). So the
// keys resize both, the column by d and Threads by -d, and the terminal keeps its width.
// From the column's width c and Threads' m: the two new widths, or null when there is no
// room (the column 200 to 640 px, Threads at least PIN_MAIN_MIN).
export const PIN_STEP = 40;
export function columnResize(c, m, d) {
  if (!(c > 0) || !(m > 0)) return null;
  let dd = Math.max(200, Math.min(640, Math.round(c + d))) - Math.round(c);
  if (Math.round(m) - dd < PIN_MAIN_MIN) dd = Math.round(m) - PIN_MAIN_MIN;
  if (d > 0 ? dd <= 0 : dd >= 0) return null;
  return { column: Math.round(c) + dd, main: Math.round(m) - dd };
}

// The Pinned column that v (or the first pin) splits off a Threads pane: 40% of the pane
// and a step (PIN_STEP) more, 380 to 440 px (PIN_COL_WANT), so a compact row shows about 48
// characters of its prompt a line (the row's text is the column less PIN_ROW's 54 px of
// padding and badge); the owner found one step narrower too tight. A pane under 620 px gives
// the column less, down to 240 px (PIN_COL[0]), so that Threads keeps at least
// PIN_MAIN_MIN less a step if Herdr takes all the room from it: 373 px beside a 573 px pane. Mostly it does not: with
// readingWidth on, Threads sits at its reading width (about 570 px at text size 14) and
// Herdr takes the column's room from the terminal beside it. A pane from
// PIN_SPLIT_MIN (480 px, so a pane set to 500 that measures a pixel or two less still
// counts) gets the column; narrower, Pinned shows in the same pane. Herdr takes the column's
// room from the pane's neighbours as well as from Threads. A width the owner set with - and =
// (kept), up to 640 px with Threads at least PIN_MAIN_MIN, wins. Returns the column's
// width, or null.
export const PIN_COL = Object.freeze([240, 440]);
export const PIN_COL_WANT = 380;
export const PIN_MAIN_MIN = 240;
export const PIN_SPLIT_MIN = PIN_COL[0] + PIN_MAIN_MIN;
export function pinColumn(width, kept = null) {
  if (!(width >= PIN_SPLIT_MIN)) return null;
  const want = kept > 0 ? Math.round(kept) : Math.max(PIN_COL_WANT, Math.min(PIN_COL[1], Math.round(width * 0.4) + PIN_STEP));
  const room = Math.round(width) - PIN_MAIN_MIN + (kept > 0 ? 0 : PIN_STEP);
  return Math.max(PIN_COL[0], Math.min(want, room, kept > 0 ? 640 : PIN_COL[1]));
}

// A header button's width: a 24 px icon, or a labelled one (7 px padding a side, 12 px text).
export function headerButtonWidth(label) {
  return label ? 14 + Math.ceil(String(label).length * 6.6) + 2 : 24;
}

// ---- colour -----------------------------------------------------------------------------

function rgb(color) {
  const a = alpha(color, 1);
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(a ?? "");
  return m ? [1, 2, 3].map((i) => parseInt(m[i], 16)) : null;
}
// WCAG contrast ratio of two colours (alpha ignored), or null when one does not parse.
export function contrast(a, b) {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return null;
  const lum = (c) => {
    const [r, g, bl] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
// a mixed toward b by t (0..1), as #rrggbb.
export function mix(a, b, t) {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return a;
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}
// The sender label colour: ansi5 where it reads at 4.5:1 on the background, else ansi5
// mixed toward the foreground until it does. A theme where nothing reaches 4.5:1 gets the
// candidate that reads best (never one worse than ansi5 itself).
export function labelColor(ansi5, fg, bg) {
  const c = contrast(ansi5, bg);
  if (c == null || c >= 4.5) return ansi5;
  let best = ansi5;
  let bestC = c;
  for (let t = 0.1; t <= 1.001; t += 0.1) {
    const m = t > 1 - 1e-9 ? fg : mix(ansi5, fg, t);
    const mc = contrast(m, bg) ?? 0;
    if (mc >= 4.5) return m;
    if (mc > bestC) { best = m; bestC = mc; }
  }
  return best;
}

// A colour with alpha drawn over an opaque background, as #rrggbb (themes give selected
// and hover as #rrggbbaa). An opaque colour comes back as #rrggbb.
export function over(color, bg) {
  const c = alpha(color, 1);
  const m = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(c ?? "");
  return m ? mix(bg, c.slice(0, 7), parseInt(m[1], 16) / 255) : color;
}

// The day band's fill. A dark theme uses its card fill (raised). A light theme's card fill
// sits too close to its background to catch the eye, so there the band is the background
// mixed toward the foreground until it stands BAND_LIGHT off the background, but no darker
// than the selected row's fill, so a turn still outweighs it. raised when it already stands
// that far off, or when a colour does not parse.
export const BAND_LIGHT = 1.15;
export function bandFill(t) {
  const lum = (c) => contrast(c, "#000000");
  const bg = lum(t?.background);
  const fg = lum(t?.foreground);
  if (bg == null || fg == null || bg <= fg) return t?.raised;
  const raised = contrast(t.raised, t.background) ?? 1;
  if (raised >= BAND_LIGHT) return t.raised;
  const sel = contrast(over(t.selected, t.background), t.background);
  const goal = sel != null && sel > raised ? Math.min(BAND_LIGHT, sel) : BAND_LIGHT;
  for (let k = 0.005; k <= 0.5; k += 0.005) {
    const m = mix(t.background, t.foreground, k);
    if ((contrast(m, t.background) ?? 1) >= goal) return m;
  }
  return t.raised;
}

// The command name's colour in a row or card: muted, unless muted reads under 4.5:1 on
// the row's background or on the selected row's, then foreground.
// A command name's colour on the background its row shows (selected or not): muted where
// muted reads at 4.5:1 there, else foreground. Every installed theme's muted reads under
// 4.5:1 on its selected colour, so a selected row draws the name in foreground.
export function commandColor(t, selected = false) {
  const bg = selected && t?.selected ? t.selected : t?.background;
  const c = contrast(t?.muted, bg);
  return c == null || c < 4.5 ? t?.foreground : t.muted;
}

// The open card's caps labels (FINAL REPLY, LATEST UPDATE, YOU) and counts line: muted
// where it reads at 4.5:1 on the surface under it (the raised card, or the YOU block's
// background), else foreground. dim stays for dividers, separators and icons (D1).
export function cardLabelColor(t, bg = t?.raised) {
  const c = contrast(t?.muted, bg);
  return c == null || c < 4.5 ? t?.foreground : t.muted;
}

// ---- the open card ----------------------------------------------------------------------

// Height of the YOU block for a prompt (text already clipped as shown), at an inner card
// width: margin 8, padding 10 above and 10 below, the label, a gap, the text with one
// line of slack once it wraps, the Show all / Show less line, and 10 px below the block.
export function youHeight(text, innerW, { link = false, max = 420, line = 18, charW = 6.2 } = {}) {
  const per = Math.max(8, Math.floor((innerW - 20) / charW));
  const n = wrappedLines(text, per);
  const body = Math.min(max, (n + (n > 1 || (text ?? "").length > per * 0.8 ? 1 : 0)) * line);
  return 8 + 10 + 16 + 4 + body + 10 + (link ? 22 : 0) + 10;
}

// ---- bubble colours (settings.json bubbleColor and agentBubbleColor) ----
// A preset name or "#rrggbb". Every preset reads at 5:1 or more with white text. The
// defaults, slate and plum, are muted; blue and purple are the bright pair. "plain" is the
// theme's own look: the person's bubble is the text colour at 8% over the pane, an agent's
// bubble is outlined on the pane.
export const BUBBLES = Object.freeze({
  slate: "#47648F", plum: "#715C91", blue: "#2563EB", purple: "#7C3AED", teal: "#36706D",
  green: "#4A6E4F", amber: "#87643A", rose: "#8A5068", gray: "#5B6170", plain: null,
});

const BUBBLE_NAMES = new Set(Object.keys(BUBBLES));

// A setting's value as stored: a preset's name or "#RRGGBB", or null when it is neither.
export function bubbleValue(v) {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (BUBBLE_NAMES.has(s)) return s;
  if (/^#[0-9a-f]{6}$/.test(s)) return s.toUpperCase();
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map((x) => x + x).join("")}`.toUpperCase();
  return null;
}

// The text colour on a fill: white or near-black, whichever reads better.
export function bubbleInk(fill) {
  return (contrast("#FFFFFF", fill) ?? 0) >= (contrast("#111111", fill) ?? 0) ? "#FFFFFF" : "#111111";
}

// How a bubble is drawn for a setting's value: { fill, ink, sub, bar, outline }. ink is the
// message's text colour, sub a quote's, bar a quote's bar. Plain (or a value that does not
// parse) takes the theme's colours: the person's bubble the text colour at 8%, an agent's
// bubble outlined, with the agent's prompt muted.
export function bubbleStyle(value, t, agent) {
  const v = bubbleValue(value);
  const hex = v == null ? null : v.startsWith("#") ? v : BUBBLES[v];
  if (!hex) {
    return agent
      ? { fill: t.background, ink: t.muted, sub: t.muted, bar: t.dim, outline: true }
      : { fill: alpha(t.foreground, 0.08), ink: t.foreground, sub: t.muted, bar: alpha(t.foreground, 0.28), outline: false };
  }
  const ink = bubbleInk(hex);
  return { fill: hex, ink, sub: alpha(ink, 0.78), bar: alpha(ink, 0.5), outline: false };
}
