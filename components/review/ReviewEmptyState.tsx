'use client';

import Link from 'next/link';

// Honest empty state — surfaces ONLY when localStorage truly has 0 attempts.
// Don't fake "you have N cases waiting" when the student has done nothing
// yet (Iron Rule 0). The CTA points back to /cases so the queue can populate
// on the first attempt.
export function ReviewEmptyState() {
  return (
    <div className="mt-6 rounded-lg border border-dashed border-[var(--color-border-bright)] bg-[var(--color-surface-2)] p-6 sm:p-10 text-center">
      <div aria-hidden className="text-3xl sm:text-4xl mb-3">
        🧭
      </div>
      <h2 className="text-base sm:text-lg font-semibold text-[var(--color-text)] mb-1.5">
        Your review queue is empty
      </h2>
      <p className="text-sm text-[var(--color-text-muted)] max-w-md mx-auto mb-4 leading-relaxed">
        Start any case to begin building your queue. We&rsquo;ll bring it back here
        when it&rsquo;s time to review.
      </p>
      <Link
        href="/cases"
        className="imaging-btn imaging-btn-primary text-sm"
      >
        Browse cases →
      </Link>
    </div>
  );
}
