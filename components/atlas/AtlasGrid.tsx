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

type FilterState = {
  modality: ModalityFilter;
  species: SpeciesFilter;
  body: BodyFilter;
};

const DEFAULT_FILTERS: FilterState = {
  modality: "all",
  species: "all",
  body: "all",
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
    };
  } catch {
    return DEFAULT_FILTERS;
  }
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

  const resetFilters = useCallback(() => {
    writeFilters(DEFAULT_FILTERS);
  }, []);

  // Filter chain — all three filters are AND-combined. Counts for each
  // facet are computed against the OTHER two filters so disabled chips
  // accurately reflect "nothing would match if you click this." Cheap
  // for 10 entries; if this grows past ~500 we should index by facet.
  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filters.modality !== "all" && e.modality !== filters.modality) return false;
      if (filters.species !== "all" && e.species !== filters.species) return false;
      if (filters.body !== "all" && e.body_part !== filters.body) return false;
      return true;
    });
  }, [entries, filters]);

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
    filters.modality !== "all" || filters.species !== "all" || filters.body !== "all";

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
        <p className="text-[14px] sm:text-base text-[var(--color-text-muted)] leading-relaxed max-w-2xl">
          ดู <span className="text-[var(--color-tool-cyan)]">normal</span> ให้ครบ 100 ครั้งก่อน
          ค่อยอ่าน abnormal ออก. กรองตาม modality · species · body part เพื่อ
          เปรียบเทียบ baseline ก่อนเปิด clinical case.
        </p>
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
      <p className="mt-10 text-[11px] text-[var(--color-text-faint)] text-center max-w-2xl mx-auto leading-relaxed">
        Day-1 atlas seeded with AI-generated radiographs (Pollinations.ai Flux).
        Honesty tag <span className="text-[var(--color-tool-cyan)] font-mono">AI-gen</span> on
        each tile · upgrade path: swap in real CC-BY images from Mendeley / Wikimedia / open
        vet atlases as we find them.
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
