// Money (P-67): the user's balance, income, bills, debts (I owe) and loans (owed to me), and the month's numbers made
// from them. AZN; a weekly amount counts 52 / 12 weeks a month. Months are keyed by their first day ("2026-11-01").
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type MoneyItem = Tables<"money_items">;
export type Payment = Tables<"money_payments">;
export type Balance = Tables<"money_balances">;
export type Kind = "income" | "bill" | "debt" | "loan";
export type Money = { items: MoneyItem[]; payments: Payment[]; balance: Balance | null };

export const WEEKS_PER_MONTH = 52 / 12;
export const repeats = (kind: string) => kind === "income" || kind === "bill";

export const monthOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
export const addMonths = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number);
  return monthOf(new Date(y, mo - 1 + n, 1));
};
const asDate = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1);
export const monthLabel = (m: string, short = false) =>
  asDate(m).toLocaleDateString("en-US", short ? { month: "short" } : { month: "long", year: "numeric" });

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
export const azn = (n: number) => `${fmt.format(Math.round(n * 100) / 100)} ₼`;

export const monthly = (i: MoneyItem) => (i.period === "week" ? i.amount * WEEKS_PER_MONTH : i.amount);
export const activeIn = (i: MoneyItem, m: string) => (!i.starts_on || i.starts_on < addMonths(m, 1)) && (!i.ends_on || i.ends_on >= m);
const sum = (ps: Payment[]) => ps.reduce((s, p) => s + p.amount, 0);
export const paymentsOf = (i: MoneyItem, payments: Payment[]) => payments.filter((p) => p.item_id === i.id);
export const remaining = (i: MoneyItem, payments: Payment[]) => Math.max(0, i.amount - sum(paymentsOf(i, payments).filter((p) => p.paid_at)));

// The month at a glance: what comes in (income + loans paid back that month), what goes out (bills + instalments),
// what is left, and the open debts both ways.
export function totals({ items, payments }: Money, m: string) {
  const t = { in: 0, out: 0, owe: 0, owed: 0 };
  for (const i of items) {
    const due = sum(paymentsOf(i, payments).filter((p) => p.month === m));
    if (i.kind === "income" && activeIn(i, m)) t.in += monthly(i);
    else if (i.kind === "bill" && activeIn(i, m)) t.out += monthly(i);
    else if (i.kind === "debt") { t.owe += remaining(i, payments); t.out += due; }
    else if (i.kind === "loan") { t.owed += remaining(i, payments); t.in += due; }
  }
  return { ...t, left: t.in - t.out };
}

// "200 200 200 300" → [200, 200, 200, 300]
export const parsePlan = (s: string) => s.split(/[\s,;+]+/).map(Number).filter((n) => n > 0);

const check = <T,>(r: { data: T; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

export async function loadMoney(): Promise<Money> {
  const [items, payments, balance] = await Promise.all([
    supabase.from("money_items").select("*").order("position").order("created_at"),
    supabase.from("money_payments").select("*").order("month", { nullsFirst: false }).order("created_at"),
    supabase.from("money_balances").select("*").order("noted_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return { items: check(items) ?? [], payments: check(payments) ?? [], balance: check(balance) };
}

export const setBalance = async (amount: number) => check(await supabase.from("money_balances").insert({ amount }));

export type Draft = { name: string; amount: number; period: string | null; starts_on: string | null; note: string };

export async function saveItem(kind: Kind, d: Draft, id: string | null, position: number) {
  const row = { kind, name: d.name.trim(), amount: d.amount, period: repeats(kind) ? d.period ?? "month" : null, starts_on: d.starts_on || null, note: d.note };
  if (id) {
    check(await supabase.from("money_items").update(row).eq("id", id));
    return id;
  }
  return (check(await supabase.from("money_items").insert({ ...row, position }).select("id").single()) as { id: string }).id;
}

export const deleteItem = async (id: string) => check(await supabase.from("money_items").delete().eq("id", id));

// Instalments of a debt / loan from a month on; the unpaid ones are replaced, paid months stay.
export async function setPlan(itemId: string, first: string, amounts: number[], payments: Payment[]) {
  const mine = payments.filter((p) => p.item_id === itemId);
  check(await supabase.from("money_payments").delete().eq("item_id", itemId).is("paid_at", null));
  const paidMonths = new Set(mine.filter((p) => p.paid_at && p.month).map((p) => p.month));
  const rows: { item_id: string; month: string; amount: number }[] = [];
  for (let m = first, k = 0; k < amounts.length; m = addMonths(m, 1)) if (!paidMonths.has(m)) rows.push({ item_id: itemId, month: m, amount: amounts[k++] });
  if (rows.length) check(await supabase.from("money_payments").insert(rows));
}

// A bill paid / income received for a month, or an instalment ticked: on ↔ off.
export async function toggleMonth(item: MoneyItem, m: string, payments: Payment[]) {
  const p = payments.find((x) => x.item_id === item.id && x.month === m);
  if (repeats(item.kind)) {
    if (p) check(await supabase.from("money_payments").delete().eq("id", p.id));
    else check(await supabase.from("money_payments").insert({ item_id: item.id, month: m, amount: Math.round(monthly(item) * 100) / 100, paid_at: new Date().toISOString() }));
  } else if (p) {
    check(await supabase.from("money_payments").update({ paid_at: p.paid_at ? null : new Date().toISOString() }).eq("id", p.id));
  }
}

// A debt / loan paid back now, whole or in part, outside the plan.
export const pay = async (itemId: string, amount: number) =>
  check(await supabase.from("money_payments").insert({ item_id: itemId, amount, paid_at: new Date().toISOString() }));
