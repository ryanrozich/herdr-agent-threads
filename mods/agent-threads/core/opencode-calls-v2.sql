-- agent-threads: one step group's calls from OpenCode 2.x's session_message table (opencode.sh
-- calls), for level 3: the tool items in an assistant message's content. Bound by the caller:
-- :sid the session, :ids a JSON array of call ids. Prints each call's input and output as
-- calls.sh does. Selects named fields only.
with want as (select value id from json_each(:ids)),
c as (
  select json_extract(x.value,'$.id') id, x.value v
  from session_message m, json_each(m.data,'$.content') x
  where m.session_id = :sid and m.type = 'assistant' and json_extract(x.value,'$.type') = 'tool'
    and json_extract(x.value,'$.id') in (select id from want)),
o as (
  select id, v, json_extract(v,'$.state.status') status,
    coalesce((select group_concat(json_extract(t.value,'$.text'), char(10)) from json_each(json_extract(v,'$.state.content')) t
      where json_extract(t.value,'$.type') = 'text'), json_extract(v,'$.state.error.message'), '') txt,
    json_extract(v,'$.time.created') t0, json_extract(v,'$.time.completed') t1
  from c)
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
  'err', json(case when status = 'error' then 'true' else 'false' end),
  'out', substr(txt, 1, :cap), 'lines', length(txt) - length(replace(txt, char(10), '')) + 1,
  'ms', case when t0 is null or t1 is null then null else t1 - t0 end)
from o where status in ('completed', 'error');
