-- Rebuild v2, phase 1 (PLAN P-70, T-112): copy the v1 data into the v2 tables with the same ids.
-- v1 stays the truth until the cut-over (the live app, MCP, Telegram and Google still use it). The cut-over migration
-- runs this function once more — it first EMPTIES the v2 tables, so anything made only in v2 while testing is dropped —
-- and then drops it. Never run it after the cut-over.
--
-- What is copied: strategy_nodes → area / goal / mission / step items · tasks → task items (node_id → main parent,
-- gcal_* / gtask_* → item_sources, actual_end → done_at) · subtasks typed in a task → child tasks ·
-- note_task_links → 'note' links · money_items → items + money_details · inbox_items → capture items.
-- Not copied: the subtasks that are copies of a linked note's "- [ ]" lines (the note stays their truth; phase 4 reads
-- them from the file), task_shares (empty), category / attribute_tag / weight of tasks (all default), the unused tables,
-- and actual_start / actual_end as time logs: v1 stamped both at once when a task was ticked (24 of 26 spans are
-- 0 minutes, the other two a timer left running for 14 h and 17 days), so they hold no time spent.

CREATE FUNCTION public.v2_copy_from_v1() RETURNS jsonb
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  n integer;
BEGIN
  -- every user has a personal workspace (users who signed up since the core migration got one from the trigger)
  INSERT INTO public.workspaces (name, personal_of)
    SELECT 'Personal', u.id FROM auth.users u WHERE NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.personal_of = u.id);
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
    SELECT id, personal_of, 'owner' FROM public.workspaces WHERE personal_of IS NOT NULL
    ON CONFLICT DO NOTHING;

  DELETE FROM public.items;                       -- with it: money_details, item_links, item_sources, time_logs

  -- strategy: level by level, so each parent is there before its children
  INSERT INTO public.items (id, workspace_id, type, title, body, status, parent_id, position, color, start_on, due_on,
                            done_at, weight, target_count, progress, created_by, created_at, updated_at)
  SELECT s.id, w.id, s.kind, s.title, s.description, CASE s.status WHEN 'open' THEN 'todo' ELSE s.status END, NULL,
         s.position, s.color, s.start_date, s.due_date, s.done_at, s.weight, s.target_count, s.progress, s.user_id,
         s.created_at, s.updated_at
  FROM public.strategy_nodes s JOIN public.workspaces w ON w.personal_of = s.user_id
  WHERE s.parent_id IS NULL;
  LOOP
    INSERT INTO public.items (id, workspace_id, type, title, body, status, parent_id, position, color, start_on, due_on,
                              done_at, weight, target_count, progress, created_by, created_at, updated_at)
    SELECT s.id, w.id, s.kind, s.title, s.description, CASE s.status WHEN 'open' THEN 'todo' ELSE s.status END, s.parent_id,
           s.position, s.color, s.start_date, s.due_date, s.done_at, s.weight, s.target_count, s.progress, s.user_id,
           s.created_at, s.updated_at
    FROM public.strategy_nodes s JOIN public.workspaces w ON w.personal_of = s.user_id
    WHERE s.parent_id IN (SELECT id FROM public.items) AND s.id NOT IN (SELECT id FROM public.items);
    GET DIAGNOSTICS n = ROW_COUNT;
    EXIT WHEN n = 0;
  END LOOP;

  -- tasks (a task serving a strategy node sits inside it)
  INSERT INTO public.items (id, workspace_id, type, title, body, status, parent_id, position, url, planned_on, planned_time,
                            is_event, due_on, due_time, done_at, deleted_at, priority, estimate_min, created_by, created_at, updated_at)
  SELECT t.id, w.id, 'task', left(btrim(t.title), 500), t.description,
         CASE t.status WHEN 'idle' THEN 'todo' WHEN 'active' THEN 'doing' WHEN 'complete' THEN 'done' ELSE 'dropped' END,
         t.node_id, t.position, nullif(btrim(t.link), ''), t.date, t.start_time, t.is_event,
         CASE WHEN t.deadline ~ '^\d{4}-\d{2}-\d{2}$' THEN t.deadline::date END, t.deadline_time,
         CASE WHEN t.status = 'complete' THEN COALESCE(t.actual_end, t.created_at) END, t.deleted_at,
         CASE t.priority WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END,
         CASE WHEN t.estimated_time > 0 THEN t.estimated_time END, t.user_id, t.created_at,
         GREATEST(t.created_at, t.actual_start, t.actual_end, t.deleted_at)
  FROM public.tasks t JOIN public.workspaces w ON w.personal_of = t.user_id;

  -- subtasks typed in a task → child tasks
  INSERT INTO public.items (id, workspace_id, type, title, status, parent_id, position, done_at, created_by, created_at, updated_at)
  SELECT s.id, w.id, 'task', left(btrim(s.title), 500), CASE WHEN s.completed THEN 'done' ELSE 'todo' END, s.parent_task_id,
         s.position, CASE WHEN s.completed THEN s.updated_at END, s.user_id, s.created_at, s.updated_at
  FROM public.subtasks s JOIN public.workspaces w ON w.personal_of = s.user_id
  WHERE s.parent_task_id IS NOT NULL AND s.note_id IS NULL;

  -- Google Calendar events and Google Tasks of tasks
  INSERT INTO public.item_sources (item_id, workspace_id, source, external_id, container, hash)
  SELECT t.id, w.id, 'google_calendar', t.gcal_event_id, t.gcal_calendar_id, t.gcal_hash
  FROM public.tasks t JOIN public.workspaces w ON w.personal_of = t.user_id WHERE t.gcal_event_id IS NOT NULL;
  INSERT INTO public.item_sources (item_id, workspace_id, source, external_id, container, hash)
  SELECT t.id, w.id, 'google_tasks', t.gtask_id, t.gtask_list_id, t.gtask_hash
  FROM public.tasks t JOIN public.workspaces w ON w.personal_of = t.user_id WHERE t.gtask_id IS NOT NULL;

  -- notes linked to tasks
  INSERT INTO public.item_links (workspace_id, from_id, file_id, kind, created_by, created_at)
  SELECT w.id, l.task_id, l.note_id, 'note', l.user_id, l.created_at
  FROM public.note_task_links l JOIN public.workspaces w ON w.personal_of = l.user_id;

  -- money: a thing to buy is done when it was bought; a debt / loan when it was paid back in full
  INSERT INTO public.items (id, workspace_id, type, title, body, status, position, done_at, created_by, created_at, updated_at)
  SELECT m.id, w.id, m.kind, m.name, m.note,
         CASE WHEN (m.kind = 'buy' AND p.paid > 0) OR (m.kind IN ('debt', 'loan') AND p.paid >= m.amount) THEN 'done' ELSE 'todo' END,
         m.position, p.last_paid, m.user_id, m.created_at, m.updated_at
  FROM public.money_items m JOIN public.workspaces w ON w.personal_of = m.user_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(amount) FILTER (WHERE paid_at IS NOT NULL), 0) AS paid, max(paid_at) AS last_paid
    FROM public.money_payments WHERE item_id = m.id
  ) p ON true;
  INSERT INTO public.money_details (item_id, workspace_id, amount, period, starts_on, ends_on)
  SELECT m.id, w.id, m.amount, m.period, m.starts_on, m.ends_on
  FROM public.money_items m JOIN public.workspaces w ON w.personal_of = m.user_id;

  -- Inbox captures (v1 table; all of them sorted already)
  INSERT INTO public.items (id, workspace_id, type, title, body, status, url, done_at, archived_at, deleted_at, props,
                            created_by, created_at, updated_at)
  SELECT i.id, w.id, 'capture', COALESCE(nullif(left(btrim(split_part(i.content, E'\n', 1)), 500), ''), '(empty)'), i.content,
         CASE WHEN i.result_type = 'deleted' THEN 'dropped' WHEN i.sorted_at IS NOT NULL THEN 'done' ELSE 'todo' END,
         COALESCE(i.source_url, i.meta -> 'links' ->> 0),
         CASE WHEN i.sorted_at IS NOT NULL AND i.result_type IS DISTINCT FROM 'deleted' THEN i.sorted_at END,
         CASE WHEN i.result_type IS DISTINCT FROM 'deleted' THEN i.sorted_at END,
         CASE WHEN i.result_type = 'deleted' THEN i.sorted_at END,
         jsonb_strip_nulls(jsonb_build_object('kind', i.kind, 'sorted_as', i.result_type, 'attachments', nullif(i.attachments, '[]'::jsonb))),
         i.user_id, i.created_at, i.updated_at
  FROM public.inbox_items i JOIN public.workspaces w ON w.personal_of = i.user_id;
  INSERT INTO public.item_sources (item_id, workspace_id, source, external_id, url, meta, synced_at)
  SELECT i.id, w.id, i.source, COALESCE(i.source_ref, i.id::text), i.source_url, i.meta, i.created_at
  FROM public.inbox_items i JOIN public.workspaces w ON w.personal_of = i.user_id;

  RETURN (SELECT jsonb_object_agg(type, c) FROM (SELECT type, count(*) AS c FROM public.items GROUP BY type) x)
    || jsonb_build_object(
      'item_links', (SELECT count(*) FROM public.item_links),
      'item_sources', (SELECT count(*) FROM public.item_sources),
      'time_logs', (SELECT count(*) FROM public.time_logs),
      'money_details', (SELECT count(*) FROM public.money_details));
END $$;

-- Only migrations run it (a signed-in user calling it through the API could empty their own v2 data).
REVOKE EXECUTE ON FUNCTION public.v2_copy_from_v1() FROM PUBLIC, anon, authenticated;

SELECT public.v2_copy_from_v1();
