# Changelog

## [1.2.0](https://github.com/ryanrozich/herdr-agent-threads/compare/v1.1.0...v1.2.0) (2026-11-24)


### Features

* **atif:** TRD-40 — keep the model's thinking in the export and run Harbor's own Claude and Codex cases against it ([#222](https://github.com/ryanrozich/herdr-agent-threads/issues/222)) ([87cdcf2](https://github.com/ryanrozich/herdr-agent-threads/commit/87cdcf206d7be8c1c6fd5a2b963c749fe4a0bdce))
* **atif:** TRD-41 — failed calls, helper steps and raw inputs use Harbor's field names ([#232](https://github.com/ryanrozich/herdr-agent-threads/issues/232)) ([5f30763](https://github.com/ryanrozich/herdr-agent-threads/commit/5f3076306e565be55a1c8b07742a172c055c040f))
* **search:** step through matches newest first with n and Shift n (TRD-37) ([#221](https://github.com/ryanrozich/herdr-agent-threads/issues/221)) ([715bd53](https://github.com/ryanrozich/herdr-agent-threads/commit/715bd53e19038efee94ff97d0df0fbaf82da7d5f))
* **senders:** a Sender rules page, the mark on a matched message, and a refused Keep that keeps what was typed ([#135](https://github.com/ryanrozich/herdr-agent-threads/issues/135)) ([24e0ddf](https://github.com/ryanrozich/herdr-agent-threads/commit/24e0ddf4abb60b56e5842c177042855e06544db4))
* **senders:** the rule editor says how many typed prompts the rule matches ([#245](https://github.com/ryanrozich/herdr-agent-threads/issues/245)) ([032356f](https://github.com/ryanrozich/herdr-agent-threads/commit/032356f6a5cd9e9357ceeddf465eda1871b1fdfc))
* **senders:** the templates stay under the rules while a rule can be added ([#249](https://github.com/ryanrozich/herdr-agent-threads/issues/249)) ([27ac6b3](https://github.com/ryanrozich/herdr-agent-threads/commit/27ac6b39501bf796efa277a4c1ed49a05fefe429))
* **settings:** Tab reaches every control on the settings card ([#124](https://github.com/ryanrozich/herdr-agent-threads/issues/124)) ([62b2e25](https://github.com/ryanrozich/herdr-agent-threads/commit/62b2e25b0b1ca233bab8c35e9a17e3fc889470bd))
* **threads:** a resize re-wraps only when the column steps, and waits 1.2 s for the pane to be still ([#258](https://github.com/ryanrozich/herdr-agent-threads/issues/258)) ([3044ad1](https://github.com/ryanrozich/herdr-agent-threads/commit/3044ad143783030643a5936be7753de82cbd9813))
* **threads:** agent messages are off the rail by default, and up and down follow the rail ([#247](https://github.com/ryanrozich/herdr-agent-threads/issues/247)) ([caa782e](https://github.com/ryanrozich/herdr-agent-threads/commit/caa782efda976c6c15bcdfa0a7cb3244545dad9b))
* **threads:** open a session at its end, still, with a loading state while it reads ([#264](https://github.com/ryanrozich/herdr-agent-threads/issues/264)) ([9c07d8b](https://github.com/ryanrozich/herdr-agent-threads/commit/9c07d8b3a2798732cd83e6703ee2ea3461c047d7))
* **threads:** unpin from the Pinned list in one click, and keep seven pins ([#281](https://github.com/ryanrozich/herdr-agent-threads/issues/281)) ([c3d589f](https://github.com/ryanrozich/herdr-agent-threads/commit/c3d589f0f3541dffcaa58c0657ba55d3a05ce772))
* **trajectory:** TRD-22 the Trajectory ledger in its own pane beside the Chat ([#233](https://github.com/ryanrozich/herdr-agent-threads/issues/233)) ([f7a7a39](https://github.com/ryanrozich/herdr-agent-threads/commit/f7a7a39d29008892c0c13d234068f0c5a6d79e95))
* **trajectory:** TRD-24 a Trajectory pane knows its dock (part 1 of 4, no visible change) ([#277](https://github.com/ryanrozich/herdr-agent-threads/issues/277)) ([d1ce235](https://github.com/ryanrozich/herdr-agent-threads/commit/d1ce23542990ace3fd30244ec933ef9ea3f67283))
* **trajectory:** TRD-24 the bottom dock's layout (part 2 of 4, no move yet) ([#278](https://github.com/ryanrozich/herdr-agent-threads/issues/278)) ([0e21299](https://github.com/ryanrozich/herdr-agent-threads/commit/0e21299a689b9f52aa70f3360180d2e8c3538d51))


### Bug Fixes

* **atif:** Antigravity results say when a call failed and ended (TRD-97 part two) ([#275](https://github.com/ryanrozich/herdr-agent-threads/issues/275)) ([635967f](https://github.com/ryanrozich/herdr-agent-threads/commit/635967fe23ea716674d6d95174d34ac057ce4149))
* **atif:** OpenCode results say whether the call failed and when it ended ([#266](https://github.com/ryanrozich/herdr-agent-threads/issues/266)) ([c76ce2e](https://github.com/ryanrozich/herdr-agent-threads/commit/c76ce2ee3275cc559640e98ca1f6fedc13469533))
* **atif:** Pi results say whether the call failed and when it ended (TRD-97 part one) ([#274](https://github.com/ryanrozich/herdr-agent-threads/issues/274)) ([215f3bf](https://github.com/ryanrozich/herdr-agent-threads/commit/215f3bfc2f5518b1d4f3497fac900e8b98b8b2f0))
* **atif:** TRD-51 — a Codex subagent rollout read alone starts at its own history ([#225](https://github.com/ryanrozich/herdr-agent-threads/issues/225)) ([b47a13b](https://github.com/ryanrozich/herdr-agent-threads/commit/b47a13b47a06057141742754adabbf80573aa9ee))
* open turns break a long hyphenated token after a "-", not inside a word ([#122](https://github.com/ryanrozich/herdr-agent-threads/issues/122)) ([2b5d4d0](https://github.com/ryanrozich/herdr-agent-threads/commit/2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c))
* **rules:** the Pattern and Finds hints wrap inside the card ([#250](https://github.com/ryanrozich/herdr-agent-threads/issues/250)) ([50b32b5](https://github.com/ryanrozich/herdr-agent-threads/commit/50b32b5ab47a77fe3d2abce2f53166ffa923c550))
* **threads:** a press in a sender rule's field takes the ring, and closes the type picker ([#273](https://github.com/ryanrozich/herdr-agent-threads/issues/273)) ([efd7236](https://github.com/ryanrozich/herdr-agent-threads/commit/efd723600d867f79accf728b7ba7911169a7d589))
* **threads:** the Chat, the Trajectory and the Pinned column size and drag by weights on Herdr 0.1.18 ([#301](https://github.com/ryanrozich/herdr-agent-threads/issues/301)) ([48e7d63](https://github.com/ryanrozich/herdr-agent-threads/commit/48e7d6332bdfc36faefbb8069ed94c78f9e809a5))
* **threads:** the Threads pane drags by the edge you grab ([#244](https://github.com/ryanrozich/herdr-agent-threads/issues/244)) ([46d54fd](https://github.com/ryanrozich/herdr-agent-threads/commit/46d54fd5846145cd015c2527c0b34f5fb8a7fcb0))
* **threads:** TRD-75 a compact Trajectory below 200 px ([#262](https://github.com/ryanrozich/herdr-agent-threads/issues/262)) ([72992c2](https://github.com/ryanrozich/herdr-agent-threads/commit/72992c2078519053fe08319f1b30a52d95f01e1a))
* **threads:** TRD-75 the Chat and its Pinned column drag as a pair on weights ([#260](https://github.com/ryanrozich/herdr-agent-threads/issues/260)) ([81a4e6b](https://github.com/ryanrozich/herdr-agent-threads/commit/81a4e6b0f9bf9229cb6faad675dad155a4d5f42b))
* **threads:** TRD-75 the Chat, the Trajectory and the Pinned column on weights together ([#261](https://github.com/ryanrozich/herdr-agent-threads/issues/261)) ([3ffa634](https://github.com/ryanrozich/herdr-agent-threads/commit/3ffa6340a308d81c7a01a2061d01a75a03f900ee))
* **turns:** show the replies the agent writes after background-task notices ([#255](https://github.com/ryanrozich/herdr-agent-threads/issues/255)) ([79c9864](https://github.com/ryanrozich/herdr-agent-threads/commit/79c9864fb195ad3e467a3dc0a7041ed73995a68f))


### Performance Improvements

* **threads:** read a large session in growing calls, and keep shaping to the draw's time ([#280](https://github.com/ryanrozich/herdr-agent-threads/issues/280)) ([10f6362](https://github.com/ryanrozich/herdr-agent-threads/commit/10f6362ff196d987807112efb74638cb248f7885))

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
