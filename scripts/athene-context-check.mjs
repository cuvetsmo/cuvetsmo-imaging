import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import ts from 'typescript'

const modules = new Map()
async function compile(relative) {
  const url = new URL(relative, import.meta.url)
  if (modules.has(url.href)) return modules.get(url.href)
  let code = ts.transpileModule(await readFile(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const match of [...code.matchAll(/from ['"]([^'"]+)['"]/g)]) {
    if (match[1] === '@/lib/athene-context') code = code.replace(match[0], `from ${JSON.stringify(await compile('../lib/athene-context.ts'))}`)
    else if (match[1].startsWith('.')) code = code.replace(match[0], `from ${JSON.stringify(await compile(new URL(`${match[1]}.ts`, url).href))}`)
  }
  const uri = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  modules.set(url.href, uri)
  return uri
}
const { ATLAS_ENTRIES } = await import(await compile('../lib/atlas.ts'))
const { CASES } = await import(await compile('../lib/cases.ts'))
const context = await import(await compile('../lib/athene-context.ts'))
const route = await import(await compile('../app/api/athene-context/route.ts'))
for (const [kind, rows] of [['atlas', ATLAS_ENTRIES], ['case', CASES]]) {
  for (const record of rows) {
    const payload = context.imagingContext(kind, record.slug, new Date('2026-10-06T00:00:00Z'))
    assert.equal(payload.ref, record.slug)
    assert.equal(payload.kind, kind)
    assert.equal(payload.retrieved_at, '2026-10-06T00:00:00.000Z')
    assert.ok(payload.source_url.endsWith(`/${record.slug}`))
    assert.ok(!('recall' in payload) && !('files' in payload) && !('final_diagnosis' in payload) && !('student_notes' in payload))
    assert.ok(payload.title.length <= 240 && payload.summary.length <= 1800 && payload.points.length <= 12)
    assert.ok(payload.images.length <= 1)
    for (const image of payload.images) {
      assert.equal(new URL(image.url).origin, 'https://imaging.cuvetsmo.com')
      assert.ok(image.license)
      await access(new URL(`../public${new URL(image.url).pathname}`, import.meta.url))
    }
    const handoff = new URL(context.imagingHandoff(kind, record.slug))
    assert.equal(handoff.origin, 'https://ai.cuvetsmo.com')
    assert.deepEqual([...handoff.searchParams.keys()], ['handoff', 'kind', 'ref'])
    assert.equal(handoff.searchParams.get('ref'), record.slug)
  }
}
assert.equal(context.imagingContext('atlas', '../private'), null)
assert.equal(context.imagingContext('patient', 'secret'), null)
assert.equal(context.imagingHandoff('atlas', 'missing-real-id'), null)
const ref = ATLAS_ENTRIES[0].slug
const request = (query, origin) => new Request(`https://imaging.cuvetsmo.com/api/athene-context?${query}`, { headers: origin ? { origin } : {} })
const ok = route.GET(request(`kind=atlas&id=${ref}`, 'https://ai.cuvetsmo.com'))
assert.equal(ok.status, 200)
assert.equal(ok.headers.get('access-control-allow-origin'), 'https://ai.cuvetsmo.com')
assert.equal(ok.headers.get('access-control-allow-credentials'), null)
assert.equal(ok.headers.get('vary'), 'Origin')
assert.match(ok.headers.get('cache-control'), /max-age=300/)
assert.equal((await ok.json()).ref, ref)
assert.equal(route.GET(request(`kind=atlas&id=${ref}`, 'https://evil.test')).status, 403)
assert.equal(route.GET(request('kind=atlas&id=../patient')).status, 400)
assert.equal(route.GET(request('kind=atlas&id=unknown-slug')).status, 404)
assert.equal(route.OPTIONS(request('', 'https://ai.cuvetsmo.com')).status, 204)
assert.equal((await route.GET(request(`kind=atlas&ref=${ref}`)).json()).ref, ref)
assert.equal(route.GET(request(`kind=atlas&ref=${ref}&id=conflict`)).status, 400)
assert.equal(route.GET(request(`kind=atlas&ref=${ref}&ref=${ref}`)).status, 400)
const savedEnv = { mode: process.env.NODE_ENV, origin: process.env.ATHENE_DEV_ORIGIN }
try {
  process.env.NODE_ENV = 'development'; process.env.ATHENE_DEV_ORIGIN = 'http://127.0.0.1:3411'
  assert.equal(route.GET(request(`kind=atlas&id=${ref}`, 'http://127.0.0.1:3411')).status, 200)
  process.env.NODE_ENV = 'production'
  assert.equal(route.GET(request(`kind=atlas&id=${ref}`, 'http://127.0.0.1:3411')).status, 403)
} finally {
  if (savedEnv.mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedEnv.mode
  if (savedEnv.origin === undefined) delete process.env.ATHENE_DEV_ORIGIN; else process.env.ATHENE_DEV_ORIGIN = savedEnv.origin
}
console.log('Imaging real catalogue/image provenance, metadata-only handoff and endpoint CORS checks: passed')
