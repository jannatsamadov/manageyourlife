-- P-57 (after the four app notes became files with their old ids): task links point at the note files now.
-- A trashed note keeps its row (and links) until it is deleted for good.
alter table public.note_task_links
  add constraint note_task_links_note_id_fkey foreign key (note_id) references public.vault_files (id) on delete cascade;
alter table public.subtasks
  add constraint subtasks_note_id_fkey foreign key (note_id) references public.vault_files (id) on delete cascade;
alter table public.tasks
  add constraint tasks_linked_note_id_fkey foreign key (linked_note_id) references public.vault_files (id) on delete set null;
