-- P-57: one notes system. Notes are the files of the vault (vault_files); every note gets a stable id that survives
-- renames and moves, a trash state (restore keeps the id, so task links survive) and a short excerpt for cards.
-- Links from tasks move from the old notes table (kept as a backup, no longer written) to the files.

alter table public.vault_files drop constraint vault_files_pkey;
alter table public.vault_files add column id uuid not null default gen_random_uuid() primary key;
alter table public.vault_files add column excerpt text;
alter table public.vault_files add column trashed_at timestamptz;
alter table public.vault_files add column trash_key text; -- where the file waits in R2 while trashed
create unique index vault_files_live_path on public.vault_files (user_id, path) where trashed_at is null;
create index vault_files_trashed on public.vault_files (user_id, trashed_at) where trashed_at is not null;

-- The old foreign keys point at notes(id); the four app notes become files with the same ids (data step), then the
-- new keys are added by the next migration.
alter table public.note_task_links drop constraint note_task_links_note_id_fkey;
alter table public.subtasks drop constraint subtasks_note_id_fkey;
alter table public.tasks drop constraint tasks_linked_note_id_fkey;

-- Folder look in the gallery (colour); a folder is only a path, so this is keyed by path.
create table public.vault_folders (
  user_id uuid not null references auth.users (id) on delete cascade,
  path text not null,
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);
alter table public.vault_folders enable row level security;
create policy "Users manage own rows" on public.vault_folders for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Daily Telegram drafts are named by the user's own date.
alter table public.telegram_links add column time_zone text not null default 'UTC';
