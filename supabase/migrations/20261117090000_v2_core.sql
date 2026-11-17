-- Rebuild v2, phase 1 (PLAN P-70, T-112): the core of the new data model, next to the v1 tables (which stay as they
-- are until the cut-over). One identity table `items` for everything to do or track (area, goal, task, idea, capture,
-- money entry…), a main parent (tree) plus typed links (network), detail tables where the data differs (money),
-- connector rows instead of per-source columns, custom fields, saved views, time logs, and a workspace on every row.

-- ─── 1. Workspaces: every row belongs to one; one personal workspace per user now, teams later (P-33, P-16) ───
CREATE TABLE public.workspaces (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  personal_of uuid,                               -- the user whose own space this is (null = a shared workspace)
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_pkey PRIMARY KEY (id),
  CONSTRAINT workspaces_personal_of_fkey FOREIGN KEY (personal_of) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT workspaces_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX workspaces_personal_key ON public.workspaces (personal_of) WHERE personal_of IS NOT NULL;
CREATE TRIGGER workspaces_set_updated_at BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.workspace_members (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member',            -- owner / admin manage it, member writes, viewer reads
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT workspace_members_pkey PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT workspace_members_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT workspace_members_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT workspace_members_role_check CHECK (role IN ('owner', 'admin', 'member', 'viewer'))
);
CREATE INDEX workspace_members_user_idx ON public.workspace_members (user_id);

-- The caller's workspaces. SECURITY DEFINER so policies can call them without going through workspace_members' own
-- RLS; used as `workspace_id IN (SELECT …)` so they run once per query, not per row.
CREATE FUNCTION public.my_workspaces() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid())
$$;
CREATE FUNCTION public.my_writable_workspaces() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid()) AND role <> 'viewer'
$$;
-- Default workspace of rows the app creates (the server functions pass it explicitly).
CREATE FUNCTION public.personal_workspace() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id FROM public.workspaces WHERE personal_of = (SELECT auth.uid())
$$;

-- A new user gets a personal workspace.
CREATE FUNCTION public.create_personal_workspace() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ws uuid;
BEGIN
  INSERT INTO public.workspaces (name, personal_of) VALUES ('Personal', NEW.id) RETURNING id INTO ws;
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (ws, NEW.id, 'owner');
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created_workspace AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_personal_workspace();

-- …and the users who are already there.
INSERT INTO public.workspaces (name, personal_of) SELECT 'Personal', id FROM auth.users;
INSERT INTO public.workspace_members (workspace_id, user_id, role) SELECT id, personal_of, 'owner' FROM public.workspaces;

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read" ON public.workspaces FOR SELECT TO authenticated
  USING (id IN (SELECT public.my_workspaces()));
CREATE POLICY "Owners rename" ON public.workspaces FOR UPDATE TO authenticated
  USING (id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid()) AND role IN ('owner', 'admin')))
  WITH CHECK (id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = (SELECT auth.uid()) AND role IN ('owner', 'admin')));
CREATE POLICY "Members read" ON public.workspace_members FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.my_workspaces()));

-- ─── 2. Item types: the rules the DB keeps (where a type may sit, whether AI may see it). Icons, labels, fields
--        shown and progress rules live in the app's registry (src/core/types.ts). A new type = one row here. ───
CREATE TABLE public.item_types (
  type text NOT NULL,
  private boolean NOT NULL DEFAULT false,         -- never reaches MCP / AI (money, P-65)
  root_ok boolean NOT NULL DEFAULT true,          -- may stand without a parent
  parents text[],                                 -- types it may sit inside; NULL = any
  CONSTRAINT item_types_pkey PRIMARY KEY (type),
  CONSTRAINT item_types_type_check CHECK (type ~ '^[a-z][a-z_]{1,30}$')
);
INSERT INTO public.item_types (type, private, root_ok, parents) VALUES
  ('area',      false, true,  '{}'),
  ('goal',      false, true,  '{area}'),
  ('mission',   false, false, '{goal}'),
  ('step',      false, false, '{mission,step}'),  -- v1 strategy steps; phase 5 (P-54) decides whether they become tasks
  ('project',   false, true,  '{area,goal,mission,step,project}'),
  ('routine',   false, true,  '{area,goal,mission,project}'),
  ('milestone', false, true,  '{goal,mission,step,project}'),
  ('option',    false, true,  '{area,goal,mission,step,project}'),
  ('obstacle',  false, true,  '{goal,mission,step,project,task}'),
  ('task',      false, true,  '{area,goal,mission,step,project,routine,milestone,option,task}'),
  ('idea',      false, true,  '{area,goal,mission,step,project,idea}'),
  ('capture',   false, true,  '{}'),
  ('buy',       true,  true,  '{area,goal,mission,step,project}'),
  ('bill',      true,  true,  '{area}'),
  ('income',    true,  true,  '{area}'),
  ('debt',      true,  true,  '{area}'),
  ('loan',      true,  true,  '{area}');

ALTER TABLE public.item_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Everyone reads" ON public.item_types FOR SELECT TO authenticated USING (true);

-- ─── 3. Items ───
CREATE TABLE public.items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),     -- may be made on the client (offline-ready, P-70 item 9)
  workspace_id uuid NOT NULL DEFAULT public.personal_workspace(),
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'todo',
  parent_id uuid,                                 -- the main parent: the tree that progress and sums follow
  position double precision NOT NULL DEFAULT 0,   -- order among siblings (fractions: a drop between two needs no renumbering)
  url text,
  color text,
  planned_on date,                                -- the day it is planned for (Schedule)
  planned_time text,                              -- 'HH:MM' local: an event's start or a time block; needs planned_on
  is_event boolean NOT NULL DEFAULT false,        -- happens at a fixed time (meeting, exam) → a timed calendar event
  start_on date,                                  -- a span: start …
  due_on date,                                    -- … and due date / deadline
  due_time text,                                  -- 'HH:MM' of the deadline; needs due_on
  done_at timestamp with time zone,               -- follows the status
  archived_at timestamp with time zone,
  deleted_at timestamp with time zone,            -- in the trash
  priority smallint,                              -- 1 urgent · 2 high · 3 medium · 4 low · null none
  estimate_min integer,                           -- planned minutes
  spent_min integer NOT NULL DEFAULT 0,           -- the sum of its finished time logs (kept by a trigger)
  cost_planned numeric(12, 2),                    -- money it will need
  cost_spent numeric(12, 2),                      -- money it took
  weight numeric NOT NULL DEFAULT 1,              -- share in the parent's progress
  target_count integer,                           -- "at least N" done children
  progress numeric,                               -- by hand, 0..1, for an item with nothing inside
  props jsonb NOT NULL DEFAULT '{}'::jsonb,       -- custom field values by field key (table `fields`)
  created_by uuid DEFAULT auth.uid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT items_pkey PRIMARY KEY (id),
  CONSTRAINT items_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT items_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT items_type_fkey FOREIGN KEY (type) REFERENCES public.item_types(type),
  -- a parent is always in the same workspace; deleting it leaves the child at the top (if its type may stand alone)
  CONSTRAINT items_parent_fkey FOREIGN KEY (parent_id, workspace_id) REFERENCES public.items (id, workspace_id) ON DELETE SET NULL (parent_id),
  CONSTRAINT items_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT items_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 500),
  CONSTRAINT items_body_check CHECK (char_length(body) <= 100000),
  CONSTRAINT items_status_check CHECK (status IN ('todo', 'doing', 'waiting', 'someday', 'done', 'dropped')),
  CONSTRAINT items_parent_self_check CHECK (parent_id <> id),
  CONSTRAINT items_url_check CHECK (char_length(url) <= 2000),
  CONSTRAINT items_color_check CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT items_planned_time_check CHECK (planned_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT items_due_time_check CHECK (due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT items_event_check CHECK (NOT is_event OR planned_time IS NOT NULL),
  CONSTRAINT items_span_check CHECK (start_on IS NULL OR due_on IS NULL OR start_on <= due_on),
  CONSTRAINT items_priority_check CHECK (priority BETWEEN 1 AND 4),
  CONSTRAINT items_estimate_check CHECK (estimate_min > 0 AND estimate_min <= 100000),
  CONSTRAINT items_spent_check CHECK (spent_min >= 0),
  CONSTRAINT items_cost_check CHECK (cost_planned >= 0 AND cost_spent >= 0),
  CONSTRAINT items_weight_check CHECK (weight > 0 AND weight <= 100),
  CONSTRAINT items_target_check CHECK (target_count BETWEEN 1 AND 1000),
  CONSTRAINT items_progress_check CHECK (progress >= 0 AND progress <= 1),
  CONSTRAINT items_props_check CHECK (jsonb_typeof(props) = 'object')
);
CREATE INDEX items_workspace_type_idx ON public.items (workspace_id, type, position);
CREATE INDEX items_parent_idx ON public.items (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX items_planned_idx ON public.items (workspace_id, planned_on) WHERE planned_on IS NOT NULL;
CREATE INDEX items_due_idx ON public.items (workspace_id, due_on) WHERE due_on IS NOT NULL;
CREATE INDEX items_created_by_idx ON public.items (created_by);

-- Rules every writer (app, MCP, Telegram, Google, a phone app later) gets the same:
-- times go with their dates (P-60), done_at follows the status, the tree keeps its shape (types, no loops, ≤ 20 levels).
CREATE FUNCTION public.items_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  rule public.item_types;
  parent_type text;
  cur uuid;
  depth integer := 0;
BEGIN
  IF NEW.planned_on IS NULL THEN
    NEW.planned_time := NULL;
    NEW.is_event := false;
  END IF;
  IF NEW.due_on IS NULL THEN
    NEW.due_time := NULL;
  END IF;
  NEW.done_at := CASE WHEN NEW.status = 'done' THEN COALESCE(NEW.done_at, now()) END;

  IF TG_OP = 'INSERT' OR NEW.type IS DISTINCT FROM OLD.type OR NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    SELECT * INTO rule FROM public.item_types WHERE type = NEW.type;
    IF NEW.parent_id IS NULL THEN
      IF NOT rule.root_ok THEN
        RAISE EXCEPTION 'a % needs a parent', NEW.type;
      END IF;
    ELSE
      SELECT type INTO parent_type FROM public.items WHERE id = NEW.parent_id;
      IF rule.parents IS NOT NULL AND NOT (parent_type = ANY (rule.parents)) THEN
        RAISE EXCEPTION 'a % cannot be inside a %', NEW.type, parent_type;
      END IF;
      cur := NEW.parent_id;
      WHILE cur IS NOT NULL LOOP
        IF cur = NEW.id THEN
          RAISE EXCEPTION 'an item cannot be inside itself';
        END IF;
        depth := depth + 1;
        IF depth > 20 THEN
          RAISE EXCEPTION 'too many levels';
        END IF;
        SELECT parent_id INTO cur FROM public.items WHERE id = cur;
      END LOOP;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.type <> OLD.type AND EXISTS (
      SELECT 1 FROM public.items c JOIN public.item_types t ON t.type = c.type
      WHERE c.parent_id = NEW.id AND t.parents IS NOT NULL AND NOT (NEW.type = ANY (t.parents))
    ) THEN
      RAISE EXCEPTION 'the items inside cannot be inside a %', NEW.type;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER items_check BEFORE INSERT OR UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.items_check();
CREATE TRIGGER items_set_updated_at BEFORE UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Rows next to an item take the item's workspace (so the app never has to send it, and it cannot be wrong).
-- TG_ARGV[0] = the column holding the item id. Runs with the caller's rights: an item they cannot see gives NULL → refused.
CREATE FUNCTION public.item_workspace() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  SELECT workspace_id INTO NEW.workspace_id FROM public.items WHERE id = (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  RETURN NEW;
END $$;

-- ─── 4. Money details: a money entry IS an item (title, status, parent, links: "for task X I must buy Y") plus these
--        (owner, round 3). Payments and balances stay ledgers (money_payments, money_balances; moved onto items in phase 6). ───
CREATE TABLE public.money_details (
  item_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  amount numeric(12, 2) NOT NULL,                 -- per period (income, bill), the total (debt, loan), the price (buy; 0 = not known yet)
  period text,                                    -- income and bills: week / month / year
  starts_on date,
  ends_on date,
  CONSTRAINT money_details_pkey PRIMARY KEY (item_id),
  CONSTRAINT money_details_item_fkey FOREIGN KEY (item_id, workspace_id) REFERENCES public.items (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT money_details_amount_check CHECK (amount >= 0),
  CONSTRAINT money_details_period_check CHECK (period IN ('week', 'month', 'year')),
  CONSTRAINT money_details_dates_check CHECK (ends_on >= starts_on)
);
CREATE INDEX money_details_workspace_idx ON public.money_details (workspace_id);
CREATE TRIGGER money_details_workspace BEFORE INSERT OR UPDATE OF item_id ON public.money_details
  FOR EACH ROW EXECUTE FUNCTION public.item_workspace('item_id');

-- ─── 5. Links: the network next to the tree (owner, round 4). One row, two real foreign keys. ───
CREATE TABLE public.item_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  from_id uuid NOT NULL,
  to_id uuid,                                     -- another item …
  file_id uuid,                                   -- … or a note (kind 'note')
  kind text NOT NULL,
  -- part_of: from also shows inside to (not counted there) · blocks: from must be done before to · related ·
  -- needs: from (a task) needs to (a thing to buy) · came_from: from was made from to (an idea) · note: from ↔ a note file
  created_by uuid DEFAULT auth.uid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT item_links_pkey PRIMARY KEY (id),
  CONSTRAINT item_links_from_fkey FOREIGN KEY (from_id, workspace_id) REFERENCES public.items (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT item_links_to_fkey FOREIGN KEY (to_id, workspace_id) REFERENCES public.items (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT item_links_file_fkey FOREIGN KEY (file_id) REFERENCES public.vault_files(id) ON DELETE CASCADE,
  CONSTRAINT item_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT item_links_kind_check CHECK (kind IN ('part_of', 'blocks', 'related', 'needs', 'came_from', 'note')),
  CONSTRAINT item_links_target_check CHECK (
    CASE WHEN kind = 'note' THEN file_id IS NOT NULL AND to_id IS NULL ELSE to_id IS NOT NULL AND file_id IS NULL END),
  CONSTRAINT item_links_self_check CHECK (from_id <> to_id)
);
CREATE UNIQUE INDEX item_links_items_key ON public.item_links (from_id, kind, to_id) WHERE to_id IS NOT NULL;
CREATE UNIQUE INDEX item_links_files_key ON public.item_links (from_id, file_id) WHERE file_id IS NOT NULL;
CREATE INDEX item_links_to_idx ON public.item_links (to_id) WHERE to_id IS NOT NULL;
CREATE INDEX item_links_file_idx ON public.item_links (file_id) WHERE file_id IS NOT NULL;
CREATE INDEX item_links_workspace_idx ON public.item_links (workspace_id);
CREATE TRIGGER item_links_workspace BEFORE INSERT OR UPDATE OF from_id ON public.item_links
  FOR EACH ROW EXECUTE FUNCTION public.item_workspace('from_id');

-- No blocking loops; a linked note is in the vault of a member of the workspace.
CREATE FUNCTION public.item_links_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.kind = 'blocks' AND EXISTS (
    WITH RECURSIVE chain(id) AS (
      SELECT NEW.to_id
      UNION
      SELECT l.to_id FROM public.item_links l JOIN chain c ON l.from_id = c.id WHERE l.kind = 'blocks' AND l.id <> NEW.id
    )
    SELECT 1 FROM chain WHERE id = NEW.from_id
  ) THEN
    RAISE EXCEPTION 'this would make a blocking loop';
  END IF;
  IF NEW.kind = 'note' AND NOT EXISTS (
    SELECT 1 FROM public.vault_files f JOIN public.workspace_members m ON m.user_id = f.user_id
    WHERE f.id = NEW.file_id AND m.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'note not found';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER item_links_check BEFORE INSERT OR UPDATE ON public.item_links
  FOR EACH ROW EXECUTE FUNCTION public.item_links_check();

-- ─── 6. Sources: where an item also lives (connectors; replaces the gcal_* / gtask_* columns of v1 tasks). ───
CREATE TABLE public.item_sources (
  item_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  source text NOT NULL,                           -- google_tasks, google_calendar, telegram, vault, github …
  external_id text NOT NULL,                      -- its id there
  container text,                                 -- its list / calendar / repo there
  url text,
  hash text,                                      -- what was sent or read last ('deleted' = removed there, not sent again)
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT item_sources_pkey PRIMARY KEY (item_id, source),
  CONSTRAINT item_sources_item_fkey FOREIGN KEY (item_id, workspace_id) REFERENCES public.items (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT item_sources_source_check CHECK (source ~ '^[a-z][a-z0-9_]{1,30}$'),
  CONSTRAINT item_sources_meta_check CHECK (jsonb_typeof(meta) = 'object')
);
CREATE UNIQUE INDEX item_sources_external_key ON public.item_sources (workspace_id, source, external_id);
CREATE TRIGGER item_sources_workspace BEFORE INSERT OR UPDATE OF item_id ON public.item_sources
  FOR EACH ROW EXECUTE FUNCTION public.item_workspace('item_id');

-- ─── 7. Custom fields ("+ field" on a page, no code; values in items.props by key). Promoted to a column when needed. ───
CREATE TABLE public.fields (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL DEFAULT public.personal_workspace(),
  key text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,     -- select options [{id, name, color}], number format …
  item_types text[],                              -- the types it shows on; NULL = all
  position double precision NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fields_pkey PRIMARY KEY (id),
  CONSTRAINT fields_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fields_key_unique UNIQUE (workspace_id, key),
  CONSTRAINT fields_key_check CHECK (key ~ '^[a-z][a-z0-9_]{0,40}$'),
  CONSTRAINT fields_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT fields_kind_check CHECK (kind IN ('text', 'number', 'date', 'select', 'multi_select', 'checkbox', 'url', 'person', 'relation')),
  CONSTRAINT fields_options_check CHECK (jsonb_typeof(options) IN ('array', 'object'))
);
CREATE TRIGGER fields_set_updated_at BEFORE UPDATE ON public.fields
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 8. Saved views (P-69): the same rows as a table, board, timeline … with filter / sort / group by in config. ───
CREATE TABLE public.views (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL DEFAULT public.personal_workspace(),
  owner_id uuid,                                  -- NULL = shared with the workspace; set = this user's own view
  page text NOT NULL,                             -- tasks, inbox, strategy, money …
  name text NOT NULL,
  layout text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  position double precision NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT views_pkey PRIMARY KEY (id),
  CONSTRAINT views_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT views_owner_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT views_page_check CHECK (page ~ '^[a-z][a-z0-9_-]{0,40}$'),
  CONSTRAINT views_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT views_layout_check CHECK (layout IN ('table', 'board', 'timeline', 'calendar', 'gallery', 'list', 'spiral', 'cosmic')),
  CONSTRAINT views_config_check CHECK (jsonb_typeof(config) = 'object')
);
CREATE INDEX views_workspace_page_idx ON public.views (workspace_id, page, position);
CREATE INDEX views_owner_idx ON public.views (owner_id) WHERE owner_id IS NOT NULL;
CREATE TRIGGER views_set_updated_at BEFORE UPDATE ON public.views
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 9. Time logs (the timer, P-9; replaces actual_start / actual_end of v1 tasks). A manual entry is a log too. ───
CREATE TABLE public.time_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  started_at timestamp with time zone NOT NULL,
  ended_at timestamp with time zone,              -- NULL = running
  note text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT time_logs_pkey PRIMARY KEY (id),
  CONSTRAINT time_logs_item_fkey FOREIGN KEY (item_id, workspace_id) REFERENCES public.items (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT time_logs_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT time_logs_span_check CHECK (ended_at >= started_at),
  CONSTRAINT time_logs_note_check CHECK (char_length(note) <= 2000)
);
CREATE UNIQUE INDEX time_logs_running_key ON public.time_logs (user_id) WHERE ended_at IS NULL;  -- one running timer per user
CREATE INDEX time_logs_item_idx ON public.time_logs (item_id);
CREATE INDEX time_logs_workspace_idx ON public.time_logs (workspace_id);
CREATE TRIGGER time_logs_workspace BEFORE INSERT OR UPDATE OF item_id ON public.time_logs
  FOR EACH ROW EXECUTE FUNCTION public.item_workspace('item_id');
CREATE TRIGGER time_logs_set_updated_at BEFORE UPDATE ON public.time_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- items.spent_min = the minutes of the item's finished logs.
CREATE FUNCTION public.time_logs_spent() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  target uuid;
BEGIN
  FOREACH target IN ARRAY ARRAY[CASE WHEN TG_OP <> 'INSERT' THEN OLD.item_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.item_id END] LOOP
    CONTINUE WHEN target IS NULL;
    UPDATE public.items SET spent_min = (
      SELECT COALESCE(round(sum(extract(epoch FROM l.ended_at - l.started_at)) / 60), 0)::integer
      FROM public.time_logs l WHERE l.item_id = target AND l.ended_at IS NOT NULL
    ) WHERE id = target;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER time_logs_spent AFTER INSERT OR UPDATE OR DELETE ON public.time_logs
  FOR EACH ROW EXECUTE FUNCTION public.time_logs_spent();

-- ─── 10. RLS: members of a workspace read its rows, members who are not viewers write them. ───
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.views ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['items', 'money_details', 'item_links', 'item_sources', 'fields'] LOOP
    EXECUTE format('CREATE POLICY "Members read" ON public.%I FOR SELECT TO authenticated
      USING (workspace_id IN (SELECT public.my_workspaces()))', t);
    EXECUTE format('CREATE POLICY "Members add" ON public.%I FOR INSERT TO authenticated
      WITH CHECK (workspace_id IN (SELECT public.my_writable_workspaces()))', t);
    EXECUTE format('CREATE POLICY "Members change" ON public.%I FOR UPDATE TO authenticated
      USING (workspace_id IN (SELECT public.my_writable_workspaces()))
      WITH CHECK (workspace_id IN (SELECT public.my_writable_workspaces()))', t);
    EXECUTE format('CREATE POLICY "Members delete" ON public.%I FOR DELETE TO authenticated
      USING (workspace_id IN (SELECT public.my_writable_workspaces()))', t);
  END LOOP;
END $$;

-- Time logs: everyone in the workspace sees them; each person writes only their own.
CREATE POLICY "Members read" ON public.time_logs FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.my_workspaces()));
CREATE POLICY "Own logs" ON public.time_logs FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND workspace_id IN (SELECT public.my_writable_workspaces()));
CREATE POLICY "Own logs change" ON public.time_logs FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND workspace_id IN (SELECT public.my_writable_workspaces()));
CREATE POLICY "Own logs delete" ON public.time_logs FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Views: shared ones for the workspace, own ones only for their owner.
CREATE POLICY "Members read" ON public.views FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.my_workspaces()) AND (owner_id IS NULL OR owner_id = (SELECT auth.uid())));
CREATE POLICY "Members add" ON public.views FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.my_writable_workspaces()) AND (owner_id IS NULL OR owner_id = (SELECT auth.uid())));
CREATE POLICY "Members change" ON public.views FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT public.my_writable_workspaces()) AND (owner_id IS NULL OR owner_id = (SELECT auth.uid())))
  WITH CHECK (workspace_id IN (SELECT public.my_writable_workspaces()) AND (owner_id IS NULL OR owner_id = (SELECT auth.uid())));
CREATE POLICY "Members delete" ON public.views FOR DELETE TO authenticated
  USING (workspace_id IN (SELECT public.my_writable_workspaces()) AND (owner_id IS NULL OR owner_id = (SELECT auth.uid())));
