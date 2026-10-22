import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";

const BOT = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string;
const WAIT_MS = 15 * 60 * 1000; // link code lifetime

// Settings card: link a Telegram chat to the account; the bot then drops every message into the Inbox (P-19).
export default function TelegramConnect() {
  const { user } = useAuth();
  const [link, setLink] = useState<{ chat_id: number; username: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval>>();

  const load = useCallback(async () => {
    const { data } = await supabase.from("telegram_links").select("chat_id, username").maybeSingle();
    setLink(data);
    setLoading(false);
    return data;
  }, []);

  useEffect(() => {
    load();
    return () => clearInterval(poll.current);
  }, [load]);

  const connect = async () => {
    // Opened right away so the browser does not block it as a pop-up.
    const tab = window.open("about:blank", "_blank");
    const { data: code, error } = await supabase.rpc("create_telegram_link_code");
    if (error || !code) {
      tab?.close();
      toast({ title: "Could not start", description: error?.message, variant: "destructive" });
      return;
    }
    const url = `https://t.me/${BOT}?start=${code}`;
    if (tab) tab.location.href = url;
    else window.location.href = url;

    setWaiting(true);
    const started = Date.now();
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      const linked = await load();
      if (linked || Date.now() - started > WAIT_MS) {
        clearInterval(poll.current);
        setWaiting(false);
        if (linked) toast({ title: "Telegram connected", description: `Messages to @${BOT} now land in your Inbox.` });
      }
    }, 3000);
  };

  const disconnect = async () => {
    if (!user) return;
    const { error } = await supabase.from("telegram_links").delete().eq("user_id", user.id);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else setLink(null);
  };

  return (
    <div className="space-y-4 glass-card p-6">
      <div className="flex items-center gap-3">
        <Send className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Telegram</h3>
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="flex items-center gap-3">
            <div className={`h-2.5 w-2.5 rounded-full ${link ? "bg-green-500" : "bg-muted-foreground/40"}`} />
            <span className="text-sm">
              {link ? `Connected${link.username ? ` as @${link.username}` : ""} — send anything to @${BOT}` : "Not connected"}
            </span>
          </div>
          {link ? (
            <button
              onClick={disconnect}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-destructive hover:border-destructive/40"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={waiting}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {waiting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {waiting ? "Waiting for Telegram… press Start there" : "Connect Telegram"}
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            Text, links, forwards and files you send to the bot land in the Inbox as they are — nothing is sorted or read by AI.
          </p>
        </>
      )}
    </div>
  );
}
