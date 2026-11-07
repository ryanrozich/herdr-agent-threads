// agent-threads: pins as data (no Herdr imports), tested under bun. A pin keeps a turn one
// key away while the person reads something newer. The panel draws the tray and saves the
// file (settings.js savePinsText), $HERDR_APP_HOME/data/agent-threads/pins.json:
//
//   { "version": 1, "sessions": { "claude:<session id>": { "at": 1794000000000, "pins": [
//     { "id": "1794000000|abc|1", "n": 7, "text": "first 80 characters of the prompt", "at": 1794000000000,
//       "seen": { "len": 1200, "fu": 0 }, "anchor": ["md", "0.2"], "whole": true } ] } } }
//
// A turn's number can change when the way rows are built changes, so a pin keeps a
// fingerprint: the prompt's time in seconds, a hash of its text, and a count for repeats.

import { reply, firstLine, fmtTime } from "./turns.js";
import { dayKey, dayLabel } from "./ui.js";

export const PIN_LIMIT = 5; // the keys 1 to 5
export const PIN_TEXT = 80; // characters of the prompt kept, shown when the turn is gone
const MAX_SESSIONS = 200;
const MAX_AGE = 90 * 86400000;

const hash = (x) => {
  let h = 2166136261;
  for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
};

// A prompt's hash is kept per turn, since a live session asks again on every read.
const bases = new WeakMap();
function baseOf(turn) {
  const prompt = turn.prompt ?? "";
  const m = bases.get(turn);
  if (m && m.ts === turn.ts && m.len === prompt.length) return m.base;
  const base = `${turn.ts ? Math.floor(turn.ts / 1000) : "-"}|${hash(prompt)}`;
  bases.set(turn, { ts: turn.ts, len: prompt.length, base });
  return base;
}

// Every turn of a session under its fingerprint.
export function turnIds(turns) {
  const seen = new Map();
  const out = new Map();
  for (const t of turns) {
    const b = baseOf(t);
    const k = (seen.get(b) ?? 0) + 1;
    seen.set(b, k);
    out.set(`${b}|${k}`, t);
  }
  return out;
}

export function turnId(turns, turn) {
  const b = baseOf(turn);
  let k = 0;
  for (const t of turns) { if (baseOf(t) === b) k++; if (t === turn) break; }
  return `${b}|${k}`;
}

const validPin = (p) => p && typeof p === "object" && typeof p.id === "string" && p.id !== "";

// { store, error }: store is always usable; error is a note when the text is not a pins
// file, and then a save must leave the file alone. A missing file (null) is not an error.
export function parsePins(text) {
  const store = { version: 1, sessions: {} };
  if (text == null || String(text).trim() === "") return { store, error: null };
  let raw;
  try { raw = JSON.parse(text); } catch { return { store, error: "pins.json is not valid JSON" }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !raw.sessions || typeof raw.sessions !== "object") return { store, error: "pins.json is not a pins file" };
  for (const [k, rec] of Object.entries(raw.sessions)) {
    const pins = Array.isArray(rec?.pins) ? rec.pins.filter(validPin) : [];
    if (pins.length) store.sessions[k] = { at: Number(rec.at) || 0, pins };
  }
  return { store, error: null };
}

// The file's text. Sessions with no pins are dropped, then any untouched for 90 days, then
// the oldest past 200, so the file stays small.
export function pinsText(store, now = Date.now()) {
  const kept = Object.entries(store.sessions)
    .filter(([, rec]) => rec.pins.length && now - (rec.at || 0) <= MAX_AGE)
    .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
    .slice(0, MAX_SESSIONS);
  return `${JSON.stringify({ version: 1, sessions: Object.fromEntries(kept) }, null, 1)}\n`;
}

// What another pane saved, with this pane's unsaved sessions on top.
export function mergeDirty(fresh, ours, dirty) {
  const sessions = { ...fresh.sessions };
  for (const k of dirty) {
    if (ours.sessions[k]) sessions[k] = ours.sessions[k];
    else delete sessions[k];
  }
  return { version: 1, sessions };
}

export function seenOf(turn) { return { len: reply(turn).length, fu: turn.followups ?? 0 }; }

export function newPin(turns, turn, now = Date.now()) {
  return { id: turnId(turns, turn), n: turn.n, text: firstLine(turn.prompt ?? "").slice(0, PIN_TEXT), at: now, seen: seenOf(turn) };
}

// gone: the session is fully read and the turn is not in it. loading: not read yet.
export function pinState({ turn, loaded, live, seen }) {
  if (!turn) return loaded ? "gone" : "loading";
  if (live) return "live";
  const now = seenOf(turn);
  return now.len > (seen?.len ?? 0) || now.fu > (seen?.fu ?? 0) ? "new" : "quiet";
}

// A list item as a place in its turn, or null when the item is in another turn. A place
// names the part and not the turn's number or session index, which can change.
export function partOf(itemKey, turnKey) {
  if (itemKey === turnKey) return ["head"];
  const m = String(itemKey).split(":");
  if (`${m[1]}:${m[2]}` !== turnKey) return null;
  return [m[0], m[3] ?? null];
}

// The list items that show a place, best first. A reply drawn as one block and as
// paragraphs has different items (the pane may have been resized), so each stands in for
// the other. Empty for the head, which the panel scrolls to as a whole card.
export function partKeys(anchor, turnKey) {
  if (!anchor || anchor[0] === "head") return [];
  const [kind, sub] = anchor;
  const key = (s) => `${kind}:${turnKey}${s != null ? `:${s}` : ""}`;
  const out = [key(sub)];
  if (kind === "md" && sub != null) out.push(String(sub).includes(".") ? key(String(sub).split(".")[0]) : key(`${sub}.0`));
  return out;
}

// A tray row's time: the clock for today, then the day alone ("Yesterday", "4 Nov"), since
// a bare clock would mislead on an older pin.
export function pinWhen(ts, now = Date.now()) {
  if (!ts) return "";
  return dayKey(ts) === dayKey(now) ? fmtTime(ts) : dayLabel(ts, now);
}

// Whether the tray folds to one line of chips: when its 26 px rows would take over 30% of
// the pane below the header and above the footer. A pane that has not reported its height
// does not fold.
export function trayFolds(count, paneH) {
  const room = paneH - 96;
  return paneH > 0 && count * 26 + 8 > room * 0.3;
}
