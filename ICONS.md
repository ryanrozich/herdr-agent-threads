# Agent marks

The pane draws each agent's own mark in the header badge, the "No turns yet" state and the list of agents it reads. The marks are the ones Herdr itself ships for these agents (Herdr 0.1.14, its built-in icons, copied out of the app read-only). Herdr's notice says: "Agent icons: from LobeHub icons (MIT) and the agents' own marks."

| File | Agent | Source | Drawn |
|---|---|---|---|
| `mods/agent-threads/claude-mark.svg` | Claude Code | Already in this repo before these marks | White on Claude's orange tile |
| `mods/agent-threads/logo-codex.svg` | Codex | Herdr's `codex.svg`, from LobeHub icons | As it is, on a dark tile |
| `mods/agent-threads/logo-opencode.svg` | OpenCode | Herdr's `opencode.svg`, from LobeHub icons | White on a dark tile (a one-colour mark) |
| `mods/agent-threads/logo-pi.svg` | Pi | Herdr's `pi.svg`, Pi's own mark | White on a dark tile |
| `mods/agent-threads/logo-cursor.svg` | Cursor | Herdr's `cursor.svg`, from LobeHub icons | White on a dark tile (a one-colour mark) |
| `mods/agent-threads/logo-antigravity.svg` | Antigravity | Herdr's `antigravity.svg`, from LobeHub icons | As it is, on a dark tile |
| `mods/agent-threads/logo-amp.svg` | Amp (on its "isn't supported" page) | Herdr's `amp.svg`, from LobeHub icons | As it is, on a dark tile |

The dark tile is `#1c1d21`, the colour Herdr puts behind these icons. Which marks are drawn white follows Herdr's own list (its `tint` flag).

Each file is Herdr's SVG with two changes and none to the drawing: `width` and `height` are 24 (Herdr's say `1em`, and Pi's has none), and the inline `style="flex:none;line-height:1"` is gone. Paths, colours, masks and gradients are as Herdr ships them.

The names and marks are their owners' trademarks. They are here only to show which agent a session belongs to.

## LobeHub icons

https://github.com/lobehub/lobe-icons

```
MIT License

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
