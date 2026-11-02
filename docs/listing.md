# Listing on herdr.dev/mods

This repo is listed at herdr.dev/mods. Herdr's guide (`~/.config/herdr-app/AGENTS.md`, "Layouts and mods other people made") says what a listing reads:

- A **public GitHub repo** with the topic **`herdr-mod`**. It shows up under Community at herdr.dev/mods within the hour.
- The folder laid out like Herdr's home: **`mods/<name>/`** (the mod) and **`keys.json`** (the keys it expects). An installer copies `mods/<name>/` into its own `mods/` and merges `keys.json`.
- **`RECIPE.md`**: the brief another agent builds the mod from, in this order: `# Name`, one paragraph and `![Name](preview.png)`; What you see; How it behaves; Built from; Watch out; Done when. Its first paragraph is the listing description.
- **`preview.png`**: a screenshot, beside `RECIPE.md`.

There are no manifest fields, icon, category or image size rules.

## Renaming the mod

The mod's name is one line in `mods/<name>/name.js`. To change it:

```sh
sh rename.sh <new-name>    # renames mods/<name>/, keys.json, the docs, the tests and the commands
bun test && ./install.sh
```

The old name joins `PREVIOUS` in `name.js`, so a settings file saved under it is adopted the first time the renamed pane opens. The pane's title is `title` in `mods/<name>/mod.json`.
