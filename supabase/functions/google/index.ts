// Google Calendar + Google Tasks for the signed-in user (P-17, P-50). POST { action, ... }:
//   calendars      → calendars the user can write to
//   events         → { time_min, time_max } Google events for the app calendar (read on demand, nothing stored)
//   import_tasks   → open Google Tasks into the Inbox (an item is never imported twice); tasks completed or deleted
//                    in Google since the last import take their Inbox item out / mark the app task done
//   sync_calendar  → scheduled tasks → all-day events in the chosen calendar, and done state → Google Tasks
//                    { task_ids?: string[] } limits it to those tasks (auto-sync after a change in the app)
//   disconnect     → revoke the access at Google and forget the tokens
import { GoogleError, ReconnectNeeded, cors, db, decrypt, google, json, userFrom } from "../_shared/google.ts";
import { CAL, TASKS, syncCalendar, syncTasks } from "../_shared/gsync.ts";

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

async function importTasks(userId: string) {
  const { data: conn, error: connError } = await db.from("google_connections").select("last_tasks_import_at").eq("user_id", userId).maybeSingle();
  if (connError) throw connError;
  const startedAt = new Date().toISOString();
  // After the first import only what changed since the last one (a few minutes' overlap), done and deleted ones too.
  const since = conn?.last_tasks_import_at ? new Date(new Date(conn.last_tasks_import_at).getTime() - 5 * 60_000).toISOString() : null;
  const query = since
    ? `showCompleted=true&showHidden=true&showDeleted=true&updatedMin=${encodeURIComponent(since)}`
    : "showCompleted=false&showHidden=false";

  const lists = await allPages(userId, `${TASKS}/users/@me/lists`);
  let found = 0;
  let added = 0;
  const closed: any[] = [];
  for (const list of lists) {
    const all = await allPages(userId, `${TASKS}/lists/${encodeURIComponent(list.id)}/tasks?${query}`);
    closed.push(...all.filter((t) => t.deleted || t.status === "completed"));
    const tasks = all.filter((t) => !t.deleted && t.status !== "completed" && (t.title?.trim() || t.notes?.trim()));
    found += tasks.length;
    if (!tasks.length) continue;
    // New Google tasks become app tasks at once (unscheduled): to-dos are sorted by project, not in the Inbox (owner,
    // 2026-10-25). The inbox_items row stays as the link Google task ↔ app task, so "done" syncs both ways.
    const { data: known, error: knownError } = await db.from("inbox_items").select("source_ref").eq("user_id", userId)
      .eq("source", "google_tasks").in("source_ref", tasks.map((t) => t.id));
    if (knownError) throw knownError;
    const seen = new Set(known.map((k) => k.source_ref));
    for (const t of tasks.filter((t) => !seen.has(t.id))) {
      const title = t.title?.trim() || String(t.notes).trim().split("\n")[0];
      const { data: task, error } = await db.from("tasks").insert({
        user_id: userId,
        title: title.slice(0, 500),
        description: t.title?.trim() ? (t.notes?.trim() ?? "") : "",
        deadline: t.due ? String(t.due).slice(0, 10) : "",
        link: t.webViewLink ?? "",
        status: "idle",
      }).select("id").single();
      if (error) throw error;
      const { error: linkError } = await db.from("inbox_items").insert({
        user_id: userId,
        source: "google_tasks",
        kind: "todo",
        source_ref: t.id,
        source_url: t.webViewLink ?? null,
        content: [t.title?.trim(), t.notes?.trim()].filter(Boolean).join("\n\n"),
        meta: { list: list.title, list_id: list.id, due: t.due ?? null, parent: t.parent ?? null, links: (t.links ?? []).map((l: any) => l.link), updated: t.updated },
        sorted_at: new Date().toISOString(),
        result_type: "task",
        result_id: task.id,
      });
      if (linkError) throw linkError;
      added++;
    }
  }
  const done = await closeFromGoogle(userId, closed);
  await db.from("google_connections").update({ last_tasks_import_at: startedAt }).eq("user_id", userId);
  return { lists: lists.length, found, added, done };
}

// Completed or deleted in Google Tasks: an (older) unsorted Inbox item is closed; a task made from it is marked done
// (completed only — a task deleted in Google stays as it is in the app).
async function closeFromGoogle(userId: string, closed: any[]) {
  let done = 0;
  const completedTasks: string[] = [];
  for (let i = 0; i < closed.length; i += 100) {
    const chunk = closed.slice(i, i + 100);
    const byRef = new Map(chunk.map((t) => [t.id, t]));
    const { data: items, error } = await db.from("inbox_items").select("id, source_ref, sorted_at, result_type, result_id, meta")
      .eq("user_id", userId).eq("source", "google_tasks").in("source_ref", [...byRef.keys()]);
    if (error) throw error;
    for (const item of items) {
      const g = byRef.get(item.source_ref);
      const status = g.deleted ? "deleted" : "completed";
      const meta = item.meta ?? {};
      if (meta.gtask_status === status) continue;
      if (!item.sorted_at) {
        await db.from("inbox_items").update({ sorted_at: new Date().toISOString(), result_type: "deleted", meta: { ...meta, gtask_status: status } }).eq("id", item.id);
        done++;
        continue;
      }
      if (item.result_type === "task" && item.result_id && status === "completed") {
        const { data: task } = await db.from("tasks").select("id, status, actual_end").eq("user_id", userId).eq("id", item.result_id).maybeSingle();
        if (task && task.status !== "complete") {
          await db.from("tasks").update({ status: "complete", actual_end: task.actual_end ?? g.completed ?? new Date().toISOString() }).eq("id", task.id);
          completedTasks.push(task.id);
          done++;
        }
      }
      await db.from("inbox_items").update({ meta: { ...meta, gtask_status: status } }).eq("id", item.id);
    }
  }
  // Their calendar events get the ✓.
  if (completedTasks.length) await syncCalendar(userId, completedTasks).catch((e) => console.error("calendar after import:", e));
  return done;
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
