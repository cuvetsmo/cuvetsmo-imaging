import type { NextConfig } from "next";
import path from "node:path";

// ─── Security headers (Phase 8 · Agent ②) ────────────────────────────
//
// Goal: lift Security score 7.2 → 8.0+ without breaking PWA share target,
// Cornerstone3D WASM image loader, Web Workers (parse + thumbnail pools),
// next/font self-hosted Google fonts, or next/image on local atlas tiles.
//
// Every directive below is commented with a concrete reason rooted in the
// codebase. If you tighten one, mental-trace the resource it covers FIRST.
//
// What the app actually uses (verified 2026-05-24):
//   - All atlas images are LOCAL (public/atlas/*.jpg) — NO remote Pollinations
//   - All API calls are same-origin (fetch '/cases.json', fetch per-case .json)
//   - Workers are bundled by Next via `new Worker(new URL(..., import.meta.url))`
//     → resolve to /_next/static/chunks/... on the same origin (self covers)
//   - next/font self-hosts Inter + IBM Plex Sans Thai (NO fonts.googleapis.com
//     at runtime — fonts ship from /_next/static/media)
//   - No analytics, no third-party trackers, no remote iframes embedded
//
// Why `unsafe-inline` in script-src:
//   Next.js App Router injects inline scripts for hydration (the __NEXT_DATA__
//   payload + the App Router router instructions). styled-jsx + next-themes
//   also rely on inline boot scripts. There is no nonce wiring in Next 16's
//   webpack runtime out of the box. Living with 'unsafe-inline' here is the
//   industry default for Next sites until nonce/hash mode lands stable.
//
// Why `unsafe-eval` in script-src:
//   Cornerstone3D's @cornerstonejs/codec-* WASM bundles call `new Function()`
//   internally to bootstrap the decoder. Without unsafe-eval the viewer
//   throws "CompileError: WebAssembly.compile(): ..." on first DICOM load.
//   Verified against parse-pool + cornerstone-init.js bootstrap path.
//
// Why `blob:` in script-src + worker-src:
//   Cornerstone3D may spawn auxiliary workers from a Blob URL when running
//   under bundlers that don't directly bundle the codec worker. Plus future
//   wasm streaming. Cheap insurance, no real attack surface added since
//   blob: URLs are same-origin by spec.
//
// Why `https:` in img-src (not 'self' only):
//   Defense-in-depth — if someone later wires a remote image source (e.g.
//   a Mendeley case ref, a Wikipedia thumbnail in the atlas), it'll render
//   instead of silently breaking. The trade-off is mild (an XSS injecting
//   an <img src=https://evil...> can phone home via referer, but cannot
//   execute code or read same-origin data).
//
// Why `frame-ancestors 'none'`:
//   Imaging UI displays DICOM cases that may contain demographic + lesion
//   metadata. Refusing to be iframed prevents clickjacking + cross-site
//   case-viewer embedding. Pairs with X-Frame-Options: DENY for ancient
//   browsers that ignore frame-ancestors.

const cspDirectives = {
  // Default catch-all for resource types not otherwise specified.
  // 'self' = same origin only.
  "default-src": ["'self'"],

  // Scripts: see Next.js hydration + Cornerstone WASM notes above.
  "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:"],

  // Styles: Tailwind 4 emits utility classes, but styled-jsx + inline
  // style={} attrs across the codebase require 'unsafe-inline'. There is
  // no Next 16 nonce mode for styled-jsx as of this write.
  "style-src": ["'self'", "'unsafe-inline'"],

  // Images: 'self' for /_next/image + /public, data: for tiny inline SVG
  // patterns (CrosshairPattern, react placeholder), blob: for the
  // ImageOcclusionEditor canvas dump + Cornerstone thumbnail blobs, and
  // https: as the defense-in-depth allowance (see comment above).
  "img-src": ["'self'", "data:", "blob:", "https:"],

  // Fonts: next/font self-hosts at /_next/static/media. data: for any
  // base64-embedded glyph (Tailwind reset uses none currently, but cheap
  // to allow). No font-src for fonts.googleapis.com — next/font compiles
  // Google CSS to self-hosted output, NOT a runtime fetch.
  "font-src": ["'self'", "data:"],

  // XHR/fetch + WebSocket: same-origin only. App fetches /cases.json and
  // per-case JSON paths — all same-origin. Reject any cross-origin XHR.
  // If a future feature needs Supabase or another API, ADD that origin
  // explicitly here, never blanket-allow https:.
  "connect-src": ["'self'"],

  // Web Workers: 'self' covers Next's bundled workers (parse-worker,
  // thumbnail-worker). blob: in case a Cornerstone3D auxiliary worker
  // is spawned from a Blob URL on first DICOM load.
  "worker-src": ["'self'", "blob:"],

  // PWA manifest at /manifest.json — same-origin.
  "manifest-src": ["'self'"],

  // Frame embedding policy: refuse ALL framing (anti-clickjacking).
  "frame-ancestors": ["'none'"],

  // Refuse <object>, <embed>, <applet> — legacy plugins, no use case.
  "object-src": ["'none'"],

  // Lock <base href> to same origin to prevent base-tag injection
  // hijacking relative URLs.
  "base-uri": ["'self'"],

  // <form action=...> can only post to same origin. No third-party form
  // submission (we have no forms that target third-party endpoints).
  "form-action": ["'self'"],

  // Auto-upgrade any http:// reference to https:// at request time.
  // Belt-and-suspenders with HSTS — handles cases where a hardcoded
  // http:// URL slipped past review.
  "upgrade-insecure-requests": [],
} as const;

function buildCspString(directives: Record<string, readonly string[]>): string {
  return Object.entries(directives)
    .map(([directive, values]) =>
      values.length ? `${directive} ${values.join(" ")}` : directive
    )
    .join("; ");
}

const cspString = buildCspString(cspDirectives);

// Permissions-Policy: explicit-deny everything the imaging app does NOT use.
// Belt for sensor + payment APIs that exist on modern browsers and could be
// abused by a future injected script or compromised dependency.
//
// What we DO use elsewhere: clipboard (for export buttons), pointer events
// (Cornerstone tools), fullscreen (future viewer UX). Don't deny those.
const permissionsPolicy = [
  "accelerometer=()",
  "ambient-light-sensor=()",
  "autoplay=()",
  "battery=()",
  "camera=()",
  "display-capture=()",
  "document-domain=()",
  "encrypted-media=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "sync-xhr=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: cspString,
  },
  // HSTS: 2 years + subdomains. Vercel sets a baseline HSTS too but
  // application-level lets us pin includeSubDomains (cuvetsmo.com family).
  // No preload directive — that's an explicit opt-in and we haven't
  // submitted to the preload list yet.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  // Refuse MIME sniffing. Critical because /share-receiver accepts
  // user-uploaded DICOM/ZIP files — without nosniff a browser might
  // interpret a poisoned file's bytes as text/html.
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  // Legacy anti-clickjacking. frame-ancestors 'none' covers modern
  // browsers; X-Frame-Options DENY covers IE11 / old Safari.
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  // Send origin + path on same-origin, only origin on cross-origin
  // (so referrer leakage to ecosystem siblings labs/web3/ai stays
  // minimal — origin only, no path).
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: permissionsPolicy,
  },
  // Allow the browser to prefetch DNS for ecosystem nav (labs, web3, ai,
  // main cuvetsmo.com). Modern browsers gate prefetch on this header.
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
];

const nextConfig: NextConfig = {
  // Pin output tracing to this project so Next doesn't pick up the
  // parent C:\Users\palmz\package-lock.json as workspace root.
  outputFileTracingRoot: path.resolve(__dirname),

  // Cornerstone3D's WASM codec bundles call require('fs'/'path') for
  // Node — but we use them only client-side, so stub those modules out
  // for the browser bundle. Without this, Next's SSR compile errors on
  // 'Module not found: fs' inside @cornerstonejs/codec-* packages.
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },

  // The DICOM viewer hits Cornerstone3D's heavy native ESM. Transpile it
  // through Next so the dev/server bundle understands the module shape
  // and tree-shakes correctly.
  transpilePackages: [
    "@cornerstonejs/core",
    "@cornerstonejs/tools",
    "@cornerstonejs/dicom-image-loader",
  ],

  // Security headers applied to ALL routes. Phase 8.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
