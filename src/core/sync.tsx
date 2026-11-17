// Mounted once inside the signed-in app: Realtime for the items, and the Google Tasks pull — Google Tasks has no
// push, so the app asks when it opens and when its tab comes back after a while (new ones, and what changed there).
import { useEffect } from "react";
import { googleAction, isGoogleConnected } from "@/lib/gcal";
import { useItemActions, useItemsRealtime, useWorkspace } from "./items";

let lastPull = 0;

export function CoreSync() {
  useItemsRealtime();
  const { data: ws } = useWorkspace();
  const { refresh } = useItemActions();

  useEffect(() => {
    if (!ws) return;
    const pull = async () => {
      if (Date.now() - lastPull < 5 * 60_000 || !(await isGoogleConnected())) return;
      lastPull = Date.now();
      const r = await googleAction.importTasks().catch(() => null);
      if (r && (r.added || r.changed)) refresh();
    };
    const onVisible = () => document.visibilityState === "visible" && pull();
    pull();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ws, refresh]);

  return null;
}
