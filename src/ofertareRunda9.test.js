// R5 RUNDA 9 (verificatorii rundei 8 — M1 / M2 / M3 + minorii; ADDENDUM 3 Copilot): partea JS.
// Paritatea cu view-ul pe PGlite (același set de rânduri) e în scratchpad pglite/test_runda9.mjs (R9-M3); aici — funcțiile pure.
import { describe, it, expect } from 'vitest'
import { categoriiRetea, clasificaRandVedere, controlCantitatiGrafic, controlFronturiGrafic, fronturiDinCantitati, randuriLipsa, reverificareGraficInghetat,
  umClasaLungime } from './ofertareCantitatiAprobare.js'
import { controlCantitati } from './ofertareControale.js'
import { deExportat, stareBazaCiorna, textDiferente, MESAJ_SCHIMBATA } from './ofertareClarificariBaza.js'
import { RESTANTE, textRestante } from './ofertareTransferRestante.js'
import { stareCitireNeterminata } from '../supabase/functions/ofertare-plansa-citeste/transfer_conflicte.ts'

const R = (id, denumire, um, cantitate, status = 'extras', extra = {}) => ({ id, denumire, um, cantitate, status, categorie: 'Conducte și montaj', tip_sursa: 'lista_f3', obiect: null, sursa: null, ...extra })

describe('M3 — o singură definiție a categoriilor de rețea (oglinda view-ului)', () => {
  const rows = [
    R(1, 'Țeavă Dn110 — A', 'm', 1000, 'validat'), R(2, 'Țeavă Dn90 — B', 'm', 250.5), R(3, 'Țeavă Dn125 — C', 'm', null, 'validat', { tip_sursa: 'memoriu' }),
    R(4, 'Tub protecție', 'm', null, 'extras', { tip_sursa: 'memoriu' }), R(5, 'Parapete', 'M', 40), R(6, 'Țeavă Dn63 — D', 'ml', 500, 'validat'),
    R(7, 'Țeavă Dn40 — E', 'km', 0.8, 'extras', { tip_sursa: 'plansa', categorie: 'Rețea distribuție' }), R(8, 'Țeavă Dn32 — F', null, 120, 'extras', { tip_sursa: null }),
    R(9, 'Spălare conductă', 'sute m', 12.5), R(10, 'Umplutură', 'mc', 80, 'validat'), R(11, 'Cot PE', 'buc', 16, 'extras', { tip_sursa: 'memoriu' }),
    R(12, 'TOTAL rețea', 'm', 2000, 'validat', { obiect: 'TOTAL' }), R(13, 'Nisip', 'mc', 30, 'extras', { categorie: 'Materiale' }), R(14, 'Fără categorie', 'm', 10, 'extras', { categorie: null }),
    R(15, 'Țeavă Dn160 — G', 'm', 700, 'extras', { tip_sursa: null }),
    // invalidat de om (m → ml pe rândul aprobat) și unitate schimbată pe un rând neaprobat — marcate ca de marcheazaInvalidate
    R(16, 'Țeavă Dn180 — H', 'ml', 300, 'diferenta', { invalidat_istoric: true }), R(17, 'Țeavă Dn75 — I', 'ml', 90, 'extras', { tip_sursa: 'memoriu', unitate_schimbata_istoric: true }),
  ]
  it('categoriiRetea = coloanele view-ului (numărate de mână pe setul comun cu PGlite)', () => {
    const c = categoriiRetea(rows)
    expect(c).toMatchObject({ retea_randuri: 10, retea_nevalidate: 7, lista_f3_nevalidate: 3, fara_tip_nevalidate: 1, retea_validate_fara_cant: 1, retea_fara_cant: 2,
      um_de_normalizat: 5, um_de_normalizat_f3: 3, retea_alte_unitati: 4, retea_alte_unitati_f3: 2, retea_alte_unitati_lungimi: 2, retea_alte_unitati_lungimi_f3: 1,
      retea_alte_unitati_lungimi_nevalidate: 2, invalidate_in_afara_retea: 0, unitate_schimbata_in_afara_retea: 0, total_invalidate: 0 })
    expect(c.retea_nevalidate_m).toBeCloseTo(2180.5, 6)   // 250,5 + 40 („M”) + 700; rândul fără cantitate nu intră ca 0 în sumă
    expect(Object.keys(c.retea_alte_unitati_pe_um).sort()).toEqual(['', 'buc', 'mc', 'sute m'])
  })
  it('clasa „lungimi” = m / ml / km / sute m + sinonimele exacte, sau FĂRĂ unitate; mc / buc / mp / ore nu', () => {
    for (const u of ['ml', 'M.L.', 'km', 'SUTE M', 'metri', null, '', ' m. ']) expect(umClasaLungime(u)).toBe(true)
    for (const u of ['mc', 'buc', 'mp', 'ore', 'kg']) expect(umClasaLungime(u)).toBe(false)
    expect(clasificaRandVedere(R(1, 'x', 'M', 1)).inRetea).toBe(true)
    expect(clasificaRandVedere(R(1, 'x', 'ml', 1)).inRetea).toBe(true)
    expect(clasificaRandVedere(R(1, 'TOTAL', 'ml', 1)).alteUm).toBe(false)
  })
  it('poarta graficului vede EXACT categoriile view-ului: lipsă / de verificat / numite', () => {
    const L = randuriLipsa(rows, '')
    const mot = Object.fromEntries(L.lipsa.map(x => [x.id, x.motiv]))
    expect(mot[7]).toBe('nevalidat'); expect(mot[8]).toBe('unitate de verificat'); expect(mot[9]).toBe('unitate de verificat')
    expect(mot[3]).toBe('validat, fără cantitate determinată'); expect(mot[4]).toBe('nevalidat, fără cantitate determinată')
    expect(mot[16]).toBe('nevalidat'); expect(mot[17]).toBe('nevalidat')
    expect(L.deVerificat.map(x => x.id)).toEqual([])
    expect(L.informativ.map(x => x.id).sort()).toEqual([10, 11])
    expect(mot[13]).toBeUndefined(); expect(mot[12]).toBeUndefined(); expect(mot[14]).toBeUndefined()
    const c = categoriiRetea(rows)
    expect(L.lipsa.filter(x => x.motiv === 'unitate de verificat').length).toBe(c.retea_alte_unitati_lungimi_nevalidate)
    expect(L.lipsa.filter(x => x.motiv === 'validat, fără cantitate determinată').length).toBe(c.retea_validate_fara_cant)
  })
})

describe('M3 / ADDENDUM 3 (B) — nicio sumă parțială prezentată drept total în poarta graficului', () => {
  const baza = [R(1, 'Țeavă Dn110 — A', 'm', 1000, 'validat')]
  it('R9b: 1.000 m + 500 ml validate: conversie explicită, 1.500 m în fronturi', () => {
    const rows = [...baza, R(2, 'Țeavă Dn90 — B', 'ml', 500, 'validat')]
    const c = controlCantitatiGrafic(rows, '', { conflicte: [], eroare_conflicte: null, eroare_istoric: null })
    expect(c.stare).toBe('ok'); expect(c.retea).toHaveLength(2)
    const f = controlFronturiGrafic({ cantitati_asumate: '', fronturi: fronturiDinCantitati(rows, '').fronturi }, rows, { conflicte: [], eroare_conflicte: null, eroare_istoric: null })
    expect(f.stare).toBe('ok'); expect(f.incomplet).toBe(false); expect(f.ref).toBe(1500)
  })
  it('rânduri NEVALIDATE în km / fără unitate => „cant” BLOCK (S3d); rând VALIDAT fără cantitate => BLOCK (S3g); complet => ok cu perimetrul spus', () => {
    expect(controlCantitatiGrafic([...baza, R(2, 'Țeavă Dn63', 'km', 0.8)], '').stare).toBe('block')
    expect(controlCantitatiGrafic([...baza, R(2, 'Țeavă Dn40', null, 120)], '').stare).toBe('block')
    const g = controlCantitatiGrafic([...baza, R(2, 'Țeavă Dn125', 'm', null, 'validat')], '')
    expect(g.stare).toBe('block'); expect(g.detalii).toMatch(/validat, fără cantitate determinată/)
    const ok = controlCantitatiGrafic([...baza, R(3, 'Umplutură', 'mc', 80, 'validat')], '')
    expect(ok.stare).toBe('ok'); expect(ok.detalii).toMatch(/^1 rânduri rețea în m, toate validate cu cantitate · în afara fronturilor \(nu sunt lungimi de conductă în m\): 1 poziție de rețea/)
  })
  it('S3f: TOTAL validat FĂRĂ cantitate => „total declarat cu cantitate necunoscută”, nu „0 m”', () => {
    const c = controlCantitatiGrafic([...baza, { id: 9, obiect: 'TOTAL', categorie: 'Conducte și montaj', denumire: 'TOTAL rețea', um: 'm', cantitate: null, status: 'validat' }], '')
    expect(c.detalii).toMatch(/total declarat cu cantitate necunoscută/); expect(c.detalii).not.toMatch(/total declarat 0 m/)
  })
  it('S4a: Dn schimbat (aceeași lungime) și REVALIDAT => frontul înghețat cere repropunere (fronturi noi: denumire_sursa; vechi: Dn-ul citit)', () => {
    const r0 = [R(2, 'Țeavă PE100 SDR11 Dn180 — Coconi', 'm', 1100, 'validat')]
    const fr = fronturiDinCantitati(r0, '').fronturi
    const acum = [{ ...r0[0], denumire: 'Țeavă PE100 SDR11 Dn160 — Coconi' }]
    const c = controlFronturiGrafic({ cantitati_asumate: '', fronturi: fr }, acum)
    expect(c.stare).toBe('block'); expect(c.probleme[0]).toMatch(/alte atribute decât la propunere \(denumire \/ obiect\)/)
    const vechi = fr.map(({ denumire_sursa, obiect_sursa, ...f }) => f)
    expect(controlFronturiGrafic({ cantitati_asumate: '', fronturi: vechi }, acum).probleme[0]).toMatch(/Dn180 → Dn160/)
    expect(reverificareGraficInghetat({ cantitati_asumate: '', fronturi: fr }, acum).grafic_de_reverificat).toBe(1)
    expect(controlFronturiGrafic({ cantitati_asumate: '', fronturi: fr }, r0).probleme).toEqual([])   // control: neschimbat => nicio problemă
  })
})

describe('M1 / S3b / S3h — H2', () => {
  const NOI0 = { invalidate_in_afara_retea: 0, fara_tip_nevalidate: 0, total_invalidate: 0, unitate_schimbata_in_afara_retea: 0, um_de_normalizat: 0, transfer_conflicte_docs: 0,
    lista_f3_validate_fara_cant: 0, retea_alte_unitati: 0, sterse_dupa_validare: 0 }
  it('F3 cu o poziție de LUNGIME în „ml” => BLOCK, cifra F3 numită SUBTOTAL (nu „1.000 m în F3 și în grafic” ok)', () => {
    const h = controlCantitati({ lista_f3_m: 1000, grafic_fronturi_m: 1000, lista_f3_nevalidate: 0, ...NOI0, retea_alte_unitati: 1, retea_alte_unitati_f3: 1,
      retea_alte_unitati_lungimi_f3: 1, retea_alte_unitati_pe_um: { ml: { suma: 500, randuri: 1, fara_cantitate: 0 } } })
    expect(h.stare).toBe('block')
    expect(h.detalii).toMatch(/^1\.000 m în subtotal F3 \(doar pozițiile în m — NU e total\) și în grafic · totalul F3 e PARȚIAL: 1 poziție F3 de rețea e de LUNGIME în altă unitate/)
  })
  it('„mc” în F3 (nu e lungime) => WARN numit, fără „subtotal”; cifrele lipsei exacte: 0,4 m, nu „0 m”', () => {
    const h = controlCantitati({ lista_f3_m: 1000, grafic_fronturi_m: 1000, lista_f3_nevalidate: 0, ...NOI0, retea_alte_unitati: 1, retea_alte_unitati_f3: 1,
      retea_alte_unitati_lungimi_f3: 0, retea_alte_unitati_pe_um: { mc: { suma: 80, randuri: 1, fara_cantitate: 0 } } })
    expect(h.stare).toBe('warn'); expect(h.detalii).toMatch(/^1\.000 m în F3 și în grafic/)
    const h2 = controlCantitati({ lista_f3_m: 0.4, grafic_fronturi_m: null, lista_f3_nevalidate: 1, lista_f3_nevalidate_m: 0.4, ...NOI0 })
    expect(h2.detalii).toMatch(/^F3 0,4 m include 1 rând de rețea NEVALIDATE \(0,4 m\)/)
  })
})

describe('M2 / ADDENDUM 3 — baza ciornei: afișare, export verificat în backend (starea citită), fail-closed', () => {
  const q = (id, st, extra = {}) => ({ id, nr: id, status: st, cheie: 'auto_planse_1', intrebare: 'text', sursa: 'planse_auto:1,gen_aaaaaaaaaaaa', ...extra })
  const vb = (id, stare, extra = {}) => ({ id, stare, marcaj_planse: false, text: stare === 'ok' ? null : MESAJ_SCHIMBATA + ' (…)', amprenta_curenta: 'a1', ...extra })
  it('stareBazaCiorna: ok / schimbata / indisponibila / luat_act / view indisponibil / rând lipsă', () => {
    const m = new Map([[1, vb(1, 'ok')], [2, vb(2, 'schimbata')], [3, vb(3, 'indisponibila')], [4, vb(4, 'luat_act')], [5, vb(5, 'ok', { marcaj_planse: true })]])
    expect(stareBazaCiorna(q(1, 'de_trimis'), m, null)).toMatchObject({ nivel: 'ok', blocheaza: false })
    expect(stareBazaCiorna(q(2, 'de_trimis'), m, null)).toMatchObject({ nivel: 'schimbata', blocheaza: true })
    expect(stareBazaCiorna(q(3, 'propunere'), m, null)).toMatchObject({ nivel: 'indisponibila', blocheaza: true })
    expect(stareBazaCiorna(q(4, 'trimisa'), m, null)).toMatchObject({ nivel: 'luat_act', blocheaza: true })
    expect(stareBazaCiorna(q(5, 'de_trimis'), m, null)).toMatchObject({ nivel: 'ok', blocheaza: true })
    expect(stareBazaCiorna(q(1, 'de_trimis'), null, 'relation does not exist')).toMatchObject({ nivel: 'nu_putem_verifica', blocheaza: true })
    expect(stareBazaCiorna(q(9, 'de_trimis'), m, null)).toMatchObject({ nivel: 'nu_putem_verifica', blocheaza: true })
    expect(stareBazaCiorna({ id: 7, status: 'de_trimis', cheie: null }, null, 'x')).toMatchObject({ nivel: 'na', blocheaza: false })   // clarificare manuală: nu se aplică
  })
  it('deExportat: doar „de trimis” cu baza ok intră; marcaj / bază schimbată / control indisponibil => exclusă cu motivul; clarificarea manuală despre un conflict intră (D)', () => {
    const clar = [q(1, 'de_trimis'), q(2, 'de_trimis'), q(5, 'de_trimis', { sursa: 'planse_auto:1,revizie_planse_auto' }), q(6, 'propunere'),
      { id: 8, nr: 8, status: 'de_trimis', cheie: null, intrebare: 'Vă rugăm să precizați Dn-ul „Dn60” (conflict deschis, lungime incertă).' }]
    const r = deExportat(clar, [vb(1, 'ok'), vb(2, 'schimbata'), vb(5, 'ok')], null)
    expect(r.incluse.map(x => x.id)).toEqual([1, 8])
    expect(r.excluse.map(x => [x.q.id, x.motiv.slice(0, 30)])).toEqual([[2, MESAJ_SCHIMBATA.slice(0, 30)], [5, 'necesită revizie (revizie_plan']])
    const e = deExportat(clar, null, 'permission denied')
    expect(e.incluse.map(x => x.id)).toEqual([8]); expect(e.excluse.map(x => x.q.id)).toEqual([1, 2, 5])
  })
  it('textDiferente: ce s-a schimbat față de baza anterioară (adăugat / dispărut / modificat)', () => {
    const t = textDiferente({ diferente: { adaugate: [{ id: 9, c: 50, um: 'm', s: 'extras', d: 'Țeavă Dn90' }], scoase: [{ id: 3, c: 200, um: 'm', s: 'validat', d: 'Țeavă Dn63' }],
      modificate: [{ id: 2, inainte: { id: 2, c: 1100, um: 'm', s: 'validat', d: 'Țeavă Dn180' }, acum: { id: 2, c: 1000, um: 'm', s: 'validat', d: 'Țeavă Dn180' } }], n_adaugate: 1, n_scoase: 1, n_modificate: 1 } })
    expect(t).toEqual(['＋ apărut: #9 „Țeavă Dn90” 50 m, extras', '− dispărut (șters / mutat / altă categorie): #3 „Țeavă Dn63” 200 m, validat', '≠ #2: cantitate 1.100 → 1.000'])
  })
})

describe('ADDENDUM 3 (3) + M12 — restanțele de transfer', () => {
  it('jurnalul vechi = „verificare indisponibilă”, nu contradicție, nu recitire plătită obligatorie; „citire neterminată” = restanță internă', () => {
    expect(RESTANTE.evaluare_partiala.eticheta).toBe('verificare indisponibilă (jurnal vechi)')
    expect(RESTANTE.evaluare_partiala.cauza).toMatch(/NU o contradicție a documentației/)
    expect(RESTANTE.evaluare_partiala.actiune).toMatch(/^reevaluează determinist pe observațiile salvate \(fără AI; versiunea evaluării se consemnează\)/)
    expect(RESTANTE.citire_neterminata.categorie).toBe('procesare_interna')
    expect(textRestante({ citire_neterminata: 1 })).toMatch(/^citire neterminată ×1 \(termină citirea planșei/)
  })
  it('stareCitireNeterminata (oglinda SQL): gata=false, fără înregistrare și fără jurnal de cantități => deschisă; altfel null', () => {
    expect(stareCitireNeterminata({ citire_ai: { gata: false, sumar: { felii_citite: 3 } } })).toEqual({ stare: 'citire_neterminata', n: 1, restante: [{ tip: 'citire_neterminata', n: 1 }] })
    expect(stareCitireNeterminata({ citire_ai: { gata: true, sumar: {} } })).toBeNull()
    expect(stareCitireNeterminata({ transfer_cantitati: { id: 'x' }, citire_ai: { gata: false } })).toBeNull()
    expect(stareCitireNeterminata({ citire_ai: { gata: false, sumar: { cantitati: { adaugate: 1 } } } })).toBeNull()
    expect(stareCitireNeterminata({ transfer_cantitati: [1], citire_ai: { gata: false } })).toBeNull()   // corupt => „necunoscut”, altă regulă
  })
})
