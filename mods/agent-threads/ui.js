// agent-threads: small pure helpers for drawing (no Herdr imports), tested under bun.

import { harnessOf } from "./harness.js";

// The panel action for a key press, or null. Chords with cmd, ctrl, alt or fn belong to
// Herdr and the system (cmd-c, cmd-shift-t, ctrl-tab), so they are never taken.
const KEYS = {
  up: "prev", k: "prev", down: "next", j: "next", home: "first", g: "jump",
  end: "latest", enter: "open", space: "open", o: "open", c: "copy", "/": "filter", escape: "escape",
  "[": "prevDay", "]": "nextDay", a: "agents", t: "focus", ",": "settings", s: "select", i: "legend",
};
// quoteKey (settings.json, default q) returns "quote": the panel handles it itself, and no
// mod command fires it.
export function keyAction(e, filtering = false, quoteKey = "q") {
  const m = e?.modifiers ?? {};
  if (m.platform || m.control || m.alt || m.function) return null;
  const k = e?.key ?? "";
  if (m.shift) return k === "g" || k === "G" ? "latest" : null;
  if (k === "G") return "latest";
  if (filtering && !["escape", "up", "down", "enter"].includes(k)) return null;
  return KEYS[k] ?? (k === quoteKey && /^[a-z]$/.test(k) ? "quote" : null);
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

// Row geometry, shared by the drawing and the stated heights. Collapsed rows: 6 px list
// margin and 10 px padding each side, so text starts 16 px in and keeps a 16 px right
// gutter. Agent rows are inset 8 px more (and carry a 2 px rail).
export const ROW = Object.freeze({ PROMPT_LINE: 18, REPLY_LINE: 17, META: 16, PROMPT_CHAR: 6.7, AGENT_CHAR: 6.5, REPLY_CHAR: 6.4, CHIP_CHAR: 7.3 });
export function rowTextWidth(width, agent = false) { return Math.max(60, width - 32 - (agent ? 10 : 0)); }

// Height of a collapsed row with p prompt lines and r reply lines.
export function rowHeight(p, r, metaWraps = false) {
  return 2 + 14 + ROW.META + 3 + ROW.PROMPT_LINE * p + 3 + ROW.REPLY_LINE * r + (metaWraps ? 16 : 0);
}

// A command row's chip and its argument lines: the chip takes at most 45% of the line
// and the arguments wrap in the space to its right.
export function commandLayout(name, args, width, limit, agent = false) {
  const tw = rowTextWidth(width, agent);
  const maxChip = Math.floor(tw * 0.45);
  const chipChars = Math.max(3, Math.floor((maxChip - 12) / ROW.CHIP_CHAR));
  const label = middle(name, chipChars);
  const chipW = Math.min(maxChip, Math.ceil([...label].length * ROW.CHIP_CHAR + 12));
  const per = Math.floor((tw - chipW - 6) / ROW.PROMPT_CHAR);
  const a = args ? rowLines(args, limit, per) : { lines: [], cut: false };
  return { label, chipW, lines: a.lines, cut: a.cut, rows: Math.max(1, a.lines.length) };
}

// The lines a collapsed row shows: { p, r, prompt, reply, chip?, kinds?, q }. kinds, when
// the prompt quotes something, says how each prompt line is drawn: "q" a muted quote line
// with a bar, "qonly" a quote that is the whole prompt (foreground, with the bar), "c" the
// person's own words. q: the quote lines shown.
export function rowShape({ prompt, reply, cmd, width, promptLines, replyLines, agent = false, replyLimit = null, quotes = true }) {
  const tw = rowTextWidth(width, agent);
  let pr;
  let chip = null;
  if (cmd) {
    chip = commandLayout(cmd.name, cmd.args, width, promptLines, agent);
    pr = { lines: chip.lines, rows: chip.rows };
  } else {
    pr = quotes ? quoteRows(prompt, promptLines, tw, agent) : null;
    if (!pr) {
      // A task notification that opens a session carries no text: the sender label names it.
      const l = rowLines(prompt || (agent ? "(no message text)" : "(empty prompt)"), promptLines, tw / (agent ? ROW.AGENT_CHAR : ROW.PROMPT_CHAR));
      pr = { lines: l.lines, rows: Math.max(1, l.lines.length) };
    }
  }
  // The reply line starts after a 12 px icon and a 5 px gap.
  const rl = rowLines(reply, replyLimit ?? replyLines, (tw - 17) / ROW.REPLY_CHAR);
  const r = Math.max(1, rl.lines.length);
  return { p: pr.rows, r, prompt: pr.lines, reply: rl.lines, chip, kinds: pr.kinds ?? null, q: pr.q ?? 0, height: rowHeight(pr.rows, r) };
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
export function quoteRows(prompt, budget, tw, agent = false) {
  if (!prompt || !/(^|\n) {0,3}>/.test(prompt)) return null;
  const parts = promptParts(prompt);
  if (!parts.some((r) => r.quote)) return null;
  const max = Math.max(1, Math.floor(budget));
  const qper = (tw - QUOTE_INSET) / ROW.AGENT_CHAR;
  const per = tw / (agent ? ROW.AGENT_CHAR : ROW.PROMPT_CHAR);
  if (!parts.some((r) => !r.quote)) {
    const l = rowLines(parts.map((r) => r.lines.join("\n")).join("\n"), max, (tw - QUOTE_INSET) / (agent ? ROW.AGENT_CHAR : ROW.PROMPT_CHAR));
    return { lines: l.lines, rows: Math.max(1, l.lines.length), kinds: l.lines.map(() => "qonly"), q: l.lines.length };
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
  return { lines, rows: Math.max(1, lines.length), kinds, q: kinds.filter((k) => k === "q").length };
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
export function fillUrl(rule, m, ctx = {}) {
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
export function linkPieces(text, rules, ctx = {}, budget = { chars: 20000, matches: 25 }) {
  const s = String(text ?? "");
  const usable = (rules ?? []).filter((r) => r.re && (!r.repo || ctx.repo));
  const scan = Math.max(0, Math.min(s.length, budget.chars));
  budget.chars -= s.length;
  if (!usable.length || !scan || budget.matches <= 0) return [{ t: s }];
  const out = [];
  let at = 0;
  let pos = 0;
  const next = usable.map(() => undefined);
  const find = (i) => {
    const r = usable[i];
    let p = pos;
    for (;;) {
      r.re.lastIndex = p;
      const m = r.re.exec(s);
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
export function promptMd(text, { links: rules = [], repo = null, owner = null, max = 4000 } = {}) {
  const ctx = { repo, owner };
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

// Whether clipboard text came from this reply: its text, with whitespace runs made one
// space, is part of the reply's Markdown source treated the same way.
export function inReply(clip, reply) {
  const norm = (x) => String(x ?? "").replace(/\s+/g, " ").trim();
  const c = norm(clip);
  return Boolean(c) && norm(reply).includes(c);
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
  if (!sender || sender.kind === "you") return "You";
  const words = kindWords(sender);
  if (!sender.name) return cap1(words);
  return width < 300 ? sender.name : `${sender.name} · ${words}`;
}

// Icon per sender kind.
export function senderIcon(sender) {
  return { scheduled: "clock", sdk: "square-terminal" }[sender?.kind] ?? "bot";
}

// Whether a turn is shown: the person's own turns always; another sender's when the
// setting is on, or while it is the live newest turn (Working or Needs you).
export function isShown(turn, { agentTurns = false, live = false } = {}) {
  return !turn.agent || agentTurns || live;
}

// The turns shown and how many are hidden, for a list of turns (live: the live turn).
// With a filter: matched counts the shown matches and hiddenMatches the hidden ones.
export function visible(turns, { agentTurns = false, live = null, match = null } = {}) {
  const shown = [];
  let hidden = 0;
  let hiddenMatches = 0;
  let matched = 0;
  for (const t of turns) {
    const on = isShown(t, { agentTurns, live: t === live });
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

// The open card's action bar at a pane width: Copy reply, Select and Quote from the left,
// Terminal at the right, 6 px apart inside a 16 px inset. While they do not fit, Quote's
// label goes first, then Select's, then "Copy reply" becomes "Copy", then Terminal's.
// Returns each button's [start, end] (null when it is not shown) and its label (null:
// icon only).
export function barLayout(w, { quote = true, terminal = true } = {}) {
  const btn = (label) => 10 + 13 + 6 + label + 10 + 2;
  const W = { copy: btn(66), copyShort: btn(42), sel: 92, quote: btn(36), term: btn(52), icon: 30 };
  const tiers = [
    [true, true, true, true], [true, true, false, true], [true, false, false, true], [false, false, false, true], [false, false, false, false],
  ];
  let out = null;
  for (const [longCopy, selLabel, quoteLabel, termLabel] of tiers) {
    const copyW = longCopy ? W.copy : W.copyShort;
    const selW = selLabel ? W.sel : W.icon;
    const quoteW = quoteLabel ? W.quote : W.icon;
    const termW = termLabel ? W.term : W.icon;
    const copy = [16, 16 + copyW];
    const select = [copy[1] + 6, copy[1] + 6 + selW];
    const q = quote ? [select[1] + 6, select[1] + 6 + quoteW] : null;
    const term = terminal ? [w - 16 - termW, w - 16] : null;
    const right = (q ?? select)[1];
    out = {
      copy, select, quote: q, terminal: term,
      labels: { copy: longCopy ? "Copy reply" : "Copy", select: selLabel, quote: quoteLabel, terminal: termLabel },
    };
    if (right + 6 <= (term ? term[0] : w - 16 + 6)) return out;
  }
  return out;
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
