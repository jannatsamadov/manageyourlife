-- When a task happens (P-60, owner 2026-10-25). An event happens at a fixed time — a meeting, an exam, a conference —
-- and goes to Google Calendar as a timed event. Everything else is said by the fields the task already has: a planned
-- day (date, optionally the start of a time block), a deadline (optionally its time), or neither (it waits in the
-- store). Times are the user's local "HH:MM".
alter table public.tasks
  add column is_event boolean not null default false,
  add column start_time text,
  add column deadline_time text;

-- No planned day → no time block and no event; no deadline → no deadline time. Done here, so every writer (app,
-- MCP, Google import, shares) keeps the fields consistent — e.g. a task dragged back to Unscheduled.
create function public.tasks_timing() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.date is null then
    new.start_time := null;
    new.is_event := false;
  end if;
  if coalesce(new.deadline, '') = '' then
    new.deadline_time := null;
  end if;
  return new;
end $$;
create trigger tasks_timing before insert or update on public.tasks
  for each row execute function public.tasks_timing();

alter table public.tasks
  add constraint tasks_start_time_check check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint tasks_deadline_time_check check (deadline_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint tasks_event_check check (not is_event or start_time is not null);
