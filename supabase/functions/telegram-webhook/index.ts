// Telegram bot webhook (P-19): every message from a linked chat lands in the Inbox as it came — no AI, no parsing.
// "/start <code>" (or the bare code) links the chat to an account (the code comes from Settings → Telegram).
// "/idea", "/question", "/todo", "/resource" in front of the text set the item's kind; the buttons under ✓ set or change it.
// Files are copied into Storage (bucket inbox-files) after the reply, so the bot answers at once.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const HOW_TO_LINK = "ManageYourLife → Settings → Telegram → Connect, then send me the code shown there.";
const LINKED = "✓ Connected. Send me anything. Start with /idea, /question, /todo or /resource to file it.";
const KINDS: Record<string, string> = { idea: "💡", question: "❓", todo: "✅", resource: "📚" };
const KIND_COMMAND = /^\/(idea|question|todo|resource)(@\w+)?(\s+|$)/i;
const TELEGRAM_FILE_LIMIT = 20 * 1024 * 1024; // bots can download up to 20 MB

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

// ✓ (+ kind) with the kind buttons and Undo.
const receipt = (itemId: string, kind: string | null) => ({
  text: kind ? `✓ ${KINDS[kind]}` : "✓",
  reply_markup: {
    inline_keyboard: [
      Object.entries(KINDS).map(([k, emoji]) => ({ text: k === kind ? `[${emoji}]` : emoji, callback_data: `kind:${itemId}:${k}` })),
      [{ text: "Undo", callback_data: `undo:${itemId}` }],
    ],
  },
});

async function linkedUser(chatId: number): Promise<string | null> {
  const { data, error } = await supabase.from("telegram_links").select("user_id").eq("chat_id", chatId).maybeSingle();
  if (error) throw error;
  return data?.user_id ?? null;
}

function attachmentsOf(msg: any) {
  const list: Record<string, unknown>[] = [];
  const add = (type: string, f: any) =>
    f && list.push({
      type,
      file_id: f.file_id,
      file_unique_id: f.file_unique_id,
      file_name: f.file_name ?? null,
      mime_type: f.mime_type ?? (type === "photo" ? "image/jpeg" : null),
      file_size: f.file_size ?? null,
      path: null, // set once the file is in Storage
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

// Text without a leading /idea… command, and the kind that command set.
function contentOf(msg: any) {
  const text: string = msg.text ?? msg.caption ?? "";
  const command = text.match(KIND_COMMAND);
  return { text, content: command ? text.slice(command[0].length) : text, kind: command ? command[1].toLowerCase() : null };
}

function metaOf(msg: any, text: string) {
  const forward = forwardOf(msg);
  return {
    source_url: forward.url,
    meta: { links: linksOf(text, msg.entities ?? msg.caption_entities), forwarded_from: forward.from, telegram: msg },
  };
}

// Copies the item's files from Telegram into Storage and records their paths.
async function storeFiles(userId: string, itemId: string, attachments: any[]) {
  const stored = [];
  for (const [i, a] of attachments.entries()) {
    try {
      if (a.file_size && a.file_size > TELEGRAM_FILE_LIMIT) {
        stored.push({ ...a, too_big: true });
        continue;
      }
      const info = await (await callTelegram("getFile", { file_id: a.file_id })).json();
      if (!info.ok) throw new Error(info.description);
      const file = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${info.result.file_path}`);
      if (!file.ok) throw new Error(`download ${file.status}`);
      const ext = String(info.result.file_path).match(/\.\w+$/)?.[0] ?? "";
      const name = (a.file_name ?? `${a.type}${ext}`).replace(/[^\w.\-]+/g, "_").slice(-100);
      const path = `${userId}/${itemId}/${i}-${name}`;
      const { error } = await supabase.storage.from("inbox-files")
        .upload(path, await file.arrayBuffer(), { contentType: a.mime_type ?? "application/octet-stream", upsert: true });
      if (error) throw error;
      stored.push({ ...a, path });
    } catch (e) {
      console.error("telegram file:", e);
      stored.push(a);
    }
  }
  await supabase.from("inbox_items").update({ attachments: stored }).eq("id", itemId);
}

const inBackground = (job: Promise<unknown>) => {
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(job);
  else job.catch(console.error);
};

async function onMessage(msg: any) {
  const chatId: number = msg.chat.id;
  if (msg.chat.type !== "private") return done();
  const text: string = msg.text ?? "";

  // The code comes as "/start <code>" from the t.me link, or pasted by hand when a Telegram client drops the link's payload.
  const pasted = text.trim().match(/^[0-9a-f]{32}$/)?.[0];
  if (/^\/start(\s|$)/.test(text) || pasted) {
    const code = pasted ?? text.split(/\s+/)[1];
    if (code) {
      const { data: uid, error } = await supabase.rpc("redeem_telegram_link_code", {
        p_code: code,
        p_chat_id: chatId,
        p_username: msg.from?.username ?? null,
      });
      if (error) throw error;
      return say(chatId, uid ? LINKED : "This code has expired or was already used. " + HOW_TO_LINK);
    }
    return say(chatId, (await linkedUser(chatId)) ? LINKED : HOW_TO_LINK);
  }

  const userId = await linkedUser(chatId);
  if (!userId) return say(chatId, HOW_TO_LINK);

  const { text: original, content, kind } = contentOf(msg);
  const attachments = attachmentsOf(msg);
  if (!content.trim() && !attachments.length) {
    return say(chatId, kind ? `/${kind} your text` : "Nothing to save.");
  }

  const { data: inserted, error } = await supabase
    .from("inbox_items")
    .upsert({
      user_id: userId,
      source: "telegram",
      source_ref: `${chatId}:${msg.message_id}`,
      content,
      kind,
      attachments,
      ...metaOf(msg, original),
    }, { onConflict: "user_id,source,source_ref", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;
  // A retried update is already saved: no second ✓.
  if (!inserted?.length) return done();
  const itemId = inserted[0].id;
  if (attachments.length) inBackground(storeFiles(userId, itemId, attachments));

  return answer("sendMessage", {
    chat_id: chatId,
    disable_notification: true,
    reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
    ...receipt(itemId, kind),
  });
}

// An edited message updates its Inbox item while it is still unsorted (files and kind stay unless a command is added).
async function onEdit(msg: any) {
  if (msg.chat.type !== "private") return done();
  const userId = await linkedUser(msg.chat.id);
  if (!userId) return done();
  const { text, content, kind } = contentOf(msg);
  const { error } = await supabase
    .from("inbox_items")
    .update({ content, ...(kind ? { kind } : {}), ...metaOf(msg, text) })
    .eq("user_id", userId)
    .eq("source", "telegram")
    .eq("source_ref", `${msg.chat.id}:${msg.message_id}`)
    .is("sorted_at", null);
  if (error) throw error;
  return done();
}

async function onCallback(cq: any) {
  const [action, id, kind] = String(cq.data ?? "").split(":");
  const chatId: number | undefined = cq.message?.chat?.id;
  const userId = chatId && id ? await linkedUser(chatId) : null;
  if (!userId || !["undo", "kind"].includes(action)) return answer("answerCallbackQuery", { callback_query_id: cq.id });

  if (action === "kind" && KINDS[kind]) {
    const { data, error } = await supabase.from("inbox_items").update({ kind })
      .eq("id", id).eq("user_id", userId).is("sorted_at", null).select("id");
    if (error) throw error;
    if (data?.length) await callTelegram("editMessageText", { chat_id: chatId, message_id: cq.message.message_id, ...receipt(id, kind) });
    return answer("answerCallbackQuery", { callback_query_id: cq.id, text: data?.length ? `${KINDS[kind]} ${kind}` : "Already sorted in the app" });
  }

  const { data, error } = await supabase.from("inbox_items").delete()
    .eq("id", id).eq("user_id", userId).is("sorted_at", null).select("attachments");
  if (error) throw error;
  const removed = !!data?.length;
  if (removed) {
    const paths = (data[0].attachments ?? []).map((a: any) => a.path).filter(Boolean);
    if (paths.length) await supabase.storage.from("inbox-files").remove(paths);
    await callTelegram("editMessageText", { chat_id: chatId, message_id: cq.message.message_id, text: "↩ Removed" });
  }
  return answer("answerCallbackQuery", { callback_query_id: cq.id, text: removed ? "Removed" : "Already sorted in the app" });
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
    if (chatId) return say(chatId, "⚠️ Not saved. Please send it again.");
  }
  return done();
});
