// agent-threads: the agents the pane can read, as pure functions (no Herdr imports), so the
// tests run them under bun. Claude Code and Codex append to a JSONL file. OpenCode keeps every
// session in one SQLite database, so its "file" is "<database>#<session id>".

export const HARNESS = {
  claude: { key: "claude", name: "Claude Code", short: "Claude", cmd: "claude" },
  codex: { key: "codex", name: "Codex", short: "Codex", cmd: "codex" },
  opencode: { key: "opencode", name: "OpenCode", short: "OpenCode", cmd: "opencode" },
};

const base = (p) => (p ?? "").split("/").pop().replace(/^-/, "");
const WRAPPERS = new Set(["node", "bun", "deno"]);

// Which agent a terminal's foreground program is, or null. A package manager's launcher runs
// under node, so the script it runs counts too. A process named for a version ("2.1.316") is
// how Claude Code's native build shows up.
export function harnessOf(fg, pane) {
  const argv = fg?.argv ?? [];
  const cmd = base(argv[0] ?? fg?.name);
  const name = base(fg?.name);
  const script = WRAPPERS.has(cmd) ? base(argv[1]).replace(/\.[cm]?js$/, "") : null;
  for (const key of ["codex", "opencode"]) {
    if (cmd === key || name === key || script === key || pane?.app === key) return key;
  }
  if (cmd === "claude" || script === "claude" || /^\d+\.\d+\.\d+/.test(fg?.name ?? "") || pane?.app === "claude-code") return "claude";
  return null;
}

export function harnessOfFile(file) {
  const f = file ?? "";
  if (f.includes(".db#")) return "opencode";
  return /\/rollout-[^/]*\.jsonl$/.test(f) ? "codex" : "claude";
}

// A session's id from its file: a Claude Code file is named for it, a Codex file ends with it
// (rollout-<time>-<id>.jsonl), and an OpenCode "file" carries it after the "#".
export function idOfFile(file) {
  const f = file ?? "";
  if (f.includes(".db#")) return f.slice(f.lastIndexOf("#") + 1);
  const name = f.split("/").pop().replace(/\.jsonl$/, "");
  const m = /^rollout-.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(name);
  return m ? m[1] : name;
}

// The database of an OpenCode "file".
export function dbOfFile(file) {
  const f = file ?? "";
  const i = f.lastIndexOf("#");
  return i < 0 ? f : f.slice(0, i);
}

// Whether a folder watch's changed paths touch this session's file. OpenCode writes to the
// database's -wal file next to it.
export function fileChanged(file, changed) {
  if (!file) return false;
  if (harnessOfFile(file) !== "opencode") return changed.includes(file);
  const db = dbOfFile(file);
  return changed.some((p) => p === db || p === `${db}-wal`);
}

const CODEX_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The id in `codex resume <id>`. `codex fork` writes a new session, so its id says nothing
// about which file this process writes.
export function codexArgvSession(argv) {
  const args = argv ?? [];
  const at = args.indexOf("resume");
  if (at < 0) return null;
  return args.slice(at + 1).find((a) => CODEX_ID.test(a)) ?? null;
}

// The session named on an OpenCode command line: { id, cont }. --fork writes a new session
// from the named one, so the id is dropped. cont is --continue, the folder's newest session.
export function opencodeArgv(argv) {
  const args = argv ?? [];
  const fork = args.includes("--fork");
  let id = null;
  let cont = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-s" || a === "--session") id = args[i + 1] ?? null;
    else if (a.startsWith("--session=")) id = a.slice(10);
    else if (a === "-c" || a === "--continue") cont = true;
  }
  return { id: !fork && /^ses_[0-9A-Za-z]+$/.test(id ?? "") ? id : null, cont };
}

// "1-02:03:04", "02:03:04" or "03:04" (ps -o etime=) in milliseconds, or null.
export function etimeMs(text) {
  const m = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/.exec(text ?? "");
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 3600 + Number(m[3]) * 60 + Number(m[4])) * 1000;
}

// OpenCode records no process for a session, so a terminal's session comes from its folder:
// sessions updated since this process started are the ones it could be writing.
//   list: the folder's root sessions, newest update first, { id, created, updated }.
//   startMs: when the process started, or null. peers: other OpenCode processes in the folder.
//   argv: opencodeArgv(). cur: the id the pane shows now, or null.
// Returns { id, guess, via, choices }, with id null when no session belongs to it yet (a fresh
// process writes nothing until the first prompt). With a peer the match is only a guess.
export function pickOpenCode(list, startMs, peers, argv, cur, termTitle) {
  const named = openCodeTitleMatch(list, termTitle);
  if (named) return { id: named.id, guess: false, via: "title", choices: [] };
  if (argv?.id) return { id: argv.id, guess: false, via: "argv", choices: [] };
  const live = startMs == null ? list.slice(0, 1) : list.filter((x) => x.updated >= startMs - 2000);
  if (!live.length) {
    if (argv?.cont && list.length) return { id: list[0].id, guess: true, via: "cwd", choices: list.slice(0, 5) };
    return { id: null, guess: false, via: null, choices: list.slice(0, 5) };
  }
  if (peers > 0) {
    // Two terminals could own any of these: stay on the one shown while it stays live.
    const stay = live.find((x) => x.id === cur);
    return { id: (stay ?? live[0]).id, guess: true, via: "cwd", choices: live.slice(0, 5) };
  }
  // Alone in the folder: its newest session, which is the one /new just made.
  const newest = live.reduce((a, b) => (b.created > a.created ? b : a));
  return { id: newest.id, guess: false, via: "folder", choices: [] };
}

// OpenCode titles its terminal "OC | <session title>", cut to "<start>…" when long, and plain
// "OpenCode" until the session has a title. The one session in the folder that title fits, or
// null when none or several do.
export function openCodeTitleMatch(list, termTitle) {
  const m = /^OC \| (.+)$/.exec(String(termTitle ?? ""));
  if (!m) return null;
  const start = m[1].replace(/(…|\.\.\.)$/, "");
  const cut = start !== m[1];
  const fits = list.filter((x) => (cut ? String(x.title ?? "").startsWith(start) : x.title === start));
  return fits.length === 1 ? fits[0] : null;
}

// A picker row's name: the session's title, or its first prompt while it has only the default title.
export function openCodeLabel(x) {
  const title = String(x.title ?? "");
  const text = /^New session\b/.test(title) ? String(x.first ?? "") : title;
  return text.replace(/\s+/g, " ").trim() || title || null;
}

// What a quote pastes as. OpenCode trims a paste it folds into a "[Pasted ~N lines]" chip (three
// lines or more, or over 150 characters), which takes off the blank line that keeps the person's
// reply out of the quote. It leaves a zero-width space on the last line, so that line stays.
export function quotePaste(key, text) {
  if (key !== "opencode") return text;
  const body = text.trim();
  const folds = (body.match(/\n/g)?.length ?? 0) + 1 >= 3 || body.length > 150;
  return folds ? `${text}\u200b` : text;
}
