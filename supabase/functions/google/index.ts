// Google Calendar + Google Tasks for the signed-in user (P-17, P-50). POST { action, ... }:
//   calendars      → calendars the user can write to
//   import_tasks   → open Google Tasks into the Inbox (one-way; an item is never imported twice)
//   sync_calendar  → scheduled tasks → all-day events in the chosen calendar; create / update / delete, no duplicates
//                    { task_ids?: string[] } limits it to those tasks (auto-sync after a change in the app)
//   disconnect     → revoke the access at Google and forget the tokens
import { GoogleError, ReconnectNeeded, cors, db, decrypt, google, hex, json, sha256, userFrom } from "../_shared/google.ts";

const CAL = "https://www.googleapis.com/calendar/v3";
const TASKS = "https://tasks.googleapis.com/tasks/v1";
const gone = (e: unknown) => e instanceof GoogleError && (e.status === 404 || e.status === 410);

async function calendars(userId: string) {
  const data = await google(userId, `${CAL}/users/me/calendarList?minAccessRole=writer&maxResults=250`);
  return {
    calendars: (data.items ?? []).map((c: any) => ({ id: c.id, name: c.summaryOverride ?? c.summary, primary: !!c.primary })),
  };
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

async function importTasks(userId: string) {
  const lists = await allPages(userId, `${TASKS}/users/@me/lists`);
  let found = 0;
  let added = 0;
  for (const list of lists) {
    const tasks = (await allPages(userId, `${TASKS}/lists/${encodeURIComponent(list.id)}/tasks?showCompleted=false&showHidden=false`))
      .filter((t) => t.title?.trim() || t.notes?.trim());
    found += tasks.length;
    if (!tasks.length) continue;
    const rows = tasks.map((t) => ({
      user_id: userId,
      source: "google_tasks",
      kind: "todo",
      source_ref: t.id,
      source_url: t.webViewLink ?? null,
      content: [t.title?.trim(), t.notes?.trim()].filter(Boolean).join("\n\n"),
      meta: { list: list.title, list_id: list.id, due: t.due ?? null, parent: t.parent ?? null, links: (t.links ?? []).map((l: any) => l.link), updated: t.updated },
    }));
    const { data, error } = await db.from("inbox_items")
      .upsert(rows, { onConflict: "user_id,source,source_ref", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    added += data.length;
  }
  await db.from("google_connections").update({ last_tasks_import_at: new Date().toISOString() }).eq("user_id", userId);
  return { lists: lists.length, found, added };
}

// All-day event for a task's planned day (end date is exclusive in Google Calendar).
function eventFor(t: any) {
  const end = new Date(`${t.date}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const details = [t.description?.trim(), t.link || null, t.estimated_time ? `Estimate: ${t.estimated_time} min` : null].filter(Boolean);
  return {
    summary: (t.status === "complete" ? "✓ " : "") + t.title,
    description: [...details, "— ManageYourLife"].join("\n\n"),
    start: { date: t.date },
    end: { date: end.toISOString().slice(0, 10) },
    transparency: "transparent",
    extendedProperties: { private: { myl_task_id: t.id } },
  };
}

async function syncCalendar(userId: string, taskIds?: unknown) {
  const { data: conn, error: connError } = await db.from("google_connections").select("calendar_id").eq("user_id", userId).maybeSingle();
  if (connError) throw connError;
  if (!conn) throw new ReconnectNeeded("Google is not connected");
  const calendarId: string = conn.calendar_id;
  const eventsUrl = (cal: string, id?: string) => `${CAL}/calendars/${encodeURIComponent(cal)}/events${id ? `/${encodeURIComponent(id)}` : ""}`;

  let q = db.from("tasks")
    .select("id, title, description, status, date, link, estimated_time, deleted_at, gcal_event_id, gcal_calendar_id, gcal_hash")
    .eq("user_id", userId);
  if (Array.isArray(taskIds) && taskIds.length) q = q.in("id", taskIds.filter((id) => typeof id === "string").slice(0, 200));
  else q = q.or("date.not.is.null,gcal_event_id.not.is.null");
  const { data: tasks, error } = await q;
  if (error) throw error;

  const counts = { created: 0, updated: 0, removed: 0, unchanged: 0, failed: 0 };
  const errors: string[] = [];
  for (const t of tasks) {
    try {
      const wanted = !!t.date && !t.deleted_at && t.status !== "abandoned";
      // Unscheduled / trashed / abandoned, or the target calendar changed → the old event goes.
      if (t.gcal_event_id && (!wanted || t.gcal_calendar_id !== calendarId)) {
        await google(userId, eventsUrl(t.gcal_calendar_id ?? calendarId, t.gcal_event_id), { method: "DELETE" }).catch((e) => {
          if (!gone(e)) throw e;
        });
        await db.from("tasks").update({ gcal_event_id: null, gcal_calendar_id: null, gcal_hash: null }).eq("id", t.id);
        t.gcal_event_id = null;
        if (!wanted) counts.removed++;
      }
      if (!wanted) continue;

      const body = eventFor(t);
      const hash = hex(await sha256(JSON.stringify(body)));
      if (t.gcal_event_id && t.gcal_hash === hash) {
        counts.unchanged++;
        continue;
      }
      let event: any = null;
      if (t.gcal_event_id) {
        // Deleted in Google meanwhile → create it again below.
        event = await google(userId, eventsUrl(calendarId, t.gcal_event_id), { method: "PUT", body }).catch((e) => {
          if (!gone(e)) throw e;
          return null;
        });
        if (event) counts.updated++;
      }
      if (!event) {
        event = await google(userId, eventsUrl(calendarId), { method: "POST", body });
        counts.created++;
      }
      await db.from("tasks").update({ gcal_event_id: event.id, gcal_calendar_id: calendarId, gcal_hash: hash }).eq("id", t.id);
    } catch (e) {
      if (e instanceof ReconnectNeeded) throw e;
      counts.failed++;
      errors.push(`${t.title}: ${e instanceof Error ? e.message : e}`);
    }
  }
  await db.from("google_connections").update({ last_calendar_sync_at: new Date().toISOString() }).eq("user_id", userId);
  return { ...counts, errors: errors.slice(0, 5) };
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
  const { action, task_ids } = await req.json().catch(() => ({}));

  try {
    switch (action) {
      case "calendars": return json(await calendars(user.id));
      case "import_tasks": return json(await importTasks(user.id));
      case "sync_calendar": return json(await syncCalendar(user.id, task_ids));
      case "disconnect": return json(await disconnect(user.id));
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    if (e instanceof ReconnectNeeded) return json({ error: e.message, reconnect: true }, 409);
    if (e instanceof GoogleError) return json({ error: `Google: ${e.message}` }, 502);
    console.error(`google ${action}:`, e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
