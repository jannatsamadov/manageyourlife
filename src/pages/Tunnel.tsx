import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, CalendarDays, Images, ListChecks } from "lucide-react";
import { useAppState, type Task } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { loadMemories } from "@/lib/memories";
import { fileName, vault } from "@/lib/vault";
import { dayNumber, isoDay, isVideo, largerSpan, localToday, smallerSpan, spanDays, SPANS, type TunnelSpan } from "@/lib/tunnel";
import TunnelScene, { readPalette, type TunnelMedia } from "@/components/tunnel/TunnelScene";
import TaskEditPopup from "@/components/TaskEditPopup";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import "@/components/tunnel/tunnel.css";

const dayOfName = (p: string) => dayNumber(fileName(p).match(/^(\d{4}-\d{2}-\d{2})/)?.[1]);

export default function Tunnel() {
  const { tasks } = useAppState();
  const { user } = useAuth();
  const today = useMemo(() => localToday(), []);
  const [day, setDay] = useState(today);
  const [span, setSpan] = useState<TunnelSpan>("day");
  const [mode, setMode] = useState<"tasks" | "gallery">("tasks");
  const [editing, setEditing] = useState<Task | null>(null);
  const [opened, setOpened] = useState<TunnelMedia | null>(null);
  const [ready, setReady] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<ReturnType<typeof readPalette> | null>(null);
  useEffect(() => { if (root.current) setPalette(readPalette(root.current)); }, []);

  const media = useQuery({
    queryKey: ["tunnel-media", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [mem, vids] = await Promise.all([
        loadMemories(),
        (supabase as any).from("vault_files").select("path").is("trashed_at", null).like("path", "Inbox/files/%"),
      ]);
      const list: TunnelMedia[] = [];
      for (const [iso, m] of mem) { const d = dayNumber(iso); if (d !== null) m.images.forEach(path => list.push({ path, day: d, video: false })); }
      for (const v of (vids.data ?? []) as { path: string }[]) { const d = dayOfName(v.path); if (d !== null && isVideo(v.path)) list.push({ path: v.path, day: d, video: true }); }
      return list;
    },
  });
  const visible = useMemo(() => {
    const w = spanDays(span) * 4;
    return (media.data ?? []).filter(m => Math.abs(m.day - day) < w).slice(0, 40);
  }, [media.data, day, span]);
  const paths = visible.map(m => m.path);
  const urls = useQuery({
    queryKey: ["tunnel-urls", paths],
    enabled: paths.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async () => (await vault<{ urls: Record<string, string> }>("urls", { paths })).urls,
  });

  const move = (dir: number) => setDay(d => span === "year"
    ? Math.floor(Date.UTC(new Date(d * 86400000).getUTCFullYear() + dir, 0, 1) / 86400000) : d + dir * spanDays(span));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,[contenteditable]")) return;
      if (e.key === "ArrowUp" || e.key === "w") move(1);
      if (e.key === "ArrowDown" || e.key === "s") move(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div ref={root} className="tunnel-page space-y-3 p-3 md:p-6">
      <div className="tunnel-toolbar glass-card rounded-xl p-3">
        <h1 className="mr-auto text-lg font-semibold">Tunnel of days</h1>
        <Button size="sm" variant="outline" onClick={() => move(-1)} aria-label="Previous"><ChevronLeft /></Button>
        <input type="date" className="tunnel-span-select" value={isoDay(day)} onChange={e => { const d = dayNumber(e.target.value); if (d !== null) setDay(d); }} />
        <Button size="sm" variant="outline" onClick={() => move(1)} aria-label="Next"><ChevronRight /></Button>
        <Button size="sm" variant="ghost" onClick={() => setDay(today)}><CalendarDays /> Today</Button>
        <select className="tunnel-span-select" aria-label="Box size" value={span} onChange={e => setSpan(e.target.value as TunnelSpan)}>
          {SPANS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <Button size="sm" variant="outline" onClick={() => setSpan(smallerSpan(span))} aria-label="Zoom in"><ZoomIn /></Button>
        <Button size="sm" variant="outline" onClick={() => setSpan(largerSpan(span))} aria-label="Zoom out"><ZoomOut /></Button>
        <Button size="sm" variant={mode === "tasks" ? "default" : "outline"} onClick={() => setMode("tasks")}><ListChecks /> Tasks</Button>
        <Button size="sm" variant={mode === "gallery" ? "default" : "outline"} onClick={() => setMode("gallery")}><Images /> Gallery</Button>
      </div>
      <div className="tunnel-stage rounded-xl" data-scene-ready={ready ? "" : undefined}>
        {palette && <TunnelScene day={day} span={span} anchor={today} tasks={tasks} media={mode === "gallery" || span === "day" ? visible : []}
          urls={urls.data ?? {}} mode={mode} palette={palette} onTask={setEditing} onMedia={setOpened}
          onDay={d => { setDay(d); setSpan("day"); }} onReady={() => setReady(true)} />}
      </div>
      <p className="text-xs text-muted-foreground">↑/↓ or W/S to travel · click a task to edit · in Year, click a tile to open that day.</p>
      {editing && <TaskEditPopup task={tasks.find(t => t.id === editing.id) ?? editing} onClose={() => setEditing(null)} />}
      <Dialog open={!!opened} onOpenChange={o => !o && setOpened(null)}>
        <DialogContent className="max-w-4xl">
          <DialogTitle>{opened && fileName(opened.path)}</DialogTitle>
          {opened && urls.data?.[opened.path] && (opened.video
            ? <video className="tunnel-media-view" src={urls.data[opened.path]} controls autoPlay playsInline />
            : <img className="tunnel-media-view" src={urls.data[opened.path]} alt={fileName(opened.path)} />)}
        </DialogContent>
      </Dialog>
    </div>
  );
}
