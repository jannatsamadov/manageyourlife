import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Target, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export default function Auth() {
  const { user, loading } = useAuth();
  const [isSignUp, setIsSignUp] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const { signIn, signUp } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (forgotMode) {
      setSubmitting(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setSubmitting(false);
      if (error) {
        toast({ title: "Xəta", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Email göndərildi", description: "Şifrə yeniləmə linki emailinizə göndərildi." });
        setForgotMode(false);
      }
      return;
    }

    if (isSignUp && password !== confirmPassword) {
      toast({ title: "Xəta", description: "Şifrələr uyğun gəlmir.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { error } = isSignUp ? await signUp(email, password) : await signIn(email, password);
    setSubmitting(false);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else if (isSignUp) {
      toast({ title: "Check your email", description: "We sent you a confirmation link." });
    }
  };

  const handleGoogleSignIn = async () => {
    setSubmitting(true);
    try {
      const { error } = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
        extraParams: {
          prompt: "consent",
          access_type: "offline",
        },
      });
      if (error) {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Google sign-in failed", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Target className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Stratify</h1>
          <p className="text-sm text-muted-foreground">Personal Strategic Management</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
            className="w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {!forgotMode && (
            <>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Şifrə"
                required
                minLength={6}
                className="w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {isSignUp && (
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Şifrəni təkrarla"
                  required
                  minLength={6}
                  className="w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              )}
            </>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {forgotMode ? "Şifrəni Sıfırla" : isSignUp ? "Qeydiyyat" : "Giriş"}
          </button>
        </form>

        {!forgotMode && !isSignUp && (
          <p className="text-center">
            <button onClick={() => setForgotMode(true)} className="text-sm text-muted-foreground hover:text-primary hover:underline">
              Şifrəni unutdum?
            </button>
          </p>
        )}

        {forgotMode ? (
          <p className="text-center text-sm text-muted-foreground">
            <button onClick={() => setForgotMode(false)} className="text-primary hover:underline">
              Girişə qayıt
            </button>
          </p>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            {isSignUp ? "Artıq hesabınız var?" : "Hesabınız yoxdur?"}{" "}
            <button onClick={() => setIsSignUp(!isSignUp)} className="text-primary hover:underline">
              {isSignUp ? "Giriş" : "Qeydiyyat"}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
