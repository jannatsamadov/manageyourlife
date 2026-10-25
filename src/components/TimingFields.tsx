// When a task happens (P-60): one tap — Event, Deadline or Planned (tap again: none, it waits in the store) — and
// only the fields of that kind. Used by the task popup and the new-task form.
import { CalendarCheck, CalendarClock, Flag } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { localDay } from "@/hooks/useGoogleEvents";
import { cn } from "@/lib/utils";
import { timingOf, type Timing } from "@/lib/timing";

export type TimingValue = {
  isEvent: boolean;
  date: string;
  time: string;
  deadline: string;
  deadlineTime: string;
  estimatedTime: string;
};

const KINDS: { kind: Exclude<Timing, null>; label: string; tip: string; icon: typeof Flag }[] = [
  { kind: "event", label: "Event", tip: "At a fixed time — goes to Google Calendar", icon: CalendarClock },
  { kind: "deadline", label: "Deadline", tip: "Done by this day", icon: Flag },
  { kind: "planned", label: "Planned", tip: "The day (and time) I'll do it", icon: CalendarCheck },
];

const input = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-primary";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

// "13:15" before a task's title; an event also gets the calendar-clock mark.
export function TimeTag({ task, className }: { task: { time?: string | null; isEvent?: boolean }; className?: string }) {
  if (!task.time && !task.isEvent) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-0.5 tabular-nums", className)}>
      {task.isEvent && <CalendarClock className="h-3 w-3" />}
      {task.time}
    </span>
  );
}

export default function TimingFields({ value: v, onChange }: { value: TimingValue; onChange: (v: TimingValue) => void }) {
  const kind = timingOf(v);
  const today = localDay(new Date());
  const set = (patch: Partial<TimingValue>) => onChange({ ...v, ...patch });

  const pick = (k: Exclude<Timing, null>) => {
    if (k === kind) return set({ isEvent: false, date: "", time: "", deadline: "", deadlineTime: "" }); // none
    if (k === "event") return set({ isEvent: true, date: v.date || v.deadline || today, time: v.time || v.deadlineTime || "09:00", deadline: "", deadlineTime: "", estimatedTime: v.estimatedTime || "60" });
    if (k === "planned") return set({ isEvent: false, date: v.date || today });
    set({ isEvent: false, date: "", time: "", deadline: v.deadline || v.date || today }); // deadline
  };

  const minutes = (label: string) => (
    <Field label={label}>
      <input type="number" min="1" value={v.estimatedTime} onChange={(e) => set({ estimatedTime: e.target.value })} placeholder="min" className={input} />
    </Field>
  );

  return (
    <div className="space-y-3">
      <div className="flex overflow-hidden rounded-lg border border-border">
        {KINDS.map(({ kind: k, label, tip, icon: Icon }) => (
          <Tooltip key={k}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => pick(k)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium transition-colors",
                  kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            </TooltipTrigger>
            <TooltipContent>{tip}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {kind === "event" && (
          <>
            <Field label="Date"><input type="date" value={v.date} onChange={(e) => e.target.value && set({ date: e.target.value })} className={input} /></Field>
            <Field label="Start"><input type="time" value={v.time} onChange={(e) => e.target.value && set({ time: e.target.value })} className={input} /></Field>
            {minutes("Minutes")}
          </>
        )}
        {kind === "planned" && (
          <>
            <Field label="Date"><input type="date" value={v.date} onChange={(e) => e.target.value && set({ date: e.target.value })} className={input} /></Field>
            <Field label="Time"><input type="time" value={v.time} onChange={(e) => set({ time: e.target.value })} className={input} /></Field>
            {minutes("Estimate")}
            <Field label="Deadline"><input type="date" value={v.deadline} onChange={(e) => set({ deadline: e.target.value, deadlineTime: e.target.value ? v.deadlineTime : "" })} className={input} /></Field>
          </>
        )}
        {kind === "deadline" && (
          <>
            <Field label="Deadline"><input type="date" value={v.deadline} onChange={(e) => e.target.value && set({ deadline: e.target.value })} className={input} /></Field>
            <Field label="Time"><input type="time" value={v.deadlineTime} onChange={(e) => set({ deadlineTime: e.target.value })} className={input} /></Field>
            {minutes("Estimate")}
          </>
        )}
        {kind === null && minutes("Estimate")}
      </div>
    </div>
  );
}
