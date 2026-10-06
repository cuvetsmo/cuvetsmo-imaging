import { ATLAS_ENTRIES, type AtlasEntry } from './atlas'
import { CASES } from './cases'

const ORIGIN = 'https://imaging.cuvetsmo.com'
const DATA_REVISION = 'ab49a30'
export type ImagingContext = {
  schema_version: 1; surface: 'imaging'; kind: 'atlas' | 'case'; ref: string; title: string; summary: string; points: string[]; source_url: string;
  images: { url: string; alt: string; license: string; attribution: string; source_url: string }[];
  provenance: { url: string; license: string | null; attribution: string | null; data_revision: string };
  retrieved_at: string;
}

function imageFor(entry: AtlasEntry | undefined): ImagingContext['images'] {
  if (!entry || !/^\/atlas\/[a-z\d-]+\.(png|jpe?g)$/i.test(entry.image_path)) return []
  return [{ url: `${ORIGIN}${entry.image_path}`, alt: `${entry.species} ${entry.body_part} ${entry.view}`, license: entry.license, attribution: entry.attribution ?? '', source_url: `${ORIGIN}/atlas/${entry.slug}` }]
}

/** Curated public teaching metadata only: no local files, notes, patient tags or answer keys. */
export function imagingContext(kind: string, ref: string, now = new Date()): ImagingContext | null {
  if (!['atlas', 'case'].includes(kind) || !/^[a-z\d-]{1,100}$/i.test(ref)) return null
  const entry = kind === 'atlas' ? ATLAS_ENTRIES.find((row) => row.slug === ref || row.id === ref) : CASES.find((row) => row.slug === ref || row.id === ref)
  if (!entry) return null
  const atlas = kind === 'atlas' ? entry as AtlasEntry : ATLAS_ENTRIES.find((row) => row.slug === entry.slug)
  const source_url = `${ORIGIN}/${kind === 'atlas' ? 'atlas' : 'cases'}/${entry.slug}`
  const record = kind === 'atlas' ? { title: `${entry.species} ${entry.body_part} ${(entry as AtlasEntry).view}`, summary: (entry as AtlasEntry).description, points: (entry as AtlasEntry).learning_landmarks ?? [] }
    : { title: (entry as typeof CASES[number]).title, summary: (entry as typeof CASES[number]).history ?? '', points: (entry as typeof CASES[number]).learning_objectives ?? [] }
  return {
    schema_version: 1, surface: 'imaging', kind: kind as 'atlas' | 'case', ref: entry.slug,
    title: record.title.slice(0, 240), summary: record.summary.slice(0, 1800), points: record.points.slice(0, 12).map((point) => point.slice(0, 240)),
    source_url, images: imageFor(atlas),
    provenance: { url: entry.source_url && entry.source_url !== 'internal' ? entry.source_url : source_url, license: entry.license ?? null, attribution: entry.attribution ?? null, data_revision: DATA_REVISION },
    retrieved_at: now.toISOString(),
  }
}

export function imagingHandoff(kind: 'atlas' | 'case', ref: string): string | null {
  const record = imagingContext(kind, ref)
  if (!record) return null
  const url = new URL('https://ai.cuvetsmo.com/')
  url.search = new URLSearchParams({ handoff: 'imaging', kind, ref: record.ref }).toString()
  return url.href
}
