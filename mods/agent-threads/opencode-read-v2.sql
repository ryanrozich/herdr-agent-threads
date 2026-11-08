-- agent-threads: one read of an OpenCode 2.x session, from session_message (opencode.sh read).
-- Same bindings and output as opencode-read.sql: :sid the session, :off the settled prompts to
-- skip, :win how many prompts to read. 2.x keeps a whole message in one row, typed user,
-- assistant, idle, system or compaction, in seq order. A reply has no parent id: it belongs to
-- the prompt before it. A queued prompt gets its row only once the turn before it ends, and an
-- "idle" row follows the last turn of a run. Selects named fields only: reasoning, tool input
-- and output, and image data never leave the database.
with msg as (
  select id, seq, type, time_created t, data from session_message where session_id=:sid),
-- A prompt, or a compaction, which takes a prompt's place as it did in 1.x.
users as (
  select id, seq, t, type, data, row_number() over (order by seq) - 1 n,
    lead(seq) over (order by seq) nseq
  from msg where type in ('user','compaction')),
win as (select * from users where n >= :off and n < :off + :win),
msgs as (
  select m.id, m.seq, m.t mt, m.type, m.data, u.n un, u.t ut, u.id uid
  from msg m join win u on m.seq > u.seq and (u.nseq is null or m.seq < u.nseq)
  where m.type in ('assistant','idle')),
last as (
  select un, data, row_number() over (partition by un order by seq desc) r
  from msgs where type='assistant'),
fin as (
  select w.n un, w.t ut, w.id uid, l.data ld,
    json_extract(l.data,'$.error.type') err, json_extract(l.data,'$.time.completed') done,
    json_extract(l.data,'$.finish') finish,
    (select json_extract(i.data,'$.outcome') from msgs i where i.un = w.n and i.type = 'idle' order by i.seq desc limit 1) idle,
    (select i.mt from msgs i where i.un = w.n and i.type = 'idle' order by i.seq desc limit 1) idleAt,
    w.type wtype, json_extract(w.data,'$.status') cstatus
  from win w left join last l on l.un = w.n and l.r = 1),
-- A turn is finished when its last reply stopped or failed, an idle row follows it, or its
-- compaction completed. It was stopped when the reply was aborted or the idle row says so.
done as (
  select un, ut, uid, coalesce(done, idleAt, ut) at,
    err = 'aborted' or idle = 'interrupted' stopped
  from fin
  where err is not null or idle is not null or (finish is not null and finish <> 'tool-calls')
    or (wtype = 'compaction' and cstatus = 'completed')),
settled as (select coalesce(max(un), :off - 1) un from done),
items as (
  select m.un, m.seq, m.id, c.key ord, json_extract(c.value,'$.type') ty, c.value v
  from msgs m, json_each(m.data,'$.content') c
  where m.type = 'assistant' and json_extract(c.value,'$.type') in ('text','tool')),
ev as (
  -- The prompt: its typed text and the image types. Image data stays in the database.
  select w.n un, w.seq, 0 ord, '' pid, w.id mid,
    case w.type when 'compaction' then json_object('k','c','ts', strftime('%Y-%m-%dT%H:%M:%fZ', w.t / 1000.0, 'unixepoch'))
    else json_object('k','p','o','human','ts', strftime('%Y-%m-%dT%H:%M:%fZ', w.t / 1000.0, 'unixepoch'),
      't', substr(coalesce(json_extract(w.data,'$.text'), ''), 1, 200000)) end line,
    (select json_group_array(json_extract(f.value,'$.mime')) from json_each(w.data,'$.files') f
      where json_extract(f.value,'$.mime') like 'image/%') imgs,
    w.type wtype
  from win w
  union all
  -- A reply's text and tool calls, in order.
  select x.un, x.seq, 1, printf('%06d', x.ord), x.id,
    case x.ty when 'text' then json_object('k','t','t', substr(json_extract(x.v,'$.text'), 1, 200000))
      else json_object('k','u','n', json_extract(x.v,'$.name')) end, null, ''
  from items x
  where x.ty <> 'text' or length(json_extract(x.v,'$.text')) > 0
  union all
  -- A reply's tokens. input leaves out the cached tokens, output leaves out reasoning.
  select m.un, m.seq, 2, '~', m.id,
    json_object('k','m','id', m.id, 'a', json_extract(m.data,'$.agent'), 'm', json_extract(m.data,'$.model.id'),
      'e', nullif(json_extract(m.data,'$.model.variant'), 'default'),
      'ts', strftime('%Y-%m-%dT%H:%M:%fZ', coalesce(json_extract(m.data,'$.time.completed'), m.mt) / 1000.0, 'unixepoch'),
      'u', json_object('i', coalesce(json_extract(m.data,'$.tokens.input'),0),
        'o', coalesce(json_extract(m.data,'$.tokens.output'),0) + coalesce(json_extract(m.data,'$.tokens.reasoning'),0),
        'cr', coalesce(json_extract(m.data,'$.tokens.cache.read'),0),
        'cc', coalesce(json_extract(m.data,'$.tokens.cache.write'),0))), null, ''
  from msgs m where m.type = 'assistant'
    and coalesce(json_extract(m.data,'$.tokens.input'),0) + coalesce(json_extract(m.data,'$.tokens.output'),0)
      + coalesce(json_extract(m.data,'$.tokens.cache.read'),0) + coalesce(json_extract(m.data,'$.tokens.cache.write'),0) > 0
  union all
  -- An error other than an abort.
  select m.un, m.seq, 3, '~~', m.id,
    json_object('k','e','t', substr(coalesce(json_extract(m.data,'$.error.message'), json_extract(m.data,'$.error.type')), 1, 2000)), null, ''
  from msgs m where m.type = 'assistant' and json_extract(m.data,'$.error.type') is not null
    and json_extract(m.data,'$.error.type') <> 'aborted'
  union all
  -- The end of a turn: an abort, or the last reply's stop.
  select d.un, 9e15, 4, '', '',
    case when d.stopped then json_object('k','i','ts', strftime('%Y-%m-%dT%H:%M:%fZ', d.at / 1000.0, 'unixepoch'))
      else json_object('k','d','ms', d.at - d.ut, 'ts', strftime('%Y-%m-%dT%H:%M:%fZ', d.at / 1000.0, 'unixepoch')) end, null, ''
  from done d
  union all
  -- The line after the last finished turn.
  select s.un, 9e15, 5, '', '', json_object('k','settle','id',w.id), null, ''
  from settled s join win w on w.n = s.un
  union all
  -- How many prompts this read settles, and the session's title once OpenCode names it.
  select -1, 0, -1, '', '', json_object('k','chunk','used', (select un from settled) + 1 - :off, 'rewind', json('true')), null, ''
  union all
  select -1, 0, -1, '', '', json_object('k','title','t', title), null, ''
  from session_v2 where id=:sid and title is not null and title <> '' and title not like 'New session%')
select case
  when ord = 0 and imgs <> '[]' and wtype = 'user' then json_patch(line, json_object('img', json(imgs), 'u', mid))
  else line end
from ev
where not (ord = 0 and wtype = 'user' and imgs = '[]' and json_extract(line,'$.t') = '')
order by un, ord <= 0 desc, ord >= 4, seq, ord, pid;
