import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, Copy, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Token = Pick<Tables<"api_tokens">, "id" | "name" | "token_prefix" | "scopes" | "created_at" | "last_used_at">;

const MCP_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp`;
const SCOPES = { rw: ["read", "write"], r: ["read"] } as const;

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "never";

function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-2">
      <code className="flex-1 break-all text-xs">{text}</code>
      <button
        aria-label="Copy"
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="text-muted-foreground hover:text-primary"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

// Settings card: personal access tokens for the MCP server / API (P-18). A token is shown once; only its hash is stored.
export default function ApiTokens() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<keyof typeof SCOPES>("rw");
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("api_tokens")
      .select("id, name, token_prefix, scopes, created_at, last_used_at")
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (error) toast({ title: "Failed to load tokens", description: error.message, variant: "destructive" });
    else setTokens(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    const { data, error } = await supabase.rpc("create_api_token", { p_name: name.trim(), p_scopes: [...SCOPES[scope]] });
    setCreating(false);
    if (error || !data) {
      toast({ title: "Could not create the token", description: error?.message, variant: "destructive" });
      return;
    }
    setFresh(data);
    setName("");
    load();
  };

  const revoke = async (t: Token) => {
    const { error } = await supabase.from("api_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", t.id);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else setTokens((prev) => prev.filter((x) => x.id !== t.id));
  };

  return (
    <div className="space-y-4 glass-card p-6">
      <div className="flex items-center gap-3">
        <KeyRound className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">API &amp; MCP</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Tokens let Claude (or any MCP client) read and change your tasks, notes and Inbox. Treat a token like a password.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="Token name, e.g. Claude Code laptop"
          maxLength={100}
          className="flex-1 min-w-[12rem] rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <Select value={scope} onValueChange={(v) => setScope(v as keyof typeof SCOPES)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rw">Read &amp; write</SelectItem>
            <SelectItem value="r">Read only</SelectItem>
          </SelectContent>
        </Select>
        <button
          onClick={create}
          disabled={creating || !name.trim()}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {creating && <Loader2 className="h-4 w-4 animate-spin" />}
          Create token
        </button>
      </div>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : tokens.length > 0 && (
        <div className="space-y-2">
          {tokens.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border bg-card/40 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{t.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {t.token_prefix}… · {t.scopes.includes("write") ? "read & write" : "read only"} · created {day(t.created_at)} · last used {day(t.last_used_at)}
                </div>
              </div>
              <button
                onClick={() => revoke(t)}
                className="rounded border border-destructive/30 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">MCP server URL</div>
        <CopyBox text={MCP_URL} />
      </div>

      <Dialog open={!!fresh} onOpenChange={(open) => !open && setFresh(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Your new token</DialogTitle>
            <DialogDescription>Copy it now — it is shown only once. Lost it? Revoke it and create a new one.</DialogDescription>
          </DialogHeader>
          {fresh && (
            <div className="space-y-3">
              <CopyBox text={fresh} />
              <div className="text-xs text-muted-foreground">Connect Claude Code (run in a terminal):</div>
              <CopyBox text={`claude mcp add --transport http --scope user manageyourlife ${MCP_URL} --header "Authorization: Bearer ${fresh}"`} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
