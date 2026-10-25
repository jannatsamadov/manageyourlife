-- Tasks ↔ Google Tasks both ways (owner, 2026-10-25: "sync the tasks with Google Tasks too"): the Google task of an
-- app task, as gcal_* is its calendar event. gtask_hash = what was sent last ('deleted' = the user deleted it in
-- Google; it is not sent again).
alter table public.tasks
  add column gtask_id text,
  add column gtask_list_id text,
  add column gtask_hash text;
create unique index tasks_gtask_id_key on public.tasks (user_id, gtask_id) where gtask_id is not null;

-- The links the import kept in inbox_items so far move here.
update public.tasks t
set gtask_id = i.source_ref,
    gtask_list_id = i.meta ->> 'list_id',
    gtask_hash = case when i.meta ->> 'gtask_status' = 'deleted' then 'deleted' end
from public.inbox_items i
where i.source = 'google_tasks' and i.result_type = 'task' and i.result_id = t.id and t.gtask_id is null;
