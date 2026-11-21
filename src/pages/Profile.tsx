// Profile (P-70 item 10, T-113): the account, the birth date and the Chronos Timer.
import { useEffect, useState } from "react";
import { Info, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/features/profile/useProfile";
import ChronosTimer from "@/features/profile/ChronosTimer";

const today = () => new Date().toISOString().slice(0, 10);
const isBirthDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= "1900-01-01" && v <= today();

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const { profile, save } = useProfile();
  const [draft, setDraft] = useState("");
  useEffect(() => setDraft(profile?.birth_date ?? ""), [profile?.birth_date]);

  const change = async (v: string) => {
    setDraft(v);
    if (v === (profile?.birth_date ?? "") || (v && !isBirthDate(v))) return; // a date still being typed
    try {
      await save({ birth_date: v || null });
    } catch (e) {
      toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-fade-in">
      <h2 className="text-2xl font-bold text-foreground">Profile</h2>

      <div className="glass-card space-y-5 p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Account</div>
            <div className="truncate text-sm font-medium text-foreground">{user?.email}</div>
          </div>
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="mr-1.5 h-4 w-4" /> Sign out
          </Button>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="birth-date">Birth date</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground" aria-label="What it is for" />
              </TooltipTrigger>
              <TooltipContent>For the Chronos Timer: 120 years counted down</TooltipContent>
            </Tooltip>
          </div>
          <input
            id="birth-date"
            type="date"
            min="1900-01-01"
            max={today()}
            value={draft}
            onChange={(e) => change(e.target.value)}
            className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {profile?.birth_date && <ChronosTimer birthDate={profile.birth_date} />}
    </div>
  );
}
