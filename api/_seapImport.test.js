// /api/seap-import pe handlerul real (Copilot conv. 3, NO-GO r2 pe #641, P1): o arhivă din DownloadArchive intră
// „neprocesat”, fără notă — o despachetează bucla workerului NAS (garda dejaDesfacutaPeSeap previne a doua despachetare);
// celelalte non-PDF rămân „ignorat” cu notă; tipul vine din clasificatorul comun (arhiva = 'alta', container).
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), fetch: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
import seap from './seap-import.js'

// ZIP „stored” (fără compresie), cu dimensiunile în antetul local — exact ce citește fluxul handlerului
function zipStored(intrari) {
  const parti = []
  for (const [nume, continut] of Object.entries(intrari)) {
    const n = Buffer.from(nume, 'utf8'), d = Buffer.from(continut)
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0, 6); h.writeUInt16LE(0, 8)
    h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26); h.writeUInt16LE(0, 28)
    parti.push(h, n, d)
  }
  return Buffer.concat(parti)
}

function fakeSupa(randuri) {
  const builder = (tabel) => {
    let op = 'select', patch = null
    const b = {
      select() { return b }, eq() { return b }, order() { return b }, limit() { return b },
      insert(p) { op = 'insert'; patch = p; return b },
      update(p) { op = 'update'; patch = p; return b },
      upsert() { op = 'upsert'; return b },
      single() { return Promise.resolve({ data: { id: 7, nr_anunt: 'CN1', c_notice_id: 11, sys_notice_type_id: 2 }, error: null }) },
      maybeSingle() { return b.then((x) => ({ data: x.data?.[0] ?? null, error: x.error })) },
      then(res, rej) {
        let data = []
        if (tabel === 'ofertare_documente_atribuire' && op === 'insert') { const r = { id: 100 + randuri.length, ...patch }; randuri.push(r); data = [r] }
        return Promise.resolve({ data, error: null }).then(res, rej)
      },
    }
    return b
  }
  return { from: builder, storage: { from: () => ({ upload: async () => ({ error: null }) }) } }
}

const response = () => {
  const res = { statusCode: 200, body: undefined }
  res.status = vi.fn((c) => { res.statusCode = c; return res })
  res.json = vi.fn((b) => { res.body = b; return res })
  res.end = vi.fn(() => res)
  return res
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('SUPABASE_URL', 'https://local.invalid')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
  vi.stubEnv('SEAP_IMPORT_SECRET', 'internal-secret')
  vi.stubGlobal('fetch', mocks.fetch)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('api/seap-import: arhivele din DownloadArchive', () => {
  it('arhiva → neprocesat fără notă, tip alta; PDF → neprocesat; docx → ignorat cu notă', async () => {
    const randuri = []
    mocks.createClient.mockReturnValue(fakeSupa(randuri))
    mocks.fetch.mockResolvedValue(new Response(zipStored({
      'Fisa de date.pdf': '%PDF-1.4 f', 'PT.zip': 'PK\u0003\u0004 interior', 'Volum 2.rar': 'Rar!', 'Anexa.docx': 'x',
    })))
    const res = response()
    await seap({ method: 'POST', headers: { 'x-import-secret': 'internal-secret' }, body: { licitatie_id: 7 } }, res)
    expect(res.statusCode).toBe(200)
    const pe = Object.fromEntries(randuri.map((r) => [r.nume_original, [r.tip, r.status_procesare, r.eroare]]))
    expect(pe['PT.zip']).toEqual(['alta', 'neprocesat', null])
    expect(pe['Volum 2.rar']).toEqual(['alta', 'neprocesat', null])
    expect(pe['Fisa de date.pdf']).toEqual(['fisa_date', 'neprocesat', null])
    expect(pe['Anexa.docx'][0]).toBe('alta')
    expect(pe['Anexa.docx'][1]).toBe('ignorat')
    expect(pe['Anexa.docx'][2]).toMatch(/^non-PDF/)
  })
})
