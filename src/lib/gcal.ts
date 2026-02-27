import { supabase } from "@/integrations/supabase/client";

async function getAccessToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.provider_token;
  if (!token) throw new Error("No Google token. Sign in with Google to enable calendar sync.");
  return token;
}

export async function isGCalAvailable(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session?.provider_token;
}

async function calFetch(path: string, options: RequestInit = {}) {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Calendar access denied. Re-sign in with Google and grant calendar permission.");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Google Calendar error ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export interface GCalEvent {
  id?: string;
  summary: string;
  description?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  htmlLink?: string;
}

export async function createEvent(task: {
  title: string;
  description?: string;
  date: string;
  estimatedTime?: number | null;
}): Promise<GCalEvent> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const event: any = {
    summary: task.title,
    description: task.description || "",
  };

  if (task.estimatedTime && task.estimatedTime > 0) {
    const startDT = `${task.date}T09:00:00`;
    const endMs = new Date(startDT).getTime() + task.estimatedTime * 60000;
    event.start = { dateTime: startDT, timeZone: tz };
    event.end = { dateTime: new Date(endMs).toISOString().slice(0, 19), timeZone: tz };
  } else {
    event.start = { date: task.date };
    event.end = { date: task.date };
  }

  return calFetch("/calendars/primary/events", {
    method: "POST",
    body: JSON.stringify(event),
  });
}

export async function deleteEvent(eventId: string): Promise<void> {
  await calFetch(`/calendars/primary/events/${eventId}`, { method: "DELETE" });
}

export async function listEvents(timeMin: string, timeMax: string): Promise<GCalEvent[]> {
  const params = new URLSearchParams({
    timeMin: new Date(timeMin).toISOString(),
    timeMax: new Date(timeMax + "T23:59:59").toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const data = await calFetch(`/calendars/primary/events?${params}`);
  return data.items || [];
}
