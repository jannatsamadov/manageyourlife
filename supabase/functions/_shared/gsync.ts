// Task changes → Google (P-17, P-50), shared by the google function (the app) and the MCP server:
//   calendar     → scheduled tasks as all-day events in the chosen calendar; create / update / delete, no duplicates
//   Google Tasks → a task made from a Google Task (through the Inbox) sends its done state back (T-65)
import { GoogleError, ReconnectNeeded, db, google, hex, sha256 } from "./google.ts";

export const CAL = "https://www.googleapis.com/calendar/v3";
export const TASKS = "https://tasks.googleapis.com/tasks/v1";
export const gone = (e: unknown) => e instanceof GoogleError && (e.status === 404 || e.status === 410);

// Task ids from a request: strings only, at most 200; none → everything.
const idsFrom = (taskIds: unknown) =>
  Array.isArray(taskIds) && taskIds.length ? taskIds.filter((id): id is string => typeof id === "string").slice(0, 200) : undefined;

// The event of a task's planned day. An event (P-60) or a time block: at its time, in the calendar's time zone,
// as long as its minutes (60 if not set); an event blocks the time, a task does not. A whole-day task: an all-day
// event (end date is exclusive in Google Calendar).
function eventFor(t: any, timeZone: string) {
  const details = [t.description?.trim(), t.link || null, t.estimated_time && !t.is_event ? `Estimate: ${t.estimated_time} min` : null].filter(Boolean);
  const summary = (t.status === "complete" && !t.is_event ? "✓ " : "") + t.title;
  const description = [...details, "— ManageYourLife"].join("\n\n");
  const extendedProperties = { private: { myl_task_id: t.id } };
  if (t.start_time) {
    const start = `${t.date}T${t.start_time}:00`;
    // Local wall-clock times: add the minutes as if UTC, keep the zone.
    const end = new Date(Date.parse(`${start}Z`) + (t.estimated_time || 60) * 60_000).toISOString().slice(0, 19);
    return { summary, description, start: { dateTime: start, timeZone }, end: { dateTime: end, timeZone }, transparency: t.is_event ? "opaque" : "transparent", extendedProperties };
  }
  const end = new Date(`${t.date}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  // Same shape as before P-60, so the stored hashes of whole-day tasks still match.
  return { summary, description, start: { date: t.date }, end: { date: end.toISOString().slice(0, 10) }, transparency: "transparent", extendedProperties };
}

export async function syncCalendar(userId: string, taskIds?: unknown) {
  const { data: conn, error: connError } = await db.from("google_connections").select("calendar_id").eq("user_id", userId).maybeSingle();
  if (connError) throw connError;
  if (!conn) throw new ReconnectNeeded("Google is not connected");
  const calendarId: string = conn.calendar_id;
  const eventsUrl = (cal: string, id?: string) => `${CAL}/calendars/${encodeURIComponent(cal)}/events${id ? `/${encodeURIComponent(id)}` : ""}`;

  const ids = idsFrom(taskIds);
  let q = db.from("tasks")
    .select("id, title, description, status, date, link, estimated_time, is_event, start_time, deleted_at, gcal_event_id, gcal_calendar_id, gcal_hash")
    .eq("user_id", userId);
  q = ids ? q.in("id", ids) : q.or("date.not.is.null,gcal_event_id.not.is.null");
  const { data: tasks, error } = await q;
  if (error) throw error;

  const counts = { created: 0, updated: 0, removed: 0, unchanged: 0, failed: 0 };
  const errors: string[] = [];
  // Timed events need a time zone: the calendar's own, else the one the app set for the user (Telegram link), else UTC.
  let zone: string | null = null;
  const timeZone = async () => {
    if (zone) return zone;
    const cal = await google(userId, `${CAL}/calendars/${encodeURIComponent(calendarId)}`).catch(() => null);
    const own = cal?.timeZone ?? (await db.from("telegram_links").select("time_zone").eq("user_id", userId).maybeSingle()).data?.time_zone;
    return (zone = own || "UTC");
  };
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

      const body = eventFor(t, t.start_time ? await timeZone() : "UTC");
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

// Done in the app → completed in Google Tasks; undone → open again. The Inbox item remembers what Google has
// (meta.gtask_status), so a task is sent only when it changed.
export async function syncTaskStatus(userId: string, taskIds?: unknown) {
  const ids = idsFrom(taskIds);
  let q = db.from("inbox_items").select("id, source_ref, meta, result_id")
    .eq("user_id", userId).eq("source", "google_tasks").eq("result_type", "task").not("result_id", "is", null);
  if (ids) q = q.in("result_id", ids);
  const { data: items, error } = await q;
  if (error) throw error;
  const counts = { completed: 0, reopened: 0, failed: 0 };
  if (!items.length) return counts;

  const { data: tasks, error: taskError } = await db.from("tasks").select("id, status").eq("user_id", userId).in("id", items.map((i) => i.result_id));
  if (taskError) throw taskError;
  const statusOf = new Map(tasks.map((t) => [t.id, t.status]));

  for (const item of items) {
    const status = statusOf.get(item.result_id);
    const meta = item.meta ?? {};
    if (!status || !meta.list_id || meta.gtask_status === "deleted") continue;
    const wanted = status === "complete" ? "completed" : "needsAction";
    if (wanted === (meta.gtask_status ?? "needsAction")) continue;
    let now = wanted;
    try {
      await google(userId, `${TASKS}/lists/${encodeURIComponent(meta.list_id)}/tasks/${encodeURIComponent(item.source_ref)}`, {
        method: "PATCH",
        body: wanted === "completed" ? { status: "completed" } : { status: "needsAction", completed: null },
      });
      counts[wanted === "completed" ? "completed" : "reopened"]++;
    } catch (e) {
      if (e instanceof ReconnectNeeded) throw e;
      if (!gone(e)) {
        counts.failed++;
        continue;
      }
      now = "deleted"; // deleted in Google: stop sending it
    }
    await db.from("inbox_items").update({ meta: { ...meta, gtask_status: now } }).eq("id", item.id);
  }
  return counts;
}

// Both, for the tasks that changed (or all of them).
export async function syncTasks(userId: string, taskIds?: unknown) {
  const calendar = await syncCalendar(userId, taskIds);
  const googleTasks = await syncTaskStatus(userId, taskIds).catch((e) => {
    if (e instanceof ReconnectNeeded) throw e;
    console.error("google tasks status:", e);
    return { completed: 0, reopened: 0, failed: 1 };
  });
  return { ...calendar, google_tasks: googleTasks };
}

// After a change made outside the app (MCP): sync only if the user connected Google; never throws.
export async function syncTasksIfConnected(userId: string, taskIds: string[]) {
  try {
    const { data: conn } = await db.from("google_connections").select("user_id").eq("user_id", userId).maybeSingle();
    if (conn) await syncTasks(userId, taskIds);
  } catch (e) {
    console.error("google sync after MCP change:", e);
  }
}
