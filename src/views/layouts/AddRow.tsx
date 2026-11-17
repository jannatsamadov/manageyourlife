import { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

// "+ Add" that turns into a line to type a title; Enter adds and keeps the line open for the next one.
export function AddRow({ onAdd, className }: { onAdd: (title: string) => void; className?: string }) {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  if (!typing) {
    return (
      <button type="button" onClick={() => setTyping(true)} className={cn("flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground", className)}>
        <Plus className="h-3.5 w-3.5" /> Add
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={text}
      placeholder="Title, Enter"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (!text.trim()) setTyping(false); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { setText(""); setTyping(false); }
        if (e.key === "Enter" && text.trim()) { onAdd(text.trim()); setText(""); }
      }}
      className={cn("w-full bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground/60", className)}
    />
  );
}
