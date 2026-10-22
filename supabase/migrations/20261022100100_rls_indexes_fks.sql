-- Hardening on top of the baseline.
-- 1. Missing foreign keys (rows of a deleted user or task are removed with it).
-- 2. Indexes on foreign-key / RLS columns.
-- 3. RLS policies: one policy per owner table, only for signed-in users,
--    auth.uid() wrapped in a sub-select so it runs once per query (Supabase advisor).
-- 4. Task sharing works: recipients are matched by the email in their JWT (the old policies read
--    auth.users, which signed-in users cannot read, so every read of task_shares failed),
--    and a recipient may read the shared task to copy it.
-- 5. updated_at kept current by a trigger.

-- 1. foreign keys
ALTER TABLE public.subtasks
  ADD CONSTRAINT subtasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.note_task_links
  ADD CONSTRAINT note_task_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_attributes
  ADD CONSTRAINT user_attributes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.task_shares
  ADD CONSTRAINT task_shares_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE,
  ADD CONSTRAINT task_shares_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD CONSTRAINT task_shares_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. indexes
CREATE INDEX tasks_user_id_idx ON public.tasks (user_id);
CREATE INDEX tasks_linked_note_id_idx ON public.tasks (linked_note_id);
CREATE INDEX notes_user_id_idx ON public.notes (user_id);
CREATE INDEX subtasks_user_id_idx ON public.subtasks (user_id);
CREATE INDEX subtasks_parent_task_id_idx ON public.subtasks (parent_task_id);
CREATE INDEX subtasks_note_id_idx ON public.subtasks (note_id);
CREATE INDEX note_task_links_task_id_idx ON public.note_task_links (task_id);
CREATE INDEX note_task_links_user_id_idx ON public.note_task_links (user_id);
CREATE INDEX opportunities_user_id_idx ON public.opportunities (user_id);
CREATE INDEX task_shares_task_id_idx ON public.task_shares (task_id);
CREATE INDEX task_shares_sender_id_idx ON public.task_shares (sender_id);
CREATE INDEX task_shares_recipient_id_idx ON public.task_shares (recipient_id);

-- 3. owner policies
DROP POLICY "Users can manage own note_task_links" ON public.note_task_links;
DROP POLICY "Users can manage own notes" ON public.notes;
DROP POLICY "Users can create their own opportunities" ON public.opportunities;
DROP POLICY "Users can delete their own opportunities" ON public.opportunities;
DROP POLICY "Users can update their own opportunities" ON public.opportunities;
DROP POLICY "Users can view their own opportunities" ON public.opportunities;
DROP POLICY "Users can create their own subtasks" ON public.subtasks;
DROP POLICY "Users can delete their own subtasks" ON public.subtasks;
DROP POLICY "Users can update their own subtasks" ON public.subtasks;
DROP POLICY "Users can view their own subtasks" ON public.subtasks;
DROP POLICY "Users can create their own tasks" ON public.tasks;
DROP POLICY "Users can delete their own tasks" ON public.tasks;
DROP POLICY "Users can update their own tasks" ON public.tasks;
DROP POLICY "Users can view their own tasks" ON public.tasks;
DROP POLICY "Users can manage own attributes" ON public.user_attributes;

CREATE POLICY "Users manage own rows" ON public.tasks FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users manage own rows" ON public.notes FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users manage own rows" ON public.subtasks FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users manage own rows" ON public.note_task_links FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users manage own rows" ON public.opportunities FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users manage own rows" ON public.user_attributes FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

-- 4. share policies
DROP POLICY "Senders can manage own shares" ON public.task_shares;
DROP POLICY "Recipients can view incoming shares" ON public.task_shares;
DROP POLICY "Recipients can update share status" ON public.task_shares;

CREATE POLICY "Senders manage own shares" ON public.task_shares FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = sender_id) WITH CHECK ((SELECT auth.uid()) = sender_id);
CREATE POLICY "Recipients view incoming shares" ON public.task_shares FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) = recipient_id
    OR (recipient_id IS NULL AND lower(recipient_email) = lower((SELECT auth.jwt() ->> 'email')))
  );
CREATE POLICY "Recipients answer incoming shares" ON public.task_shares FOR UPDATE TO authenticated
  USING (
    (SELECT auth.uid()) = recipient_id
    OR (recipient_id IS NULL AND lower(recipient_email) = lower((SELECT auth.jwt() ->> 'email')))
  )
  WITH CHECK ((SELECT auth.uid()) = recipient_id);
CREATE POLICY "Recipients read shared tasks" ON public.tasks FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.task_shares s
    WHERE s.task_id = tasks.id
      AND ((SELECT auth.uid()) = s.recipient_id
        OR (s.recipient_id IS NULL AND lower(s.recipient_email) = lower((SELECT auth.jwt() ->> 'email'))))
  ));

-- 5. updated_at
CREATE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER notes_set_updated_at BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER subtasks_set_updated_at BEFORE UPDATE ON public.subtasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER user_attributes_set_updated_at BEFORE UPDATE ON public.user_attributes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
