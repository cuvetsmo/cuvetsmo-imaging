"use client";

// ProgressView — local-only dashboard that aggregates the student's
// activity from localStorage. NO server calls · NO account · NO PHI.
// If localStorage is wiped or the browser is private, the dashboard
// shows zeros — that's the honest state for a privacy-respecting tool.
//
// Phase 22 cohesion upgrade:
//   - Animated count-up on stat numbers (matches Quiz pattern)
//   - 7-day sparkline of quiz activity (Sparkline component)
//   - Activity logging timestamps now propagate from QuizView
//
// Sources of truth:
//   - cuvi-attempts-v1        (Active Recall attempts · CaseDetailView)
//   - cuvi-quiz-v1            (anatomy quiz score + streak · QuizView)
//   - cuvi-quiz-history-v1    (per-day quiz log · QuizView Phase 22)
//   - cuvi-atlas-filters-v1   (filter activity proxy · AtlasGrid)
//   - cuvi-tour-completed-v1  (onboarding flag · LabHome)
//
// Each metric block degrades to "—" / "no data yet" when no data is
// present (no over-claiming "you've completed N cases" when nothing
// happened — Iron Rule 0 carries through the UI).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkline } from "./Sparkline";

type Stats = {
  attemptsCount: number;
  attemptsRecentSlugs: string[];
  quizAsked: number;
  quizCorrect: number;
  quizStreak: number;
  quizBest: number;
  /** 7-day sparkline data (oldest → newest). */
  quizSparkline: number[];
  /** 7-day correct % sparkline (0–100). */
  quizAccuracySparkline: number[];
  atlasFiltersUsed: boolean;
  tourCompleted: boolean;
};

const DEFAULT: Stats = {
  attemptsCount: 0,
  attemptsRecentSlugs: [],
  quizAsked: 0,
  quizCorrect: 0,
  quizStreak: 0,
  quizBest: 0,
  quizSparkline: [0, 0, 0, 0, 0, 0, 0],
  quizAccuracySparkline: [0, 0, 0, 0, 0, 0, 0],
  atlasFiltersUsed: false,
  tourCompleted: false,
};

// 7-day window ending today, in chronological order.
function last7DayKeys(): string[] {
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  }
  return out;
}

function loadStats(): Stats {
  if (typeof window === "undefined") return DEFAULT;
  const out: Stats = { ...DEFAULT };
  try {
    const a = localStorage.getItem("cuvi-attempts-v1");
    if (a) {
      const parsed = JSON.parse(a);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed);
        out.attemptsCount = keys.length;
        const withTs = keys
          .map((k) => [k, parsed[k]?.ts ?? 0] as [string, number])
          .sort((x, y) => y[1] - x[1])
          .slice(0, 5)
          .map((p) => p[0]);
        out.attemptsRecentSlugs = withTs;
      } else if (Array.isArray(parsed)) {
        out.attemptsCount = parsed.length;
      }
    }
  } catch { /* ignore */ }
  try {
    const q = localStorage.getItem("cuvi-quiz-v1");
    if (q) {
      const parsed = JSON.parse(q);
      out.quizAsked = Number(parsed.asked ?? 0);
      out.quizCorrect = Number(parsed.correct ?? 0);
      out.quizStreak = Number(parsed.streak ?? 0);
      out.quizBest = Number(parsed.bestStreak ?? 0);
    }
  } catch { /* ignore */ }
  try {
    const h = localStorage.getItem("cuvi-quiz-history-v1");
    if (h) {
      const parsed = JSON.parse(h) as Record<
        string,
        { asked: number; correct: number }
      >;
      out.quizSparkline = last7DayKeys().map((k) => parsed[k]?.asked ?? 0);
      out.quizAccuracySparkline = last7DayKeys().map((k) => {
        const entry = parsed[k];
        if (!entry || entry.asked === 0) return 0;
        return Math.round((entry.correct / entry.asked) * 100);
      });
    }
  } catch { /* ignore */ }
  try {
    const f = localStorage.getItem("cuvi-atlas-filters-v1");
    if (f) {
      const parsed = JSON.parse(f);
      out.atlasFiltersUsed =
        parsed.modality !== "all" ||
        parsed.species !== "all" ||
        parsed.body !== "all";
    }
  } catch { /* ignore */ }
  try {
    const t = localStorage.getItem("cuvi-tour-completed-v1");
    if (t === "true" || t === "1") out.tourCompleted = true;
  } catch { /* ignore */ }
  return out;
}

// Count-up animation hook — matches QuizView pattern.
function useAnimatedNumber(target: number, durationMs = 700) {
  const [display, setDisplay] = useState(target);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(target);
  const toRef = useRef(target);
  useEffect(() => {
    fromRef.current = display;
    toRef.current = target;
    startRef.current = null;
    let raf = 0;
    const step = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = fromRef.current + (toRef.current - fromRef.current) * eased;
      setDisplay(target % 1 === 0 ? Math.round(value) : value);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);
  return display;
}

export function ProgressView() {
  const [stats, setStats] = useState<Stats>(DEFAULT);
  const [hydrated, setHydrated] = useState(false);

  // Lazy hydration from localStorage. queueMicrotask defer sidesteps
  // the React "setState in effect" rule.
  useEffect(() => {
    queueMicrotask(() => {
      setStats(loadStats());
      setHydrated(true);
    });
  }, []);

  const accuracy =
    stats.quizAsked > 0 ? Math.round((stats.quizCorrect / stats.quizAsked) * 100) : null;
  const weekTotal = stats.quizSparkline.reduce((a, b) => a + b, 0);

  return (
    <div className="text-[var(--color-text)]">
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-widest text-[var(--color-tool-violet)] mb-2">
          Your progress
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold mb-3">Local dashboard</h1>
        <p className="text-[var(--color-text-muted)] leading-relaxed max-w-2xl">
          ทุกตัวเลขเก็บอยู่ใน browser ของคุณคนเดียว ไม่ส่งไป server · ไม่มี account · ไม่มี cloud sync.
          {" "}
          <span className="text-[var(--color-text-faint)]">
            (เคลียร์ browser data = เคลียร์ progress)
          </span>
        </p>
      </header>

      {/* Active Recall — case attempts */}
      <section className="mb-8">
        <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] mb-3 flex items-center gap-2">
          <span className="text-[var(--color-tool-cyan)]">●</span> Cases attempted
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumCard
            label="Total cases with notes"
            value={stats.attemptsCount}
            hydrated={hydrated}
            sub="from cuvi-attempts-v1"
          />
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)] mb-1">
              Recent (latest 5)
            </div>
            {hydrated && stats.attemptsRecentSlugs.length > 0 ? (
              <ul className="text-[12px] font-mono space-y-0.5">
                {stats.attemptsRecentSlugs.slice(0, 5).map((s) => (
                  <li key={s} className="truncate">
                    <Link
                      href={`/cases/${s}`}
                      className="text-[var(--color-tool-cyan)] hover:underline"
                    >
                      {s}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-[var(--color-text-faint)]">—</span>
            )}
          </div>
        </div>
      </section>

      {/* Anatomy Quiz — with 7-day sparkline */}
      <section className="mb-8">
        <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] mb-3 flex items-center gap-2">
          <span className="text-[var(--color-tool-violet)]">◆</span> Anatomy quiz
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <NumCard label="Asked" value={stats.quizAsked} hydrated={hydrated} />
          <NumCard
            label="Correct"
            value={stats.quizCorrect}
            hydrated={hydrated}
            accent
          />
          <NumCard label="Streak" value={stats.quizStreak} hydrated={hydrated} />
          <NumCard
            label="Best streak"
            value={stats.quizBest}
            hydrated={hydrated}
            muted
          />
        </div>

        {/* Sparkline panel — 7-day daily totals + accuracy */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)]">
                Last 7 days · asked/day
              </span>
              <span className="text-[10px] font-mono text-[var(--color-text-muted)] tabular-nums">
                {hydrated ? `total ${weekTotal}` : ""}
              </span>
            </div>
            <Sparkline
              values={hydrated ? stats.quizSparkline : []}
              width={280}
              height={48}
              stroke="var(--color-tool-cyan)"
            />
          </div>
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)]">
                Last 7 days · accuracy %
              </span>
              <span className="text-[10px] font-mono text-[var(--color-text-muted)] tabular-nums">
                {hydrated && accuracy !== null ? `today ${accuracy}%` : ""}
              </span>
            </div>
            <Sparkline
              values={hydrated ? stats.quizAccuracySparkline : []}
              width={280}
              height={48}
              stroke="var(--color-finalized)"
            />
          </div>
        </div>

        {hydrated && stats.quizAsked > 0 && (
          <div className="mt-2 text-[11px] font-mono text-[var(--color-text-muted)]">
            overall accuracy: <span className="text-[var(--color-text)]">{accuracy}%</span>
          </div>
        )}
      </section>

      {/* Atlas browse + tour */}
      <section className="mb-8">
        <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-[var(--color-text)] mb-3 flex items-center gap-2">
          <span className="text-[var(--color-finalized)]">▸</span> Atlas + onboarding
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <BoolCard
            label="Atlas filters touched"
            value={stats.atlasFiltersUsed}
            hydrated={hydrated}
            sub="any filter ≠ all"
          />
          <BoolCard
            label="Onboarding tour"
            value={stats.tourCompleted}
            hydrated={hydrated}
            trueLabel="Completed"
            falseLabel="Pending"
          />
        </div>
      </section>

      {/* Action shortcuts */}
      <div className="flex flex-wrap gap-3 mt-10">
        <Link href="/cases" className="vmx-btn vmx-btn-primary vmx-btn-sm">
          ไปเปิดเคส
        </Link>
        <Link href="/quiz" className="vmx-btn vmx-btn-ghost vmx-btn-sm">
          ลอง quiz
        </Link>
        <Link href="/atlas" className="vmx-btn vmx-btn-ghost vmx-btn-sm">
          ดู atlas
        </Link>
        <Link href="/review" className="vmx-btn vmx-btn-ghost vmx-btn-sm">
          เปิด SRS review
        </Link>
      </div>

      <p className="mt-10 text-[11px] text-[var(--color-text-faint)] text-center max-w-2xl mx-auto leading-relaxed">
        Iron Rule 0: ตัวเลขทุกตัวมาจาก localStorage โดยตรง · ไม่มี server-side
        aggregation · ไม่มี cloud · ถ้าไม่เคย attempt เคสไหนเลย จะแสดงเป็น &ldquo;—&rdquo; ตามจริง.
        Sparkline ใช้ <code className="text-[var(--color-tool-cyan)]">cuvi-quiz-history-v1</code>{" "}
        ที่ Quiz เขียนทุกครั้งที่ตอบ.
      </p>
    </div>
  );
}

// Number card — animated count-up · honest "—" when not hydrated.
function NumCard({
  label,
  value,
  hydrated,
  sub,
  accent,
  muted,
}: {
  label: string;
  value: number;
  hydrated: boolean;
  sub?: string;
  accent?: boolean;
  muted?: boolean;
}) {
  const animated = useAnimatedNumber(hydrated ? value : 0);
  const colorClass = accent
    ? "text-[var(--color-finalized)]"
    : muted
      ? "text-[var(--color-text-muted)]"
      : "text-[var(--color-text)]";
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)] mb-1">
        {label}
      </div>
      <div className={`text-2xl font-mono font-semibold tabular-nums ${colorClass}`}>
        {hydrated ? animated : "—"}
      </div>
      {sub && (
        <div className="text-[10px] font-mono text-[var(--color-text-faint)] mt-1">
          {sub}
        </div>
      )}
    </div>
  );
}

function BoolCard({
  label,
  value,
  hydrated,
  sub,
  trueLabel = "Yes",
  falseLabel = "No",
}: {
  label: string;
  value: boolean;
  hydrated: boolean;
  sub?: string;
  trueLabel?: string;
  falseLabel?: string;
}) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)] mb-1">
        {label}
      </div>
      <div
        className={`text-2xl font-mono font-semibold ${
          hydrated
            ? value
              ? "text-[var(--color-finalized)]"
              : "text-[var(--color-text-muted)]"
            : "text-[var(--color-text-muted)]"
        }`}
      >
        {hydrated ? (value ? trueLabel : falseLabel) : "—"}
      </div>
      {sub && (
        <div className="text-[10px] font-mono text-[var(--color-text-faint)] mt-1">
          {sub}
        </div>
      )}
    </div>
  );
}
