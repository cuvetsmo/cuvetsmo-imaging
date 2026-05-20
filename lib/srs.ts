// ============================================================================
// lib/srs.ts
// ============================================================================
// Spaced-repetition scheduling for the imaging lab.
//
// Day 1 implementation uses a Leitner-style 4-bucket schedule (NOT full SM-2)
// because (a) the underlying signal is a coarse 1–5 confidence self-score,
// not a 0–5 grade with separate timing data, and (b) Leitner's behavior is
// easier to explain in UI ("you'll see this again tomorrow"). When we wire to
// Supabase + collect more signal (time-to-reveal, review streak, gap-since-
// last-shown), we can swap this for SM-2 without touching the route.
//
// Algorithm — input is the per-slug AttemptRecord from cuvi-attempts-v1
// localStorage. Output is a `ReviewItem` per case with priority + reason +
// next-review timestamp.
//
//   Bucket 1 — NEW              : never attempted          → review NOW
//   Bucket 2 — LOW CONFIDENCE   : score < 3 OR not revealed → review +1 day
//   Bucket 3 — MID CONFIDENCE   : score 3 or 4              → review +3 days
//   Bucket 4 — HIGH CONFIDENCE  : score 5                   → review +7 days
//
// Priority is purely a function of "is `now` past the next-review timestamp?"
// HIGH  = due (or never seen)
// MID   = due-soon (within 24 h)
// LOW   = cooldown
//
// The schedule is intentionally simple and pure — given the same `now` and
// the same store, it returns the same ordering. Easy to unit-test.
// ============================================================================

import type { ImagingCase } from "./cases";

// ── localStorage shape — mirrors CaseDetailView's AttemptRecord ──
// (Kept independent so a refactor in CaseDetailView doesn't silently break
// this module. If the schema changes, bump both and migrate.)
export type AttemptRecord = {
  notes: string;
  confidence: 1 | 2 | 3 | 4 | 5;
  revealedAt: string | null; // ISO timestamp, null if user never tapped "reveal"
  lastEditedAt: string; // ISO of last edit
};

export type AttemptStore = Record<string, AttemptRecord>;

export const ATTEMPTS_KEY = "cuvi-attempts-v1";

// ── output shape ────────────────────────────────────────────────────────────
export type Bucket = 1 | 2 | 3 | 4;

export type ReviewPriority = "high" | "mid" | "low";

export type ReviewReason =
  | "new" // never attempted
  | "low-confidence" // bucket 2 — got it wrong last time
  | "review-due" // bucket 3 or 4, due
  | "review-soon" // bucket 3 or 4, due within 24 h
  | "cooldown"; // not yet due

export type ReviewItem = {
  caseSlug: string;
  caseId: string;
  bucket: Bucket;
  priority: ReviewPriority;
  reason: ReviewReason;
  reasonLabel: string; // short human label for the UI badge
  // Milliseconds since epoch — exposed so the UI can sort or show "in 3 days".
  nextReviewAt: number;
  // Last attempt timestamp (revealedAt || lastEditedAt) or null if never seen.
  lastSeenAt: number | null;
  // Last confidence score, or null if never attempted.
  lastConfidence: 1 | 2 | 3 | 4 | 5 | null;
};

// ── interval constants (in milliseconds) ───────────────────────────────────
const DAY = 24 * 60 * 60 * 1000;

export const BUCKET_INTERVAL_MS: Record<Bucket, number> = {
  1: 0, // new → review immediately
  2: 1 * DAY, // low confidence → tomorrow
  3: 3 * DAY, // mid confidence → 3 days
  4: 7 * DAY, // high confidence → 7 days
};

// ── pure scheduler ──────────────────────────────────────────────────────────

/**
 * Decide which bucket a single attempt belongs in. Pure — no clock dependency.
 *
 *   - never attempted    → 1 (NEW)
 *   - never revealed     → 2 (treat as "didn't commit to an answer")
 *   - confidence < 3     → 2 (LOW)
 *   - confidence 3 or 4  → 3 (MID)
 *   - confidence 5       → 4 (HIGH)
 */
export function bucketOf(prior: AttemptRecord | undefined): Bucket {
  if (!prior) return 1;
  if (!prior.revealedAt) return 2;
  const c = prior.confidence;
  if (c < 3) return 2;
  if (c < 5) return 3;
  return 4;
}

/**
 * Compute the next review timestamp (ms since epoch) for an attempt. Anchors
 * to `revealedAt` when present (the moment the answer was shown), otherwise
 * to `lastEditedAt`, otherwise to 0 (so never-attempted items are always due).
 */
export function nextReviewAt(prior: AttemptRecord | undefined): number {
  if (!prior) return 0;
  const anchor = prior.revealedAt ?? prior.lastEditedAt;
  const t = anchor ? Date.parse(anchor) : NaN;
  if (Number.isNaN(t)) return 0;
  return t + BUCKET_INTERVAL_MS[bucketOf(prior)];
}

/**
 * Classify a case into a `ReviewItem` given the current store and clock.
 * Pure — given the same inputs returns the same output. The route passes
 * `now = Date.now()` once for the whole list so all items share a clock.
 */
export function classify(
  caseEntry: Pick<ImagingCase, "id" | "slug">,
  store: AttemptStore,
  now: number,
): ReviewItem {
  const prior = store[caseEntry.slug];
  const bucket = bucketOf(prior);
  const due = nextReviewAt(prior);
  const lastSeenAt = prior
    ? Date.parse(prior.revealedAt ?? prior.lastEditedAt) || null
    : null;
  const lastConfidence = prior?.confidence ?? null;

  let reason: ReviewReason;
  let priority: ReviewPriority;
  let reasonLabel: string;

  if (!prior) {
    reason = "new";
    priority = "high";
    reasonLabel = "New";
  } else if (bucket === 2) {
    reason = "low-confidence";
    priority = "high";
    reasonLabel = prior.revealedAt
      ? "Low confidence last time"
      : "Unfinished — needs another look";
  } else if (now >= due) {
    reason = "review-due";
    priority = "mid";
    reasonLabel = "Time to review";
  } else if (due - now <= DAY) {
    reason = "review-soon";
    priority = "mid";
    reasonLabel = "Due within 24h";
  } else {
    reason = "cooldown";
    priority = "low";
    const daysLeft = Math.max(1, Math.round((due - now) / DAY));
    reasonLabel = daysLeft === 1 ? "Cooldown · 1 day" : `Cooldown · ${daysLeft} days`;
  }

  return {
    caseSlug: caseEntry.slug,
    caseId: caseEntry.id,
    bucket,
    priority,
    reason,
    reasonLabel,
    nextReviewAt: due,
    lastSeenAt,
    lastConfidence,
  };
}

/**
 * Build the prioritized review queue for the whole catalog.
 *
 * Ordering:
 *   1. HIGH priority first (new + low-confidence). Within HIGH,
 *      low-confidence outranks new so struggling cases don't drown in the
 *      tail of an untouched library.
 *   2. MID priority next (due / due-soon). Earliest nextReviewAt first.
 *   3. LOW priority last (cooldown), ordered by `nextReviewAt` ascending —
 *      the next thing the student will see when they finish the queue.
 */
export function buildQueue(
  cases: ReadonlyArray<Pick<ImagingCase, "id" | "slug" | "title">>,
  store: AttemptStore,
  now: number = Date.now(),
): ReviewItem[] {
  const items = cases.map((c) => classify(c, store, now));

  const prioRank: Record<ReviewPriority, number> = { high: 0, mid: 1, low: 2 };
  // Within HIGH: low-confidence (1) ranks above new (0). The intuition is
  // "fix what you got wrong before learning something new."
  const highRank: Record<ReviewReason, number> = {
    "low-confidence": 0,
    new: 1,
    "review-due": 2,
    "review-soon": 3,
    cooldown: 4,
  };

  return items.sort((a, b) => {
    const pa = prioRank[a.priority];
    const pb = prioRank[b.priority];
    if (pa !== pb) return pa - pb;
    if (a.priority === "high") {
      return highRank[a.reason] - highRank[b.reason];
    }
    // For MID and LOW, soonest due first.
    return a.nextReviewAt - b.nextReviewAt;
  });
}

// ── defensive localStorage read ─────────────────────────────────────────────
// Mirrors the read-side from CaseDetailView. Safe to call during SSR (returns
// empty store on the server) and resilient to corrupted JSON.
export function readAttempts(): AttemptStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ATTEMPTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as AttemptStore;
    }
  } catch {
    /* corrupt JSON / private mode / quota exceeded — start clean */
  }
  return {};
}

// ── pretty-print helpers (used by the queue card) ──────────────────────────
export function relativeTime(ms: number, now: number = Date.now()): string {
  const delta = now - ms;
  const abs = Math.abs(delta);
  if (abs < 60_000) return delta >= 0 ? "just now" : "in a moment";
  const minutes = Math.round(abs / 60_000);
  if (minutes < 60) return delta >= 0 ? `${minutes}m ago` : `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return delta >= 0 ? `${hours}h ago` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  if (delta >= 0) return days === 1 ? "yesterday" : `${days}d ago`;
  return days === 1 ? "tomorrow" : `in ${days}d`;
}
