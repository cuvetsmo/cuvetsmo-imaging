import Image from "next/image";
import Link from "next/link";
import {
  type AtlasEntry,
  type Credibility,
  BODY_PART_LABELS,
  SPECIES_LABELS,
} from "@/lib/atlas";

/**
 * AtlasCard — single tile in the atlas grid.
 *
 * Reuses the .imaging-tool-tile chrome (gradient ring hover, lift +2px)
 * but lays out content vertically: image art on top, meta below. The
 * .imaging-tile-art class lets the parent tile drive color transitions
 * on hover for any SVG/glyph that uses currentColor, but for raster
 * images we just rely on the ring + lift effect.
 *
 * The card is the whole interactive surface (Link wraps everything),
 * so we don't need an inner CTA button — the hover state itself
 * signals tappability.
 */
export function AtlasCard({ entry }: { entry: AtlasEntry }) {
  const species = SPECIES_LABELS[entry.species];
  const part = BODY_PART_LABELS[entry.body_part];
  const cred = getCredBadge(entry.credibility);

  return (
    <Link
      href={`/atlas/${entry.slug}`}
      className="imaging-tool-tile group !flex-col !p-0 !gap-0 overflow-hidden"
    >
      {/* Image — fixed aspect 4:3 to match the source 800x600. Pure
          black underlay so darker radiograph backgrounds blend in. */}
      <div className="relative w-full aspect-[4/3] bg-black">
        <Image
          src={entry.image_path}
          alt={`${species} ${part} ${entry.view} radiograph — atlas reference`}
          fill
          sizes="(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw"
          className="object-cover"
          loading="lazy"
        />
        {/* Modality + view badge — top-left, monospace */}
        <div className="absolute top-2 left-2 inline-flex items-center gap-1 rounded bg-[rgba(0,0,0,0.7)] backdrop-blur-sm px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-tool-cyan)] border border-[var(--color-border-bright)] font-mono">
          {entry.modality} · {entry.view}
        </div>
        {/* Credibility honesty badge — bottom-right, ALWAYS rendered for
            visual parity. Peer-reviewed gets a cyan checkmark; community /
            open-textbook / cuvet-internal get a green checkmark. Atlas is
            100% real (Phase 13 / 21) so there's no AI badge branch.
            Same position so students can scan the corner once and know
            what they're looking at. */}
        {cred && (
          <div
            className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded bg-[rgba(0,0,0,0.7)] backdrop-blur-sm px-1.5 py-0.5 text-[9px] uppercase tracking-wider border font-mono"
            style={{ color: cred.color, borderColor: cred.borderColor }}
            aria-label={cred.ariaLabel}
          >
            {cred.label}
          </div>
        )}
      </div>

      {/* Meta strip — title + 1-line description. View label lives on the
          image badge (top-left), so the meta strip carries only species/part
          to avoid double-stamp. */}
      <div className="flex-1 min-w-0 p-3.5">
        <div className="font-semibold text-[var(--color-text)] tracking-tight text-[14px] truncate mb-1">
          {species} {part}
        </div>
        <div className="text-[12px] text-[var(--color-text-muted)] leading-relaxed line-clamp-2">
          {entry.description}
        </div>
      </div>
    </Link>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Credibility → badge mapping. Colors match the global token system:
//  - cyan (#5ACCE6) = peer-reviewed (most rigorous · Zenodo dataset)
//  - green (#34D399, --color-finalized) = community + open-textbook +
//    cuvet-internal (verified but less formal)
// Atlas is 100% real (Palm directive 2026-05-26) — no AI badge.
// Keeping inline color refs (vs CSS classes) lets us drive both the
// foreground and border off the same token in one place; if you change
// a token in globals.css this still tracks because the values mirror it.
// ───────────────────────────────────────────────────────────────────────
type CredBadge = {
  label: string;
  color: string;
  borderColor: string;
  ariaLabel: string;
};

function getCredBadge(c: Credibility): CredBadge | null {
  switch (c) {
    case "peer-reviewed":
      return {
        label: "✓ Peer-reviewed",
        color: "#5ACCE6", // --color-tool-cyan
        borderColor: "rgba(90,204,230,0.55)",
        ariaLabel: "Peer-reviewed reference radiograph",
      };
    case "community":
      return {
        label: "✓ Community",
        color: "#34D399", // --color-finalized
        borderColor: "rgba(52,211,153,0.55)",
        ariaLabel: "Community-sourced reference radiograph",
      };
    case "open-textbook":
      return {
        label: "✓ Textbook",
        color: "#34D399", // --color-finalized (grouped with community)
        borderColor: "rgba(52,211,153,0.55)",
        ariaLabel: "Open-textbook reference radiograph",
      };
    case "cuvet-internal":
      return {
        label: "✓ CUVET",
        color: "#34D399", // --color-finalized
        borderColor: "rgba(52,211,153,0.55)",
        ariaLabel: "CUVET internal reference radiograph",
      };
    default:
      return null;
  }
}
