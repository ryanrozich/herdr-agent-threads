# Agent Threads 1.0 (draft)

The first release of Agent Threads, a [Herdr](https://herdr.dev) mod. It opens a pane beside a coding agent's terminal and shows the session as a chat, so you can find an earlier answer without scrolling back through the terminal. It reads the session on your computer and sends nothing over the network.

It needs the Herdr app and `jq`. Some agents need a few more command-line tools, listed in [Install in detail](usage.md#install-in-detail). A few features need a newer Herdr: drag to highlight needs 0.1.13, the rail card and the Turn card beside its icon need 0.1.15, and quoting a highlight without `Cmd-C` needs 0.1.16.

## The chat view

- Each prompt you sent is a bubble on the right, with the reply under it and a line between that says how long the agent worked. A band marks each day, and while you scroll a pill at the top names the day you are in.
- Messages and replies show in full. Turn on Shorten long messages to show the first lines of each, with Show more.
- Text is set for reading: about 70 characters a line by default, with Wide (90) and Full as choices. The pane opens at that width.
- Open a turn to read the whole reply as Markdown. Code blocks wrap, show their first 12 rows with Show all for the rest, and are coloured by language. A table can run wider than the reading line when the pane has room.
- Click a turn's "Worked for" line to see the agent's work before the reply: what it said along the way and each run of tool calls. Open a run to see each command, file or search, and a call to see its output. `→` and `←` open and close the work a level at a time.
- The Turn card (`i`, or rest the pointer on the info icon) shows a turn's model and effort, tokens, tool calls and cache hit.
- Drag across any turn's text, open or closed, to highlight it. `s` shows the reply's Markdown source for selecting.
- The top left of the pane shows whether the agent is working, needs you, is done or has exited, and a click there goes to the terminal. Search, Pinned and Settings sit at the top right while the pointer is in the pane.
- At the bottom the list follows new turns. Scroll up and it stays still; a Jump to latest pill brings you back.

## The rail

- A tick for each turn on the list's edge, in place of the scrollbar.
- Point at a tick for a card with the turn's day, time, number, prompt and reply. `p` pins that turn while the card is open.
- Click a tick to go to the turn. It lands level with the tick and flashes for a moment.
- In a long session the rail shows a window of ticks that follows the list, and the wheel on the rail moves the window.
- The rail can sit on the left or the right, and a narrow pane hides it.

## Search and outline

- `/` narrows the list to the turns that match. `#12` in the search, or `g`, goes to a turn number.
- `[` and `]` move a day at a time.
- `o` shows the outline: one row per turn, so a long session fits on a few screens.

## Pins

- `p` pins up to five turns. They show in a Pinned column beside the list, oldest first, numbered 1 to 5.
- `1` to `5` return to a pin, and a second press returns to where you were reading in it.
- `u` undoes an unpin. `-` and `=` make the column narrower or wider.
- In a narrow pane the pins show in a Pinned view in the same pane.
- Pins are kept per session across restarts, in a file in Herdr's data folder.

## Copy and quote

- `c` copies the reply as Markdown.
- `q` quotes the reply into the terminal's input as a `>` quote, with a blank line for your comment. Threads never presses Enter.
- To quote part of a reply, highlight it and press `Cmd-C`, then `q`. On Herdr 0.1.16, `q` in Select view quotes the highlight with no `Cmd-C`.

## Agents and subagents

- Reads Claude Code, Codex, OpenCode (1.x and 2.x), Pi, Cursor and Antigravity, each shown with its own mark. [Which agents it reads](agents.md) lists what each one records.
- Finds sessions that another process holds: Codex's app-server daemon, `claude attach` and `opencode attach`.
- Amp keeps its chats on its own servers, so the pane says why it cannot read them.
- Subagents get a line of their own in a turn's work. For Claude Code it says how many are working or failed, and each subagent shows whether it is back, how long it took and its model when it is not the turn's.
- `a` shows or hides messages other agents sent the session. While they are hidden, a message the agent replied to on its own folds to one line over that reply.

## Viewers

- The image viewer: click a pasted image's tile on any turn. The image fills the window with your prompt and the reply beside it, and `←` `→` step through the images.
- The output viewer: a command's output over 400 lines opens over the window with numbered lines.
- The diagram viewer: a Mermaid block has View diagram under it, which draws the diagram as text.

## Settings

- `,` opens the settings card, one page that scrolls: Text and colors, Messages, Layout, Rules and keys, and File, then Reset to defaults. A change shows in the list behind the card.
- General: text size, rail side, key hints at the bottom, the User messages and Agent messages colours, link rules, the quote key and the settings file's path.
- User messages are blue by default and agent messages amber. A colour you already chose is kept.
- Chat: agent messages, Shorten long messages and how many lines it shows, always show time, the reading width and whether the pane keeps it.
- `Shift-W` steps the reading width through Comfortable, Wide and Full.
- Settings are saved in Herdr's data folder, so installing again or updating never touches them.

## Links

- Link rules turn text such as ticket keys and PR numbers into links in an open turn.
- A link rule links text in replies and in plain bubbles. A coloured bubble (blue for your messages and amber for agent messages by default) draws its text as plain lines, since Herdr draws linked text only in the theme's text colour. So in an open turn the links its rules make are listed on a line of their own under the bubble: each once, at most 8, none from code (issue 116). Collapsed rows carry no links.
- Add, edit and delete rules on the settings card: Custom, Ticket key or Pull request, with what the rule finds, what it opens and an example. Each rule has a switch, and Delete has Undo.
- The pull request rule is on after a fresh install. It links `#58` to the session's repository when that repository is on GitHub.
- Rules are checked for patterns that would be slow, and a rule that is slow on a reply is skipped and marked as not working.

## Thanks

- [bet4it](https://github.com/bet4it) made Threads find a running Antigravity session from the lock file `agy` holds open (PR 39).
