# Agent Threads release notes

Newest first. Each release's full list of pull requests is in [CHANGELOG.md](../CHANGELOG.md).

## Unreleased

- Agent messages are off the rail after this update: the turn rail shows your own turns and the running one. To get them back, turn on "Agent messages on the rail" in Settings, under Agent messages. That choice is kept from then on.
- `↑` and `↓` (and `k` and `j`) follow the rail: they move between the turns that have a tick. With "Agent messages on the rail" off they pass over agent messages; with it on they stop at them, as before. A click still selects an agent message.
- A Codex subagent rollout exported by itself now starts at its own history boundary.
- The column now steps with the pane: 70, 90 or 120 characters a line by the pane's width. The Width setting, `Shift w` and Keep the pane at this width are gone. A resize inside a step breaks no lines anew; in a long chat, a drag past a step waits until the pane has been still for 1.2 s before the lines break anew.

### The Trajectory

- Press `y`, or the list button at the top of the chat, to see the session as a Trajectory: each turn is a heading, then one row per step (your message, the agent's texts, each tool call, the reply and any background update), with when it started, how long it took and a small bar for that.
- In a pane at least 480 px wide, the Trajectory opens as a pane of its own to the right of the chat, leaving the other panes in the tab 200 px for each of them. Narrower, or with no room for that, it shows in the chat's own pane until you press `y` or `Esc` or its Chat button.
- A call shows as running only while the agent is still at it. A call left with no result says "no result", and its detail says when the transcript last recorded anything. One case cannot be told: a session of an agent other than Claude Code (Codex, say) stopped during its very first call shows that call as a plain row with no duration.
- Keys: `↑` `↓` or `j` `k` move, `Home` and `End` go to the first or last row, `Enter` or `Space` shows the detail, `f` and `Shift f` go to failed calls, `m` and `Shift m` to your messages, `-` and `=` make the Trajectory pane narrower or wider, `y` switches between it and the chat, and `Esc` closes the detail or goes back.

### Save a session as ATIF

- The exported file now holds the model's reasoning, for Claude Code and Codex sessions, as `reasoning_content` on the step it came before. This is the default. To leave it out, put `--no-reasoning` before the path: `bun mods/agent-threads/core/atif.js --no-reasoning <transcript> > session.json`. The file then holds no reasoning, as one from 1.1.0 did.
- Reasoning a transcript keeps only as a signature, redacted or encrypted is never written. The step it came before says some was left out (`extra.reasoning_withheld`), and the file's notes count those steps.
- Results now say whether a call failed in `extra.tool_result_is_error`, the name Harbor's tools read, in place of `extra.failed`, which is no longer written. It is `true` when the reader found the call failed, `false` when it found no failure, and left out when it cannot tell, such as for a call still running.
- Claude Code helper steps carry `extra.agent_id` (the helper's id) and `extra.is_sidechain` (`true`), and the main session's steps carry `extra.is_sidechain` as `false`. Each Claude Code call that has an input repeats it, as the agent sent it, in `extra.raw_arguments`.
- A background update's step now carries its start time (`timestamp`), where it had none.

## 1.1.0

A status line at the foot of the pane, prompts that keep their line breaks, and a way to save a session in a standard format. It also fixes highlighting, long transcripts and short panes. It needs the same Herdr and tools as 1.0.0.

### The chat view

- Your prompts keep their line breaks. A closed bubble draws each line on its own row, where 1.0.0 ran them together into one paragraph. With Shorten long messages off (the default), a closed bubble is as tall as the prompt's lines, so a pasted list makes a taller bubble than before.
- Pasted terminal output reads as a block: a quiet "Pasted · 12 lines" label, then each line in a fixed-width font. Lines are cut at the bubble's edge, not wrapped, so a table's columns stay lined up. Open the turn to see the paste as one code block.
- A transcript line too long to read (over 64 MB) now leaves a dim line in the list where it was, such as "A line of 70 MB was left out here, too long to read". Before, nothing showed.

### The status line

- A slim line at the bottom of the pane shows the session's turns, hidden turns and tool calls. For agents that record usage (Claude Code, Codex, OpenCode, Pi and Antigravity) it also shows tokens, the cache hit and how much context the newest reply used. It is on by default. To turn it off, open Settings and switch off "Chat stats at the bottom" under Layout.
- For Codex, which says how large its model's context window is, a small ring shows how much of the window is used: "◔ 51.7k context · 20%".

### Settings and keys

- The foot of the settings card shows the version you are running, such as "Agent Threads 1.1.0", so you can compare it with the latest release. Nothing checks for updates.
- When a link rule cannot be saved, the open rule says why under its buttons. Before, the reason showed only on the File line at the bottom of the page, which could be out of view.
- In the keys sheet (`?`), "Scroll it a page" fits PgUp, PgDn and Space on one line in a pane at least 520 px wide. In a Herdr that can keep a scrollbar drawn, the sheet shows one whenever there is more below; otherwise it shows while you scroll.

### Save a session as ATIF

You can write a session out as an ATIF trajectory (Agent Trajectory Interchange Format, version 1.7, the format the Harbor project uses). The file holds every step, each tool call with its result, subagents nested inside, and token counts. It runs on your computer and sends nothing. There is no button for it in the pane yet. From a clone of this repository, with [Bun](https://bun.sh):

```sh
bun mods/agent-threads/core/atif.js ~/.claude/projects/<folder>/<session>.jsonl > session.json
```

For another agent, put its name after the path: `codex`, `pi`, `cursor` or `antigravity`, or `opencode` with `<database>#<session id>` in place of the path.

### Fixes

- A double press on a word in a closed turn selects the word, where it used to open the turn.
- The list no longer jumps in the rare case where you start a highlight at the same moment a reply grows.
- Characters such as an em dash or a box-drawing line no longer turn into "��" partway through a long prompt, reply or tool output.
- On some Linux systems (Ubuntu 26.04 among them), a prompt or reply of several megabytes no longer goes missing or shows empty.
- The settings card stays inside a short pane with its foot in view, and it no longer grows when you make the pane smaller.
- A link rule is no longer turned off as too slow because the computer was busy for a moment.
- Pasted output no longer shows a leftover closing tag at the end of its last line.

## 1.0.0

The first release of Agent Threads, a [Herdr](https://herdr.dev) mod. It opens a pane beside a coding agent's terminal and shows the session as a chat, so you can find an earlier answer without scrolling back through the terminal. It reads the session on your computer and sends nothing over the network.

It needs the Herdr app and `jq`. Some agents need a few more command-line tools, listed in [Install in detail](usage.md#install-in-detail). A few features need a newer Herdr: drag to highlight needs 0.1.13, the rail card and the Turn card beside its icon need 0.1.15, and quoting a highlight without `Cmd-C` needs 0.1.16.

### The chat view

- Each prompt you sent is a bubble on the right, with the reply under it and a line between that says how long the agent worked. A band marks each day, and while you scroll a pill at the top names the day you are in.
- Messages and replies show in full. Turn on Shorten long messages to show the first lines of each, with Show more.
- Text is set for reading: about 70 characters a line by default, with Wide (90) and Full as choices. The pane opens at that width.
- Open a turn to read the whole reply as Markdown, and a background update after it (LATEST UPDATE) formatted the same way. Code blocks wrap, show their first 12 rows with Show all for the rest, and are coloured by language. A table can run wider than the reading line when the pane has room.
- Click a turn's "Worked for" line to see the agent's work before the reply: what it said along the way and each run of tool calls. Open a run to see each command, file or search, and a call to see its output. `→` and `←` open and close the work a level at a time.
- The Turn card (`i`, or rest the pointer on the info icon) shows a turn's model and effort, tokens, tool calls and cache hit.
- Drag across any turn's text, open or closed, to highlight it. `s` shows the reply's Markdown source for selecting.
- The top left of the pane shows whether the agent is working, needs you, is done or has exited, and a click there goes to the terminal. Search, Pinned and Settings sit at the top right while the pointer is in the pane.
- At the bottom the list follows new turns. Scroll up and it stays still; a Jump to latest pill brings you back. Highlighting text also stops following, so a reply coming in does not move the text from under the pointer.

### The rail

- A tick for each turn on the list's edge, in place of the scrollbar.
- Point at a tick for a card with the turn's day, time, number, prompt and reply. `p` pins that turn while the card is open.
- Click a tick to go to the turn. It lands level with the tick and flashes for a moment.
- In a long session the rail shows a window of ticks that follows the list, and the wheel on the rail moves the window.
- The rail can sit on the left or the right, and a narrow pane hides it.

### Search and outline

- `/` narrows the list to the turns that match. `#12` in the search, or `g`, goes to a turn number.
- `[` and `]` move a day at a time.
- `o` shows the outline: one row per turn, so a long session fits on a few screens.

### Pins

- `p` pins up to five turns. They show in a Pinned column beside the list, oldest first, numbered 1 to 5.
- `1` to `5` return to a pin, and a second press returns to where you were reading in it.
- `u` undoes an unpin. `-` and `=` make the column narrower or wider.
- In a narrow pane the pins show in a Pinned view in the same pane.
- Pins are kept per session across restarts, in a file in Herdr's data folder.

### Copy and quote

- `c` copies the reply as Markdown.
- `q` quotes the reply into the terminal's input as a `>` quote, with a blank line for your comment. Threads never presses Enter.
- To quote part of a reply, highlight it and press `Cmd-C`, then `q`. On Herdr 0.1.16, `q` in Select view quotes the highlight with no `Cmd-C`.

### Agents and subagents

- Reads Claude Code, Codex, OpenCode (1.x and 2.x), Pi, Cursor and Antigravity, each shown with its own mark. [Which agents it reads](agents.md) lists what each one records.
- Finds sessions that another process holds: Codex's app-server daemon, `claude attach` and `opencode attach`.
- Amp keeps its chats on its own servers, so the pane says why it cannot read them.
- Subagents get a line of their own in a turn's work. For Claude Code it says how many are working or failed, and each subagent shows whether it is back, how long it took and its model when it is not the turn's.
- `a` shows or hides messages other agents sent the session. While they are hidden, a message the agent replied to on its own folds to one line over that reply.

### Viewers

- The image viewer: click a pasted image's tile on any turn. The image fills the window with your prompt and the reply beside it, and `←` `→` step through the images.
- The output viewer: a command's output over 400 lines opens over the window with numbered lines.
- The diagram viewer: a Mermaid block has View diagram under it, which draws the diagram as text.

### Settings

- `,` opens the settings card, one page that scrolls, with a strip of the list left in view under it. A change shows in the list behind the card. The arrows, `j` and `k`, `Page Up`, `Page Down`, `Space`, `Home` and `End` scroll the card (Herdr 0.1.15 or newer), and its scrollbar shows all the time when there is more below.
- Messages: text size, the user message colour, Shorten long messages and how many lines it shows, and always show time.
- Agent messages: show agent messages, agent messages on the rail, and the agent message colour.
- Layout: the reading width and whether the pane keeps it, rail side, and key hints at the bottom (off by default).
- Links and keys: link rules and the quote key. File: the settings file's path. Then Reset to defaults.
- User messages are blue by default and agent messages amber. A colour you already chose is kept.
- `Shift-W` steps the reading width through Comfortable, Wide and Full.
- Settings are saved in Herdr's data folder, so installing again or updating never touches them.

### Links

- Link rules turn text such as ticket keys and PR numbers into links in an open turn.
- A link rule links text in replies and in plain bubbles. A coloured bubble (blue for your messages and amber for agent messages by default) draws its text as plain lines, since Herdr draws linked text only in the theme's text colour. So in an open turn the links its rules make are listed on a line of their own under the bubble: each once, at most 8, none from code (issue 116). Collapsed rows carry no links.
- Add, edit and delete rules on the settings card: Custom, Ticket key or Pull request, with what the rule finds, what it opens and an example. Each rule has a switch, and Delete has Undo.
- The pull request rule is on after a fresh install. It links `#58` to the session's repository when that repository is on GitHub.
- Rules are checked for patterns that would be slow, and a rule that is slow on a reply is skipped and marked as not working.

### Thanks

- [bet4it](https://github.com/bet4it) made Threads find a running Antigravity session from the lock file `agy` holds open (PR 39).
