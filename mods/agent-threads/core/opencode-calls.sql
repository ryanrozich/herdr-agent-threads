-- agent-threads: one step group's calls from OpenCode 1.x's part table (opencode.sh calls), for
-- level 3. Bound by the caller: :sid the session, :ids a JSON array of call ids. Prints each
-- call's input and output as calls.sh does. Selects named fields only.
-- A call failed when its status is error (the tool itself failed), or when it completed with an
-- exit code other than 0 (state.metadata.exit: the shell tool, "bash", completes whatever its
-- command exits with). A shell call that completed with no exit code (null after an abort or a
-- timeout) leaves err null: unknown, not false. A completed call's text is its output only.
-- A time counts when it is a number above 0, and an end only when it is not before the start.
with want as (select value id from json_each(:ids)),
c as (
  select json_extract(p.data,'$.callID') id, json_extract(p.data,'$.tool') tool, json_extract(p.data,'$.state') st
  from part p
  where p.session_id = :sid and json_extract(p.data,'$.type') = 'tool'
    and json_extract(p.data,'$.callID') in (select id from want)),
t as (
  select id, tool, st, json_extract(st,'$.status') status,
    case when json_type(st,'$.time.start') in ('integer','real') and json_extract(st,'$.time.start') > 0
      then json_extract(st,'$.time.start') end t0
  from c),
o as (
  select id, tool, st, status, t0,
    case when json_type(st,'$.time.end') in ('integer','real') and json_extract(st,'$.time.end') > 0
      and (t0 is null or json_extract(st,'$.time.end') >= t0) then json_extract(st,'$.time.end') end t1,
    case when status = 'completed' then coalesce(json_extract(st,'$.output'), '')
      else coalesce(json_extract(st,'$.output'), json_extract(st,'$.error'), '') end txt,
    case when status = 'error' then 'true'
      when json_type(st,'$.metadata.exit') in ('integer','real') then case when json_extract(st,'$.metadata.exit') <> 0 then 'true' else 'false' end
      when tool in ('bash','shell') then 'null'
      else 'false' end failed
  from t)
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
  'err', json(failed),
  'out', substr(txt, 1, :cap) || case when :mark = 1 and length(txt) > :cap then char(10) || char(10) || '… (cut at 4,194,304 characters of ' || length(txt) || ')' else '' end, 'lines', length(txt) - length(replace(txt, char(10), '')) + 1,
  'ms', case when t0 is null or t1 is null then null else t1 - t0 end)
from o where status in ('completed', 'error');
