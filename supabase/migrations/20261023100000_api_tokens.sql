-- Personal access tokens for the API / MCP server (P-18) and a log of every write made with them.

-- 1. api_tokens: the token is shown once; only its SHA-256 is stored.
CREATE TABLE public.api_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  token_hash text NOT NULL,
  token_prefix text NOT NULL,                   -- first characters, to recognise a token in the list
  scopes text[] NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_used_at timestamp with time zone,
  expires_at timestamp with time zone,
  revoked_at timestamp with time zone,
  CONSTRAINT api_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT api_tokens_token_hash_key UNIQUE (token_hash),
  CONSTRAINT api_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT api_tokens_scopes_check CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['read', 'write']::text[]),
  CONSTRAINT api_tokens_name_check CHECK (char_length(name) BETWEEN 1 AND 100)
);
CREATE INDEX api_tokens_user_id_idx ON public.api_tokens (user_id);

-- Owners see their tokens and may only set revoked_at; tokens are created by the function below.
ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own tokens" ON public.api_tokens FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users revoke own tokens" ON public.api_tokens FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.api_tokens FROM anon, authenticated;
GRANT UPDATE (revoked_at) ON public.api_tokens TO authenticated;

CREATE FUNCTION public.create_api_token(p_name text, p_scopes text[], p_expires_at timestamp with time zone DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  token text := 'myl_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;
  IF (SELECT count(*) FROM public.api_tokens WHERE user_id = uid AND revoked_at IS NULL) >= 20 THEN
    RAISE EXCEPTION 'too many tokens: revoke one first';
  END IF;
  INSERT INTO public.api_tokens (user_id, name, token_hash, token_prefix, scopes, expires_at)
  VALUES (uid, trim(p_name), encode(sha256(convert_to(token, 'UTF8')), 'hex'), left(token, 12), p_scopes, p_expires_at);
  RETURN token;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_api_token(text, text[], timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_api_token(text, text[], timestamp with time zone) TO authenticated;

-- 2. api_audit_log: written by the server (service role), readable by the owner.
CREATE TABLE public.api_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY,
  user_id uuid NOT NULL,
  token_id uuid,
  action text NOT NULL,
  target_id uuid,
  ok boolean NOT NULL,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT api_audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT api_audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT api_audit_log_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.api_tokens(id) ON DELETE SET NULL
);
CREATE INDEX api_audit_log_user_id_created_at_idx ON public.api_audit_log (user_id, created_at DESC);
CREATE INDEX api_audit_log_token_id_idx ON public.api_audit_log (token_id);

ALTER TABLE public.api_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own log" ON public.api_audit_log FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.api_audit_log FROM anon, authenticated;
