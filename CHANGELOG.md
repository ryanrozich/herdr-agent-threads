# Changelog

## [1.1.0](https://github.com/ryanrozich/herdr-agent-threads/compare/v1.0.0...v1.1.0) (2026-11-19)


### Features

* a line the reader left out shows as one dim note in the list ([#176](https://github.com/ryanrozich/herdr-agent-threads/issues/176)) ([90bb9f4](https://github.com/ryanrozich/herdr-agent-threads/commit/90bb9f423e2174fbcde326a395d23208e62c45ab))
* a status line with the chat's stats at the pane's foot ([#166](https://github.com/ryanrozich/herdr-agent-threads/issues/166)) ([af11856](https://github.com/ryanrozich/herdr-agent-threads/commit/af1185690fccf77b6b1067565af3e46714c87440))
* **atif:** core/atif.js writes a session as an ATIF-v1.7 trajectory ([#85](https://github.com/ryanrozich/herdr-agent-threads/issues/85)) ([def6415](https://github.com/ryanrozich/herdr-agent-threads/commit/def6415db1a802e94ab2921e1fae7df04ed12204))
* **atif:** the ATIF export nests subagents and writes whole tool arguments ([#86](https://github.com/ryanrozich/herdr-agent-threads/issues/86)) ([0865497](https://github.com/ryanrozich/herdr-agent-threads/commit/08654975a6d23ad79cfdf38853d7af40cdfcfe1a))
* **rules:** a refused Keep rule says why in the open rule too ([#121](https://github.com/ryanrozich/herdr-agent-threads/issues/121)) ([0ab7b13](https://github.com/ryanrozich/herdr-agent-threads/commit/0ab7b1387f687e29063444f1a5667262184ebbcb))
* **session:** times on steps and a record for each tool call ([#84](https://github.com/ryanrozich/herdr-agent-threads/issues/84)) ([4d58713](https://github.com/ryanrozich/herdr-agent-threads/commit/4d58713f907ec37319e69fe7b88042a08d90ad4f))
* **status-line:** a context ring for Codex, from the window its transcript states ([#175](https://github.com/ryanrozich/herdr-agent-threads/issues/175)) ([3531363](https://github.com/ryanrozich/herdr-agent-threads/commit/353136385f45fd68e7f9ad503292e3376581e8eb))
* the settings card shows the version you are running ([#154](https://github.com/ryanrozich/herdr-agent-threads/issues/154)) ([b58199e](https://github.com/ryanrozich/herdr-agent-threads/commit/b58199eb12976904b75880d74856ccf32ee15b1e))
* TRD-10 — Readers should be able to read pasted output and line breaks in their message bubbles ([#177](https://github.com/ryanrozich/herdr-agent-threads/issues/177)) ([c1504ce](https://github.com/ryanrozich/herdr-agent-threads/commit/c1504cec0ebfb06fa0a78c09d2f28972352e8916))


### Bug Fixes

* a character across a 4 KB piece of a transcript line no longer shows as U+FFFD ([#171](https://github.com/ryanrozich/herdr-agent-threads/issues/171)) ([6edd939](https://github.com/ryanrozich/herdr-agent-threads/commit/6edd9395d3d8774745b208d9ed787e49e62246de))
* a double press on a closed turn selects a word instead of opening the turn ([#172](https://github.com/ryanrozich/herdr-agent-threads/issues/172)) ([531d231](https://github.com/ryanrozich/herdr-agent-threads/commit/531d23148dba7545835a59e39f06285b1d6329b7))
* a transcript line longer than the reader's chunk is read whole, or skipped past 64 MB ([#174](https://github.com/ryanrozich/herdr-agent-threads/issues/174)) ([ae7c513](https://github.com/ryanrozich/herdr-agent-threads/commit/ae7c5135797426d2e15f88e8157ee8b77a428a0c))
* **atif:** find nested subagents, keep wake-up steps, write whole results ([#167](https://github.com/ryanrozich/herdr-agent-threads/issues/167)) ([b53e6e8](https://github.com/ryanrozich/herdr-agent-threads/commit/b53e6e87da977fefcb330f129232362573d4ef6d))
* **keys:** the page keys on one line, and the sheet shows when there is more ([#170](https://github.com/ryanrozich/herdr-agent-threads/issues/170)) ([bc28b40](https://github.com/ryanrozich/herdr-agent-threads/commit/bc28b40ce8c71ae4a86030cf3fdfabbf7a580465))
* **links:** one slow run under load no longer turns a plain rule off ([#145](https://github.com/ryanrozich/herdr-agent-threads/issues/145)) ([0e80e7f](https://github.com/ryanrozich/herdr-agent-threads/commit/0e80e7ffa7ed0749abd462c59a040da5c4620c52))
* make Catalyst settings pass ingest ([f90fd52](https://github.com/ryanrozich/herdr-agent-threads/commit/f90fd523445c91aa1355de14d3429429604ae2ee))
* **paste:** the closing tag closes a paste wherever it is on its line ([#203](https://github.com/ryanrozich/herdr-agent-threads/issues/203)) ([f20754d](https://github.com/ryanrozich/herdr-agent-threads/commit/f20754d3ec82db197edb0328c404ddc6f9e78c11))
* **release:** a push that leaves the release pull request as it is no longer fails the Release run ([#199](https://github.com/ryanrozich/herdr-agent-threads/issues/199)) ([e59c423](https://github.com/ryanrozich/herdr-agent-threads/commit/e59c42357a4b1e63c4d8e0d71bb7bf621e8aacd3))
* **select:** a bottom scroll queued just before a highlight starts no longer runs ([#146](https://github.com/ryanrozich/herdr-agent-threads/issues/146)) ([c61603e](https://github.com/ryanrozich/herdr-agent-threads/commit/c61603ef7b365f18b82446c575de57d258f1b4f2))
* **select:** a hold for a highlight is counted, not timed; the link rule test covers the long probes ([#200](https://github.com/ryanrozich/herdr-agent-threads/issues/200)) ([574a2f8](https://github.com/ryanrozich/herdr-agent-threads/commit/574a2f8cc61edba21c6e63792646311e6131d5b7))
* **settings:** the card never grows when the pane shrinks ([#169](https://github.com/ryanrozich/herdr-agent-threads/issues/169)) ([b356e85](https://github.com/ryanrozich/herdr-agent-threads/commit/b356e856851e0cc0f4357a1f7256ced5cacd674d))
* **settings:** the card stays inside a very short pane, its foot always shown ([#168](https://github.com/ryanrozich/herdr-agent-threads/issues/168)) ([3a24f10](https://github.com/ryanrozich/herdr-agent-threads/commit/3a24f10f9a284463ffd043e2a6218a8ed826d406))

## 1.0.0 (2026-11-18)

The first release, cut by hand. What it holds is in [docs/release-notes.md](docs/release-notes.md) and on the [v1.0.0 release](https://github.com/ryanrozich/herdr-agent-threads/releases/tag/v1.0.0). From here on, release-please writes this file from the titles of the pull requests merged since the last release.
