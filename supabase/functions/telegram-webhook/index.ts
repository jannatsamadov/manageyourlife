// Telegram bot webhook (P-19, P-57, P-70 phase 3): what you send lands in the Inbox — one `capture` item per message
// (title = the first line, the rest + a forward's origin + files in the text), to be sorted later in the app (Tasks →
// Inbox) by hand or with AI. No AI here.
// "/start <code>" (or the bare code) links the chat to an account (the code comes from Settings → Telegram).
// "/idea", "/question", "/todo", "/resource" in front of the text set its Kind; the buttons under ✓ change it, Undo
// moves it to the trash. Photos and files go to the notes' Inbox/files/ after the reply (so the bot answers at once).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { INBOX, localTime, putFile, safeName, trashFile } from "../_shared/vault.ts";
import { scopeOf } from "../_shared/items.ts";
import { addCapture, captureBySource, captureParts, ensureKindField, KINDS } from "../_shared/capture.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const HOW_TO_LINK = "ManageYourLife → Settings → Telegram → Connect, then send me the code shown there.";
const LINKED = "✓ Connected. Send me anything: it goes to your Inbox. Start with /idea, /question, /todo or /resource to mark its kind.";
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

// ✓ (+ kind) with the kind buttons and Undo; the buttons carry the message id.
const receipt = (messageId: number, kind: string | null) => ({
  text: kind ? `✓ ${KINDS[kind]}` : "✓",
  reply_markup: {
    inline_keyboard: [
      Object.entries(KINDS).map(([k, word]) => ({ text: k === kind ? `${word} ✓` : word, callback_data: `kind:${messageId}:${k}` })),
      [{ text: "Undo", callback_data: `undo:${messageId}` }],
    ],
  },
});

async function linkedUser(chatId: number) {
  const { data, error } = await supabase.from("telegram_links").select("user_id, time_zone").eq("chat_id", chatId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const scope = await scopeOf(supabase, data.user_id as string);
  return { userId: data.user_id as string, timeZone: (data.time_zone as string) || "UTC", home: scope.home };
}

// The message's day in the user's own time zone (for the files' names).
const dayOf = (unix: number, timeZone: string) => localTime(new Date(unix * 1000), timeZone).day;

type Attachment = { type: string; file_id: string; file_size: number | null; mime: string; name: string };

const DEFAULT_NAMES: Record<string, string> = {
  photo: "photo.jpg", video: "video.mp4", audio: "audio.mp3", voice: "voice.ogg", video_note: "video.mp4", animation: "animation.mp4", document: "file",
};
const TYPE_WORDS: Record<string, string> = {
  photo: "Photo", video: "Video", audio: "Audio", voice: "Voice message", video_note: "Video message", animation: "GIF", document: "File",
};

// The message's files, each with the name it gets in Inbox/files/ (the same name every time, so an edit finds them).
function attachmentsOf(msg: any, day: string): Attachment[] {
  const list: Attachment[] = [];
  const add = (type: string, f: any) => {
    if (!f) return;
    const i = list.length;
    list.push({
      type,
      file_id: f.file_id,
      file_size: f.file_size ?? null,
      mime: f.mime_type ?? (type === "photo" ? "image/jpeg" : "application/octet-stream"),
      name: `${day}-${msg.message_id}-${i}-${safeName(f.file_name ?? DEFAULT_NAMES[type]) || DEFAULT_NAMES[type]}`,
    });
  };
  if (msg.photo?.length) add("photo", msg.photo[msg.photo.length - 1]);
  add("document", msg.document);
  add("video", msg.video);
  add("audio", msg.audio);
  add("voice", msg.voice);
  add("video_note", msg.video_note);
  add("animation", msg.animation);
  return list;
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
  return { content: command ? text.slice(command[0].length) : text, kind: command ? command[1].toLowerCase() : null };
}

// Lines added under the text: where a forward came from, the files (Obsidian embeds of Inbox/files/…).
function moreOf(msg: any, files: Attachment[]) {
  const forward = forwardOf(msg);
  const more: string[] = [];
  if (forward.from || forward.url) more.push(`— ${[forward.from, forward.url].filter(Boolean).join(" ")}`);
  for (const f of files) {
    more.push(f.file_size && f.file_size > TELEGRAM_FILE_LIMIT ? `(${f.type} over 20 MB, kept in Telegram)` : `![[${f.name}]]`);
  }
  return more;
}

const fallbackTitle = (msg: any, files: Attachment[]) =>
  files.length ? (msg.document?.file_name ?? TYPE_WORDS[files[0].type] ?? "File") : "Capture";

const inBackground = (job: Promise<unknown>) => {
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(job);
  else job.catch(console.error);
};

// Copies the message's files from Telegram into Inbox/files/.
async function storeFiles(userId: string, files: Attachment[]) {
  for (const f of files) {
    try {
      if (f.file_size && f.file_size > TELEGRAM_FILE_LIMIT) continue;
      const info = await (await callTelegram("getFile", { file_id: f.file_id })).json();
      if (!info.ok) throw new Error(info.description);
      const file = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${info.result.file_path}`);
      if (!file.ok) throw new Error(`download ${file.status}`);
      await putFile(supabase, userId, `${INBOX}/files/${f.name}`, await file.arrayBuffer(), f.mime);
    } catch (e) {
      console.error("telegram file:", e);
    }
  }
}

const externalId = (chatId: number, messageId: number | string) => `${chatId}:${messageId}`;

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

  const user = await linkedUser(chatId);
  if (!user) return say(chatId, HOW_TO_LINK);

  const { content, kind } = contentOf(msg);
  const day = dayOf(msg.date, user.timeZone);
  const files = attachmentsOf(msg, day);
  if (!content.trim() && !files.length) return say(chatId, kind ? `/${kind} your text` : "Nothing to save.");

  const forward = forwardOf(msg);
  const saved = await addCapture(supabase, {
    workspaceId: user.home, userId: user.userId, text: content, more: moreOf(msg, files), kind,
    fallbackTitle: fallbackTitle(msg, files),
    source: { source: "telegram", external_id: externalId(chatId, msg.message_id), url: forward.url, meta: { files: files.map((f) => f.name) } },
  });
  if (!saved) return done(); // a retried update is in already: no second ✓
  if (files.length) inBackground(storeFiles(user.userId, files));

  return answer("sendMessage", {
    chat_id: chatId,
    disable_notification: true,
    reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
    ...receipt(msg.message_id, kind),
  });
}

// An edited message updates its item while it is still unsorted (a command added to the text sets the kind).
async function onEdit(msg: any) {
  if (msg.chat.type !== "private") return done();
  const user = await linkedUser(msg.chat.id);
  if (!user) return done();
  const item = await captureBySource(supabase, user.home, "telegram", externalId(msg.chat.id, msg.message_id));
  if (!item || item.type !== "capture") return done();
  const { content, kind } = contentOf(msg);
  const files = attachmentsOf(msg, dayOf(msg.date, user.timeZone));
  const parts = captureParts(content, moreOf(msg, files), fallbackTitle(msg, files));
  const { error } = await supabase.from("items")
    .update({ ...parts, props: kind ? { ...item.props, kind } : item.props }).eq("id", item.id);
  if (error) throw error;
  if (kind) await ensureKindField(supabase, user.home);
  return done();
}

// Buttons under ✓: "kind:<message id>:<kind>" / "undo:<message id>". Older receipts carried the capture note's day
// as well ("kind:<day>:<id>:<kind>"); their messages were moved into items with the same id, so they work too.
async function onCallback(cq: any) {
  const parts = String(cq.data ?? "").split(":");
  const action = parts[0];
  const messageId = parts.slice(1).find((p) => /^\d+$/.test(p));
  const kind = parts[parts.length - 1];
  const chatId: number | undefined = cq.message?.chat?.id;
  const user = chatId && messageId && ["undo", "kind"].includes(action) ? await linkedUser(chatId) : null;
  if (!user) return answer("answerCallbackQuery", { callback_query_id: cq.id });
  const item = await captureBySource(supabase, user.home, "telegram", externalId(chatId!, messageId!));
  if (!item || item.deleted_at) return answer("answerCallbackQuery", { callback_query_id: cq.id, text: "Not in the Inbox any more" });

  if (action === "kind" && KINDS[kind]) {
    const { error } = await supabase.from("items").update({ props: { ...item.props, kind } }).eq("id", item.id);
    if (error) throw error;
    await ensureKindField(supabase, user.home);
    await callTelegram("editMessageText", { chat_id: chatId, message_id: cq.message.message_id, ...receipt(Number(messageId), kind) });
    return answer("answerCallbackQuery", { callback_query_id: cq.id, text: KINDS[kind] });
  }

  const { error } = await supabase.from("items").update({ deleted_at: new Date().toISOString() }).eq("id", item.id);
  if (error) throw error;
  const { data } = await supabase.from("vault_files").select("path").eq("user_id", user.userId).is("trashed_at", null)
    .like("path", `${INBOX}/files/%-${messageId}-%`);
  const own = new RegExp(`^${INBOX}/files/\\d{4}-\\d{2}-\\d{2}-${messageId}-\\d+-`);
  for (const f of data ?? []) if (own.test(f.path)) await trashFile(supabase, user.userId, f.path);
  await callTelegram("editMessageText", { chat_id: chatId, message_id: cq.message.message_id, text: "↩ Removed" });
  return answer("answerCallbackQuery", { callback_query_id: cq.id, text: "Removed" });
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
