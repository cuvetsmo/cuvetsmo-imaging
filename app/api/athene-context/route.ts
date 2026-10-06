import { imagingContext } from '@/lib/athene-context'

function cors(req: Request): Headers | null {
  const origin = req.headers.get('origin')
  const dev = process.env.NODE_ENV !== 'production' ? process.env.ATHENE_DEV_ORIGIN : undefined
  const allowed = origin === 'https://ai.cuvetsmo.com' || Boolean(dev && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(dev) && origin === dev)
  if (origin && !allowed) return null
  return new Headers({ Vary: 'Origin', ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}), 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'X-Content-Type-Options': 'nosniff' })
}

export function GET(req: Request) {
  const headers = cors(req)
  if (!headers) return Response.json({ error: 'origin_not_allowed' }, { status: 403 })
  const params = new URL(req.url).searchParams
  const kind = params.get('kind') ?? ''
  if (params.getAll('ref').length > 1 || params.getAll('id').length > 1 || params.getAll('kind').length > 1 || (params.has('ref') && params.has('id') && params.get('ref') !== params.get('id'))) return Response.json({ error: 'conflicting_selector' }, { status: 400, headers })
  const ref = params.get('ref') ?? params.get('id') ?? ''
  if (!kind || !/^[a-z\d-]{1,100}$/i.test(ref)) return Response.json({ error: 'invalid_selector' }, { status: 400, headers })
  const context = imagingContext(kind, ref)
  if (!context) return Response.json({ error: 'context_not_found' }, { status: 404, headers })
  headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60')
  return Response.json(context, { headers })
}

export function OPTIONS(req: Request) {
  const headers = cors(req)
  return headers ? new Response(null, { status: 204, headers }) : new Response(null, { status: 403 })
}
