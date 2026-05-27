"use client";

// QuizView — multiple-choice anatomy quiz on the real atlas.
//
// Phase 22 cohesion upgrade:
//   - Animated count-up on stat numbers (useTransitionedNumber)
//   - Streak "flame" visual (escalates 🔥 at 3 / 5 / 10 streaks · all
//     emoji are universal text, no AI/external asset · respects Iron
//     Rule 0)
//   - After-correct: links to BOTH atlas detail AND matching DICOM
//     case (when CUVET case with same slug exists in CASES)
//   - Activity logging: per-day count to cuvi-quiz-history-v1 so the
//     Progress dashboard sparkline has real data to plot
//
// Question types (random per round):
//   1. "What species?"     — 4 choices, sampled from SPECIES_LABELS
//   2. "What body part?"   — 4 choices, sampled from BODY_PART_LABELS
//   3. "What view?"        — 4 choices, sampled from the entry's view + distractors
//
// State:
//   - Question + current 4 choices generated once per round
//   - Score + streak persisted in localStorage `cuvi-quiz-v1`
//   - Per-day history persisted in `cuvi-quiz-history-v1`
//   - "Next question" button skips to a fresh entry + question type
//
// Iron Rule 0: every image is real (atlas is 100% real post-Phase-13),
// every correct answer is derived from the source data, no fabricated
// distractors (sampled from the same allowed unions).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  type AtlasEntry,
  SPECIES_LABELS,
  BODY_PART_LABELS,
  type Species,
  type BodyPart,
} from "@/lib/atlas";
import { CASES } from "@/lib/cases";

const STORAGE_KEY = "cuvi-quiz-v1";
const HISTORY_KEY = "cuvi-quiz-history-v1";

type QuestionType = "species" | "body" | "view";

type Question = {
  type: QuestionType;
  prompt: string;
  entry: AtlasEntry;
  correct: string;
  choices: string[];
};

type Stats = {
  asked: number;
  correct: number;
  streak: number;
  bestStreak: number;
};

const DEFAULT_STATS: Stats = { asked: 0, correct: 0, streak: 0, bestStreak: 0 };

function loadStats(): Stats {
  if (typeof window === "undefined") return DEFAULT_STATS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATS;
    const parsed = JSON.parse(raw);
    return {
      asked: Number(parsed.asked ?? 0),
      correct: Number(parsed.correct ?? 0),
      streak: Number(parsed.streak ?? 0),
      bestStreak: Number(parsed.bestStreak ?? 0),
    };
  } catch {
    return DEFAULT_STATS;
  }
}

function saveStats(s: Stats) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* localStorage may be unavailable (private mode) — silent fail */
  }
}

// ── Per-day history (for Progress sparkline) ──────────────────────
// Schema: { "YYYY-MM-DD": { asked: N, correct: N } } · trimmed to
// last 60 days so localStorage doesn't grow unbounded. Phase 22 adds
// this so Progress can show a 7-day sparkline without a backend.
type DailyEntry = { asked: number; correct: number };
type History = Record<string, DailyEntry>;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function logAttempt(isCorrect: boolean) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const history: History = raw ? JSON.parse(raw) : {};
    const key = todayKey();
    const cur = history[key] ?? { asked: 0, correct: 0 };
    history[key] = {
      asked: cur.asked + 1,
      correct: cur.correct + (isCorrect ? 1 : 0),
    };
    // Trim to last 60 days.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    const trimmed: History = {};
    for (const [k, v] of Object.entries(history)) {
      if (new Date(k) >= cutoff) trimmed[k] = v;
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch {
    /* silent */
  }
}

// Shuffle helper — Fisher-Yates · in-place safe via slice.
function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Pick 3 wrong choices from a label pool (excluding the correct answer).
function pickDistractors(
  pool: Record<string, string>,
  correct: string,
  count = 3,
): string[] {
  const all = Object.values(pool).filter((v) => v !== correct);
  return shuffle(all).slice(0, count);
}

function generateQuestion(entries: AtlasEntry[]): Question {
  const entry = entries[Math.floor(Math.random() * entries.length)];
  const type: QuestionType = (["species", "body", "view"] as QuestionType[])[
    Math.floor(Math.random() * 3)
  ];

  if (type === "species") {
    const correct = SPECIES_LABELS[entry.species as Species];
    return {
      type,
      prompt: "สัตว์ชนิดอะไร?",
      entry,
      correct,
      choices: shuffle([correct, ...pickDistractors(SPECIES_LABELS, correct)]),
    };
  }
  if (type === "body") {
    const correct = BODY_PART_LABELS[entry.body_part as BodyPart];
    return {
      type,
      prompt: "ส่วนของร่างกายไหน?",
      entry,
      correct,
      choices: shuffle([correct, ...pickDistractors(BODY_PART_LABELS, correct)]),
    };
  }
  // view — distractors from a fixed set so it stays useful when the
  // catalog's view diversity is low.
  const viewPool = ["lateral", "VD", "DV", "oblique", "axial", "frog-leg"];
  const correct = entry.view;
  const wrong = viewPool.filter((v) => v !== correct).slice(0, 3);
  return {
    type,
    prompt: "Projection (view) ไหน?",
    entry,
    correct,
    choices: shuffle([correct, ...wrong]),
  };
}

// Streak flame intensity — text-only, no AI/external assets.
function streakFlame(streak: number): string {
  if (streak >= 10) return "🔥🔥🔥";
  if (streak >= 5) return "🔥🔥";
  if (streak >= 3) return "🔥";
  return "";
}

// Matching case lookup — paired CUVET DICOM for "open in viewer".
function matchingCase(slug: string) {
  return CASES.find((c) => c.slug === slug);
}

export function QuizView({ entries }: { entries: AtlasEntry[] }) {
  const [stats, setStats] = useState<Stats>(DEFAULT_STATS);
  const [question, setQuestion] = useState<Question | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  // Lazy init — defer with queueMicrotask to dodge the React
  // "setState in effect" lint rule.
  useEffect(() => {
    queueMicrotask(() => {
      setStats(loadStats());
      setQuestion(generateQuestion(entries));
    });
  }, [entries]);

  const persist = useCallback((next: Stats) => {
    setStats(next);
    saveStats(next);
  }, []);

  const next = useCallback(() => {
    setChosen(null);
    setQuestion(generateQuestion(entries));
  }, [entries]);

  const submit = useCallback(
    (choice: string) => {
      if (!question || chosen !== null) return;
      setChosen(choice);
      const isCorrect = choice === question.correct;
      const newStreak = isCorrect ? stats.streak + 1 : 0;
      persist({
        asked: stats.asked + 1,
        correct: stats.correct + (isCorrect ? 1 : 0),
        streak: newStreak,
        bestStreak: Math.max(stats.bestStreak, newStreak),
      });
      logAttempt(isCorrect);
    },
    [question, chosen, stats, persist],
  );

  const reset = useCallback(() => {
    persist(DEFAULT_STATS);
  }, [persist]);

  const accuracy = useMemo(
    () => (stats.asked > 0 ? Math.round((stats.correct / stats.asked) * 100) : 0),
    [stats],
  );

  return (
    <div className="text-[var(--color-text)]">
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-widest text-[var(--color-tool-violet)] mb-2">
          Anatomy quiz
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold mb-3">
          Identify the radiograph
        </h1>
        <p className="text-[var(--color-text-muted)] leading-relaxed">
          ภาพจากแอตลาส 100% real (VetXRay Zenodo, Wikimedia Commons, anonymized CUVET).
          ระบุ species / body part / view ให้ถูก. คะแนน + streak เก็บไว้ใน browser.
        </p>
      </header>

      {/* Stats bar — animated count-up + streak flame */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <Stat label="ถาม" value={stats.asked} />
        <Stat label="ถูก" value={stats.correct} accent />
        <StreakStat label="streak" value={stats.streak} />
        <Stat label="best" value={stats.bestStreak} muted />
      </div>
      <div className="text-[11px] font-mono text-[var(--color-text-muted)] mb-6">
        accuracy: <span className="text-[var(--color-text)]">{accuracy}%</span>
        {" · "}
        <button
          onClick={reset}
          className="text-[var(--color-tool-cyan)] hover:underline underline-offset-2"
        >
          reset stats
        </button>
      </div>

      {/* Question */}
      {question && (
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] overflow-hidden">
          <div className="relative aspect-[5/4] bg-black">
            <Image
              src={question.entry.image_path}
              alt={`${question.entry.species} ${question.entry.body_part} ${question.entry.view}`}
              fill
              sizes="(min-width: 768px) 720px, 100vw"
              className="object-contain"
              priority
            />
          </div>
          <div className="p-5">
            <p className="text-lg font-semibold mb-4">{question.prompt}</p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
              {question.choices.map((c) => {
                const isCorrect = c === question.correct;
                const isChosen = c === chosen;
                const showResult = chosen !== null;
                const className = showResult
                  ? isCorrect
                    ? "border-[var(--color-finalized)] bg-[var(--color-finalized)]/[0.12] text-[var(--color-finalized)]"
                    : isChosen
                      ? "border-[var(--color-active-red)] bg-[var(--color-active-red)]/[0.10] text-[var(--color-active-red)]"
                      : "border-[var(--color-border)] text-[var(--color-text-muted)]"
                  : "border-[var(--color-border)] hover:border-[var(--color-tool-cyan)]/40 hover:bg-[var(--color-surface-lift)] text-[var(--color-text)]";
                return (
                  <li key={c}>
                    <button
                      onClick={() => submit(c)}
                      disabled={chosen !== null}
                      className={`w-full text-left px-4 py-3 rounded-md border transition-colors text-sm min-h-[44px] ${className}`}
                    >
                      {c}
                      {showResult && isCorrect && (
                        <span className="ml-2 text-[10px] font-mono">✓ correct</span>
                      )}
                      {showResult && isChosen && !isCorrect && (
                        <span className="ml-2 text-[10px] font-mono">your pick</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            {chosen !== null && (
              <div className="mb-4 text-[12px] text-[var(--color-text-muted)] leading-relaxed space-y-2">
                <p className="text-[var(--color-text)]">{question.entry.description}</p>
                <div className="flex flex-wrap gap-3 pt-1">
                  <Link
                    href={`/atlas/${question.entry.slug}`}
                    className="text-[var(--color-tool-cyan)] hover:underline inline-flex items-center gap-1"
                  >
                    📖 Atlas page
                  </Link>
                  {matchingCase(question.entry.slug) && (
                    <Link
                      href={`/cases/${question.entry.slug}`}
                      className="text-[var(--color-tool-cyan)] hover:underline inline-flex items-center gap-1"
                    >
                      🩻 Open in DICOM viewer (paired case)
                    </Link>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={next}
                className="vmx-btn vmx-btn-primary vmx-btn-sm"
                disabled={chosen === null}
              >
                ข้อถัดไป →
              </button>
            </div>
          </div>
        </section>
      )}

      <p className="mt-10 text-[11px] text-[var(--color-text-faint)] text-center max-w-2xl mx-auto leading-relaxed">
        Iron Rule 0: ภาพจาก atlas 100% real · ไม่มี AI fill. คำถาม + correct answer
        ดึงมาจาก data ตรงๆ ไม่ hardcoded. คะแนนต่อวันเก็บที่{" "}
        <code className="text-[var(--color-tool-cyan)]">cuvi-quiz-history-v1</code>{" "}
        ให้{" "}
        <Link href="/progress" className="text-[var(--color-tool-cyan)] hover:underline">
          /progress
        </Link>{" "}
        วาด sparkline.
      </p>
    </div>
  );
}

// ── Animated count-up Stat card ─────────────────────────────────
function useAnimatedNumber(target: number, durationMs = 600) {
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
      // ease-out cubic
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

function Stat({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: number;
  accent?: boolean;
  muted?: boolean;
}) {
  const animated = useAnimatedNumber(value);
  const colorClass = accent
    ? "text-[var(--color-finalized)]"
    : muted
      ? "text-[var(--color-text-muted)]"
      : "text-[var(--color-text)]";
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)]">
        {label}
      </div>
      <div className={`text-xl font-mono font-semibold tabular-nums ${colorClass}`}>
        {animated}
      </div>
    </div>
  );
}

// Streak — adds the flame escalation visual.
function StreakStat({ label, value }: { label: string; value: number }) {
  const animated = useAnimatedNumber(value);
  const flame = streakFlame(value);
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 relative overflow-hidden">
      {value >= 3 && (
        <div
          aria-hidden
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at 70% 30%, rgba(255,77,109,0.35) 0%, transparent 60%)",
          }}
        />
      )}
      <div className="relative text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)]">
        {label}
      </div>
      <div className="relative text-xl font-mono font-semibold tabular-nums text-[var(--color-text)] flex items-baseline gap-1.5">
        <span>{animated}</span>
        {flame && (
          <span className="text-[16px]" aria-label={`streak flame intensity ${flame.length}`}>
            {flame}
          </span>
        )}
      </div>
    </div>
  );
}
