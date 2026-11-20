// AI sort of the Inbox (P-70 phase 3, T-114; GTD "clarify"): for the capture items the user asks about, Gemini
// proposes a type, a parent from the user's open strategy nodes / projects, a cleaner title and dates. Nothing is
// written here — the app shows the proposals and the user applies the ones they want. Money types are never read or
// proposed (P-65: money stays out of AI).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SORT_TYPES = ["task", "idea", "project", "routine", "milestone", "option", "obstacle", "goal", "mission", "step"];
const PARENT_TYPES = ["area", "goal", "mission", "step", "project", "routine", "milestone"];
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

const PROMPT = `You help one person sort their inbox (GTD "clarify"). Each inbox item is a raw note they sent themselves
(often from Telegram, often in Azerbaijani, sometimes just a link). For every item decide:
- type: task (a concrete action), idea (something to think about / maybe build later), project (an outcome that needs
  several tasks), routine, milestone, option, obstacle, goal, mission, step. Links to read / watch are usually a task
  ("Watch …", "Read …") unless they are only inspiration (idea). Take "kind" (the user's own hint) into account.
- parent_id: the id of the best fitting item from "parents", only when it clearly belongs there; else null.
  Allowed parents by type are given in "rules"; never use a parent whose type is not allowed for the chosen type.
- title: short and clear, max 80 characters, in the language of the item; a task starts with a verb. Keep names,
  links stay in the text (do not put a URL in the title unless there is nothing else).
- planned_on / due_on: YYYY-MM-DD only when the text names a day or a deadline (today is given); else null.
- priority: 1 urgent, 2 high, 3 medium, 4 low, or null when unclear.
- estimate_min: minutes for a task when you can guess sensibly, else null.
- reason: one short sentence (in the item's language) why.
Answer with JSON only: {"items":[{"id","type","parent_id","title","planned_on","due_on","priority","estimate_min","reason"}]}`;

export async function sortInbox(
  db: SupabaseClient, userId: string, body: { ids?: unknown; today?: unknown },
  ask: (messages: unknown[]) => Promise<Response>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const ids = Array.isArray(body.ids) ? body.ids.filter(isUuid).slice(0, 40) : [];
  if (!ids.length) return { status: 400, json: { error: "Nothing to sort" } };
  const today = isDay(body.today) ? body.today : new Date().toISOString().slice(0, 10);

  const { data: members, error: mErr } = await db.from("workspace_members").select("workspace_id").eq("user_id", userId);
  if (mErr) throw mErr;
  const spaces = (members ?? []).map((m: { workspace_id: string }) => m.workspace_id);

  const { data: items, error: iErr } = await db.from("items").select("id, title, body, url, props")
    .in("workspace_id", spaces).eq("type", "capture").is("deleted_at", null).in("id", ids);
  if (iErr) throw iErr;
  if (!items?.length) return { status: 400, json: { error: "Nothing to sort" } };

  const { data: nodes, error: nErr } = await db.from("items").select("id, type, title, parent_id")
    .in("workspace_id", spaces).in("type", PARENT_TYPES).is("deleted_at", null).is("archived_at", null)
    .not("status", "in", "(done,dropped)").limit(400);
  if (nErr) throw nErr;
  const byId = new Map((nodes ?? []).map((n: any) => [n.id, n]));
  const path = (n: any) => {
    const out: string[] = [];
    for (let p = n, k = 0; p && k < 8; p = byId.get(p.parent_id), k++) out.unshift(p.title);
    return out.join(" › ");
  };

  const { data: types, error: tErr } = await db.from("item_types").select("type, parents");
  if (tErr) throw tErr;
  const allowed = new Map((types ?? []).map((t: any) => [t.type, t.parents as string[]]));
  const rules = Object.fromEntries(SORT_TYPES.map((t) => [t, (allowed.get(t) ?? []).filter((p) => PARENT_TYPES.includes(p))]));

  const input = {
    today,
    rules,
    parents: (nodes ?? []).map((n: any) => ({ id: n.id, type: n.type, path: path(n) })),
    items: items.map((i: any) => ({
      id: i.id, title: i.title, text: (i.body ?? "").slice(0, 1500) || undefined, link: i.url ?? undefined, kind: i.props?.kind ?? undefined,
    })),
  };

  const res = await ask([{ role: "system", content: PROMPT }, { role: "user", content: JSON.stringify(input) }]);
  if (!res.ok) {
    console.error("Gemini sort error:", res.status, await res.text());
    const error = res.status === 429 ? "Gemini's limit is used up for now. Try again in a minute." : "Gemini did not answer. Try again in a minute.";
    return { status: res.status === 429 ? 429 : 502, json: { error } };
  }
  const reply = await res.json();
  const text: string = reply.choices?.[0]?.message?.content ?? "";
  let parsed: any;
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
  } catch {
    console.error("sort: not JSON", text.slice(0, 500));
    return { status: 502, json: { error: "The AI answer could not be read. Try again." } };
  }

  // Only what fits the DB's rules and the user's own items goes back.
  const asked = new Set(items.map((i: any) => i.id));
  const suggestions = (Array.isArray(parsed?.items) ? parsed.items : []).flatMap((s: any) => {
    if (!asked.has(s?.id) || !SORT_TYPES.includes(s.type)) return [];
    const parent = isUuid(s.parent_id) ? byId.get(s.parent_id) : null;
    const parentOk = parent && (allowed.get(s.type) ?? []).includes(parent.type);
    const title = typeof s.title === "string" && s.title.trim() ? s.title.trim().slice(0, 200) : null;
    return [{
      id: s.id,
      type: s.type,
      parent_id: parentOk ? parent.id : null,
      title,
      planned_on: isDay(s.planned_on) ? s.planned_on : null,
      due_on: isDay(s.due_on) ? s.due_on : null,
      priority: Number.isInteger(s.priority) && s.priority >= 1 && s.priority <= 4 ? s.priority : null,
      estimate_min: Number.isInteger(s.estimate_min) && s.estimate_min > 0 && s.estimate_min <= 100000 ? s.estimate_min : null,
      reason: typeof s.reason === "string" ? s.reason.slice(0, 300) : "",
    }];
  });
  return { status: 200, json: { suggestions } };
}
