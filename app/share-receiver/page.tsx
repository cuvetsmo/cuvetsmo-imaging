import type { Metadata } from "next";
import { Suspense } from "react";
import ShareReceiverClient from "./ShareReceiverClient";

export const metadata: Metadata = {
  title: "รับไฟล์จาก Share",
  description:
    "Receive DICOM files shared from other apps (Android Chrome / Edge). Runs the bulk-import pipeline locally — files stay on device.",
  // Don't index — this is a transient landing page, not content.
  robots: { index: false, follow: false },
};

// `useSearchParams()` inside ShareReceiverClient triggers Next's
// client-only-bailout requirement (App Router contract). Wrap in a
// Suspense fallback so the static prerender doesn't crash — the
// fallback shape matches the receiver's own progress panel so the
// pre-paint doesn't flash a different layout before hydration.
function ShareReceiverFallback() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-faint)]">
          PWA Share Target
        </p>
        <h1 className="mt-2 text-2xl sm:text-3xl font-semibold text-[var(--color-text)]">
          รับไฟล์ DICOM
        </h1>
      </header>
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border border-[var(--color-border)] bg-black/30 p-5 sm:p-6"
      >
        <p className="text-sm text-[var(--color-text-muted)]">
          กำลังเตรียม...
        </p>
      </div>
    </div>
  );
}

export default function ShareReceiverPage() {
  return (
    <Suspense fallback={<ShareReceiverFallback />}>
      <ShareReceiverClient />
    </Suspense>
  );
}
