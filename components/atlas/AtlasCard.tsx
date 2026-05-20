import Image from "next/image";
import Link from "next/link";
import {
  type AtlasEntry,
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
        {/* AI-generated honesty badge — bottom-right when applicable */}
        {entry.credibility === "ai-generated" && (
          <div className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded bg-[rgba(0,0,0,0.7)] backdrop-blur-sm px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--color-text-muted)] border border-[var(--color-border)] font-mono">
            AI-gen
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
