import Image from "next/image";

/**
 * EcosystemBar — thin top-of-page strip carrying the shared CUVETSMO
 * ecosystem nav with real sub-brand logos. OHIF-dark color tokens.
 */

type EcosystemSite = "main" | "web3" | "labs" | "imaging" | "vetmock" | "hanong";

const SITES: { id: EcosystemSite; label: string; href: string; logo: string }[] = [
  { id: "main",    label: "cuvetsmo.com", href: "https://cuvetsmo.com",         logo: "/smo-logo.png" },
  { id: "web3",    label: "web3",         href: "https://web3.cuvetsmo.com",    logo: "/web3-logo-mark.png" },
  { id: "labs",    label: "labs",         href: "https://labs.cuvetsmo.com",    logo: "/labs-logo-mark.png" },
  { id: "imaging", label: "imaging",      href: "https://imaging.cuvetsmo.com", logo: "/imaging-logo-mark.png" },
  { id: "vetmock", label: "vetmock",      href: "https://vetmock.vercel.app",   logo: "/vetmock-logo-mark.png" },
  { id: "hanong",  label: "hanong",       href: "https://hanong.vercel.app",    logo: "/hanong-logo-mark.png" },
];

export function EcosystemBar({ current }: { current: EcosystemSite }) {
  return (
    <div
      className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/70 backdrop-blur-sm"
      role="navigation"
      aria-label="CUVETSMO ecosystem"
    >
      <div className="mx-auto max-w-6xl px-4 h-10 flex items-center gap-2 text-xs">
        <ol className="flex items-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar w-full">
          {SITES.map((s, i) => {
            const isCurrent = s.id === current;
            const content = (
              <>
                <Image
                  src={s.logo}
                  alt=""
                  width={16}
                  height={16}
                  className="rounded-sm shrink-0"
                />
                <span className="hidden sm:inline whitespace-nowrap">{s.label}</span>
              </>
            );
            return (
              <li key={s.id} className="flex items-center gap-1.5 sm:gap-2">
                {i > 0 && (
                  <span aria-hidden className="text-[var(--color-text-muted)] opacity-30 select-none">
                    /
                  </span>
                )}
                {isCurrent ? (
                  <span
                    className="inline-flex items-center gap-1.5 px-1.5 py-0.5 font-semibold text-[var(--color-text)]"
                    aria-current="page"
                    title={s.label}
                  >
                    {content}
                  </span>
                ) : (
                  <a
                    href={s.href}
                    className="inline-flex items-center gap-1.5 px-1.5 py-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-tool-cyan)] transition-colors"
                    title={s.label}
                  >
                    {content}
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
