// A folder in the Notes gallery (P-57), as the owner's reference card: the cover shows the folder, the paper behind it
// its latest notes; the 3-dot (actions) and settings (colour) icons show on hover. Notes can be dropped on it.
import { useState, type CSSProperties } from "react";
import { FilePlus2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FOLDER_COLORS, type Dir } from "@/lib/vault";
import "./folder-card.css";

export const NOTE_DRAG = "application/x-vault-note";
const DEFAULT = "#469cf4";

const memoDate = (iso: string) => {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).replace(/^(\w+)/, "$1,"),
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
  };
};
const thousands = (n: number) => n.toLocaleString("en-US").replace(/,/g, " ");

export default function FolderCard({ dir, color, onOpen, onNewNote, onColor, onDropNote }: {
  dir: Dir;
  color?: string;
  onOpen: (path: string) => void;
  onNewNote: (folder: string) => void;
  onColor: (folder: string, color: string | null) => void;
  onDropNote: (notePath: string, folder: string) => void;
}) {
  const [opening, setOpening] = useState(false);
  const [over, setOver] = useState(false);
  const c = FOLDER_COLORS[color ?? DEFAULT] ?? FOLDER_COLORS[DEFAULT];
  const style = {
    "--folder-back-color": c.back,
    "--folder-front-grad-start": c.start,
    "--folder-front-grad-end": c.end,
    "--folder-glow": c.glow,
  } as CSSProperties;
  const total = dir.todoOpen + dir.todoDone;
  const when = dir.modified ? memoDate(dir.modified) : null;

  // The paper rises (the reference's "open" state), then the folder opens.
  const open = () => {
    setOpening(true);
    setTimeout(() => onOpen(dir.path), 320);
  };

  return (
    <div
      className={cn("fc card-viewport", opening && "is-open", over && "is-drop")}
      style={style}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(NOTE_DRAG)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const path = e.dataTransfer.getData(NOTE_DRAG);
        if (path) onDropNote(path, dir.path);
      }}
    >
      <div className="folder-container">
        <div className="folder-glow" />
        <div className="back-cover" />
        <div className="back-tab" />
        <div className="swoop" />

        <div className="paper">
          <div className="memo-header">
            <span className="memo-date">
              {when?.date}
              {when && <span className="time-badge">{when.time}</span>}
            </span>
            <div className="memo-header-right">
              <svg className="header-dots-icon" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
              </svg>
              {total > 0 && <span className="memo-done-btn">{dir.todoDone}/{total}</span>}
            </div>
          </div>
          <div className="memo-body">
            <div className="todo-list">
              {dir.latest.map((f) => (
                <label key={f.id} className="todo-item">
                  <input type="checkbox" className="todo-checkbox" checked={f.todo_done > 0 && f.todo_open === 0} readOnly tabIndex={-1} />
                  <span className="todo-text">{f.title}</span>
                </label>
              ))}
            </div>
            <span className="memo-title">Recent</span>
            {dir.tag && (
              <div className="memo-footer">
                <span className="footer-txt"><span className="hashtag">#{dir.tag}</span></span>
              </div>
            )}
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          className="front-cover"
          onClick={open}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open())}
        >
          <div className="cover-highlight" />
          <div className="header">
            <div className="title-group">
              <span className="cover-main-title">{dir.name}</span>
              {dir.dirs.length > 0 && <span className="cover-subtitle">{dir.dirs.length} {dir.dirs.length === 1 ? "folder" : "folders"}</span>}
            </div>
            <div className="icon-group" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="fc-icon" aria-label="Actions">
                    <svg viewBox="0 0 24 24">
                      <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                    </svg>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onNewNote(dir.path)}>
                    <FilePlus2 className="mr-2 h-4 w-4" />
                    New note
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="fc-icon" aria-label="Colour">
                    <svg viewBox="0 0 24 24">
                      <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z" />
                    </svg>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="flex w-auto gap-1.5 p-2">
                  {Object.keys(FOLDER_COLORS).map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      aria-label={hex}
                      onClick={() => onColor(dir.path, hex === DEFAULT ? null : hex)}
                      className={cn("h-6 w-6 rounded-full ring-offset-2 ring-offset-popover", (color ?? DEFAULT) === hex && "ring-2 ring-foreground/60")}
                      style={{ background: hex }}
                    />
                  ))}
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <div className="footer">
            <span className="cover-notes-count">{thousands(dir.count)} notes</span>
          </div>
        </div>
      </div>
    </div>
  );
}
