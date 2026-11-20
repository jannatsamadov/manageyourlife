// The Inbox (P-70 phase 3, T-114): one `capture` item per thing sent from Telegram, MCP (inbox_add) or the app, to be
// sorted later by hand or with AI (type, parent, dates). The kind the sender gave it (/idea, /question, /todo,
// /resource) is the custom field "Kind" (props.kind) — a hint for sorting, not a type. No AI here.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { captureParts } from "./capture-text.ts";

export { captureParts };

export const KINDS: Record<string, string> = { idea: "Idea", question: "Question", todo: "To-do", resource: "Resource" };
const KIND_COLORS: Record<string, string> = { idea: "yellow", question: "blue", todo: "green", resource: "purple" };

// The "Kind" field of the workspace (made by the migration; made again here if the user deleted it).
export async function ensureKindField(db: SupabaseClient, workspaceId: string) {
  const options = Object.entries(KINDS).map(([id, name]) => ({ id, name, color: KIND_COLORS[id] }));
  const { error } = await db.from("fields").upsert(
    { workspace_id: workspaceId, key: "kind", name: "Kind", kind: "select", options },
    { onConflict: "workspace_id,key", ignoreDuplicates: true },
  );
  if (error) console.error("kind field:", error.message);
}

export type CaptureSource = { source: string; external_id: string; url?: string | null; meta?: Record<string, unknown> };

// The item a source already made (a retried Telegram update, an edited message).
export async function captureBySource(db: SupabaseClient, workspaceId: string, source: string, externalId: string) {
  const { data, error } = await db.from("item_sources").select("item_id, items(id, type, props, deleted_at)")
    .eq("workspace_id", workspaceId).eq("source", source).eq("external_id", externalId).maybeSingle();
  if (error) throw error;
  return (data?.items as unknown as { id: string; type: string; props: Record<string, unknown>; deleted_at: string | null } | null) ?? null;
}

// A new capture item + where it came from. Returns null when that source id is in already (a retry).
export async function addCapture(
  db: SupabaseClient,
  o: { workspaceId: string; userId: string; text: string; more?: string[]; kind?: string | null; fallbackTitle?: string; source: CaptureSource },
): Promise<{ id: string; title: string } | null> {
  if (await captureBySource(db, o.workspaceId, o.source.source, o.source.external_id)) return null;
  const parts = captureParts(o.text, o.more, o.fallbackTitle);
  const { data: item, error } = await db.from("items").insert({
    workspace_id: o.workspaceId, type: "capture", status: "todo", created_by: o.userId,
    title: parts.title, body: parts.body, url: parts.url, props: o.kind ? { kind: o.kind } : {},
  }).select("id, title").single();
  if (error) throw error;
  const { error: srcError } = await db.from("item_sources").insert({
    item_id: item.id, workspace_id: o.workspaceId, source: o.source.source, external_id: o.source.external_id,
    url: o.source.url ?? null, meta: o.source.meta ?? {}, synced_at: new Date().toISOString(),
  });
  if (srcError) {
    await db.from("items").delete().eq("id", item.id);
    if (srcError.code === "23505") return null; // the same update twice at once
    throw srcError;
  }
  if (o.kind) await ensureKindField(db, o.workspaceId);
  return item;
}
