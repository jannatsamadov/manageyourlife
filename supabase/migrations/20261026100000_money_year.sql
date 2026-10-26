-- Yearly income and bills too (owner 2026-10-26: heating, Azəristilik, 50–60 AZN a year).
ALTER TABLE public.money_items DROP CONSTRAINT money_items_period_check;
ALTER TABLE public.money_items ADD CONSTRAINT money_items_period_check CHECK (
  CASE WHEN kind IN ('income', 'bill') THEN period IS NOT NULL AND period IN ('month', 'week', 'year') ELSE period IS NULL END);
