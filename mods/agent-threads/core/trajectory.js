// agent-threads: a turn folded into the trajectory shape, from the session the reader built
// (turns.js) and nothing else: no second read of the transcript. Plain JavaScript with no
// Herdr imports. Nothing draws it yet; test/trajectory.test.js holds each agent's result as a
// golden file, so the session model can be checked against the shape before it changes.
//
// The shape: a turn, then its step groups, then cells.
// - The first group ("Message") holds the prompt as a user cell.
// - Each later group ("Step N") is one stretch of the agent's work: the text it said, then a
//   tool cell for each call it made after that text. The reply is the last group's message.
// - A tool cell names its tool and its call id. Its result is joined by that id: { call },
//   with no text, since results stay on disk and are read when shown (calls.sh).
// - A subagent call's cell carries its run: its agent id, its state, tokens and time, from
//   the launch result and the notification the reader already keeps (s.agents). Its own
//   steps live in its own transcript, so they are null here.
// - Every cell has a start and an end: a time in ms where the transcript gives one, else
//   null, never made up. The reader keeps no times on steps yet, so only the prompt's start
//   and the reply's end are known.
// - A background update after the reply is a context cell in a group of its own.
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
  const open = () => {
    step = { title: `Step ${groups.length}`, cells: [] };
    groups.push(step);
    return step;
  };
  for (const st of turn.steps ?? []) {
    if (st.k === "text") {
      open().cells.push({ kind: "message", text: st.t, ...(st.cut ? { cut: true } : {}), start: null, end: null });
      continue;
    }
    if (st.k !== "group") continue;
    // Calls with no text before them (the first step, or calls after STEP_MAX) start a step.
    if (!step || step.cells.some((c) => c.kind === "tool")) open();
    st.calls.forEach((name, i) => {
      const id = st.ids?.[i] ?? null;
      const cell = { kind: "tool", tool: name, call: id, result: id ? { call: id } : null, start: null, end: null };
      if (st.agent) {
        const a = id ? s.agents?.get(id) : null;
        cell.subagent = { agent: a ? agentId(s, a) : null, state: a?.st ?? null, tokens: a?.tok ?? null, ms: a?.ms ?? null, steps: null };
      }
      step.cells.push(cell);
    });
    // Calls past STEP_CALLS are counted, not named.
    if (st.count > st.calls.length) step.cells.push({ kind: "more", count: st.count - st.calls.length, start: null, end: null });
  }
  const text = reply(turn);
  if (text) open().cells.push({ kind: "message", text, start: null, end: at(turn.endTs) });
  if (turn.latest) groups.push({ title: "Update", cells: [{ kind: "context", text: turn.latest, start: null, end: null }] });
  return {
    id,
    n: turn.n,
    start: at(turn.ts),
    end: at(turn.endTs),
    done: Boolean(turn.done),
    ...(turn.interrupted ? { interrupted: true } : {}),
    groups,
  };
}

// Every turn of a session, each with its stable id (ids.js), the ids worked out once.
export function trajectories(s) {
  const ids = new Map([...turnIds(s.turns)].map(([id, t]) => [t, id]));
  return s.turns.map((t) => trajectory(s, t, ids.get(t) ?? null));
}
