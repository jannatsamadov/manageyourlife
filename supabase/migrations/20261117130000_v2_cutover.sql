-- Rebuild v2 cut-over (P-70, T-113): from now on the v2 tables are the truth (the app, MCP, Google, the AI chat use
-- them). The v1 tables stay as a read-only backup until the owner's OK to drop them (T-118).

-- 1. The last copy of the v1 data (it empties the v2 tables first: the test rows go too), then the copy function goes,
--    so it can never run again.
SELECT public.v2_copy_from_v1();
DROP FUNCTION public.v2_copy_from_v1();

-- 2. Payments belong to money items (the same ids as the v1 money_items); deleting the item deletes its payments.
ALTER TABLE public.money_payments DROP CONSTRAINT money_payments_item_fkey;
ALTER TABLE public.money_payments
  ADD CONSTRAINT money_payments_item_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;

-- 3. The v1 tables are read-only for the app (an old browser tab or an old function cannot write to them any more).
REVOKE INSERT, UPDATE, DELETE ON
  public.tasks, public.subtasks, public.strategy_nodes, public.money_items, public.inbox_items, public.note_task_links,
  public.task_shares, public.opportunities, public.user_attributes, public.notes
FROM anon, authenticated;
