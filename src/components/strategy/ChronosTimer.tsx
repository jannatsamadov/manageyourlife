import { useState, useEffect } from "react";
import { getSettings } from "@/lib/settings";

const MAX_YEARS = 120;

function calcRemaining(birthdate: string) {
  if (!birthdate) return null;
  const birth = new Date(birthdate);
  const deathDate = new Date(birth);
  deathDate.setFullYear(birth.getFullYear() + MAX_YEARS);
  const now = new Date();
  const diff = deathDate.getTime() - now.getTime();
  if (diff <= 0) return { years: 0, days: 0, hours: 0, minutes: 0, seconds: 0, pct: 100 };
  
  const totalLife = deathDate.getTime() - birth.getTime();
  const elapsed = now.getTime() - birth.getTime();
  const pct = Math.min(100, (elapsed / totalLife) * 100);
  
  const seconds = Math.floor(diff / 1000) % 60;
  const minutes = Math.floor(diff / 60000) % 60;
  const hours = Math.floor(diff / 3600000) % 24;
  const totalDays = Math.floor(diff / 86400000);
  const years = Math.floor(totalDays / 365.25);
  const days = Math.floor(totalDays % 365.25);

  return { years, days, hours, minutes, seconds, pct };
}

export default function ChronosTimer() {
  const [remaining, setRemaining] = useState<ReturnType<typeof calcRemaining>>(null);

  useEffect(() => {
    const birthdate = getSettings().birthdate;
    if (!birthdate) return;
    
    setRemaining(calcRemaining(birthdate));
    const interval = setInterval(() => setRemaining(calcRemaining(birthdate)), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!remaining) {
    return (
      <div className="glass-card p-5 border-border/30 text-center">
        <p className="text-sm text-muted-foreground">
          Chronos Timer deaktivdir. Settings → doğum tarixinizi daxil edin.
        </p>
      </div>
    );
  }

  const digits = [
    { label: "YRS", value: remaining.years },
    { label: "DAYS", value: remaining.days },
    { label: "HRS", value: remaining.hours },
    { label: "MIN", value: remaining.minutes },
    { label: "SEC", value: remaining.seconds },
  ];

  return (
    <div className="glass-card p-5 border-border/30 relative overflow-hidden">
      {/* Subtle glow background */}
      <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-primary/5 pointer-events-none" />
      
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-primary font-mono">
              ⏱ CHRONOS ENGINE
            </h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">Active Epoch Countdown</p>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground">
            {remaining.pct.toFixed(4)}% elapsed
          </span>
        </div>

        {/* Timer digits */}
        <div className="flex items-center justify-center gap-1.5">
          {digits.map((d, i) => (
            <div key={d.label} className="flex items-center gap-1.5">
              <div className="flex flex-col items-center">
                <span className="text-2xl md:text-3xl font-mono font-bold text-foreground tracking-wider tabular-nums"
                  style={{ textShadow: "0 0 20px hsl(var(--primary) / 0.4)" }}>
                  {String(d.value).padStart(d.label === "YRS" ? 2 : d.label === "DAYS" ? 3 : 2, "0")}
                </span>
                <span className="text-[9px] font-mono text-muted-foreground tracking-widest">{d.label}</span>
              </div>
              {i < digits.length - 1 && (
                <span className="text-xl font-mono text-primary/40 mb-3">:</span>
              )}
            </div>
          ))}
        </div>

        {/* Life progress bar */}
        <div className="mt-4 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{
              width: `${remaining.pct}%`,
              background: `linear-gradient(90deg, hsl(var(--primary) / 0.6), hsl(var(--primary)))`,
              boxShadow: "0 0 10px hsl(var(--primary) / 0.5)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
