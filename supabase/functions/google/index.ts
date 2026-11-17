// Google Calendar + Google Tasks for the signed-in user (P-17, P-50). POST { action, ... }:
//   calendars      → calendars the user can write to
//   events         → { time_min, time_max } Google events for the app calendar (read on demand, nothing stored)
//   import_tasks   → Google Tasks → app tasks: new ones come in (never twice), linked ones follow changes made in
//                    Google (title, done / reopened, day); the app calls it when it opens
//   sync_calendar  → app tasks → Google: events in the chosen calendar, and every open task as a Google task
//                    { task_ids?: string[] } limits it to those tasks (auto-sync after a change in the app)
//   disconnect     → revoke the access at Google and forget the tokens
import { GoogleError, ReconnectNeeded, cors, db, decrypt, google, json, userFrom } from "../_shared/google.ts";
import { CAL, TASKS, gtaskFor, gtaskHash, syncCalendar, syncTasks } from "../_shared/gsync.ts";
import { type ItemRow, TASK_COLS, V2_STATUS, scopeOf, setSource, setSourceHash, v1Task } from "../_shared/items.ts";

class BadInput extends Error {}

async function calendars(userId: string) {
  const data = await google(userId, `${CAL}/users/me/calendarList?minAccessRole=writer&maxResults=250`);
  return {
    calendars: (data.items ?? []).map((c: any) => ({ id: c.id, name: c.summaryOverride ?? c.summary, primary: !!c.primary })),
  };
}

// Events of the calendars the user shows in Google Calendar, between two instants (at most 100 days).
// The app's own task events are left out: the tasks are on the calendar already.
async function events(userId: string, timeMin: unknown, timeMax: unknown) {
  const from = typeof timeMin === "string" ? Date.parse(timeMin) : NaN;
  const to = typeof timeMax === "string" ? Date.parse(timeMax) : NaN;
  if (isNaN(from) || isNaN(to) || to <= from) throw new BadInput("time_min and time_max: ISO times, min < max");
  const range = `timeMin=${encodeURIComponent(new Date(from).toISOString())}&timeMax=${encodeURIComponent(new Date(Math.min(to, from + 100 * 86400_000)).toISOString())}`;

  const list = await google(userId, `${CAL}/users/me/calendarList?maxResults=250`);
  const shown = (list.items ?? []).filter((c: any) => c.selected && !c.hidden && !c.deleted).slice(0, 25);
  const perCalendar = await Promise.all(shown.map(async (c: any) => {
    try {
      const page = await google(userId, `${CAL}/calendars/${encodeURIComponent(c.id)}/events?${range}&singleEvents=true&orderBy=startTime&maxResults=250` +
        "&fields=items(id,summary,start,end,htmlLink,status,extendedProperties)");
      return (page.items ?? [])
        .filter((e: any) => e.status !== "cancelled" && !e.extendedProperties?.private?.myl_task_id)
        .map((e: any) => ({
          id: `${c.id}:${e.id}`,
          title: e.summary || "(no title)",
          all_day: !!e.start?.date,
          start: e.start?.date ?? e.start?.dateTime,
          end: e.end?.date ?? e.end?.dateTime,
          url: e.htmlLink ?? null,
          color: c.backgroundColor ?? null,
          calendar: c.summaryOverride ?? c.summary,
        }));
    } catch (e) {
      if (e instanceof ReconnectNeeded) throw e;
      console.warn(`events of ${c.id}:`, e instanceof Error ? e.message : e); // e.g. a subscribed calendar that went away
      return [];
    }
  }));
  const all = perCalendar.flat().filter((e) => e.start && e.end);
  // All-day first, then by start time.
  all.sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.start.localeCompare(b.start));
  return { events: all };
}

async function allPages(userId: string, url: string) {
  const items: any[] = [];
  let pageToken = "";
  do {
    const page = await google(userId, `${url}${url.includes("?") ? "&" : "?"}maxResults=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return items;
}

// Google Tasks → the app (T-65; both ways since 2026-10-25). First run: every open Google task; later only what
// changed since the last import (a few minutes' overlap), done, reopened, renamed and deleted ones too.
//   new in Google      → an app task (unscheduled, due → deadline), linked by tasks.gtask_id
//   linked, changed    → its title, done state and (without a planned day) deadline follow Google
//   deleted in Google  → the app task stays; it is not sent to Google again
async function importTasks(userId: string) {
  const { data: conn, error: connError } = await db.from("google_connections").select("last_tasks_import_at").eq("user_id", userId).maybeSingle();
  if (connError) throw connError;
  const startedAt = new Date().toISOString();
  const since = conn?.last_tasks_import_at ? new Date(new Date(conn.last_tasks_import_at).getTime() - 5 * 60_000).toISOString() : null;
  const query = since
    ? `showCompleted=true&showHidden=true&showDeleted=true&updatedMin=${encodeURIComponent(since)}`
    : "showCompleted=false&showHidden=false";

  const { home } = await scopeOf(db, userId);
  const lists = await allPages(userId, `${TASKS}/users/@me/lists`);
  let found = 0, added = 0, changed = 0;
  const calendarToo: string[] = [];
  for (const list of lists) {
    const all = await allPages(userId, `${TASKS}/lists/${encodeURIComponent(list.id)}/tasks?${query}`);
    if (!all.length) continue;
    // Linked already (a task, or a capture of the v1 Inbox that came from Google Tasks): never imported twice.
    const { data: linked, error: linkedError } = await db.from("item_sources").select(`external_id, items!inner(${TASK_COLS})`)
      .eq("workspace_id", home).eq("source", "google_tasks").in("external_id", all.map((t) => t.id));
    if (linkedError) throw linkedError;
    const byGoogle = new Map((linked as unknown as { external_id: string; items: ItemRow }[]).map((l) => [l.external_id, l.items]));

    for (const g of all) {
      const item = byGoogle.get(g.id);
      if (item) {
        if (item.type === "task" && await applyFromGoogle(item, g, calendarToo)) changed++;
        continue;
      }
      if (g.deleted || g.status === "completed" || !(g.title?.trim() || g.notes?.trim())) continue;
      found++;
      const title = (g.title?.trim() || String(g.notes).trim().split("\n")[0]).slice(0, 500);
      const row = {
        title,
        description: g.title?.trim() ? (g.notes?.trim() ?? "") : "",
        deadline: g.due ? String(g.due).slice(0, 10) : "",
        link: "",
        status: "idle",
      };
      const { data: created, error } = await db.from("items").insert({
        workspace_id: home,
        type: "task",
        title: row.title,
        body: row.description,
        due_on: row.deadline || null,
        priority: 3,
        created_by: userId,
      }).select("id").single();
      if (error) throw error;
      try {
        await setSource(db, created.id, "google_tasks", { external_id: g.id, container: list.id, hash: await gtaskHash(gtaskFor(row)) });
      } catch (e) {
        await db.from("items").delete().eq("id", created.id); // no task without its link (it would come in again)
        throw e;
      }
      added++;
    }
  }
  // Done / reopened ones: their calendar events get or lose the ✓.
  if (calendarToo.length) await syncCalendar(userId, calendarToo).catch((e) => console.error("calendar after import:", e));
  await db.from("google_connections").update({ last_tasks_import_at: startedAt }).eq("user_id", userId);
  return { lists: lists.length, found, added, changed };
}

// A linked task changed in Google. What Google shows equal to what the app sent last → our own change, nothing to do.
async function applyFromGoogle(item: ItemRow, g: any, calendarToo: string[]) {
  const link = item.item_sources?.find((s) => s.source === "google_tasks");
  const task = { ...v1Task(item), gtask_hash: link?.hash ?? null };
  if (task.gtask_hash === "deleted") return false;
  if (g.deleted) {
    await setSourceHash(db, task.id, "google_tasks", "deleted");
    return false;
  }
  const done = g.status === "completed";
  const theirs = {
    title: (g.title ?? "").trim(),
    notes: (g.notes ?? "").trim(),
    due: g.due ? `${String(g.due).slice(0, 10)}T00:00:00.000Z` : null,
    status: done ? "completed" : "needsAction",
    ...(done ? {} : { completed: null }),
  };
  if ((await gtaskHash(theirs)) === task.gtask_hash) return false;

  // In the v1 task shape first (the hash is over that shape), then as item columns.
  const updates: Record<string, string> = {};
  if (g.title?.trim() && g.title.trim() !== task.title) updates.title = g.title.trim().slice(0, 500);
  if (done && task.status !== "complete") updates.status = "complete";
  if (!done && task.status === "complete") updates.status = "idle"; // reopened in Google
  // The day only when the task has no planned day of its own (then Google's day is its deadline).
  const due = g.due ? String(g.due).slice(0, 10) : "";
  if (!task.date && due !== (task.deadline || "")) updates.deadline = due;
  // From now on the app's version is what Google has (notes come from the app: description + link).
  const hash = await gtaskHash(gtaskFor({ ...task, ...updates }));
  const row: Record<string, unknown> = {};
  if ("title" in updates) row.title = updates.title;
  if ("status" in updates) {
    row.status = V2_STATUS[updates.status];
    if (updates.status === "complete") row.done_at = item.done_at ?? g.completed ?? new Date().toISOString();
  }
  if ("deadline" in updates) row.due_on = updates.deadline || null;
  if (Object.keys(row).length) {
    const { error } = await db.from("items").update(row).eq("id", task.id);
    if (error) throw error;
  }
  await setSourceHash(db, task.id, "google_tasks", hash);
  if ("status" in updates) calendarToo.push(task.id);
  return Object.keys(updates).length > 0;
}

async function disconnect(userId: string) {
  const { data: row } = await db.from("google_tokens").select("refresh_token_enc").eq("user_id", userId).maybeSingle();
  if (row) {
    // Revoking the refresh token removes the app's access in the Google account too.
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: await decrypt(row.refresh_token_enc) }),
    }).catch(() => {});
  }
  await db.from("google_tokens").delete().eq("user_id", userId);
  await db.from("google_connections").delete().eq("user_id", userId);
  return { disconnected: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const user = await userFrom(req);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { action, task_ids, time_min, time_max } = await req.json().catch(() => ({}));

  try {
    switch (action) {
      case "calendars": return json(await calendars(user.id));
      case "events": return json(await events(user.id, time_min, time_max));
      case "import_tasks": return json(await importTasks(user.id));
      case "sync_calendar": return json(await syncTasks(user.id, task_ids));
      case "disconnect": return json(await disconnect(user.id));
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    if (e instanceof BadInput) return json({ error: e.message }, 400);
    if (e instanceof ReconnectNeeded) return json({ error: e.message, reconnect: true }, 409);
    if (e instanceof GoogleError) return json({ error: `Google: ${e.message}` }, 502);
    console.error(`google ${action}:`, e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
