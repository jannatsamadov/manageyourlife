import { useState, useEffect } from "react";
import { Settings as SettingsIcon, Calendar } from "lucide-react";
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
import { isGCalAvailable } from "@/lib/gcal";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "@/hooks/use-toast";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [gcalOk, setGcalOk] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    setSettings(getSettings());
    isGCalAvailable().then(setGcalOk);
  }, []);

  const update = (partial: Partial<Settings>) => {
    const next = saveSettings(partial);
    setSettings(next);
  };

  const connectGoogleCalendar = async () => {
    setConnecting(true);
    try {
      const { error } = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
        extraParams: {
          prompt: "consent",
          access_type: "offline",
        },
      });
      if (error) {
        toast({ title: "Connection failed", description: error.message, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Connection failed", description: err.message, variant: "destructive" });
    } finally {
      setConnecting(false);
    }
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
          <h3 className="text-lg font-semibold text-foreground">Google Calendar</h3>
        </div>
        <div className="flex items-center gap-3">
          <div className={`h-2.5 w-2.5 rounded-full ${gcalOk ? "bg-green-500" : "bg-muted-foreground/40"}`} />
          <span className="text-sm">{gcalOk ? "Connected — syncing with your Google Calendar" : "Not connected"}</span>
        </div>
        {!gcalOk && (
          <button
            onClick={connectGoogleCalendar}
            disabled={connecting}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Calendar className="h-4 w-4" />
            {connecting ? "Connecting..." : "Connect Google Calendar"}
          </button>
        )}
        <p className="text-xs text-muted-foreground">
          {gcalOk
            ? "Scheduled tasks will sync to your Google Calendar via the Sync button on the Schedule page."
            : "Connect your Google account to enable calendar sync. You'll need to grant calendar permissions."}
        </p>
      </div>
    </div>
  );
}
