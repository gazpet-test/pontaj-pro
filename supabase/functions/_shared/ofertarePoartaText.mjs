// J07: implementare comună UI / Edge, fără React sau rețea.
const num = v => (v == null || v === '') ? null : Number(v)
const plural = (n, unu, multe) => `${n} ${n === 1 ? unu : multe}`

export const MOMENTE_GARANTIE = {
  pif: 'punerea în funcțiune', receptie_terminare: 'recepția la terminarea lucrărilor',
  receptie_finala: 'recepția finală', livrare: 'livrare', semnare_contract: 'semnarea contractului',
}
export function controlGarantie({ garantie_cerut_luni, garantie_cerut_moment, garantie_oferit_luni, garantie_oferit_moment,
                                  garantie_confirmata, garantie_justificata, garantie_luni_in_capitole, garantie_cerinte_lucrari }) {
  const cl = num(garantie_cerut_luni), ol = num(garantie_oferit_luni)
  const cm = garantie_cerut_moment || null, om = garantie_oferit_moment || null
  const inCap = (garantie_luni_in_capitole || []).map(Number).filter(n => !Number.isNaN(n))
  const nCer = Number(garantie_cerinte_lucrari) || 0
  const base = { k: 'garantie', cerut_luni: cl, oferit_luni: ol, cerut_moment: cm, oferit_moment: om, luni_in_capitole: inCap }
  const mom = m => MOMENTE_GARANTIE[m] || m
  if (ol == null || !om) {
    return { ...base, stare: nCer > 0 ? 'block' : 'warn',
      detalii: nCer > 0
        ? `${nCer} cerințe vorbesc de garanția lucrărilor, dar garanția oferită (luni + momentul de start) nu e asumată în ERP`
        : 'garanția oferită nu e asumată (luni + momentul de start) — nicio cerință găsită automat, verifică fișa de date' }
  }
  const probleme = []
  if (cl != null && ol < cl) probleme.push(`oferim ${ol} luni, se cer minim ${cl}`)
  if (cm && om !== cm) probleme.push(`momentul de start diferă: oferit „${mom(om)}", cerut „${mom(cm)}"`)
  const straine = [...new Set(inCap.filter(n => n !== ol))]
  if (straine.length) probleme.push(`capitolele pomenesc ${straine.join(', ')} luni, nu ${ol}`)
  if (probleme.length) return { ...base, stare: 'block', detalii: probleme.join(' · ') }
  const rez = []
  if (cl == null || !cm) rez.push('cerința (luni + moment) nu e notată — nu se poate confrunta cu ce oferim')
  // H-051: peste minimul cerut, F8 cere justificare prin metodologie și dovezi de calitate.
  // La Hoghilag s-au declarat 60 de luni fără ca justificarea să fie demonstrată.
  if (cl != null && ol > cl && !garantie_justificata) rez.push(`oferim ${ol - cl} luni peste minim, fără justificare scrisă (documentația o cere)`)
  if (!garantie_confirmata) rez.push('neconfirmată de un om')
  const text = `${ol} luni de la ${mom(om)}` + (cl != null ? ` (cerut minim ${cl} de la ${mom(cm)})` : '')
  return { ...base, stare: rez.length ? 'warn' : 'ok', detalii: text + (rez.length ? ' — ' + rez.join('; ') : '') }
}

/**
 * H5 — referințele din text trimit la piese care există în dosar. „Vezi Anexa 7" cu Anexa 7 lipsă
 * din opis e o greșeală de fapt, nu de stil: block. Potrivirea e pe (tip, număr) normalizat, cu
 * cifre romane acceptate, ca „Cap. III" să fie același lucru cu „capitolul 3".
 */
const ROMAN = { i:1, v:5, x:10, l:50, c:100 }
function romanToInt(r) {
  let n = 0
  for (let i = 0; i < r.length; i++) { const a = ROMAN[r[i]], b = ROMAN[r[i + 1]]; n += b && b > a ? -a : a }
  return n
}

const NR_REF = '([0-9]+[a-z]?|[ivxlc]+)'
export function normalizeazaRef(t = '') {
  const s = String(t).toLowerCase()
  // „Fișa tehnică 18" — piesa din F4. Are doua cuvinte si diacritice, deci nu intra in tiparul
  // scurt de mai jos; e citita prima, ca sa nu fie confundata cu nimic.
  const f = s.match(new RegExp(`^\\s*fi[șs][ăa]?\\s*tehnic[ăa]?\\s*(?:nr\\.?\\s*)?${NR_REF}\\b`))
  if (f) return `fisa:${/^[0-9]/.test(f[1]) ? f[1] : romanToInt(f[1])}`
  const m = s.match(new RegExp(`^\\s*(anex|formular|cap|plan)[a-zăș.]*\\s*(?:nr\\.?\\s*)?${NR_REF}\\b`))
  if (!m) return null
  const tip = { anex: 'anexa', formular: 'formular', cap: 'cap', plan: 'plansa' }[m[1]]
  const nr = /^[0-9]/.test(m[2]) ? m[2] : String(romanToInt(m[2]))
  return `${tip}:${nr}`
}
// Rolul unei piese, dedus din text. Folosit si pe TITLUL capitolului, si pe FRAZA care trimite la
// el, ca sa se poata compara ce spune trimiterea cu ce contine piesa. Cheile vin din anexele reale
// ale unei propuneri depuse (Hoghilag, cuprins p. 4).
export const ROLURI_PIESA = {
  plan_calitate: /plan[^.]{0,40}(calit[ăa][țt]ii|calitate)|asigurare a calit|proceduri (tehnice )?de execu/i,
  grafic:        /grafic[^.]{0,30}(general|realizare|execu|investi)|curba s\b|network diagram|\bpert\b/i,
  surse_materiale: /surse[^.]{0,20}materiale|formular(ul)? f3\b/i,
  personal:      /personal|experti|exper[țt]i|organigram/i,
  infrastructura:/infrastructur|utilaje|echipamente utilizate/i,
  mediu:         /mediu(lui)?\b|protec[țt]ia mediului/i,
  ssm:           /\bssm\b|securitate[^.]{0,25}mun|s[ăa]n[ăa]tate[^.]{0,25}mun|protec[țt]ia muncii/i,
  trafic:        /trafic|circula[țt]i/i,
  deseuri:       /de[șs]euri|salubr/i,
}
export function rolPiesa(text = '') {
  for (const [rol, rx] of Object.entries(ROLURI_PIESA)) if (rx.test(String(text))) return rol
  return null
}

/**
 * H5 — trimiterile din text. Două verificări, același rând de poartă:
 *  (a) trimiterea are o piesă în cuprins (prinde „vezi Anexa 7" cu Anexa 7 lipsă);
 *  (b) piesa la care trimite chiar conține ce spune fraza.
 *
 * (b) vine din Hoghilag, pagina 28: „In Anexa 3 este prezentat Planul de management al calitatii",
 * iar planul calității e Anexa 10. Anexa 3 EXISTA, deci prima verificare tăcea. Rolul piesei se
 * deduce din titlul capitolului, nu se ține într-o coloană: titlul îl spune deja.
 *
 * Când fraza n-are rol recognoscibil, sau când niciun capitol n-are rolul ăla, nu se verifică
 * nimic. Mai bine tace decât să inventeze o nepotrivire.
 */
export function controlAnexe({ anexe_referite, anexe_existente, fraze_anexe, capitole_ref }) {
  const referite = [...new Set((anexe_referite || []).map(normalizeazaRef).filter(Boolean))]
  const existente = new Set((anexe_existente || []).map(normalizeazaRef).filter(Boolean))
  const lipsa = referite.filter(r => !existente.has(r))
  const arata = r => { const [t, n] = r.split(':'); return ({ anexa: 'Anexa', formular: 'Formularul', cap: 'cap.', plansa: 'planșa' })[t] + ' ' + n }

  // (b) rolul cerut de frază vs eticheta piesei care chiar are rolul ăla
  const peRol = new Map()
  for (const cr of capitole_ref || []) {
    const i = String(cr).indexOf('|'); if (i < 0) continue
    const eticheta = String(cr).slice(0, i), titlu = String(cr).slice(i + 1)
    const rol = rolPiesa(titlu), ref = normalizeazaRef(eticheta)
    if (rol && ref) { if (!peRol.has(rol)) peRol.set(rol, new Set()); peRol.get(rol).add(ref) }
  }
  const gresite = []
  for (const fraza of fraze_anexe || []) {
    const t = String(fraza)
    const refs = [...new Set((t.match(/(anex[aă]|formular(?:ul)?)\s*(?:nr\.?\s*)?[0-9]+/gi) || []).map(normalizeazaRef).filter(Boolean))]
    if (!refs.length) continue
    const rol = rolPiesa(t)
    const tinte = rol && peRol.get(rol)
    if (!tinte || !tinte.size) continue          // rol necunoscut sau nicio piesă cu rolul ăsta: nu se verifică
    if (refs.some(r => tinte.has(r))) continue   // trimiterea cade pe piesa corectă
    gresite.push({ fraza: t.slice(0, 160), refs, rol, corect: [...tinte] })
  }

  const base = { k: 'anexe', lipsa, gresite }
  if (gresite.length) return { ...base, stare: 'block',
    detalii: gresite.map(g => `„${g.fraza.slice(0, 70)}…" trimite la ${g.refs.map(arata).join(' / ')}, dar piesa cu acest conținut e ${g.corect.map(arata).join(' / ')}`).join(' · ')
      + (lipsa.length ? ` · plus ${lipsa.length} trimiteri către piese inexistente: ${lipsa.map(arata).join(', ')}` : '') }
  if (!referite.length) return { ...base, stare: 'ok', detalii: 'capitolele nu trimit la nicio anexă / formular / capitol' }
  if (lipsa.length) return { ...base, stare: 'block',
    detalii: `${lipsa.length} din ${referite.length} referințe trimit la piese care nu-s în cuprins: ${lipsa.map(arata).join(', ')} — adaugă-le sau scoate trimiterea` }
  return { ...base, stare: 'ok', detalii: `${referite.length} referințe, toate cu piesa în cuprins` + (peRol.size ? ` și cu conținutul potrivit` : '') }
}



export function controlNumereCheie({ bransamente_in_capitole, bransamente_in_cerinte }) {
  const cap = [...new Set((bransamente_in_capitole || []).map(Number).filter(n => !Number.isNaN(n)))].sort((a, b) => a - b)
  const cer = [...new Set((bransamente_in_cerinte || []).map(Number).filter(n => !Number.isNaN(n)))].sort((a, b) => a - b)
  const base = { k: 'numere', in_capitole: cap, in_cerinte: cer }
  const lst = a => a.join(', ')
  if (cer.length > 1) return { ...base, stare: 'warn',
    detalii: `documentația autorității dă numere diferite: ${lst(cer)} branșamente / racorduri`
      + (cap.length ? ` (capitolele folosesc ${lst(cap)})` : '')
      + ' — conflict de surse, cere clarificare; nu alege singur o valoare' }
  if (!cap.length) return { ...base, stare: 'ok', detalii: cer.length ? `capitolele nu pomenesc branșamente sau racorduri (cerințele spun ${lst(cer)})` : 'niciun număr de branșamente sau racorduri în joc' }
  if (cer.length && !cap.some(n => cer.includes(n))) return { ...base, stare: 'block',
    detalii: `cerințele spun ${lst(cer)} branșamente / racorduri, capitolele spun ${lst(cap)} — niciun număr nu coincide` }
  if (cap.length > 1) return { ...base, stare: 'warn',
    detalii: `capitolele pomenesc ${lst(cap)} branșamente / racorduri — verifică dacă defalcările dau exact totalul (compensarea între localități nu e reconciliere)` }
  return { ...base, stare: 'ok', detalii: `${cap[0]} branșamente / racorduri, același număr peste tot` }
}


export function controlPachetComplet({ anexe_asteptate, anexe_declarate, anexe_responsabili, pachet_stare, pachet_fisiere }) {
  // Analiza 03: cand lipseste fisa 18, ERP-ul trebuie sa spuna ELCAS, nu „document lipsa". Firma
  // responsabila vine din capitol (ofertare_pt_capitole.participant_id), pe cheia textului piesei.
  const resp = anexe_responsabili || {}
  const respPeRef = new Map()
  for (const [text, firma] of Object.entries(resp)) {
    const r = normalizeazaRef(text)
    if (r && firma && !respPeRef.has(r)) respPeRef.set(r, String(firma))
  }
  // Așteptările pot veni ca text simplu („Anexa 18") sau ca obiect, când se știe cine răspunde de piesă.
  //
  // DOUA SURSE, nu una. Analiza finala Prunisor-Jupa §6.4: dosarul n-avea opis tehnic separat, dar
  // F4 (PT, p. 1312/1405, coloana „Fisa tehnica atasata") DECLARA ca fisele 18-21 sunt atasate.
  // Adica oferta depusa contine o afirmatie despre propriul continut, pe care pachetul o poate
  // infirma. Asta bate cuprinsul: cuprinsul e ce voiam sa punem, F4 e ce am spus ca am pus.
  const asteptate = []
  // Laza (14.09.2026, gasit de Jakarinos): „formular profil Pantea" n-are (tip, numar), deci
  // normalizeazaRef intoarce null si piesa DISPAREA de aici in tacere — controlul ramanea verde
  // exact pe formularul care a lipsit real. Piesele care nu se pot identifica nu se arunca: se
  // numara si se spun, ca omul sa le confrunte cu mana.
  const neidentificate = []
  const adauga = (text, responsabil, sursa, unde) => {
    const ref = normalizeazaRef(text)
    if (!ref) { const t = String(text || '').trim(); if (t && !neidentificate.includes(t)) neidentificate.push(t); return }
    const gasit = asteptate.find(x => x.ref === ref)
    if (gasit) {   // o piesa declarata bate una dedusa din cuprins: are sursa si pagina
      if (sursa && !gasit.sursa) { gasit.sursa = sursa; gasit.unde = unde }
      if (responsabil && !gasit.responsabil) gasit.responsabil = responsabil
      return
    }
    asteptate.push({ ref, text: String(text).trim(), responsabil: responsabil || respPeRef.get(ref) || null, sursa, unde })
  }
  for (const a of anexe_declarate || [])
    adauga(a?.ref ?? '', a?.responsabil || null, a?.sursa || 'declarata',
      [a?.document_sursa, a?.pagina && `p. ${a.pagina}`].filter(Boolean).join(', '))
  for (const a of anexe_asteptate || [])
    adauga(typeof a === 'string' ? a : (a?.ref ?? a?.titlu ?? ''),
      (typeof a === 'object' && a?.responsabil) || null, null, null)
  const fisiere = (pachet_fisiere || []).map(f => ({
    nume: String(f?.nume || ''), rol: f?.rol || null, semnat: !!f?.semnat,
    unit_in: f?.unit_in || null, sursa_participant: f?.sursa_participant || null,
    // Piesa pe care o poartă fișierul: declarată explicit, altfel dedusă din numele fișierului.
    ref: normalizeazaRef(f?.anexa_ref || '') || normalizeazaRef(f?.nume || ''),
  }))
  const inPachet = new Set(fisiere.filter(f => f.ref && !f.unit_in).map(f => f.ref))
  const base = { k: 'pachet', asteptate, fisiere, lipsa: [], semnaturi_rupte: [], neidentificate }

  // Poarta se semneaza INAINTE de asamblare (pachetul se produce din poarta semnata), deci lipsa
  // pachetului nu are voie sa insemne rezerva: ar face orice propunere galbena, circular. Randul
  // devine activ cand exista fisiere.
  if (!pachet_stare || !fisiere.length) return { ...base, stare: 'ok',
    detalii: 'pachetul final nu e încă asamblat — completitudinea se verifică pe fișierele urcate, înainte de depunere' }

  // Daca NICIUN fisier nu poarta o piesa, asamblarea anexelor n-a inceput inca: pachetul are doar
  // documentele generate. Nu e „lipsa", e „nu s-a ajuns acolo" — se spune, nu se blocheaza. Blocant
  // devine cand asamblarea a inceput si tot lipsesc piese: exact cazul ELCAS, unde 17 anexe erau in
  // pachet si patru nu.
  if (asteptate.length && !inPachet.size && !fisiere.some(f => f.semnat || f.unit_in))
    return { ...base, stare: 'warn',
      detalii: `pachetul are doar documentele generate — ${plural(asteptate.length, 'piesa declarată n-are', 'piese declarate n-au')} fișier încărcat` }

  const lipsa = asteptate.filter(a => !inPachet.has(a.ref))
  // „Unit într-un PDF semnat" e tot lipsă, doar că una care se vede: piesa nu mai e un fișier propriu.
  const rupte = fisiere.filter(f => f.semnat && f.unit_in)
  const out = { ...base, lipsa, semnaturi_rupte: rupte }
  const CUM_DECLARATA = { f4: 'F4 spune că e atașată', opis: 'opisul o enumeră', manifest: 'manifestul o cere',
    cerinta: 'o cere documentația', alta: 'e declarată', declarata: 'e declarată' }
  const numeste = a => a.text
    + (a.responsabil ? ` (răspunde ${a.responsabil})` : '')
    + (a.sursa ? ` — ${CUM_DECLARATA[a.sursa] || CUM_DECLARATA.alta}${a.unde ? `, ${a.unde}` : ''}` : '')

  if (rupte.length) return { ...out, stare: 'block', cod: 'SIGNED_DOCUMENT_MERGED',
    detalii: `${plural(rupte.length, 'fișier semnat digital a fost unit', 'fișiere semnate digital au fost unite')} în alt PDF — unirea rupe semnătura: `
      + rupte.map(f => `${f.nume} → ${f.unit_in}`).join(', ')
      + ' · anexa semnată se depune ca fișier de sine stătător, legată prin opis'
      + (lipsa.length ? ` · în plus lipsesc din pachet: ${lipsa.map(numeste).join(', ')}` : '') }

  if (lipsa.length) return { ...out, stare: 'block', cod: 'REQUIRED_ATTACHMENT_NOT_IN_FINAL_PACKAGE',
    detalii: `${plural(lipsa.length, 'piesă declarată nu are fișier', 'piese declarate n-au fișier')} în pachetul final: `
      + lipsa.map(numeste).join(' · ')
      + ' · documentul poate exista la participant și tot să lipsească din ce se depune' }

  if (!asteptate.length) return { ...out, stare: 'warn',
    detalii: `${plural(fisiere.length, 'fișier', 'fișiere')} în pachet, dar nicio piesă declarată (nici F4, nici opis) — nu se poate confrunta` }

  if (neidentificate.length) return { ...out, stare: 'warn', cod: 'UNIDENTIFIED_DECLARED_PIECE',
    detalii: `${plural(asteptate.length, 'piesă identificată are', 'piese identificate au')} fișier, dar ${plural(neidentificate.length, 'piesă declarată nu s-a putut identifica', 'piese declarate nu s-au putut identifica')} (fără tip și număr) și nu se pot confrunta automat: `
      + neidentificate.slice(0, 6).join(' · ') + (neidentificate.length > 6 ? ` · +${neidentificate.length - 6}` : '')
      + ' · verifică-le cu mâna în pachet' }

  return { ...out, stare: 'ok',
    detalii: `${plural(asteptate.length, 'piesă declarată', 'piese declarate')}, toate cu fișier în pachetul final (${fisiere.length} fișiere)` }
}