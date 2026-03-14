import { useAppState } from "@/context/AppContext";
import { Wrench, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

const LIFE_OPS_TAGS = ["health", "wealth"];

export default function LifeOps() {
  const { tasks, updateTask } = useAppState();

  // Life Ops = tasks tagged with health/wealth attribute that are routine/maintenance
  const lifeOpsTasks = tasks.filter(
    t => LIFE_OPS_TAGS.includes((t as any).attribute_tag || "general") && t.status !== "abandoned" && !t.deletedAt
  );

  const toggleComplete = (id: string, currentStatus: string) => {
    updateTask(id, { status: currentStatus === "complete" ? "idle" : "complete" });
  };

  return (
    <div className="glass-card p-5 border-border/30">
      <div className="flex items-center gap-2 mb-4">
        <Wrench className="h-4 w-4 text-warning" />
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-warning">▸ LIFE OPS</span>
        <div className="flex-1 h-px bg-border/30" />
        <span className="text-[10px] font-mono text-muted-foreground">{lifeOpsTasks.length} tasks</span>
      </div>

      {lifeOpsTasks.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          Attribute_tag "health" və ya "wealth" olan task-lar burada görünəcək.
          <br />
          Task-ları redaktə edərək attribute tag əlavə edin.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-[240px] overflow-y-auto chat-scroll">
          {lifeOpsTasks.map(task => (
            <button
              key={task.id}
              onClick={() => toggleComplete(task.id, task.status)}
              className="flex items-center gap-3 w-full rounded-md px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left group"
            >
              {task.status === "complete" ? (
                <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              )}
              <span className={cn("flex-1", task.status === "complete" && "line-through text-muted-foreground")}>
                {task.title}
              </span>
              <span className={cn(
                "text-[9px] font-mono uppercase px-1.5 py-0.5 rounded",
                (task as any).attribute_tag === "health" ? "text-red-400 bg-red-500/10" : "text-yellow-400 bg-yellow-500/10"
              )}>
                {(task as any).attribute_tag}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
