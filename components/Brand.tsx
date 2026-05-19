import Image from "next/image";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="w-full border-b border-stone-200 bg-white sticky top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 group" aria-label="Imaging Lab home">
          <Image
            src="/smo-logo.png"
            alt="CUVETSMO"
            width={32}
            height={32}
            className="rounded"
            priority
          />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-stone-900 group-hover:text-sky-700 transition-colors">
              Imaging Lab
            </div>
            <div className="text-[10px] uppercase tracking-wider text-stone-500">
              by CUVETSMO Labs
            </div>
          </div>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-3 text-sm">
          <Link href="/cases" className="px-2 py-1.5 text-stone-700 hover:text-sky-700 transition-colors">
            Cases
          </Link>
          <Link href="/occlusion" className="px-2 py-1.5 text-stone-700 hover:text-sky-700 transition-colors">
            Occlusion
          </Link>
          <Link href="/about" className="px-2 py-1.5 text-stone-700 hover:text-sky-700 transition-colors">
            About
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-stone-200 bg-stone-50 mt-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-stone-600">
        <div className="flex items-center gap-2">
          <Image src="/smo-logo.png" alt="" width={20} height={20} className="rounded" />
          <span>
            Part of{" "}
            <a href="https://labs.cuvetsmo.com" className="text-sky-700 hover:text-sky-900 underline underline-offset-2" rel="noreferrer">
              CUVETSMO Labs
            </a>{" "}
            ·{" "}
            <a href="https://cuvetsmo.com" className="text-sky-700 hover:text-sky-900 underline underline-offset-2" rel="noreferrer">
              cuvetsmo.com
            </a>
          </span>
        </div>
        <div className="text-stone-500">
          Educational tool. Not for clinical decisions.
        </div>
      </div>
    </footer>
  );
}
