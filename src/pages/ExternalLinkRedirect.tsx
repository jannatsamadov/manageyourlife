import { useEffect } from "react";

export default function ExternalLinkRedirect() {
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get("to");

    try {
      const url = new URL(target || "");
      if (url.protocol === "http:" || url.protocol === "https:") {
        window.location.replace(url.toString());
      }
    } catch {
      window.close();
    }
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-center text-sm text-muted-foreground">
      Link açılır...
    </div>
  );
}