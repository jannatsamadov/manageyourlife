// A vault note as the reader sees it: Markdown + tables + task lists + math (KaTeX), Obsidian [[links]] / ![[embeds]].
import { useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { isImage, isNote } from "@/lib/vault";
import "./vault.css";

const label = (s: string) => s.trim().replace(/[[\]]/g, "\\$&");
const wiki = (target: string) => `wiki:${encodeURIComponent(target.trim())}`;

// Obsidian syntax → Markdown that react-markdown reads; vault targets travel as "wiki:" addresses.
function toMarkdown(text: string) {
  return text
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "") // frontmatter: its tags show above the note
    .replace(/!\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g, (_, target: string, size?: string) =>
      isImage(target) ? `![${/^\d+(x\d+)?$/.test(size ?? "") ? size : ""}](${wiki(target)})` : `[${label(target)}](${wiki(target)})`)
    .replace(/\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g, (_, target: string, heading?: string, alias?: string) =>
      `[${label(alias ?? target + (heading ?? ""))}](${wiki(target)})`);
}

// A link inside the vault: "wiki:" address or a relative path.
const vaultTarget = (url: string) => {
  if (url.startsWith("wiki:")) return decodeURIComponent(url.slice(5));
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("#")) return null;
  try { return decodeURIComponent(url); } catch { return url; }
};

export default function Markdown({ text, resolve, urls, onOpen }: {
  text: string;
  resolve: (target: string) => string | null;
  urls: Record<string, string>;
  onOpen: (path: string) => void;
}) {
  const md = useMemo(() => toMarkdown(text), [text]);
  return (
    <div className="vault-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(url) => (url.startsWith("wiki:") ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href = "", children }) => {
            const target = vaultTarget(href);
            if (target === null) return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
            const path = resolve(target);
            if (path && isNote(path)) return <button type="button" onClick={() => onOpen(path)} className="vault-md__link">{children}</button>;
            if (path && urls[path]) return <a href={urls[path]} target="_blank" rel="noreferrer">{children}</a>;
            return <span className="vault-md__missing">{children}</span>;
          },
          img: ({ src = "", alt = "" }) => {
            const target = vaultTarget(src);
            if (target === null) return <img src={src} alt={alt} loading="lazy" />;
            const path = resolve(target);
            const width = /^\d+/.exec(alt)?.[0];
            if (path && urls[path]) return <img src={urls[path]} alt={target} loading="lazy" style={width ? { width: Number(width) } : undefined} />;
            return <span className="vault-md__missing">{target}</span>;
          },
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}
