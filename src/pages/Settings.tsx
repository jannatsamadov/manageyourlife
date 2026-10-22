import { useState, useEffect } from "react";
import { Settings as SettingsIcon } from "lucide-react";
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
import TelegramConnect from "@/components/settings/TelegramConnect";
import GoogleConnect from "@/components/settings/GoogleConnect";
import ApiTokens from "@/components/settings/ApiTokens";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    setSettings(getSettings());
  }, []);

  const update = (partial: Partial<Settings>) => {
    const next = saveSettings(partial);
    setSettings(next);
  };

  if (!settings) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-8 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Settings</h2>
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
          </Select>        </div>

        <Separator />

        <div className="space-y-4">
          <h3 className="text-base font-medium text-foreground">Chronos Timer</h3>
          <div className="space-y-2">
            <Label htmlFor="birthdate">Doğum tarixi</Label>
            <input
              id="birthdate"
              type="date"
              value={settings.birthdate}
              onChange={(e) => update({ birthdate: e.target.value })}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-full max-w-xs"
            />
            <p className="text-xs text-muted-foreground">120 illik ömür countdown hesablanması üçün istifadə olunur</p>
          </div>
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

      <TelegramConnect />

      <GoogleConnect />

      <ApiTokens />
    </div>
  );
}
