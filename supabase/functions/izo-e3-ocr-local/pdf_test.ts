import { strict as assert } from 'node:assert'
import { PDFDocument } from 'npm:pdf-lib@1.17.1'
import { verificaPdf } from './pdf.ts'

Deno.test('PDF real Deno/pdf-lib: mono, multi, object streams, faux /Type /Page în conținut', async () => {
  for (const n of [1, 2]) {
    const pdf = await PDFDocument.create()
    for (let i = 0; i < n; i++) pdf.addPage().drawText('/Type /Page /Type /Page')
    const bytes = await pdf.save({ useObjectStreams: true })
    assert.equal(await verificaPdf(bytes), n === 1 ? 'mono' : 'multi')
  }
})
Deno.test('PDF trunchiat, criptat și structură invalidă sunt erori, fără fallback automat', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage()
  const bytes = await pdf.save()
  assert.equal(await verificaPdf(bytes.subarray(0, bytes.length - 30)), 'invalid')
  assert.equal(await verificaPdf(new TextEncoder().encode('%PDF-1.7\ngarbage\n%%EOF')), 'invalid')
  assert.equal(await verificaPdf(new TextEncoder().encode('nu e PDF')), 'invalid')
  // Fixture minim cu trailer criptat: pdf-lib îl refuză înainte de citirea paginilor.
  const encrypted = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n3 0 obj\n<< /Filter /Standard /V 1 /R 2 /P -4 >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 3 0 R >>\n%%EOF')
  assert.equal(await verificaPdf(encrypted), 'invalid')
})
Deno.test('verificarea rulează în proces: niciun Worker / modul încărcat dinamic (nu intră în bundle-ul deployat)', async () => {
  const sursa = await Deno.readTextFile(new URL('./pdf.ts', import.meta.url))
  assert.ok(!/new\s+Worker\s*\(/.test(sursa) && !/new\s+URL\s*\(/.test(sursa) && !/import\s*\(/.test(sursa))
  const Original = globalThis.Worker
  try {
    globalThis.Worker = class { constructor() { throw new Error('worker indisponibil') } } as unknown as typeof Worker
    const pdf = await PDFDocument.create(); pdf.addPage()
    assert.equal(await verificaPdf(await pdf.save()), 'mono')
  } finally { globalThis.Worker = Original }
})
