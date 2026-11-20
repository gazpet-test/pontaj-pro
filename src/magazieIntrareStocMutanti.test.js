// TKT-0353: mutanții intrării peste stoc. Fiecare copie stricată intenționat a magazieIntrareStoc.js TREBUIE să încalce
// cel puțin o proprietate de mai jos, iar originalul niciuna — altfel testele nu dovedesc nimic (L25).
// Copiile se scriu într-un folder temporar (cu dependențele lângă), se importă, apoi se șterg. Mutanții sunt pe o singură linie (CRLF).
import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { dbFals } from './magazieIntrareStocDbFals.testutil.js'

const SRC = new URL('./', import.meta.url)
const LOGICA = readFileSync(new URL('magazieIntrareStoc.js', SRC), 'utf8')
const TMP = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'intrare-stoc-mutanti-')))
for (const dep of ['eipIntrareLogica.js', 'magazieEipLogica.js', 'hrDeciziiUtil.js']) writeFileSync(path.join(TMP, dep), readFileSync(new URL(dep, SRC), 'utf8'))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

let n = 0
async function incarca(text) {
  const f = path.join(TMP, `logica_${n++}.js`)
  writeFileSync(f, text)
  return import(/* @vite-ignore */ pathToFileURL(f).href)
}
function mutant(din, in_) {
  if (LOGICA.split(din).length !== 2) throw new Error('mutația nu se aplică exact o dată: ' + din.slice(0, 80))
  return LOGICA.split(din).join(in_)
}

const REF = '0a1b2c3d'
const LINIE = 'Intrare +10 buc · 2026-11-20 · ref ' + REF
const rand = () => ({ id: 7, cantitate_total: 29, observatii: 'Factura 1', activ: true })
const cerere = { id: 7, totalVazut: 29, primit: 10, linie: LINIE, ref: REF }

async function incalcari(m) {
  const out = []
  if (m.sumaStoc(29, '10').total !== 39) out.push('suma: 29 + 10 nu dă 39')
  if (m.sumaStoc(29, '0').ok !== false || m.sumaStoc(29, '-5').ok !== false) out.push('suma: 0 / negativ acceptat')
  if (m.adaugaLaObservatii('vechi', 'nou') !== 'vechi\nnou') out.push('observații: linia nu se adaugă după cele vechi')
  {
    const { db, tabel } = dbFals([rand()])
    const r = await m.aplicaIntrare(db, cerere)
    if (r.stare !== 'ok' || tabel.get(7).cantitate_total !== 39) out.push('scriere: cazul normal nu dă 39')
  }
  {
    // altcineva schimbă DOAR totalul între citire și scriere
    const { db, tabel } = dbFals([rand()], { dupaCitire: (t, k) => { if (k === 1) t.get(7).cantitate_total = 31 } })
    const r = await m.aplicaIntrare(db, cerere)
    if (r.stare !== 'conflict' || tabel.get(7).cantitate_total !== 31) out.push('scriere: concurența pe total nu e prinsă')
  }
  {
    const { db, tabel } = dbFals([{ ...rand(), cantitate_total: 39, observatii: 'Factura 1\n' + LINIE }])
    const r = await m.aplicaIntrare(db, cerere)
    if (r.stare !== 'deja' || tabel.get(7).cantitate_total !== 39) out.push('scriere: reîncercarea adună de două ori')
  }
  {
    const { db } = dbFals([rand()], { laUpdate: () => ({ data: [], error: null }) })
    if ((await m.aplicaIntrare(db, cerere)).stare === 'ok') out.push('scriere: 0 rânduri trece drept succes')
  }
  {
    const { db } = dbFals([rand()], { laUpdate: () => ({ data: [{ id: 7 }, { id: 7 }], error: null }) })
    if ((await m.aplicaIntrare(db, cerere)).stare === 'ok') out.push('scriere: 2 rânduri trec drept succes')
  }
  {
    // ecranul arăta 29, în BD e deja 35 (altă intrare între timp): nu se adună peste 35 fără ca omul să vadă
    const { db, tabel } = dbFals([{ ...rand(), cantitate_total: 35 }])
    const r = await m.aplicaIntrare(db, cerere)
    if (r.stare !== 'conflict' || tabel.get(7).cantitate_total !== 35) out.push('scriere: totalul vechi din ecran nu e prins')
  }
  {
    const lista = [{ id: 1, denumire: 'Cască', categorie: 'eip', um: 'buc' }, { id: 2, denumire: 'Cască', categorie: 'scule', um: 'buc' }]
    const ids = m.potrivireExistente({ denumire: 'CASCA', um: 'buc' }, 'eip', lista, new Set()).map(p => p.id)
    if (ids.length !== 1 || ids[0] !== 1) out.push('potrivire: diacritice/categorie greșit')
  }
  // ── r2 ──
  {
    // P1: lista completă peste plafonul serverului; potrivirea nevăzută de om e semnalată
    const lista = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, denumire: i === 1499 ? 'Cască' : `A${i}`, categorie: 'eip', um: 'buc' }))
    try {
      const toate = await m.citesteEchipamente(dbFals(lista, { maxRows: 1000 }).db)
      if (toate.length !== 2500) out.push('P1: lista nu e completă peste plafon')
      const dub = m.dubluriNevazute([{ k: 1, denumire: 'casca', um: 'buc', tinta: 'nou', vazute: [] }], 'eip', toate)
      if (dub.length !== 1 || dub[0].ids[0] !== 1500) out.push('P1: dublura nevăzută nu e semnalată')
      if (m.dubluriNevazute([{ k: 1, denumire: 'casca', um: 'buc', tinta: 'nou', vazute: [1500] }], 'eip', toate).length) out.push('P1: potrivirea văzută e refuzată')
    } catch (e) { out.push('P1: citirea completă aruncă: ' + e.message) }
  }
  {
    // P2: stoc 29, +10 și +5 pe același echipament → 44, fără conflict
    const { db, tabel } = dbFals([{ id: 7, cantitate_total: 29, observatii: null, activ: true }])
    const l = (q, ref) => m.linieIntrare({ cantitate: q, um: 'buc', dataIntrare: '2026-11-20', ref })
    const r = await m.aplicaLot(db, [{ k: 'a', id: 7, totalVazut: 29, primit: 10, ref: REF, linie: l(10, REF) }, { k: 'b', id: 7, totalVazut: 29, primit: 5, ref: '99887766', linie: l(5, '99887766') }])
    if (r.oprit || tabel.get(7).cantitate_total !== 44) out.push('P2: rândurile pe același echipament intră în conflict')
  }
  {
    // P3: „1,001” validat → număr 1.001 → acceptat la scriere
    const v = m.validareIntrare({ cantitate: '1,001' }, '2026-11-20')
    const s = v.ok ? m.sumaStoc(29, v.cantitate) : { ok: false }
    if (!s.ok || s.total !== 30.001) out.push('P3: 1,001 respins după validare')
    if (m.eroareCantitateIntrare('1.001') === '') out.push('P3: textul 1.001 nu mai e ambiguu')
  }
  {
    // P4: același ref, alt conținut → nu „deja”, nu scrie
    const { db, tabel } = dbFals([{ id: 7, cantitate_total: 39, observatii: 'Factura 1\n' + LINIE, activ: true }])
    const r = await m.aplicaIntrare(db, { ...cerere, totalVazut: 39, primit: 15, linie: 'Intrare +15 buc · 2026-11-20 · ref ' + REF })
    if (r.stare === 'deja' || r.stare === 'ok' || tabel.get(7).cantitate_total !== 39) out.push('P4: același ref cu alt conținut trece drept succes / se adună')
  }
  {
    // P4: linia cu ref-ul editată de mână → nu se adună a doua oară
    const { db, tabel } = dbFals([{ id: 7, cantitate_total: 39, observatii: LINIE + ' — verificat', activ: true }])
    const r = await m.aplicaIntrare(db, { ...cerere, totalVazut: 39 })
    if (r.stare === 'ok' || tabel.get(7).cantitate_total !== 39) out.push('P4: ref-ul editat permite a doua adunare')
  }
  // ── r3 ──
  const FACT1 = { nr: 'F1', data: '2026-11-20', furnizor: '', categorie: 'scule' }
  const r5 = { k: 1, denumire: 'Cheie', cantitate: '5', um: 'buc', ref: REF, cheie: `${REF}-0000-4000-8000-000000000000`, tinta: 'nou' }
  const creat5 = () => ({ id: 9, ...m.randNou(r5, FACT1).payload, activ: true })
  const salv = (db, rows, fact = FACT1) => m.salveazaFactura(db, { rows, fact, uid: 'u', azi: '2026-11-20', echipamente: [], catalogIds: new Set() })
  {
    // P4b: rândul nou deja creat (inserare cu rezultat necunoscut) se recunoaște după ref + conținut
    if (m.judecaRandFactura(r5, m.randNou(r5, FACT1), [creat5()]).stare !== 'creat') out.push('P4b: rândul creat nu e recunoscut')
    if (m.judecaRandFactura({ ...r5, ref: '99887766' }, m.randNou({ ...r5, ref: '99887766' }, FACT1), [creat5()]).stare !== 'absent') out.push('P4b: alt ref recunoscut ca propriu')
  }
  {
    // r3 P1 (verdict): creat cu 5 / F1, apoi aceeași referință cu 15 / F2 → nu „deja salvat”, nimic scris, stocul rămâne 5
    const { db, tabel, jurnal } = dbFals([creat5()])
    const res = await salv(db, [{ ...r5, cantitate: '15' }], { ...FACT1, nr: 'F2' })
    if (res.aplicate.length || !res.eroare || jurnal.insert.length || jurnal.update.length || tabel.get(9).cantitate_total !== 5) out.push('r3 P1: același ref cu alt conținut trece drept „deja salvat”')
    if (m.judecaRandFactura(r5, m.randNou({ ...r5, denumire: 'Cheie mare' }, FACT1), [creat5()]).stare !== 'alta') out.push('r3 P1: denumirea diferită nu e respinsă')
    if (m.judecaRandFactura({ ref: REF, tinta: 7 }, m.randNou({ ...r5, cantitate: '7' }, FACT1), [creat5()]).stare !== 'alta') out.push('r3 P1: ref-ul de pe alt echipament nu e respins')
    // calea legitimă: identic → recunoscut, fără a doua inserare
    const d2 = dbFals([creat5()])
    const ok = await salv(d2.db, [r5])
    if (ok.eroare || ok.aplicate[0] !== 1 || d2.jurnal.insert.length) out.push('r3 P1: rândul creat identic nu e recunoscut')
  }
  {
    // r3 P2 (verdict): eroare de rețea (status 0) / 5xx, recitirea nu vede ref-ul → necunoscut, nu „nimic scris”
    for (const [status, nume] of [[0, 'rețea'], [503, '5xx']]) {
      const { db } = dbFals([rand()], { laUpdate: () => ({ data: null, error: { message: 'TypeError: Failed to fetch' }, status }) })
      if ((await m.aplicaIntrare(db, cerere)).stare !== 'necunoscut') out.push(`r3 P2: eroarea ${nume} declarată eșec cert`)
    }
    const { db } = dbFals([rand()], { laUpdate: () => ({ data: null, error: { message: 'permission denied', code: '42501' }, status: 403 }) })
    if ((await m.aplicaIntrare(db, cerere)).stare !== 'eroare') out.push('r3 P2: refuzul 4xx nu mai e eșec cert')
    const ins0 = await m.insereazaNoi(dbFals([], { laInsert: (t, p, ins) => { ins(p); return { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 } } }).db, [m.randNou(r5, FACT1)], 'u')
    if (ins0.stare !== 'necunoscut') out.push('r3 P2: inserarea cu eroare de rețea declarată eșec cert')
    const ins4 = await m.insereazaNoi(dbFals([], { laInsert: () => ({ data: null, error: { message: 'denied' }, status: 403 }) }).db, [m.randNou(r5, FACT1)], 'u')
    if (ins4.stare !== 'eroare') out.push('r3 P2: inserarea refuzată 4xx nu e eșec cert')
  }
  {
    // r3 P2: inserarea ajunge, răspunsul e eroare de rețea → rândul blocat; reîncercarea (antetul din ecran schimbat) → recunoscut, o singură inserare
    const { db, tabel, jurnal } = dbFals([], { laInsert: (t, p, ins) => { if (jurnal.insert.length === 1) { ins(p); return { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 } } } })
    const r1 = await salv(db, [r5])
    const nec = r1.necunoscute.find(x => x.k === 1)
    if (!nec) out.push('r3 P2: rândul cu inserare necunoscută nu se blochează')
    else {
      const r2 = await salv(db, [{ ...r5, fixat: nec.fixat }], { ...FACT1, nr: 'F2' })
      if (r2.eroare || r2.aplicate[0] !== 1 || jurnal.insert.length !== 1 || tabel.size !== 1) out.push('r3 P2: reîncercarea după inserare necunoscută nu recunoaște rândul creat')
    }
  }
  // ── r4 (NO-GO Jak r3 pe 3d059fe7) ──
  const RETEA = { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 }
  const ecran = (rows, res) => m.randuriDupaSalvare(rows, res, () => ({ k: 'gol', denumire: '' }))
  {
    // verdict: 5 buc, rețea, cererea întârziată; retrimiterea fără confirmare; cererea ajunge → un singur rând
    let inZbor = null
    const f = dbFals([], { laInsert: (t, p, ins) => { if (f.jurnal.insert.length === 1) { inZbor = () => ins(p); return RETEA } } })
    const r1 = await salv(f.db, [r5])
    const rows = ecran([r5], r1)
    const r2 = await salv(f.db, rows)
    if (inZbor) inZbor()
    if (f.tabel.size !== 1 || f.jurnal.insert.length !== 1) out.push('r4: inserarea necunoscută reinserată fără confirmare (rând dublat)')
    if (!(r2.deConfirmat || []).includes(1)) out.push('r4: refuzul fără confirmare nu e raportat')
    // după ce cererea a ajuns, salvarea fără confirmare îl recunoaște (nu cere confirmare)
    const r3 = await salv(f.db, rows)
    if (r3.eroare || r3.aplicate[0] !== 1 || f.jurnal.insert.length !== 1) out.push('r4: rândul ajuns nu e recunoscut fără confirmare')
  }
  {
    // calea legitimă: inserarea n-a ajuns, omul confirmă → o retrimitere identică
    const f = dbFals([], { laInsert: () => (f.jurnal.insert.length === 1 ? RETEA : null) })
    const rows = ecran([r5], await salv(f.db, [r5]))
    const r2 = await salv(f.db, [{ ...rows[0], retrimitereConfirmata: true }])
    if (r2.eroare || f.tabel.size !== 1 || f.jurnal.insert.length !== 2) out.push('r4: retrimiterea confirmată nu se face')
  }
  {
    // confirmarea veche nu supraviețuiește unui nou rezultat necunoscut
    const fixat = { tinta: 'nou', inserare: 'necunoscuta' }
    const dupa = ecran([{ ...r5, fixat, retrimitereConfirmata: true }], { aplicate: [], necunoscute: [{ k: 1, fixat }] })
    if (dupa[0].retrimitereConfirmata !== false) out.push('r4: confirmarea rămâne după un nou rezultat necunoscut')
  }
  // ── r5 (regula din BD: referinta_intentie UNIQUE; falsul o aplică la fel ca migrarea) ──
  {
    // verdict r4: retrimiterea CONFIRMATĂ + cererea inițială sosită mai târziu → un singur rând
    let inZbor = null
    const f = dbFals([], { laInsert: (t, p, ins) => { if (f.jurnal.insert.length === 1) { inZbor = () => ins(p); return RETEA } } })
    const rows = ecran([r5], await salv(f.db, [r5]))
    const r2 = await salv(f.db, [{ ...rows[0], retrimitereConfirmata: true }])
    if (inZbor) inZbor()
    if (r2.eroare || r2.aplicate[0] !== 1 || f.tabel.size !== 1) out.push('r5: retrimiterea confirmată + cererea întârziată = rând dublat / nesalvat')
  }
  {
    // ordinea inversă: cererea inițială ajunge între recitirea listei și retrimitere → retrimiterea e sărită (ON CONFLICT) și recunoscută
    let prima = null
    const f = dbFals([], { laInsert: (t, p, ins) => { const n = f.jurnal.insert.length; if (n === 1) { prima = p; return RETEA } if (n === 2) ins(prima) } })
    const rows = ecran([r5], await salv(f.db, [r5]))
    const r2 = await salv(f.db, [{ ...rows[0], retrimitereConfirmata: true }])
    if (r2.eroare || r2.aplicate[0] !== 1 || f.tabel.size !== 1) out.push('r5: cererea inițială sosită înaintea retrimiterii = refuz / dublură')
  }
  {
    // aceeași cheie în BD cu ALT conținut (observațiile rândului nu mai au linia) → refuz, nimic scris, rândul existent neatins
    // (altă denumire: altfel potrivirea nevăzută din listă ar refuza înaintea inserării și proprietatea n-ar testa recitirea)
    const strain = { id: 9, ...m.randNou({ ...r5, denumire: 'Cheie veche', cantitate: '6' }, FACT1).payload, observatii: 'editat de mână', activ: true }
    const f = dbFals([strain])
    const res = await salv(f.db, [r5])
    if (!res.eroare || res.aplicate.length || f.tabel.size !== 1 || f.tabel.get(9).cantitate_total !== 6) out.push('r5: aceeași cheie cu alt conținut trece drept salvat')
  }
  {
    // răspuns fără eroare, dar rândul nu apare la recitire → necunoscut (nu salvat)
    const f = dbFals([], { laInsert: () => ({ data: null, error: null, status: 201 }) })
    const res = await salv(f.db, [r5])
    if (res.aplicate.length || !(res.necunoscute || []).some(x => x.k === 1)) out.push('r5: rândul negăsit la recitire trece drept salvat')
    // recitirea eșuată → necunoscut
    const g = dbFals([], { laRecitire: () => ({ data: null, error: { message: 'timeout' }, status: 504 }) })
    const res2 = await salv(g.db, [r5])
    if (res2.aplicate.length || !(res2.necunoscute || []).some(x => x.k === 1)) out.push('r5: recitirea eșuată trece drept salvat')
  }
  {
    // rândul fără cheie nu se trimite; rândul din tabel cu linia noastră dar ALTĂ cheie nu e „al nostru”
    const f = dbFals([])
    const res = await salv(f.db, [{ ...r5, cheie: undefined }])
    if (f.jurnal.insert.length || !res.eroare) out.push('r5: rândul fără cheie e trimis')
    const altaCheie = { id: 9, ...m.randNou(r5, FACT1).payload, referinta_intentie: '99999999-0000-4000-8000-000000000000', activ: true }
    if (m.judecaRandFactura(r5, m.randNou(r5, FACT1), [altaCheie]).stare === 'creat') out.push('r5: rândul cu altă cheie recunoscut ca propriu')
  }
  return out
}

const MUTANTI = [
  ['fără .eq(cantitate_total) la UPDATE', ".eq('id', id).eq('activ', true).eq('cantitate_total', b.cantitate_total)", ".eq('id', id).eq('activ', true)"],
  ['adunarea înlocuită cu atribuirea (= primit)', 'const cifre = (intreg(ta) + intreg(tb)).toString()', 'const cifre = (intreg(tb)).toString()'],
  ['fără verificarea totalului văzut', 'if (!egalNr(b.cantitate_total, totalVazut)) return', 'if (false) return'],
  ['succes pe orice număr de rânduri', 'r1.data.length === 1 && String', 'r1.data.length >= 0 && String'],
  ['fără verificarea ref-ului (reîncercare dublă)', "if (s0 === 'aceeasi') return { stare: 'deja', total: b.cantitate_total }", ''],
  // r2
  ['P1: keyset fără .gt (o singură pagină repetată)', "return ultim == null ? q : q.gt('id', ultim)", 'return q'],
  ['P1: potrivirile nevăzute ignorate', '.filter(p => !vazute.has(String(p.id)))', '.filter(() => false)'],
  ['P1: potrivirile văzute nu mai contează', 'const vazute = new Set((r.vazute || []).map(String))', 'const vazute = new Set()'],
  ['P2: baza nu urmează scrierea anterioară', 'if (r.stare === \'ok\') baza.set(p.id, r.total)', 'if (r.stare === \'ok\') void 0'],
  // forma din 36c24a18 (String + reparsare)
  ['P3: numărul validat tratat iar ca text ambiguu', "typeof valoare === 'string' && /^\\d{1,3}\\.\\d{3}$/.test(valoare.trim())", "/^\\d{1,3}\\.\\d{3}$/.test(String(valoare ?? '').trim())"],
  ['P4: orice linie cu ref-ul = „deja”', "cu.length === 1 && cu[0].trim() === String(linie).trim() ? 'aceeasi' : 'alta'", "'aceeasi'"],
  ['P4: ref cu alt conținut nu oprește scrierea', "if (s0 === 'alta') return { stare: 'eroare', mesaj: MESAJ_REF_ALT }", ''],
  ['P4b: rândul creat nu se recunoaște', "if (cu.length === 1 && eRandulNou(cu[0], intentie, ref)) return { stare: 'creat', echip: cu[0] }", ''],
  // r3 (NO-GO Jak r2 pe 3f7e3a53)
  ['r3 P1: rândul creat recunoscut doar după ref (forma r2)', "if (cu.length === 1 && eRandulNou(cu[0], intentie, ref)) return { stare: 'creat', echip: cu[0] }", "return { stare: 'creat', echip: cu[0] }"],
  ['r3 P1: linia (cantitate / factură) nu se compară', "stareRef(e.observatii, intentie.linie, ref) === 'aceeasi' &&", ''],
  ['r3 P1: denumirea nu se compară', 'unRand(e.denumire) === p.denumire &&', ''],
  ['r3 P1: alt conținut tratat ca absent', "return { stare: 'alta', echip: cu[0] }", "return { stare: 'absent' }"],
  ['r3 P1: ref-ul de pe alt echipament acceptat', 'cu.every(e => String(e.id) === String(tinta))', 'true'],
  ['r3 P1: reîncercarea ignoră valorile fixate', 'export const intentieRand = (r, fact) => randNou(r.fixat?.rand || r, r.fixat?.fact || fact)', 'export const intentieRand = (r, fact) => randNou(r, fact)'],
  ['r3 P2: eroarea fără 4xx = eșec cert (forma r2)', "if (r1.error ? !esecCert(r1) : !Array.isArray(r1.data)) return { stare: 'necunoscut', mesaj: MESAJ_NECUNOSCUT(ref) }", ''],
  ['r3 P2: status 0 (rețea) = refuz 4xx', 'Number.isInteger(s) && s >= 400 && s < 500', 'Number.isInteger(s) && s < 500'],
  ['r3 P2: 5xx = refuz 4xx', 's >= 400 && s < 500', 's >= 400 && s < 600'],
  ['r3 P2: inserarea necunoscută tratată ca eroare', 'return { stare: \'necunoscut\', mesaj: `Rezultatul inserării nu poate fi confirmat (${m}).`, ...toate(\'necunoscut\') }', "return { stare: 'eroare', mesaj: m }"],
  ['r3 P2: rândurile cu inserare necunoscută nu se blochează', "necunoscute.push(...cu('necunoscut').map(({ r }) =>", "Array.of().push(...cu('necunoscut').map(({ r }) =>"],
  // r4 (NO-GO Jak r3 pe 3d059fe7)
  ['r4: inserarea necunoscută retrimisă fără confirmare (forma r3)', 'if (neconfirmate.length) return gata(', 'if (false) return gata('],
  ['r4: confirmarea omului ignorată (refuz mereu)', 'inserareNecunoscuta(x.r) && x.r.retrimitereConfirmata !== true', 'inserareNecunoscuta(x.r)'],
  ['r4: rândul ajuns cere totuși confirmare', "x.j.stare !== 'creat' && inserareNecunoscuta(x.r)", 'inserareNecunoscuta(x.r)'],
  ['r4: inserarea necunoscută nemarcată', "), inserare: 'necunoscuta' } })))", ') } })))'],
  ['r4: confirmarea păstrată după un nou rezultat necunoscut', '{ ...r, fixat: nec.get(r.k), retrimitereConfirmata: false }', '{ ...r, fixat: nec.get(r.k) }'],
  // r5 (decizia owner-ului: regula din BD, migrarea 20261231a)
  ['r5: INSERT simplu în loc de ON CONFLICT DO NOTHING', "r = await db.from('magazie_echipamente').upsert(lista.map(i => ({ ...i.payload, created_by: uid })), { onConflict: 'referinta_intentie', ignoreDuplicates: true })", "r = await db.from('magazie_echipamente').insert(lista.map(i => ({ ...i.payload, created_by: uid })))"],
  ['r5: cheia intenției lipsește din rândul trimis', 'observatii: linie, referinta_intentie: cheie },', 'observatii: linie, referinta_intentie: null },'],
  ['r5: fără recitirea pe referință (răspunsul fără eroare = salvat)', "return cu.length === 1 && eRandulNou(cu[0], i, i.ref) ? 'ok' : 'alta'", "return 'ok'"],
  ['r5: aceeași referință cu alt conținut = salvat', "return cu.length === 1 && eRandulNou(cu[0], i, i.ref) ? 'ok' : 'alta'", "return cu.length >= 1 ? 'ok' : 'alta'"],
  ['r5: rândul negăsit la recitire = salvat', "if (!cu.length) return 'necunoscut'", "if (!cu.length) return 'ok'"],
  ['r5: recitirea eșuată = salvat', "nu creează al doilea rând.`, ...toate('necunoscut') }", "nu creează al doilea rând.`, ...toate('ok') }"],
  ['r5: cheia din rândul recitit nu se compară', '(e.referinta_intentie != null && String(e.referinta_intentie).toLowerCase() === p.referinta_intentie)', 'true'],
  ['r5: rânduri fără cheie trimise totuși', "if (!lista.length || chei.some(c => !UUID_VALID.test(String(c ?? ''))) || new Set(chei).size !== chei.length ||", 'if (!lista.length ||'],
  ['P4: ref doar la final de linie (editarea îl ascunde)', 'const token = new RegExp(`(?:^|[^0-9A-Za-z])ref ${ref}(?![0-9A-Za-z])`)', 'const token = new RegExp(`(?:^|[^0-9A-Za-z])ref ${ref}$`)'],
  ['observațiile vechi înlocuite', 'return v ? `${v}\\n${linie}` : linie', 'return linie'],
  ['cantitate 0 acceptată', 'if (!(q > 0)) return', 'if (!(q >= 0)) return'],
  ['categoria nu se compară', 'e.categorie === categorie &&', ''],
]

describe('mutanți intrare peste stoc', () => {
  it('originalul trece toate proprietățile', async () => {
    expect(await incalcari(await incarca(LOGICA))).toEqual([])
  })
  for (const [nume, din, in_] of MUTANTI) {
    it(`mutantul „${nume}” e prins`, async () => {
      const m = await incarca(mutant(din, in_))
      expect((await incalcari(m)).length).toBeGreaterThan(0)
    })
  }
})
