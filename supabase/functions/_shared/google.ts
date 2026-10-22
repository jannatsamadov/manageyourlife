// Shared by google-oauth and google: service-role client, signed-in user, token encryption, Google calls with refresh.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

export const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
export const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
export const REDIRECT_URI = `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-oauth`;
export const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/tasks",
];
// Where the app may send the user back after Google (open redirects are refused).
export const APP_ORIGINS = ["https://manageyourlife.netlify.app", "http://localhost:8080"];

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// The signed-in app user from the request's JWT.
export async function userFrom(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/, "");
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  return error ? null : data.user;
}

// ── AES-256-GCM for tokens at rest: base64(iv ‖ ciphertext+tag) ──
const keyPromise = crypto.subtle.importKey(
  "raw",
  Uint8Array.from(atob(Deno.env.get("TOKEN_ENCRYPTION_KEY")!), (c) => c.charCodeAt(0)),
  "AES-GCM",
  false,
  ["encrypt", "decrypt"],
);
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export async function encrypt(plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyPromise, new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return b64(out);
}

export async function decrypt(enc: string) {
  const bytes = Uint8Array.from(atob(enc), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await keyPromise, bytes.slice(12));
  return new TextDecoder().decode(plain);
}

export function randomToken(bytes = 32) {
  return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(text: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
export const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

// Google rejected the refresh token (revoked, expired, password change): the user has to connect again.
export class ReconnectNeeded extends Error {}

export async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  const body = await res.json();
  return { ok: res.ok, body };
}

// A valid access token for the user: cached one if it lives > 1 minute more, else refreshed.
async function accessToken(userId: string) {
  const { data: row, error } = await db.from("google_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!row) throw new ReconnectNeeded("Google is not connected");
  if (row.access_token_enc && row.access_token_expires_at && new Date(row.access_token_expires_at).getTime() > Date.now() + 60_000) {
    return decrypt(row.access_token_enc);
  }
  const { ok, body } = await tokenRequest({ grant_type: "refresh_token", refresh_token: await decrypt(row.refresh_token_enc) });
  if (!ok) {
    if (body.error === "invalid_grant") {
      await db.from("google_connections").update({ last_error: "Google access was revoked or expired. Connect again." }).eq("user_id", userId);
      throw new ReconnectNeeded("Google access was revoked or expired. Connect again.");
    }
    throw new Error(`Google token refresh failed: ${body.error_description ?? body.error}`);
  }
  await db.from("google_tokens").update({
    access_token_enc: await encrypt(body.access_token),
    access_token_expires_at: new Date(Date.now() + body.expires_in * 1000).toISOString(),
    ...(body.refresh_token ? { refresh_token_enc: await encrypt(body.refresh_token) } : {}),
  }).eq("user_id", userId);
  return body.access_token as string;
}

export class GoogleError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Google API call as the user; JSON in and out. 204 → null.
export async function google(userId: string, url: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${await accessToken(userId)}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(res.status, body.error?.message ?? `Google API error ${res.status}`);
  return body;
}
