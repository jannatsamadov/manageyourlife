-- Sync on change (P-48, T-83): the laptop's sync watcher listens (Realtime) to one small row per user that changes
-- whenever a file changes in the app (edit, tick on the Tasks page, Telegram, MCP, move, trash, restore). It is only a
-- ping — the watcher then asks vault_files what changed; vault_files itself carries whole notes, too big to stream.
create table public.vault_signals (
  user_id uuid primary key references auth.users (id) on delete cascade,
  changed_at timestamptz not null default now()
);
alter table public.vault_signals enable row level security;
create policy "Users read own row" on public.vault_signals for select using (auth.uid() = user_id);

-- One ping per statement: rows written together share now(), so only the first one moves changed_at.
create function public.vault_signal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.vault_signals (user_id, changed_at) values (new.user_id, now())
  on conflict (user_id) do update set changed_at = excluded.changed_at
    where public.vault_signals.changed_at < excluded.changed_at;
  return null;
end $$;
revoke execute on function public.vault_signal() from public, anon, authenticated;

create trigger vault_files_signal after insert or update of etag, path, trashed_at on public.vault_files
  for each row execute function public.vault_signal();

alter publication supabase_realtime add table public.vault_signals;
