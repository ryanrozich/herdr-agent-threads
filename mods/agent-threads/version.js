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

// The card's line and its tooltip. A copy made without install.sh (from the herdr.dev
// listing, or a downloaded folder) has no build, so it says the commit is not known: it is
// this release or any later commit on main, and the line never claims more.
export function versionLine(version, build) {
  const b = parseBuild(build);
  if (!b) return { text: `${NAME} ${version} (commit not known)`, tip: "Copied without ./install.sh, so the commit is not known: this release or a later commit on main.", commit: null, later: null, dirty: false, known: false };
  const changes = b.dirty ? ", with local changes" : "";
  let text;
  if (b.tag !== version) text = `${NAME} ${version} (${b.commit}${changes})`;
  else if (b.later > 0) text = `${NAME} ${version}, ${b.later} ${b.later === 1 ? "commit" : "commits"} later (${b.commit}${changes})`;
  else text = b.dirty ? `${NAME} ${version} (${b.commit}${changes})` : `${NAME} ${version}`;
  return { text, tip: null, commit: b.commit, later: b.later, dirty: b.dirty, known: true };
}
