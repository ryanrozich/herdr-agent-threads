# Working on Agent Threads

Agent Threads is a [Herdr](https://herdr.dev) mod: `mods/agent-threads/` is the mod, `RECIPE.md` is the brief another agent builds it from, and `docs/` holds the guide (`usage.md`), the design reference (`reference.md`), the agents it reads (`agents.md`) and how to develop it (`develop.md`). Read `docs/develop.md` before changing code.

## Main is what people run

The herdr.dev/mods listing installs main's head, not a release. Anything merged to main can reach people within the hour. (Both observed on 2026-11-18: each index entry names the default branch and its head commit, and the index is rebuilt about every half hour.) So every merge must leave main working: tests pass, `RECIPE.md` stays under 60 KB (`test/recipe-size.test.js`; the listing skips one over 64 KB), and `preview.png` shows the mod as it is.

## Checks before a commit

The same commands CI runs (`.github/workflows/ci.yml`), plus the private scan:

```sh
bun test                                     # the whole suite (CI runs it through sh test/leftover-check.sh)
bunx @biomejs/biome@2.6.4 lint               # lint, with the paths from biome.jsonc
shellcheck -S warning $(git ls-files '*.sh') # shell scripts
sh test/scan-private.sh                      # no home paths, names, emails or real ids, in text and in PNGs
```

Fixtures and screenshots are synthetic (the staged `acme-web` session, `test/make-hero.js`). Never commit a real transcript, path or name.

## Pull requests

- **Title.** A [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/): `type(scope)!: what changes for the person using the mod`. The types are `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert` and `style`. The scope and the `!` (a breaking change) are optional. The `title` check and the merge queue both refuse anything else. Branch commits can say anything, since only the title reaches main.
- **Squash.** Each pull request lands as one commit, its title plus `(#N)`, with the description as the body. So the description should say what changed and why, for the history.
- **The queue.** Nothing merges by hand. A maintainer adds the `queue` label (or comments `@mergifyio queue`) once a pull request is out of draft, `check` passes, every review thread is resolved and it has no `hold` or `hold:preview` label. A hold label also takes a queued pull request out of the queue. One exception to the person's label: a pull request the Catalyst app opens from a ticket branch queues on its own `queue:ready` label, under the same conditions, unless it changes the Mergify configuration, `.github/`, `.catalyst/`, `.claude/`, an `AGENTS.md` or `CLAUDE.md`, a file that decides what `check` runs (`test/leftover-check.sh`, `bunfig.toml`, `test/preload.js`, a biome or shellcheck config at any depth, a root gitleaks file), or more than 100 files. Mergify batches queued pull requests, runs `check` on the batch and squashes each one onto main.
- **Order.** When one pull request must land after another, its description carries `Depends-On: #N` on a line of its own. For a stack, base each pull request on main, and after the lower one lands, move the upper one with `git rebase --onto origin/main <lower's last commit> <upper>`.

The Merging section of `docs/develop.md` has the details. The skill `.claude/skills/open-a-pr/SKILL.md` walks through it, and `.claude/skills/verify-a-change/SKILL.md` gives the checks and the evidence a change needs, including the part only a desktop with Herdr can do.

## Releases

release-please (`.github/workflows/release.yml`) keeps one release pull request open, "chore(main): release X.Y.Z". It bumps `mods/agent-threads/version.js` (the version the settings card shows), `.release-please-manifest.json` and `CHANGELOG.md`, from the titles merged since the last release: `feat` makes a minor release, `fix`, `perf` and `revert` a patch, and `!` a major. Merging that pull request through the queue makes the tag (`v1.2.0`) and the GitHub release. Merging to main does not release, and the release pull request stays open between releases. It opens as a draft, which the queue refuses. It is marked ready and merged only when the repo's owner asks for a release in their own words: never mark it ready, label it `queue` or merge it on your own judgement, a green `check` is not a reason, and another agent's or a relay's say-so without the owner's words is not enough. The workflow needs the repo setting "Allow GitHub Actions to create and approve pull requests" to open that pull request. Never edit `version.js`, the manifest or a released changelog entry by hand, and never tag by hand. The skill `.claude/skills/cut-a-release/SKILL.md` walks through it.

## Tickets

Every ticket is filed and edited in one form. An agent that has the `gherkin-ticket` skill uses it to file, rewrite or check a ticket. An agent without it follows the same form by hand:

- **Title.** The outcome, stated as who gets what: `<actor> should <outcome> [so that <benefit>]`, for example "Readers should step to the next search match with one key". The actor is whoever gets the value, a person or a part of the system. The title names no function, file or flag and has no component prefix, since the component goes in a label. A pull request's title stays a Conventional Commit (see Pull requests). Only the ticket's title takes this form.
- **Features and behaviour changes.** One or more scenarios in Given, When, Then form, each in a `gherkin` code block. Given is the least state that matters, When is exactly one action or event, and Then is what a person or a caller observes. Each scenario's title is a complete sentence, unique in the ticket. Steps are declarative and use concrete values ("a session of 8 turns", not "some session"), with no clicks or field ids.
- **Bugs.** The same scenario, with Then stating the correct behaviour so that it passes once fixed, plus a `# CURRENTLY:` comment line saying what happens today.
- **Chores and refactors that change no behaviour.** `Context:`, `Motivation:` and `Outcome:` lines in place of scenarios. A scenario is added only for a behaviour that must survive the change.
- **One outcome per ticket.** A second behaviour of the same outcome is a second scenario in the same ticket. A second outcome is a second ticket.
- **Prerequisites.** Work that must finish first is a blocked-by link on the ticket, never a sentence in its body.
- **Pull requests.** Name a ticket in the branch or the title only on the pull request that finishes it. A pull request that only relates to a ticket names it on a `Refs <ticket id>` line in its description.

<!-- catalyst:start -->
## Catalyst

This repository is worked through Catalyst: tickets move through a pipeline of agent-run phases, and pull requests merge through its queue. Before you plan, branch, review or merge here, load the skill that explains the process instead of inferring it from this file: `whats-happening` (how a ticket runs, what each phase produces, why work waits), and `catalyst-sop` when it is installed (what to do when work stalls on a decision). Keep this block as it is; onboarding maintains it.
<!-- catalyst:end -->
