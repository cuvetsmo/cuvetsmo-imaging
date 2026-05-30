"use client";

import { useCallback, useDeferredValue, useMemo, useState, useSyncExternalStore } from "react";
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
// Credibility quick-filter — since Phase 13 (Palm directive 2026-05-26)
// the atlas is 100% real. The "ai" segment was removed entirely; the
// type still exposes "all" / "real" so the persisted-filter migration
// path stays simple (old "ai" values silently coerce to "all").
type CredFilter = "all" | "real";

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
    // Phase 13: "ai" filter is deprecated. Coerce any legacy persisted
    // value back to "all" so users with old localStorage state don't see
    // an empty grid.
    const legacyCred = parsed.credibility ?? "all";
    const credibility: CredFilter = legacyCred === "real" ? "real" : "all";
    return {
      modality: parsed.modality ?? "all",
      species: parsed.species ?? "all",
      body: parsed.body ?? "all",
      credibility,
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

  // Text search — local state, not persisted (transient · re-typing is
  // cheap for 17 entries). useDeferredValue keeps the input snappy on
  // slow devices by deferring the filter pass to a low-priority update.
  const [searchInput, setSearchInput] = useState("");
  const deferredSearch = useDeferredValue(searchInput);

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
    setSearchInput("");
  }, []);

  // Filter chain — all four filters are AND-combined. Counts for each
  // facet are computed against the OTHER filters so disabled chips
  // accurately reflect "nothing would match if you click this." Cheap
  // for 10 entries; if this grows past ~500 we should index by facet.
  const filtered = useMemo(() => {
    // Normalize search query once per filter pass (cheap for 17 entries).
    const q = deferredSearch.trim().toLowerCase();
    return entries.filter((e) => {
      if (filters.modality !== "all" && e.modality !== filters.modality) return false;
      if (filters.species !== "all" && e.species !== filters.species) return false;
      if (filters.body !== "all" && e.body_part !== filters.body) return false;
      if (q.length > 0) {
        // Search across slug + description + landmarks + attribution + view.
        // Pre-lowercased + truthy-coalesced so no accidental crashes on
        // entries with optional fields missing.
        const haystack = [
          e.slug,
          e.description,
          e.view,
          e.attribution ?? "",
          (e.learning_landmarks ?? []).join(" "),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      // Phase 13: every entry is real — "real" filter is a no-op kept
      // for localStorage migration safety. No predicate needed.
      return true;
    });
  }, [entries, filters, deferredSearch]);

  // Real-source breakdown for the honesty header — computed over the
  // FULL catalog, not the filtered set, so the counts stay stable as
  // students toggle other facets. Iron Rule 0: derived from the data,
  // never hardcoded. Post-Phase-13 every entry is real; we split by
  // credibility provenance instead of real-vs-AI.
  const provenanceCounts = useMemo(() => {
    const byCred: Record<string, number> = { "peer-reviewed": 0, community: 0, "cuvet-internal": 0, "open-textbook": 0 };
    for (const e of entries) {
      byCred[e.credibility] = (byCred[e.credibility] ?? 0) + 1;
    }
    return byCred;
  }, [entries]);
  const totalCount = entries.length;

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
    filters.credibility !== "all" ||
    deferredSearch.trim().length > 0;

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

        {/* Provenance breakdown — informational only, not a clickable
            filter. Atlas is 100% real (Palm directive 2026-05-26) so
            the old real-vs-AI quick-filter pill was retired. Numbers
            derive from the data — Iron Rule 0, no hardcoded counts. */}
        <div
          className="inline-flex items-center gap-2 rounded-md border border-[var(--color-finalized)]/30 bg-[var(--color-finalized)]/[0.06] px-3 py-1.5 text-[11px] font-mono"
          role="status"
          aria-label="Atlas provenance"
        >
          <span aria-hidden className="text-[var(--color-finalized)]">●</span>
          <span className="text-[var(--color-text)]">{totalCount}</span>
          <span className="text-[var(--color-text-muted)]">{" "}real radiographs</span>
          <span aria-hidden className="text-[var(--color-text-faint)]">·</span>
          {provenanceCounts["peer-reviewed"] > 0 && (
            <span className="text-[var(--color-tool-cyan)]" title="VetXRay Zenodo dataset">
              {provenanceCounts["peer-reviewed"]} peer-reviewed
            </span>
          )}
          {provenanceCounts.community > 0 && (
            <>
              <span aria-hidden className="text-[var(--color-text-faint)]">·</span>
              <span className="text-[var(--color-finalized)]" title="Wikimedia Commons">
                {provenanceCounts.community} community
              </span>
            </>
          )}
          {provenanceCounts["cuvet-internal"] > 0 && (
            <>
              <span aria-hidden className="text-[var(--color-text-faint)]">·</span>
              <span className="text-[var(--color-finalized)]" title="Anonymized CUVET teaching cases">
                {provenanceCounts["cuvet-internal"]} CUVET
              </span>
            </>
          )}
        </div>
      </header>

      {/* ──── FILTERS · sticky below site header (40 EcosystemBar + ~57 SiteHeader = 97) ──── */}
      <section
        className="sticky top-[97px] z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mb-6 bg-[var(--color-bg)]/95 backdrop-blur-md border-b border-[var(--color-border)]"
        aria-label="Atlas filters"
      >
        {/* Text search — debounced via useDeferredValue at the parent. */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-faint)] w-[60px] shrink-0">
            Search
          </span>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="anatomy · landmark · slug · attribution…"
            className="flex-1 min-h-[44px] sm:min-h-[36px] px-3 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[13px] text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-tool-cyan)] focus:ring-1 focus:ring-[var(--color-tool-cyan)]"
            aria-label="Search atlas entries"
          />
          {searchInput.length > 0 && (
            <button
              onClick={() => setSearchInput("")}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-tool-cyan)] text-[11px] font-mono min-h-[44px] sm:min-h-[28px] inline-flex items-center px-2"
              aria-label="Clear search"
            >
              clear
            </button>
          )}
        </div>

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
              // Phase 9: text-button bumped to 44px floor inline-flex so
              // tap targets in the filter footer all match the chips above.
              className="text-[var(--color-tool-cyan)] hover:text-[#7DDCEF] underline underline-offset-2 inline-flex items-center min-h-[44px] sm:min-h-[28px] px-2 -mx-2"
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
      {/* Phase 13: 100% real radiographs (Palm directive 2026-05-26).
          The old "X real / Y AI-illustrative" framing is replaced by an
          honest count of REAL provenance and an explicit list of
          body-part gaps. Counts are derived from the data above —
          Iron Rule 0, no hardcoded numbers, no over-claiming coverage. */}
      <p className="mt-10 text-[11px] text-[var(--color-text-faint)] text-center max-w-2xl mx-auto leading-relaxed">
        <span className="text-[var(--color-finalized)] font-mono">{totalCount} / {totalCount}</span>{" "}
        atlas tiles are real diagnostic radiographs (no AI fill).
        Sources: peer-reviewed{" "}
        <a
          href="https://zenodo.org/records/19051776"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-tool-cyan)] hover:underline"
        >
          VetXRay (Zenodo, CC BY 4.0)
        </a>
        , Wikimedia Commons (CC BY / CC BY-SA), and anonymized CUVET teaching cases
        (Aj.-approved · PII-scrubbed via 4-pass pipeline).
        <br />
        <span className="text-[var(--color-text-muted)]">
          Coverage gaps we openly track:
        </span>{" "}
        stifle (lateral) —
        unfilled until real images land.
        Trust the badge, not the filename.{" "}
        <a
          href="/sources"
          className="text-[var(--color-tool-cyan)] hover:underline"
        >
          ดูแหล่งข้อมูลทั้งหมด →
        </a>
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
                // Phase 9: comment claimed 44px but actual class was 36/32 —
                // bumped to 44 mobile / 36 sm so the comment is finally
                // true. Atlas filter chips wrap into multi-row flex on a
                // phone — undersized chips next to each other are the
                // worst-case mistap surface.
                "inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3 py-2 rounded-md text-[12px] font-medium transition-colors",
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
// CredSegment removed in Phase 13 — atlas is 100% real so the
// real-vs-AI quick-filter pill is gone. Replaced by an informational
// provenance breakdown directly in the header.
