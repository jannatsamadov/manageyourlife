-- #200 (owner, 2026-11-22: "2 və 3-ü isə indi edək"): every item gets a short number in its workspace (#45, like a
-- GitHub issue: easy to say, type and ask the AI about), and items get comments: a dated thread of decisions, results
-- and "why it stopped" that the app and the MCP read as the item's history.

-- ─── 1. Numbers: 1, 2, 3 … per workspace, never reused, never changed ───
ALTER TABLE public.workspaces ADD COLUMN last_number integer NOT NULL DEFAULT 0;
ALTER TABLE public.items ADD COLUMN number integer;

-- The items already there, by the time they were made (updated_at kept: a number is not an edit).
ALTER TABLE public.items DISABLE TRIGGER items_set_updated_at;
UPDATE public.items i SET number = s.n
FROM (SELECT id, row_number() OVER (PARTITION BY workspace_id ORDER BY created_at, id) AS n FROM public.items) s
WHERE i.id = s.id;
ALTER TABLE public.items ENABLE TRIGGER items_set_updated_at;
UPDATE public.workspaces w SET last_number = COALESCE((SELECT max(i.number) FROM public.items i WHERE i.workspace_id = w.id), 0);

ALTER TABLE public.items ALTER COLUMN number SET NOT NULL;
ALTER TABLE public.items ADD CONSTRAINT items_number_key UNIQUE (workspace_id, number);

-- A new item takes the workspace's next number; a number sent by a client is ignored. SECURITY DEFINER: a member who
-- may add items but not rename the workspace still moves its counter (an insert RLS refuses rolls the counter back).
CREATE FUNCTION public.items_number() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.workspace_id = OLD.workspace_id THEN
    NEW.number := OLD.number;
  ELSE
    UPDATE public.workspaces SET last_number = last_number + 1 WHERE id = NEW.workspace_id RETURNING last_number INTO NEW.number;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.items_number() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER items_number BEFORE INSERT OR UPDATE OF number, workspace_id ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.items_number();

-- ─── 2. Comments ───
CREATE TABLE public.item_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  workspace_id uuid NOT NULL,                     -- the item's (set by the trigger below)
  body text NOT NULL,                             -- Markdown
  via text NOT NULL DEFAULT 'app',                -- where it was written: the app, the MCP (an AI client), Telegram, the app's AI
  created_by uuid DEFAULT auth.uid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT item_comments_pkey PRIMARY KEY (id),
  CONSTRAINT item_comments_item_fkey FOREIGN KEY (item_id, workspace_id) REFERENCES public.items (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT item_comments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT item_comments_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 20000),
  CONSTRAINT item_comments_via_check CHECK (via IN ('app', 'mcp', 'telegram', 'ai'))
);
CREATE INDEX item_comments_item_idx ON public.item_comments (item_id, created_at);
CREATE INDEX item_comments_workspace_idx ON public.item_comments (workspace_id);
CREATE INDEX item_comments_created_by_idx ON public.item_comments (created_by);
CREATE TRIGGER item_comments_workspace BEFORE INSERT OR UPDATE OF item_id ON public.item_comments
  FOR EACH ROW EXECUTE FUNCTION public.item_workspace('item_id');
CREATE TRIGGER item_comments_set_updated_at BEFORE UPDATE ON public.item_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Members read a workspace's comments; writers add their own; only the author changes or deletes one.
ALTER TABLE public.item_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read" ON public.item_comments FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT public.my_workspaces()));
CREATE POLICY "Writers add their own" ON public.item_comments FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT public.my_writable_workspaces()) AND created_by = (SELECT auth.uid()));
CREATE POLICY "Authors change their own" ON public.item_comments FOR UPDATE TO authenticated
  USING (created_by = (SELECT auth.uid()) AND workspace_id IN (SELECT public.my_writable_workspaces()))
  WITH CHECK (created_by = (SELECT auth.uid()) AND workspace_id IN (SELECT public.my_writable_workspaces()));
CREATE POLICY "Authors delete their own" ON public.item_comments FOR DELETE TO authenticated
  USING (created_by = (SELECT auth.uid()) AND workspace_id IN (SELECT public.my_writable_workspaces()));
