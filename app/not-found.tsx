import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <div className="text-5xl mb-4">📭</div>
      <h1 className="text-2xl font-semibold text-stone-900 mb-2">404 — Page not found</h1>
      <p className="text-stone-600 mb-6">
        หน้านี้ไม่อยู่ใน Imaging Lab — ลองกลับไป homepage หรือ case library.
      </p>
      <div className="flex justify-center gap-3">
        <Link href="/" className="vmx-btn vmx-btn-primary vmx-btn-sm">
          ← Home
        </Link>
        <Link href="/cases" className="vmx-btn vmx-btn-ghost vmx-btn-sm">
          Case library
        </Link>
      </div>
    </div>
  );
}
