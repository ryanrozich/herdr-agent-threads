// agent-threads: the window's memory guard, as data (no Herdr imports), tested under bun
// (test/budget.test.js). Herdr runs every mod of a window in one QuickJS VM of 256 MiB, every
// Threads pane included, and once it is full every pane and Herdr's own mods throw together
// (Null"null"). The VM gives a mod no memory figure, so each pane estimates what its sessions
// hold (measure), the panes of a window add theirs up in one registry on globalThis (one VM is
// one window, and module scope is not enough: a hot reload evaluates the mod again beside the
// old one), and past BUDGET a session keeps only its newest turns (trim) or a side pane reads
// nothing. The same registry lets one read run at a time (takeRead) and lets a new copy of the
// mod release what the copies it replaces still hold (releaseOlder).
import { carryIds } from "./core/ids.js";

const MiB = 1024 * 1024;
// All Threads panes of a window together, in estimated VM bytes (sessionBytes). 256 MiB VM, less
// 13 MiB with no Threads pane (rig), less 24 MiB for one read in flight (a 4 MiB chunk: its
// 6 MiB of extractor output, the lines split from it and their events; one read at a time),
// leaves 219. QuickJS-NG collects cycles only when its heap passes 1.5 times what was live after
// the last collection (quickjs.c js_trigger_gc), and an allocation at the limit fails with no
// collection first, so live memory has to stay under 256 / 1.5 = 170 MiB for a collection to
// run before the limit: 170 - 13 - 24 = 133, and Herdr's own mods and other mods need room
// too. 144 fits the made-up 3,300-turn session (295 MB) in a Chat with a Pinned or a
// Trajectory pane (rig, Herdr 0.1.18: Chat 80 MiB, Pinned 46, Trajectory 50 over the 13), and
// turns the third pane away: 13 + 144 = 157 live, 236 at the collection line.
export const BUDGET = 144 * MiB;
// The largest extractor call while the window holds over half the budget (16 MiB otherwise).
export const TIGHT_CHUNK = 4 * MiB;
// A trim keeps the newest turns that fit in this share of the room, not all of it: a live
// session at the budget would otherwise trim on every chunk it writes, each time with a new
// build of every row (and of the Trajectory's), for a turn or two.
export const TRIM_TO = 0.85;
// What a pane holds for a session: its text once (twice the characters for a wide string),
// plus its fixed costs (objects, arrays, records) times the pane's weight: the Chat adds shapes
// and rows, the Trajectory its ledger rows, the Pinned pane shapes of what it reads. From the rig
// rows above and measure() of the same made-up session (test/make-big.js real: 164 B of text and
// 3,534 B fixed a turn, 0.5 and 11.1 MiB at 3,300 turns): chat (80 - 0.5) / 11.1 = 7.15, pinned
// (46 - 0.5) / 11.1 = 4.1, trajectory (50 - 0.5) / 11.1 = 4.45. test/budget.test.js checks it.
export const PANE_WEIGHT = Object.freeze({ chat: 7.15, pinned: 4.1, trajectory: 4.45 });

// What QuickJS-NG spends past the characters: a string's header and malloc's, an object, a
// usage record, a step, a call.
const STR = 24;
const PER_TURN = 1200;
const PER_USAGE = 200;
const PER_STEP = 200;
const PER_CALL = 100;
const PER_INFO = 140;
// A string with a character above U+00FF is kept at two bytes a character.
const WIDE = /[^\x00-\xff]/;
const chars = (x) => (typeof x === "string" ? (WIDE.test(x) ? 2 * x.length : x.length) : 0);
const many = (a) => { let n = 0; if (Array.isArray(a)) for (const x of a) n += chars(x); return n; };
const count = (a) => (Array.isArray(a) ? a.length : 0);

// One turn's estimate, [text, fixed]: the bytes of its texts, and of everything else.
export function turnBytes(t) {
  let text = chars(t.prompt) + many(t.after) + chars(t.latest) + many(t.latestParts) + many(t.updates) + many(t.errors) + many(t.reasoning);
  let strings = 1 + count(t.after) + count(t.latestParts) + count(t.updates) + count(t.errors) + count(t.reasoning);
  let fixed = PER_TURN + (t.usage ? Object.keys(t.usage).length * PER_USAGE : 0);
  for (const st of t.steps ?? []) {
    fixed += PER_STEP;
    text += chars(st.t) + chars(st.r);
    if (st.k !== "group") continue;
    fixed += st.calls.length * PER_CALL;
    text += many(st.calls) + many(st.ids);
    strings += count(st.calls) + count(st.ids);
    if (st.info) for (const i of st.info) if (i) { fixed += PER_INFO; text += chars(i.in); }
  }
  return [text, fixed + strings * STR];
}

// Each turn's last estimate, [text, fixed, the turn's version then], and each session's:
// { text, fixed, dropped, gone }, where dropped is the turns trim() let go and gone their estimate.
const SIZES = new WeakMap();
const META = new WeakMap();
const meta = (s) => { let m = META.get(s); if (!m) META.set(s, (m = { text: 0, fixed: 0, dropped: 0, gone: [0, 0] })); return m; };
const clock = () => globalThis.performance?.now?.() ?? Date.now();

// Measures the turns that changed since their last measure (a turn takes the session's version
// when it changes, turns.js apply) and returns the session's estimate. With until (a time on
// performance.now's clock), it stops once past it, after one turn at least, and returns null;
// the next call goes on.
export function measure(s, until = Infinity) {
  const m = meta(s);
  let text = 0;
  let fixed = s.calls?.size ? s.calls.size * PER_INFO : 0;
  let done = 0;
  for (const t of s.turns) {
    let b = SIZES.get(t);
    if (!b || b[2] !== t.v) {
      if (done++ && until !== Infinity && clock() > until) return null;
      const [x, f] = turnBytes(t);
      SIZES.set(t, (b = [x, f, t.v]));
    }
    text += b[0];
    fixed += b[1];
  }
  m.text = text;
  m.fixed = fixed;
  return m;
}
const weigh = (text, fixed, w) => text + w * fixed;
export function sessionBytes(s, w) {
  const m = META.get(s);
  return m ? weigh(m.text, m.fixed, w) : 0;
}
// A session read again from the top (main.js restart) starts with no estimate.
export const forgetSize = (s) => { META.delete(s); };

// Lets go of the oldest turns until the session is at most bytes at weight w, keeping at least
// the newest turn; the rest are numbered again from 1, so turns[n - 1] stays the turn numbered
// n. Returns how many went.
export function trim(s, bytes, w) {
  const m = meta(s);
  if (weigh(m.text, m.fixed, w) <= bytes || s.turns.length < 2) return 0;
  let k = 0;
  let text = m.text;
  let fixed = m.fixed;
  // The calls still waiting for their output are counted for the session (measure): each turn's
  // go with it.
  const calls = new Map();
  if (s.calls) for (const c of s.calls.values()) if (c.turn) calls.set(c.turn, (calls.get(c.turn) ?? 0) + 1);
  while (k < s.turns.length - 1 && weigh(text, fixed, w) > bytes) {
    const t = s.turns[k++];
    const b = SIZES.get(t) ?? [0, 0];
    text -= b[0];
    fixed -= b[1] + (calls.get(t) ?? 0) * PER_INFO;
  }
  const went = s.turns.splice(0, k);
  const dropped = new Set(went);
  // A repeated prompt keeps its count among the whole session's (core/ids.js), so pins match.
  m.ids = carryIds(went, s.turns, m.ids);
  s.version++;
  // A later turn a turn was answered in keeps its number less k (turns.js linkAnswer, closeOpen).
  for (const [i, t] of s.turns.entries()) {
    t.n = i + 1;
    t.v = s.version;
    if (t.answeredIn) t.answeredIn = Math.max(0, t.answeredIn - k) || null;
    if (t.answeredBy) t.answeredBy = Math.max(0, t.answeredBy - k) || null;
    const b = SIZES.get(t);
    if (b) b[2] = t.v;
  }
  if (s.calls) for (const [id, c] of s.calls) if (dropped.has(c.turn)) s.calls.delete(id);
  s.open = s.open.filter((t) => !dropped.has(t));
  for (const key of ["updateAt", "guess"]) if (dropped.has(s[key]?.turn)) s[key] = null;
  if (dropped.has(s.xTurn)) s.xTurn = null;
  if (s.settled) s.settled = Math.max(0, s.settled - k);
  m.gone = [m.gone[0] + m.text - text, m.gone[1] + m.fixed - fixed];
  m.text = text;
  m.fixed = fixed;
  m.dropped += k;
  return k;
}
// A pane's key for a row, part or turn after trim(s) let go of k turns of session si: the
// turn's "si:n" in it (a turn's key, or the first two numbers after a part's prefix, as
// "md:0:12:3") moves down by k, a key of a turn that went is null, and any other key (another
// session's, a day band's, the hidden-rows note's, the session's own notes) stays as it is.
// A key whose prefix is followed by a session index and a number that is not a turn's (a day,
// a count of rows) would be read as a turn's and moved: its prefix goes here.
const NOT_A_TURN = /^(day|hid|pday|pins|tail|empty|div|sess):/;
export function shiftKey(key, si, k) {
  if (typeof key !== "string" || NOT_A_TURN.test(key)) return key;
  const m = /(^|:)(\d+):(\d+)(?=:|$)/.exec(key);
  if (!m || Number(m[2]) !== si) return key;
  const n = Number(m[3]) - k;
  if (n < 1) return null;
  return `${key.slice(0, m.index)}${m[1]}${si}:${n}${key.slice(m.index + m[0].length)}`;
}
// { shown, of } for a session trim() cut, else null; and the line the list shows over it.
export function tailOf(s) {
  const d = META.get(s)?.dropped ?? 0;
  return d ? { shown: s.turns.length, of: d + s.turns.length } : null;
}
// How many of the session's oldest turns trim() let go: a turn numbered n in the tail is turn
// n + droppedOf(s) of the whole session.
export const droppedOf = (s) => META.get(s)?.dropped ?? 0;
// The fingerprint counts of the turns trim() let go (core/ids.js carryIds), or null.
export const idsBefore = (s) => META.get(s)?.ids ?? null;
export const tailNote = (t) => `This session is too large to show in full: showing the newest ${t.shown.toLocaleString()} of ${t.of.toLocaleString()} turns`;

// Empties a session in place: a pane that closed or was replaced gives its turns back now, even
// if something still reaches the session (an object in a cycle waits for a collection, and the
// collector may not run before the VM is full; see BUDGET). Turns hold no turn and no pane, so
// once out of their array nothing keeps them. A few steps a session, whatever its size: this runs
// as a new module is evaluated, inside the reload's time.
export function gut(s) {
  if (Array.isArray(s.turns)) s.turns.length = 0;
  for (const k of ["calls", "agents", "agentIds"]) s[k]?.clear?.();
  for (const k of Object.keys(s)) delete s[k];
}

// ---- the window registry ---------------------------------------------------------------------

// One per VM, so one per window. v is the layout's version: a later build that changes it must
// still read this one (a reload puts the new code beside the old in the same VM).
const KEY = "__agentThreadsWindow";
// This evaluation of the module: a hot reload makes a new one.
const GEN = {};
export function windowState() {
  let w = globalThis[KEY];
  if (w?.v !== 1) globalThis[KEY] = w = { v: 1, panes: new Set(), files: new Map(), lock: null, queue: [] };
  return w;
}
const deref = (e) => (typeof e.ref?.deref === "function" ? e.ref.deref() : e.ref);

// born: the order panes joined in; a copy a reload replaced joined before its replacement.
export function joinWindow(pane, kind) {
  const w = windowState();
  w.born = (w.born ?? 0) + 1;
  const e = { gen: GEN, ref: typeof WeakRef === "function" ? new WeakRef(pane) : pane, kind, bytes: 0, pane: null, beat: Date.now(), born: w.born };
  w.panes.add(e);
  return e;
}
// A pane that leaves lets go of the sessions it held: the last holder of one empties it.
export function leaveWindow(e) {
  const w = windowState();
  w.panes.delete(e);
  dropRead(e);
  for (const r of [...(w.shared?.values() ?? [])]) if (r.holders.has(e)) letSession(e, r.s);
}
// The window's estimate: each shared session once, at BASE plus its holders' views, and the
// bytes of any entry that holds none (a test's stand-in). except: a pane, whose sessions (with
// every other pane's view of them) are left out.
export function windowBytes(except = null) {
  let n = 0;
  const w = windowState();
  for (const e of w.panes) if (e !== except && !e.shares) n += e.bytes;
  for (const r of w.shared?.values() ?? []) if (!(except && r.holders.has(except)) && liveHolders(r).length) n += sessionBytes(r.s, weightOf(r));
  return n;
}
// On each pane's 1 s timer: a pane collected with no close() (a WeakRef that comes back empty)
// leaves the registry, so its last estimate does not count against the budget for good.
export function pruneWindow() {
  let n = 0;
  for (const e of [...windowState().panes]) {
    if (e.ref && typeof e.ref.deref === "function" && e.ref.deref() === undefined) { leaveWindow(e); n++; }
  }
  return n;
}
// A copy that threw while emptying itself: counted, with its message, for the debug report.
function failed(err) {
  const w = windowState();
  w.releaseErrors = (w.releaseErrors ?? 0) + 1;
  w.releaseError = String(err?.message ?? err);
}
// The largest whole-session estimate any pane has made for a transcript, as [text, fixed], for a
// side pane to judge before it reads (fileBytes, at its own weight). A session read to its end
// is the file as it is now: its estimate stands, smaller or not (a transcript replaced by a
// shorter one at the same path). Retry lets the estimate go (forgetFile) and reads to see.
export function noteFile(s) {
  const m = META.get(s);
  if (!m || !s.file) return;
  const f = windowState().files;
  const was = f.get(s.file);
  const now = [m.text + m.gone[0], m.fixed + m.gone[1]];
  if (!was || s.loaded || now[1] > was[1]) { f.delete(s.file); f.set(s.file, now); }
  if (f.size > 64) f.delete(f.keys().next().value);
}
export function forgetFile(file) { windowState().files.delete(file); }
export function fileBytes(file, w) {
  const b = windowState().files.get(file);
  return b ? weigh(b[0], b[1], w) : 0;
}

// Releases the panes of an older evaluation of the module, as main.js is evaluated. Herdr
// reloads every copy of a mod in one pass when its files change, evaluating the new module
// first (gpui-kit watch.rs reload); it then cancels each old copy's tasks, drops its entities
// and its view, but a copy's objects come back only once nothing reaches them, and whatever sits
// in a cycle waits for a collection that may not come before the VM is full (see BUDGET).
// Emptied in place now, their sessions come back at once whatever still reaches them.
export function releaseOlder() {
  const w = windowState();
  let n = 0;
  for (const e of [...w.panes]) {
    if (e.gen === GEN) continue;
    w.panes.delete(e);
    n++;
    try { deref(e)?.forget?.(); } catch (err) { failed(err); }
  }
  if (w.lock && w.lock.e.gen !== GEN) w.lock = null;
  w.queue = w.queue.filter((q) => q.e.gen === GEN);
  return n;
}
// A copy in the same Herdr pane whose timer has not beaten for GHOST_MS: one a reload of the
// same code replaced (no new module, so releaseOlder does not see it). Herdr cancels a replaced
// copy's timers, while a live copy's 1 s timer beats; two live copies never share a pane. A
// replaced copy joined before its replacement, so only an older one is swept: a newer copy
// whose timer is held up is never emptied by an older one.
export const GHOST_MS = 10000;
export function sweepGhosts(e, now = Date.now()) {
  if (!e.pane) return 0;
  let n = 0;
  for (const o of [...windowState().panes]) {
    if (o === e || o.pane !== e.pane || (o.born ?? 0) >= (e.born ?? 0) || now - o.beat <= GHOST_MS) continue;
    leaveWindow(o);
    n++;
    try { deref(o)?.forget?.(); } catch (err) { failed(err); }
  }
  return n;
}

// ---- one read at a time -------------------------------------------------------------------------

// A read holds the window's turn while it runs the extractor and applies the chunk; others wait
// in order. A turn not renewed for LOCK_STALE (past the extractor's own 30 s stall) is taken as
// dead, and a waiter that stopped asking for QUEUE_STALE leaves the line. A turn whose extractor
// is still running (holdRead with inCall) is never taken for dead, as after a computer's sleep: the
// reading pane's own watch (main.js watchRead, EXEC_STALL) lets it go if the call never ends,
// and a pane that leaves the window lets it go too (leaveWindow).
export const LOCK_STALE = 35000;
export const QUEUE_STALE = 2000;
export function takeRead(e, gen, now = Date.now()) {
  const w = windowState();
  // A pane of a registry that was replaced (another layout's, a test's) is not held up.
  if (!w.panes.has(e)) return true;
  if (w.lock?.e === e) { w.lock = { e, gen, at: now }; return true; }
  if (w.lock && !w.lock.inCall && now - w.lock.at > LOCK_STALE) w.lock = null;
  let q = w.queue.find((x) => x.e === e);
  if (q) q.at = now;
  else w.queue.push((q = { e, at: now }));
  w.queue = w.queue.filter((x) => now - x.at <= QUEUE_STALE && w.panes.has(x.e));
  if (w.lock || w.queue[0] !== q) return false;
  w.queue.shift();
  w.lock = { e, gen, at: now };
  return true;
}
// A read still at work (its heartbeat) keeps its turn fresh, so a long extractor call and the
// apply and measure after it are not taken for a dead turn (LOCK_STALE).
// inCall: whether its extractor call is in flight now (left as it was when not given).
export function holdRead(e, gen, now = Date.now(), inCall) {
  const w = windowState();
  if (w.lock?.e !== e || w.lock.gen !== gen) return;
  w.lock.at = now;
  if (inCall != null) w.lock.inCall = inCall;
}
// gen: only that read's turn (null: whatever the pane holds or waits for).
export function dropRead(e, gen = null) {
  const w = windowState();
  if (w.lock?.e === e && (gen == null || w.lock.gen === gen)) w.lock = null;
  if (gen == null) w.queue = w.queue.filter((x) => x.e !== e);
}

// ---- one copy of a session per window ---------------------------------------------------------

// The panes of a window that show one transcript share one session object: one pane reads it
// (claimRead), the others follow its turns and keep only their own view of them (rows, keys,
// scroll). The weights split in two: what the session itself holds, counted once however many
// panes show it (BASE_WEIGHT, about a Pinned pane's, whose own rows are few), and what each pane
// builds on it (VIEW_WEIGHT). One pane on a session weighs what it did: BASE + VIEW = PANE_WEIGHT.
export const BASE_WEIGHT = 4;
export const VIEW_WEIGHT = Object.freeze(Object.fromEntries(Object.entries(PANE_WEIGHT).map(([k, w]) => [k, +(w - BASE_WEIGHT).toFixed(2)])));
// Each shared session's record: { key, s, holders: Set of registry entries, reader: { e, gen } }.
const SHARE = new WeakMap();
function records() {
  const w = windowState();
  if (!w.shared) w.shared = new Map();
  return w.shared;
}
// The holders still in the registry (one a test or a replaced registry dropped is not).
const liveHolders = (r) => { const p = windowState().panes; return [...r.holders].filter((h) => p.has(h)); };
const weightOf = (r) => BASE_WEIGHT + liveHolders(r).reduce((n, h) => n + (VIEW_WEIGHT[h.kind] ?? VIEW_WEIGHT.chat), 0);
// The session for (id, file) in the window: the one another pane holds, or make()'s, now held by
// entry e too. With no entry (a pane outside the registry), make()'s, unshared.
export function holdSession(e, id, file, make) {
  if (!e) return make();
  const m = records();
  const key = `${id}\n${file}`;
  let r = m.get(key);
  if (r) for (const h of [...r.holders]) if (!windowState().panes.has(h)) r.holders.delete(h);
  if (!r?.holders.size) {
    r = { key, s: make(), holders: new Set(), reader: null };
    m.set(key, r);
    SHARE.set(r.s, r);
  }
  r.holders.add(e);
  e.shares = true;
  return r.s;
}
// Entry e lets go of s; the last holder empties it (gut), unless empty is false (a pane that
// moves to another transcript: what it was showing is left to the collector, as before). True
// when it was emptied.
export function letSession(e, s, empty = true) {
  const r = SHARE.get(s);
  if (!r) { if (empty) gut(s); return empty; }
  r.holders.delete(e);
  if (r.reader?.e === e) r.reader = null;
  // A holder no longer in the registry (released, or collected before a prune) holds nothing.
  for (const h of [...r.holders]) if (!windowState().panes.has(h)) r.holders.delete(h);
  if (r.holders.size) return false;
  if (records().get(r.key) === r) records().delete(r.key);
  SHARE.delete(s);
  if (empty) gut(s);
  return empty;
}
// Whether a pane other than entry e still holds s.
export const heldElsewhere = (s, e = null) => { const r = SHARE.get(s); return Boolean(r) && liveHolders(r).some((h) => h !== e); };
// Whether s is the window's (held through holdSession), not a pane's own.
export const isShared = (s) => SHARE.has(s);
// The panes that hold s (live, not emptied), or none for a session not shared.
export function sharers(s) {
  const r = SHARE.get(s);
  if (!r) return [];
  const out = [];
  for (const h of liveHolders(r)) { const p = deref(h); if (p && !p.forgotten) out.push(p); }
  return out;
}
// Whether a Chat holds s: past the budget a Chat keeps the newest turns (trim), side panes
// alone let it go (refuse).
export const chatHolds = (s) => { const r = SHARE.get(s); return Boolean(r) && liveHolders(r).some((h) => h.kind === "chat"); };
// The weight s is counted at: BASE plus each holder's view; w for a session not shared.
export const shareWeight = (s, w) => { const r = SHARE.get(s); return r && liveHolders(r).length ? weightOf(r) : w; };
// What s holds, with every pane's view of it.
export const sharedBytes = (s, w) => sessionBytes(s, shareWeight(s, w));
// The read of s: one pane at a time. False while another pane in the registry reads it; else
// this read (gen) of entry e is its reader until releaseRead.
export function claimRead(e, s, gen, now = Date.now()) {
  const r = SHARE.get(s);
  if (!r || !e) return true;
  const cur = r.reader;
  // An older copy in the same Herdr pane whose timer stopped beating is one a reload replaced
  // (sweepGhosts): Herdr stopped its tasks, so its read is over, swept or not. One still beating
  // is a live pane (two Chats on one terminal can share a pane id) and keeps its read.
  const replaced = cur?.e.pane && cur.e.pane === e.pane && (cur.e.born ?? 0) < (e.born ?? 0) && now - (cur.e.beat ?? 0) > GHOST_MS;
  if (cur && cur.e !== e && !replaced && readerAlive(r)) return false;
  r.reader = { e, gen };
  return true;
}
export function releaseRead(e, s, gen = null) {
  const r = SHARE.get(s);
  if (r?.reader?.e === e && (gen == null || r.reader.gen === gen)) r.reader = null;
}
// The pane reading s, or null.
export const readerOf = (s) => { const r = SHARE.get(s); return r && readerAlive(r) ? deref(r.reader.e) : null; };
// A reader still in the registry, holding the session, and a pane that is there and not emptied.
function readerAlive(r) {
  const e = r.reader?.e;
  if (!e || !windowState().panes.has(e) || !r.holders.has(e)) return false;
  const p = deref(e);
  return Boolean(p) && !p.forgotten;
}
// For the debug report: how many panes hold s.
export const holdersOf = (s) => { const r = SHARE.get(s); return r ? liveHolders(r).length : 0; };
