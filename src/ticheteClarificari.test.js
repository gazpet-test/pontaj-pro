// Clarificări automate pe tichete (20261223a, r2): afișarea în Tichete.jsx. Valorile așteptate vin din cerere (L25), nu din cod:
// comentariul automat = autor „Echipa ERP” + eticheta „mesaj automat” DOAR dacă id-ul e în evidența protejată (tichete_clarificari) ȘI
// autorul lipsește; restul comentariilor neschimbate (inclusiv cele vechi cu autor șters = „?”); metadata tichetului NU contează; semnul
// „așteaptă răspunsul tău” doar autorului, doar cât timp evidența are o rundă fără încheiere și tichetul e deschis; tabelul lipsă (migrarea
// neaplicată) = nimic în plus, fără eroare.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { AUTOR_AUTOMAT, ETICHETA_AUTOMAT, TABEL_EVIDENTA, MARIME_BUCATA, esteTabelLipsa, idsTichetePentruEvidenta, incarcaEvidenta,
  idsComentariiAutomate, esteComentariuAutomat, autorComentariu, fazaClarificari, asteaptaRaspunsulTau } from './ticheteClarificari.js'

const AUTOR = '00000000-0000-4000-8000-0000000000a2', ALT = '00000000-0000-4000-8000-0000000000a3'
const PROFILES = [{ id: AUTOR, name: 'SINTETIC AUTOR' }, { id: ALT, name: 'SINTETIC ALT' }]
const tichet = (extra = {}) => ({ id: 7, departament: 'it', subcategorie: 'eroare_erp', status: 'atribuit', deschis_de: AUTOR,
  metadata: { sursa: 'bug_report', pagina: '/test' }, ...extra })
const R1 = { tichet_id: 7, fel: 'runda', runda: 1, comentariu_id: 11 }
const R2 = { tichet_id: 7, fel: 'runda', runda: 2, comentariu_id: 14 }
const INCH = { tichet_id: 7, fel: 'incheiere', runda: 2, comentariu_id: 16 }
const CLAR = { tichet_id: 7, fel: 'clarificat', runda: 1, comentariu_id: null }
const ALT_TICHET = { tichet_id: 8, fel: 'runda', runda: 1, comentariu_id: 12 }

// client fals (forma supabase-js): înregistrează cererile, întoarce ce i se dă
function clientFals(raspuns) {
  const cereri = []
  return {
    cereri,
    from(tabel) {
      return { select(col) { return { in(c, ids) { cereri.push({ tabel, col, c, ids }); return Promise.resolve(raspuns(ids)) } } } }
    },
  }
}

describe('comentariile automate apar ca „Echipa ERP” (din evidența protejată)', () => {
  it('textele fixe din cerere și numele tabelului', () => {
    expect(AUTOR_AUTOMAT).toBe('Echipa ERP')
    expect(ETICHETA_AUTOMAT).toBe('mesaj automat')
    expect(TABEL_EVIDENTA).toBe('tichete_clarificari')
  })
  it('comentariul din evidență, fără autor = Echipa ERP + etichetă', () => {
    const ids = idsComentariiAutomate([R1, ALT_TICHET], 7)
    expect([...ids]).toEqual([11])
    expect(autorComentariu({ id: 11, autor: null }, ids, PROFILES)).toEqual({ nume: 'Echipa ERP', automat: true, idAvatar: null })
  })
  it('id-ul ca text (bigint serializat) e recunoscut la fel; evidența altui tichet nu contează', () => {
    expect(esteComentariuAutomat({ id: '11', autor: null }, idsComentariiAutomate([{ ...R1, comentariu_id: '11', tichet_id: '7' }], 7))).toBe(true)
    expect(esteComentariuAutomat({ id: 12, autor: null }, idsComentariiAutomate([R1, ALT_TICHET], 7))).toBe(false)
  })
  it('comentariile oamenilor rămân neschimbate; un id cu autor din evidență NU devine Echipa ERP (cere și autor NULL)', () => {
    const ids = idsComentariiAutomate([R1, { ...R2, comentariu_id: 12 }], 7)
    expect(autorComentariu({ id: 13, autor: AUTOR }, ids, PROFILES)).toEqual({ nume: 'SINTETIC AUTOR', automat: false, idAvatar: AUTOR })
    expect(autorComentariu({ id: 12, autor: ALT }, ids, PROFILES).nume).toBe('SINTETIC ALT')
  })
  it('un comentariu vechi cu autor șters (NULL, fără rând în evidență) rămâne „?”', () => {
    expect(autorComentariu({ id: 5, autor: null }, idsComentariiAutomate([R1], 7), PROFILES)).toEqual({ nume: '?', automat: false, idAvatar: null })
  })
  it('metadata tichetului (chiar cu o evidență falsificată în ea) NU contează: fără rânduri = afișarea de azi', () => {
    const falsa = { clarificari_erp: { v: 1, runda: 1, faza: 'asteapta_autor', comentarii: [11] } }
    const t = tichet({ metadata: { sursa: 'bug_report', ...falsa } })
    expect(idsComentariiAutomate([], t.id).size).toBe(0)
    expect(autorComentariu({ id: 11, autor: null }, idsComentariiAutomate([], t.id), PROFILES).nume).toBe('?')
    expect(asteaptaRaspunsulTau(t, AUTOR, [])).toBe(false)
  })
  it('evidență absentă / stricată: set gol', () => {
    for (const r of [undefined, null, 'x', [null], [{ tichet_id: 7, fel: 'clarificat', comentariu_id: null }], [{ tichet_id: 7, comentariu_id: 1.5 }]]) {
      expect(idsComentariiAutomate(r, 7).size).toBe(0)
    }
  })
})

describe('semnul „așteaptă răspunsul tău” (din evidența protejată)', () => {
  it('doar autorului tichetului, cât timp există o rundă fără încheiere', () => {
    expect(fazaClarificari([R1], 7)).toBe('asteapta_autor')
    expect(asteaptaRaspunsulTau(tichet(), AUTOR, [R1])).toBe(true)
    expect(asteaptaRaspunsulTau(tichet(), AUTOR, [R1, R2])).toBe(true)
    expect(asteaptaRaspunsulTau(tichet(), ALT, [R1])).toBe(false)
    expect(asteaptaRaspunsulTau(tichet(), null, [R1])).toBe(false)
  })
  it('nu după încheiere / clarificare, nu fără evidență, nu pentru evidența altui tichet', () => {
    expect(fazaClarificari([R1, R2, INCH], 7)).toBe('incheiat')
    expect(fazaClarificari([R1, CLAR], 7)).toBe('clarificat')
    expect(asteaptaRaspunsulTau(tichet(), AUTOR, [R1, R2, INCH])).toBe(false)
    expect(asteaptaRaspunsulTau(tichet(), AUTOR, [R1, CLAR])).toBe(false)
    expect(asteaptaRaspunsulTau(tichet(), AUTOR, [])).toBe(false)
    expect(asteaptaRaspunsulTau(tichet(), AUTOR, [ALT_TICHET])).toBe(false)
  })
  it('nu pe un tichet rezolvat / închis / respins', () => {
    for (const status of ['rezolvat', 'confirmat', 'inchis', 'respins', 'reparat']) expect(asteaptaRaspunsulTau(tichet({ status }), AUTOR, [R1])).toBe(false)
    for (const status of ['deschis', 'atribuit', 'in_analiza', 'in_lucru']) expect(asteaptaRaspunsulTau(tichet({ status }), AUTOR, [R1])).toBe(true)
  })
})

describe('citirea evidenței: migrare neaplicată, erori, bucăți', () => {
  it('doar tichetele din butonul de raportare', () => {
    expect(idsTichetePentruEvidenta([tichet(), tichet({ id: 8, subcategorie: 'cerere_functie' }), tichet({ id: 9, departament: 'hr' }),
      tichet({ id: 10, subcategorie: 'acces_cont' }), null])).toEqual([7, 8])
  })
  it('tabelul lipsă (42P01 / PGRST205) = nimic în plus, fără eroare', async () => {
    for (const code of ['42P01', 'PGRST205']) {
      const r = await incarcaEvidenta(clientFals(() => ({ data: null, error: { code, message: 'nu exista' } })), [7])
      expect(r).toEqual({ randuri: [], lipsa: true, eroare: null })
    }
    expect(esteTabelLipsa({ code: '42501' })).toBe(false)
    expect(esteTabelLipsa(null)).toBe(false)
  })
  it('altă eroare = eroare raportată (nu „gol”, L18)', async () => {
    const r = await incarcaEvidenta(clientFals(() => ({ data: null, error: { code: '57014', message: 'timeout' } })), [7])
    expect(r.lipsa).toBe(false)
    expect(r.eroare?.code).toBe('57014')
    expect(r.randuri).toEqual([])
  })
  it('răspuns cu mai multe rânduri decât e posibil (3 pe tichet) = eroare, nu trunchiere', async () => {
    const r = await incarcaEvidenta(clientFals(() => ({ data: [R1, R2, INCH, CLAR], error: null })), [7])
    expect(r.eroare).toBeTruthy()
  })
  it('bucăți de cel mult MARIME_BUCATA tichete, fiecare tichet o dată; nicio cerere fără tichete', async () => {
    const c = clientFals((ids) => ({ data: ids.map(id => ({ tichet_id: id, fel: 'runda', runda: 1, comentariu_id: id * 10 })), error: null }))
    const ids = Array.from({ length: 450 }, (_, i) => i + 1)
    const r = await incarcaEvidenta(c, [...ids, 3, 'x', -1])
    expect(c.cereri.map(x => x.ids.length)).toEqual([MARIME_BUCATA, MARIME_BUCATA, 50])
    expect(c.cereri.every(x => x.tabel === 'tichete_clarificari' && x.c === 'tichet_id')).toBe(true)
    expect(r.randuri.length).toBe(450)
    const gol = clientFals(() => { throw new Error('nu trebuia chemat') })
    expect(await incarcaEvidenta(gol, [])).toEqual({ randuri: [], lipsa: false, eroare: null })
  })
})

describe('Tichete.jsx folosește afișarea (fără funcțiile din migrare, fără metadata)', () => {
  const SURSA = readFileSync(new URL('./Tichete.jsx', import.meta.url), 'utf8').replace(/\r/g, '')
  it('comentariile trec prin autorComentariu cu evidența protejată; lista primește profileId + evidența', () => {
    expect(SURSA).toContain('const a = autorComentariu(c, idsAutomate, profiles)')
    expect(SURSA).toContain('const idsAutomate = useMemo(()=>idsComentariiAutomate(evidentaT, t.id), [evidentaT, t.id])')
    expect(SURSA).toContain('incarcaEvidenta(supabase, idsTichetePentruEvidenta([t]))')
    expect(SURSA).toContain('const ev = await incarcaEvidenta(supabase, idsTichetePentruEvidenta(tk.data))')
    expect(SURSA.split('<TichetRow ').length - 1).toBe(2)
    expect(SURSA.split('profileId={profile?.id}').length - 1).toBe(2)
    expect(SURSA.split('evidentaClar={evidentaClar}').length - 1).toBe(2)
    expect(SURSA).toContain('const asteaptaRaspuns = asteaptaRaspunsulTau(t, profileId, evidentaClar)')
    expect(SURSA).not.toMatch(/fn_tichet_clarificare_/)
    expect(SURSA).not.toMatch(/clarificari_erp/)
  })
})
