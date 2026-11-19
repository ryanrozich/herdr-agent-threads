-- agent-threads: one step group's calls from OpenCode 1.x's part table (opencode.sh calls), for
-- level 3. Bound by the caller: :sid the session, :ids a JSON array of call ids. Prints each
-- call's input and output as calls.sh does. Selects named fields only.
with want as (select value id from json_each(:ids)),
c as (
  select json_extract(p.data,'$.callID') id, json_extract(p.data,'$.state') st
  from part p
  where p.session_id = :sid and json_extract(p.data,'$.type') = 'tool'
    and json_extract(p.data,'$.callID') in (select id from want)),
o as (
  select id, st, json_extract(st,'$.status') status,
    coalesce(json_extract(st,'$.output'), json_extract(st,'$.error'), '') txt,
    json_extract(st,'$.time.start') t0, json_extract(st,'$.time.end') t1
  from c)
select json_object('id', id, 'k', 'in',
  'ts', case when t0 is null then null else strftime('%Y-%m-%dT%H:%M:%fZ', t0 / 1000.0, 'unixepoch') end,
  'in', substr(coalesce(json_extract(st,'$.input.command'), json_extract(st,'$.input.filePath'),
    json_extract(st,'$.input.path'), json_extract(st,'$.input.pattern'), json_extract(st,'$.input.url'),
    json_extract(st,'$.input.query'), json_extract(st,'$.input.description'), json_extract(st,'$.input.name'),
    json_extract(st,'$.input'), ''), 1, 400))
from o
union all
select json_object('id', id, 'k', 'out',
  'ts', case when t1 is null then null else strftime('%Y-%m-%dT%H:%M:%fZ', t1 / 1000.0, 'unixepoch') end,
  'err', json(case when status = 'error' then 'true' else 'false' end),
  'out', substr(txt, 1, :cap), 'lines', length(txt) - length(replace(txt, char(10), '')) + 1,
  'ms', case when t0 is null or t1 is null then null else t1 - t0 end)
from o where status in ('completed', 'error');
