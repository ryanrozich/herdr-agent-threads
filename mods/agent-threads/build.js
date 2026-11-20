// What ./install.sh found in the clone it ran from (version.js parseBuild). It writes this
// file in the installed copy only, and only in parseBuild's exact shape. Here, and in a copy
// made without install.sh, it is null. main.js loads it with a dynamic import that catches,
// so a missing or broken file leaves the pane working, reading "commit not known".
export const BUILD = null;
