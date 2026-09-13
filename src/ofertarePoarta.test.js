// Primele teste automate din repo (13.09.2026). Evaluatorul portii e pur tocmai ca sa poata fi
// testat asa: fara React, fara Supabase, fara mock-uri. Fiecare caz de aici e o regula de
// business pe care poarta a promis-o — daca un test pica, cineva a schimbat o promisiune.
import { describe, it, expect } from 'vitest'
import { evalueazaPoarta, verdictSemnatura } from './ofertarePoarta.js'

// Un rand de v_ofertare_pt_stare cu TOTUL verde. Fiecare test strica exact un lucru.
const VERDE = {
  capitole: 5, capitole_goale: 0, capitole_nu_e_cazul: 0, capitole_nescrise_de_om: 0,
  de_raspuns: 10, de_forma: 2, cu_capitol: 10, fara_capitol: 0, inchise_cu_dovada: 0,
  capcane: 0, capcane_descoperite: 0,
  afirmatii: 3, afirmatii_blocante: 0, afirmatii_de_verificat: 0,
  cerinte_neverificate: 0,
  lista_f3_m: 1000, lista_c6_m: 1000, memoriu_m: 1000, plansa_m: 1000, grafic_fronturi_m: 1000,
  garantie_cerut_luni: 36, garantie_cerut_moment: 'pif', garantie_oferit_luni: 36, garantie_oferit_moment: 'pif',
  garantie_confirmata: true, garantie_justificata: false, garantie_luni_in_capitole: [36], garantie_cerinte_lucrari: 2,
  anexe_referite: ['anexa 7'], anexe_existente: ['Anexa 7'], identitate_straine: [], bransamente_in_capitole: [372], bransamente_in_cerinte: [372],
  observatii_deschise: 0,
  documente: 4, documente_necitite: 0,
  grafic_versiune: 1, grafic_avertismente: 0,
}
const cu = (patch) => evalueazaPoarta({ ...VERDE, ...patch })

describe('evalueazaPoarta — o singura sursa de adevar', () => {
  it('st null = se incarca: intoarce null, NU un array gol (verdele fals din lipsa de date)', () => {
    expect(evalueazaPoarta(null)).toBeNull()
  })
  it('tot verde -> ok, fara blocaje, fara rezerve', () => {
    const ev = cu({})
    expect(ev.stare).toBe('ok'); expect(ev.blocaje).toEqual([]); expect(ev.rezerve).toEqual([])
  })

  describe('BLOCANTE — fapte, nu interpretari', () => {
    it('fara cuprins', () => expect(cu({ capitole: 0 }).blocaje).toContain('cuprins'))
    it('cerinta fara capitol', () => expect(cu({ fara_capitol: 1 }).blocaje).toContain('fara'))
    it('capcana de respingere nedescoperita', () => expect(cu({ capcane: 2, capcane_descoperite: 1 }).blocaje).toContain('capcane'))
    it('cerinta doar ATRIBUITA unui capitol nu e verificata -> block (P0.3: atribuirea nu e conformitate)', () => {
      const ev = cu({ cerinte_neverificate: 1 })
      expect(ev.blocaje).toContain('neverificate'); expect(ev.stare).toBe('block')
    })
    it('H6: capitolele nu confirma niciun numar din cerinte => block', () => expect(cu({ bransamente_in_capitole: [758] }).blocaje).toContain('numere'))
    it('H1: nume din alta licitatie in capitole => block', () => expect(cu({ identitate_straine: ['Domnesti'] }).blocaje).toContain('identitate'))
    it('H5: trimitere la anexa inexistenta => block', () => expect(cu({ anexe_referite: ['anexa 9'] }).blocaje).toContain('anexe'))
    it('H4: garantie oferita sub cea ceruta => block', () => expect(cu({ garantie_oferit_luni: 24 }).blocaje).toContain('garantie'))
    it('H2: cantitati diferite intre Cantitati si grafic => block', () => expect(cu({ grafic_fronturi_m: 900 }).blocaje).toContain('cantitati'))
    it('capitol obligatoriu gol — randul care LIPSEA din cardul licitatiei', () => expect(cu({ capitole_goale: 1 }).blocaje).toContain('goale'))
    it('capitol scris de AI si necitit de nimeni', () => expect(cu({ capitole_nescrise_de_om: 1 }).blocaje).toContain('nescrise'))
    it('afirmatie blocanta (om inexistent / plecat)', () => expect(cu({ afirmatii_blocante: 1 }).blocaje).toContain('conformitate'))
    it('niciun document incarcat', () => expect(cu({ documente: 0 }).blocaje).toContain('docs'))
    it('orice blocaj face starea block, indiferent de rezerve', () => expect(cu({ capitole_goale: 1, observatii_deschise: 3 }).stare).toBe('block'))
  })

  describe('AVERTISMENTE — se depune, dar ramane scris', () => {
    it('observatie deschisa e warn, nu block (canal social, nu fapt)', () => {
      const ev = cu({ observatii_deschise: 2 })
      expect(ev.stare).toBe('warn'); expect(ev.blocaje).toEqual([])
    })
    it('fara nicio afirmatie incarcata -> warn, nu ok (nu se da verde din lipsa de date)', () => expect(cu({ afirmatii: 0 }).stare).toBe('warn'))
    it('grafic inghetat cu avertismente -> warn (o versiune salvata nu e un grafic verificat)', () => expect(cu({ grafic_avertismente: 2 }).stare).toBe('warn'))
    it('grafic fara versiune -> warn', () => expect(cu({ grafic_versiune: null }).stare).toBe('warn'))
    it('documente necitite -> warn', () => expect(cu({ documente_necitite: 3 }).stare).toBe('warn'))
    it('"nu este cazul" -> warn (unele autoritati il interzic, altele nu)', () => expect(cu({ capitole_nu_e_cazul: 1 }).stare).toBe('warn'))
    it('rezervele sunt texte gata de pus in mesajul semnaturii', () => {
      const ev = cu({ observatii_deschise: 1 })
      expect(ev.rezerve).toHaveLength(1); expect(ev.rezerve[0]).toMatch(/observa/i)
    })
  })

  describe('verdictSemnatura — un singur loc decide verde/galben', () => {
    it('ok -> verde', () => expect(verdictSemnatura(cu({}))).toBe('verde'))
    it('orice rezerva -> galben; "galben" NU inseamna gata de depus (P0.2)', () => expect(verdictSemnatura(cu({ observatii_deschise: 1 }))).toBe('galben'))
  })

  it('toate cele 16 randuri ale portii sunt prezente, in ordinea afisata', () => {
    expect(cu({}).randuri.map(r => r.k)).toEqual(
      ['cuprins','fara','neverificate','capcane','goale','nu_e_cazul','conformitate','nescrise','observatii','docs','grafic','cantitati','garantie','anexe','identitate','numere'])
  })
})
