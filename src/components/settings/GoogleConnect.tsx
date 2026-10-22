import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Calendar, Loader2, ListChecks, RefreshCw, AlertTriangle } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { connectGoogle, getGoogleConnection, googleAction, setGoogleConnected, type GoogleCalendar } from "@/lib/gcal";

const NEEDED = [
  { scope: "https://www.googleapis.com/auth/calendar.events", label: "Calendar events" },
  { scope: "https://www.googleapis.com/auth/tasks", label: "Google Tasks" },
];

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "never";

// Settings card: one Google account for Calendar (tasks → events) and Google Tasks (→ Inbox). P-17, P-50.
export default function GoogleConnect() {
  const [conn, setConn] = useState<Tables<"google_connections"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [busy, setBusy] = useState<"connect" | "import" | "sync" | "disconnect" | null>(null);

  const load = useCallback(async () => {
    const c = await getGoogleConnection();
    setConn(c);
    setGoogleConnected(!!c);
    setLoading(false);
    if (c && !c.last_error) {
      googleAction.calendars().then((r) => setCalendars(r.calendars)).catch(() => setCalendars([]));
    }
  }, []);

  useEffect(() => {
    // Back from Google's consent screen.
    const params = new URLSearchParams(window.location.search);
    const result = params.get("google");
    if (result) {
      if (result === "connected") toast({ title: "Google connected" });
      else toast({ title: "Google was not connected", description: params.get("reason") ?? undefined, variant: "destructive" });
      window.history.replaceState(null, "", window.location.pathname);
    }
    load();
  }, [load]);

  const run = async (kind: NonNullable<typeof busy>, job: () => Promise<void>) => {
    setBusy(kind);
    try {
      await job();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
      load();
    } finally {
      setBusy(null);
    }
  };

  const connect = () => run("connect", connectGoogle);

  const importTasks = () =>
    run("import", async () => {
      const r = await googleAction.importTasks();
      toast({
        title: r.added ? `${r.added} new item${r.added === 1 ? "" : "s"} in the Inbox` : "Nothing new",
        description: `${r.found} open task${r.found === 1 ? "" : "s"} in ${r.lists} Google Tasks list${r.lists === 1 ? "" : "s"}`,
      });
      load();
    });

  const sync = () =>
    run("sync", async () => {
      const r = await googleAction.syncCalendar();
      toast({
        title: "Google Calendar synced",
        description: `${r.created} added, ${r.updated} updated, ${r.removed} removed${r.failed ? `, ${r.failed} failed: ${r.errors[0]}` : ""}`,
      });
      load();
    });

  const pickCalendar = async (calendarId: string) => {
    if (!conn) return;
    const { error } = await supabase.from("google_connections").update({ calendar_id: calendarId }).eq("user_id", conn.user_id);
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
      return;
    }
    setConn({ ...conn, calendar_id: calendarId });
    sync(); // events move to the new calendar
  };

  const disconnect = () =>
    run("disconnect", async () => {
      await googleAction.disconnect();
      setConn(null);
      setGoogleConnected(false);
      setCalendars([]);
    });

  const missing = conn ? NEEDED.filter((n) => !conn.scopes.includes(n.scope)) : [];
  const button = "flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:border-primary/40 hover:text-primary disabled:opacity-50";

  return (
    <div className="space-y-4 glass-card p-6">
      <div className="flex items-center gap-3">
        <Calendar className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Google Calendar &amp; Tasks</h3>
      </div>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : !conn ? (
        <>
          <div className="flex items-center gap-3">
            <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
            <span className="text-sm">Not connected</span>
          </div>
          <button
            onClick={connect}
            disabled={!!busy}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
            Connect Google
          </button>
          <p className="text-xs text-muted-foreground">
            Planned tasks appear in your Google Calendar; open Google Tasks come into the Inbox. Google may warn that the app is not verified yet — choose Advanced → Continue.
          </p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <div className={`h-2.5 w-2.5 rounded-full ${conn.last_error ? "bg-destructive" : "bg-green-500"}`} />
            <span className="text-sm">{conn.google_email ?? "Connected"}</span>
          </div>

          {(conn.last_error || missing.length > 0) && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="space-y-2">
                <p>{conn.last_error ?? `Not allowed: ${missing.map((m) => m.label).join(", ")}. Connect again and tick every box.`}</p>
                <button onClick={connect} disabled={!!busy} className="underline">
                  Connect again
                </button>
              </div>
            </div>
          )}

          {calendars.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Calendar for tasks</div>
              <Select value={conn.calendar_id} onValueChange={pickCalendar} disabled={!!busy}>
                <SelectTrigger className="w-full max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {calendars.map((c) => (
                    <SelectItem key={c.id} value={c.primary ? "primary" : c.id}>
                      {c.name}
                      {c.primary ? " (main)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={sync} disabled={!!busy || !!conn.last_error} className={button}>
              {busy === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sync calendar now
            </button>
            <button onClick={importTasks} disabled={!!busy || !!conn.last_error} className={button}>
              {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
              Import Google Tasks
            </button>
            <button
              onClick={disconnect}
              disabled={!!busy}
              className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            Tasks with a planned day sync on every change (all-day events). Calendar synced {when(conn.last_calendar_sync_at)} · Google Tasks imported{" "}
            {when(conn.last_tasks_import_at)} → <Link to="/inbox" className="underline">Inbox</Link>
          </p>
        </>
      )}
    </div>
  );
}
