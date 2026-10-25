-- Ideas from everywhere (P-64, owner 2026-10-25: "ideas come up in different projects and are scattered"): the notes
-- that hold ideas. "whole" = the note itself is an idea (in an ideas folder — Ideas, İdeyalar …; tagged #idea /
-- #ideya; or linking [[Ideya]]); otherwise its text has an ideas heading, a plan item marked IDEA, a table row with
-- the status IDEA or a #idea line, and the vault function picks those out of the text.
create function public.idea_candidates(p_user uuid)
returns table (id uuid, path text, title text, excerpt text, modified_at timestamptz, body text, whole boolean)
language sql stable set search_path = '' as $$
  select f.id, f.path, f.title, f.excerpt, f.modified_at, case when w.whole then null else f.body end, w.whole
  from public.vault_files f,
  lateral (
    select f.path ~* '(^|/)[iİI]de(as?|ya|yalar)/'
      or exists (select 1 from unnest(f.tags) t where t ~* '^[iİI]de(as?|ya|yalar)$')
      or exists (select 1 from unnest(f.links) l where l ~* '^[iİI]de(as?|ya|yalar)$') as whole
  ) w
  where f.user_id = p_user and f.trashed_at is null and f.path ~* '\.md$'
    and (w.whole or f.body ~* '(^|\n)#{1,6}[^\n]*\m[iİI]de(as?|ya|yalar)\M|[—–-]\s*IDEA\M|\|\s*IDEA\s*\||#[iİI]de(a|ya)\M');
$$;
revoke execute on function public.idea_candidates(uuid) from public, anon;
