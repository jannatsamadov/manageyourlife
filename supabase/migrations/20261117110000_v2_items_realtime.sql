-- v2 (P-70, T-113): the app keeps its item cache fresh through Supabase Realtime (changes from MCP, Telegram, the
-- Google import, another tab). RLS still decides what each subscriber receives.
ALTER PUBLICATION supabase_realtime ADD TABLE public.items;
