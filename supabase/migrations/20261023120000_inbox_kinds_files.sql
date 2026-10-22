-- Inbox item kinds (the owner's 4 note sections, P-49) and files sent to the Telegram bot kept in Storage.

-- 1. kind: set by /idea, /question, /todo, /resource in Telegram, by the buttons under the bot's ✓, or in the app.
ALTER TABLE public.inbox_items
  ADD COLUMN kind text,
  ADD CONSTRAINT inbox_items_kind_check CHECK (kind IN ('idea', 'question', 'todo', 'resource'));

-- 2. Private bucket; objects live under <user_id>/…, written by the bot (service role), read/deleted by their owner.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('inbox-files', 'inbox-files', false, 52428800)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users read own inbox files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'inbox-files' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
CREATE POLICY "Users delete own inbox files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'inbox-files' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
