import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AppProvider } from "@/context/AppContext";
import AppLayout from "@/components/AppLayout";

import SchedulePlanning from "@/pages/SchedulePlanning";
import SettingsPage from "@/pages/Settings";
import Notes from "@/pages/Notes";
import Tasks from "@/pages/Tasks";
import Trash from "@/pages/Trash";
import Auth from "@/pages/Auth";
import ResetPassword from "@/pages/ResetPassword";
import Privacy from "@/pages/Privacy";
import OAuthConsent from "@/pages/OAuthConsent";
import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";

// three.js is big: the Strategy page loads only when opened.
const Strategy = lazy(() => import("@/pages/Strategy"));

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

const AppRoutes = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/oauth/consent" element={<OAuthConsent />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AppProvider>
              <AppLayout>
                <Routes>
                  <Route path="/" element={<SchedulePlanning />} />
                  
                  <Route path="/schedule" element={<Navigate to="/" replace />} />
                  {/* The Inbox is the Inbox folder of the notes now (P-49, P-57). */}
                  <Route path="/inbox" element={<Navigate to="/notes?folder=Inbox" replace />} />
                  <Route
                    path="/strategy"
                    element={
                      <Suspense fallback={<div className="flex h-[80vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}>
                        <Strategy />
                      </Suspense>
                    }
                  />
                  <Route path="/tasks" element={<Tasks />} />
                  <Route path="/notes" element={<Notes />} />
                  <Route path="/trash" element={<Trash />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </AppLayout>
            </AppProvider>
          </ProtectedRoute>
        }
      />
    </Routes>
  </BrowserRouter>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
