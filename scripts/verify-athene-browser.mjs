import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'

const { chromium } = await import(pathToFileURL(process.argv[2]).href)
const origin = process.argv[3] ?? 'http://127.0.0.1:3413'
await mkdir(new URL('../work/browser/', import.meta.url), { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'th-TH' })
page.setDefaultTimeout(30000)
let externalActions = 0
await page.route('**/functions/v1/**', async (route) => { externalActions++; await route.abort() })
try {
  await page.goto(`${origin}/atlas/cuvet-canine-pelvis-vd-001`)
  await page.getByText('ติวการอ่านภาพต่อกับ Athene', { exact: true }).click()
  const link = page.getByRole('link', { name: 'เปิดร่างห้องติวใน Athene ↗', exact: true })
  assert.equal(await link.getAttribute('href'), 'https://ai.cuvetsmo.com/?handoff=imaging&kind=atlas&ref=cuvet-canine-pelvis-vd-001')
  assert.ok((await page.locator('details').filter({ has: link }).innerText()).includes('ไม่ส่งไฟล์ DICOM หรือบันทึกส่วนตัว'))
  const response = await page.request.get(`${origin}/api/athene-context?kind=atlas&id=cuvet-canine-pelvis-vd-001`, { headers: { Origin: 'https://ai.cuvetsmo.com' } })
  assert.equal(response.status(), 200)
  const context = await response.json()
  assert.equal(context.ref, 'cuvet-canine-pelvis-vd-001')
  assert.equal(context.images[0].url, 'https://imaging.cuvetsmo.com/atlas/cuvet-canine-pelvis-vd-001.png')
  assert.equal((await page.request.get(`${origin}/api/athene-context?kind=atlas&id=x`, { headers: { Origin: 'https://evil.test' } })).status(), 403)
  await page.screenshot({ path: fileURLToPath(new URL('../work/browser/atlas-handoff.png', import.meta.url)), fullPage: false })
  await page.goto(`${origin}/cases/cuvet-canine-pelvis-vd-001`)
  await page.getByRole('button', { name: /Skip recall/ }).waitFor()
  assert.equal(await page.getByText('ติวการอ่านภาพต่อกับ Athene', { exact: true }).count(), 0)
  await page.getByRole('button', { name: /Skip recall/ }).click()
  await page.getByText('ติวการอ่านภาพต่อกับ Athene', { exact: true }).click()
  assert.equal(await page.getByRole('link', { name: 'เปิดร่างห้องติวใน Athene ↗', exact: true }).getAttribute('href'), 'https://ai.cuvetsmo.com/?handoff=imaging&kind=case&ref=cuvet-canine-pelvis-vd-001')
  assert.equal(externalActions, 0)
  console.log('Imaging actual atlas/case UI, post-reveal gating, metadata endpoint/CORS and no provider upload: passed')
} finally { await browser.close() }
