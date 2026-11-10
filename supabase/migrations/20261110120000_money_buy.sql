-- To buy + spending (owner 2026-11-10: "almalı olduqlarım pulqabında olmalıdı", "əlavə xərcləri qeyd edə bilmirəm").
-- kind 'buy': a thing to buy (amount = price, 0 = not known yet). Bought = one money_payments row in that month
-- (paid_at set); a one-off expense is a 'buy' item bought at once.
ALTER TABLE public.money_items DROP CONSTRAINT money_items_kind_check;
ALTER TABLE public.money_items ADD CONSTRAINT money_items_kind_check CHECK (kind IN ('income', 'bill', 'debt', 'loan', 'buy'));
ALTER TABLE public.money_items DROP CONSTRAINT money_items_amount_check;
ALTER TABLE public.money_items ADD CONSTRAINT money_items_amount_check CHECK (amount > 0 OR (kind = 'buy' AND amount = 0));
