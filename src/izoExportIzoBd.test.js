// „Export IZO înainte de lansare” — citirea fotografiei + exportul (ZIP, Storage, înregistrare), cu un client Supabase fals.
// Date inventate (proiect 1, tronson 5 = T7, pachet 9).
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { citesteArhivaNdt, executaExportIzo, construiesteZip, verificaPachetNeschimbat, LIMITA_FISIER_STORAGE,
  fisiereExportIstoric, descarcaExportIstoric, stergeExportIstoric, esteLivrareSeparata } from './izoExportIzoBd.js'
import { evalueazaExportIzo } from './lib/izoExportIzo.js'

const PDF = n => new TextEncoder().encode(`%PDF-1.4 buletin ${n}`)
const sha = b => createHash('sha256').update(b).digest('hex')

// ── clientul fals: tabele în memorie, filtrele PostgREST folosite de cod, plafon max-rows ──
// amprenta pachetului de pe server (fn_sud_amprenta_pachet, 20270115b): jurnal SEPARAT (jurnal.amprenta), ca listele exacte de RPC-uri
// ale testelor vechi să rămână neschimbate; `amprenta` = funcție (apelul n, args) → răspunsul
const AMP = '0123456789abcdef0123456789abcdef', AMP2 = 'fedcba9876543210fedcba9876543210'
function clientFals({ tabele = {}, rpc = {}, maxRows = 1000, storage = {}, drept = { citire: true, scriere: true, export: true }, amprenta = () => ({ data: AMP, error: null }) } = {}) {
  const jurnal = { rpc: [], upload: [], remove: [], insert: [], select: [], amprenta: [] }
  const filtru = (rows, f) => rows.filter(r => f.every(([op, c, v]) => {
    if (op === 'eq') return String(r[c]) === String(v)
    if (op === 'neq') return String(r[c]) !== String(v)
    if (op === 'gt') return r[c] > v
    if (op === 'lt') return r[c] < v
    if (op === 'in') return v.map(String).includes(String(r[c]))
    return true
  }))
  const from = (t) => {
    const st = { f: [], ord: [], lim: null, single: null, del: false }
    const q = {
      select() { return q }, delete() { st.del = true; return q },
      eq(c, v) { st.f.push(['eq', c, v]); return q }, neq(c, v) { st.f.push(['neq', c, v]); return q },
      gt(c, v) { st.f.push(['gt', c, v]); return q }, lt(c, v) { st.f.push(['lt', c, v]); return q }, in(c, v) { st.f.push(['in', c, v]); return q },
      order(c, o = {}) { st.ord.push([c, o.ascending !== false]); return q }, limit(n) { st.lim = n; return q },
      maybeSingle() { st.single = 'maybe'; return q },
      insert(row) { jurnal.insert.push({ t, row }); return Promise.resolve(tabele[`${t}:insert`] || { data: null, error: null }) },
      then(res, rej) {
        jurnal.select.push({ t, f: st.f })
        if (tabele[`${t}:eroare`]) return Promise.resolve({ data: null, error: tabele[`${t}:eroare`] }).then(res, rej)
        if (st.del) {   // DELETE … RETURNING
          jurnal.delete = [...(jurnal.delete || []), { t, f: st.f }]
          const sterse = filtru(tabele[t] || [], st.f)
          tabele[t] = (tabele[t] || []).filter(r => !sterse.includes(r))
          return Promise.resolve({ data: sterse, error: null }).then(res, rej)
        }
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
      if (n === 'fn_sud_amprenta_pachet') { jurnal.amprenta.push(a); return amprenta(jurnal.amprenta.length, a) }
      jurnal.rpc.push([n, a])
      if (n === 'fn_sud_drept') return { data: drept[a.p_nivel], error: null }
      const h = rpc[n]
      return h ? h(a) : { data: null, error: { message: 'necunoscut' } }
    },
    storage: {
      from: (b) => ({
        createSignedUrl: async (p) => (storage.semnatEroare ? { data: null, error: { message: 'x' } } : { data: { signedUrl: `https://fals/${b}/${p}` }, error: null }),
        upload: async (p, blob, o) => {
          jurnal.upload.push({ b, p, o, marime: blob.size, tip: blob.type })
          if (storage.laUpload) storage.laUpload(p, jurnal.upload.length)
          const err = typeof storage.uploadEroare === 'function' ? storage.uploadEroare(p, jurnal.upload.length) : storage.uploadEroare
          if (!err && storage.obiecte) storage.obiecte.set(`${b}/${p}`, new Uint8Array(await blob.arrayBuffer()))
          return err ? { error: { message: 'plin' } } : { data: { path: p }, error: null }
        },
        // Storage real: remove întoarce DOAR obiectele șterse; un obiect fără drept / lipsă lipsește din listă, fără eroare
        remove: async (l) => {
          jurnal.remove.push({ b, l })
          if (!storage.obiecte) return { data: null, error: null }
          const sterse = l.filter(p => storage.obiecte.has(`${b}/${p}`) && !(storage.nuSterge || []).includes(p))
          for (const p of sterse) storage.obiecte.delete(`${b}/${p}`)
          return { data: sterse.map(p => ({ name: p })), error: null }
        },
        list: async (dir, o = {}) => {
          jurnal.list = [...(jurnal.list || []), { b, dir, o }]
          if (storage.listEroare) return { data: null, error: { message: 'list' } }
          const pref = `${b}/${dir ? dir + '/' : ''}`
          const nume = [...(storage.obiecte || new Map()).keys()].filter(k => k.startsWith(pref)).map(k => k.slice(pref.length))
            .filter(n => !n.includes('/') && n.startsWith(o.search || ''))
          return { data: nume.slice(0, o.limit ?? 100).map(name => ({ name })), error: null }
        },
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
    { ...pachet },
  ],
  // rândurile pachetului în BD (PostgREST întoarce numeric ca text uneori: „12.00” = 12)
  executie_tevi: tevi.map(t => ({ ...t, lungime_m: '12.00' })).reverse(),
  sud_exporturi: [],
})
const pachet = { id: 9, proiect_id: 1, tronson_id: 5, km_start_m: 1000, total_lungime_m: 36, cod_document_full: '99_GAZ_X_DWG_00001', revizie: 0, updated_at: '2026-11-27T08:00:00.123456+00:00' }
const tronson = { id: 5, cod: 'T7', proiect_id: 1 }
const teava = (poz, serie, sudura_cod) => ({ id: 100 + poz, pachet_id: 9, poz_in_pachet: poz, tip_rand: 'teava', serie_unica: serie, tip: 'L', dimensiune: 'DN300x8', sarja: `SJ${poz}`, lungime_m: 12, sudura_cod, pm_cod: null, pa_ut_cod: null, ut_cod: null })
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
  const sb = clientFals({ tabele: t, rpc: o.rpc || { fn_sud_export_inregistreaza: async () => ({ data: 501, error: null }) }, storage: o.storage, ...(o.amprenta ? { amprenta: o.amprenta } : {}) })
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
    // bucket-ul de producție NU permite application/zip: ZIP-ul urcă drept application/octet-stream, numele rămâne .zip
    expect(sb.jurnal.upload).toEqual([{ b: 'executie-pachete-pdf', p: '9/2026-11-27_u1_99_GAZ_X_DWG_00001_rev0_Centralizator.zip', o: { contentType: 'application/octet-stream', upsert: false }, marime: r.bytes.length, tip: 'application/octet-stream' }])
    const reg = sb.jurnal.rpc.find(x => x[0] === 'fn_sud_export_inregistreaza')[1]
    expect(reg).toEqual({ p_pachet: 9, p_tip: 'izo', p_fotografie: { ...evaluare.fotografie, livrare: 'zip', fisiere: ['9/2026-11-27_u1_99_GAZ_X_DWG_00001_rev0_Centralizator.zip'] }, p_deblocare_id: null, p_fisier_path: '9/2026-11-27_u1_99_GAZ_X_DWG_00001_rev0_Centralizator.zip' })
    // fotografia poartă amprenta pachetului (updated_at, km, revizie) și a rândurilor
    expect(reg.p_fotografie.pachet).toEqual({ id: 9, updated_at: '2026-11-27T08:00:00.123456+00:00', km_start_m: 1000, revizie: 0, cod_document_full: '99_GAZ_X_DWG_00001' })
    expect(reg.p_fotografie.randuri).toMatchObject({ numar: 3 })
    expect(r.separat).toBe(false)
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

// Jakarinos #1219 r1 P1: serverul nu compară pachetul → clientul recitește pachetul + rândurile înainte de generare și de înregistrare
describe('executaExportIzo — pachetul schimbat după deschiderea ferestrei', () => {
  const ruleaza = (sb, arhiva, evaluare, extra = {}) => {
    genereazaXlsxFals.ultim = undefined
    return executaExportIzo(sb, { pachet, tronson, proiect: {}, tevi, evaluare, arhiva, incomplet: false, genereazaXlsx: genereazaXlsxFals, fetchImpl: fetchFals(pdfuri), uniq: 'u9', ...extra })
  }
  const nimicScris = sb => {
    expect(sb.jurnal.upload).toEqual([])
    expect(sb.jurnal.rpc.filter(x => x[0] !== 'fn_sud_drept')).toEqual([])
    expect(sb.jurnal.insert).toEqual([])
  }
  it('seria unui rând schimbată în BD (alt utilizator) → refuz „redeschide fereastra” înainte de generare, nimic scris', async () => {
    const { sb, arhiva, evaluare } = await pregateste()
    const rand = (await sb.from('executie_tevi').eq('id', 101)).data[0]
    rand.serie_unica = 'ALTA'
    const r = await ruleaza(sb, arhiva, evaluare)
    expect(r).toMatchObject({ ok: false, surseSchimbate: true, pachetSchimbat: true })
    expect(r.eroare).toMatch(/Pachetul s-a schimbat — redeschide fereastra/)
    expect(genereazaXlsxFals.ultim).toBe(undefined)
    nimicScris(sb)
  })
  it('km start / revizie / updated_at schimbate pe pachet → refuz; lungimea unui rând → refuz; un rând nou → refuz', async () => {
    for (const schimba of [
      t => { t.executie_pachete_lansare.find(p => p.id === 9).km_start_m = 1200 },
      t => { t.executie_pachete_lansare.find(p => p.id === 9).revizie = 1 },
      t => { t.executie_pachete_lansare.find(p => p.id === 9).updated_at = '2026-11-27T09:00:00+00:00' },
      t => { t.executie_tevi.find(x => x.id === 102).lungime_m = '11.5' },
      t => { t.executie_tevi.find(x => x.id === 102).pm_cod = 'PM 9' },
      t => { t.executie_tevi.push({ ...teava(4, 'S-4', 'T7S4') }) },
    ]) {
      const tab = tabeleBaza()
      const sb = clientFals({ tabele: tab, rpc: { fn_sud_export_inregistreaza: async () => ({ data: 1, error: null }) } })
      const arhiva = await citesteArhivaNdt(sb, { proiectId: 1, tronsonId: 5, pachetId: 9, kmStart: 1000 })
      const evaluare = evalueazaExportIzo({ pachet, tronson, tevi, arhiva })
      schimba(tab)
      const r = await ruleaza(sb, arhiva, evaluare)
      expect(r).toMatchObject({ ok: false, surseSchimbate: true, pachetSchimbat: true })
      nimicScris(sb)
    }
  })
  it('schimbare între încărcare și înregistrare → fișierul încărcat se scoate, înregistrarea NU se cere', async () => {
    const tab = tabeleBaza()
    const sb = clientFals({ tabele: tab, rpc: { fn_sud_export_inregistreaza: async () => ({ data: 1, error: null }) },
      storage: { laUpload: () => { tab.executie_tevi.find(x => x.id === 101).sudura_cod = 'T7S9' } } })
    const arhiva = await citesteArhivaNdt(sb, { proiectId: 1, tronsonId: 5, pachetId: 9, kmStart: 1000 })
    const evaluare = evalueazaExportIzo({ pachet, tronson, tevi, arhiva })
    const r = await ruleaza(sb, arhiva, evaluare)
    expect(r).toMatchObject({ ok: false, surseSchimbate: true, pachetSchimbat: true })
    expect(sb.jurnal.upload).toHaveLength(1)
    expect(sb.jurnal.remove).toEqual([{ b: 'executie-pachete-pdf', l: [sb.jurnal.upload[0].p] }])
    expect(sb.jurnal.rpc.some(x => x[0] === 'fn_sud_export_inregistreaza')).toBe(false)
    expect(sb.jurnal.insert).toEqual([])
  })
  it('pachetul nu se poate reciti (eroare) → export oprit cu eroare, NU „neschimbat” (L18)', async () => {
    const { sb, arhiva, evaluare } = await pregateste({ tabele: { 'executie_tevi:eroare': { message: 'timeout' } } })
    const r = await ruleaza(sb, arhiva, evaluare)
    expect(r.ok).toBe(false)
    expect(r.surseSchimbate).toBeUndefined()
    expect(r.eroare).toMatch(/nu s-a putut reciti/)
    nimicScris(sb)
  })
  it('copia trimisă la generare diferă de cea din fotografie → refuz', async () => {
    const { sb, arhiva, evaluare } = await pregateste()
    const r = await executaExportIzo(sb, { pachet, tronson, proiect: {}, tevi: [teava(1, 'S-X', 'T7S1'), tevi[1], tevi[2]], evaluare, arhiva, incomplet: false, genereazaXlsx: genereazaXlsxFals, fetchImpl: fetchFals(pdfuri) })
    expect(r).toMatchObject({ ok: false, surseSchimbate: true })
    nimicScris(sb)
  })
  it('verificaPachetNeschimbat: aceeași stare (ordine de citire alta, „12.00” vs 12) → ok; fotografie fără amprentă → refuz', async () => {
    const { sb, evaluare } = await pregateste()
    expect(await verificaPachetNeschimbat(sb, evaluare.fotografie)).toEqual({ ok: true })
    const { pachet: _p, ...faraAmprenta } = evaluare.fotografie
    expect((await verificaPachetNeschimbat(sb, faraAmprenta)).ok).toBe(false)
  })
})

// Jakarinos #1219 r1 P2: bucket-ul are file_size_limit 50 MB → peste limită, fișierele separat (dimensiuni simulate cu `limita`)
describe('executaExportIzo — arhiva peste limita bucket-ului', () => {
  it('limita implicită = 50 MB = 52.428.800 octeți', () => {
    expect(LIMITA_FISIER_STORAGE).toBe(52428800)
  })
  it('ZIP > limită: nu urcă ZIP-ul; urcă Excel-ul + fiecare PDF separat în dosarul exportului, înregistrează lista, întoarce ZIP-ul pentru descărcare', async () => {
    const { sb, arhiva, evaluare } = await pregateste()
    const r = await executaExportIzo(sb, { pachet, tronson, proiect: {}, tevi, evaluare, arhiva, incomplet: false, genereazaXlsx: genereazaXlsxFals, fetchImpl: fetchFals(pdfuri), uniq: 'u5', acum: new Date('2026-11-27T10:00:00Z'), limita: 100 })
    expect(r.ok).toBe(true)
    expect(r.separat).toBe(true)
    expect(r.bytes.length).toBeGreaterThan(100)                       // ZIP-ul întreg, pentru descărcarea locală
    expect(Object.keys((await JSZip.loadAsync(r.bytes)).files)).toContain('buletine/PM_5_21.10.2026.pdf')
    const d = '9/2026-11-27_u5_99_GAZ_X_DWG_00001_rev0_Centralizator'
    expect(sb.jurnal.upload.map(u => [u.p, u.o.contentType, u.tip])).toEqual([
      [`${d}/99_GAZ_X_DWG_00001_rev0_Centralizator.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      [`${d}/buletine/PM_5_21.10.2026.pdf`, 'application/pdf', 'application/pdf'],
      [`${d}/buletine/PA-UT_77_28.10.2026.pdf`, 'application/pdf', 'application/pdf'],
    ])
    expect(sb.jurnal.upload.every(u => u.marime <= 100)).toBe(true)
    expect(sb.jurnal.upload.some(u => /\.zip$/.test(u.p))).toBe(false)
    const reg = sb.jurnal.rpc.find(x => x[0] === 'fn_sud_export_inregistreaza')[1]
    expect(reg.p_fisier_path).toBe(`${d}/99_GAZ_X_DWG_00001_rev0_Centralizator.xlsx`)
    expect(reg.p_fotografie.livrare).toBe('separat')
    expect(reg.p_fotografie.fisiere).toEqual(sb.jurnal.upload.map(u => u.p))
    expect(r.fisiere).toEqual(sb.jurnal.upload.map(u => u.p))
    expect(sb.jurnal.insert).toEqual([{ t: 'executie_pachete_documente', row: expect.objectContaining({ fisier_path: reg.p_fisier_path, fisier_nume: '99_GAZ_X_DWG_00001_rev0_Centralizator.xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) }])
  })
  it('un fișier care singur trece de limită → refuz cu mesaj clar, nimic încărcat / deblocat / înregistrat', async () => {
    const t = { sud_buletin_randuri: [rnd(1, 11, 1), rnd(2, 11, 2), rnd(3, 12, 1)] }   // incomplet: deblocarea NU se cere
    const rpc = { fn_sud_export_deblocheaza: async () => ({ data: 42, error: null }), fn_sud_export_inregistreaza: async () => ({ data: 1, error: null }) }
    const { sb, arhiva, evaluare } = await pregateste({ tabele: t, rpc })
    // PDF-urile de test au 18 octeți, Excel-ul 4: cu limita 10 PDF-urile trec singure de limită, Excel-ul nu
    const r = await executaExportIzo(sb, { pachet, tronson, proiect: {}, tevi, evaluare, arhiva, incomplet: true, motiv: 'motiv lung', genereazaXlsx: genereazaXlsxFals, fetchImpl: fetchFals(pdfuri), limita: 10 })
    expect(r.ok).toBe(false)
    expect(r.eroare).toMatch(/PA-UT_77_28\.10\.2026\.pdf.*limita de .* MB a serverului/)
    expect(r.eroare).not.toMatch(/Centralizator\.xlsx/)
    expect(sb.jurnal.upload).toEqual([])
    expect(sb.jurnal.rpc.filter(x => x[0] !== 'fn_sud_drept')).toEqual([])
  })
  it('livrare separată, al doilea fișier eșuează → primul se scoate, nimic înregistrat', async () => {
    const { sb, arhiva, evaluare } = await pregateste({ storage: { uploadEroare: (p, n) => n === 2 } })
    const r = await executaExportIzo(sb, { pachet, tronson, proiect: {}, tevi, evaluare, arhiva, incomplet: false, genereazaXlsx: genereazaXlsxFals, fetchImpl: fetchFals(pdfuri), limita: 100 })
    expect(r.ok).toBe(false)
    expect(sb.jurnal.remove).toEqual([{ b: 'executie-pachete-pdf', l: [sb.jurnal.upload[0].p] }])
    expect(sb.jurnal.rpc.some(x => x[0] === 'fn_sud_export_inregistreaza')).toBe(false)
  })
})

// Jakarinos #1219 r2 P2: la livrarea separată istoricul trebuie să știe de TOATE fișierele exportului (sud_exporturi.fotografie.fisiere)
describe('istoricul exporturilor — livrare separată: descărcare și ștergere complete', () => {
  // un export real prin executaExportIzo (limita 100 → separat), într-un Storage în memorie; serverul fals păstrează fotografia
  async function exportSeparat(o = {}) {
    const t = tabeleBaza()
    const obiecte = new Map()
    const rpc = { fn_sud_export_inregistreaza: async (a) => { t.sud_exporturi.push({ id: 900, pachet_id: a.p_pachet, tip: a.p_tip, fotografie: a.p_fotografie, fisier_path: a.p_fisier_path, creat_la: '2026-11-27T10:00:00Z' }); return { data: 900, error: null } } }
    const storage = { obiecte, ...(o.storage || {}) }
    const sb = clientFals({ tabele: t, rpc, storage })
    const arhiva = await citesteArhivaNdt(sb, { proiectId: 1, tronsonId: 5, pachetId: 9, kmStart: 1000 })
    const evaluare = evalueazaExportIzo({ pachet, tronson, tevi, arhiva })
    const r = await executaExportIzo(sb, { pachet, tronson, proiect: {}, tevi, evaluare, arhiva, incomplet: false, genereazaXlsx: genereazaXlsxFals, fetchImpl: fetchFals(pdfuri), uniq: 'u7', acum: new Date('2026-11-27T10:00:00Z'), limita: 100 })
    expect(r.ok && r.separat).toBe(true)
    // rândul din istoric, cum îl citește loadExportHistory
    const doc = { id: 61, ...sb.jurnal.insert.find(x => x.t === 'executie_pachete_documente').row }
    t.executie_pachete_documente = [doc, { id: 62, pachet_id: 9, tip_document: 'centralizator', fisier_path: '9/alt.zip' }]
    // fetch pentru link-urile semnate din executie-pachete-pdf → conținutul din Storage-ul fals
    const fetchStorage = async (url) => {
      const k = url.replace('https://fals/', '')
      if (!obiecte.has(k)) return { ok: false, status: 404 }
      const b = obiecte.get(k)
      return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
    }
    return { sb, t, obiecte, doc, r, fetchStorage }
  }
  const D = '9/2026-11-27_u7_99_GAZ_X_DWG_00001_rev0_Centralizator'
  const TOATE = [`${D}/99_GAZ_X_DWG_00001_rev0_Centralizator.xlsx`, `${D}/buletine/PM_5_21.10.2026.pdf`, `${D}/buletine/PA-UT_77_28.10.2026.pdf`]

  it('lista fișierelor = cea înregistrată de server (Excel-ul rândului primul, toate în dosarul exportului)', async () => {
    const { sb, doc } = await exportSeparat()
    expect(esteLivrareSeparata(doc)).toBe(true)
    expect(await fisiereExportIstoric(sb, doc)).toEqual({ ok: true, separat: true, dosar: D, fisiere: TOATE })
  })
  it('„Descarcă” aduce TOATE fișierele, într-un ZIP cu structura arhivei originale', async () => {
    const { sb, doc, r, fetchStorage } = await exportSeparat()
    const d = await descarcaExportIstoric(sb, doc, fetchStorage)
    expect(d).toMatchObject({ ok: true, nume: '99_GAZ_X_DWG_00001_rev0_Centralizator.zip', numar: 3 })
    const zip = await JSZip.loadAsync(d.bytes), orig = await JSZip.loadAsync(r.bytes)
    const fis = z => Object.keys(z.files).filter(n => !n.endsWith('/')).sort()
    expect(fis(zip)).toEqual(fis(orig))   // aceleași fișiere ca arhiva descărcată la export
    for (const n of fis(orig)) expect(await zip.file(n).async('uint8array')).toEqual(await orig.file(n).async('uint8array'))
  })
  it('un PDF lipsă din Storage → eroare cu numele lui, fără ZIP parțial', async () => {
    const { sb, doc, obiecte, fetchStorage } = await exportSeparat()
    obiecte.delete(`executie-pachete-pdf/${TOATE[2]}`)
    const d = await descarcaExportIstoric(sb, doc, fetchStorage)
    expect(d.ok).toBe(false)
    expect(d.eroare).toMatch(/buletine\/PA-UT_77_28\.10\.2026\.pdf: descărcare eșuată \(404\)/)
    expect(d.bytes).toBeUndefined()
  })
  it('„Șterge” scoate din Storage TOATE fișierele exportului (doar pe ele), apoi rândul din istoric', async () => {
    const { sb, t, obiecte, doc } = await exportSeparat()
    obiecte.set('executie-pachete-pdf/9/alt.zip', new Uint8Array([1]))   // alt export al pachetului: rămâne
    const s = await stergeExportIstoric(sb, doc)
    expect(s).toEqual({ ok: true, numar: 3 })
    expect(sb.jurnal.remove.at(-1)).toEqual({ b: 'executie-pachete-pdf', l: TOATE })
    expect([...obiecte.keys()]).toEqual(['executie-pachete-pdf/9/alt.zip'])
    expect(t.executie_pachete_documente.map(x => x.id)).toEqual([62])
  })
  it('un fișier nu se poate șterge (Storage îl omite fără eroare) → mesaj cu numele lui, rândul RĂMÂNE; reluarea termină', async () => {
    const nuSterge = [TOATE[1]]
    const { sb, t, obiecte, doc } = await exportSeparat({ storage: { nuSterge } })
    const s = await stergeExportIstoric(sb, doc)
    expect(s.ok).toBe(false)
    expect(s.eroare).toMatch(/1 din 3 fișiere nu s-au putut șterge din Storage: buletine\/PM_5_21\.10\.2026\.pdf.*Rândul rămâne în istoric/)
    expect(s.ramase).toEqual([TOATE[1]])
    expect(t.executie_pachete_documente.map(x => x.id)).toEqual([61, 62])
    expect(sb.jurnal.delete).toBeUndefined()
    nuSterge.length = 0   // dreptul revine → a doua încercare: fișierele deja scoase nu mai contează, restul se șterge
    expect(await stergeExportIstoric(sb, doc)).toEqual({ ok: true, numar: 3 })
    expect(obiecte.size).toBe(0)
    expect(t.executie_pachete_documente.map(x => x.id)).toEqual([62])
  })
  it('ștergerea nu se poate verifica (list eșuat) → mesaj, rândul rămâne (necunoscut ≠ șters)', async () => {
    const { sb, t, doc } = await exportSeparat({ storage: { listEroare: true } })
    const s = await stergeExportIstoric(sb, doc)
    expect(s.ok).toBe(false)
    expect(s.eroare).toMatch(/pentru 3 fișiere ștergerea nu s-a putut verifica/)
    expect(t.executie_pachete_documente.map(x => x.id)).toEqual([61, 62])
  })
  it('lista invizibilă / necitită / cu altă formă → refuz, nimic descărcat sau șters (nu „doar Excel-ul”)', async () => {
    const cazuri = [
      [t => { t.sud_exporturi.length = 0 }, /lista lor nu e vizibilă/],
      [t => { t['sud_exporturi:eroare'] = { message: 'timeout' } }, /nu s-a putut citi \(timeout\)/],
      [t => { t.sud_exporturi[0].fotografie = { ...t.sud_exporturi[0].fotografie, fisiere: [...TOATE, '9/alt.zip'] } }, /altă formă/],
      [t => { t.sud_exporturi[0].fotografie = { ...t.sud_exporturi[0].fotografie, fisiere: [TOATE[0], `${D}/../8/x.pdf`] } }, /altă formă/],
      [t => { t.sud_exporturi[0].fotografie = { ...t.sud_exporturi[0].fotografie, fisiere: [TOATE[1], TOATE[0]] } }, /altă formă/],
      [t => { t.sud_exporturi[0].fotografie = { ...t.sud_exporturi[0].fotografie, livrare: 'zip' } }, /altă formă/],
      [t => { t.sud_exporturi.push({ ...t.sud_exporturi[0], id: 901 }) }, /aceeași cale/],
    ]
    for (const [strica, re] of cazuri) {
      const { sb, t, obiecte, doc, fetchStorage } = await exportSeparat()
      strica(t)
      const d = await descarcaExportIstoric(sb, doc, fetchStorage)
      expect(d.ok).toBe(false)
      expect(d.eroare).toMatch(re)
      const s = await stergeExportIstoric(sb, doc)
      expect(s.ok).toBe(false)
      expect(sb.jurnal.remove).toEqual([])
      expect(obiecte.size).toBe(3)
      expect(t.executie_pachete_documente.map(x => x.id)).toEqual([61, 62])
    }
  })
  it('rândul unui alt pachet care arată spre dosarul pachetului 9 → refuz', async () => {
    const { sb, doc } = await exportSeparat()
    expect((await fisiereExportIstoric(sb, { ...doc, pachet_id: 8 })).eroare).toMatch(/nu e al pachetului/)
  })
  it('un singur fișier (ZIP, Excel vechi, PDF aprobat): link semnat ca până acum; ștergerea îl verifică și scoate rândul', async () => {
    const t = { executie_pachete_documente: [{ id: 5, pachet_id: 9, tip_document: 'centralizator', fisier_path: '9/2026-05-01_ab_x.zip', fisier_nume: 'x.zip' }] }
    const obiecte = new Map([['executie-pachete-pdf/9/2026-05-01_ab_x.zip', new Uint8Array([1])]])
    const sb = clientFals({ tabele: t, storage: { obiecte } })
    const doc = t.executie_pachete_documente[0]
    expect(esteLivrareSeparata(doc)).toBe(false)
    expect(await descarcaExportIstoric(sb, doc)).toEqual({ ok: true, url: 'https://fals/executie-pachete-pdf/9/2026-05-01_ab_x.zip' })
    expect(sb.jurnal.select.some(x => x.t === 'sud_exporturi')).toBe(false)   // nu depinde de arhiva NDT
    expect(await stergeExportIstoric(sb, doc)).toEqual({ ok: true, numar: 1 })
    expect(obiecte.size).toBe(0)
    expect(t.executie_pachete_documente).toEqual([])
  })
  it('Izometrie.jsx: „Descarcă” / „Șterge” din istoric trec prin lista completă (nu mai lucrează doar pe fisier_path)', () => {
    const src = readFileSync(new URL('./Izometrie.jsx', import.meta.url), 'utf8')
    const corp = n => { const i = src.indexOf(`async function ${n}(doc)`); expect(i).toBeGreaterThan(-1); return src.slice(i, src.indexOf('\n  }', i)) }
    expect(corp('downloadHistory')).toMatch(/descarcaExportIstoric\(supabase, doc\)/)
    expect(corp('deleteHistory')).toMatch(/stergeExportIstoric\(supabase, doc\)/)
    expect(corp('deleteHistory')).not.toMatch(/\.remove\(/)
    expect(corp('downloadHistory')).not.toMatch(/createSignedUrl\(doc\.fisier_path/)
  })
})

describe('construiesteZip', () => {
  it('refuză un nume dublat (nu suprascrie un PDF cu altul)', async () => {
    await expect(construiesteZip({ numeXlsx: 'a.xlsx', xlsx: new Uint8Array([1]), pdfuri: [{ fisierZip: 'buletine/X.pdf', bytes: PDF(1) }, { fisierZip: 'buletine/x.pdf', bytes: PDF(2) }] }))
      .rejects.toThrow(/dublat/)
  })
})

// 20270115b (Jakarinos #1219 r2): amprenta pachetului calculată de SERVER — citită la deschiderea ferestrei, în fotografie, reverificată
// înainte de generare și de înregistrare; serverul o recalculează și el (40001 = „redeschide fereastra”)
describe('executaExportIzo — amprenta pachetului de pe server (20270115b)', () => {
  const ruleaza = (sb, arhiva, evaluare) => executaExportIzo(sb, { pachet, tronson, proiect: {}, tevi, evaluare, arhiva, incomplet: false, genereazaXlsx: genereazaXlsxFals, fetchImpl: fetchFals(pdfuri), uniq: 'ua' })
  it('citită o dată la deschidere (pe pachet), pusă în fotografie și trimisă la înregistrare; reverificată de 2 ori', async () => {
    const { sb, arhiva, evaluare } = await pregateste()
    expect(arhiva.amprentaServer).toBe(AMP)
    expect(sb.jurnal.amprenta).toEqual([{ p_pachet: 9 }])
    expect(evaluare.fotografie.amprenta_pachet).toBe(AMP)
    const r = await ruleaza(sb, arhiva, evaluare)
    expect(r.ok).toBe(true)
    expect(sb.jurnal.amprenta).toHaveLength(3)   // deschiderea + înainte de generare + înainte de înregistrare
    expect(sb.jurnal.rpc.find(x => x[0] === 'fn_sud_export_inregistreaza')[1].p_fotografie.amprenta_pachet).toBe(AMP)
  })
  it('fără drept de export amprenta nu se cere (butonul e oricum oprit); eroarea ei = amprentă lipsă, export oprit înainte de orice scriere', async () => {
    const f = clientFals({ tabele: tabeleBaza(), drept: { citire: true, scriere: false, export: false } })
    const a = await citesteArhivaNdt(f, { proiectId: 1, tronsonId: 5, pachetId: 9, kmStart: 1000 })
    expect(f.jurnal.amprenta).toEqual([]); expect(a.amprentaServer).toBe(null); expect(a.eroareAmprenta).toMatch(/fără drept de export/)
    for (const amprenta of [() => ({ data: null, error: { code: 'PGRST202', message: 'functia lipseste' } }), () => ({ data: AMP.toUpperCase(), error: null }), () => ({ data: 42, error: null }), () => { throw new Error('retea') }]) {
      const { sb, arhiva, evaluare } = await pregateste({ amprenta })
      expect(arhiva.amprentaServer).toBe(null); expect(arhiva.eroareAmprenta).toBeTruthy()
      expect(evaluare.fotografie.amprenta_pachet).toBe(null)
      const r = await ruleaza(sb, arhiva, evaluare)
      expect(r.ok).toBe(false); expect(r.eroare).toMatch(/amprenta pachetului de pe server/)
      expect(sb.jurnal.upload).toEqual([]); expect(sb.jurnal.rpc.filter(x => x[0] !== 'fn_sud_drept')).toEqual([])
    }
  })
  it('amprenta serverului schimbată după deschidere (chiar cu rândurile clientului neschimbate — ex. un rând pe care nu-l vede) → refuz înainte de generare, nimic scris', async () => {
    const { sb, arhiva, evaluare } = await pregateste({ amprenta: n => ({ data: n === 1 ? AMP : AMP2, error: null }) })
    const r = await ruleaza(sb, arhiva, evaluare)
    expect(r).toMatchObject({ ok: false, surseSchimbate: true, pachetSchimbat: true })
    expect(r.eroare).toMatch(/s-au schimbat pe server/)
    expect(sb.jurnal.upload).toEqual([]); expect(sb.jurnal.rpc.filter(x => x[0] !== 'fn_sud_drept')).toEqual([])
  })
  it('schimbată între încărcare și înregistrare → fișierul încărcat se scoate, înregistrarea NU se cere', async () => {
    const { sb, arhiva, evaluare } = await pregateste({ amprenta: n => ({ data: n <= 2 ? AMP : AMP2, error: null }) })
    const r = await ruleaza(sb, arhiva, evaluare)
    expect(r).toMatchObject({ ok: false, surseSchimbate: true })
    expect(sb.jurnal.upload).toHaveLength(1)
    expect(sb.jurnal.remove).toEqual([{ b: 'executie-pachete-pdf', l: [sb.jurnal.upload[0].p] }])
    expect(sb.jurnal.rpc.some(x => x[0] === 'fn_sud_export_inregistreaza')).toBe(false)
  })
  it('reverificarea amprentei eșuată (rețea) → export oprit cu eroare, NU „neschimbat” (L18)', async () => {
    const { sb, arhiva, evaluare } = await pregateste({ amprenta: n => (n === 1 ? { data: AMP, error: null } : { data: null, error: { message: 'timeout' } }) })
    const r = await ruleaza(sb, arhiva, evaluare)
    expect(r.ok).toBe(false); expect(r.eroare).toMatch(/nu s-a putut reciti \(timeout\)/)
    expect(sb.jurnal.upload).toEqual([])
  })
  it('40001 de la server pe „pachet” → „redeschide fereastra”, fișierul se scoate', async () => {
    const { sb, arhiva, evaluare } = await pregateste({ rpc: { fn_sud_export_inregistreaza: async () => ({ data: null, error: { code: '40001', message: 'sud: sursele s-au schimbat intre verificare si export (pachet); reincarca fereastra' } }) } })
    const r = await ruleaza(sb, arhiva, evaluare)
    expect(r).toMatchObject({ ok: false, surseSchimbate: true })
    expect(sb.jurnal.remove).toHaveLength(1)
  })
})
