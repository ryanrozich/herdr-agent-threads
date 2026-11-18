# Working on Agent Threads

Agent Threads is a [Herdr](https://herdr.dev) mod: `mods/agent-threads/` is the mod, `RECIPE.md` is the brief another agent builds it from, and `docs/` holds the guide (`usage.md`), the design reference (`reference.md`), the agents it reads (`agents.md`) and how to develop it (`develop.md`). Read `docs/develop.md` before changing code.

## Main is what people run

The herdr.dev/mods listing installs main's head, not a release. Anything merged to main reaches people within the hour, so every merge must leave main working: tests pass, `RECIPE.md` stays under 64 KB (the listing skips a bigger one), and `preview.png` shows the mod as it is.

## Checks before a commit

```sh
bun test                                    # the whole suite
bunx @biomejs/biome@2.6.4 lint mods test    # lint
sh test/scan-private.sh                     # no home paths, names, emails or real ids, in text and in PNGs
```

Fixtures and screenshots are synthetic (the staged `acme-web` session, `test/make-hero.js`). Never commit a real transcript, path or name.

## Pull requests

- **Title.** A [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/): `type(scope)!: what changes for the person using the mod`. The types are `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert` and `style`. The scope and the `!` (a breaking change) are optional. The `title` check and the merge queue both refuse anything else. Branch commits can say anything, since only the title reaches main.
- **Squash.** Each pull request lands as one commit, its title plus `(#N)`, with the description as the body. So the description should say what changed and why, for the history.
- **The queue.** Nothing merges by hand. A maintainer adds the `queue` label (or comments `@mergifyio queue`) once a pull request is out of draft, `check` passes and every review thread is resolved. Mergify batches queued pull requests, runs `check` on the batch and squashes each one onto main.
- **Order.** When one pull request must land after another, its description carries `Depends-On: #N` on a line of its own. For a stack, base each pull request on main, and after the lower one lands, move the upper one with `git rebase --onto origin/main <lower's last commit> <upper>`.

The Merging section of `docs/develop.md` has the details. The skill `.claude/skills/open-a-pr/SKILL.md` walks through it.

## Releases

release-please (`.github/workflows/release.yml`) keeps one release pull request open, "chore(main): release X.Y.Z". It bumps `mods/agent-threads/version.js` (the version the settings card shows), `.release-please-manifest.json` and `CHANGELOG.md`, from the titles merged since the last release: `feat` makes a minor release, `fix`, `perf` and `revert` a patch, and `!` a major. Merging that pull request through the queue makes the tag (`v1.2.0`) and the GitHub release. Never edit `version.js`, the manifest or a released changelog entry by hand, and never tag by hand. The skill `.claude/skills/cut-a-release/SKILL.md` walks through it.

<!-- catalyst:start -->
## Catalyst

This repository is worked through Catalyst: tickets move through a pipeline of agent-run phases, and pull requests merge through its queue. Before you plan, branch, review or merge here, load the skill that explains the process instead of inferring it from this file: `whats-happening` (how a ticket runs, what each phase produces, why work waits), and `catalyst-sop` when it is installed (what to do when work stalls on a decision). Keep this block as it is; onboarding maintains it.
<!-- catalyst:end -->
