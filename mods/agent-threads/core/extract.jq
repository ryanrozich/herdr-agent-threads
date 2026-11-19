# agent-threads extractor: transcript lines in (one JSON string each, from lines.sh; whole lines only), compact events
# out, one JSON object per line, in file order:
#   p  prompt                           {o: origin kind, ts, t: text}; t only for own origins;
#                                       a peer's origin name as n ("general-purpose");
#                                       with pasted images also {img: [media types], u: line
#                                       uuid, ids: imagePasteIds} (the data stays in the file:
#                                       image.sh decodes a prompt's images when it is shown).
#                                       A prompt sent while Claude works is an attachment line
#                                       (queued_command), with no user line of its own.
#      slash command line               {cmd: true, o, ts, t: "/name args", u: line uuid}
#   b  a meta line, by its parent       {pu: parent uuid}: a skill or custom command's text
#                                       follows its command line this way; a local command
#                                       has no such line
#   i  "[Request interrupted"           {ts}
#   t  assistant text block             {t, ts}
#   u  tool call                        {n: tool name, id, ts, in: its input in up to 120
#                                       characters (the command, the path, the pattern)}
#   x  a call's result                  {id, ts, f: whether it failed}: extract.sh turns each
#                                       result line into a short "_x" line before jq, so a
#                                       result's text is never parsed
#   m  assistant usage, per message id  {id, m: model, e: effort, u: {i,o,cr,cc}, ts}
#      (once per message: on the apiBlockIndex 0 line; every block line repeats it)
#   e  synthetic or API error message   {t}
#   s  the model finished replying      {ts}: a final reply block, a synthetic or API error,
#                                       or a stop_hook_summary line
#   d  end of a model turn              {ms, ts}: Claude Code does not write this line for
#                                       every turn, so "s" is what closes a row
#   c  compaction                       {ts}
#   title  /rename title                {t}
#   an     the agent's name             {t}: an agent-name line, which Claude Code writes
#                                       again through the session
#   r  a subagent's launch result       {id: tool call id, a: agent id, m: model, st: status}
#                                       (async_launched, or a status when it ran in the
#                                       foreground); a teammate's start is left out
#   n  a task notification              {a: task id (a subagent's agent id), st: status, ms,
#                                       tok}, from a user line (which is also a "p") or a
#                                       queued one
# Thinking blocks, tool input past its summary, tool results' text and bookkeeping lines are
# dropped. Texts are
# capped at 200 KB so one chunk's output stays well under exec's 8 MiB limit.

def cap:
  if length > 200000 then .[0:200000] + "\n\n… (cut at 200 KB)" else . end;

def own($o): $o == "human" or $o == "peer" or $o == "scheduled" or $o == "sdk";

def text_of:
  if type == "string" then .
  elif type == "array" then [ .[]? | select(type == "object" and .type == "text") | .text ] | join("\n")
  else "" end;

# A prompt's pasted images, as metadata only: base64 data never leaves the file here.
def imgs($l; $c):
  if ($c | type) == "array" then
    [ $c[]? | select(type == "object" and .type == "image") | (.source.media_type // "") ] as $m
    | if ($m | length) > 0 then {img: $m, u: $l.uuid, ids: ($l.imagePasteIds // null)} else {} end
  else {} end;

def tag($s; $name):
  ($s | capture("<" + $name + ">(?<v>[\\s\\S]*?)</" + $name + ">")? | .v) // "";

# A subagent's launch result: its agent id and model, by the call's id. A teammate starts
# with another result and reports by message, so it is not one.
def launch($l; $c):
  ($l.toolUseResult) as $r
  | if ($r | type) == "object" and ($r.agentId | type) == "string" and ($r.status | type) == "string" and $r.status != "teammate_spawned"
    then ([ $c[]? | select(type == "object" and .type == "tool_result") | .tool_use_id ] | first // null) as $id
      | if ($id | type) == "string" then {k: "r", id: $id, a: ($r.agentId | .[0:80]), m: ($r.resolvedModel // null), st: ($r.status | .[0:40])} else empty end
    else empty end;

# A call's input in up to 120 characters on one line: the field that says what it does.
def brief:
  (if type == "object" then (.command // .file_path // .path // .pattern // .url // .query // .description // .skill // .prompt // ([.[] | strings][0]) // "")
   elif type == "string" then . else "" end)
  | tostring | .[0:400] | gsub("\\s+"; " ") | sub("^ "; "") | .[0:120];

# Each call result in a line jq sees (a subagent's launch result) and in the short lines
# extract.sh makes of the rest ("_x": ts, ids, err).
def results($l; $c):
  $c[]? | select(type == "object" and .type == "tool_result" and (.tool_use_id | type) == "string")
  | {k: "x", id: .tool_use_id, ts: $l.timestamp, f: (.is_error == true)};
# In a subagent's own transcript (THREADS_SIDECHAIN=1, the ATIF export only), the result of
# a subagent it started has no toolUseResult: the started one's id is only a line of the
# result text, "agentId: <id>", in the footer Claude Code puts after what the subagent said.
# What the subagent said can hold such a line too, so only the last text block with one
# counts, and its last match. Letters, digits, "-" and "_" only; core/atif.js checks the file
# it names again, its first prompt against the call's, and that no other call has it.
def side_launch($c):
  if ($ENV.THREADS_SIDECHAIN // "") != "1" then empty
  else $c[]? | select(type == "object" and .type == "tool_result" and (.tool_use_id | type) == "string")
    | .tool_use_id as $id
    | ([.content | if type == "string" then [.] elif type == "array" then [.[]? | select(type == "object" and .type == "text") | (.text // "") | tostring] else [] end
        | .[] | select(test("(?:^|\n)agentId: [A-Za-z0-9_-]"))] | last) as $t
    | select($t != null)
    | ([$t | match("(?:^|\n)agentId: (?<a>[A-Za-z0-9_-]{1,80})(?![A-Za-z0-9_-])"; "g") | .captures[0].string] | last) as $a
    | select($a != null)
    | {k: "r", id: $id, a: $a, m: null, st: null}
  end;
# A short result line: one call, or several with one error flag between them (which of them
# failed is not known then).
def short_results:
  .ts as $ts | (.err == true) as $err | (.ids // []) as $ids
  | $ids[] | select(type == "string")
  | {k: "x", id: ., ts: $ts, f: (if ($ids | length) == 1 then $err elif $err then null else false end)};

# A task notification's task id, status, and the usage block's time and tokens.
def notice($t):
  tag($t; "task-id") as $a | tag($t; "status") as $st
  | if $a != "" and $st != "" then
      {k: "n", a: ($a | .[0:80]), st: ($st | .[0:40]), ms: (tag($t; "duration_ms") | tonumber? // null), tok: (tag($t; "subagent_tokens") | tonumber? // null)}
    else empty end;

def user_event:
  . as $l
  | ($l.message.content) as $c
  | if $l.toolUseResult != null then launch($l; $c), results($l; $c)
    elif ($c | type) == "array" and any($c[]?; type == "object" and .type == "tool_result") then
      # A fork's own transcript, read after the records it copied from its caller (THREADS_FORK=1,
      # the ATIF export only): its first record carries the fork call's result and, beside it,
      # the fork's prompt as text blocks.
      (if ($ENV.THREADS_FORK // "") == "1" and any($c[]?; type == "object" and .type == "text")
       then {k: "p", o: "human", ts: $l.timestamp, t: ($c | text_of | cap)} else empty end),
      side_launch($c), results($l; $c)
    elif $l.isCompactSummary == true then empty
    # Meta lines are bookkeeping (reminders, scheduled-turn notes), except a message from
    # another session: Claude Code marks a peer's hand-back isMeta too, with an origin object.
    elif $l.isMeta == true and ($l.origin.kind? // null) != "peer" then
      if ($l.parentUuid | type) == "string" then {k: "b", pu: $l.parentUuid} else empty end
    else ($c | text_of) as $t
      | if ($t | startswith("[Request interrupted")) then {k: "i", ts: $l.timestamp}
        # Slash commands, in either tag order, with or without origin: local ones (/clear,
        # /usage) start no model turn; skills and custom commands do.
        # Only text that starts with a command tag: a prompt that merely mentions one is a
        # prompt.
        elif ($t | test("^\\s*<command-(name|message|args)>")) and ($t | test("<command-name>")) then
          {k: "p", cmd: true, o: ($l.origin.kind // "human"), ts: $l.timestamp, u: $l.uuid,
           t: ([("/" + (tag($t; "command-name") | ltrimstr("/"))), tag($t; "command-args")]
               | map(select(. != "" and . != "/")) | join(" ") | cap)}
        # A command line with no command-name (malformed, or another build's shape): its
        # tags never reach a row. Without an origin, a bare command-message line stays
        # dropped as before.
        elif ($t | test("^\\s*<command-(name|message|args)>")) then
          if ($l.origin | type) != "object" and ($t | test("^<command-message>")) then empty
          else ($l.origin.kind // "human") as $o
            | ($t | gsub("</?command-(name|message|args)>"; " ") | gsub("\\s+"; " ") | gsub("^ | $"; "")) as $s
            | if ($s | length) == 0 then empty
              else {k: "p", o: $o, ts: $l.timestamp, t: (if own($o) then ($s | cap) else null end)} end
          end
        # A task notification, with or without an origin: its state, then the prompt that
        # counts it.
        elif ($t | startswith("<task-notification>")) then
          notice($t), {k: "p", o: (if ($l.origin.kind? | type) == "string" then $l.origin.kind else "task-notification" end), ts: $l.timestamp, t: null}
        elif ($l.origin | type) == "object" then
          ($l.origin.kind // "human") as $o
          | {k: "p", o: $o, ts: $l.timestamp, t: (if own($o) then ($t | cap) else null end)} + imgs($l; $c)
            + (if $o == "peer" and ($l.origin.name | type) == "string" then {n: ($l.origin.name | .[0:80])} else {} end)
        elif ($t | test("^<(local-command-|bash-|command-message)")) then empty
        elif ($t | startswith("Another Claude session")) then {k: "p", o: "peer", ts: $l.timestamp, t: ($t | cap)}
        elif ($t | length) == 0 and (imgs($l; $c) == {}) then empty
        else {k: "p", o: "human", ts: $l.timestamp, t: ($t | cap)} + imgs($l; $c)
        end
    end;

# A prompt sent while Claude works. A task notification is only its state (notice): its user
# line, when there is one, counts it, and one in mid-turn changes no row.
def queued_event:
  . as $l
  | $l.attachment as $a
  | ($a.origin.kind? // "human") as $o
  | ($a.prompt | text_of) as $t
  | {uuid: $l.uuid, imagePasteIds: ($a.imagePasteIds // null)} as $img
  | if ($t | startswith("<task-notification>")) then notice($t)
    elif (own($o) | not) or ($a.commandMode // "prompt") != "prompt" then empty
    elif $a.isMeta == true and $o != "peer" then empty
    elif ($t | length) == 0 and (imgs($img; $a.prompt) == {}) then empty
    else {k: "p", o: $o, ts: ($l.timestamp // $a.timestamp), t: ($t | cap)} + imgs($img; $a.prompt)
      + (if $o == "peer" and ($a.origin.name | type) == "string" then {n: ($a.origin.name | .[0:80])} else {} end)
    end;

# A message that ends the reply: no tool call follows it. A message's thinking has a line of
# its own with the same stop_reason, and its reply text comes after, so only text counts.
def ends_reply:
  (.message.stop_reason == "end_turn" or .message.stop_reason == "stop_sequence" or .message.stop_reason == "refusal")
  and any(.message.content[]?; type == "object" and .type == "text");

def assistant_event:
  . as $l
  | if ($l.message.model == "<synthetic>") or ($l.isApiErrorMessage == true) then
      {k: "e", t: ($l.message.content | text_of)}, {k: "s", ts: $l.timestamp}
    else
      ( $l.message.content[]?
        | select(type == "object")
        | if .type == "text" then {k: "t", t: ((.text // "") | cap), ts: $l.timestamp}
          elif .type == "tool_use" then {k: "u", n: .name, id: .id, ts: $l.timestamp, in: (.input | brief)}
          else empty end ),
      ( select($l.message.id != null and $l.message.usage != null and ($l.apiBlockIndex // 0) == 0)
        | {k: "m", id: $l.message.id, m: $l.message.model, e: ($l.effort // $l.perTurnEffort // null), ts: $l.timestamp,
           u: ($l.message.usage | {i: (.input_tokens // 0), o: (.output_tokens // 0),
                                   cr: (.cache_read_input_tokens // 0), cc: (.cache_creation_input_tokens // 0)})} ),
      ( select($l | ends_reply) | {k: "s", ts: $l.timestamp} )
    end;

# A subagent's own transcript (subagents/agent-<id>.jsonl) marks every line isSidechain: the
# ATIF export reads one with THREADS_SIDECHAIN=1. The panel never sets it.
def event:
  if .isSidechain == true and ($ENV.THREADS_SIDECHAIN // "") != "1" then empty
  elif .type == "_x" then short_results
  elif .type == "user" then user_event
  elif .type == "assistant" then assistant_event
  elif .type == "system" and .subtype == "turn_duration" then {k: "d", ms: .durationMs, ts: .timestamp}
  elif .type == "system" and .subtype == "stop_hook_summary" then {k: "s", ts: .timestamp}
  elif .type == "attachment" then (if .attachment.type? == "queued_command" then queued_event else empty end)
  elif .type == "system" and .subtype == "compact_boundary" then {k: "c", ts: .timestamp}
  elif .type == "custom-title" then {k: "title", t: .customTitle}
  elif .type == "agent-name" and (.agentName | type) == "string" and (.agentName | length) > 0 then {k: "an", t: (.agentName | .[0:80])}
  else empty end;

(fromjson? // empty) | select(type == "object") | event
