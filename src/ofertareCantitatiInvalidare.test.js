// R5 (Copilot 26.09.2026, condiția 1): invalidarea aprobării nu privește doar cifra — unitatea, Dn, materialul, SDR-ul,
// tronsonul / etapa (obiectul) și sursa aplicabilă contează și ele. Fixture = rândurile VALIDATE reale ale lic. 3 (SELECT 26.09.2026).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  schimbariRelevante, aplicaRegulaAprobare, atributeTehnice, notaInvalidare, faraPrefixVechi, cifraDiferita, CAMPURI_APROBARE,
  PREFIX_INVALIDARE,
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
