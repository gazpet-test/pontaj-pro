// Teste pentru logica ecranului „Buletine NDT” (src/izoBuletineNdtLogica.js). Date inventate (repo public).
// Valorile așteptate vin din contract (migrarea 20270114a, spec §21–§23), scrise de mână, nu din codul testat (L25).
import { describe, it, expect } from 'vitest'
import {
  tronsonNrDinCod, cheieDinServer, codDinCheie, aziBucuresti, valideazaFisier, sha256Hex, caleFisier, valideazaIncarcare,
  mapeazaEroareRpc, normalizeazaCitire, mapeazaRaspunsEdge, randuriDinCitire, parseazaLipire, pregatesteRanduriConfirmare,
  combinaCitiri, randArhivaPentruStare, calculeazaVerificari, filtreazaBuletine, coduriDinPachete, valideazaEliminare,
  MAX_PDF_OCTETI, combinaSemnaleCitiri,
} from './izoBuletineNdtLogica.js'
import { comparaCitiri } from './lib/izoNdt.js'
import { createHash, webcrypto } from 'node:crypto'

const coduri = l => l.map(p => p.cod)

describe('tronsonNrDinCod — paritate cu fn_sud_tronson_nr (20270114a)', () => {
  // cazurile din postcondițiile migrării + forme din producție (T12, TR12, tr1 FOD)
  it.each([
    ['TR 1 FOD', 1], ['T12', 12], ['TR12', 12], ['tr1 FOD', 1], ['  T7  ', 7], ['T12-A', null], ['S12', null], ['', null], [null, null], ['T1234', null],
  ])('%s → %s', (cod, n) => expect(tronsonNrDinCod(cod)).toBe(n))
})

describe('cheile serverului ↔ cheile izoNdt', () => {
  it('T12S126 → 12|126| și înapoi', () => {
    expect(cheieDinServer('T12S126')).toBe('12|126|')
    expect(cheieDinServer('T17S50A')).toBe('17|50|A')
    expect(codDinCheie('17|50|A')).toBe('T17S50A')
  })
  it('forme invalide → null', () => {
    for (const x of ['12|126|', 'T0S5', 'T12S0', 't12s5', null, 5]) expect(cheieDinServer(x)).toBeNull()
  })
})

describe('aziBucuresti (L17)', () => {
  it('la 23:30 UTC pe 31.12 e deja 1 ianuarie în București', () => {
    expect(aziBucuresti(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01')
    expect(aziBucuresti(new Date('2026-06-30T20:59:00Z'))).toBe('2026-06-30')
  })
})

describe('valideazaFisier', () => {
  const pdf = (size, extra = {}) => ({ name: 'b.pdf', type: 'application/pdf', size, ...extra })
  it('acceptă un PDF sub limită, cu antet %PDF-', () => {
    expect(valideazaFisier(pdf(1000), new TextEncoder().encode('%PDF-1.7'))).toBeNull()
    expect(valideazaFisier(pdf(MAX_PDF_OCTETI))).toBeNull()
  })
  it('refuză: lipsă, alt tip, gol, peste 50 MB, antet greșit', () => {
    expect(valideazaFisier(null)).toMatch(/Alege/)
    expect(valideazaFisier({ name: 'b.jpg', type: 'image/jpeg', size: 10 })).toMatch(/PDF/)
    expect(valideazaFisier(pdf(0))).toMatch(/gol/)
    expect(valideazaFisier(pdf(MAX_PDF_OCTETI + 1))).toMatch(/50 MB/)
    expect(valideazaFisier(pdf(10), new TextEncoder().encode('GIF89a'))).toMatch(/antet/)
  })
})

describe('sha256Hex', () => {
  it('dă aceeași amprentă ca node:crypto (sursă independentă), hex minuscule de 64', async () => {
    const date = new TextEncoder().encode('%PDF-1.7 buletin de test')
    const asteptat = createHash('sha256').update(Buffer.from(date)).digest('hex')
    const h = await sha256Hex(date, webcrypto.subtle)
    expect(h).toBe(asteptat)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
  it('fără crypto.subtle: eroare clară, nu amprentă goală', async () => {
    await expect(sha256Hex(new Uint8Array(1), null)).rejects.toThrow(/crypto\.subtle/)
  })
})

describe('caleFisier — forma din politicile sud_ndt_*', () => {
  const u = '0f8fad5b-d9cb-469f-a165-70867728950e'
  it('<proiect>/<tronson>/<uuid>.pdf, potrivită cu regula din fn_sud_buletin_incarca', () => {
    const c = caleFisier(7, '42', u)
    expect(c).toBe(`7/42/${u}.pdf`)
    expect(c).toMatch(new RegExp('^7/42/[^/]+$'))
    expect(c).toMatch(/^[0-9]{1,18}\/[0-9]{1,18}\/[^/]+$/)
  })
  it('refuză id-uri lipsă / negative și uuid invalid', () => {
    expect(() => caleFisier(null, 4, u)).toThrow()
    expect(() => caleFisier(7, -1, u)).toThrow()
    expect(() => caleFisier(7, 4, '../x')).toThrow()
  })
})

describe('valideazaIncarcare', () => {
  const azi = '2026-11-27'
  it('valori bune: metoda normalizată, numărul curățat, data ISO din ZZ.LL.AAAA', () => {
    const r = valideazaIncarcare({ metoda: 'pa ut', numar: '  403 ', data: '28.10.2026', firma: ' LAB ' }, azi)
    expect(r.ok).toBe(true)
    expect(r.valori).toEqual({ metoda: 'PA-UT', numar: '403', data: '2026-10-28', firma: 'LAB', forteazaMotiv: null })
  })
  it('lipsuri și valori în afara regulilor serverului', () => {
    const r = valideazaIncarcare({ metoda: 'XX', numar: ' ', data: '31.02.2026' }, azi)
    expect(Object.keys(r.erori).sort()).toEqual(['data', 'metoda', 'numar'])
    expect(valideazaIncarcare({ metoda: 'PM', numar: 'x'.repeat(61), data: '2026-11-01' }, azi).erori.numar).toMatch(/60/)
    expect(valideazaIncarcare({ metoda: 'PM', numar: '1', data: '2026-11-29' }, azi).erori.data).toMatch(/interval/)
    expect(valideazaIncarcare({ metoda: 'PM', numar: '1', data: '2026-11-28' }, azi).ok).toBe(true)   // azi + 1 e permis
    expect(valideazaIncarcare({ metoda: 'PM', numar: '1', data: '1999-12-31' }, azi).erori.data).toMatch(/interval/)
  })
  it('forțarea cere motiv de cel puțin 3 caractere; fără forțare motivul nu pleacă', () => {
    expect(valideazaIncarcare({ metoda: 'UT', numar: '5', data: '2026-11-01', cuForteaza: true, forteazaMotiv: 'ab' }, azi).erori.forteazaMotiv).toBeTruthy()
    const ok = valideazaIncarcare({ metoda: 'UT', numar: '5', data: '2026-11-01', cuForteaza: true, forteazaMotiv: 'alt laborator' }, azi)
    expect(ok.ok).toBe(true)
    expect(ok.valori.forteazaMotiv).toBe('alt laborator')
    expect(valideazaIncarcare({ metoda: 'UT', numar: '5', data: '2026-11-01', forteazaMotiv: 'alt laborator' }, azi).valori.forteazaMotiv).toBeNull()
  })
})

describe('mapeazaEroareRpc — mesajele exacte din 20270114a', () => {
  it('23505 fisier_deja_incarcat:<id> / buletin_deja_incarcat:<id>', () => {
    expect(mapeazaEroareRpc({ code: '23505', message: 'sud: fisier_deja_incarcat:91' })).toMatchObject({ tip: 'fisier_dublura', id: 91 })
    expect(mapeazaEroareRpc({ code: '23505', message: 'sud: buletin_deja_incarcat:12' })).toMatchObject({ tip: 'buletin_dublura', id: 12 })
    expect(mapeazaEroareRpc({ code: '23505', message: 'sud: sudura e deja marcata eliminata' })).toMatchObject({ tip: 'dublura', mesaj: 'sudura e deja marcata eliminata' })
  })
  it('40001 = versiune veche; 42501 = drept; 55000 = stare', () => {
    expect(mapeazaEroareRpc({ code: '40001', message: 'sud: buletinul s-a schimbat intre timp; reincarca' }).tip).toBe('versiune')
    expect(mapeazaEroareRpc({ code: '42501', message: 'sud: doar managerul de proiect' }).tip).toBe('drept')
    expect(mapeazaEroareRpc({ code: '55000', message: 'sud: buletinul nu e ciorna (confirmat)' }).tip).toBe('stare')
  })
  it('22023: fereastra de o oră e separată de celelalte validări', () => {
    expect(mapeazaEroareRpc({ code: '22023', message: 'sud: fisierul nu e in arhiva tronsonului, nu e incarcat de tine sau e mai vechi de o ora (reincarca-l)' }).tip).toBe('fisier_expirat')
    expect(mapeazaEroareRpc({ code: '22023', message: 'sud: metoda invalida' })).toEqual({ tip: 'validare', mesaj: 'metoda invalida' })
  })
  it('L05: rețea / 5xx / fără cod = necunoscut, nu eșec cert', () => {
    expect(mapeazaEroareRpc({ message: 'TypeError: Failed to fetch' }).tip).toBe('necunoscut')
    expect(mapeazaEroareRpc({ code: 'XX000', message: 'boom' }, 503).tip).toBe('necunoscut')
    expect(mapeazaEroareRpc({ code: '', message: 'x' }, 0).tip).toBe('necunoscut')
  })
  it('funcția lipsă (migrare neaplicată) și fără eroare', () => {
    expect(mapeazaEroareRpc({ code: 'PGRST202', message: 'Could not find the function' }, 404).tip).toBe('lipsa_rpc')
    expect(mapeazaEroareRpc(null)).toBeNull()
  })
})

describe('normalizeazaCitire / mapeazaRaspunsEdge', () => {
  const citireEdge = {
    ok: true, model: 'claude-sonnet-5-5',
    citire: { antet: { numar: '403', data: '2026-10-28', tronson: 'T12', nr_randuri_tiparit: 2, partial: true, pagini_necitite: [3] },
      randuri: [{ cod_raw: 'GAZPET TR12 S127', rezultat: 'ACCEPTED' }, { cod_raw: 'GAZPET TR12 S126R', rezultat: 'ACCEPTED' }], incerte: [] },
  }
  it('semnalele din antet urcă la rădăcină (forma lui comparaCitiri), fără să se piardă', () => {
    const r = mapeazaRaspunsEdge({ data: citireEdge })
    expect(r.tip).toBe('ok')
    expect(r.citire.partial).toBe(true)
    expect(r.citire.pagini_necitite).toEqual([3])
    expect(r.citire.antet.nr_randuri_tiparit).toBe(2)
    expect(r.citire.model).toBe('claude-sonnet-5-5')
  })
  it('formă greșită = invalid (L18), nu listă goală', () => {
    expect(normalizeazaCitire({ antet: {} }).ok).toBe(false)
    expect(normalizeazaCitire({ randuri: ['x'] }).ok).toBe(false)
    expect(normalizeazaCitire({ randuri: [], partial: 'da' }).ok).toBe(false)
    expect(normalizeazaCitire({ randuri: [], pagini_necitite: [0] }).ok).toBe(false)
    expect(mapeazaRaspunsEdge({ data: { ok: true } }).tip).toBe('invalid')
  })
  it('nepublicată (404), plafon, drept, rețea = mesaj clar; introducerea manuală rămâne', () => {
    expect(mapeazaRaspunsEdge({ error: { name: 'FunctionsHttpError', context: { status: 404 } } }).tip).toBe('nepublicat')
    expect(mapeazaRaspunsEdge({ error: { name: 'FunctionsHttpError', context: { status: 429 } }, corp: { cod: 'plafon_atins', mesaj: 'plafon lunar depășit' } }).tip).toBe('plafon')
    expect(mapeazaRaspunsEdge({ data: { ok: false, cod: 'plafon_neconfigurat' } }).tip).toBe('plafon')
    expect(mapeazaRaspunsEdge({ error: { name: 'FunctionsHttpError', context: { status: 403 } } }).tip).toBe('drept')
    const r = mapeazaRaspunsEdge({ error: { name: 'FunctionsFetchError', message: 'Failed to send a request' } })
    expect(r.tip).toBe('necunoscut')
    expect(r.mesaj).toMatch(/nu se reîncearcă automat/)
    expect(mapeazaRaspunsEdge({ error: { name: 'FunctionsHttpError', context: { status: 502 } } }).tip).toBe('necunoscut')
  })
})

describe('parseazaLipire (Excel → tabel)', () => {
  it('TAB-uri, antet sărit, linia goală de la final sărită, coloanele în ordine', () => {
    const t = 'Cod sudură\tRezultat\tData\n' + 'T12S127\tacceptat\t28.10.2026\t\t\t\t\t\t\r\n' + 'T12S126\trespins\t27.10.2026\t10\t25\t15\t2\t1,5\tporozitate\n\n'
    const r = parseazaLipire(t)
    expect(r.antetSarit).toBe(true)
    expect(r.erori).toEqual([])
    expect(r.randuri.map(x => [x.cod_raw, x.rezultat, x.data_inspectie, x.adancime_mm, x.observatii])).toEqual([
      ['T12S127', 'acceptat', '28.10.2026', '', ''], ['T12S126', 'respins', '27.10.2026', '1,5', 'porozitate'],
    ])
  })
  it('prea multe coloane = eroare pe linie, nu tăiere; un cod pe prima linie nu e antet', () => {
    const r = parseazaLipire('T12S1\tA\t\t\t\t\t\t\t\tobs\tîn plus\nT12S2\tacceptat')
    expect(r.erori).toHaveLength(1)
    expect(r.erori[0]).toMatch(/Linia 1 are 11 coloane/)
    expect(r.randuri.map(x => x.cod_raw)).toEqual(['T12S2'])
    expect(parseazaLipire('T12S5\tacceptat').antetSarit).toBe(false)
  })
})

describe('pregatesteRanduriConfirmare — contractul p_randuri din fn_sud_buletin_confirma', () => {
  it('forma exactă trimisă serverului: chei, ISO, numere, null pe gol', () => {
    const r = pregatesteRanduriConfirmare([
      { cod_raw: ' GAZPET TR12 S126 ', rezultat: 'REJECTED', data_inspectie: '27.10.2026', start_mm: '10', end_mm: 25, lungime_mm: '15', inaltime_mm: '', adancime_mm: '1,5', observatii: ' porozitate ' },
      { cod_raw: 'T12S126R', rezultat: 'acceptat', data_inspectie: '2026-10-29' },
    ])
    expect(r.ok).toBe(true)
    expect(r.randuri).toEqual([
      { cod_raw: 'GAZPET TR12 S126', rezultat: 'respins', data_inspectie: '2026-10-27', start_mm: 10, end_mm: 25, lungime_mm: 15, inaltime_mm: null, adancime_mm: 1.5, observatii: 'porozitate' },
      { cod_raw: 'T12S126R', rezultat: 'acceptat', data_inspectie: '2026-10-29', start_mm: null, end_mm: null, lungime_mm: null, inaltime_mm: null, adancime_mm: null, observatii: null },
    ])
  })
  it('erori pe rând, nimic tăiat: cod lipsă / > 80, rezultat necunoscut, dată invalidă, număr ambiguu, observații > 500, rând gol', () => {
    const r = pregatesteRanduriConfirmare([
      { cod_raw: '', rezultat: 'acceptat' },
      { cod_raw: 'x'.repeat(81), rezultat: 'poate' },
      { cod_raw: 'T12S1', rezultat: 'acceptat', data_inspectie: '32.10.2026', lungime_mm: '1.500', start_mm: 'abc', observatii: 'o'.repeat(501) },
      { cod_raw: '', rezultat: '', data_inspectie: '' },
    ])
    expect(r.ok).toBe(false)
    expect(r.randuri).toEqual([])
    expect(r.erori.map(e => [e.index, e.camp])).toEqual([
      [0, 'cod_raw'], [1, 'cod_raw'], [1, 'rezultat'], [2, 'data_inspectie'], [2, 'start_mm'], [2, 'lungime_mm'], [2, 'observatii'], [3, null],
    ])
    expect(r.erori.find(e => e.camp === 'lungime_mm').mesaj).toMatch(/ambiguu/)
  })
  it('0 rânduri și peste 2000 de rânduri = refuz', () => {
    expect(pregatesteRanduriConfirmare([]).erori[0].mesaj).toMatch(/niciun rând/)
    const multe = Array.from({ length: 2001 }, (_, i) => ({ cod_raw: `T12S${i + 1}`, rezultat: 'acceptat' }))
    expect(pregatesteRanduriConfirmare(multe).erori.some(e => /limita e 2000/.test(e.mesaj))).toBe(true)
  })
})

describe('combinaCitiri — omul alege pe rândurile diferite', () => {
  const A = { randuri: [
    { cod_raw: 'T12S1', rezultat: 'acceptat', data_inspectie: '2026-10-28' },
    { cod_raw: 'T12S2', rezultat: 'acceptat', data_inspectie: '2026-10-28' },
    { cod_raw: 'T12S3', rezultat: 'acceptat', data_inspectie: '2026-10-28' },
  ] }
  const B = { randuri: [
    { cod_raw: 'T12S1', rezultat: 'acceptat', data_inspectie: '2026-10-28' },
    { cod_raw: 'T12S2', rezultat: 'respins', data_inspectie: '2026-10-28' },
    { cod_raw: 'T12S4', rezultat: 'acceptat', data_inspectie: '2026-10-28' },
  ] }
  const cmp = comparaCitiri(A, B, { tronson: 12 })
  it('fără alegeri: potrivitele trec, restul sunt nealese (fără implicit)', () => {
    const r = combinaCitiri(cmp, {})
    expect(r.randuri.map(x => x.cod_raw)).toEqual(['T12S1'])
    expect(r.nealese.sort()).toEqual(['12|2||', '12|3||', '12|4||'])
  })
  it('cu alegeri: varianta B pe diferit, scoate doar_in_A, păstrează doar_in_B', () => {
    const r = combinaCitiri(cmp, { '12|2||': 'b', '12|3||': 'scoate', '12|4||': 'pastreaza' })
    expect(r.nealese).toEqual([])
    expect(r.randuri.map(x => [x.cod_raw, x.rezultat])).toEqual([['T12S1', 'acceptat'], ['T12S2', 'respins'], ['T12S4', 'acceptat']])
  })
})

describe('calculeazaVerificari (§23)', () => {
  const buletin = { id: 50, metoda: 'PA-UT', numar: '403', data_buletin: '2026-10-28' }
  const pachete = new Set(['12|125|', '12|126|', '12|127|'])
  const rand = (cod, rezultat, data = '2026-10-28') => ({ cod_raw: cod, rezultat, data_inspectie: data })
  const arhivaPM = [
    randArhivaPentruStare({ tronson_nr: 12, nr: 125, sufix: '', refacuta: false, rezultat: 'acceptat', data_inspectie: '2026-10-20' }, { id: 7, metoda: 'PM', numar: '88', data_buletin: '2026-10-21', stare: 'confirmat', fisier_path: 'p' }),
    randArhivaPentruStare({ tronson_nr: 12, nr: 130, sufix: '', refacuta: false, rezultat: 'acceptat', data_inspectie: '2026-10-20' }, { id: 7, metoda: 'PM', numar: '88', data_buletin: '2026-10-21', stare: 'confirmat', fisier_path: 'p' }),
  ]

  it('buletin curat: doar informațiile despre comparație și totalul necunoscut', () => {
    const v = calculeazaVerificari({ randuri: [rand('T12S125', 'acceptat')], buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: arhivaPM })
    expect(v.rezumat.atentie).toBe(0)
    expect(coduri(v.probleme)).toEqual(['numar_randuri_necunoscut', 'alta_metoda_fara_aceasta'])
    expect(v.probleme[1].mesaj).toMatch(/1 suduri au buletin PM, dar nu PA-UT: T12S130/)
  })

  it('1. numărul de rânduri față de totalul tipărit', () => {
    const v = calculeazaVerificari({ randuri: [rand('T12S125', 'acceptat')], citire: { antet: { nr_randuri_tiparit: 3 } }, buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: [] })
    expect(v.probleme.find(p => p.cod === 'numar_randuri').mesaj).toMatch(/3 rânduri.*sunt 1/)
  })

  it('2. respinsă fără R acceptat → semnalată; cu R acceptat mai nou → nu', () => {
    const fara = calculeazaVerificari({ randuri: [rand('T12S126', 'respins')], buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: [] })
    expect(fara.peRand[0].map(p => p.cod)).toContain('respins_fara_refacere')
    const cu = calculeazaVerificari({ randuri: [rand('T12S126', 'respins', '2026-10-27'), rand('T12S126R', 'acceptat', '2026-10-28')], buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: [] })
    expect(coduri(cu.probleme)).not.toContain('respins_fara_refacere')
  })

  it('2b. refacerea acceptată dintr-un buletin confirmat anterior acoperă respinsul (arhiva aceleiași metode)', () => {
    const arh = [randArhivaPentruStare({ tronson_nr: 12, nr: 126, sufix: '', refacuta: true, rezultat: 'acceptat', data_inspectie: '2026-11-02' },
      { id: 8, metoda: 'PA-UT', numar: '410', data_buletin: '2026-11-03', stare: 'confirmat', fisier_path: 'p' })]
    const v = calculeazaVerificari({ randuri: [rand('T12S126', 'respins', '2026-10-27')], buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: arh })
    expect(coduri(v.probleme)).not.toContain('respins_fara_refacere')
  })

  it('3. comparația cu cealaltă metodă: sudura din buletin fără PM e marcată pe rând', () => {
    const v = calculeazaVerificari({ randuri: [rand('T12S125', 'acceptat'), rand('T12S127', 'acceptat')], buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: arhivaPM })
    expect(v.peRand[1].map(p => p.cod)).toEqual(['fara_alta_metoda'])
    expect(v.peRand[0]).toBeUndefined()
  })
  it('3b. fără buletine PM pe tronson: informație, nu listă de diferențe; metodă fără pereche: n/a', () => {
    const v = calculeazaVerificari({ randuri: [rand('T12S125', 'acceptat')], buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: [] })
    expect(coduri(v.probleme)).toContain('comparatie_fara_alta')
    const ut = calculeazaVerificari({ randuri: [rand('T12S125', 'acceptat')], buletin: { ...buletin, metoda: 'UT' }, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: [] })
    expect(coduri(ut.probleme)).toContain('comparatie_na')
  })

  it('4. coduri nenormalizabile, din alt tronson, lipsă din pachete, dublate, eliminate', () => {
    const v = calculeazaVerificari({
      randuri: [rand('T12S88?1', 'acceptat'), rand('GAZPET TR13 S5', 'acceptat'), rand('T12S999', 'acceptat'), rand('T12S125', 'acceptat'), rand('TR 12 S 125', 'acceptat'), rand('T12S127', 'acceptat')],
      buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: ['T12S127'], arhiva: [],
    })
    expect(v.peRand[0].map(p => p.cod)).toEqual(['cod_nepotrivit'])
    expect(v.peRand[1][0].mesaj).toMatch(/alt_tronson/)
    expect(v.peRand[2].map(p => p.cod)).toEqual(['cod_lipsa_pachet'])
    expect(v.peRand[3]).toBeUndefined()
    expect(v.peRand[4].map(p => p.cod)).toEqual(['cod_dublat'])
    expect(v.peRand[5].map(p => p.cod)).toEqual(['sudura_eliminata'])
  })

  it('5. citire parțială, pagini necitite, valori incerte; antetul diferit de ce s-a înregistrat', () => {
    const citire = { antet: { numar: '404', data: '2026-10-29', metoda: 'PM', tronson: 'TR13' }, partial: true, pagini_necitite: [2, 3], incerte: [{}] }
    const v = calculeazaVerificari({ randuri: [rand('T12S125', 'acceptat')], citire, buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: [] })
    expect(coduri(v.probleme)).toEqual(expect.arrayContaining(['citire_partiala', 'pagini_necitite', 'valori_incerte', 'antet_numar', 'antet_data', 'antet_metoda', 'antet_tronson']))
    const acelasi = calculeazaVerificari({ randuri: [rand('T12S125', 'acceptat')], citire: { antet: { numar: ' 403', data: '28.10.2026', metoda: 'pa ut', tronson: 'TR 12' } }, buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: [] })
    expect(coduri(acelasi.probleme).filter(c => c.startsWith('antet_'))).toEqual([])
  })

  it('L18: surse necitite (pachete / eliminate / arhivă) = avertisment explicit, nu „nicio problemă”', () => {
    const v = calculeazaVerificari({ randuri: [rand('T12S999', 'acceptat')], buletin, tronsonCod: 'T12', coduriPachete: null, eliminate: null, arhiva: null })
    expect(coduri(v.probleme)).toEqual(expect.arrayContaining(['pachete_necitite', 'eliminate_necitite', 'arhiva_necitita']))
    expect(coduri(v.probleme)).not.toContain('cod_lipsa_pachet')
  })

  it('data de inspecție lipsă e semnalată (ordinea R3 nu se poate stabili)', () => {
    const v = calculeazaVerificari({ randuri: [rand('T12S125', 'acceptat', '')], buletin, tronsonCod: 'T12', coduriPachete: pachete, eliminate: [], arhiva: [] })
    expect(v.peRand[0].map(p => p.cod)).toContain('data_inspectie_lipsa')
  })
})

describe('randArhivaPentruStare / coduriDinPachete / filtre / eliminare', () => {
  it('rândul nepotrivit din BD nu primește cheie (ajunge în ignorate, nu dispare)', () => {
    const r = randArhivaPentruStare({ tronson_nr: null, nr: null, sufix: '', refacuta: false, rezultat: 'acceptat' }, { id: 1, metoda: 'PM', numar: '1', data_buletin: '2026-10-01', stare: 'confirmat' })
    expect(r.tronson).toBeNull()
    expect(r.cheie).toBeUndefined()
  })
  it('coduriDinPachete: separatoarele și golurile sar, codurile nerecunoscute se numără', () => {
    const { chei, nerecunoscute } = coduriDinPachete([
      { tip_rand: 'teava', sudura_cod: 'T12S1' }, { tip_rand: 'separator', sudura_cod: 'T12S2' }, { tip_rand: 'teava', sudura_cod: '' },
      { tip_rand: 'curba', sudura_cod: 'T12S3R' }, { tip_rand: 'teava', sudura_cod: '-' },
    ], 'T12')
    expect([...chei].sort()).toEqual(['12|1|', '12|3|'])
    expect(nerecunoscute).toBe(1)
  })
  it('filtreazaBuletine: metodă + stare, data desc apoi id desc', () => {
    const l = [{ id: 1, metoda: 'PM', stare: 'confirmat', data_buletin: '2026-10-01' }, { id: 2, metoda: 'PM', stare: 'anulat', data_buletin: '2026-10-05' },
      { id: 3, metoda: 'PA-UT', stare: 'confirmat', data_buletin: '2026-10-05' }, { id: 4, metoda: 'PM', stare: 'confirmat', data_buletin: '2026-10-05' }]
    expect(filtreazaBuletine(l).map(b => b.id)).toEqual([4, 3, 2, 1])
    expect(filtreazaBuletine(l, { metoda: 'PM', stare: 'confirmat' }).map(b => b.id)).toEqual([4, 1])
  })
  it('valideazaEliminare: fără R, motiv, sudurile noi valide', () => {
    expect(valideazaEliminare({ cod: 'T12S126R', motiv: 'cupon' }, 'T12').erori.cod).toMatch(/fără „R”/)
    expect(valideazaEliminare({ cod: 'T12S126', motiv: 'c' }, 'T12').erori.motiv).toBeTruthy()
    expect(valideazaEliminare({ cod: 'T12S126', motiv: 'cupon', inlocuitaDe: 'T12S126A, T12S?' }, 'T12').erori.inlocuitaDe).toMatch(/T12S\?/)
    const ok = valideazaEliminare({ cod: 'GAZPET TR12 S126', motiv: 'tăiată, cupon', inlocuitaDe: 'T12S126A T12S126B' }, 'T12')
    expect(ok.ok).toBe(true)
    expect(ok.valori).toEqual({ cod: 'T12S126', motiv: 'tăiată, cupon', inlocuitaDe: ['T12S126A', 'T12S126B'] })
  })
})

describe('randuriDinCitire', () => {
  it('păstrează valorile, null → gol, fiecare rând cu id local unic', () => {
    const r = randuriDinCitire({ randuri: [{ cod_raw: 'T12S1', rezultat: 'ACCEPTED', start_mm: 0, observatii: null }, { cod_raw: 'T12S2' }] })
    expect(r[0]).toMatchObject({ cod_raw: 'T12S1', rezultat: 'ACCEPTED', start_mm: 0, observatii: '' })
    expect(r[0]._id).not.toBe(r[1]._id)
  })
})

// ── runda 2 (Jakarinos #1218 r1) ─────────────────────────────────────────
describe('parseazaLipire — antet recunoscut explicit, nimic pierdut (r1 P1 :257)', () => {
  it('„ILIZIBIL<TAB>respins” pe prima linie rămâne rând, marcat de verificat (codul vechi îl sărea ca antet)', () => {
    const r = parseazaLipire('ILIZIBIL\trespins\t28.10.2026\nT12S125\tacceptat\t28.10.2026')
    expect(r.antetSarit).toBe(false)
    expect(r.erori).toEqual([])
    expect(r.randuri.map(x => [x.cod_raw, x.rezultat])).toEqual([['ILIZIBIL', 'respins'], ['T12S125', 'acceptat']])
    expect(r.randuri[0]._verifica).toMatch(/fără nicio cifră/)
    expect(r.randuri[1]._verifica).toBeUndefined()
    expect(r.deVerificat).toBe(1)
  })
  it.each([
    ['Cod sudură\tRezultat', true], ['COD SUDURA\tREZULTAT\tDATA', true], ['Nr. sudură\tRezultat examinare', true], ['Weld No.\tResult', true],
    ['Sudura', true], ['cod\t\tdata', true],
    ['Sudura\trespins', false], ['ILIZIBIL\trespins', false], ['Observatii\tacceptat', false], ['nr crt\trezultat', false], ['T12S1\tRezultat', false],
  ])('esteAntetLipire pe „%s” → %s (prima linie)', (linie, antet) => {
    const r = parseazaLipire(`${linie}\nT12S125\tacceptat`)
    expect(r.antetSarit).toBe(antet)
    expect(r.randuri.length).toBe(antet ? 1 : 2)
  })
  it('antetul se sare doar pe prima linie cu date; un rând fără cifre mai jos rămâne și e marcat', () => {
    const r = parseazaLipire('T12S125\tacceptat\nCod sudură\tRezultat')
    expect(r.antetSarit).toBe(false)
    expect(r.randuri.map(x => x.cod_raw)).toEqual(['T12S125', 'Cod sudură'])
    expect(r.randuri[1]._verifica).toBeTruthy()
  })
  it('rândul marcat dă avertisment pe rândul lui în verificări (nu trece tăcut la confirmare)', () => {
    const r = parseazaLipire('ILIZIBIL\trespins\t28.10.2026\nT12S125\tacceptat\t28.10.2026')
    const v = calculeazaVerificari({ randuri: r.randuri, buletin: { id: 1, metoda: 'PM', numar: '1', data_buletin: '2026-10-28' }, tronsonCod: 'T12', coduriPachete: new Set(['12|125|']), eliminate: [], arhiva: [] })
    expect(v.peRand[0].map(p => p.cod)).toContain('rand_de_verificat')
    expect(v.peRand[1]?.some(p => p.cod === 'rand_de_verificat')).toBeFalsy()
  })
})

describe('combinaSemnaleCitiri — semnalele ambelor citiri rămân după „Aplică” (r1 P1 :544)', () => {
  const buletin = { id: 1, metoda: 'PA-UT', numar: '401', data_buletin: '2026-10-28' }
  const A = { antet: { numar: '401', data: '2026-10-28', nr_randuri_tiparit: 2 }, randuri: [], incerte: [], partial: false, pagini_necitite: [], model: 'm1' }
  const B = { antet: { numar: '410', data: '2026-10-28', nr_randuri_tiparit: 3 }, randuri: [], incerte: ['T12S126.rezultat'], partial: true, pagini_necitite: [3, 2], model: 'm2' }
  const coduriV = c => calculeazaVerificari({ randuri: [{ cod_raw: 'T12S125', rezultat: 'acceptat', data_inspectie: '2026-10-28' }, { cod_raw: 'T12S126', rezultat: 'acceptat', data_inspectie: '2026-10-28' }],
    citire: c, buletin, tronsonCod: 'T12', coduriPachete: new Set(['12|125|', '12|126|']), eliminate: [], arhiva: [] }).probleme.map(p => p.cod)
  it('a doua citire parțială / cu pagini necitite / incerte / alt total / alt număr: toate avertismentele rămân', () => {
    const c = combinaSemnaleCitiri(A, B)
    expect(c.partial).toBe(true)
    expect(c.pagini_necitite).toEqual([2, 3])
    expect(c.incerte).toEqual([{ citire: 'a doua', valoare: 'T12S126.rezultat' }])
    expect(c.tiparit_diferit).toEqual([2, 3])
    expect(c.antet.nr_randuri_tiparit).toBeNull()
    const v = coduriV(c)
    for (const k of ['citire_partiala', 'pagini_necitite', 'valori_incerte', 'numar_randuri_diferit', 'antet_numar']) expect(v).toContain(k)
    // doar prima citire (ce rămânea în cod înainte) = zero avertismente: dovada că fără combinare se pierd
    expect(coduriV(A).filter(k => ['citire_partiala', 'pagini_necitite', 'valori_incerte', 'numar_randuri_diferit', 'antet_numar'].includes(k))).toEqual([])
  })
  it('semnalele primei citiri se păstrează și ele; totalul comun rămâne cunoscut', () => {
    const c = combinaSemnaleCitiri({ ...A, partial: true, pagini_necitite: [4], incerte: ['x'] }, { ...A, antet: { ...A.antet } })
    expect(c.partial).toBe(true)
    expect(c.partial_din).toEqual(['prima'])
    expect(c.pagini_necitite).toEqual([4])
    expect(c.incerte).toEqual([{ citire: 'prima', valoare: 'x' }])
    expect(c.antet.nr_randuri_tiparit).toBe(2)
    expect(c.tiparit_diferit).toBeNull()
  })
  it('fără a doua citire = prima neschimbată', () => {
    expect(combinaSemnaleCitiri(A, null)).toBe(A)
    expect(combinaSemnaleCitiri(null, null)).toBeNull()
  })
})
