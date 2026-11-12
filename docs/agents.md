# Which agents it reads

Agent Threads reads the session each agent keeps on your computer. This page lists what it can show for each agent, and why some features are missing for some of them. The [README](../README.md) has the short version.

## What each agent records

Tested on Claude Code 2.1.318, Codex CLI 0.160.0, OpenCode 1.19.5 and 2.2.5, Pi 1.5.0 (the terminal agent, not Pi Durable), the Cursor agent CLI 2026.11.05, and the Antigravity CLI (`agy`) 1.5.3. OpenCode 2.x moved its sessions to new tables, and the pane reads whichever the database has. None of these formats is a public promise, so a new version can change what the pane finds.

| | Claude Code | Codex | OpenCode | Pi | Cursor | Antigravity |
|---|---|---|---|---|---|---|
| Prompts, replies, search, copy, quote, links | Yes | Yes | Yes | Yes | Yes | Yes |
| Pasted images | Yes | Yes | Yes | Yes, while the temporary file Pi saved is on disk | No, the word `[Image]` shows in their place | No |
| Tokens, time, model, tool count, cache hit | Yes | Yes | Yes | Yes | Tool count, and the time of a turn the pane watched. No tokens, model or cache | Yes, with the model you chose in agy |
| Agent messages | Yes | Yes | No | No | No | No |
| Reads its session from | A JSONL file | A JSONL file | A SQLite database, read-only | A JSONL file | A JSONL file | A JSONL file |
| Finds the terminal's session by | The process's session record, or for `claude attach` the background session's record | The file the process has open, or the one Codex's app-server daemon has open for its folder | The terminal's title, then its folder (for `opencode attach`, the server's folder or `--dir`) | Its command line, then its folder | The chat the process has open, then its command line, then its folder | The conversation folder the process has open, then its command line |

Where an agent has no data, the pane leaves the feature out:

- **OpenCode has no agent messages.** Its subagents run as separate sessions, so nothing arrives in the session you are reading, and the agents button and `a` hint stay hidden.
- **Pi has no agent messages** either: it has no subagents of its own. Nor do Cursor's or Antigravity's records.
- **Pi pastes an image as a file path.** `Ctrl-V` in Pi saves the image to a temporary file and puts its path in your prompt. The pane shows `[Image #1]` in place of that path and the image as a thumbnail, after checking the file starts like a PNG, JPEG, GIF or WebP. It reads only files named `pi-clipboard-<id>` in the temp folder, the name Pi gives them. The pane keeps its own copy once shown. If macOS or a reboot clears the file before then, the open turn shows its path with "Image no longer on disk".
- **Cursor records no tokens, model or turn time.** The pane leaves out tokens, model and cache. A turn shows a time only when the pane watched it run, from when Cursor wrote the prompt (a few seconds after you sent it) to the turn's end. A turn read from the file later shows none. A prompt's clock time is Cursor's own, to the minute.
- **Cursor keeps no pasted image in its transcript.** It writes the word `[Image]` where the image was, and the pane shows that word.
- **Cursor joins thinking onto the reply.** Thinking it hides is the word `[REDACTED]` after the reply, and the pane drops it. Thinking it keeps has no mark that tells it apart from the reply, so the pane shows the reply as Cursor stored it. In testing, Composer's thinking was hidden and Grok 4.7 stored none.
- **A Codex, OpenCode or Pi turn with no usage on record**, such as one you stopped right away, shows no token count. Claude Code's cards still show theirs.
- **Antigravity keeps no pasted image the pane can read.** Its prompts show as text.
- **Antigravity's `--remote-agent` runs the conversation on a remote agent.** Its transcript is not on this computer, so the pane cannot find it.
- **Codex, OpenCode, Pi, Cursor and Antigravity report no status to Herdr here**, so the pane looks for a new session every 3 seconds, and a quote pressed while they work has no "will queue it" message.

Some behaviour differs by agent:

- **OpenCode shares one database between terminals and records no process for a session.** The pane reads `OC | <title>` from the terminal. Otherwise it takes the folder's session whose turn began last since that OpenCode started, which is exact while one OpenCode runs in the folder. OpenCode 2.x's background `opencode serve` does not count as a second one. Until a session has a title, or when two sessions in the folder share one, a second OpenCode in the same folder makes the pane say "guessed" and offer **Choose**. Its guess can be the other terminal's session, so check it when that banner shows.
- **Quotes fold in OpenCode and Codex.** OpenCode shows a paste of three lines or more as `[Pasted ~N lines]`, and Codex shows a long one as `[Pasted Content N chars]`. The whole quote goes in when you submit. For OpenCode's folded paste the quote ends with one zero-width space, because OpenCode trims the blank line that keeps your reply out of the quote.
- **Plain `codex` can run its session in Codex's app-server daemon.** `codex --no-daemon` keeps the session file open in the terminal's own process. Plain `codex` uses the shared app-server daemon when one is running, and then the daemon holds the file. The pane then takes, from the files Codex's app servers hold, a terminal session (not the ChatGPT app's threads, not a subagent's) in the terminal's folder that began after that Codex started, the newest written, so `/new` moves it on. A Codex with no session yet waits for its first prompt; an older session counts only after `codex resume`. With another Codex in the same folder the pane cannot tell whose session is whose, so it says "guessed", offers **Choose**, and stays on the session it shows. The badge's tooltip shows the step as "Session file the Codex daemon has open".
- **`claude attach` writes no session record.** A session started with `claude --bg` runs in its own background process, and `claude attach <id>` opens it in a terminal. The pane finds the session through the background session's own record, while its process runs: by the id's start, else its whole name, else the one name that holds the words you typed.
- **`opencode attach <url>` reads a server's sessions.** OpenCode keeps them under the folder the server runs in, or under `--dir`, not the terminal's folder. The pane uses `--dir`, else the folder of the OpenCode server listening on that port on this computer. A server on another computer keeps its database there, so the pane cannot read it.
- **Pi records no process for a session either.** The pane takes `--session` from Pi's command line, else the session in the folder that Pi wrote last since it started. With two Pi terminals in one folder that is a guess with **Choose**, as for OpenCode.
- **Pi's `/tree` branches stay in the list.** Pi keeps a branch you left in the same file, and the pane reads the file in order, so both branches' turns show.
- **Cursor is found by the chat it has open.** Cursor keeps each chat's database open, and the file's path names the chat. The pane reads that path and never the database. A new chat (`/clear`) opens its database with its first prompt, so until then the pane stays on the chat before it. Without an open chat the pane takes `--resume <id>` from Cursor's command line, else the folder's newest chat since Cursor started.
- **Cursor sometimes writes its whole file again.** After `Esc`, for example, it writes the chat again from its own records, keeping only the last turn's end, and the pane reads the file again from the top. If you press `Esc` before Cursor has written your prompt, Cursor drops that prompt and marks the turn before it as stopped, so the pane shows that turn as stopped.
- **Antigravity is found by the conversation it has open.** `agy` keeps the conversation's folder open (`~/.gemini/antigravity-cli/brain/<id>`), and the pane reads `transcript_full.jsonl` in it, the copy that keeps long replies whole. A new conversation writes its file with the first prompt. Without an open folder the pane takes `--conversation <id>` from the command line. The model is the one agy records when you choose it, with its level, such as "Medium".
- **OpenCode's `/undo` shows late.** The pane keeps an undone turn until OpenCode deletes it, at your next prompt.

## Why Amp isn't supported

Amp keeps its conversations on its own servers, not on disk. Reading them would mean calling Amp over the network every time the pane refreshes, and Agent Threads only reads local files. In an Amp terminal the pane says so and links to the same section in the [README](../README.md#why-amp-isnt-supported).
