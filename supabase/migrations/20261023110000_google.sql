-- Google connection (P-17, P-50): own OAuth client, server-side code flow, refresh token encrypted at rest.

-- 1. google_connections: what the user sees (account, granted scopes, target calendar).
CREATE TABLE public.google_connections (
  user_id uuid NOT NULL,
  google_email text,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  calendar_id text NOT NULL DEFAULT 'primary',  -- where tasks go
  last_error text,                              -- set when Google rejects the token → user reconnects
  last_tasks_import_at timestamp with time zone,
  last_calendar_sync_at timestamp with time zone,
  connected_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT google_connections_pkey PRIMARY KEY (user_id),
  CONSTRAINT google_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own connection" ON public.google_connections FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users pick own calendar" ON public.google_connections FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.google_connections FROM anon, authenticated;
GRANT UPDATE (calendar_id) ON public.google_connections TO authenticated;

-- 2. google_tokens: AES-GCM encrypted by the edge functions (key only in function secrets). Service role only.
CREATE TABLE public.google_tokens (
  user_id uuid NOT NULL,
  refresh_token_enc text NOT NULL,
  access_token_enc text,
  access_token_expires_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT google_tokens_pkey PRIMARY KEY (user_id),
  CONSTRAINT google_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.google_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_tokens FROM anon, authenticated;
CREATE TRIGGER google_tokens_set_updated_at BEFORE UPDATE ON public.google_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. oauth_states: one pending sign-in (state + PKCE verifier), 10 minutes. Service role only.
CREATE TABLE public.oauth_states (
  state_hash text NOT NULL,
  user_id uuid NOT NULL,
  code_verifier text NOT NULL,
  redirect_to text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT oauth_states_pkey PRIMARY KEY (state_hash),
  CONSTRAINT oauth_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX oauth_states_user_id_idx ON public.oauth_states (user_id);
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oauth_states FROM anon, authenticated;

-- 4. A deleted Inbox item stays as a tombstone (sorted, result_type 'deleted'),
--    so a re-import from Google Tasks does not bring it back.
ALTER TABLE public.inbox_items
  DROP CONSTRAINT inbox_items_result_type_check,
  ADD CONSTRAINT inbox_items_result_type_check CHECK (result_type IN ('task', 'note', 'deleted'));

-- 5. tasks ↔ Google Calendar events: no duplicates, update in place, skip unchanged.
ALTER TABLE public.tasks
  ADD COLUMN gcal_event_id text,
  ADD COLUMN gcal_calendar_id text,
  ADD COLUMN gcal_hash text;                    -- hash of the last event body sent
