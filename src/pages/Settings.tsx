import { useState, useEffect } from "react";
import { Settings as SettingsIcon, Calendar, Loader2, Check, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { AI_MODELS, getSettings, saveSettings, type Settings } from "@/lib/settings";
import { isGCalConfigured, isGCalConnected, connectGCal, disconnectGCal, setClientId } from "@/lib/gcal";
import { toast } from "@/hooks/use-toast";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [gcalConnected, setGcalConnected] = useState(false);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [clientIdInput, setClientIdInput] = useState("");
  const [showClientId, setShowClientId] = useState(false);

  useEffect(() => {
    setSettings(getSettings());
    setGcalConnected(isGCalConnected());
    const stored = localStorage.getItem("stratify_gcal_client_id") || "";
    setClientIdInput(stored);
    setShowClientId(!stored);
  }, []);

  const update = (partial: Partial<Settings>) => {
    const next = saveSettings(partial);
    setSettings(next);
  };

  const handleConnect = async () => {
    if (!clientIdInput.trim()) {
      toast({ title: "Client ID required", description: "Enter your Google OAuth Client ID first", variant: "destructive" });
      return;
    }
    setClientId(clientIdInput.trim());
    setGcalLoading(true);
    try {
      const ok = await connectGCal();
      setGcalConnected(ok);
      if (ok) {
        toast({ title: "Connected", description: "Google Calendar connected successfully" });
        setShowClientId(false);
      }
    } catch (e: any) {
      toast({ title: "Connection failed", description: e.message, variant: "destructive" });
    } finally {
      setGcalLoading(false);
    }
  };

  const handleDisconnect = () => {
    disconnectGCal();
    setGcalConnected(false);
    toast({ title: "Disconnected", description: "Google Calendar disconnected" });
  };

  if (!settings) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-8 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">Customize your Stratify experience</p>
      </div>

      <div className="space-y-6 glass-card p-6">
        <div className="flex items-center gap-3">
          <SettingsIcon className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">AI Assistant</h3>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ai-model">AI Model</Label>
          <Select value={settings.aiModel} onValueChange={(v) => update({ aiModel: v as Settings["aiModel"] })}>
            <SelectTrigger id="ai-model" className="w-full max-w-xs">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {AI_MODELS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">The model used for chat suggestions and task creation</p>
        </div>

        <Separator />

        <div className="space-y-4">
          <h3 className="text-base font-medium text-foreground">Display</h3>
          <div className="flex items-center justify-between">
            <Label htmlFor="compact">Compact view</Label>
            <Switch id="compact" checked={settings.compactView} onCheckedChange={(v) => update({ compactView: v })} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="progress">Show progress bars on tasks</Label>
            <Switch id="progress" checked={settings.showProgressBars} onCheckedChange={(v) => update({ showProgressBars: v })} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="blink">Deadline blink effect</Label>
            <Switch id="blink" checked={settings.blinkEffect} onCheckedChange={(v) => update({ blinkEffect: v })} />
          </div>
        </div>
      </div>

      <div className="space-y-6 glass-card p-6">
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Google Calendar Sync</h3>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className={`h-2.5 w-2.5 rounded-full ${gcalConnected ? "bg-green-500" : "bg-muted-foreground/40"}`} />
            <span className="text-sm">{gcalConnected ? "Connected" : "Not connected"}</span>
          </div>

          {(showClientId || !isGCalConfigured()) && (
            <div className="space-y-2">
              <Label htmlFor="gcal-client-id">Google OAuth Client ID</Label>
              <input
                id="gcal-client-id"
                value={clientIdInput}
                onChange={(e) => setClientIdInput(e.target.value)}
                placeholder="xxxx.apps.googleusercontent.com"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="text-[10px] text-muted-foreground">
                Create at{" "}
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" className="text-primary underline">
                  Google Cloud Console
                </a>
                {" "}→ OAuth 2.0 Client ID (Web application). Enable Calendar API.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            {!gcalConnected ? (
              <button
                onClick={handleConnect}
                disabled={gcalLoading}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {gcalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
                Connect Google Calendar
              </button>
            ) : (
              <>
                <span className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
                  <Check className="h-4 w-4" /> Connected
                </span>
                <button onClick={handleDisconnect} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:text-destructive hover:border-destructive/50">
                  <X className="h-3.5 w-3.5" /> Disconnect
                </button>
                {!showClientId && (
                  <button onClick={() => setShowClientId(true)} className="text-xs text-muted-foreground underline hover:text-foreground">
                    Change Client ID
                  </button>
                )}
              </>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            When connected, scheduled tasks will sync to your Google Calendar. Use the sync button on the Schedule page.
          </p>
        </div>
      </div>
    </div>
  );
}
