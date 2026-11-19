// agent-threads: the person's settings, in Herdr's per-mod data folder
// ($HERDR_APP_HOME/data/agent-threads/settings.json, outside mods/, so an update or a
// reinstall, which replaces mods/agent-threads/, leaves it alone). A person can edit it by
// hand; the pane watches it and applies a change at once.
//
//   { "textSize": 14, "promptLines": 4, "replyLines": 6, "agentTurns": false, "bubbleColor": "blue",
//     "agentBubbleColor": "amber", "quoteKey": "q",
//     "links": [{ "name": "Issue", "pattern": "\\bACME-(\\d+)\\b", "url": "https://linear.app/acme/issue/ACME-$1" }] }
//
// textSize (12 to 18): the px size of message and reply text (ui.js readType sets its line
// height and line length). promptLines (1 to 10) and replyLines (1 to 12): lines of prompt and of reply preview in a
// collapsed row. agentTurns: show turns another agent, a schedule or the SDK sent.
// agentRail: agent messages the list shows get ticks on the turn rail (true, the default);
// false leaves them off it (the running turn keeps its tick).
// bubbleColor and agentBubbleColor: the fill of the user's and of an agent's message
// bubbles, a preset name (ui.js BUBBLES; "blue" is the user's default, plain before it, and
// "amber" the agent's, plum before it; a file that holds plain or plum keeps it; "plain" is
// the theme's own look) or "#rrggbb".
// truncate: shorten long messages (false, the default: every message and reply shows in full,
// with no Show more anywhere). On, a collapsed row shows promptLines and replyLines of each
// with Show more, and an open turn's message and running reply are cut with Show all.
// alwaysShowTime: keep each message's time under its bubble (false, the default: the time
// shows under the selected turn's bubble only).
// railSide: the side of the list the turn rail sits on, "right" (the default) or "left".
// keyHints: the row of key hints at the pane's foot (false, the default: "? keys" at the
// settings card's foot and ? still show every key).
// statusLine: the chat's stats in one row at the pane's very bottom (true, the default).
// width: how long a reading line may be, "comfortable" (70 characters, the default), "wide"
// (90) or "full" (no limit; a bubble still stops at 90). One value for every pane.
// readingWidth: keep the Threads pane at the width's column (true, the default): a pane that
// opens or is dragged wider is resized back, and the terminal gets the room. Choosing a width
// with it on resizes the pane to that column; choosing Full turns it off.
// viewerReply: the image viewer shows the turn's prompt and reply beside the image (true, the
// default); i in the viewer shows or hides it, and the viewer writes the choice here.
// quoteKey: the key that quotes a reply into the terminal; the settings card writes it.
// links: text patterns shown as links in open cards ($0 to $9 the match and its groups;
// {repo} and {owner} from the terminal's git remote), each with four optional keys: on
// (false skips the rule), type ("custom", "ticket" or "pull-request", the icon it shows;
// anything else reads as custom), description (one line of the person's own, 80 characters
// at most) and example (text the rule should turn into a link, shown on the Link rules
// page). The card's Link rules page writes the whole list. A fresh install (no file) has one
// rule, the pull request rule (DEFAULT_LINKS), switched on; the first write records it.
// senders: rules that mark a typed prompt as an agent message and name its sender
// (parseSenders), kept as written. No sender rules ship.
// This is the only file in the mod that writes, and it writes only this file and pins.json
// beside it (pins.js has the format).

import { writeTextFile } from "herdr";
import { TAKEN_LETTERS, bubbleValue, TEXT_SIZE, TEXT_RANGE, WIDTH_NAMES } from "./ui.js";
import { MOD, PREVIOUS } from "./name.js";
import { RULE_TEXT } from "./core/turns.js";

export const DEFAULTS = Object.freeze({ textSize: TEXT_SIZE, promptLines: 4, replyLines: 6, agentTurns: false, agentRail: true, bubbleColor: "blue", agentBubbleColor: "amber", width: "comfortable", readingWidth: true, viewerReply: true, alwaysShowTime: false, truncate: false, railSide: "right", keyHints: false, statusLine: true });
export const RANGES = Object.freeze({ textSize: TEXT_RANGE, promptLines: [1, 10], replyLines: [1, 12] });
export const FILE = "settings.json";
// "look": 2 marks a file written since the chat look, whose defaults are 4 and 6 lines.
// Builds before it wrote every value on any change, so a file without the mark that holds
// exactly their defaults (2 and 3) reads as the new defaults; the next save adds the mark.
// "look": 3 marks a file written since the quiet look. Builds before it wrote the old
// default, slate, on any change, so a file without the mark that holds slate reads as the
// default (blue); any other colour in it was the user's choice and is kept.
export const LOOK = 3;

export function settingsDir(appHome) { return `${appHome}/data/${MOD}`; }
export function settingsPath(appHome) { return `${settingsDir(appHome)}/${FILE}`; }
export function pinsPath(appHome) { return `${settingsDir(appHome)}/pins.json`; }

const clampInt = (v, [lo, hi], dflt) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt;
};


// { values, error }: values always complete; error is a one-line note when the text is not
// a JSON object (the defaults apply then). A missing file (null) is not an error.
export function parseSettings(text) {
  if (text == null || String(text).trim() === "") return { values: { ...DEFAULTS }, error: null };
  let raw;
  try { raw = JSON.parse(text); } catch { return { values: { ...DEFAULTS }, error: "settings.json is not valid JSON; using defaults" }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { values: { ...DEFAULTS }, error: "settings.json is not a JSON object; using defaults" };
  const old = raw.look == null && raw.promptLines === 2 && raw.replyLines === 3;
  const bubble = bubbleValue(raw.bubbleColor);
  const slate = bubble === "slate" && !(Number(raw.look) >= 3);
  return {
    values: {
      textSize: clampInt(raw.textSize, RANGES.textSize, DEFAULTS.textSize),
      promptLines: old ? DEFAULTS.promptLines : clampInt(raw.promptLines, RANGES.promptLines, DEFAULTS.promptLines),
      replyLines: old ? DEFAULTS.replyLines : clampInt(raw.replyLines, RANGES.replyLines, DEFAULTS.replyLines),
      agentTurns: typeof raw.agentTurns === "boolean" ? raw.agentTurns : DEFAULTS.agentTurns,
      agentRail: typeof raw.agentRail === "boolean" ? raw.agentRail : DEFAULTS.agentRail,
      bubbleColor: slate ? DEFAULTS.bubbleColor : bubble ?? DEFAULTS.bubbleColor,
      agentBubbleColor: bubbleValue(raw.agentBubbleColor) ?? DEFAULTS.agentBubbleColor,
      width: WIDTH_NAMES.includes(raw.width) ? raw.width : DEFAULTS.width,
      readingWidth: typeof raw.readingWidth === "boolean" ? raw.readingWidth : DEFAULTS.readingWidth,
      viewerReply: typeof raw.viewerReply === "boolean" ? raw.viewerReply : DEFAULTS.viewerReply,
      alwaysShowTime: typeof raw.alwaysShowTime === "boolean" ? raw.alwaysShowTime : DEFAULTS.alwaysShowTime,
      truncate: typeof raw.truncate === "boolean" ? raw.truncate : DEFAULTS.truncate,
      railSide: raw.railSide === "left" || raw.railSide === "right" ? raw.railSide : DEFAULTS.railSide,
      keyHints: typeof raw.keyHints === "boolean" ? raw.keyHints : DEFAULTS.keyHints,
      statusLine: typeof raw.statusLine === "boolean" ? raw.statusLine : DEFAULTS.statusLine,
    },
    error: null,
  };
}

// ---- keys kept apart from the values: quoteKey, links and senders ----
// They stay out of the values above, so a save made from the panel (which writes
// {...file, ...values}) keeps them exactly as they were written, even mid-edit. The card's
// quote key field writes quoteKey alone, as an extra (settingsText).

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
    // In JavaScript "[]" and "[^]" are whole classes: a "]" right after "[" or "[^" ends it.
    if (c === "[") { let j = i + 1; if (p[j] === "^") j++; while (j < p.length && p[j] !== "]") { if (p[j] === "\\") j++; j++; } i = j; if (stack.length && /[+*{]/.test(p[i + 1] ?? "")) stack[stack.length - 1].q = true; continue; }
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

// A rule's pattern compiled with flags, or why it is refused: over 200 characters, a
// backreference, a nested quantifier or an alternation under a quantifier (riskyShape), not
// valid, or matching empty text. { re } or { why }.
function patternShape(pattern, flags) {
  if (pattern.length > 200) return { why: "pattern over 200 characters" };
  if (/\\[1-9]|\\k</.test(pattern)) return { why: "backreferences are not allowed" };
  const risky = riskyShape(pattern);
  if (risky) return { why: risky };
  let re;
  try { re = new RegExp(pattern, flags); } catch { return { why: "pattern not valid" }; }
  for (const probe of ["", "a", "a b", "#1", " "]) {
    re.lastIndex = 0;
    const m = re.exec(probe);
    if (m && m[0] === "") return { why: "pattern matches empty text" };
  }
  return { re };
}

// The most work a sender pattern can take on one prompt, worked out from the pattern alone
// and never timed, so neither a slow machine nor a pause can change it. A regular
// expression with no backreference and no nested repeat (both refused before this) tries
// each way of splitting the text between its repeats at most once from each start: the
// count of those ways, bounded by the RULE_TEXT characters a rule ever sees, bounds its
// steps. { open, steps }: open is the number of open-ended repeats (*, + and {n,}); steps
// counts every place the matcher can stand at every part of the pattern, as if every
// character matched, so it is an upper bound. A lookahead or lookbehind is tried once each
// time it is reached and never backed into. Stops counting past stop, or 1e12.
export function senderCost(pattern, room = RULE_TEXT, stop = Infinity) {
  let i = 0;
  let open = 0;
  const p = pattern;
  // The pattern as a tree: { alt: [seq] }, a seq is a list of items, an item is
  // { kind: "char" | "start" | "zero" | "look" | "group", alt?, min, max }.
  const parseAlt = () => {
    const alt = [parseSeq()];
    while (p[i] === "|") { i++; alt.push(parseSeq()); }
    return alt;
  };
  const parseSeq = () => {
    const seq = [];
    while (i < p.length && p[i] !== "|" && p[i] !== ")") {
      const item = parseAtom();
      const q = /^(?:([*+?])|\{(\d+)(?:(,)(\d*))?\})\??/.exec(p.slice(i));
      if (q) {
        i += q[0].length;
        if (q[1]) { item.min = q[1] === "+" ? 1 : 0; item.max = q[1] === "?" ? 1 : Infinity; } else { item.min = Number(q[2]); item.max = q[3] ? (q[4] ? Number(q[4]) : Infinity) : item.min; }
        if (item.max === Infinity) open++;
      }
      seq.push(item);
    }
    return seq;
  };
  const parseAtom = () => {
    const c = p[i];
    if (c === "(") {
      const m = /^\(\?(?:[:=!]|<[=!]|<[A-Za-z_$][\w$]*>)/.exec(p.slice(i));
      const look = m && /^\(\?(?:[=!]|<[=!])$/.test(m[0]);
      i += m ? m[0].length : 1;
      const alt = parseAlt();
      i++; // ")"
      return { kind: look ? "look" : "group", alt, min: 1, max: 1 };
    }
    if (c === "[") {
      // "[]" (nothing) and "[^]" (any character) are whole classes in JavaScript.
      let j = i + 1;
      if (p[j] === "^") j++;
      while (j < p.length && p[j] !== "]") { if (p[j] === "\\") j++; j++; }
      i = j + 1;
      return { kind: "char", min: 1, max: 1 };
    }
    if (c === "\\") {
      const e = p[i + 1] ?? "";
      i += 2;
      if (e === "b" || e === "B") return { kind: "zero", min: 1, max: 1 };
      if (e === "u" && /^[0-9A-Fa-f]{4}/.test(p.slice(i))) i += 4;
      else if (e === "x" && /^[0-9A-Fa-f]{2}/.test(p.slice(i))) i += 2;
      else if (e === "c" && /^[A-Za-z]/.test(p[i] ?? "")) i++;
      return { kind: "char", min: 1, max: 1 };
    }
    i++;
    if (c === "^") return { kind: "start", min: 1, max: 1 };
    if (c === "$") return { kind: "zero", min: 1, max: 1 };
    return { kind: "char", min: 1, max: 1 };
  };
  const tree = parseAlt();
  const CAP = 1e12;
  const size = room + 1;
  const STOP = {};
  let spent = 0;
  const add = (n) => { spent = Math.min(CAP, spent + n); if (spent > stop) throw STOP; };
  const sum = (d) => { let s = 0; for (let x = 0; x < size; x++) s += d[x]; return Math.min(CAP, s); };
  const unit = () => { const d = new Float64Array(size); d[0] = 1; return d; };
  // The steps a group or lookaround takes once, from one place, kept apart from spent.
  const alone = (alt) => { const before = spent; const d = runAlt(alt, unit(), false); const c = spent - before; spent = before; return { d, c }; };
  // d[x]: the number of paths that stand x characters into the head. abs: x counts from the
  // head's start, so ^ keeps only 0 (inside a repeat it counts from where the repeat began).
  const runAlt = (alt, d, abs) => {
    if (alt.length === 1) return runSeq(alt[0], d, abs);
    const out = new Float64Array(size);
    for (const seq of alt) { const r = runSeq(seq, d, abs); for (let x = 0; x < size; x++) out[x] = Math.min(CAP, out[x] + r[x]); }
    return out;
  };
  const runSeq = (seq, d, abs) => {
    for (const item of seq) d = item.min === 1 && item.max === 1 ? once(item, d, abs) : repeat(item, d, abs);
    return d;
  };
  const once = (item, d, abs) => {
    const n = sum(d);
    add(n);
    if (item.kind === "char") { const out = new Float64Array(size); out.set(d.subarray(0, room), 1); return out; }
    if (item.kind === "start") { if (!abs) return d; const out = new Float64Array(size); out[0] = d[0]; return out; }
    if (item.kind === "look") { if (n) add(n * alone(item.alt).c); return d; }
    if (item.kind === "zero") return d;
    return runAlt(item.alt, d, abs);
  };
  const repeat = (item, d, abs) => {
    if (item.kind === "char") {
      // min times, then up to max - min more: each path ends anywhere in that window.
      for (let k = 0; k < Math.min(item.min, size); k++) d = once(item, d, abs);
      if (item.min >= size) return new Float64Array(size);
      const span = Math.min(item.max - item.min, room);
      const out = new Float64Array(size);
      let win = 0;
      for (let x = 0; x < size; x++) { win += d[x]; if (x > span) win -= d[x - span - 1]; out[x] = Math.min(CAP, win); }
      add(sum(out));
      return out;
    }
    if (item.kind !== "group") { add(sum(d) * Math.min(item.min, size)); return d; }
    // A group of fixed shape (no repeat inside a repeated group gets this far): one time of
    // it from one place (rel), min times, then each further time while the head lasts. A
    // further time that takes no text ends the repeat, as in JavaScript.
    const rel = alone(item.alt);
    const at = [];
    for (let k = 0; k < size; k++) if (rel.d[k]) at.push(k, rel.d[k]);
    const step = (from, skip0) => {
      add(sum(from) * (1 + rel.c));
      const out = new Float64Array(size);
      for (let x = 0; x < size; x++) {
        if (!from[x]) continue;
        for (let j = 0; j < at.length; j += 2) if ((at[j] || !skip0) && x + at[j] < size) out[x + at[j]] = Math.min(CAP, out[x + at[j]] + from[x] * at[j + 1]);
      }
      return out;
    };
    for (let k = 0; k < Math.min(item.min, size + 1); k++) d = step(d, false);
    if (item.min > size + 1 && sum(d) > 0) add(CAP);
    const out = d.slice();
    for (let k = item.min; k < item.max && sum(d) > 0; k++) {
      d = step(d, true);
      for (let x = 0; x < size; x++) out[x] = Math.min(CAP, out[x] + d[x]);
    }
    return out;
  };
  try { runAlt(tree, new Float64Array(size).fill(1), true); } catch (e) { if (e !== STOP) throw e; }
  return { open, steps: spent };
}
// The most open-ended repeats a sender pattern may have, and the most steps (senderCost).
export const SENDER_OPEN = 3;
export const SENDER_STEPS = 1e6;
// The most steps all sender rules together may take on one prompt: rules past it are dropped.
export const SENDER_TOTAL = 2e6;

// A rule's type: the icon the Link rules page shows for it, and nothing else.
export const LINK_TYPES = Object.freeze(["custom", "ticket", "pull-request"]);
export const DESCRIPTION_MAX = 80;
const EXAMPLE_MAX = 200;

// links: [{ name, pattern, url, on?, type?, description?, example? }] → { rules, notes, list }.
// A rule is not working, with a note, when
// it has no pattern or URL, the pattern is over 200 characters, does not compile, matches
// the empty string, has a nested quantifier, an alternation under a quantifier or a
// backreference, takes over 5 ms on a hostile probe (up to 33 characters) or over 3 ms on a run of one kind of
// character (up to 2,048), its URL template is not a fixed http(s) host, or it is past the 20th.
// Each kept rule: { n, name, re (global), url, host, repo (uses {repo} or {owner}) }. A rule
// with on: false is kept out of rules (it links nothing and takes no text from the rules
// below it) and has no note. list: one entry a rule in the file, for the Link rules page:
// { n, name, type, description, example, on, pattern, url, why (null when it works), rule }.
export function parseLinks(raw) {
  const rules = [];
  const notes = [];
  const list = [];
  if (raw == null) return { rules, notes, list };
  if (!Array.isArray(raw)) return { rules, notes: ["links is not a list; no link rules"], list };
  raw.forEach((r, i) => {
    const n = i + 1;
    const o = r && typeof r === "object" && !Array.isArray(r) ? r : {};
    const text = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
    const entry = {
      n, name: text(o.name, 40) || `Rule ${n}`, type: LINK_TYPES.includes(o.type) ? o.type : "custom",
      description: text(o.description, DESCRIPTION_MAX), example: typeof o.example === "string" ? o.example.slice(0, EXAMPLE_MAX) : "",
      on: o.on !== false, pattern: typeof o.pattern === "string" ? o.pattern : "", url: typeof o.url === "string" ? o.url : "", why: null, rule: null,
    };
    list.push(entry);
    const why = linkFault(r, i);
    if (why) { entry.why = why; notes.push(`Link rule ${n}: ${why}`); return; }
    entry.rule = { n, name: entry.name, re: new RegExp(entry.pattern, "g"), url: entry.url, host: templateHost(entry.url), repo: /\{(repo|owner)\}/.test(entry.url) };
    if (entry.on) rules.push(entry.rule);
  });
  return { rules, notes, list };
}

// The three types, each with its line for the chooser and, for two, the rule it fills a new
// one with. The ticket rule's address is a stand-in for the person's own tracker.
export const LINK_TEMPLATES = Object.freeze({
  custom: Object.freeze({ word: "Custom", line: "Write it yourself.", rule: null }),
  ticket: Object.freeze({ word: "Ticket key", line: "Links a ticket key such as ACME-412 to its ticket.",
    rule: Object.freeze({ name: "Ticket", pattern: "\\bACME-(\\d+)\\b", url: "https://tracker.example.com/ACME-$1", example: "Fixed in ACME-412." }) }),
  "pull-request": Object.freeze({ word: "Pull request", line: "Links a number such as #58 to that pull request in this repository.",
    rule: Object.freeze({ name: "Pull request", pattern: "(?<![\\w&/#])#(\\d{1,5})\\b", url: "https://github.com/{repo}/pull/$1", example: "Merged in #58." }) }),
});
// What a fresh install starts with: the pull request rule, on. It needs only the session's
// repository (a terminal folder with an origin on GitHub).
export function defaultLinks() {
  return [{ ...LINK_TEMPLATES["pull-request"].rule, type: "pull-request" }];
}
// No file yet, or an empty one: what a fresh install starts from.
const fresh = (text) => text == null || String(text).trim() === "";

// Why a rule would not run, for the card's rule editor; null when it would.
export function ruleFault(r) { return linkFault(r, 0); }

// Why rule i cannot run, in the words the page and the notes use, or null when it can.
function linkFault(r, i) {
  if (i >= MAX_RULES) return `past the ${MAX_RULES}th rule; ignored`;
  if (!r || typeof r !== "object") return "not an object";
  const { pattern, url } = r;
  if (typeof pattern !== "string" || !pattern) return "no pattern";
  if (typeof url !== "string" || !url) return "no url";
  if (pattern.length > 200) return "pattern over 200 characters";
  if (/\\[1-9]|\\k</.test(pattern)) return "backreferences are not allowed";
  const risky = riskyShape(pattern);
  if (risky) return risky;
  let re;
  try { re = new RegExp(pattern, "g"); } catch { return "pattern not valid"; }
  for (const probe of ["", "a", "a b", "#1", " "]) {
    re.lastIndex = 0;
    const m = re.exec(probe);
    if (m && m[0] === "") return "pattern matches empty text";
  }
  if (!templateHost(url)) return "url must start with https:// or http:// and a fixed host; placeholders only in the path";
  // Hostile probes of growing length, two characters at a time, stopping at the first one
  // over 5 ms: a pattern whose time grows exponentially is caught at a length where one
  // probe still costs only a few times the last (a long first probe would hang on it).
  const lit = (/^(?:[A-Za-z0-9_-]|\\.)+/.exec(pattern)?.[0] ?? "").replace(/\\(.)/g, "$1").slice(0, 8) || "a";
  for (let len = 12; len <= 32; len += 2) {
    for (const probe of [`${"a".repeat(len)}!`, `${"1".repeat(len)}!`, `${lit.repeat(Math.ceil(len / lit.length))}!`, `${"#".repeat(len)}!`, `${" ".repeat(len)}!`]) {
      if (runTime(re, probe, 5) > 5) return "too slow on a short test text; disabled";
    }
  }
  // Long runs of one kind of character: quantifiers side by side that can take the same
  // characters ("\s*\s*Q", "\w+\w+X") cost polynomial time on a near miss, which the short
  // probes miss and nested-group shapes do not show. Lengths grow by half from 16 to 2,048,
  // stopping at the first probe over 3 ms (each step costs at most a few times the last),
  // and the whole check stops at 100 ms of run time (1 s on the clock, for a machine that
  // is very busy). A plain pattern runs these in about a millisecond.
  const start = now();
  let spent = 0;
  for (const unit of [" ", "a", "1", "a1 _-.", "#", lit]) {
    for (let len = 16; len <= LONG_PROBE; len = Math.ceil(len * 1.5)) {
      const probe = `${unit.repeat(Math.ceil(len / unit.length)).slice(0, len)}!`;
      const t = runTime(re, probe, 3);
      spent += t;
      if (t > 3 || spent > 100 || now() - start > 1000) return SLOW_LONG;
    }
  }
  return null;
}
// How long one search of probe takes, in ms. A run over limit is timed twice more and the
// fastest counts: a pause from the machine's load or a garbage collection lands on one run,
// while a slow pattern is slow every time.
function runTime(re, probe, limit) {
  let best = Number.POSITIVE_INFINITY;
  for (let k = 0; k < 3 && best > limit; k++) {
    const t0 = now();
    re.lastIndex = 0;
    re.exec(probe);
    best = Math.min(best, now() - t0);
  }
  return best;
}
const LONG_PROBE = 2048;
export const SLOW_LONG = "too slow on long text; disabled";

// senders: [{ name?, prefix } or { name?, pattern }] → { rules, notes }. A typed prompt one
// matches is an agent message (core/turns.js ruleSender). A prefix is literal text at the
// prompt's start with one {name} in it, the sender: "[{name}] ". A pattern is a JavaScript
// regular expression with a named group "sender": "^\\[(?<sender>[a-z-]+)\\] ".
// A rule is dropped, with a note, when it has both or neither, a prefix is over 100
// characters, has no {name} (it would mark every prompt that starts with it, "From:" or
// "ab", with no sender), holds {name} twice or has under 2 characters besides it, a pattern
// is not valid, has no sender group, fails a check link patterns have (patternShape), has
// more than SENDER_OPEN open-ended repeats, or could take more than SENDER_STEPS steps on a
// prompt, or would take the rules so far past SENDER_TOTAL steps between them (senderCost;
// a prefix rule counts too), so one prompt costs a bounded time whatever the rules
// prompt (senderCost), or it is past the 20th. Each kept rule: { n, label (its name, else
// its prefix or pattern), re, named (true: the match names the sender) }. No clock is read,
// so the same file always gives the same rules. No rule ships.
export function parseSenders(raw, cost = senderCost) {
  const rules = [];
  const notes = [];
  if (raw == null) return { rules, notes };
  if (!Array.isArray(raw)) return { rules, notes: ["senders is not a list; no sender rules"] };
  let spent = 0;
  // The step count, or why it could not be had: an error in the counter refuses this one
  // rule and leaves the others alone.
  const counted = (source) => {
    try {
      const c = cost(source, RULE_TEXT, SENDER_STEPS);
      if (!Number.isFinite(c?.open) || !(c?.steps >= 0)) throw new Error("no count");
      return c;
    } catch {
      return { why: "could not be checked; ignored" };
    }
  };
  const keep = (rule, steps) => {
    if (spent + steps > SENDER_TOTAL) return notes.push(`Sender rule ${rule.n}: the rules before it and this one could take over 2 million steps between them on a prompt; ignored`);
    spent += steps;
    rules.push(rule);
  };
  raw.forEach((r, i) => {
    const n = i + 1;
    const no = (why) => notes.push(`Sender rule ${n}: ${why}`);
    if (i >= MAX_RULES) return no(`past the ${MAX_RULES}th rule; ignored`);
    if (!r || typeof r !== "object") return no("not an object");
    const { prefix, pattern } = r;
    const hasPrefix = typeof prefix === "string" && prefix !== "";
    const hasPattern = typeof pattern === "string" && pattern !== "";
    if (hasPrefix === hasPattern) return no(hasPrefix ? "has both a prefix and a pattern; use one" : "no prefix or pattern");
    const label = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 40) : (hasPrefix ? prefix : pattern).slice(0, 60);
    if (hasPrefix) {
      if (prefix.length > 100) return no("prefix over 100 characters");
      const parts = prefix.split("{name}");
      if (parts.length > 2) return no("{name} more than once");
      if (parts.length < 2) return no("prefix has no {name}; it would mark every prompt that starts with it");
      if (parts.join("").trim().length < 2) return no("prefix needs 2 characters or more besides {name}");
      const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // The name runs to the text after it, or to a space or the end when it ends the prefix.
      const name = parts[1] ? "(?<sender>\\S{1,60}?)" : "(?<sender>\\S{1,60})(?=\\s|$)";
      const source = `^${esc(parts[0])}${name}${esc(parts[1])}`;
      const c = counted(source);
      if (c.why) return no(c.why);
      keep({ n, label, re: new RegExp(source), named: true }, c.steps);
      return;
    }
    const shape = patternShape(pattern, "");
    if (shape.why) return no(shape.why);
    if (!senderGroup(pattern)) return no("pattern has no (?<sender>...) group");
    const c = counted(pattern);
    if (c.why) return no(c.why);
    if (c.open > SENDER_OPEN) return no(`${c.open} open-ended repeats (*, + or {n,}); ${SENDER_OPEN} at most`);
    if (c.steps > SENDER_STEPS) return no(`could take too long on a prompt (over a million steps on its first ${RULE_TEXT} characters): start it with ^, or use fewer repeats`);
    keep({ n, label, re: shape.re, named: true }, c.steps);
  });
  return { rules, notes };
}

// Whether a valid pattern has a group named sender: an empty match of it or of nothing
// lists every named group, matched or not, so "\\(?<sender>" or "[(?<sender>]" does not count.
function senderGroup(pattern) {
  try { return "sender" in (new RegExp(`(?:${pattern})|`).exec("")?.groups ?? {}); } catch { return false; }
}

// quoteKey, links and senders from the file's text, with their notes. Text that does not
// parse gives the defaults (parseSettings reports that).
export function parseExtras(text) {
  let raw = null;
  try { raw = JSON.parse(text ?? ""); } catch { /* reported by parseSettings */ }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
  if (fresh(text)) raw = { links: defaultLinks() };
  const quote = parseQuoteKey(raw.quoteKey);
  const links = parseLinks(raw.links);
  const senders = parseSenders(raw.senders);
  return {
    quoteKey: quote.key, quoteNote: quote.note, links: links.rules, linkList: links.list, senders: senders.rules,
    notes: [...(quote.note ? [quote.note] : []), ...links.notes, ...senders.notes], senderNotes: senders.notes,
    linkCount: Array.isArray(raw.links) ? raw.links.length : 0,
    senderCount: Array.isArray(raw.senders) ? raw.senders.length : 0,
  };
}

// The file's text for a set of values. Keys this version does not know are kept, so a
// newer version's settings survive a change made here. extra: keys written as they are
// (the card's quote key, { quoteKey: "y" }).
export function settingsText(values, previous, extra = null) {
  let keep = fresh(previous) ? { links: defaultLinks() } : {};
  try { const p = JSON.parse(previous ?? ""); if (p && typeof p === "object" && !Array.isArray(p)) keep = p; } catch { /* replaced */ }
  if (extra) keep = { ...keep, ...extra };
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
export function saveSettings(appHome, values, expected, extra = null) {
  if (!writable(expected)) return Promise.reject(new Error(NOT_SAVED));
  return writeTextFile(settingsPath(appHome), settingsText(values, expected, extra), expected ?? null);
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
