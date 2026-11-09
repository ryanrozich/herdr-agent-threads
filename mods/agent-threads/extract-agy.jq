# agent-threads extractor for Antigravity CLI conversations (<data>/brain/<id>/
# .system_generated/logs/transcript_full.jsonl, data being ~/.gemini/antigravity-cli): lines in
# (jq -R, whole lines only), the same compact events as extract.jq out, one JSON object per
# line, in file order:
#   p      a prompt  {o: "human", ts, t}
#   ctx    the model chosen for the turns that follow  {m, e}
#   t      assistant text  {t}
#   u      tool call  {n: tool name}
#   m      one model step's tokens  {id, u: {i, o, cr, cc}, ts}
#   e      error message  {t}
#   d      end of a turn  {ts}
# A line is one step: {step_index, source, type, status, created_at, content, input_tokens,
# cache_read_tokens, output_tokens, tool_calls: [{name, args}], error, thinking}. The owner's
# prompt is a USER_INPUT step: its words sit in a <USER_REQUEST> tag, beside metadata, and a
# model change rides along as "The user changed setting `Model Selection` from A to B".
# A PLANNER_RESPONSE step is the model's: text, tool calls and its tokens (input_tokens
# leaves out the cached ones). A step with text and no tool call is the turn's answer. GENERIC
# steps are tool output and stay out, as does thinking. Times are UTC to the second. Texts are
# capped at 200 KB, as in extract.jq.
# A prompt first ends the turn before it (a "d" with nothing open does nothing), so a turn
# stopped before its answer still ends.

def cap:
  if length > 200000 then .[0:200000] + "\n\n… (cut at 200 KB)" else . end;

def prompt:
  (.content // "") as $all
  | ($all | capture("<USER_REQUEST>\\n?(?<q>[\\s\\S]*?)\\n?</USER_REQUEST>") // null | if . then .q else null end) as $q
  | ($all | capture("changed setting `Model Selection` from .*? to (?<to>[^\\n]*?)(?:\\. [A-Z]|\\.?\\n|\\.?$)") // null
     | if . then (.to | capture("^(?<m>.+?)(?: \\((?<e>[^)]+)\\))?$")) else null end) as $model
  | (if $model then {k: "ctx", m: $model.m, e: $model.e} else empty end),
    (($q // $all) as $t
     | if ($t | length) == 0 then empty
       else {k: "p", o: "human", t: ($t | cap)} + (if .created_at then {ts: .created_at} else {} end) end);

def tokens:
  if (.input_tokens // .output_tokens // .cache_read_tokens) == null then empty
  else {k: "m", id: "step-\(.step_index)",
        u: {i: (.input_tokens // 0), o: (.output_tokens // 0), cr: (.cache_read_tokens // 0), cc: 0}}
       + (if .created_at then {ts: .created_at} else {} end) end;

def reply:
  ((.content // "") as $t | if ($t | length) > 0 then {k: "t", t: ($t | cap)} else empty end),
  (.tool_calls[]? | select(type == "object") | {k: "u", n: (.name // "tool")}),
  tokens,
  (if .status == "ERROR" then {k: "e", t: ((.error // "error") | tostring | cap)} else empty end),
  (if ((.content // "") | length) > 0 and ((.tool_calls // []) | length) == 0
   then {k: "d"} + (if .created_at then {ts: .created_at} else {} end) else empty end);

(fromjson? // empty) | select(type == "object")
| if .type == "USER_INPUT" and (.source // "USER_EXPLICIT") == "USER_EXPLICIT" then {k: "d"}, prompt
  elif .type == "PLANNER_RESPONSE" then reply
  else empty end
