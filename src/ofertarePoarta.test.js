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
  cerinte_neconfirmate_cu_capitol: 0,
  documentatie_verificata: true, documentatie_blocaj: null, documentatie_esentiale: 5,
  lista_f3_m: 1000, lista_c6_m: 1000, memoriu_m: 1000, plansa_m: 1000, grafic_fronturi_m: 1000,
  // R5 (25.09.2026): din v_ofertare_cantitati_nevalidate — F3 validata integral
  lista_f3_nevalidate: 0, lista_f3_nevalidate_m: null, lista_c6_nevalidate: 0, memoriu_nevalidate: 0, plansa_nevalidate: 0,
  // R5 condiția 2 (26.09.2026): câmpurile noi ale v_ofertare_cantitati_nevalidate
  fara_tip_nevalidate: 0, fara_tip_nevalidate_m: null, invalidate_in_afara_retea: 0, invalidate_in_afara_retea_m: null,
  total_invalidate: 0, unitate_schimbata_in_afara_retea: 0, um_de_normalizat: 0,
  // R5 sarcina 2 (a): planșele cu conflicte de transfer deschise
  transfer_conflicte_docs: 0, transfer_conflicte_n: 0, transfer_in_curs: 0,
  garantie_cerut_luni: 36, garantie_cerut_moment: 'pif', garantie_oferit_luni: 36, garantie_oferit_moment: 'pif',
  garantie_confirmata: true, garantie_justificata: false, garantie_luni_in_capitole: [36], garantie_cerinte_lucrari: 2,
  anexe_referite: ['anexa 7'], anexe_existente: ['Anexa 7'], identitate_straine: [], bransamente_in_capitole: [372], bransamente_in_cerinte: [372],
  participanti: [], fraze_asociere: [],
  observatii_deschise: 0,
  documente: 4, documente_necitite: 0,
  grafic_versiune: 1, grafic_avertismente: 0,
  // PR 1 Laza: grafic generat de motor (fara es/ef declarate) => nimic de confruntat, ok
  grafic_versiune_mod: 'oferta', grafic_activitati_declarate: [{ id: 1, durata_zile: 5, predecesori: [] }],
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
    it('cerinta atribuita dar NECONFIRMATA in registru (E2) -> block, chiar daca totul altfel e verde (P0c, 24.09.2026)', () => {
      const ev = cu({ cerinte_neconfirmate_cu_capitol: 1 })
      expect(ev.stare).toBe('block'); expect(ev.blocaje).toContain('neconfirmate')
    })
    it('testul decisiv Copilot: generare cu override -> salvare umana (sursa=om, capitole_nescrise_de_om 0, legaturi verificate) -> E2 inca lipsa -> tot block', () => {
      const ev = cu({ capitole_nescrise_de_om: 0, cerinte_neverificate: 0, cerinte_neconfirmate_cu_capitol: 2 })
      expect(ev.stare).toBe('block'); expect(ev.blocaje).toEqual(['neconfirmate'])
    })
    it('control INDISPONIBIL (view lipsa / eroare / rezultat invalid) = block cu „nu putem verifica”, NU zero (Copilot 24.09)', () => {
      const { cerinte_neconfirmate_cu_capitol: _x, ...fara } = VERDE
      for (const st of [fara, { ...VERDE, cerinte_neconfirmate_cu_capitol: null }, { ...VERDE, cerinte_neconfirmate_cu_capitol: 'x' }, { ...VERDE, cerinte_neconfirmate_cu_capitol: -1 }]) {
        const ev = evalueazaPoarta(st)
        expect(ev.stare).toBe('block'); expect(ev.blocaje).toEqual(['neconfirmate'])
        expect(ev.randuri.find(r => r.k === 'neconfirmate').detalii).toMatch(/Nu putem verifica/)
        expect(ev.randuri.find(r => r.k === 'neconfirmate').detalii).not.toMatch(/cerințe cu capitol nu sunt confirmate/)
      }
    })
    it('control disponibil si 0 neconfirmate → trece', () => expect(cu({ cerinte_neconfirmate_cu_capitol: 0 }).blocaje).toEqual([]))
    it('cerinta doar ATRIBUITA unui capitol nu e verificata -> block (P0.3: atribuirea nu e conformitate)', () => {
      const ev = cu({ cerinte_neverificate: 1 })
      expect(ev.blocaje).toContain('neverificate'); expect(ev.stare).toBe('block')
    })
    it('H6: capitolele nu confirma niciun numar din cerinte => block', () => expect(cu({ bransamente_in_capitole: [758] }).blocaje).toContain('numere'))
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

  describe('REZERVE — semnale de citit, nu fapte', () => {
    // `rezerve` sunt TEXTE (intra in mesajul semnaturii), `blocaje` sunt CHEI. De aia starea
    // unui rand anume se citeste din `randuri`, nu din `rezerve`.
    const randul = (ev, k) => ev.randuri.find(x => x.k === k)
    it('H1: nume din alta licitatie => rezerva, NU blocaj (poate fi experienta similara)', () => {
      const ev = cu({ identitate_straine: ['Domnesti'] })
      expect(ev.stare).toBe('warn'); expect(ev.blocaje).toEqual([])
      expect(randul(ev, 'identitate').stare).toBe('warn')
      expect(ev.rezerve.join(' ')).toMatch(/Domnesti/)
    })
    it('HOG-08: textul zice „asocierii\", dar e declarat doar un tert => rezerva, nu blocaj', () => {
      const ev = cu({ participanti: ['tert_sustinator|HABAU'], fraze_asociere: ['Echipa de proiect a asocierii va prezenta rapoarte de progres'] })
      expect(ev.blocaje).toEqual([])
      expect(ev.randuri.find(x => x.k === 'participare').stare).toBe('warn')
    })
    it('H6: surse care se contrazic intre ele => rezerva, cu ambele numere', () => {
      const ev = cu({ bransamente_in_cerinte: [371, 372] })
      expect(ev.blocaje).toEqual([])
      expect(randul(ev, 'numere').stare).toBe('warn')
      expect(ev.rezerve.join(' ')).toMatch(/371, 372/)
    })
  })

  describe('verdictSemnatura — un singur loc decide verde/galben', () => {
    it('ok -> verde', () => expect(verdictSemnatura(cu({}))).toBe('verde'))
    it('orice rezerva -> galben; "galben" NU inseamna gata de depus (P0.2)', () => expect(verdictSemnatura(cu({ observatii_deschise: 1 }))).toBe('galben'))
  })

  it('toate cele 22 de randuri ale portii sunt prezente, in ordinea afisata', () => {
    expect(cu({}).randuri.map(r => r.k)).toEqual(
      ['cuprins','fara','neverificate','neconfirmate','documentatie','capcane','goale','nu_e_cazul','conformitate','nescrise','observatii','docs','grafic','cantitati','garantie','anexe','identitate','numere','participare', 'pachet', 'grafic_sursa', 'grafic_relatii'])
  })
})

// ════════════════════════════════════════════════════════════════
// FIXTURE PRUNIȘOR–JUPA / ELCAS — cazul cerut de analiza finală (§13).
//
// Lanțul documentat, cap-coadă:
//   F4 (PT p. 1312/1405) declară „Fișa tehnică 18–21 atașată"
//   → PT §4.6 spune că lucrările sunt ale ELCAS (acord 306/23.06.2025)
//   → fișierele existau la ELCAS, semnate electronic
//   → n-au fost unite în PDF-ul final, deci pachetul depus nu le conține
//   → Transgaz cere clarificare
//
// Ce TREBUIE să spună poarta: piesele lipsesc din pachet și răspunde ELCAS.
// Ce NU are voie să spună: că documentul tehnic n-ar exista, sau că lucrarea fizică lipsește.
// ════════════════════════════════════════════════════════════════
describe('FIXTURE Prunișor–Jupa: fișele 18–21 declarate în F4, absente din pachet', () => {
  const F4 = n => ({ ref: `Fișa tehnică ${n}`, sursa: 'f4', document_sursa: 'PT F4', pagina: '1312 / 1405',
    responsabil: 'ELCAS PRODIMPEX SRL' })
  const stare = {
    anexe_declarate: [F4(18), F4(19), F4(20), F4(21)],
    pachet_stare: 'depus',
    // Pachetul depus: propunerea, borderoul si anexele care AU ajuns. Fisele 18-21 nu sunt aici.
    pachet_fisiere: [
      { nume: 'Propunere_tehnica.docx', rol: 'propunere_docx' },
      { nume: 'Borderou_PT.docx', rol: 'borderou_docx' },
      { nume: 'Fisa tehnica 17.pdf', semnat: true, sursa_participant: 'ELCAS PRODIMPEX SRL' },
    ],
    // Participarea reala: fara asociere, cinci subcontractanti, HABAU si tert sustinator.
    participanti: ['subcontractant|HABAU S.R.L.', 'tert_sustinator|HABAU S.R.L.',
      'subcontractant|ELCAS PRODIMPEX SRL', 'subcontractant|OPTOTEL COM SRL',
      'subcontractant|ROCONSULT TECH SRL', 'subcontractant|RAPID COMPLEX SRL'],
    declaratii_participare: [
      { forma: 'asociere', stare: 'nu_e_cazul', document_sursa: 'PT §4.5' },
      { forma: 'subcontractare', stare: 'declarata', document_sursa: 'PT §4.6' },
      { forma: 'tert_sustinator', stare: 'declarata', document_sursa: 'PT §4.12' },
    ],
    fraze_asociere: ['Asociatului / Subcontractorului / Furnizorului i se va comunica programul'],
  }

  const ev = evalueazaPoarta(stare)
  const rand = k => ev.randuri.find(x => x.k === k)

  it('rândul pachetului BLOCHEAZĂ, cu codul de lipsă din pachetul final', () => {
    const r = rand('pachet')
    expect(r.stare).toBe('block')
    expect(ev.blocaje).toContain('pachet')
  })
  it('numește toate cele patru fișe', () => {
    for (const n of [18, 19, 20, 21]) expect(rand('pachet').detalii).toContain(`Fișa tehnică ${n}`)
  })
  it('numește firma responsabilă — nu „document lipsă"', () =>
    expect(rand('pachet').detalii).toMatch(/r[ăa]spunde ELCAS PRODIMPEX SRL/))
  it('spune de unde vine așteptarea: F4, cu pagina', () =>
    expect(rand('pachet').detalii).toMatch(/F4 spune c[ăa] e ata[șs]at[ăa], PT F4, p\. 1312 \/ 1405/))
  it('spune explicit că documentul poate exista la participant', () =>
    expect(rand('pachet').detalii).toMatch(/poate exista la participant [șs]i tot s[ăa] lipseasc[ăa]/))
  it('NU pretinde că documentul tehnic nu există sau că lucrarea lipsește', () => {
    const t = rand('pachet').detalii
    expect(t).not.toMatch(/nu exist[ăa]|lucrare[a]? (lipse[șs]te|omis)|nerealizat/i)
  })
  it('participarea rămâne ok: rol dublu legitim, șablonul nu inventează contradicție', () => {
    const r = rand('participare')
    expect(r.stare).toBe('ok')
    expect(r.detalii).toMatch(/rol dublu — HABAU S\.R\.L\.: subcontractant \+ terț susținător/)
    expect(r.detalii).toMatch(/asocierea nu e cazul/)
  })
})

describe('P0 pas 2 — documentația de atribuire', () => {
  it('controlul indisponibil = block „nu putem verifica”, nu verde', () => {
    const ev = cu({ documentatie_verificata: undefined })
    expect(ev.stare).toBe('block'); expect(ev.blocaje).toEqual(['documentatie'])
  })
  it('enumerarea SEAP eșuată blochează cu motivul din view', () => {
    const ev = cu({ documentatie_blocaj: 'nu putem verifica completitudinea: enumerarea SEAP a eșuat (HTTP 503)' })
    expect(ev.stare).toBe('block')
    expect(ev.randuri.find(x => x.k === 'documentatie').detalii).toMatch(/enumerarea SEAP a eșuat/)
  })
  it('complet și citit = ok', () => {
    expect(cu({}).randuri.find(x => x.k === 'documentatie').stare).toBe('ok')
  })
})

// R5 (Copilot 25.09.2026): existența rândului 'extras' nu dovedește că a intrat în oferta aprobată.
describe('R5 — poarta propunerii nu ia F3 nevalidata drept referinta aprobata', () => {
  it('F3 cu randuri de retea nevalidate => block pe „cantitati", restul verde', () => {
    const ev = cu({ lista_f3_nevalidate: 3, lista_f3_nevalidate_m: 250 })
    expect(ev.stare).toBe('block'); expect(ev.blocaje).toEqual(['cantitati'])
    expect(ev.randuri.find(x => x.k === 'cantitati').detalii).toMatch(/NEVALIDATE \(250 m\)/)
  })
  it('view-ul de validare lipsa (campuri absente) => block „nu putem verifica", nu verde', () => {
    const ev = cu({ lista_f3_nevalidate: undefined })
    expect(ev.blocaje).toEqual(['cantitati'])
    expect(ev.randuri.find(x => x.k === 'cantitati').detalii).toMatch(/nu putem verifica/)
  })
})
