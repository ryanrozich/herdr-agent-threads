# agent-threads extractor for Pi session files: lines in (jq -R, whole lines only), the same
# compact events as extract.jq out, one JSON object per line, in file order:
#   ctx    the model chosen for the turns after it  {m, e}
#   p      a prompt  {o: "human", ts, t}, with pasted images {img: [media types], u: "<entry id>"}
#   t      assistant text  {t}
#   u      tool call  {n: tool name}
#   m      token use of one model response  {id, m, e, u: {i,o,cr,cc}, ts}
#   e      error message  {t}
#   d      end of a turn  {ts}, with no ms: the pane counts from the prompt
#   i      an aborted turn  {ts}
#   c      compaction  {ts}
#   title  the session's name (/name)  {t}
# A Pi file is a tree (/tree branches it in place). Entries are read in file order, so a branch
# left behind stays in the list. Thinking, tool input and output, system prompts and image data
# stay out of the output. Texts are capped at 200 KB, as in extract.jq.

def cap:
  if length > 200000 then .[0:200000] + "\n\n… (cut at 200 KB)" else . end;

def text_of:
  if type == "string" then .
  else [ .[]? | select(type == "object" and .type == "text") | (.text // "") ] | join("\n") end;

def images:
  [ (if type == "array" then .[] else empty end) | select(type == "object" and .type == "image") | (.mimeType // "") ];

def prompt($l; $m):
  ($m.content | text_of) as $t
  | ($m.content | images) as $img
  | if ($t | length) == 0 and ($img | length) == 0 then empty
    else {k: "p", o: "human", ts: $l.timestamp, t: ($t | cap)}
      + (if ($img | length) > 0 and ($l.id | type) == "string" then {img: $img, u: $l.id} else {} end)
    end;

def reply($l; $m):
  ( $m.content[]? | select(type == "object")
    | if .type == "text" and ((.text // "") | length) > 0 then {k: "t", t: (.text | cap)}
      elif .type == "toolCall" then {k: "u", n: (.name // "tool")}
      else empty end ),
  # input leaves out the cached tokens already, and output counts reasoning.
  ( $m.usage // null
    | select(type == "object" and ((.totalTokens // 0) > 0))
    | {k: "m", id: $l.id, m: ($m.model // null),
       e: (($m.thinkingLevel // "off") | if . == "off" then null else . end), ts: $l.timestamp,
       u: {i: (.input // 0), o: (.output // 0), cr: (.cacheRead // 0), cc: (.cacheWrite // 0)}} ),
  ( if $m.stopReason == "error" then {k: "e", t: (($m.errorMessage // "error") | tostring | cap)} else empty end ),
  ( if $m.stopReason == "aborted" then {k: "i", ts: $l.timestamp}
    elif $m.stopReason == "stop" or $m.stopReason == "length" or $m.stopReason == "error" then {k: "d", ts: $l.timestamp}
    else empty end );

(fromjson? // empty) | select(type == "object")
| . as $l
| if $l.type == "message" then
    ($l.message // {}) as $m
    | if $m.role == "user" then prompt($l; $m)
      elif $m.role == "assistant" then reply($l; $m)
      else empty end
  elif $l.type == "compaction" then {k: "c", ts: $l.timestamp}
  elif $l.type == "session_info" and ($l.name | type) == "string" and ($l.name | length) > 0 then {k: "title", t: $l.name}
  elif $l.type == "model_change" then {k: "ctx", m: ($l.modelId // null), e: null}
  else empty end
