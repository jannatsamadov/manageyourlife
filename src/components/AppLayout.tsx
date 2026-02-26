import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Target, Calendar, Settings, LogOut, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import ChatPanel from "@/components/ChatPanel";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navItems = [
  { title: "Daily Plan", path: "/", icon: LayoutDashboard },
  { title: "Schedule", path: "/schedule", icon: Calendar },
  { title: "Strategy", path: "/strategy", icon: Target },
  { title: "Notes", path: "/notes", icon: StickyNote },
  { title: "Settings", path: "/settings", icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { signOut } = useAuth();

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen bg-background">
        <aside className="fixed inset-y-0 left-0 z-50 flex w-14 lg:w-64 flex-col border-r border-border bg-sidebar">
          <div className="flex h-16 items-center gap-3 border-b border-border px-3 lg:px-6">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
              <Target className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="hidden lg:block text-lg font-semibold text-foreground">Stratify</span>
          </div>

          <nav className="flex-1 space-y-1 p-2 lg:p-4">
            {navItems.map((item) => (
              <Tooltip key={item.path}>
                <TooltipTrigger asChild>
                  <NavLink
                    to={item.path}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-2.5 lg:px-3 py-2.5 text-sm font-medium transition-colors justify-center lg:justify-start",
                      location.pathname === item.path
                        ? "bg-primary/10 text-primary"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="hidden lg:block">{item.title}</span>
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side="right" className="lg:hidden">
                  {item.title}
                </TooltipContent>
              </Tooltip>
            ))}
          </nav>

          <div className="border-t border-border p-2 lg:p-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={signOut}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 lg:px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors justify-center lg:justify-start"
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  <span className="hidden lg:block">Sign Out</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="lg:hidden">
                Sign Out
              </TooltipContent>
            </Tooltip>
          </div>
        </aside>

        <div className="flex flex-1 flex-col pl-14 lg:pl-64">
          <header className="flex h-16 items-center gap-4 border-b border-border px-6 lg:px-8">
            <h1 className="text-lg font-semibold text-foreground">
              {navItems.find((i) => i.path === location.pathname)?.title || "Stratify"}
            </h1>
          </header>

          <main className="flex-1 overflow-y-auto p-4 lg:p-8">
            {children}
          </main>
        </div>

        <ChatPanel />
      </div>
    </TooltipProvider>
  );
}
