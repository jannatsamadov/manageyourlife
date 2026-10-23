import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { googleAction, isGoogleConnected, type GoogleEvent } from "@/lib/gcal";

export const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Google Calendar events from local day `from` to `to` (exclusive), by local day "YYYY-MM-DD" (T-9).
// Read from Google when shown, kept for 5 minutes; nothing when Google is not connected.
export function useGoogleEvents(from: string, to: string) {
  const { data: connected } = useQuery({ queryKey: ["google-connected"], queryFn: isGoogleConnected });
  const { data } = useQuery({
    queryKey: ["google-events", from, to],
    queryFn: () => googleAction.events(new Date(`${from}T00:00:00`).toISOString(), new Date(`${to}T00:00:00`).toISOString()),
    enabled: !!connected && !!from && from < to,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return useMemo(() => {
    const byDay: Record<string, GoogleEvent[]> = {};
    for (const ev of data?.events ?? []) {
      // Every local day the event touches; one ending at midnight does not reach the next day.
      const start = ev.all_day ? new Date(`${ev.start}T00:00:00`) : new Date(ev.start);
      const last = ev.all_day
        ? new Date(new Date(`${ev.end}T00:00:00`).getTime() - 1)
        : new Date(Math.max(start.getTime(), new Date(ev.end).getTime() - 1));
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      for (let n = 0; d <= last && n < 100; n++, d.setDate(d.getDate() + 1)) (byDay[localDay(d)] ??= []).push(ev);
    }
    return byDay;
  }, [data]);
}
