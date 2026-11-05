# agent-threads extractor for Cursor agent transcripts (~/.cursor/projects/<folder>/
# agent-transcripts/<id>/<id>.jsonl): lines in (jq -R, whole lines only), the same compact
# events as extract.jq out, one JSON object per line, in file order:
#   p      a prompt  {o: "human", ts, t}
#   t      assistant text  {t}
#   u      tool call  {n: tool name}
#   e      error message  {t}
#   d      end of a turn  {}
#   i      a stopped turn  {}
# A line is {"role":"user"|"assistant","message":{"content":[text | tool_use]}} or
# {"type":"turn_ended","status":"success"|"error"|"aborted"}. Cursor writes no times, tokens
# or model. A prompt carries the time it was sent in a <timestamp> tag, to the minute, and the
# words typed in a <user_query> tag. Cursor joins a reply's thinking onto its text after a
# blank line: thinking it hides is the word "[REDACTED]", which is dropped here; thinking it
# keeps cannot be told apart from the reply, so it stays. A pasted image is the word
# "[Image]". Tool input stays out. Texts are capped at 200 KB, as in extract.jq.
# Cursor runs one prompt at a time, and a file it writes again from the top keeps only the
# last turn's end, so a prompt first ends the turn before it (a "d" with nothing open does
# nothing).

def cap:
  if length > 200000 then .[0:200000] + "\n\n… (cut at 200 KB)" else . end;

def texts:
  [ .message.content[]? | select(type == "object" and .type == "text") | (.text // "") ] | join("\n");

def months: {Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12};

# "Thursday, Nov 5, 2026, 12:43 PM (UTC-6)" as an ISO time in UTC, or null.
def when:
  (capture("^[A-Za-z]+, (?<mon>[A-Z][a-z]{2})[a-z]* (?<d>\\d{1,2}), (?<y>\\d{4}), (?<h>\\d{1,2}):(?<min>\\d\\d) (?<ap>AM|PM) \\(UTC(?<sign>[+-])?(?<oh>\\d{1,2})?(:(?<om>\\d\\d))?\\)$") // null) as $c
  | if $c == null or months[$c.mon] == null then null
    else (($c.h | tonumber) % 12 + (if $c.ap == "PM" then 12 else 0 end)) as $h
      | (((($c.oh // "0") | tonumber) * 60 + (($c.om // "0") | tonumber)) * (if $c.sign == "-" then -1 else 1 end)) as $off
      | (([($c.y | tonumber), months[$c.mon] - 1, ($c.d | tonumber), $h, ($c.min | tonumber), 0, 0, 0] | mktime) - $off * 60)
      | todate
    end;

def prompt:
  texts as $all
  | ($all | capture("<timestamp>(?<t>[^<]*)</timestamp>") // null | if . then (.t | when) else null end) as $ts
  | ($all | capture("<user_query>\\n?(?<q>[\\s\\S]*?)\\n?</user_query>") // null | if . then .q else null end) as $q
  | ($q // ($all | gsub("<timestamp>[^<]*</timestamp>\\n?"; ""))) as $t
  | if ($t | length) == 0 then empty
    else {k: "p", o: "human", t: ($t | cap)} + (if $ts then {ts: $ts} else {} end) end;

# Cursor's own mark for thinking it hides, alone or after the reply's last blank line.
def unredact:
  if . == "[REDACTED]" then "" else sub("\\n\\n\\[REDACTED\\]$"; "") end;

def reply:
  ( .message.content[]? | select(type == "object")
    | if .type == "text" then ((.text // "") | unredact) as $t | if ($t | length) > 0 then {k: "t", t: ($t | cap)} else empty end
      elif .type == "tool_use" then {k: "u", n: (.name // "tool")}
      else empty end );

(fromjson? // empty) | select(type == "object")
| if .role == "user" then {k: "d"}, prompt
  elif .role == "assistant" then reply
  elif .type == "turn_ended" then
    if .status == "aborted" then {k: "i"}
    elif .status == "error" then {k: "e", t: ((.error // "error") | tostring | cap)}, {k: "d"}
    else {k: "d"} end
  else empty end
