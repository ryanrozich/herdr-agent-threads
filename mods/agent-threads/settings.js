// agent-threads: the person's settings, in Herdr's per-mod data folder
// ($HERDR_APP_HOME/data/agent-threads/settings.json, outside mods/, so an update or a
// reinstall, which replaces mods/agent-threads/, leaves it alone). A person can edit it by
// hand; the pane watches it and applies a change at once.
//
//   { "textSize": 14, "promptLines": 4, "replyLines": 6, "agentTurns": false, "bubbleColor": "slate",
//     "agentBubbleColor": "plum", "youName": "You", "quoteKey": "q",
//     "links": [{ "name": "Issue", "pattern": "\\bACME-(\\d+)\\b", "url": "https://linear.app/acme/issue/ACME-$1" }] }
//
// textSize (12 to 18): the px size of message and reply text (ui.js readType sets its line
// height and line length). promptLines (1 to 10) and replyLines (1 to 12): lines of prompt and of reply preview in a
// collapsed row. agentTurns: show turns another agent, a schedule or the SDK sent.
// bubbleColor and agentBubbleColor: the fill of the person's and of an agent's message
// bubbles, a preset name (ui.js BUBBLES; "plain" is the theme's own look) or "#rrggbb".
// youName: the name over the person's messages, 1 to 40 characters, "You" when unset.
// readingWidth: keep the Threads pane at the reading width (true, the default): a pane that
// opens or is dragged wider is resized back, and the terminal gets the room.
// viewerReply: the image viewer shows the turn's prompt and reply beside the image (true, the
// default); i in the viewer shows or hides it, and the viewer writes the choice here.
// quoteKey: the key that quotes a reply into the terminal. links: text patterns shown as
// links in open cards ($0 to $9 the match and its groups; {repo} and {owner} from the
// terminal's git remote). No link rules ship.
// This is the only file in the mod that writes, and it writes only this file and pins.json
// beside it (pins.js has the format).

import { writeTextFile } from "herdr";
import { TAKEN_LETTERS, bubbleValue, TEXT_SIZE, TEXT_RANGE } from "./ui.js";
import { MOD, PREVIOUS } from "./name.js";

export const DEFAULTS = Object.freeze({ textSize: TEXT_SIZE, promptLines: 4, replyLines: 6, agentTurns: false, bubbleColor: "slate", agentBubbleColor: "plum", youName: "You", readingWidth: true, viewerReply: true });
export const RANGES = Object.freeze({ textSize: TEXT_RANGE, promptLines: [1, 10], replyLines: [1, 12] });
export const FILE = "settings.json";
// "look": 2 marks a file written since the chat look, whose defaults are 4 and 6 lines.
// Builds before it wrote every value on any change, so a file without the mark that holds
// exactly their defaults (2 and 3) reads as the new defaults; the next save adds the mark.
export const LOOK = 2;

export function settingsDir(appHome) { return `${appHome}/data/${MOD}`; }
export function settingsPath(appHome) { return `${settingsDir(appHome)}/${FILE}`; }
export function pinsPath(appHome) { return `${settingsDir(appHome)}/pins.json`; }

const clampInt = (v, [lo, hi], dflt) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt;
};

// A name to show: one line of 1 to 40 characters, trimmed, or null.
export const NAME_MAX = 40;
export function nameValue(v) {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? [...s].slice(0, NAME_MAX).join("") : null;
}

// { values, error }: values always complete; error is a one-line note when the text is not
// a JSON object (the defaults apply then). A missing file (null) is not an error.
export function parseSettings(text) {
  if (text == null || String(text).trim() === "") return { values: { ...DEFAULTS }, error: null };
  let raw;
  try { raw = JSON.parse(text); } catch { return { values: { ...DEFAULTS }, error: "settings.json is not valid JSON; using defaults" }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { values: { ...DEFAULTS }, error: "settings.json is not a JSON object; using defaults" };
  const old = raw.look == null && raw.promptLines === 2 && raw.replyLines === 3;
  return {
    values: {
      textSize: clampInt(raw.textSize, RANGES.textSize, DEFAULTS.textSize),
      promptLines: old ? DEFAULTS.promptLines : clampInt(raw.promptLines, RANGES.promptLines, DEFAULTS.promptLines),
      replyLines: old ? DEFAULTS.replyLines : clampInt(raw.replyLines, RANGES.replyLines, DEFAULTS.replyLines),
      agentTurns: typeof raw.agentTurns === "boolean" ? raw.agentTurns : DEFAULTS.agentTurns,
      bubbleColor: bubbleValue(raw.bubbleColor) ?? DEFAULTS.bubbleColor,
      agentBubbleColor: bubbleValue(raw.agentBubbleColor) ?? DEFAULTS.agentBubbleColor,
      youName: nameValue(raw.youName) ?? DEFAULTS.youName,
      readingWidth: typeof raw.readingWidth === "boolean" ? raw.readingWidth : DEFAULTS.readingWidth,
      viewerReply: typeof raw.viewerReply === "boolean" ? raw.viewerReply : DEFAULTS.viewerReply,
    },
    error: null,
  };
}

// ---- keys the panel reads but never rewrites: quoteKey and links ----
// They stay out of the values above, so a save made from the panel (which writes
// {...file, ...values}) keeps them exactly as they were written, even mid-edit.

// quoteKey: one lowercase letter a–z the panel does not already use. Anything else falls
// back to q, with a note. { key, note }.
export function parseQuoteKey(v) {
  if (v == null) return { key: "q", note: null };
  if (typeof v === "string" && /^[a-z]$/.test(v) && !TAKEN_LETTERS.includes(v)) return { key: v, note: null };
  const shown = typeof v === "string" ? JSON.stringify(v.slice(0, 12)) : String(JSON.stringify(v)).slice(0, 12);
  return { key: "q", note: `quoteKey ${shown} is not a free letter a–z (taken: ${TAKEN_LETTERS.join(" ")}); using q` };
}

export const MAX_RULES = 20;
const now = () => globalThis.performance?.now?.() ?? Date.now();

// The pattern shapes that can take exponential time on a near miss, or null: a quantified
// group that holds a quantifier ("(a+)+", "(.*)*", "(\w+){2,}"), or one that holds an
// alternation, whose branches can overlap ("(a|aa)+", "(?:x|\w)*").
function riskyShape(p) {
  const stack = [];
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "\\") { i++; if (stack.length && /[dDwWsS]/.test(p[i] ?? "") && /[+*{]/.test(p[i + 1] ?? "")) stack[stack.length - 1].q = true; continue; }
    if (c === "[") { let j = i + 1; if (p[j] === "^") j++; if (p[j] === "]") j++; while (j < p.length && p[j] !== "]") { if (p[j] === "\\") j++; j++; } i = j; if (stack.length && /[+*{]/.test(p[i + 1] ?? "")) stack[stack.length - 1].q = true; continue; }
    if (c === "(") { stack.push({ q: false, alt: false }); continue; }
    if (c === "|") { if (stack.length) stack[stack.length - 1].alt = true; continue; }
    if (c === ")") {
      const g = stack.pop() ?? { q: false, alt: false };
      const after = p.slice(i + 1);
      const outer = /^(\+|\*|\{\d*,\d*\}|\{\d{2,}\})/.test(after);
      if (g.q && outer) return "nested quantifier, as in (a+)+";
      if (g.alt && outer) return "alternation under a quantifier, as in (a|aa)+";
      if (stack.length && (g.q || outer)) stack[stack.length - 1].q = true;
      continue;
    }
    if (/[+*]/.test(c) || (c === "{" && /^\{\d*,?\d*\}/.test(p.slice(i)))) { if (stack.length) stack[stack.length - 1].q = true; }
  }
  return null;
}

// The template's host, or null when the template is not literal "https://" or "http://"
// and a fixed host (no "@", no placeholder), with placeholders only after the path starts.
export function templateHost(url) {
  const m = /^https?:\/\/([^/?#\s]+)(\/.*)?$/.exec(String(url ?? ""));
  if (!m || /[@${}\\]/.test(m[1]) || !m[2]) return null;
  if (/\{(?!(repo|owner)\})/.test(m[2])) return null;
  return m[1].toLowerCase();
}

// links: [{ name, pattern, url }] → { rules, notes }. A rule is dropped, with a note, when
// it has no pattern or URL, the pattern is over 200 characters, does not compile, matches
// the empty string, has a nested quantifier, an alternation under a quantifier or a
// backreference, takes over 5 ms on a hostile probe (up to 33 characters), its URL template is not a fixed http(s) host, or it is past the 20th.
// Each kept rule: { n, name, re (global), url, host, repo (uses {repo} or {owner}) }.
export function parseLinks(raw) {
  const rules = [];
  const notes = [];
  if (raw == null) return { rules, notes };
  if (!Array.isArray(raw)) return { rules, notes: ["links is not a list; no link rules"] };
  raw.forEach((r, i) => {
    const n = i + 1;
    const no = (why) => notes.push(`Link rule ${n}: ${why}`);
    if (i >= MAX_RULES) return no(`past the ${MAX_RULES}th rule; ignored`);
    if (!r || typeof r !== "object") return no("not an object");
    const { pattern, url } = r;
    if (typeof pattern !== "string" || !pattern) return no("no pattern");
    if (typeof url !== "string" || !url) return no("no url");
    if (pattern.length > 200) return no("pattern over 200 characters");
    if (/\\[1-9]|\\k</.test(pattern)) return no("backreferences are not allowed");
    const risky = riskyShape(pattern);
    if (risky) return no(risky);
    let re;
    try { re = new RegExp(pattern, "g"); } catch { return no("pattern not valid"); }
    for (const probe of ["", "a", "a b", "#1", " "]) {
      re.lastIndex = 0;
      const m = re.exec(probe);
      if (m && m[0] === "") return no("pattern matches empty text");
    }
    const host = templateHost(url);
    if (!host) return no("url must start with https:// or http:// and a fixed host; placeholders only in the path");
    // Hostile probes of growing length, two characters at a time, stopping at the first one
    // over 5 ms: a pattern whose time grows exponentially is caught at a length where one
    // probe still costs only a few times the last (a long first probe would hang on it).
    const lit = (/^(?:[A-Za-z0-9_-]|\\.)+/.exec(pattern)?.[0] ?? "").replace(/\\(.)/g, "$1").slice(0, 8) || "a";
    for (let len = 12; len <= 32; len += 2) {
      for (const probe of [`${"a".repeat(len)}!`, `${"1".repeat(len)}!`, `${lit.repeat(Math.ceil(len / lit.length))}!`, `${"#".repeat(len)}!`, `${" ".repeat(len)}!`]) {
        const t0 = now();
        re.lastIndex = 0;
        re.exec(probe);
        if (now() - t0 > 5) return no("too slow on a short test text; disabled");
      }
    }
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 40) : `Rule ${n}`;
    rules.push({ n, name, re, url, host, repo: /\{(repo|owner)\}/.test(url) });
  });
  return { rules, notes };
}

// quoteKey and links from the file's text, with their notes. Text that does not parse
// gives the defaults (parseSettings reports that).
export function parseExtras(text) {
  let raw = null;
  try { raw = JSON.parse(text ?? ""); } catch { /* reported by parseSettings */ }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
  const quote = parseQuoteKey(raw.quoteKey);
  const links = parseLinks(raw.links);
  return { quoteKey: quote.key, links: links.rules, notes: [...(quote.note ? [quote.note] : []), ...links.notes], linkCount: Array.isArray(raw.links) ? raw.links.length : 0 };
}

// The file's text for a set of values. Keys this version does not know are kept, so a
// newer version's settings survive a change made here.
export function settingsText(values, previous) {
  let keep = {};
  try { const p = JSON.parse(previous ?? ""); if (p && typeof p === "object" && !Array.isArray(p)) keep = p; } catch { /* replaced */ }
  const { values: v } = parseSettings(JSON.stringify({ ...keep, ...values, look: LOOK }));
  return `${JSON.stringify({ ...keep, ...v, look: LOOK }, null, 2)}\n`;
}

// Whether a save may replace the file: not while it holds text that is not a settings
// object (a hand edit in progress), which a save would wipe.
export function writable(text) {
  return text == null || String(text).trim() === "" || parseSettings(text).error == null;
}

export const NOT_SAVED = "settings.json is not valid JSON, so it was left as it is; the change applies until the file is fixed";

// Writes the settings file. expected: the text last read (null when there was no file),
// so a save never overwrites a change made in an editor meanwhile; Herdr rejects a stale
// snapshot and the caller reads again. Refuses (rejects with NOT_SAVED) while the file's
// text does not parse.
export function saveSettings(appHome, values, expected) {
  if (!writable(expected)) return Promise.reject(new Error(NOT_SAVED));
  return writeTextFile(settingsPath(appHome), settingsText(values, expected), expected ?? null);
}

// Writes the pins file. expected: its text as just read (null when there was no file), so a
// save from one pane never overwrites another pane's; Herdr rejects a stale snapshot.
export function savePinsText(appHome, text, expected) {
  return writeTextFile(pinsPath(appHome), text, expected ?? null);
}

// A settings file saved under one of the mod's earlier names (name.js PREVIOUS), adopted
// once when this name has none, so a rename keeps a person's settings and link rules.
// read: Herdr's readTextFile. Returns the adopted text, or null. The old file is left as
// it was; the copy is the settings file's own write.
export async function adoptPrevious(appHome, read) {
  for (const old of PREVIOUS) {
    const text = await read(`${appHome}/data/${old}/settings.json`).catch(() => null);
    if (text == null || !String(text).trim()) continue;
    await copySettings(appHome, text).catch(() => null);
    return text;
  }
  return null;
}
function copySettings(appHome, text) {
  return writeTextFile(settingsPath(appHome), text, null);
}
