// Memories of the days (owner, 2026-10-25): a note Memories/<YYYY-MM-DD>….md, and the photos sent to the Telegram bot
// that day (Inbox/files/<YYYY-MM-DD>-…). The first picture of a day — an image in its note, else a photo — is the
// picture of its card in the Depth calendar.
import { supabase } from "@/integrations/supabase/client";
import { fileName, isImage, loadIndex, resolver, targetsOf, vault } from "@/lib/vault";

export const MEMORIES = "Memories";
export const memoryPath = (day: string) => `${MEMORIES}/${day}.md`;
export type Memory = { note: string | null; excerpt: string | null; images: string[] };

const dayOfName = (path: string) => fileName(path).match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;

export async function loadMemories() {
  const [notes, photos] = await Promise.all([
    supabase.from("vault_files").select("path, excerpt, body").is("trashed_at", null).like("path", `${MEMORIES}/%`),
    supabase.from("vault_files").select("path").is("trashed_at", null).like("path", "Inbox/files/%"),
  ]);
  if (notes.error) throw notes.error;
  if (photos.error) throw photos.error;
  const days = new Map<string, Memory>();
  const of = (day: string) => {
    let m = days.get(day);
    if (!m) days.set(day, (m = { note: null, excerpt: null, images: [] }));
    return m;
  };
  // Pictures in a memory note are [[links]] or Markdown images; the vault index turns names into paths.
  const embeds = notes.data.some((n) => n.body && /!\[/.test(n.body));
  const resolve = embeds ? resolver(await loadIndex()) : null;
  for (const n of notes.data) {
    const day = dayOfName(n.path);
    if (!day) continue;
    const m = of(day);
    m.note ??= n.path;
    m.excerpt ??= n.excerpt?.replace(/^\d{1,2} \w+ \d{4}\s*/, "") || null;
    if (resolve && n.body) for (const t of targetsOf(n.body)) {
      const p = resolve(t);
      if (p && isImage(p)) m.images.push(p);
    }
  }
  for (const p of photos.data) {
    const day = dayOfName(p.path);
    if (day && isImage(p.path)) of(day).images.push(p.path);
  }
  return days;
}

// A day's memory note: made if missing (a heading with the date), then opened in Notes.
export async function ensureMemory(day: string, heading: string) {
  const path = memoryPath(day);
  await vault("write", { path, text: `# ${heading}\n\n`, etag: null }); // already there → { conflict }, left as it is
  return path;
}
