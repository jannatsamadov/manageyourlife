-- Baseline: exact copy of the live Lovable Cloud schema, taken from the database catalog on 2026-10-22.
-- It replaces the earlier migrations, which had drifted from the real database
-- (subtasks table and several tasks/notes columns were only ever pasted into the SQL editor).
-- Improvements go in later migrations, never here.

-- notes
CREATE TABLE public.notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Untitled'::text,
  content text NOT NULL DEFAULT ''::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone,
  CONSTRAINT notes_pkey PRIMARY KEY (id),
  CONSTRAINT notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- tasks
CREATE TABLE public.tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT ''::text,
  estimated_time integer,
  status text NOT NULL DEFAULT 'idle'::text,
  actual_start timestamp with time zone,
  actual_end timestamp with time zone,
  date date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  execution_date date,
  category text NOT NULL DEFAULT 'general'::text,
  "position" integer NOT NULL DEFAULT 0,
  link text NOT NULL DEFAULT ''::text,
  priority text NOT NULL DEFAULT 'medium'::text,
  deadline text NOT NULL DEFAULT ''::text,
  linked_note_id uuid,
  deleted_at timestamp with time zone,
  weight integer NOT NULL DEFAULT 1,
  attribute_tag text NOT NULL DEFAULT 'general'::text,
  CONSTRAINT tasks_pkey PRIMARY KEY (id),
  CONSTRAINT tasks_priority_check CHECK ((priority = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
  CONSTRAINT tasks_status_check CHECK ((status = ANY (ARRAY['idle'::text, 'active'::text, 'complete'::text, 'abandoned'::text]))),
  CONSTRAINT tasks_linked_note_id_fkey FOREIGN KEY (linked_note_id) REFERENCES public.notes(id) ON DELETE SET NULL,
  CONSTRAINT tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- subtasks (checklist items of a task; note_id set when the item comes from a note's to-do list)
CREATE TABLE public.subtasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  parent_task_id uuid,
  note_id uuid,
  title text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  "position" integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT subtasks_pkey PRIMARY KEY (id),
  CONSTRAINT subtasks_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE,
  CONSTRAINT subtasks_parent_task_id_fkey FOREIGN KEY (parent_task_id) REFERENCES public.tasks(id) ON DELETE CASCADE
);

-- note_task_links
CREATE TABLE public.note_task_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL,
  task_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT note_task_links_pkey PRIMARY KEY (id),
  CONSTRAINT note_task_links_note_id_task_id_key UNIQUE (note_id, task_id),
  CONSTRAINT note_task_links_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE,
  CONSTRAINT note_task_links_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE
);

-- opportunities
CREATE TABLE public.opportunities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT ''::text,
  estimated_time integer,
  deadline date NOT NULL,
  link text NOT NULL DEFAULT ''::text,
  priority text NOT NULL DEFAULT 'medium'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT opportunities_pkey PRIMARY KEY (id),
  CONSTRAINT opportunities_priority_check CHECK ((priority = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
  CONSTRAINT opportunities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- user_attributes
CREATE TABLE public.user_attributes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  attribute text NOT NULL,
  value numeric NOT NULL DEFAULT 0,
  max_value numeric NOT NULL DEFAULT 100,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_attributes_pkey PRIMARY KEY (id),
  CONSTRAINT user_attributes_user_id_attribute_key UNIQUE (user_id, attribute)
);

-- task_shares
CREATE TABLE public.task_shares (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  recipient_email text NOT NULL,
  recipient_id uuid,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT task_shares_pkey PRIMARY KEY (id)
);

-- Row level security
ALTER TABLE public.note_task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_attributes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own note_task_links" ON public.note_task_links AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can manage own notes" ON public.notes AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can create their own opportunities" ON public.opportunities AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own opportunities" ON public.opportunities AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can update their own opportunities" ON public.opportunities AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own opportunities" ON public.opportunities AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));

CREATE POLICY "Users can create their own subtasks" ON public.subtasks AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own subtasks" ON public.subtasks AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can update their own subtasks" ON public.subtasks AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own subtasks" ON public.subtasks AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));

CREATE POLICY "Recipients can update share status" ON public.task_shares AS PERMISSIVE FOR UPDATE TO public
  USING (((auth.uid() = recipient_id) OR ((recipient_id IS NULL) AND (recipient_email = (( SELECT users.email
   FROM auth.users
  WHERE (users.id = auth.uid())))::text))));
CREATE POLICY "Recipients can view incoming shares" ON public.task_shares AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = recipient_id) OR ((recipient_id IS NULL) AND (recipient_email = (( SELECT users.email
   FROM auth.users
  WHERE (users.id = auth.uid())))::text))));
CREATE POLICY "Senders can manage own shares" ON public.task_shares AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = sender_id)) WITH CHECK ((auth.uid() = sender_id));

CREATE POLICY "Users can create their own tasks" ON public.tasks AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can delete their own tasks" ON public.tasks AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can update their own tasks" ON public.tasks AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can view their own tasks" ON public.tasks AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));

CREATE POLICY "Users can manage own attributes" ON public.user_attributes AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
