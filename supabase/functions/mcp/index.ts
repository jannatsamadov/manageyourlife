// Remote MCP server (P-18): Streamable HTTP transport, stateless, plain JSON responses (no SSE stream).
// Auth: a personal access token from Settings → API & MCP, sent as "Authorization: Bearer myl_…".
// Read tools need the "read" scope, write tools "write"; every write is logged in api_audit_log.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { TOOLS, ToolError } from "./tools.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", ...headers } });

type Auth = { id: string; user_id: string; scopes: string[] };

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authenticate(req: Request): Promise<Auth | null> {
  const token = req.headers.get("Authorization")?.match(/^Bearer\s+(myl_[0-9a-f]{64})$/)?.[1];
  if (!token) return null;
  const { data } = await db
    .from("api_tokens")
    .select("id, user_id, scopes, expires_at, revoked_at")
    .eq("token_hash", await sha256Hex(token))
    .maybeSingle();
  if (!data || data.revoked_at || (data.expires_at && new Date(data.expires_at) <= new Date())) return null;
  await db.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return data;
}

const allowed = (auth: Auth) => TOOLS.filter((t) => auth.scopes.includes(t.scope));

async function callTool(auth: Auth, name: string, args: unknown) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  if (!auth.scopes.includes(tool.scope)) {
    return { content: [{ type: "text", text: `This token cannot ${tool.scope}. Create a read & write token in Settings → API & MCP.` }], isError: true };
  }
  const input = args && typeof args === "object" ? args : {};
  try {
    const out = await tool.run(input, { db, userId: auth.user_id });
    if (tool.scope === "write") await log(auth, tool.name, (out as any).id ?? (input as any).id, true);
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  } catch (e) {
    const message = e instanceof ToolError ? e.message : `Server error: ${(e as any)?.message ?? e}`;
    if (!(e instanceof ToolError)) console.error(`mcp ${tool.name}:`, e);
    if (tool.scope === "write") await log(auth, tool.name, (input as any).id, false, message);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

async function log(auth: Auth, action: string, targetId: unknown, ok: boolean, error?: string) {
  const target = typeof targetId === "string" && /^[0-9a-f-]{36}$/i.test(targetId) ? targetId : null;
  const { error: logError } = await db.from("api_audit_log").insert({ user_id: auth.user_id, token_id: auth.id, action, target_id: target, ok, error: error ?? null });
  if (logError) console.error("audit log:", logError);
}

// One JSON-RPC message → its reply (null for notifications).
async function handle(msg: any, auth: Auth) {
  const id = msg?.id;
  if (id === undefined || id === null) return null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (msg.method) {
    case "initialize": {
      const asked = msg.params?.protocolVersion;
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "manageyourlife", title: "ManageYourLife", version: "1.0.0" },
        instructions:
          "Tasks, notes and the Inbox of the user's ManageYourLife account. Dates are YYYY-MM-DD in the user's local time " +
          "(pass the local date to `today`). Notes are Markdown. Inbox items are raw captures the user sorts later.",
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: allowed(auth).map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations: { title, ...annotations } })),
      });
    case "tools/call": {
      const result = await callTool(auth, msg.params?.name, msg.params?.arguments);
      return result ? ok(result) : fail(-32602, `Unknown tool: ${msg.params?.name}`);
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { ...cors, Allow: "POST" } });

  const auth = await authenticate(req);
  if (!auth) {
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Missing, wrong or revoked API token. Create one in ManageYourLife → Settings → API & MCP." } },
      401,
      { "WWW-Authenticate": 'Bearer realm="manageyourlife"' },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  const batch = Array.isArray(body);
  const replies = (await Promise.all((batch ? body : [body]).map((m: any) => handle(m, auth)))).filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202, headers: cors });
  return json(batch ? replies : replies[0]);
});
