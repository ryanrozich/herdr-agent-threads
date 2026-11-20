---
name: verify-a-change
description: Build, check and verify a change to the Agent Threads mod, its installer or its tests. Use before opening or updating a pull request that touches mods/, install.sh or test/, and to know which checks a hosted Linux run can do and which need a desktop with Herdr.
---

# Verify a change here

`docs/develop.md` has the tools (fixtures, the separate Herdr window, the debug props) and `RECIPE.md` says what the mod must do. This skill is the order to run things in and the evidence a pull request needs.

## 1. The automated checks: any machine, a hosted Linux run included

Run them in this order, the order CI runs them (`.github/workflows/ci.yml`). They need bun 1.4.2, git, bash, jq, shellcheck, perl and sqlite3, and the tests also call `ps` and `pgrep` (procps on Linux), `lsof` and `rsync`. A bare Linux runner needs all of them installed.

| Check | Command | What a pass proves | Time |
|---|---|---|---|
| Lint | `bunx @biomejs/biome@2.6.4 lint` | the code follows `biome.jsonc` | seconds |
| Shell scripts | `shellcheck -S warning $(git ls-files '*.sh')` | the installer and the scripts have no warnings | seconds |
| Extractor syntax | `for f in mods/*/core/extract*.jq; do echo '"x"' \| jq -R -f "$f" > /dev/null; done` | every jq extractor parses | instant |
| Tests | `sh test/leftover-check.sh` | `bun test` passes and leaves nothing behind | about a minute in CI |

`test/leftover-check.sh` runs `bun test` with `TMPDIR` set to a fresh folder. It fails, naming what it found, when anything is left in that folder after the run, whatever call made it, or when a process of the run is still alive 10 seconds after it ends. A temp folder a test made with `mkdtempSync(join(tmpdir(), ...))` and never removed is exactly such a leftover. A file written to a fixed path outside the temp folder is not seen by the check at all, so write temp files only under `tmpdir()`. Fix the test that left it; never loosen the check.

A change to `mods/agent-threads/core/`, `test/atif.test.js`, `test/make-fixture.js` or `test/make-agents.js` also starts the Harbor job (`.github/workflows/harbor.yml`), which the queue does not wait for. Read its report in the run's summary, or run `sh test/harbor/run.sh` (`docs/develop.md` says what it needs), and say in the pull request what it reported.

CI then scans the new commits for secrets with gitleaks 8.30.1 (`gitleaks git`). Before pushing, run the same scan in a form that also works on older versions, such as the 8.16 some distributions ship, which has no `git` subcommand. Run it from a checkout that has `origin/main`: `gitleaks detect --redact --no-banner --source . --log-opts='origin/main..HEAD'`.

Before each commit, `sh test/scan-private.sh` must print "scan: clean". Never run `herdr-app check` on the repo's mod folder: `./install.sh` runs it on the installed copy.

## 2. On a desktop with Herdr

A change that draws something, takes a key or a click, or touches focus, scrolling or the clipboard needs a real Herdr window. A hosted Linux run has no Herdr, so it cannot do this part, and it never reports these items as done. It hands them off to the person or agent with a desktop running Herdr: a "Needs a desktop check" list in the pull request body, made from the items below, with what to look at in each.

Use a separate Herdr window with its own `HERDR_APP_HOME` (`docs/develop.md`), never the window someone is working in, and a machine whose clipboard you may overwrite:

- Stills of each changed view on the current Herdr and the one before it, dark and light, at a wide and a narrow pane (for example 640 and 360 px), with the status showing no errors.
- Keys and clicks done for real, not only as mod commands: focus goes where it should, Esc closes what it should, and taking the keyboard or clicking a control pops no hint.
- Copy and quote: what lands on the clipboard and in the terminal.
- For an installer change: an install from a clone at the head, and the version line on the settings card.

Whoever runs it puts the results in the pull request: the stills attached to the body or a comment, and a list of the Herdr versions, themes and widths shot, what was clicked and typed, and what was not checked and why. Stills stay out of the repo, except `preview.png` and `docs/screenshots/` regenerated as `docs/develop.md` describes.

## Rules that bite

- Synthetic content only. Fixtures, screenshots and docs use made-up sessions (`test/make-fixture.js`, `test/make-hero.js`): no real transcript text, home paths, names or ids.
- Test first: the test that shows the change fails before it and passes after.
- A head someone has been sent to try does not move until they are told. Push the fix as a new head and say so.
