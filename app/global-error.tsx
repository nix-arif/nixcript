"use client";

import { useEffect } from "react";

// Only fires if the ROOT layout itself throws (very rare — root layout does
// no data-fetching). Must render its own <html>/<body> since it replaces the
// entire tree, including the root layout, when triggered.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: 16, padding: 24, textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</h2>
          <p style={{ fontSize: 14, color: "#666", maxWidth: 360 }}>
            The application failed to load. Please try again.
          </p>
          {error.digest && (
            <p style={{ fontSize: 11, color: "#999", fontFamily: "monospace" }}>Ref: {error.digest}</p>
          )}
          <button
            onClick={reset}
            style={{ height: 32, padding: "0 12px", borderRadius: 6, background: "#111", color: "#fff", fontSize: 14, border: "none", cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
