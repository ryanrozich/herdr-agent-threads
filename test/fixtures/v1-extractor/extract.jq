# herdr-threads extractor: transcript lines in (jq -R, whole lines only), compact events
# out, one JSON object per line, in file order:
#   p  prompt that opens a model turn   {o: origin kind, ts, t: text}
#   i  "[Request interrupted"           {ts}
#   t  assistant text block             {t}
#   u  tool call                        {n: tool name}
#   m  assistant usage, per message id  {id, m: model, e: effort, u: {i,o,cr,cc}, ts}
#   e  synthetic or API error message   {t}
#   d  end of a model turn              {ms, ts}
#   c  compaction                       {ts}
#   title  /rename title                {t}
# Thinking blocks, tool inputs, tool results and bookkeeping lines are dropped.

def text_of:
  if type == "string" then .
  elif type == "array" then [ .[]? | select(type == "object" and .type == "text") | .text ] | join("\n")
  else "" end;

def tag($s; $name):
  ($s | capture("<" + $name + ">(?<v>[\\s\\S]*?)</" + $name + ">")? | .v) // "";

def user_event:
  . as $l
  | ($l.message.content) as $c
  | if $l.toolUseResult != null then empty
    elif ($c | type) == "array" and any($c[]?; type == "object" and .type == "tool_result") then empty
    elif $l.isCompactSummary == true then empty
    elif $l.isMeta == true then empty
    else ($c | text_of) as $t
      | if ($t | startswith("[Request interrupted")) then {k: "i", ts: $l.timestamp}
        elif ($l.origin | type) == "object" then
          {k: "p", o: ($l.origin.kind // "human"), ts: $l.timestamp, t: $t}
        elif ($t | startswith("<command-name>")) then
          {k: "p", o: "human", ts: $l.timestamp,
           t: ([tag($t; "command-name"), tag($t; "command-args")] | map(select(. != "")) | join(" "))}
        elif ($t | test("^<(local-command-|bash-|command-message)")) then empty
        elif ($t | startswith("<task-notification>")) then {k: "p", o: "task-notification", ts: $l.timestamp, t: $t}
        elif ($t | startswith("Another Claude session")) then {k: "p", o: "peer", ts: $l.timestamp, t: $t}
        elif ($t | length) == 0 then empty
        else {k: "p", o: "human", ts: $l.timestamp, t: $t}
        end
    end;

def assistant_event:
  . as $l
  | if ($l.message.model == "<synthetic>") or ($l.isApiErrorMessage == true) then
      {k: "e", t: ($l.message.content | text_of)}
    else
      ( $l.message.content[]?
        | select(type == "object")
        | if .type == "text" then {k: "t", t: .text}
          elif .type == "tool_use" then {k: "u", n: .name}
          else empty end ),
      ( select($l.message.id != null and $l.message.usage != null)
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
