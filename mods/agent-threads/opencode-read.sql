-- agent-threads: one read of an OpenCode session, as extractor events (opencode.sh read).
-- Bound by the caller: :sid the session, :off the settled prompts to skip, :win how many prompts
-- to read. Prints the "chunk" line, the title, then each prompt's events in order. Selects named
-- fields only: reasoning, tool input and output, and image data never leave the database.
with users as (
  select id, time_created t, row_number() over (order by time_created, id) - 1 n
  from message where session_id=:sid and json_extract(data,'$.role')='user'),
win as (select * from users where n >= :off and n < :off + :win),
msgs as (
  select m.id, m.time_created mt, m.data, u.n un, u.t ut, u.id uid,
    json_extract(m.data,'$.role') role
  from message m join win u on u.id = case json_extract(m.data,'$.role')
    when 'user' then m.id else json_extract(m.data,'$.parentID') end
  where m.session_id=:sid),
-- A turn is finished when its last reply stopped, was aborted or failed.
last as (
  select un, data, row_number() over (partition by un order by mt desc, id desc) r
  from msgs where role='assistant'),
fin as (
  select un, json_extract(data,'$.error.name') err, json_extract(data,'$.time.completed') done,
    json_extract(data,'$.finish') finish
  from last where r = 1),
done as (
  select un, done from fin
  where err is not null or (done is not null and finish is not null and finish <> 'tool-calls')),
settled as (select coalesce(max(un), :off - 1) un from done),
parts as (
  select p.id, p.message_id, json_extract(p.data,'$.type') ty, p.data
  from part p join msgs m on m.id = p.message_id
  where p.session_id=:sid
    and json_extract(p.data,'$.type') in ('text','tool','file','compaction')),
ev as (
  -- The prompt: its typed text and the image types. Image data stays in the database.
  select m.un, m.ut, m.uid, 0 ord, m.mt, m.id mid, '' pid,
    json_object('k','p','o','human','ts', strftime('%Y-%m-%dT%H:%M:%fZ', m.mt / 1000.0, 'unixepoch'),
      't', substr(coalesce((select group_concat(json_extract(x.data,'$.text'), char(10)) from parts x
        where x.message_id = m.id and x.ty = 'text'
        and coalesce(json_extract(x.data,'$.synthetic'),0) = 0
        and coalesce(json_extract(x.data,'$.ignored'),0) = 0), ''), 1, 200000))
    || '' line,
    (select json_group_array(json_extract(x.data,'$.mime')) from parts x
      where x.message_id = m.id and x.ty = 'file' and json_extract(x.data,'$.mime') like 'image/%') imgs,
    (select count(*) from parts x where x.message_id = m.id and x.ty = 'compaction') comp
  from msgs m where m.role = 'user'
  union all
  -- A reply's text and tool calls, in order.
  select m.un, m.ut, m.uid, 1, m.mt, m.id, x.id,
    case x.ty when 'text' then json_object('k','t','t', substr(json_extract(x.data,'$.text'), 1, 200000))
      else json_object('k','u','n', json_extract(x.data,'$.tool')) end, null, 0
  from msgs m join parts x on x.message_id = m.id
  where m.role = 'assistant' and x.ty in ('text','tool')
    and coalesce(json_extract(m.data,'$.summary'),0) = 0
    and (x.ty <> 'text' or (coalesce(json_extract(x.data,'$.synthetic'),0) = 0 and length(json_extract(x.data,'$.text')) > 0))
  union all
  -- A reply's tokens. input leaves out the cached tokens, output leaves out reasoning.
  select m.un, m.ut, m.uid, 2, m.mt, m.id, '~',
    json_object('k','m','id', m.id, 'a', json_extract(m.data,'$.agent'), 'm', json_extract(m.data,'$.modelID'), 'e', json_extract(m.data,'$.variant'),
      'ts', strftime('%Y-%m-%dT%H:%M:%fZ', coalesce(json_extract(m.data,'$.time.completed'), m.mt) / 1000.0, 'unixepoch'),
      'u', json_object('i', coalesce(json_extract(m.data,'$.tokens.input'),0),
        'o', coalesce(json_extract(m.data,'$.tokens.output'),0) + coalesce(json_extract(m.data,'$.tokens.reasoning'),0),
        'cr', coalesce(json_extract(m.data,'$.tokens.cache.read'),0),
        'cc', coalesce(json_extract(m.data,'$.tokens.cache.write'),0))), null, 0
  from msgs m where m.role = 'assistant' and coalesce(json_extract(m.data,'$.tokens.total'),
    json_extract(m.data,'$.tokens.input'), 0) > 0
  union all
  -- An error other than an abort.
  select m.un, m.ut, m.uid, 3, m.mt, m.id, '~~',
    json_object('k','e','t', substr(coalesce(json_extract(m.data,'$.error.data.message'), json_extract(m.data,'$.error.name')), 1, 2000)), null, 0
  from msgs m where m.role = 'assistant' and json_extract(m.data,'$.error.name') is not null
    and json_extract(m.data,'$.error.name') <> 'MessageAbortedError'
  union all
  -- The end of a turn: an abort, or the last reply's stop.
  select f.un, u.t, u.id, 4, 9e15, '', '',
    case when f.err = 'MessageAbortedError' then json_object('k','i','ts', strftime('%Y-%m-%dT%H:%M:%fZ', coalesce(f.done, u.t) / 1000.0, 'unixepoch'))
      else json_object('k','d','ms', coalesce(f.done, u.t) - u.t, 'ts', strftime('%Y-%m-%dT%H:%M:%fZ', coalesce(f.done, u.t) / 1000.0, 'unixepoch')) end, null, 0
  from fin f join win u on u.n = f.un
  where f.err is not null or (f.done is not null and f.finish is not null and f.finish <> 'tool-calls')
  union all
  -- The line after the last finished turn.
  select s.un, u.t, u.id, 5, 9e15, '', '', json_object('k','settle','id',u.id), null, 0
  from settled s join win u on u.n = s.un
  union all
  -- How many prompts this read settles, and the session's title once OpenCode names it.
  select -1, 0, '', -1, 0, '', '', json_object('k','chunk','used', (select un from settled) + 1 - :off, 'rewind', json('true')), null, 0
  union all
  select -1, 0, '', -1, 0, '', '', json_object('k','title','t', title), null, 0
  from session where id=:sid and title not like 'New session%')
select case
  when ord = 0 and comp > 0 then json_object('k','c','ts', json_extract(line,'$.ts'))
  when ord = 0 and imgs <> '[]' then json_patch(line, json_object('img', json(imgs), 'u', mid))
  else line end
from ev
where not (ord = 0 and comp = 0 and imgs = '[]' and json_extract(line,'$.t') = '')
order by un, ord <= 0 desc, ord >= 4, mt, mid, ord, pid;
