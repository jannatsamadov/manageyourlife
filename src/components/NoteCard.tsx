import { FileText } from "lucide-react";

interface NoteCardProps {
  title: string;
  content: string;
  updatedAt: string;
  onClick: () => void;
  todos?: { done: number; total: number }; // when the content is only an excerpt (vault notes)
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getPreviewLines(content: string): string {
  const lines = content.split("\n").filter((l) => l.trim());
  return lines.slice(0, 2).join("\n") || "";
}

function countTodos(content: string): { done: number; total: number } {
  const todos = content.match(/^- \[[ x]\] .+$/gm) || [];
  const done = (content.match(/^- \[x\] .+$/gm) || []).length;
  return { done, total: todos.length };
}

export default function NoteCard({ title, content, updatedAt, onClick, todos: given }: NoteCardProps) {
  const preview = getPreviewLines(content);
  const hasMore = content.split("\n").filter((l) => l.trim()).length > 2 || content.length > 120;
  const todos = given ?? countTodos(content);

  return (
    <div
      onClick={onClick}
      className="group relative cursor-pointer rounded-xl border border-border bg-gradient-to-br from-[hsl(220_25%_13%)] to-[hsl(220_20%_10%)] p-4 transition-all duration-200 hover:border-info/40 hover:shadow-lg hover:shadow-info/5 min-h-[140px] flex flex-col"
    >
      {/* Accent bar */}
      <div className="absolute left-0 top-3 bottom-3 w-1 rounded-full bg-info/60 group-hover:bg-info transition-colors" />

      <div className="pl-3 flex flex-col flex-1">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-foreground line-clamp-1">{title || "Untitled"}</h3>
          <FileText className="h-3.5 w-3.5 text-info/50 shrink-0 mt-0.5" />
        </div>

        {/* Content preview with fade */}
        <div className="relative flex-1 min-h-[40px]">
          <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line line-clamp-2">
            {preview || "Empty note..."}
          </p>
          {hasMore && (
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[hsl(220_20%_10%)] to-transparent pointer-events-none" />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
          <span className="text-[10px] text-muted-foreground">{formatDate(updatedAt)}</span>
          {todos.total > 0 && (
            <span className="text-[10px] font-mono text-info/70">
              {todos.done}/{todos.total} tasks
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
