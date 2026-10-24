// Notes as files (P-21): the user's vault is in R2 under users/<id>/vault/ (the laptop keeps it in step with rclone
// bisync). This function is the app's only way in: index the files (scan), read, write with a version check, move to
// the trash, signed links for attachments. vault_files is only an index of the files, rebuilt from R2.
import { AwsClient } from "npm:aws4fetch@1.0.20";
import { cors, db, json, userFrom } from "../_shared/google.ts";

const env = (k: string) => Deno.env.get(k)!;
const r2 = new AwsClient({ accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY"), service: "s3", region: "auto" });
const BUCKET = `${env("R2_ENDPOINT")}/${env("R2_BUCKET")}`;

class BadInput extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

// S3 wants every byte outside A-Z a-z 0-9 - _ . ~ percent-encoded; "/" separates the parts.
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodeKey = (key: string) => key.split("/").map(rfc3986).join("/");
const objectUrl = (key: string) => `${BUCKET}/${encodeKey(key)}`;
const unquote = (etag: string | null) => (etag ?? "").replaceAll('"', "");
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
    ENTITIES[e.toLowerCase()] ?? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));

function check<T>(r: { data: T; error: { message: string } | null }) {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

// A path inside the vault: forward slashes, no empty / "." / ".." parts.
function cleanPath(p: unknown) {
  if (typeof p !== "string") throw new BadInput("path: text");
  const path = p.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!path || path.length > 1024 || path.split("/").some((s) => !s || s === "." || s === "..")) throw new BadInput("path: not a vault path");
  return path;
}

const isNote = (path: string) => /\.md$/i.test(path);
const fileName = (path: string) => path.split("/").pop()!;

type Obj = { path: string; etag: string; size: number; modified: string };

async function list(prefix: string) {
  const out: Obj[] = [];
  let token = "";
  do {
    const q = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000" });
    if (token) q.set("continuation-token", token);
    const res = await r2.fetch(`${BUCKET}?${q}`);
    if (!res.ok) throw new Error(`R2 list ${res.status}: ${await res.text()}`);
    const xml = await res.text();
    for (const [, item] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const get = (tag: string) => unxml(item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? "");
      const key = get("Key");
      if (!key.endsWith("/")) out.push({ path: key.slice(prefix.length), etag: unquote(get("ETag")), size: Number(get("Size")), modified: get("LastModified") });
    }
    token = unxml(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? "");
  } while (token);
  return out;
}

async function getText(key: string) {
  const res = await r2.fetch(objectUrl(key));
  if (res.status === 404) throw new BadInput("not found", 404);
  if (!res.ok) throw new Error(`R2 get ${res.status}`);
  return { text: await res.text(), etag: unquote(res.headers.get("etag")) };
}

// What the index keeps of a note: tags (frontmatter + #tags outside code), [[links]] / ![[embeds]], to-dos, the text.
function parse(text: string) {
  const tags = new Set<string>();
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const block = fm?.[1].match(/^tags:[ \t]*(.*)((?:\r?\n[ \t]*-[ \t]*.*)*)/m);
  if (block) {
    const inline = block[1].replace(/[[\]"']/g, "").split(/[,\s]+/);
    const items = [...block[2].matchAll(/-[ \t]*(.+)/g)].map((m) => m[1].replace(/["']/g, "").trim());
    for (const t of [...inline, ...items]) if (t) tags.add(t.replace(/^#/, ""));
  }
  const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  for (const [, t] of prose.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) if (!/^\d+$/.test(t)) tags.add(t);
  const links = new Set([...text.matchAll(/!?\[\[([^\]|#^\n]+)/g)].map((m) => m[1].trim()).filter(Boolean));
  return {
    tags: [...tags],
    links: [...links],
    todo_open: (text.match(/^[ \t]*[-*+] \[ \]/gm) ?? []).length,
    todo_done: (text.match(/^[ \t]*[-*+] \[[xX]\]/gm) ?? []).length,
  };
}

function indexRow(userId: string, o: Obj, text: string | null) {
  return {
    user_id: userId,
    path: o.path,
    etag: o.etag,
    size: o.size,
    modified_at: o.modified,
    title: isNote(o.path) ? fileName(o.path).replace(/\.md$/i, "") : fileName(o.path),
    ...(text === null ? { tags: [], links: [], todo_open: 0, todo_done: 0 } : parse(text)),
    body: text,
    indexed_at: new Date().toISOString(),
  };
}

async function pool<T, R>(items: T[], size: number, f: (x: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i]);
    }
  }));
  return out;
}

// Index ← R2: changed files (by ETag) are read again, vanished ones dropped.
async function scan(userId: string, prefix: string) {
  const known = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const page = check(await db.from("vault_files").select("path, etag").eq("user_id", userId).order("path").range(from, from + 999));
    page.forEach((r: { path: string; etag: string }) => known.set(r.path, r.etag));
    if (page.length < 1000) break;
  }
  const objects = await list(prefix);
  const changed = objects.filter((o) => known.get(o.path) !== o.etag);
  const rows = await pool(changed, 16, async (o) => indexRow(userId, o, isNote(o.path) ? (await getText(prefix + o.path)).text : null));
  for (let i = 0; i < rows.length; i += 100) check(await db.from("vault_files").upsert(rows.slice(i, i + 100)));
  const seen = new Set(objects.map((o) => o.path));
  const gone = [...known.keys()].filter((p) => !seen.has(p));
  for (let i = 0; i < gone.length; i += 100) {
    check(await db.from("vault_files").delete().eq("user_id", userId).in("path", gone.slice(i, i + 100)));
  }
  return { files: objects.length, updated: rows.length, removed: gone.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const user = await userFrom(req);
    if (!user) return json({ error: "Not signed in" }, 401);
    const body = await req.json().catch(() => ({}));
    const prefix = `users/${user.id}/vault/`;

    switch (body.action) {
      case "scan":
        return json(await scan(user.id, prefix));

      case "read": {
        const path = cleanPath(body.path);
        return json({ path, ...(await getText(prefix + path)) });
      }

      // Saves only over the version the user started from (etag; null = a new file), else { conflict }.
      case "write": {
        const path = cleanPath(body.path);
        if (!isNote(path)) throw new BadInput("only .md notes can be written");
        if (typeof body.text !== "string" || body.text.length > 2_000_000) throw new BadInput("text: up to 2 MB");
        const head = await r2.fetch(objectUrl(prefix + path), { method: "HEAD" });
        if (!head.ok && head.status !== 404) throw new Error(`R2 head ${head.status}`);
        const current = head.ok ? unquote(head.headers.get("etag")) : null;
        if ((body.etag ?? null) !== current) return json({ conflict: true, etag: current });
        const put = await r2.fetch(objectUrl(prefix + path), {
          method: "PUT",
          body: body.text,
          // rclone reads the modification time from this header, so the laptop copy gets the right time.
          headers: { "Content-Type": "text/markdown; charset=utf-8", "x-amz-meta-mtime": (Date.now() / 1000).toFixed(3) },
        });
        if (!put.ok) throw new Error(`R2 put ${put.status}`);
        const o = { path, etag: unquote(put.headers.get("etag")), size: new TextEncoder().encode(body.text).length, modified: new Date().toISOString() };
        check(await db.from("vault_files").upsert(indexRow(user.id, o, body.text)));
        return json({ path, etag: o.etag });
      }

      // Deleting = moving to users/<id>/trash/vault/<time>/<path>; the laptop gets the deletion at the next sync and keeps
      // its copy in its own trash.
      case "trash": {
        const path = cleanPath(body.path);
        const dest = `users/${user.id}/trash/vault/${new Date().toISOString().replace(/[:.]/g, "-")}/${path}`;
        const copy = await r2.fetch(objectUrl(dest), {
          method: "PUT",
          headers: { "x-amz-copy-source": `/${env("R2_BUCKET")}/${encodeKey(prefix + path)}` },
        });
        if (copy.status === 404) throw new BadInput("not found", 404);
        if (!copy.ok) throw new Error(`R2 copy ${copy.status}`);
        const del = await r2.fetch(objectUrl(prefix + path), { method: "DELETE" });
        if (!del.ok) throw new Error(`R2 delete ${del.status}`);
        check(await db.from("vault_files").delete().eq("user_id", user.id).eq("path", path));
        return json({ path, trashed: true });
      }

      // Short-lived links to show attachments (images, PDFs) in the app.
      case "urls": {
        const paths = (Array.isArray(body.paths) ? body.paths : []).slice(0, 100).map(cleanPath);
        const urls: Record<string, string> = {};
        for (const p of paths) {
          urls[p] = (await r2.sign(`${objectUrl(prefix + p)}?X-Amz-Expires=3600`, { aws: { signQuery: true } })).url;
        }
        return json({ urls });
      }

      default:
        throw new BadInput("action: scan, read, write, trash or urls");
    }
  } catch (e) {
    if (e instanceof BadInput) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
