-- Income and bills need a period: "NULL IN (...)" is NULL, and a CHECK lets NULL through.
DELETE FROM public.money_items WHERE kind IN ('income', 'bill') AND period IS NULL;
ALTER TABLE public.money_items DROP CONSTRAINT money_items_period_check;
ALTER TABLE public.money_items ADD CONSTRAINT money_items_period_check CHECK (
  CASE WHEN kind IN ('income', 'bill') THEN period IS NOT NULL AND period IN ('month', 'week') ELSE period IS NULL END);
