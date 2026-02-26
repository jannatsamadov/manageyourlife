const SCOPES = "https://www.googleapis.com/auth/calendar.events";
const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest";

let tokenClient: google.accounts.oauth2.TokenClient | null = null;
let accessToken: string | null = null;

declare global {
  interface Window {
    google?: typeof google;
  }
}

function getClientId(): string {
  return localStorage.getItem("stratify_gcal_client_id") || import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
}

export function setClientId(id: string) {
  localStorage.setItem("stratify_gcal_client_id", id);
}

export function isGCalConfigured(): boolean {
  return !!getClientId();
}

export function isGCalConnected(): boolean {
  return !!accessToken;
}

function loadScript(src: string): Promise<void> {
  if (document.querySelector(`script[src="${src}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export async function initGCal(): Promise<void> {
  const clientId = getClientId();
  if (!clientId) throw new Error("Google Client ID not configured");

  await loadScript("https://accounts.google.com/gsi/client");

  return new Promise((resolve) => {
    tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (response: google.accounts.oauth2.TokenResponse) => {
        if (response.access_token) {
          accessToken = response.access_token;
        }
        resolve();
      },
    });
  });
}

export async function connectGCal(): Promise<boolean> {
  const clientId = getClientId();
  if (!clientId) throw new Error("Google Client ID not configured");

  await loadScript("https://accounts.google.com/gsi/client");

  return new Promise((resolve) => {
    tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (response: google.accounts.oauth2.TokenResponse) => {
        if (response.access_token) {
          accessToken = response.access_token;
          resolve(true);
        } else {
          resolve(false);
        }
      },
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

export function disconnectGCal() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenClient = null;
}

async function calFetch(path: string, options: RequestInit = {}) {
  if (!accessToken) throw new Error("Not connected to Google Calendar");
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (res.status === 401) {
    accessToken = null;
    throw new Error("Session expired, please reconnect");
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
  const event: any = {
    summary: task.title,
    description: task.description || "",
    start: { date: task.date },
    end: { date: task.date },
  };

  if (task.estimatedTime && task.estimatedTime > 0) {
    const startDT = `${task.date}T09:00:00`;
    const endMs = new Date(startDT).getTime() + task.estimatedTime * 60000;
    const endDT = new Date(endMs).toISOString().replace("Z", "");
    event.start = { dateTime: startDT, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    event.end = { dateTime: endDT.slice(0, 19), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }

  return calFetch("/calendars/primary/events", {
    method: "POST",
    body: JSON.stringify(event),
  });
}

export async function updateEvent(eventId: string, task: {
  title: string;
  description?: string;
  date: string;
  estimatedTime?: number | null;
}): Promise<GCalEvent> {
  const event: any = {
    summary: task.title,
    description: task.description || "",
    start: { date: task.date },
    end: { date: task.date },
  };

  if (task.estimatedTime && task.estimatedTime > 0) {
    const startDT = `${task.date}T09:00:00`;
    const endMs = new Date(startDT).getTime() + task.estimatedTime * 60000;
    const endDT = new Date(endMs).toISOString().replace("Z", "");
    event.start = { dateTime: startDT, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    event.end = { dateTime: endDT.slice(0, 19), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }

  return calFetch(`/calendars/primary/events/${eventId}`, {
    method: "PUT",
    body: JSON.stringify(event),
  });
}

export async function deleteEvent(eventId: string): Promise<void> {
  await calFetch(`/calendars/primary/events/${eventId}`, { method: "DELETE" });
}

export async function listEvents(timeMin: string, timeMax: string): Promise<GCalEvent[]> {
  const params = new URLSearchParams({
    timeMin: new Date(timeMin).toISOString(),
    timeMax: new Date(timeMax).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const data = await calFetch(`/calendars/primary/events?${params}`);
  return data.items || [];
}
