# Chat-look design

A design proposal: Agent Threads drawn the way chat apps draw a conversation, with every piece of information it shows today. It also covers three ways to reach pins and a design for quote tracking. Nothing here is built. The review page is `index.html`, with the reasons, the comparisons, the decisions and the build sizes.

- `agent-threads-chat-look.pen` is the design source, 63 frames. It opens in Pen.
- `gen-pen.mjs` writes that file: `bun designs/chat-look/gen-pen.mjs [out.pen]`. Colours are the running panel's, in dark and light.
- `make-session.mjs` writes the made-up session behind both the design and the screenshots of today's panel: `bun designs/chat-look/make-session.mjs <out.jsonl> <cwd> <startISO> <days>`. It extends `test/make-hero.js` with a long message and reply, two messages that quote parts of that reply, a turn with 14 tool calls and a running turn.
- `shots/current/` is today's panel with that session, from an isolated Herdr 0.1.13 window at 520 and 280 px, cropped to the pane.
- `shots/proposal/` is every frame of the Pen file, exported at 2x.

All content is made up.
