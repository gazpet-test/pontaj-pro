// R5 — REPARAȚIA RUNDEI 2 (verificatorii rundei 1, 26.09.2026): consumatorii JS.
//  - V-B2: cifrele din mesajele consumatorilor sunt EXACTE (comparația 1b e exactă — textul la fel): „5.250 → 5.250,4 m”, „-0,4 m”;
//  - D1 / H2: rândurile de rețea VALIDATE fără cantitate — totalul F3 e PARȚIAL (BLOCK), nu „X m în F3 și în grafic”;
//  - rețeaua în ALTE unități („sute m”, „mc”, fără unitate) — numită, în afara comparației, FĂRĂ conversie (WARN);
//  - V-B3b: rândurile APROBATE ȘTERSE — „de reverificat” (H2 + poarta graficului), stins de o versiune nouă a graficului generată după;
//  - randuriFront: „total” în obiect, denumire ȘI sursă (ca filtrul qm din view) — un rând „Total …” cu obiect NULL nu devine front;
//  - „Propune din cantități”: mesajul spune lipsa ȘI sursa incompletă (nu else-if);
//  - nota regulii (1b): procentul din sutimile exacte — paritatea cu SQL și peste 1e18.
// Fiecare test pică pe codul de dinainte de reparație (a3230d5) — verificat cu JSWT în scratchpad (controlul negativ din test_sarcina2_r2).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { calculeazaPoartaGrafic } from './graficPoartaCalcul.js'
import { campuriCantitatiNevalidate, controlCantitatiGrafic, controlFronturiGrafic, fronturiDinCantitati, mesajPropuneFronturi, randuriFront,
  randuriLipsa, reverificareGraficInghetat, sterseDupaValidare, textSterse } from './ofertareCantitatiAprobare.js'
import { controlCantitati } from './ofertareControale.js'
import { evalueazaPoarta } from './ofertarePoarta.js'
import { descrieDiferenta } from './ofertareCantitatiInvalidare.js'

const R = (id, den, m, status = 'validat', extra = {}) => ({ id, obiect: null, categorie: 'Conducte și montaj', denumire: den, um: 'm', cantitate: m, cantitate_plansa: m,
  status, diferenta_nota: null, sursa: 'Memoriu', ...extra })
// lic. 3 reală (SELECT 26.09.2026): rândurile 2 și 3, validate
const VALIDATE = [R(2, 'Țeavă PE100 SDR11 Dn180 — extravilan Mănăstirea→Coconi', 1100), R(3, 'Țeavă PE100 SDR11 Dn160 — Coconi', 5250)]
const VIEW0 = { licitatie_id: 3, lista_f3_nevalidate: 0, fara_tip_nevalidate: 0, invalidate_in_afara_retea: 0, total_invalidate: 0, unitate_schimbata_in_afara_retea: 0,
  um_de_normalizat: 0, transfer_conflicte_docs: 0, transfer_conflicte_n: 0, transfer_in_curs: 0, transfer_restante: {},
  lista_f3_fara_cant: 0, retea_fara_cant: 0, lista_f3_validate_fara_cant: 0, retea_validate_fara_cant: 0, retea_alte_unitati: 0, retea_alte_unitati_f3: 0,
  retea_alte_unitati_pe_um: {}, sterse_dupa_validare: 0, sterse_dupa_validare_retea: 0, sterse_dupa_validare_pe_um: {}, sterse_dupa_validare_ultima: null, sterse_dupa_validare_lista: [] }
const H2 = (view, extra = {}) => controlCantitati({ lista_f3_m: 6350, grafic_fronturi_m: 6350, ...campuriCantitatiNevalidate({ data: { ...VIEW0, ...view }, error: null }), ...extra })
const VERDE = { capitole: 5, fara_capitol: 0, de_raspuns: 10, cu_capitol: 10, cerinte_neverificate: 0, cerinte_neconfirmate_cu_capitol: 0,
  documentatie_verificata: true, documentatie_blocaj: null, capcane: 0, capcane_descoperite: 0, capitole_goale: 0, capitole_nu_e_cazul: 0,
  afirmatii: 3, afirmatii_blocante: 0, afirmatii_de_verificat: 0, capitole_nescrise_de_om: 0, observatii_deschise: 0, documente: 4, documente_necitite: 0,
  grafic_versiune: 1, grafic_avertismente: 0 }

describe('V-B2 — mesajele consumatorilor cu cifra EXACTĂ (comparația 1b e exactă)', () => {
  it('frontul înghețat 5.250 vs rândul revalidat pe 5.250,4: „(5.250 → 5.250,4 m)”, nu „(5.250 → 5.250 m)”', () => {
    const params = { cantitati_asumate: '', fronturi: fronturiDinCantitati(VALIDATE, '').fronturi }
    const acum = [VALIDATE[0], { ...VALIDATE[1], cantitate: 5250.4 }]
    const cf = controlFronturiGrafic(params, acum)
    expect(cf.stare).toBe('block')
    expect(cf.probleme[0]).toMatch(/rândul-sursă #3 s-a schimbat de la propunere \(5\.250 → 5\.250,4 m\)/)
    expect(reverificareGraficInghetat(params, acum).grafic_de_reverificat_text).toMatch(/\(5\.250 → 5\.250,4 m\)/)
  })
  it('H2: F3 6.350,4 vs fronturi 6.350 => „-0,4 m”, nu „-0 m”; invers „+0,4 m”; peste toleranță cu cifrele exacte', () => {
    const a = H2({}, { lista_f3_m: 6350.4, grafic_fronturi_m: 6350 })
    expect(a.stare).toBe('warn')
    expect(a.detalii).toBe('F3 6.350,4 m vs 6.350 m în fronturi: -0,4 m, sub 0,1 % — rotunjire, dar spune-o în ofertă')
    expect(H2({}, { lista_f3_m: 6350, grafic_fronturi_m: 6350.4 }).detalii).toMatch(/^F3 6\.350 m vs 6\.350,4 m în fronturi: \+0,4 m, sub 0,1 %/)
    expect(H2({}, { lista_f3_m: 6350, grafic_fronturi_m: 6400.25 }).detalii).toMatch(/^F3 6\.350 m vs 6\.400,25 m în fronturile graficului: \+50,25 m \(0\.8 %\)/)
  })
})

describe('D1 / H2 — rândurile de rețea VALIDATE fără cantitate: totalul F3 e PARȚIAL', () => {
  it('F3 500 m validat + 1 rând F3 validat FĂRĂ cantitate => H2 BLOCK (nu „500 m în F3 și în grafic” ok); poarta propunerii blocată', () => {
    const h = H2({ lista_f3_fara_cant: 1, retea_fara_cant: 1, lista_f3_validate_fara_cant: 1, retea_validate_fara_cant: 1 }, { lista_f3_m: 500, grafic_fronturi_m: 500 })
    expect(h.stare).toBe('block')
    expect(h.detalii).toBe('500 m în F3 și în grafic · totalul F3 e PARȚIAL: 1 poziție F3 de rețea VALIDATĂ FĂRĂ cantitate determinată — „validat” fără cifră ' +
      'nu e o cantitate aprobată; completează cantitatea și revalidează (✓) în 📋 Cantități')
    const ev = evalueazaPoarta({ ...VERDE, lista_f3_m: 500, grafic_fronturi_m: 500, ...campuriCantitatiNevalidate({ data: { ...VIEW0, lista_f3_validate_fara_cant: 1, retea_validate_fara_cant: 1 }, error: null }) })
    expect(ev.stare).toBe('block')
    expect(ev.blocaje).toContain('cantitati')
  })
  it('rând de rețea validat fără cantitate ÎN AFARA F3 => WARN „necunoscut”, nu „0 m”; control: fără ele => ok', () => {
    const h = H2({ retea_fara_cant: 2, retea_validate_fara_cant: 2 })
    expect(h.stare).toBe('warn')
    expect(h.detalii).toMatch(/INCOMPLET: 2 rânduri de rețea validate \(în afara F3\) FĂRĂ cantitate determinată — nu „0 m”, necunoscut/)
    expect(H2({}).stare).toBe('ok')
  })
})

describe('rețeaua în ALTE unități — numită, în afara comparației, fără conversie', () => {
  it('lic. 5 reală: F3 în „sute m” și „mc” => WARN cu unitățile separate (fără „X m” însumați); o singură unitate', () => {
    const h = H2({ retea_alte_unitati: 23, retea_alte_unitati_f3: 23, retea_alte_unitati_pe_um: { 'sute m': { suma: 48.59, randuri: 12, fara_cantitate: 0 }, mc: { suma: 1166.3, randuri: 11, fara_cantitate: 0 } } })
    expect(h.stare).toBe('warn')
    expect(h.detalii).toMatch(/23 rânduri de rețea sunt în ALTE unități decât „m” \(lungimi 48,59 sute m; volume 1\.166,3 mc; din care 23 în F3\) — în afara comparației F3 ↔ grafic, FĂRĂ conversie/)
    expect(h.detalii).not.toMatch(/1\.214|1214/)   // 48,59 + 1.166,3 nu se adună
    expect(H2({ retea_alte_unitati: 1, retea_alte_unitati_f3: 0, retea_alte_unitati_pe_um: { '': { suma: null, randuri: 1, fara_cantitate: 1 } } }).detalii)
      .toMatch(/1 rând de rețea e în ALTE unități decât „m” \(1 poziție fără cantitate determinată\)/)
  })
})

describe('V-B3b — rândurile APROBATE ȘTERSE: „de reverificat”, stins de repropunere (versiune nouă a graficului)', () => {
  const lista = [{ cantitate_id: 962002, la: '2026-09-26T12:00:00Z', um: 'm', cantitate: 1100, denumire: 'Țeavă PE100 SDR11 Dn180', retea: true }]
  const v = { sterse_dupa_validare: 1, sterse_dupa_validare_retea: 1, sterse_dupa_validare_pe_um: { m: { suma: 1100, randuri: 1, fara_cantitate: 0 } },
    sterse_dupa_validare_ultima: '2026-09-26T12:00:00Z', sterse_dupa_validare_lista: lista }
  it('H2 „5.250 m în F3 și în grafic” nu mai e ok: WARN, cu metrii și rândul numit', () => {
    const h = H2(v, { lista_f3_m: 5250, grafic_fronturi_m: 5250 })
    expect(h.stare).toBe('warn')
    expect(h.detalii).toBe('5.250 m în F3 și în grafic · DE REVERIFICAT: 1 rând APROBAT (validat) a fost ȘTERS (1.100 m: #962002) — F3 / subtotalul rămas NU e neapărat complet; ' +
      'verifică istoricul și regenerează graficul după verificare')
    // în poarta propunerii: rezervă (semnat CU REZERVE), nu verde
    const ev = evalueazaPoarta({ ...VERDE, lista_f3_m: 5250, grafic_fronturi_m: 5250, ...campuriCantitatiNevalidate({ data: { ...VIEW0, ...v }, error: null }) })
    expect(ev.rezerve.some(t => /ȘTERS/.test(t))).toBe(true)
  })
  it('graficul regenerat DUPĂ ștergere => stins; generat ÎNAINTE => rămâne, „după ultima versiune a graficului”', () => {
    expect(H2(v, { lista_f3_m: 5250, grafic_fronturi_m: 5250, grafic_generat_la: '2026-09-26T13:00:00Z' }).stare).toBe('ok')
    const h = H2(v, { lista_f3_m: 5250, grafic_fronturi_m: 5250, grafic_generat_la: '2026-09-26T11:00:00Z' })
    expect([h.stare, /ȘTERS după ultima versiune a graficului/.test(h.detalii)]).toEqual(['warn', true])
  })
  it('lista din view e plafonată (20): toate după referință și mai multe => se numără TOATE (fail-closed)', () => {
    const L = Array.from({ length: 20 }, (_, i) => ({ cantitate_id: 100 + i, la: `2026-09-26T12:${String(59 - i).padStart(2, '0')}:00Z`, um: 'm', cantitate: 10 }))
    expect(H2({ sterse_dupa_validare: 25, sterse_dupa_validare_lista: L, sterse_dupa_validare_ultima: L[0].la }, { grafic_generat_la: '2026-09-26T10:00:00Z' }).detalii)
      .toMatch(/25 rânduri APROBATE \(validate\) au fost ȘTERSE după ultima versiune/)
  })
  it('poarta graficului: sterseDupaValidare din istoric (doar „sters” după versiunea graficului) => „cant” WARN; cu block rămâne block', () => {
    const ev = [{ id: 9, cantitate_id: 3, motiv: 'sters', created_at: '2026-09-26T12:00:00Z', v_um: 'm', v_cant: '5250', v_den: 'Țeavă PE100 SDR11 Dn160 — Coconi' },
      { id: 8, cantitate_id: 2, motiv: 'validat', created_at: '2026-09-26T11:00:00Z' },
      { id: 7, cantitate_id: 5, motiv: 'sters', created_at: '2026-09-20T12:00:00Z', v_um: 'm', v_cant: '10' }]
    const st = sterseDupaValidare(ev, '2026-09-25T00:00:00Z')
    expect(st).toEqual([{ cantitate_id: 3, la: '2026-09-26T12:00:00Z', um: 'm', cantitate: 5250, denumire: 'Țeavă PE100 SDR11 Dn160 — Coconi' }])
    expect(sterseDupaValidare(ev, null)).toHaveLength(2)
    expect(textSterse(st)).toMatch(/^DE REVERIFICAT: 1 rând APROBAT \(validat\) a fost ȘTERS după ultima versiune a graficului \(5\.250 m: #3 „Țeavă PE100 SDR11 Dn160 — Coconi”\)/)
    const rest = [VALIDATE[0]]
    const c = controlCantitatiGrafic(rest, '', { conflicte: [], eroare_conflicte: null, eroare_istoric: null, sterse: st })
    expect(c.stare).toBe('warn')
    expect(c.detalii).toMatch(/^1 rânduri rețea, toate validate · DE REVERIFICAT: 1 rând APROBAT/)
    expect(controlCantitatiGrafic(rest, '', { conflicte: [], eroare_conflicte: null, eroare_istoric: null, sterse: [] }).stare).toBe('ok')
    const p = { tip_lucrare: 'retea_pehd', mod: 'oferta', data_start: '2026-10-01', durata_luni: 10, cantitati_asumate: '', echipe: 1, mediu: 'sat', include_bransamente: false,
      nr_bransamente: 0, ferestre_operator: 'x', fronturi: fronturiDinCantitati(rest, '').fronturi }
    const g = calculeazaPoartaGrafic({ p, cantitati: rest, norme: [{ cod: 'PE', tip_lucrare: 'retea_pehd', um: 'm', productie_zi: 100, incredere: 'validat' }],
      cerinte: [{ id: 1, text_cerinta: 'x' }], durataMax: 12, sursa: { conflicte: [], eroare_conflicte: null, eroare_istoric: null, sterse: st } })
    expect(g.find(r => r.k === 'cant').stare).toBe('warn')
    // cu un conflict deschis: rămâne BLOCK, cu ambele texte
    const cb = controlCantitatiGrafic(rest, '', { conflicte: [{ document_id: 1, nume_original: 'P.pdf', n: 1, deschis: true }], eroare_conflicte: null, eroare_istoric: null, sterse: st })
    expect([cb.stare, /ȘTERS/.test(cb.detalii), /sursă incompletă/.test(cb.detalii)]).toEqual(['block', true, true])
  })
})

describe('randuriFront — „total” în obiect, denumire ȘI sursă (ca filtrul qm din view)', () => {
  it('lic. 5 reală: rând „Total …” cu obiect NULL (în denumire / în sursă) nu devine front și nu e „lipsă de rețea”; controlul intră', () => {
    const c = [R(10, 'Conductă PE100 Dn110 — strada A', 1000),
      R(11, 'TOTAL conductă PE100 Dn110', 5455.09, 'validat'),
      R(12, 'Conductă PE100 Dn110', 5455.09, 'extras', { sursa: 'F3 — Total obiect 1' })]
    expect(randuriFront(c).map(x => x.id)).toEqual([10])
    expect(fronturiDinCantitati(c, '').fronturi.map(f => f.cantitate_id)).toEqual([10])
    expect(randuriLipsa(c, '').lipsa).toEqual([])
  })
})

describe('„Propune din cantități” — lipsa ȘI sursa incompletă, împreună', () => {
  const lipsa = [{ id: 7, denumire: 'x', status: 'extras', um: 'm', cantitate: 10, motiv: 'nevalidat' }]
  it('ambele => un singur mesaj cu amândouă (înainte: doar lipsa, else-if)', () => {
    const m = mesajPropuneFronturi({ fronturi: [{}], excluse: [{}], m_excluse: 10, lipsa, text_lipsa: 'lipsește 1 rând necesar nevalidat (10 m): #7', text_sursa: 'sursă incompletă: 1 restanță deschisă' })
    expect(m).toEqual({ tip: 'err', text: '1 fronturi din rânduri validate — INCOMPLETE: lipsește 1 rând necesar nevalidat (10 m): #7 (10 m nepropuși) · sursă incompletă: 1 restanță deschisă. ' +
      'Validează-le în 📋 Cantități și re-propune.' })
    expect(mesajPropuneFronturi({ fronturi: [{}], lipsa: [], text_sursa: 'sursă incompletă: X' }).text).toBe('1 fronturi din rânduri validate — INCOMPLETE: sursă incompletă: X.')
    expect(mesajPropuneFronturi({ fronturi: [{}], lipsa: [], text_sursa: '' })).toBeNull()
    expect(mesajPropuneFronturi({ fronturi: [], lipsa: [], text_sursa: 'sursă incompletă: X' }).text).toMatch(/^Niciun rând de rețea validat — sursă incompletă: X\./)
    expect(mesajPropuneFronturi({ fronturi: [], lipsa: [], text_sursa: '' }).text).toBe('Niciun rând de rețea cu metri în Cantități.')
  })
  it('GraficPoarta folosește funcția (nu mai are ramura else-if)', () => {
    const src = readFileSync(new URL('./GraficPoarta.jsx', import.meta.url), 'utf8')
    expect(src).toMatch(/const m = mesajPropuneFronturi\(r\)/)
    expect(src).not.toMatch(/else if \(text_sursa\) showToast/)
    expect(src).toMatch(/sursaDin\(ist, conf, ver\?\.\[0\]\?\.generat_la\)/)
  })
})

describe('câmpurile noi ale view-ului — absente (view vechi) = „control parțial”, nu zero', () => {
  it('rând fără câmpurile rundei 2 => H2 nu e ok („control parțial”); fără rând => 0', () => {
    const vechi = { ...VIEW0 }; for (const k of ['lista_f3_validate_fara_cant', 'retea_alte_unitati', 'sterse_dupa_validare']) delete vechi[k]
    const c = campuriCantitatiNevalidate({ data: vechi, error: null })
    expect([c.lista_f3_validate_fara_cant, c.retea_alte_unitati, c.sterse_dupa_validare]).toEqual([undefined, undefined, undefined])
    const h = controlCantitati({ lista_f3_m: 700, grafic_fronturi_m: 700, ...c })
    expect(h.stare).toBe('warn')
    expect(h.detalii).toMatch(/control parțial: .*validate fără cantitate \/ în alte unități \/ aprobate șterse/)
    expect(campuriCantitatiNevalidate({ data: null, error: null })).toMatchObject({ lista_f3_validate_fara_cant: 0, retea_alte_unitati: 0, sterse_dupa_validare: 0, sterse_dupa_validare_lista: [] })
  })
})

describe('nota regulii (1b) — procentul din sutimile EXACTE: paritatea cu SQL și peste 1e18', () => {
  it('0,000001 m → 1e21 m: procentul scris integral (fără exponent, fără „###”), ca șablonul lat din SQL', () => {
    const t = descrieDiferenta('0.000001', '1000000000000000000000', { lungime: true, unitate: 'm' })
    expect(t).toBe('diferență mare: +999.999.999.999.999.999.999,999999 m, +99.999.999.999.999.999.999.999.999.900 %')
    // cazul prins de suita verificatorului: sutimile nenule la o magnitudine mare (SQL rotunjea „…823 %”)
    expect(descrieDiferenta('1.084', '1000000000000000000000', { lungime: false, unitate: 'mc' })).toBe('diferență mare: +999.999.999.999.999.999.998,916 mc, +92.250.922.509.225.092.250.822,5 %')
    expect(descrieDiferenta(100, 100.8)).toBe('diferență mică: +0,8 m, +0,8 %')
    expect(descrieDiferenta(100, 101)).toBe('diferență mare: +1 m, +1 %')
    expect(descrieDiferenta(1000, 1000.05)).toBe('diferență mică: +0,05 m, sub 0,01 %')
  })
})
