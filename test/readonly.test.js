// bun test: Threads is read-only toward agents, with one exception (RECIPE.md, How it behaves):
// quoteToTerminal() in main.js pastes a quote into the bound terminal with Herdr's
// terminal.paste (a bracketed paste) and never presses Enter or sends anything. The scan
// fails on any other terminal.* command, a second paste call site, a submit inside that
// function, hc asked for anything but `get`, git run for anything but `remote get-url`,
// a quote case in action() (which would make it a mod command), a quote command in
// RECIPE.md, or a write under the Claude home.
import { test, expect } from "bun:test";
import { readFileSync, readdirSync, mkdtempSync, cpSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The only file-changing lines image.sh may have: its temp files, the cache file it writes,
// and the trim of that cache.
const IMAGE_SH_WRITES = [
  /^trap 'rm -f "\$line" "\$tmp"' EXIT INT TERM$/,
  /^LC_ALL=C grep -m 1 -F "\\"uuid\\":\\"\$uuid\\"" "\$file" > "\$line" \|\| \{ echo "no line" >&2; exit 4; \}$/,
  /^LC_ALL=C grep -m 1 -E "\^\\\{\\"timestamp\\":\\"\[\^\\"\]\*\\",\\"ordinal\\":\$\(\(ord - back\)\)," "\$file" > "\$line" \|\| :$/,
  /^sqlite3 -readonly -batch -noheader "\$file" "select data from part where .*" > "\$line" \|\| \{ echo "no line" >&2; exit 4; \}$/,
  /^sqlite3 -readonly -batch -noheader "\$file" "select f\.value from session_message m, json_each\(m\.data,'\\\$\.files'\) f where .*" > "\$line" \|\| \{ echo "no line" >&2; exit 4; \}$/,
  /^LC_ALL=C grep -m 1 -F "\\"uuid\\":\\"\$uuid\\"" "\$file" > "\$line" \|\| \{ echo "no line" >&2; exit 4; \} ;;$/,
  /^LC_ALL=C grep -m 1 -F "\\"id\\":\\"\$uuid\\"" "\$file" > "\$line" \|\| \{ echo "no line" >&2; exit 4; \} ;;$/,
  /^touch "\$dir\/\$name"$/,
  // A Pi paste's temp image, copied into the cache only after its first bytes say image.
  /^if cp "\$p" "\$tmp" && mv "\$tmp" "\$dir\/\$name"; then tmp=\$\(mktemp "\$\{TMPDIR:-\/tmp\}\/agent-threads-img\.XXXXXX"\); else k=\$\(\(k \+ 1\)\); continue; fi$/,
  /^\| base64 --decode > "\$tmp" 2> \/dev\/null \|\| : > "\$tmp"$/,
  /^if \[ -s "\$tmp" \]; then mv "\$tmp" "\$dir\/\$name"; tmp=\$\(mktemp "\$\{TMPDIR:-\/tmp\}\/agent-threads-img\.XXXXXX"\); else i=\$\(\(i \+ 1\)\); continue; fi$/,
  /^echo "\$old" \| while IFS= read -r f; do rm -f "\$f"; done$/,
];

const root = join(import.meta.dir, "..");
const mod = join(root, "mods/agent-threads");

// [first, last] line index of a method `  name(…) {` … `  }` in a class body, or null.
function methodRange(lines, name) {
  const start = lines.findIndex((l) => new RegExp(`^  ${name}\\(.*\\) \\{$`).test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l === "  }");
  return end < 0 ? null : [start, end];
}

function violations(modDir, installSh, recipe = join(root, "RECIPE.md")) {
  const out = [];
  // The one paste: in main.js, inside quoteToTerminal(), exactly once, and nothing there
  // that could submit or type.
  const mainLines = readFileSync(join(modDir, "main.js"), "utf8").split("\n");
  const qt = methodRange(mainLines, "quoteToTerminal");
  if (!qt) out.push("main.js quoteToTerminal() not found");
  const inQuote = (name, i) => name === "main.js" && qt && i > qt[0] && i < qt[1];
  let pastes = 0;
  if (qt) {
    for (let i = qt[0]; i <= qt[1]; i++) {
      const l = mainLines[i].replace(/^\s*\/\/.*$/, "");
      if (/\b(send|keys|enter|submit|type)\b/i.test(l) || /\\r|\\x0d|\\u000d|\\n/i.test(l) || /\bhc\(/.test(l)) out.push(`main.js:${i + 1} quoteToTerminal() must only paste: ${l.trim()}`);
    }
  }
  // action() is reachable as a mod command ("agent-threads.<name>"): no quote there, except
  // the debug-only debugQuote behind props.debug.
  const act = methodRange(mainLines, "action");
  if (act) for (let i = act[0]; i <= act[1]; i++) {
    const l = mainLines[i];
    if (/case\s+["'`]quote["'`]|===\s*["'`]quote["'`]|["'`]quote["'`]\s*===/.test(l)) out.push(`main.js:${i + 1} action() has a quote case`);
    if (/debugQuote/.test(l) && !/this\.debug\s*&&\s*name\s*===\s*"debugQuote"/.test(l)) out.push(`main.js:${i + 1} debugQuote without the debug guard`);
  }
  // RECIPE's command list names no quote command.
  if (existsSync(recipe) && /agent-threads\.(quote|debugQuote)\b/.test(readFileSync(recipe, "utf8").replace(/`agent-threads\.debugQuote`[^\n]*debug/g, ""))) out.push("RECIPE.md names a quote command");
  const files = readdirSync(modDir).filter((f) => /\.(js|sh|jq)$/.test(f)).map((f) => join(modDir, f));
  files.push(installSh);
  for (const file of files) {
    const name = file.split("/").pop();
    const lines = readFileSync(file, "utf8").split("\n");
    let inImport = false;
    lines.forEach((raw, i) => {
      const line = raw.replace(/^\s*(\/\/|#).*$/, "");
      const at = `${name}:${i + 1}`;
      for (const m of line.matchAll(/["'`](terminal\.[a-z_]+)["'`]/g)) {
        if (m[1] === "terminal.paste" && inQuote(name, i)) pastes++;
        else out.push(`${at} terminal command ${m[1]}`);
      }
      if (/\b(send_keys|sendKeys|send_text|type_text)\b/.test(line)) out.push(`${at} typing call`);
      for (const m of line.matchAll(/\bhc\(\s*\[\s*["'`]([a-z_-]+)["'`]/g)) if (m[1] !== "get") out.push(`${at} hc ${m[1]}`);
      if (/exec\(\s*["'`](hc|herdr-app|osascript|tmux)["'`]/.test(line)) out.push(`${at} exec of a controller`);
      for (const m of line.matchAll(/(?<![\w.$])exec\(\s*["'`]([^"'`]+)["'`]/g)) {
        if (m[1] === "git") { if (!/exec\("git", \["-C", cwd, "remote", "get-url", "origin"\]\)/.test(line)) out.push(`${at} git other than remote get-url`); }
        // open only for the README link on an unread agent's page (harness.js UNREAD).
        else if (m[1] === "open") { if (!/exec\("open", \[u\.url\]\)/.test(line)) out.push(`${at} open other than the README link`); }
        else if (m[1] !== "sh") out.push(`${at} exec of ${m[1]}`);
      }
      if (/\bhc\s+(send|type|run|kill|label|write|paste|keys)\b/.test(line)) out.push(`${at} hc write verb in a shell`);
      if (/\b(writeFile|appendFile|mkdir|rmSync|unlink|fs\/promises)\b/.test(line) && !name.endsWith(".sh")) out.push(`${at} file write`);
      // writeTextFile only in settings.js, and only to the settings file and pins.json.
      if (/\bwriteTextFile\b/.test(line) && !name.endsWith(".sh")) {
        const allowed = name === "settings.js" && (/^import \{ writeTextFile \} from "herdr";$/.test(line.trim()) || /^return writeTextFile\((settingsPath|pinsPath)\(appHome\), /.test(line.trim()));

        if (!allowed) out.push(`${at} file write`);
      }
      // layout.resize sizes the Pinned pane that v splits off; it touches no terminal.
      if (name.endsWith(".js") && /run\(\s*["'`](?!(pane\.(split|focus|close)|layout\.resize)["'`])[^"'`]+["'`]/.test(line)
        && !(inQuote(name, i) && /run\("terminal\.paste"\);/.test(line))) out.push(`${at} command other than pane.split/focus/close or layout.resize`);
      // Calls the literal checks above cannot read: a command name, hc argument list or
      // exec program held in a variable, or run/hc/exec passed around as a value.
      if (name.endsWith(".js") && /^\s*import\b/.test(line) && !/\bfrom\b/.test(line)) inImport = true;
      const importing = inImport || /^\s*import\b/.test(line);
      if (inImport && /\bfrom\s+["']/.test(line)) inImport = false;
      if (name.endsWith(".js") && !importing) {
        if (/(?<![\w.$])run\(\s*(?!["'`])/.test(line)) out.push(`${at} run with a computed command`);
        if (/(?<![\w.$])hc\(\s*(?!\[\s*["'`])/.test(line)) out.push(`${at} hc with computed arguments`);
        if (/(?<![\w.$])exec\(\s*(?!["'`])/.test(line)) out.push(`${at} exec of a computed program`);
        if (/(?<![\w.$"'`</?])(run|hc|exec)\b(?!\s*\()(?!["'`:])/.test(line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""'))) out.push(`${at} run/hc/exec used as a value`);
      }
      // image.sh writes the pasted-image cache: these exact lines and no others. Its root
      // comes from main.js (appHome/data/agent-threads/images), never the Claude home.
      const imageCache = name === "image.sh" && IMAGE_SH_WRITES.some((re) => re.test(line.trim()));
      if (name.endsWith(".sh") && !imageCache) {
        for (const m of line.matchAll(/(?<![0-9&<])>>?\s*("?[^\s;|&)]+"?)/g)) {
          const target = m[1].replace(/"/g, "");
          if (!["$tmp", "$out", "/dev/null", "&2", "&1"].includes(target)) out.push(`${at} writes ${target}`);
        }
        if (/\.claude/.test(line) && name !== "install.sh") out.push(`${at} names the Claude home`);
        if (/\b(rm|mv|cp|touch|tee|truncate)\b/.test(line) && !/rm -f "\$tmp" "\$out"/.test(line) && name !== "install.sh") out.push(`${at} file change`);
      }
    });
  }
  if (qt && pastes !== 1) out.push(`main.js quoteToTerminal() pastes ${pastes} times; exactly one paste is allowed`);
  // OpenCode's database is opened read-only, always, and its SQL only selects.
  for (const f of readdirSync(modDir).filter((n) => n.endsWith(".sh"))) {
    readFileSync(join(modDir, f), "utf8").split("\n").forEach((raw, i) => {
      const line = raw.replace(/^\s*#.*$/, "");
      if (/\bsqlite3\b/.test(line) && !/\bsqlite3 -readonly\b/.test(line)) out.push(`${f}:${i + 1} sqlite3 without -readonly`);
    });
  }
  for (const f of readdirSync(modDir).filter((n) => n.endsWith(".sql"))) {
    const sql = readFileSync(join(modDir, f), "utf8").replace(/--.*$/gm, "");
    if (/\b(insert|update|delete|drop|alter|create|replace\s+into|attach|pragma|vacuum)\b/i.test(sql)) out.push(`${f} changes the database`);
  }
  return out;
}

test("the shipped mod pastes only in quoteToTerminal(), never types or submits, never writes under ~/.claude", () => {
  expect(violations(mod, join(root, "install.sh"))).toEqual([]);
  // One terminal.* call site in the whole mod.
  const sites = readdirSync(mod).filter((f) => f.endsWith(".js")).flatMap((f) => readFileSync(join(mod, f), "utf8").split("\n")
    .filter((l) => !/^\s*\/\//.test(l) && /["'`]terminal\.[a-z_]+["'`]/.test(l)).map((l) => `${f}: ${l.trim()}`));
  expect(sites).toEqual(['main.js: if (ok) run("terminal.paste");']);
});

test("the check catches a second paste, a submit in the quote, a quote command and git push", () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-ro-"));
  cpSync(mod, dir, { recursive: true });
  const main = join(dir, "main.js");
  const src = readFileSync(join(mod, "main.js"), "utf8");
  const inject = (text) => { writeFileSync(main, text); return violations(dir, join(root, "install.sh")); };
  // A second call site, outside the function.
  expect(inject(`${src}\nrun("terminal.paste");\n`).some((x) => x.includes("terminal command terminal.paste"))).toBe(true);
  // Enter, a CR or hc inside the function, or a second paste there.
  for (const line of ['      run("pane.focus", { pane, enter: true });', '      cx.write_to_clipboard(text + "\\r");', '      hc(["get", this.terminal]);', '      run("terminal.paste");']) {
    const v = inject(src.replace('    run("pane.focus", { pane });', `    run("pane.focus", { pane });\n${line}`));
    expect(v.length).toBeGreaterThan(0);
  }
  // A quote case in action().
  expect(inject(src.replace('      case "copy": if (this.sel)', '      case "quote": this.quote(cx, "cmd"); return true;\n      case "copy": if (this.sel)'))
    .some((x) => x.includes("action() has a quote case"))).toBe(true);
  expect(inject(src.replace('if (this.debug && name === "debugQuote")', 'if (name === "debugQuote")')).some((x) => x.includes("debug guard"))).toBe(true);
  // terminal.send anywhere, and git for anything but remote get-url.
  expect(inject(`${src}\nrun("terminal.send", { text: "x" });\n`).some((x) => x.includes("terminal.send"))).toBe(true);
  expect(inject(`${src}\nexec("git", ["push"]);\n`).some((x) => x.includes("git other than remote get-url"))).toBe(true);
  expect(inject(`${src}\nexec("open", [file]);\n`).some((x) => x.includes("open other than the README link"))).toBe(true);
  // A quote command in RECIPE.md.
  writeFileSync(main, src);
  const recipe = join(dir, "RECIPE.md");
  writeFileSync(recipe, "Commands: `agent-threads.quote` quotes the reply.\n");
  expect(violations(dir, join(root, "install.sh"), recipe)).toContain("RECIPE.md names a quote command");
});

test("the check catches an injected terminal.send", () => {
  const dir = mkdtempSync(join(tmpdir(), "threads-ro-"));
  cpSync(mod, dir, { recursive: true });
  const main = join(dir, "main.js");
  writeFileSync(main, `${readFileSync(main, "utf8")}\nrun("terminal.send", { terminal: "t1", text: "ls\\n" });\n`);
  const v = violations(dir, join(root, "install.sh"));
  expect(v.some((x) => x.includes("terminal command"))).toBe(true);
  writeFileSync(main, `${readFileSync(join(mod, "main.js"), "utf8")}\nhc(["send", "t1", "ls"]);\n`);
  expect(violations(dir, join(root, "install.sh")).some((x) => x.includes("hc send"))).toBe(true);
  for (const [code, what] of [
    ['const verb = "terminal" + ".send"; run(verb, { text: "ls" });', "computed command"],
    ['const args = ["se" + "nd", "t1"]; hc(args);', "computed arguments"],
    ['const p = "o" + "sascript"; exec(p, []);', "computed program"],
    ['const go = run; go("x");', "used as a value"],
    ['[1].forEach(hc);', "used as a value"],
  ]) {
    writeFileSync(main, `${readFileSync(join(mod, "main.js"), "utf8")}\n${code}\n`);
    expect(violations(dir, join(root, "install.sh")).filter((x) => x.includes(what)).length).toBeGreaterThan(0);
  }
  writeFileSync(main, `${readFileSync(join(mod, "main.js"), "utf8")}\nwriteTextFile("/tmp/x", "y", null);\n`);
  expect(violations(dir, join(root, "install.sh")).some((x) => x.startsWith("main.js") && x.includes("file write"))).toBe(true);
  const st = join(dir, "settings.js");
  writeFileSync(st, `${readFileSync(join(mod, "settings.js"), "utf8")}\nexport const x = () => writeTextFile(\`\${home}/.claude/sessions/1.json\`, "", null);\n`);
  expect(violations(dir, join(root, "install.sh")).some((x) => x.startsWith("settings.js") && x.includes("file write"))).toBe(true);
  writeFileSync(st, readFileSync(join(mod, "settings.js"), "utf8"));
  writeFileSync(join(dir, "extract.sh"), `${readFileSync(join(mod, "extract.sh"), "utf8")}\necho x > "$HOME/.claude/sessions/1.json"\n`);
  expect(violations(dir, join(root, "install.sh")).some((x) => x.includes("writes"))).toBe(true);
});
