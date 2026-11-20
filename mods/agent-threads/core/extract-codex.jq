# agent-threads extractor for Codex rollout files: lines in (one JSON string each, from lines.sh; whole lines only), the same
# compact events as extract.jq out, one JSON object per line, in file order:
#   ctx    the model and effort of the turn about to start  {m, e}
#   p      a prompt   {o: "human", ts, t}, with pasted images {img: [media types], u: "<turn id>_<ordinal>"}
#                     a subagent's message  {o: "peer", ts, t, n: its name}
#   t      assistant text (commentary and the final answer)  {t, ts}
#   u      tool call  {n: tool name, id: call id, ts, in: its input in up to 120 characters}
#   x      a call's output  {id, ts, f: whether it failed}: extract.sh turns each output line
#          into a short "_x" line before jq, so the output is never parsed here
#   m      token use of one model response  {id, u: {i,o,cr,cc}, ts}, and w: the model's context
#          window, when the count states it (model_context_window)
#   e      error message  {t}
#   d      end of a turn  {ms, ts}
#   i      an interrupted turn  {ts}
#   c      compaction  {ts}
#   title  the thread's name  {t}
#   an     the agent's name, which only a subagent's thread has  {t}: from session_meta's
#          agent_nickname, which extract.sh reads from the head of the file, since it drops
#          that line (it holds the whole system prompt) before jq
# Reasoning, tool input past its summary, tool output, injected context and the image data stay
# out of the output.
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

# A call's input in up to 120 characters on one line, as calls.sh shows it: the command, the
# path or query, the files a patch changes, else its first line.
def brief:
  def argv: if type == "array" then (if .[2] != null and (.[1] | tostring | test("^-l?c$")) then .[2] else map(tostring) | join(" ") end) else . end;
  (if .type == "function_call" then
     ((.arguments // "") | (fromjson? // .)) as $a
     | if ($a | type) == "object" then
         ($a.cmd // ($a.command | if . == null then null else argv end) // $a.title // $a.path // $a.file_path // $a.query // $a.url // $a.message // "")
       else $a end
   elif .type == "local_shell_call" then (.action.command // [] | argv)
   else (.input // "" | tostring | .[0:4000]) as $i
     | ([$i | scan("\\*\\*\\* (?:Update|Add|Delete) File: ([^\n]+)")] | map(.[0])) as $files
     | (first($i | match("cmd:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"") | .captures[0].string) // null | if . == null then null else (("\"" + . + "\"") | fromjson? // .) end) as $cmd
     | if ($files | length) != 0 then ($files | join(", ")) elif $cmd then $cmd else ($i | split("\n") | map(select(test("\\S"))) | (.[0] // "")) end
   end)
  | tostring | .[0:400] | gsub("\\s+"; " ") | sub("^ "; "") | .[0:120];

def usage:
  (.input_tokens // 0) as $in | (.cached_input_tokens // 0) as $cr | (.cache_write_input_tokens // 0) as $cc
  # input_tokens counts the cached tokens too; the pane adds new input, cache reads and writes.
  | {i: ([$in - $cr - $cc, 0] | max), o: (.output_tokens // 0), cr: $cr, cc: $cc};

def event_msg($l; $p):
  if $p.type == "item_completed" and $p.item.type == "UserMessage" then prompt($l; $p)
  elif $p.type == "token_count" and ($p.info | type) == "object" and ($p.info.last_token_usage | type) == "object" then
    # A rate-limit update repeats the last count: the running total names the response.
    {k: "m", id: "t\($p.info.total_token_usage.total_tokens // $l.timestamp)", ts: $l.timestamp, u: ($p.info.last_token_usage | usage)}
    # Each count states the window of the model that answered, so a model changed mid-session
    # (or the same model with another window) shows from its first count on.
    + (if ($p.info.model_context_window | type) == "number" and $p.info.model_context_window > 0 then {w: $p.info.model_context_window} else {} end)
  elif $p.type == "task_complete" then {k: "d", ms: ($p.duration_ms // 0), ts: $l.timestamp}
  elif $p.type == "turn_aborted" then {k: "i", ts: $l.timestamp}
  elif $p.type == "error" then {k: "e", t: (($p.message // "") | tostring | cap)}
  elif $p.type == "thread_name_updated" and ($p.thread_name | type) == "string" then {k: "title", t: $p.thread_name}
  else empty end;

def response_item($l; $p):
  if $p.type == "message" and $p.role == "assistant" then
    ($p.content | blocks_text) as $t
    | if ($t | length) > 0 then {k: "t", t: ($t | cap), ts: $l.timestamp} else empty end
<<<<<<< HEAD
  elif $p.type == "reasoning" and ($ENV.THREADS_REASONING // "") == "1" then
    {k: "h", t: ([$p.summary[]? | select(.type == "summary_text") | .text | tostring | gsub("^\\s+|\\s+$"; "") | cap] | join("\n\n")), ts: $l.timestamp}
=======
  elif $p.type == "reasoning" and ($ARGS.named.reasoning // "") == "1" then
    # The ATIF export only (extract.sh's "reasoning" argument): the summary's text, else the
    # item's own reasoning text (content), else a mark that the reasoning was withheld
    # (encrypted, or nothing but an empty summary).
    ([$p.summary[]? | select(.type == "summary_text") | .text | tostring | gsub("^\\s+|\\s+$"; "") | cap] | join("\n\n")) as $s
    | (if ($s | length) > 0 then $s
       else [$p.content[]? | select(type == "object" and (.type == "reasoning_text" or .type == "text")) | .text | tostring | gsub("^\\s+|\\s+$"; "") | cap] | join("\n\n") end | cap) as $r
    | if ($r | length) > 0 then {k: "h", t: $r, ts: $l.timestamp} else {k: "h", w: 1, ts: $l.timestamp} end
>>>>>>> 2b5d4d031e84e838348f2315f8a5bf83e0ba2f8c
  elif $p.type == "function_call" or $p.type == "custom_tool_call" then {k: "u", n: ($p.name // "tool"), id: $p.call_id, ts: $l.timestamp, in: ($p | brief)}
  elif $p.type == "web_search_call" then {k: "u", n: "web_search", ts: $l.timestamp, in: (($p.action.query // "") | tostring | .[0:120])}
  elif $p.type == "local_shell_call" then {k: "u", n: "shell", id: $p.call_id, ts: $l.timestamp, in: ($p | brief)}
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
| if $l.type == "_x" then (if ($p.call_id | type) == "string" then {k: "x", id: $p.call_id, ts: $l.timestamp, f: ($p.f == true)} else empty end)
  elif $l.type == "event_msg" then event_msg($l; $p)
  elif $l.type == "response_item" then response_item($l; $p)
  elif $l.type == "turn_context" then {k: "ctx", m: ($p.model // null), e: ($p.effort // null)}
  elif $l.type == "compacted" then {k: "c", ts: $l.timestamp}
  else empty end
