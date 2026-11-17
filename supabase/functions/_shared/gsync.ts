// Task changes → Google (P-17, P-50), shared by the google function (the app) and the MCP server:
//   calendar     → scheduled tasks as events in the chosen calendar (timed or all-day); create / update / delete
//   Google Tasks → every open task as a Google task (title, notes, day, done); create / update / delete
import { GoogleError, ReconnectNeeded, db, google, hex, sha256 } from "./google.ts";
import { type ItemRow, TASK_COLS, scopeOf, setSource, setSourceHash, sourceOf, v1Task } from "./items.ts";

export const CAL = "https://www.googleapis.com/calendar/v3";
export const TASKS = "https://tasks.googleapis.com/tasks/v1";
export const gone = (e: unknown) => e instanceof GoogleError && (e.status === 404 || e.status === 410);

// Task ids from a request: strings only, at most 200; none → everything.
const idsFrom = (taskIds: unknown) =>
  Array.isArray(taskIds) && taskIds.length ? taskIds.filter((id): id is string => typeof id === "string").slice(0, 200) : undefined;

// The event of a task's planned day. An event (P-60) or a time block: at its time, in the calendar's time zone,
// as long as its minutes (60 if not set); an event blocks the time, a task does not. A whole-day task: an all-day
// event (end date is exclusive in Google Calendar).
export function eventFor(t: any, timeZone: string) {
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

// The user's tasks to look at for one Google side: the given ids, else the ones `wanted` picks plus every task
// already linked there (it may have to be removed). Tasks of the personal workspace (the Google account is the user's).
// deno-lint-ignore no-explicit-any
async function syncedTasks(userId: string, ids: string[] | undefined, source: string, wanted: (q: any) => any): Promise<ItemRow[]> {
  const { home } = await scopeOf(db, userId);
  const base = () => db.from("items").select(TASK_COLS).eq("workspace_id", home).eq("type", "task");
  if (ids) {
    const { data, error } = await base().in("id", ids);
    if (error) throw error;
    return data as unknown as ItemRow[];
  }
  const picked = await wanted(base());
  if (picked.error) throw picked.error;
  const linked = await db.from("item_sources").select(`item_id, items!inner(${TASK_COLS})`)
    .eq("workspace_id", home).eq("source", source).eq("items.type", "task");
  if (linked.error) throw linked.error;
  const all = new Map<string, ItemRow>();
  for (const i of picked.data as ItemRow[]) all.set(i.id, i);
  for (const l of linked.data as unknown as { items: ItemRow }[]) all.set(l.items.id, l.items);
  return [...all.values()];
}

export async function syncCalendar(userId: string, taskIds?: unknown) {
  const { data: conn, error: connError } = await db.from("google_connections").select("calendar_id").eq("user_id", userId).maybeSingle();
  if (connError) throw connError;
  if (!conn) throw new ReconnectNeeded("Google is not connected");
  const calendarId: string = conn.calendar_id;
  const eventsUrl = (cal: string, id?: string) => `${CAL}/calendars/${encodeURIComponent(cal)}/events${id ? `/${encodeURIComponent(id)}` : ""}`;

  const tasks = (await syncedTasks(userId, idsFrom(taskIds), "google_calendar", (q) => q.not("planned_on", "is", null)))
    .map((i) => {
      const ev = sourceOf(i, "google_calendar");
      return { ...v1Task(i), gcal_event_id: ev?.external_id ?? null, gcal_calendar_id: ev?.container ?? null, gcal_hash: ev?.hash ?? null };
    });

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
        await setSource(db, t.id, "google_calendar", null);
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
      await setSource(db, t.id, "google_calendar", { external_id: event.id, container: calendarId, hash });
    } catch (e) {
      if (e instanceof ReconnectNeeded) throw e;
      counts.failed++;
      errors.push(`${t.title}: ${e instanceof Error ? e.message : e}`);
    }
  }
  await db.from("google_connections").update({ last_calendar_sync_at: new Date().toISOString() }).eq("user_id", userId);
  return { ...counts, errors: errors.slice(0, 5) };
}

// ── Tasks ↔ Google Tasks (owner, 2026-10-25: "sync the tasks with Google Tasks too") ──
// Every open task of the app is also a Google task (the ones made in the app go to "My Tasks"); its title, notes,
// day and done state follow the app. Not there: events (they are in the calendar, P-60), trashed and abandoned
// tasks (their Google task is removed); done tasks made in the app are not added, a linked one shows done.
// gtask_hash = what was sent last (only changes go); "deleted" = the user deleted it in Google: not sent again.
export const DEFAULT_LIST = "@default";
const tasksUrl = (list: string, id?: string) => `${TASKS}/lists/${encodeURIComponent(list)}/tasks${id ? `/${encodeURIComponent(id)}` : ""}`;

// A task as Google Tasks shows it: due = the deadline, else the planned day (Google keeps only the date).
export function gtaskFor(t: { title: string; description?: string | null; link?: string | null; status: string; date?: string | null; deadline?: string | null }) {
  const due = t.deadline || t.date;
  return {
    title: t.title,
    notes: [t.description?.trim(), t.link || null].filter(Boolean).join("\n\n"),
    due: due ? `${due}T00:00:00.000Z` : null,
    status: t.status === "complete" ? "completed" : "needsAction",
    ...(t.status === "complete" ? {} : { completed: null }),
  };
}
export const gtaskHash = async (body: unknown) => hex(await sha256(JSON.stringify(body)));

export async function syncGoogleTasks(userId: string, taskIds?: unknown) {
  const tasks = (await syncedTasks(userId, idsFrom(taskIds), "google_tasks",
    (q) => q.is("deleted_at", null).in("status", ["todo", "doing", "waiting", "someday"]).eq("is_event", false)))
    .map((i) => {
      const gt = sourceOf(i, "google_tasks");
      return { ...v1Task(i), gtask_id: gt?.external_id ?? null, gtask_list_id: gt?.container ?? null, gtask_hash: gt?.hash ?? null };
    });

  const counts = { created: 0, updated: 0, removed: 0, unchanged: 0, failed: 0 };
  for (const t of tasks) {
    if (t.gtask_hash === "deleted") continue;
    const wanted = !t.deleted_at && t.status !== "abandoned" && !t.is_event && (t.status !== "complete" || !!t.gtask_id);
    try {
      if (!wanted) {
        if (t.gtask_id) {
          await google(userId, tasksUrl(t.gtask_list_id ?? DEFAULT_LIST, t.gtask_id), { method: "DELETE" }).catch((e) => {
            if (!gone(e)) throw e;
          });
          await setSource(db, t.id, "google_tasks", null);
          counts.removed++;
        }
        continue;
      }
      const body = gtaskFor(t);
      const hash = await gtaskHash(body);
      if (t.gtask_id && t.gtask_hash === hash) {
        counts.unchanged++;
        continue;
      }
      if (t.gtask_id) {
        const sent = await google(userId, tasksUrl(t.gtask_list_id ?? DEFAULT_LIST, t.gtask_id), { method: "PATCH", body }).then(() => true, (e) => {
          if (!gone(e)) throw e;
          return false;
        });
        // Deleted in Google meanwhile: it stays deleted there; the app task stays as it is.
        await setSourceHash(db, t.id, "google_tasks", sent ? hash : "deleted");
        if (sent) counts.updated++;
      } else {
        const g = await google(userId, tasksUrl(DEFAULT_LIST), { method: "POST", body });
        await setSource(db, t.id, "google_tasks", { external_id: g.id, container: DEFAULT_LIST, hash });
        counts.created++;
      }
    } catch (e) {
      if (e instanceof ReconnectNeeded) throw e;
      console.error(`google task ${t.id}:`, e);
      counts.failed++;
    }
  }
  return counts;
}

// Both, for the tasks that changed (or all of them).
export async function syncTasks(userId: string, taskIds?: unknown) {
  const calendar = await syncCalendar(userId, taskIds);
  const googleTasks = await syncGoogleTasks(userId, taskIds).catch((e) => {
    if (e instanceof ReconnectNeeded) throw e;
    console.error("google tasks:", e);
    return { created: 0, updated: 0, removed: 0, unchanged: 0, failed: 1 };
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
