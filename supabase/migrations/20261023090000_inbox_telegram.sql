-- Inbox (P-49) and the Telegram connection (P-19).
-- Every source drops raw items into inbox_items as they came; sorting happens later in the app.

-- 1. inbox_items
CREATE TABLE public.inbox_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source text NOT NULL,
  source_ref text,                              -- id in the source (Telegram chat:message, Google task id…); makes imports idempotent
  source_url text,                              -- link back to the original, when there is one
  content text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,       -- source details as they came (raw Telegram message, due date…)
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  sorted_at timestamp with time zone,
  result_type text,
  result_id uuid,
  CONSTRAINT inbox_items_pkey PRIMARY KEY (id),
  CONSTRAINT inbox_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT inbox_items_source_check CHECK (source IN ('manual', 'telegram', 'google_tasks', 'obsidian', 'files', 'mcp')),
  CONSTRAINT inbox_items_result_type_check CHECK (result_type IN ('task', 'note')),
  CONSTRAINT inbox_items_source_ref_key UNIQUE (user_id, source, source_ref)
);

CREATE INDEX inbox_items_unsorted_idx ON public.inbox_items (user_id, created_at DESC) WHERE sorted_at IS NULL;

ALTER TABLE public.inbox_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own rows" ON public.inbox_items FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE TRIGGER inbox_items_set_updated_at BEFORE UPDATE ON public.inbox_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. telegram_links: one Telegram chat per account. Created only by the bot (service role) after a valid link code.
CREATE TABLE public.telegram_links (
  user_id uuid NOT NULL,
  chat_id bigint NOT NULL,
  username text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT telegram_links_pkey PRIMARY KEY (user_id),
  CONSTRAINT telegram_links_chat_id_key UNIQUE (chat_id),
  CONSTRAINT telegram_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own link" ON public.telegram_links FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users remove own link" ON public.telegram_links FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- 3. One-time link codes (t.me/<bot>?start=<code>), stored as SHA-256, valid 15 minutes.
--    RLS on and no policies: only the functions below and the service role touch it.
CREATE TABLE public.telegram_link_codes (
  code_hash text NOT NULL,
  user_id uuid NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT telegram_link_codes_pkey PRIMARY KEY (code_hash),
  CONSTRAINT telegram_link_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX telegram_link_codes_user_id_idx ON public.telegram_link_codes (user_id);
ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;

-- Signed-in user: new code (older codes of the user and expired codes are dropped).
CREATE FUNCTION public.create_telegram_link_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  code text := replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;
  DELETE FROM public.telegram_link_codes WHERE user_id = uid OR expires_at < now();
  INSERT INTO public.telegram_link_codes (code_hash, user_id, expires_at)
  VALUES (encode(sha256(convert_to(code, 'UTF8')), 'hex'), uid, now() + interval '15 minutes');
  RETURN code;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_telegram_link_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_telegram_link_code() TO authenticated;

-- Bot (service role): use a code once, link the chat; returns the user id or NULL when the code is wrong or expired.
CREATE FUNCTION public.redeem_telegram_link_code(p_code text, p_chat_id bigint, p_username text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  uid uuid;
BEGIN
  DELETE FROM public.telegram_link_codes
  WHERE code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex') AND expires_at > now()
  RETURNING user_id INTO uid;
  IF uid IS NULL THEN
    RETURN NULL;
  END IF;
  DELETE FROM public.telegram_links WHERE chat_id = p_chat_id OR user_id = uid;
  INSERT INTO public.telegram_links (user_id, chat_id, username) VALUES (uid, p_chat_id, p_username);
  RETURN uid;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.redeem_telegram_link_code(text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_telegram_link_code(text, bigint, text) TO service_role;
