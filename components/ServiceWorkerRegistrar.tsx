"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js on the client side. The SW exists ONLY to intercept
 * POST /share-receiver (PWA Share Target API) — we are NOT doing
 * offline caching of static assets (Vercel CDN handles that, and a SW
 * cache layer would just create staleness bugs).
 *
 * Registration rules:
 *  - Only when `navigator.serviceWorker` is available (Chrome/Edge/FF/
 *    Safari 11.1+). Older browsers no-op silently.
 *  - `updateViaCache: 'imports'` — the sw.js script itself ignores HTTP
 *    cache (always re-fetched on update), but its `importScripts()`
 *    calls (none today, but future-proof) do respect cache.
 *  - We don't push update prompts on the page — the SW skipWaiting()
 *    on install + claim on activate handle the transition without
 *    user-visible interruption.
 *
 * Side-effect contract: this component renders nothing. It exists
 * purely for the useEffect side-effect. Mount it in the root layout
 * once, near `<body>`.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Don't try to register during local `next dev` HMR runs when the
    // dev server doesn't actually serve /sw.js — registration would 404
    // and emit a confusing console warning every reload. (Production
    // and `next start` both serve /sw.js from public/, so this guard is
    // a no-op there.)
    if (
      typeof window !== "undefined" &&
      window.location.hostname === "localhost" &&
      process.env.NODE_ENV !== "production"
    ) {
      // Still attempt — if it works (next dev DOES serve public/), great.
      // The `.catch` below swallows the 404 quietly if not.
    }

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", {
          scope: "/",
          updateViaCache: "imports",
        })
        .catch((err) => {
          // Swallow — share target is non-critical, app works without it.
          console.warn("[sw] register failed:", err?.message ?? err);
        });
    };

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  return null;
}
