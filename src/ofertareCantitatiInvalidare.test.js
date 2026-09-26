// R5 (Copilot 26.09.2026, condiția 1): invalidarea aprobării nu privește doar cifra — unitatea, Dn, materialul, SDR-ul,
// tronsonul / etapa (obiectul) și sursa aplicabilă contează și ele. Fixture = rândurile VALIDATE reale ale lic. 3 (SELECT 26.09.2026).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  schimbariRelevante, aplicaRegulaAprobare, atributeTehnice, notaInvalidare, faraPrefixVechi, cifraDiferita, CAMPURI_APROBARE,
  PREFIX_INVALIDARE, normUm, esteUnitateLungime, aplicaRegulaUnitate, prefixUnitate, unitateSchimbataDinIstoric, citestePaginat,
} from './ofertareCantitatiInvalidare.js'

const R2 = { id: 2, licitatie_id: 3, obiect: 'Magistrala', categorie: 'Conducte și montaj', denumire: 'Țeavă PE100 SDR11 Dn180 — extravilan Mănăstirea→Coconi',
  um: 'm', cantitate: 1100, cantitate_plansa: 2210, specificatii: 'PE100 SDR11', sursa: 'PT partea scrisă (memoriu)', tip_sursa: 'memoriu', cod_articol: null,
  status: 'validat', diferenta_nota: 'Memoriu 1.100 m vs planșa 1.1 2.210 m (+1.110 m, pe 2 tronsoane citite din tabel).', updated_at: '2026-09-15T15:19:53.008+00:00' }
const R9 = { id: 9, licitatie_id: 3, obiect: null, categorie: null, denumire: 'Traseu rețea măsurat din desenul proiectantului (CAD 8.4 „Retea 35620.dwg")',
  um: 'm', cantitate: 35620.59, cantitate_plansa: 35620.59, specificatii: null, sursa: null, tip_sursa: null, cod_articol: null, status: 'validat', diferenta_nota: 'Măsurat exact…' }

describe('copii identice (UI, CAD, transferul din planșă)', () => {
  it('api/_cantitatiInvalidare.js și supabase/functions/ofertare-plansa-citeste/invalidare.js = src/ofertareCantitatiInvalidare.js, octet cu octet', () => {
    const a = readFileSync(new URL('./ofertareCantitatiInvalidare.js', import.meta.url), 'utf8')
    expect(readFileSync(new URL('../api/_cantitatiInvalidare.js', import.meta.url), 'utf8')).toBe(a)
    expect(readFileSync(new URL('../supabase/functions/ofertare-plansa-citeste/invalidare.js', import.meta.url), 'utf8')).toBe(a)
  })
})

describe('schimbariRelevante — fiecare atribut al aprobării, pe rândul 2 VALIDAT al lic. 3', () => {
  const cazuri = [
    ['unitatea (m → ml), lungime identică', { um: 'ml' }, ['um']],
    ['Dn (180 → 160), lungime identică', { denumire: 'Țeavă PE100 SDR11 Dn160 — extravilan Mănăstirea→Coconi' }, ['denumire'], ['dn']],
    ['materialul (PE100 → PE80) în specificații', { specificatii: 'PE80 SDR11' }, ['specificatii'], ['material']],
    ['SDR (11 → 17)', { specificatii: 'PE100 SDR17' }, ['specificatii'], ['sdr']],
    ['tronsonul / etapa (obiectul)', { obiect: 'Etapa 2 — Coconi' }, ['obiect']],
    ['sursa aplicabilă (tip_sursa memoriu → lista_f3)', { tip_sursa: 'lista_f3' }, ['tip_sursa']],
    ['sursa (textul)', { sursa: 'Lista de cantități F3, poz. 12' }, ['sursa']],
    ['codul articolului (poziția din listă)', { cod_articol: '12.3' }, ['cod_articol']],
    ['categoria', { categorie: 'Branșamente' }, ['categorie']],
    ['licitația', { licitatie_id: 5 }, ['licitatie_id']],
    ['cantitatea (1.100 → 1.150)', { cantitate: 1150 }, ['cantitate']],
    ['cifra din planșă (2.210 → 2.250)', { cantitate_plansa: 2250 }, ['cantitate_plansa']],
    ['cifra din planșă golită (2.210 → —, efectiv 1.100)', { cantitate_plansa: null }, ['cantitate_plansa']],
  ]
  for (const [nume, patch, campuri, derivate = []] of cazuri) {
    it(nume, () => {
      const s = schimbariRelevante(R2, patch)
      expect(s.relevante.map(x => x.camp)).toEqual(campuri)
      expect(s.derivate.map(x => x.camp)).toEqual(derivate)
      const { patch: p, invalidat } = aplicaRegulaAprobare(R2, patch)
      expect(invalidat).toBe(true)
      expect(p.status).toBe('diferenta')
      expect(p.diferenta_nota.startsWith(`${PREFIX_INVALIDARE} (cantitate 1.100 m, cifra din planșă 2.210 m, ultima scriere 2026-09-15 15:19) nu mai e valabilă: s-a schimbat `)).toBe(true)
      expect(p.diferenta_nota.endsWith(R2.diferenta_nota)).toBe(true) // nota veche rămâne, după prefix
    })
  }
  it('nota numește Dn-ul, nu doar „denumirea”', () => {
    const { patch } = aplicaRegulaAprobare(R2, { denumire: 'Țeavă PE100 SDR11 Dn160 — extravilan Mănăstirea→Coconi' })
    expect(aplicaRegulaAprobare(R2, { specificatii: 'PE80 SDR17' }).patch.diferenta_nota).toContain('s-a schimbat materialul PE100 → PE100/PE80; SDR 11 → 11/17; specificațiile')
    expect(patch.diferenta_nota).toContain('s-a schimbat Dn 180 → 160; denumirea („Țeavă PE100 SDR11 Dn180 — extravilan Mănăstirea→Coconi” → „Țeavă PE100 SDR11 Dn160')
  })
  it('toate câmpurile din CAMPURI_APROBARE au un caz', () => {
    const acoperite = new Set(cazuri.flatMap(c => c[2]))
    expect(CAMPURI_APROBARE.filter(c => !acoperite.has(c))).toEqual([])
  })
})

describe('ce NU invalidează', () => {
  it('update doar de status (validarea explicită, ↩) și doar de notă', () => {
    expect(aplicaRegulaAprobare(R2, { status: 'extras' }).invalidat).toBe(false)
    expect(aplicaRegulaAprobare({ ...R2, status: 'diferenta' }, { status: 'validat' }).invalidat).toBe(false)
    expect(aplicaRegulaAprobare(R2, { diferenta_nota: 'altă notă', updated_at: 'x', ordine: 3 }).invalidat).toBe(false)
  })
  it('aceleași valori retrimise de editor (obiect || null, cantitate ca text) — fără schimbare', () => {
    const s = schimbariRelevante(R2, { obiect: 'Magistrala', categorie: 'Conducte și montaj', denumire: R2.denumire, um: 'm', cantitate: 1100, specificatii: 'PE100 SDR11', sursa: R2.sursa })
    expect([s.relevante, s.subPrag]).toEqual([[], []])
  })
  it('sub prag: cifra din planșă 2.210 → 2.210,4 m, majuscule / spații în denumire — raportate ca sub prag, validarea rămâne', () => {
    const s = schimbariRelevante(R2, { cantitate_plansa: 2210.4, denumire: 'ȚEAVĂ PE100 SDR11  Dn180 — extravilan Mănăstirea→Coconi ' })
    expect(s.relevante).toEqual([])
    expect(s.subPrag.map(x => x.camp)).toEqual(['cantitate_plansa', 'denumire'])
    const r = aplicaRegulaAprobare(R2, { cantitate_plansa: 2210.4 })
    expect([r.invalidat, r.patch.status]).toEqual([false, undefined])
  })
  it('prima cifră din planșă egală cu cantitatea (1.100 → planșa 1.100,3) nu e o schimbare (ca cifraSchimbata)', () => {
    const s = schimbariRelevante({ ...R2, cantitate_plansa: null }, { cantitate_plansa: 1100.3 })
    expect(s.relevante).toEqual([])
    expect(schimbariRelevante({ ...R2, cantitate_plansa: null }, { cantitate_plansa: 1101 }).relevante.map(x => x.camp)).toEqual(['cantitate_plansa'])
  })
  it('rând nevalidat: nimic de invalidat', () => {
    expect(aplicaRegulaAprobare({ ...R2, status: 'extras' }, { um: 'ml' })).toMatchObject({ invalidat: false, patch: { um: 'ml' } })
  })
  it('patch care pune el însuși alt status (transferul cu nota „Rândul era VALIDAT cu …”) rămâne neschimbat', () => {
    const patch = { cantitate_plansa: 1740, status: 'diferenta', diferenta_nota: 'Rândul era VALIDAT cu cifra din planșă 2.210 m; …' }
    expect(aplicaRegulaAprobare(R2, patch)).toMatchObject({ invalidat: true, patch })
  })
})

describe('unități non-lungime și rândul CAD', () => {
  it('buc: orice diferență contează (1 → 1,5 buc)', () => {
    const r = { ...R2, um: 'buc', cantitate: 1, cantitate_plansa: null }
    expect(schimbariRelevante(r, { cantitate: 1.5 }).relevante.map(x => x.camp)).toEqual(['cantitate'])
  })
  it('rândul 9 (CAD, validat): re-măsurare 35.620,59 → 35.620,9 sub prag; → 35.700 invalidează', () => {
    expect(aplicaRegulaAprobare(R9, { cantitate_plansa: 35620.9 }).invalidat).toBe(false)
    const r = aplicaRegulaAprobare(R9, { cantitate_plansa: 35700 })
    expect([r.invalidat, r.patch.status]).toEqual([true, 'diferenta'])
    expect(r.patch.diferenta_nota).toContain('cifra din planșă (35.620,59 m → 35.700 m)')
  })
  it('cifraDiferita: apariția / dispariția cifrei', () => {
    expect([cifraDiferita(null, 5, 1), cifraDiferita(5, null, 1), cifraDiferita(null, null, 1), cifraDiferita(5, 5.5, 1), cifraDiferita(5, 5.5, 0)]).toEqual([true, true, false, false, true])
  })
})

describe('nota și atributele tehnice', () => {
  it('prefixul vechi nu se adună la al doilea ciclu validare → schimbare', () => {
    const n1 = aplicaRegulaAprobare(R2, { um: 'ml' }).patch.diferenta_nota
    const n2 = aplicaRegulaAprobare({ ...R2, um: 'ml', diferenta_nota: n1 }, { um: 'm' }).patch.diferenta_nota
    expect(n2.split(PREFIX_INVALIDARE).length).toBe(2)
    expect(faraPrefixVechi(n1)).toBe(R2.diferenta_nota)
    expect(notaInvalidare(R2, schimbariRelevante(R2, { um: 'ml' }), null)).toMatch(/validarea se reface\. $/)
  })
  it('atributeTehnice pe denumirile reale (lic. 3 / lic. 95)', () => {
    expect(atributeTehnice(R2)).toEqual({ dn: '180', material: 'PE100', sdr: '11' })
    expect(atributeTehnice({ denumire: 'Tub protecție PE80 SDR17 296,47×18,53 (Dn315) pentru conductă Dn250', specificatii: 'PE80 SDR17' })).toEqual({ dn: '315/250', material: 'PE80', sdr: '17' })
    expect(atributeTehnice({ denumire: 'Tub protecție OL 323×9 mm pentru conductă Dn250', specificatii: 'Oțel S235, EN 10219-1' })).toEqual({ dn: '250', material: 'OL', sdr: null })
    expect(atributeTehnice({ denumire: 'Conductă distribuție gaze Dn40', specificatii: 'Sf Dimitrie, Calarasilor' })).toEqual({ dn: '40', material: null, sdr: null })
    expect(atributeTehnice({ denumire: 'Conductă distribuție gaze PE De 110' })).toEqual({ dn: '110', material: 'PE', sdr: null })
  })
})

// ── R5 runda 5 (verificatorul condițiilor 1–2) ──────────────────────────────────────────────────────────────────────────
import { referinteDinIstoric, invalidateDinIstoric, pastreazaInvalidarea, prefixInvalidare, normText } from './ofertareCantitatiInvalidare.js'

// simulează trigger-ul (docs/R5_MIGRARE_PROPUSA_aprobare_istoric.sql): validarea se înregistrează; o scriere pe un rând validat
// scrie „modificat_sub_prag” / „invalidat” cu rândul dinainte (valori_vechi)
function simulare(rand) {
  const ev = [{ id: 1, cantitate_id: rand.id, motiv: 'validat', valori_vechi: { ...rand, status: 'extras' }, valori_noi: { ...rand } }]
  let r = { ...rand }
  const scrie = (patch, cuReferinta = true) => {
    const ref = cuReferinta ? referinteDinIstoric(ev).get(r.id) : null
    const x = aplicaRegulaAprobare(r, patch, ref)
    ev.push({ id: ev.length + 1, cantitate_id: r.id, motiv: x.invalidat ? 'invalidat' : 'modificat_sub_prag', valori_vechi: { ...r } })
    r = { ...r, ...x.patch }
    return x
  }
  return { scrie, ev, rand: () => r }
}

describe('runda 5, MAJOR 2: pragul față de valoarea APROBATĂ, nu față de cea de dinainte (pași mici cumulați)', () => {
  const R3 = { ...R2, id: 3, cantitate: 5250, cantitate_plansa: null, um: 'm', diferenta_nota: null, updated_at: '2026-09-15T15:19:53+00:00' }
  it('repro verificator: 5 × (+0,99 m) FĂRĂ referință (regula veche) => 5.254,95 m și tot „validat” (gaura)', () => {
    const s = simulare(R3)
    for (let i = 0; i < 5; i++) s.scrie({ cantitate: +(s.rand().cantitate + 0.99).toFixed(2) }, false)
    expect([s.rand().cantitate, s.rand().status]).toEqual([5254.95, 'validat'])
  })
  it('cu referința din istoric: primul pas sub prag rămâne validat, al doilea (5.251,98 vs 5.250 aprobat) invalidează', () => {
    const s = simulare(R3)
    const r1 = s.scrie({ cantitate: 5250.99 })
    expect([r1.invalidat, s.rand().status]).toEqual([false, 'validat'])
    const r2 = s.scrie({ cantitate: 5251.98 })
    expect([r2.invalidat, s.rand().status]).toEqual([true, 'diferenta'])
    // nota numește valoarea APROBATĂ (5.250), nu pe cea de dinainte (5.250,99)
    expect(s.rand().diferenta_nota).toContain(`${PREFIX_INVALIDARE} (cantitate 5.250 m, ultima scriere 2026-09-15 15:19) nu mai e valabilă: s-a schimbat cantitatea (5.250 m → 5.251,98 m)`)
  })
  it('cifra din planșă: 1.000 → 1.000,9 → 1.001,5 (fiecare pas < 1 m) => invalidat la al doilea', () => {
    const s = simulare({ ...R3, cantitate: 1000, cantitate_plansa: 1000 })
    expect(s.scrie({ cantitate_plansa: 1000.9 }).invalidat).toBe(false)
    expect(s.scrie({ cantitate_plansa: 1001.5 }).invalidat).toBe(true)
  })
  it('înapoi spre valoarea aprobată (5.250,99 → 5.250,2) rămâne sub prag', () => {
    const s = simulare(R3)
    s.scrie({ cantitate: 5250.99 })
    expect(s.scrie({ cantitate: 5250.2 }).invalidat).toBe(false)
  })
  it('referinteDinIstoric: ultima validare câștigă; fără validare = rândul dinaintea PRIMEI scrieri; rânduri străine ignorate', () => {
    const ev = [
      { id: 5, cantitate_id: 3, motiv: 'modificat_sub_prag', valori_vechi: { cantitate: 5250.99 } },
      { id: 2, cantitate_id: 3, motiv: 'modificat_sub_prag', valori_vechi: { cantitate: 5250 } },
      { id: 9, cantitate_id: 4, motiv: 'validat', valori_vechi: { cantitate: 1 }, valori_noi: { cantitate: 2 } },
      { id: 11, cantitate_id: 4, motiv: 'validat', valori_vechi: { cantitate: 2 }, valori_noi: { cantitate: 3 } },
      { id: 12, cantitate_id: 4, motiv: 'invalidat', valori_vechi: { cantitate: 3 } },
      { id: 1, licitatie_id: 3, denumire: 'rând din ofertare_cantitati, nu din istoric' },
    ]
    const m = referinteDinIstoric(ev)
    expect([m.get(3).cantitate, m.get(4).cantitate, m.size]).toEqual([5250, 3, 2])
    expect(referinteDinIstoric(null).size).toBe(0)
  })
})

describe('runda 5, MAJOR 1: starea „invalidat” nu depinde de textul notei', () => {
  it('invalidateDinIstoric: ultimul eveniment invalidat / redeschis => invalidat; o validare după el => nu', () => {
    const ev = [
      { id: 1, cantitate_id: 2, motiv: 'invalidat' },
      { id: 2, cantitate_id: 3, motiv: 'redeschis' },
      { id: 3, cantitate_id: 4, motiv: 'invalidat' }, { id: 4, cantitate_id: 4, motiv: 'validat' },
      { id: 5, cantitate_id: 9, motiv: 'modificat_sub_prag' },
    ]
    expect([...invalidateDinIstoric(ev)].sort()).toEqual([2, 3])
  })
  it('pastreazaInvalidarea: nota rescrisă de transfer / CAD pe un rând invalidat își păstrează prefixul', () => {
    const inval = { ...R2, um: 'ml', ...aplicaRegulaAprobare(R2, { um: 'ml' }).patch }
    const pre = prefixInvalidare(inval.diferenta_nota)
    expect(pre.startsWith(PREFIX_INVALIDARE) && pre.endsWith('validarea se reface.')).toBe(true)
    const p = pastreazaInvalidarea(inval, { cantitate_plansa: 2210, diferenta_nota: 'Memoriu 1.100 m vs planșa 1 2.210 m.' })
    expect(p.diferenta_nota).toBe(`${pre} Memoriu 1.100 m vs planșa 1 2.210 m.`)
    // prefixul transferului („Rândul era VALIDAT cu … — validarea se reface.”) e păstrat la fel
    const t = { ...R2, status: 'diferenta', diferenta_nota: 'Rândul era VALIDAT cu cifra din planșă 2.210 m; planșa 1 dă acum 1.740 m — validarea se reface. X' }
    expect(pastreazaInvalidarea(t, { diferenta_nota: 'Y' }).diferenta_nota).toBe('Rândul era VALIDAT cu cifra din planșă 2.210 m; planșa 1 dă acum 1.740 m — validarea se reface. Y')
  })
  it('pastreazaInvalidarea NU atinge: rândul validat, rândul fără prefix, nota nouă care are deja prefix, patch fără notă', () => {
    const inval = { ...R2, status: 'diferenta', diferenta_nota: 'Rândul era VALIDAT cu x — validarea se reface. A' }
    const p1 = { diferenta_nota: 'B' }
    expect(pastreazaInvalidarea(R2, p1)).toBe(p1)
    expect(pastreazaInvalidarea({ ...R2, status: 'extras', diferenta_nota: 'A' }, p1)).toBe(p1)
    const p2 = { diferenta_nota: 'Rândul era VALIDAT cu y — validarea se reface. C' }
    expect(pastreazaInvalidarea(inval, p2)).toBe(p2)
    const p3 = { cantitate_plansa: 5 }
    expect(pastreazaInvalidarea(inval, p3)).toBe(p3)
  })
  it('faraPrefixVechi taie ambele forme de prefix (a regulii și a transferului) — fără prefixe adunate', () => {
    expect(faraPrefixVechi('Rândul era VALIDAT cu cifra din planșă 2.210 m; planșa 1 dă acum 1.740 m — validarea se reface. X')).toBe('X')
    expect(faraPrefixVechi('Rândul era VALIDAT fără final')).toBe('Rândul era VALIDAT fără final')
    const n = aplicaRegulaAprobare(R2, { obiect: 'E2', diferenta_nota: 'Rândul era VALIDAT cu cifra din planșă 2.210 m; … — validarea se reface. X' }).patch.diferenta_nota
    expect(n.match(/Rândul era VALIDAT/g).length).toBe(1)
    expect(n.endsWith('validarea se reface. X')).toBe(true)
  })
})

describe('runda 6 (decis în audit, reversibil): unitatea se compară NORMALIZAT (trim + lower + spații Unicode), ca filtrele de rețea', () => {
  it('„m” → „M”, „m ” și „m” cu NBSP NU invalidează (sub prag, raportate); „m” → „ml” da', () => {
    for (const u of ['M', 'm ', ' M\u00a0']) {
      const s = schimbariRelevante(R2, { um: u })
      expect([s.relevante, s.subPrag.map(x => x.camp)]).toEqual([[], ['um']])
      expect(aplicaRegulaAprobare(R2, { um: u })).toMatchObject({ invalidat: false, patch: { um: u } })
    }
    expect(schimbariRelevante(R2, { um: 'ml' }).relevante.map(x => x.camp)).toEqual(['um'])
    expect(aplicaRegulaAprobare(R2, { um: 'ml' }).patch.status).toBe('diferenta')
    expect(aplicaRegulaAprobare({ ...R2, um: 'M' }, { um: 'ML' }).patch.status).toBe('diferenta')
  })
  it('„m” retrimis identic și null ↔ „” nu sunt schimbări', () => {
    expect(schimbariRelevante(R2, { um: 'm' })).toMatchObject({ relevante: [], subPrag: [] })
    expect(schimbariRelevante({ ...R2, um: null }, { um: '' })).toMatchObject({ relevante: [], subPrag: [] })
  })
  it('normUm = trim + lower (+ NBSP), esteUnitateLungime pe forma normalizată', () => {
    expect([normUm(' M '), normUm('M\u00a0'), normUm('ml'), normUm(null)]).toEqual(['m', 'm', 'ml', ''])
    expect([esteUnitateLungime(' ML'), esteUnitateLungime('buc')]).toEqual([true, false])
  })
})

describe('runda 6: rândul NEAPROBAT care își schimbă unitatea din / în „m” — semnal „unitate schimbată”, nu tacit', () => {
  const R6 = { id: 6, licitatie_id: 3, denumire: 'Țeavă PE100 SDR11 Dn63', um: 'm', cantitate: 700, status: 'extras', diferenta_nota: 'Memoriu 700 m.' }
  it('extras m → ml: prefixul „Unitatea s-a schimbat („m” → „ml”) … de reverificat.” în fața notei, statusul neatins', () => {
    const r = aplicaRegulaUnitate(R6, { um: 'ml' })
    expect(r.unitate).toBe(true)
    expect(r.patch.diferenta_nota).toBe('Unitatea s-a schimbat („m” → „ml”) — rândul nu mai e o lungime de rețea în metri; de reverificat. Memoriu 700 m.')
    expect(prefixUnitate(r.patch.diferenta_nota)).toBe('Unitatea s-a schimbat („m” → „ml”) — rândul nu mai e o lungime de rețea în metri; de reverificat.')
    expect('status' in r.patch).toBe(false)
    // înapoi ml → m: prefixul se înlocuiește (nu se adună)
    const r2 = aplicaRegulaUnitate({ ...R6, um: 'ml', diferenta_nota: r.patch.diferenta_nota }, { um: 'm' })
    expect(r2.patch.diferenta_nota).toBe('Unitatea s-a schimbat („ml” → „m”); de reverificat. Memoriu 700 m.')
  })
  it('NU atinge: m → M (normalizat egal), buc → kg (fără „m”), rândul validat (trece prin aplicaRegulaAprobare), validarea în același patch', () => {
    for (const [v, p] of [[R6, { um: 'M' }], [{ ...R6, um: 'buc' }, { um: 'kg' }], [{ ...R6, status: 'validat' }, { um: 'ml' }], [R6, { um: 'ml', status: 'validat' }]]) {
      const r = aplicaRegulaUnitate(v, p)
      expect([r.unitate, r.patch]).toEqual([false, p])
    }
  })
  it('pastreazaInvalidarea păstrează și prefixul unității (și pe ambele, în ordine), când transferul / CAD rescriu nota', () => {
    const n = aplicaRegulaUnitate(R6, { um: 'ml' }).patch.diferenta_nota
    expect(pastreazaInvalidarea({ ...R6, um: 'ml', diferenta_nota: n }, { diferenta_nota: 'Planșa 1 dă 700 m.' }).diferenta_nota)
      .toBe('Unitatea s-a schimbat („m” → „ml”) — rândul nu mai e o lungime de rețea în metri; de reverificat. Planșa 1 dă 700 m.')
    const ambele = 'Rândul era VALIDAT cu x — validarea se reface. ' + n
    expect(pastreazaInvalidarea({ ...R6, diferenta_nota: ambele }, { diferenta_nota: 'Z' }).diferenta_nota)
      .toBe('Rândul era VALIDAT cu x — validarea se reface. Unitatea s-a schimbat („m” → „ml”) — rândul nu mai e o lungime de rețea în metri; de reverificat. Z')
  })
  it('istoric: unitateSchimbataDinIstoric = „unitate_schimbata” după ultima validare; invalidateDinIstoric nu e șters de el; nu e referință', () => {
    const ev = [
      { id: 1, cantitate_id: 6, motiv: 'unitate_schimbata', valori_vechi: { um: 'm' } },
      { id: 2, cantitate_id: 7, motiv: 'unitate_schimbata' }, { id: 3, cantitate_id: 7, motiv: 'validat', valori_noi: { um: 'ml' } },
      { id: 4, cantitate_id: 2, motiv: 'invalidat', valori_vechi: { cantitate: 1 } }, { id: 5, cantitate_id: 2, motiv: 'unitate_schimbata', valori_vechi: { cantitate: 9 } },
    ]
    expect([...unitateSchimbataDinIstoric(ev)].sort()).toEqual([2, 6])
    expect([...invalidateDinIstoric(ev)]).toEqual([2])
    expect(referinteDinIstoric(ev).get(6)).toBe(undefined)
    expect(referinteDinIstoric(ev).get(2)).toEqual({ cantitate: 1 })
  })
})

describe('runda 6 (minorul „istoric fără paginare”): citestePaginat — citire completă, fără să piardă cele mai noi evenimente', () => {
  const ev = Array.from({ length: 2345 }, (_, i) => ({ id: 2345 - i }))   // descrescător, ca .order('id', { ascending: false })
  it('pagini de 1000 => toate cele 2.345, în ordinea cerută', async () => {
    const r = await citestePaginat((a, b) => Promise.resolve({ data: ev.slice(a, b + 1), error: null }))
    expect([r.error, r.data.length, r.data[0].id, r.data.at(-1).id]).toEqual([null, 2345, 2345, 1])
  })
  it('plafon db-max-rows MAI MIC decât pagina (500) => nu sare rânduri', async () => {
    const r = await citestePaginat((a, b) => Promise.resolve({ data: ev.slice(a, Math.min(b + 1, a + 500)), error: null }))
    expect([r.data.length, new Set(r.data.map(x => x.id)).size]).toEqual([2345, 2345])
  })
  it('eroare => eroare (nu listă parțială); peste max => „istoric trunchiat”', async () => {
    expect((await citestePaginat(() => Promise.resolve({ data: null, error: { message: 'x' } }))).error.message).toBe('x')
    const t = await citestePaginat((a, b) => Promise.resolve({ data: ev.slice(a, b + 1), error: null }), 1000, 2000)
    expect([t.data, /trunchiat/.test(t.error.message)]).toEqual([null, true])
  })
})

describe('runda 5, minor NBSP: normText tratează spațiile Unicode ca spațiu (paritate cu ofertare_norm_text din SQL)', () => {
  it('NBSP / thin space în denumire = sub prag, nu invalidare', () => {
    expect(normText('Țeavă PE100 SDR11  Dn180\t')).toBe('țeavă pe100 sdr11 dn180')
    const s = schimbariRelevante(R2, { denumire: R2.denumire.replace(/ /g, ' ') })
    expect([s.relevante.length, s.subPrag.map(x => x.camp)]).toEqual([0, ['denumire']])
  })
})
