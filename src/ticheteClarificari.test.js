// Clarificări automate pe tichete (20261223a): afișarea în Tichete.jsx. Valorile așteptate vin din cerere (L25), nu din cod:
// comentariul automat = autor „Echipa ERP” + eticheta „mesaj automat”; restul comentariilor neschimbate (inclusiv cele vechi cu autor
// șters = „?”); semnul „așteaptă răspunsul tău” doar autorului, doar cât timp faza e asteapta_autor și tichetul e deschis.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { AUTOR_AUTOMAT, ETICHETA_AUTOMAT, idsComentariiAutomate, esteComentariuAutomat, autorComentariu, asteaptaRaspunsulTau } from './ticheteClarificari.js'

const AUTOR = '00000000-0000-4000-8000-0000000000a2', ALT = '00000000-0000-4000-8000-0000000000a3'
const PROFILES = [{ id: AUTOR, name: 'SINTETIC AUTOR' }, { id: ALT, name: 'SINTETIC ALT' }]
const tichet = (clar, extra = {}) => ({ id: 7, status: 'atribuit', deschis_de: AUTOR,
  metadata: { sursa: 'bug_report', pagina: '/test', ...(clar === undefined ? {} : { clarificari_erp: clar }) }, ...extra })
const CLAR = { v: 1, runda: 1, faza: 'asteapta_autor', comentarii: [11] }

describe('comentariile automate apar ca „Echipa ERP”', () => {
  it('textele fixe din cerere', () => {
    expect(AUTOR_AUTOMAT).toBe('Echipa ERP')
    expect(ETICHETA_AUTOMAT).toBe('mesaj automat')
  })
  it('comentariul listat în evidență, fără autor = Echipa ERP + etichetă', () => {
    const ids = idsComentariiAutomate(tichet(CLAR))
    expect(autorComentariu({ id: 11, autor: null }, ids, PROFILES)).toEqual({ nume: 'Echipa ERP', automat: true, idAvatar: null })
  })
  it('id-ul ca text (bigint serializat) e recunoscut la fel', () => {
    expect(esteComentariuAutomat({ id: '11', autor: null }, idsComentariiAutomate(tichet(CLAR)))).toBe(true)
  })
  it('comentariile oamenilor rămân neschimbate', () => {
    const ids = idsComentariiAutomate(tichet(CLAR))
    expect(autorComentariu({ id: 12, autor: AUTOR }, ids, PROFILES)).toEqual({ nume: 'SINTETIC AUTOR', automat: false, idAvatar: AUTOR })
  })
  it('un comentariu vechi cu autor șters (NULL, nelistat) rămâne „?”, nu devine Echipa ERP', () => {
    const ids = idsComentariiAutomate(tichet(CLAR))
    expect(autorComentariu({ id: 5, autor: null }, ids, PROFILES)).toEqual({ nume: '?', automat: false, idAvatar: null })
  })
  it('un id cu autor pus de mână în evidență NU devine Echipa ERP (cere și autor NULL)', () => {
    const ids = idsComentariiAutomate(tichet({ ...CLAR, comentarii: [11, 12] }))
    expect(autorComentariu({ id: 12, autor: ALT }, ids, PROFILES).nume).toBe('SINTETIC ALT')
  })
  it('fără migrare / fără evidență / evidență stricată: afișarea de azi', () => {
    for (const t of [tichet(undefined), tichet(null), tichet({ comentarii: 'x' }), tichet({ comentarii: [null, -1, 1.5, '11'] }), { id: 1 }, null]) {
      const ids = idsComentariiAutomate(t)
      expect(ids.size).toBe(0)
      expect(autorComentariu({ id: 11, autor: null }, ids, PROFILES).nume).toBe('?')
    }
  })
})

describe('semnul „așteaptă răspunsul tău”', () => {
  it('doar autorului tichetului, cât timp faza e asteapta_autor', () => {
    expect(asteaptaRaspunsulTau(tichet(CLAR), AUTOR)).toBe(true)
    expect(asteaptaRaspunsulTau(tichet(CLAR), ALT)).toBe(false)
    expect(asteaptaRaspunsulTau(tichet(CLAR), null)).toBe(false)
  })
  it('nu după încheiere / clarificare și nu fără evidență', () => {
    expect(asteaptaRaspunsulTau(tichet({ ...CLAR, faza: 'incheiat' }), AUTOR)).toBe(false)
    expect(asteaptaRaspunsulTau(tichet({ ...CLAR, faza: 'clarificat' }), AUTOR)).toBe(false)
    expect(asteaptaRaspunsulTau(tichet(undefined), AUTOR)).toBe(false)
  })
  it('nu pe un tichet rezolvat / închis / respins', () => {
    for (const status of ['rezolvat', 'confirmat', 'inchis', 'respins', 'reparat']) expect(asteaptaRaspunsulTau(tichet(CLAR, { status }), AUTOR)).toBe(false)
    for (const status of ['deschis', 'atribuit', 'in_analiza', 'in_lucru']) expect(asteaptaRaspunsulTau(tichet(CLAR, { status }), AUTOR)).toBe(true)
  })
})

describe('Tichete.jsx folosește afișarea (fără cereri noi, fără funcțiile din migrare)', () => {
  const SURSA = readFileSync(new URL('./Tichete.jsx', import.meta.url), 'utf8').replace(/\r/g, '')
  it('comentariile trec prin autorComentariu; lista primește profileId; nicio chemare a funcțiilor fn_tichet_clarificare_*', () => {
    expect(SURSA).toContain('const a = autorComentariu(c, idsAutomate, profiles)')
    expect(SURSA).toContain('const idsAutomate = useMemo(()=>idsComentariiAutomate(t), [t])')
    expect(SURSA.split('<TichetRow ').length - 1).toBe(2)
    expect(SURSA.split('profileId={profile?.id}').length - 1).toBe(2)
    expect(SURSA).toContain('const asteaptaRaspuns = asteaptaRaspunsulTau(t, profileId)')
    expect(SURSA).not.toMatch(/fn_tichet_clarificare_/)
    expect(SURSA).not.toMatch(/clarificari_erp/)
  })
})
