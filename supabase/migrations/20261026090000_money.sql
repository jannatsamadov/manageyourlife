-- Money (P-67, owner 2026-10-26: "make a money section"): what I have, what comes in and goes out every month,
-- what I owe and what I am owed. Later it feeds the money–time trade-offs of "what should I do now?" (P-65). AZN.

-- 1. The balance the user types now and then; the newest is the current one (the history gives the saving rate later).
CREATE TABLE public.money_balances (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  amount numeric(12, 2) NOT NULL,
  noted_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT money_balances_pkey PRIMARY KEY (id),
  CONSTRAINT money_balances_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX money_balances_user_idx ON public.money_balances (user_id, noted_at DESC);

-- 2. Income and bills repeat (per month or week, from / until a date); a debt (I owe) or a loan (owed to me) has a total.
CREATE TABLE public.money_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  kind text NOT NULL,
  name text NOT NULL,
  amount numeric(12, 2) NOT NULL,                -- per period (income, bill) or the total (debt, loan)
  period text,                                   -- income and bills: 'month' | 'week'
  starts_on date,
  ends_on date,
  note text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT money_items_pkey PRIMARY KEY (id),
  CONSTRAINT money_items_id_user_key UNIQUE (id, user_id),
  CONSTRAINT money_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT money_items_kind_check CHECK (kind IN ('income', 'bill', 'debt', 'loan')),
  CONSTRAINT money_items_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT money_items_amount_check CHECK (amount > 0),
  CONSTRAINT money_items_period_check CHECK (
    CASE WHEN kind IN ('income', 'bill') THEN period IN ('month', 'week') ELSE period IS NULL END),
  CONSTRAINT money_items_dates_check CHECK (ends_on >= starts_on),
  CONSTRAINT money_items_note_check CHECK (char_length(note) <= 2000)
);
CREATE INDEX money_items_user_idx ON public.money_items (user_id, kind, position);

CREATE TRIGGER money_items_set_updated_at BEFORE UPDATE ON public.money_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Payments: a bill paid or income received for a month, a debt / loan paid back (whole or in part, month empty),
--    or a planned instalment (paid_at empty until it is paid). One payment per item and month.
CREATE TABLE public.money_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  item_id uuid NOT NULL,
  amount numeric(12, 2) NOT NULL,
  month date,                                    -- first day of the month it belongs to
  paid_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT money_payments_pkey PRIMARY KEY (id),
  CONSTRAINT money_payments_item_fkey FOREIGN KEY (item_id, user_id) REFERENCES public.money_items (id, user_id) ON DELETE CASCADE,
  CONSTRAINT money_payments_amount_check CHECK (amount > 0),
  CONSTRAINT money_payments_month_check CHECK (extract(day FROM month) = 1),
  CONSTRAINT money_payments_planned_check CHECK (paid_at IS NOT NULL OR month IS NOT NULL)
);
CREATE INDEX money_payments_item_idx ON public.money_payments (item_id);
CREATE UNIQUE INDEX money_payments_month_key ON public.money_payments (item_id, month) WHERE month IS NOT NULL;

ALTER TABLE public.money_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.money_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own rows" ON public.money_balances FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users manage own rows" ON public.money_items FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users manage own rows" ON public.money_payments FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
