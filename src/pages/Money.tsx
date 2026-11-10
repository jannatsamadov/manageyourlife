// Money (P-67, owner 2026-10-26: "make a money section — what I have, debts, recurring payments, income"): the balance,
// the month's in / out / left, income and bills (ticked per month), debts and loans with their instalments, things to
// buy and what was spent (2026-11-10). Notes show as tooltips on the name ("description gözə girir").
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Circle, CircleCheck, Loader2, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  type Draft, type Kind, type Money as Data, type MoneyItem, activeIn, addMonths, azn, boughtOf, buy, deleteItem, loadMoney,
  monthLabel, monthOf, monthly, parsePlan, pay, paymentFor, paymentsOf, remaining, repeats, saveItem, setBalance, setPlan,
  toggleMonth, totals, unbuy,
} from "@/lib/money";

const SECTIONS: { kind: Kind; title: string; done: string }[] = [
  { kind: "income", title: "Income", done: "Received" },
  { kind: "bill", title: "Bills", done: "Paid" },
  { kind: "debt", title: "I owe", done: "Paid back" },
  { kind: "loan", title: "Owed to me", done: "Got back" },
];

function Icon({ label, onClick, disabled, children, className }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} disabled={disabled}
          className={cn("rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50", className)}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const field = "rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

// The item's name; its note is a tooltip (a dotted underline says there is one).
function Name({ item, struck }: { item: MoneyItem; struck?: boolean }) {
  const name = (
    <span className={cn("text-sm text-foreground", struck && "line-through", item.note && "underline decoration-muted-foreground/50 decoration-dotted underline-offset-4")}>
      {item.name}
    </span>
  );
  if (!item.note) return name;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{name}</TooltipTrigger>
      <TooltipContent className="max-w-xs whitespace-pre-wrap">{item.note}</TooltipContent>
    </Tooltip>
  );
}

function Stat({ label, value, hint, tone, onClick }: { label: string; value: string; hint?: string; tone?: "good" | "bad"; onClick?: () => void }) {
  const body = (
    <div onClick={onClick} className={cn("rounded-xl border border-border bg-card px-3 py-2", onClick && "cursor-pointer hover:border-primary/40")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums text-foreground", tone === "good" && "text-primary", tone === "bad" && "text-destructive")}>{value}</div>
    </div>
  );
  if (!hint) return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

// New or edited item; a debt / loan can get instalments ("200 200 200 300" from a month on). A 'buy' item: price
// (may stay empty) — or, when `spend` / already bought, what it cost in that month.
function ItemForm({ kind, item, data, month, spend, onDone }: { kind: Kind; item: MoneyItem | null; data: Data; month: string; spend?: boolean; onDone: (changed: boolean) => void }) {
  const planned = item ? paymentsOf(item, data.payments).filter((p) => p.month && !p.paid_at) : [];
  const bought = kind === "buy" && item ? boughtOf(item, data.payments) : undefined;
  const spent = spend || !!bought;
  const [name, setName] = useState(item?.name ?? "");
  const [amount, setAmount] = useState(bought ? String(bought.amount) : item?.amount ? String(item.amount) : "");
  const [period, setPeriod] = useState(item?.period ?? "month");
  const [from, setFrom] = useState(item?.starts_on ?? "");
  const [note, setNote] = useState(item?.note ?? "");
  const [plan, setPlanText] = useState(planned.map((p) => p.amount).join(" "));
  const [first, setFirst] = useState((planned[0]?.month ?? month).slice(0, 7));
  const [busy, setBusy] = useState(false);
  const amounts = parsePlan(plan);
  const total = Number(amount) || amounts.reduce((s, n) => s + n, 0);

  const save = async () => {
    if (!name.trim() || !(total > 0 || (kind === "buy" && !spent && !amount.trim()))) return;
    setBusy(true);
    try {
      const d: Draft = { name, amount: total, period, starts_on: from || null, note };
      const position = data.items.filter((i) => i.kind === kind).length;
      const id = await saveItem(kind, d, item?.id ?? null, position);
      if (kind === "buy") {
        if (spent) await buy(item ?? ({ id } as MoneyItem), bought?.month ?? month, total, data.payments);
      } else if (!repeats(kind) && (amounts.length || planned.length)) await setPlan(id, `${first}-01`, amounts, data.payments);
      onDone(true);
    } catch (e) {
      toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" });
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!item || !window.confirm(`Delete "${item.name}"?`)) return;
    try {
      await deleteItem(item.id);
      onDone(true);
    } catch (e) {
      toast({ title: "Not deleted", description: (e as Error).message, variant: "destructive" });
    }
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") onDone(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-background/60 p-2" onKeyDown={keys}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={cn(field, "min-w-[8rem] flex-1")} />
      <input value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} inputMode="decimal"
        placeholder={kind === "buy" ? (spent ? "Amount" : "Price") : repeats(kind) ? "Amount" : amounts.length ? String(total) : "Total"} className={cn(field, "w-24 tabular-nums")} />
      {kind === "buy" ? null : repeats(kind) ? (
        <>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className={field}>
            <option value="month">a month</option>
            <option value="week">a week</option>
            <option value="year">a year</option>
          </select>
          <Tooltip>
            <TooltipTrigger asChild>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={cn(field, "w-36")} />
            </TooltipTrigger>
            <TooltipContent>From (empty: already)</TooltipContent>
          </Tooltip>
        </>
      ) : (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <input value={plan} onChange={(e) => setPlanText(e.target.value)} placeholder="Plan: 200 200 300" className={cn(field, "w-40 tabular-nums")} />
            </TooltipTrigger>
            <TooltipContent>Instalments, one a month</TooltipContent>
          </Tooltip>
          {amounts.length > 0 && <input type="month" value={first} onChange={(e) => e.target.value && setFirst(e.target.value)} className={cn(field, "w-36")} />}
        </>
      )}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" className={cn(field, "min-w-[6rem] flex-1")} />
      <div className="flex items-center">
        <Icon label="Save" onClick={save} disabled={busy}><Check className="h-4 w-4" /></Icon>
        <Icon label="Cancel" onClick={() => onDone(false)}><X className="h-4 w-4" /></Icon>
        {item && <Icon label="Delete" onClick={remove} className="hover:text-destructive"><Trash2 className="h-4 w-4" /></Icon>}
      </div>
    </div>
  );
}

export default function Money() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = useMemo(() => ["money", user?.id], [user?.id]);
  const money = useQuery({ queryKey: key, enabled: !!user, queryFn: loadMoney });
  const [month, setMonth] = useState(monthOf());
  const [editing, setEditing] = useState<{ kind: Kind; id: string | null } | null>(null);
  const [balanceDraft, setBalanceDraft] = useState<string | null>(null);
  const [paying, setPaying] = useState<{ id: string; amount: string } | null>(null);
  const [buying, setBuying] = useState<{ id: string; amount: string } | null>(null);
  const [spending, setSpending] = useState(false);
  const reload = () => qc.invalidateQueries({ queryKey: key });
  const run = async (f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (e) {
      toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" });
    }
    reload();
  };

  if (money.isLoading || !money.data) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  const data = money.data;
  const t = totals(data, month);
  const now = new Date();
  const today = `${monthOf(now).slice(0, 8)}${String(now.getDate()).padStart(2, "0")}`;

  const saveBalance = () => {
    const n = Number((balanceDraft ?? "").replace(",", "."));
    setBalanceDraft(null);
    if (balanceDraft?.trim() && Number.isFinite(n)) run(() => setBalance(n));
  };
  const payBack = () => {
    const n = Number((paying?.amount ?? "").replace(",", "."));
    const id = paying?.id;
    setPaying(null);
    if (id && n > 0) run(() => pay(id, n));
  };
  const bought = () => {
    const n = Number((buying?.amount ?? "").replace(",", "."));
    const item = data.items.find((i) => i.id === buying?.id);
    setBuying(null);
    if (item && n > 0) run(() => buy(item, month, n, data.payments));
  };
  const toBuy = data.items.filter((i) => i.kind === "buy" && !boughtOf(i, data.payments));
  const spent = data.items.filter((i) => i.kind === "buy" && boughtOf(i, data.payments)?.month === month);
  const closeForm = (c: boolean) => { setEditing(null); setSpending(false); if (c) reload(); };

  return (
    <div className="mx-auto max-w-4xl animate-fade-in">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-1 text-xl font-bold text-foreground">Money</h1>
        <div className="ml-auto flex items-center gap-1">
          <Icon label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft className="h-4 w-4" /></Icon>
          <button type="button" onClick={() => setMonth(monthOf())} className="min-w-[8.5rem] text-center text-sm font-medium text-foreground">{monthLabel(month)}</button>
          <Icon label="Next month" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight className="h-4 w-4" /></Icon>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {balanceDraft !== null ? (
          <div className="rounded-xl border border-primary/40 bg-card px-3 py-2">
            <div className="text-xs text-muted-foreground">Balance</div>
            <input autoFocus value={balanceDraft} inputMode="decimal" onChange={(e) => setBalanceDraft(e.target.value)} onBlur={saveBalance}
              onKeyDown={(e) => { if (e.key === "Enter") saveBalance(); if (e.key === "Escape") setBalanceDraft(null); }}
              className="w-full bg-transparent text-lg font-semibold tabular-nums text-foreground focus:outline-none" />
          </div>
        ) : (
          <Stat label="Balance" value={data.balance ? azn(data.balance.amount) : "—"} onClick={() => setBalanceDraft(data.balance ? String(data.balance.amount) : "")}
            hint={data.balance ? `Updated ${new Date(data.balance.noted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "Set"} />
        )}
        <Stat label="In" value={azn(t.in)} hint="Income + money coming back this month" />
        <Stat label="Out" value={azn(t.out)} hint="Bills + instalments + spent this month" />
        <Stat label="Left" value={azn(t.left)} tone={t.left < 0 ? "bad" : "good"} hint="In − Out" />
        <Stat label="I owe" value={azn(t.owe)} tone={t.owe > 0 ? "bad" : undefined} />
        <Stat label="Owed to me" value={azn(t.owed)} />
      </div>

      <div className="space-y-3">
        {SECTIONS.map(({ kind, title, done }) => {
          const items = data.items.filter((i) => i.kind === kind);
          const open = repeats(kind) ? items : [...items].sort((a, b) => Number(remaining(a, data.payments) === 0) - Number(remaining(b, data.payments) === 0));
          const total = repeats(kind) ? items.filter((i) => activeIn(i, month)).reduce((s, i) => s + monthly(i), 0) : items.reduce((s, i) => s + remaining(i, data.payments), 0);
          return (
            <div key={kind} className="rounded-xl border border-border bg-card">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-sm font-medium text-foreground">{title}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{azn(total)}</span>
                <Icon label="Add" onClick={() => setEditing({ kind, id: null })} className="ml-auto"><Plus className="h-4 w-4" /></Icon>
              </div>
              <ul className="space-y-0.5 border-t border-border px-2 py-2">
                {editing?.kind === kind && editing.id === null && (
                  <li><ItemForm kind={kind} item={null} data={data} month={month} onDone={(c) => { setEditing(null); if (c) reload(); }} /></li>
                )}
                {open.map((i) => {
                  if (editing?.id === i.id) {
                    return <li key={i.id}><ItemForm kind={kind} item={i} data={data} month={month} onDone={(c) => { setEditing(null); if (c) reload(); }} /></li>;
                  }
                  const mine = paymentsOf(i, data.payments);
                  const left = remaining(i, data.payments);
                  const ticked = !!paymentFor(i, month, data.payments);
                  const when = i.period === "year" ? month.slice(0, 4) : monthLabel(month, true);
                  const active = activeIn(i, month);
                  const settled = !repeats(kind) && left === 0;
                  return (
                    <li key={i.id} onClick={() => setEditing({ kind, id: i.id })}
                      className={cn("group flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5 hover:bg-muted/40", (!active || settled) && "opacity-50")}>
                      {repeats(kind) && (
                        <Icon label={ticked ? `${done} in ${when}` : `Mark ${done.toLowerCase()}`} onClick={() => run(() => toggleMonth(i, month, data.payments))} disabled={!active}
                          className="-my-1 p-1">
                          {ticked ? <CircleCheck className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4" />}
                        </Icon>
                      )}
                      <Name item={i} struck={settled} />
                      {i.starts_on && i.starts_on > today && (
                        <span className="text-xs text-muted-foreground">from {new Date(`${i.starts_on}T00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                      )}
                      <span className="ml-auto flex items-center gap-2">
                        {!repeats(kind) && mine.filter((p) => p.month).map((p) => (
                          <Tooltip key={p.id}>
                            <TooltipTrigger asChild>
                              <button type="button" onClick={(e) => { e.stopPropagation(); run(() => toggleMonth(i, p.month!, data.payments)); }}
                                className={cn("rounded-full border px-2 py-0.5 text-[11px] tabular-nums transition-colors",
                                  p.paid_at ? "border-primary/40 bg-primary/10 text-primary" : p.month === month ? "border-foreground/40 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
                                {monthLabel(p.month!, true)} {azn(p.amount)}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{p.paid_at ? done : `Mark ${done.toLowerCase()}`}</TooltipContent>
                          </Tooltip>
                        ))}
                        <span className="text-sm tabular-nums text-foreground">
                          {repeats(kind)
                            ? <>{azn(i.amount)}<span className="text-xs text-muted-foreground">{i.period === "month" ? " /mo" : ` /${i.period === "week" ? "wk" : "yr"} ≈ ${azn(monthly(i))} /mo`}</span></>
                            : left === i.amount ? azn(i.amount) : <>{azn(left)}<span className="text-xs text-muted-foreground"> / {azn(i.amount)}</span></>}
                        </span>
                        {!repeats(kind) && !settled && (paying?.id === i.id ? (
                          <input autoFocus value={paying.amount} inputMode="decimal" onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setPaying({ id: i.id, amount: e.target.value })} onBlur={() => setPaying(null)}
                            onKeyDown={(e) => { if (e.key === "Enter") payBack(); if (e.key === "Escape") setPaying(null); }}
                            className={cn(field, "w-20 py-0.5 tabular-nums")} />
                        ) : (
                          <Icon label={done} onClick={() => setPaying({ id: i.id, amount: String(left) })} className="-my-1 p-1"><Check className="h-4 w-4" /></Icon>
                        ))}
                      </span>
                    </li>
                  );
                })}
                {!open.length && editing?.kind !== kind && <li className="px-2 py-1 text-xs text-muted-foreground">—</li>}
              </ul>
            </div>
          );
        })}

        {/* To buy: every month until bought. Spent: what was bought this month (also one-off expenses). */}
        {([
          { title: "To buy", items: toBuy, total: toBuy.reduce((s, i) => s + i.amount, 0), add: () => { setSpending(false); setEditing({ kind: "buy", id: null }); } },
          { title: "Spent", items: spent, total: spent.reduce((s, i) => s + (boughtOf(i, data.payments)?.amount ?? 0), 0), add: () => { setEditing(null); setSpending(true); } },
        ] as const).map(({ title, items, total, add }) => {
          const isSpent = title === "Spent";
          const adding = isSpent ? spending : editing?.kind === "buy" && editing.id === null;
          return (
            <div key={title} className="rounded-xl border border-border bg-card">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-sm font-medium text-foreground">{title}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{azn(total)}</span>
                <Icon label={isSpent ? "Add an expense" : "Add"} onClick={add} className="ml-auto"><Plus className="h-4 w-4" /></Icon>
              </div>
              <ul className="space-y-0.5 border-t border-border px-2 py-2">
                {adding && <li><ItemForm kind="buy" item={null} data={data} month={month} spend={isSpent} onDone={closeForm} /></li>}
                {items.map((i) => {
                  if (editing?.id === i.id) return <li key={i.id}><ItemForm kind="buy" item={i} data={data} month={month} onDone={closeForm} /></li>;
                  const paid = boughtOf(i, data.payments);
                  return (
                    <li key={i.id} onClick={() => { setSpending(false); setEditing({ kind: "buy", id: i.id }); }}
                      className="group flex cursor-pointer items-center gap-x-3 rounded-md px-2 py-1.5 hover:bg-muted/40">
                      {isSpent ? (
                        <Icon label="Not bought" onClick={() => run(() => unbuy(i, data.payments))} className="-my-1 p-1">
                          <CircleCheck className="h-4 w-4 text-primary" />
                        </Icon>
                      ) : (
                        <Icon label={`Bought in ${monthLabel(month, true)}`} onClick={() => setBuying({ id: i.id, amount: i.amount ? String(i.amount) : "" })} className="-my-1 p-1">
                          <Circle className="h-4 w-4" />
                        </Icon>
                      )}
                      <Name item={i} />
                      <span className="ml-auto flex items-center gap-2">
                        {buying?.id === i.id ? (
                          <input autoFocus value={buying.amount} inputMode="decimal" placeholder="Cost" onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setBuying({ id: i.id, amount: e.target.value })} onBlur={() => setBuying(null)}
                            onKeyDown={(e) => { if (e.key === "Enter") bought(); if (e.key === "Escape") setBuying(null); }}
                            className={cn(field, "w-20 py-0.5 tabular-nums")} />
                        ) : (
                          <span className="text-sm tabular-nums text-foreground">{paid ? azn(paid.amount) : i.amount ? azn(i.amount) : "—"}</span>
                        )}
                      </span>
                    </li>
                  );
                })}
                {!items.length && !adding && <li className="px-2 py-1 text-xs text-muted-foreground">—</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
