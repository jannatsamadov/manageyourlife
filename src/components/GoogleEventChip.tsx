import type { GoogleEvent } from "@/lib/gcal";
import { cn } from "@/lib/utils";

// A Google Calendar event in the app's calendar (T-9): read-only, opens in Google Calendar.
export default function GoogleEventChip({ event, className }: { event: GoogleEvent; className?: string }) {
  const time = event.all_day ? "" : new Date(event.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <a
      href={event.url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`${time ? `${time} ` : ""}${event.title} · ${event.calendar}`}
      style={{ borderLeftColor: event.color ?? undefined }}
      className={cn("block truncate rounded border-l-2 border-muted-foreground bg-muted/40 px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground", className)}
    >
      {time && <span className="mr-1 font-mono">{time}</span>}
      {event.title}
    </a>
  );
}
