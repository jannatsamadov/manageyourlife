// Ideas (P-64, owner 2026-10-25: "ideas come up in different projects and are scattered"): every idea in the files
// in one place, by project — notes in an ideas folder or tagged #idea, items under an "Ideas" / "İdeyalar" heading
// (Telegram captures too), plan items marked IDEA, task-table rows with the status IDEA. The files stay where they
// are; a click opens the note. New ideas go to the ideas folder the user already keeps (else "Ideas").
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Lightbulb, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fileName, folderOf, safeName, scanAll, vault } from "@/lib/vault";
import { projectName, projectOf } from "@/lib/todos";

type Idea = {
  file_id: string;
  path: string;
  title: string;
  modified_at: string;
  kind: "note" | "item" | "plan" | "row" | "line";
  text: string;
  detail: string | null;
  line: number | null;
};
type Group = { project: string; ideas: Idea[]; modified: string };

const remember = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

function Icon({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onClick} disabled={disabled} className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50">
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function Ideas() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = useMemo(() => ["ideas", user?.id], [user?.id]);
  const ideas = useQuery({
    queryKey: key,
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => (await vault<{ ideas: Idea[] }>("ideas")).ideas,
  });
  const [syncing, setSyncing] = useState(false);
  const [q, setQ] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(remember.get("ideas.open") ?? "[]")); } catch { return new Set(); }
  });
  const toggle = (project: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(project)) next.add(project);
      remember.set("ideas.open", JSON.stringify([...next]));
      return next;
    });

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const map = new Map<string, Group>();
    for (const idea of ideas.data ?? []) {
      if (s && !`${idea.text} ${idea.detail ?? ""} ${idea.path}`.toLowerCase().includes(s)) continue;
      const project = projectOf(idea.path);
      const g = map.get(project) ?? { project, ideas: [], modified: "" };
      g.ideas.push(idea);
      if (idea.modified_at > g.modified) g.modified = idea.modified_at;
      map.set(project, g);
    }
    return [...map.values()].sort((a, b) => b.modified.localeCompare(a.modified));
  }, [ideas.data, q]);
  const total = groups.reduce((n, g) => n + g.ideas.length, 0);

  // Where a new idea goes: the folder that already holds the most idea notes (e.g. Notes/İdeyalar), else "Ideas".
  const home = useMemo(() => {
    const count = new Map<string, number>();
    for (const i of ideas.data ?? []) if (i.kind === "note") count.set(folderOf(i.path), (count.get(folderOf(i.path)) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] || "Ideas";
  }, [ideas.data]);

  const openNote = (path: string) => navigate(`/notes?open=${encodeURIComponent(path)}`);
  const create = async (name: string) => {
    setNaming(null);
    const title = safeName(name);
    if (!title) return;
    for (let n = 1; n < 20; n++) {
      const path = `${home}/${title}${n > 1 ? ` ${n}` : ""}.md`;
      try {
        const r = await vault<{ conflict?: boolean }>("write", { path, text: `# ${name.trim()}\n\n`, etag: null });
        if (r.conflict) continue;
        qc.invalidateQueries({ queryKey: key });
        openNote(path);
      } catch (e) {
        toast({ title: "Not created", description: (e as Error).message, variant: "destructive" });
      }
      return;
    }
  };
  const sync = async () => {
    setSyncing(true);
    try {
      await scanAll();
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast({ title: "Sync failed", description: (e as Error).message, variant: "destructive" });
    }
    setSyncing(false);
  };

  return (
    <div className="mx-auto max-w-4xl animate-fade-in">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-xl font-bold text-foreground">Ideas</h1>
        {!ideas.isLoading && <span className="text-sm tabular-nums text-muted-foreground">{total}</span>}
        <div className="relative ml-auto min-w-[10rem] max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="w-full rounded-lg border border-border bg-card py-1.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
        <Icon label={`New idea in ${home}`} onClick={() => setNaming("")}><Plus className="h-4 w-4" /></Icon>
        <Icon label="Sync" onClick={sync} disabled={syncing}><RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} /></Icon>
      </div>
      {naming !== null && (
        <input
          autoFocus
          value={naming}
          onChange={(e) => setNaming(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && naming.trim()) create(naming);
            if (e.key === "Escape") setNaming(null);
          }}
          onBlur={() => !naming.trim() && setNaming(null)}
          placeholder={`${home} / Name`}
          className="mb-3 w-full max-w-md rounded-md border border-primary/40 bg-background px-3 py-1.5 text-sm focus:outline-none"
        />
      )}

      {ideas.isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const expanded = open.has(g.project) || !!q.trim();
            const Chevron = expanded ? ChevronDown : ChevronRight;
            const parent = folderOf(g.project);
            return (
              <div key={g.project} className="rounded-xl border border-border bg-card">
                <div role="button" tabIndex={0} onClick={() => toggle(g.project)} onKeyDown={(e) => e.key === "Enter" && toggle(g.project)}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2">
                  <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{projectName(g.project)}</span>
                  {parent && <span className="truncate text-xs text-muted-foreground/60">{parent}</span>}
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">{g.ideas.length}</span>
                </div>
                {expanded && (
                  <ul className="space-y-0.5 border-t border-border px-2 py-2">
                    {g.ideas.map((idea) => (
                      <li
                        key={`${idea.file_id}:${idea.line ?? "note"}`}
                        onClick={() => openNote(idea.path)}
                        className="group flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 hover:bg-muted/40"
                      >
                        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-foreground">{idea.text}</p>
                          {idea.detail && <p className="line-clamp-1 text-xs text-muted-foreground">{idea.detail}</p>}
                        </div>
                        {idea.kind !== "note" && (
                          <span className="mt-0.5 max-w-[35%] shrink-0 truncate text-[11px] text-muted-foreground/60">{fileName(idea.path).replace(/\.md$/i, "")}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {!groups.length && <div className="py-16 text-center text-sm text-muted-foreground">—</div>}
        </div>
      )}
    </div>
  );
}
