// Notes (P-57): one notes system — the Markdown files of the vault (the same files Obsidian edits on the laptop),
// as a list or a gallery. Loaded on demand.
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

const VaultView = lazy(() => import("@/components/vault/VaultView"));

export default function Notes() {
  return (
    <div className="mx-auto max-w-6xl animate-fade-in">
      <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
        <VaultView />
      </Suspense>
    </div>
  );
}
