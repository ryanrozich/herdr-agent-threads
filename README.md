# Agent Threads

Long agent sessions are hard to look back through. The answer you got an hour ago sits under pages of tool calls and status lines, and finding it means a lot of scrolling. Agent Threads opens a pane beside your Claude Code terminal that shows only the conversation: each prompt you sent and the answer that came back.

![Agent Threads beside a Claude Code terminal](preview.png)

## What you can do

- **Find an answer fast.** Scroll the list or press `/` to search. Each row shows your prompt, the start of the reply and when it happened, so you can see when you last asked for an update.
- **Read the whole reply.** Press `Enter` on a row to open it. Code, lists and quotes show as formatted Markdown, along with the turn's tokens, time and model.
- **Copy it.** `c` copies the reply. Each code block has its own copy button.
- **Quote it back.** `q` pastes the reply into your prompt as a `>` quote with a blank line under it, ready for your comment. To quote one part, press `s`, highlight the text, press `Cmd-C`, then `q`. Agent Threads never presses Enter for you.
- **Show or hide agent messages.** `a` shows or hides the messages other agents sent the session, such as a subagent's report or another session's message.
- **See the images you pasted.** Rows show small thumbnails. An open turn shows them larger, and a click shows one full size.
- **Turn ticket and PR numbers into links.** Add a rule in settings, for example `ACME-123` to your tracker or `#456` to the repo's pull request.
- **Choose how much each row shows.** Settings decide how many lines of your prompt and of the reply a row shows before you open it.

## How it works

Press `Cmd-Shift-T` in a Claude Code terminal. Agent Threads opens to its right and keeps up with that session as it runs. Press it again to move between the pane and the terminal. Every terminal can have its own Agent Threads pane, and each pane follows only its own session.

Agent Threads reads Claude's session file on your computer. It sends nothing over the network, and it never types into your terminal except when you press `q` to quote.

## Screenshots

Select an image to open it full size. The session in these shots is made up.

<table>
<tr>
<td width="50%" valign="top"><a href="docs/screenshots/open-turn.png"><img src="docs/screenshots/open-turn.png" alt="An open turn with a list, a code block and stats"></a><br>An open turn shows the formatted reply, a copy button on the code block, ACME-123 and #42 as links, and the turn's tokens, time and model.</td>
<td width="50%" valign="top"><a href="docs/screenshots/search.png"><img src="docs/screenshots/search.png" alt="The list narrowed by a search for tests"></a><br>Typing "tests" after <code>/</code> narrows six turns to three.</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="docs/screenshots/images.png"><img src="docs/screenshots/images.png" alt="A row with an image thumbnail and an open turn with the larger image"></a><br>A pasted image is a thumbnail on its row and larger in the open turn.</td>
<td width="50%" valign="top"><a href="docs/screenshots/agent-messages.png"><img src="docs/screenshots/agent-messages.png" alt="A subagent report as its own row in the list"></a><br>With agent messages on, a subagent's report gets its own row.</td>
</tr>
<tr>
<td colspan="2" valign="top"><a href="docs/screenshots/quote.png"><img src="docs/screenshots/quote.png" alt="The terminal prompt holding a quoted line, beside the pane"></a><br>After <code>q</code>, the prompt holds the reply as a <code>&gt;</code> quote, with the cursor under it.</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="docs/screenshots/panel.png"><img src="docs/screenshots/panel.png" alt="The Agent Threads pane on its own"></a><br>The pane on its own, with the newest turn open.</td>
<td width="50%" valign="top"><a href="docs/screenshots/light.png"><img src="docs/screenshots/light.png" alt="Agent Threads beside a terminal in the light theme"></a><br>The same session in Herdr's light theme.</td>
</tr>
</table>

## Install

Needs the [Herdr](https://herdr.dev) app (built on 0.1.12), `jq`, and Claude Code. Besides `jq` it runs its own `sh` scripts, `hc` and `git remote get-url origin` (for link rules).

```sh
git clone https://github.com/ryanrozich/herdr-agent-threads
cd herdr-agent-threads
./install.sh     # copies mods/agent-threads to ~/.config/herdr-app/mods/ and runs herdr-app check
```

Or copy `mods/agent-threads/` into `~/.config/herdr-app/mods/` yourself. Then merge [keys.json](keys.json) into `~/.config/herdr-app/keys.json` for the chord:

```json
{ "global": { "cmd-shift-t": "mod.open:agent-threads" } }
```

Without the chord, `herdr-app do mod.open --name agent-threads` opens it.

## Keys

| Key | What it does |
|---|---|
| `↑` `↓` or `j` `k` | Move between turns |
| `Enter`, `Space` or `o` | Open or close a turn |
| `c` | Copy the reply |
| `q` | Quote the reply into the terminal |
| `s` | Select view: highlight part of the reply, `Cmd-C`, then `q` |
| `/` | Search |
| `g` | Jump to a turn number |
| `End` or `G` | Newest turn |
| `[` `]` | Previous or next day |
| `t` | Focus the terminal |
| `a` | Show or hide agent messages |
| `i` | Explain the stats on an open turn |
| `,` | Settings |
| `Esc` | Back out: search, Select view, settings, the open turn |

## Settings

`,` opens the settings panel. It saves to `~/.config/herdr-app/data/agent-threads/settings.json`, which you can also edit by hand; open panes pick up a save within a second.

| Key | Default | What it sets |
|---|---|---|
| `promptLines` | 2 | Lines of your prompt a row shows (1 to 6) |
| `replyLines` | 3 | Lines of the reply a row shows (1 to 8) |
| `agentTurns` | false | Show agent messages |
| `quoteKey` | `"q"` | The quote key: one lowercase letter the pane does not already use |
| `links` | none | Link rules, below |

### Link rules

A rule turns text that matches a pattern into a link in an open turn. No rules ship. For example:

```json
{
  "links": [
    { "name": "Issue", "pattern": "\\bACME-(\\d+)\\b", "url": "https://linear.app/acme/issue/ACME-$1" },
    { "name": "PR", "pattern": "(?<![\\w&/#])#(\\d{1,5})\\b", "url": "https://github.com/{repo}/pull/$1" }
  ]
}
```

- `pattern` is a JavaScript regular expression, JSON-escaped. `$0` in the URL is the whole match and `$1` to `$9` its groups.
- `{repo}` and `{owner}` come from the terminal folder's `git remote get-url origin`.
- Links skip code, existing links and URLs. A rule that is invalid or could be slow is dropped with a note in the settings panel.

[docs/usage.md](docs/usage.md) has the full rules, limits and every behaviour in detail.

## License

[MIT](LICENSE).

## More

- [RECIPE.md](RECIPE.md): what the pane draws and how it is built, the brief another agent can build it from.
- [docs/usage.md](docs/usage.md): every behaviour in detail.
- [docs/develop.md](docs/develop.md): tests, synthetic fixtures and trying it in a separate Herdr window.
- [docs/listing.md](docs/listing.md): what the herdr.dev/mods listing reads, and how to rename the mod.
