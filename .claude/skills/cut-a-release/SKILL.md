---
name: cut-a-release
description: Cut a release of Agent Threads through release-please and the merge queue. Use when asked to release, publish a version, tag, or check what the next version will be.
---

# Cut a release here

Releases are never tagged by hand. release-please keeps one release pull request open, and merging it is the release.

1. **Find the release pull request.** `gh pr list --label "autorelease: pending" --json number,title,headRefName`. Its branch is `headRefName`; read it from there rather than assuming a name. Its title is "chore(main): release X.Y.Z". If there is none, either nothing releasable has merged since the last release (only `feat`, `fix`, `perf`, `revert` and `!` titles make one), or the Release run failed: read `gh run list --workflow release.yml`. It cannot open a pull request unless the repo setting "Allow GitHub Actions to create and approve pull requests" (Settings, Actions, General) is on, and only a repo admin can change that.
2. **Read it.** The diff touches only `mods/agent-threads/version.js`, `.release-please-manifest.json` and `CHANGELOG.md`. The new changelog entry lists the pull requests since the last release. Check the version: `feat` makes a minor bump, `fix`, `perf` and `revert` a patch, and `!` a major. A wrong title on main gives a wrong entry: fix it with a follow-up pull request, never by editing the release pull request.
3. **Check its `check`.** The Actions token opens the release pull request, so its own `pull_request` runs (CI and the title check) wait in an approval-required state. The Release workflow therefore starts CI on the release branch itself with a dispatch, which runs at once. `gh pr checks <N>` should show `check` passing on its head, next to the waiting runs. If the dispatched `check` is missing, start it with `gh workflow run ci.yml --ref "$(gh pr view <N> --json headRefName -q .headRefName)"`. If Mergify's Summary on the pull request still waits on `check`, a maintainer can approve the waiting runs on its Checks tab ("Approve workflows to run").
4. **Release.** Mark it ready if it is a draft, and add the `queue` label. The queue squashes it onto main.
5. **Read it back.** The next Release run, on that push to main, makes the tag and the GitHub release:
   ```sh
   git ls-remote --tags origin vX.Y.Z
   gh release view vX.Y.Z
   ```
   The settings card of an install from that tag reads "Agent Threads X.Y.Z".
