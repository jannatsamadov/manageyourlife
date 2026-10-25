-- The Tasks page (P-53): to-dos of a folder or a single file the user hid there (downloaded repos, course material).
alter table public.vault_folders add column todos_hidden boolean not null default false;
