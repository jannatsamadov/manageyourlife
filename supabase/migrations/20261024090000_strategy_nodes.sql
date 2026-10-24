-- Strategy (P-2, P-24): one tree per user — area → goal → mission → step (steps nest).
-- Themes draw it (first: a solar system — goal = star, mission = planet, step = moon); daily tasks serve a node.

-- 1. strategy_nodes
CREATE TABLE public.strategy_nodes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  parent_id uuid,
  kind text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  weight numeric NOT NULL DEFAULT 1,             -- share in the parent's progress
  target_count integer,                          -- "at least N": progress counts done children out of N
  progress numeric,                              -- set by hand on a node without children / tasks (0..1)
  due_date date,
  done_at timestamp with time zone,
  position integer NOT NULL DEFAULT 0,
  color text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT strategy_nodes_pkey PRIMARY KEY (id),
  CONSTRAINT strategy_nodes_id_user_key UNIQUE (id, user_id),
  CONSTRAINT strategy_nodes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  -- a parent always belongs to the same user
  CONSTRAINT strategy_nodes_parent_fkey FOREIGN KEY (parent_id, user_id) REFERENCES public.strategy_nodes (id, user_id) ON DELETE CASCADE,
  CONSTRAINT strategy_nodes_kind_check CHECK (kind IN ('area', 'goal', 'mission', 'step')),
  CONSTRAINT strategy_nodes_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
  CONSTRAINT strategy_nodes_description_check CHECK (char_length(description) <= 20000),
  CONSTRAINT strategy_nodes_status_check CHECK (status IN ('open', 'done', 'dropped')),
  CONSTRAINT strategy_nodes_weight_check CHECK (weight > 0 AND weight <= 100),
  CONSTRAINT strategy_nodes_target_check CHECK (target_count BETWEEN 1 AND 100),
  CONSTRAINT strategy_nodes_progress_check CHECK (progress >= 0 AND progress <= 1),
  CONSTRAINT strategy_nodes_color_check CHECK (color ~ '^#[0-9a-fA-F]{6}$')
);

CREATE INDEX strategy_nodes_user_idx ON public.strategy_nodes (user_id, position);
CREATE INDEX strategy_nodes_parent_idx ON public.strategy_nodes (parent_id) WHERE parent_id IS NOT NULL;

ALTER TABLE public.strategy_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own rows" ON public.strategy_nodes FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

-- 2. Shape: area at the top, goal in an area (or alone), mission in a goal, step in a mission or a step;
--    no cycles, at most 10 levels; done_at follows the status.
CREATE FUNCTION public.strategy_nodes_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  parent_kind text;
  cur uuid;
  depth integer := 0;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.kind <> OLD.kind
     AND EXISTS (SELECT 1 FROM public.strategy_nodes WHERE parent_id = NEW.id) THEN
    RAISE EXCEPTION 'the kind of a node with children cannot change';
  END IF;

  IF NEW.parent_id IS NULL THEN
    IF NEW.kind NOT IN ('area', 'goal') THEN
      RAISE EXCEPTION 'a % needs a parent', NEW.kind;
    END IF;
  ELSE
    SELECT kind INTO parent_kind FROM public.strategy_nodes WHERE id = NEW.parent_id;
    IF NOT ((NEW.kind = 'goal' AND parent_kind = 'area')
         OR (NEW.kind = 'mission' AND parent_kind = 'goal')
         OR (NEW.kind = 'step' AND parent_kind IN ('mission', 'step'))) THEN
      RAISE EXCEPTION 'a % cannot be inside a %', NEW.kind, parent_kind;
    END IF;
    cur := NEW.parent_id;
    WHILE cur IS NOT NULL LOOP
      IF cur = NEW.id THEN
        RAISE EXCEPTION 'a node cannot be inside itself';
      END IF;
      depth := depth + 1;
      IF depth > 10 THEN
        RAISE EXCEPTION 'too many levels';
      END IF;
      SELECT parent_id INTO cur FROM public.strategy_nodes WHERE id = cur;
    END LOOP;
  END IF;

  NEW.done_at := CASE WHEN NEW.status = 'done' THEN COALESCE(NEW.done_at, now()) END;
  RETURN NEW;
END $$;

CREATE TRIGGER strategy_nodes_check BEFORE INSERT OR UPDATE ON public.strategy_nodes
  FOR EACH ROW EXECUTE FUNCTION public.strategy_nodes_check();

CREATE TRIGGER strategy_nodes_set_updated_at BEFORE UPDATE ON public.strategy_nodes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. A task serves at most one node of the same user; deleting the node keeps the task.
ALTER TABLE public.tasks ADD COLUMN node_id uuid;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_node_fkey
  FOREIGN KEY (node_id, user_id) REFERENCES public.strategy_nodes (id, user_id) ON DELETE SET NULL (node_id);
CREATE INDEX tasks_node_idx ON public.tasks (node_id) WHERE node_id IS NOT NULL;
