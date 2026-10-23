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
Deno.test('validator blocat sau indisponibil: timeout 3s, worker oprit, neverificabil', async () => {
  const Original = globalThis.Worker
  let terminated = 0
  const bytes = new TextEncoder().encode('%PDF-1.7\n%%EOF')
  try {
    globalThis.Worker = class {
      postMessage() { /* simulează parserul blocat */ }
      terminate() { terminated++ }
    } as unknown as typeof Worker
    const start = performance.now()
    assert.equal(await verificaPdf(bytes), 'neverificabil')
    assert.ok(performance.now() - start >= 2900)
    assert.equal(terminated, 1)
    globalThis.Worker = class { constructor() { throw new Error('worker indisponibil') } } as unknown as typeof Worker
    assert.equal(await verificaPdf(bytes), 'neverificabil')
  } finally { globalThis.Worker = Original }
})
