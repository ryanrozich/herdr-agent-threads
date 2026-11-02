# agent-threads extractor: transcript lines in (jq -R, whole lines only), compact events
# out, one JSON object per line, in file order:
#   p  prompt that opens a model turn   {o: origin kind, ts, t: text}; t only for own origins;
#                                       a peer's origin name as n ("general-purpose");
#                                       with pasted images also {img: [media types], u: line
#                                       uuid, ids: imagePasteIds} (the data stays in the file:
#                                       image.sh decodes a prompt's images when it is shown)
#      slash command line               {cmd: true, o, ts, t: "/name args"}
#   i  "[Request interrupted"           {ts}
#   t  assistant text block             {t}
#   u  tool call                        {n: tool name}
#   m  assistant usage, per message id  {id, m: model, e: effort, u: {i,o,cr,cc}, ts}
#      (once per message: on the apiBlockIndex 0 line; every block line repeats it)
#   e  synthetic or API error message   {t}
#   d  end of a model turn              {ms, ts}
#   c  compaction                       {ts}
#   title  /rename title                {t}
# Thinking blocks, tool inputs, tool results and bookkeeping lines are dropped. Texts are
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

def user_event:
  . as $l
  | ($l.message.content) as $c
  | if $l.toolUseResult != null then empty
    elif ($c | type) == "array" and any($c[]?; type == "object" and .type == "tool_result") then empty
    elif $l.isCompactSummary == true then empty
    # Meta lines are bookkeeping (reminders, scheduled-turn notes), except a message from
    # another session: Claude Code marks a peer's hand-back isMeta too, with an origin object.
    elif $l.isMeta == true and ($l.origin.kind? // null) != "peer" then empty
    else ($c | text_of) as $t
      | if ($t | startswith("[Request interrupted")) then {k: "i", ts: $l.timestamp}
        # Slash commands, in either tag order, with or without origin: local ones (/clear,
        # /usage) start no model turn; skills and custom commands do.
        # Only text that starts with a command tag: a prompt that merely mentions one is a
        # prompt.
        elif ($t | test("^\\s*<command-(name|message|args)>")) and ($t | test("<command-name>")) then
          {k: "p", cmd: true, o: ($l.origin.kind // "human"), ts: $l.timestamp,
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
        elif ($l.origin | type) == "object" then
          ($l.origin.kind // "human") as $o
          | {k: "p", o: $o, ts: $l.timestamp, t: (if own($o) then ($t | cap) else null end)} + imgs($l; $c)
            + (if $o == "peer" and ($l.origin.name | type) == "string" then {n: ($l.origin.name | .[0:80])} else {} end)
        elif ($t | test("^<(local-command-|bash-|command-message)")) then empty
        elif ($t | startswith("<task-notification>")) then {k: "p", o: "task-notification", ts: $l.timestamp, t: null}
        elif ($t | startswith("Another Claude session")) then {k: "p", o: "peer", ts: $l.timestamp, t: ($t | cap)}
        elif ($t | length) == 0 and (imgs($l; $c) == {}) then empty
        else {k: "p", o: "human", ts: $l.timestamp, t: ($t | cap)} + imgs($l; $c)
        end
    end;

def assistant_event:
  . as $l
  | if ($l.message.model == "<synthetic>") or ($l.isApiErrorMessage == true) then
      {k: "e", t: ($l.message.content | text_of)}
    else
      ( $l.message.content[]?
        | select(type == "object")
        | if .type == "text" then {k: "t", t: ((.text // "") | cap)}
          elif .type == "tool_use" then {k: "u", n: .name}
          else empty end ),
      ( select($l.message.id != null and $l.message.usage != null and ($l.apiBlockIndex // 0) == 0)
        | {k: "m", id: $l.message.id, m: $l.message.model, e: ($l.effort // $l.perTurnEffort // null), ts: $l.timestamp,
           u: ($l.message.usage | {i: (.input_tokens // 0), o: (.output_tokens // 0),
                                   cr: (.cache_read_input_tokens // 0), cc: (.cache_creation_input_tokens // 0)})} )
    end;

def event:
  if .isSidechain == true then empty
  elif .type == "user" then user_event
  elif .type == "assistant" then assistant_event
  elif .type == "system" and .subtype == "turn_duration" then {k: "d", ms: .durationMs, ts: .timestamp}
  elif .type == "system" and .subtype == "compact_boundary" then {k: "c", ts: .timestamp}
  elif .type == "custom-title" then {k: "title", t: .customTitle}
  else empty end;

(fromjson? // empty) | select(type == "object") | event
