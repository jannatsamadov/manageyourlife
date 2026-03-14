import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { DollarSign, Heart, Bird, Crown, Edit3, Check, X } from "lucide-react";

interface Attribute {
  attribute: string;
  value: number;
  max_value: number;
}

const ATTRIBUTE_CONFIG = [
  { key: "wealth", label: "Wealth", icon: DollarSign, color: "38 92% 50%", gradient: "from-yellow-500/80 to-amber-400/80" },
  { key: "health", label: "Health", icon: Heart, color: "0 72% 51%", gradient: "from-red-500/80 to-rose-400/80" },
  { key: "freedom", label: "Freedom", icon: Bird, color: "217 91% 60%", gradient: "from-blue-500/80 to-cyan-400/80" },
  { key: "status", label: "Social Status", icon: Crown, color: "280 70% 55%", gradient: "from-purple-500/80 to-violet-400/80" },
];

export default function AttributeBars() {
  const { user } = useAuth();
  const [attrs, setAttrs] = useState<Attribute[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const fetchAttrs = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("user_attributes")
      .select("attribute, value, max_value")
      .eq("user_id", user.id);
    
    // Merge with defaults
    const merged = ATTRIBUTE_CONFIG.map(c => {
      const found = data?.find(d => d.attribute === c.key);
      return { attribute: c.key, value: Number(found?.value ?? 0), max_value: Number(found?.max_value ?? 100) };
    });
    setAttrs(merged);
  }, [user]);

  useEffect(() => { fetchAttrs(); }, [fetchAttrs]);

  const saveValue = async (key: string) => {
    if (!user) return;
    const numVal = parseFloat(editValue);
    if (isNaN(numVal)) { setEditing(null); return; }
    
    await supabase.from("user_attributes").upsert(
      { user_id: user.id, attribute: key, value: numVal, updated_at: new Date().toISOString() } as any,
      { onConflict: "user_id,attribute" }
    );
    setEditing(null);
    fetchAttrs();
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {ATTRIBUTE_CONFIG.map((config) => {
        const attr = attrs.find(a => a.attribute === config.key);
        const pct = attr ? Math.min(100, (attr.value / attr.max_value) * 100) : 0;
        const Icon = config.icon;
        const isEditing = editing === config.key;

        return (
          <div key={config.key} className="glass-card p-4 border-border/30 relative overflow-hidden group">
            {/* Glow effect */}
            <div
              className="absolute inset-0 opacity-10 pointer-events-none"
              style={{ background: `radial-gradient(ellipse at bottom, hsl(${config.color} / 0.3), transparent 70%)` }}
            />
            
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" style={{ color: `hsl(${config.color})` }} />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{config.label}</span>
                </div>
                <button
                  onClick={() => { setEditing(config.key); setEditValue(String(attr?.value ?? 0)); }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                >
                  <Edit3 className="h-3 w-3" />
                </button>
              </div>

              {isEditing ? (
                <div className="flex items-center gap-1 mb-2">
                  <input
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && saveValue(config.key)}
                    className="w-16 rounded border border-border bg-background px-2 py-0.5 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    autoFocus
                  />
                  <button onClick={() => saveValue(config.key)} className="text-primary"><Check className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setEditing(null)} className="text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
                </div>
              ) : (
                <div className="text-xl font-mono font-bold text-foreground mb-2" style={{ textShadow: `0 0 15px hsl(${config.color} / 0.3)` }}>
                  {attr?.value ?? 0}
                  <span className="text-xs text-muted-foreground font-normal">/{attr?.max_value ?? 100}</span>
                </div>
              )}

              {/* HP bar */}
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, hsl(${config.color} / 0.6), hsl(${config.color}))`,
                    boxShadow: `0 0 8px hsl(${config.color} / 0.4)`,
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
