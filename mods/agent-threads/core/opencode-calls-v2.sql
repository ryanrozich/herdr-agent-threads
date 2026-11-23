-- agent-threads: one step group's calls from OpenCode 2.x's session_message table (opencode.sh
-- calls), for level 3: the tool items in an assistant message's content. Bound by the caller:
-- :sid the session, :ids a JSON array of call ids. Prints each call's input and output as
-- calls.sh does. Selects named fields only.
-- A call failed when its status is error (the tool itself failed), or when it completed with an
-- exit code other than 0 (state.metadata.exit: the shell tool, "shell", completes whatever its
-- command exits with). A shell call that completed with no exit code (a signal or a lost
-- process) leaves err null: unknown, not false. A completed call's text is its content only.
-- A time counts when it is a number above 0, and an end only when it is not before the start.
with want as (select value id from json_each(:ids)),
c as (
  select json_extract(x.value,'$.id') id, x.value v
  from session_message m, json_each(m.data,'$.content') x
  where m.session_id = :sid and m.type = 'assistant' and json_extract(x.value,'$.type') = 'tool'
    and json_extract(x.value,'$.id') in (select id from want)),
t as (
  select id, v, json_extract(v,'$.name') tool, json_extract(v,'$.state.status') status,
    (select group_concat(json_extract(t.value,'$.text'), char(10)) from json_each(json_extract(v,'$.state.content')) t
      where json_extract(t.value,'$.type') = 'text') content,
    case when json_type(v,'$.time.created') in ('integer','real') and json_extract(v,'$.time.created') > 0
      then json_extract(v,'$.time.created') end t0
  from c),
o as (
  select id, v, status, t0,
    case when json_type(v,'$.time.completed') in ('integer','real') and json_extract(v,'$.time.completed') > 0
      and (t0 is null or json_extract(v,'$.time.completed') >= t0) then json_extract(v,'$.time.completed') end t1,
    case when status = 'completed' then coalesce(content, '')
      else coalesce(content, json_extract(v,'$.state.error.message'), '') end txt,
    case when status = 'error' then 'true'
      when json_type(v,'$.state.metadata.exit') in ('integer','real') then case when json_extract(v,'$.state.metadata.exit') <> 0 then 'true' else 'false' end
      when tool in ('bash','shell') then 'null'
      else 'false' end failed
  from t)
select json_object('id', id, 'k', 'in',
  'ts', case when t0 is null then null else strftime('%Y-%m-%dT%H:%M:%fZ', t0 / 1000.0, 'unixepoch') end,
  'in', substr(coalesce(json_extract(v,'$.state.input.command'), json_extract(v,'$.state.input.filePath'),
    json_extract(v,'$.state.input.path'), json_extract(v,'$.state.input.pattern'), json_extract(v,'$.state.input.url'),
    json_extract(v,'$.state.input.query'), json_extract(v,'$.state.input.description'), json_extract(v,'$.state.input.name'),
    json_extract(v,'$.state.input'), ''), 1, 400))
from o
union all
select json_object('id', id, 'k', 'out',
  'ts', case when t1 is null then null else strftime('%Y-%m-%dT%H:%M:%fZ', t1 / 1000.0, 'unixepoch') end,
  'err', json(failed),
  'out', substr(txt, 1, :cap) || case when :mark = 1 and length(txt) > :cap then char(10) || char(10) || '… (cut at 4,194,304 characters of ' || length(txt) || ')' else '' end, 'lines', length(txt) - length(replace(txt, char(10), '')) + 1,
  'ms', case when t0 is null or t1 is null then null else t1 - t0 end)
from o where status in ('completed', 'error');
