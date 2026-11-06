# Pinning design

A design proposal for pinning turns in Agent Threads. Nothing here is built. The review page is `index.html`, and it holds the reasons, the states and the evidence.

- `agent-threads-pinning.pen` is the design source, 44 frames. It opens in Pen.
- `gen-pen.mjs` writes that file. Run `bun designs/pinning/gen-pen.mjs`. Colours were read from the running panel in dark and light.
- `previews/` holds a 2x PNG of every frame, exported from the source through Pen.
- `evidence/` holds screenshots of the real panel running a throwaway patch, which is not in this repo. They use a made-up session.

The frames leave out a card's stat chips and action bar, which pinning does not change. They are generated from one script, so they use no linked Pen components.

All content is made up. Real sessions were read only for counts and turn fingerprints, and no text from them is stored here.
