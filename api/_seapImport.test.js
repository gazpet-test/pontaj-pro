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
  // directorul central + înregistrarea finală (conținutul lor nu e citit în flux, doar semnătura de început contează)
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0)
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0)
  parti.push(cd, eocd)
  return Buffer.concat(parti)
}

function fakeSupa(randuri) {
  const builder = (tabel) => {
    let op = 'select', patch = null, de = 0, cate = Infinity
    const b = {
      // range respectat ca la PostgREST: toatePaginile (_paginat.js) se oprește la prima pagină goală
      select() { return b }, eq() { return b }, order() { return b }, limit() { return b }, range(a, z) { de = a; cate = z - a + 1; return b },
      insert(p) { op = 'insert'; patch = p; return b },
      update(p) { op = 'update'; patch = p; return b },
      upsert() { op = 'upsert'; return b },
      single() { return Promise.resolve({ data: { id: 7, nr_anunt: 'CN1', c_notice_id: 11, sys_notice_type_id: 2 }, error: null }) },
      maybeSingle() { return b.then((x) => ({ data: x.data?.[0] ?? null, error: x.error })) },
      then(res, rej) {
        let data = []
        if (tabel === 'ofertare_documente_atribuire' && op === 'insert') { const r = { id: 100 + randuri.length, ...patch }; randuri.push(r); data = [r] }
        if (op === 'select') data = data.slice(de, de + cate)
        return Promise.resolve({ data, error: null }).then(res, rej)
      },
    }
    return b
  }
  return { from: builder, storage: { from: () => ({ upload: async () => ({ error: null }) }) } }
}

// container CMS SignedData minimal (structura pe care o parcurge _semnaturaCms.js), cu conținutul atașat
function cmsSintetic(text) {
  const der = (tag, ...parti) => {
    const corp = Buffer.concat(parti), n = corp.length
    const l = n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff])
    return Buffer.concat([Buffer.from([tag]), l, corp])
  }
  const oid = (h) => der(0x06, Buffer.from(h, 'hex'))
  const eci = der(0x30, oid('2a864886f70d010701'), der(0xa0, der(0x04, Buffer.from(text))))
  const sd = der(0x30, der(0x02, Buffer.from([1])), der(0x31), eci, der(0x31))
  return der(0x30, oid('2a864886f70d010702'), der(0xa0, sd))
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
  it('semnătura nedesfăcută (#20): „X.rar.p7m” urcat întreg (neprocesat, alta, fără notă) → îl încearcă workerul; documentul „Caiet.pdf.p7m” → ignorat cu nota explicită', async () => {
    const randuri = []
    mocks.createClient.mockReturnValue(fakeSupa(randuri))
    mocks.fetch.mockResolvedValue(new Response(zipStored({ 'Raspuns consolidat.rar.p7m': '0\u0082 cms', 'Caiet.pdf.p7m': '0\u0082 cms' })))
    const res = response()
    await seap({ method: 'POST', headers: { 'x-import-secret': 'internal-secret' }, body: { licitatie_id: 7 } }, res)
    const pe = Object.fromEntries(randuri.map((r) => [r.nume_original, [r.tip, r.status_procesare, r.eroare]]))
    expect(pe['Raspuns consolidat.rar.p7m']).toEqual(['alta', 'neprocesat', null])
    expect(pe['Caiet.pdf.p7m'][1]).toBe('ignorat')
    expect(pe['Caiet.pdf.p7m'][2]).toMatch(/^Semnătura electronică nu s-a putut desface/)
    expect(Object.keys(pe).sort()).toEqual(['Caiet.pdf.p7m', 'Raspuns consolidat.rar.p7m'])
  })
  it('var. B: „Caiet.pdf.p7m” cu CMS atașat → conținutul desfăcut, sub „Caiet (semnat).pdf”, neprocesat', async () => {
    const randuri = []
    mocks.createClient.mockReturnValue(fakeSupa(randuri))
    mocks.fetch.mockResolvedValue(new Response(zipStored({ 'Caiet.pdf.p7m': cmsSintetic('%PDF-1.4 caiet') })))
    const res = response()
    await seap({ method: 'POST', headers: { 'x-import-secret': 'internal-secret' }, body: { licitatie_id: 7 } }, res)
    expect(randuri.map((r) => [r.nume_original, r.status_procesare, r.size_bytes])).toEqual([['Caiet (semnat).pdf', 'neprocesat', 14]])
  })
  it('gunoi = segment întreg (audit #18): „__MACOSX/…” și „Thumbs.db” sărite, „__MACOSX_documentatie.pdf” urcat', async () => {
    const randuri = []
    mocks.createClient.mockReturnValue(fakeSupa(randuri))
    mocks.fetch.mockResolvedValue(new Response(zipStored({ '__MACOSX/._Caiet.pdf': 'x', 'Thumbs.db': 'x', '__MACOSX_documentatie.pdf': '%PDF-1.4 d' })))
    const res = response()
    await seap({ method: 'POST', headers: { 'x-import-secret': 'internal-secret' }, body: { licitatie_id: 7 } }, res)
    expect(randuri.map((r) => r.nume_original)).toEqual(['__MACOSX_documentatie.pdf'])
  })
})

describe('api/seap-import: aceeași cheie de nume ca celelalte drumuri (audit #16) + placeholder consumat o dată (#2)', () => {
  function fakeCuExistente(existente, scrise) {
    const builder = (tabel) => {
      let op = 'select', patch = null, idCerut = null, sel = false, de = 0, cate = Infinity
      const b = {
        select() { sel = true; return b }, eq(c, v) { if (c === 'id') idCerut = v; return b }, order() { return b }, limit() { return b }, range(a, z) { de = a; cate = z - a + 1; return b },
        or() { return b }, in() { return b },
        insert(p) { op = 'insert'; patch = p; return b }, update(p) { op = 'update'; patch = p; return b }, upsert() { op = 'upsert'; return b },
        single() { return Promise.resolve({ data: { id: 7, nr_anunt: 'CN1', c_notice_id: 11, sys_notice_type_id: 2 }, error: null }) },
        maybeSingle() { return b.then((x) => ({ data: x.data?.[0] ?? null, error: x.error })) },
        then(res, rej) {
          let data = []
          if (tabel === 'ofertare_documente_atribuire') {
            if (op === 'select') data = existente.slice(de, de + cate)
            if (op === 'insert') { const r = { id: 900 + scrise.length, ...patch }; scrise.push(['insert', r]); data = [r] }
            if (op === 'update') {
              const r = existente.find((x) => x.id === idCerut)
              if (r && (!r.fisier_path || r.fisier_path.includes('/neincarcat/'))) { Object.assign(r, patch); scrise.push(['update', r]); data = [{ id: r.id }] }
            }
          }
          return Promise.resolve({ data, error: null }).then(res, rej)
        },
      }
      return b
    }
    return { from: builder, storage: { from: () => ({ upload: async () => ({ error: null }) }) } }
  }
  it('placeholder-ul veghei „Doc 1.pdf” se completează cu „Doc (1).pdf” din DownloadArchive (nu rând nou)', async () => {
    const existente = [{ id: 41, nume_original: 'Doc 1.pdf', fisier_path: '7/atribuire/neincarcat/Doc_1.pdf' }], scrise = []
    mocks.createClient.mockReturnValue(fakeCuExistente(existente, scrise))
    mocks.fetch.mockResolvedValue(new Response(zipStored({ 'Doc (1).pdf': '%PDF-1.4 d' })))
    const res = response()
    await seap({ method: 'POST', headers: { 'x-import-secret': 'internal-secret' }, body: { licitatie_id: 7 } }, res)
    expect(scrise.map(([op, r]) => [op, r.id, r.nume_original])).toEqual([['update', 41, 'Doc (1).pdf']])
    expect(res.body.completate).toBe(1)
  })
  it('placeholder „X.pdf.p7m” (veghea) se completează cu „X (semnat).pdf”; un „Y.pdf.p7m” brut existent nu se re-urcă', async () => {
    const existente = [
      { id: 359, nume_original: 'X.pdf.p7m', fisier_path: '7/atribuire/neincarcat/X.pdf.p7m' },
      { id: 319, nume_original: 'Y.pdf.p7m', fisier_path: '7/atribuire/y.p7m' },
    ], scrise = []
    mocks.createClient.mockReturnValue(fakeCuExistente(existente, scrise))
    mocks.fetch.mockResolvedValue(new Response(zipStored({ 'X.pdf.p7m': cmsSintetic('%PDF-1.4 x'), 'Y.pdf.p7m': cmsSintetic('%PDF-1.4 y') })))
    const res = response()
    await seap({ method: 'POST', headers: { 'x-import-secret': 'internal-secret' }, body: { licitatie_id: 7 } }, res)
    expect(scrise.map(([op, r]) => [op, r.id, r.nume_original])).toEqual([['update', 359, 'X (semnat).pdf']])
    expect(res.body.sarite_existente).toBe(1)
  })
})

describe('api/seap-import: semnătura detașată nu ține pe loc documentul real (Copilot NO-GO r1 pe #649)', () => {
  // semnătură detașată sintetică: SignedData fără eContent
  function detasatSintetic() {
    const der = (tag, ...parti) => { const corp = Buffer.concat(parti); return Buffer.concat([Buffer.from([tag, corp.length]), corp]) }
    const oid = (h) => der(0x06, Buffer.from(h, 'hex'))
    const sd = der(0x30, der(0x02, Buffer.from([1])), der(0x31), der(0x30, oid('2a864886f70d010701')), der(0x31))
    return der(0x30, oid('2a864886f70d010702'), der(0xa0, sd))
  }
  it('în aceeași arhivă: „Caiet.pdf.p7s” detașat ÎNAINTEA lui „Caiet.pdf” → ambele urcate (semnătura brută, ignorat cu nota)', async () => {
    const randuri = []
    mocks.createClient.mockReturnValue(fakeSupa(randuri))
    mocks.fetch.mockResolvedValue(new Response(zipStored({ 'Caiet.pdf.p7s': detasatSintetic(), 'Caiet.pdf': '%PDF-1.4 real' })))
    const res = response()
    await seap({ method: 'POST', headers: { 'x-import-secret': 'internal-secret' }, body: { licitatie_id: 7 } }, res)
    const pe = Object.fromEntries(randuri.map((r) => [r.nume_original, [r.status_procesare, String(r.eroare || '').slice(0, 28)]]))
    expect(Object.keys(pe).sort()).toEqual(['Caiet.pdf', 'Caiet.pdf.p7s'])
    expect(pe['Caiet.pdf']).toEqual(['neprocesat', ''])
    expect(pe['Caiet.pdf.p7s'][0]).toBe('ignorat')
    expect(pe['Caiet.pdf.p7s'][1]).toBe('Doar semnătura electronică (')
  })
})

describe('api/seap-import: arhiva .p7m rămâne întreagă (Jakarinos #7 pe #649)', () => {
  it('„Raspuns.zip.p7m” cu CMS valid → urcat întreg, sub numele SEAP, neprocesat fără notă (îl desface workerul)', async () => {
    const randuri = []
    mocks.createClient.mockReturnValue(fakeSupa(randuri))
    const cms = cmsSintetic('PK\u0003\u0004 zip')
    mocks.fetch.mockResolvedValue(new Response(zipStored({ 'Raspuns.zip.p7m': cms })))
    const res = response()
    await seap({ method: 'POST', headers: { 'x-import-secret': 'internal-secret' }, body: { licitatie_id: 7 } }, res)
    expect(randuri.map((r) => [r.nume_original, r.status_procesare, r.eroare, r.size_bytes])).toEqual([['Raspuns.zip.p7m', 'neprocesat', null, cms.length]])
  })
})

describe('api/seap-import: ZIP necitit complet nu e „adus” (audit Jakarinos #9 / #10)', () => {
  function cuUpdateuri(randuri, upd) {
    const f = fakeSupa(randuri)
    const from = f.from
    f.from = (t) => { const b = from(t); const u = b.update; b.update = (p) => { if (t === 'ofertare_licitatii') upd.push(p); return u.call(b, p) }; return b }
    return f
  }
  it('arhivă trunchiată (fără directorul central) → eroare „arhiva: …”, documentatie_adusa_la NEsetat', async () => {
    const randuri = [], upd = []
    mocks.createClient.mockReturnValue(cuUpdateuri(randuri, upd))
    const z = zipStored({ 'A.pdf': '%PDF-1.4 a', 'B.pdf': '%PDF-1.4 b' })
    mocks.fetch.mockResolvedValue(new Response(z.subarray(0, z.length - 68 - 5)))   // tăiat în a doua intrare
    const res = response()
    await seap({ method: 'POST', headers: { 'x-import-secret': 'internal-secret' }, body: { licitatie_id: 7 } }, res)
    expect(res.body.arhiva_completa).toBe(false)
    expect(res.body.erori.some((e) => /^arhiva: arhivă trunchiată/.test(e))).toBe(true)
    expect(upd.some((p) => 'documentatie_adusa_la' in p)).toBe(false)
  })
  it('arhivă completă → documentatie_adusa_la setat', async () => {
    const randuri = [], upd = []
    mocks.createClient.mockReturnValue(cuUpdateuri(randuri, upd))
    mocks.fetch.mockResolvedValue(new Response(zipStored({ 'A.pdf': '%PDF-1.4 a' })))
    const res = response()
    await seap({ method: 'POST', headers: { 'x-import-secret': 'internal-secret' }, body: { licitatie_id: 7 } }, res)
    expect([res.body.arhiva_completa, res.body.erori]).toEqual([true, []])
    expect(upd.some((p) => 'documentatie_adusa_la' in p)).toBe(true)
  })
})

describe('api/seap-import: inventarul se citește pe pagini, fail-closed (audit Jakarinos #21)', () => {
  it('eroare la citirea inventarului → 500, nimic urcat (nu „niciun document” → totul re-urcat)', async () => {
    const randuri = []
    const f = fakeSupa(randuri)
    const from = f.from
    f.from = (t) => { const b = from(t); if (t === 'ofertare_documente_atribuire') b.range = () => Promise.resolve({ data: null, error: { message: 'timeout' } }); return b }
    mocks.createClient.mockReturnValue(f)
    mocks.fetch.mockResolvedValue(new Response(zipStored({ 'A.pdf': '%PDF-1.4 a' })))
    const res = response()
    await seap({ method: 'POST', headers: { 'x-import-secret': 'internal-secret' }, body: { licitatie_id: 7 } }, res)
    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/inventarul documentelor nu s-a putut citi: timeout/)
    expect(randuri).toEqual([])
  })
})
