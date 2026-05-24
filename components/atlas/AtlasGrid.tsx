"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  type AtlasEntry,
  type Modality,
  type Species,
  type BodyPart,
} from "@/lib/atlas";
import { AtlasCard } from "./AtlasCard";

const STORAGE_KEY = "cuvi-atlas-filters-v1";

type ModalityFilter = Modality | "all";
type SpeciesFilter = Species | "all";
type BodyFilter = BodyPart | "all";
// Credibility quick-filter splits the catalog into "real reference"
// (peer-reviewed / community / open-textbook / cuvet-internal) vs
// "ai-illustrative" (ai-generated). Single-select like other facets.
type CredFilter = "all" | "real" | "ai";

type FilterState = {
  modality: ModalityFilter;
  species: SpeciesFilter;
  body: BodyFilter;
  credibility: CredFilter;
};

const DEFAULT_FILTERS: FilterState = {
  modality: "all",
  species: "all",
  body: "all",
  credibility: "all",
};

// External subscription store for the filter set.
//
// useSyncExternalStore is the React 19 way to read from a non-React
// source (localStorage) without tripping the `set-state-in-effect`
// lint rule. The store keeps a cached snapshot, broadcasts via a
// custom event, and gives us a clean SSR fallback. Pattern adapted
// from React docs Performance section.
let cachedSnapshot: FilterState | null = null;

function readFromStorage(): FilterState {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw);
    return {
      modality: parsed.modality ?? "all",
      species: parsed.species ?? "all",
      body: parsed.body ?? "all",
      // credibility added Phase 7 · default "all" for back-compat with
      // existing v1 persisted state.
      credibility: parsed.credibility ?? "all",
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

// Predicate — what counts as "real reference material" for atlas
// credibility filtering. Anything not explicitly ai-generated. Mirrors
// the badge logic in AtlasCard so header counts and tile badges stay
// in lockstep.
function isRealEntry(e: AtlasEntry): boolean {
  return e.credibility !== "ai-generated";
}

function getSnapshot(): FilterState {
  if (cachedSnapshot === null) {
    cachedSnapshot = readFromStorage();
  }
  return cachedSnapshot;
}

function getServerSnapshot(): FilterState {
  return DEFAULT_FILTERS;
}

function subscribe(callback: () => void): () => void {
  // Custom event on window lets the multiple setters in this component
  // tree stay in sync without prop-drilling.
  window.addEventListener("atlas-filters-changed", callback);
  // Also listen to native storage events so a tab refresh-trigger
  // works (e.g. user opens atlas in two tabs).
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("atlas-filters-changed", callback);
    window.removeEventListener("storage", callback);
  };
}

function writeFilters(next: FilterState) {
  cachedSnapshot = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode — silent */
  }
  // Wake any subscribers in this tab.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("atlas-filters-changed"));
  }
}

const MODALITY_CHIPS: { k: ModalityFilter; label: string }[] = [
  { k: "all", label: "All" },
  { k: "DX", label: "DX" },
  { k: "CT", label: "CT" },
  { k: "MR", label: "MR" },
  { k: "US", label: "US" },
];

const SPECIES_CHIPS: { k: SpeciesFilter; label: string }[] = [
  { k: "all", label: "All" },
  { k: "canine", label: "Canine" },
  { k: "feline", label: "Feline" },
  { k: "exotic", label: "Exotic" },
  { k: "equine", label: "Equine" },
  { k: "bovine", label: "Bovine" },
];

const BODY_CHIPS: { k: BodyFilter; label: string }[] = [
  { k: "all", label: "All" },
  { k: "thorax", label: "Thorax" },
  { k: "abdomen", label: "Abdomen" },
  { k: "pelvis", label: "Pelvis" },
  { k: "skull", label: "Skull" },
  { k: "spine", label: "Spine" },
  { k: "limb-fore", label: "Forelimb" },
  { k: "limb-hind", label: "Hindlimb" },
  { k: "dental", label: "Dental" },
];

export function AtlasGrid({ entries }: { entries: AtlasEntry[] }) {
  // useSyncExternalStore subscribes to the localStorage-backed snapshot.
  // Server renders with DEFAULT_FILTERS, client hydrates with whatever
  // is persisted — React handles the swap without the set-state-in-effect
  // anti-pattern. The trade-off: a brief flash of "All" filters on first
  // paint if the user has a saved filter. Acceptable given the small DOM.
  const filters = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setModality = useCallback((k: ModalityFilter) => {
    writeFilters({ ...getSnapshot(), modality: k });
  }, []);
  const setSpecies = useCallback((k: SpeciesFilter) => {
    writeFilters({ ...getSnapshot(), species: k });
  }, []);
  const setBody = useCallback((k: BodyFilter) => {
    writeFilters({ ...getSnapshot(), body: k });
  }, []);
  const setCredibility = useCallback((k: CredFilter) => {
    writeFilters({ ...getSnapshot(), credibility: k });
  }, []);

  const resetFilters = useCallback(() => {
    writeFilters(DEFAULT_FILTERS);
  }, []);

  // Filter chain — all four filters are AND-combined. Counts for each
  // facet are computed against the OTHER filters so disabled chips
  // accurately reflect "nothing would match if you click this." Cheap
  // for 10 entries; if this grows past ~500 we should index by facet.
  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filters.modality !== "all" && e.modality !== filters.modality) return false;
      if (filters.species !== "all" && e.species !== filters.species) return false;
      if (filters.body !== "all" && e.body_part !== filters.body) return false;
      if (filters.credibility === "real" && !isRealEntry(e)) return false;
      if (filters.credibility === "ai" && isRealEntry(e)) return false;
      return true;
    });
  }, [entries, filters]);

  // Real-vs-AI split for the header counts pill. Computed over the
  // FULL catalog, not the filtered set — header counts always reflect
  // "what exists" so the segment numbers stay stable as students toggle
  // other facets. Iron Rule 0: derived from the data, never hardcoded.
  const realCount = useMemo(
    () => entries.filter(isRealEntry).length,
    [entries]
  );
  const aiCount = entries.length - realCount;

  // Per-facet counts — count what would match if THIS chip were selected,
  // holding the OTHER two filters constant. Used to disable empty chips.
  const facetCounts = useMemo(() => {
    const modalityCounts: Record<string, number> = { all: 0 };
    const speciesCounts: Record<string, number> = { all: 0 };
    const bodyCounts: Record<string, number> = { all: 0 };

    for (const e of entries) {
      // For "modality" chip counts, ignore the current modality filter
      if (
        (filters.species === "all" || e.species === filters.species) &&
        (filters.body === "all" || e.body_part === filters.body)
      ) {
        modalityCounts[e.modality] = (modalityCounts[e.modality] || 0) + 1;
        modalityCounts.all += 1;
      }
      // For "species" chip counts, ignore the current species filter
      if (
        (filters.modality === "all" || e.modality === filters.modality) &&
        (filters.body === "all" || e.body_part === filters.body)
      ) {
        speciesCounts[e.species] = (speciesCounts[e.species] || 0) + 1;
        speciesCounts.all += 1;
      }
      // For "body" chip counts, ignore the current body filter
      if (
        (filters.modality === "all" || e.modality === filters.modality) &&
        (filters.species === "all" || e.species === filters.species)
      ) {
        bodyCounts[e.body_part] = (bodyCounts[e.body_part] || 0) + 1;
        bodyCounts.all += 1;
      }
    }
    return { modality: modalityCounts, species: speciesCounts, body: bodyCounts };
  }, [entries, filters]);

  const hasActiveFilters =
    filters.modality !== "all" ||
    filters.species !== "all" ||
    filters.body !== "all" ||
    filters.credibility !== "all";

  return (
    <div>
      {/* ──── HEADER ──── */}
      <header className="mb-6 sm:mb-8">
        <p className="imaging-eyebrow mb-3">
          CUVETSMO Imaging Atlas · Stage 1
        </p>
        <h1 className="imaging-display text-3xl sm:text-4xl text-[var(--color-text)] mb-3">
          Anatomy Atlas — normal radiograph reference
        </h1>
        <p className="text-[14px] sm:text-base text-[var(--color-text-muted)] leading-relaxed max-w-2xl mb-4">
          ดู <span className="text-[var(--color-tool-cyan)]">normal</span> ให้ครบ 100 ครั้งก่อน
          ค่อยอ่าน abnormal ออก. กรองตาม modality · species · body part เพื่อ
          เปรียบเทียบ baseline ก่อนเปิด clinical case.
        </p>

        {/* Credibility split pill — clickable quick-filter. Real entries
            (peer-reviewed + community) are shown alongside AI-illustrative
            placeholders so students can tell at a glance what's reference
            material vs what's only a layout sketch. Counts derive from the
            data — Iron Rule 0, no hardcoded numbers. */}
        <div
          className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-1 text-[11px] font-mono"
          role="group"
          aria-label="Credibility quick filter"
        >
          <CredSegment
            active={filters.credibility === "real"}
            onClick={() =>
              setCredibility(filters.credibility === "real" ? "all" : "real")
            }
            color="green"
            aria-label={`Show ${realCount} real reference radiographs only`}
          >
            <span aria-hidden>📚</span>
            <span className="text-[var(--color-text)]">{realCount}</span>
            <span className="text-[var(--color-text-muted)]">real</span>
          </CredSegment>
          <span aria-hidden className="text-[var(--color-text-faint)] px-0.5">·</span>
          <CredSegment
            active={filters.credibility === "ai"}
            onClick={() =>
              setCredibility(filters.credibility === "ai" ? "all" : "ai")
            }
            color="violet"
            aria-label={`Show ${aiCount} AI-illustrative entries only`}
          >
            <span aria-hidden>🤖</span>
            <span className="text-[var(--color-text)]">{aiCount}</span>
            <span className="text-[var(--color-text-muted)]">AI-illustrative</span>
          </CredSegment>
        </div>
      </header>

      {/* ──── FILTERS · sticky below site header (40 EcosystemBar + ~57 SiteHeader = 97) ──── */}
      <section
        className="sticky top-[97px] z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mb-6 bg-[var(--color-bg)]/95 backdrop-blur-md border-b border-[var(--color-border)]"
        aria-label="Atlas filters"
      >
        <FilterRow
          label="Modality"
          chips={MODALITY_CHIPS}
          current={filters.modality}
          counts={facetCounts.modality}
          onSelect={(k) => setModality(k as ModalityFilter)}
        />
        <FilterRow
          label="Species"
          chips={SPECIES_CHIPS}
          current={filters.species}
          counts={facetCounts.species}
          onSelect={(k) => setSpecies(k as SpeciesFilter)}
        />
        <FilterRow
          label="Body"
          chips={BODY_CHIPS}
          current={filters.body}
          counts={facetCounts.body}
          onSelect={(k) => setBody(k as BodyFilter)}
        />

        {/* Active filter summary + reset */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--color-border)] text-[11px] font-mono">
          <span className="text-[var(--color-text-muted)]">
            {filtered.length} of {entries.length} entries
            {hasActiveFilters && (
              <span className="text-[var(--color-text-faint)]"> · filtered</span>
            )}
          </span>
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="text-[var(--color-tool-cyan)] hover:text-[#7DDCEF] underline underline-offset-2"
            >
              clear filters
            </button>
          )}
        </div>
      </section>

      {/* ──── GRID ──── */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {filtered.map((e) => (
            <AtlasCard key={e.id} entry={e} />
          ))}
        </div>
      ) : (
        <EmptyState onReset={resetFilters} />
      )}

      {/* ──── HONESTY FOOTNOTE ──── */}
      {/* Atlas is a mix — students must be able to tell which tiles are
          real reference material vs which are AI-illustrative placeholders.
          Counts are derived from the data above (Iron Rule 0). Keep this
          paragraph honest about both the swapped-in real sources and the
          remaining AI-gen placeholders earmarked for upgrade. */}
      <p className="mt-10 text-[11px] text-[var(--color-text-faint)] text-center max-w-2xl mx-auto leading-relaxed">
        Atlas tiles are a mix:{" "}
        <span className="text-[var(--color-finalized)] font-mono">{realCount} real</span>{" "}
        reference radiographs (CC BY / CC BY-SA, sourced from the{" "}
        <a
          href="https://zenodo.org/records/19051776"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-tool-cyan)] hover:underline"
        >
          VetXRay Zenodo dataset
        </a>{" "}
        and Wikimedia Commons) and{" "}
        <span className="text-[var(--color-tool-violet)] font-mono">{aiCount} AI-illustrative</span>{" "}
        placeholders (Pollinations.ai Flux), flagged for upgrade to real CC-BY images as we find them.
        Real-reference tiles carry a{" "}
        <span className="text-[var(--color-finalized)] font-mono">✓ Peer-reviewed</span> or{" "}
        <span className="text-[var(--color-finalized)] font-mono">✓ Community</span> badge;
        AI-illustrative tiles keep the{" "}
        <span className="text-[var(--color-tool-violet)] font-mono">🤖 AI-gen</span> badge.
        Trust the badge, not the filename.
      </p>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Single facet row — label + chip set. Chips with count=0 are disabled.
// ───────────────────────────────────────────────────────────────────────
function FilterRow({
  label,
  chips,
  current,
  counts,
  onSelect,
}: {
  label: string;
  chips: { k: string; label: string }[];
  current: string;
  counts: Record<string, number>;
  onSelect: (k: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 mb-2 flex-wrap">
      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)] w-[60px] shrink-0">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => {
          const count = counts[c.k] ?? 0;
          const isActive = current === c.k;
          const isEmpty = count === 0 && c.k !== "all";
          return (
            <button
              key={c.k}
              onClick={() => onSelect(c.k)}
              disabled={isEmpty}
              aria-pressed={isActive}
              aria-label={c.k === "all" ? c.label : `${c.label} (${count})`}
              className={[
                // min-h ensures 44px tap target on mobile (per ux-audit checklist)
                "inline-flex items-center gap-1.5 min-h-[36px] sm:min-h-[32px] px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors",
                "border",
                isActive
                  ? "bg-[var(--color-tool-cyan)] text-[#06070A] border-[var(--color-tool-cyan)]"
                  : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:text-[var(--color-tool-cyan)] hover:border-[var(--color-border-tool)]",
                isEmpty ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
              ].join(" ")}
            >
              <span>{c.label}</span>
              {c.k !== "all" && (
                <span
                  aria-hidden
                  className={[
                    // tabular-nums + own pill so "DX 10" doesn't glue to "DX10"
                    "tabular-nums text-[10px] font-mono px-1 py-0.5 rounded leading-none",
                    isActive
                      ? "bg-[#06070A]/15 text-[#06070A]/80"
                      : "bg-[var(--color-bg)] text-[var(--color-text-faint)]",
                  ].join(" ")}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-border-bright)] bg-[var(--color-surface-2)] p-10 text-center">
      <div className="text-2xl mb-3" aria-hidden>
        ⛛
      </div>
      <div className="text-[14px] font-semibold text-[var(--color-text)] mb-1.5">
        ไม่มี entry ตรงกับ filter ที่เลือก
      </div>
      <div className="text-[12px] text-[var(--color-text-muted)] mb-4">
        ลองเอา filter บางอันออกหรือเลือก All ในหนึ่งแถว
      </div>
      <button onClick={onReset} className="imaging-btn imaging-btn-ghost">
        ล้างตัวกรองทั้งหมด
      </button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// CredSegment — one clickable segment in the credibility split pill.
// Toggle behaviour (click active → returns to "all") makes the pill a
// quick-filter shortcut for the same logic as a dedicated filter row
// without doubling the chrome.
// ───────────────────────────────────────────────────────────────────────
function CredSegment({
  active,
  onClick,
  color,
  children,
  ...rest
}: {
  active: boolean;
  onClick: () => void;
  color: "green" | "violet";
  children: React.ReactNode;
} & React.AriaAttributes) {
  const activeBg =
    color === "green"
      ? "bg-[rgba(52,211,153,0.18)] border-[var(--color-finalized)]"
      : "bg-[rgba(167,139,250,0.18)] border-[var(--color-tool-violet)]";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "inline-flex items-center gap-1.5 min-h-[28px] px-2.5 py-1 rounded text-[11px] transition-colors border",
        active
          ? activeBg
          : "border-transparent hover:bg-[var(--color-surface-3)]",
      ].join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
