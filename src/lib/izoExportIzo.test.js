// „Export IZO înainte de lansare” — logica pură (src/lib/izoExportIzo.js). Date inventate (tronson T7, proiect 1).
import { describe, it, expect } from 'vitest'
import {
  randuriPentruStare, evalueazaExportIzo, construiesteFotografie, grupeazaLipsuri, cereMetode, stareButonExport,
  coloaneAfisate, codDocumentAfisat, codDocumentFisier, numeExportIzo, planBuletineZip, diferenteFotografie,
  amprentaPachet, amprentaRanduri, diferentePachet,
} from './izoExportIzo.js'
import { starePeSudura } from './izoNdt.js'

const SHA = 'a'.repeat(64)
const bul = (id, metoda, numar, data, extra = {}) => ({
  id, versiune: 2, proiect_id: 1, tronson_id: 5, metoda, numar, data_buletin: data,
  fisier_path: `1/5/${metoda}_${numar}.pdf`, fisier_nume: `${metoda}_${numar}.pdf`, fisier_sha256: SHA, stare: 'confirmat', ...extra,
})
// rândul din BD: cheia SERVERULUI e „T7S1”; clientul o reface din tronson_nr / nr / sufix
const rnd = (id, buletin_id, nr, rezultat = 'acceptat', extra = {}) => ({
  id, buletin_id, ordine: id, cod_raw: `GAZPET TR7 S${nr}`, stare_cod: 'ok', tronson_nr: 7, nr, sufix: '', refacuta: false,
  cheie: `T7S${nr}`, rezultat, data_inspectie: '2026-10-20', ...extra,
})
const teava = (poz, serie, sudura_cod, extra = {}) => ({
  id: 100 + poz, poz_in_pachet: poz, tip_rand: 'teava', serie_unica: serie, tip: 'L', dimensiune: 'DN300x8', sarja: `SJ${poz}`,
  lungime_m: 12, sudura_cod, pm_cod: null, pa_ut_cod: null, ut_cod: null, ...extra,
})
const pachet = { id: 9, proiect_id: 1, tronson_id: 5, km_start_m: 1000, total_lungime_m: 36, cod_document_full: '99_GAZ_X_DWG_00001', revizie: 0 }
const tronson = { id: 5, cod: 'T7', proiect_id: 1 }
const tevi = [teava(1, 'S-1', 'T7S1'), teava(2, 'S-2', 'T7S2'), teava(3, 'S-3', null)]
const buletine = [bul(11, 'PA-UT', '77', '2026-10-28'), bul(12, 'PM', '5', '2026-10-21')]
const randuri = [rnd(1, 11, 1), rnd(2, 11, 2), rnd(3, 12, 1), rnd(4, 12, 2)]
const arhiva = (o = {}) => ({ ok: true, buletine, randuri, eliminate: [], metode: ['PA-UT', 'PM'], pachetAnterior: null, drept: { citire: true, scriere: true, export: true }, ...o })

describe('randuriPentruStare — rândurile din BD', () => {
  it('cheia se reface din tronson_nr / nr / sufix (forma JS „7|1|”), nu din cheia BD „T7S1”', () => {
    const { randuri: r } = randuriPentruStare(buletine, randuri)
    const s = starePeSudura(r)
    expect(Object.keys(s.suduri).sort()).toEqual(['7|1|', '7|2|'])
    expect(s.ignorate).toEqual([])
    expect(s.suduri['7|1|'].metode['PA-UT'].valabil.buletin_id).toBe(11)
  })
  it('nimic nu dispare tăcut: rândurile nepotrivite, orfane și buletinele fără rânduri se numără', () => {
    const b3 = bul(13, 'UT', '9', '2026-10-22')
    const out = randuriPentruStare([...buletine, b3], [...randuri,
      { ...rnd(5, 11, 3), stare_cod: 'nepotrivit', tronson_nr: null, nr: null, cheie: null },
      rnd(6, 999, 1)])
    expect(out.randuri).toHaveLength(4)
    expect(out.nepotrivite.map(r => r.id)).toEqual([5])
    expect(out.orfane.map(r => r.id)).toEqual([6])
    expect(out.faraRanduri.map(b => b.id)).toEqual([13])
  })
})

describe('evalueazaExportIzo + fotografia', () => {
  it('pachet complet → fără blocaje; fotografia = toate buletinele confirmate (id + versiune), ordonate', () => {
    const e = evalueazaExportIzo({ pachet, tronson, tevi, arhiva: arhiva() })
    expect(e.verificare.blocaje).toEqual([])
    expect(e.verificare.blocajeDeblocabile).toEqual([])
    expect(e.fotografie.buletine).toEqual([
      { id: 11, versiune: 2, eticheta: 'PA-UT 77/28.10.2026' },
      { id: 12, versiune: 2, eticheta: 'PM 5/21.10.2026' },
    ])
    expect(e.fotografie.metode).toEqual(['PA-UT', 'PM'])
    expect(e.fotografie.eliminate).toEqual([])
    expect(e.fotografie.lipsuri_blocante).toEqual([])
    expect(Array.isArray(e.fotografie.avertismente)).toBe(true)
  })
  it('buletin confirmat care nu acoperă nicio sudură a pachetului intră totuși în fotografie (serverul compară tot tronsonul)', () => {
    const e = evalueazaExportIzo({ pachet, tronson, tevi, arhiva: arhiva({ buletine: [...buletine, bul(14, 'PM', '8', '2026-11-01')], randuri: [...randuri, rnd(7, 14, 50)] }) })
    expect(e.fotografie.buletine.map(b => b.id)).toEqual([11, 12, 14])
  })
  it('metodele nesetate (rând lipsă) → blocaj setare_metode_lipsa, fotografie null, nicio valoare implicită', () => {
    const e = evalueazaExportIzo({ pachet, tronson, tevi, arhiva: arhiva({ metode: null }) })
    expect(e.verificare.blocaje.map(x => x.cod)).toEqual(['setare_metode_lipsa'])
    expect(cereMetode(e.verificare)).toBe(true)
    expect(e.fotografie).toBe(null)
  })
  it('[] = nicio metodă obligatorie (setare explicită) ≠ nesetat', () => {
    const e = evalueazaExportIzo({ pachet, tronson, tevi, arhiva: arhiva({ metode: [] }) })
    expect(cereMetode(e.verificare)).toBe(false)
    expect(e.fotografie.metode).toEqual([])
  })
  it('arhiva necitită (eroare) → blocaj, nu „fără buletine” (L18)', () => {
    const e = evalueazaExportIzo({ pachet, tronson, tevi, arhiva: { ok: false, eroare: 'rețea' } })
    expect(e.verificare.blocaje.map(x => x.cod)).toEqual(expect.arrayContaining(['stare_buletine_lipsa', 'setare_metode_lipsa', 'eliminate_lipsa']))
    expect(e.fotografie).toBe(null)
    expect(stareButonExport({ evaluare: e }).activ).toBe(false)
  })
  it('lipsă PM pe o sudură → lipsă blocantă cu deblocare, în fotografie exact cu {cod, rand, mesaj}', () => {
    const e = evalueazaExportIzo({ pachet, tronson, tevi, arhiva: arhiva({ randuri: randuri.filter(r => r.id !== 4) }) })
    expect(e.fotografie.lipsuri_blocante).toEqual([{ cod: 'buletin_lipsa', rand: 2, mesaj: 'Sudura T7S2 n-are buletin PM acceptat (metodă obligatorie).' }])
  })
  it('pachet fără nicio sudură → avertisment „pachet fără suduri” (exportul merge)', () => {
    const e = evalueazaExportIzo({ pachet, tronson, tevi: [teava(1, 'S-1', null), teava(2, 'S-2', '')], arhiva: arhiva() })
    expect(e.verificare.blocaje).toEqual([])
    expect(e.verificare.avertismente.map(x => x.cod)).toContain('pachet_fara_suduri')
    expect(stareButonExport({ evaluare: e, drept: { export: true } }).activ).toBe(true)
  })
  it('semnalele citirii devin avertismente: pachet anterior necitit, rânduri nepotrivite, buletin fără rânduri', () => {
    const e = evalueazaExportIzo({ pachet, tronson, tevi, arhiva: arhiva({
      eroareAnterior: 'timeout', buletine: [...buletine, bul(15, 'UT', '3', '2026-10-30')],
      randuri: [...randuri, { ...rnd(8, 11, 9), stare_cod: 'nepotrivit', tronson_nr: null, nr: null }],
    }) })
    expect(e.verificare.avertismente.map(x => x.cod)).toEqual(expect.arrayContaining(['km_anterior_necitit', 'randuri_buletin_nepotrivite', 'buletin_fara_randuri']))
  })
  it('construiesteFotografie: aceleași surse în altă ordine → aceeași fotografie', () => {
    const v = { blocajeDeblocabile: [], avertismente: [] }
    const a = construiesteFotografie({ arhiva: arhiva({ eliminate: [{ cheie: 'T7S9' }, { cheie: 'T7S4' }], metode: ['PM', 'PA-UT'] }), verificare: v })
    const b = construiesteFotografie({ arhiva: arhiva({ buletine: [...buletine].reverse(), eliminate: [{ cheie: 'T7S4' }, { cheie: 'T7S9' }], metode: ['PA-UT', 'PM'] }), verificare: v })
    expect(a).toEqual(b)
    expect(a.eliminate).toEqual(['T7S4', 'T7S9'])
  })
})

describe('lipsuri → fereastra', () => {
  it('grupate pe gravitate (blocaj / deblocabil / avertisment), apoi pe cod, cu rândul pentru salt', () => {
    const g = grupeazaLipsuri({
      blocaje: [{ cod: 'serie_dublata', rand: 4, mesaj: 'a' }],
      blocajeDeblocabile: [{ cod: 'buletin_lipsa', rand: 1, mesaj: 'b' }, { cod: 'buletin_fara_pdf', rand: 1, mesaj: 'c' }, { cod: 'buletin_lipsa', rand: 2, mesaj: 'd' }],
      avertismente: [],
    })
    expect(g.map(x => [x.tip, x.total])).toEqual([['blocaj', 1], ['deblocabil', 3], ['avertisment', 0]])
    expect(g[1].coduri.map(c => [c.cod, c.elemente.map(e => e.rand)])).toEqual([['buletin_lipsa', [1, 2]], ['buletin_fara_pdf', [1]]])
  })
  it('starea butonului: blocaj → dezactivat; deblocabil → doar MP, cu bifă și motiv ≥ 5', () => {
    const ev = (o) => ({ fotografie: {}, verificare: { blocaje: [], blocajeDeblocabile: [], avertismente: [], ...o } })
    const L = [{ cod: 'buletin_lipsa', rand: 1, mesaj: 'x' }]
    expect(stareButonExport({ evaluare: ev({ blocaje: [{ cod: 'km_start_lipsa' }] }), drept: { scriere: true } }).activ).toBe(false)
    expect(stareButonExport({ evaluare: ev({ blocajeDeblocabile: L }), drept: { scriere: false }, bifa: true, motiv: 'motiv lung' }).activ).toBe(false)
    expect(stareButonExport({ evaluare: ev({ blocajeDeblocabile: L }), drept: { scriere: null }, bifa: true, motiv: 'motiv lung' }).activ).toBe(false)
    expect(stareButonExport({ evaluare: ev({ blocajeDeblocabile: L }), drept: { scriere: true }, bifa: false, motiv: 'motiv lung' }).activ).toBe(false)
    expect(stareButonExport({ evaluare: ev({ blocajeDeblocabile: L }), drept: { scriere: true }, bifa: true, motiv: ' abc ' }).activ).toBe(false)
    expect(stareButonExport({ evaluare: ev({ blocajeDeblocabile: L }), drept: { scriere: true }, bifa: true, motiv: 'lipsă PM' })).toEqual({ activ: true, incomplet: true, motiv: null })
    expect(stareButonExport({ evaluare: ev({}), drept: { export: false } }).activ).toBe(false)
    expect(stareButonExport({ evaluare: ev({}), drept: { export: null } })).toEqual({ activ: true, incomplet: false, motiv: null })
  })
})

describe('coloaneAfisate — arhivă vs text vechi', () => {
  const s = starePeSudura(randuriPentruStare(buletine, randuri).randuri)
  it('buletin confirmat → valoarea din arhivă (nr/ZZ.LL.AAAA), chiar dacă rândul are text vechi', () => {
    const c = coloaneAfisate(teava(1, 'S-1', 'T7S1', { pm_cod: '331/17.09', pa_ut_cod: 'vechi' }), s, 'T7')
    expect(c).toEqual({ pm_cod: '5/21.10.2026', pa_ut_cod: '77/28.10.2026', ut_cod: '', sursa: { pm_cod: 'arhiva', pa_ut_cod: 'arhiva', ut_cod: 'text' } })
  })
  it('fără buletin (proiect vechi) → textul existent din rând', () => {
    const c = coloaneAfisate(teava(5, 'S-5', 'T7S40', { pm_cod: '331/17.09.2026', ut_cod: 'U1' }), s, 'T7')
    expect(c.pm_cod).toBe('331/17.09.2026')
    expect(c.ut_cod).toBe('U1')
    expect(c.sursa.pm_cod).toBe('text')
  })
  it('arhivă necitită (stare null) → doar textul', () => {
    expect(coloaneAfisate(teava(1, 'S-1', 'T7S1', { pm_cod: 'X' }), null, 'T7').pm_cod).toBe('X')
  })
})

describe('codul documentului și numele fișierului', () => {
  it('revizia deja în cod nu se dublează („…_rev_1 rev.1”, audit G6)', () => {
    const p = { cod_document_full: '43_GAZ_X_DWG_00040_rev_1', revizie: 1 }
    expect(codDocumentAfisat(p)).toBe('43_GAZ_X_DWG_00040_rev_1')
    expect(codDocumentFisier(p)).toBe('43_GAZ_X_DWG_00040_rev_1')
    expect(numeExportIzo(p)).toBe('43_GAZ_X_DWG_00040_rev_1_Centralizator.zip')
  })
  it('cod fără revizie: „ rev.N” la afișare, „_revN” în nume (ca până acum, inclusiv _rev0)', () => {
    expect(codDocumentAfisat({ cod_document_full: '30_GAZ_A_DWG_00027', revizie: 2 })).toBe('30_GAZ_A_DWG_00027 rev.2')
    expect(codDocumentAfisat({ cod_document_full: '30_GAZ_A_DWG_00027', revizie: 0 })).toBe('30_GAZ_A_DWG_00027')
    expect(numeExportIzo({ cod_document_full: '30_GAZ_A_DWG_00027', revizie: 0 }, { ext: 'xlsx' })).toBe('30_GAZ_A_DWG_00027_rev0_Centralizator.xlsx')
  })
  it('exportul deblocat poartă INCOMPLET în nume (zip și xlsx)', () => {
    const p = { cod_document_full: '30_GAZ_A_DWG_00027', revizie: 1 }
    expect(numeExportIzo(p, { incomplet: true })).toBe('30_GAZ_A_DWG_00027_rev1_INCOMPLET_Centralizator.zip')
    expect(numeExportIzo(p, { incomplet: true, ext: 'xlsx' })).toBe('30_GAZ_A_DWG_00027_rev1_INCOMPLET_Centralizator.xlsx')
  })
  it('„prev”/„review” la final nu sunt revizii', () => {
    expect(codDocumentAfisat({ cod_document_full: 'DOC_PREV', revizie: 1 })).toBe('DOC_PREV rev.1')
  })
})

describe('planBuletineZip — câte un PDF pe buletin distinct, fără dubluri', () => {
  const s = starePeSudura(randuriPentruStare(buletine, randuri).randuri)
  it('două suduri pe același buletin → un singur fișier, cu numărul de suduri acoperite', () => {
    const p = planBuletineZip({ stare: s, tevi, tronsonCtx: 'T7', buletine })
    expect(p.map(x => [x.metoda, x.numar, x.data, x.suduri, x.fisierZip])).toEqual([
      ['PM', '5', '21.10.2026', 2, 'buletine/PM_5_21.10.2026.pdf'],
      ['PA-UT', '77', '28.10.2026', 2, 'buletine/PA-UT_77_28.10.2026.pdf'],
    ])
  })
  it('sudura eliminată prin tăiere nu mai aduce buletinul ei', () => {
    const p = planBuletineZip({ stare: s, tevi: [teava(1, 'S-1', 'T7S1')], tronsonCtx: 'T7', buletine, eliminate: [{ cheie: 'T7S1' }] })
    expect(p).toEqual([])
  })
  it('nume identice (alt laborator, același număr și dată) → al doilea primește id-ul, nu se suprascrie', () => {
    const b = [bul(21, 'PM', '5', '2026-10-21'), bul(22, 'PM', '5', '2026-10-21', { fortat_motiv: 'alt laborator' })]
    const st = starePeSudura(randuriPentruStare(b, [rnd(1, 21, 1), rnd(2, 22, 2)]).randuri)
    const p = planBuletineZip({ stare: st, tevi, tronsonCtx: 'T7', buletine: b })
    expect(p.map(x => x.fisierZip)).toEqual(['buletine/PM_5_21.10.2026.pdf', 'buletine/PM_5_21.10.2026_22.pdf'])
  })
  it('buletin valabil care nu e în fotografie → eroare (nu PDF lipsă tăcut)', () => {
    expect(() => planBuletineZip({ stare: s, tevi, tronsonCtx: 'T7', buletine: [buletine[0]] })).toThrow(/nu e în fotografie/)
  })
})

// Jakarinos #1219 r1 P1: reproducerea lui (km + serie schimbate → fotografie identică, zero diferențe) trebuie să pice acum
describe('amprenta pachetului și a rândurilor în fotografie', () => {
  const ev = (p, tv) => evalueazaExportIzo({ pachet: p, tronson, tevi: tv, arhiva: arhiva() }).fotografie
  const pUpd = { ...pachet, updated_at: '2026-11-27T08:00:00+00:00' }
  it('reproducerea review-ului: km start + serie schimbate → fotografie diferită și „export depășit” le spune', () => {
    const x = ev(pUpd, tevi.map(t => ({ ...t })))
    const tv2 = tevi.map(t => ({ ...t })); tv2[0].serie_unica = 'DIFERIT'
    const y = ev({ ...pUpd, km_start_m: 99999 }, tv2)
    expect(JSON.stringify(x)).not.toBe(JSON.stringify(y))
    const d = diferenteFotografie(x, y)
    expect(d).toContain('Km start s-a schimbat după export: 1000 → 99999.')
    expect(d.some(m => /Rândurile pachetului s-au schimbat/.test(m))).toBe(true)
  })
  it('fiecare câmp cerut schimbă amprenta: poz, serie, sudură, lungime, tip, dimensiune, șarjă, PM, PA-UT, UT', () => {
    const baza = amprentaRanduri(tevi)
    for (const [camp, val] of [['poz_in_pachet', 7], ['serie_unica', 'X'], ['sudura_cod', 'T7S9'], ['lungime_m', 11.99], ['tip', 'C'],
      ['dimensiune', 'DN300x9'], ['sarja', 'SJX'], ['pm_cod', 'PM 1'], ['pa_ut_cod', 'PA 1'], ['ut_cod', 'UT 1'], ['id', 999]]) {
      const tv = tevi.map((t, i) => (i === 1 ? { ...t, [camp]: val } : t))
      expect(amprentaRanduri(tv).amprenta, camp).not.toBe(baza.amprenta)
    }
    expect(amprentaRanduri(tevi.slice(0, 2)).numar).toBe(2)
  })
  it('determinist: altă ordine de citire, „12.00” vs 12, "" vs null, câmpuri în plus (_poz_km) → aceeași amprentă', () => {
    const a = amprentaRanduri(tevi)
    const b = amprentaRanduri([...tevi].reverse().map(t => ({ ...t, lungime_m: '12.00', pm_cod: '', _poz_km: 5, updated_at: 'x' })))
    expect(b).toEqual(a)
  })
  it('amprenta pachetului: updated_at, km, revizie; revizie schimbată → diferență; doar updated_at → „salvat”', () => {
    const x = ev(pUpd, tevi)
    expect(x.pachet).toEqual({ id: 9, updated_at: '2026-11-27T08:00:00+00:00', km_start_m: 1000, revizie: 0, cod_document_full: '99_GAZ_X_DWG_00001' })
    expect(diferenteFotografie(x, ev({ ...pUpd, revizie: 1 }, tevi))).toContain('Revizia s-a schimbat după export: 0 → 1.')
    expect(diferenteFotografie(x, ev({ ...pUpd, updated_at: '2026-11-27T09:00:00+00:00' }, tevi))).toEqual(['Pachetul a fost salvat după export.'])
    expect(diferenteFotografie(x, ev({ ...pUpd }, tevi.map(t => ({ ...t }))))).toEqual([])
  })
  it('fără amprentă pe oricare parte → diferență explicită (necunoscut ≠ la zi), nu []', () => {
    const x = ev(pUpd, tevi)
    const { pachet: _a, randuri: _b, ...vechi } = x
    expect(diferentePachet(vechi, x)).toHaveLength(1)
    expect(diferentePachet(x, { ...x, randuri: null })).toHaveLength(1)
    expect(amprentaRanduri(undefined)).toBe(null)
  })
})

describe('diferenteFotografie — „export depășit” (R6)', () => {
  const amp = { pachet: amprentaPachet({ ...pachet, updated_at: 'u1' }), randuri: amprentaRanduri(tevi) }
  const baza = { buletine: [{ id: 11, versiune: 2, eticheta: 'PA-UT 77/28.10.2026' }], eliminate: [], metode: ['PM'], lipsuri_blocante: [], ...amp }
  it('aceeași stare → []', () => {
    expect(diferenteFotografie(baza, JSON.parse(JSON.stringify(baza)))).toEqual([])
  })
  it('buletin nou, anulat, schimbat; eliminare; metode; lipsuri', () => {
    const cur = {
      buletine: [{ id: 11, versiune: 3, eticheta: 'PA-UT 77/28.10.2026' }, { id: 12, versiune: 2, eticheta: 'PM 5/21.10.2026' }],
      eliminate: ['T7S4'], metode: ['PA-UT', 'PM'], lipsuri_blocante: [{ cod: 'buletin_lipsa', rand: 2, mesaj: 'Sudura T7S2 n-are buletin PM acceptat (metodă obligatorie).' }],
      ...amp,
    }
    expect(diferenteFotografie(baza, cur)).toEqual([
      'Buletin schimbat după export: PA-UT 77/28.10.2026.',
      'Buletin confirmat după export: PM 5/21.10.2026.',
      'Sudură eliminată după export: T7S4.',
      'Metodele obligatorii s-au schimbat: PM → PA-UT, PM.',
      'Lipsă nouă: Sudura T7S2 n-are buletin PM acceptat (metodă obligatorie).',
    ])
    expect(diferenteFotografie(cur, baza)).toContain('Buletin anulat după export: PM 5/21.10.2026.')
  })
  it('fotografie veche ilizibilă / stare curentă necunoscută → diferență explicită, nu „la zi”', () => {
    expect(diferenteFotografie({ buletine: 'x' }, baza)).toHaveLength(1)
    expect(diferenteFotografie(baza, null)).toHaveLength(1)
  })
})
