import Image from "next/image";
import Link from "next/link";

/**
 * SiteHeader — quiet workspace chrome on the OHIF-dark surface.
 * Logo mark stays color, wordmark is bright on dark, subtext muted.
 * Nav links use cyan hover (tool accent) instead of the old sky-700.
 */
export function SiteHeader() {
  return (
    <header className="w-full border-b border-[var(--color-border)] bg-[var(--color-bg)]/85 sticky top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-bg)]/70">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 group" aria-label="Imaging Lab home">
          <Image
            src="/imaging-logo-mark.png"
            alt="Imaging Lab"
            width={32}
            height={32}
            className="rounded"
            priority
          />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-[var(--color-text)] group-hover:text-[var(--color-tool-cyan)] transition-colors">
              Imaging Lab
            </div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              by CUVETSMO Labs
            </div>
          </div>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-3 text-sm">
          <Link href="/cases" className="px-2 py-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-tool-cyan)] transition-colors">
            Cases
          </Link>
          <Link href="/occlusion" className="px-2 py-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-tool-cyan)] transition-colors">
            Occlusion
          </Link>
          <Link href="/about" className="px-2 py-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-tool-cyan)] transition-colors">
            About
          </Link>
        </nav>
      </div>
    </header>
  );
}

/**
 * SiteFooter — visually quieter than the other Labs themes so it does not
 * compete with the workspace chrome. Replaces the old comma-soup of
 * "Part of X · Y · Z" with line-broken units (no chained dots).
 */
export function SiteFooter() {
  return (
    <footer className="relative border-t border-[var(--color-border)] bg-[var(--color-surface-2)] mt-auto overflow-hidden">
      {/* Imaging eye mark watermark fades into the right edge */}
      <Image
        src="/imaging-logo-mark.png"
        alt=""
        aria-hidden
        width={300}
        height={300}
        className="pointer-events-none select-none absolute -right-16 -bottom-16 opacity-[0.06]"
      />
      <div className="relative mx-auto max-w-6xl px-4 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-[var(--color-text-muted)]">
        <div className="flex items-center gap-2.5">
          <Image
            src="/imaging-logo-mark.png"
            alt="CUVETSMO Imaging"
            width={22}
            height={22}
            className="rounded-sm"
          />
          <span>
            CUVETSMO Imaging, part of{" "}
            <a
              href="https://labs.cuvetsmo.com"
              className="text-[var(--color-tool-cyan)] hover:text-[#7DDCEF] underline underline-offset-2"
              rel="noreferrer"
            >
              CUVETSMO Labs
            </a>
          </span>
        </div>
        <div className="text-[var(--color-text-muted)]">
          Educational tool, not for clinical decisions.
        </div>
      </div>
    </footer>
  );
}
