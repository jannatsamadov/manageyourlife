-- The Inbox (P-70 phase 3, T-114): what Telegram, MCP and the app capture becomes a `capture` item; the kind the
-- sender gave it (/idea, /question, /todo, /resource) is a custom field "Kind" (props.kind), a hint for sorting.
-- Every workspace gets the field; the Telegram bot adds it again if it was deleted.
insert into public.fields (workspace_id, key, name, kind, options, position)
select w.id, 'kind', 'Kind', 'select',
  '[{"id":"idea","name":"Idea","color":"yellow"},{"id":"question","name":"Question","color":"blue"},{"id":"todo","name":"To-do","color":"green"},{"id":"resource","name":"Resource","color":"purple"}]'::jsonb,
  0
from public.workspaces w
on conflict (workspace_id, key) do nothing;
