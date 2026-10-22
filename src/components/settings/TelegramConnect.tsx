import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2, Copy, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const BOT = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string;
const WAIT_MS = 15 * 60 * 1000; // link code lifetime

// Settings card: link a Telegram chat; the bot drops every message into the Inbox (P-19).
export default function TelegramConnect() {
  const { user } = useAuth();
  const [link, setLink] = useState<{ chat_id: number; username: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
    const { data, error } = await supabase.rpc("create_telegram_link_code");
    if (error || !data) {
      tab?.close();
      toast({ title: "Failed", description: error?.message, variant: "destructive" });
      return;
    }
    const url = `https://t.me/${BOT}?start=${data}`;
    if (tab) tab.location.href = url;
    else window.open(url, "_blank");

    setCode(data);
    const started = Date.now();
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      const linked = await load();
      if (linked || Date.now() - started > WAIT_MS) {
        clearInterval(poll.current);
        setCode(null);
        if (linked) toast({ title: "Telegram connected" });
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
        {!loading && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className={`h-2.5 w-2.5 rounded-full ${link ? "bg-green-500" : "bg-muted-foreground/40"}`} />
            {link ? `@${link.username ?? BOT}` : ""}
          </span>
        )}
      </div>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : link ? (
        <button onClick={disconnect} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:border-destructive/40 hover:text-destructive">
          Disconnect
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={connect}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {code ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Connect
          </button>
          {code && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(code);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 font-mono text-xs text-muted-foreground hover:text-primary"
                >
                  {code}
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>Not connected after Start? Send this code to @{BOT}</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
