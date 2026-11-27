import { describe, it, expect } from 'vitest'
import { citesteRaspunsExport, practicaDinExport, MESAJ_EXPORT_POARTA, MESAJ_EXPORT_MIGRARE, MESAJ_EXPORT_RASPUNS } from './ofertareClarificariExport.js'

// Forma răspunsului RPC-ului ofertare_clarificari_export după 20270115a (varianta B): { clarificari, temeiuri }; temeiurile de pe întrebări ȘI de pe puncte,
// cu decizia CNSC (id, nr_decizie, buletin_oficial, data, link_sursa, control_judiciar, verificat), citatul înghețat și locul (pagina) din corpus.
const D = { id: 'CNSC-2024-3657', nr_decizie: '3657/C1/4067', buletin_oficial: null, data: '2024-12-23', link_sursa: 'http://portal.cnsc.ro/x', control_judiciar: { rezultat: 'mentinuta' }, verificat: true }
const D_NEV = { ...D, id: 'CNSC-NEV', verificat: false }
const CLAR = [{ id: 11, nr: 1, intrebare: 'unu', status: 'de_trimis' }, { id: 13, nr: 3, intrebare: 'trei', status: 'de_trimis' }]
const T_INTREBARE = { id: 701, nr: 1, tinta: 'intrebare', punct_nr: null, citat_idx: 0, citat_text: 'citat unu', citat_loc: 'p. 3', decizie: D }
const T_PUNCT = { id: 702, nr: 1, tinta: 'punct', punct_nr: 1, citat_idx: 1, citat_text: 'citat doi', citat_loc: 'p. 4', decizie: D }
const T_NR3 = { id: 706, nr: 3, tinta: 'intrebare', punct_nr: null, citat_idx: 0, citat_text: 'citat trei', citat_loc: 'pag. 12', decizie: D }
const RASPUNS = { clarificari: CLAR, temeiuri: [T_INTREBARE, T_PUNCT, T_NR3] }

describe('citesteRaspunsExport — forma răspunsului (fail-closed)', () => {
  it('răspunsul nou {clarificari, temeiuri} e acceptat ca atare', () => {
    const r = citesteRaspunsExport(RASPUNS, null)
    expect(r).toEqual({ ok: true, clarificari: CLAR, temeiuri: RASPUNS.temeiuri })
  })
  it('42501 (poarta punctelor de pe server) → mesajul clar al porții, nu textul brut', () => {
    const r = citesteRaspunsExport(null, { code: '42501', message: 'Export blocat: adresa o genereaza doar ownerul sau un responsabil al licitatiei (...)' })
    expect(r).toEqual({ ok: false, mesaj: MESAJ_EXPORT_POARTA })
    expect(citesteRaspunsExport(null, { message: 'permission denied for function ofertare_clarificari_export' }).mesaj).toBe(MESAJ_EXPORT_POARTA)
  })
  it('altă eroare a serverului (decizie, revizie, ciornă automată) → „Export blocat: <mesajul serverului>”', () => {
    expect(citesteRaspunsExport(null, { code: 'P0001', message: 'Export blocat: fără drept de decizie pe licitație' }).mesaj).toBe('Export blocat: fără drept de decizie pe licitație')
    expect(citesteRaspunsExport(null, { code: 'P0001', message: 'Clarificarea #2 necesită revizie' })).toEqual({ ok: false, mesaj: 'Export blocat: Clarificarea #2 necesită revizie' })
    expect(citesteRaspunsExport(null, { code: 'PGRST301' })).toEqual({ ok: false, mesaj: 'Export blocat: verificare indisponibilă' })
  })
  it('forma VECHE (tablou = migrarea 20270115a neaplicată) → refuz explicit, nu export „pe ce avem” (ordinea livrării UI → migrare e sigură)', () => {
    expect(citesteRaspunsExport(CLAR, null)).toEqual({ ok: false, mesaj: MESAJ_EXPORT_MIGRARE })
    expect(citesteRaspunsExport([], null)).toEqual({ ok: false, mesaj: MESAJ_EXPORT_MIGRARE })
  })
  it('răspuns neașteptat (null, text, obiect fără temeiuri, întrebare fără nr) → refuz', () => {
    for (const d of [null, undefined, 'x', 5, {}, { clarificari: CLAR }, { temeiuri: [] }, { clarificari: 'nu', temeiuri: [] }, { clarificari: [{ id: 1 }], temeiuri: [] }, { clarificari: [null], temeiuri: [] }]) {
      expect(citesteRaspunsExport(d, null)).toEqual({ ok: false, mesaj: MESAJ_EXPORT_RASPUNS })
    }
  })
  it('UI-ul vechi (verifica Array.isArray(data)) ar REFUZA răspunsul nou: fila veche deschisă peste momentul migrării nu scoate o adresă incompletă (review r3 P1 #1)', () => {
    const uiVechiRefuza = (data, error) => !!error || !Array.isArray(data)
    expect(uiVechiRefuza(RASPUNS, null)).toBe(true)
    expect(uiVechiRefuza(CLAR, null)).toBe(false)   // forma veche o accepta
  })
})

describe('practicaDinExport — practica CNSC din răspunsul serverului', () => {
  it('temeiurile de pe întrebări ȘI de pe puncte intră în adresă, în formatul unic, ordonate pe întrebare apoi în ordinea serverului', () => {
    const r = practicaDinExport(CLAR, [T_NR3, T_PUNCT, T_INTREBARE])
    expect(r.ok).toBe(true)
    expect(r.practica.map(p => [p.nr, p.citat])).toEqual([[1, 'citat unu'], [1, 'citat doi'], [3, 'citat trei']])
    expect(r.practica[0].referinta).toBe('Decizia CNSC nr. 3657/C1/4067 din 23.12.2024, p. 3 — http://portal.cnsc.ro/x')
    expect(r.practica[1].referinta).toMatch(/p\. 4 —/)
    expect(r.practica[2].referinta).toMatch(/p\. 12 —/)
  })
  it('temeiul de pe o întrebare NEexportată (serverul le filtrează deja; apărare în plus) e sărit', () => {
    const r = practicaDinExport([CLAR[0]], [T_INTREBARE, T_NR3])
    expect(r.practica.map(p => p.nr)).toEqual([1])
  })
  it('un temei bifat care nu poate ieși BLOCHEAZĂ exportul, cu întrebarea și punctul în mesaj (nu dispare tăcut)', () => {
    expect(practicaDinExport(CLAR, [T_INTREBARE, { ...T_PUNCT, decizie: D_NEV }])).toEqual({ ok: false, mesaj: 'Export blocat: temeiul bifat „adresă” la întrebarea 1 (punctul 1) nu poate ieși în adresă (decizie neverificată) — debifează-l sau corectează-l.' })
    expect(practicaDinExport(CLAR, [{ ...T_NR3, citat_idx: null, citat_text: null, citat_loc: null }]).mesaj).toMatch(/întrebarea 3 nu poate ieși în adresă \(doar referință, fără citat\)/)
    expect(practicaDinExport(CLAR, [{ ...T_INTREBARE, citat_loc: 'secțiunea 3' }]).mesaj).toMatch(/fără pagină sau link sursă/)
    // un tipar / o cerință bifată prin API (fără decizie) blochează — serverul nu filtrează pe tip, UI-ul decide
    expect(practicaDinExport(CLAR, [{ id: 9, nr: 1, tinta: 'intrebare', citat_idx: null, decizie: null }]).mesaj).toMatch(/nu e decizie CNSC/)
  })
  it('fără temeiuri → practică goală (adresa iese fără secțiune)', () => {
    expect(practicaDinExport(CLAR, [])).toEqual({ ok: true, practica: [] })
  })
  it('un rând de temei care nu e obiect → refuz (răspuns stricat)', () => {
    expect(practicaDinExport(CLAR, [null])).toEqual({ ok: false, mesaj: MESAJ_EXPORT_RASPUNS })
  })
})
