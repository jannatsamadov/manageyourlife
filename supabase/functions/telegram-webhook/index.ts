// Telegram bot webhook (P-19): every message from a linked chat lands in the Inbox as it came — no AI, no parsing.
// "/start <code>" links the chat to an account (the code comes from Settings → Connect Telegram).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const HOW_TO_LINK = "Open ManageYourLife → Settings → Connect Telegram to link this chat.";
const LINKED = "✓ Connected. Send me anything — text, links, forwards, files — and it lands in your ManageYourLife Inbox.";

// Constant-time compare of Telegram's secret header.
function sameSecret(given: string | null, expected: string) {
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const callTelegram = (method: string, body: Record<string, unknown>) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// A reply inside the webhook response: Telegram runs the method itself, one round trip less.
const answer = (method: string, body: Record<string, unknown>) =>
  new Response(JSON.stringify({ method, ...body }), { headers: { "Content-Type": "application/json" } });
const done = () => new Response("ok");
const say = (chatId: number, text: string) => answer("sendMessage", { chat_id: chatId, text });

async function linkedUser(chatId: number): Promise<string | null> {
  const { data, error } = await supabase.from("telegram_links").select("user_id").eq("chat_id", chatId).maybeSingle();
  if (error) throw error;
  return data?.user_id ?? null;
}

// Files stay on Telegram for now (file_id lets us fetch them later, P-23).
function attachmentsOf(msg: any) {
  const list: Record<string, unknown>[] = [];
  const add = (type: string, f: any) =>
    f && list.push({
      type,
      file_id: f.file_id,
      file_unique_id: f.file_unique_id,
      file_name: f.file_name ?? null,
      mime_type: f.mime_type ?? null,
      file_size: f.file_size ?? null,
    });
  if (msg.photo?.length) add("photo", msg.photo[msg.photo.length - 1]);
  add("document", msg.document);
  add("video", msg.video);
  add("audio", msg.audio);
  add("voice", msg.voice);
  add("video_note", msg.video_note);
  add("animation", msg.animation);
  return list;
}

// URLs in the text, including hidden ones behind a word (text_link).
function linksOf(text: string, entities: any[] = []) {
  const links: string[] = [];
  for (const e of entities) {
    if (e.type === "text_link") links.push(e.url);
    if (e.type === "url") links.push(text.substr(e.offset, e.length));
  }
  return [...new Set(links)];
}

function forwardOf(msg: any) {
  const o = msg.forward_origin;
  if (!o) return { from: null, url: null };
  const from =
    o.type === "user" ? [o.sender_user?.first_name, o.sender_user?.last_name].filter(Boolean).join(" ")
    : o.type === "hidden_user" ? o.sender_user_name
    : o.type === "chat" ? o.sender_chat?.title
    : o.type === "channel" ? o.chat?.title
    : null;
  const url = o.type === "channel" && o.chat?.username ? `https://t.me/${o.chat.username}/${o.message_id}` : null;
  return { from: from || null, url };
}

function itemOf(msg: any) {
  const text: string = msg.text ?? msg.caption ?? "";
  const forward = forwardOf(msg);
  return {
    content: text,
    attachments: attachmentsOf(msg),
    source_url: forward.url,
    meta: {
      links: linksOf(text, msg.entities ?? msg.caption_entities),
      forwarded_from: forward.from,
      telegram: msg,
    },
  };
}

async function onMessage(msg: any) {
  const chatId: number = msg.chat.id;
  if (msg.chat.type !== "private") return done();
  const text: string = msg.text ?? "";

  if (/^\/start(\s|$)/.test(text)) {
    const code = text.split(/\s+/)[1];
    if (code) {
      const { data: uid, error } = await supabase.rpc("redeem_telegram_link_code", {
        p_code: code,
        p_chat_id: chatId,
        p_username: msg.from?.username ?? null,
      });
      if (error) throw error;
      return say(chatId, uid ? LINKED : "This link has expired or was already used. " + HOW_TO_LINK);
    }
    return say(chatId, (await linkedUser(chatId)) ? LINKED : HOW_TO_LINK);
  }

  const userId = await linkedUser(chatId);
  if (!userId) return say(chatId, HOW_TO_LINK);

  const sourceRef = `${chatId}:${msg.message_id}`;
  const { data: inserted, error } = await supabase
    .from("inbox_items")
    .upsert({ user_id: userId, source: "telegram", source_ref: sourceRef, ...itemOf(msg) }, {
      onConflict: "user_id,source,source_ref",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) throw error;
  // A retried update is already saved: no second ✓.
  if (!inserted?.length) return done();

  return answer("sendMessage", {
    chat_id: chatId,
    text: "✓",
    disable_notification: true,
    reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
    reply_markup: { inline_keyboard: [[{ text: "Undo", callback_data: `undo:${inserted[0].id}` }]] },
  });
}

// An edited message updates its Inbox item while it is still unsorted.
async function onEdit(msg: any) {
  if (msg.chat.type !== "private") return done();
  const userId = await linkedUser(msg.chat.id);
  if (!userId) return done();
  const { error } = await supabase
    .from("inbox_items")
    .update(itemOf(msg))
    .eq("user_id", userId)
    .eq("source", "telegram")
    .eq("source_ref", `${msg.chat.id}:${msg.message_id}`)
    .is("sorted_at", null);
  if (error) throw error;
  return done();
}

async function onCallback(cq: any) {
  const [action, id] = String(cq.data ?? "").split(":");
  const chatId: number | undefined = cq.message?.chat?.id;
  if (action !== "undo" || !id || !chatId) return answer("answerCallbackQuery", { callback_query_id: cq.id });

  const userId = await linkedUser(chatId);
  let removed = false;
  if (userId) {
    const { data, error } = await supabase
      .from("inbox_items")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .is("sorted_at", null)
      .select("id");
    if (error) throw error;
    removed = !!data?.length;
  }
  if (removed) {
    await callTelegram("editMessageText", { chat_id: chatId, message_id: cq.message.message_id, text: "↩ Removed from the Inbox" });
  }
  return answer("answerCallbackQuery", {
    callback_query_id: cq.id,
    text: removed ? "Removed" : "Already sorted or removed in the app",
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!sameSecret(req.headers.get("X-Telegram-Bot-Api-Secret-Token"), WEBHOOK_SECRET)) {
    return new Response("Forbidden", { status: 403 });
  }
  const update = await req.json().catch(() => null);
  if (!update) return done();

  try {
    if (update.message) return await onMessage(update.message);
    if (update.edited_message) return await onEdit(update.edited_message);
    if (update.callback_query) return await onCallback(update.callback_query);
  } catch (e) {
    console.error("telegram-webhook:", e);
    // Tell the sender instead of making Telegram retry the update forever.
    const chatId = update.message?.chat?.id;
    if (chatId) return say(chatId, "⚠️ Not saved — something went wrong on our side. Please send it again.");
  }
  return done();
});
