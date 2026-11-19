// The mod's version: the last release this copy holds, shown under File on the settings card.
// The release tool bumps the line below when it cuts a release (the marker at its end), so it
// is not edited by hand. A later update check can compare VERSION with the latest release.
export const VERSION = "1.0.0"; // x-release-please-version
// The mod's title, as in mod.json.
export const NAME = "Agent Threads";

// build.js's BUILD, as ./install.sh wrote it from `git describe --tags --long --dirty`:
// "v1.0.0-0-gd7c9cfb" on the release, "v1.0.0-3-gabc1234" three commits after it, with
// "-dirty" for local changes. Anything else is no build.
export function parseBuild(build) {
  if (typeof build !== "string") return null;
  const m = /^v(\d+\.\d+\.\d+)-(\d+)-g([0-9a-f]{7,40})(-dirty)?$/.exec(build);
  return m ? { tag: m[1], later: Number(m[2]), commit: m[3].slice(0, 7), dirty: Boolean(m[4]) } : null;
}

// The card's line and its tooltip. On the release's own commit, the version alone; past it
// or with local changes, "commit:" and the short hash, with the commit count only in the
// tooltip, to keep the line short. A copy made without install.sh (from the herdr.dev
// listing, or a downloaded folder) has no build, so it says the commit is not known: it is
// this release or any later commit on main, and the line never claims more.
export function versionLine(version, build) {
  const b = parseBuild(build);
  if (!b) return { text: `${NAME} ${version} (commit not known)`, tip: "Copied without ./install.sh, so the commit is not known: this release or a later commit on main.", commit: null, later: null, dirty: false, known: false };
  const release = b.tag === version && b.later === 0 && !b.dirty;
  const text = release ? `${NAME} ${version}` : `${NAME} ${version}, commit: ${b.commit}${b.dirty ? ", with local changes" : ""}`;
  // The count is from the tag git found, so only when that tag is this version.
  const tip = b.tag === version && b.later > 0 ? `${text}, ${b.later} ${b.later === 1 ? "commit" : "commits"} after the ${version} release` : null;
  return { text, tip, commit: b.commit, later: b.later, dirty: b.dirty, known: true };
}
