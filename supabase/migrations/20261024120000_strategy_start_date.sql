-- P-55: when a goal or mission starts, so long work shows as a line on the spiral calendar (start → due).
alter table public.strategy_nodes add column start_date date;

alter table public.strategy_nodes
  add constraint strategy_nodes_dates check (start_date is null or due_date is null or start_date <= due_date);
