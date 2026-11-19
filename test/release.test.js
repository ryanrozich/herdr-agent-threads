// Releases come from release-please: a release pull request bumps the version and the
// changelog, and merging it through the queue makes the tag and the GitHub release. These
// pin the pieces that have to agree: the version file the pane shows, the manifest, the
// config, and the workflow that gives the release pull request its `check`.
import { test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dir, "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const config = JSON.parse(read("release-please-config.json"));
const manifest = JSON.parse(read(".release-please-manifest.json"));
const release = read(".github/workflows/release.yml");
const ci = read(".github/workflows/ci.yml");
const { VERSION } = await import(join(root, "mods", "agent-threads", "version.js"));

test("one version: the manifest says what version.js says, and release-please bumps version.js", () => {
  expect(manifest).toEqual({ ".": VERSION });
  const pkg = config.packages["."];
  expect(pkg["release-type"]).toBe("simple");
  expect(pkg["extra-files"]).toEqual([{ type: "generic", path: "mods/agent-threads/version.js" }]);
  expect(existsSync(join(root, "mods", "agent-threads", "version.js"))).toBe(true);
  expect(read("CHANGELOG.md")).toMatch(/^# Changelog\n/);
});

test("the release pull request opens as a draft, which the queue refuses, so only the owner's ready lets it merge", () => {
  expect(config["draft-pull-request"]).toBe(true);
  expect(read(".mergify.yml")).toMatch(/^\s*- -draft$/m);
});

test("tags read v1.0.1, and the first run starts after the commit v1.0.0 tags", () => {
  expect(config["include-component-in-tag"]).toBe(false);
  expect(config["include-v-in-tag"] ?? true).toBe(true);
  expect(config["bootstrap-sha"]).toMatch(/^[0-9a-f]{40}$/);
  // Where the tag is fetched (CI checks out the full history with tags), it is that commit.
  const tagged = spawnSync("git", ["rev-parse", "--verify", "-q", "v1.0.0^{commit}"], { cwd: root, encoding: "utf8" });
  if (tagged.status === 0) expect(config["bootstrap-sha"]).toBe(tagged.stdout.trim());
});

test("the release pull request gets its check: release.yml starts ci.yml on its branch, and ci.yml takes that", () => {
  // A pull request the Actions token opens gets its pull_request runs only once someone
  // approves them, but a dispatch with that token runs at once, so the workflow runs ci.yml
  // itself on the release branch's head.
  expect(ci.split("\npermissions:")[0]).toMatch(/^ {2}workflow_dispatch:$/m);
  // Pinned to a commit, with the release it is in the comment.
  expect(release).toMatch(/uses: googleapis\/release-please-action@[0-9a-f]{40} # v4\.\d+\.\d+\n/);
  expect(release).toMatch(/if: \$\{\{ steps\.release\.outputs\.prs_created == 'true' \}\}/);
  expect(release).toMatch(/BRANCH: \$\{\{ fromJSON\(steps\.release\.outputs\.pr\)\.headBranchName \}\}/);
  expect(release).toMatch(/gh workflow run ci\.yml --repo "\$GITHUB_REPOSITORY" --ref "\$BRANCH"/);
  // Only what it needs: the action README's three (write the release commit, tag and
  // release; label; open the pull request), and starting a workflow run.
  expect(release).toMatch(/\npermissions:\n {2}contents: write\n {2}issues: write\n {2}pull-requests: write\n {2}actions: write\n\n/);
  // Values reach the script through env, never pasted into it.
  expect(release.split("run: |")).toHaveLength(2);
  expect(release.split("run: |")[1]).not.toContain("${{");
});
