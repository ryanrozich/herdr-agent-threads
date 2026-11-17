// agent-threads: a turn's stable id, the one pins have kept since pins.json version 1:
// "<prompt time in seconds>|<hash of the prompt>|<count among the same>". A turn's number
// can change when the way rows are built changes; its id does not, and a session read again
// from the top, or whose tail the agent rewrote (OpenCode, Cursor), gives every turn the id
// it had. Plain JavaScript with no Herdr imports.

export const hash = (x) => {
  let h = 2166136261;
  for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
};

// A prompt's hash is kept per turn, since a live session asks again on every read.
const bases = new WeakMap();
// The fingerprint's first part, the prompt's time in seconds: a turn from another second
// cannot match, so its prompt is never hashed (a pasted prompt of 950 KB took 41 ms, and
// stopped a draw while a session loaded).
const secOf = (turn) => (turn.ts ? String(Math.floor(turn.ts / 1000)) : "-");
function baseOf(turn) {
  const prompt = turn.prompt ?? "";
  const m = bases.get(turn);
  if (m && m.ts === turn.ts && m.len === prompt.length) return m.base;
  const base = `${secOf(turn)}|${hash(prompt)}`;
  bases.set(turn, { ts: turn.ts, len: prompt.length, base });
  return base;
}

// Every turn of a session under its fingerprint; with ids, only the turns from the seconds
// those ids name (the count for repeats only ever counts turns from the same second).
export function turnIds(turns, ids = null) {
  const only = ids ? new Set(Array.from(ids, (id) => String(id).split("|")[0])) : null;
  const seen = new Map();
  const out = new Map();
  for (const t of turns) {
    if (only && !only.has(secOf(t))) continue;
    const b = baseOf(t);
    const k = (seen.get(b) ?? 0) + 1;
    seen.set(b, k);
    out.set(`${b}|${k}`, t);
  }
  return out;
}

export function turnId(turns, turn) {
  const b = baseOf(turn);
  const sec = secOf(turn);
  let k = 0;
  for (const t of turns) { if (t !== turn && secOf(t) !== sec) continue; if (baseOf(t) === b) k++; if (t === turn) break; }
  return `${b}|${k}`;
}
