import { useCallback, useEffect, useState } from "react";
import { Calendar, Loader2, ListChecks, RefreshCw, AlertTriangle } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { connectGoogle, getGoogleConnection, googleAction, setGoogleConnected, type GoogleCalendar } from "@/lib/gcal";

const NEEDED = [
  { scope: "https://www.googleapis.com/auth/calendar.events", label: "Calendar" },
  { scope: "https://www.googleapis.com/auth/tasks", label: "Tasks" },
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
    if (c && !c.last_error) googleAction.calendars().then((r) => setCalendars(r.calendars)).catch(() => setCalendars([]));
  }, []);

  useEffect(() => {
    // Back from Google's consent screen.
    const params = new URLSearchParams(window.location.search);
    const result = params.get("google");
    if (result) {
      if (result === "connected") toast({ title: "Google connected" });
      else toast({ title: "Google not connected", description: params.get("reason") ?? undefined, variant: "destructive" });
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
      toast({ title: `${r.added} new in the Inbox` });
      load();
    });

  const sync = () =>
    run("sync", async () => {
      const r = await googleAction.syncCalendar();
      toast({ title: `+${r.created} · ~${r.updated} · −${r.removed}${r.failed ? ` · ${r.failed} failed` : ""}`, description: r.errors[0] });
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
  const spin = (kind: typeof busy, Icon: typeof Calendar) => (busy === kind ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />);
  const button = "flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:border-primary/40 hover:text-primary disabled:opacity-50";

  return (
    <div className="space-y-4 glass-card p-6">
      <div className="flex items-center gap-3">
        <Calendar className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Google</h3>
        {conn && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className={`h-2.5 w-2.5 rounded-full ${conn.last_error ? "bg-destructive" : "bg-green-500"}`} />
            {conn.google_email}
          </span>
        )}
      </div>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : !conn ? (
        <button
          onClick={connect}
          disabled={!!busy}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {spin("connect", Calendar)}
          Connect
        </button>
      ) : (
        <>
          {(conn.last_error || missing.length > 0) && (
            <button onClick={connect} disabled={!!busy} className="flex items-center gap-2 text-sm text-destructive hover:underline">
              <AlertTriangle className="h-4 w-4" />
              {conn.last_error ? "Reconnect" : `No access: ${missing.map((m) => m.label).join(", ")} — reconnect`}
            </button>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {calendars.length > 0 && (
              <Select value={conn.calendar_id} onValueChange={pickCalendar} disabled={!!busy}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {calendars.map((c) => (
                    <SelectItem key={c.id} value={c.primary ? "primary" : c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={sync} disabled={!!busy || !!conn.last_error} className={button}>
                  {spin("sync", RefreshCw)}
                  Sync
                </button>
              </TooltipTrigger>
              <TooltipContent>Planned tasks → calendar (also automatic on every change). Last: {when(conn.last_calendar_sync_at)}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={importTasks} disabled={!!busy || !!conn.last_error} className={button}>
                  {spin("import", ListChecks)}
                  Tasks
                </button>
              </TooltipTrigger>
              <TooltipContent>Open Google Tasks → Inbox. Last: {when(conn.last_tasks_import_at)}</TooltipContent>
            </Tooltip>
            <button
              onClick={disconnect}
              disabled={!!busy}
              className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}
