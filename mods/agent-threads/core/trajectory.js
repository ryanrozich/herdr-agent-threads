// agent-threads: a turn folded into the trajectory shape, from the session the reader built
// (turns.js) and nothing else: no second read of the transcript. Plain JavaScript with no
// Herdr imports. Nothing draws it yet; test/trajectory.test.js holds each agent's result as a
// golden file, so the session model can be checked against the shape before it changes.
//
// The shape: a turn, then its step groups, then cells.
// - The first group ("Message") holds the prompt as a user cell.
// - Each later group ("Step N") is one stretch of the agent's work: the text it said, then a
//   tool cell for each call it made after that text. The reply is the last group's message.
// - A tool cell names its tool, its call id and its input in up to 120 characters. Its result
//   is joined by that id: { call, end, failed }, with no text, since results stay on disk and
//   are read when shown (calls.sh). failed is null when the result does not say.
// - A subagent call's cell carries its run: its agent id, its state, tokens and time, from
//   the launch result and the notification the reader already keeps (s.agents). Its own
//   steps live in its own transcript, so they are null here.
// - Every cell has a start and an end: a time in ms where the transcript gives one, else
//   null, never made up. A text starts when its first line was written; a call starts when
//   it was made and ends when its result was written.
// - A background update after the reply is a context cell in a group of its own. With the
//   reader's keepWakes (the ATIF export only), each wake-up's texts and calls are "Update"
//   groups of their own, then its last text.
// - A turn carries its stable id (ids.js) when the caller gives it; trajectories(s) does.

import { reply } from "./turns.js";
import { turnIds } from "./ids.js";

const at = (ms) => (Number.isFinite(ms) ? ms : null);

// The reader keeps each subagent's record under its call's id (s.agents) and under its own
// agent id (s.agentIds), and the record holds only the call's id: the agent id is the key.
const AGENT_OF = new WeakMap();
function agentId(s, a) {
  let m = AGENT_OF.get(s.agentIds);
  if (!m) { m = new Map([...(s.agentIds ?? new Map())].map(([k, v]) => [v, k])); if (s.agentIds) AGENT_OF.set(s.agentIds, m); }
  return m.get(a) ?? null;
}

export function trajectory(s, turn, id = null) {
  const groups = [{ title: "Message", cells: [{ kind: "user", text: turn.prompt, start: at(turn.ts), end: null }] }];
  let step = null;
  let title = null;
  const open = () => {
    step = { title: title ?? `Step ${groups.length}`, cells: [] };
    groups.push(step);
    return step;
  };
  const addSteps = (list) => {
  for (const st of list ?? []) {
    if (st.k === "text") {
      open().cells.push({ kind: "message", text: st.t, ...(st.r ? { reason: st.r } : {}), ...(st.cut ? { cut: true } : {}), start: at(st.at), end: null });
      if (st.h) step.held = st.h;
      continue;
    }
    if (st.k !== "group") continue;
    // Calls with no text before them (the first step, or calls after STEP_MAX) start a step.
    if (!step || step.cells.some((c) => c.kind === "tool")) open();
    // Reasoning withheld (the ATIF export only): counted on the step, its text never kept.
    if (st.h) step.held = (step.held ?? 0) + st.h;
    // A group's reasoning joins the step's message cell when it has one (a call that follows a
    // text step), so it is not lost in a second cell nothing reads.
    if (st.r) {
      const m = step.cells.find((c) => c.kind === "message");
      if (m) m.reason = m.reason ? `${m.reason}\n\n${st.r}` : st.r;
      else step.cells.push({ kind: "message", text: "", reason: st.r, start: null, end: null });
    }
    st.calls.forEach((name, i) => {
      const id = st.ids?.[i] ?? null;
      const info = st.info?.[i] ?? null;
      const end = at(info?.rt);
      const cell = { kind: "tool", tool: name, call: id, input: info?.in ?? null,
        result: id ? { call: id, end, failed: info?.f ?? null } : null, start: at(info?.at), end };
      if (st.agent) {
        const a = id ? s.agents?.get(id) : null;
        cell.subagent = { agent: a ? agentId(s, a) : null, state: a?.st ?? null, tokens: a?.tok ?? null, ms: a?.ms ?? null, steps: null };
      }
      step.cells.push(cell);
    });
    // Calls past STEP_CALLS are counted, not named.
    if (st.count > st.calls.length) step.cells.push({ kind: "more", count: st.count - st.calls.length, start: null, end: null });
  }
  };
  addSteps(turn.steps);
  const text = reply(turn);
  if (text || turn.reasoning?.length) open().cells.push({ kind: "message", text, ...(turn.reasoning?.length ? { reason: turn.reasoning.join("\n\n") } : {}), start: at(turn.afterAt), end: at(turn.endTs) });
  // Withheld reasoning after the turn's last step is counted on that step. With no step to
  // carry it, no step is made for it: the trajectory counts it (heldOut) for the notes.
  let heldOut = 0;
  const holdOn = (n) => { if (!n) return; if (step) step.held = (step.held ?? 0) + n; else heldOut += n; };
  holdOn(turn.held);
  if (turn.wakes) {
    // The ATIF export's reader (keepWakes): each wake-up's steps, then its last text.
    title = "Update";
    for (const w of turn.wakes) {
      step = null;
      addSteps(w.steps);
      const last = w.after.join("\n\n").trim();
      const reason = w.reasoning?.length ? w.reasoning.join("\n\n") : "";
      if (last || reason) groups.push({ title, cells: [{ kind: "context", text: last, ...(reason ? { reason } : {}), start: at(w.afterAt), end: null }], ...(w.held ? { held: w.held } : {}) });
      else holdOn(w.held);
    }
  } else if (turn.latest) groups.push({ title: "Update", cells: [{ kind: "context", text: turn.latest, start: null, end: null }] });
  return {
    id,
    n: turn.n,
    start: at(turn.ts),
    end: at(turn.endTs),
    done: Boolean(turn.done),
    ...(turn.interrupted ? { interrupted: true } : {}),
    ...(heldOut ? { heldOut } : {}),
    groups,
  };
}

// Every turn of a session, each with its stable id (ids.js), the ids worked out once.
export function trajectories(s) {
  const ids = new Map([...turnIds(s.turns)].map(([id, t]) => [t, id]));
  return s.turns.map((t) => trajectory(s, t, ids.get(t) ?? null));
}
