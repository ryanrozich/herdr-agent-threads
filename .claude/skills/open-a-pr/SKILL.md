---
name: open-a-pr
description: Open a pull request in the Agent Threads repo so the merge queue will take it. Use when asked to open, prepare or update a PR here, or to stack one PR on another.
---

# Open a pull request here

1. **Branch from main.** `git fetch origin && git switch -c <short-name> origin/main`. If the change needs another open pull request first, still branch from main and see step 5.
2. **Make the change, test first.** Add or change the test that shows the change, then the code. Keep fixtures synthetic.
3. **Check it.**
   ```sh
   bun test
   bunx @biomejs/biome@2.6.4 lint
   shellcheck -S warning $(git ls-files '*.sh')
   sh test/scan-private.sh
   ```
   All four must pass. They are CI's commands plus the private scan. If `RECIPE.md` changed, keep it under 60 KB (`test/recipe-size.test.js`).
4. **Title it.** A Conventional Commit, `type(scope)!: what changes for the person using the mod`. Use `feat` for something a user can see or do, `fix` for a bug, `perf` for speed, `docs`, `test`, `ci`, `build`, `refactor`, `chore` or `style` for the rest, and `revert` to take a change back. Add `!` only for a breaking change. The title becomes the commit on main and decides the next release.
5. **Order, if any.** Put `Depends-On: #N` on its own line in the description for each pull request that must land first. After #N lands, run `git fetch origin && git rebase --onto origin/main <N's last commit> <this branch>` and push with `--force-with-lease`.
6. **Open it as a draft.** `gh pr create --draft --base main --title "<title>" --body-file <file>`. The body says what changed, why, how it was tested, and anything a reviewer should look at first. It becomes the squash commit's body.
7. **Ready.** When `check` and `title` pass and the review is done, mark it ready (`gh pr ready <N>`). A maintainer adds the `queue` label. That is the merge. Do not merge with the button.
8. **After it lands.** main is what the herdr.dev listing installs, so read main's `check` once more.
