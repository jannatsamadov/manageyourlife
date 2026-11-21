-- Profile (P-70 item 10, T-113): a person's own data that belongs to them, not to one browser — for now the birth
-- date (the Chronos Timer's 120-year countdown; it was in localStorage, so other devices never saw it). One row per
-- user, only its owner reads or writes it; never shown to MCP / AI.
CREATE TABLE public.profiles (
  user_id uuid NOT NULL DEFAULT auth.uid(),
  birth_date date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (user_id),
  CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT profiles_birth_date_check CHECK (birth_date >= DATE '1900-01-01')
);

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own profile: read" ON public.profiles FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Own profile: create" ON public.profiles FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Own profile: change" ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
