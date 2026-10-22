// Google sign-in for Calendar + Tasks (P-17): authorization-code flow with PKCE, done on the server.
// POST (signed-in app user) → { url } of Google's consent screen.
// GET  (Google redirects here with ?code&state) → tokens stored encrypted → back to the app's Settings.
import {
  APP_ORIGINS, CLIENT_ID, REDIRECT_URI, SCOPES, cors, db, encrypt, hex, json, randomToken, sha256, tokenRequest, userFrom,
} from "../_shared/google.ts";

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function start(req: Request) {
  const user = await userFrom(req);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { return_to } = await req.json().catch(() => ({}));
  let back: URL;
  try {
    back = new URL(return_to);
  } catch {
    return json({ error: "return_to must be a URL" }, 400);
  }
  if (!APP_ORIGINS.includes(back.origin)) return json({ error: "return_to is not an app address" }, 400);

  const state = randomToken();
  const verifier = randomToken(48);
  await db.from("oauth_states").delete().or(`user_id.eq.${user.id},expires_at.lt."${new Date().toISOString()}"`);
  const { error } = await db.from("oauth_states").insert({
    state_hash: hex(await sha256(state)),
    user_id: user.id,
    code_verifier: verifier,
    redirect_to: back.origin + back.pathname,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) throw error;

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: b64url(await sha256(verifier)),
    code_challenge_method: "S256",
    ...(user.email ? { login_hint: user.email } : {}),
  }).toString();
  return json({ url: url.toString() });
}

const backTo = (target: string, params: Record<string, string>) =>
  new Response(null, { status: 302, headers: { Location: `${target}?${new URLSearchParams(params)}` } });

async function callback(req: Request) {
  const q = new URL(req.url).searchParams;
  const state = q.get("state") ?? "";
  const { data: pending } = await db
    .from("oauth_states")
    .delete()
    .eq("state_hash", hex(await sha256(state)))
    .select()
    .maybeSingle();
  const fallback = `${APP_ORIGINS[0]}/settings`;
  if (!pending || new Date(pending.expires_at) < new Date()) return backTo(fallback, { google: "error", reason: "The sign-in took too long. Try again." });
  const target = pending.redirect_to;
  if (q.get("error")) return backTo(target, { google: "error", reason: q.get("error") === "access_denied" ? "Access was not granted." : q.get("error")! });

  const { ok, body } = await tokenRequest({
    grant_type: "authorization_code",
    code: q.get("code") ?? "",
    redirect_uri: REDIRECT_URI,
    code_verifier: pending.code_verifier,
  });
  if (!ok) return backTo(target, { google: "error", reason: body.error_description ?? body.error ?? "Token exchange failed" });
  if (!body.refresh_token) return backTo(target, { google: "error", reason: "Google sent no refresh token. Remove the app at myaccount.google.com/permissions and connect again." });

  // The id_token comes straight from Google's token endpoint over TLS, so reading its payload is enough here.
  const claims = JSON.parse(atob(body.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  const scopes: string[] = String(body.scope ?? "").split(" ").filter(Boolean);

  const { error: connError } = await db.from("google_connections").upsert({
    user_id: pending.user_id,
    google_email: claims.email ?? null,
    scopes,
    last_error: null,
    connected_at: new Date().toISOString(),
  });
  if (connError) throw connError;
  const { error: tokenError } = await db.from("google_tokens").upsert({
    user_id: pending.user_id,
    refresh_token_enc: await encrypt(body.refresh_token),
    access_token_enc: await encrypt(body.access_token),
    access_token_expires_at: new Date(Date.now() + body.expires_in * 1000).toISOString(),
  });
  if (tokenError) throw tokenError;
  return backTo(target, { google: "connected" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    if (req.method === "POST") return await start(req);
    if (req.method === "GET") return await callback(req);
    return new Response("Method not allowed", { status: 405 });
  } catch (e) {
    console.error("google-oauth:", e);
    return req.method === "GET"
      ? backTo(`${APP_ORIGINS[0]}/settings`, { google: "error", reason: "Something went wrong on our side." })
      : json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
