-- Default custom fields of a workspace (P-70 phase 3, T-114), made for every new workspace and the ones there are:
--   Kind — the sender's hint on an Inbox capture (/idea, /question, /todo, /resource), see 20261120090000.
--   Who  — who does a task (owner, 2026-11-20: "ai ilə ediləcək tasklar, ai edəcək tasklar, mən edəcəklərim"):
--          Me / With AI / AI. Feeds P-65 ("what is best to do now?"): AI tasks can run beside one's own work.
-- They are ordinary custom fields: the user may rename, change or delete them.
CREATE FUNCTION public.add_default_fields(ws uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.fields (workspace_id, key, name, kind, options, item_types, position) VALUES
    (ws, 'kind', 'Kind', 'select',
     '[{"id":"idea","name":"Idea","color":"yellow"},{"id":"question","name":"Question","color":"blue"},{"id":"todo","name":"To-do","color":"green"},{"id":"resource","name":"Resource","color":"purple"}]',
     ARRAY['capture'], 0),
    (ws, 'who', 'Who', 'select',
     '[{"id":"me","name":"Me","color":"blue"},{"id":"with_ai","name":"With AI","color":"purple"},{"id":"ai","name":"AI","color":"green"}]',
     ARRAY['task', 'project', 'routine'], 1)
  ON CONFLICT (workspace_id, key) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.add_default_fields(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.workspace_default_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.add_default_fields(NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workspace_default_fields() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER workspaces_default_fields AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.workspace_default_fields();

UPDATE public.fields SET item_types = ARRAY['capture'] WHERE key = 'kind' AND item_types IS NULL;
SELECT public.add_default_fields(id) FROM public.workspaces;
