// Making or changing a custom field (GitHub Projects' "+ New field"): name, kind, and the options of a select.
// The kind is fixed once made (values of another kind would not fit); options keep their id when renamed.
import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CUSTOM_KINDS, type CustomField, type CustomKind, type FieldOption } from "./query";
import { OPTION_COLORS, OptionDot, Tip } from "./fields";
import type { FieldActions } from "./useFields";

const optionId = () => Math.random().toString(36).slice(2, 8);

export function FieldEditor({ field, open, onClose, actions, onMade }: {
  field: CustomField | null; open: boolean; onClose: () => void; actions: FieldActions; onMade?: (f: CustomField) => void;
}) {
  const [name, setName] = useState(field?.name ?? "");
  const [kind, setKind] = useState<CustomKind>(field?.kind ?? "select");
  const [options, setOptions] = useState<FieldOption[]>(field?.options ?? []);
  const [next, setNext] = useState("");
  const [sure, setSure] = useState(false);

  const addOption = () => {
    const n = next.trim();
    if (!n) return;
    setOptions((o) => [...o, { id: optionId(), name: n, color: OPTION_COLORS[(o.length + 3) % OPTION_COLORS.length] }]);
    setNext("");
  };
  const submit = async () => {
    const all = next.trim() ? [...options, { id: optionId(), name: next.trim(), color: OPTION_COLORS[(options.length + 3) % OPTION_COLORS.length] }] : options;
    const clean = all.filter((o) => o.name.trim());
    if (!name.trim()) return;
    if (field) await actions.save(field.id, { name: name.trim(), options: clean });
    else {
      const made = await actions.add({ name: name.trim(), kind, options: kind === "select" ? clean : [] });
      if (made) onMade?.(made);
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{field ? "Edit field" : "New field"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <input
            autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={80}
            onKeyDown={(e) => { if (e.key === "Enter" && kind !== "select") submit(); }}
            className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm outline-none focus:border-primary/50"
          />
          {!field && (
            <div className="flex flex-wrap gap-1">
              {CUSTOM_KINDS.map((k) => (
                <button key={k.id} type="button" onClick={() => setKind(k.id)}
                  className={cn("rounded-md border px-2.5 py-1 text-xs", kind === k.id ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                  {k.label}
                </button>
              ))}
            </div>
          )}
          {(field?.kind ?? kind) === "select" && (
            <div className="space-y-1">
              {options.map((o, k) => (
                <div key={o.id} className="flex items-center gap-2">
                  <Tip label="Colour">
                    <button type="button" className="p-1"
                      onClick={() => setOptions((all) => all.map((x, j) => (j === k ? { ...x, color: OPTION_COLORS[(OPTION_COLORS.indexOf((x.color ?? "gray") as never) + 1) % OPTION_COLORS.length] } : x)))}>
                      <OptionDot color={o.color} className="h-3 w-3" />
                    </button>
                  </Tip>
                  <input value={o.name} onChange={(e) => setOptions((all) => all.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)))}
                    className="h-8 flex-1 rounded-md border border-border bg-transparent px-2 text-sm outline-none focus:border-primary/50" />
                  <button type="button" onClick={() => setOptions((all) => all.filter((_, j) => j !== k))} className="p-1 text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Plus className="mx-1 h-3.5 w-3.5 text-muted-foreground" />
                <input value={next} onChange={(e) => setNext(e.target.value)} placeholder="Option, Enter"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOption(); } }}
                  className="h-8 flex-1 rounded-md border border-dashed border-border bg-transparent px-2 text-sm outline-none focus:border-primary/50" />
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            {field && (
              <button type="button"
                onClick={async () => { if (!sure) { setSure(true); return; } await actions.remove(field.id); onClose(); }}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs", sure ? "bg-destructive text-destructive-foreground" : "text-destructive hover:bg-destructive/10")}>
                <Trash2 className="h-3.5 w-3.5" />{sure ? "Sure?" : "Delete"}
              </button>
            )}
            <button type="button" onClick={submit} disabled={!name.trim()}
              className="ml-auto inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {field ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
