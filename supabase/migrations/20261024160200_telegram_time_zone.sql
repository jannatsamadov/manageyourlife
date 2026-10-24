-- P-57: the app tells the bot the user's time zone (daily drafts are named by the user's own date).
-- Users may change only that column of their own link; chat and user stay as the bot set them.
revoke update on public.telegram_links from authenticated;
grant update (time_zone) on public.telegram_links to authenticated;
create policy "Users set own time zone" on public.telegram_links for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
