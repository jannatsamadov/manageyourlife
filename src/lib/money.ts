// Money (P-67): the user's balance, income, bills, debts (I owe) and loans (owed to me), and the month's numbers made
// from them. AZN; a weekly amount counts 52 / 12 weeks a month, a yearly one 1 / 12 a month (paid once a year).
// Months are keyed by their first day ("2026-11-01").
// Since v2 (P-70) a money entry is an item (type income / bill / debt / loan / buy; title, note = body) plus its
// money_details row (amount, period, dates); payments and balances stay ledgers. Money never reaches MCP / AI.
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type MoneyItem = {
  id: string; kind: Kind; name: string; amount: number; period: string | null; starts_on: string | null; ends_on: string | null;
  note: string; position: number; created_at: string;
};
export type Payment = Tables<"money_payments">;
export type Balance = Tables<"money_balances">;
// buy: a thing to buy (amount = price, 0 = not known) or, once bought, spending in that month (one payment row).
export type Kind = "income" | "bill" | "debt" | "loan" | "buy";
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

export const monthly = (i: MoneyItem) => (i.period === "week" ? i.amount * WEEKS_PER_MONTH : i.period === "year" ? i.amount / 12 : i.amount);
// What ticks a bill / income for month m: that month's payment; for a yearly one, any payment in that year.
export const paymentFor = (i: MoneyItem, m: string, payments: Payment[]) =>
  payments.find((p) => p.item_id === i.id && p.month && (i.period === "year" ? p.month.slice(0, 4) === m.slice(0, 4) : p.month === m));
export const activeIn = (i: MoneyItem, m: string) => (!i.starts_on || i.starts_on < addMonths(m, 1)) && (!i.ends_on || i.ends_on >= m);
const sum = (ps: Payment[]) => ps.reduce((s, p) => s + p.amount, 0);
export const paymentsOf = (i: MoneyItem, payments: Payment[]) => payments.filter((p) => p.item_id === i.id);
export const remaining = (i: MoneyItem, payments: Payment[]) => Math.max(0, i.amount - sum(paymentsOf(i, payments).filter((p) => p.paid_at)));

// The month at a glance: what comes in (income + loans paid back that month), what goes out (bills + instalments +
// what was bought), what is left, and the open debts both ways.
export function totals({ items, payments }: Money, m: string) {
  const t = { in: 0, out: 0, owe: 0, owed: 0 };
  for (const i of items) {
    const due = sum(paymentsOf(i, payments).filter((p) => p.month === m));
    if (i.kind === "income" && activeIn(i, m)) t.in += monthly(i);
    else if (i.kind === "bill" && activeIn(i, m)) t.out += monthly(i);
    else if (i.kind === "debt") { t.owe += remaining(i, payments); t.out += due; }
    else if (i.kind === "loan") { t.owed += remaining(i, payments); t.in += due; }
    else if (i.kind === "buy") t.out += due;
  }
  return { ...t, left: t.in - t.out };
}

// "200 200 200 300" → [200, 200, 200, 300]
export const parsePlan = (s: string) => s.split(/[\s,;+]+/).map(Number).filter((n) => n > 0);

const check = <T,>(r: { data: T; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

type Row = { id: string; type: string; title: string; body: string; position: number; created_at: string;
  money_details: { amount: number; period: string | null; starts_on: string | null; ends_on: string | null } | { amount: number; period: string | null; starts_on: string | null; ends_on: string | null }[] | null };
const MONEY = ["income", "bill", "debt", "loan", "buy"];

const toMoney = (r: Row): MoneyItem => {
  const d = Array.isArray(r.money_details) ? r.money_details[0] : r.money_details;
  return { id: r.id, kind: r.type as Kind, name: r.title, note: r.body, position: r.position, created_at: r.created_at,
    amount: Number(d?.amount ?? 0), period: d?.period ?? null, starts_on: d?.starts_on ?? null, ends_on: d?.ends_on ?? null };
};

export async function loadMoney(): Promise<Money> {
  const [items, payments, balance] = await Promise.all([
    supabase.from("items").select("id, type, title, body, position, created_at, money_details(amount, period, starts_on, ends_on)")
      .in("type", MONEY).is("deleted_at", null).order("position").order("created_at"),
    supabase.from("money_payments").select("*").order("month", { nullsFirst: false }).order("created_at"),
    supabase.from("money_balances").select("*").order("noted_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return { items: ((check(items) ?? []) as unknown as Row[]).map(toMoney), payments: check(payments) ?? [], balance: check(balance) };
}

export const setBalance = async (amount: number) => check(await supabase.from("money_balances").insert({ amount }));

export type Draft = { name: string; amount: number; period: string | null; starts_on: string | null; note: string };

export async function saveItem(kind: Kind, d: Draft, id: string | null, position: number) {
  const item = { title: d.name.trim(), body: d.note };
  const details = { amount: d.amount, period: repeats(kind) ? d.period ?? "month" : null, starts_on: d.starts_on || null };
  if (id) {
    check(await supabase.from("items").update(item).eq("id", id));
    check(await supabase.from("money_details").update(details).eq("item_id", id));
    return id;
  }
  // The workspace: the personal one (DB default); the details take the item's (trigger).
  const made = check(await supabase.from("items").insert({ ...item, type: kind, position }).select("id, workspace_id").single()) as
    { id: string; workspace_id: string };
  const { error } = await supabase.from("money_details").insert({ ...details, item_id: made.id, workspace_id: made.workspace_id });
  if (error) {
    await supabase.from("items").delete().eq("id", made.id); // no money item without its amount
    throw new Error(error.message);
  }
  return made.id;
}

// The details and the payments go with it.
export const deleteItem = async (id: string) => check(await supabase.from("items").delete().eq("id", id));

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
  if (repeats(item.kind)) {
    const p = paymentFor(item, m, payments);
    const amount = item.period === "year" ? item.amount : Math.round(monthly(item) * 100) / 100;
    if (p) check(await supabase.from("money_payments").delete().eq("id", p.id));
    else check(await supabase.from("money_payments").insert({ item_id: item.id, month: m, amount, paid_at: new Date().toISOString() }));
    return;
  }
  const p = payments.find((x) => x.item_id === item.id && x.month === m);
  if (p) {
    check(await supabase.from("money_payments").update({ paid_at: p.paid_at ? null : new Date().toISOString() }).eq("id", p.id));
  }
}

// The payment that made a 'buy' item spending (none = still to buy).
export const boughtOf = (i: MoneyItem, payments: Payment[]) => payments.find((p) => p.item_id === i.id);

// Bought in month m for this amount; again → the amount changes.
export async function buy(item: MoneyItem, m: string, amount: number, payments: Payment[]) {
  const p = boughtOf(item, payments);
  if (p) check(await supabase.from("money_payments").update({ amount }).eq("id", p.id));
  else check(await supabase.from("money_payments").insert({ item_id: item.id, month: m, amount, paid_at: new Date().toISOString() }));
}

// Not bought after all: back to the list.
export const unbuy = async (item: MoneyItem, payments: Payment[]) => {
  const p = boughtOf(item, payments);
  if (p) check(await supabase.from("money_payments").delete().eq("id", p.id));
};

// A debt / loan paid back now, whole or in part, outside the plan.
export const pay = async (itemId: string, amount: number) =>
  check(await supabase.from("money_payments").insert({ item_id: itemId, amount, paid_at: new Date().toISOString() }));
