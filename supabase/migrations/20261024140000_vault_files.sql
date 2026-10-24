-- P-21: notes as files. The files live in R2 (users/<id>/vault/…, synced with the laptop by rclone); this table is only
-- an index of them, rebuilt from R2 by the `vault` function (which also does every write). Users read their own rows.
create table public.vault_files (
  user_id uuid not null references auth.users (id) on delete cascade,
  path text not null check (path <> '' and path !~ '(^/|\\|(^|/)\.\.(/|$))'),
  etag text not null,
  size bigint not null,
  modified_at timestamptz not null,
  title text not null,
  tags text[] not null default '{}',
  links text[] not null default '{}',
  todo_open integer not null default 0,
  todo_done integer not null default 0,
  body text,
  indexed_at timestamptz not null default now(),
  primary key (user_id, path)
);

alter table public.vault_files enable row level security;
create policy "Users read own rows" on public.vault_files for select using (auth.uid() = user_id);
