// Row shapes for tables the generated database types do not include yet (kept in sync with supabase/migrations).
export type StrategyNodeRow = {
  id: string; user_id: string; parent_id: string | null; kind: string; title: string; description: string;
  status: string; weight: number; target_count: number | null; progress: number | null; due_date: string | null;
  start_date: string | null; done_at: string | null; position: number; color: string | null; created_at: string; updated_at: string;
};
export type MoneyItemRow = {
  id: string; user_id: string; kind: string; name: string; amount: number; period: string | null;
  starts_on: string | null; ends_on: string | null; note: string; position: number; created_at: string; updated_at: string;
};
export type MoneyPaymentRow = { id: string; user_id: string; item_id: string; amount: number; month: string | null; paid_at: string | null; created_at: string };
export type MoneyBalanceRow = { id: string; user_id: string; amount: number; noted_at: string };
export type GoogleConnectionRow = {
  user_id: string; google_email: string | null; scopes: string[]; calendar_id: string; last_error: string | null;
  last_tasks_import_at: string | null; last_calendar_sync_at: string | null; connected_at: string;
};
export type ApiTokenRow = {
  id: string; user_id: string; name: string; token_hash: string; token_prefix: string; scopes: string[];
  created_at: string; last_used_at: string | null; expires_at: string | null; revoked_at: string | null;
};
