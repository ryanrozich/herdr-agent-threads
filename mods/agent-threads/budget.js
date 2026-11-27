// agent-threads: the window's memory guard, as data (no Herdr imports), tested under bun
// (test/budget.test.js). Herdr runs every mod of a window in one QuickJS VM of 256 MiB, every
// Threads pane included, and once it is full every pane and Herdr's own mods throw together
// (Null"null"). The VM gives a mod no memory figure, so each pane estimates what its sessions
// hold (measure), the panes of a window add theirs up in one registry on globalThis (one VM is
// one window, and module scope is not enough: a hot reload evaluates the mod again beside the
// old one), and past BUDGET a session keeps only its newest turns (trim) or a side pane reads
// nothing. The same registry lets one read run at a time (takeRead) and lets a new copy of the
// mod release what the copies it replaces still hold (releaseOlder).

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
  while (k < s.turns.length - 1 && weigh(text, fixed, w) > bytes) {
    const b = SIZES.get(s.turns[k++]) ?? [0, 0];
    text -= b[0];
    fixed -= b[1];
  }
  const dropped = new Set(s.turns.splice(0, k));
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
// { shown, of } for a session trim() cut, else null; and the line the list shows over it.
export function tailOf(s) {
  const d = META.get(s)?.dropped ?? 0;
  return d ? { shown: s.turns.length, of: d + s.turns.length } : null;
}
// How many of the session's oldest turns trim() let go: a turn numbered n in the tail is turn
// n + droppedOf(s) of the whole session.
export const droppedOf = (s) => META.get(s)?.dropped ?? 0;
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
export function leaveWindow(e) {
  const w = windowState();
  w.panes.delete(e);
  dropRead(e);
}
// A pane collected with no close() (a WeakRef that comes back empty) leaves the registry here,
// so its last estimate does not count against the budget for good.
export function windowBytes(except = null) {
  const w = windowState();
  let n = 0;
  for (const e of [...w.panes]) {
    if (e.ref && typeof e.ref.deref === "function" && e.ref.deref() === undefined) { leaveWindow(e); continue; }
    if (e !== except) n += e.bytes;
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
// side pane to judge before it reads (fileBytes, at its own weight).
export function noteFile(s) {
  const m = META.get(s);
  if (!m || !s.file) return;
  const f = windowState().files;
  const was = f.get(s.file);
  const now = [m.text + m.gone[0], m.fixed + m.gone[1]];
  if (!was || now[1] > was[1]) f.set(s.file, now);
  if (f.size > 64) f.delete(f.keys().next().value);
}
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
// dead, and a waiter that stopped asking for QUEUE_STALE leaves the line.
export const LOCK_STALE = 35000;
export const QUEUE_STALE = 2000;
export function takeRead(e, gen, now = Date.now()) {
  const w = windowState();
  // A pane of a registry that was replaced (another layout's, a test's) is not held up.
  if (!w.panes.has(e)) return true;
  if (w.lock?.e === e) { w.lock = { e, gen, at: now }; return true; }
  if (w.lock && now - w.lock.at > LOCK_STALE) w.lock = null;
  let q = w.queue.find((x) => x.e === e);
  if (q) q.at = now;
  else w.queue.push((q = { e, at: now }));
  w.queue = w.queue.filter((x) => now - x.at <= QUEUE_STALE && w.panes.has(x.e));
  if (w.lock || w.queue[0] !== q) return false;
  w.queue.shift();
  w.lock = { e, gen, at: now };
  return true;
}
// gen: only that read's turn (null: whatever the pane holds or waits for).
export function dropRead(e, gen = null) {
  const w = windowState();
  if (w.lock?.e === e && (gen == null || w.lock.gen === gen)) w.lock = null;
  if (gen == null) w.queue = w.queue.filter((x) => x.e !== e);
}
