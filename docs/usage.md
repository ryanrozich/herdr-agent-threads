# Using Agent Threads

Every behaviour of the pane in detail. The [README](../README.md) has the short version: install, the chord, the keys and the settings.

## In the pane

- Each turn reads like a chat. Its number and time sit above, at the right. Your prompt is a bubble on the right, at most 82% of the pane's width (90% under 320 px), and the reply is plain text under it, across the pane. Its time, tokens, model and tool calls are one mono line below. A collapsed turn shows 4 lines of your prompt and 6 of the reply, then "Show more" (see [Settings in detail](#settings-in-detail)). A turn still running shows a clock by its number, "No reply yet" with the time so far, and the work done so far. A day band, a centred date between two hairlines, starts each day.
- `↑`/`↓` (or `j`/`k`) move, `Enter` opens a turn, `c` copies its reply as Markdown, `/` filters, `g` jumps to a turn number, `End` goes to the newest.
- `a` shows or hides **agent messages**: turns another agent sent this session (an hc report or request, a peer session's message, a scheduled prompt, the SDK). They are hidden by default. Shown, each sits on the left in an outlined bubble and names its sender in the theme's `ansi5` colour (purple in most themes) ("t7 review · hc report", "helper-a · agent message"). The header and the Agents button say how many are hidden (both count every session in the list). When Claude answers your prompt and an agent message in one reply, that reply lands on the agent message; while agent messages are hidden, your row shows and copies it, and the card says "shared with agent message #N". A slash command another sender ran counts as theirs, not yours. Task notifications are not agent messages: they stay folded into the turn above as "background updates" (the bell count), and a card shows the latest thing one of them said.
- `t`, or the **Terminal** button in an open turn, focuses the terminal pane this Threads pane reads (the one beside it; if the terminal moved to another tab, it goes there and says so). It cannot scroll the terminal to the turn you are reading. Hover the Claude badge to see which terminal and session the pane is bound to. After you exit claude and resume it in the same terminal, the pane follows the resumed session; resumed in another terminal, it says "claude exited" and stays on its own terminal.
- Times read "9:05 AM". An open turn's stats line reads "12.4k tokens", the duration, "opus 5.5 · high", "9 tool calls", "cache hit 99.6%" (the share of the turn's prompt read from cache, floored to one decimal) and "context compacted" when the conversation was summarised during the turn; the raw cache counts are on a second line under it, and the Claude badge's tooltip gives the session's and the selected turn's counts. No cost is shown.
- `i`, or a click on the info icon at the end of the stats line, explains it: a legend under every open turn's stats, with one plain sentence for each figure that turn shows, "context compacted" first. `i` again hides it. The footer shows "i explain" while a turn is open, from 300 px.
- The open card is built to draw as one continuous card at any width and zoom. Its text is measured as Herdr draws it, so a reply shows from its first word to its last with nothing cut and no scroll inside the card; LATEST UPDATE shows up to 6 whole lines and Show all for the rest. A code block shows up to 12 lines at 20 px each and scrolls inside the block past that. Seen drawn on a test window (synthetic transcript) at 240, 380 and 640 px, at zoom 0.9 and 1, dark and light: the card is one piece with nothing cut, and opening a card scrolls it fully into view when it fits. The debug report's `parts` (each part's estimate, measure and slot) shows how a card was sized.
- A large transcript reads in 2 MiB steps, and the header says "Reading… 42%" (just "Reading…" until the first step is in). A read that stops before it finishes picks up again by itself after 4 s (30 s while the extractor is still running), from where it was or, if it stopped halfway through a step, from the top; a session already shown keeps its turns, and a computer that slept is not taken for a stall. If it stops again the pane says "Couldn't read this session" (or "Read failed" in the header) with **Retry**.
- Slash commands show as the command's name in a quiet mono face ("/review-pr", muted, no fill) followed by their arguments. Where the theme's muted colour reads under 4.5:1 on the row (the selected row in every bundled theme), the name is drawn in the text colour.
- A prompt that quotes earlier text with Markdown `>` lines shows the quote with a bar and in a muted colour, and your own words under it in full. A collapsed row gives the quote one line within its Prompt lines and always shows the first line of your comment; the open card draws the prompt as Markdown, with up to 2 lines per quote and Show all for the rest (up to 200,000 characters of a prompt; past that it says how many are left out). A fenced code block's `>` lines are code, not quotes.
- **Pasted images.** A prompt with pasted images shows them as 64 × 40 thumbnails under the prompt (from 300 px; narrower, an image count in the row's top line), and the open turn shows each one under your bubble at the pane's text width, up to 260 px tall, with its `[Image #N]` label and size; a click shows it at full size, and again folds it. Images are decoded from the transcript only when their turn is first drawn, one prompt at a time, into the mod's data folder (`~/.config/herdr-app/data/agent-threads/images/<session>/`), which is kept across installs and trimmed to 200 MB, least recently shown first. Link rules never turn an `[Image #N]` label into a link.
- `s`, or the **Select** button, turns the open reply into selectable text (the Markdown source): drag to select, `⌘C` copies, `s` or `Esc` returns to the formatted reply (also after `↓` or `↑` moved to another turn). The first click on a formatted reply says so. On Herdr 0.1.13 or newer you can also drag across the formatted reply. A drag can cross paragraphs, but not into a code block.
- `q`, or the **Quote** button, quotes the open reply into the terminal's input as Markdown (`> ` before each line, then a blank line), ready for you to type below it. In Select view, highlight part of the reply, press `⌘C`, then `q`: it quotes what you copied. A mod cannot read the editor's highlight or make it copy, so the `⌘C` is needed. When the clipboard holds nothing from this reply, `q` there pastes nothing and says "Couldn't read the highlight, press ⌘C then q"; it never falls back to the whole reply. See [Quoting into the terminal](#quoting-into-the-terminal).

## Pins

`p` pins the selected turn, or unpins it. The header's pin button does the same, and so does the pin at the right of a turn's top line. A pinned turn stays in the list, with a pin and its pin number in its top line.

`v`, or the header's list button, shows the pins. From 600 px wide the pane splits: a Pinned pane opens to its right at half the width, showing only the pinned turns in pin order, each drawn as in the list with its pin number. `v` again, in either pane, focuses the Pinned pane or goes back to the list, and closing the Pinned pane works like closing any pane. Under 600 px there is no room to split, so the same pane switches to the Pinned view with the toast "Pinned shows here: the pane is too narrow to split", and `v` switches back. With no pins the Pinned view says how to pin a turn. A pinned turn that is gone from the session shows as "no longer in this session", and a click on it unpins it.

`1` to `5` open that turn. A return puts the turn's head at the top of the pane: its number, then your message, so the top of the pane matches the turn's row in the Pinned view. When your place in the turn is further down, a note says to press the number again, and a second press before you scroll opens the turn at your place. Your place is the block of text at the top of the pane when you last read the turn while it was selected. Scrolling down past the turn does not move it onto the stats or the buttons. The second press opens at the start of the block, under a line in the accent colour, "#8 starts above · show the prompt". A click on that line shows the turn from its head, and the line goes when you select another turn. A block of text is one item however tall, so a drag can cross its paragraphs, and in a long block you land at the start of the block, not on the line you were reading. Herdr lets a mod scroll only to the top of an item, so it cannot get closer. Near the end of the list the list cannot scroll that far, so your place can sit lower on screen. Moving to another turn does not change a pin's place.

A sixth pin says "Pins are full (5). Unpin one first." Unpinning says "Unpinned #7 · u to undo", and `u` puts back any unpinned turn while the pane is open, newest first, in the same place.

While the cursor is in the search field, `p` and digits type. `Enter` or a click on a result gives the keys to the list, with the search kept. A return to a turn the search hides shows it with "Pinned, not in this search", until you select another turn.

Pins follow the session: closing the pane, restarting Herdr and resuming keep them, and two panes on one session share them within a few seconds. A fork has none. After `/clear`, a pane that shows both sessions shows both sets, up to five.

## Quoting into the terminal

This is the one time Threads writes to a terminal. It puts the quote on the clipboard, focuses the bound terminal's pane, checks Herdr reports that terminal focused, and runs Herdr's paste (the `⌘V` command). The agent turns on bracketed paste, so the quote arrives as one paste, and nothing is ever submitted: no Enter or other key follows. Before the paste Threads strips control characters, carriage returns and stray paste markers from the text, and caps the quote at 40 lines ("Quoted the first 40 lines") or 2,000 characters. At the character cap, the line that does not fit is cut at a word and ends in "…" ("Quoted the start · cut at 2,000 characters"), so a long paragraph is quoted in part and never dropped.

It pastes only when the terminal is local, open, shown in a pane and running `claude`, `codex` or `opencode`, and the agent is not waiting on a permission prompt. Otherwise the quote stays on the clipboard and a toast says why ("t4 is at a shell. Quote copied.", "Claude is waiting on a prompt in t4. Quote copied."). While Claude is working the paste still goes in, and Claude queues it ("Quoted into t4 · Claude will queue it"). A second press within a second, or a held key, does nothing. Focus moves to the terminal, so the next keys you type go there.

Claude Code folds a paste over 800 characters or 2 lines into "[Pasted text #1 +N lines]"; the toast then says "⌘V again shows it in full", because pasting the same text again expands it.

OpenCode folds a paste of three lines or more, or over 150 characters, into "[Pasted ~N lines]", and Codex folds a long one into "[Pasted Content N chars]". Both send the whole quote when you submit. OpenCode trims the blank line under a folded paste, so Threads ends that quote with one zero-width space and your reply still starts below it. Codex and OpenCode report no status to Herdr here, so the "will queue it" toast does not appear for them.

## Codex and OpenCode

The README's [Which agents it reads](../README.md#which-agents-it-reads) has the table of what works on each. A few details:

- **Codex** has no session file until the first prompt, so the pane says it is waiting. After `/new` it follows the new rollout and draws a "New session" divider, and turns from the earlier session stay above it. A subagent's messages appear under `a`.
- **OpenCode** sessions come from the terminal title `OC | <title>`, then `-s <id>` on the command line, then the folder. A new OpenCode in a folder waits for its first prompt rather than showing an older session. With a second OpenCode in the folder and no title to match, the header says "guessed" and **Choose** lists sessions by title or first prompt. A pick stays until you close the pane.
- OpenCode's own terminal title can be cut with "…"; the pane matches on the part it can see, and refuses a title that fits two sessions.


## Settings in detail

`,` (or the sliders button) opens the settings panel: Agent messages on or off, and how many lines of prompt and of reply a collapsed row shows. It also shows how many link rules the file holds (and how many are not valid), the quote key, and a note for each rule or key it could not use. Changes apply at once and are saved to

```
~/.config/herdr-app/data/agent-threads/settings.json      ($HERDR_APP_HOME/data/agent-threads/ with HERDR_APP_HOME set)
```

```json
{ "promptLines": 4, "replyLines": 6, "agentTurns": false }
```

| Key | Default | Range |
|---|---|---|
| `promptLines` | 4 | 1 to 10 lines of prompt in a collapsed row |
| `replyLines` | 6 | 1 to 12 lines of reply in a collapsed row |
| `agentTurns` | false | true shows agent messages |
| `quoteKey` | `"q"` | one lowercase letter a–z that Threads does not already use (not a, c, g, i, j, k, o, s, t or v); anything else falls back to `q` with a note |
| `links` | none | link rules, below |

The panel also writes `"look": 2`. A file without it that holds `promptLines` 2 and `replyLines` 3, the old defaults, reads as 4 and 6, so the new look starts with the new defaults. Any other values you chose are kept.

`quoteKey` and `links` are edited in the file only. The panel never rewrites them: a save from the panel keeps them exactly as you wrote them.

### Link rules in detail

Each rule turns text that matches a pattern into a link in an open card: in the reply and in your prompt. Collapsed rows stay plain text. No rules ship; add your own, for example:

```json
{
  "links": [
    { "name": "Issue", "pattern": "\\bACME-(\\d+)\\b", "url": "https://linear.app/acme/issue/ACME-$1" },
    { "name": "PR", "pattern": "(?<![\\w&/#])#(\\d{1,5})\\b", "url": "https://github.com/{repo}/pull/$1" }
  ]
}
```

- `pattern` is a JavaScript regular expression (JSON-escaped, so `\\d` for `\d`). `$0` in the URL is the whole match and `$1` to `$9` its groups; each is URL-encoded, so a match cannot change the link's host or path segments.
- `{repo}` (`owner/name`) and `{owner}` come from `git remote get-url origin` in the terminal's folder. With no `origin` there, rules that use them are skipped. On a fork, `origin` is your fork, so PR links point at it, not at the upstream repository.
- Links apply only to prose: never inside code spans (also one that runs over a line break), fenced code blocks (also in a blockquote or a list item), indented code, existing links or URLs, and the PR example above skips colours such as `#123456`. The first rule that matches at a place wins. A reply is scanned up to 20,000 characters and 25 links, and a match over 80 characters is left alone.
- A rule is dropped, with a note in the settings panel, when it has no pattern or URL, the pattern is over 200 characters, does not compile, matches empty text, uses a backreference, a nested quantifier such as `(a+)+` or an alternation under a quantifier such as `(a|aa)+`, or is slow on test texts of growing length (up to 33 characters); when the URL is not `https://` or `http://` with a fixed host (placeholders only in the path); and past the 20th rule. Changes apply about a second after you save the file. These checks are a guard, not a proof: a pattern that is slow only on long text, such as `\d+\d+\d+y` on a long run of digits, can still pass, so keep patterns short and literal (an ID prefix, then digits).

You can edit the file by hand; open Threads panes pick up a save within a second. Values out of range are clamped, and a file that is not valid JSON leaves the defaults in place (the settings panel says so). While the file does not parse, Threads never writes it: a change made in the panel applies in the pane only, and the panel says the file was left as it is, so a hand edit in progress is never wiped. The file lives in Herdr's data folder for this mod, outside `mods/`, so `./install.sh` and updates never touch it. Apart from the image cache beside it (`images/`, trimmed to 200 MB), it is the only file Threads writes.

