# agent-threads extractor for Codex rollout files: lines in (jq -R, whole lines only), the same
# compact events as extract.jq out, one JSON object per line, in file order:
#   ctx    the model and effort of the turn about to start  {m, e}
#   p      a prompt   {o: "human", ts, t}, with pasted images {img: [media types], u: "<turn id>_<ordinal>"}
#                     a subagent's message  {o: "peer", ts, t, n: its name}
#   t      assistant text (commentary and the final answer)  {t}
#   u      tool call  {n: tool name}
#   m      token use of one model response  {id, u: {i,o,cr,cc}, ts}
#   e      error message  {t}
#   d      end of a turn  {ms, ts}
#   i      an interrupted turn  {ts}
#   c      compaction  {ts}
#   title  the thread's name  {t}
# Reasoning, tool input and output, injected context and the image data stay out of the output.
# Texts are capped at 200 KB, as in extract.jq.

def cap:
  if length > 200000 then .[0:200000] + "\n\n… (cut at 200 KB)" else . end;

def blocks_text:
  [ .[]? | select(type == "object" and (.type | ascii_downcase | test("text$"))) | (.text // "") ] | join("\n");

def mime_of_path:
  ascii_downcase
  | if endswith(".png") then "image/png"
    elif endswith(".jpg") or endswith(".jpeg") then "image/jpeg"
    elif endswith(".gif") then "image/gif"
    elif endswith(".webp") then "image/webp"
    else "" end;

def image_type:
  if .type == "local_image" then ((.path // "") | mime_of_path)
  elif .type == "image" then ((.image_url // "") | capture("^data:(?<m>[^;,]+)")? | .m) // ""
  else empty end;

def prompt($l; $p):
  ($p.item.content // []) as $c
  | ($c | blocks_text) as $t
  | [ $c[]? | select(type == "object") | image_type ] as $m
  | if ($t | length) == 0 and ($m | length) == 0 then empty
    else {k: "p", o: "human", ts: $l.timestamp, t: ($t | cap)}
      + (if ($m | length) > 0 and $l.ordinal != null and $p.turn_id != null
         then {img: $m, u: "\($p.turn_id)_\($l.ordinal)"} else {} end)
    end;

def usage:
  (.input_tokens // 0) as $in | (.cached_input_tokens // 0) as $cr | (.cache_write_input_tokens // 0) as $cc
  # input_tokens counts the cached tokens too; the pane adds new input, cache reads and writes.
  | {i: ([$in - $cr - $cc, 0] | max), o: (.output_tokens // 0), cr: $cr, cc: $cc};

def event_msg($l; $p):
  if $p.type == "item_completed" and $p.item.type == "UserMessage" then prompt($l; $p)
  elif $p.type == "token_count" and ($p.info | type) == "object" and ($p.info.last_token_usage | type) == "object" then
    # A rate-limit update repeats the last count: the running total names the response.
    {k: "m", id: "t\($p.info.total_token_usage.total_tokens // $l.timestamp)", ts: $l.timestamp, u: ($p.info.last_token_usage | usage)}
  elif $p.type == "task_complete" then {k: "d", ms: ($p.duration_ms // 0), ts: $l.timestamp}
  elif $p.type == "turn_aborted" then {k: "i", ts: $l.timestamp}
  elif $p.type == "error" then {k: "e", t: (($p.message // "") | tostring | cap)}
  elif $p.type == "thread_name_updated" and ($p.thread_name | type) == "string" then {k: "title", t: $p.thread_name}
  else empty end;

def response_item($l; $p):
  if $p.type == "message" and $p.role == "assistant" then
    ($p.content | blocks_text) as $t
    | if ($t | length) > 0 then {k: "t", t: ($t | cap)} else empty end
  elif $p.type == "function_call" or $p.type == "custom_tool_call" then {k: "u", n: ($p.name // "tool")}
  elif $p.type == "web_search_call" then {k: "u", n: "web_search"}
  elif $p.type == "local_shell_call" then {k: "u", n: "shell"}
  # A subagent's message. One a fork copied from its parent is not news to this session.
  elif $p.type == "agent_message" and ($l.metadata.inherited_user_message != true) then
    ($p.content | blocks_text) as $t
    | if ($t | length) > 0
      then {k: "p", o: "peer", ts: $l.timestamp, t: ($t | cap), n: (($p.author // "agent") | tostring | split("/") | last | .[0:80])}
      else empty end
  else empty end;

(fromjson? // empty) | select(type == "object")
| . as $l
| ($l.payload // {}) as $p
| if $l.type == "event_msg" then event_msg($l; $p)
  elif $l.type == "response_item" then response_item($l; $p)
  elif $l.type == "turn_context" then {k: "ctx", m: ($p.model // null), e: ($p.effort // null)}
  elif $l.type == "compacted" then {k: "c", ts: $l.timestamp}
  else empty end
