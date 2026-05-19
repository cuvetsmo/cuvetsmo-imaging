import Image from "next/image";

/**
 * EcosystemBar — thin top-of-page strip carrying the shared CUVETSMO
 * brand mark + 4 ecosystem links. Same content on every subdomain so
 * visitors hopping between sites feel they are inside one family even
 * though each lab has its own theme.
 *
 * Imaging uses the OHIF-dark token set so the bar reads on near-black.
 */

type EcosystemSite = "main" | "web3" | "labs" | "imaging";

const SITES: { id: EcosystemSite; label: string; href: string }[] = [
  { id: "main", label: "cuvetsmo.com", href: "https://cuvetsmo.com" },
  { id: "web3", label: "web3", href: "https://web3.cuvetsmo.com" },
  { id: "labs", label: "labs", href: "https://labs.cuvetsmo.com" },
  { id: "imaging", label: "imaging", href: "https://imaging.cuvetsmo.com" },
];

export function EcosystemBar({ current }: { current: EcosystemSite }) {
  return (
    <div
      className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/70 backdrop-blur-sm"
      role="navigation"
      aria-label="CUVETSMO ecosystem"
    >
      <div className="mx-auto max-w-6xl px-4 h-9 flex items-center gap-3 text-xs">
        <a
          href="https://cuvetsmo.com"
          className="inline-flex items-center gap-1.5 shrink-0"
          aria-label="CUVETSMO home"
        >
          <Image
            src="/smo-logo.png"
            alt=""
            width={18}
            height={18}
            className="rounded-sm opacity-90"
          />
          <span className="font-semibold tracking-tight text-[var(--color-text)] hidden sm:inline">
            CUVETSMO
          </span>
        </a>
        <span aria-hidden className="text-[var(--color-text-muted)] opacity-40 hidden sm:inline">
          ·
        </span>
        <ol className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {SITES.map((s, i) => {
            const isCurrent = s.id === current;
            return (
              <li key={s.id} className="flex items-center gap-1">
                {i > 0 && (
                  <span aria-hidden className="text-[var(--color-text-muted)] opacity-35">
                    /
                  </span>
                )}
                {isCurrent ? (
                  <span
                    className="font-semibold text-[var(--color-text)] px-1.5"
                    aria-current="page"
                  >
                    {s.label}
                  </span>
                ) : (
                  <a
                    href={s.href}
                    className="px-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-tool-cyan)] transition-colors"
                  >
                    {s.label}
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
