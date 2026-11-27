// „Export IZO înainte de lansare” — citirea fotografiei + exportul (ZIP, Storage, înregistrare), cu un client Supabase fals.
// Date inventate (proiect 1, tronson 5 = T7, pachet 9).
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { citesteArhivaNdt, executaExportIzo, construiesteZip } from './izoExportIzoBd.js'
import { evalueazaExportIzo } from './lib/izoExportIzo.js'

const PDF = n => new TextEncoder().encode(`%PDF-1.4 buletin ${n}`)
const sha = b => createHash('sha256').update(b).digest('hex')

// ── clientul fals: tabele în memorie, filtrele PostgREST folosite de cod, plafon max-rows ──
function clientFals({ tabele = {}, rpc = {}, maxRows = 1000, storage = {}, drept = { citire: true, scriere: true, export: true } } = {}) {
  const jurnal = { rpc: [], upload: [], remove: [], insert: [], select: [] }
  const filtru = (rows, f) => rows.filter(r => f.every(([op, c, v]) => {
    if (op === 'eq') return String(r[c]) === String(v)
    if (op === 'neq') return String(r[c]) !== String(v)
    if (op === 'gt') return r[c] > v
    if (op === 'lt') return r[c] < v
    if (op === 'in') return v.map(String).includes(String(r[c]))
    return true
  }))
  const from = (t) => {
    const st = { f: [], ord: [], lim: null, single: null }
    const q = {
      select() { return q }, eq(c, v) { st.f.push(['eq', c, v]); return q }, neq(c, v) { st.f.push(['neq', c, v]); return q },
      gt(c, v) { st.f.push(['gt', c, v]); return q }, lt(c, v) { st.f.push(['lt', c, v]); return q }, in(c, v) { st.f.push(['in', c, v]); return q },
      order(c, o = {}) { st.ord.push([c, o.ascending !== false]); return q }, limit(n) { st.lim = n; return q },
      maybeSingle() { st.single = 'maybe'; return q },
      insert(row) { jurnal.insert.push({ t, row }); return Promise.resolve(tabele[`${t}:insert`] || { data: null, error: null }) },
      then(res, rej) {
        jurnal.select.push({ t, f: st.f })
        if (tabele[`${t}:eroare`]) return Promise.resolve({ data: null, error: tabele[`${t}:eroare`] }).then(res, rej)
        let rows = filtru(tabele[t] || [], st.f)
        for (const [c, asc] of [...st.ord].reverse()) rows = [...rows].sort((a, b) => (a[c] === b[c] ? 0 : (a[c] > b[c]) === asc ? 1 : -1))
        rows = rows.slice(0, Math.min(st.lim ?? Infinity, maxRows))
        const out = st.single === 'maybe' ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }
        return Promise.resolve(out).then(res, rej)
      },
    }
    return q
  }
  return {
    jurnal,
    from,
    rpc: async (n, a) => {
      jurnal.rpc.push([n, a])
      if (n === 'fn_sud_drept') return { data: drept[a.p_nivel], error: null }
      const h = rpc[n]
      return h ? h(a) : { data: null, error: { message: 'necunoscut' } }
    },
    storage: {
      from: (b) => ({
        createSignedUrl: async (p) => (storage.semnatEroare ? { data: null, error: { message: 'x' } } : { data: { signedUrl: `https://fals/${b}/${p}` }, error: null }),
        upload: async (p, blob, o) => { jurnal.upload.push({ b, p, o, marime: blob.size }); return storage.uploadEroare ? { error: { message: 'plin' } } : { data: { path: p }, error: null } },
        remove: async (l) => { jurnal.remove.push({ b, l }); return { data: null, error: null } },
      }),
    },
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
  }
}

const SHA_A = sha(PDF('a')), SHA_B = sha(PDF('b'))
const buletine = [
  { id: 11, versiune: 2, proiect_id: 1, tronson_id: 5, metoda: 'PA-UT', numar: '77', data_buletin: '2026-10-28', fisier_path: '1/5/a.pdf', fisier_nume: 'a.pdf', fisier_sha256: SHA_A, stare: 'confirmat' },
  { id: 12, versiune: 2, proiect_id: 1, tronson_id: 5, metoda: 'PM', numar: '5', data_buletin: '2026-10-21', fisier_path: '1/5/b.pdf', fisier_nume: 'b.pdf', fisier_sha256: SHA_B, stare: 'confirmat' },
  { id: 13, versiune: 1, proiect_id: 1, tronson_id: 5, metoda: 'PM', numar: '6', data_buletin: '2026-10-22', fisier_path: '1/5/c.pdf', fisier_sha256: SHA_B, stare: 'ciorna' },
]
const rnd = (id, b, nr) => ({ id, buletin_id: b, ordine: id, cod_raw: `T7S${nr}`, stare_cod: 'ok', tronson_nr: 7, nr, sufix: '', refacuta: false, cheie: `T7S${nr}`, rezultat: 'acceptat', data_inspectie: '2026-10-20' })
const tabeleBaza = () => ({
  sud_buletine: buletine,
  sud_buletin_randuri: [rnd(1, 11, 1), rnd(2, 11, 2), rnd(3, 12, 1), rnd(4, 12, 2)],
  sud_suduri_eliminate: [],
  sud_metode_proiect: [{ proiect_id: 1, metode: ['PA-UT', 'PM'] }],
  executie_pachete_lansare: [
    { id: 8, tronson_id: 5, km_start_m: 900, total_lungime_m: 100, cod_document_full: 'A' },
    { id: 7, tronson_id: 5, km_start_m: 500, total_lungime_m: 100, cod_document_full: 'B' },
    { id: 9, tronson_id: 5, km_start_m: 1000, total_lungime_m: 36, cod_document_full: 'C' },
  ],
  sud_exporturi: [],
})
const pachet = { id: 9, proiect_id: 1, tronson_id: 5, km_start_m: 1000, total_lungime_m: 36, cod_document_full: '99_GAZ_X_DWG_00001', revizie: 0 }
const tronson = { id: 5, cod: 'T7', proiect_id: 1 }
const teava = (poz, serie, sudura_cod) => ({ id: 100 + poz, poz_in_pachet: poz, tip_rand: 'teava', serie_unica: serie, tip: 'L', dimensiune: 'DN300x8', sarja: `SJ${poz}`, lungime_m: 12, sudura_cod })
const tevi = [teava(1, 'S-1', 'T7S1'), teava(2, 'S-2', 'T7S2'), teava(3, 'S-3', null)]
const fetchFals = (harta) => async (url) => {
  const p = url.replace('https://fals/izo-ndt/', '')
  if (!(p in harta)) return { ok: false, status: 404 }
  return { ok: true, status: 200, arrayBuffer: async () => harta[p].buffer.slice(harta[p].byteOffset, harta[p].byteOffset + harta[p].byteLength) }
}
const genereazaXlsxFals = async (arg) => { genereazaXlsxFals.ultim = arg; return new TextEncoder().encode('xlsx') }

describe('citesteArhivaNdt — fotografia citită o dată', () => {
  it('buletinele confirmate ale tronsonului (fără ciorne), rândurile lor, metodele, pachetul anterior', async () => {
    const sb = clientFals({ tabele: tabeleBaza() })
    const a = await citesteArhivaNdt(sb, { proiectId: 1, tronsonId: 5, pachetId: 9, kmStart: 1000 })
    expect(a.ok).toBe(true)
    expect(a.buletine.map(b => b.id)).toEqual([11, 12])
    expect(a.randuri.map(r => r.id)).toEqual([1, 2, 3, 4])
    expect(a.metode).toEqual(['PA-UT', 'PM'])
    expect(a.pachetAnterior?.id).toBe(8)        // cel mai apropiat km start mai mic
    expect(a.ultimExport).toBe(null)
  })
  it('peste plafonul de rânduri: keyset până la pagina goală (nimic tăiat la 1000)', async () => {
    const t = tabeleBaza()
    t.sud_buletin_randuri = Array.from({ length: 2500 }, (_, i) => rnd(i + 1, 11, i + 1))
    const a = await citesteArhivaNdt(clientFals({ tabele: t, maxRows: 1000 }), { proiectId: 1, tronsonId: 5, pachetId: 9, kmStart: 1000 })
    expect(a.randuri).toHaveLength(2500)
  })
  it('metodele nesetate → null (nu []), fără valoare inventată', async () => {
    const t = tabeleBaza(); t.sud_metode_proiect = []
    const a = await citesteArhivaNdt(clientFals({ tabele: t }), { proiectId: 1, tronsonId: 5, pachetId: 9, kmStart: 1000 })
    expect(a.ok).toBe(true)
    expect(a.metode).toBe(null)
  })
  it('fără drept de citire / drept neverificabil / eroare de citire → ok:false (nu listă goală)', async () => {
    expect((await citesteArhivaNdt(clientFals({ tabele: tabeleBaza(), drept: { citire: false } }), { proiectId: 1, tronsonId: 5, pachetId: 9 })).ok).toBe(false)
    expect((await citesteArhivaNdt(clientFals({ tabele: tabeleBaza(), drept: { citire: null } }), { proiectId: 1, tronsonId: 5, pachetId: 9 })).ok).toBe(false)
    const t = tabeleBaza(); t['sud_buletin_randuri:eroare'] = { message: 'timeout' }
    const a = await citesteArhivaNdt(clientFals({ tabele: t }), { proiectId: 1, tronsonId: 5, pachetId: 9 })
    expect(a).toMatchObject({ ok: false, eroare: 'timeout' })
  })
  it('pachetul anterior necitit → semnal separat, arhiva rămâne bună', async () => {
    const t = tabeleBaza(); t['executie_pachete_lansare:eroare'] = { message: 'x' }
    const a = await citesteArhivaNdt(clientFals({ tabele: t }), { proiectId: 1, tronsonId: 5, pachetId: 9, kmStart: 1000 })
    expect(a.ok).toBe(true)
    expect(a.eroareAnterior).toBe('x')
  })
})

async function pregateste(o = {}) {
  const t = { ...tabeleBaza(), ...(o.tabele || {}) }
  const sb = clientFals({ tabele: t, rpc: o.rpc || { fn_sud_export_inregistreaza: async () => ({ data: 501, error: null }) }, storage: o.storage })
  const arhiva = await citesteArhivaNdt(sb, { proiectId: 1, tronsonId: 5, pachetId: 9, kmStart: 1000 })
  const evaluare = evalueazaExportIzo({ pachet, tronson, tevi: o.tevi || tevi, arhiva })
  return { sb, arhiva, evaluare }
}
const pdfuri = { '1/5/a.pdf': PDF('a'), '1/5/b.pdf': PDF('b') }

describe('executaExportIzo — ZIP, Storage, înregistrare', () => {
  it('export complet: ZIP cu Excel + câte un PDF pe buletin (fără dubluri), înregistrat cu fotografia folosită', async () => {
    const { sb, arhiva, evaluare } = await pregateste()
    const r = await executaExportIzo(sb, { pachet, tronson, proiect: {}, tevi, evaluare, arhiva, incomplet: false, genereazaXlsx: genereazaXlsxFals, fetchImpl: fetchFals(pdfuri), uniq: 'u1', acum: new Date('2026-11-27T10:00:00Z') })
    expect(r.ok).toBe(true)
    expect(r.nume).toBe('99_GAZ_X_DWG_00001_rev0_Centralizator.zip')
    const zip = await JSZip.loadAsync(r.bytes)
    expect(Object.keys(zip.files).sort()).toEqual(['99_GAZ_X_DWG_00001_rev0_Centralizator.xlsx', 'buletine/', 'buletine/PA-UT_77_28.10.2026.pdf', 'buletine/PM_5_21.10.2026.pdf'])
    expect(new TextDecoder().decode(await zip.file('buletine/PM_5_21.10.2026.pdf').async('uint8array'))).toBe('%PDF-1.4 buletin b')
    expect(sb.jurnal.upload).toEqual([{ b: 'executie-pachete-pdf', p: '9/2026-11-27_u1_99_GAZ_X_DWG_00001_rev0_Centralizator.zip', o: { contentType: 'application/zip', upsert: false }, marime: r.bytes.length }])
    const reg = sb.jurnal.rpc.find(x => x[0] === 'fn_sud_export_inregistreaza')[1]
    expect(reg).toEqual({ p_pachet: 9, p_tip: 'izo', p_fotografie: evaluare.fotografie, p_deblocare_id: null, p_fisier_path: '9/2026-11-27_u1_99_GAZ_X_DWG_00001_rev0_Centralizator.zip' })
    expect(sb.jurnal.rpc.some(x => x[0] === 'fn_sud_export_deblocheaza')).toBe(false)
    expect(sb.jurnal.insert).toEqual([{ t: 'executie_pachete_documente', row: expect.objectContaining({ pachet_id: 9, tip_document: 'centralizator', mime_type: 'application/zip', fisier_nume: r.nume }) }])
    // Excel-ul primește aceeași stare + planul buletinelor (foaia BULETINE)
    expect(genereazaXlsxFals.ultim.ndt.buletine.map(b => b.fisierZip)).toEqual(['buletine/PM_5_21.10.2026.pdf', 'buletine/PA-UT_77_28.10.2026.pdf'])
    expect(genereazaXlsxFals.ultim.ndt.incomplet).toBe(false)
  })
  it('PDF schimbat în Storage (altă amprentă) → oprit înainte de orice scriere', async () => {
    const { sb, arhiva, evaluare } = await pregateste()
    const r = await executaExportIzo(sb, { pachet, tronson, proiect: {}, tevi, evaluare, arhiva, incomplet: false, genereazaXlsx: genereazaXlsxFals, fetchImpl: fetchFals({ ...pdfuri, '1/5/b.pdf': PDF('alt') }) })
    expect(r.ok).toBe(false)
    expect(r.eroare).toMatch(/amprentă/)
    expect(sb.jurnal.upload).toEqual([])
    expect(sb.jurnal.rpc.filter(x => x[0] !== 'fn_sud_drept')).toEqual([])
  })
  it('40001 (sursele s-au schimbat) → „redeschide fereastra”, arhiva încărcată se scoate, nimic în istoric', async () => {
    const { sb, arhiva, evaluare } = await pregateste({ rpc: { fn_sud_export_inregistreaza: async () => ({ data: null, error: { code: '40001', message: 'sursele s-au schimbat' } }) } })
    const r = await executaExportIzo(sb, { pachet, tronson, proiect: {}, tevi, evaluare, arhiva, incomplet: false, genereazaXlsx: genereazaXlsxFals, fetchImpl: fetchFals(pdfuri), uniq: 'u2' })
    expect(r).toMatchObject({ ok: false, surseSchimbate: true })
    expect(r.eroare).toMatch(/redeschide fereastra/)
    expect(sb.jurnal.remove).toEqual([{ b: 'executie-pachete-pdf', l: [sb.jurnal.upload[0].p] }])
    expect(sb.jurnal.insert).toEqual([])
  })
  it('eroare de rețea la înregistrare = necunoscut: fișierul NU se șterge; dacă exportul există în BD, continuă', async () => {
    const t = tabeleBaza()
    const rpc = { fn_sud_export_inregistreaza: async (a) => { t.sud_exporturi.push({ id: 777, pachet_id: 9, tip: 'izo', fisier_path: a.p_fisier_path, creat_la: '2026-11-27T10:00:00Z' }); return { data: null, error: { code: '', message: 'Failed to fetch' } } } }
    const sb = clientFals({ tabele: t, rpc })
    const arhiva = await citesteArhivaNdt(sb, { proiectId: 1, tronsonId: 5, pachetId: 9, kmStart: 1000 })
    const evaluare = evalueazaExportIzo({ pachet, tronson, tevi, arhiva })
    const r = await executaExportIzo(sb, { pachet, tronson, proiect: {}, tevi, evaluare, arhiva, incomplet: false, genereazaXlsx: genereazaXlsxFals, fetchImpl: fetchFals(pdfuri) })
    expect(r.ok).toBe(true)
    expect(r.exportId).toBe(777)
    expect(sb.jurnal.remove).toEqual([])
  })
  it('eroare de rețea și exportul NU e în BD → eroare „nu s-a putut confirma”, fișierul rămâne, nimic în istoric', async () => {
    const { sb, arhiva, evaluare } = await pregateste({ rpc: { fn_sud_export_inregistreaza: async () => ({ data: null, error: { code: '', message: 'Failed to fetch' } }) } })
    const r = await executaExportIzo(sb, { pachet, tronson, proiect: {}, tevi, evaluare, arhiva, incomplet: false, genereazaXlsx: genereazaXlsxFals, fetchImpl: fetchFals(pdfuri) })
    expect(r.ok).toBe(false)
    expect(r.eroare).toMatch(/nu s-a putut confirma/)
    expect(sb.jurnal.remove).toEqual([])
    expect(sb.jurnal.insert).toEqual([])
  })
  it('export incomplet: deblocarea MP pentru EXACT lipsurile din fotografie, apoi înregistrarea cu id-ul ei; INCOMPLET în nume', async () => {
    const t = { sud_buletin_randuri: [rnd(1, 11, 1), rnd(2, 11, 2), rnd(3, 12, 1)] }   // T7S2 fără PM
    const rpc = { fn_sud_export_deblocheaza: async () => ({ data: 42, error: null }), fn_sud_export_inregistreaza: async () => ({ data: 502, error: null }) }
    const { sb, arhiva, evaluare } = await pregateste({ tabele: t, rpc })
    expect(evaluare.fotografie.lipsuri_blocante.map(x => x.cod)).toEqual(['buletin_lipsa'])
    // fără incomplet: refuzat local, nimic trimis
    const r0 = await executaExportIzo(sb, { pachet, tronson, proiect: {}, tevi, evaluare, arhiva, incomplet: false, genereazaXlsx: genereazaXlsxFals, fetchImpl: fetchFals(pdfuri) })
    expect(r0.ok).toBe(false)
    expect(sb.jurnal.upload).toEqual([])
    const r = await executaExportIzo(sb, { pachet, tronson, proiect: {}, tevi, evaluare, arhiva, incomplet: true, motiv: '  lipsă PM la T7S2  ', genereazaXlsx: genereazaXlsxFals, fetchImpl: fetchFals(pdfuri) })
    expect(r.ok).toBe(true)
    expect(r.nume).toBe('99_GAZ_X_DWG_00001_rev0_INCOMPLET_Centralizator.zip')
    const deb = sb.jurnal.rpc.find(x => x[0] === 'fn_sud_export_deblocheaza')[1]
    expect(deb).toEqual({ p_pachet: 9, p_tip: 'izo', p_motiv: 'lipsă PM la T7S2', p_lipsuri: evaluare.fotografie.lipsuri_blocante })
    const reg = sb.jurnal.rpc.find(x => x[0] === 'fn_sud_export_inregistreaza')[1]
    expect(reg.p_deblocare_id).toBe(42)
    expect(reg.p_fotografie.lipsuri_blocante).toBe(deb.p_lipsuri)   // același obiect → aceeași listă (serverul le compară)
    expect(genereazaXlsxFals.ultim.ndt).toMatchObject({ incomplet: true, lipsuri: evaluare.fotografie.lipsuri_blocante })
  })
  it('deblocare refuzată (ex. nu e MP) → oprit, nimic încărcat', async () => {
    const t = { sud_buletin_randuri: [rnd(1, 11, 1), rnd(2, 11, 2), rnd(3, 12, 1)] }
    const { sb, arhiva, evaluare } = await pregateste({ tabele: t, rpc: { fn_sud_export_deblocheaza: async () => ({ data: null, error: { code: '42501', message: 'doar managerul de proiect' } }) } })
    const r = await executaExportIzo(sb, { pachet, tronson, proiect: {}, tevi, evaluare, arhiva, incomplet: true, motiv: 'motiv lung', genereazaXlsx: genereazaXlsxFals, fetchImpl: fetchFals(pdfuri) })
    expect(r.ok).toBe(false)
    expect(sb.jurnal.upload).toEqual([])
  })
  it('blocaj fără deblocare → refuzat local; încărcare eșuată → nimic înregistrat', async () => {
    const { sb, arhiva, evaluare } = await pregateste({ tevi: [teava(1, 'S-1', 'T7S1'), teava(2, 'S-1', 'T7S2')] })   // serie dublată
    expect((await executaExportIzo(sb, { pachet, tronson, proiect: {}, tevi, evaluare, arhiva, incomplet: false, genereazaXlsx: genereazaXlsxFals, fetchImpl: fetchFals(pdfuri) })).ok).toBe(false)
    const p2 = await pregateste({ storage: { uploadEroare: true } })
    const r = await executaExportIzo(p2.sb, { pachet, tronson, proiect: {}, tevi, evaluare: p2.evaluare, arhiva: p2.arhiva, incomplet: false, genereazaXlsx: genereazaXlsxFals, fetchImpl: fetchFals(pdfuri) })
    expect(r.ok).toBe(false)
    expect(p2.sb.jurnal.rpc.some(x => x[0] === 'fn_sud_export_inregistreaza')).toBe(false)
  })
})

describe('construiesteZip', () => {
  it('refuză un nume dublat (nu suprascrie un PDF cu altul)', async () => {
    await expect(construiesteZip({ numeXlsx: 'a.xlsx', xlsx: new Uint8Array([1]), pdfuri: [{ fisierZip: 'buletine/X.pdf', bytes: PDF(1) }, { fisierZip: 'buletine/x.pdf', bytes: PDF(2) }] }))
      .rejects.toThrow(/dublat/)
  })
})
