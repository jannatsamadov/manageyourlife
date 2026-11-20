// How a captured message becomes an item's title / text / link (shared by Telegram, MCP and the app's tests; no imports).
const URL_RE = /https?:\/\/[^\s<>()"']+/i;

// Title = the first line (long ones cut at a word, the whole text then goes to the body); the rest + extra lines =
// the body; the first link = the item's link.
export function captureParts(text: string, more: string[] = [], fallbackTitle = "Capture") {
  const clean = text.replace(/\r\n/g, "\n").trim();
  const [first = "", ...rest] = clean.split("\n");
  let title = first.trim();
  let lines = rest;
  if (title.length > 200) {
    const cut = title.slice(0, 160);
    title = `${cut.slice(0, cut.lastIndexOf(" ") > 80 ? cut.lastIndexOf(" ") : 160)}…`;
    lines = clean.split("\n");
  }
  const body = [...lines, ...more].map((l) => l.trimEnd()).join("\n").trim().slice(0, 100000);
  const url = clean.match(URL_RE)?.[0] ?? more.join(" ").match(URL_RE)?.[0] ?? null;
  return { title: title || fallbackTitle, body, url: url && url.length <= 2000 ? url : null };
}
