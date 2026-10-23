// Google Calendar + Google Tasks through our edge functions (P-17, P-50): the browser never holds Google tokens.
import { supabase } from "@/integrations/supabase/client";

async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data as T;
}

export type CalendarSyncResult = {
  created: number; updated: number; removed: number; unchanged: number; failed: number; errors: string[];
  google_tasks: { completed: number; reopened: number; failed: number };
};
export type TasksImportResult = { lists: number; found: number; added: number; done: number };
export type GoogleCalendar = { id: string; name: string; primary: boolean };
// start / end: "YYYY-MM-DD" when all_day (end exclusive), else ISO date-times.
export type GoogleEvent = { id: string; title: string; all_day: boolean; start: string; end: string; url: string | null; color: string | null; calendar: string };

export const googleAction = {
  calendars: () => callFunction<{ calendars: GoogleCalendar[] }>("google", { action: "calendars" }),
  events: (timeMin: string, timeMax: string) => callFunction<{ events: GoogleEvent[] }>("google", { action: "events", time_min: timeMin, time_max: timeMax }),
  importTasks: () => callFunction<TasksImportResult>("google", { action: "import_tasks" }),
  syncCalendar: (taskIds?: string[]) => callFunction<CalendarSyncResult>("google", { action: "sync_calendar", task_ids: taskIds }),
  disconnect: () => callFunction<{ disconnected: boolean }>("google", { action: "disconnect" }),
};

// Sends the browser to Google's consent screen; Google returns to Settings with ?google=connected or ?google=error.
export async function connectGoogle() {
  const { url } = await callFunction<{ url: string }>("google-oauth", { return_to: `${window.location.origin}/settings` });
  window.location.href = url;
}

export async function getGoogleConnection() {
  const { data } = await supabase.from("google_connections").select("*").maybeSingle();
  return data;
}

// Auto-sync (T-8): changed task ids are collected and sent to Google Calendar a moment later, in one call.
let connected: boolean | null = null; // checked once per page load
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

export function setGoogleConnected(value: boolean) {
  connected = value;
}

export async function isGoogleConnected() {
  if (connected === null) connected = !!(await getGoogleConnection());
  return connected;
}

export function queueCalendarSync(taskId: string) {
  pending.add(taskId);
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const ids = [...pending];
    pending.clear();
    if (!(await isGoogleConnected())) return;
    try {
      await googleAction.syncCalendar(ids);
    } catch (e) {
      console.warn("Google Calendar sync failed:", e);
    }
  }, 1500);
}
