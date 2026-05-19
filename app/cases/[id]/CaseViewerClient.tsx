'use client';
import { useEffect, useState, Suspense, lazy } from 'react';
import Link from 'next/link';
import type { ImagingCase } from '@/lib/cases';

const DicomViewport = lazy(() => import('@/components/lab/DicomViewport.jsx'));
const TagInspector = lazy(() => import('@/components/lab/TagInspector.jsx'));

type Status = 'loading' | 'ready' | 'not-found' | 'error';

export function CaseViewerClient({ caseId }: { caseId: string }) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [caseMeta, setCaseMeta] = useState<ImagingCase | null>(null);
  const [files, setFiles] = useState<File[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Read the static case index. Slug or id both work.
        const idxRes = await fetch('/cases.json', { cache: 'no-store' });
        if (!idxRes.ok) throw new Error(`Case index HTTP ${idxRes.status}`);
        const idx = (await idxRes.json()) as ImagingCase[];
        const meta = idx.find((c) => c.slug === caseId || c.id === caseId);
        if (!meta) {
          if (!cancelled) setStatus('not-found');
          return;
        }
        if (!cancelled) setCaseMeta(meta);
        // Fetch each .dcm file as a Blob → File so it slots into the
        // viewer's File-based API directly.
        const fetched = await Promise.all(
          meta.files.slice(0, 2).map(async (entry) => {
            const r = await fetch(entry.path, { cache: 'force-cache' });
            if (!r.ok) throw new Error(`${entry.path} HTTP ${r.status}`);
            const buf = await r.arrayBuffer();
            return new File([buf], `${meta.slug}_${entry.view_name}.dcm`, {
              type: 'application/dicom',
            });
          }),
        );
        if (!cancelled) {
          setFiles(fetched);
          setStatus('ready');
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  if (status === 'loading') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-stone-500">
        ⏳ Loading case <code className="text-stone-700">{caseId}</code>…
      </div>
    );
  }

  if (status === 'not-found') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <div className="text-4xl mb-3">📭</div>
        <h1 className="text-xl font-semibold mb-2">Case not found</h1>
        <p className="text-stone-600 text-sm mb-4">
          ไม่พบ case <code>{caseId}</code> ใน <code>/cases.json</code>
        </p>
        <Link href="/cases" className="text-sky-700 underline underline-offset-4">
          ← Back to case library
        </Link>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <h1 className="text-xl font-semibold mb-2">Failed to load case</h1>
        <p className="text-stone-600 text-sm mb-4">{error}</p>
        <Link href="/cases" className="text-sky-700 underline underline-offset-4">
          ← Back to case library
        </Link>
      </div>
    );
  }

  if (!caseMeta || files.length === 0) return null;

  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-5 py-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="text-sm text-stone-700">
          <strong>📚 {caseMeta.title}</strong>{" "}
          <span className="text-stone-500">
            · {[caseMeta.species, caseMeta.signalment].filter(Boolean).join(' · ')}
          </span>
        </div>
        <Link href="/cases" className="vmx-btn vmx-btn-ghost vmx-btn-sm">← Back to library</Link>
      </div>

      {caseMeta.history && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-stone-700 mb-3">
          <strong>History:</strong> {caseMeta.history}
        </div>
      )}

      {(caseMeta.license || caseMeta.source_url || caseMeta.attribution) && (
        <div className="rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-stone-700 mb-3">
          {caseMeta.license && <span>📜 <strong>{caseMeta.license}</strong></span>}
          {caseMeta.source_url && caseMeta.source_url !== 'internal' && (
            <>
              {' '}·{' '}
              <a href={caseMeta.source_url} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline">
                source ↗
              </a>
            </>
          )}
          {caseMeta.attribution && (
            <div className="text-stone-500 text-xs mt-1">{caseMeta.attribution}</div>
          )}
        </div>
      )}

      <div
        className={
          files.length >= 2
            ? 'grid grid-cols-1 lg:grid-cols-2 gap-3'
            : ''
        }
      >
        {files.map((f, i) => (
          <CaseViewerPane key={f.name} file={f} index={i} caseId={caseMeta.id} />
        ))}
      </div>

      {caseMeta.learning_objectives && caseMeta.learning_objectives.length > 0 && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm mt-3">
          <strong>🎯 Learning objectives</strong>
          <ul className="mt-2 list-disc pl-5 text-stone-700 space-y-1">
            {caseMeta.learning_objectives.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function CaseViewerPane({ file, index, caseId }: { file: File; index: number; caseId: string }) {
  const [showTags, setShowTags] = useState(false);
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-2">
      <div className="flex items-center justify-between gap-2 px-1 py-1 text-sm text-stone-600">
        <span>
          <strong>View {index + 1}:</strong>{' '}
          <span className="text-stone-500 text-xs">{file.name}</span>
        </span>
        <button
          onClick={() => setShowTags((s) => !s)}
          className="vmx-btn vmx-btn-ghost vmx-btn-sm"
        >
          🔍 Info
        </button>
      </div>
      <Suspense fallback={<div className="p-10 text-center text-stone-500">กำลังโหลด viewer...</div>}>
        <DicomViewport file={file} caseId={caseId} syncEnabled={false} />
      </Suspense>
      {showTags && (
        <Suspense fallback={null}>
          <TagInspector file={file} onClose={() => setShowTags(false)} />
        </Suspense>
      )}
    </div>
  );
}
