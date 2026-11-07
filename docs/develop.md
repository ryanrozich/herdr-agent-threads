# Developing Agent Threads

```sh
bun test                                   # extractor, turn assembly, session mapping, drawing helpers, read-only rule
bun test/make-fixture.js out.jsonl [id] [cwd] [flags]   # synthetic transcript; flags in the file header
bun test/make-big.js out.jsonl 600 [real|noisy|dense]   # very large synthetic transcript, for timing
sh test/scan-private.sh                    # before committing: no home paths, names, emails, real ids or sidebars (PNGs via tesseract)
```

CI (`.github/workflows/ci.yml`) runs on every pull request and push to main: Biome lint (`biome.jsonc`; each rule turned off says why), shellcheck at warning level, a jq syntax check of `extract.jq`, `bun test`, and gitleaks over the new commits. `herdr-app check` and the private scan stay local: `./install.sh` runs the check, and the scan needs this machine's paths.

```sh
bunx @biomejs/biome@2.6.4 lint
shellcheck -S warning $(git ls-files '*.sh')
```

`test/fixtures/session.jsonl` is synthetic: the line shapes of a Claude Code 2.1.316 transcript with made-up content. Never commit real transcript text. `test/codex.test.js` and `test/opencode.test.js` build a rollout and a database at run time, the same way, in the shapes Codex and OpenCode write. The OpenCode tests need the `sqlite3` command.

Try the panel in a separate Herdr window, never the one you work in: start one with its own `HERDR_APP_HOME` in a scratch folder, install the mod there (`HERDR_APP_HOME=… ./install.sh`), and run every `herdr-app do` and `hc` with that `HERDR_APP_HOME` (and `HC_SOCKET` unset). Then pin a pane to a fixture beside any throwaway terminal:

```sh
herdr-app do pane.split --pane <pane> --direction right --mod agent-threads \
  --props '{"terminal":"<t>","transcript":"/abs/path/to/fixture.jsonl","debug":true}'
```

With `debug`, the pane writes what it shows to `shared("threads.debug")` in the instance's `shared.json` (rows with line counts and heights, senders, card parts, header, footer, settings, the last focus call). A window behind another window never draws, so it never reports its size: add `"width": 240` to the props, or run `herdr-app do agent-threads.debugWidth:240`, to lay the pane out for a width (debug only).

With `"debug": true` the pane publishes what it shows (header, banners, rows, timings) to `shared("threads.debug")[<terminal>]`, which lands in `$HERDR_APP_HOME/shared.json`, so a check works even when the window is not drawing. Drive it with mod commands, for example `herdr-app do "agent-threads.search:#3"`, `agent-threads.nextDay` or `agent-threads.choose` then `"agent-threads.pick:2"`, and read the report again.

Pins can be driven the same way: `pin`, `go:1` and `undoUnpin` are the keys `p`, `1` and `u`. With `debug`, `debugScroll:<list item key>` puts a list item at the top as a person's scroll would, and `debugWhole` opens the whole reply. `shared("threads.debug")[<terminal>].pins` reports the pins, the list item at the top, the fold and the last save error. These go through the same code as a key press, but they are not one: check real keys, clicks and hovers by hand.

Session mapping, `/clear`, "claude exited" and the guess banner need a claude process and a Claude home, but never a real one. For tests and demos only, a pane takes `"claudeHome": "/abs/fake-claude"` in place of `~/.claude` (the launcher never sets it):

```sh
WF=/path/to/scratch
mkdir -p $WF/bin $WF/claude/projects/-private-tmp-threads-demo $WF/claude/sessions /tmp/threads-demo
printf '#include <unistd.h>\n#include <stdlib.h>\nint main(int c,char**v){sleep(c>1?atoi(v[1]):3000);return 0;}\n' > $WF/decoy.c
cc -o $WF/bin/claude $WF/decoy.c           # a decoy named claude (a copied /bin/sleep is killed by code signing)
# a throwaway terminal running it in its own process group, so hc reports it as the foreground program:
#   sh -c 'cd /tmp/threads-demo; set -m; "$WF/bin/claude" 86400; exec sh -i'
hc get <t> --json | jq .foreground.name    # "claude"
bun test/make-fixture.js $WF/claude/projects/-private-tmp-threads-demo/<idA>.jsonl <idA> /private/tmp/threads-demo
printf '{"pid":%s,"sessionId":"<idA>","cwd":"/private/tmp/threads-demo"}\n' <decoy pid> > $WF/claude/sessions/<decoy pid>.json
```

To act out `/clear`, write a second fixture made with `--clear` into the same project folder and point the record at its id. Kill the decoy to see "claude exited". With no record and two transcripts in the folder, the pane guesses and offers "Choose from 2…".

## Regenerating the screenshots

`preview.png` and `docs/screenshots/` show a staged session on a made-up project, with no retouching. `test/make-hero.js` writes the transcript, `test/hero/screen.c` is a stand-in for Claude Code in the left terminal (it builds on macOS), and `test/hero/render.py` draws what that terminal shows. A quote really pastes: the stand-in turns on bracketed paste and logs what it receives, and the renderer redraws the prompt from that log.

In a separate Herdr window on a Retina display, at zoom 1, with `promptLines` 2, `replyLines` 3 and the two link rules from the README:

```sh
mkdir -p ~/code/acme-web && git -C ~/code/acme-web init -q
git -C ~/code/acme-web remote add origin https://github.com/acme/acme-web.git
bun test/make-hero.js hero.jsonl ~/code/acme-web 2026-11-03T20:05:00Z days   # three days: shoot on 5 Nov for Today and Yesterday
bun test/make-agents.js agents ~/code/acme-web 2026-11-05T15:10:00Z       # Codex, OpenCode, Pi and Cursor sessions
cc -o stage-claude test/hero/screen.c
herdr-app do space.new --name acme-web --folder ~/code/acme-web --tab acme-web \
  --argv '["/abs/stage-claude","/abs/screen.txt","/abs/input.txt"]'
herdr-app do pane.split --pane <pane> --direction right --mod agent-threads \
  --props '{"terminal":"<t>","transcript":"/abs/hero.jsonl","debug":false}'
herdr-app do layout.resize --id <new pane> --px 500
python3 test/hero/render.py <cols> <rows> /abs/screen.txt /abs/input.txt &    # size from: hc get <t> --json
```

Start each shot from a fresh launch with the window size set in `window.json`. Put the project under the app's own HOME, so the terminal header shows `~/code/acme-web`, and keep the app off the network (an unreachable `HTTPS_PROXY`) so no update toast covers the pane. Then run its `agent-threads.<command>` commands with `herdr-app do`, and take `herdr-app shot`. Each crop is `sips -c <height> <width> --cropOffset <y> <x>`.

| File | Window | Commands | Crop |
|---|---|---|---|
| `preview.png` | 1460x1150 | `open` | `2136 2358`, offset `96 552` |
| `days.png` | 1460x1150 | `first` | `2136 1012`, offset `96 1898` |
| `panel.png` | 1460x1150 | `open` | `2136 1012`, offset `96 1898` |
| `open-turn.png` | 1460x1150 | `open` | `1024 990`, offset `1074 1908` |
| `search.png` | 1460x700 | `search:tests` | `1236 1012`, offset `96 1898` |
| `images.png` | 1460x1150 | `search:#5`, `open`, `open` | `2136 1012`, offset `96 1898` |
| `agent-messages.png` | 1460x1150 | `agents:on`, `search:#4`, `open` | `2136 1012`, offset `96 1898` |
| `quote.png` | 1460x1150 | `search:#6`, `open`, `open`, `debugQuote` | `810 2356`, offset `1418 552` |
| `light.png` | 1460x1150 | `open`, with `"appearance": "light"` in `settings.json` and `--light` on `render.py` | `2136 2358`, offset `96 552` |
| `agents.png` | 1460x720, the pane's `transcript` set to each file `make-agents.js` printed | `first`, `open` | `1276 1012`, offset `96 1898` each, then `magick montage codex.png opencode.png pi.png cursor.png -tile 4x1 -geometry +20+20 -background '#0f1012' agents.png` |

`quote.png` needs `"debug": true` in the props, because `debugQuote` runs only with it, and debug adds a timing text to the pane header, which that crop leaves out. `agents:on` saves to settings, so turn it off before the next shot.

After changing an image, run `sh test/scan-private.sh` with its line removed from `test/scan-approved.txt`, so OCR reads it, and pin the new hash only once the owner has approved it.
