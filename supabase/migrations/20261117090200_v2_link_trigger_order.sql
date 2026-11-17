-- v2 (P-70, T-112): BEFORE triggers fire in name order, so item_links_check ran before item_links_workspace and saw
-- no workspace yet — every new note link was refused ("note not found"; found by the mcp-v2 test, 2026-11-17).
-- The workspace is now filled first.
DROP TRIGGER item_links_workspace ON public.item_links;
CREATE TRIGGER item_links_a_workspace BEFORE INSERT OR UPDATE OF from_id ON public.item_links
  FOR EACH ROW EXECUTE FUNCTION public.item_workspace('from_id');
