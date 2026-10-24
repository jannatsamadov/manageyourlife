// Telegram bot webhook (P-19, P-57): what you send lands in today's draft note — Drafts/<date>.md in your notes — under a
// heading per kind (Ideas, Questions, To-dos, Resources, Notes), one list item per message. No AI, no parsing.
// "/start <code>" (or the bare code) links the chat to an account (the code comes from Settings → Telegram).
// "/idea", "/question", "/todo", "/resource" in front of the text set the kind; the buttons under ✓ move it, Undo removes it.
// Photos and files go to Drafts/files/ after the reply (so the bot answers at once) and are embedded in the item.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { addItem, DRAFT_SECTIONS, editNote, hasItem, putFile, removeItem, replaceItem, safeName, sectionOfItem, trashFile } from "../_shared/vault.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const HOW_TO_LINK = "ManageYourLife → Settings → Telegram → Connect, then send me the code shown there.";
const LINKED = "✓ Connected. Send me anything: it goes to today's draft in your notes. Start with /idea, /question, /todo or /resource to file it.";
const KINDS: Record<string, string> = { idea: "💡", question: "❓", todo: "✅", resource: "📚" };
const KIND_COMMAND = /^\/(idea|question|todo|resource)(@\w+)?(\s+|$)/i;
const TELEGRAM_FILE_LIMIT = 20 * 1024 * 1024; // bots can download up to 20 MB
const DAY = /^\d{4}-\d{2}-\d{2}$/;

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

// ✓ (+ kind) with the kind buttons and Undo; the buttons carry the draft's date and the message id.
const receipt = (day: string, messageId: number, kind: string | null) => ({
  text: kind ? `✓ ${KINDS[kind]}` : "✓",
  reply_markup: {
    inline_keyboard: [
      Object.entries(KINDS).map(([k, emoji]) => ({ text: k === kind ? `[${emoji}]` : emoji, callback_data: `kind:${day}:${messageId}:${k}` })),
      [{ text: "Undo", callback_data: `undo:${day}:${messageId}` }],
    ],
  },
});

async function linkedUser(chatId: number) {
  const { data, error } = await supabase.from("telegram_links").select("user_id, time_zone").eq("chat_id", chatId).maybeSingle();
  if (error) throw error;
  return data ? { userId: data.user_id as string, timeZone: (data.time_zone as string) || "UTC" } : null;
}

// The message's day and time in the user's own time zone.
function localTime(unix: number, timeZone: string) {
  const at = new Date(unix * 1000);
  const format = (tz: string) => ({
    day: new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at),
    time: new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at),
  });
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}

type Attachment = { type: string; file_id: string; file_size: number | null; mime: string; name: string };

const DEFAULT_NAMES: Record<string, string> = {
  photo: "photo.jpg", video: "video.mp4", audio: "audio.mp3", voice: "voice.ogg", video_note: "video.mp4", animation: "animation.mp4", document: "file",
};

// The message's files, each with the name it gets in Drafts/files/ (the same name every time, so an edit finds them).
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

const kindOfSection = (section: string | null) => Object.keys(KINDS).find((k) => DRAFT_SECTIONS[k] === section) ?? null;

// One list item: "- 14:32 text ^tg<id>" (a to-do: "- [ ] text ^tg<id>"), more lines indented under it.
function itemOf(o: { kind: string | null; time: string; text: string; marker: string; checked?: boolean; more: string[] }) {
  const [first = "", ...rest] = o.text.trim().split(/\r?\n/);
  const head = o.kind === "todo" ? `- [${o.checked ? "x" : " "}] ${first}` : `- ${o.time} ${first}`;
  const lines = [...rest, ...o.more].map((l) => l.trim()).filter(Boolean);
  return [`${head.trimEnd()} ^${o.marker}`, ...lines.map((l) => `  ${l}`)].join("\n");
}

function moreOf(msg: any, files: Attachment[]) {
  const forward = forwardOf(msg);
  const more: string[] = [];
  if (forward.from || forward.url) more.push(`— ${[forward.from, forward.url].filter(Boolean).join(" ")}`);
  for (const f of files) {
    more.push(f.file_size && f.file_size > TELEGRAM_FILE_LIMIT ? `(${f.type} over 20 MB, kept in Telegram)` : `![[${f.name}]]`);
  }
  return more;
}

// The parts of an item already in the draft (to change its kind without losing its text).
function parseItem(text: string, marker: string) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trimEnd().endsWith(` ^${marker}`));
  if (start < 0) return null;
  const m = lines[start].trimEnd().slice(0, -` ^${marker}`.length).match(/^- (?:\[( |x)\] )?(?:(\d{2}:\d{2}) )?(.*)$/);
  const more: string[] = [];
  for (let i = start + 1; i < lines.length && /^ {2,}\S/.test(lines[i]); i++) more.push(lines[i].trim());
  return { checked: m?.[1] === "x", time: m?.[2] ?? "", text: m?.[3] ?? "", more };
}

const draftPath = (day: string) => `Drafts/${day}.md`;

const inBackground = (job: Promise<unknown>) => {
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(job);
  else job.catch(console.error);
};

// Copies the message's files from Telegram into Drafts/files/.
async function storeFiles(userId: string, files: Attachment[]) {
  for (const f of files) {
    try {
      if (f.file_size && f.file_size > TELEGRAM_FILE_LIMIT) continue;
      const info = await (await callTelegram("getFile", { file_id: f.file_id })).json();
      if (!info.ok) throw new Error(info.description);
      const file = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${info.result.file_path}`);
      if (!file.ok) throw new Error(`download ${file.status}`);
      await putFile(supabase, userId, `Drafts/files/${f.name}`, await file.arrayBuffer(), f.mime);
    } catch (e) {
      console.error("telegram file:", e);
    }
  }
}

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
  const { day, time } = localTime(msg.date, user.timeZone);
  const files = attachmentsOf(msg, day);
  if (!content.trim() && !files.length) return say(chatId, kind ? `/${kind} your text` : "Nothing to save.");

  const marker = `tg${msg.message_id}`;
  let fresh = false;
  await editNote(supabase, user.userId, draftPath(day), (draft) => {
    fresh = !hasItem(draft, marker); // a retried update is already in the draft: no second ✓
    if (!fresh) return null;
    return addItem(draft, DRAFT_SECTIONS[kind ?? "note"], itemOf({ kind, time, text: content, marker, more: moreOf(msg, files) }));
  });
  if (!fresh) return done();
  if (files.length) inBackground(storeFiles(user.userId, files));

  return answer("sendMessage", {
    chat_id: chatId,
    disable_notification: true,
    reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
    ...receipt(day, msg.message_id, kind),
  });
}

// An edited message updates its item (a command added to the text moves it to that kind).
async function onEdit(msg: any) {
  if (msg.chat.type !== "private") return done();
  const user = await linkedUser(msg.chat.id);
  if (!user) return done();
  const { content, kind } = contentOf(msg);
  const { day, time } = localTime(msg.date, user.timeZone);
  const marker = `tg${msg.message_id}`;
  await editNote(supabase, user.userId, draftPath(day), (draft) => {
    if (!draft || !hasItem(draft, marker)) return null;
    const section = sectionOfItem(draft, marker);
    const old = parseItem(draft, marker);
    const item = itemOf({ kind: kind ?? kindOfSection(section), time, text: content, marker, checked: old?.checked, more: moreOf(msg, attachmentsOf(msg, day)) });
    return kind && DRAFT_SECTIONS[kind] !== section ? addItem(removeItem(draft, marker), DRAFT_SECTIONS[kind], item) : replaceItem(draft, marker, item);
  });
  return done();
}

async function onCallback(cq: any) {
  const [action, day, messageId, kind] = String(cq.data ?? "").split(":");
  const chatId: number | undefined = cq.message?.chat?.id;
  const valid = ["undo", "kind"].includes(action) && DAY.test(day ?? "") && /^\d+$/.test(messageId ?? "");
  const user = chatId && valid ? await linkedUser(chatId) : null;
  if (!user) return answer("answerCallbackQuery", { callback_query_id: cq.id });
  const marker = `tg${messageId}`;
  const sentAt = cq.message?.reply_to_message?.date;

  if (action === "kind" && KINDS[kind]) {
    const saved = await editNote(supabase, user.userId, draftPath(day), (draft) => {
      const old = draft ? parseItem(draft, marker) : null;
      if (!draft || !old) return null;
      const time = old.time || (sentAt ? localTime(sentAt, user.timeZone).time : "");
      return addItem(removeItem(draft, marker), DRAFT_SECTIONS[kind], itemOf({ kind, time, text: old.text, marker, checked: old.checked, more: old.more }));
    });
    if (saved) await callTelegram("editMessageText", { chat_id: chatId, message_id: cq.message.message_id, ...receipt(day, Number(messageId), kind) });
    return answer("answerCallbackQuery", { callback_query_id: cq.id, text: saved ? `${KINDS[kind]} ${kind}` : "Not in the draft any more" });
  }

  const removed = await editNote(supabase, user.userId, draftPath(day), (draft) => (draft && hasItem(draft, marker) ? removeItem(draft, marker) : null));
  if (removed) {
    const { data } = await supabase.from("vault_files").select("path").eq("user_id", user.userId).is("trashed_at", null)
      .like("path", `Drafts/files/${day}-${messageId}-%`);
    for (const f of data ?? []) await trashFile(supabase, user.userId, f.path);
    await callTelegram("editMessageText", { chat_id: chatId, message_id: cq.message.message_id, text: "↩ Removed" });
  }
  return answer("answerCallbackQuery", { callback_query_id: cq.id, text: removed ? "Removed" : "Not in the draft any more" });
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
