// agent-threads: which transcript a terminal's Claude session writes, as pure functions
// (no Herdr imports), so the tests run them under bun.

import { fmtTime } from "./turns.js";

export const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const validId = (id) => typeof id === "string" && ID_RE.test(id);

// Where Claude Code keeps its files. claudeHome is ~/.claude unless a test pane sets it.
export function claudePaths(home, claudeHome) {
  const root = claudeHome || `${home}/.claude`;
  return {
    root,
    projects: `${root}/projects`,
    sessions: `${root}/sessions`,
    record: (pid) => `${root}/sessions/${pid}.json`,
    project: (cwd) => `${root}/projects/${slug(cwd)}`,
    transcript: (cwd, id) => `${root}/projects/${slug(cwd)}/${id}.jsonl`,
  };
}

// Claude Code's project folder name for a working directory: every character other than a
// letter or digit becomes "-" (so "/Users/a/.config/x_y" is "-Users-a--config-x-y").
export function slug(cwd) {
  return (cwd ?? "").replace(/[^a-zA-Z0-9]/g, "-");
}

// The session id named on the command line. `--fork-session` writes a new id, so the one
// named is the parent's and does not say which file this process writes.
export function argvSession(argv) {
  const args = argv ?? [];
  if (args.includes("--fork-session")) return null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (["--resume", "-r", "--session-id"].includes(a) && validId(args[i + 1])) return args[i + 1];
    const m = a.match(/^--(?:resume|session-id)=(.+)$/);
    if (m && validId(m[1])) return m[1];
  }
  return null;
}

// The session id in a ~/.claude/sessions/<pid>.json record, or null.
export function recordSession(text) {
  try {
    const id = JSON.parse(text ?? "")?.sessionId;
    return validId(id) ? id : null;
  } catch {
    return null;
  }
}

// What to do with a lookup result, given the session the pane shows now.
//   r: { id, file } (file null when the id's transcript is not on disk yet), or null.
//   cur: { id, file, guess } or null.
// "same": keep reading cur. "new": a new session (after /clear, /resume or a restart).
// "pending": the id changed but its file is not written yet; keep cur and look again.
// "keep": a guess never replaces a session we were told about. "none": nothing found.
export function decide(r, cur) {
  if (!r?.id) return "none";
  if (cur && (r.file ? r.file === cur.file : r.id === cur.id)) return "same";
  if (!r.file) return "pending";
  if (cur && r.guess && !cur.guess) return "keep";
  return "new";
}

// The divider above a session that followed another in the same pane.
export function dividerLabel(s) {
  if (s.clearAt) return `New session · /clear at ${fmtTime(s.clearAt)}`;
  return s.startedAt ? `New session · ${fmtTime(s.startedAt)}` : "New session";
}

// Candidates for a guess: transcripts in the folder, newest first, minus the ones another
// live Claude process is writing (held: session ids from the other live records).
export function candidates(files, held, max = 5) {
  const out = [];
  for (const f of files) {
    const id = (f.path ?? f).split("/").pop().replace(/\.jsonl$/, "");
    if (held.has(id)) continue;
    out.push(f);
    if (out.length >= max) break;
  }
  return out;
}
