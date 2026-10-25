// Notes as files (P-21, P-57) for the app: index, read, write with a version check, move / rename, trash, restore,
// delete for good, signed links to attachments, and the note ↔ task to-do sync. The work is in _shared/vault.ts.
import { cors, db, json, userFrom } from "../_shared/google.ts";
import {
  cleanPath, moveFile, purgeFile, readNote, restoreFile, scan, setTodo, signedUrls, syncTodos, toggleTodo, trashFile, VaultError, writeNote, noteById,
} from "../_shared/vault.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const user = await userFrom(req);
    if (!user) return json({ error: "Not signed in" }, 401);
    const body = await req.json().catch(() => ({}));
    const uid = user.id;

    switch (body.action) {
      case "scan":
        return json(await scan(db, uid));
      case "read":
        return json(await readNote(db, uid, cleanPath(body.path)));
      case "write": {
        if (typeof body.text !== "string") throw new VaultError("text: string");
        return json(await writeNote(db, uid, body.path, body.text, body.etag ?? null));
      }
      case "move":
        return json(await moveFile(db, uid, body.from, body.to));
      case "trash":
        return json(await trashFile(db, uid, body.path));
      case "restore":
        return json(await restoreFile(db, uid, body.id));
      case "purge":
        return json(await purgeFile(db, uid, body.id));
      case "urls": {
        const paths = (Array.isArray(body.paths) ? body.paths : []).slice(0, 100).map(cleanPath);
        return json({ urls: await signedUrls(uid, paths) });
      }
      // After a task was linked: its subtasks follow the note's to-dos.
      case "sync_todos": {
        const { path } = await noteById(db, uid, body.note_id);
        const note = await readNote(db, uid, path);
        await syncTodos(db, uid, note.id!, note.text);
        return json({ ok: true });
      }
      case "toggle_todo": {
        if (typeof body.title !== "string" || typeof body.completed !== "boolean") throw new VaultError("title, completed");
        await toggleTodo(db, uid, body.note_id, body.title, body.completed);
        return json({ ok: true });
      }
      // The Tasks page: a to-do line of any note, by line number + text.
      case "set_todo": {
        if (!Number.isInteger(body.line) || typeof body.text !== "string" || typeof body.done !== "boolean") throw new VaultError("line, text, done");
        await setTodo(db, uid, body.path, body.line, body.text, body.done);
        return json({ ok: true });
      }
      default:
        throw new VaultError("unknown action");
    }
  } catch (e) {
    if (e instanceof VaultError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
