import { useEffect, useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { Loader2, Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

type Details = { client: { name: string }; user: { email: string }; scope: string };

// OAuth 2.1 consent (Supabase Auth OAuth server, P-18): an app such as a claude.ai connector asks for access.
// Supabase Auth sends the user here with ?authorization_id=…; approve / deny returns a URL back to the app.
export default function OAuthConsent() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const id = params.get("authorization_id");
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || !id) return;
    supabase.auth.oauth.getAuthorizationDetails(id).then(({ data, error }) => {
      if (error || !data) return setError(error?.message ?? "Not found");
      // Approved before → straight back to the app.
      if ("redirect_url" in data && data.redirect_url) window.location.href = data.redirect_url;
      else setDetails(data as Details);
    });
  }, [user, id]);

  const decide = async (allow: boolean) => {
    if (!id) return;
    setBusy(true);
    const call = allow ? supabase.auth.oauth.approveAuthorization : supabase.auth.oauth.denyAuthorization;
    const { data, error } = await call.call(supabase.auth.oauth, id, { skipBrowserRedirect: true });
    if (error || !data) {
      setError(error?.message ?? "Failed");
      setBusy(false);
    } else window.location.href = data.redirect_url;
  };

  if (loading) return <Centered><Loader2 className="h-6 w-6 animate-spin text-primary" /></Centered>;
  if (!user) return <Navigate to={`/auth?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;

  return (
    <Centered>
      <div className="glass-card w-full max-w-sm space-y-6 p-6 text-center">
        <Target className="mx-auto h-8 w-8 text-primary" />
        {error || !id ? (
          <p className="text-sm text-destructive">{error ?? "authorization_id missing"}</p>
        ) : !details ? (
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="space-y-1">
              <div className="text-lg font-semibold text-foreground">{details.client.name}</div>
              <div className="text-sm text-muted-foreground">→ ManageYourLife · {details.user.email}</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => decide(false)}
                disabled={busy}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Deny
              </button>
              <button
                onClick={() => decide(true)}
                disabled={busy}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Allow
              </button>
            </div>
          </>
        )}
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-background px-4">{children}</div>;
}
